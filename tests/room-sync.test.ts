import { it, expect } from "vitest";
import { Engine } from "../server/engine";
import { expectedPosition, type Synchronization } from "../shared/types";

const setup = () => {
  let now = 10000;
  const e = new Engine(
    () => {},
    () => {},
    () => now,
  );
  const r = e.join("host", { name: "Host" }).room!;
  e.join("guest", { name: "Guest", code: r.code });
  const send = (sid: string, command: object, preparation?: any) =>
    e.apply(
      sid,
      {
        opId: crypto.randomUUID(),
        mediaRevision: e.rooms.get(r.code)!.mediaRevision,
        command,
      },
      preparation,
    );
  const check = (): Synchronization => ({
    id: "measurement",
    code: r.code,
    reason: "manual",
    mediaRevision: 0,
    checkedAt: now,
    participants: e.rooms
      .get(r.code)!
      .participants.filter((p) => p.connected)
      .map((p) => ({
        participantId: p.id,
        samples: 3,
        ready: true,
        autoplayBlocked: false,
        paused: true,
        alignmentMs: 4,
        position: 25,
        rttMs: 10,
      })),
  });
  return { e, code: r.code, send, check, advance: (ms: number) => (now += ms) };
};
it("host sync freezes the current timeline and only a complete aligned handshake schedules resume", () => {
  const s = setup();
  s.send("host", { type: "seek", position: 25 });
  s.send("host", { type: "play" });
  s.advance(400);
  expect(s.send("guest", { type: "resync" }).ok).toBe(false);
  s.send("host", { type: "settings", collaborative: true, autoAdvance: false });
  expect(s.send("guest", { type: "resync" }).ok).toBe(false);
  expect(s.send("host", { type: "resync" }).ok).toBe(true);
  const paused = s.e.rooms.get(s.code)!;
  const id = paused.syncBarrier!.id;
  expect(paused.playing).toBe(false);
  expect(paused.position).toBeCloseTo(25.4);
  s.advance(1500);
  expect(expectedPosition(paused, s.e.now())).toBeCloseTo(25.4);
  expect(s.send("host", { type: "resyncFinish" }).ok).toBe(false);
  expect(s.send("host", { type: "seek", position: 50 }).ok).toBe(false);
  expect(
    s.send(
      "host",
      { type: "resyncFinish" },
      { roomSyncId: id, check: s.check() },
    ).ok,
  ).toBe(true);
  expect(paused.syncBarrier).toBeUndefined();
  expect(paused.playing).toBe(true);
  expect(paused.anchor).toBeGreaterThan(s.e.now());
});
it("an unready or misaligned participant leaves the entire room paused with a useful error", () => {
  const s = setup();
  s.send("host", { type: "resync" });
  const room = s.e.rooms.get(s.code)!;
  const check = s.check();
  check.participants[1].alignmentMs = 120;
  const result = s.send(
    "host",
    { type: "resyncFinish" },
    { roomSyncId: room.syncBarrier!.id, check },
  );
  expect(result.ok).toBe(false);
  expect(result.error).toContain("Guest");
  expect(room.playing).toBe(false);
  expect(room.syncBarrier?.status).toBe("failed");
});
it("cancellation, stale reports and membership changes cannot resume an obsolete handshake", () => {
  const s = setup();
  s.send("host", { type: "resync" });
  const room = s.e.rooms.get(s.code)!;
  const id = room.syncBarrier!.id;
  s.send("host", { type: "pause" });
  expect(
    s.send(
      "host",
      { type: "resyncFinish" },
      { roomSyncId: id, check: s.check() },
    ).ok,
  ).toBe(false);
  s.send("host", { type: "resync" });
  const newer = room.syncBarrier!.id;
  const stale = s.check();
  stale.checkedAt = 0;
  expect(
    s.send(
      "host",
      { type: "resyncFinish" },
      { roomSyncId: newer, check: stale },
    ).ok,
  ).toBe(false);
  const beforeJoin = s.check();
  s.e.join("late", { name: "Late", code: s.code });
  expect(
    s.send(
      "host",
      { type: "resyncFinish" },
      { roomSyncId: newer, check: beforeJoin },
    ).ok,
  ).toBe(false);
  expect(room.playing).toBe(false);
});
it("duplicate sync operations never create another barrier and abandoned barriers expire paused", () => {
  const s = setup();
  const input = {
    opId: crypto.randomUUID(),
    mediaRevision: 0,
    command: { type: "resync" },
  };
  s.e.apply("host", input);
  const version = s.e.rooms.get(s.code)!.version;
  expect(s.e.prepareRoomSync("host", input)).toEqual({ ok: true });
  expect(s.e.apply("host", input)).toEqual({ ok: true });
  expect(s.e.rooms.get(s.code)!.version).toBe(version);
  s.advance(16000);
  s.e.sweep();
  expect(s.e.rooms.get(s.code)!.syncBarrier?.status).toBe("failed");
  expect(s.e.rooms.get(s.code)!.playing).toBe(false);
});
