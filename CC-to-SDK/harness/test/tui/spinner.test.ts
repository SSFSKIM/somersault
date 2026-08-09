import { describe, it, expect } from "vitest";
import {
  SPINNER_VERBS, SPINNER_FRAMES, glyphFrame, pickVerb, formatElapsed, spinnerStatus,
  thinkingWord, modeArrow, easeChars, estimateTokens, EASE_STEP_MS, QUIET_MS,
  initPhaseState, advancePhase, phaseFor, phaseLabel, thinkingStatusOf, rotateVerb,
  type PhaseInput,
} from "../../src/tui/spinner.js";

describe("spinner verbs", () => {
  it("carries the full 187-verb CC vocabulary including signature verbs", () => {
    expect(SPINNER_VERBS.length).toBe(187);
    for (const v of ["Cogitating", "Noodling", "Clauding", "Schlepping", "Herding"]) expect(SPINNER_VERBS).toContain(v);
  });
  it("pickVerb maps [0,1) deterministically and never goes out of bounds", () => {
    expect(pickVerb(0)).toBe(SPINNER_VERBS[0]);
    expect(pickVerb(0.999999)).toBe(SPINNER_VERBS[SPINNER_VERBS.length - 1]);
    expect(SPINNER_VERBS).toContain(pickVerb(1));   // clamped, not undefined
  });
});

describe("spinner glyph", () => {
  it("pulses out then back through the asterisk frames", () => {
    expect(SPINNER_FRAMES).toEqual(["·", "✢", "✳", "✶", "✻", "✽", "✽", "✻", "✶", "✳", "✢", "·"]);
    expect(glyphFrame(0)).toBe("·");
    expect(glyphFrame(4)).toBe("✻");
    expect(glyphFrame(SPINNER_FRAMES.length)).toBe("·");  // wraps
    expect(glyphFrame(-1)).toBe("·");                     // negative-safe (last frame)
  });
});

// ── Wave C Task 6: the elapsed formatter, ported WHOLE ────────────────────────────────────────────────
// `$st` (bundle L107079, export map L107029 `formatBarElapsed`). The pre-Wave-C port carried a header
// comment naming its own two defects (a space in `1m 05s`, and no rollover past minutes) and told whoever
// touched the spinner next to port the function whole. This is that port; these are its golden cases.
describe("formatElapsed — upstream `$st` in full", () => {
  it("spells seconds under a minute", () => {
    expect(formatElapsed(0)).toBe("0s");
    expect(formatElapsed(4000)).toBe("4s");
    expect(formatElapsed(4999)).toBe("4s");        // floor, not round
    expect(formatElapsed(59000)).toBe("59s");
    expect(formatElapsed(-100)).toBe("0s");        // clamped
  });
  it("spells minutes with NO space and a zero-padded second", () => {
    expect(formatElapsed(60000)).toBe("1m00s");
    expect(formatElapsed(65000)).toBe("1m05s");
    expect(formatElapsed(3599000)).toBe("59m59s");
  });
  it("rolls over at the hour into `NhMMm`, dropping seconds", () => {
    expect(formatElapsed(3600000)).toBe("1h00m");
    expect(formatElapsed(3720000)).toBe("1h02m");
    expect(formatElapsed(86399000)).toBe("23h59m");
  });
  it("rolls over at the day into `NdHHh`, dropping minutes", () => {
    expect(formatElapsed(86400000)).toBe("1d00h");
    expect(formatElapsed(183600000)).toBe("2d03h");
    // The defect the old header used as its own example: 25 h 1 m 1 s read `1500m 01s`.
    expect(formatElapsed(90061000)).toBe("1d01h");
  });
});

// ── The eased character estimate (D-C6) ───────────────────────────────────────────────────────────────
describe("token estimate — eased chars / 4", () => {
  it("divides the ANIMATED char count by four, rounded", () => {
    expect(estimateTokens(0)).toBe(0);
    expect(estimateTokens(2)).toBe(1);            // round, not floor
    expect(estimateTokens(336)).toBe(84);         // the annex's `↓ 84 tokens` frame
  });
  it("eases at upstream's three rates: +3 under a 70-char gap, 15% under 200, +50 above", () => {
    expect(EASE_STEP_MS).toBe(50);
    expect(easeChars(0, 60, 1)).toBe(3);                       // gap 60  → +3
    expect(easeChars(0, 60, 4)).toBe(12);                      // four 50 ms steps
    expect(easeChars(0, 100, 1)).toBe(15);                     // gap 100 → max(8, ceil(15))
    expect(easeChars(0, 80, 1)).toBe(12);                      // gap 80  → max(8, ceil(12))
    expect(easeChars(0, 5000, 1)).toBe(50);                    // gap ≥200 → +50
    expect(easeChars(0, 5000, 3)).toBe(150);
  });
  it("never overshoots the target and never runs backwards", () => {
    expect(easeChars(0, 10, 100)).toBe(10);                    // clamps at the target
    expect(easeChars(500, 100, 10)).toBe(500);                 // a shrinking target does not rewind
    expect(easeChars(7, 7, 5)).toBe(7);
  });
});

