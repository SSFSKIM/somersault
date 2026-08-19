# M5 — config domain + thread search/archive (agent app-server)

**Status:** design approved 2026-08-18 (owner, four forks resolved in one grill round); **rev 2 after
the external adversarial review of the spec** (11 findings), **rev 3 after the adversarial review of
the implementation plan** (20 findings — the plan review re-read this spec's contracts against the real
code and found six of them under-specified; see Revision Notes). Grounded by in-repo
Codex source reads (`codex-rs/app-server-protocol/src/protocol/v2/{config,thread}.rs`), the upstream
settings loader (`Claude Code Src/src/utils/settings/settings.ts`), the 0.3.234 SDK bump landed on
this branch (`ccb090a006`), and probe 110.

## Why this, and why now

M4 closed the review domain; the drift gate reports 59 methods / 27 notifications / 90 scorecard rows
with every row shipped or N/A-with-evidence. Of the Codex-only domains named in M3's out-list, review
shipped, the reverse-request channel dissolved on grounding (one genuine feature — dynamic tools —
remains, parked as the M6 candidate), and two are untouched: **config write** and **thread
search/archive**. They are one milestone because they are the same kind of thing: state that outlives
a single thread. Every setting the server exposes today is per-thread and evaporates with the record;
`thread/list` can page but cannot find. A client that wants "make this my default model" or "find the
conversation where I fixed the auth bug" has no method to call. M5 gives it seven.

The purpose, plainly: **a client can read and write the user's durable configuration, and can find and
shelve conversations, over the same wire it drives them with.**

## What Codex actually ships (grounded, not assumed)

From `codex-rs/app-server-protocol/src/protocol/v2/config.rs` and `thread.rs` (read 2026-08-18):

- **Config: three methods over a layered model.** `config/read {includeLayers?, cwd?}` →
  `{config, origins, layers?}` — an effective merged view, per-key winning-layer attribution
  (`origins`; Codex fingerprints **dotted leaf paths**, `codex-rs/config/src/fingerprint.rs`),
  optional raw per-layer contents; layer sources carry a numeric precedence (MDM 0 → sessionFlags
  30) and a broken layer is served as an entry with a disabled reason, not an error.
  `config/value/write {keyPath, value, mergeStrategy: replace|upsert, filePath?, expectedVersion?}` →
  `{status: ok|okOverridden, version, filePath, overriddenMetadata?}` — optimistic concurrency on a
  version token, and an explicit "your write landed but a higher layer masks it" outcome.
  `config/batchWrite {edits[], filePath?, expectedVersion?, reloadUserConfig?}` — same, atomic, with
  an opt-in hot reload that itself excludes session-static settings. Failures use named codes
  (`ConfigLayerReadonly`, `ConfigVersionConflict`, `ConfigValidationError`, …).
- **Search: two methods.** `thread/search {searchTerm, cursor?, limit?, sortKey?, sortDirection?,
  sourceKinds?, archived?}` → `{data: [{thread, snippet}], nextCursor?, backwardsCursor?}`.
  `thread/searchOccurrences {threadId, searchTerm, cursor?, limit?}` → occurrences over "visible user
  messages and final assistant messages", each with `snippet`, a UTF-16 `snippetMatchRange`, and a
  `turnCursor` the transcript pager accepts — search results that can jump the reader to the hit.
- **Archive: two methods, two notifications, one filter.** `thread/archive` / `thread/unarchive`
  `{threadId}` → `{}` plus `thread/archived` / `thread/unarchived` broadcasts; `thread/list` and
  `thread/search` take `archived?: bool` (absent/false hides archived, true shows only archived).

## What upstream Claude Code actually does with settings (grounded rev 2)

From `Claude Code Src/src/utils/settings/settings.ts` (the loader our engine embeds):

- Layers merge with **lodash-style deep merge**; **arrays concatenate and deduplicate**
  (`settingsMergeCustomizer`). `permissions.allow` from user and `permissions.deny` from local both
  survive into the effective view — there is no single "winning layer" for a composite key.
- Merge order: **plugin settings base < user < project < local < flag < policy**, where the policy
  layer is itself **first-source-wins** across remote managed sync > MDM (HKLM / macOS plist) >
  `managed-settings.json` > HKCU. Only `managed-settings.json` of that family is a plain file.
- Unknown keys are tolerated (zod passthrough at the file level); invalid files surface errors but
  do not abort the healthy layers.

## What we ship

### The config domain — Codex's shape over Claude's own layers

This is a **files** surface with upstream's own merge semantics. The *engine's* applied view stays
where it lives today (`thread/settings/read`, `get_settings`) — and that distinction now carries a
completeness statement: policy sources that are not plain files (remote managed sync, MDM/registry)
are visible only in the engine's view; `config/read` serves the file-backed chain and says so.

- **Layer chain (file-backed):** **user** (`~/.claude/settings.json`) < **project**
  (`<cwd>/.claude/settings.json`) < **local** (`<cwd>/.claude/settings.local.json`) < **managed**
  (macOS `/Library/Application Support/ClaudeCode/managed-settings.json`, Linux
  `/etc/claude-code/managed-settings.json`; read-only; absent file = absent layer). Windows managed
  paths and non-file policy sources are declared out of this view (documented, with the engine-view
  pointer above).
- **`config/read {includeLayers?, cwd?}` → `{config, origins, layers?, incomplete?}`.** `config` is
  the effective merge computed with **upstream's exact semantics** — deep merge for objects,
  concatenate-and-dedupe for arrays (our implementation mirrors `settingsMergeCustomizer` and is
  pinned by fixtures shared with nested-write tests). `origins` attributes **dotted leaf paths**
  (Codex's own fingerprint granularity): a scalar/object leaf names its winning layer; an
  array-valued leaf names **every contributing layer** in precedence order. `layers` (opt-in)
  returns each file's raw parse; a malformed file becomes a layer entry with `disabledReason` while
  healthy layers still serve. `incomplete: true` flags that non-file policy sources may exist beyond
  this view. **`versions`** (rev 3) is an always-present map of each writable target in view to its
  current CAS token (`user` always; `project`/`local` with `cwd`) — without it a client facing an
  existing file could never make anything but a last-wins first write. File reading strips a UTF-8
  BOM and treats a blank/whitespace-only file as an empty layer (upstream's loader does both);
  **full upstream `SettingsSchema` validation is deliberately NOT mirrored** — it is a moving target
  that ships inside the CLI, our warnings are advisory (D-M5-5), and the engine's own load remains
  the authority on what it accepts. On **win32 the managed layer is omitted entirely** (the spec
  already declares Windows managed paths out of this view; a Linux path default there would invent a
  drive-root layer). `cwd` resolves the project/local pair; omitted, only user + managed are in view.
- **`config/value/write {keyPath, value, mergeStrategy, target?, cwd?, expectedVersion?}` →
  `{status, version, filePath, overriddenMetadata?, warnings?}`.** `target ∈ user|project|local`,
  default **user** (D-M5-1); managed is not in the enum — unwritable by construction, not by
  refusal. **`keyPath` is an array of string segments** (D-M5-12) — `["permissions","allow"]` —
  which dissolves Codex's quoted-segment grammar problem outright; a segment may contain any
  character including dots — with ONE refusal (rev 3): the segments `__proto__`, `constructor` and
  `prototype` are refused `ConfigValidationError` — **and so are those same names appearing as keys
  anywhere inside a written value** (D-M5-12a, rev 4), because an opaque-segment contract must not be
  a prototype-pollution channel and half a rule is worse than none. The merge/edit machinery uses
  own-property access throughout; it does not use null-prototype dictionaries (D-M5-12a records why
  the narrower rule was chosen). Merge table (D-M5-13): `replace` sets the leaf to `value` exactly;
  `upsert` deep-merges `value` into the existing leaf with the same customizer as the read side
  (objects deep, arrays concat+dedupe); missing parents are created as objects; a non-object in the
  parent path → `ConfigValidationError`, file untouched; `replace` with `value: null` **deletes**
  the leaf; `upsert` with `null` → `ConfigValidationError`. Unknown top-level keys land with a
  `warnings` entry, never a refusal (D-M5-5). `okOverridden` + `overriddenMetadata` when a
  higher-precedence layer defines the same **leaf** (scalar/object leaves only; array leaves merge
  by contribution, so a write into one reports `ok` — the read side's contributor origins tell the
  whole story). In a batch, **every** edited leaf is evaluated (rev 3 — checking only the last edit
  hides a masked earlier one): `status` is `okOverridden` when ANY edit is masked,
  `overriddenMetadata` reports the first masked edit, and `maskedEditIndexes` lists them all.
- **`config/batchWrite {edits[], target?, cwd?, expectedVersion?}`** — edits apply **in order** to
  one in-memory document; **any failing edit refuses the whole batch** with the file untouched
  (there is only ever the single final tmp+rename write, so rollback is structural, not
  compensating). No reload flag (D-M5-2): a write binds at the next engine spawn (new thread,
  reopen, clear, rewind swap) and the method docs say so.
- **Concurrency (D-M5-14, rev 2; lock mechanism replaced at D-M5-24, rev 9):** the version token is
  `sha256` of the file's raw bytes (`"absent"` for a missing file), and the check is made **atomic
  with the write**, not advisory: per-target-file writes serialize on an in-process queue, and the
  queue holds a cross-process lock at `<file>.lock` across read → validate `expectedVersion` → write
  tmp → rename. That lock is a **claim directory** (rev 9): it is published by `rename`, which fails
  against any non-empty claim; the owner is the NAME of the single marker file inside it, so every
  delete is scoped to its own owner and no lock's bytes are ever read; and the marker's mtime is a
  **lease the holder refreshes**, so a slow-but-live holder is not evicted and a dead one's claim
  expires (30s). A holder that is evicted anyway **fences** before committing, and the commit
  re-checks the file's own token one syscall before the rename — the two ways a reply of `ok` is kept
  true when mutual exclusion fails. (Rev 3's `O_EXCL` file lock with a read-back nonce is what this
  replaces: it evicted live holders by clock age and its check-then-delete break was not atomic.)
  The canonical parent directory (`.claude/`) is created before locking, and a target that is itself a
  symlink is resolved first so tmp+rename replaces the real file, never the link. Two writers with the
  same `expectedVersion` therefore serialize, and exactly one commits; the loser refuses. **WHICH refusal
  depends on whether it ever entered** (rev 11, corrected — the "exactly one commits" half was false
  before rev 9 and is now measured true, but the refusal was named too precisely): a loser that waits out
  the winner's critical section and enters reads the winner's bytes and refuses
  `ConfigVersionConflict`, and a loser whose winner holds its lease past the deadline never enters at all
  and refuses `BUSY`/`ConfigLocked` (D-M5-14c). Measured on the rev-9 code, two OS processes at the
  production 30 s window with the holder stalled 45 s: the contender refused
  `-33001 ConfigLocked` after 35 s, the file was byte-unchanged at that instant, and the holder's commit
  was the only one — where the same probe before rev 9 had both writers reply `ok` and one write vanish.
  **The contract is scoped to this protocol's
  writers** (rev 3): an external editor that changes the file inside another writer's critical
  section is last-wins — the lockfile serializes `ccx` servers, not the world, and the narrowing is
  stated rather than implied. Omitted `expectedVersion` = last-wins by explicit choice, documented.
  Every supplied `cwd` is canonicalized ONCE, before the lock is taken — a refusal must leave the
  target byte-identical, so no validation may run after the write.
- **Write fencing, honestly framed (D-M5-4, rev 2):** the bearer token **is** full user authority on
  this server — `thread/start` accepts any cwd and `thread/shellCommand` exists, so a "workspace
  root" check adds no security (the review is right, and the previously-cited `fs/read` jail does
  not exist — `workspace.ts` deliberately accepts client roots). What we fence is **structure and
  accident**: no arbitrary `filePath` is ever accepted (the one Codex field we refuse); the target
  composes only to the three fixed filenames; `cwd` must be an absolute path to an existing
  directory and is canonicalized (`realpath`) before composing, so a symlinked path writes where it
  really points and the response's `filePath` reports the canonical truth.
- Config error vocabulary rides `error.data.code` on the existing JSON-RPC codes (D-M5-9) —
  `ConfigVersionConflict`, `ConfigValidationError`; `peer.replyError` already carries `data`.
- `config/mcpServer/reload` is **not** shipped: our `mcpServer/reconnect` covers that seam —
  recorded covered-by on the scorecard, not a gap. No `config/warning` notification: parse
  diagnostics are served as `disabledReason` to the client that asked.
- Paths are DI-injected (`homeDir` in deps, defaulting to `os.homedir()`), so tests never touch the
  real `~/.claude/settings.json`.

### Thread search — the store, found

- **`thread/search {searchTerm, cursor?, limit?, sortKey?, sortDirection?, archived?, cwd?}` →
  `{data: [{thread, snippet}], nextCursor, skipped?}`.** Case-insensitive literal substring over two
  corpora: session metadata (`customTitle`/`summary`/`firstPrompt`/`tag`) and persisted transcript
  content.
- **Ordering is global, the scan is paged (D-M5-15, rev 2).** The full `listSessions` metadata list
  is sorted **in memory** (it is metadata, not transcripts — cheap) by
  `sortKey ∈ created_at|updated_at|recency_at` (Codex's exact tokens; `recency_at` ≡
  `lastModified`, missing `createdAt` sorts last) with `sessionId` as the tie-breaker. The cursor is
  a **keyset** with ONE convention (rev 3 — the plan review found a mint/resume
  mismatch): `(sortValue, sessionId, rowIndex)` always names the NEXT position to examine. Resume
  locates the first session whose `(sortValue, sessionId)` tuple is ≥ the cursor's in the requested
  direction — never a bare `sessionId` lookup that restarts at the top when the session vanished —
  and `rowIndex` applies only when the located session IS the cursor's; a deleted or moved session
  resumes at the successor tuple, row 0. No unscanned session can sort ahead of a returned page in
  `created_at` order (the stable default). For `updated_at`/`recency_at` the sort value can move
  between pages; the contract is keyset semantics (a moved session may be re-encountered or
  skipped), stated in the schema docs with `created_at` recommended for exhaustive walks.
- **No permanent false negatives (D-M5-16, rev 2).** The per-page caps (files per page, rows per
  page) bound **work per request, never coverage**: the cursor carries the intra-file row position,
  a page that exhausted its budget mid-file resumes exactly there, and **a page may legitimately
  return zero matches with a non-null `nextCursor`** — bounded progress, honestly reported.
  Transcripts are read in **row windows** — `getSessionMessages`'s own `{offset, limit}` — which bound
  the rows a page holds and scans (rev 10, D-M5-25b: they do **not** bound the storage read, and the
  rev-3 sentence claiming they did is withdrawn; the shipped reader materializes the whole transcript
  per window, so the loop is a measured ~7.8x cost multiplier and the memory in force is file size ×
  concurrent scans, held to one by `runScanExclusive`). Rows larger than the row cap are skipped **and
  counted** in `skipped`, never silently.
- **Hard bounds (D-M5-17):** `searchTerm` 2–256 UTF-16 units; `limit` ≤ 50 (over-cap CLAMPS with a
  `warning`, the `thread/read` precedent, deviating from the plan review's refuse-recommendation);
  snippet ≤ **max(200, term length)** units centered on the match (rev 3 — a 256-unit term must
  still fit its own snippet); ≤ 40 files and ≤ 4000 rows examined per page; row cap **1,048,576
  UTF-16 units** of corpus text (rev 3 — the unit is what `String.length` measures, named honestly);
  one content scan runs at a time per server (a second search request queues behind it on a chain,
  same device as `record.chain`).
- **`thread/searchOccurrences {threadId, searchTerm, cursor?, limit?}` → `{data, nextCursor}`** —
  per-thread hits over exactly the corpus `sessions/rows.ts` classifies (visible user prompts +
  assistant text — Codex's corpus definition, and we own the classifier, so search and replay cannot
  drift). Each occurrence: `snippet`, UTF-16 `snippetMatchRange` (Codex's field name, verbatim), the
  row's `uuid` (our durable row identity, standing in for Codex's `turnId`/`itemId` pair —
  documented deviation), and `rowOffset`.
- **The jump contract (D-M5-7, rev 2).** `rowOffset` alone is not consumable — `thread/read`'s
  cursor is epoch-qualified and live-only (`schema/core.ts`). So each occurrence on a **live**
  thread also carries `readCursor`: the server-composed, epoch-qualified, **inclusive** pager cursor
  (`"<epoch>:<rowOffset+1>"` under the pager's exclusive-upper-bound convention) that `thread/read`
  accepts unchanged and whose returned window ends at the hit row. On a **cold** session
  `readCursor` is `null` and the occurrence is self-contained (snippet + range + uuid); a client
  that wants to page a cold transcript resumes it first — `thread/resume` exists precisely to open
  store sessions, and acceptance proves the live-thread jump end-to-end **for every returned
  occurrence, asserted against the pager's real item shape** (rev 3 — the rev-2 test checked one
  hit against a field items do not carry). The occurrence **continuation cursor is generation-qualified,
  with no exemption** (rev 11, D-M5-26 — the rev-3 rule was "epoch-qualified on a LIVE thread", and its
  cold-session escape, `e: null`, is what let three separate walks resume against content that had moved):
  the stamp names its authority as well as its value, `L<epoch>` where this server holds the session live
  and `S<lastModified>:<fileSize>` off the store's own metadata otherwise, and a mismatch refuses with
  `thread/read`'s own message. Both cursors are also bound to the QUERY they were minted under. A `threadId` naming a
  session the store does not know refuses `THREAD_NOT_FOUND` (rev 3) — an honest-looking empty
  result over a typo is the D-M5-8 lie in miniature.
- **Search honesty (D-M5-8, the D-M4-1 family rule):** a store read failure is an **error**, never
  zero hits — a directory that cannot be listed or a file that cannot be opened refuses the request;
  "no matches" is a claim about content actually scanned, and `skipped` discloses what was not. The
  failure is **established by auditing the store with plain `fs` before the scan** (rev 10, D-M5-25a),
  because the SDK's readers answer `[]`/`undefined` for one and never throw; `ENOENT` alone is the
  honest empty. The refusal carries the store's own errno with absolute paths stripped.
- Dropped from Codex's shape, documented (D-M5-6): `sourceKinds` (our store records no source kind)
  and `backwardsCursor` (our `thread/list` never had one; reverse by flipping `sortDirection`).

### Archive — server-owned state, store untouched

- **Per-session marker files (D-M5-3, rev 2):** `~/.claude/ccx/archived/<sessionId>` — archive is
  one atomic file create, unarchive one unlink. **No read-modify-write exists to race**: two server
  processes archiving different sessions touch different files; archiving the same session twice is
  `EEXIST` → `{ok:true}` idempotent, unarchiving a non-archived one `ENOENT` → `{ok:true}`. The
  original single-JSON sidecar died in review for exactly the lost-update race it carried.
- `thread/archive {threadId}` → `{ok:true}` + `thread/archived {sessionId}` broadcast;
  `thread/unarchive` mirrors with `thread/unarchived`. Response and notification shapes follow
  `thread/delete`'s precedent (`{ok:true}`, `sessionId` payload — a documented deviation from
  Codex's `threadId`, same as the delete row already records).
- **The live-guard converges under race (D-M5-10, rev 2; widened rev 3):** archive resolves the id
  and refuses a live thread ("close it first", delete's message) — where "live" includes a resume
  **reservation** (`resumingSessions`), not just a registry record, since an admission mid-probe has
  no record yet — and after creating the marker it **re-checks** both: if a resume won the race, the
  marker is unlinked and the request refuses BUSY. The other direction is defined rather than left
  to luck (rev 3): **admission of an archived session auto-unarchives it** — `thread/resume`,
  resume-carrying `thread/start`, and `thread/attach` remove the marker and broadcast
  `thread/unarchived` — because opening a conversation takes it off the shelf, and it is the rule
  that makes "a live thread is never hidden from the default list" hold across servers too.
  Archiving a session the store does not know refuses `THREAD_NOT_FOUND` (rev 3 — a typo must not
  mint permanent phantom archive state); unarchive stays idempotent for any session with a marker
  or a store row.
- Markers are read per `thread/list`/`thread/search` request, so cross-process **state** is always
  current; **push freshness** is per-server (a broadcast reaches the emitting server's own
  subscribers), documented as the multi-server limitation.
- `thread/list` and `thread/search` gain `archived?: boolean` with Codex's exact semantics:
  absent/false excludes archived sessions, true returns only them. The one change to an existing
  method, additive.

### The 0.3.234 absorb task (probe-gated)

One small task, probe-first: (a) does the headless `/context` result carry the new structured
`context_usage` sibling; (b) does a headless init carry `terminal_slash_commands`. What is alive gets
wired — the structured card into the context-usage surface, `terminal_slash_commands` as a field on
`thread/capabilities/read` (it exists precisely for remote UIs like our web clients). What is dead
flips the `full-potential.md` rows and ships nothing.

### Cross-cutting

- Scorecard: seven new rows in the server-origin table plus two notification rows; registered
  methods 59 → 66; the notification TOTAL 27 → 29 — **not the recipe, which stays at 27** (corrected at Task 11, where measurement beat three agreeing sources: this bullet, the plan, and the controller's dispatch all said "recipe 27 → 29", and applying it literally would have broken the recipe's own arithmetic). The recipe counts SLASH-SHAPED wire literals and **already includes** `thread/archived` and `thread/unarchived`; the total reaches 29 by adding the two names carrying no slash, `initialized` and `warning`. The document therefore holds two different 27s that share a number and share no members — the recipe's set, and "the other 27" (29 less the two that now carry rows). Both are right in their own scope and the collision is named explicitly in the Totals section rather than resolved by picking one. The drift gate's three passes enforce
  registration, staleness and bijection; schema artifacts regenerate in the same change. **Every one
  of the seven methods ships its exact request AND response zod schema** (rev 3: `MethodSchema`
  gains an optional `result` slot, emitted into the generated artifacts for methods that declare it
  — the seven M5 methods are its first users; error `data.code` values and both notification
  payloads are pinned by wire fixtures) — the review's naming nits (sortKey tokens,
  `snippetMatchRange`, `{ok:true}`) are resolved above and the schemas keep them resolved.
  `thread/searchOccurrences`, `thread/archive` and `thread/unarchive` join `ENGINE_GONE_EXEMPT`
  (rev 3): they are disk/sidecar reads that must answer for a thread whose engine died, or the same
  session becomes reachable by bare store id but not by its own registry id.
- Origin scope: `thread/archive`/`unarchive` and `thread/searchOccurrences` are `both` (disk +
  sidecar only, the `thread/delete` / `thread/read` precedents); `thread/search` and the config trio
  name no thread — `N/A`, like `fs/read`.
- **Plan staging (review F11, adopted; hardened rev 3):** the plan lands in reviewable stages —
  config read, config writes, search + archive, absorb — and **every stage boundary leaves the
  drift gate GREEN**: each stage lands its own scorecard rows and regenerated artifacts with its
  methods, rather than accumulating eight red commits for a final docs task to reconcile. One
  milestone, one spec, staged execution.
- Testing: DI-based unit suites (temp-dir layer files, planted JSONL fixtures, temp marker dir),
  plus one keyed live acceptance script per domain half.

## Acceptance (behavior, not implementation)

1. **Read sees the chain, upstream-merged.** With `permissions.allow: ["WebFetch"]` in user and
   `permissions.deny: ["Bash"]` in local, `config/read` returns **both** in the effective view;
   `origins` attributes `permissions.allow` to user and `permissions.deny` to local as leaf paths;
   an array key contributed by two layers names both in precedence order. `includeLayers: true`
   returns raw per-layer contents; a malformed project file yields `disabledReason` while other
   layers serve.
2. **Write lands, versions guard atomically.** A user-target upsert is visible in a follow-up read
   and in the file's bytes with a round-tripping `version`; two concurrent writes carrying the
   **same** `expectedVersion` end with exactly one `ok` and one `ConfigVersionConflict`, and the
   file holds the winner's bytes; an external edit between read and write likewise defeats the
   stale token. A keyPath segment containing a literal dot round-trips unmangled.
3. **Nested writes preserve siblings; batches are atomic.** An upsert into `{a: {x: 1}}` at
   `["a","y"]` leaves `x` intact; `replace` at the same path overwrites only the leaf; a
   `config/batchWrite` whose third edit fails leaves the file byte-identical, and a successful batch
   applies its edits in order.
4. **Masked writes tell the truth.** Writing a user-layer scalar leaf that local also defines
   returns `okOverridden` with `overriddenMetadata` naming the local layer and effective value; a
   managed-file key wins over all three writable layers in the read. A project-target write with a
   relative or nonexistent `cwd` refuses; through a symlink it lands at — and reports — the
   canonical path. An unknown top-level key lands with a `warnings` entry.
5. **Search finds planted truth, honestly.** Markers planted in an old session's transcript and in a
   `customTitle` are both found with snippets containing the match; a match placed **beyond one
   page's scan budget** is found via `nextCursor` continuation (a zero-hit page with non-null cursor
   in between is legitimate); an oversized row is skipped **and reported** in `skipped`; `archived`
   filtering hides and reveals; an unreadable store directory yields an **error**, not `[]`;
   `created_at` ascending returns the true global oldest first even when it was not scanned first.
6. **Occurrences anchor.** On a live thread with three planted hits, `thread/searchOccurrences`
   returns them in order with correct UTF-16 ranges and row `uuid`s, and calling `thread/read` with
   each returned `readCursor` **unchanged** yields a window whose last row contains the match; on a
   cold session the same search succeeds with `readCursor: null`.
7. **Archive round-trips and survives races.** Archive hides from default `thread/list`, shows under
   `archived: true`, broadcasts, and unarchive restores — both idempotent; archiving a live thread
   refuses "close it first"; an archive racing a resume converges (marker removed, BUSY), and **no
   transition this server mediates** leaves a live thread hidden, in either arrival order. The
   cross-process case is excluded by construction rather than by omission: markers are re-read per
   request instead of guarded in-process (D-M5-3), so a marker another process writes for a thread live
   here does place that thread in the archived half — a transient, self-correcting state that the next
   unarchive or admission clears (D-M5-10 rev 3, D-M5-21), not one this server prevents. Two processes
   archiving different sessions both stick (marker files).
8. **The absorb probes decide.** Probe results for `context_usage` and `terminal_slash_commands` are
   recorded; alive surfaces ship wired with tests, dead ones flip their rows.

## Roadmap beyond M5 (owner-confirmed 2026-08-18)

- **M6 candidate: dynamic tools** — the one genuine reverse-request feature (the client declares
  tools at `thread/start` and *is* the tool runtime; a park cannot answer it). Needs its own
  grounding + design pass; the D1 breach is deliberate and deserves its own decision. Commitment
  decided after M5 ships.
- **Cross-session messaging (probe 110):** Claude Code's native `SendMessage`/`ListAgents` fabric is
  **headless-asymmetric**: a bare SDK session's `ListAgents` returns the user's full local fleet
  with live status, and `SendMessage` is callable (name-addressed), but SDK sessions are **not
  addressable** — absent from every roster, no `queued_notifications` capability, marker never
  arrives. The receive side is *host work, not SDK work* — the 0.3.234 origin vocabulary
  (`fromMode`, `crossSessionInbound`) describes what an injecting host stamps, and we are a host.
  Parked as a probe-grounded M6 co-candidate; its grounding pass (roster + socket protocol, from
  `Claude Code Src/`) can run in parallel with M5 execution.
- **Parking lot, demand-driven, named triggers:** inline review delivery (child-session event
  splicing); fleet elicitation bridge (D-M4-8, host-wire revision); `account`/`init` host ops (the
  two `inProcess`-only introspection rows).
- **Parking lot, added during M5 execution:**
  - **The store-adapter conformance gate certifies unusable numbers** (Task 6 review). `src/store/
    conformance.ts` asserts `typeof r.mtime === "number"` to certify a third-party session-store adapter,
    and `NaN` passes. D-M5-15a screens the *consumer* so search can no longer be broken by it, but the
    gate that blesses the input is unchanged, and every future consumer of a certified store inherits the
    same trust. Trigger: any new consumer that sorts, ranges, or arithmetics a store-supplied timestamp.
    Fix shape: make the conformance assertions demand a *usable* value (finite, non-negative integer)
    rather than a typeof.
  - **`KNOWN_TOP_LEVEL` drift detection** (Task 4 fix wave). The advisory list of settings keys is 87
    hand-transcribed names with nothing detecting divergence from upstream's `SettingsSchema`. A stale
    entry costs a missing warning and never a wrong refusal, so the stakes are low — but this is the
    "instrument rots under the code it verifies" pattern, and the house-consistent fix is to teach
    `scripts/drift-check.mjs`, which already walks source tokens for exactly this class of rot.
  - **`forkSession` survives `record.config` into the rewind swap factory** (Task 9 final review). The
    factory overrides `resume`/`resumeAt` only, so a real engine rebuilt for a conversation rewind of a
    forked thread would mint yet another id while the record and the `thread/rewound` broadcast keep
    reporting the old one. Pre-existing, and D-M5-21b strictly improves matters — this is simply now the
    LAST place a fork-carrying config can mis-identify a thread. Note `thread/reopen` already nulls
    `resume`, `resumeAt`, `droppedTurnUuid` **and** `forkSession` before rebuilding, with a comment naming
    this exact hazard: independent corroboration that D-M5-21b reads the flag the way this codebase had
    already concluded elsewhere. Fix shape: the swap factory nulls what `thread/reopen` nulls.
  - **The `deletingSessions` fence does not reach the `thread/start` surface** (Task 9 final review).
    `createThread` never consults it, so a fork-carrying `thread/start` admits while a parent delete is in
    flight. Pre-existing — no fence was removed here, there never was one — and it belongs with the
    `thread/start`-is-unguarded item above, since both are the same question: whether that surface is meant
    to be `thread/resume`'s peer. **Recorded also as a correction:** `2ca4837b3d`'s commit message states
    the fence's coverage unqualified, where the in-code comment scopes it correctly to `startThread`. The
    code is right and the message overclaims — worth keeping because a commit message is the artifact a
    future reader trusts when the code is unfamiliar.
  - **`thread/start` carrying `resume` is unguarded where `thread/resume` is guarded** (Task 9 fix wave,
    pre-existing). That surface forks an engine over whatever session id it is given, with no live-guard
    and no `deletingSessions` check, so two `thread/start` calls naming one session id register two
    records for it. Predates M5; the Task 9 eager-stamp made the resulting record *visible* where it was
    previously invisible, which is strictly an improvement but also makes the duplicate observable.
    Trigger: any client that drives resume through `thread/start` rather than `thread/resume`. Fix shape:
    give the surface its sibling's guards, which is a scope call about whether the two surfaces are meant
    to be peers.
  - **The marker store's non-errno refusal branch is stripped but unpinnable** (Task 9 fix wave, F5). The
    only mutation of 34 to survive: removing the path-strip from that branch changes nothing observable,
    because `archive.ts` throws either a typed `MarkerIdError` or an fs errno and the marker functions are
    imported directly rather than injected — so no test can drive a third failure kind through them. The
    strip was kept as defence in depth and the gap reported rather than deleting the line or writing a row
    that cannot fail. **Same family as the two reachability items above:** what is unreachable through the
    default wiring is often reachable through the injection seam, and here the seam does not exist yet.
    Trigger: injecting the marker store the way `getSessionInfo` is injected — which would also make this
    branch testable.
  - **Subagent (nested) content is searchable but not jumpable** (Task 8 review F1, D-M5-20a). Occurrences
    inside nested rows return a snippet and a row identity but `readCursor: null`, because the item pager
    discards nested frames by design (M1: "attribution only, not itemized"). Making them jumpable needs an
    addressing scheme `thread/read` does not currently have — the item ids nested frames would need are not
    minted at all. Trigger: a client asking to navigate into subagent transcripts. Fix shape: item identity
    for nested frames first, then the pager, then the cursor — in that order, since each is the previous
    one's prerequisite.
  - **`mergeTracked` records no origin for an object node** (Task 1 Minor M2, resurfaced as the root of a
    Task 4 High). `config/read` cannot say which layer contributed an empty object. D-M5-13d removed the
    write side's dependency on it, so nothing is currently broken by it — but it remains a real gap in
    what attribution can answer, and the next consumer to reason from `origins` will meet it.
  - **`thread/list`'s bare offset cursor carries the skip/repeat class the search keyset solved** (Task 10
    review ⚠️A2). `cursorParam` is a decimal offset into the array being paged, so anything that changes
    that array between two pages shifts every later position. Pre-existing — a thread closing mid-walk
    already did it — but M5 makes it first-party: `thread/archive`/`thread/unarchive` move a session across
    the partition `thread/list` now walks, so the mutator is a method of this very milestone rather than
    incidental drift. The docblock's stale justification ("stays valid for their whole lifetime") is
    corrected in place; the cursor itself is NOT changed, because re-cursoring a shipped method is a wire
    change and out of M5's scope. Trigger: a client reporting a session missed or repeated across a paged
    `thread/list` walk while archiving. Fix shape: the keyset `thread/search` already ships (D-M5-16) — a
    tuple naming the next position rather than an offset counting to it.

