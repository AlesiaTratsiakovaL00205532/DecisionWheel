pipeline {
    agent any

    parameters {
        choice(name: 'DELIVERY_TARGET', choices: ['local-kind', 'ghcr'],
            description: 'Local rollout or GHCR publication; these are separate delivery modes.')
    }

    options {
        skipDefaultCheckout(true)
        disableConcurrentBuilds()
        timeout(time: 45, unit: 'MINUTES')
    }

    environment {
        PATH = "C:\\Program Files\\nodejs;${env.PATH}"
        CI = 'true'
        PLAYWRIGHT_JUNIT_OUTPUT_FILE = 'reports/browser.xml'
        DOCKER_CLI = 'C:\\Users\\atratsiakova\\AppData\\Local\\Programs\\DockerDesktop\\resources\\bin\\docker.exe'
        DOCKER_ENDPOINT = 'npipe:////./pipe/dockerDesktopLinuxEngine'
        KUBECTL_CLI = 'C:\\Users\\atratsiakova\\AppData\\Local\\Programs\\DockerDesktop\\resources\\bin\\kubectl.exe'
        KIND_CLI = 'C:\\Users\\atratsiakova\\AppData\\Local\\Microsoft\\WinGet\\Links\\kind.exe'
        TRIVY_IMAGE = 'aquasec/trivy:0.76.2'
    }

    stages {
        stage('Checkout') {
            steps {
                script {
                    def revision = checkout scm
                    if (!revision.GIT_COMMIT || !revision.GIT_BRANCH) {
                        error 'Git checkout did not provide a commit and branch.'
                    }
                    env.GIT_COMMIT = revision.GIT_COMMIT
                    env.GIT_BRANCH = revision.GIT_BRANCH
                    if (!(params.DELIVERY_TARGET in ['local-kind', 'ghcr'])) {
                        error 'Choose a supported delivery target.'
                    }
                    if (params.DELIVERY_TARGET == 'local-kind') {
                        env.IMAGE_NAME = 'decision-wheel'
                    } else {
                        env.IMAGE_NAME = 'ghcr.io/alesiatratsiakoval00205532/decision-wheel'
                    }
                    env.IMAGE_TAG = "sha-${revision.GIT_COMMIT}"
                    echo "Checked out ${env.GIT_BRANCH} at ${env.GIT_COMMIT}"
                    echo "Delivery target: ${params.DELIVERY_TARGET}. Local delivery does not publish to a registry."
                }
                dir('reports') {
                    deleteDir()
                }
                dir('test-results') {
                    deleteDir()
                }
            }
        }

        stage('Install dependencies') {
            steps {
                bat 'node --version'
                bat 'call npm.cmd --version'
                bat 'call npm.cmd ci --no-fund --no-audit'
            }
        }

        stage('Static analysis') {
            steps {
                bat 'call npm.cmd run lint'
            }
        }

        stage('Check Kubernetes access') {
            steps {
                withCredentials([file(
                    credentialsId: 'decision-wheel-kubeconfig',
                    variable: 'KUBECONFIG'
                )]) {
                    powershell '& .\\scripts\\check-kubernetes-access.ps1 -Kubectl $env:KUBECTL_CLI'
                }
            }
        }

        stage('Dependency vulnerability scan') {
            steps {
                powershell '& .\\scripts\\audit-dependencies.ps1'
            }
        }

        stage('Unit and integration tests') {
            steps {
                bat 'call npm.cmd run test:ci'
            }
        }

        stage('Install browser runtime') {
            steps {
                bat 'call npx.cmd playwright install chromium'
            }
        }

        stage('Browser tests') {
            steps {
                bat 'call npm.cmd run test:browser -- --reporter=line,junit'
            }
        }

        stage('Check Docker access') {
            steps {
                powershell '''
                    & $env:DOCKER_CLI --host $env:DOCKER_ENDPOINT version
                    if ($LASTEXITCODE -ne 0) {
                        throw 'Jenkins cannot access the Docker Desktop Linux engine.'
                    }
                '''
            }
        }

        stage('Build Docker image') {
            steps {
                powershell '''
                    $image = '{0}:{1}' -f $env:IMAGE_NAME, $env:IMAGE_TAG
                    & $env:DOCKER_CLI --host $env:DOCKER_ENDPOINT build --pull `
                        --tag $image `
                        --label 'org.opencontainers.image.source=https://github.com/AlesiaTratsiakovaL00205532/DecisionWheel' `
                        --label "org.opencontainers.image.revision=$env:GIT_COMMIT" .
                    if ($LASTEXITCODE -ne 0) {
                        throw 'Docker image build failed.'
                    }
                '''
            }
        }

        stage('Container vulnerability scan') {
            steps {
                powershell '''
                    $ErrorActionPreference = 'Stop'
                    $image = '{0}:{1}' -f $env:IMAGE_NAME, $env:IMAGE_TAG
                    New-Item -ItemType Directory -Force -Path 'reports' | Out-Null
                    $reportDirectory = (Resolve-Path 'reports').Path
                    $archive = Join-Path $reportDirectory 'image-scan.tar'
                    try {
                        & $env:DOCKER_CLI --host $env:DOCKER_ENDPOINT image save --output $archive $image
                        if ($LASTEXITCODE -ne 0) {
                            throw 'Could not export the image for scanning.'
                        }
                        & $env:DOCKER_CLI --host $env:DOCKER_ENDPOINT run --rm `
                            --mount "type=bind,source=$reportDirectory,target=/reports" `
                            --mount 'type=volume,source=decision-wheel-trivy-cache,target=/root/.cache/trivy' `
                            $env:TRIVY_IMAGE image --scanners vuln --offline-scan --disable-telemetry `
                            --timeout 10m --no-progress --format json --output /reports/trivy.json --input /reports/image-scan.tar
                        if ($LASTEXITCODE -ne 0) {
                            throw 'Trivy could not complete the image scan.'
                        }
                        & $env:DOCKER_CLI --host $env:DOCKER_ENDPOINT run --rm `
                            --mount "type=bind,source=$reportDirectory,target=/reports,readonly" `
                            $env:TRIVY_IMAGE convert --scanners vuln --format table --severity HIGH,CRITICAL `
                            --exit-code 1 /reports/trivy.json
                        if ($LASTEXITCODE -ne 0) {
                            throw 'Trivy security gate failed. See reports/trivy.json.'
                        }
                    } finally {
                        if (Test-Path -LiteralPath $archive) {
                            Remove-Item -LiteralPath $archive -Force
                        }
                    }
                '''
            }
        }

        stage('Load local image') {
            when {
                expression {
                    params.DELIVERY_TARGET == 'local-kind' &&
                        (env.GIT_BRANCH == 'origin/main' || env.GIT_BRANCH == 'main')
                }
            }
            steps {
                powershell '''
                    $image = '{0}:{1}' -f $env:IMAGE_NAME, $env:IMAGE_TAG
                    & .\\scripts\\load-local-image.ps1 -Image $image -SourceCommit $env:GIT_COMMIT `
                        -Docker $env:DOCKER_CLI -DockerEndpoint $env:DOCKER_ENDPOINT -Kind $env:KIND_CLI
                    if ($LASTEXITCODE -ne 0) {
                        throw 'Local image loading failed; deployment was not started.'
                    }
                '''
            }
        }

        stage('Deploy locally and verify') {
            when {
                expression {
                    params.DELIVERY_TARGET == 'local-kind' &&
                        (env.GIT_BRANCH == 'origin/main' || env.GIT_BRANCH == 'main')
                }
            }
            steps {
                withCredentials([file(
                    credentialsId: 'decision-wheel-kubeconfig',
                    variable: 'KUBECONFIG'
                )]) {
                    powershell '''
                        $image = '{0}:{1}' -f $env:IMAGE_NAME, $env:IMAGE_TAG
                        & .\\scripts\\deploy-local.ps1 -Image $image -SourceCommit $env:GIT_COMMIT `
                            -Kubectl $env:KUBECTL_CLI
                        if ($LASTEXITCODE -ne 0) {
                            throw 'Local delivery failed. See reports/deployment.json for the recovery outcome.'
                        }
                    '''
                }
            }
        }

        stage('Publish to GHCR') {
            when {
                expression {
                    params.DELIVERY_TARGET == 'ghcr' &&
                        (env.GIT_BRANCH == 'origin/main' || env.GIT_BRANCH == 'main')
                }
            }
            steps {
                withCredentials([usernamePassword(
                    credentialsId: 'ghcr-credentials',
                    usernameVariable: 'GHCR_USERNAME',
                    passwordVariable: 'GHCR_TOKEN'
                )]) {
                    powershell '''
                        $image = '{0}:{1}' -f $env:IMAGE_NAME, $env:IMAGE_TAG
                        $configDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ('decision-wheel-ghcr-' + [guid]::NewGuid().ToString('N'))
                        try {
                            New-Item -ItemType Directory -Path $configDirectory | Out-Null
                            $env:GHCR_TOKEN | & $env:DOCKER_CLI --host $env:DOCKER_ENDPOINT --config $configDirectory `
                                login ghcr.io --username $env:GHCR_USERNAME --password-stdin
                            if ($LASTEXITCODE -ne 0) {
                                throw 'GHCR login failed.'
                            }
                            & $env:DOCKER_CLI --host $env:DOCKER_ENDPOINT --config $configDirectory push $image
                            if ($LASTEXITCODE -ne 0) {
                                throw 'GHCR image push failed.'
                            }
                            $digests = & $env:DOCKER_CLI --host $env:DOCKER_ENDPOINT image inspect $image --format '{{json .RepoDigests}}'
                            if ($LASTEXITCODE -ne 0) {
                                throw 'Could not record the published image digest.'
                            }
                            @("Image: $image", "Commit: $env:GIT_COMMIT", "Repository digests: $digests") |
                                Set-Content -Path 'reports/image.txt'
                        } finally {
                            if (Test-Path -LiteralPath $configDirectory) {
                                Remove-Item -LiteralPath $configDirectory -Recurse -Force
                            }
                        }
                    '''
                }
            }
        }
    }

    post {
        always {
            junit testResults: 'reports/*.xml', allowEmptyResults: true
            archiveArtifacts artifacts: 'reports/*.xml,reports/npm-audit*.json,reports/trivy.json,reports/image.txt,reports/local-image.json,reports/deployment.json,test-results/**', allowEmptyArchive: true
        }
    }
}
