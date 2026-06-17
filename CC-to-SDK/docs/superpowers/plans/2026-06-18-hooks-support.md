# Hooks Support (Passthrough + Builders) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose a typed `config.hooks` that resolves into the SDK's verified `options.hooks` seam, plus a small `src/hooks/` module of ergonomic builders (`injectContext`/`guardTool`/`blockTool`/`observe`) and a `mergeHooks` combinator.

**Architecture:** Builders are pure functions returning `HooksMap` fragments (`Partial<Record<HookEvent, HookCallbackMatcher[]>>` — the exact SDK shape); `mergeHooks` folds fragments by concatenating matcher arrays per event. The merged value drops into `config.hooks` (lib/one-shot, via `resolveOptions`) or a daemon `sessionOptions` factory's `{ hooks }` (no daemon code change). One value type, two entry points.

**Tech Stack:** TypeScript (ESM), `@anthropic-ai/claude-agent-sdk@0.3.178`, vitest. Working dir: `CC-to-SDK/harness/`.

**Spec:** `docs/superpowers/specs/2026-06-18-hooks-support-design.md`. **Parity:** domain 8 (hooks) — was 0 of 30 events handled.

## Global Constraints

- **No Prettier / no reformatting.** Match the surrounding dense hand-style (compact, multi-statement lines where the codebase already does so).
- **ESM import specifiers end in `.js`** (e.g. `from "./types.js"`) even though sources are `.ts`.
- **Builders are pure functions**; each returns a `HooksMap` fragment. Unit tests invoke the *produced* `HookCallback` with a fake input and assert the exact `HookJSONOutput` — no live key needed.
- **`observe` swallows callback errors** (try/catch) and always returns `{}`. **`guardTool`/`blockTool` do NOT wrap the user's predicate** — a throw surfaces naturally.
- **No builder for `SessionStart`/`SessionEnd`** (verified dormant via the programmatic path). `resolveOptions` does pure passthrough.
- **`resolveOptions` passthrough is conditional:** `if (config.hooks) options.hooks = config.hooks;` — absent config ⇒ no `hooks` key on Options.
- **Public API re-exports the SDK hook types** so raw-passthrough users are typed without importing the SDK directly.
- Tests run via **vitest**: `npx vitest run test/unit/<file>` (add `-t "name"` to filter). Typecheck: `npm run typecheck` (tsc --noEmit). Build: `npm run build` (tsc -p tsconfig.build.json).
- **Live tests gate on `ANTHROPIC_API_KEY`** (`const live = process.env.ANTHROPIC_API_KEY ? describe : describe.skip;`); there is no dotenv autoload, so they skip cleanly without a key. Live model id: `claude-haiku-4-5-20251001`.
- **Commit messages: no `Co-Authored-By` or attribution lines.**

---

### Task 1: Hook types + `mergeHooks`

**Files:**
- Create: `src/hooks/types.ts`
- Create: `src/hooks/merge.ts`
- Test: `test/unit/hooks-merge.test.ts`

**Interfaces:**
- Consumes: SDK types from `@anthropic-ai/claude-agent-sdk` (`HookEvent`, `HookInput`, `HookCallback`, `HookJSONOutput`, `HookCallbackMatcher`, and per-event input types).
- Produces: `HooksMap = Partial<Record<HookEvent, HookCallbackMatcher[]>>`, `HookDecision = { allow: true } | { block: true; reason?: string } | void`, and `mergeHooks(...fragments: HooksMap[]): HooksMap` (concatenates matcher arrays per event; skips empty/absent; preserves order). Later tasks import these.

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/hooks-merge.test.ts
import { describe, it, expect } from "vitest";
import { mergeHooks } from "../../src/hooks/merge.js";

const m1 = async () => ({});
const m2 = async () => ({});

