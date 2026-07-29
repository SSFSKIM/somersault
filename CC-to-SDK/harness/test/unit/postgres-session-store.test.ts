// Postgres SessionStore adapter tests — run against PGlite (real Postgres engine, in-process WASM,
// keyless). One shared instance; each store gets a fresh table prefix, satisfying the conformance
// factory contract (empty storage per call). Mirrors test/unit/session-store.test.ts (Redis).
import { describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { createPostgresSessionStore, ensurePostgresSessionStoreSchema, postgresSessionStoreDDL } from "../../src/store/postgresSessionStore.js";
import type { PgLike } from "../../src/store/postgresSessionStore.js";
import { sessionStoreConformance } from "../../src/store/conformance.js";

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

  it("a delete racing an append settles consistent: no ghost sidecar, rows-without-summary heals on the next fold", async () => {
    const prefix = `t${n++}`;
    await ensurePostgresSessionStoreSchema(db, { prefix });
    const plain = createPostgresSessionStore(db, { prefix });
    const key = { projectKey: "p", sessionId: "s" };
    let race = true;
    const racing = wrap(async (text, _params, run) => {
      if (race && text.startsWith(`DELETE FROM ${prefix}_sessions`)) {
        race = false; // between the two DELETE statements, "another process" appends
        await plain.append(key, [{ type: "user", uuid: "u2", message: { role: "user", content: "resurrect?" } }]);
      }
      return run();
    });
    const deleter = createPostgresSessionStore(racing, { prefix });
    await plain.append(key, [{ type: "user", uuid: "u1", message: { role: "user", content: "original" } }]);
    await deleter.delete!(key);
    // The racing append's row survived (it landed after the entries DELETE); its sidecar write was
    // then removed by the delete — transcript rows without a summary, never a summary without rows.
    expect((await plain.load(key))!.map((e) => e.uuid)).toEqual(["u2"]);
    expect(await plain.listSessionSummaries!("p")).toEqual([]);
    await plain.append(key, [{ type: "user", uuid: "u3" }]); // next fold heals the sidecar from the table
    const sums = await plain.listSessionSummaries!("p");
    expect(sums.length).toBe(1);
    expect(sums[0].data.firstPrompt).toBe("resurrect?");
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