## Decision Log

- **D-M5-1 — three writable layers, default user.** `target ∈ user|project|local`; managed is
  outside the enum (unwritable by construction). Rejected: local-only (cannot serve "make this my
  default model"); user-only (starves project workflows).
- **D-M5-2 — writes bind at next engine spawn; no reload flag.** Rejected: Codex's
  `reloadUserConfig` engine-swap reload — heavy machinery for marginal payoff, and Codex itself
  excludes session-static settings from it.
- **D-M5-3 (rev 2) — archived-ness is per-session marker files** (`~/.claude/ccx/archived/<id>`).
  Rejected: the rev-1 single-JSON sidecar (read-modify-write loses concurrent updates across
  processes — review F8); moving the JSONL Codex-style (breaks resume/fork while archived);
  the store `tag` field (one string, two owners).
- **D-M5-4 (rev 2) — structural fencing, no security claim.** The bearer token is full user
  authority already (`thread/start` cwd, `thread/shellCommand`), so the rev-1 "workspace root jail"
  was refused by review as self-authorizing — correctly. What remains is accident-proofing: no
  arbitrary `filePath`, three fixed target filenames, absolute existing `cwd`, `realpath`
  canonicalization, canonical `filePath` in the response. Rejected: the rev-1 jail (fake boundary);
  Codex's arbitrary `filePath` (invites writes this server has no business composing).
- **D-M5-5 — unknown keys warn (`warnings` field), never refuse.** Upstream tolerates unknown
  settings keys; Codex's `ConfigSchemaUnknownKey` refusal would fight the grammar we write.
- **D-M5-6 — Codex-verbatim names; `sourceKinds` and `backwardsCursor` dropped.** Nothing true to
  serve for either. Sort tokens are Codex's exact `created_at|updated_at|recency_at`;
  `snippetMatchRange` verbatim; row `uuid` stands in for `turnId`/`itemId` (documented).
- **D-M5-7 (rev 2) — the jump is a server-composed `readCursor`,** epoch-qualified and inclusive,
  accepted by `thread/read` unchanged; `null` on cold sessions (resume first — `thread/resume` is
  the store-opening method). Rejected: raw `rowOffset` as the anchor (not consumable — epoch-
  qualified live-only pager, review F7); extending `thread/read` with a cold path (real scope, no
  driving client).
- **D-M5-8 — search honesty.** A store read failure is an error, never an empty result; partial
  coverage is disclosed (`skipped`, zero-hit pages with `nextCursor`). The D-M4-1 rule re-derived
  for this surface. **The MECHANISM is D-M5-25a (rev 10), not the handlers' catch clauses** — the
  shipped readers never throw, so the failure is established by verifying the store ourselves.
- **D-M5-9 — config errors ride `error.data.code`** (`ConfigVersionConflict`,
  `ConfigValidationError`) on existing JSON-RPC codes. `ConfigLayerReadonly` does not ship — the
  managed layer is unwritable by enum construction, so the refusal is unreachable (review F10).
- **D-M5-10 (rev 2) — archive's live-guard converges:** refuse live before, re-check after marker
  creation, unlink + BUSY if a resume won the race. Rejected: delete's full reservation set
  (machinery for data destruction archive doesn't do); ignoring the race (a live thread hidden from
  the default list — review F8).
- **D-M5-11 — roadmap placement.** M6 candidates: dynamic tools and cross-session messaging (both
  grounding-first), commitment post-M5; inline delivery, fleet elicitation, account/init host ops
  demand-driven. Rejected: committing M6 now (grounding hasn't run).
- **D-M5-12 (rev 2) — `keyPath` is an array of segments,** not Codex's dotted string. Dissolves the
  quoted-segment grammar (review F2) instead of specifying it; the deviation is documented.
- **D-M5-13 (rev 2) — the merge table is explicit:** replace=set-leaf, upsert=deep-merge with the
  read side's customizer, parents created as objects, type conflict refuses untouched,
  `replace:null` deletes, `upsert:null` refuses. Rejected: leaving semantics to the implementer
  (review F2 — "an implementation that overwrites siblings could satisfy the stated acceptance").
- **D-M5-14 (rev 2) — the version check is atomic with the write:** per-file in-process write queue
  + pid-stamped advisory lockfile held across read-validate-rename; token = sha256 of raw bytes,
  `"absent"` for missing. Rejected: rev 1's advisory hash check (a TOCTOU, review F3). **The lockfile this
  line describes no longer ships** — rev 9 (D-M5-24) replaced it with a claim DIRECTORY on a lease, because
  the file evicted live holders by clock age and its check-then-delete break was not atomic.
- **D-M5-15 (rev 2) — global keyset ordering:** full metadata sort in memory,
  `(sortValue, sessionId, rowIndex)` keyset cursor, `created_at` the stable default. Rejected:
  rev 1's capped newest-first walk (cannot serve alternate sorts truthfully — review F5).
- **D-M5-16 (rev 2) — caps bound work, never coverage:** intra-file cursor resume, zero-hit pages
  with continuation, skipped-rows disclosure. Rejected: rev 1's per-file byte cap (permanent false
  negatives — review F6). Both cursors also carry the walk's own bindings — the query and the
  transcript generation — and refuse rather than resume when either moved (rev 11, D-M5-26).
- **D-M5-17 (rev 2, units fixed rev 3) — hard bounds on every client-driven scan** (term 2–256,
  limit ≤ 50 clamp-with-warning, snippet ≤ max(200, term), ≤ 40 files / ≤ 4000 rows per page,
  1,048,576 UTF-16-unit row cap, row-windowed transcript reads — the rows a page holds, not the bytes
  the store reads, D-M5-25b — one scan at a time). Rejected:
  unbounded scanning (review F9); refusing over-cap limits (the `thread/read` clamp precedent
  governs).
- **D-M5-18 (rev 3) — `config/read` serves the CAS tokens** (`versions` map, always present for the
  writable targets in view). Rejected: version-only-on-write (a client's FIRST write against an
  existing file could never be conditional — plan review F3).
- **D-M5-18a (Task 2 review I1) — the version map has THREE tokens, and only two of them are
  assertable.** D-M5-18 defined `"absent"` as the token for a settings file that does not exist yet.
  Implementation contact found `config/read` minting it for a second, materially different case: a file
  that exists but could not be read (EACCES on a mode-000 file, EISDIR on a directory). The distinction
  exists at exactly one point in the system — `readLayers` returns a layer object for an unreadable file
  and nothing at all for an absent one — and the `?.raw` optional chain destroyed it there, leaving the
  write path nothing to recover it from except a re-read that races a `chmod`. The concrete loss: a
  write-only `settings.local.json` (mode 0200 is unusual but entirely legal, since write permission is
  independent of read permission) reads as `"absent"`, a client sends `expectedVersion: "absent"`, and a
  CAS built on the same token function overwrites a file whose bytes were never read. So: a third
  sentinel, `"unreadable"`, minted when a layer is in view but carries no `raw`. `"absent"` narrows back
  to exactly "no such file". On the write side `"unreadable"` is **refused as an assertion** with
  `ConfigValidationError` ahead of the CAS compare — it describes the server's inability, not the file's
  content, so a client holding it never saw the bytes whose continuity it would be asserting — and
  `readTargetDoc` refuses any non-ENOENT read failure for the same reason: never write bytes over bytes
  you were never able to see. Mechanically the refusal is belt-and-braces (still unreadable → the read
  refuses; readable again → the token is a hash and the compare conflicts), which is the point: it fails
  closed by design with a diagnosable message rather than by accident with an opaque one. Rejected:
  leaving the overload for the write path to sort out — the information is already gone by then;
  and widening `versionToken` to three cases — the third case is layer state, not bytes, so it belongs
  to the caller and the function stays pure.
- **D-M5-12a (Task 3 review M4, rev 4) — the dangerous-key refusal covers values, not just
  keyPaths; null-prototype dictionaries are NOT adopted.** Rev 3 wrote two things into one sentence: a
  refusal of `__proto__`/`constructor`/`prototype` as keyPath segments, and "own-property access on
  null-prototype dictionaries throughout". Only the first shipped. Review measured what the gap costs:
  a literal `__proto__` key inside an *upsert value* reaches the merge's `out[k] = …`, which invokes
  the `Object.prototype.__proto__` setter — the merged node's prototype is set to the client's object
  and the key silently vanishes from the written JSON, while the same key under `replace` round-trips
  intact. Confirmed: **no global prototype pollution** (`Object.prototype` and a fresh `{}` both stay
  clean). Chosen: extend the existing refusal to those three names appearing anywhere inside a written
  value, recursively. A silent vanish becomes a clear refusal, and the two halves of one rule stop
  disagreeing. Rejected: converting the merge machinery to null-prototype dictionaries — it reaches
  back into Task 1's reviewed-and-closed `settingsMerge` for a case with no demonstrated pollution, and
  buys nothing the refusal does not. The spec prose above is narrowed to match what ships rather than
  left describing an intent the code never had.
- **D-M5-14a (Task 3 review, rev 4) — three write-path failures that the CAS design did not cover.**
  All three surfaced only at implementation contact, and none is a deviation by the implementer:
  1. **Only a *successful* stale-break may skip the retry budget.** The lock loop's `continue` sat
     inside the staleness branch, past both the deadline check and the sleep, and the `unlink`'s
     failure was swallowed. So a stale, stable lock that *cannot be unlinked* — an ordinary leftover
     `.lock` in a directory the process may read but not write — spun at roughly 6,600 iterations a
     second forever: no deadline, no error, one core pegged, and, because the spinning call sits inside
     the in-process chain, every later write to that path wedged behind it permanently. A denial of
     service on the whole config-write domain reachable from ordinary filesystem permissions. Measured
     twice without mocking (mode-0555 directory → `EACCES`; `chflags uchg` → `EPERM`). Note the
     hypothesis this *disproved*: a stale-but-UNSTABLE lock does not spin at production settings,
     because each rewrite bumps the mtime and the next iteration takes the sleeping path.
  2. **`writeTargetDoc` preserves the target's mode.** tmp+rename installed the tmp file's mode, so a
     settings file at 0600 came back 0644 — and settings legitimately carry `env` values and
     `apiKeyHelper` paths, making the first write through this API an information disclosure.
  3. **A blank settings file is writable, and a dangling symlink is resolved rather than replaced.**
     The read side deliberately treats blank-or-BOM-only as an empty layer with a real hash token
     (upstream's loader does), but the write side sent the same bytes to `JSON.parse` and refused them
     forever — `touch settings.json` was a permanent dead end through the API. And when a settings path
     was a symlink whose target did not yet exist, `realpath` failed, the literal link path came back,
     and tmp+rename replaced the link with a regular file — the exact detachment the "never the link"
     clause exists to prevent, in the one case the wording permitted by accident. Both are fixed toward
     *working*, not toward refusing: blank reads as `{}` with the real byte hash, and a dangling link is
     resolved by a bounded `readlink` walk so the write creates the real file and the link survives.
     Rejected for both: refusing instead — it would leave `touch`-then-write and link-based
     provisioning permanently unusable, which is the same dead end wearing a better error message.
- **D-M5-14b (Task 3 completion wave, rev 4) — a settings file this API *creates* is private (0600);
  a file that already exists keeps exactly the mode it had.** Two rounds of review walked this one in.
  D-M5-14a made `writeTargetDoc` preserve the destination's mode, which stopped a 0600 file coming back
  0644 — but the *temp* file beside it was still created at the umask default, holding identical bytes.
  Measured live: rewriting a 0600 file containing `{"env":{"SECRET":"..."}}`, a poller caught
  `settings.json.tmp-…` at mode 644 in the same directory, and nothing removed it if the write failed
  partway, so a crash left a world-readable copy indefinitely. Creating the temp at the destination's
  mode closes that — and for a file that does not exist yet there is no destination mode to copy, so
  the fallback decides what a newly created settings file looks like. Chosen: **0600**. This is the path
  that writes credential-adjacent content programmatically — `env` values, `apiKeyHelper` paths — and
  the very first write may carry a secret, so private-by-default is right in the one direction we
  control; thereafter the user's own mode is preserved, so widening it is one `chmod` and it sticks.
  Rejected: inheriting the umask default (0644) for new files, which was the earlier instruction — it
  makes the first programmatic write of a secret world-readable at rest, and the version-control
  argument for group-readable project settings does not hold, since git records only the executable
  bit. Note this is a narrowing, not a widening: no existing file's mode is ever changed by a write.
- **D-M5-14c (Task 4 review I-3, rev 4) — lock contention answers `BUSY`, not "invalid params".** The
  write path surfaced `"config target is locked by another writer"` as `-32602` with
  `data.code: "ConfigValidationError"` — the one reading guaranteed to stop a client retrying, on two
  public methods. Chosen: `ERR.BUSY` (-33001) with `data: { code: "ConfigLocked" }`. The reasoning is the
  taxonomy's own, stated in `rpc.ts`'s header on `ATTACH_FAILED` — *"One code for both because a client's
  move is the same"*: these codes are grouped by what the caller should do next, and the caller's move
  here is "retry shortly", which is precisely what `BUSY` means elsewhere in this server. Rejected:
  spending `-33009` on it (the family is fully allocated `-33001..-33008` and nothing here needs a new
  number); and leaving it inside `-32602` with only a new `data.code` string (a config-aware client would
  discriminate correctly, but every generic client would still read the outer code as "your request was
  malformed"). Recorded alongside it: the **more reachable symptom is not the error at all** — with a
  foreign lockfile present a write usually blocks ~30 s, breaks the stale lock, and succeeds; the error
  fires only when the lock cannot be unlinked or a live writer holds it past the deadline. (Still true for
  a DEAD writer's leftover, which is what that sentence was about. Under D-M5-24 a LIVE holder keeps its
  lease, so that case now ends in this refusal instead of in a break — the refusal is the repair, not a
  regression from it.) Documented rather than re-architected. The seam a later milestone will want is separating "how long do I wait" from
  "when is a lock stale" — today `withFileLock` takes only `staleMs` and derives the deadline from it.
- **D-M5-13a (Task 4 review I-1, rev 4) — the masking report names the EFFECTIVE layer.** The scan took
  the *first* hit walking upward from the lowest layer; precedence is user < project < local < managed, so
  the effective value is the *last* match. With `project` and `local` both defining a key, a user-target
  write replied `overridingLayer: "project"` while the same server's `config/read` reported `local` — a
  client told which file to edit would edit the wrong one and still be masked. The field is named
  `effectiveValue`; **this entry claimed it now held one, and a second review showed that was still
  false for object-valued leaves — see D-M5-13b, which supersedes the claim.** Also narrowed here: the array carve-out (higher-layer arrays are
  exempt because arrays merge by contribution) applies only when **both** sides are arrays — a scalar
  written under a higher-layer array was reported `ok` while having no effect at all.
- **D-M5-13b (Task 4, second re-review, rev 4) — masking is decided leaf-wise, from the read side's own
  attribution.** D-M5-13a fixed the masking scan to name the *effective* layer and asserted the problem
  closed. It was not. The verdict was still computed at the written `keyPath` while the merge operates
  leaf-wise beneath it, so an object write — the ordinary shape of `env`, `hooks`, `permissions` — was
  reported as fully masked when it had actually landed. Measured: project holds `{"env":{"B":"2"}}`, a
  client writes `env:{"A":"1"}` at the user layer, and the reply says `okOverridden` /
  `effectiveValue: {"B":"2"}` while the same server's `config/read` returns `{"A":"1","B":"2"}` and
  attributes `env.A` to `user`. The client was told its write did nothing, and shown a value its own
  server contradicted. Two waves had already touched this code without the divergence surfacing, because
  every masking assertion hard-coded an expected string instead of comparing the two methods.
  **The rule, chosen so the two methods cannot disagree by construction:** an edit is masked at a leaf
  exactly when the read side does not attribute that leaf to the layer written; the edit is
  `okOverridden` only when *no* leaf it introduces is attributed to that layer. `effectiveValue` is read
  out of `effectiveView(layers).config` — the very function `config/read` uses — never out of a single
  layer's own value. `overridingLayer` is the highest-precedence layer among the masked leaves' origins.
  This subsumes the both-sides-arrays carve-out of D-M5-13a: an array the target contributed to is in
  force by the rule itself, so the special case is deleted rather than kept alongside.
  Rejected: patching `top.value` to the merged value while keeping a path-level verdict — it would fix
  the number and keep the lie, since a partially-landed write is not overridden; and declaring
  object-over-object simply "never masked", which is wrong in the case where every written sub-key is
  also defined above. The lesson recorded with it: **when two methods must agree, assert the agreement,
  not a transcript of one side.**
- **D-M5-13c (Task 4, fourth re-review, rev 4) — the verdict is ONE lookup; the search survives only as
  naming.** D-M5-13b's rule was right and stayed right through four fix waves. What kept breaking was
  that the implementation computed a *proxy* for it: `originAt` asked "is there an `origins` key at,
  above, or strictly below this leaf?" and the caller read *not found* as **nobody outranks me**, while
  the rule says an unattributed leaf is **masked**. The two coincide in most states and diverge in two
  reachable classes, quantified by sweep — 666 disagreements in 10 800 two-layer states and 298 in 1 728
  three-layer states, every one a dead write or dead delete reported `ok`. Class 1: a higher layer holds
  an object that contributes no leaves (built only from empty objects), so nothing exists at, above, or
  below to find. Class 2: an ancestor is flattened at one layer and rebuilt at a higher one, whose leaves
  are *siblings* of the written leaf rather than descendants — in ordinary vocabulary, project settings
  hold `{"statusLine": null}`, local settings hold `{"statusLine":{"type":"command"}}`, and a user write
  of `["statusLine","command"]` is reported in force while the read side shows it nowhere.
  **Resolution: state the rule as a single lookup and let nothing else decide.** A non-delete leaf is in
  force exactly when `origins[leaf.join(".")]` is the target (or, for an array leaf, includes it);
  anything else, including no entry at all, is masked. A delete is in force when the path does not
  resolve in the merged config, or resolves below the target — the "in force by absence" principle kept,
  but stated as absence rather than as "no origins entry", which is the conflation that swallowed both
  classes. `originAt`'s climb and descendant scan are demoted to **naming** the overriding layer, with a
  fallback to the highest layer above the target that defines the path. Naming cannot cause a
  disagreement; only the verdict can, and the verdict now reads exactly one thing.
  Rejected: a fifth patch for the two new classes — four waves had already shown that patching states
  leaves the next state unpatched, because the defect was never the states, it was the proxy.
  **Residual, deliberately not closed here:** `config/read` cannot say which layer contributed an *empty
  object*, because `mergeTracked` records no `origins` entry for an object node — the root of class 1.
  This was raised as a Minor against Task 1 ("an empty object value gets no origin") and deferred; it
  resurfaced two tasks later as the root of a wire-visible High. **This entry claimed the verdict was correct
  without closing it, so that only the *name* needed a fallback. That held for value edits and was FALSE
  for deletes, where it cost the verdict — see D-M5-13d, which removes the dependency instead.** **The
  lesson recorded with it: a deferred Minor in an attribution layer is a latent defect in every consumer
  that reasons from it.**
  **Two states the lookup leaves for the naming step to settle, decided at implementation.** (a) A DELETE
  whose path still *resolves* while nothing at or under it is attributed — the residual above, seen from
  the delete side: absence cannot say whether the surviving object is held above the target or below it.
  The naming scan breaks the tie in the one safe direction — masked only when a layer that outranks the
  target genuinely holds the path, in force otherwise — so the failure mode is a missed report, never a
  client sent to edit a file that overrides nothing. (b) A masked edit with *no* layer above the target on
  its path, which is only reachable when a LATER edit in the same request overwrote or deleted what this
  one wrote. `overridingLayer` is required by the published schema, so the target names itself and the
  message says the loss is the target layer's own content, not a higher layer's. This surfaces intra-batch
  shadowing by a later delete, which previously replied `ok` for an edit whose value reached no file;
  shadowing by a later *value* stays unreported, since `origins` addresses leaves and the leaf really is
  attributed to the target.
- **D-M5-13d (Task 4, final gate, rev 4) — a delete's verdict is a counterfactual over merges, not a
  lookup.** D-M5-13c restructured the *value* verdict into a single attribution lookup, and an
  independent 18 746-state generator later found zero disagreements there. It did not touch the **delete**
  branch, which still decided from a search over `origins` — the same conflation, surviving in the one
  place the rewrite did not reach. Worse, the safeguard built for exactly this blind spot was gated
  behind an empty neighbourhood, so a single leaf from any *lower* layer under the path disabled it.
  Measured: user holds `hooks.a`, project (the target) holds `hooks.b`, local holds `hooks.z: {}`; a
  delete of `hooks` at project replies `ok` while the read side still serves `hooks.z` from the layer
  **above** the target. Remove the user layer — the only difference — and the same delete correctly
  replies `okOverridden`.
  **Resolution: ask the question directly instead of inferring it from attribution.** A delete is masked
  exactly when the merged view without the target's contribution differs, at the written path, from the
  merged view of the layers *below* the target — i.e. when something above actually surfaces there. In
  force otherwise: the key is either gone, or present solely because a lower layer shows through, which
  was already the decided `ok` case. Naming is the highest above-layer whose removal moves that value.
  Rejected: widening the safeguard's gate — measured to fix these states *and leave all 48 rows green*,
  but wrong in the opposite direction, marking a delete masked when an above layer's `{}` merges into a
  lower object and contributes nothing.
  **This corrects D-M5-13c's residual claim.** The `mergeTracked` empty-object gap was not costing only
  the *name*; for deletes it was costing the *verdict*. The counterfactual consults no `origins` at all,
  so the blind spot cannot reach it — `configLayers.ts` still stays closed, now for a sound reason rather
  than an accidental one. **The lesson: when a rule is restructured, every branch that implements it must
  be restructured — a survivor keeps the original defect and inherits none of the fix.** And the
  corollary that made this findable at all: the wave's own 558-state sweep passed on the defective code,
  because it never planted a lower-layer leaf under a deleted path beside a higher-layer object, and its
  test-side oracle read the same `origins` and inherited the same blindness. **A sweep and an oracle
  written by the author of the code share its blind spots; only an independently authored generator
  found this.**
- **D-M5-13e (fix wave F, rev 12) — a contributor list names the layers a reader can SEE, and the fifth
  wave of this rule was a regression the fourth introduced.** D-M5-13b's rule ("an edit is masked exactly
  when the read side does not attribute that leaf to the layer that was written") is unchanged and stays
  right. What broke was the attribution it reads. B5 (fix wave B) correctly made an object merged over an
  array keep the ARRAY — that is real lodash — but in `mergeTracked` it also made the object an
  unconditional CO-CONTRIBUTOR at that path, appending to the list rather than replacing it. The verdict
  is a MEMBERSHIP test, so a `config/value/write` whose every element a higher layer's index keys had
  replaced still read as "attributed to me" and was reported `ok` — in force — while `config/read` served
  the higher layer's value at the same path. Constructed on the real wire: user
  `{permissions:{allow:["OLD"]}}`, project `{permissions:{allow:{"0":"PROJECT-WINS"}}}`, a user write of
  `["USER-WRITES-THIS"]` → `{"status":"ok"}`, bytes on disk correct, effective view `["PROJECT-WINS"]`.
  The same line revived the B4-class cosmetic over-attribution in the other direction
  (`{hooks:["x"]}` under `{hooks:{PreToolUse:1}}` → `origins {"hooks":["user","project"]}` for an array
  only the user is in).
  **Resolution: ask each side of the merge its own question, and answer both from what JSON shows.** The
  lower layers stay in the list exactly while something of theirs still surfaces — `survivesMerge`
  mirrors `settingsMerge`'s own three branches, so it cannot drift from what the merge does — and the
  incoming layer joins it only when it contributes an ARRAY INDEX key, since a non-index key rides the
  array as a property no serialization shows. Both directions are the same principle: `origins` describes
  what is served, and a layer whose whole contribution is invisible on the wire is not contributing to it.
  Because both methods derive from this one map, an over-attribution here is not a wrong *name* — it is a
  wrong *verdict*, and the split D-M5-13c drew between the two does not protect against it.
  **Why it survived the sweep, which is the reusable part.** The write sweep's oracle checks attribution
  against attribution (`origins[k].includes(target)`), so it is structurally incapable of catching an
  over-attribution: both sides read the same wrong list and agree. Only a VALUE-level check — is what I
  wrote present at that path in the merged view — can see it, and the new rows use exactly that as their
  oracle. And the B5 example row pinned the new merge rule with a NON-index key, the one shape where the
  array genuinely survives intact and `ok` is right; the index-key case that patches elements was never
  carried into the masking verdict. **An example row chosen for the easy instance of a rule leaves the
  hard instance unpinned, and reads as coverage of both.**
- **D-M5-15a (Task 6 review, rev 4) — sort values are screened `Number.isFinite`, at the point they are
  computed.** `compareTuple` returns `NaN` for a non-finite sort value, and `Array.prototype.sort` reads
  `NaN` as *no opinion* — so one malformed row does not sort oddly, it leaves **every other session
  unordered**. Because the search cursor is a keyset over exactly that order, page boundaries then skip or
  repeat sessions. Measured over 3 600 paged walks with a single bad row: **440 runs silently dropped a
  well-formed session and 993 returned one twice**; with the screen applied, zero and zero. (One caveat
  worth keeping: on input that happens to arrive pre-sorted, V8's TimSort run detection masks the defect
  entirely — 0 of 999 rows misplaced — so an incidental test proves nothing here. The realistic case is
  scrambled input, where the mean was 958 of 999 misplaced.)
  **Reachability is not hypothetical.** The harness supports a bring-your-own session store as a
  first-class config field; in that path `mtime` is assigned straight through with no normalizer; and the
  project's own adapter conformance suite asserts `typeof r.mtime === "number"`, **which `NaN`
  satisfies**. An adapter computing `new Date(row.updated_at).getTime()` over a NULL column therefore
  passes our own certification gate and emits `NaN`. Two of `sortValueOf`'s three paths had no guard at
  all — not even the `??`. `Infinity` is separately reachable from plain JSON (`1e999`).
  Chosen: `Number.isFinite(x) ? x : null` on both returns of `sortValueOf`. It subsumes the existing `??`,
  keeps `0`, does not coerce, and makes `compareTuple` total by construction, since finite minus finite is
  never `NaN`. **Placed in the primitive, not the consumer, for a reason internal to the module:**
  `encodeSearchCursor` already serializes a non-finite `v` as `null` (JSON has no `NaN`), so the cursor
  claimed *this session sorts last* for a session `compareTuple` did not sort last — the two functions
  contradicted each other. Screening at the source makes the cursor's claim true and closes both halves
  at once. Rejected: screening in Tasks 7 and 8 (the same fix twice, and the module stays
  self-contradictory in between).
- **D-M5-16a (Task 6 review, rev 4) — a cursor with an out-of-range row offset is REFUSED, not clamped.**
  Row offsets were type-checked but not range-checked: negative, fractional and absurd values decoded
  cleanly and were destined for a transcript read offset. D-M5-17's clamp precedent does not transfer, and
  it says so in its own terms — clamping is scoped to `limit`, *a client-authored parameter in a
  documented public schema, where clamping serves a real client intent*. A cursor is the opposite:
  server-minted, opaque, never authored by a client, so an out-of-range offset means forged or corrupted
  and there is no intent to be generous toward. Clamping would be worse than either alternative, since it
  converts an integrity failure into a plausible-looking wrong answer — resuming a transcript at a
  different row than the cursor named, which is precisely the intra-file skip/repeat D-M5-16 exists to
  eliminate. Refusal lives in the decoders (their contract is already *null on garbage*, range is part of
  the shape of a row index, and both Tasks 7 and 8 decode — a consumer-side answer means writing it twice
  and forgetting it once). **The screen was applied to the row offset and not to the SORT VALUE beside it**
  (rev 11, D-M5-26c): `typeof p.v === "number"` is true of `Infinity`, which this same reasoning refuses.
- **D-M5-17a (Task 7 review, rev 4) — match offsets are mapped back to the ORIGINAL row before they
  reach a snippet or the wire.** The normative flow searched a lowercased copy and cut the snippet from
  the original, so any code point whose lowercase form is a different UTF-16 length shifts the window by
  one unit per occurrence. In `thread/search` that is a wrong excerpt; in `thread/searchOccurrences` the
  same drift lands in `snippetMatchRange`, a field named verbatim from Codex's protocol — **wrong at the
  FIRST occurrence, not the 98th**, and on a short row it degenerates to `start === end`, a zero-length
  occurrence pointing past its own match.
  The Task 7 report judged this irreparable: every repair "either walks the row unit by unit or changes
  what case-insensitive means". Review refuted it by sweeping the whole domain — **across all of Unicode,
  U+0130 is the only code point whose `toLowerCase()` changes UTF-16 length, and nothing shrinks** (the
  context-sensitive folds — final sigma, ǅ, ﬀ, ẞ — are all length-preserving). That makes the mapping an
  O(1) length comparison every real row passes for free, plus a correction loop that runs once per U+0130
  using native `indexOf`, worst case the same order as the `toLowerCase()` already performed. Built and
  measured: drift gone at every probed offset, all existing rows green.
  It lives in `searchScan.ts` as a shared primitive rather than in either handler, so both methods route
  through **one** offset mapping — two spellings of the same arithmetic in one file is exactly what
  produced the mint/resume divergence the rev-1 plan already failed on.
  Rejected: `RegExp` with `i` for native offsets — measured worse than the warning it was given, since
  plain `i` fails to match İ/i **and** K/k **and** ẞ/ß (stricter than `toLowerCase` across the board),
  while `iu`/`iv` fixes K and ẞ but still not İ; every variant changes *which rows are hits*, and the term
  would need regex escaping besides. Also rejected: cutting the snippet from the lowercased row — the wire
  must carry the row's real casing, and nothing currently pins that (a mutation shipping lowercased
  excerpts passes every gate), so a row now pins it.
  **Both ends map, not just the start (Task 7 fix wave, rev 5).** The first cut of D-M5-17a mapped the
  match's START and then handed the snippet the raw *search-term* length, which is a second axis and it is
  live: the expansion only has to sit INSIDE the term rather than before the match. `İstanbul` is 8 UTF-16
  units and lowers to 9, so a row storing the already-decomposed `i`+U+0307 form and a row storing the
  composed `İ` are **both** hits for it while covering 9 and 8 original units — the term's own length is
  right for neither, and neither is the lowered term's. The matched span in the lowered row is
  `[at, at + termLc.length)`, so mapping **both** ends through the same primitive and taking the difference
  is the whole repair, and it stays one arithmetic in one place. The equal-length fast path survives this
  axis unchanged and the reason is worth recording: the mapping reads only the ROW's expansions, so a
  length-stable row is unit-for-unit aligned with its lowered copy and *no span inside it can change
  length* — a span that changes length needs an expansion inside it, which is exactly what makes the row's
  two lengths differ. What the fast path must pass through is the span measured in the lowered row, never
  the term's length. One convention added: a match edge landing between the `i` and its combining dot
  resolves **outward** — the start floors, the end ceils — so the span always covers every original
  character any part of which matched (term `hi` against a row holding `Hİ` reaches this, and a floored end
  would publish a range holding only the `H`). Closed inside Task 7 rather than deferred to Task 8 on the
  Task 1 precedent: the *empty object gets no origin* Minor was deferred the same way and came back as the
  root of a wire-visible Task 4 defect. Task 8 publishes `snippetMatchRange` off this span, so handing it a
  known-wrong length is the same trade.
- **D-M5-19 (rev 3) — response schemas ship for the seven new methods** via an optional
  `MethodSchema.result` slot, emitted. Rejected: retrofitting result schemas onto all 59 existing
  methods in this milestone (real work, separate value; the slot makes it incremental).
- **D-M5-19a (Task 2, implementation contact) — emitted result schemas live in a top-level `results`
  map, not inside each method entry.** D-M5-19 chose the `MethodSchema.result` slot to keep result
  schemas incremental; the TS-side slot landed as designed. The *emitted artifact* placement had to
  move. Each entry under `methods` is handed straight to `new Ajv({ strict: true }).compile(...)` by a
  pre-existing test — the method entry IS a JSON Schema, not a container — so strict mode throws on a
  sibling `result` keyword, and a `{params, result}` wrapper stops being a schema at all. Both readings
  were measured, both fail. The published artifact therefore gains `results` beside `methods`, carrying
  an entry only for methods that declare one; every pre-M5 entry keeps its exact bytes and the change is
  purely additive. Rejected: re-nesting all 59 existing entries OpenRPC-style — it is the standard shape
  and a defensible future migration, but it breaks the published contract for every existing client and
  is exactly the retrofit D-M5-19 already declined this milestone. The six remaining result schemas
  follow this placement; changing it later is its own task.
- **D-M5-20 (rev 3) — cold targets must exist**: occurrences/archive refuse `THREAD_NOT_FOUND` for
  sessions the store does not know. Rejected: honest-looking empty results and phantom markers
  (plan review F16).
- **D-M5-20a (Task 8 review, rev 5) — a nested (subagent) row stays in the occurrence corpus and
  publishes `readCursor: null`.** The corpus classifier (`rowSearchText`) sorts rows by `type`/`rowKind`
  and never reads `parent_tool_use_id`; the transcript pager discards exactly those rows at two places
  (`items/mapper.ts:29`, and `items/replay.ts:31`'s `!f.parent_tool_use_id`). So every nested row was
  **searchable and un-renderable**: `thread/searchOccurrences` published a `rowOffset`, a row `uuid` and a
  `readCursor`, and feeding that cursor back into `thread/read` at any page size returned a window not
  containing the match. Constructed on a live thread for both kinds (nested assistant text, nested user
  prompt). Any session that ran a subagent has such rows.
  This was a conflict **inside the spec**, which construction surfaced and reading could not: the literal
  corpus clause ("exactly the corpus `sessions/rows.ts` classifies") was satisfied, while acceptance cell 6
  ("each returned `readCursor` unchanged yields a window whose last row contains the match"), the stated
  rationale for owning the classifier ("so search and replay cannot drift"), and the handler's own reason
  for excluding metadata ("a jump target that cannot be jumped to") were all falsified.
  **Chosen because it is the only resolution that satisfies all four at once.** Nested rows stay in the
  corpus, so the corpus clause holds literally and pagination is untouched — a nested row still occupies
  its position in the occurrence sequence, and `rowOffset`, the continuation cursor's `c`, and every page
  boundary behave exactly as before. No cursor that fails to land is published, so the acceptance cell and
  the jump-target rule hold. `thread/search`, `thread/read`, `mapper.ts` and `replay.ts` are all untouched,
  so nothing drifts.
  **The mechanism was already there.** `readCursor` is nullable with the exact meaning *no jump available*
  — it is what a cold target returns, and a mutation composing a cursor for a cold session instead of
  `null` is RED. Reusing that state beat inventing a rule; when a contract already has a state for "I
  cannot answer that", reach for it.
  Rejected: **filtering nested rows out of the corpus** — it breaks the corpus clause, and because
  `thread/search` shares the classifier it would start answering *no match* for sessions that demonstrably
  contain the text, which is the D-M5-8 lie this spec fights everywhere else (a session's match inside
  subagent content is a real match; only the *jump* is unavailable). Rejected: **teaching the pager to
  render nested rows** — it overturns M1's deliberate "attribution only, not itemized" on a shipped method,
  a scope change M5 has no business making. Rejected: **documenting the limitation** — it leaves a
  published cursor that provably does not land, which is a wire-contract violation, not a caveat.
  Follow-up parked, not owed by M5: making subagent content jumpable is a genuine feature (it needs an
  addressing scheme the item pager does not currently have), triggered when a client asks to navigate
  subagent transcripts.
- **D-M5-21 (rev 3) — admission auto-unarchives**: resume/attach of an archived session removes the
  marker and broadcasts. Rejected: leaving the archived-and-live state reachable by racing a second
  server (plan review F12); refusing resume of archived (archive is a shelf, not a lock).
- **D-M5-21a (Task 9 review, rev 5) — `thread/archive`'s live-guard extends to the fleet roster.** The
  review found one server answering two contradictory questions about the same session two lines apart:
  `thread/resume` refused a session live in another ccx process (`"sessionId belongs to a running fleet
  session; use thread/attach"`), while `thread/archive` shelved that same id and returned `{ok:true}`.
  The reviewer correctly reported this as **brief-conformant** — the brief defines live as
  `findLiveBySessionId || resumingSessions` and says nothing about the roster — and flagged it as a spec
  call rather than making it.
  Decided: **fix.** The brief did not anticipate it, but D-M5-21's stated purpose is that the invariant
  holds *across servers too*, and the archiving server already holds the roster data and already uses it
  for precisely this decision in the neighbouring handler. One process giving two answers about one
  session's liveness is a defect regardless of which document failed to forbid it.
  Shipped small, as required: `fleetResumeCandidates` split into a synchronous half and a pid-probe half,
  composed into an exported `liveInFleet`; `thread/resume` now uses the shared probe instead of its own
  inline loop, and `thread/archive`'s live-guard gained it as a third arm behind the two in-process ones.
  No new state at the call site — the roster read is a directory listing and `ps` is spawned only when a
  roster row actually names the session.
  **Follow-on, same round:** collapsing three arms into one boolean lost *which* arm fired, and the shared
  refusal `"Thread is live in this server — close it first"` is false for the cross-process arm and its
  advice unfollowable. The code stays `ERR.BUSY` for all three — the taxonomy groups by what the client
  does next (`rpc.ts`), and that is "retry later" in every arm — while the message distinguishes them.
  Recorded because it is the general shape: **when a guard gains an arm, the refusal it shares stops being
  true for the new one, and a message is the half that carries the remedy.**
- **D-M5-21b (Task 9 re-review, rev 6) — a resume that FORKS is not an admission of the session it names.**
  The eager `sessionId` stamp D-M5-21 relies on fires on `config.resume`, and `config` is a client
  passthrough that can carry `forkSession` beside it — the pair this repo's own `rewindSession` uses for a
  non-destructive branch. The re-review found that combination stamping the PARENT id on the record, which
  then makes `routeInit`'s latch (`if (record.sessionId) return;`) a permanent no-op: the id the engine
  actually opened is never learned, and every id-keyed method — read, delete, archive, occurrence search,
  `thread/list` — answers about a session nothing is writing to.
  **Settled by measurement before deciding, because the answer decides how much to skip.** A live probe:
  parent `d78907bb…` resumed with `forkSession: true` reported `9dd9e17c…` at init, left the parent's
  transcript at the message count it had before, and carried that history into the fork's own file; the
  same resume without the flag reported the parent's id back. So the parent is *read*, not admitted —
  which makes BOTH halves of admission wrong for it: the stamp names a session this thread does not hold,
  and the auto-unarchive would take a conversation off the shelf that never opened.
  Decided: **one predicate (`forksSession`) governs both halves at both call sites** — resume-carrying
  `thread/start` and `startThread` (`thread/resume`, `thread/fork`). A forking admission stamps nothing and
  unshelves nothing; the record learns the forked id from the init latch exactly as a fresh `thread/start`
  does, and the parent stays cold — still listable, still shelvable, refused by nothing. `deletingSessions`
  still fences the parent across the admission, because a fork READS that transcript to replay it.
  The wart was **inherited, not introduced**: `startThread` has stamped `opts.resume` unconditionally since
  M2a, so `thread/resume` had the same defect before this milestone; the archive wave widened it from two
  admission surfaces to three. Repairing only the surface the task touched is the symmetric-half omission
  this project keeps catching, so both are pinned, with a mutation each.
  Rejected: **keeping the stamp for its side effect** — it made `thread/delete` refuse the parent while a
  fork ran, which looks protective but is a guard standing on a false identity; a thread reporting an id it
  does not hold is the larger defect, and the narrow hazard it covered (deleting a parent between a fork's
  admission and its first turn) is one a cold fork-then-delete has anyway. Rejected: **a second field
  recording the read-only anchor** — new state for a hazard nobody has hit.
- **D-M5-21c (Task 9 re-review, rev 6) — `thread/delete`'s live-guard extends to the fleet roster too.**
  *(Bound on the stale-row cost, added at final review so it is not re-litigated as worse than it is: a
  roster row with no `procStart` means "assume live", which makes such a session undeletable as well as
  unarchivable — but not permanently. The fleet already ships the only deleter of stale roster state, so
  the cost is "stuck until an operator clears the row", not unbounded. The trade stands on its asymmetry:
  a false "still running" costs a refusal, a false "finished" costs a transcript.)*
  D-M5-21a closed this for `thread/archive` and left the same blind spot one handler over: with a roster row
  naming a live pid, `thread/resume` refused `-32602` and `thread/archive` refused `-33001`, while
  `thread/delete` called through and erased the transcript a running ccx process was appending to.
  Decided: **fix**, for the reason D-M5-21a gives plus one of its own — deletion is the one operation no
  later reader can undo, so it is the last place to be the odd one out. Same shared probe
  (`server.ts`'s `liveInFleet`), same `ERR.BUSY`, and the cross-process sentence rather than
  `thread/delete`'s own: "live in this server — close it first" is false about a holder in another process
  and unfollowable as advice. That sentence moved to `server.ts` beside the probe and is now imported by
  both methods — it was two independent literals, which is how the two answers drift apart again.
- **D-M5-21d (fix wave A, rev 7) — the roster's `sessionId` is a LIVENESS claim, so the host maintains it
  continuously; and the admission set gains the member no request performs.** Two findings from the
  whole-branch review, one root each, both reproduced before repair.
  **A1 — the guard was right and its input was stale.** `liveInFleet` matches roster rows by `sessionId`,
  but that field was written only from inside `runTask`, once per turn (`host.ts`'s `writeSessionId`). So a
  host that HELD a conversation without having run a turn on it — every `ccx --resume <id>` idling at its
  prompt, and every terminal-side `/resume` until the next message — had a row that did not name what it
  held, and `thread/delete` erased it with `{ok:true}`. The same staleness inverted made the conversation a
  host had walked away from undeletable. Decided: **fix the field, not the guard.** The host now records the
  conversation it holds at the launch (seeded from `config.resume` when that config does not FORK — the
  roster-side reading of D-M5-21b's predicate, since `--bg --resume` names a source it reads rather than an
  id it holds), at every engine swap (`swapEngine`, the one seam /resume, /clear and both rewind arms share),
  and at the first turn's init frame as before. Absence of the field now means "this host holds no persisted
  conversation", never "not known yet". Rejected: **making the guard refuse whenever a live row carries no
  `sessionId`** — the reading the asymmetry first suggests, and it costs a permanent, unactionable refusal of
  every delete for as long as any fresh terminal is open, while the honest field makes the roster able to
  answer confidently instead. Keeping the fix upstream of `liveInFleet` is also what keeps D-M5-21a's
  invariant — `thread/resume`, `thread/archive` and `thread/delete` answering the same question the same way —
  true by construction rather than by three parallel repairs. **Residual, unchanged in kind:** the window
  between a swap and its roster write, and the boot window of a foreground `ccx --resume` before the client's
  resume op reaches the host, are races of the same class D-M5-21c already accepts, not the steady states
  this fixes.
  **A2 — a fourth path onto an existing session id.** A fleet host swapping its own conversation (the
  terminal operator's `/resume` or rewind, reaching this server as a `rewound` or `state` frame) moves
  `record.sessionId` under a LIVE thread, and if that conversation was shelved the thread left the default
  listing for the `archived: true` half — the archived-and-live state D-M5-21 exists to make unreachable —
  with nothing to clear it, since a re-attach hits the `held` early return that deliberately skips the
  unarchive. Decided: **it is an admission in substance and gets the same `autoUnarchive`**, from one funnel
  both host-side writers pass through, rather than a fourth spelling of the rule. Only a MOVE adopts: a
  rewind inside one conversation reports the id it already had, and a `cleared` swap has no id to unshelve —
  the same reading the rejoin already publishes. `autoUnarchive`'s `ctx` became optional for it, and its
  failure warning is server-scoped when nobody asked, matching the audience its success notification has.
  **A3 — auto-unarchive completes after the reply and the `thread/started` push. NOT changed, deliberately —
  and the reasoning below is the corrected one (fix wave F, rev 12).** The decline stands; two of the three
  things wave A said to justify it did not.
  *What is true:* the window is one filesystem round trip and the same watchers receive `thread/unarchived`
  immediately after, so it is self-correcting; and closing it here would still leave the transient at
  `thread/attach`, whose position is fixed by §1e's activation protocol, and at A2's path, where an observed
  transition has no reply to order against. A2 makes "the unarchive may trail the state change" a property
  clients must tolerate on at least one path, and making them tolerate it uniformly is the more honest
  contract than closing two of four windows.
  *What was false:* that closing it "would invert an ordering that is pinned". The two pinned assertions
  constrain NOTIFICATION order — `thread/started` before `thread/unarchived` — not marker-versus-reply
  order, and a mutation moving the unshelve ahead of the reply closed the window with 43 of 44 archive rows
  still green. And the window is not merely an "ordering" nicety: it is reachable by the requesting client
  ITSELF — a `thread/list` sent the instant the `thread/resume` reply arrives sees the just-admitted live
  thread absent from the default list, which is the archived-and-live state D-M5-21 exists to make
  unreachable, transiently.
  *The argument wave A should have made, and the one the decline now rests on:* moving the unshelve ahead
  of the reply re-creates B3's hazard — a post-admission step that can FAIL, turning a successful admission
  into a failure reply, or leaving the caller holding a thread whose reply said it did not get. That is a
  worse contract than a self-correcting transient, and it is a reason about consequences rather than about
  a test that would have had to be argued with. **The lesson is the reason a decline needs auditing at all:
  a future reader inherits the reasoning, not the outcome, and a decline defended by a constraint that does
  not exist is one mutation away from being reopened for the wrong reason.**
- **D-M5-22 (Task 12 spike, rev 6) — both 0.3.234 absorb candidates are ALIVE on both origins, and the
  promote sentence for one of them is amended before it ships.**
  `terminal_slash_commands`: a headless init frame carries `["doctor","color"]` beside 98 slash commands,
  and reaches BOTH the in-process router's feed and the fleet relay's. What saves the fleet origin is that
  init is **re-emitted every turn** — a fleet thread's attach burst is replay-marked and dropped by the
  router, so a once-only init would have been inProcess-only.
  **Published semantics, amended by the Task 13 review (F1) before the milestone closed: EVERY init frame
  is authoritative.** No init frame yet → the key is absent. An init frame that OMITS the field → `[]`,
  because that omission is how the engine reports "none" (`sdk.d.ts`: "present only when non-empty; absent
  on CLIs that predate the field, and on sessions where no advertised command carries the tag") — a
  pre-field CLI and a session with nothing tagged are the same instruction to a remote UI deciding what to
  hide, so collapsing them is honest rather than lossy. An init frame carrying the field → serve it, latest
  wins. A malformed value is the one thing that settles nothing: the previous (or absent) answer stands.
  The first shipped shape said the opposite about the empty case, which left `[]` unreachable and a
  once-latched list permanent; the per-turn re-emission above is what makes the corrected rule self-healing.
  `context_usage`: delivered on a `/context` turn as a **wrapper-level key on the ASSISTANT frame**
  (`message.context_usage` is absent), never on the result frame. That distinction *was* the question the
  seam step existed to answer: result frames are consumed by the submit waiter and never relayed to fleet
  followers, so a result-frame carrier would have been honestly **DEAD-for-us** on that origin. Measured
  without standing up a fleet host, by noticing the host's follower relay is fed by exactly one object —
  the per-turn `onMessage` sink handed to `Session.submit` — so both legs are observable from one turn on
  one real `Session`.
  **The amendment.** This spec's promote sentence said the structured card goes "into the context-usage
  surface". Wrong, and the spike was right to refuse it rather than comply: `thread/contextUsage/read`
  already serves `getContextUsage()`, which is **richer** (`gridRows`, `systemTools`,
  `systemPromptSections`, `slashCommands`) and costs **no turn**, where the twin is obtainable only by
  spending a `/context` turn. Folding the twin into that route would trade a free, richer answer for a
  paid, thinner one. `router.ts:127` had already reached this conclusion once, in its own words: context
  usage belongs on `thread/contextUsage/read`, "not bolted onto this route."
  **Shipped shape, which the PLAN already had right where this spec did not:** forward the twin on the
  **existing item/notification the router already emits for that turn**, with no retention, leaving
  `thread/contextUsage/read` untouched. That is additive rather than destructive — a client that runs
  `/context` as a turn gets structured output instead of text to parse, and a client that just wants the
  numbers keeps the free richer read. What the twin genuinely adds and the control response lacks is
  narrow but real: an `over_limit` field, and a semantic `used`/`free`/`buffer`/`deferred` classification
  per category where the control response offers a renderer's colour flag.
  Rejected: shipping nothing for `context_usage` (the value is small but real, and the plan's shape costs
  no degradation to pay for it); and following the original sentence literally (it makes the surface
  worse, which no promote criterion intends).
  **Residual, decided in fix wave E rather than left open (rev 11).** `TurnMapper.onAssistant` returns
  early for a message id it has already itemized through a `stream_event`, and that return sits ahead of
  the stamping call — so an assistant frame carrying `context_usage` whose id was already streamed produces
  no event to carry it. It is NOT repaired, and the reason is that there is nothing to repair in place: by
  the time the wrapper key arrives, that message's item events have already gone out, so delivering the
  twin would mean a NEW notification with no item attached — a wire shape, not a fix, and one no client has
  asked for. The only known producer is unaffected: one keyed run of `/context` with
  `includePartialMessages: true` measured the CLI-synthesized assistant frame producing **no** partials
  (previously-streamed = false), and the shipped mapper stamped both of its events. Recorded here so the
  early return is read as a bounded consequence of "the twin rides the item notification" rather than as an
  oversight; if a CLI ever streams that frame, the answer is a carrier for it, not a moved return.
- **D-M5-23 (fix wave B, rev 8) — the config domain answers about the files the ENGINE reads, and a reply
  past the commit is never a failure.** Five findings from the two whole-branch reviews, each reproduced
  before repair. Nothing here changes the write's own semantics; four of the five change WHICH BYTES the
  domain is describing, and the fifth changes what it does when it cannot describe them.
  **23a — `CLAUDE_CONFIG_DIR` was not consulted, so `ok` could mean nothing at all.** Measured against the
  shipped `claude` 2.1.234: with the variable set, the engine reads `$CLAUDE_CONFIG_DIR/settings.json` and
  ignores `$HOME/.claude/settings.json` **entirely** (`claude doctor` reports the effective value of a
  setting placed in each in turn; the control proves the default). Our domain did the opposite — `config/read`
  served the home file and `config/value/write` wrote it, replying `status: "ok"` for a change no engine
  would ever load. This spec never mentions the variable, so it is an OMISSION rather than a recorded
  decision, and the omission is narrow: **the rest of this system already follows it.** The harness's own
  tenant preset EXPORTS a per-tenant `CLAUDE_CONFIG_DIR` (`config/tenantPreset.ts`), the fleet registry
  reads the engine's session rows under it (probe 61), and the engine subprocess inherits it. Decided:
  **one resolver, shared** — `config/claudeHome.ts`'s `claudeConfigDir(env)`, which the fleet registry's
  `sessionsDir` now calls too, rather than a second spelling of an expression this repo already had right.
  What it changes for `layerPaths`: its first parameter is the **`.claude` directory itself**, not the home
  above it, because the variable REPLACES that directory (`$CLAUDE_CONFIG_DIR/settings.json`, no `.claude`
  segment) and no home-shaped value can express that. The `configHome` dep keeps its old meaning (the base
  whose `.claude` holds the file) and keeps WINNING over the variable: it is a test/embedder override, and
  the alternative is a suite pointed at a temp directory being silently redirected onto the operator's real
  settings by an ambient variable. Rejected: **moving `ccxDir`/`fleetRoot` under the same root** — the
  review suggested it "for consistency", but that is OUR state, not the engine's, it already has its own
  `CCX_FLEET_ROOT` override, and moving it would relocate the roster and sockets of every running host.
  **23a rev 2 (fix wave F, rev 12) — the resolver diverged from the engine in the one env shape 23a did
  not cover.** It read `CLAUDE_CONFIG_DIR || …`, so an EXPORTED-BUT-EMPTY variable fell back to
  `$HOME/.claude` while the reference resolves `process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')`
  and therefore treats `''` as a value — reading `./settings.json`, relative to its cwd. The same "we
  answer about a file the engine does not read" defect 23a exists to fix, one env shape along, and a shell
  writes that shape for `CLAUDE_CONFIG_DIR="$SOMETHING_UNSET"`. Now `??`, with the reference's
  `.normalize("NFC")` applied to the whole result as it is there — near-harmless on macOS, which folds the
  forms, and load-bearing on a filesystem that does not, where the engine opens the composed spelling.
  `env.HOME || homedir()` stays ours: it is the seam that lets a caller pass an env, and node's `homedir()`
  reads `$HOME` first on POSIX anyway.
  **23b — the managed layer is a FAMILY of files.** The shipped SDK bundle and the reference's
  `loadManagedFileSettings` both merge `managed-settings.json` **plus `managed-settings.d/*.json` sorted
  alphabetically on top** — the systemd/sudoers drop-in convention — and the spec's grounding sentence
  ("only `managed-settings.json` of that family is a plain file") was false. On a machine whose
  administrator ships policy as fragments, `config/read` reported the user's value as effective, dropped
  policy-only keys entirely, and answered a masked write with a plain `ok`: masking verdicts computed
  without the active policy, which is the wrong-verdict class D-M5-13 spent four waves eliminating.
  `incomplete: true` does not cover it — that flag announces NON-FILE policy sources and these are files.
  Decided: **compose them into the managed layer with the loader's own ordering and filter** (regular files
  and symlinks, `.json`, no dotfiles), each drop-in a further `managed`-named entry rather than a fifth
  precedence step. A missing directory is silence (ENOENT/ENOTDIR, upstream's own tolerance and the state
  of every unmanaged machine); a directory that exists and cannot be LISTED becomes a disabled layer,
  because absence and unreadability are the one pair this milestone is not allowed to collapse twice.
  **Bounded evidence, deliberately stated:** no reviewer created `/Library/Application Support/ClaudeCode`
  on the machine this was found on — it needs root and would take effect on the operator's own Claude Code
  — so the ENGINE half rests on the extracted loader, and our half is pinned against a control that
  installs the identical bytes as the base file. Not proven end to end, and the test file says so.
  **23c — a committed write reported as failed, and a retry that duplicates.** The masking pass runs after
  the bytes are on disk and sat inside the handler's one `try`, so a failure past the commit came back as
  `-32603`. The reachable trigger is a pathologically deep object in ANOTHER layer: `JSON.parse` accepts
  depths `effectiveView`'s recursion cannot walk (measured: ~2.8k), and the write path's own depth screen
  (64) covers only the value it was handed. A client that reads "failed" retries — and an `upsert` of an
  array is not idempotent, since the merge rule already in force concatenates and dedupes by SameValueZero
  identity, so object entries never collapse. One hook registration became two. Decided: **fence the
  ANALYSIS, not the write.** When the layers cannot be merged the reply is `ok` with the real version and
  filePath, every edit listed in `uncheckedEditIndexes`, and a warning naming what could not be checked —
  the vocabulary this reply already has for "not reported as overridden, and not verified in force".
  Rejected: **making the merge non-recursive or dedupe by structure to make the retry idempotent** — the
  first is a rewrite for a shape no settings file has, and the second is exactly the change plan review F2
  refused (a structural dedupe silently eats distinct hook entries). The retry defence a client already has
  is `expectedVersion`: the degraded reply carries a real CAS token, so the same token cannot be spent
  twice, and a retry that carries it refuses instead of duplicating.
  **23d/23e — the merged view now says only what upstream's merge says.** An own `__proto__` key in a
  settings file produced a self-contradictory `config/read`: `origins` named `__proto__.polluted` while
  `config` carried no such leaf, because `out[k] = v` on that key invokes the prototype SETTER rather than
  creating a key. Measured at both steps of upstream's own pipeline — zod's object build drops the key for
  object AND scalar values, and lodash's `safeGet` drops it again — so the engine's settings never carry
  it, and the repair is to skip it in the merge: one change that removes the incoherent attribution and the
  prototype-setter hazard together. `constructor`/`prototype` are NOT screened, because upstream keeps them.
  And an OBJECT merged over an ARRAY: upstream keeps the **array** (lodash walks the source object's keys
  onto it, so an index key patches an element and a non-index key becomes a property JSON never shows),
  while ours replaced it with the object — measured against real lodash 4.18.1 under upstream's own
  customizer. The array is now a leaf with BOTH layers as contributors, which is what the read side's
  attribution has always meant for an array. Note for the record: the two reviews filed this once each and
  the second filing was ranked with a reachability caveat (for a key the engine's schema knows, upstream
  discards a file it rejects, so the two implementations rarely see the same layer set) — one divergence,
  not two, and it is fixed because `config/read`'s answer is the one clients actually consume.
- **D-M5-24 (fix wave C, rev 9) — a lock is a claim DIRECTORY: acquire is a `rename`, ownership is a
  NAME, liveness is a LEASE, and the commit is FENCED.** This replaces the mechanism D-M5-14 rev 3
  describes, because that mechanism failed the one hard promise this milestone makes. Both failures were
  measured with real OS processes at production settings, not argued:
  **24a — a LIVE holder was evicted and the evictor's acknowledged write was then destroyed.** Writer A
  entered the critical section and stalled 45s (a suspended process, a hung network mount). At exactly
  30s writer B broke A's lock as stale, passed its version check against bytes A had already read,
  committed, and was told `status: "ok"` with a version token. Fifteen seconds later A's rename erased
  B's write, and nothing anywhere reported the loss — the direct negation of D-M5-14's "two writers with
  the same `expectedVersion` therefore serialize, and exactly one commits". The root is that staleness
  was judged by CLOCK AGE, and by that measure a slow-but-live holder is indistinguishable from a dead
  one. **24b — the break was not atomic, so two waiters deleted each other's fresh lock.** Ownership was
  verified BEFORE an `unlink` that takes only a pathname; with one abandoned lock and four contenders,
  43 of 250 trials (32 of 250 on a second machine) put two or more processes inside the critical section
  simultaneously, every one of them losing an update, with **zero** refusals reported. Traces caught a
  process inside the section while the lock file named a different owner, and another reading an empty
  owner off a lock mid-creation.
  Decided: **the lock is a non-empty directory at `<file>.lock`**, holding exactly one marker file whose
  NAME is the owner's nonce. Three properties follow, and each closes one half of the above.
  *Acquire* assembles the claim in a staging directory beside the target and `rename`s it into place:
  one atomic syscall that fails ENOTEMPTY against any live claim, and no instant in which a lock exists
  without naming its owner. *Deletes become content-conditional* — the thing POSIX gives no way to make
  an `unlink` be — because the owner is a filename: `unlink(<lock>/<nonce>)` can only ever destroy that
  owner's claim, `rmdir`'s emptiness precondition IS the atomic "no successor has claimed it" test, and
  `unlink` cannot remove a directory at all, so a fresh claim is immune BY TYPE to the pathname-only
  delete that used to destroy it. This also makes the rev-3 release rule structural rather than a
  read-then-check: an overrun owner cannot delete its successor's lock even in principle. *Staleness
  becomes a lease*: the holder refreshes its marker's mtime on a timer, so the common stall — a critical
  section waiting on slow I/O — keeps its lock, and a foreign holder that keeps its lease is **waited for
  and then refused `ConfigLocked`**, never evicted. That refusal is a deliberate behaviour change and it
  is the D-M5-14c answer, not a new one: contention is reported, and the caller's move is still "retry
  shortly". A holder whose event loop cannot run (SIGSTOP, a blocked loop, a clock jump) can still be
  evicted, so it also **fences**: it re-asserts ownership one syscall before the rename, and refreshes
  the lease while it is there, so the margin after a passing fence is a full stale window rather than the
  microseconds the check itself takes. Beside it the commit re-reads the target's own token and refuses
  if anything committed since the caller read it — an independent detector at the STORAGE layer, because
  no advisory lock deserves the trust of being the only one. Both refuse before a byte moves, so the
  retry they invite is safe for the non-idempotent `upsert` of an array.
  Rejected, with reasons: **`flock`/`fcntl`**, which would make liveness a kernel property and need no
  lease at all — Node core exposes no binding (`fs.constants.O_EXLOCK` is absent, measured on this
  platform), so it costs a native dependency in a pure-TS harness, and it is precisely the network mounts
  in 24a's scenario where advisory kernel locks are least trustworthy. **A `symlink` whose target string
  carries the owner**, which does give an atomic self-identifying create — but its removal is still a
  pathname-only `unlink`, so it fixes the torn read and not 24b. **`rename`ing a stale lock aside**,
  which is one atomic syscall but is not conditional on WHAT it moves, so it steals a fresh lock exactly
  as the unlink did. **`mkdir` then a marker inside it**, which is simpler but leaves a window where the
  claim exists empty and a second breaker can `rmdir` it out from under its owner. **A `proper-lockfile`
  dependency**, whose lease-plus-compromise design this converges with independently and which is the
  reassurance that the shape is standard — declined only because the mechanism is ~60 lines we must own
  and reason about at this seam. **Keeping the old lock and adding only the fence**, which would leave
  the critical section genuinely non-exclusive and rely on one detector for correctness.
  Recorded alongside: **a lock left by an older build (a plain file) is broken on AGE and never read** —
  the format it belongs to promised nothing more, and refusing to break it would dead-end every future
  write to that target. And **D-M5-14b's "created 0600" is now true rather than nearly true**: the
  repairing `chmod` was conditional on a destination mode existing, so a FRESH file landed at 0400 under
  `umask 0277` and 0200 under `umask 0477` — and 0200 is a settings file this API can never read back,
  which made `config/read` report the layer `unreadable`, made the write's own masking pass name the user
  layer as its own overrider, and (with the old lock inheriting the same umask, so its release could not
  read its own nonce) wedged the target permanently. The `chmod` is unconditional; every mode this code
  installs now goes through one, because `chmod` is not umask-masked and `writeFile`/`mkdir` are.
  Rejected: amending the promise to "0600 or narrower" — the narrow direction is not safe here, it is a
  denial of service on the target, and this milestone has twice ruled that a dead end through the API is
  worse than the alternative (D-M5-14a #3).
  **Residual, stated rather than papered over:** a holder that loses its lease between a passing fence
  and its rename is not detectable by the fence, and only the commit-time token check stands behind it;
  a wall-clock jump larger than the stale window can expire a live lease. Both are irreducible without
  kernel locking, and neither can produce a lost update without also producing a refusal.
- **D-M5-25 (fix wave D, rev 10) — a store read failure is ESTABLISHED, because the reader will not
  raise one.** D-M5-8's sentence is unchanged and its mechanism is replaced. The handlers' error paths
  were always correct code; they could not run. SDK 0.3.234's readers swallow every filesystem failure —
  `listSessions` wraps its `readdir` in `catch { return [] }`, `getSessionMessages` answers `[]`,
  `getSessionInfo` answers `undefined` — so on the production origin an unreadable store was
  indistinguishable from an empty one. Measured through a real server on the real wire with default
  readers: a transcript at mode 000 vanished from `thread/search` with no error, no `skipped` and
  `nextCursor: null` (the shape reserved for "there is nothing more"), the same file made
  `thread/searchOccurrences` deny the thread EXISTS, and an unlistable projects directory answered
  `{"data":[],"nextCursor":null}` — acceptance criterion 5's own words inverted. Every unit row pinning
  the contract injected a reader that THROWS, and all of them passed while this was true: **an injected
  double is a title for the storage layer** — a substitute more honest than the real dependency proves
  nothing about the real one.
  **25a — the precondition is verified with plain `fs`, where an errno propagates** (`sessions/storeAudit.ts`,
  run before the listing and before the existence check, inside `runScanExclusive` because it is disk
  work). It walks `<CLAUDE_CONFIG_DIR ?? ~/.claude>/projects` and each project directory, then `access`es
  each `*.jsonl` — one `access` per transcript, `stat` only for a dirent that is not already a regular
  file — and throws the store's own errno for the first thing it cannot read. **`ENOENT` is the one
  honest empty** (a store never written, an entry that raced away); every other errno is an inability to
  read something that is there. It runs on the PRODUCTION origin only — an injected reader is a different
  store whose failures are the injector's to raise — which is the finding restated as a gate: the origin
  the doubles stood in for is the one that now checks itself. Cost, measured on a real 1005-directory /
  4643-transcript store: ~30-45 ms for the dirent walk, ~125-160 ms with the per-file check, against
  ~1.9-2.25 s for the `listSessions()` it verifies; on that store all 4642 transcripts were readable and
  the nine the reader drops for shape reasons produced no false refusal. **The path leak lands in the same
  commit, because fixing the contract is what makes it live:** search's two error replies answered
  `e.message` verbatim — node composes an fs errno with the operator's absolute home path — where
  `thread/archive` had stripped the same text all along. Both now answer through `archiveDomain.ts`'s one
  exported `storeRefusal`/`stripPaths`, with every session-store call tagged at its own site and each
  `try` wrapping exactly the call it attributes.
  Rejected, with reasons: **reproducing the SDK's cwd-to-project-directory mapping** so the audit could
  be scoped to one project — it is internal (a character fold, a 200-character truncation with a hash
  suffix, a `CLAUDE_CODE_PROJECT_DIR_NAME` override), and a wrong mapping fails silently open; the price
  is that an unreadable corner of the store refuses even a `cwd`-scoped search, which is the direction
  D-M5-8 chooses. **Reading transcripts ourselves** instead of through `getSessionMessages` — it would
  make search and `thread/read` disagree about what a conversation says, which the whole corpus design
  exists to prevent. **A `SessionStore` adapter** — the SDK wraps those calls too, and it would replace
  the store rather than check it. **Narrowing the record instead** ("read failures are indistinguishable
  from absence on this store") — available, and refused: three surfaces state the contract and the
  fix is bounded.
  **25b — the row-window rationale is withdrawn.** D-M5-16 rev 3 and the `thread/search` scorecard row
  both said transcripts are read in row windows *at the storage boundary* because loading a whole
  transcript would spend the memory the caps bound. Measured on a 6.1 MB / 4000-row transcript:
  `limit: 1` at offset 0 costs 13.3 ms, `limit: 1` at offset 3999 11.3 ms, `limit: 500` 12.4 ms, the
  whole file 10.8 ms — one number, four requests — and the eight windows of one full page cost 84.8 ms
  against 10.9 ms for a single read of that file. The windows are a ~7.8x cost MULTIPLIER, not a bound.
  Results are correct at any size and today's transcripts are small; what was false was the reason.
  What the windows do bound is the rows a page holds and scans (`maxRowsPerPage`); the memory in force
  is file size × concurrent scans, held to one by `runScanExclusive`. Decided: **correct the claim and
  record the gap with its trigger** — transcript size, nothing else — rather than build the ranged
  reader now. Rejected: making the mechanism real, which means our own JSONL reader and therefore the
  corpus divergence 25a rejected for the same reason; and leaving the sentence standing, which is the
  false-justification-propagated class this milestone has already had to correct four times.
  **25c — one projection, one fill.** `thread/search` composed a live hit's row with `threadView` alone,
  while `thread/list` fills `title`/`tags` from the store row for the same session. A session found BY
  its stored title came back as a row that did not carry the title — the reply's own `snippet` quoting
  text the row beside it did not have, and the same thread answering differently to two methods that
  promise one projection. The fill is now `sessionLib.ts`'s exported `fillFromStore`, called by both; a
  field the record already carries still wins, since the call that patched it persisted it too.
  **25a rev 2 (fix wave F, rev 12) — three corrections to 25a, two of them to claims it published.**
  *The gate was all-or-nothing.* It returned when ANY one of `listSessions`/`getSessionMessages`/
  `getSessionInfo` was injected while the other two still read the real filesystem, so a PARTIAL
  injection skipped the audit and then swallowed the very errno it exists to raise — constructed with
  `listSessions` injected and a real transcript at mode 000: a page came back, no refusal. The gate now
  asks the question the audit is actually about — does THIS request read the local filesystem store — of
  each reader the handler calls, and the handler names its own readers. Latent in the shipped product
  (`ccx serve` injects nothing) and reachable by any embedder that doubles one reader.
  *The mid-scan guarantee was overstated on the scorecard, not in the code.* The row promised that a
  transcript read failing MID-SCAN discards the hits gathered so far. That holds whenever a reader
  raises, which is every injected store — but on the production origin the readers never raise and the
  audit runs ONCE, before the listing, so a transcript readable at audit time and unreadable when
  `getSessionMessages` opens it is answered `[]` and the page under-reports instead of refusing. A window
  the width of one audit, needing a writer racing this reader, self-healing on the next request. It is a
  residual of the mechanism 25a chose (establish the precondition, since the reader will not report it),
  not a defect in the handlers; per-transcript re-verification would pay a whole-store walk per window on
  this reader. The claim is corrected to what holds; the residual is recorded here.
  *`thread/list` is fixed rather than deferred, and the stated blocker was wrong.* The deferral said the
  audit could not live there without auditing dispatch's shared `e.message` catch across every method.
  That is not what it needs: the session-store steps get a `try` of their own, answering through the
  `storeRefusal` this module already imports and already calls for the marker read beside it, and
  dispatch's catch is untouched. What the asymmetry cost was constructible — one broken store, at one
  instant, refused `-32603` by `thread/search` and reported as `{"data":[],"nextCursor":null}` by
  `thread/list` — and of the two surfaces the thread picker is the more likely to be believed. `storeRead`
  and `auditIfReal` move to `sessionLib.ts` so the two readers of this store cannot spell one tag twice.
  *And the strip that both now share under-stripped.* `stripPaths`' path body stopped at the first
  whitespace, so a path containing a SPACE was replaced only up to it:
  `'/Users/opname/My Projects/deal-with-acme/x.jsonl'` became `'<path> Projects/deal-with-acme/x.jsonl'`.
  It protects the username and discloses the project — and on this store a project DIRECTORY name is the
  operator's cwd with every non-alphanumeric folded to `-`, so a leaked trailing segment is a leaked
  absolute path respelled. Reachable whenever the home directory or `CLAUDE_CONFIG_DIR` holds a space.
  Two passes now: a quoted path (node's own errno shape) goes whole however many spaces it holds, and an
  unquoted one takes a space only when a separator follows before the next whitespace — which is what
  keeps `read /a/b or /c/d` from eating the `or`. The residual either pass leaves is an unquoted path
  whose LAST segment holds a space with no separator after it; node produces no such message, and
  under-stripping there beats swallowing the sentence around it.
- **D-M5-26 (fix wave E, rev 11) — a cursor carries the WALK, not only the position.** Six confirmed
  defects across both search methods had one root, and finding it was the point: a cursor resumes a walk,
  and a walk's meaning rests on two things the position does not contain — the QUERY that decides what is
  enumerated, and the GENERATION of the content being enumerated. `thread/search`'s `{v,s,r}` carried
  neither; `thread/searchOccurrences`' `{s,r,c,e}` carried a generation whose `null` meant "do not check".
  All six answers were confident and wrong rather than refusals, which is the class D-M5-16a already
  decided: a cursor is server-minted and never client-authored, so a value it could not have been minted
  with means forged or corrupted, and repairing it converts an integrity failure into a plausible wrong
  answer. **Both codecs now carry `q` and `g`, computed by one function at mint and at resume** — the
  device this module was built on (one tuple ordering shared by the sort and the resume) applied to the
  other two things a resume depends on. Constructed, all six, on the real wire:
  **26a — the query.** Paging `alpha` then replaying that cursor under `beta` answered
  `{"data":[],"nextCursor":null}` — an affirmative "no matches" for a term that has one, the D-M5-8 lie
  reached with no forgery at all, and a search box that re-issues on keystroke while holding the previous
  page's cursor produces it. A `sortKey` change compared a `created_at` value against `lastModified`
  values; a `sortDirection` change and a `cwd` change each dropped rows. `q` fingerprints
  `searchTerm`/`sortKey`/`sortDirection`/`archived`/`cwd` (and, on the sibling, the term), refusing
  `-32602` with **its own sentence** — a client that changed its term was not rewound, and telling it so
  would send it re-reading a walk that was never invalidated. `limit` is deliberately not an axis: it
  sizes a page, it does not choose what is walked.
  **26b — the generation, and the removal of its exemption.** Four ways a cursor addressed a generation it
  was not minted against, three of them through `e: null`. A COLD cursor honoured after `thread/resume` +
  `thread/rewind` — two of this same server's own methods, between the two pages — returned two fabricated
  occurrences and skipped two real ones, while the identical request with a cursor differing only in its
  epoch was refused. A session another ccx host held was paged as immutable cold storage while the same
  server answered `-33001 "Thread is live in another ccx process"` for archive and delete on that id
  seconds earlier. The store-wide cursor carried no generation at all: after a rewind it read at offset
  4000 of a 500-row transcript and reported the walk complete while the same instant's fresh walk returned
  the hit. And within one page, the epoch was read once and never re-checked. `g` names the AUTHORITY as
  well as the value — `L<epoch>` where this server holds the session live, `S<lastModified>:<fileSize>`
  otherwise — so a session that changed authority between two pages is a mismatch by construction rather
  than by a case someone had to think of. The non-live half is a proxy and a deliberately conservative
  one, and its premise was **measured against the real reader rather than modelled**: the pinned SDK
  derives `lastModified` from the file's mtime (`Math.trunc(statSync(...).mtimeMs)`) and populates
  `fileSize` for local JSONL, and rewriting a 40-row transcript to 12 rows moved the stamp from
  `S1787170730355:7540` to `S1787170730588:2248`. It over-refuses — a foreign host merely APPENDING moves
  the mtime, so the next page of a walk over a session that host is actively running refuses — and that is
  the trade taken on purpose: a refusal the client retries is the honest answer to "this server cannot
  tell whether the content moved"; a plausible page is not. On `thread/search` the check is scoped to
  cursors that address ROWS (`r > 0`), because a cursor with `r === 0` names a place in the session
  ORDERING that no transcript owns, and because a cursor whose session has left the listing is the case
  D-M5-15's keyset was built for — the walk continues at the successor, and the vanished session's row
  offset is moot rather than stale.
  **26c — a forged non-finite sort value is refused at decode.** `decodeSearchCursor` screened `r` for
  range and `v` only for `typeof === "number"`, which is true of `Infinity`; `JSON.parse('{"v":1e999}')`
  produces one and no mint can (`JSON.stringify(Infinity)` is `"null"`, and D-M5-15a screens the source
  besides). In the schema's default `desc` direction `compareTuple` answered `Infinity >= 0` at index 0,
  so the walk RESTARTED at the top and re-delivered every row the client already held under a
  `nextCursor: null` claiming it was over; in `asc` the same cursor answered an empty terminal page. The
  forged page is distinguishable from the legitimate budget-exhausted one D-M5-16/17 allows, which carries
  a NON-NULL cursor. Screened beside the row-offset range, where the same rule already lived.
  **26d — a rewind landing inside one page refuses the page.** `thread/rewind` runs on `record.chain`
  while a scan holds `runScanExclusive`'s per-server chain, so the two do not serialize. Constructed: one
  reply carried `rowOffset: 50` from generation 1 beside `rowOffset: 950` from generation 2, at offsets
  computed against the first, and both of its published `readCursor`s were then refused by `thread/read`.
  Stamping the superseded generation makes the jumps fail safe; it never stopped the page. Both scans read
  through the same `readWindow`, so both re-check after every window and each has its own row. The refusal
  is `ERR.BUSY` and not `-32602`: the request's parameters were correct and a request with no cursor at
  all reaches it, and D-M5-14c's rule is that this family groups by what the caller does next — here,
  "search again". It is THROWN, so the outer catch discards the rows already gathered, which is D-M5-8's
  rule that a scan unable to answer honestly answers with an error rather than with part of a page.
  The check covers the LIVE authority only: recomputing the store half per window is a whole-transcript
  read on this reader (D-M5-25b measured it), and between two windows of one page the store-immutability
  assumption stands — what was wrong was trusting it at page BOUNDARIES after it had been broken, which
  is exactly where `g` now checks it.
  **26e (fix wave F, rev 12) — `epoch` was never a generation, and the "by construction" claim above was
  false for one path.** 26b's live stamp was `L<epoch>`, and an epoch is a per-record counter: it starts
  at 0, only ever increments IN PLACE, and `thread/close` deletes the record outright — so a later
  re-admission of the same session mints a fresh record back at 0 and a cursor minted before the close
  compares EQUAL to it. Constructed in three ordinary wire calls, which is a normal thing for an operator
  to do between two pages: `thread/search` → `thread/close` → `thread/start`, and the stale cursor was
  honoured against the new record and answered `{"data":[],"nextCursor":null}` — the terminal "no
  matches" D-M5-8 forbids — for a term the same instant's fresh walk found. The occurrences variant was
  sharper: two pages together reported three occurrences for a transcript holding two, with a
  `rowOffset`/`readCursor` addressing a generation that no longer existed. A *residual* rather than a
  regression (before 26b `thread/search` carried no generation at all), but 26b's sentence claimed the
  family was closed by construction, and for the live→close→live cycle it was not.
  The stamp is now `L<record.id>:<epoch>`. `record.id` is minted per record (`Registry.mint`, six random
  bytes), so it cannot repeat across a recreation, and it is stable across everything that must NOT
  invalidate a walk: a rewind keeps the record and moves the epoch, an append moves neither. Rejected:
  **folding the store's mtime/size into the LIVE stamp** — it closes the same hole, and it imports the
  cold half's over-refusal into the half that has an alternative, so every page of a walk over an
  actively-appending live session would refuse; and **a new `birth` field on `ThreadRecord`** — the id
  already is one, and a required field would touch every record literal for nothing.
  **Adjacent and deliberately NOT changed here:** `thread/read`'s pager cursor is `"<epoch>:<row>"`
  (D-M5-7) and has the same reset-on-recreation property. It is a PUBLISHED string format, parsed in
  `subscribe.ts`, asserted literally across several test files and stated in the scorecard, so changing
  it is a wire change on a shipped surface rather than a corrective fix — the wrong thing to do in a pass
  whose job is to close a regression. Recorded so the next owner of that cursor inherits the finding.
  **Compatibility: a cursor minted by an older build fails the shape check and refuses `-32602`.** No
  shim, per the house rule and because the refusal is correct on its own terms — such a cursor names a
  walk whose bindings this server cannot verify. Rejected: signing the cursor (it is not a capability, and
  a client that forges one reaches only sessions its token already entitles it to); folding `q` and `g`
  into one opaque stamp (two causes with two client remedies deserve two sentences); and refusing every
  continuation for a session held by another host (honest, but it deletes paging for fleet threads
  outright, where the metadata stamp refuses exactly when the file moved and permits when it did not).
- **D-M5-27 (fix wave E, rev 11) — a published capability that changes is announced, and a replay
  exception is declared per ROUTE.** `thread/capabilities/read` serves `terminalSlashCommands`, and a
  client reads capabilities once, at thread start — the natural moment, and before the first init frame on
  either origin. Three transitions of that field produced ZERO frames on the wire while the neighbouring
  `commands_changed` route fired for its own, so the client was never told to look again and its answer
  stayed whatever it was when it asked. The announcement is the push this surface already has —
  `thread/capabilities/changed`, a ping carrying no payload — so a client that handles the neighbour
  handles this with no new code, and no schema moves. It fires **on change**, not on every init frame:
  init recurs per turn, and announcing each would put a capability push on the wire per turn saying
  nothing changed. The first latch IS a change, which is the transition the fleet origin depends on.
  **The fleet half was worse and is the more interesting half.** `installRouter` dropped every
  replay-marked frame (M3 Task 7), for a reason that holds of the routes it was written about: a mirror
  the attach has already seeded from live truth must not be overwritten with buffered history. It does not
  hold of a route whose subject has no other source — `terminal_slash_commands` rides the init frame
  alone, nothing else seeds it, so the field was simply ABSENT after every fleet attach until the host's
  next turn, and for an idle host indefinitely. The exception is therefore declared **per route** rather
  than per frame: `ROUTES` became `{run, onReplay?}`, one route sets the flag, and the other nine keep the
  old rule with their own test still measuring it. The burst is ordered and the latch is last-wins, so the
  newest replayed init stands and the host's next live init overwrites it. Rejected: routing every
  replayed frame (it reintroduces exactly the historical-mirror-write M3 Task 7 removed); and a
  once-per-thread latch (it would freeze a stale list across the per-turn re-emission).

## Surprises & Discoveries

- **The external review overturned five rev-1 mechanisms before a line was written** — origins
  granularity (upstream deep-merges; single-winner attribution was untruthful), the version check
  (TOCTOU), the write jail (self-authorizing, and its cited `fs/read` precedent did not exist —
  `workspace.ts` deliberately accepts client roots), the search walk (couldn't serve its own
  advertised sorts), and the archive sidecar (RMW lost updates). Every one was verified against
  cited code before being accepted. Adversarial review *of the spec* is cheapest exactly here.
- **Probe 110 (2026-08-18): the messaging fabric is visible but closed to us.** ListAgents from a
  bare SDK session returned the user's real fleet — 20 sessions with live busy/idle status,
  including the session running the probe's author. SendMessage is name-addressed (a raw session id
  earns "No agent named … is reachable") and loads as a *deferred* tool via ToolSearch. But neither
  probe session appeared in any roster, capabilities carried no `queued_notifications`, and the
  marker never arrived: SDK sessions can look, cannot be spoken to. The 0.3.234
  `fromMode`/`crossSessionInbound`/peer-origin declarations are the receive vocabulary — declared,
  and now measured as not reachable headless *for bare SDK sessions*; a host can implement them.
- **The 0.3.234 name-level scan hid the real delta.** Four drift surfaces reported +2 exports; the
  full-text diff carried removals (`get_plan`, `get_workspace_diff`, `bypass_permissions_disabled` —
  zero consumers, free) and a semantic inversion (dialog kinds: declare-and-never-answer-undeclared)
  our passthrough already modeled. Body diffs stay part of the ritual.
- **A 97-character worktree cwd broke a TUI test the SDK was blamed for.** The `/permissions`
  Workspace tab truncates path rows at ink-testing-library's fixed 100 columns; the control run
  (old SDK, same cwd) exonerated the bump in one measurement. Fixed to prefix-match (`2a2c176c31`).
- **`cc-codex-appserver`'s config/read test had been stale-red invisibly** — it pinned
  `claude-opus-4-8` while cc-harness's `DEFAULTS.model` moved on; a package outside the routine
  gates only gets re-measured when something forces it (`441c692b36`).

- **Task 1: the origins reset loop is load-bearing, and analytic reasoning said otherwise.** The
  implementer ran an honest sabotage check — commented the `origins.delete` loop out of
  `mergeTracked`, suite stayed 5/5 green — and concluded from it that the loop was redundant with
  `effectiveView`'s final re-walk, because "a replacement always re-descends from an empty target."
  That reasoning quantifies over paths *under* a replacement and misses the one *at* it. Review's
  counterexample, run rather than argued: layers user `{a:{b:["X"]}}`, local `{a:"flat"}`, managed
  `{a:{b:["Y"]}}` yield `origins {"a.b":["managed"]}` with the loop and
  `{"a.b":["managed"], "a":"local"}` without it — the re-walk's only guard is `v === undefined`, and
  after the third layer `a` resolves to a defined *object*, so it cannot drop the stale scalar-era
  entry. The code was right; the record and the test suite were not. A sixth test now pins it, and
  it is sabotage-proven (guard disabled → that test alone fails, 1 of 6). **The general lesson: a
  correct implementation with an incorrect explanation outlives a bug**, because the next
  simplification pass reads the explanation, deletes the line, and stays green. A guard is only
  defended when disabling it turns something red.

- **Two agents contradicted each other about a concurrency hole; the lockfile's own location settled
  it.** Task 4's implementer reported that `resolveRealTarget` returns the literal path for a file that
  does not exist and the canonicalized path once it does, and concluded that mutual exclusion is lost at
  first creation — two spellings of one not-yet-existing file taking two different locks and both
  creating it. Task 3's reviewer had measured the opposite. Rather than reason it out, the tiebreak was
  constructed: four spelling-divergence variants plus controls, driven through the real primitives and
  again end-to-end through the wire. **Task 3's reviewer was right, and the missing piece was where the
  lock lives.** `<file>.lock` is a *sibling of the target*, so when two spellings differ through a
  symlinked ancestor, both lock paths inherit that same symlink and land on one inode — the in-process
  `chains` map does take two entries, but the on-disk lock still serializes, observed concurrency 1, no
  lost update. When the settings file itself is the symlink, `resolveRealTarget` already collapses the
  spellings, dangling links included. The worst case of the divergence is that a loser polls every 25 ms
  instead of queueing in-process. The control run shows what the resolve-before-lock ordering genuinely
  buys: lock the *unresolved* path with a symlinked settings file and concurrency goes to 2 with a real
  lost update. The residual is hardlinks, which no resolution can collapse — but tmp+rename breaks a
  hardlink on first write anyway, so they were never inside this primitive's contract. **The general
  lesson: when two careful agents disagree about a concurrency property, the disagreement is a
  measurement request, not a debate — and the resolving fact was a detail of the design neither had
  stated (that the lock is a sibling, so it inherits every ancestor symlink the target does).**
- **Six mutations survived an entire test file, and one of them was the fix for a live wire bug.** Task
  4's reviewer wrote its own mutation set rather than re-running the implementer's, and found that
  reversing the batch apply order, correcting the masking scan direction, replacing `effectiveValue`
  with a constant, emptying the masking message, emptying the known-keys list, and dropping `managed`
  from the precedence tuple all left the suite green. The sharpest: a row *titled* "batch is ordered and
  atomic" asserts only atomicity — its batch refuses, so ordering never reaches disk, and the batches
  that succeed have non-interacting edits. Ordering does work; nothing measured it, and the spec's own
  acceptance criterion for it had no test. **A title is not a test, and a mutation set written by the
  same mind that wrote the code inherits its blind spots.**

- **Our own adapter-certification gate certifies the value that breaks sorting.** Task 6's review
  settled a reachability question by *building the exploit through the unmodified SDK*, and the path ran
  straight through this project's own quality instrument: `src/store/conformance.ts` asserts
  `typeof r.mtime === "number"` to certify a third-party session-store adapter, and `NaN` is a number. So
  an adapter whose timestamp column is occasionally NULL passes certification and emits a value that
  silently unorders every search result. The screen added in D-M5-15a fixes the *consumer*; **the gate
  that blessed the input is still blessing it**, and it is outside this milestone's scope — carried to the
  parking lot as its own item, since every future consumer of that store inherits the same trust.
  The general shape is one this project has now hit twice: an instrument that looks like it verifies a
  property while testing something weaker than the property (`a title is not a test`, and now
  `typeof x === "number"` is not `x is a usable number`).
- **A reviewer died mid-run and its findings were recovered by resuming it, not by re-running it.** Task
  6's review terminated on a spend limit having logged only *23 mutations run, 18 red, 5 green — three of
  those greens are real gaps*. Resuming the same agent by id recovered which three, at a fraction of the
  cost of a fresh review, and a replacement reviewer would have built a different mutation set and
  probably missed them. Worth remembering as a mechanic: a dead subagent's context is an asset until the
  session ends.

- **"No repair exists" is a claim about the search, not about the problem.** Task 7's implementer
  reported the case-fold offset drift as unfixable — every repair it could see either walked the row unit
  by unit or changed matching semantics — and that reasoning was about to be inherited by Task 8, where
  the same drift is a wire-contract violation rather than a cosmetic one. The reviewer did not argue with
  it; it **enumerated the domain**, found that exactly one code point in all of Unicode has the offending
  property, and that single fact collapsed the problem from "walk every row" to "compare two lengths".
  The repair was then built and measured rather than proposed. **The general shape: when a claim of
  impossibility rests on an unbounded worst case, bound it before believing it** — the honest report of
  "I could not find a repair" is not the same statement as "no repair exists", and this project has now
  seen the gap between them decide a wire contract.
- **Two "provably dead" branches were reachable, and the conclusions survived anyway.** Task 7 disclosed
  three surviving mutations with reasoning. Review instrumented one of them *firing* (a file exiting on a
  hit at the last budgeted row, a path the argument missed) and measured the other reporting a session
  **zero** times rather than the claimed once. Both conclusions held — keep the first, drop the second —
  but the recorded *reasons* were wrong, and a wrong reason is what a future refactorer inherits. Worth
  keeping distinct: disclosing a survivor is the good behaviour this project asks for; the reasoning
  attached to it still has to be checked like any other claim.

- **Testing one side of a symmetric guard tests half a guard — three times in one task.** Task 7 wrote a
  surrogate-trim guard for the leading snippet edge and pinned it; the identical trailing guard shipped
  undefended, and removing it published a range pointing past its own string. That was fixed. Then the
  outward-edge convention arrived with the *end* case pinned (`hi` against `Hİ`) and the *start* case
  undefended — and the surviving mutation drops an original character that matched, on five constructed
  inputs. Same shape, same task, third occurrence. **The rule that generalises: a mechanism with two
  symmetric sides needs one row per side, and the second row is the one that gets forgotten** — because
  the first one felt like it covered the idea. Written into the code beside the convention so the next
  person extending it writes both.
- **437 failures that were the reviewer's oracle, not the code.** Task 7's fix-wave reviewer swept the
  outward-edge convention over 24.8 million input pairs and its first run reported 437 violations. They
  were all artefacts of its own checker: it re-lowercased the extracted slice and required the lowered
  term inside it, which is invalid because `Final_Sigma` is context-sensitive — a slice that drops the
  preceding cased letter lowercases its sigma to `σ` where the full row produced `ς`. It rebuilt the
  oracle to map the span's ends *forward* into the lowered row, re-ran, and triaged all 437: every one
  involves sigma, none is a real violation, and all remain correct. It reported the whole sequence rather
  than only the clean second number, noting that a reviewer who stopped at the first would have filed a
  false Critical. **Two things worth keeping: an oracle is code and needs its own scepticism, and the
  verified sweep — 102 811 real matches, zero invariant violations, every span not merely outward but
  tight — was only trustworthy because the false alarm was chased to its cause rather than tuned away.**
- **A validator in this codebase is also a published contract.** A `z.string().min(1)` on a cursor
  parameter looked like redundant belt-and-braces, since the empty string already refuses at the decoder,
  and review filed it as removable. The implementer kept it for a reason review had missed and then
  endorsed: the refinement emits `minLength: 1` into the vendored stable JSON schema, so deleting it would
  **silently shrink the client-facing contract** while every test stayed green and the schema-freshness
  gate stayed happy — because that gate compares the artifact against a fresh generation of the *changed*
  source. **Generalised: "redundant for enforcement" is never sufficient grounds to delete a zod
  refinement here, because enforcement is only half of what it does.**

- **An oracle built from the contract found what an oracle built from the code could not.** Task 8's
  shipped generated sweep and the reviewer's sweep test the same property; only one could have found the
  residual. The reviewer derived its expectation from the *published* rule (floor the start, ceil the end,
  measured through prefix lowered-lengths) rather than from the implementation, and then widened the inputs
  along three axes the shipped sweep had closed off: **uppercase and mixed-case terms** (the shipped sweep
  filters them out entirely — and they are the only inputs where the term-length residual is visible at
  all), **rows long enough that the 200-unit snippet window actually clips** (the shipped sweep's rows are
  short enough that the snippet simply *is* the row, so the window arithmetic never runs), and an alphabet
  extended with the genuinely hostile code points. 488 occurrences over 320 rows, all correct — and the
  sweep is trustworthy because it goes red under three separate range mutations. **The generalisation: a
  self-written sweep tends to generate the inputs the implementation already handles, because the same
  mental model produced both.** Ask of any passing sweep which inputs it *cannot* produce.
- **A guard whose failure mode is the mirror of the bug it fixed.** Task 8's sabotage driver produced a
  false green (a syntax-error mutation collected zero tests, and "no failed assertions" read as a passing
  guard), so a collection-count guard was added. But when that guard fires it records `RUN ERROR (likely a
  compile break — still a red)` — counting a run that proves nothing as *defended*. The same error,
  pointing the other way. No reported row took that path, so the evidence stood; the mechanism did not.
  **Worth generalising: a guard added in response to a false pass needs its own answer to "what does this
  do when it fires", or it just relocates the false pass.**
- **Mutation evidence rots when the code under it is fixed mid-task.** One row of Task 8's sabotage table
  (S7) was measured against a `readCursor` spelling that was replaced later in the same task by the
  one-epoch-read fix; re-run afterwards, the driver reports `ANCHOR NOT UNIQUE (count=0) — mutation not
  applied`, so the recorded RED count was never re-taken. The claim turned out true when re-spelled against
  the shipped line, but the table asserted it on evidence that had expired. **A sabotage table is a
  measurement against a specific tree, and any fix that lands after it invalidates the rows whose anchors
  it touched** — re-run the driver after the last fix, not before it.

- **"The default store cannot produce it" is not "the method cannot receive it" — twice now.** Task 8's
  review raised `uuid: ""` as a possible third state on a field documented as nullable-string. The fix wave
  went looking for it through the real persistence path and found the state genuinely unreachable there:
  the SDK reader admits a row only when its uuid is a string and copies it verbatim, the only mint is
  `crypto.randomUUID`, and a scan of **10 584 real transcripts across 1 114 projects found zero**. It
  correctly changed nothing — an unreachable state does not earn code, and a guard pinned by a fixture the
  store cannot produce is green for the wrong reason.
  The reviewer then narrowed the *claim* without disturbing the verdict: unreachable is a property of the
  **default store**, not of the **method**, because the dependency interface is exported public API and is
  exactly the seam the test suite injects through — so an embedder can hand the handler an empty uuid, and
  the argument as stated proved something slightly smaller than it sounded.
  **This is the same shape as Task 6's `NaN` finding**, where our own adapter-conformance gate certified an
  unusable timestamp: in both cases the reasoning ran "the code we ship cannot produce this value", while
  the injection seam that makes the code testable is also a published extension point. **Generalised: when
  a reachability argument bottoms out at "our implementation never writes that", check whether the value
  can arrive through a dependency the API invites callers to replace.**
  The verdict stood on better ground: an empty string satisfies the published nullable-string contract, no
  client contract distinguishes it, and the item mapper already mints `""` as the id of a row with no
  uuid — so that meaning is this codebase's existing convention rather than a new ambiguity. Worth keeping
  as the pattern: a conclusion can survive its own argument being corrected, and saying so is cheaper than
  either defending the bad argument or reversing a sound call.

- **A scope deferral is a claim, and it needs the same construction a defect claim needs.** Task 9 shipped
  with a disclosed scope note: resume-carrying `thread/start` is not auto-unarchived, because the session
  id "is inside an opaque config the server does not parse" and covering it "means hooking the init latch,
  which is a different mechanism". Both halves were false and both were cheaply checkable —
  `threadStartParams.config` is `z.record(z.string(), z.unknown())`, which the server parses and spreads
  into the engine config, so the id is readable at admission; and the review's repair was **three lines**
  with no latch hook, measured at 1 005 passing with only its own probe rows red, i.e. nothing in the
  shipped suite depended on the old behaviour.
  Disclosing the gap was the right instinct and is the behaviour this project asks for — the failure was
  attaching a *reason* that had not been tested. **This is D-M5-17a's lesson arriving from the opposite
  direction:** there, "no repair exists" was refuted by bounding the domain; here, "no repair exists
  without a different mechanism" was refuted by reading one type. Generalised: **an impossibility claim
  earns its place only when the search behind it is described and reproducible — and a claim that some
  value is unavailable is refuted or confirmed by looking at the type, which costs a minute.**
  What made it expensive rather than academic: the resulting state was already client-observable through a
  **shipped** method (`thread/search`'s archived partition, Task 7, reads the same markers), and the
  reverse direction was worse than the forward one — because `record.sessionId` latches only at the first
  turn, `thread/archive` succeeded on an already-live conversation and left a permanent marker, over a
  window lasting from `thread/start` until the client's first turn. **A second lesson rides on that: when a
  guard keys on a field that is populated late, the gap is not a race — it is a documented interval, and it
  should be reasoned about as a state rather than as a timing accident.**
- **Two published claims were falsified by the same defect, and one of them was a contract.** The commit
  asserted in a code comment that "'Archived AND live' is never a state a client can observe, in either
  arrival order", and the scorecard row — a client-facing artifact — said the same. Both were written from
  the design's intent rather than from the shipped behaviour, and both were wrong for the whole window
  above. **Worth keeping: prose that states an invariant is an assertion with no test behind it. When the
  invariant is load-bearing, the sentence and the row that pins it should land in the same change.**

- **Task 12 (2026-08-19): both absorb probes came back ALIVE, and the seam step changed what "alive"
  is worth.** Probe 112 measured `terminal_slash_commands: ["doctor","color"]` on a headless init frame
  (CLI 2.1.234, 98 `slash_commands`); probe 111 measured the `context_usage` structured twin on the
  **`assistant`** frame of a `/context` turn — a wrapper-level key, with `message.context_usage` absent,
  exactly as the SDK doc promises. Neither result would have decided anything on its own, because
  "the SDK emits it" and "our router receives it" are different claims. **Both were made measurable
  without spinning up a fleet host**, because the ccx host's follower relay is fed by exactly one
  object: the per-turn `onMessage` sink it hands to `Session.submit` (host.ts's `runTask`), re-emitted
  as `{kind:"message"}`. Subscribing `onFrame` and `onMessage` on the same real `Session` therefore
  measures both origin legs from one turn. Both carriers reached both feeds, so both surfaces are
  ALIVE on both origins rather than inProcess-only. **The generalisable move: when a second origin is
  expensive to stand up, find the ONE object its producer reads and subscribe that instead of the
  origin.**
- **The `result` frame would have been a DEAD-for-us answer, and only "which message" could tell us.**
  `session.ts`'s read loop resolves `result` frames into the submit waiter and never forwards them to
  `onMessage` (host.ts says so in its own comment; P106 measured 88 relayed message frames, zero of them
  results). Had `context_usage` ridden the result frame — the plausible place for an end-of-turn
  summary — the field would have been reachable in-process and invisible to every fleet follower. The
  brief's insistence on recording **which message** carries a field, not merely that one does, is what
  separates those two outcomes.
- **`terminal_slash_commands` has exactly one possible source, and `routeInit` cannot be it.**
  `thread/capabilities/read` answers from `supportedCommands()`, whose `SlashCommand` type carries no
  terminal-bound marker — so the init frame is the only place the classification exists, and a latch is
  mandatory rather than an optimisation. Two measured facts make that latch safe: init is **re-emitted
  per turn** (two turns produced two init frames on both feeds), so a fleet thread is not condemned to a
  replay-marked follow burst the router drops; and `routeInit` early-returns on `record.sessionId`,
  which fleet threads latch from the host `state` event instead (fleet.ts) — so a new field must ride
  its own route, never inside that guarded body.
- **An ALIVE field is not automatically a gap worth filling.** `thread/contextUsage/read` already
  serves `getContextUsage()`, whose control response is **richer** than the structured twin
  (`gridRows`, `systemTools`, `systemPromptSections`, `slashCommands`) and costs no turn. What
  `SDKContextUsage` adds is `over_limit` and a semantic `kind` per category (used/free/buffer/deferred)
  where the control response has a renderer's `color`/`isDeferred`. So the spec's own promote sentence —
  "the structured card into the context-usage surface" — would, taken literally, replace a better
  payload with a worse one obtainable only by spending a turn.
- **Two undeclared live surfaces, found for free because the probe logged every message type.**
  `command_lifecycle` frames (two per `/context` turn through the harness `Session`) appear in **no**
  0.3.234 type: absent from `SDKMessage`'s union and from every `sdk.d.ts` mention, and absent from
  `harness/src`. Its likely partner is the `msg_lifecycle_v1` capability, which the init frame
  advertises while the `capabilities` doc comment enumerates only three other values. Nothing breaks —
  our routers compare `type` on `unknown` frames — but the name-level drift scan cannot see either.
  `rate_limit_event`, by contrast, is fully covered (`SDKRateLimitEvent` is in the union; `classify.ts`
  and `router.ts`'s `routeLimits` both consume it) and appeared in one of the two live streams,
  confirming it is intermittent rather than absent.

- **An undeclared frame type the name-level drift scan is structurally unable to see.** While logging
  every message on the `/context` path, Task 12 caught **`command_lifecycle`** — two frames per turn,
  appearing in **no** 0.3.234 declaration and nowhere in `harness/src`. Its likely partner is the
  `msg_lifecycle_v1` capability the init frame advertises but the capabilities doc comment does not list.
  Nothing breaks today. What matters is the class: our drift instrument compares **names it can enumerate
  from declarations** on both sides, so a frame the SDK emits but never declares is invisible to it by
  construction — the instrument cannot report what it has no name for. (By contrast `rate_limit_event`,
  which the same logging caught and which prompted the check, turned out **fully covered**: it is in the
  SDK's `SDKMessage` union and consumed by both `limits/classify.ts` and the router's `routeLimits`; it is
  intermittent, not absent.) **Generalised: a name-level drift check bounds the declared surface, not the
  emitted one, and the gap between them is only visible by logging a live stream and reading what arrives.**
  Parked with its trigger: a client depending on lifecycle framing, or any 0.3.235+ bump where
  `msg_lifecycle_v1` moves from advertised to documented.
- **The plan was right where the spec was wrong, on the same decision.** The spec said the structured
  context card goes "into the context-usage surface"; the plan said forward it on the turn's existing
  emission with no retention. The second is additive and the first is destructive, and only the plan's
  version survived contact with what the code already offers. Worth keeping because the usual direction of
  drift is the opposite — plans go stale against specs — and this milestone has now seen both directions
  inside one document set. **The check that caught it was not comparing the two documents; it was reading
  the code the sentence would have changed.**

- **Task 13 (2026-08-19): the trap the spike named was real, and a SECOND one of the same shape was
  waiting one function away.** The first is on the record: `terminal_slash_commands` had to be latched by
  its own frame route, because `routeInit` early-returns on `record.sessionId` and a fleet thread has that
  id before its first init frame arrives. The second was not, and nothing in the brief could have named it
  — `fleet.ts` snapshots each item event BEFORE handing it to `emitItems`, and `snapshot()` rebuilds the
  event field by field, so a `contextUsage` it did not explicitly carry through would have been dropped
  from the fleet WIRE, where the in-process wire still carries the live event. **Generalised: an
  origin-asymmetry warning is about a CLASS of code, not about the one function that taught it. Once a
  milestone knows one origin can be silently starved, every field-by-field rebuild on the path to that
  origin is a suspect, and the way to find them is to follow the field to the wire on both origins rather
  than to re-read the function you were warned about.**
  **Corrected by the Task 13 review (F2), against a measurement printed in the same commit.** The first
  draft of this entry said `snapshot()` is fleet-only — that "the in-process path never calls `snapshot`
  before emitting, so every in-process test would have stayed green", and that reverting the carry-through
  turns "only the two fleet rows" red. Both are false. `turns.ts`'s `pushBounded` snapshots every event
  into the replay buffer on BOTH origins, so the sabotage row fails **three** rows spanning both — the two
  fleet ones and the in-process mid-turn-replay row — which is exactly what the table in the same report
  recorded. What the origins genuinely differ in is what a forgotten field costs: in-process only REPLAY is
  starved, on the fleet path the live wire is too. The one-`Session` mimicry the controller specified would
  therefore NOT have missed this trap — any suite carrying a mid-turn-replay row catches a snapshot-drop
  in-process, and that row long predates this task. The deviation to the fake host stands on its own
  merits (below); it never needed this reason, and a recorded reason that contradicts its own commit's
  measurement is what a later milestone inherits.
- **The absorb work's own test rule earned its keep in a way it was not written for.** The rule was
  "inject the field through the same frame path the probe observed", written against a fake that hands the
  handler a pre-stamped record. Its real yield was different: driving the FLEET leg through the fake host's
  real socket exercises the real UDS, the real `FleetEngine` frame fan and real replay marking, which is
  what makes a genuine fleet-**wire** row possible at all — same-object mimicry asserts the mapper's output,
  not what the wire carried. That is why the carry-through is defended on the wire and not only in a
  buffer. A test written against the seam fails on the seam's bugs; a test written against the handler
  fails on the ones its author already thought of.
- **Task 13 review (2026-08-20): a published contract can be wrong in the one direction no test will
  catch — against the producer's own declaration.** The task shipped `terminalSlashCommands` with three
  states, of which the engine can only produce two: `sdk.d.ts` declares `terminal_slash_commands` "present
  only when non-empty; absent on CLIs that predate the field, and on sessions where no advertised command
  carries the tag", so the engine reports "none" by OMISSION. The shipped schema told clients the reverse
  (`[]` means none, absent means no init yet), which made `[]` dead, made "none" indistinguishable from "no
  turn yet", and — because init recurs per turn — froze a once-latched list permanently, so a
  `thread/capabilities/changed` re-read would hand a client fresh `capabilities.commands` beside a stale
  list. Repaired by making **every init frame authoritative**: a key-less init writes `[]`, absence means
  only "no init frame has arrived". **Generalised: for a relayed field, the contract's authority is the
  producer's declaration, not our own reading of the one payload we happened to observe. A probe that saw
  the non-empty case cannot tell you what the empty case looks like, and a doc comment beside the type
  often can.** The engine-side half here is still a doc comment rather than a live run — the keyed
  acceptance is where a session with no terminal-bound command confirms it.

## Outcomes & Retrospective

### What shipped, against the purpose this spec opened with

The purpose was one sentence: *a client can read and write the user's durable configuration, and can
find and shelve conversations, over the same wire it drives them with.* All seven methods ship —
`config/read`, `config/value/write`, `config/batchWrite`, `thread/search`,
`thread/searchOccurrences`, `thread/archive`, `thread/unarchive` — plus two notifications, one
additive parameter on `thread/list`, and both 0.3.234 absorb surfaces. Closing numbers, all
controller-verified on the shipped tree: drift gate exit 0 at **66 registered methods / 99 scorecard
rows** (`shipped(M5) 9`), **228 unit files / 3131 tests**, **142 TUI files / 3546 tests**, typecheck
clean, `emit-schema` byte-identical from a fresh generation. **Keyed live acceptance 9/9 in 10.3 s**,
with **M4's acceptance re-run 7/7 in 122 s** as the regression check that this milestone's work left
the review domain alone.

Two things the milestone added that were not in the original shape. Every one of the seven methods
publishes its **response** schema beside its request one — D-M5-19 asked for it and D-M5-19a moved it
into a top-level `results` map, because a method entry is compiled directly by ajv in strict mode and
is therefore a schema, not a container. And the absorb task turned out to consume real SDK surface:
probes 111/112 came back alive on both origins, so the assistant frame's wrapper-level `context_usage`
and the init frame's `terminal_slash_commands` are both wired, and Task 11's written reasoning that
"M5 consumes no new SDK surface" had to be replaced in the coverage cell rather than left standing.

### The acceptance walk (Task 15), including what it found

Criteria 1-8 were walked against pinning tests, and each pin was re-verified by mutation rather than
by reading — one mutation per criterion, applied alone, sources restored and checksummed between
cells. Criteria 2-8 all die in named rows. **Criterion 1 was the exception and is worth recording**:
its contributor clause ("an array key contributed by two layers names both in precedence order") was
pinned only by a wire-level row in `config-domain.test.ts` that exists for masking, while the row
whose *title* claims it — `config-layers.test.ts`'s `effectiveView` row, written in Task 1 — planted
`permissions.allow` in user and `permissions.deny` in local, two arrays with **one contributor each**.
Collapsing the contributor list to "the last layer to touch this array" left that file 6/6 green. The
row now plants a `permissions.ask` array in both layers and dies under exactly that mutation. This is
rule 2 of this milestone's own lessons — *a title is not a test* — surviving in the one task that
predated the rule and was never revisited by any later reviewer.

### What is NOT proven

- **The key-less init branch is contract-derived, not observed.** D-M5-22 says an init frame that
  omits `terminal_slash_commands` is the engine reporting "none", and every init frame is
  authoritative — a rule taken from the SDK's own doc comment. Acceptance leg 6 recorded what a real
  engine actually sends: **3 `system/init` frames over 3 turns, the field present on 3/3, value
  `["doctor","color"]`.** So the re-emission fact the fleet origin depends on is now empirical, and
  the absent-key case **cannot be staged on this CLI** — `doctor` and `color` are CLI built-ins, the
  thread already runs `settingSources: []`, and no wire parameter removes a built-in. The unit suite
  pins the branch against a synthetic frame; nothing has watched a real engine produce one.
- **Multi-process lock contention was never exercised.** The CAS lockfile is proven under in-process
  concurrency and against planted foreign lockfiles; two real `ccx` servers writing one settings file
  at once is untested. The measured behaviour under a foreign lock is documented rather than
  re-architected: the write usually does not error, it blocks ~30 s, breaks the stale lock and returns
  `ok`.
- **The win32 arms never ran on Windows.** `defaultManagedPath`'s win32 arm is behind a seam and
  covered by a test that dies when inverted; the managed layer's omission there, and `fleetRoot()`'s
  `HOME`-over-`USERPROFILE` preference, are argued rather than measured.
- **Parked, with named triggers rather than good intentions:** the store-adapter conformance gate
  (`src/store/conformance.ts`) certifies `NaN` as a valid `mtime`, which is the door the search
  comparator's `Number.isFinite` screen had to be built against; `KNOWN_TOP_LEVEL` is 87
  hand-transcribed upstream keys with nothing detecting their drift (the house-consistent fix is
  extending `scripts/drift-check.mjs`, which already exists for exactly this rot); `mergeTracked`
  gives an empty-object node no origin, measured from outside as the sweep's `undecided` count;
  `thread/list`'s bare offset cursor still carries the skip/repeat class `thread/search` solved with a
  keyset (D-M5-16), now reachable because archiving is a first-party mutator between pages, and
  closing it is a wire change to a shipped method; intra-batch shadowing is only half-reported, and
  `overriddenMetadata` describes one masked edit rather than all of them.
- **Declined by fix wave F (rev 12), each with its reason — the review's minors that were NOT fixed.**
  Every confirmed finding got a decision; these are the ones that went the other way, recorded here so a
  reader finds a decision rather than an omission.
  - *The store audit's mid-request TOCTOU* (the code residual behind the corrected scorecard sentence):
    the audit runs once at the top of the exclusive section, so a transcript failing between it and
    `getSessionMessages` is swallowed on the production origin. Re-verifying per transcript costs a
    whole-store walk per window on this reader (D-M5-25b measured the reader); the window needs a writer
    racing this reader and self-heals on the next request. Corrected in the claim, not in the code.
  - *The audit is whole-store, runs per PAGE as well as per request, and one unreadable transcript refuses
    search for every thread.* Both are consequences of refusing to reproduce the SDK's cwd-to-project
    mapping (25a), which is the safer side of an internal we cannot watch change. Caching the audit across
    pages would trade a real property — a store that becomes unreadable mid-walk is caught at the next page
    — for ~125 ms on a 4643-transcript store. The sharpest instance is `thread/searchOccurrences`, which
    touches ONE transcript and pays the full walk: recorded on its scorecard row rather than special-cased,
    because a per-method audit scope is exactly the drift the one predicate exists to prevent.
  - *`generationOf` degrades for a bring-your-own `SessionStore`*: `fileSize` is populated only for local
    JSONL, so an adapter store reduces the cold stamp to a bare millisecond timestamp and a same-size,
    same-millisecond rewrite collides. There is nothing else in `SDKSessionInfo` to fold in, and mint and
    resume are a network round trip apart, so the collision needs a sub-millisecond rewrite between two
    pages. A bounded property of the adapter contract, not a reachable defect.
  - *The TUI still writes user settings and keybindings to `homedir()/.claude`*, ignoring
    `CLAUDE_CONFIG_DIR` — the same class as D-M5-23a on a different surface. Not a one-line fix, and the
    reason is specific: `useChat`'s `deps.home` is a DISPLAY home (it feeds `displayPath`'s and
    `toolFold`'s `~`-shortening) and is passed explicitly on the production path, so pointing these two
    files at `claudeConfigDir()` either changes nothing or silently redirects every test that injects
    `home` to avoid the operator's real `~/.claude`. The correct fix is a second seam — a `configDir`
    threaded through `useChat`'s deps, `chatMain`, `settingsFile` and `userBindings` with their tests — and
    that is a contract change with an owner, not a corrective repair.
  - *Two roster-row residuals A1 does not cover.* A `--continue` launch leaves the row unnamed while the
    host holds a conversation, and it is unfixable at `start()` because no id exists there yet — the id is
    the store's answer to "most recent", learned later. And the common foreground shape, `ccx --resume X`,
    strips `resume` out of the host config on its way to the client (`main.ts`: launch resume goes to the
    CLIENT, one resume code path), so A1's `start()` seed never fires and the row is stamped by the resume
    path after the transcript read. Both are the boot-window class D-M5-21c already accepts; wave A's
    commit message overstated the foreground case as fixed from the launch, and it is fixed from mount.
- **Cross-process archive state is transient by construction, not prevented** — criterion 7 was
  amended (rev 5) to say so rather than keep a claim the design had already narrowed away.
- **Domain 10 held at ~76%.** Two optional fields on messages this table has consumed since M1 are
  real capability and still do not reach a percentage point. That is the honest reading, not a
  rounding dodge, and it is written into the cell that way.

### Lessons

1. **A title is not a test.** Four separate instances: Task 4's row titled *"batch is ordered and
   atomic"* asserted only atomicity (its batch refused, so ordering never reached disk); the plan's
   own Task 6 row titled *"centered"* stayed green with centering destroyed; and Task 1's
   contributor-ordering row, found in the final walk above. The pattern is not carelessness — it is
   that a title records the author's *intent*, and intent is exactly what a test cannot check.
2. **A checker written by the author of the code inherits its blind spots.** Task 4's masking verdict
   took six independent reviews and six defects, every one found by *construction* — mutations,
   probes, generated sweeps — and none by reading. The wave's own 558-state sweep passed on the
   defective delete branch because it never planted the shape; the reviewer that found it was
   forbidden from reading that sweep and wrote its own generator.
3. **When a rule is restructured, every branch implementing it must be.** Task 4's value branch was
   rewritten to compute the verdict from the rule; the delete branch was left deciding from a search,
   and shipped one review later.
4. **A deferred Minor in an attribution layer is a latent defect in every consumer that reasons from
   it.** Task 1's M2 — *an empty object value gets no origin* — was recorded Minor and carried to
   triage. Two tasks later it was the root of a wire-visible High in `config/value/write`. Task 7
   then refused a second deferral on those exact grounds, and closed a known-wrong snippet length
   in-task rather than handing it to Task 8.
5. **"I could not find a repair" is not "no repair exists."** Task 7's report declared the
   lowercase-offset drift unrepairable without walking every row. The reviewer swept all of Unicode
   instead: **one expander (U+0130), zero shrinkers**, and the repair collapsed to comparing two
   lengths. Bound an unbounded worst case before believing it.
6. **An oracle is code and needs its own scepticism.** A reviewer's first adversarial sweep reported
   437 failures that were its own oracle — it had re-lowercased an extracted slice, and `Final_Sigma`
   is context-sensitive. All 437 involved sigma; chasing the false alarm to its cause rather than
   tuning it away is the only reason the clean number afterwards was worth anything.
7. **Testing one side of a symmetric guard tests half a guard.** Three occurrences inside Task 7
   alone. The second row is the one that gets forgotten, because the first felt like it covered the
   idea.
8. **A validator here is also a published contract.** `cursor: z.string().min(1)` looks redundant for
   enforcement and emits `minLength: 1` into the stable artifact — deleting it would silently shrink
   the client-facing contract with every test green and the freshness gate happy, because that gate
   compares against a fresh generation of the *changed* source.
9. **When a handler starts touching disk, its tests' fixed-tick waits become timing bets.** Task 10's
   `thread/list` began reading the marker directory per request, and every test waiting a single
   `setTimeout(0)` had been silently asserting *this handler performs no I/O*. The review closed the
   class rather than the instance, with a delaying `node:fs/promises` stand-in and a negative control.
10. **A sabotage red-count is a measurement against a tree AND a collected count**, and moves when the
    suite grows with the code untouched. Re-run the table as the last step before writing the report.
11. **A green suite does not mean a reviewable diff** — a test file containing a literal NUL byte
    passed every gate and reached the reviewer as an opaque binary blob.

### The corrections that were worth the most, and most of them were to my own instructions

This is the part a retrospective is tempted to leave out. The highest-value outputs of this milestone
were places where a worker refused an instruction and was right:

- **Task 2's fixer overruled a spread I specified** (`{...doc.methods, ...doc.results}`), which would
  have silently dropped `config/read`'s *request* schema from the sweep — the very coverage the
  widening existed to add.
- **Task 3's brief contradicted itself** — D-M5-18a amended the interface text and left the code block
  below it unamended. Following the code would have surfaced an unreadable settings file at the wire
  as an internal error. My defect, from amending one half.
- **Task 4's masking scan direction was wrong in the brief's own normative code**, and a plan
  instruction would have silently reverted D-M5-18a one task after it landed, with every test green.
- **D-M5-13c's ruling that the `mergeTracked` gap cost only the *name* was false for deletes** — it
  was costing the *verdict*. Corrected at D-M5-13d by making the delete verdict a counterfactual over
  merges, which removes the dependency entirely.
- **Task 11: measurement beat three agreeing sources, one of which was me.** The plan brief, this
  spec's own cross-cutting bullet, and my dispatch all said the notification *recipe* goes 27 → 29.
  Applying it literally would have broken the recipe's arithmetic. The implementer refused to write
  either number down until it had resolved which was right.
- **Task 13 found a false justification that had propagated into four places including a test title**
  — the claim that only the fleet path calls `snapshot()` between mapper and wire. It also showed the
  technique I had specified would *not* have missed the trap I said it would.

Process notes worth keeping. Every task ran implement → independent review → fix wave → re-review, and
**eight of the fourteen had a reviewer-found defect the implementer's own sabotage pass missed**. One
reviewer hit a monthly spend limit mid-run; resuming that same agent by id recovered its 23-mutation
context instead of paying for it twice, and its resumed pass produced the milestone's only Critical
reachability proof (a bring-your-own store adapter that passes our own conformance gate while emitting
`NaN`). Scratch copies must live outside `~/.claude` — one reviewer's TUI failure was its own scratch
directory changing a permission dialog's offered rule row, not the known flake.

## Revision Notes

- 2026-08-18 rev 1: initial design. Grounded by direct reads of Codex v2 `config.rs`/`thread.rs`
  (in-repo), the 0.3.234 bump + full-text sdk.d.ts diff, `SDKSessionInfo` (no archived field), the
  existing `thread/delete` handler (id resolution + live-guard precedent), and probe 110. Four forks
  resolved by the owner in one round: layer targets (all three, default user), no hot reload,
  sidecar archive state, roadmap shape as proposed.
- 2026-08-18 rev 2: external adversarial review (Codex `gpt-5.6-sol`, xhigh; 8 high / 3 medium
  findings) — all highs accepted after code verification and folded in: upstream-exact merge +
  leaf/contributor origins (F1), explicit keyPath grammar via array segments + merge table + atomic
  batches (F2, → D-M5-12/13), lock-held CAS (F3, → D-M5-14), the jail reframed as structural
  fencing with the security claim withdrawn (F4, → D-M5-4), global keyset ordering (F5, → D-M5-15),
  intra-file cursor resume killing permanent false negatives (F6, → D-M5-16), the server-composed
  inclusive `readCursor` jump contract (F7, → D-M5-7), and marker-file archive state + converging
  live-guard (F8, → D-M5-3/10). Mediums: scan bounds specified (F9, → D-M5-17); wire contradictions
  resolved (F10 — Codex sort tokens, `snippetMatchRange`, `{ok:true}`, `ConfigLayerReadonly`
  dropped as unreachable, `warnings` field added); the milestone-split recommendation adopted as
  **plan staging** rather than spec division (F11 — the SDD flow reviews per-stage; scope stays as
  the owner approved).   Acceptance rewritten to carry the race, continuation, sibling-preservation,
  and jump-consumability tests the review demanded.
- 2026-08-18 rev 3: the PLAN adversarial review (13 high / 7 medium) re-read these contracts against
  the real code and six were under-specified; all folded in after verification: `config/read` gains
  the `versions` CAS-token map (D-M5-18) plus BOM/blank parse fidelity, win32 managed-layer omission,
  and the recorded SettingsSchema non-mirroring deviation; array dedupe is SameValueZero (objects
  never dedupe — lodash `uniq`, not structural), with origins tracked through the merge and reset on
  replacement; keyPath refuses the three prototype segments; batch masking evaluates every edit; the
  lockfile is nonce-owned with the external-editor narrowing stated, parent-dir creation and symlink
  resolution defined, and cwd canonicalized before the lock; the search cursor gets ONE tuple-resume
  convention and storage-windowed reads, the row cap is renamed to UTF-16 units, snippet ≤ max(200,
  term); occurrence cursors are epoch-qualified live with cold semantics stated, and cold targets
  must exist (D-M5-20); archive checks resume reservations, admission auto-unarchives (D-M5-21);
  result schemas ship for the seven methods (D-M5-19); the three disk-backed methods join
  ENGINE_GONE_EXEMPT; every plan stage leaves the drift gate green. Also fixed at plan level: the
  unit-test harness must use the real conn.feed + initialize pattern (dispatch is private,
  four-arg), and the absorb task must name its producer seam before wiring anything.

- **rev 4 (2026-08-18) — amended DURING execution, from what implementation and review measured.**
  Everything here was generated by contact with running code, not by re-reading the spec. D-M5-19a: the
  emitted result schema moved out of each method entry into a top-level `results` map, because a method
  entry is compiled directly by ajv in strict mode and is therefore a schema, not a container. D-M5-18a:
  the version map grew a third token, `"unreadable"`, because `"absent"` was being minted for a file
  that exists but cannot be read — a distinction that lives at exactly one point in the system and was
  being destroyed there; the write side refuses it as an assertion and refuses any non-ENOENT read.
  D-M5-12a: the `__proto__`/`constructor`/`prototype` refusal extends to keys inside written values,
  and the never-implemented null-prototype-dictionary clause is narrowed away rather than left
  describing an intent the code never had. D-M5-14a: three write-path failures the CAS design did not
  cover — an unbreakable stale lock spinning forever with no deadline, tmp+rename widening a 0600
  settings file to 0644, and blank files plus dangling symlinks being permanent dead ends. Two plan
  defects were also caught and fixed before they could land: Task 3's instruction to collapse the
  versions walk (it would have silently reverted D-M5-18a one task after it shipped, with every test
  still green), and a `readTargetDoc` code block that contradicted its own amended interface text.

- **rev 5 (2026-08-19) — acceptance criterion 7 amended to the scope the decisions actually took on**
  (Task 10 review ⚠️A1; no behaviour changed). The sentence said "nothing live ever hidden", which was
  written before D-M5-3 settled archived-ness as markers re-read per request and D-M5-10 rev 3 narrowed
  its convergence claim to transitions *this server mediates*. The `thread/archive` scorecard row and
  D-M5-10 already said so; the acceptance sentence never absorbed it, and `thread/list {archived}` made
  the gap literal — a marker another PROCESS writes for a thread live here puts that thread in the
  archived half, and Task 10 tests exactly that placement. Criterion 7 now states the mediated scope and
  says in one clause why the cross-process case is excluded: markers are re-read per request rather than
  guarded in-process, so that state is transient and self-correcting rather than prevented. The same
  review's ⚠️A2 added a parking-lot item for `thread/list`'s bare offset cursor (skip/repeat across a
  paged walk that archives) and corrected `cursorParam`'s docblock, whose justification named a
  session's lifetime where the property is really the array's stability.

- **rev 7 (2026-08-20) — D-M5-21d, the fix wave that followed the whole-branch reviews.** Two
  independent reviews converged on a path that erases user data: `thread/delete`'s cross-process
  live-guard read a roster field the host wrote only once per turn, so a terminal idling after
  `ccx --resume <id>` had a row that did not name the conversation it held and the transcript was
  erased on request — the same staleness inverted making an unheld conversation undeletable. The
  repair is upstream of the guard (the host maintains the field at launch, at every engine swap, and
  at the first init frame), which is what keeps the three handlers D-M5-21a unified answering
  identically. The same wave gave the admission rule its fourth member: a fleet host swapping its own
  conversation is an admission this server watches rather than performs, and without the shared
  `autoUnarchive` it left a LIVE thread permanently on the archived shelf. The third finding —
  auto-unarchive completing after the reply — was judged and deliberately left, with the reasoning
  recorded in D-M5-21d rather than in silence.

- **rev 8 (2026-08-20) — D-M5-23, the config half of the same fix waves.** The headline of this
  milestone is config writes, and for anyone who exports `CLAUDE_CONFIG_DIR` — which this harness's own
  tenant preset does, per tenant — every one of them reported `ok` for a file no engine reads. The
  variable appears nowhere in this document, so this was an omission rather than a decision, and the
  repair is alignment: the fleet registry had the resolution right since probe 61, and the config domain
  now calls the same function instead of a second spelling. Beside it, three more corrections to WHICH
  BYTES the domain describes — the managed layer is `managed-settings.json` plus `managed-settings.d/*.json`
  (so masking verdicts on a managed machine were being computed without the active policy), an own
  `__proto__` key no longer draws attribution for a leaf the config does not carry, and an object merged
  over an array keeps the array as upstream does — and one correction to what it does when it cannot
  describe them: a masking pass that fails no longer turns a COMMITTED write into an error reply, because
  the client's retry duplicated array entries the merge rule is deliberately unable to dedupe.
- **rev 9 (2026-08-20) — D-M5-24, the lock, which is where the milestone's own hard promise was false.**
  Everything else this document guarantees is advisory or scoped; D-M5-14 says two writers with one token
  serialize and exactly one commits, and two OS processes at production settings showed both committing
  and one write vanishing with no report. The mechanism is replaced rather than patched: a claim
  DIRECTORY published by `rename`, ownership carried by a filename so every delete is content-conditional,
  and a lease the holder refreshes so a slow writer is waited for and refused instead of robbed. Note what
  this rev is really about — the defect was invisible to fifteen task reviews and to a suite that pins the
  lock's contract with an in-process double, and it took four real processes and 250 trials to see. The
  whole-branch review's lesson generalizes past the storage layer it was written about: **a test double is
  a title for whatever it stands in for**, and for a lock the thing it stands in for IS the concurrency.
- **rev 10 (2026-08-20) — D-M5-25, search honesty, where that same lesson was first written down.**
  D-M5-8 says a store read failure is an error, never an empty page, and acceptance criterion 5 says so
  in its own words; on the production origin both were false, because the SDK's readers answer `[]` and
  `undefined` for a failure and never throw, while every unit row pinning the contract injected a reader
  that does. A double more honest than its dependency proves nothing about the dependency. The repair is
  not a better catch clause — none can fire — but a precondition verified with plain `fs` before the scan,
  on the production origin only. Two corrections travel with it: the leak that fixing the contract makes
  live (search's error replies shipped node's errno text, absolute home path included, where the archive
  routes had stripped it all along), and a rationale measurement contradicts (row windows do not bound the
  storage read; they multiply it ~7.8x). Note the shape rev 9 named, arriving one layer up: the origin the
  doubles stood in for is the one that had to start checking itself, and the rule this milestone coined —
  **a title is not a test** — has a storage-layer twin in **an injected double is a title for the store**.
- **rev 11 (2026-08-20) — D-M5-26 and D-M5-27, the last fix wave: what a cursor and a capability each owe
  the client who holds one.** Seven confirmed defects, and the work worth recording is that six of them
  were one root rather than six repairs. A cursor resumes a WALK, and a walk has two parameters outside
  the position it names — the query that decides what is enumerated, and the generation of what is being
  enumerated. Neither was carried; where a generation was, it had a value meaning "do not check", and
  three of the four wrong-generation paths went through that one value. Each defect answered confidently
  and wrongly, which is the shape D-M5-16a had already ruled on for a different field of the same cursor:
  a server-minted value that could not have been minted is forged, and forged is refused. The seventh is
  the same question asked of a different surface — a published capability that changes without saying so
  is a client reading a stale answer forever, and on the fleet origin it was worse, because the blanket
  "a replayed frame runs no route" was right about nine routes and wrong about the one whose subject the
  attach seeds from nowhere else. Two general shapes are worth carrying out of this milestone: **a rule
  stated for the whole of something is a rule nobody has checked against its exceptions** (the replay drop,
  and the cold-cursor exemption, are the same mistake on two surfaces), and **the fixture that models a
  dependency's change must model everything the real one changes** — the verifier's fleet probe swapped a
  transcript's rows while freezing its own mtime, so the repair looked ineffective against it until the
  real reader was measured and the fixture corrected.
- **rev 12 (2026-08-20) — D-M5-13e, D-M5-25a rev 2, D-M5-26e: the corrective pass over the five fix
  waves, and its shape is the milestone's own lesson arriving one layer further in.** An independent
  review of the waves found three items worth landing and fifteen minors. The three: a fully-overridden
  config write reporting `ok` — a regression wave B introduced, in the exact truthfulness contract
  D-M5-13a/b/c/d had already been rewritten for four times; a search cursor honoured across a
  close-and-reopen, because an epoch is a per-record counter that restarts at 0 and wave E's claim of
  closure "by construction" did not cover that path; and a scorecard sentence promising a mid-scan
  read-failure guarantee the production reader cannot deliver. **The fifth shipped sentence measurement
  contradicts, and the second regression introduced by a fix.** Two shapes are worth carrying out of the
  pass. **An oracle that compares a thing to itself cannot see an over-count** — the write sweep checked
  attribution against attribution, so both sides read one wrong contributor list and agreed, and only a
  VALUE-level question (is what I wrote present at that path in the merged view) could see it. And **a
  decline is inherited as its reasoning, not as its outcome**: wave A's A3 decline was right and two of
  its three stated reasons were false, including one that named a pinned ordering that does not exist —
  a decline defended by a constraint nobody has re-checked is one mutation away from being reopened for
  the wrong reason. The pass also closed four minors wave D and wave B had deferred behind blockers that
  turned out to be overstated (`thread/list`'s audit, the per-reader gate, `stripPaths`' space, the
  empty-string `CLAUDE_CONFIG_DIR`), and recorded a decision for every minor it declined.
