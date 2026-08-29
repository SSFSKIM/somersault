# Model-Switch Governance — a cost-aware switch policy on the engine

**Status:** v1 — engine Wave D (the 0.3.251 catch-up round: Wave A bump `797fecf114`, Wave B probes
`eb9fcfeb1b`, Wave C knobs `715b9863b0`). SDK = installed `@anthropic-ai/claude-agent-sdk` **0.3.251**.
Evidence = **probe 121** (`probes/probes/121-model-switch-hooks.ts`, 2026-08-30), all three answer
paths measured live; ledger row in `docs/parity/full-potential.md` §1.

## Purpose

Claude Code 2.1.251 added `PreModelSwitch`/`PostModelSwitch` hook events. Probe 121 proved the full
contract ALIVE on the SDK transport: both hooks fire on a headless `setModel`, the Pre payload carries
the cost picture (`context_tokens`, `prompt_cache_warm`, `cache_ttl`, `estimated_cache_write_usd`,
`pricing`), a `permissionDecision:"deny"` cancels the switch AND rejects the caller's `setModel()`
promise with the hook's reason, and `"ask"` refuses outright on a headless session.

That contract is raw hook plumbing. The engine's product surface for it is a **declarative policy**: a
fleet operator or library caller states *which switches a session may make and at what cache-forfeit
cost*, without writing hook callbacks — the same move `guardTool`/`blockTool` made for tool gating.
Motivating cases:

- **Cost governance** — a switch while the prompt cache is warm forfeits it; the next request re-caches
  `context_tokens` at the new model's cache-write rate. A daemon fleet wants "deny any switch that
  would forfeit a warm cache costing more than $X to rebuild".
- **Model pinning** — a service pins sessions to a family set ("sonnet and haiku only"); switches
  outside the set are denied with a reason the caller sees verbatim in the `setModel()` rejection.
- **Continuity annotation** — `PostModelSwitch.additionalContext` reaches the new model with its first
  request; the policy can brief it ("you were switched from X mid-session; the running task is …").
- **Observability** — hosts (daemon event log, ccx status line) want switch events without owning hooks.

## Design

### The config knob

```ts
// HarnessConfig (config/types.ts)
modelSwitchPolicy?: ModelSwitchPolicy;

// src/hooks/modelSwitch.ts
export interface ModelSwitchPolicy {
  /** Permitted switch targets. Absent = all targets permitted. Entry forms:
   *  - a bare word ("sonnet", "haiku") = a FAMILY: matches when `to_model` starts with
   *    `claude-<word>-` or `requested_model` equals the word. Family, not pin, is the list reading —
   *    the same reading CC's own org allowlists use (2.1.222 family step-down).
   *  - anything else ("claude-sonnet-5", a provider-format id) = EXACT: matches `to_model` or
   *    `requested_model` verbatim (case/space-normalized). */
  allowModels?: string[];
  /** Deny a switch that would FORFEIT a warm prompt cache costing more than this (USD) to rebuild.
   *  Binds only when `prompt_cache_warm === true`: a cold cache is re-written on the next turn
   *  whether or not the model changes, so there is nothing to protect. */
  maxCacheWriteUsd?: number;
  /** Escape hatch, same HookDecision vocabulary as guardTool: `{ block, reason? }` denies, anything
   *  else is no-opinion. May be async. Runs alongside the declarative checks, never instead. */
  decide?: (input: PreModelSwitchHookInput) => HookDecision | Promise<HookDecision>;
  /** PostModelSwitch → additionalContext for the new model's first request. null/undefined/"" = none. */
  annotate?: (input: PostModelSwitchHookInput) => string | null | undefined | Promise<string | null | undefined>;
  /** Observability tap: fires on both hooks ("pre" carries the composed decision). Errors are
   *  swallowed (`observe` rule: an observer must never break a turn — or a switch). */
  onSwitch?: (phase: "pre" | "post", input: PreModelSwitchHookInput | PostModelSwitchHookInput, denied?: string) => void;
}
```

### Semantics (the decision log)

1. **Deny-wins composition.** All three opinions are computed — allowlist, cost cap, `decide` — and
   ANY block denies; reasons prefix `cc-harness modelSwitchPolicy: …` so the `setModel()` rejection is
   self-explanatory (probe 121: the reason lands verbatim in the thrown error). `decide` returning
   `{allow:true}` cannot override a declarative deny — a soft cap is not a cap.
2. **Allow = no opinion, `{}`.** The policy never returns `permissionDecision:"allow"`: an explicit
   allow would also skip Claude Code's interactive cache-miss confirm, silently stripping an
   interactive user's protection. Headless paths have no confirm, so `{}` costs nothing there.
3. **No "ask" vocabulary.** Headless ask = refuse (probe 121 phase C). A policy that wants asks is a
   host UI concern; the raw `hooks` passthrough remains available for it.
4. **Cost cap gates on warm cache only** (rationale in the field jsdoc above).
5. **Composition with user hooks.** `resolveOptions` merges the policy fragment with `config.hooks`
   via `mergeHooks` — both run; SDK deny-wins across callbacks. Order: user fragments first, policy
   last (mergeHooks concatenates; no override semantics exist to fight over).
6. **Placement: config-level, not Session-level.** The knob rides `HarnessConfig`, so it reaches every
   path through `resolveOptions` — `createHarness`, lib `Session`/`openSession`, daemon `makeSession` —
   with zero per-surface wiring. (The one path it cannot see: switches on sessions spawned outside
   this config. Non-goal.)

### Non-goals

- No per-model pricing math of our own — `estimated_cache_write_usd` and `pricing` are the engine's
  numbers; the policy compares, never computes.
- No interception of `source:"resume"` restores (Post fires for them; Pre does not — a restore is not
  a switch request) and no attempt to distinguish `command`/`picker` sources: the policy treats every
  Pre uniformly. Hosts that want source-sensitive policy use `decide` (the source field is in the input).
- No daemon event frame for switches in this wave — `onSwitch` is the tap; wiring it into the daemon's
  event log is a separate consumer decision.

## Tests

- **Unit (`test/unit/model-switch-policy.test.ts`)** — builder-level, no SDK: allowlist family vs exact
  matching (word hits family id; exact id misses other family members; absent list = all allowed);
  warm/cold cache gating at the cap boundary (over-warm denies, over-cold allows, under-warm allows);
  deny-wins (decide-allow cannot override list deny); reason prefix; annotate → `additionalContext`
  shape, empty = `{}`; tap fires with phase + denial, tap throw swallowed; async decide/annotate.
- **resolveOptions merge (knobs/model-switch tests)** — policy alone mounts both events; policy + user
  `hooks` coexist (user fragment first, both present).
- **Live, gated (`test/live/model-switch-policy.test.ts`)** — one streaming session each way:
  a `maxCacheWriteUsd: 0.000001` policy rejects `setModel("sonnet")` with the prefixed reason; a
  permissive policy with `annotate` + `onSwitch` lands the switch (next assistant frame on the new
  model) and the tap saw both phases. Mirrors probe 121's mechanics.
