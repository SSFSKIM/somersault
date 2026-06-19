# Daemon-Attached Interactive Permissions (Chat REPL increment 4) — Design

**Goal:** Give daemon-owned sessions a least-human-gated autonomy loop — `auto` mode on a
supported model, with the classifier as the sole gate — plus a thin poll-based escape-hatch wire
that gives any *non-autonomous* daemon session a human-in-the-loop path (closing the current
auto-deny gap), reusing the increment-3 `PermissionDialog`.

**Status:** design agreed in brainstorm 2026-06-19 (scope, model-gating, no-ask-rules, Approach B
all locked with the user). Probe-validated premises below.

---

## Context & grounding

The 18-series live probes (committed `3d104efd1b`, `c37fb61ae0`, `63ee26da00`) establish:

- **`auto` is the headless AI-classifier mode, but MODEL-GATED** — only on Opus 4.6+ / Sonnet 4.6.
  On an unsupported model (haiku, Sonnet 4.5, Opus 4.5, claude-3) `auto` silently falls back to
  `default`. (Probes 18/18b/18c were a haiku-fallback artifact; **18d** on sonnet-4-6 flipped the
  result: `auto` auto-approved a working-dir edit with no human in the loop where `default` blocked
  it.)
- **`canUseTool` composes with `auto`** (probe **18g**): the classifier owns the trusted surface
  (broker silent on a cwd edit) and an `ask` rule routes its tools to `canUseTool`. So `canUseTool`
  is the human seam, and in `auto` it fires **only** for `ask`-rule matches.
- **The classifier guards agent escalation / injection, not explicit human commands** (probe 18h:
  `auto` ran an explicit external `curl|bash`). An autonomy loop is *agent-initiated*, so the
  classifier's blocked-by-default gate (`curl|bash`, exfil, prod deploys, force-push `main`) is the
  matching guard — which is why no custom deny floor is needed for v1.

The daemon as it exists today (mapped 2026-06-19):

- Transport: **Unix Domain Socket, NDJSON, one-op-per-connection** (`harness/src/daemon/server.ts`).
  The channel is **client-request → daemon-response only**; the daemon cannot push an unsolicited
  message and await a reply.
- **Daemon-owned sessions have NO permission broker wired** (`supervisor.makeSession` →
  `DaemonSession` builds options with no `permissionBroker`). So any gated tool a daemon session hits
  today is effectively **auto-denied** — default-mode daemon sessions cannot perform gated mutations.

This increment fixes that gap and adds the autonomy posture on top.

---

## Scope

**Layer A — Autonomy posture (mostly config).** A daemon session is *autonomous* when its
`permissionMode` is `auto` on a supported model. With **no `ask` rules**, `canUseTool` never fires
and the classifier is the sole gate → zero human prompts. This is the shipped least-gated loop.

**Layer B — Escape-hatch wire (poll-based, "Approach B").** The missing daemon broker + a
server-side pending registry + two one-shot ops, surfaced through the console's existing 1 s poll.
In the shipped product this fires for **`default`-mode** daemon sessions (the broker-gap fix) and
is a latent safety valve; the autonomy loop does not use it.

**In scope:** autonomy posture + supported-model enforcement; the daemon permission broker + pending
registry; two wire ops + `DaemonClient` methods; snapshot/poll integration; console
`PermissionDialog` integration (reuse increment-3 component); the four teardown-liveness behaviors;
one gated live test; the open-Q-b validation probe.

**Out of scope (future increments):** `ask` rules in the default config; a persistent real-time
permission channel (Approach A); trusted-infrastructure `autoMode.environment` config
(auto-mode-config doc); Bedrock/Vertex/Foundry `CLAUDE_CODE_ENABLE_AUTO_MODE` provider handling
(v1 targets the Anthropic API); a daemon-attached variant of `cc-harness-chat` (v1 client is the
existing `cc-harness-console`).

---

## Locked decisions

1. **Scope = auto-autonomy core + thin escape-hatch wire** (not wire-first, not autonomy-only).
2. **Approach B — poll-based pseudo-push.** Keep one-op-per-connection; add a server-side pending
   registry + two one-shot ops; the console's existing poll surfaces parked requests. No persistent
   bidirectional channel.
3. **Force a supported model when `auto` is requested.** Unsupported/absent model → force
   `claude-sonnet-4-6` (`DEFAULT_AUTO_MODEL`); log a warning.
4. **No custom deny floor; rely on `auto`'s built-in deny gate.** `deny` rules remain available as a
   future hard backstop but are not part of v1.
