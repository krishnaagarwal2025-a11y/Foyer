# Implementation log

## Foyer provider launch work — 12 October 2026

- Rechecked the remote (`origin/main` remains the initial repository commit); commit `c4d1c7b` is pushed to `feat/foyer-streaming-launch`.
- Fixed strict TypeScript errors in the companion extension, validated stored reconnect identities, preserved the external title across host reconnects, and prevented delayed native player events from echoing room corrections as new controls.
- Added provider URL validation tests, a Chromium MV3 fixture workflow, an Audius network smoke command, CI checks and Foyer setup/support documentation.
- A live Audius probe on this date returned a public searchable track and `audio/mpeg` stream HEAD response without an API key. `npm run providers:check` saves a repeatable result in `evidence/providers-live.json`.
- Final provider probe passed on 12 October 2026: search HTTP 200, 11 playable matches, stream HEAD HTTP 200 `audio/mpeg`.
- Latest localhost benchmarks: 810 socket deliveries at 5.40 ms p95; 270 isolated-browser deliveries at 8.77 ms p95; 270 player applications at 29.87 ms p95; 300 post-correction drift samples at 61.34 ms maximum. See `PERFORMANCE.md` and raw reports.
- Final verification: `npm test` (33 tests), `npm run build`, all 3 Playwright application workflows, extension package validation, and live Audius smoke check passed. The extension's Chromium fixture was skipped on this Windows host because its Playwright browser runtime cannot launch; the fixture remains in CI for Linux verification.
- Full signed-in subscription playback, a Chrome Web Store listing and physical-LAN timings require authorized accounts, publisher access and a second network host that are not configured here. Platform adapters remain labeled experimental.
- GitHub confirms the published branch at commit `c4d1c7b`; no Actions run appeared in the repository API after push, so CI status remains unverified here.
- The current implementation checklist and exact unverified items are in `FOYER-PLAN.md`.

- Empty workspace inspected; no parent or local AGENTS.md found.
- Defaults: Node 24 built-in SQLite, Express/Socket.IO, React/Vite; anonymous identities secured by random resume tokens. Host-only playback; optional collaboration. Maximum 32 participants, bounded chat/queue/polls. Local generated MP4, catalog metadata explicitly labeled samples.
- Plan: authoritative protocol and persistence → complete responsive UI → protocol and browser tests → ten-client benchmarks → evidence and evaluator documentation.
- Checklist: rooms/invites; authoritative playback; clock estimation/drift; late join/reconnect/host election; chat/reactions/queue/polls; discovery/preferences; security/resource bounds; local media; tests; latency/player benchmarks; documentation; running demo.

## Verification progress

- 27 unit/socket integration tests passed, including a real ten-socket room.
- Production TypeScript/Vite build passed; npm audit returned zero vulnerabilities after updating test tooling.
- Browser workflows exercised actual play/pause/seek, invite join, typo search, preferences, spoilers/safe text, reactions, queue voting, polls, bookmarks, offline reconnect, explicit host transfer, keyboard/cinema, mobile overflow and automatic host election. A React effect was fixed to explicitly return void after scrolling; this prevented a browser-dependent cleanup crash.
- Desktop/mobile screenshots visually inspected. Compact generated 90-second MP4 reduced to 2.8 MiB for reproducibility on this memory-constrained machine.
- Ten-socket benchmark: 810 deliveries, 5.53 ms p95 on localhost. Ten-player benchmark has a shared-context fallback because isolated contexts exceeded Windows commit budget. Initial complete run: 270 deliveries, 36.36 ms p95; 300 actual currentTime samples, 133.86 ms max drift. Application recorder improved and final rerun in progress; raw initial report retained.
- Initial verification complete: clean `npm ci` (zero vulnerabilities), strict typecheck/production build, **33 unit/socket tests**, **3 browser workflows**, and both final benchmarks passed.
- Latest ten-isolated-context browser run: 270 deliveries (8.77 ms p95), 270 player application samples (29.87 ms p95), 300 independent drift samples (61.34 ms max), no failures or missing samples. Latest ten-socket run: 810 deliveries (5.40 ms p95). Earlier attempts and measured optimization stages retained in evidence.
- Final demo clip: 90 seconds, 320×180, 15 fps, one-second keyframes, approximately 3 MiB. Main desktop/mobile screenshots inspected; latest ten-browser screenshot saved.
- Security review fixed resume-without-code room allocation and added a regression test. A fake-clock host-election test fixture was corrected to distinguish arrival timestamps; engine tie-breaking remains deterministic by ID.
- README, requirements map, performance methodology/conditions/limitations, demo walkthrough and viva notes reflect final implementation. Actual physical LAN and non-Chromium performance remain unverified; repeat instructions included.
- Documented development startup (`npm run dev`) left running at **http://localhost:5173** with API/backend on port 3001. Health endpoint returns OK; catalog endpoint returns 26 entries.

## YouTube and listening follow-up — 12 October 2026

- Discovery moved to the right sidebar; Add a link moved directly under the player. Provider status no longer shrinks the iframe beside it.
- Fixed repeated play/seek during provider buffering and seek-state feedback. YouTube play waits for actual playing/autoplay events, host iframe actions go through room permission checks, and retry recreates the player.
- Listen accepts individual YouTube/YouTube Music songs with the full visible video; music search opens the provider website, then users paste and queue share links. No scraping or audio extraction.
- Build/type checks, 35 unit/protocol tests, four browser workflows, real YouTube smoke playback and refreshed ten-user socket/browser benchmarks passed. Latest browser delivery p95 10.53 ms, application p95 122.44 ms, corrected drift maximum 74.53 ms. Socket delivery p95 6.95 ms. These are localhost results; YouTube smoke playback is separate.
- Production demo is running at http://localhost:3001. Build retries encountered Windows allocation limits; checks were serialized, source maps made opt-in, and the successful build used a 512 MiB Node heap with one Rayon thread.
