# Spec defects found by the TUI-to-GUI study

Date: 2026-09-10. Canon: Claude Code 2.1.263.

Everything the seven card lanes found wrong or missing in their sources, collected for feedback to
the three owners: the spec library at `~/claude-code-bundle/2.1.263/SPEC/`, afleet's protocol
inventory at `docs/tui-parity/`, and afleet's own specs and code. Each entry carries its citation;
the card that hit it is named where the lane gave one. The text is the lanes' own, grouped by lane
and unedited, so a reader can go from an entry to the card and from the card to the evidence.

Three defects are live bugs in shipped afleet code rather than documentation gaps and are listed
first because they change behaviour today:

1. `ManagedSettingsReader.isPending` hashes the raw settings file and looks for a top-level
   `approvedHash`; canon hashes four extracted fields under `records[<orgUuid>].dangerousSettingsHash`
   (SPEC 03 §15.8, 48 §2.9.4). A managed deployment reads "pending" forever and never spawns. (Lane D.)
2. `PermissionCardView.unstatedDenial` sends the first sentence of canon's three-sentence rejection
   constant; the dropped sentences tell the model the edit was not written and to stop. (Lane D.)
3. `DialogDeadline.standard` passes `dialogExpiry: nil`, so every dialog card claims five minutes
   regardless of the session's setting. (Lane D.)

Two more are visible to a user today and are fidelity defects rather than crashes: a slash command
or skill invocation renders as literal XML in a user bubble (Lane B, B-61), and an interrupted tool
renders as a red error (Lane B, B-44). The lanes' full lists follow.


## Lane A — `surfaces/A-chrome-and-status.md`

- **SPEC 41.15.5 says `kind` is "write-only — no consumer reads it"** while also enumerating six
  values (`feedback | contextual | warning | event | hint | upsell`). If that is right, the field is
  dead weight in the interface and the enumeration is misleading to a re-implementer; if some
  consumer exists, the claim is wrong. Worth one grep in a future pass. Not load-bearing for this
  lane — A-27 and A-28 drop the field either way.

- **SPEC 41.19.3 documents `prompt_cache` as having 14 fields** while `docs/tui-parity/areas/41-tui-rendering.md`
  (the "payload — real producer" row) says 12. The SPEC's own `interface` block lists fourteen keys.
  The inventory's count is stale; harmless, but it will confuse anyone reconciling the two.

- **tui-parity carries no row for SPEC 41.18a (the turn-narration sub-line)** as far as this lane
  read, so A-24's wire class is my reading rather than the inventory's. Given the mechanism — a
  second model request made inside the CLI — D is nearly certain, but the inventory should say so.

- **tui-parity carries no row for `/color` (SPEC 41.9.5)**, so A-41's class is likewise unverified.
  It is a `local-jsx` command and therefore presumably covered by README §7 finding 5's blanket
  statement, but the palette it draws from is the same one the Agents panel needs, which makes it
  more interesting than a generic panel row.

- **afleet root spec §7.6 designs two banners that the built `ChannelBanner` cannot express.** The
  section says a `rate_limit_event` "renders a banner at the top of the channel with the limit that
  applies and its reset time" and that an `auth_status` problem "renders a banner with the state and
  a *Sign in* action"; `FleetKit/Sources/FleetSessions/Types/ChannelState.swift:105-114` has seven
  cases and neither of these. Both facts currently surface only as Activity rows
  (`App/Activity/ActivityModel.swift:51-53`). Either the enum is incomplete or §7.6 is describing
  the Activity view; the spec should say which.

- **afleet root spec §8.2's channel-title precedence is missing two of canon's rungs.** It gives
  "title (custom, else AI title, else first prompt)" where SPEC 41.21.2 has custom > AI title >
  agent title > haiku title > default. `agentTitle` and `haikuTitle` both reach the host, and "first
  prompt" is afleet's own invention with no canon referent. A-34 proposes the correction.

- **No afleet spec mentions reduced motion or an announcement rate for streaming text.** Verified
  absent from `App/`, `FleetKit/` and `Workbench/`. Both are cheap to specify now and expensive to
  retrofit; A-19 and A-43 give the content.


