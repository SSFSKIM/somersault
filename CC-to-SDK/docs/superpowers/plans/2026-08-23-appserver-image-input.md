# App-server image input Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use doperpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `turn/start` accepts an items array (`text` / `image` data: URL / `localImage` absolute path) and delivers images on both thread origins, closing scorecard gap 11 with its bounds published.

**Architecture:** The spec is `CC-to-SDK/docs/superpowers/specs/2026-08-23-appserver-image-input-design.md` (rev 3) — read it first; on any conflict the spec wins. Staged bottom-up: extract the client staging loop into a shared helper (repairing its pre-write tracking leak), adopt it in the fleet engine behind a synchronous reservation, build the item resolver that owns the FULL cap suite, then widen the app-server schema/queue/engine contract with post-resolution latch re-checks, then regenerate the published schema and close the scorecard. **Plan rev 2** — the plan review's eight findings are folded in (fleet ordering, submit reservation, latch re-checks, `registry.ts` + `turnInput.test.ts:279`, `emit-schema`, `MAX_DIMENSION` + strict base64, discriminating cleanup tests, real type assertion).

**Tech Stack:** TypeScript ESM (imports end `.js`), zod v4, vitest. Dense hand-style, no Prettier — match surrounding code. All commands run from `CC-to-SDK/harness` unless stated.

## Global Constraints

- Canonical ordering is the public contract (spec rev 3): ONE text block = text fold + degrade notes appended to its end (notes in image order), THEN surviving images in declaration order. Identical on both origins — this is the shape the host wire already produces.
- **The resolver enforces the FULL image cap suite** — strict base64 (alphabet/padding), sniffed-bytes media type, `MAX_DIMENSION`, per-image `POST_PROCESS_BYTE_BUDGET`, 5 MiB running aggregate — so `normalizeTurnInput` finds nothing to degrade in place (an in-place replacement would split the canonical text block and diverge the origins).
- Admission and queueing stay synchronous on RAW input; `resolveInputItems` runs only inside the turn's execution slot; **after the resolution await, the closing/interrupt latches are re-checked before any engine submit** (both origins).
- localImage reads use the one-descriptor bounded pattern (`workspace.ts:80-124`): open `O_RDONLY | (constants.O_NONBLOCK ?? 0)`, `fstat` the descriptor, require `isFile()`, fstat-size fast refusal, 64 KiB chunks to cap+1, `finally` close. Never `stat`-then-`readFile`.
- Constants: `MAX_INPUT_ITEMS = 64`; `MAX_DATA_URL_CHARS = 240_000`; image count ≤ `MAX_IMAGES_PER_PROMPT` (20, from `../host/imageStaging.js`) gated before any I/O; `POST_PROCESS_BYTE_BUDGET`/`MAX_DIMENSION` from `../tui/clipboardImage.js`.
- Degrade notes use the exact convention `[Image could not be processed: <reason>]`; schema-level violations refuse `-32602`.
- Never touch `sessionIdentity.ts` semantics; never relax an existing assertion; `git add` only files you touched; NO Co-Authored-By trailers.

---

### Task 1: Extract the staging loop into `client/stagedSubmit.ts`, repairing the pre-write tracking leak

**Files:**
- Create: `src/client/stagedSubmit.ts`
- Modify: `src/client/chatAdapter.ts` (the `submit` image branch, ~lines 120–190)
- Test: `test/unit/client-chat-adapter.test.ts` (new rows), `test/unit/stageImage.test.ts` + `test/integration/host-image-transport.test.ts` (must stay green, untouched)

**Interfaces:**
- Consumes: `UserContentBlock` (`../session/turnInput.js`), `pngDimensions`/`jpegDimensions` (`../tui/clipboardImage.js`), `MAX_IMAGES_PER_PROMPT` (`../host/imageStaging.js`), the version-skew notice (move `IMAGE_VERSION_SKEW_NOTICE` here; grep for importers first and re-export from `chatAdapter.ts` if any exist).
- Produces (Task 2 relies on these exact names):

