$ErrorActionPreference = 'Stop'
$admin = Join-Path $env:USERPROFILE '.kube\decision-wheel-kind-config'
$connectionArguments = @(
    '--kubeconfig', $admin, '--context', 'kind-decision-wheel',
    'config', 'view', '--minify', '--flatten', '--raw'
)
$server = & kubectl @connectionArguments -o 'jsonpath={.clusters[0].cluster.server}'
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($server)) {
    throw 'Could not read the cluster server address.'
}
$certificate = & kubectl @connectionArguments -o 'jsonpath={.clusters[0].cluster.certificate-authority-data}'
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($certificate)) {
    throw 'Could not read the trusted cluster certificate.'
}
$tokenJson = & kubectl --kubeconfig $admin --context kind-decision-wheel --request-timeout=15s `
    --namespace decision-wheel create token jenkins-deployer --duration=2h -o json
if ($LASTEXITCODE -ne 0) {
    throw 'Could not request the Jenkins ServiceAccount token. Apply Terraform first.'
}
$request = $tokenJson | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace($request.status.token) -or !$request.status.expirationTimestamp) {
    throw 'The cluster did not return an expiring token.'
}

$directory = Join-Path $env:USERPROFILE ('.kube\decision-wheel-jenkins-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $directory | Out-Null
$path = Join-Path $directory 'kubeconfig.json'
try {
    $owner = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    icacls $directory /inheritance:r /grant:r "*${owner}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw 'Could not protect the credential directory.'
    }
    foreach ($rule in (Get-Acl -LiteralPath $directory).Access) {
        $sid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
        if ($sid -notin @($owner, 'S-1-5-18')) {
            icacls $directory /remove "*$sid" | Out-Null
            if ($LASTEXITCODE -ne 0) {
                throw 'Could not remove an additional credential directory access rule.'
            }
        }
    }

    $config = @{
        apiVersion = 'v1'
        kind = 'Config'
        clusters = @(@{
            name = 'decision-wheel'
            cluster = @{
                server = $server.Trim()
                'certificate-authority-data' = $certificate.Trim()
            }
        })
        users = @(@{
            name = 'jenkins-deployer'
            user = @{ token = $request.status.token }
        })
        contexts = @(@{
            name = 'jenkins-deployer'
            context = @{
                cluster = 'decision-wheel'
                user = 'jenkins-deployer'
                namespace = 'decision-wheel'
            }
        })
        'current-context' = 'jenkins-deployer'
    }
    $config | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $path -Encoding UTF8
    Write-Output "Jenkins Secret file: $path"
    Write-Output "Token expires: $($request.status.expirationTimestamp)"
} catch {
    if (Test-Path -LiteralPath $path) {
        Remove-Item -LiteralPath $path -Force
    }
    Remove-Item -LiteralPath $directory
    throw
} finally {
    $tokenJson = $null
    $request = $null
    $config = $null
}
