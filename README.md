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
Maybe or Later, and the wheel spins for approximately four seconds before
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

This is the application foundation; CI/CD, containers, deployment and
observability will be added in later assignment tasks.
