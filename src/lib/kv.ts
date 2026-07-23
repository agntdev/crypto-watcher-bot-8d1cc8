/**
 * Durable key-value store for domain data (users, alerts, notifications).
 * Redis-backed when REDIS_URL is set; otherwise an in-memory Map (dev / tests).
 *
 * Never scan the keyspace — callers keep explicit index records.
 */

export interface KvStore {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

class MemoryKv implements KvStore {
  private readonly data = new Map<string, string>();

  async get<T>(key: string): Promise<T | undefined> {
    const raw = this.data.get(key);
    if (raw === undefined) return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }

  async set(key: string, value: unknown): Promise<void> {
    this.data.set(key, JSON.stringify(value));
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }

  clear(): void {
    this.data.clear();
  }
}

class RedisKv implements KvStore {
  constructor(
    private readonly client: {
      get(key: string): Promise<string | null>;
      set(key: string, value: string): Promise<unknown>;
      del(key: string): Promise<unknown>;
    },
    private readonly prefix = "cw:",
  ) {}

  private k(key: string): string {
    return this.prefix + key;
  }

  async get<T>(key: string): Promise<T | undefined> {
    const raw = await this.client.get(this.k(key));
    if (raw == null) return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.client.set(this.k(key), JSON.stringify(value));
  }

  async delete(key: string): Promise<void> {
    await this.client.del(this.k(key));
  }
}

const memory = new MemoryKv();
let storePromise: Promise<KvStore> | null = null;
let forced: KvStore | null = null;

function resolveStore(): Promise<KvStore> {
  if (forced) return Promise.resolve(forced);
  if (storePromise) return storePromise;

  const url =
    typeof process !== "undefined" && process.env && process.env.REDIS_URL
      ? process.env.REDIS_URL
      : undefined;

  if (!url) {
    storePromise = Promise.resolve(memory);
    return storePromise;
  }

  storePromise = (async () => {
    try {
      const { createRequire } = await import("node:module");
      const require = createRequire(import.meta.url);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ioredis: any = require("ioredis");
      const Redis = ioredis.default ?? ioredis.Redis ?? ioredis;
      const client = new Redis(url, { maxRetriesPerRequest: null, lazyConnect: false });
      return new RedisKv(client);
    } catch {
      return memory;
    }
  })();
  return storePromise;
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  return (await resolveStore()).get<T>(key);
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  await (await resolveStore()).set(key, value);
}

export async function kvDel(key: string): Promise<void> {
  await (await resolveStore()).delete(key);
}

/** Test-only: force a specific store implementation. */
export function setKvStore(store: KvStore | null): void {
  forced = store;
  storePromise = null;
}

/** Test-only: wipe the in-memory backend (no-op when Redis is active). */
export function resetMemoryKv(): void {
  memory.clear();
  if (!forced && !(typeof process !== "undefined" && process.env?.REDIS_URL)) {
    storePromise = Promise.resolve(memory);
  }
}
