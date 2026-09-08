# Lane I — Headless & SDK protocol (spec ch. 45, hook-relevant ch. 27, stdout-relevant ch. 12)

**Scope.** `45-headless-and-sdk-protocol.md` in full (6,802 lines, read § by §), `27-hooks.md` §§2,
3.2, 10.7, 11.2, 12.5, 16, 19, and `12-tool-execution-scheduler.md` §§12.14–12.15 (what reaches
stdout).

**Version reality check — read this before weighing anything below.** The spec is written from
**2.1.257**. Our SDK pin is `@anthropic-ai/claude-agent-sdk@0.3.251`
(`harness/node_modules/@anthropic-ai/claude-agent-sdk/package.json:3`), whose
`harness/node_modules/@anthropic-ai/claude-agent-sdk/manifest.json:2` declares the CLI it ships as
**`"version": "2.1.251"`** — six patches behind the spec, and exactly our documented canon. Where a finding depends on the 241→251 window I say so and bracket it against the local
bundles (`~/claude-code-bundle/2.1.{220,234,236,241,251,257,263}`). Everything I label **verified** I
grepped in `~/claude-code-bundle/2.1.257/cli.pretty.js` myself, and cross-checked in 2.1.251 where the
hop could matter.

Also worth pinning up front: the SDK's runtime read loop is a **passthrough, not a whitelist**. In
`sdk.mjs`, `Query.readMessages()` `continue`s past exactly five frame kinds — `control_response`,
`control_request`, `control_cancel_request`, `keep_alive`, `transcript_mirror` — and hands *everything
else* to `inputStream.enqueue(e)`, including subtypes absent from `sdk.d.ts`. So "not in the typed
union" never implies "not reachable". Conversely, the three control envelopes are the one thing we
provably cannot see.

---

## 0. Top takeaways

1. **`promptSuggestions` is recorded 🚫 DEAD headless on a gate that no longer exists.** The emitter
   gate flipped between 2.1.241 and 2.1.251 from a double-bind to a permissive test. We built
   `harness/src/tui/suggester.ts` — a warm Haiku side-session at ~$0.0045/suggestion — on that dead
   verdict. §1 / **P1**. Biggest single item in this lane.
2. **`includeHookEvents` is recorded 🚫 DEAD headless, and our own shipped code turns it on and depends
   on it.** `harness/src/host/host.ts:571` defaults it `true` for every interactive ccx session, and
   probes 116/119 measured live frames with it set. The ledger is simply stale. §1 / **P2**.
3. **"SessionStart is dead at startup AND resume" is species-scoped, and the spec supplies both the
   mechanism and the workaround.** (`coverage.md:802-826` already retracted this on 2026-09-01;
   `full-potential.md:174,177` did not get the memo.) Callback hooks are dead for a reason that can never change
   (§3/E1); *settings-layer* SessionStart hooks fire and emit lifecycle frames **unconditionally, with
   no flag** (`J2r = ["SessionStart","Setup"]`). §1 / **P3**, §3 / **E1**.
4. **`default_to_no` is one of five `can_use_tool` wire fields the SDK's callback bridge drops**, not
   one. We recorded only that one. §1 / **P4**, §2.
5. **Two of our "alive" verdicts carry undocumented conditions**: `interrupt` spares background tasks
   only on an *open-input* session (a one-shot string prompt still kills them), and the spare/kill
   choice is gated on a `perTaskStopAffordance` predicate our probe read as inert. §1 / **P5**.
6. **A whole class of CLI capability is reachable through `extraArgs` and modelled nowhere** — billing
   attribution (`--workload`), cross-tenant prompt-cache prefix sharing
   (`--exclude-dynamic-system-prompt-sections`), delivery ACKs (`--replay-user-messages`), a
   zero-turn config verifier (`--init-only`). §2.
7. **The spec explains five things we should stop re-probing** — why callback hooks never emit
   lifecycle frames, why `SessionEnd` is dead on the wire, why a bare `-p` run's `ask` is terminal,
   and why `--forward-subagent-text` is a no-op for async Tasks. §3.

---

## 1. Premise challenges

### P1 — `promptSuggestions` 🚫 DEAD headless is **stale**; the blocking gate was removed in the 241→251 window

**Verdict as recorded.** `docs/parity/full-potential.md:174` and `docs/superpowers/specs/2026-08-09-wave-c-chrome-composer-design.md:42`: *"The SDK's declared prompt-suggestion surface is dead headlessly (probes 100/100b: 4 sessions, twelve turns, zero frames)"*. Consumed as a design premise in `harness/src/tui/suggester.ts:20-22`: *"The SDK's own `prompt_suggestion` channel is DEAD headlessly — probe 100 ran four sessions and twelve turns with `promptSuggestions: true` and got zero frames; the emitter is bound to a surface the SDK transport does not have."* Probes 100/100b ran against **2.1.226**.

**What the spec says.** §45.14.8 documents `--prompt-suggestions` and 20+ suppression reasons but does **not** mention any environment-variable term in the emitter gate. Reading the bundles directly settles it — the emitter gate is one expression and it changed:

| bundle | emitter gate (verified by grep) |
|---|---|
| 2.1.220 | `promptSuggestions && xr.shouldQuery !== !1 && !PE() && !su(process.env.CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION)` |
| 2.1.234 | `… && !lf(process.env.CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION)` |
| 2.1.236 | `… && !sf(process.env.CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION)` |
| 2.1.241 | `… && !qp(process.env.CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION)` |
| **2.1.251** | `promptSuggestions && lt.shouldQuery !== !1 && !Hs() && a.CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION !== !1` |
| **2.1.257** | `promptSuggestions && ot.shouldQuery !== !1 && !Vi() && a.CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION !== !1` [`cli.pretty.js:176548`] |
| 2.1.263 | same as 257 |

That is a **double-bind on 2.1.220–241 and only there**. The enable function
[`chunk-1kg58a1a.js:119160-119171`, verified] is:

```js
  if (e === !1) …source "env"… return !1;
  if (e === !0) …source "env"… return !0;          // ← returns BEFORE both gates below
  if (!P("tengu_chomp_inflection", !1)) …"growthbook"… return !1;   // default false
  if (Oe()) …source "non_interactive"… return !1;
```

So on ≤2.1.241: env unset → `promptSuggestionEnabled` false (growthbook, then non_interactive) → `lpn` returns `"disabled"`; env truthy → enabled, but the *emitter* gate `!su(env)` now fails. Zero either way. Probe 100b tested exactly the two arms that the double-bind closes (`probes/probes/100b-prompt-suggestion-env-override.ts`, arms 1 and 2 both `env:true`), which is why it saw 0/4 sessions. On 2.1.251+ the emitter gate only rejects an *explicitly false* env var, so `CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=1` now satisfies both halves.

`Vi()` is `jP().isShuttingDown()` [`cli.pretty.js:162089-162091`], not an interactivity test — verified, so it is not a second blocker.

