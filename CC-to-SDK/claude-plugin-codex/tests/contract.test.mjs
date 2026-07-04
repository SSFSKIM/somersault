// Task 17: full-loop key-free contract test. Unlike every other test file here (which imports
// companion.mjs/mcp-stdio.mjs functions directly, in-process), THIS file spawns the real MCP
// entry point (scripts/claude-companion-mcp.mjs) as a genuine child process and speaks real MCP
// stdio JSON-RPC 2.0 to it -- exactly as Codex itself (an external process) would. That child in
// turn spawns the real app-server/dist/bin.js under CC_APPSERVER_FAKE=1 (key-free, scripted
// responses -- see app-server/src/_fake.ts). Three real processes, two real stdio pipes, zero
// mocks of this project's own code.
import test from "node:test"; import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path"; import { fileURLToPath } from "node:url";
import { initGitRepo, makeTempDir } from "./helpers.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = path.resolve(HERE, "../plugins/claude-companion/scripts/claude-companion-mcp.mjs");
const APPSERVER_BIN = path.resolve(HERE, "../../app-server/dist/bin.js");

// Shared data root for the whole file (mirrors companion.test.mjs); each test still gets its own
// temp git repo, so job state is isolated per-test via state.mjs's cwd-hashed subdirectory.
const DATA_DIR = makeTempDir("ccd-contract-");

// Minimal hand-rolled MCP client: spawns the real server entry, writes newline-delimited
// JSON-RPC 2.0 requests to its stdin, and correlates replies off their numeric `id` by parsing
// each NDJSON line from stdout. This is the actual wire contract mcp-stdio.mjs (Task 2) serves --
// deliberately reimplemented here rather than imported, since the point of this test is to drive
// the real process boundary, not the server's in-process functions.
function spawnCompanion() {
  const cwd = makeTempDir("ccd-contract-repo-");
  initGitRepo(cwd);

  const child = spawn(process.execPath, [SERVER_ENTRY], {
    cwd,
    env: {
      ...process.env,
      CC_APPSERVER_FAKE: "1",
      CLAUDE_COMPANION_APPSERVER: `node ${APPSERVER_BIN}`,
      CLAUDE_COMPANION_DATA: DATA_DIR
    },
    stdio: ["pipe", "pipe", "pipe"]
  });

  let buf = "";
  let stderr = "";
  let nextId = 1;
  const pending = new Map();
  const rawMessages = [];

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
      rawMessages.push(msg);
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

  // Ends stdin (the server's own "end" handler disposes the companion + process.exit(0)s -- see
  // claude-companion-mcp.mjs), and waits for real process exit so no child is ever leaked; falls
  // back to SIGKILL if it doesn't exit promptly.
  function close() {
    return new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) { resolve(); return; }
      const timer = setTimeout(() => child.kill("SIGKILL"), 3000);
      child.once("exit", () => { clearTimeout(timer); resolve(); });
      child.stdin.end();
    });
  }

  return { cwd, child, call, notify, callTool, close, rawMessages, getStderr: () => stderr };
}

async function handshake(companion) {
  const init = await companion.call("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "contract-test", version: "0.0.0" }
  });
  companion.notify("notifications/initialized");
  return init;
}

test("initialize/tools/list exposes the 7 tools over real MCP stdio JSON-RPC", async () => {
  const companion = spawnCompanion();
  try {
    const init = await handshake(companion);
    assert.equal(init.serverInfo.name, "claude-companion");
    assert.equal(init.protocolVersion, "2025-06-18");

    // Confirm this really is JSON-RPC 2.0 on the wire, not just a plain RPC shape.
    assert.equal(companion.rawMessages[0].jsonrpc, "2.0");
    assert.equal(companion.rawMessages[0].id, 1);

    const listed = await companion.call("tools/list", {});
    const names = listed.tools.map((t) => t.name).sort();
    assert.deepEqual(names, ["adversarial_review", "cancel", "rescue", "result", "review", "setup", "status"]);

    const rescueTool = listed.tools.find((t) => t.name === "rescue");
    assert.deepEqual(rescueTool.inputSchema.required, ["prompt"]);
  } finally {
    await companion.close();
  }
});

test("rescue(wait) -> status -> result round-trip over real MCP stdio", async () => {
  const companion = spawnCompanion();
  try {
    await handshake(companion);

    const rescued = await companion.callTool("rescue", { prompt: "do it", wait: true, fresh: true });
    assert.match(rescued.text, /final text/);
    const jobIdMatch = rescued.text.match(/\(job (\S+)\)/);
    assert.ok(jobIdMatch, `expected a job id in rescue output: ${rescued.text}`);
    const jobId = jobIdMatch[1];

    const status = await companion.callTool("status", {});
    assert.match(status.text, /^# Claude Status/);
    assert.match(status.text, new RegExp(jobId));

    const result = await companion.callTool("result", {});
    assert.match(result.text, /final text/);
    assert.match(result.text, /Continue via the rescue tool with resume:true/);
  } finally {
    await companion.close();
  }
});

test("background rescue(HANG) -> cancel -> status shows cancelled, over real MCP stdio", async () => {
  const companion = spawnCompanion();
  try {
    await handshake(companion);

    const started = await companion.callTool("rescue", { prompt: "please HANG", fresh: true });
    assert.match(started.text, /Started background job/);
    const jobIdMatch = started.text.match(/Started background job (\S+)\./);
    assert.ok(jobIdMatch, `expected a job id in background-start output: ${started.text}`);
    const jobId = jobIdMatch[1];

    const cancelled = await companion.callTool("cancel", {});
    assert.match(cancelled.text, /Cancelled/);

    const status = await companion.callTool("status", { job_id: jobId });
    assert.match(status.text, /cancelled/);
  } finally {
    await companion.close();
  }
});

test("setup reports fake auth + review-gate toggle round-trip, over real MCP stdio", async () => {
  const companion = spawnCompanion();
  try {
    await handshake(companion);

    const setupInfo = await companion.callTool("setup", {});
    assert.match(setupInfo.text, /Worker: found/);
    assert.match(setupInfo.text, /Handshake: ok/);
    assert.match(setupInfo.text, /OAuth/);
    assert.match(setupInfo.text, /Review gate: disabled/);

    const enabled = await companion.callTool("setup", { enable_review_gate: true });
    assert.match(enabled.text, /Review gate: enabled/);

    const disabled = await companion.callTool("setup", { disable_review_gate: true });
    assert.match(disabled.text, /Review gate: disabled/);
  } finally {
    await companion.close();
  }
});
