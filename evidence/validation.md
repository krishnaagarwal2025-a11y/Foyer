# Final validation

Validated on 12 October 2026 (Asia/Calcutta), Windows NT 10.0.26200 / Node v24.15.0.

| Command/check | Actual result |
|---|---|
| `npm ci` | Completed; 191 packages installed, 192 audited; zero vulnerabilities |
| `npm test` | 35 tests passed in 3 files; includes a real 10-socket room |
| `npm run build` | TypeScript strict checks and Vite production build passed |
| `DEMO_URL=http://127.0.0.1:3001 npm run test:browser` (PowerShell environment syntax in README) | All 4 browser workflows passed in 49.4 seconds |
| `npm run benchmark:browser` | Ten separate isolated Chromium contexts; complete 270 delivery/application and 300 drift samples; zero failures |
| `npm run benchmark` | Ten participants, 90 measured commands after warm-up; raw results in socket-benchmark.json |
| Main page visual inspection | Home mobile, room desktop and room mobile PNGs inspected; browser mobile overflow check passed |
| Documented startup | Both `npm run dev` (Vite + backend) and compiled backend serving the production build were started successfully |

Browser workflows cover invite join, invalid codes, host-only playback, actual video play/pause/seek, local mute state, literal HTML chat rendering, spoiler reveal, emoji broadcast, fuzzy title search, group preferences/reasons, live queue/poll voting, bookmarks, stable offline/online identity, explicit host transfer, automatic host election, cinema/keyboard, mobile layout, playing late join, correction after manually injected drift, simulated autoplay rejection/user gesture recovery and unavailable custom-source recovery.

During final unit verification, a host-election fixture gave two participants identical fake timestamps but expected arrival order instead of the documented UUID tie-breaker. The fixture now gives the later participant a later timestamp; the final suite passed. During security review, resume credentials without a code were rejected before allocating a new empty room, and that resource-leak case has a regression test.

The application is left running through `npm start` from the project directory at http://localhost:3001. To stop it, identify the listener process for port 3001; to restart, run `npm start` after stopping the existing instance.

Only Chromium was exercised automatically. Real LAN, other browsers and formal screen-reader auditing are not claimed.

YouTube follow-up: the two-context asynchronous fixture verifies play/pause/seek, correction feedback guards, autoplay recovery, iframe retry, playing rejoin, Music link validation, external song search, queue propagation and the 714-pixel right-side layout. A separate actual YouTube smoke run passed, with 38 application samples, position 5.1 seconds, readyState 4 and decoded/rendered video dimensions recorded in `youtube-live.json`. It is not a YouTube performance benchmark. Latest ten-context local MP4 benchmark: 10.53 ms event p95, 122.44 ms application p95 and 74.53 ms maximum corrected drift; no missing samples or failures.
