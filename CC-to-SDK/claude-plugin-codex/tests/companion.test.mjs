import test from "node:test"; import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path"; import { fileURLToPath } from "node:url";
import { initGitRepo, makeTempDir, run } from "./helpers.mjs";

process.env.CLAUDE_COMPANION_DATA = makeTempDir("ccd-companion-");

const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../app-server/dist/bin.js");
const ENV = { ...process.env, CC_APPSERVER_FAKE: "1", CLAUDE_COMPANION_APPSERVER: `node ${BIN}` };

const {
  createCompanion,
  ensureClient,
  normalizeModel,
  MODEL_ALIASES,
  VALID_EFFORTS,
  cancelHandler,
  formatAuthStatus,
  pollSingleJobUntilTerminal,
  pollStatusUntilIdle,
  runForegroundWait
} = await import("../plugins/claude/scripts/lib/companion.mjs");
const { listJobs, readJobFile, resolveJobFile, upsertJob, getConfig } = await import(
  "../plugins/claude/scripts/lib/state.mjs"
);
const { buildStatusSnapshot } = await import("../plugins/claude/scripts/lib/job-control.mjs");
const { spawnAppServer } = await import("../plugins/claude/scripts/lib/appserver-client.mjs");
const { createJobRecord } = await import("../plugins/claude/scripts/lib/tracked-jobs.mjs");

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

// Fresh repo, one commit, then a dirty (uncommitted) tweak — resolveReviewTarget resolves this
// to working-tree mode.
function makeDirtyRepo(prefix) {
  const cwd = makeTempDir(prefix);
  initGitRepo(cwd);
  fs.writeFileSync(path.join(cwd, "app.js"), "console.log('v1');\n");
  run("git", ["add", "app.js"], { cwd });
  run("git", ["commit", "-m", "init"], { cwd });
  fs.writeFileSync(path.join(cwd, "app.js"), "console.log('v2');\n");
  return cwd;
}

