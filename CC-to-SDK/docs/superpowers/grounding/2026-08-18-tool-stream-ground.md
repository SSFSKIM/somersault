# Canon grounding — Claude Code 2.1.234 flicker-free rendering and collapsed tool clusters

Source: `~/claude-code-bundle/2.1.234/cli.pretty.js` (717,536 lines). All citations are
`cli.pretty.js:LINE`. Identifiers are minified; the minified names are kept in the prose so
every claim is re-findable. Everything below was read from the reprint in this session.

**One structural correction to the brief up front.** There is no new "flicker-free collapse
mode" component. The collapsing machinery is the pre-existing `collapsed_read_search`
message species. What 2.1.234's fullscreen renderer changes is (a) *what* is eligible to be
absorbed into a cluster — `Ns()` (the fullscreen predicate) appears as a term inside the
collapse policy itself, pulling Bash/PowerShell/ToolSearch in — and (b) that the cluster
becomes a *clickable* item in a virtualised list, which is genuinely new. Those are two
separate mechanisms and the report keeps them separate.

---

## 1. Renderer gate

### The `/tui` command

Declared as a local-JSX slash command at **432267**:

> `H5v = { type: "local-jsx", name: "tui", description: "Set the terminal UI renderer (default | fullscreen)", argumentHint: "[default|fullscreen]" }`

The accepted values are exactly two — **577198**:

> `qpc = ["default", "fullscreen"]`

Command body `dzw` starts at **577122**. With no argument it reports state (**577125**):

> ``return e(`Current renderer: ${o}. Usage: /tui <${qpc.join("|")}>`, { display: "system" }), null;``

and rejects anything else (**577127**):

> ``return e(`Unknown renderer "${n}". Usage: /tui <${qpc.join("|")}>`, ...)``

where `o = Ns() ? "fullscreen" : "default"` (**577123**).

### The persisted setting

The setting is `tui` in **user settings** (`settings.json`), written via
`ea("userSettings", { tui: i }, void 0, t.storageV5)` at **577160** (and at **577133** for the
background-session branch, **577238** for the downsell graduation, **657298** for the upsell). Schema — **45074** (one enormous line; substring):

> `tui: Mr(["default", "fullscreen"]).optional().describe('Terminal UI renderer. "fullscreen" uses the flicker-free alt-screen renderer with virtualized scrollback (equivalent to CLAUDE_CODE_NO_FLICKER=1). "default" uses the classic main-screen renderer.')`

Switching restarts the process. `x_r` (**577026**) re-execs with
`env: { CLAUDE_CODE_TUI_JUST_SWITCHED: e, ... }` and
`dropEnv: ["CLAUDE_CODE_NO_FLICKER", "CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN", "CLAUDE_CODE_FORCE_FULLSCREEN_UPSELL"]` (**577029**).

### The runtime predicate `Ns()` — 107162

This is *the* gate; it is called from deep inside rendering and policy code, not just at
startup. Order of precedence, verbatim structure:

```
if (s4() === "local-agent")            return !1;   // 107163
if (V.CLAUDE_CODE_SESSION_KIND === "bg") return !0; // 107165  (background sessions forced on)
if (wF())                              return !1;   // 107167  (screen-reader mode)
if (e7s())                             return !1;   // 107169
if (V.CLAUDE_CODE_NO_FLICKER === !0)   return !0;   // 107171
if (IUe(e))                            return !1;   // 107173  tmux -CC
if (QKs())                             return !1;   // 107178  Windows over SSH
switch (Vo().tui) { case "fullscreen": return !0; case "default": return !1; } // 107183
if (LQ_(e)) return !0;                              // 107189  gate tengu_amber_creek (LQ_ at 107193)
return e.gbGateCached ??= tt("tengu_pewter_brook", !1);  // 107191
```

`e7s()` (**107159**) is the env kill-switch:

> `return V.CLAUDE_CODE_NO_FLICKER === !1 || V.CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN;`

Capability gates, each with its own log line:

- tmux control mode — **107175**: `"fullscreen disabled: tmux -CC (iTerm2 integration mode) detected \xB7 set CLAUDE_CODE_NO_FLICKER=1 to override"` (probe `MQ_` at **107129** spawns `tmux display-message -p '#{client_control_mode}'`, **107141**).
- Windows over SSH — **107180**: `"fullscreen disabled: Windows over SSH (ConPTY re-rendering) detected \xB7 set CLAUDE_CODE_NO_FLICKER=1 to override"`; `QKs()` at **107154** tests `Wt() === "windows"` and `SSH_CONNECTION || SSH_CLIENT || SSH_TTY`.
- Screen reader — **577140**: `"Screen-reader mode always uses the classic renderer, so the tui setting has no effect while it is active."`

### The internal mode enum

There are two. The two-valued renderer identity is `"default" | "fullscreen"`. The richer
one is the **entry-path** enum produced by `Qct()` (**107215**), used for telemetry and for
deciding whether to show the win-back survey:

`"bg_forced_on" | "sr_auto_off" | "env_off" | "env_on" | "tmux_cc_auto_off" | "win_ssh_auto_off" | "settings_on" | "settings_off" | "downsell_on" | "gb_on" | "gb_off"`
(and `"ant_default"`, which only appears in the mapper). `XTd(e)` (**107238**) folds each of
these back to `"fullscreen"` or `"default"`.

A parallel predicate `rDr()` (**107196**) gates the *alt-screen wrapper* specifically; unlike
`Ns()` it defaults to `!0` when no setting is present (**107213** `return !0`).

### Refusals and win-back

`/tui` refuses to switch when the session has state a restart cannot carry (**577031**):

> ``Cannot switch renderers in this session — it has restrictions a restart can't carry over (${t.join("; ")}). Nothing was changed. Running /tui ${e} in a session started without them switches every later session too.``

and when background work is live (**577150**):

> `"Cannot switch renderers while work is running in the background — wait for it to finish (or stop it via /tasks), then run /tui again."`

Telemetry: `tengu_tui_command` (**577137**, **577164**), `tengu_tui_refused` (**577147**, **577150**, **577041**),
`tengu_tui_optout_reason` (**577062**), `tengu_fullscreen_upsell_dialog_shown/accepted/dismissed`
(**657240**, **657303**, **657320**), `tengu_fullscreen_downsell_shown/persisted` (**547237**,
**547243**), `tengu_flicker` (**667585**).

