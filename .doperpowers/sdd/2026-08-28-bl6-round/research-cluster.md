# bl6 canon research — T-CLUSTER (expanded tool cluster) + D8 recon + bl5 regression spot-check

**Artifact:** `~/.local/share/claude/versions/2.1.250` — Mach-O arm64, bun-compiled, 206,479,552 bytes.
**Method:** `python3` + `mmap` needle search on string literals, then small byte windows. All offsets below are
**byte offsets into the 2.1.250 binary** unless a different version is named. Cross-version checks were run
against `2.1.247` and `2.1.248`, which are also on disk.

**Identifier key (2.1.250 minified names; they WILL rename next version — anchor on the string literals):**

| name | offset | what it is |
|---|---|---|
| `xR` | 177040212 | outer `collapsed_read_search` component (plugin render-hook wrapper) |
| `cv` | 177041186 | the real cluster renderer — collapsed row **and** expansion branch |
| `VP` | 177040977 | flattens a cluster's messages to its `tool_use` blocks |
| `Jn` | 176915534 | thinking-block renderer |
| `Di` | 176986769 | `<task-notification>` row renderer |
| `QP` → `bR` | 177033830 → 177035324 | per-member tool row (same component an ungrouped tool call uses) |
| `xi` | 176973191 | memory-ops rows — **collapsed branch only** |
| `hc` | 176846402 | the `(ctrl+o to expand)` chord hint |
| `Ewe` | 154510734 | `` `${(t/1000).toFixed(1)}s` `` — hook duration format |
| `Bi` | 176838047 | markdown renderer (used for the expanded thinking body) |
| `sv` | 177028942 (import) | `basename` from `node:path` |
| `al` | 153760207 | `al="task-notification"` |
| `pr` / `HVe` | 154084075 | `pr = macos ? "⏺"(⏺) : "●"(●)`; `HVe = "∴"` (**∴**, the thinking gutter glyph) |
| `Mt()` | — | focus / brief-transcript mode; resolves to `Ple()` at 156496561: `viewMode==="focus"` else global config `briefTranscript` (default `false`, 155534036) |
| `v2n` | 162017418 | the cluster segmenter (builds the accumulator) |
| `L9n` | 162014490 | accumulator → `collapsed_read_search` item |
| `T2n` | 162025205 | the **focus-mode** brief-turn collapse (a second, later pass) |

---

## Summary

1. **Q1 — CONFIRMED, with two corrections.** The expansion branch is alive in 2.1.250 and renders exactly the
   four content kinds prior research recorded, in a fixed order: absorbed `<task-notification>` user rows →
   absorbed thinking blocks and member tool rows (interleaved in message order) → the PreToolUse hook block →
   relevant-memory blocks. Corrections: (i) the `<TS…` tag from the stale cite is the minified constant
   `al`, whose value is `"task-notification"` — the tag is `<task-notification>`, not `<TS…>`; (ii) when the
   cluster is expanded the collapsed summary row is **not** rendered at all — `cv` returns the expansion column
   and never reaches the summary/clause code. Two things the old research missed: the expansion is triggered by
   `verbose || isTranscriptMode` **or** a per-row click, and `<task-notification>` absorption only happens on
   the focus-mode (`Mt()`) code path, not the default transcript path.
2. **Q2 — STABLE-BUILDABLE.** All three clickable row kinds still exist, in one predicate (`isItemClickable`,
   177230933). A click toggles a per-row expanded flag that is OR-ed into the same `verbose` prop the rows already
   take — it expands in place, it never opens anything. The predicate is byte-identical in 2.1.247, 2.1.248 and
   2.1.250.
3. **Q3 — NO REGRESSIONS.** The link-click gate and the image media-type sniffer are unchanged from what bl5
   transcribed off 2.1.246, including the `Cv = 500` timer constant and the `WarpTerminal`/`ghostty` darwin term.

---

## Q1 — the expanded-cluster contract

### 1.1 Where the expansion is decided

Render switch, `case"collapsed_read_search"` (177087631 region):

```js
case"collapsed_read_search":{const be=uo||to; … $e=e(Zg,{children:e(xR,{message:Y,inProgressToolUseIDs:zt,
  shouldAnimate:ur,verbose:be,tools:tt,lookups:Co,isActiveGroup:CS,addMargin:Fe})}) …
```