**Status: verified, with no residual uncertainty.** The bundle our SDK actually spawns is **2.1.251**
(`manifest.json:2`), and 2.1.251 is on the *new* side of the flip — I grepped the gate in that exact
bundle. So the blocking term is provably gone from the CLI we ship today. **251-vs-257 note:** no
change between them; the flip is 241→251.

**Proposed probe.** One streaming `query()` on haiku, `settingSources: []`, `promptSuggestions: true`, `env: { ...process.env, CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: "1" }` (the `env` option *replaces* rather than extends — probe 100b's own recorded gotcha). Drive **four** cheap turns, not two, so `early_conversation` (`<2` assistant messages, [`chunk-1kg58a1a.js:119198`]) and `cache_cold` (last response `input + cache_creation + output > 10000`, [`:119256-119262`]) are both past by turn 3. Record every frame with `type === "prompt_suggestion"` **and** every `tengu_prompt_suggestion` suppression reason you can infer from the absence pattern. Run a second arm with the env var *unset* to separate "the option alone now works" from "the option plus the env var works". If any arm yields a frame, `suggester.ts`'s whole generator half (its ~$0.0045/suggestion warm session, and its accounting gap against `/cost`) is replaceable by the upstream fork-with-warm-cache path, which is nearly free.

---

### P2 — `includeHookEvents` 🚫 DEAD headless is **wrong as recorded**, and our shipped code already contradicts it

**Verdict as recorded.** `docs/parity/full-potential.md:174`: *"`includeHookEvents` (hook lifecycle messages) | 🚫 W4 | DEAD headless (probes 53/53b: no hook frames with programmatic hooks); knob wired for completeness"*. Same at `docs/parity/coverage.md:42` and `docs/superpowers/specs/2026-07-17-wave4-knob-completion-design.md:15`.

**What the spec says.** §45.14.6: the flag sets `allHookEventsEnabled` via `V8n(!0)`, and `xSe(event)` then returns true for all 33 events. Verified in the bundle:

```js
var J2r = ["SessionStart", "Setup"];
function xSe(e) {
  if (J2r.includes(e)) return !0;
  return $5t().allHookEventsEnabled && Hh.includes(e);
}
```
[`~/claude-code-bundle/2.1.257/cli.pretty.js:46819`, `:46829-46834`], armed at `:454206-454207`
(`if (In || a.CLAUDE_CODE_REMOTE) V8n(!0)`). The frames reach stdout through `hu` → the enqueue
listener `Yoe` → the headless outbound queue: `py()` at `:174617-174623` wires the drain into the
active output stream, and `runHeadlessStreaming` re-wires it at `:175268-175270`. The SDK pushes the
flag (`if (this.options.includeHookEvents) Z.push("--include-hook-events")`, `sdk.mjs`; spec
§45.27.1 cites `chunk-h4qd2c1j.js:530108`). Present and identical in 2.1.251.

**Why the verdict is wrong, not merely narrow.** Probe 53b's own assertion string self-limits to
*"dead for **programmatic hooks** headless"* (`probes/probes/53b-hookevents-suggestions-retry.ts:27`),
and it ran with `settingSources: []` (`:17`) — i.e. **no command hook existed that could emit a
frame**. The docs generalised that to a flat 🚫. Eleven days later probes 116/119 measured the frames
live with `includeHookEvents: true`, and `harness/src/tui/hookPairs.ts` was built on them. Today
`harness/src/host/host.ts:571` sets `includeHookEvents: this.opts.config.includeHookEvents ?? true`
for every interactive ccx session. **We ship a feature the scorecard calls permanently out of reach.**

**Status: verified** (bundle + our own shipped code + probes 116/119).

**Proposed probe** — the one thing genuinely untested, per the probe audit: *no probe has ever varied
the flag*. Run probe 119's case 1 twice, identical except `includeHookEvents` true vs omitted, with a
settings-layer command hook on **SessionStart** and on **PreToolUse**. The spec predicts a sharp
split: SessionStart frames appear in *both* arms (unconditional via `J2r`), PreToolUse frames only in
the flag arm. That single run confirms the mechanism, fixes the ledger row, and tells us the exact
cost of leaving the flag on by default.

---

### P3 — "SessionStart is dead at startup AND resume" is true only of the callback species; the settings-layer species is alive and *needs no flag*

**Verdict as recorded.** `docs/parity/coverage.md:25` (*"SessionStart stays dead at startup AND resume, so the 0.3.251 resume-staleness fields are out of reach"*), `docs/parity/full-potential.md:177` (probe 122), and `docs/superpowers/specs/2026-06-18-hooks-support-design.md:36` (probe 10). **Partly retracted already:** the 2026-09-01 correction at `coverage.md:802-826` lists `SessionStart` among the 24 of 33 events that fire headlessly. The rows below it did not follow, and the *resume* half and the *frame* half were never measured at all — which is what this entry is about.

**What the spec says.** §45.14.6 + `J2r = ["SessionStart", "Setup"]` [`cli.pretty.js:46819`, verified]: these two events' `hook_started` / `hook_progress` / `hook_response` frames are emitted in **every** headless run, short-circuiting the `allHookEventsEnabled` test. §45.4.2 further documents `--init-only` as *"Runs Setup and `SessionStart:startup` hooks, then exits 0"* [`chunk-chr1kh62.js:454869`] — the hook demonstrably runs headlessly. Ch. 27 §16.3 names the SDK resume path as a SessionStart call site [`chunk-2rhzyjym.js:179275`].

Our own probe 119 already recorded a live `SessionStart:startup` pair firing **before `system/init`**
(`probes/probes/119-hook-event-census.ts:50-51`, `:61`) at SDK 0.3.237 — the same day the "dead"
verdict was re-filed. `full-potential.md:173`/`:177` and `119-hook-event-census.ts:50` are in the
repo contradicting each other, neither citing the other. Probes 10 and 122 could not have seen this:
probe 10's loop reads only `m.type === "assistant"` and `"result" in m`
(`probes/probes/10-hooks-sessionstart.ts:48-56`); probe 122's reads only `system/init` and `result`
(`:50-53`) and never sets `includeHookEvents`.

**What this actually costs us.** The *capability* — inject deterministic context at session start,
including on resume — is reachable today: write a SessionStart command hook into `options.settings`
and it runs, injects `hookSpecificOutput.additionalContext`, and can even open the session with a
prompt already submitted via `initialUserMessage` (ch. 27 §16.2). The resume dedupe `rLe` (§16.3)
even exists to keep replayed transcripts clean. We wrote it off.

**Status: verified** (bundle + our own probe 119).

**Proposed probe.** One `query()` with `settingSources: []` and an `options.settings` JSON declaring a
SessionStart command hook that (a) writes a marker file and (b) emits
`{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"CODEWORD-<uuid>"}}` on
stdout. Assert three things separately: the marker file exists; a `system/hook_started` with
`hook_name: "SessionStart:startup"` arrives **with `includeHookEvents` omitted**; and the codeword is
recalled by the model. Then repeat with `resume: <id>` and `source: "resume"` to see whether the
0.3.251 resume-staleness fields (`full-potential.md:177`) arrive on the *settings* channel. The whole
🚫 row turns over on the third assertion.

---

### P4 — `default_to_no` is one of **five** dropped `can_use_tool` fields, not one

**Verdict as recorded.** `docs/parity/full-potential.md:103`: *"the field lives only on the raw
`SDKControlPermissionRequest` wire frame; the SDK's `CanUseTool` options type … does not forward it —
signal/suggestions/blockedPath/decisionReason/title/displayName/description/toolUseID/agentID/
requestId/matchedAskRule and nothing else."* Also `coverage.md:25`.

**What the spec says.** §45.19.1 gives the full request construction [`chunk-zjj1wsm3.js:851366`,
verified verbatim in 2.1.257 and present in 2.1.251]. The CLI sends **sixteen** fields. The SDK's
`processControlRequest` (`sdk.mjs`, verified) forwards exactly eleven. Dropped:

| wire field | declared in `sdk.d.ts` | forwarded to `canUseTool` | policy meaning (§45.19.1 verbatim) |
|---|---|---|---|
| `default_to_no` | yes, `sdk.d.ts:4080` | **no** | "must not be approvable by a single stray keystroke … should not pre-select approve" |
| `suppress_always_allow_rule` | yes | **no** | "must not offer the persistent 'don't ask again' row … accepting it would write a whole-tool allow rule broader than the ask's own verb" |
| `requires_user_interaction` | yes | **no** | "one-tap Approve/Deny must not be offered: the tool's approval card IS the user-interaction surface" |
| `classifier_approvable` | yes | **no** | whether an auto-classifier may decide this ask |
| `decision_reason_type` | yes | **no** | discriminator (`"safetyCheck"`, `"subcommandResults"`, `"mode"`, `"rule"`, `"classifier"`, `"asyncAgent"`…) |

Three of those are exactly the fields a permission **dialog** needs to render correctly, which makes
this a ccx-visible defect, not just a library gap: our permission card can offer "always allow" on an
ask whose own decision says it must not, and can pre-select approve on an ask marked
`default_to_no`. `harness/src/permissions/gate.ts:7` names three of them in a comment and reads none.

**Status: verified.** Note the recorded basis was a **type read** (`full-potential.md:103` says
"checked against 0.3.251 … the SDK's `CanUseTool` options *type*"), and probe 78 predates the field
entirely (SDK 0.3.220, and it string-checks six *other* names at `78:104`). Nobody has looked at a
live consult.

**Proposed probe.** Two halves, one run. (a) A `canUseTool` that `JSON.stringify`s the **entire**
third `options` argument (not a name list) on a consult forced by an outside-`cwd` Read — probe 78's
one reliable trigger — plus a `Bash` compound command like `rm -rf ./x && echo ok` under
`permissionMode: "default"`, which is the shape most likely to carry `decision_reason_type:
"subcommandResults"` and `default_to_no`. Confirms the drop list on the pinned SDK rather than from
the `.d.ts`. (b) Same session, an `--permission-prompt-tool` arm via an SDK MCP tool: §45.23.2 says
that surface receives only `{tool_name, input, tool_use_id}` — strictly less — so if (b) is confirmed
the conclusion is that **no** SDK seam can reach these five, and the row should be widened from one
field to five and closed. The one thing *not* to try: `PermissionRequest` hook input carries only
`tool_name`/`tool_input`/`permission_suggestions` (ch. 27 §3.2, interface `PermissionRequestInput`,
[`chunk-1kg58a1a.js:76209`]), so it is not a recovery path.

---

### P5 — "interrupt spares background tasks" is missing two conditions

**Verdict as recorded.** `docs/parity/full-potential.md:135`: *"Probes 126/126b: `stopTask()` WORKS;
the Options declaration is a headless no-op because the spare behavior is already on … a running
background `sleep 90` was HELD through an interrupt in BOTH the declared and undeclared phases — the
documented fail-closed kill never fired, most plausibly because the SDK transport declares the
affordance itself."* The causal half is explicitly inference — no probe reads the `initialize` frame.

**What the spec says.** §45.22.1 + §45.18: the spare/kill choice is a live branch, not a constant —

```js
  }, xn = () => {
    let f = { taskRegistry: Om(w, v), setAppState: v, storageV5: C.storageV5 };
    if (rnt())
      y("per_task_stop_sparing", { spared: !0 }), SKe(f), Wn();
    else
      y("per_task_stop_sparing", { spared: !1 }), nY(f);
```
[`cli.pretty.js:175177-175184`, verified], with
`function rnt() { return n().surfaceCapabilities.sdkPerTaskStopAffordance() === !0; }`
[`:243754-243756`, verified]. And the `perTaskStopAffordance` schema text (§45.18, verbatim) states
the carve-out our verdict omits:

> **Closed-input exception:** a one-shot run (string prompt / `-p` closes stdin) still kills hold-back
> tasks at the held-result release regardless of the declaration — with stdin closed, a `stop_task`
> control could never be delivered, so the fail-closed kill stands.

Verified as a real predicate:
`function xm({ inputClosed: e, runningTasks: n }) { return e && n.some((r) => BM(r) && tm(r)); }`
[`cli.pretty.js:174124-174126`], consumed at `:176506`.

So our verdict is right for the case we measured (an open-input streaming session) and wrong for the
one-shot `query({ prompt: "string" })` shape — which is the shape the library's own
`hasBidirectionalNeeds()` gate closes stdin on as soon as the first `result` lands. Two things are
unmeasured: whether `rnt()` is genuinely true in the undeclared phase (and if so, *why*), and whether
a one-shot run kills.

**Status: verified** (bundle). **251-vs-257:** unchanged.

**Proposed probe.** Three arms, one background `sleep 90` each. **A** streaming session, no
`perTaskStopAffordance` — and additionally log the `system/init` `capabilities` array, which is the
observable proxy for what the transport declared. **B** identical but `perTaskStopAffordance: true`.
**C** a *one-shot string prompt* whose turn launches the background task and is then interrupted;
watch `background_tasks_changed` for a membership drop after the result. The spec predicts C kills
where A and B spare. If A also spares, the follow-up question is what sets
`surfaceCapabilities.sdkPerTaskStopAffordance()` on our transport — worth capturing the outbound
`initialize` frame with a `spawnClaudeCodeProcess` shim that tees the child's stdin.

---

### P6 — the hook-event census: coverage.md is already corrected; `full-potential.md` is not, and the correction stops one step short

**Verdict as recorded — and already superseded on one side.** `docs/parity/coverage.md:797` still
prints "**8 of 30 events fire headlessly**" but now carries a **CORRECTED 2026-09-01** block
immediately below (`coverage.md:802-826`) that supersedes it: *"the number is 23 of 33, and the
population itself was wrong … The enumeration now comes from upstream's own dispatcher registry …
snapshotted as `reforge/research/fixtures/hook-registry-2.1.251.json` … It holds **33 events**, not
the SDK's declared 30, and nothing outside it can fire."* It lists **24 of 33** as firing, explicitly
including `SessionStart`, `SessionEnd`, `PreModelSwitch` and `PostModelSwitch`. That work independently
reaches the same population the spec documents (ch. 27 §2.1's `Hh`, `chunk-ejcy5qcd.js:486611`), and it
independently corroborates **P3**.

**What is still wrong.** `docs/parity/full-potential.md` was never updated to match. Three rows
contradict the corrected coverage block and the spec at once:

- `:171` — *"Programmatic `hooks` (all **30** events reachable) … **17/30** verified-fired"*
- `:173` — *"Wave 2 probes 42/43b — **17/30** FIRE … `SessionStart` fires at the **/compact boundary**
  (not initial startup)"*
- `:177` — probe 122's 🚫, whose stated reasoning is *"consistent with the Wave 2 census (SessionStart
  fires headlessly only at the /compact boundary)"* — i.e. it rests on the very number the
  2026-09-01 work retracted.

**Where the correction stops short, and the spec supplies the missing axis.** The corrected census
measures **whether the hook runs**. It does not measure **whether anything surfaces on the wire**, and
the spec shows those are different questions with different answers: `SessionEnd` is in the corrected
"fires" list, yet probe 119 recorded it emitting **zero** frames — and §3/E3 gives the mechanism.
Symmetrically, callback-species hooks run but never emit frames at all (§3/E2). So the honest scorecard
needs two columns, not one: *runs* (24/33, measured) and *observable* (measured for six events only).

**Status: verified** (the corrected block, `full-potential.md`'s three rows, and the spec's 33-member
`Hh` all read directly).

**Proposed probe.** Not a new census — that is done. The gap is the second column. Re-run
`reforge/w5/probe-hook-events.ts`'s created-condition harness once more with the hooks declared as
**settings-layer `command` hooks** and `includeHookEvents: true`, recording per event two independent
signals: a marker file (ran) and a `system/hook_started` frame (surfaced). The spec predicts a clean
partition — `SessionStart`/`Setup` surface with the flag *omitted*; the other command-hook events
surface only with it; `SessionEnd` never surfaces; and callback-registered hooks never surface on any
event. One run closes P2, P3 and P6 together and turns the census into the two-column table the
scorecard actually needs.

### P7 — `deferred_tool_use` is an unmodelled *terminal* state that our success classifier reads as success

Not a dead/alive flip; a hole. §45.11.1 / §45.25.5: a `result` of subtype `"success"` may carry
`stop_reason: "tool_deferred"` and a `deferred_tool_use: { id, name, input }` object — the turn is
**incomplete**, and the documented continuation is *resume that session with an empty prompt*
(§45.6 note 7: an empty prompt plus `--resume` is interpreted as "continue the deferred tool", with
its own error string when the marker is stale). `terminal_reason: "tool_deferred"` is deliberately
*not* in the hard-failure set `bEt` (§45.25.4).

`harness/src/session/turnResult.ts:42` keys success on `is_error !== true && !(status >= 400)`, so a
deferred turn classifies as a clean success and the deferred call is silently lost.
`deferred_tool_use` has **zero** hits in `harness/src`. We already know `defer` parks the call
(`full-potential.md:172`, probe 42b) — we just never modelled the resume half.

**Status: verified** (spec + our source). Not a probe candidate; it is a plain implementation gap.

---

### P8 — `queued_turn_count > 0` was never exercised, and the spec says why probe 123 could not have

`docs/parity/full-potential.md:56` records the `>0` reading as unexercised because the two extra sends
"FOLDED into the running turn". §45.11.5 gives the field's own contract verbatim, which explains the
fold and names the shape that *would* produce a non-zero:

> *"Queued sends may coalesce into fewer turns, so this counts **pending sends**, not remaining
> results. System-generated queue entries are not counted."*

Combined with §45.22.1's `still_queued` semantics (only **uuid-stamped main-thread** commands appear;
cancelling a non-representative member of a coalesced batch is a no-op), the probe design that yields
`>0` is: push sends while the session is in `requires_action` (parked on a `can_use_tool`) rather than
mid-turn, since a parked turn cannot fold them. That is a cheap redo of probe 123 with a permission
park instead of a `sleep`.