5. **No `ask` rules in the shipped autonomy posture.** Autonomous sessions therefore have zero
   human-in-the-loop; the classifier is the sole gate. The wire still honors `ask` rules if a user
   ever sets one, but the product ships none.
6. **Timeout-deny default 30 s** for a parked request with no answer (configurable). No persistent
   connection means there is no disconnect event — a missing client just lets the park time out.
7. **v1 client = `cc-harness-console`** (the existing daemon-attached Ink console), reusing the
   increment-3 `PermissionDialog`.

---

## Architecture & components

### Layer A — autonomy posture

| Module | Change |
| --- | --- |
| `harness/src/config/autoModel.ts` *(new, small)* | `DEFAULT_AUTO_MODEL = "claude-sonnet-4-6"`; `isAutoSupportedModel(model: string): boolean` (Opus `4-6`/`4-7`/`4-8`, Sonnet `4-6`); `resolveAutoModel(model?: string): string` → the model if supported, else `DEFAULT_AUTO_MODEL`. |
| `harness/src/daemon/types.ts` | `spawnOp` gains optional `permissionMode?: PermissionMode`. |
| `harness/src/daemon/supervisor.ts` | On spawn (or `set_permission_mode` → `auto`): if `permissionMode === "auto"`, set the session model via `resolveAutoModel(...)` (forcing a supported model); log when overriding. |

Enabling autonomy: `spawn({ permissionMode: "auto" })` (model auto-forced), or the **existing**
`set_permission_mode` control frame switched to `auto` (which additionally upgrades the model via the
SDK `setModel` control if the running model is unsupported, else warns).

### Layer B — escape-hatch wire

| Module | Change |
| --- | --- |
| `harness/src/daemon/permissions.ts` *(new, small)* | `PendingPermissions` registry + `DaemonPermissionBroker implements PermissionBroker`. `request(req)` adds `{toolUseID, sessionId, entry, resolve}` to the registry and returns a `Promise<PermissionDecision>` that settles on answer / timeout / session-stop. |
| `harness/src/daemon/supervisor.ts` | Owns one `PendingPermissions` registry; ensures every daemon session runs with `canUseTool = createPermissionGate(<session-bound DaemonPermissionBroker>)` — wired through the existing `permissionBroker`→`resolveOptions` seam if the daemon session-construction path runs it, else `createPermissionGate` applied directly to the session's SDK options (the implementer verifies which in Task 1); deny-resolves a session's pending on stop/shutdown. |
| `harness/src/daemon/types.ts` | Add `pendingPermissionsOp` (`{op:"pending_permissions"}`) and `permissionResponseOp` (`{op:"permission_response", toolUseID, decision}`) to the `daemonOp` union; add the serializable `PendingEntry` type and re-export `PermissionDecision`. |
| `harness/src/daemon/server.ts` | Dispatch the two new ops against the supervisor's registry. |
| `harness/src/daemon/connect.ts` | `DaemonClient.pendingPermissions(): Promise<PendingEntry[]>` and `respondPermission(toolUseID, decision): Promise<void>`. |
| `harness/src/monitor/snapshot.ts` | `collect()` also calls `pendingPermissions()`; `DashboardSnapshot` gains `pending: PendingEntry[]`. |
| `tui/src/useDaemon.ts` | Surface `snapshot.pending`; add a `respond(toolUseID, decision)` action calling `client.respondPermission`. |
| `tui/src/App.tsx` | When `pending` is non-empty, render the reused `PermissionDialog` for the first entry and gate key input (as the chat REPL did in increment 3). |
| `tui/src/PermissionDialog.tsx` | Reused as-is (already shared in `tui/src/`). |

The broker reuses `createPermissionGate` (its `allow_always` per-session allowlist already works).
The registry key is the globally-unique `toolUseID`.

### Wire types

```ts
// serializable PermissionRequest (no AbortSignal)
export interface PendingEntry {
  sessionId: string;
  toolUseID: string;
  toolName: string;
  input: Record<string, unknown>;
  title?: string;
  displayName?: string;
  description?: string;
  createdAt: number;
}
// daemonOp additions
{ op: "pending_permissions" }                                  // → { ok: true, pending: PendingEntry[] }
{ op: "permission_response", toolUseID: string, decision: PermissionDecision } // → { ok: true } | { ok: false, error }
```

---

## Data flow

