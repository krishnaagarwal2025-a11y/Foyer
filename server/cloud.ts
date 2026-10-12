import { randomUUID } from "node:crypto";
import { Engine, type Saved, type PlaybackPreparation } from "./engine.js";
import type { Movie, Result, Room } from "../shared/types.js";

export type CloudRecord = Saved & {
  operations: [string, Result][];
  deadlines: [string, number][];
  leases: Record<string, { owner: string; expires: number }>;
};
export type CloudEvent = {
  code: string;
  type:
    "state" | "reaction" | "closed" | "probe" | "probe-report" | "sync-result";
  data?: unknown;
};
export interface RoomStore {
  acquire(key: string, owner: string): Promise<boolean>;
  release(key: string, owner: string): Promise<void>;
  load(code: string): Promise<CloudRecord | null>;
  save(
    code: string,
    record: CloudRecord | null,
    lock: string,
    owner: string,
    events: CloudEvent[],
    creating?: boolean,
  ): Promise<void>;
  count(): Promise<number>;
  remember(movies: Movie[]): Promise<void>;
  movie(id: string): Promise<Movie | null>;
}
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Reuses the local mutation engine inside a fenced, per-room shared transaction.
 * Private tokens/leases/dedup IDs persist; only public events are published. */
export class CloudCoordinator {
  engine: Engine;
  private events = new Map<string, CloudEvent[]>();
  private tails = new Map<string, Promise<unknown>>();
  constructor(
    public store: RoomStore,
    public emit: (event: CloudEvent) => void,
    now = () => performance.timeOrigin + performance.now(),
    grace = 15000,
  ) {
    this.engine = new Engine(
      (code, room) => this.queue({ code, type: "state", data: room }),
      () => {},
      now,
      grace,
      (code, data) => this.queue({ code, type: "reaction", data }),
    );
  }
  private queue(event: CloudEvent) {
    const events = this.events.get(event.code) || [];
    events.push(event);
    this.events.set(event.code, events);
  }
  private async locked<T>(
    key: string,
    work: (owner: string) => Promise<T>,
  ): Promise<T> {
    // Also serialize this instance: a shared Redis lock must never race changes
    // to the same local engine room while another transaction awaits I/O.
    const previous = this.tails.get(key) || Promise.resolve();
    const task = previous
      .catch(() => {})
      .then(async () => {
        const owner = randomUUID(),
          until = performance.now() + 3000;
        while (!(await this.store.acquire(key, owner))) {
          if (performance.now() > until)
            throw Error("Room busy. Sync and retry.");
          await wait(15);
        }
        try {
          return await work(owner);
        } finally {
          await this.store.release(key, owner).catch(() => {});
        }
      });
    this.tails.set(key, task);
    try {
      return await task;
    } finally {
      if (this.tails.get(key) === task) this.tails.delete(key);
    }
  }
  private load(record: CloudRecord) {
    const e = this.engine,
      code = record.room.code;
    for (const p of e.rooms.get(code)?.participants || [])
      e.deadlines.delete(p.id);
    e.rooms.set(code, structuredClone(record.room));
    e.tokens.set(code, structuredClone(record.tokens));
    e.operations.set(code, new Map(record.operations || []));
    for (const [id, time] of record.deadlines || []) e.deadlines.set(id, time);
  }
  private renew(record: CloudRecord) {
    const now = this.engine.now();
    for (const [sid, session] of this.engine.sessions) {
      if (session.code !== record.room.code) continue;
      const lease = record.leases[session.id];
      if (
        lease?.owner === sid &&
        record.room.participants.some((p) => p.id === session.id && p.connected)
      )
        lease.expires = now + 15000;
    }
  }
  private reconcile(record: CloudRecord) {
    const e = this.engine,
      r = e.rooms.get(record.room.code)!;
    let changed = false;
    for (const p of r.participants) {
      const lease = record.leases[p.id];
      if (p.connected && (!lease || lease.expires <= e.now())) {
        p.connected = false;
        changed = true;
        e.deadlines.set(p.id, (lease?.expires || e.now()) + e.grace);
      }
    }
    if (changed) e.commit(r);
    e.sweep(r.code);
  }
  private record(
    code: string,
    leases: CloudRecord["leases"],
  ): CloudRecord | null {
    const e = this.engine,
      r = e.rooms.get(code);
    if (!r) return null;
    const ids = new Set(r.participants.map((p) => p.id));
    return {
      room: e.snapshot(r),
      tokens: { ...e.tokens.get(code)! },
      operations: [...e.operations.get(code)!],
      deadlines: [...e.deadlines].filter(([id]) => ids.has(id)),
      leases: Object.fromEntries(
        Object.entries(leases).filter(([id]) => ids.has(id)),
      ),
    };
  }
  private async flush(
    code: string,
    lock: string,
    owner: string,
    leases: CloudRecord["leases"],
    creating = false,
  ) {
    const record = this.record(code, leases),
      events = this.events.get(code) || [];
    this.events.delete(code);
    if (!record) events.push({ code, type: "closed" });
    await this.store.save(code, record, lock, owner, events, creating);
    // Local cache isn't authority. On the next mutation we reload shared state.
    if (!record)
      for (const [sid, session] of this.engine.sessions)
        if (session.code === code) this.engine.sessions.delete(sid);
  }
  async join(sid: string, input: unknown): Promise<Result> {
    if (this.engine.sessions.has(sid))
      return { ok: false, error: "This connection has already joined a room." };
    const code =
      typeof input === "object" && input !== null && "code" in input
        ? (input as any).code
        : undefined;
    if (typeof code === "string" && /^[A-Z0-9]{6}$/.test(code)) {
      return this.locked(code, async (owner) => {
        const record = await this.store.load(code);
        if (!record)
          return { ok: false, error: "Room not found. Check your invitation." };
        this.events.delete(code);
        this.load(record);
        this.renew(record);
        this.reconcile(record);
        const result = this.engine.join(sid, input);
        if (result.ok)
          record.leases[result.identity!.id] = {
            owner: sid,
            expires: this.engine.now() + 15000,
          };
        // A killed function may not send disconnect. The lease must expire
        // before the same identity can resume on a different instance.
        if (result.error === "This identity is connected in another tab.")
          result.error =
            "Resume pending: the previous connection is still active.";
        try {
          await this.flush(code, code, owner, record.leases);
        } catch (error) {
          if (result.ok) this.engine.sessions.delete(sid);
          throw error;
        }
        return result;
      });
    }
    return this.locked("__create__", async (owner) => {
      if ((await this.store.count()) >= 500)
        return { ok: false, error: "Server room limit reached." };
      for (let attempt = 0; attempt < 5; attempt++) {
        const result = this.engine.join(sid, input);
        if (!result.ok) return result;
        const created = result.room!.code;
        if (await this.store.load(created)) {
          this.engine.sessions.delete(sid);
          this.engine.rooms.delete(created);
          this.engine.tokens.delete(created);
          this.engine.operations.delete(created);
          this.events.delete(created);
          continue;
        }
        try {
          await this.flush(
            created,
            "__create__",
            owner,
            {
              [result.identity!.id]: {
                owner: sid,
                expires: this.engine.now() + 15000,
              },
            },
            true,
          );
        } catch (error) {
          this.engine.sessions.delete(sid);
          this.engine.rooms.delete(created);
          this.engine.tokens.delete(created);
          this.engine.operations.delete(created);
          this.events.delete(created);
          throw error;
        }
        return result;
      }
      return { ok: false, error: "Could not allocate a room. Retry." };
    });
  }
  async sync(sid: string): Promise<Result> {
    const session = this.engine.sessions.get(sid);
    if (!session) return { ok: false, error: "Join a room first." };
    return this.locked(session.code, async (owner) => {
      const record = await this.store.load(session.code);
      if (!record)
        return { ok: false, error: "Room expired. Create a new room." };
      this.events.delete(session.code);
      this.load(record);
      this.renew(record);
      this.reconcile(record);
      if (record.leases[session.id]?.owner !== sid)
        return {
          ok: false,
          error: "Session expired. Reload and rejoin the room.",
        };
      const result = this.engine.sync(sid);
      await this.flush(session.code, session.code, owner, record.leases);
      return result;
    });
  }
  async apply(
    sid: string,
    input: unknown,
    preparation?: PlaybackPreparation,
  ): Promise<Result> {
    const session = this.engine.sessions.get(sid);
    if (!session) return { ok: false, error: "Join a room first." };
    return this.locked(session.code, async (owner) => {
      const record = await this.store.load(session.code);
      if (!record)
        return { ok: false, error: "Room expired. Create a new room." };
      this.events.delete(session.code);
      this.load(record);
      this.renew(record);
      this.reconcile(record);
      const p = this.engine.rooms
        .get(session.code)
        ?.participants.find((p) => p.id === session.id);
      let result: Result;
      if (!p?.connected || record.leases[session.id]?.owner !== sid)
        result = {
          ok: false,
          error: "Session expired. Reload and rejoin the room.",
        };
      else {
        const command = (input as any)?.command;
        if (
          command?.type === "library" &&
          ["audius", "navidrome"].includes(command.provider) &&
          typeof command.sourceId === "string"
        ) {
          const movie = await this.store.movie(
            `${command.provider}:${command.sourceId}`,
          );
          if (movie) this.engine.library.set(movie.id, movie);
        }
        result = this.engine.apply(sid, input, preparation);
      }
      await this.flush(session.code, session.code, owner, record.leases);
      return result;
    });
  }
  async disconnect(sid: string) {
    const session = this.engine.sessions.get(sid);
    if (!session) return;
    await this.locked(session.code, async (owner) => {
      const record = await this.store.load(session.code);
      if (record) {
        this.events.delete(session.code);
        this.load(record);
        if (record.leases[session.id]?.owner === sid) {
          this.engine.disconnect(sid);
          delete record.leases[session.id];
          await this.flush(session.code, session.code, owner, record.leases);
        }
      }
      this.engine.sessions.delete(sid);
      this.engine.limits.delete(sid);
    });
  }
  async heartbeat() {
    for (const code of new Set(
      [...this.engine.sessions.values()].map((s) => s.code),
    )) {
      await this.locked(code, async (owner) => {
        const record = await this.store.load(code);
        if (!record) return;
        this.events.delete(code);
        this.load(record);
        this.renew(record);
        this.reconcile(record);
        await this.flush(code, code, owner, record.leases);
      });
    }
  }
  async resync() {
    for (const code of new Set(
      [...this.engine.sessions.values()].map((s) => s.code),
    )) {
      const record = await this.store.load(code);
      if (record) this.emit({ code, type: "state", data: record.room });
    }
  }
}
