# Chat Live-Streaming (Increment 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `cc-harness-chat` render a turn *live* — token-by-token text, stream-then-collapse thinking, in-place tool `⟳ running → ✓/✗ done` — plus a live status bar (model · mode · ctx% · streaming indicator).

**Architecture:** A new pure reducer `tui/src/liveTurn.ts` turns the SDK's interleaved frame stream (`stream_event` partials + full `assistant`/`user`/`result` messages) into `RenderLine[]` snapshots, owning all streaming state so `useChat`/`render` stay lean. `useChat` feeds each `onMessage` frame to a per-turn `LiveTurn` and paints `snapshot()`; on turn end it commits `finalize()` to scrollback. The only engine-facing change is one config flag (`includePartialMessages:true`) in `chat.tsx` — no `cc-harness` source change.

**Tech Stack:** TypeScript, React 18, Ink 5, Vitest 2, ink-testing-library 4. Package `cc-harness-tui` (`CC-to-SDK/tui/`), engine `cc-harness` (`file:../harness`).

## Global Constraints

- **NO Prettier — dense hand-style:** compact, multi-statement lines; match surrounding code.
- **ESM `.js` import specifiers** in `tui/` (`from "./liveTurn.js"`); bare `"cc-harness"` for engine imports.
- **Keep modules small/focused:** `liveTurn.ts` is a new module precisely to keep `useChat.ts`/`render.ts` lean.
- **`render.ts` stays pure** (no React/Ink/SDK); existing `renderMessage` behavior is unchanged (its tests stay green).
- **ink `useInput` passive-effect timing discipline** in component/app tests: `useInput` subscribes in a passive effect — `await` a render tick / `waitFor` BEFORE writing keys. **Never** swap to raw `stdin.on`; **never** mutate shared components.
- **Live tests gate** on `ANTHROPIC_API_KEY` (`const live = process.env.ANTHROPIC_API_KEY ? describe : describe.skip`), read from `CC-to-SDK/.env` (gitignored — never commit/print it); keyless suites skip cleanly without a key.
- **No new `cc-harness` public exports** in this increment → **no** `harness/API-STABILITY.md` / `harness/test/unit/index.test.ts` surface-pinning, and **no harness rebuild needed** (no engine source change).
- Commands run **from `tui/`**: `npm run typecheck`, `npx vitest run test/<file>`, `npm run build`. Live: `set -a; . ../.env; set +a; npx vitest run test/live/<file>`.
- Commit messages: plain, no `Co-Authored-By` / attribution.

## Grounding (already done — not a task)

Probe `probes/probes/20-partial-stream-session.ts` (committed `8657926443`) verified partials flow in the multi-turn streaming-input Session path and captured the exact frame shapes. Its sequence is reproduced as the unit fixture in Task 2. Key facts driving the design:
- Frame envelope: `{ type:"stream_event", event:{…}, … }`; `event.type ∈ {message_start, content_block_start, content_block_delta, content_block_stop, message_delta, message_stop}`.
- `content_block_start.content_block.type ∈ {thinking, text, tool_use}`; tool_use carries `{id:"toolu_…", name}`.
- `content_block_delta.delta.type ∈ {text_delta(.text), thinking_delta(.thinking), input_json_delta(.partial_json), signature_delta}`.
- **Block indices reset per message** → a turn is multiple messages; key blocks per-message, not by a global index.
- The SDK delivers **both** partials **and** the full `assistant`/`user` messages → must dedupe.
- **Model source (grounded refinement):** the active model is read from the full `assistant` frame's `message.model` (Anthropic message schema), not `initializationResult()` (shape unverified by probe 20). No new `ChatSession` method.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `tui/src/render.ts` (modify) | pure formatter; **export** `trunc` + new `toolTarget(name,input)` for reuse; existing behavior unchanged | 1 |
| `tui/src/liveTurn.ts` (create) | **the reducer** — frames → `RenderLine[]`; all streaming state, dedup, collapse, tool status | 2 |
| `tui/src/useChat.ts` (modify) | drive a per-turn `LiveTurn`; commit `finalize()`; capture `model` from the reducer | 3 |
| `tui/src/ChatStatusBar.tsx` (modify) | add `model` + live `⟳ streaming` indicator | 4 |
| `tui/src/ChatApp.tsx` (modify) | thread `state.model` + `state.busy` into the bar | 4 |
| `tui/src/chat.tsx` (modify) | add `includePartialMessages:true` to `openSession({…})` | 5 |
| `tui/test/render.test.ts` (modify) | `toolTarget`/`trunc` unit tests | 1 |
| `tui/test/liveTurn.test.ts` (create) | reducer unit tests over the probe-20 fixture | 2 |
| `tui/test/useChat.test.tsx` (modify) | model capture + live text streaming via fake session | 3 |
| `tui/test/components.test.tsx` (modify) | `ChatStatusBar` model + streaming-indicator test | 4 |
| `tui/test/live/chat-stream.e2e.test.ts` (create) | gated live: ≥2 growing snapshots, final text, model | 5 |
| `docs/parity/coverage.md` (modify) + memory | refresh Domain 10 / increment record | 6 |

