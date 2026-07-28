// test/tui/questionDialog.test.tsx — the AskUserQuestion dialog (Goal B Task 8): sequential per-question
// flow, [i/N] progress, header chips, multiSelect (space), an always-present "Other" free-text row →
// `response` (probe 65E's proven channel), Esc/malformed-input deny (never a fabricated answer).
import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { QuestionDialog, parseQuestions } from "../../src/tui/QuestionDialog.js";

const frame = (f: () => string | undefined) => f() ?? "";
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
    expect(f).toContain("Other");
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

  it("multiSelect: space toggles, enter commits the checked labels joined with ', ' and fires onAnswer with BOTH answers", async () => {
    const answers: [Record<string, string>, string | undefined][] = [];
    const { stdin, lastFrame } = render(<QuestionDialog req={{ input: INPUT }} onAnswer={(a, r) => answers.push([a, r])} onDeny={() => {}} />);
    await waitFor(() => frame(lastFrame).includes("Red or blue?"));
    stdin.write("2");                                       // Q1: blue
    await waitFor(() => frame(lastFrame).includes("Which meals?"));
    stdin.write(" ");                                       // toggle breakfast (idx 0)
    await new Promise((r) => setTimeout(r, 20));
    stdin.write("\x1b[B");                                  // ↓ to dinner
    await new Promise((r) => setTimeout(r, 20));
    stdin.write(" ");                                       // toggle dinner (idx 1)
    await new Promise((r) => setTimeout(r, 20));
    stdin.write("\r");                                      // commit
    await waitFor(() => answers.length === 1);
    expect(answers[0]).toEqual([{ "Red or blue?": "blue", "Which meals?": "breakfast, dinner" }, undefined]);
  });

  it("Other: selecting it opens a text line; typed text lands in `response`, the question gets NO answers entry", async () => {
    const single = { questions: [INPUT.questions[0]] };
    const answers: [Record<string, string>, string | undefined][] = [];
    const { stdin, lastFrame } = render(<QuestionDialog req={{ input: single }} onAnswer={(a, r) => answers.push([a, r])} onDeny={() => {}} />);
    await waitFor(() => frame(lastFrame).includes("Red or blue?"));
    stdin.write("3");                                       // "3. Other…" (otherIdx = 2 options)
    await waitFor(() => frame(lastFrame).includes("❯ Other:"));
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
    await waitFor(() => frame(lastFrame).includes("❯ Other:"));
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
    await waitFor(() => frame(lastFrame).includes("❯ Other:"));
    stdin.write("gr"); await waitFor(() => frame(lastFrame).includes("❯ Other: gr"));
    stdin.write("een"); await waitFor(() => frame(lastFrame).includes("❯ Other: green"));
    expect(answers).toEqual([]);
    stdin.write("\r");
    await waitFor(() => answers.length === 1);
    expect(answers[0]).toEqual([{}, "green"]);
  });

  it("Other: a bare Enter on an EMPTY buffer keeps its existing meaning (closes the row, no answer)", async () => {
    const single = { questions: [INPUT.questions[0]] };
    const answers: unknown[] = [];
    const { stdin, lastFrame } = render(<QuestionDialog req={{ input: single }} onAnswer={(a, r) => answers.push([a, r])} onDeny={() => {}} />);
    await waitFor(() => frame(lastFrame).includes("Red or blue?"));
    stdin.write("3");
    await waitFor(() => frame(lastFrame).includes("❯ Other:"));
    stdin.write("\r");                                      // bare enter, nothing typed
    await waitFor(() => frame(lastFrame).includes("3. Other…"));   // back to list mode
    expect(answers).toEqual([]);
  });

  it("Other: a multi-line paste commits only the text up to the first newline", async () => {
    const single = { questions: [INPUT.questions[0]] };
    const answers: [Record<string, string>, string | undefined][] = [];
    const { stdin, lastFrame } = render(<QuestionDialog req={{ input: single }} onAnswer={(a, r) => answers.push([a, r])} onDeny={() => {}} />);
    await waitFor(() => frame(lastFrame).includes("Red or blue?"));
    stdin.write("3");
    await waitFor(() => frame(lastFrame).includes("❯ Other:"));
    stdin.write("a\nb\n");
    await waitFor(() => answers.length === 1);
    expect(answers[0]).toEqual([{}, "a"]);
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
