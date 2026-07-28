# C5 — TUI Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use doperpowers:subagent-driven-development
> (recommended) or doperpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close `docs/parity/tui-ux.md` from ~83% to ~93–95%: Esc-Esc rewind (full chain: contract →
host ops → client → picker UI), the `/usage` plan-utilization surface, the MED rows (`?` overlay,
diff numbers+context, bash/tool-row fidelity), and the LOW polish tail (tables, syntax highlight,
compact divider, `/copy`, word movement, `●` glyph).

**Architecture:** The rewind chain mirrors Goal B's decision-park layering exactly — an optional
`RewindOps` mixin on `ChatSession`, three NDJSON host ops, pass-through client adapter methods, and
a two-stage Ink picker. Conversation rewind is an engine swap through a `swapEngine()` helper
extracted from `resumeSession` (carries the live runtime mode — the `b8212e4f82` lesson); file
restore runs on the live engine *before* the swap (probe 68d's transport constraint). Anchor
classification is one shared content-shape module (`sessions/rows.ts`) used by both the picker and
transcript replay.

**Tech Stack:** TypeScript ESM (`.js` import specifiers), Ink 5 + ink-testing-library, vitest, zod
v4 (host op schemas), `@anthropic-ai/claude-agent-sdk` 0.3.211.

## Global Constraints

Copied from the spec (rev 2) + `harness/CLAUDE.md`; every task's requirements include these.

- **Two anchors per picker row** (probe 68c): file restore uses the selected prompt's `uuid`;
  conversation restore uses `prevUuid` — the nearest preceding *real* transcript row's uuid —
  because `resumeSessionAt(X)` KEEPS X and drops only what follows.
- **File restore before engine swap** (probe 68d): `rewindFiles` needs the live transport.
- **Guard the throw/return split** (probe 68d): with checkpointing off, dryRun *returns*
  `{canRewind:false, error}` but the real call *throws* — the host op dry-run-checks before the real
  call and normalizes to a structured error.
- **The engine swap opens at `this.mode`** (the current runtime mode), never the launch config.
- **Rewind is rejected while a turn runs or a decision is parked — host-side** (attach = multiple
  clients; the client only greys the affordance).
- **Live background tasks do not block a rewind but die with it**: host emits the stopped-notice
  task event + an empty `tasks_changed` snapshot (via `swapEngine`); code-only rewind swaps nothing.
- **Anchor classification is content-shape** (`getSessionMessages` rows carry no meta flags, probe
  68b): exclude `<command-name>`, `<local-command-stdout>`, `<local-command-caveat>`, and
  compact-summary rows. One shared module — picker and replay must not drift.
- **Anchors are always re-fetched, never patched locally** (probe 68 Q4 / 68c).
- **Phantom-`prevUuid` prompts (first prompt, first-after-compact) offer code-only restore.**
- **Restore-choice copy, verbatim:** `1. Restore conversation and code` ·
  `2. Restore conversation only` · `3. Restore code only`.
- **`RewindDryRun.filesChanged` is `string[]`** (paths, not a count — probe 68d).
- **Usage degradation is honest**: `rate_limits_available:false` → the line
  `plan usage not available under this credential (claude setup-token has no profile scope)` — never
  a silent absence. Status bar warns only at ≥80% utilization. Fetch on command/turn-end only.
- **Token-free usage live test** additionally gates on `~/.claude/.credentials.json` existing.
- **Zero new dependencies** (hand-rolled highlighter; clipboard via spawned `pbcopy`/`xclip`).
- House rules: dense hand-style, NO Prettier; ESM `.js` specifiers; DI-by-deps (fake `QueryFn`/fake
  sessions — no network in unit/tui tests); `npm run typecheck` after every change; tui tests
  `await` a tick before writing keys; commit per task, no `Co-Authored-By`; never touch or print
  `.env`.

**Commands** (all from `CC-to-SDK/harness/`): `npm run typecheck` · `npm run test:unit` ·
`npm run test:tui` · `npx vitest run test/<path>` · `npm run build`.

---

### Task 1: Contract types + the shared row classifier (`sessions/rows.ts`) + replay adoption

**Files:**
- Modify: `src/session/chatSession.ts` (append the RewindOps mixin)
- Create: `src/sessions/rows.ts`
- Modify: `src/sessions/index.ts` (re-export), `src/index.ts:61-62` (public barrel), `src/tui/replay.ts`
- Test: `test/unit/rows.test.ts`, update `test/tui/replay.test.ts` (exists — extend), `test/unit/index.test.ts` (pin update)

**Interfaces:**
- Consumes: nothing new.
- Produces (every later task relies on these exact names):
  - `chatSession.ts`: `RewindScope = "both" | "conversation" | "code"`;
    `RewindAnchor { uuid: string; prevUuid: string | null; text: string; index: number }`;
    `RewindDryRun { canRewind: boolean; filesChanged?: string[]; insertions?: number; deletions?: number; error?: string }`;
    `RewindOps { rewindAnchors(): Promise<RewindAnchor[]>; rewindDryRun(uuid: string): Promise<RewindDryRun>; rewind(anchor: RewindAnchor, scope: RewindScope): Promise<void> }`;
    `hasRewind(s: ChatSession): s is ChatSession & RewindOps`
  - `sessions/rows.ts`: `RowKind`, `rowKind(m: any): RowKind`, `promptText(m: any): string`,
    `rewindAnchorsFrom(messages: any[]): RewindAnchor[]` (newest-first)

- [ ] **Step 1: Write the failing tests**

`test/unit/rows.test.ts` — table-test the classifier against every species probe 68b observed:

```ts
import { describe, it, expect } from "vitest";
import { rowKind, rewindAnchorsFrom, promptText } from "../../src/sessions/rows.js";

const user = (text: string, uuid?: string) => ({ type: "user", uuid, message: { role: "user", content: text } });
const userBlocks = (blocks: unknown[], uuid = "u") => ({ type: "user", uuid, message: { role: "user", content: blocks } });
const assistant = (text: string, uuid: string) => ({ type: "assistant", uuid, message: { role: "assistant", content: [{ type: "text", text }] } });

describe("rowKind", () => {
  it("classifies a plain prompt", () => expect(rowKind(user("hello", "u1"))).toBe("prompt"));
  it("classifies a block-content prompt", () => expect(rowKind(userBlocks([{ type: "text", text: "hi" }]))).toBe("prompt"));
  it("classifies tool_result rows (any tool_result block)", () =>
    expect(rowKind(userBlocks([{ type: "tool_result", content: "x" }]))).toBe("tool_result"));
  it("classifies slash-command echoes", () =>
    expect(rowKind(user("<command-name>/compact</command-name> <command-message>compact</command-message>", "u2"))).toBe("command_echo"));
  it("classifies local-command stdout", () => expect(rowKind(user("<local-command-stdout>ok</local-command-stdout>", "u3"))).toBe("command_output"));
  it("classifies caveat rows", () => expect(rowKind(user("<local-command-caveat>Caveat: …</local-command-caveat>", "u4"))).toBe("caveat"));
  it("classifies compact summaries", () =>
    expect(rowKind(user("This session is being continued from a previous conversation that ran out of context. …", "u5"))).toBe("compact_summary"));
  it("a uuid-less user row is not an anchor", () => expect(rowKind(user("hello"))).toBe("other"));
  it("assistant rows are other", () => expect(rowKind(assistant("hi", "a1"))).toBe("other"));
});

describe("rewindAnchorsFrom", () => {
  it("returns prompts newest-first with prevUuid = nearest preceding REAL row", () => {
    const msgs = [user("A", "uA"), assistant("okA", "aA"), user("B", "uB"), assistant("okB", "aB")];
    const anchors = rewindAnchorsFrom(msgs);
    expect(anchors.map((a) => a.uuid)).toEqual(["uB", "uA"]);
    expect(anchors[0].prevUuid).toBe("aA");     // B's predecessor is A's reply
    expect(anchors[1].prevUuid).toBeNull();     // A is the first prompt
    expect(anchors[0].text).toBe("B");
  });
  it("prevUuid walks past phantom rows (command echo/stdout) to the last real row", () => {
    const msgs = [user("A", "uA"), assistant("okA", "aA"),
      user("<command-name>/compact</command-name>", "uE"), user("<local-command-stdout>x</local-command-stdout>", "uO"),
      user("B", "uB")];
    const anchors = rewindAnchorsFrom(msgs);
    expect(anchors[0].prevUuid).toBe("aA");     // skipped uO and uE
  });
  it("a prompt with ONLY phantom rows before it gets prevUuid null (code-only degradation)", () => {
    const msgs = [user("This session is being continued from a previous conversation …", "uS"), user("B", "uB")];
    expect(rewindAnchorsFrom(msgs)[0].prevUuid).toBeNull();
  });
  it("phantom rows are never anchors themselves", () => {
    const msgs = [user("<command-name>/x</command-name>", "uE"), user("real", "uR")];
    expect(rewindAnchorsFrom(msgs).map((a) => a.uuid)).toEqual(["uR"]);
  });
});

describe("promptText", () => {
  it("string content", () => expect(promptText(user("hello", "u"))).toBe("hello"));
  it("block content first text", () => expect(promptText(userBlocks([{ type: "text", text: "hey" }]))).toBe("hey"));
});
```

Extend `test/tui/replay.test.ts` with:

```ts
it("hides command stdout/caveat rows, renders command echoes as dim slash lines, and marks compact summaries", () => {
  const msgs = [
    { type: "user", uuid: "u1", timestamp: "2026-07-28T08:00:00Z", message: { role: "user", content: "hi" } },
    { type: "user", uuid: "u2", message: { role: "user", content: "<command-name>/compact</command-name> <command-message>compact</command-message>" } },
    { type: "user", uuid: "u3", message: { role: "user", content: "<local-command-stdout>Compacted</local-command-stdout>" } },
    { type: "user", uuid: "u4", message: { role: "user", content: "This session is being continued from a previous conversation that ran out of context. Summary…" } },
  ];
  const text = replayLines(msgs).map((l) => l.text).join("\n");
  expect(text).toContain("› /compact");
  expect(text).not.toContain("local-command-stdout");
  expect(text).not.toContain("Summary…");
  expect(text).toContain("─── context compacted earlier ───");
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/unit/rows.test.ts test/tui/replay.test.ts`
Expected: FAIL — `Cannot find module '../../src/sessions/rows.js'` / assertion failures.

- [ ] **Step 3: Implement**

Append to `src/session/chatSession.ts` (after `SessionEvents`, before the `has*` guards):

```ts
/** Esc-Esc rewind surface (host path only, like DecisionFeed). Two anchors per row (probe 68c):
 *  `uuid` (the selected prompt) drives rewindFiles; `prevUuid` (the nearest preceding REAL row)
 *  drives resumeSessionAt, because resumeSessionAt KEEPS its anchor and drops only what follows.
 *  prevUuid null = first prompt (or first-after-compact) → code-only restore. */
export type RewindScope = "both" | "conversation" | "code";
export interface RewindAnchor { uuid: string; prevUuid: string | null; text: string; index: number }
export interface RewindDryRun { canRewind: boolean; filesChanged?: string[]; insertions?: number; deletions?: number; error?: string }
export interface RewindOps {
  rewindAnchors(): Promise<RewindAnchor[]>;
  rewindDryRun(uuid: string): Promise<RewindDryRun>;
  rewind(anchor: RewindAnchor, scope: RewindScope): Promise<void>;
}
```

and alongside the other guards:

```ts
export function hasRewind(s: ChatSession): s is ChatSession & RewindOps {
  return typeof (s as Partial<RewindOps>).rewind === "function" && typeof (s as Partial<RewindOps>).rewindAnchors === "function";
}
```

Create `src/sessions/rows.ts`:

```ts
// sessions/rows.ts — content-shape classification of persisted transcript rows (getSessionMessages).
// The rows carry NO meta flags (probe 68b) — a "user" row can be a real prompt, a tool_result, a CLI
// slash-command echo, local-command stdout/caveat, or a compact continuation summary, and only the
// content shape tells them apart. ONE module so the rewind picker and transcript replay cannot drift.
import type { RewindAnchor } from "../session/chatSession.js";

export type RowKind = "prompt" | "tool_result" | "command_echo" | "command_output" | "caveat" | "compact_summary" | "other";

/** First text of a user row (string content, or the first text block). */
export function promptText(m: any): string {
  const c = m?.message?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return String(c.find((b: any) => b?.type === "text")?.text ?? "");
  return "";
}

export function rowKind(m: any): RowKind {
  if (m?.type !== "user") return "other";
  const c = m.message?.content;
  if (Array.isArray(c) && c.some((b: any) => b?.type === "tool_result")) return "tool_result";
  const text = promptText(m);
  if (/^\s*<command-name>/.test(text)) return "command_echo";
  if (/^\s*<local-command-stdout>/.test(text)) return "command_output";
  if (/^\s*<local-command-caveat>/.test(text)) return "caveat";
  // English-string sniffing, but the only signal there is: the CLI writes this exact preamble on the
  // continuation-summary row that replaces pre-compact history (probe 68b).
  if (/^This session is being continued from a previous conversation/.test(text)) return "compact_summary";
  if (!m.uuid) return "other";
  return "prompt";
}

/** The phantom kinds a conversation anchor must never land on (probe 68b: untested resumeAt semantics). */
const PHANTOM: ReadonlySet<RowKind> = new Set(["command_echo", "command_output", "caveat", "compact_summary"]);

/** User-prompt anchors, NEWEST-FIRST. prevUuid = the nearest PRECEDING row with a uuid whose kind is
 *  real (assistant/tool_result/prompt) — phantom rows are walked past, so rewinding also drops them. */
export function rewindAnchorsFrom(messages: any[]): RewindAnchor[] {
  const out: RewindAnchor[] = [];
  messages.forEach((m: any, i: number) => {
    if (rowKind(m) !== "prompt") return;
    let prevUuid: string | null = null;
    for (let j = i - 1; j >= 0; j--) {
      const p = messages[j] as any;
      if (p?.uuid && !PHANTOM.has(rowKind(p))) { prevUuid = String(p.uuid); break; }
    }
    out.push({ uuid: String(m.uuid), prevUuid, text: promptText(m), index: i });
  });
  return out.reverse();
}
```

Add to `src/sessions/index.ts`: `export { rowKind, promptText, rewindAnchorsFrom, type RowKind } from "./rows.js";`

Add to `src/index.ts` (next to lines 61-62):
`export type { RewindScope, RewindAnchor, RewindDryRun, RewindOps } from "./session/chatSession.js";`
and add `hasRewind` to the existing value-export line. Update `test/unit/index.test.ts`'s pinned
surface with the new names (the test names the expected export list — add them there).

Modify `src/tui/replay.ts`: import `{ rowKind }` from `"../sessions/rows.js"`, delete the local
`isToolResult`, and replace the filter + loop:

```ts
const shown = messages.filter((m) => { const k = rowKind(m); return k !== "tool_result" && k !== "command_output" && k !== "caveat"; });
```

and inside the `for (const m of kept)` loop, before the existing nested/renderMessage branches:

```ts
const k = rowKind(m);
if (k === "command_echo") { const name = /<command-name>\s*\/?([^<]+)</.exec(promptText(m))?.[1] ?? "command"; out.push({ text: `› /${name.trim()}`, dim: true }); continue; }
if (k === "compact_summary") { out.push(divider("context compacted earlier")); continue; }
```

(also import `promptText`). Note: `rowKind` uses `some(tool_result)` where the old predicate used
`every` — mixed rows (rare) are now skipped; this is the deliberate unification.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/unit/rows.test.ts test/tui/replay.test.ts test/unit/index.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(c5-t1): RewindOps contract + shared transcript-row classifier + replay adoption"
```

---

### Task 2: Host rewind — `swapEngine` extraction + the three host methods

**Files:**
- Modify: `src/host/host.ts`
- Test: `test/unit/host-rewind.test.ts` (create)

**Interfaces:**
- Consumes: `rewindAnchorsFrom` from `../sessions/rows.js`; `RewindAnchor`/`RewindDryRun`/`RewindScope` from `../session/chatSession.js`; T1.
- Produces (T3's server wiring calls these exact signatures):
  `SessionHost.rewindAnchors(): Promise<RewindAnchor[]>` ·
  `SessionHost.rewindDryRun(uuid: string): Promise<RewindDryRun>` ·
  `SessionHost.rewind(anchor: { uuid: string; prevUuid: string | null }, scope: RewindScope): Promise<void>` ·
  `HostSession.rewind?(userMessageId: string, opts?: { dryRun?: boolean }): Promise<unknown>` (optional member; the real `Session.rewind` at `src/session/session.ts:184` already matches) ·
  host deps gain `getMessages?: (id: string, opts: { cwd?: string }) => Promise<any[]>` (defaults to the real `getSessionMessages` from `../sessions/index.js`).

- [ ] **Step 1: Write the failing tests**

`test/unit/host-rewind.test.ts` — follow the existing host test fixtures' fake-session style
(see `test/unit/host-session.test.ts` for the pattern: a minimal `HostSession` object + `SessionHost`
with `deps.openSession` returning it; sockets are not needed — call the methods directly).

```ts
import { describe, it, expect, vi } from "vitest";
import { SessionHost } from "../../src/host/host.js";

const user = (text: string, uuid: string) => ({ type: "user", uuid, message: { role: "user", content: text } });
const assistant = (uuid: string) => ({ type: "assistant", uuid, message: { role: "assistant", content: [{ type: "text", text: "ok" }] } });

function makeHost(overrides: Record<string, unknown> = {}, opts: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const opened: Record<string, unknown>[] = [];
  const session = {
    submit: vi.fn(async () => ({})), sessionId: "sid-1", dispose: vi.fn(async () => {}),
    onFrame: vi.fn(() => () => {}),
    rewind: vi.fn(async (uuid: string, o?: { dryRun?: boolean }) => {
      calls.push(`rewind:${uuid}:${o?.dryRun ? "dry" : "real"}`);
      return { canRewind: true, filesChanged: ["/tmp/a"], insertions: 1, deletions: 1 };
    }),
    ...overrides,
  };
  const getMessages = vi.fn(async () => [user("A", "uA"), assistant("aA"), user("B", "uB")]);
  const host = new SessionHost(
    { short: "h1", name: "h1", cwd: "/tmp", kind: "interactive", detached: true, config: {}, ...opts } as any,
    { openSession: (c: any) => { opened.push(c); return session as any; }, getMessages, disposeGraceMs: 20 } as any,
  );
  // start() binds a real socket; tests drive the methods directly instead — mirror host-session.test.ts
  (host as any).session = session; (host as any).mode = "acceptEdits";
  return { host, session, calls, opened, getMessages };
}

describe("rewindAnchors", () => {
  it("classifies via the shared module, newest-first", async () => {
    const { host } = makeHost();
    const anchors = await host.rewindAnchors();
    expect(anchors.map((a) => a.uuid)).toEqual(["uB", "uA"]);
    expect(anchors[0].prevUuid).toBe("aA");
  });
});

describe("rewindDryRun", () => {
  it("returns the shape, and normalizes a THROW into {canRewind:false,error}", async () => {
    const { host } = makeHost();
    expect((await host.rewindDryRun("uB")).canRewind).toBe(true);
    const { host: h2 } = makeHost({ rewind: vi.fn(async () => { throw new Error("File rewinding is not enabled."); }) });
    const dry = await h2.rewindDryRun("uB");
    expect(dry.canRewind).toBe(false);
    expect(dry.error).toMatch(/not enabled/);
  });
});

describe("rewind", () => {
  it("scope both: file restore (dry then real) on the LIVE engine BEFORE the swap, swap opens at runtime mode with resumeAt=prevUuid", async () => {
    const { host, calls, opened } = makeHost();
    await host.rewind({ uuid: "uB", prevUuid: "aA" }, "both");
    expect(calls).toEqual(["rewind:uB:dry", "rewind:uB:real"]);
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({ resume: "sid-1", resumeAt: "aA", permissionMode: "acceptEdits" });
  });
  it("scope code: no engine swap", async () => {
    const { host, opened } = makeHost();
    await host.rewind({ uuid: "uB", prevUuid: "aA" }, "code");
    expect(opened).toHaveLength(0);
  });
  it("scope conversation: no file restore", async () => {
    const { host, calls, opened } = makeHost();
    await host.rewind({ uuid: "uB", prevUuid: "aA" }, "conversation");
    expect(calls).toEqual([]);
    expect(opened).toHaveLength(1);
  });
  it("refuses code scopes when dryRun says canRewind false — and never runs the throwing real call", async () => {
    const rewind = vi.fn(async (_u: string, o?: { dryRun?: boolean }) => {
      if (o?.dryRun) return { canRewind: false, error: "File rewinding is not enabled." };
      throw new Error("File rewinding is not enabled.");
    });
    const { host } = makeHost({ rewind });
    await expect(host.rewind({ uuid: "uB", prevUuid: "aA" }, "both")).rejects.toThrow(/not enabled/);
    expect(rewind).toHaveBeenCalledTimes(1);   // dry only
  });
  it("refuses conversation scopes with a null prevUuid", async () => {
    const { host } = makeHost();
    await expect(host.rewind({ uuid: "uA", prevUuid: null }, "both")).rejects.toThrow(/code-only/);
  });
  it("refuses while a turn is in flight", async () => {
    const { host } = makeHost();
    (host as any).turnInFlight = true;
    await expect(host.rewind({ uuid: "uB", prevUuid: "aA" }, "both")).rejects.toThrow(/busy/);
  });
  it("clears bg tasks + emits the stopped notice and empty snapshot on a conversation rewind", async () => {
    const { host } = makeHost();
    (host as any).bgTasks = [{ task_id: "t1", task_type: "local_shell", description: "sleep" }];
    const events: any[] = [];
    host.follow((ev) => events.push(ev));
    await host.rewind({ uuid: "uB", prevUuid: "aA" }, "conversation");
    expect(events.some((e) => e.kind === "task" && /ended by rewind/.test(e.data?.summary ?? ""))).toBe(true);
    expect(events.some((e) => e.kind === "tasks_changed" && e.tasks.length === 0)).toBe(true);
  });
  it("resumeSession still swaps at runtime mode (regression: the swap is now shared)", async () => {
    const { host, opened } = makeHost();
    await host.resumeSession("other-sid");
    expect(opened[0]).toMatchObject({ resume: "other-sid", permissionMode: "acceptEdits" });
    expect((opened[0] as any).resumeAt).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/unit/host-rewind.test.ts`
Expected: FAIL — `rewindAnchors is not a function` etc.

- [ ] **Step 3: Implement in `src/host/host.ts`**

1. Imports: add `import { rewindAnchorsFrom } from "../sessions/rows.js";`,
   `import { getSessionMessages as realGetMessages } from "../sessions/index.js";`, and the types
   `RewindAnchor, RewindDryRun, RewindScope` from `"../session/chatSession.js"`.
2. `HostSession`: add the optional member (exact `Session.rewind` signature):
   `rewind?(userMessageId: string, opts?: { dryRun?: boolean }): Promise<unknown>;`
3. Constructor deps type: add `getMessages?: (id: string, opts: { cwd?: string }) => Promise<any[]>`.
4. Extract `swapEngine` from `resumeSession` — move the entire body of `resumeSession` after its
   busy-guard into:

```ts
/** Swap the underlying engine for a fresh open carrying `extra` (resume / resumeAt). Everything
 *  session-scoped resets with it; the swap opens at the CURRENT runtime mode (`this.mode`) — see
 *  resumeSession's doc for why launch-config would be the worse surprise. Shared by resumeSession
 *  and rewind (the conversation-restore engine swap). */
private async swapEngine(extra: Partial<HarnessConfig>): Promise<void> {
  const old = this.session;
  this.session = this.deps.openSession({ ...this.opts.config, ...extra, permissionMode: this.mode as HarnessConfig["permissionMode"], permissionBroker: this.broker() });
  this.turnBuffer.reset(); this.settledBy.clear();
  this.parentOf.clear(); this.subagentOf.clear();
  this.offFrame?.();
  this.offFrame = this.session.onFrame?.((m) => this.onSessionFrame(m));
  this.bgTasks = []; this.emit({ kind: "tasks_changed", tasks: [] });
  this.planUpgradePending = false;
  this.emit({ kind: "state", status: this.status() });
  const graceMs = this.deps.disposeGraceMs ?? DISPOSE_GRACE_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((r) => { timer = setTimeout(r, graceMs); (timer as { unref?: () => void }).unref?.(); });
  await Promise.race([old?.dispose().catch(() => {}) ?? Promise.resolve(), deadline]);
  clearTimeout(timer);
}

async resumeSession(sessionId: string): Promise<void> {
  if (this.turnInFlight) throw new Error(`host ${this.short} is busy`);
  await this.swapEngine({ resume: sessionId });
}
```

   Keep `resumeSession`'s existing explanatory comment block on `swapEngine`'s mode line.
5. The three new methods (place after `stopBgTask`):

```ts
/** User-prompt rewind anchors from the persisted transcript — always re-read, never cached (probe
 *  68 Q4: post-rewind row counts defy local arithmetic; the transcript is the truth). */
async rewindAnchors(): Promise<RewindAnchor[]> {
  const sid = this.session?.sessionId;
  if (!sid) return [];
  const rows = await (this.deps.getMessages ?? realGetMessages)(sid, { cwd: this.opts.cwd });
  return rewindAnchorsFrom(rows);
}

/** dryRun on the FILE anchor. Normalizes the throw-vs-return split (probe 68d): checkpointing-off
 *  makes dryRun RETURN {canRewind:false} but other failures (and older engines) THROW — callers get
 *  one shape either way. */
async rewindDryRun(uuid: string): Promise<RewindDryRun> {
  const fn = this.session?.rewind?.bind(this.session);
  if (!fn) return { canRewind: false, error: "rewind unsupported by this host" };
  try { return (await fn(uuid, { dryRun: true })) as RewindDryRun; }
  catch (e) { return { canRewind: false, error: (e as Error).message }; }
}

/** Esc-Esc rewind. ORDER IS LOAD-BEARING: file restore runs on the LIVE engine first (probe 68d:
 *  rewindFiles needs the open transport), THEN the conversation swap replaces the engine. The dry-run
 *  guard exists because with checkpointing off the real call THROWS where dryRun merely reports
 *  (probe 68d) — never reach the throwing call with a known-bad state. Live background tasks die
 *  with the swap (they belong to the old CLI process): announce, then clear via swapEngine. */
async rewind(anchor: { uuid: string; prevUuid: string | null }, scope: RewindScope): Promise<void> {
  if (this.turnInFlight) throw new Error(`host ${this.short} is busy`);
  if (this.parked.list().length) throw new Error("a decision is pending — answer it first");
  const sid = this.session?.sessionId;
  if (!sid) throw new Error("no session to rewind");
  if (scope !== "conversation") {
    const fn = this.session?.rewind?.bind(this.session);
    if (!fn) throw new Error("rewind unsupported by this host");
    const dry = (await fn(anchor.uuid, { dryRun: true })) as RewindDryRun;
    if (!dry?.canRewind) throw new Error(dry?.error ?? "file rewind unavailable");
    await fn(anchor.uuid);
  }
  if (scope !== "code") {
    if (!anchor.prevUuid) throw new Error("no conversation anchor before the first prompt — code-only rewind is available");
    if (this.bgTasks.length) this.emit({ kind: "task", data: { type: "task_notification", status: "stopped", task_id: "rewind", summary: "background tasks ended by rewind" } });
    await this.swapEngine({ resume: sid, resumeAt: anchor.prevUuid });
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/unit/host-rewind.test.ts && npm run test:unit && npm run typecheck`
Expected: PASS (whole unit suite — the swapEngine extraction must not break existing host tests).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(c5-t2): host rewind ops + swapEngine extraction (file-restore-before-swap, runtime-mode carry)"
```

---

### Task 3: Wire + client — op schemas, server dispatch, remote ops, adapter mixin

**Files:**
- Modify: `src/host/ops.ts`, `src/host/server.ts`, `src/host/host.ts` (start()'s handler wiring), `src/client/remote.ts`, `src/client/chatAdapter.ts`
- Test: `test/unit/client-chat-adapter.test.ts` (extend — existing file), `test/integration/host-client.test.ts` (extend — existing file)

**Interfaces:**
- Consumes: T2's `SessionHost.rewindAnchors/rewindDryRun/rewind`; T1's types.
- Produces: wire ops `rewind_anchors` / `rewind_dryrun {uuid}` / `rewind {uuid, prevUuid: string|null, scope}`;
  `RemoteChatSession.rewindAnchorsOp() / rewindDryRunOp(uuid) / rewindOp(uuid, prevUuid, scope)`;
  `remoteChatSession(...)` now satisfies `RewindOps` (T4 feature-tests via `hasRewind`).

- [ ] **Step 1: Write the failing tests**

Extend `test/integration/host-client.test.ts` (mirror its existing question-round-trip test's setup —
real UDS socket, fake engine session) with one rewind round-trip:

```ts
it("rewind ops round-trip: anchors → dryRun → rewind(both) reaches the host in order", async () => {
  // fake session identical to the file's existing pattern, plus:
  //   sessionId: "sid-r", rewind: vi.fn(async (u, o) => o?.dryRun ? { canRewind: true, filesChanged: [], insertions: 0, deletions: 0 } : {}),
  // host deps.getMessages returns [user A, assistant aA, user B] (same fixtures as host-rewind.test.ts)
  const chat = remoteChatSession(sockPath);
  await chat.whenReady();
  const anchors = await chat.rewindAnchors();
  expect(anchors[0]).toMatchObject({ uuid: "uB", prevUuid: "aA" });
  const dry = await chat.rewindDryRun(anchors[0].uuid);
  expect(dry.canRewind).toBe(true);
  await chat.rewind(anchors[0], "both");
  // the fake's rewind saw dry + real for uB (the host's own guard dry counts too: 3 calls total)
  expect(fakeRewind.mock.calls.map((c) => `${c[0]}:${c[1]?.dryRun ? "dry" : "real"}`)).toEqual(["uB:dry", "uB:dry", "uB:real"]);
});
```

Extend `test/unit/client-chat-adapter.test.ts` with a passthrough test (mirror the existing
`answerDecision` fake-connect style): `rewindAnchors()` resolves `[]` from `{ok:true, anchors:[]}`
and `rewind()` throws on `{ok:false, error:"busy"}`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/integration/host-client.test.ts test/unit/client-chat-adapter.test.ts`
Expected: FAIL — `rewindAnchors is not a function`.

- [ ] **Step 3: Implement**

`src/host/ops.ts` — three schema arms (before the closing `]`), and extend nothing else:

```ts
z.object({ op: z.literal("rewind_anchors"), ...withId }),
z.object({ op: z.literal("rewind_dryrun"), uuid: z.string().min(1), ...withId }),
z.object({ op: z.literal("rewind"), uuid: z.string().min(1), prevUuid: z.string().min(1).nullable(), scope: z.enum(["both", "conversation", "code"]), ...withId }),
```

`src/host/server.ts` — `HostHandlers` gains (import the three types from `../session/chatSession.js`):

```ts
rewindAnchors(): Promise<RewindAnchor[]>;
rewindDryRun(uuid: string): Promise<RewindDryRun>;
/** Gated like `resume` (see the dispatch arm) — busy must refuse, not race. */
rewind(anchor: { uuid: string; prevUuid: string | null }, scope: RewindScope): Promise<void>;
```

dispatch arms (after `stop_task`):

```ts
case "rewind_anchors": return { ok: true, anchors: await this.handlers.rewindAnchors() };
case "rewind_dryrun": return { ok: true, dryRun: await this.handlers.rewindDryRun(op.data.uuid) };
case "rewind": {
  if (this.handlers.busy()) return { ok: false, error: "busy" };
  await this.handlers.rewind({ uuid: op.data.uuid, prevUuid: op.data.prevUuid }, op.data.scope);
  return { ok: true };
}
```

`src/host/host.ts` `start()` handler wiring (after `stopTask`):

```ts
rewindAnchors: () => this.rewindAnchors(),
rewindDryRun: (uuid) => this.rewindDryRun(uuid),
rewind: (anchor, scope) => this.rewind(anchor, scope),
```

`src/client/remote.ts` (import `RewindAnchor, RewindDryRun, RewindScope`):

```ts
rewindAnchorsOp() { return this.send<{ ok: boolean; error?: string; anchors?: RewindAnchor[] }>({ op: "rewind_anchors" }); }
rewindDryRunOp(uuid: string) { return this.send<{ ok: boolean; error?: string; dryRun?: RewindDryRun }>({ op: "rewind_dryrun", uuid }); }
rewindOp(uuid: string, prevUuid: string | null, scope: RewindScope) { return this.send<{ ok: boolean; error?: string }>({ op: "rewind", uuid, prevUuid, scope }); }
```

`src/client/chatAdapter.ts` — `RemoteChat` type gains `& RewindOps` (import it + `RewindAnchor,
RewindDryRun, RewindScope`), and the returned object gains (after `stopBgTask`):

```ts
async rewindAnchors() { return orFail(await (await ready).rewindAnchorsOp()).anchors ?? []; },
async rewindDryRun(uuid: string) { return orFail(await (await ready).rewindDryRunOp(uuid)).dryRun ?? { canRewind: false, error: "no reply" }; },
async rewind(anchor: RewindAnchor, scope: RewindScope) { orFail(await (await ready).rewindOp(anchor.uuid, anchor.prevUuid, scope)); },
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/integration/host-client.test.ts test/unit/client-chat-adapter.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(c5-t3): rewind wire ops + remote client + adapter RewindOps"
```

---

### Task 4: useChat rewind plumbing + composer prefill + `/rewind`

**Files:**
- Modify: `src/tui/useChat.ts`, `src/tui/commands.ts` (COMMANDS entry), `src/tui/editor.ts` (buffer setter export), `src/tui/ChatComposer.tsx` (prefill prop), `src/tui/replay.ts` (label opt)
- Test: `test/tui/useChat-rewind.test.ts` (create; renderHook style used by existing useChat tests — see `test/tui/` for the harness pattern)

**Interfaces:**
- Consumes: `hasRewind`, `RewindAnchor`, `RewindScope`, `RewindDryRun` (T1); a session satisfying `RewindOps` (T3's adapter, faked in tests).
- Produces (T5's picker + ChatApp consume these):
  `state.rewindPicker: { open: boolean; anchors: RewindAnchor[] }` ·
  `state.composerPrefill: { text: string; token: number } | null` ·
  `openRewind(): void` · `closeRewindPicker(): void` ·
  `rewindDryRun(uuid: string): Promise<RewindDryRun>` ·
  `confirmRewind(anchor: RewindAnchor, scope: RewindScope): void` ·
  editor: `export function withBufferText(s: EditorState, text: string): EditorState` ·
  ChatComposer prop `prefill?: { text: string; token: number } | null` ·
  `replayLines(msgs, { label?: string })` (header prefix override, default `"resumed"`).

- [ ] **Step 1: Write the failing tests**

`test/tui/useChat-rewind.test.ts` — fake session with the full `RewindOps` + `SessionEvents` shape
(copy the fake-session scaffold from the existing useChat tests in `test/tui/`):

```ts
// covers, one `it` each:
// 1. openRewind fetches anchors and opens: state.rewindPicker = { open: true, anchors: [...] }.
// 2. openRewind with zero anchors → notices "nothing to rewind to", stays closed.
// 3. openRewind while busy → notice, no fetch (rewindAnchors not called).
// 4. openRewind on a session without RewindOps (plain ChatSession fake) → notice "rewind unsupported", no crash.
// 5. confirmRewind(anchor, "both") → calls session.rewind(anchor, "both"), then getSessionMessages,
//    then lines contain the "⏪ rewound" header and composerPrefill.text === anchor.text.
// 6. confirmRewind(anchor, "code") → session.rewind called with "code", NO getSessionMessages call,
//    a "code restored" notice, composerPrefill stays null.
// 7. confirmRewind rejection (session.rewind rejects "busy") → "✗ rewind failed: busy" line, picker closed, no crash.
// 8. replayLines label: replayLines(msgs, { label: "⏪ rewound" })[0].text starts with "─── ⏪ rewound:".
```

Also in `test/tui/editor.test.ts` add: `withBufferText(initialEditorState(), "a\nb")` → lines
`["a","b"]`, cursor at `{row:1,col:1}`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/tui/useChat-rewind.test.ts test/tui/editor.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/tui/editor.ts`: the internal `setBuffer` already does exactly this — export a named wrapper
below it: `export function withBufferText(s: EditorState, t: string): EditorState { return setBuffer(s, t); }`

`src/tui/replay.ts`: `opts` gains `label?: string`; `const head = \`${opts.label ?? "resumed"}: …\``
(same interpolation as today) and the tail divider becomes
`divider(\`${opts.label ?? "resumed"} here · live\`)`.

`src/tui/commands.ts` COMMANDS: add `{ name: "rewind", summary: "rewind to a previous message (Esc Esc)" }`.

`src/tui/useChat.ts`:

```ts
// imports: hasRewind + the three types; RewindAnchor/RewindScope/RewindDryRun
const [rewindPicker, setRewindPicker] = useState<{ open: boolean; anchors: RewindAnchor[] }>({ open: false, anchors: [] });
const [composerPrefill, setComposerPrefill] = useState<{ text: string; token: number } | null>(null);

async function openRewind() {
  if (disposed.current) return;
  if (busy) { notice("cannot rewind mid-turn — Esc to interrupt first"); return; }
  if (!hasRewind(session)) { notice("rewind unsupported on this session"); return; }
  try {
    const anchors = await session.rewindAnchors();          // ALWAYS re-fetched (probe 68 Q4)
    if (disposed.current) return;
    if (!anchors.length) { notice("nothing to rewind to"); return; }
    setRewindPicker({ open: true, anchors });
  } catch (e) { append([{ text: `✗ ${(e as Error).message}`, color: "red" }]); }
}
function closeRewindPicker() { if (!disposed.current) setRewindPicker({ open: false, anchors: [] }); }
function rewindDryRun(uuid: string): Promise<RewindDryRun> {
  return hasRewind(session) ? session.rewindDryRun(uuid) : Promise.resolve({ canRewind: false, error: "unsupported" });
}
function confirmRewind(anchor: RewindAnchor, scope: RewindScope) {
  closeRewindPicker();
  if (!hasRewind(session)) return;
  void (async () => {
    try {
      await session.rewind(anchor, scope);
      if (disposed.current) return;
      if (scope === "code") { notice(`⏪ code restored to before “${anchor.text.slice(0, 40)}”`); return; }
      const id = session.sessionId;
      let msgs: any[] = [];
      if (id) { try { msgs = await getSessionMessages(id); } catch { msgs = []; } }
      if (disposed.current) return;
      setStreaming([]);
      setLines(msgs.length ? replayLines(msgs, { id, label: "⏪ rewound" }) : [{ text: "⏪ rewound", dim: true }]);
      setClearToken((t) => t + 1);
      taskListRef.current.reset(); setTasks([]);
      setComposerPrefill({ text: anchor.text, token: Date.now() });   // CC's edit-and-resend loop
    } catch (e) { append([{ text: `✗ rewind failed: ${(e as Error).message}`, color: "red" }]); }
  })();
}
```

`handleCommand` gains `case "rewind": void openRewind(); break;`. Extend `ChatState` with
`rewindPicker` + `composerPrefill` and the return object with the four functions.

`src/tui/ChatComposer.tsx`: prop `prefill?: { text: string; token: number } | null`; effect:

```ts
const lastPrefill = useRef(0);
useEffect(() => {
  if (!prefill || prefill.token === lastPrefill.current) return;
  lastPrefill.current = prefill.token;
  setState((s) => withBufferText(s, prefill.text));
}, [prefill]);
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/tui/ && npm run typecheck`
Expected: PASS (whole tui suite — replay label + ChatState changes must not break existing tests;
`ChatApp` doesn't pass the new props yet, they're optional).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(c5-t4): useChat rewind flow + composer prefill + /rewind"
```

---

### Task 5: RewindPicker + Esc-Esc + ChatApp wiring

**Files:**
- Create: `src/tui/RewindPicker.tsx`
- Modify: `src/tui/ChatApp.tsx`
- Test: `test/tui/RewindPicker.test.tsx` (create), extend `test/tui/ChatApp` tests if the suite has one (follow the existing dialog tests' `ink-testing-library` pattern; ALWAYS `await` a tick before writing keys)

**Interfaces:**
- Consumes: T4's `state.rewindPicker` / `openRewind` / `closeRewindPicker` / `rewindDryRun` / `confirmRewind` / `state.composerPrefill`; T1 types.
- Produces: `RewindPicker({ anchors, onDryRun, onConfirm, onClose })`.

- [ ] **Step 1: Write the failing tests**

`test/tui/RewindPicker.test.tsx`:

```ts
// fixtures: anchors = [ {uuid:"uB", prevUuid:"aA", text:"second prompt", index:2},
//                       {uuid:"uA", prevUuid:null, text:"first prompt", index:0} ]
// onDryRun resolvable-on-demand (deferred promise) so the pending state is assertable.
// covers, one `it` each:
// 1. renders anchors newest-first, ↑↓ moves selection, Esc calls onClose.
// 2. Enter on an anchor → onDryRun(uuid) called; while unresolved the scope stage shows "checking file changes…"
//    and keys 1/3 do nothing (code choices gated on the dryRun result).
// 3. dryRun resolves {canRewind:true, filesChanged:["/a","/b"], insertions:3, deletions:1} →
//    summary "2 files changed (+3 −1)"; pressing 1 → onConfirm(anchor, "both").
// 4. dryRun resolves {canRewind:false, error:"File rewinding is not enabled."} → rows 1 and 3 render
//    dim with the reason line; pressing 1 does nothing; pressing 2 → onConfirm(anchor, "conversation").
// 5. the null-prevUuid anchor: rows 1 and 2 dim with "nothing before this prompt"; only 3 works.
// 6. Esc in the scope stage returns to the list (onClose NOT called); Esc again closes.
// 7. verbatim copy: the three rows read exactly "1. Restore conversation and code",
//    "2. Restore conversation only", "3. Restore code only".
```

ChatApp-level (in the existing ChatApp/app test file, with a fake session exposing RewindOps):

```ts
// 8. Esc on an idle composer arms ("Press Esc again to rewind" visible); second Esc within the window
//    opens the picker (rewindAnchors called); while busy, Esc interrupts and never arms.
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/tui/RewindPicker.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/tui/RewindPicker.tsx`:

```tsx
// tui/src/RewindPicker.tsx — the Esc-Esc rewind picker (spec C5 §1): stage 1 lists user-prompt
// anchors newest-first; selecting one runs a lazy dryRun and opens stage 2 with CC's three restore
// choices. Two anchors per row (probe 68c): uuid drives file restore, prevUuid drives conversation
// restore; a null prevUuid (first prompt / first-after-compact) disables the conversation rows.
import React, { useEffect, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { RewindAnchor, RewindDryRun, RewindScope } from "../session/chatSession.js";
import { ACCENT } from "./theme.js";
import { trunc } from "./render.js";

export function RewindPicker({ anchors, onDryRun, onConfirm, onClose }: {
  anchors: RewindAnchor[];
  onDryRun: (uuid: string) => Promise<RewindDryRun>;
  onConfirm: (anchor: RewindAnchor, scope: RewindScope) => void;
  onClose: () => void;
}) {
  const [idx, setIdx] = useState(0);
  const [sel, setSel] = useState<RewindAnchor | null>(null);
  const [dry, setDry] = useState<RewindDryRun | null>(null);
  const seq = useRef(0);                       // stale-dryRun guard: only the latest selection's result lands
  useEffect(() => {
    if (!sel) return;
    const my = ++seq.current;
    setDry(null);
    onDryRun(sel.uuid).then((d) => { if (seq.current === my) setDry(d); })
      .catch((e) => { if (seq.current === my) setDry({ canRewind: false, error: (e as Error).message }); });
  }, [sel]);   // eslint-disable-line react-hooks/exhaustive-deps

  const codeOk = !!dry?.canRewind;                                  // gated until the dryRun lands
  const convOk = sel?.prevUuid != null;
  useInput((input, key) => {
    if (!sel) {
      if (key.escape) { onClose(); return; }
      if (key.upArrow) setIdx((i) => Math.max(0, i - 1));
      else if (key.downArrow) setIdx((i) => Math.min(anchors.length - 1, i + 1));
      else if (key.return && anchors[idx]) setSel(anchors[idx]);
      return;
    }
    if (key.escape) { setSel(null); setDry(null); return; }          // back to the list, not out
    if (input === "1" && codeOk && convOk) onConfirm(sel, "both");
    else if (input === "2" && convOk) onConfirm(sel, "conversation");
    else if (input === "3" && codeOk) onConfirm(sel, "code");
  });

  if (!sel) return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} borderColor={ACCENT}>
      <Text bold>Rewind to a previous message  <Text dimColor>(↑/↓ · Enter · Esc)</Text></Text>
      {anchors.map((a, i) => <Text key={a.uuid} inverse={i === idx}>{`› ${trunc(a.text, 70)}`}</Text>)}
    </Box>
  );
  const summary = dry === null ? "checking file changes…"
    : dry.canRewind ? ((dry.filesChanged?.length ?? 0) === 0 ? "no file changes"
      : `${dry.filesChanged!.length} file${dry.filesChanged!.length === 1 ? "" : "s"} changed (+${dry.insertions ?? 0} −${dry.deletions ?? 0})`)
    : (dry.error ?? "file rewind unavailable");
  const line = (n: string, label: string, ok: boolean, why: string) =>
    ok ? <Text>{n}. {label}</Text> : <Text dimColor>{n}. {label}  ({why})</Text>;
  const codeWhy = dry === null ? "checking…" : dry.error ?? "file rewind unavailable";
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} borderColor={ACCENT}>
      <Text bold>Rewind to: <Text color={ACCENT}>{trunc(sel.text, 60)}</Text></Text>
      <Text dimColor>{summary}</Text>
      <Text> </Text>
      {line("1", "Restore conversation and code", codeOk && convOk, convOk ? codeWhy : "nothing before this prompt")}
      {line("2", "Restore conversation only", convOk, "nothing before this prompt")}
      {line("3", "Restore code only", codeOk, codeWhy)}
      <Text dimColor>1/2/3 · esc back</Text>
    </Box>
  );
}
```

`src/tui/ChatApp.tsx`:
1. Destructure the T4 additions from `useChat`; import `RewindPicker`.
2. Esc-Esc arming, mirroring the Ctrl-C pattern:

```ts
const [escArmed, setEscArmed] = useState(false);
const escTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
useEffect(() => () => { if (escTimer.current) clearTimeout(escTimer.current); }, []);
const onInterrupt = () => {
  disarm();
  if (state.busy) { interrupt(); setEscArmed(false); return; }       // busy: Esc stays interrupt, never arms
  if (escArmed) { setEscArmed(false); if (escTimer.current) clearTimeout(escTimer.current); void openRewind(); return; }
  setEscArmed(true);
  if (escTimer.current) clearTimeout(escTimer.current);
  escTimer.current = setTimeout(() => setEscArmed(false), 1500);
};
```

(replaces the old `onInterrupt`; keep `onCycleMode` as is.)
3. Popup chain: insert the picker as the FIRST arm (rewind is user-initiated and modal):

```tsx
{state.rewindPicker.open
  ? <RewindPicker anchors={state.rewindPicker.anchors} onDryRun={rewindDryRun} onConfirm={confirmRewind} onClose={closeRewindPicker} />
  : state.bgPanelOpen
    ? …(existing chain unchanged)…
```

4. Pass `prefill={state.composerPrefill}` to `<ChatComposer>`.
5. Render the armed hint next to the Ctrl-C one:
   `{escArmed ? <Box paddingX={1}><Text dimColor>Press Esc again to rewind</Text></Box> : null}`

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/tui/ && npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(c5-t5): RewindPicker + Esc-Esc affordance + ChatApp wiring"
```

---

### Task 6: The usage surface — `/usage`, `/status` line, status-bar warning, token-free live test

**Files:**
- Create: `src/tui/usageFormat.ts`, `test/unit/usageFormat.test.ts`, `test/live/usage-surface.e2e.test.ts`
- Modify: `src/tui/commands.ts` (COMMANDS + `formatStatus`), `src/tui/useChat.ts`, `src/tui/ChatStatusBar.tsx`

**Interfaces:**
- Consumes: `session.usage()` (already on `ChatSession`) — payload per probe 55:
  `{ rate_limits_available?: boolean; rate_limits?: { five_hour?: W; seven_day?: W; seven_day_opus?: W; seven_day_sonnet?: W } | null }`
  where `W = { utilization?: number; resets_at?: string }`. `utilization` may arrive 0–1 or 0–100 —
  normalize (`<=1` → ×100).
- Produces: `formatUsage(u: unknown): RenderLine[]` · `usageWarning(u: unknown): string | undefined`
  (≥80% → e.g. `"⚠ 5h 83%"`) · `usageSummaryLine(u: unknown): string | undefined` (e.g.
  `"5h 43% · 7d 12%"`) · `formatStatus` gains optional `usage?: string` → row `  usage      <v>` ·
  `ChatStatusBar` prop `usageWarn?: string` · `ChatState.usageWarn?: string`.

- [ ] **Step 1: Write the failing tests**

`test/unit/usageFormat.test.ts` — cover: (1) a populated payload renders one bar row per present
window with a `%` and a reset time (`resets_at: "2026-07-28T15:00:00Z"` → row contains `resets`);
(2) fraction-vs-percent normalization (`utilization: 0.43` and `43` both render `43%`);
(3) `rate_limits_available:false` → exactly the honest line
`plan usage not available under this credential (claude setup-token has no profile scope)`;
(4) `usageWarning` undefined below 80, `"⚠ 7d 85%"` at 85 on `seven_day`, picks the max window;
(5) bar geometry: 10 cells, `43%` → `▓▓▓▓░░░░░░`.

Implementation shape:

```ts
// tui/src/usageFormat.ts — pure /usage + status-bar formatters (F4: probe 55 payload).
import type { RenderLine } from "./render.js";
const WINDOWS: [string, string][] = [["five_hour", "5h"], ["seven_day", "7d"], ["seven_day_opus", "7d opus"], ["seven_day_sonnet", "7d sonnet"]];
const pct = (u: unknown): number | undefined => typeof u === "number" ? Math.round(u <= 1 ? u * 100 : u) : undefined;
const bar = (p: number): string => "▓".repeat(Math.round(p / 10)).padEnd(10, "░");
const hhmm = (iso?: string): string => typeof iso === "string" && iso.length >= 16 ? iso.slice(11, 16) + "Z" : "";
export const UNAVAILABLE = "plan usage not available under this credential (claude setup-token has no profile scope)";
// formatUsage: header "Plan usage" bold; per present window `  5h        ▓▓▓▓░░░░░░ 43% · resets 15:00Z`;
// unavailable → [{ text: UNAVAILABLE, dim: true }]. usageWarning/usageSummaryLine walk the same WINDOWS.
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/unit/usageFormat.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement**

Write `usageFormat.ts` per the shape above. `commands.ts`: COMMANDS gains
`{ name: "usage", summary: "show plan usage / rate-limit windows" }`; `formatStatus` param type
gains `usage?: string` and (with the other optional rows) `if (s.usage) out.push({ text: \`  usage      ${s.usage}\`, dim: true });`

`useChat.ts`: add `const [usageWarn, setUsageWarn] = useState<string | undefined>(undefined);` and

```ts
async function refreshUsage() {
  try { const u = await session.usage(); if (!disposed.current) setUsageWarn(usageWarning(u)); return u; }
  catch { return undefined; }
}
```

Call `void refreshUsage()` next to `void refreshCtx()` in the turn-end arm (fetch-on-turn-end only —
spec's no-polling rule). `handleCommand`:
`case "usage": append(formatUsage(await session.usage())); break;` and `case "status"` passes
`usage: usageSummaryLine(await refreshUsage().catch(() => undefined))` — simpler: compute
`const u = await session.usage().catch(() => undefined)` inside the status arm and pass
`usage: u ? usageSummaryLine(u) : undefined`. Extend `ChatState` with `usageWarn` and pass through.

`ChatStatusBar.tsx`: prop `usageWarn?: string`; render
`{usageWarn ? <Text color="red">{"  " + usageWarn}</Text> : null}` after the ctx block.
`ChatApp.tsx`: pass `usageWarn={state.usageWarn}`.

`test/live/usage-surface.e2e.test.ts` (keyed/live-test conventions per `harness/CLAUDE.md`):

```ts
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { openSession } from "../../src/index.js";
import { formatUsage, UNAVAILABLE } from "../../src/tui/usageFormat.js";

const envToken = !!(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN);
const haveCreds = existsSync(join(homedir(), ".claude", ".credentials.json"));
// Token-free half: NO env token (the CLI falls back to the interactive credential — F4) AND the
// credential file exists on this machine. Anything else skips cleanly (spec acceptance ④ gate).
const tokenFree = !envToken && haveCreds ? describe : describe.skip;
// Keyed half: the standard gate — proves the honest-unavailable line under CLAUDE_CODE_OAUTH_TOKEN.
const keyed = process.env.CLAUDE_CODE_OAUTH_TOKEN && !process.env.ANTHROPIC_API_KEY ? describe : describe.skip;

tokenFree("usage surface (interactive credential)", () => {
  it("renders at least one utilization bar with a reset time", async () => {
    const s = openSession({ model: "claude-haiku-4-5-20251001", permissionMode: "bypassPermissions", settingSources: [] });
    try {
      await s.submit("Say exactly: OK", () => {});
      const u = await s.usage();
      const text = formatUsage(u).map((l) => l.text).join("\n");
      expect(text).toMatch(/%/);
      expect(text).toMatch(/resets/);
    } finally { await s.dispose(); }
  }, 120_000);
});

keyed("usage surface (oauth token)", () => {
  it("degrades to the honest-unavailable line", async () => {
    const s = openSession({ model: "claude-haiku-4-5-20251001", permissionMode: "bypassPermissions", settingSources: [] });
    try {
      await s.submit("Say exactly: OK", () => {});
      const text = formatUsage(await s.usage()).map((l) => l.text).join("\n");
      expect(text).toContain(UNAVAILABLE);
    } finally { await s.dispose(); }
  }, 120_000);
});
```

(Implementer runs it keyless — both halves must SKIP cleanly. The controller runs the live halves.)

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/unit/usageFormat.test.ts test/live/usage-surface.e2e.test.ts test/tui/ && npm run typecheck`
Expected: PASS (live file: skipped).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(c5-t6): /usage plan-utilization surface + status-bar warning + gated live test"
```

---

### Task 7: `?` shortcuts overlay + word movement

**Files:**
- Create: `src/tui/ShortcutsOverlay.tsx`, `test/tui/ShortcutsOverlay.test.tsx`
- Modify: `src/tui/editor.ts`, `src/tui/ChatComposer.tsx`, `src/tui/ChatApp.tsx`, `src/tui/useChat.ts` (a boolean + open/close)
- Test: extend `test/tui/editor.test.ts`

**Interfaces:**
- Consumes: composer's `useInput` routing (T5's file state).
- Produces: `ShortcutsOverlay({ onClose })`; editor handles `key.meta && key.leftArrow/rightArrow`
  (and Alt-`b`/`f`: `key.meta && input === "b"|"f"`) via new `wordLeft`/`wordRight`; ChatComposer
  prop `onHelp?: () => void`; `ChatState.shortcutsOpen: boolean` + `openShortcuts()/closeShortcuts()`.

- [ ] **Step 1: Write the failing tests**

`test/tui/editor.test.ts` additions:

```ts
// wordLeft: cursor after "hello world|" + meta+leftArrow → col 6 (start of "world"); again → col 0.
// wordLeft at col 0 of row 1 crosses to end of row 0. wordRight mirrors ("|hello world" → col 5 → col 11).
// Alt-b / Alt-f (meta + input "b"/"f") behave identically. meta+other input is a no-op (never inserts).
```

`test/tui/ShortcutsOverlay.test.tsx`: renders headings + at least the rows for `Esc Esc rewind`,
`Tab`, `Ctrl+B`, `!`, `#`, `?`; any keypress calls `onClose`.

ChatApp-level: pressing `?` on an EMPTY idle composer opens the overlay (`state.shortcutsOpen`);
`?` mid-buffer inserts a literal `?`.

- [ ] **Step 2: Run to verify they fail** — `npx vitest run test/tui/editor.test.ts test/tui/ShortcutsOverlay.test.tsx`. Expected: FAIL.

- [ ] **Step 3: Implement**

`editor.ts` — word ops (place near `killWordBack`), wired at the top of `applyKey` BEFORE the
`key.ctrl` block:

```ts
function wordLeft(s: EditorState): EditorState {
  let { row, col } = s.cursor;
  if (col === 0) { if (row === 0) return s; return { ...s, cursor: { row: row - 1, col: s.lines[row - 1].length } }; }
  const line = s.lines[row];
  let i = col; while (i > 0 && /\s/.test(line[i - 1])) i--; while (i > 0 && !/\s/.test(line[i - 1])) i--;
  return { ...s, cursor: { row, col: i } };
}
function wordRight(s: EditorState): EditorState {
  let { row, col } = s.cursor;
  const line = s.lines[row];
  if (col >= line.length) { if (row === s.lines.length - 1) return s; return { ...s, cursor: { row: row + 1, col: 0 } }; }
  let i = col; while (i < line.length && /\s/.test(line[i])) i++; while (i < line.length && !/\s/.test(line[i])) i++;
  return { ...s, cursor: { row, col: i } };
}
```

```ts
if (key.meta) {                                        // Alt/Option: word movement (Alt-←→, Alt-b/f)
  if (key.leftArrow || input === "b") return { state: syncCompletions(wordLeft(s)) };
  if (key.rightArrow || input === "f") return { state: syncCompletions(wordRight(s)) };
  return { state: s };                                 // other meta combos never insert
}
```

`ShortcutsOverlay.tsx` — a bordered static panel listing the keymap (⏎ send · \⏎ newline · ↑↓
history · Ctrl-A/E/K/U/W · Alt-←→ words · Tab mode ladder · Esc interrupt · Esc Esc rewind ·
Ctrl+B background · Ctrl-C ×2 exit · Ctrl-D EOF · Ctrl-L clear · Ctrl-Z detach · `!` bash · `#`
memory · `@` files · `/` commands · `?` this help); `useInput(() => onClose())`.

`ChatComposer.tsx`: prop `onHelp?: () => void`; in `useInput`, before `applyKey`:
`if (input === "?" && !s.command && !s.mention && s.lines.length === 1 && s.lines[0] === "") { onHelp?.(); return; }`

`useChat.ts`: `const [shortcutsOpen, setShortcutsOpen] = useState(false);` + open/close fns +
`ChatState.shortcutsOpen`. `ChatApp.tsx`: overlay as the new first popup arm (before the rewind
picker — it's pure display), `onHelp={openShortcuts}` on the composer. Update the status-bar hint
copy if needed (it already says `? help`).

- [ ] **Step 4: Run** — `npx vitest run test/tui/ && npm run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(c5-t7): ? shortcuts overlay + Alt word movement"
```

---

### Task 8: Transcript fidelity — `●` tool rows, Edit hunk diff (numbers + context), error-result framing

**Files:**
- Modify: `src/tui/render.ts`, `src/tui/liveTurn.ts:53,139-140` (agent-row glyph only)
- Test: extend `test/tui/render.test.ts` (exists)

**Interfaces:**
- Consumes: nothing new. Produces: `toolDiffLines` output shape change (downstream: liveTurn:144
  slices `[0]` off — head stays index 0, unchanged contract); `resultLines` reads `is_error`.

- [ ] **Step 1: Write the failing tests** (in `test/tui/render.test.ts`)

```ts
// 1. tool_use rows open with the ● gutter: renderMessage(assistant tool_use Bash).lines[0].gutter.text === "● "
//    and text "Bash(<cmd>)" (CC's form) — same for Read/other tools.
// 2. Edit diff: old_string "a\nb\nc\nd\ne", new_string "a\nb\nX\nd\ne" →
//    context rows "  1  a" / "  2  b" dim, change rows "  3 - c" red / "  3 + X" green,
//    trailing context "  4  d" / "  5  e" dim (≤3 each side), head unchanged at index 0.
// 3. Write (content only, no old_string) keeps the all-+ behavior.
// 4. an is_error tool_result renders red with the ✗ prefix on its first line.
// 5. cap still applies (a 40-line hunk body is capped with the "… N more lines" note).
```

- [ ] **Step 2: Run to verify they fail** — `npx vitest run test/tui/render.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement in `render.ts`**

`toolUseLines` → CC's bullet form (gutter so the glyph styles independently, matching U3):

```ts
function toolUseLines(name: string, input: Record<string, unknown>): RenderLine[] {
  const target = toolTarget(name, input);
  return [{ text: `${name}(${target})`, gutter: { text: "● " } }];
}
```

`toolDiffLines` — head gains the same gutter; body becomes a hunk diff when both `old_string` and
`new_string` are strings (common-prefix/suffix context, ≤3 lines each side, 1-based numbering
relative to the snippet — we never read the file, so absolute numbers are not available):

```ts
export function toolDiffLines(name: string, input: Record<string, unknown>, cap = 24): RenderLine[] {
  const head: RenderLine = { text: `${name} ${String(input.file_path ?? input.path ?? "")}`, gutter: { text: "● " } };
  const body: RenderLine[] = [];
  const oldS = typeof input.old_string === "string" ? input.old_string : undefined;
  const newS = typeof input.new_string === "string" ? input.new_string : typeof input.content === "string" ? input.content : undefined;
  if (oldS !== undefined && newS !== undefined) {
    const o = oldS.split("\n"), n = newS.split("\n");
    let pre = 0; while (pre < o.length && pre < n.length && o[pre] === n[pre]) pre++;
    let suf = 0; while (suf < o.length - pre && suf < n.length - pre && o[o.length - 1 - suf] === n[n.length - 1 - suf]) suf++;
    const num = (i: number) => String(i + 1).padStart(3);
    const CTX = 3;
    for (let i = Math.max(0, pre - CTX); i < pre; i++) body.push({ text: `${num(i)}  ${o[i]}`, dim: true });
    for (let i = pre; i < o.length - suf; i++) body.push({ text: `${num(i)} - ${o[i]}`, color: "red" });
    for (let i = pre; i < n.length - suf; i++) body.push({ text: `${num(i)} + ${n[i]}`, color: "green" });
    for (let i = o.length - suf; i < Math.min(o.length, o.length - suf + CTX); i++) body.push({ text: `${num(i)}  ${o[i]}`, dim: true });
  } else if (newS !== undefined) {
    for (const l of newS.split("\n")) body.push({ text: `  + ${l}`, color: "green" });
  }
  if (body.length <= cap) return [head, ...body];
  return [head, ...body.slice(0, cap), { text: `  … ${body.length - cap} more lines`, dim: true }];
}
```

`resultLines(content, isError?: boolean)` — error results red with a `✗`:

```ts
function resultLines(content: unknown, isError?: boolean): RenderLine[] {
  const text = /* unchanged extraction */;
  if (!text.trim()) return [];
  return text.split("\n").slice(0, 12).map((l, i) => isError
    ? { text: `  ⎿ ${i === 0 ? "✗ " : ""}${trunc(l, 100)}`, color: "red" }
    : { text: `  ⎿ ${trunc(l, 100)}`, dim: true });
}
```

with the caller passing `b.is_error`: `out.push(...resultLines(b.content, b.is_error === true));`

`liveTurn.ts` lines 53/139/140: `⚙` → `●` in the agent/nested strings (glyph only, no structure
change; the live `⟳✓✗` status glyphs stay — they are live-progress state, not row identity).

- [ ] **Step 4: Run** — `npx vitest run test/tui/ && npm run typecheck` (liveTurn/replay tests that
  assert `⚙` need their fixtures updated to `●` — update the assertions, not the behavior).
  Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(c5-t8): CC tool-row bullets + hunk diff with context/numbers + error-result framing"
```

---

### Task 9: LOW batch — markdown tables, syntax highlight, compact divider, `/copy`

**Files:**
- Create: `src/tui/highlight.ts`, `src/tui/copy.ts`, `test/unit/highlight.test.ts`, `test/unit/copy.test.ts`
- Modify: `src/tui/markdown.ts`, `src/tui/useChat.ts`, `src/tui/commands.ts` (COMMANDS entry)
- Test: extend `test/tui/markdown.test.ts`, `test/tui/useChat` tests (compact divider + /copy)

**Interfaces:**
- Produces: `highlightCode(line: string, lang: string): Segment[]` (known langs: `ts js tsx jsx py
  python sh bash zsh json`; unknown → `[{ text: line, dim: true }]`) ·
  `copyToClipboard(text: string, deps?: { platform?: string; spawn?: typeof execFile }): Promise<void>` ·
  markdown emits table lines and highlighted fence bodies · `/copy` copies the last assistant text.

- [ ] **Step 1: Write the failing tests**

`test/unit/highlight.test.ts`: keywords colored (`const x = 1` → segment `const` with a color),
strings green (`"hi"`), comments dim (`// note` whole-rest), numbers styled, unknown lang → single
dim segment, indentation preserved (leading `  ` intact in the first segment).

`test/tui/markdown.test.ts` additions: (1) a 2-col table (`| a | b |` header, `|---|---|`, one data
row) renders padded columns, bold header, a dim `─` separator row; (2) a fenced block ` ```ts ` gets
segment-styled lines while ` ``` ` (no lang) stays dim; (3) a lone `|`-containing prose line is NOT
a table (tables need the `|---|` separator as line 2).

`test/unit/copy.test.ts`: darwin spawns `pbcopy` with the text on stdin (fake spawn records); linux
tries `xclip -selection clipboard`; unknown platform rejects with a clear message.

useChat additions: a `system/compact_boundary` message event appends the
`─── context compacted ───` divider; `/copy` with no assistant text notices "nothing to copy";
`/copy` after an assistant message calls the injected copy fn with that text and notices `✓ copied`.

- [ ] **Step 2: Run to verify they fail.** Expected: FAIL.

- [ ] **Step 3: Implement**

`highlight.ts` (zero-dep, order: comment → strings → keywords/numbers on the rest):

```ts
// tui/src/highlight.ts — zero-dep syntax highlighter for fenced code (spec Decision Log: no 1MB dep
// for a LOW row). Regex-lexed: comments, strings, keywords, numbers; everything else plain.
import type { Segment } from "./render.js";
const KW: Record<string, RegExp> = {
  ts: /\b(const|let|var|function|return|if|else|for|while|class|interface|type|import|export|from|new|await|async|try|catch|throw|extends|implements|readonly|public|private|switch|case|default|break|continue|typeof|instanceof|in|of|null|undefined|true|false|this)\b/g,
  py: /\b(def|return|if|elif|else|for|while|class|import|from|as|with|try|except|raise|lambda|pass|break|continue|and|or|not|in|is|None|True|False|self|yield|async|await|global)\b/g,
  sh: /\b(if|then|else|elif|fi|for|do|done|while|case|esac|function|echo|exit|return|local|export|set)\b/g,
};
const LANG: Record<string, RegExp> = { ts: KW.ts, js: KW.ts, tsx: KW.ts, jsx: KW.ts, json: /\b(true|false|null)\b/g, py: KW.py, python: KW.py, sh: KW.sh, bash: KW.sh, zsh: KW.sh };
const COMMENT: Record<string, RegExp> = { ts: /\/\/.*$/, js: /\/\/.*$/, tsx: /\/\/.*$/, jsx: /\/\/.*$/, py: /#.*$/, python: /#.*$/, sh: /#.*$/, bash: /#.*$/, zsh: /#.*$/ };
const STRING = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/g;
const NUMBER = /\b\d+(?:\.\d+)?\b/g;
export function highlightCode(line: string, lang: string): Segment[] { /* tokenize: comment split
  first (rest dim); then walk STRING matches (green) over the pre-comment part; within plain runs
  apply LANG[lang] keywords (cyan) and NUMBER (yellow) via a merge of non-overlapping matches;
  return [{text: line, dim:true}] when lang has no LANG entry. */ }
```

(The implementer writes the tokenizer to satisfy the tests; keep it ~60 lines, non-overlapping
match merge — collect `{start,end,style}` spans, sort, fill gaps with plain segments.)

`markdown.ts`: fence regex becomes `/^```(\w+)?/` capturing the language into a `fenceLang`
variable; body lines: `LANG-known → { text: "  " + raw, segments: [{ text: "  " }, ...highlightCode(raw, fenceLang)] }`,
else the current dim line. Tables: buffer consecutive `|`-lines; when line 2 matches
`/^\s*\|?[\s:-]+\|/` treat as a table block; split cells on `|` (trim, drop empty edge cells),
compute per-column max width, emit: header row (bold, cells padded with ` │ ` separators), one dim
`─` rule sized to the header, then data rows plain. Flush the buffer on the first non-table line
(emit as table if ≥2 rows + separator, else re-emit the raw lines through the normal path).

`copy.ts`:

```ts
// tui/src/copy.ts — clipboard via the platform's own tool (DI'd for tests, like bash.ts).
import { spawn as realSpawn } from "node:child_process";
export function copyToClipboard(text: string, deps: { platform?: string; spawn?: typeof realSpawn } = {}): Promise<void> {
  const platform = deps.platform ?? process.platform;
  const spawn = deps.spawn ?? realSpawn;
  const cmd = platform === "darwin" ? ["pbcopy"] : platform === "linux" ? ["xclip", "-selection", "clipboard"] : undefined;
  if (!cmd) return Promise.reject(new Error(`no clipboard tool for ${platform}`));
  return new Promise((resolve, reject) => {
    const p = spawn(cmd[0], cmd.slice(1), { stdio: ["pipe", "ignore", "ignore"] });
    p.on("error", (e) => reject(new Error(`${cmd[0]} unavailable: ${e.message}`)));
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd[0]} exited ${code}`))));
    p.stdin!.end(text);
  });
}
```

`useChat.ts`: deps gains `copyText?: (t: string) => Promise<void>` (default `copyToClipboard`);
`const lastAssistant = useRef("");` — set in the `message` event arm:

```ts
if ((ev.data as any)?.type === "assistant") {
  const t = ((ev.data as any).message?.content ?? []).filter((b: any) => b?.type === "text").map((b: any) => b.text).join("\n");
  if (t.trim()) lastAssistant.current = t;
}
if ((ev.data as any)?.type === "system" && (ev.data as any).subtype === "compact_boundary") notice("─── context compacted ───");
```

`handleCommand`: `case "copy": { const t = lastAssistant.current; if (!t) { notice("nothing to copy"); break; } await copyText(t); notice(\`✓ copied ${t.length} chars\`); break; }`
COMMANDS gains `{ name: "copy", summary: "copy the last response to the clipboard" }`.

- [ ] **Step 4: Run** — `npx vitest run test/unit/highlight.test.ts test/unit/copy.test.ts test/tui/ && npm run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(c5-t9): markdown tables + zero-dep highlighter + compact divider + /copy"
```

---

### Task 10: Docs rescore + final verification

**Files:**
- Modify: `docs/parity/tui-ux.md` (rescore §1–6 rows this stage moved; add the C5 shipped block),
  `docs/parity/coverage.md` (rewind surfacing note), `docs/parity/clone-roadmap.md` (C5 state),
  `harness/CLAUDE.md` (module map: RewindPicker/ShortcutsOverlay/usageFormat/highlight/copy + sessions/rows),
  spec `docs/superpowers/specs/2026-07-28-c5-tui-closure-design.md` (Outcomes filled at close-out — the CONTROLLER does this after live acceptance, not this task)

- [ ] **Step 1: Rescore `tui-ux.md`** — flip each shipped row with its C5 marker and honest status:
  Esc-Esc rewind ❌→✅ (§6) · `? for shortcuts` ❌→✅ (§3) · word movement ❌→✅ · tables ❌→✅ ·
  syntax highlight ❌→✅ (regex-lexed, note "not a full grammar") · compact boundary ❌→✅ ·
  `/copy` ❌→✅ · `/usage` added ✅ · Edit/Write diff 🟡→✅-with-note (hunk-relative numbering, no
  absolute file lines — we never read the file) · Bash output 🟡 stays 🟡 if only error framing
  landed (honest) · tool rows 🟡→✅. Recompute the category percentages and the headline
  (impact-weighted, target ~93–95% — justify the number in the commit message).
- [ ] **Step 2: Update `coverage.md`** (the rewind engine row gains "surfaced interactively in C5")
  and `clone-roadmap.md` (C5 section header gets a `✅ shipped <date>` note pointing at the spec).
- [ ] **Step 3: Update `harness/CLAUDE.md`** module map lines for `tui/` and `sessions/`.
- [ ] **Step 4: Full keyless gate**

```bash
npm run typecheck && npm test && npm run build
```

Expected: all green (live suites skip cleanly keyless).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "docs(c5-t10): tui-ux rescore + coverage/roadmap/module-map close-out"
```

**Controller-run live acceptance (after Task 10; spec § Acceptance, quoted):** the controller (not
an implementer) runs the pty drivers per the Goal B rig (`ptyrun.py`, drivers in `$CLAUDE_JOB_DIR/tmp`):
① foreground rewind e2e (VERSION_ONE→TWO, Esc-Esc, `1` → disk reverted + truncated transcript +
prefilled composer + edited resend runs); ② the same over `ccx attach` on a `--detachable` host;
③ conversation-only and code-only variants; ④ `npx vitest run test/live/usage-surface.e2e.test.ts`
twice — once WITHOUT sourcing `.env` (token-free half) and once keyed (`set -a; . ../.env; set +a`);
⑤ the keyless gate above; ⑥ spec Outcomes + memory + ledger updates.

---

## Self-review notes (per writing-plans)

- **Spec coverage:** rewind chain T1–T5; usage T6; MED rows T7 (`?` overlay) + T8 (diff/bash/tool
  rows); LOW tail T7 (word movement) + T9; docs/acceptance T10. The spec's host-guard,
  ordering, phantom-anchor, bg-death, and copy-verbatim constraints are named in Global Constraints
  and tested in T2/T5.
- **Type consistency:** `RewindAnchor {uuid, prevUuid, text, index}` / `RewindDryRun` /
  `RewindScope` defined once in T1 and referenced by name everywhere; host method signatures in T2
  match T3's `HostHandlers` and the adapter's `RewindOps`.
- **Spec drift found while planning:** none requiring a spec edit; one honest scoring note — the
  Edit-diff "line numbers" are hunk-relative (old/new_string are the only data; the file is never
  read), recorded in T8 and the T10 rescore instruction.
