# Hooks Support (Passthrough + Builders) — Design

**Date:** 2026-06-18
**Status:** Approved (brainstorm complete; ready for implementation plan)
**Parity:** domain 8 (extensibility — hooks) — was **0 of 30 hook events handled**; see `docs/parity/coverage.md`
**Working dir:** `CC-to-SDK/harness/`

## §1 Goal & context

Expose a first-class, typed `config.hooks` that resolves into the SDK's `options.hooks` seam, plus a
small `src/hooks/` module of ergonomic **builders** for the live-verified hook patterns. The harness
currently handles **0 of 30** `HOOK_EVENTS` (the largest extensibility gap). The SDK already accepts a
programmatic in-process hook registry — `options.hooks?: Partial<Record<HookEvent, HookCallbackMatcher[]>>`
— but the harness never wires it as a first-class config field, and users would otherwise hand-write the
SDK's verbose callback/output shapes.

This is **config + helpers**, not a per-surface integration: every entry path already funnels options
through one of two seams (see §5), so a `config.hooks` value flows everywhere. The daemon-observability
layer (a hook-event stream over the control bridge) is explicitly **out** (§8) — the deliberate next frontier.

## §2 Verification evidence

Live-probed 2026-06-18 (`probes/probes/09-hooks-coverage.ts` + `10-hooks-sessionstart.ts`,
`@anthropic-ai/claude-agent-sdk@0.3.178`, API-key session). Memory: `sdk-hooks-headless-reachability`.
Declared ≠ headlessly-reachable (the cron/push lesson), so the design targets the **verified** subset:

- **8 of 30 events FIRED** in a plain headless run (tool call + Task subagent): `PreToolUse`, `PostToolUse`,
  `PostToolBatch`, `UserPromptSubmit`, `Stop`, `SubagentStart`, `SubagentStop`, `MessageDisplay`. Runtime
  input shapes match `sdk.d.ts` exactly (PreToolUse carries `tool_name`/`tool_input`/`tool_use_id`;
  PostToolUse adds `tool_response`/`duration_ms`; Stop carries `last_assistant_message`).
- **The three control paths the builders wrap all WORK:** (1) **context injection** — `UserPromptSubmit`
  returning `{hookSpecificOutput:{hookEventName:"UserPromptSubmit", additionalContext}}` was recalled by the
  model; (2) **tool blocking** — `PreToolUse` returning `{decision:"block", hookSpecificOutput:{hookEventName:
  "PreToolUse", permissionDecision:"deny", permissionDecisionReason}}` short-circuited the call and the reason
  surfaced; (3) **subagent attribution** — nested `PreToolUse` fired with `agent_id` populated.
- **`SessionStart`/`SessionEnd` are DORMANT** via the programmatic path — confirmed in **both** streaming-input
  and plain string-prompt modes. So there is **no boot-time-injection-via-callback** capability to promise; the
  design provides no builder for these and documents the limit. (Hypothesis: lifecycle hooks dispatch through
  the CLI settings.json hook loader, which is mere passthrough for a library.)
- The remaining ~14 dormant events are **trigger-gated** (a failing tool → `PostToolUseFailure`, a compaction →
  `PreCompact`, a permission prompt → `PermissionRequest`, etc.) — same callback mechanism, reachable when their
  condition occurs. Raw passthrough supports them; the harness designs first-class ergonomics only for the 8.

## §3 Scope

**In:**
- New module `src/hooks/`: `types.ts` (SDK type re-exports + harness aliases), `merge.ts` (`mergeHooks`),
  `builders.ts` (`injectContext`, `guardTool`, `blockTool`, `observe`), `index.ts` (barrel).
- `HarnessConfig.hooks?: HooksMap` (`src/config/types.ts`) + passthrough wiring in `src/config/resolveOptions.ts`.
- Public re-exports from `src/index.ts` (builders, `mergeHooks`, and the SDK hook **types**).
- Unit tests for builders / merge / resolveOptions / public exports, **plus** a daemon test proving a
  hooks-bearing `sessionOptions` factory reaches the underlying `query`.
- One gated live e2e test (inject-context recall + block-tool deny through `openSession`/`createHarness`).

