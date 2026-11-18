# DecisionWheel
A webpage with a decision wheel giving answers to your questions and recording them

## Run locally

Use Node.js 22 or newer (developed with Node.js 26 LTS).

```powershell
npm ci
npm start
```

Open <http://127.0.0.1:3000>. Stop the server with Ctrl+C.
For automatic server restarts during development, use `npm run dev`.

Ask a question of up to 240 characters. The server randomly chooses Yes, No,
Maybe or Later, and the wheel spins for approximately five seconds before
showing the answer. Reduced-motion preferences shorten the animation.
Each sector has an equal chance; previous answers do not influence later spins.

History stays only in the current page's memory. Refreshing, closing or leaving
the page discards it. After the first completed spin, the page requests the
browser's standard leave/refresh confirmation. Browsers control the wording and
whether it appears; some mobile browsers may not show it. Questions are sent to
the answer endpoint for validation but are not saved or logged by the application.

## Application logs

The server writes newline-delimited JSON to standard output, including startup
and listen-failure events. Each Express request produces one `http_request`
record on completion or interruption. Records contain a UTC timestamp,
severity, a server-generated request ID, an allowlisted HTTP method, a fixed
route label, response status, duration in milliseconds and completion outcome.
The same request ID is returned in `X-Request-ID`; client-supplied IDs are
not reused.

Successful requests are `info`, HTTP 4xx/interrupted requests are `warn`,
and HTTP 5xx are `error`. Failures use fixed codes such as `bad_request`,
`not_found`, `payload_too_large` and `internal_error`, not exception details.
Interrupted responses have `status: null` and `error_code: request_aborted`
rather than being reported as successful. Health probes are logged too.

The logger does not record questions, answers, raw request/response bodies,
headers, cookies, credentials, personal information, IP addresses, raw URLs,
query strings, exception messages or stack traces. Only `/health` and
`/api/spin` are named; static assets and unknown paths are labelled `other`
to avoid storing personal information embedded in paths. This intentionally
trades detailed exception diagnostics for privacy.

View logs in the `npm start` terminal or with `docker logs decision-wheel`.
After deploying an image containing this logging change, retrieve both
Kubernetes replicas' logs as the local cluster operator:

```powershell
kubectl --kubeconfig "$HOME\.kube\decision-wheel-kind-config" --context kind-decision-wheel --namespace decision-wheel logs --selector=app.kubernetes.io/name=decision-wheel --all-containers=true --since=10m --tail=100
```

Add `--follow` to stream logs. This uses the private operator kubeconfig, not
the restricted Jenkins credential, which has no `pods/log` permission.
Existing Pods keep their previous logging behaviour until the new image is
deployed. Logs are retained by the container runtime; centralized collection,
retention policies, dashboards and alerts are separate observability steps.

## Checks

```powershell
npm run lint
npm test
npx playwright install chromium
npm run test:browser
```

The unit/API tests cover wheel landing positions, question validation and
privacy-preserving request/error logging.
They use Node.js's built-in test runner and assertions, with Supertest for the
HTTP requests. `npm run test:ci` also writes the Jenkins JUnit report to
`reports/unit-integration.xml`; create `reports` first when running it manually.
Browser tests cover spinning, history order, refresh confirmation, failed
requests and a mobile layout. Browser tests start and stop their own local
server, so port 3000 must be available.

ESLint checks application code, tests and JavaScript configuration files using
the recommended rules plus strict equality, `const` preference and no `var`.
Node.js and browser globals are scoped to the corresponding files; browser
tests have both because their page callbacks execute in the browser. Unused
variables and arguments fail lint, except intentionally unused arguments
prefixed with `_` (such as Express middleware parameters). Generated reports,
coverage and dependencies are excluded. Both lint errors and warnings fail
`npm run lint`.

## Run with Docker

With Docker Desktop's Linux engine running, build from the repository root:

