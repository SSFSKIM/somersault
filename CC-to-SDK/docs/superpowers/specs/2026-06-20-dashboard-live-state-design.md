# Increment C — Dashboard Live State (design)

**Status:** approved (2026-06-20) · **Surface:** `cc-harness-console` (daemon console) + a small `cc-harness` daemon change
**Audit findings closed:** #6 (m-cycle bug), #2 (per-session permission mode), #4 (richer Detail pane), #5 (proactive visibility)

## Goal

Make the daemon console dashboard **mirror live per-session state**: fix model cycling, and surface the
live model, permission mode, context/token usage, session age, and proactive state in the Pool + Detail
panes. One sentence: *close the control→display loop the dashboard is currently missing.*

## Background — the A1 reversal (why this isn't a "supportedModels" fix)

The original audit (Feb-snapshot reasoning) diagnosed #6 as *"`supportedModels()` returns empty headless."*
Live probing flipped that premise **twice**:

- **Probe 27** (`probes/probes/27-supported-models-headless.ts`): `supportedModels()` returns a rich 6-model
  list headless — but the raw-`query()` path needed one turn pumped first to wake the control channel.
- **Probe 29** (`probes/probes/29-pre-turn-model-control.ts`): on the **harness `Session` path the daemon
  actually uses**, `capabilities().models` returns all 6 models **even before any turn**, because
  `session.ts:43` starts `readLoop()` (iterating `this.q`) in the constructor — that primes the SDK control
  channel without a user turn. `setModel` is also accepted pre-turn. The model list was never the problem.

The **real** root cause (confirmed by dumping the SDK model object shape): the model objects key on
**`.value`** (`default` / `sonnet` / `sonnet[1m]` / `opus` / `haiku` / `claude-opus-4-8`) — `.id` is
`undefined`. The console's `modelId` helper (`useDaemon.ts:9`) reads `.id ?? .model`, falls through to
`String(m)` = `"[object Object]"`, and sends `set_model="[object Object]"` → a silent no-op. The chat
`ModelPicker` (Increment B) already got this right with `m?.value ?? m`; the console helper predates
probe-27's knowledge of the shape.

There is a **second half** to #6: even with a correct model id, `set_model` (`bridge/control.ts:14`) only
calls the SDK — it never writes back to the daemon's `SessionRecord.model`, so `list()`/the snapshot keep
returning the **spawn-time** model and Pool/Detail would *still* look unchanged after a cycle.

The other three findings are the **same shape** — *control fires, but live state never reaches the display*:
- **#2 permissionMode** lives only in the supervisor's `configs` map (`SpawnConfig`); it is **not** on
  `SessionRecord` / `ListEntry` / the snapshot, so the UI cannot show it.
- **#4 Detail** renders only `id · status · model`; `ctxPercent` / `tokens` / `createdAt` / `proactive` are
  already on `SessionRow`, just unrendered.
- **#5 proactive** state is on `SessionRow.proactive` but never drawn in Pool/Detail.

So Increment C is **"make the dashboard mirror live session state,"** not "fix supportedModels."

## Architecture

Two cooperating layers, matching the decisions taken:

1. **Daemon = source of truth for live model + permission mode** (chosen over console-side display-only).
   When a `set_model` / `set_permission_mode` control op succeeds, the supervisor writes the new value back
   to the persisted registry record (and the `configs` map, so fork/restart inherit live state). The value
   then flows through the existing `list() → collect() → SessionRow` pipe with no new transport.

2. **tui renders already-available state.** Fix the `modelId` mapping so cycling sends a real value, and
   render the `SessionRow` fields the panes currently drop. Proactive shows **basic state only** (glyph +
   word) — no new daemon API (rich tick/idle/error stats are a non-goal this increment).

**Tech stack:** TypeScript; `cc-harness` daemon (`SessionRegistry` persists records as per-session JSON
under the daemon dir); `cc-harness-tui` Ink console; vitest (keyless unit + OAuth-gated live).

## Components & changes

### Harness (`cc-harness`)

**H1. `harness/src/daemon/types.ts` — `SessionRecord` gains `permissionMode?`.**
Add `permissionMode?: string;` to the `SessionRecord` interface (`:11`). Optional → records written before
this change parse unchanged (boot-rehydration safe). `ListEntry = SessionRecord & { proactive? }` inherits
it automatically, so `list()` (`server.ts:72`) carries it with no other server change.

**H2. `harness/src/daemon/supervisor.ts` — write-back in `control()` (`:162`).**
Current body is `… return ControlBridge.apply(session, frame);`. Change to capture the response and, on
success, persist the new live value:

```ts
const res = await ControlBridge.apply(session, frame);
if (res.ok) {
  if (frame.type === "set_model") {
    this.registry.update(id, { model: frame.model });
    const cfg = this.configs.get(id); if (cfg) cfg.model = frame.model;
  } else if (frame.type === "set_permission_mode") {
    this.registry.update(id, { permissionMode: frame.mode });
    const cfg = this.configs.get(id); if (cfg) cfg.permissionMode = frame.mode;
  }
}
return res;
```

`registry.update(id, patch)` (`registry.ts:30`) already merges + re-persists. Updating `configs` keeps
`fork` (`:205`) and `restart` (`:305/313`) faithful to the live model/mode. **Write-back only on `res.ok`** —
a rejected control op must not mutate the record.

