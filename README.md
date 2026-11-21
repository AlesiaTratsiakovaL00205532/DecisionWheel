# DecisionWheel
A webpage with a decision wheel giving answers to your questions and recording them.

## Delivery scope and verified status

The demonstrated delivery platform is local Kubernetes. The working path is:

`GitHub main -> Jenkins checks -> Docker build/scan -> kind image load -> Kubernetes rollout -> HTTP checks`

On 18 November 2026, **Jenkins build #24 finished SUCCESS** for commit `0f0366e028b5b9f0605dbe80235586e9c9224e72`. It passed the quality/security gates and deployed that commit's local image. Both application replicas were subsequently confirmed updated, ready and available. GHCR was intentionally skipped; no successful registry publication or cloud-hosted deployment is claimed.

Prometheus, Grafana and Alertmanager run locally. Alerts are delivered to local UIs only, and the third-party monitoring images have a security exception documented below.

## Run locally

Use Node.js 22 or newer (developed with Node.js 26 LTS).

```powershell
npm ci
npm start
```

Open <http://127.0.0.1:3000>. Stop the server with Ctrl+C. For automatic server restarts during development, use `npm run dev`.

Ask a question of up to 240 characters. The server randomly chooses Yes, No, Maybe or Later, and the wheel spins for approximately five seconds before showing the answer. Each sector has an equal chance; previous answers do not influence later spins.

History stays only in the current page's memory. Refreshing, closing or leaving the page discards it. After the first completed spin, the page requests the browser's standard leave/refresh confirmation. Questions are sent to the answer endpoint for validation but are not saved or logged by the application.

## Application logs

The server writes newline-delimited JSON to standard output, including startup and listen-failure events. Each Express request produces one `http_request` record on completion or interruption. Records contain a UTC timestamp, severity, a server-generated request ID, an allowlisted HTTP method, a fixed route label, response status, duration in milliseconds and completion outcome. The same request ID is returned in `X-Request-ID`; client-supplied IDs are not reused.

Successful requests are `info`, HTTP 4xx/interrupted requests are `warn`, and HTTP 5xx are `error`. Failures use fixed codes such as `bad_request`, `not_found`, `payload_too_large` and `internal_error`, not exception details. Interrupted responses have `status: null` and `error_code: request_aborted` rather than being reported as successful. Health probes are logged too.

The logger does not record questions, answers, raw request/response bodies, headers, cookies, credentials, personal information, IP addresses, raw URLs, query strings, exception messages or stack traces. Only `/health`, `/api/spin` and `/metrics` are named; static assets and unknown paths are labelled `other` to avoid storing personal information embedded in paths. This intentionally trades detailed exception diagnostics for privacy.

View logs in the `npm start` terminal or with `docker logs decision-wheel`. After deploying an image containing this logging change, retrieve both Kubernetes replicas' logs as the local cluster operator:

```powershell
kubectl --kubeconfig "$HOME\.kube\decision-wheel-kind-config" --context kind-decision-wheel --namespace decision-wheel logs --selector=app.kubernetes.io/name=decision-wheel --all-containers=true --since=10m --tail=100
```

Add `--follow` to stream logs. This uses the private operator kubeconfig, not the restricted Jenkins credential, which has no `pods/log` permission. Existing Pods keep their previous logging behaviour until the new image is deployed. Logs are retained by the container runtime; centralized log collection and long-term retention remain separate work. Metrics dashboards and local alerts are described below.

## Application metrics

`GET /metrics` returns Prometheus text-format metrics with caching disabled:

| Metric | Meaning |
| --- | --- |
| `decision_wheel_http_requests_total` | Completed and interrupted requests |
| `decision_wheel_http_errors_total` | HTTP 4xx/5xx responses and interrupted requests |
| `decision_wheel_http_request_duration_seconds` | Latency histogram, including `_bucket`, `_sum` and `_count` |

Latency is a histogram rather than just a counter so Prometheus can calculate request rates, average durations and percentiles. Values use seconds. Labels are limited to allowlisted HTTP methods, fixed routes (`/health`, `/api/spin`, `other`) and HTTP status codes or `aborted`. There are no questions, answers, raw paths/queries, client addresses, headers, request IDs, exception details or personal-data labels. Health probes are included; `/metrics` scrapes are excluded from these measurements to avoid counting the monitoring traffic itself. Scrapes still produce privacy-safe request logs.

Counters and histograms belong to each app process, reset on restart and are scraped independently for both Kubernetes replicas. Prometheus's `rate` and `increase` functions account for counter resets. No application database or question/answer history is collected.

## Checks

