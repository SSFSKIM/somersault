# App-server image input — turn-input items (closing scorecard gap 11)

**Date:** 2026-08-23 · **Owner approval:** design A of the product-trio presentation, approved verbatim.
**Grounding:** `docs/superpowers/grounding/2026-08-23-product-trio-ground.md` §1.
**Rev 3** — rev 2 absorbed the adversarial spec review (nine findings), rev 3 the plan review's
contract-level findings (Revision Notes).

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
256 KiB (`peer.ts` MAX_IN) — 256 KiB × ¾ ≈ 192 KiB of decoded image at best — and the SCHEMA caps one
`data:` URL tighter still, at `MAX_DATA_URL_CHARS = 240_000` characters = **exactly 180,000 bytes
(≈180 KB) decoded**. The schema cap is the binding one, so 180 KB is the number a client builds to;
sizing to the frame instead earns a `-32602`. The cap binds the base64 PAYLOAD — everything after the
first comma — and not the whole URL, because an image at exactly the published bound is a
240,022-character string once `data:image/png;base64,` is paid for; the emitted `maxLength` is 240064
(the payload cap plus a 64-character prefix allowance) and is a backstop on the serialized string
rather than the number to build to. Bigger images reach the
model via `localImage` (shared filesystem). A REMOTE client with a >180 KB image has NO v1 path — named
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
  envelope, with headroom), measured on the base64 PAYLOAD, with the emitted `maxLength` of 240064
  standing as the whole-URL backstop. An `https://` URL is a schema refusal — matching Codex's own
  refusal of remote URLs.
- **`localImage.path` must be absolute** (schema-refined). A relative path would resolve against the
  app-server process cwd — a third cwd that is neither the thread's nor the client's; `workspace.ts`
  refuses relative reads for the same reason. The path is client-owned information, so echoing it in a
  degrade message leaks nothing of the server's.
- **`MAX_INPUT_ITEMS` (64) bounds the array in the schema; image-item count is bounded by the host's own
  `MAX_IMAGES_PER_PROMPT` (20) in the resolver, counted BEFORE any I/O** — an over-limit declaration
  degrades excess images without reading a byte (amplification guard; review finding 2).
- `turn/steer`'s `input` stays `z.string()` (decision log).

## Canonical ordering — one contract for both origins

The items form is **canonicalized, and the canonical form is the contract**: ONE text block carrying the
text fold (text items concatenated in declaration order) with degrade notes appended to ITS end (in
image order), followed by the surviving images in declaration order. This is the shape the host wire
already produces — `chatAdapter`'s staging loop appends failure notes into the leading text and the host
reassembles text-then-images — and `assembleUserContent(foldPlusNotes, images)` builds the identical
block array in-process, so inProcess and fleet turns deliver the model **the same input**, byte for
byte. An interleaved `text A → image → text B` request is defined (fold `AB`, then the image) rather
than origin-dependent. (Spec-review finding 4 caught the divergence; plan-review finding 1 caught that
rev 2's "notes after images" variant was UNSATISFIABLE on the host wire, which folds every text block
into its single leading `text` — the contract now states the one shape both wires can carry.)

