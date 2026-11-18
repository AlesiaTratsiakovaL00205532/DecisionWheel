param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^decision-wheel:[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$')]
    [string]$Image,
    [ValidatePattern('^[0-9a-f]{40}$')]
    [string]$SourceCommit,
    [string]$Kubeconfig = $env:KUBECONFIG,
    [string]$Kubectl = 'kubectl',
    [ValidateRange(5,300)]
    [int]$RolloutTimeoutSeconds = 120,
    [ValidateRange(5,300)]
    [int]$RollbackTimeoutSeconds = 120,
    [string]$ReportPath = (Join-Path (Get-Location) 'reports\deployment.json')
)

$ErrorActionPreference = 'Stop'
$connection = @('--kubeconfig', $Kubeconfig, '--context', 'jenkins-deployer', '--request-timeout=15s')
$namespace = @('--namespace', 'decision-wheel')
$markerKey = 'decision-wheel.local/deployment-id'
$markerPath = '/spec/template/metadata/annotations/decision-wheel.local~1deployment-id'
$deploymentId = [guid]::NewGuid().ToString('N')
$patchFile = Join-Path ([IO.Path]::GetTempPath()) ("decision-wheel-patch-$deploymentId.json")
$baseline = $null
$attempted = $false
$phase = 'preflight'
$failure = $false
$report = [ordered]@{
    timestamp = [DateTime]::UtcNow.ToString('o')
    mode = 'local-kind'
    registry_published = $false
    source_commit = $SourceCommit
    candidate_image = $Image
    previous_image = $null
    result = 'failed_no_change'
    failure_phase = $null
    recovery = 'not_required'
}

function Get-KubeObject([string[]]$Arguments) {
    $json = & $Kubectl @connection @namespace @Arguments -o json
    if ($LASTEXITCODE -ne 0) { throw 'Kubernetes read or patch failed.' }
    return $json | ConvertFrom-Json
}

function Get-Deployment {
    return Get-KubeObject @('get', 'deployment', 'decision-wheel')
}

function Get-ComparableSpec($Deployment) {
    $spec = $Deployment.spec | ConvertTo-Json -Depth 50 | ConvertFrom-Json
    $spec.template.spec.containers[0].image = 'IMAGE'
    $annotations = $spec.template.metadata.annotations
    if ($null -ne $annotations) {
        $annotations.PSObject.Properties.Remove($markerKey)
        if (@($annotations.PSObject.Properties).Count -eq 0) {
            $spec.template.metadata.PSObject.Properties.Remove('annotations')
        }
    }
    return $spec | ConvertTo-Json -Depth 50 -Compress
}

function Set-DeploymentImage($Current, [string]$Target, [string]$Marker) {
    $operations = [Collections.Generic.List[object]]::new()
    $operations.Add(@{ op = 'test'; path = '/metadata/resourceVersion'; value = $Current.metadata.resourceVersion })
    $operations.Add(@{ op = 'test'; path = '/spec/template/spec/containers/0/name'; value = 'decision-wheel' })
    $operations.Add(@{ op = 'test'; path = '/spec/template/spec/containers/0/image'; value = $Current.spec.template.spec.containers[0].image })
    if ($Marker) {
        if ($null -eq $Current.spec.template.metadata.annotations) {
            $operations.Add(@{ op = 'add'; path = '/spec/template/metadata/annotations'; value = @{} })
        }
        $operations.Add(@{ op = 'add'; path = $markerPath; value = $Marker })
    } elseif ($null -ne $Current.spec.template.metadata.annotations.$markerKey) {
        $operations.Add(@{ op = 'remove'; path = $markerPath })
    }
    $operations.Add(@{ op = 'replace'; path = '/spec/template/spec/containers/0/image'; value = $Target })
    [IO.File]::WriteAllText($patchFile, (ConvertTo-Json -InputObject @($operations.ToArray()) -Depth 20), [Text.UTF8Encoding]::new($false))
    return Get-KubeObject @('patch', 'deployment', 'decision-wheel', '--type=json', '--patch-file', $patchFile)
}

