# Interactive Chat REPL + Inline Permission Prompts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `cc-harness-chat` — a standalone in-process Claude-Code-style chat REPL with rich tool rendering and inline permission dialogs, over the lib `Session`.

**Architecture:** Two layers (mirrors increment 2). (1) A small core seam in `harness/src/permissions/`: a `PermissionBroker` interface + `createPermissionGate(broker)` that builds the SDK `canUseTool` and owns a per-session "always" allowlist; wired into `resolveOptions` so `openSession` picks it up. (2) A new `cc-harness-chat` bin **inside** the existing `cc-harness-tui` package: a `useChat` hook owning an in-process `Session` (started in `default` mode), a pure `render.ts` rich formatter, and `Transcript`/`PermissionDialog`/`ChatStatusBar`/`ChatApp` components reusing increment 2's `Composer`.

**Tech Stack:** TypeScript (ESM), Claude Agent SDK 0.3.178, React 18 + Ink 5, Vitest + ink-testing-library.

## Global Constraints

- **NO Prettier** — dense hand-style; match the surrounding code (compact, multi-statement lines).
- **ESM import specifiers end in `.js`** (`from "./render.js"`); core imports use the bare `"cc-harness"` specifier.
- **`cc-harness` must be rebuilt** (`cd ../harness && npm run build`) before any `tui/` typecheck or test that imports new core exports — tsc resolves `cc-harness` types via `harness/dist/index.d.ts` (gitignored).
- **New core exports are advanced-seam tier** — add to `index.ts`, the `index.test.ts` `EXPECTED` pin, and `API-STABILITY.md`.
- **Verified `canUseTool` contract (probes 17/17b/17c/17d, 2026-06-19):** `default` is broker-live (fires on Edit/Write/dangerous ops; reads + safe bash auto-allowed); `bypassPermissions` is the silent toggle; `auto` is NOT silent. UI hints (`title`/`displayName`) are **absent headlessly** → the dialog reconstructs the prompt from `toolName`+`input`. `PermissionResult` is `{behavior:"allow", updatedInput}` | `{behavior:"deny", message}`.
- **Idempotent teardown discipline:** a `disposed` ref guards every async `setState`; any parked permission promise is settled → deny on teardown; `dispose()` runs at most once.
- **ink `useInput` timing:** `useInput` subscribes in a passive effect — tests must `await` rendered state (`waitFor`/`pressUntil`) BEFORE writing keys.
- **Git:** commit each task to the current branch (`main`); **no `Co-Authored-By`**; never push.

---

### Task 1: Core permission types + gate

**Files:**
- Create: `harness/src/permissions/types.ts`
- Create: `harness/src/permissions/gate.ts`
- Test: `harness/test/unit/permissions.gate.test.ts`

**Interfaces:**
- Produces: `PermissionDecision = {kind:"allow_once"} | {kind:"allow_always"} | {kind:"deny"}`; `PermissionRequest = {toolName:string, input:Record<string,unknown>, toolUseID:string, title?:string, displayName?:string, description?:string, signal:AbortSignal}`; `PermissionBroker = {request(req:PermissionRequest):Promise<PermissionDecision>}`; `createPermissionGate(broker:PermissionBroker):CanUseTool` where `CanUseTool = (toolName, input, options) => Promise<PermissionResult>`.

- [ ] **Step 1: Write the failing test**

```ts
// harness/test/unit/permissions.gate.test.ts
import { describe, it, expect, vi } from "vitest";
import { createPermissionGate } from "../../src/permissions/gate.js";
import type { PermissionBroker, PermissionDecision } from "../../src/permissions/types.js";

const opts = (signal = new AbortController().signal) => ({ signal, toolUseID: "t1" });
const brokerReturning = (...decisions: PermissionDecision[]): PermissionBroker & { calls: number } => {
  let i = 0; const b: any = { calls: 0, async request() { b.calls++; return decisions[Math.min(i++, decisions.length - 1)]; } };
  return b;
};

describe("createPermissionGate", () => {
  it("maps allow_once → allow with updatedInput", async () => {
    const gate = createPermissionGate(brokerReturning({ kind: "allow_once" }));
    expect(await gate("Edit", { a: 1 }, opts())).toEqual({ behavior: "allow", updatedInput: { a: 1 } });
  });
  it("maps deny → deny with a message naming the tool", async () => {
    const r = await createPermissionGate(brokerReturning({ kind: "deny" }))("Bash", {}, opts());
    expect(r.behavior).toBe("deny");
    expect((r as any).message).toContain("Bash");
  });
  it("allow_always short-circuits the next call to the same tool (broker not re-consulted)", async () => {
    const broker = brokerReturning({ kind: "allow_always" });
    const gate = createPermissionGate(broker);
    expect((await gate("Edit", { a: 1 }, opts())).behavior).toBe("allow");
    expect((await gate("Edit", { a: 2 }, opts())).behavior).toBe("allow");
    expect(broker.calls).toBe(1); // second Edit was allowlisted, broker never called again
  });
  it("a pre-aborted signal denies without consulting the broker", async () => {
    const broker = brokerReturning({ kind: "allow_once" });
    const ac = new AbortController(); ac.abort();
    const r = await createPermissionGate(broker)("Edit", {}, opts(ac.signal));
    expect(r.behavior).toBe("deny");
    expect(broker.calls).toBe(0);
  });
  it("aborting WHILE awaiting the broker resolves to deny", async () => {
    const hanging: PermissionBroker = { request: () => new Promise(() => {}) }; // never resolves
    const ac = new AbortController();
    const p = createPermissionGate(hanging)("Edit", {}, opts(ac.signal));
    ac.abort();
    expect((await p).behavior).toBe("deny");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd harness && npx vitest run test/unit/permissions.gate.test.ts`
Expected: FAIL — "Cannot find module '../../src/permissions/gate.js'".

- [ ] **Step 3: Write the types**

```ts
// harness/src/permissions/types.ts
export type PermissionDecision =
  | { kind: "allow_once" }
  | { kind: "allow_always" }   // remembered for the session, by tool name
  | { kind: "deny" };

/** What the broker is asked to decide. UI hints (title/displayName/description) are often ABSENT headlessly
 *  (the bridge that renders them is claude.ai-coupled) — consumers MUST render from toolName + input alone. */
export interface PermissionRequest {
  toolName: string;
  input: Record<string, unknown>;
  toolUseID: string;
  title?: string;
  displayName?: string;
  description?: string;
  signal: AbortSignal;
}

export interface PermissionBroker {
  request(req: PermissionRequest): Promise<PermissionDecision>;
}
```