### The onboarding copy (the screenshot's source)

`qVi()` at **545938**, keyed on `V.CLAUDE_CODE_TUI_JUST_SWITCHED`. Case `"fullscreen"`
(**545944**):

> `"Using flicker-free rendering"` · `" \xB7 if you want to go back, use /tui default"`
> `"\xB7 Click to move your cursor in the text input"`
> `"\xB7 Click to expand collapsed tool results"`
> `"\xB7 By default, text auto-copies when you select it (/config to change)"`
> `"\xB7 Hold ", VLn(), " while selecting to use your terminal's native copy instead"` (**545950**)

Case `"default"` (**545956**): `"Switched back to the classic renderer"`.

A second, steady-state banner `DWl()` at **547246** (body **547249**):

> `" Using flicker-free rendering"`
> `"\xB7 Scroll with your trackpad, scroll wheel, or PageUp/PageDown"`
> `"\xB7 Select text to copy — copying is automatic (/config to disable)"`
> `"\xB7 Click to move your cursor or expand collapsed results"`
> `"\xB7 /tui default to go back (saved to your preferences)"`

And the opt-in dialog `aMc` (**657267**), whose bullets are at **657326** and whose title is `"Try the new fullscreen renderer?"` (**657336**):

> `"\xB7 Flicker-free output"` (+ `" — fixes the flashing you see during long responses"`)
> `"\xB7 Mouse support — click to move your cursor or expand results"`
> `"\xB7 Selected text auto-copies to your clipboard"`

---

## 2. Collapse policy — which tools collapse

### The single predicate: `Krr(toolName, input, tools)` — 236795

This is the whole policy. It returns a record whose `isCollapsible` field decides absorption
into a cluster. Walking it in order:

1. **REPL** — **236796**: `if (e === Y_)` (`Y_ = "REPL"`, **105382**) → `{ isCollapsible: !u, ..., isREPL: !u, isAbsorbedSilently: !u }` where `u = RJe()`.
2. **Write/Edit into an auto-managed memory path** — **236801** via `GuS` (**236759**) → `isMemoryWrite: !0`, collapsible.
3. **Write/Edit into a workshop page** — **236803** via `KuS` (**236771**) → `isWorkshopWrite: !0`, collapsible.
4. **Write/Edit into a scratchpad** — **236805** via `VuS` (**236765**) → `isScratchpadWrite: !0`, collapsible.
5. **Silently absorbed** — **236807–236809**:
   > `let o = Joi.includes(e); if (Ns() && e === iE || o) return { isCollapsible: !0, ..., isAbsorbedSilently: !0, popsOutOnError: o };`

   `iE = "ToolSearch"` (**103427**) — **fullscreen-only**. `Joi = [nq, xz, ODe, oq, DW]` (**236734**) = `["TodoWrite", "TaskCreate", "TaskGet", "TaskUpdate", "TaskList"]` (**169891**, **169970**, **169503**) — absorbed in both renderers, but they "pop out" if the call errors.
6. **Any MCP tool** — **236811**: `if (i?.isMcp) return { isCollapsible: !0, ..., mcpServerName: i.mcpInfo?.serverName }`.
7. **No `isSearchOrReadCommand` on the tool** — **236813**:
   > `if (!i?.isSearchOrReadCommand) return { isCollapsible: !1, ... };`
8. **Otherwise** — **236815**:
   > `let s = i.isSearchOrReadCommand(t ?? {}), a = s.isList ?? !1, l = s.isSearch || s.isRead || a, c = ipe.includes(e);`
   > `return { isCollapsible: l || (Ns() ? c : !1), isSearch: s.isSearch, isRead: s.isRead, isList: a, ..., isBash: Ns() ? !l && c : void 0 };`

   `ipe = [_i, js]` = `["Bash", "PowerShell"]` (**169942**, **82177**, **346737** area).

### Which tools actually declare `isSearchOrReadCommand`

There are exactly five declarations in the whole bundle (grep `isSearchOrReadCommand`):

| line | owning tool | returns |
|---|---|---|
| **227377** | `Yf` = `"Glob"` (name at 227360) | `{ isSearch: !0, isRead: !1 }` |
| **227594** | `$f` = `"Grep"` (name at 227577) | `{ isSearch: !0, isRead: !1 }` |
| **348329** | `Qs` = `"Read"` (name at 348311) | `{ isSearch: !1, isRead: !0 }` |
| **379263** | `_i` = `"Bash"` (name at 379228) | `xmv(command)` — per-command `{isSearch,isRead,isList}` |
| **346743** | `js` = `"PowerShell"` (name at 346737) | `oJS(command)` — per-command |

### Verdict on the user's observation — CONFIRMED

`Write` (`fu`, **82198**), `Edit` (`xl`, **82191**), `NotebookEdit` (`O0`, **82198**),
`Agent` (`di`, **105382**) and `Task` (`P4`, **105382**) have no `isSearchOrReadCommand`, so
step 7 returns `isCollapsible: !1` for all of them. They break the cluster and render as
their own expanded rows. The only exception is Write/Edit whose target path is a memory,
scratchpad or workshop file (steps 2–4), which do get absorbed.

Plain assistant text also stays out: `Xoi(e)` (**236875**) recognises a non-empty assistant
text block, and in the cluster loop it falls through to the flush branch (see §3).

### What the fullscreen renderer adds on top

`Ns()` appears as a live term in four places inside the collapse pipeline:

- `Krr` step 5 — ToolSearch absorbed (**236808**).
- `Krr` step 8 — **all** Bash/PowerShell calls become collapsible, not only read-ish ones (**236816**).
- `iNp` cluster accumulation — **237152** `else if (Ns() && u.isBash) { o.bashCount = ...; o.latestDisplayHint = ...; o.bashCommands.set(id, command) }`, and **237212** `if (Ns() && o.bashCommands?.size) odS(c, o)` (git-op scraping of bash stdout).
- `Rka()` accumulator init — **237020**: `if (... Ns()) e.bashCount = 0, e.bashCommands = new Map, e.commits = [], e.pushes = [], e.branches = [], e.prs = [], e.gitOpBashCount = 0;`

So the *user-visible* difference in fullscreen is: shell commands vanish into the cluster
(and git operations get a dedicated summary), and `ToolSearch` disappears entirely.

### A second, orthogonal collapse: brief mode

