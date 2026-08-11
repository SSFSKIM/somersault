// Postgres SessionStore adapter tests — run against PGlite (real Postgres engine, in-process WASM,
// keyless). One shared instance; each store gets a fresh table prefix, satisfying the conformance
// factory contract (empty storage per call). Mirrors test/unit/session-store.test.ts (Redis).
import { describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { createPostgresSessionStore, ensurePostgresSessionStoreSchema, postgresSessionStoreDDL } from "../../src/store/postgresSessionStore.js";
import type { PgLike } from "../../src/store/postgresSessionStore.js";
import { sessionStoreConformance } from "../../src/store/conformance.js";
import { foldSessionSummary } from "@anthropic-ai/claude-agent-sdk";

const db = new PGlite();
let n = 0;
async function makeStoreWith(opts: { now?: () => number } = {}) {
  const prefix = `t${n++}`;
  await ensurePostgresSessionStoreSchema(db, { prefix });
  return { prefix, store: createPostgresSessionStore(db, { prefix, ...opts }) };
}

sessionStoreConformance("PostgresSessionStore (PGlite)", async () => (await makeStoreWith()).store, { describe, it, expect }, { uuidDedup: true });

/** Wrap the shared PGlite so a test can intercept specific statements. */
function wrap(intercept: (text: string, params: unknown[] | undefined, run: () => Promise<{ rows: any[] }>) => Promise<{ rows: any[] }>): PgLike {
  return { query: (text, params) => intercept(text, params, () => db.query(text, params) as Promise<{ rows: any[] }>) };
}

describe("PostgresSessionStore specifics", () => {
  it("a rejected insert fails that append, nothing is marked seen, and the SDK retry lands the batch once", async () => {
    const prefix = `t${n++}`;
    await ensurePostgresSessionStoreSchema(db, { prefix });
    let fail = true;
    const flaky = wrap(async (text, _params, run) => {
      if (fail && text.startsWith(`INSERT INTO ${prefix}_entries`)) { fail = false; throw new Error("pg down"); }
      return run();
    });
    const store = createPostgresSessionStore(flaky, { prefix });
    const key = { projectKey: "p", sessionId: "s" };
    await expect(store.append(key, [{ type: "user", uuid: "u1", message: { role: "user", content: "hi" } }])).rejects.toThrow("pg down");
    expect(await store.load(key)).toBeNull(); // nothing landed, nothing marked
    await store.append(key, [{ type: "user", uuid: "u1", message: { role: "user", content: "hi" } }]); // SDK retry
    expect((await store.load(key))!.map((e) => e.uuid)).toEqual(["u1"]);
  });

  it("stamps mtime with the injected clock (shared by index and summary), refreshed per append", async () => {
    let t = 1000;
    const { store } = await makeStoreWith({ now: () => t });
    await store.append({ projectKey: "p", sessionId: "s" }, [{ type: "user", uuid: "u1", message: { role: "user", content: "hi" } }]);
    t = 2000;
    await store.append({ projectKey: "p", sessionId: "s" }, [{ type: "user", uuid: "u2" }]);
    expect(await store.listSessions!("p")).toEqual([{ sessionId: "s", mtime: 2000 }]);
    expect((await store.listSessionSummaries!("p"))[0].mtime).toBe(2000);
  });

  it("hostile key components round-trip via parameterization (no encoding layer needed)", async () => {
    const { store } = await makeStoreWith();
    const key = { projectKey: `/Users/a b:c'; DROP TABLE x; --`, sessionId: `s:1"❄` };
    await store.append(key, [{ type: "user", uuid: "u1", message: { role: "user", content: "hi" } }]);
    expect((await store.load(key))!.map((e) => e.uuid)).toEqual(["u1"]);
    expect((await store.listSessions!(key.projectKey)).map((r) => r.sessionId)).toEqual([key.sessionId]);
    await store.delete!(key);
    expect(await store.load(key)).toBeNull();
  });

  it("an invalid table prefix throws at factory, ensure-helper, and DDL time", async () => {
    expect(() => createPostgresSessionStore(db, { prefix: "bad-name" })).toThrow(/prefix/);
    await expect(ensurePostgresSessionStoreSchema(db, { prefix: "1abc" })).rejects.toThrow(/prefix/);
    expect(() => postgresSessionStoreDDL('x"; DROP')).toThrow(/prefix/);
    expect(() => createPostgresSessionStore(db, { prefix: "p".repeat(41) })).toThrow(/prefix/); // 63-byte identifier truncation would collide generated names
    expect(() => createPostgresSessionStore(db, { prefix: "p".repeat(40) })).not.toThrow();
  });

  it("a sidecar failure after the insert is healed by the next fold (full re-fold recovery, transcript order)", async () => {
    const prefix = `t${n++}`;
    await ensurePostgresSessionStoreSchema(db, { prefix });
    let failSidecar = true;
    const flaky = wrap(async (text, _params, run) => {
      if (failSidecar && text.startsWith(`INSERT INTO ${prefix}_sessions`)) { failSidecar = false; throw new Error("sidecar down"); }
      return run();
    });
    const a = createPostgresSessionStore(flaky, { prefix });
    const b = createPostgresSessionStore(db, { prefix }); // "another process" on the same schema
    const key = { projectKey: "p", sessionId: "s" };
    await expect(a.append(key, [{ type: "user", uuid: "u1", message: { role: "user", content: "hello" } }])).rejects.toThrow("sidecar down");
    expect((await a.load(key))!.length).toBe(1); // the transcript row landed; only the sidecar write failed
    await b.append(key, [{ type: "user", uuid: "u2", message: { role: "user", content: "later" } }]);
    const sums = await b.listSessionSummaries!("p");
    expect(sums.length).toBe(1);
    expect(sums[0].data.firstPrompt).toBe("hello"); // b's fold recovered a's stranded row, in id order
  });

  it("a fold landing after a delete cannot resurrect a ghost session", async () => {
    const prefix = `t${n++}`;
    await ensurePostgresSessionStoreSchema(db, { prefix });
    const plain = createPostgresSessionStore(db, { prefix });
    const key = { projectKey: "p", sessionId: "s" };
    let race = true;
    const racing = wrap(async (text, _params, run) => {
      if (race && text.startsWith(`SELECT seq`)) {
        race = false; // the whole (atomic) delete lands between this append's insert and its fold
        await plain.delete!(key);
      }
      return run();
    });
    const store = createPostgresSessionStore(racing, { prefix });
    await store.append(key, [{ type: "user", uuid: "u1", message: { role: "user", content: "gone" } }]);
    // The delete removed the freshly-inserted row and the (not-yet-created) sidecar; the fold's
    // empty-and-absent guard must then do nothing rather than materialize a ghost.
    expect(await plain.load(key)).toBeNull();
    expect(await plain.listSessionSummaries!("p")).toEqual([]);
    expect(await plain.listSessions!("p")).toEqual([]);
  });

  it("a stale CAS from before a delete+recreate misses the new incarnation (seq generation token)", async () => {
    const prefix = `t${n++}`;
    await ensurePostgresSessionStoreSchema(db, { prefix });
    const plain = createPostgresSessionStore(db, { prefix });
    const key = { projectKey: "p", sessionId: "s" };
    await plain.append(key, [{ type: "user", uuid: "u1", message: { role: "user", content: "old world" } }]);
    let race = true;
    const racing = wrap(async (text, _params, run) => {
      if (race && text.startsWith(`UPDATE ${prefix}_sessions`)) {
        race = false; // between this append's sidecar read and its CAS write: delete + recreate
        await plain.delete!(key);
        await plain.append(key, [{ type: "user", uuid: "u3", message: { role: "user", content: "new world" } }]);
      }
      return run();
    });
    const store = createPostgresSessionStore(racing, { prefix });
    await store.append(key, [{ type: "user", uuid: "u2", message: { role: "user", content: "stale" } }]);
    // The stale UPDATE (holding the old generation's seq) must MISS the recreated row; the retry
    // re-reads and folds the post-recreation transcript.
    const sums = await plain.listSessionSummaries!("p");
    expect(sums.length).toBe(1);
    expect(sums[0].data.firstPrompt).toBe("new world");
    expect((await plain.load(key))!.map((e) => e.uuid)).toEqual(["u3"]);
  });

  it("payloads with NUL escapes and lone surrogates round-trip (TEXT storage, not jsonb)", async () => {
    const { store } = await makeStoreWith();
    const key = { projectKey: "p", sessionId: "s" };
    const nasty = { type: "user", uuid: "u1", message: { role: "user", content: "a" + String.fromCharCode(0) + "b " + String.fromCharCode(0xd800) + " c" } };
    await store.append(key, [nasty as any]);
    expect((await store.load(key))![0]).toEqual(nasty);
    expect((await store.listSessionSummaries!("p")).length).toBe(1); // summary write survived too
  });

  it("ensurePostgresSessionStoreSchema is idempotent", async () => {
    const prefix = `t${n++}`;
    await ensurePostgresSessionStoreSchema(db, { prefix });
    await ensurePostgresSessionStoreSchema(db, { prefix }); // second run must not throw
    const store = createPostgresSessionStore(db, { prefix });
    await store.append({ projectKey: "p", sessionId: "s" }, [{ type: "user", uuid: "u1" }]);
    expect((await store.load({ projectKey: "p", sessionId: "s" }))!.length).toBe(1);
  });

  it("the sidecar CAS retries past a competing writer and converges", async () => {
    const prefix = `t${n++}`;
    await ensurePostgresSessionStoreSchema(db, { prefix });
    let competeOnce = true;
    const racing = wrap(async (text, params, run) => {
      if (competeOnce && text.startsWith(`UPDATE ${prefix}_sessions`)) {
        competeOnce = false; // a "different process" bumps seq between our read and our CAS write
        await db.query(`UPDATE ${prefix}_sessions SET seq = seq + 1 WHERE project_key=$1 AND session_id=$2`, [(params as unknown[])[0], (params as unknown[])[1]]);
      }
      return run();
    });
    const store = createPostgresSessionStore(racing, { prefix });
    const key = { projectKey: "p", sessionId: "s" };
    await store.append(key, [{ type: "user", uuid: "u1", message: { role: "user", content: "first" } }]);
    await store.append(key, [{ type: "user", uuid: "u2" }]); // this one hits the injected race
    const sums = await store.listSessionSummaries!("p");
    expect(sums.length).toBe(1);
    expect(sums[0].data.firstPrompt).toBe("first"); // fold history survived the race
  });

  it("cas exhaustion surfaces as an error instead of silently dropping the fold", async () => {
    const prefix = `t${n++}`;
    await ensurePostgresSessionStoreSchema(db, { prefix });
    const hostile = wrap(async (text, params, run) => {
      if (text.startsWith(`UPDATE ${prefix}_sessions`)) {
        await db.query(`UPDATE ${prefix}_sessions SET seq = seq + 1 WHERE project_key=$1 AND session_id=$2`, [(params as unknown[])[0], (params as unknown[])[1]]);
      }
      return run();
    });
    const store = createPostgresSessionStore(hostile, { prefix });
    const key = { projectKey: "p", sessionId: "s" };
    await store.append(key, [{ type: "user", uuid: "u1" }]); // INSERT arm: no UPDATE issued, lands fine
    await expect(store.append(key, [{ type: "user", uuid: "u2" }])).rejects.toThrow(/CAS/);
  });
});

describe("PostgresSessionStore: append is not atomic, so a retried batch must not duplicate", () => {
  it("a fold that throws AFTER the insert committed does not re-insert the batch's uuid-less entries", async () => {
    const prefix = `t${n++}`;
    await ensurePostgresSessionStoreSchema(db, { prefix });
    let failFold = true;
    const flaky = wrap(async (text, _params, run) => {
      // The first sidecar read is the fold's opening query — fail it, so the INSERT above it has already
      // committed by the time append() rejects. This is the shape of any transient fold failure (a pg
      // blip, or CAS exhaustion after 5 attempts).
      if (failFold && text.includes(`FROM ${prefix}_sessions`)) { failFold = false; throw new Error("sidecar down"); }
      return run();
    });
    const store = createPostgresSessionStore(flaky, { prefix });
    const key = { projectKey: "p", sessionId: "s" };
    // A realistic mixed batch: the user row carries a uuid (the partial unique index dedups it), the title
    // marker does NOT (nothing dedups it — that is the whole hazard).
    const batch = [
      { type: "summary", summary: "a title" },
      { type: "user", uuid: "u1", message: { role: "user", content: "hi" } },
    ] as any[];
    await expect(store.append(key, batch)).rejects.toThrow("sidecar down");
    await store.append(key, batch);                      // the SDK retries the WHOLE batch (sdk.d.ts SessionStore)
    const rows = (await store.load(key))!;
    expect(rows.length).toBe(2);                          // NOT 3 — the uuid-less title landed exactly once
    expect(rows.filter((r: any) => r.type === "summary").length).toBe(1);
  });

  it("a genuinely repeated uuid-less entry still appends twice — only a retry of the SAME batch is skipped", async () => {
    const { store } = await makeStoreWith();
    const key = { projectKey: "p", sessionId: "s" };
    await store.append(key, [{ type: "summary", summary: "one" } as any]);
    await store.append(key, [{ type: "summary", summary: "one" } as any]);   // the app really did it twice
    expect((await store.load(key))!.length).toBe(2);
  });
});

describe("PostgresSessionStore: the fold is incremental, and falls back when it cannot prove it is safe", () => {
  it("a steady-state append folds from the cached summary, and a concurrent row forces the full re-fold back", async () => {
    const prefix = `t${n++}`;
    await ensurePostgresSessionStoreSchema(db, { prefix });
    let fullReads = 0;
    let smuggle = false;
    const watched = wrap(async (text, _params, run) => {
      // The fold's full read is the one filtering `subpath = ''` (load() parameterizes subpath instead).
      if (text.includes(`FROM ${prefix}_entries`) && text.includes("subpath = ''") && text.includes("ORDER BY id")) fullReads++;
      if (smuggle && text.includes(`FROM ${prefix}_sessions`)) {
        smuggle = false;   // another writer commits a row between our INSERT and our fold
        await db.query(
          `INSERT INTO ${prefix}_entries (project_key, session_id, subpath, uuid, entry) VALUES ('p','s','',$1,$2)`,
          ["x9", JSON.stringify({ type: "user", uuid: "x9", message: { role: "user", content: "smuggled" } })],
        );
      }
      return run();
    });
    const store = createPostgresSessionStore(watched, { prefix });
    const key = { projectKey: "p", sessionId: "s" };

    await store.append(key, [{ type: "user", uuid: "u1", message: { role: "user", content: "first" } } as any]);
    expect(fullReads).toBe(1);                            // cold cache: nothing to continue from
    await store.append(key, [{ type: "user", uuid: "u2", message: { role: "user", content: "second" } } as any]);
    expect(fullReads).toBe(1);                            // the count moved by exactly our batch → incremental

    smuggle = true;
    await store.append(key, [{ type: "user", uuid: "u3", message: { role: "user", content: "third" } } as any]);
    expect(fullReads).toBe(2);                            // count off by the smuggled row → full re-fold

    // And the summary the incremental path produced is the one a from-scratch fold would have produced.
    const rows = (await store.load(key))!;
    const sums = await store.listSessionSummaries!("p");
    const fresh = foldSessionSummary(undefined, key, rows, { mtime: (sums[0] as any).mtime });
    expect(sums[0].data).toEqual(fresh.data);
  });
});

describe("PostgresSessionStore: table prefixes are case-folded by Postgres", () => {
  it("rejects an uppercase prefix instead of letting two tenants silently share one schema", () => {
    // Unquoted identifiers fold to lowercase, so "Acme" and "acme" would name the SAME tables while their
    // operators believed they were isolated.
    expect(() => postgresSessionStoreDDL("Acme")).toThrow(/lowercase/);
    expect(() => createPostgresSessionStore(db, { prefix: "Acme" })).toThrow(/lowercase/);
    expect(postgresSessionStoreDDL("acme")).toContain("acme_entries");
  });
});