- [ ] **Step 4: Write the gate**

```ts
// harness/src/permissions/gate.ts
import type { PermissionBroker, PermissionDecision, PermissionRequest } from "./types.js";

// The SDK CanUseTool shape (sdk.d.ts): (toolName, input, options) => Promise<PermissionResult>.
type CanUseToolOptions = { signal: AbortSignal; toolUseID: string; title?: string; displayName?: string; description?: string; [k: string]: unknown };
type PermissionResult = { behavior: "allow"; updatedInput: Record<string, unknown> } | { behavior: "deny"; message: string; interrupt?: boolean };
export type CanUseTool = (toolName: string, input: Record<string, unknown>, options: CanUseToolOptions) => Promise<PermissionResult>;

// Resolve the broker, but lose the race to an abort (turn interrupted) → deny. Pre-aborted → deny immediately.
function requestOrAbort(broker: PermissionBroker, req: PermissionRequest, signal: AbortSignal): Promise<PermissionDecision> {
  if (signal?.aborted) return Promise.resolve({ kind: "deny" });
  return new Promise((resolve) => {
    signal?.addEventListener("abort", () => resolve({ kind: "deny" }), { once: true });
    broker.request(req).then((d) => resolve(d), () => resolve({ kind: "deny" }));
  });
}

/** Build the SDK canUseTool from an interactive broker. Owns the per-session "always" allowlist:
 *  a tool in the set is allowed immediately, never re-consulting the broker. */
export function createPermissionGate(broker: PermissionBroker): CanUseTool {
  const allowed = new Set<string>();
  return async (toolName, input, options) => {
    if (allowed.has(toolName)) return { behavior: "allow", updatedInput: input };
    const req: PermissionRequest = { toolName, input, toolUseID: options.toolUseID, title: options.title, displayName: options.displayName, description: options.description, signal: options.signal };
    const decision = await requestOrAbort(broker, req, options.signal);
    if (decision.kind === "deny") return { behavior: "deny", message: `User denied ${toolName}`, interrupt: options.signal?.aborted || undefined };
    if (decision.kind === "allow_always") allowed.add(toolName);
    return { behavior: "allow", updatedInput: input };
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd harness && npx vitest run test/unit/permissions.gate.test.ts && npm run typecheck`
Expected: 5 passed; typecheck exit 0.

- [ ] **Step 6: Commit**

```bash
git add harness/src/permissions/ harness/test/unit/permissions.gate.test.ts
git commit -m "feat(permissions): PermissionBroker + createPermissionGate (incr3 core seam)"
```

---

### Task 2: Wire `permissionBroker` into config + resolveOptions

**Files:**
- Modify: `harness/src/config/types.ts` (add field to `HarnessConfig`)
- Modify: `harness/src/config/resolveOptions.ts:47` (set `options.canUseTool`)
- Test: `harness/test/unit/permissions.wiring.test.ts`

**Interfaces:**
- Consumes: `createPermissionGate` (Task 1), `PermissionBroker` (Task 1).
- Produces: `HarnessConfig.permissionBroker?: PermissionBroker`; `resolveOptions` sets `options.canUseTool` iff a broker is supplied.

- [ ] **Step 1: Write the failing test**

```ts
// harness/test/unit/permissions.wiring.test.ts
import { describe, it, expect } from "vitest";
import { resolveOptions } from "../../src/config/resolveOptions.js";
import type { PermissionBroker } from "../../src/permissions/types.js";

const broker: PermissionBroker = { request: async () => ({ kind: "allow_once" }) };

describe("resolveOptions × permissionBroker", () => {
  it("sets canUseTool to a function when a broker is supplied", () => {
    const opts = resolveOptions({ permissionBroker: broker });
    expect(typeof opts.canUseTool).toBe("function");
  });
  it("leaves canUseTool unset when no broker is supplied (existing callers unchanged)", () => {
    expect(resolveOptions({}).canUseTool).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd harness && npx vitest run test/unit/permissions.wiring.test.ts`
Expected: FAIL — first assertion: `canUseTool` is `undefined` (typeof "undefined" !== "function").

- [ ] **Step 3: Add the config field**

In `harness/src/config/types.ts`, add to the top imports:

```ts
import type { PermissionBroker } from "../permissions/types.js";
```

Then inside `interface HarnessConfig`, immediately after the `permissionMode?: PermissionMode;` line (currently `:30`), add:

```ts
  // interactive permission broker (incr3): when set, resolveOptions wires it as the SDK canUseTool.
  // Only consulted in broker-live modes (default/acceptEdits/plan); bypassPermissions/dontAsk bypass it.
  permissionBroker?: PermissionBroker;
```

- [ ] **Step 4: Wire it in resolveOptions**

In `harness/src/config/resolveOptions.ts`, add to the top imports:

```ts
import { createPermissionGate } from "../permissions/gate.js";
```

Then immediately after line 47 (the `allowDangerouslySkipPermissions` line) and before `if (config.mcpServers)`, add:

```ts
  if (config.permissionBroker) options.canUseTool = createPermissionGate(config.permissionBroker);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd harness && npx vitest run test/unit/permissions.wiring.test.ts && npm run typecheck`
Expected: 2 passed; typecheck exit 0.

- [ ] **Step 6: Commit**

```bash
git add harness/src/config/types.ts harness/src/config/resolveOptions.ts harness/test/unit/permissions.wiring.test.ts
git commit -m "feat(config): wire permissionBroker → canUseTool in resolveOptions (incr3)"
```

---

### Task 3: Export the seam + update the public-API pin

**Files:**
- Modify: `harness/src/index.ts`
- Modify: `harness/test/unit/index.test.ts`
- Modify: `harness/API-STABILITY.md`

**Interfaces:**
- Consumes: `createPermissionGate`, `PermissionBroker`, `PermissionDecision`, `PermissionRequest`.
- Produces: public exports `createPermissionGate` (value) + `PermissionBroker`/`PermissionDecision`/`PermissionRequest` (types).

