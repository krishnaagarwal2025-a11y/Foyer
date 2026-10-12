# Foyer evaluator walkthrough

1. Run `npm ci`, then `npm run dev`; open http://localhost:5173. Enter **Alex**, create a room, and copy the invite. The code is always visible in the header.
2. In another browser/private window, open the invite and enter **Jordan**. Both names appear in the audience. The second participant's playback controls are disabled by default.
3. Play the included **Cinema Color Journey**. It is an actual local 90-second MP4. Pause and seek with the host; both players follow. Open diagnostics and inspect estimated drift and RTT; click **Sync me now**.
4. Join a third browser while playing. It loads the current source and catches up to the authoritative timeline. If autoplay is blocked, click the sync-and-play action.
5. Search **quiet orbt** to demonstrate fuzzy title matching. Filter by genre and check **Playable only**. Discovery samples are clearly labeled and have no Watch control. In **Your movie preferences**, each participant selects genres/moods; cards show the number of group matches and reasons.
6. Send chat in either browser. Mark one message as a spoiler; the other participant reveals it explicitly. Send an emoji reaction and watch it float over both screens.
7. Queue the local playable film and a discovery sample. In **Queue**, vote on titles; vote counts update on the other browser. The host's **Play winner** selects the highest-voted playable item. Enable **Auto-play winning queued video** in room settings, queue the demo again, then seek near 89 seconds and play to observe automatic advancement.
8. Create a poll with 2–5 comma-separated choices. Vote from both browsers; each participant gets one changeable vote and live totals.
9. In **Moments**, save a named timestamp. The host can select it to seek everyone; guests need collaborative control or host transfer to seek.
10. Transfer host to Jordan using **Make host**. Jordan can now control playback; Alex cannot. Optionally enable collaborative control and demonstrate ordered concurrent seeks.
11. Turn one browser offline briefly in developer tools, then back online before 15 seconds. Its status changes, commands disable, the identity returns without duplication, and playback catches up. Close the host and wait about 16 seconds for deterministic replacement.
12. Enter **Cinema mode**, then press **C** to leave. **Space** toggles host play/pause; **←/→** seeks ten seconds; **S** syncs. Shortcuts do not run while typing or operating a form control.
13. Try an invalid room code, an unsupported custom video URL, or an inaccessible direct file to see real validation and recovery feedback.

14. Switch the host room to **Listen**. The shared player becomes audio-focused and the included original *Foyer · Evening Keys* plays locally. Use **Search YouTube Music** to find a song in a new tab, paste its individual share link into **YouTube Music song URL**, and play or queue it. The video player remains visible. Select **Audius** and search **ambient** and queue a result when its public catalog is reachable. `npm run providers:check` records whether search and audio streaming are available. For a private collection, configure Navidrome on the server and use its separate library code in Listen discovery. Navidrome is personal-library software; it does not provide commercial songs.
15. Paste a YouTube watch or Shorts link in **Add a link to the room**. The title uses YouTube's visible, branded player with its own controls and advertising. Private, restricted or embedding-disabled videos report the provider error. An accessible Vimeo or SoundCloud link is another way to try an official embedded player.
16. For Netflix, Prime Video or Hotstar/JioHotstar, switch back to **Watch** and enter the title URL. From its external-player screen download the Foyer Companion developer ZIP; extract and install the folder through Chrome/Edge Extensions → Developer mode → Load unpacked. Open an authorized service title, then use the extension popup to grant access to your Foyer server. The extension requests only its supported service page access and the server origin you enter. Reload the title tab and use the panel to create or join. Each viewer opens the same title in their own signed-in tab. This remains experimental; the browser fixture does not exercise DRM-protected subscription playback.

For measured evidence, run `npm run benchmark` (ten socket clients) and `npm run benchmark:browser` (ten isolated browser contexts on the compiled local-media demo). Run `npm run test:extension` for extension package checks, `npm run test:extension:browser` for its browser fixture, `npm run providers:youtube` for actual YouTube playback and `npm run providers:check` for a separate live Audius network smoke test. See PERFORMANCE.md for actual conditions and limits.

## Public demo
Open https://foyer-cyan.vercel.app on both devices and follow the same room walkthrough. Use the generated invite link. Local room codes do not exist in the separate cloud database. No Vercel login is required for the production URL.

## Current room navigation

Chat opens by default in **Room**. Use **Discover** for film/song search and **People** for preferences, host transfer and room settings. Expand **Add a link** beneath the player to paste media. The catalog starts at **Playable only**; uncheck it before the sample fuzzy-search demonstration. **Sync me now** visibly reports progress and success and retries blocked playback locally without granting guest control. To demonstrate a failed request, the browser regression test drops just the sync acknowledgement; the interface reports a timeout instead of success. Network disconnection is detected by heartbeat (up to about 15 seconds), then the separate 15-second grace period begins; closing a client normally is detected sooner.

## Protocol demonstration

Create a room in two browser contexts and open People on each. Press Play in Foyer: both receive three device checks; inspect the measured RTT/readiness rows and the temporary Starting together state. Repeat in Listen with the included audio demo. On the guest, press Sync me now: both devices are probed again, clock calibration updates, and only the guest's player is corrected. Turn one device offline or delay its responses to demonstrate bounded waiting and catch-up. Queue a playable item and use Play winner; enable automatic advancement to show that the next source also gets a prepared start. The RTT is round-trip delay, not an exact one-way delay.

## Phone and song-switch checks

Open the production link in a phone browser, create a room, and tap Listen. Playback has a seek row and separate play/sound/sync actions; Room, Discover and People fit under the player. Open Discover to paste individual YouTube Music links. Change songs repeatedly, including while the next player loads; the room and chat should remain visible. Toggle sound during loading and confirm the preference takes effect when ready. A second participant can tap Sync me now and send a chat message.

For a repeatable live check, run `npm run providers:switch` with `DEMO_URL` set to the server being evaluated. It cycles public YouTube demo revisions, a direct local audio source, and back to YouTube, recording actual decoded/playing state plus uncaught browser errors. This checks provider lifecycle behavior rather than song-catalog availability or measured LAN latency.
