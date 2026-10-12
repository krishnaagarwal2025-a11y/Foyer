import { io, type Socket } from "socket.io-client";
import { normalizeSource } from "../shared/media";
import type { Room, Result } from "../shared/types";
type Connection = {
  socket: Socket;
  server: string;
  name: string;
  code?: string;
  identity?: { id: string; token: string };
  offset: number;
  samples: { rtt: number; offset: number }[];
  resumeTimer?: ReturnType<typeof setTimeout>;
};
const connections = new Map<number, Connection>();
const send = (tab: number, message: unknown) => {
  void chrome.tabs.sendMessage(tab, message).catch(() => {});
};
const now = () => performance.timeOrigin + performance.now();
function validServer(value: string) {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw Error("Enter your Foyer HTTP(S) origin without credentials.");
  return url.origin;
}
function validIdentity(value: unknown): Connection["identity"] {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === "string" &&
    candidate.id.length <= 80 &&
    typeof candidate.token === "string" &&
    candidate.token.length >= 32 &&
    candidate.token.length <= 128
    ? { id: candidate.id, token: candidate.token }
    : undefined;
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  const tab = sender.tab?.id;
  if (tab === undefined) return;
  if (message.type === "foyer:disconnect") {
    clearTimeout(connections.get(tab)?.resumeTimer);
    connections.get(tab)?.socket.disconnect();
    connections.delete(tab);
    respond({ ok: true });
    return;
  }
  if (message.type === "foyer:command") {
    const c = connections.get(tab);
    if (!c?.socket.connected) {
      respond({ ok: false, error: "Connect to Foyer first." });
      return;
    }
    c.socket
      .timeout(5000)
      .emit(
        "command",
        message.envelope,
        (error: Error | null, result: Result) =>
          respond(
            error
              ? {
                  ok: false,
                  error:
                    "Command could not be confirmed. Sync before retrying.",
                }
              : result,
          ),
      );
    return true;
  }
  if (message.type !== "foyer:connect") return;
  (async () => {
    try {
      const server = validServer(message.server);
      const pageUrl = new URL(sender.url || "");
      const source = normalizeSource(pageUrl.href);
      if (source.kind !== "external")
        throw Error("Open a supported streaming title first.");
      const allowed = await chrome.permissions.contains({
        origins: [`${server}/*`, `${pageUrl.origin}/*`],
      });
      if (!allowed)
        throw Error(
          "Allow access to this Foyer server and streaming site in the extension popup, then reload the title page.",
        );
      connections.get(tab)?.socket.disconnect();
      const name = String(message.name || "")
        .trim()
        .slice(0, 32);
      if (!name) throw Error("Enter a display name.");
      const code = String(message.code || "")
        .trim()
        .toUpperCase();
      if (code && !/^[A-Z0-9]{6}$/.test(code))
        throw Error("Enter the six-character room code.");
      const key = `identity:${server}:${tab}:${code}`,
        stored = (await chrome.storage.local.get(key))[key];
      const socket = io(server, {
        transports: ["websocket"],
        reconnection: true,
        reconnectionDelay: 500,
        reconnectionDelayMax: 2000,
      });
      const c: Connection = {
        socket,
        server,
        name,
        code: code || undefined,
        identity: message.fresh ? undefined : validIdentity(stored),
        offset: 0,
        samples: [],
      };
      connections.set(tab, c);
      const ping = () => {
        const start = now();
        socket
          .timeout(3000)
          .emit(
            "clock",
            {},
            (error: Error | null, data: { serverTime: number }) => {
              if (error || !data) return;
              const end = now();
              c.samples.push({
                rtt: end - start,
                offset: data.serverTime - (start + end) / 2,
              });
              c.samples = c.samples.slice(-20);
              const fastest = [...c.samples]
                .sort((a, b) => a.rtt - b.rtt)
                .slice(0, 5);
              c.offset =
                fastest.reduce((s, v) => s + v.offset, 0) / fastest.length;
              send(tab, {
                type: "foyer:clock",
                offset: c.offset,
                rtt: end - start,
              });
            },
          );
      };
      socket.on("connect", () => {
        send(tab, { type: "foyer:status", status: "Resuming" });
        const creatingRoom = !c.code;
        ping();
        clearTimeout(c.resumeTimer);
        const resumeJoin = (attempt = 0) => {
          if (!socket.connected) return;
          socket.timeout(5000).emit(
            "join",
            {
              name: c.name,
              ...(c.code ? { code: c.code } : {}),
              ...(c.identity ? { identity: c.identity } : {}),
            },
            (error: Error | null, result: Result) => {
              if (
                !error &&
                result?.error?.startsWith("Resume pending") &&
                attempt < 65
              ) {
                c.resumeTimer = setTimeout(() => resumeJoin(attempt + 1), 500);
                return;
              }
              if (
                !error &&
                result?.error?.startsWith("Resume identity expired") &&
                c.identity
              ) {
                c.identity = undefined;
                void chrome.storage.local.remove(
                  `identity:${server}:${tab}:${c.code}`,
                );
                resumeJoin(attempt + 1);
                return;
              }
              if (error || !result?.ok) {
                send(tab, {
                  type: "foyer:error",
                  error: result?.error || "Room join timed out.",
                });
                send(tab, { type: "foyer:status", status: "Resume failed" });
                return;
              }
              c.code = result.room!.code;
              c.identity = result.identity;
              void chrome.storage.local.set({
                [`identity:${server}:${tab}:${c.code}`]: result.identity,
              });
              send(tab, {
                type: "foyer:joined",
                room: result.room,
                self: result.identity!.id,
                server,
                offset: c.offset,
                created: creatingRoom,
              });
              send(tab, { type: "foyer:status", status: "Connected" });
            },
          );
        };
        resumeJoin();
      });
      socket.on("closed", () => {
        send(tab, {
          type: "foyer:error",
          error: "This room expired. Create a new room.",
        });
        send(tab, { type: "foyer:status", status: "Room closed" });
      });
      socket.on("state", (room: Room) =>
        send(tab, { type: "foyer:state", room }),
      );
      socket.on("reaction", (data) =>
        send(tab, { type: "foyer:reaction", data }),
      );
      socket.on("disconnect", () =>
        send(tab, { type: "foyer:status", status: "Reconnecting" }),
      );
      socket.on("connect_error", () =>
        send(tab, {
          type: "foyer:status",
          status: "Reconnecting · check server or permissions",
        }),
      );
      const timer = setInterval(() => {
        if (socket.connected) ping();
      }, 10000);
      socket.on("disconnect", (reason) => {
        if (reason === "io client disconnect") clearInterval(timer);
      });
      respond({ ok: true });
    } catch (error) {
      respond({
        ok: false,
        error: error instanceof Error ? error.message : "Connection failed.",
      });
    }
  })();
  return true;
});
chrome.tabs.onRemoved.addListener((tab) => {
  clearTimeout(connections.get(tab)?.resumeTimer);
  connections.get(tab)?.socket.disconnect();
  connections.delete(tab);
});