- [ ] **Step 1: Update the pin test first (it should fail)**

In `harness/test/unit/index.test.ts`, add a new `it(...)` block after the increment-2 daemon block (currently ending `:37`):

```ts
  it("exports the permission seam (advanced-seam, increment 3)", () => {
    expect(typeof api.createPermissionGate).toBe("function");
  });
```

Then in the `EXPECTED` array, insert `"createPermissionGate",` in alphabetical order — between `"createHarness",` and `"createSwarmMcpServer",`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd harness && npx vitest run test/unit/index.test.ts`
Expected: FAIL — `api.createPermissionGate` is undefined; `Object.keys(api).sort()` lacks `createPermissionGate`.

- [ ] **Step 3: Add the exports**

In `harness/src/index.ts`, append:

```ts
export { createPermissionGate } from "./permissions/gate.js";
export type { PermissionBroker, PermissionDecision, PermissionRequest } from "./permissions/types.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd harness && npx vitest run test/unit/index.test.ts && npm run typecheck`
Expected: all passed; typecheck exit 0.

- [ ] **Step 5: Document in API-STABILITY.md**

Open `harness/API-STABILITY.md`, find the advanced-seam rows added in increment 2 (`connectDaemon`, `collect`), and add rows in the same table/format:

- `createPermissionGate` — advanced-seam — "Build an SDK `canUseTool` from an interactive `PermissionBroker` (owns the per-session allowlist)."
- `PermissionBroker` / `PermissionDecision` / `PermissionRequest` (types) — advanced-seam — "Interactive permission-prompt seam (the chat REPL implements the broker)."

- [ ] **Step 6: Commit**

```bash
git add harness/src/index.ts harness/test/unit/index.test.ts harness/API-STABILITY.md
git commit -m "feat(api): export permission seam — createPermissionGate + types (advanced-seam, incr3)"
```

---

### Task 4: Rich tool-rendering formatter (`render.ts`)

**Files:**
- Create: `tui/src/render.ts`
- Test: `tui/test/render.test.ts`

**Interfaces:**
- Produces: `RenderLine = {text:string, color?:string, dim?:boolean}`; `renderMessage(m:unknown):RenderLine[]`.

This task imports no core types, so no harness rebuild is needed first.

- [ ] **Step 1: Write the failing test**

```ts
// tui/test/render.test.ts
import { describe, it, expect } from "vitest";
import { renderMessage } from "../src/render.js";

const asst = (content: unknown[]) => ({ type: "assistant", message: { content } });

describe("renderMessage", () => {
  it("renders assistant text verbatim, one line per newline", () => {
    expect(renderMessage(asst([{ type: "text", text: "hello\nworld" }]))).toEqual([{ text: "hello" }, { text: "world" }]);
  });
  it("renders thinking dimmed", () => {
    expect(renderMessage(asst([{ type: "thinking", thinking: "hmm" }]))).toEqual([{ text: "hmm", dim: true }]);
  });
  it("renders Edit as a colored diff", () => {
    const out = renderMessage(asst([{ type: "tool_use", name: "Edit", input: { file_path: "f.ts", old_string: "a", new_string: "b" } }]));
    expect(out[0]).toEqual({ text: "⚙ Edit f.ts" });
    expect(out).toContainEqual({ text: "  - a", color: "red" });
    expect(out).toContainEqual({ text: "  + b", color: "green" });
  });
  it("renders Bash as a command marker", () => {
    expect(renderMessage(asst([{ type: "tool_use", name: "Bash", input: { command: "echo hi" } }]))).toEqual([{ text: "⚙ Bash echo hi" }]);
  });
  it("renders Read as a file ref", () => {
    expect(renderMessage(asst([{ type: "tool_use", name: "Read", input: { file_path: "x.ts" } }]))).toEqual([{ text: "⚙ Read x.ts" }]);
  });
  it("renders an unknown tool with the generic fallback", () => {
    expect(renderMessage(asst([{ type: "tool_use", name: "Grep", input: { pattern: "foo" } }]))).toEqual([{ text: "⚙ Grep(foo)" }]);
  });
  it("renders a tool_result as dimmed indented output", () => {
    const m = { type: "user", message: { content: [{ type: "tool_result", content: "line1\nline2" }] } };
    expect(renderMessage(m)).toEqual([{ text: "  │ line1", dim: true }, { text: "  │ line2", dim: true }]);
  });
  it("ignores result/system messages", () => {
    expect(renderMessage({ type: "result", result: "ok" })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tui && npx vitest run test/render.test.ts`
Expected: FAIL — "Cannot find module '../src/render.js'".

- [ ] **Step 3: Implement the formatter**

```ts
// tui/src/render.ts — pure, UI-agnostic rich formatter: one SDK message → renderable lines (data, not ink).
export interface RenderLine { text: string; color?: string; dim?: boolean; }

const trunc = (s: string, n = 48) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const firstArg = (input: Record<string, unknown>): string => {
  const v = Object.values(input ?? {})[0];
  return v === undefined ? "" : trunc(typeof v === "string" ? v : JSON.stringify(v));
};
const path = (input: Record<string, unknown>) => String(input.file_path ?? input.path ?? "");

function toolUseLines(name: string, input: Record<string, unknown>): RenderLine[] {
  if (name === "Edit") {
    const out: RenderLine[] = [{ text: `⚙ Edit ${path(input)}` }];
    if (typeof input.old_string === "string") for (const l of input.old_string.split("\n")) out.push({ text: `  - ${l}`, color: "red" });
    if (typeof input.new_string === "string") for (const l of input.new_string.split("\n")) out.push({ text: `  + ${l}`, color: "green" });
    return out;
  }
  if (name === "Write") {
    const out: RenderLine[] = [{ text: `⚙ Write ${path(input)}` }];
    if (typeof input.content === "string") for (const l of input.content.split("\n")) out.push({ text: `  + ${l}`, color: "green" });
    return out;
  }
  if (name === "Bash") return [{ text: `⚙ Bash ${trunc(String(input.command ?? ""), 80)}` }];
  if (name === "Read") return [{ text: `⚙ Read ${path(input)}` }];
  return [{ text: `⚙ ${name}(${firstArg(input)})` }];
}

function resultLines(content: unknown): RenderLine[] {
  const text = typeof content === "string" ? content
    : Array.isArray(content) ? content.map((b: any) => (typeof b?.text === "string" ? b.text : "")).join("") : "";
  if (!text.trim()) return [];
  return text.split("\n").slice(0, 12).map((l) => ({ text: `  │ ${trunc(l, 100)}`, dim: true }));
}

/** Map one SDK message to renderable lines. Unknown/empty/result/system → []. */
export function renderMessage(m: any): RenderLine[] {
  if (!m || typeof m !== "object") return [];
  if (m.type === "assistant") {
    const out: RenderLine[] = [];
    for (const b of m.message?.content ?? []) {
      if (b?.type === "text" && b.text) for (const l of String(b.text).split("\n")) out.push({ text: l });
      else if (b?.type === "thinking" && b.thinking) for (const l of String(b.thinking).split("\n")) out.push({ text: l, dim: true });
      else if (b?.type === "tool_use") out.push(...toolUseLines(b.name, b.input ?? {}));
    }
    return out;
  }
  if (m.type === "user") {
    const out: RenderLine[] = [];
    for (const b of m.message?.content ?? []) if (b?.type === "tool_result") out.push(...resultLines(b.content));
    return out;
  }
  return [];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tui && npx vitest run test/render.test.ts && npm run typecheck`