---

### Task 1: Export `trunc` + add `toolTarget` in `render.ts`

**Files:**
- Modify: `tui/src/render.ts`
- Test: `tui/test/render.test.ts`

**Interfaces:**
- Consumes: existing private `trunc`, `path`, `firstArg` in `render.ts`.
- Produces: `export const trunc: (s: string, n?: number) => string` and `export function toolTarget(name: string, input: Record<string, unknown>): string`. Used by `liveTurn.ts` (Task 2).

- [ ] **Step 1: Write the failing test** — append to `tui/test/render.test.ts`:

```ts
import { renderMessage, trunc, toolTarget } from "../src/render.js";

describe("toolTarget", () => {
  it("Edit/Write/Read → the file path", () => {
    expect(toolTarget("Edit", { file_path: "f.ts" })).toBe("f.ts");
    expect(toolTarget("Read", { file_path: "x.ts" })).toBe("x.ts");
    expect(toolTarget("Write", { path: "y.ts" })).toBe("y.ts");
  });
  it("Bash → the command", () => { expect(toolTarget("Bash", { command: "echo hi" })).toBe("echo hi"); });
  it("unknown tool → its first arg", () => { expect(toolTarget("Grep", { pattern: "foo" })).toBe("foo"); });
});
describe("trunc", () => { it("truncates with an ellipsis", () => { expect(trunc("abcdef", 4)).toBe("abc…"); }); });
```

> Note: the existing top-of-file `import { renderMessage } from "../src/render.js";` becomes the combined import above — replace it, don't add a second import line.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tui && npx vitest run test/render.test.ts`
Expected: FAIL — `toolTarget`/`trunc` are not exported (`toolTarget is not a function` / import has no exported member).

- [ ] **Step 3: Implement** — in `tui/src/render.ts`, add `export` to `trunc`, and add `toolTarget` after the `path` helper. The existing lines:

```ts
const trunc = (s: string, n = 48) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const firstArg = (input: Record<string, unknown>): string => {
  const v = Object.values(input ?? {})[0];
  return v === undefined ? "" : trunc(typeof v === "string" ? v : JSON.stringify(v));
};
const path = (input: Record<string, unknown>) => String(input.file_path ?? input.path ?? "");
```

become:

```ts
export const trunc = (s: string, n = 48): string => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const firstArg = (input: Record<string, unknown>): string => {
  const v = Object.values(input ?? {})[0];
  return v === undefined ? "" : trunc(typeof v === "string" ? v : JSON.stringify(v));
};
const path = (input: Record<string, unknown>) => String(input.file_path ?? input.path ?? "");

/** The salient argument of a tool, used by the live one-line tool marker and the diff header. */
export function toolTarget(name: string, input: Record<string, unknown>): string {
  if (name === "Bash") return trunc(String(input.command ?? ""), 80);
  if (name === "Edit" || name === "Write" || name === "Read") return path(input);
  return firstArg(input);
}
```

Do **not** change `toolUseLines`/`renderMessage` — their existing tests must stay green.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tui && npx vitest run test/render.test.ts && npm run typecheck`
Expected: PASS (all `renderMessage` + new `toolTarget`/`trunc` tests); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add tui/src/render.ts tui/test/render.test.ts
git commit -m "feat(tui): export trunc + toolTarget from render for the live-turn reducer"
```

---

### Task 2: The `LiveTurn` reducer

**Files:**
- Create: `tui/src/liveTurn.ts`
- Test: `tui/test/liveTurn.test.ts`

**Interfaces:**
- Consumes: `RenderLine` (type), `trunc`, `toolTarget` from `render.ts` (Task 1).
- Produces:
  ```ts
  export class LiveTurn {
    model?: string;                  // captured from the first assistant frame's message.model
    ingest(m: unknown): void;        // feed one Session.submit onMessage frame
    snapshot(): RenderLine[];        // current live-region lines (call after each ingest)
    finalize(): RenderLine[];        // authoritative scrollback lines; settles open blocks
    fail(message: string): void;     // append a red turn-error line
  }
  ```
  Used by `useChat.ts` (Task 3) and the live test (Task 5).

