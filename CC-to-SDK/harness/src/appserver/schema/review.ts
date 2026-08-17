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
/** EVERYTHING A CLIENT SENDS HERE IS COPIED INTO ONE USER MESSAGE (reviewPrompt.ts), i.e. straight into the
 *  model's context, and none of these fields had a maximum: the RPC frame cap (~256 KiB) was the only bound,
 *  so a single `review/start` could ship a quarter-megabyte of client text to the model — and, for
 *  `instructions`, one linear scan of it per request in `scopeFence`.
 *
 *  The caps are set at the boundary, which is where client input stops being a string, and OVER-CAP INPUT IS
 *  REFUSED rather than truncated: a truncated scope reviews something the caller did not ask for and reports
 *  it as the review they requested, which is a wrong answer dressed as a right one. A refusal is a bad
 *  request the client can see and fix.
 *
 *  The numbers: `branch`/`sha` get 255, the conventional limit on a single ref-name component, and neither a
 *  ref nor an object name is legitimately longer. `title` gets 1024, far above any real commit subject (git's
 *  own convention is ~72) yet small enough to be irrelevant to a context window. `instructions` gets 20k
 *  characters — roughly 5k tokens, so a couple of pages of genuinely useful scope, an order of magnitude
 *  below anything that threatens a 200k context, and characters rather than bytes because tokens track
 *  characters. */
const MAX_REF = 255, MAX_TITLE = 1024, MAX_INSTRUCTIONS = 20_000;
const gitText = (field: string) =>
  z.string().min(1).max(MAX_REF).refine((s) => !STRUCTURAL.test(s), `${field} must not contain control characters`);
/** `title` and `title` alone also accepts "": it is a LABEL, not an identifier — a client that always sends
 *  the field, empty when the commit has none, is asking for the same thing as omitting it, and
 *  reviewPrompt.ts already reads "" as absent (it is falsy). `sha` and `branch` keep `.min(1)`, because an
 *  empty one of those names nothing there is any way to review. The character rule is unchanged. */
const gitLabel = (field: string) =>
  z.string().max(MAX_TITLE).refine((s) => !STRUCTURAL.test(s), `${field} must not contain control characters`);
/** The unit of work is a target DESCRIPTOR, not a diff — the host never computes one; the prompt names the
 *  target and the reviewing agent fetches its own subject (D-M4-3). `title` is Codex's optional UI label on
 *  `commit`, carried so a client that has one need not drop it. */
/** `sha` NAMES AN OBJECT, AND THAT IS NARROWER THAN "TEXT WITHOUT LINE BREAKS".
 *
 *  The `STRUCTURAL` rule above stops client text restructuring the PROMPT. It does not stop it restructuring a
 *  COMMAND the prompt tells the model to run, which is a different channel with a different grammar:
 *  `sha: "HEAD -- package.json"` carries no control character, satisfies every rule above, and turns
 *  `git show <sha>` into a review of one path instead of the commit — while `Bash` is deliberately enabled for
 *  this thread, so `abc;curl …` appends a second command outright. (`resolveReviewRange` is NOT this hazard
 *  and needed no allowlist: it passes the value as argv through `execFile` behind `--end-of-options`, where
 *  there is no shell to split it. Text a model is told to type into one is a different channel.)
 *
 *  So the shape is REQUIRED rather than the dangerous characters refused, and this field can carry that where
 *  `branch` cannot: every git revision spelling — hex object names, `HEAD`, `HEAD~3`, `HEAD^2`, `HEAD@{2}`,
 *  `refs/tags/v1.2.3`, `abc^{commit}`, `HEAD:path` — is drawn from this set, while no object name legitimately
 *  contains a space, a quote or a shell metacharacter. LEADING CHARACTER IS SEPARATE: it must be
 *  alphanumeric, which rules out a value that reads as an option flag (`-`, `--upload-pack=…`) or as a shell
 *  expansion (`~`, `$`) even though `~` is legal further in. */
const OBJECT_ID = /^[0-9A-Za-z][0-9A-Za-z._/:^~@{}-]*$/;
export const reviewTargetParams = z.discriminatedUnion("type", [
  z.object({ type: z.literal("uncommittedChanges") }),
  z.object({ type: z.literal("baseBranch"), branch: gitText("branch") }),
  z.object({
    type: z.literal("commit"),
    sha: gitText("sha").refine((s) => OBJECT_ID.test(s), "sha must be a git object identifier — no spaces, quotes, or shell metacharacters"),
    title: gitLabel("title").optional(),
  }),
  z.object({ type: z.literal("custom"), instructions: z.string().min(1).max(MAX_INSTRUCTIONS) }),
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
