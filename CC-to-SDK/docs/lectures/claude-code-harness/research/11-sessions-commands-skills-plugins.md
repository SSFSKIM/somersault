# 11 — Persistence, sessions, slash commands, skills, plugins, memory

Source of truth: `~/claude-code-bundle/2.1.251/cli.pretty.js` (881,404 lines, beautified from the
`2.1.251` native build). Every claim below carries a `cli.pretty.js:LINENO` anchor. Anything not read
directly out of the binary is marked **INFERRED**. On-disk shapes confirmed against a live
`~/.claude` were read for *structure only* — no file contents are reproduced here.

---

## Executive summary

1. 2.1.251 routes essentially all `~/.claude` I/O through a single **typed storage-key registry**
   (`chunk-1hpjnncp.js`, 34456–35851). One function, `Jo(env, key)` at 35220, maps ~35 namespaces
   (`transcript`, `memory`, `task`, `fileHistory`, `pluginCache`, `sidecar`, `scratch`, `sessionLog`, …)
   to concrete paths. That table *is* the on-disk layout spec.
2. Session transcripts still live at `~/.claude/projects/<projectKey>/<sessionId>.jsonl`, but a session
   now also owns a **directory** of the same name holding `subagents/`, `tool-results/`, recordings and
   other sidecar files (35266, 35225, 35294).
3. The JSONL envelope is written in one place (`insertMessageChain`, 417523) and carries 17 fields:
   `parentUuid, logicalParentUuid, isSidechain, teamName, agentName, promptId, agentId, …message…,
   sessionKind, userType, entrypoint, cwd, sessionId, version, gitBranch, slug`.
4. There are **34 distinct line `type`s**, enumerated by the append-policy table `hhr` at 416005 —
   only five of them (`user`, `assistant`, `system`, `attachment`, `progress`) are conversation.
5. `~/.claude/todos/`, `~/.claude/statsig/` and `~/.claude/logs/` are **legacy**: 2.1.251 only deletes
   them (`cleanupLegacyDirs`, 722603). Todos moved to `~/.claude/tasks/<listId>/<taskId>.json`.
6. The built-in slash catalog is `frr()` at 504435 — ~120 registry entries, many of them *pairs*
   (a `local-jsx` interactive form and a `local` headless form of the same name). `/vim` and
   `/output-style` are now redirect stubs pointing at `/config` (96665).
7. The **SlashCommand tool has been renamed `Skill`** (`Do = "Skill"`, 296213; tool object at 470381).
   Its listing budget is `contextWindow × 4 bytes/token × 0.01` ≈ 8,000 chars by default (470200).
8. Bundled ("built-in") skills are registered by `registerBundledSkill` (767539) — 40+ of them ship in
   the binary, including `claude-api`, `code-review`, `commit`, `pr`, `doctor`, `dataviz`, `verify`,
   `simplify`, `prototype`, `run`, `update-config`, and the whole `artifact-*` family.
9. Auto-memory is a real, shipping subsystem: `~/.claude/projects/<projectKey>/memory/` with a
   `MEMORY.md` index (first 200 lines loaded), per-fact `.md` files capped at 4,096 chars, a
   four-type taxonomy (`user | feedback | project | reference`), and a `memory/logs/YYYY/MM/DD/*.md`
   session-log tree (244333, 310627, 34985).
10. Retention is one knob — `cleanupPeriodDays`, default **30**, `0` disables (721417) — applied by
    ~45 named sweepers to nearly every directory under `~/.claude`.

---

## 1. `~/.claude` on-disk layout

### 1.1 The storage-key registry

`chunk-1hpjnncp.js` (34456–35851) defines a closed set of namespaces and, for each, (a) a path
mapping, (b) a symlink policy, (c) a write mode (atomic vs append), (d) a scope-listing rule. The
public constructors are the `Te` object at 206673 (`Te.transcript(...)`, `Te.fileHistory(...)`, …).

`configHome` is `~/.claude` unless `CLAUDE_CONFIG_DIR` overrides it (609758).

| namespace | path (relative to `~/.claude`) | writer / purpose | anchor |
|---|---|---|---|
| `transcript` | `projects/<projectKey>/<sessionId>.jsonl` | main session transcript (append) | 35228 |
| `transcript` (agent) | `projects/<projectKey>/<sessionId>/subagents/<…agentRelPath>/agent-<agentId>.jsonl` | subagent/sidechain transcript | 35228 |
| `transcript` (run journal) | `projects/<projectKey>/<sessionId>/subagents/<…>/journal.jsonl` | per-run journal | 35225 |
| `transcript` (session journal) | `projects/<projectKey>/<sessionId>/<journalName>.jsonl` | named session journal (`world`) | 35227, 34762 |
| `sidecar` | `projects/<projectKey>/<sessionId>/<relPath>` | per-session sidecars — `tool-results/`, etc. | 35266 |
| `recording` | `projects/<projectKey>/<sessionId>/<epochMs>.cast` | asciinema terminal recording | 35294, `l=".cast"` 34853 |
| `memory` | `projects/<projectKey>/memory/<relPath>` | auto-memory store | 35238 |
| `sessionLog` | `projects/<projectKey>/memory/logs/<YYYY>/<MM>/<DD>/<name>.md` | daily session log | 35296 + `re()` 34983 |
| `bridgePointer` | `projects/<projectKey>/bridge-pointer.json` | cloud-session pointer | 35282 |
| `sessionAliases` | `projects/<projectKey>/.session-aliases` | short-name → session id | 35284 |
| `dirSyncRecord` | `projects/<projectKey>/<sessionId>.dir-sync.json` | cloud dir-sync record | 35286, `PAt` 34870 |
| `history` | `history.jsonl` | REPL prompt history | 35230 |
| `settings` (user) | `settings.json` | user settings | 35299 (`qe`) |
| `settings` (project) | `project-settings/<projectKey>/settings.json` | mirrored project settings | 35299 |
| `settings` (local) | `local-settings/<consentRootKey>/settings.local.json` | mirrored local settings | 35299 |
| `globalConfig` | `~/.claude.json` (the `globalConfigFile`) | global config | 35231 |
| `globalConfig` copy | `backups/<basename>.<backup\|corrupted>.<stamp>` | recovery copies | 35231, `H="backups"` 34829 |
| `task` | `tasks/<listId>/<taskId>.json`, `…/.meta.json`, `…/.highwatermark` | task/todo lists | 35234 |
| `fileHistory` | `file-history/<sessionId>/<sha256[0:16]>@v<n>` | edit checkpoints | 35272 |
| `paste` | `paste-cache/<id>.txt` | pasted-text spill (10 MB cap) | 35250; `N=1e7` 36185 |
| `plan` | `plans/<name>.md` | plan-mode plan files | 35243 |
| `scratch` | `scratch/<sessionId>/<relPath>` | per-session scratch | 35269 |
| `job` / `jobsRoot` / `jobTimeline` | `jobs/<jobId>/…`, `jobs/pins.json`, `jobs/<jobId>/timeline.jsonl` | background jobs | 35288–35292 |
| `daemon` | `daemon/<relPath>` | daemon state | 35287 |
| `team` / `mailbox` | `teams/<team>/config.json`, `teams/<team>/inboxes/<teammate>.json` | multi-agent teams | 35256, 35289 |
| `agentMemory` | `agent-memory/<agentType>/…` (user) · `agent-memory-<layer>/<projectKey>/<agentType>/…` | per-subagent memory | 35253 + `P()` 35352 |
| `feedbackDraft` | `feedback/drafts/<draftId>.json` | `/feedback` drafts | 35251 |
| `identity` | `antproto.json` | agent identity | 35255 |
| `session` | `sessions/<file>` | server/session records | 35281 |
| `userConfigDir` | `<dir>/<relPath>` where `<dir>` ∈ `commands, agents, output-styles, skills, workflows, routines, themes, rules, session-env, uploads, mcp-skill-archives, usage-data, mcp-discovery-cache` | user-authored extensions | 35270, 34762 |
| `pluginRegistry` | `plugins/{installed_plugins.json, known_marketplaces.json, flagged-plugins.json, plugin-catalog-cache.json, .last_inuse_sweep}` | plugin ledger | 35239, `ye` 34762 |
| `marketplaceCache` | `plugins/marketplaces/<marketplace>/[.claude-plugin/marketplace.json]` | cloned marketplace | 35240 |
| `pluginCache` | `plugins/cache/<marketplace>/<plugin>/<version>/<relPath>` | installed plugin payload | 35245 |
| `pluginAssetCache` | `plugins/asset-cache/<sha256>` | plugin binaries/assets | 35248, `I="asset-cache"` 34463 |
| `cache` | `cache/<store>/<id>` (with special-cased flat names: `changelog.md`, `model-capabilities.json`, `gateway-models.json`, `org-memory-discovery.json`, `my-closed-issues.json`, `team-discovery.json`) | HTTP/config caches | 35246, `w` 34701 |
| `state` | `state/<id>.json` **or** a special-cased flat name | small mutable state | 35242, `L` 34463 |
| `log` | `debug/<sessionId>.txt` · `telemetry/<sessionId>.json` · `dump-prompts/<sessionId>.jsonl` | logs | `Xe()` 35309, `ce()` 35342 |
| `bridgeSpawn` | (external root) | bridge spawn dirs | 35427 |

`state` special names (`L`, 34463) are the flat top-level files: `daemon.status.json`,
`active-time.json`, `.last-cleanup`, `gh-pr-status-cache.json`, `server-sessions.json`,
`.deep-link-register-failed`, `keybindings.json`, `.last-update-result.json`,
`daemon.scheduled.status.json`, `loop.md`, `computer-use.lock`, `daemon-auth-cooldown`,
`daemon-auth-status.json`, `daemon.json`, `daemon.lock`, `daemon.log`, `hfi-auth.json`,
`mcp-needs-auth-cache.json`, `.npm-cache-cleanup`, `policy-limits.json`, `remote-settings.json`,
`remote-settings-consent.json`, `remote-settings-helper-consent`, `server.lock`,
`.session-log-cleanup`, `stats-cache.json`, `.update.lock`, **`CLAUDE.md`** (id `user-memory`),
`.version-cleanup`.

That last entry is worth noting: `~/.claude/CLAUDE.md` — the user-level memory file — is addressed
through the same `state` namespace as `daemon.lock`, under the id `user-memory` (34463).

### 1.2 Project key derivation

`hA(cwd)` (116975): replace every non-`[a-zA-Z0-9]` character with `-`; if the result exceeds
**200** characters, truncate to 200 and append `-<base36 hash of the original>`. `Am()` (117025) is
the same with an override hook. So `/Users/x/dev/proj` → `-Users-x-dev-proj`.

### 1.3 Reserved names inside a project directory

`U` (34853) reserves these project-level entry names so they can never be mistaken for a session id:
`memory`, `tiny_memory`, `bagel`, `cloud-snapshots`, `bridge-pointer.json`, `.session-aliases`.
`J` (34866) reserves the session-sibling suffixes `.ccr-tip.json`, `.precompact.json`, `.cast`.

### 1.4 Session-id and agent-id validity

- Session id: `YN` (78248) — `^[A-Za-z0-9_][A-Za-z0-9_-]*$`, ≤200 chars, not a Windows device name.
  In practice a UUIDv4. `--session-id` may only be combined with `--continue`/`--resume` when
  `--fork-session` is also given (527759).
- Agent id: `^a(?:[\w-]{1,63}-)?[0-9a-f]{16}$` (78252).
- File-history backup name: `^[0-9a-f]{16}(?:[0-9a-f]{48})?@v\d+$` (117460).

### 1.5 Legacy directories

