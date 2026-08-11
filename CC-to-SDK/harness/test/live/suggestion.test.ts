// test/live/suggestion.test.ts — Wave C Task 12 (EP-C5), the one keyed arm: does a REAL warm suggester
// session, fed a real transcript tail and upstream's verbatim prompt, come back with something the twelve-rule
// post-filter accepts?
//
// This is the half no fake can answer. `test/unit/suggester.test.ts` proves the filter and the lifecycle;
// `test/tui/suggestion.test.tsx` proves the trigger, the placeholder and the two accept keys. What is left is
// the premise the whole epic rests on — that a Haiku-class model given this prompt produces a 2-12 word
// imperative in the user's voice rather than a refusal, a preamble, or a paragraph — and only a live run
// settles it (probe 100c saw `"Test it with the --verbose flag."`, `"Fix the test to use UTC."`).
//
// Costs and skips like every other live suite: ~$0.005 and ~5-9 s per request (probe 100c: the FIRST request
// on a session pays the spawn and the cache write, so a two-request run is ~15 s), and it skips cleanly with
// no key or token present. The controller runs it; implementers stop at the clean keyless skip.
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSuggester, postFilterSuggestion, SUGGESTION_PROMPT } from "../../src/tui/suggester.js";

const live = (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN) ? describe : describe.skip;

/** Two eligible turns' worth of conversation, in the exact shape `formatTranscriptTail` produces. */
const TAIL_A = [
  "user: Add a --verbose flag to the CLI.",
  "assistant: Added `--verbose` to the argument parser and threaded it into the logger. It defaults to false.",
  "user: Now write a test for it.",
  "assistant: Wrote `test/cli/verbose.test.ts` with two cases: the flag absent, and the flag set. Neither has been run yet.",
].join("\n");

/** A second tail, sent through the SAME warm session — which is what the product does, and the thing probe
 *  100c checked for cost creep. It also proves the session is not single-use. */
const TAIL_B = [
  "user: Rename the User model to Account.",
  "assistant: Renamed the model, its table, and 14 references across 6 files. The migration is written but not applied.",
].join("\n");

live("live follow-up suggestion (real warm suggester session)", () => {
  it("returns a suggestion the post-filter accepts, twice, from one warm session", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "cc-suggestion-live-"));
    const suggester = createSuggester({ cwd });
    try {
      const first = await suggester.request({ transcriptTail: TAIL_A });
      // A null here is NOT automatically a failure of the harness — the prompt's own last instruction is to
      // stay silent when the next step is not obvious — but on a tail this pointed ("wrote a test, has not run
      // it") a silent model would mean the feature has no content to show, which is the thing this test is for.
      expect(first, "the suggester returned nothing for an obvious follow-up").not.toBeNull();
      expect(postFilterSuggestion(first!)).toEqual({ ok: true, text: first });
      expect(first!.split(/\s+/).length).toBeLessThanOrEqual(12);
      expect(first!.length).toBeLessThan(100);

      const second = await suggester.request({ transcriptTail: TAIL_B });
      expect(second).not.toBeNull();
      expect(postFilterSuggestion(second!)).toEqual({ ok: true, text: second });
      expect(second).not.toBe(first);                       // the second request read the second tail, not a cached reply
    } finally {
      suggester.retire();
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 180_000);

  it("aborting mid-flight yields nothing, even though the request completes on the wire", async () => {
    // The keystroke path (`scd`): the suggestion must never reach the composer once the user has started
    // typing. Live because the discard has to hold against a REAL in-flight turn, not an instantly-resolved
    // fake — the whole risk is a ~5 s window during which the user types.
    const cwd = mkdtempSync(join(tmpdir(), "cc-suggestion-abort-"));
    const suggester = createSuggester({ cwd });
    try {
      const pending = suggester.request({ transcriptTail: TAIL_A });
      suggester.abort();
      expect(await pending).toBeNull();
    } finally {
      suggester.retire();
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 180_000);

  it("sends upstream's prompt unmodified — the transcription is what was actually billed", () => {
    // Cheap, keyless-relevant, and it belongs beside the two calls above: whatever the model answered, it
    // answered THIS. A drifted prompt would make both results above meaningless.
    expect(SUGGESTION_PROMPT.startsWith("[SUGGESTION MODE:")).toBe(true);
    expect(SUGGESTION_PROMPT.trimEnd()).toBe(SUGGESTION_PROMPT);
  });
});
