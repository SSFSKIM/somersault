# Interactive Chat REPL + Inline Permission Prompts — Design Spec

**Status:** approved (brainstorm 2026-06-19) — ready for implementation plan
**Builds on:** Phase-3 increment 1 (`cc-harness top` monitor) + increment 2 (`cc-harness-console`, the
`cc-harness-tui` package). This is **Phase-3 increment 3**.
**Supersedes nothing.** Adds a new bin to the existing `cc-harness-tui` package + a small core seam.

## Goal

A standalone, in-process **Claude-Code-style chat REPL** for `cc-harness` (`cc-harness-chat`): a single
focused interactive coding session with **rich tool rendering** and **inline permission dialogs**, driven by
the lib `Session` (`openSession`) — single OS process, native `canUseTool`, no daemon, no wire.

## Scope decision (the foundational call)

The REPL targets the **in-process lib `Session` only**. The daemon-attached interactive-permission flow is a
distinct, harder problem (it needs a new bidirectional permission-request protocol over the daemon's
one-request-per-connection, no-push wire) and is **explicitly deferred to a future increment 4**.

**Why in-process:** the SDK's `canUseTool` is an `async` callback the SDK `await`s mid-turn. In a single
process the REPL renders a dialog and resolves that promise directly — the faithful Claude-Code experience,
buildable with **zero new wire surface**. The daemon path would have to park the callback in the daemon,
push a request frame out to an attached console, accept a decision over a new op, and resume — none of which
the daemon wire supports today. (See [[phase3-observability-dashboard-shipped]].)

## Locked decisions (from the brainstorm)

