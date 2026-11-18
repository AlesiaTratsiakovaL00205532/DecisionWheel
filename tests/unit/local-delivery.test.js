import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from 'node:test';
import { fileURLToPath } from 'node:url';

const commit = 'a'.repeat(40);
const image = `decision-wheel:sha-${commit}`;
const previous = 'decision-wheel:previous';
const deployScript = fileURLToPath(new URL('../../scripts/deploy-local.ps1', import.meta.url));
const loadScript = fileURLToPath(new URL('../../scripts/load-local-image.ps1', import.meta.url));
const harness = String.raw`
$ErrorActionPreference = 'Stop'
$originalPath = $env:PATH
$dockerDirectory = Join-Path (Split-Path -Parent $env:DELIVERY_FIXTURE) 'docker-tools'
$global:deliveryTestState = @{
    fixture = (Get-Content -LiteralPath $env:DELIVERY_FIXTURE -Raw | ConvertFrom-Json)
    patches = 0
    phase = 'previous'
}
function kubectl {
    $a = @($args)
    $s = $global:deliveryTestState
    $d = $s.fixture.deployment
    $global:LASTEXITCODE = 0
    if ($a -contains 'whoami') {
        $user = 'system:serviceaccount:decision-wheel:jenkins-deployer'
        if ($s.fixture.scenario -eq 'admin') { $user = 'kubernetes-admin' }
        return (@{status=@{userInfo=@{username=$user}}} | ConvertTo-Json -Depth 5 -Compress)
    }
    if ($a -contains 'patch') {
        $file = $a[[array]::IndexOf($a,'--patch-file')+1]
        $ops = Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
        if ($s.fixture.scenario -eq 'concurrent' -and $s.patches -eq 1) {
            $d.spec.template.spec.containers[0].image = 'decision-wheel:someone-else'
            $d.spec.template.metadata.annotations.'decision-wheel.local/deployment-id' = 'other-owner'
            $global:LASTEXITCODE = 1
            return
        }
        foreach ($op in $ops) {
            if ($op.op -eq 'test') {
                if ($op.path -eq '/metadata/resourceVersion') { $actual = $d.metadata.resourceVersion }
                elseif ($op.path -match '/name$') { $actual = $d.spec.template.spec.containers[0].name }
                else { $actual = $d.spec.template.spec.containers[0].image }
                if ($actual -cne $op.value) { throw 'Optimistic concurrency test failed.' }
            } elseif ($op.path -eq '/spec/template/metadata/annotations') {
                $d.spec.template.metadata | Add-Member -NotePropertyName annotations -NotePropertyValue ([pscustomobject]@{}) -Force
            } elseif ($op.path -match '/annotations/') {
                if ($op.op -eq 'remove') {
                    $d.spec.template.metadata.annotations.PSObject.Properties.Remove('decision-wheel.local/deployment-id')
                } else {
                    $d.spec.template.metadata.annotations | Add-Member -NotePropertyName 'decision-wheel.local/deployment-id' -NotePropertyValue $op.value -Force
                }
            } else { $d.spec.template.spec.containers[0].image = $op.value }
        }
        $s.patches++
        $s.phase = if ($s.patches -eq 1) {'candidate'} else {'previous'}
        $d.metadata.resourceVersion = [string]([int]$d.metadata.resourceVersion + 1)
        Add-Content -LiteralPath $env:DELIVERY_PATCHES -Value (ConvertTo-Json -InputObject @($ops) -Depth 20 -Compress)
        if ($s.fixture.scenario -eq 'lost-patch-response' -and $s.patches -eq 1) {
            $global:LASTEXITCODE = 1
            return
        }
        return ($d | ConvertTo-Json -Depth 30 -Compress)
    }
    if ($a -contains 'rollout') {
        if (($s.fixture.scenario -in @('rollout-failure','rollback-failure','concurrent')) -and $s.phase -eq 'candidate') {
            if ($s.fixture.scenario -eq 'concurrent') {
                $d.spec.template.spec.containers[0].image = 'decision-wheel:someone-else'
                $d.spec.template.metadata.annotations.'decision-wheel.local/deployment-id' = 'other-owner'
            }
            $global:LASTEXITCODE = 1
        }
        if ($s.fixture.scenario -eq 'rollback-failure' -and $s.patches -eq 2) { $global:LASTEXITCODE = 1 }
        return
    }
    if ($a -contains 'pods') {
        $items = @(foreach ($name in @('decision-wheel-test-a','decision-wheel-test-b')) {
            @{
                metadata = @{name=$name;annotations=$d.spec.template.metadata.annotations}
                spec = @{containers=$d.spec.template.spec.containers}
                status = @{phase='Running';containerStatuses=@(@{ready=$true})}
            }
        })
        return (@{items=$items} | ConvertTo-Json -Depth 30 -Compress)
    }
    return ($d | ConvertTo-Json -Depth 30 -Compress)
}
function Start-Process {
    param($FilePath,$ArgumentList,[switch]$NoNewWindow,[switch]$PassThru,$RedirectStandardOutput,$RedirectStandardError)
    Set-Content -LiteralPath $RedirectStandardOutput -Value 'Forwarding from 127.0.0.1:32123 -> 3000'
    Set-Content -LiteralPath $RedirectStandardError -Value ''
    $p = [pscustomobject]@{Id=424242;HasExited=$false}
    $p | Add-Member ScriptMethod WaitForExit {}
    $p | Add-Member ScriptMethod Dispose {}
    return $p
}
function Stop-Process { param($Id,[switch]$Force); Add-Content -LiteralPath $env:DELIVERY_STOPS -Value $Id }
function Invoke-RestMethod {
    param($Uri,$TimeoutSec,$MaximumRedirection,$Method,$ContentType,$Body)
    $s = $global:deliveryTestState
    if ($s.fixture.scenario -eq 'smoke-failure' -and $s.phase -eq 'candidate') {
        throw 'PRIVATE-FAILURE-CANARY'
    }
    if ($s.fixture.scenario -eq 'unhealthy-baseline' -and $s.patches -eq 0) {
        throw 'PRIVATE-FAILURE-CANARY'
    }
    if ($Uri.EndsWith('/health')) { return @{status='ok'} }
    if ($s.fixture.scenario -eq 'concurrent-smoke' -and $s.phase -eq 'candidate') {
        $s.candidateSpins++
        if ($s.candidateSpins -eq 3) {
            $s.fixture.deployment.spec.template.spec.containers[0].image = 'decision-wheel:someone-else'
            $s.fixture.deployment.spec.template.metadata.annotations.'decision-wheel.local/deployment-id' = 'other-owner'
        }
    }
    return @{index=0;answer='Yes'}
}
function Invoke-WebRequest {
    param([switch]$UseBasicParsing,$Uri,$TimeoutSec,$MaximumRedirection)
    return @{StatusCode=200;Headers=@{'Content-Type'='text/html'};Content='<form id="question-form">'}
}
function docker {
    $a = @($args)
    $s = $global:deliveryTestState
    $global:LASTEXITCODE = 0
    if ($a -contains 'container') {
        $cluster = if ($s.fixture.scenario -eq 'wrong-cluster') {'unrelated'} else {'decision-wheel'}
        return (@{'io.x-k8s.kind.cluster'=$cluster} | ConvertTo-Json -Compress)
    }
    if ($a -contains '--format') { return 'sha256:fixture' }
    $revision = if ($s.fixture.scenario -eq 'wrong-revision') {'b'*40} else {$env:DELIVERY_COMMIT}
    return (,@{Id='sha256:fixture';Config=@{Labels=@{'org.opencontainers.image.revision'=$revision}}} | ConvertTo-Json -Depth 10 -Compress)
}
function Get-Command {
    [CmdletBinding()]
    param([string]$Name)
    if ($Name -eq 'docker' -and $global:deliveryTestState.fixture.scenario -like 'docker-path*') {
        return [pscustomobject]@{CommandType='Application';Source=(Join-Path $dockerDirectory 'docker.exe')}
    }
    Microsoft.PowerShell.Core\Get-Command @PSBoundParameters
}
function kind {
    $global:LASTEXITCODE = 0
    if ($global:deliveryTestState.fixture.scenario -like 'docker-path*' -and
        ($env:PATH -split [IO.Path]::PathSeparator)[0] -cne $dockerDirectory) {
        $global:LASTEXITCODE = 1
        return
    }
    if ($args -contains 'get') { return 'decision-wheel-control-plane' }
    Add-Content -LiteralPath $env:DELIVERY_PATCHES -Value 'loaded'
    if ($global:deliveryTestState.fixture.scenario -in @('load-failure','docker-path-failure')) { $global:LASTEXITCODE = 1 }
}
try {
    if ($env:DELIVERY_KIND -eq 'load') {
        & $env:DELIVERY_SCRIPT -Image $env:DELIVERY_IMAGE -SourceCommit $env:DELIVERY_COMMIT -ReportPath $env:DELIVERY_REPORT
    } else {
        & $env:DELIVERY_SCRIPT -Image $env:DELIVERY_IMAGE -SourceCommit $env:DELIVERY_COMMIT -Kubeconfig $env:DELIVERY_KUBECONFIG -ReportPath $env:DELIVERY_REPORT
    }
    exit $LASTEXITCODE
} catch {
    Write-Output ('HARNESS_FAILURE=' + $_.Exception.Message)
    exit 1
} finally {
    if ($env:PATH -cne $originalPath) { throw 'PATH-RESTORATION-FAILED' }
}
`;

