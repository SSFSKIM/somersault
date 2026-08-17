// test/tui/questionDialog.test.tsx — the AskUserQuestion dialog (Goal B Task 8): sequential per-question
// flow, [i/N] progress, header chips, multiSelect (space), an always-present "Other" free-text row →
// `response` (probe 65E's proven channel), Esc/malformed-input deny (never a fabricated answer).
import { describe, it, expect } from "vitest";
import React from "react";
import { renderWithKeymap as render } from "./keysTestUtil.js";
import { QuestionDialog, parseQuestions } from "../../src/tui/QuestionDialog.js";

const frame = (f: () => string | undefined) => f() ?? "";
/** `Select` paints the gutter and the index as SEPARATE Text nodes, so the raw frame has escapes
 *  between `❯` and `3.` — every row-cursor assertion below reads the stripped frame. */
const plain = (f: () => string | undefined) => (f() ?? "").replace(/\x1b\[[0-9;]*m/g, "");
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) { await new Promise((r) => setTimeout(r, 0)); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}

const INPUT = { questions: [
  { question: "Red or blue?", header: "Color", multiSelect: false, options: [{ label: "red", description: "warm" }, { label: "blue", description: "cool" }] },
  { question: "Which meals?", header: "Meals", multiSelect: true, options: [{ label: "breakfast", description: "" }, { label: "dinner", description: "" }] },
] };

