# M9 Arrival History (Stages B–D) Execution Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use doperpowers:subagent-driven-execution to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `thread/read` (and `thread/searchOccurrences`) show the peer messages a session actually received, via a server-side arrival log — so history stops showing an answer with no question.

**Architecture:** An append-only, session-keyed arrival log written synchronously at observation (`src/peer/arrivalLog.ts`); the observer in `appserver/peerInbound.ts` captures each arrival's anchor — the last filter-surviving frame it saw, with chain-position and fingerprint identity — through an explicit seeding state machine; a pure item-level projector (`appserver/items/project.ts`) injects arrival items after their anchor row's items without ever touching raw-row coordinates, so the published cursor and schema do not change; search gains an anchored-entry scan step. Placement is recomputed on every read; an anchor that does not resolve withholds, and every merge-enabled reply carries `arrivals: { logged, dropped }` so omission is detectable.

**Tech Stack:** TypeScript (Node ≥ 20, ESM), vitest, zod (schema), `@anthropic-ai/claude-agent-sdk` 0.3.250.

**Spec:** `CC-to-SDK/docs/superpowers/specs/2026-08-29-agent-appserver-m9-arrival-history-design.md` (rev 8). The spec's three round tables record why each mechanism has its exact shape; conflicts found during execution resolve against the spec. Its Acceptance section (criteria 6–28) is the contract; the final task executes it as written.

## Global Constraints

- **D1 — no wire break.** `thread/read`'s published cursor pattern `^\d+:\d+$` must not change; `harness/schema/json/stable/appserver.json` may change only by *adding optional response fields* (`origin` on user items, `arrivals` on read/search replies). Run `npm run write-schema` (see `harness/CLAUDE.md`) after schema-source edits and commit the regenerated artifact in the same commit.
- **The parity law (spec criterion 18) is a hard gate:** `projectItems(messages, EMPTY)` byte-identical to `itemsFromTranscript(messages)` for every corpus fixture. No Stage C task may merge while it fails.
- **Withhold, never misplace (D3):** any ambiguity in anchor resolution renders nothing rather than guessing a position.
- All commands run from `CC-to-SDK/harness/`. Unit suite: `npx vitest run test/unit/<path>`. Typecheck: `npx tsc --noEmit`. Capability gate: `node scripts/drift-check.mjs` (never edit it).
- Live tests are keyed: `set -a; . ../.env; set +a; npx vitest run test/live/<file>` — never print the token; skip cleanly unkeyed.
- Git: commit completed work to the current branch without asking; **no `Co-Authored-By` or any trailer**; never bare `git stash`; never `git add -A` (add named paths).
- Constants already in the codebase and reused here (do not re-declare): `MAX_ARRIVALS = 32` (`appserver/peerInbound.ts:24`), `MAX_FRAME_CHARS = 60_000` (`peer/address.ts:48`).

---

### Task 1: The arrival log store (`src/peer/arrivalLog.ts`)