`aNp(messages, tools, getToolStats, isLoading, opts)` (**237332**) collapses an entire turn
into one `collapsed_read_search`, including Agent/Task calls (`tNp` at **237524**:
`if (t === di || t === P4) { i.agentCount = o; ... }`) and Edit/Write counts. It only runs
when (**549735**):

> `if (!(Ns() && (Y || Ke) && !Ne)) return $e;` — `Y = ft((Ke) => Ke.briefTranscript)`

i.e. it needs fullscreen **and** brief transcript (or a remote reply channel). Brief is
toggled by `app:toggleBrief` = `ctrl+shift+b` (**167626**, handler **579704**, telemetry
`tengu_brief_mode_toggled`). **This is the only path where Agent/Task collapse**, and it is
off by default. Do not confuse it with the default fullscreen behaviour.

---

## 3. Clustering

### The grouping function: `iNp(messages, tools)` — 237092

One accumulator `o = Rka()` (**237020**), flushed by the local `l()` (**237107**):

> `function l() { if (o.messages.length === 0) return; n.push(idS(o)), a(), o = Rka(); }`

`idS(o)` (**237026**) materialises the cluster object.

**What extends a cluster** (all inside the `for (let c of e)` at **237112**):
- a tool_use whose `Krr` says collapsible → `o.messages.push(c)` plus a counter bump (**237116–237199**);
- a `tool_result` whose `tool_use_id` is already in `o.toolUseIds` (`QHp`, **236922**) → **237211**;
- a PreToolUse stop-hook summary (`ZuS`, **236892**) → **237214**;
- a `relevant_memories` attachment → **237216**;
- a **thinking** block (`QuS`, **236907**) → **237220–237229**: absorbed, and its wall-clock is added to `o.thoughtForMs`;
- thinking / attachments / system messages (`nNp`, **236895**) when the cluster is non-empty → buffered in `i` and re-emitted *after* the cluster on flush (**237230–237234**, drained by `a()` at **237095**).

**What breaks a cluster:**
- a **non-collapsible tool call** (Write, Edit, Agent, Task, WebFetch, …) — falls to the final `else l(), n.push(c)` at **237235–237236**;
- **assistant text** (`Xoi`) — same final `else`;
- a **user prompt** / queued command (`Dka`, **237242**) — **237218–237219** `else if (Dka(c)) l(), n.push(c);`
- an **error** `tool_result` for a workshop write (`sdS`, **237059**) — **237199–237210**, which also un-counts the write;
- end of input — `return l(), n;` (**237240**).

So: **one cluster per contiguous run of absorbable tool calls**, not one per turn and not
one per tool. A turn that alternates text → tools → text → tools produces two clusters.

### Cluster shape (`idS`, 237026)

```js
{ type: "collapsed_read_search",
  searchCount, readCount, listCount, replCount,
  memorySearchCount, memoryReadCount, memoryWriteCount,
  readFilePaths, searchArgs, latestDisplayHint,
  messages,            // every absorbed message, in order
  displayMessage,      // messages[0]
  uuid: `collapsed-${t.uuid}`, timestamp,
  teamMemorySearchCount, teamMemoryReadCount, teamMemoryWriteCount,
  scratchpadWriteCount/LinesAdded/LinesRemoved,
  workshopWriteCount/LinesAdded/LinesRemoved,
  mcpCallCount, mcpServerNames,
  bashCount, gitOpBashCount, commits, pushes, branches, prs,   // Ns() only
  hookCount, hookTotalMs, hookInfos, relevantMemories, memoryOps,
  thoughtForMs, latestThinkingSummary }
```

Brief mode adds `agentCount`, `agentDescriptions`, `editFileCount`, `linesAdded`,
`linesRemoved`, `otherToolCount`, `frameCount`, `isLiveBriefTurn` (**237480**, **237524**).

### A different grouping, easy to confuse: `grouped_tool_use`

`t0h(messages, tools, verbose, agents)` at **545212** batches ≥2 tool_use blocks **of the
same tool in the same assistant message id** into
`{ type: "grouped_tool_use", toolName, messages, results, displayMessage, uuid: \`grouped-${h.uuid}\`, messageId }`
(**545260**). Eligibility comes from a `renderGroupedToolUse` renderer field (`caw`,
**545199**), and only **one** tool declares it — `lMl = { [di]: { renderGroupedToolUse: _Ol, ... } }`
at **521601**, i.e. `di = "Agent"`. This is the parallel-agents row, not the tool cluster.

### Collapsed header copy (exact strings) — `ZIl`, 518464

Parts are pushed by the local `$e(key, verb, tail)` (**518545**), joined by
`Ja.jsx(_, { children: ", " })` and the first one is Title-cased:

> `He.push(Ja.jsxs(_, { children: [Xe ? Qe[0].toUpperCase() + Qe.slice(1) : Qe, je != null && Ja.jsxs(Ja.Fragment, { children: [" ", je] })] }, Je));`

Verb pairs are `isActiveGroup ? present : past`, pushed in this fixed order:

| line | inactive / active | tail |
|---|---|---|
| **518551–518567** | `"Thought"` / `"Thinking"` | `" for "` + duration (live clock when active) |
| **518570** | `"edited"` / `"editing"` | `N` + `"file"/"files"` + `+a/-b` diffstat |
| **518572** | `"made"` / `"making"` | `N` + `" scratchpad "` + `"edit"/"edits"` |
| **518574** | `"made"` / `"making"` | `N` + `" page "` + `"edit"/"edits"` |
| **518576–518580** | `"committed"`, `"amended commit"`, `"cherry-picked"` | sha list (`Ns()` only) |
| **518585** | `"pushed to"` | branch list (`Ns()` only) |
| **518588–518590** | `"merged"` / `"rebased onto"` | ref (`Ns()` only) |
| **518593–518595** | `"created"/"edited"/"merged"/"commented on"/"closed"/"reopened"/"marked ready"/"marked draft"/"enabled auto-merge on"/"disabled auto-merge on"` | PR number/link (`Ns()` only) |
| **518598** | `"published"` / `"publishing"` | — (frames) |
| **518600** | `"searched for"` / `"searching for"` | `N` + `"pattern"/"patterns"` |
| **518602** | `"read"` / `"reading"` | `N` + `"file"/"files"` |
| **518604** | `"listed"` / `"listing"` | `N` + `"directory"/"directories"` |
| **518606** | `"REPL'd"` / `"REPL'ing"` | `N` + `"time"/"times"` |
| **518609** | `"called"` / `"calling"` | MCP server names (with a leading `"claude.ai "` stripped) + `N` + `" times"` |
| **518619 / 518621** | `"ran"` / `"running"` | `"agent · <description>"` or `N` + `"agent"/"agents"` (brief mode only) |
| **518624** | `"called"` / `"calling"` | `N` + `"tool"/"tools"` |
| **518626** | `"ran"` / `"running"` | `N` + `" shell "` + `"command"/"commands"` (`Ns()` only) |
| **518628** | `"recalled"` / `"recalling"` | `N` + `"memory"/"memories"` |
| **518630** | `"searched"` / `"searching"` | `"memories"` |
| **518632** | `"wrote"` / `"writing"` | `N` + `"memory"/"memories"` |
| **518635** | `"ran"` | `N` + `" PreToolUse "` + `"hook"/"hooks"` + `(duration)` — only when nothing else to say |

