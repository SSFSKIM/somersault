import test from "node:test"; import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { initGitRepo, makeTempDir } from "./helpers.mjs";

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

// Task 13 wiring: resolveStateDir now resolves the git repo root (workspace.mjs/git.mjs) before
// hashing, restoring blueprint parity now that ensureGitRepository exists. A subdirectory cwd
// inside a git repo must therefore share the same state dir as the repo root.
test("resolveStateDir resolves the git repo root, so a subdirectory cwd shares the repo root's state dir", () => {
  const repoRoot = makeTempDir("workspace-git-root-");
  initGitRepo(repoRoot);
  const subDir = path.join(repoRoot, "nested", "dir");
  fs.mkdirSync(subDir, { recursive: true });

  assert.equal(resolveStateDir(subDir), resolveStateDir(repoRoot));
});

// Non-git cwd (e.g. a plain temp dir, as every other test in this file uses): ensureGitRepository
// throws, resolveWorkspaceRoot's catch returns `cwd` unchanged, so behavior for non-git dirs is
// byte-for-byte identical to before this wiring landed.
test("resolveStateDir falls back to the raw cwd for a non-git directory (pre-Task-13 behavior preserved)", () => {
  const cwd = makeTempDir("workspace-nongit-");
  const stateDir = resolveStateDir(cwd);
  const leaf = path.basename(stateDir);
  assert.match(leaf, /^[a-zA-Z0-9._-]+-[0-9a-f]{16}$/);
  assert.equal(resolveStateDir(cwd), stateDir);
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
