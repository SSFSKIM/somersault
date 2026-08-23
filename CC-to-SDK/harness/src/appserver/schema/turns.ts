// appserver/schema/turns.ts — turn lifecycle params (M1 set + M2b Wave 4's queue flags).
import { isAbsolute } from "node:path";
import { z } from "zod/v4";
import { MAX_INPUT_ITEMS, MAX_DATA_URL_CHARS, type InputItem } from "../turnItems.js";

/** ONE input item (spec 2026-08-23 rev 3, "Wire design"), mirroring Codex's own `UserInput` list. This
 *  union IS THE WIRE BOUNDARY, and it is where the two bounds the resolver deliberately does not enforce
 *  are enforced: `turnItems.ts` degrades bad IMAGES (a turn with one unreadable image is still a turn),
 *  while a violation here is a malformed REQUEST and answers -32602.
 *
 *  `image.url` admits `data:` only — Codex parity, not a shortfall: its app-server refuses remote image
 *  URLs too, and a server that fetched an `https:` URL a client handed it would be an SSRF hole with a
 *  turn wrapped around it. `MAX_DATA_URL_CHARS` is the published length cap (≈180 KB decoded, what the
 *  256 KiB inbound frame carries once the JSON envelope is paid for).
 *
 *  `localImage.path` must be ABSOLUTE, because a relative one would resolve against THIS process's cwd —
 *  a third cwd that is neither the thread's nor the client's (workspace.ts refuses relative reads for the
 *  same reason). The rule is stated in `.describe()` as well as refined, because a refine CANNOT be
 *  emitted into the published JSON Schema: a client validating against the artifact alone would see a
 *  bare string and learn about the rule from a -32602 in production instead. */
const inputItem = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("image"), url: z.string().startsWith("data:").max(MAX_DATA_URL_CHARS).describe("A base64 `data:` URL. Remote URLs are refused.") }),
  z.object({ type: z.literal("localImage"), path: z.string().min(1).refine(isAbsolute).describe("An ABSOLUTE path on the server's filesystem. A relative path is refused (-32602).") }),
]);

/** The schema/resolver type match, asserted rather than described — the two are written in different
 *  files and nothing else makes them move together. `Equal` is the deferred-conditional identity trick:
 *  a mere mutual `extends` would pass for a union that gained a member on one side only. */
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
const _inputItemMatches: Equal<z.infer<typeof inputItem>, InputItem> = true;
void _inputItemMatches;

/** `queue`: on a thread that is busy WITH A TURN, enqueue instead of refusing (-33001) — the reply is
 *  `{queued:true, turn:{id,status:"queued"}, position}` rather than `{turn}`. The METHOD is stable; the
 *  flag is the experimental part (spec Wave 4's `turn/queue` X-gate).
 *
 *  `input` is a string OR a non-empty items array. LOUD SKEW BY SHAPE (the F9 lesson): an OLD server's
 *  `z.string()` refuses an items array with -32602, so a new client can never have its images silently
 *  stripped by a server that never heard of them. `turn/steer`'s own `input` stays string-only. */
export const turnStartParams = z.object({
  threadId: z.string().min(1),
  input: z.union([z.string(), z.array(inputItem).min(1).max(MAX_INPUT_ITEMS)]),
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
