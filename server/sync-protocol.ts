import { randomUUID } from "node:crypto";
import type { Server, Socket } from "socket.io";
import { z } from "zod";
import type {
  Room,
  Synchronization,
  SyncMeasurement,
  SyncProbe,
} from "../shared/types.js";
import type { CloudEvent } from "./cloud.js";

const reply = z.object({
  id: z.string(),
  sequence: z.number().int(),
  clientReceivedAt: z.number().finite(),
  clientSentAt: z.number().finite(),
  mediaRevision: z.number().int(),
  ready: z.boolean(),
  autoplayBlocked: z.boolean(),
});
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Per-device, three-exchange preflight. Redis Pub/Sub distributes the request
 * and trusted server-measured reports; client timestamps only remove processing
 * time and calibrate offset. Missing peers never block a room indefinitely. */
export class SyncProtocol {
  private checks = new Map<
    string,
    {
      expected: Set<string>;
      reports: Map<string, SyncMeasurement>;
      finish: () => void;
    }
  >();
  private inFlight = new Map<string, Promise<Synchronization>>();
  private seen = new Set<string>();
  constructor(
    private io: Server,
    private now: () => number,
    private members: (code: string) => Promise<Map<string, string>>,
    private publish: (event: CloudEvent) => Promise<void>,
  ) {}
  async check(room: Room, reason: "play" | "manual"): Promise<Synchronization> {
    const key = `${room.code}:${room.mediaRevision}:${reason}`;
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    if (this.checks.size >= 32)
      throw Error("Too many active device checks. Retry shortly.");
    const work = this.run(room, reason);
    this.inFlight.set(key, work);
    try {
      return await work;
    } finally {
      this.inFlight.delete(key);
    }
  }
  private async run(room: Room, reason: "play" | "manual") {
    const job: SyncProbe = {
      id: randomUUID(),
      code: room.code,
      mediaRevision: room.mediaRevision,
      reason,
      participants: room.participants
        .filter((p) => p.connected)
        .map((p) => p.id),
      expiresAt: this.now() + 1500,
    };
    let finish!: () => void;
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const collector = {
      expected: new Set(job.participants),
      reports: new Map<string, SyncMeasurement>(),
      finish,
    };
    this.checks.set(job.id, collector);
    const timer = setTimeout(finish, 1000);
    try {
      await this.publish({ code: job.code, type: "probe", data: job });
      if (!collector.expected.size) finish();
      await done;
      const plan: Synchronization = {
        id: job.id,
        code: job.code,
        reason,
        checkedAt: this.now(),
        mediaRevision: job.mediaRevision,
        participants: job.participants.map(
          (participantId) =>
            collector.reports.get(participantId) || {
              participantId,
              rttMs: null,
              samples: 0,
              ready: false,
              autoplayBlocked: false,
            },
        ),
      };
      await this.publish({ code: job.code, type: "sync-result", data: plan });
      return plan;
    } finally {
      clearTimeout(timer);
      this.checks.delete(job.id);
    }
  }
  async receive(event: CloudEvent) {
    if (event.type === "probe-report") {
      const data = event.data as { id: string; reports: SyncMeasurement[] };
      const collector = this.checks.get(data.id);
      if (!collector) return;
      for (const report of data.reports)
        if (collector.expected.has(report.participantId))
          collector.reports.set(report.participantId, report);
      if (collector.reports.size === collector.expected.size)
        collector.finish();
      return;
    }
    if (event.type !== "probe") return;
    const job = event.data as SyncProbe;
    if (
      job.code !== event.code ||
      this.seen.has(job.id) ||
      job.expiresAt < this.now()
    )
      return;
    if (this.seen.size >= 128) return;
    this.seen.add(job.id);
    setTimeout(() => this.seen.delete(job.id), 2000).unref();
    const members = await this.members(job.code);
    const peers = [...members].flatMap(([sid, participantId]) => {
      const socket = this.io.sockets.sockets.get(sid);
      return socket && job.participants.includes(participantId)
        ? [{ socket, participantId }]
        : [];
    });
    const reports = await Promise.all(
      peers.map(async ({ socket, participantId }) =>
        this.measure(socket, participantId, job),
      ),
    );
    if (reports.length)
      await this.publish({
        code: job.code,
        type: "probe-report",
        data: { id: job.id, reports },
      });
  }
  private async measure(
    socket: Socket,
    participantId: string,
    job: SyncProbe,
  ): Promise<SyncMeasurement> {
    let fastest = Infinity,
      samples = 0,
      ready = false,
      autoplayBlocked = false;
    for (let sequence = 0; sequence < 3; sequence++) {
      if (!socket.connected || this.now() > job.expiresAt) break;
      const serverSentAt = this.now(),
        started = performance.now();
      try {
        const response = reply.safeParse(
          await socket
            .timeout(300)
            .emitWithAck("sync-check", { ...job, sequence, serverSentAt }),
        );
        const serverReceivedAt = this.now(),
          elapsed = performance.now() - started;
        if (!response.success) break;
        const data = response.data,
          processing = data.clientSentAt - data.clientReceivedAt;
        if (
          data.id !== job.id ||
          data.sequence !== sequence ||
          processing < 0 ||
          processing > elapsed + 2
        )
          break;
        const rttMs = Math.max(0, elapsed - processing);
        samples++;
        fastest = Math.min(fastest, rttMs);
        ready = data.mediaRevision === job.mediaRevision && data.ready;
        autoplayBlocked = data.autoplayBlocked;
        socket.emit("sync-clock", {
          id: job.id,
          serverSentAt,
          serverReceivedAt,
          clientReceivedAt: data.clientReceivedAt,
          clientSentAt: data.clientSentAt,
          rttMs,
        });
        // A brief gap samples jitter and gives a newly selected player time to load.
        if (sequence < 2) await sleep(15);
      } catch {
        break;
      }
    }
    return {
      participantId,
      rttMs: samples ? fastest : null,
      samples,
      ready,
      autoplayBlocked,
    };
  }
}
