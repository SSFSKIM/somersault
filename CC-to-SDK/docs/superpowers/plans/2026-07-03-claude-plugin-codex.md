# Claude Plugin for Codex (`claude-plugin-codex`) Implementation Plan

> **Rename note (2026-07-04):** the plugin identifier was renamed `claude` → `claude-companion` after
> this plan was written. Steps below that reference `codex plugin add claude@cc-claude`, `"name":
> "claude"`, or the `plugins/claude/` source dir describe the pre-rename names; the install is now
> `claude-companion@cc-claude` and the source dir is `plugins/claude-companion/`. Marketplace (`cc-claude`)
> and MCP server (`claude-companion`) names are unchanged.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `claude-plugin-codex` — a Codex plugin that spawns Claude workers via `cc-codex-appserver`, mirroring `codex-plugin-cc` (rescue / review / adversarial_review / status / result / cancel / setup + a Stop review gate), plus the `cc-codex-appserver` v0.2 protocol extensions it needs.

**Architecture:** The plugin ships an **MCP server** (`claude-companion`, zero-dep Node ESM) that Codex spawns unsandboxed with cwd = the workspace. It embeds the ported job store from `codex-plugin-cc`, holds one `cc-codex-appserver` child over stdio (Codex v2 JSON-RPC "lite"), and exposes seven tools. Skills carry usage guidance; a Codex `Stop` hook runs the review gate. No broker — the MCP server *is* the shared long-lived process.

**Tech Stack:** Plugin: plain Node ESM `.mjs`, zero runtime deps, `node --test`. App-server extensions: TypeScript + vitest (existing `CC-to-SDK/app-server/` package, `cc-harness` via `file:../harness`).

**Spec:** `docs/superpowers/specs/2026-07-03-claude-plugin-codex-design.md` (read it; this plan implements it). Source blueprint: `CC-to-SDK/codex-plugin-cc/` (read-only reference — never edit it).

## Global Constraints

- **Two packages, two test runners.** Plugin work runs from `CC-to-SDK/claude-plugin-codex/` (`npm test` = `node --test tests/*.test.mjs`). App-server work runs from `CC-to-SDK/app-server/` (`npx vitest run test/unit`, `npm run typecheck`). Harness (`CC-to-SDK/harness/`) must be built (`npm run build`) before app-server builds.
- **Plugin is zero-runtime-dependency** (like the original): no `node_modules` at runtime — Codex's plugin cache copies files, it does not npm-install. MCP stdio is hand-rolled.
- **Wire protocols:** appserver side = Codex v2 JSON-RPC "lite" (NDJSON, **no** `jsonrpc` field). MCP side = JSON-RPC 2.0 (NDJSON, **with** `"jsonrpc":"2.0"`). stdout of each server is its protocol channel — log only to stderr.
- **Naming:** plugin `claude`, MCP server `claude-companion`, env vars `CLAUDE_COMPANION_*`. Job id prefixes: `task-`, `review-`, `advrev-`, `gate-`.
- **Model aliases (exact):** `opus→claude-opus-4-8`, `sonnet→claude-sonnet-5`, `haiku→claude-haiku-4-5-20251001`, `fable→claude-fable-5`. Full `claude-*` ids pass through; anything else → error text listing aliases.
- **Effort → thinking budget (exact):** `low:4000, medium:10000, high:16000, xhigh:24000, max:32000` (mirrors `tui/src/thinkLevels.ts`).
- **State roots:** plugin `CLAUDE_COMPANION_DATA` env ?? `~/.codex/claude-companion` (then `state/<slug>-<sha256(realpath cwd)[:16]>/`); appserver sidecar `CC_APPSERVER_STATE_DIR` env ?? `~/.cc-appserver`.
- **Host facts (from codex-rs source; Task 2 confirms live and records to `claude-plugin-codex/docs/host-facts.md`):**
  - Stop hook stdin: `{cwd, hook_event_name:"Stop", last_assistant_message, model, permission_mode, session_id, stop_hook_active, transcript_path, turn_id}` (`codex-rs/hooks/schema/generated/stop.command.input.schema.json`).
  - Stop hook block: exit 0 + `{"decision":"block","reason":"<non-empty>"}` on stdout (reason feeds back to the model). Timeout config field `timeout` (seconds), engine default 600.
  - MCP child env = whitelist (`HOME,PATH,…`) + `.mcp.json` `env`/`env_vars` — **auth env vars must be whitelisted via `env_vars`**; child cwd = workspace cwd; spawn unsandboxed; `tool_timeout_sec` settable per server (default 300).
- **appserver v0.2 rules:** additions must be backward-compatible (Director unaffected); every new method gets a vitest unit test + `CC_APPSERVER_FAKE=1` scripting; dense hand-style, ESM `.js` import specifiers, DI-by-deps (see `harness/CLAUDE.md`).
- **Git:** commit after every task from the repo root; **no Co-Authored-By / attribution lines**; never push.
- **Live tests** gate on `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` from `CC-to-SDK/.env` (never print/commit). Implementers stop at the clean keyless skip; the controller runs keyed.

---

## File Structure

```
CC-to-SDK/app-server/src/
  threads.ts        # NEW: persistent threadId→sessionId sidecar (record/lookup, prune 200)
  handlers.ts       # MODIFY: +thread/resume, turn/interrupt, account/read, thread/name/set, config/read;
                    #         effort→thinking, outputSchema→outputFormat; sidecar recording; buildCfg refactor
  registry.ts       # MODIFY: allocId → thr_<8 hex random>; ThreadEntry gains cwd
  _fake.ts          # MODIFY: sessionId, interrupt/HANG, accountInfo, resume echo
  protocol.ts       # MODIFY: ThreadStartParams += effort?, outputSchema?
CC-to-SDK/harness/src/config/
  types.ts          # MODIFY: HarnessConfig.outputFormat?: unknown (1 line + comment)
  resolveOptions.ts # MODIFY: passthrough (1 line)
CC-to-SDK/probes/probes/
  36-output-format-json-schema.ts   # NEW: A1 probe for outputFormat json_schema
CC-to-SDK/claude-plugin-codex/
  package.json  README.md  docs/host-facts.md  .agents/plugins/marketplace.json
  plugins/claude/
    .codex-plugin/plugin.json
    .mcp.json
    hooks/hooks.json
    skills/claude-delegation/SKILL.md
    skills/claude-prompting/SKILL.md
    skills/claude-prompting/references/claude-prompt-recipes.md
    prompts/{claude-review.md, adversarial-review.md, stop-review-gate.md}
    schemas/review-output.schema.json
    scripts/claude-companion-mcp.mjs        # MCP server entry
    scripts/stop-review-gate-hook.mjs       # Stop hook entry
    scripts/lib/mcp-stdio.mjs               # hand-rolled MCP stdio server
    scripts/lib/appserver-client.mjs        # spawn + v2-lite peer + threadStart/Resume/runTurn/interrupt/accountRead
    scripts/lib/companion.mjs               # tool handlers + dispatch (aliases, jobs, flows)
    scripts/lib/{state.mjs, tracked-jobs.mjs, job-control.mjs, render.mjs, git.mjs, prompts.mjs, fs.mjs, process.mjs}  # ports
  tests/
    helpers.mjs  state.test.mjs  jobs.test.mjs  mcp-stdio.test.mjs  client.test.mjs
    companion.test.mjs  git.test.mjs  render.test.mjs  stop-gate.test.mjs  contract.test.mjs
    live/live.test.mjs   # gated; run by controller
```

Port sources (copy-then-edit; never import across): `CC-to-SDK/codex-plugin-cc/plugins/codex/scripts/lib/<name>.mjs`.

---

### Task 1: Probe 36 — `outputFormat: json_schema` headless reachability

The SDK declares `outputFormat?: {type:'json_schema', schema}` (`sdk.d.ts:1691-1697,2030`). Declared ≠ reachable — this probe decides whether Task 8 wires it or documents the prompt-embedded fallback.

**Files:**
- Create: `CC-to-SDK/probes/probes/36-output-format-json-schema.ts`

**Interfaces:**
- Produces: a written verdict in the probe file header comment + console output; Task 8 reads it.

- [ ] **Step 1: Write the probe** (mirror the style of `probes/probes/28-*.ts` — self-contained, `tsx`-run):

```typescript
// probes/probes/36-output-format-json-schema.ts
// QUESTION: does options.outputFormat {type:'json_schema'} work headlessly (streaming input, -p mode)?
// VERDICT (fill after run): ...
import { query } from "@anthropic-ai/claude-agent-sdk";

const schema = { type: "object", properties: { verdict: { type: "string", enum: ["approve", "needs-attention"] }, summary: { type: "string" } }, required: ["verdict", "summary"], additionalProperties: false };
async function* prompts() { yield { type: "user" as const, message: { role: "user" as const, content: "Review this: `const x = 1`. Reply per the output schema." }, parent_tool_use_id: null }; }

const q = query({ prompt: prompts(), options: { outputFormat: { type: "json_schema", schema }, model: "claude-sonnet-5", maxTurns: 1 } as any });
for await (const m of q as any) {
  if (m.type === "result") {
    console.log("result.result =", JSON.stringify(m.result)?.slice(0, 500));
    console.log("structured =", JSON.stringify((m as any).structured_output ?? null)?.slice(0, 500));
    try { console.log("parses as JSON:", !!JSON.parse(typeof m.result === "string" ? m.result : "null")); } catch { console.log("parses as JSON: false"); }
  }
}
```

- [ ] **Step 2: Run it keyed** (controller): `cd CC-to-SDK/probes && set -a; . ../.env; set +a; npx tsx probes/36-output-format-json-schema.ts`
Expected: either schema-conforming JSON in `result` (or a `structured_output` field) → **VERDICT: wired**, or an option-rejected error / free text → **VERDICT: fallback**.

- [ ] **Step 3: Record the verdict** in the probe's header comment (which field carries the JSON — `result` string vs `structured_output`), plus any error text.

- [ ] **Step 4: Commit**

```bash
git add CC-to-SDK/probes/probes/36-output-format-json-schema.ts
git commit -m "probe(36): outputFormat json_schema headless reachability"
```

---

### Task 2: Plugin scaffold + host-facts probe + install loop (V5/V2/V3 live)

Walking skeleton: a real installable plugin whose only tool is a stub `setup` that dumps its runtime environment, plus a probe hook. Installing it settles every host unknown.

