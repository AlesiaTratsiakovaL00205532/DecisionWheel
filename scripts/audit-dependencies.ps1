$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path 'reports' | Out-Null
$reportPath = 'reports\npm-audit.json'

for ($attempt = 1; $attempt -le 2; $attempt++) {
    & npm.cmd audit --include=dev --audit-level=high --registry=https://packagefeedproxy.microsoft.io/npm/ --json |
        Set-Content -Encoding UTF8 -Path $reportPath
    $auditExit = $LASTEXITCODE
    Copy-Item -LiteralPath $reportPath -Destination "reports\npm-audit-attempt-$attempt.json"
    $report = Get-Content -LiteralPath $reportPath -Raw | ConvertFrom-Json

    if ($auditExit -eq 0 -and $null -ne $report.metadata.vulnerabilities) {
        Write-Output 'Dependency audit passed. See reports/npm-audit.json.'
        return
    }
    if ($report.statusCode -ne 429 -and $report.error.code -ne 'E429') {
        throw 'Dependency audit failed (vulnerabilities or audit service error). See reports/npm-audit.json.'
    }
    if ($attempt -eq 2) {
        throw 'Audit registry is still rate-limited after two attempts. See reports/npm-audit.json.'
    }

    $delay = 60
    $retryAfter = [string]@($report.headers.'retry-after')[0]
    if ($retryAfter) {
        $seconds = [long]0
        $retryDate = [DateTimeOffset]::MinValue
        if ([long]::TryParse($retryAfter, [ref]$seconds)) {
            if ($seconds -lt 0) {
                throw 'The audit registry supplied an invalid Retry-After delay.'
            }
            $delay = $seconds
        } elseif ([DateTimeOffset]::TryParse(
            $retryAfter,
            [Globalization.CultureInfo]::InvariantCulture,
            [Globalization.DateTimeStyles]::AllowWhiteSpaces,
            [ref]$retryDate
        )) {
            $delay = [Math]::Max(0, [Math]::Ceiling(($retryDate - [DateTimeOffset]::UtcNow).TotalSeconds))
        } else {
            throw 'The audit registry supplied an invalid Retry-After delay.'
        }
    }
    if ($delay -gt 1200) {
        throw 'The audit registry requested more than 20 minutes before retrying. Retry this build later.'
    }
    Write-Output "Audit registry returned HTTP 429. Waiting $delay seconds before the final attempt."
    Start-Sleep -Seconds ([int]$delay)
}
