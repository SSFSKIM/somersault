// The external SessionStore Postgres adapter (companion to redisSessionStore.ts). Dependency-free:
// DI over a minimal pg-compatible client interface, so `cc-harness` ships no pg dependency — pass
// any client whose query(text, params) resolves {rows} (node-postgres Pool/Client and PGlite both
// satisfy PgLike as-is).
//
// SDK contract honored (sdk.d.ts SessionStore, @alpha) — and exceeded vs the official
// examples/session-stores/postgres reference (which ships no uuid dedup and no summaries):
// - append() is a mirror called AFTER the local write; entries are opaque JSON blobs (JSONB —
//   key reordering is fine, the contract requires deep-equal, not byte-equal).
// - `uuid` is an idempotency key: a partial UNIQUE index + ON CONFLICT DO NOTHING dedups atomically
//   IN the insert statement (first-seen payload wins; cross-process safe, unlike the Redis
//   adapter's check-then-write which leans on its in-process chain). Entries WITHOUT a uuid
//   (titles, tags, mode markers) append un-deduped, per the contract.
// - subpath is normalized to '' for the main transcript: Postgres UNIQUE treats NULLs as distinct,
//   which would silently disable dedup for main-transcript rows if subpath were NULL.
// - load() returns null iff the transcript has no rows — with row-level dedup, "written but
//   emptied by replay" cannot arise (a replay only skips because the rows already exist).
// - listSessions()/listSessionSummaries() read the sessions sidecar table; mtime is stamped at
//   persist time with the adapter clock (NOT entry timestamps), Number()-wrapped because
//   node-postgres returns int8 as a string (PGlite returns a number — both covered).
// - Summaries fold via foldSessionSummary inside append() for MAIN transcripts only. The sidecar is
//   a PURE FUNCTION OF THE PERSISTED TRANSCRIPT PREFIX: it keeps a `folded_id` watermark and each
//   fold consumes the entry rows with id > watermark IN id ORDER (not the in-memory batch). That
//   makes it (a) retry-recoverable — if the insert lands but the sidecar write fails, the SDK's
//   retry finds the rows still above the watermark and folds them (a batch-fed fold would see only
//   ON CONFLICT skips and lose set-once fields forever) — and (b) order-correct across processes:
//   whichever process folds first consumes ALL pending rows in transcript order, and the loser's
//   fold degrades to an mtime refresh. Guarded twice: the in-process per-session promise chain
//   (Redis-adapter precedent) plus a cross-process CAS on a dedicated `seq` column (UPDATE ...
//   WHERE seq = prior; 0 rows back = a concurrent writer won, re-read and retry, bounded).
//   CAS-on-seq, not on mtime: two processes appending in the same millisecond would make an mtime
//   CAS lose an update. BEGIN/COMMIT is unsound here — a pooled client may serve each query() from
//   a different connection — and CAS is one of the serialization means the SDK docs explicitly
//   sanction. Exhaustion throws: the SDK retries a rejected append and surfaces persistent failure
//   as a mirror_error message, which is the designed recovery channel.
// - delete() on the main key cascades to all subpaths + the sidecar row, sidecar FIRST: a delete
//   racing a cross-process append then worst-cases as rows-without-summary (which the next append
//   heals from the watermark), never a summary claiming rows that are gone. Full delete-vs-append
//   serializability is the deployment's call (the SDK's design is one-writer-per-session), as is
//   retention (TTLs, compliance windows).
// Schema management ships both ways: postgresSessionStoreDDL(prefix) for migration tooling, and
// the idempotent ensurePostgresSessionStoreSchema(client, opts) (CREATE ... IF NOT EXISTS).
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

/** Identifiers can't be parameterized — refuse anything that isn't a plain SQL identifier. Capped
 *  at 40 chars: Postgres silently truncates identifiers to 63 bytes, and our longest generated name
 *  adds 16 (`_entries_uuid_uq`) — a too-long prefix would collide names into an unusable schema. */
