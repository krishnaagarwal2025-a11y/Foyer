import { io, type Socket } from "socket.io-client";
import { performance } from "node:perf_hooks";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import type { Result, Room } from "../shared/types";
const url = process.env.BENCH_URL || "http://127.0.0.1:3001",
  count = Number(process.env.BENCH_CLIENTS || 10),
  iterations = Number(process.env.BENCH_COMMANDS || 90);
const clients: Socket[] = [];
const samples: number[] = [];
const emit = (s: Socket, event: string, value: unknown) =>
  new Promise<Result>((resolve, reject) =>
    s
      .timeout(5000)
      .emit(event, value, (err: Error | null, r: Result) =>
        err ? reject(err) : resolve(r),
      ),
  );
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b),
    at = (p: number) => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
  return {
    samples: sorted.length,
    p50: at(0.5),
    p95: at(0.95),
    maximum: sorted.at(-1),
  };
}
try {
  for (let i = 0; i < count; i++) {
    const s = io(url, { transports: ["websocket"], forceNew: true });
    clients.push(s);
    s.on("sync-check", (packet, ack) => {
      const received = performance.timeOrigin + performance.now();
      ack({
        id: packet.id,
        sequence: packet.sequence,
        mediaRevision: packet.mediaRevision,
        clientReceivedAt: received,
        clientSentAt: performance.timeOrigin + performance.now(),
        ready: true,
        autoplayBlocked: false,
      });
    });
    await new Promise<void>((resolve, reject) => {
      s.once("connect", () => resolve());
      s.once("connect_error", reject);
    });
  }
  const host = await emit(clients[0], "join", { name: "Benchmark host" }),
    code = host.room!.code;
  for (let i = 1; i < count; i++) {
    const r = await emit(clients[i], "join", { name: `Benchmark ${i}`, code });
    if (!r.ok) throw Error(r.error);
  }
  let room = host.room!;
  clients[0].on("state", (r: Room) => (room = r));
  await sleep(1000);
  for (let i = -9; i < iterations; i++) {
    const type = ["play", "pause", "seek"][(i + 9) % 3],
      command =
        type === "seek" ? { type, position: 10 + ((i + 9) % 50) } : { type };
    const version = room.version;
    const start = performance.now();
    const delivered = clients.slice(1).map(
      (s) =>
        new Promise<number>((resolve, reject) => {
          const timeout = setTimeout(() => {
            s.off("state", listener);
            reject(Error("delivery timeout"));
          }, 5000);
          function listener(r: Room) {
            if (r.version <= version) return;
            clearTimeout(timeout);
            s.off("state", listener);
            resolve(performance.now() - start);
          }
          s.on("state", listener);
        }),
    );
    const result = await emit(clients[0], "command", {
      opId: crypto.randomUUID(),
      mediaRevision: room.mediaRevision,
      command,
    });
    if (!result.ok) throw Error(result.error);
    const values = await Promise.all(delivered);
    if (i >= 0) samples.push(...values);
    await sleep(70);
  }
  const report = {
    timestamp: new Date().toISOString(),
    transport: "Socket.IO WebSocket, socket-only; no HTML5 playback",
    url,
    participants: count,
    commands: iterations,
    warmupCommands: 9,
    method:
      "One Node monotonic clock. Start immediately before host emit; end in each recipient state callback. Includes the three-packet play preflight, validation, durable checkpoint and broadcast. Socket-only peers report synthetic source readiness; no video is played. Recipients exclude sender.",
    environment: {
      os: os.type() + " " + os.release(),
      node: process.version,
      cpu: os.cpus()[0]?.model,
      logicalCpus: os.cpus().length,
      totalMemoryGB: os.totalmem() / 2 ** 30,
      loadAverage: os.loadavg(),
    },
    deliveryMs: stats(samples),
    targetP95Ms: 250,
    passed: stats(samples).p95 <= 250,
  };
  mkdirSync("evidence", { recursive: true });
  writeFileSync(
    process.env.BENCH_REPORT || "evidence/socket-benchmark.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
} finally {
  clients.forEach((s) => s.disconnect());
}