- [ ] **Step 1: Write the failing test** — create `tui/test/liveTurn.test.ts`:

```ts
// tui/test/liveTurn.test.ts — reducer unit tests over the probe-20 frame sequence.
import { describe, it, expect } from "vitest";
import { LiveTurn } from "../src/liveTurn.js";

const se = (event: unknown) => ({ type: "stream_event", event });
const texts = (lt: LiveTurn) => lt.snapshot().map((l) => l.text);

// The exact ordered frames probe 20 delivered for a (thinking → Read tool → answer) turn.
function feed(lt: LiveTurn) {
  lt.ingest(se({ type: "message_start" }));
  lt.ingest(se({ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } }));
  lt.ingest(se({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "let me check" } }));
  lt.ingest(se({ type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig" } }));
  lt.ingest(se({ type: "content_block_stop", index: 0 }));
  lt.ingest(se({ type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_1", name: "Read", input: {} } }));
  lt.ingest(se({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: "{\"file" } }));
  lt.ingest(se({ type: "content_block_stop", index: 1 }));
  lt.ingest(se({ type: "message_stop" }));
  lt.ingest({ type: "assistant", message: { model: "claude-sonnet-4-6", content: [
    { type: "thinking", thinking: "let me check", signature: "sig" },
    { type: "tool_use", id: "toolu_1", name: "Read", input: { file_path: "fact.txt" } },
  ] } });
  lt.ingest({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "The codeword is PINECONE." }] } });
  lt.ingest(se({ type: "message_start" }));
  lt.ingest(se({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }));
  lt.ingest(se({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "The codeword is " } }));
}

describe("LiveTurn", () => {
  it("streams text that grows monotonically", () => {
    const lt = new LiveTurn(); feed(lt);
    const a = texts(lt).join("\n");
    lt.ingest(se({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "PINECONE." } }));
    const b = texts(lt).join("\n");
    expect(a).toContain("The codeword is ");
    expect(b).toContain("The codeword is PINECONE.");
    expect(b.length).toBeGreaterThan(a.length);
  });

  it("streams thinking then collapses it once a later block opens", () => {
    const lt = new LiveTurn();
    lt.ingest(se({ type: "message_start" }));
    lt.ingest(se({ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } }));
    lt.ingest(se({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "pondering" } }));
    expect(texts(lt)).toContain("pondering");                    // live, dim
    lt.ingest(se({ type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "t2", name: "Read", input: {} } }));
    expect(texts(lt)).toContain("✦ Thinking");                   // collapsed
    expect(texts(lt)).not.toContain("pondering");
  });

  it("flips a tool from running to done with a result preview", () => {
    const lt = new LiveTurn();
    lt.ingest(se({ type: "message_start" }));
    lt.ingest(se({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t3", name: "Read", input: {} } }));
    expect(texts(lt)).toContain("⟳ Read");                       // running, no target yet
    lt.ingest({ type: "assistant", message: { content: [{ type: "tool_use", id: "t3", name: "Read", input: { file_path: "f.ts" } }] } });
    expect(texts(lt)).toContain("⟳ Read f.ts");                  // target filled from full message
    lt.ingest({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t3", content: "ok\nmore" }] } });
    expect(texts(lt)).toContain("✓ Read f.ts  │ ok");            // done + first-line preview
  });

  it("marks a failed tool with ✗", () => {
    const lt = new LiveTurn();
    lt.ingest(se({ type: "message_start" }));
    lt.ingest(se({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t4", name: "Bash", input: {} } }));
    lt.ingest({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t4", is_error: true, content: "boom" }] } });
    const line = lt.snapshot().find((l) => l.text.startsWith("✗ Bash"));
    expect(line).toBeTruthy();
    expect(line!.color).toBe("red");
  });

  it("keeps per-message blocks distinct (message-2 text@0 does not clobber message-1 thinking@0) and never double-renders", () => {
    const lt = new LiveTurn(); feed(lt);
    lt.ingest(se({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "PINECONE." } }));
    lt.ingest(se({ type: "message_stop" }));
    lt.ingest({ type: "assistant", message: { content: [{ type: "text", text: "The codeword is PINECONE." }] } });
    lt.ingest({ type: "result", result: "The codeword is PINECONE." });
    const out = lt.finalize().map((l) => l.text);
    expect(out).toContain("✦ Thinking");                         // message-1 thinking survived
    expect(out.some((t) => t.startsWith("✓ Read fact.txt"))).toBe(true);
    expect(out).toContain("The codeword is PINECONE.");          // message-2 text present
    expect(out.filter((t) => t === "The codeword is PINECONE.").length).toBe(1); // not double-rendered
  });

  it("appends a red line on fail() and includes it in finalize", () => {
    const lt = new LiveTurn();
    lt.ingest(se({ type: "message_start" }));
    lt.ingest(se({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }));
    lt.ingest(se({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "partial" } }));
    lt.fail("stream died");
    const out = lt.finalize();
    expect(out).toContainEqual({ text: "partial" });
    expect(out).toContainEqual({ text: "✗ stream died", color: "red" });
  });

  it("settles a still-running tool at finalize (no dangling ⟳)", () => {
    const lt = new LiveTurn();
    lt.ingest(se({ type: "message_start" }));
    lt.ingest(se({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t5", name: "Read", input: {} } }));
    lt.ingest({ type: "assistant", message: { content: [{ type: "tool_use", id: "t5", name: "Read", input: { file_path: "f.ts" } }] } });
    const out = lt.finalize().map((l) => l.text);
    expect(out.some((t) => t.startsWith("⟳"))).toBe(false);
    expect(out).toContain("· Read f.ts");
  });

  it("renders a full assistant message that arrived with no partials (fallback)", () => {
    const lt = new LiveTurn();
    lt.ingest({ type: "assistant", message: { model: "claude-sonnet-4-6", content: [{ type: "text", text: "no partials here" }] } });
    expect(texts(lt)).toContain("no partials here");
    expect(lt.model).toBe("claude-sonnet-4-6");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tui && npx vitest run test/liveTurn.test.ts`
