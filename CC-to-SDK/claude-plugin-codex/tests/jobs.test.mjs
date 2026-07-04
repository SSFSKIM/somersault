import test from "node:test"; import assert from "node:assert/strict";
import { makeTempDir } from "./helpers.mjs";

process.env.CLAUDE_COMPANION_DATA = makeTempDir("ccd-jobs-");

const { resolveStateDir, resolveJobFile, readJobFile, loadState, upsertJob } = await import(
  "../plugins/claude-companion/scripts/lib/state.mjs"
);
const { createJobRecord, runTrackedJob, createJobProgressUpdater } = await import(
  "../plugins/claude-companion/scripts/lib/tracked-jobs.mjs"
);
const {
  reconcileJobLiveness,
  matchJobReference,
  buildStatusSnapshot,
  buildSingleJobSnapshot,
  resolveResultJob,
  resolveCancelableJob
} = await import("../plugins/claude-companion/scripts/lib/job-control.mjs");

test("createJobRecord stamps createdAt/pid/heartbeatAt and never a sessionId", () => {
  const job = createJobRecord({ id: "task-1", workspaceRoot: "/tmp/x" });
  assert.ok(job.createdAt);
  assert.equal(job.pid, process.pid);
  assert.ok(typeof job.heartbeatAt === "number");
  assert.equal("sessionId" in job, false);
});

test("runTrackedJob happy path persists completed status + result", async () => {
  const cwd = makeTempDir("workspace-run-ok-");
  const job = createJobRecord({ id: "task-ok", workspaceRoot: cwd });
  const execution = await runTrackedJob(job, async () => ({
    exitStatus: 0,
    payload: { rawOutput: "hi" },
    rendered: "hi",
    summary: "ok"
  }));
  assert.equal(execution.payload.rawOutput, "hi");

  const stored = readJobFile(resolveJobFile(cwd, "task-ok"));
  assert.equal(stored.status, "completed");
  assert.equal(stored.result.rawOutput, "hi");
  assert.equal(stored.pid, null);
});

test("runTrackedJob persists failed status when the runner throws", async () => {
  const cwd = makeTempDir("workspace-run-fail-");
  const job = createJobRecord({ id: "task-fail", workspaceRoot: cwd });
  await assert.rejects(() => runTrackedJob(job, async () => { throw new Error("boom"); }), /boom/);

  const stored = readJobFile(resolveJobFile(cwd, "task-fail"));
  assert.equal(stored.status, "failed");
  assert.equal(stored.errorMessage, "boom");
  assert.equal(stored.pid, null);
});

test("runTrackedJob persists failed status when the runner reports a non-zero exitStatus", async () => {
  const cwd = makeTempDir("workspace-run-nonzero-");
  const job = createJobRecord({ id: "task-nonzero", workspaceRoot: cwd });
  const execution = await runTrackedJob(job, async () => ({ exitStatus: 1, payload: null, rendered: "err" }));
  assert.equal(execution.exitStatus, 1);
  const stored = readJobFile(resolveJobFile(cwd, "task-nonzero"));
  assert.equal(stored.status, "failed");
});

test("createJobProgressUpdater refreshes heartbeatAt on every persisted write", () => {
  const cwd = makeTempDir("workspace-progress-");
  upsertJob(cwd, { id: "task-progress", status: "running", pid: process.pid, heartbeatAt: 1 });
  const update = createJobProgressUpdater(cwd, "task-progress");

  update({ phase: "investigating" });
  const afterFirst = loadState(cwd).jobs.find((job) => job.id === "task-progress");
  assert.equal(afterFirst.phase, "investigating");
  assert.ok(afterFirst.heartbeatAt > 1);

  const heartbeatAfterFirst = afterFirst.heartbeatAt;
  // no phase/thread/turn change -> no write, heartbeat untouched
  update({ phase: "investigating" });
  const afterNoop = loadState(cwd).jobs.find((job) => job.id === "task-progress");
  assert.equal(afterNoop.heartbeatAt, heartbeatAfterFirst);

  update({ phase: "verifying" });
  const afterSecond = loadState(cwd).jobs.find((job) => job.id === "task-progress");
  assert.equal(afterSecond.phase, "verifying");
  assert.ok(afterSecond.heartbeatAt >= heartbeatAfterFirst);
});

