// appserver/schema/review.ts — `review/start` params (M4 §surface). Codex's shape verbatim
// (app-server-protocol/src/protocol/v2/review.rs:17-64): the same method name, the same four target
// variants, the same discriminator. Adopting the vocabulary costs nothing and keeps every future parity
// comparison a lookup rather than a translation (D-M4-4).
//
// `inline` PARSES here and is REFUSED in the handler (D-M4-2). The split is deliberate: a client that
// sends a value Codex accepts deserves an actionable "not supported yet, use detached" rather than a
// generic schema rejection that reads like a typo.
import { z } from "zod/v4";
/** The git identifiers a client supplies are interpolated into the review prompt's own example commands
 *  UNFRAMED (reviewPrompt.ts), so a single newline is enough to forge a section heading and countermand the
 *  one instruction that prompt cannot lose — the `ReportFindings` call, the only channel anything
 *  downstream reads. The boundary is the right place to stop that, and THE LINE BREAKS ARE THE WHOLE RULE:
 *  every control character (`\p{Cc}`, which is `\n`, `\r` and the rest) plus U+2028 and U+2029, the two
 *  separators that read as a break everywhere the prompt is rendered yet are categories `Zl`/`Zp` and so
 *  slip past a `\p{Cc}`-only test — git permits both in a ref name. None of a git ref, an object name or a
 *  commit subject legitimately carries any of them, so nothing real is refused. Deliberately NOT an allowlist — a backtick is legal in a git ref and a `$` in a branch name, and
 *  refusing either would reject real branches to buy nothing, since without a control character the text
 *  cannot restructure the prompt at all. `custom{instructions}` is exempt for the opposite reason: it is
 *  multi-line by nature, and reviewPrompt.ts fences it as data instead. */
const STRUCTURAL = /[\p{Cc}\p{Zl}\p{Zp}]/u; // Zl/Zp = U+2028/U+2029, line breaks that are NOT category Cc
const gitText = (field: string) =>
  z.string().min(1).refine((s) => !STRUCTURAL.test(s), `${field} must not contain control characters`);
/** `title` and `title` alone also accepts "": it is a LABEL, not an identifier — a client that always sends
 *  the field, empty when the commit has none, is asking for the same thing as omitting it, and
 *  reviewPrompt.ts already reads "" as absent (it is falsy). `sha` and `branch` keep `.min(1)`, because an
 *  empty one of those names nothing there is any way to review. The character rule is unchanged. */
const gitLabel = (field: string) =>
  z.string().refine((s) => !STRUCTURAL.test(s), `${field} must not contain control characters`);
/** The unit of work is a target DESCRIPTOR, not a diff — the host never computes one; the prompt names the
 *  target and the reviewing agent fetches its own subject (D-M4-3). `title` is Codex's optional UI label on
 *  `commit`, carried so a client that has one need not drop it. */
export const reviewTargetParams = z.discriminatedUnion("type", [
  z.object({ type: z.literal("uncommittedChanges") }),
  z.object({ type: z.literal("baseBranch"), branch: gitText("branch") }),
  z.object({ type: z.literal("commit"), sha: gitText("sha"), title: gitLabel("title").optional() }),
  z.object({ type: z.literal("custom"), instructions: z.string().min(1) }),
]);
export type ReviewTarget = z.infer<typeof reviewTargetParams>;
/** Codex defaults `delivery` to INLINE; we default to DETACHED, the one path M4 ships — the deviation is
 *  D-M4-2, and it is the honest default rather than one every request would have to override. */
export const reviewStartParams = z.object({
  threadId: z.string().min(1),
  target: reviewTargetParams,
  // Default applied HERE so the handler reads one value and never re-derives the default.
  delivery: z.enum(["detached", "inline"]).default("detached"),
});
export type ReviewDelivery = z.infer<typeof reviewStartParams>["delivery"];
