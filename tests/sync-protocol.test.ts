import { describe, it, expect } from "vitest";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { io, type Socket } from "socket.io-client";
import { SyncProtocol } from "../server/sync-protocol";
import { Engine } from "../server/engine";
import { expectedPosition, type Synchronization } from "../shared/types";
import { probeClockOffset, startLeadMs } from "../shared/sync";
import type { CloudEvent } from "../server/cloud";
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

it("calculates a four-timestamp offset and bounds the common-start lead", () => {
  expect(
    probeClockOffset({
      id: "p",
      serverSentAt: 1000,
      clientReceivedAt: 1510,
      clientSentAt: 1512,
      serverReceivedAt: 1022,
      rttMs: 20,
    }),
  ).toBe(-500);
  expect(startLeadMs([])).toBe(120);
  expect(
    startLeadMs([
      {
        participantId: "a",
        rttMs: 2000,
        samples: 3,
        ready: true,
        autoplayBlocked: false,
      },
    ]),
  ).toBe(1500);
});

it("probes peers on two independent Socket.IO servers, coalesces checks, calibrates clocks and bounds missing replies", async () => {
  const servers: Server[] = [],
    protocols: SyncProtocol[] = [],
    clients: Socket[] = [],
    offsets: number[] = [],
    counts = [0, 0];
  const members: Map<string, string>[] = [];
  const now = () => performance.timeOrigin + performance.now();
  const publish = async (event: CloudEvent) => {
    await Promise.all(protocols.map((p) => p.receive(event)));
  };
  try {
    for (let i = 0; i < 2; i++) {
      const http = createServer(),
        server = new Server(http),
        map = new Map<string, string>();
      servers.push(server);
      members.push(map);
      server.on("connection", (s) => map.set(s.id, `peer${i}`));
      protocols.push(new SyncProtocol(server, now, async () => map, publish));
      await new Promise<void>((resolve) =>
        http.listen(0, "127.0.0.1", resolve),
      );
      const s = io(`http://127.0.0.1:${(http.address() as any).port}`, {
        transports: ["websocket"],
        forceNew: true,
      });
      clients.push(s);
      s.on("sync-check", async (packet, ack) => {
        counts[i]++;
        await delay(10); // Simulated outbound link delay, not client processing.
        const received = now() + 5000;
        await delay(3); // Client processing is subtracted from RTT.
        const sent = now() + 5000;
        await delay(10); // Simulated inbound link delay.
        ack({
          id: packet.id,
          sequence: packet.sequence,
          mediaRevision: packet.mediaRevision,
          clientReceivedAt: received,
          clientSentAt: sent,
          ready: true,
          autoplayBlocked: false,
        });
      });
      s.on("sync-clock", (p) => offsets.push(probeClockOffset(p)));
      await new Promise<void>((resolve, reject) => {
        s.once("connect", () => resolve());
        s.once("connect_error", reject);
      });
    }
    const e = new Engine(),
      room = e.join("owner", { name: "Host" }).room!;
    room.participants = room.participants.map((p) => ({ ...p, id: "peer0" }));
    room.participants.push({ ...room.participants[0], id: "peer1" });
    const [a, b] = await Promise.all([
      protocols[0].check(room, "play"),
      protocols[0].check(room, "play"),
    ]);
    expect(a.id).toBe(b.id);
    expect(counts).toEqual([3, 3]);
    expect(
      a.participants.every((p) => p.samples === 3 && p.ready && p.rttMs! >= 18),
    ).toBe(true);
    await expect.poll(() => offsets.length, { timeout: 1000 }).toBe(6);
    expect(offsets.every((offset) => Math.abs(offset + 5000) < 25)).toBe(true);
    clients[1].off("sync-check");
    const started = performance.now(),
      missing = await protocols[0].check(room, "manual");
    expect(performance.now() - started).toBeLessThan(1400);
    expect(
      missing.participants.find((p) => p.participantId === "peer1"),
    ).toMatchObject({ ready: false, samples: 0, rttMs: null });
    expect(missing.participants[0].ready).toBe(true);
  } finally {
    clients.forEach((s) => s.disconnect());
    for (const s of servers)
      await new Promise<void>((resolve) => s.close(() => resolve()));
  }
}, 10000);

describe("authoritative scheduled playback", () => {
  const setup = () => {
    let now = 10000;
    const engine = new Engine(
      () => {},
      () => {},
      () => now,
    );
    const joined = engine.join("host", { name: "Host" }),
      room = joined.room!;
    engine.join("guest", { name: "Guest", code: room.code });
    const envelope = {
      opId: crypto.randomUUID(),
      mediaRevision: room.mediaRevision,
      command: { type: "play" },
    };
    const prepared = engine.preparePlayback("host", envelope).room!;
    const check: Synchronization = {
      id: "check",
      code: room.code,
      reason: "play",
      checkedAt: now,
      mediaRevision: room.mediaRevision,
      participants: [
        {
          participantId: joined.identity!.id,
          rttMs: 40,
          samples: 3,
          ready: true,
          autoplayBlocked: false,
        },
      ],
    };
    return {
      engine,
      room,
      envelope,
      prepared,
      check,
      advance: (n: number) => {
        now += n;
      },
      now: () => now,
    };
  };
  it("validates host permission, holds position before start and deduplicates a committed start", () => {
    const x = setup();
    expect(x.engine.preparePlayback("guest", x.envelope).ok).toBe(false);
    expect(
      x.engine.apply("host", x.envelope, {
        baseline: x.prepared,
        check: x.check,
      }).ok,
    ).toBe(true);
    const r = x.engine.rooms.get(x.room.code)!;
    expect(r.anchor - x.now()).toBe(140);
    expect(expectedPosition(r, x.now())).toBe(0);
    x.advance(240);
    expect(expectedPosition(r, x.now())).toBeCloseTo(0.1);
    const version = r.version;
    expect(x.engine.preparePlayback("host", x.envelope).room).toBeUndefined();
    expect(
      x.engine.apply("host", x.envelope, {
        baseline: x.prepared,
        check: x.check,
      }).ok,
    ).toBe(true);
    expect(r.version).toBe(version);
  });
  it("rejects an older preflight when a concurrent seek changed the timeline", () => {
    const x = setup();
    x.engine.apply("host", {
      opId: crypto.randomUUID(),
      mediaRevision: 0,
      command: { type: "seek", position: 20 },
    });
    expect(
      x.engine.apply("host", x.envelope, {
        baseline: x.prepared,
        check: x.check,
      }),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining("Playback changed"),
    });
  });
  it("keeps the scheduled deadline when duration or seek changes during countdown", () => {
    const x = setup();
    x.engine.apply("host", x.envelope, {
      baseline: x.prepared,
      check: x.check,
    });
    const r = x.engine.rooms.get(x.room.code)!,
      anchor = r.anchor;
    x.advance(20);
    x.engine.apply("host", {
      opId: crypto.randomUUID(),
      mediaRevision: 0,
      command: { type: "duration", duration: 80 },
    });
    x.engine.apply("host", {
      opId: crypto.randomUUID(),
      mediaRevision: 0,
      command: { type: "seek", position: 10 },
    });
    expect(r.anchor).toBe(anchor);
    expect(expectedPosition(r, x.now())).toBe(10);
    x.engine.apply("host", {
      opId: crypto.randomUUID(),
      mediaRevision: 0,
      command: { type: "pause" },
    });
    expect(r.playing).toBe(false);
  });
});
