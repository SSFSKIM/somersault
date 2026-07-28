# Agent App-Server M1 (Core Loop) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use doperpowers:subagent-driven-development (recommended) or doperpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship milestone M1 of the agent app-server (spec `docs/superpowers/specs/2026-07-28-agent-appserver-protocol-design.md`, rev 3): a JSON-RPC "lite" control plane over WebSocket through which a scripted client can start a real SDK session, subscribe, run a turn, receive streamed items, answer a parked permission decision, and see the turn complete.

**Architecture:** New module `harness/src/appserver/` mounted on existing seams (`openSession`, `Session.onFrame`, `PendingDecisions`, `sessions/` wrappers). A `Registry` holds threads (in-process only in M1); a `TurnMapper` converts SDK frames into a structured Item stream (derived ids); a `Peer` frames NDJSON/WS messages with bounded outbound pressure; decisions are state (requested → respond → resolved), never reverse-RPC. Spec milestones M2 (controls/introspection) and M3 (fleet/workspace) get their own plans.

**Tech Stack:** TypeScript ESM, zod v4 (`import { z } from "zod/v4"`), vitest, `ws` (new dep), Claude Agent SDK 0.3.220 (bumped in Task 1 per spec D8).

## Global Constraints

- All commands run from `CC-to-SDK/harness/`. Fast gate after every task: `npm run typecheck`.
- ESM: import specifiers end in `.js` even from `.ts` sources.
- Dense hand-style, NO Prettier; match surrounding code. DI-by-deps (inject fakes; live tests use the real SDK).
- zod import path is `zod/v4` (matches `src/host/ops.ts`).
- Live tests gate: `const live = (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN) ? describe : describe.skip` — keyless runs must skip cleanly. Keyed runs: `set -a; . ../.env; set +a; npx vitest run test/live/<file>` (controller only).
- Commits: current branch (main), imperative subject, **no Co-Authored-By**. Prefix `(as1-tN)`.
- Error codes (spec §4): `-32700/-32600/-32601/-32602/-32603/-32001` + `-33001 busy`, `-33002 alreadySettled`, `-33003 unauthenticated`, `-33004 threadNotFound`, `-33005 engineGone`, `-33006 unsupportedForOrigin`.
- Notifications carry top-level `emittedAtMs`. Timestamps `*At` = unix seconds, `*AtMs` = millis.
- Do NOT edit `src/tui/` in this plan (C5 work is active there). The mapper is a sibling pure module; TUI adoption is M2+.

---

### Task 1: SDK bump 0.3.211 → 0.3.220 (spec D8)

**Files:**
- Modify: `package.json` (dependency line), `package-lock.json` (via npm)

**Interfaces:**
- Consumes: nothing.
- Produces: SDK 0.3.220 installed; later tasks may rely on 0.3.220 types (`interrupt` cancel-queued capability, `matchedAskRule` on asks).

- [ ] **Step 1: Bump and install.** In `package.json` change `"@anthropic-ai/claude-agent-sdk": "^0.3.211"` → `"^0.3.220"`. Run: `npm install`. Expected: lockfile updates to 0.3.220.
- [ ] **Step 2: Fast gates.** Run: `npm run typecheck` then `npm run test:unit` then `npm run test:tui`. Expected: all green. If typecheck breaks on removed/renamed SDK types, fix call sites minimally (record each fix in the commit body).
- [ ] **Step 3: Drift check.** Run: `node scripts/drift-check.mjs`. Expected: exit 0, OR a report of new 0.3.220 Options fields (`workflowSizeGuideline` etc.). If it reports drift, do NOT model the new knobs here — add a one-line TODO row to `docs/parity/coverage.md` §9 notes instead (knob modeling is its own follow-up; spec §13 already inventories the delta).
- [ ] **Step 4: Check the interrupt signature for Task 8.** Run: `grep -n "interrupt" node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts | head -20` and read the `Query.interrupt` declaration. Record in the commit message body whether it accepts a cancel-queued option (`interrupt(opts?: …)`) or remains zero-arg (the control-request field may not be surfaced on the Query method). Task 8 branches on this fact.
- [ ] **Step 5: Commit.**
```bash
git add package.json package-lock.json
git commit -m "chore(as1-t1): bump Agent SDK to 0.3.220 (spec D8; interrupt signature: <found shape>)"
```

---

### Task 2: RPC framing — `appserver/rpc.ts`

**Files:**
- Create: `src/appserver/rpc.ts`
- Test: `test/unit/appserver/rpc.test.ts`

**Interfaces:**
- Produces (exact, used by every later task):
```ts
export type RequestId = string | number;
export const ERR: { PARSE: -32700; INVALID_REQUEST: -32600; METHOD_NOT_FOUND: -32601; INVALID_PARAMS: -32602; INTERNAL: -32603; OVERLOADED: -32001; BUSY: -33001; ALREADY_SETTLED: -33002; UNAUTHENTICATED: -33003; THREAD_NOT_FOUND: -33004; ENGINE_GONE: -33005; UNSUPPORTED_FOR_ORIGIN: -33006 };
export interface RpcRequest { id: RequestId; method: string; params?: Record<string, unknown> }
export interface RpcNotification { method: string; params?: Record<string, unknown> }
export type Classified = { kind: "request"; id: RequestId; method: string; params?: Record<string, unknown> } | { kind: "notification"; method: string; params?: Record<string, unknown> } | { kind: "response"; id: RequestId; result: unknown } | { kind: "invalid" };
export function classify(v: unknown): Classified;
export function encode(msg: object): string; // JSON + "\n"
```

