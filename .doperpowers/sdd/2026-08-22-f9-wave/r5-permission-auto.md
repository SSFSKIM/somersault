# R5 — Flipping the interactive ccx REPL's default permission mode to `auto`

Research only. No code changed. All file:line citations verified against the working tree on
2026-08-22; canon citations against `/Users/new/claude-code-bundle/2.1.236/cli.pretty.js`.

---

## 1. Current state — who defaults to what

### The two seams

- `harness/src/config/types.ts:159-170` — `DEFAULTS`, the harness-wide fallback:
  ```ts
  model: "claude-opus-5",                   // auto-capable (probe 72)
  permissionMode: "auto" as PermissionMode, // SDK-native auto classifier
  ```
- `harness/src/config/resolveOptions.ts:83-92` — the single place a mode becomes an SDK `Options` field:
  ```ts
  const mode = config.permissionMode ?? DEFAULTS.permissionMode;
  if (mode) options.permissionMode = mode;
  // `auto` is MODEL-GATED … Force a supported model ONLY when the caller EXPLICITLY chose auto
  if (config.permissionMode === "auto") options.model = resolveAutoModel(model);
  if (mode === "bypassPermissions") options.allowDangerouslySkipPermissions = true;
  if (config.permissionBroker) options.canUseTool = createPermissionGate(config.permissionBroker);
  ```
  Note: `permissionMode` is **always** written into `options` (DEFAULTS is never undefined), so the SDK
  flag layer always beats a `permissions.defaultMode` in the user's `settings.json`. That matters — see §4.

### Two overrides put the interactive REPL back to `default` (Manual)

- `harness/src/cli/main.ts:426-441` — the foreground REPL. The Wave T EP-T1 comment reads verbatim:
  > Wave T EP-T1: the REPL launches MANUAL like upstream (2.1.220 `gGl` L41536: `default` → "Manual").
  > QA sprint 1 found `rm` and `git init` running unconsulted because DEFAULTS.permissionMode is "auto"
  > (config/types.ts:161) and every surface resolves through it. Headless (-p/--bg) and the daemon KEEP
  > auto deliberately — a background run has nobody to ask.
  > ONE object, three readers: the host, the banner and hookOpts. Reading `inv.config` for the banner
  > instead would print "auto" (DEFAULTS) while the engine ran "default" — qa3-02 inverted.

  The line itself: `permissionMode: inv.config.permissionMode ?? "default"` (`main.ts:440`), inside the
  `foregroundConfig` object handed to `deps.makeHost`, the welcome banner (`main.ts:526`, via
  `resolvedPermissionMode(foregroundConfig)`) and `hookOpts.initialMode`.

- `harness/src/cli/hostMain.ts:51` — the `--detachable` child, which re-enters the binary as
  `--__kind interactive` and never passes through `runForegroundImpl`:
  ```ts
  const base = kind === "interactive" ? { ...inv.config, permissionMode: inv.config.permissionMode ?? "default" } : inv.config;
  ```
  Comment: "Without this line `ccx --detachable` presents the identical REPL in `auto` while plain `ccx`
  consults. A `bg` child keeps auto: it has nobody to ask."

### Effective default per surface

| Surface | Constructed at | Effective launch mode | Notes |
|---|---|---|---|
| Foreground `ccx` REPL | `cli/main.ts:440` | **`default` (Manual)** | `--permission-mode` still wins |
| `ccx --detachable` (same REPL, detached host) | `cli/hostMain.ts:51` | **`default`** | fixed alongside the foreground path |
| `ccx attach <target>` | `cli/main.ts:365-386` (`attachToImpl`) | **inherits the live host's mode** | no independent default; the client learns the mode from host `state`/`system.status` frames (`host/host.ts:729-730`, `useChat.ts`) |
| Headless `ccx -p` | `cli/main.ts:99-108` (`runOnce` → `createHarness`) | **`auto`** (DEFAULTS) | deliberate |
| `ccx --bg` child | `cli/hostMain.ts:51` (`kind === "bg"` arm) | **`auto`** (DEFAULTS) | deliberate — "nobody to ask" |
| Daemon (`daemon/supervisor.ts:396`) | per-session `SpawnConfig.permissionMode` | **`auto`** unless the spawn named one | `supervisor.ts:132` runs the explicit-auto model gate |
| Library API (`createHarness`, `openSession`) | `resolveOptions` | **`auto`** (DEFAULTS) | |
| App-server `thread/start` | `appserver/sessionLib.ts:174` / registry seed | client's `config.permissionMode`, else **`auto`** | |

