param(
    [string]$Image = 'decision-wheel:remediation'
)

$ErrorActionPreference = 'Stop'
$cluster = 'decision-wheel'
$kubeconfig = Join-Path $env:USERPROFILE '.kube\decision-wheel-kind-config'

foreach ($tool in @('docker', 'kind', 'kubectl')) {
    Get-Command $tool -ErrorAction Stop | Out-Null
}

$engine = docker info --format '{{.OSType}}'
if ($LASTEXITCODE -ne 0 -or $engine.Trim() -ne 'linux') {
    throw 'Start Docker Desktop with the Linux engine before creating the cluster.'
}
docker image inspect $Image | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "Build or pull the local image first: $Image"
}

$previousProvider = $env:KIND_EXPERIMENTAL_PROVIDER
try {
    $env:KIND_EXPERIMENTAL_PROVIDER = 'docker'
    $clusters = @(kind get clusters)
    if ($LASTEXITCODE -ne 0) {
        throw 'Could not list kind clusters.'
    }
    if ($clusters -notcontains $cluster) {
        if (Test-Path -LiteralPath $kubeconfig) {
            throw "A kubeconfig already exists without the cluster. Review it before proceeding: $kubeconfig"
        }
        New-Item -ItemType Directory -Force -Path (Split-Path $kubeconfig) | Out-Null
        kind create cluster --name $cluster --config (Join-Path $PSScriptRoot 'kind.yaml') --kubeconfig $kubeconfig --wait 180s
        if ($LASTEXITCODE -ne 0) {
            throw 'kind cluster creation failed.'
        }
    }
    if (!(Test-Path -LiteralPath $kubeconfig)) {
        throw "The cluster exists but its private kubeconfig is missing: $kubeconfig"
    }

    $owner = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    icacls $kubeconfig /inheritance:r /grant:r "*${owner}:(F)" '*S-1-5-18:(F)' | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw 'Could not restrict kubeconfig file permissions.'
    }
    foreach ($rule in (Get-Acl -LiteralPath $kubeconfig).Access) {
        $sid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
        if ($sid -notin @($owner, 'S-1-5-18')) {
            icacls $kubeconfig /remove "*$sid" | Out-Null
            if ($LASTEXITCODE -ne 0) {
                throw 'Could not remove an additional kubeconfig access rule.'
            }
        }
    }
    kubectl --kubeconfig $kubeconfig --context "kind-$cluster" wait --for=condition=Ready nodes --all --timeout=180s
    if ($LASTEXITCODE -ne 0) {
        throw 'The cluster is not ready.'
    }
    kind load docker-image $Image --name $cluster
    if ($LASTEXITCODE -ne 0) {
        throw 'Could not load the application image into kind.'
    }
    Write-Output "Cluster ready. Private kubeconfig: $kubeconfig"
} finally {
    $env:KIND_EXPERIMENTAL_PROVIDER = $previousProvider
}