- [ ] **Step 1: Write the failing test** (`test/unit/appserver/rpc.test.ts`):
```ts
import { describe, it, expect } from "vitest";
import { classify, encode, ERR } from "../../../src/appserver/rpc.js";
describe("rpc classify", () => {
  it("routes request/notification/response/invalid", () => {
    expect(classify({ id: 1, method: "thread/start" }).kind).toBe("request");
    expect(classify({ method: "initialized" }).kind).toBe("notification");
    expect(classify({ id: "a", result: {} }).kind).toBe("response");
    expect(classify({ id: 1 }).kind).toBe("invalid");
    expect(classify("nope").kind).toBe("invalid");
    expect(classify({ id: true, method: "x" }).kind).toBe("invalid"); // id must be string|number
  });
  it("encode terminates with newline; ERR carries app codes", () => {
    expect(encode({ a: 1 }).endsWith("\n")).toBe(true);
    expect(ERR.UNSUPPORTED_FOR_ORIGIN).toBe(-33006);
  });
});
```
- [ ] **Step 2: Run to verify FAIL** — `npx vitest run test/unit/appserver/rpc.test.ts`. Expected: module-not-found.
- [ ] **Step 3: Implement** (`src/appserver/rpc.ts`):
```ts
// appserver/rpc.ts — JSON-RPC "lite" framing (spec §4): no "jsonrpc" field, NDJSON lines, string|number ids.
export type RequestId = string | number;
export const ERR = { PARSE: -32700, INVALID_REQUEST: -32600, METHOD_NOT_FOUND: -32601, INVALID_PARAMS: -32602, INTERNAL: -32603, OVERLOADED: -32001, BUSY: -33001, ALREADY_SETTLED: -33002, UNAUTHENTICATED: -33003, THREAD_NOT_FOUND: -33004, ENGINE_GONE: -33005, UNSUPPORTED_FOR_ORIGIN: -33006 } as const;
export interface RpcRequest { id: RequestId; method: string; params?: Record<string, unknown> }
export interface RpcNotification { method: string; params?: Record<string, unknown> }
export type Classified =
  | { kind: "request"; id: RequestId; method: string; params?: Record<string, unknown> }
  | { kind: "notification"; method: string; params?: Record<string, unknown> }
  | { kind: "response"; id: RequestId; result: unknown }
  | { kind: "invalid" };
const isId = (v: unknown): v is RequestId => typeof v === "string" || typeof v === "number";
export function classify(v: unknown): Classified {
  if (typeof v !== "object" || v === null) return { kind: "invalid" };
  const o = v as Record<string, unknown>;
  const hasMethod = typeof o.method === "string";
  if (hasMethod && isId(o.id)) return { kind: "request", id: o.id, method: o.method as string, params: o.params as Record<string, unknown> | undefined };
  if (hasMethod && o.id === undefined) return { kind: "notification", method: o.method as string, params: o.params as Record<string, unknown> | undefined };
  if (!hasMethod && isId(o.id) && "result" in o) return { kind: "response", id: o.id, result: o.result };
  return { kind: "invalid" };
}
export function encode(msg: object): string { return JSON.stringify(msg) + "\n"; }
```
- [ ] **Step 4: Run to verify PASS**, then `npm run typecheck`.
- [ ] **Step 5: Commit** — `git add src/appserver/rpc.ts test/unit/appserver/rpc.test.ts && git commit -m "feat(as1-t2): appserver JSON-RPC lite framing + error codes"`

---

### Task 3: Peer — framing + bounded outbound — `appserver/peer.ts`

**Files:**
- Create: `src/appserver/peer.ts`
- Test: `test/unit/appserver/peer.test.ts`

**Interfaces:**
- Consumes: `encode`, `ERR`, `RequestId` from Task 2.
- Produces:
```ts
export interface PeerSink { write(line: string): void; buffered(): number; end(): void }
export class Peer {
  constructor(sink: PeerSink, opts?: { maxIncomingFrame?: number; maxBuffered?: number; onOverflow?: () => void });
  reply(id: RequestId, result: unknown): void;
  replyError(id: RequestId, code: number, message: string, data?: unknown): void;
  notify(method: string, params: Record<string, unknown>): void;  // adds top-level emittedAtMs
  feed(chunk: string, onFrame: (v: unknown) => void): void;       // newline splitter; oversized/unparsable → onFrame({__parseError:true})
}
```

- [ ] **Step 1: Write the failing test**:
```ts
import { describe, it, expect } from "vitest";
import { Peer, type PeerSink } from "../../../src/appserver/peer.js";
const arraySink = () => { const lines: string[] = []; let ended = false; const sink: PeerSink = { write: (l) => void lines.push(l), buffered: () => 0, end: () => void (ended = true) }; return { lines, sink, ended: () => ended }; };
describe("Peer", () => {
  it("notify stamps emittedAtMs; reply echoes id", () => {
    const s = arraySink(); const p = new Peer(s.sink);
    p.notify("thread/status/changed", { threadId: "t" }); p.reply(7, { ok: true });
    const n = JSON.parse(s.lines[0]); expect(n.method).toBe("thread/status/changed"); expect(typeof n.emittedAtMs).toBe("number");
    expect(JSON.parse(s.lines[1])).toEqual({ id: 7, result: { ok: true } });
  });
  it("feed splits lines across chunks", () => {
    const s = arraySink(); const p = new Peer(s.sink); const seen: unknown[] = [];
    p.feed('{"id":1,"me', (v) => seen.push(v)); p.feed('thod":"a"}\n{"method":"b"}\n', (v) => seen.push(v));
    expect(seen).toHaveLength(2);
  });
  it("overflow disconnects instead of buffering unboundedly", () => {
    let over = false; const s = arraySink();
    const p = new Peer({ ...s.sink, buffered: () => 64 * 1024 * 1024 }, { onOverflow: () => void (over = true) });
    p.notify("item/agentMessage/delta", { x: 1 });
    expect(over).toBe(true); expect(s.lines).toHaveLength(0);
  });
});
```
- [ ] **Step 2: Run to verify FAIL.**
- [ ] **Step 3: Implement** (`src/appserver/peer.ts`):
```ts
// appserver/peer.ts — per-connection framing. Outbound is PRESSURE-GATED (spec §11): a slow consumer is
// disconnected, never buffered unboundedly — replay-first subscribe makes reconnect cheap by design.
import { encode, type RequestId } from "./rpc.js";
export interface PeerSink { write(line: string): void; buffered(): number; end(): void }
const MAX_IN = 256 * 1024;          // client→server frame cap (mirrors host/server.ts MAX_FRAME)
const MAX_OUT = 32 * 1024 * 1024;   // server→client pressure cap (mirrors client/remote.ts rationale)
export class Peer {
  private buf = "";
  constructor(private sink: PeerSink, private opts: { maxIncomingFrame?: number; maxBuffered?: number; onOverflow?: () => void } = {}) {}
  private send(msg: object): void {
    if (this.sink.buffered() > (this.opts.maxBuffered ?? MAX_OUT)) { this.opts.onOverflow?.(); this.sink.end(); return; }
    this.sink.write(encode(msg));
  }
  reply(id: RequestId, result: unknown): void { this.send({ id, result }); }
  replyError(id: RequestId, code: number, message: string, data?: unknown): void { this.send({ id, error: { code, message, ...(data !== undefined ? { data } : {}) } }); }
  notify(method: string, params: Record<string, unknown>): void { this.send({ method, params, emittedAtMs: Date.now() }); }
  feed(chunk: string, onFrame: (v: unknown) => void): void {
    this.buf += chunk;
    let nl: number;
    while ((nl = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, nl); this.buf = this.buf.slice(nl + 1);
      if (!line.trim()) continue;
      if (line.length > (this.opts.maxIncomingFrame ?? MAX_IN)) { onFrame({ __parseError: true }); continue; }
      try { onFrame(JSON.parse(line)); } catch { onFrame({ __parseError: true }); }
    }
    if (this.buf.length > (this.opts.maxIncomingFrame ?? MAX_IN)) { this.buf = ""; onFrame({ __parseError: true }); }
  }
}
```
- [ ] **Step 4: Run to verify PASS**, `npm run typecheck`.
- [ ] **Step 5: Commit** — `git commit -m "feat(as1-t3): appserver Peer — NDJSON framing, emittedAtMs, overflow-disconnect"` (add both files).

