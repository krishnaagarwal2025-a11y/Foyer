# Foyer

**Watch. Listen. Belong.** Foyer brings friends into an invite-only room with synchronized video, a dedicated listening mode, a shared queue, live chat, reactions and polls. People join with a display name; there is no Foyer account, paid service, API key or streaming subscription requirement for the local demo.

## Run Foyer locally

Requires Node.js **24.15+** and npm. From the project directory:

```powershell
npm ci
npm run dev
```

Open <http://localhost:5173>. This command launches the frontend and backend together. Create a room, copy the six-character code or invitation, and open it in another browser profile/device to join. The generated local MP4 and original audio sample work without an external media service.

To build and run the single-origin production-style demo:

```powershell
npm run build
npm start
```

Open <http://localhost:3001>. For a local-network demonstration, run the production-style server on a machine reachable by your viewers and use `http://SERVER_LAN_IP:3001` from each device. Allow port 3001 in the local firewall. The public demo is https://foyer-cyan.vercel.app. See DEPLOYMENT.md for the Vercel WebSocket and shared Redis deployment; local startup remains a single-process SQLite deployment.

## Watch video and external services

- **Local files served by Foyer:** the bundled test short is an actual 90-second MP4. Original 60-second demo music is included too.
- **YouTube:** paste a YouTube watch, Shorts, live, or short link. Playback uses Google's visible IFrame Player API. Video availability, embedding permission, region and autoplay policy remain controlled by YouTube. The player stays visible and retains its controls and advertising; Foyer does not extract audio or alter playback advertisements.
- **Vimeo and SoundCloud:** links use their official embed/player interfaces. Owners can restrict embedding, so a particular link may not be playable in Foyer.
- **Direct media and on-demand HLS:** enter an HTTP(S) direct `.mp4`, `.webm` or `.ogv` video; `.mp3`, `.m4a`, `.aac`, `.wav`, `.flac`, `.ogg`, `.oga` or `.opus` audio; or compatible on-demand `.m3u8`. Codecs, cross-origin headers, access and browser support still apply. Live HLS is not synchronized.
- **Netflix, Prime Video, and Hotstar/JioHotstar:** the Foyer Companion browser extension connects play, pause, seek, room chat, reactions and host transfer on the provider's own site. Every participant must have their own working access and open the same title. It does not embed or relay those streams. Player discovery, ad behavior, regional title URLs and page changes make these adapters **experimental**; see the verification limits below.

For YouTube and other embeddable links, all viewers use the Foyer room player. For Netflix, Prime Video, and Hotstar, viewers open the service title in separate tabs and use the extension on each viewing tab. Do not share account credentials with Foyer.

### Install Foyer Companion for testing

Build the extension with `npm run build` (or `npm run build:extension`). From the room's external-service player screen, download **Foyer Companion**, extract the ZIP, and load the extracted folder in Chrome or Edge:

1. Open `chrome://extensions` or `edge://extensions`, enable **Developer mode**, and choose **Load unpacked**.
2. Select the extracted `foyer-extension` folder. Chrome and Edge ask for access to the named service sites that host the player.
3. Open a Netflix watch, Prime Video title, or Hotstar/JioHotstar title you can already watch. Open the extension popup, enter the Foyer server origin, and click **Allow server + this site**. The browser asks for permission to that Foyer server; the service tab access is limited to the supported streaming sites.
4. Reload the title page and open the **Foyer** panel. Create a room or enter its code. The host can bind the current title; each other viewer opens that same title in their own signed-in tab and joins the room.

The included ZIP is a developer-install package; Foyer has not been published to the Chrome Web Store. Chrome's documented distribution rules require a Web Store listing for normal end-user installation outside managed environments. For the initial build there is no Web Store publisher authorization configured for store distribution.