### Broker / `canUseTool` wiring, and how the mode interacts with it

- `resolveOptions.ts:92` — `if (config.permissionBroker) options.canUseTool = createPermissionGate(config.permissionBroker)`.
  `canUseTool` is one of four `SERVER_OWNED` keys (`resolveOptions.ts:35`) the `extraOptions` escape hatch
  cannot overwrite.
- `harness/src/permissions/gate.ts:72+` — `createPermissionGate` maps a consult to the REPL's dialog kind
  (`routeDecisionKind`: `AskUserQuestion` → question, `ExitPlanMode` → plan, everything else → the 3-way
  permission dialog) and owns the per-session "always allow" set.
- The host **always** supplies a broker, in every mode — `cli/warningChannel.ts:3-12` documents why (a
  bypass launch that dropped `canUseTool` would be permanently brokerless if the user later stepped the
  mode down).
- The mode↔broker contract, `config/types.ts:34-40`, verbatim:
  > acceptEdits auto-accepts edits but still routes non-edit tools to canUseTool; dontAsk and
  > bypassPermissions replace canUseTool entirely. `auto` does NOT — probe 64 shows it consults the broker
  > whenever a rule routes a tool to `ask`, exactly as `default` does. **What summons the broker is the ask
  > rule, not the mode.**

---

## 2. The QA finding, quoted

`CC-to-SDK/docs/parity/qa-sprint-1-triage.md:71-80`:

> ### C5 · ccx launches in `auto` permission mode
> - **Canonical: `qa3-03`** (P1) — `git init` and `rm <file>` run with no consult where Claude Code gates
>   both. **This is the user-visible harm and the top of the worklist.**
> - Members:
>   - `qa3-01` (P2) — the root cause: ccx's launch permission mode is `auto`, claude's is manual/default.
>   - `qa3-15` (P4) — the shift+tab ladder has the same four modes in the same order; the only difference is
>     the entry point. Same fact, no separate work.
> - Note for the implementer: `qa3-03` observes ccx's auto classifier gating the harmless `touch` while
>   allowing the destructive `rm`. Changing the launch default removes the exposure; it does not by itself
>   explain the classifier's ordering, which is worth a look while in there.

And the worklist row (`qa-sprint-1-triage.md:164`):

> | 1 | **qa3-03** (+`qa3-01`, `qa3-15`) | Destructive commands (`git init`, `rm <file>`) run with no consult | P1 | dialog | Downstream of ccx defaulting to `auto` permission mode at launch — change the launch default in `resolveOptions` / REPL defaults. Classifier ordering (gates `touch`, allows `rm`) is worth a second look while in there | S |

Two things about this finding are worth holding onto:

1. **The comparison was against a `claude` that launched Manual.** `qa3-01` says "claude's is
   manual/default". That premise is measurably no longer true on this machine — see §4.
2. **The classifier's ordering was never explained.** `touch` gated, `rm` allowed. Nobody has re-run that
   observation since; it was recorded as a curiosity, not diagnosed.

The `qa3-02` sibling (banner said `default`, footer said `auto`, same frame) was fixed by the same wave and
is the reason `main.ts` keeps one `foregroundConfig` object read by all three surfaces.

---

## 3. What `auto` actually means in SDK 0.3.237

Installed: `@anthropic-ai/claude-agent-sdk` **0.3.237** (`harness/node_modules/.../package.json`).

**Declared surface** (`sdk.d.ts:2193`):
```ts
export declare type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk' | 'auto';
```
with the doc comment above it (`sdk.d.ts:2191`): `'auto' - Use a model classifier to approve/deny
permission prompts.` **Caveat:** the per-field jsdoc on `Options.permissionMode` (`sdk.d.ts:1780-1786`)
still lists only five modes and omits `auto` entirely — a stale doc block, not a signal that `auto` is
unsupported. Don't read that block as authoritative.

**Measured behaviour** (memory `sdk-permissionmode-canusetool-matrix`, probes 18-series / 64 / 72 / 85 / 99):