Expected: 8 passed; typecheck exit 0.

- [ ] **Step 5: Commit**

```bash
git add tui/src/render.ts tui/test/render.test.ts
git commit -m "feat(tui): rich tool-rendering formatter — generic + Edit/Write/Bash/Read (incr3)"
```

---

### Task 5: `uiBroker` + `useChat` hook (incl. teardown-liveness)

**Files:**
- Create: `tui/src/uiBroker.ts`
- Create: `tui/src/useChat.ts`
- Test: `tui/test/useChat.test.tsx`

**Interfaces:**
- Consumes: `PermissionBroker`/`PermissionDecision`/`PermissionRequest` from `"cc-harness"` (Task 3); `renderMessage`/`RenderLine` (Task 4).
- Produces: `createUiBroker(): UiBrokerHandle` where `UiBrokerHandle = {broker:PermissionBroker, setHandler(h:((req:PermissionRequest)=>Promise<PermissionDecision>)|null):void}`; `ChatSession` interface; `useChat(session, ui, opts?) → {state, submit, resolvePermission, cycleMode, interrupt}`.

**Rebuild the core first** (Task 3 added the exports `useChat` imports):

```bash
cd harness && npm run build && cd ../tui
```

- [ ] **Step 1: Write the failing test**

```tsx
// tui/test/useChat.test.tsx
import { describe, it, expect } from "vitest";
import React, { useEffect } from "react";
import { render } from "ink-testing-library";
import { Text } from "ink";
import { createUiBroker } from "../src/uiBroker.js";
import { useChat, type ChatSession } from "../src/useChat.js";
import type { PermissionDecision } from "cc-harness";

const frame = (f: () => string | undefined) => f() ?? "";
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) return; if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
function fakeSession(overrides: Partial<ChatSession> = {}): ChatSession & { disposed: number } {
  const s: any = { disposed: 0,
    async submit(_p: string, onMessage: (m: unknown) => void) { onMessage({ type: "assistant", message: { content: [{ type: "text", text: "working" }] } }); return { result: "done" }; },
    async setPermissionMode() {}, async interrupt() {}, async getContextUsage() { return { totalTokens: 5, maxTokens: 100 }; },
    async dispose() { s.disposed++; }, sessionId: "sess-1", ...overrides };
  return s;
}
function Host({ session, ui, prompt }: { session: ChatSession; ui: ReturnType<typeof createUiBroker>; prompt?: string }) {
  const c = useChat(session, ui);
  useEffect(() => { if (prompt) c.submit(prompt); /* fire once */ }, []); // eslint-disable-line
  return <Text>{c.state.pending ? `PENDING:${c.state.pending.req.toolName}` : c.state.busy ? "BUSY" : "IDLE"} {c.state.lines.map((l) => l.text).join("|")}</Text>;
}

describe("uiBroker", () => {
  it("denies a request when no handler is set yet", async () => {
    expect(await createUiBroker().broker.request({ toolName: "Edit", input: {}, toolUseID: "t", signal: new AbortController().signal })).toEqual({ kind: "deny" });
  });
});

describe("useChat", () => {
  it("streams a submitted turn into the transcript", async () => {
    const { lastFrame } = render(<Host session={fakeSession()} ui={createUiBroker()} prompt="hi" />);
    await waitFor(() => frame(lastFrame).includes("working"));
    expect(lastFrame()).toContain("working");
  });
  it("surfaces a broker request as pending state", async () => {
    const ui = createUiBroker();
    const { lastFrame } = render(<Host session={fakeSession()} ui={ui} />);
    await new Promise((r) => setTimeout(r, 20)); // let the mount effect set the handler
    void ui.broker.request({ toolName: "Edit", input: {}, toolUseID: "t", signal: new AbortController().signal });
    await waitFor(() => frame(lastFrame).includes("PENDING:Edit"));
    expect(lastFrame()).toContain("PENDING:Edit");
  });
  it("settles a parked permission promise → deny on unmount, and disposes the session exactly once", async () => {
    const ui = createUiBroker();
    const session = fakeSession();
    const { unmount } = render(<Host session={session} ui={ui} />);
    await new Promise((r) => setTimeout(r, 20));
    let decided: PermissionDecision | undefined;
    void ui.broker.request({ toolName: "Edit", input: {}, toolUseID: "t", signal: new AbortController().signal }).then((d) => { decided = d; });
    await new Promise((r) => setTimeout(r, 20));
    unmount();
    await waitFor(() => decided !== undefined);
    expect(decided).toEqual({ kind: "deny" });
    expect(session.disposed).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tui && npx vitest run test/useChat.test.tsx`
Expected: FAIL — "Cannot find module '../src/uiBroker.js'".

- [ ] **Step 3: Implement `uiBroker.ts`**

