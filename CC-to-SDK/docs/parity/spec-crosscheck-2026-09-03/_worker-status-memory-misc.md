# spec257 cross-check — worker: status / memory / sandbox / git / worktree UIs

Lanes: (A) ch.49 `/status` `/doctor` `/bug` `/feedback` `/version` `/update`, (B) ch.10 `/memory` + `#`,
(C) ch.17 `/sandbox`, (D) ch.47 `/branch` `/diff`, (E) ch.23 worktree prompts.

**Bundle-verification note.** Every line cited as `cli.pretty.js:N` below was read by me in this session
from `~/claude-code-bundle/<version>/cli.pretty.js`. Chapter 49 was a capped review pass, so anything not
carrying a bundle line I read myself is labelled **spec-only**.

**Counts.** Corrections 8 (C1-C5, XC1-XC3) · Unknown unknowns 8 (U1-U4, XU1-XU4) · Known gaps now
specified 6 (G1-G3, XG1-XG3) · Verbatim assets 12 · Confirmations 11 · Spec defects 6.

**Top four, ranked.**
1. **XC1** — our "yes, don't ask again" arm ignores the engine's `suggestions` and grants the *whole
   tool*, so approving one sandbox host allows all of them and the rule we persist is one no engine
   reads. A real bug, not a parity gap.
2. **C1** — `/status`'s field set is invented end to end; not one of canon's ~20 Title-case labels
   appears in ours, and several missing rows (account, MCP counts, version, session kind) are reachable
   with data already in the process. bl10 fixes the *routing* and explicitly leaves this.
3. **U1 / XU1 / XU2** — three entire surfaces with no scorecard row at all: `/memory`'s picker, the
   sandbox network-access dialog, and `/sandbox`'s four-tab panel.
4. **§5 first bullet** — the `#` memory mode is provably dead in canon (orphaned renderer, no producer,
   in all three bundles), which settles spec Open question 1 and vindicates our removal.

**Repo-state note.** `main` at `87f50411ab` carries the bl10 **spec + plans only** — the bl10
implementation (status-family routing into `SettingsDialog`) is **not merged into this tree**. Findings
below are against the code actually on `main`; where bl10's plan already covers a finding I say so.

---

## 1. Corrections — we built it, canon differs

### C1. `/status`'s field set is entirely invented; not one label is canon's. (HIGHEST)

**Ours:** `harness/src/tui/commands.ts:352-393` (`formatStatus`), rendered inline into the transcript by
`harness/src/tui/useChat.ts:2254-2270` and into the Settings **Status** tab by
`harness/src/tui/useChat.ts:3083-3086` (`fetchSettingsStatus`). We print a bold `Status` header then
two-space-indented dim rows with lowercase labels:
`model · mode · thinking · effort · context · cwd · session · usage · renderer`.

**Canon** (spec §49.21.1; verified `2.1.257/cli.pretty.js:352796` for group 1, `:352802` for group 2,
`:771916` for `Setting sources`, `:771860-771898` for the MCP row, `:772018-772043` for the account rows):
the Status tab is a two-column `**Label:**` / value table with `Label` in **Title case**, built by two
functions separated by a blank row, then one bold heading:

| Group | Rows, in order |
|---|---|
| 1 (`Xu`, `:352796`) | `Version`, `Session name`, `Session ID`, `Session kind`, `tmux session`?, `Channels`?, `Peer address`?, `Memory`?, `cwd`, account rows (`Login method`/`Auth token`/`API key`/`Profile`/`Organization`/`Email`), `Claude Code on the web`?, `Compliance`?, provider rows (`API provider`, base URLs, `Proxy`, `Additional CA cert(s)`, mTLS) |
| — | blank row |
| 2 (`Ju`, `:352802`) | `Model`, `IDE`, `MCP servers`, `Setting sources`, `Skipped sources`?, `Managed settings (remote)`? |
| — | bold heading `System diagnostics` + one line per diagnostic |

Two rendering details I read directly and the spec compresses: the row builder `Af`
(`2.1.257/cli.pretty.js:352781-352786`) emits the label cell as `` `${label}:` `` (so it is
`Version:`, colon included), emits an **empty** first cell for the label-less provider rows, and inserts
the blank separator row *itself* whenever the group index is > 0. And each `System diagnostics` line is
**not** plain text — `Rf` (`:352787-352789`) renders it as a `flexDirection:"row", gap:1, paddingX:1`
node led by a **warning status glyph**. Bold heading confirmed at `:352925`.

**Intersection with ours is two rows** (`cwd`, and `Model` vs our `model`) and even those differ in case.
Canon has **no** permission-mode row, **no** thinking row, **no** effort row, **no** context-% row, **no**
renderer row — all five are ours. Canon has ten-plus rows we don't print, of which these are reachable
today:

