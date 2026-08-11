// test/tui/useChat-error.test.tsx — Wave T Task 14: the transcript must end with EXACTLY ONE honest
// failure line when the API dies mid-turn.
//
// The original claim was "the failure renders twice". Measured, it did not: on probe 96's terminal frame
// `submit()` RESOLVED, the turn-end event carried no error, and the transcript held exactly one row — the
// synthetic assistant message, rendered as an ORDINARY assistant message (an `⏺` bullet + markdown,
// render.ts:205). It is NOT the `JG`/`lca` warning bullet: `JG_PREFIXES` (species.ts:462-466) matches only
// text that STARTS WITH `API Error` or one of the four cloud-credential prefixes, and this text starts
// with "Failed to authenticate.", so `errorSentinelLines` returns undefined and species.ts:578 never
// fires. (`is_api_error_message` is not read anywhere in `src/` — W-C T7 briefly read it to suppress the
// duration row, and that arm is deleted.) Verified by calling both functions on
// the exact text below. The
// SECOND line only appeared on the uuid-less variant, where nothing settled the waiter and readLoop's
// `finally` rejected it "session disposed" — a line that named the wrong cause. Task 14 makes both
// variants resolve error-tagged, so both render the one canon row. These tests pin the COUNT.
import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { Text } from "ink";
import { fakeRemote } from "./helpers/fakeRemote.js";
import { useChat } from "../../src/tui/useChat.js";
import type { RenderItem } from "../../src/tui/toolRenderer.js";

const itemLines = (item: RenderItem): string[] => (item.kind === "line" ? [item.line.text] : item.body.map((l) => l.text));
const API_ERROR_TEXT = "Failed to authenticate. API Error: 401 probe 96 synthetic 401";
// Probe 96's synthetic assistant frame, key-for-key (`model:"<synthetic>"`, `is_api_error_message:true`).
const SYNTHETIC = {
  type: "assistant", parent_tool_use_id: null, model: "<synthetic>", is_api_error_message: true, error: "authentication_failed", uuid: "a1",
  message: { role: "assistant", content: [{ type: "text", text: API_ERROR_TEXT }] },
};

async function runFailedTurn(endError?: string): Promise<string[]> {
  const fake = fakeRemote();
  let rows: string[] = [];
  function H() {
    // Clock and verb injected so the duration row below the failure is one fixed string, not a regex over
    // eight verbs and whatever the wall clock spent between two `setTimeout`s.
    const c = useChat(() => fake, {}, { now: () => 1000, pickTurnVerb: () => "Crunched" });
    rows = [...c.state.staticItems, ...c.state.pendingItems].flatMap(itemLines).filter((l) => l.trim());
    return <Text>x</Text>;
  }
  render(<H />);
  await new Promise((r) => setTimeout(r, 20));
  fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
  fake.pushEvent({ kind: "message", data: SYNTHETIC });
  await new Promise((r) => setTimeout(r, 30));
  fake.pushEvent({ kind: "turn", phase: "end", seq: 1, ...(endError ? { error: endError } : {}) });
  await new Promise((r) => setTimeout(r, 50));
  return rows;
}

describe("useChat: an API failure renders exactly one honest failure line", () => {
  it("the terminal api_error frame paints ONE row and no ✗ duplicate under it", async () => {
    const rows = await runFailedTurn();
    // The duration row rides UNDER it, because upstream's own emission is a `finally` gated only on the
    // aborted signal: a turn that died at the API still prints `✻ Crunched for 0s`. ccx briefly suppressed
    // it on `is_api_error_message` — an invented divergence, deleted (W-C T7 fix pass).
    expect(rows).toEqual([API_ERROR_TEXT, "Crunched for 0s"]);
    // The count is the assertion. A second row — a `✗` echo of the same text, or a "session disposed"
    // that names the wrong cause — is the defect this pins against.
    expect(rows.filter((l) => l.includes(API_ERROR_TEXT))).toHaveLength(1);
    expect(rows.some((l) => l.includes("✗"))).toBe(false);
  });

  it("a GENUINE transport exception (no terminal frame) still prints its one ✗ line", async () => {
    // The other path is untouched: a query that dies without ever emitting a terminal result frame
    // rejects, the host stamps turn-end with the throw message, and that single line is all there is.
    const fake = fakeRemote();
    let rows: string[] = [];
    function H() {
      const c = useChat(() => fake);
      rows = [...c.state.staticItems, ...c.state.pendingItems].flatMap(itemLines).filter((l) => l.trim());
      return <Text>x</Text>;
    }
    render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    fake.pushEvent({ kind: "turn", phase: "end", seq: 1, error: "Claude Code process exited with code 1" });
    await new Promise((r) => setTimeout(r, 50));
    expect(rows).toEqual(["✗ Claude Code process exited with code 1"]);
  });
});