```ts
// tui/src/uiBroker.ts — a PermissionBroker whose request() is fulfilled by a late-bound handler (the React
// layer). Before a handler is set (or after teardown), requests deny — never hang.
import type { PermissionBroker, PermissionDecision, PermissionRequest } from "cc-harness";

export interface UiBrokerHandle {
  broker: PermissionBroker;
  setHandler(h: ((req: PermissionRequest) => Promise<PermissionDecision>) | null): void;
}

export function createUiBroker(): UiBrokerHandle {
  let handler: ((req: PermissionRequest) => Promise<PermissionDecision>) | null = null;
  return {
    broker: { request(req) { return handler ? handler(req) : Promise.resolve({ kind: "deny" } as PermissionDecision); } },
    setHandler(h) { handler = h; },
  };
}
```

- [ ] **Step 4: Implement `useChat.ts`**

```tsx
// tui/src/useChat.ts — owns the in-process Session (default mode), the transcript, the streaming turn, the
// late-bound permission broker, mode switching, and idempotent teardown.
import { useEffect, useRef, useState } from "react";
import type { PermissionDecision, PermissionRequest } from "cc-harness";
import { renderMessage, type RenderLine } from "./render.js";
import type { UiBrokerHandle } from "./uiBroker.js";

/** The subset of the lib Session the REPL drives (the real Session satisfies this). */
export interface ChatSession {
  submit(prompt: string, onMessage: (m: unknown) => void): Promise<{ result: unknown }>;
  setPermissionMode(mode: string): Promise<void>;
  interrupt(): Promise<void>;
  getContextUsage(): Promise<unknown>;
  dispose(): Promise<void>;
  readonly sessionId?: string;
}
export interface Pending { req: PermissionRequest; resolve: (d: PermissionDecision) => void; }
export interface ChatState { lines: RenderLine[]; streaming: RenderLine[]; pending: Pending | null; mode: string; busy: boolean; ctxPct?: number; }

const OTHER_POLE: Record<string, string> = { default: "bypassPermissions", bypassPermissions: "default" };

export function useChat(session: ChatSession, ui: UiBrokerHandle, opts: { initialMode?: string } = {}) {
  const [lines, setLines] = useState<RenderLine[]>([]);
  const [streaming, setStreaming] = useState<RenderLine[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [mode, setMode] = useState(opts.initialMode ?? "default");
  const [busy, setBusy] = useState(false);
  const [ctxPct, setCtxPct] = useState<number | undefined>(undefined);
  const disposed = useRef(false);
  const pendingRef = useRef<Pending | null>(null);
  pendingRef.current = pending;

  useEffect(() => {
    ui.setHandler((req) => new Promise<PermissionDecision>((resolve) => {
      if (disposed.current) return resolve({ kind: "deny" });
      setPending({ req, resolve });
    }));
    return () => {
      disposed.current = true;
      ui.setHandler(null);
      pendingRef.current?.resolve({ kind: "deny" }); // never leave the SDK await hanging
      void session.dispose().catch(() => {});
    };
  }, [session, ui]);

  async function refreshCtx() {
    try {
      const u = (await session.getContextUsage()) as { totalTokens?: number; maxTokens?: number };
      if (!disposed.current && u?.maxTokens) setCtxPct(Math.round(((u.totalTokens ?? 0) / u.maxTokens) * 100));
    } catch { /* best-effort */ }
  }

  function submit(prompt: string) {
    if (disposed.current || busy || !prompt.trim()) return;
    setLines((l) => [...l, { text: `› ${prompt}`, dim: true }]);
    setStreaming([]); setBusy(true);
    const acc: RenderLine[] = [];
    session.submit(prompt, (m) => { const ls = renderMessage(m); if (ls.length && !disposed.current) { acc.push(...ls); setStreaming([...acc]); } })
      .then(() => {}, (e) => { acc.push({ text: `✗ ${(e as Error).message}`, color: "red" }); })
      .finally(() => { if (disposed.current) return; setLines((l) => [...l, ...acc]); setStreaming([]); setBusy(false); void refreshCtx(); });
  }
  function resolvePermission(d: PermissionDecision) { pendingRef.current?.resolve(d); setPending(null); }
  function cycleMode() { const next = OTHER_POLE[mode] ?? "default"; void session.setPermissionMode(next).catch(() => {}); if (!disposed.current) setMode(next); }
  function interrupt() { void session.interrupt().catch(() => {}); }

  return { state: { lines, streaming, pending, mode, busy, ctxPct } as ChatState, submit, resolvePermission, cycleMode, interrupt };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd tui && npx vitest run test/useChat.test.tsx && npm run typecheck`
Expected: all passed (uiBroker deny + streaming + teardown-liveness); typecheck exit 0.

- [ ] **Step 6: Commit**

```bash
git add tui/src/uiBroker.ts tui/src/useChat.ts tui/test/useChat.test.tsx
git commit -m "feat(tui): useChat hook + uiBroker — stream, permission state, idempotent teardown (incr3)"
```

---

### Task 6: Presentational components (`Transcript`, `PermissionDialog`, `ChatStatusBar`)

**Files:**
- Create: `tui/src/Transcript.tsx`
- Create: `tui/src/PermissionDialog.tsx`
- Create: `tui/src/ChatStatusBar.tsx`
- Test: `tui/test/components.test.tsx`

**Interfaces:**
- Consumes: `RenderLine` (Task 4); `PermissionRequest`/`PermissionDecision` from `"cc-harness"`.
- Produces: `<Transcript lines streaming />`, `<PermissionDialog req onDecision />`, `<ChatStatusBar mode busy ctxPct hasPending />`.

- [ ] **Step 1: Write the failing test**

