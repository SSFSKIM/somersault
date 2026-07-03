import test from "node:test"; import assert from "node:assert/strict";
import path from "node:path"; import { fileURLToPath } from "node:url";
import { makeTempDir } from "./helpers.mjs";

process.env.CLAUDE_COMPANION_DATA = makeTempDir("ccd-companion-");

const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../app-server/dist/bin.js");
const ENV = { ...process.env, CC_APPSERVER_FAKE: "1", CLAUDE_COMPANION_APPSERVER: `node ${BIN}` };

const { createCompanion, ensureClient, normalizeModel, MODEL_ALIASES, VALID_EFFORTS } = await import(
  "../plugins/claude/scripts/lib/companion.mjs"
);
const { listJobs } = await import("../plugins/claude/scripts/lib/state.mjs");
const { buildStatusSnapshot } = await import("../plugins/claude/scripts/lib/job-control.mjs");
const { spawnAppServer } = await import("../plugins/claude/scripts/lib/appserver-client.mjs");

function callTool(companion, name, args) {
  const tool = companion.tools.find((t) => t.name === name);
  assert.ok(tool, `no such tool: ${name}`);
  return tool.handler(args);
}

async function waitForCompleted(cwd, timeoutMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const done = listJobs(cwd).find((job) => job.status === "completed");
    if (done) return done;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("timeout waiting for background job to complete");
}

async function waitForAllTerminal(cwd, count, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const jobs = listJobs(cwd).filter((job) => job.status === "completed" || job.status === "failed");
    if (jobs.length >= count) return listJobs(cwd);
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("timeout waiting for background jobs to complete");
}

test("normalizeModel: aliases, passthrough, rejection", () => {
  assert.equal(MODEL_ALIASES.opus, "claude-opus-4-8");
  assert.deepEqual(VALID_EFFORTS, ["low", "medium", "high", "xhigh", "max"]);
  assert.equal(normalizeModel("opus"), "claude-opus-4-8");
  assert.equal(normalizeModel("claude-sonnet-5"), "claude-sonnet-5");
  assert.throws(() => normalizeModel("gpt-5"), /opus\|sonnet\|haiku\|fable/);
});

test("rescue wait:true returns fake final text and persists completed job", async () => {
  const tmpRepo = makeTempDir("companion-wait-");
  const c = createCompanion({ cwd: tmpRepo, env: ENV });
  const text = await callTool(c, "rescue", { prompt: "do it", wait: true, fresh: true });
  assert.match(text, /final text/);
  const snap = buildStatusSnapshot(tmpRepo);
  assert.equal(snap.latestFinished.status, "completed");
  await c.dispose();
});

test("rescue default backgrounds and status sees it complete", async () => {
  const tmpRepo = makeTempDir("companion-bg-");
  const c = createCompanion({ cwd: tmpRepo, env: ENV });
  const text = await callTool(c, "rescue", { prompt: "do it in the background" });
  assert.match(text, /background job/);
  const done = await waitForCompleted(tmpRepo);
  assert.equal(done.status, "completed");
  await c.dispose();
});

test("rescue offers resume when a candidate exists and neither flag given", async () => {
  const tmpRepo = makeTempDir("companion-resume-");
  const c = createCompanion({ cwd: tmpRepo, env: ENV });
  await callTool(c, "rescue", { prompt: "first pass", wait: true });
  const jobsAfterFirst = listJobs(tmpRepo);
  assert.equal(jobsAfterFirst.length, 1);

  const offer = await callTool(c, "rescue", { prompt: "second pass" });
  assert.match(offer, /resume:true/);
  assert.equal(listJobs(tmpRepo).length, 1, "the offer path must not create a new job");
  await c.dispose();
});

test("worker missing -> setup guidance", async () => {
  const tmpRepo = makeTempDir("companion-missing-");
  const c = createCompanion({ cwd: tmpRepo, env: { PATH: "/none", CLAUDE_COMPANION_DATA: process.env.CLAUDE_COMPANION_DATA } });
  const text = await callTool(c, "rescue", { prompt: "x", wait: true });
  assert.match(text, /not available/);
  await c.dispose();
});

// Review finding: ensureClient had no in-flight guard, so two callers that both saw
// companion.client === null before either await resolved would each independently
// spawnAppServer(), orphaning whichever child lost the race. Fire two calls with no await
// between them (companion object hand-built, matching ensureClient's actual shape) and assert
// only one real spawn happened and both callers got back the identical client.
test("ensureClient: concurrent callers single-flight onto one spawn, no orphaned process (review finding)", async () => {
  const tmpRepo = makeTempDir("companion-singleflight-");
  let spawnCount = 0;
  const spy = async (opts) => {
    spawnCount += 1;
    return spawnAppServer(opts);
  };
  const companion = { cwd: tmpRepo, env: ENV, client: null, spawning: null, spawnAppServer: spy };

  const [clientA, clientB] = await Promise.all([ensureClient(companion), ensureClient(companion)]);

  assert.equal(spawnCount, 1, "spawnAppServer must be called exactly once for concurrent callers");
  assert.equal(clientA, clientB, "concurrent callers must resolve to the identical client instance");
  await clientA.close();
});

// Review finding: startBackground stamps a "waiting for a free background slot" note on queued
// jobs via upsertJob, which merges rather than replaces. runTrackedJob's running/completed/failed
// patches never carry a `note` key, so the stale note used to survive forever once the job
// actually ran. Push past the cap-3 concurrency limit (5 jobs, fired with no await between calls
// so all 5 land before the shared appserver spawn resolves) so at least one is queued, let the
// queue drain naturally, and assert no finished job kept the leftover note.
test("drainQueue clears the stale queued 'note' before a job runs (review finding)", async () => {
  const tmpRepo = makeTempDir("companion-queue-note-");
  const c = createCompanion({ cwd: tmpRepo, env: ENV });

  const starts = [0, 1, 2, 3, 4].map((i) => callTool(c, "rescue", { prompt: `job ${i}`, fresh: true }));
  const started = await Promise.all(starts);
  for (const text of started) assert.match(text, /background job/);

  const jobs = await waitForAllTerminal(tmpRepo, 5);
  assert.equal(jobs.length, 5);
  for (const job of jobs) {
    assert.equal(job.status, "completed");
    assert.ok(
      !job.note || !job.note.includes("waiting for a free background slot"),
      `job ${job.id} leaked the stale queue note: ${job.note}`
    );
  }
  await c.dispose();
});
