# Foyer evaluator walkthrough

1. Run `npm ci`, then `npm run dev`; open http://localhost:5173. Enter **Alex**, create a room, and copy the invite. The code is always visible in the header.
2. In another browser/private window, open the invite and enter **Jordan**. Both names appear in the audience. The second participant's playback controls are disabled by default.
3. Play the included **Cinema Color Journey**. Pause and seek with the host; both players follow. Press the host's **Sync room**: both pause, align and exchange timing packets, then resume automatically. The guest's sync control is disabled. Inspect estimated drift and RTT in diagnostics.
4. Join a third browser while playing. It loads and catches up. If autoplay is blocked, use **Enable playback on this device**; this is local permission, not a guest room-sync command.
5. Search **quiet orbt** to demonstrate fuzzy title matching. Filter by genre and check **Playable only**. Discovery samples are clearly labeled and have no Watch control. In **Your movie preferences**, each participant selects genres/moods; cards show the number of group matches and reasons.
6. Send chat in either browser. Mark one message as a spoiler; the other participant reveals it explicitly. Send an emoji reaction and watch it float over both screens.
7. Queue the local playable film and a discovery sample. In **Queue**, vote on titles; vote counts update on the other browser. The host's **Play winner** selects the highest-voted playable item. Enable **Auto-play winning queued video** in room settings, queue the demo again, then seek near 89 seconds and play to observe automatic advancement.
8. Create a poll with 2–5 comma-separated choices. Vote from both browsers; each participant gets one changeable vote and live totals.
9. In **Moments**, save a named timestamp. The host can select it to seek everyone; guests need collaborative control or host transfer to seek.
10. Transfer host to Jordan using **Make host**. Jordan can now control playback; Alex cannot. Optionally enable collaborative control and demonstrate ordered concurrent seeks.
11. Turn one browser offline briefly in developer tools, then back online before 15 seconds. Its status changes, commands disable, the identity returns without duplication, and playback catches up. Close the host and wait about 16 seconds for deterministic replacement.
12. Enter **Cinema mode**, then press **C** to leave. **Space** toggles host play/pause; **←/→** seeks ten seconds; **S** syncs. Shortcuts do not run while typing or operating a form control.
13. Try an invalid room code, an unsupported custom video URL, or an inaccessible direct file to see real validation and recovery feedback.

14. Switch to **Listen**, then open **Discover**. Search a song/artist and choose **Search music**. Click a result's **Play** as host; its link loads and playback starts in Foyer without another tab or copied URL. Guests can queue results. The official YouTube video remains visible. Try **Audius** for independent music or configure Navidrome for your own collection. Optional **Add a song link** remains available if metadata search is unavailable.
15. Paste a YouTube watch or Shorts link in **Add a link to the room**. The title uses YouTube's visible, branded player with its own controls and advertising. Private, restricted or embedding-disabled videos report the provider error. An accessible Vimeo or SoundCloud link is another way to try an official embedded player.
16. For Netflix, Prime Video or Hotstar/JioHotstar, switch back to **Watch** and enter the title URL. From its external-player screen download the Foyer Companion developer ZIP; extract and install the folder through Chrome/Edge Extensions → Developer mode → Load unpacked. Open an authorized service title, then use the extension popup to grant access to your Foyer server. The extension requests only its supported service page access and the server origin you enter. Reload the title tab and use the panel to create or join. Each viewer opens the same title in their own signed-in tab. This remains experimental; the browser fixture does not exercise DRM-protected subscription playback.

For measured evidence, run `npm run benchmark` (ten socket clients) and `npm run benchmark:browser` (ten isolated browser contexts on the compiled local-media demo). Run `npm run test:extension` for extension package checks, `npm run test:extension:browser` for its browser fixture, `npm run providers:youtube` for actual YouTube playback and `npm run providers:check` for a separate live Audius network smoke test. See PERFORMANCE.md for actual conditions and limits.

## Public demo
Open https://foyer-cyan.vercel.app on both devices and follow the same room walkthrough. Use the generated invite link. Local room codes do not exist in the separate cloud database. No Vercel login is required for the production URL.

## Current room navigation

Chat opens in **Room**; **Discover** holds search and **People** holds preferences/settings/host transfer. **Add a link** is collapsed under the player. Uncheck **Playable only** for fictional sample metadata. **Sync room** is host-only and pauses the whole room until the readiness/clock barrier completes. Blocked playback is enabled locally on the affected device. A missing participant leaves the room paused with a named error; **Cancel sync** works while checks run. The theme button switches light/dark independently per viewer and persists after reload.

## Protocol demonstration

Create two contexts and open People. Normal Play performs three timing exchanges and a prepared start. Repeat in Listen. Press **Sync room** as host: all players pause, rates reset, positions align, and complete three-packet rounds repeat until all are ready. The server schedules a shared restart. Delay one device or block autoplay to show the pause barrier and bounded failure; restore readiness and retry. Queue a playable item and use **Play winner** to demonstrate prepared advancement. RTT is round-trip delay; reported paused alignment and estimated drift do not prove literal zero frame/speaker error.

## Phone and song-switch checks

Open the production link on a phone, choose Listen, then Discover. Search and select songs inside Foyer. Change songs while loading; the page stays visible and mute preference carries forward. Test both themes and narrow layout. A second participant can chat and queue; only the host starts room sync. Refresh existing tabs before evaluating the new protocol.

For a repeatable live check, run `npm run providers:switch` with `DEMO_URL` set to the server being evaluated. It cycles public YouTube demo revisions, a direct local audio source, and back to YouTube, recording actual decoded/playing state plus uncaught browser errors. This checks provider lifecycle behavior rather than song-catalog availability or measured LAN latency.

Watch rooms now open with an empty screen. Add a link or select a playable title in Discover before using playback controls. The local demo is optional; existing rooms retain their selected media. Listen rooms retain their audio default.
