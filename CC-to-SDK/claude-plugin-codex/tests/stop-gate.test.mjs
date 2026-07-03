import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { initGitRepo, makeTempDir, run } from "./helpers.mjs";

// Isolate this file's state under its own CLAUDE_COMPANION_DATA root (matches companion.test.mjs's
// convention) so job/config writes here never collide with other test files' state.
process.env.CLAUDE_COMPANION_DATA = makeTempDir("ccd-stopgate-");

const HOOK = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../plugins/claude/scripts/stop-review-gate-hook.mjs"
);
const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../app-server/dist/bin.js");
const FAKE_ENV = { ...process.env, CC_APPSERVER_FAKE: "1", CLAUDE_COMPANION_APPSERVER: `node ${BIN}` };

const { setConfig, listJobs } = await import("../plugins/claude/scripts/lib/state.mjs");

function makeRepo(prefix) {
  const cwd = makeTempDir(prefix);
  initGitRepo(cwd);
  return cwd;
}

function runHook(input, env) {
  return run("node", [HOOK], { cwd: input.cwd, env, input: JSON.stringify(input) });
}

test("gate disabled -> exit 0, no decision", () => {
  const cwd = makeRepo("gate-disabled-");
  const result = runHook({ cwd, hook_event_name: "Stop", last_assistant_message: "did some stuff" }, FAKE_ENV);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "");
});

test("gate enabled + fake ALLOW final text -> exit 0, no block", () => {
  const cwd = makeRepo("gate-allow-");
  setConfig(cwd, "stopReviewGate", true);
  const result = runHook({ cwd, hook_event_name: "Stop", last_assistant_message: "STOP-GATE-ALLOW" }, FAKE_ENV);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /"decision":"block"/);
});

test("gate enabled + fake BLOCK final text -> decision block with reason", () => {
  const cwd = makeRepo("gate-block-");
  setConfig(cwd, "stopReviewGate", true);
  const result = runHook({ cwd, hook_event_name: "Stop", last_assistant_message: "STOP-GATE-BLOCK" }, FAKE_ENV);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.decision, "block");
  assert.match(payload.reason, /fix the tests first/);
});

test("gate enabled + BLOCK with empty reason -> fails open (allow), does not synthesize a reason", () => {
  const cwd = makeRepo("gate-block-empty-reason-");
  setConfig(cwd, "stopReviewGate", true);
  const result = runHook(
    { cwd, hook_event_name: "Stop", last_assistant_message: "STOP-GATE-BLOCK-EMPTY-REASON" },
    FAKE_ENV
  );
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /"decision":"block"/);
  const payload = JSON.parse(result.stdout);
  assert.match(payload.systemMessage, /malformed gate output/);
});

test("worker missing -> allow with systemMessage", () => {
  const cwd = makeRepo("gate-noworker-");
  setConfig(cwd, "stopReviewGate", true);
  const noWorkerEnv = { ...process.env, PATH: "" };
  delete noWorkerEnv.CLAUDE_COMPANION_APPSERVER;
  // PATH="" means an empty spawn PATH; use the absolute node executable path (not the bare "node"
  // command run() otherwise uses) so the emptied PATH only defeats the hook's OWN internal
  // `which cc-codex-appserver` lookup, not this test's own attempt to launch node itself.
  const result = run(process.execPath, [HOOK], {
    cwd,
    env: noWorkerEnv,
    input: JSON.stringify({ cwd, hook_event_name: "Stop", last_assistant_message: "did some stuff" })
  });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /"decision":"block"/);
  const payload = JSON.parse(result.stdout);
  assert.match(payload.systemMessage, /claude stop-gate skipped/);
});

test("empty last_assistant_message -> allow", () => {
  const cwd = makeRepo("gate-empty-");
  setConfig(cwd, "stopReviewGate", true);
  const result = runHook({ cwd, hook_event_name: "Stop", last_assistant_message: "" }, FAKE_ENV);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "");
});

test("missing last_assistant_message field -> allow", () => {
  const cwd = makeRepo("gate-missing-field-");
  setConfig(cwd, "stopReviewGate", true);
  const result = runHook({ cwd, hook_event_name: "Stop" }, FAKE_ENV);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "");
});

test("gate enabled + BLOCK -> job recorded with gate- prefix and Claude Stop Gate Review label", () => {
  const cwd = makeRepo("gate-jobrecord-");
  setConfig(cwd, "stopReviewGate", true);
  const result = runHook({ cwd, hook_event_name: "Stop", last_assistant_message: "STOP-GATE-BLOCK" }, FAKE_ENV);
  assert.equal(result.status, 0, result.stderr);

  const jobs = listJobs(cwd);
  assert.equal(jobs.length, 1);
  assert.match(jobs[0].id, /^gate-/);
  assert.equal(jobs[0].kindLabel, "Claude Stop Gate Review");
  assert.equal(jobs[0].status, "completed");
});