Expected: FAIL — `Cannot find module "../src/liveTurn.js"`.

- [ ] **Step 3: Implement** — create `tui/src/liveTurn.ts`:

```ts
// tui/src/liveTurn.ts — pure reducer: SDK turn frames (stream_event partials + full assistant/user/result)
// → live RenderLine[] snapshots. Owns ALL streaming state so useChat/render stay lean. No React, no SDK, no clock.
import type { RenderLine } from "./render.js";
import { trunc, toolTarget } from "./render.js";

type Block =
  | { kind: "text"; index: number; text: string }
  | { kind: "thinking"; index: number; text: string; collapsed: boolean }
  | { kind: "tool"; index: number; id: string; name: string; target: string; status: "running" | "done" | "error"; preview?: string };
type ToolBlock = Block & { kind: "tool" };

const ev = (m: any) => (m?.type === "stream_event" ? m.event : undefined);
function firstResultLine(content: unknown): string {
  const text = typeof content === "string" ? content
    : Array.isArray(content) ? content.map((b: any) => (typeof b?.text === "string" ? b.text : "")).join("") : "";
  return text.split("\n").map((s) => s.trim()).find((s) => s.length) ?? "";
}
function collapseThinking(blocks: Block[]): void { for (const b of blocks) if (b.kind === "thinking") b.collapsed = true; }

export class LiveTurn {
  private committed: Block[] = [];     // blocks from completed messages, in order
  private current: Block[] = [];       // blocks of the in-flight message, in start order
  private byTool = new Map<string, ToolBlock>();
  private sawPartials = false;         // distinguishes partials-on (flush on message_start) from off
  private ended = false;               // set by finalize() — running tools then render as a settled marker
  private errorLine?: string;
  model?: string;                      // captured from the first assistant frame's message.model

  /** Feed one frame from Session.submit's onMessage. Ignores unknown/irrelevant frames. */
  ingest(m: unknown): void {
    const e = ev(m);
    if (e) { this.sawPartials = true; this.onStreamEvent(e); return; }
    const mm = m as any;
    if (mm?.type === "assistant") this.onAssistant(mm);
    else if (mm?.type === "user") this.onUser(mm);
    // result / system / unknown → ignored (the turn's end is driven by useChat resolving)
  }

  fail(message: string): void { this.errorLine = message; }

  /** Current live-region lines; call after each ingest. */
  snapshot(): RenderLine[] {
    const out = [...this.committed, ...this.current].flatMap((b) => this.renderBlock(b));
    if (this.errorLine) out.push({ text: `✗ ${this.errorLine}`, color: "red" });
    return out;
  }

  /** Authoritative scrollback lines; settles open thinking/tool blocks. */
  finalize(): RenderLine[] { this.flush(); this.ended = true; return this.snapshot(); }

  private find(index: number): Block | undefined { return this.current.find((b) => b.index === index); }
  private flush(): void { collapseThinking(this.current); this.committed.push(...this.current); this.current = []; }

  private onStreamEvent(e: any): void {
    if (e.type === "message_start") { this.flush(); return; }   // a new message → seal the prior one
    if (e.type === "content_block_start") {
      collapseThinking(this.current);                            // any new block collapses prior thinking
      const i = e.index, cb = e.content_block ?? {};
      if (cb.type === "thinking") this.current.push({ kind: "thinking", index: i, text: "", collapsed: false });
      else if (cb.type === "text") this.current.push({ kind: "text", index: i, text: "" });
      else if (cb.type === "tool_use") {
        const tb: ToolBlock = { kind: "tool", index: i, id: String(cb.id ?? ""), name: String(cb.name ?? ""), target: "", status: "running" };
        this.current.push(tb); if (tb.id) this.byTool.set(tb.id, tb);
      }
      return;
    }
    if (e.type === "content_block_delta") {
      const b = this.find(e.index), d = e.delta ?? {};
      if (!b) return;
      if (b.kind === "text" && d.type === "text_delta") b.text += d.text ?? "";
      else if (b.kind === "thinking" && d.type === "thinking_delta") b.text += d.thinking ?? "";
      // input_json_delta / signature_delta → ignored (target comes from the full message)
    }
    // content_block_stop / message_delta / message_stop → no-op
  }

  private onAssistant(mm: any): void {
    const content: any[] = mm.message?.content ?? [];
    if (!this.model && mm.message?.model) this.model = String(mm.message.model);
    if (!this.sawPartials) this.flush();                         // partials-off: each assistant msg is its own boundary
    content.forEach((b, i) => {
      if (b?.type === "text") {
        const ex = this.find(i);
        if (ex && ex.kind === "text") ex.text = String(b.text ?? "");                 // authoritative overwrite (dedup)
        else this.current.push({ kind: "text", index: i, text: String(b.text ?? "") }); // fallback (no partial)
      } else if (b?.type === "thinking") {
        if (!this.find(i)) this.current.push({ kind: "thinking", index: i, text: String(b.thinking ?? ""), collapsed: false });
      } else if (b?.type === "tool_use") {
        const id = String(b.id ?? ""); const ex = id ? this.byTool.get(id) : undefined;
        if (ex) { ex.name = String(b.name ?? ex.name); ex.target = toolTarget(ex.name, b.input ?? {}); }
        else {
          const tb: ToolBlock = { kind: "tool", index: i, id, name: String(b.name ?? ""), target: toolTarget(String(b.name ?? ""), b.input ?? {}), status: "running" };
          this.current.push(tb); if (id) this.byTool.set(id, tb);
        }
      }
    });
  }

  private onUser(mm: any): void {
    for (const b of mm.message?.content ?? []) {
      if (b?.type !== "tool_result") continue;
      const tb = this.byTool.get(String(b.tool_use_id ?? ""));
      if (!tb) continue;
      tb.status = b.is_error ? "error" : "done";
      if (!b.is_error) { const p = trunc(firstResultLine(b.content)); if (p) tb.preview = p; }
    }
  }

  private renderBlock(b: Block): RenderLine[] {
    if (b.kind === "text") return b.text ? b.text.split("\n").map((t) => ({ text: t })) : [];
    if (b.kind === "thinking")
      return b.collapsed ? [{ text: "✦ Thinking", dim: true }]
        : (b.text ? b.text.split("\n").map((t) => ({ text: t, dim: true })) : []);
    const label = b.target ? `${b.name} ${b.target}` : b.name;
    if (b.status === "error") return [{ text: `✗ ${label}`, color: "red" }];
    if (b.status === "done") return [{ text: `✓ ${label}${b.preview ? "  │ " + b.preview : ""}` }];
    return this.ended ? [{ text: `· ${label}`, dim: true }] : [{ text: `⟳ ${label}` }];  // running (settled after finalize)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tui && npx vitest run test/liveTurn.test.ts && npm run typecheck`