// ── The phase ladder ──────────────────────────────────────────────────────────────────────────────────
describe("thinking word ladder — upstream `GtH`", () => {
  it("steps at exactly 10 s / 20 s / 30 s / 45 s", () => {
    expect(thinkingWord(0)).toBe("thinking");
    expect(thinkingWord(9999)).toBe("thinking");
    expect(thinkingWord(10000)).toBe("still thinking");
    expect(thinkingWord(19999)).toBe("still thinking");
    expect(thinkingWord(20000)).toBe("thinking more");
    expect(thinkingWord(29999)).toBe("thinking more");
    expect(thinkingWord(30000)).toBe("thinking some more");
    expect(thinkingWord(44999)).toBe("thinking some more");
    expect(thinkingWord(45000)).toBe("almost done thinking");
    expect(thinkingWord(600000)).toBe("almost done thinking");
  });
});

describe("phase machine — upstream `f0p`/`m0p`/`h0p`", () => {
  const input = (over: Partial<PhaseInput>): PhaseInput =>
    ({ now: 0, isThinking: false, hasActiveTools: false, thinkingStatus: null, showToolTimer: true, ...over });
  const run = (steps: PhaseInput[]) => {
    let s = initPhaseState();
    let phase = phaseFor(s, steps[0]!);
    for (const i of steps) { s = advancePhase(s, i); phase = phaseFor(s, i); }
    return phase;
  };

  it("reports `running tool for {t}` only once a tool has been active two seconds", () => {
    const early = run([input({ now: 0, hasActiveTools: true }), input({ now: 1999, hasActiveTools: true })]);
    expect(early).toEqual({ kind: "none" });
    const late = run([input({ now: 0, hasActiveTools: true }), input({ now: 5000, hasActiveTools: true })]);
    expect(late).toEqual({ kind: "tool-running", toolMs: 5000 });
    expect(phaseLabel(late)).toBe("running tool for 5s");
  });

  it("reports `ran tool for {t}` after the window closes", () => {
    const done = run([
      input({ now: 0, hasActiveTools: true }),
      input({ now: 4000, hasActiveTools: true }),
      input({ now: 4000, hasActiveTools: false }),
      input({ now: 9000, hasActiveTools: false }),
    ]);
    expect(done).toEqual({ kind: "tool-done", toolMs: 4000 });
    expect(phaseLabel(done)).toBe("ran tool for 4s");
  });

  it("reports the thinking ladder against the burst start, and suppresses it while tools run", () => {
    const thinking = run([
      input({ now: 1000, isThinking: true, thinkingStatus: "thinking" }),
      input({ now: 26000, isThinking: true, thinkingStatus: "thinking" }),
    ]);
    expect(thinking).toEqual({ kind: "thinking", thinkingMs: 25000 });
    expect(phaseLabel(thinking)).toBe("thinking more");
    const busy = run([
      input({ now: 1000, isThinking: true, thinkingStatus: "thinking" }),
      input({ now: 26000, isThinking: true, thinkingStatus: "thinking", hasActiveTools: true }),
    ]);
    expect(busy.kind).not.toBe("thinking");
  });

  it("reports `thought for {N}s` from a numeric thinking status, floored at one second", () => {
    expect(phaseLabel(run([input({ thinkingStatus: 4600 })]))).toBe("thought for 5s");
    expect(phaseLabel(run([input({ thinkingStatus: 200 })]))).toBe("thought for 1s");
  });

  it("appends the effort suffix to the thinking rung only", () => {
    expect(phaseLabel({ kind: "thinking", thinkingMs: 0 }, " with high effort")).toBe("thinking with high effort");
    expect(phaseLabel({ kind: "thought-for", thoughtMs: 3000 }, " with high effort")).toBe("thought for 3s");
    expect(phaseLabel({ kind: "none" })).toBeNull();
  });

  it("keeps the tool timer off when the caller does not ask for it", () => {
    const s = [input({ now: 0, hasActiveTools: true, showToolTimer: false }), input({ now: 9000, hasActiveTools: true, showToolTimer: false })];
    expect(run(s)).toEqual({ kind: "none" });
  });
});

describe("thinkingStatusOf — the `thinking` → `thought for Ns` → nothing window", () => {
  it("reads `thinking` while a burst is open", () => {
    expect(thinkingStatusOf({ startedAt: 1000 }, true, 3000)).toBe("thinking");
  });
  it("holds `thinking` for a full two seconds even when the burst was shorter", () => {
    const burst = { startedAt: 1000, endedAt: 1500, ms: 500 };
    expect(thinkingStatusOf(burst, false, 1600)).toBeNull();      // not yet — but not `thought for` either
    expect(thinkingStatusOf(burst, false, 3000)).toBe(500);       // appears at startedAt + 2000
  });
  it("shows the duration for two seconds and then falls silent", () => {
    const burst = { startedAt: 0, endedAt: 8000, ms: 8000 };
    expect(thinkingStatusOf(burst, false, 8000)).toBe(8000);
    expect(thinkingStatusOf(burst, false, 9999)).toBe(8000);
    expect(thinkingStatusOf(burst, false, 10000)).toBeNull();
  });
  it("is null with no burst at all", () => {
    expect(thinkingStatusOf(undefined, false, 5000)).toBeNull();
  });
});