const deployment = () => ({
  metadata: { name: 'decision-wheel', namespace: 'decision-wheel', resourceVersion: '10' },
  spec: {
    replicas: 2,
    template: {
      metadata: { labels: { 'app.kubernetes.io/name': 'decision-wheel' } },
      spec: { containers: [{ name: 'decision-wheel', image: previous }] },
    },
  },
});

function run(t, scenario, kind = 'deploy') {
  const directory = mkdtempSync(join(tmpdir(), 'decision-wheel-delivery-'));
  const files = Object.fromEntries(['fixture', 'report', 'patches', 'kubeconfig', 'stops']
    .map((name) => [name, join(directory, `${name}.json`)]));
  t.after(() => {
    for (const path of Object.values(files)) rmSync(path, { force: true });
    rmdirSync(directory);
  });
  writeFileSync(files.fixture, JSON.stringify({ scenario, deployment: deployment() }));
  writeFileSync(files.kubeconfig, 'test fixture; no credentials');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', harness], {
    env: {
      ...process.env,
      DELIVERY_KIND: kind,
      DELIVERY_SCRIPT: kind === 'load' ? loadScript : deployScript,
      DELIVERY_COMMIT: commit,
      DELIVERY_IMAGE: image,
      DELIVERY_FIXTURE: files.fixture,
      DELIVERY_REPORT: files.report,
      DELIVERY_PATCHES: files.patches,
      DELIVERY_KUBECONFIG: files.kubeconfig,
      DELIVERY_STOPS: files.stops,
    },
    encoding: 'utf8',
    timeout: 15_000,
  });
  const read = (path, fallback) => {
    try { return readFileSync(path, 'utf8').replace(/^\uFEFF/, ''); } catch { return fallback; }
  };
  return {
    result,
    report: JSON.parse(read(files.report, 'null')),
    patches: read(files.patches, '').trim().split(/\r?\n/).filter(Boolean),
    stops: read(files.stops, '').trim().split(/\r?\n/).filter(Boolean),
  };
}

