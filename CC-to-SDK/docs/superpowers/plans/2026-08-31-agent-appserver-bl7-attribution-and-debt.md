# BL7 — Live-Channel Attribution Honesty + Debt Ledger Execution Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use doperpowers:subagent-driven-execution to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the live channel as honest as M9 made history — `thread/peerMessage` says what the arrival says (#63), an arrival is attributed only to the turn evidence gives it (#64) — and pay the adjudicated tech-debt ledger.

**Architecture:** All product work lands in `src/appserver/peerInbound.ts` (streams 1–2), `src/peer/address.ts` + `src/appserver/peerDomain.ts` (the send-side guard), and test files (the debt quartet); the round ends with a behavior-preserving three-way split of `peerInbound.ts`. No wire coordinate moves; the only schema change is one additive optional notification field.

**Tech Stack:** TypeScript, vitest, the existing fake-engine unit harnesses; keyed live suite (controller-run only).

**Spec:** `CC-to-SDK/docs/superpowers/specs/2026-08-31-agent-appserver-bl7-attribution-and-debt-design.md`

## Global Constraints

- Every command runs from `CC-to-SDK/harness/` — EXCEPT the drift gate, which is `node scripts/drift-check.mjs` run from `CC-to-SDK/`.
- Full unit suite: `npm run test:unit`. Focused: `npx vitest run <path>`. Typecheck: `npm run typecheck`.
- Never edit `CC-to-SDK/scripts/drift-check.mjs`; never weaken `docs/parity/` claims to pass a gate.
- Keyed live tests read `CC-to-SDK/.env` and are run by the CONTROLLER only. Executors never source `.env` and never print its contents.
- Commit messages carry no `Co-Authored-By` and no attribution trailers. Stage named paths only — never `git add -A`.
- The wire changes exactly once in this plan: `thread/peerMessage` gains optional `text`. Every other observable shape (cursor patterns, item shapes, caps, announce-once) must be byte-stable.
- Task 6's split commit contains ZERO test-assertion changes — moved imports only.
- The spec is the authority for every rule cited below; on conflict, the spec governs and the conflict is reported, not silently resolved.

---

### Task 1: #63 — `thread/peerMessage` gains `text`

**Files:**
- Modify: `src/appserver/peerInbound.ts` (`announceArrival`, ~line 455–468)
- Modify: `src/appserver/schema/peer.ts` — only if it declares the notification; if notifications are not zod-typed there, skip with a note in the report
- Test: `test/unit/appserver/peer-inbound.test.ts` (the `thread/peerMessage` describe block)
- Modify: `../docs/parity/appserver.md` (the peerMessage/notification row)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: the notification payload `{ threadId, arrivalUuid, origin, text }` — Task 7 verifies it live.

