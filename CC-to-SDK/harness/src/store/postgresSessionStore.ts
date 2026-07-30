// The external SessionStore Postgres adapter (companion to redisSessionStore.ts). Dependency-free:
// DI over a minimal pg-compatible client interface, so `cc-harness` ships no pg dependency — pass
// any client whose query(text, params) resolves {rows} (node-postgres Pool/Client and PGlite both
// satisfy PgLike as-is).
//
// SDK contract honored (sdk.d.ts SessionStore, @alpha) — and exceeded vs the official
// examples/session-stores/postgres reference (which ships no uuid dedup and no summaries):
// - append() is a mirror called AFTER the local write; entries are opaque JSON blobs, stored as
//   TEXT (JSON.stringify output), NOT jsonb: Postgres jsonb rejects the U+0000 escape and lone-surrogate
//   escapes (22P02/22P05), which would make the SDK retry and then DROP a valid batch — while
//   JSON.stringify always escapes control characters, so its output is NUL-free and TEXT-safe.
//   We never query inside the payloads, so jsonb bought nothing; TEXT round-trips byte-faithfully.
// - `uuid` is an idempotency key: a partial UNIQUE index + ON CONFLICT DO NOTHING dedups atomically
//   IN the insert statement (first-seen payload wins; cross-process safe, unlike the Redis
//   adapter's check-then-write which leans on its in-process chain). Entries WITHOUT a uuid
//   (titles, tags, mode markers) append un-deduped, per the contract — which is why append() also
//   recognizes an SDK retry of a batch it already committed (see `inflight`): the index cannot save
//   those rows from landing twice, so the re-INSERT has to be skipped instead.
// - subpath is normalized to '' for the main transcript: Postgres UNIQUE treats NULLs as distinct,
//   which would silently disable dedup for main-transcript rows if subpath were NULL.
// - load() returns null iff the transcript has no rows — with row-level dedup, "written but
//   emptied by replay" cannot arise (a replay only skips because the rows already exist).
// - listSessions()/listSessionSummaries() read the sessions sidecar table; mtime is stamped at
//   persist time with the adapter clock (NOT entry timestamps), Number()-wrapped because
//   node-postgres returns int8 as a string (PGlite returns a number — both covered).
// - Summaries fold via foldSessionSummary inside append() for MAIN transcripts only. Each fold
//   RECOMPUTES THE SUMMARY FROM THE FULL COMMITTED TRANSCRIPT in id order (fold(undefined, allRows))
//   — never from the in-memory batch, never from an id watermark. Batch-fed folds lose stranded
//   rows on retry (the retry's ON CONFLICT skips everything); a watermark can advance PAST a lower
//   id that another writer reserved but hasn't committed (BIGSERIAL reserves before commit; ON
//   CONFLICT burns ids, so gaps are permanent and unwaitable) and skip that row forever. Full
//   re-fold has neither hole: an appender folds after its own insert commits, so its rows are
//   always in its own read, and any row that a concurrent fold missed is covered by the next fold.
//   That full re-fold stays the DEFINITION of a correct fold, but paying it on every append made the
//   cost of writing a session quadratic in its length, so it is now the fallback rather than the only
//   path: an in-process cache remembers {count, summary} from the last successful fold, and a fold
//   takes the incremental path (prior summary + just this batch) only when a live `count(*)` proves the
//   table moved by exactly the rows we inserted. That is a PROOF that nothing else committed, not a
//   watermark's assumption that nothing will — so it sidesteps the BIGSERIAL hazard above, and any
//   mismatch (concurrent writer, dropped duplicate uuid, cold cache, CAS retry) silently re-folds in
//   full. A wrong or absent cache entry can only cost time.
//   Writes are guarded twice: the in-process per-session promise chain (Redis-adapter precedent)
//   plus a cross-process CAS on a dedicated `seq` column (UPDATE ... WHERE seq = prior; 0 rows
//   back = a concurrent writer won, re-read — the re-read now includes the winner's rows — and
//   retry, bounded). CAS-on-seq, not on mtime: two processes appending in the same millisecond
//   would make an mtime CAS lose an update. BEGIN/COMMIT is unsound here — a pooled client may
//   serve each query() from a different connection — and CAS is one of the serialization means the
//   SDK docs explicitly sanction. A fresh sidecar row seeds `seq` with a random 48-bit generation
//   token, not 0: a delete + recreate would otherwise reincarnate at the same seq and let a stale
//   CAS (read before the delete) overwrite the new incarnation with a summary of deleted rows
//   (classic ABA). Exhaustion throws: the SDK retries a rejected append and
//   surfaces persistent failure as a mirror_error message, the designed recovery channel. With
//   concurrent multi-process writers (outside the SDK's one-subprocess-owns-a-session design)
//   entry order is id (allocation) order — a consistent total order shared by load() and the fold.
// - delete() on the main key cascades to all subpaths + the sidecar row in ONE data-modifying-CTE
//   statement — a single statement is a single implicit transaction even over a pooled query(), so
//   there is no partial-delete state to observe or recover. The fold additionally refuses to
//   CREATE a sidecar when the transcript is empty and none existed, so a fold landing after the
//   delete cannot resurrect a ghost session; a delete racing a concurrent append settles fully
//   gone or fully present (append-after-delete), with transient rows-without-summary healed by the
//   next fold. Retention (TTLs, compliance windows) stays the deployment's job.
// Schema management ships both ways: postgresSessionStoreDDL(prefix) for migration tooling, and
// the idempotent ensurePostgresSessionStoreSchema(client, opts) (CREATE ... IF NOT EXISTS).
import { createHash } from "node:crypto";
import { foldSessionSummary } from "@anthropic-ai/claude-agent-sdk";
import type { SessionKey, SessionStore, SessionStoreEntry, SessionSummaryEntry } from "@anthropic-ai/claude-agent-sdk";

