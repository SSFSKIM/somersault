# J — Persistence formats: 2.1.257 spec vs. the ccx harness

Lane: spec ch. **35 Session persistence** (7,472 ll., read in full for the record-type/field/path
sections; cloud-upload §§35.25 skimmed), **13 §§13.11–13.12** for the on-disk `compact_boundary`,
**A3** for the `~/.claude/**` map. Our side: `harness/src/sessions/`, `harness/src/store/`,
`harness/src/tui/{replay,SessionPicker,ResumeTranscriptView,sessionPickerModel,promptHistory,pasteCache}`,
`harness/src/peer/roster.ts`, `harness/src/config/claudeHome.ts`, `docs/parity/coverage.md` §4 / domain 5,
and the SDK's own reader + `SessionStore` contract in
`harness/node_modules/@anthropic-ai/claude-agent-sdk/{sdk.d.ts,sdk.mjs}` (**0.3.251**).

Verification convention: **verified** = I read it in `~/claude-code-bundle/2.1.257/cli.pretty.js` or in the
installed SDK bundle myself (line cites are into those two files, not the spec's chunk names).
**spec-only** = taken from the spec, not re-checked.

A structural note that shapes everything below. **We never touch the transcript format directly.**
`sessions/reader.ts` is a five-line rename wrapper (`cwd`→`dir`) over the SDK's `listSessions` /
`getSessionMessages` / `getSessionInfo`, and `sessions/storeAudit.ts` deliberately stops at
`<configHome>/projects` without reproducing the slug. So "what canon writes" reaches us only through two
narrow apertures: the SDK's **projection** `pk` and its **filter** `qje`, and — for anyone who plugs in
`store/redisSessionStore.ts` / `postgresSessionStore.ts` — the **raw line stream** into `SessionStore.append()`,
which sees every record type in ch. 35 verbatim. Most of the value below lives on the second aperture, which
we already own and do not read.

---

## 0. Top takeaways

1. **Every non-conversation record is invisible to `getSessionMessages` but fully visible to our own
   `SessionStore` adapters.** 33 of canon's 38 record types (`cost-state`, `permission-mode`,
   `worktree-state`, `last-prompt`, `queue-operation`, `file-history-*`, `tag`, `summary`, …) never reach
   the reader, yet `append()` already hands them to `redisSessionStore.ts` / `postgresSessionStore.ts`
   line-for-line. The two with immediate product value — resume-time **permission-mode restoration** and
   **cost-state carry-over** — are buildable today on a seam we shipped. §2.11, §2.12.
2. **`history.jsonl`: three transcribed behaviours are wrong against 2.1.257** — we scope by launch `cwd`
   where canon scopes by *project root*; we dedup on every read where canon dedups only in the fullscreen
   search reader; and our dedup key is the raw display where canon's also keys on paste identity. All three
   change what the Up-arrow and Ctrl-R walks return. §1.1–§1.4, all verified in the bundle.
3. **`~/.claude/sessions/` is the live-session registry canon uses to refuse a resume**, and we read it
   already (`peer/roster.ts`) — for addressing only. `status`/`waitingFor`/`jobId`/`parkedJobId`/`name` sit
   right there unread, and our own liveness guard (`cli/resolveResume.ts`) only knows *ccx* sessions, so a
   `claude` CLI session live on the same transcript is invisible to us. §2.1.
4. **`listSubagents()` / `getSubagentMessages()` are declared SDK surface we wrap neither**, and the
   `agent-<id>.meta.json` sidecar carries exactly the fields a subagent tree in the resume preview would
   need. Cheapest large win in the lane. §2.5.
5. **The compact boundary is structurally unreachable through `getSessionMessages`.** It is a
   `type:"system"` row, so it needs `includeSystemMessages:true`, and even then the projection keeps only
   `{type,uuid,session_id,message,parent_tool_use_id,parent_agent_id,timestamp}` — `subtype`, `content`,
   `isMeta` and the whole `compactMetadata` are dropped and `message` is `undefined`. Our text-regex route in
   `replay.ts` is therefore the *only* route; `preservedSegment` and `cumulativeDroppedTokens` are permanently
   out of reach from disk. §1.10, verified.
6. **Two slug/path divergences between canon's writer and the SDK's reader**, both ours to live with, one
   platform-fatal: the SDK **realpaths** `dir` before slugging while canon slugs the un-realpathed original
   cwd, and the SDK's NFC normalization of the project path is **darwin-only** while canon's is
   unconditional — so on **Linux with a decomposed non-ASCII path the two derive different project keys** and
   the picker is empty. §3.4, §3.5.
7. **`.session-aliases` is never read by the SDK** (its one mention in `sdk.mjs` is the reserved-name set), so
   `/add-dir` in ccx does not widen `/resume` the way canon's `fetchLogs` does — and we never write the file
   either. §2.3.

---

## 1. Format corrections — fields and record types we parse wrongly or ignore

### 1.1 `history.jsonl` `project` is the project ROOT in canon, the launch cwd in ours — **verified**
- Ours: `tui/useChat.ts:3535` passes `project: cwd`; `tui/promptHistory.ts:94` defaults to `process.cwd()`.
  Readers: `tui/ChatComposer.tsx:165`, `tui/InlineHistorySearch.tsx:89`, `tui/useChat.ts:3549`, all with
  `project: cwd`.
