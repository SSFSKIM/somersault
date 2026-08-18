# M5 — config domain + thread search/archive (agent app-server)

**Status:** design approved 2026-08-18 (owner, four forks resolved in one grill round). Grounded by
in-repo Codex source reads (`codex-rs/app-server-protocol/src/protocol/v2/{config,thread}.rs`), the
0.3.234 SDK bump landed on this branch (`ccb090a006`), and probe 110.

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
  (`origins`), optional raw per-layer contents; layer sources carry a numeric precedence (MDM 0 →
  sessionFlags 30) and a broken layer is served as an entry with a disabled reason, not an error.
  `config/value/write {keyPath, value, mergeStrategy: replace|upsert, filePath?, expectedVersion?}` →
  `{status: ok|okOverridden, version, filePath, overriddenMetadata?}` — dotted key path, optimistic
  concurrency on a version token, and an explicit "your write landed but a higher layer masks it"
  outcome. `config/batchWrite {edits[], filePath?, expectedVersion?, reloadUserConfig?}` — same,
  atomic, with an opt-in hot reload that itself excludes session-static settings. Failures use named
  codes: `ConfigLayerReadonly`, `ConfigVersionConflict`, `ConfigValidationError`,
  `ConfigSchemaUnknownKey`, `ConfigPathNotFound`, `UserLayerNotFound`.
- **Search: two methods.** `thread/search {searchTerm, cursor?, limit?, sortKey?, sortDirection?,
  sourceKinds?, archived?}` → `{data: [{thread, snippet}], nextCursor?, backwardsCursor?}`.
  `thread/searchOccurrences {threadId, searchTerm, cursor?, limit?}` → occurrences over "visible user
  messages and final assistant messages", each with `snippet`, a UTF-16 `snippetMatchRange`, and a
  `turnCursor` the transcript pager accepts — search results that can jump the reader to the hit.
- **Archive: two methods, two notifications, one filter.** `thread/archive` / `thread/unarchive`
  `{threadId}` → `{}` plus `thread/archived` / `thread/unarchived` broadcasts; `thread/list` and
  `thread/search` take `archived?: bool` (absent/false hides archived, true shows only archived).

## What we ship

### The config domain — Codex's shape over Claude's own layers

The layer chain is Claude Code's documented one, not Codex's: **user** (`~/.claude/settings.json`) <
**project** (`<cwd>/.claude/settings.json`) < **local** (`<cwd>/.claude/settings.local.json`) <
**managed/policy** (read-only). We read the files ourselves and compute precedence — this is a
*files* surface; the *engine's* applied view stays where it lives today (`thread/settings/read`,
`get_settings`), and the spec draws that line explicitly so no client mistakes one for the other.

