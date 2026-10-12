import type { Express, Request } from "express";
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { Readable } from "node:stream";
import { z } from "zod";
import type { Engine } from "./engine.js";
import type { Movie } from "../shared/types.js";
const safeId = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
  signingKey = process.env.FOYER_STREAM_SECRET
    ? createHash("sha256").update(process.env.FOYER_STREAM_SECRET).digest()
    : randomBytes(32);
const endpoint = "https://api.audius.co/v1";
const enabled = () =>
  Boolean(
    process.env.NAVIDROME_URL &&
    process.env.NAVIDROME_USER &&
    process.env.NAVIDROME_PASSWORD &&
    process.env.NAVIDROME_ACCESS_CODE,
  );
function authorized(req: Request) {
  const value = String(req.headers["x-foyer-library-key"] || ""),
    expected = process.env.NAVIDROME_ACCESS_CODE || "";
  return (
    !!expected &&
    Buffer.byteLength(value) === Buffer.byteLength(expected) &&
    timingSafeEqual(Buffer.from(value), Buffer.from(expected))
  );
}
function navURL(method: string, extra: Record<string, string>) {
  const base = new URL(process.env.NAVIDROME_URL!);
  if (
    !["http:", "https:"].includes(base.protocol) ||
    base.username ||
    base.password
  )
    throw Error("Invalid Navidrome server configuration.");
  base.pathname = base.pathname.replace(/\/$/, "") + `/rest/${method}.view`;
  const salt = randomBytes(12).toString("hex");
  base.search = new URLSearchParams({
    u: process.env.NAVIDROME_USER!,
    t: createHash("md5")
      .update(process.env.NAVIDROME_PASSWORD! + salt)
      .digest("hex"),
    s: salt,
    v: "1.16.1",
    c: "Foyer",
    f: "json",
    ...extra,
  }).toString();
  return base;
}
export function mountMusic(
  app: Express,
  engine: Engine,
  remember?: (movies: Movie[]) => Promise<void>,
) {
  const cache = new Map<string, { expires: number; movies: Movie[] }>();
  app.get("/api/providers", (_req, res) =>
    res.json({
      audius: true,
      navidrome: enabled(),
      external: ["netflix", "prime", "hotstar"],
      externalStatus: "experimental",
      youtube: true,
      vimeo: true,
      soundcloud: true,
      hls: "on-demand",
    }),
  );
  app.get("/api/music", async (req, res) => {
    const parsed = z
      .object({
        provider: z.enum(["audius", "navidrome"]),
        q: z.string().trim().max(100).default(""),
      })
      .safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        error:
          "Choose a music provider and a search of at most 100 characters.",
      });
      return;
    }
    const { provider, q } = parsed.data;
    if (provider === "navidrome" && (!enabled() || !authorized(req))) {
      res.status(enabled() ? 403 : 503).json({
        error: enabled()
          ? "Enter the private library access code."
          : "Navidrome is not configured. Use Audius or local audio.",
      });
      return;
    }
    const cacheKey = `${provider}:${q}`,
      existing = cache.get(cacheKey);
    if (existing && existing.expires > Date.now()) {
      res.json(existing.movies);
      return;
    }
    try {
      let movies: Movie[] = [];
      if (provider === "audius") {
        const url = q
          ? `${endpoint}/tracks/search?query=${encodeURIComponent(q)}&limit=24&app_name=Foyer`
          : `${endpoint}/tracks/trending?limit=24&app_name=Foyer`;
        const response = await fetch(url, {
          signal: AbortSignal.timeout(10000),
          headers: process.env.AUDIUS_API_KEY
            ? { "X-API-Key": process.env.AUDIUS_API_KEY }
            : {},
        });
        if (!response.ok)
          throw Error(
            "Audius is temporarily unavailable. Try local audio or retry.",
          );
        const body = (await response.json()) as { data: Record<string, any>[] };
        if (!Array.isArray(body.data))
          throw Error("Audius returned an unexpected response.");
        movies = body.data
          .filter(
            (t) =>
              safeId.safeParse(t.id).success &&
              t.is_streamable &&
              !t.is_stream_gated &&
              Number(t.duration) > 0 &&
              Number(t.duration) <= 43200,
          )
          .slice(0, 24)
          .map((t) => ({
            id: `audius:${t.id}`,
            sourceId: t.id,
            provider: "audius",
            kind: "audio",
            title: String(t.title).slice(0, 100),
            artist: String(t.user?.name || "Audius artist").slice(0, 100),
            duration: Number(t.duration),
            description: String(
              t.description || "Artist-published music on Audius.",
            ).slice(0, 500),
            genres: [String(t.genre || "Music").slice(0, 40)],
            tags: [String(t.mood || "Discovery").slice(0, 40)],
            color: "#57bda8",
            url: `${endpoint}/tracks/${t.id}/stream?app_name=Foyer`,
            artwork:
              typeof t.artwork?.["480x480"] === "string" &&
              t.artwork["480x480"].startsWith("https://")
                ? t.artwork["480x480"]
                : undefined,
          }));
      } else {
        const response = await fetch(
          navURL("search3", {
            query: q || '""',
            songCount: "24",
            albumCount: "0",
            artistCount: "0",
          }),
          { signal: AbortSignal.timeout(10000) },
        );
        if (!response.ok) throw Error("Private library unavailable.");
        const body = (await response.json()) as any;
        const data = body["subsonic-response"];
        if (data?.status !== "ok")
          throw Error(
            "Navidrome authentication failed. Check server configuration.",
          );
        const songs = data.searchResult3?.song || [];
        movies = songs
          .filter(
            (t: any) =>
              safeId.safeParse(t.id).success &&
              t.duration > 0 &&
              t.duration <= 43200,
          )
          .slice(0, 24)
          .map((t: any) => ({
            id: `navidrome:${t.id}`,
            sourceId: t.id,
            provider: "navidrome",
            kind: "audio",
            title: String(t.title).slice(0, 100),
            artist: String(t.artist || "Your library").slice(0, 100),
            duration: Number(t.duration),
            description: "From your configured private Navidrome collection.",
            genres: [String(t.genre || "Music").slice(0, 40)],
            tags: ["Your library"],
            color: "#658bde",
            url: `/api/music/stream/navidrome/${t.id}`,
          }));
      }
      for (const movie of movies) engine.library.set(movie.id, movie);
      while (engine.library.size > 500)
        engine.library.delete(engine.library.keys().next().value!);
      if (remember) await remember(movies);
      cache.set(cacheKey, { movies, expires: Date.now() + 300000 });
      if (cache.size > 100) cache.delete(cache.keys().next().value!);
      res.json(movies);
    } catch (error) {
      res.status(502).json({
        error:
          error instanceof Error
            ? error.message
            : "Music provider unavailable.",
      });
    }
  });
  app.post("/api/music/ticket/:id", (req, res) => {
    const id = safeId.safeParse(req.params.id);
    if (!id.success || !enabled() || !authorized(req)) {
      res.status(403).json({ error: "Private library access code required." });
      return;
    }
    if (!engine.library.has(`navidrome:${id.data}`)) {
      res.status(404).json({ error: "Search the library again." });
      return;
    }
    const expires = Date.now() + 13 * 3600000,
      payload = `${id.data}:${expires}`,
      mac = createHmac("sha256", signingKey).update(payload).digest("hex");
    res.json({
      url: `/api/music/stream/navidrome/${id.data}?expires=${expires}&ticket=${mac}`,
    });
  });
  app.get("/api/music/stream/navidrome/:id", async (req, res) => {
    const id = safeId.safeParse(req.params.id),
      expires = Number(req.query.expires),
      ticket = String(req.query.ticket || "");
    const expected = createHmac("sha256", signingKey)
      .update(`${req.params.id}:${expires}`)
      .digest("hex");
    if (
      !id.success ||
      !enabled() ||
      !Number.isFinite(expires) ||
      expires < Date.now() ||
      ticket.length !== expected.length ||
      !timingSafeEqual(Buffer.from(ticket), Buffer.from(expected))
    ) {
      res
        .status(403)
        .json({ error: "Stream authorization expired. Reload the source." });
      return;
    }
    const abort = new AbortController();
    res.on("close", () => abort.abort());
    try {
      const response = await fetch(
        navURL("stream", { id: id.data, format: "mp3", maxBitRate: "192" }),
        {
          signal: abort.signal,
          headers: req.headers.range ? { Range: req.headers.range } : {},
        },
      );
      if (!response.ok || !response.body) {
        res.status(502).end();
        return;
      }
      res.status(response.status);
      for (const key of [
        "content-type",
        "content-length",
        "content-range",
        "accept-ranges",
      ]) {
        const value = response.headers.get(key);
        if (value) res.setHeader(key, value);
      }
      res.setHeader("Cache-Control", "private, no-store");
      Readable.fromWeb(response.body as any)
        .on("error", () => res.destroy())
        .pipe(res);
    } catch {
      if (!res.headersSent) res.status(502).end();
      else res.destroy();
    }
  });
}