- Canon: the writer stamps `project: I` where `I = mn()`, and `mn()` is
  `g()?.projectRoot ?? n().project.projectRoot` [`cli.pretty.js:243369`]; `projectRoot` is NFC-normalized at
  [`cli.pretty.js:243372`]. Every reader filters `f.project !== mn()` [`cli.pretty.js:47597`, `:47568`,
  `:47581`]. Spec 35.26.1 states it explicitly ("the session's project ROOT (`mn()`) … not the
  `~/.claude/projects` slug").
- Impact: in a monorepo or any repo you enter through a subdirectory, our prompt history fragments per
  subdirectory — a prompt typed in `repo/` is unreachable by Up-arrow from `repo/pkg/a`. Canon shares one
  history across the whole checkout. The fix is one call: derive the git top-level (we already do it in
  `cli/worktree.ts:39`).

### 1.2 We dedup on every history read; canon dedups in exactly one reader — **verified**
- Ours: `promptHistory.ts:readHistory` runs `seen.has(e.display)` unconditionally for all three scopes.
- Canon, four readers with different rules [`cli.pretty.js:47564`–`:47597`]:
  | reader | consumer | dedups? |
  |---|---|---|
  | `readForProject` | **Up-arrow recall** | **no** |
  | `readEntries` | inline **Ctrl+R** reverse search | **no** |
  | `readTimestamped` | fullscreen "Search prompts" picker | yes, on `Pcn(...)` |
  | `countForProject` | the `History n/m` badge | no |
- Impact: our Up-arrow walk silently collapses legitimate repeats, so "the last three things I ran" is
  compressed to one entry and the 100-slot window covers a much longer stretch of time than canon's.
  Spec 35.26.2 tabulates the same split.

### 1.3 `readForProject` orders current-session entries FIRST, then the project's others — **verified**
`cli.pretty.js:47597-47613`: the walk yields matching-`sessionId` entries as it finds them and *buffers*
the project's other sessions, flushing them after; the `K8e = 100` cap counts both groups together. Ours is
plain reverse-chronological across the whole file. Impact: on a machine with many concurrent sessions in one
project, canon's Up-arrow shows *your* prompts first; ours interleaves everyone's.

### 1.4 The dedup key is paste-aware in canon, raw text in ours — **verified**
`Pcn(display, pastedContents)` [`cli.pretty.js:47367-47384`] rewrites every `#<id>` placeholder to `#_`, then
appends `\x00` and a `\x01`-joined identity list per paste — `hash:<contentHash>` / `inline:<content>` /
`dead` (unavailable) / `literal:<id>` (no record). Two consequences we get backwards in both directions:
prompts differing only in paste *id numbering* are one entry in canon and two in ours; prompts with identical
display text but *different paste bodies* are two entries in canon and one in ours (the second body is lost
from recall).

### 1.5 We persist pastes canon drops — **spec-only** (schema read; filter not re-derived)
Canon's `u3t` [spec 35.26.1, `cli.pretty.js:47414-47419`] keeps only pastes that are `type === "text"`,
**not `unavailable`**, *and still referenced by a placeholder in `display`*. `promptHistory.ts:appendHistory`
filters on `p.type !== "text"` only, so a paste whose chip the user deleted before submitting is still written
to `history.jsonl` and (if >1024 chars) to the paste cache. Cost is bytes, not correctness.

### 1.6 `timestamp` is strictly monotonic per process in canon — **spec-only**
Spec 35.26.1: `Math.max(Date.now(), lastAssigned + 1)`. It is load-bearing because `removeLast`'s
already-flushed skip set keys on `` `${timestamp}\0${sessionId}` `` (35.26.3). Ours writes bare `Date.now()`
(`promptHistory.ts:110`), so two prompts inside one millisecond in the same session are indistinguishable. We
have no `removeLast`, so today this costs nothing — record it against the day we add turn-cancel retraction.

### 1.7 The picker's description line is missing `fileSize` and `tag`, which we DO have — **verified**
- Ours: `tui/sessionPickerModel.ts:47` `sessionMeta` = `<relative> · <gitBranch>`, with a header comment
  asserting "`listSessions` gives us neither a count nor (reliably) a size".
- That is falsified by the installed SDK: the file-backed row builder returns
  `{sessionId, summary, lastModified, fileSize, customTitle, firstPrompt, gitBranch, cwd, tag, createdAt}`
  — `fileSize` populated from the head/tail read's `totalBytes`, `tag` read by scanning the tail for the last
  `"type":"tag"` line. `sdk.d.ts:4863-4903` declares both (`fileSize` "Only populated for local JSONL
  storage"; `tag` "User-set session tag"). Only the *store-backed* summary path leaves `fileSize: void 0`.
- Canon's `jet` [spec 35.19.7]: `<relative> · [bg] · <branch> · <bytes> · #<tag> · @<agentSetting> ·
  <repo>#<pr>`, joined ` · `, and **because list rows always carry `fileSize` the row shows a byte size, not
  a message count**. Byte formatter: `<n> bytes` / `<n.n>KB` / `MB` / `GB` with a trailing `.0` stripped.
- Impact: two of canon's seven clauses are free to us and unrendered. Note the *preview footer* correctly
  shows a message count (that is a different composer, and ours matches — §5).

### 1.8 `SessionInfo` under-declares what `listSessions` actually returns
`tui/useChat.ts:117` declares `{sessionId, summary, firstPrompt?, lastModified, cwd?}`, and
`readSessions` casts the SDK rows with `as Promise<SessionInfo[]>` (`useChat.ts:780`). The cast strips
nothing at runtime, so `sessionPickerModel.SessionRow`'s `customTitle`/`gitBranch` do resolve — but `tag`,
`fileSize` and `createdAt` are invisible to every typed consumer. Widening `SessionInfo` is a no-risk
prerequisite for §1.7.

### 1.9 Picker title priority is shorter than canon's — **spec-only**, low impact
Canon `$ke` [spec 35.19.7]: `agentName → customTitle → aiTitle → summary → firstPrompt → caller fallback →
"Autonomous session" → sessionId.slice(0,8)`, with XML-ish blocks stripped by
`/<([a-z][\w-]*)(?:\s[^>]*)?>[\s\S]*?<\/\1>\n?/g`. Ours (`sessionPickerModel.ts:39`) is
`customTitle || summary || firstPrompt.split("\n")[0] || fallback || id8`. In practice the SDK folds
`aiTitle` into `summary` (see §5), so the two real gaps are `agentName` (never surfaced by the SDK at all)
and the `"Autonomous session"` fallback. Related: canon's `kir` substitutes the literal `"(session)"` when
none of `firstPrompt`/`customTitle`/`aiTitle` is set [spec 35.14.3 rule 5]; **the SDK instead returns `null`
and the row disappears from the list entirely** (`if(!h)return null` in the file-backed builder,
`if(!s)return null` in the store-backed one) — a session whose only user text is a proactive/XML wrapper is
listed by canon and absent from our picker. Verified in `sdk.mjs`.

### 1.10 `compact_boundary` cannot carry its metadata to us — **verified**
The projection is one function, applied to every row regardless of type:
```js
pk(e,t,n){return{type:e.type,uuid:e.uuid,session_id:e.sessionId,message:e.message,
                 parent_tool_use_id:t??null,parent_agent_id:n??null,timestamp:e.timestamp}}
```
(`sdk.mjs`, and `sdk.d.ts:5312` `SessionMessage`). The boundary's on-disk shape is
`{type:"system", subtype:"compact_boundary", content:"Conversation compacted", isMeta:false, level:"info",
uuid, timestamp, logicalParentUuid?, compactMetadata:{…}}` [spec 13.11.1, `cli.pretty.js:154433`] — it has
**no `message` field**, so with `includeSystemMessages:true` it arrives as
`{type:"system", uuid, session_id, message: undefined, …}`. Every discriminant is gone.
Consequences to record rather than fix:
- `replay.ts`'s `compact_summary` divider (driven by `COMPACT_SUMMARY_RE` over the post-compact **user**
  text) is the only reachable route. Correct by construction, not by choice.
- We can never distinguish a **preserving** boundary (`compactMetadata.preservedSegment` /
  `preservedMessages`) from a **truncating** one, which is the difference canon uses to decide how much of a
  transcript to keep on resume [spec 13.11.6, threshold `SKIP_PRECOMPACT_THRESHOLD = 5 MiB`].
- `cumulativeDroppedTokens` — the number a faithful `/context` and compaction bar would want across
  multiple compactions — is unreachable from disk. It IS reachable on the live wire as
  `compact_metadata.cumulative_dropped_tokens` in the `system/compact_boundary` stream frame
  [spec 13.11.4]; check whether our live path reads it.

### 1.11 Persisted `"No response requested."` synthetic assistants render as real replies — **verified**
Canon appends a synthetic assistant whose `message.model` is `Jc = "<synthetic>"` and whose text is
`TR = "No response requested."` [`cli.pretty.js:183100`] whenever a loaded transcript's last
non-`system`/`progress` record is a user message [spec 35.18 step 13]; the strip-back-off pass `Xgo`
[`cli.pretty.js:83467`] runs only under `CLAUDE_CODE_RESUME_TOLERATES_CONTEXT_APPENDS`, so these lines
accumulate on disk. `sessions/rows.ts:69` already knows the `<synthetic>` marker and
`tui/toolRenderer.tsx:1402` treats the text as a fold sentinel — but `tui/replay.ts` consults neither: it
`appendSdk("disk", m)`s every non-prompt row, so the /resume preview and a resumed transcript paint
"No response requested." as an assistant turn. Same for the companion meta user prompt
`Gbn = "Continue from where you left off."` (`CLAUDE_CODE_RESUME_PROMPT` overrides it) — though that one
carries `isMeta:true` and is dropped by the SDK filter before we see it.

### 1.12 `--resume <arg>` accepts a session **title** in canon; ours has no title arm — **spec-only**
Canon interactive dispatch [spec 35.16.4]: UUID → absolute `.jsonl` path (`isAbsolute && endsWith(".jsonl")`)
→ **exact `customTitle`/`aiTitle` match** via `searchSessionsByCustomTitle(value, {exact:true})` → picker
seeded with the string. Print mode reorders it and drops the `isAbsolute` requirement. `cli/resolveResume.ts`
does exact id → unique UUID prefix → fleet short id → `unknown`. We have `renameSession` wired to the picker
(Ctrl+R), so users can *set* titles they then cannot resume by. Cheap: our listing already carries
`customTitle`. Also absent: the `.jsonl` path arm, `--session-id <uuid>`, `--fork-session`,
`--resume-session-at`, `--rewind-files` (we have the rewind mechanism, not the flag).

### 1.13 `~/.claude/sessions/<pid>.json`: canon takes `pid` from the **filename**, we take it from the body
`peer/roster.ts:52` skips any row whose body lacks a numeric `pid`; spec 35.27.1 says canon derives it from
the filename. The 2.1.257 writer does write `pid: process.pid` into the body
[`cli.pretty.js:675328`], so nothing breaks today — but a record written by a future/foreign build that
omits it becomes invisible to our roster and visible to canon's. One-line hardening: `Number(name.slice(0,-5))`
as the fallback. Also unenforced: canon caps a record read at `Ol = 262144` bytes.

---

## 2. Unmodeled records and artefacts

Ranked by what they would buy the resume picker, replay, or the observability read API.

### 2.1 `~/.claude/sessions/` — the live-session registry, read for addressing only
We already parse it (`peer/roster.ts:38-72`) and model 10 fields. Spec 35.27.1's `SessionRecord` has ~30,
and the ones we drop are the interesting ones: `status` (`busy`|`shell`|`idle`|`waiting`), `waitingFor`
(`input needed` | `worker request` | `sandbox request` | `dialog open` | `goal proposal` |
`permission prompt` — the last being the fallback for any dialog kind), `state`/`detail`/`tempo`/`needs`,
`jobId`, `parkedJobId`, `startedAt`, `nameSource`/`nameSince`/`formerNames`, `bridgeSessionId`, `spare`.
What canon *does* with them (spec 35.27.1): `--resume <id>` and `-p --resume <id>` **refuse outright** when a
non-`interactive` holder is live (unless `--fork-session`); the picker swaps in a host screen; `--continue`
skips live candidates and **stops the whole search** at a session handed off to a live background session.
`cli/resolveResume.ts:liveRowFor` does the analogous thing off our *own* fleet roster, which knows nothing
about `claude` CLI processes — so ccx will happily start a second engine over a transcript a CLI session is
writing. Reachability: **plain local file reads, no SDK dependency.** Directory is never swept by
`cleanupPeriodDays`; reaping is by pid liveness only.

### 2.2 Subagent transcripts and their metadata sidecar
Layout `projects/<key>/<sessionId>/subagents/agent-<agentId>.jsonl` plus
`agent-<agentId>.meta.json`; listing is `readdir` filtered on `startsWith("agent-") && endsWith(".jsonl")`
with the id recovered as `name.slice(6,-6)` [spec 35.11]. Confirmed present in the live tree.
`agent-<id>.meta.json` (spec 35.11.1) carries `agentType` (required), `model`, `permissionMode`,
`description`, `name`, `color`, `spawnMode`, `spawnDepth`, `parentAgentId`, `toolUseId`, `taskKind`,
`teamName`, `worktreePath`/`worktreeBranch`/`cwd`, `isFork`, `isBuiltIn`, `stoppedByUser`,
`planModeRequired`, `customAgentType`, and the four observer fields preserved across a partial patch
(`YEt = ["isObserver","observerStopped","observerTaskId","armingPermissionMode"]`).
**The SDK already exposes `listSubagents(sessionId, {dir})` and `getSubagentMessages(sessionId, agentId,
{dir})`** (`sdk.d.ts:833`, `:1046`) plus `SessionStore.listSubkeys`. We wrap neither, and
`grep -rn "listSubagents\|getSubagentMessages" harness/src` returns nothing. This is the cheapest large
addition in the lane: a subagent tree in the resume preview, and subagent transcripts in the observability
read API, on declared surface.

### 2.3 `.session-aliases` — `/add-dir`'s effect on `/resume`, entirely absent
`projects/<projectKeyOf(addedDir)>/.session-aliases` is a newline-terminated, dedup-by-exact-line list of
absolute *project-directory* paths, mode `0o600`, parents `0o700`. Its **only** writer is the `/add-dir`
handler, which realpaths the added directory and appends the *current* session's project directory
[spec 35.2.5]. Canon's `fetchLogs` reads it and appends every alias project's sessions tagged
`isAlias: true` — each alias listed with the caller's own limit, then deduped by `sessionId` (newest wins)
and re-truncated [spec 35.14.4 steps 2/5/6]. **The SDK never reads it**: its single occurrence in `sdk.mjs`
is the reserved-name set `Sq`. Verified. We ship `/add-dir` (`tui/AddDirDialog.tsx`, `tui/addDir.ts`) and
neither write the alias nor widen by it, so ccx's `/resume` is strictly narrower than canon's after an
`/add-dir`. Reachability: pure local FS.

### 2.4 `~/.claude/session-env/<sessionId>/<event>-hook-<n>.sh`
Present in the live tree. Names validated by
`/^(setup|sessionstart|cwdchanged|filechanged)-hook-(\d+)\.sh$/` with event order
`{setup:0, sessionstart:1, cwdchanged:2, filechanged:3}` [spec 35.27.2]. **The hook authors the content**,
not the harness — the directory path is handed to the hook process as `$CLAUDE_ENV_FILE` (PowerShell hooks
do not get it). The reader takes an ambient `CLAUDE_ENV_FILE` first, then every matching file sorted by
event order then numeric index, trims each, joins with newlines, caches per session, and **prepends the
result to the persistent Bash shell's init**. Cache invalidated after an async `SessionStart` hook, after any
`CwdChanged`/`FileChanged` batch, and after the shell reports a cwd change. The harness's one write is the
empty string: `filechanged-*` and `cwdchanged-*` are **truncated (not unlinked)** before a `CwdChanged` batch;
`setup-*`/`sessionstart-*` never are. Whole `<sessionId>/` directories are swept by `cleanupPeriodDays`.
We have hooks and a bash tool and implement none of this. Reachability: our own hook runner + local FS.

### 2.5 `cost-state` — a full per-session usage ledger we already receive and discard
`{type:"cost-state", sessionId, totalCostUSD, totalAPIDuration, totalAPIDurationWithoutRetries,
totalToolDuration, totalLinesAdded, totalLinesRemoved, totalDuration, startTime,
modelUsage: Record<model,{inputTokens,outputTokens,thinkingTokens?,cacheReadInputTokens,
cacheCreationInputTokens,webSearchRequests,costUSD}>, hasUnknownModelCost?}` — every numeric field
`nonnegative().finite()`, the `modelUsage` key constrained to `/^[^\p{Cc}\p{Cf}]+$/u` [spec 35.5.8]. Canon
reads it back on resume, which is why `/cost` in a resumed session is accurate; ours restarts at zero.
Unreachable through `getSessionMessages` (`always`-policy sidecar, not a conversation type) but it lands in
`SessionStore.append()` today — `store/postgresSessionStore.ts` and `redisSessionStore.ts` store it opaquely.

### 2.6 `permission-mode`, `mode`, `worktree-state` — resume-time state canon restores and we don't
`{type:"permission-mode", permissionMode, sessionId}`, `{type:"mode", mode: "normal"|"coordinator",
sessionId}`, and `{type:"worktree-state", sessionId, worktreeSession: null | {originalCwd,
preEnterOriginalCwd?, worktreePath, worktreeName?, worktreeBranch?, originalBranch?, originalHeadCommit?,
sessionId, tmuxSessionName?, hookBased?, enteredExisting?}}` [spec 35.5.4]. Note the writer detail: `mode`
and `permission-mode` are set **in memory only** and reach disk solely via the metadata re-append (35.7), so a
store adapter sees them late, not on the mode change. Canon restores worktree (35.17.3), permission mode
(35.17.4) and model (35.17.5) on resume. Ours restores none. `worktree-state` matters for us specifically —
`cli/worktree.ts` mints worktrees and `cli/main.ts:310` points `config.cwd` at them.

### 2.7 `last-prompt` — the leaf checkpoint, including the rewind marker
`{type:"last-prompt", lastPrompt?, leafUuid?: string|null, explicit?: true, rewound?: true, sessionId}`
[spec 35.5.2]. `lastPrompt` is normalized (newlines→spaces, trimmed, ≤200 chars + `…`).
`leafUuid: null` **with** `explicit: true` means "cleared to empty". `rewound: true` is produced only by the
`rewind_conversation` control request. The SDK's summary fold *does* read `lastPrompt` (it is in the fold's
field map `{customTitle, aiTitle, lastPrompt, summary→summaryHint, gitBranch}`) and the file path uses it as
a title source — but the **leaf pointer** is invisible to us. Relevant to `tui/RewindPicker.tsx`: canon
records a rewind so a later resume lands on the rewound leaf rather than the file tail; our rewind is
in-place and `sessions/rows.ts:diskStampOf` compensates with a count/last-uuid fingerprint. Worth writing
down as a deliberate design difference rather than an oversight.