```ts
export interface StagedSubmitOps {
  stageImageOp(d: { mediaType: string; dimensions: { width: number; height: number }; size: number; sha256: string }): Promise<{ ok: boolean; path?: string; error?: string }>;
}
/** Stage every image block of `prompt`; fold text (notes into the fold, per the canonical contract).
 *  Throws on stage-op/write failure AFTER cleaning its own staged files. On success the CALLER owns
 *  `cleanup` until the host accepts the prompt. */
export async function stageBlocks(prompt: UserContentBlock[], ops: StagedSubmitOps): Promise<{
  text: string; images: { stagedId: string; sha256: string }[]; cleanup: () => Promise<void>;
}>
```

- [ ] **Step 1: Write the failing tests** — in `test/unit/client-chat-adapter.test.ts`, a `describe("stagedSubmit")` block with a fake `StagedSubmitOps` that mints REAL temp files. Rows: (a) happy path: two text + two image blocks → `text` is the fold, two stage calls, two claims, staged files hold the decoded bytes; (b) **the leak repair, discriminating**: the fake mints a real file then `chmodSync(path, 0o400)` so the subsequent `writeFile` fails EACCES — assert `stageBlocks` rejects AND the minted read-only file has been removed by its own cleanup (chmod back inside the fake's cleanup observer if needed; on win32 skip the row); (c) a MIDDLE image's write failure also removes the FIRST image's staged file; (d) an `"unknown op"` stage error maps to the version-skew notice; (e) >20 image blocks: excess degrade into the fold text without any stage call.
- [ ] **Step 2: Run to verify failure** — `npx vitest run test/unit/client-chat-adapter.test.ts` → FAIL (module not found).
- [ ] **Step 3: Create `stagedSubmit.ts`** by MOVING the loop from `chatAdapter.ts` (~lines 129–188) — the text fold, the `MAX_IMAGES_PER_PROMPT` gate, header-sniff degrade, sha256, `stageImageOp`, write, claims — preserving every comment. Two changes only: (1) `stagedPaths.push(stageReply.path)` moves to IMMEDIATELY after the `stageReply.ok` check, BEFORE `writeFile` (the repair; comment cites spec rev 2 finding 9); (2) the `turnSink = undefined` lines stay in `chatAdapter` (caller bookkeeping, not staging).
- [ ] **Step 4: Rewire `chatAdapter.submit`** to `stageBlocks(prompt, { stageImageOp: (d) => r.stageImageOp(d) })`, keeping its own try/catch that resets `turnSink` and awaits the returned `cleanup` on every failure path it already covers (version-skew throw, busy refusal, prompt not-ok, socket death). After `r.prompt(...)` returns `ok:true`, drop `cleanup` uncalled.
- [ ] **Step 5: Run** `npx vitest run test/unit/client-chat-adapter.test.ts test/unit/stageImage.test.ts test/integration/host-image-transport.test.ts` → ALL PASS; `npm run typecheck` → clean.
- [ ] **Step 6: Commit** `git add src/client/stagedSubmit.ts src/client/chatAdapter.ts test/unit/client-chat-adapter.test.ts && git commit -m "refactor(client): extract the staging loop into stagedSubmit — minted paths tracked before the write"`

### Task 2: The engine contract widens; `fleetEngine.submit` stages through the helper behind a synchronous reservation

**Files:**
- Modify: `src/appserver/registry.ts` (the shared `EngineSession.submit` contract, ~line 34), `src/appserver/fleetEngine.ts` (interface ~line 126, impl ~line 321)
- Test: `test/unit/appserver/fleet-engine.test.ts` (new rows)

**Interfaces:**
- Consumes: `stageBlocks`/`StagedSubmitOps` (Task 1), `UserTurnInput` (`../session/turnInput.js`).
- Produces: `submit(prompt: UserTurnInput, …)` on `EngineSession` (registry.ts) AND fleetEngine — Task 4's `submitRunner` depends on the SHARED contract being widened here, not just fleetEngine's.

- [ ] **Step 1: Write the failing tests** in `test/unit/appserver/fleet-engine.test.ts` (its fake-socket harness): (a) block-array submit sends `stageImage` then `prompt` with `text` = fold and one claim; the staged file holds the bytes; (b) an `"unknown op"` stage reply rejects with the version-skew notice, NO `prompt` op sent, and the staged files are gone; (c) **busy-refusal cleanup**: host replies busy to `prompt` → staged files are gone; (d) **socket-death cleanup**: connection dies between stage and prompt → staged files are gone; (e) **the reservation**: hold the fake's `stageImage` reply open, issue a SECOND array submit → it throws the one-in-flight error synchronously (never reaches the fake), then release the first; (f) a plain-string submit sends `prompt` with no `images` key (byte-identical wire for old callers).
- [ ] **Step 2: Run to verify failure** — `npx vitest run test/unit/appserver/fleet-engine.test.ts` → new rows FAIL.
- [ ] **Step 3: Widen `registry.ts`'s `EngineSession.submit`** to `prompt: UserTurnInput` (import the type with `import type`). Widen fleetEngine's interface + impl. In the impl, FIRST take the reservation synchronously: reuse the existing guard but set a `submitInFlight = true` flag (or set `turnSink` to a placeholder) BEFORE any await, cleared on every terminal path (success, throw, busy, death) — the current guard checks `turnSink || waiter`, both set only after awaits, which two concurrent array submits would both pass (plan-review finding 3). Then for arrays: `const staged = await stageBlocks(prompt, { stageImageOp: (d) => this.sendOp({ op: "stageImage", ...d }) })`; send `{ op: "prompt", text: staged.text, ...(staged.images.length ? { images: staged.images } : {}), ...(opts?.uuid ? { uuid: opts.uuid } : {}) }`; `await staged.cleanup()` on the busy-refusal and sendOp-throw paths before rethrowing/settling (ownership transfers to the host only on `ok:true`). String prompts take the exact existing path.
- [ ] **Step 4: Run** `npx vitest run test/unit/appserver/fleet-engine.test.ts` → PASS; `npm run typecheck` → EXPECT it red in `test/unit/turnInput.test.ts` (the line ~279 `@ts-expect-error` scope pin "the appserver turn/start schema's input stays string-only" is NOT yet unused — the schema widens in Task 4, so if typecheck is red HERE, stop and re-read; it should still be green because the schema is untouched). If any OTHER `EngineSession` implementor breaks on the widened contract, fix a test fake by widening its signature; report a production implementor as a concern.
- [ ] **Step 5: Commit** `git add src/appserver/registry.ts src/appserver/fleetEngine.ts test/unit/appserver/fleet-engine.test.ts && git commit -m "feat(appserver): EngineSession takes UserTurnInput; fleet engine stages arrays behind a synchronous reservation"`

### Task 3: `appserver/turnItems.ts` — the item resolver, owning the full cap suite

**Files:**
- Create: `src/appserver/turnItems.ts`
- Test: `test/unit/turn-items.test.ts` (create)

**Interfaces:**
- Consumes: `assembleUserContent`, `UserTurnInput` (`../session/turnInput.js`); `pngDimensions`, `jpegDimensions`, `MAX_DIMENSION`, `POST_PROCESS_BYTE_BUDGET` (`../tui/clipboardImage.js`); `MAX_IMAGES_PER_PROMPT` (`../host/imageStaging.js`); `node:fs/promises` `open`; `node:fs` `constants`.
- Produces (Task 4 relies on these exact names):

```ts
export const MAX_INPUT_ITEMS = 64;
export const MAX_DATA_URL_CHARS = 240_000;
export type InputItem =
  | { type: "text"; text: string }
  | { type: "image"; url: string }
  | { type: "localImage"; path: string };
/** Canonical contract (spec rev 3): ONE text block = fold + notes, then surviving images in order. */
export async function resolveInputItems(items: InputItem[]): Promise<UserTurnInput>
```

- [ ] **Step 1: Write the failing tests** (`test/unit/turn-items.test.ts`): (a) fold+order: `[text A, image P1, text B, image P2]` (tiny valid PNG data: URLs) → exactly `[{type:"text",text:"AB"}, P1, P2]`; (b) sniffed media type: a valid PNG declared `data:application/pdf;base64,…` → block `media_type === "image/png"`; (c) mixed success: `[text A, badImage, text B, goodImage]` → `[{text:"AB[Image could not be processed: unreadable image data]"}, goodImage]` — the note INSIDE the single text block, images after it; (d) **strict base64**: a data: URL whose payload has an illegal character or bad padding degrades even if `Buffer.from` would silently produce valid PNG bytes; (e) **MAX_DIMENSION**: a valid PNG whose IHDR declares dimensions over the cap degrades (build the buffer by patching a tiny PNG's IHDR bytes — no giant file needed); (f) localImage happy path from a temp file; (g) localImage FIFO (`spawnSync("mkfifo", …)`, skip on win32) degrades promptly — wall-clock under 2s; (h) a temp file over `POST_PROCESS_BYTE_BUDGET` degrades with the budget reason; (i) a 21st image degrades with no I/O (a path that would throw if opened); (j) aggregate: images summing past 5 MiB degrade the crossing image; (k) all-images-failed: result is the fold+notes STRING (or one-text-block array — pick one, assert it, and keep `flattenForDisplay` sane).
- [ ] **Step 2: Run to verify failure** — `npx vitest run test/unit/turn-items.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement.** Walk items; fold text; for each image source produce either `{data, mediaType}` or a note. `image`: split on the first comma; require `;base64` marker; validate the payload against `/^[A-Za-z0-9+/]*={0,2}$/` and length ≡ 0 (mod 4) BEFORE `Buffer.from` (finding 6's permissive-decode); decode; sniff `pngDimensions(buf) ?? jpegDimensions(buf)`; derive `mediaType` from WHICH sniffer matched (`image/png` / `image/jpeg`); enforce `MAX_DIMENSION` and `POST_PROCESS_BYTE_BUDGET` and the running 5 MiB aggregate — every failure a note. `localImage`: the bounded one-descriptor read per the Global Constraint, cap `POST_PROCESS_BYTE_BUDGET + 1`; then the SAME sniff/dimension/aggregate suite as `image`. Count gate (>20) before any I/O. Assemble: `assembleUserContent(fold + notes.join(""), images)`; if no image survived and notes exist, return the same single-text-block array (consistent shape, row (k) pins it).
- [ ] **Step 4: Run** `npx vitest run test/unit/turn-items.test.ts` → PASS; `npm run typecheck` → clean.
- [ ] **Step 5: Commit** `git add src/appserver/turnItems.ts test/unit/turn-items.test.ts && git commit -m "feat(appserver): turn-input item resolver — full cap suite, bounded reads, canonical fold"`

### Task 4: Widen the wire — schema, submitRunner, fleetTurnStart, queue, published schema artifact

**Files:**
- Modify: `src/appserver/schema/turns.ts` (`turnStartParams`), `src/appserver/turns.ts` (`submitRunner` ~306, `fleetTurnStart` ~335, drain ~148, `turnStart` ~428), `src/appserver/queue.ts` (`QueuedTurn`, `enqueueTurn`), `test/unit/turnInput.test.ts` (~line 279: the `@ts-expect-error` scope pin), `schema/json/stable/appserver.json` (+ `schema/json/experimental/appserver.json` if `emit-schema` regenerates both)
- Test: `test/unit/appserver/turns.test.ts` (new rows)

**Interfaces:**
- Consumes: `resolveInputItems`/`InputItem`/`MAX_INPUT_ITEMS`/`MAX_DATA_URL_CHARS` (Task 3), `flattenForDisplay` (`../session/turnInput.js`), Task 2's widened contract.
- Produces: the spec's "Wire design" section, verbatim, plus the regenerated published schema.

- [ ] **Step 1: Write the failing tests** in `test/unit/appserver/turns.test.ts` (real-wire harness): (a) items reach a fake engine as canonical blocks; (b) the mixed-success interleave row (fold+note in ONE text block, then the good image); (c) refusals, each `-32602`: `https://` url, over-`MAX_DATA_URL_CHARS` data: URL, relative `localImage` path, empty array, 65 items; (d) 21st image degrades with no I/O; (e) queued items turn: raw storage, drained blocks deep-equal a direct start's; (f) queue byte boundary: array JSON length exactly at remaining cap enqueues, +1 refuses with the bytes reason; (g) user item + live echo show `[Image #1]`; (h) legacy skew: a string-only zod shape (inline in the test) refuses today's array — an old server can never silently submit; (i) **post-resolution latch races, both origins**: with a resolver-delaying input (a localImage FIFO fixture or a slow fake via DI if the harness injects the resolver — if no seam exists, drive it with a real slow read), interrupt the thread mid-resolution → NO engine submit happens; close the thread mid-resolution → NO submit, no crash.
- [ ] **Step 2: Run to verify failure** — new rows FAIL.
- [ ] **Step 3: Schema** — add the `inputItem` union + widened `input` exactly as the spec's Wire design block (`isAbsolute` from `node:path`, constants from `../turnItems.js`; put the absolute-path rule in the item's `.describe(...)` so the PUBLISHED schema documents what the refine cannot emit). Replace the plan-rev-1 `_SchemaMatches` idea with a real assertion in `turnItems.ts` or the schema file:
  `type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;`
  `const _inputItemMatches: Equal<z.infer<typeof inputItem>, InputItem> = true;`
- [ ] **Step 4: turns.ts + queue.ts** — `submitRunner(srv, record, input: string | InputItem[])`: in-slot `const resolved = typeof input === "string" ? input : await resolveInputItems(input);` **then re-check the runner's closing/interrupt latches** (mirror how the surrounding code guards after its other awaits — find the latch names in `beginTurn`/`turns.ts` and re-check the same ones; a stale-latch submit is plan-review finding 2) before `record.session.submit(resolved, …)`; echoes via `flattenForDisplay(resolved)`. `fleetTurnStart`: same widening, resolve in ITS slot, re-check ITS latches, then `engine.submit(resolved, …)`. Drain + `enqueueTurn` store RAW input; `QueuedTurn.input: string | InputItem[]` (type-only import); byte counting `Buffer.byteLength(typeof input === "string" ? input : JSON.stringify(input), "utf8")`.
- [ ] **Step 5: The scope pin** — `test/unit/turnInput.test.ts` ~279: the `@ts-expect-error` "appserver turn/start input stays string-only" becomes unused (typecheck fails on unused expect-error). Replace it with the POSITIVE pin (the items array now parses), keeping lines ~269/273 (harness.run / daemon submit stay string-only) untouched.
- [ ] **Step 6: Published schema** — `npm run emit-schema`; commit the regenerated `schema/json/stable/appserver.json` (and experimental twin if emitted). If the suite byte-compares the artifact, it goes green BECAUSE of this step; if `emit-schema` does not touch `turn/start.input`, say so in the task report rather than forcing an edit.
- [ ] **Step 7: Run** `npx vitest run test/unit/appserver/turns.test.ts`, then `npx vitest run test/unit/appserver`, then `npx vitest run test/unit/turnInput.test.ts` → ALL PASS; `npm run typecheck` → clean.
- [ ] **Step 8: Commit** `git add src/appserver/schema/turns.ts src/appserver/turns.ts src/appserver/queue.ts test/unit/appserver/turns.test.ts test/unit/turnInput.test.ts schema/json && git commit -m "feat(appserver): turn/start input items — raw admission, in-slot resolution, latch re-checks, published schema"`

### Task 5: Scorecard closure, live test, final verification

**Files:**
- Modify: `CC-to-SDK/docs/parity/appserver.md`, the spec's living tail
- Create: `test/live/appserver-image-input.test.ts`

- [ ] **Step 1: Scorecard** — per the spec's "Scorecard closure" section: `turn/start` row notes the input union + the published remote bound; `stageImage` row `unscored → N/A` with the decision text; gap 11 closes citing the spec; the per-landing sweep restates (100 rows, `unparsed 0`).
- [ ] **Step 2: Gate** — from `CC-to-SDK`: `node scripts/drift-check.mjs` → exit 0, `unparsed 0`. If red, fix the scorecard, NEVER the gate.
- [ ] **Step 3: Live test** — `test/live/appserver-image-input.test.ts`, standard key-gated describe (copy a `test/live/` neighbor's pattern): boot an inProcess thread through the real wire, send a small 2-color PNG data: URL items turn, assert the reply references the image content. Run keyless now → clean skip. Header: quota-gated, first keyed run after 2026-08-26 1pm.
- [ ] **Step 4: Full acceptance sweep** — run the spec's keyless Acceptance rows 1–7 verbatim (the spec lists exact commands). All green.
- [ ] **Step 5: Spec retro** — replace `## Outcomes & Retrospective`'s Pending line (doperpowers:execspec); add Surprises found during execution.
- [ ] **Step 6: Commit** `git add CC-to-SDK/docs/parity/appserver.md CC-to-SDK/docs/superpowers/specs/2026-08-23-appserver-image-input-design.md test/live/appserver-image-input.test.ts && git commit -m "feat(images): scorecard closure + quota-gated live acceptance — gap 11 closed with bounds published"` (paths as actually changed; never `git add -A`).