`uo` is the global `verbose` setting, `to` is `isTranscriptMode` (the ctrl+o transcript screen). One line above,
in the list host (177232259), the per-row value is `verbose: K||de(U)` — `K` is global verbose, `de(U)` is
"this row is in the clicked-open set". So a cluster expands when **any** of: global verbose, transcript mode,
or the user clicked this specific row. `Zg` (176818534) is only a resize-freeze wrapper, not a hit target.

`xR` (177040212) is a thin shell: it builds a cache key from each member's id/result-uuid/running/errored state,
then hands `{calls, active, expanded}` to the extension render hook `zi.useRenderInput("ToolGroup", …)`, and
re-renders `cv` with `verbose: v.props.expanded`. A plugin can therefore override the expanded flag; nothing
else in the shell affects layout.

### 1.2 The expansion branch, verbatim

`cv` begins at **177041186**. The branch is `if(R){` at **177043425** and runs to **177044786**, where the
collapsed path resumes with `if(!re&&!Ae&&!rU)return null;`. Verbatim (whitespace added only at the four
top-level commas of the children array):

```js
if(R){
  let pe=[];
  for(let X of le) if(X.type==="assistant") pe.push(X);
             else if(X.type==="grouped_tool_use") pe.push(...X.messages);
  return r(o,{flexDirection:"column",children:[

    /* (a) 177043551 */
    le.map((X)=>{
      let fe=X.type==="user"?X.message.content[0]:null;
      if(fe?.type!=="text"||!fe.text.includes(`<${al}`))return null;
      return e(o,{marginTop:1,children:e(Di,{addMargin:!1,param:{type:"text",text:fe.text}})},X.uuid)
    }),

    /* (b) 177043818 */
    pe.map((X)=>{
      let fe=X.message.content[0];
      if(fe?.type==="thinking"&&fe.thinking)
        return e(o,{marginTop:1,children:e(Jn,{param:fe,addMargin:!1,isTranscriptMode:!0,verbose:!0})},X.uuid);
      if(fe?.type!=="tool_use")return null;
      return e(QP,{content:fe,tools:y,lookups:_,inProgressToolUseIDs:d,shouldAnimate:f,theme:Re},fe.id)
    }),

    /* (c) 177044137 */
    l.hookInfos&&l.hookInfos.length>0&&r(M,{children:[
      r(t,{dimColor:!0,children:[e(t,{"aria-hidden":!0,children:"  ⎿  "}),
        "Ran ",l.hookCount," ","PreToolUse ",l.hookCount===1?"hook":"hooks"," (",Ewe(l.hookTotalMs??0),")"]}),
      l.hookInfos.map((X,fe)=>r(t,{dimColor:!0,children:[e(t,{"aria-hidden":!0,children:"     ⎿ "}),
        X.command," (",Ewe(X.durationMs??0),")"]},`hook-${fe}`))
    ]}),

    /* (d) 177044521 */
    l.relevantMemories?.map((X)=>r(o,{flexDirection:"column",marginTop:1,children:[
      r(t,{dimColor:!0,children:[e(t,{"aria-hidden":!0,children:"  ⎿  "}),"Recalled ",sv(X.path)]}),
      e(o,{paddingLeft:5,children:e(t,{children:e(Wr,{children:X.content})})})
    ]},X.path))

  ]})
}
```

`⎿` is `⎿`. `M` is a fragment; `o`/`t` are Box/Text.

**The single most important structural fact: this `return` is unconditional.** An expanded cluster shows
*none* of the collapsed row — no `⏺`/spinner bullet, no "Read 3 files, searched 2 patterns" clause list, no
"Thought for 12s" clause, no `latestDisplayHint` continuation line, no team-memory clause (`Jh`, 177029514),
no `xi` memory-ops rows (176973191), no elapsed-time ticker, no `(ctrl+o to expand)` hint. The collapsed row
and the expanded body are alternatives, not a header plus a body.

### 1.3 Per-kind rendering

**(a) Absorbed `<task-notification>` messages** — `Di` (176986769). The message text is an XML-ish envelope
`<task-notification><status>…</status><summary>…</summary></task-notification>` (tag constants at 153760207:
`al="task-notification"`, `bg="status"`, `Jg="summary"`; a `duration_ms` field is also read). `Di` pulls
`summary` (required — returns `null` without it), `status`, and `duration_ms`, and renders **one line**:

> `{pr colored by status} {summary}{ · 1.4s}`

`pr` is `⏺` on macOS, `●` elsewhere. The duration clause appears only when `duration_ms` is finite and > 0, and
uses the general duration formatter, not `Ewe`. The optional second line (`taskDelivery`, "· delivered to
Claude as a … result (N chars)") cannot appear here: `cv` passes only `{addMargin:false, param}`, so
`taskDelivery`, `messageId` and `Di`'s own `verbose` are all undefined. Each row gets `marginTop:1`.

**(b) Absorbed thinking blocks** — `Jn` (176915534), called with `isTranscriptMode:true, verbose:true`,
`addMargin:false`, wrapped in a Box with `marginTop:1`. `Jn` renders a **row**:

- gutter: `Box minWidth:2` containing `Text dim italic aria-label="thinking:"` with `HVe` = **`∴`** (U+2234);
- body: `Box column flexGrow:1`. Because `b1 = isTranscriptMode||verbose` is true here, the body is
  `e(Bi,{dimColor:true, children: hd(thinking).trim()})` — i.e. the **full multi-line thinking text rendered as
  markdown**, dim, *not* italic. (The non-expanded form, which never occurs inside a cluster, is a single
  `Text dim italic` with `.replace(/\s+/g," ")` collapsing it to one line.)
- `hd` (156482146) is a tag-stripper: `if(!n.includes(u))return n; return n.replace(a,"")`. If it yields
  nothing the whole block renders `null`.

So: **full body, markdown, `∴` gutter, dim — and no duration clause.** The `thoughtForMs` clock exists
(`XP`, 177050400 region; cap `KHt = 600000` at 162006856) but is spoken only by the collapsed summary row.

**(c) The PreToolUse hook block** — a fragment of dim Text lines, no wrapping Box, no `marginTop`:

```
  ⎿  Ran 3 PreToolUse hooks (0.4s)
     ⎿ ./scripts/guard.sh (0.2s)
     ⎿ ./scripts/lint.sh (0.1s)
```

Header gutter is `"  ⎿  "` (two spaces, glyph, two spaces); each per-hook line is `"     ⎿ "` (five spaces,
glyph, one space) then `hookInfo.command`. Both durations use `Ewe` = one-decimal seconds (`0.4s`). Singular
`hook` / plural `hooks` on `hookCount`. Rendered only when `hookInfos` is a non-empty array.

Note the collapsed branch has *two* competing hook presentations (177050030 region): if the clause list is
otherwise empty it emits a `"ran N PreToolUse hooks (0.4s)"` **clause** inside the summary sentence
(`lM` = `Qt.length===0 && hookTotalMs>0`); otherwise it appends a standalone `  ⎿  Ran N PreToolUse hooks (…)`
line under the row. The expanded branch always uses the block form above and additionally lists each hook
command, which the collapsed forms never do.

**(d) Relevant memories** — one column per memory, `marginTop:1`:

```
  ⎿  Recalled coding-style.md
     <full memory body, wrapped>
```

Header is `"  ⎿  " + "Recalled " + basename(path)` (dim). The body is the raw `memory.content` inside
`paddingLeft:5` — note `Text > Wr > content`, i.e. a plain text wrapper, **not** markdown, and **not** dimmed.
Keyed by `path`. No truncation, no `+N more`, no cap — unlike the collapsed `xi` rows, which cap at
`Rx = 5` (`var Km=5,Rx=5;` at 176973177) and append `  ⎿  +N more (ctrl+o to expand)`.

Also note the asymmetry: the collapsed branch renders `l.memoryOps` (reads **and** writes: "Recalled …" /
"Remembered …", label resolved through `X3e`), while the expanded branch renders `l.relevantMemories` only
(recall attachments, with bodies). They are different data.

**(e) Member tool rows** — `QP` (177033830) delegating to `bR` (177035324), the ordinary tool-row component,
given the cluster's `tools`, `lookups`, `inProgressToolUseIDs`, `shouldAnimate` and `theme`. Running / errored /
interrupted state and the tool result all come from `lookups`, so a member renders exactly as it would have
outside the cluster. `bR` returns `null` for a tool that is a transparent wrapper or that the tool registry
does not know.

### 1.4 Order

The children array is fixed and the two `map`s do **not** interleave with each other:

1. every `<task-notification>` user row, in message order;
2. every assistant thinking block **and** tool-member row, interleaved in message order (they come from the
   same `pe` list — `pe` is `le` filtered to assistant messages, with `grouped_tool_use` flattened in place);
3. the hook block;
4. the relevant-memory blocks.

Within (2) the interleaving is exactly the transcript order of the absorbed assistant messages, so a thinking
block appears immediately before the tool calls it preceded.

### 1.5 What triggers absorption (membership rules)

Two passes build a cluster. Both matter.

**Pass 1 — `v2n` (162017418), always runs.** It walks the message list with an open accumulator `u` (fresh from
`pMe()`, 162013885) and flushes it into a `collapsed_read_search` item via `L9n` (162014490). Per message `R`:

- `P9n(R)` (162011786) — assistant whose `content[0].type==="tool_use"`, or a `grouped_tool_use` whose first
  member is one. Classified by `k9n`, counted into the accumulator (read / search / list / mcp / bash / memory
  read+write / workshop / scratchpad / …), its ids added to `u.toolUseIds`, and **`R` pushed into `u.messages`**.
  These become the member tool rows.
- `Oxt(R, u.toolUseIds)` (162011973) — a user message whose `tool_result` blocks are all for tool uses in this
  run. Pushed into `u.messages` (it carries no text block, so the `<task-notification>` filter skips it).
- `R9n(R)` (162011626) — **the thinking rule.** An assistant message whose `content[0].type==="thinking"` with
  non-blank `thinking`. Unless `J3e(R)` (162010927 — a *signed* thinking block that a predicate `xxt` accepts,
  which flushes the run and renders standalone), the message is absorbed: `u.messages.push(D.message)`,
  `u.latestThinkingSummary` set from the text, and `u.thoughtForMs += min(now - previousMessageTimestamp,
  600000)`. **So a thinking block belongs to a cluster purely by adjacency** — it is inside the open run, and
  the run has not been flushed by a real user turn, a breaker, or a signed thinking block.
- `E9n(R)` (162011314) — `system` message with `subtype==="stop_hook_summary"` and `hookLabel==="PreToolUse"`,
  and the run is non-empty. Accumulates `hookCount`, `hookTotalMs`, `hookInfos`. **PreToolUse only**; other hook
  labels are not absorbed. (`Vu`, 177188788, merges consecutive same-label hook summaries into one first.)
- `attachment` with `attachment.type==="relevant_memories"`, run non-empty → `u.relevantMemories.push(...)` and
  a mirrored `memoryOps` read entry per memory.
- `Nxt(R)` (162011416) or `fMe(R)` (162011201) — other attachments, other `system` messages, and *unsigned*
  thinking/redacted-thinking — are **parked** in `p` and re-emitted *after* the cluster item, not absorbed.
- Anything else — a real user prompt, a `queued_command` prompt attachment (`bMe`), an assistant text message —
  **flushes** the run and is emitted standalone.

`L9n` only attaches `relevantMemories` / `hookInfos` / `thoughtForMs` / `latestThinkingSummary` when non-empty,
so an expanded cluster's blocks (c) and (d) are frequently absent.

**Pass 2 — `T2n` (162025205), focus mode only.** Gated at the call site (177231000 region) by
`Mt() && (Ae || U) && !isTranscriptMode`. This is the pass that absorbs `<task-notification>` rows. It scans for
a window starting at a `Dxt` message (a user message whose `content[0]` is not a `tool_result`), consumes the
**leading run of consecutive task-notification user messages** `N` via `vxt` (162004270 region — classifies the
notification summary as `bash` for `"Background command "` or `agent` for `Agent "…" finished`), and seeds the
cluster with `Uxt(N[0])` + `messages:[...N]` + `agentCount`/`bashCount`. Later user messages inside the window
are pushed into `ke.messages` too, and adjacent tool clusters are folded in with `U9n` (162022109). The seeded
item is re-uuid'd `brief-${uuid}` and has its hook fields **cleared** (`Ge.hookCount=void 0` etc.).

Consequence for a clone: **content kind (a) is unreachable on the default transcript path.** In non-focus mode
`v2n` flushes on any non-tool_result user message, so `l.messages` can never hold a text-bearing user message.
Kinds (b), (c), (d) and the member rows are reachable on the default path.

### 1.6 The ccx gap, restated

`harness/src/tui/toolRenderer.tsx:963` — `expandedMemberItems(group, anchorId, options, emitted)` — walks
`group.memberIds` only, looks each id up in `options.toolEvents`, and re-renders it in `detail-all` mode. It
emits nothing else. `groupItems` (line ~1006) delegates to it and returns, so ccx already matches canon's
"expansion replaces the summary row" shape — that part is right and should not be changed.

What is missing, in descending order of value:

1. **Absorbed thinking bodies.** `harness/src/tui/toolFold.ts:271` keeps a `neutral` atom carrying
   `thoughtForMs` and `thinkingSummary` (a *string*), and `toolFold.ts:429` folds those into `GroupCounts` —
   but the group never retains the thinking messages themselves, so there is nothing to render. Canon keeps the
   whole assistant message in `messages` and re-renders `param` through the thinking component. Closing this
   needs `FoldGroup` to carry the absorbed thinking blocks (id + text), not just the latest summary string, and
   an expansion that interleaves them with the members by sequence.
2. **The PreToolUse hook block.** No `hookInfos` / `hookCount` / `hookTotalMs` on `FoldGroup` at all; the
   segmenter has no `stop_hook_summary` arm.
3. **Relevant memories.** No `relevant_memories` attachment handling anywhere in the fold path.
4. **`<task-notification>` rows.** Focus-mode-only in canon; ccx has no focus mode, so this is correctly out of
   scope unless bl6 also builds `T2n`.

Interleaving note for whoever implements (1): canon's order is `le`-order within `pe`, i.e. transcript order of
the absorbed assistant messages, which is *not* the same as ccx's `group.memberIds` order (`toolRenderer.tsx`
comments note `memberIds` reorders as members settle, and `anchorId` is the earliest-issued call). Reproducing
canon means ordering the expansion by message sequence, not by `memberIds`.