```powershell
npm run lint
npm test
npx playwright install chromium
npm run test:browser
```

The unit/API tests cover wheel landing positions, question validation, privacy-preserving request/error logging and metrics, interrupted requests, scrape exclusion and isolated metric registries. They use Node.js's built-in test runner and assertions, with Supertest for the HTTP requests. `npm run test:ci` also writes the Jenkins JUnit report to
`reports/unit-integration.xml`; create `reports` first when running it manually. Browser tests cover spinning, history order, refresh confirmation, failed requests and a mobile layout. Browser tests start and stop their own local server, so port 3000 must be available.

ESLint checks application code, tests and JavaScript configuration files using the recommended rules plus strict equality, `const` preference and no `var`. Node.js and browser globals are scoped to the corresponding files; browser tests have both because their page callbacks execute in the browser. Unused variables and arguments fail lint, except intentionally unused arguments prefixed with `_` (such as Express middleware parameters). Generated reports, coverage and dependencies are excluded. Both lint errors and warnings fail `npm run lint`.

## Run with Docker

With Docker Desktop's Linux engine running, build from the repository root:

```powershell
docker build --tag decision-wheel:local .
docker run --detach --name decision-wheel --publish 127.0.0.1:3001:3000 decision-wheel:local
```

Open <http://127.0.0.1:3001> without authentication. The published port is restricted to this machine, not the local network or internet. The container listens on `0.0.0.0:3000` internally; your ordinary local Node.js server still defaults to `127.0.0.1:3000`.

The multi-stage image uses Node.js 26.13.1 on Alpine 3.24, installs only locked production dependencies, and runs as the unprivileged `node` user. The final runtime removes npm/npx because the application starts directly with Node.js; npm is available only in the dependency-build stage. The runtime also upgrades Alpine's zlib package to pick up its security fix. Jenkins builds with `--pull` to fetch updated base-image layers. Only the dependency manifests and `src`/`public` directories are allowed into the build context. Git history, tests/reports, local dependencies and other root files are excluded; environment files, private-key files and common local artifacts are also excluded within the application directories. Do not put secrets in application source or public assets.

Check the health endpoint and view startup logs:

```powershell
Invoke-RestMethod http://127.0.0.1:3001/health
docker logs decision-wheel
```

Stop and remove this application container when finished:

```powershell
docker stop decision-wheel
docker rm decision-wheel
```

This removes the container, not the image. History remains browser-only and is discarded on refresh. Image publishing and deployment automation are not part of this local Docker step.

## Windows Jenkins pipeline

The root `Jenkinsfile` checks out the configured branch, installs the locked dependencies with `npm ci`, runs the **Static analysis** ESLint stage, checks the restricted Kubernetes identity/access, then audits dependencies, runs unit/integration tests, installs Chromium and runs the browser tests. After those checks pass, it verifies Docker access and builds a commit-tagged image and scans it with Trivy. Only builds of `main` deliver, and only after all tests and both vulnerability gates pass. `DELIVERY_TARGET` explicitly selects one mode: `local-kind` (the default) loads/deploys locally, while `ghcr` attempts registry publication without local deployment. Other branches build/test/scan but do not load, deploy or publish. Non-zero command exit codes fail the build and skip later stages. The final reporting steps still run so available JUnit results and browser failure artifacts can be inspected.

Create a **Pipeline** job using **Pipeline script from SCM**, select Git, set this repository and the branch to build, and use `Jenkinsfile` as the script path. Jenkins needs the **Pipeline**, **Git**, **JUnit** and **Credentials Binding** plugins.

Use a Windows build agent with Git and Node.js installed. The pipeline adds `C:\Program Files\nodejs` to PATH for the existing Windows installation. The Jenkins service account needs permission to write its workspace and browser cache, and network access to npm and the Playwright browser downloads. Chromium is installed for that account, not borrowed from your interactive Windows session. Keep port 3000 free on the agent for the browser-test server.

The pipeline disables concurrent builds of this job and clears only its generated report directories before running, so old results are not published as new ones. It does not use or change the `jenkins1` container. Use trusted repository code only; a dedicated, least-privilege build agent is preferable to running untrusted changes under a privileged Jenkins service account.

A successful local test run is not evidence of a Jenkins build; retain the Jenkins run and its reports separately.

### Vulnerability scans and gates

Vitest/Vite were replaced with Node.js's built-in test runner because their picomatch dependency had no patched release for [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf). The existing unit/API cases and JUnit reporting are preserved. A temporary `minimatch` override selects the patched 11.0.6 release for ESLint's dependency tree; remove it when upstream dependencies select a patched release themselves. The Alpine runtime replaces the affected Debian packages, and removing runtime npm also removes its vulnerable bundled dependencies. The scan thresholds are unchanged; no vulnerabilities are suppressed.

