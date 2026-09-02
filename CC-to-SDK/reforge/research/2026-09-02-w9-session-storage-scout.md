# W9 session/transcript storage scout — the layer, its port cut, and what the campaign has wrong (pin 2.1.251)

Scope: C12 / W9 (`subsystem/session-storage`), the campaign's first planned **S-module of a STORAGE
core**. READ-ONLY: no build, no gate, no recording, no scenario was run; nothing outside this file
was written.

Method: TypeScript-parser spans over `chunk-fy12d89p.js` (10,449 top-level declarations, parsed
clean in ~1 s); `import{…}from"/$bunfs/root/chunk-….js"` graph walks across the 1,802-file module
set; substring/offset measurement against the module files (never the pretty reprint), with
`cli.pretty.js` used only to convert offsets to the chunk-relative line numbers the census speaks
in; and — new for this scout — **the session JSONL files the harness has accumulated in
`reforge/config/projects/` read as the artifact for the record-type enumeration** — 412 files in all,
of which **396 are top-level session transcripts** (6,348 records, 10.16 MB) and 16 are subagent
transcripts under `<sessionId>/subagents/`. Scratch scripts in `/tmp/w9scout/`.

Grounding: campaign spec §1.1/§1.2/§2.1/§2.3/§2.4/§3.1/§3.2/§3.4/§6-W9 + the C1, C7 and C10.5
Revision Notes; `reforge/research/2026-09-02-w75-hook-executor-design.md` (the campaign's only prior
S-module design pass — this document matches its rigour and inherits its port-cut rule);
`reforge/research/2026-09-02-w8-moat-tools-scout.md` §4.3/§6.2/§9; `2026-08-31-engine-census.md`;
`reforge/ledger.json`; `reforge/src/state.ts`; `reforge/m2/cross-resume.ts`;
`reforge/strangle/modules/session-materialize/reference.js`; `research/fixtures/*.json`.

---

## 0. Seven corrections, before anything is budgeted

Every scout so far corrected the census it was handed. This one **exonerates** the census's
engine-chunk claim (which reads wrong and is right) and corrects both of its satellite chunks, the
spec's §3.2 promise, the ledger row, and one claim in the W8 scout that lands here. Full list with
evidence in §6. The seven that change what W9 must do:

1. **`trstwd25` is not session storage. It is the remote-container dir-sync git worker, and it is
   §1.2-excluded periphery.** 177,692 B whose dominant literals are `branch_switched`,
   `dir_sync_git_bundle_unverified`, `ccr_dir_sync_git_worker_turn_start`, `first_bundle_refused`,
   `unmerged_index`. It contains **zero** occurrences of `.jsonl`-transcript vocabulary
   (`parentUuid`, `leafUuid`, `isCompactSummary`, `summary`: 0 each). It has been carried on the
   `subsystem/session-storage` row since the census. (§6.2)

2. **`d78hxkfm` is the generic storage-v5 backend, it is not session-specific, and it is GATE-DEAD
   at this pin with an env lever that provably cannot open it.** 233,050 B of a Result-monad
   key/namespace store serving `marketplaceCache`, `userConfigDir`, `memory`, `task`, `settings`
   and 40 other namespaces as well as `transcript`. Every entry into it is behind `O()`
   (`chunk-vvpqfcj1.js`, 763 B), a module-level latch pinned exactly once by
   `rEt(a.CLAUDE_CODE_HOVER_REST ?? I("tengu_hover_rest",!1))` in `chunk-x3nqjg1p.js`. The gate's
   compiled-in default is **`false`** (2 sites, `gate-defaults-2.1.251.json`), §3.3 pins every gate
   to its compiled-in default, and `tengu_hover_rest` is **not** among the 13 per-gate env
   overrides. The env var that looks like a lever is not one: `acr(t)` latches `t === !0`, and a
   `process.env` read is a **string**, so `CLAUDE_CODE_HOVER_REST=1` pins the latch to **false** and
   logs `tengu_hover_rest served a string, not a boolean; treating it as off`. (§1.6)

3. **The row's denominator is ~175 KB, not ~450 KB — and the census's "`fy12d89p` @4–10k" is
   CORRECT, so nobody should "fix" it.** Measured: the storage layer is **172,430 B across 477
   top-level declarations occupying a contiguous span at offsets 119,251–292,114** (span 172,863 B —
   99.75 % declaration density), which is chunk-relative pretty lines **≈3,545–9,900**. Plus
   `chunk-1x1tv6fk.js` (2,814 B, 10 exports, the transcript-path chunk the census never names).
   Dropping `trstwd25` and the gate-dead `d78hxkfm` removes 410,742 B from the row. (§1.1)

4. **Upstream has already named this subsystem's entire API, and the campaign has never used it.**
   `chunk-e6cn1914.js` (20,085 B, ~99 % import statements) is a **semantic barrel** re-exporting
   **235 storage symbols** under readable names — `loadTranscriptFile`, `buildConversationChain`,
   `persistLeafCheckpoint`, `reAppendSessionMetadataAtExit`, `ENTRY_APPEND_POLICY`, and **twelve
   explicit `*ForTesting` exports** that are upstream's own injection points. All 235 resolve to
   declarations **inside** the measured region, which is how the region's boundaries were proved
   rather than guessed. All 235 are already in `research/fixtures/symbol-map-2.1.251.json`; nothing
   has ever assembled them into a subsystem view. (§1.2)

5. **The state-surface diff does not see session storage at all today, and §3.2 reads as if it
   might.** `src/state.ts` snapshots **only `reforge/sandbox/`** plus a derived exit outcome, and is
   wired only into `m1/run.ts`. Nothing under `reforge/config/` is graded by it. The one storage
   claim in the whole corpus is `m2/cross-resume.ts`'s `storeShape` — `{type, role, sorted keys}`
   per JSONL row — which is a *shape* comparison that cannot see a wrong `parentUuid`, a missing
   `atis-latch`, a divergent `leafUuid`, or a torn tail. (§4.1)

6. **The corpus writes 8 of the 37 record types, and the evidence is its own transcripts.** Across
   396 accumulated session files: `user`, `assistant`, `attachment`, `system`, `queue-operation`,
   `atis-latch`, `last-prompt`, `mode`. **Twenty-nine types have never been written by any recorded
   run** — including every title/summary type, every file-history type, `relocated`,
   `content-replacement` and `fork-context-ref`. And all 435 `last-prompt` records carry
   `leafUuid` set with `explicit` **unset**, so the reader's `clearedToEmpty` arm has zero
   coverage. (§5.1)

7. **`summary` — a record type the reader, the GC planner and the append-policy table all handle —
   has ZERO writers anywhere in the bundle.** `type:"summary"` appears at 0 write sites in
   `chunk-fy12d89p.js` and the one bundle-wide match (`chunk-81xmkgbw.js` @211418) builds a UI
   view-model, not a transcript record. It is a **read-only legacy format** at this pin: the engine
   consumes `summary` records written by older versions and never emits one. An owned module that
   drops the reader arm would be wrong; one that implements a writer would be inventing behaviour.
   (§5.3)

---

## 1. The layer, measured

### 1.1 Size and shape

| unit | bytes | what it is |
|---|---|---|
| `chunk-fy12d89p.js` @119,251–292,114 | **172,430** (477 decls) | the subsystem: writer, store, reader, chain, GC, metadata, 37 record kinds |
| `chunk-1x1tv6fk.js` | **2,814** (10 exports) | transcript-path derivation — whole-chunk ownable, an S-chunk in its own right |
| `chunk-e6cn1914.js` | 20,085 | the semantic barrel (235 names); ~99 % import statements, no behaviour |
| `chunk-4ngx0mjr.js` (partial) | 22,962 total | project-key slug `hA`/`k`/`he` + head/tail sampling helpers; **shared** |
| `chunk-1hpjnncp.js` | 47,452 | namespace→path resolver `Jo`, 45 namespaces; **512 importers — not W9's** |
| `chunk-8ath6mn8.js` | 8,769 | key-scope constructors `Te`; **571 importers — not W9's** |
| `chunk-d78hxkfm.js` | 233,050 | storage-v5 backend — **gate-dead** (§0.2) |
| `chunk-trstwd25.js` | 177,692 | remote dir-sync git worker — **not this subsystem** (§0.1) |