---

## 2. Unmodeled surface

Reachability legend: **A** = reachable today through a typed `Options` field; **B** = reachable
through `extraArgs` (`sdk.d.ts:1537`: `Record<string, string|null>`, keys without `--`, `null` for a
boolean flag — and the SDK itself uses this channel, injecting `workload` at spawn); **C** = reachable
only by reading frames the SDK passes through untyped; **D** = not reachable (control envelopes are
swallowed by `Query.readMessages`).

### 2a. CLI flags with real product value, absent from `harness/src` and from all four parity docs

| Flag | Reach | Why it matters here |
|---|---|---|
| `--workload <tag>` | **A/B** — `sdk.mjs@0.3.251` destructures a `workload` option and injects it into `extraArgs`, but `sdk.d.ts` does **not** declare it, so it is live-but-undeclared (pass it through `extraOptions`, or as `extraArgs: { workload: "<tag>" }`) | Emits `cc_workload=` inside `x-anthropic-billing-header` (§45.30.4). This is per-tenant billing attribution for `tenantHarnessConfig` / the secure-deployment guide — a capability we wrote a whole guide around and then attributed nothing with. |
| `--exclude-dynamic-system-prompt-sections` | **A** (nested: `systemPrompt: { type:'preset', preset:'claude_code', excludeDynamicSections: true }`, `sdk.d.ts:2116, example at :2154`) | Moves per-machine sections into the first user message so a **static system-prompt prefix caches across users**. `sdk.d.ts` labels the example "Cacheable prompt for multi-user fleets". Direct cost lever for the warm-pool/multi-tenant service. `harness/src/config/outputStyle.ts:42` mentions the name; nothing sets it. |
| `--system-prompt-snapshot <on\|off>` | **B** (no `Options` field; `initialize.systemPromptSnapshot` is stream-only) | "Record the prompt once and reuse it verbatim on every later request and resume" (§45.18 verbatim). Cache stability across resume, which the session-persistence spine cares about. |
| `--append-subagent-system-prompt <text>` | **B** | Appends to **every** Task subagent and propagates to nested ones. The natural pairing for `modelSwitchPolicy`-style governance, which today governs only the main loop. |
| `--replay-user-messages` | **B** | Echoes every submitted user message back as `isReplay: true` (§45.12.3) — a delivery ACK for the daemon's async submit path. `harness/src/appserver/peerPolicy.ts:65` names it in a comment only. |
| `--init-only` | **B** | Runs Setup + `SessionStart:startup` hooks and exits **0**. A zero-token config/hook verifier — useful as a daemon warm-check and as the cheap arm of the P3 probe. |
| `--enable-auth-status` | **B** | Emits `auth_status` frames; auth state without polling `accountInfo()`. Zero hits anywhere. |
| `--messaging-socket-path` | **B** | When bound with `stream-json` output it *implicitly* enables user-message replay (§45.4.2). Relevant to our cross-session messaging work; `harness/src/peer/roster.ts:50` has the camelCase name only. |
| `--thinking-display <summarized\|omitted>` | **B** (`thinkingDisplay` is in `_sdk-surface.md` but not `Options`) | Controls whether thinking content reaches the response at all. |