---

### Task 4: Item model + live TurnMapper — `appserver/items/`

**Files:**
- Create: `src/appserver/items/types.ts`, `src/appserver/items/mapper.ts`
- Test: `test/unit/appserver/mapper.test.ts`
- Read first (do not modify): `src/tui/liveTurn.ts` — the mapper mirrors its `ingest` contract (stream_event / parent_tool_use_id / assistant / user frame routing).

**Interfaces:**
- Produces:
```ts
// types.ts
export type ToolView = "command" | "fileChange" | "fileRead" | "search" | "webSearch" | "webFetch" | "mcp" | "subagentTask" | "other";
export interface UserMessageItem { type: "userMessage"; id: string; text: string }
export interface AgentMessageItem { type: "agentMessage"; id: string; text: string; aborted?: true }
export interface ReasoningItem { type: "reasoning"; id: string; text: string; aborted?: true }
export interface ToolCallItem { type: "toolCall"; id: string; tool: string; view: ToolView; arguments: Record<string, unknown>; status: "inProgress" | "completed" | "failed"; result?: string; parentToolUseId?: string }
export type Item = UserMessageItem | AgentMessageItem | ReasoningItem | ToolCallItem;
export type ItemDeltaChannel = "text" | "thinking" | "arguments";
export type ItemEvent = { kind: "started"; item: Item } | { kind: "delta"; itemId: string; channel: ItemDeltaChannel; delta: string } | { kind: "completed"; item: Item };
export function toolView(name: string): ToolView;
// mapper.ts
export class TurnMapper { ingest(frame: unknown): ItemEvent[]; finalize(interrupted: boolean): ItemEvent[] }
export function userItem(text: string, uuid: string): UserMessageItem;
```
- **Item identity (spec D10, refined):** text/thinking items are `${message.id}#${blockIndex}` (the API `msg_…` id — present on `message_start`, the full assistant frame, AND the persisted transcript, so live ≡ persisted extends to ids); `toolCall` items use the `tool_use` block id (`toolu_…`); `userMessage` uses the frame `uuid`. This refinement is recorded in the spec's Revision Notes.