**Files:**
- Create: `src/peer/arrivalLog.ts`
- Test: `test/unit/peer/arrival-log.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks. Uses `node:fs`, `node:path`, `node:crypto`, `node:os`.
- Produces (exact, later tasks import from `../../peer/arrivalLog.js`):
  ```ts
  export interface ArrivalFingerprint { type: string; hash: string; timestamp?: string }
  export interface ArrivalAnchor { afterUuid: string; prevUuid: string | null; fp: ArrivalFingerprint }
  export interface ArrivalEntry {
    v: 1; id: string; sessionId: string;
    anchor: ArrivalAnchor | null;   // null = CONFIRMED EMPTY (seed saw zero rows) — never "unknown"
    ambiguous?: true;               // seed-window unknowable order: persisted, counted, never placed
    seq: number; observedAt: string;
    origin: Record<string, unknown>; text: string;
  }
  export interface ArrivalCounts { logged: number; dropped: number }
  export interface ArrivalStore {
    append(e: ArrivalEntry): void;              // sync; throws on failure — caller latches degraded
    readAll(sessionId: string): ArrivalEntry[]; // retained entries, sorted by (seq, id)
    counts(sessionId: string): ArrivalCounts;   // logged = retained + marker.dropped
    nextSeq(sessionId: string): number;         // max retained seq + 1 (or marker.seqHigh + 1 if larger)
    isDegraded(sessionId: string): boolean;
    markDegraded(sessionId: string): void;      // best-effort persist; in-memory latch regardless
  }
  export const ARRIVAL_LOG_CAP = 32;            // mirrors MAX_ARRIVALS deliberately (spec: Bounds)
  export function contentHash16(rawText: string): string;   // sha256 hex of utf8 bytes, .slice(0, 16)
  export function fsArrivalStore(rootDir?: string): ArrivalStore;
  ```
- Layout on disk (rootDir default `path.join(os.homedir(), ".claude", "cc-harness", "arrivals")`):
  `<root>/<sessionId>/e-<seq padded 6>-<id>.json` per entry; `<root>/<sessionId>/marker.json` =
  `{ dropped: number, seqHigh: number, degraded?: true }`. Entry writes are temp-file-then-`renameSync`
  in the same directory. **Eviction order is marker-then-victim** (update `dropped`+`seqHigh`, fsync the
  marker via `writeFileSync` on a temp + rename, then `unlinkSync` the oldest entry); `readAll` treats a
  retained entry whose seq ≤ marker-implied dropped horizon *conservatively*: recovery in `append`
  re-unlinks any victim counted but not deleted (idempotent — spec round-6 table, finding 5).

- [ ] **Step 1: Write the failing tests** — `test/unit/peer/arrival-log.test.ts`, using a `mkdtemp` root per test:

```ts
import { describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fsArrivalStore, contentHash16, ARRIVAL_LOG_CAP, type ArrivalEntry } from "../../../src/peer/arrivalLog.js";

const entry = (n: number, over: Partial<ArrivalEntry> = {}): ArrivalEntry => ({
  v: 1, id: `id-${String(n).padStart(3, "0")}`, sessionId: "s1",
  anchor: { afterUuid: `u${n}`, prevUuid: n > 0 ? `u${n - 1}` : null, fp: { type: "assistant", hash: contentHash16(`row${n}`) } },
  seq: n, observedAt: new Date().toISOString(), origin: { kind: "peer" }, text: `m${n}`, ...over,
});

