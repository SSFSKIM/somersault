// tui/test/replay.test.ts — replay is now RETENTION, not rendering: `replayDocument` builds the one
// source-faithful `TranscriptDocument` and every assertion below reads it back through the SAME projection
// live and attach use. Fixtures mirror probe-23's persisted message shape.
import { describe, it, expect } from "vitest";
import { TranscriptDocument } from "../../src/tui/transcriptModel.js";
import { replayDocument } from "../../src/tui/replay.js";
import { projectCompact, projectDetail } from "../../src/tui/toolRenderer.js";
import { READ_CALL, READ_RESULT_FLAT, NESTED_READ_CALL } from "../fixtures/f1-tool-transcript.js";

// Shared by every projection assertion in this task; Task 7 uses the identical shape.
const projectionOptions = { cwd: "/work", home: "/home/me", platform: "darwin" as NodeJS.Platform, columns: 100, now: 0 };
const replayOptions = { id: "session-1", label: "fixture" };

const TS = "2026-06-19T15:58:00.000Z";
// `uuid` matters: rowKind() only classifies a plain (non-echo/non-summary) user row as "prompt" when it
// carries one (real transcript rows always do — see sessions/rows.ts) — omitting it here would silently
// make every fixture "other", not "prompt", under the Minor-3 fix (turns counted via rowKind).
const userText = (text: string, timestamp = "2026-06-19T15:56:00.000Z", uuid = "u-test") => ({ type: "user", uuid, message: { role: "user", content: [{ type: "text", text }] }, timestamp });
const asstText = (text: string, id = "a-1", timestamp = TS) => ({ type: "assistant", message: { id, role: "assistant", content: [{ type: "text", text }] }, timestamp });
const compactText = (doc: TranscriptDocument) => JSON.stringify(projectCompact(doc, projectionOptions));
/** The tool rows alone, with the sequence component of `toolItemId` normalized away. A replayed document
 *  legitimately carries the two display dividers `replayDocument` seeds (Task 4 step 3 item 4), and those
 *  local entries shift every later `resultSequence` by one — so a raw whole-array equality between a disk
 *  document and a bare host document can never hold no matter how faithful the projection is. What the
 *  cutover actually promises is that the TOOL ROW is identical, which is exactly what this compares. */
const toolRows = (items: readonly { kind: string; id: string }[]) =>
  items.filter((i) => !i.id.startsWith("local:replay:")).map((i) => ({ ...i, id: i.id.replace(/^tool:([^:]+):\d+:/, "tool:$1:") }));

