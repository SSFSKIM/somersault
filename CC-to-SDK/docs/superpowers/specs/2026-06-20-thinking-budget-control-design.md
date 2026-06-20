# Interactive Thinking-Budget Control (Increment 11) — Design

**Goal:** Give `cc-harness-chat` (and the daemon console) interactive control over the model's
extended-thinking budget — a `/think <level>` command, a `--think <level>` launch flag, and a status
indicator in the chat REPL, plus a console thinking-cycle — by wiring the already-built, probe-verified
`setMaxThinkingTokens` runtime lever. Same shape as increment 10's mature `auto`: surface a mature SDK
lever that is built lib-side but has no interactive control.

## Why (the audit + probe)

An audit for under-surfaced SDK capabilities (the pattern that produced increment 10) found the
thinking/effort lever is fully built lib-side — `Session.setMaxThinkingTokens` (`session.ts:107`,
bridge-wired via the `set_thinking` `ControlFrame`, plus the `thinking` config knob) — but has **zero
interactive surface**: no command, no launch flag, no indicator. `liveTurn` already *renders* thinking
blocks (increment 7), so users SEE thinking but cannot control its budget.

**Probe 25** (`probes/probes/25-thinking-runtime-lever.ts`, committed `fe10176552`) verified live on the
chat (streaming-input, non-daemon) path:
- **P2:** `setMaxThinkingTokens(n)` takes effect MID-SESSION (turn 2 reflects the new budget).
- **P3/P5:** `setMaxThinkingTokens(0)` DISABLES thinking at runtime (turn went 1 block → 0).
- **P1:** thinking is **ON by default** (a no-config session already emits thinking blocks, ~2273 chars).

So the feature is runtime **budget control** — turn it *up* for hard problems, *down/off* to cut tokens +
latency — not enablement.

## Scope (user-chosen)

`/think` (chat REPL) **+ console parity**. The level vocabulary borrows the SDK `effort` enum
(`low/medium/high/xhigh/max`) plus an `off` rung. **Mechanism = the thinking token budget** (the only
runtime lever — there is no runtime `setEffort`); the level names are a familiar vocabulary over the
budget. `/cost` (a separate audit finding) is **out of scope**.

## Architecture

**Entirely in `tui/`.** The lib already exposes every lever:
- `Session.setMaxThinkingTokens(maxTokens: number | null)` (`harness/src/session/session.ts:107`) — the
  runtime lever the chat `/think` uses.
- The `set_thinking` control frame — `ControlFrame` already includes `{ type: "set_thinking", maxTokens:
  number | null }` (`harness/src/bridge/types.ts:22`); `ControlBridge.apply` routes it to
  `setMaxThinkingTokens` (`control.ts:18-19`); the daemon accepts it and it is live-verified
  (`daemon.test.ts`). The console `/think` cycle uses this via `useDaemon`'s existing `ctl`/`run` pattern.
- The `thinking` config knob (`HarnessConfig.thinking`, `resolveOptions` passthrough) — the `--think`
  launch flag uses this to open a session at a baseline budget.

A new pure `tui/src/thinkLevels.ts` is the **single source of truth** for the level↔budget vocabulary,
shared by the chat REPL (`useChat`/`commands`/`chat.tsx`/`ChatStatusBar`) and the console
(`useDaemon`/`App`). **NO harness change, NO new public export, NO API-STABILITY/index pin, NO harness
rebuild.**

## §1 — Level vocabulary (the single source of truth: `tui/src/thinkLevels.ts`)

| Level | Thinking budget (tokens) | Note |
|---|---|---|
| `off` | 0 | `setMaxThinkingTokens(0)` — probe-verified to disable |
| `low` | 4000 | |
| `medium` | 10000 | |
| `high` | 16000 | |
| `xhigh` | 24000 | |
| `max` | 32000 | ≈ real CC "ultrathink" |

(Budgets are tunable; this is a clean escalating progression within model limits.)

Exports:
- `THINK_LEVELS = ["off","low","medium","high","xhigh","max"] as const`
- `thinkBudget(level: string): number` — name → budget (above)
- `parseThinkArg(arg: string): { level: string; budget: number } | null` — accepts a level NAME **or** a
  raw non-negative integer (`/think 16000` → `{level: thinkLabel(16000), budget: 16000}`); invalid → null
- `nextThinkLevel(level: string): string` — console cycle order (`off→low→…→max→off`; off-ladder → `off`)
- `thinkLabel(budget: number): string` — reverse for display (exact budget → its name; else `"<N/1000>k"`)

## §2 — Chat REPL (`cc-harness-chat`)

- **`/think` command** — `commands.ts`: a `COMMANDS` row `{ name: "think", summary: "<off|low|medium|high|
  xhigh|max|N> — set thinking budget (no arg shows current)" }` + a `formatThink(level, budget)` formatter.