- `Version` — trivial (`harness/src/cli/help.ts:17` already computes `versionLine()`).
- `Session name` — we have `/rename`; canon's empty state is the dim `/rename to add a name`
  (`2.1.257/cli.pretty.js:352791`).
- `Session ID` — we already have it (we just truncate to 8 chars; canon prints it whole).
- `Session kind` — we have `interactive` / `--bg` / `ccx attach`; canon's three literals are
  `interactive`, `background job · unattended`, `background job · attached` (`:352796`).
- **Account rows — the data is already in the process.** `harness/src/tui/banner.ts:54`
  `AccountFacts { apiProvider, tokenSource, apiKeySource }` is fetched live via
  `harness/src/tui/accountBridge.ts` and consumed only by the banner's billing label. Canon spends
  exactly those three on `API provider` / `Auth token` / `API key`
  (`2.1.257/cli.pretty.js:772026`, `:772028`, and the provider row at `:772047`). Adding them to
  `/status` costs one bridge read.
- `MCP servers` — we already call `mcpServerStatus()` (`harness/src/tui/commands.ts:463-469`) but render
  a per-server list; canon's Status row is a **count summary**:
  `<n> connected, <n> cached, <n> need auth, <n> pending, <n> disabled, <n> failed · /mcp`, each clause
  omitted at zero, `· /mcp` always appended (`2.1.257/cli.pretty.js:771885-771898`).
- `Setting sources` — we have `harness/src/tui/settingsFile.ts`; canon lists the humanised source names
  (`:771916`).

