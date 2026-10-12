# Measured performance

Final runs: **12 October 2026, Asia/Calcutta**. Raw JSON retains UTC timestamps. The first table records **localhost/loopback on one machine**. A separate public Vercel run is recorded below; neither is a physical LAN test.

| Measurement | Samples | p50 | p95 | Maximum |
|---|---:|---:|---:|---:|
| Ten socket clients: control delivery | 810 | 5.27 ms | **6.95 ms** | 10.35 ms |
| Ten isolated browsers: control event delivery | 270 | 7.44 ms | **10.53 ms** | 14.24 ms |
| Ten isolated browsers: player state application | 270 | 27.04 ms | **122.44 ms** | 129.74 ms |
| Ten isolated browsers: absolute playback drift after correction | 300 | 42.58 ms | **65.50 ms** | 74.53 ms |

The final run met the ≤250 ms p95 **control delivery** target and the ≤500 ms **corrected drift** target under these conditions. Player-state application also measured below 250 ms p95. This does **not** establish performance on a real LAN, arbitrary media, mobile devices, other browsers or video frame presentation timestamps.

## Conditions

- Windows NT 10.0.26200; Node v24.15.0; AMD Ryzen 5 5500U; 12 logical CPUs; 15.34 GiB reported total memory.
- Compiled Vite frontend and Express/Socket.IO/SQLite server served from `http://127.0.0.1:3001`; one server process, SQLite WAL, real persistence before room broadcast.
- Chromium 156.0.8078.4, headless, **ten separate isolated browser contexts** and ten actual participants in one room. Final normal-mode run used the full room UI, not cinema-only rendering.
- Local generated **90-second 320×180, 15 fps H.264/AAC** MP4, approximately 3 MiB. Keyframe interval: 15 frames (one second); fast-start MP4. No external media host or DRM.
- Exact final media size: 3,168,063 bytes. SHA-256: `5348e60191423e7989f88c0288ea4cc201945fa29f5091f123937ce371256b2a`.
- Browser autoplay explicitly enabled by `--autoplay-policy=no-user-gesture-required`; video elements muted. Background timer/render throttling disabled by the flags listed in the raw report. Browser policy in an ordinary interactive browser may differ.
- No artificial network delay/loss or bandwidth throttling. Other desktop applications were present; actual CPU utilization was not recorded. Windows `os.loadavg()` returns zeros and must not be interpreted as an idle CPU. Final browser report recorded 4.28 GiB free physical memory at completion.

## Method

`npm run benchmark` creates ten real Socket.IO WebSocket connections. After one second and nine warm-up controls, it sends 90 controls (30 play, 30 pause, 30 seek), roughly 70 ms apart. Start is measured on the controller before recipient listener registration and host emission; end is each of the nine recipients' complete state callbacks. Listener setup overhead is included. Both timestamps use **the same Node monotonic clock**, so no cross-machine wall-clock subtraction occurs. 90 × 9 = 810 samples. This measures transport/state propagation, **not video playback**.

`npm run benchmark:browser` creates ten isolated browser contexts, loads the real React application and real HTML5 media, joins a room through its UI, and sends 30 controls after six warm-ups. Each page's monotonic clock is calibrated to the controller's monotonic clock using the midpoint of the fastest of seven Playwright evaluations. The final calibration RTT maximum was **2.19 ms**, giving an approximate midpoint uncertainty of 1.10 ms; network asymmetry is still a limitation.

- **Start:** the host application's actual command-dispatch event, before its socket emit.
- **Delivery end:** the recipient's actual Socket.IO state handler for the corresponding operation ID.
- **Application end:** the first player sample for that operation with sufficient data, no pending seek, the correct playing/paused state, a state version at least as new as that operation, and a timeline within 500 ms of expected. Observations run immediately on state and player readiness events and every 100 ms. This is a player-state criterion, not a measured display-frame timestamp.
- **Drift:** independent sampling of actual `HTMLVideoElement.currentTime` for every participant at least one second after each command, compared with the authoritative anchor plus elapsed estimated server time. The application clock offset comes from its own repeated-ping estimator via read-only telemetry. This yields 30 × 10 = 300 samples. Measurements are point samples after correction, not a claim that transient seek drift always stays below 500 ms.