The **Dependency vulnerability scan** runs `npm audit` against `https://packagefeedproxy.microsoft.io/npm/`, including both production and development dependencies. This explicit registry matches the local audit configuration; the current Jenkins agent cannot complete a TLS handshake with the default `registry.npmjs.org` audit endpoint. TLS verification remains enabled. If moving to another environment, use its approved audit-capable registry. The **Container vulnerability scan** checks the built image's operating-system packages and application dependencies with `aquasec/trivy:0.76.2`.

Both gates fail for **high or critical** vulnerabilities, including findings without an available fix. Lower severities remain in the JSON reports but do not block publishing. Audit-service, database-download and scanner errors also fail the build rather than being treated as a clean scan. In Jenkins, download `reports/npm-audit.json` and `reports/trivy.json` from the build artifacts; available reports are retained even when a gate fails. A failed dependency audit stops later stages, so there will be no image report from that run. The audit script makes at most two attempts. Only HTTP 429 triggers a retry: it honours `Retry-After` seconds or an HTTP date, using 60 seconds when the header is absent. Invalid delays fail the build; delays above 20 minutes also fail rather than retrying earlier than requested. The pipeline timeout is 30 minutes to accommodate one wait plus the other stages. Vulnerabilities, other audit failures and a second rate-limited response still fail the build. Each attempt is retained as `reports/npm-audit-attempt-<number>.json`, alongside the latest `reports/npm-audit.json`. This cannot remove the registry's quota; if both attempts are throttled, respect the latest response before rebuilding.

Trivy runs in a disposable container; no Windows Trivy installation is needed. The pipeline exports the local image to a temporary tar file, scans that file without mounting the Docker socket, and removes the tar in `finally`. The full JSON scan is converted into a high/critical console report and exit code without scanning the image a second time. Trivy does not receive GHCR credentials. Dependency-identification API calls and scanner telemetry are disabled; database downloads remain enabled.

Docker Desktop must be able to bind-mount the Jenkins `reports` directory. The named Docker volume `decision-wheel-trivy-cache` retains the vulnerability database between builds. The first run downloads the scanner image and database, so allow additional time and network access to Docker Hub and the Trivy database registries. Upgrade the pinned scanner version deliberately. These checks do not prove the image is free of vulnerabilities.

To run the dependency gate locally:

```powershell
.\scripts\audit-dependencies.ps1
```

### Docker access and optional GHCR credentials

Docker Desktop must be running with its Linux engine available. `DOCKER_CLI` and `DOCKER_ENDPOINT` in the Jenkinsfile match the current Windows installation, including the user-local Docker CLI path. Adjust them if moving to another agent. The Jenkins account must be able to execute that CLI and access the engine's named pipe; an interactive user's successful Docker command does not prove the service account has access. No TCP Docker endpoint or changes to the `jenkins1` container are required.

Local mode does not bind or require `ghcr-credentials`. It records `registry_published: false`; a successful local build does not mean GHCR was fixed. The following credential/publication instructions apply only to explicitly selected `ghcr` delivery.

Create a Jenkins **Username with password** credential with ID `ghcr-credentials`: use your GitHub username and a personal access token **(classic)** with `write:packages` permission. Avoid unnecessary `repo` and `delete:packages` scopes. Never put the token in source, build arguments, screenshots or chat.

The publishing stage binds the credential only while needed and sends the token through `docker login --password-stdin`, not a command-line password. It uses a unique temporary Docker configuration directory and removes it afterward, without modifying an existing Docker login. Jenkins masking helps protect console output but is not a substitute for trusted build code and a least-privilege agent.

Images use the full source commit as a tag:

```text
ghcr.io/alesiatratsiakoval00205532/decision-wheel:sha-<full-git-commit>
```

The source-repository and revision labels identify where the image came from. The checkout stage explicitly records the commit and branch returned by Git; missing metadata fails the build instead of producing a `sha-null` tag. After a successful push, `reports/image.txt` is archived with the image tag, commit and repository digest information. Commit tags provide traceability, not enforced immutability; digests identify the actual published content.

For a GHCR run, select `DELIVERY_TARGET=ghcr` under **Build with Parameters** after merging the reviewed change to `main`. Confirm both vulnerability scans, **Check Docker access**, **Build Docker image** and **Publish to GHCR** pass. Verify the commit tag under your GitHub profile's **Packages**. New packages default to private: change this
package's visibility to **Public** if anonymous downloads are required. A public repository alone does not make its package public.