**Not reachable / N-A for an SDK client (flag, don't assert):** `IDE`, `Channels`, `Peer address`,
`Compliance`, `Claude Code on the web`, `Managed settings (remote)`, `Memory` (paused). `System
diagnostics`' four producers are installer/launcher facts we have no analogue for except the
oversized-memory-file line.

**Verified**, and **stable 220 → 257** in shape: 2.1.220 built the same group-1 array
(`2.1.220/cli.pretty.js:440482`) and the same group-2 array (`:440489`, `Model` + IDE + MCP + sources);
257 *adds* `Session kind`, `Peer address`, `Compliance`, `Claude Code on the web` and the expanded
provider table. So this is not 220→251 drift — we simply never transcribed the row set (U4 shipped an
invented layout; `docs/parity/tui-ux.md:905-910` records the same admission for `/cost`, which Wave S t7
later re-cut against `Aze`; `/status` never got that treatment and still carries a ✅ at
`docs/parity/tui-ux.md:2286`).

**bl10 does not close this.** `docs/superpowers/specs/2026-08-31-bl10-menus-click-spacing-design.md:52-53`
explicitly keeps "the text formatters (`formatStatus` etc.) … as library functions" and gates the switch
on *information equivalence with our own text*, not on canon's field set.

### C2. `/status` prints into the transcript instead of opening a dialog

**Ours:** `harness/src/tui/useChat.ts:2268` — `append(formatStatus(...))`.
**Canon:** `/status` is `type: "local-jsx", immediate: !0` and its whole implementation is
`return e(B4, { onClose: o, context: t, defaultTab: "Status" })` — it opens the shared **Settings**
dialog on its Status tab and prints nothing. **Verified at all three versions:**
`2.1.220/cli.pretty.js:350767` + `:478186`, `2.1.251/cli.pretty.js:503100` + `:594062`,
`2.1.257/cli.pretty.js:144030` + `:726477`. Spec §49.21.

**Already planned:** bl10 T-MENU routes `/status`/`/usage`/`/cost`/`/stats` into `SettingsDialog` on
their tab. Listed here because it is unmerged on `main`, and because C1 (the field set) survives it.

### C3. Settings-shell dismissal message names the wrong dialog

**Ours:** `harness/src/tui/useChat.ts:2953` and `:2958` — `notice("Config dialog dismissed")` on every
Esc-close of the Settings shell, whatever tab was showing.
**Canon has two distinct strings and ours is the inner one:** the **shell** `B4` prints
`Settings dialog dismissed` on Esc from any tab (`2.1.257/cli.pretty.js:356029`); `Config dialog
dismissed` belongs to the **Config pane** `ca` and only when its own change summary is empty
(`:353402`). There is also `Stats dialog dismissed` (`:355390`). **Verified.**
Note `harness/src/tui/PermissionsDialog.tsx:96` already calls "Settings dialog dismissed" an *unused*
string — it is not unused, it is the shell's. bl10's RF7-5 logs a fix for this; check that the fix picks
`Settings dialog dismissed` for every tab rather than per-tab names.

### C4. `ccx doctor`'s report drops two checks whose inputs we already read

**Ours:** `harness/src/cli/help.ts:244-255` (`doctorReport`) — 5 fact lines + `No installation issues
found.`, with a header comment saying every omitted line is one "whose fact ccx does not have".
**Canon** (spec §49.18.3; header/closing verified at `2.1.257/cli.pretty.js:649319` and `:649366`, and
identically at `2.1.220/cli.pretty.js:411293`/`:411330`) also emits, each conditional:
an **`Invalid settings`** section (`- <file> › <path>: <message>` + optional `  Suggested fix: <s>`), an
**`Environment variables`** section (`- <NAME>: <message>`, only for non-`valid` status), plus
`Multiple installations found` and `Remote Control`. The first two **are** facts we have: we parse
settings files (`harness/src/tui/settingsFile.ts`) and we read env vars.
**Verified** at `2.1.257/cli.pretty.js:649324-649348`: both section headers are **yellow**; the invalid-
settings line is `` `- ${file} › ${path}: ${message}` `` (separator is U+203A, the `file › path` prefix
plus its `: ` dropped when neither is known) with an optional continuation line
`` `  Suggested fix: ${suggestion}` ``; unheadered status notices follow as `- <message>`; the env-var
section prints `- <NAME>: <message ?? status>`. Every value passes a sanitiser that strips VT sequences,
collapses control-character runs to one space and deletes backticks.

### C5. `--version --verbose` prints no commit line

**Ours:** `harness/src/cli/args.ts:162` sets `a.version` and `harness/src/cli/main.ts:177` prints
`versionLine()` only. **Canon** (`cli:67-71`, spec §49.2.1) intercepts `--version|-v|-V` when it is the
sole argument **or** is followed by exactly `--verbose`, and in the two-argument case prints a second
line `Commit: ${GIT_SHA}`. **Spec-only** (the cite is the `modules/cli` entry stub, not `cli.pretty.js`;
I did not open it). Cosmetic; log as debt rather than fix.

---

## 2. Unknown unknowns — canon behaviours with no `tui-ux.md` row

### U1. `/memory` — the instruction-file picker. We have no `/memory` command at all. (HIGHEST in lane B)

`docs/parity/tui-ux.md` §5's slash-command table has **no `/memory` row** in any state, and
`harness/src/tui/commands.ts:33-115` (`COMMANDS`) has no entry. Canon's is
`{ type: "local-jsx", name: "memory", description: "Edit CLAUDE.md files and memory settings" }`
(**verified** `2.1.257/cli.pretty.js:143678`; also present at `2.1.251/cli.pretty.js:502770`). Its
2.1.220 form was narrower — `description: "Open a memory file in your editor"`
(**verified** `2.1.220/cli.pretty.js:316038`) — so **the settings half of this command is 220→251 drift**
and a transcription made at 220 would have missed it.

Spec §10.24.1 gives the picker in full: four toggle rows above the list (`Auto-memory: on|off`,
`Auto-dream: on|off · last ran <relative>`, `Write to synced project memory`, `Synced project memory:
active|parked|ended`), then a `Sync memories from: <project|off>` row, then the instruction-file rows
with a five-branch **description chain** (`Saved in ~/.claude/CLAUDE.md` / `Checked in at ./CLAUDE.md`
(git) or `Saved in ./CLAUDE.md` / `@-imported` / `dynamically loaded` / empty) and a separate three-branch
**label chain** (`User instructions`, `Project instructions`, `` `${indent}L ${basename}${" (new)"}` ``),
then `Open auto-memory folder` / `Open team memory folder` / `Open synced project memory: <mount>`.
Selecting a row creates the file with `flag: "wx"` and opens `$VISUAL`/`$EDITOR`, reporting
`Opened <shortened path>` plus one of two editor-hint lines, with the failure copy
`Couldn't open <p> in an editor. If no editor is configured, set $EDITOR or $VISUAL, then run /memory
again.` and the cancel line `Cancelled memory editing`.

**Both chains verified by me** at `2.1.257/cli.pretty.js:587513-587534`, including the ` (new)` suffix,
the two-space-per-depth indent and the `L ` prefix on imported children. The **description** chain is
byte-identical at 2.1.220 (`2.1.220/cli.pretty.js:470921-470930`), so it predates our baseline; the
**label** chain (`User instructions` / `Project instructions`) is **257-only** — 220 had no such
branch — which is more 220→251 drift on the same command. The toggle rows, the `Opened …` report and
the failure/cancel copy remain **spec-only**.

**Reachability: good for the core, partial for the toggles.** The CLAUDE.md discovery half is ours to do
(we already walk settings files, and `harness/src/tui/externalEditor.ts` already spawns `$EDITOR`). The
auto-memory half is partly exposed: `init.memory_paths.auto` is acknowledged on the wire
(`probes/probes/117-memory-recall-stream.ts:25`, `117b`), so the folder rows are reachable; but
`docs/parity/tui-ux.md:1168-1170` records **memories HOLD DEAD** — zero `system/memory_recall` frames
ever arrive — so the `Auto-dream`/`Synced project memory` status rows have no data source. FLAG: a
`/memory` that shipped only the instruction-file half would be honest and is ~80% of the value.

### U2. `/pause-memory` is compiled in but hard-disabled — a trap for a transcriber

Canon's descriptor carries `isEnabled: () => false` literally, and the registry filters on it, so
`/pause-memory` **does not appear** in 2.1.257 even though the implementation still ships and prompt text
still tells the model to run it (spec §10.24.2, `chunk-1kg58a1a.js:143678-143680`). Same shape as
`/update`/`/restart` (see F3). **Spec-only for `/pause-memory`; verified for `/update`.** No action —
recorded so nobody adds it from a prompt-string sighting.

### U3. The recalled-memories viewer (`Memories recalled this session`)

Spec §10.24.4: a footer affordance appears only when `tengu_stone_shell` is on **and** at least one
recalled memory is unrated; it opens a panel titled `Memories recalled this session` with a
`<N> memory|memories` count suffix, per-row `g`/`b` ratings, and empty states `No memories recalled yet`
/ `Every recalled memory is rated`. **Spec-only.** **Reachability: blocked** — the same
`system/memory_recall` frames that never arrive (`docs/parity/tui-ux.md:1168-1170`) are its only input.
Record as 🚫 unreachable rather than ❌.

### U4. `/bug` and `/feedback` — a five-state dialog we have no equivalent of

Spec §49.22. Two `local-jsx` commands (`/bug` alias `/share`, `/feedback`), one dialog titled
`Submit feedback / bug report`, states `userInput → scope → consent → submitting → done`, three history
scopes (`This session only` / `This session + the last 24 hours` / `This session + the last 7 days`), a
five-bullet consent list, and three modes (`post` to the API / `bundle` to a local redacted zip /
`disabled` with a printed reason). **Spec-only.**

**Reachability: the `bundle` mode is entirely ours to build** — a local, redacted zip of the transcript +
environment + git metadata needs nothing from the engine, and it is the mode canon itself falls back to
for third-party providers. The `post` mode should be **deliberately dropped**: ccx is not Claude Code and
must not file reports into Anthropic's issue endpoint. Recommend a `/bug` that is bundle-only, reusing
`harness/src/tui/sessionTools.ts`' export path. Not currently in any scorecard table.

---

## 3. Known gaps now specified

### G1. `/status`'s ✅ at `docs/parity/tui-ux.md:2286` is unearned — rescore

The row reads "**U4** — model · mode · thinking · context · cwd · session snapshot", i.e. it scores our
own invented layout against itself. §49.21.1 now supplies the complete canon row set, the exact labels,
the two-group + blank-row structure, the `System diagnostics` heading, and the empty-state strings. This
is the same category error `docs/parity/tui-ux.md:905-910` already confessed for `/cost` and fixed in
Wave S t7. Recommend ✅ → 🟡 with C1 as the gap statement.

### G2. `/diff`'s 🟡 (`docs/parity/tui-ux.md:2303`) — mechanism now specified

Our row says "terminal stand-in (`git status --short; git diff --stat`) — real CC has a full DiffDialog
with per-turn sources (Wave-2+ candidate)". `docs/superpowers/.../research-slash-menus.md:112` already
pinned canon's shape: **title `null`, one tab per conversation turn — `Current · T1 · T2 …`**. Chapter 47
is the delegated worker's lane; see §7.

### G3. Non-interactive refusal for panel commands — exact string

Once bl10 makes `/status` (and the rest of the status family) modal, ccx needs canon's headless refusal.
**Verified verbatim** at `2.1.257/cli.pretty.js:338523` and `2.1.220/cli.pretty.js:241461`:

```
/${name} opens an interactive panel and isn't available in this environment. Run it from the Claude Code terminal instead.
```

We have no such string anywhere in `harness/src/` (grepped). Relevant to `ccx --print` / `--json`.

---

## 4. Verbatim assets worth pinning (we lack all of these — checked our source first)

Ranked. Point-only; the spec has the full blocks.

1. **`/status` row labels + empty states** — `2.1.257/cli.pretty.js:352796` (group 1),
   `:352802` (group 2), `:771885-771898` (the MCP count row), `:772018-772043` (account rows),
   `:352925` (`System diagnostics`). Dim empty state `/rename to add a name` at `:352791`. The three
   `Channels` unavailability reasons at `:352793`. **Verified.**
2. **Settings-shell dismissal** `Settings dialog dismissed` — `2.1.257/cli.pretty.js:356029`. **Verified.**
3. **Headless panel refusal** — `:338523`, quoted in full in G3. **Verified.**
4. **`/memory` picker strings** — spec §10.24.1 lines 4159-4232. The two row chains are **verified**
   (`2.1.257/cli.pretty.js:587513-587534`): `Saved in ~/.claude/CLAUDE.md`, `Checked in at ./CLAUDE.md`,
   `Saved in ./CLAUDE.md`, `@-imported`, `dynamically loaded`; `User instructions`,
   `Project instructions`, `` `${"  "×(depth-1)}L ${basename}${" (new)"}` ``. `Opened …`, the two editor
   hints, `Couldn't open … run /memory again.` and `Cancelled memory editing` are **spec-only**.
5. **`claude doctor`'s conditional sections** — `2.1.257/cli.pretty.js:649324-649348`, quoted in C4.
   **Verified**, including the yellow headers and the U+203A separator. The three env vars canon checks
   are `BASH_MAX_OUTPUT_LENGTH`, `TASK_MAX_OUTPUT_LENGTH`, `CLAUDE_CODE_MAX_OUTPUT_TOKENS`.
6. **`/bug` dialog copy** — spec §49.22.3 lines 3960-4022 (`Submit feedback / bug report`,
   `Describe the issue below:`, `Please describe the issue before submitting.`,
   `Edit and press Enter to retry, or Esc to cancel`, `How much session history should we include?`, the
   three scope labels, the `bundle`-mode consent footer). Take the `bundle` column only. **Spec-only.**

---

## 5. Confirmations

- **The `#` memory mode is NOT canon — our Wave C t14 removal (owner decision D-C2,
  `docs/parity/tui-ux.md:1189`) was right, and I can now say so more strongly than the spec does.**
  Spec §10.24.3 says flatly "No `#`-prefixed quick-memory input mode exists in 2.1.257" but files it as
  Open question 1 ("I cannot prove a negative"). **The bundle proves it structurally.** In 2.1.220,
  2.1.251 *and* 2.1.257 the `<user-memory-input>` token appears exactly **5 times**, and every one is a
  *reader*: the transcript renderer `Bd` (`2.1.257/cli.pretty.js:766060-766095` — the `#` glyph in
  `remember`/`memoryBackgroundColor` plus a random ack from `["Got it.", "Good to know.", "Noted."]`),
  its two router predicates (`:766279-766280`, `:766407`) and one `includes()` filter (`:442885`).
  **No site anywhere constructs the tag.** The renderer is orphaned in all three builds, i.e. `#` was
  already dead at our 2.1.220 baseline. This should be promoted out of `docs/parity/tui-ux.md:1490`'s
  "reasoned, not observed" list for router exit 12 — it is now settled by construction.
- **`/update` and `/restart` are dead in canon**, `isEnabled: () => !1, isHidden: !0`, **verified
  identically at all three versions** (`2.1.220:353520`, `2.1.251:504311`, `2.1.257:144983`). We have no
  updater and that is correct, not a gap.
- **`/doctor` is a prompt-type command upstream**, `disableModelInvocation: true`,
  `progressMessage: "running checkup"`, alias `checkup` (spec §49.19.1). Our decision to leave `/doctor`
  as a submit-as-turn (`docs/parity/tui-ux.md:2288` — "honesty routing"; `harness/src/tui/commands.ts`'s
  `CLIENT_SIDE_NOTES` deliberately omits it) matches canon exactly. **Spec-only** for the descriptor.
  One small item: canon's alias is `checkup`, which we don't route.
- **Our Settings shell's four tabs `Status · Config · Usage · Stats` are canon's, in canon's order**
  (`harness/src/tui/SettingsDialog.tsx:73` vs `2.1.257/cli.pretty.js:356042-356070`), and the shell title
  is `Settings` not `Status` in both. **Verified.**
- **`ccx doctor`'s header shape and closing line follow canon's** — `Claude Code doctor` / blank /
  `Running: …` … / `No installation issues found.` (`2.1.257/cli.pretty.js:649319`, `:649366`), which is
  what `harness/src/cli/help.ts:244-255` transcribes. **Verified.**
- **`--version`'s form `<version> (<product>)`** matches canon's `${VERSION} (Claude Code)`
  (`harness/src/cli/help.ts:17`). **Spec-only** for the entry-stub cite.

---

## 6. Spec defects

- **§49.21 says the shell "carries four tabs"** and that is right, but the shell's own guard expressions
  reference a fifth, `Ps === "Gates"` / `fp !== "Gates"` (`2.1.257/cli.pretty.js:356035`, `:356073`), and
  the tab array splices in an always-empty `vS = []` (`:356060`). `grep 'title: "Gates"'` returns nothing
  in 2.1.257, so the reference is dead — but the spec doesn't mention it and a replicator reading only
  the guards would build a phantom tab. Minor; worth a footnote.
- **§10.24.3 ("The `#` shortcut") is under-evidenced, not wrong.** It asserts the negative and defers to
  Open question 1. The orphaned-renderer argument in §5 above closes it; the spec should carry it.
- No spec-vs-bundle contradiction found in lane A or B. Every §49.21 and §49.22.1 line number I spot-
  checked resolved to the claimed content.

---

## 7. Lanes C / D / E — delegated

Run by a parallel worker under the same method and citation rules; findings folded in verbatim below,
re-labelled `X…` so the IDs don't collide with §§1-6. Bundle-verified claims were checked by that worker,
not by me.

### 7.1 Corrections (lane C/D/E)

**XC1 — "Always allow" on a sandbox/worktree ask grants the wrong thing (two coupled bugs). This is the
single most actionable finding in the whole cross-check.**
`harness/src/permissions/gate.ts:132` keys the per-session allowlist on **tool name**
(`allowed.add(toolName)`), and `harness/src/tui/dialogs/smallDialogOptions.ts:263-267` (`genericDecision`)
writes a **content-less whole-tool rule**, ignoring the `suggestions` the gate already forwards
(`gate.ts:85`). For an ordinary tool that is canon-faithful (canon's `gtm`, `cli.pretty.js:506109`, does
the same). For the two asks in this lane it is wrong:

- **`SandboxNetworkAccess`** — canon's persist row is
  `{ toolName: "WebFetch", ruleContent: "domain:<consentHostEntry(host)>" }`, scoped to **one host**, plus
  `SandboxManager.addSessionAllowedHost(host)` (`2.1.257/cli.pretty.js:851553-851567` for the SDK path,
  `:419199` for the local dialog). Ours would allow **every** host for the rest of the session, and would
  write a `SandboxNetworkAccess` allow-rule into `settings.local.json` that no engine path reads — so
  "don't ask again" also silently doesn't persist.
- **`EnterWorktree`** — canon's ask is per-path (`checkPermissions` allows managed `.claude/worktrees/`
  paths outright and asks only for others; `cli.pretty.js:113215-113222`). Ours grants the tool for any
  path after one approval.

