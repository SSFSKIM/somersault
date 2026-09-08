# F — Slash commands (spec ch. 28) vs. the `ccx` TUI

Lane: `28-slash-commands.md` (4,527 lines) against
`/Users/new/Developer/GitHub/somersault/CC-to-SDK` (HEAD `e337ea7`, **post-bl10**) —
`harness/src/tui/{commands,commandComplete,completions,completionTriggers,useChat,HelpDialog,suggestPopup,McpDialog,SettingsDialog}`
+ `docs/parity/{tui-ux.md §5, command-coverage.md, coverage.md}`. All `file:line` cites are from that
tree; §7 records the re-verification.

**Verification note.** Chapter 28 had only an R2 review pass, so I re-derived every load-bearing claim
below against `~/claude-code-bundle/2.1.251/cli.pretty.js` (our canon target) rather than trusting the
257 text. Findings marked **verified** carry a 251 line cite I ran myself; **spec-only** ones I did not
re-derive. The chapter held up unusually well — I found one substantive spec omission and no
contradictions.

---

## 0. Top takeaways

1. **Our `KIND_MAP` transcription is wrong in six places, and it is verifiable against our own 2.1.251
   target — not a 251→257 hop.** `commandComplete.ts:60-65` carries an invented `pride` and is missing
   `cloud-plugins`, `low-priority`, `limit-reset`, `plugin-types`, `thrash`. §1.1.
2. **The catalog we forward blind contains ~80 commands the engine will refuse**, and the spec gives the
   exact predicate that separates them (`§22 runsHeadless`). Our five-name `CLIENT_SIDE_NOTES` covers 5 of
   them; the other ~75 become a wasted model turn that answers with the engine's own
   `/X isn't available in this environment.` §1.2 + §2.1.
3. **Three of our five honesty notes are probably stale**: canon ships *headless twins* of `/agents`,
   `/color`, `/extra-usage`, `/fast` with `supportsNonInteractive: true`, so the engine would answer them
   for real. Needs one probe before acting. §1.2.
4. **`/cost` and `/stats` are not commands in canon — they are aliases of `/usage`** (verified, 251).
   Likewise `/continue` is an alias of `/resume`. bl10 shipped the *behavioural* half — all four now open
   one `SettingsDialog` tab — but they are still five separate `CommandRow`s with five `useChat` arms, so
   the `/` menu and `rankCommands`' alias fold still see five commands where canon has two. §1.3.
5. **A typed POSIX path is rejected as an unknown command.** Canon `stat()`s `/<name>` and applies
   `looksLikeCommand` before rejecting, so `/usr/local/bin/foo please read this` is ordinary prose there
   and `Unknown command:` here. §1.4.
6. **`/compact <instructions>` silently drops its arguments** — canon's own argumentHint is
   `<optional custom summarization instructions>` and the local twin is `supportsNonInteractive: true`,
   so the instructions are reachable engine-side today. §1.5.
7. **Everything in §13–§20 (custom `.claude/commands`, frontmatter, `$ARGUMENTS`, `!`-shell, `@file`,
   plugin/MCP/skill commands, stacked commands, subcommands) is engine-side and we get it for free** —
   but that also means we inherit its *failure* strings without rendering any of them specially. §5, §2.4.

---

## 1. Corrections — things we built that canon does differently

### 1.1 `KIND_MAP` (`ZLb`) is mis-transcribed — six names — **verified**

**Ours:** `harness/src/tui/commandComplete.ts:63-68` (`ZLb`, four space-separated runs).
**Canon:** spec §5.2; re-derived from 2.1.251 `cli.pretty.js:209408` (`var … kn = { advisor: "config", … }`),
127 entries, identical membership to the 257 table.

Mechanical diff (script run against 251):

```
in canon not ours: cloud-plugins (config), limit-reset (action), low-priority (action),
                   plugin-types (action), thrash (action)
in ours not canon:  pride
bucket mismatch:    none
```

`pride` does not occur anywhere in 2.1.251 as a command name (only `prideFlag`, a `~/.claude.json`
counter at `:311370`). User-visible impact is small (one lane word on one row when
`CLAUDE_CODE_ENABLE_MENU_KIND_LANES` is set) but the file's own doc comment claims the table is
"transcribed whole rather than trimmed", and it is neither whole nor accurate. This is a five-minute fix
with a byte-exact source. **Verified. Not a 251→257 change** — 251 and 257 agree.

### 1.2 Honesty routing is both too narrow and possibly too broad — **spec-only, needs a probe**

**Ours:** `commands.ts:441-450` `CLIENT_SIDE_NOTES` = 5 names (`agents`, `color`, `extra-usage`, `fast`,
`heapdump`); `useChat.ts:3393`. Everything else in `catalogNames` is forwarded raw as a model turn
(`useChat.ts:3394`).

**Canon:** §22 gives the exact predicate the headless runner applies
[`chunk-1kg58a1a.js:145440-145447`]:

```
runsHeadless(e) = e.type === "prompt" && !e.disableNonInteractive
               || e.type === "local"  && e.supportsNonInteractive
```

and §23.2 explains why our catalog nonetheless *lists* unrunnable names: the SDK `system.init`
advertisement carries `advertisedSlashCommands` — the **un-narrowed** list
[`chunk-2rhzyjym.js:172443`] — while the headless runner's dispatch list is the *filtered* one
[`chunk-2rhzyjym.js:176042`]. That single sentence resolves the long-standing puzzle in
`commandComplete.ts:77-95` ("the live catalog also carries ten of upstream's own client-side controls").
It is not a puzzle: init advertises everything, dispatch runs a subset.

Two consequences:

* **Too narrow.** Of the 126 catalog rows, 80 are `local-jsx` and 10 are `local` with
  `supportsNonInteractive: false` — 90 names that cannot run. We intercept 5. The other ~85, if the
  engine reports them, cost a full model round-trip to be told
  `/<name> isn't available in this environment.` — which is the string our own
  `docs/superpowers/specs/2026-06-19-chat-slash-commands-design.md:35` already recorded observing from
  probe 21, so the mechanism is confirmed live. §22's predicate is the honest replacement for the
  hand-maintained list, but `CommandEntry` carries no `type`/`supportsNonInteractive`, so it is not
  directly computable — see §2.1 for the field the SDK *does* give us.
* **Possibly too broad.** `/agents`, `/color`, `/extra-usage`, `/fast` all have `local` twins with
  `supportsNonInteractive: ✓` in §5's table (`/agents` unconditionally; the other three gated
  `isNonInteractive()`, which the SDK's print-mode CLI is). If so the engine answers them for real —
  and for `/agents` its answer is verbatim the sentence we hand-wrote
  (`(removed) Ask Claude to create/manage subagents, or edit .claude/agents/`, §5). `/fast` would
  actually toggle fast mode. Only `/heapdump` is unambiguously ours to refuse (it dumps the CLI's own
  heap). **Do not act on this without a probe** — the A1 discipline applies exactly here: §5's `N-I`
  column is a declared-surface fact and the probe is the reachability question.