The engine-chunk region is essentially one block: 172,430 B of declarations inside a 172,863 B
span. Within it, 34 declarations ≥1 KB carry 94,312 B; 103 more carry 48,535 B; and 340 leaf
predicates under 250 B carry 29,583 B.

**Composition, honestly.** 405 of the 477 declarations (88,852 B) contain no bridge / CCR / artifact
/ remote-mirror / observer / marble-origami / history-suppression token at all. 53 declarations
(21,382 B) are unambiguously that periphery. The remaining ~62 KB is mixed and dominated by the
writer class, whose 136 members split between the core append path and periphery fields.

### 1.2 The public surface: 235 names, and who takes them

`chunk-e6cn1914.js` names all 235. **148 have a real cross-chunk consumer**; 87 are barrel-only, of
which **12 are `*ForTesting`** (`resetProjectForTesting`, `setSessionFileForTesting`,
`appendEntryToSessionForTesting`, `compactTranscriptForTesting`, `emitSessionFileMaterializedForTesting`,
`beginTranscriptRelocationForTesting`, `endTranscriptRelocationForTesting`,
`reAppendSessionMetadataAsyncForTesting`, `mirrorInternalEntryForTesting`,
`setRemoteIngressUrlForTesting`, `transcriptTailForHydrateForTesting`,
`resetProjectFlushStateForTesting`) and 8 are exported constants.

43 chunks import storage symbols directly from the engine chunk. The barrel itself is reached only
through `import.meta.require`/dynamic `import()` at 5 sites — it is a **cycle-breaker and a naming
artifact, not a module seam we can swap**.

The consumers that matter for a headless-graded parity:

| consumer | names taken | role |
|---|---|---|
| `chunk-6thm48px.js` (1.07 MB) | 59 | interactive session controller |
| **`chunk-dvbbv89q.js` (374,588 B)** | **42** | **the headless streaming/print loop — this is W9's real port surface** |
| `chunk-ew5rqxht.js` | 31 | bridge/egress suppression (periphery) |
| `chunk-ht7zfm7n.js` (5,375 B) | 16 | `/clear` (§2.5) |
| `chunk-n6h5jfvv.js` | 14 | exit drains, torn-tail sealing |
| `chunk-pt5wap5v.js` | 14 | session-picker / resume adoption |
| `chunk-g461tywa.js` | 12 | the headless CLI command handler |

The headless 42: `addSessionMirror, adoptForkSessionMetadata, adoptResumedSessionFile,
adoptResumedSessionFileAsync, cacheSessionTitle, clearBridgeSession, doesMessageExistInSession,
findUnresolvedToolUse, flushSessionStorage, getCurrentSessionBridge,
getCurrentSessionIsolationLatch, getCurrentSessionTitle, getMaterializedSessionFile,
getSessionIdFromLog, getValidatedCCRTip, hydrateFromCCRv2InternalEvents, hydrateRemoteSession,
isChainParticipant, isCompactPairWithheldFromRemote, isLoggableMessage, isMessageTurnUnanswered,
mirrorLeafCheckpointToRemote, persistLeafCheckpoint, readTranscriptTailForTip, recordTranscript,
registerLiveSuppressionProbe, removeTranscriptMessage, resetSessionFilePointer,
restoreSessionMetadata, saveAgentSetting, saveAiGeneratedTitle, saveBridgeSession, saveCustomTitle,
saveIsolationLatch, saveMode, sealTranscriptAppendsForShutdown, searchSessionsByCustomTitle,
setInternalEventReader, setInternalEventWriter, setTranscriptLocalGcEnabled, transcriptCursorEnd,
updateCCRTipFromAckedBatch`.

### 1.3 The pieces, by size

**The writer — `eHe` @151,243..182,667, 31,424 B, 136 members.** One instance, created by `Zr()`
(`Mi().project ??= new eHe(store)`). **61 public property declarations, 75 methods, zero
ECMAScript private fields.** The largest members:

| member | B | role |
|---|---|---|
| `planReAppendSessionMetadata` | 4,575 | re-scans the file's own tail and rebuilds the 16-type metadata block |
| `performCompactTranscript` | 2,535 | the transcript GC (temp file + inode check + rename) |
| `performCompactTranscriptV5` | 2,229 | its v5 twin — gate-dead |
| `drainQueuesOnce` | 1,761 | the batched write drain, the store fence, the GC trigger |
| `insertMessageChain` | 1,694 | parent assignment + the per-record envelope |
| `appendEntry` | 1,380 | the three-policy dispatch over `ENTRY_APPEND_POLICY` |
| `reStampAtExitAsync` | 1,178 | exit re-stamping |
| `removeByUuidV5` / `removeByUuidSlowV5` | 1,124 / 1,164 | gate-dead |
| `performRemoveByUuid` | 881 | tail-window byte splice: `truncate` + `write`, non-atomic |
| `fetchAgentTranscriptOnDemand` | 873 | subagent hydration |
| **`materializeSessionFile`** | **723** | **the C1 class-method spike's target** |

**The host store — `ype` @146,339..148,126, 1,787 B, 32 members**, held by
`nzn = new Ln(() => ({current: new ype(() => K())}))` — host-scoped, not process-global. It owns
`sessionMessages` (a memoised per-session uuid set), `filelessResumeUuids`,
`forkContextHydrationCache` + `forkContextHydrationsInFlight`, `writerHealth`,
`relocationParkedAppends`, `takenForeignExitLines`, and three emitters: `sessionTitleChanged`,
`sessionAgentNameChanged`, `sessionFileMaterialized`.

**The reader — three functions and a fold.**

- `K7` / `loadTranscriptFile`, 2,982 B. Direct-fs path: `stat`; if `size > S4`, run the
  **backward pre-compact scan** (`lYt`) which finds the last boundary from the tail and parses only
  after it; otherwise read whole, trim at the last boundary with `MBe`, split and parse with `yfe`.
  Governed by `CLAUDE_CODE_DISABLE_PRECOMPACT_SKIP` — **an env var outside reforge's X6 allowlist
  that changes which reader arm runs**. Returns the fold's projection plus
  `servedBy ∈ {v5, v5-records, absent, inaccessible}` on the v5 path.
- `yHe`, **6,703 B — the fold, and the single highest-yield pure unit in the layer.** A closure over
  ~40 maps returning `{processEntry, dropPreBoundaryEntries, setTailTorn, finish, …}`. It consumes
  every one of the 37 record kinds into a **39-field projection** (`messages, summaries,
  customTitles, aiTitles, tags, relocatedCwds, agentNames/Colors/Settings, modes, permissionModes,
  isolationLatches, atisLatches, worktreeStates, costStates, fileHistorySnapshots/Deltas,
  attributionSnapshots, contentReplacements, forkContextRefs, contextCollapse*, leafUuids,
  clearedToEmpty, rewindAnchorUuid, …`), rewrites `parentUuid` for progress records through a
  transitive map, and resolves the leaf set with a cycle-guarded walk. Pure apart from injected
  telemetry.
- `GVt` (1,246 B) + `KVt` (572 B) — the **compact-boundary relink**: re-parent the preserved
  messages into a linear chain under `anchorUuid`, **zero the usage counters on preserved assistant
  messages**, delete every pre-boundary message not preserved, re-parent orphans onto the preserved
  tail.