### 2b. Control-request subtypes documented by the spec with zero mention in `harness/src` **or** any parity doc

Reach is **D** for every host-answered (A→C) subtype and for anything requiring us to originate a
control frame the SDK has no method for. Listed because §45.17 is the first complete catalogue we
have (66 rows: 50 published + 16 unpublished) and several are things we have wanted:

- **`side_question`** (unpublished, `chunk-2rhzyjym.js:178330`) — a one-shot model call *outside the
  conversation*, and the only control request with progress reporting
  (`system/control_request_progress`) and cancellation. This is precisely the "warm suggester" shape
  P1 is about, and precisely what `/btw` uses. **D** on our channel (no SDK method), but worth
  knowing it exists before we build a third homemade side-channel.
- **`get_workspace_diff`**, **`get_plan`**, **`read_file`**, **`file_suggestions`**,
  **`seed_read_state`** — read surfaces the app-server re-implements locally.
- **`update_settings`** — worth recording precisely because it is a trap: §45.22.8's seven-step
  validator `A_` allows **exactly one key, `outputStyle`**, string values only, `localSettings` only,
  and refuses over a remote transport. Anyone who assumes it is a general settings writer will be
  wrong.
- **`get_usage`**, **`get_session_cost`**, **`get_binary_version`**, **`list_models`**,
  **`cancel_async_message`**, **`message_rated`**, **`rewind_conversation`**, **`generate_session_title`**,
  **`submit_feedback`**, **`end_session`**, **`set_cwd`** (the only request that can relocate a live
  session, with a three-arm `ok|needs_trust|rejected` response — §45.22.6).