### 2.8 `queue-operation` — the prompt queue, persisted
`{type:"queue-operation", operation, timestamp, sessionId, content?, reason?}` with `operation` a **closed
producer enumeration** `enqueue | dequeue | remove | popAll | popOne`; `content` only when the item's value
is a string; `reason` only on `remove`; **every emission gated on `!item.unlogged`** [spec 35.5.9]. We have a
live queue (`ChatState.queue`) that dies with the process. A store adapter could reconstruct queue state
across a crash. Reachability: `append()` only.

### 2.9 `tool-results/` spill files
`projects/<key>/<sessionId>/tool-results/<id>.txt` and `tool-results/pdf-<n>/page-*.jpg` — confirmed present
in the live tree. One property worth pinning: the directory is keyed on the session's **original** cwd
(`RS(e) = join(projectDirOf(root.project.originalCwd), root.id, "tool-results")`), so **it does not follow a
relocation the way the transcript does** [spec 35.10]. A transcript that moved leaves its spill files behind.
The pointer's shape lives in ch. 12 (out of my lane); the reference itself sits inside `message.content`,
which `getSessionMessages` **does** return, so a resolver is buildable — flag for a ch. 12 cross-read.

### 2.10 The `prompt_snapshot` attachment — new in 2.1.257
`A5.11` records `--system-prompt-snapshot <on|off>` and the SDK option `systemPromptSnapshot` as
**new in 2.1.257 (zero hits for `prompt_snapshot` in 2.1.251)**: the conversation's system prompt is recorded
once as a transcript `attachment` and reused verbatim on every later request *and resume*. Default on for the
built-in prompt; `--system-prompt`/`--append-system-prompt` turn it off. `grep systemPromptSnapshot` over
`harness/src` and `sdk.d.ts` returns nothing — our SDK (0.3.251) does not declare it. **Recheck at the next
SDK bump**: it changes what a resumed session sends and adds an `attachment` record type (which the SDK
reader filters out anyway).