Local Jenkins deployment is described below; GHCR mode only publishes. Publishing an image does not establish that it is vulnerability-free.

### Automated local delivery and recovery

Bootstrap the existing `decision-wheel` kind cluster and Terraform resources first; the previous Deployment must already have a healthy version to recover to. `KIND_CLI` points to the installed Windows kind executable, alongside the explicit Docker Linux-engine endpoint. The Jenkins service account must be able to execute these tools. Loading images uses its existing, privileged Docker access, not an administrator Kubernetes credential. No cluster is created, deleted or reset by the delivery scripts. The loader temporarily adds the configured Docker executable's directory to its process `PATH`, because kind launches `docker` by name. It restores the original `PATH` afterward; no machine settings or service restart are needed.

After merging, use **Build with Parameters > DELIVERY_TARGET > local-kind**. SCM-triggered builds use the default local mode. Refresh the expiring `decision-wheel-kubeconfig` Secret-file credential before building if needed. Only the existing restricted `jenkins-deployer` identity is accepted; no additional RBAC or Secrets access is granted.

After the existing lint, audit, unit/API/browser and container gates pass:

1. **Load local image** checks the commit tag and OCI revision label, verifies the kind nodes belong to `decision-wheel`, and loads only that image into the existing cluster. Loading failures stop before any Deployment change.
2. **Deploy locally and verify** checks the previous rollout and HTTP behaviour, then atomically patches only the named app image and an owned rollout marker. A new marker forces replacement even when rebuilding the same commit tag. Resource-version tests reject concurrent writes.
3. Rollout monitoring waits up to two minutes. Every new replica, followed by a Service-targeted forward, must return healthy JSON, the app page and a valid response to a fixed synthetic spin. Questions/answers, raw responses, credentials and forwarding diagnostics are not archived.
4. On rollout/smoke failure, the script restores the previous image and marker only if the failed update still belongs to this attempt and the other desired settings have not changed. It verifies the recovered rollout and HTTP behaviour. **The build still fails after recovery.** Recovery failure or a concurrent change is reported for manual action, never hidden or overwritten.

No broad `rollout undo`, default/admin kubeconfig or unrelated resources are used. Each health forward binds to a random loopback port and is stopped in `finally`; user-owned forwards are not killed. Pod replacement can still disconnect a user's existing forward. A Service-targeted port-forward checks the Service mapping and selected Pod, not the in-cluster network dataplane or NetworkPolicy enforcement.

Terraform bootstraps the image through `var.image`; afterward Jenkins owns the image field and `decision-wheel.local/deployment-id` Pod annotation. Terraform ignores only those fields, so a later normal apply does not silently undo delivery. Namespace/RBAC, probes, resource limits, replicas and other security settings remain Terraform-managed. Changing `var.image` does not update an existing Deployment. Keep the previous local image available for recovery.

Jenkins archives `reports\local-image.json` (source commit, Docker image ID, cluster/nodes) and `reports\deployment.json` (candidate/previous image, result, failure phase and recovery outcome). These distinguish a successful rollout, verified rollback, failed recovery and a skipped concurrent update. The total pipeline budget is 45 minutes to leave room for the bounded audit retry, scans and recovery. Abrupt agent loss, process termination, expired credentials or the overall Jenkins timeout can prevent recovery; it is best-effort, not a transactional or zero-downtime guarantee. Inspect the report and cluster manually in those cases.

For a controlled recovery demonstration, use a fresh restricted kubeconfig outside Git and an already tested/scanned local app image:

```powershell
$release = 'decision-wheel:sha-<full-source-commit>'
docker build --file tests\fixtures\unhealthy.Dockerfile --build-arg "APP_IMAGE=$release" --tag decision-wheel:recovery-fixture .
kind load docker-image decision-wheel:recovery-fixture --name decision-wheel
.\scripts\deploy-local.ps1 -Image decision-wheel:recovery-fixture -Kubeconfig 'C:\private\jenkins-kubeconfig.json' -RolloutTimeoutSeconds 20 -ReportPath reports\recovery-drill.json
```

The fixture intentionally returns HTTP 503 without adding dependencies. The expected command result is **exit 1**, report `result: rolled_back`, `recovery: verified`, and the previous image healthy afterward. This is a deliberate failure, not an image for release and not evidence of a Jenkins run. Kubernetes's rolling strategy keeps old ready replicas while the unhealthy one is pending, but monitoring may show the test failure. Do not select the fixture as a normal release or change CI gates for it.

### Optional GHCR publishing: documented limitation