describe("mergeHooks", () => {
  it("concatenates matcher arrays for the same event, preserving order", () => {
    const a = { PreToolUse: [{ matcher: "Bash", hooks: [m1] }] };
    const b = { PreToolUse: [{ matcher: "Write", hooks: [m2] }] };
    const out = mergeHooks(a, b);
    expect(out.PreToolUse).toHaveLength(2);
    expect(out.PreToolUse![0].matcher).toBe("Bash");
    expect(out.PreToolUse![1].matcher).toBe("Write");
  });
  it("merges distinct events into one map", () => {
    const out = mergeHooks(
      { UserPromptSubmit: [{ hooks: [m1] }] },
      { PostToolUse: [{ hooks: [m2] }] },
    );
    expect(Object.keys(out).sort()).toEqual(["PostToolUse", "UserPromptSubmit"]);
  });
  it("ignores empty/absent matcher arrays and returns {} for no fragments", () => {
    expect(mergeHooks()).toEqual({});
    expect(mergeHooks({ Stop: [] }, {})).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/hooks-merge.test.ts`
Expected: FAIL — cannot resolve `../../src/hooks/merge.js`.

- [ ] **Step 3: Write `src/hooks/types.ts`**

```ts
import type {
  HookEvent, HookInput, HookCallback, HookJSONOutput, HookCallbackMatcher,
  PreToolUseHookInput, PostToolUseHookInput, UserPromptSubmitHookInput,
  StopHookInput, SubagentStopHookInput,
} from "@anthropic-ai/claude-agent-sdk";

export type {
  HookEvent, HookInput, HookCallback, HookJSONOutput, HookCallbackMatcher,
  PreToolUseHookInput, PostToolUseHookInput, UserPromptSubmitHookInput,
  StopHookInput, SubagentStopHookInput,
};

/** The exact SDK `options.hooks` shape — what builders produce and `config.hooks` accepts. */
export type HooksMap = Partial<Record<HookEvent, HookCallbackMatcher[]>>;

/** Return value of a `guardTool` decision function. `void` = no opinion (allow). */
export type HookDecision = { allow: true } | { block: true; reason?: string } | void;
```

- [ ] **Step 4: Write `src/hooks/merge.ts`**

```ts
import type { HooksMap, HookEvent, HookCallbackMatcher } from "./types.js";

/** Fold builder fragments into one HooksMap, concatenating matcher arrays per event. */
export function mergeHooks(...fragments: HooksMap[]): HooksMap {
  const out: HooksMap = {};
  for (const frag of fragments) {
    for (const key of Object.keys(frag) as HookEvent[]) {
      const matchers = frag[key];
      if (!matchers?.length) continue;
      (out[key] ??= [] as HookCallbackMatcher[]).push(...matchers);
    }
  }
  return out;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/unit/hooks-merge.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/types.ts src/hooks/merge.ts test/unit/hooks-merge.test.ts
git commit -m "feat(harness): hooks types + mergeHooks combinator (domain 8)"
```

---

### Task 2: Builders + barrel

**Files:**
- Create: `src/hooks/builders.ts`
- Create: `src/hooks/index.ts`
- Test: `test/unit/hooks-builders.test.ts`

**Interfaces:**
- Consumes: `HooksMap`, `HookDecision`, `HookEvent`, `HookInput`, `HookCallback`, `PreToolUseHookInput`, `UserPromptSubmitHookInput` from `./types.js`; `mergeHooks` from `./merge.js`.
- Produces:
  - `injectContext(fn: (input: UserPromptSubmitHookInput) => string | null | undefined): HooksMap` — registers under `UserPromptSubmit`.
  - `guardTool(matcher: string, decide: (input: PreToolUseHookInput) => HookDecision): HooksMap` — registers under `PreToolUse` with `matcher`.
  - `blockTool(matcher: string, test: RegExp | ((input: PreToolUseHookInput) => boolean), reason?: string): HooksMap` — sugar over `guardTool`.
  - `observe(event: HookEvent, fn: (input: HookInput) => void | Promise<void>): HooksMap` — registers under `event`.
  - Barrel `src/hooks/index.ts` re-exporting all builders, `mergeHooks`, and the public types.

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/hooks-builders.test.ts
import { describe, it, expect } from "vitest";
import { injectContext, guardTool, blockTool, observe } from "../../src/hooks/builders.js";

// Invoke the single produced callback with a fake input and return its output.
async function fire(map: any, event: string, input: any) {
  const cb = map[event][0].hooks[0];
  return cb(input, undefined, { signal: new AbortController().signal });
}

describe("injectContext", () => {
  it("returns UserPromptSubmit additionalContext when fn yields text", async () => {
    const map = injectContext(() => "remember: ORCHID");
    expect(map.UserPromptSubmit).toBeTruthy();
    const out: any = await fire(map, "UserPromptSubmit", { hook_event_name: "UserPromptSubmit", prompt: "hi" });
    expect(out.hookSpecificOutput).toEqual({ hookEventName: "UserPromptSubmit", additionalContext: "remember: ORCHID" });
  });
  it("returns {} when fn yields null or empty string", async () => {
    expect(await fire(injectContext(() => null), "UserPromptSubmit", {})).toEqual({});
    expect(await fire(injectContext(() => ""), "UserPromptSubmit", {})).toEqual({});
  });
});

describe("guardTool", () => {
  it("maps {block:true,reason} to a PreToolUse deny", async () => {
    const map = guardTool("Bash", () => ({ block: true, reason: "nope" }));
    expect(map.PreToolUse![0].matcher).toBe("Bash");
    const out: any = await fire(map, "PreToolUse", { hook_event_name: "PreToolUse", tool_name: "Bash" });
    expect(out.decision).toBe("block");
    expect(out.reason).toBe("nope");
    expect(out.hookSpecificOutput).toEqual({ hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "nope" });
  });
  it("returns {} for allow and for void", async () => {
    expect(await fire(guardTool("Bash", () => ({ allow: true })), "PreToolUse", {})).toEqual({});
    expect(await fire(guardTool("Bash", () => undefined), "PreToolUse", {})).toEqual({});
  });
});

describe("blockTool", () => {
  it("blocks when the RegExp matches the serialized tool_input", async () => {
    const map = blockTool("Bash", /rm -rf/, "danger");
    const out: any = await fire(map, "PreToolUse", { tool_name: "Bash", tool_input: { command: "rm -rf /" } });
    expect(out.decision).toBe("block");
    expect(out.hookSpecificOutput.permissionDecisionReason).toBe("danger");
  });
  it("allows ({}) when the RegExp misses", async () => {
    const out: any = await fire(blockTool("Bash", /rm -rf/), "PreToolUse", { tool_name: "Bash", tool_input: { command: "ls" } });
    expect(out).toEqual({});
  });
  it("honors a predicate test", async () => {
    const map = blockTool("Write", (i: any) => i.tool_input?.path === "/etc/passwd", "blocked");
    const hit: any = await fire(map, "PreToolUse", { tool_input: { path: "/etc/passwd" } });
    expect(hit.decision).toBe("block");
    const miss: any = await fire(map, "PreToolUse", { tool_input: { path: "/tmp/x" } });
    expect(miss).toEqual({});
  });
});

describe("observe", () => {
  it("invokes fn with the input and returns {}", async () => {
    const seen: any[] = [];
    const map = observe("PostToolUse", (i) => { seen.push(i); });
    expect(map.PostToolUse).toBeTruthy();
    const out = await fire(map, "PostToolUse", { hook_event_name: "PostToolUse", tool_name: "Bash" });
    expect(out).toEqual({});
    expect(seen[0].tool_name).toBe("Bash");
  });
  it("swallows a throwing observer and still returns {}", async () => {
    const map = observe("Stop", () => { throw new Error("boom"); });
    expect(await fire(map, "Stop", {})).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/hooks-builders.test.ts`
Expected: FAIL — cannot resolve `../../src/hooks/builders.js`.

- [ ] **Step 3: Write `src/hooks/builders.ts`**

```ts
import type {
  HooksMap, HookEvent, HookInput, HookCallback,
  PreToolUseHookInput, UserPromptSubmitHookInput, HookDecision,
} from "./types.js";

/** Inject extra context on each user turn. fn returns the text, or null/undefined/"" for "no injection".
 *  Verified path: UserPromptSubmit.additionalContext (recalled by the model). */
export function injectContext(
  fn: (input: UserPromptSubmitHookInput) => string | null | undefined,
): HooksMap {
  const cb: HookCallback = async (input) => {
    const text = fn(input as UserPromptSubmitHookInput);
    if (text == null || text === "") return {};
    return { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: text } };
  };
  return { UserPromptSubmit: [{ hooks: [cb] }] };
}

/** Gate a tool by name. `decide` returns a HookDecision; block → PreToolUse deny.
 *  `matcher` is the SDK tool-name matcher (e.g. "Bash", "Write|Edit"). */
export function guardTool(
  matcher: string,
  decide: (input: PreToolUseHookInput) => HookDecision,
): HooksMap {
  const cb: HookCallback = async (input) => {
    const d = decide(input as PreToolUseHookInput);
    if (d && "block" in d && d.block) {
      const reason = d.reason ?? "blocked by hook";
      return {
        decision: "block",
        reason,
        hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason },
      };
    }
    return {};
  };
  return { PreToolUse: [{ matcher, hooks: [cb] }] };
}

/** Sugar over guardTool: block when `test` matches. RegExp tests the JSON-serialized tool_input;
 *  a predicate gets the full PreToolUseHookInput. */
export function blockTool(
  matcher: string,
  test: RegExp | ((input: PreToolUseHookInput) => boolean),
  reason = "blocked by hook",
): HooksMap {
  return guardTool(matcher, (input) => {
    const hit = typeof test === "function"
      ? test(input)
      : test.test(JSON.stringify((input as PreToolUseHookInput).tool_input ?? {}));
    return hit ? { block: true, reason } : undefined;
  });
}

/** Fire-and-forget observer for any event. Errors are swallowed (an observer must never break a turn);
 *  always returns {} so it never alters flow. Works for any HookEvent (PostToolUse, Stop, Subagent*, …). */
export function observe(event: HookEvent, fn: (input: HookInput) => void | Promise<void>): HooksMap {
  const cb: HookCallback = async (input) => {
    try { await fn(input); } catch { /* observers must not affect the turn */ }
    return {};
  };
  // Explicit assignment (not a `{ [event]: … }` literal, which widens to a string
  // index signature and won't assign cleanly to HooksMap under tsc).
  const out: HooksMap = {};
  out[event] = [{ hooks: [cb] }];
  return out;
}
```

- [ ] **Step 4: Write `src/hooks/index.ts`**

```ts
export { injectContext, guardTool, blockTool, observe } from "./builders.js";
export { mergeHooks } from "./merge.js";
export type {
  HooksMap, HookDecision, HookEvent, HookInput, HookCallback, HookJSONOutput, HookCallbackMatcher,
  PreToolUseHookInput, PostToolUseHookInput, UserPromptSubmitHookInput, StopHookInput, SubagentStopHookInput,
} from "./types.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/unit/hooks-builders.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/builders.ts src/hooks/index.ts test/unit/hooks-builders.test.ts
git commit -m "feat(harness): hook builders injectContext/guardTool/blockTool/observe + barrel"
```

---

### Task 3: `config.hooks` field + `resolveOptions` passthrough

**Files:**
- Modify: `src/config/types.ts` (add `hooks?` to `HarnessConfig`, near the mcp/plugins block ~line 51)
- Modify: `src/config/resolveOptions.ts` (add conditional passthrough before the final return ~line 47)
- Test: `test/unit/resolveOptions.test.ts` (add a test; existing file)

**Interfaces:**
- Consumes: `HooksMap` from `../hooks/types.js`.
- Produces: `HarnessConfig.hooks?: HooksMap`; `resolveOptions` sets `options.hooks = config.hooks` iff present.

- [ ] **Step 1: Write the failing test (append to `test/unit/resolveOptions.test.ts`, inside the `describe("resolveOptions", …)` block)**

```ts
  it("passes config.hooks through to options.hooks, omits when absent", () => {
    const hooks = { PostToolUse: [{ hooks: [async () => ({})] }] };
    const o: any = resolveOptions({ hooks });
    expect(o.hooks).toBe(hooks);
    expect(resolveOptions({})).not.toHaveProperty("hooks");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/resolveOptions.test.ts -t "passes config.hooks"`
Expected: FAIL — `o.hooks` is `undefined` (field not yet wired).

- [ ] **Step 3: Add the field to `HarnessConfig` in `src/config/types.ts`**

Add the import at the top (alongside the existing `import type { … } from "@anthropic-ai/claude-agent-sdk";`):

```ts
import type { HooksMap } from "../hooks/types.js";
```

Add the field in the `// checkpointing / mcp / plugins` area (next to `mcpServers?` / `plugins?`):

```ts
  // hooks (domain 8): programmatic SDK hooks (Partial<Record<HookEvent, HookCallbackMatcher[]>>).
  // Build with the src/hooks builders + mergeHooks. NOTE: SessionStart/SessionEnd do NOT fire via
  // this programmatic path (verified) — no builder exists for them; raw passthrough is the user's choice.
  hooks?: HooksMap;
```

- [ ] **Step 4: Add the passthrough in `src/config/resolveOptions.ts`**

Add this line next to the other conditional passthroughs (e.g. right after the `if (config.sessionStore) …` line, before `return { …, extraOptions }`):

```ts
  if (config.hooks) options.hooks = config.hooks;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/unit/resolveOptions.test.ts`
Expected: PASS (all tests, including the new one).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/config/types.ts src/config/resolveOptions.ts test/unit/resolveOptions.test.ts
git commit -m "feat(harness): config.hooks → options.hooks passthrough in resolveOptions"
```

---

### Task 4: Public exports + daemon `sessionOptions` proof

**Files:**
- Modify: `src/index.ts` (add a hooks export line after the sessions line ~17)
- Test: `test/unit/index.test.ts` (add an `it` block; existing file)
- Test: `test/unit/daemon-supervisor.test.ts` (add one `it` using the existing `captureQuery` helper)

**Interfaces:**
- Consumes: `src/hooks/index.js` (builders + `mergeHooks` + types); `DaemonSupervisor` and the `captureQuery(sink)` helper already present in `daemon-supervisor.test.ts`.
- Produces: public API surface `api.injectContext` / `api.guardTool` / `api.blockTool` / `api.observe` / `api.mergeHooks`; a daemon test proving a hooks-bearing `sessionOptions` factory reaches the underlying `query`'s options. **No production daemon code change** (the spec confirms hooks flow via the existing factory seam).

- [ ] **Step 1: Write the failing tests**

Append to `test/unit/index.test.ts` (new `it` inside `describe("public API", …)`):

```ts
  it("exports the hook builders and mergeHooks", () => {
    expect(typeof api.injectContext).toBe("function");
    expect(typeof api.guardTool).toBe("function");
    expect(typeof api.blockTool).toBe("function");
    expect(typeof api.observe).toBe("function");
    expect(typeof api.mergeHooks).toBe("function");
  });
```

Append to `test/unit/daemon-supervisor.test.ts` (new `it` inside `describe("DaemonSupervisor", …)`; `captureQuery` and `dir` already exist in that file):

```ts
  it("threads a hooks-bearing sessionOptions factory through to the underlying query options", async () => {
    const seen: any[] = [];
    const hooks = { PostToolUse: [{ hooks: [async () => ({})] }] };
    const sup = new DaemonSupervisor({ query: captureQuery(seen) }, { dir: dir(), sessionOptions: () => ({ hooks }) });
    sup.spawn();
    expect(seen[0].hooks).toBe(hooks);   // factory's hooks reached the query options
    await sup.shutdown();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/index.test.ts test/unit/daemon-supervisor.test.ts`
Expected: `index.test.ts` FAILS (`api.injectContext` is undefined). The daemon test PASSES already (the factory seam pre-exists) — that is the intended assertion; if it fails, investigate before proceeding.

- [ ] **Step 3: Add the public exports to `src/index.ts`**

Add after the sessions export line (line ~17):

```ts
export { injectContext, guardTool, blockTool, observe, mergeHooks } from "./hooks/index.js";
export type {
  HooksMap, HookDecision, HookEvent, HookInput, HookCallback, HookJSONOutput, HookCallbackMatcher,
  PreToolUseHookInput, PostToolUseHookInput, UserPromptSubmitHookInput, StopHookInput, SubagentStopHookInput,
} from "./hooks/index.js";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/unit/index.test.ts test/unit/daemon-supervisor.test.ts`
Expected: PASS (both files).

- [ ] **Step 5: Typecheck + build (the build proves the public `.d.ts` re-exports resolve)**

Run: `npm run typecheck && npm run build`
Expected: no errors; `dist/` emitted.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts test/unit/index.test.ts test/unit/daemon-supervisor.test.ts
git commit -m "feat(harness): export hook builders + pin daemon sessionOptions hooks path"
```

---

### Task 5: Live end-to-end (gated)

**Files:**
- Create: `test/live/hooks.test.ts`

**Interfaces:**
- Consumes: `openSession` and the hook builders (`injectContext`, `blockTool`, `mergeHooks`) from `../../src/index.js`.
- Produces: a gated real-SDK test proving (a) `injectContext` lands (model recalls the injected codeword) and (b) `blockTool` denies a matching Bash call.

- [ ] **Step 1: Write the live test**

```ts
// test/live/hooks.test.ts
import { describe, it, expect } from "vitest";
import { openSession, injectContext, blockTool, mergeHooks } from "../../src/index.js";

const live = process.env.ANTHROPIC_API_KEY ? describe : describe.skip;
const MODEL = "claude-haiku-4-5-20251001";

live("live hooks (real SDK)", () => {
  it("injectContext is recalled by the model", async () => {
    const hooks = mergeHooks(injectContext(() => "The secret codeword is FALCON-8842."));
    const s = openSession({ model: MODEL, permissionMode: "bypassPermissions", hooks });
    try {
      const r = await s.submit("What is the secret codeword you were told? Reply with just the word.");
      expect(String(r.result)).toMatch(/FALCON-8842/);
    } finally { await s.dispose(); }
  }, 60_000);

  it("blockTool's deny hook fires on a matching Bash command", async () => {
    const fired: string[] = [];
    // Predicate form so the test captures, deterministically, that PreToolUse fired
    // for the Bash attempt and our deny matched it — no dependency on hook_* frames
    // (which would require includeHookEvents). Blocking takes effect regardless.
    const hooks = mergeHooks(
      blockTool("Bash", (i: any) => {
        const cmd = String(i?.tool_input?.command ?? "");
        const hit = cmd.includes("FORBIDDEN_CMD");
        if (hit) fired.push(cmd);
        return hit;
      }, "blocked by probe hook"),
    );
    const s = openSession({ model: MODEL, permissionMode: "bypassPermissions", hooks });
    try {
      const r = await s.submit("Run exactly this bash command: echo FORBIDDEN_CMD");
      expect(fired.length).toBeGreaterThan(0);            // PreToolUse fired; our deny matched the attempt
      expect(String(r.result).length).toBeGreaterThan(0); // the turn still completed
    } finally { await s.dispose(); }
  }, 90_000);
});
```

> **Note on the second assertion:** the deterministic signal is that `blockTool`'s predicate *ran* on the Bash attempt (proving `PreToolUse` fired and the deny path executed) — captured via the `fired` closure. The model's wording after a block is non-deterministic, so do not assert on it. `submit(prompt, onMessage)` streams messages to the optional second arg (see `src/session/session.ts`); it is unused here.

- [ ] **Step 2: Run keyless to confirm clean skip**

Run: `npx vitest run test/live/hooks.test.ts`
Expected: SKIPPED (no `ANTHROPIC_API_KEY` in the implementer's env) — 0 failures. This is the implementer's stopping point; the controller runs it keyed.

- [ ] **Step 3: (Controller-only) Run keyed**

Run: `set -a; . ../.env; set +a; npx vitest run test/live/hooks.test.ts`
Expected: PASS (2 tests) — codeword recalled; a `hook_*` event fired during the blocked turn.

- [ ] **Step 4: Commit**

```bash
git add test/live/hooks.test.ts
git commit -m "test(harness): live e2e for hook context-injection + tool-block"
```

---

## Final verification (after all tasks)

- [ ] `npm run typecheck` — clean.
- [ ] `npx vitest run test/unit` — all unit suites green (existing + new `hooks-merge`, `hooks-builders`, plus the added cases in `resolveOptions`, `index`, `daemon-supervisor`).
- [ ] `npm run build` — `dist/` emits with the hooks `.d.ts`.
- [ ] (Controller) keyed `test/live/hooks.test.ts` — 2/2 PASS.
- [ ] Update `docs/parity/coverage.md` domain 8 (hooks): 0/30 → first-class programmatic hooks shipped (8 verified-fired events ergonomic, passthrough for all 30; SessionStart/End documented dormant). Refresh the headline if it moves.