**Out (§8):** daemon-observability hook-event stream over the control bridge; per-session hook registration
API on the daemon; builders for dormant/lifecycle events (`SessionStart`/`SessionEnd`); HTTP/command (config-file)
hooks beyond what `settingSources` passthrough already loads; matcher-pattern parsing (SDK owns matching).

## §4 Design

### 4.1 Types — `src/hooks/types.ts` (NEW)

Re-export the SDK hook types so raw-passthrough users are fully typed without importing the SDK directly,
and define the harness aliases:

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

### 4.2 Merge — `src/hooks/merge.ts` (NEW)

`mergeHooks(...fragments)` folds builder fragments into one `HooksMap`, **concatenating** the matcher
arrays per event (so multiple builders for the same event coexist; FIFO registration order preserved):

```ts
import type { HooksMap, HookEvent, HookCallbackMatcher } from "./types.js";

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

### 4.3 Builders — `src/hooks/builders.ts` (NEW)

Pure functions; each returns a `HooksMap` fragment. The produced `HookCallback` is what unit tests invoke
with a fake input to assert the exact `HookJSONOutput`.

```ts
import type {
  HooksMap, HookEvent, HookInput, HookCallback,
  PreToolUseHookInput, UserPromptSubmitHookInput, HookDecision,
} from "./types.js";

/** Inject extra context on each user turn. fn returns the text, or null/undefined for "no injection".
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
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: reason,
        },
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
    const hit =
      typeof test === "function"
        ? test(input)
        : test.test(JSON.stringify((input as PreToolUseHookInput).tool_input ?? {}));
    return hit ? { block: true, reason } : undefined;
  });
}

/** Fire-and-forget observer for any event. Errors are swallowed (an observer must never break a turn);
 *  always returns {} so it never alters flow. Works for any HookEvent (PostToolUse, Stop, Subagent*, …). */
export function observe(event: HookEvent, fn: (input: HookInput) => void | Promise<void>): HooksMap {
  const cb: HookCallback = async (input) => {
    try {
      await fn(input);
    } catch {
      /* observers must not affect the turn */
    }
    return {};
  };
  // Explicit assignment (not a `{ [event]: … }` literal, which widens to a string
  // index signature and won't assign cleanly to HooksMap under tsc).
  const out: HooksMap = {};
  out[event] = [{ hooks: [cb] }];
  return out;
}
```

### 4.4 Barrel — `src/hooks/index.ts` (NEW)

```ts
export { injectContext, guardTool, blockTool, observe } from "./builders.js";
export { mergeHooks } from "./merge.js";
export type {
  HooksMap, HookDecision, HookEvent, HookInput, HookCallback, HookJSONOutput, HookCallbackMatcher,
  PreToolUseHookInput, PostToolUseHookInput, UserPromptSubmitHookInput, StopHookInput, SubagentStopHookInput,
} from "./types.js";
```

### 4.5 Config wiring — `src/config/types.ts` + `resolveOptions.ts`

`types.ts`: add the field (typed, not `unknown`):

```ts
import type { HooksMap } from "../hooks/types.js";
// in HarnessConfig, near the mcp/plugins block:
hooks?: HooksMap;                          // programmatic SDK hooks (see src/hooks builders)
```

`resolveOptions.ts`: pure passthrough, alongside the other conditional `options.*` assignments:

```ts
if (config.hooks) options.hooks = config.hooks;
```

### 4.6 Public API — `src/index.ts`

Add a hooks export line (mirroring the existing `sessions` re-export style):

```ts
export { injectContext, guardTool, blockTool, observe, mergeHooks } from "./hooks/index.js";
export type {
  HooksMap, HookDecision, HookEvent, HookInput, HookCallback, HookJSONOutput, HookCallbackMatcher,
  PreToolUseHookInput, PostToolUseHookInput, UserPromptSubmitHookInput, StopHookInput, SubagentStopHookInput,
} from "./hooks/index.js";
```

### 4.7 Daemon — no code change

The daemon builds per-session options via the caller-supplied `sessionOptions` factory
(`supervisor.ts:236`, the same seam `cc-tasks` uses), not `resolveOptions`. Hooks reach daemon sessions by
returning `{ hooks: mergeHooks(...) }` from that factory, with the existing fresh-instance-per-session
semantics. **No supervisor/session change** — only a unit test (§7) pinning that a hooks-bearing factory's
`hooks` reaches the underlying `query` options.

## §5 Data flow

Two seams, one value type (`HooksMap`):

```
builders → mergeHooks → HooksMap value
   ├── lib / one-shot:  config.hooks → resolveOptions → options.hooks → query({options})
   │     (createHarness  src/harness.ts:31;  openSession/resumeSession  src/session/index.ts:13)
   └── daemon:           sessionOptions() → { hooks } → makeSession merge → DaemonSession → query({options})
         (supervisor.ts:236; per-session, fresh instances like cc-tasks)