`cleanupLegacyDirs` (722603) walks `todos`, `statsig`, `logs` and deletes anything older than the
retention cutoff, then rmdirs the parent. Nothing in 2.1.251 writes to them. They remain in the
"protected paths" set `Hi` (124150) alongside `.claude.json`, `.credentials.json`, `projects`,
`sessions`, `shell-snapshots`, `file-history`, `history.jsonl`, `ide`, `backups`,
`.session_ingress_token` — that set is what a destructive operation refuses to touch.

### 1.6 Directories a session creates at runtime

- `shell-snapshots/snapshot-<zsh|bash|sh>-<epochMs>-<rand6>[-<sessionId8>].sh` (472238). Written by
  sourcing the user's rc file in a login shell and dumping functions/aliases/exports; deleted on exit
  (472270) and swept by extension `.sh` on the retention cutoff (722288).
- `session-env/<hash>` — per-session environment capture (431461).
- `ide/` — IDE lockfiles (in the protected set, 124150).
- `paste-cache/<id>.txt` — pasted blocks over the inline threshold, 10 MB cap (36185).
- `debug/<sessionId>.txt` — rotates at **10 MiB** into `<sessionId>.1.txt` (`IRn`, 35320/35322).

### 1.7 `~/.claude.json` (the global config)

Defaults object at 311022 — every key here is a real field of `~/.claude.json`:

```
numStartups, installMethod, autoUpdates, theme, preferredNotifChannel, verbose, editorMode,
autoCompactEnabled, autoScrollEnabled, showTurnDuration, externalEditorContext,
showMessageTimestamps, hasSeenTasksHint, hasUsedStash, hasUsedBackgroundTask,
queuedCommandUpHintCount, diffTool, customApiKeyResponses{approved,rejected}, env, tipsHistory,
memoryUsageCount, promptQueueUseCount, btwUseCount, todoFeatureEnabled, showExpandedTodos,
briefTranscript, messageIdleNotifThresholdMs (60000), autoConnectIde, autoInstallIdeExtension,
fileCheckpointingEnabled, terminalProgressBarEnabled, cachedDynamicConfigs,
cachedGrowthBookFeatures, respectGitignore, copyFullResponse,
unpinOpus47LaunchEffort, unpinOpus48LaunchEffort, unpinFable5LaunchEffort
```

Plus, written elsewhere: `oauthAccount` (`accountUuid`, `organizationRole`, `workspaceRole`, …)
(93104, 93349), `hasCompletedOnboarding` (351347), `skillUsage` (279316), `autoReact` (chunk-local).
`fileCheckpointingEnabled` is the master switch for the file-history/rewind store.

---

## 2. Session transcripts

### 2.1 The write path

`insertMessageChain` (417490–417540) is the only place a conversation line is minted. For each
message in the chain it builds:

```js
let ge = {
  parentUuid:        fe ? null : pe,     // null on a compact boundary
  logicalParentUuid: fe ? M : undefined, // pre-boundary parent, kept for provenance
  isSidechain:       t,
  teamName:  u?.teamName,
  agentName: u?.agentName,
  promptId:  me.type === "user" ? $J() ?? undefined : undefined,
  agentId:   r,
  ...me,                                  // type, uuid, timestamp, message, isMeta, toolUseResult…
  sessionKind: v6(),   // undefined | "bg" | "daemon" | "daemon-worker"
  userType:    bcn(),  // "external" | "ant"
  entrypoint:  XBe(),  // "cli" | "sdk-ts" | "remote_cowork" | …
  cwd:         ee(),
  sessionId:   B,
  version:     oVt,    // "2.1.251"
  gitBranch:   U,      // awaited git branch, undefined on failure
  slug:        W       // per-session slug from K5()
};
```
(417523.) Immediately after, `toolUseResult` is normalized through `EHe` (417525), and a
`parentUuid === uuid` self-reference is counted as a bug (`tengu_chain_self_reference_write`).

A `user` line whose `sourceToolAssistantUUID` names a *known* prior uuid is re-parented to it; if the
uuid is not in the session's uuid set the write is counted as `tengu_phantom_parent_write` and the
default parent is kept (417512–417520).

### 2.2 Line types and their append policy

`hhr` (416005) — the authoritative list of every `type` value, and how each is routed:

