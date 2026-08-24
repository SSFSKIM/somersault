// appserver/schema/turns.ts — turn lifecycle params (M1 set + M2b Wave 4's queue flags).
import { isAbsolute } from "node:path";
import { z } from "zod/v4";
import { MAX_INPUT_ITEMS, MAX_DATA_URL_CHARS, type InputItem } from "../turnItems.js";
import { MAX_IN } from "../peer.js";

/** ONE input item (spec 2026-08-23 rev 3, "Wire design"), mirroring Codex's own `UserInput` list. This
 *  union IS THE WIRE BOUNDARY, and it is where the two bounds the resolver deliberately does not enforce
 *  are enforced: `turnItems.ts` degrades bad IMAGES (a turn with one unreadable image is still a turn),
 *  while a violation here is a malformed REQUEST and answers -32602.
 *
 *  `image.url` admits `data:` only — Codex parity, not a shortfall: its app-server refuses remote image
 *  URLs too, and a server that fetched an `https:` URL a client handed it would be an SSRF hole with a
 *  turn wrapped around it. `MAX_DATA_URL_CHARS` is the published length cap and the binding number:
 *  240,000 base64 characters decode to exactly 180,000 bytes. The 256 KiB inbound frame cap is why that
 *  cap sits where it does, not what the 180 KB measures.
 *
 *  IT BINDS THE PAYLOAD, NOT THE URL (final review round 2). A `.max()` on the whole string measured the
 *  `data:image/png;base64,` prefix too, so an image AT the published bound — 240,000 payload characters,
 *  exactly the 180,000 bytes the docs promise — arrived 240,022 characters long and was refused by the
 *  very schema that published the number. The resolver has always measured the payload
 *  (`turnItems.ts`'s `decodeDataUrl`), so the two layers disagreed about the same cap. They now measure
 *  the same substring: the `.max()` stays as the EMITTED backstop (the payload cap plus a prefix
 *  allowance — `data:image/jpeg;base64,`, the longest real prefix, is 23 characters), and the refine is
 *  what actually enforces the published number. A URL with no comma at all is left to the resolver,
 *  which degrades it as "not a base64 data: URL" — a shape this refine has no payload to measure, and
 *  refusing it here would answer -32602 where the item-level degrade is the established answer.
 *  The payload rule rides `.describe()` for this file's own standing reason: a refine cannot be emitted
 *  into the published JSON Schema, so a client validating against the artifact alone would otherwise
 *  build to the backstop number and meet the real cap as a -32602 in production.
 *
 *  `localImage.path` must be ABSOLUTE, because a relative one would resolve against THIS process's cwd —
 *  a third cwd that is neither the thread's nor the client's (workspace.ts refuses relative reads for the
 *  same reason). The rule is stated in `.describe()` as well as refined, because a refine CANNOT be
 *  emitted into the published JSON Schema: a client validating against the artifact alone would see a
 *  bare string and learn about the rule from a -32602 in production instead. */
/** How much longer than its payload a real `data:` URL may be: `data:image/jpeg;base64,` is 23 characters,
 *  so 64 leaves room for any media type a sniffable image can carry while keeping the emitted `maxLength`
 *  a bound rather than a fiction. It is a BACKSTOP, not the cap — the refine below is the cap. */
const DATA_URL_PREFIX_ALLOWANCE = 64;
/** The resolver's own measurement (`decodeDataUrl`: everything after the FIRST comma), mirrored so the
 *  wire and the resolver cannot disagree about what 240,000 characters counts. */
const payloadWithinCap = (url: string): boolean => {
  const comma = url.indexOf(",");
  return comma < 0 || url.length - comma - 1 <= MAX_DATA_URL_CHARS;
};

const inputItem = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("image"), url: z.string().startsWith("data:").max(MAX_DATA_URL_CHARS + DATA_URL_PREFIX_ALLOWANCE).refine(payloadWithinCap).describe(`A base64 \`data:\` URL. Remote URLs are refused. The cap is on the base64 PAYLOAD — everything after the first comma — which may be at most ${MAX_DATA_URL_CHARS} characters (exactly 180,000 decoded bytes); the published \`maxLength\` is that cap plus ${DATA_URL_PREFIX_ALLOWANCE} characters of \`data:<mediaType>;base64,\` prefix, so it is a backstop and not the number to build to.`) }),
  z.object({ type: z.literal("localImage"), path: z.string().min(1).refine(isAbsolute).describe("An ABSOLUTE path on the server's filesystem. A relative path is refused (-32602).") }),
]);

/** The schema/resolver type match, asserted rather than described — the two are written in different
 *  files and nothing else makes them move together. `Equal` is the deferred-conditional identity trick:
 *  a mere mutual `extends` would pass for a union that gained a member on one side only. */
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
const _inputItemMatches: Equal<z.infer<typeof inputItem>, InputItem> = true;
void _inputItemMatches;