### 2.11 The remaining `always`-policy sidecars, for completeness
`summary` (read-only in 2.1.257; keyed by `leafUuid`, no writer found), `custom-title`, `ai-title`, `tag`,
`relocated`, `ended-by-model`, `continued-in`, `history-suppression`, `agent-name`, `agent-color`,
`agent-setting`, `isolation-latch`, `atis-latch` (validated on read against `/^[\x21-\x7e]*$/`, `""` =
unlatched), `pr-link`, `frame-link`, `bridge-session`, `file-history-snapshot`, `file-history-delta`,
`attribution-snapshot`, `artifact-comment-monitor`, `artifact-autoreact-ledger`, `marble-origami-{commit,
snapshot,reset}`; plus the three `route-by-agent` types `content-replacement`, `fork-context-ref`,
`observer-ref`. Six of them carry **no `sessionId`** (`file-history-snapshot`, `file-history-delta`,
`attribution-snapshot`, `summary`, `fork-context-ref`, `observer-ref`) — a store adapter that keyed on a
record's own `sessionId` rather than on the `SessionKey` would drop them. Ours key on `SessionKey`; correct.
Two are **merged, not last-wins** on load (`artifact-comment-monitor` per-artifact; `artifact-autoreact-ledger`
folded and capped at 64 artifacts), and the autoreact ledger is the only type canon recognizes **by byte
prefix** before parsing so a torn line can still be attributed. None of this affects us until we build a GC.