Team-memory parts come from `PIl` (**518120**): `"Recalled"/"Recalling"` + `N team memories`,
`"Searched"/"Searching" team memories`, `"Wrote"/"Writing"` + `N team memories`.

The counters are **watermarked** so they never tick backwards mid-turn (**518466**):

> `C.current = Math.max(C.current, c), k.current = Math.max(k.current, l), A.current = Math.max(A.current, u), R.current = Math.max(R.current, e.mcpCallCount ?? 0), P.current = Math.max(P.current, e.bashCount ?? 0);`

There is **no** `"N tool uses"` string in the collapsed cluster. That phrasing exists only in
the backgrounded-agent row (**520295**: `"In progress… \xB7 ", b, " tool", b === 1 ? "use" : "uses"`)
and the agent completion line (**520229**: `` `Done (${[u === 1 ? "1 tool use" : `${u} tool uses`, ...]})` ``).

### Rendered layout (518636)

```
[spinner|2-space gutter] Reading 3 files, running 2 shell commands… ·1.4s (ctrl+o to expand)
  ⎿  src/foo.ts
```

- Leading glyph: `s ? Ja.jsx(ave, { shouldAnimate: !0, isUnresolved: !0, isError: S }) : Ja.jsx(x, { minWidth: 2 })` — `ave` at **512246** is the bullet/spinner cell.
- The whole summary line is `dimColor: !s` — dim once finished, undimmed while active.
- Trailing `"…"` only while active (**518636**).
- `Ja.jsx(Wv, {})` — the `(ctrl+o to expand)` hint, which **renders null inside the virtual list** (see §7).
- The hint line uses the gutter string `"  ⎿  "` (`  ⎿  `).

---

## 4. Click-to-expand

### The clickable wrapper — `Vpw`, 549131

```js
function Vpw({ itemKey: e, msg: t, idx: r, measureRef: n, expanded: o, hovered: i,
               clickable: s, onClickK: a, onEnterK: l, onLeaveK: c, renderItemRef: u }) {
  return e9e.jsx(x, { ref: n(e), flexDirection: "column",
    backgroundColor: o ? "userMessageBackgroundHover" : void 0,
    paddingBottom: o ? 1 : void 0,
    onClick: s ? (d) => { if (d.hyperlinkUrl) return d.allowDefault(); a(t, d.cellIsBlank); } : void 0,
    onMouseEnter: s ? () => l(e) : void 0,
    onMouseLeave: s ? () => c(e) : void 0,
    hoverIgnoresBlankCells: !o,
    children: e9e.jsx(ati.Provider, { value: i && !o, children: u.current(t, r) }) });
}
```

Notes: a click that lands on a hyperlink cell defers to the link (`allowDefault()`); a click
on a **blank** cell is dropped one level up (**549361**):

> `let Ce = wE.useCallback((Se, Ne) => { let He = Te.current; if (!Ne && He.onItemClick) He.onItemClick(Se); }, []);`

### Where the state lives — `cfw`, 549699

`cfw` is the whole transcript renderer. The expansion state is a plain component-local Set
of keys (**549749**):

```js
[st, Ye] = yT.useState(() => new Set),
Ot = yT.useCallback((Ke) => {
  let et = XRh(Ke);
  Ye((Ue) => { let We = new Set(Ue); if (We.has(et)) We.delete(et); else We.add(et); return We; });
}, []),
gr = yT.useCallback((Ke) => st.size > 0 && st.has(XRh(Ke)), [st]),   // 549759
```

`XRh(e)` (**549613**) is the key: `(e.type === "assistant" || e.type === "user" ? bet(e) : null) ?? e.uuid`
— for a cluster this is the synthetic `collapsed-<firstMessageUuid>`.

`Ot` / `gr` / `Pr` are threaded to the virtual list as `onItemClick` / `isItemExpanded` /
`isItemClickable` (**549824**). The list re-reads them per visible row (**549372**):

> `let $e = h[He], Oe = !!i && (s?.(Se) ?? !0), Je = Oe && fe === $e, Qe = a?.(Se);`

Expansion feeds back into rendering through the `verbose` prop of the row (**549802**):

> `Rr = XD.jsx(ICh, { message: Ke, ..., verbose: n || gr(Ke), ... })`

and in the species router the cluster receives `const lC = Lre || Wq` (verbose ‖ transcript
mode, **519896**), which drives `ZIl`'s `if (n) { ... }` branch (**518492**) — the branch that
renders every absorbed thinking block and every `tool_use` in full via `Eth`.

**Persistence:** the Set lives in React state on `cfw` for as long as that component is
mounted, so an expansion survives further turns and further renders. It is not written to
settings, not keyed to the session file, and is lost on `/clear`, on a screen switch that
unmounts the tree, and on restart. Keys are content-derived (`collapsed-<uuid>`), so an
expanded cluster stays expanded even as it accretes more tool calls during a live turn.

**Which items are clickable — `Pr`, 549763:**

- `collapsed_read_search` → always `!0` (**549764**);
- `attachment` of type `goal_status` with a reason (non-verbose, non-transcript) (**549769**);
- `assistant` advisor tool results (**549775**);
- `user` `tool_result` rows that are `is_error` with >10 lines (`U8m`, **511154**) — **549782–549783**;
- `user` `tool_result` rows whose tool declares `isResultTruncated` and says the result was truncated (**549786–549787**).