- [ ] **Step 1: Write the failing test** with synthetic frames shaped like the ones `liveTurn.ts` handles:
```ts
import { describe, it, expect } from "vitest";
import { TurnMapper } from "../../../src/appserver/items/mapper.js";
import { toolView } from "../../../src/appserver/items/types.js";
const asst = (msgId: string, content: unknown[]) => ({ type: "assistant", uuid: "u-" + msgId, message: { id: msgId, model: "m", content } });
const toolResult = (toolUseId: string, content: string) => ({ type: "user", uuid: "u-r", message: { content: [{ type: "tool_result", tool_use_id: toolUseId, content }] } });
describe("TurnMapper", () => {
  it("maps text + thinking blocks with msgId#index ids", () => {
    const m = new TurnMapper();
    const evs = m.ingest(asst("msg_1", [{ type: "thinking", thinking: "hm" }, { type: "text", text: "hi" }]));
    expect(evs.map((e) => e.kind)).toEqual(["started", "completed", "started", "completed"]);
    expect(evs[1]).toMatchObject({ item: { type: "reasoning", id: "msg_1#0", text: "hm" } });
    expect(evs[3]).toMatchObject({ item: { type: "agentMessage", id: "msg_1#1", text: "hi" } });
  });
  it("tool_use starts inProgress; tool_result completes by toolu id", () => {
    const m = new TurnMapper();
    const [started] = m.ingest(asst("msg_2", [{ type: "tool_use", id: "toolu_9", name: "Bash", input: { command: "ls" } }]));
    expect(started).toMatchObject({ kind: "started", item: { type: "toolCall", id: "toolu_9", view: "command", status: "inProgress" } });
    const [done] = m.ingest(toolResult("toolu_9", "ok"));
    expect(done).toMatchObject({ kind: "completed", item: { id: "toolu_9", status: "completed", result: "ok" } });
  });
  it("stream deltas key to the same msgId#index; the later full frame does not re-emit", () => {
    const m = new TurnMapper();
    m.ingest({ type: "stream_event", event: { type: "message_start", message: { id: "msg_3" } } });
    const s = m.ingest({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } });
    expect(s[0]).toMatchObject({ kind: "started", item: { id: "msg_3#0" } });
    const d = m.ingest({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "he" } } });
    expect(d[0]).toEqual({ kind: "delta", itemId: "msg_3#0", channel: "text", delta: "he" });
    const c = m.ingest({ type: "stream_event", event: { type: "content_block_stop", index: 0 } });
    expect(c[0]).toMatchObject({ kind: "completed", item: { id: "msg_3#0", text: "he" } });
    expect(m.ingest(asst("msg_3", [{ type: "text", text: "he" }]))).toEqual([]); // reconcile, no dup
  });
  it("finalize(interrupted) stamps aborted on open items", () => {
    const m = new TurnMapper();
    m.ingest({ type: "stream_event", event: { type: "message_start", message: { id: "msg_4" } } });
    m.ingest({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } });
    const evs = m.finalize(true);
    expect(evs[0]).toMatchObject({ kind: "completed", item: { id: "msg_4#0", aborted: true } });
  });
  it("nested subagent frames attach to the parent tool, not the top stream", () => {
    const m = new TurnMapper();
    m.ingest(asst("msg_5", [{ type: "tool_use", id: "toolu_t", name: "Task", input: {} }]));
    const evs = m.ingest({ type: "assistant", parent_tool_use_id: "toolu_t", uuid: "u-n", message: { id: "msg_6", content: [{ type: "text", text: "inner" }] } });
    expect(evs).toEqual([]); // M1: nested activity is not itemized; attribution only
  });
  it("toolView classifies", () => {
    expect(toolView("Bash")).toBe("command"); expect(toolView("Edit")).toBe("fileChange");
    expect(toolView("Read")).toBe("fileRead"); expect(toolView("Grep")).toBe("search");
    expect(toolView("Task")).toBe("subagentTask"); expect(toolView("mcp__x__y")).toBe("mcp");
    expect(toolView("SendFeedback")).toBe("other");
  });
});
```
- [ ] **Step 2: Run to verify FAIL.**
- [ ] **Step 3: Implement `types.ts`** (the interface block above, plus):
```ts
export function toolView(name: string): ToolView {
  if (name.startsWith("mcp__")) return "mcp";
  switch (name) {
    case "Bash": case "BashOutput": case "KillShell": return "command";
    case "Edit": case "Write": case "MultiEdit": case "NotebookEdit": return "fileChange";
    case "Read": return "fileRead";
    case "Grep": case "Glob": return "search";
    case "WebSearch": return "webSearch";
    case "WebFetch": return "webFetch";
    case "Task": case "Agent": return "subagentTask";
    default: return "other";
  }
}
```
- [ ] **Step 4: Implement `mapper.ts`.** Mirror `liveTurn.ts`'s routing exactly (`stream_event` → `m.event`; `parent_tool_use_id` → swallow, return `[]`; `assistant` → blocks; `user` → tool_results). Core state: `msgId` (from `message_start` or the full frame's `message.id`), `open: Map<string, { item: Item; text: string }>` keyed by item id, `streamedMsgIds: Set<string>` (full-frame reconcile guard), `tools: Map<string /*toolu*/, ToolCallItem>`. Rules:
  - `content_block_start` → build item (text→agentMessage, thinking→reasoning, tool_use→toolCall via `toolView`), id per the identity rules, emit `started`.
  - `content_block_delta` → `text_delta`→channel "text", `thinking_delta`→"thinking", `input_json_delta`→"arguments" (accumulate arguments JSON string; parse on stop, fall back to `{}` on parse failure).
  - `content_block_stop` → emit `completed` with accumulated text; keep toolCall items OPEN (`inProgress`) until their tool_result.
  - Full `assistant` frame: if `streamedMsgIds.has(message.id)` → return `[]`; else emit started+completed per block (partials-off path).
  - `user` frame: for each `tool_result` block, complete the matching tool item — `status: "failed"` when the block has `is_error: true`, `result` = first-line text (reuse `firstResultLine`'s logic: string content or joined text blocks).
  - `finalize(interrupted)`: complete every open non-tool item (stamp `aborted: true` if interrupted — the SDK's 0.3.220 `aborted` flag arrives on the frame too; trust either), and every open tool as `status: interrupted ? "failed" : "completed"`.
- [ ] **Step 5: Run to verify PASS**, `npm run typecheck`.
- [ ] **Step 6: Field-name cross-check.** Open `src/tui/liveTurn.ts` once more and confirm the mapper handles the same event names it does (`message_start`, `content_block_start/delta/stop`, `message_delta`) and the same frame envelope fields. If liveTurn handles a shape the mapper drops silently (e.g. `message_delta` usage), that's fine for M1 — usage is turn-level, not item-level — but note it in the commit body.
- [ ] **Step 7: Commit** — `git commit -m "feat(as1-t4): structured Item model + TurnMapper (derived ids msg_id#idx / toolu; stream+full reconcile)"`.

---

### Task 5: Persisted-replay parity — `appserver/items/replay.ts`

**Files:**
- Create: `src/appserver/items/replay.ts`
- Test: `test/unit/appserver/itemsReplay.test.ts`

**Interfaces:**
- Consumes: `TurnMapper`, `Item` (Task 4).
- Produces: `export function itemsFromTranscript(messages: unknown[]): Item[]` — runs persisted frames through a fresh `TurnMapper`, collects `completed` items in order, plus `userMessage` items for persisted user prompts (frames whose `message.content` is a string or text blocks WITHOUT `tool_result`).

- [ ] **Step 1: Write the failing test** — the D10 parity pin:
```ts
import { describe, it, expect } from "vitest";
import { TurnMapper } from "../../../src/appserver/items/mapper.js";
import { itemsFromTranscript } from "../../../src/appserver/items/replay.js";
const frames = [
  { type: "user", uuid: "u-p", message: { content: "run ls" } },
  { type: "assistant", uuid: "u-a", message: { id: "msg_A", content: [{ type: "text", text: "sure" }, { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls" } }] } },
  { type: "user", uuid: "u-r", message: { content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "file.txt" }] } },
];
it("persisted path yields the same item ids as the live path (D10)", () => {
  const live = new TurnMapper(); const liveIds: string[] = [];
  for (const f of frames) for (const e of live.ingest(f)) if (e.kind === "completed") liveIds.push(e.item.id);
  const replayIds = itemsFromTranscript(frames).map((i) => i.id);
  expect(replayIds).toEqual(["u-p", ...liveIds]); // userMessage first, then identical assistant/tool ids
});
```
- [ ] **Step 2: Run to verify FAIL.**
- [ ] **Step 3: Implement** — ~25 lines: iterate messages; user frames with plain/text content → push `userItem(text, uuid)`; everything else → `mapper.ingest`, collect `completed` items; after the loop `mapper.finalize(false)` and collect. Skip `tool_result`-bearing user frames as userMessages (they complete tools instead).
- [ ] **Step 4: Run to verify PASS**, `npm run typecheck`.
- [ ] **Step 5: Commit** — `git commit -m "feat(as1-t5): itemsFromTranscript — persisted transcript → items via the same mapper (live≡persisted ids)"`.

---

### Task 6: Registry + dispatcher + initialize + thread lifecycle — `appserver/registry.ts`, `appserver/server.ts`

**Files:**
- Create: `src/appserver/registry.ts`, `src/appserver/server.ts`
- Test: `test/unit/appserver/server.test.ts`

**Interfaces:**
- Consumes: Tasks 2–5; `openSession`/`resumeSession` (`src/session/index.ts`), `PendingDecision` type.
- Produces:
```ts
// registry.ts
export type ThreadOrigin = "inProcess"; // fleet adoption is M3
export interface EngineSession {  // the subset of lib Session the server drives in M1 (structural)
  submit(prompt: string, onMessage: (m: unknown) => void): Promise<{ result: unknown }>;
  interrupt(): Promise<unknown>; dispose(): Promise<void>; onFrame(cb: (m: unknown) => void): () => void;
  readonly sessionId?: string;
}
export interface ThreadRecord { id: string; origin: ThreadOrigin; session: EngineSession; unattended: "park" | "deny"; busy: boolean; turnSeq: number; buffer: ItemEvent[]; subscribers: Set<Peer>; chain: Promise<unknown>; sessionId?: string }
export class Registry { mint(): string /* thr_<12hex> */; add(r: ThreadRecord): void; get(id: string): ThreadRecord | undefined; list(): ThreadRecord[]; delete(id: string): void }
// server.ts
export interface AppServerDeps { sessionFactory?: (config: Record<string, unknown>) => EngineSession }
export interface ConnCtx { peer: Peer; initialized: boolean; authed: boolean; clientName?: string; connId: number }
export class AppServer {
  constructor(opts?: { token?: string }, deps?: AppServerDeps);
  readonly registry: Registry;
  connect(sink: PeerSink): { peer: Peer; feed(chunk: string): void; close(): void };  // transport-agnostic entry
}
```
- Dispatch rules: any request before a successful `initialize` → `ERR.UNAUTHENTICATED` when a token is configured, else `"Not initialized"` invalid-request; second `initialize` → invalid-request; unknown method → `METHOD_NOT_FOUND`; zod parse failure → `INVALID_PARAMS`. Thread-scoped methods run on `record.chain = record.chain.then(handler)` (spec §3.9 serialization scope). Methods this task lands: `initialize`, `server/status`, `thread/start`, `thread/resume`, `thread/list`, `thread/close`.

- [ ] **Step 1: Write the failing test** (DI fake session; drive via `connect` on an array sink):
```ts
import { describe, it, expect } from "vitest";
import { AppServer } from "../../../src/appserver/server.js";
import type { PeerSink } from "../../../src/appserver/peer.js";
const mkSink = () => { const lines: string[] = []; return { lines, sink: { write: (l: string) => void lines.push(l), buffered: () => 0, end: () => {} } as PeerSink }; };
const fakeSession = () => ({ submit: async () => ({ result: {} }), interrupt: async () => ({}), dispose: async () => {}, onFrame: () => () => {}, sessionId: "sess-1" });
const boot = (token?: string) => { const s = mkSink(); const srv = new AppServer({ token }, { sessionFactory: () => fakeSession() }); const c = srv.connect(s.sink); return { ...s, srv, c }; };
const send = (c: { feed(ch: string): void }, obj: object) => c.feed(JSON.stringify(obj) + "\n");
const parsed = (lines: string[]) => lines.map((l) => JSON.parse(l));
describe("AppServer dispatch", () => {
  it("gates on initialize; token mismatch is -33003", () => {
    const { lines, c } = boot("secret");
    send(c, { id: 1, method: "thread/start", params: {} });
    expect(parsed(lines)[0].error.code).toBe(-33003);
    send(c, { id: 2, method: "initialize", params: { clientInfo: { name: "web" }, authorization: "Bearer wrong" } });
    expect(parsed(lines)[1].error.code).toBe(-33003);
    send(c, { id: 3, method: "initialize", params: { clientInfo: { name: "web" }, authorization: "Bearer secret" } });
    expect(parsed(lines)[2].result.userAgent).toBe("cc-harness-appserver");
  });
  it("thread/start mints thr_ id and lists it; thread/close disposes", async () => {
    const { lines, c } = boot();
    send(c, { id: 1, method: "initialize", params: { clientInfo: { name: "t" } } });
    send(c, { id: 2, method: "thread/start", params: {} });
    await new Promise((r) => setTimeout(r, 0));
    const started = parsed(lines).find((f) => f.id === 2);
    expect(started.result.thread.id).toMatch(/^thr_[0-9a-f]{12}$/);
    expect(started.result.thread.origin).toBe("inProcess");
    send(c, { id: 3, method: "thread/list", params: {} });
    await new Promise((r) => setTimeout(r, 0));
    expect(parsed(lines).find((f) => f.id === 3).result.data).toHaveLength(1);
  });
  it("unknown method and threadNotFound have distinct codes", async () => {
    const { lines, c } = boot();
    send(c, { id: 1, method: "initialize", params: { clientInfo: { name: "t" } } });
    send(c, { id: 2, method: "nope/nope", params: {} });
    send(c, { id: 3, method: "thread/close", params: { threadId: "thr_missing000" } });
    await new Promise((r) => setTimeout(r, 0));
    expect(parsed(lines).find((f) => f.id === 2).error.code).toBe(-32601);
    expect(parsed(lines).find((f) => f.id === 3).error.code).toBe(-33004);
  });
});
```
- [ ] **Step 2: Run to verify FAIL.**
- [ ] **Step 3: Implement `registry.ts`** (~30 lines; `mint` = `"thr_" + randomBytes(6).toString("hex")` from `node:crypto`).
- [ ] **Step 4: Implement `server.ts`.** Structure: zod schemas per method params at top (e.g. `const threadStartParams = z.object({ config: z.record(z.string(), z.unknown()).optional(), unattended: z.enum(["park", "deny"]).default("park") })`); a `handlers: Record<string, (ctx, params, id) => Promise<void>>` table; `connect()` wires `peer.feed` → `classify` → gate → handler (thread-scoped ones resolve the record first, reply `THREAD_NOT_FOUND` if absent, else enqueue on `record.chain`). `thread/start` default `sessionFactory` = `(config) => openSession(config as OpenSessionConfig)` (broker wiring lands in Task 7 — leave a `buildConfig(params)` seam the broker task extends). ThreadView reply: `{ id, origin, sessionId, status: record.busy ? "active" : "idle", createdAt }`. `initialize` result: `{ userAgent: "cc-harness-appserver", version: <package.json version via createRequire>, platformOs: process.platform }`. Token check: exact match of `params.authorization === "Bearer " + token`.
- [ ] **Step 5: Run to verify PASS**, `npm run typecheck`.
- [ ] **Step 6: Commit** — `git commit -m "feat(as1-t6): AppServer core — initialize gate, registry, thread start/resume/list/close, per-thread serialization"`.

---

### Task 7: Decisions end-to-end — `appserver/broker.ts` + server wiring

**Files:**
- Create: `src/appserver/broker.ts`
- Modify: `src/appserver/server.ts` (buildConfig seam + 2 handlers + notifications)
- Test: `test/unit/appserver/decisions.test.ts`

**Interfaces:**
- Consumes: `PendingDecisions` (`src/permissions/pending.ts` — `brokerFor(sessionId)`, `respond(toolUseID, outcome): boolean`, `list()`, `denyAllForSession`, opts `{ expireAfterMs: "never", onAutoSettle }`); `DecisionOutcome`/`DecisionKind` (`src/permissions/types.ts`); `HarnessConfig.permissionBroker` seam (`src/config/types.ts`).
- Produces:
```ts
export const ANSWER_KINDS: Record<DecisionKind, ReadonlyArray<DecisionOutcome["kind"]>> = {
  permission: ["allow_once", "allow_always", "deny"],
  question: ["question_answer", "deny"],
  plan: ["plan_approve", "plan_reject", "deny"],
};
export class ThreadDecisions {
  constructor(emit: (ev: { type: "requested"; entry: PendingDecision } | { type: "resolved"; toolUseID: string; by: string; outcome: DecisionOutcome }) => void, unattended: () => "park" | "deny", hasWatchers: () => boolean);
  broker(threadId: string): PermissionBroker;         // parks via an inner PendingDecisions({expireAfterMs:"never"}); "deny" policy + zero watchers → immediate deny
  pending(): PendingDecision[];
  respond(toolUseID: string, outcome: DecisionOutcome, by: string): { ok: true } | { ok: false; code: "alreadySettled" | "kindMismatch"; by?: string };
  teardown(): void;                                    // denyAll on thread close
}
```
- Server wiring: `thread/start` passes `config.permissionBroker = decisions.broker(threadId)` into the session factory config; `decision/list` → `{ data: pending() }`; `decision/respond` params `{ threadId, toolUseId, answer, abortTurn? }` — validate `answer.kind ∈ ANSWER_KINDS[entry.kind]`, map `alreadySettled` → `ERR.ALREADY_SETTLED` with `data: { by }`, `kindMismatch` → `INVALID_PARAMS`; on `deny`+`abortTurn` also call `record.session.interrupt()`. `by` is server-stamped `${ctx.clientName}#${ctx.connId}` (spec §6 — never client-supplied). Notifications to all subscribers: `decision/requested { threadId, decision }`, `decision/resolved { threadId, toolUseId, by, answer }`.

- [ ] **Step 1: Write the failing test.** Fake session factory that CAPTURES the injected broker from its config, then triggers it:
```ts
import { describe, it, expect } from "vitest";
import { AppServer } from "../../../src/appserver/server.js";
// boot/send/parsed/mkSink helpers identical to Task 6's test — copy them (tests may be read standalone).
it("park → decision/requested → respond → resolved; second answer told who won", async () => {
  let broker: any;
  const srv = new AppServer({}, { sessionFactory: (cfg: any) => { broker = cfg.permissionBroker; return fakeSession(); } });
  // connect TWO sinks; initialize both; thread/start on A; thread/subscribe on both (subscribe ships in Task 9 —
  // for THIS task emit decision events to all connections that initialized; tighten to subscribers in Task 9)
  // drive: const decision = broker.request({ toolName: "Bash", input: { command: "ls" }, toolUseID: "toolu_d", signal: new AbortController().signal });
  // expect both peers got decision/requested with kind "permission"
  // respond from B: { id: 9, method: "decision/respond", params: { threadId, toolUseId: "toolu_d", answer: { kind: "allow_once" } } } → { ok: true }
  // expect await decision → { kind: "allow_once" }; both peers got decision/resolved with by "B#<n>"
  // respond again from A → error code -33002 with data.by === "B#<n>"
});
it("kind mismatch is invalid params", async () => { /* park a permission, respond {kind:"plan_approve",acceptEdits:true} → -32602 */ });
it("unattended:'deny' with zero watchers denies immediately", async () => { /* thread/start {unattended:"deny"}, no subscribe, broker.request resolves {kind:"deny"} without a requested notification */ });
```
Write these three fully (the comments above are the behaviors; the test code follows Task 6's send/parsed idiom).
- [ ] **Step 2: Run to verify FAIL.**
- [ ] **Step 3: Implement `broker.ts`** (~60 lines). Inner `PendingDecisions({ expireAfterMs: "never", onAutoSettle: (e) => emit({ type: "resolved", toolUseID: e.toolUseID, by: "system", outcome: { kind: "deny" } }) })`. `broker(threadId)`: wrap `inner.brokerFor(threadId)` — before parking, if `unattended() === "deny" && !hasWatchers()` return `Promise.resolve({ kind: "deny" })`; else emit `requested` after the park is registered (read the entry back via `inner.list()`), then await. `respond`: look up entry in `inner.list()` — absent → `alreadySettled` (with remembered `by` from a settled-ledger `Map<string,string>`); kind check against `ANSWER_KINDS`; `inner.respond(toolUseID, outcome)` → record ledger, emit `resolved`.
- [ ] **Step 4: Wire `server.ts`** per the Interfaces block. `hasWatchers = () => record.subscribers.size > 0` (until Task 9, subscribers = all initialized peers of the server; Task 9 tightens).
- [ ] **Step 5: Run to verify PASS**, `npm run typecheck`, and re-run Task 6's file (no regressions).
- [ ] **Step 6: Commit** — `git commit -m "feat(as1-t7): decisions as state — park via PendingDecisions, kind-validated respond, server-stamped by, resolved broadcast"`.

---

### Task 8: Turn lifecycle + item streaming

**Files:**
- Modify: `src/appserver/server.ts`
- Test: `test/unit/appserver/turns.test.ts`

**Interfaces:**
- Consumes: `TurnMapper` (Task 4), `EngineSession.submit/interrupt`, Task 1's recorded interrupt signature.
- Produces methods: `turn/start { threadId, input: string }` → `{ turn: { id, status: "inProgress" } }` (busy → `ERR.BUSY`); `turn/interrupt { threadId, cancelQueued? }` → `{ interrupted: true, cancelled?: string[], stillQueued?: string[] }`. Notifications: `turn/started { threadId, turn }`, `turn/completed { threadId, turn: { id, status: "completed" | "interrupted" | "failed", error? } }`, `thread/status/changed { threadId, status }`, and per item event: `item/started` / `item/completed` `{ threadId, turnId, item }`, deltas as `item/agentMessage/delta` | `item/reasoning/delta` | `item/toolCall/argumentsDelta` `{ threadId, turnId, itemId, delta }` (channel→method map: text/thinking/arguments).
- Turn ids: `turn_${threadId}_${++record.turnSeq}`. Every emitted item event is ALSO pushed to `record.buffer` (drained at turn end into a bounded last-turn buffer — cap 500 events, drop-oldest; Task 9 replays it).

- [ ] **Step 1: Write the failing test** — fake session whose `submit(prompt, onMessage)` synchronously feeds two frames (an assistant text block, a tool_use + its tool_result) then resolves; assert notification order on a subscribed peer: `turn/started` → `item/started`(agentMessage) → `item/completed` → `item/started`(toolCall) → `item/completed` → `turn/completed{status:"completed"}`; assert a second `turn/start` while busy replies `-33001`; assert a rejecting `submit` yields `turn/completed{status:"failed"}` and an `interrupt()`ed one `{status:"interrupted"}` (fake submit rejects after `interrupt` resolves — mirror the engine's interrupt-throws contract). Write the test fully in the Task 6 idiom.
- [ ] **Step 2: Run to verify FAIL.**
- [ ] **Step 3: Implement.** `turn/start` handler (on the thread chain): busy-gate → mint turnId → `record.busy = true` + `thread/status/changed` → emit `turn/started` → construct `TurnMapper` → `record.session.submit(input, (m) => fanout(mapper.ingest(m)))` (not awaited on the chain — the chain holds only the gate+start; completion is a `.then` on the submit promise: emit `mapper.finalize(false)` leftovers, `turn/completed{completed}`, busy=false + status changed; `.catch`: `finalize(true)`, status `interrupted` when an interrupt was requested this turn else `failed` with `error: String(err)`). `turn/interrupt`: set `record.interruptRequested = true`, call `session.interrupt()` — if Task 1 recorded that the SDK method accepts a cancel-queued option AND `params.cancelQueued`, pass it through and surface `cancelled`/`still_queued` from the receipt; otherwise reply `{ interrupted: true }` and add a scorecard note (Task 12) that `cancelQueued` is pending SDK plumbing.
- [ ] **Step 4: Run to verify PASS**, `npm run typecheck`, re-run Tasks 6–7 tests.
- [ ] **Step 5: Commit** — `git commit -m "feat(as1-t8): turn lifecycle — busy-gated start, item fan-out via TurnMapper, interrupt (cancelQueued per SDK support)"`.

---

### Task 9: Subscribe (replay-first) + thread/read (paginated, stitchable)

**Files:**
- Modify: `src/appserver/server.ts`
- Test: `test/unit/appserver/subscribe.test.ts`

**Interfaces:**
- Consumes: `itemsFromTranscript` (Task 5), `getSessionMessages` (`src/sessions/`, DI-injectable — add `deps.getSessionMessages?` to `AppServerDeps`, default the real one).
- Produces: `thread/subscribe { threadId }` → `{ subscribed: true }` THEN, on the same connection, the replay in host-`follow()` order (spec §5): `turn/started` only if a turn is in flight → buffered item events → `decision/requested` per parked decision → `thread/status/changed` last. `thread/unsubscribe` → `{ subscribed: false }`. `thread/read { threadId, cursor?, limit? }` → `{ data: Item[], nextCursor: string | null }` — pages newest-first from the persisted transcript (offset-from-end cursor; default limit 200), items within a page oldest→newest. Decision events from Task 7 now go ONLY to `record.subscribers` (tighten the Task 7 shim); `hasWatchers` = `subscribers.size > 0`.

- [ ] **Step 1: Write the failing test**: (a) replay order pinned exactly as listed (start a turn on a fake session that parks mid-turn via its broker, then subscribe a SECOND peer and assert its notification sequence); (b) idle subscribe gets NO `turn/started` (the dedup-vs-disk rule); (c) stitch: build a fake `getSessionMessages` returning Task 5's fixture, run the same frames live into the buffer, subscribe-then-read, assert `read.data` ids ∩ buffered-replay ids overlap and dedup-by-id yields each id exactly once (the client-side stitch the spec's §5 join rule promises — the test documents it as the contract); (d) pagination: 450 persisted items → first page 200 + nextCursor, last page shorter + `nextCursor: null`.
- [ ] **Step 2: Run to verify FAIL.**
- [ ] **Step 3: Implement** (~70 lines): subscriber set add/remove on subscribe/unsubscribe AND on connection close (wire `close()` in `connect()` to sweep this peer from every record — the detach path); replay writes directly to the subscribing peer only; `thread/read` resolves `record.sessionId` (absent → empty page), fetches messages, maps via `itemsFromTranscript`, slices by cursor.
- [ ] **Step 4: Run to verify PASS**, `npm run typecheck`, re-run Tasks 6–8 tests (Task 7's watcher shim change must not break its tests — update them to subscribe first).
- [ ] **Step 5: Commit** — `git commit -m "feat(as1-t9): replay-first subscribe + paginated thread/read (stitch-by-id contract pinned)"`.

---

### Task 10: WebSocket transport + token + origin — `appserver/transport/ws.ts`

**Files:**
- Create: `src/appserver/transport/ws.ts`
- Modify: `package.json` (add `"ws": "^8.18.0"` to dependencies, `"@types/ws": "^8.5.12"` to devDependencies)
- Test: `test/unit/appserver/wsTransport.test.ts`

**Interfaces:**
- Consumes: `AppServer.connect(sink)` (Task 6).
- Produces:
```ts
export interface WsListenOpts { host?: string /* default "127.0.0.1" */; port?: number /* default 0 = ephemeral */; allowOrigins?: string[]; token?: string }
export function listenWs(server: AppServer, opts: WsListenOpts): Promise<{ port: number; close(): Promise<void> }>;
```
- Rules (spec §11): bind localhost by default; an `Origin` header not in `allowOrigins` → destroy the upgrade with 403 (absent `Origin` — non-browser client — is allowed); the token is NOT read from the URL — it arrives inside `initialize` (`authorization: "Bearer <token>"`), which `AppServer` already enforces (Task 6). One WS text frame = one JSON message: adapt by feeding `String(data) + "\n"` into the peer; `PeerSink.buffered()` = `ws.bufferedAmount`; `end()` = `ws.close(1013)`.

- [ ] **Step 1: Install deps.** Run: `npm install ws && npm install -D @types/ws`. Then `npm run typecheck` (still green).
- [ ] **Step 2: Write the failing test** using the real `ws` client against an ephemeral port:
```ts
import { describe, it, expect } from "vitest";
import WebSocket from "ws";
import { AppServer } from "../../../src/appserver/server.js";
import { listenWs } from "../../../src/appserver/transport/ws.js";
const fakeSession = () => ({ submit: async () => ({ result: {} }), interrupt: async () => ({}), dispose: async () => {}, onFrame: () => () => {}, sessionId: "s" });
const rpc = (ws: WebSocket, obj: object) => ws.send(JSON.stringify(obj));
const once = (ws: WebSocket) => new Promise<any>((r) => ws.once("message", (d) => r(JSON.parse(String(d)))));
describe("ws transport", () => {
  it("initialize with token over ws; bad origin refused", async () => {
    const srv = new AppServer({ token: "tok" }, { sessionFactory: () => fakeSession() });
    const { port, close } = await listenWs(srv, { token: "tok", allowOrigins: ["http://ok.test"] });
    const bad = new WebSocket(`ws://127.0.0.1:${port}`, { headers: { origin: "http://evil.test" } });
    await new Promise<void>((r) => bad.once("error", () => r()));           // 403 → client error
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers: { origin: "http://ok.test" } });
    await new Promise<void>((r) => ws.once("open", () => r()));
    rpc(ws, { id: 1, method: "initialize", params: { clientInfo: { name: "web" }, authorization: "Bearer tok" } });
    expect((await once(ws)).result.userAgent).toBe("cc-harness-appserver");
    ws.close(); await close();
  });
});
```
- [ ] **Step 3: Run to verify FAIL**, then **implement** `ws.ts` (~50 lines: `new WebSocketServer({ host, port })`, `verifyClient` for Origin, per-connection `server.connect(sink)` + `ws.on("message", (d) => conn.feed(String(d) + "\n"))` + `ws.on("close", conn.close)`).
- [ ] **Step 4: Run to verify PASS**, `npm run typecheck`.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(as1-t10): WebSocket transport — localhost bind, origin allowlist, initialize-carried token"`.

