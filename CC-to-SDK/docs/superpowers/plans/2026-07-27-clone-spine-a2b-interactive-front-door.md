# A2b — Interactive Front Door Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use doperpowers:subagent-driven-development (recommended) or doperpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the client half of the clone spine — foreground `ccx` (loopback REPL), `ccx attach`, `--detachable`, `Ctrl+Z` detach — with the TUI absorbed into `cc-harness` as one package/one binary, per spec rev 4 §"A2b — the interactive front door".

**Architecture:** The chat REPL moves from the retiring `cc-harness-tui` package into `harness/src/tui/` (dynamic-imported so headless paths never load React). The host socket grows to the full `ChatSession` contract; a lazy `ChatSession` adapter over `RemoteChatSession` becomes the REPL's only session, so default `ccx` talks to its own in-process host through its own socket (one code path) and `attach` is the same client pointed at another pid's socket. Hosts become multi-turn for kind `interactive`; park policy re-scopes from kind to **detachedness**.

**Tech Stack:** TypeScript (ESM, `.js` specifiers), Node ≥18, ink 5 + React 18 (REPL), zod v4 (wire schemas), vitest (+ ink-testing-library), UDS NDJSON transport (shipped in A2a).

## Global Constraints

- Spec: `CC-to-SDK/docs/superpowers/specs/2026-07-26-clone-process-surface-spine-design.md` rev 4 — the §"A2b — the interactive front door" section is the requirements source; acceptance 5, 6, 10 are A2b's.
- All commands run from `CC-to-SDK/harness/` unless stated. Gates after every task: `npm run typecheck` && `npm run test:unit` (plus the task's own suites). `npm run build` must stay green from Task 1 on.
- **The doperpowers bg contract must not move**: `test/contract/` and all existing `test/unit/host-*`/`fleet-*`/`cli-*` behavior stays green throughout. The bg path (one turn = one life, roster finalize at turn end, park-forever) is untouched except where a step names it.
- **Dense hand-style, NO Prettier; ESM import specifiers end in `.js`; DI-by-deps for anything that touches process/net/SDK** (match the existing `deps = { … }` default-param pattern).
- The public barrel `src/index.ts` is curated; `test/unit/index.test.ts` pins it. Add only the exports each task names.
- Live tests gate on `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` and must skip cleanly keyless. Implementers stop at the clean keyless skip; the controller runs keyed suites.
- Never print or commit `.env` contents. Never touch `CODEX_SANDBOX_NETWORK_DISABLED_ENV_VAR`/`CODEX_SANDBOX_ENV_VAR` code.
- Commit per task; no `Co-Authored-By` lines.
- Replies on the host socket keep A1's bare `{ok:…}` shape (no discriminator); only pushed frames carry `t:"event"`.

## File structure (end state)

```
harness/src/session/chatSession.ts     NEW  ChatSession + PermissionFeed + SessionEvents interfaces
harness/src/host/{ops,server,host}.ts  GROW control ops · turn seq · connectionCount · resume · idle reaper · detachedness park
harness/src/client/remote.ts           GROW one method per new op · whenFollowed()
harness/src/client/chatAdapter.ts      NEW  remoteChatSession(): lazy ChatSession adapter (submit-over-follow, feed, events)
harness/src/cli/{args,main,hostMain}.ts GROW attach/-p/--detachable/--idle-timeout arms · foreground runner wiring
harness/src/tui/                       NEW  the chat REPL, moved from ../tui/src (console files deleted, not moved)
harness/src/tui/chatMain.tsx           NEW  runChatClient(): render ChatApp over a remote adapter; the dynamic-import target
harness/test/tui/                      NEW  moved chat tests
CC-to-SDK/tui/                         DELETED entirely (package, console, its CLAUDE.md)
```

---

### Task 1: Packaging cutover — absorb the chat TUI into cc-harness, delete the console and the tui package

**Files:**
- Modify: `harness/package.json`, `harness/tsconfig.json` (and nothing in `tsconfig.build.json` — it inherits)
- Create: `harness/src/tui/` (moved modules), `harness/test/tui/` (moved tests)
- Delete: the whole `CC-to-SDK/tui/` directory at the end of this task
- Test: the moved suites themselves, running under harness vitest

This task is **move-only**: no behavior changes, no rewiring. The moved REPL still drives a local `Session` (Tasks 5–7 rewire it). Intermediate state is valid: the moved code builds, its tests pass, and nothing references it from the bins yet.

- [ ] **Step 1: Add the UI deps**

In `harness/package.json`: add to `dependencies`: `"ink": "^5.0.1"`, `"ink-text-input": "^6.0.0"`, `"react": "^18.3.1"`; add to `devDependencies`: `"ink-testing-library": "^4.0.0"`, `"@types/react": "^18.3.3"` (match the versions currently in `CC-to-SDK/tui/package.json` — copy them verbatim from there, including `react-dom` if it appears as a dependency there). Run `npm install`.

- [ ] **Step 2: Teach harness tsc JSX**

In `harness/tsconfig.json` `compilerOptions`, add `"jsx": "react-jsx"` (the exact value `CC-to-SDK/tui/tsconfig.json` uses). `tsconfig.build.json` extends it and needs no edit.

- [ ] **Step 3: Classify the tui sources — move chat, delete console**

Classification rule: a file moves iff the chat REPL (`chat.tsx` → `ChatApp` → `useChat` closure) transitively imports it, or it is a chat-side test/support module; a file is deleted iff only the daemon console (`cli.tsx` → `App` → `useDaemon` closure) imports it.

Move `CC-to-SDK/tui/src/<f>` → `harness/src/tui/<f>` with `git mv` for:
`chat.tsx`, `ChatApp.tsx`, `ChatComposer.tsx`, `ChatStatusBar.tsx`, `Transcript.tsx`, `TurnSpinner.tsx`, `PermissionDialog.tsx`, `ModelPicker.tsx`, `SessionPicker.tsx`, `TaskPanel.tsx`, `useChat.ts`, `uiBroker.ts`, `render.ts`, `replay.ts`, `liveTurn.ts`, `markdown.ts`, `theme.ts`, `commands.ts`, `commandComplete.ts`, `fileComplete.ts`, `editor.ts`, `bash.ts`, `memory.ts`, `banner.ts`, `spinner.ts`, `taskList.ts`, `thinkLevels.ts`.

Delete (console-only — verify each with a quick grep that no moved file imports it before deleting): `App.tsx`, `Pool.tsx`, `Detail.tsx`, `Composer.tsx`, `StatusBar.tsx`, `ConfirmDialog.tsx`, `cli.tsx`, `format.ts`, `useDaemon.ts`.

If the grep shows a "console" file actually imported by a moved chat file (e.g. `ConfirmDialog` or `theme` shared), MOVE it instead of deleting — the import graph governs, not the list above.

- [ ] **Step 4: Fix the moved files' imports**

In every moved file, rewrite `from "cc-harness"` → `from "../index.js"` (type-only and value imports alike; the barrel does not import `src/tui/`, so no cycle). Relative imports between moved files are unchanged. `harness/src/tui/banner.ts` name-collides with nothing (`src/cli/banner.ts` exists but paths differ — leave both).

- [ ] **Step 5: Move the chat tests, delete the console tests**

Move `CC-to-SDK/tui/test/<f>` → `harness/test/tui/<f>` for: `chat.test.tsx`, `useChat.test.tsx`, `render.test.ts`, `replay.test.ts`, `markdown.test.ts`, `commands.test.ts`, `commandComplete.test.ts`, `fileComplete.test.ts`, `editor.test.ts`, `bash.test.ts`, `banner.test.ts`, `liveTurn.test.ts`, `spinner.test.ts`, `taskList.test.ts`, `thinkLevels.test.ts`, and the `live/` directory. For `app.test.tsx`, `components.test.tsx`, `smoke.test.tsx`, `console-permission.test.tsx`, `useDaemon.test.tsx`, `format.test.ts`: check imports — anything importing `useDaemon`/`App`/`format` is console-side → delete; anything purely chat-side → move. Fix moved tests' imports (`"cc-harness"` → `"../../src/index.js"`, `"../src/x.js"` → `"../../src/tui/x.js"`).

- [ ] **Step 6: Wire the scripts**

In `harness/package.json` scripts, add `"test:tui": "vitest run test/tui"` and confirm the bare `"test": "vitest run"` picks `test/tui` up (it globs the whole `test/` dir). The moved `live/` tests must keep their key-gate skip.

- [ ] **Step 7: Delete the tui package**

`git rm -r CC-to-SDK/tui` (its `package.json`, `tsconfig*`, `CLAUDE.md` and any leftovers go with it). Then `grep -rn "cc-harness-tui\|cc-harness-chat\|cc-harness-console" CC-to-SDK --include="*.ts" --include="*.tsx" --include="*.json" --include="*.mjs" -l` — source/config hits must be fixed (docs hits are Task 9's).

- [ ] **Step 8: Run the gates**

Run: `npm run typecheck && npm run build && npx vitest run test/unit test/tui test/integration`
Expected: all green; the moved suites pass unmodified apart from import paths.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat(a2b): absorb the chat TUI into cc-harness; retire cc-harness-tui and the daemon console"
```

---

### Task 2: Promote ChatSession; grow the host socket to the full contract

**Files:**
- Create: `harness/src/session/chatSession.ts`
- Modify: `harness/src/host/ops.ts`, `harness/src/host/server.ts`, `harness/src/host/host.ts`, `harness/src/tui/useChat.ts` (interface import only), `harness/src/index.ts`
- Test: `harness/test/unit/host-ops.test.ts`, `harness/test/unit/host-control.test.ts` (new), `harness/test/unit/host-server.test.ts`

**Interfaces:**
- Consumes: A2a's `HostServer`/`SessionHost`/`hostOp` as shipped.
- Produces (later tasks rely on these exact names):
  - `ChatSession` (in `session/chatSession.ts`) — the interface verbatim from today's `src/tui/useChat.ts` lines 21–37, plus `PermissionFeed` and `SessionEvents` (Step 1).
  - New ops (wire names): `set_model`, `set_permission_mode`, `set_thinking`, `capabilities`, `compact`, `usage`, `context_usage`, `mcp_status`, `mcp_reconnect`, `mcp_toggle`, `resume`.
  - `HostHandlers.control(op: ControlOp): Promise<Record<string, unknown>>`, `HostHandlers.resume(sessionId: string): Promise<void>`, `HostHandlers.turnSeq(): number`.
  - `HostServer.connectionCount(): number`.
  - `HostStatus` gains `sessionId?: string`; turn events gain `seq: number`.

- [ ] **Step 1: Write `session/chatSession.ts`**

```ts
// harness/src/session/chatSession.ts — the REPL-facing session contract, promoted from the old tui
// package so the lib Session and the remote adapter satisfy ONE interface (spec A2b §2).
import type { CompactOutcome } from "../compaction/index.js";
import type { PermissionDecision } from "../permissions/types.js";
import type { PendingEntry } from "../permissions/pending.js";
import type { HostEvent } from "../host/wire.js";

/** The subset of a session the REPL drives (the lib Session satisfies this structurally). */
export interface ChatSession {
  submit(prompt: string, onMessage: (m: unknown) => void): Promise<{ result: unknown }>;
  setPermissionMode(mode: string): Promise<void>;
  setModel(model?: string): Promise<void>;
  setMaxThinkingTokens(maxTokens: number | null): Promise<void>;
  capabilities(): Promise<{ models: unknown[]; commands: unknown[]; mcpServers: unknown[] }>;
  compact(): Promise<CompactOutcome>;
  interrupt(): Promise<unknown>;
  getContextUsage(): Promise<unknown>;
  usage(): Promise<unknown>;
  mcpServerStatus(): Promise<unknown[]>;
  reconnectMcpServer(name: string): Promise<void>;
  toggleMcpServer(name: string, enabled: boolean): Promise<void>;
  dispose(): Promise<void>;
  readonly sessionId?: string;
}

/** Permission surface a REMOTE session exposes: parked entries + settlement + answering. A local lib
 *  Session does not implement this (its broker seam predates it); consumers feature-test. */
export interface PermissionFeed {
  onPermission(cb: (entry: PendingEntry) => void): () => void;
  onPermissionSettled(cb: (s: { toolUseID: string; by: string; decision: string }) => void): () => void;
  answerPermission(toolUseID: string, decision: PermissionDecision): Promise<{ ok: boolean; alreadyAnsweredBy?: string; error?: string }>;
}

/** The raw host event stream, replay-first. SINGLE-consumer: the first subscriber is flushed every
 *  event buffered since connect; later subscribers get live events only. */
export interface SessionEvents {
  onSessionEvent(cb: (ev: HostEvent) => void): () => void;
}

export function hasPermissionFeed(s: ChatSession): s is ChatSession & PermissionFeed {
  return typeof (s as Partial<PermissionFeed>).answerPermission === "function";
}
export function hasSessionEvents(s: ChatSession): s is ChatSession & SessionEvents {
  return typeof (s as Partial<SessionEvents>).onSessionEvent === "function";
}
```

Then: in `src/tui/useChat.ts` delete its local `interface ChatSession` block and `import type { ChatSession } from "../session/chatSession.js";` re-exporting it from `useChat.ts` (`export type { ChatSession };`) so the moved components' imports keep working unchanged. Add to `src/index.ts`: `export type { ChatSession, PermissionFeed, SessionEvents } from "./session/chatSession.js"; export { hasPermissionFeed, hasSessionEvents } from "./session/chatSession.js";` — and extend `test/unit/index.test.ts`'s pinned-surface list with the new names (it fails otherwise, by design).

- [ ] **Step 2: Failing tests for the new op schemas**

In `test/unit/host-ops.test.ts` add (match the file's existing style):

```ts
it("parses the A2b control ops", () => {
  for (const frame of [
    { op: "set_model", model: "claude-sonnet-4-6" }, { op: "set_model" },
    { op: "set_permission_mode", mode: "acceptEdits" },
    { op: "set_thinking", maxTokens: 8000 }, { op: "set_thinking", maxTokens: null },
    { op: "capabilities" }, { op: "compact" }, { op: "usage" }, { op: "context_usage" },
    { op: "mcp_status" }, { op: "mcp_reconnect", name: "linear" }, { op: "mcp_toggle", name: "linear", enabled: false },
    { op: "resume", sessionId: "a".repeat(8) },
  ]) expect(hostOp.safeParse(frame).success, JSON.stringify(frame)).toBe(true);
});
it("rejects malformed control ops", () => {
  for (const frame of [{ op: "set_permission_mode" }, { op: "set_thinking" }, { op: "mcp_reconnect" }, { op: "mcp_toggle", name: "x" }, { op: "resume" }])
    expect(hostOp.safeParse(frame).success).toBe(false);
});
```

Run: `npx vitest run test/unit/host-ops.test.ts` — expect FAIL (unknown ops).

- [ ] **Step 3: Extend `host/ops.ts`**

Append to the `hostOp` discriminated union:

```ts
z.object({ op: z.literal("set_model"), model: z.string().min(1).optional(), ...withId }),
z.object({ op: z.literal("set_permission_mode"), mode: z.string().min(1), ...withId }),
z.object({ op: z.literal("set_thinking"), maxTokens: z.number().int().nullable(), ...withId }),
z.object({ op: z.literal("capabilities"), ...withId }),
z.object({ op: z.literal("compact"), ...withId }),
z.object({ op: z.literal("usage"), ...withId }),
z.object({ op: z.literal("context_usage"), ...withId }),
z.object({ op: z.literal("mcp_status"), ...withId }),
z.object({ op: z.literal("mcp_reconnect"), name: z.string().min(1), ...withId }),
z.object({ op: z.literal("mcp_toggle"), name: z.string().min(1), enabled: z.boolean(), ...withId }),
z.object({ op: z.literal("resume"), sessionId: z.string().min(1), ...withId }),
```

And export the control subset + widen `HostStatus`:

```ts
export type ControlOp = Extract<HostOp, { op: "set_model" | "set_permission_mode" | "set_thinking" | "capabilities" | "compact" | "usage" | "context_usage" | "mcp_status" | "mcp_reconnect" | "mcp_toggle" }>;
export interface HostStatus { state: FleetState; status: "busy" | "idle"; waitingFor?: string; sessionId?: string }
```

In `host/wire.ts` widen the turn event: `| { kind: "turn"; phase: "start" | "end"; seq?: number; error?: string; truncated?: boolean }`.

- [ ] **Step 4: Failing tests for host control passthrough + seq + sessionId**

New file `test/unit/host-control.test.ts`. Build a fake `HostSession` the way `test/unit/host-session.test.ts` does (find its fixture and reuse the pattern), extended with the optional members, e.g.:

```ts
const calls: string[] = [];
const fake = {
  submit: async (_p: string, on: (m: unknown) => void) => { on({ type: "assistant" }); },
  sessionId: "sid-123", dispose: async () => {},
  setModel: async (m?: string) => { calls.push(`setModel:${m}`); },
  setPermissionMode: async (m: string) => { calls.push(`mode:${m}`); },
  setMaxThinkingTokens: async (t: number | null) => { calls.push(`think:${t}`); },
  capabilities: async () => ({ models: [1], commands: [2], mcpServers: [3] }),
  compact: async () => ({ ok: true, result: "success" }),
  usage: async () => ({ cost: 1 }), getContextUsage: async () => ({ totalTokens: 5 }),
  mcpServerStatus: async () => [{ name: "linear" }],
  reconnectMcpServer: async (n: string) => { calls.push(`rec:${n}`); },
  toggleMcpServer: async (n: string, e: boolean) => { calls.push(`tog:${n}:${e}`); },
};
```

Assert: (a) `host.control({op:"capabilities"})` → `{ ok: true, models: [1], commands: [2], mcpServers: [3] }`; (b) `control({op:"set_model", model:"m"})` → `{ok:true}` and `calls` contains `setModel:m`; (c) on a fake WITHOUT `compact`, `control({op:"compact"})` **throws** `"compact unsupported by this host"`; (d) `host.status().sessionId === "sid-123"`; (e) after `runTask("x")`, followers received `{kind:"turn", phase:"start", seq:1}` and `{kind:"turn", phase:"end", seq:1}`, and a second `runTask` uses `seq:2`; (f) `host.turnSeq()` returns the seq of the last started turn.

Run: `npx vitest run test/unit/host-control.test.ts` — expect FAIL.

- [ ] **Step 5: Implement in `host/host.ts`**

(1) Widen `HostSession` with the ten optional members (exact signatures from `ChatSession`, all optional — existing fakes stay valid):

```ts
setModel?(model?: string): Promise<void>;
setPermissionMode?(mode: string): Promise<void>;
setMaxThinkingTokens?(maxTokens: number | null): Promise<void>;
capabilities?(): Promise<{ models: unknown[]; commands: unknown[]; mcpServers: unknown[] }>;
compact?(): Promise<unknown>;
usage?(): Promise<unknown>;
getContextUsage?(): Promise<unknown>;
mcpServerStatus?(): Promise<unknown[]>;
reconnectMcpServer?(name: string): Promise<void>;
toggleMcpServer?(name: string, enabled: boolean): Promise<void>;
```

(2) Turn seq — field `private turnSeq_ = 0;` and `turnSeq(): number { return this.turnSeq_; }`. In `runTask`, after the busy-guard throw: `const seq = ++this.turnSeq_;` and thread `seq` into both turn emits: `this.emit({ kind: "turn", phase: "start", seq });` / both `end` emits (error arm included).

(3) `control()` — one switch, throwing on an absent member so the server's catch turns it into an error reply:

```ts
async control(op: ControlOp): Promise<Record<string, unknown>> {
  const s = this.session;
  const need = <T>(v: T | undefined, name: string): T => { if (!v) throw new Error(`${name} unsupported by this host`); return v; };
  switch (op.op) {
    case "set_model": await need(s?.setModel?.bind(s), "set_model")(op.model); return { ok: true };
    case "set_permission_mode": await need(s?.setPermissionMode?.bind(s), "set_permission_mode")(op.mode); return { ok: true };
    case "set_thinking": await need(s?.setMaxThinkingTokens?.bind(s), "set_thinking")(op.maxTokens); return { ok: true };
    case "capabilities": return { ok: true, ...await need(s?.capabilities?.bind(s), "capabilities")() };
    case "compact": return { ok: true, outcome: await need(s?.compact?.bind(s), "compact")() };
    case "usage": return { ok: true, usage: await need(s?.usage?.bind(s), "usage")() };
    case "context_usage": return { ok: true, usage: await need(s?.getContextUsage?.bind(s), "context_usage")() };
    case "mcp_status": return { ok: true, servers: await need(s?.mcpServerStatus?.bind(s), "mcp_status")() };
    case "mcp_reconnect": await need(s?.reconnectMcpServer?.bind(s), "mcp_reconnect")(op.name); return { ok: true };
    case "mcp_toggle": await need(s?.toggleMcpServer?.bind(s), "mcp_toggle")(op.name, op.enabled); return { ok: true };
  }
}
```

(4) `status()` gains the session id: in the non-blocked return AND the blocked return, spread `...(this.session?.sessionId ? { sessionId: this.session.sessionId } : {})`.

(5) `resumeSession()` (used by Task 4's server wiring; implement now, gate like runTask):

```ts
/** Swap the underlying SDK session for a resume of `sessionId`. Interactive /resume path — refused
 *  mid-turn for the same reason a second prompt is. The old session's dispose is bounded by the same
 *  grace as teardown: an idle dispose resolves immediately, but this must never hang the socket op. */
async resumeSession(sessionId: string): Promise<void> {
  if (this.turnInFlight) throw new Error(`host ${this.short} is busy`);
  const old = this.session;
  this.session = this.deps.openSession({ ...this.opts.config, resume: sessionId, permissionBroker: this.broker() });
  this.turnBuffer.reset(); this.settledBy.clear();
  this.emit({ kind: "state", status: this.status() });
  const graceMs = this.deps.disposeGraceMs ?? DISPOSE_GRACE_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((r) => { timer = setTimeout(r, graceMs); (timer as { unref?: () => void }).unref?.(); });
  await Promise.race([old?.dispose().catch(() => {}) ?? Promise.resolve(), deadline]);
  clearTimeout(timer);
}
```

(6) Wire the two new handlers into the `HostServer` construction in `start()`: `control: (op) => this.control(op), resume: (sid) => this.resumeSession(sid), turnSeq: () => this.turnSeq(),`.

- [ ] **Step 6: Implement in `host/server.ts`**

Extend `HostHandlers`:

```ts
control(op: ControlOp): Promise<Record<string, unknown>>;
resume(sessionId: string): Promise<void>;
turnSeq(): number;
```

(import `ControlOp` from `./ops.js`). Add `connectionCount(): number { return this.open.size; }` to `HostServer`. In `dispatch`, add arms:

```ts
case "set_model": case "set_permission_mode": case "set_thinking": case "capabilities": case "compact":
case "usage": case "context_usage": case "mcp_status": case "mcp_reconnect": case "mcp_toggle":
  return await this.handlers.control(op.data);
// resume swaps the session under the socket; gated exactly like prompt and for the same reason.
case "resume": {
  if (this.handlers.busy()) return { ok: false, error: "busy" };
  await this.handlers.resume(op.data.sessionId);
  return { ok: true };
}
```

And the `prompt` arm's accepted reply gains the seq (AFTER the fired call so runTask's synchronous prefix has incremented it):

```ts
case "prompt": {
  if (this.handlers.busy()) return { ok: false, error: "busy" };
  void this.handlers.prompt(op.data.text).catch(() => {});
  // runTask increments its seq synchronously before its first await, so it is readable here — the
  // client correlates its submit() to THIS turn's end event by it (adapter, Task 5).
  return { ok: true, accepted: true, seq: this.handlers.turnSeq() };
}
```

In `test/unit/host-server.test.ts`, extend the fixture handlers with `control`/`resume`/`turnSeq` (minimal fakes) and add asserts: a `capabilities` frame round-trips the control reply; `resume` is refused `busy` when `busy()` is true; `prompt` reply carries `seq`.

- [ ] **Step 7: Run the gates**

Run: `npm run typecheck && npx vitest run test/unit` — expect green (existing host fixtures compile because the new `HostSession` members are optional; existing `HostHandlers` fixtures need the three new members added — do it in this task, mechanically).

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat(a2b): promote ChatSession; host socket grows the full control-op surface, turn seq, connectionCount"
```

---

### Task 3: RemoteChatSession — one method per new op, follow ack

**Files:**
- Modify: `harness/src/client/remote.ts`
- Test: `harness/test/unit/client-remote.test.ts`

**Interfaces:**
- Consumes: Task 2's ops and reply shapes.
- Produces (Task 5 relies on): on `RemoteChatSession` —
  `setModelOp(model?)`, `setPermissionModeOp(mode)`, `setThinkingOp(maxTokens)`, `capabilitiesOp()`, `compactOp()`, `usageOp()`, `contextUsageOp()`, `mcpStatusOp()`, `mcpReconnectOp(name)`, `mcpToggleOp(name, enabled)`, `resumeOp(sessionId)` — each `Promise<{ ok: boolean; error?: string } & Record<string, unknown>>`; `prompt()`'s reply type gains `seq?: number`; and `whenFollowed(): Promise<unknown> | undefined`.
  (The `…Op` suffix keeps the raw wire client visibly distinct from the `ChatSession` methods the Task 5 adapter layers on top.)

- [ ] **Step 1: Failing tests**

`test/unit/client-remote.test.ts` already runs a real UDS server fixture — extend it: (a) `capabilitiesOp()` resolves the server's reply body; (b) `whenFollowed()` is `undefined` before `follow()` and resolves after the server acks; (c) `prompt()` surfaces `seq` from the reply. Run to FAIL.

- [ ] **Step 2: Implement**

```ts
setModelOp(model?: string) { return this.send<{ ok: boolean; error?: string }>({ op: "set_model", ...(model ? { model } : {}) }); }
setPermissionModeOp(mode: string) { return this.send<{ ok: boolean; error?: string }>({ op: "set_permission_mode", mode }); }
setThinkingOp(maxTokens: number | null) { return this.send<{ ok: boolean; error?: string }>({ op: "set_thinking", maxTokens }); }
capabilitiesOp() { return this.send<{ ok: boolean; error?: string; models?: unknown[]; commands?: unknown[]; mcpServers?: unknown[] }>({ op: "capabilities" }); }
compactOp() { return this.send<{ ok: boolean; error?: string; outcome?: unknown }>({ op: "compact" }); }
usageOp() { return this.send<{ ok: boolean; error?: string; usage?: unknown }>({ op: "usage" }); }
contextUsageOp() { return this.send<{ ok: boolean; error?: string; usage?: unknown }>({ op: "context_usage" }); }
mcpStatusOp() { return this.send<{ ok: boolean; error?: string; servers?: unknown[] }>({ op: "mcp_status" }); }
mcpReconnectOp(name: string) { return this.send<{ ok: boolean; error?: string }>({ op: "mcp_reconnect", name }); }
mcpToggleOp(name: string, enabled: boolean) { return this.send<{ ok: boolean; error?: string }>({ op: "mcp_toggle", name, enabled }); }
resumeOp(sessionId: string) { return this.send<{ ok: boolean; error?: string }>({ op: "resume", sessionId }); }
```

`prompt()`'s declared reply type: `Promise<{ ok: boolean; accepted?: boolean; seq?: number; error?: string }>`. For the follow ack, in `follow()` replace `if (first) void this.send({ op: "follow" }).catch(() => {});` with `if (first) { this.followAck = this.send({ op: "follow" }); this.followAck.catch(() => {}); }` plus field `private followAck?: Promise<unknown>;` and `whenFollowed(): Promise<unknown> | undefined { return this.followAck; }` (cleared to `undefined` when the last follower leaves, next `follow` re-sends).

- [ ] **Step 3: Run + commit**

Run: `npx vitest run test/unit/client-remote.test.ts && npm run typecheck` — green.

```bash
git add -A && git commit -m "feat(a2b): RemoteChatSession control-op methods + follow ack + prompt seq"
```

---

### Task 4: Host lifetime — detachedness-scoped park, connection-counted deny, multi-turn interactive hosts, idle reaper

**Files:**
- Modify: `harness/src/host/host.ts`, `harness/src/cli/hostMain.ts`
- Test: `harness/test/unit/host-park.test.ts`, `harness/test/unit/host-lifetime.test.ts` (new), `harness/test/unit/cli-hostmain.test.ts` (extend the existing hostMain test file — find it by `grep -rln "parseHostArgv" test/unit`)

**Interfaces:**
- Consumes: Task 2's `resumeSession`, `HostServer.connectionCount`.
- Produces: `SessionHostOpts` gains `detached: boolean; idleTimeoutMs?: number`; `SessionHost.finished: Promise<void>`; `runHostMain` keeps an interactive host alive until stopped.

- [ ] **Step 1: Failing tests — park scope + deny counts connections**

In `test/unit/host-park.test.ts` (existing file; it builds hosts around a fake session and a broker request):
- a host with `kind: "interactive", detached: true` and **zero connections** PARKS (request stays pending, `pending()` length 1) — today's kind-scoped rule denies it; this is the `--detachable` case.
- a host with `kind: "interactive", detached: false` and zero connections DENIES.
- the deny rule counts **connections**, not followers: with `detached: false`, a client connected to the real server (use the UDS fixture pattern from `test/unit/host-server.test.ts` or connect a bare `net.connect`) but NOT following → request PARKS (today it would deny).
- `kind: "bg"` (always spawned detached) still parks — pin it with `detached: true`.

Every existing `new SessionHost({...})` call site in tests gains `detached: <value>` — bg fixtures `true`, interactive fixtures `false` unless the test is about detachable.

Run to FAIL (compile errors on the new required field are the failure).

- [ ] **Step 2: Implement the scope change**

`SessionHostOpts` gains `detached: boolean; idleTimeoutMs?: number;` (`detached` REQUIRED — a defaulted boolean is how bg would silently lose its park). In `broker()` replace the kind rule:

```ts
// Detachedness, not kind, decides (spec A2b §4): a detached host's purpose is surviving unattended —
// park. An in-process host whose UI is gone has nobody left to answer — deny. Counted on CONNECTIONS,
// not followers: a client that connected but has not (yet) followed is still a present human.
if (!this.opts.detached && (this.server?.connectionCount() ?? 0) === 0) return { kind: "deny" };
```

In `cli/hostMain.ts` `hostOptsFrom`, the child is by construction detached: add `detached: true` to the returned opts (both kinds — `--__host` exists only for forks).

- [ ] **Step 3: Failing tests — multi-turn state + finished + idle reaper**

New `test/unit/host-lifetime.test.ts` (reuse the fake-session pattern):
- after a successful `runTask` on `kind:"interactive"`, `status().state === "working"` (NOT `"done"`) and `status().status === "idle"`; on `kind:"bg"` it stays `"done"` (pin).
- a second `runTask` on an interactive host succeeds after the first completes (multi-turn), and the roster row (use the env-injected roster dir pattern from `test/unit/host-session.test.ts`) is still non-terminal between turns; after `stop("done")` the roster row reads `done`.
- `host.finished` resolves after `stop()` completes (and not before — assert pending via a raced sentinel while idle).
- idle reaper: with `idleTimeoutMs: 30` (and no fake-timer games — 30ms real), an interactive host with no turn is stopped (`finished` resolves, roster `done`) ~30ms after `start()`; a `runTask` resets the timer (submit a turn at t=15ms, assert still alive at t=40ms, dead by ~turn-end+30ms); a PARKED turn does not idle out (park a request, wait 60ms, still alive).

Run to FAIL.

- [ ] **Step 4: Implement lifetime**

In `host.ts`:

(1) `runTask` success arm: `this.state = this.opts.kind === "bg" ? "done" : "working";` (replaces `this.state = "done"`). The error arm stays `error` for both kinds — the next interactive turn's `this.state = "working"` at runTask start already recovers it.

(2) `finished`:

```ts
private finishedResolve!: () => void;
/** Resolves when teardown completes (server closed). runHostMain awaits this for interactive hosts. */
readonly finished: Promise<void> = new Promise((r) => { this.finishedResolve = r; });
```

In `teardown`'s `finally`, after `await this.server?.close();` add `this.finishedResolve();`.

(3) Idle reaper:

```ts
private idleTimer?: ReturnType<typeof setTimeout>;
/** Arm (or re-arm) the idle stop. Only ever configured for detachable hosts; a parked turn never idles
 *  out because turnInFlight spans the park, and the timer is only armed when a turn is NOT in flight. */
private armIdle(): void {
  if (!this.opts.idleTimeoutMs) return;
  clearTimeout(this.idleTimer);
  this.idleTimer = setTimeout(() => { void this.stop("done"); }, this.opts.idleTimeoutMs);
  (this.idleTimer as { unref?: () => void }).unref?.();
}
```

Call `this.armIdle()` at the end of `start()` and in `runTask`'s `finally` (after `turnInFlight = false`); `clearTimeout(this.idleTimer)` at the top of `runTask` (after the busy-guard) and in `teardown` (first line of the `try`).

- [ ] **Step 5: Failing test + implement — runHostMain keeps interactive hosts alive**

In the hostMain unit test file: with an injected fake `SessionHost` (add a `deps` seam to `runHostMain` if it lacks one — mirror `main.ts`'s `MainDeps` pattern: `runHostMain(argv, deps?)` with `deps.makeHost?: (opts) => SessionHost-like`), assert: for `--__kind interactive`, `runHostMain` does NOT resolve until the fake's `finished` resolves, and it never calls `stop()` itself before that; for `--__kind bg` behavior is unchanged (runTask then stop). Implement:

```ts
export async function runHostMain(argv: string[], deps: { makeHost?: (o: SessionHostOpts) => Pick<SessionHost, "start" | "runTask" | "stop" | "finished"> } = {}): Promise<void> {
  const { opts, prompt } = hostOptsFrom(argv);
  const host = (deps.makeHost ?? ((o: SessionHostOpts) => new SessionHost(o)))(opts);
  await host.start();
  if (opts.kind === "interactive") {
    // A detached interactive host lives until the stop op / idle reaper / a signal ends it. SIGTERM is
    // how an operator (or the OS) asks nicely; record `stopped`, the operator-ended state.
    process.on("SIGTERM", () => { void host.stop("stopped"); });
    await host.finished;
    return;
  }
  try { if (prompt) await host.runTask(prompt); }
  finally { await host.stop(); }
}
```

(`hostOptsFrom` for kind interactive must NOT return a prompt — `--detachable` parents keep the prompt client-side, Task 8. Add: `...(inv.prompt && kind === "bg" ? { prompt: inv.prompt } : {})` and a test pinning that an interactive child argv with a stray positional does not produce a prompt.)

- [ ] **Step 6: idleTimeout plumb for the child**

`hostOptsFrom` reads `inv.idleTimeoutSec` (parser lands in Task 8) — add now, tolerating absence: `...(inv.idleTimeoutSec ? { idleTimeoutMs: inv.idleTimeoutSec * 1000 } : {})` on the returned opts, and add `idleTimeoutSec?: number` to `CcxInvocation` in `cli/args.ts` (field only; the flag arm stays the loud rejection until Task 8 rewires it).

- [ ] **Step 7: Gates + commit**

Run: `npm run typecheck && npx vitest run test/unit test/integration` — green (integration fixtures gain `detached:` too).

```bash
git add -A && git commit -m "feat(a2b): detachedness-scoped park, connection-counted deny, multi-turn interactive hosts, idle reaper"
```

---

### Task 5: The ChatSession adapter — `remoteChatSession()`

**Files:**
- Create: `harness/src/client/chatAdapter.ts`
- Modify: `harness/src/index.ts` (export `remoteChatSession`)
- Test: `harness/test/unit/client-chat-adapter.test.ts` (new; real UDS host with fake `HostSession`, the `test/integration/host-client.test.ts` fixture pattern — copy its host+socket setup helper, don't import across suites)

**Interfaces:**
- Consumes: Tasks 2–4 (`ChatSession`/`PermissionFeed`/`SessionEvents`, `…Op` methods, `whenFollowed`, `prompt().seq`, turn-event `seq`).
- Produces (Tasks 6–8 rely on): `remoteChatSession(socketPath: string, opts?: { label?: string; resume?: string; connect?: (p: string, o?: { label?: string }) => Promise<RemoteChatSession> }): ChatSession & PermissionFeed & SessionEvents & { detach(): void; whenReady(): Promise<void>; pendingNow(): PendingEntry[] }`.

- [ ] **Step 1: Failing tests**

Cases (each over a real UDS host):
1. **submit round trip**: `submit("hi", onMessage)` → onMessage receives the fake turn's messages; resolves with `{result}` = the message whose `type === "result"` (make the fake emit one); host saw exactly one prompt.
2. **busy refusal throws**: while the host runs a slow turn (fake session that awaits a deferred), a second `submit` rejects with `/busy/`.
3. **seq correlation**: attach the adapter while a turn is mid-flight (deferred fake), then complete that turn, then `submit` a new prompt — the submit resolves only after the SECOND turn's end (assert the first end did not settle it: submit's promise still pending after end #1).
4. **feed**: park a permission on the host (ask-routed fake broker request via `host.broker().request(...)` — the pattern `host-park.test.ts` uses) → `onPermission` fires with the entry; `answerPermission(id, {kind:"allow_once"})` resolves `{ok:true}` and the host's park settles; a second `answerPermission` on the same id resolves `{ok:true, alreadyAnsweredBy}`; `onPermissionSettled` fired once.
5. **replay-first single consumer**: park BEFORE the adapter connects; after `whenReady()`, `pendingNow()` contains the entry and the first `onSessionEvent` subscriber is flushed the replayed `permission` + `state` frames in order.
6. **sessionId**: after any state/status traffic, `adapter.sessionId` returns the host's session id (getter, sync).
7. **dispose detaches**: `dispose()` closes the client socket; the host keeps running (a later direct `RemoteChatSession` connect still gets a status answer) and a parked permission stays parked.
8. **resume opt**: `remoteChatSession(path, { resume: "sid-9" })` sends `resume` before `follow` (fake `openSession` records construction configs — assert the second construction carries `resume:"sid-9"`).

Run to FAIL.

- [ ] **Step 2: Implement `client/chatAdapter.ts`**

```ts
// harness/src/client/chatAdapter.ts — a lazily-connecting ChatSession over RemoteChatSession. The REPL's
// makeSession() must return synchronously (ink renders immediately); every method awaits `ready`.
import { RemoteChatSession } from "./remote.js";
import type { HostEvent } from "../host/wire.js";
import type { HostStatus } from "../host/ops.js";
import type { ChatSession, PermissionFeed, SessionEvents } from "../session/chatSession.js";
import type { PendingEntry } from "../permissions/pending.js";
import type { PermissionDecision } from "../permissions/types.js";
import type { CompactOutcome } from "../compaction/index.js";

export interface RemoteChatOpts { label?: string; resume?: string; connect?: (p: string, o?: { label?: string }) => Promise<RemoteChatSession>; }
export type RemoteChat = ChatSession & PermissionFeed & SessionEvents & { detach(): void; whenReady(): Promise<void>; pendingNow(): PendingEntry[] };

export function remoteChatSession(socketPath: string, opts: RemoteChatOpts = {}): RemoteChat {
  let raw: RemoteChatSession | undefined;
  let sessionId: string | undefined;
  let turnWaiter: { seq: number; resolve: () => void; reject: (e: Error) => void } | undefined;
  let turnSink: ((m: unknown) => void) | undefined;
  const pendingList: PendingEntry[] = [];
  const permCbs = new Set<(e: PendingEntry) => void>();
  const settledCbs = new Set<(s: { toolUseID: string; by: string; decision: string }) => void>();
  let eventCb: ((ev: HostEvent) => void) | undefined;
  const backlog: HostEvent[] = [];          // events before the single consumer subscribes

  const route = (ev: HostEvent): void => {
    if (ev.kind === "message") { try { turnSink?.(ev.data); } catch { /* sink is the consumer's problem */ } }
    else if (ev.kind === "permission") { pendingList.push(ev.entry); for (const cb of [...permCbs]) { try { cb(ev.entry); } catch {} } }
    else if (ev.kind === "permission_settled") {
      const i = pendingList.findIndex((e) => e.toolUseID === ev.toolUseID);
      if (i >= 0) pendingList.splice(i, 1);
      for (const cb of [...settledCbs]) { try { cb({ toolUseID: ev.toolUseID, by: ev.by, decision: ev.decision }); } catch {} }
    } else if (ev.kind === "state") { if (ev.status.sessionId) sessionId = ev.status.sessionId; }
    else if (ev.kind === "turn" && ev.phase === "end" && turnWaiter && ev.seq === turnWaiter.seq) {
      const w = turnWaiter; turnWaiter = undefined;
      ev.error ? w.reject(new Error(ev.error)) : w.resolve();
    }
    if (eventCb) { try { eventCb(ev); } catch {} } else backlog.push(ev);
  };

  const ready: Promise<RemoteChatSession> = (async () => {
    const r = await (opts.connect ?? ((p, o) => RemoteChatSession.connect(p, o)))(socketPath, { label: opts.label ?? `ccx-${process.pid}` });
    raw = r;
    if (opts.resume) { const rep = await r.resumeOp(opts.resume); if (!rep.ok) throw new Error(rep.error ?? "resume refused"); }
    r.follow(route);
    await r.whenFollowed();                 // registration acked — a prompt sent after this cannot race it
    return r;
  })();
  ready.catch(() => {});                     // surfaced per-call below, never unhandled

  const orFail = <T extends { ok: boolean; error?: string }>(rep: T): T => { if (!rep.ok) throw new Error(rep.error ?? "host refused"); return rep; };

  return {
    get sessionId() { return sessionId; },
    whenReady: async () => { await ready; },
    pendingNow: () => [...pendingList],
    async submit(prompt, onMessage) {
      const r = await ready;
      let result: unknown;
      turnSink = (m) => { if ((m as { type?: string })?.type === "result") result = m; onMessage(m); };
      let seqReply: { ok: boolean; seq?: number; error?: string };
      try { seqReply = await r.prompt(prompt); } catch (e) { turnSink = undefined; throw e; }
      if (!seqReply.ok || seqReply.seq === undefined) { turnSink = undefined; throw new Error(seqReply.error ?? "prompt refused"); }
      try { await new Promise<void>((resolve, reject) => { turnWaiter = { seq: seqReply.seq!, resolve, reject }; }); }
      finally { turnSink = undefined; }
      return { result };
    },
    async setPermissionMode(mode) { orFail(await (await ready).setPermissionModeOp(mode)); },
    async setModel(model) { orFail(await (await ready).setModelOp(model)); },
    async setMaxThinkingTokens(t) { orFail(await (await ready).setThinkingOp(t)); },
    async capabilities() { const rep = orFail(await (await ready).capabilitiesOp()); return { models: rep.models ?? [], commands: rep.commands ?? [], mcpServers: rep.mcpServers ?? [] }; },
    async compact() { return orFail(await (await ready).compactOp()).outcome as CompactOutcome; },
    async interrupt() { return orFail(await (await ready).interrupt()); },
    async getContextUsage() { return orFail(await (await ready).contextUsageOp()).usage; },
    async usage() { return orFail(await (await ready).usageOp()).usage; },
    async mcpServerStatus() { return orFail(await (await ready).mcpStatusOp()).servers ?? []; },
    async reconnectMcpServer(name) { orFail(await (await ready).mcpReconnectOp(name)); },
    async toggleMcpServer(name, enabled) { orFail(await (await ready).mcpToggleOp(name, enabled)); },
    // dispose() is the ChatSession teardown hook useChat calls on unmount/swap — for a REMOTE session
    // that means detach, never stop: the host, its turn and its parks outlive this client (spec §5).
    async dispose() { raw?.detach(); void ready.catch(() => {}); },
    detach() { raw?.detach(); },
    onPermission(cb) { permCbs.add(cb); for (const e of [...pendingList]) { try { cb(e); } catch {} } return () => { permCbs.delete(cb); }; },
    onPermissionSettled(cb) { settledCbs.add(cb); return () => { settledCbs.delete(cb); }; },
    async answerPermission(toolUseID, decision: PermissionDecision) { return (await ready).answer(toolUseID, decision); },
    onSessionEvent(cb) {
      if (!eventCb) { eventCb = cb; for (const ev of backlog.splice(0)) { try { cb(ev); } catch {} } }
      else eventCb = cb;                     // single consumer: a re-subscribe replaces (useChat's session swap)
      return () => { if (eventCb === cb) eventCb = undefined; };
    },
  };
}
```

Add to `src/index.ts`: `export { remoteChatSession } from "./client/chatAdapter.js"; export type { RemoteChat, RemoteChatOpts } from "./client/chatAdapter.js";` and extend `test/unit/index.test.ts`'s pin.

- [ ] **Step 3: Gates + commit**

Run: `npx vitest run test/unit/client-chat-adapter.test.ts && npm run typecheck && npx vitest run test/unit`

```bash
git add -A && git commit -m "feat(a2b): remoteChatSession — lazy ChatSession adapter with seq-correlated submit, permission feed, replay-first events"
```

---

### Task 6: useChat/ChatApp rewiring — event-driven rendering, permission feed, Ctrl+Z, initial prompt

**Files:**
- Modify: `harness/src/tui/useChat.ts`, `harness/src/tui/ChatApp.tsx`, `harness/src/tui/PermissionDialog.tsx` (props type only, if it names `PermissionRequest`), delete `harness/src/tui/uiBroker.ts`
- Test: `harness/test/tui/useChat.test.tsx`, `harness/test/tui/chat.test.tsx` (rework the fakes to the adapter surface)

**Interfaces:**
- Consumes: `ChatSession & PermissionFeed & SessionEvents` (Task 5's `RemoteChat` shape) via `hasPermissionFeed`/`hasSessionEvents`.
- Produces: `ChatApp` props change to `{ makeSession: (resume?: string) => ChatSession; client: { kind: "loopback" | "attached"; short?: string }; onDetach?: () => void; initialPrompt?: string; cwd; initialResume?; initialLines?; hookOpts? }` — **`broker` prop deleted**. Task 7/8 construct these.

The principle (spec A2b §2+§5, acceptance 7): **the host event stream is the single rendering source; `submit` is a command channel.** A turn started by another attached client renders exactly like one started here.

- [ ] **Step 1: Rework the test fakes**

Build one fake `RemoteChat` for the tui tests (put it in `harness/test/tui/helpers/fakeRemote.ts`): a scriptable object implementing `ChatSession & PermissionFeed & SessionEvents` with test hooks `pushEvent(ev: HostEvent)`, `parkPermission(entry)`, `settlePermission(toolUseID, by, decision)`, and a `submit` that (by default) pushes `turn start` → N `message` events → `turn end` through the same event pipe and resolves after the end event — mirroring the adapter's contract. Port the existing `useChat.test.tsx`/`chat.test.tsx` fakes onto it.

Write the failing cases first:
1. an **externally-started turn** (no `submit` call — just `pushEvent` turn start/messages/end) renders streaming lines and lands in the transcript; `busy` is true between start and end.
2. a parked permission arriving via the feed opens the dialog; answering calls `answerPermission` with the entry's `toolUseID`; `{ok:true, alreadyAnsweredBy:"eve"}` clears the dialog and appends a `answered by eve` notice.
3. `settlePermission(...by:"system", decision:"deny")` (no local answer) clears the dialog and appends a notice — the A2a `permission_settled` case.
4. Ctrl+Z (`stdin.write("\x1a")`) with `client.kind === "attached"` calls `onDetach` and does NOT deny the pending permission (fake records no `answerPermission` call); with `kind === "loopback"` it appends the `not detachable — run with --detachable` notice and does not exit.
5. `initialPrompt: "do the thing"` submits exactly once on mount.
6. own-submit path: `submit("hi")` echoes the prompt line, and the turn renders from EVENTS (assert the fake's submit `onMessage` callback is a no-op passthrough — rendering happens even if submit's onMessage delivers nothing).

Run to FAIL.

- [ ] **Step 2: Rewire `useChat.ts`**

- Delete the `ui: UiBrokerHandle` parameter and the `ui.setHandler` effect. `Pending` becomes `{ entry: PendingEntry }`; state field `pending: PendingEntry | null` plus a FIFO of extras (`pendingQueue: PendingEntry[]` — dialog shows head, answering advances).
- New effect, keyed on `session`:

```ts
const liveTurnRef = useRef<LiveTurn | null>(null);   // the in-flight turn's renderer (replaces runTurn's local)
useEffect(() => {
  if (!hasSessionEvents(session)) return;
  const lt = liveTurnRef;
  const off = session.onSessionEvent((ev) => {
    if (disposed.current) return;
    if (ev.kind === "turn" && ev.phase === "start") { lt.current = new LiveTurn(); setBusy(true); setTurnStartedAt(Date.now()); setTurnTokens(0); setStreaming([]); }
    else if (ev.kind === "message") { const l = lt.current; if (!l) return; l.ingest(ev.data); taskListRef.current.ingest(ev.data); setStreaming(l.snapshot()); setTasks(taskListRef.current.snapshot()); setSubagentActive(l.subagentActive); setTurnTokens(l.outputTokens); }
    else if (ev.kind === "turn" && ev.phase === "end") { const l = lt.current; lt.current = null; if (l) { if (ev.error) l.fail(ev.error); setLines((x) => [...x, ...l.finalize()]); if (l.model) setModel(l.model); } setStreaming([]); setBusy(false); setSubagentActive(false); void refreshCtx(); drainNext(); }
  });
  const offPerm = hasPermissionFeed(session) ? session.onPermission((entry) => { if (!disposed.current) pushPending(entry); }) : undefined;
  const offSettled = hasPermissionFeed(session) ? session.onPermissionSettled((s) => { if (!disposed.current) dropPending(s.toolUseID, s.by, s.decision); }) : undefined;
  return () => { off(); offPerm?.(); offSettled?.(); };
}, [session]);
```

with `pushPending`/`dropPending` maintaining head+queue, `dropPending` appending a dim notice \`↳ ${toolName} ${decision === "deny" ? "denied" : "allowed"} by ${by}\` when the dropped entry was displayed and the settler wasn't this client.
- `runTurn` shrinks to the command channel: echo the prompt line, then `session.submit(prompt, () => {}).catch((e) => { append([{ text: `✗ ${e.message}`, color: "red" }]); setBusy(false); drainNext(); })` — no `.finally` rendering (events own it). Keep the queue/drain logic; `busy` is now event-driven so `drainNext` stays hooked to the turn-end arm above.
- `resolvePermission(d)` becomes: the head entry's id → `void session.answerPermission(id, d).then((r) => { if (r.alreadyAnsweredBy) append(notice); })` (feature-gated on `hasPermissionFeed`); advance the queue locally on the settled event, not optimistically.
- The unmount sentinel effect drops its `pendingRef.current?.resolve({kind:"deny"})` line — an unanswered remote entry must stay parked (detach ≠ deny). `disposed`-marking stays.
- `opts` gains `initialPrompt?: string` — a mount effect (same `ranInitial` guard style as `initialResume`) that calls `submit(opts.initialPrompt)` once. `initialResume` and `initialPrompt` are mutually exclusive at the call site (Task 7 passes at most one).

- [ ] **Step 3: Rewire `ChatApp.tsx`**

Props per the Interfaces block. Delete the `broker` prop and its pass-through; pass `initialPrompt` into `useChat`. Add to the `useInput` handler:

```ts
if (key.ctrl && input === "z") {
  if (client.kind === "attached") { onDetach?.(); exit(); }
  else appendNotice("not detachable — run with --detachable, or ccx attach from another terminal");
  return;
}
```

(`exit` from ink's `useApp()`; `appendNotice` = however the file currently appends a system line — reuse its existing mechanism.) `PermissionDialog` props: render from `PendingEntry` (`toolName`, `input`, optional `title`/`displayName`/`description`) — the same fields it rendered from `PermissionRequest`, so this is a type-name swap plus prop threading.

- [ ] **Step 4: Delete `uiBroker.ts`** and its test file; fix any lingering imports (`grep -rn "uiBroker" harness/src harness/test`).

- [ ] **Step 5: Gates + commit**

Run: `npx vitest run test/tui && npm run typecheck && npx vitest run test/unit`

```bash
git add -A && git commit -m "feat(a2b): event-driven REPL — single rendering source, permission feed dialogs, Ctrl+Z detach, initial prompt"
```

---

### Task 7: Foreground `ccx` — loopback client, `-p` one-shot, bounded signal teardown

**Files:**
- Create: `harness/src/tui/chatMain.tsx`
- Modify: `harness/src/cli/main.ts`
- Test: `harness/test/unit/cli-main.test.ts` (routing), `harness/test/integration/loopback.test.ts` (new)

**Interfaces:**
- Consumes: Tasks 4–6 (`SessionHost` with `detached:false`, `remoteChatSession`, new `ChatApp` props).
- Produces: `runChatClient(opts: ChatClientOpts): Promise<void>` from `src/tui/chatMain.tsx` where

```ts
export interface ChatClientOpts {
  socketPath: string;
  client: { kind: "loopback" | "attached"; short?: string };
  cwd: string;
  initialPrompt?: string;
  initialLines?: RenderLine[];        // pre-rendered transcript replay (attach, Task 8) or the banner
  replayedUuids?: Set<string>;        // uuids already rendered from disk — filled by attach (Task 8), threaded to useChat's dedup
  onDetach?: () => void;
  makeSession?: (resume?: string) => ChatSession;   // test seam; default builds remoteChatSession(socketPath, { resume })
}
```

- [ ] **Step 1: `src/tui/chatMain.tsx`**

```tsx
// harness/src/tui/chatMain.tsx — the dynamic-import target for every interactive invocation. Renders
// ChatApp over a remote adapter; owning the HOST is the caller's job (loopback owns one, attach does not).
import React from "react";
import { render } from "ink";
import { remoteChatSession } from "../client/chatAdapter.js";
import type { ChatSession } from "../session/chatSession.js";
import { ChatApp } from "./ChatApp.js";
import type { RenderLine } from "./render.js";

export interface ChatClientOpts { /* exactly as in the Interfaces block above */ }

export async function runChatClient(opts: ChatClientOpts): Promise<void> {
  const makeSession = opts.makeSession ?? ((resume?: string) => remoteChatSession(opts.socketPath, { ...(resume ? { resume } : {}) }));
  const app = render(
    <ChatApp makeSession={makeSession} client={opts.client} cwd={opts.cwd}
      initialPrompt={opts.initialPrompt} initialLines={opts.initialLines} onDetach={opts.onDetach} />,
    { exitOnCtrlC: false },
  );
  await app.waitUntilExit();
}
```

(Carry over `chat.tsx`'s `--permission-mode`/`--think`/banner handling INTO the caller (Step 2) where the flags already live in `CcxInvocation`; `chat.tsx` itself is deleted in this step — it was the old bin entry. Move whatever launch-mode/think parsing `ChatApp` needs into `ChatClientOpts` as `hookOpts` if `ChatApp` still takes it — keep the existing prop threading, just sourced from `CcxInvocation` fields now.)

- [ ] **Step 2: Wire `main.ts`**

`MainDeps` gains four members (defaults below). **Wiring rule: the run arm calls `runForegroundImpl(inv, deps)` DIRECTLY, passing main's own `deps`** — a `runForeground` stored inside `defaults` would close over `defaults` and silently ignore an injected `makeHost`/`runChatClient` (the self-reference trap):

```ts
runChatClient: (o: ChatClientOpts) => Promise<void>;   // import type { ChatClientOpts } from "../tui/chatMain.js" — type-only, React-free
makeHost: (o: SessionHostOpts) => SessionHost;
runOnce: (inv: CcxInvocation) => Promise<string>;
isTTY: () => boolean;
```

defaults:

```ts
makeHost: (o) => new SessionHost(o),
// The React-free guarantee: the import happens only when an interactive path actually calls it.
runChatClient: async (o) => (await import("../tui/chatMain.js")).runChatClient(o),
runOnce: async (inv) => {
  const { createHarness } = await import("../harness.js");
  const r = await createHarness(inv.config).run(inv.prompt!);
  const res = r.result as { result?: unknown } | undefined;
  return typeof res?.result === "string" ? res.result : JSON.stringify(r.result);
},
isTTY: () => Boolean(process.stdin.isTTY),
```

The `run` arm becomes:

```ts
case "run": {
  if (inv.worktree !== undefined) { /* existing worktree block, unchanged, now ABOVE the fg/bg split */ }
  if (inv.bg) { console.log(deps.spawnDetached(inv).banner); return 0; }
  if (inv.detachable) { /* Task 8 — keep the exit-2 refusal until then */ }
  if (inv.print) {
    // -p: one-shot headless print — the `cc-harness "<prompt>"` shape folded into ccx (contract table).
    if (!inv.prompt) return fail("-p requires a prompt", 2);
    console.log(await deps.runOnce(inv));
    return 0;
  }
  if (!deps.isTTY()) return fail("foreground ccx needs a terminal (use -p or --bg for scripts)", 2);
  return await runForegroundImpl(inv, deps);
}
```

and, in `main.ts` (exported for its test):

```ts
/** Foreground ccx: an IN-PROCESS host + a loopback client over its own socket — exactly one ChatSession
 *  code path, so the daily REPL continuously exercises the attach protocol (spec A2b §3). */
export async function runForegroundImpl(inv: CcxInvocation, deps: MainDeps): Promise<number> {
  const short = mintShortId(Math.random);            // import from ../fleet/paths.js — match its real signature
  const name = inv.name ?? short;
  process.env.CLAUDE_CODE_SESSION_NAME = name;       // engine self-registration, same as the fork path
  process.env.CLAUDE_CODE_SESSION_KIND = "interactive";
  const host = deps.makeHost({
    short, name, cwd: inv.config.cwd ?? process.cwd(), kind: "interactive", detached: false,
    ...(inv.worktreePath ? { worktree: inv.worktreePath } : {}), config: inv.config,
  });
  await host.start();
  // Terminal gone or OS says stop: finalize `done` — the deliberate asymmetry (acceptance 10): a default
  // session's life IS its terminal's. stop() is memoized+bounded, so double signals are safe.
  const onSignal = () => { void host.stop("done").finally(() => process.exit(0)); };
  process.on("SIGHUP", onSignal); process.on("SIGTERM", onSignal);
  try {
    await deps.runChatClient({
      socketPath: hostSocketPath(process.pid), client: { kind: "loopback" }, cwd: inv.config.cwd ?? process.cwd(),
      ...(inv.prompt ? { initialPrompt: inv.prompt } : {}),
    });
  } finally {
    process.off("SIGHUP", onSignal); process.off("SIGTERM", onSignal);
    await host.stop("done");
  }
  return 0;
}
```

(`hostSocketPath` import from `../fleet/paths.js`. The banner: build `initialLines` with the existing `welcomeBanner` from `src/tui/banner.ts` — pass through `ChatClientOpts.initialLines`; import type-only so main.ts stays React-free — `welcomeBanner` is a pure function in a `.ts` module, importable directly.)

- [ ] **Step 3: Routing unit tests**

In `test/unit/cli-main.test.ts`: `-p "hi"` calls `runOnce` and prints its return; `-p` with no prompt exits 2; bare `ccx` with injected `isTTY: () => true` reaches the foreground path — assert the injected `makeHost` was constructed with `{ kind: "interactive", detached: false }` and the injected `runChatClient` received `client: { kind: "loopback" }`; with `isTTY: () => false` it exits 2 with the terminal message; `--bg` still spawns; `attach`/`--detachable` still exit 2 (until Task 8).

- [ ] **Step 4: Integration test — loopback round trip**

`test/integration/loopback.test.ts`: build a real `SessionHost` (`detached:false`, fake `HostSession` that streams 3 messages incl. a `result`) + real server on a tmp socket; then `remoteChatSession(path)` and drive it as the REPL would: `whenReady()`, `submit`, assert messages arrived and result returned; then park a permission via `host.broker().request(...)` — with the client connected it must PARK (connection-counted rule, the loopback case); `answerPermission` settles it; `dispose()` then `host.stop("done")` completes < 2s (teardown-liveness). Also assert the deny case: a second host with `detached:false` and NO client denies immediately.

- [ ] **Step 5: Gates + commit**

Run: `npm run typecheck && npx vitest run test/unit test/tui test/integration && npm run build`

```bash
git add -A && git commit -m "feat(a2b): foreground ccx — in-process host + loopback REPL client, -p one-shot, bounded signal teardown"
```

---

### Task 8: `ccx attach` + `--detachable` + `--idle-timeout`

**Files:**
- Modify: `harness/src/cli/args.ts`, `harness/src/cli/main.ts`, `harness/src/cli/spawn.ts`, `harness/src/tui/replay.ts` (only if its exports need a param — see Step 3)
- Create: `harness/src/cli/attach.ts`
- Test: `harness/test/unit/cli-args.test.ts`, `harness/test/unit/cli-attach.test.ts` (new), `harness/test/integration/attach.test.ts` (new)

**Interfaces:**
- Consumes: `resolveTarget` (from `cli/lifecycle.ts`), `hostSocketPath`, `remoteChatSession`, `runChatClient`, `getSessionMessages` (from the sessions read API), `replayLines` (from `src/tui/replay.ts`).
- Produces: `prepareAttach(target: string, deps?): Promise<{ socketPath: string; short: string; initialLines: RenderLine[] }>` in `cli/attach.ts`.

- [ ] **Step 1: Parser — `--idle-timeout` + detachable constraints**

`cli/args.ts`: replace the `--idle-timeout` throw arm with:

```ts
case "--idle-timeout": {
  const v = Number(val(t));
  if (!Number.isInteger(v) || v <= 0) throw new Error(`--idle-timeout requires a positive integer of seconds, got ${JSON.stringify(argv[i])}`);
  a.idleTimeoutSec = v; break;
}
```

Post-parse validation (end of `parseCcx`): `if (a.idleTimeoutSec && !a.detachable) throw new Error("--idle-timeout only applies to --detachable sessions");` and `if (a.detachable && a.bg) throw new Error("--detachable and --bg are mutually exclusive");`. Tests in `cli-args.test.ts` for all three behaviors (valid, non-integer, misplaced).

`cli/spawn.ts` `configFlags` — forward it to the child: after the loop add `if (inv.idleTimeoutSec) out.push("--idle-timeout", String(inv.idleTimeoutSec));`. (The child's `parseCcx` accepts it because the child argv carries `--detachable`? It does NOT — the child gets `--__kind interactive` and spawnDetached strips mode flags. So: in `hostMain.ts`'s `parseHostArgv` path the re-parsed `inv` has `detachable:false` — **relax the post-parse rule to skip when `argv` came through `--__host`**: simplest correct fix is for `spawnDetached` to keep NOT forwarding `--detachable`, and for the post-parse validation to live in `main.ts`'s run arm instead of `parseCcx` (main-level policy, not grammar). Put both checks at the top of the `run` case in `main.ts`, delete them from `parseCcx`, and test them through `main()`.)

- [ ] **Step 2: `--detachable` spawn + auto-attach**

In `main.ts`'s run arm, replace the detachable refusal:

```ts
if (inv.detachable) {
  const { short, banner } = deps.spawnDetached({ ...inv, prompt: undefined });   // the prompt stays HERE — the client submits it
  console.log(banner);
  return await attachToImpl(short, { ...(inv.prompt ? { initialPrompt: inv.prompt } : {}), fromSpawn: true }, deps);
}
```

`spawnDetached` needs no change for kind — it already computes `kind = inv.bg ? "bg" : "interactive"`.

- [ ] **Step 3: `cli/attach.ts`**

```ts
// harness/src/cli/attach.ts — resolve a target to a live socket + build the replay lines.
import { resolveTarget } from "./lifecycle.js";
import { hostSocketPath } from "../fleet/paths.js";
import { TERMINAL } from "../fleet/roster.js";
import { getSessionMessages } from "../sessions/index.js";      // adjust to the real module path (grep `export function getSessionMessages`)
import { replayLines } from "../tui/replay.js";
import type { RenderLine } from "../tui/render.js";

export interface PrepareAttachDeps {
  resolve?: typeof resolveTarget;
  messages?: (id: string, opts: { cwd?: string }) => Promise<unknown[]>;
  now?: () => number;
}

/** Resolve + read the PAST (disk) half of the attach replay. The LIVE half (mid-turn buffer, parked
 *  permissions, current state) arrives over the socket via the adapter's replay-first event stream —
 *  probe 62 proved the disk transcript contains COMPLETED turns only, so disk-then-follow covers
 *  everything, and uuid-dedup (in the tui layer, Step 4) removes the overlap when a replayed buffer
 *  message was also already flushed to disk. */
export async function prepareAttach(target: string, deps: PrepareAttachDeps = {}): Promise<{ socketPath: string; short: string; sessionId?: string; cwd: string; initialLines: RenderLine[] }> {
  const row = (deps.resolve ?? resolveTarget)(target);
  if (TERMINAL.has(row.state)) throw new Error(`session ${row.short} has ended (${row.state}) — resume it with: ccx --resume ${row.sessionId ?? "<uuid>"}`);
  let initialLines: RenderLine[] = [];
  if (row.sessionId) {
    try { initialLines = replayLines(await (deps.messages ?? ((id, o) => getSessionMessages(id, o)))(row.sessionId, { cwd: row.cwd }), { id: row.sessionId }); }
    catch { initialLines = [{ text: "⚠ no persisted history yet — showing live turn only", dim: true }]; }
  }
  return { socketPath: hostSocketPath(row.pid), short: row.short, sessionId: row.sessionId, cwd: row.cwd, initialLines };
}
```

(If `resolveTarget`'s signature differs — it takes `(target, env)` — match it exactly; check `cli/lifecycle.ts:23`. If `replayLines`' options differ, match `src/tui/replay.ts`'s real export.)

- [ ] **Step 4: uuid dedup for the live-replay overlap**

In `useChat.ts`'s event effect, thread a `seenUuids: Set<string>` built by the CALLER from the disk replay (new `opts.replayedUuids?: Set<string>`): in the `message` arm, `const u = (ev.data as { uuid?: string })?.uuid; if (u && opts.replayedUuids?.has(u)) return;`. In `prepareAttach`'s return add `replayedUuids: Set<string>` (collect `m.uuid` strings while building `initialLines`). Thread through `ChatClientOpts` → `ChatApp` → `useChat`. A tui test: a replayed-uuid message event does not render; a fresh-uuid one does.

- [ ] **Step 5: `attach` arm + `attachTo`**

Same wiring rule as Task 7 (no self-referencing default): export `attachToImpl` from `main.ts` and call it directly with main's `deps`. `MainDeps` gains two seams so the impl is unit-testable: `prepareAttach: typeof prepareAttach` (default: the real one) and `probeSocket: (path: string) => Promise<void>` (default: the fleet's existing socket-liveness probe — find it in `src/fleet/status.ts` or `liveness.ts` and reuse, do not write a second one).

```ts
export async function attachToImpl(target: string, o: { initialPrompt?: string }, deps: MainDeps): Promise<number> {
  let prep;
  // A --detachable child needs a beat to start listening: short retry, bounded at ~5s, then surface
  // the real error (a genuinely missing session fails fast on its first resolveTarget throw — only
  // roster-row-not-yet-written / connect-refused shapes are worth retrying; rethrow anything else).
  for (let i = 0; ; i++) {
    try { prep = await deps.prepareAttach(target); await deps.probeSocket(prep.socketPath); break; }
    catch (e) { if (i >= 20) throw e; await new Promise((r) => setTimeout(r, 250)); }
  }
  await deps.runChatClient({
    socketPath: prep.socketPath, client: { kind: "attached", short: prep.short }, cwd: prep.cwd,
    initialLines: prep.initialLines, replayedUuids: prep.replayedUuids,
    ...(o.initialPrompt ? { initialPrompt: o.initialPrompt } : {}),
    onDetach: () => { console.error(`detached — session ${prep.short} keeps running · reattach: ccx attach ${prep.short}`); },
  });
  return 0;
}
```

Refinement to the bounded retry: distinguish the retryable shapes — wrap only `resolveTarget`'s "not found" (a `--detachable` child may not have written its row yet; but a plain `ccx attach typo` must not spin 5 s — retry "not found" only when `o` carries `fromSpawn: true`, which the `--detachable` caller sets) and the socket probe's `ECONNREFUSED`/`ENOENT`. The `attach` arm: `case "attach": { if (!inv.target) return fail("attach requires a session: a short id, a session uuid or a name", 2); try { return await attachToImpl(inv.target, {}, deps); } catch (e) { return fail(msg(e), 1); } }` — and the Task-8 `--detachable` arm calls `attachToImpl(short, { initialPrompt: inv.prompt, fromSpawn: true }, deps)` (add `fromSpawn?: boolean` to the opts type).

- [ ] **Step 6: Unit tests**

`cli-attach.test.ts` (DI, no sockets): terminal roster row → throws with the resume hint; live row → returns socketPath keyed by row pid; missing history → the notice line; `replayedUuids` collected. `cli-main.test.ts` (all via injected `prepareAttach`/`probeSocket`/`runChatClient`): `attach x` reaches `runChatClient` with `client.kind: "attached"`; a `prepareAttach` that throws "not found" WITHOUT `fromSpawn` fails fast (no 5 s spin — assert < ~1 s); `--detachable` spawns with `prompt: undefined` then attaches with `initialPrompt` and `fromSpawn` retry semantics.

- [ ] **Step 7: Integration test — the attach story over a real socket**

`test/integration/attach.test.ts` (fixture pattern from `host-client.test.ts`; fake `HostSession`, real `SessionHost`+`HostServer`+adapter):
1. **late-join replay**: host `detached:true` mid-turn (deferred fake) with a parked permission; a `remoteChatSession` attaching now receives, in order: buffered messages → the parked `permission` → `state` (blocked); `pendingNow()` has the entry.
2. **detach leaves everything**: `dispose()` the adapter; the park is still pending on the host; a second adapter attaches and sees it again.
3. **answer resumes**: second adapter answers; the fake tool proceeds; turn end reaches the second adapter.
4. **multi-turn over the socket**: after turn 1 ends, a new `submit` on the attached adapter is ACCEPTED (multi-turn interactive host) and runs turn 2 with `seq` 2.
5. **idle reaper end-to-end**: host with `idleTimeoutMs: 100` and no client activity finalizes `done` (roster) and its `finished` resolves.

- [ ] **Step 8: Gates + commit**

Run: `npm run typecheck && npx vitest run test/unit test/tui test/integration && npm run build`

```bash
git add -A && git commit -m "feat(a2b): ccx attach + --detachable + --idle-timeout — resolve, disk+live replay with uuid dedup, auto-attach"
```

---

### Task 9: Docs — CLAUDE.md maps, stale-name sweep

**Files:**
- Modify: `CC-to-SDK/CLAUDE.md`, `CC-to-SDK/harness/CLAUDE.md`, `codex_somersault/CLAUDE.md` (repo root — one line names `tui/`)
- (Deleted with Task 1 already: `CC-to-SDK/tui/CLAUDE.md`)

- [ ] **Step 1:** `CC-to-SDK/CLAUDE.md` — Structure section: remove the `tui/` bullet; the `harness/` bullet now reads that it ships the product binary `ccx` including the Ink REPL (`src/tui/`, dynamic-imported), and that the daemon console retired with A2b. Repo-root `CLAUDE.md`: update the one `CC-to-SDK` line the same way if it names the tui.
- [ ] **Step 2:** `harness/CLAUDE.md` — module map gains `src/tui/` (chat REPL: useChat event-driven over `ChatSession`, components, `chatMain.tsx` dynamic-import target), `src/client/chatAdapter.ts`, `src/cli/attach.ts`, `src/session/chatSession.ts`; commands section gains `test:tui` and the note that `test/tui` uses ink-testing-library (await-a-tick-before-keys discipline — copy that paragraph over from the old tui CLAUDE.md before it is lost to git history).
- [ ] **Step 3:** Sweep: `grep -rn "cc-harness-tui\|cc-harness-chat\|cc-harness-console" CC-to-SDK/docs CC-to-SDK/harness *.md` — fix every hit that describes the PRESENT (historical mentions in specs/plans/parity history stay as-is).
- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "docs(a2b): CLAUDE.md maps for the absorbed TUI; retire tui-package references"
```

---

### Task 10: Final verification — full suite + spec acceptance

- [ ] **Step 1: Full keyless gate**

Run from `harness/`: `npm run typecheck && npm run build && npx vitest run`
Expected: every suite green, `test/live` + `test/tui/live` skipped cleanly, `test/contract` green (python3 present).

- [ ] **Step 2: Spec acceptance, keyless halves**

- Acceptance 12 regression (id resolution now also serves `attach`): `node dist/cli/bin.js attach nonexistent` → exit 1, stderr `ccx: …`.
- `--detachable` + `--bg` together → exit 2; `--idle-timeout` without `--detachable` → exit 2.
- `node dist/cli/bin.js -p` (no prompt) → exit 2.

- [ ] **Step 3: Spec acceptance 5, 6, 10 — live (controller runs these keyed; implementer stops after Step 2)**

From the spec, verbatim targets:
- **5**: "`ccx attach <id>` replays the conversation, follows the in-flight turn, and renders a parked permission dialog if there is one." — Run: spawn `ccx --bg --permission-mode default --settings '{"permissions":{"ask":["Bash(*)"]}}' -n acc5 "Run the bash command: echo PARKED-OK. Use the Bash tool."`, wait for `agents --json --all` to show `state:"blocked"`, then `ccx attach <short>` in a real terminal: expect transcript replay, the Bash permission dialog with `echo PARKED-OK` visible.
- **6**: "Answering resumes the session; `Ctrl+Z` detaches **without denying** the pending permission, and the session keeps running." — In the attached client from 5: press Ctrl+Z BEFORE answering → back at the shell with the detach notice; `agents` still shows `blocked`; re-attach, answer allow → session runs to `done`.
- **10**: "A default `ccx` session is attachable; closing its original terminal ends it." — Run `ccx` in one terminal, from another `ccx attach <short>` succeeds (both see a turn); close the first terminal; the host exits and `agents --all` shows the row terminal (`done`).

- [ ] **Step 4: Update the spec's living tail**

Append the A2b outcome to `## Outcomes & Retrospective` (what shipped, live results, deviations) and any `## Surprises & Discoveries` entries earned during execution. Commit as `docs(spec): spine — A2b outcomes`.
