# Claude-backed Codex App-Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `cc-codex-appserver` — a drop-in replacement for `codex app-server` that speaks the Codex v2 JSON-RPC protocol over stdio but is backed by the Claude Agent SDK via the `cc-harness` `Session` engine, so the Director (`~/Documents/GitHub/agent-harness`) runs its workers on Claude unchanged.

**Architecture:** A new peer npm package `CC-to-SDK/app-server/` (sibling of `tui/`), depending on `cc-harness` via `file:../harness`. Data flows **engine → translator → peer**: a bidirectional JSON-RPC stdio peer dispatches client requests to handlers that drive one `cc-harness` `Session` per thread; a pure translator maps the SDK message stream into Codex notifications (`item/completed` agentMessage, `turn/completed`, `thread/tokenUsage/updated`). `dynamicTools` are executed server-side (report_outcome → `turn/completed.outcome`; linear_graphql → an in-process Linear MCP).

**Tech Stack:** TypeScript (ESM, NodeNext), `@anthropic-ai/claude-agent-sdk`, `cc-harness` (`openSession`, `createSdkMcpServer`/`tool`, `PermissionBroker`), `vitest`, `zod`.

**Spec:** `docs/superpowers/specs/2026-06-21-claude-codex-appserver-design.md` (read it; this plan implements it).

## Global Constraints

- **Protocol = Codex v2 JSON-RPC "lite":** every wire object is newline-delimited JSON with **no `"jsonrpc"` field**. Responses are `{id, result}` or `{id, error:{code,message}}`; notifications are `{method, params}`; server-initiated requests are `{id, method, params}`.
- **stdout is the protocol channel — NOTHING else may write to it.** ALL logging/diagnostics go to **stderr** (`console.error`). The Director `DEVNULL`s stderr, so log freely there. A stray `console.log` corrupts the wire.
- **The `engine → translator → peer` invariant:** nothing in `app-server/src/` is imported by `harness/`; `translator.ts` is pure (returns wire objects, never writes); the engine is reached only through the public `cc-harness` API (`openSession`, `Session`, `createPermissionGate`, types).
- **ESM:** import specifiers end in `.js` even though sources are `.ts` (`from "./peer.js"`); import `cc-harness` as the bare package name.
- **Dense hand-style, NO Prettier.** Match the surrounding `cc-harness` style (compact, multi-statement lines where natural). Do not reformat.
- **TDD:** failing test → red → minimal impl → green → `npm run typecheck`. Every behavior gets a `vitest` test that runs **without a network/key** (inject a fake `QueryFn`); live tests are gated and run by the controller.
- **Exact report_outcome schema** (from `agent-harness/director/worker/tools.py:42-77`): `status` enum `done|blocked|needs_human`, `reason` (string), `spawned_ticket_ids` (string[]), `pr_url`, `pr_branch` (strings), `checks_state` (string), `unresolved_threads` (int), `acceptance_verified` (bool). The emitted `turn/completed.outcome` carries `{status, reason, spawned_ticket_ids, pr_url, pr_branch, evidence?}` where `evidence = {checks_state?, unresolved_threads?, acceptance_verified?}` or omitted.
- **Decision mapping** (approvals): `accept`→`allow_once`, `acceptForSession`→`allow_always`, anything else (`decline`/`cancel`)→`deny`.
- **Posture mapping:** `approvals_reviewer=auto_review` present **or** `approvalPolicy:"never"` → `permissionMode:"auto"` (no broker). `approvalPolicy:"on-request"/"untrusted"` without auto_review → `permissionMode:"default"` + broker.
- **Run all package commands from `CC-to-SDK/app-server/`.** `cc-harness` must be built first (`harness/dist` exists; if not, run `npm run build` in `harness/`).

---

## File Structure

```
CC-to-SDK/app-server/
  package.json            # cc-harness-appserver; bin cc-codex-appserver -> dist/bin.js; dep cc-harness file:../harness
  tsconfig.json           # mirrors harness/tsconfig.json (NodeNext, strict)
  tsconfig.build.json     # outDir dist/, excludes test
  vitest.config.ts        # mirrors harness/vitest.config.ts
  src/
    protocol.ts           # wire envelope + param/result types + shape guards (isRequest/isNotification/isResponse)
    peer.ts               # bidirectional JSON-RPC stdio peer: line framing (feed), dispatch by shape, reply/notify/request
    translator.ts         # PURE: SDK message stream -> Codex notification objects (TurnTranslator)
    registry.ts           # threadId -> {session, turnSeq, usage}; mints thr_/turn_ ids; cumulative usage
    tools.ts              # report_outcome in-process MCP tool + OutcomeHolder; outcome capture
    linear.ts             # in-process Linear MCP (linear_graphql) authed by LINEAR_API_KEY (+ minimal guardrail)
    posture.ts            # approvalPolicy/sandbox/-c flags -> {permissionMode, roundTripApprovals}
    approvals.ts          # PermissionBroker that emits item/*requestApproval and awaits the decision
    handlers.ts           # initialize/initialized/thread/start/turn/start; wires peer+registry+translator+openSession
    bin.ts                # entrypoint: argv ignore, real stdio, real openSession, dispose on EOF/SIGTERM
  test/
    unit/*.test.ts        # DI fake QueryFn; no network
    contract/director-contract.test.ts  # spawn the built bin, drive the Director wire sequence
    live/appserver.e2e.test.ts          # gated (OAuth/API key); controller runs
  probes/ (in CC-to-SDK/probes/probes/) # A1 probe (Task 1)
```

---

## Task 1: A1 probe — real SDK turn message shapes

**Files:**
- Create: `CC-to-SDK/probes/probes/32-appserver-sdk-turn-shapes.ts`

**Interfaces:**
- Produces: a findings note (recorded in the task report) answering: the shape of an `assistant` text message (where the text lives in `message.content`), the `result` message fields (`result`, `subtype`, `is_error`, `usage`), and **whether `result.usage` is per-turn or cumulative across two turns of one session**. Task 4 (translator) and Task 5 (registry usage) consume these.

This is the live-probe-first grounding. The implementer writes the probe; **the controller runs it keyed** and records findings.

- [ ] **Step 1: Write the probe**

```ts
// probes/probes/32-appserver-sdk-turn-shapes.ts — A1 for the Codex app-server translator.
// Dumps the exact SDK message shapes for two turns of ONE session, so the translator maps
// real fields (assistant text location, result.result, result.usage per-turn-vs-cumulative).
// Run: set -a; . ../.env; set +a; unset ANTHROPIC_API_KEY; npx tsx probes/32-appserver-sdk-turn-shapes.ts
import { openSession } from "../../harness/dist/index.js";
(async () => {
  const s = openSession({ model: "claude-opus-4-8", permissionMode: "bypassPermissions" } as any);
  for (const prompt of ["Say the single word: one.", "Say the single word: two."]) {
    const types: string[] = [];
    const r = await s.submit(prompt, (m: any) => {
      types.push(`${m?.type}${m?.subtype ? "/" + m.subtype : ""}`);
      if (m?.type === "assistant") console.error("ASSISTANT:", JSON.stringify(m.message?.content)?.slice(0, 300));
    });
    console.error("RESULT:", JSON.stringify(r.result)?.slice(0, 300));
    console.error("FRAME TYPES:", types.join(" | "));
  }
  // Dump the SDK result message itself (usage lives there) by streaming one more turn raw.
  for await (const m of s.stream("Say the word: four.")) {
    const mm = m as any;
    if (mm?.type === "result") console.error("RESULT MSG:", JSON.stringify(mm).slice(0, 600));
  }
  await s.dispose();
})().catch((e) => { console.error("PROBE ERROR:", e); process.exit(1); });
```

- [ ] **Step 2: (Controller) run the probe keyed and record findings**

Run from `CC-to-SDK/probes/`: `set -a; . ../.env; set +a; unset ANTHROPIC_API_KEY; npx tsx probes/32-appserver-sdk-turn-shapes.ts`
Expected: stderr dumps for ASSISTANT content blocks, the RESULT string, and the RESULT MSG with `usage`. **Record in the task report:** (a) the JSON path to the assistant text (expected `message.content[].text` for `type:"text"` blocks), (b) the `result` message field for the final text (expected `result`), (c) the `result` message `usage` field names, (d) whether turn-2 `usage` totals are larger than turn-1 (cumulative) or similar (per-turn).

- [ ] **Step 3: Commit**

```bash
git add CC-to-SDK/probes/probes/32-appserver-sdk-turn-shapes.ts
git commit -m "probe(app-server): dump real SDK turn message shapes (A1 for translator)"
```

---

## Task 2: Package scaffold + protocol types

**Files:**
- Create: `CC-to-SDK/app-server/package.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`, `src/protocol.ts`
- Test: `CC-to-SDK/app-server/test/unit/protocol.test.ts`

**Interfaces:**
- Produces: `RpcRequest`, `RpcNotification`, `RpcResponse`, `RpcError`, `Incoming`; guards `isRequest`/`isNotification`/`isResponse`; param types `ThreadStartParams`, `TurnStartParams`, `DynamicToolSpec`, `Outcome`, `UsageTotals`.

- [ ] **Step 1: Create package files**

`package.json` (versions copied verbatim from `CC-to-SDK/harness/package.json` as of 2026-06-21 — keep them in lockstep with harness):

```json
{
  "name": "cc-harness-appserver",
  "version": "0.1.0",
  "type": "module",
  "bin": { "cc-codex-appserver": "dist/bin.js" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "build": "tsc -p tsconfig.build.json",
    "test:unit": "vitest run test/unit",
    "test": "vitest run"
  },
  "dependencies": {
    "cc-harness": "file:../harness",
    "@anthropic-ai/claude-agent-sdk": "^0.3.178",
    "zod": "^4.0.0"
  },
  "devDependencies": {
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "@types/node": "^22.0.0"
  }
}
```