A corollary with teeth: **the resolver enforces the FULL image cap suite itself** — sniffed bytes,
strict base64 (alphabet/padding validated before decode), `MAX_DIMENSION`, per-image budget, aggregate
budget — so no block it emits can still be degraded downstream. `normalizeTurnInput` replaces a failing
image IN PLACE with a text block, which would break the canonical shape and differ across origins; the
resolver leaving it nothing to degrade is what keeps the contract true.

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
  the Session builder; the staging client's own header-decode for fleet) — those seams stay authoritative
  for THEIR callers, but for items input the resolver has already enforced the identical suite, so they
  find nothing to degrade (see "Canonical ordering" — this is a contract requirement, not an
  optimization).

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
turn-input items; remote images are bounded by the schema's data-URL cap (240,000 chars = 180 KB decoded,
which binds before the 256 KiB frame does) with larger-remote named as open follow-up;
`stageImage`'s row moves `unscored → N/A` ("host-local transport by design; the
app-server bridges to it as a staging CLIENT on the fleet path"); the `prompt` row's gap-11 note and
the `turn/start` row update (the row now names the input union so the name-level walker's blindness to
field shapes is at least written down); the per-landing sweep restates. `node scripts/drift-check.mjs`
exits 0 with `unparsed 0`. The PUBLISHED wire schema is part of the same change: `npm run emit-schema`
regenerates `schema/json/stable/appserver.json` (exported as `./appserver/schema/stable.json`), whose
`turn/start.input` currently publishes string-only; the union ships in the artifact, with the
absolute-path rule stated in the item's `description` (zod `refine`s do not emit to JSON Schema, so the
published shape is documented as looser than runtime validation rather than silently so).

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
  that Codex passes them to the model was WRONG and is corrected); the 256 KiB frame would carry ≈192 KiB
  decoded and the schema's 240,000-character cap undercuts it, making the real remote bound 180 KB
  decoded, and the spec publishes it instead of discovering it in production. Rejected:
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
- **The image-count gate counts DECLARED images, not surviving ones** (T3 review, minor 7). The
  amplification guard must cost nothing before I/O, so the ordinal is assigned in declaration order —
  matching `stagedSubmit`'s exact behavior. Consequence, deliberate: a turn declaring three unreadable
  images and twenty good ones delivers seventeen images and three excess notes; degraded images still
  consume cap slots.
- **`turn/steer` stays text; stageImage row → `N/A`** — unchanged from rev 1.

## Surprises & Discoveries

- **The rev-1 spec mis-claimed Codex's URL behavior**, and the adversarial review caught it against the
  fork's own tree: Codex app-server refuses remote image URLs (`REMOTE_IMAGE_URL_ERROR`). data:-only is
  parity, not a compromise. A parity claim about canon is checkable in this repo and must be checked.
- **The staging loop's cleanup contract had a hole its own tests never hit** (mint-then-write-then-track;
  a failed write leaks the minted file until the sweep). Found by the spec review reading the code
  against the spec's "every failure path cleans" sentence — the sentence was the trap that exposed it.

Found during execution (T1–T5):

- **The staging window has no end-to-end test, and building one needs a production change** — so it was
  named instead of smuggled in. `HostServer` dispatches `stageImage` SYNCHRONOUSLY
  (`return { ok: true, ...this.handlers.stageImage(...) }`, `src/host/server.ts:209`), so a handler that
  returned a promise would spread to nothing and the reply would carry no `path`: the fake host cannot
  hold a stage reply open, which is exactly what a test of "an interrupt arriving mid-staging" requires.
  The window is therefore pinned one level down, at the `fleetEngine` unit level over a fake socket
  (`startStagingHost({ holdStage: true })`, which CAN withhold it). The cheapest honest route to the
  end-to-end row is making that dispatch `await` its handler — a one-word change to the host wire, with
  its own review, and out of scope here.
- **Two guards can be indistinguishable at the reply and still not be redundant.** The sabotage pass
  deleted `fleetTurnStart`'s post-resolution latch re-check and the suite stayed GREEN: the engine's own
  `aborted` hook, one await later on the far side of staging, catches the same latch and answers with a
  byte-identical `-33001`. What separates them is whether the host was touched at all — without the
  turns.ts guard a `stageImage` op still goes out and a file is still minted on the host's disk. The rows
  now assert that a stopped turn produced NO host I/O, which is both the discriminating assertion and the
  honest statement of the property. Generalized: when two layers produce the same client-visible outcome,
  only the side effect tells them apart.
- **A zod `.refine` does not reach the published artifact — confirmed by regenerating it, not assumed.**
  `emit-schema` publishes `image.url`'s `maxLength`/`pattern` but nothing at all for `localImage`'s
  absolute-path refinement, nor for `image.url`'s own payload-length refine (round 2), so both rules live
  in the item's `.describe(…)`, where they do survive. The published shape is looser than runtime
  validation; the spec's job was to make that stated rather than silent, and the artifact now says so in
  prose a client reads.
