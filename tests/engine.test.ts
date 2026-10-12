import { describe, it, expect, beforeEach } from "vitest";
import { Engine, type Saved } from "../server/engine";
import { expectedPosition, correction, type Room } from "../shared/types";
import { acceptSnapshot } from "../shared/sync";
let engine: Engine,
  now: number,
  code: string,
  host: string,
  guest: string,
  hostToken: { id: string; token: string },
  published: Room[],
  saved: Saved[];
const run = (
  socket: string,
  command: Record<string, unknown>,
  opId = crypto.randomUUID(),
  revision?: number,
) =>
  engine.apply(socket, {
    opId,
    mediaRevision: revision ?? engine.rooms.get(code)!.mediaRevision,
    command,
  });
beforeEach(() => {
  now = 100000;
  published = [];
  saved = [];
  engine = new Engine(
    (_c, r) => published.push(r),
    (s) => saved.push(structuredClone(s)),
    () => now,
    1000,
  );
  const a = engine.join("a", { name: "Host" });
  code = a.room!.code;
  host = a.identity!.id;
  hostToken = a.identity!;
  guest = engine.join("b", { name: "Guest", code }).identity!.id;
});
describe("room protocol and permissions", () => {
  it("rejects resume credentials without a room before allocating resources", () => {
    const count = engine.rooms.size;
    expect(
      engine.join("resume", { name: "Host", identity: hostToken }).ok,
    ).toBe(false);
    expect(engine.rooms.size).toBe(count);
  });
  it("creates secure rooms and joins by invite code", () => {
    expect(code).toMatch(/^[A-Z0-9]{6}$/);
    expect(hostToken.token).toHaveLength(64);
    expect(engine.rooms.get(code)!.participants).toHaveLength(2);
    expect(engine.rooms.get(code)!.hostId).toBe(host);
    expect(published.at(-1)!.participants).toHaveLength(2);
    expect(JSON.stringify(published)).not.toContain(hostToken.token);
  });
  it("rejects invalid codes, payloads and nonmembers", () => {
    expect(engine.join("c", { name: "X", code: "BAD" }).ok).toBe(false);
    expect(engine.join("c", { name: "X", code: "ZZZZZZ" }).ok).toBe(false);
    expect(engine.join("c", { name: " ".repeat(3) }).ok).toBe(false);
    expect(engine.apply("x", {}).ok).toBe(false);
    expect(
      engine.apply("a", {
        opId: "abcdefgh",
        command: { type: "seek", position: NaN },
      }).ok,
    ).toBe(false);
  });
  it("enforces host authority independently of room code", () => {
    expect(run("b", { type: "play" }).ok).toBe(false);
    expect(
      run("b", { type: "settings", collaborative: true, autoAdvance: false })
        .ok,
    ).toBe(false);
    expect(engine.rooms.get(code)!.playing).toBe(false);
  });
  it("serializes play pause seek with authoritative versions", () => {
    const start = engine.rooms.get(code)!.version;
    run("a", { type: "play" });
    now += 3000;
    run("a", { type: "pause" });
    expect(engine.rooms.get(code)!.position).toBe(3);
    run("a", { type: "seek", position: 20 });
    expect(engine.rooms.get(code)!.position).toBe(20);
    expect(engine.rooms.get(code)!.version).toBe(start + 3);
    expect(published.at(-1)!.playing).toBe(false);
  });
  it("reconstructs position for a late join while playing", () => {
    run("a", { type: "seek", position: 12 });
    run("a", { type: "play" });
    now += 4500;
    const late = engine.join("late", { name: "Late", code });
    expect(expectedPosition(late.room!, now)).toBe(16.5);
    expect(late.room!.media.url).toBe("/media/demo.mp4");
  });
  it("deduplicates operation IDs and resolves concurrent actions in server arrival order", () => {
    run("a", { type: "settings", collaborative: true, autoAdvance: false });
    const op = crypto.randomUUID(),
      v = engine.rooms.get(code)!.version;
    run("a", { type: "seek", position: 4 }, op);
    run("a", { type: "seek", position: 90 }, op);
    expect(engine.rooms.get(code)!.position).toBe(4);
    expect(engine.rooms.get(code)!.version).toBe(v + 1);
    run("b", { type: "seek", position: 9 });
    run("a", { type: "pause" });
    expect(engine.rooms.get(code)!.position).toBe(9);
  });
  it("rejects controls for stale media revisions", () => {
    run("a", { type: "media", movieId: "local-demo" });
    expect(run("a", { type: "play" }, crypto.randomUUID(), 0).ok).toBe(false);
    expect(engine.rooms.get(code)!.playing).toBe(false);
  });
  it("ignores stale and duplicate client snapshots", () => {
    const old = structuredClone(engine.rooms.get(code)!);
    run("a", { type: "play" });
    const fresh = engine.rooms.get(code)!;
    expect(acceptSnapshot(fresh, old)).toBe(fresh);
    expect(acceptSnapshot(fresh, structuredClone(fresh))).toBe(fresh);
    expect(acceptSnapshot(old, fresh)).toBe(fresh);
  });
  it("restores identity, preferences, playback and host within grace", () => {
    run("a", { type: "preferences", values: ["Drama"] });
    run("a", { type: "play" });
    now += 1000;
    engine.disconnect("a");
    now += 500;
    const result = engine.join("reconnected", {
      name: "Host",
      code,
      identity: hostToken,
    });
    expect(result.ok).toBe(true);
    expect(result.identity!.id).toBe(host);
    expect(result.room!.participants).toHaveLength(2);
    expect(result.room!.participants[0].preferences).toEqual(["Drama"]);
    expect(result.room!.hostId).toBe(host);
    expect(expectedPosition(result.room!, now)).toBe(1.5);
  });
  it("rejects forged tokens and simultaneous identity reuse", () => {
    engine.disconnect("a");
    expect(
      engine.join("c", {
        name: "Fake",
        code,
        identity: { ...hostToken, token: "x".repeat(64) },
      }).ok,
    ).toBe(false);
    expect(
      engine.join("c", { name: "Host", code, identity: hostToken }).ok,
    ).toBe(true);
    expect(
      engine.join("d", { name: "Host", code, identity: hostToken }).ok,
    ).toBe(false);
  });
  it("transfers host only to connected members", () => {
    expect(run("a", { type: "transfer", participantId: "missing" }).ok).toBe(
      false,
    );
    expect(run("b", { type: "transfer", participantId: guest }).ok).toBe(false);
    expect(run("a", { type: "transfer", participantId: guest }).ok).toBe(true);
    expect(run("a", { type: "play" }).ok).toBe(false);
    expect(run("b", { type: "play" }).ok).toBe(true);
  });
  it("elects a host after grace and expires old tokens", () => {
    now += 1;
    const c = engine.join("c", { name: "Third", code });
    engine.disconnect("a");
    now += 999;
    engine.sweep();
    expect(engine.rooms.get(code)!.hostId).toBe(host);
    now += 2;
    engine.sweep();
    expect(engine.rooms.get(code)!.hostId).toBe(guest);
    expect(
      engine.join("return", { name: "Host", code, identity: hostToken }).ok,
    ).toBe(false);
    expect(c.ok).toBe(true);
  });
  it("cleans empty rooms and checkpoints persisted state", () => {
    engine.disconnect("a");
    engine.disconnect("b");
    now += 1001;
    engine.sweep();
    expect(engine.rooms.size).toBe(0);
    expect(saved.at(-1)!.room.participants).toHaveLength(0);
  });
  it("restores server checkpoints paused and disconnected", () => {
    run("a", { type: "play" });
    now += 2000;
    const copy = new Engine(
      () => {},
      () => {},
      () => now,
      1000,
    );
    copy.restore(saved.at(-1)!);
    const restored = copy.rooms.get(code)!;
    expect(restored.position).toBe(2);
    expect(restored.playing).toBe(false);
    expect(restored.participants.every((p) => !p.connected)).toBe(true);
  });
  it("supports 10 participants and bounds room capacity", () => {
    for (let i = 0; i < 30; i++)
      expect(engine.join(`s${i}`, { name: `User ${i}`, code }).ok).toBe(true);
    expect(engine.rooms.get(code)!.participants).toHaveLength(32);
    expect(engine.join("overflow", { name: "Too many", code }).ok).toBe(false);
  });
});
describe("shared activity and bonuses", () => {
  it("shares chat and spoiler metadata safely without interpreting HTML", () => {
    run("b", {
      type: "chat",
      text: "<img src=x onerror=alert(1)>",
      spoiler: true,
    });
    const chat = published.at(-1)!.chat[0];
    expect(chat.name).toBe("Guest");
    expect(chat.spoiler).toBe(true);
    expect(chat.text).toContain("<img");
    expect(
      run("b", { type: "chat", text: "x".repeat(501), spoiler: false }).ok,
    ).toBe(false);
  });
  it("broadcasts reactions and rate limits command spam", () => {
    let reaction: unknown;
    engine.reaction = (_c, data) => (reaction = data);
    run("b", { type: "reaction", emoji: "🔥" });
    expect(reaction).toMatchObject({ name: "Guest", emoji: "🔥" });
    for (let i = 0; i < 20; i++) run("b", { type: "reaction", emoji: "🔥" });
    expect(run("b", { type: "reaction", emoji: "🔥" }).ok).toBe(false);
    now += 1001;
    expect(run("b", { type: "reaction", emoji: "🔥" }).ok).toBe(true);
  });
  it("synchronizes queue votes and selects the playable winner", () => {
    run("b", { type: "enqueue", movieId: "sample-1" });
    run("b", { type: "enqueue", movieId: "local-demo" });
    const q = engine.rooms.get(code)!.queue;
    run("b", { type: "queueVote", itemId: q[0].id });
    run("a", { type: "queueVote", itemId: q[1].id });
    expect(q[1].votes).toEqual([host]);
    run("a", { type: "next" });
    expect(engine.rooms.get(code)!.media.id).toBe("local-demo");
    expect(engine.rooms.get(code)!.queue).toHaveLength(1);
  });
  it("toggles votes and prevents unauthorized queue removal", () => {
    run("b", { type: "enqueue", movieId: "local-demo" });
    const q = engine.rooms.get(code)!.queue[0];
    run("b", { type: "queueVote", itemId: q.id });
    run("b", { type: "queueVote", itemId: q.id });
    expect(q.votes).toHaveLength(0);
    expect(run("b", { type: "remove", itemId: q.id }).ok).toBe(false);
    expect(run("a", { type: "remove", itemId: q.id }).ok).toBe(true);
  });
  it("validates poll voting and permits one changeable vote per participant", () => {
    run("b", {
      type: "poll",
      question: "Tonight?",
      options: ["Comedy", "Drama"],
    });
    const poll = engine.rooms.get(code)!.polls[0];
    run("b", { type: "vote", pollId: poll.id, option: 0 });
    run("b", { type: "vote", pollId: poll.id, option: 1 });
    expect(poll.votes).toEqual({ [guest]: 1 });
    expect(run("b", { type: "vote", pollId: poll.id, option: 4 }).ok).toBe(
      false,
    );
  });
  it("stores bookmarks at current authoritative position", () => {
    run("a", { type: "play" });
    now += 7300;
    run("b", { type: "bookmark", name: "Great scene" });
    expect(engine.rooms.get(code)!.bookmarks[0].position).toBe(7.3);
  });
  it("auto-advances at end to the winning playable item", () => {
    run("a", { type: "enqueue", movieId: "local-demo" });
    run("a", { type: "settings", collaborative: false, autoAdvance: true });
    run("a", { type: "ended" });
    const r = engine.rooms.get(code)!;
    expect(r.queue).toHaveLength(0);
    expect(r.position).toBe(0);
    expect(r.playing).toBe(true);
    expect(r.mediaRevision).toBe(1);
  });
  it("keeps Listen rooms audio-only, including items queued before a mode switch", () => {
    run("a", { type: "enqueue", movieId: "local-demo" });
    run("a", { type: "enqueue", movieId: "demo-audio" });
    run("a", { type: "mode", mode: "listen" });
    const room = engine.rooms.get(code)!;
    expect(room.queue.map((item) => item.movie.kind)).toEqual(["audio"]);
    expect(run("a", { type: "enqueue", movieId: "local-demo" }).error).toMatch(
      /audio/i,
    );
    expect(
      run("a", {
        type: "source",
        enqueue: true,
        media: {
          title: "Movie link",
          url: "https://media.example/movie.mp4",
          duration: 100,
        },
      }).error,
    ).toMatch(/audio/i);
  });
  it("distinguishes metadata and validates custom direct source URLs", () => {
    expect(run("a", { type: "media", movieId: "sample-1" }).ok).toBe(false);
    for (const url of [
      "javascript:alert(1)",
      "https://example.org/watch",
      "https://u:p@example.org/video.mp4",
    ])
      expect(
        run("a", { type: "custom", media: { title: "X", url, duration: 30 } })
          .ok,
      ).toBe(false);
    expect(
      run("a", {
        type: "custom",
        media: {
          title: "X",
          url: "https://example.org/video.webm",
          duration: 30,
        },
      }).ok,
    ).toBe(true);
  });
  it("bounds chat history and rejects unknown preferences", () => {
    for (let i = 0; i < 110; i++) {
      now += 1001;
      run("b", { type: "chat", text: `message ${i}`, spoiler: false });
    }
    expect(engine.rooms.get(code)!.chat).toHaveLength(100);
    expect(run("b", { type: "preferences", values: ["invalid"] }).ok).toBe(
      false,
    );
  });
});
describe("playback math", () => {
  it("uses anchor elapsed time only while playing and clamps position", () => {
    const r = engine.rooms.get(code)!;
    r.position = 10;
    r.anchor = 1000;
    r.playing = true;
    expect(expectedPosition(r, 2500)).toBe(11.5);
    expect(expectedPosition(r, 0)).toBe(10);
    expect(expectedPosition(r, 200000)).toBe(90);
    r.playing = false;
    expect(expectedPosition(r, 200000)).toBe(10);
  });
  it("seeks above 500 ms, rate corrects moderate drift and resets near stable", () => {
    expect(correction(0.8, true)).toEqual({ seek: true, rate: 1 });
    expect(correction(-0.4, true).rate).toBe(0.95);
    expect(correction(0.4, true).rate).toBe(1.05);
    expect(correction(0.04, true)).toEqual({ seek: false, rate: 1 });
    expect(correction(0.2, false)).toEqual({ seek: true, rate: 1 });
  });
});
