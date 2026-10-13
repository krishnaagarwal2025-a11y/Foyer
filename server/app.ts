import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { Engine, type Saved } from "./engine.js";
import { catalog } from "./catalog.js";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { mountMusic } from "./music.js";
import { CloudCoordinator } from "./cloud.js";
import { RedisRoomStore } from "./redis-store.js";
import { SyncProtocol } from "./sync-protocol.js";
import type { PlaybackPreparation } from "./engine.js";
import type { Result, Synchronization } from "../shared/types.js";
import { searchYouTube } from "./youtube-search.js";

export async function createApplication({
  cloud = false,
  dataDirectory = "data",
  syncTimeoutMs = Number(process.env.ROOM_SYNC_TIMEOUT_MS || 10000),
  musicSearch = searchYouTube,
} = {}) {
  let db: DatabaseSync | undefined;
  let save: ReturnType<DatabaseSync["prepare"]> | undefined;
  let remove: ReturnType<DatabaseSync["prepare"]> | undefined;
  if (!cloud) {
    mkdirSync(dataDirectory, { recursive: true });
    db = new DatabaseSync(path.resolve(dataDirectory, "watch-party.sqlite"));
    db.exec(
      "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS rooms(code TEXT PRIMARY KEY, snapshot TEXT NOT NULL); CREATE TABLE IF NOT EXISTS movies(id TEXT PRIMARY KEY, metadata TEXT NOT NULL);",
    );
    save = db.prepare("INSERT OR REPLACE INTO rooms VALUES (?,?)");
    remove = db.prepare("DELETE FROM rooms WHERE code=?");
    const seed = db.prepare("INSERT OR REPLACE INTO movies VALUES (?,?)");
    catalog.forEach((movie) => seed.run(movie.id, JSON.stringify(movie)));
  }
  const app = express(),
    http = createServer();
  if (cloud) {
    const normalize = (req: import("node:http").IncomingMessage) => {
      if (req.url?.startsWith("/api/foyer/"))
        req.url = req.url.slice("/api/foyer".length);
    };
    http.on("request", normalize);
    http.on("upgrade", normalize);
  }
  http.on("request", app);
  app.disable("x-powered-by");
  app.set(
    "trust proxy",
    Number(process.env.TRUST_PROXY_HOPS || (cloud ? 1 : 0)),
  );
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          baseUri: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          formAction: ["'self'"],
          scriptSrc: [
            "'self'",
            "https://www.youtube.com",
            "https://s.ytimg.com",
            "https://w.soundcloud.com",
          ],
          styleSrc: [
            "'self'",
            "'unsafe-inline'",
            "https://fonts.googleapis.com",
          ],
          fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
          imgSrc: ["'self'", "data:", "https:"],
          mediaSrc: ["'self'", "https:", "http:", "blob:"],
          connectSrc: ["'self'", "https:", "http:", "ws:", "wss:"],
          workerSrc: ["'self'", "blob:"],
          frameSrc: [
            "'self'",
            "https://www.youtube.com",
            "https://www.youtube-nocookie.com",
            "https://player.vimeo.com",
            "https://w.soundcloud.com",
          ],
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
      crossOriginResourcePolicy: { policy: "cross-origin" },
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    }),
  );
  app.use(
    "/api",
    rateLimit({
      windowMs: 60000,
      limit: 90,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: "Too many requests. Retry in a minute." },
    }),
  );
  app.use(express.json({ limit: "8kb" }));
  const origins = (
    process.env.ALLOWED_ORIGINS ||
    "http://localhost:5173,http://127.0.0.1:5173,https://www.netflix.com,https://www.primevideo.com,https://www.amazon.in,https://www.amazon.com,https://www.hotstar.com,https://www.jiohotstar.com"
  )
    .split(",")
    .map((value) => value.trim());
  if (cloud) {
    for (const name of ["VERCEL_URL", "VERCEL_PROJECT_PRODUCTION_URL"])
      if (process.env[name]) origins.push(`https://${process.env[name]}`);
  }
  const io = new Server(http, {
    maxHttpBufferSize: 16384,
    pingInterval: 10000,
    pingTimeout: 5000,
    cors: { origin: origins },
    allowRequest: (req, cb) => {
      const origin = req.headers.origin;
      cb(
        null,
        !origin ||
          /^chrome-extension:\/\/[a-p]{32}$/.test(origin) ||
          origins.includes(origin) ||
          origin === `http://${req.headers.host}` ||
          origin === `https://${req.headers.host}`,
      );
    },
  });
  let protocol: SyncProtocol;
  const emit = (event: import("./cloud").CloudEvent) => {
    if (event.type === "probe" || event.type === "probe-report") {
      void protocol?.receive(event).catch(() => {});
      return;
    }
    if (event.type === "sync-result") {
      io.to(event.code).emit("sync-checked", event.data);
      return;
    }
    io.to(event.code).emit(event.type, event.data);
    if (event.type === "closed") {
      io.in(event.code).socketsLeave(event.code);
      for (const [sid, session] of engine.sessions)
        if (session.code === event.code) {
          engine.sessions.delete(sid);
          engine.limits.delete(sid);
        }
      engine.rooms.delete(event.code);
      engine.tokens.delete(event.code);
      engine.operations.delete(event.code);
    }
  };
  let store: RedisRoomStore | undefined;
  let coordinator: CloudCoordinator | undefined;
  let engine: Engine;
  if (cloud) {
    const raw = process.env.REDIS_URL || process.env.KV_URL;
    if (!raw)
      throw Error("Foyer cloud deployment requires its shared Redis database.");
    const url = new URL(raw);
    if (url.protocol === "redis:") url.protocol = "rediss:";
    const namespace =
      process.env.FOYER_CLOUD_NAMESPACE ||
      (process.env.VERCEL_ENV === "production"
        ? "production"
        : `preview:${process.env.VERCEL_URL || "development"}`);
    store = new RedisRoomStore(url.href, namespace);
    coordinator = new CloudCoordinator(
      store,
      emit,
      undefined,
      Number(process.env.HOST_GRACE_MS || 15000),
    );
    engine = coordinator.engine;
    await store.connect(emit, () => coordinator!.resync());
  } else {
    engine = new Engine(
      (code, room) => io.to(code).emit("state", room),
      ({ room, tokens }) => {
        if (!room.participants.length) remove!.run(room.code);
        else save!.run(room.code, JSON.stringify({ room, tokens }));
      },
      undefined,
      Number(process.env.HOST_GRACE_MS || 15000),
      (code, data) => io.to(code).emit("reaction", data),
    );
    for (const row of db!.prepare("SELECT snapshot FROM rooms").all()) {
      try {
        engine.restore(JSON.parse(String(row.snapshot)) as Saved);
      } catch {}
    }
  }
  protocol = new SyncProtocol(
    io,
    () => engine.now(),
    async (code) => {
      const record = store ? await store.load(code) : undefined;
      return new Map(
        [...engine.sessions].flatMap(([sid, session]) => {
          if (session.code !== code || !io.sockets.sockets.has(sid)) return [];
          if (
            store &&
            (!record?.room.participants.some(
              (p) => p.id === session.id && p.connected,
            ) ||
              record.leases[session.id]?.owner !== sid)
          )
            return [];
          return [[sid, session.id] as [string, string]];
        }),
      );
    },
    async (event) => {
      if (store) await store.broadcast(event);
      else if (event.type === "sync-result") emit(event);
      else await protocol.receive(event);
    },
  );
  app.get("/api/catalog", (_req, res) =>
    res.json(
      db
        ? db
            .prepare("SELECT metadata FROM movies")
            .all()
            .map((row) => JSON.parse(String(row.metadata)))
        : catalog,
    ),
  );
  app.get("/api/health", async (_req, res) => {
    try {
      res.json({
        ok: true,
        rooms: store ? await store.count() : engine.rooms.size,
        storage: cloud ? "shared-redis" : "sqlite",
      });
    } catch {
      res.status(503).json({ ok: false, error: "Shared storage unavailable." });
    }
  });
  mountMusic(
    app,
    engine,
    store ? (movies) => store!.remember(movies) : undefined,
    musicSearch,
  );
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "API route not found." }),
  );
  app.use("/media", express.static(path.resolve("public/media")));
  app.use("/media", (_req, res) =>
    res.status(404).json({ error: "Media file not found." }),
  );
  app.use("/extension", express.static(path.resolve("public/extension")));
  app.get("/help", (_req, res) =>
    res.sendFile(path.resolve("public/help.html")),
  );
  app.use(express.static(path.resolve("dist")));
  app.get("/{*path}", (_req, res) =>
    res.sendFile(path.resolve("dist/index.html")),
  );
  const tasks = new Set<Promise<unknown>>();
  io.on("connection", (socket) => {
    let attempts = 0,
      tail = Promise.resolve();
    let windowAt = Date.now(),
      controls = 0;
    const enqueue = (work: () => Promise<void>) => {
      const task = tail.catch(() => {}).then(work);
      tasks.add(task);
      tail = task;
      void task.finally(() => tasks.delete(task)).catch(() => {});
    };
    const allowControl = () => {
      if (Date.now() - windowAt > 1000) {
        windowAt = Date.now();
        controls = 0;
      }
      return ++controls <= 20;
    };
    const snapshot = () =>
      coordinator
        ? coordinator.sync(socket.id)
        : Promise.resolve(engine.sync(socket.id));
    const transact = (data: unknown, preparation?: PlaybackPreparation) =>
      coordinator
        ? coordinator.apply(socket.id, data, preparation)
        : Promise.resolve(engine.apply(socket.id, data, preparation));
    const preparedPlay = async (data: unknown): Promise<Result> => {
      const current = await snapshot();
      if (!current.ok) return current;
      const prepared = engine.preparePlayback(socket.id, data);
      // Deduplicated successful operations have no room; do not probe them again.
      if (!prepared.ok || !prepared.room) return prepared;
      const check = await protocol.check(prepared.room, "play");
      return transact(data, { baseline: prepared.room, check });
    };
    const synchronizeRoom = async (data: unknown): Promise<Result> => {
      const current = await snapshot();
      if (!current.ok) return current;
      const prepared = engine.prepareRoomSync(socket.id, data);
      if (!prepared.ok || !prepared.room) return prepared;
      const started = await transact(data);
      if (!started.ok) return started;
      const paused = await snapshot(),
        barrier = paused.room?.syncBarrier;
      if (!paused.ok || !barrier)
        return { ok: false, error: "The room sync was cancelled." };
      const until =
        performance.now() + Math.max(200, Math.min(12000, syncTimeoutMs));
      let check: Synchronization | undefined;
      do {
        const fresh = await snapshot();
        if (
          !fresh.ok ||
          fresh.room?.syncBarrier?.id !== barrier.id ||
          fresh.room.syncBarrier.status !== "waiting"
        )
          return {
            ok: false,
            error: "The room sync was cancelled or the audience changed.",
          };
        check = await protocol.check(fresh.room, "manual");
        if (
          check.participants.every(
            (p) =>
              p.ready &&
              p.samples === 3 &&
              p.paused &&
              !p.autoplayBlocked &&
              p.alignmentMs !== undefined &&
              p.alignmentMs <= 80,
          )
        )
          break;
        if (performance.now() < until)
          await new Promise((resolve) => setTimeout(resolve, 200));
      } while (performance.now() < until);
      const result = await transact(
        {
          opId: crypto.randomUUID(),
          mediaRevision: barrier.mediaRevision,
          command: { type: "resyncFinish" },
        },
        { roomSyncId: barrier.id, check },
      );
      const final = await snapshot();
      return {
        ...result,
        room: final.room || result.room,
        synchronization: check,
      };
    };
    const startRoomSync = (data: unknown, ack: unknown) => {
      // Do not occupy the socket command queue during readiness waits: the host
      // must be able to cancel, and disconnect must still clear presence.
      const task = synchronizeRoom(data)
        .then((result) => {
          if (typeof ack === "function") ack(result);
        })
        .catch(() => {
          if (typeof ack === "function")
            ack({
              ok: false,
              error:
                "Room sync unavailable. Playback remains paused if the handshake began.",
            });
        });
      tasks.add(task);
      void task.finally(() => tasks.delete(task));
    };
    socket.on("clock", (_data, ack) => {
      if (typeof ack === "function") ack({ serverTime: engine.now() });
    });
    socket.on("join", (data, ack) => {
      if (typeof ack !== "function") return;
      if (++attempts > (cloud ? 80 : 12)) {
        ack({
          ok: false,
          error: "Too many join attempts. Reconnect and try again.",
        });
        return;
      }
      enqueue(async () => {
        try {
          const result = coordinator
            ? await coordinator.join(socket.id, data)
            : engine.join(socket.id, data);
          if (result.ok) await socket.join(result.room!.code);
          ack(result);
        } catch {
          ack({
            ok: false,
            error: "Room storage unavailable. Reconnect and retry.",
          });
        }
      });
    });
    socket.on("command", (data, ack) => {
      if (!allowControl()) {
        if (typeof ack === "function")
          ack({ ok: false, error: "Too many commands. Please slow down." });
        return;
      }
      if (data?.command?.type === "resync") {
        startRoomSync(data, ack);
        return;
      }
      enqueue(async () => {
        try {
          let result: Result;
          if (data?.command?.type === "play") result = await preparedPlay(data);
          else {
            const before = ["ended", "next"].includes(data?.command?.type)
              ? await snapshot()
              : undefined;
            result = await transact(data, { deferAutoAdvance: true });
            if (
              result.ok &&
              data?.command?.type === "library" &&
              !data.command.enqueue &&
              data.command.start
            ) {
              const after = await snapshot();
              if (after.room)
                result = await preparedPlay({
                  opId: crypto.randomUUID(),
                  mediaRevision: after.room.mediaRevision,
                  command: { type: "play" },
                });
            }
            if (
              result.ok &&
              before?.room &&
              (data?.command?.type === "next" ||
                before.room.settings.autoAdvance)
            ) {
              const after = await snapshot();
              if (
                after.room &&
                after.room.mediaRevision !== before.room.mediaRevision
              ) {
                result = await preparedPlay({
                  opId: crypto.randomUUID(),
                  mediaRevision: after.room.mediaRevision,
                  command: { type: "play" },
                });
              }
            }
          }
          if (typeof ack === "function") ack(result);
        } catch {
          if (typeof ack === "function")
            ack({
              ok: false,
              error: "Room transaction unavailable. Sync and retry.",
            });
        }
      });
    });
    socket.on("sync", (data, ack) => {
      if (typeof ack !== "function") return;
      if (!allowControl()) {
        ack({ ok: false, error: "Too many requests. Please slow down." });
        return;
      }
      if (
        !data ||
        typeof data !== "object" ||
        Array.isArray(data) ||
        !/^[\w-]{8,80}$/.test(String(data.opId || "")) ||
        !Number.isInteger(data.mediaRevision) ||
        Object.keys(data).some(
          (key) => !["opId", "mediaRevision"].includes(key),
        )
      ) {
        ack({ ok: false, error: "Invalid sync request." });
        return;
      }
      startRoomSync(
        {
          opId: data.opId,
          mediaRevision: data.mediaRevision,
          command: { type: "resync" },
        },
        ack,
      );
    });
    socket.on("disconnect", () =>
      enqueue(async () => {
        try {
          if (coordinator) await coordinator.disconnect(socket.id);
          else engine.disconnect(socket.id);
        } catch {}
      }),
    );
  });
  let ticking = false;
  const sweep = setInterval(
    () => {
      if (!coordinator) {
        engine.sweep();
        return;
      }
      if (ticking) return;
      ticking = true;
      void coordinator
        .heartbeat()
        .catch(() => {})
        .finally(() => {
          ticking = false;
        });
    },
    cloud ? 5000 : 1000,
  );
  sweep.unref();
  const checkpoint = cloud
    ? undefined
    : setInterval(() => {
        for (const room of engine.rooms.values())
          save!.run(
            room.code,
            JSON.stringify({ room, tokens: engine.tokens.get(room.code) }),
          );
      }, 10000);
  checkpoint?.unref();
  return {
    http,
    io,
    engine,
    async close() {
      clearInterval(sweep);
      if (checkpoint) clearInterval(checkpoint);
      io.close();
      await Promise.allSettled([...tasks]);
      http.close();
      store?.close();
      db?.close();
    },
  };
}