`tsconfig.json` (copy `CC-to-SDK/harness/tsconfig.json` verbatim). `tsconfig.build.json`:

```json
{ "extends": "./tsconfig.json", "compilerOptions": { "outDir": "dist", "noEmit": false }, "include": ["src"], "exclude": ["test"] }
```

`vitest.config.ts` (copy `CC-to-SDK/harness/vitest.config.ts` verbatim).

- [ ] **Step 2: Write the failing test**

```ts
// test/unit/protocol.test.ts
import { describe, it, expect } from "vitest";
import { isRequest, isNotification, isResponse } from "../../src/protocol.js";

describe("protocol shape guards", () => {
  it("classifies the three wire shapes", () => {
    expect(isRequest({ id: 1, method: "thread/start", params: {} })).toBe(true);
    expect(isNotification({ method: "turn/completed", params: {} })).toBe(true);
    expect(isResponse({ id: 1, result: { ok: true } })).toBe(true);
    // a server-initiated request reply (response) is NOT a request:
    expect(isRequest({ id: 1, result: {} })).toBe(false);
    expect(isResponse({ id: 1, method: "x" })).toBe(false); // has method -> request, not response
  });
});
```

- [ ] **Step 3: Run it (red)** — `cd CC-to-SDK/app-server && npm install && npx vitest run test/unit/protocol.test.ts` → FAIL (module not found).

- [ ] **Step 4: Implement `src/protocol.ts`**

```ts
// Codex v2 JSON-RPC "lite": NDJSON, no "jsonrpc" field.
export interface RpcError { code: number; message: string; data?: unknown }
export interface RpcRequest { id: number | string; method: string; params?: unknown }
export interface RpcNotification { method: string; params?: unknown }
export interface RpcResponse { id: number | string; result?: unknown; error?: RpcError }
export type Incoming = RpcRequest | RpcNotification | RpcResponse;

export function isRequest(m: any): m is RpcRequest { return !!m && typeof m.method === "string" && m.id !== undefined && m.id !== null; }
export function isNotification(m: any): m is RpcNotification { return !!m && typeof m.method === "string" && (m.id === undefined || m.id === null); }
export function isResponse(m: any): m is RpcResponse { return !!m && typeof m.method !== "string" && m.id !== undefined && m.id !== null; }

export interface DynamicToolSpec { name: string; description?: string; inputSchema?: Record<string, unknown> }
export interface ThreadStartParams { cwd: string; approvalPolicy?: string; sandbox?: string; model?: string; dynamicTools?: DynamicToolSpec[] }
export interface TurnStartParams { threadId: string; input: Array<{ type: string; text?: string }>; cwd?: string; approvalPolicy?: string; sandboxPolicy?: unknown }
export interface Outcome { status: string; reason?: string; spawned_ticket_ids?: string[]; pr_url?: string; pr_branch?: string; evidence?: Record<string, unknown> }
export interface UsageTotals { totalTokens: number; inputTokens: number; outputTokens: number }

// JSON-RPC error codes used by the server.
export const ERR = { PARSE: -32700, INVALID_REQUEST: -32600, METHOD_NOT_FOUND: -32601, INVALID_PARAMS: -32602, INTERNAL: -32603 } as const;
```

- [ ] **Step 5: Run it (green)** — `npx vitest run test/unit/protocol.test.ts` → PASS. Then `npm run typecheck` → clean.

- [ ] **Step 6: Commit**

```bash
git add CC-to-SDK/app-server/package.json CC-to-SDK/app-server/tsconfig.json CC-to-SDK/app-server/tsconfig.build.json CC-to-SDK/app-server/vitest.config.ts CC-to-SDK/app-server/src/protocol.ts CC-to-SDK/app-server/test/unit/protocol.test.ts CC-to-SDK/app-server/package-lock.json
git commit -m "feat(app-server): package scaffold + protocol types"
```

---

## Task 3: JSON-RPC stdio peer

**Files:**
- Create: `CC-to-SDK/app-server/src/peer.ts`
- Test: `CC-to-SDK/app-server/test/unit/peer.test.ts`

**Interfaces:**
- Consumes: `protocol.ts` (`Incoming`, guards).
- Produces: `class Peer` with `constructor(sink: (obj: object) => void, onRequest: (method: string, params: any, id: number|string) => void, onNotification?: (method: string, params: any) => void)`; methods `feed(chunk: string | Buffer): void` (line-frames + dispatches), `reply(id, result)`, `replyError(id, code, message)`, `notify(method, params)`, `request(method, params): Promise<RpcResponse>`.

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/peer.test.ts
import { describe, it, expect } from "vitest";
import { Peer } from "../../src/peer.js";

function harness() {
  const out: any[] = [];
  const reqs: any[] = []; const notes: any[] = [];
  const peer = new Peer((o) => out.push(o), (m, p, id) => reqs.push({ m, p, id }), (m, p) => notes.push({ m, p }));
  return { out, reqs, notes, peer };
}

describe("Peer", () => {
  it("frames split chunks and dispatches a request", () => {
    const h = harness();
    h.peer.feed('{"id":1,"method":"thread/st');
    h.peer.feed('art","params":{"cwd":"/w"}}\n');
    expect(h.reqs).toEqual([{ m: "thread/start", p: { cwd: "/w" }, id: 1 }]);
  });
  it("dispatches a notification (no id)", () => {
    const h = harness();
    h.peer.feed('{"method":"initialized","params":{}}\n');
    expect(h.notes).toEqual([{ m: "initialized", p: {} }]);
  });
  it("correlates a response to an outgoing request", async () => {
    const h = harness();
    const p = h.peer.request("item/commandExecution/requestApproval", { command: ["ls"] });
    const sent = h.out.find((o) => o.method);                 // the outgoing request
    expect(sent.id).toBeDefined();
    h.peer.feed(JSON.stringify({ id: sent.id, result: { decision: "accept" } }) + "\n");
    expect(await p).toEqual({ id: sent.id, result: { decision: "accept" } });
  });
  it("reply/notify emit jsonrpc-lite objects (no jsonrpc field)", () => {
    const h = harness();
    h.peer.reply(7, { thread: { id: "thr_1" } });
    h.peer.notify("turn/completed", { turn: { id: "turn_1", status: "completed" } });
    expect(h.out[0]).toEqual({ id: 7, result: { thread: { id: "thr_1" } } });
    expect(h.out[1]).toEqual({ method: "turn/completed", params: { turn: { id: "turn_1", status: "completed" } } });
    expect("jsonrpc" in h.out[0]).toBe(false);
  });
});
```

- [ ] **Step 2: Run it (red)** — `npx vitest run test/unit/peer.test.ts` → FAIL.

- [ ] **Step 3: Implement `src/peer.ts`**

```ts
import { isRequest, isNotification, isResponse, type Incoming, type RpcResponse } from "./protocol.js";

export class Peer {
  private nextId = 1;
  private pending = new Map<number | string, (r: RpcResponse) => void>();
  private buf = "";
  constructor(
    private sink: (obj: object) => void,
    private onRequest: (method: string, params: any, id: number | string) => void,
    private onNotification?: (method: string, params: any) => void,
  ) {}

