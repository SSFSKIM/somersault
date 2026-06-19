# Mature `auto` mode + graceful permission ladder (Increment 10) — Design

**Status:** approved-in-principle (brainstorm answers + A1 grounding locked); pending spec review → plan.
**Feature:** bring the mature `auto` permission mode (the headless LLM classifier) to the interactive surfaces and centralize its model-gate — so `cc-harness-chat` offers a graceful `default → acceptEdits → auto` ladder (bypass gated), every lib/`createHarness` caller inherits the daemon's auto model-safety, and the console repairs the model when a session is switched to `auto` at runtime.

## 1. Why / the gap

`auto` is the SDK's headless **AI-classifier** permission mode: it silently allows safe tool calls and actively **blocks** dangerous ones (probe 18f), and it is **model-gated** (Opus 4.6+/Sonnet 4.6) — on any other model it **silently degrades to `default`** (probe 18d). We only understood this after the 18-series probes, and we wired it into exactly one place: the daemon (incr-4 auto-autonomy, `supervisor.ts:110` forces a supported model on `auto` spawns). The rest of the app still encodes the pre-18d mental model:

- **`cc-harness-chat`** — the one surface a human actually sits at — exposes a **binary**: `Tab` cycles `default ↔ bypassPermissions` (`useChat.ts:29` `OTHER_POLE`). There is no `auto`, no `acceptEdits`; the only autonomy is ungated YOLO. It can't even be launched in `auto` (the bin hardcodes `permissionMode: "default"`, `chat.tsx:14`).
- **`resolveOptions`** — the shared seam that `createHarness` *and* the lib `Session` (which the chat REPL drives) both wire through — passes `permissionMode: "auto"` straight through (`:45`) with **no `resolveAutoModel`**. The model-gate that keeps `auto` honest lives only in the daemon (which bypasses `resolveOptions`) and kairos. So on the lib path, "auto" on the wrong model *is* `default`, silently. Note the same file *deliberately centralizes* the analogous `bypassPermissions → allowDangerouslySkipPermissions` invariant three lines above (`:46-48`, *"Centralize it here so no path … can set the mode without satisfying it"*) — `auto` simply never got the same treatment.
- **`cc-harness-console`** — cycles all six modes incl. `auto` (`useDaemon.ts:5`), but switching a *running* non-auto session to `auto` doesn't re-force its model, so it silently degrades (the daemon only forces the model at *spawn*).

Increment 10 closes all three on grounded premises.

## 2. A1 grounding (probe 24 — `probes/probes/24-auto-mode-lib-seam-runtime.ts`, committed)

Run live (keyed), the chat REPL's lib seam faithfully represented by a raw-SDK `query` with a **counting `canUseTool`** (`resolveOptions` just sets `options.canUseTool` + `options.permissionMode`; the SDK's "consult `canUseTool` under mode X?" decision is path-independent). All five premises GREEN:

- **P1 — `auto` bypasses the broker.** `auto` + `claude-sonnet-4-6` → **0 `canUseTool` calls**, the safe Write applied, `result.subtype:"success"`. The classifier allows safe work silently; the inline `PermissionDialog` **never fires** for it. ⇒ in the chat REPL, `auto` means "the classifier decides — no prompts," not "ask me less."
- **P2a — `auto` silently degrades on an unsupported model.** `auto` + `claude-haiku-4-5` → `canUseTool` **was** consulted (`["Write"]`) ⇒ behaving as `default`. The model-gate is mandatory, not cosmetic.
- **P2b — runtime `setPermissionMode("auto")` takes effect.** Streaming session, turn 1 (`default`) → `canUseTool` called; after `setPermissionMode("auto")`, turn 2 → **0 calls**. ⇒ `auto` can be toggled live.
- **P2c — runtime model repair works (Gap C).** Start `default` + `haiku`; turn 1 → `canUseTool` called; after `setModel("claude-sonnet-4-6")` + `setPermissionMode("auto")`, turn 2 → **0 calls**. ⇒ an unsupported session can be **repaired into effective `auto` live**.
- **P3 — `acceptEdits` is a real, distinct middle rung.** `acceptEdits` + a real Edit (modify) + Write (create) + the model's Read → only **`Read`** hit `canUseTool`; the Edit and Write both applied with **no** broker call. ⇒ `acceptEdits` **auto-accepts Edit *and* Write** but **gates non-edit tools** (Read/Bash). Distinct from `default` (which gates edits) and from `auto` (which gates nothing for safe ops).

## 3. Scope (locked via brainstorm)

