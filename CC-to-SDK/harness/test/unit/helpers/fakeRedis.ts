// In-memory RedisLike for W3.3 unit tests — implements exactly the command subset the adapter uses.
import type { RedisLike } from "../../../src/store/redisSessionStore.js";

export function createFakeRedis(): RedisLike & { dump(): Record<string, unknown> } {
  const lists = new Map<string, string[]>();
  const sets = new Map<string, Set<string>>();
  const hashes = new Map<string, Map<string, string>>();
  return {
    async rpush(key, ...values) { const l = lists.get(key) ?? []; l.push(...values); lists.set(key, l); return l.length; },
    async lrange(key, start, stop) { const l = lists.get(key) ?? []; const end = stop === -1 ? l.length : stop + 1; return l.slice(start, end); },
    async exists(...keys) { return keys.filter((k) => lists.has(k) || sets.has(k) || hashes.has(k)).length; },
    async del(...keys) { let n = 0; for (const k of keys) { if (lists.delete(k)) n++; if (sets.delete(k)) n++; if (hashes.delete(k)) n++; } return n; },
    async sadd(key, ...members) { const s = sets.get(key) ?? new Set(); let n = 0; for (const m of members) if (!s.has(m)) { s.add(m); n++; } sets.set(key, s); return n; },
    async sismember(key, member) { return sets.get(key)?.has(member) ? 1 : 0; },
    async smembers(key) { return [...(sets.get(key) ?? [])]; },
    async hset(key, field, value) { const h = hashes.get(key) ?? new Map(); const fresh = h.has(field) ? 0 : 1; h.set(field, value); hashes.set(key, h); return fresh; },
    async hget(key, field) { return hashes.get(key)?.get(field) ?? null; },
    async hgetall(key) { return Object.fromEntries(hashes.get(key) ?? []); },
    async hdel(key, ...fields) { const h = hashes.get(key); if (!h) return 0; let n = 0; for (const f of fields) if (h.delete(f)) n++; return n; },
    dump() { return { lists: Object.fromEntries(lists), sets: Object.fromEntries([...sets].map(([k, v]) => [k, [...v]])), hashes: Object.fromEntries([...hashes].map(([k, v]) => [k, Object.fromEntries(v)])) }; },
  };
}