describe("replayDocument", () => {
  it("frames the replay with a derived header (label · turns · hh:mm) and a live divider", () => {
    const items = projectCompact(replayDocument([userText("fix the parser"), asstText("done")], {}), projectionOptions);
    expect(items[0]).toEqual({ kind: "line", id: "local:replay:session:head:line:0", line: { text: "─── resumed: fix the parser · 1 turn · 15:58 ───", dim: true } });
    expect(items.at(-1)).toEqual({ kind: "line", id: "local:replay:session:live:line:0", line: { text: "─── resumed here · live ───", dim: true } });
  });
  it("RETAINS the tool_result body the old lossy replay dropped, and renders it through the shared tool row", () => {
    const doc = replayDocument([userText("add a flag"), READ_CALL, READ_RESULT_FLAT, asstText("added", "a-2")], replayOptions);
    expect(doc.toolEvents()).toHaveLength(1);
    const rendered = compactText(doc);
    expect(rendered).toContain("› add a flag");
    // Task 5c: the DEFAULT view collapses the read into one summary row and shows no result body at all —
    // the per-call header and the body are upstream's ctrl+o form, so they must still be there under detail.
    expect(rendered).toContain("Read 1 file (ctrl+o to expand)");
    expect(rendered).not.toContain("one");
    expect(rendered).toContain("added");
    const detail = JSON.stringify(projectDetail(doc, { ...projectionOptions, projection: "detail-all" }));
    expect(detail).toContain("Read(");
    // RETENTION is the claim this test makes, and it is asserted on the DOCUMENT: the replayed tool_result body
    // is kept whole, which is what `replayLines` used to discard. What the detail projection PAINTS for it is a
    // separate question, and F3 Task 5 (LT1) answers it upstream's way — plan `2026-08-04-tui-clone-f3.md`
    // § Task 5 Routing: the typed row `Read 3 lines`, never the file text. This line pinned that text before.
    expect(String(doc.toolEvents()[0]!.result!.content)).toContain("one");
    expect(detail).toContain("Read 3 lines");
    expect(detail).not.toContain("two");
  });
  it("hides command stdout/caveat rows, renders command echoes as dim slash lines, and marks compact summaries", () => {
    const msgs = [
      { type: "user", uuid: "u1", timestamp: "2026-07-28T08:00:00Z", message: { role: "user", content: "hi" } },
      { type: "user", uuid: "u2", message: { role: "user", content: "<command-name>/compact</command-name> <command-message>compact</command-message>" } },
      { type: "user", uuid: "u3", message: { role: "user", content: "<local-command-stdout>Compacted</local-command-stdout>" } },
      { type: "user", uuid: "u4", message: { role: "user", content: "This session is being continued from a previous conversation that ran out of context. Summary…" } },
    ];
    const text = compactText(replayDocument(msgs, {}));
    expect(text).toContain("› /compact");
    expect(text).not.toContain("local-command-stdout");
    expect(text).not.toContain("Summary…");
    expect(text).toContain("─── context compacted earlier ───");
  });
  it("counts only real prompts as turns — a command echo and a compaction summary are not turns (Minor 3)", () => {
    const msgs = [
      { type: "user", uuid: "u1", timestamp: "2026-07-28T08:00:00Z", message: { role: "user", content: "hi" } },
      { type: "user", uuid: "u2", message: { role: "user", content: "<command-name>/compact</command-name> <command-message>compact</command-message>" } },
      { type: "user", uuid: "u3", message: { role: "user", content: "<local-command-stdout>Compacted</local-command-stdout>" } },
      { type: "user", uuid: "u4", message: { role: "user", content: "This session is being continued from a previous conversation that ran out of context. Summary…" } },
    ];
    const items = projectCompact(replayDocument(msgs, {}), projectionOptions);
    expect(items[0]).toMatchObject({ line: { text: "─── resumed: session · 1 turn ───" } });
  });
  it("gives the two display dividers and each echo a POSITION-derived identity, so replaying twice is idempotent", () => {
    const msgs = [userText("hi"), { type: "user", uuid: "e1", message: { role: "user", content: "<command-name>/help</command-name>" } }, { type: "user", uuid: "e2", message: { role: "user", content: "<command-name>/help</command-name>" } }];
    const ids = projectCompact(replayDocument(msgs, replayOptions), projectionOptions).map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);                               // two equal-looking echoes stay distinct
    expect(ids).toContain("local:replay:session-1:1:command_echo:line:0");
    expect(ids).toContain("local:replay:session-1:2:command_echo:line:0");
    expect(projectCompact(replayDocument(msgs, replayOptions), projectionOptions).map((i) => i.id)).toEqual(ids);   // stable across replays
  });
  it("carries no display-only message cap: every persisted row stays retained source", () => {
    const msgs = Array.from({ length: 250 }, (_, i) => asstText(`m${i}`, `a-${i}`, "2026-06-19T16:00:00.000Z"));
    const text = compactText(replayDocument(msgs, {}));
    expect(text).toContain("m0");
    expect(text).not.toContain("earlier messages elided");
  });

  it("projects flat-only raw tool results identically from disk and host documents", () => {
    // The trailing prose is load-bearing since Task 5c: an unclosed fold run is still growable, so its summary
    // row is deliberately withheld from the compact projection (Static is append-only).
    const closed = asstText("done", "a-done");
    const disk = replayDocument([READ_CALL, READ_RESULT_FLAT, closed], replayOptions);
    const host = new TranscriptDocument(); host.appendSdk("host", READ_CALL); host.appendSdk("host", READ_RESULT_FLAT); host.appendSdk("host", closed);
    expect(toolRows(projectCompact(disk, projectionOptions))).toEqual(toolRows(projectCompact(host, projectionOptions)));
  });
  it("adapts ordinary completed SDK text with stable item IDs without competing with tool projection", () => {
    const text = { type: "assistant", message: { id: "assistant-text-1", content: [{ type: "text", text: "Done" }] } };
    const first = replayDocument([READ_CALL, READ_RESULT_FLAT, text], replayOptions), second = replayDocument([READ_CALL, READ_RESULT_FLAT, text], replayOptions);
    const firstItems = projectCompact(first, projectionOptions), secondItems = projectCompact(second, projectionOptions);
    expect(firstItems.map((item) => item.id)).toEqual(secondItems.map((item) => item.id)); expect(JSON.stringify(firstItems)).toContain("Done"); expect(new Set(firstItems.map((item) => item.id)).size).toBe(firstItems.length);
  });
  it("projects the same complete local line payload and stable ID in compact and detail", () => {
    const doc = new TranscriptDocument(); doc.appendFollowGap("follow-gap:7"); doc.appendLocal({ kind: "visual", lines: [{ text: "Usage: /help" }, { text: "second", dim: true }] }, "help:7");
    for (const items of [projectCompact(doc, projectionOptions), projectDetail(doc, { ...projectionOptions, projection: "detail-all" })]) {
      expect(items).toEqual(expect.arrayContaining([{ kind: "line", id: "local:follow-gap:7:line:0", line: { text: "Earlier live output unavailable while attaching", dim: true } }, { kind: "line", id: "local:help:7:line:0", line: { text: "Usage: /help" } }, { kind: "line", id: "local:help:7:line:1", line: { text: "second", dim: true } }]));
    }
  });
  it("publishes local visual output before the later result-anchored tool row in compact and detail", () => {
    const doc = new TranscriptDocument(); doc.appendSdk("disk", READ_CALL);
    doc.appendLocal({ kind: "visual", lines: [{ text: "Usage: /help" }] }, "help-after-call"); doc.appendSdk("disk", READ_RESULT_FLAT);
    doc.appendSdk("disk", asstText("done", "a-done"));   // closes the fold run so its compact summary row publishes
    // A fold group anchors where its LAST member's result did, so a `/help` that landed between the call and
    // its result still enters Static first — the same append-only guarantee the per-call detail row gives.
    const compact = JSON.stringify(projectCompact(doc, projectionOptions));
    expect(compact.indexOf("Usage: /help")).toBeLessThan(compact.indexOf("Read 1 file"));
    const detail = JSON.stringify(projectDetail(doc, { ...projectionOptions, projection: "detail-all" }));
    expect(detail.indexOf("Usage: /help")).toBeLessThan(detail.indexOf("Read(")); expect(detail.indexOf("Read(")).toBeLessThan(detail.lastIndexOf("one"));
  });
  it("retains a nested Agent call but does not emit it as an ordinary top-level row", () => {
    const doc = new TranscriptDocument(); doc.appendSdk("host", NESTED_READ_CALL);
    doc.appendSdk("host", { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "nested-read-1", content: "inner", is_error: false }] } });
    expect(doc.toolEvents()[0]).toMatchObject({ route: "nested", parent_tool_use_id: "agent-1" });
    expect(JSON.stringify(projectCompact(doc, projectionOptions))).not.toContain("agent.ts"); expect(JSON.stringify(projectDetail(doc, { ...projectionOptions, projection: "detail-all" }))).not.toContain("agent.ts");
  });
});
