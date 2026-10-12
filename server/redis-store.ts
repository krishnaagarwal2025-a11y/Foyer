import Redis from "ioredis";
import type { CloudEvent, CloudRecord, RoomStore } from "./cloud.js";
import type { Movie } from "../shared/types.js";

const COMMIT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
if ARGV[6] == '1' and redis.call('EXISTS', KEYS[2]) == 1 then return 0 end
if ARGV[2] == '' then
  redis.call('DEL', KEYS[2]); redis.call('ZREM', KEYS[3], ARGV[3])
else
  redis.call('SET', KEYS[2], ARGV[2], 'EX', 172800)
  redis.call('ZADD', KEYS[3], ARGV[4], ARGV[3])
end
for _, event in ipairs(cjson.decode(ARGV[5])) do redis.call('PUBLISH', KEYS[4], cjson.encode(event)) end
return 1`;
const UNLOCK = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`;
const COUNT = `
local stale = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
for _, code in ipairs(stale) do
  if redis.call('EXISTS', ARGV[2] .. 'lock:' .. code) == 0 then
    redis.call('DEL', ARGV[2] .. 'room:' .. code); redis.call('ZREM', KEYS[1], code)
    redis.call('PUBLISH', KEYS[2], cjson.encode({code=code,type='closed'}))
  end
end
return redis.call('ZCARD', KEYS[1])`;

/** TCP/TLS Redis permits Pub/Sub delivery without polling per browser. */
export class RedisRoomStore implements RoomStore {
  client: Redis;
  subscriber: Redis;
  readonly prefix: string;
  private channel: string;
  constructor(url: string, namespace: string) {
    const parsed = new URL(url);
    if (parsed.protocol !== "rediss:")
      throw Error("Cloud Redis must use TLS (rediss://).");
    this.prefix = `{foyer:${namespace}}:`;
    this.channel = `${this.prefix}events`;
    this.client = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 5000,
      commandTimeout: 5000,
    });
    this.subscriber = this.client.duplicate({ commandTimeout: undefined });
    // Never log Redis command arguments or credentials.
    this.client.on("error", () => {});
    this.subscriber.on("error", () => {});
  }
  async connect(
    emit: (event: CloudEvent) => void,
    resync: () => Promise<void>,
  ) {
    await Promise.all([this.client.connect(), this.subscriber.connect()]);
    this.subscriber.on("message", (_channel, message) => {
      try {
        emit(JSON.parse(message) as CloudEvent);
      } catch {}
    });
    await this.subscriber.subscribe(this.channel);
    this.subscriber.on("ready", () => {
      void resync().catch(() => {});
    });
  }
  async acquire(key: string, owner: string) {
    return (
      (await this.client.set(
        `${this.prefix}lock:${key}`,
        owner,
        "PX",
        10000,
        "NX",
      )) === "OK"
    );
  }
  async release(key: string, owner: string) {
    await this.client.eval(UNLOCK, 1, `${this.prefix}lock:${key}`, owner);
  }
  async load(code: string): Promise<CloudRecord | null> {
    const raw = await this.client.get(`${this.prefix}room:${code}`);
    return raw ? (JSON.parse(raw) as CloudRecord) : null;
  }
  async save(
    code: string,
    record: CloudRecord | null,
    lock: string,
    owner: string,
    events: CloudEvent[],
    creating = false,
  ) {
    const accepted = await this.client.eval(
      COMMIT,
      4,
      `${this.prefix}lock:${lock}`,
      `${this.prefix}room:${code}`,
      `${this.prefix}rooms`,
      this.channel,
      owner,
      record ? JSON.stringify(record) : "",
      code,
      Date.now(),
      JSON.stringify(events),
      creating ? "1" : "0",
    );
    if (accepted !== 1)
      throw Error("Room transaction expired. Sync and retry.");
  }
  async count() {
    return Number(
      await this.client.eval(
        COUNT,
        2,
        `${this.prefix}rooms`,
        this.channel,
        Date.now() - 60000,
        this.prefix,
      ),
    );
  }
  async remember(movies: Movie[]) {
    const pipe = this.client.pipeline();
    for (const movie of movies) {
      pipe.set(
        `${this.prefix}music:${movie.id}`,
        JSON.stringify(movie),
        "EX",
        3600,
      );
      pipe.zadd(`${this.prefix}music-ids`, Date.now(), movie.id);
    }
    const replies = await pipe.exec();
    if (replies?.some(([error]) => error))
      throw Error("Music catalog storage unavailable.");
    // Bound the cross-instance trusted catalog as well as the engine's cache.
    await this.client.eval(
      `local n=redis.call('ZCARD',KEYS[1]); if n>500 then local ids=redis.call('ZRANGE',KEYS[1],0,n-501); for _,id in ipairs(ids) do redis.call('DEL',ARGV[1]..id);redis.call('ZREM',KEYS[1],id) end end return 1`,
      1,
      `${this.prefix}music-ids`,
      `${this.prefix}music:`,
    );
  }
  async movie(id: string): Promise<Movie | null> {
    const raw = await this.client.get(`${this.prefix}music:${id}`);
    return raw ? (JSON.parse(raw) as Movie) : null;
  }
  close() {
    this.client.disconnect();
    this.subscriber.disconnect();
  }
}