- `BSe` / `buildConversationChain`, 420 B — the leaf→root `parentUuid` walk with a cycle detector
  (`tengu_chain_parent_cycle`) and a timestamp fallback (`tengu_chain_timestamp_fallback`).
- `Fqe` / `loadTranscriptFromFile`, 2,835 B — picks the leaf, walks the chain, assembles the
  conversation object; throws `TranscriptFileFormatError` with codes `no_messages`, `no_chain`,
  `too_large` (>268,435,456 B), `invalid_json`, `bad_shape`. It also accepts a **whole-file JSON**
  transcript, not only JSONL.

**The GC planner — `zde`, 2,226 B.** Classifies each record as `transcript` / `accumulate` /
`last-wins` (`d2t`), builds a keep-set, and returns `{kind:"skip"}` (no boundary),
`{kind:"abort", reason: "preserved_uuid_missing" | "preserved_walk_broken"}`, or `{kind:"plan", …}`.

**Path derivation — `chunk-1x1tv6fk.js`, 2,814 B.** `Ml() = join(configDir,"projects")`;
`Sl(cwd) = join(Ml(), hA(cwd))` behind a host-scoped `projectDirCache`;
`Hl() = join(Ty() ?? Sl(Se()), K() + ".jsonl")`; `mp(agentId) = <projectDir>/<sessionId>/subagents/agent-<id>.jsonl`.
The slug `hA(cwd)` (in `chunk-4ngx0mjr.js`) replaces every non-alphanumeric with `-` and, past
`$O = 200` chars, appends `Math.abs(hash(cwd)).toString(36)`.

### 1.4 The constants that are behaviour

`FLUSH_INTERVAL_MS = 100` · `MAX_CHUNK_BYTES = 104,857,600` · GC floor `hBe = 5,242,880` ·
backstop `xR = 20,971,520`, ceiling `yBe = 8·xR = 167,772,160`, reclaim ratio `_Be = 0.1` ·
`MAX_TRANSCRIPT_READ_BYTES = 52,428,800` · JSON-transcript cap 268,435,456 · store-fence errno set
`{ENOSPC, EROFS, EDQUOT, ENAMETOOLONG}` · permission errno set `{EACCES, EPERM}` · writer-health
stages `{drain, materialize, adopt}`.

Two literal-returning functions are worth stating because they look like decisions and are not:
`whr()` returns the string `"production"` (so the `test_env` persistence-disable arm is dead in the
shipped build), and `bcn()` returns `"external"` (so `userType:"external"` is in every record).

### 1.5 The record schema

`ENTRY_APPEND_POLICY` (`hhr` @136,425) maps **37 entry types** to three write policies:
`dedup-transcript` ×5 (`user, assistant, attachment, system, progress`), `always` ×29,
`route-by-agent` ×3 (`content-replacement, fork-context-ref, observer-ref`).

Every message record is wrapped by `insertMessageChain` in a fixed envelope:
`{parentUuid, logicalParentUuid, isSidechain, teamName, agentName, promptId, agentId, …message,
sessionKind, userType, entrypoint, cwd, sessionId, version, gitBranch, slug}`. A `compact_boundary`
gets `parentUuid: null` and `logicalParentUuid: <previous leaf>` — **the boundary deliberately
breaks the parent chain**.

### 1.6 The storage-v5 arm, and what owning around it costs

**43 of the 477 declarations (61,139 B by whole-declaration size) contain at least one `O()`
branch** — the dead arm is threaded through the layer, not isolated in it. `K7` is ~47 % v5 arm;
`eHe` carries two whole v5 methods (3,353 B) plus branches. An owned module implements the
pinned-false path and records the arm as an exclusion with the guard, exactly as C10.5 did for
segment compaction; but the *oracle* body still contains it, and the port design must make the
false branch the only reachable one rather than pretend the parameter does not exist.

One upstream defect worth recording because it constrains any flip-liveness test: when v5 IS on,
`chunk-kc98mm72.js` hands children `CLAUDE_CODE_HOVER_REST:"1"`, and the child's `rEt` sees a
string, warns, and pins v5 **off**. The flag does not survive a process boundary.

---

## 2. State ownership map

### 2.1 Who owns what

| state | owner | lifetime | mutated by |
|---|---|---|---|
| `writeQueues: Map<path, item[]>`, `flushTimer`, `activeDrain`, `drainChain`, `flushResolvers`, `pendingWriteCount` | `eHe` | per session file | `enqueueWrite/Remove/Compact`, `scheduleDrain`, `drainQueuesOnce`, `_resetFlushState` |
| `sessionFile`, `pendingEntries`, `relocationBuffer`, `sessionFileAppendSource` | `eHe` | per session | `setSessionFile`, `resetSessionFile`, `materializeSessionFile`, relocation brackets |
| `storeFence` (sticky poison error) | `eHe` | until `_resetFlushState` | `drainQueuesOnce`, `reAppendSessionMetadataAsync`, `appendToFile` |
| `bytesSinceMetadataReAppend`, `bytesSinceCompact`, `backstopThresholdBytes`, `tornTailToSeal` | `eHe` | per file | `appendToFile`, `drainQueuesOnce`, `performCompactTranscript` |
| 26 `currentSession*` metadata fields (title, aiTitle, tag, mode, permissionMode, latches, worktree, PR, bridge…) | `eHe` | per session | `restoreSessionMetadata`, `planReAppendSessionMetadata`, every `save*` |
| `existingSessionFiles`, `foreignWithheldEntryUuids`, `agentTranscriptFetches`, `agentIdsNotToFetch`, `mirrors` | `eHe` | process | `getExistingSessionFile`, `appendEntry`, `addMirror` |
| `sessionMessages` (memoised uuid set per session), `filelessResumeUuids` | `ype` | host | `appendEntry`, `recordTranscript`, `clearSessionMessagesCache`, `primeFilelessResume` |
| `forkContextHydrationCache` / `…InFlight`, `warnedUnchainedSessions`, `takenForeignExitLines`, `exitReStampProviders`, `exitDrains` | `ype` | host | fork hydration, exit paths |
| `writerHealth` (`failuresByFile`, `abandonedPaths`, `degradedStore`, `failureSeq`) | `ype` | host | `aw` on every failure, `uBe` on recovery |
| three emitters (`sessionTitleChanged`, `sessionAgentNameChanged`, `sessionFileMaterialized`) | `ype` | host | metadata re-append, materialize |
| `projectDirCache`, `agentTranscriptSubdirs` | `chunk-1x1tv6fk.js` host container | host | `Sl`, `IQn`/`m_n` |
| the storage-v5 latch | `chunk-vvpqfcj1.js` module var | **process, pinned once** | `acr` |

All of it except the v5 latch lives in host-scoped containers (`new J(…)` / `new Ln(…)`), which is
materially better than the hook layer's process-global sets: a replay resets a host, not a
collection of scattered singletons. **The v5 latch is the one true process-global**, and it is
write-once.

### 2.2 Lifecycle

**create → materialize.** The session file path is derived lazily: `ensureCurrentSessionFile()`
calls `Hl()` on first need. Until then, `appendEntry` **buffers into `pendingEntries`**.
`materializeSessionFile(storageV5)` — the C1 spike's target — drains that buffer: skip if
`shouldSkipPersistence()`; else `ensureCurrentSessionFile`, `reAppendSessionMetadataAsync(false,false)`,
replay the buffer through `appendEntry`, and if the cwd moved mid-session re-append with
`relocated=true`. Its two `try` blocks are **sequential, not nested** — the
`sessionFileMaterialized.emit()` half runs even when the write half threw. That contract is already
written down in `strangle/modules/session-materialize/reference.js` and is the seed of `SessionPort`.