function Wait-Deployment([int]$Seconds) {
    & $Kubectl @connection @namespace rollout status deployment/decision-wheel "--timeout=$($Seconds)s" "--request-timeout=$($Seconds + 15)s"
    if ($LASTEXITCODE -ne 0) { throw 'Kubernetes rollout did not complete.' }
}

function Test-HttpEndpoint([string]$Resource, [int]$TargetPort) {
    $id = [guid]::NewGuid().ToString('N')
    $stdout = Join-Path ([IO.Path]::GetTempPath()) "decision-wheel-forward-$id.out"
    $stderr = Join-Path ([IO.Path]::GetTempPath()) "decision-wheel-forward-$id.err"
    $process = $null
    try {
        $arguments = "--kubeconfig `"$Kubeconfig`" --context jenkins-deployer --namespace decision-wheel --request-timeout=15s port-forward --address 127.0.0.1 $Resource :$TargetPort"
        $process = Start-Process -FilePath $Kubectl -ArgumentList $arguments -NoNewWindow -PassThru `
            -RedirectStandardOutput $stdout -RedirectStandardError $stderr
        $deadline = [DateTime]::UtcNow.AddSeconds(15)
        $port = $null
        do {
            if ($process.HasExited) { throw 'Temporary health forwarding stopped unexpectedly.' }
            if (Test-Path -LiteralPath $stdout) {
                $text = Get-Content -LiteralPath $stdout -Raw
                if ($text -match 'Forwarding from 127\.0\.0\.1:(\d+) -> 3000') { $port = [int]$Matches[1] }
            }
            if (!$port) { Start-Sleep -Milliseconds 200 }
        } while (!$port -and [DateTime]::UtcNow -lt $deadline)
        if (!$port) { throw 'Temporary loopback health forwarding did not become ready.' }
        $uri = "http://127.0.0.1:$port"
        $health = Invoke-RestMethod -Uri "$uri/health" -TimeoutSec 5 -MaximumRedirection 0
        if ($health.status -cne 'ok') { throw 'Application health response is invalid.' }
        $page = Invoke-WebRequest -UseBasicParsing -Uri "$uri/" -TimeoutSec 5 -MaximumRedirection 0
        if ($page.StatusCode -ne 200 -or $page.Headers['Content-Type'] -notmatch 'text/html' -or
            $page.Content -notmatch 'id="question-form"') { throw 'The application page is missing.' }
        $spin = Invoke-RestMethod -Uri "$uri/api/spin" -Method Post -ContentType 'application/json' `
            -Body '{"question":"synthetic deployment health check"}' -TimeoutSec 5 -MaximumRedirection 0
        $answers = @('Yes','No','Maybe','Later')
        if ($spin.index -isnot [int] -or $spin.index -notin @(0,1,2,3) -or $spin.answer -cne $answers[$spin.index]) {
            throw 'The deployed API does not satisfy its response contract.'
        }
    } finally {
        if ($null -ne $process) {
            try {
                if (!$process.HasExited) {
                    Stop-Process -Id $process.Id -Force
                    $process.WaitForExit()
                }
            } finally { $process.Dispose() }
        }
        foreach ($path in @($stdout, $stderr)) {
            if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
        }
    }
}

function Test-Deployment([string]$ExpectedImage, [string]$ExpectedMarker) {
    $current = Get-Deployment
    if ($current.spec.template.spec.containers[0].image -cne $ExpectedImage -or
        [string]$current.spec.template.metadata.annotations.$markerKey -cne $ExpectedMarker) {
        throw 'The Deployment changed concurrently.'
    }
    $podList = Get-KubeObject @('get', 'pods', '--selector=app.kubernetes.io/name=decision-wheel')
    $pods = @($podList.items | Where-Object {
        !$_.metadata.deletionTimestamp -and $_.spec.containers[0].image -ceq $ExpectedImage -and
        [string]$_.metadata.annotations.$markerKey -ceq $ExpectedMarker
    })
    if ($pods.Count -ne $current.spec.replicas -or $pods.Count -eq 0) {
        throw 'Not all expected application replicas are present.'
    }
    foreach ($pod in $pods) {
        if ($pod.status.phase -ne 'Running' -or !$pod.status.containerStatuses[0].ready) {
            throw 'An application replica is not ready.'
        }
        Test-HttpEndpoint "pod/$($pod.metadata.name)" 3000
    }
    Test-HttpEndpoint 'service/decision-wheel' 80
    $after = Get-Deployment
    if ($after.spec.template.spec.containers[0].image -cne $ExpectedImage -or
        [string]$after.spec.template.metadata.annotations.$markerKey -cne $ExpectedMarker -or
        (Get-ComparableSpec $after) -cne (Get-ComparableSpec $current)) {
        throw 'The Deployment changed during HTTP verification.'
    }
}

try {
    if ([string]::IsNullOrWhiteSpace($Kubeconfig) -or !(Test-Path -LiteralPath $Kubeconfig -PathType Leaf)) {
        throw 'Supply the dedicated Jenkins kubeconfig file.'
    }
    if ($SourceCommit -and $Image -cne "decision-wheel:sha-$SourceCommit") {
        throw 'The deployment image does not match the source commit.'
    }
    $identity = & $Kubectl @connection auth whoami -o json | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0 -or $identity.status.userInfo.username -cne 'system:serviceaccount:decision-wheel:jenkins-deployer') {
        throw 'Deployment requires the dedicated Jenkins identity; renew its expiring credential if needed.'
    }
    $baseline = Get-Deployment
    if (@($baseline.spec.template.spec.containers).Count -ne 1 -or
        $baseline.spec.template.spec.containers[0].name -cne 'decision-wheel' -or $baseline.spec.paused) {
        throw 'Unexpected application Deployment shape or paused rollout.'
    }
    $previousImage = $baseline.spec.template.spec.containers[0].image
    $previousMarker = $baseline.spec.template.metadata.annotations.$markerKey
    $report.previous_image = $previousImage
    Wait-Deployment 30
    Test-Deployment $previousImage $previousMarker
    $phase = 'patch'
    $attempted = $true
    $null = Set-DeploymentImage $baseline $Image $deploymentId
    $phase = 'rollout'
    Wait-Deployment $RolloutTimeoutSeconds
    $phase = 'smoke'
    Test-Deployment $Image $deploymentId
    $verified = Get-Deployment
    if ($verified.spec.template.metadata.annotations.$markerKey -cne $deploymentId -or
        $verified.spec.template.spec.containers[0].image -cne $Image -or
        (Get-ComparableSpec $verified) -cne (Get-ComparableSpec $baseline)) {
        throw 'The Deployment changed during verification.'
    }
    $report.result = 'deployed'
    $report.verified_replicas = $verified.spec.replicas
    Write-Output 'Local rollout and per-replica/service HTTP checks passed. No registry publication is claimed.'
} catch {
    $failure = $true
    $report.failure_phase = $phase
    if ($attempted) {
        $report.recovery = 'failed'
        try {
            $current = Get-Deployment
            $currentImage = $current.spec.template.spec.containers[0].image
            $currentMarker = $current.spec.template.metadata.annotations.$markerKey
            $sameSpec = (Get-ComparableSpec $current) -ceq (Get-ComparableSpec $baseline)
            if ($currentMarker -ceq $deploymentId -and $currentImage -ceq $Image -and $sameSpec) {
                $null = Set-DeploymentImage $current $previousImage $previousMarker
                Wait-Deployment $RollbackTimeoutSeconds
                Test-Deployment $previousImage $previousMarker
                $report.result = 'rolled_back'
                $report.recovery = 'verified'
            } elseif ($currentMarker -ceq $previousMarker -and $currentImage -ceq $previousImage -and $sameSpec) {
                $report.recovery = 'not_required'
            } else {
                $report.result = 'failed_concurrent_change'
                $report.recovery = 'skipped_concurrent_change'
            }
        } catch {
            $report.result = 'recovery_failed'
            $report.recovery = 'failed'
        }
    }
    Write-Output "Local deployment failed during $phase. Recovery: $($report.recovery). Build remains failed."
} finally {
    if (Test-Path -LiteralPath $patchFile) { Remove-Item -LiteralPath $patchFile -Force }
    New-Item -ItemType Directory -Force -Path (Split-Path $ReportPath) | Out-Null
    $report | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $ReportPath -Encoding UTF8
}
if ($failure) { exit 1 }