## Lane B — `surfaces/B-transcript-rendering.md`

1. **SPEC 41.16 documents no renderer for `ReportFindings`.** §41.16.5 lists it in the eager table;
   §41.16.7 gives it no form. The renderer is real, structured and width-adaptive
   (`cli.pretty.js:834705-834745`) — grouping by file, a severity column, a line column and a
   layout switch. Card B-35 documents it.

2. **SPEC 41.16 documents no renderer for the tool-call cluster, which is the most-seen row in the
   transcript.** The four synthetic row types — `grouped_tool_use`, `collapsed_read_search`,
   `work_segment`, `speaker_label` — appear *only* in §41.16.12's `isStatic` table
   (`41-tui-rendering.md:4910-4915`) and nowhere else in the chapter. The
   `collapsed_read_search` renderer at `cli.pretty.js:838361`+ produces a categorised, tense-switching
   sentence over fourteen counter families, plus a hook sub-line and an elapsed timer; the collapse
   threshold is two trailing read/search calls (`cli.pretty.js:712104`); and the compact fallback
   sentence is built at `cli.pretty.js:712098`. Cards B-12 and B-13 document them.

3. **SPEC 41.16.7 omits the post-edit diagnostics row.**
   `Found N new diagnostic(s) in M file(s) (ctrl+o to expand)` is drawn under a file-edit result
   (`cli.pretty.js:835272`) and appears in no section. Card B-43.

4. **SPEC 41.16.7 lists `MultiEdit` nowhere, but the tool is still named in SPEC 14's roster
   context and in permission documentation**, which reads as though it renders. It does not: there
   is no registry row and no side-table entry in 2.1.263. Card B-20 records the absence so it is not
   re-derived.

5. **`Waiting for permission…` is a distinct transcript state given one subordinate clause.**
   SPEC 41.16.10 mentions it in passing; it replaces a result body wholesale and has its own copy
   (`cli.pretty.js:835189`). It deserves its own subsection. Card B-46.

6. **SPEC 41.17.5 / 41.7.5 disagree with the parity inventory on the hyperlink id hash.** SPEC
   41.7.5 states — correctly, with the source — that the link id is a **31-based** rolling hash
   (`h = (h << 5) - h + c`) rendered in base 36, and explicitly notes "*It is not djb2*".
   `docs/tui-parity/areas/41-tui-rendering.md` §41.7.5 records it as "*a djb2 id in base 36*". The
   SPEC is right; the inventory row should be corrected.

7. **tui-parity and the somersault scorecard disagree on whether the compact boundary carries a
   message count.** `docs/tui-parity/areas/13-10-23-context-memory-session-tools.md` lists
   `messages_summarized` on `compact_metadata` (observed at 2.1.259); the clone's P81 read the live
   `compact_boundary` frame key by key at 2.1.220 and found neither `summarizeMetadata` nor the
   count (`CC-to-SDK/docs/parity/tui-ux.md` §2 row 21). Most likely version skew, but B-66's
   proposed copy depends on it and it should be re-probed at afleet's target version.

8. **The afleet root spec names "the raw view" three times and never specifies it.**
   `2026-09-03-afleet-workspace-design.md:937` and `:1276`, and
   `2026-09-07-c6-conversation-surface.md:269`, all send hidden content there — `isSynthetic` user
   frames, `session_state_changed`, meta reminders — but no section defines what it is, where it
   lives or how it is opened. The nearest built thing, `App/Threads/ThreadView.swift:105-112`, has
   **no production caller** (`App/Threads/ThreadModel.swift:182`;
   `AppTests/TaskCardBackgroundingTests.swift:79` states it). Card B-07 proposes the surface.

9. **The afleet root spec's "three-layer density" is a decision with no definition.** The Decision
   Log entry is two lines (`2026-09-03-afleet-workspace-design.md:2910-2911`) and the phrase appears
   once more at `:100`; **the three layers are never enumerated anywhere in afleet's specs**. §8.3
   describes clusters and their expansion but names no layer model, and C6.1 does not either. This
   study infers prose / clusters / expanded from §8.3's mechanics (card B-10) — that inference should
   be written into the root spec rather than left to a reader.