Verified; identical in 220/251/257. Narrow fix: honour `options.suggestions` on the
yes-don't-ask-again arm for asks that supply one, and don't add to `allowed` when a suggestion was
present.

**XC2 — the scorecard's stated reason for the `Bash command (unsandboxed)` 🚫 is wrong, and canon grew a
third title arm.** `docs/parity/tui-ux.md:1676` marks the variant unreachable because "this harness never
sandboxes" — but `harness/src/config/sandbox.ts` passes `SandboxSettings` straight through and
`harness/src/config/resolveOptions.ts:67` wires it into the SDK, so a ccx session **can** be sandboxed.
Canon 2.1.257 has three titles (`cli.pretty.js:421425`):
`` `Bash command (runs on ${host})` `` | `Bash command (unsandboxed)` | `Bash command`.
2.1.220 (`:505286`) has only the last two, so the remote-host arm is **220→257 drift**. Ours hardcodes
`"Bash command"` (`harness/src/tui/dialogs/BashPermission.tsx:147`). Verified. Reachability flag: whether
the SDK tells the client "is this call sandboxed" is unresolved — `decisionReason` crosses as a bare
string, and a `sandboxOverride` reason (XU4) is the one signal that does get through.

**XC3 — `ExitWorktree` result row drops a line canon always paints.**
`harness/src/tui/toolSummaries.ts:327-329` omits the dim `Returned to <cwd>` row when `originalCwd` is
absent; canon renders it unconditionally (`cli.pretty.js:764567`, identical at 220 `:421966`). Cosmetic —
log as debt.

