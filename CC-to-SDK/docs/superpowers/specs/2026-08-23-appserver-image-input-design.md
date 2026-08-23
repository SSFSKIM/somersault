# App-server image input — turn-input items (closing scorecard gap 11)

**Date:** 2026-08-23 · **Owner approval:** design A of the product-trio presentation, approved verbatim.
**Grounding:** `docs/superpowers/grounding/2026-08-23-product-trio-ground.md` §1.
**Rev 2** after the adversarial spec review (nine findings, all accepted — Revision Notes).

## Purpose

A fleet-origin app-server thread cannot send an image at all today — the app-server names no image
surface (scorecard gap 11), while the engine layer underneath it has accepted validated base64 image
blocks since F9 and the host wire has a negotiated staging protocol. This round gives `turn/start` an
input-items form mirroring Codex's `UserInput` list, delivers images over BOTH thread origins using
existing, tested parts, and closes gap 11 with the decision — and its measured bounds — recorded.

Non-goals, decided: no staging method on the app-server wire (the host's staging protocol stays
host-local; the app-server *uses* it as a client), no `turn/steer` items (X-gated surface, YAGNI), no
remote http(s) URLs — **which is Codex parity, not a shortfall**: Codex's own app-server refuses remote
image URLs (`codex-rs/app-server/src/request_processors/turn_processor.rs`,
`validate_user_input_image_urls` → `REMOTE_IMAGE_URL_ERROR`).

**The honest v1 bound, published rather than hidden:** the app-server wire caps inbound frames at
256 KiB (`peer.ts` MAX_IN), so a `data:` image tops out around ~190 KB decoded. Bigger images reach the
model via `localImage` (shared filesystem). A REMOTE client with a >190 KB image has NO v1 path — named
as the follow-up (a staged/chunked upload, the D-M4-8 bridge family), and the scorecard row says so
instead of scoring the gap fully closed.

## Wire design

```ts
// appserver/schema/turns.ts
const inputItem = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("image"), url: z.string().startsWith("data:").max(MAX_DATA_URL_CHARS) }),
  z.object({ type: z.literal("localImage"), path: z.string().min(1).refine(isAbsolute) }),
]);
export const turnStartParams = z.object({
  threadId: z.string().min(1),
  input: z.union([z.string(), z.array(inputItem).min(1).max(MAX_INPUT_ITEMS)]),
  queue: z.boolean().optional(),
});
```

- **Loud skew by shape, not by op** (the F9 lesson): an OLD server's `z.string()` refuses an items array
  with `-32602 INVALID_PARAMS` — a new client can never have its images silently stripped.
- **`image.url` admits `data:` only, in the schema, with a published length cap**:
  `MAX_DATA_URL_CHARS = 240_000` (≈180 KB decoded — what the 256 KiB frame carries after the JSON
  envelope, with headroom). An `https://` URL is a schema refusal — matching Codex's own refusal of
  remote URLs.
- **`localImage.path` must be absolute** (schema-refined). A relative path would resolve against the
  app-server process cwd — a third cwd that is neither the thread's nor the client's; `workspace.ts`
  refuses relative reads for the same reason. The path is client-owned information, so echoing it in a
  degrade message leaks nothing of the server's.
- **`MAX_INPUT_ITEMS` (64) bounds the array in the schema; image-item count is bounded by the host's own
  `MAX_IMAGES_PER_PROMPT` (20) in the resolver, counted BEFORE any I/O** — an over-limit declaration
  degrades excess images without reading a byte (amplification guard; review finding 2).
- `turn/steer`'s `input` stays `z.string()` (decision log).

## Canonical ordering — one contract for both origins

The items form is **canonicalized, and the canonical form is the contract**: the text items concatenate
in declaration order into ONE text fold; images follow in declaration order; degrade notes append at the
end, in image order. This is exactly what the engine's `assembleUserContent` builds and what the host
already reassembles on the staging path (`host.ts` — text, then staged images, then failure notes) — so
inProcess and fleet turns deliver the model **the same input**, and an interleaved
`text A → image → text B` request is defined (fold `AB`, then the image) rather than
origin-dependent. (Review finding 4: without this, the two origins provably diverged.)

## Item → engine delivery

A new module `appserver/turnItems.ts` owns the ONE conversion:

```ts
export async function resolveInputItems(items: InputItem[]): Promise<UserTurnInput>
```

- Runs **inside the turn's execution slot, never before admission** (see "Admission and the queue").
- `image` items: parse `data:<mediaType>;base64,<data>`. The block's `media_type` is **derived from the
  sniffed bytes** (PNG/JPEG headers — the `turnInput.ts` helpers), not copied from the declaration: a
  valid PNG labeled `application/pdf` would pass local validation and then fail the WHOLE engine request
  against the SDK's media-type union (review finding 7). Non-PNG/JPEG bytes, malformed base64, or a
  media-type only the label claims all degrade **to an appended note** (canonical ordering above).