---

### Task 11: `ccx serve` CLI verb

**Files:**
- Modify: `src/cli/args.ts` (grammar), `src/cli/main.ts` (dispatch)
- Create: `src/cli/serveMain.ts`
- Test: `test/unit/cli/serveArgs.test.ts`

**Interfaces:**
- Consumes: `AppServer`, `listenWs` (Tasks 6/10); the existing `ccx` grammar in `args.ts` (read it first; follow its exact parse/dispatch idiom — commands `run|agents|attach|stop|rm|gc` show the pattern).
- Produces: `ccx serve [--listen ws://HOST:PORT] [--token-file PATH] [--allow-origin ORIGIN]...` — default listen `ws://127.0.0.1:0`; without `--token-file` mint a random 32-hex token. On start, print one line `appserver listening ws://127.0.0.1:<port>` and write `~/.claude/ccx/run/appserver.json` (`{ port, tokenFile? }`, 0o600) via the `fleet/paths.ts` root helper (respects `CCX_FLEET_ROOT`). Non-localhost `--listen` without `--token-file` → refuse with exit 1 (spec §11 last rule).

- [ ] **Step 1: Write the failing test** for the pure parse: `parseArgs(["serve"])` → `{ cmd: "serve", listen: { host: "127.0.0.1", port: 0 }, allowOrigins: [] }`; `["serve","--listen","ws://0.0.0.0:9001"]` without token-file → parse error/refusal marker; `--allow-origin` repeatable accumulates. Conform to whatever shape `args.ts` actually returns for other commands (read first; the test asserts through the real exported parser).
- [ ] **Step 2: Run to verify FAIL**, **implement** grammar + `serveMain.ts` (~40 lines: read/mint token, `new AppServer({ token })`, `await listenWs(...)`, print, write run-file, `SIGINT` → close). Keep `serveMain` dynamic-imported from `main.ts` like the TUI is (headless paths must not load it).
- [ ] **Step 3: Run to verify PASS**, `npm run typecheck`, `npm run test:unit`.
- [ ] **Step 4: Commit** — `git commit -m "feat(as1-t11): ccx serve — ws listener, token mint/file, run-file, non-localhost refusal"`.

