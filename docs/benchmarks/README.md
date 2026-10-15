# Selected performance evidence

These are historical results, not measurements of every current commit. Preserve each report's timestamp, URL, media type, sample size, clock model, and limitations when interpreting it. Full methodology is in [Performance](../performance.md).

| Report                                                                         | Scope                                                                          |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| [socket-benchmark.json](socket-benchmark.json)                                 | Ten localhost socket clients, 810 recipient samples; no browser playback       |
| [vercel-browser-benchmark.json](vercel-browser-benchmark.json)                 | Public browser delivery/application and drift; see report conditions           |
| [host-sync-vercel-browser.json](host-sync-vercel-browser.json)                 | Public native-player pause/handshake/resume experiment                         |
| [empty-watch-phone-network-vercel.json](empty-watch-phone-network-vercel.json) | Two phone-emulated contexts streaming native audio with throttled HTTP         |
| [empty-watch-sync-browser.json](empty-watch-sync-browser.json)                 | Failed ten-context rerun; browser crashed before samples; no performance claim |

Earlier raw artifacts remain in [repository history before cleanup](https://github.com/krishnaagarwal2025-a11y/Foyer/tree/3dd9fec/evidence). Fresh runs write to ignored `evidence/`; CI retains generated artifacts temporarily rather than committing them.