### 7.2 Unknown unknowns (lane C/D/E)

**XU1 — the sandbox network-access dialog: reachable, verified, entirely unbuilt, and no row anywhere in
`tui-ux.md`.** Under the SDK control protocol this arrives as an ordinary `can_use_tool` request —
`tool_name: "SandboxNetworkAccess"`, `input: {host}`, `description: "Allow network connection to <host>?"`,
`permission_suggestions: [the WebFetch domain rule]` (`2.1.257/cli.pretty.js:851555`), which maps onto
`CanUseTool`'s `description`/`suggestions` — so today it lands in our `routeDecisionKind` → `"permission"`
→ GenericPermission, titled `Tool use` with a `SandboxNetworkAccess(...)` body. Canon's dialog
(`:419104-419253`, spec §17 lines 4745-4806) is titled **`Network request outside of sandbox`**, body
`Host: <host>` (dim label) then a blank row then `Do you want to allow this connection?`, three options.
It is one of only three dialog kinds allowed to open **on top of** another dialog (`mRo`, `:428476`), and
it publishes a status-line slot `allow network: <host>` / `sandbox-queued`. Fires only when
`config.sandbox` is set. Title unchanged in 220/251/257 (257 `:419251`, 251 `:163521`, 220 `:544677`);
220 lacks the `requestSource` prop and used the raw host in the persist label.