---

## Q2 — D8 clickable rows

### 2.1 One predicate governs all three

`isItemClickable`, at **177230933** (whole function, verbatim):

```js
Ce=B((U)=>{
  if(U.type==="collapsed_read_search")return!0;
  if(U.type==="attachment"){
    if(K||J)return!1;
    return U.attachment?.type==="goal_status"&&!!U.attachment.reason
  }
  if(U.type==="assistant"){
    if(K||J)return!1;
    let et=U.message.content[0];
    return et!=null&&et.type==="advisor_tool_result"&&et.content?.type==="advisor_result"&&(!Fie(et)||X6e(et)!==void 0)
  }
  if(U.type!=="user")return!1;
  let ue=U.message.content[0];
  if(ue?.type!=="tool_result")return!1;
  if(ue.is_error)return oxn(ue.content);
  if(!U.toolUseResult)return!1;
  let ke=rt.toolUseByToolUseID.get(ue.tool_use_id)?.name,
      Be=ke?Zr(l,ke)??_pe(ke,ve):void 0;
  return (Be?Vp(Be,"isResultTruncated")?.(U.toolUseResult,{columns:le}):void 0)??!1
},[l,K,J,ve,rt,le]);
```

`K` = global verbose, `J` = transcript mode. Note the asymmetry: a **collapsed cluster is clickable even in
verbose/transcript mode**; `goal_status` and advisor rows are clickable **only** outside them (there is nothing
left to reveal once everything is already expanded).

