import test from "node:test"; import assert from "node:assert/strict";
import path from "node:path"; import { fileURLToPath } from "node:url";
import { makeTempDir } from "./helpers.mjs";

process.env.CLAUDE_COMPANION_DATA = makeTempDir("ccd-companion-");

const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../app-server/dist/bin.js");
const ENV = { ...process.env, CC_APPSERVER_FAKE: "1", CLAUDE_COMPANION_APPSERVER: `node ${BIN}` };

const { createCompanion, normalizeModel, MODEL_ALIASES, VALID_EFFORTS } = await import(
  "../plugins/claude/scripts/lib/companion.mjs"
);
const { listJobs } = await import("../plugins/claude/scripts/lib/state.mjs");
const { buildStatusSnapshot } = await import("../plugins/claude/scripts/lib/job-control.mjs");

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
