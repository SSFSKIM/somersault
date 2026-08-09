// test/unit/duration-row.test.ts — Wave C Task 7 (EP-C4d): the end-of-turn duration row's pure half.
// `durationRow.ts` owns upstream's 8-verb past-tense vocabulary (`Nma`, L428307), its uniform-random picker
// (`SvH`, L428351), the `✻ {Verb} for {duration}` line shape (`Aha`, L428639-428728) and the
// `showTurnDuration` default (`Dc("showTurnDuration", !0)`, L428650). No React here — the all-dim assertion
// lives in `test/tui/duration-row.test.tsx`, where the row is actually painted.
import { describe, it, expect } from "vitest";
import {
  TURN_DURATION_VERBS, TURN_DURATION_GLYPH, pickTurnVerb, turnDurationLine, turnDurationEnabled,
  isInterruptSentinelFrame,
} from "../../src/tui/durationRow.js";
import { INTERRUPT_PLAIN, INTERRUPT_TOOL } from "../../src/tui/species.js";

describe("durationRow: upstream's verb vocabulary (`Nma`, L428307)", () => {
  it("carries all 8 past-tense verbs verbatim, in upstream's own order, `Sautéed` accented", () => {
    expect([...TURN_DURATION_VERBS]).toEqual(["Baked", "Brewed", "Churned", "Cogitated", "Cooked", "Crunched", "Sautéed", "Worked"]);
    // PRECOMPOSED, as `Saut\xE9ed` is in the bundle: 7 code points, not the 8 a decomposed `e`+U+0301 makes.
    expect([...TURN_DURATION_VERBS[6]!]).toHaveLength(7);
  });
  it("the glyph is `✻` U+273B (`i5`, L41482)", () => {
    expect(TURN_DURATION_GLYPH).toBe("✻");
  });
});

describe("durationRow.pickTurnVerb (`SvH`, L428351)", () => {
  it("is a uniform pick over the whole list — a seeded random reaches every index", () => {
    for (let i = 0; i < TURN_DURATION_VERBS.length; i++) {
      expect(pickTurnVerb(() => i / TURN_DURATION_VERBS.length)).toBe(TURN_DURATION_VERBS[i]);
    }
  });
  it("falls back to `Worked` at the degenerate top of the range (`?? \"Worked\"`)", () => {
    expect(pickTurnVerb(() => 1)).toBe("Worked");
  });
});

describe("durationRow.turnDurationLine (`Aha`, L428639-428728)", () => {
  const worked = () => "Worked";
  it("is `{Verb} for {ra(ms)}` behind a two-column `✻ ` gutter", () => {
    const line = turnDurationLine(4000, { pickVerb: worked });
    expect(line.text).toBe("Worked for 4s");
    expect(line.gutter).toEqual({ text: "✻ ", dim: true });
  });
  it("spells the duration with Task 6's `formatDuration` (`gqp = ra(vRe.durationMs)`) — the SPACED minute form", () => {
    expect(turnDurationLine(65_000, { pickVerb: worked }).text).toBe("Worked for 1m 5s");
    expect(turnDurationLine(0, { pickVerb: worked }).text).toBe("Worked for 0s");
    expect(turnDurationLine(3_725_000, { pickVerb: worked }).text).toBe("Worked for 1h 2m 5s");
  });
  it("marks BOTH the text and the gutter dim — the whole row is `dimColor`", () => {
    const line = turnDurationLine(4000, { pickVerb: worked });
    expect(line.dim).toBe(true);
    expect(line.gutter!.dim).toBe(true);
    expect(line.color).toBeUndefined();
  });
  it("picks the verb ONCE per row (`useState(SvH)`), so one line never mixes two", () => {
    let calls = 0;
    const line = turnDurationLine(4000, { pickVerb: () => { calls++; return "Baked"; } });
    expect(calls).toBe(1);
    expect(line.text).toBe("Baked for 4s");
  });
  it("defaults to the real picker, which always yields one of the eight verbs", () => {
    for (let i = 0; i < 40; i++) {
      expect(TURN_DURATION_VERBS).toContain(turnDurationLine(1000).text.split(" for ")[0]);
    }
  });
});

describe("durationRow.turnDurationEnabled (`Dc(\"showTurnDuration\", !0)`, L428650)", () => {
  it("defaults TRUE when the pref is absent, and only an explicit false turns it off", () => {
    expect(turnDurationEnabled({})).toBe(true);
    expect(turnDurationEnabled({ showTurnDuration: true })).toBe(true);
    expect(turnDurationEnabled({ showTurnDuration: false })).toBe(false);
  });
});

describe("durationRow.isInterruptSentinelFrame", () => {
  const userFrame = (text: string) => ({ type: "user", message: { role: "user", content: [{ type: "text", text }] } });
  it("recognises BOTH of upstream's interrupt sentinels (`Tq`/`Wk`, L108575)", () => {
    expect(isInterruptSentinelFrame(userFrame(INTERRUPT_TOOL))).toBe(true);
    expect(isInterruptSentinelFrame(userFrame(INTERRUPT_PLAIN))).toBe(true);
    expect(isInterruptSentinelFrame({ type: "user", message: { role: "user", content: INTERRUPT_PLAIN } })).toBe(true);
  });
  it("is EXACT-equality, exactly like `classifyUserText` — quoting the sentence is still a prompt", () => {
    expect(isInterruptSentinelFrame(userFrame(`${INTERRUPT_PLAIN} and then some`))).toBe(false);
    expect(isInterruptSentinelFrame(userFrame("hello"))).toBe(false);
  });
  it("ignores every non-user frame and every malformed one", () => {
    expect(isInterruptSentinelFrame({ type: "assistant", message: { content: [{ type: "text", text: INTERRUPT_PLAIN }] } })).toBe(false);
    expect(isInterruptSentinelFrame(undefined)).toBe(false);
    expect(isInterruptSentinelFrame({ type: "user" })).toBe(false);
  });
});