function checkPrefix(p: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,39}$/.test(p)) throw new Error(`PostgresSessionStore: invalid table prefix ${JSON.stringify(p)} (SQL identifier, max 40 chars)`);
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
      entry       JSONB NOT NULL
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
      folded_id   BIGINT NOT NULL,
      summary     JSONB NOT NULL,
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

  const foldSidecar = async (key: SessionKey, clock: number): Promise<void> => {
    for (let i = 0; i < CAS_ATTEMPTS; i++) {
      const prev = await client.query(`SELECT seq, folded_id, mtime, summary FROM ${S} WHERE project_key = $1 AND session_id = $2`, [key.projectKey, key.sessionId]);
      const prior = prev.rows[0];
      // Fold from the TABLE, not the batch: everything above the watermark, in transcript (id) order.
      const pend = await client.query(
        `SELECT id, entry FROM ${E} WHERE project_key = $1 AND session_id = $2 AND subpath = '' AND id > $3 ORDER BY id`,
        [key.projectKey, key.sessionId, prior ? prior.folded_id : 0],
      );
      const entries = pend.rows.map((r) => r.entry as SessionStoreEntry);
      const mtime = prior ? Math.max(Number(prior.mtime), clock) : clock; // never move a newer stamp backwards
      if (prior) {
        const foldedId = pend.rows.length ? pend.rows[pend.rows.length - 1].id : prior.folded_id;
        const summary = foldSessionSummary(prior.summary as SessionSummaryEntry, key, entries, { mtime });
        const upd = await client.query(
          `UPDATE ${S} SET mtime = $3, seq = seq + 1, folded_id = $4, summary = $5::jsonb WHERE project_key = $1 AND session_id = $2 AND seq = $6 RETURNING 1 AS ok`,
          [key.projectKey, key.sessionId, mtime, foldedId, JSON.stringify(summary), prior.seq],
        );
        if (upd.rows.length) return;
      } else {
        const foldedId = pend.rows.length ? pend.rows[pend.rows.length - 1].id : 0;
        const summary = foldSessionSummary(undefined, key, entries, { mtime });
        const ins = await client.query(
          `INSERT INTO ${S} (project_key, session_id, mtime, seq, folded_id, summary) VALUES ($1, $2, $3, 0, $4, $5::jsonb) ON CONFLICT (project_key, session_id) DO NOTHING RETURNING 1 AS ok`,
          [key.projectKey, key.sessionId, mtime, foldedId, JSON.stringify(summary)],
        );
        if (ins.rows.length) return;
      }
    }
    throw new Error(`PostgresSessionStore: summary sidecar CAS did not converge after ${CAS_ATTEMPTS} attempts (${key.projectKey}/${key.sessionId})`);
  };

  return {
    async append(key, entries) {
      if (entries.length === 0) return;
      await serialized(`${key.projectKey}\0${key.sessionId}`, async () => {
        const sub = key.subpath ?? "";
        const params: unknown[] = [key.projectKey, key.sessionId, sub];
        const values = entries.map((e) => {
          params.push(e.uuid ?? null, JSON.stringify(e));
          return `($1,$2,$3,$${params.length - 1},$${params.length}::jsonb)`;
        });
        // Dedup happens IN the statement: replayed uuids no-op (intra-batch dups collapse to first).
        await client.query(
          `INSERT INTO ${E} (project_key, session_id, subpath, uuid, entry) VALUES ${values.join(",")}
           ON CONFLICT (project_key, session_id, subpath, uuid) WHERE uuid IS NOT NULL DO NOTHING`,
          params,
        );
        if (key.subpath) return; // subkeys are discovered from the entries table; no sidecar for subpaths
        await foldSidecar(key, now());
      });
    },

    async load(key) {
      const { rows } = await client.query(
        `SELECT entry FROM ${E} WHERE project_key = $1 AND session_id = $2 AND subpath = $3 ORDER BY id`,
        [key.projectKey, key.sessionId, key.subpath ?? ""],
      );
      return rows.length ? rows.map((r) => r.entry as SessionStoreEntry) : null;
    },

    async listSessions(projectKey) {
      const { rows } = await client.query(`SELECT session_id, mtime FROM ${S} WHERE project_key = $1`, [projectKey]);
      return rows.map((r) => ({ sessionId: r.session_id as string, mtime: Number(r.mtime) })); // int8 is a string in node-postgres
    },

    async listSessionSummaries(projectKey) {
      const { rows } = await client.query(`SELECT summary FROM ${S} WHERE project_key = $1`, [projectKey]);
      return rows.map((r) => r.summary as SessionSummaryEntry);
    },

    async delete(key) {
      if (key.subpath) {
        await client.query(`DELETE FROM ${E} WHERE project_key = $1 AND session_id = $2 AND subpath = $3`, [key.projectKey, key.sessionId, key.subpath]);
        return; // deleting a subagent transcript leaves the session rows alone
      }
      // Sidecar first (see header): a racing append then worst-cases as rows-without-summary, self-healing.
      await client.query(`DELETE FROM ${S} WHERE project_key = $1 AND session_id = $2`, [key.projectKey, key.sessionId]);
      await client.query(`DELETE FROM ${E} WHERE project_key = $1 AND session_id = $2`, [key.projectKey, key.sessionId]);
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