Delivery and application exclude the sender: 30 × 9 = **270 samples each**, with **zero missing samples and zero recorded failures**. Quantiles use nearest rank on sorted samples. Small negative calibrated time differences would be clamped to zero; the reported distributions are comfortably above the calibration uncertainty.

| Browser control | Recipient samples | Delivery p95 | Application p95 |
|---|---:|---:|---:|
| Play | 90 | 13.98 ms | 33.24 ms |
| Pause | 90 | 10.84 ms | 127.43 ms |
| Seek | 90 | 8.82 ms | 41.84 ms |

The browser test suite separately verifies playing late joins, offline reconnect/resync, correction after deliberately setting a player's currentTime to zero, and recovery after a missing media source. Autoplay failure handling is tested by injecting a rejected play promise and restoring normal play on the user gesture; this verifies the recovery path, not every browser's real autoplay policy. The third-party players and streaming adapters are excluded from these performance figures: provider buffering, iframe event timing and platform policies need their own measurements.

## Reproduce

Start the compiled demo:

```sh
npm ci
npm run build
npm start
```

In another terminal:

```sh
npx playwright install chromium
npm run benchmark
npm run benchmark:browser
```

Outputs: `evidence/socket-benchmark.json` and `evidence/browser-benchmark.json`. Defaults: 10 clients, 90 socket commands, 30 browser commands. Environment overrides: `BENCH_URL`, `DEMO_URL`, `BENCH_CLIENTS`, `BENCH_COMMANDS`, `BROWSER_COMMANDS`. A low-memory fallback is available through `LOW_MEMORY=1`; it uses separate tabs/session identities in a shared context and cinema layout. Its report must not be described as isolated-context testing.

For a real LAN repetition, run the production server on machine A and the benchmark controller on machine B on the same network. On B, in PowerShell:

```powershell
$env:BENCH_URL='http://SERVER_LAN_IP:3001'
$env:DEMO_URL='http://SERVER_LAN_IP:3001'
npm run benchmark
npm run benchmark:browser
```

Record the actual network medium, server/client specifications, competing traffic, browser policies, media, and new results. This uses ten contexts on machine B; ten separate physical viewer devices require additional instrumentation/clock calibration and are not claimed by this script.

## Failures, improvements and evidence

Early concurrent checks and ten isolated contexts exceeded the Windows commit budget despite free physical RAM. This project's watchers were stopped; checks were serialized, Node benchmark heap/semi-space were bounded, and an explicit shared-context fallback was added. That completed fallback report is retained in `evidence/browser-benchmark-shared-context.json` (22.33 ms delivery p95, 64.53 ms application p95, 103.22 ms max drift). The machine later had enough commit available for the final ten-isolated-context run.

Initial reports had incomplete application samples because diagnostics replaced the latest operation marker; the recorder now retains the pending playback operation and requires the appropriate version. Earlier complete runs also measured application p95 around 531–585 ms. The final implementation uses readiness-triggered checks, a cached-source readiness reconciliation, 100 ms fallback correction, a one-second-keyframe local clip and direct read-only clock telemetry. Machine memory conditions improved as well, so gains cannot be attributed to one change alone. Earlier JSON reports are retained with explanatory names and are not the final evidence.

Disconnection grace is 15 seconds; host replacement is deterministic after expiry. Reconnect restores complete authoritative state. Commands are not queued offline; timed-out commands retry once with the same operation ID when connected. Buffering/autoplay/source failures show recovery feedback. See README for full failure handling, resource bounds, and the limited deduplication window.

## Provider playback follow-up

The YouTube repair was verified separately on 12 October 2026: `npm run providers:youtube` loaded and played the official API demo (`M7lc1UVf-VE`), observed 38 matching player-state samples and progression to 5.1 seconds, and retained no error/buffering feedback. `evidence/youtube-live.json` and its screenshot preserve the actual result. The embedded HTML5 video was also observed playing at readyState 4, with decoded size 854×480 and rendered size 808×454. This one-page smoke check used autoplay-enabled Chromium and does not certify every video, account, network, player or multi-user YouTube timing. Four automated browser workflows passed, including a two-context asynchronous YouTube API fixture. The ten-user figures above were refreshed after the playback correction changes using the local MP4; third-party playback remains excluded from those numbers.

