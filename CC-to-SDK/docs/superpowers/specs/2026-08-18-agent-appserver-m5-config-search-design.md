# M5 — config domain + thread search/archive (agent app-server)

**Status:** design approved 2026-08-18 (owner, four forks resolved in one grill round); **rev 2 after
the external adversarial review** (Codex `gpt-5.6-sol`, 11 findings — see Revision Notes; eight highs
accepted and folded in, the review's no-ship concerns addressed at design level). Grounded by in-repo
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
  this view. `cwd` resolves the project/local pair; omitted, only user + managed are in view.
- **`config/value/write {keyPath, value, mergeStrategy, target?, cwd?, expectedVersion?}` →
  `{status, version, filePath, overriddenMetadata?, warnings?}`.** `target ∈ user|project|local`,
  default **user** (D-M5-1); managed is not in the enum — unwritable by construction, not by
  refusal. **`keyPath` is an array of string segments** (D-M5-12) — `["permissions","allow"]` —
  which dissolves Codex's quoted-segment grammar problem outright; a segment may contain any
  character including dots. Merge table (D-M5-13): `replace` sets the leaf to `value` exactly;
  `upsert` deep-merges `value` into the existing leaf with the same customizer as the read side
  (objects deep, arrays concat+dedupe); missing parents are created as objects; a non-object in the
  parent path → `ConfigValidationError`, file untouched; `replace` with `value: null` **deletes**
  the leaf; `upsert` with `null` → `ConfigValidationError`. Unknown top-level keys land with a
  `warnings` entry, never a refusal (D-M5-5). `okOverridden` + `overriddenMetadata` when a
  higher-precedence layer defines the same **leaf** (scalar/object leaves only; array leaves merge
  by contribution, so a write into one reports `ok` — the read side's contributor origins tell the
  whole story).
- **`config/batchWrite {edits[], target?, cwd?, expectedVersion?}`** — edits apply **in order** to
  one in-memory document; **any failing edit refuses the whole batch** with the file untouched
  (there is only ever the single final tmp+rename write, so rollback is structural, not
  compensating). No reload flag (D-M5-2): a write binds at the next engine spawn (new thread,
  reopen, clear, rewind swap) and the method docs say so.
- **Concurrency (D-M5-14, rev 2):** the version token is `sha256` of the file's raw bytes
  (`"absent"` for a missing file), and the check is made **atomic with the write**, not advisory:
  per-target-file writes serialize on an in-process queue, and the queue holds an advisory lockfile
  (`<file>.lock`, `O_EXCL` create, pid-stamped, stale-broken after 10s) across
  read → validate `expectedVersion` → write tmp → rename. Two writers with the same
  `expectedVersion` therefore serialize, and exactly one commits; the loser refuses
  `ConfigVersionConflict` against the winner's bytes. Omitted `expectedVersion` = last-wins by
  explicit choice, documented.
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
  a **keyset**: `(sortValue, sessionId, rowIndex)` — the last examined session and the row within it
  — so no unscanned session can sort ahead of a returned page in `created_at` order (the stable
  default). For `updated_at`/`recency_at` the sort value can move between pages; the contract is
  keyset semantics (a moved session may be re-encountered or skipped), stated in the schema docs
  with `created_at` recommended for exhaustive walks.
- **No permanent false negatives (D-M5-16, rev 2).** The per-page caps (files per page, rows per
  page) bound **work per request, never coverage**: the cursor carries the intra-file row position,
  a page that exhausted its budget mid-file resumes exactly there, and **a page may legitimately
  return zero matches with a non-null `nextCursor`** — bounded progress, honestly reported. Rows
  larger than the row-byte cap are skipped **and counted** in `skipped`, never silently.
- **Hard bounds (D-M5-17):** `searchTerm` 2–256 UTF-16 units; `limit` ≤ 50; snippet ≤ 200 units
  centered on the match; ≤ 40 files and ≤ 4000 rows examined per page; row-byte cap 1 MiB; one
  content scan runs at a time per server (a second search request queues behind it on a chain, same
  device as `record.chain`).
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
  store sessions, and acceptance proves the live-thread jump end-to-end.
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
- **The live-guard converges under race (D-M5-10, rev 2):** archive resolves the id and refuses a
  live thread ("close it first", delete's message) — and after creating the marker it **re-checks**
  liveness: if a resume won the race in between, the marker is unlinked and the request refuses
  BUSY. Both interleavings end in a consistent state (live ∧ unarchived, or cold ∧ archived);
  nothing hides a running session from the default list.
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
  of the seven methods ships its exact request/response/error zod schema in
  `appserver/schema/config.ts` / additions to `threads.ts`, wire-fixture-pinned** — the review's
  naming nits (sortKey tokens, `snippetMatchRange`, `{ok:true}`) are resolved above and the fixtures
  keep them resolved.
- Origin scope: `thread/archive`/`unarchive` and `thread/searchOccurrences` are `both` (disk +
  sidecar only, the `thread/delete` / `thread/read` precedents); `thread/search` and the config trio
  name no thread — `N/A`, like `fs/read`.
- **Plan staging (review F11, adopted):** the plan lands in reviewable stages — config/read (merge +
  origins + fixtures first), config writes (grammar + CAS), search, archive + list filter, absorb —
  each stage's tests green before the next begins. One milestone, one spec, staged execution.
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
- **D-M5-17 (rev 2) — hard bounds on every client-driven scan** (term 2–256, limit ≤ 50, snippet ≤
  200, ≤ 40 files / ≤ 4000 rows per page, 1 MiB row cap, one scan at a time). Rejected: unbounded
  scanning (review F9 — memory/event-loop exhaustion from parallel authenticated requests).

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
  the owner approved). Acceptance rewritten to carry the race, continuation, sibling-preservation,
  and jump-consumability tests the review demanded.