**append.** `recordTranscript` (`Wb`) dedupes against `sessionMessages`, fires
`tengu_phantom_parent_hint` when the claimed parent is absent, then `insertMessageChain` stamps the
envelope, writes an `atis-latch` when the latch stamp changed, and — **after every `compact_boundary`
write** — resets `backstopThresholdBytes` to 20 MB and calls `requestCompact(sessionFile)`.
`appendEntry` dispatches on `ENTRY_APPEND_POLICY` and enqueues. `drainQueuesOnce` batches
serialized records up to `MAX_CHUNK_BYTES`, appends, resolves the per-item promises, and re-appends
the metadata block every `Sp/2` bytes.

**compact (the file, not the context).** `performCompactTranscript`: skip below 5 MB; snapshot three
4 KB windows (head/middle/tail); **refuse if the tail window does not end in `\n`**
(`snapshot_mid_line`); stream the file through `zde`'s plan into
`<file>.compact.tmp.<8 hex>` at mode 0600; then **verify the source's inode is unchanged and the
three windows still match**, append whatever grew during the rewrite up to the last newline,
`fsync`, and **`rename` over the original**. Adaptive: if the rewrite reclaimed less than 10 %, the
backstop doubles up to 160 MB. Failure reasons are named: `snapshot_mid_line`, `source_changed`,
`rename_fallback`, `io`.

**resume.** Measured at the two symmetric call sites in the headless loop `chunk-dvbbv89q.js`:
`resetSessionFilePointer()` → `restoreSessionMetadata(loaded)` → `adoptResumedSessionFile()`, which
sets the session file to `Hl()` — **the same path, because the session id is preserved** — touches
its mtime and calls `reAppendSessionMetadata(true)`. Then `tengu_session_resumed`. Confirmed
empirically: across 396 accumulated session files, **every file contains exactly one `sessionId`
and it always equals the filename**. A headless resume appends to the file it resumed.

**fork.** The same site branches: `if (o.forkSession) await adoptForkSessionMetadata(loaded,
{stripWorktreeSession:true, stripRelocatedCwd:true}) else restoreSessionMetadata(loaded)`, and
`adoptResumedSessionFile` is **skipped for a fork** — so a fork takes a fresh session id and a fresh
file, and the loaded messages are re-written into it with **new envelopes**. There is no uuid
rewrite of the message bodies themselves on this path; the reader's `GVt` is the only place uuids
are re-parented, and it does so on load, in memory.

**`/clear`** (§2.5). **end.** `sealAppendsForShutdown()` latches `appendsSealedForShutdown`, after
which `enqueueWrite` resolves immediately; `sealTornTranscriptTail` appends a bare `\n` if the file
does not end in one; `reAppendSessionMetadataAtExit` runs from a `process.on("exit")` handler.

### 2.3 The invariants a port must preserve

1. **Append-only, last-record-wins.** Sixteen metadata types are re-appended, never edited; both the
   writer's tail re-scan and the reader's fold take the last occurrence.
2. **The metadata re-append reads the file's own tail by raw string matching**, not by parsing:
   `line.includes('"type":"custom-title"')` plus `Ff(line,"customTitle")`. This is a real behaviour
   with a real hazard (a record whose *content* contains that byte sequence matches) and an owned
   module must reproduce it or declare the deviation in the custom lane.
3. **Only the GC rewrites the file, and only atomically** — temp file, inode + window verification,
   `fsync`, `rename`. Everything else appends.
4. **`performRemoveByUuid` is the exception and it is not atomic**: an in-place `truncate` + `write`
   over the tail window, falling back to a whole-file rewrite. A crash mid-splice is exactly the
   torn tail the sealer exists for.
5. **Torn tails are a first-class state.** `sealTornTailSync` opens `O_WRONLY|O_APPEND` and appends
   `\n`; `EV` prefixes `\n` to the next append when a seal is pending; the reader sets
   `setTailTorn(...)` and marks the artifact ledgers.
6. **The store fence is sticky.** One `ENOSPC`/`EROFS`/`EDQUOT`/`ENAMETOOLONG` poisons every
   subsequent write in the process until `_resetFlushState`.
7. **A `compact_boundary` has `parentUuid: null`**, and pre-boundary messages are deleted on load
   unless the boundary's `preservedMessages`/`preservedSegment` names them.
8. **Flush is timer-driven at 100 ms** unless `CLAUDE_CODE_EAGER_FLUSH` (or `CLAUDE_CODE_IS_COWORK`)
   forces an `await flushSessionStorage()` after each record. See §4.3 — this is the single biggest
   determinism hazard the state surface will hit.
9. **Directories are created at mode 0700 and files at 0600.**

### 2.4 Where the C1 spike sits

`materializeSessionFile` (723 B, `coverage: ["resume"]`) is one of the 75 methods of `eHe`, and the
adapter the C1 retrofit left behind already enumerates nine members of the store as a de-facto port
(`shouldSkipPersistence`, `ensureCurrentSessionFile`, `reAppendSessionMetadataAsync`,
`pendingEntries`, `appendEntry`, `currentSessionRelocatedCwd`, `sessionFile`, `store.writerHealth`,
`store.sessionFileMaterialized`). **That comment block is the earliest draft of `SessionPort` and it
should be treated as the starting point, not re-derived.** It is 723 B of a 172,430 B subsystem —
0.4 %.

### 2.5 `/clear`, measured

`/clear` is declared `{type:"local", name:"clear", supportsNonInteractive: !0, aliases:["reset","new"],
description:"Start a new session with empty context; previous session stays on disk (resumable with /resume)"}`
— it **passes the headless command filter `k0t`** (`type==="local" && supportsNonInteractive`), and
the corpus's `hooks-session-end` scenario already uses it. Its body is `BJt` in `chunk-ht7zfm7n.js`
(5,375 B), and it is where the W7.5 design's `ZSe` lives: `await ZSe(session,"clear",{sessionHooks:U,…})`
is its second statement — **confirming SessionEnd's three callers at this pin (resume, /clear,
shutdown)**. Its storage sequence: SessionEnd hooks → `resetSessionFilePointer` →
`dropSessionHistorySuppression` → `releasePrecautionarySuppressionFor` → new session id and new file
→ `saveCustomTitle` (carrying the old title, or the `[name]` argument) → `saveAgentName` →
`clearSessionMetadata` → `saveMode`/`saveWorktreeState`/`saveIsolationLatch` → yield
`{type:"conversation_reset", newConversationId}` → SessionStart hooks.

**`/clear` does not write the `clearedToEmpty` marker.** That marker is
`last-prompt {leafUuid: null, explicit: true}` and its only writer is `persistLeafCheckpoint(null)`,
whose two headless call sites are both on the **rewind** path.

### 2.6 The two storage edges the W8 scout routed here

- **Task store**, `<config>/tasks/<listId>/{<taskId>.json, .highwatermark, meta}` plus a `.lock`
  path suffix. `chunk-kkfs5jjy.js` is 14,093 B and contains **no `O_EXCL`, no `rename`, no `.tmp`,
  no `flock`** — the `.lock` is a path convention, not a syscall lock. The list id is the session id,
  so a resumed session sees the prior run's tasks. **1,085 directories** have accumulated in the
  harness config (measured this session; the W8 scout measured the same figure two days ago).
- **Peer/session registry**, `<config>/sessions/`. Correcting the W8 scout: this is **not** "one
  record per live session" — it is a directory **shared by three subsystems**: the cross-session
  peer record `<pid>.json` (`{pid, sock, sessionId, peerFeatures, procStart}`), the UDS auth key
  file (`{peerToken, pidDomain, …}`, mode 0600), and FleetView's `.fleetview-heartbeat`. On the
  non-v5 path the write is `unlink` then plain write — **`publishDiscipline:"atomic"` exists only in
  the gate-dead v5 arm**, so a torn peer record is reachable today and a torn one is not.

---

## 3. The port surface

