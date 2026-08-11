# Wave C grounding probes — live verdicts

Run 2026-08-09 against the installed `@anthropic-ai/claude-agent-sdk` (in `CC-to-SDK/probes/node_modules`)
and the installed Claude Code CLI **2.1.226** (`~/.local/share/claude/versions/2.1.226`, symlinked from
`~/.local/bin/claude`). Model for every live arm: `claude-haiku-4-5-20251001`. Auth via the OAuth token
from `CC-to-SDK/.env`.

Probe files (new, uncommitted, in `/Users/new/Developer/GitHub/codex_somersault/CC-to-SDK/probes/probes/`):

- `100-prompt-suggestion-and-spinner-tokens.ts` — items (a), (c), (d)
- `100b-prompt-suggestion-env-override.ts` — item (a) escalation, item (b) cross-check, item (d) repeat
- `100c-warm-suggester-cost.ts` — item (a) fallback costing

Numbering note: the brief said "probes go up to 82", but `probes/probes/` already contains 83, 84, 85, 86,
86b, 94, 94b, 95, 96, 97, 98 and 99. Next free number was 100.

---

## (a) EP-C5 — where can a headless harness get the model-generated follow-up suggestion?

**VERDICT: The SDK fully declares the surface but it is UNREACHABLE headlessly — no `prompt_suggestion`
frame arrives across four sessions, with the option set, with the CLI's own override env var set, and with
both. EP-C5 must generate the pre-fill itself; the affordable shape is ONE warm suggester session, which
measures ~5.0 s and ~$0.0045 per suggestion (against ~8.1 s and ~$0.0100 if each suggestion spawns its own
CLI), and it must be treated as asynchronous — never blocking the composer.**

### The declared surface (it is not vestigial — it is fully specified)

`probes/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`:

- line 1789 — `Options.promptSuggestions?: boolean`, with a doc comment that specifies delivery precisely:
  at most one per turn; **arrives after the `result` message**; consumers must keep iterating past `result`;
  suppressed on the first turn, after API errors, in plan mode, by
  `CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false`, and by `promptSuggestionEnabled: false` in settings.json
  (env wins over setting); "suggestions piggyback on the parent's prompt cache, making them nearly free".
- line 3436 — the same key on the initialize payload type.
- lines 4227–4233 — `SDKPromptSuggestionMessage = { type: 'prompt_suggestion'; suggestion: string; uuid; session_id }`,
  and it is a member of the exported `SDKMessage` union (line 4019).
- line 6341 — `promptSuggestionEnabled?: boolean` in the settings type.

The option is genuinely forwarded on the wire, not dropped by the TypeScript layer. From `sdk.mjs`:

```
…webSearchIsolationExemptMcpServers:this.initConfig?.webSearchIsolationExemptMcpServers,
  promptSuggestions:this.initConfig?.promptSuggestions,agentProgressSummaries:…
```

So the SDK sends it in the initialize control request. The failure is on the CLI side, not in marshalling.

### What the live runs found

Probe 100, arm A (`promptSuggestions: true`), three turns, loop deliberately keeps iterating past every
`result` and waits 2.5 s in that window:

```
  init · session 5046b461-be39-4bfe-b12b-07ba34700c76
  [turn 0] success · 2836ms · cumulative cost $0.036147 · message_deltas this turn: 1
  [turn 1] success · 1099ms · cumulative cost $0.038272 · message_deltas this turn: 1
  [turn 2] success · 3606ms · cumulative cost $0.041373 · message_deltas this turn: 1
…
  ARM A suggestions: 0 · ARM B (control): 0
  frames seen in the post-result window (arm A), which is where it would have been:
    (none at all)
```

Turns 1 and 2 are both eligible (the doc only suppresses the *first* turn), so this is absence across two
eligible turns, and the post-result window contained **no frames of any type** — not a filtering mistake on
my side.

