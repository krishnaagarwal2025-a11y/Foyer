import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { Engine, type Saved } from "./engine";
import { catalog } from "./catalog";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { mountMusic } from "./music";
mkdirSync("data", { recursive: true });
const db = new DatabaseSync("data/watch-party.sqlite");
db.exec(
  "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS rooms(code TEXT PRIMARY KEY, snapshot TEXT NOT NULL); CREATE TABLE IF NOT EXISTS movies(id TEXT PRIMARY KEY, metadata TEXT NOT NULL);",
);
const save = db.prepare("INSERT OR REPLACE INTO rooms VALUES (?,?)");
const remove = db.prepare("DELETE FROM rooms WHERE code=?");
const seed = db.prepare("INSERT OR REPLACE INTO movies VALUES (?,?)");
catalog.forEach((m) => seed.run(m.id, JSON.stringify(m)));
const app = express(),
  http = createServer(app);
app.disable("x-powered-by");
app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS || 0));
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
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
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
).split(",");
const io = new Server(http, {
  maxHttpBufferSize: 16384,
  cors: { origin: origins },
  allowRequest: (req, cb) => {
    const origin = req.headers.origin;
    cb(
      null,
        !origin || /^chrome-extension:\/\/[a-p]{32}$/.test(origin) ||
        origins.includes(origin) ||
        origin === `http://${req.headers.host}` ||
        origin === `https://${req.headers.host}`,
    );
  },
});
const engine = new Engine(
  (code, room) => io.to(code).emit("state", room),
  ({ room, tokens }) => {
    if (!room.participants.length) remove.run(room.code);
    else save.run(room.code, JSON.stringify({ room, tokens }));
  },
  undefined,
  Number(process.env.HOST_GRACE_MS || 15000),
  (code, data) => io.to(code).emit("reaction", data),
);
for (const row of db.prepare("SELECT snapshot FROM rooms").all()) {
  try {
    engine.restore(JSON.parse(String(row.snapshot)) as Saved);
  } catch {}
}
app.get("/api/catalog", (_req, res) =>
  res.json(
    db
      .prepare("SELECT metadata FROM movies")
      .all()
      .map((row) => JSON.parse(String(row.metadata))),
  ),
);
app.get("/api/health", (_req, res) =>
  res.json({ ok: true, rooms: engine.rooms.size }),
);
mountMusic(app, engine);
app.use("/api", (_req, res) =>
  res.status(404).json({ error: "API route not found." }),
);
app.use("/media", express.static(path.resolve("public/media")));
app.use("/media", (_req, res) =>
  res.status(404).json({ error: "Media file not found." }),
);
app.use("/extension", express.static(path.resolve("public/extension")));
app.get("/help", (_req, res) => res.sendFile(path.resolve("public/help.html")));
app.use(express.static(path.resolve("dist")));
app.get("/{*path}", (_req, res) =>
  res.sendFile(path.resolve("dist/index.html")),
);
io.on("connection", (socket) => {
  let attempts = 0;
  socket.on("clock", (_data, ack) => {
    if (typeof ack === "function") ack({ serverTime: engine.now() });
  });
  socket.on("join", (data, ack) => {
    if (typeof ack !== "function") return;
    if (++attempts > 12) {
      ack({
        ok: false,
        error: "Too many join attempts. Reconnect and try again.",
      });
      return;
    }
    const result = engine.join(socket.id, data);
    if (result.ok) socket.join(result.room!.code);
    ack(result);
  });
  socket.on("command", (data, ack) => {
    const result = engine.apply(socket.id, data);
    if (typeof ack === "function") ack(result);
  });
  socket.on("disconnect", () => engine.disconnect(socket.id));
});
const sweep = setInterval(() => engine.sweep(), 1000);
const checkpoint = setInterval(() => {
  for (const room of engine.rooms.values())
    save.run(
      room.code,
      JSON.stringify({ room, tokens: engine.tokens.get(room.code) }),
    );
}, 10000);
http.listen(Number(process.env.PORT || 3001), "0.0.0.0", () =>
  console.log(`Foyer server http://localhost:${process.env.PORT || 3001}`),
);
function shutdown() {
  clearInterval(sweep);
  clearInterval(checkpoint);
  io.close();
  http.close();
  db.close();
}
process.on("SIGINT", () => {
  shutdown();
  process.exit(0);
});
process.on("SIGTERM", () => {
  shutdown();
  process.exit(0);
});