Further GHCR troubleshooting is parked. Local image loading is the chosen, verified delivery route, so registry authentication is not a prerequisite for the local demo. The optional `ghcr` pipeline mode remains available, but is not presented as working or silently allowed to pass on failure.

On 18 November 2026, Jenkins build #18 passed Kubernetes access checks, dependency auditing, application/browser tests, image building and container scanning, but Docker's GHCR login failed with `denied: denied`. No successful image push or package availability has been verified.

A separate diagnostic used the same in-memory classic PAT for both paths: Windows authentication returned HTTP 200 for GitHub account/scope checks, GHCR token requests and authenticated `/v2/`; a disposable container using Docker's configured proxy received HTTP 403 with registry code `DENIED` at GHCR's unscoped `/token` endpoint. Unauthenticated proxy CONNECT and verified TLS connectivity worked. A subsequent Windows-native `regctl` login also reported registry denial, despite a successful anonymous GHCR manifest read. The failure is therefore not isolated to Docker's proxy path. The exact request/authorization difference is unresolved; these results do not prove an administrator policy or a faulty PAT.

Publishing remains unverified and is recorded as a limitation rather than replaced with another untested registry. Build #24 establishes actual end-to-end Jenkins local delivery. The earlier direct-script recovery drill is separate evidence; build #24 did not exercise failure recovery or publish an image.

## Local Kubernetes with kind and Terraform

This Windows lab uses kind 0.33.0, Docker Desktop's Linux engine, kubectl 1.36 and Terraform 1.7 or newer (below 2.0). `infra\kind.yaml` pins a Kubernetes 1.36.4 node image by digest. It creates a separate, single-node `decision-wheel` cluster, not a production/high-availability cluster. The cluster API binds only to `127.0.0.1`; there are no application host-port mappings. No cloud account, GHCR login or changes to `jenkins1` are needed.

Install the missing kind CLI if necessary:

```powershell
winget install --id Kubernetes.kind --exact --version 0.33.0 --source winget
```

From the repository root, build an image and create/load the cluster:

```powershell
docker build --pull --tag decision-wheel:remediation .
.\infra\setup-kind.ps1
```

The script preserves the default kubeconfig and any existing clusters. It writes a dedicated admin kubeconfig to `$HOME\.kube\decision-wheel-kind-config`, restricting its Windows file permissions to the current user and SYSTEM. Never commit or share it, and do not give this admin credential to Jenkins. kind nodes require privileged Docker access; this is a trusted local development environment only.

The configuration also includes the local monitoring stack described below. Its pinned third-party images currently require an explicit, temporary security exception. Only if you accept that documented local-lab risk, add this line to the ignored `infra\terraform.tfvars`, preserving any existing `image` setting:

```hcl
allow_local_monitoring_security_exception = true
```

The default is `false`; Terraform refuses to deploy this monitoring stack without explicit acceptance. This does not bypass application CI gates. Review and apply the resources:

```powershell
terraform -chdir=infra init
terraform -chdir=infra fmt -check
terraform -chdir=infra validate
terraform -chdir=infra plan
terraform -chdir=infra apply
```

Terraform manages a dedicated namespace, service account, two-replica Deployment and ClusterIP Service. The namespace enforces Kubernetes's Restricted Pod Security profile. Application containers run as UID/GID 1000, drop all Linux capabilities, prohibit privilege escalation, use the default seccomp profile and have read-only root filesystems. CPU/memory requests and limits are set. No API token is mounted, and the application service account has no RoleBindings granting Kubernetes resource access.

Startup, readiness and liveness probes call `/health` on port 3000. Startup allows up to about 60 seconds; readiness controls Service endpoints; three consecutive liveness failures trigger a container restart. Rolling updates keep existing ready replicas while replacements start.

To access the app, run this in another terminal and leave it running:

```powershell
kubectl --kubeconfig "$HOME\.kube\decision-wheel-kind-config" --context kind-decision-wheel --namespace decision-wheel port-forward --address 127.0.0.1 service/decision-wheel 3002:80
```

Open <http://127.0.0.1:3002>. Stop forwarding with Ctrl+C; the pods keep running. The app remains unauthenticated by design and is accessible to local users. The Service is internal to Kubernetes, but this is **not** inter-pod network isolation: kind's default CNI does not enforce NetworkPolicy. Enforced network policies would require an appropriate CNI. No such isolation is claimed here.

The app uses `imagePullPolicy: Never`, so only an explicitly loaded local image can run. For initial creation, use a distinct bootstrap tag and pass the same value to setup and Terraform:

```powershell
.\infra\setup-kind.ps1 -Image decision-wheel:my-version
terraform -chdir=infra plan -var="image=decision-wheel:my-version"
terraform -chdir=infra apply -var="image=decision-wheel:my-version"
```

