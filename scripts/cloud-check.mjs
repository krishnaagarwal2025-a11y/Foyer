import { io } from "socket.io-client";
import { strict as assert } from "node:assert";
import { writeFileSync } from "node:fs";
const urls = (
  process.env.CHECK_URLS || "http://localhost:3002,http://localhost:3003"
).split(",");
const sockets = [];
const connect = async (url) => {
  const s = io(url, { transports: ["websocket"], forceNew: true });
  sockets.push(s);
  await new Promise((yes, no) => {
    s.once("connect", yes);
    s.once("connect_error", (e) =>
      no(Error(e.description?.message || e.message)),
    );
    setTimeout(() => no(Error("connection timeout")), 15000).unref();
  });
  return s;
};
const emit = (s, event, payload) =>
  new Promise((yes, no) =>
    s.timeout(10000).emit(event, payload, (err, r) => (err ? no(err) : yes(r))),
  );
const command = (s, r, c, opId = crypto.randomUUID()) =>
  emit(s, "command", { opId, mediaRevision: r.mediaRevision, command: c });
try {
  const a = await connect(urls[0]),
    b = await connect(urls[1] || urls[0]);
  const host = await emit(a, "join", { name: "Cloud host" });
  assert(host.ok, host.error);
  const guest = await emit(b, "join", {
    name: "Cloud guest",
    code: host.room.code,
  });
  assert(guest.ok, guest.error);
  const event = new Promise((yes, no) => {
    b.on("state", (r) => {
      if (r.position === 25) yes(r);
    });
    setTimeout(() => no(Error("pubsub timeout")), 10000).unref();
  });
  const seek = await command(a, host.room, { type: "seek", position: 25 });
  assert(seek.ok, seek.error);
  assert.equal((await event).position, 25);
  const play = await command(a, seek.room || host.room, { type: "play" });
  assert(play.ok, play.error);
  const c = await connect(urls[1] || urls[0]);
  const late = await emit(c, "join", { name: "Late", code: host.room.code });
  assert(late.ok);
  assert(late.room.playing);
  assert.equal(late.room.participants.length, 3);
  assert.equal((await command(b, late.room, { type: "pause" })).ok, false);
  const op = crypto.randomUUID();
  const first = await command(a, late.room, { type: "seek", position: 30 }, op);
  const repeated = await command(
    a,
    late.room,
    { type: "seek", position: 30 },
    op,
  );
  assert(first.ok && repeated.ok);
  assert.deepEqual(first, repeated);
  a.disconnect();
  await new Promise((r) => setTimeout(r, 500));
  const resumed = await connect(urls[1] || urls[0]);
  const result = await emit(resumed, "join", {
    name: "Cloud host",
    code: host.room.code,
    identity: host.identity,
  });
  assert(result.ok, result.error);
  assert.equal(result.identity.id, host.identity.id);
  assert.equal(result.room.participants.length, 3);
  const report = {
    timestamp: new Date().toISOString(),
    urls,
    separateServerEndpoints: new Set(urls).size > 1,
    limitation:
      new Set(urls).size > 1
        ? "Two explicitly separate local processes sharing real Redis"
        : "Public function instance placement not observable",
    checks: [
      "room join",
      "Redis Pub/Sub seek delivery",
      "playing late join",
      "unauthorized control rejected",
      "duplicate operation deduplicated",
      "stable identity reconnect",
    ],
    passed: true,
  };
  writeFileSync(
    process.env.CHECK_REPORT || "evidence/cloud-check.json",
    JSON.stringify(report, null, 2),
  );
  console.log(report);
} finally {
  sockets.forEach((s) => s.disconnect());
}