### 2.12 Retention: nothing sweeps `~/.claude/ccx/`
Canon's `cleanupPeriodDays` (default **30**, minimum 1, **`0` disables the entire sweep**, and a per-sweep
`maxAgeDays` can only shorten it) covers 34 targets including `projects/**`, `file-history/<sessionId>/`,
`session-env/<sessionId>/`, `paste-cache/*.txt`, `backups/*`, `tasks/`, `uploads/`, `plans/` [spec 35.24.7].
Age is **mtime only**. The sweep is a **one-shot per process** armed at the first user prompt (interactive) or
right after MCP connect (`--print`), with a 5 s first tick, a 60 s user-activity guard rescheduling by 10 min,
and a `.last-cleanup` sentinel that is a **one-tick deferral, not a daily gate**. `~/.claude/sessions/` is in
no sweep list. Our own fleet root (`~/.claude/ccx/`: `roster/`, `run/`, `history.jsonl`, `paste-cache/`) is
under `~/.claude` but is not a canon path, so **nothing sweeps it, including us** — and our paste cache has,
by its own header (`tui/pasteCache.ts`), no LRU and no size cap. `sdk.d.ts:5387` puts store retention on the
adapter ("implement TTL, S3 lifecycle policies, or scheduled cleanup"); neither `redisSessionStore.ts` nor
`postgresSessionStore.ts` ships one, and `coverage.md` §4 does not track it. Two separate unbounded-growth
items.

### 2.13 `~/.claude/history.jsonl` as a cross-tool read (product decision, not a bug)
Our `history.jsonl` lives at `~/.claude/ccx/history.jsonl` by `promptHistory.ts` divergence #1, and our paste
cache at `~/.claude/ccx/paste-cache/` — both deliberate, both correct as *write* targets. What is unexploited
is the **read**: canon's file is global and not per-project, so everything typed into `claude` is one
`readHistory` away from ccx's Ctrl+R. The paste bodies resolve too (same content-addressing:
`sha256(content).hex.slice(0,16)` + `.txt`, flat, `<configHome>/paste-cache/`). Cost is one extra reader and
a merge; the hard rule stays "read only, never write there". Note the record shapes are already compatible —
canon's `StoredPaste` allows `type: "text" | "image"` but only ever writes `text`, same as ours.

---

## 3. Slug and path rules

### 3.1 The algorithm — **verified in both bundles, byte-identical**
```js
var IL = 200;                                   // cli.pretty.js:351858
function k(e){ return e.replace(/[^a-zA-Z0-9]/g, "-"); }
function KA(e){ let n = k(e); if (n.length <= IL) return n;
                return `${n.slice(0,IL)}-${Math.abs(qq(e)).toString(36)}`; }
function qq(t){ let e=0; for (let r=0;r<t.length;r++) e=(e<<5)-e+t.charCodeAt(r)|0; return e; }
```
[`cli.pretty.js:351858-351870`, `:577523-577529`]. The SDK ships the same functions under
`ks = 200` / `Eu` / `Yf` / `RFe` / `mA` (`sdk.mjs`). Three properties a re-implementer gets wrong:
the hash is over the **original** path, not the substituted one; there is **no lower-casing** and **no run
collapsing** (`/Users/x/a.b` → `-Users-x-a-b`, `/` → `-`); the truncation joiner is a literal `-`.
Confirmed against the live tree: `~/.claude/projects/` contains an entry named exactly `-` (632 entries).
**Our verdict: we correctly do not implement this.** `sessions/storeAudit.ts:sessionStoreRoot` stops at
`join(claudeConfigDir(env), "projects")` with an explicit comment refusing to reproduce the mangling, and
`sessions/reader.ts` hands `dir` to the SDK. Keep it that way; §3.4/§3.5 are the only reasons to revisit.

### 3.2 Config home — **verified, ours matches exactly**
`(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude")).normalize("NFC")`, memoised on the variable.
`config/claudeHome.ts` is the same expression, `??` (not `||`) included, unconditional NFC included. The SDK's
`Gt` is identical. No action.

### 3.3 `CLAUDE_CODE_PROJECT_DIR_NAME` — **verified, inherited correctly**
Overrides the derived key **only when `CLAUDE_CONFIG_DIR` is also set**; must match
`/^[A-Za-z0-9_-]{1,64}$/`; must not be a Windows reserved device name
(`/^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/i`). The SDK implements it identically
(`r0 = memo(() => Ih() ? jE(n0()) : undefined)`, `eo(dir, env)` re-checks `env.CLAUDE_CONFIG_DIR` for the
store-key path). Canon additionally keeps `Ctt(e)` — the "legacy derived key" — to hunt for transcripts
written before the override existed; the SDK has the same (`sk(e)`). One local note: our
`config/tenantPreset.ts` **exports `CLAUDE_CONFIG_DIR`**, which silently arms this override for any tenant
whose environment also carries `CLAUDE_CODE_PROJECT_DIR_NAME`.

### 3.4 The SDK **realpaths** before slugging; canon does not — **verified, flag not assert**
- Canon derives the key from `ye()` = the session's **original cwd** [`cli.pretty.js:243359`], NFC-normalized
  by `fn()` [`:243372`] but **never realpathed**. Spec 35.2.5 makes the point explicitly: "A nominal-cwd/
  realpath difference on its own — a symlinked project root, say — never produces the file [`.session-aliases`];
  only `/add-dir` does."