**XU2 — `/sandbox`: a whole missing surface with no row in `tui-ux.md` and no entry in
`command-coverage.md`** (its line 74 lists `sandbox-toggle`, a different flagged command). A
live-recomputed description with ten states, an `install`/`exclude` subcommand pair, and a tabbed panel
(`Mode` / `Dependencies` / `Overrides` / `Config`) whose **tab count varies 1/3/4** with the dependency
probe. Spec §17 lines 5005-5356; anchors `cli.pretty.js:144939-144950` (description getter), `:628697`
(mode labels), `:628625` (overrides header), `:628416-628424` (config sections), `:628775` (unix-socket
banner). Unchanged across 220/251/257. Reachability: the settings half is ours to write; the status half
(enabled source, policy lock, dependency probe, strict mode) needs data the SDK doesn't surface — but the
bundled binary ships a hidden `claude sandbox status` printing the whole posture as one JSON line
(`statusVersion: 2`; spec §17 lines 5308-5356, `cli.pretty.js:504504` / `:818084`). **Worth one probe.**

**XU3 — the worktree session-exit dialog.** `EnterWorktree`'s own tool prompt promises "On session exit,
if still in the worktree, the user will be prompted to keep or remove it". Canon renders
`Exiting worktree session` with six subtitles, keep/remove options (three when tmux is attached), three
transitional spinners and nine outcome sentences (spec §47 lines 5472-5642,
`cli.pretty.js:429328-429492`). ccx has nothing: `harness/src/cli/worktree.ts` and
`harness/src/cli/lifecycle.ts` are fleet-level (`ccx rm`), and the REPL has no equivalent.
Reachable-with-work — the `EnterWorktree` result sidecar already gives us `worktreePath`/`worktreeBranch`
(we read it at `harness/src/tui/toolSummaries.ts:320-323`) and the dirty check is two plain `git` calls.
Note **Esc is not "keep"** in canon — it cancels the exit and resumes the session (`:429468-429473`).