Everything else is inert.

**Keyboard path: none.** The full action registry on the keybinding table line (**167626**)
contains 112 actions and none of them expands a single inline item. The nearest neighbours
are `app:toggleTranscript` (ctrl+o), `transcript:toggleShowAll` (ctrl+e, Transcript context)
and `app:toggleBrief` (ctrl+shift+b) — all global, none per-cluster. Click is the only way in.

**Hover affordance.** Two distinct effects:

1. Hover sets `ati.Provider value = hovered && !expanded` (**549136**). `ati` is consumed by
   the `Text` component `_` (**212209**): `sKb = dSp && !_Sp ? C2r.inactive : sti(Hva, C2r)`
   — i.e. when the context is true, `dimColor` is ignored, so the whole dim summary line
   **brightens to full colour on hover**. No underline, no cursor glyph.
2. `hoverIgnoresBlankCells: !expanded` (**549136**) — while collapsed, hovering the padding
   around the text does nothing; once expanded, the whole block is hover-active.

Expanded rows additionally get `backgroundColor: "userMessageBackgroundHover"` and one row of
bottom padding (**549132**).

Hover state itself is a single key in the list component (**549357**):
`let [fe, he] = wE.useState(null)` — only one row can be hovered at a time.

**No telemetry fires on inline expand.** `Ot` (**549749**) contains no `H(...)` call, unlike
`transcript:toggleShowAll` (`tengu_transcript_toggle_show_all`, **580042**) and
`app:toggleTranscript` (`tengu_toggle_transcript`, **579699**).

---

## 5. Mouse arming

### DECSET table and the two armed sets — 207330 / 207331

```js
UR = { CURSOR_VISIBLE: 25, ALT_SCREEN: 47, ALT_SCREEN_CLEAR: 1049,
       MOUSE_NORMAL: 1000, MOUSE_BUTTON: 1002, MOUSE_ANY: 1003, MOUSE_SGR: 1006,
       FOCUS_EVENTS: 1004, BRACKETED_PASTE: 2004, THEME_NOTIFY: 2031,
       SYNCHRONIZED_UPDATE: 2026 };
d8b = pse(UR.MOUSE_NORMAL) + pse(UR.MOUSE_BUTTON) + pse(UR.MOUSE_ANY) + pse(UR.MOUSE_SGR);
p8b = pse(UR.MOUSE_NORMAL) + pse(UR.MOUSE_SGR);
ACe = bMe(UR.MOUSE_SGR) + bMe(UR.MOUSE_ANY) + bMe(UR.MOUSE_BUTTON) + bMe(UR.MOUSE_NORMAL);
```

`pse(n) = CSI ?n h`, `bMe(n) = CSI ?n l` (**207312**, **207315**). So:

- **`"full"`** → `?1000h ?1002h ?1003h ?1006h` — click + drag + **any-motion** (needed for hover) + SGR encoding.
- **`"scroll"`** → `?1000h ?1006h` only.
- **`"off"`** → `""`.
- Teardown always writes `ACe` = `?1006l ?1003l ?1002l ?1000l`.

`eJe(mode)` (**207318**) is the selector.

### Who decides — `Gye()`, 107263

```js
function Gye() {
  if (V.CLAUDE_CODE_DISABLE_MOUSE !== void 0)        return V.CLAUDE_CODE_DISABLE_MOUSE ? "off" : "full";
  if (V.CLAUDE_CODE_DISABLE_MOUSE_CLICKS !== void 0) return V.CLAUDE_CODE_DISABLE_MOUSE_CLICKS ? "scroll" : "full";
  return "full";
}
```

Default is `"full"`. There is no per-terminal capability probe for mouse — the only gates are
these two env vars (and the renderer gate itself, since mouse is only armed inside the alt
screen). Mouse mode is reported in startup telemetry as `mouse_mode: ge(Gye())` (**658856**).

### Where the sequence is written — `owt`, 646945

```js
F_E = () => {
  let Iyo = cm.get(process.stdout);
  if (!ZFe) return;
  return ZFe(Kpt() + eJe(sun)), Iyo?.setAltScreenActive(!0, sun), () => {
    let hdL = Iyo ? !Iyo.isAltScreenActive : !1;
    if (Iyo?.setAltScreenActive(!1), Iyo?.clearTextSelection(), hdL) { ZFe(sun !== "off" ? ACe : ""); return; }
    ZFe((sun !== "off" ? ACe : "") + rX() + (Iyo?.hasUnmounted ? "" : SMe()));
  };
}
```
(**646963–646977**, an insertion effect registered at **646979**, so it runs before paint.) `owt` is mounted by
`ITr(Ht)` in the main app (**661534**):

> `return Sp.jsx(owt, { mouseTracking: Gye(), children: Ht });`

and by the FleetView screen behind `rDr()` (**647032–647039**). The renderer keeps the mode
so it can re-emit after every suspend/resume/alt-screen re-entry:
`altScreenMouseTracking` (**210901**), re-armed at **210981**, **211000**, **211001**,
**211009**, **211516**, **211538**; torn down at **210996**, **211006**.
`getMouseMode = () => this.altScreenMouseTracking` (**211482**).

The `"scroll"` mode is enforced twice: the DECSET set omits 1002/1003, and the input pump
drops any surviving button event (**207924**):

> `if (r7s(), e.props.getMouseMode?.() === "scroll" && (a.button & 3) === 0) continue;`

### Hit testing: (col,row) → node

`dispatchClick` on the renderer (**211651**):

```js
dispatchClick(e, t) {
  if (!this.altScreenActive) return !1;
  let r = gtr(this.frontFrame.screen, e, t), n = this.getHyperlinkAt(e, t);
  return Y_p(this.rootNode, e, t, r, n);
}
```

`r` is "this cell is blank", `n` the hyperlink under the cursor. `Y_p` (**208421**) does the
work:

```js
let i = b2r(e, t, r) ?? void 0;            // hit test
if (!i) return !1;
if (e.focusManager) { /* walk up to nearest tabIndex, handleClickFocus */ }
let s = new BHn(t, r, n, o), a = !1;
while (i) {
  let l = i._eventHandlers?.onClick;
  if (l) {
    let c = i.cachedLayout;
    if (c) s.localCol = t - c.x, s.localRow = r - c.y;
    s.defaultAllowed = !1; l(s);
    if (s.didStopImmediatePropagation()) return !s.defaultAllowed;
    if (!s.defaultAllowed) a = !0;
  }
  i = i.parentNode;
}
return a;
```