To retain that bootstrap choice for later recreation, put `image = "decision-wheel:my-version"` in the ignored `infra\terraform.tfvars`. Terraform reads it automatically; command-line `-var` values override it. Keep the selected tag consistent with the image loaded into this cluster.

For an existing Deployment, use the gated local Jenkins delivery path; Terraform deliberately leaves its image/rollout marker to Jenkins. Keep the provider lock file in Git. Terraform state, plans, variable files and kubeconfigs are ignored and must remain private. Registry image pulling is not configured; local delivery preloads images instead.

### Prometheus, Grafana and local alerts

`infra\monitoring.tf` provisions a separate `decision-wheel-monitoring` namespace with Prometheus, Grafana and Alertmanager in one lab-only Pod. Images are version- and digest-pinned. The Pod uses Restricted Pod Security, UID/GID 1000, read-only roots, dropped capabilities, resource limits and a ServiceAccount without API permissions or a mounted token. Writable data uses bounded `emptyDir` volumes. Prometheus is configured for six-hour/128 MB retention (the 512 MiB data volume also includes its head/WAL files); Pod replacement loses metric history, Grafana's local database and silences. Configuration and the read-only dashboard are restored from Terraform. This is not a persistent or highly available production monitoring system.

A headless app Service and DNS discovery let Prometheus scrape both replicas every five seconds without Kubernetes API credentials. Not-ready addresses are published so a failing existing Pod can still be detected. Prometheus adds infrastructure target addresses, never client addresses, as `instance`. The Grafana dashboard shows healthy targets, request totals/rates, client/server errors, API p50/p95 latency and firing-alert history.

Open the UIs by leaving this command running in another terminal:

```powershell
kubectl --kubeconfig "$HOME\.kube\decision-wheel-kind-config" --context kind-decision-wheel --namespace decision-wheel-monitoring port-forward --address 127.0.0.1 service/decision-wheel-monitoring 3003:3000 9090:9090 9093:9093
```

Grafana: <http://127.0.0.1:3003/d/decision-wheel>.
Prometheus alerts: <http://127.0.0.1:9090/alerts>.
Alertmanager: <http://127.0.0.1:9093>.
Use another free local port if one is occupied; the dashboard's links assume 9090/9093. Reconnect forwarding after the monitoring Pod is replaced.

Grafana allows anonymous **Viewer-only** access; initial admin creation, basic authentication, the login form and sign-up are disabled. No default admin account/password is created. Dashboards/datasources are provisioned, not editable through this UI. Prometheus and Alertmanager are unauthenticated. All Services are ClusterIP; forwards bind only to loopback. Other Pods can still reach these services: the default kind CNI does not enforce network isolation.

Prometheus evaluates these rules every five seconds:

| Alert | Condition | Pending period |
| --- | --- | --- |
| `DecisionWheelTargetDown` | A target is down, fewer than two are discovered, or all are absent | 30 seconds |
| `DecisionWheelRequestErrors` | At least five HTTP 4xx/5xx errors in a rolling minute | 15 seconds |
| `DecisionWheelHighLatency` | API p95 exceeds 500 ms over two minutes | 1 minute |

Alertmanager receives firing/resolved alerts and displays active alerts. Its `local-ui` receiver intentionally has no email, webhook or chat integration. Visible local alerts are demonstrated; external notification delivery is not implemented or claimed. Error bursts include client validation failures, so they are warnings rather than proof of a server fault. Thresholds are deliberately short for this small local demonstration.

Run the controlled demonstration from the repository root:

```powershell
powershell.exe -NoProfile -File .\scripts\test-monitoring.ps1
```

The script uses its own temporary loopback forwards, checks both scrape targets and Grafana's datasource/dashboard, sends twelve synthetic invalid requests, observes the warning firing in Prometheus and reaching Alertmanager, then waits for natural resolution and checks health. Only its own forwarding processes are stopped. Safe summary evidence is written to ignored `reports\monitoring-smoke.json`. It does not inject a server crash or demonstrate firing the separate target-down/high-latency rules. Start this script only when a controlled warning is appropriate; alert history remains visible afterward.

For a real alert, inspect the fixed route/status metrics, application logs and recent Jenkins changes before another release. Stop synthetic traffic first if running this demonstration. Local delivery can recover a failed rollout/smoke check, but these monitoring alerts do not trigger deployment, rollback or external notifications by themselves.

