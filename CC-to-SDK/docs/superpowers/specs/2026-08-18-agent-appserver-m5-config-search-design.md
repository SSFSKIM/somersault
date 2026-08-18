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
  resurfaced two tasks later as the root of a wire-visible High. The verdict is correct without closing
  it (an unattributed leaf is masked, which is the right answer), so only the *name* needs the fallback.
  Closing it in `configLayers.ts` remains the deeper fix and is carried to final-review triage. **The
  lesson recorded with it: a deferred Minor in an attribution layer is a latent defect in every consumer
  that reasons from it.**
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
- **D-M5-21 (rev 3) — admission auto-unarchives**: resume/attach of an archived session removes the
  marker and broadcasts. Rejected: leaving the archived-and-live state reachable by racing a second
  server (plan review F12); refusing resume of archived (archive is a shelf, not a lock).

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