1. **Surface:** standalone in-process REPL over `openSession` (daemon-attached = increment 4).
2. **Default permission mode (corrected by probe 17d — see "Live-probe results"):** the REPL starts in
   **`default`** — *broker-live*, so the inline dialog fires on edits/dangerous ops **from the first turn**
   (reads + safe bash are auto-allowed by the SDK's built-in classifier). Toggling to **`bypassPermissions`**
   at runtime silences all prompts (verified broker-free). **NB: SDK `auto` is NOT a no-prompt mode** —
   probe 17d showed `auto` fires the broker on edits, behaving like `default`; only `bypassPermissions` is
   reliably silent. The two meaningful poles the mode-switch key exposes are **`default` (prompt) ↔
   `bypassPermissions` (silent)** (`acceptEdits`/`plan` also reachable via the cycler). Runtime switching is
   `session.setPermissionMode(...)`, as increment 2's console already exercised.
3. **Dialog choices:** **allow once · always-for-this-tool · deny.** "Always" is remembered for the
   session (by tool name) so the tool is not re-prompted.
4. **Rich rendering (targeted):** a generic structured renderer for **all** tools (name + key inputs +
   result/status), **plus bespoke** renderers for the highest-value few — **Write/Edit** as a colored diff,
   **Bash** as command + output, **Read** as a file ref. Assistant text + thinking shown.
5. **Packaging:** a new `cc-harness-chat` bin **inside** the existing `cc-harness-tui` package, reusing its
   ink/react/vitest setup and increment 2's `Composer`. The rich `render.ts` lives in `cc-harness-tui` so
   the increment-2 console *can* adopt it later (adoption itself is out of scope here — YAGNI).

## Architecture

Two layers, mirroring increment 2 (typed seam in core, ink in the package):

```
harness/src/permissions/      ← NEW core seam (UI-agnostic, DI-unit-tested)
  types.ts    PermissionDecision, PermissionBroker, PermissionRequest
  gate.ts     createPermissionGate(broker) → SDK CanUseTool + session allowlist
harness/src/config/
  types.ts    + permissionBroker?: PermissionBroker on HarnessConfig
  resolveOptions.ts   sets options.canUseTool = createPermissionGate(broker) iff broker supplied
harness/src/index.ts + test/unit/index.test.ts + API-STABILITY.md   ← export the seam (advanced-seam)

cc-harness-tui/src/           ← the REPL (a second bin in the existing package)
  useChat.ts        owns Session(auto) + transcript + streaming turn + permission state + mode + teardown
  render.ts         rich formatter (pure): generic + bespoke Edit/Write/Bash/Read
  Transcript.tsx    <Static> committed turns + live region for the in-flight turn
  PermissionDialog.tsx   renders the parked request; [a]/[A]/[d]
  ChatStatusBar.tsx model · permission mode · ctx% · key hints
  ChatApp.tsx       composition + focus routing (composer ↔ dialog) + mode-switch key
  chat.tsx          bin entry (cc-harness-chat → dist/chat.js)
  (reuse Composer.tsx from increment 2)

probes/probes/17{,b,c,d}-*.ts             ← pre-plan gate — DONE, ran keyed 2026-06-19 (see "Live-probe results")
```

### Why the policy lives in core (Approach A)

The allowlist short-circuit and the decision→`PermissionResult` mapping are **pure policy** — they belong in
core where they are unit-testable with a fake broker and **zero ink**. The `PermissionBroker` interface is
also exactly what increment 4 will reuse (the daemon will implement the same interface over the wire). The
ink layer stays thin: it only renders the request and resolves the deferred.

## Component 1 — the core permission seam

### Types (`permissions/types.ts`)

```ts
export type PermissionDecision =
  | { kind: "allow_once" }
  | { kind: "allow_always" }   // remembered for the session, by tool name
  | { kind: "deny" };

/** What the broker is asked to decide. Carries the SDK's UI hints when present (often absent headlessly —
 *  the bridge that renders title/displayName is claude.ai-coupled), so consumers MUST be able to render
 *  from toolName + input alone. */
export interface PermissionRequest {
  toolName: string;
  input: Record<string, unknown>;
  toolUseID: string;
  title?: string;        // e.g. "Claude wants to read foo.txt" — use if present, else reconstruct
  displayName?: string;  // e.g. "Read file"
  description?: string;
  signal: AbortSignal;
}

export interface PermissionBroker {
  request(req: PermissionRequest): Promise<PermissionDecision>;
}
```

### Gate (`permissions/gate.ts`)

`createPermissionGate(broker): CanUseTool` returns a callback matching the SDK's `CanUseTool` type
`(toolName, input, options) => Promise<PermissionResult>`. Behavior per call:

1. If `toolName` ∈ the gate's private `allowed` Set → return `{ behavior: "allow", updatedInput: input }`
   **immediately** (no broker call). The SDK invokes the gate on every tool call in broker-live modes; the
   gate — not the SDK's permission persistence — is the source of truth for "always".
2. Else build a `PermissionRequest` from `(toolName, input, options.title, options.displayName,
   options.description, options.toolUseID, options.signal)` and `await broker.request(req)`:
   - `allow_once`  → `{ behavior: "allow", updatedInput: input }`
   - `allow_always` → `allowed.add(toolName)`, then `{ behavior: "allow", updatedInput: input }`
   - `deny`        → `{ behavior: "deny", message: \`User denied ${toolName}\` }`
3. If `options.signal` is already aborted, or aborts while awaiting (turn interrupted), the gate resolves to
   **deny** (`{ behavior: "deny", message: "interrupted", interrupt: true }`) — never hangs the SDK await.

The Set is created per `createPermissionGate` call → one allowlist per session. No dependence on the SDK's
`updatedPermissions`/`suggestions` machinery (its headless reachability is unverified). Passing
`updatedPermissions: options.suggestions` on `allow_always` is a possible **future** enhancement gated on a
probe; v1 uses the gate's own Set.

### Config wiring (`config/types.ts`, `config/resolveOptions.ts`)

- `HarnessConfig` gains `permissionBroker?: PermissionBroker`.
- `resolveOptions(config)` sets `options.canUseTool = createPermissionGate(config.permissionBroker)` **only
  when** `config.permissionBroker` is present (otherwise leaves `canUseTool` unset — preserving every
  existing caller's behavior, including the daemon, which doesn't use `resolveOptions`).
- `openSession(config)` already flows through `resolveOptions` and passes the resulting options straight to
  `query()` (verified in `session/index.ts` + `session/session.ts`), so no Session change is needed — the
  gate rides through as `options.canUseTool`.

## Component 2 — the REPL package

### `useChat` hook

Owns one in-process `Session` (`openSession({ model, permissionBroker, contextTool: true }, ...)`), started
in `auto`. Responsibilities:
- **Transcript:** an append-only list of committed turn renderings + the current streaming turn.
- **Submit a turn:** `session.stream(prompt)` (or `submit` with an onMessage), feeding each SDK message
  through `render.ts` into the live region; on the terminal result, commit the turn to the transcript.
- **Be the ink `PermissionBroker`:** `request(req)` parks a deferred and sets a single `pendingPermission`
  state `{ req, resolve }`. Only one is ever pending (the SDK awaits the gate before the next tool).
- **Permission mode:** track current mode; a mode-switch action calls `session.setPermissionMode(mode)`.
- **Teardown (idempotent):** a `disposed` ref guards every async `setState`; on unmount/quit, **settle any
  parked deferred → `{ kind: "deny" }`** then `session.dispose()`; a second teardown is a no-op.

### Components

- **`<Transcript>`** — ink `<Static>` for committed turns (so they scroll into native scrollback) + a live
  `<Box>` for the in-flight turn.
- **`<PermissionDialog>`** — renders `pendingPermission`: a prompt line (from `req.title` if present, else
  reconstructed `⚙ <toolName> <key-args>`), then `[a] allow once · [A] always (<tool>) · [d] deny`.
  `useInput` is active only while a request is pending; `a`/`A`/`d` call `resolve(decision)` and clear state.
- **`<ChatStatusBar>`** — model · permission mode · ctx% (computed `round(total/max*100)`, guard `max>0`) ·
  context-sensitive key hints.
- **`<ChatApp>`** — composes Transcript + Composer + (gated) PermissionDialog + StatusBar; routes focus
  (composer input vs. dialog) so exactly one `useInput` block is active; binds a mode-switch key and an
  interrupt key (Esc → `session.interrupt()`).
- **Reuse** increment 2's `Composer.tsx` (TextInput prompt line).

### `render.ts` — the rich formatter (pure, UI-agnostic)

Maps an SDK message → renderable line structures (data, not ink), so it is unit-testable without a renderer:
- **assistant text** → verbatim lines; **thinking** → dimmed lines.
- **tool_use** → bespoke when recognized, else generic:
  - **Write/Edit** → a colored unified diff (old/new), header `⚙ Edit <path>`.
  - **Bash** → `⚙ Bash <cmd>` + indented output lines + a status line.
  - **Read** → `⚙ Read <path> (<n> lines)`.
  - **generic fallback** → `⚙ <Name>(<first key arg, truncated>)` + a compact result/status line.
- **tool_result** → attached to its tool_use (unlike increment 2's `format.ts`, which dropped results).

This is a **superset** of increment 2's `format.ts`; the console may adopt it later (not in this increment).

### `chat.tsx` (bin entry)

Parses args (`--model`, `--cwd`, optional `--resume <sessionId>` via `resumeSession`), constructs the
`useChat`-backing `Session`, renders `<ChatApp>`. `package.json` gains bin `cc-harness-chat → dist/chat.js`.

## Permission data-flow

1. **default mode (startup, broker-live)** → reads + safe bash auto-allowed (silent); an **Edit/Write or
   dangerous op** → SDK calls the gate.
2. gate: tool not in `allowed` → `broker.request(req)` parks a deferred + sets `pendingPermission`.
3. `<PermissionDialog>` renders (prompt **reconstructed from `toolName`+`input`** — UI hints absent
   headlessly). User presses `a`/`A`/`d`.
4. keypress → `resolve(decision)` → gate maps to `PermissionResult` → SDK proceeds (runs/skips the tool);
   `A` adds the tool to `allowed`, suppressing its next prompt.
5. **mode-switch key** → cycles `default ↔ bypassPermissions` via `session.setPermissionMode(...)`; in
   `bypassPermissions` the gate is never consulted → no dialogs.
6. **interrupt/quit while pending** → teardown settles the deferred → deny (SDK await never hangs).

## Liveness & teardown discipline

This is the recurring parked-promise bug class ([[teardown-liveness-review-pattern]]). Requirements, with
tests written up front:
- **One pending request at a time** (SDK serializes via awaiting the gate) — assert a second tool can't open
  a second dialog while one is pending.
- **Interrupt settles pending → deny** and clears `pendingPermission`.
- **Unmount/quit settles pending → deny**, disposes the Session, and is **idempotent** (second teardown is a
  no-op — assert the deferred is resolved exactly once and `dispose` called at most once).
- **`disposed` ref guards every async `setState`** — no state update after unmount.

## Live-probe results (RAN 2026-06-19, keyed — `probes/probes/17*.ts`)

Per the live-probe-first discipline (the A1 lesson), the `canUseTool` contract was probed live against SDK
0.3.178 **before this spec was finalized** (`17-canusetool-contract.ts`, `17b-canusetool-settingsources.ts`,
`17c-canusetool-edit-gated.ts`, `17d-mode-broker-table.ts`). The probes flipped two premises — exactly what
the discipline exists to catch. Verified:

1. **Broker fires in `default`/`auto` for mutations** (Edit/Write), deterministic across runs. **Reads + safe
   bash** (`echo`-class) are auto-allowed by the SDK's built-in classifier and bypass the broker. **Read-gating
   is non-deterministic** (sometimes routes, sometimes not) — the design must not assume reads never prompt.
2. **UI hints absent headlessly** — the `options` payload carried **no** `title`/`displayName`/`description`/
   `suggestions` (the bridge that renders them is claude.ai-coupled). → the dialog **reconstructs the prompt
   from `toolName`+`input`** (as the design already specifies).
3. **Return shapes work:** `{behavior:"allow", updatedInput}` allows; `{behavior:"deny", message}` **denies
   safely** — a denied Edit left the file `ORIGINAL` and the turn completed `subtype=success`, no crash.
4. **Mode×broker table (Edit op, 2/2 deterministic):** `bypassPermissions` = silent · `acceptEdits` = silent
   on edits (but fired for Read) · `default` = fires · **`auto` = fires**. So `auto` is **NOT** a no-prompt
   mode (flips spec decision #2, and corrects [[sdk-permissionmode-canusetool-matrix]] which claimed
   "auto/bypass replace canUseTool" — true for `bypass`, false for `auto`). → REPL default = `default`
   (broker-live); `bypassPermissions` is the silence toggle.
5. `session.setPermissionMode` is the runtime mode lever (verified previously; increment 2's console
   exercises it).

These results are baked into Decision #2, the gate behavior, and the data-flow above. No premise remains
unverified going into the plan.

## Test plan

- **Core (DI, keyless)** — `permissions/gate.test.ts`: maps `allow_once`/`allow_always`/`deny` →
  `PermissionResult`; allowlist short-circuit (allowlisted tool returns allow without calling the broker);
  pre-aborted + mid-await abort → deny. `resolveOptions` test: `canUseTool` set iff `permissionBroker`
  present.
- **TUI (ink-testing-library, keyless)** — `chat.test.tsx`: a turn streams through a fake `QueryFn` → renders
  in the transcript; mode-switch key calls `setPermissionMode`; a tool in broker-live mode surfaces
  `<PermissionDialog>`; `a`/`A`/`d` resolve correctly; `A` suppresses the next prompt for that tool; teardown
  settles a pending request → deny. `render.test.ts`: Edit diff, Bash cmd+output, Read ref, generic fallback.
  **Carry the increment-2 timing lesson:** `useInput` subscribes in a passive effect — `await` rendered
  state (`waitFor`/`pressUntil`) before writing keys; single-press non-idempotent actions.
- **One gated live e2e** — `test/live/chat.e2e.test.ts` (`describe.skip` without `ANTHROPIC_API_KEY`): a real
  `Session` in `default` mode with a programmatic broker that auto-allows; a prompt that triggers a tool;
  assert the turn completes and the tool is rendered.
- **Index pin** — `test/unit/index.test.ts` EXPECTED array + `API-STABILITY.md` updated.

## Public API delta (advanced-seam tier)

New exports from `cc-harness`:
- `PermissionBroker`, `PermissionDecision`, `PermissionRequest` (types)
- `createPermissionGate` (value)
- `permissionBroker?` config field on `HarnessConfig` (and therefore `OpenSessionConfig`)

`index.test.ts` EXPECTED gains the new names; `API-STABILITY.md` gets advanced-seam rows. No existing export
changes shape (purely additive).

## File manifest

**Create (core):** `permissions/types.ts`, `permissions/gate.ts`, `test/unit/permissions.gate.test.ts`
**Modify (core):** `config/types.ts`, `config/resolveOptions.ts`, `index.ts`, `test/unit/index.test.ts`,
`API-STABILITY.md`, (extend) the resolveOptions test
**Create (tui):** `src/useChat.ts`, `src/render.ts`, `src/Transcript.tsx`, `src/PermissionDialog.tsx`,
`src/ChatStatusBar.tsx`, `src/ChatApp.tsx`, `src/chat.tsx`, `test/render.test.ts`, `test/chat.test.tsx`,
`test/live/chat.e2e.test.ts`
**Modify (tui):** `package.json` (add bin), `CLAUDE.md` (document the second bin)
**Probes (DONE — created + run keyed 2026-06-19):** `17-canusetool-contract.ts`,
`17b-canusetool-settingsources.ts`, `17c-canusetool-edit-gated.ts`, `17d-mode-broker-table.ts`
**Update on ship:** `docs/parity/coverage.md` Domain 10; the parity memory.

## Out of scope / future

- **Increment 4** — daemon-attached interactive permissions (the bidirectional wire fork).
- **Finer allowlist granularity** — per-command (e.g. per-Bash-command) "always," vs. v1's per-tool-name.
- **Deny-with-feedback** — denying with a typed reason injected as guidance into the turn.
- **Console adoption of the rich `render.ts`** — available but not wired here.
- **Slash-command parity** beyond the essentials (mode switch, interrupt); `/compact`, model switch, rewind
  may follow but are not required for v1.
