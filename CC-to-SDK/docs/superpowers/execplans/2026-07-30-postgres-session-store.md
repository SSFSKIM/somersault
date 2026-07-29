# Postgres SessionStore adapter for cc-harness

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds. It is maintained in accordance with the PLANS.md vendored in the doperpowers execplan skill (not checked into this repo; its requirements are restated here by being followed).

## Purpose / Big Picture

`cc-harness` (the npm package in `CC-to-SDK/harness/`) wraps the Claude Agent SDK. The SDK persists conversation transcripts to local JSONL files, and accepts an optional `sessionStore` — an adapter object — that mirrors every transcript batch to external storage so a session started on one cloud host can be resumed on another. The harness already ships one such adapter for Redis (`src/store/redisSessionStore.ts`, shipped in Wave 3) plus an executable contract suite (`src/store/conformance.ts`). The consumer that motivates this change (the doperpowers deployment, which scales on PostgreSQL, confirmed by the project owner on 2026-07-30) needs the same thing backed by Postgres.

After this change, a user of `cc-harness` can write:

    import { createPostgresSessionStore, ensurePostgresSessionStoreSchema } from "cc-harness";
    import { Pool } from "pg";
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await ensurePostgresSessionStoreSchema(pool);
    const store = createPostgresSessionStore(pool);
    // pass as options.sessionStore to query()/openSession()/createHarness()

and get a fully contract-conformant Postgres mirror: ordered append/load round-trips, uuid-idempotent retries, session listing with mtimes, one-call summary listing, cascading delete, and subagent-transcript discovery — with **cross-process** safety (something the Redis adapter deliberately punted to the deployment). Seeing it work: `npm run test:unit` in `harness/` runs the whole conformance suite against a real Postgres engine (PGlite, in-process WASM Postgres) with no server and no API key.

## Progress

- [x] (2026-07-30) Grill completed in-session; all design decisions settled (see Decision Log).
- [x] (2026-07-30) Official SDK reference adapter read (`examples/session-stores/postgres` from anthropics/claude-agent-sdk-typescript; copy at `$CLAUDE_JOB_DIR/tmp/official-pg-store.ts`).
- [x] (2026-07-30) ExecPlan authored and committed.
- [x] (2026-07-30) Milestone 1: PGlite spike — @electric-sql/pglite@0.5.4 installed; all five engine facts verified (see Surprises & Discoveries).
- [ ] Milestone 2: adapter TDD — conformance suite (uuidDedup) + adapter-specific tests green against PGlite.
- [ ] Milestone 3: exports + docs — index.ts barrel + surface-pin test, coverage.md row, memory refresh, full gates green.
- [ ] Milestone 4: exit gate — external whole-branch review (codex; argus fallback), fixes, retrospective.

## Surprises & Discoveries

- Observation: the official SDK reference adapter does NOT deduplicate by `entry.uuid`, even though the same docs page instructs adapter authors to ("Because a retried batch can re-deliver entries that already landed, deduplicate by `entry.uuid`"). It also omits `listSessionSummaries`, so listing falls back to a per-session `load()`.
  Evidence: `$CLAUDE_JOB_DIR/tmp/official-pg-store.ts` — plain `INSERT` with no ON CONFLICT, no summaries table. Our adapter exceeds the reference on both counts.
- Observation: `node-postgres` returns Postgres `BIGINT` (`int8`) values as JS **strings** by default (precision safety); PGlite may behave likewise.
  Evidence: node-postgres type-parsing documentation. The Milestone-1 spike showed PGlite differs: int8 arrives as a JS `number` ("OBS int8 comes back as: number"). The adapter wraps every mtime read in `Number(...)`, which is correct over both drivers.
