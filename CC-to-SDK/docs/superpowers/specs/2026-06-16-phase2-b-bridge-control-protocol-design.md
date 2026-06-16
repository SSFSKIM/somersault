# Phase 2 B — Bridge (Control-Request Protocol) — Design

**Date:** 2026-06-16
**Status:** Approved (design); pending spec review → implementation plan
**Phase:** Phase 2, track **B** (Bridge), parity cluster **34-mode-bridge**.
**Working dir:** `CC-to-SDK/harness/`
**Inputs:** parity row **34.3** (the one buildable Phase-2 row in cluster 34); the D1–D3 `DaemonSupervisor`/
`DaemonSession`/UDS-NDJSON transport; the A2c `setMode` precedent (guarded `q.setPermissionMode`).

> **Reinterpretation.** Cluster 34's claude.ai Remote-Control relay, trusted-device enrollment, and
> session-ingress JWT auth (34.1/34.2/34.4) are 🚫 not-possible (Anthropic-hosted, claude.ai-internal).
> 34.5 (safe-commands allowlist) is P3 and meaningless without a remote UI — deferred. B builds **only
> 34.3**: the transport-agnostic glue that translates inbound *control frames* into the SDK Query's
> runtime control methods on a live streaming session.

---

## 1. Goal

A **control-plane** over a live streaming session, orthogonal to the daemon's data-plane (submit → stream).
A driver can retune an in-flight session: switch model, change permission mode, adjust the thinking budget,
or interrupt a runaway turn — by sending a control frame that the bridge translates to the matching
`Query` method.

## 2. Premise & scope — verified against the live SDK

`query()` returns a `Query` that extends `AsyncGenerator<SDKMessage>` **and** carries the control methods
(`sdk.d.ts:2242`) — so the message stream and the control handle are the same object. Confirmed present:
`setModel(model?)` (2266), `setPermissionMode(mode)` (2259), `setMaxThinkingTokens(n, display?)` (2289),
`interrupt()` (2252), and the handshake getters `supportedModels()` (2329), `supportedCommands()` (2323),
`mcpServerStatus()` (2341). A2c already live-proved `setPermissionMode`/`interrupt`/`setModel` on a
streaming session, and the daemon's `setMode` already calls `q.setPermissionMode` guarded — so the design
rests on confirmed **can-do** facts.