Expected: PASS (all 8 reducer tests); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add tui/src/liveTurn.ts tui/test/liveTurn.test.ts
git commit -m "feat(tui): LiveTurn reducer — live text/thinking/tool from partial frames"
```

---

### Task 3: Wire `useChat` to `LiveTurn` + capture model

**Files:**
- Modify: `tui/src/useChat.ts`
- Test: `tui/test/useChat.test.tsx`

**Interfaces:**
- Consumes: `LiveTurn` (Task 2).
- Produces: `ChatState` gains `model?: string`; `useChat(...).state.model`. `ChatSession` interface is **unchanged** (model is read from frames, not a new method) — existing fakes keep working.

- [ ] **Step 1: Write the failing test** — in `tui/test/useChat.test.tsx`, extend `Host` to surface the model, and add a streaming test. Change the `Host` return line to include the model, and append the test inside the `describe("useChat", …)` block:

```ts
// in Host(): add the model to the rendered output
return <Text>{c.state.pending ? `PENDING:${c.state.pending.req.toolName}` : c.state.busy ? "BUSY" : "IDLE"} m:{c.state.model ?? "-"} {c.state.lines.map((l) => l.text).join("|")}</Text>;
```

```ts
  it("streams partial frames live and captures the model from the assistant frame", async () => {
    const fake = fakeSession({ async submit(_p: string, onMessage: (m: unknown) => void) {
      onMessage({ type: "stream_event", event: { type: "message_start" } });
      onMessage({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } });
      onMessage({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "PINE" } } });
      onMessage({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "CONE" } } });
      onMessage({ type: "assistant", message: { model: "claude-sonnet-4-6", content: [{ type: "text", text: "PINECONE" }] } });
      return { result: "PINECONE" };
    } });
    const { lastFrame } = render(<Host session={fake} ui={createUiBroker()} prompt="hi" />);
    await waitFor(() => frame(lastFrame).includes("PINECONE") && frame(lastFrame).includes("m:claude-sonnet-4-6"));
    expect(lastFrame()).toContain("PINECONE");
    expect(lastFrame()).toContain("m:claude-sonnet-4-6");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tui && npx vitest run test/useChat.test.tsx`
Expected: FAIL — `state.model` is `undefined` (`m:-`), and/or text not committed, because `useChat` still uses `renderMessage` per-message (no `stream_event` branch → no lines).

- [ ] **Step 3: Implement** — edit `tui/src/useChat.ts`:

(a) Replace the render import and add the reducer import:

```ts
import type { RenderLine } from "./render.js";
import { LiveTurn } from "./liveTurn.js";
```

(remove the old `import { renderMessage, type RenderLine } from "./render.js";`).

(b) Add `model` to `ChatState`:

```ts
export interface ChatState { lines: RenderLine[]; streaming: RenderLine[]; pending: Pending | null; mode: string; busy: boolean; ctxPct?: number; model?: string; }
```

(c) Add model state next to the others:

```ts
  const [model, setModel] = useState<string | undefined>(undefined);
