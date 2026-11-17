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
npm test
npx playwright install chromium
npm run test:browser
```

The unit/API tests cover wheel landing positions and question validation.
Browser tests cover spinning, history order, refresh confirmation, failed
requests and a mobile layout. Browser tests start and stop their own local
server, so port 3000 must be available.

## Windows Jenkins pipeline

The root `Jenkinsfile` checks out the configured branch, installs the locked
dependencies with `npm ci`, runs unit/integration tests, installs Chromium and
runs the browser tests. Non-zero command exit codes fail the build and skip
later stages. The final reporting steps still run so available JUnit results
and browser failure artifacts can be inspected.

Create a **Pipeline** job using **Pipeline script from SCM**, select Git, set
this repository and the branch to build, and use `Jenkinsfile` as the script
path. Jenkins needs the **Pipeline**, **Git** and **JUnit** plugins.

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

Containers, deployment and observability will be added in later assignment
tasks. A successful local test run is not evidence of a Jenkins build; retain
the first Jenkins run and its reports separately.