describe("mode arrow", () => {
  it("points DOWN for every receiving mode and UP for the request", () => {
    for (const m of ["tool-input", "tool-use", "responding", "thinking"] as const) expect(modeArrow(m)).toBe("↓");
    expect(modeArrow("requesting")).toBe("↑");
    expect(modeArrow(undefined)).toBe("");
  });
});

// ── The parenthetical ─────────────────────────────────────────────────────────────────────────────────
describe("spinnerStatus — the width-adaptive parenthetical", () => {
  it("stays SILENT for the first sixteen seconds of a quiet turn", () => {
    expect(QUIET_MS).toBe(16000);
    expect(spinnerStatus({ elapsedMs: 3000 })).toBe("");
    expect(spinnerStatus({ elapsedMs: 16000 })).toBe("");        // strict `>`
    expect(spinnerStatus({ elapsedMs: 16001 })).toBe("(16s)");
  });
  it("opens the moment tokens exist, elapsed first then the arrowed count", () => {
    expect(spinnerStatus({ elapsedMs: 2000, tokens: 84, mode: "responding" })).toBe("(2s · ↓ 84 tokens)");
    expect(spinnerStatus({ elapsedMs: 2000, tokens: 84, mode: "requesting" })).toBe("(2s · ↑ 84 tokens)");
    expect(spinnerStatus({ elapsedMs: 2000, tokens: 84 })).toBe("(2s · 84 tokens)");   // no mode → no arrow box
  });
  it("omits the token segment entirely while the estimate is zero", () => {
    expect(spinnerStatus({ elapsedMs: 20000, tokens: 0, mode: "responding" })).toBe("(20s)");
  });
  it("spells the count through the compact formatter", () => {
    expect(spinnerStatus({ elapsedMs: 2000, tokens: 1500, mode: "responding" })).toBe("(2s · ↓ 1.5k tokens)");
  });
  it("carries the phase as the last segment", () => {
    expect(spinnerStatus({ elapsedMs: 1000, phase: { kind: "thinking", thinkingMs: 0 } })).toBe("(1s · thinking)");
    expect(spinnerStatus({ elapsedMs: 2000, tokens: 84, mode: "thinking", phase: { kind: "thinking", thinkingMs: 0 } }))
      .toBe("(2s · ↓ 84 tokens · thinking)");
    expect(spinnerStatus({ elapsedMs: 3000, phase: { kind: "tool-running", toolMs: 3000 } })).toBe("(3s · running tool for 3s)");
  });
  it("collapses to the phase alone when nothing else fits", () => {
    // `lr`: the phase is a thinking rung, there is no suffix, and neither elapsed nor tokens cleared its gate.
    const narrow = spinnerStatus({ elapsedMs: 1000, phase: { kind: "thinking", thinkingMs: 0 }, columns: 30, messageWidth: 12 });
    expect(narrow).toBe("(thinking)");
  });
  it("degrades a long thinking rung to the bare word before dropping it", () => {
    // `still thinking` (14) does not fit, but `thinking` (8) does.
    const out = spinnerStatus({ elapsedMs: 1000, phase: { kind: "thinking", thinkingMs: 12000 }, columns: 30, messageWidth: 12 });
    expect(out).toBe("(thinking)");
  });
  it("drops segments right to left as the terminal narrows", () => {
    const full = { elapsedMs: 2000, tokens: 84, mode: "responding" as const, phase: { kind: "thinking", thinkingMs: 0 } as const, messageWidth: 12 };
    expect(spinnerStatus({ ...full, columns: 120 })).toBe("(2s · ↓ 84 tokens · thinking)");
    expect(spinnerStatus({ ...full, columns: 40 })).toBe("(2s · thinking)");
    expect(spinnerStatus({ ...full, columns: 30 })).toBe("(thinking)");
    expect(spinnerStatus({ ...full, columns: 20 })).toBe("");
  });
  it("puts an override suffix ahead of everything and keeps the real parens", () => {
    expect(spinnerStatus({ elapsedMs: 2000, tokens: 84, mode: "responding", suffix: "esc to interrupt" }))
      .toBe("(esc to interrupt · 2s · ↓ 84 tokens)");
  });
  it("forces every segment on in verbose mode", () => {
    expect(spinnerStatus({ elapsedMs: 1000, verbose: true })).toBe("(1s)");
  });
});

describe("gerund rotation", () => {
  it("re-picks between phases and holds steady inside one", () => {
    const picks = ["Baking", "Herding", "Noodling"]; let i = 0;
    const pick = () => picks[i++ % picks.length]!;
    expect(rotateVerb("Baking", "none", "none", pick)).toBe("Baking");        // no transition → no re-pick
    expect(i).toBe(0);
    expect(rotateVerb("Baking", "none", "thinking", pick)).toBe("Baking");    // first pick off the injected list
    expect(rotateVerb("Baking", "thinking", "tool-running", pick)).toBe("Herding");
  });
});