**In:**
1. **Centralize the `auto` model-gate in `resolveOptions`** — `permissionMode:"auto"` forces `options.model = resolveAutoModel(config.model)` so every lib/`createHarness` caller is born auto-safe.
2. **`cc-harness-chat` permission ladder** — `Tab` cycles `default → acceptEdits → auto → (loop)`; `auto` self-heals the model live (swap + notice); `/yolo` command + `--permission-mode <mode>` launch flag reach `bypassPermissions` (gated, off the cycle); status bar colors the mode.
3. **Export `resolveAutoModel` / `isAutoSupportedModel`** from `cc-harness` (advanced-seam) so the REPL shares the single source of truth for "which models support auto."
4. **Console runtime auto-repair** — when `cyclePermissionMode` lands on `auto`, also issue a `setModel(resolveAutoModel(currentModel))` control op so a runtime switch is effective.

**Out (non-goal):**
- Restoring the pre-auto model when leaving `auto` (chose "swap + notice, no restore"). Per-tool "always allow" UX beyond what `createPermissionGate` already does. Changing the daemon's spawn-time forcing (already correct). New `acceptEdits`/`plan`/`dontAsk` affordances beyond the ladder. Any `Composer.tsx`/console-`App.tsx` rewrite.

## 4. Architecture & module boundaries