| policy | types |
|---|---|
| `dedup-transcript` (skip if uuid already present; mirror to remote) | `user`, `assistant`, `attachment`, `system`, `progress` |
| `always` (append unconditionally) | `summary`, `custom-title`, `ended-by-model`, `ai-title`, `last-prompt`, `tag`, `relocated`, `agent-name`, `agent-color`, `agent-setting`, `pr-link`, `frame-link`, `artifact-comment-monitor`, `artifact-autoreact-ledger`, `bridge-session`, `history-suppression`, `file-history-snapshot`, `file-history-delta`, `attribution-snapshot`, `mode`, `permission-mode`, `isolation-latch`, `atis-latch`, `worktree-state`, `cost-state`, `queue-operation`, `marble-origami-commit`, `marble-origami-snapshot`, `marble-origami-reset` |
| `route-by-agent` (goes to the agent's own file when `agentId` set) | `content-replacement`, `fork-context-ref`, `observer-ref` |

Selected record shapes read directly:

| type | shape | anchor |
|---|---|---|
| `custom-title` | `{type, customTitle, sessionId, uuid?, timestamp?}` | 419588, 610139 |
| `ai-title` | `{type, aiTitle, sessionId}` | 419604 |
| `ended-by-model` | `{type, timestamp, sessionId}` | 419578 |
| `last-prompt` | `{type, lastPrompt?, leafUuid?, explicit?, rewound?, sessionId}` | 417056, 417826 |
| `pr-link` | `{type, sessionId, prNumber, prUrl, prRepository, timestamp}` | 419615 |
| `bridge-session` | `{type, sessionId, bridgeSessionId, lastSequenceNum, declaredDialogKinds?, sessionGroupingId?, noHistoryBackfill?, ownerAccountUuid?, ownerOrganizationUuid?}` | 419632 |
| `frame-link` | `{type:"frame-link", frameUrl?, artifactCount?}` | 421594 |
| `file-history-snapshot` | `{type, messageId, snapshot, isSnapshotUpdate}` | 417545 |
| `file-history-delta` | `{type, messageId, snapshotMessageId, trackingPath, backup, timestamp}` | 418222 |
| `content-replacement` | `{type, sessionId, agentId?, replacements[]}` | 417570 |
| `atis-latch` | `{type:"atis-latch", atis, sessionId}` | 417518 |
| `relocated` | `{type, sessionId, relocatedCwd}` | 724875 |
| `summary` | `{type:"summary", summary, leafUuid}` — **read only** in 2.1.251 (420601); no writer found, so it is legacy compatibility from older builds. **INFERRED.** | 420601 |

### 2.3 Sidechains (subagent transcripts)

`isSidechain: true` lines from a subagent are written to
`projects/<pk>/<sessionId>/subagents/[<relPath>…]/agent-<agentId>.jsonl` rather than the session file
(`appendEntry` → `dedup-transcript` branch, 417630–417650; path at 35228). Note the dedup guard is
*skipped* for sidechain lines (`A || M` at 417638) — a sidechain entry is always written even if its
uuid was already seen, because the two files are independent streams.

Reading them back is `getSubagentMessages`-shaped: `buildConversationChain` (`BSe`) filters
`!isSidechain` for the main chain (418193) and `agentId === e` when reconstituting one agent (421284).
`Opt`/`canFetchAgentTranscriptsOnDemand` and `agentTranscriptExists` gate whether the reader hits disk
(380030 export list).

### 2.4 Compact boundaries

A compaction writes a `system` line with `subtype: "compact_boundary"`:

```js
{ type:"system", subtype:"compact_boundary", content:"Conversation compacted",
  isMeta:false, timestamp, uuid, level:"info",
  compactMetadata: { trigger, preTokens, userContext, messagesSummarized },
  logicalParentUuid? }
```
(519244.) Later passes enrich `compactMetadata` with `postTokens` and `cumulativeDroppedTokens`
(435892–435900) and with the preserved-window descriptor (261775):

- `preservedMessages: { anchorUuid, uuids[], allUuids? }` — explicit list, or
- `preservedSegment: { anchorUuid, headUuid, tailUuid }` — a walkable span.

**Replay (`GVt`, 419045–419100)** is the load-time rule that makes a compacted transcript resumable:

1. Find the last `compact_boundary` that carries either descriptor.
2. Resolve `preservedMessages` directly, or walk `tailUuid → headUuid` via `parentUuid` (`KVt`,
   419099). A broken walk emits `tengu_relink_walk_broken` and aborts the relink.
3. Re-chain the preserved uuids in order onto `anchorUuid`, and repoint anything that pointed at the
   anchor to the new tail.
4. Zero the `usage` block on every preserved assistant message (419077) — they've already been paid
   for; counting them again would double-charge the context estimate.
5. Delete every message positioned before the boundary that is not in the preserved set (419083).

A `parentUuid` cycle is detected and reported (`tengu_chain_parent_cycle`, 419129), returning a
partial transcript rather than hanging.

### 2.5 Reading a transcript cheaply

Session listing never parses whole files. `Ppe` (419053) reads a **head** and **tail** window
(`qJe`) and string-matches:

- head scan: `INDEX_HEAD_SCAN_BYTES = 256`, boundary scan `4096`, last-prompt scan `1024`,
  prefix scan `64` (416046).
- whole-file read cap: `MAX_TRANSCRIPT_READ_BYTES = 52,428,800` (50 MiB, 416046). Larger files are
  listed "lite" (421259: `isLite:true`, `messages:[]`).
- head/tail buffer `Sp = 65536` (116457).

From those two windows it derives: `firstPrompt`, `gitBranch`, `isSidechain`, `projectPath` (head
`cwd`), `relocatedCwd`, `teamName`, `sessionKind`, `isLoopSession`, `customTitle`, `aiTitle`,
`summary`, `tag`, `agentSetting`, `entrypoint`, `prNumber/prUrl/prRepository`, `artifactCount`,
`lastMessageAtMs` (419089).

A guard exists for a transcript whose records carry no `parentUuid` at all — the resume path warns
that only *n* of *m* records are linkable (419165).

### 2.6 Transcript compaction of the *file*

Independently of conversation compaction, the writer rewrites the `.jsonl` when it grows: threshold
`xR = 20,971,520` (20 MiB), doubling up to `yBe = 8 × xR` (160 MiB) when a compact frees less than
`_Be = 10%` (416005, 417448). Failure modes are telemetered as `tengu_transcript_compact`.

### 2.7 Titles

Three title fields coexist, in precedence order `customTitle > aiTitle > firstPrompt` (183100):

- **`custom-title`** — set by `/rename` or the API; `tI()` at 419586 also mirrors it to the sidecar.
- **`ai-title`** — generated by `generateSessionTitle` (`Aq`, 93596). It concatenates non-meta
  user/assistant text, keeps the **last 1,000 characters** (`h = 1000`, 93540), refuses inputs under
  **10** characters (`g = 10`), and calls a JSON-schema-constrained model turn
  (`querySource: "generate_session_title"`) with a long, very specific system prompt (93576):
  *"a short noun phrase of two to five words, in sentence case … Leave out the request verbs …
  Return JSON with a single `title` field."* Emits `tengu_session_title_generated`.
- **`slug`** — a per-session slug attached to every line (417523), used by the memory session-log
  filename (below).

---

## 3. Resume, continue, fork

### 3.1 Selection

- `--resume [<id|path>]`, `-r`, `--resume=<…>` (354894); `--continue` / `-c` (256613, 390454).
- `--fork-session` is detected positionally at 389663 and re-emitted for relaunch at 389670 as
  `["--session-id", f, "--fork-session"]`.
- Guard: `--session-id can only be used with --continue or --resume if --fork-session is also
  specified` (527759).
- A backgrounded session prints `claude --resume <forkSessionId>` (144880).
- Relaunch composes `["--session-id", id, "--fork-session"]` + `["--resume", transcriptPath ?? id]`
  (597504).

`--continue` resolves the most recently modified transcript for the current project by sorting the
project directory's `.jsonl` files by `mtime` (419040, 421259). **INFERRED** that this is the exact
`--continue` selector — the sort is in the shared session-list builder, not a `--continue`-specific
function.

### 3.2 Fork mechanics

`chunk` at 724840–724930 rewrites the source transcript into a new session file:

```js
let L = { ...f, ...neutralized, sessionId: a, parentUuid: y, isSidechain: false,
          sessionKind: undefined,
          forkedFrom: { sessionId: p, messageUuid: f.uuid } };
```
(724898.) Notes:

- A `system`/`model_refusal_fallback` line is rewritten with `neutralizedByFork: true` (724897) so a
  refusal in the parent does not re-poison the fork.
- `content-replacement` and `relocated` records are collected during the scan and re-emitted once at
  the end under the new session id (724916–724921).
- `history-suppression` in the source causes the fork to be marked suppressed too (724880).
- `progress` lines are copied but do **not** advance the parent pointer (724901).
- The fork returns `{sessionId, title, forkPath, serializedMessages, contentReplacementRecords,
  sessionHistorySuppressed}`.

`/branch` ("Create a branch of the current conversation at this point", 503917) is the interactive
form of the same primitive; `608468` shows the branch path appending a `custom-title` line to the new
transcript.

### 3.3 The `/resume` picker

The picker consumes `SessionEntry` records built at 419419 / 421535:

```
{ date, messages, fullPath, value, created, modified, firstPrompt, messageCount,
  isSidechain, teamName, sessionKind, agentName, agentSetting, leafUuid, summary,
  customTitle, aiTitle, tag, relocatedCwd, projectPath, sessionId, rewindAnchorUuid,
  prNumber, prUrl, prRepository, artifactCount, fileSize, isLite, ownWorktrees }
```

Suggestion rows are `{ id: "resume-title-<sessionId>", displayText: customTitle ?? aiTitle,
description: …, metadata: { sessionId } }` (155416). Cheap "lite" rows are used for files over the
50 MiB read cap or when only mtime/ctime are needed (421259, 421784).

`checkResumeConsistency` (`pzn`, exported at 380030) and `adoptResumedSessionFile` (`m9`/`g9`) are the
adoption path; `copyFileHistoryForResume` (`eut`, 679) copies the file-history bucket forward so a
resumed session can still rewind.

---

## 4. Checkpointing and rewind

### 4.1 The store

Gate: `fileCheckpointingEnabled` in `~/.claude.json` (311022) via `fileHistoryEnabled` (`$y`, 679).

A backup is one file: `~/.claude/file-history/<sessionId>/<name>` where

```js
name = sha256(absolutePath).hex.slice(0,16) + "@v" + version    // dSn, 452881
```

`trt` (452958) copies the tracked file to that path (`copyFile`, then `chmod` to the original mode),
records `{backupFileName, version, backupTime, realParentDir}`, and emits
`tengu_file_history_backup_file_created`. A missing file is recorded as
`{backupFileName: null, version}` — that is how "the file did not exist at this point" is encoded, so
rewinding to it *deletes* the file (452710, 452791).

### 4.2 What triggers a snapshot

- Each user turn: `makeFileHistorySnapshot(messageUuid)` snapshots every currently tracked file
  (`VW`, 169936; batching wrapper `Ynt`, 169115). Emits `tengu_file_history_snapshot_success` with
  `trackedFilesCount` and `snapshotCount` (452602).
- Each edit: `trackEdit` backs up the *pre-edit* content and appends a `file-history-delta` record
  (452575, 418222). Emits `tengu_file_history_track_edit_success` with `isNewFile` and `version`.
- Forked skills inherit the parent's history (`shareFileHistory: true`, 470358) and take a snapshot
  before running (`makeFileHistorySnapshot?.(D.uuid)`, 76305).

Both facts land in the transcript as `file-history-snapshot` / `file-history-delta` lines, so the
store is reconstructible from the JSONL alone.

Eviction of old backups is logged at 452626 (`failed to delete evicted backup …`), i.e. the store is
bounded per session as well as by retention. The exact eviction bound was not located. **Open.**

### 4.3 `/rewind`

Command: `{ name: "rewind", aliases: ["checkpoint","undo"], type:"local",
description:"Restore the code and/or conversation to a previous point", supportsNonInteractive:false }`
(503924). Also reachable from the message selector.

Dialog options (151225):

| available when | options |
|---|---|
| file history has a snapshot for the selected message | `both` — "Restore code and conversation" · `conversation` · `code` |
| otherwise | `conversation` only |
| always appended | `summarize` ("Summarize from here"), `summarize_up_to` ("Summarize up to here"), `nevermind` |

Both summarize options take an optional free-text "add context" input (151225).

Restore paths:
- conversation → `rewindConversationTo` (151034) truncates the in-memory message list and emits
  `tengu_conversation_rewind` with `preRewindMessageCount / postRewindMessageCount / messagesRemoved /
  rewindToMessageIndex / source`. It also unwinds a `model_refusal_fallback` model switch when the
  rewind crosses it (151048).
- code → `fileHistoryRestoreStateFromLog` (`I3e`, 151606). Refuses to touch a destination that is a
  symlink, not a regular file, hard-linked (`nlink > 1`), or whose parent path does not resolve
  (`gSn`, 452767–452800) — each refusal is counted and reported as `skippedLinks`. Emits
  `tengu_file_history_rewind_success` `{trackedFilesCount, filesChangedCount, skippedLinksCount}`.

`fileHistoryGetDiffStats` (`sIe`, 452862) computes `{filesChanged, insertions, deletions}` for the
preview by diffing the live file against the backup.

**Git interplay:** none. The rewind store is independent of git — it snapshots absolute paths into
`~/.claude/file-history`, never touches the index, and the only git-adjacent field on a transcript
line is the informational `gitBranch`. `/diff` is a separate, read-only view of uncommitted changes
(502762).

### 4.4 Retention

`cleanupOldFileHistoryBackups` (`Sfr`, 722040) is `M("file-history")` — the generic
delete-subdirectories-older-than-cutoff sweeper (721999). So a session's whole backup bucket is
removed once its directory mtime crosses `cleanupPeriodDays`.

---

## 5. The slash-command system

### 5.1 Parsing

`Rx(input)` (135894):

```js
let t = input.trim();
if (!t.startsWith("/")) return null;
let { name, args } = Xce(t);
if (!name) return null;
// "(MCP)" suffix disambiguates an MCP prompt from a same-named local command
```

Whether a queued input is treated as a command at all is `ARe` (172156): the value must trim-start
with `/`, and `skipSlashCommands` must not be set on the queue item. A command input is dequeued and
executed **alone**; non-command inputs of the same mode are batched (172165).

Dispatch (`XEr`, 76400–76520), in order:

1. `Rx` fails → in an interactive session, reply `Commands are in the form /command [args]`; in a
   non-interactive session, fall through and treat the text as a prompt (76410).
2. Alias/spelling resolution (`s_e`) — and if the name contains `://` it is treated as a URL-ish
   command, not a typo (76425).
3. Look up `ua(name, commands)`; drop it if `Hp()` (availability) fails.
4. **Colon promotion**: if `/foo bar` did not resolve, try `/foo:bar` with the rest as args (76432).
   This is what makes `.claude/commands/foo/bar.md` reachable as `/foo bar`.
5. **Subcommands**: `a_e(cmd, args)` (135906) consumes the first token if it is a key in the
   command's `subcommands` map; `subcommandsBareOnly` refuses the promotion when trailing args remain.
   (`/code-review ultra` → `/ultrareview`, 215143.)
6. `syncedSkills` are vetoed when the sync veto is on (76445).
7. If the name still does not resolve **and** `/name` exists as a real filesystem path, it is *not*
   an invalid command — the input is passed through as a prompt (76462).
8. Otherwise: policy check (`mpr`), `tengu_input_slash_invalid` telemetry, and a
   `<local-command-stdout>`-wrapped error in non-interactive mode (76470).

`hWe(name)` (76381) — a name is command-shaped iff `^[a-zA-Z0-9_][a-zA-Z0-9:_-]*$`.

### 5.2 Command kinds

| kind | meaning |
|---|---|
| `prompt` | expands into messages via `getPromptForCommand(args, ctx)`; the model sees the result |
| `local` | runs `call()` and returns text; headless-capable when `supportsNonInteractive` |
| `local-jsx` | renders an Ink dialog; interactive only |

Common fields observed across definitions: `name`, `aliases`, `description` (may be a getter),
`menuDescription`, `argumentHint` (may be a getter), `isEnabled()`, `isHidden` (may be a getter),
`immediate` (bool or predicate on the arg string), `supportsNonInteractive`, `requires: {workspace?,
ink?}`, `availability: ("claude-ai"|"console")[]`, `policyGate: {policy, featureLabel, verb?}`,
`terminalOriented`, `thinClientDispatch: "post-text"|"control-request"|"twin"`, `fleetHostCall`,
`subcommands`, `subcommandsBareOnly`, `disableModelInvocation`, `userInvocable`, `load: () => import(…)`,
`getArgumentCompletions`.

Availability filter `SGe` (504493): `claude-ai` passes when the session is claude.ai-authed;
`console` passes when it is neither claude.ai nor first-party-inference but is console-authed.

Categories, for menu grouping (`kn`, 209408): `config` / `action` / `info` / `agent`.

### 5.3 The 2.1.251 built-in catalog

Registry: `frr()` at 504435; names+aliases flattened into `oI()` at 504438. Many entries appear twice
— an interactive `local-jsx` object and a headless `local` object with the same `name`; the headless
one is typically `isHidden` unless `Le()` (non-interactive mode). Rows below merge those pairs.

| command | aliases | kind(s) | description | gating / notes | anchor |
|---|---|---|---|---|---|
| `/add-dir` | | local-jsx | Add a new working directory | arg `<path>` | 429040 |
| `/advisor` | | local-jsx | Let Claude consult a stronger model at key moments | hidden unless `tD()` | 503952 |
| `/agents` | | local | **(removed)** Ask Claude to create/manage subagents, or edit `.claude/agents/` | tombstone that prints a pointer to the docs | 503924 |
| `/artifacts` | | local-jsx | Browse your published and shared artifacts | gated on artifacts | 501572 |
| `/auto-mode-setup` | | local + local-jsx | Teach auto mode about your environment, plus optional rule tweaks | `--wizard/--propose/--apply-file` in headless form | 501570 |
| `/autocompact` | | local + local-jsx | Set how full the context gets before auto-summarizing | arg `[auto\|<tokens>]` | 502735 |
| `/autofix-pr` | | local-jsx | Monitor and autofix any issues with the current PR | | 501576 |
| `/background` | `bg` | local-jsx | Send this session to the background and free the terminal | | 550430 |
| `/branch` | | local-jsx | Create a branch of the current conversation at this point | arg `[name]` | 503917 |
| `/brief` | | local-jsx | Toggle brief-only mode | account-gated | 720475 |
| `/btw` | | local-jsx | Ask a quick side question without interrupting the main conversation | | 501580 |
| `/bug` | `share` | local-jsx | Report a bug or share your conversation | | 501580 |
| `/cd` | | local-jsx | Move this session to a new working directory | | 501580 |
| `/chrome` | | local-jsx | Open Claude in Chrome settings | `claude-ai` only | 503952 |
| `/clear` | `reset`, `new` | local | Start a new session with empty context; previous session stays on disk (resumable with `/resume`) | arg `[name]` | 501580 |
| `/cloud-plugins` | | local-jsx | Choose whether cloud sessions use the plugins enabled on this machine | | 429040 |
| `/color` | | local + local-jsx | Set the prompt bar color for this session | terminal-oriented | 501580 |
| `/compact` | | local | Free up context by summarizing the conversation so far | disabled by `DISABLE_COMPACT` | 502735 |
| `/config` | `settings` | local | Set a setting by key (`key=value`) | headless form; interactive form is the config dialog | 502743 |
| `/context` | | local + local-jsx | Show current context usage / visualize it as a colored grid | arg `[all]` | 502754 |
| `/copy` | | local-jsx | Copy Claude's last response to clipboard (or `/copy N`) | | 501582 |
| `/daemon` | | local-jsx | Manage background services and routines | | 26578 |
| `/design` | | local | Grant or revoke Claude agent access to your Design projects | policy-gated; also a bundled skill hub | 503068, 274883 |
| `/design-consent`, `/design-revoke` | | local | Grant / revoke Design access | hidden | 503068 |
| `/design-login` | | local-jsx | Authorize design-system access for `/design-sync` | | 503068 |
| `/desktop` | `app` | local-jsx | Continue the current session in Claude Desktop | `claude-ai` | 501589 |
| `/diff` | | local-jsx | View uncommitted changes and per-turn diffs (toggles the diff panel) | | 502762 |
| `/effort` | | local + local-jsx | Set effort level for model usage | | 504361 |
| `/exit` | `quit` | local + local-jsx | (dynamic) exit | terminal-oriented | 504307 |
| `/export` | | local-jsx | Export the current conversation to a file or clipboard | | 504311 |
| `/extra-usage` | | local + local-jsx | Renamed to `/usage-credits` | hidden | 504319 |
| `/fast` | | local + local-jsx | Toggle fast mode | hidden unless available | 503746 |
| `/feedback` | | local-jsx | Send feedback to Anthropic or report a bug | | 501580 |
| `/focus` | | local-jsx | Toggle focus view: just your prompt, summary, and response | needs the fullscreen renderer | 504367 |
| `/fork` | | local-jsx | Copy this conversation into a new background session and keep working here · (variant) Spawn a background agent that inherits the full conversation | two objects, one per feature gate | 503917 |
| `/goal` | | local + local-jsx | Set a goal Claude checks before stopping | arg `[<condition>\|clear]` | 854648 |
| `/heapdump` | | local | Dump the JS heap to `~/Desktop` | hidden, `allow_heap_dump` policy | 503924 |
| `/help` | | local-jsx | Show help and available commands | | 502772 |
| `/hooks` | | local-jsx | View hook configurations for tool events | | 503917 |
| `/ide` | | local-jsx | Manage IDE integrations and show status | arg `[open]` | 502774 |
| `/import` | | local + local-jsx | Import config from another AI coding agent | arg `[codex\|gemini] [--dry-run]` | 502806 |
| `/init` | | **prompt** | Initialize a new CLAUDE.md file with codebase documentation (variant text under `CLAUDE_CODE_NEW_INIT`) | | 503064 |
| `/insights` | | **prompt** | Generate a report analyzing your Claude Code sessions | `disableModelInvocation`, needs workspace | 388332, 504395 |
| `/install` | | local-jsx | Install Claude Code native build | `[--force] [target]` | 4421 |
| `/install-github-app` | | local-jsx | Set up Claude GitHub Actions for a repository | `claude-ai`/`console` | 503073 |
| `/install-slack-app` | | local | Install the Claude Slack app | `claude-ai` | 503073 |
| `/keybindings` | | local | Open your keyboard shortcuts file | | 503068 |
| `/limit-reset` | | local | Reset your session limit now and keep working; once a week, still counts toward your weekly limit | | 504349 |
| `/list-agents` | `peers` | local | List subagents, teammates, and other Claude sessions you can message | | 137601 |
| `/login`, `/logout` | | local-jsx | Sign in / out of your Anthropic account | `DISABLE_LOGIN_COMMAND` / `DISABLE_LOGOUT_COMMAND` | 503068, 503070 |
| `/loops` | | local-jsx | List, create, and delete loops | `isEnabled: () => false` | 503917 |
| `/mcp` | | local + local-jsx | Manage MCP servers | `[reconnect\|enable\|disable [<server>\|all]]` | 503073 |
| `/memory` | | local-jsx | Edit CLAUDE.md files and memory settings | | 502770 |
| `/mobile` | `ios`, `android` | local-jsx | Show QR code to download the Claude mobile app | | 503075 |
| `/model` | | local + local-jsx | Set the AI model for Claude Code | | 504311 |
| `/passes` | | local-jsx | Share a free week of Claude Code with friends (and earn usage credits) | hidden unless eligible | 503910 |
| `/pause-memory` | `memory-pause`, `toggle-memory` | local | Pause automemory for this session | `isEnabled: () => false` in this build | 502770 |
| `/permissions` | `allowed-tools` | local-jsx | Manage allow and deny tool permission rules | | 503746 |
| `/plan` | | local-jsx | Enable plan mode or view the current session plan | `[open\|share\|<description>]` | 503746 |
| `/plugin` | `plugins`, `marketplace` | local-jsx | Manage Claude Code plugins | has `getArgumentCompletions` | 503924 |
| `/plugin-types` | | local | Write `claude-code-mcp.d.ts`: the inputs of the connected MCP tools | `[dir]` | 503924 |
| `/powerup` | | local-jsx | Discover Claude Code features through quick interactive lessons | | 503077 |
| `/privacy-settings` | | local-jsx | View and update your privacy settings | | 503917 |
| `/pro-trial-expired` | | local-jsx | Options shown when the Pro plan trial has ended | hidden | 504319 |
| `/radio` | | local | Listen to Claude FM lo-fi radio | | 503952 |
| `/rate-limit-options` | | local-jsx | Show options when rate limit is reached | hidden | 504319 |
| `/recap` | | local | Generate a one-line session recap now | | 849588 |
| `/release-notes` | | local-jsx | View release notes | | 503077 |
| `/reload-plugins` | | local | Activate pending plugin changes in the current session | `[--force]`, terminal-oriented | 503924 |
| `/reload-skills` | | local | Pick up skills added or changed on disk during this session | | 503924 |
| `/remote-control` | `rc` | local-jsx | Control this session from your phone or claude.ai/code (or disconnect) | | 93774 |
| `/remote-env` | | local-jsx | Choose the default environment for cloud agents | | 504315 |
| `/rename` | `name` | local + local-jsx | Rename the current conversation | | 503077 |
| `/resume` | `continue` | local-jsx | Resume a previous conversation | `[conversation id or search term]` | 503079 |
| `/rewind` | `checkpoint`, `undo` | local | Restore the code and/or conversation to a previous point | interactive only | 503924 |
| `/scroll-speed` | | local-jsx | Adjust mouse wheel scroll speed | terminal-dependent | 503095 |
| `/session` | `remote` | local-jsx | Show cloud session URL and QR code | hidden unless the `fanout` gate | 503093 |
| `/setup-bedrock`, `/setup-vertex` | | local-jsx | Reconfigure Bedrock / Vertex auth, region, model pins | hidden unless the provider env is set | 503079, 503081 |
| `/skill-doctor` | | local + local-jsx | Show which loaded skills are unused and costing context | | 503742 |
| `/skills` | | local-jsx | List available skills | | 503100 |
| `/status` | | local-jsx | Show Claude Code status: version, model, account, API connectivity, tool statuses | | 503100 |
| `/stickers` | | local | Order Claude Code stickers | | 503952 |
| `/stop` | | local + local-jsx | Stop this background session; transcript and worktree are kept | background sessions only | 849708 |
| `/subtask` | | local-jsx | Send a subagent off with your full context; its result comes back here | | 503917 |
| `/tasks` | `bashes` | local-jsx | View and manage everything running in the background | | 503100 |
| `/teleport` | `tp` | local-jsx | Send this session to the cloud, or resume one from claude.ai | `allow_remote_sessions` | 503100 |
| `/terminal-setup` | | local-jsx | (dynamic) install Shift+Enter binding / iTerm2 clipboard access | | 503310 |
| `/theme` | | local-jsx | Change the theme | | 503744 |
| `/tui` | | local-jsx | Set the terminal UI renderer (`default \| fullscreen`) | | 503746 |
| `/ultraplan` | | local-jsx | Draft an editable plan in Claude Code on the web | `<prompt>` | 503738 |
| `/ultrareview` | | local + local-jsx | (dynamic) cloud review | | 503087 |
| `/update` | `restart` | local | Switch to the latest version (conversation continues) | hidden, `isEnabled: () => false` | 504311 |
| `/upgrade` | | local-jsx | Upgrade to Max for higher rate limits and more Opus | `claude-ai` | 504317 |
| `/usage` | `cost`, `stats` | local + local-jsx | Show session cost, plan usage, and activity stats | one command, three names | 503740 |
| `/usage-credits` | | local + local-jsx | Configure usage credits or request them from your admin | | 504317 |
| `/version` | | local + local-jsx | Print the version this session is running | `isEnabled: () => false` in this build | 503931 |
| `/vim`, `/output-style` | | redirect | `/<name> moved → Editor mode \| Output style in /config` — opens the Config dialog | **replaced** | 96665 |
| `/voice` | | local | Toggle voice mode | `[hold\|tap\|off]`, `claude-ai` | 503075 |
| `/web-setup` | | local-jsx | Set up Claude Code on the web with your GitHub account | `claude-ai` | 184696 |
| `/wellbeing` | `breaks`, `break-reminder`, `downtime` | local-jsx | Configure optional break reminders and quiet-hours nudges | `isEnabled: () => false` | 504367 |
| `/workflows` | | local-jsx | Browse running and completed workflows | | 826977 |
| `/__remote-workflow` | | local | Run the workflow script delivered in this session environment | **hidden**, `disableModelInvocation` | 504317 |
| `/workflow-launch-exec` | | local | Execute a server-launched workflow handoff | **hidden**, `disableModelInvocation` | 504317 |

Built-in **prompt** commands (not skills):

| command | notes | anchor |
|---|---|---|
| `/init` | bundled CLAUDE.md-authoring prompt | 503064 |
| `/insights` | `disableModelInvocation: true`, needs workspace | 504395 |
| `/team-onboarding` | `disableModelInvocation: true`, `allow_team_onboarding` policy, effort `low` | 380857 |
| `/commit-push-pr` | "Commit, push, and open a PR"; `getAllowedTools` computed | 502719 |
| `/security-review` | proxied through a built-in plugin (`VDt`, 503103) that installs `security-review@…` on first use; the fallback prompt is inlined at 503111 with `allowed-tools: …, Read, Glob, Grep, LS, Task` | 503300 |

**Enterprise-upsell stubs** (`T0`, 503965) — hidden, non-interactive-disabled placeholders that print
"available with Claude for Enterprise": `/ultraplan`, `/ultrareview`, `/teleport`,
`/remote-control`, `/schedule`, `/autofix-pr` (503972).

**Nine `{isEnabled:()=>false, isHidden:true, name:"stub"}` entries** appear in the registry
(501580, 503936, …) — features compiled out of the external build. Their real names are visible only
in the category map `kn` (209408), which additionally lists `ant-trace`, `debug-tool-call`,
`input-debug`, `render-debug`, `mock-limits`, `simulate-usage`, `reset-limits`, `low-priority`,
`thrash`, `oauth-refresh`, `perf-issue`, `experiments`, `env`, `issue`, `sandbox`, `channel`,
`onboarding`, `autopilot`, `bugfix`, `dashboard`, `docs`, `investigate`. **INFERRED** that these are
first-party/dev-only.

MCP prompts are synthesized as commands named `mcp__<server>__<prompt>` with aliases
`<server>:<prompt>` and `<server>:<prompt> (MCP)` (30524). Required-argument checking happens in
`getPromptForCommand`, producing `Missing required argument(s): … Usage: /mcp__x__y <args>`.

---

## 6. Custom commands (`.claude/commands/*.md`)

### 6.1 Discovery

`CMn` (469497) loads, in this order:
- user level: `~/.claude/commands/**` (via `q8("commands", …)`),
- project level: `<dir>/.claude/commands/**` for the cwd and every additional working directory.

Each loaded file becomes a `type:"prompt"` command with `loadedFrom: "commands_DEPRECATED"` (469508)
— the name the binary itself uses for the legacy directory. Ordering is by name; a directory that
contains a `SKILL.md` collapses to that one file (`wMn`, 469460).

### 6.2 Naming and namespacing

`vMn` (469491): the command name is the file's basename minus `.md`, prefixed by its directory path
relative to the commands root with `/` replaced by `:` (`Cft`, 469479). So
`.claude/commands/git/review.md` → `/git:review`, reachable also as `/git review` via colon promotion
(§5.1 step 4). A `SKILL.md` inside `commands/` uses its *directory* name instead (`TMn`, 469487).

A `name:` in frontmatter overrides the leaf, but is force-prefixed with the resolved namespace if it
does not already carry it (504048): `Ie = Ee.startsWith(Pe) ? Ee : Pe + Ee`.

### 6.3 Frontmatter

Parsed by `Vne` (469208) for skills/commands and by `Vq` (504040) for plugin commands. Recognized keys:

| key | type | effect |
|---|---|---|
| `name` | string | display name / namespaced override |
| `description` | string | listing text; falls back to the first content line (`gee`) |
| `when_to_use` / `when-to-use` | string | appended to the description as `desc - whenToUse` (470207) |
| `model` | string | model override; `inherit` keeps the session model |
| `effort` | enum or int | per-invocation effort; invalid values warn and are dropped |
| `allowed-tools` | string or string[] | permission grant scoped to this command; `${CLAUDE_SKILL_DIR}` / `${CLAUDE_PROJECT_DIR}` expanded (469246) |
| `disallowed-tools` / `disallowedTools` | string or string[] | deny list |
| `argument-hint` | string | completion hint |
| `arguments` | list | named positional args → `$name` substitution |
| `disable-model-invocation` | bool | the model may not call it; user-only |
| `user-invocable` | bool (default true) | false ⇒ `isHidden`, model-only |
| `version` | string | informational |
| `hooks` | object | skill-scoped hooks (skills/plugin skills only) |
| `context` | `"fork"` | run the body in a subagent instead of inline |
| `agent` | string | agent type to fork into |
| `background` | bool | launch the fork detached |
| `paths` | glob[] | **conditional skill** — hidden until a matching file is touched |
| `shell` | `bash`\|`powershell` | which shell `!\`…\`` blocks use |
| `metadata` | object | passthrough |
| `fallback` | bool | fallback selection |
| `created_by` / `improved_by` | `"dream-proposal"` | provenance marker |
| `hide-from-slash-command-tool` | bool | present in the accepted-key list (31407); effect not traced |

The full accepted-key allowlist is `L` at 31407 (commands/skills/agents) and `dS` at 529054
(plugins), used for `has_<key>` telemetry.

### 6.4 Argument substitution

`fA(body, args, appendIfUnused, argNames, escape)` (468890). Order of operations:

1. Sentinel-escape the body so injected text can't spoof the substitution machinery
   (`DN`/`wz` markers).
2. Named args from `arguments:`, longest name first: `$name` (not followed by `[` or a word char).
3. `$ARGUMENTS[n]` — index into whitespace-split args; out-of-range leaves the literal.
4. `$n` (`$1`, `$2`, …) — same, out-of-range leaves the literal.
5. `$ARGUMENTS` — the whole arg string.
6. If **nothing** was substituted and args were supplied, append `\n\nARGUMENTS: <args>` (468912).

`\$` escapes a substitution (468902). Every substituted value is wrapped in sentinels and its `$`
characters neutralized, so user args cannot introduce new placeholders.

Other tokens expanded at invoke time (469242, 504070):
`${CLAUDE_SKILL_DIR}`, `${CLAUDE_PROJECT_DIR}`, `${CLAUDE_SESSION_ID}`, `${CLAUDE_EFFORT}`,
`${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`, `${user_config.KEY}`.

### 6.5 Inline shell: `` !`cmd` `` and ` ```! ` blocks

`KG` (469097–469121):

- Two forms: a fenced ```` ```! … ``` ```` block (`dMn`) and inline `` !`…` `` (`pMn`, 469072).
- Shell selection: `shell: bash` requires Git Bash on Windows and throws a specific install
  instruction otherwise (469102); `shell: powershell` uses the PowerShell tool.
- **Every** command goes through the normal Bash permission check (`Dd`, 469108). A denial throws
  `Shell command permission check failed for pattern "<raw>": <message>`. On a connection where
  detail must be withheld, the message is redacted (469112).
- `allowed-tools` from frontmatter is injected as `alwaysAllowRules.command` for the duration of the
  expansion (`gA`, 469084) — that is how `allowed-tools: Bash(git status:*)` pre-approves the block.
- Output is `stdout` then `[stderr]\n…` (`Vmt`, 469123).
- Kill switches: `disableSkillShellExecution` in policy or user settings, and
  `CLAUDE_CODE_IS_COWORK`, replace every block with
  `[shell command execution disabled by policy]` (`$ne`/`LN`, 469077).
- A coordinator loading a skill read-only replaces them with
  `[shell command not executed: read-only skill load on the coordinator — delegate to a worker]`
  (469098).
- MCP-sourced skill bodies are never shell-expanded (`Qce`, 469158/469253).

`@file` references are handled by the generic attachment/mention pipeline on the assembled prompt,
not by the command loader. **INFERRED** — no command-loader-specific `@` handling was found.

### 6.6 The `Skill` tool (formerly SlashCommand)

Name constant: `Do = "Skill"` (296213). Tool object `q4e` at 470381.

- Input schema: `{ skill: string, args?: string }` (470375). `skill` is documented as
  *"The name of a skill from the available-skills list. Do not guess names."*
- Output schema is a union: inline (`{success, commandName, allowedTools?, model?, status:"inline",
  readOnly?}`) or forked (`{success, commandName, status:"forked", agentId, result, background?}`)
  (470377).
- `maxResultSizeChars: 1e5`.
- Tool prompt `Vft` (470282) — the full text is in the binary; it explains progressive disclosure
  ("the skill's instructions load into the turn … some skills instead run in a subagent"), the
  `plugin:skill` naming, directory-scoped variants (`apps/web:deploy`, "most specific wins"), and
  states explicitly that **built-in CLI commands (`/help`, `/clear`, …) aren't skills**. A coordinator
  suffix `QMn` (470288) adds the read-only-load semantics.
- Validation (`validateInput`, 470385) error codes: `1` empty name, `2` not found (with a
  Levenshtein ≤2 "did you mean", 470401), `9` fork recursion, `10` could not be downloaded,
  `11` deny rule, `12` MCP prompt, `13` sync vetoed; plus `disable_model_invocation`,
  `not_allowlisted`, `override_disabled`, `not_prompt_type` reasons (470403–470420).
- A leading `/` on the name is stripped and counted (`tengu_skill_tool_slash_prefix`, 470389).
- Permissions (`checkPermissions`, 470425): deny rules first, then allow rules, then auto-allow for
  "safe" prompt skills, else `ask` with two suggested rules —
  `{toolName:"Skill", ruleContent:"<name>"}` and `{…, ruleContent:"<name>:*"}` at `localSettings`.

**Listing budget** (`hSe`, 470200):

```js
budget = env.SLASH_COMMAND_TOOL_CHAR_BUDGET
      || floor((contextWindow ?? 200000) * 4 /*bytes-per-token*/ * (settings.skillListingBudgetFraction ?? 0.01))
```
≈ **8,000 characters** by default. Per-description cap
`skillListingMaxDescChars` default **1536** (`qMn` 470193, `VIe()` 470194).

When the listing exceeds the budget (`egt`/`Kft`, 470249/470214) the harness degrades gracefully:
name-only entries and **bundled** skills keep their descriptions unconditionally; the remainder are
sorted by a usage-frequency score and lose their descriptions from the least-used up, until the
listing fits. It logs `Skill listing over budget: N skills, C chars > B budget — descriptions will be
truncated. Run /skills to disable some, or raise skillListingBudgetFraction in settings.` (470259).

Injection is a `<system-reminder>` attachment: `The following skills are available for use with the
Skill tool:\n\n<listing>` (518633), plus a delta reminder when new skills appear mid-session:
`New skills discovered in <dir>, now available via the Skill tool:` (518646).

---

## 7. Skills

### 7.1 Discovery locations

`RMn` (469587) resolves, and merges in this order (later wins on name collision except synced):

1. **policy/managed**: `<policyDir>/.claude/skills` (source `policySettings`) — skipped if
   `CLAUDE_CODE_DISABLE_POLICY_SKILLS`.
2. **user**: `~/.claude/skills` (source `userSettings`).
3. **synced team skills**: `~/.claude/skills/synced/<orgId>` (`l3 = "synced"`, 245274; source
   `syncedSkills`) — dropped whenever a local or plugin skill owns the same name (469599).
4. **project**: `.claude/skills` in the cwd and each project root (source `projectSettings`).
5. **additional working dirs**: `<dir>/.claude/skills`.
6. **legacy commands**: `~/.claude/commands` + `<dir>/.claude/commands` (`commands_DEPRECATED`).

Plus, loaded separately and merged in `_rr` (504508):
7. **plugin skills** (`dpt`) — `<pluginRoot>/skills/*/SKILL.md` plus manifest-declared dirs.
8. **bundled skills** (`One()`, 767547) — compiled into the binary.
9. **built-in plugin skills** (`hNt()`, 424395) — skills owned by enabled `@builtin` plugins.

Deduplication is by **realpath** (`yMn` → `Rz`), so the same file reached through two roots loads
once (469620). Then `krr(sz([...]))` resolves name conflicts across all sources (504520).

A skill directory that itself contains `.claude-plugin/plugin.json` is treated as a plugin under the
pseudo-marketplace `skills-dir` (`Zc = "skills-dir"`, 551738; check at 469263).

### 7.2 SKILL.md structure

`SKILL.md` = YAML frontmatter (§6.3 keys) + markdown body. The body is prefixed at invoke time with
`Base directory for this skill: <dir>\n\n` (469253). `${CLAUDE_SKILL_DIR}` inside the body and inside
`allowed-tools` resolves to that directory.

Skills served by an MCP server get a different preamble explaining how to read their supporting files
via the MCP resource tools (`SMn`, 469227).

### 7.3 Progressive disclosure

Two levels, exactly as the tool prompt describes:
- **metadata in context**: `- <name>: <description>[ - <whenToUse>]`, one line per skill, inside the
  `skill_listing` system-reminder, subject to the budget above.
- **body on invoke**: `getPromptForCommand` reads and templates the markdown only when the Skill tool
  (or a user `/name`) fires.

Conditional skills (`paths:` frontmatter) are a third level: they are parsed and stored but held out
of the listing until a file matching one of their globs is touched, at which point a
`dynamic_skill` system-reminder announces them (469637, 518640). `vft` (469205) normalizes the globs
(strips a trailing `/**`) and refuses a `paths` of only `**`.

### 7.4 Forked-context skills

`context: fork` (or `agent:`) routes the invocation through `eIn` (470335):

1. `makeFileHistorySnapshot` before running; the fork gets `shareFileHistory: true` (470358).
2. A fresh `agentId` (`Th()`), `agentType: "subagent"`, depth = parent depth + 1.
3. `pdt` builds the fork's context: replaced command rules, frozen command denies, its own
   `readFileState`, an availability-filtered tool set.
4. If `background` is set, it returns immediately with
   `Running in the background as @<name>` and `background: true` — the result arrives later as a task
   notification (470349).
5. Otherwise it drives an inner `Bb()` loop with `querySource: "agent:custom"`,
   `spawnedByForkedSkill: true`, streaming `skill_progress` events upward (470364), and returns the
   final text.
6. Re-invoking the same skill from inside its own fork is refused with error code 9 and the message
   *"you are the subagent running it. Execute the instructions in the skill body directly"* (470410).

Telemetry per invocation: `tengu_skill_tool_invocation` with `command_name`, `skill_name` hash,
`execution_context`, `invocation_trigger` (`claude-proactive` | `nested-skill`), `query_depth`,
`skill_content_chars`, and plugin provenance (470340).

### 7.5 `/name` invocation of a skill

Identical dispatch to any other `prompt` command (§5.1). The difference is only in provenance:
`ua(name, commands)` finds the skill object, `Emt(cmd, args, ctx) === "fork"` decides inline vs fork,
and `oTe(ctx)` marks a coordinator read-only load (470440). A skill with
`user-invocable: false` is `isHidden` and refuses `/name`; a skill with
`disable-model-invocation: true` refuses the Skill tool but allows `/name`
(76537: *"Skill \"…\" is user-invocable only (disable-model-invocation)"*).

Skills can be turned off per name: `"skillOverrides": {"<name>": "off"}` in
`.claude/settings.local.json` (project skill) or `~/.claude/settings.json` (user skill) — the exact
guidance the bundled `doctor` skill prints (215452). Resolution order local → project → user at
279094. `/skills` writes these overrides (279722, 280060).

### 7.6 Bundled (built-in) skills

`registerBundledSkill` (`Zr`, 767539) turns a declaration into a `type:"prompt"` command with
`source:"bundled"` and pushes it into `To().bundledSkills`. Fields it accepts beyond the frontmatter
set: `menuDescription`, `whenToUse`, `subcommands`, `subcommandsBareOnly`, `getAllowedTools`,
`getEffort`, `getDefaultEffort`, `files`, `survivesBundledKillSwitch`, `disableBridgeInvocation`,
`policyGate`, `requires`, `terminalOriented`.

`files` is a `{relativePath: contents}` map (or a lazy loader returning one). On first invocation it is
extracted to a temp dir under the bundled-skills root (`~/.../bundled-skills/<name>`,
248997) using hardened writes: `O_CREAT|O_EXCL|O_NOFOLLOW`, mode 0600 for files and 0700 for
directories, path-escape rejection (`P()`, 767445), and `tolerateExisting: "verify-content"` — an
existing file is accepted only if its bytes match (767470). The prompt is then prefixed with
`Base directory for this skill: <dir>` (767525).

There is a kill switch: `iy()` filters the list down to skills with
`survivesBundledKillSwitch: true` (767549) — of which `/doctor` is one (215559).

Registered in `Get()` (216587). The catalog:

| bundled skill | menu description / role | anchor |
|---|---|---|
| `artifact-capabilities` | Runtime capabilities for published Artifacts | 213895 |
| `workshop` | Build a design together, one decision at a time | 213936 |
| `artifact-components` | Embed reusable components in an Artifact | 213954 |
| `artifact-design` | Design guidance for Artifacts | 213972 |
| `artifact-diagramming` | Diagramming guidance for Artifacts | 213979 |
| `artifact-dashboard`, `artifact-report`, `artifact-data-table`, `artifact-explainer` | template-backed artifact kinds (loop over `Mn`) | 213994 |
| `artifact-pr-review` | Publish a PR review briefing Artifact from a template | 215888 |
| `batch` | Plan a large change; background agents each open a PR | 214091 |
| `claude-in-chrome` | Let Claude browse and interact with pages in your Chrome | 214350 |
| `code-review` (alias `review`, subcommand `ultra → ultrareview`) | Review the current diff or a PR for bugs and cleanups | 215143 |
| `commit` | Create a git commit | 215227 |
| `cowork-plugin` | (not user-invocable) remote-cowork only | 215237 |
| `dataviz` | Chart and dashboard design guidance | 215253 |
| `debug` | Enable debug logging for this session and help diagnose issues; `allowed-tools: Read, Grep, Glob`; `disableModelInvocation` | 215266 |
| `design-sync` | Push your design system components to claude.ai/design | 215387 |
| `design` | Hub for Claude Design — routes `sync`/`login` to their commands | 274883 |
| `doc` | Publish a working document Artifact (loop over `bs`) | 215739 |
| `doctor` (alias `checkup`) | Health-check your setup and fix issues; `survivesBundledKillSwitch`, terminal-oriented, needs workspace | 215559 |
| `explain-usage` | See where this session's tokens went, in plain words | 215572 |
| `fewer-permission-prompts` | Pre-approve safe read-only commands based on your usage | 215587 |
| `keybindings-help` | Customize keyboard shortcuts / `~/.claude/keybindings.json` | 215657 |
| `memory-types` | Full reference for the memory type taxonomy | 215705 |
| `plan-artifact` | Publish a plan as a shareable Artifact | 215715 |
| `whiteboard`, `whiteboard-mp` | Pair / sketch on a live whiteboard Artifact | 215760, 215779 |
| `prototype` | Prototype an idea as a working Artifact | 215796 |
| `pr` | Create a GitHub pull request | 215877 |
| `simplify` | Clean up the changed code without changing behavior | 215979 |
| `update-config` | Change settings: hooks, permissions, environment variables | 216540 |
| `verify` | Verify a code change end-to-end by exercising it | 216576 |
| `run` | Launch this project's app to see your change working | 550673 |
| `run-skill-generator` | Create a skill that knows how to run this project's app | 195829 |
| `design` (canvas) | Draft a design on a canvas Artifact | 550415 |
| `setup-cowork` | Guided setup — pick a role, install a plugin, try a skill | 628314 |
| `claude-api` | Build and debug apps that use the Claude API; `allowed-tools: Read, Grep, Glob, WebFetch`; disabled by `CLAUDE_CODE_DISABLE_CLAUDE_API_SKILL` | 650750 |
| `claude-code-docs` | Answer questions about Claude Code features and settings; disabled by `CLAUDE_CODE_DISABLE_CLAUDE_CODE_SKILL` | 624077 |
| `loop` (alias `proactive`) | Repeat a prompt or command on an interval | 85805 |
| `schedule` (alias `routines`) | Create and manage routines: cloud agents on a schedule | 123403 |
| `workflow-authoring` | Reference for writing a Workflow tool script | 850690 |

The extracted bundle confirms the file payloads: 60 `.md` + 97 `.md.zst` + 12 `.txt` modules,
covering the `claude-api` reference set (`models-*.md`, `batches-*.md`, `files-api-*.md`,
`managed-agents-*.md`, `cost-optimization`, `model-migration`, `error-codes`), the `dataviz` set
(`palette`, `color-formula`, `marks-and-anatomy`, `choosing-a-form`, `interaction`), plugin-eval docs,
and artifact worker sources (`artifact-plan.html`, `artifact-workshop.html`, `board.mjs`, `css.mjs`, …).

**No PDF/DOCX/XLSX/PPTX skills are bundled in 2.1.251** — those are claude.ai-side, not CLI.

---

## 8. Plugins

### 8.1 `plugin.json`

Location `<pluginRoot>/.claude-plugin/plugin.json`, size cap `Sk` (checked at 469263). Schema is the
intersection `jpe` (184423) of ~16 partial schemas. Fields:

**Identity** (`Cs`, 184401): `$schema`, `name` (required; no spaces, kebab-case), `displayName`,
`version` (semver), `description`, `author`, `homepage` (URL), `repository`, `license` (SPDX),
`keywords[]`, `defaultEnabled` (bool, default true), `dependencies[]`.

**Components** — each accepts a path, a list of paths, or an inline definition; **declaring a path
suppresses the corresponding auto-loaded directory** except where noted:

| key | auto-dir | notes | anchor |
|---|---|---|---|
| `commands` | `commands/` | path, list, or `{name: {source\|content, description, argumentHint, model, allowedTools}}`; a map key becomes `/plugin:name` | 184401 (`Rs`, `Ds`) |
| `agents` | `agents/` | path or list | 184401 (`Us`) |
| `skills` | `skills/` | **additive** — declared dirs load *in addition* to `skills/` (except for a marketplace entry whose source is the marketplace root) | 184401 (`Es`) |
| `hooks` | `hooks/hooks.json` | **additive** — path, inline, or list | 184401 (`zs`) |
| `outputStyles` | `output-styles/` | | 184401 (`ct`) |
| `themes` | `themes/` | | 184401 (`pt`) |
| `workflows` | `workflows/` | dir or `.js` file | 184401 (`Ls`) |
| `mcpServers` | `.mcp.json` | **additive** — path, MCPB file/URL, inline map, or list | 184401 (`js`) |
| `lspServers` | `.lsp.json` | inline map: `{command, args[], extensionToLanguage{.ext→lang}, transport: stdio\|socket}` | 184405 (`Ws`, `uYe`) |
| `monitors` | `monitors/monitors.json` | background watch scripts armed as persistent Monitor tasks, "unsandboxed, same trust tier as hooks" | 184405 (`mt`) |
| `channels` | — | `[{server, displayName?, userConfig?}]`; binds an MCP server as a message channel | 184401 (`Bs`) |

**Configuration**:
- `userConfig` (`Fs`, 184401): `{KEY: {type: string|number|boolean|directory|file, title, description,
  required?, default?, multiple?, sensitive?, min?, max?}}`. Keys must be identifiers because they
  become `CLAUDE_PLUGIN_OPTION_<KEY>` env vars in hooks. Values are referenced as `${user_config.KEY}`
  in MCP/LSP config, hook commands, and (non-sensitive only) skill/agent content. `sensitive: true`
  routes the value to keychain/credentials instead of `settings.json`.
- `settings` (`Ys`, 184423): a map merged into user settings while the plugin is enabled — "only the
  documented allowlisted keys are applied".
- `binaries` (`qs`, 184423): `{basename: {sha256}}`, fetched into `bin/` at install time, max 64
  entries, name pattern `^[a-z0-9](?:[a-z0-9._-]*[a-z0-9_-])?$`.
- `experimental` (`Vs`, 184423): a passthrough bag for keys whose shape may change without
  deprecation, plus `evals` (an eval-case directory for `claude plugin eval`).

`${CLAUDE_PLUGIN_ROOT}` → the plugin's install path; `${CLAUDE_PLUGIN_DATA}` → a per-source data dir
(423619, 461307). Hook commands may reference only `${CLAUDE_PLUGIN_ROOT}` when the hook came from a
*skill* rather than a plugin; `${CLAUDE_PLUGIN_DATA}` is plugin-only and throws otherwise (494746).

Directory sniffing: a directory is plugin-shaped if it contains `.claude-plugin/` or any of
`commands, skills, agents, hooks, themes, output-styles, monitors, workflows`, or one of
`SKILL.md, .mcp.json, .lsp.json` (`lgn`/`Dt`/`gTe`, 31928).

### 8.2 `marketplace.json`

Location `<root>/.claude-plugin/marketplace.json` (also accepted: `<root>/marketplace.json`, or the
file itself; 357288, 446764). Schema `fCe` (184544):

```
{ $schema?, name, version?, description?, owner,            // owner is required
  plugins: MarketplaceEntry[],
  forceRemoveDeletedPlugins?: bool,                          // auto-uninstall + flag on removal
  metadata?: { pluginRoot?, version?, description? },
  allowCrossMarketplaceDependenciesOn?: string[],            // root marketplace's allowlist only; no transitive trust
  renames?: { oldName: newName | null } }                    // append-only migration map
```

`metadata.pluginRoot` rewrites bare `source` names to `./<pluginRoot>/<name>` (`PAn`/`IAn`, 184536).
A bare name without `pluginRoot` is rejected with an explicit message (`ln`, 184516).

**Entry** (`DTt`, extends the whole plugin manifest partially, 184521):

```
{ name, source, headers?, headersHelper?, category?, tags?,
  strict? (default true), relevance?, ...any plugin.json field }
```

- `strict: true` requires the plugin's own manifest to exist in the folder; `false` means this entry
  *is* the manifest. An entry using `headersHelper` **must** be `strict: false` so consent is informed
  before the command runs (184523).
- `source` union (`ft`, 184405): a `"./relative/path"` string, or one of
  `{source:"npm", package, version?}`, `{source:"url", url, headers?, headersHelper?}`,
  `{source:"github", …}`, `{source:"git-subdir", …}`, `{source:"archive", url, sha256?}`,
  `{source:"command", …}`. Unknown sources become `{source:"unsupported", error}` stubs rather than
  dropping the entry (184476).
- `archive` hardening: HTTPS only, and the hostname must not be loopback, link-local, or a
  cloud-metadata address (`PTt`/`Zqt`, 184430–184468). A single wrapping directory in the zip is
  stripped. `sha256` is verified on every download and, absent a `version`, serves as version
  identity — *changing only the digest while a version is declared does not trigger an update*
  (184458).
- `relevance` (`eGt`, 184505): `{cli[], hosts[], filesRead[], manifestDeps[{file,pattern}], cwd[]}` —
  signals that surface the plugin in the spinner tip, session-start auto-suggest, and browse ranking.
  `cwd` is known at session start, so it can suggest before the first turn.

Unparseable entries are stubbed by name with a truncated reason (max 3 issues, 160 chars each;
`nGt`, 184490).

### 8.3 On-disk plugin state

```
~/.claude/plugins/
  installed_plugins.json     { version: 2, plugins: { "<plugin>@<marketplace>": [ { scope, version,
                               installPath, installedAt, lastUpdated, gitCommitSha, projectPath } ] } }
  known_marketplaces.json    { "<name>": { source, installLocation, lastUpdated } }
  flagged-plugins.json
  plugin-catalog-cache.json
  .last_inuse_sweep
  marketplaces/<name>/…      cloned marketplace tree (20,000-entry listing cap, `le`, 34519)
  cache/<marketplace>/<plugin>/<version>/…    installed payload
  asset-cache/<sha256>       fetched binaries/assets
```
(35239–35248; `ye` map at 34762; shapes confirmed against a live install — keys only.) Note the
per-plugin value is an **array**, one element per install scope, which is how the same plugin is
installed at user *and* project scope simultaneously.

### 8.4 Enable/disable persistence

`enabledPlugins: { "<plugin>@<marketplace>": true|false }` in settings, resolved across layers with
project/local overriding user (211438–211468, 211788). Removing a plugin writes `undefined` rather
than `false` (211620). A plugin required by an enabled dependent is enabled regardless of
`defaultEnabled` (184401). Managed settings can lock a name, in which case a same-named local copy
simply never loads and the UI says so (242028).

Built-in plugins live under the pseudo-marketplace `builtin` (`Fh = "builtin"`, 551738) and are keyed
`<name>@builtin` (424386); some are `enabledFromTrustedSettingsOnly`. `Sct()` (424382) partitions
them into enabled/disabled; `hNt()` (424395) harvests their skills.

### 8.5 `/plugin` and `claude plugin`

Interactive help text (281086):

```
Installation:  /plugin install [<marketplace>|<plugin>|<plugin>@<market>]
Management:    /plugin list [--enabled|--disabled] · manage · stats · enable <p> · disable <p>
               /plugin configure <p>   (set userConfig options)
               /plugin uninstall <p>
Marketplaces:  /plugin marketplace [add [<path/url>] | update [<name>] | remove [<name>] | list]
Validation:    /plugin validate <path>
               /plugin tag [path] [--push] [--dry-run] [-f]
Other:         /plugin · /plugin help · /plugins (alias)
```

`/plugin validate` (280520) accepts a manifest file or a directory; given a directory it prefers
`marketplace.json` over `plugin.json`, and with no manifest validates the components
(`skills`/`agents`/`commands`, or everything under `.claude`). Same as `claude plugin validate <path>`.

CLI operations with distinct failure telemetry: `install`, `uninstall`, `enable`, `disable`,
`disable --all`, `update`, `prune` (`mg`, 526148). Built-in plugins refuse install/update/uninstall
and direct the user to `claude plugin enable|disable` (211400). A `headersHelper` install must be
confirmed by running `claude plugin install` in a terminal, or with `-y/--yes` (211556).

The `/plugin` UI has three tabs — Discover, Installed, Stats (281100).

---

## 9. Memory

### 9.1 CLAUDE.md

- User memory: `~/.claude/CLAUDE.md`, addressed through the `state` namespace as id `user-memory`
  (34463).
- Project memory: `CLAUDE.md` files discovered up the tree and in `.claude/`; nested files are
  injected as `nested_memory` system-reminders — `Contents of <path>:\n\n<content>` (518620).
- Editing UI: `/memory` — *"Edit CLAUDE.md files and memory settings"* (502770). A size warning fires
  when a memory file exceeds its char limit: `<file> is over the <N>-char limit (<M> chars) · /memory
  to free …` (17817). `/doctor` reports `Memory files using <N> tokens (<pct>%) … Largest: <file>.
  Use /memory to review and prune stale entries.` with a 30% estimated saving (848262).
- **The `#` prefix shortcut is gone.** No handler for a leading `#` in the prompt submission path was
  found in 2.1.251; the only `#`-stripping code is PowerShell comment handling (26825). Memory is now
  written by the model through the auto-memory tools, or by hand via `/memory`. **INFERRED** from
  absence.
- `/init` is the CLAUDE.md bootstrapper (503064), with a variant description under
  `CLAUDE_CODE_NEW_INIT` that also creates skills/hooks.

### 9.2 Auto-memory (the memory directory)

Resolution (`Inr.resolve`, 310606):

```
CLAUDE_COWORK_MEMORY_PATH_OVERRIDE
  ?? settings.autoMemoryDirectory  (policy > flag > local > project > user, 310588)
  ?? ~/.claude/projects/<projectKey>/memory/          // z7 = "memory", 310566
```
normalized NFC. Disabled by `CLAUDE_CODE_DISABLE_AUTO_MEMORY` or `autoMemoryEnabled: false`
(telemetered as `tengu_memdir_disabled`, 245025).

Layout:
- `MEMORY.md` (`Vl`, 244333) — the **index**, always loaded into context, **truncated after 200
  lines** (`YD = 200`). Entries are one line, ≤~150 chars: `- [Title](file.md) — one-line hook`. It
  has no frontmatter and never holds memory content itself (244433).
- One `.md` file per memory (e.g. `user_role.md`, `feedback_testing.md`), each capped at
  **4,096 chars** including frontmatter (`eY = 4096`) — recall shows only the first 4,096 (244457).
- `proposals/` — skill proposals, swept separately (`cleanupOrphanedSkillProposals`, 722637).
- `logs/<YYYY>/<MM>/<DD>/<sessionId[0:8]>[-<slug>].md` — the daily session log
  (`XRr`, 310631; `hD = 8`; slug = 5 words / 40 chars max).

Memory-file frontmatter template (`Wr`, 244383):

```markdown
---
name: {{short-kebab-case-slug}}
description: {{one-line summary, used to decide relevance in future conversations, so be specific}}
metadata:
  type: {{user, feedback, project, reference}}
---

{{memory content — for feedback/project types, structure as: rule/fact, then **Why:** and
**How to apply:** lines. Link related memories with [[their-name]].}}
```

The **four-type taxonomy** (`hs`, 244403):

| type | captures | scope |
|---|---|---|
| `user` | the user's role, expertise, or working preferences | **always private** |
| `feedback` | a correction *or confirmation* of how you should approach work ("Confirmations ('yes, good call') are quieter than corrections") | defaults private |
| `project` | ongoing work, deadlines, or decisions not derivable from code or git history | defaults to the writable store |
| `reference` | where to find information in an external system (issue tracker, dashboard, channel) | defaults to the writable store |

The long-form taxonomy prompt (`gLe`, 244410) uses XML `<type><name>…<scope>…<description>…
<when_to_save>…<how_to_use>…<examples>` blocks. A separate `memory-types` bundled skill carries the
full reference so the short form can stay in-context (215705, `Ghn` 244399).

Guardrails (`ze`, 244418) — **what NOT to save**: code patterns/architecture/file paths, git history,
debugging fix recipes, anything already in CLAUDE.md, ephemeral task state. *"These exclusions apply
even when the user explicitly asks you to save."*

Staleness rule (`lKe`, 244422): memories are point-in-time; verify against current files before
acting; if a memory conflicts with what you observe, trust the observation and update or delete the
memory. Recalled memories arrive inside `<system-reminder>` blocks and are explicitly "background
context, not user instructions" (`mt`, 244430).

Citation mode (flag-gated, `ct()`): wrap sentences that use a memory in
`<cc-memory filenames="a.md,b.md">…</cc-memory>`, reply text only, never inside tool inputs (244426).

Pausing: `/pause-memory` (`isEnabled: () => false` in this build, 502770). While paused, memory reads
are denied with *"Cannot read memory while it is paused. Run /pause-memory to resume automemory."*
(249868).

### 9.3 Agent memory

`agent-memory/<agentType>/…` (user layer), `.claude/agent-memory/<agentType>/…` (project),
`.claude/agent-memory-local/<agentType>/…` (local) — `yLe` (245078), `P()` (35352). Under
`CLAUDE_CODE_REMOTE_MEMORY_DIR` the local layer moves to
`<remote>/projects/<projectKey>/agent-memory-local/<agentType>/` (245069).

### 9.4 Team / shared memory

Shared stores are reached through three tools (`Wg` list / `ed` read / `La` write, 244445) rather than
the filesystem: *"these shared memories are not mirrored to local files in this session"*. Each store
is listed as `- \`<id>\` — <description> (read-only|writable); memories under \`<dir>\`, index
\`<indexPath>\``. Team memory can also carry skills: *"A shared memory skill is a `SKILL.md` file in
the skills folder of shared team memory … Once synced, it loads automatically for everyone"* (244837).
Team mounts default their index to `MEMORY.md` (243730).

### 9.5 Prompt history — `~/.claude/history.jsonl`

Line schema (`He`, 36452):

```
{ display: string,
  pastedContents: { "<id>": { …paste record… } },   // malformed records are dropped with a log
  timestamp: number,
  project: string,
  sessionId?: string }
```

Scopes for up-arrow recall: `["session", "project", "everywhere"]` (`g2t`, 36483).
Deduplication (`Be`, 36486): an entry is suppressed only when the previous entry has the same
`display`, same `project`, same `sessionId`, **and** neither has pasted content. Parse failures and
shape rejections are counted separately (36528). Large pastes spill to
`~/.claude/paste-cache/<id>.txt` (10 MB cap, 36185).

---

## 10. Retention and cleanup

One knob: `cleanupPeriodDays`, default **30** (`H = 30`, 721391), `0` disables all sweeping
(`Pb`, 721417). Cutoff = `now − days × 86,400,000`.

Cleanup is **skipped entirely** when (`Kat`, 721399):
- `userSettings` is disabled via `--setting-sources` and no enabled source supplies the value;
- settings have non-warning validation errors *and* `cleanupPeriodDays` / `desktopSessionCleanupPeriodDays`
  might be set in an unreadable file (`"settings_unknowable"`) or was explicitly set
  (`"settings_invalid_key_set"`). The user-facing line is *"Transcript retention cleanup is paused
  until the settings errors above are fixed"* (272311).
- A `policySettings` value short-circuits to "always safe" (721402).

Sweepers (exports at 398353; generic helpers `M` = delete stale subdirs, `C` = delete stale files by
extension, `F` = delete one stale file):

| target | rule | anchor |
|---|---|---|
| `projects/**/*.jsonl` | per-file mtime; a desktop-released exemption can spare a transcript (`.desktop-released.json`, grace window) | 721692 |
| `file-history/<sessionId>/` | whole bucket by dir mtime | 722040 |
| `tasks/<listId>/` | whole bucket | 722046 |
| `session-env/<hash>/` | whole bucket | 722043 |
| `uploads/`, `jobs/`, `scratch/` | whole buckets (jobs excludes live PIDs from `daemon/roster.json`) | 722049, 722353 |
| `shell-snapshots/*.sh` | by extension | 722286 |
| `debug/*` (except `latest`) | per file | 722430 |
| `telemetry/`, `telemetry/runs/*.json`, `dump-prompts/*.jsonl` | per file | 722278, 722283 |
| `backups/` | per file | 722426 |
| `plans/*.md` | per file | 721997 |
| `feedback/drafts/*.json` | fixed **30-day** cap regardless of the setting | 722197 |
| `shares/*.zip`, `feedback-bundles/*.zip`, `traces/*.json`, `startup-perf/*` | per file | 722268, 722200 |
| `usage-data/{facets,session-meta}/*.json`, `usage-data/*.html` | per file | 722203 |
| `plugins/marketplaces/**` stale cache-key dirs, `plugins/store/*.json` | per dir | 722157, 722169 |
| `teams/*/inboxes/*.json` | per file | 722288 |
| `daemon.log`, `daemon.log.1`, `daemon/roster.json[.corrupt.*]`, `daemon/dispatch/**`, `daemon/auth/*` | per file | 722320–722410 |
| `todos/`, `statsig/`, `logs/` | **legacy** — deleted, never written | 722603 |
| `projects/**/memory/proposals/`, `<memoryDir>/proposals/` | orphaned skill proposals | 722637 |

Debug logs additionally rotate at 10 MiB (`xar`, 35320).

There is a distinct HIPAA/ZDR mode check in the transcript sweeper (`_h("hipaa") || _h("zdr")`,
721724) that disables the desktop-retention exemption.

---

## 11. Attachments and reminders adjacent to this domain

`skill_listing`, `dynamic_skill`, `nested_memory`, `plan_file_reference`, `opened_file_in_ide` and
~30 sibling reminder builders live in one table at 518620. The two that matter here:

```
skill_listing   → "The following skills are available for use with the Skill tool:\n\n<listing>"
dynamic_skill   → "New skills discovered in <relDir>, now available via the Skill tool:\n- <name>…"
```

`dynamic_skill` refuses to fire for a directory outside the project root or whose relative path
matches an exclusion regex (518637).

---

### Deltas vs the February parity rows

**20 — command system**
- 20.1 says "all ~105 built-ins". 2.1.251's `frr()` registry is ~120 entries, but a meaningful number
  are (a) `local`/`local-jsx` *pairs of the same name*, (b) hidden C4E upsell stubs, (c) nine
  `{name:"stub"}` compiled-out entries. The *user-visible* catalog is smaller than the raw count.
  Enumerating with `supportedCommands()` remains the right advice; the count is not stable.
- New since February: `/goal`, `/recap`, `/focus`, `/brief`, `/btw`, `/subtask`, `/branch`, `/fork`,
  `/background`, `/stop`, `/workflows`, `/list-agents`, `/cloud-plugins`, `/remote-env`,
  `/plugin-types`, `/skill-doctor`, `/reload-skills`, `/limit-reset`, `/auto-mode-setup`,
  `/design*`, `/advisor`, `/artifacts`, `/import`, `/tui`, `/keybindings`, `/heapdump`.
- **Removed / redirected**: `/vim` and `/output-style` now print `moved → … in /config` and open the
  Config dialog (96665). `/agents` is a tombstone that tells you to edit `.claude/agents/`
  (503924). `/pr-comments`, `/migrate-installer` and `/statusline` have no registry entry at all.
  `/version` and `/update` are present but `isEnabled: () => false`.
- 20.5's availability gating is confirmed and now also covers `policyGate` (a named policy plus a
  feature label), which the February row did not mention.

