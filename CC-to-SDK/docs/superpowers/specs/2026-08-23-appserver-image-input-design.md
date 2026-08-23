# App-server image input — turn-input items (closing scorecard gap 11)

**Date:** 2026-08-23 · **Owner approval:** design A of the product-trio presentation, approved verbatim.
**Grounding:** `docs/superpowers/grounding/2026-08-23-product-trio-ground.md` §1.

## Purpose

A fleet-origin app-server thread cannot send an image at all today — the app-server names no image
surface (scorecard gap 11), while the engine layer underneath it has accepted validated base64 image
blocks since F9 and the host wire has a negotiated staging protocol. This round gives `turn/start` an
input-items form mirroring Codex's `UserInput` list, delivers images over BOTH thread origins using only
existing, tested parts, and closes gap 11 with the decision recorded rather than open.

Non-goals, decided: no staging method on the app-server wire (the host's staging protocol stays
host-local; the app-server *uses* it as a client), no `turn/steer` items (X-gated surface, YAGNI), no
http(s) URL fetching (v1 is data:-URL and local-path only; API url-source passthrough is a delegated
unknown, probe-gated on the 2026-08-26 quota reset).

## Wire design

`turn/start`'s `input` widens from `z.string()` to a union:

```ts
// appserver/schema/turns.ts
const inputItem = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("image"), url: z.string().startsWith("data:") }),
  z.object({ type: z.literal("localImage"), path: z.string().min(1) }),
]);
export const turnStartParams = z.object({
  threadId: z.string().min(1),
  input: z.union([z.string(), z.array(inputItem).min(1)]),
  queue: z.boolean().optional(),
});
```

- **Loud skew by shape, not by op** (the F9 lesson): an OLD server's `z.string()` refuses an items array
  with `-32602 INVALID_PARAMS` — a new client can never have its images silently stripped. No
  capability negotiation is needed for that guarantee.
- **`image.url` admits `data:` only, in the schema itself** — an `https://` URL is a schema refusal
  (-32602), not a runtime degrade. The refusal is the honest v1 answer: nothing downstream can deliver
  it yet, and quietly running the turn without the image would be data loss reported as success.
  (Codex's `Image{url}` passes URLs through to a model API that fetches them; whether OUR engine's
  stream-json input accepts a url-source block is unmeasured and needs a live turn — parked with a
  named probe, not assumed either way.)
- **`localImage.path` is a client-named absolute or relative path** the server reads. Trust posture is
  `workspace.ts`'s, unchanged: the app-server already deliberately accepts client roots; the path is
  client-owned information, so echoing it in a degrade message leaks nothing of the server's.
- `turn/steer`'s `input` stays `z.string()` (decision log).

## Item → engine delivery

A new module `appserver/turnItems.ts` owns the ONE conversion (both handlers call it):

```ts
export interface ResolvedInput { input: UserTurnInput }   // string | UserContentBlock[]
export async function resolveInputItems(items: InputItem[]): Promise<ResolvedInput>
```

- `text` items concatenate in order (matching `chatAdapter`'s defensive multi-text fold).
- `image` items: parse the data: URL (`data:<mediaType>;base64,<data>`); the block is
  `{type:"image", source:{type:"base64", media_type, data}}`. A malformed data: URL degrades **in
  place** to the failure-text convention `normalizeTurnInput` established (the turn is never refused
  wholesale; four good images and one bad one still run as four images and one apology line).
- `localImage` items: `stat` first and treat a size above the engine's own 5 MiB aggregate ceiling as
  the degrade *before* reading (never buffer unbounded bytes to discover they are too big); otherwise
  read and sniff media type from the actual bytes (PNG/JPEG headers, the `turnInput.ts` helpers). An
  unreadable path, oversize file, or non-image all degrade in place the same way, the degrade text
  naming the client's own path.
- **Validation stays where it lives**: the assembled block array then flows through the existing
  authoritative seam — `normalizeTurnInput` at the Session builder for inProcess, and the staging
  client's own header-decode for fleet. `turnItems.ts` converts; it does not duplicate the cap suite.

### inProcess threads

`submitRunner` (turns.ts) widens its `input` param from `string` to `UserTurnInput` and passes it to
`record.session.submit(...)` — the `ChatSession` contract has taken `UserTurnInput` since F9. The user
item echo uses `flattenForDisplay(input)` (the established `[Image #N]` placeholder convention), as does
the live prompt echo.

### fleet threads

The staging loop that `client/chatAdapter.ts`'s `submit` already runs (mint → write bytes → claim,
client-owned cleanup on every failure path, `MAX_IMAGES_PER_PROMPT` gate before staging) is **extracted
into a shared helper** (`client/stagedSubmit.ts`), used byte-for-byte by both `chatAdapter` and
`fleetEngine`. `fleetEngine.submit`'s `prompt` param widens to `UserTurnInput`; a block array routes
through the helper to `stageImageOp` + `prompt(text, uuid, claims)`. An old host answers `stageImage`
with unknown-op — the negotiated protocol's loud skew, surfaced as the turn refusal it already is on the
TUI path. The extraction is a refactor of working code: the helper must be moved, not rewritten, and
`chatAdapter`'s existing tests keep covering it.