describe("fsArrivalStore", () => {
  it("round-trips entries sorted by (seq, id) and counts them", () => {
    const store = fsArrivalStore(mkdtempSync(join(tmpdir(), "arr-")));
    store.append(entry(2)); store.append(entry(1));
    expect(store.readAll("s1").map((e) => e.seq)).toEqual([1, 2]);
    expect(store.counts("s1")).toEqual({ logged: 2, dropped: 0 });
    expect(store.readAll("other")).toEqual([]);
  });
  it("nextSeq continues from the store across a re-open (criterion 11's substrate)", () => {
    const root = mkdtempSync(join(tmpdir(), "arr-"));
    fsArrivalStore(root).append(entry(7));
    expect(fsArrivalStore(root).nextSeq("s1")).toBe(8);   // a NEW store instance = a restart
  });
  it("evicts oldest past the cap, and logged still reports the pre-eviction total (criterion 17)", () => {
    const store = fsArrivalStore(mkdtempSync(join(tmpdir(), "arr-")));
    for (let i = 0; i < ARRIVAL_LOG_CAP + 3; i++) store.append(entry(i));
    expect(store.readAll("s1")).toHaveLength(ARRIVAL_LOG_CAP);
    expect(store.readAll("s1")[0].seq).toBe(3);
    expect(store.counts("s1")).toEqual({ logged: ARRIVAL_LOG_CAP + 3, dropped: 3 });
  });
  it("a counted-but-not-deleted victim is re-unlinked on the next append (over-report-safe recovery)", () => {
    const root = mkdtempSync(join(tmpdir(), "arr-"));
    const store = fsArrivalStore(root);
    for (let i = 0; i < ARRIVAL_LOG_CAP; i++) store.append(entry(i));
    // Simulate the crash window: bump the marker as append would, but leave the victim file on disk.
    store.append(entry(ARRIVAL_LOG_CAP));               // normal eviction of seq 0
    const dir = join(root, "s1");
    // hand-write a marker claiming one MORE drop than files reflect (add readFileSync/writeFileSync to the fs import)
    const marker = JSON.parse(readFileSync(join(dir, "marker.json"), "utf8"));
    writeFileSync(join(dir, "marker.json"), JSON.stringify({ ...marker, dropped: marker.dropped + 1 }));
    const reopened = fsArrivalStore(root);
    reopened.append(entry(ARRIVAL_LOG_CAP + 1));
    const counts = reopened.counts("s1");
    expect(counts.dropped).toBeGreaterThanOrEqual(2);    // never under-reports
    expect(reopened.readAll("s1").length + counts.dropped).toBe(counts.logged);
  });
  it("append throws on an unwritable directory and markDegraded survives a re-open", () => {
    const root = mkdtempSync(join(tmpdir(), "arr-"));
    const store = fsArrivalStore(root);
    store.append(entry(0));
    chmodSync(join(root, "s1"), 0o500);
    try { expect(() => store.append(entry(1))).toThrow(); } finally { chmodSync(join(root, "s1"), 0o700); }
    store.markDegraded("s1");
    expect(fsArrivalStore(root).isDegraded("s1")).toBe(true);
  });
  it("contentHash16 is stable and 16 hex chars", () => {
    expect(contentHash16("hello")).toMatch(/^[0-9a-f]{16}$/);
    expect(contentHash16("hello")).toBe(contentHash16("hello"));
    expect(contentHash16("hello")).not.toBe(contentHash16("hello ")); 
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run test/unit/peer/arrival-log.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement `src/peer/arrivalLog.ts`.** Key points beyond the interface above: `append` ensures the session dir (`mkdirSync recursive`), performs recovery first (unlink any retained entries beyond what `marker.dropped` says should remain oldest-first — i.e. if `retained + dropped > logged-implied`, unlink oldest until consistent), writes the entry temp+rename, then enforces the cap with marker-then-victim; `nextSeq` = `max(maxRetainedSeq, marker.seqHigh) + 1`; `markDegraded` merges `{degraded: true}` into the marker via temp+rename inside try/catch (best-effort) and always sets an in-memory latch; `counts` returns `{ logged: retained + marker.dropped, dropped: marker.dropped }`. File name embeds seq+id so `readdirSync().sort()` is `(seq, id)` order without parsing.
- [ ] **Step 4: Run the tests** — `npx vitest run test/unit/peer/arrival-log.test.ts` → PASS. Also `npx tsc --noEmit` → clean.
- [ ] **Step 5: Commit** — `git add src/peer/arrivalLog.ts test/unit/peer/arrival-log.test.ts && git commit -m "feat(m9): arrival log store — append-only, capped with an over-report-safe marker"`

---

### Task 2: Observer — seeding, anchor capture, persist-then-broadcast (`appserver/peerInbound.ts`)

**Files:**
- Modify: `src/appserver/peerInbound.ts` (state + `installPeerInbound` + `noteArrival`)
- Modify: `src/appserver/server.ts` (the `AppServerDeps` interface, around line 60)
- Test: `test/unit/appserver/peer-inbound-log.test.ts` (new; the existing `peer-inbound.test.ts` must keep passing untouched)

**Interfaces:**
- Consumes from Task 1: `ArrivalStore`, `ArrivalEntry`, `ArrivalAnchor`, `contentHash16`, `fsArrivalStore`.
- Produces: `AppServerDeps.arrivalStore?: ArrivalStore` — and the **structural rule** (spec: Store injection): merging/logging is active iff `deps.arrivalStore !== undefined || deps.getSessionMessages === undefined`; when the reader is overridden and no store is supplied, the observer does not log and readers omit `arrivals` entirely. Resolve the effective store once: `const effectiveArrivalStore = (deps: AppServerDeps): ArrivalStore | undefined => deps.arrivalStore ?? (deps.getSessionMessages ? undefined : defaultFsStore())` where `defaultFsStore` lazily constructs one shared `fsArrivalStore()`. Export this helper from `peerInbound.ts` — Tasks 4 and 5 call it.

**Mechanism to implement (spec: "The observer has to be seeded", verbatim rules):**
- `PeerInboundState` gains: `anchor: ArrivalAnchor | null | undefined` (undefined = still seeding), `seeding: { frames: { uuid: string; type: string; hash: string; timestamp?: string }[]; arrivals: PendingArrival[] } | null`, `degraded: boolean`.
- The **filter-surviving predicate** (one exported function, `readerVisible(frame): boolean`): `!frame.isMeta && !frame.isSidechain && !frame.teamName` on `type: "user" | "assistant" | "system"` frames carrying a `uuid`. It mirrors `getSessionMessages`' drop rule (spec M1/M2); Task 7 pins it against the reader with a corpus test.
- On every frame in `installPeerInbound`'s `onFrame`: if `readerVisible(frame)` → during seeding push to `seeding.frames`; after seeding set `state.anchor = { afterUuid: frame.uuid, prevUuid: previous anchor's afterUuid ?? null, fp: { type, hash: contentHash16(rawTextOf(frame.message?.content)), ...(timestamp ? { timestamp } : {}) } }`.
- `noteArrival` during seeding buffers `{ arrivalUuid, text, origin, observedAt }` into `seeding.arrivals` — **no store write, no broadcast yet**. After seeding: build the entry with the current `state.anchor` (or `null` = confirmed-empty only when the seed reported zero rows AND no visible frame has been observed), `seq = store.nextSeq(sessionId)` cached and incremented locally, `store.append(entry)` **before** `srv.broadcast(...)`; on append throw → `store.markDegraded`, `state.degraded = true`, still broadcast (spec: Durability).
- **Seeding runs at install when the record has a `sessionId`** (attach/resume): fire `getSessionMessages(sessionId)` (the effective reader from deps); on resolve, ground per the **overlap rule + ambiguity floor** (spec verbatim): earliest buffered frame uuid found in the seed → ground on the seed row before it; no overlap and the seed returned rows → any buffered *arrivals* observed before seeding finished are entries with `ambiguous: true` (persisted, counted, never placed); no overlap and empty seed → ground confirmed-empty; then replay `seeding.frames` in order to advance the anchor, then flush `seeding.arrivals` in order (persist-then-broadcast each). A record with **no sessionId yet** (fresh thread) skips the read and grounds confirmed-empty at the init frame (the router's init latch), flushing the same way — the pre-init crash window stays the stated limit.
- `uninstallPeerInbound` clears the seeding state alongside its existing cleanup.

- [ ] **Step 1: Write the failing tests.** Use the same fake-session harness `test/unit/appserver/peer-inbound.test.ts` already uses (read it first; reuse its `installPeerInbound` fixture pattern). Cover, one `it` each, citing the criterion: (6) one entry per `thread/peerMessage`, ids equal as sets; (7) every non-null anchor names a row the injected reader returns, `prevUuid` its predecessor, `fp.hash === contentHash16` of that row's text; (8) a folded arrival (frame while adopted turn runs) is logged; (10) append-throw → notification still broadcast + `isDegraded` true (inject a store whose `append` throws once); (11) restart ordering — two same-anchor arrivals, new store instance between them, seqs increase; (12) delayed seed (reader returns a pending promise) + immediate arrival → after resolve, entry anchored to the seeded row, never null; (14) the four overlap shapes — seed-behind, seed-ahead, partial overlap, seed-tail-equals-buffer-head — each frame anchoring exactly once; (15) buffer holds only an arrival while the seed returns unseen rows → entry has `ambiguous: true` and `anchor` recorded but flagged; (16) fingerprint fixtures — differing-parent duplicate shape and timestamp-absent frame — resolution helper (Task 4's, so here just assert the *recorded* anchor fields are exactly as specified).
- [ ] **Step 2: Run to verify failure** — `npx vitest run test/unit/appserver/peer-inbound-log.test.ts` → FAIL.
- [ ] **Step 3: Implement**, keeping `noteArrival`'s existing uuid/queue/announce contract byte-compatible for the non-logging path (no store → behavior identical to today; the existing test file is the regression net).
- [ ] **Step 4: Run** — `npx vitest run test/unit/appserver/peer-inbound-log.test.ts test/unit/appserver/peer-inbound.test.ts` → PASS both. `npx tsc --noEmit` → clean.
- [ ] **Step 5: Commit** — `git add src/appserver/peerInbound.ts src/appserver/server.ts test/unit/appserver/peer-inbound-log.test.ts && git commit -m "feat(m9): the observer logs arrivals — seeded, buffered, persisted before announced"`

---

### Task 3: The projector and the parity law (`appserver/items/project.ts`)

**Files:**
- Create: `src/appserver/items/project.ts`
- Modify: `src/appserver/items/types.ts` (one additive field) and `src/appserver/items/mapper.ts` (only if `userItem` needs an options overload; prefer a new `arrivalItem` helper in `project.ts` instead)
- Test: `test/unit/appserver/items/project.test.ts`

**Interfaces:**
- Consumes from Task 1: `ArrivalEntry`.
- Produces:
  ```ts
  // types.ts — additive, optional; old clients ignore it (spec: arrival items are marked)
  export interface UserMessageItem { type: "userMessage"; id: string; text: string; origin?: Record<string, unknown> }

  // project.ts
  export interface ResolvedArrivals { byRow: Map<number, ArrivalEntry[]>; atStart: ArrivalEntry[] }
  export const EMPTY_ARRIVALS: ResolvedArrivals;
  export function projectItems(rows: unknown[], arrivals: ResolvedArrivals, windowIncludesRowZero: boolean): Item[];
  ```
  `byRow` keys are **window-relative row indices**; resolution (anchor → index) is Task 4's job, so the projector stays pure. `atStart` entries emit first, only when `windowIncludesRowZero`. Entries within a row/atStart group are already sorted `(seq, id)` by the store.
- **The parity law is the definition:** `projectItems(rows, EMPTY_ARRIVALS, anything)` must equal `itemsFromTranscript(rows)` element-for-element. Implement by *restructuring* `itemsFromTranscript`'s loop body into a shared per-row routing function that both call — do not copy the routing (spec round-6 table, finding 1: transcription drift is the enemy; one function cannot drift from itself). `items/replay.ts`'s exported `itemsFromTranscript` becomes `projectItems(rows, EMPTY_ARRIVALS, false)` internally or both delegate to the shared reducer — either shape is fine as long as there is exactly one routing body.

- [ ] **Step 1: Write the failing tests.**
  - **Parity property test** over a fixture corpus: every transcript-shaped fixture already present under `test/unit/appserver/` (grep for arrays fed to `itemsFromTranscript` in `test/unit/appserver/items/replay.test.ts` and `subscribe.test.ts` and lift them into a shared `test/unit/appserver/items/corpus.ts`), plus generated shapes: plain `[user, assistant]` (round 6's prompt-erasure case — assert the user item IS present), two-concurrent-tools, straddling tool_result, phantom rows, peer rows. Assert deep equality of `projectItems(rows, EMPTY_ARRIVALS, false)` with `itemsFromTranscript(rows)` for each.
  - Arrival injection: anchored entry emits immediately after its row's items; an item opening at the anchor row but completing later emits after the arrival (assert with a tool_use at the anchor and its tool_result later); `origin` present on the arrival item; text is `entry.text` verbatim (feed a collapsed-batch-shaped text and assert both messages present — criterion 20).
  - Null sentinel: `atStart` entries emit first iff `windowIncludesRowZero`.
- [ ] **Step 2: Run to verify failure** — `npx vitest run test/unit/appserver/items/project.test.ts` → FAIL.
- [ ] **Step 3: Implement** per the interface; then run the *existing* replay tests too.
- [ ] **Step 4: Run** — `npx vitest run test/unit/appserver/items` → PASS (new + `replay.test.ts` untouched-green). `npx tsc --noEmit` → clean.
- [ ] **Step 5: Commit** — `git add src/appserver/items/ test/unit/appserver/items/ && git commit -m "feat(m9): the projector, defined by parity with the replay it extends"`

---

### Task 4: `thread/read` integration (`appserver/subscribe.ts`)

**Files:**
- Modify: `src/appserver/subscribe.ts`
- Create: `src/appserver/arrivalsReply.ts` (the one response helper + anchor resolution — subscribe.ts is already dense; keep it under the module-size norm)
- Modify: `src/appserver/schema/threads.ts` (optional `arrivals` response field) + regenerate the JSON schema artifact
- Test: `test/unit/appserver/subscribe-arrivals.test.ts`

**Interfaces:**
- Consumes: Task 1's store API via Task 2's `effectiveArrivalStore`; Task 3's `projectItems`/`ResolvedArrivals`.
- Produces (`arrivalsReply.ts`):
  ```ts
  export function arrivalsField(store: ArrivalStore | undefined, sessionId: string | undefined):
    { arrivals: { logged: number; dropped: number } | null } | {}   // {} when merging disabled (criterion 26)
  export function resolveArrivals(entries: ArrivalEntry[], rows: unknown[], lookbehindRow: unknown | undefined,
    windowIncludesRowZero: boolean): ResolvedArrivals
  ```
  `resolveArrivals` implements the full resolution rule (spec: The log / Placement): skip `ambiguous` entries; skip entries whose `id` appears among row uuids (dedupe guard); anchor resolves at window-relative index `i` iff `rows[i].uuid === afterUuid` AND predecessor check — `rows[i-1].uuid === prevUuid` for `i > 0`, `lookbehindRow?.uuid === prevUuid` for `i === 0` with a lookbehind present, `prevUuid === null` for `i === 0` at file start — AND every recorded `fp` field matches (`type`; `hash` vs `contentHash16(rawTextOf(row.message?.content))`; `timestamp` only if recorded). `atStart` = non-ambiguous `anchor === null` entries.
- **Pager wiring, exhaustively:** every `getMessages(sessionId, { offset: from, ... })` with `from > 0` fetches `offset: from - 1` and one extra row, peels `windowMessages[0]` off as `lookbehindRow` before ALL existing arithmetic (`base` stays `from`; `boundaryRow` still bisects the unpeeled window) — one row of left context, excluded from output and cursor math (spec round-6, finding 4). `pageFromWindow` takes the projected items: `projectItems(windowMessages, resolved, from === 0)`; `boundaryRow`'s id-set becomes `projectItems(windowMessages.slice(0, mid), restrictTo(resolved, mid), false)` where `restrictTo` drops `byRow` keys ≥ `mid` (and `atStart` never participates in prefixes — pass `false` for row-zero inclusion inside the bisection, which is exactly the "excluded from the bisection" sentinel rule); **null-anchored ids never enter `targetIds`**, and `atStart` entries are excluded from discard — if `discardCount` would cut into them, extend the page to include them (spec: null sentinel). All **five** reply paths append the `arrivalsField(...)` spread: cursorless, normal page, last-resort `from === 0` page, `cursorRow <= 0` empty reply, `!record.sessionId` reply (the last two pass `sessionId: undefined` → field logic still applies per criterion 23/26).

- [ ] **Step 1: Write the failing tests**, with an injected reader (`deps.getSessionMessages`) + injected store (so the structural rule is under test too — supplying BOTH keeps merging on). One `it` per criterion: (19) arrival item immediately before the assistant answer; (21) cursors still match `^\d+:\d+$` and address raw rows (walk with and without arrivals — same cursor sequence); (22) the full `limit:1` edge set — window-last-row anchor, unfinished-tool anchor, more same-anchor arrivals than limit ending in the last-resort page, **round 5's walk** (`atStart` entry + 3 rows, all four items returned), **round 6's left edge** (anchor at a bounded window's first row, verified via lookbehind); (23) `arrivals` on all five reply paths; (24) removed anchor row / changed hash / changed predecessor → withheld, positions stable, `logged` exceeds marked items; (26) reader overridden without store → no merge, no `arrivals` key at all; and a no-arrivals regression guard — with the store empty, page outputs (items and cursors) are element-identical to what the unmodified pager produced, which the untouched `subscribe.test.ts` continues to pin.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** `arrivalsReply.ts`, then wire `subscribe.ts`; update `schema/threads.ts` with the optional response field; regenerate the schema artifact; `git diff harness/schema/json/stable/appserver.json` **must show the cursor pattern line unchanged** (D1 check — record the diff in the task report).
- [ ] **Step 4: Run** — `npx vitest run test/unit/appserver/subscribe-arrivals.test.ts test/unit/appserver/subscribe.test.ts test/unit/appserver/items` → all PASS. `npx tsc --noEmit`, `node scripts/drift-check.mjs` → clean.
- [ ] **Step 5: Commit** — `git add src/appserver/subscribe.ts src/appserver/arrivalsReply.ts src/appserver/schema/threads.ts harness/schema/json/stable/appserver.json test/unit/appserver/subscribe-arrivals.test.ts && git commit -m "feat(m9): thread/read renders logged arrivals — same cursor, same schema shape, arrivals counted on every reply"`

*(If the schema artifact path differs, locate it via `git grep -l 'thread/read' ../schema harness/schema` and use the real one; never widen the cursor pattern.)*

---

### Task 5: `thread/searchOccurrences` anchored scan (`appserver/search.ts`)

**Files:**
- Modify: `src/appserver/search.ts`
- Modify: `src/appserver/schema/search.ts` (optional `arrivals` on the reply)
- Test: `test/unit/appserver/search-arrivals.test.ts`

**Interfaces:**
- Consumes: Tasks 1/2/4 (`effectiveArrivalStore`, `resolveArrivals`-style matching — reuse the *same* anchor-match predicate exported from `arrivalsReply.ts`; do not re-implement it).
- Produces: the scan loop (search.ts:521-527 region), after scanning row `r`'s text, scans each entry anchored at `r` in `(seq, id)` order; `atStart` entries scan before row 0 (only when the scan window starts at 0). Occurrences inside an entry publish the anchor's coordinates: `rowOffset` = anchor row's offset, `uuid` = entry id, `readCursor` = `` `${epoch}:${anchorRowOffset + 1}` `` (null-anchored: `` `${epoch}:1` `` when a first row exists; not enumerable in an empty transcript). The **resume cursor** (already opaque/generation-qualified, search.ts:75-83) gains a discriminated phase: `row(rowOffset, charOffset)` (today's) vs `arrival(rowOffset, seq, id, charOffset)` with `charOffset` entry-local. Entry scan work is bounded separately (≤ `ARRIVAL_LOG_CAP × MAX_FRAME_CHARS` per request) and does not touch `rowsScanned`.

- [ ] **Step 1: Write the failing tests**: (27) a retained arrival's text found, `readCursor` lands a window containing the anchor row; after filling past the cap, the evicted arrival's text is NOT found and the reply's `arrivals.dropped > 0`; null-anchored arrival findable when a first row exists; (28) two same-anchor arrivals both matching, `limit:1` walk visits both exactly once; two matches inside ONE arrival at `limit:1` resume on the entry-local offset.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement**; keep `thread/search` (the store-wide sibling) untouched.
- [ ] **Step 4: Run** — `npx vitest run test/unit/appserver/search-arrivals.test.ts test/unit/appserver/search.test.ts` → PASS. `npx tsc --noEmit`, `node scripts/drift-check.mjs` → clean.
- [ ] **Step 5: Commit** — `git add src/appserver/search.ts src/appserver/schema/search.ts test/unit/appserver/search-arrivals.test.ts harness/schema/json/stable/appserver.json && git commit -m "feat(m9): search scans retained arrivals at their anchors, and says when eviction hides some"`

---

### Task 6: D2 end-to-end, the reader-predicate contract test, and criterion 13/25

**Files:**
- Test: `test/unit/appserver/arrivals-clear-degraded.test.ts`
- Test: `test/unit/peer/reader-predicate-contract.test.ts`

**Interfaces:** consumes everything above; produces no new API.

- [ ] **Step 1: Write the tests** (these run against the assembled server fixture used by `test/unit/appserver/fr-*.test.ts` — read one for the harness pattern):
  - (25) **clear detaches:** admit with session A + logged arrivals → `thread/clear` → `thread/read` shows none and `arrivals` reflects the *new* (empty) session; `thread/resume` back to session A → arrivals render again.
  - (13) **degraded survives restart:** unwritable store dir → arrival → `arrivals: null` on reads; rebuild the server over the same root → still `arrivals: null`.
  - **Reader-predicate contract** (spec: seeding, drift): run `readerVisible` against every fixture frame shape in the Task 3 corpus AND against rows-on-disk fixtures carrying `isMeta`/`isSidechain`/`teamName`, asserting agreement with the documented reader drop rule; the test's header names the drift ritual as its trigger for updates.
- [ ] **Step 2–4: Red → implement any glue the tests expose → green**, then the full gate: `npx vitest run test/unit` (entire unit suite), `npx tsc --noEmit`, `node scripts/drift-check.mjs`.
- [ ] **Step 5: Commit** — `git add test/unit/appserver/arrivals-clear-degraded.test.ts test/unit/peer/reader-predicate-contract.test.ts && git commit -m "test(m9): clear detaches, degradation survives restart, and the reader predicate cannot drift silently"`

---

### Task 7: The keyed live leg, and LEG 2's planned flip

**Files:**
- Modify: `test/live/appserver-cross-session.test.ts`

**Interfaces:** consumes the shipped server; no new API.

**Context an implementer needs:** LEG 2 (line ~425) currently asserts `expect(data.map(i => String(i.id))).not.toContain(arrivalUuid)` — it pins the *gap* and was written to go red the day Stage C closes it. **Flipping it is this task's point, not a regression** (spec criterion 19: "the inverse of M8's LEG 2").

- [ ] **Step 1: Flip LEG 2**: the arrival id IS in `thread/read`'s items, the arrival item precedes the answer item, carries `origin`, and the reply's `arrivals.logged ≥ 1`.
- [ ] **Step 2: Add LEG 10 (M9)**: batched sends (reuse LEG 5's machinery) → after settle, `thread/read` returns the collapsed frame's item carrying BOTH message texts (criterion 20 live) and marked `origin`; a `limit: 1` cursor walk over the same session terminates, strands nothing, all cursors match `^\d+:\d+$` (criteria 21/22 live).
- [ ] **Step 3: Run keyed** — `set -a; . ../.env; set +a; npx vitest run test/live/appserver-cross-session.test.ts` → all legs green. Paste the leg summary into the task report; if the account is quota-blocked, report BLOCKED with the exact error rather than skipping silently.
- [ ] **Step 4: Commit** — `git add test/live/appserver-cross-session.test.ts && git commit -m "test(m9): LEG 2 flips as designed — history now contains the question; LEG 10 pins it live"`

---

### Task 8: Final verification — the spec's acceptance, executed as written

**Files:**
- Modify: `CC-to-SDK/docs/parity/appserver.md` (the `thread/read` / `thread/searchOccurrences` rows), `CC-to-SDK/docs/parity/coverage.md` (session-store / history domain), the spec's `## Outcomes & Retrospective`.

- [ ] **Step 1:** Full gates from `harness/`: `npx vitest run test/unit` → expect **all green** (record counts); `npx tsc --noEmit` → exit 0; `node scripts/drift-check.mjs` → exit 0.
- [ ] **Step 2:** Walk spec criteria 6–28 one by one against a named test (file + test name) or a live leg; write the 23-row checklist into the task report. Any criterion without a covering test is a FAIL for this task — go back and add it.
- [ ] **Step 3:** Keyed acceptance: `set -a; . ../.env; set +a; npx vitest run test/live/appserver-cross-session.test.ts` → green.
- [ ] **Step 4:** Update the scorecard rows and `coverage.md`; replace the spec's "Pending — written at finish." with the outcomes entry (what shipped, the two stated limits, U1 still open).
- [ ] **Step 5: Commit** — `git add CC-to-SDK/docs/parity/ CC-to-SDK/docs/superpowers/specs/2026-08-29-agent-appserver-m9-arrival-history-design.md && git commit -m "docs(m9): scorecard and retrospective — history contains the question"`
