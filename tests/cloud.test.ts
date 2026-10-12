import { beforeEach, describe, expect, it } from "vitest";
import {
  CloudCoordinator,
  type CloudEvent,
  type CloudRecord,
  type RoomStore,
} from "../server/cloud";
import type { Movie } from "../shared/types";
import { expectedPosition } from "../shared/types";

class AtomicStore implements RoomStore {
  records = new Map<string, CloudRecord>();
  locks = new Map<string, string>();
  catalog = new Map<string, Movie>();
  events: CloudEvent[] = [];
  listeners: ((event: CloudEvent) => void)[] = [];
  rejectNext = false;
  async acquire(key: string, owner: string) {
    if (this.locks.has(key)) return false;
    this.locks.set(key, owner);
    return true;
  }
  async release(key: string, owner: string) {
    if (this.locks.get(key) === owner) this.locks.delete(key);
  }
  async load(code: string) {
    return structuredClone(this.records.get(code) || null);
  }
  async save(
    code: string,
    record: CloudRecord | null,
    lock: string,
    owner: string,
    events: CloudEvent[],
    creating = false,
  ) {
    if (this.rejectNext) {
      this.rejectNext = false;
      throw Error("Transaction expired");
    }
    if (this.locks.get(lock) !== owner || (creating && this.records.has(code)))
      throw Error("Transaction expired");
    if (record) this.records.set(code, structuredClone(record));
    else this.records.delete(code);
    for (const event of events) {
      this.events.push(structuredClone(event));
      this.listeners.forEach((listener) => listener(event));
    }
  }
  async count() {
    return this.records.size;
  }
  async remember(movies: Movie[]) {
    movies.forEach((movie) =>
      this.catalog.set(movie.id, structuredClone(movie)),
    );
  }
  async movie(id: string) {
    return structuredClone(this.catalog.get(id) || null);
  }
}
let store: AtomicStore,
  a: CloudCoordinator,
  b: CloudCoordinator,
  code: string,
  now: number;
let identity: { id: string; token: string };
const run = (
  node: CloudCoordinator,
  sid: string,
  command: Record<string, unknown>,
  opId = crypto.randomUUID(),
  revision?: number,
) =>
  node.apply(sid, {
    command,
    opId,
    mediaRevision: revision ?? store.records.get(code)!.room.mediaRevision,
  });
beforeEach(async () => {
  now = 100000;
  store = new AtomicStore();
  a = new CloudCoordinator(
    store,
    () => {},
    () => now,
    1000,
  );
  b = new CloudCoordinator(
    store,
    () => {},
    () => now,
    1000,
  );
  const result = await a.join("host", { name: "Host" });
  code = result.room!.code;
  identity = result.identity!;
  await b.join("guest", { name: "Guest", code });
});