**21 / 21a — command catalog**
- 21a.1's list should drop `/rewind`'s "checkpoint" framing as a separate command — `checkpoint` and
  `undo` are *aliases* of `/rewind` (503924).
- 21a.2 lists `/sandbox`, `/output-style`, `/vim` as live commands. In 2.1.251 `/sandbox` is a
  compiled-out stub, and the other two are redirects.
- 21a.4 lists `/commit` and `/review` as prompt commands. They are now **bundled skills**
  (`commit` at 215227, `code-review` aliased `review` at 215143). `/security-review` is a
  marketplace-backed built-in plugin proxy (503103), not a plain prompt command. `/pr-comments` is
  gone; `/pr` and `/commit-push-pr` exist instead.
- 21a.5: `/cost` and `/stats` are **aliases of `/usage`**, one command object (503740).

**17 — Skill tool**
- 17.1's "Skill tool" is now literally the tool's name (`Do = "Skill"`, 296213) — the
  `SlashCommand` name is retired in the CLI. Anything replicating the tool contract should emit
  `Skill`, and permission rules key on `Skill(<name>)` / `Skill(<name>:*)` (470430).
- 17.3 says "five sources". 2.1.251 loads from **nine**: policy, user, synced-team, project,
  additional-working-dir, legacy `commands/`, plugin, bundled, and built-in-plugin (469587, 504508).