describe("<QuestionDialog>", () => {
  it("renders the header chip, progress marker, options with descriptions, and the Other row", async () => {
    const { lastFrame } = render(<QuestionDialog req={{ input: INPUT }} onAnswer={() => {}} onDeny={() => {}} />);
    await waitFor(() => frame(lastFrame).includes("Red or blue?"));
    const f = frame(lastFrame);
    expect(f).toContain("[Color]");
    expect(f).toContain("[1/2]");
    expect(f).toContain("red");
    expect(f).toContain("warm");
    expect(f).toContain("blue");
    expect(f).toContain("cool");
    // F6 T2b: the Other row is a `Select` input row now, and an unfocused empty one renders its PLACEHOLDER,
    // not its label (`RLe`, L396618 — `tU || placeholder || label`). Upstream's own question dialog shows the
    // same thing, trailing period and all (L504097). The pin moves to the string actually on screen.
    expect(f).toContain("Type something.");
  });

  // F6 T2b acceptance 6: the whole point of moving this list onto the shared primitive — the movement keys
  // the hand-rolled list never had (only ↓ moved it) all arrive at once.
  it("single-select: j/k, ctrl+n/ctrl+p and Home/End all move the row cursor", async () => {
    const singleQ = { questions: [INPUT.questions[0]] };
    const { stdin, lastFrame } = render(<QuestionDialog req={{ input: singleQ }} onAnswer={() => {}} onDeny={() => {}} />);
    await waitFor(() => frame(lastFrame).includes("Red or blue?"));
    const row = (n: string) => frame(lastFrame).replace(/\x1b\[[0-9;]*m/g, "").split("\n").some((l) => l.includes(`❯ ${n}.`));
    expect(row("1")).toBe(true);
    stdin.write("j"); await waitFor(() => row("2"));
    stdin.write("k"); await waitFor(() => row("1"));
    stdin.write("\x0e"); await waitFor(() => row("2"));          // ctrl+n
    stdin.write("\x10"); await waitFor(() => row("1"));          // ctrl+p
    stdin.write("\x1b[F"); await waitFor(() => row("3"));        // End → the Other input row
    // Home is deliberately dead ON an input row (Select.tsx's header: upstream returns before the page/first/
    // last branch while a text row has the cursor) — and so is a bare `k`, which is a CHARACTER there. Only
    // up/down/ctrl+p/ctrl+n still leave a text row (L396727-396748), so that is how we step off it.
    stdin.write("\x10"); await waitFor(() => row("2"));         // ctrl+p
    stdin.write("\x1b[H"); await waitFor(() => row("1"));        // Home
  });

  it("number key on a single-select answers and ADVANCES to question 2 of 2", async () => {
    const answers: [Record<string, string>, string | undefined][] = [];
    const { stdin, lastFrame } = render(<QuestionDialog req={{ input: INPUT }} onAnswer={(a, r) => answers.push([a, r])} onDeny={() => {}} />);
    await waitFor(() => frame(lastFrame).includes("Red or blue?"));
    stdin.write("2");                                       // selects "blue" (option index 1)
    await waitFor(() => frame(lastFrame).includes("Which meals?"));
    const f = frame(lastFrame);
    expect(f).toContain("[2/2]");
    expect(f).not.toContain("Red or blue?");
    expect(answers).toEqual([]);                             // not the last question yet — no onAnswer
  });

  // F6 T2: multiSelect questions render the `MultiSelect` primitive, so the commit moved off Enter-on-a-row
  // (which now TOGGLES, L397399-397409) and onto the Submit row upstream puts at the end of the list (L504149).
  it("multiSelect: space toggles rows and the Submit row commits the checked labels joined with ', '", async () => {
    const answers: [Record<string, string>, string | undefined][] = [];
    const { stdin, lastFrame } = render(<QuestionDialog req={{ input: INPUT }} onAnswer={(a, r) => answers.push([a, r])} onDeny={() => {}} />);
    await waitFor(() => frame(lastFrame).includes("Red or blue?"));
    stdin.write("2");                                       // Q1: blue
    await waitFor(() => frame(lastFrame).includes("Which meals?"));
    expect(frame(lastFrame)).toContain("Submit");           // the last question of two → "Submit", not "Next"
    stdin.write(" ");                                       // toggle breakfast (row 0)
    await waitFor(() => frame(lastFrame).includes("[✔]"));
    stdin.write("\x1b[B");                                  // ↓ to dinner
    await new Promise((r) => setTimeout(r, 20));
    stdin.write(" ");                                       // toggle dinner (row 1)
    await new Promise((r) => setTimeout(r, 20));
    stdin.write("\x1b[B"); await new Promise((r) => setTimeout(r, 20));   // ↓ onto the Other row…
    stdin.write("\x1b[B"); await new Promise((r) => setTimeout(r, 20));   // …and ↓ again onto Submit
    stdin.write("\r");
    await waitFor(() => answers.length === 1);
    expect(answers[0]).toEqual([{ "Red or blue?": "blue", "Which meals?": "breakfast, dinner" }, undefined]);
  });

  it("multiSelect: the submit label is 'Next' before the last question (L504149)", async () => {
    const two = { questions: [INPUT.questions[1], INPUT.questions[0]] };   // multi first, single second
    const { lastFrame } = render(<QuestionDialog req={{ input: two }} onAnswer={() => {}} onDeny={() => {}} />);
    await waitFor(() => frame(lastFrame).includes("Which meals?"));
    const rows = frame(lastFrame).replace(/\x1b\[[0-9;]*m/g, "").split("\n");
    expect(rows.some((l) => /^\W*\s{5}Next\s/.test(l))).toBe(true);        // the submit ROW reads "Next"…
    expect(rows.some((l) => /^\W*\s{5}Submit\s/.test(l))).toBe(false);     // …and never "Submit"
  });

  it("multiSelect: the Other row is a permanent input row — typing selects it and its text lands in `response`", async () => {
    const single = { questions: [INPUT.questions[1]] };
    const answers: [Record<string, string>, string | undefined][] = [];
    const { stdin, lastFrame } = render(<QuestionDialog req={{ input: single }} onAnswer={(a, r) => answers.push([a, r])} onDeny={() => {}} />);
    await waitFor(() => frame(lastFrame).includes("Which meals?"));
    // No trailing period on the multiSelect placeholder (L504097) — the negative arm is the real pin:
    // "Type something." CONTAINS "Type something", so the positive alone cannot catch a period regression.
    expect(frame(lastFrame)).toContain("Type something");
    expect(frame(lastFrame)).not.toContain("Type something.");
    stdin.write("3");                                       // the digit toggles the Other row without moving onto it
    await waitFor(() => frame(lastFrame).includes("[✔]"));
    stdin.write("\x1b[B"); await new Promise((r) => setTimeout(r, 20));
    stdin.write("\x1b[B"); await new Promise((r) => setTimeout(r, 20));   // now ON the Other row
    stdin.write("brunch");
    await waitFor(() => frame(lastFrame).includes("brunch"));
    stdin.write("\x1b[B"); await new Promise((r) => setTimeout(r, 20));   // ↓ onto Submit
    stdin.write("\r");
    await waitFor(() => answers.length === 1);
    expect(answers[0]).toEqual([{}, "brunch"]);             // no answers entry for an Other-only reply
  });

  it("multiSelect: the bare y/n of the Confirmation table cannot decide the question (the scope is off)", async () => {
    const single = { questions: [INPUT.questions[1]] };
    let denies = 0;
    const answers: unknown[] = [];
    const { stdin, lastFrame } = render(<QuestionDialog req={{ input: single }} onAnswer={(a, r) => answers.push([a, r])} onDeny={() => { denies++; }} />);
    await waitFor(() => frame(lastFrame).includes("Which meals?"));
    stdin.write("y"); await new Promise((r) => setTimeout(r, 20));
    stdin.write("n"); await new Promise((r) => setTimeout(r, 20));
    expect([answers.length, denies]).toEqual([0, 0]);
    stdin.write("\x1b"); await waitFor(() => denies === 1);   // …escape still declines
  });

  it("Other: selecting it opens a text line; typed text lands in `response`, the question gets NO answers entry", async () => {
    const single = { questions: [INPUT.questions[0]] };
    const answers: [Record<string, string>, string | undefined][] = [];
    const { stdin, lastFrame } = render(<QuestionDialog req={{ input: single }} onAnswer={(a, r) => answers.push([a, r])} onDeny={() => {}} />);
    await waitFor(() => frame(lastFrame).includes("Red or blue?"));
    stdin.write("3");                                       // the digit focuses the (empty) Other input row
    await waitFor(() => plain(lastFrame).includes("❯ 3."));
    stdin.write("nope");
    await waitFor(() => frame(lastFrame).includes("nope"));
    stdin.write("\r");
    await waitFor(() => answers.length === 1);
    expect(answers[0]).toEqual([{}, "nope"]);
  });

  it("Other: a CHUNKED write (typed text + trailing \\r in ONE call) commits the text, not a silent close (gb12)", async () => {
    const single = { questions: [INPUT.questions[0]] };
    const answers: [Record<string, string>, string | undefined][] = [];
    const { stdin, lastFrame } = render(<QuestionDialog req={{ input: single }} onAnswer={(a, r) => answers.push([a, r])} onDeny={() => {}} />);
    await waitFor(() => frame(lastFrame).includes("Red or blue?"));
    stdin.write("3");
    await waitFor(() => plain(lastFrame).includes("❯ 3."));
    stdin.write("green actually\r");                       // one chunk: text AND the submit together
    await waitFor(() => answers.length === 1);
    expect(answers[0]).toEqual([{}, "green actually"]);
  });

  it("Other: plain text chunks (no newline) still just append", async () => {
    const single = { questions: [INPUT.questions[0]] };
    const answers: [Record<string, string>, string | undefined][] = [];
    const { stdin, lastFrame } = render(<QuestionDialog req={{ input: single }} onAnswer={(a, r) => answers.push([a, r])} onDeny={() => {}} />);
    await waitFor(() => frame(lastFrame).includes("Red or blue?"));
    stdin.write("3");
    await waitFor(() => plain(lastFrame).includes("❯ 3."));
    stdin.write("gr"); await waitFor(() => plain(lastFrame).includes("❯ 3. gr"));
    stdin.write("een"); await waitFor(() => plain(lastFrame).includes("❯ 3. green"));
    expect(answers).toEqual([]);
    stdin.write("\r");
    await waitFor(() => answers.length === 1);
    expect(answers[0]).toEqual([{}, "green"]);
  });

  // PIN MOVED, not weakened (F6 T2b). The Other row used to be a MODE, and an empty Enter merely closed it.
  // It is a `Select` input row now, and upstream's `RLe` rule is that an empty submit CANCELS the whole list
  // (L397115-397118) — which for this dialog means declining the question. Still never a fabricated answer.
  it("Other: a bare Enter on an EMPTY buffer now DECLINES the question (RLe's empty-submit rule)", async () => {
    const single = { questions: [INPUT.questions[0]] };
    let denies = 0;
    const answers: unknown[] = [];
    const { stdin, lastFrame } = render(<QuestionDialog req={{ input: single }} onAnswer={(a, r) => answers.push([a, r])} onDeny={() => { denies++; }} />);
    await waitFor(() => frame(lastFrame).includes("Red or blue?"));
    stdin.write("3");
    await waitFor(() => plain(lastFrame).includes("❯ 3."));
    stdin.write("   ");                                     // whitespace only — `.trim()` is falsy
    await new Promise((r) => setTimeout(r, 20));
    stdin.write("\r");
    await waitFor(() => denies === 1);
    expect(answers).toEqual([]);
  });

  // PIN MOVED (F6 T2b), and this one is a RECORDED DIVERGENCE in both directions. The old bespoke row split a
  // pasted run at the first newline and submitted the head (gb12), because a stray `\r` inside a paste must
  // never settle a decision. A `Select` input row cannot submit mid-paste at all — `InputText` is single-line
  // and drops the C0 bytes — so the accident is structurally impossible now, but the newline is LOST rather
  // than preserved (upstream's `Vs` is genuinely multiline; ours is the recorded T1 simplification).
  it("Other: a multi-line paste never auto-submits — the newlines are dropped and Enter still commits", async () => {
    const single = { questions: [INPUT.questions[0]] };
    const answers: [Record<string, string>, string | undefined][] = [];
    const { stdin, lastFrame } = render(<QuestionDialog req={{ input: single }} onAnswer={(a, r) => answers.push([a, r])} onDeny={() => {}} />);
    await waitFor(() => frame(lastFrame).includes("Red or blue?"));
    stdin.write("3");
    await waitFor(() => plain(lastFrame).includes("❯ 3."));
    stdin.write("a\nb\n");
    await waitFor(() => plain(lastFrame).includes("❯ 3. ab"));
    expect(answers, "no key inside the paste settled the question").toEqual([]);
    stdin.write("\r");
    await waitFor(() => answers.length === 1);
    expect(answers[0]).toEqual([{}, "ab"]);
  });

  it("Esc fires onDeny (the model is told no answer is available — never a fabricated one)", async () => {
    let denies = 0;
    const answers: unknown[] = [];
    const { stdin, lastFrame } = render(<QuestionDialog req={{ input: INPUT }} onAnswer={(a, r) => answers.push([a, r])} onDeny={() => { denies++; }} />);
    await waitFor(() => frame(lastFrame).includes("Red or blue?"));
    stdin.write("\x1b");
    await waitFor(() => denies === 1);
    expect(answers).toEqual([]);
  });

  it("attribution: subagentType renders 'Subagent (code-reviewer) asks:'", async () => {
    const { lastFrame } = render(<QuestionDialog req={{ input: INPUT, subagentType: "code-reviewer" }} onAnswer={() => {}} onDeny={() => {}} />);
    await waitFor(() => frame(lastFrame).includes("Red or blue?"));
    expect(frame(lastFrame)).toContain("Subagent (code-reviewer) asks:");
  });

  it("malformed input (no questions array) auto-denies on mount", async () => {
    let denies = 0;
    render(<QuestionDialog req={{ input: {} }} onAnswer={() => {}} onDeny={() => { denies++; }} />);
    await waitFor(() => denies === 1);
  });

  // BL6 review Minor 3: `onDeny` now means "a human refused" — it claims a present user to the model and
  // ends the turn. A malformed payload nobody saw must not borrow that, so the mount guard has its own exit.
  it("malformed input takes onMalformed when the caller offers one — never the human-decline callback", async () => {
    let denies = 0, malformed = 0;
    render(<QuestionDialog req={{ input: {} }} onAnswer={() => {}} onDeny={() => { denies++; }} onMalformed={() => { malformed++; }} />);
    await waitFor(() => malformed === 1);
    await new Promise((r) => setTimeout(r, 20));
    expect(denies).toBe(0);
  });
});

describe("parseQuestions", () => {
  it("parses questions/options and defaults multiSelect false, header/description absent", () => {
    const qs = parseQuestions(INPUT);
    expect(qs).toHaveLength(2);
    expect(qs[0]).toEqual({ question: "Red or blue?", header: "Color", multiSelect: false, options: [{ label: "red", description: "warm" }, { label: "blue", description: "cool" }] });
  });
  it("returns [] for malformed input", () => {
    expect(parseQuestions({})).toEqual([]);
    expect(parseQuestions({ questions: "nope" })).toEqual([]);
  });
});