Two SDK facts that shape the design:
- **Setters, not getters.** There is no "what model/mode am I?" call — only `setModel`/`setPermissionMode`.
  So `initialize` reports the *menu* (`supportedModels`/`supportedCommands`/`mcpServerStatus`) and the
  harness tracks current state itself (the daemon's `SessionRecord` already holds `model`).
- **`supportedCommands()` is captured once at init and goes stale mid-session** (`sdk.d.ts:2755`). Only
  relevant to 34.5 (deferred); `initialize` returns the init-time list and does not promise freshness.

**In scope (B):** a `src/bridge/` core — the control-frame protocol (zod union) + a `ControlBridge` that
translates a frame into a `ControllableSession` method call and returns a structured response — plus a thin
daemon binding (a `control` op; `DaemonSession` implements `ControllableSession`).
**Deferred / out of scope:** 34.5 safe-commands allowlist (P3, UI-coupled); non-daemon transports (WS/SSE)
— the core is transport-agnostic so they can bind later, but B ships only the daemon binding.
**Non-goals:** the claude.ai relay/control-plane, device enrollment, session-ingress JWT (34.1/34.2/34.4,
🚫); a remote UI; persisting control state across restarts.

## 3. Architecture — Option C (bridge core + daemon binding)

```
src/bridge/ (NEW)
  types.ts    controlFrame = zod discriminatedUnion("type"):
                | { type:"initialize" }
                | { type:"set_model", model?: string }
                | { type:"set_permission_mode", mode: PermissionMode }
                | { type:"set_thinking", maxTokens: number | null }
                | { type:"interrupt" }
              ControllableSession (interface):
                setModel?(model?): Promise<void>
                setPermissionMode?(mode): Promise<void>
                setMaxThinkingTokens?(n: number | null): Promise<void>
                interrupt?(): Promise<void>
                capabilities(): Promise<{ models: unknown[]; commands: unknown[]; mcpServers: unknown[] }>
              ControlResponse = { ok:true, ...payload } | { ok:false, error:string }

  control.ts  ControlBridge.apply(session, frame) → ControlResponse
                - feature-detects the target method; missing → { ok:false, error:"unsupported: <m>" } (never throws)
                - initialize → { ok:true, ...(await session.capabilities()) }
                - set_*/interrupt → await the method → { ok:true }

src/daemon/ (EXTEND)
  session.ts    DaemonSession implements ControllableSession — guarded delegations to its Query
                (cast `this.q` to the control shape; reject set_* / interrupt when `ended`);
                capabilities() calls the three getters (guarded; absent → []).
  types.ts      daemonOp += controlOp { op:"control", id, frame: controlFrame }
  server.ts     route "control" → supervisor.control(op.id, op.frame) → send the ControlResponse
  supervisor.ts control(id, frame): look up the pooled session (DaemonError if missing/dead) →
                ControlBridge.apply(session, frame)
```

The control op is **one-op-per-connection** like every daemon op, so a driver sends `interrupt` on a second
connection while a `submit` streams on the first — interrupt-during-turn needs no extra plumbing.

## 4. Modules

| File | Change |
|---|---|
| `src/bridge/types.ts` *(new)* | `controlFrame` zod union; `ControllableSession` interface; `ControlResponse` type. The `set_permission_mode` frame uses `z.enum(["default","acceptEdits","bypassPermissions","plan","dontAsk","auto"])` (the full SDK `PermissionMode`, `sdk.d.ts:2055`); the bridge translates faithfully and does not restrict the set (the driver owns the consequence of e.g. `"plan"` on a session with no `canUseTool`). |
| `src/bridge/control.ts` *(new)* | `ControlBridge.apply(session, frame): Promise<ControlResponse>` — pure translation, feature-detect + guard, no transport, no throw. |
| `src/bridge/index.ts` *(new)* | re-exports. |
| `src/daemon/session.ts` *(mod)* | `DaemonSession implements ControllableSession`; guarded control delegations to `this.q` (the `Query`); `capabilities()`; reject set_*/interrupt when `ended`. |
| `src/daemon/types.ts` *(mod)* | add `controlOp` to the `daemonOp` discriminated union; import `controlFrame`. |
| `src/daemon/server.ts` *(mod)* | `case "control"` → `await this.supervisor.control(op.id, op.frame)` → `send(response); sock.end()`. |
| `src/daemon/supervisor.ts` *(mod)* | `async control(id, frame)`: pooled-session lookup (`DaemonError` if missing/dead) → `ControlBridge.apply`. |

No client.ts change required (the existing `daemonRequest` sends any op and returns response lines); a
typed convenience wrapper is optional, not required for B.

## 5. The translation core

```
async apply(session: ControllableSession, frame: ControlFrame): Promise<ControlResponse> {
  switch (frame.type) {
    case "initialize":           return { ok: true, ...(await session.capabilities()) };
    case "set_model":            return call(session.setModel, "setModel", session, frame.model);
    case "set_permission_mode":  return call(session.setPermissionMode, "setPermissionMode", session, frame.mode);
    case "set_thinking":         return call(session.setMaxThinkingTokens, "setMaxThinkingTokens", session, frame.maxTokens);
    case "interrupt":            return call(session.interrupt, "interrupt", session);
  }
}
// call(): if typeof method !== "function" → { ok:false, error:`unsupported: ${name}` };
//         else try { await method.call(session, ...args); return { ok:true }; }
//         catch (e) { return { ok:false, error:(e as Error).message }; }
```

`DaemonSession` control delegations (illustrative):

```
async setModel(model?: string) { this.assertRunning(); await (this.q as any).setModel?.(model); }
async interrupt()              { await (this.q as any).interrupt?.(); }   // safe even if idle/ended
async capabilities() {
  const q = this.q as any;
  const [models, commands, mcpServers] = await Promise.all([
    q.supportedModels?.() ?? [], q.supportedCommands?.() ?? [], q.mcpServerStatus?.() ?? [],
  ]);
  return { models, commands, mcpServers };
}
// assertRunning(): if (this.ended) throw new Error(`session ${this.id} is not running`);
```

`interrupt` deliberately does **not** assert-running (interrupting an already-finished turn is a benign
no-op); the state-mutating setters do (changing the model of a dead session is meaningless).

## 6. Error handling

- Unknown/malformed frame → rejected at the `daemonOp`/`controlFrame` zod boundary (the server's existing
  `bad request` path), never reaching the bridge.
- Each target method is feature-detected; absent → `{ ok:false, error:"unsupported: <method>" }` (defensive
  against SDK shape drift and against fake/partial sessions). The bridge never throws.
- `control` on a missing/dead session → `DaemonError` from `supervisor.control` (same shape as `submit`).
- A method that throws (e.g. `setModel` rejects an unknown model id) → caught → `{ ok:false, error }`.

## 7. Verification

- **Unit (no network, fake `ControllableSession` capturing calls):**
  - each frame routes to the right method with the right args (`set_model "x"` → `setModel("x")`;
    `set_thinking 0` → `setMaxThinkingTokens(0)`; `set_permission_mode "plan"` → `setPermissionMode("plan")`;
    `interrupt` → `interrupt()`).
  - `initialize` → `{ ok:true, models, commands, mcpServers }` from `capabilities()`.
  - a session missing a method → `{ ok:false, error:"unsupported: <m>" }` (bridge does not throw).
  - a method that rejects → `{ ok:false, error:<message> }`.
  - `supervisor.control` on an unknown id → `DaemonError`; `DaemonSession` setters reject when `ended`,
    `interrupt` resolves when `ended`.
- **Live (one test, gated on `ANTHROPIC_API_KEY`):** spawn a daemon session; send `initialize` and assert
  non-empty `models` (and a `commands` array); send `set_model` (to a known model) and `set_thinking`,
  asserting `{ ok:true }`; start a long `submit` on one connection and send `interrupt` on another, asserting
  the turn stops (the streamed result returns / no hang). Proves the control-plane drives a real Query
  end-to-end and is concurrent with the data-plane.

## 8. Success criteria

- A driver can `initialize` (read the model/command/mcp menus) and `set_model` / `set_permission_mode` /
  `set_thinking` / `interrupt` a live daemon session over the existing UDS-NDJSON transport.
- The `src/bridge/` core is transport-agnostic and unit-testable with a fake session (no daemon, no
  network); the daemon is one binding.
- `interrupt` on a second connection stops an in-flight `submit` on the first.
- Unsupported/absent methods and dead sessions produce structured errors, never throws/hangs.
- D1–D3 behavior is unchanged when no `control` op is sent.
- `tsc --noEmit` clean; `vitest` green (all prior + new bridge tests); no secret committed; the SDK
  control-surface verification (methods present, setters-not-getters, stale-commands caveat) is documented.