**Files:**
- Create: `claude-plugin-codex/package.json`, `.agents/plugins/marketplace.json`, `plugins/claude/.codex-plugin/plugin.json`, `plugins/claude/.mcp.json`, `plugins/claude/hooks/hooks.json`, `plugins/claude/scripts/claude-companion-mcp.mjs` (stub), `plugins/claude/scripts/lib/mcp-stdio.mjs`, `plugins/claude/scripts/hook-probe.mjs` (temporary), `tests/mcp-stdio.test.mjs`, `tests/helpers.mjs`, `docs/host-facts.md`

**Interfaces:**
- Produces: `createMcpServer({name, version, tools})` + `runMcpServer(server, {stdin, stdout})` from `mcp-stdio.mjs`, where `tools: Array<{name, description, inputSchema, handler: (args: object) => Promise<string>}>` — every later tool task plugs into this. `docs/host-facts.md` — the ledger Tasks 12/15 read (mcp path resolution, hook path resolution, env observed).

- [ ] **Step 1: Scaffold package + manifests**

`package.json`:
```json
{
  "name": "claude-plugin-codex", "version": "0.1.0", "private": true, "type": "module",
  "description": "Use Claude from Codex to review code or delegate tasks.",
  "engines": { "node": ">=18.18.0" },
  "scripts": { "test": "node --test tests/*.test.mjs" },
  "devDependencies": { "@types/node": "^25.5.0", "typescript": "^6.0.2" }
}
```

`.agents/plugins/marketplace.json` (shape from `codex-rs/skills/src/assets/samples/plugin-creator/references/plugin-json-spec.md:119-197` — copy its sample and adjust; core entry):
```json
{
  "name": "cc-claude",
  "plugins": [
    { "name": "claude", "source": { "source": "local", "path": "./plugins/claude" },
      "category": "Productivity",
      "policy": { "installation": "AVAILABLE", "authentication": "ON_USE" } }
  ]
}
```

`plugins/claude/.codex-plugin/plugin.json` (minimal — rely on default discovery of `skills/`, `hooks/hooks.json`, `.mcp.json`):
```json
{ "name": "claude", "version": "0.1.0", "description": "Delegate tasks and reviews to Claude workers from Codex." }
```