**XU4 — the `sandboxOverride` ask.** When the model sets `dangerouslyDisableSandbox: true`, canon converts
an allow into an ask whose message is exactly `Run outside of the sandbox` (`cli.pretty.js:75321`; spec
§17 lines 4639-4665), with `decisionReason: {type:"sandboxOverride"}`. On our wire the message arrives as
`description` and the reason as a bare string, so our Bash dialog would show it — but nothing in ccx
recognises `sandboxOverride` as the one reason meaning "this is about to leave the sandbox". Small, but
it is the only user-visible signal of a sandbox escape.

### 7.3 Known gaps now specified (lane C/D/E)

**XG1 — `DiffDialog` (`docs/parity/tui-ux.md:2269` ❌, `:2298` `/diff` 🟡): fully specified now.** Tab strip
`Current` + one `T<n>` per turn, **hidden** when there is only one source. Frame title is state-derived —
`Turn <n>` / `Staged and new files` / `Branch changes` / `Uncommitted changes` — plus a dim space and a
user-prompt preview. Header `<N> file(s) changed +A -R`. File row: pointer or two spaces, truncated path,
flex spacer, right-hand cell = italic `untracked` | `Binary file` | `Large file modified` | `+A -R`, with
a trailing ` (truncated)`. Empty-state ladder in this exact order (`cli.pretty.js:573337-573351`):
`No file changes in this turn` → the source's own message → `Too many files to display details` →
`No changes yet`; a still-loading list shows `Loading diff…`. **Two footers** (`:573383`): list mode
`←/→ switch source` (only when >1 source) · `↑/↓ select` · `enter view` · `Esc close`; detail mode
`↑/↓ scroll` · `Esc back`. Esc in detail returns to list; Esc in list emits `Diff dialog dismissed`.
Keymap context `DiffDialog` binds `diff:dismiss/previousSource/nextSource/back/viewDetails/previousFile/
nextFile` plus the six `scroll:*` actions (`:573330`). Ours is `git status --short; git diff --stat`
through the `!`-runner at `harness/src/tui/useChat.ts:2401`.

**XG2 — `/diff`'s second rendering is 251-era and gated off by default.** `diffSidebarBaseMode` and
`Toggle the diff panel showing uncommitted changes` are **absent from 2.1.220** and present in 251/257;
220's `/diff` is the static `View uncommitted changes and per-turn diffs` with only the modal. Genuine
220→251 drift, but the sidebar sits behind `tengu_willow_crate`, **default false**
(`cli.pretty.js:143668`), plus `columns >= 110`, fullscreen, main-focused, not-thin-client, in-a-git-repo.
Build the **modal** (XG1); record the sidebar as gated-off canon, not a gap. Its guard strings are still
worth taking as our `/diff` empty states.

