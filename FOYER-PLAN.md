# Foyer launch implementation

Authorized scope: rename Watch Party to Foyer; YouTube, Vimeo, SoundCloud, direct audio/video/HLS; Listen mode; Audius open catalog; optional Navidrome personal library; companion extension for Netflix, Prime Video and Hotstar/JioHotstar; GitHub publication.

Plan executed: inspect/preserve remote history → provider-aware protocol and player adapters → music discovery/library connectors → signed-in-service extension → branding/accessibility/security/deployment polish → automated tests, live provider smoke test, ten-player regression benchmarks → publish source and evidence.

Acceptance checklist:
- [x] Preserve local playback and all room/social/reconnect functionality.
- [x] Normalize provider URLs, validate server-side, queue imported items.
- [x] Shared player adapter contract, readiness/revision checks, duration discovery and capability-aware correction.
- [x] Watch/Listen modes with functional music search and local offline audio.
- [x] Supported official embeds and understandable provider errors.
- [x] Audius integration; configurable server-only Navidrome credentials.
- [x] Companion extension joins rooms, binds external titles, handles buffering/ads, and provides chat/reaction/control UI without accessing account credentials or protected streams.
- [x] Foyer branding, onboarding, single-process deployment guidance, CI, and a documented support matrix.
- [x] Unit/integration/browser/extension-fixture tests and repeatable live provider smoke check.
- [ ] Personal Netflix/Prime/Hotstar account playback verification and Chrome Web Store listing (requires authorized accounts and publisher account access; platform adapters remain experimental).
- [ ] Physical-LAN timing verification (repeatable instructions and the previous localhost result are provided; no second LAN host was available in this environment).
- [ ] GitHub branch publication (source changes are ready to commit and push).

Constraints: no music provider promises all commercial songs; no GitHub code can grant rights to the full commercial catalogs. Audius serves artist-published tracks; Navidrome streams a collection the operator owns. Extension support on subscription platforms needs authorized logged-in accounts and remains experimental. Official embeds retain visible provider controls/branding. No DRM bypass or streaming credentials are sent to Foyer.