- **`hook_callback`** and **`mcp_message`** have zero hits in `harness/src` even though we drive both
  every day through the SDK's abstractions. Harmless, but it means nothing in our code names the
  round trips it depends on.

### 2c. Stdout frames the CLI emits that neither our code nor `sdk.d.ts` knows about

Reach **C** — the SDK hands these to our iterator untyped, so any `switch (msg.subtype)` we write
silently drops them. Verified absent from `sdk.d.ts@0.3.251` by grep:

`tool_host_result` · `bridge_state` · `turn_starting` · `model_fallback` · `model_consent_fallback` ·
`code_change_published` · `vcs_state_changed` · `feedback_draft_queued` · `post_turn_summary` ·
`task_summary` · `autocompact_state`.

Two of these matter to us now:

- **`system/model_fallback` and `system/model_consent_fallback`** (§45.9.1) — availability- and
  consent-driven model changes. We built `modelSwitchPolicy` around `PreModelSwitch`/`PostModelSwitch`
  hooks; these frames are the *other* half of the same story (the fallback path, which
  `full-potential.md:176` explicitly notes probe 121 never exercised) and they are neither in the
  published union `hor` nor in `sdk.d.ts`. `harness/src/tui/species.ts:615` names `model_fallback` in
  passing; nothing consumes it.
- **`assistant.supersedes: string[]`** (§45.12.1) — "uuids this frame replaces", carrying
  evict-the-named-messages semantics, emitted on refusal fallback. Zero real hits in `harness/src`.
  Paired with §45.13.1's synthetic close events (a retracted partial stream emits fabricated
  `content_block_stop` + `message_delta{stop_reason:"refusal"}` + `message_stop`), this is a live
  correctness path for any consumer of `includePartialMessages` — which ccx's `liveTurn` is.

### 2d. `initialize` options we never send

`webSearchIsolationExemptMcpServers` (stream-only, no flag), `sdkMcpServerConfigs` (per-server
timeout — we ship `mcpToolTimeoutMs`, so check whether we route through this or through
`mcpServers[].timeout`), `systemPromptSnapshot`, `appendSubagentSystemPrompt`,
`excludeDynamicSections`. Also worth pinning from §45.18: `initialize` is **optional** and *repeatable*,
but a repeat re-applies **only** `hooks` (and only from the process owning stdin), `title`,
`sdkMcpServers` and `agentProgressSummaries` — everything else is one-time session setup. Our
`Session.reinitialize()` (`harness/src/session/session.ts:294-308`) is built on the repeat path;
§45.18.3's table is the exact contract for what it can and cannot change, and
`response.hooks_applied` is the field that reports whether it took.

### 2e. Capability tokens

`system/init.capabilities` (§45.10.3) carries `interrupt_receipt_v1`, `interrupt_cancel_queued_v1`,
`msg_lifecycle_v1` by default. `sdk.d.ts:5002` documents only three tokens and **omits
`msg_lifecycle_v1`** — which is the one that tells us `command_lifecycle` frames will flow. Zero hits
in `harness/src` for any token name. Feature-detection over version-sniffing is the intended contract
and we do neither.

---

## 3. Explanations — mechanisms for things we already know are dead

### E1 — Why an SDK-registered `SessionStart` hook can never fire, at startup or at resume

The SessionStart hook promise is created **before the print chunk is even imported**, and therefore
before any transport exists to read an `initialize` frame:

```js
  let J = performance.now(),
      Ee = n.continue || n.resume || z || Yt ? void 0
         : h8(dt, { kind: "session-start", source: "startup", … }).then(…);
```
[`~/claude-code-bundle/2.1.257/cli.pretty.js:504124`, verified], handed to `runHeadless` as
`sessionStartHooksPromise: Ee` at `:504150`. On the `--resume` / `--continue` branch `Ee` is
`undefined`, so the hooks are instead run *inside* `runHeadless` at `:179272` / `:179337` — but that
is in the transcript-loading path (`Wy`, called at `:174772`), still **before**
`runHeadlessStreaming` installs the stdin reader and the control dispatcher (`:174919`, message loop
at `:177137`). The `initialize` deferred that gates the message loop (§45.18.5) has not resolved yet
either way.

**Consequence: stop probing this.** No host-registered callback can be present at the moment
SessionStart runs, on any path. The capability is reachable only through the settings/plugin hook
layer (P3), which is loaded from disk before the same point.