**The cut rule is inherited verbatim from the executor design (§3.2 there): anything that returns
data goes behind a read-shaped port and leaves the logic that consumes it owned and pure; anything
that owns identity or a lifecycle goes behind a handle-shaped port.** Applied here it produces
seven ports plus two stubs. Each is marked **binding-candidate** (the orchestrator should hold the
implementer to it) or **advisory**.

1. **`TranscriptFsPort`** — handle-shaped. `stat(path)`, `readAll(path)`, `readWindow(path, off,
   len)`, `readLines(path, endByte)` (streaming, for the GC and the backward scan),
   `appendBytes(path, bytes, {sealPendingNewline})`, `openTemp(path, mode)` + `write`/`sync`/`close`,
   `renameOver(tmp, dst)`, `truncateAndSplice(path, at, tail)`, `unlink`, `mkdirp(path, mode)`,
   `utimes`, `sameInode(a, b)`.
   *One port, because the atomicity contract of §2.3 is a property of this set and of nothing else.*
   **BINDING-CANDIDATE**: `renameOver` and `truncateAndSplice` must be distinct members. Collapsing
   them into a generic `write` erases the difference between the one atomic path and the one
   non-atomic path, which is precisely the property the mutation battery has to be able to kill.

2. **`SessionIdentityPort`** — read-shaped. `sessionId()`, `originalCwd()`, `projectDirOverride()`,
   `configDir()`, `entrypoint()`, `gitBranch()`, `slug()`, `atisLatch()`, `sessionKind()`,
   `userType()`, `engineVersion()`, `persistenceSuppressionCause()`.
   *All reads, all trivially stubbable, and precisely what turns two of the largest pure wins —
   `insertMessageChain`'s envelope builder and the whole of path derivation — into pure functions.*
   **BINDING-CANDIDATE**: `persistenceSuppressionCause()` returns the four-valued cause
   (`test_env | explicit_disable | skip_prompt_history | nested_marker | null`), not a boolean.
   `shouldSkipPersistence` is `cause !== null || appendsSealedForShutdown`, and the two halves must
   stay separable because they have different lifetimes and different observables.

3. **`SessionStorePort`** — handle-shaped, over `ype`'s 32 public members.
   `getSessionId()`, `sessionMessages(sessionId)`, `invalidateSessionMessages()`,
   `primeFilelessResume(...)`, `forkHydration(...)`, `writerHealth()`,
   `onTitleChanged/onAgentNameChanged/onSessionFileMaterialized`, `claimExitReStamp()`,
   `relocationBracket()`.
   *A port and not data because it owns identity and lifetime, mutates mid-session, and carries the
   three emitters the rest of the host subscribes to.* **BINDING-CANDIDATE**: it must be re-read per
   invocation and never cached across an await, for the same reason the hook source port must be —
   the store mutates under async writes and that race is observable.

4. **`SchedulingPort`** — handle-shaped. `now()`, `isoNow()`, `uuid()`, `setTimer(ms, fn) ->
   cancel`, `isShuttingDown()`.
   *One port because the 100 ms flush timer, the ISO timestamps stamped into every record, and the
   uuids are the same class of injection and an oracle must control all of them together or it
   controls none.* **BINDING-CANDIDATE**: `setTimer` must be injectable, not `setTimeout`. The
   drain schedule is the difference between two byte-different transcript files (§4.3).

5. **`TelemetryPort`** — handle-shaped. The `tengu_transcript_*` / `tengu_chain_*` /
   `tengu_session_*` events, the debug/warn/error log lines, `reportError`, and
   `recordWriterHealth(health, stage, err, file)`.
   *Compared by trace, never by value.* **ADVISORY** in shape; **BINDING-CANDIDATE** that
   `recordWriterHealth` lives here rather than on the store, because writer health's only external
   observable is a telemetry event and a degraded-store flag.

6. **`MirrorPort`** — handle-shaped. `fireMirror(path, entries)`, `internalEventWriter()`,
   `persistToRemote(sessionId, entry)`, `mirrorWorkerEvent(...)`, `hydrateAgentTranscript(...)`.
   *Everything that forwards a record somewhere other than the local file.* **ADVISORY**: on the
   headless path `internalEventWriter` is never set and `Hs()` is false, so this ships as a no-op
   with the guard cited and the branch graded by its guard — an honest exclusion rather than dead
   owned code.

7. **`SessionQueryPort`** — read-shaped. `listSessionFiles(projectKey)`, `sessionFileFor(sessionId)`,
   `sessionExists(id)`, `readTail(path, bytes)`.
   *The session-picker / `--continue` half. Separate from `TranscriptFsPort` because it answers
   questions about the projects tree rather than operating on one file.* **ADVISORY** — it is
   plausibly foldable into port 1; the argument for keeping it is that its consumers
   (`searchSessionsByCustomTitle`, `getSessionFilesLite`, `getSessionFilesWithMtime`) want listings
   and never want bytes.

**Stub: `StorageV5Port`** — every `O()` arm. Ships as a throwing stub with `tengu_hover_rest`'s
compiled-in default as the written guard, and the ~61 KB of declarations that carry a v5 branch are
graded on taking the false arm. **BINDING-CANDIDATE**: the stub must throw, not return `undefined`.
A silent `undefined` makes a wrongly-routed call look like the correct false arm.

**Stub: `PeripheryPort`** — bridge, CCR tip, artifact ledgers, observer refs, marble-origami,
history suppression: 53 declarations, 21,382 B, all §1.2-excluded product periphery. Same treatment.

### 3.1 What stays owned and pure

| unit | ~B | note |
|---|---|---|
| `yHe` — the record fold + leaf resolution | 6,703 | pure but for injected telemetry; the heart of the module |
| `zde` + `qde` + `Vde` — GC plan, line rewrite, serialize | ~3,000 | pure given a line iterator |
| `planReAppendSessionMetadata`'s projection half | ~4,500 | pure given the tail bytes |
| `GVt` / `KVt` / `BSe` / `ZVt` / `QVt` / `VVt` — relink + chain walk | ~3,500 | pure but for telemetry |
| path derivation `Ml/Sl/Hl/mp/om` + slug `hA/k/he` | ~1,200 | pure given configDir + cwd + sessionId |
| the tail string-scanners `Ff/Woe/vYt/EYt/NBe/CYt` | ~3,000 | pure; and where the §2.3(2) hazard lives |
| `ENTRY_APPEND_POLICY`, `d2t`, and the record predicates (`eI/Du/dce/aVt/iVt/mbe/Dqe/eM`) | ~2,500 | data + leaf predicates |
| `insertMessageChain`'s envelope builder | ~800 | pure once `SessionIdentityPort` is injected |
| `Fqe`'s projection assembly (`ope/IV/LV/Lpt/Tpe/kpe`) | ~4,000 | pure |
| ~340 leaf predicates under 250 B | ~29,600 | most already pure |

**Rounded: of ~172 KB, about 60 KB is pure or pure-once-ported, about 40 KB is effect
orchestration, about 25 KB is the gate-dead v5 arm, about 21 KB is §1.2 periphery, and the
remainder is the writer class's own field bookkeeping. With `StorageV5Port` and `PeripheryPort`
stubbed, the effectful residue an owned implementation must actually write is roughly 40 KB** — of
which the write queue + drain + GC is about 12 KB and everything else is thin.

That number is a consequence of the port cuts, not of optimism: it is what remains when the
`O()` arm and the periphery are excluded by guard rather than transcribed.

---

## 4. The grading surface

### 4.1 What exists today

- **`src/state.ts`**: `treeOf(sandbox)` (path, kind, size, sha256, symlink target; root included as
  `"."`; mtimes and inodes deliberately excluded) + a derived `engineOutcome`. Wired only into
  `m1/run.ts`. **It never looks under `reforge/config/`.**
