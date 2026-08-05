// tui/test/dialog-frame.test.tsx — the frame every F6 permission dialog sits in (T4). Expectations are
// transcriptions of 2.1.220's `Ed` (L437992-438014, the frame) and `BAe` (L437937-986, the header): a
// `round` border with left/right/bottom switched OFF so only a top rule paints, `marginTop:1`, a bold title
// in the `permission` role, an optional dim `truncate-start` subtitle, and the DG21 attribution suffix whose
// `·` is dimmed. Colour claims read the RAW SGR frame — bold and dim are attributes and nothing else
// distinguishes the title from the suffix.
import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { Text } from "ink";
import { DialogFrame } from "../../src/tui/dialogs/DialogFrame.js";
import { themeTokens } from "../../src/tui/theme.js";

const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
/** The raw token is `rgb(r,g,b)`; ink paints it as a truecolor SGR. (`resolveThemeColor` hands ink a hex,
 *  which is not what lands in the frame — read the token itself.) */
const sgr = (name: "permission" | "planMode" | "warning") => {
  const m = /(\d+),\s*(\d+),\s*(\d+)/.exec(themeTokens()[name]);
  return `\x1b[38;2;${m![1]};${m![2]};${m![3]}m`;
};
const frameOf = (ui: React.ReactElement) => render(ui).lastFrame() ?? "";
const body = <Text>body</Text>;

describe("DialogFrame — the border", () => {
  it("paints a TOP RULE ONLY: no sides, no bottom (`Ed` L438011)", () => {
    const lines = plain(frameOf(<DialogFrame title="Bash command">{body}</DialogFrame>)).split("\n");
    expect(lines[0]).toBe("");                                   // marginTop: 1
    expect(lines[1]).toMatch(/^─+$/);                            // the round border's top edge, alone
    expect(lines.slice(2).join("\n")).not.toMatch(/[│╭╮╰╯]/);    // no verticals, no corners, no bottom rule
    expect(plain(frameOf(<DialogFrame title="t">{body}</DialogFrame>))).toContain("body");
  });

  it("takes the `permission` role by default and a caller-chosen role otherwise", () => {
    expect(frameOf(<DialogFrame title="t">{body}</DialogFrame>)).toContain(sgr("permission"));
    expect(frameOf(<DialogFrame title="t" color="planMode">{body}</DialogFrame>)).toContain(sgr("planMode"));
    expect(frameOf(<DialogFrame title="t" color="warning">{body}</DialogFrame>)).toContain(sgr("warning"));
  });
});

describe("DialogFrame — the header (`BAe`)", () => {
  it("renders the title bold in the header colour", () => {
    const f = frameOf(<DialogFrame title="Edit file">{body}</DialogFrame>);
    expect(plain(f)).toContain("Edit file");
    const opened = f.slice(Math.max(0, f.indexOf("Edit file") - 40), f.indexOf("Edit file"));
    expect(opened).toContain("\x1b[1m");                         // bold
    expect(opened).toContain(sgr("permission"));
  });

  it("renders the subtitle dim, under the title", () => {
    const f = frameOf(<DialogFrame title="Edit file" subtitle="src/tui/theme.ts">{body}</DialogFrame>);
    const lines = plain(f).split("\n");
    const title = lines.findIndex((l) => l.includes("Edit file"));
    expect(lines[title + 1]).toContain("src/tui/theme.ts");
    expect(f).toContain("\x1b[2msrc/tui/theme.ts");
  });

  it("carries a caller-supplied node as the subtitle untouched", () => {
    expect(plain(frameOf(<DialogFrame title="t" subtitle={<Text>node subtitle</Text>}>{body}</DialogFrame>)))
      .toContain("node subtitle");
  });

  it("never emits the unreachable screen-reader prefix (`Ed` L437995 `srPrefix`)", () => {
    expect(plain(frameOf(<DialogFrame title="Bash command" subagentType="reviewer">{body}</DialogFrame>)))
      .not.toContain("Permission Required");
  });
});

describe("DialogFrame — the attribution suffix (DG21, `BAe` L437941-957)", () => {
  it("says nothing when the request is the main agent's own", () => {
    expect(plain(frameOf(<DialogFrame title="Bash command">{body}</DialogFrame>))).not.toContain("·");
  });

  it("names the subagent, with a DIMMED separator", () => {
    const f = frameOf(<DialogFrame title="Bash command" subagentType="code-reviewer">{body}</DialogFrame>);
    expect(plain(f)).toContain("Bash command · from the code-reviewer agent");
    expect(f).toContain("\x1b[2m· ");
  });

  it("names the workflow, in quotes", () => {
    expect(plain(frameOf(<DialogFrame title="Bash command" workflowName="nightly-audit">{body}</DialogFrame>)))
      .toContain('Bash command · from the "nightly-audit" workflow');
  });

  it("falls back when the source is known but its name is not (an empty name, L437944/L437951)", () => {
    expect(plain(frameOf(<DialogFrame title="t" subagentType="">{body}</DialogFrame>))).toContain("· from a subagent");
    expect(plain(frameOf(<DialogFrame title="t" workflowName="">{body}</DialogFrame>))).toContain("· from a workflow");
  });

  it("truncates a long name to 24 columns (`oa(name, 24, true)` L106993)", () => {
    const long = "a-very-long-subagent-name-that-keeps-going";
    const out = plain(frameOf(<DialogFrame title="t" subagentType={long}>{body}</DialogFrame>));
    expect(out).toContain("· from the a-very-long-subagent-na… agent");
    expect(out).not.toContain(long);
  });

  it("keeps a multi-line name to its first line, with an ellipsis for what it lost (`oa` L106996-107001)", () => {
    expect(plain(frameOf(<DialogFrame title="t" subagentType={"reviewer\nsecond line"}>{body}</DialogFrame>)))
      .toContain("· from the reviewer… agent");
  });

  it("prefers the workflow arm when both are somehow set (`BAe`'s switch order)", () => {
    expect(plain(frameOf(<DialogFrame title="t" subagentType="rev" workflowName="wf">{body}</DialogFrame>)))
      .toContain('· from the "wf" workflow');
  });

  it("puts `titleRight` on the header row, opposite the title", () => {
    const out = plain(frameOf(<DialogFrame title="Bash command" titleRight={<Text>esc to cancel</Text>}>{body}</DialogFrame>));
    const line = out.split("\n").find((l) => l.includes("esc to cancel"));
    expect(line).toMatch(/^ Bash command\s+esc to cancel/);
  });
});