```

At runtime the SDK invokes each registered `HookCallback(input, toolUseID, {signal})` and applies the
returned `HookJSONOutput` (inject `additionalContext`, `decision:"block"`, or neutral `{}`).

## §6 Error handling

- **`observe` swallows callback errors** and always returns `{}` — a buggy observer can never break a turn
  or alter flow.
- **`guardTool`/`blockTool` do NOT wrap the user's `decide`/`test`** — a throw surfaces naturally to the SDK
  (the predicate is the user's logic; fail-surface, not silent fail-open or fail-closed). `blockTool`'s RegExp
  branch serializes `tool_input` with `JSON.stringify` and tests that string.
- **`mergeHooks` skips empty/absent matcher arrays** (no empty `[]` events in the output).
- **`SessionStart`/`SessionEnd`**: no builder; dormancy documented in jsdoc + this spec. `resolveOptions` does
  pure passthrough, so raw users *may* register any of the 30 events — their explicit choice, not an ergonomic path.

## §7 Testing

**Unit** (pure, no live key — invoke the produced callback with a fake input and assert the `HookJSONOutput`):
- `injectContext`: fn→string yields `{hookSpecificOutput:{hookEventName:"UserPromptSubmit", additionalContext}}`;
  fn→null/`""` yields `{}`; fragment registers under `UserPromptSubmit`.
- `guardTool`: `{block:true,reason}` maps to `decision:"block"` + `permissionDecision:"deny"` +
  `permissionDecisionReason`; `{allow:true}`/`void` yields `{}`; fragment carries the `matcher` under `PreToolUse`.
- `blockTool`: RegExp matches serialized `tool_input` → block (with reason); miss → `{}`; predicate form honored.
- `observe`: fn invoked with the input; a throwing fn still yields `{}`; registers under the requested event.
- `mergeHooks`: concatenates matchers for the same event across fragments; merges distinct events; ignores
  empty/absent; preserves order.
- `resolveOptions`: `config.hooks` present → `options.hooks === config.hooks`; absent → no `hooks` key.
- `index`: public API exposes `injectContext`/`guardTool`/`blockTool`/`observe`/`mergeHooks`.
- **daemon**: a `Supervisor` built with `sessionOptions: () => ({ hooks })` spawns a session whose underlying
  `query` (fake `QueryFn`) received `options.hooks` equal to that map.

**Live** (gated on `ANTHROPIC_API_KEY`, `try/finally` dispose; mirrors probe 09's core):
- Open a session via `openSession`/`createHarness` with
  `hooks: mergeHooks(injectContext(() => "codeword is <X>"), blockTool("Bash", /<forbidden>/, "denied"))`.
  Assert (a) the model recalls `<X>` (injection landed) and (b) a matching Bash call is denied (block landed).

## §8 Non-goals (separate / later)

- **Daemon-observability**: surfacing hook events as a subscribable stream over the control bridge, and a
  per-session daemon hook-registration API. The deliberate next frontier (option C), deferred to keep this a
  single clean library deliverable ("harden & ship the lib first").
- **Builders for dormant/lifecycle events** (`SessionStart`/`SessionEnd` — verified non-firing; the rest
  trigger-gated). Raw passthrough already covers them for users who create the trigger.
- **Config-file (command/HTTP) hooks** beyond the `settingSources` passthrough the harness already performs.
- **Matcher-pattern semantics** — the SDK owns matcher parsing/matching; the harness passes `matcher` strings
  through verbatim.