The extension reads the service page's title URL and document title and controls an accessible HTML video element when the service exposes one. It never reads login forms, cookies, credentials, protected stream URLs or DRM keys. Ad and buffering behavior is not modified. A host can pause for an ad (or choose the manual fallback) and resume when everyone's player is ready. Some protected player releases may reject control or make the player inaccessible; the panel explains the failure, and the viewer can still use the service's normal controls. Browser tests cover the extension loading and secure setup panel on a service-shaped test page, **not** subscription playback on personal accounts.

## Listen to music

Create a **Listen** room or have the host switch an existing room to Listen. Open **Discover**, enter a song or artist, and choose **Search music**. Results appear inside Foyer. The host clicks **Play** to load the selected link and start the room automatically; participants can queue results. No YouTube Music tab or copied share link is needed. Metadata-only search uses the open-source [YouTube.js client](https://github.com/LuanRT/YouTube.js); playback stays in the official visible YouTube player. The client never retrieves/deciphers media streams or user cookies. Embedding and regional restrictions still apply, and the unofficial metadata endpoint can change or become unavailable. Manual links remain an optional fallback. Audius offers independent tracks; SoundCloud and direct audio sources remain supported.

These integrations do not provide blanket access to every commercial recording. YouTube controls its source availability, [Audius](https://docs.audius.co/developers/introduction/overview/) contains artist-published music, and [Navidrome](https://github.com/navidrome/navidrome) serves a **private, self-hosted collection you supply**. Navidrome credentials remain on the server. A separate library code protects searches; signed tickets authorize streaming from that library.

Optional environment variables (copy `.env.example` to review the names; the app does not auto-load `.env`):

```text
NAVIDROME_URL=http://127.0.0.1:4533
NAVIDROME_USER=your-library-user
NAVIDROME_PASSWORD=keep-this-server-side
NAVIDROME_ACCESS_CODE=make-a-long-random-code
AUDIUS_API_KEY=optional-provider-key
```

Add these only to the **server's** private environment. Never put them in a `VITE_` variable, browser bundle, Git commit or shared room. Use HTTPS for a remotely reachable Navidrome instance. `npm run providers:check` repeats a live Audius search/stream smoke test; it needs internet and writes its actual result to `evidence/providers-live.json`. If Audius is unavailable, use the included local song or your own Navidrome/SoundCloud/direct audio source.

Provider details: [YouTube IFrame Player](https://developers.google.com/youtube/iframe_api_reference), [YouTube API policies](https://developers.google.com/youtube/terms/developer-policies-guide), [Vimeo Player SDK](https://developer.vimeo.com/player/sdk), [SoundCloud Widget API](https://developers.soundcloud.com/docs/api/html5-widget), [Audius API](https://docs.audius.co/developers/introduction/overview/).

## Room features

Participants choose a display name and generated avatar. The room offers a host-controlled shared timeline, a reconnect indicator, diagnostics and host-only **Sync room**, searchable sample discovery with filters and explainable group preferences, shared playlists with voting, live chat with individually revealed spoilers, floating emoji reactions, group polls, host transfer, timestamp bookmarks and an optional cinema layout with keyboard shortcuts. A lost connection retains identity through a 15-second grace period; a deterministic connected-participant election replaces an absent host afterward. Roles and command payloads are checked on the server.

## Checks and measured results

```powershell
npm test
npm run build
npm run test:browser
npm run test:extension
npm run providers:youtube
npm run benchmark
npm run benchmark:browser
```

Browser tests install/use Playwright Chromium; the one-time install is `npx playwright install chromium`. The main browser suite starts the Vite app automatically. `npm run test:extension` verifies the packaged Manifest V3 extension and its permission boundary. `npm run test:extension:browser` additionally loads it in a Chromium profile and checks the service-page panel on a fixture; it does not verify a paid-service account or protected stream. Chrome 137+ branded browser builds reject command-line extension loading, so the fixture uses Playwright's Chromium for Testing channel. `npm run benchmark` exercises ten socket clients; `npm run benchmark:browser` exercises ten independent browser contexts with the bundled local media. `npm run providers:check` is a separate live-network music smoke test.

See [PERFORMANCE.md](PERFORMANCE.md) for actual results, timing definitions, machine/network conditions, and limits. Those results measure the **local generated HTML5 demo on localhost**. They do not represent measurements for YouTube embeds, third-party music sources, subscription platforms, a physical LAN, mobile browsers, or video display-frame timestamps.

## Reliability and architecture

The Node/Socket.IO server owns room timelines. A playback state consists of a position and server-time anchor: while playing, every client calculates `anchor position + elapsed server time`. Clients estimate offset from repeated monotonic ping samples. State snapshots have strictly increasing versions and media revisions; stale commands are rejected, successful operation IDs are deduplicated, and the server broadcasts a full snapshot to new/reconnecting members. SQLite WAL checkpoints the catalog and room metadata, bounded chat, queue, polls, bookmarks, preferences and reconnect tokens. The active clock remains in memory and rooms restore paused after a server restart.

For native media, 100-ms drift checks seek after 500 ms, use bounded ±5% rate correction for moderate drift, and reset to normal when stable. Provider players with discrete or unreliable rate control use seeks. Corrections wait for the latest source to load and become seekable. A player starts/resumes before seeking; buffering or a pending seek prevents repeated correction commands. YouTube playback promises settle on actual playing/autoplay events, host iframe play/pause/seek actions synchronize through the server, and retry recreates its iframe. Player events cannot echo corrected state back as fresh commands. Buffering players catch up after readiness; blocked autoplay requires a user gesture. Browser and benchmark success does not certify a provider's server-side player policies.

Resource bounds: 32 people and 500 rooms; 100 recent chat messages, 50 queued items, 10 polls and 50 bookmarks per room; 20 socket commands per second per connection; 16 KiB maximum socket event. Custom URLs are parsed and restricted to known provider paths or direct media formats. The application does not fetch arbitrary custom sources from its server.

## Troubleshooting

- **Port 3001 is already used:** stop the other Foyer process or set `PORT` to another port and keep the Vite proxy consistent.
- **Autoplay is blocked:** click **Click to sync and play**, then continue with the media player.
- **Link is valid but does not play:** the source may be private, region restricted, disallow embedding, use an unsupported codec, or require cross-origin access headers. Try the local demo.
- **Commercial service controls don't respond:** ensure the extension is enabled on the actual video title tab, the same episode is open, the Foyer server permission is granted, and the browser reports an accessible player. Use that service's ordinary controls and the extension's sync action. A page update may temporarily break the experimental adapter.
- **Audius is offline:** see the provider error, retry later, or choose local demo audio / Navidrome / an accessible audio link.
- **Navidrome is unavailable:** check server-only URL and credentials, configured access code, reverse proxy/CORS setup and media library scan status. Use HTTPS outside localhost.
- **A viewer cannot join from another machine:** confirm that both devices can reach the same server, the port is allowed by the firewall, and every device can reach the media source.
- **Reconnect grace expired:** the removed participant must join the room again as new. Operations are not queued while offline.

## Project notes

- [DEMO.md](DEMO.md): evaluator walkthrough.
- [REQUIREMENTS.md](REQUIREMENTS.md): implementation and verification map.
- [PERFORMANCE.md](PERFORMANCE.md): recorded methodology/results and provider-specific limits.
- [VIVA.md](VIVA.md): concise synchronization and reliability presentation notes.
- [PROGRESS.md](PROGRESS.md): completion notes.
- [FOYER-PLAN.md](FOYER-PLAN.md): scoped launch checklist and evidence.

## Latest playback and layout fixes

Discovery now sits in the right sidebar, while **Add a link to the room** is directly below the player. The provider player keeps its full width and recovery feedback below it. `tests/browser/youtube.spec.ts` uses a deterministic asynchronous IFrame API fixture to verify two-client buffering, host native controls, feedback-loop prevention, autoplay recovery, retry and YouTube Music queue/Listen behavior. This fixture is separate from `npm run providers:youtube`, which checks actual network playback of the official YouTube API demo and saves `evidence/youtube-live.json`. Override `YOUTUBE_TEST_URL` to check another publicly embeddable video; its availability is controlled by YouTube. The original provider check covered 35 unit/protocol tests and four browser workflows; current results are recorded below. Production source maps are optional (`FOYER_SOURCEMAPS=1` when building).


Cloud deployment externalizes authority to Redis: per-room fenced transactions preserve versions and deduplication across function instances, and Pub/Sub delivers committed snapshots. See [DEPLOYMENT.md](DEPLOYMENT.md) for retention, presence leases and deployment limits.

## Clearer room layout and manual sync

The default **Room** sidebar keeps Chat, Queue, Polls and Moments beside the player. **Discover** holds film/music search; **People** holds participants, preferences, host transfer and settings. Open **Add a link** under the player to enter a source. Discovery starts with playable entries; uncheck **Playable only** to search sample metadata too. Each view retains its state while hidden.

**Sync room** and **S** are host-only, even when collaborative controls are enabled. They pause the authoritative room, hold every connected device at one timestamp, exchange timing/readiness packets, and automatically resume at a shared future deadline once all reports pass. Every device must be paused, ready, not autoplay-blocked, and within 80ms of the held position. A missing device keeps the entire room paused; after a bounded wait the host sees named unready viewers and can retry. **Cancel sync** remains usable while checks run. A guest's **Enable playback on this device** action grants local autoplay permission without triggering a room sync or a playback command. Automatic correction remains local and continues after resume. Offline and stale requests cannot authorize playback.

## Measured device-check protocol

Normal Play probes devices three times, estimates their clocks from four timestamps, and schedules a common future start. Host **Sync room** adds a strict paused alignment barrier and repeats complete three-packet rounds while devices are loading or seeking. People displays RTT, readiness and reported paused alignment. Queued winners, search-result playback and automatic advancement use prepared Play. A native player's one-time post-resume catch-up compensates decoder-start delay; later corrections stay bounded. A 0ms reported paused position difference is not a guarantee of zero network, frame or speaker error.

See [SYNCHRONIZATION.md](SYNCHRONIZATION.md) for packet flow, formulas, failure handling, clock-estimation limits and viva notes. Provider-native controls are reconciled when their SDK reports them; the Foyer Play control is the path that waits for the prepared start. These measurements describe clocks/player state, not exact video-frame presentation.

## Song changes and phone layouts

YouTube players now retain mute preferences while loading and apply them only after iframe readiness. Rapid changes ignore discarded player callbacks. A player-scoped error boundary leaves the room connection, chat and source picker usable if player initialization fails; **Retry source** creates a fresh player. Changing media cancels a pending manual-sync attempt for the previous source.

On phones, playback uses separate seek/time/action rows, 44px playback and reaction controls, compact room/invite controls, safe-area spacing and 16px form inputs to avoid iOS focus zoom. Room tools stay accessible while scrolling; music search, source entry and chat fit narrow screens. Reduced-motion preferences suppress reaction animation. Mobile verification covers 320, 360, 390 and 430px portrait and 844px landscape with Chromium touch emulation; physical Android/iPhone and Safari remain unverified.

Run the deterministic multi-user song-switch and phone tests with `npm run test:browser -- tests/browser/youtube.spec.ts tests/browser/mobile.spec.ts`. Run `npm run providers:switch` against the running production build on port 3001 for actual YouTube → YouTube → local audio → YouTube playback checks. Set `DEMO_URL` to another server and `SONG_SWITCH_REPORT` to the output JSON path. This smoke test repeats the public YouTube API demo under different room revisions; it does not certify availability of every commercial song. Performance measurements remain in PERFORMANCE.md, separate from these functional checks.

Final song-switch verification: 51 unit tests and all nine local browser workflows passed; the final source-transition update also passed all three targeted song/mobile workflows. On the public deployment all nine workflows were verified: eight passed in the full run, and the phone workflow passed its targeted rerun after increasing the media-loading assertion from 5s to 20s for Internet source loading. The browser reported a loading network state without a media error during the original timeout. Build and type checks pass. `evidence/song-switch-vercel-after.json` independently confirms actual YouTube/direct-audio switching and manual sync without uncaught browser errors. The runtime source is deployed at https://foyer-cyan.vercel.app and pushed to GitHub main.

## Themes and current verification

The theme button chooses light or dark on each device, saved between visits; initial appearance follows the system preference. Buttons use 3px corners, cards/album art are flatter, typography and labels are more restrained, and phone layouts preserve 44px primary controls. The visual references were [Apple Music](https://music.apple.com/us/new), [Spotify](https://open.spotify.com/) and [Bandcamp](https://bandcamp.com/discover); Foyer uses its own layout, colors and assets.

Run `npm run providers:music` for actual anonymous search → official embedded playback → host sync/automatic resume, and `npm run benchmark:sync` for ten isolated native video/audio clients. Both use the running compiled demo at port 3001 by default; `DEMO_URL` selects a different host. `MUSIC_REPORT` and `BENCH_REPORT` select JSON outputs. Normal delivery/application latency remains separated from the full pause/alignment/handshake transaction. Physical phones/Safari, presented frames/speaker output and a physical LAN remain unverified.

Current local checks: 57 unit/integration tests, all 11 browser workflows and build/types pass. Actual search for Finding Her returned 20 metadata results and decoded playback inside one tab. Ten native browser contexts reported matching paused positions, then measured p95 estimated resumed drift 70.94ms (maximum 278.84ms). A reported 0ms paused difference does not imply guaranteed zero playback error. Previous dated test/results sections describe earlier revisions; current host-only synchronization supersedes the former guest local Sync me now behavior.

Current runtime `076cc98` is deployed and pushed to main. The public-target suite passes 11 checks: ten public workflows and one deliberately local injected search/player integration. Actual public Finding Her search/playback and three successive host syncs also pass separately. Ten isolated public video players measure control delivery p95 144.76ms, player application p95 315.14ms (including the scheduled start), and maximum normal corrected drift 148.98ms. Ten-player host video/audio sync measures p95 estimated resumed drift 67.31ms, maximum 88.39ms. Raw reports, provider probe timeouts/retries and limitations are retained in PERFORMANCE.md. Refresh existing tabs before testing the new protocol.

## Illustrated artwork and slower phone connections

The original illustrated home scene and catalog covers are restored; saved themes, sharp buttons and the room layout remain. Provider song thumbnails continue to use returned artwork. The local Listen demo now defaults to fast-start AAC (`evening-keys.m4a`, 367,000 bytes) instead of the 2,646,044-byte WAV, an 86% reduction. The WAV remains available for compatibility; `npm run media:audio` regenerates both from the original procedural melody.

Provider correction waits for buffering to settle and spaces automatic seeks by four seconds; explicit host seeks remain immediate. Slow YouTube startup is given 30 seconds and is not mistaken for autoplay denial. A late playing event recovers automatically. HLS uses viewport-sized quality caps and bounded mobile buffers. The official YouTube player chooses its own streaming quality; Foyer does not extract or proxy its media.

Run `npm run test:browser -- tests/browser/phone-network.spec.ts tests/browser/youtube.spec.ts` for actual low-bandwidth native audio and controlled slow-SDK regressions. `PHONE_NETWORK_REPORT` selects the network report; `DEMO_URL` selects the app. The media test uses two isolated touch contexts at 100kbps HTTP download / 50kbps upload / 200ms HTTP latency after loading the app. This is not physical phone/Safari, full app startup, WebSocket-delay or cellular packet-loss certification. On memory-constrained Windows machines, set `LOW_MEMORY=1` to reduce Chromium allocation while retaining isolated test contexts; compilation still needs a larger Node heap than the browser driver.

Watch rooms now open with an empty screen. Add a link or select a playable title in Discover before using playback controls. The local demo is optional; existing rooms retain their selected media. Listen rooms retain their audio default.

Final empty-Watch verification: 60 unit/integration checks and 16 local browser checks pass. Current performance evidence and provider/network limitations are recorded in PERFORMANCE.md; tests choose the optional demo explicitly.