### 2.2 What a click does

```js
[X,Z]=u(()=>new Set),
Se=B((U)=>{let ue=ed(U); Z((ke)=>{let Be=new Set(ke); if(Be.has(ue))Be.delete(ue); else Be.add(ue); return Be})},[]),   // 177230769
de=B((U)=>X.size>0&&X.has(ed(U)),[X]),                                                                                  // 177230882
```

wired at **177233504** as `onItemClick:Se, isItemClickable:Ce, isItemExpanded:de` on the virtualized list, and
consumed at **177232259** as `verbose: K||de(U)` on every row. `ed(i)` (**177233795**) keys on
`X9(i) ?? i.uuid`.

**So a click is a pure in-place expand/collapse toggle.** It never opens a file, a pager, or an overlay. It is
the same `verbose` signal `ctrl+o` supplies, scoped to one row. The state is a `Set` of row keys held by the
transcript component, and it is *not* persisted.

### 2.3 The three shapes

**(i) `collapsed_read_search`** — clickable unconditionally; the expanded rendering is §1.2 above.

**(ii) `goal_status` attachment with a truthy `reason`** — renderer at **177022429**, expanded part at
**177023934**. `no` is the verbose/expanded flag. Structure (Box column, `marginTop:1`):

```
{status icon} Goal achieved (1m 20s · 4 turns · 12.4k tokens)  (ctrl+o to expand)
  {reason}                      ← only when failed===true, shown collapsed AND expanded
  Goal: {condition}             ← expanded only
  Reason: {reason}              ← expanded only, and only when NOT failed
```