for (const scenario of [
  { name: 'verifies both replicas and the Service after a guarded rollout', id: 'success', status: 0, outcome: 'deployed', patches: 1, stops: 6 },
  { name: 'rejects administrator credentials before changing resources', id: 'admin', status: 1, outcome: 'failed_no_change', patches: 0, stops: 0 },
  { name: 'does not deploy over an unhealthy baseline', id: 'unhealthy-baseline', status: 1, outcome: 'failed_no_change', patches: 0, stops: 1 },
  { name: 'recovers an applied patch even when its response was lost', id: 'lost-patch-response', status: 1, outcome: 'rolled_back', patches: 2, recovery: 'verified', stops: 6 },
  { name: 'restores and verifies the previous image after a rollout failure but fails delivery', id: 'rollout-failure', status: 1, outcome: 'rolled_back', patches: 2, recovery: 'verified', stops: 6 },
  { name: 'recovers from an HTTP smoke failure without exposing exception content', id: 'smoke-failure', status: 1, outcome: 'rolled_back', patches: 2, recovery: 'verified', stops: 7 },
  { name: 'reports failed recovery rather than claiming success', id: 'rollback-failure', status: 1, outcome: 'recovery_failed', patches: 2, recovery: 'failed', stops: 3 },
  { name: 'does not overwrite a concurrent deployment', id: 'concurrent', status: 1, outcome: 'failed_concurrent_change', patches: 1, recovery: 'skipped_concurrent_change', stops: 3 },
  { name: 'detects a concurrent change during final HTTP checks without rolling it back', id: 'concurrent-smoke', status: 1, outcome: 'failed_concurrent_change', patches: 1, recovery: 'skipped_concurrent_change', stops: 6 },
]) {
  it(`local deployment ${scenario.name}`, { skip: process.platform !== 'win32' }, (t) => {
    const actual = run(t, scenario.id);
    assert.equal(actual.result.status, scenario.status, actual.result.stderr || actual.result.stdout);
    assert.equal(actual.report?.result, scenario.outcome, actual.result.stdout);
    assert.equal(actual.patches.length, scenario.patches);
    assert.equal(actual.stops.length, scenario.stops);
    if (scenario.recovery) assert.equal(actual.report.recovery, scenario.recovery);
    assert.ok(!JSON.stringify(actual).includes('PRIVATE-FAILURE-CANARY'));
    if (actual.patches.length) {
      const operations = JSON.parse(actual.patches[0]);
      assert.ok(operations.some((op) => op.op === 'test' && op.path === '/metadata/resourceVersion'));
      assert.ok(operations.some((op) => op.path.endsWith('/image') && op.op === 'replace' && op.value === image));
      assert.ok(operations.some((op) => op.path.endsWith('decision-wheel.local~1deployment-id') && op.op === 'add'));
      if (scenario.outcome === 'rolled_back') {
        const rollback = JSON.parse(actual.patches[1]);
        assert.ok(rollback.some((op) => op.op === 'replace' && op.value === previous));
        assert.ok(rollback.some((op) => op.op === 'remove' && op.path.endsWith('decision-wheel.local~1deployment-id')));
      }
    }
    assert.equal(actual.report.registry_published, false);
  });
}