### 1.3 `/cost`, `/stats`, `/continue`, `/settings`, `/allowed-tools` are aliases in canon, rows here — **verified**

**Ours:** `commands.ts:34-108` — `cost`, `status`, `stats`, `usage`, `continue`, `settings`,
`allowed-tools` are all separate `CommandRow`s with separate `useChat` arms
(`useChat.ts:2264` `/cost`→`openSettings("Usage")`, `:2265` `/status`→`openSettings("Status")`,
`:2291` `/usage`→`openSettings("Usage")`, `:2319` `/continue`→`doContinue()`,
`:2429` `/stats`→`openSettings("Stats")`, `:2540-2541` `/settings`+`/config`, `:2567` `/allowed-tools`).

**Canon (251, verified):**

| canon command | aliases | 251 evidence |
|---|---|---|
| `/usage` (local-jsx + local twins) | `cost`, `stats` | `aliases: ["cost", "stats"]`, desc `Show session cost, plan usage, and activity stats`; local twin desc `…and what's contributing to your limits`, `menuDescription: Show session cost and plan usage` |
| `/resume` | `continue` | `aliases: ["continue"]` |
| `/config` | `settings` | `aliases: ["settings"]`, local twin `argumentHint: "key=value"`, desc `Set a setting by key` |
| `/permissions` | `allowed-tools` | `aliases: ["allowed-tools"]` |
| `/clear` | `reset`, `new` | `{type:"local", name:"clear", description:"Start a new session with empty context; previous session stays on disk (resumable with /resume)", argumentHint:"[name]", aliases:["reset","new"], supportsNonInteractive:!0, thinClientDispatch:"post-text"}` — 251 `cli.pretty.js` |

`commands.ts:26-31` already knows the alias mechanism exists and explicitly parks `/settings` and
`/allowed-tools` ("collapsing them is a visible change this task does not own"). Fine. But `/cost` and
`/stats` were never even identified as aliases, and `/continue` diverges *semantically*: ours resumes the
most-recent session, canon's `continue` opens the same picker `/resume` does. Impact: the help/palette
listing shows five rows where canon shows two, and our `/cost` and `/stats` print two different
hand-built blocks where canon shows one dialog. **bl10's T-MENU task 3 has now shipped this half**:
`/status`→Status, `/cost`+`/usage`→Usage, `/stats`→Stats on the four-tab `SettingsDialog`
(`SettingsDialog.tsx:76` `TABS = ["Status","Config","Usage","Stats"]`), and the four summaries were
reworded to say so (`commands.ts:40,41,95,100`). **The remaining delta is purely the catalog shape** —
five `CommandRow`s vs. canon's two rows plus alias keys — which is what the `/` menu renders and what
`rankCommands` folds aliases onto. Also still missing: `/clear`'s `reset`/`new` aliases and its `[name]`
argument, and `/continue`'s divergent semantics.

### 1.4 A typed POSIX path becomes `Unknown command` — **verified**

**Ours:** `commands.ts:16-23` `parseCommand` accepts any leading `/`; `useChat.ts:3395` falls through to
`formatUnknown` (`commands.ts:391`, `Unknown command: /${name} · try /help`).

**Canon:** §7 + §8 step 8, re-derived at 251 `cli.pretty.js:76458-76481`:

```js
if (!k) {                                  // no command found
  let b = !1;
  try { await le().stat(`/${d}`), b = !0; } catch {}
  if ((hWe(d) || M) && !b) { … reject … }  // hWe = looksLikeCommand
  // otherwise: fall through, treat the whole input as an ordinary prompt
}
```

`looksLikeCommand` is `/^[a-zA-Z0-9_][a-zA-Z0-9:_-]*$/` [`chunk-95p3p7y1.js:338381`], so any token
containing `/`, `.`, a space-free path, or a leading digit-with-punctuation is prose in canon. We reject
it. User-visible: `/Users/me/notes.md summarise this` — canon sends it to the model, ccx prints
`Unknown command: /Users/me/notes.md`. **Verified in 251.**

Canon's rejection copy also differs, and is verbatim at 251 `:76481`:

```
Unknown command: /${name}. Did you mean /${suggestion}?      // edit distance ≤ 2, name→512, suggestion→200
Unknown command: /${name}
```

plus, interactively, a second warning `Args from unknown skill: ${args}` [`:76484`]. Ours has neither
the suggestion nor the args echo, and appends a `· try /help` tail canon does not have.

### 1.5 `/compact <instructions>` drops its argument — **verified**

**Ours:** `useChat.ts:2253-2259` calls `session.compact()` with no argument;
`session/session.ts:258-266` injects a bare `/compact` turn.
**Canon (251, verified):** `{ type:"local", name:"compact", description:"Free up context by summarizing
the conversation so far", argumentHint:"<optional custom summarization instructions>",
supportsNonInteractive:!0 }`. §13 owns the semantics; §23.3 notes `/compact` is the *only* command
`deferSlashToEngine` returns true for [`chunk-bq8epagv.js:427946`] — i.e. canon itself hands `/compact`
to the query loop as text, which is exactly the shape `session.compact()` already uses. Passing
`cmd.args` through is a one-line change to a reachable engine-side feature.

Our summary string is also wrong for `/clear`: `commands.ts:42` says `clear the screen (session context
kept)`, but `useChat.ts:2307` calls `session.clearSession()` → `host.ts:759` swaps the engine with
`resume: undefined`, i.e. a genuinely fresh conversation. The behaviour matches canon; the description
contradicts both it and canon's own verbatim line (quoted in §1.3's table).

### 1.6 `/mcp`'s sub-verb vocabulary is ours, not canon's — **verified**

**Ours:** `commands.ts:457-464` `parseMcpArgs` accepts `reconnect <name>` and `toggle <name> on|off`.
bl10's T-MENU task 4 shipped `McpDialog.tsx` + `mcpDialogModel.ts` and rerouted **bare** `/mcp` to it
(`useChat.ts:2360-2367`: `action.kind === "status"` → `openMcpDialog()`); the `reconnect` and `toggle`
arms still parse and print through the old text path, so `parseMcpArgs` is byte-identical to the
pre-bl10 tree.
**Canon (251):** the local twin's argumentHint is `[reconnect|enable|disable [<server>|all]]`; the
local-jsx twin's is `[reconnect <server>|enable|disable [<server>|all]]` (§5). So canon has `enable` /
`disable` as separate verbs, accepts a bare verb (defaulting to a prompt), and accepts `all`. Ours has
`toggle … on|off` and no `all`. **The browser shipped without the grammar** — bl10 replaced the bare-`/mcp`
text dump but left the sub-verbs untouched, so this correction is now sharper than when I first wrote it:
the one moment the arg vocabulary was cheap to change has passed, and `/mcp disable all` still prints
usage.