**Temporary security exception, 18 November 2026:** the owner explicitly approved local-only use of Prometheus 3.16.0, Alertmanager 0.35.0 and Grafana 13.3.1 despite recorded HIGH findings. Prometheus/Alertmanager include `golang.org/x/net` 0.61.0, affected by CVE-2026-78661 (fixed in 0.62.0). Grafana also contains vulnerable bundled Go components, including older stdlib and Tempo dependencies. Stable maintenance releases checked did not resolve the shared finding; checked hardened alternatives required registry access unavailable in this lab. Full local results are retained in ignored `reports\metrics-prometheus-trivy.json`, `reports\metrics-alertmanager-trivy.json` and `reports\metrics-grafana-trivy.json`. The application's dependency and image scans still block HIGH/CRITICAL findings, including unfixed ones; Jenkins thresholds and publishing gates are unchanged. GHCR publication remains independently blocked.

### Restricted Jenkins Kubernetes access

`infra\jenkins-access.tf` creates a separate `jenkins-deployer` ServiceAccount, Role and RoleBinding in `decision-wheel`. It can read/watch/patch only the named DecisionWheel Deployment, get its Service, inspect namespace Pods and open Pod port forwards for HTTP health checks. Both get and create are granted on `pods/portforward` for WebSocket/SPDY clients. It cannot read Secrets, exec into Pods, create RoleBindings or access Pods in other namespaces. The app continues to use its original unprivileged ServiceAccount. Deployment list/watch requests must select `metadata.name=decision-wheel`, as rollout monitoring does; unrestricted Deployment listing is not granted.

These are namespace/RBAC restrictions, not image-field-only authorization: patch access can modify the named Deployment's other fields, and forwarding can reach any Pod port in this dedicated namespace. The Restricted Pod Security policy still applies. Jenkins's existing LocalSystem and Docker privileges are not reduced by this Kubernetes identity.

Apply the Terraform changes using the commands above. Tokens are deliberately not Terraform resources, so this change does not put a Jenkins token in Terraform state. Generate a short-lived credential locally:

```powershell
.\infra\new-jenkins-kubeconfig.ps1
```

The script requests a two-hour token and prints its actual expiry and file location, never the token. It creates a unique directory outside Git under `$HOME\.kube`, restricted to the current user and SYSTEM. The kubeconfig contains the trusted cluster certificate and only the Jenkins identity; TLS verification remains enabled.

In Jenkins, go to **Manage Jenkins > Credentials > System > Global credentials > Add Credentials**. Choose **Secret file**, upload the generated `kubeconfig.json`, and set the ID to `decision-wheel-kubeconfig`. Configure this before merging the pipeline change: a missing credential fails the build.

To check the generated credential locally, substitute its printed path:

```powershell
.\scripts\check-kubernetes-access.ps1 -Kubeconfig 'C:\path\to\kubeconfig.json'
```

The read-only **Check Kubernetes access** stage runs before the dependency audit, so audit throttling or a later GHCR failure does not hide its result. It binds the Secret file for that stage, verifies the exact ServiceAccount identity, required permissions, selected forbidden permissions and actual reads of the Deployment/Service. Connection/authentication errors are failures, not successful denials. It never deploys or changes resources. The later **Deploy locally and verify** stage binds the same credential separately for deployment and recovery.

After uploading and checking the credential, delete only the generated local `kubeconfig.json` and its now-empty directory. Jenkins retains its credential copy. Before expiry, rerun the generator and replace the existing credential's file. Renewal is manual in this local lab; there is no non-expiring token or automatic renewal. Deleting the ServiceAccount revokes its bound tokens.

To remove only this lab, first run `terraform -chdir=infra destroy` with the same image variables if used, then `kind delete cluster --name decision-wheel --kubeconfig "$HOME\.kube\decision-wheel-kind-config"`.

## Evidence

The `evidence` directory contains selected, sanitized console exports, cropped screenshots and local verification summaries. Log headers identify redactions; screenshots are cropped to remove browser chrome and unrelated details. Credential screens and duplicate logs are deliberately omitted.

This evidence includes historical failures as well as the successful local pipeline; early successful builds must not be presented as proof of the later deployment stages.