10. **`docs/tui-parity/areas/41-tui-rendering.md` §41.16.7's `Bash` row understates the live-output
    verdict relative to the README.** The row says `tool_progress` frames "*are emitted only when
    `CLAUDE_CODE_REMOTE` or `CLAUDE_CODE_CONTAINER_ID` is set*", which reads as "gated". The
    `15-16-17` area file and probe 11 establish the stronger fact that the published `tool_progress`
    **schema carries no output field at all**, so even when emitted it cannot carry stdout. The
    §41.16.7 row should carry the stronger sentence, because a reader who stops at §41.16.7 will
    plan for a flag that would not help.


## Lane C — `surfaces/C-composer-and-input.md`

- **`tui-parity` §42.20.4 states the drain rule backwards.** Its row says the batch drains *"all
  consecutive same-mode plain prompts … stopping at a slash command"*. SPEC 42.20.4 says the scan
  covers the **whole** queue, is **not** consecutive, and a slash command **fails the predicate and
  is skipped over, leaving the scan running** — only `screeningPending`, `promptSubmitted` or
  `drainOnly` latch it closed. `[plain, slash, plain]` drains both plain entries. A host that
  builds to the parity row will render the wrong grouping (C-39).
- **`tui-parity` §42.4 says 23 contexts; SPEC 42.4 at 2.1.263 lists 26.** The area file was written
  against 2.1.257 and omits `AbovePrompt`, `AbovePromptInput` and `AbovePromptSelect` from its
  count. The task prompt inherits the 23. Anything that maps contexts to regions (C-59) needs the
  26.
- **Root spec §13 describes a feature that does not exist.** *"`history.jsonl` is read for seeding
  the composer history only"* implies a composer history; there is none — no reader, no store, no
  `↑`/`↓` handler in `App/Composer/`. The line should read that history is not implemented (C-32).
- **Root spec §7.8 and `tui-parity` gaps 1 and 8 are in direct conflict, and neither cites the
  other.** The parity inventory tells the host to ship a keybindings editor and to write
  `history.jsonl`; §7.8 forbids every write under `<configHome>`. Both documents are internally
  consistent and jointly unimplementable (C-33, C-61).
- **SPEC 42.15.6 records an asymmetry that is a bug, not a rule.** An unavailable `[Pasted text #N]`
  is removed and reported; an unavailable `[Image #N]` is left in both the display and expanded
  forms and **never reported**, so a dangling `[Image #3]` string reaches the model. Noted in
  C-13; the chapter states the behaviour without flagging it.
- **SPEC 42.24.2's `/keybindings` success strings can lie.** The launcher returns
  `{content: null}` with no `error` when no editor resolves, and the command tests only `o.error`,
  so a user with no `$EDITOR`, `$VISUAL` or recognised GUI editor is told
  `Opened … in your editor.` The chapter documents this correctly; it is listed here because any
  host that copies the outcome strings inherits the lie (C-61).
- **`tui-parity`'s own Unverified list still contains the one thing `@` depends on**:
  *"`@`-mention expansion for headless `user` frames … I did not trace the headless call site
  end-to-end."* Every card that sends a literal `@path` (C-19, C-26) rests on it.


## Lane D — `surfaces/D-decision-dialogs.md`

**SPEC 263.**

- **24.14.2 has a corrupted kind name.** The table lists `permissionJXbfetch`; the build declares
  `permission_webfetch` at the very site the table cites (`cli.pretty.js:370569`).
- **41.22.1's heading does not match its content.** It is titled "The lazy dialog registry" but
  documents `qme`, the 74-entry registry of *slash commands that mount JSX*. The dialog-**kind**
  registry is `fk`, and it appears a section later under §41.22.6. A reader navigating by section
  number for "the dialog kinds" lands on the wrong object.
- **41.22.6 counts `fk` at 41 runtime entries and enumerates only the six that carry a `layout`.**
  The other thirty-five appear nowhere in SPEC 41. D-09 resolves all forty-one from the build.
