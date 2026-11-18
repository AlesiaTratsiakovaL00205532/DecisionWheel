import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../../scripts/check-kubernetes-access.ps1', import.meta.url));
const identity = (username) => ({
  exit: 0,
  output: JSON.stringify({ status: { userInfo: { username } } }),
});
const responses = () => [
  identity('system:serviceaccount:decision-wheel:jenkins-deployer'),
  ...Array.from({ length: 10 }, () => ({ exit: 0, output: 'yes' })),
  ...Array.from({ length: 5 }, () => ({ exit: 1, output: 'no' })),
  { exit: 0, output: 'deployment.apps/decision-wheel' },
  { exit: 0, output: 'service/decision-wheel' },
];
const harness = String.raw`
$ErrorActionPreference = 'Stop'
$global:accessTestState = @{
    responses = (Get-Content -LiteralPath $env:ACCESS_TEST_FIXTURE -Raw | ConvertFrom-Json)
    calls = 0
}
function kubectl {
    if ($global:accessTestState.calls -ge $global:accessTestState.responses.Count) {
        throw 'Unexpected additional Kubernetes request.'
    }
    $response = $global:accessTestState.responses[$global:accessTestState.calls]
    $global:accessTestState.calls++
    Write-Output $response.output
    $global:LASTEXITCODE = $response.exit
}
$failure = $null
try {
    & $env:ACCESS_TEST_SCRIPT -Kubeconfig $env:ACCESS_TEST_KUBECONFIG
} catch { $failure = $_.Exception.Message }
$result = @{ calls = $global:accessTestState.calls; failure = $failure }
Write-Output ('ACCESS_TEST_RESULT=' + ($result | ConvertTo-Json -Compress))
exit 0
`;
const cases = [
  { name: 'accepts the restricted identity and required access', calls: 18 },
  {
    name: 'rejects administrator credentials',
    change: (items) => { items[0] = identity('kubernetes-admin'); },
    calls: 1, error: /dedicated Jenkins ServiceAccount/,
  },
  {
    name: 'fails when deployment permission is missing',
    change: (items) => { items[4] = { exit: 1, output: 'no' }; },
    calls: 5, error: /Unexpected Kubernetes access: patch/,
  },
  {
    name: 'rejects unexpectedly granted Secret access',
    change: (items) => { items[11] = { exit: 0, output: 'yes' }; },
    calls: 12, error: /Unexpected Kubernetes access: get secrets/,
  },
  {
    name: 'does not treat an API error as an authorization denial',
    change: (items) => { items[11] = { exit: 1, output: 'ServiceUnavailable' }; },
    calls: 12, error: /Unexpected Kubernetes access: get secrets/,
  },
];

for (const scenario of cases) {
  it(`Kubernetes access check ${scenario.name}`, { skip: process.platform !== 'win32' }, (t) => {
    const directory = mkdtempSync(join(tmpdir(), 'decision-wheel-access-'));
    const fixture = join(directory, 'responses.json');
    const kubeconfig = join(directory, 'test.kubeconfig');
    t.after(() => {
      rmSync(fixture, { force: true });
      rmSync(kubeconfig, { force: true });
      rmdirSync(directory);
    });
    const items = responses();
    scenario.change?.(items);
    writeFileSync(fixture, JSON.stringify(items));
    writeFileSync(kubeconfig, 'test fixture only; no credentials');
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', harness], {
      cwd: directory,
      env: {
        ...process.env,
        ACCESS_TEST_SCRIPT: script,
        ACCESS_TEST_FIXTURE: fixture,
        ACCESS_TEST_KUBECONFIG: kubeconfig,
      },
      encoding: 'utf8',
      timeout: 15_000,
    });
    assert.equal(result.status, 0, result.stderr || String(result.error));
    const line = result.stdout.split(/\r?\n/).find((value) => value.startsWith('ACCESS_TEST_RESULT='));
    assert.ok(line, result.stdout);
    const actual = JSON.parse(line.slice('ACCESS_TEST_RESULT='.length));
    assert.equal(actual.calls, scenario.calls, JSON.stringify(actual));
    if (scenario.error) {
      assert.match(actual.failure, scenario.error);
    } else {
      assert.equal(actual.failure, null);
    }
  });
}
