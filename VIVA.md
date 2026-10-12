# Presentation notes

**What problem does the server solve?** Each browser has its own clock, buffering behavior and playback position. Sharing “play” alone is insufficient: late joiners need a timeline and disconnected clients need a source of truth. The server owns a position at an anchor time, playing state, media revision and increasing state version.

**How is position derived?** A playing video advances from anchor position by elapsed server time. A paused video stays at anchor position. Clients estimate the server clock from ping round trips and calculate the same expected position. Position is clamped to duration.

**Why clock pings?** Wall clocks on different machines can disagree. A ping samples local monotonic start/end, then estimates offset against the server's reply time at the midpoint. Fast recent round trips reduce queueing bias. Asymmetric networks can still bias the estimate; RTT is not a guarantee of synchronization accuracy.

**How is drift corrected?** Every 100 milliseconds and on player readiness/state changes, compare expected position with HTML5 currentTime. Large drift seeks immediately. Smaller drift changes playback rate within 0.95–1.05, returning to 1 near alignment. Paused clients seek if necessary. Corrections never emit new playback commands, avoiding feedback loops.

**What about concurrent actions?** A synchronous mutation engine on one Node event loop applies commands in arrival order and assigns versions. Every client follows the latest authoritative snapshot. Commands carry an operation ID for bounded deduplication and a media revision to reject seeks for the wrong source. This is deterministic ordering, not a distributed consensus system.

**Why does reconnection work?** A participant owns a server-issued random token; the code is only an invitation. The same tab resumes that identity and receives the complete room state. Disconnected people remain through a grace period, preserving the host while their network recovers. Expired hosts are replaced deterministically. SQLite checkpoints restore rooms paused after a restart.

**How are recommendations explained?** Each selected genre or mood that matches a title contributes one point per participant. The UI displays the total and matching preferences. This transparent scoring favors shared interests without implying access to commercial films.

**How do we prove performance?** Socket benchmarks measure command emission to recipient state callbacks on one monotonic clock. Browser benchmarks separately measure receipt, matching player state, and currentTime drift. Browser clocks are calibrated before comparing event times. Actual measurements, sample counts, autoplay policy and limitations are saved, rather than treating low socket latency as proof of video sync.

**Tradeoffs:** one process avoids extra infrastructure and simplifies ordering; it limits horizontal scaling. Whole-room snapshots simplify late joins and make bounded-room traffic predictable; larger rooms would benefit from incremental events. The local sample makes playback repeatable; arbitrary internet media introduces codecs, buffering and permissions outside the application's control.