### queue

`QueuedTurn.input` widens to `UserTurnInput`; the byte cap counts
`Buffer.byteLength(typeof input === "string" ? input : JSON.stringify(input))` — the cap protects THIS
server's buffer (queue.ts's own words), and JSON length is the size actually held. Drained turns replay
through the same `submitRunner`, so a queued items turn is byte-for-byte a started one.

## Scorecard closure (same change, not a follow-up)

`docs/parity/appserver.md`: gap 11 closes with the decision — the app-server's image surface is
turn-input items; `stageImage`'s row moves `unscored → N/A` ("host-local transport by design; the
app-server bridges to it as a staging CLIENT on the fleet path"); the `prompt` row's gap-11 note and the
`turn/start` row update; the per-landing sweep restates. `node scripts/drift-check.mjs` exits 0 with
`unparsed 0`.

## Acceptance (behavior-phrased)

Keyless (all must pass, run from `CC-to-SDK/harness`):

1. `npx vitest run test/unit/appserver/turns.test.ts` — new rows green: items array reaches the engine
   as blocks (fake engine records `UserTurnInput`); a malformed data: URL degrades in place; an
   `https://` URL and an empty items array are refused `-32602`; a queued items turn drains identically;
   the user item text shows `[Image #N]`.
2. `npx vitest run test/unit/appserver` — full suite green (no regression).
3. `npx vitest run test/unit/stageImage.test.ts test/unit/client-chat-adapter.test.ts` — green after
   the staging-loop extraction, unmodified assertions (these are the files that earned the
   ownership/cleanup semantics; they keep covering the moved code).
4. `node scripts/drift-check.mjs` (from `CC-to-SDK`) — exit 0, `unparsed 0`, 100 rows accounted.

Keyed (quota-gated — run after 2026-08-26 1pm):

5. A live test in `test/live/` sends one small PNG via `input` items on an inProcess thread and asserts
   the model's reply references the image content; skips cleanly keyless.

## Decision Log

- **Union over an optional `images` field.** An optional field on a non-strict zod object is silently
  stripped by an old server — the exact failure F9's stageImage op was built to make loud. The union
  makes the skew a -32602 by construction. Rejected: capability advertisement (heavier, and the union
  already guarantees loudness).
- **data:-only v1; https refused in schema.** Passthrough of url-source blocks to the engine is
  unmeasured (needs a live turn; quota returns 2026-08-26). Refusing in the schema keeps the failure
  honest and the widening compatible (accepting more later breaks no one). Rejected: server-side http
  fetch (SSRF surface nobody asked for; Codex does not fetch either).
- **Degrade-in-place for bad bytes, refuse-in-schema for bad shapes.** Matches `normalizeTurnInput`'s
  established convention exactly; the schema owns what the request IS, the degrade owns what the bytes
  ARE.
- **Fleet delivery via the existing staging client flow, extracted not rewritten.** The
  ownership/cleanup semantics in `chatAdapter.submit` took a final-review round to get right (findings
  3/4 are cited in its comments); a second implementation would re-earn those bugs. Rejected: widening
  the host `prompt` op to carry base64 (256 KiB frame cap; and the negotiated protocol exists precisely
  to avoid bytes on that socket).
- **`turn/steer` stays text.** X-gated, no consumer asked, and a steer aims at a running turn where
  image semantics are unexplored. Revisit on demand.
- **stageImage row → `N/A`, not shipped.** The op is deliberately not mirrored; the decision is now
  made, which is what that row was waiting for (its `unscored` said "nobody has decided").

## Surprises & Discoveries

Pending — written during execution.

## Outcomes & Retrospective

Pending — written at finish.

## Revision Notes

- rev 1 (2026-08-23): initial spec from the approved design-A presentation.