`b2r(node, col, row, depth)` (**208367**) is a depth-first walk over the **yoga layout rects**
cached on each node:

> `let o = e.cachedLayout; if (!o) return null; let i = t >= o.x && t < o.x + o.width && r >= o.y && r < o.y + o.height;`

It iterates `childNodes` in reverse (topmost-last wins), skips `#text`, honours
`hasAbsoluteDescendant` for absolutely-positioned children, and is depth-capped at
`yDt = 256` (**208368**, **208366**). So hit testing is pure yoga geometry — no per-cell
ownership map.

The click event object `BHn` (**208340**) carries `col`, `row`, `localCol`, `localRow`,
`cellIsBlank`, `hyperlinkUrl`, `defaultAllowed`/`allowDefault()`. **Bubbling is inverted
relative to the DOM**: a handler that does *not* call `allowDefault()` marks the click
consumed, and `Y_p` returns true; the return value is what tells the caller a component
handled the click.

Hover uses the same walk — `J_p` (**208451**), collecting every ancestor with
`onMouseEnter`/`onMouseLeave`, skipping any node with `hoverIgnoresBlankCells` when the cell
is blank, then diffing against the previously-hovered set.

`hoverIgnoresBlankCells` is a first-class Box prop (**207724**):

> `function D8b({ children: e, ref: t, tabIndex: r, autoFocus: n, onClick: o, onFocus: i, ..., onMouseEnter: c, onMouseLeave: u, hoverIgnoresBlankCells: d, ... })`

and `click` is a bubble-only event in the reconciler's event map (**205389**):

> `click: { bubble: "onClick" }` … `Uba = new Set([... "onClick", "onMouseEnter", "onMouseLeave"])`

### Clicks vs. text selection

Both live in `K8b`, the SGR-mouse dispatcher (**207960**). Decoding is at **199726** area;
`n = t.col - 1, o = t.row - 1, i = t.button & 3`.

- **Motion with buttons up** (`button & 32` and `i === 3`) → hover only (**207963–207968**):
  `e.lastHoverCol = n, e.lastHoverRow = o, e.props.onHoverAt(n, o);`
- **Press, button 0** → `e.props.onSelectionStart(n, o)` (**208004**) — a selection anchor is
  set on *every* press.
- **Motion with button held** (`button & 32`) → `e.props.onSelectionDrag(n, o)` (**207990–207991**).
- **Release** (**208013–208014**):
  ```js
  if (u2r(r), !$je(r) && r.anchor) {
    if (!e.props.onClickAt(n, o)) { /* hyperlink fallback */ }
  }
  ```
  `$je(r)` is "there is a real (non-empty) selection". So the click only fires when the
  press-release produced **no** selection. Drag to select → no click; tap → click. That is
  the entire coexistence mechanism, and it is why "click to expand" and "select to copy" do
  not fight.
- **Double / triple click** → `e.props.onMultiClick(n, o, l)` (**208001**) with a 500 ms /
  1-cell tolerance (`W_p = 500`, `G_p = 1`, **208045**); word/line selection, not expansion.
- Hyperlink activation is a 500 ms deferred timer that only arms if `onClickAt` returned
  false and a modifier was held (**208014–208022**).

"Click to move your cursor in the text input" is the composer's own `onClick`, using the
`localRow`/`localCol` the walk filled in (**592621**):

> `let yo = Rf.fromText(N, _we, Je), Li = yo.getViewportStartLine(bwe), kl = yo.measuredText.getOffsetFromPosition({ line: Tr.localRow + Li, column: Tr.localCol }); Qe(kl);`

Auto-copy-on-select is the `copyOnSelect` setting, default **on**, and the row is only shown
in `/config` when `Ns()` (**395342**):

> `...Ns() ? [{ id: "copyOnSelect", label: "Copy on select", value: t.copyOnSelect ?? !0, type: "boolean", onChange(N) {...` 

Read back as `or().copyOnSelect ?? !0` (**537850**, **590579**, **648826**).

---

## 6. Streaming — what the cluster does during a live turn

Tools are **not** shown expanded and then collapsed. They stream *inside* the collapsed
block from the first call.

`isActiveGroup` is computed once per row (**546426**):

> `Elw = wNe && (b2n(E1, D7) || TCh && !mCh)`

— cluster **and** (it owns an in-flight tool use, or the app is loading and nothing follows
it). `mCh` (`hasContentAfter`) comes from **549802**:

> `mt = Ke.type === "collapsed_read_search" && (b || RCh(Xe, et, t, $t))`

where `b = hasStreamingText` and `RCh` (**546393**) scans forward for the first message that
is neither thinking, nor a collapsible tool call, nor a streaming tool use.

While `isActiveGroup`:

1. **Spinner** replaces the 2-column gutter — `Ja.jsx(ave, { shouldAnimate: !0, isUnresolved: !0, isError: S })` (**518636**); `S` is true if any absorbed tool errored.
2. **Text is undimmed** — `dimColor: !s` (**518636**).
3. **Verbs go present-tense** — "Reading", "Searching for", "Running" (§3 table).
4. **Counts tick up** and are watermarked so they never regress (**518466**).
5. **A live "current tool" hint line** is rendered under the summary (**518636–518637**):
   `ce = e.latestDisplayHint`, defaulting to the last search arg (`"pattern"`) or the last
   read path (**518468–518470**). While active it is overwritten from live progress messages
   (**518472–518490**): `repl_tool_call` phase start/executing gives the file/pattern/command
   (**518477**); `mcp_progress` gives `` `${msg} (${pct}%)` `` or `` `Processing… ${n}` ``
   (**518480–518488**). It renders in a `⎿`-gutter column, truncated by `Beh(ce, I$T)` with
   `I$T = 700` (**518491**, **518673**).
6. **A thinking clock** — `Cth` (**518639**) re-renders every 1000 ms and shows
   `Thinking for <elapsed>`, seeded from `thoughtForMs` plus the time since the last
   thinking block (wired at **518564**).
7. **A per-tool elapsed ticker** — `kth` (**518661**) appends `" · 1.4s"` once the running
   tool has been in flight ≥ 2 s (`if (YIl < 2000) return null`, **518664**), anchored to the
   newest in-flight tool_use timestamp collected at **518532–518543**.