| Evidence | What it establishes |
| --- | --- |
| [Build #4](evidence/jenkins/build-4.txt) and [failed-test screenshot](evidence/screenshots/jenkins-4-failed-test.png) | A deliberately incorrect test failed Jenkins and stopped later stages. |
| [Build #6](evidence/jenkins/build-6.txt) and [SCM-trigger screenshot](evidence/screenshots/jenkins-6-scm-trigger.png) | An SCM change triggered an earlier successful build; not end-to-end Kubernetes delivery. |
| [Build #16](evidence/jenkins/build-16.txt) | A real HTTP 429 audit response caused a bounded 902-second wait, then a successful audit retry; the overall build later failed at GHCR. |
| [Build #18](evidence/jenkins/build-18.txt) | Restricted Kubernetes checks and the quality/security gates passed, but GHCR login was denied. |
| [Build #21](evidence/jenkins/build-21.txt), [#22](evidence/jenkins/build-22.txt), [#23](evidence/jenkins/build-23.txt) | Authentication, image-name scoping and kind/Docker discovery failures were exposed before deployment and subsequently addressed. |
| [Build #24](evidence/jenkins/build-24.txt) | The merged local pipeline passed all 62 unit/API/script cases and 13 browser cases, loaded the scanned image, completed rollout/HTTP checks and finished SUCCESS. |

Build #24 screenshots show its [successful status and artifact list](evidence/screenshots/jenkins-24-status-artifacts.png), [75 passing tests](evidence/screenshots/jenkins-24-tests.png) (62 unit/API/script plus 13 browser cases), and a [partial stage view](evidence/screenshots/jenkins-24-stages-partial.png). The stage screenshot cuts off the final deployment stages; the console export records their successful completion.

The downloaded build #24 artifacts are retained as reviewed copies:

| Artifact | Recorded result |
| --- | --- |
| [Deployment report](evidence/jenkins/build-24/deployment.json) | Commit `0f0366e028b5b9f0605dbe80235586e9c9224e72` deployed locally; two replicas verified, no recovery required and no registry publication. |
| [Local image report](evidence/jenkins/build-24/local-image.json) | The same commit-tagged image loaded into the isolated kind cluster, with its Docker image ID recorded. |
| [Dependency audit](evidence/jenkins/build-24/npm-audit.json) | Zero reported dependency vulnerabilities. |
| [Container scan](evidence/jenkins/build-24/trivy.json) | Trivy 0.76.2 report for the matching image tag/revision, with zero reported vulnerabilities. |
| [Unit/API/script JUnit](evidence/jenkins/build-24/unit-integration.xml) and [browser JUnit](evidence/jenkins/build-24/browser.xml) | 62 and 13 passing cases respectively, with no failures or skipped cases. |

JUnit copies redact the agent hostname and absolute workspace prefixes; the Trivy copy redacts package-maintainer email addresses. Test outcomes, image/commit metadata and scan findings are unchanged.

Reviewed snapshots of separate local checks are also retained:

| Evidence | What it establishes |
| --- | --- |
| [Logging summary](evidence/checks/kubernetes-logging-smoke.json) | Privacy-safe logs verified on both replicas during an earlier manual rollout. |
| [API request/error log screenshot](evidence/screenshots/application-request-error-logs.png) | Successful `POST /api/spin` requests at `info`/200 and rejected requests at `warn`/400 with `bad_request`. The displayed records contain no questions, answers or credentials. |
| [Monitoring summary](evidence/checks/monitoring-smoke.json) | Two healthy scrape targets, a dashboard query, error alert firing, Alertmanager receipt and natural resolution. |
| [Final recovery report](evidence/checks/recovery-drill-final-validation.json) and [earlier drill summary](evidence/checks/recovery-drill-summary.json) | A deliberately failed rollout restored the previous healthy version; the earlier summary also records delivery exit code 1. |

Monitoring screenshots provide additional UI evidence:

| Screenshot | What is visible |
| --- | --- |
| [Prometheus targets](evidence/screenshots/prometheus-two-healthy-targets.png) | Both application scrape targets are UP (2/2). Addresses are lab Pod endpoints, not client addresses. |
| [Grafana dashboard](evidence/screenshots/grafana-dashboard.png) | Two healthy targets, request/error rates, latency and an alert count of one at capture time. |
| [Prometheus alert rules](evidence/screenshots/prometheus-alert-rules-inactive.png) | All three configured rules are inactive at this later capture. This is not a screenshot of a firing alert. |
| [Error alert pending](evidence/screenshots/prometheus-request-errors-pending.png) | `DecisionWheelRequestErrors` is PENDING during its configured waiting period. |
| [Error alert firing](evidence/screenshots/prometheus-request-errors-firing.png) | The same rule is FIRING with warning severity. |
| [Alertmanager receipt](evidence/screenshots/alertmanager-request-errors-received.png) | The `local-ui` receiver displays the named error alert. No external notification delivery is claimed. |
| [Error alert resolved](evidence/screenshots/prometheus-request-errors-resolved.png) | The later Prometheus capture shows the rule inactive again after the error burst. |

The alert sequence now has visual evidence of pending, firing, local Alertmanager receipt and subsequent Prometheus resolution.