/** ZERO CONTENT IS A MALFORMED REQUEST, refused here at -32602 rather than discovered downstream
 *  (whole-branch review P2). `text: z.string()` admits `""`, so `[{type:"text",text:""}]` used to parse,
 *  resolve to one empty text block with no images, and reach the fleet bridge as a host prompt
 *  `{text:""}` — which the host's own op schema refuses ("prompt requires text or at least one image",
 *  host/ops.ts) and which surfaced to the client as a -32603 INTERNAL for a request our schema had called
 *  valid.
 *
 *  The rule MIRRORS the host's, so the two cannot disagree: an array is content-bearing iff it has at
 *  least one image/localImage item, or at least one text item with a non-empty string. Stating it at the
 *  ARRAY level is exact rather than approximate — an image that degrades still appends its note to the
 *  fold, so any array carrying an image item always produces non-empty prompt text.
 *
 *  A plain-string `input` is deliberately untouched: `input: ""` is a pre-existing surface with its own
 *  behaviour, and this refine is scoped to the shape this milestone added. */
const hasContent = (items: InputItem[]): boolean => items.some((it) => it.type !== "text" || it.text.length > 0);
const CONTENT_RULE = "an items array must carry at least one image/localImage item or at least one text item with non-empty text";

/** `queue`: on a thread that is busy WITH A TURN, enqueue instead of refusing (-33001) — the reply is
 *  `{queued:true, turn:{id,status:"queued"}, position}` rather than `{turn}`. The METHOD is stable; the
 *  flag is the experimental part (spec Wave 4's `turn/queue` X-gate).
 *
 *  `input` is a string OR a non-empty, content-bearing items array. LOUD SKEW BY SHAPE (the F9 lesson):
 *  an OLD server's `z.string()` refuses an items array with -32602, so a new client can never have its
 *  images silently stripped by a server that never heard of them. `turn/steer`'s own `input` stays
 *  string-only.
 *
 *  Its `.describe()` states the FRAME bound because the per-item caps multiply straight past it: 64 items
 *  of MAX_DATA_URL_CHARS each is ~15 MB, and a client that sized a batch off the published per-item caps
 *  alone would have the whole request die as a -32700 parse error with a NULL id — no method, no threadId,
 *  nothing to correlate it back to the call. Stated in prose because JSON Schema cannot express a bound on
 *  the serialized document, so the artifact would otherwise publish only the half that misleads. The
 *  content rule rides the same `.describe()` for the same file-local reason `localImage.path`'s does: a
 *  refine cannot be emitted into the published JSON Schema, so a client validating against the artifact
 *  alone would meet the rule as a -32602 in production instead. */
export const turnStartParams = z.object({
  threadId: z.string().min(1),
  input: z.union([z.string(), z.array(inputItem).min(1).max(MAX_INPUT_ITEMS).refine(hasContent, CONTENT_RULE)])
    .describe(`The per-item caps do NOT multiply: whatever the item count and length bounds allow, the whole request must still fit the ${MAX_IN / 1024} KiB inbound frame cap, and a frame over it is refused as a parse error (-32700) with a null id before any turn starts. An items array must also carry content: at least one image/localImage item, or at least one text item whose text is non-empty (an all-empty-text array is refused -32602).`),
  queue: z.boolean().optional(),
});
/** `turnId`: address ONE turn. Naming a queued turn cancels just that entry and never touches the engine
 *  (spec D-M2-10 — ids are minted at enqueue precisely so an unstarted turn is addressable); an id that
 *  is not in the queue falls through to the ordinary interrupt of whatever is running. `cancelQueued` is
 *  Stop-means-stop-everything: flush the whole queue, then interrupt. BOTH together: the flush runs
 *  first and `turnId` is resolved against its result — the receipt reports the named id under
 *  `cancelled` and the flushed set under `cancelledQueued` (turns.ts). */
export const turnInterruptParams = z.object({ threadId: z.string().min(1), cancelQueued: z.boolean().optional(), turnId: z.string().min(1).optional() });
/** `turn/steer` (X, probe 103b): mid-turn injection. No `turnId` — a steer aims at whatever is running
 *  RIGHT NOW, and the thread can only be running one turn; naming an id would invite a client to steer a
 *  turn that has already ended. `input` mirrors `turn/start`'s (a bare string, empty allowed). */
export const turnSteerParams = z.object({ threadId: z.string().min(1), input: z.string() });
/** `turn/startContent` (F10 T-IMGREACH Task 10/I3d): the wire completion of a staged-image turn.
 *  `stagedImageIds` names completed `image/stage` reservations (Task 7) in the ORDER they should join the
 *  turn, and requires at least one — a content turn with no image is just `turn/start`, so an empty array
 *  here is a caller mistake, not a degenerate valid case. `text` is optional (an image-only turn is a
 *  supported shape, I1's stranding label covers it); `queue` mirrors `turn/start`'s own flag. */
export const turnStartContentParams = z.object({
  threadId: z.string().min(1), text: z.string().optional(),
  stagedImageIds: z.array(z.string().min(1)).min(1), queue: z.boolean().optional(),
});
/** `turn/steerContent` (F10 T-IMGREACH Task 11/I3e): the content-carrying twin of `turn/steer` — a
 *  mid-turn injection whose blocks may include images. No `queue` (a steer targets the turn running
 *  RIGHT NOW, exactly like `turnSteerParams`; there is nothing to enqueue) and no `turnId` for the same
 *  reason `turn/steer` has none. Otherwise identical to `turnStartContentParams`'s content fields. */
export const turnSteerContentParams = z.object({
  threadId: z.string().min(1), text: z.string().optional(),
  stagedImageIds: z.array(z.string().min(1)).min(1),
});
