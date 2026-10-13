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

Completed song-switch/mobile update:
- Public runtime f956ff7 deployed as dpl_DMaJNh8DL89uL87DPn4w9G3crd3p at https://foyer-cyan.vercel.app; source pushed to GitHub main.
- Actual public YouTube → YouTube → direct audio → YouTube playback and manual sync pass, all media readyState 4, no uncaught errors. Before/after reports and screenshots retained.
- 51 unit tests pass; all nine local workflows passed, plus all three targeted checks after immediate position reset. All nine public workflows verified: eight full-run passes and a successful phone retry after correcting its overly short 5s Internet media-load assertion to 20s. Diagnostics showed network loading without a media error and valid 206 audio/wave responses.
- Mobile evidence records all 17 overflow checks, two touch contexts with audio/chat/manual sync, and visual inspection. Physical phones/Safari remain unverified; performance measurements were not rerun or relabeled as mobile benchmarks.
- Local production demo remains running at http://localhost:3001. Final documentation/evidence push follows; no runtime blocker remains.

## Themes, shared host synchronization and integrated music search (2026-10-13)
Requirements/plan:
- [x] Persist local dark/light preference; redesign controls/cards with modest corners, clear typography, flatter rows and less promotional copy. Reference Apple Music, Spotify and Bandcamp without copying branding.
- [x] Replace guest manual sync with host-only room-wide pause → align → clock/readiness handshake → scheduled automatic resume. Keep all connected participants in the barrier, fail paused when readiness is missing, reject stale/concurrent completion and never claim zero error.
- [x] Search YouTube Music metadata inside Foyer via a public open-source client; click a result to load its link and start through prepared Play. Keep official YouTube playback visible, bounded requests/cache, direct audio/Audius alternatives and honest provider errors.
- [x] Update unit, multi-device, browser, load and live-provider verification; save measured drift, update docs, push main and deploy verified runtime.
Assumptions: theme is per-device; a host sync resumes even if the room was paused, as requested. Waiting is bounded (then stays paused with named unavailable peers) rather than silently dropping unready devices. Guest autoplay recovery remains a separate local “Enable playback” action, not authority to trigger a room sync. “Almost 0ms” is a minimization target, not a guaranteed browser/frame timing property.
- Implemented server-authoritative host pause/alignment barrier, three concurrent timing packets per round, complete membership checks, 80ms reported paused alignment tolerance, future common start, cancellation, stale/duplicate rejection and failed/abandoned barriers that remain paused. Guest local autoplay permission is distinct from host sync.
- Added anonymous metadata-only YouTube.js search with bounded/coalesced requests, server-validated library IDs, click-to-play/queue and no external music-search tab. Live local metadata search returned Finding Her with artist and source IDs.
- Added saved/system light/dark themes, flat album/track layouts, 3px buttons, smaller card radii, neutral copy and mobile headers/forms. Reviewed light desktop/dark phone screenshots; fixed legacy purple play-button specificity.
- Build/types and 57 unit/integration tests pass. Ten socket peers exercise actual app authority/cancellation/readiness (synthetic playback). Browser tests: 10 workflows pass, one old test assumed exactly one handshake round; updating it to allow complete three-packet retry rounds.
- Browser regression found SDK paused-state events could clear a fatal YouTube error. Fatal source readiness is now latched until a player retry/source change; the corrected regression passes.
- Local demo is running at http://localhost:3001. Measuring actual ten-context video/audio pause/handshake/resume drift next, then live provider/deployment verification.
- Actual localhost ten-context host-sync benchmark passes with five video + five audio trials: 100 paused alignment reports at 0ms reported position error; 300 actual estimated playback drift samples p95 70.94ms, max 278.84ms after native one-time resume catch-up. Total pause/check/commit p95 362.06ms is distinct from event delivery and excludes scheduled hold. Original pre-catch-up report retained (p95 drift 152.67ms).
- Real anonymous search + official embedded playback of Finding Her passes locally with 20 returned results, one browser tab, decoded 480×480 video, and host synchronization/automatic resume confirmed. No API key, copied link, media extraction or account used.
- Rechecking final full browser suite after the source-failure latch, readiness-round assertion and native resume catch-up changes. Public deployment/benchmarks and final documentation next.
- Final local checks pass: all 57 unit/integration tests, all 11 browser workflows, production build/types and extension packaging. Actual two-process Redis protocol check passes eight checks; playback readiness there is synthetic. Current ten-client socket benchmark: 810 recipient samples, p50 5.18ms, p95 14.48ms, max 18.07ms (not video synchronization).
- Help page includes the same saved themes and explains host synchronization, local autoplay permission and in-app music search. Publishing verified source to main and Vercel before public provider and ten-browser checks.
- Runtime `076cc98` pushed to main and deployed as `dpl_H6JNCzP5wy4BLdgiQAiob9FyrGE4` at https://foyer-cyan.vercel.app. A transient CLI authorization failure resolved after checking the authenticated identity and retrying.
- Public-target suite: 11/11 checks pass (ten use the public backend; injected search/player test intentionally runs an isolated local app). Real public song search/embed playback and three successive host pause/handshake/resumes pass separately. Earlier sync-feedback and provider-element timeouts retained; their original root cause was not captured. Diagnostic smoke reports now retain UI/state on failure.
- Public ten-player video/audio host-sync benchmark passes: 100 paused API alignment reports 0ms; 300 actual calibrated playhead readings p95 67.31ms/max 88.39ms. Pause/check/commit p95 1141.57ms is separate from delivery and excludes scheduled hold. Public ten-browser normal controls: delivery p95 144.76ms; application p95 315.14ms including shared start hold; max corrected drift 148.98ms; no missing samples/failures. Ten-socket 810-sample p95 103.60ms is explicitly socket-only.
- Final help-theme toggle/persistence check passes. Local demo remains running at port 3001; temporary two-process cloud servers stopped. Documentation and measured evidence finalized; final evidence push follows, with no new runtime change.