- 17.6's "1%-of-context char budget" is exactly right and now has two settings knobs:
  `skillListingBudgetFraction` (default 0.01) and `skillListingMaxDescChars` (default 1536), plus the
  `SLASH_COMMAND_TOOL_CHAR_BUDGET` env override (470194–470204). The degradation strategy (bundled
  skills keep descriptions; the rest lose them in usage order) is new detail.
- 17.4 forked skills: add `background: true`, which returns a launch acknowledgement and delivers the
  result later as a task notification (470349) — not covered by the February row.
- 17.11's "usage tracking is internal telemetry" understates it: `skillUsage` in `~/.claude.json`
  (279316) is the ranking signal that decides *which descriptions survive the budget*, so it has a
  direct effect on what the model sees.

**28 — plugins**
- 28.5 says the built-in plugin registry is "internal scaffolding (empty at runtime)". In 2.1.251 it
  is populated and load-bearing: `security-review` is shipped as a built-in plugin (503300), and
  `hNt()` harvests built-in-plugin skills into the live skill set (424395).
- The manifest has grown since February: `monitors`, `channels`, `binaries` (sha256-pinned),
  `settings` (allowlisted merge), `experimental.evals`, and `dependencies` are all new manifest keys
  (184423). 28.11 (lspServers) and 28.12 (channels) are confirmed present.