```powershell
docker build --tag decision-wheel:local .
docker run --detach --name decision-wheel --publish 127.0.0.1:3001:3000 decision-wheel:local
```

Open <http://127.0.0.1:3001> without authentication. The published port is
restricted to this machine, not the local network or internet. The container
listens on `0.0.0.0:3000` internally; your ordinary local Node.js server still
defaults to `127.0.0.1:3000`.

The multi-stage image uses Node.js 26.13.1 on Alpine 3.24, installs
only locked production dependencies, and runs as the unprivileged `node` user.
The final runtime removes npm/npx because the application starts directly with
Node.js; npm is available only in the dependency-build stage. The runtime
also upgrades Alpine's zlib package to pick up its security fix. Jenkins builds
with `--pull` to fetch updated base-image layers.
Only the dependency manifests and `src`/`public` directories are allowed into
the build context. Git history, tests/reports, local dependencies and other
root files are excluded; environment files, private-key files and common local
artifacts are also excluded within the application directories.
Do not put secrets in application source or public assets.

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

This removes the container, not the image. History remains browser-only and
is discarded on refresh. Image publishing and deployment automation are not
part of this local Docker step.

## Windows Jenkins pipeline

The root `Jenkinsfile` checks out the configured branch, installs the locked
dependencies with `npm ci`, runs the **Static analysis** ESLint stage, then
audits dependencies, runs unit/integration tests, installs Chromium and runs
the browser tests.
After those checks pass, it verifies Docker access and builds a commit-tagged
image and scans it with Trivy. Builds of `main` publish the image to GitHub
Container Registry (GHCR) only after both vulnerability gates pass; builds
of other branches skip publishing.
Non-zero command exit codes fail the build and skip
later stages. The final reporting steps still run so available JUnit results
and browser failure artifacts can be inspected.

Create a **Pipeline** job using **Pipeline script from SCM**, select Git, set
this repository and the branch to build, and use `Jenkinsfile` as the script
path. Jenkins needs the **Pipeline**, **Git**, **JUnit** and **Credentials
Binding** plugins.

Use a Windows build agent with Git and Node.js installed. The pipeline adds
`C:\Program Files\nodejs` to PATH for the existing Windows installation.
The Jenkins service account needs permission to write its workspace and
browser cache, and network access to npm and the Playwright browser downloads.
Chromium is installed for that account, not borrowed from your interactive
Windows session. Keep port 3000 free on the agent for the browser-test server.

The pipeline disables concurrent builds of this job and clears only its
generated report directories before running, so old results are not published
as new ones. It does not use or change the `jenkins1` container. Use trusted
repository code only; a dedicated, least-privilege build agent is preferable
to running untrusted changes under a privileged Jenkins service account.

A successful local test run is not evidence of a Jenkins build; retain the
Jenkins run and its reports separately.

### Vulnerability scans and gates

Vitest/Vite were replaced with Node.js's built-in test runner because their
picomatch dependency had no patched release for
[GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf).
The existing unit/API cases and JUnit reporting are preserved. A temporary
`minimatch` override selects the patched 11.0.6 release for ESLint's dependency
tree; remove it when upstream dependencies select a patched release themselves.
The Alpine runtime replaces the affected Debian packages, and removing runtime
npm also removes its vulnerable bundled dependencies. The scan thresholds are
unchanged; no vulnerabilities are suppressed.

The **Dependency vulnerability scan** runs `npm audit` against
`https://packagefeedproxy.microsoft.io/npm/`, including both production and
development dependencies. This explicit registry matches the local audit
configuration; the current Jenkins agent cannot complete a TLS handshake
with the default `registry.npmjs.org` audit endpoint. TLS verification remains
enabled. If moving to another environment, use its approved audit-capable
registry. The
**Container vulnerability scan** checks the built image's operating-system
packages and application dependencies with `aquasec/trivy:0.76.2`.