- **The per-item caps interact in a way that leaves one budget nearly dead on the wire path.** With
  `MAX_DATA_URL_CHARS` at 240,000 and `MAX_IMAGES_PER_PROMPT` at 20, data: URLs alone top out near 3.6 MB
  — under the 5 MiB per-turn aggregate — so the aggregate binds only on `localImage` turns. It is not
  dead code, but anyone reading the wire path alone would conclude it is.
- **Widening `EngineSession.submit` broke no test fake, because TypeScript method parameters are
  bivariant.** Five app-server suites still declare `submit(prompt: string, …)` and compile clean against
  the `UserTurnInput` signature. A widening the typechecker cannot fail is a widening no existing test
  notices — the new coverage had to be written deliberately rather than provoked.
- **On a shared-host origin, a record-wide stop flag is not a stop signal for pending work** (final
  review P1). Cancellation of a still-resolving items turn rode `record.interruptRequested`, which the
  fleet event layer clears on EVERY host turn-start — foreign turns included, because the terminal owner
  can start and finish a turn inside our resolution window while the thread looks idle from the host's
  side. The interrupt was silently erased and the stopped turn submitted anyway. The fix is shape, not
  bookkeeping: a per-pending-turn latch (`PendingFleetStop`) that only interrupt/close raise and only
  that turn's own settlement removes. The record's lifecycle flags belong to the HOST's turn lifecycle;
  any future stop signal for work not yet handed to the host must take the per-unit shape.
- **Staged-file ownership on the fleet path is a three-way split, not a binary** (final review P2a). The
  prompt-op catch treated every rejection as pre-acceptance and unlinked the staged files — but a socket
  death across the op is INDETERMINATE: the host may have accepted and `runTask` reads the claims lazily
  during the turn, so the unlink degraded images under an accepted turn. Now: explicit refusal → ours,
  clean immediately; accepted → the host's; connection death → leave the files for the host's orphan
  sweep, which exists precisely for unclaimed staging and already tolerates an already-reaped path.
- **A wire that admits what its downstream refuses converts a client error into a server error** (final
  review P2b). `text: z.string()` admitted `""`, so a zero-content items array crossed our schema and
  died at the host's "text or at least one image" refine as -32603 INTERNAL. Our array refine now mirrors
  the host's rule and answers -32602 — the general rule: every reachable downstream refusal of a
  request SHAPE must have an admission-time counterpart, or schema-valid input reads as a server bug.
- **"In the turn's execution slot" was a claim the chain did not enforce** (review round 2, P1). The
  chain callback fired the runner and returned, so the slot released the moment the runner was INVOKED —
  which held for strings (submit dispatches synchronously inside the runner) and silently broke for
  items (the resolution await put the submit on the far side of the release): a `thread/model/set`
  enqueued after the turn reached the engine first. The slot now spans preparation through DISPATCH
  (`releaseSlot`, called the moment the engine call is made; fleet holds to acceptance/refusal) and
  never the turn itself. The lesson generalizes: an ordering contract stated in a comment is only as
  true as the promise the chain actually awaits.
- **Staged-file ownership needed a FOURTH way** (review round 2, P2a): round 1's indeterminate-ack rule
  ("a rejection across the prompt op leaves the files") over-applied to `sendOp`'s PRE-WRITE closed
  rejection, where the op was definitely never written and the dead host's sweeper died with it. The
  death latch is sampled in the same tick as the send; never-sent cleans, in-flight leaves.
- **A cap measured on two different strings is two different caps** (review round 2, P2b): the schema
  bounded the whole URL while the resolver bounded the payload, so an image at the published 180,000-byte
  bound was refused by the 22-character prefix. The cap now binds the payload at both layers; the
  emitted `maxLength` (240,064) is a backstop, not the build-to number.
- **A serialization slot must cover the work it was taken for, not the call that opens it** (final review
  round 2, P1). `turn/start` takes an ordered slot on the thread's chain so its prompt reaches the engine
  behind anything the client sent first — and the slot released the moment the runner was INVOKED, which
  equals "dispatched" only while dispatch is synchronous. The milestone gave the turn asynchronous
  PREPARATION (item resolution on both origins, a host staging round trip on the fleet one), so an op
  sent AFTER the turn reached the engine BEFORE its prompt. The general rule: when an ordered handler
  gains an await ahead of its side effect, the ordering primitive must be re-anchored to the side effect
  itself — and released there and not one step later, since holding it through completion would park
  every subsequent op for the whole operation.