- Marketplace entries gained `relevance` (cli / hosts / filesRead / manifestDeps / cwd signals,
  184505), `renames`, `allowCrossMarketplaceDependenciesOn`, `forceRemoveDeletedPlugins`, and an
  `archive` source with SSRF-hardened HTTPS + sha256 pinning (184458).
- 28.13 ("per-scope multi-installation … CC's install lifecycle") is confirmed by the on-disk shape:
  `installed_plugins.json.plugins["<p>@<m>"]` is an **array** of per-scope records.

**40 — memory**
- 40.1's "the raw memdir layout" is now fully specified: `~/.claude/projects/<projectKey>/memory/`
  with `MEMORY.md` + per-fact files (310607). 40.5's "index truncation + size caps" are 200 index
  lines and 4,096 chars per memory file (244333).
- New and not in the February rows: the **`memory/logs/YYYY/MM/DD/<sessionId8>-<slug>.md` session-log
  tree** (310632) — this is the "KAIROS daily-log variant" of 40.6 and it has a concrete on-disk
  contract now.
- 40.3's four-type taxonomy is confirmed verbatim, and there is a *second* delivery path: the
  `memory-types` bundled skill, so the in-context prompt can stay short (244404).
- The **`#` memory shortcut appears to be gone** — worth a parity-row correction if any row assumed it.