### E2 — Why in-process `options.hooks` callbacks emit **no** lifecycle frames, flag or not

Probe 116's "positive control B" found this empirically; the mechanism is two-part and both parts are
verified.

First, the hook runner splits on whether any **non-internal** hook matched:

```js
  let ot = Dnr(_e, d), pt = Ge.filter((bn) => !Mnr(bn));
  if (pt.length > 0) { … full path … }
  else { … callbacks-only fast path … return; }
```
[`cli.pretty.js:149574-149597`], with
`function Mnr(e) { return e.hook.type === "callback" && e.hook.internal === !0; }` [`:149312-149314`].
The `else` arm runs the callbacks, honours `permissionBehavior`/`additionalContext`/`systemMessage`,
fires `tengu_repl_hook_finished`, and **returns** — never reaching the emitters.

Second, and decisively, even on the full path the `hook_started` emitter `ASe` is called from exactly
three sites, and none of them is the callback branch: the `http` arm [`:149696`], the `prompt` arm
[`:149724`], and the `command`/`script` arm [`:149756`]. `callback`-type hooks are dispatched by
`zJo` [`:150267-150272`], which emits nothing.

**Consequence:** `hook_started`/`hook_progress`/`hook_response` are a property of *command-family*
hooks. `harness/src/tui/hookPairs.ts` is correct to self-instrument callbacks separately. And there
is a workaround worth knowing: registering a trivial no-op **settings** hook for the same event puts a
non-internal hook in `pt`, forcing the full path — so a callback's execution becomes observable on the
wire alongside it.

### E3 — Why `SessionEnd` is dead on the wire even though the hook runs

Probe 119 recorded "the hook demonstrably RAN (marker file written) yet emitted ZERO frames". The
mechanism: `SessionEnd` is the **one** event exempted from the shutdown fence —

```js
function mnr(e, n) { return e !== "SessionEnd" && po() && !n?.aborted; }
```
[`cli.pretty.js:149510`, verified] — precisely so it can run *inside* the shutdown pipeline, which is
where it is invoked: `shutdown()` dynamically imports `executeSessionEndHooks` at
[`chunk-1kg58a1a.js:161906-161910`]. By then the headless message loop has ended
(`cli_message_loop_ended`, `chunk-2rhzyjym.js:178797`), the hook-frame enqueue listener has been
unregistered (`Yoe(null)`, `:178816`), and the outbound queue has been closed (`bt.done()`, `:178818`).
The frames have nowhere to go. **This can't be fixed from our side** — record it as structural, not
as an untested gap.

### E4 — Why a bare `-p` run's `ask` is terminal (and what the only signal is)

§45.19.6, verified at [`chunk-2rhzyjym.js:178892-178897`]: with neither `canUseTool` nor
`--permission-prompt-tool`, `Fy` returns a wrapper that evaluates the rules and, on any non-`allow`,
emits `system/permission_denied` and denies. The `permission_denied` schema (§45.14.3) states the
boundary precisely and is worth quoting to anyone reasoning about denial observability:

> *"Best-effort advisory: in rare races a denial can book without a frame or a frame can lack a
> booking twin — **`result.permission_denials` is the authoritative record**. Denials that resolve
> before canUseTool runs — PreToolUse hook denies, and deny-rule overrides of hook allow/ask
> decisions — are not covered here, and neither is the MCP `--permission-prompt-tool` surface."*

This closes an old loose end: probe 05 recorded `SDKPermissionDeniedMessage seen: false` on a
`canUseTool` deny (`docs/parity/probe-results/05-canusetool.txt:3`) and never explained it. The
explanation is above — a broker deny is not one of the covered cases, and `permission_denials` on the
result is where to look. `permission_denials` has **zero** hits in `harness/src`.

### E5 — Why `--forward-subagent-text` does not govern asynchronous Tasks

§45.9.4, [`chunk-1kg58a1a.js:98580-98588`]: a Task launched with `isAsync` writes *every* split
`assistant`/`user` message straight to the headless output stream as `agent_progress`, with **no**
`forwardSubagentText` test — only the nested re-forward consults the flag. Since
`full-potential.md` records agent spawns as *background-by-default on the SDK transport*
(`task_started.is_backgrounded`, probe 127), this means subagent prose reaches our stream whether or
not we asked for it. It also means `parent_tool_use_id` is a **correlation key, not an ordering
promise**: an async Task returns `status: "async_launched"` immediately
[`chunk-1kg58a1a.js:101823`], so its closing `tool_result` is written *before* the progress records it
correlates with. Anything in `harness/src` that assumes nested frames arrive between the opening
`tool_use` and its `tool_result` — `items/mapper.ts:74`, `router.ts:274`, `search.ts:405`,
`liveTurn.ts:138` all key on `parent_tool_use_id` — should be checked against that.

---

## 4. Verbatim assets worth pinning (we have none of these verbatim)

Pointers, not paste. All from `45-headless-and-sdk-protocol.md` unless noted.

1. **The `fy` filter, verbatim** (§45.9.2, `chunk-2rhzyjym.js:174615-174617`) — the exact list of
   frame types/subtypes that are written to stdout under `stream-json` but excluded from
   `json --verbose` and from "last message". The single most useful constant for anyone writing a
   consumer, and it is 22 subtypes long.
2. **Filter 1 `Cu`'s dropped list** (§45.9.2, `:172546-172569`) — 23 internal message types that
   *never* reach the wire (`tombstone`, `stream_request_start`, `sdk_status`, `compact_progress`,
   `set_expanded_view`, `hint_clears`, `api_metrics`, `os_notification`, `refusal_continuation`,
   `query_model_change`, …). This is the definitive "you will never see this" list; we have been
   inferring it one probe at a time.
3. **The `progress` → wire mapping table** (§45.9.4 + ch. 12 §12.14.2/3) — five branches, everything
   else vanishes silently. Names the six internal progress types that produce **nothing**
   (`waiting_for_task`, `search_results_received`, `query_update`, `hook_progress`, `mcp_progress`,
   `workflow_*`). Explains several "we can't see X" observations at once.
4. **`terminal_reason`, all 19 values plus the two partition predicates** `PP` (interrupt:
   `aborted_streaming`, `aborted_tools`) and `bEt` (hard failure, 11 values) —
   `chunk-sct99ax9.js:673347-673351`. `harness/src/session/turnResult.ts` approximates this from
   probes; the canonical partition is better. `sdk.d.ts:8318` has the value list but neither predicate.
5. **`total_cost_usd` / `modelUsage` / `usage` / `queued_turn_count` lifecycle docs** (§45.11.5,
   verbatim) — in particular *"`usage`: MAIN AGENT LOOP ONLY … Prefer `modelUsage`"* and
   *"cumulative across turns in streaming-input sessions — read the latest result rather than summing
   across results … a mid-session `/clear` resets the running total"*. Direct correctness input for
   `/cost` and for `docs/parity/06-cost-token-tracking.md`.