- **"Indeterminate" has an exact boundary, and the transport usually knows where it is** (final review
  round 2, P2a). Round 1 correctly stopped unlinking staged files on a prompt-op rejection, because a
  socket death across the op cannot be told from an acceptance whose reply was lost. But the send path
  checks its own death latch BEFORE it writes, so a rejection raised by that check means the op never
  left — acceptance is impossible and the dead host's orphan sweeper died with it, stranding the bytes.
  Generalized: before classing a failure as unknowable, ask whether the layer that raised it can separate
  "never attempted" from "attempted, outcome unknown"; a pre-write guard is exactly that separation, and
  sampling it in the same tick as the call keeps the answer exact.
- **A shared cap has to be measured on the same substring everywhere it is stated** (final review round 2,
  P2b). The schema measured the whole `data:` URL while the resolver measured the base64 payload and the
  docs published the payload number, so an image at exactly the published bound was refused by the wire
  that published it. Agreeing on the NUMBER is not agreeing on the cap. And where the enforceable form
  cannot be emitted into a published artifact (a zod `.refine`), the artifact's own number must be
  labelled for what it is — a backstop — with the binding rule stated in prose beside it, or a client
  builds to the wrong one of the two.

## Outcomes & Retrospective

**Shipped 2026-08-23/24 on `appserver-image-input`, five tasks, against the Purpose as written.** A
fleet-origin thread could not send an image at all when this spec opened; it can now, over the same
`turn/start` a text turn uses, and scorecard gap 11 closes with its bound published rather than left to
be discovered in production.

What landed, in build order:

1. **`client/stagedSubmit.ts`** — the staging loop moved out of `chatAdapter`, with the one named repair:
   a minted path is tracked the moment `stageImage` returns it, before the write, so a failed write no
   longer leaks the file until the orphan sweep.
2. **`EngineSession.submit` widened to `UserTurnInput`**, and `fleetEngine` stages arrays behind a
   synchronous reservation.
3. **`appserver/turnItems.ts`** — the one conversion, owning the FULL cap suite (strict base64,
   sniffed-bytes media type, `MAX_DIMENSION`, per-image and aggregate budgets, one-descriptor bounded
   reads) so the downstream seam finds nothing to degrade and the canonical text block cannot split.
4. **The wire**: `turnStartParams.input` as the union, raw admission with in-slot resolution, the queue
   widened to store raw items, post-resolution latch re-checks on both origins, and the published
   JSON-Schema artifact regenerated in the same change.
5. **Closure**: the scorecard sweep above, and the keyed live test.

**Verification at closure.** All seven keyless acceptance rows green: `turns.test.ts` 26/26,
`turn-items.test.ts` 20/20, the extraction trio (`stageImage` + `client-chat-adapter` + `fleet-engine`)
88/88, `host-image-transport.test.ts` 15/15, the legacy-skew rows inside rows 1 and 3, the full
`test/unit/appserver` suite 1180/1180 across 71 files, and `drift-check.mjs` exit 0 with 100 rows and no
`unparsed` bucket. **Row 8, the keyed one, has been written and has only ever SKIPPED**: the Claude
weekly quota was exhausted through 2026-08-26 1pm, so `test/live/appserver-image-input.test.ts` is a
clean keyless skip and nothing more. Until its first keyed run, "a real model reads the pixels an items
turn delivers" is an unobserved claim in this round, and the file's own header says so.