**41 — session state / history**
- 41.3: the transcript is no longer just a file. A session owns a sibling *directory*
  (`subagents/`, `tool-results/`, `<stamp>.cast`) plus project-level siblings (`.ccr-tip.json`,
  `.precompact.json`, `<id>.dir-sync.json`). Anything that "copies a session" must copy the directory.
- 41.7: sidechain transcripts moved from flat files to
  `projects/<pk>/<sessionId>/subagents/<relPath…>/agent-<id>.jsonl`, with a `journal.jsonl` per run
  (35225) — a nesting level the February row did not model.
- 41.9's "50MB-cap silent-skip edge case" is `MAX_TRANSCRIPT_READ_BYTES = 52,428,800` (416046); such
  sessions still *list* (as `isLite`) but do not replay.
- 41.12 (prompt history) now has a concrete schema and three recall scopes (36452, 36485).
- The line envelope has grown well past the February field list: `logicalParentUuid`, `promptId`,
  `agentId`, `sessionKind`, `entrypoint`, `slug`, `teamName`, `agentName`, `forkedFrom` are all new.
- 41.8 (file checkpointing) — the backup naming (`sha256(path)[0:16]@v<n>`), the null-backup
  encoding for "file did not exist", and the symlink/hardlink refusal rules are all now pinned down.