6. **The stdin `user` frame's runtime-accepted-but-undeclared keys** (§45.12.2 table) —
   `file_attachments`, `turn_id`, `relay_message_ids`, `relay_rows`, `relay_thread_ts`,
   `receiver_grouping_id`, `activity_observation`, `artifact_followup{,_url}`, with the reader and the
   accepted shape for each. Relevant to the cross-session/peer work.
7. **`origin`'s nine `kind` values and its security note**, verbatim: *"A host wrapping keyboard input
   must stamp `{kind:'human'}` explicitly — absent origin is treated as unattributed and fails closed
   at strict `isHuman()` trust gates."* We do stamp it (`harness/src/session/session.ts:52`); the
   nine-member vocabulary (`human`, `channel`, `peer`, `task-notification`, `coordinator`,
   `unclassified`, `observer`, `auto-continuation`, `observer-activity`) is not written down anywhere
   on our side.
8. **`tool_result_meta.non_execution_kind` vocabulary** (§45.12.2): `["user-rejected",
   "permission-rule", "automode-blocked", "automode-unavailable", "automode-parsing-error",
   "interrupted", "cancelled"]`, plus the note that *a deny answered through the SDK control protocol
   reports as `permission-rule` with no `user_feedback`, "because that wire carries no
   human-provenance signal"*. Explains why our denial reasons render as rule denials.
9. **The 20 `prompt_suggestion` suppression reasons and the 12 literal text filters** (§45.14.8),
   including the exact one-word allowlist and the `>12 words` / `≥100 chars` thresholds.
   `harness/src/tui/suggester.ts` transcribes these from 2.1.220 — worth a diff against 2.1.257.
10. **The four flag/env asymmetry and validation error strings** (§45.5) — 20+ exact stderr messages,
    plus the three "combinations that are *not* validated" (§45.5.7), plus the note that the CLI
    silently drops `--fallback-model === --model` while the SDK throws.
11. **`--resume`'s three value shapes** (§45.5.6): a `.jsonl` path, a UUID, or a URL — the URL form
    deriving a **UUIDv5 under the fixed namespace `3ab19d7e-9f35-45c2-926e-75e271cc60b3`**, so the
    same URL always maps to the same session id. Nothing on our side knows `--resume` takes a file
    path.
12. **Exit-code table** (§45.32.2) — 14 rows including the two non-obvious ones: **exit 0 when no
    `result` was produced at all** under `stream-json` (the format switch just `break`s), and 129 for
    SIGHUP with a backend-dependent handler. Our daemon's supervisor treats a clean exit as success.
13. **`initialize` repeat semantics table** (§45.18.3) and the **three fail-safe answers for retired
    hook callbacks** (verbatim, `chunk-2rhzyjym.js:173351`) — the exact strings a host sees when a
    re-`initialize` races an in-flight `hook_callback`. Directly relevant to `Session.reinitialize()`.
14. **`system/init`'s full field shape** (§45.10.4) including the two undeclared runtime additions
    (`messaging_socket_path`, `startup_timing`) and the `apiKeySource` vocabulary note that
    `'user'|'project'|'org'|'temporary'|'oauth'` are **legacy members current CLIs never emit**.

---

## 5. Confirmations

- `system/init` is emitted **at the start of every turn**, not once per process (§45.10) —
  `harness/src/host/host.ts:44-49` says exactly this and builds on it.
- `is_error`, not `subtype`, is the success discriminator; a `subtype: "success"` result can be an
  error (§45.11.1/§45.11.2). `harness/src/session/turnResult.ts:29-52` (from probe 96) is right.
- Exactly one `result` per turn, and *informational* system frames may follow it (§45.11 schema note).
- `queued_turn_count` is present and optional on both result variants (§45.11.1) — probe 123 confirmed.
- `PreModelSwitch` / `PostModelSwitch` are real, hook-gated, and serialise model switches against each
  other (§45.22.4) — probe 121's "deny cancels the switch and rejects `setModel()`" matches
  `zO(e) || Jv.of(e).pending > 0`.
- SDK MCP server registration is **name-keyed and pins the timeout until removed and re-added**
  (§45.18.3, §45.27.5) — our `mcpToolTimeoutMs` "declared values win, injected introspection tools
  exempt" behaviour is consistent with the CLI's own "already registered; its timeout change is
  ignored" log.
- `interrupt` returns a receipt with `still_queued`, advertised via the `interrupt_receipt_v1`
  capability (§45.22.1) — matches Wave 1.
- `maxBudgetUsd` exhaustion is a real terminal state with `terminal_reason: "budget_exhausted"` and
  its own result subtype, and it also refuses new subagent launches (§45.25.2) — consistent with
  "pass-through-don't-swallow".
- `taskBudget` is forwarded to `output_config.task_budget` and *not enforced locally* (§45.25.3) —
  consistent with the opus-only 400s we observed (the rejection is API-side, as we inferred).
- Structured output: Ajv **draft-07**, `validateFormats: false` (§45.24.3) — exactly the constraint
  `runStructured<T>()` hit when zod emitted a 2020-12 `$schema`.
- `--session-mirror` is the flag behind `sessionStore` (§45.27.1) — matches W3.3.
- `settingSources` can only *exclude* `user`/`project`/`local`; `flagSettings` and `policySettings`
  always apply (§45.28.2) — worth knowing for `settingSources: []` probes: they do **not** produce a
  settings-free CLI.
- SDK `query()` spawns the CLI; `canUseTool` pins `--permission-prompt-tool` to the literal `stdio`
  (§45.23.1, §45.27.1) — matches probe 05's control-channel requirement.

---

## 6. Spec defects

1. **§45.14.8's `prompt_suggestion` gate list omits the emitter's environment-variable term.** The
   section enumerates 20 suppression reasons but never states the enclosing condition, which in
   2.1.257 is `C.promptSuggestions && ot.shouldQuery !== !1 && !Vi() &&
   a.CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION !== !1` [`cli.pretty.js:176548`], nor the
   `CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION`-truthy short-circuit in the enable function
   [`:119160-119163`] that bypasses both the `tengu_chomp_inflection` gate and the non-interactive
   check. Since §45.31.2 separately asserts *"Prompt suggestions are refused with source
   `non_interactive`"* without that carve-out, a reimplementer following the spec would build a
   feature that can never fire headlessly — the opposite of the shipped behaviour. This omission is
   also what makes our own stale verdict hard to catch from the spec alone.

2. **§45.14.6 undersells the callback-hook exclusion.** It gives the `xSe` event gate correctly but
   implies that with `allHookEventsEnabled` all 33 events emit lifecycle frames. In fact `ASe`
   (`hook_started`) is reachable only from the `http`, `prompt` and `command`/`script` arms
   [`:149696`, `:149724`, `:149756`]; `callback` hooks — the entire SDK-host path, which is the
   chapter's own subject — emit nothing on any event. Ch. 27 §12.5 has the same gap. This is the
   single most consequential missing sentence for an SDK-host reimplementer, and the chapter that
   owns the SDK protocol is where it belongs.