- [ ] **Step 1: Write the failing tests.** In the `thread/peerMessage` block, add:
  - a cell asserting a plain arrival's announcement carries `text` equal to the emitted item's text and `origin` deep-equal to the frame's origin (extend the existing "announces an arrival, carrying the origin verbatim" fixture pattern);
  - a batch-shape cell reusing the existing "shows the FRAME's own message when origin.body disagrees" fixture: the announcement's `text` must equal the ITEM's text (the frame's own resolved text), while `origin.body` still names the causing message — the two fields deliberately disagree and the test says so.
- [ ] **Step 2: Run them to verify they fail** (`npx vitest run test/unit/appserver/peer-inbound.test.ts`): the new cells red on missing `text`.
- [ ] **Step 3: Implement.** In `announceArrival`, add `text: pending.text` to the broadcast payload. Rewrite the function's closing comment paragraph (the one beginning "WHICH MEANS THIS NOTIFICATION IS NOT A SECOND COPY…"): the defect it documents is now closed, and the paragraph is replaced by the spec's decided meaning, verbatim in substance: `origin` is the engine's verbatim delivery provenance (kernel-vouched `verifiedPeerPid`; in a batch its `body`/`msg_id` name the CAUSING message), `text` is what THIS arrival says — identical under the same `arrivalUuid` on announcement, live item, projected row, and replayed row; the two are deliberately not reconciled (probe 121 verdict C).
- [ ] **Step 4: Run the suite green** (`npx vitest run test/unit/appserver/peer-inbound.test.ts`), then `npm run typecheck`.
- [ ] **Step 5: The live half (edit only — never run keyed).** In `test/live/appserver-cross-session.test.ts`, extend LEG 2's existing announcement capture: the captured `thread/peerMessage` params must carry `text` equal to the arrival item's text under the same `arrivalUuid`. Edit the assertion; the CONTROLLER runs it keyed in Task 7's close-out.
- [ ] **Step 6: Docs.** Update `../docs/parity/appserver.md`'s peerMessage documentation with the new field and the one-sentence origin-vs-text meaning. Check `src/appserver/schema/peer.ts` for a notification declaration; update if present.
- [ ] **Step 7: Commit** (`feat(bl7): thread/peerMessage says what the arrival says — text beside verbatim origin`).

---

### Task 2: #64 — arrival attribution by bracket evidence

**Files:**
- Modify: `src/appserver/peerInbound.ts` (`Arrival` interface, `enqueueLive`, `drainArrivals`, the `onFrame` drain call site, `groundSeed`'s trailing drain)
- Test: `test/unit/appserver/peer-inbound.test.ts` (new `describe("arrival attribution")`)

**Interfaces:**
- Consumes: from Task 1: `announceArrival`'s payload (untouched here).
- Produces: the binding mechanism Task 6 relocates verbatim. `registry.ts` is read-only here (`activeTurnId`, `turnStartedBroadcast` already exist).

- [ ] **Step 1: Write the failing tests** (`describe("arrival attribution")`):
  - **(attr-1, the misattribution pin):** start an OWN turn mid-flight — via the suite's own server fake if it can drive `turn/start` against the fake engine, else via the `fr-*` family's harness pattern (a real `beginTurn` over a scripted engine), else by setting `record.busy`/`currentTurnId`/`turnStartedBroadcast` exactly as `beginTurn` does with the emit path observed — deliver a peer arrival frame mid-turn; assert the arrival's `item/completed` names the OWN turn's id and fires after its `turn/started`; then open a foreign adoption and assert it receives NO item for that arrival.
  - **(attr-2, next-bracket):** deliver an arrival while nothing runs; then open an adoption; assert the arrival's item lands in that adoption's turn (this is today's behavior for the caused-turn case — the cell pins that the fix keeps it).
  - **(attr-3, bracket death):** deliver an arrival while nothing runs; open an adoption whose `beginTurn` never installs a mapper and terminate it (the dead-adoption shape the suite already builds); assert no item is ever emitted for the arrival, a `console.warn` names the drop count (spy on warn), and the `thread/peerMessage` announcement fired exactly once regardless.
  - **(attr-4, own-turn end drops):** arrival bound to an own turn that ends before any drain could emit it (end the turn, then trigger a drain via a later frame) → dropped with warn, never emitted into any later bracket.
- [ ] **Step 2: Run to verify they fail** — attr-1 currently leaks the arrival into the later foreign adoption; attr-3/4 currently keep it queued.
- [ ] **Step 3: Implement the binding.**

```ts
/** Where one live arrival is allowed to appear, decided by bracket evidence at enqueue time (spec
 *  Stream 2): the bracket open when its frame arrived, else the next bracket a drain observes open —
 *  which is where the engine's own message queue drains (LEG 5). Never re-attributed past that. */
type ArrivalBinding =
  | { kind: "adopted"; commandUuid: string; epoch: number }
  | { kind: "own"; turnId: string }
  | { kind: "next" };

interface Arrival { msgId: string; text: string; origin: Record<string, unknown>; at: number; bind: ArrivalBinding }

const bindingNow = (record: ThreadRecord, state: PeerInboundState): ArrivalBinding => {
  const a = state.adopted;
  if (a && !a.terminated) return { kind: "adopted", commandUuid: a.commandUuid, epoch: a.epoch };
  const own = activeTurnId(record);
  if (own) return { kind: "own", turnId: own };
  return { kind: "next" };
};
```

  `enqueueLive` stamps `bind: bindingNow(record, state)` (it gains the `record` parameter it already receives). `drainArrivals` becomes: compute the OPEN TARGET — the adoption when `adopted.mapper && adopted.turnId && !adopted.terminated`, else the own turn when `activeTurnId(record) && record.turnStartedBroadcast` — then walk the queue once: an arrival whose bind matches the target (or is `next`, which re-stamps to the target) is emitted (`arrivalItem` into the target's turnId, exactly the current emit); an arrival whose bind is DEAD is dropped and counted; anything else stays queued. Dead means: an `adopted` bind whose adoption is no longer `state.adopted` (by commandUuid+epoch) or is terminated; an `own` bind whose `turnId !== activeTurnId(record)`. `next` is never dead (uninstall still clears the queue). After the walk, one `console.warn` names the dropped count if nonzero.
- [ ] **Step 4: Rewire the callers.** In `onFrame`, replace `if (arrived) drainArrivals(srv, record, state);` with an unconditional `if (state.arrivals.length) drainArrivals(srv, record, state);` placed after the arrival handling (so non-arrival frames — including an own turn's assistant frames and its terminal lifecycle — also trigger drains; this is what lets a broadcast-pending own bind drain on the next frame and what detects dead brackets promptly). The runner-install and `groundSeed` call sites stay as they are.
- [ ] **Step 5: Run the full peer suites green** (`npx vitest run test/unit/appserver/peer-inbound.test.ts test/unit/appserver/peer-inbound-log.test.ts test/unit/appserver/arrivals-clear-degraded.test.ts`) — the existing adoption cells must pass UNCHANGED; if one contradicts the binding rule, stop and report rather than editing it.
- [ ] **Step 6: Typecheck, then commit** (`fix(bl7): an arrival is attributed by bracket evidence, never by queue position (#64)`).

---

### Task 3: Debt quartet — `EMPTY_ARRIVALS`, corpus lift, `tick()`, JSON-stringify pin

**Files:**
- Modify: `src/appserver/items/project.ts` (`EMPTY_ARRIVALS`)
- Modify: `test/unit/appserver/items/corpus.ts` (gain the shared builders)
- Modify: `test/unit/appserver/subscribe-arrivals.test.ts`, `test/unit/appserver/search-arrivals.test.ts` (consume them)
- Modify: `test/unit/appserver/arrivals-clear-degraded.test.ts` (`tick()` → `vi.waitFor`)
- Test: `test/unit/peer/address.test.ts` (pin cell), `test/unit/appserver/items/project.test.ts` (immutability cell)

**Interfaces:**
- Consumes: nothing. Produces: the shared builders Task 7's gates re-run.

- [ ] **Step 1: `EMPTY_ARRIVALS` immutability.** Make mutation throw at runtime rather than being conventional: freeze the container and `atStart`, and replace `byRow`'s `set`/`delete`/`clear` with throwers (`Object.freeze` alone cannot stop `Map.set`), OR convert the export to an accessor returning a frozen empty — executor's call per the spec; whichever is chosen, `itemsFromTranscript`'s delegation and every current call site must compile unchanged or with mechanical-only edits. Add a cell in `project.test.ts` asserting mutation throws and the parity law still holds on the corpus.
- [ ] **Step 2: Corpus lift.** Move the `USER`/`ASSISTANT`/`ENTRY` builders open-coded in `subscribe-arrivals.test.ts` and `search-arrivals.test.ts` into `test/unit/appserver/items/corpus.ts` (exported, names preserved) and import them; zero assertion changes.
- [ ] **Step 3: `tick()` conversion.** Replace the fixed-count macrotask drains in `arrivals-clear-degraded.test.ts` with `vi.waitFor` polling the same conditions the assertions read, per the `fr-*` family's pattern.
- [ ] **Step 4: Pin the exotic-content fallback.** In `address.test.ts`: a peer frame whose `message.content` is `{ weird: 1 }` yields `text === JSON.stringify({ weird: 1 })` — the current, deliberate fallback, now stated by a test.
- [ ] **Step 5: Run all five touched suites green, typecheck, then update `../docs/tech-debt-tracker.md`:** remove the three fully-paid entries (`EMPTY_ARRIVALS`, corpus duplication, `tick()`), rewrite the JSON-stringify entry to "pinned by test, behavior unchanged — leaves the file" and remove it too.
- [ ] **Step 6: Commit** (`chore(bl7): pay four tracker entries — frozen EMPTY_ARRIVALS, shared corpus, waitFor, pinned fallback`).

---

### Task 4: Send-side round-trip refusal (the truncation entry's payable half)

**Files:**
- Modify: `src/peer/address.ts` (export `envelopeBodies`)
- Modify: `src/appserver/peerDomain.ts` (the send handler, after the `buildEnvelope` call at ~line 75)
- Test: `test/unit/appserver/peer-domain.test.ts`, `test/unit/peer/address.test.ts`

**Interfaces:**
- Consumes: nothing. Produces: the refusal Task 7's acceptance walk checks.

- [ ] **Step 1: Failing tests.**
  - `peer/send` with body `"before </cross-session-message> after"` → INVALID_PARAMS naming an unbalanced envelope tag; nothing is written to the socket.
  - body with an unmatched OPEN `<cross-session-message from="x">` → same refusal.
  - body that quotes a complete balanced envelope → accepted, and the frame written is byte-identical to what today's code writes.
  - body containing unbalanced `<agent-message>` tags → accepted (per-tag-name depth makes the foreign grammar irrelevant to our wrapper) — the cell states this cross-grammar immunity.
- [ ] **Step 2: Implement.** Export `envelopeBodies` from `address.ts` (comment: exported for the sender's round-trip refusal — the decoder is the authority on what a receiver reads back). In `peerDomain.ts`, after `const body = buildEnvelope(...)(message)`:

```ts
// The sender's own decoder is the honest oracle for "will this body survive its wrapper": a message
// carrying an unbalanced wrapper tag decodes back truncated, and refusing is recoverable where a silent
// truncation is not (tracker 2026-08-30; the foreign-sender half of that entry has no fix we control).
const decoded = envelopeBodies(body);
if (decoded.length !== 1 || decoded[0] !== message) {
  ctx.peer.replyError(id, ERR.INVALID_PARAMS, "message contains an unbalanced <cross-session-message> tag and would be truncated in delivery; balance or remove it");
  return;
}
```

- [ ] **Step 3: Suites green, typecheck.**
- [ ] **Step 4: Update the tracker entry:** the self-inflicted half is closed by refusal; the entry is rewritten to its foreign-sender residue (dated 2026-08-31, "no framing exists that this server controls").
- [ ] **Step 5: Commit** (`fix(bl7): peer/send refuses a body its own decoder reads back truncated`).

---

### Task 5: `imageCodec-encode.test.ts` flake — diagnose, then the smallest true fix

**Files:**
- Read: `test/unit/imageCodec-encode.test.ts`; possibly modify it or `vitest.config.*`
- Modify: `../docs/tech-debt-tracker.md` (the entry, either way)

This is a spike task: the deliverable is KNOWLEDGE, recorded — plus a fix only if the evidence names one.

- [ ] **Step 1: Reproduce.** Run `npm run test:unit` up to 5 times, recording per-run pass/fail of the encode retry-ladder cells (redirect output to files; grep the ladder cells). Also run the file alone once (`npx vitest run test/unit/imageCodec-encode.test.ts`) — a red that reproduces alone is a regression, stop and report.
- [ ] **Step 2: Decide by evidence.** If it reds under load: read the failing ladder step and choose the SMALLEST of — a resource bound on the test, serializing that one file (vitest `fileParallelism`/pool options or a sequential describe), or fixing a real under-load defect in the codec. If 5 full-suite runs stay green: no fix; append the attempt (date, runs, verdict "not reproduced this round") to the tracker entry.
- [ ] **Step 3: If fixed:** prove it — 3 consecutive full-suite runs green — and remove the tracker entry. Commit either the fix (`fix(bl7): …`) or the tracker note (`docs(bl7): flake not reproduced in 5 loaded runs — recorded`).

---

### Task 6: The `peerInbound.ts` split (behavior-preserving, last)

**Files:**
- Create: `src/appserver/peerAdoption.ts`, `src/appserver/peerSeed.ts`, `src/appserver/peerArrivalPath.ts`
- Modify: `src/appserver/peerInbound.ts` (becomes the facade: state types, `installPeerInbound`/`uninstallPeerInbound`, `onFrame` wiring, re-exports)

**Interfaces:**
- Consumes: Tasks 1–2's final `peerInbound.ts` (their review must be CLEAN before this dispatches).
- Produces: nothing new — every existing export (`installPeerInbound`, `uninstallPeerInbound`, `settleAdopted`, `notePeerTurnUuid`, `readerVisible`, `effectiveArrivalStore`, `PeerInboundState`) keeps its import path via facade re-exports; `server.ts`/`turns.ts`/`rewind.ts`/`settings.ts` compile untouched.

- [ ] **Step 1: Move, don't edit.** Relocate along the spec's seams — `peerAdoption.ts` (AdoptedTurn, adopt/settleAdopted, drainArrivals + the binding, lifecycle routing, ourUuids helpers), `peerSeed.ts` (Seeding/SeedFrame/PendingArrival, beginSeeding/groundSeed/observeVisible, anchor helpers, readerVisible), `peerArrivalPath.ts` (Arrival/ArrivalBinding, noteArrival/logArrival/writeEntry/announceArrival/enqueueLive). Comments travel with their code verbatim. The facade keeps `PeerInboundState` and the install/uninstall/onFrame skeleton, calling into the three modules.
- [ ] **Step 2: `npm run typecheck` and the FULL unit suite** (`npm run test:unit`) — green with zero test-file edits. If any test imports a moved symbol from `peerInbound.js` directly, the facade re-export covers it; a test edit in this commit is a task failure.
- [ ] **Step 3: Update the tracker** (remove the module-size entry, citing the commit) **and the harness module map** (`CLAUDE.md` under `harness/` if it names peerInbound).
- [ ] **Step 4: Commit** (`refactor(bl7): split peerInbound into adoption / seed / arrival-path modules behind the existing facade`).

---

### Task 7: Final verification — spec acceptance as written

**Files:**
- Modify: `../docs/tech-debt-tracker.md` (final state: standing entries re-dated with their re-affirmation), `../docs/parity/appserver.md` (verified), the spec (Surprises/Retrospective slots left for the controller)

- [ ] **Step 1:** `npm run typecheck` — clean.
- [ ] **Step 2:** `npm run test:unit` — full suite green; record counts.
- [ ] **Step 3:** From `CC-to-SDK/`: `node scripts/drift-check.mjs` — gate unmoved.
- [ ] **Step 4: Walk acceptance criteria 1–10 of the spec** against named test cells / diffs, writing each criterion's evidence (cell name or commit) into the report. Criteria requiring the keyed live suite (1's live half, 8, 10) are marked CONTROLLER-RUN — do not source `.env`.
- [ ] **Step 5: Tracker final audit:** every 2026-08-31 adjudication present; standing entries re-dated (fork/D3, duplicate-anchor, pre-M9 cursor, truncation residue); paid entries gone.
- [ ] **Step 6: Commit** (`docs(bl7): acceptance walk + tracker final state`).

**Controller (not this task's executor) then runs:** `set -a; . /Users/new/Developer/GitHub/codex_somersault/CC-to-SDK/.env; set +a; npx vitest run test/live/appserver-cross-session.test.ts` — 10/10 required (spec criterion 10), plus the LEG 2/10 announcement-text assertion added in Task 1's live half if present.