- The SDK realpaths on **both** read paths: the file-backed `listSessions({dir})` runs
  `Os(dir) = st(await realpath(dir))`, and the store-key derivation runs
  `DQ(dir) = st(realpathSync(resolve(dir)))` before `Rs()`/`Yf()`.
- So `listSessions({dir})` looks under `slug(realpath(dir))` while the CLI subprocess writes under
  `slug(<the cwd it was spawned with>)`. **Mitigating fact:** `process.cwd()` is already canonical (POSIX
  `getcwd(3)` resolves symlinks), so the common path is safe. **Exposure:** `cli/args.ts:142` accepts an
  explicit `--cwd <v>`, and `cli/main.ts:310` sets `config.cwd = inv.worktreePath` — a
  `.claude/worktrees/<name>` path under a repo reached through a symlink, a macOS `/tmp/...` argument, or a
  bind-mounted checkout would all diverge.
- I did **not** confirm what cwd the SDK hands the spawned CLI, so this is flagged, not asserted. One probe
  settles it: launch under a symlinked cwd, then compare `listSessions({dir})` against `ls ~/.claude/projects`.

### 3.5 NFC normalization is **darwin-only** in the SDK, unconditional in canon — **verified**
`st(e) = process.platform === "darwin" ? e.normalize("NFC") : e` (`sdk.mjs`), applied to both realpath
results above. Canon normalizes `originalCwd`, `projectRoot` and `cwd` unconditionally
[`cli.pretty.js:243372`]. On **Linux** with a decomposed (NFD) non-ASCII path the two derive **different
keys**, and dramatically so, because the slug maps every non-`[A-Za-z0-9]` char to `-`: NFC `é` is one
non-alnum char → `-`, while NFD `e` + U+0301 is `e` + one non-alnum → `e-`. Net: the CLI writes to one project
directory and `listSessions({dir})` reads another; the picker comes back empty and `/resume` finds nothing.
macOS is unaffected (both normalize, and APFS/HFS+ normalize anyway). The config home is *not* affected —
the SDK's `Gt` is unconditional NFC there. Real for a Linux deployment of `ccx`; worth a `docs/parity`
tech-debt row even if we never ship Linux.

### 3.6 Trailing slash, non-existent dirs, Windows drive letters — no action
Both SDK read paths run `resolve`/`realpath` first, which strips a trailing separator, so `{dir:"/a/b/"}`
and `{dir:"/a/b"}` agree; when `realpathSync` throws (dir gone) `DQ` keeps the `resolve`d path, still
separator-free. Windows: `C:\Users\x` → `C--Users-x`, no lower-casing anywhere in the key itself. Canon is
internally inconsistent on case by design — the overlength-prefix scan `Mb` folds no case (`c = !1`) while
the picker-time collision guard `Lse()` returns `true` unconditionally, making that comparison
case-insensitive [spec 35.2.4]. Nothing for us to build.