```tsx
// tui/test/components.test.tsx
import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { Transcript } from "../src/Transcript.js";
import { PermissionDialog } from "../src/PermissionDialog.js";
import { ChatStatusBar } from "../src/ChatStatusBar.js";
import type { PermissionDecision } from "cc-harness";

const frame = (f: () => string | undefined) => f() ?? "";
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) return; if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
const req = { toolName: "Edit", input: { file_path: "f.ts" }, toolUseID: "t", signal: new AbortController().signal };

describe("<Transcript>", () => {
  it("renders committed and streaming lines", () => {
    const { lastFrame } = render(<Transcript lines={[{ text: "committed" }]} streaming={[{ text: "live" }]} />);
    expect(lastFrame()).toContain("committed");
    expect(lastFrame()).toContain("live");
  });
});
describe("<PermissionDialog>", () => {
  it("reconstructs the prompt from toolName+input (no SDK title)", () => {
    const { lastFrame } = render(<PermissionDialog req={req} onDecision={() => {}} />);
    expect(lastFrame()).toContain("Edit");
    expect(lastFrame()).toContain("[a] allow once");
  });
  it("maps a/A/d to allow_once/allow_always/deny", async () => {
    const got: PermissionDecision[] = [];
    const { stdin, lastFrame } = render(<PermissionDialog req={req} onDecision={(d) => got.push(d)} />);
    await waitFor(() => frame(lastFrame).includes("[a] allow once")); // dialog mounted → useInput live
    stdin.write("a"); await waitFor(() => got.length === 1);
    stdin.write("A"); await waitFor(() => got.length === 2);
    stdin.write("d"); await waitFor(() => got.length === 3);
    expect(got).toEqual([{ kind: "allow_once" }, { kind: "allow_always" }, { kind: "deny" }]);
  });
});
describe("<ChatStatusBar>", () => {
  it("shows the mode and ctx%", () => {
    const { lastFrame } = render(<ChatStatusBar mode="default" busy={false} ctxPct={42} hasPending={false} />);
    expect(lastFrame()).toContain("default");
    expect(lastFrame()).toContain("42%");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tui && npx vitest run test/components.test.tsx`
Expected: FAIL — "Cannot find module '../src/Transcript.js'".

- [ ] **Step 3: Implement `Transcript.tsx`**

```tsx
// tui/src/Transcript.tsx — append-only scrollback (Static) + a live region for the in-flight turn.
import React from "react";
import { Box, Text, Static } from "ink";
import type { RenderLine } from "./render.js";

const Line = ({ l }: { l: RenderLine }) => <Text color={l.color} dimColor={l.dim}>{l.text || " "}</Text>;

export function Transcript({ lines, streaming }: { lines: RenderLine[]; streaming: RenderLine[] }) {
  return (
    <Box flexDirection="column">
      <Static items={lines}>{(l, i) => <Line key={i} l={l} />}</Static>
      {streaming.map((l, i) => <Line key={`s${i}`} l={l} />)}
    </Box>
  );
}
```

- [ ] **Step 4: Implement `PermissionDialog.tsx`**

```tsx
// tui/src/PermissionDialog.tsx — inline allow/always/deny gate. UI hints are absent headlessly, so the
// prompt is reconstructed from toolName+input (title used only if the SDK ever provides it).
import React from "react";
import { Box, Text, useInput } from "ink";
import type { PermissionRequest, PermissionDecision } from "cc-harness";

const briefArg = (input: Record<string, unknown>) => {
  const v = Object.values(input ?? {})[0];
  const s = v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 48 ? s.slice(0, 47) + "…" : s;
};

export function PermissionDialog({ req, onDecision }: { req: PermissionRequest; onDecision: (d: PermissionDecision) => void }) {
  useInput((input) => {
    if (input === "a") onDecision({ kind: "allow_once" });
    else if (input === "A") onDecision({ kind: "allow_always" });
    else if (input === "d" || input === "D") onDecision({ kind: "deny" });
  });
  const title = req.title ?? `${req.toolName}(${briefArg(req.input)})`;
  return (
    <Box flexDirection="column" borderStyle="double" paddingX={1} borderColor="yellow">
      <Text color="yellow">Permission needed: {title}</Text>
      <Text dimColor>[a] allow once   [A] always ({req.toolName})   [d] deny</Text>
    </Box>
  );
}
```

- [ ] **Step 5: Implement `ChatStatusBar.tsx`**

```tsx
// tui/src/ChatStatusBar.tsx — bottom bar: permission mode (color-coded), ctx%, busy, context-sensitive hints.
import React from "react";
import { Box, Text } from "ink";

export function ChatStatusBar({ mode, busy, ctxPct, hasPending }: { mode: string; busy: boolean; ctxPct?: number; hasPending: boolean }) {
  return (
    <Box>
      <Text>mode </Text><Text color={mode === "bypassPermissions" ? "red" : "green"}>{mode}</Text>
      <Text>{ctxPct != null ? `  ctx ${ctxPct}%` : ""}</Text>
      <Text>{busy ? "  …working" : ""}</Text>
      <Text dimColor>{hasPending ? "   [a/A/d]" : "   Tab mode · Esc interrupt"}</Text>
    </Box>
  );
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd tui && npx vitest run test/components.test.tsx && npm run typecheck`
Expected: all passed; typecheck exit 0.

- [ ] **Step 7: Commit**

```bash
git add tui/src/Transcript.tsx tui/src/PermissionDialog.tsx tui/src/ChatStatusBar.tsx tui/test/components.test.tsx
git commit -m "feat(tui): Transcript + PermissionDialog + ChatStatusBar components (incr3)"
```

---

### Task 7: `ChatApp` composition + `cc-harness-chat` bin

**Files:**
- Create: `tui/src/ChatApp.tsx`
- Create: `tui/src/chat.tsx`
- Modify: `tui/package.json` (add the bin)
- Test: `tui/test/chat.test.tsx`

**Interfaces:**
- Consumes: `useChat`/`ChatSession` (Task 5), `createUiBroker`/`UiBrokerHandle` (Task 5), `Transcript`/`PermissionDialog`/`ChatStatusBar` (Task 6), the existing `Composer` (increment 2), `openSession` from `"cc-harness"`.
- Produces: `<ChatApp session broker hookOpts? />`; the `cc-harness-chat` bin (`dist/chat.js`).

- [ ] **Step 1: Write the failing test**