**XG3 — `/branch` is not a git command.** `docs/parity/command-coverage.md:65` files it as open "for later
waves", implicitly under git. Spec §47 lines 7189-7212 + `cli.pretty.js:144920`:
`description: "Create a branch of the current conversation at this point"`, `argumentHint: "[name]"`,
`type: "local-jsx"`. Its module spawns **no subprocess and never mentions worktrees** — it copies the
transcript into a new session id and hot-swaps the live UI onto the copy. Verbatim in 220 (`:352515`).
That reclassifies it as a **session-fork** feature on the same axis `docs/parity/tui-ux.md:1688` records
as missing from our session store ("no parent-session field"). Re-file before anyone scopes it as git
work.

### 7.4 Verbatim assets (lane C/D/E)

- **Sandbox panel** — footer `←/→ to switch · ↑/↓ to navigate · Enter to select · Esc to close`; ten
  description states (spec §17:5040-5051); mode labels/confirmations (§17:5163-5185); overrides labels +
  two explanation paragraphs (§17:5215-5245); Config-tab section labels (§17:5265-5290); dependency rows
  + remediation lines (§17:5292-5307).
- **Sandbox network dialog** (§17:4756-4775) — `Network request outside of sandbox`; `Host:` (dim) +
  host; `Do you want to allow this connection?`; options `Yes` / `Yes, and don't ask again for <display>`
  (host bolded) / `No, and tell Claude what to do differently (esc)` (`(esc)` bolded).
- **`DiffDialog`** — spec §15:4341-4358 plus the two strings that list omits,
  `Too many files to display details` (`cli.pretty.js:573347`) and `No changed files` (`:573062`), plus
  both footers (`:573383`).
- **Diff guard / no-git string** (§15:4318-4328) —
  `The diff panel shows git changes — the current directory isn't in a git repository`
  (`DIFF_SIDEBAR_NO_GIT_MESSAGE`, U+2014 and U+2019, `cli.pretty.js:772499`). Our `/diff` has no empty
  state at all. Constants `DIFF_SIDEBAR_MIN_COLS = 110`, `DIFF_SIDEBAR_AUTO_OPEN_MIN_COLS = 144`.
- **`/branch` success message** (§47:7208-7212) — `Branched conversation${T}. You are now in the new
  branch (session ${r}). Use /resume ${n}${E} to return to the original, or run ``claude -r ${n}`` in a
  new terminal.`
- **Worktree exit dialog** (§47:5528-5620) — six subtitles, option/description tables, three spinners,
  nine outcome sentences.

### 7.5 Confirmations (lane C/D/E)

- `worktreeRows` (`harness/src/tui/toolSummaries.ts:317-329`) matches canon's `Z_`/`eP`
  (`cli.pretty.js:764563` / `:764566-764567`) string-for-string, including the bolded branch and the
  `(branch X)` spacing; canon is byte-identical at 220 (`:421957` / `:421966`). Only XC3 differs.
- Canon's `/sandbox` description strings, panel structure, overrides tab and network-dialog title are
  unchanged across 220/251/257.
- `/branch` is unchanged 220→257.
- `harness/src/permissions/gate.ts` correctly forwards `description`, `title`, `displayName`,
  `decisionReason`, `blockedPath`, `suggestions` — canon's ask *copy* for `EnterWorktree` and
  `SandboxNetworkAccess` already reaches our dialogs as `description`. It is the routing and the persist
  arm that are wrong, not the plumbing (`cli.pretty.js:427753`).
- **Lane E verdict:** exactly one of the two worktree tools reaches a user dialog —
  `EnterWorktree.checkPermissions` asks (per-path, `localDisplayOnly`, `cli.pretty.js:113215-113222`) when
  the model supplies a path outside `.claude/worktrees/`. `ExitWorktree` has no `checkPermissions` at all;
  its five refusals are `validateInput` errors that go to the model, never the screen.

### 7.6 Spec defects (lane C/D/E)

- `15-file-tools.md:4341-4358` presents its `DiffDialog` string list as complete; it omits
  `Too many files to display details` (`cli.pretty.js:573347`) and `No changed files` (`:573062`), and
  gives no footer text at all. A reimplementer working from that list ships the wrong empty-state ladder.
- `17-sandbox.md` never covers the `Bash command (unsandboxed)` permission-dialog title — an omission,
  not a contradiction, but it is the most visible sandbox string in the permission surface, and 257
  quietly added a third arm (`Bash command (runs on <host>)`, `cli.pretty.js:421425`) that no chapter in
  that lane records.
- Minor: `17-sandbox.md:5296` writes the dependency-row label as `` `seccomp filter: ` `` (trailing space
  inside the literal); the bundle splits it into `"seccomp filter:"` and a separate `" "` child.
