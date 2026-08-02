import { describe, expect, it } from "vitest";
import { TranscriptDocument } from "../../src/tui/transcriptModel.js";
import { AMBIGUOUS_SIDECAR_RESULT, DUPLICATE_READ_CALL, NESTED_READ_CALL, READ_CALL, READ_RESULT_FLAT, READ_RESULT_WITH_SIDECAR } from "../fixtures/f1-tool-transcript.js";

describe("F1 canonical transcript", () => {
  it("associates a sidecar only for one preceding matching result/call pair", () => {
    const doc = new TranscriptDocument(); doc.appendSdk("host", READ_CALL); doc.appendSdk("host", READ_RESULT_WITH_SIDECAR);
    expect(doc.toolEvents()[0]).toMatchObject({ id: "read-1", result: { sidecar: { scope: "call", value: { file: { numLines: 41 } } } } });
  });
  it("attaches a unique flat result even when no structured sidecar exists", () => {
    const doc = new TranscriptDocument(); doc.appendSdk("host", READ_CALL); doc.appendSdk("host", READ_RESULT_FLAT);
    expect(doc.toolEvents()[0]?.result).toMatchObject({ content: "one\ntwo\nthree" }); expect(doc.toolEvents()[0]?.result?.sidecar).toBeUndefined();
  });
  it("retains an ambiguous sidecar at message scope instead of guessing a call", () => {
    const doc = new TranscriptDocument(); doc.appendSdk("host", READ_CALL); doc.appendSdk("host", AMBIGUOUS_SIDECAR_RESULT);
    expect(doc.entries().at(-1)).toMatchObject({ sidecar: { scope: "message", reason: "ambiguous-tool-results" } });
    expect(doc.toolEvents()[0]?.result?.sidecar).toBeUndefined();
  });
  it.each([
    [{ type: "user", message: { content: [] }, tool_use_result: { type: "read" } }, "no-tool-result"],
    [{ type: "user", message: { content: [{ type: "tool_result", content: "x" }] }, tool_use_result: { type: "read" } }, "missing-tool-use-id"],
    [{ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "unseen-1", content: "x" }] }, tool_use_result: { type: "read" } }, "unmatched-tool-use"],
  ] as const)("retains an unassignable sidecar reason %#", (message, reason) => {
    const doc = new TranscriptDocument(); doc.appendSdk("host", READ_CALL); doc.appendSdk("host", message);
    expect(doc.entries().at(-1)).toMatchObject({ sidecar: { scope: "message", reason } });
  });
  it("keeps a duplicate tool-use ID unassigned rather than handing its sidecar to either call", () => {
    const doc = new TranscriptDocument(); doc.appendSdk("host", READ_CALL); doc.appendSdk("host", DUPLICATE_READ_CALL); doc.appendSdk("host", READ_RESULT_WITH_SIDECAR);
    expect(doc.entries().at(-1)).toMatchObject({ sidecar: { scope: "message", reason: "duplicate-tool-use" } });
  });
  it("keeps a later sidecar message-scoped once the call already has a result", () => {
    const doc = new TranscriptDocument(); doc.appendSdk("host", READ_CALL); doc.appendSdk("host", READ_RESULT_FLAT); doc.appendSdk("host", READ_RESULT_WITH_SIDECAR);
    expect(doc.toolEvents()[0]?.result).toMatchObject({ content: "one\ntwo\nthree", sidecar: undefined });
    expect(doc.entries().at(-1)).toMatchObject({ sidecar: { scope: "message", reason: "duplicate-tool-result" } });
  });
  it("keeps repeated flat-result IDs raw instead of overwriting a singular call result", () => {
    const doc = new TranscriptDocument(); doc.appendSdk("host", READ_CALL); doc.appendSdk("host", { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "read-1", content: "first" }, { type: "tool_result", tool_use_id: "read-1", content: "second" }] } });
    expect(doc.toolEvents()[0]?.result).toBeUndefined(); expect(doc.entries().at(-1)).toMatchObject({ kind: "sdk-message" });
    doc.appendSdk("host", READ_RESULT_FLAT); doc.appendSdk("host", { ...READ_RESULT_FLAT, uuid: "user-result-later", message: { content: [{ type: "tool_result", tool_use_id: "read-1", content: "later" }] } });
    expect(doc.toolEvents()[0]?.result?.content).toBe("one\ntwo\nthree"); expect(doc.entries()).toHaveLength(4);
  });
  it("retains the nested parent route instead of flattening an Agent child", () => {
    const doc = new TranscriptDocument(); doc.appendSdk("host", NESTED_READ_CALL);
    expect(doc.toolEvents()[0]).toMatchObject({ id: "nested-read-1", route: "nested", parent_tool_use_id: "agent-1" });
  });
  it("deduplicates the same stable disk/follow record but retains a distinct later record", () => {
    const doc = new TranscriptDocument();
    expect(doc.appendSdk("disk", READ_CALL)).toBe(true); expect(doc.appendSdk("host", READ_CALL)).toBe(false);
    expect(doc.appendSdk("host", { ...READ_CALL, message: { ...READ_CALL.message, id: "assistant-2" } })).toBe(true);
    expect(doc.entries()).toHaveLength(2);
  });
  // `getSessionMessages()` rows never carry `tool_use_result`, so a disk bootstrap followed by the live follow
  // replay delivers the SAME uuid twice — sparse first, rich second. Dedup must keep the richer copy's structure.
  const SPARSE_READ_RESULT = { type: "user", uuid: "user-result-1", message: { content: [{ type: "tool_result", tool_use_id: "read-1", content: "export const app = 1;\n", is_error: false }] } };
  it("upgrades a deduplicated duplicate that carries the richer sidecar", () => {
    const doc = new TranscriptDocument(); doc.appendSdk("host", READ_CALL);
    expect(doc.appendSdk("disk", SPARSE_READ_RESULT)).toBe(true); expect(doc.appendSdk("host", READ_RESULT_WITH_SIDECAR)).toBe(false);
    expect(doc.entries()).toHaveLength(2);
    expect(doc.toolEvents()[0]?.result?.sidecar).toEqual({ scope: "call", value: READ_RESULT_WITH_SIDECAR.tool_use_result });
    const last = doc.entries().at(-1); expect(last?.kind === "sdk-message" ? last.message : undefined).toBe(READ_RESULT_WITH_SIDECAR);
  });
  it("never downgrades a retained rich copy when the sparse disk copy arrives second", () => {
    const doc = new TranscriptDocument(); doc.appendSdk("host", READ_CALL); doc.appendSdk("host", READ_RESULT_WITH_SIDECAR);
    expect(doc.appendSdk("disk", SPARSE_READ_RESULT)).toBe(false); expect(doc.entries()).toHaveLength(2);
    expect(doc.toolEvents()[0]?.result?.sidecar).toEqual({ scope: "call", value: READ_RESULT_WITH_SIDECAR.tool_use_result });
    const last = doc.entries().at(-1); expect(last?.kind === "sdk-message" ? last.message : undefined).toBe(READ_RESULT_WITH_SIDECAR);
  });
  it("retains an upgraded sidecar at message scope when its association is ambiguous", () => {
    const doc = new TranscriptDocument(); doc.appendSdk("host", READ_CALL);
    doc.appendSdk("disk", { type: "user", uuid: "user-ambiguous", message: AMBIGUOUS_SIDECAR_RESULT.message });
    expect(doc.appendSdk("host", { ...AMBIGUOUS_SIDECAR_RESULT, uuid: "user-ambiguous" })).toBe(false);
    expect(doc.entries().at(-1)).toMatchObject({ sidecar: { scope: "message", reason: "ambiguous-tool-results" } });
    expect(doc.toolEvents()[0]?.result?.sidecar).toBeUndefined();
  });
  it("never overwrites a sidecar the first delivery already associated", () => {
    const doc = new TranscriptDocument(); doc.appendSdk("host", READ_CALL); doc.appendSdk("host", READ_RESULT_WITH_SIDECAR);
    expect(doc.appendSdk("host", { ...READ_RESULT_WITH_SIDECAR, tool_use_result: { type: "read", file: { numLines: 2 } } })).toBe(false);
    expect(doc.toolEvents()[0]?.result?.sidecar).toEqual({ scope: "call", value: READ_RESULT_WITH_SIDECAR.tool_use_result });
    const last = doc.entries().at(-1); expect(last?.kind === "sdk-message" ? last.message : undefined).toBe(READ_RESULT_WITH_SIDECAR);
  });
  // Refusal-fallback supersede (sdk.d.ts `SDKAssistantMessage.supersedes`): the named frames are retracted, not history.
  const REFUSED_CALL = { ...READ_CALL, uuid: "assistant-refused" };
  const fallback = (supersedes: unknown) => ({ type: "assistant", uuid: "assistant-fallback", supersedes, message: { id: "assistant-fallback", content: [{ type: "text", text: "I can't help with that." }] } });
  it("evicts a superseded assistant frame together with the calls it extracted", () => {
    const doc = new TranscriptDocument(); doc.appendSdk("host", REFUSED_CALL);
    expect(doc.appendSdk("host", fallback(["assistant-refused"]))).toBe(true);
    expect(doc.entries()).toHaveLength(1); expect(doc.entries()[0]).toMatchObject({ identity: "uuid:assistant-fallback" });
    expect(doc.toolEvents()).toHaveLength(0);
  });
  it("detaches a call result when its tombstoned tool_result frame is superseded", () => {
    const doc = new TranscriptDocument(); doc.appendSdk("host", READ_CALL); doc.appendSdk("host", READ_RESULT_WITH_SIDECAR);
    expect(doc.appendSdk("host", fallback(["user-result-1"]))).toBe(true);
    expect(doc.entries().map((e) => e.identity)).toEqual(["message:assistant-1", "uuid:assistant-fallback"]);
    expect(doc.toolEvents()[0]?.result).toBeUndefined();
  });
  it("cannot resurrect a retracted frame from a later replay", () => {
    const doc = new TranscriptDocument(); doc.appendSdk("host", READ_CALL); doc.appendSdk("host", READ_RESULT_WITH_SIDECAR); doc.appendSdk("host", fallback(["user-result-1"]));
    expect(doc.appendSdk("disk", READ_RESULT_WITH_SIDECAR)).toBe(false); expect(doc.appendSdk("disk", SPARSE_READ_RESULT)).toBe(false);
    expect(doc.entries()).toHaveLength(2); expect(doc.toolEvents()[0]?.result).toBeUndefined();
  });
  it("ignores an absent or malformed supersedes list", () => {
    const doc = new TranscriptDocument(); doc.appendSdk("host", REFUSED_CALL);
    expect(doc.appendSdk("host", fallback("assistant-refused"))).toBe(true);
    expect(doc.appendSdk("host", { ...fallback([42, "", null]), uuid: "assistant-fallback-2" })).toBe(true);
    expect(doc.appendSdk("host", REFUSED_CALL)).toBe(false);   // still retained: neither list retracted it
    expect(doc.entries()).toHaveLength(3); expect(doc.toolEvents()).toHaveLength(1);
  });
  it("deduplicates local delivery by identity, never by equal-looking content", () => {
    const doc = new TranscriptDocument(), event = { kind: "visual" as const, lines: [{ text: "Usage: /help" }] };
    expect(doc.appendLocal(event, "event:session-1:1:visual")).toBe(true); expect(doc.appendLocal(event, "event:session-1:1:visual")).toBe(false);
    expect(doc.appendLocal(event, "event:session-1:2:visual")).toBe(true); expect(doc.entries()).toHaveLength(2);
  });
});