`plugins/claude/.mcp.json` (relative path resolution against plugin root is the expected behavior — Step 5 verifies; `env_vars` whitelists auth through Codex's env-cleared spawn):
```json
{
  "mcpServers": {
    "claude-companion": {
      "command": "node",
      "args": ["./scripts/claude-companion-mcp.mjs"],
      "env_vars": ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "CLAUDE_COMPANION_APPSERVER", "CLAUDE_COMPANION_DATA"],
      "startup_timeout_sec": 30,
      "tool_timeout_sec": 1200
    }
  }
}
```

`plugins/claude/hooks/hooks.json` (probe hook — replaced by the real gate in Task 15):
```json
{ "hooks": { "SessionStart": [ { "hooks": [ { "type": "command", "command": "node \"./scripts/hook-probe.mjs\"", "timeout": 10 } ] } ] } }
```

`scripts/hook-probe.mjs`:
```js
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
let input = ""; process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  const out = { argv: process.argv, cwd: process.cwd(), env: Object.keys(process.env).sort(), stdin: (() => { try { return JSON.parse(input); } catch { return input.slice(0, 400); } })() };
  fs.writeFileSync(path.join(os.homedir(), ".codex", "claude-hook-probe.json"), JSON.stringify(out, null, 2));
});
```

- [ ] **Step 2: Write the failing mcp-stdio test** (`tests/mcp-stdio.test.mjs`) — drive the framing pure-functionally:

```js
import test from "node:test"; import assert from "node:assert/strict";
import { createMcpServer, handleLine } from "../plugins/claude/scripts/lib/mcp-stdio.mjs";

function mkServer(out) {
  return createMcpServer({ name: "claude-companion", version: "0.1.0", sink: (o) => out.push(o),
    tools: [{ name: "echo", description: "echoes", inputSchema: { type: "object", properties: { text: { type: "string" } } }, handler: async (a) => `you said ${a.text}` }] });
}
test("initialize → tools/list → tools/call round-trip", async () => {
  const out = []; const srv = mkServer(out);
  handleLine(srv, JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "codex" } } }));
  assert.equal(out[0].id, 1); assert.equal(out[0].result.serverInfo.name, "claude-companion"); assert.equal(out[0].result.protocolVersion, "2025-06-18");
  handleLine(srv, JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }));
  handleLine(srv, JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }));
  assert.equal(out[1].result.tools[0].name, "echo");
  handleLine(srv, JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "echo", arguments: { text: "hi" } } }));
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(out[2].result.content, [{ type: "text", text: "you said hi" }]);
});
test("unknown method → -32601; handler throw → isError content", async () => {
  const out = []; const srv = mkServer(out);
  handleLine(srv, JSON.stringify({ jsonrpc: "2.0", id: 9, method: "nope" }));
  assert.equal(out[0].error.code, -32601);
});
```

- [ ] **Step 3: Run to verify it fails** — `cd CC-to-SDK/claude-plugin-codex && npm test` → FAIL (module not found).

- [ ] **Step 4: Implement `scripts/lib/mcp-stdio.mjs`**

```js
// Hand-rolled MCP stdio server: JSON-RPC 2.0, newline-delimited, tools-only capability.
export function createMcpServer({ name, version, tools, sink }) {
  return { name, version, tools, sink, buf: "" };
}
function reply(srv, id, result) { srv.sink({ jsonrpc: "2.0", id, result }); }
function replyError(srv, id, code, message) { srv.sink({ jsonrpc: "2.0", id, error: { code, message } }); }

export function handleLine(srv, line) {
  const t = line.trim(); if (!t) return;
  let msg; try { msg = JSON.parse(t); } catch { console.error("[claude-companion] bad json:", t.slice(0, 200)); return; }
  const { id, method, params } = msg;
  if (method === undefined) return;                       // response to us — none expected
  if (id === undefined || id === null) return;            // notification (initialized etc.) — ignore
  switch (method) {
    case "initialize":
      return reply(srv, id, { protocolVersion: params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: srv.name, version: srv.version } });
    case "ping": return reply(srv, id, {});
    case "tools/list":
      return reply(srv, id, { tools: srv.tools.map((t2) => ({ name: t2.name, description: t2.description, inputSchema: t2.inputSchema })) });
    case "tools/call": {
      const tool = srv.tools.find((t2) => t2.name === params?.name);
      if (!tool) return replyError(srv, id, -32602, `unknown tool: ${params?.name}`);
      void tool.handler(params?.arguments ?? {}).then(
        (text) => reply(srv, id, { content: [{ type: "text", text }] }),
        (e) => reply(srv, id, { content: [{ type: "text", text: `claude-companion error: ${e?.message ?? e}` }], isError: true }),
      );
      return;
    }
    default: return replyError(srv, id, -32601, `method not found: ${method}`);
  }
}

export function runMcpServer(srv, io = { stdin: process.stdin, stdout: process.stdout }) {
  srv.sink = (o) => io.stdout.write(JSON.stringify(o) + "\n");
  io.stdin.on("data", (c) => { srv.buf += c.toString(); let nl; while ((nl = srv.buf.indexOf("\n")) >= 0) { const l = srv.buf.slice(0, nl); srv.buf = srv.buf.slice(nl + 1); handleLine(srv, l); } });
  io.stdin.resume();
}
```
Note: `createMcpServer` takes `sink` for tests; `runMcpServer` overrides it with real stdout.

- [ ] **Step 5: Stub entry `scripts/claude-companion-mcp.mjs`** — one stub `setup` tool dumping env facts:

```js
import { createMcpServer, runMcpServer } from "./lib/mcp-stdio.mjs";
const tools = [{
  name: "setup", description: "Report claude-companion runtime environment (scaffold stub).",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  handler: async () => JSON.stringify({ cwd: process.cwd(), node: process.version,
    env: { HOME: !!process.env.HOME, PATH: !!process.env.PATH, CLAUDE_CODE_OAUTH_TOKEN: !!process.env.CLAUDE_CODE_OAUTH_TOKEN, ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY, CLAUDE_COMPANION_APPSERVER: process.env.CLAUDE_COMPANION_APPSERVER ?? null } }, null, 2),
}];
runMcpServer(createMcpServer({ name: "claude-companion", version: "0.1.0", tools }));
```

- [ ] **Step 6: Unit tests green** — `npm test` → PASS. Also copy `tests/helpers.mjs` from `codex-plugin-cc/tests/helpers.mjs` verbatim (temp dirs, `run`, `initGitRepo`, executable writer) — used by later tasks.

- [ ] **Step 7: Install live (V5)** on the user's codex:
```bash
codex plugin marketplace add /Users/new/Documents/GitHub/codex_somersault/CC-to-SDK/claude-plugin-codex
codex plugin add claude@cc-claude
```
Then start a fresh `codex` in a scratch repo and (a) ask it to call the `setup` tool, (b) exit and read `~/.codex/claude-hook-probe.json`. If marketplace/manifest shapes are rejected, fix against the sample spec and re-add (dev loop: bump version suffix, `codex plugin add` again).

- [ ] **Step 8: Record `docs/host-facts.md`** — exact findings: how `.mcp.json` relative paths resolved (plugin-root-relative? if not, the working mechanism), MCP child cwd (= workspace?), env keys present (whitelist confirmed), hook process cwd + env + whether a plugin-root variable exists for hook commands (inspect `argv`/`env`/resolution from the probe output), the installed plugin cache path. Delete nothing yet — the probe hook stays until Task 15 replaces it.

- [ ] **Step 9: Commit**
```bash
git add CC-to-SDK/claude-plugin-codex
git commit -m "feat(claude-plugin-codex): scaffold — installable walking skeleton (mcp-stdio, stub setup, host-facts probe)"
```

---

### Task 3: appserver — globally unique thread ids + persistent sidecar

Cross-process resume needs ids that survive restarts and a threadId→sdkSessionId map.

**Files:**
- Create: `app-server/src/threads.ts`, `app-server/test/unit/threads.test.ts`
- Modify: `app-server/src/registry.ts` (allocId + ThreadEntry.cwd), `app-server/src/handlers.ts` (record after turns), `app-server/src/_fake.ts` (sessionId)

**Interfaces:**
- Produces: `recordThread(threadId, sessionId, cwd, dir?)`, `lookupThread(threadId, dir?): {sessionId, cwd, updatedAt} | undefined`, `threadsDir()` from `threads.ts`. `Registry.allocId()` now returns `thr_<8 hex>`. `ThreadEntry` gains `cwd?: string`.

- [ ] **Step 1: Failing test** (`test/unit/threads.test.ts`):

```typescript
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
import { recordThread, lookupThread } from "../../src/threads.js";
import { Registry } from "../../src/registry.js";

describe("threads sidecar", () => {
  it("records and looks up across instances; unknown -> undefined", () => {
    const dir = mkdtempSync(join(tmpdir(), "ccas-"));
    recordThread("thr_ab12cd34", "sdk_123", "/w", dir);
    expect(lookupThread("thr_ab12cd34", dir)).toMatchObject({ sessionId: "sdk_123", cwd: "/w" });
    expect(lookupThread("thr_nope", dir)).toBeUndefined();
  });
  it("prunes to 200 newest", () => {
    const dir = mkdtempSync(join(tmpdir(), "ccas-"));
    for (let i = 0; i < 210; i++) recordThread(`thr_${String(i).padStart(8, "0")}`, `s${i}`, "/w", dir);
    expect(lookupThread("thr_00000005", dir)).toBeUndefined();
    expect(lookupThread("thr_00000209", dir)).toBeDefined();
  });
  it("allocId is random-unique across Registry instances", () => {
    const a = new Registry().allocId(), b = new Registry().allocId();
    expect(a).toMatch(/^thr_[0-9a-f]{8}$/); expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run test/unit/threads.test.ts` → FAIL.

- [ ] **Step 3: Implement `src/threads.ts`**

```typescript
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os"; import { join } from "node:path";

export function threadsDir(): string { return process.env.CC_APPSERVER_STATE_DIR ?? join(homedir(), ".cc-appserver"); }
interface Rec { sessionId: string; cwd: string; updatedAt: number }
function load(dir: string): Record<string, Rec> { try { return JSON.parse(readFileSync(join(dir, "threads.json"), "utf8")); } catch { return {}; } }

export function recordThread(threadId: string, sessionId: string, cwd: string, dir = threadsDir()): void {
  mkdirSync(dir, { recursive: true });
  const all = load(dir); all[threadId] = { sessionId, cwd, updatedAt: Date.now() };
  const keys = Object.keys(all).sort((a, b) => all[b].updatedAt - all[a].updatedAt).slice(0, 200);
  writeFileSync(join(dir, "threads.json"), JSON.stringify(Object.fromEntries(keys.map((k) => [k, all[k]]))));
}
export function lookupThread(threadId: string, dir = threadsDir()): Rec | undefined { return load(dir)[threadId]; }
```
(Note: prune test writes with distinct `Date.now()` ties — sort is stable enough because later writes overwrite the file each call; if flaky, add `updatedAt: Date.now() + i` jitter in the test loop, not the impl.)

- [ ] **Step 4: registry.ts edits** — replace `allocId` and extend the entry type:

```typescript
import { randomBytes } from "node:crypto";
export interface ThreadEntry { session: Session; turnSeq: number; currentTurnId?: string; cwd?: string }
  allocId(): string { return `thr_${randomBytes(4).toString("hex")}`; }
```
(`register` unchanged; callers set `entry.cwd` after register.)

- [ ] **Step 5: handlers.ts — persist the mapping.** In `threadStart`, after `this.reg.register(threadId, session);` add `const e = this.reg.get(threadId); if (e) e.cwd = params.cwd;`. In `runTurn`, after the `submit` line resolves (both success path, before `finalize`), add:

```typescript
      const sid = (entry.session as any).sessionId as string | undefined;
      if (sid && (entry as any).threadId) recordThread((entry as any).threadId, sid, entry.cwd ?? "");
```
Simplest threading of the id: change `runTurn(entry, text, tr)` signature to `runTurn(threadId: string, entry, text, tr)` and call `recordThread(threadId, sid, entry.cwd ?? "")` — update the `turnStart` call site (`void this.runTurn(params.threadId, entry, text, tr);`). Import `recordThread` from `./threads.js`.

- [ ] **Step 6: _fake.ts — add a session id** so the sidecar works key-free. Add a module-level counter and `sessionId` to the returned object:

```typescript
let fakeN = 0;
export const fakeOpen: OpenFn = (_cfg: any, ctx: OpenCtx) => ({
  sessionId: `sdk_fake_${++fakeN}`,
  ...
```

- [ ] **Step 7: Green + typecheck** — `npx vitest run test/unit` → PASS; `npm run typecheck` → clean. Existing `handlers.test.ts` may assert `thr_1` — update those assertions to `expect(id).toMatch(/^thr_[0-9a-f]{8}$/)` style.

- [ ] **Step 8: Commit** — `git commit -m "feat(cc-appserver): random thread ids + persistent threadId→sessionId sidecar"`

---

### Task 4: appserver — `thread/resume`

**Files:**
- Modify: `app-server/src/handlers.ts` (case + `buildCfg` refactor), `app-server/src/protocol.ts` (params type), `app-server/src/_fake.ts` (resume echo)
- Test: `app-server/test/unit/handlers.test.ts` (extend)

**Interfaces:**
- Consumes: `lookupThread` (Task 3), `resumeSession`-equivalent via `cfg.resume` (harness `HarnessConfig.resume` — `resolveOptions.ts:62`).
- Produces: `thread/resume {threadId, cwd?, model?, approvalPolicy?, sandbox?, effort?}` → `{thread:{id:<same threadId>}}` + `thread/started` notification. Unknown threadId → `-32602`.

- [ ] **Step 1: Failing test** (extend `handlers.test.ts`, following its existing fake-open DI pattern):

```typescript
it("thread/resume reopens via cfg.resume and keeps the thread id", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ccas-"));
  process.env.CC_APPSERVER_STATE_DIR = dir;
  recordThread("thr_deadbeef", "sdk_prev", "/w", dir);
  const opened: any[] = [];
  const srv = makeServer({ open: (cfg: any) => { opened.push(cfg); return fakeSession(); } });   // reuse the file's existing helpers
  srv.handleRequest("thread/resume", { threadId: "thr_deadbeef", cwd: "/w", approvalPolicy: "never" }, 7);
  expect(replies.find((r) => r.id === 7).result).toEqual({ thread: { id: "thr_deadbeef" } });
  expect(opened[0].resume).toBe("sdk_prev");
  expect(notes.some((n) => n.method === "thread/started")).toBe(true);
  delete process.env.CC_APPSERVER_STATE_DIR;
});
it("thread/resume unknown id -> INVALID_PARAMS", () => { /* expect error code -32602 */ });
```
(Adapt helper names to the file's actual fixtures — read `handlers.test.ts` first; it already builds a `Peer` with captured `replies`/`notes`.)

- [ ] **Step 2: Run → FAIL** (`method not found`).

- [ ] **Step 3: Implement.** In `handlers.ts`: extract the cfg-assembly block of `threadStart` (posture→sandbox→broker→permissionBroker wiring, i.e. current lines 54-76) into a private helper used by both paths:

```typescript
private buildCfg(params: ThreadStartParams, threadId: string): { cfg: any; specs: DynamicToolSpec[]; broker: ToolBroker } { /* moved lines 54-75, returning instead of opening */ }
```
Then:
```typescript
case "thread/resume": return this.threadResume(params as ThreadStartParams & { threadId: string }, id);

private threadResume(params: ThreadStartParams & { threadId: string }, id: number | string): void {
  const rec = lookupThread(params.threadId);
  if (!rec) return this.peer.replyError(id, ERR.INVALID_PARAMS, `unknown thread ${params.threadId}`);
  const threadId = params.threadId;
  const { cfg, specs, broker } = this.buildCfg({ ...params, cwd: params.cwd ?? rec.cwd }, threadId);
  const session = this.open({ ...cfg, resume: rec.sessionId }, { broker: specs.length ? broker : undefined, dynamicTools: specs });
  this.reg.register(threadId, session);
  const e = this.reg.get(threadId); if (e) e.cwd = params.cwd ?? rec.cwd;
  this.peer.reply(id, { thread: { id: threadId } });
  this.peer.notify("thread/started", { thread: { id: threadId } });
}
```
Add to `protocol.ts`: `export interface ThreadResumeParams extends ThreadStartParams { threadId: string }` (and use it instead of the inline intersection if preferred). `_fake.ts`: when `cfg.resume` is set, make the first streamed text `resumed:${cfg.resume}` so contract tests can assert the path.

- [ ] **Step 4: Green + typecheck.** `npx vitest run test/unit` PASS; `npm run typecheck` clean.
- [ ] **Step 5: Commit** — `git commit -m "feat(cc-appserver): thread/resume via session-store resume + sidecar lookup"`

---

### Task 5: appserver — `turn/interrupt`

**Files:**
- Modify: `app-server/src/handlers.ts`, `app-server/src/_fake.ts`
- Test: `app-server/test/unit/handlers.test.ts` (extend)

**Interfaces:**
- Produces: `turn/interrupt {threadId, turnId?}` → `{}` reply; the in-flight turn then terminates through the normal `runTurn` catch → `turn/failed`. Unknown thread → `-32602`. Fake: prompt containing `HANG` parks until `interrupt()`.

- [ ] **Step 1: Failing test:**

```typescript
it("turn/interrupt aborts a hanging turn -> {} reply then turn/failed", async () => {
  const srv = makeServer({ open: fakeOpen });   // the real fake, which now supports HANG
  srv.handleRequest("thread/start", { cwd: "/w", approvalPolicy: "never" }, 1);
  const threadId = replies[0].result.thread.id;
  srv.handleRequest("turn/start", { threadId, input: [{ type: "text", text: "please HANG" }] }, 2);
  srv.handleRequest("turn/interrupt", { threadId }, 3);
  await new Promise((r) => setTimeout(r, 20));
  expect(replies.find((r) => r.id === 3).result).toEqual({});
  expect(notes.some((n) => n.method === "turn/failed")).toBe(true);
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.** `_fake.ts` — park + release:

```typescript
  let pendingReject: ((e: Error) => void) | undefined;
  // inside submit(): if (prompt.includes("HANG")) return new Promise((_, rej) => { pendingReject = rej; });
  interrupt: async () => { pendingReject?.(new Error("interrupted")); pendingReject = undefined; },
```
`handlers.ts`:
```typescript
case "turn/interrupt": return void this.turnInterrupt(params as { threadId: string }, id);

private async turnInterrupt(params: { threadId: string }, id: number | string): Promise<void> {
  const entry = this.reg.get(params.threadId);
  if (!entry) return this.peer.replyError(id, ERR.INVALID_PARAMS, `unknown thread ${params.threadId}`);
  try { await entry.session.interrupt(); this.peer.reply(id, {}); }
  catch (e) { this.peer.replyError(id, ERR.INTERNAL, `interrupt failed: ${(e as Error).message}`); }
}
```
- [ ] **Step 4: Green + typecheck.**
- [ ] **Step 5: Commit** — `git commit -m "feat(cc-appserver): turn/interrupt via Session.interrupt()"`

---

### Task 6: appserver — `account/read`

**Files:**
- Modify: `app-server/src/handlers.ts`, `app-server/src/_fake.ts`
- Test: `app-server/test/unit/handlers.test.ts` (extend)

**Interfaces:**
- Produces: `account/read {}` → `{ account: { authenticated: boolean, method?: "oauth-token"|"api-key"|"cli-login", provider?: string } }`. Implementation opens ONE ephemeral session (cwd = os tmpdir), calls `session.accountInfo()` with a 10s race, disposes, caches the result for process lifetime. `accountInfo()` shape (probe 28): `{tokenSource?: string, apiProvider?: string}`; `tokenSource === "CLAUDE_CODE_OAUTH_TOKEN"` → method `oauth-token`; `tokenSource === "ANTHROPIC_API_KEY"` → `api-key`; other truthy info → `cli-login`. Throw/timeout → `{authenticated:false}` (no method).

- [ ] **Step 1: Failing test:**

```typescript
it("account/read maps accountInfo and caches", async () => {
  let opens = 0;
  const open = (() => { opens++; return { ...fakeSessionBase(), accountInfo: async () => ({ tokenSource: "CLAUDE_CODE_OAUTH_TOKEN", apiProvider: "firstParty" }), dispose: async () => {} }; }) as any;
  const srv = makeServer({ open });
  srv.handleRequest("account/read", {}, 4); await new Promise((r) => setTimeout(r, 10));
  expect(replies.find((r) => r.id === 4).result).toEqual({ account: { authenticated: true, method: "oauth-token", provider: "firstParty" } });
  srv.handleRequest("account/read", {}, 5); await new Promise((r) => setTimeout(r, 10));
  expect(opens).toBe(1);   // cached
});
it("account/read failure -> authenticated:false", async () => { /* open throws → { account: { authenticated: false } } */ });
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** in `handlers.ts`:

```typescript
private accountCache?: { authenticated: boolean; method?: string; provider?: string };

case "account/read": return void this.accountRead(id);

private async accountRead(id: number | string): Promise<void> {
  if (this.accountCache) return this.peer.reply(id, { account: this.accountCache });
  let session: Session | undefined;
  try {
    session = this.open({ cwd: tmpdir() }, {});
    const raw: any = await Promise.race([session.accountInfo(), new Promise((_, rej) => setTimeout(() => rej(new Error("account/read timeout")), 10_000))]);
    const method = raw?.tokenSource === "CLAUDE_CODE_OAUTH_TOKEN" ? "oauth-token" : raw?.tokenSource === "ANTHROPIC_API_KEY" ? "api-key" : raw ? "cli-login" : undefined;
    this.accountCache = { authenticated: !!raw, ...(method ? { method } : {}), ...(raw?.apiProvider ? { provider: raw.apiProvider } : {}) };
  } catch { this.accountCache = { authenticated: false }; }
  finally { try { await session?.dispose(); } catch {} }
  this.peer.reply(id, { account: this.accountCache });
}
```
(`import { tmpdir } from "node:os";`.) `_fake.ts`: add `accountInfo: async () => ({ tokenSource: "CLAUDE_CODE_OAUTH_TOKEN", apiProvider: "firstParty" })` to the returned object so fake-mode `setup` works end-to-end.

- [ ] **Step 4: Green + typecheck.**
- [ ] **Step 5: Commit** — `git commit -m "feat(cc-appserver): account/read via ephemeral-session accountInfo (cached)"`

---

### Task 7: appserver — `thread/name/set` no-op + `config/read` stub

**Files:**
- Modify: `app-server/src/handlers.ts`
- Test: `app-server/test/unit/handlers.test.ts` (extend)

**Interfaces:**
- Produces: `thread/name/set {threadId, name}` → `{}`. `config/read {}` → `{ config: { model: DEFAULTS.model } }` (import `DEFAULTS` from `cc-harness`).

- [ ] **Step 1: Failing test** — two asserts: `thread/name/set` replies `{}`; `config/read` replies `{config:{model: DEFAULTS.model}}`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — two switch lines:

```typescript
case "thread/name/set": return this.peer.reply(id, {});
case "config/read": return this.peer.reply(id, { config: { model: DEFAULTS.model } });
```
- [ ] **Step 4: Green + typecheck.**
- [ ] **Step 5: Commit** — `git commit -m "feat(cc-appserver): thread/name/set noop + config/read stub"`

---

### Task 8: appserver — `effort` → thinking budget; `outputSchema` → SDK `outputFormat`

**Files:**
- Modify: `harness/src/config/types.ts`, `harness/src/config/resolveOptions.ts` (1 line each), `app-server/src/protocol.ts`, `app-server/src/handlers.ts`
- Test: `app-server/test/unit/handlers.test.ts` (extend), `harness/test/unit/` resolveOptions test (extend the existing file)

**Interfaces:**
- Consumes: Probe 36 verdict (Task 1). If verdict = **wired**: `HarnessConfig.outputFormat?: unknown` passed through to SDK options. If verdict = **fallback**: skip the harness/appserver outputSchema wiring entirely — Task 13's prompts carry the schema inline (they do anyway) and this task ships effort only.
- Produces: `ThreadStartParams` gains `effort?: string; outputSchema?: Record<string, unknown>`. Effort map `EFFORT_BUDGETS = {low:4000, medium:10000, high:16000, xhigh:24000, max:32000}`; valid effort → `cfg.thinking = {type:"enabled", budgetTokens}`; invalid/absent → untouched.

- [ ] **Step 1: Failing tests:**

```typescript
it("thread/start effort maps to thinking budget", () => {
  const opened: any[] = []; const srv = makeServer({ open: (cfg: any) => { opened.push(cfg); return fakeSession(); } });
  srv.handleRequest("thread/start", { cwd: "/w", approvalPolicy: "never", effort: "xhigh" }, 1);
  expect(opened[0].thinking).toEqual({ type: "enabled", budgetTokens: 24000 });
});
it("thread/start outputSchema maps to outputFormat json_schema", () => {   // only if probe verdict = wired
  const opened: any[] = []; const srv = makeServer({ open: (cfg: any) => { opened.push(cfg); return fakeSession(); } });
  srv.handleRequest("thread/start", { cwd: "/w", approvalPolicy: "never", outputSchema: { type: "object" } }, 1);
  expect(opened[0].outputFormat).toEqual({ type: "json_schema", schema: { type: "object" } });
});
```
Harness side (extend the resolveOptions unit test file): `resolveOptions({ outputFormat: { type: "json_schema", schema: {} } })` → `options.outputFormat` equals it.

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.** Harness (`types.ts`, near `thinking`): `outputFormat?: unknown;              // SDK OutputFormat ({type:'json_schema',schema}) — passthrough (probe 36)`. `resolveOptions.ts` (near the `thinking` line): `if (config.outputFormat) options.outputFormat = config.outputFormat;`. Rebuild harness (`npm run build` in `harness/`). App-server `handlers.ts` inside `buildCfg`:

```typescript
const EFFORT_BUDGETS: Record<string, number> = { low: 4000, medium: 10000, high: 16000, xhigh: 24000, max: 32000 };
// in buildCfg:
if (params.effort && EFFORT_BUDGETS[params.effort]) cfg.thinking = { type: "enabled", budgetTokens: EFFORT_BUDGETS[params.effort] };
if (params.outputSchema) cfg.outputFormat = { type: "json_schema", schema: params.outputSchema };
```
`protocol.ts`: `export interface ThreadStartParams { cwd: string; approvalPolicy?: string; sandbox?: string; model?: string; effort?: string; outputSchema?: Record<string, unknown>; dynamicTools?: DynamicToolSpec[] }`.

- [ ] **Step 4: Green** — harness `npm run typecheck` + unit; app-server `npx vitest run test/unit` + `npm run typecheck`. Run the FULL app-server suite (`npm test` minus live) once here to prove the Director contract still passes (backward-compat gate): `npx vitest run test/unit test/contract` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(cc-appserver): effort→thinking budget + outputSchema→SDK outputFormat (probe 36)"`

---

### Task 9: plugin — utility ports (`fs`, `process`, `prompts`)

**Files:**
- Create (copy from `codex-plugin-cc/plugins/codex/scripts/lib/`): `plugins/claude/scripts/lib/fs.mjs`, `process.mjs`, `prompts.mjs`
- Test: `tests/prompts.test.mjs`

**Interfaces:**
- Produces: whatever each source module exports, unchanged (they are provider-agnostic): `prompts.mjs` template interpolation (`{{VAR}}`), `process.mjs` `terminateProcessTree` + spawn helpers, `fs.mjs` fs helpers. Later tasks import them by these paths.

- [ ] **Step 1: Copy the three files verbatim** (`cp` from the blueprint). Read each; the only allowed edits are (a) removing imports of modules we do not port (if any), (b) renaming env-var string constants `CODEX_COMPANION_*` → `CLAUDE_COMPANION_*` if present in these three files (check with grep; `state`-related env vars are handled in Task 10).
- [ ] **Step 2: Write `tests/prompts.test.mjs`** — pin interpolation:

```js
import test from "node:test"; import assert from "node:assert/strict";
import { renderTemplate } from "../plugins/claude/scripts/lib/prompts.mjs";   // adjust to the real export name after reading the source
test("interpolates {{VARS}} and leaves unknown intact", () => {
  assert.equal(renderTemplate("a {{X}} b", { X: "1" }), "a 1 b");
});
```
(First read `prompts.mjs` to get the real export names; adjust the test to the actual API — do not rename the module's exports.)
- [ ] **Step 3: `npm test` → PASS.**
- [ ] **Step 4: Commit** — `git commit -m "feat(claude-plugin-codex): port fs/process/prompts utility modules"`

---

### Task 10: plugin — job store ports (`state`, `tracked-jobs`, `job-control`)

**Files:**
- Create (copy then edit): `plugins/claude/scripts/lib/state.mjs`, `tracked-jobs.mjs`, `job-control.mjs`
- Test: `tests/state.test.mjs`, `tests/jobs.test.mjs`

**Interfaces:**
- Produces (kept from the originals): `resolveStateDir(cwd)`, `loadState/saveState`, `generateJobId(prefix)`, `upsertJob`, `writeJobFile`, `getConfig/setConfig` (state.mjs); `createJobRecord`, `runTrackedJob(job, runner)`, `createJobProgressUpdater`, `appendLogLine/appendLogBlock` (tracked-jobs.mjs); `sortJobsNewestFirst`, `enrichJob`, `buildStatusSnapshot`, `buildSingleJobSnapshot`, `matchJobReference`, `resolveResultJob`, `resolveCancelableJob` (job-control.mjs).
- Exact edits (the port deltas):
  1. `state.mjs` state root: replace the `CLAUDE_PLUGIN_DATA` base with `process.env.CLAUDE_COMPANION_DATA ?? path.join(os.homedir(), ".codex", "claude-companion")` (keep the `<slug>-<sha256(realpath)[:16]>` scheme and `os.tmpdir()` fallback).
  2. Drop session scoping: remove `SESSION_ID_ENV` usage — `createJobRecord` no longer stamps `sessionId`; `filterJobsForCurrentSession` becomes the identity (delete it and its call sites in job-control; jobs are workspace-scoped by the state dir itself).
  3. Liveness: `createJobRecord` stamps `pid: process.pid` and `heartbeatAt: Date.now()`; the progress updater refreshes `heartbeatAt` on every write. Add to `job-control.mjs`:
```js
export function reconcileJobLiveness(job) {
  if (job.status !== "running" && job.status !== "queued") return job;
  try { process.kill(job.pid, 0); return job; }
  catch { return { ...job, status: "interrupted", interruptedAt: Date.now() }; }
}
```
  and apply it in `buildStatusSnapshot`/`buildSingleJobSnapshot`/`resolveResultJob` before classification (persist the flip with `upsertJob` so it sticks).
  4. Keep `MAX_JOBS = 50`. Rename any `codex`-branded strings in these modules to `claude` (kind labels live mostly in render — Task 13).

- [ ] **Step 1: Failing tests.** `tests/state.test.mjs`: state dir under a temp `CLAUDE_COMPANION_DATA`; `generateJobId("task").startsWith("task-")`; upsert+reload round-trip; prune >50. `tests/jobs.test.mjs`: `runTrackedJob` happy path writes `completed` + result; runner throw writes `failed`; `reconcileJobLiveness` flips a running job with a dead pid (use pid `999999`… pick `2**22-1` range unlikely-alive, or spawn+kill a real `sleep`) to `interrupted`, leaves own-pid running jobs alone.

```js
// tests/jobs.test.mjs (core cases)
import test from "node:test"; import assert from "node:assert/strict";
import os from "node:os"; import fs from "node:fs"; import path from "node:path";
process.env.CLAUDE_COMPANION_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "ccd-"));
const { resolveStateDir, upsertJob } = await import("../plugins/claude/scripts/lib/state.mjs");
const { createJobRecord, runTrackedJob } = await import("../plugins/claude/scripts/lib/tracked-jobs.mjs");
const { reconcileJobLiveness } = await import("../plugins/claude/scripts/lib/job-control.mjs");

test("runTrackedJob persists completed + result", async () => {
  const stateDir = resolveStateDir(process.cwd());
  const job = createJobRecord({ stateDir, kind: "task", prefix: "task" });
  const done = await runTrackedJob(job, async () => ({ rawOutput: "hi", rendered: "hi" }));
  assert.equal(done.status, "completed"); assert.equal(done.result.rawOutput, "hi");
});
test("dead pid running job reconciles to interrupted", () => {
  const j = { status: "running", pid: 4194303 };
  assert.equal(reconcileJobLiveness(j).status, "interrupted");
});
```
(Adjust `createJobRecord`/`runTrackedJob` call shapes to the real ported signatures after reading the sources — keep the originals' signatures, do not redesign them.)
- [ ] **Step 2: Run → FAIL** (modules missing).
- [ ] **Step 3: Copy the three sources, apply edits 1–4.** Read each fully first; keep everything else byte-identical where possible.
- [ ] **Step 4: `npm test` → PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat(claude-plugin-codex): port job store (workspace-scoped, pid-liveness, ~/.codex/claude-companion root)"`

---

### Task 11: plugin — `appserver-client.mjs`

The fresh, compact replacement for the original's `app-server.mjs`+`captureTurn` (our server's stream is far simpler: `thread/started`, `turn/started`, `item/started|completed`, `thread/tokenUsage/updated`, `turn/completed|failed`).

**Files:**
- Create: `plugins/claude/scripts/lib/appserver-client.mjs`
- Test: `tests/client.test.mjs` (drives the REAL `app-server/dist/bin.js` under `CC_APPSERVER_FAKE=1`)

**Interfaces:**
- Produces:
```js
export function resolveAppserverCommand(env = process.env)   // -> {command, args:[...]} | null  (env CLAUDE_COMPANION_APPSERVER split on spaces, else "cc-codex-appserver" if on PATH via which/where)
export async function spawnAppServer({ cwd, env, onStderr } = {})   // -> AppServerClient (spawned + initialized) ; throws Error("worker-not-found") when unresolvable
class AppServerClient {
  async threadStart({ cwd, model, effort, write, outputSchema }) // -> { threadId }
  async threadResume({ threadId, cwd, model, effort, write })    // -> { threadId }
  async runTurn({ threadId, prompt, onProgress })  // -> { status: "completed"|"failed", finalText, commentary: string[], usage|null, turnId }
  async interrupt({ threadId })                    // -> {}
  async accountRead()                              // -> { authenticated, method?, provider? }
  alive()                                          // boolean
  async close()                                    // kill child, settle pending
}
```
- `threadStart` wire params: `{cwd, model?, effort?, approvalPolicy:"never", sandbox: write ? "workspace-write" : "read-only", outputSchema?}`. Server→client requests are answered `-32601` (none are expected under `approvalPolicy:"never"` with no dynamicTools). `runTurn` resolves on `turn/completed`/`turn/failed` whose `turn.id` matches; `item/completed` `agentMessage` `phase:"final_answer"` → `finalText`, `"commentary"` → pushed + `onProgress(text)`; `thread/tokenUsage/updated` → `usage`. Child exit mid-turn → reject pending `runTurn`s with `Error("appserver exited: <code/signal>")`.

- [ ] **Step 1: Build the appserver** so the fake binary exists: `cd CC-to-SDK/app-server && npm run build`.
- [ ] **Step 2: Failing test** (`tests/client.test.mjs`):

```js
import test from "node:test"; import assert from "node:assert/strict";
import path from "node:path"; import { fileURLToPath } from "node:url";
const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../app-server/dist/bin.js");
const ENV = { ...process.env, CC_APPSERVER_FAKE: "1", CLAUDE_COMPANION_APPSERVER: `node ${BIN}` };
const { spawnAppServer, resolveAppserverCommand } = await import("../plugins/claude/scripts/lib/appserver-client.mjs");

test("resolveAppserverCommand: env split; null when nothing", () => {
  assert.deepEqual(resolveAppserverCommand({ CLAUDE_COMPANION_APPSERVER: `node ${BIN}`, PATH: "" }), { command: "node", args: [BIN] });
  assert.equal(resolveAppserverCommand({ PATH: "/nonexistent" }), null);
});
test("threadStart + runTurn against fake bin", async () => {
  const client = await spawnAppServer({ cwd: process.cwd(), env: ENV });
  const { threadId } = await client.threadStart({ cwd: process.cwd(), write: false });
  assert.match(threadId, /^thr_[0-9a-f]{8}$/);
  const progress = [];
  const turn = await client.runTurn({ threadId, prompt: "hello", onProgress: (t) => progress.push(t) });
  assert.equal(turn.status, "completed"); assert.equal(turn.finalText, "final text");
  await client.close();
});
test("interrupt settles a HANG turn as failed", async () => {
  const client = await spawnAppServer({ cwd: process.cwd(), env: ENV });
  const { threadId } = await client.threadStart({ cwd: process.cwd(), write: false });
  const turnP = client.runTurn({ threadId, prompt: "please HANG" });
  await new Promise((r) => setTimeout(r, 50));
  await client.interrupt({ threadId });
  assert.equal((await turnP).status, "failed");
  await client.close();
});
test("child death rejects pending turns", async () => {
  const client = await spawnAppServer({ cwd: process.cwd(), env: ENV });
  const { threadId } = await client.threadStart({ cwd: process.cwd(), write: false });
  const turnP = client.runTurn({ threadId, prompt: "please HANG" });
  await new Promise((r) => setTimeout(r, 50));
  client.child.kill("SIGKILL");
  await assert.rejects(turnP, /appserver exited/);
});
```

- [ ] **Step 3: Run → FAIL.**
- [ ] **Step 4: Implement** (~200 lines; the core):

```js
import { spawn, spawnSync } from "node:child_process";

export function resolveAppserverCommand(env = process.env) {
  const override = (env.CLAUDE_COMPANION_APPSERVER ?? "").trim();
  if (override) { const parts = override.split(/\s+/); return { command: parts[0], args: parts.slice(1) }; }
  const probe = spawnSync(process.platform === "win32" ? "where" : "which", ["cc-codex-appserver"], { env, encoding: "utf8" });
  if (probe.status === 0 && probe.stdout.trim()) return { command: "cc-codex-appserver", args: [] };
  return null;
}

export async function spawnAppServer({ cwd = process.cwd(), env = process.env, onStderr } = {}) {
  const cmd = resolveAppserverCommand(env);
  if (!cmd) { const e = new Error("worker-not-found"); e.code = "WORKER_NOT_FOUND"; throw e; }
  const child = spawn(cmd.command, [...cmd.args, "app-server"], { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
  const client = new AppServerClient(child, onStderr);
  await client._initialize();
  return client;
}

class AppServerClient {
  constructor(child, onStderr) {
    this.child = child; this.nextId = 1; this.pending = new Map(); this.turns = new Map(); this.buf = ""; this.exited = false;
    child.stdout.on("data", (c) => this._feed(c.toString()));
    child.stderr.on("data", (c) => onStderr?.(c.toString()));
    child.on("exit", (code, signal) => { this.exited = true;
      const err = new Error(`appserver exited: ${code ?? signal}`);
      for (const [, p] of this.pending) p.reject(err); this.pending.clear();
      for (const [, t] of this.turns) t.reject(err); this.turns.clear(); });
  }
  alive() { return !this.exited; }
  _send(obj) { this.child.stdin.write(JSON.stringify(obj) + "\n"); }
  _request(method, params) { const id = this.nextId++; return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this._send({ id, method, params }); }); }
  _feed(chunk) { this.buf += chunk; let nl; while ((nl = this.buf.indexOf("\n")) >= 0) { const line = this.buf.slice(0, nl).trim(); this.buf = this.buf.slice(nl + 1); if (line) this._dispatch(line); } }
  _dispatch(line) {
    let msg; try { msg = JSON.parse(line); } catch { return; }
    if (msg.method && msg.id !== undefined && msg.id !== null) return this._send({ id: msg.id, error: { code: -32601, message: "unsupported server request" } });
    if (msg.method) return this._onNotification(msg.method, msg.params ?? {});
    const p = this.pending.get(msg.id);
    if (p) { this.pending.delete(msg.id); msg.error ? p.reject(Object.assign(new Error(msg.error.message), { rpc: msg.error })) : p.resolve(msg.result); }
  }
  _onNotification(method, params) {
    const turnId = params?.turnId ?? params?.turn?.id;
    const t = turnId && this.turns.get(turnId); if (!t) return;
    if (method === "item/completed" && params.item?.type === "agentMessage") {
      if (params.item.phase === "final_answer") t.finalText = params.item.text;
      else { t.commentary.push(params.item.text); t.onProgress?.(params.item.text); }
    } else if (method === "thread/tokenUsage/updated") t.usage = params.tokenUsage?.total ?? null;
    else if (method === "turn/completed") t.resolveWith("completed");
    else if (method === "turn/failed") t.resolveWith("failed");
  }
  async _initialize() {
    await this._request("initialize", { clientInfo: { name: "claude-companion", title: "Claude Plugin", version: "0.1.0" } });
    this._send({ method: "initialized" });
  }
  async threadStart({ cwd, model, effort, write, outputSchema }) {
    const r = await this._request("thread/start", { cwd, model, effort, approvalPolicy: "never", sandbox: write ? "workspace-write" : "read-only", ...(outputSchema ? { outputSchema } : {}) });
    return { threadId: r.thread.id };
  }
  async threadResume({ threadId, cwd, model, effort, write }) {
    const r = await this._request("thread/resume", { threadId, cwd, model, effort, approvalPolicy: "never", sandbox: write ? "workspace-write" : "read-only" });
    return { threadId: r.thread.id };
  }
  runTurn({ threadId, prompt, onProgress }) {
    return new Promise((resolve, reject) => {
      this._request("turn/start", { threadId, input: [{ type: "text", text: prompt }] }).then((r) => {
        const turnId = r.turn.id;
        const t = { finalText: "", commentary: [], usage: null, onProgress, reject,
          resolveWith: (status) => { this.turns.delete(turnId); resolve({ status, finalText: t.finalText, commentary: t.commentary, usage: t.usage, turnId }); } };
        this.turns.set(turnId, t);
        if (r.turn.status && r.turn.status !== "inProgress") t.resolveWith(r.turn.status);
      }, reject);
    });
  }
  async interrupt({ threadId }) { return this._request("turn/interrupt", { threadId }); }
  async accountRead() { const r = await this._request("account/read", {}); return r.account ?? { authenticated: false }; }
  async close() { try { this.child.stdin.end(); } catch {} const done = new Promise((r) => this.child.once("exit", r)); const timer = setTimeout(() => this.child.kill("SIGKILL"), 2000); await done; clearTimeout(timer); }
}
```
Race note: `runTurn` registers the collector only after the `turn/start` reply; notifications for that turn cannot arrive earlier because the server replies before it starts the async turn (`handlers.ts:87` replies first). Keep this comment in the code.

- [ ] **Step 5: `npm test` → PASS.**
- [ ] **Step 6: Commit** — `git commit -m "feat(claude-plugin-codex): appserver client (spawn/discovery, v2-lite peer, runTurn/interrupt/accountRead)"`

---

### Task 12: plugin — companion core: dispatch + `rescue` + real MCP entry

**Files:**
- Create: `plugins/claude/scripts/lib/companion.mjs`
- Modify: `plugins/claude/scripts/claude-companion-mcp.mjs` (replace stub with real dispatch; keep `setup` minimal until Task 14)
- Test: `tests/companion.test.mjs`

**Interfaces:**
- Consumes: job store (Task 10 exports), `spawnAppServer`/`AppServerClient` (Task 11), `render` placeholder (until Task 13, rescue renders raw text).
- Produces from `companion.mjs`:
```js
export const MODEL_ALIASES = { opus: "claude-opus-4-8", sonnet: "claude-sonnet-5", haiku: "claude-haiku-4-5-20251001", fable: "claude-fable-5" };
export const VALID_EFFORTS = ["low", "medium", "high", "xhigh", "max"];
export function normalizeModel(m)   // alias→id; claude-* passthrough; else throws with guidance text
export function createCompanion({ cwd, env } = {})   // -> { tools: [...], dispose() } ; tools plug into mcp-stdio
```
Companion internals: lazy singleton `AppServerClient` (respawn if `!alive()`); `runningBackground` counter (cap 3 → new jobs persist `queued` with a note; simple in-process FIFO drains them); every tool handler catches `WORKER_NOT_FOUND` and returns the setup-guidance string:
```
Claude worker is not available. Install it with:
  npm install -g /Users/new/Documents/GitHub/codex_somersault/CC-to-SDK/app-server
or point CLAUDE_COMPANION_APPSERVER at a cc-codex-appserver binary, then call the setup tool.
```
- `rescue` tool schema:
```json
{ "type": "object", "required": ["prompt"], "additionalProperties": false, "properties": {
  "prompt": { "type": "string", "description": "The task for the Claude worker." },
  "model": { "type": "string", "description": "opus|sonnet|haiku|fable or a full claude-* model id." },
  "effort": { "type": "string", "enum": ["low", "medium", "high", "xhigh", "max"] },
  "write": { "type": "boolean", "description": "Allow file edits (workspace-write). Default true." },
  "resume": { "type": "boolean", "description": "Continue the latest rescue thread in this repo." },
  "fresh": { "type": "boolean", "description": "Force a new thread even if one is resumable." },
  "wait": { "type": "boolean", "description": "Run in the foreground and return the final output. Default false (background job)." },
  "cwd": { "type": "string", "description": "Workspace root override; defaults to the server cwd." } } }
```
- `rescue` behavior (mirrors `/codex:rescue` + the collapsed agent): resolve workspace (`args.cwd ?? process.cwd()`); resolve resume candidate = newest finished job with `jobClass:"task"` and a `threadId`; if candidate && !resume && !fresh → return the offer string (NO run):
```
A recent Claude rescue thread exists for this repo (job <id>, <age>). Call rescue again with resume:true to continue it, or fresh:true to start over. Ask the user if unsure.
```
  else create job (`prefix "task"`, `kind "task"`), thread = resume ? `threadResume` (stored threadId) : `threadStart` ({model: normalizeModel, effort, write: args.write ?? true}); background (default): fire `runTrackedJob` without awaiting, return `Started background job <id>. Poll with the status tool; fetch output with the result tool.`; `wait:true` → await and return rendered final text + `Continue in this thread later with rescue {resume:true}. (job <id>)`.

- [ ] **Step 1: Failing tests** (`tests/companion.test.mjs`; env pins `CC_APPSERVER_FAKE=1`, `CLAUDE_COMPANION_APPSERVER=node <BIN>`, temp `CLAUDE_COMPANION_DATA`):

```js
test("normalizeModel: aliases, passthrough, rejection", () => {
  assert.equal(normalizeModel("opus"), "claude-opus-4-8");
  assert.equal(normalizeModel("claude-sonnet-5"), "claude-sonnet-5");
  assert.throws(() => normalizeModel("gpt-5"), /opus\|sonnet\|haiku\|fable/);
});
test("rescue wait:true returns fake final text and persists completed job", async () => {
  const c = createCompanion({ cwd: tmpRepo, env: ENV });
  const text = await callTool(c, "rescue", { prompt: "do it", wait: true, fresh: true });
  assert.match(text, /final text/);
  const snap = buildStatusSnapshot(loadJobs(tmpRepo));
  assert.equal(snap.latestFinished.status, "completed");
});
test("rescue default backgrounds and status sees it complete", async () => { /* call without wait; poll job store until completed (fake is fast); assert 'background job' in reply */ });
test("rescue offers resume when a candidate exists and neither flag given", async () => { /* run one wait:true rescue; then plain rescue -> /resume:true/ offer, and no new job created */ });
test("worker missing -> setup guidance", async () => { const c = createCompanion({ cwd: tmpRepo, env: { PATH: "/none", CLAUDE_COMPANION_DATA: ENV.CLAUDE_COMPANION_DATA } }); assert.match(await callTool(c, "rescue", { prompt: "x", wait: true }), /not available/); });
```
(`callTool(c, name, args)` helper = find tool in `c.tools`, invoke `handler(args)`.)
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `companion.mjs`** per the Interfaces block. Keep it thin: tool defs + handlers only; job mechanics stay in the Task 10 modules; client mechanics in Task 11. Rewire `claude-companion-mcp.mjs`:

```js
import { createMcpServer, runMcpServer } from "./lib/mcp-stdio.mjs";
import { createCompanion } from "./lib/companion.mjs";
const companion = createCompanion();
const srv = createMcpServer({ name: "claude-companion", version: "0.1.0", tools: companion.tools });
runMcpServer(srv);
process.stdin.on("end", () => { void companion.dispose().finally(() => process.exit(0)); });
```
- [ ] **Step 4: `npm test` → PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat(claude-plugin-codex): companion dispatch + rescue (fg/bg, resume offer, worker guidance)"`

---

### Task 13: plugin — `git` + `render` ports, prompts, `review` + `adversarial_review`

**Files:**
- Create: `plugins/claude/scripts/lib/git.mjs` (port), `plugins/claude/scripts/lib/render.mjs` (port), `plugins/claude/prompts/claude-review.md` (new), `plugins/claude/prompts/adversarial-review.md` (port), `plugins/claude/schemas/review-output.schema.json` (copy verbatim)
- Modify: `plugins/claude/scripts/lib/companion.mjs` (two tools)
- Test: `tests/git.test.mjs`, `tests/render.test.mjs`, extend `tests/companion.test.mjs`

**Interfaces:**
- `git.mjs`: keep the original exports (`resolveReviewTarget(cwd, {base, scope})` → `{type:"uncommittedChanges"}|{type:"baseBranch",branch}` semantics + `collectReviewContext` with the inline-diff ≤2 files & ≤256KB rule). Port edits: none beyond branding strings.
- `render.mjs`: keep `parseStructuredOutput`, `normalizeReviewPayload`, `renderReviewResult` (severity-sorted findings-first), `renderStoredJobResult`, `renderStatusReport`. Port edits: every "Codex" label → "Claude"; replace the `codex resume <id>` affordance with `Continue via the rescue tool with resume:true (thread <threadId>).`; delete native-review-only rendering if it imports dropped modules.
- Review flows in `companion.mjs`:
  - `review` args `{base?, scope?, wait?, cwd?}`; `adversarial_review` adds `{focus?}`. Both: resolve target via `git.mjs`; collect context; build prompt (`claude-review.md` / `adversarial-review.md`) with `{{TARGET_LABEL}}, {{REVIEW_INPUT}}, {{USER_FOCUS}}, {{REVIEW_COLLECTION_GUIDANCE}}` interpolation; `threadStart({write:false, outputSchema: reviewSchema})` (omit `outputSchema` if probe 36 verdict was fallback — the prompts demand JSON regardless); `runTurn`; `parseStructuredOutput` → `renderReviewResult`, fallback to raw text. Job prefixes `review-` / `advrev-`. Background default like rescue.
- `prompts/claude-review.md` (new, full text):

```markdown
You are a senior code reviewer performing a neutral, evidence-based review.

<target>{{TARGET_LABEL}}</target>

<review_input>
{{REVIEW_INPUT}}
</review_input>

{{REVIEW_COLLECTION_GUIDANCE}}

Review the change for: correctness bugs, security issues, data loss, race conditions,
API misuse, and violations of the surrounding code's conventions. Read the actual files
when the diff alone is insufficient — you have read-only access to the repository.
Do not propose stylistic rewrites. Do not fix anything.

Output STRICTLY a single JSON object matching this schema (no prose before or after):
{"verdict":"approve"|"needs-attention","summary":"...","findings":[{"severity":"critical"|"high"|"medium"|"low","title":"...","body":"...","file":"path","line_start":1,"line_end":1,"confidence":0.0,"recommendation":"..."}],"next_steps":["..."]}
Findings must cite exact file:line. An empty findings array with verdict "approve" is a valid result.
```
- `prompts/adversarial-review.md`: copy the original and edit only branding/model references (it is already JSON-contract + `{{VAR}}`-driven); keep `{{USER_FOCUS}}`.

- [ ] **Step 1: Failing tests.** `tests/git.test.mjs`: port the relevant cases from `codex-plugin-cc/tests/git.test.mjs` (temp repo via `helpers.mjs` `initGitRepo`; dirty tree → uncommittedChanges; clean + base → baseBranch). `tests/render.test.mjs`: schema-valid payload → findings-first markdown with severities; malformed JSON → raw fallback; labels say "Claude". `tests/companion.test.mjs` additions: `review {wait:true}` on a dirty temp repo returns rendered output and persists a `review-` job (fake returns "final text" → non-JSON → raw fallback path asserted).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Port + implement** per Interfaces. Copy `schemas/review-output.schema.json` byte-identical.
- [ ] **Step 4: `npm test` → PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat(claude-plugin-codex): review + adversarial_review (git targeting, schema prompts, render port)"`

---

### Task 14: plugin — `status` / `result` / `cancel` / full `setup`

**Files:**
- Modify: `plugins/claude/scripts/lib/companion.mjs`
- Test: extend `tests/companion.test.mjs`

**Interfaces:**
- `status {job_id?, wait?, cwd?}` → no id: `renderStatusReport(buildStatusSnapshot(...))` markdown table (running + latest finished + recent, liveness-reconciled); with id: `buildSingleJobSnapshot`; `wait:true`: poll every 2000ms up to 240000ms until the job leaves `queued|running`.
- `result {job_id?, cwd?}` → `resolveResultJob` → `renderStoredJobResult` (structured review render preferred, else rawOutput) + the resume affordance line.
- `cancel {job_id?, cwd?}` → `resolveCancelableJob` (active in workspace; explicit id required if >1); call `client.interrupt({threadId})`; on RPC failure `client.close()` (respawn happens lazily) — then mark job `cancelled`, log "Cancelled by user."; other running jobs hit by the close are flipped by liveness reconciliation.
- `setup {enable_review_gate?, disable_review_gate?, cwd?}` → report: worker resolution (command line found or install guidance), worker handshake ok (spawn + `initialize` with 5s timeout), auth via `accountRead()` (`oauth-token` → "Claude subscription (OAuth) ✓"; `api-key` → "API key ✓ (note: shadows OAuth)"; `cli-login` → "CLI stored login ✓"; `authenticated:false` → guidance: `claude setup-token` or set `CLAUDE_CODE_OAUTH_TOKEN` / `ANTHROPIC_API_KEY` and whitelist them via env_vars), gate state from `getConfig().stopReviewGate`; toggles call `setConfig`.

- [ ] **Step 1: Failing tests:** status table lists a completed job; `status {job_id}` single view; `wait` returns early when job finishes (drive with a background fake rescue); result returns stored output + resume line; cancel on a HANG background rescue → job `cancelled` and turn settles; setup reports fake auth (`oauth-token` via fake accountInfo) and gate toggle round-trips (`enable` → setup output says enabled → `disable`).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** the four handlers (thin over Task 10/11 exports).
- [ ] **Step 4: `npm test` → PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat(claude-plugin-codex): status/result/cancel + full setup (worker, auth, review-gate toggle)"`

---

### Task 15: plugin — Stop review gate hook

**Files:**
- Create: `plugins/claude/scripts/stop-review-gate-hook.mjs`, `plugins/claude/prompts/stop-review-gate.md` (port)
- Modify: `plugins/claude/hooks/hooks.json` (replace the Task 2 probe), delete `plugins/claude/scripts/hook-probe.mjs`
- Test: `tests/stop-gate.test.mjs`

**Interfaces:**
- Consumes: Stop-hook stdin contract (Global Constraints; confirmed in `docs/host-facts.md`): `{cwd, last_assistant_message, stop_hook_active, ...}`. Gate config via `getConfig(stateDir).stopReviewGate`. Worker via `spawnAppServer` (hook runs unsandboxed with the full user env — no whitelist issue here).
- Produces: stdout `{"decision":"block","reason":"<review findings>"}` + exit 0 to block; plain exit 0 (no decision JSON) to allow. **Fail-open:** worker missing / spawn error / malformed gate output / self-timeout (840s) → allow, with `{"systemMessage":"claude stop-gate skipped: <why>"}` on stdout. Gate job recorded with prefix `gate-`, kind label "Claude Stop Gate Review".
- `prompts/stop-review-gate.md`: copy the original `stop-review-gate.md`; keep the exact output contract (first line `ALLOW: <reason>` or `BLOCK: <reason>`) and the `{{CLAUDE_RESPONSE_BLOCK}}` placeholder; edit only Codex-worker branding (the reviewED text is still a Claude Code/host response — here it is the **Codex host's** last message, so rename the placeholder context lines from "Claude's response" to "the assistant's response").
- `hooks/hooks.json` (final; command path mechanism per `docs/host-facts.md` — the literal below assumes plugin-root-relative resolution like `.mcp.json`; if host-facts recorded a different mechanism (env var / absolute cache path), use that instead and note it in the file):
```json
{ "hooks": { "Stop": [ { "hooks": [ { "type": "command", "command": "node \"./scripts/stop-review-gate-hook.mjs\"", "timeout": 900 } ] } ] } }
```

- [ ] **Step 1: Failing tests** (`tests/stop-gate.test.mjs`) — run the hook as a child process with scripted stdin (pattern from `codex-plugin-cc/tests/runtime.test.mjs`):

```js
// helper: runHook(inputObj, env) -> { stdout, code } via spawnSync("node", [HOOK], { input: JSON.stringify(inputObj), env })
test("gate disabled -> exit 0, no decision", ...);            // fresh state dir, no config
test("gate enabled + fake ALLOW -> exit 0, no block", ...);    // fake final text "final text" -> not BLOCK -> allow; assert stdout has no "decision":"block"
test("gate enabled + fake BLOCK -> decision block with reason", ...);  // point CLAUDE_COMPANION_APPSERVER at fake bin; make the gate prompt include a marker the fake echoes? — instead: extend _fake.ts in app-server: prompt containing "STOP-GATE-BLOCK" -> final text "BLOCK: fix the tests first" (add in this task, one line); prompt with "STOP-GATE-ALLOW" -> "ALLOW: fine". The hook injects last_assistant_message into the prompt, so the test sets last_assistant_message to "STOP-GATE-BLOCK" / "STOP-GATE-ALLOW".
test("worker missing -> allow with systemMessage", ...);       // PATH empty, no override
test("empty last_assistant_message -> allow", ...);
```
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement the hook:**

```js
import { getConfig, resolveStateDir } from "./lib/state.mjs";
import { createJobRecord, runTrackedJob } from "./lib/tracked-jobs.mjs";
import { renderTemplate } from "./lib/prompts.mjs";
import { spawnAppServer } from "./lib/appserver-client.mjs";
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";

const SELF_TIMEOUT_MS = 840_000;
function out(obj) { process.stdout.write(JSON.stringify(obj) + "\n"); }

let raw = ""; process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => { void main().catch((e) => { out({ systemMessage: `claude stop-gate skipped: ${e?.message ?? e}` }); process.exit(0); }); });

async function main() {
  const input = JSON.parse(raw || "{}");
  const cwd = input.cwd ?? process.cwd();
  const stateDir = resolveStateDir(cwd);
  if (!getConfig(stateDir)?.stopReviewGate) return process.exit(0);
  const msg = (input.last_assistant_message ?? "").trim();
  if (!msg) return process.exit(0);
  const tpl = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../prompts/stop-review-gate.md"), "utf8");
  const prompt = renderTemplate(tpl, { CLAUDE_RESPONSE_BLOCK: msg });
  const timer = setTimeout(() => { out({ systemMessage: "claude stop-gate skipped: timeout" }); process.exit(0); }, SELF_TIMEOUT_MS);
  const client = await spawnAppServer({ cwd });
  try {
    const { threadId } = await client.threadStart({ cwd, write: false });
    const job = createJobRecord({ stateDir, kind: "stop-gate", prefix: "gate" });
    const turn = await runTrackedJob(job, async () => { const t = await client.runTurn({ threadId, prompt }); return { rawOutput: t.finalText, rendered: t.finalText }; });
    const first = (turn.result?.rawOutput ?? "").split("\n")[0].trim();
    if (first.startsWith("BLOCK:")) { out({ decision: "block", reason: first.slice(6).trim() || "Stop-gate review found issues." }); }
    else if (!first.startsWith("ALLOW:")) out({ systemMessage: `claude stop-gate skipped: malformed gate output` });
  } finally { clearTimeout(timer); await client.close(); }
  process.exit(0);
}
```
(Adjust `createJobRecord`/`runTrackedJob` shapes to the real Task 10 signatures.) Add the two `_fake.ts` lines in app-server (`STOP-GATE-BLOCK`/`STOP-GATE-ALLOW` canned finals) + rebuild.
- [ ] **Step 4: `npm test` → PASS** (both packages: rerun app-server unit too after the `_fake.ts` touch).
- [ ] **Step 5: Live confirm on installed codex** — reinstall plugin (version bump + `codex plugin add claude@cc-claude`), enable the gate via `setup {enable_review_gate:true}` in a scratch repo, make a trivial code change through codex, observe one gate round (BLOCK feeds back / ALLOW passes). Record the observed behavior in `docs/host-facts.md`.
- [ ] **Step 6: Commit** — `git commit -m "feat(claude-plugin-codex): Stop review gate (block-with-reason, fail-open)"`

---

### Task 16: plugin — skills + README

**Files:**
- Create: `plugins/claude/skills/claude-delegation/SKILL.md`, `plugins/claude/skills/claude-prompting/SKILL.md`, `plugins/claude/skills/claude-prompting/references/claude-prompt-recipes.md`, `README.md`

**Interfaces:** none (docs/guidance). Frontmatter per `codex-rs/core-skills/src/loader.rs:38-52`: `name`, `description`, optional `metadata.short-description`.

- [ ] **Step 1: `claude-delegation/SKILL.md`** (full content — merge of the original `codex-cli-runtime` + `codex-result-handling` contracts, retargeted at MCP tools):

```markdown
---
name: claude-delegation
description: How to delegate tasks and reviews to Claude workers via the claude-companion tools (rescue, review, adversarial_review, status, result, cancel, setup), and how to present their results.
---

# Delegating to Claude workers

## Tool etiquette
- One `rescue` call per delegation. Do not decompose the user's request into multiple rescue calls; pass the whole task as `prompt`.
- Long tasks and reviews default to BACKGROUND: the tool returns a job id immediately. Poll with `status`, fetch with `result`. Use `wait:true` only for quick, small tasks the user is actively waiting on.
- If `rescue` returns a resume offer, relay the choice to the user unless their request already implies it (follow-up on the same problem → `resume:true`; clearly new work → `fresh:true`).
- `model` accepts opus | sonnet | haiku | fable or a full claude-* id. `effort` (low..max) controls thinking budget. Omit both to use the worker defaults.
- Rescue defaults to write access. Pass `write:false` when the user asks for investigation only.
- If any tool reports the worker is unavailable, run `setup` and relay its guidance verbatim.

## Presenting results
- Preserve the worker's verdict, findings, and next steps. Findings first, ordered by severity, with exact file:line references. Do not soften severities.
- CRITICAL: after `review` / `adversarial_review` findings, STOP. Never auto-apply fixes. Present the findings and ask the user how to proceed.
- When a result includes a thread reference, mention that the conversation can be continued with `rescue {resume:true}`.
```

- [ ] **Step 2: `claude-prompting/SKILL.md`** (full content):

```markdown
---
name: claude-prompting
description: How to write effective prompts for Claude workers dispatched via claude-companion — structure, grounding, and output contracts for Claude models (opus/sonnet/haiku/fable).
---

# Prompting Claude workers

Claude responds best to plain, well-scoped prose with explicit success criteria. Unlike
GPT-style block prompting, XML tag scaffolding is optional — use it for large inputs
(diffs, logs), not for the instructions themselves.

- Lead with the goal in one sentence, then constraints, then context.
- State the deliverable explicitly ("produce a minimal patch", "return a ranked list of causes").
- For investigation tasks: name the observable symptom, where it manifests, and what "explained" looks like.
- For fixes: define the smallest acceptable change and what must NOT change; ask for verification (run the tests) and to report what was run.
- For structured output: show the exact JSON shape and say "output strictly one JSON object, no prose".
- Give repo-relative paths; the worker starts in the workspace root with repo access.
- Do not stack roleplay or persona framing; a single role sentence ("You are a senior reviewer") is enough.

See references/claude-prompt-recipes.md for ready-made diagnosis / fix / review prompt shapes.
```

- [ ] **Step 3: `references/claude-prompt-recipes.md`** — three compact recipes (diagnosis, smallest-safe-fix, focused review), each a fill-in template mirroring the original recipes file's structure but Claude-toned. Write ~40 lines; base the section headings on `codex-plugin-cc/.../references/codex-prompt-recipes.md` (read it) with the antipattern notes folded in as one final section.
- [ ] **Step 4: `README.md`** — mirror the original README's structure: What You Get (7 tools), Requirements (Node ≥18.18, Claude Code login or token, `cc-codex-appserver` install line), Install (marketplace add path + `codex plugin add claude@cc-claude`), per-tool usage with examples, review-gate warning (usage-drain), FAQ (auth = your local Claude Code login; `env_vars` whitelist note for token users), Accepted divergences (background jobs die with the Codex session; jobs are workspace-scoped).
- [ ] **Step 5: Reinstall + smoke** — bump plugin version, `codex plugin add claude@cc-claude`, fresh thread: confirm both skills appear and `rescue` guidance behaves per skill.
- [ ] **Step 6: Commit** — `git commit -m "feat(claude-plugin-codex): delegation + prompting skills, README"`

---

### Task 17: contract test — full loop, key-free

**Files:**
- Create: `tests/contract.test.mjs`

**Interfaces:**
- Consumes: everything. Drives `scripts/claude-companion-mcp.mjs` as a real child over MCP stdio (JSON-RPC 2.0 lines), which drives the real `app-server/dist/bin.js` under `CC_APPSERVER_FAKE=1`.

- [ ] **Step 1: Write the test** — a tiny MCP client helper (spawn, send line, await response by id):

```js
// spawnCompanion(env) -> { call(method, params) -> Promise<result>, close() }
test("initialize/tools/list exposes the 7 tools", ...);
test("rescue(wait) -> status -> result round-trip", async () => {
  // rescue {prompt, wait:true, fresh:true} -> content text matches /final text/
  // status {} -> table mentions the completed task job id
  // result {} -> stored output "final text" + resume affordance
});
test("background rescue + cancel", async () => {
  // rescue {prompt:"please HANG"} -> job id; cancel {} -> cancelled; status shows cancelled
});
test("setup reports fake auth + gate toggle", ...);
```
Env: `CC_APPSERVER_FAKE:"1"`, `CLAUDE_COMPANION_APPSERVER: node <abs dist/bin.js>`, fresh temp `CLAUDE_COMPANION_DATA`, cwd = temp git repo (helpers.mjs).
- [ ] **Step 2: Run → make green** — fix whatever integration seams it flushes out (this is the task where cross-module drift surfaces; fix in place).
- [ ] **Step 3: Full plugin suite** `npm test` → PASS; app-server `npx vitest run test/unit test/contract` → PASS.
- [ ] **Step 4: Commit** — `git commit -m "test(claude-plugin-codex): key-free end-to-end contract (MCP → companion → fake appserver)"`

---

### Task 18: live test + docs fold-back + ship

**Files:**
- Create: `tests/live/live.test.mjs`
- Modify: `docs/superpowers/specs/2026-07-03-claude-plugin-codex-design.md` (fold V1–V5 answers), `CC-to-SDK/docs/parity/coverage.md` (note), memory

**Interfaces:** none new.

- [ ] **Step 1: `tests/live/live.test.mjs`** — gated (skip unless `ANTHROPIC_API_KEY || CLAUDE_CODE_OAUTH_TOKEN`); NOT matched by the default `npm test` glob (`tests/*.test.mjs` does not descend into `tests/live/`). Two cases against the REAL appserver (no `CC_APPSERVER_FAKE`): (a) `rescue {prompt:"Reply with exactly: pong", wait:true, fresh:true, write:false, effort:"low"}` → text contains "pong"; (b) `adversarial_review {wait:true}` in a temp repo with one seeded buggy uncommitted file → schema-parsed findings or the raw-fallback path, either accepted, assert non-empty output. Controller runs: `set -a; . ../.env; set +a; node --test tests/live/live.test.mjs`.
- [ ] **Step 2: Fold back into the spec** — §10 verification items get their answers (stop-hook contract, env whitelist + `env_vars`, cwd = workspace, 300s default/1200 shipped timeout, install loop result); §8 amended with the `env_vars` whitelist requirement; §6/§7 amended with: persistent `thr_<hex>` ids + sidecar, `outputSchema` rides `thread/start`, probe 36 verdict.
- [ ] **Step 3: `docs/parity/coverage.md`** — add the consumer note (claude-plugin-codex is a second wire consumer of cc-codex-appserver; appserver v0.2 methods listed).
- [ ] **Step 4: Memory** — write `claude-plugin-codex-shipped.md` (what shipped, the host facts, the fail-open gate decision, probe 36 verdict) + MEMORY.md index line.
- [ ] **Step 5: Final commit** — `git commit -m "feat(claude-plugin-codex): live tests, spec fold-back, coverage + memory refresh"`

---

## Self-Review (performed at write time)

- **Spec coverage:** §2 port/swap/drop → Tasks 9–13; §3/§4 layout+engine → Tasks 2, 11, 12; §5 tools → 12–14; §6 flows → 12–15; §7 appserver v0.2 → 3–8 (stretch item `commandExecution`/`fileChange` items is deliberately NOT scheduled — spec marks it non-blocking); §8 discovery/auth → 11, 14, plus `.mcp.json` env_vars (Task 2); §9 errors → 10 (liveness), 11 (child death), 12 (guidance), 14 (cancel fallback); §10 V1–V5 → Task 2 + Global Constraints source facts + Task 15 live confirm; §11 testing → 2,9–17 + 18(live); §12 divergences honored (background-first, fail-open gate, workspace scoping); §13 deferred items untouched; §14 → Task 18.
- **Type consistency:** `spawnAppServer`/`AppServerClient` shapes match between Tasks 11/12/15/17; job-store exports (Task 10) consumed by 12/14/15 under the originals' names; `recordThread/lookupThread` (Task 3) consumed by Task 4; `EFFORT_BUDGETS` values identical in Task 8 and Global Constraints.
- **Placeholders:** port tasks intentionally bind "keep the original's signatures — read the source first" rather than transcribing ~3000 lines of blueprint code; each port lists its exact deltas. Two deliberate late-bindings are contracts, not gaps: `docs/host-facts.md` (written Task 2, consumed Tasks 12/15) and the probe 36 verdict (Task 1, consumed Tasks 8/13).