describe("shared room authority across function instances", () => {
  it("syncs from shared authority rather than the stale instance cache without a playback mutation", async () => {
    await run(a, "host", { type: "seek", position: 24 });
    await run(a, "host", { type: "play" });
    now += 500;
    const before = structuredClone(store.records.get(code)!);
    const result = await b.sync("guest");
    expect(result.ok).toBe(true);
    expect(expectedPosition(result.room!, result.serverTime!)).toBe(24.5);
    expect(result.room!.version).toBe(before.room.version);
    expect(store.records.get(code)!.operations).toEqual(before.operations);
    expect(JSON.stringify(result)).not.toContain(identity.token);
    expect((await b.sync("unknown")).ok).toBe(false);
    store.records.get(code)!.leases[before.room.hostId].owner = "foreign-host";
    expect((await a.sync("host")).ok).toBe(false);
  });
  it("reconstructs a playing late join from durable anchors and publishes no private tokens", async () => {
    await run(a, "host", { type: "seek", position: 20 });
    await run(a, "host", { type: "play" });
    now += 1000;
    const other = new CloudCoordinator(
      store,
      () => {},
      () => now,
    );
    const result = await other.join("late", { name: "Late", code });
    expect(result.room!.participants).toHaveLength(3);
    expect(result.room!.playing).toBe(true);
    expect(expectedPosition(result.room!, now)).toBe(21);
    expect(JSON.stringify(store.events)).not.toContain(identity.token);
  });
  it("serializes concurrent collaborative actions across separate engines", async () => {
    await run(a, "host", {
      type: "settings",
      collaborative: true,
      autoAdvance: false,
    });
    const before = store.records.get(code)!.room.version;
    const results = await Promise.all([
      run(a, "host", { type: "seek", position: 11 }),
      run(b, "guest", { type: "seek", position: 22 }),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(store.records.get(code)!.room.version).toBe(before + 2);
    expect(
      store.events
        .filter((e) => e.type === "state")
        .slice(-2)
        .map((e) => (e.data as any).version),
    ).toEqual([before + 1, before + 2]);
  });
  it("binds permissions to authenticated membership and rejects stale media revisions", async () => {
    expect((await run(b, "guest", { type: "play" })).ok).toBe(false);
    expect(
      (
        await b.apply("stranger", {
          command: { type: "play" },
          opId: crypto.randomUUID(),
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await b.join("forged", {
          name: "Forged",
          code,
          identity: { id: identity.id, token: "x".repeat(64) },
        })
      ).ok,
    ).toBe(false);
    await run(a, "host", { type: "media", movieId: "demo-audio" });
    expect(
      (
        await run(
          a,
          "host",
          { type: "seek", position: 15 },
          crypto.randomUUID(),
          0,
        )
      ).ok,
    ).toBe(false);
  });
  it("preserves reconnect identity and deduplication when the participant moves to another instance", async () => {
    const operation = crypto.randomUUID();
    await run(
      a,
      "host",
      { type: "chat", text: "Once", spoiler: false },
      operation,
    );
    await a.disconnect("host");
    const resumed = await b.join("resumed", { name: "Host", code, identity });
    expect(resumed.identity).toEqual(identity);
    expect(resumed.room!.participants).toHaveLength(2);
    const version = store.records.get(code)!.room.version;
    await run(
      b,
      "resumed",
      { type: "chat", text: "Once", spoiler: false },
      operation,
    );
    expect(store.records.get(code)!.room.version).toBe(version);
    expect(store.records.get(code)!.room.chat).toHaveLength(1);
  });
  it("recovers identity after a crashed instance lease expires but before its grace period", async () => {
    expect(
      (await b.join("resumed", { name: "Host", code, identity })).error,
    ).toMatch(/Resume pending/);
    now += 15100;
    const resumed = await b.join("resumed", { name: "Host", code, identity });
    expect(resumed.ok).toBe(true);
    expect(resumed.room!.hostId).toBe(identity.id);
    expect(resumed.room!.participants).toHaveLength(2);
  });
  it("elects a host when a dead function cannot send disconnect, and fences the old session", async () => {
    now += 17000;
    await b.heartbeat();
    const room = store.records.get(code)!.room;
    expect(room.participants).toHaveLength(1);
    expect(room.hostId).toBe(room.participants[0].id);
    expect((await run(a, "host", { type: "play" })).ok).toBe(false);
    expect((await run(b, "guest", { type: "play" })).ok).toBe(true);
  });
  it("does not broadcast an uncommitted operation and safely retries a lost transaction", async () => {
    const operation = crypto.randomUUID(),
      before = store.records.get(code)!.room.version,
      events = store.events.length;
    store.rejectNext = true;
    await expect(
      run(a, "host", { type: "seek", position: 25 }, operation),
    ).rejects.toThrow(/expired/);
    expect(store.records.get(code)!.room.version).toBe(before);
    expect(store.events).toHaveLength(events);
    expect(
      (await run(a, "host", { type: "seek", position: 25 }, operation)).ok,
    ).toBe(true);
    expect(store.records.get(code)!.room.version).toBe(before + 1);
  });
  it("stores trusted music records for controls reaching a different instance", async () => {
    await store.remember([
      {
        id: "audius:abc",
        provider: "audius",
        kind: "audio",
        sourceId: "abc",
        title: "Track",
        url: "https://api.audius.co/v1/tracks/abc/stream",
        duration: 100,
        description: "Artist-published",
        genres: [],
        tags: [],
        color: "#abc",
      },
    ]);
    expect(
      (
        await run(b, "guest", {
          type: "library",
          provider: "audius",
          sourceId: "abc",
          enqueue: true,
        })
      ).ok,
    ).toBe(true);
    expect(store.records.get(code)!.room.queue[0].movie.title).toBe("Track");
  });
  it("leaves a failed creator able to retry and enforces the shared capacity", async () => {
    const fresh = new CloudCoordinator(
      store,
      () => {},
      () => now,
    );
    store.rejectNext = true;
    await expect(fresh.join("new", { name: "New" })).rejects.toThrow(/expired/);
    expect(fresh.engine.sessions.has("new")).toBe(false);
    expect((await fresh.join("new", { name: "New" })).ok).toBe(true);
    const original = store.records.get(code)!;
    for (let i = store.records.size; i < 500; i++)
      store.records.set(`key-${i}`, original);
    expect((await fresh.join("full", { name: "Full" })).error).toMatch(
      /room limit/,
    );
  });
});
