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

## Vercel deployment
- Provisioned free Upstash Redis, paid auto-upgrade disabled, Mumbai region.
- Added fenced room transactions, Redis Pub/Sub and cross-instance resume handling.
- 44 unit tests pass; real two-server Redis check passes six core assertions (evidence/cloud-check.json).
- Public deployment verification in progress; API catch-all corrected after first deployment route failure.

- Production verified: https://foyer-cyan.vercel.app, health shared-redis, catalog/help/media/extension all HTTP 200.
- All four browser workflows pass locally and publicly; 10 isolated browser contexts pass public performance targets (see PERFORMANCE.md).
- Local SQLite demo restarted at http://localhost:3001; temporary cloud servers stopped.

## Sync repair and room clarity review

Checklist / plan:
- [x] Manual sync forces position/rate correction, retries blocked playback during the click gesture, and reports pending/success/error states.
- [x] Fetch a current membership-validated snapshot without changing global playback or granting guest control.
- [x] Keep player + chat as the default view; separate Discover and People views; collapse Add a link and secondary help.
- [x] Review source loading, disconnected states, keyboard shortcuts, accessible controls and responsive overflow.
- [x] Add regression coverage for manual sync in direct media and YouTube, including autoplay, modest drift and no command feedback.
- [x] Run unit/protocol, build, extension checks and multi-client browser flows; inspect refreshed screenshots.
- [x] Re-run ten-client benchmarks, document evidence, push main and redeploy the verified version.
Assumptions: manual sync affects only the clicking participant. Existing room controls, provider policies and host permissions remain authoritative. Discovery defaults to playable media, with all sample metadata available through the filter.

Sync review verification:
- Local suite: 46 unit tests / six browser workflows pass, including direct and asynchronous YouTube manual recovery and timeout/offline paths.
- Build, TypeScript and extension package checks pass; real YouTube demo playback succeeds (evidence/sync-review-youtube.json).
- Desktop/mobile screenshots inspected: evidence/room-clear-desktop.png and evidence/room-clear-mobile.png.
- Local ten-client socket p95 6.79 ms, 810 samples. Public deployment verification next.
- Restore now clones checkpoints and advances versions; keyboard shortcuts ignore modifiers/repeat; delayed sync replies cannot re-open an expired/different room.

## Device-check handshake steering

User requested explicit check packets before audio/video start and on manual sync.
- Added three per-device acknowledgement exchanges, server elapsed-clock RTT measurement, four-timestamp clock calibration and source readiness reports.
- Pub/Sub shares checks/reports across function instances; each worker authenticates its own socket against the current shared lease owner.
- Play commits a common future server-time anchor based on measured RTT. Clients hold playback until the deadline. Bounded missing responses become catch-up status.
- Manual sync probes the room, fetches a final authoritative snapshot, then force-corrects only the requester.
- Concurrent timeline/source changes reject old preflight; repeated operation IDs do not trigger a second check. Auto-advance and Play winner now load first, then perform prepared Play.
- Extended companion packet bridging and scheduling, and separated protocol overhead in socket benchmark descriptions.
- Unit/browser/load verification and deployment of this further change in progress.

Protocol final local verification:
- All 51 unit tests / seven browser workflows pass. Initial browser failure was a test timing assumption: a server-controlled checkbox requires waiting for its confirmed snapshot; the test now clicks then waits for checked state.
- Live two-process shared Redis handshake succeeds for every peer; samples are server-measured, socket readiness synthetic.
- Ten-context local browser protocol benchmark passes: delivery p95 83.58ms, application p95 204.89ms, maximum corrected drift 148ms.
- Extension packaging passes; cloud temporary servers stopped; local server remains running.
- Publishing source and final public verification next.

- Public sequential preflight socket run missed target: p95 396.15ms (preserved as protocol-vercel-sequential-socket.json). Optimizing three exchanges to run concurrently, preserving independent timestamps, fastest RTT, and most recent readiness. Rerun pending.

- Concurrent exchange optimization passes 51 unit tests; all seven local workflows verified (one transient screenshot write failure passed on targeted retry). Local optimized socket p95 23.46ms; ten-browser delivery p95 54.38ms, application p95 171.84ms, max drift 151.65ms. Publishing optimization for public rerun.

Final public verification:
- Optimized protocol deployed successfully to https://foyer-cyan.vercel.app. Public protocol checks and all seven public workflows pass.
- Public ten-browser delivery p95 208.89ms; maximum corrected drift 167.12ms. Intentional scheduled-start wait yields application p95 334.47ms, recorded separately.
- Final keyboard test prevents Space on Add a link from triggering Play; known source errors stop automatic retry loops and manual sync cannot claim success on an unavailable source. Both targeted regressions pass locally.
- Unit tests: 51 pass; build/types/extension package pass; live YouTube playback/manual sync pass. Windows extension browser fixture skipped because its runtime cannot start; signed-in subscription playback unverified.
- Source, documentation and raw successes/failures retained. Local demo remains running at port 3001. GitHub main and final Vercel update being completed.

Completed: runtime source da7ab0a is deployed and final public protocol/YouTube regressions pass. GitHub main includes the source and measured evidence; local demo remains at http://localhost:3001. No core blocker remains; extension runtime/subscription verification limits are recorded above.

## Song switching and phone optimization (2026-10-12)
- Reproduced a complete blank page on both participants with a cached YouTube SDK and deferred iframe methods: `unMute is not a function`.
- Volume selection now waits for player readiness; disposed source callbacks are ignored. A stage-scoped error boundary preserves room/chat/source controls on player initialization failures.
- Phone work: explicit playback rows, larger tap targets, readable inputs without iOS focus zoom, safe-area spacing, compact header, responsive music and chat panels. Regression/mobile verification and production update in progress.
- Build/type checks and all 51 unit tests pass. All nine browser workflows pass locally (including the new two-device deferred-SDK song-switch and mobile tests).
- Actual old public deployment reproduced the same failure on its second YouTube revision, after the first decoded/played: evidence/song-switch-vercel-before.json records `unMute is not a function`.
- Mobile screenshot inspection completed. Actual audio playback, manual sync and chat pass in two touch-emulated contexts; all 17 layout checks have no horizontal overflow. Physical phones/Safari are not available for verification.
- Publishing the verified fix and phone layout; live playback verification/redeployment results to follow.
- Runtime c3bdde0 deployed as dpl_7hPtGaJFtkJ8VLobGsPAJsTBvwy2. Live public YouTube first and second revisions play without uncaught errors: the original crash is resolved.
- Found a brief stale timeline display during source loading. Resetting the displayed position/drift immediately on revision change. The live smoke probe now waits for the actual media element to advance, rather than treating the displayed slider as readiness. First post-deployment probe retained as song-switch-vercel-stale-indicator.json; its audio assertion sampled too early.
- Final targeted local and full public verification follows this small source-transition improvement.