Also: `spawn()` (`:114`) builds `SpawnConfig` with `permissionMode` but `register()` (`:118`) omits it from
the initial record. Pass `permissionMode: cfg.permissionMode` into `register()` so a freshly spawned session
shows its mode immediately (not only after the first cycle).

**H3. `harness/src/monitor/snapshot.ts` — `SessionRow` carries `permissionMode`.**
Add `permissionMode?: string;` to the `SessionRow` interface (`:10`) and pass `permissionMode: e.permissionMode`
in the `collect()` push (`:55`). `model` / `ctxPercent` / `tokens` / `createdAt` / `proactive` already flow.

### tui (`cc-harness-tui`)

**T1. `tui/src/useDaemon.ts` — `modelId` maps `.value` (`:9`).**
`const modelId = (m: unknown) => (typeof m === "string" ? m : ((m as any)?.value ?? (m as any)?.id ?? (m as any)?.model ?? String(m)));`
This alone makes `cycleModel` send a real model value; H2 makes the change visible. The cycle list becomes
the 6 `.value`s. (`cyclePermissionMode`'s `modelId(selected?.model)` at `:120` passes a string → unaffected.)

**T2. `tui/src/Detail.tsx` — enrich the header into a 2-line info block.**
Line 1 (bold): `{id} · {status} · {model ?? "-"}`. Line 2 (dim): `mode {permissionMode ?? "default"} · ctx
{ctxPercent ?? "-"}% · {tokens ?? "-"} tok · age {agehms(createdAt)} · {proactive ?? "idle"}`. Stream body
(`lines.slice(-200)`) unchanged. `agehms` is a tiny pure local helper (`now - createdAt → "12m"/"1h3m"`),
`now` injectable for tests (mirrors existing `now`-injection discipline).

**T3. `tui/src/Pool.tsx` — proactive glyph.**
For rows whose `proactive` is `running` or `paused`, render a compact leading/trailing glyph (`▶` running,
`⏸` paused) next to status; idle/undefined render nothing. Keep the row compact; no column reflow.

## Data flow

```
key 'm' → useDaemon.cycleModel()
        → (first press) client.control(id,{initialize}) → capabilities().models  [6 objects, .value ids]
        → advance(models.map(modelId))   [now real values, not "[object Object]"]
        → client.control(id,{set_model, model:value})
            → supervisor.control() → ControlBridge.apply → session.setModel(value)   [SDK]
            → on res.ok: registry.update({model:value}) + configs.model = value      [H2]
        → next 1s poll: collect(client) → list() entry.model = value → SessionRow.model
        → Pool/Detail render the new model;  status bar already shows `model=value`
```

`p` (permission mode) follows the identical path via `set_permission_mode` → `registry.update({permissionMode})`.

## Error handling & edge cases

- **Failure isolation:** write-back is gated on `res.ok`; a rejected `set_model`/`set_permission_mode`
  leaves the record untouched and the existing `ctl()` status surfaces `error: …`.
- **auto model-gate:** `cyclePermissionMode → auto` already sends `set_model=<resolveAutoModel>` *then*
  `set_permission_mode=auto`; both write back, so Detail shows the gated model and `auto` consistently.
- **Old records:** `permissionMode` absent on pre-change persisted records → Detail shows `default` (the
  `?? "default"` fallback), not a crash.
- **Selection-cache reset:** `select()` already clears `models.current`/`pmIndex` on selection change; live
  display now comes from the snapshot (daemon truth), so it stays correct across selection regardless of the
  client-side cursor.

## Testing strategy

**Keyless unit (run from each package; `npx vitest run`):**
- `useDaemon`: `cycleModel` issues `control{set_model}` whose `model` is a real value (fakeClient returns
  models with `.value`), **never** `"[object Object]"`.
- supervisor: `control{set_model}` on a fake session updates `list()`’s `model`; `set_permission_mode`
  updates `permissionMode`; a **rejected** control op leaves both unchanged.
- `collect()`: a `ListEntry` with `permissionMode` surfaces it on the `SessionRow`.
- `Detail.tsx` (ink-testing-library): renders mode/ctx/tokens/age/proactive line for a populated row;
  shows `default`/`-` fallbacks for a sparse row.
- `Pool.tsx`: renders the glyph for a `running` row; nothing for an `idle` row.

**OAuth-gated live (`test/live/`, gates on `ANTHROPIC_API_KEY || CLAUDE_CODE_OAUTH_TOKEN`):**
- Stand up a supervisor, spawn a session, `control{set_model, value}`, and assert `list()` reflects the new
  model end-to-end (the write-back path through a real SDK session).

## Non-goals (YAGNI)

- Rich proactive stats (tickCount/idleCount/errorCount/reason) — needs a new daemon `proactiveStatus(id)`
  method; deferred.
- cwd / message-count / cost in Detail — not on the live record (would need the persisted-transcript API).
- Changing cycle-start semantics (still starts at index 0, not current+1).
- Unifying the console `modelId` with the chat `ModelPicker` into one shared helper — the chat picker is
  already correct inline; a shared module is more churn than the one-line fix warrants.

## Probes / evidence

- `probes/probes/27-supported-models-headless.ts` — rich 6-model list reachable headless (post-pump).
- `probes/probes/29-pre-turn-model-control.ts` — on the harness Session path, `capabilities().models` = 6
  **pre-turn**; `setModel` accepted pre-turn. Plus a one-off key dump confirming model objects use `.value`.
