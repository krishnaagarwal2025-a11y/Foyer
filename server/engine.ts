import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { catalog } from "./catalog";
import {
  normalizeSource,
  isPlayable,
  isListeningSource,
} from "../shared/media";
import {
  expectedPosition,
  type Room,
  type Result,
  type Movie,
} from "../shared/types";
const name = z.string().trim().min(1).max(32);
const id = z.string().min(1).max(80);
const genre = z.enum([
  "Sci-Fi",
  "Drama",
  "Animation",
  "Documentary",
  "Thriller",
  "Adventure",
  "Mystery",
  "Comedy",
  "Cozy",
  "Wonder",
  "Energetic",
  "Thoughtful",
  "Together",
  "Escape",
]);
const media = z.object({
  title: z.string().trim().min(1).max(100),
  url: z.string().max(2000),
  duration: z.number().positive().max(43200),
});
const command = z.discriminatedUnion("type", [
  z.object({ type: z.literal("play") }),
  z.object({ type: z.literal("pause") }),
  z.object({
    type: z.literal("seek"),
    position: z.number().finite().min(0).max(43200),
  }),
  z.object({ type: z.literal("media"), movieId: id }),
  z.object({ type: z.literal("custom"), media }),
  z.object({ type: z.literal("mode"), mode: z.enum(["watch", "listen"]) }),
  z.object({
    type: z.literal("source"),
    media,
    enqueue: z.boolean().default(false),
  }),
  z.object({
    type: z.literal("library"),
    provider: z.enum(["audius", "navidrome"]),
    sourceId: id,
    enqueue: z.boolean().default(false),
  }),
  z.object({
    type: z.literal("duration"),
    duration: z.number().finite().positive().max(43200),
  }),
  z.object({
    type: z.literal("availability"),
    status: z.enum(["ready", "buffering", "ad", "unavailable"]),
  }),
  z.object({
    type: z.literal("chat"),
    text: z.string().trim().min(1).max(500),
    spoiler: z.boolean(),
  }),
  z.object({
    type: z.literal("reaction"),
    emoji: z.enum(["❤️", "🔥", "😂", "👏", "😮", "🎉"]),
  }),
  z.object({ type: z.literal("enqueue"), movieId: id }),
  z.object({ type: z.literal("remove"), itemId: id }),
  z.object({ type: z.literal("queueVote"), itemId: id }),
  z.object({ type: z.literal("next") }),
  z.object({
    type: z.literal("poll"),
    question: z.string().trim().min(1).max(140),
    options: z.array(z.string().trim().min(1).max(60)).min(2).max(5),
  }),
  z.object({
    type: z.literal("vote"),
    pollId: id,
    option: z.number().int().min(0).max(4),
  }),
  z.object({ type: z.literal("transfer"), participantId: id }),
  z.object({
    type: z.literal("settings"),
    collaborative: z.boolean(),
    autoAdvance: z.boolean(),
  }),
  z.object({ type: z.literal("preferences"), values: z.array(genre).max(8) }),
  z.object({
    type: z.literal("bookmark"),
    name: z.string().trim().min(1).max(60),
  }),
  z.object({
    type: z.literal("diagnostics"),
    drift: z.number().finite().min(-43200).max(43200),
  }),
  z.object({ type: z.literal("ended") }),
]);
const envelope = z.object({
  opId: z.string().min(8).max(80),
  mediaRevision: z.number().int().nonnegative().optional(),
  command,
});
type Credentials = { id: string; token: string };
type Session = { code: string; id: string };
export type Saved = { room: Room; tokens: Record<string, string> };
export class Engine {
  library = new Map<string, Movie>();
  rooms = new Map<string, Room>();
  tokens = new Map<string, Record<string, string>>();
  sessions = new Map<string, Session>();
  operations = new Map<string, Map<string, Result>>();
  deadlines = new Map<string, number>();
  limits = new Map<string, { start: number; count: number }>();
  constructor(
    public publish: (code: string, room: Room) => void = () => {},
    public persist: (saved: Saved) => void = () => {},
    public now: () => number = () => performance.timeOrigin + performance.now(),
    public grace = 15000,
    public reaction: (code: string, data: unknown) => void = () => {},
  ) {}
  restore(saved: Saved) {
    const r = saved.room;
    r.position = expectedPosition(r, this.now());
    r.anchor = this.now();
    r.playing = false;
    r.participants.forEach((p) => {
      p.connected = false;
      this.deadlines.set(p.id, this.now() + this.grace);
    });
    this.rooms.set(r.code, r);
    this.tokens.set(r.code, saved.tokens);
    this.operations.set(r.code, new Map());
  }
  snapshot(r: Room) {
    return structuredClone(r);
  }
  commit(r: Room) {
    r.version++;
    this.persist({ room: r, tokens: this.tokens.get(r.code)! });
    this.publish(r.code, this.snapshot(r));
  }
  join(socketId: string, input: unknown): Result {
    const parsed = z
      .object({
        name,
        mode: z.enum(["watch", "listen"]).optional(),
        code: z
          .string()
          .regex(/^[A-Z0-9]{6}$/)
          .optional(),
        identity: z
          .object({ id, token: z.string().min(32).max(128) })
          .optional(),
      })
      .safeParse(input);
    if (!parsed.success)
      return {
        ok: false,
        error: "Enter a name and a valid six-character room code.",
      };
    if (this.sessions.has(socketId))
      return { ok: false, error: "This connection has already joined a room." };
    const v = parsed.data;
    if (v.identity && !v.code)
      return { ok: false, error: "Provide a room code to resume an identity." };
    let r = v.code ? this.rooms.get(v.code) : undefined;
    if (v.code && !r)
      return { ok: false, error: "Room not found. Check your invitation." };
    if (!r) {
      if (this.rooms.size >= 500)
        return { ok: false, error: "Server room limit reached." };
      let code: string;
      do {
        code = randomBytes(4).toString("hex").slice(0, 6).toUpperCase();
      } while (this.rooms.has(code));
      r = {
        code,
        hostId: "",
        participants: [],
        media:
          v.mode === "listen"
            ? catalog.find((m) => m.id === "demo-audio")!
            : catalog[0],
        mediaRevision: 0,
        playing: false,
        position: 0,
        anchor: this.now(),
        version: 0,
        queue: [],
        polls: [],
        chat: [],
        bookmarks: [],
        settings: {
          collaborative: false,
          autoAdvance: false,
          mode: v.mode || "watch",
        },
      };
      this.rooms.set(code, r);
      this.tokens.set(code, {});
      this.operations.set(code, new Map());
    }
    let identity: Credentials;
    const existing =
      v.identity && r.participants.find((p) => p.id === v.identity!.id);
    if (v.identity) {
      if (
        !existing ||
        this.tokens.get(r.code)![v.identity.id] !== v.identity.token
      )
        return {
          ok: false,
          error:
            "Resume identity expired or invalid. Join again as a new participant.",
        };
      if (existing.connected)
        return {
          ok: false,
          error: "This identity is connected in another tab.",
        };
      identity = v.identity;
      existing.connected = true;
      existing.name = v.name;
      this.deadlines.delete(existing.id);
    } else {
      if (r.participants.length >= 32)
        return { ok: false, error: "Room is full (32 participants)." };
      identity = { id: randomUUID(), token: randomBytes(32).toString("hex") };
      this.tokens.get(r.code)![identity.id] = identity.token;
      r.participants.push({
        id: identity.id,
        name: v.name,
        joinedAt: this.now(),
        connected: true,
        preferences: [],
      });
      if (!r.hostId) r.hostId = identity.id;
    }
    this.sessions.set(socketId, { code: r.code, id: identity.id });
    this.commit(r);
    return {
      ok: true,
      room: this.snapshot(r),
      identity,
      serverTime: this.now(),
    };
  }
  disconnect(socketId: string) {
    const s = this.sessions.get(socketId);
    if (!s) return;
    this.sessions.delete(socketId);
    this.limits.delete(socketId);
    const r = this.rooms.get(s.code)!;
    const p = r.participants.find((p) => p.id === s.id);
    if (p) {
      p.connected = false;
      this.deadlines.set(p.id, this.now() + this.grace);
      this.commit(r);
    }
  }
  sweep() {
    for (const r of this.rooms.values()) {
      const expired = r.participants.filter(
        (p) =>
          !p.connected && (this.deadlines.get(p.id) || Infinity) <= this.now(),
      );
      if (!expired.length) continue;
      for (const p of expired) {
        this.deadlines.delete(p.id);
        delete this.tokens.get(r.code)![p.id];
        r.queue.forEach((q) => (q.votes = q.votes.filter((v) => v !== p.id)));
        r.polls.forEach((poll) => delete poll.votes[p.id]);
      }
      r.participants = r.participants.filter((p) => !expired.includes(p));
      if (!r.participants.length) {
        this.rooms.delete(r.code);
        this.tokens.delete(r.code);
        this.operations.delete(r.code);
        this.persist({ room: r, tokens: {} });
        continue;
      }
      if (!r.participants.some((p) => p.id === r.hostId))
        r.hostId = [...r.participants].sort(
          (a, b) =>
            Number(b.connected) - Number(a.connected) ||
            a.joinedAt - b.joinedAt ||
            a.id.localeCompare(b.id),
        )[0].id;
      this.commit(r);
    }
  }
  apply(socketId: string, input: unknown): Result {
    const s = this.sessions.get(socketId);
    if (!s) return { ok: false, error: "Join a room first." };
    const parsed = envelope.safeParse(input);
    if (!parsed.success)
      return { ok: false, error: "Invalid command payload." };
    const { opId, command: c, mediaRevision } = parsed.data,
      r = this.rooms.get(s.code)!,
      p = r.participants.find((p) => p.id === s.id)!;
    const ops = this.operations.get(s.code)!,
      key = `${s.id}:${opId}`;
    if (ops.has(key)) return ops.get(key)!;
    let limit = this.limits.get(socketId);
    if (!limit || this.now() - limit.start > 1000) {
      limit = { start: this.now(), count: 0 };
      this.limits.set(socketId, limit);
    }
    if (++limit.count > 20)
      return { ok: false, error: "Too many commands. Please slow down." };
    const host = r.hostId === s.id,
      controls = [
        "play",
        "pause",
        "seek",
        "media",
        "custom",
        "next",
        "ended",
        ...((c.type === "source" || c.type === "library") && !c.enqueue
          ? ["source", "library"]
          : []),
      ];
    if (c.type === "duration" && !host)
      return { ok: false, error: "Only the host can confirm media duration." };
    if (
      ["duration", "availability", "source", "library"].includes(c.type) &&
      mediaRevision !== r.mediaRevision
    )
      return { ok: false, error: "Media changed. Sync and try again." };
    if (controls.includes(c.type) && !host && !r.settings.collaborative)
      return { ok: false, error: "Only the host can control playback." };
    if (["transfer", "settings", "remove", "mode"].includes(c.type) && !host)
      return { ok: false, error: "Only the host can perform this action." };
    if (controls.includes(c.type) && mediaRevision !== r.mediaRevision)
      return { ok: false, error: "Media changed. Sync and try again." };
    const setMedia = (movie: Movie) => {
      r.media = movie;
      r.mediaRevision++;
      r.bookmarks = [];
      r.position = 0;
      r.anchor = this.now();
      r.playing = false;
    };
    const next = () => {
      const winner = r.queue
        .filter(
          (q) =>
            isPlayable(q.movie) &&
            (r.settings.mode !== "listen" || isListeningSource(q.movie)),
        )
        .sort((a, b) => b.votes.length - a.votes.length)[0];
      if (winner) {
        setMedia(winner.movie);
        r.queue = r.queue.filter((q) => q.id !== winner.id);
        return true;
      }
      return false;
    };
    switch (c.type) {
      case "mode":
        r.settings.mode = c.mode;
        if (c.mode === "listen")
          r.queue = r.queue.filter((item) => isListeningSource(item.movie));
        setMedia(
          catalog.find(
            (m) => m.id === (c.mode === "listen" ? "demo-audio" : "local-demo"),
          )!,
        );
        break;
      case "source": {
        let movie: Movie;
        try {
          movie = normalizeSource(c.media.url, c.media.title, c.media.duration);
        } catch (error) {
          return {
            ok: false,
            error: error instanceof Error ? error.message : "Invalid source.",
          };
        }
        if (r.settings.mode === "listen" && !isListeningSource(movie))
          return {
            ok: false,
            error:
              "Listen rooms accept audio or YouTube song links (with visible video).",
          };
        if (c.enqueue) {
          if (r.queue.length >= 50)
            return { ok: false, error: "Queue limit reached." };
          r.queue.push({ id: randomUUID(), movie, votes: [] });
        } else {
          setMedia(movie);
        }
        break;
      }
      case "library": {
        const movie = this.library.get(`${c.provider}:${c.sourceId}`);
        if (!movie)
          return {
            ok: false,
            error: "Search the music library again before adding this track.",
          };
        if (r.settings.mode === "listen" && !isListeningSource(movie))
          return { ok: false, error: "Listen rooms accept audio tracks only." };
        if (c.enqueue) {
          if (r.queue.length >= 50)
            return { ok: false, error: "Queue limit reached." };
          r.queue.push({ id: randomUUID(), movie, votes: [] });
        } else setMedia(movie);
        break;
      }
      case "duration": {
        const position = expectedPosition(r, this.now());
        r.media = { ...r.media, duration: c.duration };
        r.position = Math.min(position, c.duration);
        r.anchor = this.now();
        break;
      }
      case "availability":
        p.playbackStatus = c.status;
        break;
      case "play":
        r.position = expectedPosition(r, this.now());
        if (r.position >= r.media.duration) r.position = 0;
        r.anchor = this.now();
        r.playing = true;
        break;
      case "pause":
        r.position = expectedPosition(r, this.now());
        r.anchor = this.now();
        r.playing = false;
        break;
      case "seek":
        r.position = Math.min(c.position, r.media.duration);
        r.anchor = this.now();
        break;
      case "media":
      case "enqueue": {
        const movie = catalog.find((m) => m.id === c.movieId);
        if (!movie) return { ok: false, error: "Unknown catalog item." };
        if (c.type === "media") {
          if (r.settings.mode === "listen" && !isListeningSource(movie))
            return { ok: false, error: "Switch to Watch mode for this video." };
          if (!isPlayable(movie))
            return {
              ok: false,
              error: "Discovery sample only. Choose a playable source.",
            };
          setMedia(movie);
        } else {
          if (r.settings.mode === "listen" && !isListeningSource(movie))
            return {
              ok: false,
              error: "Listen rooms accept audio tracks only.",
            };
          if (r.queue.length >= 50)
            return { ok: false, error: "Queue limit reached." };
          r.queue.push({ id: randomUUID(), movie, votes: [] });
        }
        break;
      }
      case "custom": {
        let url: URL;
        try {
          url = new URL(c.media.url);
        } catch {
          return {
            ok: false,
            error: "Use a complete HTTP or HTTPS media URL.",
          };
        }
        if (
          !["http:", "https:"].includes(url.protocol) ||
          url.username ||
          url.password ||
          !/\.(mp4|webm|ogv|ogg)$/i.test(url.pathname)
        )
          return {
            ok: false,
            error:
              "Use a direct .mp4, .webm, .ogv or .ogg HTTP(S) URL without credentials.",
          };
        setMedia({
          id: randomUUID(),
          ...c.media,
          url: url.href,
          description: "Custom direct media source",
          genres: [],
          tags: [],
          color: "#8e83e9",
        });
        break;
      }
      case "chat":
        r.chat.push({
          id: randomUUID(),
          name: p.name,
          text: c.text,
          spoiler: c.spoiler,
          time: this.now(),
        });
        r.chat = r.chat.slice(-100);
        break;
      case "reaction":
        this.reaction(r.code, {
          id: randomUUID(),
          name: p.name,
          emoji: c.emoji,
        });
        break;
      case "remove":
        r.queue = r.queue.filter((q) => q.id !== c.itemId);
        break;
      case "queueVote": {
        const q = r.queue.find((q) => q.id === c.itemId);
        if (!q) return { ok: false, error: "Queue item no longer exists." };
        q.votes = q.votes.includes(s.id)
          ? q.votes.filter((v) => v !== s.id)
          : [...q.votes, s.id];
        break;
      }
      case "next":
        if (!next())
          return { ok: false, error: "No playable item in the queue." };
        break;
      case "ended":
        r.position = r.media.duration;
        r.anchor = this.now();
        r.playing = false;
        if (r.settings.autoAdvance && next()) r.playing = true;
        break;
      case "poll":
        if (r.polls.length >= 10) r.polls.shift();
        r.polls.push({
          id: randomUUID(),
          question: c.question,
          options: c.options,
          votes: {},
        });
        break;
      case "vote": {
        const poll = r.polls.find((p) => p.id === c.pollId);
        if (!poll || c.option >= poll.options.length)
          return { ok: false, error: "Invalid poll option." };
        poll.votes[s.id] = c.option;
        break;
      }
      case "transfer":
        if (
          !r.participants.some((p) => p.id === c.participantId && p.connected)
        )
          return { ok: false, error: "Choose a connected participant." };
        r.hostId = c.participantId;
        break;
      case "settings":
        r.settings = {
          ...r.settings,
          collaborative: c.collaborative,
          autoAdvance: c.autoAdvance,
        };
        break;
      case "preferences":
        p.preferences = [...new Set(c.values)];
        break;
      case "bookmark":
        if (r.bookmarks.length >= 50) r.bookmarks.shift();
        r.bookmarks.push({
          id: randomUUID(),
          name: c.name,
          position: expectedPosition(r, this.now()),
        });
        break;
      case "diagnostics":
        p.drift = c.drift;
        break;
    }
    r.lastOperation = { id: opId, type: c.type };
    this.commit(r);
    const result = { ok: true };
    ops.set(key, result);
    if (ops.size > 2000) ops.delete(ops.keys().next().value!);
    return result;
  }
}