- **(a) What gets auto-approved without ever reaching `canUseTool`.** Decision order the docs state and the
  probes confirm: allow/deny rules first → reads and working-directory edits auto-approved → everything
  else goes to the classifier. Probe 18d (sonnet-4-6, no `canUseTool`, `settingSources:[]`) had `auto`
  approve a working-dir edit **and an explicitly requested `rm`** that `default` blocked. Probe 18f/18h:
  `auto` also permitted `curl … | bash` (local and external) that `default` blocked. **Probe 85 on
  `claude-sonnet-5` (SDK 0.3.220) is the sharpest data point: the classifier allowed every operation the
  probe could safely construct — deleting a pre-existing file, writing into `$HOME`, invoking `sudo`, and
  writing `.claude/settings.json`, the last of which sonnet-4-6 had blocked.** The recorded conclusion:
  "treat `auto` as approximately `bypass` for explicit commands on Claude-5 models."
- **The block path was never observed headless and probably cannot be, via explicit commands.** Reframed
  from the docs: the classifier blocks actions that *escalate beyond your request* or are *driven by
  hostile content Claude read* — not direct explicit user instructions. So `auto`'s real value is catching
  the **agent going off-script** (escalation / prompt injection), not stopping what you typed.
- **(b) What still reaches the broker/dialogs under `auto`.** Probe 64 ran the same scenario twice changing
  only the mode, with `settings.permissions.ask: ["Bash(*)"]` present:
  ```
  [default] canUseTool FIRED for Bash -> allow
  [auto]    canUseTool FIRED for Bash -> allow
  ```
  Probe 18g adds the negative control: `echo` with **no** ask rule stayed silent (classifier owned it);
  `echo` under the ask rule fired `canUseTool` 2/2. Also always-routed regardless of mode: `AskUserQuestion`
  (probe 65) and, under plan mode, `ExitPlanMode` (probe 66). So the human-escalation seam **survives**
  `auto` — it is just gated on `ask` rules instead of on the engine's built-in danger heuristics.
- **(c) Extra model call per decision.** Yes, in principle: `auto` is a server-side classifier model that
  reviews each action; the recorded doc-derived note is that it "counts tokens + adds a round-trip on
  shell/network ops." Canon's own copy says so out loud — `AUTO_MODE_DESCRIPTION` contains the sentence
  "Sessions are slightly more expensive." **I found no local measurement of the added latency**; no probe
  in `probes/probes/` times it, and probe 85 arm D established that the classifier's verdict never reaches
  client frames at all (no `system/permission_denied`; a denial leaves only tool_result prose and a
  reason-less `result.permission_denials`), so we cannot even observe a decision from the wire, let alone
  time it. Treat the cost claim as canon's word plus a plausible mechanism, not as something we measured.
- **Model gate.** `auto` requires a supported model. `harness/src/config/autoModel.ts` lists the
  live-verified set: `claude-fable-5`, `claude-opus-5`, `claude-sonnet-5`, `claude-sonnet-4-6`,
  `claude-opus-4-6/4-7/4-8`. `DEFAULTS.model` is `claude-opus-5`, which is in the set. On the **launch**
  path an unsupported model silently degrades to `default`; on the **runtime setter** path (probe 99) the
  engine refuses loudly: `Cannot set permission mode to auto: auto mode unavailable for this model`.

---

## 4. Canon comparison — Claude Code 2.1.236

### The startup default is a gated rollout, and canon is moving to `auto`

`cli.pretty.js:106068-106141`, function `JHd` — the launch-mode resolver. Precedence: an explicit
`--permission-mode` / `--dangerously-skip-permissions` / agent frontmatter mode is pushed first, then
`permissions.defaultMode` from settings, then this final fallback (`:106133-106139`):

```js
let h = !1;
if (!m) {
  let _ = "default";
  if (d && cOn() && (!t.isNonInteractiveSession || IUe() || nt("tengu_moss_anchor", !1)))
    _ = "auto", h = !0;
  m = { mode: _, notification: f };
}
```

where `d = !u && !tNd(n)` (`:106074`) — auto not circuit-broken and not disabled by
`permissions.disableAutoMode` — and `cOn()` (`:106218`) is a feature gate:
`nt("tengu_harbor_willow", !1) || Bna()?.meadow_lantern === !0`.

**So: with nothing configured, an interactive `claude` 2.1.236 launches in `default` (Manual) for users
outside the gate, and in `auto` for users inside it.** The result is even flagged `fromAutoFallback: h`.
Supporting evidence that this is a live rollout, not dormant code: `cli.pretty.js:560924` defines
`Fns = "Auto mode is now Claude Code's default permission mode."` next to a description string and a
`https://code.claude.com/docs/en/permission-modes` link, rendered by the `auto-mode-default` notice
component (`:560934-560955`, persisting `hasSeenAutoDefaultNotice`).

