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

## Checks

```powershell
npm run lint
npm test
npx playwright install chromium
npm run test:browser
```

The unit/API tests cover wheel landing positions and question validation.
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

The multi-stage image uses Node.js 26.13.1 on Debian Bookworm slim, installs
only locked production dependencies, and runs as the unprivileged `node` user.
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
unit/integration tests, installs Chromium and runs the browser tests.
After those checks pass, it verifies Docker access and builds a commit-tagged
image. Builds of `main` then publish the image to GitHub Container Registry
(GHCR); builds of other branches skip publishing.
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
After a successful push, `reports/image.txt` is archived with the image tag,
commit and repository digest information. Commit tags provide traceability,
not enforced immutability; digests identify the actual published content.

For the first run, merge the reviewed change to `main` and let the existing
SCM polling trigger start Jenkins. Confirm **Check Docker access**, **Build
Docker image** and **Publish to GHCR** pass. Verify the commit tag under your
GitHub profile's **Packages**. New packages default to private: change this
package's visibility to **Public** if anonymous downloads are required. A
public repository alone does not make its package public.

Deployment, vulnerability scanning and observability are later assignment
steps; publishing an image does not establish that it is vulnerability-free.
