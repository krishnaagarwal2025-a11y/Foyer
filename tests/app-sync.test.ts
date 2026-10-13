import { catalog } from "../server/catalog";
import { it, expect, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { io, type Socket } from "socket.io-client";
import type { Result, Room } from "../shared/types";
import { createApplication } from "../server/app";

vi.mock("../server/youtube-search.js", () => ({
  searchYouTube: async () => [
    {
      id: "youtube:M7lc1UVf-VE",
      sourceId: "M7lc1UVf-VE",
      provider: "youtube",
      kind: "video",
      title: "Search fixture song",
      artist: "Fixture artist",
      duration: 255,
      genres: ["Music"],
      tags: [],
      description: "Metadata fixture, not a real provider search",
      color: "#777777",
      url: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
    },
  ],
}));
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const eventually = async (test: () => boolean) => {
  const until = Date.now() + 2000;
  while (!test() && Date.now() < until) await delay(10);
  expect(test()).toBe(true);
};

it("the actual application enforces host sync, pauses ten socket peers, waits for alignment, resumes, deduplicates and cancels", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "foyer-test-sync-"));
  const app = await createApplication({
    dataDirectory: directory,
    syncTimeoutMs: 600,
  });
  await new Promise<void>((resolve) =>
    app.http.listen(0, "127.0.0.1", resolve),
  );
  const base = `http://127.0.0.1:${(app.http.address() as any).port}`;
  const clients: Socket[] = [],
    states = new Map<Socket, Room>();
  let guestReady = true,
    checks = 0;
  const emit = (s: Socket, event: string, data: object) =>
    new Promise<Result>((resolve) => s.emit(event, data, resolve));
  const command = (s: Socket, type: string, extra = {}) =>
    emit(s, "command", {
      opId: crypto.randomUUID(),
      mediaRevision: 0,
      command: { type, ...extra },
    });
  const connect = async () => {
    const s = io(base, { transports: ["websocket"], forceNew: true });
    clients.push(s);
    s.on("state", (r) => states.set(s, r));
    // Synthetic player readiness. This is a transport/authority integration
    // test; the separate browser test measures actual playback and drift.
    s.on("sync-check", (p, ack) => {
      checks++;
      const now = performance.timeOrigin + performance.now();
      ack({
        id: p.id,
        sequence: p.sequence,
        mediaRevision: p.mediaRevision,
        clientReceivedAt: now,
        clientSentAt: now,
        ready: s === clients[1] ? guestReady : true,
        autoplayBlocked: false,
        paused: true,
        position: p.targetPosition ?? 0,
      });
    });
    await new Promise<void>((resolve) => s.once("connect", resolve));
    return s;
  };
  try {
    const host = await connect(),
      joined = await emit(host, "join", { name: "Host" }),
      code = joined.room!.code;
  app.engine.rooms.get(code)!.media = catalog[0];
    for (let i = 1; i < 10; i++)
      await emit(await connect(), "join", { name: `Viewer ${i}`, code });
    const guest = clients[1];
    expect(
      (
        await emit(guest, "sync", {
          opId: crypto.randomUUID(),
          mediaRevision: 0,
        })
      ).error,
    ).toContain("Only the host");
    expect((await emit(host, "sync", {})).ok).toBe(false);
    await command(host, "play");
    guestReady = false;
    const request = { opId: crypto.randomUUID(), mediaRevision: 0 };
    const resultPromise = emit(host, "sync", request);
    await eventually(() => !!app.engine.rooms.get(code)?.syncBarrier);
    expect(app.engine.rooms.get(code)!.playing).toBe(false);
    await delay(75);
    expect(app.engine.rooms.get(code)!.playing).toBe(false);
    guestReady = true;
    const result = await resultPromise;
    expect(result.ok).toBe(true);
    expect(result.room!.playing).toBe(true);
    expect(result.room!.anchor).toBeGreaterThan(
      result.synchronization!.checkedAt,
    );
    expect(result.synchronization!.participants).toHaveLength(10);
    expect(
      result.synchronization!.participants.every(
        (p) => p.samples === 3 && p.ready && p.alignmentMs === 0,
      ),
    ).toBe(true);
    const before = checks;
    expect((await emit(host, "sync", request)).ok).toBe(true);
    expect(checks).toBe(before);
    guestReady = false;
    const cancelPromise = emit(host, "sync", {
      opId: crypto.randomUUID(),
      mediaRevision: 0,
    });
    await eventually(
      () => app.engine.rooms.get(code)?.syncBarrier?.status === "waiting",
    );
    const start = performance.now();
    expect((await command(host, "pause")).ok).toBe(true);
    expect(performance.now() - start).toBeLessThan(500);
    expect((await cancelPromise).ok).toBe(false);
    expect(app.engine.rooms.get(code)!.playing).toBe(false);
    const failed = await emit(host, "sync", {
      opId: crypto.randomUUID(),
      mediaRevision: 0,
    });
    expect(failed.ok).toBe(false);
    expect(failed.error).toContain("Viewer 1");
    expect(app.engine.rooms.get(code)!.syncBarrier?.status).toBe("failed");
    guestReady = true;
    const search = await fetch(base + "/api/music?provider=youtube&q=fixture");
    const songs = await search.json();
    expect(songs[0].provider).toBe("youtube");
    expect(
      (
        await emit(guest, "command", {
          opId: crypto.randomUUID(),
          mediaRevision: 0,
          command: {
            type: "library",
            provider: "youtube",
            sourceId: "M7lc1UVf-VE",
            enqueue: false,
            start: true,
          },
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await emit(host, "command", {
          opId: crypto.randomUUID(),
          mediaRevision: 0,
          command: {
            type: "library",
            provider: "youtube",
            sourceId: "M7lc1UVf-VE",
            enqueue: false,
            start: true,
          },
        })
      ).ok,
    ).toBe(true);
    expect(app.engine.rooms.get(code)!.media.title).toBe("Search fixture song");
    expect(app.engine.rooms.get(code)!.playing).toBe(true);
  } finally {
    clients.forEach((s) => s.disconnect());
    await app.close();
    if (
      path
        .resolve(directory)
        .startsWith(path.resolve(tmpdir(), "foyer-test-sync-"))
    )
      rmSync(directory, { recursive: true, force: true });
  }
}, 15000);