### The escalation that mattered: the CLI's own override, and why it should have worked

Reading the 2.1.226 bundle, the CLI's enable function is:

```js
function w9o(){ let e = process.env.CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION;
  if (md(e)) return L("tengu_prompt_suggestion_init",{enabled:!1, source:Ae("env")}), !1;
  if (yr(e)) return L("tengu_prompt_suggestion_init",{enabled:!0, source:Ae("env")}), !0;
  if (!nt("tengu_chomp_inflection",!1)) return L(…,{enabled:!1, source:Ae("growthbook")}), !1;
  if (Ln())  return L(…,{enabled:!1, source:Ae("non_interactive")}), !1;
  if (vu() && J_()) return L(…,{enabled:!1, source:Ae("sw…
```

The `env is truthy` branch **returns true before both the flag check and the non-interactive check**. That
is a real override, and it made the "headless is just non-interactive, so of course it's off" explanation
premature. Probe 100b tested it (spreading `process.env` into the `env` option, since `env` replaces rather
than extends the subprocess environment):

```
───────── ARM 1 (env var only) — promptSuggestions:false · env:true ─────────
  [turn 0] success · turn cost $0.002581   [turn 1] $0.002141   [turn 2] $0.003252
  post-result window frame types: (none)

───────── ARM 2 (env var + SDK option) — promptSuggestions:true · env:true ─────────
  [turn 0] success · turn cost $0.002596   [turn 1] $0.001989   [turn 2] $0.003490
  post-result window frame types: (none)

env-only suggestions: 0 · env+option: 0
```

Four sessions, twelve turns, zero frames. The gate is not what is stopping it — the **emitter** is bound to
a surface the SDK transport does not have.

### Ruling out "generated but not delivered"

Probe 100's arm A looked 5.5x more expensive than its control ($0.041373 vs $0.007490 cumulative), which
would be consistent with a suggestion being generated and silently swallowed. It is not: the *per-turn
deltas* are essentially identical between the arms — arm A $0.002125 / $0.003101, control $0.002126 /
$0.002798 — so the entire gap is arm A's turn-0 cold prompt-cache write (arm A ran first). Nothing extra
was billed. Settled arithmetically from data already collected, with no additional spend.

### The fallback, costed