- **There is no dialog-kind index anywhere in the library, and five kinds are absent entirely.**
  A `grep -rl` over the whole SPEC directory returns nothing for `computer_use_approval`,
  `cloud_sync_offline`, `cloud_sync_consent`, `peer_inbound_approval` or `auto_mode_setup_review`,
  all present in the binary (`cli.pretty.js:33155`, `:167266`, `:222630`, `:497037`, `:518604`).
- **24.17.4 reasons about the wrong version.** Inside the 2.1.263 library it concludes that a check
  "does not correspond to any live check in 2.1.257", leaving the bypass containment check's 2.1.263
  status unstated.
- **21 §7.5 says an empty keep-planning submission is a no-op.** Implementation contact found an
  empty Enter routes through `onCancel` and denies exactly like Esc
  (`CC-to-SDK/docs/parity/tui-ux.md`, plan-mode approval row).
- **22 and 37 name call sites whose copy is quoted nowhere:** `goal_proposal`'s descriptor is
  verified (`cli.pretty.js:161590`) but its title and options are not in SPEC 22, and
  `cloud_sync_consent`'s rendered text is in neither SPEC 37 §37.6 nor the binary excerpt the
  chapter quotes.

**tui-parity.**

- **Finding 19 undercounts and under-lists.** It says "the 9 `permission_*` kinds"; SPEC 24.14.2
  declares twelve and `fk` carries eleven plus `permission_workflow` via a spread. Its "every other
  kind" enumeration omits eight registered kinds: `left_arrow_confirm`, `cost_threshold`,
  `resume_return`, `it2_setup`, `fullscreen_upsell`, `auto_default_nudge`, `effort_medium_nudge`,
  `ultraplan_choice`.
- **Finding 19 and §5 disagree about the Slack-connect kinds.** Finding 19 names them as forwarded;
  §5's `initialize` recommendation lists only `refusal_fallback_prompt` and
  `fable_overage_consent_prompt`, and no area row covers the Slack kinds. One of the two is
  incomplete.
- **The §21/12 table has no row for extended questions** (SPEC 21 §12.13 — `kind`, `placeholder`,
  `min`/`max`/`step`, `defaultValue`, `unit`), even though the gate turns on for exactly afleet's
  class of host (`sdk-*`, `local-agent`, `remote`). The inventory is silent where it matters most.

**afleet specs and code.**

- **`ManagedSettingsReader.isPending` can never match** — a real bug, not a spec gap
  (`FleetKit/Sources/FleetSessions/Preconditions/ManagedSettingsReader.swift`). It SHA-256s the raw
  bytes of `remote-settings.json` and looks for a top-level `approvedHash`; canon hashes a canonical
  string of four *extracted* fields stored at `records[<orgUuid>].dangerousSettingsHash`
  (SPEC 03 §15.8, SPEC 48 §2.9.4). Any managed deployment reads "pending" forever and the channel
  never spawns, even after approval. It also skips canon's `j5()` predicate, so a payload with
  nothing dangerous in it also blocks. The file calls the record shape an unrecorded unknown;
  SPEC 48 §2.9.4 records it fully.
- **`DialogDeadline.standard` passes `dialogExpiry: nil`** (`App/Decisions/DialogCardView.swift:44`),
  so every dialog card states five minutes regardless of the session's setting. The value is on
  `get_settings.effective`, which §8.6 already polls.
- **`PermissionCardView.unstatedDenial` sends one sentence of a three-sentence constant** (D-24),
  dropping the instruction that tells a denied model to stop.
- **C6.3 §D6 mandates `interrupt: false` for every denial.** A bare plan rejection must interrupt to
  match the terminal's turn-ending behaviour; `App/Decisions/DecisionAnswerMapping.swift` follows the
  rule as written.
- **Root spec §8.4's dialog table says the refusal card renders "the guidance text and refusal
  category"**, omitting the composed safeguards notice and support link that are canon's actual body
  (SPEC 06 §20.3). The built card follows the spec, so the defect propagated into shipped copy.
- **Root spec §8.4 is silent on card expiry** (D-02), although `FleetQuitTermination.isBusy` already
  treats a `.waiting` card as busy — the one place afleet does model a pending card's liveness.