```tsx
// tui/test/chat.test.tsx
import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { ChatApp } from "../src/ChatApp.js";
import { createUiBroker } from "../src/uiBroker.js";
import type { ChatSession } from "../src/useChat.js";
import type { PermissionDecision } from "cc-harness";

const frame = (f: () => string | undefined) => f() ?? "";
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) return; if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
async function pressUntil(stdin: { write: (s: string) => void }, key: string, cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { stdin.write(key); if (cond()) return; if (Date.now() - start > timeout) throw new Error(`pressUntil(${JSON.stringify(key)}) timeout`); await new Promise((r) => setTimeout(r, 5)); }
}
function fakeSession(onSubmit?: () => Promise<void>): ChatSession & { modes: string[] } {
  const s: any = { modes: [],
    async submit(_p: string, onMessage: (m: unknown) => void) { onMessage({ type: "assistant", message: { content: [{ type: "text", text: "ok" }] } }); if (onSubmit) await onSubmit(); return { result: "done" }; },
    async setPermissionMode(m: string) { s.modes.push(m); }, async interrupt() {}, async getContextUsage() { return { totalTokens: 5, maxTokens: 100 }; },
    async dispose() {}, sessionId: "sess-1" };
  return s;
}

describe("<ChatApp>", () => {
  it("submits a typed prompt and streams the reply", async () => {
    const { stdin, lastFrame } = render(<ChatApp session={fakeSession()} broker={createUiBroker()} />);
    await waitFor(() => frame(lastFrame).includes("›"));      // composer mounted → TextInput live
    stdin.write("hi"); stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("ok"));
    expect(lastFrame()).toContain("ok");
  });

  it("surfaces a gated tool as a dialog and 'a' allows it", async () => {
    const ui = createUiBroker();
    let decided: PermissionDecision | undefined;
    const session = fakeSession(async () => {
      await ui.broker.request({ toolName: "Edit", input: { file_path: "f.ts" }, toolUseID: "t", signal: new AbortController().signal }).then((d) => { decided = d; });
    });
    const { stdin, lastFrame } = render(<ChatApp session={session} broker={ui} />);
    await waitFor(() => frame(lastFrame).includes("›"));
    stdin.write("edit it"); stdin.write("\r");
    await waitFor(() => frame(lastFrame).includes("Permission needed"));   // dialog up
    expect(lastFrame()).toContain("Edit");
    stdin.write("a");
    await waitFor(() => decided !== undefined);
    expect(decided).toEqual({ kind: "allow_once" });
  });

  it("Tab toggles the permission mode default ↔ bypassPermissions", async () => {
    const session = fakeSession();
    const { stdin, lastFrame } = render(<ChatApp session={session} broker={createUiBroker()} />);
    await waitFor(() => frame(lastFrame).includes("mode"));
    await pressUntil(stdin, "\t", () => session.modes.includes("bypassPermissions")); // Tab cycles mode
    expect(session.modes[0]).toBe("bypassPermissions");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tui && npx vitest run test/chat.test.tsx`
Expected: FAIL — "Cannot find module '../src/ChatApp.js'".

- [ ] **Step 3: Implement `ChatApp.tsx`**

```tsx
// tui/src/ChatApp.tsx — composes the transcript, the composer (or the permission dialog when one is
// pending), and the status bar. Global keys (Esc interrupt, Tab cycle mode) are inactive while a dialog
// is up so the dialog owns input. Reuses increment 2's <Composer>.
import React from "react";
import { Box, useInput } from "ink";
import { useChat, type ChatSession } from "./useChat.js";
import type { UiBrokerHandle } from "./uiBroker.js";
import { Transcript } from "./Transcript.js";
import { Composer } from "./Composer.js";
import { PermissionDialog } from "./PermissionDialog.js";
import { ChatStatusBar } from "./ChatStatusBar.js";

export function ChatApp({ session, broker, hookOpts }: { session: ChatSession; broker: UiBrokerHandle; hookOpts?: { initialMode?: string } }) {
  const { state, submit, resolvePermission, cycleMode, interrupt } = useChat(session, broker, hookOpts ?? {});
  useInput((input, key) => {
    if (key.escape) { interrupt(); return; }
    if (key.tab) cycleMode();   // Tab cycles the permission mode (default ↔ bypassPermissions)
  }, { isActive: !state.pending });
  return (
    <Box flexDirection="column">
      <Transcript lines={state.lines} streaming={state.streaming} />
      {state.pending
        ? <PermissionDialog req={state.pending.req} onDecision={resolvePermission} />
        : <Composer onSubmit={submit} />}
      <ChatStatusBar mode={state.mode} busy={state.busy} ctxPct={state.ctxPct} hasPending={!!state.pending} />
    </Box>
  );
}
```

Note: Tab is delivered by ink as `key.tab` and is ignored by `<Composer>`'s TextInput, so it routes to the app-level handler. Esc → interrupt. Ctrl-C exits via ink's default. The dialog gating (`isActive: !state.pending`) hands input to `<PermissionDialog>` while a prompt is up.

- [ ] **Step 4: Implement the `chat.tsx` bin**

```tsx
// tui/src/chat.tsx — bin entry for cc-harness-chat: open an in-process Session in default mode wired to the
// ui permission broker, render <ChatApp>.
import React from "react";
import { render } from "ink";
import { openSession } from "cc-harness";
import { createUiBroker } from "./uiBroker.js";
import { ChatApp } from "./ChatApp.js";

const args = process.argv.slice(2);
function flag(name: string): string | undefined { const i = args.indexOf(name); return i >= 0 && args[i + 1] != null ? args[i + 1] : undefined; }

const ui = createUiBroker();
const session = openSession({ model: flag("--model"), cwd: flag("--cwd") ?? process.cwd(), permissionMode: "default", permissionBroker: ui.broker, contextTool: true });
render(<ChatApp session={session} broker={ui} />);
```

- [ ] **Step 5: Add the bin to `package.json`**

In `tui/package.json`, change the `"bin"` field to include both bins:

```json
  "bin": { "cc-harness-console": "./dist/cli.js", "cc-harness-chat": "./dist/chat.js" },
```

- [ ] **Step 6: Run test + typecheck to verify they pass**

Run: `cd tui && npx vitest run test/chat.test.tsx && npm run typecheck`
Expected: 3 passed; typecheck exit 0.

- [ ] **Step 7: Commit**

```bash
git add tui/src/ChatApp.tsx tui/src/chat.tsx tui/package.json tui/test/chat.test.tsx
git commit -m "feat(tui): ChatApp composition + cc-harness-chat bin (incr3)"
```

---

### Task 8: Gated live e2e + docs (CLAUDE.md, coverage scorecard)

**Files:**
- Create: `tui/test/live/chat.e2e.test.ts`
- Modify: `tui/CLAUDE.md` (document the second bin + module map)
- Modify: `CC-to-SDK/docs/parity/coverage.md` (Domain 10 bump)

**Interfaces:**
- Consumes: `openSession` from `"cc-harness"`, `createUiBroker` (Task 5), the gate (via `permissionBroker`).

- [ ] **Step 1: Write the gated live e2e**

