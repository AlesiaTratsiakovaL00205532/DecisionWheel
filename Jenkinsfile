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
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
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
    }

    post {
        always {
            junit testResults: 'reports/*.xml', allowEmptyResults: true
            archiveArtifacts artifacts: 'reports/*.xml,test-results/**', allowEmptyArchive: true
        }
    }
}
