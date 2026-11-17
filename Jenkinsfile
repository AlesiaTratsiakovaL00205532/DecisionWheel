pipeline {
    agent any

    options {
        skipDefaultCheckout(true)
        disableConcurrentBuilds()
        timeout(time: 20, unit: 'MINUTES')
    }

    environment {
        PATH = "C:\\Program Files\\nodejs;${env.PATH}"
        CI = 'true'
        PLAYWRIGHT_JUNIT_OUTPUT_FILE = 'reports/browser.xml'
        DOCKER_CLI = 'C:\\Users\\atratsiakova\\AppData\\Local\\Programs\\DockerDesktop\\resources\\bin\\docker.exe'
        DOCKER_ENDPOINT = 'npipe:////./pipe/dockerDesktopLinuxEngine'
        IMAGE_NAME = 'ghcr.io/alesiatratsiakoval00205532/decision-wheel'
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
                script {
                    env.IMAGE_TAG = "sha-${env.GIT_COMMIT}"
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

        stage('Unit and integration tests') {
            steps {
                bat 'call npm.cmd test -- --reporter=default --reporter=junit --outputFile.junit=reports/unit-integration.xml'
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
                    & $env:DOCKER_CLI --host $env:DOCKER_ENDPOINT build `
                        --tag $image `
                        --label 'org.opencontainers.image.source=https://github.com/AlesiaTratsiakovaL00205532/DecisionWheel' `
                        --label "org.opencontainers.image.revision=$env:GIT_COMMIT" .
                    if ($LASTEXITCODE -ne 0) {
                        throw 'Docker image build failed.'
                    }
                '''
            }
        }

        stage('Publish to GHCR') {
            when {
                expression {
                    env.GIT_BRANCH == 'origin/main' || env.GIT_BRANCH == 'main'
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
            archiveArtifacts artifacts: 'reports/*.xml,reports/image.txt,test-results/**', allowEmptyArchive: true
        }
    }
}