### 3.7 Reserved names a session-id validator must refuse — worth pinning if we ever validate
Directory-level: `memory`, `tiny_memory`, `bagel`, `cloud-snapshots`, `bridge-pointer.json`,
`.session-aliases`. Suffixes naming a session's project-level siblings: `.ccr-tip.json`, `.precompact.json`,
`.cast`, and `.dir-sync.json`. A path segment is valid when it is a non-empty string, not made only of dots
and spaces, free of `/` `\` NUL, and not a "set-aside" name — and the set-aside test is **not** a raw match of
`/^\.[0-9a-f]{16}\.aside$/`: it lower-cases, strips trailing dots and spaces, and additionally tests the
pre-colon spelling, so `.0123456789ABCDEF.aside`, `.…aside.`, `.…aside ` and `.…aside:stream` are all
rejected [spec 35.1.3]. `sessions/storeAudit.ts` filters only on `.jsonl`, which is harmless (it audits
readability, not identity), but any future id validator needs the list.

### 3.8 The overlength-collision mechanism does work through the SDK
Paths whose substituted form exceeds 200 chars share a prefix. Canon's `findProjectDirs` scans `projects/`
for names starting with `slug.slice(0,200) + "-"` and verifies each candidate by reading its transcripts'
`relocatedCwd`/`cwd` [spec 35.2.4]. The SDK implements the same (`truncatedPrefix`, `exactName`, lower-cased
on win32 only). Relevant to us: `.claude/worktrees/<long-name>/CC-to-SDK/harness` paths get within reach of
200 characters, and the mechanism is inherited, not something we need to build.

### 3.9 Quarantine names
`<sessionId>.orphaned-<epochMillis>-<8 hex>.jsonl`, produced only by three background-job supervisor paths
after a message probe finds no user/assistant records in a candidate resume transcript [spec 35.2.6];
confirmed present in the live tree. `listSessions` skips them (the stem must be a UUID); our
`storeAudit.auditSessionStore` walks them as ordinary `.jsonl` files, which is correct for a readability
audit.

---

## 4. Verbatim assets worth pinning (we do not have these verbatim)

Pointers, not paste-ins. Each is a table or literal set in the cited spec section.

| Asset | Where | Why |
|---|---|---|
| `SessionRecord` (30 fields) + constants `Ol = 262144`, `Nzt = 3`, `Fzt = 1`, `uce = 1e4`, `OA = 200`; the `.key` file names `/^(\d+)\.[0-9a-f]{64}\.key$/` and body schema `{peerToken:/^[0-9a-f]{32}$/, procStart?, procStartFt?, pidDomain?}`; `.fleetview-heartbeat` = `String(Date.now())`, fresh for 5000 ms | 35.27.1 | `peer/roster.ts` models 10 of 30; §2.1 |
| `AgentMetadata` field list + `YEt` preserved-across-patch set | 35.11.1 | §2.2 |
| `jet` description-line composition and the `Ut` byte formatter (`<n> bytes` / `KB` / `MB` / `GB`, trailing `.0` stripped) | 35.19.7 | §1.7 |
| Row badges: `" (sidechain)"`, `" (+N other session)"` / `" (+N other sessions)"`, `"  ⧉ N"` | 35.19.7 | picker rows |
| 2.1.257 picker footer strings and their **casing** — `Ctrl+A to show all projects` / `only show current repo`, `Ctrl+B to show all branches`, `Ctrl+W to show all worktrees`, `Space to preview`, `Ctrl+R to rename`, `Type to search`, `Esc to cancel`; search mode `Type to Search` (capital S) · `Enter to select` · `Esc to clear`; rename `Enter to save · Esc to cancel`; preview `Enter to resume` / `Esc to cancel` | 35.19.8 | ours (`sessionPickerModel.ts:97,131,133`) uses lower-case `space`/`esc`/`enter`; see §6 note |
| Host screen: `Loading conversations…`, `Resuming conversation…`, `Failed to resume the conversation.`, `This conversation is from a different directory.`, `To resume, run:`, `(Command copied to clipboard)`, and the command builder `cd <path> && claude --resume <id>` (`;` instead of `&&` on Windows) | 35.19.8 | our `resolveResume` `foreign` arm has no screen |
| `--continue` / `--resume` failure copy: `No conversation found to continue`, `No conversation found with session ID: <id>`, `Failed to resume session <id>`, `Unable to load transcript from file: <arg>`, the two background-holder sentences, and the print-mode `--resume "<v>" matches N sessions…` block | 35.16.3–35.16.4 | `cli/main.ts` fail() strings |
| Visibility-filter debug lines (`Session <id> filtered from /resume: …` × 7) + the enrich summary line | 35.14.3 | they are the *specification* of the picker filter |
| `/branch` title uniquifier `^<base> \(Branch(?: (\d+))?\)$`, the `"Branched conversation"` fallback, and the success sentence | 35.22.1 | if we ever add `/branch` on top of `sessions/fork.ts` |
| `Gbn = "Continue from where you left off."`, `TR = "No response requested."`, `Jc = "<synthetic>"` [`cli.pretty.js:183100`] | 35.18 | §1.11; we have the last two, not the first |
| First-prompt noise pattern `/^(?:\s*<[a-z][\w-]*[\s>]|\[Request interrupted by user[^\]]*\])/` | 35.13.1 | identical in the SDK (`kee`), so already applied upstream of us — pin it so we don't re-implement |
| `cleanupPeriodDays` / `desktopSessionCleanupPeriodDays` settings descriptions, verbatim | 35.24.2 | §2.12 |
| `~/.claude/backups/` corrupted-config strings (`Config file corrupted: …`, `Corrupted config backed up to: …`, the `cp "<backup>" "<config>"` hint) + retention `KF = 5` copies, throttle `GF = 60000` ms | 35.27.3 | we write no config backups |

---

## 5. Confirmations

- **Slug algorithm**: we correctly delegate it; `storeAudit.sessionStoreRoot`'s refusal to reproduce the
  mangling is the right call and its comment's description of the rule (fold, 200-char truncation, hash
  suffix, `CLAUDE_CODE_PROJECT_DIR_NAME` override) is accurate.
- **Config home**: `config/claudeHome.ts` matches canon and the SDK exactly, `??`-vs-`||` and unconditional
  NFC included.
- **`~/.claude/sessions/` field reading**: `peer/roster.ts`'s present-or-absent, one-key-at-a-time projection
  is the right discipline for another program's file, and its `/^\d+\.json$/` name filter matches canon's own
  reaping predicate.
- **Reader drop rule**: `appserver/peerInbound.ts:readerVisible` + the tripwire in
  `test/unit/peer/reader-predicate-contract.test.ts` mirror the SDK's `qje` — keep `user`/`assistant`, keep
  `system` only under `includeSystemMessages`, drop `isMeta` / `isSidechain` / `teamName`. Correct, and the
  test's "update on SDK bump" instruction is the right maintenance hook.
- **`sessions/rows.ts`'s central premise** — that `getSessionMessages` projects onto a fixed field literal and
  drops `isMeta`/`isSidechain`/`parentUuid`/`isApiErrorMessage` — is exactly right; I re-read `pk` in
  `sdk.mjs` to confirm.
- **`isPreviewMessage`** matches canon's visible-message predicate (`user` with non-empty string content or a
  `text`/`image`/`document` block; `assistant` with a non-blank `text` block) [spec 35.13.1], and the
  documented reason for dropping the `isMeta` clause (probe 107) is confirmed by the reader's own filter.
- **Chain reconstruction happens inside the SDK**, including the parallel-tool-result splice — so consuming
  the reader's array order is correct even though `parentUuid` never reaches us. `rewindAnchorsFrom`'s
  position-derived `prevUuid` is the right compensation.
- **`history.jsonl` constants**: `HISTORY_CAP = 100` (`K8e`) and `PASTE_INLINE_MAX = 1024` inclusive (`SGr`,
  `content.length <= SGr`) both verified at `cli.pretty.js:47346`; the consecutive-duplicate rule our
  divergence #5 describes matches `IGr` exactly; the "no `mode` column, the `!` prefix is canonical"
  decision is confirmed by 35.26.1 ("bash-mode input is stored with a leading `!`").
- **Paste cache**: `sha256(content).hex.slice(0,16)` + `.txt` in one flat directory, mode `0o600`, and the
  `[Pasted text #N — content no longer available]` fallback all match 35.26.5.
- **`custom-title.json` sidecar** is read by the SDK as the second title source (tail → sidecar → head),
  matching canon's `kir` ordering — we inherit it.
- **Store adapters**: treating `SessionStoreEntry` as an opaque pass-through blob and using `uuid` as an
  idempotency key while appending uuid-less entries un-deduped is exactly the contract, and it survives
  contact with the real record catalogue (six sidecar types carry no `sessionId`; both adapters key on
  `SessionKey`, not on the record).
- **Transcript physical format**: one JSON object per line, `\n`-terminated, UTF-8, append-only,
  no fsync, arrival order, unparseable lines skipped, torn tails sealed by prefixing a `\n`. Nothing in our
  code assumes otherwise.
- **`~/.claude/recovery/` on this machine is an operator artefact**, consistent with 35.27.4 (no `recovery`
  namespace in the registry; `userConfigDir`'s allow-list excludes it) and with A3.16.1. `migration-recovery/`
  is absent here, matching 35.27.5.
- **Live-tree structure confirmed by name only**: `projects/-`, `<slug>/<uuid>.jsonl`,
  `<slug>/<uuid>.orphaned-<ms>-<hex8>.jsonl`, `<slug>/.session-aliases`, `<slug>/memory`,
  `<slug>/<uuid>/{subagents,tool-results}/`, `<slug>/<uuid>/custom-title.json`, and **no `world.jsonl`
  anywhere** — which matches 35.10.1's finding that its opener is dead code in 2.1.257.

---

## 6. Spec defects

1. **§35.26.3's "post-gate drops" list reads as unconditional and is not.** It says "2. The ORIGINAL display
   starts with `!` — **an unconditional bash drop**" and "3. … starts with `/` — likewise unconditional",
   which directly contradicts the same section's "Recorded: typed prompts, slash commands (including
   `/clear`), bash-mode `!cmd`". The bundle settles it: every one of those branches is nested under
   `if (_.length > 0)` where `_` is the list of *unavailable pastes that were stripped*
   [`cli.pretty.js:47708-47730`]. The drops only fire on an entry that lost paste content. The prose will
   send a re-implementer to a `history.jsonl` that never records a slash command. Verified.
2. **§35.19.8's rendered footer line is asserted, not derived, and only half of it is title-cased by the
   format argument.** At [`cli.pretty.js:297453`] only the `ctrl+a` / `ctrl+b` / `ctrl+w` / `ctrl+r` chords
   carry `format: {modCase:"title", charCase:"upper"}`; `space` carries none. The spec's rendering
   (`Space to preview`) still comes out right — but by way of the *default* format's `keyCase: "title"`
   [`cli.pretty.js:319866`], not the per-chord format the section's prose credits. Minor, but the section
   presents itself as verbatim and the derivation matters for anyone reproducing the other footers. Not a
   behavioural error; noted so the next reader does not re-derive it.
3. **Three different literals for "this session has no usable title" are documented in three sections without
   cross-reference** — `"(session)"` (§35.14.3 rule 5), `"Proactive session"` (§35.14.2, `Kns`),
   `"Autonomous session"` (§35.19.7, `$ke`). They are genuinely three different code paths, but the chapter
   never says so, and a re-implementer will pick one. Worth one sentence in §35.19.7.
4. **Not a defect, but a gap the chapter should own**: §35.14/§35.15 specify canon's picker enrichment
   without noting that the shipped **SDK reimplements a strict subset** — it applies the `isSidechain` and
   programmatic-entrypoint filters (`includeProgrammatic`, default `true`) but *not* `teamName`,
   `continuedInSessionId`/`superseded`, `bookkeepingOnly`, the slug-collision cwd check, or `.session-aliases`
   widening; and where canon substitutes `"(session)"` the SDK **drops the row**. Anyone building a picker on
   the SDK (i.e. us) needs that delta stated, and it is currently only derivable by reading `sdk.mjs`.

---

## 7. Re-verification (checkout correction)

The first pass was researched in `/Users/new/Developer/GitHub/codex_somersault/CC-to-SDK` (a frozen
checkout) rather than the brief's `/Users/new/Developer/GitHub/somersault/CC-to-SDK`. Every cite above has
been re-checked against **somersault** and corrected in place. Two things changed; nothing else did.

**Source files.** 18 of the 22 cited files are byte-identical between the two checkouts (`cmp`), including
every file this lane leans on hardest: `sessions/reader.ts`, `sessions/rows.ts`, `sessions/storeAudit.ts`,
`store/redisSessionStore.ts`, `store/postgresSessionStore.ts`, `peer/roster.ts`, `cli/resolveResume.ts`,
`cli/args.ts`, `cli/worktree.ts`, `tui/replay.ts`, `tui/promptHistory.ts`, `tui/pasteCache.ts`,
`tui/SessionPicker.tsx`, `tui/ResumeTranscriptView.tsx`, `tui/sessionPickerModel.ts`, `tui/species.ts`,
`config/claudeHome.ts`, `appserver/peerInbound.ts`, plus
`test/unit/peer/reader-predicate-contract.test.ts`. Four differ (`cli/main.ts`, `tui/useChat.ts`,
`tui/toolRenderer.tsx`, `tui/ChatComposer.tsx`, and `docs/parity/coverage.md`), and in those I re-located
each cited construct by grep. **No finding changed** — only line numbers:

| cite | was (codex_somersault) | now (somersault) |
|---|---|---|
| `SessionInfo` declaration (§1.8) | `useChat.ts:116` | `useChat.ts:117` |
| `readSessions` cast (§1.8) | `useChat.ts:772` | `useChat.ts:780` |
| `appendHistory({… project: cwd …})` (§1.1) | `useChat.ts:3484` | `useChat.ts:3535` |
| `readHistory({scope, project: cwd, …})` (§1.1) | `useChat.ts:3498` | `useChat.ts:3549` |
| `SENTINEL_TEXT` (§1.11) | `toolRenderer.tsx:1317` | `toolRenderer.tsx:1402` |

Unchanged and re-confirmed in somersault: `cli/main.ts:310` (`config.cwd = inv.worktreePath`),
`cli/args.ts:142` (`--cwd`), `cli/worktree.ts:39`, `tui/ChatComposer.tsx:165`,
`tui/InlineHistorySearch.tsx:89`, and `docs/parity/coverage.md` §4 (now at line 770).

**Installed SDK.** somersault has **0.3.251**, not codex_somersault's 0.3.250 — so every SDK claim was
re-derived against 0.3.251's `sdk.mjs`/`sdk.d.ts`. All of them hold; the only churn is minifier identifier
renaming (`Os`→ the same `st(await realpath(e))` helper, `DQ`→`GQ`, `Yf`→`Jf`, `kee`→`Gee`, `pk`/`qje`
unrenamed). Specifically re-verified verbatim in 0.3.251:

- the `SessionMessage` projection (§1.10) — byte-identical;
- the reader's drop filter `isMeta`/`isSidechain`/`teamName` (§5) — byte-identical;
- the slug trio `ks=200` / `vu` (fold) / `Jf` (truncate + base-36 hash of the **original** path) (§3.1);
- `st(e) = process.platform === "darwin" ? e.normalize("NFC") : e` — still **darwin-only** (§3.5);
- `Gt = memo(() => (CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude")).normalize("NFC"))` — still
  **unconditional** NFC for the config home (§3.2);
- `GQ(e) = st(realpathSync(resolve(e ?? ".")))` and the async `st(await realpath(e))` — the **realpath
  before slug** on both read paths (§3.4);
- `/^[A-Za-z0-9_-]{1,64}$/` + `/^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/i` for
  `CLAUDE_CODE_PROJECT_DIR_NAME`, still gated on `CLAUDE_CONFIG_DIR` (§3.3);
- `includeProgrammatic` defaulting to `true` and the `{sdk-cli, sdk-ts, sdk-py}` set (§1.9, §6.4);
- the first-prompt noise regex `/^(?:\s*<[a-z][\w-]*[\s>]|\[Request interrupted by user[^\]]*\])/` (§4);
- the "no title source → return `null` → row disappears" arms on both the file and store paths (§1.9);
- `fileSize` / `tag` / `createdAt` populated on the file-backed row (§1.7);
- `.session-aliases`: still **exactly one** occurrence in `sdk.mjs`, still only the reserved-name set,
  still **no reader** (§2.3);
- `systemPromptSnapshot` / `prompt_snapshot`: still **absent** from 0.3.251 (§2.10) — the recheck-at-bump
  note stands.

Bundle cites (`~/claude-code-bundle/2.1.257/cli.pretty.js`) and live-tree observations are
checkout-independent and unaffected.
