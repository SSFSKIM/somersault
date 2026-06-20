# Increment A — Harness Defaults & Daemon Config Parity (design)

**Status:** approved (user, 2026-06-20) — ready for writing-plans.
**Goal:** Give the harness sane Claude-Code-faithful **defaults** (Opus 4.8 · xhigh · auto) and stop the
daemon path from being **bare** — both achieved by routing through the existing `resolveOptions` policy
seam. This is the foundational increment from the 2026-06-20 UX audit; it dissolves audit findings #1
(daemon bare prompt), #2 (daemon permission mode), #7 (no default model), part of #12/#13 (daemon tools/
context), and makes #9 (thinking streams) surface readily by default (via the `xhigh` effort default).

## Context — what the audit + probes established

The 2026-06-20 four-agent audit (against our code + the Claude Code reference) and live probe 26 produced
the ground truth this design rests on:

- **The lib/chat path is config-correct; the daemon path is bare.** `openSession`/`createHarness` thread
  every session through `resolveOptions` → `{preset:"claude_code"}` system prompt + `settingSources` +
  tools preset. The daemon's `supervisor.makeSession` (`harness/src/daemon/supervisor.ts:308`) hand-builds
  a bare `{model?, resume?, permissionMode?}` object and **never calls `resolveOptions`** (confirmed in
  `harness/CLAUDE.md`: "the daemon does NOT use it"). So daemon/console sessions get no CC system prompt,
  no project context, no tools preset.
- **No defaults exist.** `resolveOptions` only sets `model`/`permissionMode`/`effort` when the caller
  provides them (`resolveOptions.ts:37,40,46`); `DEFAULTS` (`types.ts:76`) has none of them. The SDK
  decides (≈ sonnet, default mode, adaptive thinking).
- **`resolveOptions` is already the policy seam.** It centralizes the auto model-gate and the bypass-gate
  precisely so "every lib/createHarness caller is born auto-safe" (`resolveOptions.ts:48`). Defaults belong
  in that same seam.
- **Probe 26 (committed `9a02340c5a`): opus-4-8 is already a 1M-context model headlessly.** Two sessions on
  `claude-opus-4-8` — one with the `anthropic-beta: context-1m-2025-08-07` header, one without — **both**
  reported `maxTokens: 1000000, rawMaxTokens: 1000000`. The beta header is a no-op. **Therefore the 1M
  context goal is satisfied for free by the model default; the `[1m]`/beta-header mechanism is dropped.**

## Decisions (locked by user)

| Axis | Decision |
|---|---|
| Default model | `claude-opus-4-8` (harness-wide — chat, console, headless lib) |
| Default reasoning | `effort: "xhigh"` |
| Default permission mode | `auto` (SDK-native classifier) |
| 1M context | **Dropped** — opus-4-8 is already 1M (probe 26) |
| Where defaults live | Inside `resolveOptions` via `DEFAULTS` (approach A) |

## Architecture

Two changes, one seam.

### 1. Defaults in `resolveOptions` (`harness/src/config/`)

Add to `DEFAULTS` (`types.ts`):
```ts
export const DEFAULTS = {
  settingSources: ["user", "project", "local"] as SettingSource[],
  includeBuiltinAgents: true,
  enableFileCheckpointing: true,
  toolPreset: "claude_code" as const,
  provider: "anthropic" as const,
  model: "claude-opus-4-8",                 // NEW — harness-wide default model
  permissionMode: "auto" as PermissionMode, // NEW — SDK-native auto classifier
  effort: "xhigh" as EffortLevel,           // NEW — default reasoning effort
};
```

Rewire `resolveOptions` (`resolveOptions.ts`) to apply them. Exact replacement for the model/mode/effort
lines (currently 37, 40, 46, 50, 53):
```ts
const model = config.model ?? DEFAULTS.model;
options.model = model;
// ... (fallbackModel, maxTurns unchanged) ...
const effort = config.effort ?? DEFAULTS.effort;
if (effort) options.effort = effort;
if (config.thinking) options.thinking = config.thinking;       // unchanged — thinking stays caller-only
// ...
const mode = config.permissionMode ?? DEFAULTS.permissionMode;
if (mode) options.permissionMode = mode;
// auto is MODEL-GATED. Force a supported model ONLY when the caller EXPLICITLY chose auto — do NOT run
// the gate when auto is merely the default, or an explicit non-auto-capable model (e.g. haiku) would be
// silently overridden to sonnet. With the opus-4-8 default, default-auto needs no gate (opus IS capable).
if (config.permissionMode === "auto") options.model = resolveAutoModel(config.model ?? DEFAULTS.model);
if (mode === "bypassPermissions") options.allowDangerouslySkipPermissions = true;
```

