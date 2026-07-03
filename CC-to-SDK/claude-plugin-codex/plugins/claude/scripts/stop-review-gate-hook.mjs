#!/usr/bin/env node
// Codex Stop hook: runs a short-lived Claude review of the assistant's last message and can block
// the stop with feedback. FAIL-OPEN BY DESIGN (deliberate divergence from codex-plugin-cc's
// fail-closed blueprint, per this project's spec): gate disabled, no last_assistant_message, worker
// unavailable, malformed gate output, or a self-timeout must all ALLOW the stop (exit 0, no
// "decision" key), optionally with a `systemMessage` diagnostic. A block is only ever emitted when
// the reviewer explicitly returned a well-formed "BLOCK: <reason>" first line.
//
// Runs as its own OS process (spawned fresh by Codex per Stop event) with its own short-lived
// appserver child (spawnAppServer) -- it does not share the MCP server's client/companion state.
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getConfig, generateJobId, upsertJob } from "./lib/state.mjs";
import { createJobRecord, runTrackedJob } from "./lib/tracked-jobs.mjs";
import { loadPromptTemplate, interpolateTemplate } from "./lib/prompts.mjs";
import { spawnAppServer } from "./lib/appserver-client.mjs";

// 840s: strictly inside hooks.json's declared 900s timeout for this hook, but enforced by THIS
// script independently of that external timeout -- registered before any async work starts, so a
// hang anywhere below (worker spawn, handshake, turn) still gets force-exited at this ceiling
// rather than relying solely on Codex's own hook-timeout mechanism.
const SELF_TIMEOUT_MS = 840_000;

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, ".."); // plugins/claude (prompts/ lives here)

// Set the instant spawnAppServer(...) resolves inside main() -- module-scoped so BOTH the normal
// exitWith() funnel below AND the self-timeout/uncaughtException handlers (which run outside main()'s
// closure) can reach the live client to close it. One mechanism, not two.
let activeClient;

// Single exit path for the whole script: every branch below (allow, block, or any failure) funnels
// through this, so there is exactly one place that ever writes stdout and calls process.exit. Never
// call process.stdout.write / process.exit directly anywhere else in this file. A synchronous
// process.exit() called from inside a try prevents any enclosing finally from ever running, so the
// appserver client close has to happen HERE, before exit, rather than in a finally somewhere else.
async function exitWith(payload) {
  if (activeClient) {
    await activeClient.close().catch(() => {});
  }
  if (payload) {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  }
  process.exit(0);
}

function allow(systemMessage) {
  return exitWith(systemMessage ? { systemMessage } : null);
}

function block(reason) {
  return exitWith({ decision: "block", reason });
}

// Belt-and-suspenders: ANY bug in this script (a thrown error or rejected promise this file's own
// try/catch didn't anticipate) must still allow the stop, never leave it hanging or crash without
// emitting anything -- the harness has no reasonable expectation of a broken hook blocking a user.
process.on("uncaughtException", (error) => allow(`claude stop-gate skipped: ${error?.message ?? error}`));
process.on("unhandledRejection", (error) => allow(`claude stop-gate skipped: ${error?.message ?? error}`));

// Hard self-timeout: a bare setTimeout fires as its own event-loop macrotask regardless of what the
// main() promise chain below is awaiting (or stuck on), so this is a real independent backstop, not
// just documentation of intent.
setTimeout(() => allow("claude stop-gate skipped: self-timeout"), SELF_TIMEOUT_MS);

function readStdin() {
  return new Promise((resolve) => {
    let raw = "";
    process.stdin.on("data", (chunk) => {
      raw += chunk;
    });
    process.stdin.on("end", () => resolve(raw));
    process.stdin.on("error", () => resolve(raw));
  });
}

function buildGatePrompt(lastAssistantMessage) {
  const template = loadPromptTemplate(ROOT_DIR, "stop-review-gate");
  const responseBlock = ["Previous response from the assistant:", lastAssistantMessage].join("\n");
  return interpolateTemplate(template, { CLAUDE_RESPONSE_BLOCK: responseBlock });
}

async function runGateTurn({ client, cwd, jobId, prompt }) {
  const { threadId } = await client.threadStart({ cwd, write: false });
  // Persisted as soon as it's known so a stuck gate turn is at least visible/cancelable via the
  // normal job tooling, same pattern as companion.mjs's runRescueTurn/runReviewTurn.
  upsertJob(cwd, { id: jobId, threadId });
  const turn = await client.runTurn({ threadId, prompt });
  const rendered = turn.finalText || (turn.commentary ?? []).join("\n");
  return {
    exitStatus: turn.status === "completed" ? 0 : 1,
    threadId,
    turnId: turn.turnId,
    payload: { finalText: turn.finalText, status: turn.status },
    rendered,
    summary: rendered.slice(0, 160)
  };
}

async function main() {
  const raw = await readStdin();

  let input;
  try {
    input = raw.trim() ? JSON.parse(raw) : {};
  } catch (error) {
    return allow(`claude stop-gate skipped: invalid hook input JSON (${error.message})`);
  }

  const cwd = typeof input.cwd === "string" && input.cwd ? input.cwd : process.cwd();

  let config;
  try {
    config = getConfig(cwd);
  } catch (error) {
    return allow(`claude stop-gate skipped: ${error?.message ?? error}`);
  }
  if (!config?.stopReviewGate) {
    return allow();
  }

  const lastAssistantMessage =
    typeof input.last_assistant_message === "string" ? input.last_assistant_message.trim() : "";
  if (!lastAssistantMessage) {
    return allow();
  }

  let prompt;
  try {
    prompt = buildGatePrompt(lastAssistantMessage);
  } catch (error) {
    return allow(`claude stop-gate skipped: ${error?.message ?? error}`);
  }

  const jobId = generateJobId("gate");
  const job = createJobRecord({
    id: jobId,
    workspaceRoot: cwd,
    jobClass: "gate",
    kind: "stop-gate",
    kindLabel: "Claude Stop Gate Review",
    summary: "Stop-gate review of the previous turn",
    write: false
  });

  let client;
  try {
    client = await spawnAppServer({ cwd });
    activeClient = client; // reachable from here on by exitWith() and the self-timeout/uncaught handlers
  } catch (error) {
    return allow(`claude stop-gate skipped: worker unavailable (${error?.message ?? error})`);
  }

  try {
    const execution = await runTrackedJob(job, () => runGateTurn({ client, cwd, jobId, prompt }));
    if (execution.exitStatus !== 0) {
      return allow("claude stop-gate skipped: review turn did not complete");
    }

    const rawOutput = execution.payload?.finalText ?? "";
    const firstLine = rawOutput.split(/\r?\n/, 1)[0].trim();
    // A "BLOCK:" with no reason text is degenerate/untrustworthy output, not license to halt the
    // session with a synthesized reason -- treat it the same as any other malformed first line and
    // fall through to the shared malformed-output allow path below.
    const blockReason = firstLine.startsWith("BLOCK:") ? firstLine.slice("BLOCK:".length).trim() : "";
    if (blockReason) {
      return block(blockReason);
    }
    if (firstLine.startsWith("ALLOW:")) {
      return allow();
    }
    return allow("claude stop-gate skipped: malformed gate output");
  } catch (error) {
    // Covers runTrackedJob's runner rejecting (e.g. the turn RPC itself failed) -- runTrackedJob
    // already persisted the job as "failed" before rethrowing; there is nothing further to do here
    // except allow.
    return allow(`claude stop-gate skipped: ${error?.message ?? error}`);
  }
}

void main();