---

### Open questions

1. **Where does the `summary` line come from?** `{type:"summary", summary, leafUuid}` is read at
   420601 and drives the `/resume` picker's summary column, but no writer exists in 2.1.251. Is it
   pure backward compatibility with pre-`ai-title` transcripts, or is it written by the cloud/bridge
   ingress path outside this binary?
2. **File-history eviction bound.** 452626 logs `failed to delete evicted backup <name>`, so there is
   a per-session eviction policy beyond the 30-day directory sweep. The bound (count? bytes? versions
   per path?) was not located.
3. **`--continue` selector.** The "most recent transcript in this project by mtime" behaviour is
   inferred from the shared session-list builder (419040). The dedicated `--continue` resolution
   function was not isolated; it may apply extra filters (sidechain exclusion, `sessionKind`, ended
   sessions).
4. **`hide-from-slash-command-tool`.** Present in the accepted frontmatter key list (31407) but no
   consumer was found. Dead key, or consumed in a chunk not traced?
5. **The nine `{name:"stub"}` registry entries.** Their identities are only inferable from the
   category map (`sandbox`, `env`, `experiments`, `channel`, `issue`, `onboarding`, and the dev
   commands). Confirming which are first-party-only vs simply unreleased would need an internal build.
6. **`@file` references in custom commands.** No command-loader-specific handling was found; the
   assumption is that `@path` is resolved by the generic prompt attachment pipeline *after*
   `$ARGUMENTS` substitution. Worth confirming, because substitution order determines whether
   `@$1` works.
7. **`skillUsage` decay.** The February note mentions a "7-day half-life" ranking signal. 2.1.251
   stores `skillUsage` in `~/.claude.json` (279316) and sorts budget-truncation by a scoring function
   passed into `egt`/`Kft`, but that function was not traced to its decay constant.
8. **`paths:` conditional-skill activation trigger.** `activatedConditionalSkillNames` is populated
   somewhere in the file-tool post-hooks; the exact set of operations that count as "touching" a file
   (read? edit? glob match?) was not confirmed.