**This lane's task prompt.** Three of its givens are not canon at 2.1.263 and are corrected in
place: `ctrl+e explain` (D-22), the option label "no, tell Claude what to do differently" (D-24),
and the workspace-trust question `Do you trust the files in this folder` — the real copy is
`Quick safety check: Is this a project you created or one you trust? …` under the title
`Accessing workspace:` with buttons `Yes, I trust this folder` / `No, exit`
(`cli.pretty.js:584071`, `:584074`, `:584090`), and the `.mcp.json` row is `Use this MCP server`
(`:290079`). D-42 and D-44 carry the corrections.

**Verification gaps, flagged rather than asserted.** The `Other` row's placeholder `Type something.`
is stated as a literal in both SPEC 21 §12.7 and the tui-parity area file but was not resolved in
the build (the label `Other` is verified at `cli.pretty.js:517646`). `left_arrow_confirm`'s opening
chord is documented nowhere — SPEC 42 records only its telemetry — so D-62's reading of it as the
left-arrow / send-to-background gesture is `unverified`.


## Lane E — `surfaces/E-panel-commands-settings.md`

**In SPEC 263.**

1. **SPEC 31 §18.2 does not document the `/mcp` server list's row rendering.** The thirteen status
   branches, their glyphs and tones were recovered from `cli.pretty.js:483960-484065`. The list's
   status set differs from the detail view's documented set by two branches
   (`connected · <n> tool(s)` and `reconnecting (<n>/<m>)…`), which a reader of §18.3 alone would
   not know.
2. **SPEC 31 §18 documents nothing about the `View tools` sub-view** or the tool-detail level
   beneath it. The only description of that view stack found anywhere is the somersault clone's
   (`CC-to-SDK/docs/parity/tui-ux.md:1072-1074`).
3. **SPEC 24 §24.19 omits five behaviours of the permissions dialog** that a rebuild depends on: the
   `Rule details` panel title, the `From <source>` provenance line, the `Delete <label> tool?`
   confirmation copy, the `/`-and-any-printable-key filter gesture, and the fact that the Workspace
   tab's add is **always session-scoped**. All five verified in `cli.pretty.js`.
4. **SPEC 24 §24.12.3 says `/add-dir` applies `destination: "session"`.** The interactive dialog
   writes `destination: <persist> ? "localSettings" : "session"` (`cli.pretty.js:13006`). The SPEC
   statement describes the headless arm only and reads as general.
5. **SPEC 41.26.2's `Gn` caption map has no arm for `callback` or `function` hook types**, which
   would render an empty caption — unreachable in practice, but undocumented as such. (SPEC 27
   §21.3's map, same finding.)
6. **SPEC 06 does not record the `/model` picker's chrome at all** — no `Select model` header, no
   subtitle, no overflow counter, in any of the 51 chapters. Likewise SPEC 41.10.5 covers the
   `/theme` command object but not the picker, and SPEC 06 records no `/effort` header (none exists
   in the binary either). All recovered here from `cli.pretty.js`.
7. **`/desktop` has no SPEC section.** Its chunk (`chunk-ahmkq2k0.js`) is never decompiled in any
   chapter, and SPEC 41 — the chapter its catalogue row points to — does not list it as an open
   question. Its dialog, copy and writes are unknown, which is why E-52's reading is marked
   unverified.
8. **SPEC 27 Open Question 7 is unresolved and load-bearing for a rebuild**:
   `matcherMetadata.fieldToMatch` and `values` are declared for 22 events but read nowhere; the UI
   tests only the *presence* of `matcherMetadata`.

**In afleet's `docs/tui-parity/`.**

9. **`areas/41-tui-rendering.md:592` claims the live headless `/config` accepts 38 keys and then
   enumerates 37.** The enumeration is what a build must code against. Same row: its "60-row
   registry" list contains **59 names** — `unattendedServing` is missing, though SPEC 41.26.2's
   table has it. Both are small and both would silently mis-size a settings pane.
10. **Four rows assert that `update_settings` can write keys other than `outputStyle`**, which
    README finding 7 and a live probe both refute (`update_settings keys not allowed: permissions`,
    `evidence/2026-09-03-control-request-shapes.md:32`):
    `areas/24-21-permissions-plan-questions.md` (permission rules, several rows),
    `areas/31-27-mcp-hooks.md:30` (`enabledMcpjsonServers`), `areas/41-tui-rendering.md:81`
    (`theme`), `areas/13-10-23-context-memory-session-tools.md:119,121` (`autoMemoryEnabled`,
    `claudeMdExcludes`). The permissions and MCP rows carry errata blocks for *other* claims but not
    for this one. **README finding 7 is authoritative**; a design that follows the area files will
    ship writes that fail.
11. **`areas/28-slash-commands.md:135` still says fast mode is unavailable** and advises hiding the
    control; README finding 13 and the errata at `areas/41-tui-rendering.md:5` say it is opt-in and
    works after `apply_flag_settings {fastMode: true}`. A reader of the area file alone ships no
    `/fast` control at all.
12. **Three area files still grade `/add-dir` as R or P** (`areas/28-slash-commands.md:94`,
    `areas/24-21-…:94`, `areas/03-49-35-…:66`) against README finding 6's X. Each is superseded by
    its own errata header, but the row text was never corrected.
13. **"The eight `mcp_*` control requests" names three different sets** — README's eight (including
    `set_mcp_permission_mode_override`, excluding `mcp_call`), the area file's ten, and afleet's
    implemented eight (including `mcp_call`, excluding the override). Any card or plan citing "the
    eight" should name them.