### On *this* machine, canon is already in `auto` — by explicit setting

`/Users/new/.claude/settings.json:110`:
```json
"defaultMode": "auto",
```
(inside `permissions`, directly after a `deny` list covering `~/.ssh/**`, `~/.aws/**`,
`~/.config/gcloud/**`, and `Edit/Write(~/.claude/settings.json)`.)

And `/Users/new/.claude.json` carries `hasSeenAutoModeEntryWarning: true` plus
`hasResetAutoModeOptInForDefaultOffer` and `autoPermissionsNotificationCount` — the owner has been through
canon's auto-mode onboarding already.

**This is the single most decision-relevant fact in this report.** `qa3-01`'s premise — "claude's is
manual/default" — is false for this user today. The very setting the QA sprint measured against has since
been changed by the owner to `auto`.

Canon guards *where* that setting may come from (`:106111-106121`): `defaultMode: "auto"` is honoured only
from **policy / user / flag** scope; `projectSettings` and `localSettings` are rejected with
"only policy/user/flag settings may grant auto mode (projectSettings and localSettings are
repo-controllable)". A repo cannot talk you into `auto`.

**ccx does not currently see any of this**, for two independent reasons: (1) the REPL passes an explicit
`permissionMode: "default"`, which outranks settings in canon's own precedence, and (2) even without that,
`resolveOptions` always writes `DEFAULTS.permissionMode` into `options`, so a settings-level
`defaultMode` can never be the deciding layer. ccx *does* load the file — `DEFAULTS.settingSources` is
`["user","project","local"]` — so the owner's **deny rules already apply to ccx sessions**. Only the
`defaultMode` line is being shadowed.

### The shift+tab ladder in 2.1.236

`cli.pretty.js:566167-566190`, function `pis` (next mode), reached from `chat:cycleMode`
(`:607304+`, bound to shift+tab at `:174817`):

```js
function pis(e, t) {
  switch (e.mode) {
    case "default":     return "acceptEdits";
    case "acceptEdits": return "plan";
    case "plan":
      if (q7h(e)) return "bypassPermissions";
      if (pGe(e)) return "auto";
      return "default";
    case "bypassPermissions":
      if (pGe(e)) return "auto";
      return "default";
    case "dontAsk":     return "default";
    default:            return "default";   // ← `auto` lands here
  }
}
```
with `q7h` = bypass available and not disabled (`:566163`), `pGe` = `isAutoModeAvailable && isAutoModeGateEnabled()` (`:566156`).

Full canon cycle when both are available:
`default → acceptEdits → plan → bypassPermissions → auto → default`.
Without bypass: `default → acceptEdits → plan → auto → default` — **exactly ccx's ladder**
(`src/tui/settingsRows.ts:27`: `["default","acceptEdits","plan","auto"]`). ccx keeps
`bypassPermissions` off-cycle behind `/yolo` (`useChat.ts:154-156`), which is a recorded divergence, not
new.

`r9()` (`:317733`) — the auto gate — refuses on circuit-breaker, on the settings kill-switch, and on a
model that doesn't support auto (`cdt(Ui())`), which is the same shape as ccx's `autoModel.ts`.

### One copy divergence worth fixing alongside a flip

`cli.pretty.js:676952-676958` — canon 2.1.236 now has **two** descriptions and picks by plan:
```js
function Co0() { let e = mc(); return e === "pro" || e === "max" || e === "team" ? Bry : $ry; }
// $ry = base + "Sessions are slightly more expensive." + tail
// Bry = base + tail            (no cost sentence)
```
ccx's `src/tui/autoModeNotice.ts` hardcodes `$ry` (the 2.1.220 string, cost sentence included). The owner
runs on an OAuth/subscription token, so canon would show them the **`Bry`** variant. Minor, but if the
REPL starts in `auto` this notice becomes something the user sees on nearly every fresh install rather
than only when they cycle into it.

---

## 5. The tradeoff, the implementation, and the options