**The critical subtlety (must be tested):** the gate keys on `config.permissionMode === "auto"` (explicit),
NOT on the resolved `mode`. Truth table:

| call | resolved model | resolved mode | why |
|---|---|---|---|
| `{}` | `claude-opus-4-8` | `auto` | both defaulted; opus is auto-capable → no gate needed |
| `{ model: "claude-haiku-4-5" }` | `claude-haiku-4-5` | `auto` | **explicit model preserved**; auto defaulted → gate NOT run (SDK silently degrades auto→default for haiku) |
| `{ permissionMode: "auto" }` | `claude-opus-4-8` | `auto` | explicit auto, no model → gate runs on the opus default → opus |
| `{ permissionMode: "auto", model: "claude-haiku-4-5" }` | `claude-sonnet-4-6` | `auto` | explicit auto forces a supported model (preserves today's behavior) |
| `{ permissionMode: "default", model: "claude-haiku-4-5" }` | `claude-haiku-4-5` | `default` | unchanged |

### 2. Daemon routes through `resolveOptions` (`harness/src/daemon/supervisor.ts`)

Replace the bare-object construction in `makeSession` (`:308-313`). Keep the existing **post-overlay**
`canUseTool` line so the daemon broker still wins, and keep the `sessionOptions` factory overlay:
```ts
private makeSession(id: string, cfg: SpawnConfig, resume?: string): DaemonSession {
  const base = resolveOptions({
    model: cfg.model,                  // undefined → resolveOptions applies the opus-4-8 default
    permissionMode: cfg.permissionMode,// undefined → auto default
    ...(resume ? { resume } : {}),
  });   // no cwd: the daemon runs from the project dir, so settingSources resolves against process.cwd()
  const extra = this.sessionOptions?.(id);              // fresh servers + tool posture for THIS session
  const options = extra ? { ...base, ...extra } : base; // factory keys win (unchanged contract)
  options.canUseTool = createPermissionGate(this.pending.brokerFor(id)); // daemon broker wins — set LAST
  const session = new DaemonSession(id, { query: this.deps.query }, options, this.now, { contextTool: this.contextTool, compactTool: this.compactTool });
  session.done.then(() => this.handleSessionEnd(id)).catch(() => {});
  return session;
}
```
This hands daemon sessions the `claude_code` system prompt, `settingSources` (project CLAUDE.md/context),
the tools preset, builtin agents, file-checkpointing, **and** the model/mode/effort defaults — in one move.
`canUseTool` is deliberately set AFTER the factory overlay so the daemon broker is never clobbered; we do
NOT pass `permissionBroker` into `resolveOptions` (the explicit post-overlay line is the single source of
the daemon's gate). `SpawnConfig` carries no `cwd` and the supervisor has none (verified) — so no `cwd` is
passed and the SDK resolves `settingSources` against the daemon's `process.cwd()` (the project dir), which
is correct.

### Why this shape (isolation)

`resolveOptions` stays the one place that turns a `HarnessConfig` into SDK `Options` + policy. After this
increment there is exactly **one** path to a session's options for every surface (lib, one-shot, daemon),
which is the property whose absence caused the bare-daemon bug. No new module; both edits live in files
that already own this responsibility.

## The `auto` + broker interplay (intended behavior, not a bug)

With `auto` as the default and the daemon broker wired as `canUseTool`: the SDK classifier auto-handles
routine ops and routes genuinely-risky ones to `canUseTool` → the console `PermissionDialog`. Routine tools
flow silently; risky tools prompt. This is the Claude-Code feel, achieved by *removing* daemon
special-casing. `effort: "xhigh"` additionally raises reasoning effort, so the SDK's default-on (adaptive)
thinking produces thinking blocks far more readily — surfacing the already-built live thinking-stream
(audit #9) without the user touching `/think`. (We default `effort`, not a `thinking` budget; the runtime
`/think` lever still governs.)

## Blast radius & test updates (expected, bounded)

- **One-shot CLI** (`cli.ts:105`) explicitly sets `bypassPermissions` → overrides the auto default →
  unaffected.
- **Live tests** mostly pass explicit model/mode → unaffected.
- **`harness/test/unit/resolveOptions.test.ts`** — these assertions change *by design* and must be updated:
  - the "bare" case (`resolveOptions({})`): now carries `model: "claude-opus-4-8"`, `permissionMode:
    "auto"`, `effort: "xhigh"`. Remove `effort` from any `not.toHaveProperty` list (note: `thinking`,
    `maxBudgetUsd`, `taskBudget`, `includePartialMessages`, `forwardSubagentText` remain absent — only
    `effort` is now defaulted). Add positive assertions for the three new defaults.
  - `resolveOptions({ permissionMode: "auto" })`: model is now `claude-opus-4-8` (was `claude-sonnet-4-6`).
  - the explicit-auto-forces-model cases (`{permissionMode:"auto", model:"claude-haiku-4-5"}` → sonnet;
    `{...model:"claude-opus-4-8"}` → opus) **stay green** — confirm they still pass.
  - add a NEW case pinning the subtlety: `resolveOptions({ model: "claude-haiku-4-5" })` keeps
    `model: "claude-haiku-4-5"` (default-auto must NOT override an explicit model).
- **Audit** `session-factories.test.ts`, `index.test.ts`, `readme.test.ts`, and the daemon unit tests for
  any assumption that a session has no model/mode by default; update as needed.
- **`coverage.md`** + the phase3 memory get refreshed at the end (defaults posture + daemon parity).

## Testing strategy

- **Unit (DI, no key):**
  1. defaults present when omitted; explicit values override; the auto-gate truth table above (incl. the
     explicit-haiku-preserved subtlety).
  2. daemon parity: a recording fake `query` (injected via `deps.query`) captures the `Options` a
     daemon-spawned session is constructed/run with; assert it includes `systemPrompt` (the `claude_code`
     preset), `settingSources`, the tools preset, and `model: "claude-opus-4-8"` — and that `canUseTool`
     is still the daemon broker gate (set last, survives the factory overlay).
- **Gated live e2e** (`ANTHROPIC_API_KEY`, thin): spawn a daemon session with no model/mode; confirm it
  runs on opus-4-8 and behaves with project context (e.g. a prompt that depends on the CC base prompt /
  CLAUDE.md). Skips cleanly without a key.

## Out of scope (explicit)

- The `[1m]`/`context-1m` beta-header mechanism (probe 26 → no-op for opus-4-8). Sonnet-1M, if ever wanted,
  is a separate trivial follow-up.
- All other audit findings — markdown rendering, the "thinking…" submit indicator, `/model` picker, the
  `m`-cycle bug, richer Detail pane, proactive visibility, skills/command surface — are Increments B/C/D.
- Runtime mutation of defaults; per-surface default overrides; changing the one-shot CLI's bypass posture.

## Global constraints

- TypeScript, dense **no-Prettier** hand-style (match surrounding code); **ESM** import specifiers end in
  `.js`. Edits confined to `harness/src/config/{types.ts,resolveOptions.ts}` and
  `harness/src/daemon/supervisor.ts` (+ their tests).
- DI-by-deps for unit tests (no network); live tests gate on `ANTHROPIC_API_KEY` read from `CC-to-SDK/.env`
  (never commit/print it).
- After changes: `npm run typecheck` (exit 0) + `npm run test:unit` (green) from `harness/`; the controller
  runs the keyed live pass.
- Trust a clean `typecheck` + green vitest over phantom stale-cache LSP diagnostics.
- Git: commit completed work to `main`; **no `Co-Authored-By`**; no push without an explicit request.

## Probe grounding

- **Probe 26** (`probes/probes/26-context-1m-header.ts`, committed `9a02340c5a`): opus-4-8 reports
  `maxTokens/rawMaxTokens = 1_000_000` with and without the `context-1m` beta header → 1M default for free,
  beta mechanism dropped.
- **Probe 24** (auto model-gate) + memory `sdk-permissionmode-canusetool-matrix`: `auto` is model-gated to
  Opus 4.6+/Sonnet 4.6 and silently degrades on unsupported models — the basis for the explicit-vs-default
  gate subtlety.
- `effort: "xhigh"` is a declared, live-verified SDK knob (`types.ts:13`; turn-controls closeout
  2026-06-18) — no fresh probe needed.
