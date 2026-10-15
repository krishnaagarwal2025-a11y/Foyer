# Contributing to Foyer

Use Node.js 24 and npm. Run `npm ci`, then `npm run dev`. The frontend is at http://localhost:5173 and the backend at http://localhost:3001.

Before opening a pull request:

```sh
npm test
npm run build
npx playwright install chromium
npm run test:browser
npm run test:extension
```

For provider or synchronization changes, also run relevant player tests and benchmarks from the [README](README.md). Distinguish controlled SDK fixtures from real-provider playback and socket timing from browser drift.

## Pull requests

Explain the user-visible problem, the change, and how you verified it. Include screenshots for interface changes and reproduction steps for bugs. Keep changes focused and update relevant guides.

Generated screenshots, reports, databases, and work notes stay out of Git. Test and benchmark tooling creates `evidence/`. Keep intentional assets in `docs/assets/` and selected measurements in `docs/benchmarks/`, labeled with their conditions and limitations.

Do not commit environment files, access tokens, personal media, provider credentials, or session data. Add regression coverage for changes to room authority, reconnection, or synchronization.

Use the npm lockfile and preserve third-party notices. Keep provider players and media access within their supported integration boundaries; external accounts are not required for the core local demo.