## Public Vercel verification

URL: https://foyer-cyan.vercel.app. Ten clients ran on the Windows machine above, connecting over the Internet to the Mumbai function and free Mumbai Upstash database. This is not a physical LAN test. All four browser workflow tests passed against this URL; 44 unit tests pass. Real Redis coordination was separately verified with two explicitly separate local backend processes; public Vercel instance placement cannot be observed by this test.

| Measurement | Samples | p50 | p95 | Maximum |
|---|---:|---:|---:|---:|
| Ten socket clients: control delivery | 810 | 78.29 ms | 105.55 ms | 241.17 ms |
| Ten isolated browser contexts: event delivery | 270 | 49.10 ms | 70.79 ms | 106.60 ms |
| Ten isolated browser contexts: player application | 270 | 67.19 ms | 170.95 ms | 182.49 ms |
| Ten isolated browser contexts: corrected drift | 300 | 60.08 ms | 107.46 ms | 126.65 ms |

Raw evidence: `evidence/vercel-socket-benchmark.json`, `evidence/vercel-browser-benchmark.json`, `evidence/vercel-check.json`, `evidence/cloud-check.json`. No missing browser samples or workflow failures were recorded. Video playback used the included demo MP4 served by Vercel; browser autoplay was allowed and audio muted. Browser throttling was disabled. Clock calibration maximum RTT was 2.70 ms. Windows memory pressure was present during the run; unrelated tool launches exhausted commit memory, but all ten contexts completed and reported actual samples. Windows load average is not a CPU measurement. These results do not establish all-device or third-party-media performance, or verify natural 300-second function rotation. Explicit reconnect and cross-process identity recovery were tested; expired-worker lease/election behavior is covered by cloud unit tests.

Repeat using BENCH_URL or DEMO_URL set to the production URL, with BENCH_REPORT selecting a separate evidence file. The deployment is described in DEPLOYMENT.md.

## Sync and layout review measurements

After the manual-sync fix and sidebar reorganization, all **46 unit tests** and **six local browser workflows** pass. Extension packaging, TypeScript checks and the production build pass. Live YouTube API-demo playback reached 5.24 seconds with readyState 4 (actual provider video, not the fixture); see `evidence/sync-review-youtube.json`. Provider availability varies by title/account/browser.

The ten-client localhost socket run (`evidence/sync-review-local-socket.json`) collected 810 deliveries after nine warm-up controls: p50 **5.35 ms**, p95 **6.79 ms**, maximum **12.79 ms**. This is socket delivery only. Public browser measurements for this revised version are recorded separately after deployment.

## Device-check protocol performance

The handshake-enabled localhost run used 10 isolated Chromium contexts, three acknowledgement exchanges per participant before each Play, the included video, muted audio and permitted autoplay. Background throttling was disabled. All measured controls and 300 drift samples completed without missing data. Intentional common-start waiting is included in player application timing. Conditions otherwise match the machine and clock-calibration methodology above.

| Measurement | Samples | p50 | p95 | Maximum |
|---|---:|---:|---:|---:|
| Socket-only delivery including play preflight | 810 | 5.15 ms | 72.23 ms | 73.47 ms |
| Browser event delivery including play preflight | 270 | 7.84 ms | 83.58 ms | 89.24 ms |
| Browser player application, including scheduled wait | 270 | 120.28 ms | 204.89 ms | 210.98 ms |
| Corrected absolute drift | 300 | 39.37 ms | 54.51 ms | 148.00 ms |

Raw reports: `evidence/protocol-local-socket.json` and `evidence/protocol-local-browser.json`. RTT-based offset assumes symmetric routes; it is an estimate. Loopback is not a physical LAN test. Real Redis coordination was separately verified with two backend processes; that report is protocol-only and uses synthetic readiness. See SYNCHRONIZATION.md for the bounded missing-device policy and scheduled-anchor algorithm. Public deployment results are kept in separate reports.