### What the owner gains
Fewer permission dialogs in the daily REPL. Under `auto` the classifier owns the trusted surface — reads,
working-directory edits, and (measured on Claude-5) essentially every explicit command — so the REPL stops
interrupting for the routine. This is also the posture canon is rolling out, and the posture the owner has
already chosen for their own `claude` via `permissions.defaultMode: "auto"`. Consistency between `ccx` and
`claude` on the same machine becomes a real benefit rather than a divergence.

### What the owner loses
The engine's built-in "this is dangerous, ask first" gate for **explicitly requested** commands. Named
concretely from the QA finding: **`rm <file>` and `git init` will run with no dialog.** Probe 18-series and
85 extend that list with what was actually measured: deleting a pre-existing file, `curl … | bash` from
localhost *and* from an external URL, writing into `$HOME`, invoking `sudo`, and writing
`.claude/settings.json`. The recorded verdict is blunt — on Claude-5 models `auto` behaves approximately
like `bypass` for explicit commands. What `auto` still buys is protection against the *agent* escalating
beyond the request or acting on hostile content it read; that path exists in the docs but has never been
observed live here (no injection harness has been built).

Second-order losses: a per-decision classifier round-trip on shell/network ops (unmeasured here), the
"slightly more expensive" sentence canon prints, and the fact that under `auto` a denial is invisible on
the wire (probe 85 D) — so ccx cannot render *why* something was blocked.

### Implementation size, if approved
Small, but **not** a one-line flip. Concretely:

1. `src/cli/main.ts:440` — `?? "default"` → `?? "auto"`.
2. `src/cli/hostMain.ts:51` — the same change for the `--detachable` interactive child. Missing this is the
   exact defect EP-T1 was written to prevent (the same REPL in two different modes).
3. **The auto-model gate side effect — the one real trap.** `resolveOptions.ts:88` runs
   `options.model = resolveAutoModel(model)` when `config.permissionMode === "auto"` *explicitly*. Today
   the REPL writes `"default"`, so the gate never fires. After the flip the REPL writes an explicit
   `"auto"`, so **`ccx --model claude-haiku-4-5` would be silently switched to `claude-sonnet-5`** — the
   exact silent-downgrade the comment at `resolveOptions.ts:85-87` says it is avoiding. Needs a
   deliberate decision: either distinguish "auto because defaulted" from "auto because typed", or drop the
   swap for the defaulted case and let the engine degrade.
4. Banner truth is already free: `main.ts:526` reads `resolvedPermissionMode(foregroundConfig)`, and
   `hookOpts.initialMode` reads the same object. That is the qa3-02 fix and it keeps working.
5. `needsBypassConsent` (`main.ts:330`) hardcodes a second `?? "default"`; harmless either way (neither
   value equals `bypassPermissions`), but it should move with the rest so one rule lives in one place.
6. The auto-mode entry notice (`src/tui/autoModeNotice.ts`, wired at `useChat.ts:1811-1834`) will now fire
   on essentially every fresh install's first session, 800 ms in, once per install. That is upstream's own
   behaviour under an auto default, so it is correct — but consider adopting canon 2.1.236's
   subscription variant (no cost sentence) at the same time.

**Tests that pin `"default"` and would need updating** (`rg -n '"default"' test`, filtered to the launch
question):
- `test/unit/cli-main.test.ts:183` — `hostOptsFrom(--__kind interactive).config.permissionMode === "default"`
  (and `:185`, `bg` stays undefined → DEFAULTS `auto`). The test's own comment names EP-T1.
- `test/unit/cli-main.test.ts:483-486` — "a bare foreground run launches in `default`, and host, banner and
  hookOpts all agree", asserting `permissionMode`, `hookOpts.initialMode`, and the banner string
  `"mode  default"`. Comment on `:483`: "the ENGINE consults before rm/git init".
- `test/unit/cli-main.test.ts:189` and `:496-499` stay valid as-is (explicit `--permission-mode` wins) but
  `:496` should gain a sibling asserting an explicit `--permission-mode default` still reaches all three.
- Everything else matching `"default"` in `test/` is about *rendering* a mode, not about the launch
  default: `test/tui/settingsRows.test.ts:42`, `test/tui/mode-refusal.test.tsx`,
  `test/tui/planDialog.test.tsx`, `test/tui/commands.test.ts:169-170` (`parseLaunchMode` fallback),
  `test/unit/appserver/*` and the live app-server suites all pass their own explicit `"default"` and are
  unaffected.
- `test/tui/auto-mode-notice.test.tsx` already covers the notice; worth adding a case for "the notice fires
  on a launch that *started* in auto", which is a new reachable path.