8. **A bash duration/line-count suffix** (fullscreen only, **518516–518530**):
   > `` Se = Qe > 0 ? ` (${je} \xB7 ${Qe} ${Qe === 1 ? "line" : "lines"})` : ` (${je})`; ``
   built from the highest `elapsedTimeSeconds` across `bash_progress` / `powershell_progress`
   messages, shown only once ≥ 2 s (**518527**).
9. **A trailing `…`** on the summary line (**518636**).
10. Optionally a **task summary** override — `ke` (**518496**), which if present replaces the
    whole part list with `r4(ke)`.

When the turn ends (or content follows), `isActiveGroup` flips false: the spinner becomes a
2-column spacer, the text dims, verbs become past tense, the hint line and tickers disappear.
Nothing re-lays-out beyond that; the block never "un-collapses" on its own.

One consequence for a clone: a `collapsed_read_search` row is **never** eligible for Ink's
static/frozen region — `q9l` (**549665**) is the "can this be static" predicate and its
cluster case is **549695**: `case "collapsed_read_search": return !1;`.

---

## 7. Relation to the ctrl+o transcript overlay

`ctrl+o` = `app:toggleTranscript` in the **Global** context (**167626**). Its handler
(**579693–579700**) flips `screen` between `"prompt"` and `"transcript"` and emits
`tengu_toggle_transcript` with `{ is_entering, show_all, message_count, open_dialog_count }`
(**579699**). The `Transcript` keybinding context (new in 2.1.234) is (**167626**):

> `{ context: "Transcript", bindings: { "ctrl+e": "transcript:toggleShowAll", "ctrl+c": "transcript:exit", escape: "transcript:exit", q: "transcript:exit", "ctrl+u": "scroll:halfPageUp", "ctrl+d": "scroll:halfPageDown", "ctrl+b": "scroll:fullPageUp", "ctrl+f": "scroll:fullPageDown", "ctrl+n": "scroll:lineDown", "ctrl+p": "scroll:lineUp", g: "scroll:top", "shift+g": "scroll:bottom", j: "scroll:lineDown", k: "scroll:lineUp", space: "scroll:fullPageDown", b: "scroll:fullPageUp", up: "scroll:lineUp", down: "scroll:lineDown", home: "scroll:top", end: "scroll:bottom" } }`

Described as `Transcript: "When viewing the transcript..."` (**167806**).

### What the overlay shows

The same `cfw` component, with `screen: "transcript"` and `verbose: !0` (**580182**):

> `U9w = gl.jsx(t9e, { messages: HZ.messages, tools: Nfo, commands: hZh, verbose: !0, toolJSX: null, ..., screen: "transcript", ..., showAllInTranscript: xFe, ... })`

Because the species router computes `const lC = Lre || Wq` (`verbose || isTranscriptMode`,
**519896**), **every cluster renders fully expanded in the overlay**, unconditionally. The
overlay is therefore the "show me everything" view; the inline expansion Set is irrelevant
there (and `Pr` explicitly returns `!1` for the other clickable species when `n || Ne`,
**549767** / **549772**).

### What ctrl+e toggles

`showAllInTranscript` (`u` in `cfw`). It controls a **message-count cap**, not verbosity
(**549730–549731**):

```js
He = Ne && !u && !Z;                       // 549730: transcript && !showAll && !virtualScroll
...
Ut = He ? mt.slice(-u8l) : mt,             // 549731; u8l = 30 declared on 549699
Vt = He && mt.length > u8l,
Rn = et.length - u8l;
```

The banner is (**549824**):

> `` Je && XD.jsx(P_, { title: `${Q} to show ${Qt.bold(Qe)} previous messages`, width: B }) ``
> `` Ne && u && Qe > 0 && !L && XD.jsx(P_, { title: `${Q} to hide ${Qt.bold(Qe)} previous messages`, width: B }) ``

with `Q = Nd("transcript:toggleShowAll", "Transcript", "Ctrl+E")` (**549700**). Telemetry
`tengu_transcript_toggle_show_all` with `{ is_expanding, message_count }` (**580042**).

**Crucially, in the fullscreen renderer ctrl+e is dead**, because the whole transcript is
virtualised and there is no cap to lift (**580054–580060**, inside `Sgc` at **580038**):

> `const fZh = !Xe1;` … `S9w = { context: "Transcript", isActive: fZh }` … `Eo("transcript:toggleShowAll", Qe1, S9w);`
> where `Xe1 = virtualScrollActive`.

So: fullscreen ⇒ virtual scroll ⇒ ctrl+e inactive ⇒ ctrl+o is a plain screen switch to a
fully-expanded view, and inline click is the only granular control.

### The inline hint disappears in fullscreen

`Ett` is a React context created at **506706** and provided *only* around the virtual list
(**549824**):

> `Z ? XD.jsx(Ett.Provider, { value: !0, children: XD.jsx(MRh, { messages: Xe, scrollRef: C, ... }) }) : Xe.flatMap(Kt)`

with `Z = C != null && !X` (a scrollRef exists and `CLAUDE_CODE_DISABLE_VIRTUAL_SCROLL` is
unset — both declared on **549700**). Three consumers:

1. `Wv` — the `(ctrl+o to expand)` chip (**511132**): `if (b1O || S1O) return null;`. So the
   chip that `ZIl` renders at the end of every cluster header **renders nothing in
   fullscreen**. The hint is replaced by the click affordance, which is why the onboarding
   copy has to teach it.
2. `TN`, the tool-output text renderer (**509909**) — passes the context as the third arg to
   `Zaa(text, columns, suppressHint)` (**168732**), which appends `… +N lines` and, only when
   the flag is false, `` ` ${axb()}` `` where `axb()` (**168706**) is
   `` Qt.dim(`(${e} to expand)`) `` with `e = mB("app:toggleTranscript", "Global", "ctrl+o")`.
3. `v4m` / `IO` (**506709**) — the static/measure wrapper treats content as visible.

`I2` (**511191**) is the `… +N lines` counter itself, built from `MAt(count, unit)`
(**82717**): `` return `… +${e} ${xt(e, t)}`; `` — the source of the `"… +3 lines"` and
`"… +2 tool uses"` strings (**520314**: `rc.jsx(I2, { count: f, unit: "tool use", expandable: !0 })`).