- **`m2/cross-resume.ts`**: the only suite making a store claim. `storeShape(file)` = per JSONL row
  `{type, message.role, sorted key list}`, plus cross-engine resume in both directions and a
  transcript-equality check between the two resumes. It is also the only code in the repo that
  deletes `config/projects`.
- **`strangle/modules/session-materialize/`**: one 723 B splice, `coverage: ["resume"]`, graded by
  solo sabotage only — it is **not** in the attestation's ATTESTED set.

### 4.2 What "full" has to mean, concretely

The wave row promises "full state-surface diff comes online". Concretely:

**Which files.** Extend the snapshot from `sandbox/` to a second root, `CONFIG_DIR`, with a declared
include-list rather than a whole-tree walk (the tree has 1,085 task dirs and 3,939 empty
`session-env/` dirs today): `projects/<projectKey>/*.jsonl`, `projects/<projectKey>/<sessionId>/subagents/*.jsonl`,
`sessions/*`, `tasks/<sessionId>/**`, `.claude.json`, `file-history/**`.

**Which fields.** A transcript must be diffed **per record, semantically**, not by file hash. The
per-record projection: `type`, `subtype`, `message.role`, the sorted key list (what cross-resume
has today), **plus** `parentUuid`, `logicalParentUuid`, `isSidechain`, `leafUuid`, `sessionId`,
`agentId`, `promptId`, `uuid`, `cwd`, `entrypoint`, `userType`, `version`, `gitBranch`, `slug`,
`isMeta`, and for `compact_boundary` the whole `compactMetadata` including
`preservedMessages.uuids`, `preservedSegment`, `preTokens`/`postTokens`/`cumulativeDroppedTokens`.
A shape-only diff cannot see a wrong parent, and a wrong parent is the defect class this subsystem
exists to avoid.

**Which id scrubs.** Every uuid, `sessionId`, `promptId`, `agentId` and `leafUuid` is run-scoped and
must go through the differ's existing run-id **map** (not a blanket scrub) so that *relationships*
survive: `parentUuid` must still equal the mapped uuid of the record it points at. The transcript
path is the sixth run-scoped id shape C7 already added; a seventh — the project-key slug, which
contains the absolute cwd — needs the same treatment for the `-private-tmp-reforge-w5-*` project
dirs. `timestamp`, `durationMs`, `mtime`, `pid`, `procStart` and `sock` are value scrubs and each
needs its own regression test in `src/differ.test.ts` per §3.4.

### 4.3 The three oracle capabilities that do not exist

Named the way the executor design named its three:

1. **Flush-schedule control.** The transcript's contents at any instant are a function of a 100 ms
   timer. Two engines that produce identical records can leave byte-different files, and a run that
   exits between two drains loses records that the other kept. **An oracle that compares session
   files without controlling the drain schedule is comparing a race.** The lever exists —
   `CLAUDE_CODE_EAGER_FLUSH` forces `await flushSessionStorage()` after each record — but it is an
   env var outside the X6 schema, and turning it on changes the behaviour being graded. The
   capability is: drive the drain from `SchedulingPort` in the owned build, and for the extracted
   oracle either add `CLAUDE_CODE_EAGER_FLUSH` to X6 as a **declared determinism knob with its own
   negative control**, or snapshot the file only after an observed quiesce. This must be decided
   before the first storage module, not after.

2. **Dirty-precondition seeding.** Every partition in §4.4 below is a statement about the state of
   the filesystem *before* the run. The harness has exactly one primitive today (`resetSandbox`,
   which wipes `sandbox/` and `config/plans` and nothing else) and one ad-hoc `rmSync(projectsDir)`
   inside `cross-resume.ts`. The capability is a **declared per-scenario config-directory
   precondition** — seed these files, assert the rest absent — because "the corpus happens to have
   left 396 files there" is the opposite of a controlled input.

3. **Torn-state and failure injection.** Six of the layer's most interesting arms are reachable only
   from a damaged or hostile filesystem: a torn tail (file not ending in `\n`), a `parentUuid`
   cycle, a boundary whose `preservedMessages` name a missing uuid, an `ENOSPC` that latches the
   store fence, an `EACCES` on the session file, and a source file that changes under the GC's
   rename. None can be produced by asking a model something. The capability is a **fault surface for
   the filesystem**, generalising `src/faults.ts` from the transport to the store — which is the
   same move §3.2 already makes for the synthetic response corpus, one layer down.

### 4.4 The dirty-state matrix

Axes, with the arm each one reaches:

| # | precondition | grades |
|---|---|---|
| D1 | fresh config dir, single turn | materialize from `pendingEntries`, first metadata block |
| D2 | resume after N turns | `adoptResumedSessionFile`, `reAppendSessionMetadata(relocated=true)`, leaf continuity |
| D3 | resume after a compaction | `GVt` relink, usage zeroing, pre-boundary deletion, the continuation message |
| D4 | resume after `/clear` | new id + new file, old file intact, `clearSessionMetadata` |
| D5 | resume after a fork | `adoptForkSessionMetadata`, worktree/relocated strip, fresh file |
| D6 | resume a transcript a hook wrote into | `hook_additional_context` attachment records survive the chain walk |
| D7 | resume with a torn tail | `sealTornTailOnNextAppend`, `EV`'s `\n` prefix, `setTailTorn` |
| D8 | resume with a `parentUuid` cycle | `tengu_chain_parent_cycle`, partial transcript |
| D9 | resume with a boundary naming a missing uuid | `zde` → `{kind:"abort", reason:"preserved_uuid_missing"}` |
| D10 | resume with a stale task dir for the same id | the W8 edge: `TaskList`'s non-empty arm |
| D11 | persistence disabled (`sessionPersistenceDisabled` launch option) | `shouldSkipPersistence` on every write path |
| D12 | file > 5 MB with a boundary | the GC: temp file, inode check, rename, adaptive backstop |
| D13 | `ENOSPC` on append | the sticky store fence |
| D14 | cwd moved mid-session | `relocateSessionTranscript`, the `relocated` record, parked appends |

**Cells the current corpus reaches: D1, D2 (one scenario), D3 (partially — `compact-continue` puts
a boundary on a graded surface but never resumes past it), D4 (one scenario, and it grades hooks
rather than storage), D5 (one scenario, `m3/fork-session`). D6–D14 are unreached.** D11 is the
cheapest unreached cell by a wide margin: `sx()` is `host.launchOptions.sessionPersistenceDisabled()`,
a launch option rather than a gate, so it is a first-class scenario knob.

---

## 5. Coverage and budget

### 5.1 What the corpus reaches, measured from its own transcripts

396 session files, 6,348 records, 10.16 MB, across four project directories. **Eight of the 37
record types appear**:

| type | records | files |
|---|---|---|
| `attachment` | 1,871 | 388 |
| `queue-operation` | 1,226 | 388 |
| `user` | 1,155 | 396 |
| `assistant` | 1,154 | 388 |
| `atis-latch` | 446 | 388 |
| `last-prompt` | 435 | 388 |
| `system` | 52 | 40 |
| `mode` | 9 | 9 |

Of the 52 `system` records, **44 are `compact_boundary`** (in 32 files) and 8 are `local_command`.
Every boundary carries **both** `preservedMessages` and `preservedSegment`; because `GVt` prefers
the list form, `KVt`'s segment-walk arm (`source:"walk"`) is **unreached even though its data is
present**. All 613 `queue-operation` enqueues and 613 dequeues come from `ssn`, the command-queue
factory the W8 scout routed to C11c — **`recordQueueOperation` is a storage export whose writer is
W8's**, and that is a real shared-record edge, not just an import.

