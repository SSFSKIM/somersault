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
- **Concurrency (D-M5-14, rev 2):** the version token is `sha256` of the file's raw bytes
  (`"absent"` for a missing file), and the check is made **atomic with the write**, not advisory:
  per-target-file writes serialize on an in-process queue, and the queue holds an advisory lockfile
  (`<file>.lock`, `O_EXCL` create, **nonce-owned** — rev 3: the file carries a pid+random nonce, a
  release unlinks only after re-reading its OWN nonce, and a stale break (30s) never removes a lock
  it cannot read as stale, so owner A overrunning the window can no longer have its lock stolen and
  then unlink B's) across read → validate `expectedVersion` → write tmp → rename. The canonical
  parent directory (`.claude/`) is created before locking, and a target that is itself a symlink is
  resolved first so tmp+rename replaces the real file, never the link. Two writers with the same
  `expectedVersion` therefore serialize, and exactly one commits; the loser refuses
  `ConfigVersionConflict` against the winner's bytes. **The contract is scoped to this protocol's
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
  Transcripts are read in **row windows at the storage boundary** (rev 3: `getSessionMessages`
  already takes `{offset, limit}`; loading a whole giant transcript and then counting rows would
  spend the memory the caps exist to bound). Rows larger than the row cap are skipped **and
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
  hit against a field items do not carry). The occurrence **continuation cursor is epoch-qualified
  on a live thread** and refused on mismatch, exactly as `thread/read`'s is (rev 3 — a rewind must
  not make an old cursor silently search different content); on a cold session it carries no epoch
  and the store's immutability-between-requests is the documented assumption. A `threadId` naming a
  session the store does not know refuses `THREAD_NOT_FOUND` (rev 3) — an honest-looking empty
  result over a typo is the D-M5-8 lie in miniature.
- **Search honesty (D-M5-8, the D-M4-1 family rule):** a store read failure is an **error**, never
  zero hits — a directory that cannot be listed or a file that cannot be opened refuses the request;
  "no matches" is a claim about content actually scanned, and `skipped` discloses what was not.
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
  methods 59 → 66; the notification recipe 27 → 29. The drift gate's three passes enforce
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
   refuses "close it first"; an archive racing a resume converges (marker removed, BUSY) with
   nothing live ever hidden; two processes archiving different sessions both stick (marker files).
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
  for this surface.
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
  `"absent"` for missing. Rejected: rev 1's advisory hash check (a TOCTOU, review F3).
- **D-M5-15 (rev 2) — global keyset ordering:** full metadata sort in memory,
  `(sortValue, sessionId, rowIndex)` keyset cursor, `created_at` the stable default. Rejected:
  rev 1's capped newest-first walk (cannot serve alternate sorts truthfully — review F5).
- **D-M5-16 (rev 2) — caps bound work, never coverage:** intra-file cursor resume, zero-hit pages
  with continuation, skipped-rows disclosure. Rejected: rev 1's per-file byte cap (permanent false
  negatives — review F6).
- **D-M5-17 (rev 2, units fixed rev 3) — hard bounds on every client-driven scan** (term 2–256,
  limit ≤ 50 clamp-with-warning, snippet ≤ max(200, term), ≤ 40 files / ≤ 4000 rows per page,
  1,048,576 UTF-16-unit row cap, row-windowed storage reads, one scan at a time). Rejected:
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
  fires only when the lock cannot be unlinked or a live writer holds it past the deadline. Documented
  rather than re-architected. The seam a later milestone will want is separating "how long do I wait" from
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
  and forgetting it once).
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
  D-M5-21a closed this for `thread/archive` and left the same blind spot one handler over: with a roster row
  naming a live pid, `thread/resume` refused `-32602` and `thread/archive` refused `-33001`, while
  `thread/delete` called through and erased the transcript a running ccx process was appending to.
  Decided: **fix**, for the reason D-M5-21a gives plus one of its own — deletion is the one operation no
  later reader can undo, so it is the last place to be the odd one out. Same shared probe
  (`server.ts`'s `liveInFleet`), same `ERR.BUSY`, and the cross-process sentence rather than
  `thread/delete`'s own: "live in this server — close it first" is false about a holder in another process
  and unfollowable as advice. That sentence moved to `server.ts` beside the probe and is now imported by
  both methods — it was two independent literals, which is how the two answers drift apart again.

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

## Outcomes & Retrospective

Pending — written at finish.

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