| Unit | Kind | Responsibility / interface |
|---|---|---|
| `harness/src/config/resolveOptions.ts` | **modify** | After the `permissionMode` passthrough (`:45`), add: `if (config.permissionMode === "auto") options.model = resolveAutoModel(config.model);` (overrides the plain `options.model = config.model` at `:36` — a supported explicit model is preserved since `resolveAutoModel` returns it unchanged; an unsupported one is upgraded; `undefined` → `DEFAULT_AUTO_MODEL`). Import `resolveAutoModel` from `./autoModel.js`. Mirrors the `bypassPermissions` centralization pattern. |
| `harness/src/index.ts` + `test/unit/index.test.ts` + `API-STABILITY.md` | **modify** | `export { resolveAutoModel, isAutoSupportedModel } from "./config/autoModel.js";` (with the other `config/` exports, `:3-7`). Add both names to the `EXPECTED` surface array (`index.test.ts:59`). Document as **advanced-seam** in `API-STABILITY.md`. First public-API addition since incr-4. |
| `tui/src/useChat.ts` | **modify** | Replace `OTHER_POLE` with a ladder. `const LADDER = ["default","acceptEdits","auto"] as const;` `ladderNext(mode)` = next in `LADDER` if `mode∈LADDER`, else `"default"` (so `bypassPermissions`/other → re-enter at `default`). New async `applyMode(next)`: disposed-guarded; when `next==="auto"`, `const target = resolveAutoModel(model); if (model !== target) { await session.setModel(target).catch(()=>{}); if(!disposed.current){ setModel(target); append([autoSwapNotice(model,target)]); } }`; then `await session.setPermissionMode(next).catch(()=>{}); if(!disposed.current) setMode(next);`. `cycleMode()` → `void applyMode(ladderNext(mode))`. `/yolo` → `void applyMode("bypassPermissions")`. Import `resolveAutoModel` from `cc-harness`. |
| `tui/src/commands.ts` | **modify** | Add `{ name: "yolo", summary: "enable bypassPermissions (ungated)" }` to `COMMANDS`. (No new formatter — `useChat` handles it.) |
| `tui/src/chat.tsx` | **modify** | Parse `--permission-mode <mode>` (validate against the 6 SDK modes; invalid → `"default"` + a stderr note). Set `base.permissionMode = launchMode` (replacing the hardcoded `"default"`), and pass `hookOpts={{ initialMode: launchMode }}` to `<ChatApp>`. Launch-time `auto` model-forcing is handled **for free** by Part 1 (the session is built via `openSession`→`resolveOptions`). |
| `tui/src/ChatStatusBar.tsx` | **modify** | Replace the `bypassPermissions?red:green` binary with a map: `default`→green, `acceptEdits`→yellow, `auto`→cyan, `bypassPermissions`→red. |
| `tui/src/useDaemon.ts` | **modify** | In `cyclePermissionMode`, when the next mode is `"auto"`, first issue a `setModel(resolveAutoModel(selectedModel))` control op (only if it differs from the session's current model in the snapshot), then the existing `set_permission_mode` op. Import `resolveAutoModel` from `cc-harness`. |
| `tui/test/live/auto-mode.e2e.test.ts` | **create** | gated: a real session entered into `auto` applies a safe edit with **no** pending permission / no dialog (proves the classifier-bypass end-to-end). |

`ChatApp.tsx` needs **no change** — it already accepts `hookOpts` and threads it into `useChat`; `chat.tsx` simply starts passing it.

## 5. Data flow

- **Launch** `--permission-mode auto` → `chat.tsx` sets `base.permissionMode="auto"` → `openSession`→`resolveOptions` **forces a supported model** (Part 1) → the session is born effective-auto; `useChat` seeds `mode="auto"` via `initialMode`. No runtime swap needed.
- **Runtime `Tab`** → `cycleMode()` → `applyMode(ladderNext(mode))`. Entering `auto`: if the live `model` isn't auto-supported, `setModel(resolveAutoModel(model))` + notice, then `setPermissionMode("auto")` (P2b/P2c). `acceptEdits`/`default`: plain `setPermissionMode`. Leaving `auto` (→`default`): no model restore (the swapped model persists).
- **Runtime `/yolo`** → `applyMode("bypassPermissions")` (the only in-REPL route to bypass). From `bypassPermissions`, `Tab` → `default` (re-enters the ladder).
- **Console** `cyclePermissionMode` → `auto`: `setModel(resolveAutoModel(selectedSession.model))` control op (if needed) + `set_permission_mode` op → the running daemon session becomes effective-auto (P2c).

## 6. Error handling & guards

- `applyMode` is `disposed.current`-guarded before the swap and re-checked after each `await` (the recurring teardown-liveness bug class). `setModel`/`setPermissionMode` rejections are caught (`.catch(()=>{})`) — a control failure must not crash the REPL; `setMode` is applied after the awaits so the UI reflects the attempted mode.
- The auto-swap **notice** is appended only when an actual swap happens (`model !== target`). Copy: with a known model, `↻ auto — switched model to <target> (<model> doesn't support auto)`; with an unknown/undefined model, `↻ auto — using <target> (auto needs Opus 4.6+/Sonnet 4.6)`.
- `--permission-mode` validates against `["default","acceptEdits","auto","bypassPermissions","plan","dontAsk"]`; an unknown value falls back to `default` with a one-line stderr note (never a crash).
- Console: `setModel` control-op failure is swallowed like the existing control ops; if the snapshot model is unknown, force `DEFAULT_AUTO_MODEL`.

## 7. Testing

- **`resolveOptions` unit** (harness): `auto`+`claude-haiku-4-5` → `options.model === "claude-sonnet-4-6"`; `auto`+`claude-opus-4-8` → unchanged; `auto`+no-model → `DEFAULT_AUTO_MODEL`; `default`+`claude-haiku-4-5` → model untouched.
- **`index.test.ts`**: the two new names appear in `EXPECTED`; surface assertion stays green.
- **`useChat` cycleMode ladder** (tui): `default→acceptEdits→auto→default`; the `auto` step on an unsupported `model` calls `setModel(resolveAutoModel(...))` then `setPermissionMode("auto")` (fake session captures both calls + order) and appends the notice; the `auto` step on a supported model does **not** call `setModel`; `/yolo` → `setPermissionMode("bypassPermissions")`; `Tab` from bypass → `default`. All disposed-guarded (a teardown test: `applyMode` after unmount is a no-op).
- **`commands.test`**: `/yolo` is in `COMMANDS`.
- **`ChatStatusBar` components test**: each mode renders its color.
- **`chat.tsx` flag parse** (or a small unit): `--permission-mode auto` → `initialMode:"auto"` + `base.permissionMode:"auto"`; invalid → `default`.
- **`useDaemon` console test**: `cyclePermissionMode` reaching `auto` issues a `setModel(resolveAutoModel(model))` control op before `set_permission_mode` (fake client captures the op order); reaching a non-auto mode issues no `setModel`.
- **Gated live e2e** (`ANTHROPIC_API_KEY`): open a session, enter `auto` (forced supported model), submit a prompt that makes a safe edit → assert the edit applied and **no** permission was requested (the broker/uiBroker saw nothing). Skips cleanly keyless.

## 8. Global constraints

- **NO Prettier** (dense hand-style); **ESM `.js` import specifiers**; bare `"cc-harness"` for engine imports in `tui/`.
- `resolveAutoModel`/`isAutoSupportedModel` stay pure (already are). The ladder/console changes add no new SDK coupling beyond the existing `setModel`/`setPermissionMode` surfaces.
- **Never mutate the shared `Composer.tsx` / console `App.tsx`.** The only public-API change is the two `autoModel` exports (advanced-seam): update `index.ts` + `index.test.ts` pin + `API-STABILITY.md` in the same change; **rebuild `harness/` before `tui/` typecheck** (the build-first rule) since `tui/` imports the new exports.
- **Generated/sync:** none beyond the index pin (no `ConfigToml`/app-server/hooks schema inputs touched).
- `ink useInput` timing discipline (await a render tick before keys; real escape sequences; never raw `stdin.on`; latest-ref where a handler reads state). Test files run sequentially (`tui/vitest.config.ts` `fileParallelism:false`).
- Live tests gate on `ANTHROPIC_API_KEY` from `CC-to-SDK/.env` (gitignored — never commit/print); keyless suites skip cleanly.
- Commit messages plain — no `Co-Authored-By` / attribution.