14. **`areas/31-27-mcp-hooks.md:26` says "five config scopes" and lists four** — `managed` is
    missing; SPEC 31 §3.1 has five.
15. **Class disagreement on the MCP auth-stub tools**: README §5 marks their suppression **R**, the
    area file marks the same item **X** (lines 161, 384).
16. **The parity corpus is written against 2.1.257/2.1.259, not 2.1.263.** Two deltas already
    visible in this lane: `/rate-limit-options` lost its `Upgrade to Team plan` entry and its URL,
    and the `allow_desktop_handoff` policy key was removed.

**In the afleet specs.**

17. **Root spec §7.7's router table has no row for `/hooks`, `/plugin`, `/reload-plugins`,
    `/cloud-plugins`, `/skills`, `/reload-skills`, `/skill-doctor`, `/theme`, `/output-style`,
    `/sandbox`, `/advisor`, `/autocompact`, `/passes`, `/powerup` or any of the nineteen auth and
    environment commands other than `/login` and `/logout`** — verified by whole-file grep. They are
    not listed as known gaps in §13 either, nor deferred in §17.8. They fall to the generic
    pass-through fallback by omission rather than by decision.
18. **§7.7 describes one engine refusal string; there are three.** afleet's
    `RouterTable.bareRefusalPattern` and `interactivePanelRefusalPattern` match two of them
    (`cli.pretty.js:540254`, `:540305`). The third, gate-1 form
    `/<name> isn't available in this session.` (`:540312`) matches neither and would reach the
    channel unintercepted.
19. **`RouterTable.terminalOnlyReasons`'s `/reload-plugins` entry contradicts afleet's own shipped
    feature** — it says afleet picks up plugin changes at the next restart, while
    `ChannelHeaderActionsModel.reloadPlugins()` sends a live `reload_plugins`.
20. **Root spec §7.8's X9 and `areas/30-29-32-plugins-skills-styles.md:190` conflict** over
    `/cloud-plugins`: the parity file proposes writing
    `<configHome>/state/cloud-plugins-consent.json`, which X9 forbids. Resolved here in favour of
    X9 (E-27), since §17.8 also puts cloud sessions out of scope, but the conflict is unrecorded in
    both documents.