3. **§45.10.2's `slash_commands` description conflicts with §45.29.1.** §45.10.2 says
   `slash_commands` is "every command with `userInvocable !== false` — **including** custom, plugin
   and MCP-prompt commands", full stop. §45.29.1 then documents `uer` — the headless filter, `prompt`
   commands minus `disableNonInteractive`, plus `local` commands with `supportsNonInteractive` — and
   says it is "applied wherever the headless command list is (re)built". Both cannot be the print-mode
   `system/init` content. The chapter resolves this only obliquely ("yet a third list"); a
   reimplementer needs to be told *which* list `system/init.slash_commands` carries in print mode,
   because that is the list an SDK host renders. Not resolved by my reading either — flagging rather
   than asserting.

4. **~~Denominator drift not flagged.~~ WITHDRAWN on re-verification against the live checkout.** I
   originally filed this as a spec defect: ch. 27 §2 and §45.18.1 state 33 hook events while the SDK
   exports fewer. That was an artefact of reading a frozen `0.3.250` checkout, whose `HOOK_EVENTS` has
   31. The pinned SDK in this repo is **0.3.251**, and its `HOOK_EVENTS`
   (`sdk.d.ts:853`) lists **33**, `PreModelSwitch` and `PostModelSwitch` included. The spec is correct
   and the SDK agrees with it. What remains is *our* drift, not the spec's: `full-potential.md:171`
   still says "all 30 events" and `docs/parity/coverage.md:756` still says "`Options` fields | 63 —
   ALL modeled", while 0.3.251 declares **65** `Options` fields — plus an undeclared-but-live
   `workload` option (present in `sdk.mjs`, absent from `sdk.d.ts`; see §2a). Two scorecard rows to
   refresh, no spec change.

5. **Minor, and the spec half-flags it itself.** §45.4.2's `--include-hook-events` row says the flag
   "Emits … for **all** hook events", with the `SessionStart`/`Setup` exemption appended as a trailing
   clause. Read alongside §45.5.7's note that `--include-hook-events` without `stream-json` is
   accepted "despite the help text", a reimplementer could reasonably conclude the frames are
   flag-conditional in all cases. The `J2r` short-circuit deserves the same prominence in §45.4.2 that
   §45.14.6 gives it, because it is the difference between "SessionStart is unobservable headlessly"
   and "SessionStart is the *one* event you can observe without asking".

---

## 7. Re-verification (checkout correction)

The first draft was researched against the **frozen** checkout
`/Users/new/Developer/GitHub/codex_somersault/CC-to-SDK`, not the brief's repo
`/Users/new/Developer/GitHub/somersault/CC-to-SDK`. Every repo-side cite has since been re-checked
line by line against **somersault**; all bundle cites (`~/claude-code-bundle/2.1.*`) are root-independent
and unaffected. 50 cites checked mechanically, 17 mismatched, all fixed in place above.

**One substantive divergence, and it strengthens the report.** The frozen checkout pinned
`@anthropic-ai/claude-agent-sdk@0.3.250` (bundled CLI **2.1.250**); somersault pins **0.3.251**
(bundled CLI **2.1.251**). That matters twice:

- **P1 loses its only open question.** I had to leave "does 2.1.250 have the new
  `prompt_suggestion` gate?" unresolved because it fell inside the un-bracketed 242–250 window. The
  real pin is 2.1.251, which I grepped directly and which is on the **new** side. The blocking term
  is provably absent from the CLI we ship.
- **§6 defect #4 is withdrawn.** 0.3.250's `HOOK_EVENTS` has 31 entries; 0.3.251's has **33**,
  matching the spec exactly. The spec was right; the frozen checkout was stale.

Re-verified unchanged at 0.3.251 (so P2, P4 and the §2/§3 mechanisms all stand): the `canUseTool`
bridge still forwards eleven fields and drops the same five; `readMessages` is still a five-kind
passthrough; `--include-hook-events` is still pushed from `options.includeHookEvents`;
`excludeDynamicSections` still rides the `systemPrompt` preset; `Options` still has 65 declared fields.

**Corrected cites** (cited → actual, in somersault):

| cite | was | now |
|---|---|---|
| `harness/src/host/host.ts` | 563 | **571** |
| `harness/src/session/turnResult.ts` | 41 | **42** |
| `docs/parity/coverage.md` (P119 census) | 523 | **544** |
| `docs/parity/coverage.md` (P116) | 556 | **dropped — no P116 reference exists in coverage.md** |
| `docs/parity/coverage.md` (`includeHookEvents` 🚫) | 735 | **42**; the `Options` row is **756** |
| `docs/parity/coverage.md` ("8 of 30") | 741 / 774-777 | **797**, plus the correction block at **802-826** |
| `docs/superpowers/specs/2026-06-18-hooks-support-design.md` | 33-36 | **36** |
| `docs/parity/probe-results/05-canusetool.txt` | 4 | **3** |
| `sdk.d.ts` `HOOK_EVENTS` / `default_to_no` / `extraArgs` / `excludeDynamicSections` / `TerminalReason` / `capabilities` / `CanUseTool` / settingSources note | 849 / 3981 / 1533 / 2112 / 8203 / 4901 / 209 / 2007 | **853 / 4080 / 1537 / 2116 / 8318 / 5002 / 209 (unchanged) / 2052** |

Verified correct as originally cited, no change needed: `session/session.ts:52`,
`config/outputStyle.ts:42`, `config/resolveOptions.ts:136`, `permissions/gate.ts:7`,
`tui/species.ts:615`, `appserver/peerPolicy.ts:65`, `peer/roster.ts:50`,
`appserver/items/mapper.ts:74`, `appserver/router.ts:274`, `appserver/search.ts:405`,
`tui/liveTurn.ts:138`, `coverage.md:25`, `full-potential.md:56,103,135,171,172,173,174,176,177`,
`2026-06-18-hooks-support-design.md:27`, `2026-07-17-wave4-knob-completion-design.md:15`,
`2026-08-09-wave-c-chrome-composer-design.md:42`, and all five probe cites
(`53b:17,27` · `119:50,61` · `10:48` · `122:50` · `78:104`).

**One finding rewritten rather than re-cited.** P6 originally argued the "8 of 30 / 17 of 30" census
was species-scoped and unreconciled. The live repo already contains that correction
(`coverage.md:802-826`, 2026-09-01, "23 of 33", enumerated from upstream's own dispatcher registry —
absent from the frozen checkout). P6 is rewritten to credit it, to name the three
`full-potential.md` rows it left behind, and to point at the axis it does *not* cover: the corrected
census measures whether a hook **runs**, never whether anything **surfaces on the wire** — which the
spec shows are different questions with different answers.