test("reconcileJobLiveness flips a running job with a dead pid to interrupted", () => {
  const job = { status: "running", pid: 4194303 };
  const reconciled = reconcileJobLiveness(job);
  assert.equal(reconciled.status, "interrupted");
  assert.ok(reconciled.interruptedAt);
});

test("reconcileJobLiveness stamps a diagnostic errorMessage on interrupted jobs", () => {
  const job = { status: "running", pid: 4194303 };
  const reconciled = reconcileJobLiveness(job);
  assert.match(reconciled.errorMessage, /no longer running but never reported completion/);
});

test("reconcileJobLiveness never overwrites an existing errorMessage", () => {
  const job = { status: "running", pid: 4194303, errorMessage: "custom prior error" };
  const reconciled = reconcileJobLiveness(job);
  assert.equal(reconciled.errorMessage, "custom prior error");
});

test("reconcileJobLiveness leaves a running job with the current (own) pid alone", () => {
  const job = { status: "running", pid: process.pid };
  const reconciled = reconcileJobLiveness(job);
  assert.equal(reconciled.status, "running");
  assert.equal(reconciled, job);
});

test("reconcileJobLiveness ignores jobs that are not running/queued", () => {
  const job = { status: "completed", pid: 4194303 };
  assert.equal(reconcileJobLiveness(job), job);
});

test("matchJobReference is exported and resolves by exact id / unique prefix", () => {
  const jobs = [{ id: "task-aaa" }, { id: "task-bbb" }];
  assert.equal(matchJobReference(jobs, "task-aaa").id, "task-aaa");
  assert.equal(matchJobReference(jobs, "task-b").id, "task-bbb");
  assert.throws(() => matchJobReference(jobs, "task-zzz"));
});

test("buildStatusSnapshot reconciles + persists a dead-pid running job as interrupted", () => {
  const cwd = makeTempDir("workspace-status-");
  upsertJob(cwd, { id: "task-dead", status: "running", pid: 4194303 });
  upsertJob(cwd, { id: "task-alive", status: "running", pid: process.pid });

  const snapshot = buildStatusSnapshot(cwd);
  assert.equal(snapshot.running.some((job) => job.id === "task-dead"), false);
  assert.equal(snapshot.running.some((job) => job.id === "task-alive"), true);

  // the flip must be persisted (stick across calls), not merely returned transiently
  const stored = loadState(cwd).jobs.find((job) => job.id === "task-dead");
  assert.equal(stored.status, "interrupted");
});

test("buildSingleJobSnapshot reconciles + persists a dead-pid job before returning it", () => {
  const cwd = makeTempDir("workspace-single-");
  upsertJob(cwd, { id: "task-dead2", status: "queued", pid: 4194303 });

  const snapshot = buildSingleJobSnapshot(cwd, "task-dead2");
  assert.equal(snapshot.job.status, "interrupted");

  const stored = loadState(cwd).jobs.find((job) => job.id === "task-dead2");
  assert.equal(stored.status, "interrupted");
});

test("resolveResultJob reconciles a dead-pid job so it no longer blocks as 'active'", () => {
  const cwd = makeTempDir("workspace-result-");
  upsertJob(cwd, { id: "task-dead3", status: "running", pid: 4194303 });
  upsertJob(cwd, { id: "task-done", status: "completed", result: { rawOutput: "done" } });

  const { job } = resolveResultJob(cwd, "task-done");
  assert.equal(job.id, "task-done");

  const stored = loadState(cwd).jobs.find((jobRecord) => jobRecord.id === "task-dead3");
  assert.equal(stored.status, "interrupted");
});

test("resolveCancelableJob is workspace-scoped (no session filtering)", () => {
  const cwd = makeTempDir("workspace-cancel-");
  upsertJob(cwd, { id: "task-cancel-me", status: "running", pid: process.pid });
  const { job } = resolveCancelableJob(cwd);
  assert.equal(job.id, "task-cancel-me");
});
