param(
    [string]$Kubeconfig = $env:KUBECONFIG,
    [string]$Kubectl = 'kubectl'
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($Kubeconfig) -or !(Test-Path -LiteralPath $Kubeconfig -PathType Leaf)) {
    throw 'Supply the dedicated Jenkins kubeconfig file; administrator/default credentials must not be used.'
}
$connectionArguments = @('--kubeconfig', $Kubeconfig, '--context', 'jenkins-deployer', '--request-timeout=15s')
$identityJson = & $Kubectl @connectionArguments auth whoami -o json
if ($LASTEXITCODE -ne 0) {
    throw 'Kubernetes authentication failed. Check connectivity and renew the expiring Jenkins credential.'
}
$identity = $identityJson | ConvertFrom-Json
if ($identity.status.userInfo.username -ne 'system:serviceaccount:decision-wheel:jenkins-deployer') {
    throw 'The kubeconfig does not authenticate as the dedicated Jenkins ServiceAccount.'
}

function Assert-Access {
    param(
        [string]$Verb,
        [string]$Resource,
        [string]$Namespace = 'decision-wheel',
        [string]$Subresource,
        [switch]$Denied
    )
    $arguments = $connectionArguments + @('auth', 'can-i', $Verb, $Resource, "--namespace=$Namespace")
    if ($Subresource) {
        $arguments += "--subresource=$Subresource"
    }
    $answer = & $Kubectl @arguments
    $code = $LASTEXITCODE
    $expectedAnswer = 'yes'
    $expectedCode = 0
    if ($Denied) {
        $expectedAnswer = 'no'
        $expectedCode = 1
    }
    if ($code -ne $expectedCode -or "$answer".Trim() -ne $expectedAnswer) {
        throw "Unexpected Kubernetes access: $Verb $Resource $Subresource in $Namespace (expected $expectedAnswer)."
    }
    Write-Output "Verified $expectedAnswer : $Verb $Resource $Subresource in $Namespace"
}

Assert-Access get deployments/decision-wheel
Assert-Access list deployments/decision-wheel
Assert-Access watch deployments/decision-wheel
Assert-Access patch deployments/decision-wheel
Assert-Access get services/decision-wheel
Assert-Access get pods
Assert-Access list pods
Assert-Access watch pods
Assert-Access get pods -Subresource portforward
Assert-Access create pods -Subresource portforward
Assert-Access get secrets -Denied
Assert-Access get pods -Namespace default -Denied
Assert-Access patch deployments/other-app -Denied
Assert-Access create rolebindings -Denied
Assert-Access create pods -Subresource exec -Denied

foreach ($resource in @('deployment/decision-wheel', 'service/decision-wheel')) {
    & $Kubectl @connectionArguments --namespace decision-wheel get $resource -o name
    if ($LASTEXITCODE -ne 0) {
        throw "The Jenkins identity could not read $resource."
    }
}
Write-Output 'Kubernetes access check passed. No deployment was changed.'