Both gates fail for **high or critical** vulnerabilities, including findings
without an available fix. Lower severities remain in the JSON reports but do
not block publishing. Audit-service, database-download and scanner errors also
fail the build rather than being treated as a clean scan. In Jenkins, download
`reports/npm-audit.json` and `reports/trivy.json` from the build artifacts;
available reports are retained even when a gate fails. A failed dependency
audit stops later stages, so there will be no image report from that run.
The audit script makes at most two attempts. Only HTTP 429 triggers a retry:
it honours `Retry-After` seconds or an HTTP date, using 60 seconds when the
header is absent. Invalid delays fail the build; delays above 20 minutes
also fail rather than retrying earlier than requested. The pipeline timeout
is 30 minutes to accommodate one wait plus the other stages. Vulnerabilities,
other audit failures and a second rate-limited response still fail the build.
Each attempt is retained as `reports/npm-audit-attempt-<number>.json`, alongside
the latest `reports/npm-audit.json`. This cannot remove the registry's quota;
if both attempts are throttled, respect the latest response before rebuilding.

Trivy runs in a disposable container; no Windows Trivy installation is needed.
The pipeline exports the local image to a temporary tar file, scans that file
without mounting the Docker socket, and removes the tar in `finally`.
The full JSON scan is converted into a high/critical console report and exit
code without scanning the image a second time. Trivy does not receive GHCR
credentials. Dependency-identification API calls and scanner telemetry are
disabled; database downloads remain enabled.

Docker Desktop must be able to bind-mount the Jenkins `reports` directory.
The named Docker volume `decision-wheel-trivy-cache` retains the vulnerability
database between builds. The first run downloads the scanner image and
database, so allow additional time and network access to Docker Hub and the
Trivy database registries. Upgrade the pinned scanner version deliberately.
These checks do not prove the image is free of vulnerabilities.

To run the dependency gate locally:

```powershell
.\scripts\audit-dependencies.ps1
```

### Docker access and GHCR credentials

Docker Desktop must be running with its Linux engine available. `DOCKER_CLI`
and `DOCKER_ENDPOINT` in the Jenkinsfile match the current Windows installation,
including the user-local Docker CLI path. Adjust them if moving to another
agent. The Jenkins account must be able to execute that CLI and access the
engine's named pipe; an interactive user's successful Docker command does not
prove the service account has access. No TCP Docker endpoint or changes to
the `jenkins1` container are required.

Create a Jenkins **Username with password** credential with ID
`ghcr-credentials`: use your GitHub username and a personal access token
**(classic)** with `write:packages` permission. Avoid unnecessary `repo` and
`delete:packages` scopes. Never put the token in source, build arguments,
screenshots or chat.

The publishing stage binds the credential only while needed and sends the
token through `docker login --password-stdin`, not a command-line password.
It uses a unique temporary Docker configuration directory and removes it
afterward, without modifying an existing Docker login. Jenkins masking helps
protect console output but is not a substitute for trusted build code and a
least-privilege agent.

Images use the full source commit as a tag:

```text
ghcr.io/alesiatratsiakoval00205532/decision-wheel:sha-<full-git-commit>
```

The source-repository and revision labels identify where the image came from.
The checkout stage explicitly records the commit and branch returned by Git;
missing metadata fails the build instead of producing a `sha-null` tag.
After a successful push, `reports/image.txt` is archived with the image tag,
commit and repository digest information. Commit tags provide traceability,
not enforced immutability; digests identify the actual published content.

For the first run, merge the reviewed change to `main` and let the existing
SCM polling trigger start Jenkins. Confirm both vulnerability scans, **Check
Docker access**, **Build Docker image** and **Publish to GHCR** pass. Verify
the commit tag under your GitHub profile's **Packages**. New packages default
to private: change this
package's visibility to **Public** if anonymous downloads are required. A
public repository alone does not make its package public.

Automated Jenkins deployment and observability are later assignment steps;
publishing an image does not establish that it is vulnerability-free.