```

(d) Replace `submit` with the `LiveTurn`-driven version:

```ts
  function submit(prompt: string) {
    if (disposed.current || busy || !prompt.trim()) return;
    setLines((l) => [...l, { text: `› ${prompt}`, dim: true }]);
    setStreaming([]); setBusy(true);
    const lt = new LiveTurn();
    session.submit(prompt, (m) => { if (disposed.current) return; lt.ingest(m); setStreaming(lt.snapshot()); })
      .then(() => {}, (e) => { lt.fail((e as Error).message); })
      .finally(() => { if (disposed.current) return; setLines((l) => [...l, ...lt.finalize()]); setStreaming([]); setBusy(false); if (lt.model) setModel(lt.model); void refreshCtx(); });
  }
```

(e) Include `model` in the returned state:

```ts
  return { state: { lines, streaming, pending, mode, busy, ctxPct, model } as ChatState, submit, resolvePermission, cycleMode, interrupt };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tui && npx vitest run test/useChat.test.tsx && npm run typecheck`
Expected: PASS — including the existing `"streams a submitted turn into the transcript"` test (the fake emits a full `assistant` message with no partials → the reducer's fallback path renders `"working"`).

- [ ] **Step 5: Commit**

```bash
git add tui/src/useChat.ts tui/test/useChat.test.tsx
git commit -m "feat(tui): drive useChat turns through LiveTurn; capture model from frames"
```

---

### Task 4: Live status bar — model + streaming indicator

**Files:**
- Modify: `tui/src/ChatStatusBar.tsx`, `tui/src/ChatApp.tsx`
- Test: `tui/test/components.test.tsx`

**Interfaces:**
- Consumes: `ChatState.model` (Task 3).
- Produces: `ChatStatusBar` prop `model?: string`; `ChatApp` threads `state.model` + `state.busy`.

- [ ] **Step 1: Write the failing test** — append to `tui/test/components.test.tsx` (use the file's existing `render` import from `ink-testing-library`; if `ChatStatusBar` is not yet imported there, add `import { ChatStatusBar } from "../src/ChatStatusBar.js";`):

```ts
describe("ChatStatusBar", () => {
  it("shows the model and a live streaming indicator while busy", () => {
    const { lastFrame } = render(<ChatStatusBar model="claude-sonnet-4-6" mode="default" busy={true} ctxPct={34} hasPending={false} />);
    const f = lastFrame() ?? "";
    expect(f).toContain("claude-sonnet-4-6");
    expect(f).toContain("⟳ streaming");
    expect(f).toContain("ctx 34%");
  });
  it("hides the streaming indicator and model segment when idle/absent", () => {
    const { lastFrame } = render(<ChatStatusBar mode="default" busy={false} ctxPct={10} hasPending={false} />);
    const f = lastFrame() ?? "";
    expect(f).not.toContain("streaming");
    expect(f).not.toContain("model ");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tui && npx vitest run test/components.test.tsx`
Expected: FAIL — `ChatStatusBar` has no `model` prop and emits `…working`, not `⟳ streaming` (type error and/or assertion failure).

- [ ] **Step 3: Implement**

`tui/src/ChatStatusBar.tsx` — full file:

```tsx
// tui/src/ChatStatusBar.tsx — bottom bar: model · permission mode (color-coded) · ctx% · live streaming · hints.
import React from "react";
import { Box, Text } from "ink";

export function ChatStatusBar({ model, mode, busy, ctxPct, hasPending }: { model?: string; mode: string; busy: boolean; ctxPct?: number; hasPending: boolean }) {
  return (
    <Box>
      {model ? <Text>model <Text color="cyan">{model}</Text>{"  "}</Text> : null}
      <Text>mode </Text><Text color={mode === "bypassPermissions" ? "red" : "green"}>{mode}</Text>
      <Text>{ctxPct != null ? `  ctx ${ctxPct}%` : ""}</Text>
      <Text>{busy ? "  ⟳ streaming" : ""}</Text>
      <Text dimColor>{hasPending ? "   [a/A/d]" : "   Tab mode · Esc interrupt"}</Text>
    </Box>
  );
}
```

`tui/src/ChatApp.tsx` — change the status-bar line to thread `model` + `busy`:

```tsx
      <ChatStatusBar model={state.model} mode={state.mode} busy={state.busy} ctxPct={state.ctxPct} hasPending={!!state.pending} />
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tui && npx vitest run test/components.test.tsx test/chat.test.tsx && npm run typecheck`
Expected: PASS — the new `ChatStatusBar` tests, and the existing `chat.test.tsx` (ChatApp composition) still green with the extra props.

- [ ] **Step 5: Commit**

```bash
git add tui/src/ChatStatusBar.tsx tui/src/ChatApp.tsx tui/test/components.test.tsx
git commit -m "feat(tui): status bar shows model + live streaming indicator"
```

---

### Task 5: Flip the flag + gated live test

**Files:**
- Modify: `tui/src/chat.tsx`
- Create: `tui/test/live/chat-stream.e2e.test.ts`

**Interfaces:**
- Consumes: `openSession` (cc-harness), `LiveTurn` (Task 2). No new exports.

- [ ] **Step 1: Write the failing test** — create `tui/test/live/chat-stream.e2e.test.ts`:

```ts
// tui/test/live/chat-stream.e2e.test.ts — gated: real turn through openSession({includePartialMessages:true}).
import { describe, it, expect } from "vitest";
import { openSession } from "cc-harness";
import { LiveTurn } from "../../src/liveTurn.js";

const live = process.env.ANTHROPIC_API_KEY ? describe : describe.skip;

live("chat live streaming (live)", () => {
  it("streams ≥2 growing snapshots, finalizes the answer, and captures the model", async () => {
    const session = openSession({ permissionMode: "bypassPermissions", includePartialMessages: true });
    try {
      const lt = new LiveTurn();
      const snaps: string[] = [];
      await session.submit("Reply with exactly the single word PINECONE and nothing else.", (m) => {
        lt.ingest(m); snaps.push(lt.snapshot().map((l) => l.text).join("\n"));
      });
      const distinct = new Set(snaps.filter((s) => s.length));
      const finalText = lt.finalize().map((l) => l.text).join("\n");
      expect(distinct.size).toBeGreaterThanOrEqual(2);        // proves live growth (not one batch render)
      expect(finalText).toContain("PINECONE");
      expect(lt.model).toBeTruthy();                          // feeds the status bar
    } finally {
      await session.dispose();
    }
  }, 60_000);
});
```

- [ ] **Step 2: Run test to verify it fails (keyless skip is the expected default)**

Run: `cd tui && npx vitest run test/live/chat-stream.e2e.test.ts`
Expected: **SKIPPED** without a key (the `describe.skip` gate) — confirms it never blocks keyless CI. (The implementer stops here; the controller runs the keyed pass in Step 4.)

- [ ] **Step 3: Implement** — in `tui/src/chat.tsx`, add the flag to the `openSession({…})` call:

```ts
const session = openSession({ model: flag("--model"), cwd: flag("--cwd") ?? process.cwd(), permissionMode: "default", permissionBroker: ui.broker, contextTool: true, includePartialMessages: true });
```

- [ ] **Step 4: Run the keyed live test (controller-run)**

Run: `cd tui && set -a; . ../.env; set +a; npx vitest run test/live/chat-stream.e2e.test.ts`
Expected: PASS (~10–40 s) — ≥2 distinct snapshots, final contains `PINECONE`, model truthy.

- [ ] **Step 5: Commit**

```bash
git add tui/src/chat.tsx tui/test/live/chat-stream.e2e.test.ts
git commit -m "feat(tui): enable partial streaming in cc-harness-chat + gated live e2e"
```

---

### Task 6: Refresh coverage scorecard + memory

**Files:**
- Modify: `docs/parity/coverage.md` (Domain 10 row + the §2 narrative for increment 5)
- Modify: memory `phase3-observability-dashboard-shipped.md` + `MEMORY.md` index hook

**Interfaces:** docs only — no code.

- [ ] **Step 1: Full keyless gate (proof the increment is green)**

Run: `cd tui && npm run typecheck && npx vitest run test`
Expected: typecheck clean; all keyless suites pass (live suite skips).

- [ ] **Step 2: Update `docs/parity/coverage.md`** — in the Domain 10 row, append after the increment-4 sentence:

```
**Phase-3 increment 5 SHIPPED — live streaming + live status bar** (`cc-harness-chat`): a pure `tui/src/liveTurn.ts` reducer turns SDK partial `stream_event` frames into live token-by-token text, stream-then-collapse thinking (`✦ Thinking`), and in-place tool `⟳ running → ✓/✗ done` status; the status bar shows live model · mode · ctx% · `⟳ streaming`. Engine change is one flag (`includePartialMessages`) — no harness source change. Probe 20 verified partials flow in the multi-turn streaming-input Session path; spec/plan `2026-06-19-chat-live-streaming`.
```

Bump the Domain 10 "Realized" estimate from `~34%` to `~38%` (and the `¹` note stays).

- [ ] **Step 3: Update memory** — append an increment-5 line to `phase3-observability-dashboard-shipped.md` (incr 5 = live streaming reducer; poll-based incr 4 unchanged) and refresh the `MEMORY.md` one-line hook. Convert any relative dates to absolute (2026-06-19).

- [ ] **Step 4: Commit**

```bash
git add docs/parity/coverage.md
git commit -m "docs(parity): record increment-5 chat live streaming (Domain 10)"
```

(Memory files live outside the repo — write them with the memory tooling, not a git commit.)

---

## Self-Review

**1. Spec coverage** — every spec section maps to a task:
- Live text streaming → Task 2 (`text_delta` accumulation) + Task 3 (wiring) + Task 5 (live proof).
- Thinking stream-then-collapse → Task 2 (collapse on next block / finalize).
- Tool collapse + running→done → Task 2 (`content_block_start`→`⟳`, `tool_result`→`✓/✗`).
- `(messageSeq,index)` per-message keying / dedup / fallback → Task 2 (`flush` on `message_start`; `find` by index within `current`; authoritative overwrite; partials-off `flush`).
- Status bar (model · mode · ctx% · streaming) → Task 4; model capture → Task 3.
- One config flag, no harness change → Task 5.
- Tests: reducer fixtures (Task 2), status-bar component (Task 4), gated live (Task 5).
- Docs refresh → Task 6.

**2. Placeholder scan** — no TBD/TODO; every code step shows complete code; every command has an expected result. Clean.

**3. Type consistency** — `LiveTurn`'s `ingest/snapshot/finalize/fail/model` are identical across Tasks 2/3/5; `RenderLine` is `{text;color?;dim?}` throughout; `toolTarget(name,input)` signature matches Task 1↔2; `ChatState.model?:string` matches Task 3↔4; `ChatStatusBar` props match Task 4 impl↔test. Consistent.

**Deviation from spec (intentional, A1-grounded):** model is sourced from the assistant frame's `message.model`, not `initializationResult()` (shape unverified by probe 20) — so `ChatSession` gains no method and existing test fakes are untouched. The reducer renders all block kinds itself, so the fallback path needs no `renderMessage` call (`render.ts`'s `renderMessage` is retained for its existing tests / other consumers).
