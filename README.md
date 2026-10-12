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

Create a **Listen** room or have the host switch an existing room to Listen. The room loads its local demo song. Choose **YouTube Music** to search its website in a new tab, then paste an individual song share link into **YouTube Music song URL** and use **Play song** or **Queue song**. YouTube and YouTube Music links use the full visible official YouTube player; video is retained, and embedding restrictions still apply. Album/playlist-only links need an individual song selected first. Search results are on YouTube Music, rather than a scraped or extracted catalog in Foyer. Search and queue free, artist-published tracks through Audius when its public API is available. SoundCloud links and direct audio files also use the synchronized shared player.

There is no open GitHub repository that can lawfully supply the complete commercial song catalogs from major platforms. Foyer therefore uses [Audius's public catalog](https://docs.audius.co/developers/introduction/overview/) for no-key music discovery and integrates [Navidrome](https://github.com/navidrome/navidrome) for a **private, self-hosted collection you supply**. Navidrome is open-source server software, not a download of all songs. Configure its server settings in `.env`; Foyer never stores the password in the browser. A separate library access code protects searches, and signed, short-lived tickets authorize audio streaming through Foyer.

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

Participants choose a display name and generated avatar. The room offers a host-controlled shared timeline, a reconnect indicator, diagnostics and **Sync me now**, searchable sample discovery with filters and explainable group preferences, shared playlists with voting, live chat with individually revealed spoilers, floating emoji reactions, group polls, host transfer, timestamp bookmarks and an optional cinema layout with keyboard shortcuts. A lost connection retains identity through a 15-second grace period; a deterministic connected-participant election replaces an absent host afterward. Roles and command payloads are checked on the server.

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

Discovery now sits in the right sidebar, while **Add a link to the room** is directly below the player. The provider player keeps its full width and recovery feedback below it. `tests/browser/youtube.spec.ts` uses a deterministic asynchronous IFrame API fixture to verify two-client buffering, host native controls, feedback-loop prevention, autoplay recovery, retry and YouTube Music queue/Listen behavior. This fixture is separate from `npm run providers:youtube`, which checks actual network playback of the official YouTube API demo and saves `evidence/youtube-live.json`. Override `YOUTUBE_TEST_URL` to check another publicly embeddable video; its availability is controlled by YouTube. Latest checks passed: 35 unit/protocol tests and 4 browser workflows. Production source maps are optional (`FOYER_SOURCEMAPS=1` when building).


Cloud deployment externalizes authority to Redis: per-room fenced transactions preserve versions and deduplication across function instances, and Pub/Sub delivers committed snapshots. See [DEPLOYMENT.md](DEPLOYMENT.md) for retention, presence leases and deployment limits.

## Clearer room layout and manual sync

The default **Room** sidebar keeps Chat, Queue, Polls and Moments beside the player. **Discover** holds film/music search; **People** holds participants, preferences, host transfer and settings. Open **Add a link** under the player to enter a source. Discovery starts with playable entries; uncheck **Playable only** to search sample metadata too. Each view retains its state while hidden.

**Sync me now** and the **S** shortcut affect only your local player. They request an authenticated current snapshot, reset playback rate and force timeline correction; a click also retries autoplay within the user gesture. Success is shown only after the room responds and the loaded player matches play/pause and is within 500 ms. Pending loading, buffering, blocked autoplay, timeout and reconnection have explicit feedback. Sync is disabled offline and for external subscription-service screens; use the companion on the service page there. Automatic correction remains bounded and never sends room-control feedback. Keyboard shortcuts ignore typing, modifier combinations and repeated keys.