- `attachment.sentinel === true` renders `null`.
- Title: `failed===true` → `"Goal could not be achieved"` in `error` color; `met` → `"Goal achieved"`;
  otherwise `"Goal not yet met… continuing"`, dimmed.
- Status icon: `error` / `success` / `pending` respectively, `withSpace:true`.
- The parenthetical is built only when `met || failed`, joining whichever of `durationMs` (most-significant-unit
  format), `iterations` (`"N turns"`), `tokens` (`"N tokens"`) are defined, with `" · "`.
- The `(ctrl+o to expand)` hint (`hc`) is appended only when **not** expanded.
- The three detail lines all use `paddingLeft:2`, dim, `wrap:"wrap"`.

**(iii) advisor results** — renderer `nm` at **176899558**; the `advisor_result` case at **176901707**.
Two clickable shapes:

- *Declined* (`Fie(block)` true, 176901010 region): collapsed → `Text color:"warning"` `"Advisor declined to
  advise on this request"` plus `" " + hc` when a reason exists (`X6e(block) !== undefined`). Expanded → the
  same line with the reason text as a dim Text on a second row inside a column Box.
- *Result* (`content.type==="advisor_result"`): collapsed → dim
  `"{tick} Advisor has reviewed the conversation and will apply the feedback (ctrl+o to expand)"`. Expanded →
  dim `content.text` (the full advisor text), and nothing else.
- Not clickable, for completeness: `advisor_tool_result_error` renders
  `"Advisor unavailable ({error_code})"` in `error` color; `advisor_redacted_result` renders the same
  reviewed-and-will-apply line **without** the hint; `server_tool_use` renders the live
  `"⏺ Advising using {model} · {input}"` row.
- The whole thing is wrapped in `Box paddingRight:2`.

### 2.4 Verdict: **STABLE-BUILDABLE**

The predicate and the copy are unchanged across all three binaries on disk:

| needle | 2.1.247 | 2.1.248 | 2.1.250 |
|---|---|---|---|
| `"collapsed_read_search")return!0;` | 206838466 | 177223960 | 177230956 |
| `"goal_status"&&!!` | 206838570 | 177224064 | 177231060 |
| `type==="advisor_result"&&(!` | 206838739 | 177224233 | 177231229 |
| `isItemClickable` / `isItemExpanded` | 173080716 / 173080740 | 68179728 / 68179752 | 68179784 / 68179808 |
| `Advisor has reviewed the conversation and will apply the feedback` | 173094428 | 68262380 | 68262436 |
| `Goal could not be achieved` | 173113048 | 68273180 | 68273236 |

The 2.1.247 misses in the first table pass were minifier-local renames (`U` vs another letter), not shape
changes — the identifier-agnostic needles hit in all three. The three-version match is the strongest stability
signal available without more binaries.

Caveats for the round: the advisor path depends on the `advisor_tool_result` content block type, which ccx's
SDK stream may never produce; and `goal_status` depends on the goal/auto-mode subsystem. Both are *stable* but
may be *unreachable* in ccx — worth a reachability check before committing build effort. The
`collapsed_read_search` click is unconditionally reachable and is the one that pays for itself, because it is
the entry point to the Q1 expansion this same round is building.

---

## Q3 — bl5 regression spot-check

### 3a. Link-click gate — **UNCHANGED.**