---

### Task 12: Scorecard + generated-denominator drift pass (spec D11)

**Files:**
- Create: `docs/parity/appserver.md`
- Modify: `scripts/drift-check.mjs` (add an appserver pass; read the script first and follow its existing report/exit conventions)
- Test: running the script is the test (it's the standing ritual, not vitest)

**Interfaces:**
- Consumes: `src/host/ops.ts` (ops as `op: z.literal("…")`), `src/bridge/types.ts` (ControlFrame variants), `src/sessions/` exports, `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` (`interface Query` methods).
- Produces: `docs/parity/appserver.md` — a table with columns `| seam token | source | protocol method | origin scope | status |`, one row per walked token; M1-shipped rows marked `shipped(M1)`, everything else `planned(M2)`/`planned(M3)`/`probe-gated` per spec §7. The drift pass: regex-walk the four sources → collect tokens → parse the scorecard's `seam token` column → **exit 1 listing any walked token without a row** (extra rows are fine).

- [ ] **Step 1: Write the walker** in `drift-check.mjs`: hostOps = `[...src.matchAll(/op: z\.literal\("(\w+)"\)/g)]`; controlFrames = same pattern against `src/bridge/types.ts` (open the file to confirm its literal shape first — adjust the regex to what's actually there); sessionWrappers = the 7 exported function names from `src/sessions/index.ts`; queryMethods = `[...dts.matchAll(/^\s{4}(\w+)\(/gm)]` scoped to the `interface Query {…}` block. Print a summary line per source.
- [ ] **Step 2: Write `docs/parity/appserver.md`** seeded with EVERY token the walker finds (run the walker with the scorecard check disabled to get the list), mapping each to its spec §7 method and origin scope; header links the spec.
- [ ] **Step 3: Verify both directions.** Run: `node scripts/drift-check.mjs` → exit 0. Then delete one row, run again → exit 1 naming the missing token. Restore.
- [ ] **Step 4: Commit** — `git commit -m "feat(as1-t12): appserver scorecard + generated-denominator drift pass (D11)"`.

---

### Task 13: Live acceptance + docs close-out (final verification)

**Files:**
- Create: `test/live/appserver-m1.test.ts`
- Modify: `docs/parity/coverage.md` (domain 10 note), `docs/superpowers/specs/2026-07-28-agent-appserver-protocol-design.md` (Revision Notes)

**Interfaces:**
- Consumes: everything. The spec's M1 acceptance, quoted verbatim (§12): *"Live acceptance: a scripted WS client runs spawn→subscribe→turn→park→respond→completed against a real session."*

- [ ] **Step 1: Write the gated live test** (standard gate from Global Constraints). Flow, all over one real WS connection against `listenWs` on an ephemeral port with a real `AppServer` (no DI fakes): `initialize` → `thread/start { config: { permissionMode: "default", cwd: <fresh scratch dir> }, unattended: "park" }` → `thread/subscribe` → `turn/start { input: "Run exactly this bash command: echo appserver-live-ok" }` → await `decision/requested` (kind `permission`, toolName Bash) → `decision/respond { answer: { kind: "allow_once" } }` → await `decision/resolved` then `turn/completed { status: "completed" }` → assert the collected `item/*` notifications include a `toolCall` item with view `command` and an `agentMessage`. Timeout 120s. `thread/close` + server close in `finally`.
- [ ] **Step 2: Keyless run.** Run: `npx vitest run test/live/appserver-m1.test.ts`. Expected: suite SKIPS cleanly (no key in env). Implementers stop here; the controller runs the keyed pass: `set -a; . ../.env; set +a; npx vitest run test/live/appserver-m1.test.ts` → PASS.
- [ ] **Step 3: Full suites.** Run: `npm run typecheck && npm run test:unit && npm run test:tui`. Expected: all green.
- [ ] **Step 4: Docs.** `coverage.md` domain 10: add the M1 line (appserver core loop shipped; scorecard at `docs/parity/appserver.md`). Spec Revision Notes: add "M1 shipped — plan `docs/superpowers/plans/2026-07-28-agent-appserver-m1-core-loop.md`; item ids refined to `message.id#index` (planning); TUI reducer adoption deferred to M2."
- [ ] **Step 5: Commit** — `git commit -m "feat(as1-t13): M1 live acceptance (spawn→subscribe→turn→park→respond→completed) + scorecard/coverage close-out"`.