**What the reviews changed.** Four per-task reviews: 0 critical, 4 important, 23 minor. The importants
were all real and all structural — an interrupt arriving mid-staging reaching the host BEFORE the prompt
(which became `fleetEngine.submit`'s `aborted` hook), the nothing-left-to-degrade contract needing its
own row, the fleet items happy path being unpinned, and a stopped turn reporting `completed` to every
subscriber. None was a rewrite; each was a property the code did not yet state.

The final whole-branch review (codex, base `e7777bf9be`) found what no per-task review could: three
defects living in the SEAMS between tasks — the pending-turn cancellation clobbered by a foreign turn's
lifecycle, staged-file cleanup on an indeterminate ack, and a zero-content array our wire admitted but
the host's refused (all three in Surprises). Fixed in one wave with per-finding sabotage proofs; the
per-task reviews were each scoped to their own diff, and every one of these needed two tasks' code in
view at once.

A second whole-branch round over the fixed tree found three more, and they rhyme: each was a property
that had been TRUE before this milestone added an await or a prefix, and stayed written down as though
nothing had moved. The chain slot still released at the call that used to be the dispatch; the
staged-byte cleanup treated a pre-write refusal as the same unknown as a mid-flight death; the schema
still measured the whole string for a cap the resolver and the docs measured on its payload. What the
round is worth remembering for is the shape of the miss rather than the three sites: adding asynchrony
in front of an effect silently re-points every invariant that was anchored to the call.

**Gaps left open, each deliberately:**

- **A REMOTE client with an image over ~180 KB has no v1 path** (the schema's 240,000-character data-URL
  cap, which binds before the 256 KiB frame does)**.** The named follow-up (staged or chunked
  upload, the D-M4-8 bridge family). This is the one place the closure is a bound rather than a "yes".
- **`turn/steer` stays text-only** — an X-gated surface, per the decision log.
- **No end-to-end staging-window test** (see Surprises): the host's synchronous `stageImage` dispatch
  makes one impossible without a production change; the window is pinned at the `fleetEngine` unit level.
- **`MAX_AGGREGATE_BYTES` is duplicated** between `turnItems.ts` and `session/turnInput.ts`, where it is
  module-private. They MUST stay equal or the downstream seam regains something to degrade in place. A
  one-line export would remove the drift risk.
- **Field-level drift remains invisible to the walker.** This landing widened `turn/start`'s params
  without moving a single walked token, so no generated instrument could report it — the mirror image of
  the `prompt.images` blindness gap 11 was opened for.

**Lessons worth carrying out of this round:**

- **Loudness can be bought by SHAPE instead of by protocol.** F9 gave `stageImage` its own op so an old
  host would answer "unknown op"; here a union in an existing method's params bought the same guarantee
  for free, because an old server's `z.string()` refuses an array outright. Reach for a new op when the
  transport is new — not when only the payload is.
- **Publish the bound with the capability.** The frame cap was going to decide the maximum image size
  whether or not anyone wrote it down; writing it into the spec, the schema's `.describe`, and the
  scorecard row is what turns it from a production surprise into a client's design input.
- **Assert the side effect when the reply cannot discriminate** (the sabotage hole above).
- **An `unscored` row is a legitimate scorecard state and it earned its keep.** It held gap 11's open
  product question across two sweeps without pretending either way, and moved to `N/A` only once a
  decision existed to record. A vocabulary with no way to say "undecided" would have forced a lie.

## Revision Notes

- rev 1 (2026-08-23): initial spec from the approved design-A presentation.
- rev 3 (2026-08-23): plan review (codex, eight findings, all accepted after verification) folded back:
  canonical ordering restated as the one shape both wires carry (notes at the fold's end, before the
  image blocks) after the "notes after images" variant proved unsatisfiable on the host wire; the
  resolver now owns the FULL cap suite (incl. `MAX_DIMENSION` + strict base64) so downstream in-place
  degradation can never split the canonical text block; the published JSON schema artifact
  (`emit-schema`) joins the closure. Execution-level findings (post-resolution latch re-checks, the
  fleet submit reservation, the shared `EngineSession` widening + the `turnInput.test.ts:279` scope
  pin, discriminating cleanup tests) live in the plan's tasks.
- rev 2 (2026-08-23): adversarial review (codex, nine findings, all accepted after verification):
  one-descriptor bounded reads replace stat-then-read; item-count + pre-I/O budget guards; resolution
  moved inside the execution slot with raw-input admission/queueing; canonical ordering published as
  the cross-origin contract; data:-URL length cap published + the wrong Codex-URL parity claim
  corrected at its source; sniffed-bytes media types; absolute-path requirement; the staging-loop
  extraction now repairs the pre-write tracking leak; acceptance strengthened (interleave, transport
  integration, fleet engine, legacy skew, queue boundaries).