- **`useChat`** — add `setMaxThinkingTokens(maxTokens: number | null): Promise<void>` to the `ChatSession`
  interface (the real `Session` already has it). Add `thinkLevel: string` to `ChatState` (initial =
  `opts.initialThink ?? "default"`). A `case "think":` in `handleCommand`: `parseThinkArg(cmd.args)` →
  on null, error notice; else `await session.setMaxThinkingTokens(budget)` (disposed-guarded after the
  await), `setThinkLevel(level)`, append `formatThink`. `/think` with no arg → show current level/budget.
- **`--think <level>` launch flag** — `commands.ts`: `parseLaunchThink(args): string | undefined` (a valid
  level name, else undefined). `chat.tsx`: when present and not `off`, open the session with
  `thinking: { type: "enabled", budgetTokens: thinkBudget(level) }`; thread `initialThink: level` to
  `ChatApp` → `useChat` for the indicator. (`--think off`: open with thinking disabled if `ThinkingConfig`
  supports a `disabled` form, else open default and the runtime `/think off` still applies — a plan-level
  detail to confirm against the SDK type.)
- **Status bar** — `ChatStatusBar.tsx`: a `think:<level>` span after the mode span (dim, or a light
  intensity color; reuse the `modeColor` pattern only if it reads well — a plain dim span is acceptable).

## §3 — Daemon console (`cc-harness-console`)

- **`useDaemon.cycleThinking`** — cycles `THINK_LEVELS` (`off→…→max→off`), issues `run(label, ctl(label,
  { type: "set_thinking", maxTokens: thinkBudget(level) }))` to the selected session (mirrors
  `cyclePermissionMode`); the transient status message shows the result (e.g. `thinking=high`). The
  `set_thinking` frame is already daemon-supported + bridge-applied (no harness change).
- **`App.tsx`** — bind ONE key (e.g. `t`) in the list-focus `useInput` to `cycleThinking`, + a help hint.
  The change is limited to the keybind + hint + wiring (no refactor). The shared `Composer.tsx` is **not**
  touched.

## §4 — Global constraints

- **Vocabulary = SDK effort enum names** (`low/medium/high/xhigh/max`) **+ `off`**; **mechanism = the
  thinking token budget** via `setMaxThinkingTokens` / `set_thinking` / the `thinking` config knob. ONE
  source of truth in `thinkLevels.ts` — no second copy of the level set or budgets anywhere.
- `off` → `setMaxThinkingTokens(0)` (probe-verified disables).
- **NO harness change / no new public export / no API-STABILITY/index pin / no harness rebuild.**
- **NO Prettier — dense hand-style**; ESM `.js` import specifiers; bare `"cc-harness"` for engine imports;
  commit messages plain (NO `Co-Authored-By`).
- ink `useInput` timing discipline in tests (`await`/`waitFor` before dependent keys; real escape
  sequences; test files run sequentially); all new `setState` inside `disposed.current` guards;
  disposed re-check after each `await` in the `/think` handler.
- Shared `Composer.tsx` untouched; the console `App.tsx` change is limited to the keybind + hint + wiring.

## §5 — Out of scope

- `/cost` (separate audit finding), rewind, session rename/tag/delete.
- The `effort` config knob (orthogonal passthrough; the interactive control is the thinking budget).
- A runtime `setEffort` (no SDK lever exists).
- Deep per-model thinking-capability gating: `setMaxThinkingTokens` is feature-detected by the bridge and
  the `ChatSession` call is try/caught — a non-thinking model that rejects it surfaces a notice; we do not
  pre-block by model.

## §6 — Testing

- **Unit (keyless):** `thinkLevels` (parse names + raw ints + invalid; budget; next-cycle incl. off-ladder;
  label exact + `Nk`); `commands` (`/think` row present; `parseLaunchThink` valid/invalid); `useChat`
  (`/think <level>` calls `setMaxThinkingTokens(budget)` + sets `thinkLevel` + notice; `/think` no-arg
  shows current; `/think bogus` errors; disposed-guard after unmount); `ChatStatusBar` (`think:<level>`
  span renders); `useDaemon` (`cycleThinking` issues `set_thinking` with the right `maxTokens`, cycles
  through levels).
- **Gated live e2e (controller runs keyed):** open a `Session`, `setMaxThinkingTokens(0)` → submit a
  reasoning prompt → assert NO thinking blocks; `setMaxThinkingTokens(thinkBudget("high"))` → submit →
  assert thinking blocks present (mirrors probe 25's detection — count assistant `type:"thinking"` blocks).
  Proves the lever `/think` drives works end-to-end.

## §7 — Probe grounding

Probe 25 (`fe10176552`) verified the runtime lever (enable/adjust/disable mid-session; thinking on by
default). Console `set_thinking` reachability verified by reading `bridge/types.ts:22` (`ControlFrame`
includes `set_thinking`), `bridge/control.ts:18-19` (bridge applies it), and `useDaemon.ts` (the `ctl`/
`run` control-frame pattern) — no harness change needed.
