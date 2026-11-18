import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../../scripts/audit-dependencies.ps1', import.meta.url));
const clean = { exit: 0, body: { metadata: { vulnerabilities: { high: 0, critical: 0 } } } };
const limited = (retryAfter) => ({
  exit: 1,
  body: { statusCode: 429, headers: retryAfter === undefined ? {} : { 'retry-after': [retryAfter] } },
});
const harness = String.raw`
$ErrorActionPreference = 'Stop'
$global:auditTestState = @{
    responses = (Get-Content -LiteralPath $env:AUDIT_TEST_FIXTURE -Raw | ConvertFrom-Json)
    calls = 0
    waits = @()
}
function npm.cmd {
    if ($global:auditTestState.calls -ge $global:auditTestState.responses.Count) {
        throw 'Unexpected additional audit request.'
    }
    $response = $global:auditTestState.responses[$global:auditTestState.calls]
    $global:auditTestState.calls++
    if ($response.futureDate) {
        $response.body.headers.'retry-after' = @([DateTimeOffset]::UtcNow.AddSeconds(600).ToString('r'))
    }
    $response.body | ConvertTo-Json -Depth 20 -Compress | Write-Output
    $global:LASTEXITCODE = $response.exit
}
function Start-Sleep {
    param([int]$Seconds)
    $global:auditTestState.waits += $Seconds
}
$failure = $null
try { & $env:AUDIT_TEST_SCRIPT } catch { $failure = $_.Exception.Message }
$result = @{ calls = $global:auditTestState.calls; waits = @($global:auditTestState.waits); failure = $failure }
Write-Output ('AUDIT_TEST_RESULT=' + ($result | ConvertTo-Json -Compress))
exit 0
`;

const cases = [
  { name: 'passes a clean audit without retrying', responses: [clean], calls: 1, waits: [] },
  {
    name: 'fails vulnerabilities immediately without retrying',
    responses: [{ exit: 1, body: { metadata: { vulnerabilities: { high: 1, critical: 0 } } } }],
    calls: 1, waits: [], error: /Dependency audit failed/,
  },
  {
    name: 'fails other registry errors without retrying',
    responses: [{ exit: 1, body: { statusCode: 503, error: { code: 'E503' } } }],
    calls: 1, waits: [], error: /Dependency audit failed/,
  },
  {
    name: 'honours Retry-After seconds and passes a successful final attempt',
    responses: [limited('2'), clean], calls: 2, waits: [2],
  },
  {
    name: 'stops after the second rate-limited response',
    responses: [limited('2'), limited('900')], calls: 2, waits: [2], error: /still rate-limited/,
  },
  {
    name: 'honours an HTTP-date Retry-After header',
    responses: [{ ...limited('replaced-by-harness'), futureDate: true }, clean],
    calls: 2, dateWait: true,
  },
  {
    name: 'fails rather than retrying before a delay longer than the wait budget',
    responses: [limited('3600')], calls: 1, waits: [], error: /more than 20 minutes/,
  },
  {
    name: 'uses a bounded default delay when Retry-After is absent',
    responses: [limited(), clean], calls: 2, waits: [60],
  },
  {
    name: 'recognises an npm E429 error without a numeric status code',
    responses: [{ exit: 1, body: { error: { code: 'E429' } } }, clean],
    calls: 2, waits: [60],
  },
  {
    name: 'fails closed when the registry supplies an invalid Retry-After',
    responses: [limited('invalid')], calls: 1, waits: [], error: /invalid Retry-After/,
  },
];

for (const scenario of cases) {
  it(`dependency audit ${scenario.name}`, { skip: process.platform !== 'win32' }, (t) => {
    const directory = mkdtempSync(join(tmpdir(), 'decision-wheel-audit-'));
    const fixture = join(directory, 'responses.json');
    const reports = join(directory, 'reports');
    t.after(() => {
      for (const name of ['npm-audit.json', 'npm-audit-attempt-1.json', 'npm-audit-attempt-2.json']) {
        rmSync(join(reports, name), { force: true });
      }
      if (existsSync(reports)) rmdirSync(reports);
      rmSync(fixture, { force: true });
      rmdirSync(directory);
    });
    writeFileSync(fixture, JSON.stringify(scenario.responses));
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', harness], {
      cwd: directory,
      env: { ...process.env, AUDIT_TEST_SCRIPT: script, AUDIT_TEST_FIXTURE: fixture },
      encoding: 'utf8',
      timeout: 15_000,
    });
    assert.equal(result.status, 0, result.stderr || String(result.error));
    const line = result.stdout.split(/\r?\n/).find((value) => value.startsWith('AUDIT_TEST_RESULT='));
    assert.ok(line, result.stdout);
    const actual = JSON.parse(line.slice('AUDIT_TEST_RESULT='.length));
    assert.equal(actual.calls, scenario.calls, JSON.stringify(actual));
    if (scenario.dateWait) {
      assert.equal(actual.waits.length, 1);
      assert.ok(actual.waits[0] >= 599 && actual.waits[0] <= 600);
    } else {
      assert.deepEqual(actual.waits, scenario.waits);
    }
    if (scenario.error) {
      assert.match(actual.failure, scenario.error);
    } else {
      assert.equal(actual.failure, null);
    }
    for (let attempt = 1; attempt <= scenario.calls; attempt++) {
      assert.ok(existsSync(join(reports, `npm-audit-attempt-${attempt}.json`)));
    }
  });
}
