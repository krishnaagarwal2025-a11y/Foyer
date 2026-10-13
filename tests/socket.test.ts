import { catalog } from "../server/catalog";
import { it, expect } from "vitest";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { io, type Socket } from "socket.io-client";
import { Engine } from "../server/engine";
import type { Result, Room } from "../shared/types";
it("propagates real socket commands to ten clients and reconnects a stable identity", async () => {
  const http = createServer(),
    server = new Server(http);
  const engine = new Engine((code, r) => server.to(code).emit("state", r));
  server.on("connection", (s) => {
    s.on("join", (v, ack) => {
      const result = engine.join(s.id, v);
      if (result.ok) s.join(result.room!.code);
      ack(result);
    });
    s.on("command", (v, ack) => ack(engine.apply(s.id, v)));
    s.on("disconnect", () => engine.disconnect(s.id));
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const address = http.address() as { port: number },
    clients: Socket[] = [];
  const emit = (s: Socket, event: string, v: unknown) =>
    new Promise<Result>((resolve) => s.emit(event, v, resolve));
  const connect = async () => {
    const s = io(`http://127.0.0.1:${address.port}`, {
      transports: ["websocket"],
    });
    clients.push(s);
    await new Promise<void>((resolve) => s.on("connect", resolve));
    return s;
  };
  try {
    const host = await connect(),
      joined = await emit(host, "join", { name: "Host" }),
      code = joined.room!.code;
    engine.rooms.get(code)!.media = catalog[0];
    for (let i = 1; i < 10; i++)
      await emit(await connect(), "join", { name: `Guest ${i}`, code });
    const delivered = clients
      .slice(1)
      .map((s) => new Promise<Room>((resolve) => s.once("state", resolve)));
    expect(
      (
        await emit(host, "command", {
          opId: crypto.randomUUID(),
          mediaRevision: 0,
          command: { type: "seek", position: 23 },
        })
      ).ok,
    ).toBe(true);
    for (const r of await Promise.all(delivered)) {
      expect(r.position).toBe(23);
      expect(r.participants).toHaveLength(10);
    }
    host.disconnect();
    await new Promise((r) => setTimeout(r, 50));
    const replacement = await connect(),
      result = await emit(replacement, "join", {
        name: "Host",
        code,
        identity: joined.identity,
      });
    expect(result.ok).toBe(true);
    expect(result.identity!.id).toBe(joined.identity!.id);
    expect(result.room!.participants).toHaveLength(10);
    expect(result.room!.position).toBe(23);
  } finally {
    clients.forEach((s) => s.disconnect());
    await server.close();
    http.close();
  }
});