## Restore illustrated UI and reduce phone buffering (2026-10-13)
Plan/checklist:
- [x] Restore the earlier home illustration and illustrated catalog covers while retaining saved themes, sharp controls and room layout. These assets were CSS artwork, not downloaded movie posters; existing provider thumbnails remain intact.
- [x] Separate slow-provider startup from autoplay denial, allow 30 seconds, and preserve actual buffering until late playback recovers.
- [x] Give embedded players one stable second after buffering and four seconds between automatic drift seeks. Explicit host seeks bypass the cooldown; strict host sync still waits for readiness/alignment.
- [x] Generate a fast-start 48kbps AAC local audio version, retain WAV compatibility, and use the compressed file by default. Mobile on-demand HLS caps resolution to player size and bounds buffer/memory.
- [ ] Reproduce the old slow-phone failure, verify the recovery regression and full tests, check actual compressed audio on throttled mobile emulation and actual YouTube, then publish to main/Vercel and update measured evidence.
Scope: browser/phone emulation can reproduce Foyer-induced repeated seeks and false permission errors; third-party YouTube connectivity, carrier bandwidth and physical Safari output cannot be guaranteed. No quality setting is forcibly imposed on the official YouTube player.
- Reproduced old public startup failure with a 10s SDK loading fixture: at 8s the app falsely displayed Enable playback (`evidence/phone-buffer-before.txt/png`). The corrected slow-phone test passes, without repeated automatic seeks and with immediate explicit host seeking and successful room sync.
- Compiled/types and 59 unit/integration tests pass. Throttled two-phone actual AAC playback passes with zero post-start waiting events in ten seconds and maximum estimated drift 341.85ms across ten observations. Full app assets load before media throttling; this is not a whole-app startup or WebSocket latency measurement.
- The first whole-suite attempt exhausted Windows commit memory and its local service was interrupted. Restarted the demo as a detached hidden process; isolated browser tests use LOW_MEMORY flags. The completed local suite then passed 12/13 and exposed a native YouTube seek being consumed during a programmatic-transition guard. Fixed by retaining the pending native seek and holding automatic correction until it is reconciled, with elapsed playback accounted for. All four affected YouTube/search checks pass on the final runtime (`phone-update-local-youtube.txt`); all 13 workflows are verified across the full run and targeted regression rerun. Actual startup failure, interrupted runs and regression outcomes are distinguished, rather than claimed as a clean initial suite.
- Final illustrated UI visual review and production deployment/public checks next; prior 10-player latency metrics remain historical until rerun.

## Empty Watch default and provider handshake recovery
- User requested removal of default Watch videos: implemented empty room media, empty player, disabled transport until selected, and optional Discover demo. Listen defaults preserved.
- Added empty-room creation/join/source-selection checks; existing playback fixtures explicitly select their sample. Build and 60 unit/integration tests pass; 16 browser checks running.
- Provider recovery now keeps the local host paused until the matching authoritative barrier arrives and makes repeated paused seek checks idempotent. Deterministic tests reproduce both prior races.