Smaller argumentHint divergences in the same family (all verified against 251):
`/export` canon `[filename]`, ours `[file|clipboard]`; `/rename` canon `[name]`, ours `<title>`;
`/config` local twin canon `key=value` (ours matches); `/context` canon local-jsx takes `[all]`, ours
takes nothing.

### 1.7 `/bg` collides with canon's own `bg` — **verified**

`commands.ts:74` makes `bg` canonical with `tasks`/`bashes` as aliases, citing canon's `/tasks` row. But
canon *also* binds `bg`: `/background` carries `aliases: ["bg"]` (251, one occurrence; §5's table row).
So in canon `/bg` sends the session to the background; in ccx it opens the background-work panel. The
existing comment records the keep-decision but not the collision. Worth one line in the comment at
minimum, since anyone coming from real Claude Code has the opposite muscle memory.

### 1.8 `/` menu ranking diverges in three ways — **spec-only**

**Ours:** `commandComplete.ts:33-51` `rankCommands` → `fileComplete.ts:123-129` `rankCandidates`
(subsequence fuzzy score over name + alias strings only, sorted by score → path length → lexical).
Empty query → `entries.slice(0, cap)`, i.e. `COMMANDS` declaration order then engine order.

**Canon:** §21.2/§21.3.
* Empty query: up to **5** `prompt` commands with a *strictly positive* usage score, then five buckets
  (`local`/`local-jsx`; user/local settings; project; policy; rest), **each sorted alphabetically by
  display name**. Ours does none of this — locals appear in hand-written declaration order.
* Query: Fuse.js v7 with `threshold: 0.3, location: 0, distance: 100` and six weighted keys —
  `commandName` 3, `displayName` 2, `partKey` 2, `aliasKey` 2, `displayPartKey` 1, `descriptionKey` 0.5
  [`chunk-ejcy5qcd.js:487533-487545`] — then a **six-tier** re-sort (exact name → exact alias → name
  prefix shortest-first → alias prefix → score quantised to `floor(score*10)` → usage boost). We match
  none of the tiers and never score the description or the `:`-split parts, so `/git:sy` and a
  description-word query behave differently.
* Usage score: `usageCount * max(0.5^(days/7), 0.1)`, written at most once per 60 s per command
  [`chunk-1kg58a1a.js:102530,102547`]. We have no usage store at all.

### 1.9 The suggestion row drops the matched-alias suffix — **spec-only**

`ChatComposer.tsx:257` builds `displayText: \`/${e.name}\``. Canon's `toSuggestion`
[`chunk-bq8epagv.js:403874`] renders `` `/${display}${matchedAlias ? ` (${matchedAlias})` : ""}` ``. So
typing `undo` shows `/rewind (undo)` in canon and a bare `/rewind` here — our own
`commandComplete.ts:26-32` doc comment describes the alias fold correctly but the fold's *provenance*
never reaches the row. Canon also appends `(arguments: a, b)` to the description for `prompt` commands
with `argNames`, which `ChatComposer.tsx:224-226` already records as unreachable (`CommandEntry` has no
`argNames`) — that half is honest.

---

## 2. Unknown unknowns — canon behaviour with no `tui-ux.md` row

### 2.1 `terminal_slash_commands` — the SDK's own answer to "which commands are TUI-local", unused by the REPL

`harness/src/appserver/router.ts:92-104` latches the `system/init` frame's `terminal_slash_commands`
onto the thread record and serves it through `thread/capabilities/read`; probe 112 measured
`["doctor","color"]` beside 98 slash commands. **The REPL never reads it.** `useChat.ts:1948-1983`
fetches `capabilities()` and keeps only `commands`; `catalogNames` is the raw un-narrowed advertisement
(§23.2), so every unrunnable name is forwarded.

Reachability: the field exists, is served by our own app-server, and re-emits per turn — so a REPL that
subtracted it from `catalogNames` would gain a *free, engine-authoritative* version of the honesty list.
Caveat worth flagging rather than asserting: the measured value (`doctor`, `color`) is far shorter than
the ~90 non-headless commands, so the field is evidently *not* "everything `runsHeadless` rejects" — its
derivation is not in ch. 28 and I did not find it in the bundle. **Flag, don't assert:** one probe
(re-run 112 against a session with plugins/skills loaded) would settle whether the field is a usable
substitute or only a narrow terminal-oriented subset.

### 2.2 Stacked commands (§11) — five-deep peeling, entirely engine-side, entirely invisible to us

A `prompt` command's arguments may themselves begin with `/`, and canon peels up to `MAX_STACKED = 5`
of them [`chunk-95p3p7y1.js:338766-338797`], concatenating each one's `allowedTools`/`disallowedTools`
onto the head and letting later `model`/`effort` override earlier. Peeling stops at the first
non-`prompt`, forked, `argsMayContainSlashCommands`, disabled or non-user-invocable command. Because we
forward the raw text, **this already works in ccx** — but three of its user-visible outputs are strings
we will render as ordinary assistant/warning text with no special treatment:

```
Stacked command limit (5) reached — remaining input passed as arguments
Stacked skill /<name> blocked by UserPromptExpansion hook
Stacked skill /<name> failed to load: <error>
```

`/loop 5m /foo` is the canonical case that must *not* peel (the bundled `loop` skill sets
`argsMayContainSlashCommands` [`chunk-km4qd0kc.js:583526`]) — we ship a `/loop` skill in this very repo,
so this is live behaviour for our own users. No `tui-ux.md` row exists for stacking.

### 2.3 Subcommands (§12) — `code-review ultra`, `design sync|login|consent|revoke`

`routeSubcommand` [`chunk-zk1sr3hp.js:851865`] maps a bare first token to a *different* command,
case-insensitively, with `subcommandsBareOnly` restricting the route to the case where the token is the
whole argument string. Two bundled skills use it in 2.1.257. Again engine-side and free — but it means
`/design sync` in the `/` menu is a route to `/design-sync`, and our autocomplete cannot know that (we
would show `/design` with no hint that `sync` is meaningful). No row.

### 2.4 The `local-jsx` raw-interpolation hole (§8.2)

Canon escapes thrown errors through `commandThrowTextForTranscript` but the `local-jsx` *success* path
interpolates the dialog's message **raw** into `<local-command-stdout>` [`chunk-95p3p7y1.js:338565`] —
only the `display: "system"` branch applies `escapeTags`. The spec is explicit that a reimplementation
"must not assume the wrapper escapes its payload". We have no `local-jsx` equivalent (our dialogs write
`RenderLine[]` directly, never a transcript message), so this is informational — but it is the kind of
thing to get right if bl10's dialogs ever start writing transcript rows.

### 2.5 `isSensitive` → `***` argument redaction (§2, §10.2)

`qz` [`chunk-1kg58a1a.js:47152`] redacts a command's typed arguments to `***` in the transcript, the
history and telemetry. **No built-in sets it in 2.1.257** (the spec lists this as an open question), so
there is nothing to replicate today — but it is the hook a plugin or MCP command would use, and our
transcript echo (`useChat.ts:2213`, `userEchoLines`) has no redaction path at all. Worth knowing exists.

### 2.6 `advertisedCommand` tip suppression (§23.1a)

A startup/spinner tip carrying `advertisedCommand` is dropped **only in remote mode** and only when no
*built-in* matches the name by name-or-alias [`chunk-chr1kh62.js:452508`]. Consequence a reimplementer
must reproduce: locally, a tip advertising a command that is not registered is shown anyway. We have a
tip surface (`placeholder.ts`, prompt suggestions) — no row for this rule.

### 2.7 `HEADLESS_YIELDABLE_NAMES = new Set(["help", "feedback"])`

The *entire* headless carve-out for plugin alias shadowing (§6.3): in a non-interactive session a plugin
may legally claim the names `help` and `feedback` because the built-ins cannot run there. Every other
non-headless name stays reserved. Two strings, one rule, no row.

---

## 3. Known gaps now specified

| tui-ux.md row | Current | What ch. 28 supplies |
|---|---|---|
| `/config` 🟡 ("5 of ~54 rows") | §5 | §21.5: `/config` is one of exactly **three** built-ins with `getArgumentCompletions` (with `/plugin` and the bundled `design` skill); results capped at **12**, each replacing the whole line as `` `<command> <completed…> <value>[ ]` `` with the trailing space dropped when `isFinal`. That is the mechanism for `/config <TAB>` we never had. |
| `/diff` 🟡 (terminal stand-in) | §5 | §5's row: `/diff` is `local-jsx`, `thinClientDispatch: "control-request"`, and its description is a **getter** — `Toggle the diff panel showing uncommitted changes` under `tengu_willow_crate`, else `View uncommitted changes and per-turn diffs`. Confirms the "per-turn sources" shape the row guesses at. |
| `/effort` 🟡 (three unbuilt arms) | §5 | §5 gives the 257 argumentHint as a **computed** `[<levels>|ultracode|auto]` and confirms the local/local-jsx twin split with `supportsNonInteractive: ✓` on the local one — i.e. `/effort <level>` is engine-reachable as text, which is a second route to the `auto` arm we list as unbuilt. |
| honesty routing ✅ | §5 | §22's `runsHeadless` predicate + §23.2's un-narrowed-advertisement explanation replace the hand-maintained list with a rule. See §1.2. |
| `/copy` 🟡 | §5 | §5 confirms `/copy`'s canon description verbatim (`Copy Claude's last response to clipboard (or /copy N for the Nth-latest)`) — matches what T-COPY shipped. |
| `/vim` ❌ (owner-deferred) | §5 | §5: `/vim` and `/output-style` are both produced by one `"<label> moved to /config"` **factory** and share a single dialog module (`chunk-yv72n4pc.js`); both gated on `tengu_maple_sundial`, both `isHidden: ✓`. So `/vim` is a two-line redirect, exactly like the `/output-style` row we already ship (`useChat.ts:2575`). |
| §4 SettingsDialog / bl10 status family (**shipped**) | §4/§5 | §5 confirms canon's `/status` is `local-jsx`, `Show Claude Code status including version, model, account, API connectivity, and tool statuses` — a *dialog*; `/usage` (+`cost`/`stats`) is a **second** dialog and `/config` a **third**. bl10's design note (`2026-08-31-bl10-…-design.md:50-52`, "all six commands open one dialog") is therefore half right, and the shipped four-tab `SettingsDialog` collapses three canon dialogs into one. That is a defensible simplification, not a defect — but it should be recorded as a divergence in tui-ux.md §4 rather than as parity. |
| `/help` ✅ (dialog) | §5 | §5: `/help` carries `immediate` **when fullscreen** — i.e. it runs the moment the line is submitted rather than waiting for the "press enter to open" gate. `isImmediate(e,n)` is `typeof r === "function" ? r(n) : r === !0` [`chunk-1kg58a1a.js:47126`]. We have no `immediate` concept. |

---

## 4. Verbatim assets worth pinning (we do not have these verbatim)

Checked against `harness/src/` first — none of these strings appear anywhere in our tree.

| Asset | Where | Note |
|---|---|---|
| The transcript echo builder `NV`, **with its literal 12-space indentation** | §10.2; **verified** 251 `cli.pretty.js:516598-516601` — I dumped it with whitespace rendered: lines 2 and 3 are indented exactly 12 spaces | `<command-name>/${o}</command-name>\n            <command-message>${o}</command-message>\n            <command-args>${r}</command-args>`. We parse these tags (`species.ts:61-63`) but never emit them; if `ccx` ever writes its own local-command rows to the transcript this is the shape. |
| The caveat | §10.1; **verified** 251 `:516596` | `<local-command-caveat>Caveat: The messages below were generated by the user while running local commands. DO NOT respond to these messages or otherwise consider them in your response unless the user explicitly asks you to.</local-command-caveat>`, `isMeta: true`. `species.ts:152` classifies the tag; the text itself is nowhere in our tree. |
| The `prompt` echo `Fe` — **different field order, no indentation** | §10.3 | `<command-message>${e}</command-message>\n<command-name>/${e}</command-name>\n<command-args>${n}</command-args>`, with `<command-args>` dropped by `.filter(Boolean)` when empty. `replay.ts:56` already notes it sees "`<command-args>` and `skill-format` shapes"; this is the generator. |
| The skill-loading variant | §10.4 | `<command-message>${e}</command-message>\n<command-name>${e}</command-name>\n<skill-format>true</skill-format>` — **no leading `/`** on `command-name`. Used for non-user-invocable file-backed commands. |
| Dispatcher refusals, all four | §8/§8.1; **verified** 251 `:76412, :76474, :76523, :76530` | `` Commands are in the form `/command [args]` `` · `/<name> isn't available in this environment.` · `/<name> isn't available in this session.` · `/<name> opens an interactive panel and isn't available in this environment. Run it from the Claude Code terminal instead.` |
| Unknown-command pair + args echo | §8; **verified** 251 `:76481, :76484` | `Unknown command: /<name>. Did you mean /<suggestion>?` / `Unknown command: /<name>` / `Args from unknown skill: <args>`. Replaces `commands.ts:391`'s invented `· try /help`. |
| `/clear`'s canon description + `[name]` arg + `reset`/`new` aliases | §5; **verified** 251 | `Start a new session with empty context; previous session stays on disk (resumable with /resume)` |
| `/usage` twin descriptions incl. `menuDescription` | §5; **verified** 251 | local-jsx `Show session cost, plan usage, and activity stats`; local `Show session cost, plan usage, and what's contributing to your limits`; `menuDescription: Show session cost and plan usage`. Directly usable by bl10's Settings tabs. |
| `/terminal-setup`'s four-way description getter + `KNOWN_TERMINALS` | §5 | `{ ghostty: "Ghostty", kitty: "Kitty", WarpTerminal: "Warp", WezTerm: "WezTerm", "windows-terminal": "Windows Terminal" }`, and the four sentences keyed on `$TERM_PROGRAM`. We have terminal detection (`terminalEscapes.ts`) but not this table. |
| `sourceLabel` provenance suffixes | §21.4 | `userSettings→user`, `projectSettings→project`, `localSettings→project, gitignored`, `flagSettings→cli flag`, `policySettings→managed`; plus `(dynamic workflow)`, `(plugin)`, `(claude.ai sync)`, `(<plugin display name>) <desc>`. `suggestPopup.tsx:51-61` correctly records `sourceTag` as underivable — but if `CommandEntry` ever gains provenance, this is the table. |
| C4E upsell strings | §4.2 | `${description} — available with Claude for Enterprise` and `/${name} is available with Claude for Enterprise — ask your admin about migrating from API-key access.` Six names: `ultraplan`, `ultrareview`, `teleport`, `remote-control`, `schedule`, `autofix-pr`. |
| Directory-scoped skill description clauses | §6.5 | Three verbatim ternary arms (`from <dir>/.claude/skills — applies when working on files under <dir>/`, the collision variant, the qualified variant). Model-facing; engine-side. |
| Menu empty state + column width | §21.4 | `No commands match "<input>"` when the query is >1 char, a simple token, and matched nothing; column width `max(len(name)) + 6`. **`suggestPopup.tsx:113-127` already ports the width sum**; the empty-state string is worth checking against `completions.ts:111 commandEmptyMessage`. |

---

## 5. Confirmations

* §10's six tag constants — `command-name`, `command-message`, `command-args`, `local-command-stdout`,
  `local-command-stderr`, `local-command-caveat` — match `species.ts:61-63` exactly. **Verified** 251
  `cli.pretty.js:227471` (`Sg`, `bp`, `A4`, `Bp`, `_S`, `_U`).
* §7's parser: our `parseCommand` (`commands.ts:16-23`) reproduces the trim → strip-`/` → split-first-
  whitespace → trim-args behaviour. `/foo   a  b` yields `args === "a  b"` in both. (Two small deltas:
  we split on `" "` not `/\s/`, so a tab does not separate; and we have no ` (MCP)` re-assembly arm.)
* §21.1's trigger: `completionTriggers.ts:34-73` transcribes `Pli`'s regexes, the six-name
  `COMMAND_DENYLIST` (`add-dir`, `cd`, `resume`, `plugin`, `plugins`, `marketplace`), the CJK boundary
  class and `isCommandToken`. Matches §21.1's `isSimpleToken` / mid-line rules.
* §21.5's inline argument hint: `completions.ts:337-347 commandArgumentHint` reproduces the `De` guard
  (the space must be the *last* character) and the `argumentHint`-only lookup, with the missing
  `argNames` arm honestly recorded.
* §21.6's ghost text: `completions.ts:287 ghostText` is the `inlineGhostCompletion` shape.
* §5.2's four lanes and the `commandKind` shape: `commandComplete.ts:67-97` — the deliberate
  table-first / `type === "prompt"`-second inversion is well argued and correct for a catalog with no
  `type` field. (Membership is wrong; see §1.1.)
* §21.4's column-width rule (`max over the whole catalog, not the matches`): `suggestPopup.tsx:113-127`.
* §22's headless refusal is not theoretical for us — `docs/superpowers/specs/2026-06-19-chat-slash-commands-design.md:35`
  records probe 21 observing `/model`, `/help`, `/status` all answering
  `…isn't available in this environment.` Exactly §22's table row 1.
* §23.3's `deferSlashToEngine(T) { return T.name === "compact" }`: our `session.compact()`
  (`session.ts:258`) injects `/compact` as a turn — the same shape.
* §13–§20 (custom commands, frontmatter, `$ARGUMENTS`/`$N`/`$<name>`, `!`-shell expansion, `@file`,
  plugin namespacing, MCP prompts, bundled skills) are all executed by the spawned CLI, so ccx inherits
  them intact. Our architecture (no local `.claude/commands` loader; forward catalog names as text) is
  the right one and the spec confirms nothing about it needs replicating client-side.

---

## 6. Spec defects

1. **§8 step 8b omits one interactive arm.** The chapter documents only
   `Args from unknown skill: <redacted args>` as the second warning. 2.1.251 `cli.pretty.js:76472` shows
   the *policy-denied* branch emits a differently-worded twin: `` `Args from /${pe}: ${ce}` `` (with
   `***` when the command is sensitive, and the clause suppressed entirely when the value is `***`).
   Two strings, not one.
2. **§5.2's "lane entries with no corresponding registration" list is presented as a 2.1.257 finding**,
   but the identical 127-entry `KIND_MAP` — including all twenty of those names — is already present in
   2.1.251 (`cli.pretty.js:209408`). Not a defect in the data, but the framing invites a reader to treat
   it as a 257 change. It is not; the 251→257 hop moved nothing in this table.
3. **§22's twin list is 17 names but the chapter's own §5 table shows a `local`/`local-jsx` pair for
   `/design`-family and `/skill-doctor` too**, and lists `auto-mode-setup, autocompact, color, config,
   context, effort, extra-usage, fast, goal, import, mcp, model, rename, skill-doctor, ultrareview,
   usage, usage-credits` — that is 17, so the count is right, but `/goal`'s and `/autocompact`'s local
   twins are gated `isNonInteractive() || isRemoteMode()` (per §5) rather than `isNonInteractive()`
   alone as §22's prose states. Minor imprecision that matters if you implement the gate literally.

No contradiction found between the chapter and either bundle, and none between the chapter and our own
pty/probe evidence.

---

## 7. Re-verification against somersault (post-bl10)

The first pass ran against `/Users/new/Developer/GitHub/codex_somersault/CC-to-SDK`, a frozen checkout
predating bl10. Every finding has been re-checked against `/Users/new/Developer/GitHub/somersault/CC-to-SDK`
(HEAD `e337ea7`), and **all `file:line` cites in this document now point at somersault.**

**What actually differs between the two trees, in this lane.** `commandComplete.ts`, `completions.ts`,
`completionTriggers.ts`, `suggestPopup.tsx` and `fileComplete.ts` are **byte-identical** (`diff -q`), so
every §1.1, §1.8, §1.9 and §5 autocomplete finding is unaffected in substance *and* in line numbers.
`commands.ts` differs in exactly four lines — the `/cost`, `/status`, `/usage`, `/stats` summary strings,
rewritten by T-MENU task 3 to say "open the Settings dialog (… tab)". `useChat.ts` gained the bl10
routing (+51 lines, everything after ~line 2200 shifted). `HelpDialog.tsx`, `SettingsDialog.tsx`,
`PermissionsDialog.tsx` and `ChatApp.tsx` changed, and `McpDialog.tsx` + `mcpDialogModel.ts` are new.

| Item | Verdict | What changed |
|---|---|---|
| §0.1 / §1.1 `KIND_MAP` six-name diff | **unchanged** | `commandComplete.ts` is identical across trees; `ZLb` is still at `:60-65` with `pride` present and the five canon names absent. The Python diff against 2.1.251 was re-run against the somersault copy — same result. Cites renumbered `63-68`→`60-65`. |
| §0.2 / §1.2 honesty routing too narrow/broad | **unchanged** | `CLIENT_SIDE_NOTES` is still the same five names (`commands.ts:441-450`), and `dispatch` still forwards every other catalog name raw (`useChat.ts:3390-3395`). bl10 touched none of it. |
| §0.3 stale honesty notes (`/agents`, `/color`, `/extra-usage`, `/fast`) | **unchanged** | Same five strings, unedited. Still needs the probe before acting. |
| §0.4 / §1.3 `/cost` `/stats` `/continue` alias item | **corrected (weakened, then sharpened)** | bl10 **shipped** the behavioural half I had described as pending: `/status`→Status, `/cost`+`/usage`→Usage, `/stats`→Stats on `SettingsDialog.tsx:76`'s four tabs. The *alias* half is untouched — five `CommandRow`s, five `useChat` arms, five `/` menu rows. Rewritten in place; the takeaway now names the catalog shape rather than the dialog. |
| §0.5 / §1.4 POSIX path → `Unknown command` | **unchanged** | `parseCommand` (`commands.ts:16-23`) and the `formatUnknown` fallthrough (`useChat.ts:3395` → `commands.ts:391`) are unedited. One cite was wrong in the first pass (`:435`) and is now `:391` — that was my error, not a tree difference. |
| §0.6 / §1.5 `/compact` drops its argument | **unchanged** | `useChat.ts:2253-2259` still calls `session.compact()` with no argument; `session/session.ts:258` unedited. The `/clear` summary at `commands.ts:42` still reads "clear the screen (session context kept)" while `host.ts:759` swaps the engine — bl10 reworded four summaries and this was not one of them. |
| §1.6 `/mcp` verb vocabulary | **corrected (sharpened)** | bl10 shipped `McpDialog.tsx` and rerouted bare `/mcp` to it (`useChat.ts:2360-2367`), but `parseMcpArgs` is byte-identical: still `toggle <name> on\|off`, still no `all`. The finding is stronger now — the browser landed without adopting canon's `enable`/`disable`/`all` grammar. |
| §1.7 `/bg` collides with canon's `bg` | **unchanged** | `commands.ts:74`, unedited. |
| §1.8 `/` menu ranking (empty-query order, Fuse tiers, usage score) | **unchanged** | `commandComplete.ts` and `fileComplete.ts` identical. |
| §1.9 matched-alias suffix on the row | **unchanged** | `ChatComposer.tsx:257` still builds a bare `` `/${e.name}` ``. |
| §2.1 `terminal_slash_commands` unused by the REPL | **unchanged** | `router.ts:92` unedited; `useChat.ts:1948-1983` still keeps only `caps.commands`. |
| §2.2–§2.7 (stacking, subcommands, raw interpolation, `isSensitive`, `advertisedCommand`, `HEADLESS_YIELDABLE_NAMES`) | **unchanged** | All engine-side or canon-side; nothing in either tree touches them. |
| §3 row: bl10 status family | **corrected** | Marked shipped, and I added the finding the shipped shape raises: canon has **three** dialogs here (`/status`, `/usage`, `/config`) and ccx merged them into one four-tab dialog. Defensible, but it belongs in tui-ux.md §4 as a recorded divergence rather than as parity. |
| §3 rows: `/config` arg-completions, `/diff`, `/effort`, `/copy`, `/vim`, `/help` `immediate` | **unchanged** | bl10 added no `getArgumentCompletions`, no `immediate`, and did not touch `/diff` or `/vim`. |
| §4 verbatim assets | **unchanged** | Re-grepped somersault for all twelve: none of the canon strings appear in `harness/src`. `species.ts:61-63` and `replay.ts:56` are unedited. |
| §5 confirmations | **unchanged** | Autocomplete files identical; `HelpDialog.tsx` changed (bl10 fix wave 7 clipped `browserOptions`' label and reworked the tab type) but the three cited facts — the `SlashCommand`-has-no-`type` note at `:15`, the dropped `/powerup` line at `:20-22`, the catalog-gated `/feedback` line at `:70-73` — all survive. Cites renumbered. |
| §6 spec defects | **unchanged** | Bundle-side only; no repo dependency. |
| §7 catalog diff table (now §8) | **corrected, 4 rows** | `/mcp`, `/status`, `/usage`, `/config` "our status" notes rewritten for bl10. All other 120-odd rows depend on `commands.ts`'s `COMMANDS` membership, which bl10 did not change (four summary strings only), so they stand. |

**Nothing withdrawn.** bl10 moved one finding from "pending" to "half-shipped" (§1.3) and made one
sharper (§1.6); everything else was independent of the files it touched.

---

## 8. Catalog diff table

**Columns.** *Type* is canon's. *Runs where* applies §22's `runsHeadless` predicate to decide whether
the SDK's print-mode CLI would execute the command if `ccx` forwarded `/name args` as text:
**E** = engine-side reachable (`prompt` without `disableNonInteractive`, or `local` with
`supportsNonInteractive`); **T** = TUI-local (`local-jsx`, or `local` without SNI) — dead unless we
build it. Twin rows are collapsed onto one line with the twin's type noted. *Ours*: `canon` (built,
matches) · `diff` (built, diverges — see §1) · `honest` (honesty-routed) · `—` (missing) ·
`n/a` (unreachable/out of scope) · `ccx` (ours only, no canon row).

| Command | Aliases | Type | Enable (short) | Runs where | Ours | Note |
|---|---|---|---|---|---|---|
| `/add-dir` | | local-jsx | — | T | canon | `AddDirDialog.tsx`; canon's arg-completer (dir completion, §21.5) missing |
| `/advisor` | | local-jsx | env + firstParty + `tengu_sage_compass2` | T | canon | bl8 T-ADVCMD; canon is `control-request` on thin clients |
| `/agents` | | local | — | **E** | honest | canon's headless twin prints our exact sentence — verify then drop the note (§1.2) |
| `/artifacts` | `[]` | local-jsx | artifacts enabled | T | — | ch. 44 |
| `/auto-mode-setup` | | local-jsx + local | auto mode available | E (local twin) | — | only `local`/`local-jsx` command `skillOverrides` can switch off (§20.1) |
| `/autocompact` | | local-jsx + local | — / `isNonInteractive()\|\|isRemoteMode()` | E | — | `[auto\|<tokens>]`; we have no autocompact-window control |
| `/autofix-pr` | | local-jsx | claude.ai + `allow_remote_sessions` | T | n/a | cloud |
| `/background` | **`bg`** | local-jsx | FleetView on | T | — | **name collision with our `/bg`** (§1.7) |
| `/branch` | | local-jsx | — | T | — | ch. 35; conversation branching |
| `/brief` | | local-jsx | `briefConfig.enable_slash_command` | T | — | |
| `/btw` | | local-jsx | — | T | — | side question; `control-request` |
| `/bug` | `share` | local-jsx | — | T | n/a | out of scope (command-coverage.md) |
| `/cd` | | local-jsx | — | T | — | command-coverage.md §C claimed `/cd` doesn't exist — **that premise is now wrong**, 2.1.257 registers it |
| `/chrome` | | local-jsx | `!isNonInteractive()` | T | n/a | ch. 46 |
| `/clear` | `reset`, `new` | local | — | **E** | diff | aliases + `[name]` arg missing; our summary contradicts our behaviour (§1.5) |
| `/cloud-plugins` | | local-jsx | cloud plugins available | T | — | missing from our `KIND_MAP` too (§1.1) |
| `/color` | | local-jsx + local | — / `isNonInteractive()` | E (local twin) | honest | `terminalOriented`; twin may actually run (§1.2) |
| `/compact` | | local | `!DISABLE_COMPACT` | **E** | diff | args dropped (§1.5); the only `deferSlashToEngine` command |
| `/config` | `settings` | local-jsx + local | — / `isNonInteractive()` | E (local twin) | diff | `/settings` is a row not an alias; `getArgumentCompletions` missing (§3); bl10 gave it the Config tab of the merged dialog |
| `/context` | | local-jsx + local | `!isNonInteractive()` / `isNonInteractive()` | E (local twin) | canon | canon's local-jsx takes `[all]`; ours takes no arg |
| `/copy` | | local-jsx | — | T | canon | T-COPY shipped `/copy N`; two arms still 🟡 per tui-ux.md |
| `/design` · `/design-consent` · `/design-revoke` | | local | `allow_design_sync` policy | E | n/a | ch. 44; `/design` has a `subcommands` map (§12) |
| `/design-login` | | local-jsx | same | T | n/a | |
| `/desktop` | `app` | local-jsx | `allow_desktop_handoff` | T | n/a | out of scope |
| `/diff` | | local-jsx | — | T | diff | ours is a `git status/diff --stat` stand-in; canon is a panel (§3) |
| `/effort` | | local-jsx + local | — / `isNonInteractive()` | E (local twin) | canon | 🟡 in tui-ux.md for `auto`/`ultracode`; hint is computed in 257 |
| `/exit` | `quit` | local-jsx | — | T | canon | `terminalOriented`, `fleetHostCall`; description is a getter (background-session variant) |
| `/export` | | local-jsx | — | T | canon | canon hint `[filename]`, ours `[file\|clipboard]` |
| `/extra-usage` | | local-jsx + local | credits available | E (local twin) | honest | canon prints `Renamed to /usage-credits` — same message we hand-wrote |
| `/fast` | | local-jsx + local | — / `isNonInteractive()` | E (local twin) | honest | **twin may really toggle fast mode** (§1.2) |
| `/feedback` | | local-jsx | — | T | n/a | out of scope; `HelpDialog.tsx:70-73` gates its help line on the live catalog |
| `/focus` | | local-jsx | — | T | — | focus view |
| `/fork` | | local-jsx | `!coordinatorMode()` | T | — | two descriptions depending on FleetView |
| `/goal` | | local-jsx + local | — / `isNonInteractive()\|\|isRemoteMode()` | E (local twin) | — | coverage.md records `/goal` dead headless (probes 46/46b/46c) — **conflicts with §5's `supportsNonInteractive: ✓`**; our probe evidence wins until re-probed |
| `/heapdump` | | local | `allow_heap_dump` policy | E | honest | correctly ours to refuse — dumps the CLI's heap |
| `/help` | | local-jsx | — | T | canon | `HelpDialog.tsx`; canon's `immediate`-when-fullscreen missing (§3) |
| `/hooks` | | local-jsx | — | T | — | ch. 27; `requires: { workspace: false }` |
| `/ide` | | local-jsx | — | T | n/a | out of scope |
| `/import` | | local-jsx + local | `tengu_import` | E (local twin) | — | import config from codex/gemini |
| `/init` | | **prompt** | — | **E** | — | free if forwarded; §25.1 has both bodies verbatim |
| `/insights` | | **prompt** | — | **E** | — | free if forwarded; `disableModelInvocation` |
| `/install-github-app` · `/install-slack-app` | | local-jsx / local | availability gates | T / E(`false`) | n/a | out of scope |
| `/keybindings` | | local | `tengu_keybinding_customization_release` | T (`SNI: false`) | canon | our `$EDITOR` opener matches canon |
| `/limit-reset` · `/low-priority` | | local | claude.ai + rate-limit state | T (`SNI: false`) | n/a | both missing from our `KIND_MAP` (§1.1) |
| `/list-agents` | `peers` | local | `tengu_harbor_kite` | **E** | — | ch. 38/39; we have cross-session messaging (M6/M8) but no `/list-agents` |
| `/login` · `/logout` | | local-jsx | `!DISABLE_*_COMMAND` | T | n/a | excluded by owner decision (auth is `.env`-driven) |
| `/loops` | | local-jsx | `isEnabled: () => false` | — | n/a | **never registered in 2.1.257** |
| `/mcp` | | local-jsx + local | — / `isNonInteractive()` | E (local twin) | diff | bare `/mcp` opens bl10's `McpDialog.tsx` browser ✅; sub-verb grammar still `toggle …on\|off` vs canon `enable`/`disable`/`all` (§1.6) |
| `/memory` | | local-jsx | — | T | — | ch. 10; Wave C deleted our `#` memory mode |
| `/mobile` | `ios`, `android` | local-jsx | — | T | n/a | out of scope |
| `/model` | | local-jsx + local | — / `isNonInteractive()` | E (local twin) | canon | `ModelPicker.tsx`; description is a getter naming the current model |
| `/output-style` | | local-jsx | `tengu_maple_sundial` | T | canon | our redirect matches canon's own hidden redirect |
| `/passes` · `/privacy-settings` · `/pro-trial-expired` · `/rate-limit-options` · `/upgrade` · `/usage-credits` | | local-jsx (+local twins) | account/entitlement gates | T / E | n/a | account/billing; ch. 08 |
| `/pause-memory` | `memory-pause`, `toggle-memory` | local | `isEnabled: () => false` | — | n/a | **never registered in 2.1.257** |
| `/permissions` | `allowed-tools` | local-jsx | — | T | diff | `PermissionsDialog.tsx` ✅; `/allowed-tools` is a row not an alias |
| `/plan` | | local-jsx | — | T | — | we have `PlanDialog.tsx` for the tool, not the command |
| `/plugin` | `plugins`, `marketplace` | local-jsx | — | T | — | has `getArgumentCompletions` |
| `/plugin-types` | | local | `tengu_plugin_hooks_modules` | **E** | — | missing from our `KIND_MAP` (§1.1) |
| `/powerup` | | local-jsx | — | T | n/a | `HelpDialog.tsx:20-22` deliberately drops the line that names it |
| `/radio` · `/stickers` | | local | — | T (`SNI: false`) | n/a | |
| `/recap` | | local | — | **E** | — | one-line session recap; `post-text`; cheap win if forwarded |
| `/release-notes` | | local-jsx | — | T | — | |
| `/reload-plugins` | | local | — | T (`SNI: false`) | — | `terminalOriented`; we have `appserver/reloads.ts` plumbing |
| `/reload-skills` | | local | — | **E** | — | same plumbing exists |
| `/remote-control` `rc` · `/remote-env` · `/session` `remote` · `/teleport` `tp` · `/ultraplan` · `/ultrareview` · `/web-setup` | | local-jsx (+twins) | cloud entitlements | T / E | n/a | ch. 36/37; `/session` is **ours-divergent** — tui-ux.md §5 records the deliberate re-purposing |
| `/rename` | `name` | local-jsx + local | — / `isNonInteractive()` | E (local twin) | canon | `name` alias missing; canon hint `[name]` |
| `/resume` | **`continue`** | local-jsx | — | T | diff | `continue` is an alias in canon, a separate command here (§1.3) |
| `/rewind` | `checkpoint`, `undo` | local | — | T (`SNI: false`) | canon | aliases correct; `RewindPicker.tsx` |
| `/sandbox` | | local-jsx | platform-gated | T | — | ch. 17 |
| `/scroll-speed` | | local-jsx | fullscreen renderer | T | — | we have fullscreen (FSW) but no speed control |
| `/security-review` | | **prompt** | — | **E** | — | free if forwarded; §25.2 verbatim |
| `/skill-doctor` | | local-jsx + local | `tengu_lantern_prism` | E (local twin) | — | |
| `/skills` | | local-jsx | — | T | — | ch. 29 |
| `/status` | | local-jsx | — | T | diff | bl10 routes it to `SettingsDialog` Status tab ✅ — canon is its own dialog, ours is one tab of three merged (§3) |
| `/statusline` | `[]` | **prompt** | — | T (`disableNonInteractive`) | — | the **only** command setting `disableNonInteractive`; §25.4 verbatim |
| `/stop` · `/subtask` | | local-jsx | FleetView gates | T | — | |
| `/tasks` | `bashes` | local-jsx | — | T | diff | we ship this as `/bg` with `tasks`/`bashes` as aliases (§1.7) |
| `/team-onboarding` | | **prompt** | `allow_team_onboarding` policy | **E** | n/a | §25.5 verbatim |
| `/terminal-setup` | | local-jsx | — | T | — | four-way description getter + `KNOWN_TERMINALS` (§4) |
| `/theme` | | local-jsx | — | T | canon | `ThemeDialog.tsx`; 5 of 7 themes |
| `/tui` | | local-jsx | — | T | canon | FSW T15; strings byte-verified |
| `/update` | `restart` | local | `isEnabled: () => false` | — | n/a | **never registered in 2.1.257** |
| `/usage` | **`cost`, `stats`** | local-jsx + local | — / `isNonInteractive()` | E (local twin) | diff | bl10 routes `/usage`+`/cost`→Usage tab, `/stats`→Stats tab ✅; still three catalog rows where canon has one + two alias keys (§1.3) |
| `/vim` | | local-jsx | `tengu_maple_sundial` | T | — | ❌ owner-deferred; §3 shows it is a two-line redirect factory |
| `/voice` | | local | availability `claude-ai` | T (`SNI: false`) | n/a | ch. 43 |
| `/wellbeing` | `breaks`, `break-reminder`, `downtime` | local-jsx | `isEnabled: () => false` | — | n/a | **never registered in 2.1.257** |
| `/workflows` `[]` · `/workflow-launch-exec` · `/__remote-workflow` | | local-jsx / local | workflows enabled | T / E | n/a | ch. 40 |
| `/daemon` | | local-jsx | literal `false` | — | n/a | **never registered**; ships but unreachable |
| C4E stubs ×6 (`ultraplan`, `ultrareview`, `teleport`/`tp`, `remote-control`/`rc`, `schedule`/`routines`, `autofix-pr`) | | local | API-key + `tengu_c4e_slash_upsell` | E | n/a | hidden upsell stubs (§4.2) |

**Ours-only rows (no canon command).** `/think` · `/yolo` · `/history` · `/files` · `/tag` ·
`/detach` · `/stats` · `/cost` · `/session` (re-purposed) — all verified absent as command names in
2.1.251. `tui-ux.md`'s "Recorded additions" covers `/yolo`'s consent gate; the rest are undeclared
additions in the §5 table and could use one line each there.

**Coverage arithmetic.** The 126-row catalog is 5 `prompt` + 41 `local` + 80 `local-jsx` (§5). Applying
§22: **35 rows are `E`** — 31 of the 41 `local` rows declare `supportsNonInteractive` and 4 of the 5
`prompt` rows lack `disableNonInteractive` (`/statusline` sets it) — and **91 are `T`** (80 `local-jsx`,
10 `local` with `supportsNonInteractive: false`, plus `/statusline`). We build 23 as canon, 10
differently, honesty-route 5, and are missing roughly 33 that are in scope; the remainder is
cloud/account/enterprise, correctly out of scope.

The cheapest wins are all in the `E` column, where the work is *not intercepting*: `/recap`,
`/reload-skills`, `/init`, `/security-review`, `/insights`, `/list-agents`, `/plugin-types` and
`/autocompact` execute today if forwarded. The most expensive column is `T`: 91 rows that are dead
unless `ccx` builds them, which is also the honest denominator for tui-ux.md §5's score.

