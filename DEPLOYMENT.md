# Vercel deployment

Production: https://foyer-cyan.vercel.app

The Vite site and Node HTTP/Socket.IO function deploy together. Vercel WebSockets are currently Beta. Clients use WebSocket transport; long polling is disabled. Function connections have a 300-second lifetime and clients automatically reconnect. Repeated full snapshots restore playback and stable identities.

Cloud mode uses the free Upstash Redis database in Mumbai, with automatic paid upgrades disabled. Local `npm start` still uses SQLite. Redis stores private room records, deduplication history and identity tokens; public snapshots never expose tokens. Each mutation holds a per-room, owner-fenced lock; an atomic Lua script commits before publishing the public event. Separate TLS Redis Pub/Sub connections broadcast across function instances. Presence leases last 15 seconds with a further configurable host grace period. Heartbeats run every five seconds. Rooms without a heartbeat for 60 seconds are cleaned on registry maintenance; a 48-hour TTL is a backup. These are bounded demo retention policies, not permanent account storage.

## Re-deploy

Requires Node 24 and access to the linked Vercel project:

```sh
npm ci
npm run build
npx vercel link --project foyer
npx vercel --prod --yes
```

The Marketplace resource must be connected to the project and supply REDIS_URL or KV_URL. Never commit downloaded environment files. The initial CLI attempt to connect the GitHub repository was unsuccessful; deployments are manual CLI deployments until the Vercel GitHub app is granted repository access.

For two-instance verification, pull production variables to an ignored file, start two servers using the same isolated FOYER_CLOUD_NAMESPACE, FOYER_REDIS=1 and different PORT values, then run `node scripts/cloud-check.mjs`. Defaults are ports 3002 and 3003. CHECK_URLS can select other endpoints. Do not use the production namespace for local tests.

Free service quotas still apply. When storage is unavailable, commands return an error instead of acknowledging an uncommitted change. WebSocket Beta and provider embedding policies are external dependencies. Commercial subscription services require each viewer's own account and the experimental companion extension; they are not streamed through Foyer. Optional multi-instance Navidrome needs a stable server-only FOYER_STREAM_SECRET.

References: https://vercel.com/docs/functions/websockets and https://vercel.com/kb/guide/is-sqlite-supported-in-vercel.