| shape | latency | cost per suggestion |
|---|---|---|
| fresh `query()` per suggestion, full Claude Code system prompt (probe 100 arm C) | 9103 ms | $0.010599 |
| fresh `query()` per suggestion, minimal replacement `systemPrompt` (probe 100b arm 3) | 8101 ms | $0.010002 |
| **one warm streaming suggester session, requests 2–4** (probe 100c) | **avg 4962 ms** | **avg $0.004512** |
| (that warm session's cold first request, for reference) | 7126 ms | $0.009517 |

Shrinking the system prompt barely moved the number (9103→8101 ms, $0.010599→$0.010002), which says the
input bulk is the CLI's tool definitions rather than the prompt. Those cache, which is why keeping the
session warm halves the cost. Probe 100c's per-request deltas were $0.004655, $0.004576, $0.004305 across
four different transcript tails — no creep from the accumulating side-context over four requests.

Sample output quality was fine at haiku (`"Test it with the --verbose flag."`, `"Fix the test to use UTC."`,
`"Apply the migration and run tests."`).

Two things the spec should carry from this: ~5 s is far longer than upstream's "nearly free" cache
piggyback, so the pre-fill lands well after the reply is on screen and must be async and cancellable; and
at ~$0.0045 per turn it is not free enough to be unconditional — it wants the same on/off treatment
upstream gives it.

---

## (b) Flag adjudication for the EP-C5 default

**VERDICT: There is NO statsig/flag cache on this machine to pin against — `~/.claude/statsig/` does not
exist and no cached evaluation of `tengu_chomp_inflection` exists anywhere under `~/.claude`; the installed
2.1.226 build resolves flags live from `cdn.growthbook.io` and the gate's own in-code default is FALSE
(`nt("tengu_chomp_inflection", !1)`), so the F6 precedent resolves to: EP-C5 ships OFF by default.**

All inspections read-only; nothing was written into `~/.claude`.

Evidence:

- `ls ~/.claude/statsig` → `No such file or directory`. `find ~/.claude -iname "*statsig*"` (depth 4) →
  nothing. `find ~/.claude -iname "*growthbook*"` → nothing. No candidate cache under `~/Library/Caches`,
  `~/.cache`, or `$TMPDIR` either. `~/.claude/cache/` holds only `changelog.md`, `gateway-models.json`,
  `my-closed-issues.json`.
- The absence is explained by the build: 2.1.226 has moved off a local statsig cache to GrowthBook,
  fetched at startup (`https://cdn.growthbook.io` appears in the bundle alongside `before_growthbook_init`
  / `after_growthbook_init` / `growthbook_init_ms` init-profiler spans). Flag values are not persisted to
  disk, so there is nothing on this machine to read. This also means the repo's existing statsig-gate
  citations (`tengu_amber_flint`, `tengu_amber_prism`) describe an older mechanism.
- The gate call site pins the default directly: `nt("tengu_chomp_inflection", !1)` — second argument is the
  default, and it is `false`. Contrast `tengu_amber_flint`, which the same bundle calls as
  `nt("tengu_amber_flint", !0)` — default true. So this gate defaults off in the installed build.
- `~/.claude/settings.json` contains **no** `promptSuggestionEnabled` key (grep exit 1). Its full key set:
  `agentPushNotifEnabled, autoCompactWindow, autoScrollEnabled, autoUpdatesChannel, editorMode,
  effortLevel, enableWorkflows, enabledPlugins, env, extraKnownMarketplaces, fileCheckpointingEnabled,
  hooks, inputNeededNotifEnabled, minimumVersion, model, permissions, pluginConfigs, preferredNotifChannel,
  remote, remoteControlAtStartup, showTurnDuration, skillListingBudgetFraction, skipAutoPermissionPrompt,
  skipWorkflowUsageWarning, statusLine, switchModelsOnFlag, theme, tui, voice, voiceEnabled, worktree`.
  Absent means "enabled" per the SDK type ("When absent or true, prompt suggestions are enabled") — but the
  setting is only consulted *after* the gate, so it never gets a say while the gate is off.
- Corroborating the off-by-default reading: the settings UI row for it is itself gate-conditional —
  `...nt("tengu_chomp_inflection",!1)?[{id:"promptSuggestionEnabled",label:"Prompt suggestions",…}]:[]` —
  i.e. on this build the user cannot even see a Prompt-suggestions toggle unless the gate flips on.

Two consequences worth stating plainly for the spec. First, since the harness has to build the feature
itself anyway (item a), the "flag" is now purely ccx's own default, and both the upstream default and the
measured ~$0.0045/turn cost point the same way: **off by default, opt-in**. Second, the sensible ccx
setting key is `promptSuggestionEnabled` — matching upstream's name and its absent-means-on polarity would
be confusing here, so if it ships off by default the key should be written explicitly rather than relying
on absence.

---

## (c) Spinner token count feed

**VERDICT: The feed already exists and is already shipped — `stream_event.message_delta.usage.output_tokens`,
consumed at `harness/src/tui/liveTurn.ts:145` and surfaced as `useChat.turnTokens` → `TurnSpinner` — but the
cadence is ONCE PER ASSISTANT MESSAGE, not per token: a single-message turn reads 0 for the entire turn and
jumps to the final figure at the very end. It is a per-message step counter, not a ticker.**

What the harness already has (no new plumbing needed):

- `harness/src/tui/liveTurn.ts:145` —
  `if (e.type === "message_delta" && e.usage && typeof e.usage.output_tokens === "number") this.currentMsgTokens = e.usage.output_tokens;`
- `liveTurn.ts:110` rolls the finished message in on the next `message_start`
  (`this.committedTokens += this.currentMsgTokens; this.currentMsgTokens = 0;`), and `:60` exposes
  `get outputTokens() { return this.committedTokens + this.currentMsgTokens; }`.
- `harness/src/tui/useChat.ts:642` and `:728` call `setTurnTokens(partial.outputTokens)` on every partial;
  `:609` resets to 0 at turn start; `ChatApp.tsx:577` renders `<TurnSpinner … tokens={state.turnTokens} />`.
- `docs/parity/tui-ux.md:1531` already scores this ✅ (U10), and `:1701` records the shipped status string
  `(3s · 142 tokens · esc to interrupt)`.
- `includePartialMessages` is on for the interactive engine by default (`harness/src/host/host.ts:373`), so
  the frames do arrive in ccx.

The cadence measurement (probe 100, arm A, three turns with `includePartialMessages: true`):

```
  turn 0: 1 reading(s) — 44@2833ms      (turn ended at 2836ms)
  turn 1: 1 reading(s) — 44@1098ms      (turn ended at 1099ms)
  turn 2: 1 reading(s) — 256@3605ms     (turn ended at 3606ms)
```

Turn 2 was a deliberately longer four-sentence answer (256 output tokens) and still produced exactly one
reading, 1 ms before the turn ended. The probe also checked whether any usage rides on the text deltas
themselves — it logs loudly if `content_block_delta` carries a `usage` field — and it never fired.

So: the field is right and the wiring is right, but "live incrementing count" overstates it. A turn that
runs tools produces several assistant messages and the number does step visibly (once per message); a plain
question-and-answer turn shows `0 tokens` until the last instant. If Wave C's spinner parenthetical needs
motion within a single message, the only source is a local estimate from accumulated text-delta characters,
which would be an invention rather than a port — and it would have to be reconciled with the true figure
when `message_delta` lands.

---

## (d) Terminal title

**VERDICT: The engine DOES auto-generate a session title headlessly — it writes an `ai-title` row into the
session JSONL during the first turn, before the first assistant reply, and the SDK surfaces it as BOTH
`getSessionInfo().customTitle` and `.summary`; that is where the terminal-title text comes from (with
`renameSession()` as the user-driven override), and it is a disk read, not a wire event, so the harness must
fetch it rather than wait for a frame.**

Live evidence — three independent sessions, all auto-titled, none renamed by the probe:

```
probe 100  arm A   : summary="Alpha"                          customTitle="Alpha"
probe 100b arm 1   : summary="Alpha"                          customTitle="Alpha"
probe 100b arm 2   : summary="Respond with single word alpha" customTitle="Respond with single word alpha"
                     firstPrompt="Reply with exactly one word: ALPHA"   (all three)
```

The title is a generated topic line, not the first prompt verbatim — that is the point of the third row,
where it paraphrased rather than echoed. Reading the raw JSONL for the third session
(`~/.claude/projects/-private-var-…-probe100b-eNuoxQ/f11494c3-….jsonl`, 20 rows, read-only) shows where it
lands:

```
 2 user       Reply with exactly one word: ALPHA
 3 attachment
 4 attachment
 5 attachment
 6 ai-title   Respond with single word alpha        ← written mid-turn-1, BEFORE the reply
 7 assistant
 8 assistant  ALPHA
…
19 last-prompt
```

Row shape: `{"type":"ai-title","aiTitle":"…","sessionId":"…"}`. It is generated from the first prompt alone
and is available almost immediately, which is exactly what a terminal title needs. Note it does **not**
refresh as the topic drifts — one title per session, at the start.

Related SDK/harness surfaces:

- `sdk.d.ts:4333` — `SDKSessionInfo.summary`: "Display title for the session: custom title, auto-generated
  summary, or first prompt." `:4345` — `customTitle`: documented as "User-set session title via /rename",
  but the observed behaviour is that the headless auto-title lands in the same slot, so the doc comment
  understates it.
- `sdk.d.ts:2598` — `renameSession(sessionId, title, options)`; already wired in ccx
  (`harness/src/sessions/mutate.ts`, `useChat.ts:398/1052-1053`, `SessionPicker.tsx` Ctrl-R).
- `sdk.d.ts:3716-3721` — `SDKControlRenameSessionRequest { subtype:'rename_session'; title }`, "Sets the
  user-facing title for the current session" — a control request, i.e. a write path, not an inbound
  notification. No inbound title-changed frame was observed in any arm, and
  `SDKSessionStateChangedMessage` (`:4375`) carries only `state: 'idle'|'running'|'requires_action'`.
- `sdk.d.ts:6307` — settings key `terminalTitleFromRename?: boolean`, "Whether /rename updates the terminal
  tab title (defaults to true). Set to false to keep auto-generated topic titles." This confirms upstream's
  own precedence for the title text: **the rename-set custom title wins when set, otherwise the
  auto-generated topic title** — which maps cleanly onto `customTitle ?? summary ?? firstPrompt`.
- `sdk.d.ts:6846` — a settings-level escape-sequence allowlist, "Only notification/title OSCs (0, 1, 2, 9,
  99, 777) and BEL are permitted" — independent confirmation that OSC 0/1/2 is the sanctioned title
  mechanism.
