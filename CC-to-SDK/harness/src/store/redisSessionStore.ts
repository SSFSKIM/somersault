// W3.3 — the external SessionStore reference adapter (Redis). Dependency-free: DI over a minimal
// ioredis-compatible client interface, so `cc-harness` ships no redis dependency — pass any client
// that satisfies RedisLike (ioredis works as-is).
//
// SDK contract honored (sdk.d.ts SessionStore, @alpha):
// - append() is a mirror called AFTER the local write; entries are opaque JSON blobs.
// - `uuid` is treated as an idempotency key: a per-key SET gates duplicates (SADD returns 0 → skip),
//   so SDK retries and importSessionToStore() replays don't duplicate rows. Entries WITHOUT a uuid
//   (titles, tags, mode markers) append un-deduped, per the contract.
// - load() returns null iff the key was never written (per-key existence flag, not LRANGE-empty).
// - listSessions()/listSessionSummaries() come from per-project hashes; mtime is stamped at persist
//   time with the adapter clock (NOT entry timestamps) and shares its clock with the summary sidecar.
// - Summaries are folded via foldSessionSummary inside append() for MAIN transcripts only (mirrors
//   InMemorySessionStore). Sidecar read-fold-write is serialized per session with an in-process
//   promise chain; cross-PROCESS append races for the same session are the deployment's
//   responsibility (contract: "concurrency control is the store's responsibility") — one writer per
//   session holds in the SDK's design (one subprocess owns a session).
// - delete() removes transcript + uuid set + subkeys + index/summary rows. Retention beyond that
//   (TTLs, compliance windows) is the deployment's job.
import { foldSessionSummary } from "@anthropic-ai/claude-agent-sdk";
import type { SessionKey, SessionStore, SessionStoreEntry, SessionSummaryEntry } from "@anthropic-ai/claude-agent-sdk";

/** The minimal promise-returning command surface we need — ioredis satisfies this as-is. */
export interface RedisLike {
  rpush(key: string, ...values: string[]): Promise<number>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  exists(...keys: string[]): Promise<number>;
  del(...keys: string[]): Promise<number>;
  sadd(key: string, ...members: string[]): Promise<number>;
  sismember(key: string, member: string): Promise<number>;
  smembers(key: string): Promise<string[]>;
  hset(key: string, field: string, value: string): Promise<number>;
  hget(key: string, field: string): Promise<string | null>;
  hgetall(key: string): Promise<Record<string, string>>;
  hdel(key: string, ...fields: string[]): Promise<number>;
}

export interface RedisSessionStoreOptions {
  /** Key namespace prefix. Default "ccs". */
  prefix?: string;
  /** Injectable clock (testing). Stamps listSessions/summary mtimes. */
  now?: () => number;
}

const enc = encodeURIComponent; // projectKeys are sanitized cwds — make ":" etc. safe in key paths

export function createRedisSessionStore(client: RedisLike, opts: RedisSessionStoreOptions = {}): SessionStore {
  const p = opts.prefix ?? "ccs";
  const now = opts.now ?? Date.now;
  const base = (key: SessionKey) => `${enc(key.projectKey)}:${enc(key.sessionId)}${key.subpath ? `:${enc(key.subpath)}` : ""}`;
  const tKey = (key: SessionKey) => `${p}:t:${base(key)}`;       // transcript list
  const uKey = (key: SessionKey) => `${p}:u:${base(key)}`;       // seen-uuid set (idempotency)
  const iKey = (projectKey: string) => `${p}:i:${enc(projectKey)}`;   // sessions index hash: sessionId → mtime
  const sKey = (projectKey: string) => `${p}:s:${enc(projectKey)}`;   // summaries hash: sessionId → JSON(SessionSummaryEntry)
  const kKey = (projectKey: string, sessionId: string) => `${p}:k:${enc(projectKey)}:${enc(sessionId)}`; // subpath set

  // Per-session append serialization: fold's read-fold-write must not interleave (SDK contract note).
  const chains = new Map<string, Promise<void>>();
  const serialized = (id: string, fn: () => Promise<void>): Promise<void> => {
    const next = (chains.get(id) ?? Promise.resolve()).then(fn, fn);
    chains.set(id, next);
    // drop our link once it settles and is still the tail (two-arg then: no unhandled rejection)
    const cleanup = () => { if (chains.get(id) === next) chains.delete(id); };
    next.then(cleanup, cleanup);
    return next;
  };

  return {
    async append(key, entries) {
      await serialized(`${key.projectKey}\0${key.sessionId}`, async () => {
        // Idempotency gate is check-THEN-write (race-free under the per-session serialization), and
        // uuids are marked seen only AFTER the rpush lands: a failed write must stay retryable --
        // marking first would make the SDK's retry skip the batch (silent loss).
        const fresh: SessionStoreEntry[] = [];
        for (const e of entries) {
          if (e.uuid && (await client.sismember(uKey(key), e.uuid))) continue;
          fresh.push(e);
        }
        const mtime = now();
        if (fresh.length) await client.rpush(tKey(key), ...fresh.map((e) => JSON.stringify(e)));
        const seen = fresh.filter((e) => e.uuid).map((e) => e.uuid as string);
        if (seen.length) await client.sadd(uKey(key), ...seen);
        else await client.sadd(uKey(key), "\0written"); // uuid-less or all-dup batch still marks the key as written (NUL prefix cannot collide with a uuid)
        if (key.subpath) { await client.sadd(kKey(key.projectKey, key.sessionId), key.subpath); return; }
        await client.hset(iKey(key.projectKey), key.sessionId, String(mtime));
        // summary sidecar (main transcript only, mirroring InMemorySessionStore) — serialized above
        const prevRaw = await client.hget(sKey(key.projectKey), key.sessionId);
        const prev = prevRaw ? (JSON.parse(prevRaw) as SessionSummaryEntry) : undefined;
        const summary = foldSessionSummary(prev, key, fresh, { mtime });
        await client.hset(sKey(key.projectKey), key.sessionId, JSON.stringify(summary));
      });
    },

    async load(key) {
      const [written, rows] = await Promise.all([client.exists(uKey(key), tKey(key)), client.lrange(tKey(key), 0, -1)]);
      if (!written && rows.length === 0) return null; // never written (distinguishable — we keep the uuid set)
      return rows.map((r) => JSON.parse(r) as SessionStoreEntry);
    },

    async listSessions(projectKey) {
      const index = await client.hgetall(iKey(projectKey));
      return Object.entries(index).map(([sessionId, mtime]) => ({ sessionId, mtime: Number(mtime) }));
    },

    async listSessionSummaries(projectKey) {
      const rows = await client.hgetall(sKey(projectKey));
      return Object.values(rows).map((r) => JSON.parse(r) as SessionSummaryEntry);
    },

    async delete(key) {
      await client.del(tKey(key), uKey(key));
      if (key.subpath) return; // deleting a subagent transcript leaves the session rows alone
      const subs = await client.smembers(kKey(key.projectKey, key.sessionId));
      for (const subpath of subs) { const k = { ...key, subpath }; await client.del(tKey(k), uKey(k)); }
      await client.del(kKey(key.projectKey, key.sessionId));
      await client.hdel(iKey(key.projectKey), key.sessionId);
      await client.hdel(sKey(key.projectKey), key.sessionId);
    },

    async listSubkeys(key) {
      return client.smembers(kKey(key.projectKey, key.sessionId));
    },
  };
}