21. **Process defect, not a spec one:** the first run of this study wrote a copy of the whole
    `tui-to-gui/surfaces/` directory into the afleet repository at
    `/Users/new/developer/github/afleet/docs/tui-to-gui/`, which SHARED-BRIEF §0 forbids ("never
    write under it"). It is untracked (`?? docs/tui-to-gui/` in `git status`) and is a stale copy of
    the 321-line fragment. Nothing in this run wrote there; the orchestrator should delete it.


## Lane F — `surfaces/F-panel-commands-session.md`

1. **SPEC 263 has no section for the `/help` dialog.** Chapter 41 covers dialogs as a widget system
   (§41.22) and the transcript pager's help panel, but nothing specifies `/help`'s three tabs, its
   command-browser filters, its 44-row suppression rules or its three footers. F-13 is built
   entirely from `cli.pretty.js:219360-219500`. This is a real hole: `/help` is one of the most
   frequently invoked commands in the product.

2. **SPEC 263 has no section for the `Usage` and `Stats` tabs.** SPEC 49.21 specifies `/status` and
   the shell's four tabs by name; SPEC 8 §13 specifies the `/api/oauth/usage` endpoint and its
   degraded-mode seeding; SPEC 5 §13.2 specifies `stats-cache.json`. Nothing specifies what either
   tab *draws*. F-02 and F-03 are built from `cli.pretty.js:392822-394950`. Note also that
   `30-plugins-and-marketplaces.md` §27.9 is titled "Stats tab" and is a **different** surface (the
   plugin dialog's), which makes the gap easy to miss by grep.

3. **`/cost` and `/stats` are not documented as aliases where a reader would look.** They appear
   only in the `28-slash-commands.md` §5 catalogue row for `/usage`. Chapters 13, 8 and 49 discuss
   cost and usage without noting that the three command names open one dialog on three tabs
   (verified at `cli.pretty.js:840964`). A reader searching for `/cost` finds nothing.

4. **tui-parity contradicts itself on the rewind refusal count.**
   `areas/42-input-keybindings.md:372` lists **eight** `rewind_conversation` refusal strings and its
   top-gaps entry repeats "eight distinct refusal strings to render";
   `areas/03-49-35-settings-diagnostics-sessions.md` §35.7 lists **ten**, adding
   `failed to persist rewind anchor` and `state changed`. F-31 carries all ten and flags the
   disagreement. One of the two rows is stale.

5. **tui-parity contradicts itself on whether summarize-from-here is initiable.**
   `areas/42-input-keybindings.md:373` gives the mechanism as "a user frame with
   `summarize_metadata {messages_summarized, user_context?, direction: "from"|"up_to"}`";
   `areas/13-10-23-context-memory-session-tools.md` §13.A says "there is no control request that
   invokes partial compaction … a GUI can render a partial compaction produced elsewhere but cannot
   initiate one." These cannot both be right, and the answer decides whether two of the six restore
   options in F-29 ship at all.

6. **afleet refuses `/doctor` on evidence its own repository contradicts.**
   `FleetKit/Sources/FleetSessions/Router/RouterTable.swift:95` carries a terminal-only reason for
   `/doctor`, while `docs/tui-parity/evidence/2026-09-03-slash-commands-headless.md:57` records that
   on 2.1.259 `/doctor` "was NOT refused: it was echoed as a prompt-type command and the MODEL
   answered it", and README finding 17 says the same. The router blocks a command that works. Filed
   as F-37.

7. **The root design spec's §7.7 promises `/tasks` and `/resume` destinations that do not exist.**
   The router table rows read `| /tasks | the registry mirror, with per-task stop_task |` and
   `| /resume | focuses the sidebar switcher |`, and `RouterTable.swift` routes both to
   `.native(...)`; `App/Header/SettingPickers.swift:492` accepts only `modelPicker` and
   `effortPicker`. afleet's tech-debt item 207 records the gap, but §7.7 still reads as though the
   destinations are built.

8. **SPEC 13.18.2's markdown/panel row-ordering asymmetry is documented but not flagged as a
   defect.** With auto-compact disabled the buffer is named `Compact buffer`, which the markdown
   renderer's filter does not exclude, so it appears among the ordinary rows *before* `Free space`;
   with auto-compact enabled the `Autocompact buffer` is filtered out and appended *after* it. The
   spec describes both behaviours accurately and does not say which is intended. A reimplementer has
   to guess.


## Lane G — `surfaces/G-fleet-and-agents.md`

- **SPEC 20 and 41 do not state anywhere that a `<task-notification>` renders as a transcript row.**
  SPEC 20.10 specifies the model-facing envelope in full and stops; SPEC 41.16 has no entry for it.
  The renderer is at `cli.pretty.js:836280-836356` with its dispatch at `:837000-837008`, and the
  behaviour — one row carrying `<summary>`, coloured by status, with a duration suffix, and **nothing
  at all when there is no summary** — is the single most load-bearing rendering fact in this lane.
  It should be a section of SPEC 41.16.7.

- **The task prompt's `⚙ N bg` indicator does not exist at 2.1.263.** `⚙` occurs nowhere in the
  binary; the only two `⚙` escapes are inside an emoji-matching regex and an emoji-alias table.
  The glyph is `↳` and the counter form appears only at two or more tasks. The description appears to
  come from the somersault clone's own row (`tui-ux.md` L2382), which was built against 2.1.220 —
  a version-drift item for `A5-cross-version-notes.md`.

- **`away_summary` is not a notification kind.** The task prompt lists it among SPEC 50's kinds; it
  is absent from the `War` domain and is a query source and `/config` row (`Session recap`) instead.

- **SPEC 20.13 defines no Monitor result row.** It specifies `renderToolUseMessage` (the bare
  description), `getActivityDescription` and `getToolUseSummary`, and no `renderToolResultMessage` —
  no completion row, no event counter, no status glyph. `[Monitor stopped]`
  (`cli.pretty.js:749768`) is a real string absent from 20.13.1–20.13.7.

- **SPEC 50 does not say how the terminal renders a `<channel source=…>` message to the user.** It
  specifies the model-facing envelope, preamble and trailer; the message is `isMeta: true` and SPEC
  41 has no channel-message row. Either the terminal renders nothing (in which case SPEC 50 should
  say so, because it is a surprising answer for a feature whose purpose is delivering messages) or a
  row exists and neither chapter has it.

- **`tengu_toggle_todos{is_expanded}` has inverted polarity relative to SPEC 20's prose** — the
  source reads the pre-flip value, so it is `true` when the panel is being *closed*.

- **SPEC 39.16.1 records that `mode_set_request` and `team_permission_update` are dropped frames, and
  no chapter notes the consequence**: a teammate changing permission mode produces no warning
  anywhere, while `/model` and `/fast` do (`cli.pretty.js:504963`). That asymmetry looks like an
  omission rather than a decision.

- **`bridge_state`'s value union is undocumented in the SPEC library.** `docs/tui-parity/areas/
  50-36-39-38-…md` §36 records `init | ready | connected | reconnecting | failed | policy_disabled`
  and flags it; SPEC 36 does not carry the union.

- **afleet's root spec §13 omits a protocol gap it should list**: `TaskOutput` stamps a task
  `notified`, so a task the model reads never emits a `task_notification` and completion detection
  must watch `task_updated` (`docs/tui-parity/README.md` §5 A-20). §13's stated purpose is "listed so
  nobody rediscovers them", and this one will be rediscovered.

- **afleet has a naming collision with canon.** `App/Timeline/Rendering/Rows/TaskRunRow.swift`'s
  `activeForm(of:)` maps a background task's status to a phrase and cites "parity §20.8"; canon's
  `activeForm` is SPEC 20.6, a field of the *persisted task list* whose only consumer is the spinner
  (`cli.pretty.js:369916`), and SPEC 20.6 says explicitly that the panel is not a fallback consumer of
  it. The Swift symbol should be renamed before C6.4 builds against the panel (G-37).

- **The somersault clone's `tui-ux.md` L2304 attributes the task panel's second line to `activeForm`;
  its own cross-check (L14) overturns this** — "canon never reads `activeForm` for that line". The
  scorecard row has not been updated to match its own correction.

- **`docs/tui-parity/areas/20-tasks-background.md` §20.3–§20.17 was not re-read row by row in this
  lane** — the evidence sweep truncated in transit and the section was reconstructed from README §5
  A-20 plus the binary. The verdicts cited are from README §5 and are reliable; the per-row detail of
  that area file remains unread by this study and is the one coverage gap worth naming.