**Twenty-nine types unwritten**, including all of: `summary`, `custom-title`, `ai-title`, `tag`,
`ended-by-model`, `relocated`, `agent-name`, `agent-color`, `agent-setting`, `pr-link`,
`frame-link`, `permission-mode`, `isolation-latch`, `worktree-state`, `cost-state`,
`file-history-snapshot`, `file-history-delta`, `attribution-snapshot`, `content-replacement`,
`fork-context-ref`, `observer-ref`, `history-suppression`, `bridge-session`, the two artifact
ledgers and the three `marble-origami-*`.

### 5.2 Firing conditions and honest cost, per unreached arm

| arm | firing condition | cost |
|---|---|---|
| `custom-title` / `ai-title` / `tag` | `saveCustomTitle` is reached by `/clear <name>` — headless, `supportsNonInteractive` | **cheap**: one scenario, `/clear my-name` |
| `mode` / `permission-mode` | already partially reached; a permission-mode change mid-session completes it | cheap: reuse W6's mode matrix with a second turn |
| `relocated` | cwd moves mid-session; `/cd` is `local-jsx` and headlessly filtered out, so the reachable route is a fresh run under a moved `originalCwd` | medium; **OPEN** — see §5.3 |
| `file-history-*`, `attribution-snapshot` | a file-editing turn with history tracking on | medium: one Edit scenario plus the include-list extension |
| `content-replacement` / `fork-context-ref` | a subagent turn (`route-by-agent`) | medium; belongs with C15/W12 |
| `clearedToEmpty` (`last-prompt {leafUuid:null,explicit:true}`) | `persistLeafCheckpoint(null)` on the rewind path | see §5.3 |
| the GC (`performCompactTranscript` past its 5 MB floor) | a transcript over 5,242,880 B with a boundary | expensive live; **cheap as a contract test** over a synthesised file — and that is the right answer |
| torn tail / cycle / missing-preserved-uuid | a damaged file | zero live cost, blocked on §4.3(3) |
| store fence | `ENOSPC` | zero live cost, blocked on §4.3(3) |
| `summary` reader arm | a transcript containing a `summary` record | **cheap as a fixture** — and it is the only way, since nothing writes one (§5.3) |

The pattern is worth naming: **most of this subsystem's unreached arms are cheaper to reach by
constructing a file than by running a session.** That is the opposite of every prior wave, and it is
the argument for a synthetic *transcript* corpus alongside §3.2's synthetic *response* corpus.

### 5.3 OPEN by construction, with the guards cited

- **The whole storage-v5 backend** — `chunk-d78hxkfm.js` (233,050 B) and the 43 `O()`-bearing
  declarations in the engine chunk. Guard: `O()` is a write-once module latch set only by
  `rEt(a.CLAUDE_CODE_HOVER_REST ?? I("tengu_hover_rest",!1))`; the gate's compiled-in default is
  `false` (2 sites); the gate is absent from the 13 per-gate env overrides; and the env var is a
  string that `acr` compares with `=== !0`. **DEAD**, and the deadness is structural, not
  incidental.
- **`summary` as a written record.** Guard: zero writers bundle-wide (§0.7). The reader arm is live
  and must be graded from a constructed fixture; the writer does not exist and no scenario can make
  one. **OPEN on the read side, DEAD on the write side.**
- **`KVt`'s segment-walk arm.** Guard: `GVt` returns the `preservedMessages` list form whenever it
  is present, and the corpus's boundaries always carry both. Reachable only from a boundary written
  by the segment-compaction variant `E4n`, which C10.5 measured to be headlessly unreachable and
  routed to C16/W13. **OPEN, inherited.**
- **`/cd` (session relocation).** Guard: `/cd` is declared `type:"local-jsx"`, and the headless
  command filter `k0t` admits only `type === "local" && supportsNonInteractive`. The `relocated`
  record is still reachable by other means (a resumed session whose `originalCwd` differs), so this
  is a *route* exclusion, not a behaviour exclusion. **OPEN.**
- **The `test_env` persistence-disable cause.** Guard: `whr()` returns the literal `"production"`.
  **DEAD in the shipped build.**
- **The `nested_marker` persistence-disable cause.** Guard: `bpe()` requires
  `CLAUDE_CODE_CHILD_SESSION` **and** an interactive host check, with
  `CLAUDE_CODE_FORCE_SESSION_PERSISTENCE` as an escape. **OPEN pending a probe of the host check.**
- **Every mirror/remote path** (`persistToRemote`, `mirrorWorkerEvent`, `updateCCRTipFromAckedBatch`,
  the bridge records). Guard: `internalEventWriter` is never set on the headless path and `Hs()` is
  false. §1.2-excluded periphery. **DEAD headlessly.**

---

## 6. Parent-impact list

### 6.1 Campaign spec (`docs/superpowers/specs/2026-08-31-reforge-full-campaign-design.md`)

- **§1.1, storage row.** `trstwd25` must leave the row (§0.1). `d78hxkfm` must move to an
  evidence-backed exclusion with `tengu_hover_rest` as the guard (§0.2). `chunk-1x1tv6fk.js` must
  join it. The `fy12d89p @4–10k` locator is **correct** and should be annotated as chunk-relative
  pretty lines so it is not "corrected" later. The row's ~450 KB becomes ~175 KB.
- **§1.1, "module-level (Result-monad fs layer)".** The Result-monad layer is the v5 backend and is
  gate-dead; the live layer is a class with 61 public fields plus a fold. The seam characterisation
  should say so.
- **§3.2, state-surface diff.** "the session/config store" is promised but not delivered anywhere —
  `src/state.ts` covers `sandbox/` only. The staging note should say the config half lands here,
  with §4.2's include-list and §4.3's three capabilities as its content.
- **§2.1 C1 Revision Note.** "covered by `resume`" is accurate and should be qualified: one
  scenario, one solo sabotage, and **not in the ATTESTED set**.
- **§6, W9 row.** "synthetic corpus" should be read as *two* corpora here: the response corpus §3.2
  already names, and a **synthetic transcript corpus** (§5.2), which is the cheaper of the two and
  the one this subsystem actually needs.

### 6.2 Census (`reforge/research/2026-08-31-engine-census.md`)

- Line 38's chunk list is wrong in both satellites (§0.1, §0.2); its `fy12d89p @4–10k` is right.
- Line 150's "`d78hxkfm` is a Result-monad filesystem layer with inode-identity checks threaded
  through every call; the seam is the whole module" — the inode-identity check that matters is in
  **`performCompactTranscript` in `fy12d89p`**, not in `d78hxkfm`, and it is one check, not a
  thread.
- Line 39's "Resume / fork ~200 KB" double-counts: the resume path's storage half is inside the
  172 KB measured here; what is outside it is the *loop* half in `chunk-dvbbv89q.js`, which is
  C16/W13's.

### 6.3 Ledger (`reforge/ledger.json`)

- `subsystem/session-storage` carries **one 723-byte footprint and `edges: []`**, while three
  spliced rows (compaction, hook-dispatch, environment-and-system-prompt) point edges **at** it. The
  edge list is one-directional and should be symmetric.