- Runtime 28a6d96 pushed to main and deployed to https://foyer-cyan.vercel.app as dpl_Bnis971ZMHREfhHEaq8RDVkD3B9w. All 16 local browser checks pass and final unit run is 60/60. Public regression checks in progress. New socket benchmark p95 16.60ms; ten-browser reruns crashed before samples, retained honestly. Live provider attempt failed readiness; local deterministic handshake recovery checks pass.

- Final public-target checks 8/8 pass (7 public, 1 isolated injected application). Public slow-HTTP two-phone AAC check records zero post-start waiting events. Final source type-check passes; local and public health return200. Only remote main remains.

## Purple theme and motion polish
- Plan: match create/headline to illustrated purple palette, softer Join hierarchy, light-theme illustration, real join/loading disc and restrained transitions with reduced motion. Implemented; build and targeted browser verification next. Loading adds no artificial delay and does not remount players on navigation.

- Build/type checks and 60 unit/integration tests pass. Desktop/phone theme and disc/navigation checks pass. Existing three multi-client workflows pass. Initial connection overlay exposed a focus race in the automated join test; render the connection loader before the form mounts, then rerun passes (2/2). Retained earlier failed attempt. Screenshots visually inspected; publish and public verification next.

- Purple/motion runtime 7ed4ed9 deployed as dpl_BvHnHaa6RL7ssNX3H7gJNrKVSuPM to https://foyer-cyan.vercel.app. Public visual/loading/empty-Watch checks pass 3/3; screenshots inspected for light/dark desktop and phone plus disc. Health200, local demo remains running. Final evidence saved in evidence/purple-vercel-tests.txt.

## Listening room vinyl
- Replace native audio square with a circular grooved vinyl disc and clipped song-artwork center. Entire disc/artwork rotates with actual playing events and pauses on pause, waiting, ended or error; reduced motion disables spin. No-thumbnail tracks show a music label. Verified mobile native AAC playback with injected artwork metadata (presentation fixture, not a provider availability claim). Build passed; slow-network regression underway.

- Listening-disc runtime b4d1f85 deployed as dpl_B9vpsBvDyCZ85mHGx1JN1txQj9NU. Live browser regression passes: rotating clipped artwork, pause preserves angle, reduced-motion disables rotation. Local slow-HTTP audio regression passes too (2/2 combined). Public health200; evidence saved.

## Distinct room-code characters
- User requested a code font that distinguishes O and 0. Bundle OFL-licensed JetBrains Mono and apply its zero variant to displayed room codes and the invitation-code input, keeping a monospace fallback. Build and desktop/mobile visual check next.
- Font runtime c35a5f5 deployed as dpl_93oCUKcjEwmJ6fWsuzCgD8XL6MfD. Build passes; local invitation input/header zero variant and 320px layout checked. Live font loads successfully with zero feature enabled. Screenshot visually inspected. No external font request required for room codes.

## Headline animation
- Add staggered headline entrance and subtle theme-aware purple shimmer. Preserve accessible heading label and static text for reduced motion. Build and desktop/phone browser check next.
- Headline runtime 7b66a49 deployed as dpl_7H6PBY21CutD512rkDiuwrTsEwUc. Build passes; local shimmer advancement, both themes, 320px fit and reduced-motion checked. Initial probe assumed dark default but OS-selected light; corrected theme selection and rerun passed. Live animation/reduced-motion checks pass; screenshots inspected.

## YouTube Listen artwork layout
- User clarified YouTube Music needs the disc too. Add primary rotating thumbnail disc beside an intact visible official player in Listen mode. Watch layout preserved; phone stacks both. Provider rotation follows actual adapter paused/readiness. Official minimum visible size200x200 documented at https://developers.google.com/youtube/player_parameters. Build and provider regression next.
- YouTube Listen runtime07ce679 deployed as dpl_85VpWzmh9q4yUDArJzgrBJHXs55d. Build and7 targeted browser checks pass (controlled SDK playback fixtures). Live Ek Tarfa search selected a song: real thumbnail loaded inside the circle, separate official iframe visible >=200x200, screenshot inspected. This live smoke validates layout/artwork, not a new timing/availability benchmark.