async function waitForJobWithThreadId(cwd, timeoutMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const job = listJobs(cwd).find(
      (candidate) => candidate.threadId && (candidate.status === "running" || candidate.status === "queued")
    );
    if (job) return job.id;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("timeout waiting for a running job with a recorded threadId");
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

// Live-testing feedback: logFile was never actually wired up (createJobLogFile existed but no
// caller invoked it), so every job showed logFile: null and status never had anything to point
// at while debugging a stuck job.
test("rescue wait:true persists a real, populated logFile (not null)", async () => {
  const tmpRepo = makeTempDir("companion-logfile-");
  const c = createCompanion({ cwd: tmpRepo, env: ENV });
  await callTool(c, "rescue", { prompt: "do it", wait: true, fresh: true });

  const job = listJobs(tmpRepo).find((j) => j.jobClass === "task");
  assert.ok(job.logFile, "job.logFile must be set");
  assert.ok(fs.existsSync(job.logFile));
  const contents = fs.readFileSync(job.logFile, "utf8");
  assert.match(contents, /Starting Claude rescue task\./);
  assert.match(contents, /Final output/);
  await c.dispose();
});

// Live-testing feedback: phase never advanced past "starting" for the whole life of a job, so a
// stuck job gave no clue whether it was still spawning the worker, starting the thread, or
// waiting on the model.
test("rescue phase advances through starting-thread -> running-turn while a job is in flight", async () => {
  const tmpRepo = makeTempDir("companion-phase-");
  const c = createCompanion({ cwd: tmpRepo, env: ENV });
  await callTool(c, "rescue", { prompt: "please HANG", fresh: true });

  const start = Date.now();
  let job;
  while (Date.now() - start < 3000) {
    job = listJobs(tmpRepo).find((j) => j.jobClass === "task");
    if (job?.phase === "running-turn") break;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.equal(job.phase, "running-turn");
  assert.equal(job.status, "running");
  assert.ok(job.threadId);

  await callTool(c, "cancel", {});
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
  // Live-testing feedback: the in-tool guidance only mentioned the npm-global-install path, not a
  // concrete example for pointing CLAUDE_COMPANION_APPSERVER at an already-built copy — leaving a
  // user with neither npm nor a global install stuck, even though that override was always meant
  // to work (see README's own worked example).
  assert.match(text, /CLAUDE_COMPANION_APPSERVER="node \/path\/to\/app-server\/dist\/bin\.js"/);
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

// Task 13: review + adversarial_review. The fake worker always returns the plain string "final
// text" (see app-server/src/_fake.ts), never JSON — so end-to-end these always exercise the
// raw-fallback branch of renderReviewResult, not the schema-valid branch (that's unit-tested
// directly against render.mjs). This is the expected, documented behavior for this appserver: it
// doesn't yet surface the SDK's structured_output field.
test("review {wait:true} on a dirty temp repo returns rendered output and persists a review- job (raw-fallback path)", async () => {
  const tmpRepo = makeDirtyRepo("companion-review-");
  const c = createCompanion({ cwd: tmpRepo, env: ENV });

  const text = await callTool(c, "review", { wait: true });
  assert.match(text, /^# Claude Review/);
  assert.match(text, /Claude did not return valid structured JSON\./);
  assert.match(text, /final text/);

  const jobs = listJobs(tmpRepo);
  assert.equal(jobs.length, 1);
  assert.ok(jobs[0].id.startsWith("review-"), `expected review- prefix, got ${jobs[0].id}`);
  assert.equal(jobs[0].status, "completed");
  assert.equal(jobs[0].jobClass, "review");
  await c.dispose();
});

test("review defaults to background (like rescue) and status sees it complete", async () => {
  const tmpRepo = makeDirtyRepo("companion-review-bg-");
  const c = createCompanion({ cwd: tmpRepo, env: ENV });

  const text = await callTool(c, "review", {});
  assert.match(text, /background job/);
  const done = await waitForCompleted(tmpRepo);
  assert.equal(done.status, "completed");
  assert.ok(done.id.startsWith("review-"));
  await c.dispose();
});

// The fake worker always returns the unparseable string "final text" (never JSON), so this always
// hits renderReviewResult's raw-fallback branch — which (matching the blueprint verbatim) omits
// the "Target:" line entirely; that line only appears in the validation-error/success branches.
// So the branch-mode target actually reaching collectReviewContext/runReviewTurn is asserted
// against the persisted job payload instead of the rendered text.
test("review honors an explicit base ref (branch-mode target reaches collectReviewContext)", async () => {
  const tmpRepo = makeTempDir("companion-review-branch-");
  initGitRepo(tmpRepo);
  fs.writeFileSync(path.join(tmpRepo, "app.js"), "console.log('v1');\n");
  run("git", ["add", "app.js"], { cwd: tmpRepo });
  run("git", ["commit", "-m", "init"], { cwd: tmpRepo });
  run("git", ["checkout", "-b", "feature/test"], { cwd: tmpRepo });
  fs.writeFileSync(path.join(tmpRepo, "app.js"), "console.log('v2');\n");
  run("git", ["add", "app.js"], { cwd: tmpRepo });
  run("git", ["commit", "-m", "change"], { cwd: tmpRepo });

  const c = createCompanion({ cwd: tmpRepo, env: ENV });
  const text = await callTool(c, "review", { wait: true, base: "main" });
  assert.match(text, /^# Claude Review/);

  const jobs = listJobs(tmpRepo);
  assert.equal(jobs.length, 1);
  const stored = readJobFile(resolveJobFile(tmpRepo, jobs[0].id));
  assert.equal(stored.result.target.mode, "branch");
  assert.equal(stored.result.target.baseRef, "main");
  await c.dispose();
});

test("adversarial_review {wait:true, focus} on a dirty temp repo persists an advrev- job (raw-fallback path)", async () => {
  const tmpRepo = makeDirtyRepo("companion-advrev-");
  const c = createCompanion({ cwd: tmpRepo, env: ENV });

  const text = await callTool(c, "adversarial_review", { wait: true, focus: "auth bypass" });
  assert.match(text, /^# Claude Adversarial Review/);
  assert.match(text, /Claude did not return valid structured JSON\./);

  const jobs = listJobs(tmpRepo);
  assert.equal(jobs.length, 1);
  assert.ok(jobs[0].id.startsWith("advrev-"), `expected advrev- prefix, got ${jobs[0].id}`);
  assert.equal(jobs[0].kind, "adversarial-review");
  assert.equal(jobs[0].jobClass, "review");
  await c.dispose();
});

test("review on a non-git cwd surfaces the git error instead of crashing", async () => {
  const tmpRepo = makeTempDir("companion-review-nogit-");
  const c = createCompanion({ cwd: tmpRepo, env: ENV });
  await assert.rejects(() => callTool(c, "review", { wait: true }), /Git repository/);
  await c.dispose();
});

test("review: worker missing -> setup guidance (shares rescue's error-handling path)", async () => {
  const tmpRepo = makeDirtyRepo("companion-review-missing-");
  const c = createCompanion({ cwd: tmpRepo, env: { PATH: "/none", CLAUDE_COMPANION_DATA: process.env.CLAUDE_COMPANION_DATA } });
  const text = await callTool(c, "review", { wait: true });
  assert.match(text, /not available/);
  await c.dispose();
});

// Task 14: status / result / cancel / full setup.

test("status {} lists a completed job in the markdown report", async () => {
  const tmpRepo = makeTempDir("companion-status-table-");
  const c = createCompanion({ cwd: tmpRepo, env: ENV });
  await callTool(c, "rescue", { prompt: "do it", wait: true, fresh: true });

  const text = await callTool(c, "status", {});
  assert.match(text, /^# Claude Status/);
  assert.match(text, /Latest finished:/);
  assert.match(text, /rescue/);
  await c.dispose();
});

test("status {job_id} renders a single-job view", async () => {
  const tmpRepo = makeTempDir("companion-status-single-");
  const c = createCompanion({ cwd: tmpRepo, env: ENV });
  await callTool(c, "rescue", { prompt: "do it", wait: true, fresh: true });
  const jobId = listJobs(tmpRepo)[0].id;

  const text = await callTool(c, "status", { job_id: jobId });
  assert.match(text, new RegExp(jobId));
  assert.match(text, /completed/);
  await c.dispose();
});

test("status {wait:true} returns once the background job leaves running, instead of blocking on the full 240s budget", async () => {
  const tmpRepo = makeTempDir("companion-status-wait-");
  const c = createCompanion({ cwd: tmpRepo, env: ENV });
  await callTool(c, "rescue", { prompt: "do it in the background", fresh: true });

  const start = Date.now();
  const text = await callTool(c, "status", { wait: true });
  const elapsed = Date.now() - start;

  assert.match(text, /completed|Latest finished:/);
  assert.ok(elapsed < 10000, `status {wait:true} took too long to return: ${elapsed}ms`);
  await c.dispose();
});

// Review point: the wait-poll loop must give up after its timeout rather than hang forever when a
// job never leaves queued/running. Exercised directly against the exported poll helper with a tiny
// override so the test doesn't have to wait out the real 240s production budget.
test("status wait-poll terminates (does not hang) for a job that never leaves running, respecting the timeout (review point)", async () => {
  const tmpRepo = makeTempDir("companion-status-wait-hang-");
  upsertJob(tmpRepo, { id: "task-neverending", status: "running", pid: process.pid });

  const start = Date.now();
  const snap = await pollSingleJobUntilTerminal(tmpRepo, "task-neverending", { intervalMs: 20, timeoutMs: 80 });
  const elapsed = Date.now() - start;

  assert.equal(snap.job.status, "running", "poll must give up, not fabricate a terminal status");
  assert.ok(elapsed < 1000, `poll loop did not terminate promptly: ${elapsed}ms`);
});

test("status {wait:true} (no job_id) aggregate poll also terminates against its timeout (review point)", async () => {
  const tmpRepo = makeTempDir("companion-status-wait-agg-hang-");
  upsertJob(tmpRepo, { id: "task-neverending-2", status: "running", pid: process.pid });

  const start = Date.now();
  const report = await pollStatusUntilIdle(tmpRepo, { intervalMs: 20, timeoutMs: 80 });
  const elapsed = Date.now() - start;

  assert.equal(report.running.length, 1);
  assert.ok(elapsed < 1000, `aggregate poll loop did not terminate promptly: ${elapsed}ms`);
});

test("result: returns stored output plus the rescue-tool resume affordance", async () => {
  const tmpRepo = makeTempDir("companion-result-");
  const c = createCompanion({ cwd: tmpRepo, env: ENV });
  await callTool(c, "rescue", { prompt: "do it", wait: true, fresh: true });
  const jobId = listJobs(tmpRepo)[0].id;

  const text = await callTool(c, "result", { job_id: jobId });
  assert.match(text, /final text/);
  assert.match(text, /Continue via the rescue tool with resume:true/);
  await c.dispose();
});

test("result: defaults to the latest finished job when job_id is omitted", async () => {
  const tmpRepo = makeTempDir("companion-result-latest-");
  const c = createCompanion({ cwd: tmpRepo, env: ENV });
  await callTool(c, "rescue", { prompt: "do it", wait: true, fresh: true });

  const text = await callTool(c, "result", {});
  assert.match(text, /final text/);
  await c.dispose();
});

test("result: an active (still-running) job reports a not-ready error instead of crashing", async () => {
  const tmpRepo = makeTempDir("companion-result-active-");
  const c = createCompanion({ cwd: tmpRepo, env: ENV });
  await callTool(c, "rescue", { prompt: "please HANG", fresh: true });
  const jobId = await waitForJobWithThreadId(tmpRepo);

  await assert.rejects(() => callTool(c, "result", { job_id: jobId }), /still (queued|running)/);
  await callTool(c, "cancel", { job_id: jobId });
  await c.dispose();
});

test("cancel: active HANG job -> interrupt call settles the job cancelled (not failed), and it sticks", async () => {
  const tmpRepo = makeTempDir("companion-cancel-hang-");
  const c = createCompanion({ cwd: tmpRepo, env: ENV });
  const startText = await callTool(c, "rescue", { prompt: "please HANG", fresh: true });
  assert.match(startText, /background job/);

  const jobId = await waitForJobWithThreadId(tmpRepo);

  const cancelText = await callTool(c, "cancel", { job_id: jobId });
  assert.match(cancelText, /Cancelled/);

  const stored = listJobs(tmpRepo).find((job) => job.id === jobId);
  assert.equal(stored.status, "cancelled");

  // Guard against the turn's own natural "failed" completion write clobbering the cancellation
  // after the fact (the review-flagged race).
  await new Promise((r) => setTimeout(r, 300));
  const storedAfter = listJobs(tmpRepo).find((job) => job.id === jobId);
  assert.equal(storedAfter.status, "cancelled", "status must not be clobbered back to failed after settling");

  await c.dispose();
});

test("cancel: a queued (not-yet-started) job is removed from the background queue, not resurrected", async () => {
  const tmpRepo = makeTempDir("companion-cancel-queued-");
  const c = createCompanion({ cwd: tmpRepo, env: ENV });

  // Push 5 jobs at once (cap is 3 concurrent) so at least one lands in companion.queue.
  const starts = [0, 1, 2, 3, 4].map((i) => callTool(c, "rescue", { prompt: `job ${i}`, fresh: true }));
  await Promise.all(starts);

  const queued = listJobs(tmpRepo).find((job) => job.status === "queued");
  assert.ok(queued, "expected at least one queued job under the concurrency cap");

  const cancelText = await callTool(c, "cancel", { job_id: queued.id });
  assert.match(cancelText, /Cancelled/);

  const jobs = await waitForAllTerminal(tmpRepo, 4);
  const cancelledJob = jobs.find((job) => job.id === queued.id);
  assert.equal(cancelledJob.status, "cancelled", "a cancelled queued job must never be resurrected as completed");

  await c.dispose();
});

// Review point: on interrupt RPC failure, cancel must fall back to client.close() (respawn happens
// lazily on the next ensureClient call) and still mark the job cancelled. Hand-built companion +
// stub client (same pattern as the ensureClient single-flight test) isolates this branch precisely,
// without needing to force a real RPC failure through the fake appserver.
test("cancel: interrupt RPC failure falls back to client.close(), still marks the job cancelled (review point)", async () => {
  const cwd = makeTempDir("companion-cancel-fallback-");
  upsertJob(cwd, { id: "task-fallback", status: "running", pid: process.pid, threadId: "thr_x", jobClass: "task", kind: "task" });

  let closeCalled = false;
  const fakeClient = {
    alive: () => true,
    interrupt: async () => { throw new Error("interrupt rpc failed"); },
    close: async () => { closeCalled = true; }
  };
  const companion = { cwd, env: ENV, client: fakeClient, spawning: null, queue: [], activeRuns: new Map() };

  const text = await cancelHandler(companion, {});
  assert.match(text, /Cancelled/);
  assert.equal(closeCalled, true, "interrupt failure must fall back to client.close()");
  assert.equal(companion.client, null, "client reference must be cleared so ensureClient respawns lazily");

  const stored = listJobs(cwd).find((job) => job.id === "task-fallback");
  assert.equal(stored.status, "cancelled");
});

test("cancel: a dead (non-alive) client is treated like an interrupt failure, not awaited into a hang", async () => {
  const cwd = makeTempDir("companion-cancel-dead-client-");
  upsertJob(cwd, { id: "task-dead-client", status: "running", pid: process.pid, threadId: "thr_y", jobClass: "task", kind: "task" });

  let closeCalled = false;
  const fakeClient = {
    alive: () => false,
    interrupt: async () => { throw new Error("must not be called on a dead client"); },
    close: async () => { closeCalled = true; }
  };
  const companion = { cwd, env: ENV, client: fakeClient, spawning: null, queue: [], activeRuns: new Map() };

  const text = await cancelHandler(companion, { job_id: "task-dead-client" });
  assert.match(text, /Cancelled/);
  assert.equal(closeCalled, true);
  const stored = listJobs(cwd).find((job) => job.id === "task-dead-client");
  assert.equal(stored.status, "cancelled");
});

// Review finding: resolveCancelableJob's snapshot predates runRescueTurn's mid-flight
// upsertJob({threadId}) write when cancel lands in the narrow window between a background job
// starting and threadStart resolving — the old code skipped the interrupt/close branch entirely
// (no threadId to target yet) and then hung awaiting the same settle promise a HANG-style turn
// (one that only ever resolves via interrupt()) would never produce on its own. A stub client with
// a deliberately delayed threadStart plus a runTurn that only settles via interrupt() reproduces
// that race through the real rescue/cancel pipeline (createCompanion's spawnAppServer override is
// the seam — no hand-built companion needed here), firing a job-id-less cancel {} immediately
// after rescue starts, landing inside the window.
test("cancel: fired inside the pre-threadId race window still returns promptly and marks cancelled (review finding)", async () => {
  const tmpRepo = makeTempDir("companion-cancel-race-");
  let interruptCalled = false;
  let pendingReject = null;

  const stubClient = {
    alive: () => true,
    threadStart: async () => {
      await new Promise((r) => setTimeout(r, 300)); // delays the mid-flight upsertJob({threadId})
      return { threadId: "thr_race" };
    },
    runTurn: () => new Promise((_resolve, reject) => { pendingReject = reject; }), // only settles via interrupt()
    interrupt: async ({ threadId }) => {
      interruptCalled = true;
      assert.equal(threadId, "thr_race");
      pendingReject?.(new Error("interrupted"));
    },
    close: async () => {}
  };

  const c = createCompanion({ cwd: tmpRepo, env: ENV, spawnAppServer: async () => stubClient });
  const startText = await callTool(c, "rescue", { prompt: "please HANG", fresh: true });
  assert.match(startText, /background job/);

  const start = Date.now();
  const cancelText = await callTool(c, "cancel", {}); // no job_id: back-to-back with rescue, inside the window
  const elapsed = Date.now() - start;

  assert.match(cancelText, /Cancelled/);
  assert.ok(elapsed < 3000, `cancel took too long to return: ${elapsed}ms`);
  assert.equal(interruptCalled, true, "the brief retry window must catch the threadId landing and attempt the interrupt");

  const stored = listJobs(tmpRepo).find((job) => job.jobClass === "task");
  assert.equal(stored.status, "cancelled");

  await c.dispose();
});

test("setup: worker found + handshake ok + oauth-token auth (fake appserver)", async () => {
  const tmpRepo = makeTempDir("companion-setup-ok-");
  const c = createCompanion({ cwd: tmpRepo, env: ENV });

  const text = await callTool(c, "setup", {});
  assert.match(text, /Worker: found/);
  assert.match(text, /Handshake: ok/);
  assert.match(text, /Claude subscription \(OAuth\)/);
  assert.match(text, /Review gate: disabled/);
  await c.dispose();
});

test("setup: worker not found -> install guidance, no handshake/auth attempted", async () => {
  const tmpRepo = makeTempDir("companion-setup-missing-");
  const c = createCompanion({ cwd: tmpRepo, env: { PATH: "/none", CLAUDE_COMPANION_DATA: process.env.CLAUDE_COMPANION_DATA } });

  const text = await callTool(c, "setup", {});
  assert.match(text, /Worker: not found/);
  assert.match(text, /not available/);
  assert.doesNotMatch(text, /Handshake:/);
  await c.dispose();
});

test("setup: review gate toggle round-trips within the same tool call's response", async () => {
  const tmpRepo = makeTempDir("companion-setup-gate-");
  const c = createCompanion({ cwd: tmpRepo, env: ENV });

  const enabledText = await callTool(c, "setup", { enable_review_gate: true });
  assert.match(enabledText, /Review gate: enabled/);
  assert.equal(getConfig(tmpRepo).stopReviewGate, true);

  const disabledText = await callTool(c, "setup", { disable_review_gate: true });
  assert.match(disabledText, /Review gate: disabled/);
  assert.equal(getConfig(tmpRepo).stopReviewGate, false);

  await c.dispose();
});

// Live-testing feedback: a foreground `wait:true` call had no internal bound at all — it relied
// entirely on Codex's own host-side MCP tool_timeout_sec to eventually kill it, silently, with no
// diagnostic left behind (the job just sat at "starting" forever, then later got reconciled as
// "interrupted" with nothing explaining why). runForegroundWait gives the plugin its own, shorter,
// diagnosable bail-out that fires well before that host-level cutoff.
test("runForegroundWait times out and lets the runner keep going in the background", async () => {
  const cwd = makeTempDir("companion-foreground-wait-");
  const job = createJobRecord({ id: "task-fgwait", workspaceRoot: cwd });
  let resolveRunner;
  const runner = () =>
    new Promise((resolve) => {
      resolveRunner = () => resolve({ exitStatus: 0, payload: null, rendered: "done late", summary: "done late" });
    });

  const result = await runForegroundWait(cwd, job, runner, { timeoutMs: 30 });
  assert.equal(result.timedOut, true);
  assert.equal(result.execution, null);

  // The timeout-branch note is a mid-flight patch (like the existing threadId/phase patches),
  // so — matching that established convention — it lands in the aggregate state, not the
  // per-job file (which only the terminal writeJobFile calls in runTrackedJob update).
  const afterTimeout = listJobs(cwd).find((j) => j.id === "task-fgwait");
  assert.equal(afterTimeout.status, "running", "the runner must not be cancelled by the timeout");
  assert.match(afterTimeout.note, /foreground wait exceeded/);

  // Let the runner actually finish — its own completion write must still land normally afterward.
  resolveRunner();
  await new Promise((r) => setTimeout(r, 50));
  const afterCompletion = readJobFile(resolveJobFile(cwd, "task-fgwait"));
  assert.equal(afterCompletion.status, "completed");
});

test("runForegroundWait returns the execution directly when the runner finishes in time", async () => {
  const cwd = makeTempDir("companion-foreground-wait-fast-");
  const job = createJobRecord({ id: "task-fgwait-fast", workspaceRoot: cwd });
  const runner = async () => ({ exitStatus: 0, payload: null, rendered: "quick", summary: "quick" });

  const result = await runForegroundWait(cwd, job, runner, { timeoutMs: 5000 });
  assert.equal(result.timedOut, false);
  assert.equal(result.execution.rendered, "quick");
});

test("formatAuthStatus maps accountRead()'s method/authenticated states to the right guidance text", () => {
  assert.match(formatAuthStatus({ authenticated: true, method: "oauth-token" }), /OAuth/);
  assert.match(formatAuthStatus({ authenticated: true, method: "api-key" }), /shadows OAuth/);
  assert.match(formatAuthStatus({ authenticated: true, method: "cli-login" }), /CLI stored login/);
  assert.match(formatAuthStatus({ authenticated: false }), /setup-token|CLAUDE_CODE_OAUTH_TOKEN/);
});
