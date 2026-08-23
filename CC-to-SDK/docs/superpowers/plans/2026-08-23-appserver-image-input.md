# App-server image input Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use doperpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `turn/start` accepts an items array (`text` / `image` data: URL / `localImage` absolute path) and delivers images on both thread origins, closing scorecard gap 11 with its bounds published.

**Architecture:** The spec is `CC-to-SDK/docs/superpowers/specs/2026-08-23-appserver-image-input-design.md` (rev 2) — read it first; on any conflict the spec wins. Staged bottom-up: extract the client staging loop into a shared helper (repairing its pre-write tracking leak), adopt it in the fleet engine, build the item resolver, then widen the app-server schema/queue, then close the scorecard.

**Tech Stack:** TypeScript ESM (imports end `.js`), zod v4, vitest. Dense hand-style, no Prettier — match surrounding code. All commands run from `CC-to-SDK/harness` unless stated.

## Global Constraints

- Canonical ordering is the public contract: ONE text fold (text items concatenated in order), then images in declaration order, then degrade notes appended in image order — identical on both origins.
- Admission and queueing stay synchronous on RAW input; `resolveInputItems` runs only inside the turn's execution slot (`submitRunner`). No await may move before an admission check.
- localImage reads use the one-descriptor bounded pattern (`workspace.ts:80-124`): open `O_RDONLY|O_NONBLOCK`, `fstat` the descriptor, require `isFile()`, chunked read to cap+1, always close. Never `stat`-then-`readFile`.
- Constants: `MAX_INPUT_ITEMS = 64`; `MAX_DATA_URL_CHARS = 240_000`; image count per turn bounded by the host's `MAX_IMAGES_PER_PROMPT` (20, import from `../host/imageStaging.js`); per-image budget `POST_PROCESS_BYTE_BUDGET` and `MAX_DIMENSION` (import from `../tui/clipboardImage.js`); aggregate 5 MiB enforced during conversion, before each read.
- Media type is DERIVED from sniffed bytes (`pngDimensions`/`jpegDimensions`); PNG/JPEG only in v1; anything else degrades.
- Degrade notes use the exact convention `[Image could not be processed: <reason>]` (`session/turnInput.ts`'s existing strings); schema-level violations refuse `-32602`.
- Never touch `sessionIdentity.ts` semantics; never relax an existing assertion; `git add` only files you touched; NO Co-Authored-By trailers.

---

### Task 1: Extract the staging loop into `client/stagedSubmit.ts`, repairing the pre-write tracking leak

**Files:**
- Create: `src/client/stagedSubmit.ts`
- Modify: `src/client/chatAdapter.ts` (the `submit` image branch, ~lines 120–190)
- Test: `test/unit/client-chat-adapter.test.ts` (new rows), `test/unit/stageImage.test.ts` + `test/integration/host-image-transport.test.ts` (must stay green, untouched)

**Interfaces:**
- Consumes: `UserContentBlock` (`../session/turnInput.js`), `pngDimensions`/`jpegDimensions` (`../tui/clipboardImage.js`), `MAX_IMAGES_PER_PROMPT` (`../host/imageStaging.js`), `IMAGE_VERSION_SKEW_NOTICE` (move it here from chatAdapter, re-export from chatAdapter if anything imports it — check with grep first).
- Produces (Task 2 relies on these exact names):

```ts
export interface StagedSubmitOps {
  stageImageOp(d: { mediaType: string; dimensions: { width: number; height: number }; size: number; sha256: string }): Promise<{ ok: boolean; path?: string; error?: string }>;
}
/** Stage every image block of `prompt`; fold text. Throws on stage-op/write failure AFTER cleaning its
 *  own staged files. On success the CALLER owns `cleanup` until the host accepts the prompt. */
export async function stageBlocks(prompt: UserContentBlock[], ops: StagedSubmitOps): Promise<{
  text: string; images: { stagedId: string; sha256: string }[]; cleanup: () => Promise<void>;
}>
```

- [ ] **Step 1: Write the failing tests** — in `test/unit/client-chat-adapter.test.ts`, add a `describe("stagedSubmit")` block importing `stageBlocks` from `../../src/client/stagedSubmit.js` with a fake `StagedSubmitOps` recording calls and a temp dir for minted paths. Rows: (a) happy path: two text + two image blocks → `text` is the fold, two stage calls, two claims, files contain the decoded bytes; (b) **the leak repair**: `ops.stageImageOp` succeeds minting a real temp file, but the write fails (mint the path inside a directory made read-only after mint, or point the mint at a path whose parent is then removed) → `stageBlocks` rejects AND the minted file is gone; (c) middle-image failure cleans the FIRST image's staged file too; (d) unknown-op error message maps to the version-skew notice; (e) >20 image blocks: excess degrade into the fold text without any stage call.
- [ ] **Step 2: Run to verify failure** — `npx vitest run test/unit/client-chat-adapter.test.ts` → FAIL (module not found).
- [ ] **Step 3: Create `stagedSubmit.ts`** by MOVING the loop from `chatAdapter.ts` (~lines 129–188): the text fold, the `MAX_IMAGES_PER_PROMPT` gate, header-sniff degrade, sha256, `stageImageOp`, write, claims — preserving every comment. Two changes only: (1) `stagedPaths.push(stageReply.path)` moves to IMMEDIATELY after the `stageReply.ok` check, BEFORE `writeFile` (the repair — note it in a comment citing the spec's rev-2 finding); (2) `turnSink = undefined` lines stay in chatAdapter (caller bookkeeping, not staging).
- [ ] **Step 4: Rewire `chatAdapter.submit`** to call `stageBlocks(prompt, { stageImageOp: (d) => r.stageImageOp(d) })`, keeping its own try/catch that resets `turnSink` and invokes the returned `cleanup` on the failure paths it already covers (version-skew throw, busy refusal, prompt not-ok, socket death). After `r.prompt(...)` returns `ok:true`, drop `cleanup` without calling it.
- [ ] **Step 5: Run** `npx vitest run test/unit/client-chat-adapter.test.ts test/unit/stageImage.test.ts test/integration/host-image-transport.test.ts` → ALL PASS, and `npm run typecheck` → clean.
- [ ] **Step 6: Commit** `git add src/client/stagedSubmit.ts src/client/chatAdapter.ts test/unit/client-chat-adapter.test.ts && git commit -m "refactor(client): extract the staging loop into stagedSubmit — one named repair: minted paths tracked before the write"`

### Task 2: `fleetEngine.submit` takes `UserTurnInput` and stages through the helper

**Files:**
- Modify: `src/appserver/fleetEngine.ts` (interface ~line 126, impl ~line 321)
- Test: `test/unit/appserver/fleet-engine.test.ts` (new rows)

**Interfaces:**
- Consumes: `stageBlocks`/`StagedSubmitOps` (Task 1), `UserTurnInput` (`../session/turnInput.js`).
- Produces: `submit(prompt: UserTurnInput, onMessage, opts?)` on both the `EngineSession`-facing interface (line ~126) and the impl — Task 4's `submitRunner` calls this with a block array.

- [ ] **Step 1: Write the failing tests** — in `test/unit/appserver/fleet-engine.test.ts` (follow its existing fake-socket harness): (a) `submit` with a block array (one text + one image) sends `stageImage` then `prompt` with `text` = fold and one `images` claim, and the staged file holds the bytes; (b) an "unknown op" stage reply rejects the submit with the version-skew notice and no `prompt` op is sent; (c) a plain-string submit sends `prompt` with no `images` key (unchanged wire for old callers).
- [ ] **Step 2: Run to verify failure** — `npx vitest run test/unit/appserver/fleet-engine.test.ts` → the new rows FAIL (submit rejects arrays / type error).
- [ ] **Step 3: Widen** the interface + impl signature to `prompt: UserTurnInput`. In the impl, before the existing sendOp: `if (typeof prompt !== "string") { const staged = await stageBlocks(prompt, { stageImageOp: (d) => this.sendOp({ op: "stageImage", ...d }) }); ... }` — send `{ op: "prompt", text: staged.text, ...(images.length ? { images } : {}), ...(uuid...) }`; on the busy refusal / sendOp-throw paths that already exist, `await staged.cleanup()` first (mirror chatAdapter's ownership rule: cleanup until the host's `ok`). String prompts take the exact existing path.
- [ ] **Step 4: Run** `npx vitest run test/unit/appserver/fleet-engine.test.ts` → PASS; `npm run typecheck` → clean (this proves no OTHER `EngineSession` implementor breaks — if one does, widen ITS signature to accept `UserTurnInput` by flattening via `flattenForDisplay` only if it is a test fake; report a real production implementor as a concern).
- [ ] **Step 5: Commit** `git add src/appserver/fleetEngine.ts test/unit/appserver/fleet-engine.test.ts && git commit -m "feat(appserver): fleet engine submits block arrays through the staging helper"`

### Task 3: `appserver/turnItems.ts` — the item resolver

**Files:**
- Create: `src/appserver/turnItems.ts`
- Test: `test/unit/turn-items.test.ts` (create)

**Interfaces:**
- Consumes: `assembleUserContent`, `UserTurnInput` (`../session/turnInput.js`); `pngDimensions`, `jpegDimensions`, `POST_PROCESS_BYTE_BUDGET` (`../tui/clipboardImage.js`); `MAX_IMAGES_PER_PROMPT` (`../host/imageStaging.js`); `node:fs/promises` `open` + `constants`.
- Produces (Task 4 relies on these exact names):

```ts
export const MAX_INPUT_ITEMS = 64;
export const MAX_DATA_URL_CHARS = 240_000;
export type InputItem =
  | { type: "text"; text: string }
  | { type: "image"; url: string }
  | { type: "localImage"; path: string };
/** Canonical ordering: one text fold, images in declaration order, degrade notes appended. */
export async function resolveInputItems(items: InputItem[]): Promise<UserTurnInput>
```

- [ ] **Step 1: Write the failing tests** (`test/unit/turn-items.test.ts`): (a) fold+order: `[text A, image P1, text B, image P2]` (two tiny valid PNGs as data: URLs) → blocks `[{text:"AB"}, P1, P2]`; (b) sniffed media type: a valid PNG declared `data:application/pdf;base64,…` → the block's `media_type` is `"image/png"`; (c) malformed base64 → fold gains `[Image could not be processed: unreadable image data]` appended AFTER images; (d) localImage happy path from a temp file; (e) localImage FIFO (`mkfifoSync` via `child_process spawnSync mkfifo`; skip row on win32) resolves to a degrade note, promptly — assert wall-clock under 2s; (f) a temp file larger than `POST_PROCESS_BYTE_BUDGET` degrades WITHOUT the resolver ever holding >cap+chunk bytes (assert via reason text; the bounded-read code shape is reviewed, not instrumented); (g) 21 images: the 21st degrades with no read (fake path that would throw if opened); (h) aggregate: images summing past 5 MiB degrade the crossing image.
- [ ] **Step 2: Run to verify failure** — `npx vitest run test/unit/turn-items.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement** `resolveInputItems`: walk items; collect text fold + image sources `{data, mediaType}` + notes. For `image`: parse `data:[<mediatype>][;base64],<data>` (refuse-degrade non-base64); decode; sniff (`pngDimensions(buf) ?? jpegDimensions(buf)`); derive mediaType `image/png`/`image/jpeg` from WHICH sniffer matched; unknown → degrade. For `localImage`: the bounded one-descriptor read — copy the `workspace.ts:80-124` shape (open `O_RDONLY | (constants.O_NONBLOCK ?? 0)`, `fh.stat()`, `isFile()` guard, fstat-size fast refusal, 64 KiB chunks to `POST_PROCESS_BYTE_BUDGET + 1`, `finally fh.close()`), each failure a degrade note naming the client's path. Enforce the count gate before any I/O and the running aggregate before each read. Return `assembleUserContent(fold, images)` with notes appended to the fold's END as text (one string concat: `fold + notes.join("")` placed as the LAST text — simplest: append notes to the single text block after assembly, or pass `fold + notes` if no image succeeded).
    NOTE the canonical position: notes go AFTER images. `assembleUserContent` puts one text block first; append a SECOND text block `{type:"text", text: notes.join("")}` after the image blocks when notes exist — `normalizeTurnInput` passes text blocks through untouched, and `flattenForDisplay` joins them.
- [ ] **Step 4: Run** `npx vitest run test/unit/turn-items.test.ts` → PASS; `npm run typecheck` → clean.
- [ ] **Step 5: Commit** `git add src/appserver/turnItems.ts test/unit/turn-items.test.ts && git commit -m "feat(appserver): turn-input item resolver — bounded reads, sniffed media, canonical ordering"`

### Task 4: Widen the wire — schema, submitRunner, fleetTurnStart, queue

**Files:**
- Modify: `src/appserver/schema/turns.ts` (`turnStartParams`), `src/appserver/turns.ts` (`submitRunner` ~306, `fleetTurnStart` ~335, drain ~148, `turnStart` ~428), `src/appserver/queue.ts` (`QueuedTurn`, `enqueueTurn`)
- Test: `test/unit/appserver/turns.test.ts` (new rows), `test/unit/appserver/queue.test.ts` if it exists (byte boundary)

**Interfaces:**
- Consumes: `resolveInputItems`/`InputItem`/`MAX_INPUT_ITEMS`/`MAX_DATA_URL_CHARS` (Task 3), `flattenForDisplay` (`../session/turnInput.js`), Task 2's widened `submit`.
- Produces: the public wire of the spec's "Wire design" section, verbatim.

- [ ] **Step 1: Write the failing tests** in `test/unit/appserver/turns.test.ts` (its real-wire harness): (a) items array reaches a fake engine as blocks in canonical order (fake engine records its `submit` first arg); (b) the interleave mixed-success row (`text A, bad image, text B, good image` → fold "AB", good image, note appended); (c) refusals, each `-32602`: `https://` url, data: URL over `MAX_DATA_URL_CHARS`, relative `localImage` path, empty array, 65 items; (d) 21st image degrades with no I/O; (e) `queue:true` on a busy thread stores RAW items and the drained turn's engine-submitted blocks are deep-equal to a direct start's; (f) queue byte boundary: an items array whose `JSON.stringify` length lands exactly at the remaining cap enqueues, one byte over refuses with the bytes reason; (g) the user item and live echo show `[Image #1]` via `flattenForDisplay`; (h) legacy skew: `z.string()`-only params (import yesterday's schema shape inline in the test) refuses today's array — proving an old server can never silently submit.
- [ ] **Step 2: Run to verify failure** — `npx vitest run test/unit/appserver/turns.test.ts` → new rows FAIL.
- [ ] **Step 3: Schema** — in `schema/turns.ts` add the `inputItem` discriminated union and widen `input` exactly as the spec's "Wire design" block (import `isAbsolute` from `node:path`, constants from `../turnItems.js`). Add a compile-time bridge in `turnItems.ts` or the schema file: `type _SchemaMatches = z.infer<typeof inputItem> extends InputItem ? true : never;` so the zod shape and the resolver type cannot drift.
- [ ] **Step 4: turns.ts** — `submitRunner(srv, record, input: string | InputItem[])`: inside the runner (already async), `const resolved = typeof input === "string" ? input : await resolveInputItems(input);` then existing flow with `resolved` (echo via `flattenForDisplay(resolved)`). `fleetTurnStart` same widening — resolve in ITS slot then `engine.submit(resolved, ...)`. The drain call site and `enqueueTurn` store RAW input. `queue.ts`: `QueuedTurn.input: string | InputItem[]`; byte counting `Buffer.byteLength(typeof input === "string" ? input : JSON.stringify(input), "utf8")`. Import type only — no behavior import into queue.ts.
- [ ] **Step 5: Run** `npx vitest run test/unit/appserver/turns.test.ts` then the full `npx vitest run test/unit/appserver` → ALL PASS; `npm run typecheck` → clean.
- [ ] **Step 6: Commit** `git add src/appserver/schema/turns.ts src/appserver/turns.ts src/appserver/queue.ts test/unit/appserver/turns.test.ts && git commit -m "feat(appserver): turn/start input items — raw admission, in-slot resolution, canonical delivery"`

### Task 5: Scorecard closure, live test, final verification

**Files:**
- Modify: `docs/parity/appserver.md` (repo-relative: `CC-to-SDK/docs/parity/appserver.md`), the spec's living tail
- Create: `test/live/appserver-image-input.test.ts`

- [ ] **Step 1: Scorecard** — per the spec's "Scorecard closure" section: `turn/start` row notes the input union and the published remote bound; `stageImage` row `unscored → N/A` with the decision text; gap 11 closes citing the spec; the per-landing sweep paragraph restates (rows stay 100; `unparsed` drops to 0).
- [ ] **Step 2: Gate** — from `CC-to-SDK`: `node scripts/drift-check.mjs` → exit 0, `unparsed 0`. If red, the scorecard edit is wrong — fix the scorecard, NEVER the gate.
- [ ] **Step 3: Live test** — `test/live/appserver-image-input.test.ts` gated on the standard env keys (copy a `test/live/` neighbor's `describe.skip` pattern): boot an inProcess thread through the real wire, send a small PNG data: URL items turn, assert the reply text mentions the image's content (a 2-color test card). Run it KEYLESS now → clean skip. Mark in the test header: quota-gated, first keyed run after 2026-08-26 1pm.
- [ ] **Step 4: Full acceptance sweep** — run the spec's keyless acceptance verbatim, rows 1–7 (the spec's Acceptance section lists the exact commands; row 5's legacy fixtures live in Task 4's tests and Task 2's old-host row). All green.
- [ ] **Step 5: Spec retro** — replace the spec's `## Outcomes & Retrospective` Pending line per doperpowers:execspec; note anything Surprises-worthy found during execution.
- [ ] **Step 6: Commit** `git add -u CC-to-SDK/docs && git add test/live/appserver-image-input.test.ts && git commit -m "feat(images): scorecard closure + quota-gated live acceptance — gap 11 closed with bounds published"` (adjust paths to what actually changed; never `git add -A`).