for (const scenario of [
  { name: 'loads only into the verified existing kind cluster', id: 'success', status: 0, loaded: true },
  { name: 'makes the configured Docker executable discoverable to kind', id: 'docker-path', status: 0, loaded: true },
  { name: 'restores PATH after an image import failure', id: 'docker-path-failure', status: 1, loaded: true },
  { name: 'rejects an image from a different revision', id: 'wrong-revision', status: 1, loaded: false },
  { name: 'rejects nodes from another cluster', id: 'wrong-cluster', status: 1, loaded: false },
  { name: 'fails closed when the image import fails', id: 'load-failure', status: 1, loaded: true },
]) {
  it(`local image loader ${scenario.name}`, { skip: process.platform !== 'win32' }, (t) => {
    const actual = run(t, scenario.id, 'load');
    assert.equal(actual.result.status, scenario.status, actual.result.stderr || actual.result.stdout);
    assert.ok(!(actual.result.stderr + actual.result.stdout).includes('PATH-RESTORATION-FAILED'));
    assert.equal(actual.patches.length > 0, scenario.loaded);
    if (scenario.status === 0) {
      assert.equal(actual.report.source_commit, commit);
      assert.equal(actual.report.registry_published, false);
    } else {
      assert.equal(actual.report, null);
    }
  });
}