### Interaction summary

| surface | granularity | mechanism | state |
|---|---|---|---|
| click a cluster | one cluster | `Ot` toggles a key in `st` → row's `verbose` | React state in `cfw`, session-lifetime |
| ctrl+o | whole screen | `screen: "prompt" ⇄ "transcript"`, forces `verbose: !0` | app state |
| ctrl+e | message count cap (30) | `showAllInTranscript` | local to the transcript screen, **inactive under virtual scroll** |
| ctrl+shift+b | whole-turn brief collapse | `isBriefOnly` / `briefTranscript` → `aNp` | app state + persisted `briefTranscript` |
| `/config verbose` | everything | `verbose` prop into `cfw` | persisted global config |

---

## Facts most likely to matter for a clone

1. The setting is `settings.json → tui: "default" | "fullscreen"` (**45074**); the live
   predicate is `Ns()` (**107162**) and it is consulted *inside rendering policy*, not just
   at boot. `CLAUDE_CODE_NO_FLICKER=1/0` overrides it; tmux `-CC`, Windows-over-SSH and
   screen-reader mode hard-disable it; background sessions force it on.
2. There is no separate "collapsed mode" widget. Collapse is the `collapsed_read_search`
   message species produced by `iNp` (**237092**) and rendered by `ZIl` (**518464**);
   fullscreen only widens *what feeds it*.
3. Collapse eligibility is one function, `Krr(name, input, tools)` (**236795**). Only five
   tools declare `isSearchOrReadCommand` — Glob, Grep, Read, Bash, PowerShell — plus MCP
   tools, REPL, TodoWrite/Task*, ToolSearch, and memory/scratchpad/workshop-targeted
   Write/Edit. Everything else is non-collapsible.
4. **Write, Edit, NotebookEdit, Agent and Task are non-collapsible and break the cluster.**
   The user's observation is confirmed, and the reason is structural (no
   `isSearchOrReadCommand`), not a name list.
5. Fullscreen's specific additions: all Bash/PowerShell (not just read-ish commands) collapse,
   `ToolSearch` is absorbed silently, and git operations scraped from bash stdout get
   dedicated summary parts (committed / pushed to / merged / PR actions).
6. A cluster is **one contiguous run**, not one per turn. Breakers: assistant text, a
   non-collapsible tool call, a user prompt, an errored workshop write. Absorbed without
   breaking: thinking blocks, attachments, system messages, PreToolUse hook summaries,
   relevant-memory attachments.
7. Header text is a comma-joined list of `verb + bold count + noun`, present tense while
   running and past tense when done, first item Title-cased, built by the local `$e()` helper
   at **518564**. There is **no** `"N tool uses"` string in the cluster.
8. Counts are watermarked with `useRef` maxima (**518466**) so a live cluster's numbers never
   go backwards as messages re-normalise.
9. Click state is a `Set` of message keys in `useState` on the transcript component
   (**549749**), keyed `collapsed-<firstMessageUuid>`. Expansion just flips the row's
   `verbose` prop. Nothing is persisted.
10. Clicking is the **only** per-cluster expansion path — there is no keybinding for it among
    the 112 declared actions.
11. Hover does not underline; it supplies a React context (`ati`, **212209**) that makes
    `dimColor` a no-op, so the dim line brightens. Expanded rows get a background colour.
12. Blank-cell clicks are dropped (**549361**) and blank-cell hovers are ignored while
    collapsed (`hoverIgnoresBlankCells`, **207724**).
13. Mouse is armed as `?1000h ?1002h ?1003h ?1006h` for `"full"` (**207331**); 1003 (any-motion)
    is what makes hover possible and is the reason "scroll" mode has no hover. Torn down with
    `?1006l ?1003l ?1002l ?1000l`.
14. Click and text selection coexist by *deferral, not modifiers*: a selection anchor is set
    on every press, and `onClickAt` only fires on release when no selection was produced
    (**208013**).
15. In fullscreen the `(ctrl+o to expand)` chips vanish everywhere, via the `Ett` context
    provided around the virtual list (**549824**, consumed at **511132**, **509909**,
    **506709**), and `ctrl+e` (`transcript:toggleShowAll`) is deactivated because virtual
    scroll removes the 30-message cap it existed to lift (**580058**).

---

## Unresolved

- **`gtr(screen, col, row)`** — the "cell is blank" test used to populate `cellIsBlank`
  (**211654**, **211661**). I located its call sites but did not read its body, so I cannot
  say whether "blank" means "space character" or "no glyph and no background".
- **`bet(e)`** — the tool-use-id extractor used by `XRh` (**549613**) and `Olw`/`Dlw`. Not read.
- **`xmv(command)` / `oJS(command)`** — the Bash/PowerShell command classifiers that decide
  `isSearch`/`isRead`/`isList` per command string (**379264**, **346745**). I did not read
  their rule tables, so I cannot enumerate which shell commands count as read-ish in the
  *classic* renderer. (Irrelevant in fullscreen, where all shell calls collapse.)
- **`eUn(input, agents)`** — the filter at **545222** that excludes some `Agent` calls from
  `grouped_tool_use` batching. Not read; likely background/async agents.
- **`Beh` / `Feh` / `Tth`** — hint-string truncators used at **518491** (`Beh`/`Feh`, with
  `I$T = 700` and `P$T = 3000`) and **518479**/**518481** (`Tth`). Their exact ellipsis
  behaviour was not read.
- **`RJe()`** — gates whether REPL collapses (**236797**) and whether virtual messages are
  dropped (**237093**, **237113**). Not read.
- **No telemetry event exists for inline expand/collapse**, so I could not use a telemetry
  name to cross-check the feature's own vocabulary. I searched every `tengu_*` identifier in
  the file for `collaps|expand|cluster|group|click|mouse|stream`; the only relevant hits were
  `tengu_transcript_toggle_show_all`, `tengu_toggle_transcript`, `tengu_brief_mode_toggled`,
  `tengu_session_group_expanded`, `tengu_fleetview_fold_expand` and the `tengu_tui_*` /
  `tengu_fullscreen_*` family.
- **Whether the expansion `Set` survives a `screen` switch to `"transcript"` and back.** It
  depends on whether `cfw` unmounts across that transition; I traced the props but not the
  mount lifetime of the two call sites (**580182** for the overlay, and the prompt-screen
  render path), so I am not asserting either way.