### Current publishing blocker

On 18 November 2026, Jenkins build #18 passed Kubernetes access checks,
dependency auditing, application/browser tests, image building and container
scanning, but Docker's GHCR login failed with `denied: denied`.
No successful image push or package availability has been verified.

A separate diagnostic used the same in-memory classic PAT for both paths:
Windows authentication returned HTTP 200 for GitHub account/scope checks,
GHCR token requests and authenticated `/v2/`; a disposable container using
Docker's configured proxy received HTTP 403 with registry code `DENIED` at
GHCR's unscoped `/token` endpoint. Unauthenticated proxy CONNECT and verified
TLS connectivity worked. A subsequent Windows-native `regctl` login also
reported registry denial, despite a successful anonymous GHCR manifest read.
The failure is therefore not isolated to Docker's proxy path. The exact
request/authorization difference is unresolved; these results do not prove
an administrator policy or a faulty PAT.

Publishing remains blocked; further authentication experiments are parked
while independent assignment work continues.
Do not disable TLS, bypass access controls or restart shared Docker workloads.
Local builds, scans and the isolated kind deployment can support further
assignment work, but are not evidence of registry publication or a successful
end-to-end delivery pipeline.

## Local Kubernetes with kind and Terraform

This Windows lab uses kind 0.33.0, Docker Desktop's Linux engine, kubectl 1.36
and Terraform 1.7 or newer (below 2.0). `infra\kind.yaml` pins a Kubernetes
1.36.4 node image by digest. It creates a separate, single-node
`decision-wheel` cluster, not a production/high-availability cluster.
The cluster API binds only to `127.0.0.1`; there are no application host-port
mappings. No cloud account, GHCR login or changes to `jenkins1` are needed.

Install the missing kind CLI if necessary:

```powershell
winget install --id Kubernetes.kind --exact --version 0.33.0 --source winget
```

From the repository root, build an image and create/load the cluster:

```powershell
docker build --pull --tag decision-wheel:remediation .
.\infra\setup-kind.ps1
```

The script preserves the default kubeconfig and any existing clusters.
It writes a dedicated admin kubeconfig to
`$HOME\.kube\decision-wheel-kind-config`, restricting its Windows file
permissions to the current user and SYSTEM. Never commit or share it, and do
not give this admin credential to Jenkins. kind nodes require privileged Docker
access; this is a trusted local development environment only.

Review and apply the application resources:

```powershell
terraform -chdir=infra init
terraform -chdir=infra fmt -check
terraform -chdir=infra validate
terraform -chdir=infra plan
terraform -chdir=infra apply
```

Terraform manages a dedicated namespace, service account, two-replica
Deployment and ClusterIP Service. The namespace enforces Kubernetes's
Restricted Pod Security profile. Application containers run as UID/GID 1000,
drop all Linux capabilities, prohibit privilege escalation, use the default
seccomp profile and have read-only root filesystems. CPU/memory requests and
limits are set. No API token is mounted, and the application service account
has no RoleBindings granting Kubernetes resource access.

Startup, readiness and liveness probes call `/health` on port 3000.
Startup allows up to about 60 seconds; readiness controls Service endpoints;
three consecutive liveness failures trigger a container restart. Rolling
updates keep existing ready replicas while replacements start.

To access the app, run this in another terminal and leave it running:

```powershell
kubectl --kubeconfig "$HOME\.kube\decision-wheel-kind-config" --context kind-decision-wheel --namespace decision-wheel port-forward --address 127.0.0.1 service/decision-wheel 3002:80
```

Open <http://127.0.0.1:3002>. Stop forwarding with Ctrl+C; the pods keep running.
The app remains unauthenticated by design and is accessible to local users.
The Service is internal to Kubernetes, but this is **not** inter-pod network
isolation: kind's default CNI does not enforce NetworkPolicy. Enforced network
policies would require an appropriate CNI. No such isolation is claimed here.

