// Task 18: gated live e2e against the REAL cc-codex-appserver (no CC_APPSERVER_FAKE): drives the
// actual MCP companion server as a real child process over real MCP stdio JSON-RPC (the same wire
// the real Codex host speaks -- see tests/contract.test.mjs), which in turn spawns the real
// app-server/dist/bin.js -> a real Claude Agent SDK turn. Skips cleanly (no failures, no hang)
// unless a Claude credential is present -- same gating pattern as
// app-server/test/live/appserver.e2e.test.ts and harness/test/live/*.test.ts:
//   const live = (ANTHROPIC_API_KEY || CLAUDE_CODE_OAUTH_TOKEN) ? describe : describe.skip;
// NOT picked up by `npm test` (tests/*.test.mjs does not descend into tests/live/); run explicitly:
//   set -a; . ../.env; set +a; node --test tests/live/live.test.mjs
// or: npm run test:live
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { initGitRepo, makeTempDir } from "../helpers.mjs";

const live = (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN) ? describe : describe.skip;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = path.resolve(HERE, "../../plugins/claude-companion/scripts/claude-companion-mcp.mjs");
const APPSERVER_BIN = path.resolve(HERE, "../../../app-server/dist/bin.js");

// Shared data root for this file (mirrors contract.test.mjs/companion.test.mjs's convention): keeps
// job-store writes made by this live run out of any real ~/.claude-companion state.
const DATA_DIR = makeTempDir("ccd-live-");

// Minimal hand-rolled MCP client, deliberately reimplemented rather than imported -- same rationale
// as contract.test.mjs: the point is to drive the real process boundary Codex itself would, not the
// server's in-process functions. The one difference from contract.test.mjs's spawnCompanion: no
// CC_APPSERVER_FAKE here -- CLAUDE_COMPANION_APPSERVER points at the real built binary, so the
// companion spawns a real cc-codex-appserver that opens a real Claude Agent SDK session.
function spawnCompanion(cwd) {
  const child = spawn(process.execPath, [SERVER_ENTRY], {
    cwd,
    env: {
      ...process.env,
      CLAUDE_COMPANION_APPSERVER: `node ${APPSERVER_BIN}`,
      CLAUDE_COMPANION_DATA: DATA_DIR
    },
    stdio: ["pipe", "pipe", "pipe"]
  });

  let buf = "";
  let stderr = "";
  let nextId = 1;
  const pending = new Map();

  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  child.stdout.on("data", (chunk) => {
    buf += chunk.toString();
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      const waiter = pending.get(msg.id);
      if (!waiter) continue;
      pending.delete(msg.id);
      if (msg.error) waiter.reject(Object.assign(new Error(msg.error.message), { rpc: msg.error }));
      else waiter.resolve(msg.result);
    }
  });

  function send(method, params, id) {
    const line = { jsonrpc: "2.0", method };
    if (params !== undefined) line.params = params;
    if (id !== undefined) line.id = id;
    child.stdin.write(`${JSON.stringify(line)}\n`);
  }

  function call(method, params) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      send(method, params, id);
    });
  }

  function notify(method, params) {
    send(method, params);
  }

  async function callTool(name, args) {
    const result = await call("tools/call", { name, arguments: args ?? {} });
    return { text: result?.content?.[0]?.text ?? "", isError: Boolean(result?.isError) };
  }

  // Ends stdin and waits for real process exit (falls back to SIGKILL) so no child -- and no
  // grandchild appserver -- is ever leaked past a single test's lifetime.
  function close() {
    return new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) { resolve(); return; }
      const timer = setTimeout(() => child.kill("SIGKILL"), 3000);
      child.once("exit", () => { clearTimeout(timer); resolve(); });
      child.stdin.end();
    });
  }

  return { call, notify, callTool, close, getStderr: () => stderr };
}

async function handshake(companion) {
  const init = await companion.call("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "live-test", version: "0.0.0" }
  });
  companion.notify("notifications/initialized");
  return init;
}

live("claude-plugin-codex live e2e (real cc-codex-appserver)", () => {
  it("rescue(wait) round-trips a real Claude turn: exact pong reply", { timeout: 120_000 }, async () => {
    const cwd = makeTempDir("ccd-live-rescue-");
    const companion = spawnCompanion(cwd);
    try {
      await handshake(companion);
      const rescued = await companion.callTool("rescue", {
        prompt: "Reply with exactly: pong",
        wait: true,
        fresh: true,
        write: false,
        effort: "low"
      });
      assert.equal(rescued.isError, false, `rescue tool call errored: ${rescued.text} | stderr: ${companion.getStderr()}`);
      assert.match(rescued.text.toLowerCase(), /pong/);
    } finally {
      await companion.close();
    }
  });

  it("adversarial_review(wait) returns real output for a seeded buggy uncommitted file", { timeout: 180_000 }, async () => {
    const cwd = makeTempDir("ccd-live-advrev-");
    initGitRepo(cwd);
    // One seeded, obviously-buggy, uncommitted file (untracked -> working tree is dirty -> the
    // default "auto" scope picks working-tree). The bug itself doesn't need to be caught for this
    // test to pass -- only that a real review round-trip produces real, non-empty output.
    fs.writeFileSync(
      path.join(cwd, "buggy.js"),
      [
        "// Off-by-one: this loop skips the last element of arr.",
        "function sumAll(arr) {",
        "  let total = 0;",
        "  for (let i = 0; i < arr.length - 1; i++) {",
        "    total += arr[i];",
        "  }",
        "  return total;",
        "}",
        "module.exports = { sumAll };",
        ""
      ].join("\n")
    );

    const companion = spawnCompanion(cwd);
    try {
      await handshake(companion);
      const reviewed = await companion.callTool("adversarial_review", { wait: true });
      assert.equal(reviewed.isError, false, `adversarial_review errored: ${reviewed.text} | stderr: ${companion.getStderr()}`);
      // Accept either output path (schema-parsed findings or the raw-fallback rendering) --
      // renderReviewResult emits this header on both; the assertion is "real output came back",
      // not which path fired.
      assert.match(reviewed.text, /^# Claude Adversarial Review/);
      assert.ok(reviewed.text.trim().length > 0);
    } finally {
      await companion.close();
    }
  });
});
