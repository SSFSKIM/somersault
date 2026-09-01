// PARITY LAYER (§2.5 `reference`) — the message a compacted session wakes up
// with, and the rewriter that produces its body (upstream `Cq` and `d1n`,
// 2.1.251, chunk-fy12d89p).
//
// This is what compaction actually DELIVERS. The boundary frame is the record
// that a compaction happened; this text is the thing that makes the next turn
// work, because it becomes the first user block of every request after the
// boundary. Three call sites — manual, reactive and automatic compaction — build
// their summary message from it.
//
// WHY TWO UPSTREAM FUNCTIONS ARE ONE OWNED MODULE. `d1n` is a pure helper with
// exactly ONE caller, `Cq`. Under §2.4 a pure helper is owned outright and the
// graph's copy is never called — so the moment `Cq` is spliced, upstream's `d1n`
// is unreachable, and a separate splice of it would be a DEAD splice whose
// sabotage twin can never redden anything (the W0a `interrupt` and W3 `xMt`
// precedent). It was tried as its own row and its solo sabotage came back GREEN
// on both covering scenarios, which is exactly that failure showing itself. It
// lives here instead, in the same file so that its two arms are in this module's
// branch inventory, and the build footprints its upstream declaration through
// the pure-helper closure so §5 still sees it move.
//
// GENERALIZING: a pure helper reachable only through a function this wave owns
// belongs INSIDE that owned module. Splicing it separately buys a row and loses
// a liveness proof.

// ---- the rewriter (upstream `d1n`) ------------------------------------------
//
// The summarization prompt (`compaction-prompt`, this subsystem's other owned
// constant) asks the model for an `<analysis>` block followed by a `<summary>`
// block. This is the other half of that contract: discard the analysis, promote
// the summary out of its tags, normalize the blank lines.
//
// FOUR RULES, IN ORDER, AND THE ORDER IS LOAD-BEARING:
//
//   1. Drop the FIRST `<analysis>…</analysis>`. Non-greedy and not global, so a
//      second analysis block would survive — deliberate: the model is asked for
//      one.
//   2. If a `<summary>` block exists, replace it with `Summary:` and the TRIMMED
//      inner text. The match is taken before the replacement so the captured
//      group comes from the same block that gets replaced.
//   3. Collapse runs of blank lines to exactly one. This runs LAST over the whole
//      text, so the seam rule 1 left behind is cleaned up by it rather than by an
//      anchored deletion.
//   4. Trim.
//
// A response with no `<summary>` block falls through rule 2 and is returned
// essentially as written — which is what a short summarization produces, and what
// three of the corpus's four boundaries actually carry.
//
// FAITHFUL, NOT IMPROVED: `String.replace` interprets `$&` and `$1` in the
// replacement string, so a summary containing them would be expanded here.
// Upstream builds the same replacement from a template literal and behaves the
// same way; "fixing" it with a function replacement would be a parity
// difference, not a bug fix.

/** @param raw the summarization response's text, verbatim */
export function compactSummaryText(raw) {
  let text = raw;
  text = text.replace(/<analysis>[\s\S]*?<\/analysis>/, "");
  const summary = text.match(/<summary>([\s\S]*?)<\/summary>/);
  if (summary) {
    const inner = summary[1] || "";
    text = text.replace(/<summary>[\s\S]*?<\/summary>/, `Summary:\n${inner.trim()}`);
  }
  text = text.replace(/\n\n+/g, "\n\n");
  return text.trim();
}

// ---- the message (upstream `Cq`) --------------------------------------------
//
// FOUR OPTIONAL CLAUSES, APPENDED IN A FIXED ORDER, and the order is the
// contract: the preamble, then the transcript pointer, then the recent-messages
// note, then the REPL note. Each is `if`-appended behind a blank line.
//
// THE LAST CLAUSE IS DIFFERENT, and it is the one a rewrite gets wrong. When
// `suppressFollowUpQuestions` is set the function RETURNS EARLY with the resume
// instruction joined by a SINGLE newline — not a blank line like every clause
// above it, and not falling through to a common return. Every call site in the
// corpus passes it, so the single newline is in every recording.
//
// The em dashes are U+2014, as upstream writes them; they are prose, and prose
// is what this module owns.

const PREAMBLE =
  "This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.";

const TRANSCRIPT_CLAUSE =
  "If you need specific details from before compaction (like exact code snippets, error messages, or content you generated), read the full transcript at: ";

const RECENT_MESSAGES_CLAUSE = "Recent messages are preserved verbatim.";

const REPL_CLEARED_CLAUSE =
  "Your REPL VM state has been cleared as part of this compaction. Variables defined in REPL calls before this point are no longer accessible — redefine any you still need.";

const RESUME_CLAUSE =
  'Continue the conversation from where it left off without asking the user any further questions. Resume directly — do not acknowledge the summary, do not recap what was happening, do not preface with "I\'ll continue" or similar. Pick up the last task as if the break never happened.';

/**
 * @param summary the summarization response's text, verbatim
 * @param options `{ transcriptPath, recentMessagesPreserved, replStateCleared,
 *                   suppressFollowUpQuestions }`, or undefined
 */
export function compactContinuation(summary, options) {
  let text = `${PREAMBLE}\n\n${compactSummaryText(summary)}`;
  if (options?.transcriptPath) text += `\n\n${TRANSCRIPT_CLAUSE}${options.transcriptPath}`;
  if (options?.recentMessagesPreserved) text += `\n\n${RECENT_MESSAGES_CLAUSE}`;
  if (options?.replStateCleared) text += `\n\n${REPL_CLEARED_CLAUSE}`;
  // Single newline, and an early return: see the header.
  if (options?.suppressFollowUpQuestions) return `${text}\n${RESUME_CLAUSE}`;
  return text;
}