- Observation (M1 spike, 2026-07-30, PGlite@0.5.4, `npx tsx` from `harness/`): all five engine facts held. (1) `PGlite` assigns to the planned `PgLike` structurally and `query(text, params)` resolves `{rows}`; startup ~1.3s per in-memory instance — confirming the one-shared-instance + per-store-prefix test topology. (2) Partial UNIQUE + `ON CONFLICT ... WHERE uuid IS NOT NULL DO NOTHING` skips a replayed uuid and keeps the first payload. (3) A single multi-row INSERT with an intra-batch duplicate uuid does not error; the duplicate collapses to one row. (4) `RETURNING uuid` reports only the rows that actually landed (`["u2",null]` for a batch of replayed-u1 + u2 + u2-dup + uuid-less). (5) JSONB round-trips deep-equal under `assert.deepStrictEqual` with key reordering (`{z,a,s}` → `{a,s,z}`) — the docs-blessed behavior. A first-pass "deep-equal=false" was a defect in the spike's own comparison, not the engine; re-verified with a proper deep comparison.

## Decision Log

- Decision: dependency-free DI over a minimal `PgLike` interface — `{ query(text: string, params?: unknown[]): Promise<{ rows: any[] }> }` — instead of depending on `pg` (even as a type-only import, which the official reference uses).
  Rationale: exact mirror of the shipped `RedisLike` pattern; `pg.Pool`, `pg.Client`, and PGlite all satisfy it unmodified; `cc-harness` keeps zero runtime deps beyond the SDK/zod/ink set. The project owner confirmed the consuming side (doperpowers) uses pg-style node-postgres.
  Date/Author: 2026-07-30, grill.
- Decision: schema management ships BOTH ways — an exported `POSTGRES_SESSION_STORE_DDL` string-building function (for migration tooling) and an idempotent `ensurePostgresSessionStoreSchema(client, opts)` helper (`CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`).
  Rationale: doperpowers may or may not route DDL through its own migration tool; both cost almost nothing. Chosen over "DDL constant only" (assumes migrations exist) and "auto-create inside the factory" (fails under restricted DB users, hides a network round-trip in a constructor).
  Date/Author: 2026-07-30, grill (user picked "both" explicitly).