/** The minimal query surface we need — node-postgres Pool/Client and PGlite satisfy this as-is. */
export interface PgLike {
  query(text: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

export interface PostgresSessionStoreOptions {
  /** Table-name prefix (tables `<prefix>_entries`, `<prefix>_sessions`). Default "ccs". */
  prefix?: string;
  /** Injectable clock (testing). Stamps listSessions/summary mtimes. */
  now?: () => number;
}

const CAS_ATTEMPTS = 5;

/** Generation token for a fresh sidecar row — never 0, so a delete + recreate cannot reincarnate
 *  at a seq a stale CAS already read (ABA). 48-bit: safely inside both BIGINT and JS integers. */
const newGeneration = () => Math.floor(Math.random() * 2 ** 48) + 1;

/** Identifiers can't be parameterized — refuse anything that isn't a plain SQL identifier. Capped
 *  at 40 chars: Postgres silently truncates identifiers to 63 bytes, and our longest generated name
 *  adds 16 (`_entries_uuid_uq`) — a too-long prefix would collide names into an unusable schema.
 *  LOWERCASE ONLY, and this is a safety rule, not a style one: the prefix is interpolated UNQUOTED, so
 *  Postgres case-folds it. Two deployments configured "Acme" and "acme" would believe they had separate
 *  schemas and silently share one set of tables — reading and writing each other's transcripts, with the
 *  second ensure...Schema() call no-opping via IF NOT EXISTS instead of complaining. Rejecting is the only
 *  answer that surfaces the collision; quietly lowercasing would keep the two prefixes pointing at the
 *  same tables while looking like it had handled the problem. */
function checkPrefix(p: string): string {
  if (!/^[a-z_][a-z0-9_]{0,39}$/.test(p)) throw new Error(`PostgresSessionStore: invalid table prefix ${JSON.stringify(p)} (lowercase SQL identifier, max 40 chars — unquoted identifiers are case-folded, so "Acme" and "acme" would collide)`);
  return p;
}

function ddlStatements(prefix: string): string[] {
  const p = checkPrefix(prefix);
  return [
    `CREATE TABLE IF NOT EXISTS ${p}_entries (
      id          BIGSERIAL PRIMARY KEY,
      project_key TEXT NOT NULL,
      session_id  TEXT NOT NULL,
      subpath     TEXT NOT NULL DEFAULT '',
      uuid        TEXT,
      entry       TEXT NOT NULL
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS ${p}_entries_uuid_uq
      ON ${p}_entries (project_key, session_id, subpath, uuid) WHERE uuid IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS ${p}_entries_key_idx
      ON ${p}_entries (project_key, session_id, subpath, id)`,
    `CREATE TABLE IF NOT EXISTS ${p}_sessions (
      project_key TEXT NOT NULL,
      session_id  TEXT NOT NULL,
      mtime       BIGINT NOT NULL,
      seq         BIGINT NOT NULL,
      summary     TEXT NOT NULL,
      PRIMARY KEY (project_key, session_id)
    )`,
  ];
}

/** The full schema as one SQL string — for deployments that own DDL via migration tooling. */
export function postgresSessionStoreDDL(prefix = "ccs"): string {
  return ddlStatements(prefix).map((s) => `${s};`).join("\n\n");
}

/** Idempotently creates the adapter's tables/indexes. Call once at startup (or ship the DDL instead). */
export async function ensurePostgresSessionStoreSchema(client: PgLike, opts: PostgresSessionStoreOptions = {}): Promise<void> {
  for (const stmt of ddlStatements(opts.prefix ?? "ccs")) await client.query(stmt);
}

export function createPostgresSessionStore(client: PgLike, opts: PostgresSessionStoreOptions = {}): SessionStore {
  const p = checkPrefix(opts.prefix ?? "ccs");
  const now = opts.now ?? Date.now;
  const E = `${p}_entries`;
  const S = `${p}_sessions`;

  // Per-session append serialization (first guard; the seq CAS below covers cross-process races).
  const chains = new Map<string, Promise<void>>();
  const serialized = (id: string, fn: () => Promise<void>): Promise<void> => {
    const next = (chains.get(id) ?? Promise.resolve()).then(fn, fn);
    chains.set(id, next);
    const cleanup = () => { if (chains.get(id) === next) chains.delete(id); };
    next.then(cleanup, cleanup);
    return next;
  };

  // Per-session fold state, in-process, two distinct jobs:
  //  - `folds` is what the last SUCCESSFUL fold saw ({count, summary}), so the next fold can CONTINUE from
  //    it — foldSessionSummary's first parameter is exactly a prior summary — instead of re-reading and
  //    re-parsing the entire transcript on every append (which made writing a session quadratic in its
  //    length). Every use is validated against a live row count: unless the table moved by exactly the
  //    batch we just inserted, we fall back to the full re-fold the header describes. A stale or missing
  //    cache entry therefore only ever costs time, never correctness, which is what lets this coexist with
  //    the header's watermark objection — we are not trusting an id, we are proving nothing else committed.
  //  - `inflight` is the fingerprint of a batch whose INSERT COMMITTED but whose fold then threw. The SDK
  //    retries the whole batch; uuid-bearing rows are absorbed by ON CONFLICT, but titles/tags/mode markers
  //    carry no uuid, are not covered by the partial unique index, and would land a SECOND time —
  //    permanently duplicating them in load() and in every later fold.
  const folds = new Map<string, { count: number; summary: SessionSummaryEntry }>();
  const inflight = new Map<string, string>();
  const FOLD_CACHE_CAP = 500;   // a long-lived daemon touches unboundedly many sessions; evicting just re-folds
  const fingerprint = (entries: readonly SessionStoreEntry[]) =>
    createHash("sha1").update(entries.map((e) => e.uuid ?? JSON.stringify(e)).join("\0")).digest("hex");

  const foldSidecar = async (key: SessionKey, clock: number, added: readonly SessionStoreEntry[]): Promise<void> => {
    const ck = `${key.projectKey}\0${key.sessionId}`;
    for (let i = 0; i < CAS_ATTEMPTS; i++) {
      const prev = await client.query(`SELECT seq, mtime FROM ${S} WHERE project_key = $1 AND session_id = $2`, [key.projectKey, key.sessionId]);
      const prior = prev.rows[0];
      const tot = await client.query(`SELECT count(*) AS n FROM ${E} WHERE project_key = $1 AND session_id = $2 AND subpath = ''`, [key.projectKey, key.sessionId]);
      const total = Number(tot.rows[0].n);
      if (!prior && total === 0) return; // nothing to summarize and no row to refresh — never resurrect a deleted session
      const mtime = prior ? Math.max(Number(prior.mtime), clock) : clock; // never move a newer stamp backwards
      // Only the FIRST attempt may go incremental: a CAS loss means another writer committed between our
      // read and our update, so the cache no longer describes what is in the table.
      const cached = i === 0 ? folds.get(ck) : undefined;
      let summary: SessionSummaryEntry;
      let counted: number;
      if (cached && total === cached.count + added.length) {
        // The row count moved by exactly our own batch, so nothing else landed and the cached summary plus
        // these entries ARE the whole transcript. Fold the JSON round-trip of the caller's objects, not the
        // objects themselves: that is byte-for-byte what the full re-fold below would have read back out of
        // the table, so the two paths cannot produce different summaries for the same transcript.
        summary = foldSessionSummary(cached.summary, key, added.map((e) => JSON.parse(JSON.stringify(e)) as SessionStoreEntry), { mtime });
        counted = total;
      } else {
        // Recompute from the full committed transcript in id order (see header: no batch, no watermark).
        const all = await client.query(
          `SELECT entry FROM ${E} WHERE project_key = $1 AND session_id = $2 AND subpath = '' ORDER BY id`,
          [key.projectKey, key.sessionId],
        );
        summary = foldSessionSummary(undefined, key, all.rows.map((r) => JSON.parse(r.entry) as SessionStoreEntry), { mtime });
        counted = all.rows.length;   // what we actually folded, not the earlier count — never overstate the cache
      }
      let won = false;
      if (prior) {
        const upd = await client.query(
          `UPDATE ${S} SET mtime = $3, seq = seq + 1, summary = $4 WHERE project_key = $1 AND session_id = $2 AND seq = $5 RETURNING 1 AS ok`,
          [key.projectKey, key.sessionId, mtime, JSON.stringify(summary), prior.seq],
        );
        won = upd.rows.length > 0;
      } else {
        const ins = await client.query(
          `INSERT INTO ${S} (project_key, session_id, mtime, seq, summary) VALUES ($1, $2, $3, $5, $4) ON CONFLICT (project_key, session_id) DO NOTHING RETURNING 1 AS ok`,
          [key.projectKey, key.sessionId, mtime, JSON.stringify(summary), newGeneration()],
        );
        won = ins.rows.length > 0;
      }
      if (won) {
        if (folds.size >= FOLD_CACHE_CAP && !folds.has(ck)) folds.clear();
        folds.set(ck, { count: counted, summary });
        return;
      }
    }
    folds.delete(ck);   // never leave a cached summary claiming to describe a transcript we failed to fold
    throw new Error(`PostgresSessionStore: summary sidecar CAS did not converge after ${CAS_ATTEMPTS} attempts (${key.projectKey}/${key.sessionId})`);
  };

  return {
    async append(key, entries) {
      if (entries.length === 0) return;
      await serialized(`${key.projectKey}\0${key.sessionId}`, async () => {
        const sub = key.subpath ?? "";
        const ck = `${key.projectKey}\0${key.sessionId}`;
        const fp = key.subpath ? "" : fingerprint(entries);
        // The INSERT and the fold are two statements, so an append is not atomic: the rows are already
        // committed when the fold runs. If the fold then throws, the SDK retries THIS BATCH — and re-running
        // the INSERT would duplicate every uuid-less entry, because ON CONFLICT only covers uuid-bearing
        // rows. Recognizing our own committed batch lets the retry do what it actually needs to: re-fold.
        if (key.subpath || inflight.get(ck) !== fp) {
          const params: unknown[] = [key.projectKey, key.sessionId, sub];
          const values = entries.map((e) => {
            params.push(e.uuid ?? null, JSON.stringify(e));
            return `($1,$2,$3,$${params.length - 1},$${params.length})`;
          });
          // Dedup happens IN the statement: replayed uuids no-op (intra-batch dups collapse to first).
          await client.query(
            `INSERT INTO ${E} (project_key, session_id, subpath, uuid, entry) VALUES ${values.join(",")}
             ON CONFLICT (project_key, session_id, subpath, uuid) WHERE uuid IS NOT NULL DO NOTHING`,
            params,
          );
        }
        if (key.subpath) return; // subkeys are discovered from the entries table; no sidecar for subpaths
        inflight.set(ck, fp);          // set BEFORE the fold: a throw must leave the marker behind
        await foldSidecar(key, now(), entries);
        inflight.delete(ck);
      });
    },

    async load(key) {
      const { rows } = await client.query(
        `SELECT entry FROM ${E} WHERE project_key = $1 AND session_id = $2 AND subpath = $3 ORDER BY id`,
        [key.projectKey, key.sessionId, key.subpath ?? ""],
      );
      return rows.length ? rows.map((r) => JSON.parse(r.entry) as SessionStoreEntry) : null;
    },

    async listSessions(projectKey) {
      const { rows } = await client.query(`SELECT session_id, mtime FROM ${S} WHERE project_key = $1`, [projectKey]);
      return rows.map((r) => ({ sessionId: r.session_id as string, mtime: Number(r.mtime) })); // int8 is a string in node-postgres
    },

    async listSessionSummaries(projectKey) {
      const { rows } = await client.query(`SELECT summary FROM ${S} WHERE project_key = $1`, [projectKey]);
      return rows.map((r) => JSON.parse(r.summary) as SessionSummaryEntry);
    },

    async delete(key) {
      if (key.subpath) {
        await client.query(`DELETE FROM ${E} WHERE project_key = $1 AND session_id = $2 AND subpath = $3`, [key.projectKey, key.sessionId, key.subpath]);
        return; // deleting a subagent transcript leaves the session rows alone
      }
      // Drop the in-process fold state with the rows it described, so a session recreated under the same
      // id cannot be folded against its predecessor's summary.
      const ck = `${key.projectKey}\0${key.sessionId}`;
      folds.delete(ck); inflight.delete(ck);
      // One data-modifying-CTE statement = one implicit transaction: no partial-delete state exists.
      await client.query(
        `WITH del_entries AS (DELETE FROM ${E} WHERE project_key = $1 AND session_id = $2)
         DELETE FROM ${S} WHERE project_key = $1 AND session_id = $2`,
        [key.projectKey, key.sessionId],
      );
    },

    async listSubkeys(key) {
      const { rows } = await client.query(
        `SELECT DISTINCT subpath FROM ${E} WHERE project_key = $1 AND session_id = $2 AND subpath <> ''`,
        [key.projectKey, key.sessionId],
      );
      return rows.map((r) => r.subpath as string);
    },
  };
}
