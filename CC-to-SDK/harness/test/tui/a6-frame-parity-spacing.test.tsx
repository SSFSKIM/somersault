// test/tui/a6-frame-parity-spacing.test.tsx — T-SPACE Task 4 (spec A6): the upstream golden
// `test/fixtures/upstream-frames/f1-tool-rendering/01-read-complete.ansi` (canon 2.1.220/2.1.251, decoded
// with the same `\x1b[...m`-stripping idiom `test/python/test_frame_scripts.py`'s `visible_text` uses)
// carries this exact row 12-24 blank-row pattern, SGR-decoded (rows are 0-indexed from the file's own top;
// row numbers below match the research doc R3 §0.1's 1-indexed citation):
//
//   12 (blank)  13 (blank)  14 "❯ Use the Read tool to read src/app.ts, …" (banded prompt)
//   15 (blank, unbanded — a real gap row)
//   16 "⏺ Reading 1 file… (ctrl+o to expand)"      ← collapsed tool-cluster row
//   17 "  ⎿  src/app.ts"                            ← its result body, NO gap above (header→body = 0)
//   18 (blank)
//   19 "✶ Effecting… (2s · ↓ 4 tokens)"              ← live spinner
//   20 (blank)
//   21 "──────…"                                     ← composer top rule
//
// i.e. the pattern PROMPT / GAP / TOOL-HEADER / TOOL-BODY(no gap) / GAP / SPINNER / GAP / RULE. This test
// drives our OWN harness through the equivalent message sequence (same prompt text, a Read call opened but
// not yet resolved, turn still busy — our ACTIVE pending-row form, which happens to echo canon's own
// "Reading N file(s)… (ctrl+o to expand)" wording and its file-path body preview almost verbatim) and
// asserts our produced frame follows the SAME blank-row pattern. The wording match is a bonus, not the
// acceptance bar: only the MARGIN STRUCTURE is claimed here, per R3 §1.5's canon table (user-prompt→tool=1,
// header→body=0, body→spinner=1, spinner→composer=1).
import { describe, expect, it } from "vitest";
import React from "react";
import { readFileSync } from "node:fs";
import { renderWithKeymap, tick } from "./keysTestUtil.js";
import { ChatApp } from "../../src/tui/ChatApp.js";
import { fakeRemote } from "./helpers/fakeRemote.js";
import { spinnerUp } from "./helpers/spinnerRow.js";
import { READ_CALL, UPSTREAM_READ_PROMPT } from "../fixtures/f1-tool-transcript.js";

const plain = (s: string | undefined) => (s ?? "").replace(/\x1b\[[0-9;]*m/g, "");
async function waitFor(cond: () => boolean, timeout = 3000) {
  const start = Date.now();
  for (;;) { if (cond()) return; if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
/** classifies each non-trailing row of a frame as blank or content, trimming only trailing padding. */
const rowsOf = (frame: string) => plain(frame).split("\n").map((l) => l.replace(/\s+$/, ""));

describe("A6 frame parity: the upstream golden's blank-row pattern, reproduced by our own message sequence", () => {
  it("decodes the golden fixture's rows 12-24 into the documented pattern (ground truth, no harness involved)", () => {
    const raw = readFileSync(new URL("../fixtures/upstream-frames/f1-tool-rendering/01-read-complete.ansi", import.meta.url), "utf8");
    const lines = raw.split("\n").map((l) => l.replace(/\x1b\[[0-9;]*m/g, ""));
    // 1-indexed per the research doc; `lines` is 0-indexed off the file's own top.
    const row = (n: number) => (lines[n - 1] ?? "").replace(/\s+$/, "");
    expect(row(12)).toBe("");
    expect(row(13)).toBe("");
    expect(row(14)).toContain("Use the Read tool to read src/app.ts");
    expect(row(15)).toBe(""); // prompt → tool: 1 blank (R3 §1.5)
    expect(row(16)).toContain("Reading 1 file");
    expect(row(16)).toContain("ctrl+o to expand)");
    expect(row(17).trimStart()).toMatch(/^⎿\s+src\/app\.ts/); // header → body: 0 blank (R3 §1.5)
    expect(row(18)).toBe(""); // body → spinner: 1 blank (R3 §1.5)
    expect(row(19)).toContain("Effecting");
    expect(row(20)).toBe(""); // spinner → composer: 1 blank (R3 §1.5)
    expect(row(21).trim().length).toBeGreaterThan(0); // the composer's top rule
  });

  it("our own message sequence (same prompt, an open Read call, turn still busy) produces the SAME blank-row pattern", async () => {
    let fake: ReturnType<typeof fakeRemote>;
    fake = fakeRemote({
      submit: async () => { fake.pushEvent({ kind: "turn", phase: "start", seq: 1 }); return new Promise(() => {}); }, // never ends: turn stays busy, matching the golden's still-spinning frame
    });
    const { lastFrame, stdin, unmount } = renderWithKeymap(
      <ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd="/work" deps={{ columns: () => 100 }} />,
    );
    try {
      await tick();
      stdin.write(UPSTREAM_READ_PROMPT.message.content as string);
      stdin.write("\r");
      await waitFor(() => plain(lastFrame()).includes("esc to interrupt")); // busy dock is up
      fake.pushEvent({ kind: "message", data: READ_CALL });
      await waitFor(() => plain(lastFrame()).includes("ctrl+o to expand)") && spinnerUp(plain(lastFrame())));

      const lines = rowsOf(lastFrame() ?? "");
      const promptRow = lines.findIndex((l) => l.includes("❯ ") && l.includes("Use the Read tool"));
      expect(promptRow).toBeGreaterThanOrEqual(0);
      const toolRow = lines.findIndex((l, i) => i > promptRow && l.includes("ctrl+o to expand)"));
      expect(toolRow).toBeGreaterThan(promptRow);
      const bodyRow = toolRow + 1;
      const spinnerRow = lines.findIndex((l, i) => i > bodyRow && spinnerUp(l));
      const ruleRow = lines.findIndex((l, i) => i > spinnerRow && /[─-]{5,}/.test(l));

      // PROMPT → GAP → TOOL: exactly one blank row between the prompt band and the tool cluster's own
      // leading separator (R3 §1.5: "user prompt echo → tool row = 1").
      expect(lines[promptRow + 1]).toBe("");
      expect(toolRow).toBe(promptRow + 2);
      // TOOL HEADER → BODY: zero gap (R3 §1.5: "tool row (header) → its ⎿ result body = 0").
      expect(lines[bodyRow]).toMatch(/⎿/);
      // BODY → SPINNER: exactly one blank row (R3 §1.5: "last transcript block → spinner = 1").
      expect(lines[bodyRow + 1]).toBe("");
      expect(spinnerRow).toBe(bodyRow + 2);
      // SPINNER → COMPOSER RULE: exactly one blank row (R3 §1.5: "spinner → composer top rule = 1").
      expect(lines[spinnerRow + 1]).toBe("");
      expect(ruleRow).toBe(spinnerRow + 2);
    } finally {
      unmount();
    }
  });
});