- Decision: uuid idempotency via a partial UNIQUE index (`(project_key, session_id, subpath, uuid) WHERE uuid IS NOT NULL`) + `INSERT ... ON CONFLICT DO NOTHING RETURNING uuid`.
  Rationale: single-statement, atomic, cross-process-safe dedup; first-seen payload wins (the conformance suite's drifted-payload check); uuid-less entries (titles/tags/markers) always insert, per the SDK contract. Beats the Redis adapter's check-then-write (which is only safe under its in-process chain) and beats the official reference (no dedup at all).
  Date/Author: 2026-07-30, grill.
- Decision: `subpath` is stored as `TEXT NOT NULL DEFAULT ''` — the main transcript is the empty string, never NULL.
  Rationale: Postgres UNIQUE indexes treat NULLs as distinct, which would silently disable dedup for main-transcript entries; `''` keeps the four-column unique index honest and lets every lookup use plain `=` instead of `IS NOT DISTINCT FROM`.
  Date/Author: 2026-07-30, authoring.
- Decision: summary-sidecar concurrency via compare-and-swap (CAS) on the sessions row (`UPDATE ... WHERE mtime = $prior RETURNING 1`, bounded retry loop; INSERT arm uses `ON CONFLICT DO NOTHING` and retries on loss) — NOT `BEGIN`/`COMMIT`, NOT advisory locks. The in-process per-session promise chain from the Redis adapter is kept as the first line of serialization.
  Rationale: over a bare `query()` DI a pooled client may serve each call from a different connection, so multi-statement transactions are unsound; CAS is one of the three serialization mechanisms the SDK's session-storage docs explicitly sanction ("a transaction, a compare-and-swap, or a per-session lock") and works over any conforming client, giving cross-process safety the Redis adapter documented away.
  Date/Author: 2026-07-30, grill + authoring.
- Decision: `load()` returns null iff the transcript has no rows.
  Rationale: with row-level dedup, "written but emptied by replay" cannot arise (a replayed batch only skips because the rows already exist), so row-absence IS never-written. The Redis adapter needed an explicit written-marker only because its dedup state (the uuid set) lived apart from the entries. An `append(key, [])` no-ops (official reference does the same); the contract suite has no empty-append check.
  Date/Author: 2026-07-30, authoring.
- Decision: unit-test against PGlite (`@electric-sql/pglite`, devDependency only), one shared in-memory instance with a unique table prefix per `makeStore()` call; no fake-SQL client, no gated live Postgres test.
  Rationale: PGlite IS Postgres (WASM build), so the conformance suite exercises the real engine keylessly — strictly better evidence than a hand-written fake; a `DATABASE_URL`-gated live test would duplicate that evidence for CI cost. Fresh-instance-per-test rejected: PGlite startup is heavy relative to a prefix swap, and the conformance factory contract only requires empty storage per call.
  Date/Author: 2026-07-30, grill decision 7 + authoring.
- Decision: factory function `createPostgresSessionStore(client, opts)` (not a class), exported from the `src/index.ts` barrel alongside `PgLike`, options type, DDL, and ensure-helper; the Redis adapter stays untouched.
  Rationale: house style (`createRedisSessionStore` precedent); this is an addition to the adapter family, not a replacement.
  Date/Author: 2026-07-30, grill.
- Decision: work directly on `main` with frequent commits, no worktree, no push.
  Rationale: the repo's standing git rules (commit completed work to the current branch including main; never push without explicit request) override the execplan skill's worktree default; this session is explicitly configured to work in place.
  Date/Author: 2026-07-30, authoring.
## Outcomes & Retrospective

Pending — written at finish.

## Context and Orientation

All paths below are relative to `CC-to-SDK/harness/` inside the repository `codex_somersault` unless prefixed otherwise. This is a TypeScript ESM package (`cc-harness`); import specifiers end in `.js` even though sources are `.ts`. Code style is dense hand-style, no Prettier — match the neighboring file, do not reformat. Tests are vitest; the fast gates are `npm run typecheck` and `npm run test:unit` (both run from `harness/`, no API key needed).

Terms used below, defined once:

- **SessionStore**: the adapter interface the Claude Agent SDK exports (`SessionStore`, `SessionKey`, `SessionStoreEntry`, `SessionSummaryEntry` from `@anthropic-ai/claude-agent-sdk`). Two required methods — `append(key, entries)` (called after each batch of transcript lines is written locally; entries are opaque JSON-safe objects) and `load(key)` (must return the appended entries in order, deep-equal, or null for an unknown session) — plus four optional ones: `listSessions(projectKey)` → `{sessionId, mtime}[]`, `listSessionSummaries(projectKey)` → `SessionSummaryEntry[]`, `delete(key)` (main-key delete must cascade to subpaths and the summary), `listSubkeys({projectKey, sessionId})` → subpath strings.
- **SessionKey**: `{ projectKey, sessionId, subpath? }`. `projectKey` is a sanitized working-directory string, `sessionId` a UUID, `subpath` set only for subagent/sidecar transcripts (e.g. `subagents/agent-x.jsonl`); undefined subpath = the main transcript.
- **uuid idempotency**: the SDK retries a failed `append` batch up to two more times, and retried batches can re-deliver entries that already landed; entries that carry a `uuid` field must therefore append at most once (first-seen payload wins), while entries without a uuid (title/tag/marker rows) append as-is every time.
- **summary sidecar**: `listSessionSummaries` must be maintained *inside* `append` by folding each fresh batch through the SDK's pure `foldSessionSummary(prev, key, entries, {mtime})` helper — main transcript only, never subpath batches. `mtime` is stamped at persist time from the adapter's clock and must share that clock with `listSessions`. Concurrent appends race on this read-fold-write; the docs sanction a transaction, a CAS, or a per-session lock.
- **PGlite**: `@electric-sql/pglite`, a full Postgres compiled to WASM that runs in-process in Node with no server. `new PGlite()` gives an in-memory database whose `.query(sql, params)` resolves to `{ rows }` — the same shape as node-postgres.
- **CAS (compare-and-swap)**: an optimistic-concurrency update — read the current value, compute the new one, then `UPDATE ... WHERE the-value-is-still-what-I-read`; if zero rows changed, someone else won the race, so re-read and retry.

Files that matter:

- `src/store/redisSessionStore.ts` — the shipped Redis adapter; the pattern donor (DI interface, factory shape, injectable clock, per-session promise chain, doc-comment style). Read it before writing any code.
- `src/store/conformance.ts` — `sessionStoreConformance(name, makeStore, {describe,it,expect}, {uuidDedup})`: the executable contract. The new adapter must pass with `uuidDedup: true`.
- `test/unit/session-store.test.ts` — how the Redis adapter is tested; the new test file mirrors its structure.
- `src/index.ts` — the curated public-API barrel (store exports live around line 38); `test/unit/index.test.ts` pins the export surface and must be updated in the same change.
- `CC-to-SDK/docs/parity/coverage.md` — the capability scorecard; the store row (domain 9, Wave-3 entries) gets a line for the Postgres adapter at close-out.
- `$CLAUDE_JOB_DIR/tmp/official-pg-store.ts` — downloaded copy of the official SDK example adapter (for comparison only; do not copy its code — ours is stronger and house-styled).

## Plan of Work

**Milestone 1 — PGlite feasibility spike (prototyping; deliverable is knowledge).** Install `@electric-sql/pglite` as a devDependency in `harness/`. Write a throwaway script (NOT committed; keep under `$CLAUDE_JOB_DIR/tmp/`) that, against `new PGlite()`: (1) runs a parameterized `query(text, params)` and confirms the `{rows}` shape satisfies the planned `PgLike`; (2) creates a table with the partial UNIQUE index below and confirms `INSERT ... ON CONFLICT DO NOTHING` skips a duplicate uuid while keeping the first payload; (3) confirms a single multi-row INSERT containing two rows with the same uuid does not error under DO NOTHING; (4) confirms `RETURNING uuid` on that INSERT returns only the actually-inserted rows; (5) round-trips a JSONB entry and checks deep-equality (key order may differ — that is fine and documented). Also observe what type an `int8` (BIGINT) column comes back as. Promote criteria: all five observations behave as designed → proceed, recording results in Surprises & Discoveries. If PGlite fails structurally (wrong query shape, no partial-index support), fall back to testing through a devDependency on `pg` against a Dockerized Postgres ONLY after recording the failure — do not silently switch.

**Milestone 2 — the adapter, TDD.** Create `test/unit/postgres-session-store.test.ts` first: wire `sessionStoreConformance("PostgresSessionStore (PGlite)", makeStore, {describe,it,expect}, {uuidDedup:true})` where `makeStore` returns `createPostgresSessionStore(shared PGlite, { prefix: unique-per-call })` after running the ensure-helper for that prefix; plus adapter-specific tests (listed under Validation). Run red. Then create `src/store/postgresSessionStore.ts` with the following design, and iterate to green.

Schema (two tables per prefix `p`, default prefix `ccs`, validated against `/^[A-Za-z_][A-Za-z0-9_]*$/` since identifiers cannot be parameterized):

    CREATE TABLE IF NOT EXISTS <p>_entries (
      id          BIGSERIAL PRIMARY KEY,
      project_key TEXT NOT NULL,
      session_id  TEXT NOT NULL,
      subpath     TEXT NOT NULL DEFAULT '',   -- '' = main transcript
      uuid        TEXT,                        -- NULL for uuid-less entries
      entry       JSONB NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS <p>_entries_uuid_uq
      ON <p>_entries (project_key, session_id, subpath, uuid) WHERE uuid IS NOT NULL;
    CREATE INDEX IF NOT EXISTS <p>_entries_key_idx
      ON <p>_entries (project_key, session_id, subpath, id);
    CREATE TABLE IF NOT EXISTS <p>_sessions (
      project_key TEXT NOT NULL,
      session_id  TEXT NOT NULL,
      mtime       BIGINT NOT NULL,
      summary     JSONB NOT NULL,
      PRIMARY KEY (project_key, session_id)
    );

`postgresSessionStoreDDL(prefix?)` returns that DDL string; `ensurePostgresSessionStoreSchema(client, {prefix}?)` executes it statement-by-statement (PGlite and pg both accept multi-statement strings, but statement-by-statement is the portable choice).

`createPostgresSessionStore(client: PgLike, opts?: { prefix?: string; now?: () => number })` returns a `SessionStore`:

- `append(key, entries)`: no-op on empty. Under the in-process per-session promise chain (same `serialized` helper shape as the Redis adapter): one multi-row `INSERT INTO <p>_entries (project_key, session_id, subpath, uuid, entry) VALUES ... ON CONFLICT (project_key, session_id, subpath, uuid) WHERE uuid IS NOT NULL DO NOTHING RETURNING uuid`. Compute `fresh` = entries that actually landed (uuid-less entries always land; uuid-ed ones filtered by the RETURNING set — and a batch-internal duplicate uuid lands once). If the key has a subpath, stop there (subkeys are discovered from the entries table; subpath batches never touch the sessions table). Otherwise stamp `mtime = now()` and run the sidecar CAS loop (bounded, ~5 attempts): read `SELECT mtime, summary FROM <p>_sessions WHERE ...`; fold `foldSessionSummary(prevSummary, key, fresh, { mtime })`; if a row existed, `UPDATE <p>_sessions SET mtime=$, summary=$ WHERE project_key=$ AND session_id=$ AND mtime=$prior RETURNING 1` — zero rows back means a concurrent writer moved it, so re-read and retry; if no row existed, `INSERT ... ON CONFLICT (project_key, session_id) DO NOTHING RETURNING 1` — zero rows back likewise retries. If the loop exhausts its attempts, throw: the SDK retries a rejected `append` and surfaces persistent failure as a `mirror_error` message, which is the designed recovery channel — a silent return would drop the summary fold with no signal. Note `fresh` can be empty on a pure replay; the sidecar still updates mtime (Redis-adapter parity: an all-dup append refreshes mtime; `foldSessionSummary(prev, key, [], {mtime})` is a pure restamp).
- `load(key)`: `SELECT entry FROM <p>_entries WHERE project_key=$ AND session_id=$ AND subpath=$ ORDER BY id`; null iff zero rows; jsonb comes back pre-parsed — return as-is.
- `listSessions(projectKey)`: `SELECT session_id, mtime FROM <p>_sessions WHERE project_key=$` mapped with `Number(mtime)` (int8 arrives as a string in node-postgres).
- `listSessionSummaries(projectKey)`: `SELECT summary FROM <p>_sessions WHERE project_key=$`; rows are `SessionSummaryEntry` jsonb, already parsed.
- `delete(key)`: with subpath → delete just that transcript's entry rows. Without → delete ALL entry rows for the session (every subpath) and the sessions row.
- `listSubkeys(key)`: `SELECT DISTINCT subpath FROM <p>_entries WHERE project_key=$ AND session_id=$ AND subpath <> ''`.

Retry-safety falls out structurally: a failed INSERT marks nothing (the rows ARE the dedup state), so the SDK's retry re-lands the batch — but write the test anyway (a client whose first `query` rejects).

**Milestone 3 — exports, docs, close-out.** Export `createPostgresSessionStore`, `ensurePostgresSessionStoreSchema`, `postgresSessionStoreDDL`, and types `PgLike`, `PostgresSessionStoreOptions` from `src/index.ts` next to the Redis exports; update `test/unit/index.test.ts`'s surface pin. Run the full gates. Add the Postgres-adapter line to `CC-to-SDK/docs/parity/coverage.md` (domain 9's store row, alongside the Redis entry, marked live-verified-via-PGlite) and refresh the `wave3-production-maturity-shipped` memory file with one line. Commit.

**Milestone 4 — exit gate.** Record the pre-work base SHA at start (Concrete Steps). Run the external review `codex exec review --base <BASE_SHA>` from the repo root (a SHA is a valid ref for `--base`); read only the final `[P_n]` verdicts; if codex fails, run argus-review instead. Fix anything real, then finish per doperpowers:finishing-a-development-branch (on main: no merge — the retrospective step writes `Outcomes & Retrospective` above and updates Progress). No push (standing rule: never without explicit request).

## Concrete Steps

All commands run from `CC-to-SDK/harness/` unless noted. Record the base first (repo root):

    git rev-parse HEAD   # save as BASE_SHA for the Milestone-4 review

Milestone 1:

    npm install --save-dev @electric-sql/pglite
    # write $CLAUDE_JOB_DIR/tmp/pg-spike/spike-pglite.ts per Milestone 1; run:
    npx tsx $CLAUDE_JOB_DIR/tmp/pg-spike/spike-pglite.ts
    # expect five OK lines (query-shape, dedup, batch-dup, returning, jsonb) + the observed int8 type

Milestone 2 (TDD loop):

    npx vitest run test/unit/postgres-session-store.test.ts   # red first, then green
    npm run typecheck

Milestone 3:

    npm run test:unit          # full unit suite; expect ~1520+ passed, 0 new failures
    npm run typecheck
    git add -A && git commit   # dense conventional message, no Co-Authored-By

Milestone 4 (repo root):

    codex exec review --base <BASE_SHA>   # read final [P_n] verdicts only; argus-review on failure

## Validation and Acceptance

Acceptance is behavioral: from `harness/`, `npm run test:unit` passes with the new file `test/unit/postgres-session-store.test.ts` green, which must contain (a) the full `sessionStoreConformance` run with `{uuidDedup: true}` against PGlite — this alone proves ordered round-trip, key isolation, uuid-idempotent replay with first-seen-payload-wins, serialized concurrent appends with a consistent summary sidecar, cascade delete, and subkey listing on a real Postgres engine — and (b) adapter-specific tests: (1) a rejecting first `query` call fails that append but a subsequent append succeeds and the retried batch lands exactly once (retry-safety: nothing was marked seen by the failure); (2) the injected `now` clock stamps both `listSessions` mtime and the summary mtime, updated on later appends; (3) hostile key components (`projectKey` with spaces/colons, quotes) round-trip via parameterization; (4) an invalid table prefix throws at factory time; (5) `ensurePostgresSessionStoreSchema` is idempotent (calling twice does not throw); (6) the CAS loop converges when a competing writer bumps the sessions row between the read and the update (simulate with a wrapped client that injects a competing UPDATE once). `npm run typecheck` stays clean, and `npm run build` still succeeds (public d.ts resolves). Before the change, the new test file fails (module not found); after, it passes — that is the fail-before/pass-after demonstration.

## Idempotence and Recovery

Every step is re-runnable: the DDL is IF-NOT-EXISTS, tests provision a fresh table prefix per store, npm install of a devDependency is idempotent, and commits are additive on main. If a vitest run wedges PGlite (WASM OOM has been seen in other projects under many instances), the shared-instance design bounds that; worst case, re-run the file. If `codex exec review` fails, argus-review is the sanctioned fallback. Nothing here touches the Redis adapter, the daemon, or any live credential; there is no rollback hazard beyond `git revert` of small commits.

## Artifacts and Notes

The official reference (for contrast, not copying) stores one row per entry ordered by BIGSERIAL and matches NULL subpaths with `IS NOT DISTINCT FROM`; we instead normalize subpath to `''` so the dedup index and every lookup use plain equality. Key expected transcript (Milestone 2 end):

    npx vitest run test/unit/postgres-session-store.test.ts
      ✓ SessionStore conformance: PostgresSessionStore (PGlite) (9+2 tests)
      ✓ PostgresSessionStore specifics (6 tests)
    Test Files  1 passed

## Interfaces and Dependencies

New devDependency: `@electric-sql/pglite` (tests only; the published package gains no runtime dependency). In `src/store/postgresSessionStore.ts`, define and export exactly:

    export interface PgLike {
      query(text: string, params?: unknown[]): Promise<{ rows: any[] }>;
    }
    export interface PostgresSessionStoreOptions {
      prefix?: string;            // table-name prefix, default "ccs"; must match /^[A-Za-z_][A-Za-z0-9_]*$/
      now?: () => number;         // injectable clock for mtimes (testing)
    }
    export function postgresSessionStoreDDL(prefix?: string): string;
    export async function ensurePostgresSessionStoreSchema(client: PgLike, opts?: PostgresSessionStoreOptions): Promise<void>;
    export function createPostgresSessionStore(client: PgLike, opts?: PostgresSessionStoreOptions): SessionStore;

`SessionStore`, `SessionKey`, `SessionStoreEntry`, `SessionSummaryEntry`, and `foldSessionSummary` come from `@anthropic-ai/claude-agent-sdk` (already a dependency). All five names above are re-exported from `src/index.ts` and pinned in `test/unit/index.test.ts`.

## Revision Notes

- 2026-07-30 (authoring): initial plan from the in-session grill; all Decision Log entries seeded from grill answers and the official-reference comparison. (An earlier draft of this file pre-filled milestone results that had not happened; corrected to actual state before the first commit.)
