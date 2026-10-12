import React, {
  Suspense,
  lazy,
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";
import { createRoot } from "react-dom/client";
import { io, type Socket } from "socket.io-client";
import Fuse from "fuse.js";
import {
  expectedPosition,
  correction,
  type Room,
  type Movie,
  type Result,
  type Synchronization,
  type SyncProbe,
  type SyncClockPacket,
} from "../shared/types";
import { isListeningSource } from "../shared/media";
import { acceptSnapshot as accept, probeClockOffset } from "../shared/sync";
import "./style.css";
import "./provider.css";
import "./room.css";
import type { PlaybackHandle } from "./player/FoyerPlayer";
const FoyerPlayer = lazy(() =>
    import("./player/FoyerPlayer").then((module) => ({
      default: module.FoyerPlayer,
    })),
  ),
  MusicDiscovery = lazy(() =>
    import("./MusicDiscovery").then((module) => ({
      default: module.MusicDiscovery,
    })),
  );
const monotonic = () => performance.timeOrigin + performance.now();
const genres = [
  "Sci-Fi",
  "Drama",
  "Animation",
  "Documentary",
  "Thriller",
  "Adventure",
  "Mystery",
  "Comedy",
];
const moods = [
  "Cozy",
  "Wonder",
  "Energetic",
  "Thoughtful",
  "Together",
  "Escape",
];
const time = (n: number) =>
  `${Math.floor(n / 60)}:${Math.floor(n % 60)
    .toString()
    .padStart(2, "0")}`;
function App() {
  const [room, setRoom] = useState<Room | null>(null),
    [catalog, setCatalog] = useState<Movie[]>([]),
    [name, setName] = useState(sessionStorage.getItem("name") || ""),
    [code, setCode] = useState(
      new URLSearchParams(location.search).get("room") || "",
    ),
    [status, setStatus] = useState("Connecting"),
    [error, setError] = useState(""),
    [joining, setJoining] = useState(false),
    [self, setSelf] = useState(""),
    [tab, setTab] = useState("Chat"),
    [sidebarView, setSidebarView] = useState<"Room" | "Discover" | "People">(
      "Room",
    ),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("All"),
    [playable, setPlayable] = useState(true),
    [cinema, setCinema] = useState(false),
    [diagnostics, setDiagnostics] = useState(false),
    [rtt, setRtt] = useState(0),
    [drift, setDrift] = useState(0),
    [offset, setOffset] = useState(0),
    [blocked, setBlocked] = useState(false),
    [syncMessage, setSyncMessage] = useState(""),
    [syncing, setSyncing] = useState(false),
    [preparingPlay, setPreparingPlay] = useState(false),
    [protocolMessage, setProtocolMessage] = useState(""),
    [lastCheck, setLastCheck] = useState<Synchronization | null>(null),
    [playerAttempt, setPlayerAttempt] = useState(0),
    [videoError, setVideoError] = useState(""),
    [position, setPosition] = useState(0),
    [reactions, setReactions] = useState<
      { id: string; emoji: string; name: string }[]
    >([]),
    [copied, setCopied] = useState(false),
    [muted, setMuted] = useState(false),
    [entryMode, setEntryMode] = useState<"watch" | "listen">("watch");
  const socket = useRef<Socket | null>(null),
    video = useRef<PlaybackHandle | null>(null),
    latest = useRef<Room | null>(null),
    offsetRef = useRef(0),
    blockedRef = useRef(false),
    resume = useRef<{ code: string; name: string } | null>(null),
    loadedRevision = useRef(-1),
    manualSync = useRef<{
      id: string;
      expires: number;
      confirmed: boolean;
      adjusted: boolean;
    } | null>(null),
    playPending = useRef(false),
    syncRef = useRef<() => void>(() => {}),
    selfRef = useRef(""),
    playbackOperation = useRef<{
      id: string;
      type: string;
      version: number;
    } | null>(null);
  latest.current = room;
  selfRef.current = self;
  blockedRef.current = blocked;
  const join = useCallback(
    (roomCode?: string) => {
      const s = socket.current;
      if (!s?.connected) {
        setError("Wait for the server connection.");
        return;
      }
      if (!name.trim()) {
        setError("Enter your display name.");
        return;
      }
      setJoining(true);
      setError("");
      const target = roomCode?.trim().toUpperCase();
      let identity;
      try {
        identity = target
          ? JSON.parse(sessionStorage.getItem(`identity:${target}`) || "null")
          : null;
      } catch {}
      s.timeout(5000).emit(
        "join",
        {
          name: name.trim(),
          mode: entryMode,
          ...(target ? { code: target } : {}),
          ...(identity ? { identity } : {}),
        },
        (timeout: Error | null, result: Result) => {
          setJoining(false);
          if (timeout || !result?.ok) {
            if (target && result?.error?.startsWith("Resume identity expired"))
              sessionStorage.removeItem(`identity:${target}`);
            setError(
              timeout
                ? "Server did not respond. Try again."
                : result.error || "Unable to join.",
            );
            return;
          }
          const r = result.room!;
          manualSync.current = null;
          setSyncing(false);
          setSyncMessage("");
          setProtocolMessage("");
          setLastCheck(null);
          setSelf(result.identity!.id);
          sessionStorage.setItem("name", name.trim());
          sessionStorage.setItem(
            `identity:${r.code}`,
            JSON.stringify(result.identity),
          );
          resume.current = { code: r.code, name: name.trim() };
          setRoom((previous) => accept(previous, r));
          setCode(r.code);
          history.replaceState(null, "", `?room=${r.code}`);
        },
      );
    },
    [name, entryMode],
  );
  useEffect(() => {
    fetch("/api/catalog")
      .then((r) => r.json())
      .then(setCatalog)
      .catch(() => setError("Catalog unavailable. Check the server."));
    const s = io({
      transports: ["websocket"],
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 2000,
    });
    socket.current = s;
    let pingCount = 0;
    let resumeTimer: ReturnType<typeof setTimeout> | undefined;
    let lastProbe = "";
    const samples: { rtt: number; offset: number }[] = [];
    const ping = () => {
      if (!s.connected) return;
      const start = monotonic();
      s.timeout(3000).emit(
        "clock",
        {},
        (err: Error | null, v: { serverTime: number }) => {
          if (err || !v) return;
          const end = monotonic(),
            sample = {
              rtt: end - start,
              offset: v.serverTime - (start + end) / 2,
            };
          samples.push(sample);
          if (samples.length > 20) samples.shift();
          const best = [...samples].sort((a, b) => a.rtt - b.rtt).slice(0, 5);
          const estimate =
            best.reduce((sum, x) => sum + x.offset, 0) / best.length;
          offsetRef.current = estimate;
          window.dispatchEvent(
            new CustomEvent("watchparty:clock", {
              detail: { offset: estimate, rtt: sample.rtt },
            }),
          );
          setOffset(estimate);
          setRtt(sample.rtt);
        },
      );
    };
    s.on("connect", () => {
      samples.length = 0;
      pingCount = 0;
      setStatus("Connected");
      ping();
      const target = resume.current;
      if (target) {
        clearTimeout(resumeTimer);
        let identity = JSON.parse(
          sessionStorage.getItem(`identity:${target.code}`) || "null",
        );
        const reconnect = (attempt = 0) => {
          if (!s.connected) return;
          s.timeout(5000).emit(
            "join",
            { ...target, identity },
            (err: Error | null, result: Result) => {
              if (
                !err &&
                result?.error?.startsWith("Resume pending") &&
                attempt < 65
              ) {
                setStatus("Reconnecting");
                resumeTimer = setTimeout(() => reconnect(attempt + 1), 500);
                return;
              }
              if (
                !err &&
                result?.error?.startsWith("Resume identity expired") &&
                identity
              ) {
                sessionStorage.removeItem(`identity:${target.code}`);
                identity = undefined;
                reconnect(attempt + 1);
                return;
              }
              if (err || !result?.ok) {
                setError(
                  result?.error || "Reconnect failed. Reload to rejoin.",
                );
                setStatus("Resume failed");
                return;
              }
              sessionStorage.setItem(
                `identity:${target.code}`,
                JSON.stringify(result.identity),
              );
              setStatus("Connected");
              setError("");
              setRoom((previous) => accept(previous, result.room!));
              setSelf(result.identity!.id);
              syncRef.current();
            },
          );
        };
        reconnect();
      }
    });
    s.on("closed", () => {
      manualSync.current = null;
      setSyncing(false);
      setSyncMessage("");
      setProtocolMessage("");
      setLastCheck(null);
      resume.current = null;
      setRoom(null);
      setCode("");
      setError("This room expired. Create a new room to continue.");
      history.replaceState(null, "", "/");
    });
    s.on("disconnect", () => setStatus("Reconnecting"));
    s.on("connect_error", () => setStatus("Reconnecting"));
    s.on("state", (r: Room) => {
      if (
        r.lastOperation &&
        ["play", "pause", "seek"].includes(r.lastOperation.type) &&
        r.version > (playbackOperation.current?.version ?? -1)
      )
        playbackOperation.current = { ...r.lastOperation, version: r.version };
      window.dispatchEvent(
        new CustomEvent("watchparty:state", {
          detail: { room: r, time: performance.now() },
        }),
      );
      setRoom((previous) => accept(previous, r));
    });
    s.on(
      "sync-check",
      (
        packet: SyncProbe & { sequence: number; serverSentAt: number },
        ack: (reply: unknown) => void,
      ) => {
        const clientReceivedAt = monotonic(),
          r = latest.current,
          v = video.current;
        if (!r || packet.code !== r.code || typeof ack !== "function") return;
        setProtocolMessage(
          packet.reason === "play"
            ? "Checking device delays before starting…"
            : "Checking the room’s device delays…",
        );
        window.dispatchEvent(
          new CustomEvent("watchparty:probe", { detail: packet }),
        );
        ack({
          id: packet.id,
          sequence: packet.sequence,
          mediaRevision: r.mediaRevision,
          clientReceivedAt,
          clientSentAt: monotonic(),
          ready:
            packet.mediaRevision === r.mediaRevision &&
            loadedRevision.current === r.mediaRevision &&
            !!v &&
            v.readyState >= 2 &&
            v.seekable.length > 0 &&
            !v.buffering &&
            !v.seeking,
          autoplayBlocked: blockedRef.current,
        });
      },
    );
    s.on("sync-clock", (packet: SyncClockPacket) => {
      if (
        ![
          packet.rttMs,
          packet.serverSentAt,
          packet.serverReceivedAt,
          packet.clientReceivedAt,
          packet.clientSentAt,
        ].every(Number.isFinite)
      )
        return;
      if (lastProbe !== packet.id) {
        lastProbe = packet.id;
        samples.length = 0;
      }
      samples.push({ rtt: packet.rttMs, offset: probeClockOffset(packet) });
      if (samples.length > 20) samples.shift();
      const fastest = [...samples].sort((a, b) => a.rtt - b.rtt)[0];
      offsetRef.current = fastest.offset;
      setOffset(fastest.offset);
      setRtt(packet.rttMs);
      window.dispatchEvent(
        new CustomEvent("watchparty:clock", {
          detail: { offset: fastest.offset, rtt: packet.rttMs },
        }),
      );
    });
    s.on("sync-checked", (check: Synchronization) => {
      if (
        latest.current?.code !== check.code ||
        latest.current.mediaRevision !== check.mediaRevision
      )
        return;
      setLastCheck(check);
      const ready = check.participants.filter((p) => p.ready).length;
      setProtocolMessage(
        `Delay check: ${ready}/${check.participants.length} sources ready${ready < check.participants.length ? " · waiting devices will catch up" : ""}.`,
      );
    });
    s.on("reaction", (reaction) => {
      setReactions((old) => [...old.slice(-5), reaction]);
      setTimeout(
        () => setReactions((old) => old.filter((x) => x.id !== reaction.id)),
        3000,
      );
    });
    const timer = setInterval(() => {
      pingCount++;
      if (pingCount < 10 || pingCount % 5 === 0) ping();
    }, 1000);
    return () => {
      clearInterval(timer);
      clearTimeout(resumeTimer);
      s.disconnect();
    };
  }, []);
  const command = useCallback(
    (c: Record<string, unknown>) => {
      const s = socket.current,
        r = latest.current;
      if (!s?.connected || !r || status !== "Connected") {
        setError("Reconnect before sending commands.");
        return;
      }
      const envelope = {
        opId: crypto.randomUUID(),
        mediaRevision: r.mediaRevision,
        command: c,
      };
      if (c.type === "play") {
        setPreparingPlay(true);
        setProtocolMessage("Checking device delays before starting…");
      }
      window.dispatchEvent(
        new CustomEvent("watchparty:command", {
          detail: { ...envelope, time: performance.now() },
        }),
      );
      s.timeout(4000).emit(
        "command",
        envelope,
        (err: Error | null, result: Result) => {
          if (c.type === "play") setPreparingPlay(false);
          if (err && !s.connected) {
            setError(
              "Connection lost before confirmation. Sync after reconnecting.",
            );
          } else if (err) {
            setError("Command timed out. Retrying the same operation once.");
            s.timeout(4000).emit(
              "command",
              envelope,
              (again: Error | null, retry: Result) => {
                if (again || !retry?.ok)
                  setError(
                    retry?.error ||
                      "Command could not be confirmed. Sync before trying again.",
                  );
                else setError("");
              },
            );
          } else if (!result?.ok) {
            setError(result?.error || "Command rejected.");
            if (c.type === "play")
              setProtocolMessage(
                "Device check or playback request failed. Check the room message and retry.",
              );
          }
        },
      );
    },
    [status],
  );
  const canControl =
      !!room &&
      (room.hostId === self || room.settings.collaborative) &&
      status === "Connected",
    host = room?.hostId === self;
  const synchronize = useCallback(() => {
    const r = latest.current,
      v = video.current;
    const request = manualSync.current;
    if (request && performance.now() > request.expires) {
      manualSync.current = null;
      setSyncing(false);
      setSyncMessage(
        "Sync could not finish. Check the source or retry when buffering stops.",
      );
    }
    if (
      !r ||
      !v ||
      loadedRevision.current !== r.mediaRevision ||
      v.readyState < 2 ||
      !v.seekable.length
    )
      return;
    const expected = expectedPosition(r, monotonic() + offsetRef.current),
      delta = expected - v.currentTime;
    setDrift(delta);
    setPosition(v.currentTime);
    if (r.playing && monotonic() + offsetRef.current < r.anchor) {
      // The authoritative start is in the future. Hold, rather than playing
      // immediately on packet receipt and recreating inter-device latency.
      if (!v.paused) v.pause();
      v.playbackRate = 1;
      if (!v.seeking && !v.buffering && Math.abs(delta) > 0.15) {
        try {
          v.currentTime = expected;
        } catch {}
      }
      return;
    }
    // Provider buffering/seeking is asynchronous; repeated seeks/play calls can
    // continually restart its download. Wait for the observed transition.
    if (v.buffering || v.seeking) return;
    // Start/resume first. Seeking a paused iframe before it has started can
    // restart its buffer on every correction and prevent it ever catching up.
    if (r.playing && v.paused) {
      if (!blockedRef.current && !playPending.current) {
        playPending.current = true;
        v.play()
          .then(() => {
            if (video.current !== v) return;
            blockedRef.current = false;
            setBlocked(false);
          })
          .catch((failure: unknown) => {
            if (video.current !== v) return;
            const message =
              failure instanceof Error
                ? failure.message
                : "Playback could not start.";
            const needsClick =
              (failure instanceof Error &&
                failure.name === "NotAllowedError") ||
              /autoplay|blocked|did not start/i.test(message);
            blockedRef.current = needsClick;
            setBlocked(needsClick);
            if (!needsClick) setVideoError(message);
            if (manualSync.current) {
              manualSync.current = null;
              setSyncing(false);
              setSyncMessage(
                needsClick
                  ? "Playback was blocked. Click to sync and play, or allow playback in your browser."
                  : `Playback failed: ${message}`,
              );
            }
          })
          .finally(() => {
            if (video.current === v) playPending.current = false;
          });
      }
      return;
    }
    if (!r.playing && !v.paused) {
      v.pause();
      return;
    }
    const force = !!manualSync.current && !manualSync.current.adjusted;
    const fix = force
      ? { seek: Math.abs(delta) > 0.02, rate: 1 }
      : correction(delta, r.playing);
    if (v.supportsRate === false) {
      fix.rate = 1;
      if (!force) fix.seek = Math.abs(delta) > (r.playing ? 0.4 : 0.15);
    }
    if (force) manualSync.current!.adjusted = true;
    if (fix.seek) {
      try {
        v.currentTime = Math.min(expected, v.duration || expected);
      } catch {}
    }
    v.playbackRate = fix.rate;
    if (
      manualSync.current?.confirmed &&
      !v.seeking &&
      v.paused === !r.playing &&
      Math.abs(expected - v.currentTime) <= 0.5
    ) {
      manualSync.current = null;
      setSyncing(false);
      setSyncMessage("Synced to the room. Only your player was adjusted.");
    }
    if (
      r.version >= (playbackOperation.current?.version ?? -1) &&
      !v.seeking &&
      v.paused === !r.playing &&
      Math.abs(expected - v.currentTime) <= 0.5
    ) {
      window.dispatchEvent(
        new CustomEvent("watchparty:applied", {
          detail: {
            opId: playbackOperation.current?.id,
            command: { type: playbackOperation.current?.type },
            room: r,
            time: performance.now(),
            drift: expected - v.currentTime,
            readyState: v.readyState,
            paused: v.paused,
          },
        }),
      );
    }
  }, []);
  const syncNow = useCallback(() => {
    const s = socket.current,
      r = latest.current;
    if (!s?.connected || status !== "Connected" || !r) {
      setSyncMessage("Reconnect before syncing your player.");
      return;
    }
    if (r.media.kind === "external") return;
    if (manualSync.current) return;
    const request = {
      id: crypto.randomUUID(),
      expires: performance.now() + 12000,
      confirmed: false,
      adjusted: false,
    };
    manualSync.current = request;
    blockedRef.current = false;
    setBlocked(false);
    setSyncing(true);
    setSyncMessage("Syncing your player… waiting for the room and source.");
    // Invoke playback in the click/keyboard gesture, before awaiting the network.
    synchronize();
    s.timeout(5000).emit("sync", {}, (err: Error | null, result: Result) => {
      if (manualSync.current?.id !== request.id) return;
      if (latest.current?.code !== r.code) return;
      if (err || !result?.ok || !result.room || result.room.code !== r.code) {
        manualSync.current = null;
        setSyncing(false);
        setSyncMessage(
          result?.error ||
            "The room did not respond. Check your connection and retry.",
        );
        return;
      }
      const current = accept(latest.current, result.room);
      if (result.synchronization) setLastCheck(result.synchronization);
      latest.current = current;
      setRoom((previous) => accept(previous, current));
      request.confirmed = true;
      request.adjusted = false;
      synchronize();
    });
  }, [status, synchronize]);
  syncRef.current = synchronize;
  useEffect(() => {
    if (status !== "Connected" && manualSync.current) {
      manualSync.current = null;
      setSyncing(false);
      setSyncMessage("Connection lost. Sync again after reconnecting.");
    }
    if (status !== "Connected") setPreparingPlay(false);
  }, [status]);
  useEffect(() => {
    if (!room) return;
    if (room.media.kind === "external") {
      setPosition(expectedPosition(room, monotonic() + offsetRef.current));
      return;
    }
    synchronize();
    const interval = setInterval(synchronize, 100);
    const wait = room.playing
      ? room.anchor - (monotonic() + offsetRef.current)
      : 0;
    const startTimer =
      wait > 0 ? setTimeout(() => syncRef.current(), wait) : undefined;
    return () => {
      clearInterval(interval);
      clearTimeout(startTimer);
    };
  }, [room?.version, synchronize]);
  useEffect(() => {
    if (!room) return;
    loadedRevision.current = -1;
    playPending.current = false;
    setProtocolMessage("");
    setLastCheck(null);
    setVideoError("Loading source…");
    setBlocked(false);
    if (room.media.kind === "external") {
      setVideoError("");
      return;
    }
    video.current?.load();
  }, [room?.mediaRevision, room?.media.url]);
  useEffect(() => {
    if (!room) return;
    const timer = setInterval(
      () =>
        command({
          type: "diagnostics",
          drift:
            expectedPosition(latest.current!, monotonic() + offsetRef.current) -
            (video.current?.currentTime || 0),
        }),
      5000,
    );
    return () => clearInterval(timer);
  }, [!!room, command]);
  useEffect(() => {
    const visibility = () => synchronize();
    document.addEventListener("visibilitychange", visibility);
    const key = (e: KeyboardEvent) => {
      if (
        !latest.current ||
        e.altKey ||
        e.ctrlKey ||
        e.metaKey ||
        e.repeat ||
        (e.target instanceof HTMLElement &&
          (/INPUT|TEXTAREA|SELECT|BUTTON/.test(e.target.tagName) ||
            e.target.isContentEditable))
      )
        return;
      if (e.key.toLowerCase() === "c") setCinema((v) => !v);
      if (e.key.toLowerCase() === "s") syncNow();
      if (e.code === "Space") {
        e.preventDefault();
        if (canControl)
          command({ type: latest.current.playing ? "pause" : "play" });
      }
      if (["ArrowLeft", "ArrowRight"].includes(e.key) && canControl) {
        e.preventDefault();
        command({
          type: "seek",
          position: Math.max(
            0,
            expectedPosition(latest.current, monotonic() + offsetRef.current) +
              (e.key === "ArrowRight" ? 10 : -10),
          ),
        });
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("keydown", key);
    };
  }, [canControl, command, synchronize, syncNow]);
  const preferences = room?.participants.flatMap((p) => p.preferences) || [];
  const scored = catalog
    .filter((m) => room?.settings.mode !== "listen" || isListeningSource(m))
    .map((m) => {
      const matches = preferences.filter(
        (p) => m.genres.includes(p) || m.tags.includes(p),
      );
      return {
        ...m,
        score: matches.length,
        why: [...new Set(matches)].join(", "),
      };
    });
  const searched = query
    ? new Fuse(scored, { keys: ["title", "genres", "tags"], threshold: 0.38 })
        .search(query)
        .map((x) => x.item)
    : scored;
  const movies = searched
    .filter(
      (m) =>
        (filter === "All" ||
          m.genres.includes(filter) ||
          m.tags.includes(filter)) &&
        (!playable || !!m.url),
    )
    .sort((a, b) => b.score - a.score);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(
        `${location.origin}/?room=${room!.code}`,
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError(
        "Clipboard unavailable. Copy the invite URL from your address bar.",
      );
    }
  };
  if (!room)
    return (
      <div className="landing">
        <header className="site-header">
          <a className="brand" href="/">
            ◉{" "}
            <span>
              F<span className="accent">oyer</span>
            </span>
          </a>
          <span className="pill">YOUR PEOPLE. YOUR FOYER.</span>
        </header>
        <main className="welcome">
          <div className="hero-copy">
            <div className="eyebrow">GOOD STORIES. BETTER COMPANY.</div>
            <h1>
              Different places.
              <br />
              Same <em>moment.</em>
            </h1>
            <p>
              Bring your people, press play, and make a night of it. A private
              cinema with perfectly shared moments.
            </p>
            <div className="hero-tags">
              <span>↔ Synchronized playback</span>
              <span>✦ Shared discovery</span>
              <span>♡ Live reactions</span>
            </div>
            <div className="poster-scene">
              <div className="scene-orbit"></div>
              <span className="scene-caption">
                NOW SHOWING
                <br />
                <strong>A place to press play together.</strong>
              </span>
              <span className="scene-badge">WATCH · LISTEN · BELONG</span>
            </div>
          </div>
          <section className="entry-card">
            <div className="eyebrow">THE BEST SEAT IS NEXT TO FRIENDS</div>
            <h2>Welcome to Foyer.</h2>
            <div className="mode-switch" aria-label="Choose room type">
              {(["watch", "listen"] as const).map((mode) => (
                <button
                  key={mode}
                  className={entryMode === mode ? "active" : ""}
                  onClick={() => setEntryMode(mode)}
                >
                  {mode === "watch" ? "◉ Watch" : "♪ Listen"}
                </button>
              ))}
            </div>
            <p>No account. Just a name and your people.</p>
            <label htmlFor="display-name">Display name</label>
            <input
              id="display-name"
              placeholder="What should we call you?"
              maxLength={32}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button
              className="primary full"
              disabled={joining || status !== "Connected"}
              onClick={() => join()}
            >
              ＋ Create a room
            </button>
            <div className="divider">or join the party</div>
            <label htmlFor="room-code">Room code</label>
            <input
              id="room-code"
              value={code}
              placeholder="Six-character code"
              maxLength={6}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === "Enter") join(code);
              }}
            />
            <button
              className="secondary full"
              disabled={joining || status !== "Connected" || code.length !== 6}
              onClick={() => join(code)}
            >
              {joining ? "Opening your cinema…" : "Join room →"}
            </button>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            {error.includes("identity") && (
              <button
                onClick={() => {
                  sessionStorage.removeItem(`identity:${code}`);
                  setError("Identity cleared. Join again.");
                }}
              >
                Clear expired identity
              </button>
            )}
            <small className="connection">
              <i className={status === "Connected" ? "online" : ""} />
              {status} · Private by invitation
            </small>
          </section>
        </main>
        <footer>
          Built for shared moments, wherever you are.{" "}
          <span>Video, music and your people · Local demo included</span>
        </footer>
      </div>
    );
  return (
    <div className={`app ${cinema ? "cinema" : ""}`}>
      <header className="site-header">
        <a className="brand" href="/">
          ◉{" "}
          <span>
            F<span className="accent">oyer</span>
          </span>
        </a>
        <div className="mode-switch room-mode" aria-label="Room mode">
          {(["watch", "listen"] as const).map((mode) => (
            <button
              key={mode}
              className={
                (room.settings.mode || "watch") === mode ? "active" : ""
              }
              disabled={!host || status !== "Connected"}
              onClick={() => command({ type: "mode", mode })}
            >
              {mode === "watch" ? "◉ Watch" : "♪ Listen"}
            </button>
          ))}
        </div>
        <div className="room-label">
          <span className="live-dot" /> ROOM <strong>{room.code}</strong>
          <button className="small" onClick={copy}>
            {copied ? "Copied!" : "↗ Invite friends"}
          </button>
        </div>
        <span className="connection">
          <i className={status === "Connected" ? "online" : ""} />
          {status}
        </span>
      </header>
      {error && (
        <div className="alert" role="alert">
          {error}
          {status === "Resume failed" && (
            <button
              onClick={() => {
                sessionStorage.removeItem(`identity:${room.code}`);
                location.href = "/";
              }}
            >
              Return home and rejoin
            </button>
          )}
          <button aria-label="Dismiss error" onClick={() => setError("")}>
            ×
          </button>
        </div>
      )}
      <main className="room-layout">
        <section className="stage">
          <div className="section-heading">
            <div>
              <div className="eyebrow">THE SCREEN IS YOURS</div>
              <h1>{room.media.title}</h1>
            </div>
            <button className="secondary" onClick={() => setCinema((v) => !v)}>
              {cinema ? "Exit cinema" : "▣ Cinema mode"}
            </button>
          </div>
          <div className="player">
            <Suspense
              fallback={
                <div className="provider-loading" role="status">
                  Loading room player…
                </div>
              }
            >
              <FoyerPlayer
                key={`${room.mediaRevision}:${playerAttempt}`}
                ref={video}
                media={room.media}
                revision={room.mediaRevision}
                muted={muted}
                onProviderControl={(type, position) => {
                  const current = latest.current;
                  if (!current || !canControl) return false;
                  if (type !== "seek" && current.playing === (type === "play"))
                    return false;
                  command(type === "seek" ? { type, position } : { type });
                  return true;
                }}
                onReady={() => {
                  loadedRevision.current = room.mediaRevision;
                  setVideoError("");
                  const duration = video.current?.duration;
                  if (
                    host &&
                    duration &&
                    Number.isFinite(duration) &&
                    Math.abs(duration - room.media.duration) > 0.5
                  )
                    command({ type: "duration", duration });
                  synchronize();
                }}
                onPlaying={() => {
                  setVideoError("");
                  synchronize();
                }}
                onSeeked={() => synchronize()}
                onError={(message) => {
                  if (message.toLowerCase().includes("autoplay"))
                    setBlocked(true);
                  else setVideoError(message);
                }}
                onWaiting={() =>
                  setVideoError("Buffering… playback will catch up when ready.")
                }
                onEnded={() => {
                  if (host) command({ type: "ended" });
                }}
              />
            </Suspense>
            <div className="player-top">
              <span className="pill">
                {room.playing
                  ? room.anchor > monotonic() + offsetRef.current
                    ? "◷ STARTING TOGETHER"
                    : "● PLAYING TOGETHER"
                  : "Ⅱ PAUSED"}
              </span>
              <span className="pill">
                {room.media.kind === "external"
                  ? "Companion required"
                  : Math.abs(drift) <= 0.5
                    ? "In sync"
                    : "Catching up"}
              </span>
            </div>
            {blocked && (
              <button className="autoplay primary" onClick={syncNow}>
                Click to sync and play
              </button>
            )}
            {videoError && (
              <div className="video-message" role="status">
                {videoError}
                <button
                  onClick={() => {
                    loadedRevision.current = -1;
                    playPending.current = false;
                    blockedRef.current = false;
                    if (manualSync.current) manualSync.current.adjusted = false;
                    setBlocked(false);
                    setVideoError("Retrying source…");
                    setPlayerAttempt((attempt) => attempt + 1);
                  }}
                >
                  Retry source
                </button>
                {host && (
                  <button
                    onClick={() =>
                      command({
                        type: "media",
                        movieId:
                          room.settings.mode === "listen"
                            ? "demo-audio"
                            : "local-demo",
                      })
                    }
                  >
                    Use local demo
                  </button>
                )}
              </div>
            )}
            <div className="floating-reactions" aria-live="polite">
              {reactions.map((r) => (
                <span key={r.id} title={r.name}>
                  {r.emoji}
                </span>
              ))}
            </div>
          </div>
          {room.media.provider === "youtube" && room.media.url && (
            <p className="provider-attribution">
              YouTube · Provided by YouTube ·{" "}
              <a href={room.media.url} target="_blank" rel="noreferrer">
                Open original video ↗
              </a>
            </p>
          )}
          <div className="transport">
            <button
              aria-label={room.playing ? "Pause" : "Play"}
              disabled={!canControl || preparingPlay}
              onClick={() => command({ type: room.playing ? "pause" : "play" })}
            >
              {room.playing ? "Ⅱ" : "▶"}
            </button>
            <span>{time(position)}</span>
            <input
              aria-label="Seek playback"
              type="range"
              min="0"
              max={room.media.duration}
              step="0.1"
              value={Math.min(position, room.media.duration)}
              disabled={!canControl}
              onChange={(e) => {
                setPosition(Number(e.target.value));
                command({ type: "seek", position: Number(e.target.value) });
              }}
            />
            <span>{time(room.media.duration)}</span>
            <button
              aria-label="Toggle sound"
              disabled={room.media.kind === "external"}
              onClick={() => {
                if (video.current) {
                  video.current.muted = !video.current.muted;
                  setMuted(video.current.muted);
                }
              }}
            >
              {muted ? "🔇" : "🔊"}
            </button>
            <button
              className="small"
              onClick={syncNow}
              disabled={
                room.media.kind === "external" ||
                status !== "Connected" ||
                syncing
              }
              aria-describedby="sync-feedback"
            >
              {syncing ? "Syncing…" : "↔ Sync me now"}
            </button>
          </div>
          <p
            id="sync-feedback"
            className="sync-feedback"
            role="status"
            aria-live="polite"
          >
            {syncMessage}
          </p>
          {protocolMessage && (
            <p className="protocol-feedback" role="status">
              {protocolMessage}
            </p>
          )}
          <div className="under-player">
            <span>
              {host
                ? "You’re hosting"
                : `Hosted by ${room.participants.find((p) => p.id === room.hostId)?.name || "a reconnecting friend"}`}{" "}
              ·{" "}
              {room.settings.collaborative
                ? "Everyone can control"
                : "Host controls playback"}
            </span>
            <div className="reaction-bar">
              {["❤️", "🔥", "😂", "👏", "😮", "🎉"].map((emoji) => (
                <button
                  key={emoji}
                  aria-label={`React ${emoji}`}
                  disabled={status !== "Connected"}
                  onClick={() => command({ type: "reaction", emoji })}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
          <div className="tools-row">
            <button
              className="text-button"
              onClick={() => setDiagnostics((v) => !v)}
            >
              {diagnostics ? "Hide" : "Show"} sync diagnostics
            </button>
            <details className="shortcut-help">
              <summary>Keyboard shortcuts</summary>
              <p>Space play/pause · ← → seek · S sync · C cinema</p>
            </details>
          </div>
          {diagnostics && (
            <div className="diagnostic">
              <span>
                Device-check protocol <b>3 exchanges per connected device</b>
              </span>
              <span>
                RTT <b>{rtt.toFixed(1)} ms</b>
              </span>
              <span>
                Estimated drift <b>{(drift * 1000).toFixed(0)} ms</b>
              </span>
              <span>
                Clock offset <b>{offset.toFixed(1)} ms</b>
              </span>
              <span>
                {status} · state v{room.version}
              </span>
              <small>
                Clock estimate uses the five fastest recent round trips. Drift
                is sampled before correction; buffering and autoplay can delay
                application.
              </small>
            </div>
          )}
          {!cinema && (
            <>
              <details className="panel source-panel">
                <summary>
                  <span>＋ Add a link</span>
                  <small>YouTube, music or direct media</small>
                </summary>
                <div className="source-content">
                  <p className="muted">
                    Play a link or add it to the shared queue. The player checks
                    its duration.
                    <a href="/help" target="_blank" rel="noreferrer">
                      {" "}
                      Supported sources ↗
                    </a>
                  </p>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const data = new FormData(
                        e.currentTarget,
                        (e.nativeEvent as SubmitEvent).submitter,
                      );
                      command({
                        type: "source",
                        enqueue: data.get("action") === "queue",
                        media: {
                          title: String(data.get("title")),
                          url: String(data.get("url")),
                          duration: Number(data.get("duration")),
                        },
                      });
                    }}
                  >
                    <label>
                      Title
                      <input
                        name="title"
                        aria-label="Custom media title"
                        placeholder="Title"
                        maxLength={100}
                        required
                      />
                    </label>
                    <label className="source-url">
                      Media link
                      <input
                        name="url"
                        aria-label="Custom media URL"
                        type="url"
                        placeholder="YouTube, SoundCloud or a direct media URL"
                        required
                      />
                    </label>
                    <label className="source-duration">
                      Duration estimate (seconds)
                      <input
                        name="duration"
                        aria-label="Custom duration seconds"
                        type="number"
                        min="1"
                        max="43200"
                        defaultValue="600"
                        required
                      />
                    </label>
                    <div className="source-actions">
                      <button name="action" value="play" disabled={!canControl}>
                        {room.settings.mode === "listen"
                          ? "Play audio"
                          : "Load video"}
                      </button>
                      <button
                        name="action"
                        value="queue"
                        disabled={status !== "Connected"}
                      >
                        Add to queue
                      </button>
                    </div>
                  </form>
                </div>
              </details>
            </>
          )}
        </section>
        {!cinema && (
          <aside className="sidebar">
            <nav className="sidebar-nav" aria-label="Room tools">
              {(["Room", "Discover", "People"] as const).map((view) => (
                <button
                  key={view}
                  aria-pressed={sidebarView === view}
                  aria-controls={`sidebar-${view.toLowerCase()}`}
                  onClick={() => setSidebarView(view)}
                >
                  {view}
                  {view === "People" && (
                    <span className="nav-count">
                      {room.participants.length}
                    </span>
                  )}
                </button>
              ))}
            </nav>
            <div
              id="sidebar-discover"
              className="sidebar-page"
              hidden={sidebarView !== "Discover"}
            >
              {room.settings.mode === "listen" && (
                <Suspense
                  fallback={
                    <div className="panel" role="status">
                      Loading music discovery…
                    </div>
                  }
                >
                  <MusicDiscovery
                    command={command}
                    canControl={canControl}
                    connected={status === "Connected"}
                  />
                </Suspense>
              )}
              <section className="discovery panel">
                <div className="section-heading">
                  <div>
                    <div className="eyebrow">DISCOVER TOGETHER</div>
                    <h2>
                      {room.settings.mode === "listen"
                        ? "Your local listening library."
                        : "Find your next watch."}
                    </h2>
                  </div>
                  <span className="pill">{catalog.length} samples</span>
                </div>
                <div className="search-row">
                  <input
                    aria-label="Search movies"
                    placeholder="⌕ Search titles, genres or moods…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  <select
                    aria-label="Filter genre"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  >
                    {["All", ...genres, ...moods].map((g) => (
                      <option key={g}>{g}</option>
                    ))}
                  </select>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={playable}
                      onChange={(e) => setPlayable(e.target.checked)}
                    />
                    Playable only
                  </label>
                </div>
                <details className="discovery-help">
                  <summary>About these recommendations</summary>
                  <p className="muted">
                    Matches use the group’s genres and moods. Sample titles are
                    discovery metadata; only playable cards have media.
                  </p>
                </details>
                <div className="movie-grid">
                  {movies.slice(0, 12).map((m, i) => (
                    <article className="movie" key={m.id}>
                      <div
                        className="movie-art"
                        style={
                          { "--movie-color": m.color } as React.CSSProperties
                        }
                      >
                        <span className="movie-number">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <span>
                          {m.url
                            ? m.kind === "audio"
                              ? "♪ LOCAL AUDIO"
                              : "▶ LOCAL & PLAYABLE"
                            : "DISCOVERY SAMPLE"}
                        </span>
                        <strong>{m.title}</strong>
                      </div>
                      <h3>{m.title}</h3>
                      <small>
                        {m.genres.join(" · ")} · {Math.round(m.duration / 60)}{" "}
                        min
                      </small>
                      <details className="movie-description">
                        <summary>About this title</summary>
                        <p>{m.description}</p>
                      </details>
                      {m.score > 0 && (
                        <p className="match">
                          ✦ {m.score} preference matches: {m.why}
                        </p>
                      )}
                      <div className="card-actions">
                        <button
                          disabled={status !== "Connected"}
                          onClick={() =>
                            command({ type: "enqueue", movieId: m.id })
                          }
                        >
                          ＋ Queue
                        </button>
                        {m.url && (
                          <button
                            disabled={!canControl}
                            onClick={() =>
                              command({ type: "media", movieId: m.id })
                            }
                          >
                            {m.kind === "audio" ? "Listen" : "Watch"}
                          </button>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
                {!movies.length && (
                  <div className="empty">
                    No matches. Try another title, genre or mood.
                  </div>
                )}
                {movies.length > 12 && (
                  <p className="muted">
                    Showing the top 12 matches. Narrow your search to find more.
                  </p>
                )}
              </section>
            </div>
            <section
              className="panel participants sidebar-page"
              id="sidebar-people"
              hidden={sidebarView !== "People"}
            >
              <div className="section-heading">
                <h2>Your people</h2>
                <span className="count">{room.participants.length}</span>
              </div>
              {room.participants.map((p, i) => (
                <div className="participant" key={p.id}>
                  <div
                    className="avatar"
                    style={{
                      background: ["#513b78", "#314e65", "#704c36", "#375b52"][
                        i % 4
                      ],
                    }}
                  >
                    {p.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <strong>
                      {p.name}
                      {p.id === self ? " (you)" : ""}
                    </strong>
                    <small>
                      {p.id === room.hostId ? "♛ Host · " : ""}
                      {p.connected
                        ? p.drift === undefined
                          ? "Connected"
                          : Math.abs(p.drift) <= 0.5
                            ? "In sync"
                            : "Catching up"
                        : "Reconnecting…"}
                    </small>
                    {(() => {
                      const check =
                        lastCheck?.mediaRevision === room.mediaRevision
                          ? lastCheck
                          : room.synchronization;
                      const measurement = check?.participants.find(
                        (x) => x.participantId === p.id,
                      );
                      return (
                        measurement && (
                          <small className="device-delay">
                            Last check:{" "}
                            {measurement.rttMs === null
                              ? "no response"
                              : `${measurement.rttMs.toFixed(0)} ms RTT`}{" "}
                            ·{" "}
                            {measurement.ready
                              ? "source ready"
                              : "waiting for source"}
                            {measurement.autoplayBlocked
                              ? " · needs a click"
                              : ""}
                          </small>
                        )
                      );
                    })()}
                  </div>
                  {host && p.id !== self && (
                    <button
                      className="small"
                      aria-label={`Transfer host to ${p.name}`}
                      disabled={!p.connected || status !== "Connected"}
                      onClick={() =>
                        command({ type: "transfer", participantId: p.id })
                      }
                    >
                      Make host
                    </button>
                  )}
                </div>
              ))}
              <details>
                <summary>Your movie preferences</summary>
                <div className="preference-tags">
                  {[...genres, ...moods].map((g) => {
                    const values =
                      room.participants.find((p) => p.id === self)
                        ?.preferences || [];
                    return (
                      <button
                        key={g}
                        className={values.includes(g) ? "selected" : ""}
                        disabled={status !== "Connected"}
                        onClick={() =>
                          command({
                            type: "preferences",
                            values: values.includes(g)
                              ? values.filter((v) => v !== g)
                              : [...values, g].slice(-8),
                          })
                        }
                      >
                        {g}
                      </button>
                    );
                  })}
                </div>
              </details>
              {host && (
                <details>
                  <summary>Room settings</summary>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={room.settings.collaborative}
                      disabled={status !== "Connected"}
                      onChange={(e) =>
                        command({
                          type: "settings",
                          collaborative: e.target.checked,
                          autoAdvance: room.settings.autoAdvance,
                        })
                      }
                    />
                    Everyone controls playback
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={room.settings.autoAdvance}
                      disabled={status !== "Connected"}
                      onChange={(e) =>
                        command({
                          type: "settings",
                          collaborative: room.settings.collaborative,
                          autoAdvance: e.target.checked,
                        })
                      }
                    />
                    Auto-play winning queued video
                  </label>
                </details>
              )}
            </section>
            <section
              className="panel social sidebar-page"
              id="sidebar-room"
              hidden={sidebarView !== "Room"}
            >
              <div className="activity-heading">
                <h2>Your room</h2>
                <p>Chat, plan the next watch, or save a moment.</p>
              </div>
              <nav className="tabs" aria-label="Room activity">
                {["Chat", "Queue", "Polls", "Moments"].map((t) => (
                  <button
                    aria-pressed={tab === t}
                    className={tab === t ? "active" : ""}
                    key={t}
                    onClick={() => setTab(t)}
                  >
                    {t}
                    {t === "Queue" && room.queue.length
                      ? ` ${room.queue.length}`
                      : ""}
                  </button>
                ))}
              </nav>
              {tab === "Chat" && (
                <ChatPanel
                  room={room}
                  command={command}
                  disabled={status !== "Connected"}
                />
              )}
              {tab === "Queue" && (
                <div className="tab-content">
                  <div className="section-heading">
                    <h3>Watch next</h3>
                    <button
                      disabled={
                        !canControl || !room.queue.some((q) => q.movie.url)
                      }
                      onClick={() => command({ type: "next" })}
                    >
                      Play winner
                    </button>
                  </div>
                  <p className="muted">
                    Vote together. The highest-voted playable item goes next;
                    ties follow queue order.
                  </p>
                  {!room.queue.length && (
                    <div className="empty">
                      Your next feature awaits.
                      <br />
                      <button
                        className="text-button"
                        onClick={() => setSidebarView("Discover")}
                      >
                        Find something in Discover →
                      </button>
                    </div>
                  )}
                  {room.queue.map((q) => (
                    <div className="queue-item" key={q.id}>
                      <strong>{q.movie.title}</strong>
                      <small>
                        {q.movie.url ? "Playable" : "Discovery only"}
                      </small>
                      <button
                        disabled={status !== "Connected"}
                        className={q.votes.includes(self) ? "selected" : ""}
                        onClick={() =>
                          command({ type: "queueVote", itemId: q.id })
                        }
                      >
                        ↑ {q.votes.length} votes
                      </button>
                      {host && (
                        <button
                          disabled={status !== "Connected"}
                          aria-label={`Remove ${q.movie.title}`}
                          onClick={() =>
                            command({ type: "remove", itemId: q.id })
                          }
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {tab === "Polls" && (
                <div className="tab-content">
                  <h3>Let the group decide</h3>
                  {room.polls.map((p) => (
                    <div className="poll" key={p.id}>
                      <strong>{p.question}</strong>
                      {p.options.map((o, i) => (
                        <button
                          key={i}
                          className={p.votes[self] === i ? "selected" : ""}
                          disabled={status !== "Connected"}
                          onClick={() =>
                            command({ type: "vote", pollId: p.id, option: i })
                          }
                        >
                          {o}
                          <span>
                            {
                              Object.values(p.votes).filter((v) => v === i)
                                .length
                            }
                          </span>
                        </button>
                      ))}
                      <small>
                        {Object.keys(p.votes).length} votes · one choice per
                        participant
                      </small>
                    </div>
                  ))}
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const data = new FormData(e.currentTarget);
                      command({
                        type: "poll",
                        question: String(data.get("question")),
                        options: String(data.get("options"))
                          .split(",")
                          .map((v) => v.trim())
                          .filter(Boolean),
                      });
                      e.currentTarget.reset();
                    }}
                  >
                    <label>
                      New poll
                      <input
                        name="question"
                        placeholder="What are we watching next?"
                        required
                        maxLength={140}
                      />
                    </label>
                    <label>
                      Options (2–5, comma separated)
                      <input
                        name="options"
                        placeholder="Adventure, Comedy"
                        required
                        maxLength={300}
                      />
                    </label>
                    <button
                      className="primary"
                      disabled={status !== "Connected"}
                    >
                      Create poll
                    </button>
                  </form>
                </div>
              )}
              {tab === "Moments" && (
                <div className="tab-content">
                  <h3>Moments worth remembering</h3>
                  {room.bookmarks.map((b) => (
                    <button
                      className="bookmark"
                      key={b.id}
                      disabled={!canControl}
                      onClick={() =>
                        command({ type: "seek", position: b.position })
                      }
                    >
                      {time(b.position)} <strong>{b.name}</strong>
                    </button>
                  ))}
                  {!room.bookmarks.length && (
                    <p className="empty">Save a shared timestamp.</p>
                  )}
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const data = new FormData(e.currentTarget);
                      command({
                        type: "bookmark",
                        name: String(data.get("name")),
                      });
                      e.currentTarget.reset();
                    }}
                  >
                    <input
                      name="name"
                      aria-label="Moment name"
                      placeholder="Name this moment…"
                      required
                      maxLength={60}
                    />
                    <button disabled={status !== "Connected"}>
                      ＋ Save at {time(position)}
                    </button>
                  </form>
                </div>
              )}
            </section>
          </aside>
        )}
      </main>
      <footer>
        Foyer · Together, from anywhere.<span>Room {room.code}</span>
      </footer>
    </div>
  );
}
function ChatPanel({
  room,
  command,
  disabled,
}: {
  room: Room;
  command: (c: Record<string, unknown>) => void;
  disabled: boolean;
}) {
  const [revealed, setRevealed] = useState<string[]>([]),
    [text, setText] = useState(""),
    [spoiler, setSpoiler] = useState(false);
  const end = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [room.chat.length]);
  return (
    <>
      <div className="chat-messages" aria-live="polite">
        {!room.chat.length && (
          <div className="empty">
            The lights are down.
            <br />
            Start the conversation.
          </div>
        )}
        {room.chat.map((m) => (
          <div className="chat-message" key={m.id}>
            <div>
              <strong>{m.name}</strong>
              <small>
                {new Date(m.time).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </small>
            </div>
            {m.spoiler && !revealed.includes(m.id) ? (
              <button
                className="spoiler"
                onClick={() => setRevealed((old) => [...old, m.id])}
              >
                ◈ Spoiler · click to reveal
              </button>
            ) : (
              <p>{m.text}</p>
            )}
          </div>
        ))}
        <div ref={end} />
      </div>
      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          command({ type: "chat", text, spoiler });
          setText("");
        }}
      >
        <label className="check">
          <input
            type="checkbox"
            checked={spoiler}
            onChange={(e) => setSpoiler(e.target.checked)}
          />
          Mark as spoiler
        </label>
        <div>
          <input
            aria-label="Chat message"
            placeholder="Share a thought…"
            maxLength={500}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button
            className="primary"
            aria-label="Send message"
            disabled={disabled || !text.trim()}
          >
            ↑
          </button>
        </div>
      </form>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
