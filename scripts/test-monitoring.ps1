param(
    [string]$Kubectl = 'kubectl.exe',
    [string]$Kubeconfig = (Join-Path $HOME '.kube\decision-wheel-kind-config')
)

$ErrorActionPreference = 'Stop'
$forwards = [Collections.Generic.List[Diagnostics.Process]]::new()
$access = @('--kubeconfig', $Kubeconfig, '--context', 'kind-decision-wheel')

function Start-LocalForward([string]$Namespace, [string]$Service, [int[]]$Ports) {
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = (Get-Command $Kubectl -ErrorAction Stop).Source
    $mappings = ($Ports | ForEach-Object { ":$_" }) -join ' '
    $info.Arguments = "--kubeconfig `"$Kubeconfig`" --context kind-decision-wheel --namespace $Namespace port-forward --address 127.0.0.1 service/$Service $mappings"
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $info
    if (!$process.Start()) { throw 'Could not start a temporary loopback port-forward.' }
    $forwards.Add($process)
    $null = $process.StandardError.ReadToEndAsync()
    $result = @{}
    while ($result.Count -lt $Ports.Count) {
        $line = $process.StandardOutput.ReadLineAsync()
        if (!$line.Wait(15000) -or $null -eq $line.Result) {
            throw 'Temporary port-forward did not become ready.'
        }
        if ($line.Result -match '^Forwarding from 127\.0\.0\.1:(\d+) -> (\d+)$') {
            $result[[int]$Matches[2]] = "http://127.0.0.1:$($Matches[1])"
        }
    }
    return $result
}

function Wait-Until([string]$Description, [scriptblock]$Condition, [int]$Seconds = 120) {
    $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
    do {
        if (& $Condition) { return }
        Start-Sleep -Seconds 5
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "Timed out: $Description"
}

function Get-PrometheusResult([string]$Query) {
    $encoded = [Uri]::EscapeDataString($Query)
    $response = Invoke-RestMethod -Uri "$prometheus/api/v1/query?query=$encoded" -TimeoutSec 10
    if ($response.status -ne 'success') { throw 'Prometheus query failed.' }
    return @($response.data.result)
}

function Get-ActiveWarning {
    $alerts = @(Invoke-RestMethod -Uri "$alertmanager/api/v2/alerts?active=true&silenced=false&inhibited=false" -TimeoutSec 10)
    return @($alerts | Where-Object { $_.labels.alertname -eq 'DecisionWheelRequestErrors' })
}

try {
    & $Kubectl @access --namespace decision-wheel-monitoring rollout status deployment/decision-wheel-monitoring --timeout=180s
    if ($LASTEXITCODE -ne 0) { throw 'Monitoring Deployment is not ready.' }
    $monitoring = Start-LocalForward 'decision-wheel-monitoring' 'decision-wheel-monitoring' @(9090,9093,3000)
    $app = (Start-LocalForward 'decision-wheel' 'decision-wheel' @(80))[3000]
    $prometheus = $monitoring[9090]
    $alertmanager = $monitoring[9093]
    $grafana = $monitoring[3000]
    Wait-Until 'two healthy independent application scrape targets' {
        $targets = Invoke-RestMethod -Uri "$prometheus/api/v1/targets" -TimeoutSec 10
        $appTargets = @($targets.data.activeTargets | Where-Object { $_.labels.job -eq 'decision-wheel' })
        $appTargets.Count -eq 2 -and @($appTargets | Where-Object health -ne 'up').Count -eq 0
    }
    $dashboard = Invoke-RestMethod -Uri "$grafana/api/dashboards/uid/decision-wheel" -TimeoutSec 10
    if ($dashboard.dashboard.uid -ne 'decision-wheel') { throw 'Grafana dashboard was not provisioned.' }
    $adminDenied = $false
    try {
        Invoke-RestMethod -Uri "$grafana/api/admin/stats" -TimeoutSec 10 | Out-Null
    } catch {
        if ($null -eq $_.Exception.Response -or [int]$_.Exception.Response.StatusCode -notin @(401,403)) { throw }
        $_.Exception.Response.Close()
        $adminDenied = $true
    }
    if (!$adminDenied) { throw 'Anonymous access unexpectedly reached the Grafana admin API.' }
    $query = [Uri]::EscapeDataString('sum(up{job="decision-wheel"})')
    $grafanaQuery = Invoke-RestMethod -Uri "$grafana/api/datasources/proxy/uid/decision-wheel-prometheus/api/v1/query?query=$query" -TimeoutSec 10
    if ($grafanaQuery.status -ne 'success' -or $grafanaQuery.data.result[0].value[1] -ne '2') {
        throw 'Grafana cannot query both application targets through its datasource.'
    }
    Invoke-RestMethod -Uri "$app/api/spin" -Method Post -ContentType 'application/json' `
        -Body '{"question":"synthetic monitoring check"}' -TimeoutSec 10 | Out-Null
    Write-Output 'Generating twelve synthetic HTTP 400 responses to exercise the local warning alert.'
    for ($i = 0; $i -lt 12; $i++) {
        try {
            Invoke-WebRequest -UseBasicParsing -Uri "$app/api/spin" -Method Post `
                -ContentType 'application/json' -Body '{}' -TimeoutSec 10 | Out-Null
            throw 'Expected a controlled HTTP 400 response.'
        } catch {
            if ($null -eq $_.Exception.Response -or [int]$_.Exception.Response.StatusCode -ne 400) { throw }
            $_.Exception.Response.Close()
        }
        Start-Sleep -Seconds 1
    }
    Wait-Until 'Prometheus error-burst alert firing' {
        @(Get-PrometheusResult 'ALERTS{alertname="DecisionWheelRequestErrors",alertstate="firing"}').Count -gt 0
    }
    $firedAt = [DateTime]::UtcNow.ToString('o')
    Wait-Until 'Alertmanager receiving the firing alert' { @(Get-ActiveWarning).Count -gt 0 }
    $latency = @(Get-PrometheusResult 'histogram_quantile(0.95, sum by (le) (rate(decision_wheel_http_request_duration_seconds_bucket{job="decision-wheel",route="/api/spin"}[1m])))')
    if ($latency.Count -ne 1 -or $latency[0].value[1] -in @('NaN','+Inf','-Inf')) {
        throw 'API latency measurements are missing or non-finite.'
    }
    $errors = @(Get-PrometheusResult 'sum(decision_wheel_http_errors_total{job="decision-wheel"})')
    if ($errors.Count -ne 1 -or [double]$errors[0].value[1] -lt 12) { throw 'Expected error counter increments.' }
    Write-Output 'Alert fired and reached Alertmanager. Waiting for the error window to clear naturally.'
    Wait-Until 'Prometheus alert resolving after traffic stops' {
        @(Get-PrometheusResult 'ALERTS{alertname="DecisionWheelRequestErrors",alertstate="firing"}').Count -eq 0
    }
    Wait-Until 'Alertmanager clearing the resolved alert' { @(Get-ActiveWarning).Count -eq 0 }
    $health = Invoke-RestMethod -Uri "$app/health" -TimeoutSec 10
    if ($health.status -ne 'ok') { throw 'Application health did not remain OK.' }
    $report = [ordered]@{
        timestamp = [DateTime]::UtcNow.ToString('o')
        healthy_scrape_targets = 2
        grafana_dashboard_provisioned = $true
        grafana_admin_api_denied = $adminDenied
        grafana_datasource_query_succeeded = $true
        synthetic_error_responses = 12
        api_p95_seconds = [double]$latency[0].value[1]
        alert = 'DecisionWheelRequestErrors'
        fired_at = $firedAt
        alertmanager_received = $true
        resolved = $true
        application_healthy_afterward = $true
        notification_scope = 'Local dashboards and Alertmanager UI only; no external notification delivery.'
        monitoring_security = 'Owner-approved temporary exception for third-party monitoring images only; application CI gates unchanged.'
    }
    $root = Split-Path $PSScriptRoot
    New-Item -ItemType Directory -Force -Path (Join-Path $root 'reports') | Out-Null
    $report | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $root 'reports\monitoring-smoke.json') -Encoding UTF8
    Write-Output 'Monitoring, dashboard data, alert firing and recovery verified. Evidence: reports\monitoring-smoke.json'
} finally {
    foreach ($process in $forwards) {
        try {
            if (!$process.HasExited) {
                Stop-Process -Id $process.Id -Force
                $process.WaitForExit()
            }
        } finally {
            $process.Dispose()
        }
    }
}
