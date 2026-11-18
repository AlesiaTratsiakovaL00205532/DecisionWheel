param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^decision-wheel:sha-[0-9a-f]{40}$')]
    [string]$Image,
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9a-f]{40}$')]
    [string]$SourceCommit,
    [string]$Docker = 'docker',
    [string]$Kind = 'kind',
    [string]$DockerEndpoint = 'npipe:////./pipe/dockerDesktopLinuxEngine',
    [string]$ReportPath = (Join-Path (Get-Location) 'reports\local-image.json')
)

$ErrorActionPreference = 'Stop'
if ($Image -cne "decision-wheel:sha-$SourceCommit") {
    throw 'The local image must match the checked-out source commit.'
}
Get-Command $Docker, $Kind -ErrorAction Stop | Out-Null
$engine = @('--host', $DockerEndpoint)
$metadata = & $Docker @engine image inspect $Image | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or @($metadata).Count -ne 1) { throw 'The tested local image is missing.' }
$metadata = @($metadata)[0]
if ($metadata.Config.Labels.'org.opencontainers.image.revision' -cne $SourceCommit) {
    throw 'The image revision label does not match the source commit.'
}
$previousHost = $env:DOCKER_HOST
$previousProvider = $env:KIND_EXPERIMENTAL_PROVIDER
try {
    $env:DOCKER_HOST = $DockerEndpoint
    $env:KIND_EXPERIMENTAL_PROVIDER = 'docker'
    $preference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $nodes = @(& $Kind get nodes --name decision-wheel 2>$null)
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $preference }
    if ($code -ne 0 -or $nodes.Count -eq 0) { throw 'The existing decision-wheel cluster is unavailable.' }
    foreach ($node in $nodes) {
        if ($node -notmatch '^decision-wheel-(control-plane|worker)[0-9]*$') {
            throw 'Unexpected node name; no image was loaded.'
        }
        $labels = & $Docker @engine container inspect $node --format '{{json .Config.Labels}}' | ConvertFrom-Json
        if ($LASTEXITCODE -ne 0 -or $labels.'io.x-k8s.kind.cluster' -cne 'decision-wheel') {
            throw 'The node does not belong to the isolated decision-wheel cluster.'
        }
    }
    $preference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & $Kind load docker-image $Image --name decision-wheel 2>&1 | Out-Null
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $preference }
    if ($code -ne 0) { throw 'Could not load the tested image into kind.' }
    $currentId = & $Docker @engine image inspect $Image --format '{{.Id}}'
    if ($LASTEXITCODE -ne 0 -or "$currentId".Trim() -cne $metadata.Id) {
        throw 'The image tag changed during loading; deployment is blocked.'
    }
    New-Item -ItemType Directory -Force -Path (Split-Path $ReportPath) | Out-Null
    [ordered]@{
        timestamp = [DateTime]::UtcNow.ToString('o')
        mode = 'local-kind'
        cluster = 'decision-wheel'
        image = $Image
        docker_image_id = $metadata.Id
        source_commit = $SourceCommit
        nodes = $nodes
        registry_published = $false
    } | ConvertTo-Json | Set-Content -LiteralPath $ReportPath -Encoding UTF8
    Write-Output 'Tested image loaded into decision-wheel. No registry publication was attempted.'
} finally {
    $env:DOCKER_HOST = $previousHost
    $env:KIND_EXPERIMENTAL_PROVIDER = $previousProvider
}