- ccx currently emits no title escape at all: grepping `harness/src/` for `\x1b]0;` / `]2;` returns nothing.

---

## Housekeeping

Not done, per the brief: `.doperpowers/sdd/progress.md` untouched, nothing committed, nothing written into
`~/.claude` (the `~/.claude/statsig`, `~/.claude/settings.json` and session-JSONL inspections were all
reads). No secrets appear in this file or in any probe output. Total live spend across all three probes was
roughly $0.09.

---

## (e) Probe 101 — accountInfo field inventory (added at spec-review time, 2026-08-09)

**VERDICT: `accountInfo()` headlessly returns EXACTLY TWO fields under the OAuth token —
`apiProvider: "firstParty"` and `tokenSource: "CLAUDE_CODE_OAUTH_TOKEN"` — both before and after the
first turn. `subscriptionType` is declared in sdk.d.ts but never arrives, so upstream's tier labels
(`Claude Max` / `Claude Pro`) are unreachable; EP-C8's banner billing label must map from
`tokenSource`/`apiProvider` alone (OAuth → `Claude subscription`, API key → `API Usage Billing`,
non-firstParty → provider display names, unknown → omit).**

Found because the spec review flagged the spec's citation of probe 28 as evidence-overreach (28
verified only first-party auth). Probe file: `probes/probes/101-accountinfo-field-inventory.ts`.
Values above are enums, not secrets; nothing sensitive appears in the probe output.

---

## (f) Probe 102 — runtime effort setter (added at plan-review time, 2026-08-09)

**VERDICT: the SDK has NO `setEffort`; the runtime hook is `Query.applyFlagSettings({ effortLevel })`
(sdk.d.ts:2373, streaming-input only), and it is LIVE headlessly — resolves mid-session between
turns, later turns unaffected. It performs NO VALIDATION: `{effortLevel: "bogus"}` resolves silently,
so the harness must validate against its own domain before the call. `effortLevel` accepts `'max'`
session-scoped (never persisted).**

Probe-harness lesson (v1 of this probe): releasing every input gate upfront exhausts the streaming
input generator, which closes the transport's write side — every control call then throws
("Query closed before response received" / "ProcessTransport is not ready for writing") while
already-queued turns still complete. `setModel` "failed" identically, which is what exposed the
harness bug rather than a dead setter. Control-channel probes must keep the input generator pending.

Probe file: `probes/probes/102-effort-runtime-setter.ts`.
