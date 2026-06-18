# Public-API Hardening — Design

> Sub-project 2 of the **harden-and-ship** track (sub-project 1 = packaging, DONE; see memory
> `harden-and-ship-over-phase3`). Four parts that harden the public boundary of the `cc-harness` package
> **before it is published** — it is still `private:true`, so this is the cheap moment to make breaking
> surface changes. One combined spec (the closeout's preferred granularity), sequenced by dependency:
> **A curation → B validation → C teardown → D pinning** (pinning last, so it freezes the *final* surface).

## §1 — Goal

Make the `cc-harness` public API shippable. Concretely, after this:
- the public barrel (`src/index.ts`) exports **only genuine product entry points** — implementation
  plumbing is no longer reachable by consumers (and so is no longer a de-facto stability promise);
- the **front doors** (`createHarness` / `resumeHarness` / `openSession` / `resumeSession` / daemon `spawn`)
  reject a malformed config with an **actionable error** instead of a deep SDK crash;
- the public **lifecycle surfaces** (`dispose` / `shutdown` / `stop` / `close`) are proven **leak-free**
  (no hang, no parked-promise leak, no fake-settle, idempotent double-teardown);
- the **final curated surface is pinned** by a comprehensive snapshot test + a documented per-export
  **stability tier**.

## §2 — Audit evidence (the grounding)

Unlike the capability work, this rests on an audit of **our own surface**, not SDK runtime reachability —
so the grounding step is a usage audit (grep of the suspect exports across `src/`, 2026-06-18), not a live
probe. The ~50 root exports split cleanly:

| Export | Referenced by (outside its own module) | Verdict |
|---|---|---|
| `QueryHolder` | `harness.ts`, `context/server.ts`, `session/session.ts` (late-bind holder for the context tool) | **→ internal** (plumbing) |
| `CompactHolder` | `compaction/server.ts`, `session/session.ts` (late-bind holder for the compact tool) | **→ internal** (plumbing) |
| `SessionRegistry` | `daemon/supervisor.ts` only (the supervisor owns it; consumers use `DaemonSupervisor`) | **→ internal** |
| `MessageBus` | `swarm/{teammate,runtime}.ts` (consumers use `SwarmRuntime`) | **→ internal** |
| `parseCompactOutcome` | `session/session.ts` (internal parser of compact frames) | **→ internal** |
| `daemonRequest`, `DaemonServer` | **`cli.ts`** (a real consumer running a daemon) | **keep public** |
| `DaemonSupervisor` | `cli.ts`, `kairos/assistant.ts` | **keep public** |
| `SwarmRuntime`, `resolveOptions`, `createContext/CompactMcpServer` | top-level factories / the seam features wire through | **keep public** (seams) |
| `createHarness`/`openSession`/`listSessions`/hook builders/… | top-level product entry points | **keep public** |

The five **→ internal** exports are referenced only by internal wiring and never by a consumer; every kept
export is either consumed by a real client (`cli.ts`/`kairos`) or is a top-level factory/seam.

## §3 — Scope

**In:** the four parts (A curation, B validation, C teardown sweep, D pinning) on the existing surface.

**Out (non-goals):**
1. **Publishing** — the package stays `private:true`; this *prepares* for publish, it does not flip it.
2. **Semver/changelog tooling** — the stability tiers are **doc-only**; no automated enforcement.
3. **Sub-path exports / multiple entry points** — the single root `.` export stays (no `cc-harness/daemon`).
4. **Validating escape-hatch fields** — `extraOptions` / `settings` / `managedSettings` / `customHeaders`
   stay unchecked **by intent** (they are escape hatches; the SDK owns their shape).
5. **Refactoring module internals** beyond what curation and teardown-fixes require.
6. **New capabilities** — hardening only.

## §4 — Design

### 4.A — Boundary curation

**Files:** `src/index.ts` (prune), `test/unit/index.test.ts` (interim assertion; Part D makes it comprehensive).

`src/index.ts` is **the** public API barrel (per `harness/CLAUDE.md`); the sub-barrels (`context/index.ts`,
`daemon/index.ts`, …) are internal organization. So curation = **prune the root barrel only**:

- Drop from `src/index.ts`: `QueryHolder`, `CompactHolder` (from the `context`/`compaction` type re-export
  lines), `SessionRegistry` (from the `daemon` value re-export), `MessageBus` (from the `swarm` re-export),
  `parseCompactOutcome` (from the `compaction` re-export).
- Internal code is **unaffected** — it imports these from their source modules (`../context/server.js`
  etc.), not from the package root (verified in §2). Sub-barrels may keep them; only the root barrel is the
  public contract.
- **Keep** every product entry point and the three seams (`resolveOptions`, `createContextMcpServer`,
  `createCompactMcpServer`) — they are legitimate advanced API.
- Each surviving export gets a one-line intent comment grouped by area (feeds the Part D stability tiers).

**Proof:** `npm run build` must still emit `dist/` with resolving `.d.ts` (the curated barrel can't dangle a
type it no longer re-exports), and `test/unit/index.test.ts` asserts the five names are **gone** from
`import * as api`.

### 4.B — Input validation

**Files:** new `src/config/validate.ts` (zod schema + `HarnessConfigError`), called from `harness.ts`,
`session/session.ts` (the `openSession`/`resumeSession` factories), and `daemon/supervisor.ts` `spawn`;
re-export `HarnessConfigError` + the validator from `src/index.ts`.

A **zod schema** (consistent with the codebase — `daemonOp`/`proactiveConfig` already use zod) validates the
**constrained** fields of `HarnessConfig`, then the front doors call it and throw on failure:

```ts
export class HarnessConfigError extends Error {}   // mirrors DaemonError / SwarmError / TaskError

// validates ONLY fields with invalidate-able constraints; passthrough strings + escape hatches are not listed
export const harnessConfigSchema = z.object({
  maxTurns: z.number().int().positive().optional(),
  maxBudgetUsd: z.number().nonnegative().optional(),
  effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
  permissionMode: z.enum(["default", "plan", "acceptEdits", "auto", "bypassPermissions", "dontAsk"]).optional(),
  provider: z.enum(["anthropic", "bedrock", "vertex", "foundry"]).optional(),
  toolPreset: z.enum(["claude_code", "none"]).optional(),
  thinking: z.union([
    z.object({ type: z.enum(["adaptive", "disabled"]) }),
    z.object({ type: z.literal("enabled"), budgetTokens: z.number().int().positive() }),
  ]).optional(),
  taskBudget: z.object({ total: z.number().int().positive() }).optional(),
  // … the other constrained enums/numerics; .passthrough() so unlisted/escape-hatch fields are untouched
}).passthrough();

export function validateHarnessConfig(config: unknown): void {
  const r = harnessConfigSchema.safeParse(config);
  if (!r.success) { const i = r.error.issues[0]; throw new HarnessConfigError(`invalid config at ${i.path.join(".") || "(root)"}: ${i.message}`); }
}
```

The remaining constrained fields the schema must also cover: `settingSources` (array of
`"user"|"project"|"local"`), `autoCompactWindow` (positive int), `fallbackModel`/`model` (non-empty
string), and the `sandbox` boolean-or-object shape. Everything else stays unlisted/`.passthrough()`.

Validation is a **fail-fast guard layer only** — it does not transform; `resolveOptions` still builds the
SDK `Options`. `.passthrough()` keeps escape hatches (`extraOptions`/`settings`/`customHeaders`) and any
unlisted passthrough field unchecked, per non-goal 4. The daemon performs a **separate, smaller**
validation of the `DaemonOptions` subset it owns (`model` string, `restart` enum, numeric bounds for
`maxSessions`/`idleTimeoutMs`/etc.) at `DaemonSupervisor` construction — it does **not** take a
`HarnessConfig`.

### 4.C — Teardown robustness

**Files:** new/extended liveness tests per surface; fixes in the surface modules **only if a gap is found**.

Apply the `teardown-liveness-review-pattern` (the recurring parked-promise / leak / fake-settle bug class)
as a **proactive sweep**. For each public lifecycle surface — `Session.dispose`, `DaemonSupervisor.shutdown`
+ `stop`, `DaemonServer.close`, `SwarmRuntime` teardown, and the one-shot `createHarness` run/stream
completion — assert the four liveness properties (DI fakes, no network):

1. **No hang** — teardown resolves even with an in-flight turn (a slow/never-ending fake query).
2. **No parked-promise leak** — pending waiters **reject** (not dangle), timers are cleared, listeners removed.
3. **No fake-settle** — a pending op **rejects** on teardown rather than silently resolving with a bogus value.
4. **Idempotent** — a second `dispose`/`shutdown`/`close` is a safe no-op (no throw, no double-free).

The daemon already has strong teardown tests (`shutdown` disposes all + the restart INVARIANT tests) and
`Session` has dispose tests; this part **fills the gaps systematically** (esp. the double-teardown
idempotency cases and the lighter-covered `SwarmRuntime`/`DaemonServer` surfaces) and **surfaces, not
silently fixes,** anything it finds — so this part's size is variable.

### 4.D — Surface pinning

**Files:** `test/unit/index.test.ts` (rewrite to a comprehensive snapshot), a stability-tier table in
`harness/README` (or `docs/parity`), done **last** so it pins the curated surface.

- **Comprehensive freeze:** assert the **full sorted set** of `Object.keys(import * as api)` against an
  explicit `EXPECTED` array (an explicit array, not `toMatchInlineSnapshot`, forces a deliberate human edit
  on any add/remove — accidental surface drift fails the test).
- **Stability tier per export:** a documented table tagging each public name **stable** / **experimental**
  (e.g. anything wrapping an `_EXPERIMENTAL_` SDK method, or alpha betas) / **advanced-seam**. Doc-only
  (non-goal 2), but it sets consumer expectations and is the reference the freeze test mirrors.

## §5 — Data flow

- **Curation:** consumers import from the package root (the pruned barrel); internal code imports from module
  paths — unchanged.
- **Validation:** `createHarness(config)` / `openSession(config)` → `validateHarnessConfig(config)` (throws
  `HarnessConfigError` on bad input) → `resolveOptions` → SDK. Daemon `spawn` validates its `DaemonOptions`
  subset at construction.
- **Teardown:** each surface's existing `dispose`/`shutdown`/`close`/`stop` seam drains its resources; the
  sweep adds assertions (and fixes) around them.
- **Pinning:** `index.test.ts` imports `* as api` and asserts the frozen name set.

## §6 — Error handling

- **`HarnessConfigError`** (new, `extends Error`, mirrors `DaemonError`/`SwarmError`/`TaskError`): thrown at
  the front door with `invalid config at <path>: <message>` from the first zod issue. **Fail-fast** — before
  any SDK call.
- **Escape-hatch fields are not validated** (`.passthrough()`) — intentional; the SDK owns their shape.
- **Teardown contract** is "no hang / no leak / no fake-settle / idempotent" — violations are **fixed in the
  surface**, not caught.
- Curation throws nothing; its failure mode is a build error (a dangling `.d.ts` re-export), caught by
  `npm run build`.

## §7 — Testing

- **A (curation):** `index.test.ts` asserts the five plumbing names are **absent** from `import * as api`
  and the kept entry points present; **`npm run build`** proves the curated `.d.ts` resolve.
- **B (validation):** unit (keyless) — a valid config passes; each invalid case (bad enum, negative/zero
  numeric, wrong type, malformed `thinking`) throws `HarnessConfigError` with the right `path`; escape-hatch
  fields (`extraOptions` etc.) pass untouched; the daemon-subset validation rejects a bad `DaemonOptions`.
- **C (teardown):** the four liveness assertions per surface (DI fakes; mirror the existing daemon/session
  teardown tests); any gap fixed and re-asserted.
- **D (pinning):** the comprehensive frozen-surface test (full sorted `EXPECTED` array); the stability-tier
  doc reviewed for one-tier-per-export completeness.
- Run `npm run test:unit` (all green) + `npm run typecheck` + `npm run build` as the gates. No live test is
  needed (no SDK runtime premise) — this sub-project is keyless end to end.

## §8 — Non-goals

See §3 "Out": no publishing, no semver/changelog tooling, no sub-path exports, no escape-hatch validation,
no internal refactors beyond what curation/teardown require, no new capabilities. Beyond those: no
transformation in the validation layer (it guards, `resolveOptions` still builds Options), and no live test
(keyless throughout).