The initial image uses `imagePullPolicy: Never`, so only an explicitly loaded
local image can run. For a different image, use a distinct tag and pass the
same value to setup and Terraform:

```powershell
.\infra\setup-kind.ps1 -Image decision-wheel:my-version
terraform -chdir=infra plan -var="image=decision-wheel:my-version"
terraform -chdir=infra apply -var="image=decision-wheel:my-version"
```

To retain that choice for later plans, put
`image = "decision-wheel:my-version"` in the ignored `infra\terraform.tfvars`.
Terraform reads it automatically; command-line `-var` values override it.
Keep the selected tag consistent with the image loaded into this cluster.

Keep the provider lock file in Git. Terraform state, plans, variable files and
kubeconfigs are ignored and must remain private. Automated rollout/recovery
and registry image pulling will be connected in a later step.

### Restricted Jenkins Kubernetes access

`infra\jenkins-access.tf` creates a separate `jenkins-deployer` ServiceAccount,
Role and RoleBinding in `decision-wheel`. It can read/watch/patch only the
named DecisionWheel Deployment, get its Service, inspect namespace Pods and
open Pod port forwards for HTTP health checks. Both get and create are granted
on `pods/portforward` for WebSocket/SPDY clients. It cannot read Secrets, exec
into Pods, create RoleBindings or access Pods in other namespaces. The app
continues to use its original unprivileged ServiceAccount.
Deployment list/watch requests must select `metadata.name=decision-wheel`,
as rollout monitoring does; unrestricted Deployment listing is not granted.

These are namespace/RBAC restrictions, not image-field-only authorization:
patch access can modify the named Deployment's other fields, and forwarding
can reach any Pod port in this dedicated namespace. The Restricted Pod
Security policy still applies. Jenkins's existing LocalSystem and Docker
privileges are not reduced by this Kubernetes identity.

Apply the Terraform changes using the commands above. Tokens are deliberately
not Terraform resources, so this change does not put a Jenkins token in
Terraform state. Generate a short-lived credential locally:

```powershell
.\infra\new-jenkins-kubeconfig.ps1
```

The script requests a two-hour token and prints its actual expiry and file
location, never the token. It creates a unique directory outside Git under
`$HOME\.kube`, restricted to the current user and SYSTEM. The kubeconfig
contains the trusted cluster certificate and only the Jenkins identity;
TLS verification remains enabled. Do not upload the admin kubeconfig.

In Jenkins, go to **Manage Jenkins > Credentials > System > Global
credentials > Add Credentials**. Choose **Secret file**, upload the generated
`kubeconfig.json`, and set the ID to `decision-wheel-kubeconfig`. Configure
this before merging the pipeline change: a missing credential fails the build.

To check the generated credential locally, substitute its printed path:

```powershell
.\scripts\check-kubernetes-access.ps1 -Kubeconfig 'C:\path\to\kubeconfig.json'
```

The read-only **Check Kubernetes access** stage runs before the dependency
audit, so audit throttling or a later GHCR failure does not hide its result.
It binds the Secret file only for that stage, verifies the exact
ServiceAccount identity, required permissions, selected forbidden permissions
and actual reads of the Deployment/Service. Connection/authentication errors
are failures, not successful denials. It never deploys or changes resources.
Do not archive or print kubeconfigs or place them in the repository.

After uploading and checking the credential, delete only the generated local
`kubeconfig.json` and its now-empty directory. Jenkins retains its credential
copy. Before expiry, rerun the generator and replace the existing credential's
file. Renewal is manual in this local lab; there is no non-expiring token or
automatic renewal. Deleting the ServiceAccount revokes its bound tokens.

To remove only this lab, first run `terraform -chdir=infra destroy` with the
same image variables if used, then
`kind delete cluster --name decision-wheel --kubeconfig "$HOME\.kube\decision-wheel-kind-config"`.
Do not delete unrelated Docker containers or clusters.