The scheme allowlist is at **164838427**, byte-identical to bl5's transcription, same 13 entries in the same
order: `new Set(["https:","http:","vscode:","vscode-insiders:","cursor:","windsurf:","zed:","jetbrains:",
"idea:","slack:","linear:","notion:","figma:"])`. The dispatcher `k6e` (**164839267**) still special-cases
`file:` (empty host required, path rejected by two guards, then `open -R --` on macOS / a `dbus-send`
`ShowItems` call otherwise) and still emits the exact warn line
`` `[hyperlink] refusing to dispatch clicked link with non-allowlisted scheme ${o}` `` at **164839478**.
`macCmdClickArrivesWithoutSgrModifierBit()` at **157780577** is unchanged term-for-term:
`this.proc.platform==="darwin"&&(this.proc.env.TERM_PROGRAM==="ghostty"||this.proc.env.TERM_PROGRAM==="WarpTerminal")`.
The release-time gate at **164589955** still reads
`if(S==="unhandled"&&!t.pressIsWindowActivation){ let E=t.props.getHyperlinkAt(c,h); if(E&&a.TERM_PROGRAM!=="vscode"&&!Dd()&&((o.button&24)!==0||pE.macCmdClickArrivesWithoutSgrModifierBit()||cNn())){…setTimeout(…,Cv,t,E)} }`
— the `!Dd()` and `||cNn()` terms are the vscode/xterm.js and XTVERSION-Ghostty branches bl5 deliberately
parked under plan D5, not new conditions. The timer constant is intact: `var Z0=5000,Cv=500,Mv=1,Tv=400;` at
**164578326**, and `Cv` is used both as the double-click window and as the hyperlink-open `setTimeout` delay,
exactly as bl5 recorded. **No action needed.**

### 3b. Image media-type sniffer — **UNCHANGED.**

`tI` at **158493967**, byte-identical to `sniffImageMediaType` in `harness/src/media/imageDims.ts`:

```js
function tI(e){if(e.length<4)return null;
 if(e[0]===137&&e[1]===80&&e[2]===78&&e[3]===71)return"image/png";
 if(e[0]===255&&e[1]===216&&e[2]===255)return"image/jpeg";
 if(e.length>=6&&e[0]===71&&e[1]===73&&e[2]===70&&e[3]===56&&(e[4]===55||e[4]===57)&&e[5]===97)return"image/gif";
 if(e[0]===82&&e[1]===73&&e[2]===70&&e[3]===70&&e.length>=12&&e[8]===87&&e[9]===69&&e[10]===66&&e[11]===80)return"image/webp";
 return null}
```

The GIF arm is still the `GIF8` + (`7`|`9`) + `a` prefix test with no Logical Screen Descriptor read, and the
WebP arm is still the `RIFF`/`WEBP` fourcc pair with no payload fourcc read — i.e. the derive-not-validate
shape bl5 built to, where a truncated-but-recognizable header still sniffs. The default-applying wrappers are
unchanged too: `QIe(e){return tI(e)??"image/png"}` at **158495177**, and the base64 wrapper `BNt` right after
it, which also falls back to `"image/png"` on a decode throw. The separate dimension reader `kZ`
(**158495308**) remains a distinct function that `tI` does not call. **No action needed.**

---

## Open questions

1. **Reachability of `relevant_memories` and `stop_hook_summary` in the ccx pipeline.** Canon absorbs both from
   the CLI's own message stream. Whether the Agent SDK surfaces a PreToolUse hook summary or a relevant-memories
   attachment to a headless consumer at all is unverified — this needs a live probe before the fix wave commits
   to building blocks (c) and (d). Blocks (b) and the member rows need no such check.
2. **`X9(i)`, the click key.** `ed(i) = X9(i) ?? i.uuid` — I did not chase `X9`. It matters only if ccx wants
   click state to survive a message being re-keyed; the fallback to `uuid` is enough to build against.
3. **`Fie` / `X6e` / `oxn` / `isResultTruncated`.** Located but not read. They gate advisor-declined and
   truncated-tool-result clickability. Only needed if the round builds those two, and the truncated-result arm
   is a fourth clickable kind the ticket did not name.
4. **Whether `thoughtForMs` should still be spoken anywhere in the expanded form.** Canon says no — the clause
   lives only in the collapsed row. If ccx's expansion wants a duration it would be an intentional divergence,
   not a parity fix.