- Missing edges to add: → C11c (`recordQueueOperation`, the shared `queue-operation` record, §5.1),
  → C11c (the task store's session-keyed directory, §2.6), → C11d (`<config>/sessions/`, §2.6),
  → C7 (the boundary's `compactMetadata` is written by W4 and consumed by `GVt` here),
  → C15/W12 (subagent transcripts, `route-by-agent`), → C16/W13 (`E4n`'s segment form).
- The row should carry the 235-name public surface as its artifact list, not a single method.

### 6.4 W8 scout (`reforge/research/2026-09-02-w8-moat-tools-scout.md`)

- §4.3's peer-registry description ("one record per live session") understates it: the directory is
  shared by three subsystems and the atomic-publish discipline exists only on the gate-dead path
  (§2.6).
- §8's C11c assigns `ssn` (10,933 B) a `NotificationQueuePort`. `ssn` is also the **writer of the
  `queue-operation` transcript record** and sits immediately after this subsystem in the chunk
  (@292,149). The two waves share a record type and should share its contract test.

### 6.5 `reforge/src/state.ts`

Its header says the full version "arrives with the S-module waves at W9" — correct, and this
document is where that promise gets its content. The header's honesty about the exit half being
derived should be extended: process supervision (leaked children, sockets) is still not addressed
by anything in §4.2 and should be named as W9's own carry-over rather than assumed.

---

## 7. A proposed cut for C12 (advisory)

**W9 is not one S-module wave. It is three children plus a machinery child, and the machinery child
must land first** — the same shape and for the same reason as the executor cut: the oracle
capabilities in §4.3 are ones only this subsystem needs, so a wave that owned something else would
carry them as overhead and be tempted to skip them.

The reason it is three rather than one is not size (172 KB is comparable to the executor's 56 KB
once the two stubs are applied) but **verification independence**: the reader is gradeable entirely
from constructed files with no engine run at all, while the writer is gradeable only against a live
drain schedule. Fusing them would put the cheapest, highest-yield unit in the wave behind the
hardest one.

### C12a / W9a — storage oracle machinery (controlled, opus-tier; must precede any storage module)

**Purpose.** Build what §4.3 says does not exist.
**Scope.** (1) Extend `src/state.ts` to a second root with the §4.2 include-list and a per-record
semantic transcript projection. (2) Extend the differ's run-id **map** to `parentUuid`,
`logicalParentUuid`, `leafUuid`, `promptId`, `agentId` and the project-key slug, each with a
regression test in `src/differ.test.ts` per §3.4. (3) A declared per-scenario config-directory
precondition primitive. (4) A filesystem fault surface generalising `src/faults.ts`. (5) The
flush-schedule decision — either `CLAUDE_CODE_EAGER_FLUSH` enters X6 with a negative control, or the
snapshot waits on an observed quiesce; **decide and write it down, do not leave it implicit**.
**Observable acceptance.** A seeded torn tail, a seeded `parentUuid` cycle and a seeded `ENOSPC`
each produce a named, stable verdict on both engines; the run-id map's six new rules each fail a
mutation of themselves; the config snapshot is byte-stable across two replays of the same engine.
**Edges.** X5 (any re-record serialises). **Track.** Controlled.

### C12b / W9b — the reader (fable-tier; blocked-by C12a)

**Purpose.** Own the pure heart: records in, session projection out.
**Scope.** `yHe` (6,703 B), `GVt`/`KVt`/`BSe` and the chain helpers (~3.5 KB), `zde`'s classifier
half, `Fqe`'s projection assembly, the tail string-scanners, the record predicates and
`ENTRY_APPEND_POLICY` as data — behind `SessionIdentityPort` and `TelemetryPort` only. `K7`'s
direct-fs arm rides here behind `TranscriptFsPort`.
**Observable acceptance.** §3.1's S-module bar, and it is reachable here without a single new
recording: a **synthetic transcript corpus** (§5.2) covering the 37 record types, the boundary
forms, the leaf-resolution cases (explicit leaf, implicit leaf, `clearedToEmpty`, multi-leaf,
cycle), the torn tail and the three `zde` outcomes — each case carrying an explicit oracle
expectation per §3.1's non-vacuity contract; the mutation battery; and a port trace, because
`K7`'s arms differ by which fs reads ran, not by their answer.
**Edges.** → C7 (`compactMetadata` producer), → C16/W13 (`E4n`'s segment form).
**Why first.** It is ~18 KB of the highest-value code in the subsystem, it needs no live run, and
everything downstream reads through it.

### C12c / W9c — the writer and its lifecycle (fable-tier; blocked-by C12b)

**Purpose.** Own `eHe` and `ype` behind `SessionPort`.
**Scope.** The write queue, `appendEntry`'s three-policy dispatch, `insertMessageChain`'s envelope,
`materializeSessionFile` (absorbing the C1 splice), the metadata re-append, `resetSessionFilePointer`
/ `restoreSessionMetadata` / `adoptResumedSessionFile` / `adoptForkSessionMetadata`, the shutdown
seal and the exit re-stamp — behind ports 1–6.
**Observable acceptance.** §3.1's bar plus the D1–D8 and D11 cells of §4.4; the mutation battery
must kill "dropped a `pendingEntries` replay", "resolved a queue item before its bytes landed",
"lost the store fence", "wrote the metadata block before the entries", and "materialized without
emitting".
**Edges.** → C11c (task store, `queue-operation`), → C11d (`<config>/sessions/`), → C8/W5
(SessionEnd's three callers), → C15/W12 (subagent transcripts).

### C12d / W9d — the GC and the damaged-file paths (fable-tier; blocked-by C12c)

**Purpose.** The transcript compactor, `performRemoveByUuid`, torn-tail sealing, relocation.
**Scope.** `performCompactTranscript` + `zde`'s plan application, `performRemoveByUuid`, the seal
family, `relocateSessionTranscript`.
**Observable acceptance.** D7, D9, D12, D13 and D14, all from constructed files; the atomicity
contract of §2.3 asserted directly — the temp file exists at mode 0600, the inode check refuses a
changed source, the rename is the only mutation of the original, and the non-atomic splice is
*declared* as non-atomic rather than accidentally made safe.
**Why last.** Every one of its arms needs C12a's fault surface, and none of them is on any current
graded path.

### Not W9's

`chunk-1hpjnncp.js` and `chunk-8ath6mn8.js` (512 and 571 importers — shared infrastructure, and
whichever wave takes them owns half the product) · `chunk-d78hxkfm.js` (gate-dead, §0.2) ·
`chunk-trstwd25.js` (not this subsystem, §0.1) · the bridge / CCR / artifact / marble-origami
records (21,382 B of §1.2 periphery, stubbed behind `PeripheryPort`) · the resume *loop* half in
`chunk-dvbbv89q.js` (C16/W13) · `ssn` itself (C11c, though the `queue-operation` contract is shared).

---

## 8. Method notes worth keeping

- **A barrel that names a subsystem is worth more than any inventory you can derive.**
  `chunk-e6cn1914.js` gave 235 semantic names, proved the region's boundaries (all 235 resolve
  inside it), and revealed twelve `*ForTesting` exports that are upstream's own opinion about where
  the injection points are. The W8 scout found the same shape in `chunk-hkw4kykv.js`. **Before
  scoping any subsystem, look for its barrel**: grep for a chunk that imports a large name list from
  the owning chunk and re-exports it with `as`.
- **The corpus's side effects are an enumeration artifact too.** The W8 scout read 267 recorded
  request bodies to derive the tool catalog. Here, 396 accumulated session files answered *which of
  37 record types the corpus can actually produce* — 8 — and *which reader arms have never been
  fed*. Artifacts a harness leaks by accident are evidence; the leak is a bug and the evidence is
  free.
- **A locator that looks wrong may be right in a different coordinate system.** The census's
  `@4–10k` reads like a byte offset and is a chunk-relative pretty-file line number, where it is
  exactly correct. Two of this scout's first three hypotheses were about "fixing" it. **Convert
  before correcting.**
- **An env override is not a lever until you check its type.** `CLAUDE_CODE_HOVER_REST` is read
  straight from `process.env` and compared with `=== true`, so it can only ever pin the feature
  *off* — and upstream's own child-process propagation trips on this. The gate-fixture extractor
  that the W8 scout widened for coerced returns would report this as an override; it is a no-op.
  **Report an override with the coercion that stands between it and the value.**
- **When most of a subsystem's arms are cheaper to reach by constructing a file than by running a
  session, the corpus is the wrong instrument.** Every prior wave's coverage question was "what
  scenario fires this?". For a storage core it is "what precondition fires this?", and the answer is
  a fixture, not a recording. That inversion is what makes W9's reader child cost nothing in
  recordings and is worth carrying into W10's file-tool validators and W12's sandbox.