**Happy path (autonomous, zero prompts):**
```
spawn({permissionMode:"auto"}) → supervisor forces sonnet-4-6 if needed, wires daemon broker
submit(id, goal) → agent works → classifier auto-approves reads/cwd-edits/trusted ops
                 → canUseTool never fires (no ask rules) → registry empty → 0 prompts
```

**Escape-hatch path (default-mode session, or any canUseTool fire):**
```
agent hits a gated tool → SDK calls canUseTool → createPermissionGate → broker.request(req)
  → registry.add(...); returns a Promise (turn parked)
console poll (≤1s) → pending_permissions → snapshot.pending → App renders PermissionDialog (input gated)
human a/A/d → respondPermission(toolUseID, decision) → server resolves the parked Promise
  → gate maps to {behavior:"allow"|"deny"} → SDK resumes the turn → submit stream continues
```

---

## Error handling — every way a park can end

- **No client / no answer → timeout-deny** (default 30 s, configurable). The loop continues, refusing
  just that op. An unattended daemon never hangs.
- **Session stop / daemon shutdown while parked → deny-resolve** all that session's pending entries,
  so the awaited `canUseTool` promise never leaks or hangs (teardown-liveness).
- **Turn interrupt while parked → deny.** `createPermissionGate`'s existing `requestOrAbort` races
  broker-vs-abort; reused unchanged.
- **Multi-client → first answer wins, idempotent.** The entry is removed on the first
  `permission_response`; later responses for that `toolUseID` return `{ok:false, error:"no pending request"}`.
- **Stale answer (already timed out) → `{ok:false}` no-op.**
- **Unsupported model + `auto` → force `claude-sonnet-4-6`** (warn).
- **`allow_always`** adds the tool to the gate's per-session allowlist; repeats skip the broker.

---

## Testing strategy

**Unit (keyless, `harness/test/unit/`):**
- **Broker park/resume — the four teardown-liveness tests:** park→`respondPermission` resolves with
  the decision; park→**timeout** resolves `deny`; park→**session-stop** deny-resolves; **multi-answer**
  idempotency (2nd response → `{ok:false}` no-op). Plus `PendingEntry` serialization omits the
  `AbortSignal`.
- **Supported-model enforcement:** `isAutoSupportedModel()` truth table; `resolveAutoModel("haiku")`
  → `sonnet-4-6`; `auto` + no model → `sonnet-4-6`; `auto` + supported → preserved; non-`auto` →
  model untouched.

**Wire round-trip (keyless):** `pending_permissions` + `permission_response` through `connectDaemon`
with a fake `request` fn (no socket) — asserts op shapes + the two new `DaemonClient` methods.

**Console (ink-testing-library, keyless):** a snapshot carrying a pending entry → `App` renders
`PermissionDialog` and gates input; `a`/`A`/`d` call `respondPermission(toolUseID, …)`. Carries the
**ink `useInput` passive-effect timing discipline** (await rendered state before keypress).

**Gated live (`ANTHROPIC_API_KEY`, skips cleanly without):**
- *Wire end-to-end:* spawn a **`default`-mode** daemon session on `sonnet-4-6`; submit a prompt that
  edits a file; poll surfaces a pending entry; `respondPermission` allow; assert the edit applied and
  the turn completed.
- *Autonomy:* spawn an **`auto`** session on `sonnet-4-6`; submit the same edit; assert **no** pending
  entry appears and the edit applies unattended (classifier auto-approved).

**open-Q-b validation probe (`probes/probes/19-auto-repeated-block-abort.ts`, run FIRST):**
characterize whether a long-lived `auto` session **aborts after repeated classifier blocks** (the
documented 3-consecutive / 20-total `-p` fallback) by inducing agent-initiated blocks (e.g. a `deny`
rule the agent keeps hitting). **Success = we learn the behavior and pick the daemon's reaction:** if
it aborts, the supervisor catches it and surfaces a restart/notice via its existing `restart`
machinery; if a persistent `query()` does not abort headless, simpler still. Characterize-and-react,
not a blocker — in a least-gated loop genuine classifier blocks are rare and arguably should
halt-and-surface.

---

## Module-size & convention notes

New modules (`autoModel.ts`, `permissions.ts`) are small and single-purpose. No Prettier; dense
hand-style; ESM `.js` import specifiers; bare `"cc-harness"` for core imports from `tui/`. The
`cc-harness` public surface gains `PendingEntry` + the two `DaemonClient` methods — pin them in
`harness/test/unit/index.test.ts` and note them in `API-STABILITY.md`. Refresh
`docs/parity/coverage.md` (Domain 10) on completion.