- `test/live/daemon-permissions.e2e.test.ts:22-25` documents the daemon's bare-spawn `auto` and stays true.

Estimate: two production lines, one genuine design decision (item 3), two test rewrites, one new test.

### Three options

**Option A — flip outright.** `?? "auto"` in both interactive constructors; DEFAULTS untouched (headless,
`--bg`, daemon and library already run `auto`, so this actually *unifies* every surface on one mode for the
first time). Cleanest story, matches where canon is heading, matches what the owner already set for
`claude`. Cost: it re-opens `qa3-03` by construction, and the coverage scorecard / QA corpus will need a
recorded reversal so a future wave doesn't "fix" it back. Requires resolving item 3.

**Option B — flip with a safety floor.** Same flip, plus ship a small set of `ask` rules so the classes
that made `qa3-03` a P1 still reach a dialog. This is mechanically proven: probe 64 and 18g show `ask`
rules route their tools to `canUseTool` *under `auto`*, and the REPL's broker is already installed in every
mode. Something like `ask: ["Bash(rm:*)", "Bash(git init:*)", "Bash(sudo:*)", "Bash(curl:*)"]` merged into
`resolveSettings` gives "classifier handles the easy majority, human handles what we marked". Cost: ccx
currently injects **zero** permission rules of its own (`src/config/*` has no `permissions` construction) —
this would be the first, and an opinionated one; it also partly duplicates what the user's own
`settings.json` deny/ask lists already do, and it can be defeated by shell quoting the same way any prefix
rule can.

**Option C — persist a preference instead of changing the hard default.** Follow the `/model` and
`/effort` precedent exactly (`main.ts:411-425`: read `deps.loadPrefs()`, let an explicit flag win, fall
back to `DEFAULTS`): add `mode` to `CcxPrefs`, have `/config`'s permission-mode row (already present at
`settingsRows.ts:58`) offer "set as default", and leave the hard-coded launch value at `default`. Cost: one
more knob, and it does nothing until the owner sets it — but it is reversible per-install, it needs no QA
reversal, and it is the option that respects "the launch default is a claim about all users, the
preference is a claim about this one".

**A fourth shape worth putting on the table, because canon uses it.** Rather than choosing a literal at
all, ccx could **stop forcing a mode for the interactive REPL and let `permissions.defaultMode` from
`settings.json` decide**, which is exactly what canon does and what the owner has already configured to
`auto`. That means making `DEFAULTS.permissionMode` absent for the interactive path so the SDK's own
settings layer becomes the deciding rung, and adopting canon's trust rule (honour `auto` only from
user/policy scope, never from a repo-controllable `projectSettings`/`localSettings` — `cli.pretty.js:106118`).
The owner would get `auto` immediately, from the setting they already wrote, with no ccx-side policy claim
at all. It is more work than A (the mode currently has to be resolvable synchronously for the banner and
`hookOpts.initialMode`, which is why `resolvedPermissionMode` exists), and it needs a probe to confirm the
SDK honours `settings.permissions.defaultMode` when `Options.permissionMode` is omitted — that is
**unverified** and would be the first thing to test.

### Recommendation
Option A **plus** the settings-trust idea as the follow-up: flip the two interactive constructors to
`auto`, resolve the model-gate side effect explicitly, and record the qa3-03 reversal in
`docs/parity/qa-sprint-1-triage.md` so it reads as a decision rather than a regression. The QA finding that
argued for Manual was benchmarked against a `claude` that launched Manual; that benchmark has moved, and
on this machine it moved because the owner moved it. Option B's ask-rules are worth adding only if the
owner wants a floor that survives switching machines — otherwise their existing `deny` list in
`~/.claude/settings.json` (which ccx already loads) is the floor, and it is a better one than anything we
would hardcode.

### Open / unverified
- Whether the SDK honours `settings.permissions.defaultMode` when `Options.permissionMode` is omitted — no
  probe exists. Gates the fourth option.
- The classifier's added latency per shell/network decision — never measured here.
- `qa3-03`'s odd ordering (classifier gated `touch`, allowed `rm`) was recorded and never diagnosed; if the
  REPL is going to live in `auto`, that is worth one probe.
- Whether `tengu_harbor_willow` / `meadow_lantern` is on for this account — i.e. whether canon would have
  launched `auto` here even without the explicit setting. Not determinable from the bundle alone.