  feed(chunk: string | Buffer): void {
    this.buf += chunk.toString();
    let nl: number;
    while ((nl = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (!line) continue;
      let msg: Incoming;
      try { msg = JSON.parse(line); } catch { console.error("[appserver] bad json line:", line.slice(0, 200)); continue; }
      this.dispatch(msg);
    }
  }

  private dispatch(msg: Incoming): void {
    if (isResponse(msg)) { const r = this.pending.get((msg as any).id); if (r) { this.pending.delete((msg as any).id); r(msg as RpcResponse); } return; }
    if (isRequest(msg)) { this.onRequest(msg.method, (msg as any).params, msg.id); return; }
    if (isNotification(msg)) { this.onNotification?.(msg.method, (msg as any).params); return; }
  }

  reply(id: number | string, result: unknown): void { this.sink({ id, result }); }
  replyError(id: number | string, code: number, message: string): void { this.sink({ id, error: { code, message } }); }
  notify(method: string, params: unknown): void { this.sink({ method, params }); }
  request(method: string, params: unknown): Promise<RpcResponse> {
    const id = this.nextId++;
    return new Promise((resolve) => { this.pending.set(id, resolve); this.sink({ id, method, params }); });
  }
}
```

- [ ] **Step 4: Run it (green)** — `npx vitest run test/unit/peer.test.ts` → PASS. `npm run typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add CC-to-SDK/app-server/src/peer.ts CC-to-SDK/app-server/test/unit/peer.test.ts
git commit -m "feat(app-server): bidirectional JSON-RPC stdio peer (framing + dispatch + correlation)"
```

---

## Task 4: Translator (pure SDK→Codex)

**Files:**
- Create: `CC-to-SDK/app-server/src/translator.ts`
- Test: `CC-to-SDK/app-server/test/unit/translator.test.ts`

**Interfaces:**
- Consumes: `protocol.ts` (`Outcome`, `UsageTotals`). Task 1 findings (assistant text path, result fields).
- Produces: `extractAssistantText(m: any): string` ; `class TurnTranslator` with `constructor(threadId: string, turnId: string)`, `onMessage(m: any): object[]` (wire notifications for one streamed SDK message), `finalize(result: { text: string; isError: boolean; usage?: UsageTotals; outcome?: Outcome }): object[]`.

**Note for implementer:** if Task 1's findings show the assistant text path differs from `message.content[].text`, adjust `extractAssistantText` to match — that is the one probe-pinned spot.

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/translator.test.ts
import { describe, it, expect } from "vitest";
import { TurnTranslator, extractAssistantText } from "../../src/translator.js";

const asst = (text: string) => ({ type: "assistant", message: { content: [{ type: "text", text }] } });

describe("extractAssistantText", () => {
  it("pulls text blocks, ignores tool_use", () => {
    expect(extractAssistantText(asst("hi"))).toBe("hi");
    expect(extractAssistantText({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash" }] } })).toBe("");
  });
});

describe("TurnTranslator", () => {
  it("streams commentary, then a MANDATORY final_answer + tokenUsage + turn/completed", () => {
    const t = new TurnTranslator("thr_1", "turn_1");
    const a = t.onMessage(asst("working on it"));     // held, not emitted yet
    expect(a).toEqual([]);
    const fin = t.finalize({ text: "all done", isError: false, usage: { totalTokens: 100, inputTokens: 60, outputTokens: 40 } });
    // held commentary (!= final) flushes, then final_answer, then usage, then turn/completed
    expect(fin[0]).toMatchObject({ method: "item/completed", params: { item: { type: "agentMessage", text: "working on it", phase: "commentary" } } });
    expect(fin[1]).toMatchObject({ method: "item/completed", params: { item: { type: "agentMessage", text: "all done", phase: "final_answer" } } });
    expect(fin[2]).toMatchObject({ method: "thread/tokenUsage/updated", params: { tokenUsage: { total: { totalTokens: 100, inputTokens: 60, outputTokens: 40 } } } });
    expect(fin[3]).toMatchObject({ method: "turn/completed", params: { turn: { id: "turn_1", status: "completed" } } });
  });
  it("suppresses a duplicate when the last commentary equals the final text", () => {
    const t = new TurnTranslator("thr_1", "turn_1");
    t.onMessage(asst("the answer"));
    const fin = t.finalize({ text: "the answer", isError: false });
    const phases = fin.filter((o: any) => o.method === "item/completed").map((o: any) => o.params.item.phase);
    expect(phases).toEqual(["final_answer"]);                  // no duplicate commentary
  });
  it("attaches outcome to turn/completed when present", () => {
    const t = new TurnTranslator("thr_1", "turn_1");
    const fin = t.finalize({ text: "done", isError: false, outcome: { status: "done", reason: "ok" } });
    const tc: any = fin.find((o: any) => o.method === "turn/completed");
    expect(tc.params.outcome).toEqual({ status: "done", reason: "ok" });
  });
  it("maps an errored result to turn/failed", () => {
    const t = new TurnTranslator("thr_1", "turn_1");
    const fin = t.finalize({ text: "", isError: true });
    expect(fin).toEqual([{ method: "turn/failed", params: { turn: { id: "turn_1", status: "failed" } } }]);
  });
});
```

- [ ] **Step 2: Run it (red)** — `npx vitest run test/unit/translator.test.ts` → FAIL.

- [ ] **Step 3: Implement `src/translator.ts`**

```ts
import type { Outcome, UsageTotals } from "./protocol.js";

/** Pull the concatenated text of an SDK assistant message; "" if it carries no text block.
 *  Probe-pinned (Task 1): text lives at message.content[] entries with type==="text". */
export function extractAssistantText(m: any): string {
  if (m?.type !== "assistant") return "";
  const content = m?.message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((b: any) => b?.type === "text" && typeof b.text === "string").map((b: any) => b.text).join("");
}

export class TurnTranslator {
  private itemN = 0;
  private held: string | undefined;     // last assistant text, not yet emitted (buffered to suppress dup of final)
  constructor(private threadId: string, private turnId: string) {}

  private nextItem(): string { return `item_${this.turnId}_${++this.itemN}`; }
  private agentMessage(text: string, phase: "commentary" | "final_answer"): object {
    return { method: "item/completed", params: { itemId: this.nextItem(), threadId: this.threadId, turnId: this.turnId, item: { type: "agentMessage", text, phase } } };
  }

  /** Wire notifications for ONE streamed (non-result) SDK message. */
  onMessage(m: any): object[] {
    const out: object[] = [];
    const text = extractAssistantText(m);
    if (text) { if (this.held !== undefined) out.push(this.agentMessage(this.held, "commentary")); this.held = text; }
    return out;
  }

  /** Terminal notifications. The final_answer agentMessage is MANDATORY (the Director's primary signal). */
  finalize(result: { text: string; isError: boolean; usage?: UsageTotals; outcome?: Outcome }): object[] {
    if (result.isError) return [{ method: "turn/failed", params: { turn: { id: this.turnId, status: "failed" } } }];
    const out: object[] = [];
    const finalText = result.text || this.held || "";
    if (this.held !== undefined && this.held !== finalText) out.push(this.agentMessage(this.held, "commentary"));
    out.push(this.agentMessage(finalText, "final_answer"));
    if (result.usage) out.push({ method: "thread/tokenUsage/updated", params: { threadId: this.threadId, turnId: this.turnId, tokenUsage: { total: { totalTokens: result.usage.totalTokens, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens } } } });
    const params: any = { turn: { id: this.turnId, status: "completed" } };
    if (result.outcome) params.outcome = result.outcome;
    out.push({ method: "turn/completed", params });
    return out;
  }
}
```

- [ ] **Step 4: Run it (green)** — `npx vitest run test/unit/translator.test.ts` → PASS. `npm run typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add CC-to-SDK/app-server/src/translator.ts CC-to-SDK/app-server/test/unit/translator.test.ts
git commit -m "feat(app-server): pure SDK->Codex turn translator (commentary/final_answer/usage/outcome)"
```

---

## Task 5: Registry + handlers (happy-path drop-in)

**Files:**
- Create: `CC-to-SDK/app-server/src/registry.ts`, `CC-to-SDK/app-server/src/handlers.ts`
- Test: `CC-to-SDK/app-server/test/unit/handlers.test.ts`

**Interfaces:**
- Consumes: `peer.ts` (`Peer`), `translator.ts` (`TurnTranslator`), `protocol.ts`, `cc-harness` (`openSession`, `Session`).
- Produces:
  - `registry.ts`: `interface ThreadEntry { session: Session; turnSeq: number }`; `class Registry { newThread(session): { id: string }; get(id): ThreadEntry | undefined; nextTurnId(id): string; disposeAll(): Promise<void> }`. **No usage accumulation** — `session.usage()` is already cumulative per session (probe 32), so the handler emits the latest absolute value each turn.
  - `handlers.ts`: `interface OpenFn { (cfg: any): Session }`; `function toUsageTotals(u: any): UsageTotals` (parses the probe-32 shape — see below); `class AppServer { constructor(peer: Peer, deps?: { open?: OpenFn }); handleRequest(method, params, id): void }`. Wires initialize/initialized/thread/start/turn/start. The `initialize` result includes `capabilities: { outcomeOnTurnCompleted: true }`.

**Probe-32 findings (authoritative for this task):** `session.usage()` → `{ session: { model_usage: { "<model>": { inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens, … } } } }`, **cumulative across the session's turns**. So `toUsageTotals` sums across model entries and the handler emits the latest absolute total each turn (the Director keeps the latest as the ticket total — §6.2). Assistant text is in `message.content[]` `{type:"text"}` blocks (interleaved `{type:"thinking"}` blocks ignored — `extractAssistantText` already does this); `result` resolves to the final text string.

- [ ] **Step 1: Write the failing test** (drives the full happy path with a fake `QueryFn` → fake `Session`)

```ts
// test/unit/handlers.test.ts
import { describe, it, expect } from "vitest";
import { Peer } from "../../src/peer.js";
import { AppServer } from "../../src/handlers.js";

// A fake Session whose submit() streams one assistant message then resolves with a result string.
function fakeSession() {
  return {
    submit: async (_p: string, onMessage: (m: any) => void) => {
      onMessage({ type: "assistant", message: { content: [{ type: "text", text: "thinking" }] } });
      return { result: "final text" };
    },
    usage: async () => ({ input_tokens: 60, output_tokens: 40 }),
    dispose: async () => {},
  } as any;
}

function wire() {
  const out: any[] = [];
  const peer = new Peer((o) => out.push(o), (m, p, id) => server.handleRequest(m, p, id), () => {});
  const server = new AppServer(peer, { open: () => fakeSession() });
  return { out, peer };
}

describe("AppServer happy path", () => {
  it("initialize advertises the outcome capability", () => {
    const { out, peer } = wire();
    peer.feed(JSON.stringify({ id: 1, method: "initialize", params: { capabilities: {} } }) + "\n");
    expect(out[0]).toMatchObject({ id: 1, result: { capabilities: { outcomeOnTurnCompleted: true } } });
  });
  it("thread/start returns {thread:{id}} and turn/start streams to a MANDATORY final_answer + turn/completed", async () => {
    const { out, peer } = wire();
    peer.feed(JSON.stringify({ id: 1, method: "initialize", params: {} }) + "\n");
    peer.feed(JSON.stringify({ method: "initialized", params: {} }) + "\n");
    peer.feed(JSON.stringify({ id: 2, method: "thread/start", params: { cwd: "/w" } }) + "\n");
    const tsResp = out.find((o) => o.id === 2);
    const threadId = tsResp.result.thread.id;
    expect(typeof threadId).toBe("string");
    peer.feed(JSON.stringify({ id: 3, method: "turn/start", params: { threadId, input: [{ type: "text", text: "go" }], cwd: "/w" } }) + "\n");
    await new Promise((r) => setTimeout(r, 10));               // let the async turn drain
    const turnResp = out.find((o) => o.id === 3);
    expect(turnResp.result.turn.id).toBeDefined();
    const methods = out.filter((o) => o.method).map((o) => o.method);
    expect(methods).toContain("turn/started");
    const finalAnswer = out.find((o) => o.method === "item/completed" && o.params?.item?.phase === "final_answer");
    expect(finalAnswer.params.item.text).toBe("final text");
    expect(methods).toContain("turn/completed");
  });
});
```

- [ ] **Step 2: Run it (red)** — `npx vitest run test/unit/handlers.test.ts` → FAIL.

- [ ] **Step 3: Implement `src/registry.ts`**

```ts
import type { Session } from "cc-harness";

export interface ThreadEntry { session: Session; turnSeq: number }

export class Registry {
  private threads = new Map<string, ThreadEntry>();
  private threadN = 0;
  newThread(session: Session): { id: string } {
    const id = `thr_${++this.threadN}`;
    this.threads.set(id, { session, turnSeq: 0 });
    return { id };
  }
  get(id: string): ThreadEntry | undefined { return this.threads.get(id); }
  nextTurnId(id: string): string { const e = this.threads.get(id); if (!e) throw new Error(`unknown thread ${id}`); return `turn_${id}_${++e.turnSeq}`; }
  async disposeAll(): Promise<void> { for (const e of this.threads.values()) { try { await e.session.dispose(); } catch {} } this.threads.clear(); }
}
```
(`session.usage()` is cumulative per session — no per-thread accumulation needed; the handler emits the latest absolute value.)

- [ ] **Step 4: Implement `src/handlers.ts`** (happy path; posture/outcome/approvals are wired in later tasks)

```ts
import { openSession, type Session } from "cc-harness";
import { Peer } from "./peer.js";
import { Registry } from "./registry.js";
import { TurnTranslator } from "./translator.js";
import { ERR, type ThreadStartParams, type TurnStartParams, type UsageTotals } from "./protocol.js";

export interface OpenFn { (cfg: any): Session }

/** Sum the CUMULATIVE per-model token usage from session.usage() (probe 32 shape) into absolute UsageTotals.
 *  inputTokens folds in cached input (cacheRead+cacheCreation) for a meaningful total. Lenient: missing -> 0. */
export function toUsageTotals(u: any): UsageTotals {
  const n = (v: any) => (typeof v === "number" ? v : 0);
  const models = u?.session?.model_usage ?? {};
  let input = 0, output = 0;
  for (const k of Object.keys(models)) {
    const m = models[k];
    input += n(m?.inputTokens) + n(m?.cacheReadInputTokens) + n(m?.cacheCreationInputTokens);
    output += n(m?.outputTokens);
  }
  return { inputTokens: input, outputTokens: output, totalTokens: input + output };
}

export class AppServer {
  private reg = new Registry();
  private open: OpenFn;
  constructor(private peer: Peer, deps: { open?: OpenFn } = {}) { this.open = deps.open ?? ((cfg) => openSession(cfg)); }

  handleRequest(method: string, params: any, id: number | string): void {
    switch (method) {
      case "initialize": return this.peer.reply(id, { userAgent: "cc-codex-appserver", platformOs: process.platform, capabilities: { outcomeOnTurnCompleted: true } });
      case "thread/start": return this.threadStart(params as ThreadStartParams, id);
      case "turn/start": return this.turnStart(params as TurnStartParams, id);
      default: console.error("[appserver] unhandled method:", method); return this.peer.replyError(id, ERR.METHOD_NOT_FOUND, `method not found: ${method}`);
    }
  }
  // initialized is a notification — handled by the bin's onNotification (noop). Kept here for clarity.

  private threadStart(params: ThreadStartParams, id: number | string): void {
    const session = this.open({ cwd: params.cwd, model: params.model, permissionMode: "auto" });
    const { id: threadId } = this.reg.newThread(session);
    this.peer.reply(id, { thread: { id: threadId } });
    this.peer.notify("thread/started", { thread: { id: threadId } });
  }

  private turnStart(params: TurnStartParams, id: number | string): void {
    const entry = this.reg.get(params.threadId);
    if (!entry) return this.peer.replyError(id, ERR.INVALID_PARAMS, `unknown thread ${params.threadId}`);
    const turnId = this.reg.nextTurnId(params.threadId);
    this.peer.reply(id, { turn: { id: turnId, status: "inProgress" } });
    this.peer.notify("turn/started", { turn: { id: turnId } });
    const text = (params.input ?? []).map((p) => p.text ?? "").join("");
    const tr = new TurnTranslator(params.threadId, turnId);
    void this.runTurn(entry, text, tr);
  }

  private async runTurn(entry: { session: Session }, text: string, tr: TurnTranslator): Promise<void> {
    try {
      const { result } = await entry.session.submit(text, (m) => { for (const o of tr.onMessage(m)) this.peer.notify((o as any).method, (o as any).params); });
      let usage: UsageTotals | undefined;
      try { usage = toUsageTotals(await entry.session.usage()); } catch { /* telemetry only — usage() is cumulative per session */ }
      for (const o of tr.finalize({ text: String(result ?? ""), isError: false, usage })) this.peer.notify((o as any).method, (o as any).params);
    } catch (e) {
      console.error("[appserver] turn error:", (e as Error).message);
      for (const o of tr.finalize({ text: "", isError: true })) this.peer.notify((o as any).method, (o as any).params);
    }
  }
}
```

- [ ] **Step 5: Run it (green)** — `npx vitest run test/unit/handlers.test.ts` → PASS. `npm run typecheck` → clean.

- [ ] **Step 6: Commit**

```bash
git add CC-to-SDK/app-server/src/registry.ts CC-to-SDK/app-server/src/handlers.ts CC-to-SDK/app-server/test/unit/handlers.test.ts
git commit -m "feat(app-server): registry + handlers — happy-path drop-in (initialize/thread/turn)"
```

---

## Task 6: report_outcome → `turn/completed.outcome`

**Files:**
- Create: `CC-to-SDK/app-server/src/tools.ts`
- Modify: `CC-to-SDK/app-server/src/handlers.ts` (wire the report_outcome MCP server into `thread/start`; pass the captured outcome into `finalize`)
- Test: `CC-to-SDK/app-server/test/unit/tools.test.ts`, extend `handlers.test.ts`

**Interfaces:**
- Consumes: `cc-harness` (`createSdkMcpServer`/`tool` are re-exported by `@anthropic-ai/claude-agent-sdk`; import them from there), `protocol.ts` (`Outcome`).
- Produces: `tools.ts`: `const REPORT_OUTCOME_TOOL_ID = "mcp__cc-appserver__report_outcome"`; `interface OutcomeHolder { outcome?: Outcome }`; `buildReportOutcomeServer(holder: OutcomeHolder)` (returns an SDK MCP server); `withReportOutcome(cfg: any, holder: OutcomeHolder): any` (merges the server + allowlists the tool, mirroring `withContextTool`). The registry entry gains a per-thread `OutcomeHolder`, reset per turn, read by `finalize`.

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/tools.test.ts
import { describe, it, expect } from "vitest";
import { buildReportOutcomeServer, withReportOutcome, REPORT_OUTCOME_TOOL_ID } from "../../src/tools.js";

describe("report_outcome tool", () => {
  it("captures structured args into the holder and returns success", async () => {
    const holder: any = {};
    const server: any = buildReportOutcomeServer(holder);
    // the SDK server exposes its tools; find the report_outcome handler and call it.
    const tool = server.tools?.find?.((t: any) => t.name === "report_outcome") ?? server.instance?.tools?.[0];
    const res = await tool.handler({ status: "done", reason: "ok", pr_url: "http://x", unresolved_threads: 0 }, {});
    expect(holder.outcome).toMatchObject({ status: "done", reason: "ok", pr_url: "http://x", evidence: { unresolved_threads: 0 } });
    expect(res.content[0].text).toContain("recorded");
  });
  it("withReportOutcome merges the server and allowlists the tool id", () => {
    const holder: any = {};
    const cfg = withReportOutcome({ allowedTools: ["X"] }, holder);
    expect(cfg.allowedTools).toContain(REPORT_OUTCOME_TOOL_ID);
    expect(cfg.mcpServers["cc-appserver"]).toBeDefined();
  });
});
```

> **Implementer note:** the exact way to reach a tool's handler off an `createSdkMcpServer` return may differ by SDK version. If `server.tools` isn't the shape, factor the tool array out of `buildReportOutcomeServer` into an exported `buildReportOutcomeTools(holder)` (mirroring `buildContextTools` in `harness/src/context/server.ts:25`) and test that array directly — adjust the test's first line accordingly.

- [ ] **Step 2: Run it (red)** — FAIL.

- [ ] **Step 3: Implement `src/tools.ts`**

```ts
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { Outcome } from "./protocol.js";

export const REPORT_OUTCOME_TOOL_ID = "mcp__cc-appserver__report_outcome";
export interface OutcomeHolder { outcome?: Outcome }

const DESC = "Report the TERMINAL outcome of your work on THIS ticket. Call it exactly once, only when work truly ends: " +
  "status=done when complete; status=blocked when you cannot proceed and have filed follow-up tickets (ids in spawned_ticket_ids); " +
  "status=needs_human when a product/taste decision is required. Do NOT call it to ask whether to continue.";

/** Exported for direct handler testing (mirrors buildContextTools). */
export function buildReportOutcomeTools(holder: OutcomeHolder) {
  return [
    tool("report_outcome", DESC, {
      status: z.enum(["done", "blocked", "needs_human"]),
      reason: z.string(),
      spawned_ticket_ids: z.array(z.string()).optional(),
      pr_url: z.string().optional(),
      pr_branch: z.string().optional(),
      checks_state: z.string().optional(),
      unresolved_threads: z.number().optional(),
      acceptance_verified: z.boolean().optional(),
    }, async (args: any) => {
      const evidence: Record<string, unknown> = {};
      for (const k of ["checks_state", "unresolved_threads", "acceptance_verified"]) if (args[k] !== undefined) evidence[k] = args[k];
      holder.outcome = { status: args.status, reason: args.reason, spawned_ticket_ids: args.spawned_ticket_ids ?? [], pr_url: args.pr_url, pr_branch: args.pr_branch, evidence: Object.keys(evidence).length ? evidence : undefined };
      return { content: [{ type: "text" as const, text: "outcome recorded" }] };
    }),
  ];
}

export function buildReportOutcomeServer(holder: OutcomeHolder) {
  return createSdkMcpServer({ name: "cc-appserver", version: "0.1.0", tools: buildReportOutcomeTools(holder) });
}

/** COPY of cfg with the report_outcome server + allowed tool merged (never mutates; mirrors withContextTool). */
export function withReportOutcome(cfg: any, holder: OutcomeHolder): any {
  const existing = (cfg.mcpServers as Record<string, unknown> | undefined) ?? {};
  const allowed = (cfg.allowedTools as string[] | undefined) ?? [];
  return { ...cfg, mcpServers: { ...existing, "cc-appserver": buildReportOutcomeServer(holder) }, allowedTools: [...new Set([...allowed, REPORT_OUTCOME_TOOL_ID])] };
}
```

- [ ] **Step 4: Wire into `handlers.ts`** — give each thread an `OutcomeHolder`, reset per turn, fed to `finalize`. **Clean seam: `OpenFn` gains a second arg `holder` (production ignores it; the fake uses it to simulate a `report_outcome` call) — no opaque-SDK-server extraction.**
  - Change `OpenFn` to `(cfg: any, holder: OutcomeHolder) => Session`; the default becomes `(cfg) => openSession(cfg)` (it simply ignores the extra arg).
  - In `Registry.ThreadEntry` add `outcome: OutcomeHolder`; in `newThread(session)` init `outcome: {}`.
  - In `threadStart`: `const entry holder` flow:
    ```ts
    const holder: OutcomeHolder = {};
    const cfg = withReportOutcome({ cwd: params.cwd, model: params.model, permissionMode: "auto" }, holder);
    const session = this.open(cfg, holder);
    const { id: threadId } = this.reg.newThread(session);
    this.reg.get(threadId)!.outcome = holder;   // share the SAME holder the report_outcome tool closes over
    ```
  - In `turnStart`/`runTurn`: at turn start `entry.outcome.outcome = undefined`; pass `outcome: entry.outcome.outcome` into `tr.finalize({ text, isError: false, usage, outcome: entry.outcome.outcome })`.

  Add the integration test (the fake `open` receives the holder and populates it — exactly what the real `report_outcome` tool would do):

```ts
// add to test/unit/handlers.test.ts — outcome rides turn/completed
import { Peer } from "../../src/peer.js";
import { AppServer } from "../../src/handlers.js";

it("attaches a captured report_outcome to turn/completed.outcome", async () => {
  const out: any[] = [];
  const fakeOpen = (_cfg: any, holder: any) => ({
    submit: async (prompt: string, onMessage: (m: any) => void) => {
      onMessage({ type: "assistant", message: { content: [{ type: "text", text: "working" }] } });
      if (prompt.includes("REPORT")) holder.outcome = { status: "done", reason: "ok" };  // the tool would do this
      return { result: "done" };
    },
    usage: async () => ({}), dispose: async () => {},
  } as any);
  let server!: AppServer;
  const peer = new Peer((o) => out.push(o), (m, p, id) => server.handleRequest(m, p, id), () => {});
  server = new AppServer(peer, { open: fakeOpen });
  peer.feed(JSON.stringify({ id: 1, method: "initialize", params: {} }) + "\n");
  peer.feed(JSON.stringify({ id: 2, method: "thread/start", params: { cwd: "/w" } }) + "\n");
  const threadId = out.find((o) => o.id === 2).result.thread.id;
  peer.feed(JSON.stringify({ id: 3, method: "turn/start", params: { threadId, input: [{ type: "text", text: "REPORT" }], cwd: "/w" } }) + "\n");
  await new Promise((r) => setTimeout(r, 10));
  const tc = out.find((o) => o.method === "turn/completed");
  expect(tc.params.outcome).toEqual({ status: "done", reason: "ok" });
});
```

- [ ] **Step 5: Run it (green)** — `npx vitest run test/unit/tools.test.ts test/unit/handlers.test.ts` → PASS. `npm run typecheck` → clean.

- [ ] **Step 6: Commit**

```bash
git add CC-to-SDK/app-server/src/tools.ts CC-to-SDK/app-server/src/handlers.ts CC-to-SDK/app-server/src/registry.ts CC-to-SDK/app-server/test/unit/tools.test.ts CC-to-SDK/app-server/test/unit/handlers.test.ts
git commit -m "feat(app-server): report_outcome MCP tool -> turn/completed.outcome"
```

---

## Task 7: Posture mapping

**Files:**
- Create: `CC-to-SDK/app-server/src/posture.ts`
- Modify: `CC-to-SDK/app-server/src/handlers.ts` (use posture for `permissionMode`), `src/bin.ts` later passes the parsed `-c` flags
- Test: `CC-to-SDK/app-server/test/unit/posture.test.ts`

**Interfaces:**
- Produces: `interface Posture { permissionMode: "auto" | "default"; roundTripApprovals: boolean }`; `resolvePosture(args: { approvalPolicy?: string; autoReview: boolean }): Posture`. `parseConfigFlags(argv: string[]): { autoReview: boolean }` (reads `-c approvals_reviewer=auto_review`).

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/posture.test.ts
import { describe, it, expect } from "vitest";
import { resolvePosture, parseConfigFlags } from "../../src/posture.js";

describe("posture", () => {
  it("auto_review or approvalPolicy:never -> auto, no round-trip", () => {
    expect(resolvePosture({ approvalPolicy: "on-request", autoReview: true })).toEqual({ permissionMode: "auto", roundTripApprovals: false });
    expect(resolvePosture({ approvalPolicy: "never", autoReview: false })).toEqual({ permissionMode: "auto", roundTripApprovals: false });
  });
  it("on-request without auto_review -> default + broker", () => {
    expect(resolvePosture({ approvalPolicy: "on-request", autoReview: false })).toEqual({ permissionMode: "default", roundTripApprovals: true });
    expect(resolvePosture({ approvalPolicy: "untrusted", autoReview: false })).toEqual({ permissionMode: "default", roundTripApprovals: true });
  });
  it("parses -c approvals_reviewer=auto_review from argv", () => {
    expect(parseConfigFlags(["app-server", "-c", "approvals_reviewer=auto_review", "-c", "x=y"]).autoReview).toBe(true);
    expect(parseConfigFlags(["app-server"]).autoReview).toBe(false);
  });
});
```

- [ ] **Step 2: Run it (red)** — FAIL.

- [ ] **Step 3: Implement `src/posture.ts`**

```ts
export interface Posture { permissionMode: "auto" | "default"; roundTripApprovals: boolean }

export function resolvePosture(args: { approvalPolicy?: string; autoReview: boolean }): Posture {
  if (args.autoReview || args.approvalPolicy === "never") return { permissionMode: "auto", roundTripApprovals: false };
  return { permissionMode: "default", roundTripApprovals: true };
}

/** Best-effort read of the `-c key=value` overrides the Director appends (autonomy.py). */
export function parseConfigFlags(argv: string[]): { autoReview: boolean } {
  let autoReview = false;
  for (let i = 0; i < argv.length; i++) if (argv[i] === "-c" && /^approvals_reviewer\s*=\s*auto_review$/.test(argv[i + 1] ?? "")) autoReview = true;
  return { autoReview };
}
```

- [ ] **Step 4: Wire into `handlers.ts`** — `AppServer` constructor takes `autoReview: boolean` (default false); `threadStart` computes `const posture = resolvePosture({ approvalPolicy: params.approvalPolicy, autoReview: this.autoReview })` and uses `posture.permissionMode`. (Approvals broker wiring is Task 11.) Add a handlers test asserting that with `autoReview:true` the `open` config has `permissionMode:"auto"`, and with an `on-request`/no-auto_review thread it's `"default"`.

- [ ] **Step 5: Run it (green)** — `npx vitest run test/unit/posture.test.ts test/unit/handlers.test.ts` → PASS. `npm run typecheck` → clean.

- [ ] **Step 6: Commit**

```bash
git add CC-to-SDK/app-server/src/posture.ts CC-to-SDK/app-server/src/handlers.ts CC-to-SDK/app-server/test/unit/posture.test.ts CC-to-SDK/app-server/test/unit/handlers.test.ts
git commit -m "feat(app-server): posture mapping (auto_review -> permissionMode:auto)"
```

---

## Task 8: `bin.ts` entrypoint + clean shutdown

**Files:**
- Create: `CC-to-SDK/app-server/src/bin.ts`, `CC-to-SDK/app-server/src/_fake.ts`
- Test: `CC-to-SDK/app-server/test/unit/bin.test.ts`

**Interfaces:**
- Consumes: `peer.ts`, `handlers.ts` (`AppServer`, `OpenFn`), `posture.ts`, `tools.ts` (`OutcomeHolder`).
- Produces:
  - `_fake.ts`: `const fakeOpen: OpenFn` — an env-gated, key-free scripted session for the contract/bin tests: `submit(prompt,onMessage)` streams one assistant text (`"thinking"`), sets `holder.outcome = { status: "done", reason: "mock" }` when `prompt.includes("REPORT")`, resolves `{ result: "final text" }`; `usage()` → `{}`; `dispose()` → resolves. (Lives in `src/` so the build emits it to `dist/`; only used when `CC_APPSERVER_FAKE==="1"`.)
  - `bin.ts`: `function runServer(io: { stdin: NodeJS.ReadableStream; stdout: { write(s: string): void }; argv: string[]; onExit?: () => void }): { peer: Peer; shutdown(): Promise<void> }`. The module bottom wires `runServer({ stdin: process.stdin, stdout: process.stdout, argv: process.argv.slice(2) })` and disposes on stdin `end` + SIGINT/SIGTERM. Starts with `#!/usr/bin/env node`.

- [ ] **Step 1: Write the failing test** (DI streams; no real process)

```ts
// test/unit/bin.test.ts
import { describe, it, expect } from "vitest";
import { Readable } from "node:stream";
import { runServer } from "../../src/bin.js";

describe("runServer", () => {
  it("serializes outgoing wire objects as NDJSON to stdout and ignores argv noise", async () => {
    const lines: string[] = [];
    const stdin = new Readable({ read() {} });
    const { } = runServer({ stdin, stdout: { write: (s: string) => { lines.push(s); } }, argv: ["app-server", "-c", "approvals_reviewer=auto_review"] });
    stdin.push(JSON.stringify({ id: 1, method: "initialize", params: {} }) + "\n");
    await new Promise((r) => setTimeout(r, 5));
    expect(lines[0].endsWith("\n")).toBe(true);
    const msg = JSON.parse(lines[0]);
    expect(msg).toMatchObject({ id: 1, result: { capabilities: { outcomeOnTurnCompleted: true } } });
    expect("jsonrpc" in msg).toBe(false);
  });
});
```

- [ ] **Step 2: Run it (red)** — FAIL.

- [ ] **Step 3: Implement `src/_fake.ts`** (env-gated, key-free session for the bin/contract tests)

```ts
import type { OpenFn } from "./handlers.js";
import type { OutcomeHolder } from "./tools.js";

/** Scripted, key-free session used ONLY when CC_APPSERVER_FAKE==="1" (bin/contract tests). It populates the
 *  injected outcome holder exactly as the real report_outcome tool would, so the outcome path is exercised. */
export const fakeOpen: OpenFn = (_cfg: any, holder: OutcomeHolder) => ({
  submit: async (prompt: string, onMessage: (m: any) => void) => {
    onMessage({ type: "assistant", message: { content: [{ type: "text", text: "thinking" }] } });
    if (prompt.includes("REPORT")) holder.outcome = { status: "done", reason: "mock" };
    return { result: "final text" };
  },
  usage: async () => ({}),
  dispose: async () => {},
} as any);
```

- [ ] **Step 4: Implement `src/bin.ts`**

```ts
#!/usr/bin/env node
import { Peer } from "./peer.js";
import { AppServer } from "./handlers.js";
import { parseConfigFlags } from "./posture.js";
import { fakeOpen } from "./_fake.js";

export function runServer(io: { stdin: NodeJS.ReadableStream; stdout: { write(s: string): void }; argv: string[]; onExit?: () => void }) {
  const { autoReview } = parseConfigFlags(io.argv);
  const sink = (o: object) => io.stdout.write(JSON.stringify(o) + "\n");      // ONE NDJSON line; never console.log
  const open = process.env.CC_APPSERVER_FAKE === "1" ? fakeOpen : undefined;  // key-free path for tests
  let server!: AppServer;
  const peer = new Peer(sink, (m, p, id) => server.handleRequest(m, p, id), (_m, _p) => { /* initialized: noop */ });
  server = new AppServer(peer, { autoReview, open });
  io.stdin.on("data", (c) => peer.feed(c));
  const shutdown = async () => { try { await server.disposeAll(); } catch {} io.onExit?.(); };
  io.stdin.on("end", () => { void shutdown(); });
  return { peer, shutdown };
}

// Only auto-run when invoked as the binary (not when imported by a test).
if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdin.resume();
  const { shutdown } = runServer({ stdin: process.stdin, stdout: process.stdout, argv: process.argv.slice(2), onExit: () => process.exit(0) });
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}
```

> **Implementer note:** `AppServer` must expose `disposeAll()` (delegate to `Registry.disposeAll()`), and by Task 7 its constructor signature is `constructor(peer: Peer, deps: { open?: OpenFn; autoReview?: boolean } = {})` (carry `autoReview` onto the instance, default `false`). `OpenFn` is `(cfg: any, holder: OutcomeHolder) => Session` (Task 6). No `as any` needed.

- [ ] **Step 5: Run it (green)** — `npx vitest run test/unit/bin.test.ts` → PASS. `npm run build` → emits `dist/bin.js` (verify `dist/bin.js` exists and starts with the shebang). `npm run typecheck` → clean.

- [ ] **Step 6: Commit**

```bash
git add CC-to-SDK/app-server/src/bin.ts CC-to-SDK/app-server/src/_fake.ts CC-to-SDK/app-server/src/handlers.ts CC-to-SDK/app-server/test/unit/bin.test.ts
git commit -m "feat(app-server): bin entrypoint (NDJSON stdio, argv ignore, clean shutdown)"
```

---

## Task 9: Cross-repo contract test (drop-in proof)

**Files:**
- Create: `CC-to-SDK/app-server/test/contract/director-contract.test.ts`
- Create: `CC-to-SDK/app-server/test/contract/client.ts` (a minimal TS port of the Director's 4 client methods)

**Interfaces:**
- Consumes: the built `dist/bin.js`, spawned with `CC_APPSERVER_FAKE=1` so the server uses the key-free `fakeOpen` (`src/_fake.ts`, built in Task 8) — **no new fake file here.** The fake streams one assistant message, resolves `"final text"`, and (when the prompt contains `REPORT`) populates the outcome holder via the same path the real `report_outcome` tool uses.
- Produces: proof that the Director's exact wire sequence yields `thread_id`, `status:"completed"`, `final_message`, and (for a REPORT prompt) `outcome`.

- [ ] **Step 1: Write `test/contract/client.ts`** — a faithful, minimal port of `agent-harness/director/worker/app_server.py`'s wire behavior:

```ts
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export class DirectorClient {
  private proc: ChildProcessWithoutNullStreams; private buf = ""; private id = 0;
  private pending = new Map<number, (r: any) => void>(); private notes: any[] = [];
  constructor(command: string[], env: Record<string, string>) {
    this.proc = spawn(command[0], command.slice(1), { stdio: ["pipe", "pipe", "inherit"], env }) as any;
    this.proc.stdout.on("data", (c) => { this.buf += c.toString(); let nl; while ((nl = this.buf.indexOf("\n")) >= 0) { const l = this.buf.slice(0, nl).trim(); this.buf = this.buf.slice(nl + 1); if (l) this.onLine(JSON.parse(l)); } });
  }
  private send(o: object) { this.proc.stdin.write(JSON.stringify(o) + "\n"); }
  private onLine(m: any) {
    if (m.method && m.id !== undefined) { this.send({ id: m.id, result: this.serverReq(m) }); return; }     // server-initiated request
    if (m.method) { this.notes.push(m); this.resolveNote?.(m); return; }                                     // notification
    const r = this.pending.get(m.id); if (r) { this.pending.delete(m.id); r(m); }                            // response
  }
  private resolveNote?: (m: any) => void;
  private serverReq(m: any): any { return m.method.includes("requestApproval") ? { decision: "accept" } : null; }
  private req(method: string, params: any): Promise<any> { const id = ++this.id; return new Promise((res) => { this.pending.set(id, res); this.send({ id, method, params }); }); }
  async initialize() { await this.req("initialize", { clientInfo: { name: "director", title: "Director", version: "0.1.0" }, capabilities: { experimentalApi: true } }); this.send({ method: "initialized", params: {} }); }
  async threadStart(cwd: string) { const r = await this.req("thread/start", { cwd, approvalPolicy: "on-request", sandbox: "workspace-write" }); return r.result.thread.id; }
  async runTurn(threadId: string, text: string, cwd: string): Promise<{ status: string; final: string | null; outcome: any }> {
    const id = ++this.id; this.send({ id, method: "turn/start", params: { threadId, input: [{ type: "text", text }], cwd, approvalPolicy: "on-request" } });
    let final: string | null = null, outcome: any = undefined;
    return await new Promise((resolve) => {
      this.resolveNote = (m: any) => {
        if (m.method === "item/completed" && m.params?.item?.type === "agentMessage" && m.params.item.phase === "final_answer") final = m.params.item.text;
        if (m.method === "turn/completed" || m.method === "turn/failed" || m.method === "turn/cancelled") { outcome = m.params?.outcome; resolve({ status: m.method.split("/")[1], final, outcome }); }
      };
    });
  }
  stop() { try { this.proc.stdin.end(); this.proc.kill(); } catch {} }
}
```

- [ ] **Step 2: Write the contract test**

```ts
// test/contract/director-contract.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { DirectorClient } from "./client.js";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const BIN = resolve(here, "../../dist/bin.js");

describe("Director drop-in contract (fake session, no key)", () => {
  beforeAll(() => { execSync("npm run build", { cwd: resolve(here, "../..") }); });
  it("a plain turn reaches completed with a final_answer", async () => {
    const c = new DirectorClient(["node", BIN, "app-server"], { ...process.env, CC_APPSERVER_FAKE: "1" } as any);
    await c.initialize();
    const tid = await c.threadStart("/tmp");
    expect(tid).toMatch(/^thr_/);
    const r = await c.runTurn(tid, "do a thing", "/tmp");
    c.stop();
    expect(r.status).toBe("completed");
    expect(r.final).toBe("final text");
  });
  it("a REPORT turn carries outcome on turn/completed", async () => {
    const c = new DirectorClient(["node", BIN, "app-server"], { ...process.env, CC_APPSERVER_FAKE: "1" } as any);
    await c.initialize();
    const tid = await c.threadStart("/tmp");
    const r = await c.runTurn(tid, "REPORT done", "/tmp");
    c.stop();
    expect(r.outcome).toMatchObject({ status: "done" });
  });
});
```

- [ ] **Step 3: (no new code) the fake is already wired in Task 8** — `src/_fake.ts` + the `CC_APPSERVER_FAKE` hook in `runServer` make `dist/bin.js` run key-free and exercise the outcome path. The contract test's `beforeAll` runs `npm run build` and spawns the bin with `CC_APPSERVER_FAKE=1`. Nothing to implement here beyond Steps 1-2.

- [ ] **Step 4: Run it (green)** — `npx vitest run test/contract/director-contract.test.ts` → PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add CC-to-SDK/app-server/test/contract/
git commit -m "test(app-server): cross-repo Director drop-in contract (plain + outcome)"
```

---

## Task 10: Linear MCP (capability)

**Files:**
- Create: `CC-to-SDK/app-server/src/linear.ts`
- Modify: `CC-to-SDK/app-server/src/handlers.ts` (wire the Linear MCP into `thread/start` when `LINEAR_API_KEY` is present)
- Test: `CC-to-SDK/app-server/test/unit/linear.test.ts`

**Interfaces:**
- Produces: `const LINEAR_TOOL_ID = "mcp__cc-linear__linear_graphql"`; `buildLinearTools(deps: { apiKey: string; post?: (url: string, body: string, headers: Record<string,string>) => Promise<any> })`; `withLinear(cfg: any, apiKey: string): any` (merges + allowlists). The tool runs a raw GraphQL query/mutation with a **minimal guardrail**: reject a query whose first non-whitespace token is `mutation` unless it matches the forward-only allowlist `/^mutation\s+\w*\s*[({]/` AND does not contain `delete`/`archive`/`remove` (case-insensitive) — refuse before any POST. A top-level `errors` array in the response is a FAILED call.

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/linear.test.ts
import { describe, it, expect } from "vitest";
import { buildLinearTools } from "../../src/linear.js";

const tools = (post: any) => buildLinearTools({ apiKey: "k", post })[0];

describe("linear_graphql tool", () => {
  it("runs a read query and returns data", async () => {
    const t = tools(async () => ({ data: { viewer: { id: "u1" } } }));
    const r = await t.handler({ query: "query { viewer { id } }" }, {});
    expect(r.content[0].text).toContain("u1");
  });
  it("refuses a destructive mutation before POST", async () => {
    let called = false;
    const t = tools(async () => { called = true; return {}; });
    const r = await t.handler({ query: "mutation { issueDelete(id: 1) { success } }" }, {});
    expect(called).toBe(false);
    expect(r.content[0].text).toMatch(/guardrail|refus|block/i);
  });
  it("surfaces a GraphQL errors array as a failure", async () => {
    const t = tools(async () => ({ errors: [{ message: "bad" }] }));
    const r = await t.handler({ query: "query { x }" }, {});
    expect(r.content[0].text).toMatch(/error/i);
  });
});
```

- [ ] **Step 2: Run it (red)** — FAIL.

- [ ] **Step 3: Implement `src/linear.ts`**

```ts
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

export const LINEAR_TOOL_ID = "mcp__cc-linear__linear_graphql";
const ENDPOINT = "https://api.linear.app/graphql";

async function defaultPost(url: string, body: string, headers: Record<string, string>): Promise<any> {
  const res = await fetch(url, { method: "POST", body, headers });
  return await res.json();
}

/** ON by default: reads pass; mutations only if forward-only and not obviously destructive. */
export function authorize(query: string): { allowed: boolean; reason?: string } {
  const q = query.trimStart();
  if (!/^mutation\b/i.test(q)) return { allowed: true };
  if (/\b(delete|archive|remove)\b/i.test(q)) return { allowed: false, reason: "destructive mutation refused by guardrail" };
  return { allowed: true };
}

export function buildLinearTools(deps: { apiKey: string; post?: (url: string, body: string, headers: Record<string, string>) => Promise<any> }) {
  const post = deps.post ?? defaultPost;
  return [
    tool("linear_graphql", "Execute a raw GraphQL query or mutation against Linear using the session's configured auth.", {
      query: z.string(), variables: z.record(z.any()).optional(),
    }, async (args: any) => {
      const query = String(args.query ?? "");
      if (!query.trim()) return { content: [{ type: "text" as const, text: "linear_graphql requires a non-empty 'query'" }] };
      const verdict = authorize(query);
      if (!verdict.allowed) return { content: [{ type: "text" as const, text: `blocked by authority guardrail: ${verdict.reason}` }] };
      try {
        const resp = await post(ENDPOINT, JSON.stringify({ query, variables: args.variables ?? {} }), { "Authorization": deps.apiKey, "Content-Type": "application/json" });
        if (resp?.errors) return { content: [{ type: "text" as const, text: `error: ${JSON.stringify(resp.errors)}` }] };
        return { content: [{ type: "text" as const, text: JSON.stringify(resp?.data ?? resp) }] };
      } catch (e) { return { content: [{ type: "text" as const, text: `linear request failed: ${(e as Error).message}` }] }; }
    }),
  ];
}

export function withLinear(cfg: any, apiKey: string): any {
  const existing = (cfg.mcpServers as Record<string, unknown> | undefined) ?? {};
  const allowed = (cfg.allowedTools as string[] | undefined) ?? [];
  return { ...cfg, mcpServers: { ...existing, "cc-linear": createSdkMcpServer({ name: "cc-linear", version: "0.1.0", tools: buildLinearTools({ apiKey }) }) }, allowedTools: [...new Set([...allowed, LINEAR_TOOL_ID])] };
}
```

- [ ] **Step 4: Wire into `handlers.ts`** — in `threadStart`, after `withReportOutcome(...)`: `const key = process.env.LINEAR_API_KEY; let cfg = withReportOutcome({...}, holder); if (key) cfg = withLinear(cfg, key);` Add a handlers test: with `LINEAR_API_KEY` set, the `open` cfg's `allowedTools` includes `LINEAR_TOOL_ID`; without it, it does not.

- [ ] **Step 5: Run it (green)** — `npx vitest run test/unit/linear.test.ts test/unit/handlers.test.ts` → PASS. `npm run typecheck` → clean.

- [ ] **Step 6: Commit**

```bash
git add CC-to-SDK/app-server/src/linear.ts CC-to-SDK/app-server/src/handlers.ts CC-to-SDK/app-server/test/unit/linear.test.ts CC-to-SDK/app-server/test/unit/handlers.test.ts
git commit -m "feat(app-server): in-process Linear MCP (linear_graphql + guardrail)"
```

---

## Task 11: Approvals broker (fallback posture)

**Files:**
- Create: `CC-to-SDK/app-server/src/approvals.ts`
- Modify: `CC-to-SDK/app-server/src/handlers.ts` (wire the broker as `permissionBroker` when `posture.roundTripApprovals`)
- Test: `CC-to-SDK/app-server/test/unit/approvals.test.ts`

**Interfaces:**
- Consumes: `cc-harness` (`PermissionBroker`, `PermissionDecision`, `PermissionRequest` types), `peer.ts`.
- Produces: `class AppServerBroker implements PermissionBroker { constructor(peer: Peer, ctx: { threadId: string; turnId: () => string }); request(req): Promise<PermissionDecision> }`. Maps the SDK tool → the Codex approval request, emits it via `peer.request`, awaits `{decision}`, maps the decision.

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/approvals.test.ts
import { describe, it, expect } from "vitest";
import { Peer } from "../../src/peer.js";
import { AppServerBroker } from "../../src/approvals.js";

function setup() {
  const out: any[] = [];
  const peer = new Peer((o) => out.push(o), () => {}, () => {});
  const broker = new AppServerBroker(peer, { threadId: "thr_1", turnId: () => "turn_1" });
  return { out, peer, broker };
}
const sig = { aborted: false, addEventListener() {} } as any;

describe("AppServerBroker", () => {
  it("Bash -> commandExecution approval; accept -> allow_once", async () => {
    const { out, peer, broker } = setup();
    const p = broker.request({ toolName: "Bash", input: { command: "ls", cwd: "/w" }, toolUseID: "t1", signal: sig });
    const sent = out.find((o) => o.method === "item/commandExecution/requestApproval");
    expect(sent.params).toMatchObject({ command: "ls", cwd: "/w", threadId: "thr_1", turnId: "turn_1", availableDecisions: ["accept", "acceptForSession", "decline"] });
    peer.feed(JSON.stringify({ id: sent.id, result: { decision: "accept" } }) + "\n");
    expect(await p).toEqual({ kind: "allow_once" });
  });
  it("Edit -> fileChange approval; acceptForSession -> allow_always; decline -> deny", async () => {
    const { out, peer, broker } = setup();
    const p1 = broker.request({ toolName: "Edit", input: { file_path: "/w/a.ts" }, toolUseID: "t2", signal: sig });
    const s1 = out.find((o) => o.method === "item/fileChange/requestApproval");
    expect(s1.params.changes).toBeDefined();
    peer.feed(JSON.stringify({ id: s1.id, result: { decision: "acceptForSession" } }) + "\n");
    expect(await p1).toEqual({ kind: "allow_always" });
    const p2 = broker.request({ toolName: "Bash", input: { command: "rm -rf /" }, toolUseID: "t3", signal: sig });
    const s2 = out.filter((o) => o.method === "item/commandExecution/requestApproval").pop();
    peer.feed(JSON.stringify({ id: s2.id, result: { decision: "decline" } }) + "\n");
    expect(await p2).toEqual({ kind: "deny" });
  });
});
```

- [ ] **Step 2: Run it (red)** — FAIL.

- [ ] **Step 3: Implement `src/approvals.ts`**

```ts
import type { PermissionBroker, PermissionDecision, PermissionRequest } from "cc-harness";
import { Peer } from "./peer.js";

const FILE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

function mapDecision(decision: string | undefined): PermissionDecision {
  if (decision === "accept") return { kind: "allow_once" };
  if (decision === "acceptForSession") return { kind: "allow_always" };
  return { kind: "deny" };
}

export class AppServerBroker implements PermissionBroker {
  constructor(private peer: Peer, private ctx: { threadId: string; turnId: () => string }) {}
  async request(req: PermissionRequest): Promise<PermissionDecision> {
    const base = { itemId: req.toolUseID, threadId: this.ctx.threadId, turnId: this.ctx.turnId(), availableDecisions: ["accept", "acceptForSession", "decline"] };
    let method: string, params: any;
    if (FILE_TOOLS.has(req.toolName)) {
      method = "item/fileChange/requestApproval";
      params = { ...base, changes: [{ path: req.input.file_path ?? req.input.path, kind: req.toolName }], reason: req.description };
    } else {
      method = "item/commandExecution/requestApproval";
      params = { ...base, command: req.input.command ?? req.toolName, cwd: req.input.cwd, reason: req.description };
    }
    const resp = await this.peer.request(method, params);
    return mapDecision((resp.result as any)?.decision);
  }
}
```

- [ ] **Step 4: Wire into `handlers.ts`** — when `posture.roundTripApprovals`, set `cfg.permissionBroker = new AppServerBroker(this.peer, { threadId, turnId: () => <current turn id for this thread> })` and `cfg.permissionMode = "default"`. The broker needs the active turn id; track it on the registry entry (`entry.currentTurnId`, set in `turnStart`). Add a handlers test asserting that an `on-request`/no-auto_review thread's `open` cfg has a `permissionBroker` set, and an `auto_review` thread's does not.

- [ ] **Step 5: Run it (green)** — `npx vitest run test/unit/approvals.test.ts test/unit/handlers.test.ts` → PASS. `npm run typecheck` → clean.

- [ ] **Step 6: Commit**

```bash
git add CC-to-SDK/app-server/src/approvals.ts CC-to-SDK/app-server/src/handlers.ts CC-to-SDK/app-server/src/registry.ts CC-to-SDK/app-server/test/unit/approvals.test.ts CC-to-SDK/app-server/test/unit/handlers.test.ts
git commit -m "feat(app-server): approvals broker for the auto_review=false fallback posture"
```

---

## Task 12: Gated live e2e

**Files:**
- Create: `CC-to-SDK/app-server/test/live/appserver.e2e.test.ts`

**Interfaces:**
- Consumes: the real SDK (no fake). Gated like every live test: `const live = (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN) ? describe : describe.skip;`. **Controller runs this keyed; implementers stop at the clean keyless skip.**

- [ ] **Step 1: Write the test** — spawn the real `dist/bin.js` (no `CC_APPSERVER_FAKE`), drive a one-turn session via `DirectorClient` (Task 9), assert `status:"completed"` and a non-empty `final`. Use the OAuth gate; set `read`-style timeout 90s.

```ts
// test/live/appserver.e2e.test.ts
import { describe, it, expect } from "vitest";
import { DirectorClient } from "../contract/client.js";
import { fileURLToPath } from "node:url"; import { dirname, resolve } from "node:path";
const live = (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN) ? describe : describe.skip;
const BIN = resolve(dirname(fileURLToPath(import.meta.url)), "../../dist/bin.js");

live("app-server live e2e", () => {
  it("a real turn completes with a final answer", async () => {
    const c = new DirectorClient(["node", BIN, "app-server", "-c", "approvals_reviewer=auto_review"], { ...process.env } as any);
    await c.initialize();
    const tid = await c.threadStart(process.cwd());
    const r = await c.runTurn(tid, "Reply with exactly: pong", process.cwd());
    c.stop();
    expect(r.status).toBe("completed");
    expect((r.final ?? "").toLowerCase()).toContain("pong");
  }, 90_000);
});
```

- [ ] **Step 2: Verify the keyless skip** — `npx vitest run test/live/appserver.e2e.test.ts` → SKIPPED (no key). **Implementer stops here.**

- [ ] **Step 3: (Controller) run keyed** — `cd CC-to-SDK/app-server && npm run build && set -a; . ../.env; set +a; unset ANTHROPIC_API_KEY; npx vitest run test/live/appserver.e2e.test.ts` → PASS (real turn).

- [ ] **Step 4: Commit**

```bash
git add CC-to-SDK/app-server/test/live/appserver.e2e.test.ts
git commit -m "test(app-server): gated live e2e — a real turn completes with a final answer"
```

---

## Task 13: Director companion change + docs/coverage/memory

**Files (separate repo `~/Documents/GitHub/agent-harness`):**
- Modify: `director/worker/app_server.py` (capture init capabilities; capture `turn/completed.outcome`), `director/run.py` (decider source + drop sink wiring), the worker env policy (`director/worker/policy.py`) to allowlist `CLAUDE_CODE_OAUTH_TOKEN`/`ANTHROPIC_API_KEY`/`LINEAR_API_KEY`, and config for `director.worker.outcome_channel` + the `--codex` default.
**Files (this repo):**
- Modify: `CC-to-SDK/docs/parity/coverage.md`; create a memory file + MEMORY.md pointer.

**Interfaces:**
- Consumes: the frozen contract — bin `cc-codex-appserver`, `turn/completed.params.outcome` schema, `capabilities.outcomeOnTurnCompleted`.

> **This task spans two repos and is owned by the user per the spec (§10).** The controller implements the CC-to-SDK docs/memory half; the Director half is the user's (commit it in `agent-harness`). Keep them as separate commits.

- [ ] **Step 1 (Director, behind the flag): capture capabilities + outcome.**
  - `app_server.py initialize()`: store the init result; expose `self.outcome_on_turn_completed = bool(result.get("capabilities", {}).get("outcomeOnTurnCompleted"))`.
  - `app_server.py run_turn()` terminal branch (lines ~412-416): add `outcome=mparams.get("outcome")` to the returned dict.
  - `run.py drive` (line ~370): when the channel is `turn_completed` (capability true OR `director.worker.outcome_channel=="turn_completed"`), read `result.get("outcome")`; else keep `sink.get("outcome")`.
  - Drop the `make_report_outcome_executor` sink wiring (run.py ~282,293) under the new channel only.
  - Run the Director's own suite: `python -m pytest tests/test_director_app_server.py -q` → PASS (the mock still drives the `tool` channel; the new channel is gated).

- [ ] **Step 2 (Director): env allowlist + `--codex` target.** Allowlist `CLAUDE_CODE_OAUTH_TOKEN`/`ANTHROPIC_API_KEY`/`LINEAR_API_KEY` in the worker env policy; set the `--codex` default (or `.harness.json`) to `node /abs/path/CC-to-SDK/app-server/dist/bin.js`. Commit in `agent-harness`.

- [ ] **Step 3 (this repo): refresh coverage + memory.**
  - `CC-to-SDK/docs/parity/coverage.md`: add an app-server row/section (new domain or under integration) noting the Claude-backed Codex app-server drop-in shipped; bump the relevant % and add a one-line increment-log entry.
  - Create `/Users/new/.claude/projects/-Users-new-Documents-GitHub-codex-somersault/memory/claude-codex-appserver-shipped.md` (frontmatter `type: project`) summarizing: the drop-in for the Director, the v2 stdio surface, dynamicTools→server-side (Linear MCP + report_outcome→turn/completed.outcome + capability negotiation), auto_review→permissionMode:auto, the cross-repo contract test as the proof. Add a one-line pointer to `MEMORY.md`.

- [ ] **Step 4: Commit (this repo)**

```bash
git add CC-to-SDK/docs/parity/coverage.md
git commit -m "docs(parity): Claude-backed Codex app-server drop-in shipped"
```

---

## Notes for the executor
- **Sequence:** Tasks 1-9 land a working, spawnable, drop-in-proven server (happy path + outcome). Tasks 10-11 add the Linear capability and the approval-fallback posture. Task 12 is the keyed live proof. Task 13 is the cross-repo cutover + docs.
- **Reviews:** per the project CLAUDE.md, dispatch spec-compliance + code-quality reviews via codex (`/codex:rescue --model gpt-5.5 --effort high`); if codex is unavailable, use Opus 4.8. Implementers are fresh Sonnet.
- **The `engine → translator → peer` invariant is a review gate** — flag any import from `app-server/` into `harness/`, or any `translator.ts` write to the wire.
- **stdout hygiene is a review gate** — any `console.log` (vs `console.error`) in `src/` is a defect (it corrupts the protocol).
