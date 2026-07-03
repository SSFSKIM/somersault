import test from "node:test"; import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { makeTempDir } from "./helpers.mjs";

process.env.CLAUDE_COMPANION_DATA = makeTempDir("ccd-state-");

const { resolveStateDir, loadState, saveState, generateJobId, upsertJob } = await import(
  "../plugins/claude/scripts/lib/state.mjs"
);

test("resolveStateDir nests under CLAUDE_COMPANION_DATA with a <slug>-<hash> scheme", () => {
  const cwd = makeTempDir("workspace-a-");
  const stateDir = resolveStateDir(cwd);
  assert.ok(stateDir.startsWith(process.env.CLAUDE_COMPANION_DATA));
  const leaf = path.basename(stateDir);
  assert.match(leaf, /^[a-zA-Z0-9._-]+-[0-9a-f]{16}$/);
  // deterministic across repeated calls for the same cwd
  assert.equal(resolveStateDir(cwd), stateDir);
});

test("resolveStateDir falls back to ~/.codex/claude-companion when CLAUDE_COMPANION_DATA is unset", () => {
  const saved = process.env.CLAUDE_COMPANION_DATA;
  delete process.env.CLAUDE_COMPANION_DATA;
  try {
    const cwd = makeTempDir("workspace-fallback-");
    const stateDir = resolveStateDir(cwd);
    assert.ok(stateDir.startsWith(path.join(os.homedir(), ".codex", "claude-companion")));
  } finally {
    process.env.CLAUDE_COMPANION_DATA = saved;
  }
});

test('generateJobId("task") produces a task-prefixed id', () => {
  const id = generateJobId("task");
  assert.ok(id.startsWith("task-"));
});

test("upsertJob + loadState round-trips a job record", () => {
  const cwd = makeTempDir("workspace-b-");
  upsertJob(cwd, { id: "task-abc", status: "queued" });
  const state = loadState(cwd);
  assert.equal(state.jobs.length, 1);
  assert.equal(state.jobs[0].id, "task-abc");
  assert.equal(state.jobs[0].status, "queued");
  assert.ok(state.jobs[0].createdAt);
  assert.ok(state.jobs[0].updatedAt);
});

test("saveState prunes to at most 50 jobs, keeping the newest", () => {
  const cwd = makeTempDir("workspace-c-");
  for (let i = 0; i < 55; i += 1) {
    upsertJob(cwd, { id: `task-${i}`, status: "completed" });
  }
  const state = loadState(cwd);
  assert.equal(state.jobs.length, 50);
  const ids = new Set(state.jobs.map((job) => job.id));
  assert.ok(ids.has("task-54"), "newest job should survive pruning");
  assert.ok(!ids.has("task-0"), "oldest job should be pruned");
});