```ts
// tui/test/live/chat.e2e.test.ts — real in-process Session in default mode + a programmatic broker that
// auto-allows; a prompt that triggers a tool; assert the turn completes and the broker was consulted.
// Gated on ANTHROPIC_API_KEY (skips cleanly without it). Run keyed:
//   set -a; . ../.env; set +a; npx vitest run test/live/chat.e2e.test.ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSession } from "cc-harness";
import { createUiBroker } from "../../src/uiBroker.js";
import { renderMessage } from "../../src/render.js";

const live = process.env.ANTHROPIC_API_KEY ? describe : describe.skip;

live("chat REPL e2e (live)", () => {
  it("streams a turn; the broker sees the Edit and the file changes after allow", async () => {
    const dir = mkdtempSync(join(tmpdir(), "chat-e2e-"));
    writeFileSync(join(dir, "note.txt"), "ORIGINAL\n");
    const ui = createUiBroker();
    const seen: string[] = [];
    ui.setHandler(async (req) => { seen.push(req.toolName); return { kind: "allow_once" }; });
    const session = openSession({ model: "claude-haiku-4-5-20251001", cwd: dir, permissionMode: "default", permissionBroker: ui.broker, maxTurns: 6 });
    try {
      const lines: string[] = [];
      const { result } = await session.submit("Edit note.txt, replacing ORIGINAL with CHANGED. Then say done.", (m) => { for (const l of renderMessage(m)) lines.push(l.text); });
      expect(result).toBeTruthy();
      expect(seen).toContain("Edit");
      expect(readFileSync(join(dir, "note.txt"), "utf8")).toContain("CHANGED");
    } finally { await session.dispose(); }
  }, 90_000);
});
```

- [ ] **Step 2: Verify it skips cleanly without a key**

Run: `cd tui && npx vitest run test/live/chat.e2e.test.ts`
Expected: the suite is skipped (0 failures) because `ANTHROPIC_API_KEY` is unset.

- [ ] **Step 3: Run it keyed (controller-only; implementer stops at the clean skip)**

Run: `cd tui && set -a; . ../.env; set +a; npx vitest run test/live/chat.e2e.test.ts`
Expected: 1 passed — the model edited the file, the broker saw `Edit`, and `note.txt` contains `CHANGED`.

- [ ] **Step 4: Update `tui/CLAUDE.md`**

Add `cc-harness-chat` to the package description and the module map. Under the module map, add:

```markdown
- **`render.ts`** — pure rich tool-rendering formatter (generic + bespoke Edit/Write/Bash/Read); the chat REPL's superset of `format.ts`
- **`uiBroker.ts`** — a `PermissionBroker` (from `cc-harness`) whose `request()` is fulfilled by a late-bound React handler
- **`useChat.ts`** — owns the in-process `Session` (default mode) + transcript + submit stream + permission state + mode switch + idempotent teardown
- **`Transcript.tsx` / `PermissionDialog.tsx` / `ChatStatusBar.tsx`** — chat REPL panes
- **`ChatApp.tsx`** — chat composition (transcript + composer/dialog + status); `chat.tsx` — `cc-harness-chat` bin entry
```

Also note the two bins: `cc-harness-console` (daemon console, incr 2) and `cc-harness-chat` (in-process chat REPL, incr 3).

- [ ] **Step 5: Update `docs/parity/coverage.md`**

Bump the Domain 10 (UI / interactive surfaces) row from its current `~24%` to `~30%`, and add a sentence that increment 3 shipped: an in-process chat REPL (`cc-harness-chat`) with rich tool rendering and inline permission dialogs, plus the core `createPermissionGate`/`PermissionBroker` advanced-seam.

- [ ] **Step 6: Commit**

```bash
git add tui/test/live/chat.e2e.test.ts tui/CLAUDE.md CC-to-SDK/docs/parity/coverage.md
git commit -m "test(tui): gated live chat e2e + docs (incr3 shipped)"
```

---

## Self-Review

**1. Spec coverage:**
- Scope (in-process only) → Tasks 5/7 use `openSession`, no daemon. ✓
- Permission seam (PermissionBroker + createPermissionGate + allowlist + decision→PermissionResult) → Task 1. ✓
- Config wiring (permissionBroker → canUseTool) → Task 2. ✓
- Public API (createPermissionGate value + 3 types, pin, API-STABILITY) → Task 3. ✓
- Rich rendering (generic + Edit/Write/Bash/Read) → Task 4. ✓
- useChat (Session/default mode + transcript + stream + ink broker + mode + idempotent teardown) → Task 5. ✓
- Components (Transcript/PermissionDialog/ChatStatusBar) + reuse Composer → Tasks 6/7. ✓
- ChatApp + cc-harness-chat bin → Task 7. ✓
- Default = `default` (broker-live), `bypassPermissions` = silent toggle → Task 5 `OTHER_POLE` + Task 7 bin `permissionMode:"default"`. ✓
- UI hints absent headlessly (reconstruct from toolName+input) → Task 6 PermissionDialog. ✓
- Tests: core gate unit + wiring + pin; tui render + components + useChat (teardown-liveness) + chat integration; one gated live e2e → Tasks 1–8. ✓
- Coverage.md + CLAUDE.md refresh → Task 8. ✓

**2. Placeholder scan:** No TBD/TODO; every code step shows complete code; commands have expected output. The only "follow the existing format" step is API-STABILITY.md (Task 3 Step 5), which specifies exact row content. ✓

**3. Type consistency:** `PermissionDecision`/`PermissionRequest`/`PermissionBroker` defined in Task 1, imported unchanged in Tasks 2/5/6. `ChatSession`/`UiBrokerHandle`/`Pending`/`ChatState` defined in Task 5, consumed in Tasks 6/7. `RenderLine`/`renderMessage` defined in Task 4, consumed in Tasks 5/6. `createUiBroker` returns `UiBrokerHandle` used as the `broker` prop in Task 7. `OTHER_POLE` maps `default ↔ bypassPermissions` consistent with the bin's `permissionMode:"default"`. ✓

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-19-chat-repl-permission-prompts.md`. Per the spec's verified contract, all premises are probe-grounded going in. Execute via **superpowers:subagent-driven-development** — fresh implementer per task + two-stage review, reviews on Claude Opus (codex `/codex:rescue` has been down this session).