- `localImage` items: the **one-descriptor bounded read** `workspace.ts:80-124` established — open once,
  `fstat` the descriptor, require a regular file, read bounded chunks up to cap+1, close always. Never
  `stat`-then-`readFile` (TOCTOU swap, growth between calls, FIFO/device hang — review finding 1).
  Per-image budget (`POST_PROCESS_BYTE_BUDGET`, 512,000 bytes) and the running per-turn aggregate
  (5 MiB) are enforced **during conversion, before each additional read** — an over-budget file is never
  materialized (review finding 2). Unreadable, non-regular, oversize, or non-image all degrade to an
  appended note naming the client's own path.
- The assembled block array then flows through the existing authoritative seam (`normalizeTurnInput` at
  the Session builder; the staging client's own header-decode for fleet) — `turnItems.ts` converts and
  pre-bounds; it does not replace the cap suite.

## Admission and the queue — reservation before I/O

`resolveInputItems` is async, and **no admission decision may sit on the far side of that await** (the
M6 lesson: an added await turns every check before it stale; review finding 3 names the concrete
stranding — a busy-check taken, the running turn settling during resolution, the entry landing after
the only drain edge). So:

- `turn/start` admits, replies, and (if busy+queue) **enqueues the RAW input synchronously** — exactly
  today's control flow, with `QueuedTurn.input` widened to `string | InputItem[]`. The queue byte cap
  counts `Buffer.byteLength(typeof input === "string" ? input : JSON.stringify(input))` — raw items are
  bounded by the 256 KiB frame they arrived in, so the accounting is exact and small.
- Resolution runs inside `submitRunner` (already async), in the turn's ordered execution slot — for a
  direct start and a drained queued turn identically, so a queued items turn is byte-for-byte a started
  one. The user item echo (`flattenForDisplay`) and live prompt echo use the RESOLVED input.

### inProcess threads

`submitRunner` widens `input` to `string | InputItem[]`, resolves in-slot, and passes the result to
`record.session.submit(...)` (`ChatSession` has taken `UserTurnInput` since F9).

### fleet threads

The staging loop in `client/chatAdapter.ts`'s `submit` is **extracted into a shared helper**
(`client/stagedSubmit.ts`) used by both `chatAdapter` and `fleetEngine` — moved, not rewritten, **with
one named repair**: today a minted path is tracked only after `writeFile` succeeds
(`chatAdapter.ts:171-187`), so a failed write leaks the just-minted file until the orphan sweep,
contradicting the loop's own every-failure-cleans contract. The helper tracks the path the moment
`stageImageOp` returns it, before the write (review finding 9), and gains write-failure tests
(first image, middle image, cleanup of previously staged files). `fleetEngine.submit` widens to
`string | InputItem[]` (resolved to blocks in-slot, then staged). An old host answers `stageImage` with
unknown-op — the negotiated protocol's loud skew, surfaced as the turn refusal it already is on the TUI
path.

## Scorecard closure (same change, not a follow-up)

`docs/parity/appserver.md`: gap 11 closes **with the bound stated** — the app-server's image surface is
turn-input items; remote images are bounded by the frame cap (~190 KB decoded) with larger-remote named
as open follow-up; `stageImage`'s row moves `unscored → N/A` ("host-local transport by design; the
app-server bridges to it as a staging CLIENT on the fleet path"); the `prompt` row's gap-11 note and
the `turn/start` row update (the row now names the input union so the name-level walker's blindness to
field shapes is at least written down); the per-landing sweep restates. `node scripts/drift-check.mjs`
exits 0 with `unparsed 0`.

## Acceptance (behavior-phrased)

Keyless (all must pass, run from `CC-to-SDK/harness`):

1. `npx vitest run test/unit/appserver/turns.test.ts` — new rows: items reach a fake engine as blocks in
   canonical order; an interleaved `text/image/text` request with one bad image resolves to fold + good
   image + appended note (the mixed-success interleave row); an `https://` URL, an over-`MAX_DATA_URL_CHARS`
   data: URL, a relative path, an empty array, and a >64-item array are each refused `-32602`; a
   21st image degrades without I/O; a queued items turn drains byte-for-byte identical to a direct one;
   queue byte accounting is exact at the boundary (array JSON length at cap passes, +1 refuses);
   the user item text shows `[Image #N]`.
2. `npx vitest run test/unit/turn-items.test.ts` — the resolver alone: sniffed-bytes media-type
   derivation (PNG labeled PDF → PNG block), bounded-read semantics via a FIFO/non-regular fixture
   (degrades, never hangs), per-image and aggregate budgets enforced before reads, absolute-path
   requirement.
3. `npx vitest run test/unit/stageImage.test.ts test/unit/client-chat-adapter.test.ts test/unit/appserver/fleet-engine.test.ts`
   — green after the extraction; plus NEW rows: the write-failure leak repair (path tracked pre-write),
   and `fleetEngine.submit` with items staging through the helper.
4. `npx vitest run test/integration/host-image-transport.test.ts` — the existing end-to-end staging
   transport suite, green against the extracted helper (this is the file `stageImage.test.ts` defers
   full transport coverage to — review finding 6).
5. Legacy-skew fixtures: yesterday's `turnStartParams` (string-only zod) refuses today's items array
   with -32602 (no silent submit); the old-host unknown-op path refuses loudly (existing TUI-path test
   extended to the fleet engine).
6. `npx vitest run test/unit/appserver` — full suite green.
7. `node scripts/drift-check.mjs` (from `CC-to-SDK`) — exit 0, `unparsed 0`.

Keyed (quota-gated — run after 2026-08-26 1pm):

8. A live test sends one small PNG via `input` items on an inProcess thread and asserts the model's
   reply references the image content; skips cleanly keyless.

## Decision Log

- **Union over an optional `images` field.** An optional field on a non-strict zod object is silently
  stripped by an old server — the exact failure F9's stageImage op was built to make loud. The union
  makes the skew a -32602 by construction. Rejected: capability advertisement (heavier, and the union
  already guarantees loudness).
- **data:-only, bounded, published.** Codex refuses remote URLs too (turn_processor.rs — the rev-1 claim
  that Codex passes them to the model was WRONG and is corrected); the frame cap makes the real remote
  bound ~190 KB decoded, and the spec publishes it instead of discovering it in production. Rejected:
  server-side http fetch (SSRF surface, and not even parity); raising the frame cap (a protocol-wide
  knob moved for one field); v1 chunked upload (real, but its own design — named follow-up).
- **Resolution inside the execution slot; admission on raw input.** The M6 stale-check lesson applied
  in advance: enqueue synchronously, resolve in-slot, queue stores raw items. Rejected: resolve-then-
  admit (reorders concurrent starts), admit-then-await-then-enqueue (strands the entry past the drain
  edge).
- **Canonical ordering (text fold + images + appended notes) as the public contract.** The host wire
  cannot express interleaving or in-place notes; the engine's own `assembleUserContent` is already this
  shape; making it the contract is what makes the two origins identical. Rejected: position metadata in
  the host claim grammar (host-wire revision for a nuance no consumer asked for).
- **Sniffed-bytes media type.** The declaration is a claim; the bytes are the fact; the SDK union makes
  a wrong claim fatal to the whole request where a derived type degrades one image.
- **Degrade-in-place for bad bytes, refuse-in-schema for bad shapes** — unchanged from rev 1, with
  "in-place" now meaning the canonical appended-note position.
- **Extraction with one named repair** (the pre-write tracking gap) rather than byte-for-byte — a moved
  bug is still a bug, and the review found it before the move did.
- **`turn/steer` stays text; stageImage row → `N/A`** — unchanged from rev 1.

## Surprises & Discoveries

- **The rev-1 spec mis-claimed Codex's URL behavior**, and the adversarial review caught it against the
  fork's own tree: Codex app-server refuses remote image URLs (`REMOTE_IMAGE_URL_ERROR`). data:-only is
  parity, not a compromise. A parity claim about canon is checkable in this repo and must be checked.
- **The staging loop's cleanup contract had a hole its own tests never hit** (mint-then-write-then-track;
  a failed write leaks the minted file until the sweep). Found by the spec review reading the code
  against the spec's "every failure path cleans" sentence — the sentence was the trap that exposed it.

## Outcomes & Retrospective

Pending — written at finish.

## Revision Notes

- rev 1 (2026-08-23): initial spec from the approved design-A presentation.
- rev 2 (2026-08-23): adversarial review (codex, nine findings, all accepted after verification):
  one-descriptor bounded reads replace stat-then-read; item-count + pre-I/O budget guards; resolution
  moved inside the execution slot with raw-input admission/queueing; canonical ordering published as
  the cross-origin contract; data:-URL length cap published + the wrong Codex-URL parity claim
  corrected at its source; sniffed-bytes media types; absolute-path requirement; the staging-loop
  extraction now repairs the pre-write tracking leak; acceptance strengthened (interleave, transport
  integration, fleet engine, legacy skew, queue boundaries).