- `config/read {includeLayers?, cwd?}` → `{config, origins, layers?}`. `config` is the effective
  merge; `origins` maps each top-level key to the winning layer; `layers` (opt-in) returns each
  file's raw parse. A malformed settings file becomes a layer entry with `disabledReason` — the
  healthy layers are still served, and nothing pretends the broken one is empty. `cwd` resolves the
  project/local pair; omitted, only user + managed are in view. The managed layer resolves to the
  platform's managed-settings path (macOS `/Library/Application Support/ClaudeCode/
  managed-settings.json`, Linux `/etc/claude-code/managed-settings.json`); absent file = absent
  layer, never an error.
- `config/value/write {keyPath, value, mergeStrategy, target?, cwd?, expectedVersion?}` →
  `{status, version, filePath, overriddenMetadata?}`. `target ∈ user|project|local`, default
  **user** (D-M5-1). Dotted `keyPath`, `replace|upsert` merge, `version` = content hash of the file
  as read, stale `expectedVersion` → `ConfigVersionConflict` and no write. `okOverridden` +
  `overriddenMetadata` when a higher layer masks the written key — computed by the same machinery
  `config/read` uses. Managed targets refuse `ConfigLayerReadonly`.
- `config/batchWrite {edits[], target?, cwd?, expectedVersion?}` — all edits applied to one
  in-memory document, one atomic file write (tmp + rename). **No reload flag** (D-M5-2): a write
  binds at the next engine spawn (new thread, reopen, clear, rewind swap) and the method docs say so.
- **The write jail (D-M5-4):** project/local targets require `cwd` to equal a known workspace root —
  a live thread's cwd or the server's own cwd — the same fence `fs/read` draws. User-layer writes
  take no cwd at all. Codex accepts an arbitrary `filePath`; we do not ship "any authed WS client
  writes a settings file anywhere on disk."
- **Validation (D-M5-5):** structural only — the value must be JSON-serializable and the file must
  stay valid JSON. Unknown keys **warn** (in the response, not a refusal): upstream Claude Code
  tolerates unknown settings keys, and refusing them here would fight the grammar we are writing.
  Codex's `ConfigSchemaUnknownKey` refusal is the recorded deviation.
- Config error vocabulary rides `error.data.code` on the existing JSON-RPC codes (D-M5-9) —
  `peer.replyError` already carries `data`; no new `-330xx` numbers.
- `config/mcpServer/reload` is **not** shipped: our `mcpServer/reconnect` already covers that seam —
  recorded covered-by on the scorecard, not a gap.
- No `config/warning` notification: its Codex payload is parse diagnostics, which our
  `disabledReason` layer entry serves at read time to the client that asked.
- Paths are DI-injected (`homeDir` in deps, defaulting to `os.homedir()`), so unit and live tests
  never touch the real `~/.claude/settings.json`.

### Thread search — the store, found

- `thread/search {searchTerm, cursor?, limit?, sortKey?, sortDirection?, archived?, cwd?}` →
  `{data: [{thread, snippet}], nextCursor}`. Case-insensitive literal substring (Codex's own
  occurrence contract), over two corpora: session metadata (`customTitle`/`summary`/`firstPrompt`/
  `tag` — near-free) and persisted transcript content read the way `thread/read` reads it. The
  cursor walks the store newest-first; **each page scans a capped number of files with a byte cap
  per file** — a giant store costs pages, not memory, and the caps are stated in the schema docs,
  not silent. Snippet comes from the first match. `sortKey ∈ created_at|updated_at|recency` maps to
  store timestamps (`recency` ≡ `lastModified`); `cwd` reuses `thread/list`'s filter semantics.
- `thread/searchOccurrences {threadId, searchTerm, cursor?, limit?}` → `{data, nextCursor}` —
  per-thread hits over exactly the corpus `sessions/rows.ts` classifies (visible user prompts +
  assistant text; Codex's corpus definition, and we own the classifier, so search and replay cannot
  drift). Each occurrence: `snippet`, UTF-16 `matchRange` (native to JS strings), and **`rowOffset` —
  our `thread/read` absolute row offset standing in for Codex's `turnCursor`** (D-M5-7), so a client
  jumps the existing pager straight to the hit.
- **Search honesty (D-M5-8, the D-M4-1 family rule restated for this surface):** a store read
  failure is an **error**, never zero hits. A directory that cannot be listed or a file that cannot
  be read within the page refuses the request; "no matches" is a claim about content actually
  scanned. This rule was violated five times in M4 in five disguises; it is named here so the sixth
  disguise gets recognized.
- Dropped from Codex's shape, both documented (D-M5-6): `sourceKinds` (our store records no source
  kind — nothing true to filter on) and `backwardsCursor` (our `thread/list` never had one; a client
  reverses by flipping `sortDirection` from page one).

### Archive — server-owned state, store untouched

- The SDK store has **no archived field** (verified against 0.3.234's `SDKSessionInfo`), so
  archived-ness is ours: a sidecar registry at `~/.claude/ccx/archive.json` (D-M5-3), a
  sessionId → `{archivedAtMs}` map, atomic tmp + rename writes, read per-request. Nothing in the
  SDK's directory moves; resume, fork, delete and read all keep working on archived sessions.
- `thread/archive {threadId}` → `{}` + `thread/archived {sessionId}` server-wide broadcast;
  `thread/unarchive` mirrors with `thread/unarchived`. Id resolution and the live-guard mirror
  `thread/delete` ("Thread is live in this server — close it first"), but **without** delete's
  reservation machinery (D-M5-10): archive destroys nothing, so a concurrent resume is harmless.
  Archiving an already-archived thread (and unarchiving a non-archived one) replies `{ok:true}`
  idempotently — the registry write is the state, not a counter.
- `thread/list` and `thread/search` gain `archived?: boolean` with Codex's exact semantics:
  absent/false excludes archived sessions, true returns only them. This is the one change to an
  existing method, additive.

### The 0.3.234 absorb task (probe-gated)

One small task, probe-first: (a) does the headless `/context` result carry the new structured
`context_usage` sibling; (b) does a headless init carry `terminal_slash_commands`. What is alive gets
wired — the structured card into the context-usage surface, `terminal_slash_commands` as a field on
`thread/capabilities/read` (it exists precisely for remote UIs like our web clients). What is dead
flips the `full-potential.md` rows and ships nothing.

### Cross-cutting

- Scorecard: seven new rows in the server-origin table (no seam token, like the review rows) plus
  two notification rows; registered methods 59 → 66; the notification recipe 27 → 29. The drift
  gate's three passes enforce registration, staleness and bijection; schema artifacts regenerate in
  the same change.
- Origin scope: `thread/archive`/`unarchive` are `both` (they name a thread but touch only the
  sidecar and the store id, exactly like `thread/delete`); `thread/searchOccurrences` is `both`
  (disk-only read, the `thread/read` precedent); `thread/search` and the config trio name no thread
  — `N/A`, like `fs/read`.
- Testing: DI-based unit suites (temp-dir layer files for config, planted JSONL fixtures for search,
  temp sidecar for archive), plus one keyed live acceptance script per domain half.

## Acceptance (behavior, not implementation)

1. **Read sees the chain.** With a value planted in each of user/project/local, `config/read`
   returns the local value effective, `origins` naming `local` for that key and `user` for a
   user-only key; `includeLayers: true` returns each file's raw contents; a deliberately malformed
   project file yields a `disabledReason` layer entry while the other layers still serve.
2. **Write lands and versions guard.** `config/value/write` (user target, upsert) is visible in a
   follow-up `config/read` and in the file's bytes; the returned `version` matches a re-read; a
   second write carrying the stale `expectedVersion` refuses `ConfigVersionConflict` and the file is
   byte-identical after.
3. **Masked writes tell the truth.** Writing a user-layer key that local overrides returns
   `okOverridden` with `overriddenMetadata` naming the local layer and the effective value.
4. **The jail holds.** A project-target write with a `cwd` matching no live thread and not the
   server's own refuses; the same write with a live thread's cwd lands in that
   `<cwd>/.claude/settings.json`; a managed target refuses `ConfigLayerReadonly`.
5. **Search finds planted truth.** A marker planted in an old store session's transcript and another
   in a `customTitle` are both found with snippets containing the match; `archived` filtering hides
   and reveals correctly; making the store directory unreadable yields an **error**, not `[]`.
6. **Occurrences anchor.** On a thread with three planted hits, `thread/searchOccurrences` returns
   them in order with correct UTF-16 ranges, and `thread/read` at each `rowOffset` returns a row
   containing the match.
7. **Archive round-trips.** `thread/archive` hides the session from default `thread/list`, shows it
   under `archived: true`, broadcasts `thread/archived`; `thread/unarchive` restores both; archiving
   a live thread refuses "close it first"; both directions are idempotent.
8. **The absorb probes decide.** Probe results for `context_usage` and `terminal_slash_commands` are
   recorded; alive surfaces ship wired with tests, dead ones flip their rows.

## Roadmap beyond M5 (owner-confirmed 2026-08-18)

- **M6 candidate: dynamic tools** — the one genuine reverse-request feature (the client declares
  tools at `thread/start` and *is* the tool runtime; a park cannot answer it). Needs its own
  grounding + design pass; the D1 breach is deliberate and deserves its own decision. Commitment
  decided after M5 ships.
- **New since the grill — cross-session messaging (probe 110):** Claude Code's native
  `SendMessage`/`ListAgents` fabric is **headless-asymmetric**: a bare SDK session's `ListAgents`
  returns the user's full local fleet with live status, and `SendMessage` is callable
  (name-addressed), but SDK sessions are **not addressable** — absent from every roster, no
  `queued_notifications` capability, and a sent marker never arrives. Parked as a probe-grounded
  candidate: making ccx threads addressable peers needs a grounding pass over the registry/socket
  protocol (`Claude Code Src/` has the reference). The send half alone may already be worth a thin
  surface once a consented-target delivery test confirms it.
- **Parking lot, demand-driven, named triggers:** inline review delivery (needs child-session event
  splicing); fleet elicitation bridge (D-M4-8, host-wire revision); `account`/`init` host ops (the
  two `inProcess`-only introspection rows).

## Decision Log

- **D-M5-1 — three writable layers, default user.** `target ∈ user|project|local`; managed/policy
  refuse. Rejected: local-only (cannot serve "make this my default model", the headline use);
  user-only (Codex-verbatim minimum, starves project workflows the TUI already writes files for).
- **D-M5-2 — writes bind at next engine spawn; no reload flag.** Rejected: Codex's
  `reloadUserConfig` engine-swap reload — heavy machinery riding the rewind swap path for marginal
  payoff, and Codex itself excludes session-static settings from it.
- **D-M5-3 — archived-ness is a server-owned sidecar** (`~/.claude/ccx/archive.json`). Rejected:
  moving the JSONL Codex-style (breaks resume/fork while archived, rearranges an SDK-owned
  directory); reusing the store `tag` field (one string, two owners — collides with
  `thread/tag/set`).
- **D-M5-4 — the write jail.** Project/local writes require `cwd` ∈ known workspace roots (live
  thread cwds ∪ server cwd). Rejected: Codex's arbitrary `filePath` — its trust boundary is a
  desktop app's own backend; ours is any token-holding WS client.
- **D-M5-5 — unknown keys warn, never refuse.** Deviation from Codex's `ConfigSchemaUnknownKey`,
  because upstream Claude Code tolerates unknown settings keys and the files must stay
  upstream-compatible.
- **D-M5-6 — Codex-verbatim names; `sourceKinds` and `backwardsCursor` dropped.** Nothing true to
  serve for either; both documented as deviations rather than stubbed.
- **D-M5-7 — `rowOffset` is the occurrence anchor**, standing in for Codex's `turnCursor`, accepted
  by the existing `thread/read` pager. Rejected: minting a new opaque cursor vocabulary for a pager
  that already has one.
- **D-M5-8 — search honesty.** A store read failure is an error, never an empty result. The D-M4-1
  rule (never report a silent all-clear), re-derived for this surface before the sixth disguise
  finds it.
- **D-M5-9 — config errors ride `error.data.code`** with Codex's names on existing JSON-RPC codes.
  Rejected: new `-330xx` numbers per failure (the numeric space is for wire-level families, not
  domain vocabularies).
- **D-M5-10 — archive's live-guard mirrors delete, without the reservation.** Archive destroys
  nothing; a resume racing an archive is harmless in both orders. Rejected: copying
  `deletingSessions` wholesale (machinery whose reason does not transfer).
- **D-M5-11 — roadmap placement.** M6 candidate = dynamic tools, commitment post-M5; cross-session
  messaging parked pending a registration-mechanism grounding pass; inline delivery, fleet
  elicitation, account/init host ops stay demand-driven. Rejected: committing M6 now (the grounding
  that would justify it has not run).

## Surprises & Discoveries

- **Probe 110 (2026-08-18): the messaging fabric is visible but closed to us.** ListAgents from a
  bare SDK session returned the user's real fleet — 20 sessions with live busy/idle status,
  including the session running the probe's author. SendMessage is name-addressed (a raw session id
  earns "No agent named … is reachable") and loads as a *deferred* tool via ToolSearch. But neither
  probe session appeared in any roster, capabilities carried no `queued_notifications`, and the
  marker never arrived: SDK sessions can look, cannot be spoken to. The 0.3.234
  `fromMode`/`crossSessionInbound`/peer-origin declarations are the receive vocabulary — declared,
  and now measured as not reachable headless.
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
