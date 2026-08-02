// tui/test/liveTurn.test.ts — reducer unit tests over the probe-20 frame sequence. Since F1 Task 4 the
// live region is PARTIALS ONLY: a completed message belongs to the retained TranscriptDocument and an open
// tool call to projectPending, so the assertions below also pin that neither is rendered twice.
import { describe, it, expect, afterEach } from "vitest";
import { LiveTurn } from "../../src/tui/liveTurn.js";
import { TranscriptDocument } from "../../src/tui/transcriptModel.js";
import { replayDocument } from "../../src/tui/replay.js";
import { projectCompact, projectPending } from "../../src/tui/toolRenderer.js";
import { READ_CALL, READ_RESULT_WITH_SIDECAR } from "../fixtures/f1-tool-transcript.js";
import { ACCENT, resolveThemeColor, setTheme, themeTokens } from "../../src/tui/theme.js";

const tok = (name: "error") => resolveThemeColor(themeTokens()[name]);
const projectionOptions = { cwd: "/work", home: "/home/me", platform: "darwin" as NodeJS.Platform, columns: 100, now: 0 };

const se = (event: unknown) => ({ type: "stream_event", event });
const texts = (lt: LiveTurn) => lt.snapshot().map((l) => l.text);

// The exact ordered frames probe 20 delivered for a (thinking → Read tool → answer) turn.
function feed(lt: LiveTurn) {
  lt.ingest(se({ type: "message_start" }));
  lt.ingest(se({ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } }));
  lt.ingest(se({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "let me check" } }));
  lt.ingest(se({ type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig" } }));
  lt.ingest(se({ type: "content_block_stop", index: 0 }));
  lt.ingest(se({ type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_1", name: "Read", input: {} } }));
  lt.ingest(se({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: "{\"file" } }));
  lt.ingest(se({ type: "content_block_stop", index: 1 }));
  lt.ingest(se({ type: "message_stop" }));
  lt.ingest({ type: "assistant", message: { model: "claude-sonnet-4-6", content: [
    { type: "thinking", thinking: "let me check", signature: "sig" },
    { type: "tool_use", id: "toolu_1", name: "Read", input: { file_path: "fact.txt" } },
  ] } });
  lt.ingest({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "The codeword is PINECONE." }] } });
  lt.ingest(se({ type: "message_start" }));
  lt.ingest(se({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }));
  lt.ingest(se({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "The codeword is " } }));
}

describe("LiveTurn", () => {
  it("streams text that grows monotonically", () => {
    const lt = new LiveTurn(); feed(lt);
    const a = texts(lt).join("\n");
    lt.ingest(se({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "PINECONE." } }));
    const b = texts(lt).join("\n");
    expect(a).toContain("The codeword is ");
    expect(b).toContain("The codeword is PINECONE.");
    expect(b.length).toBeGreaterThan(a.length);
  });

  it("streams thinking then collapses it once a later block opens", () => {
    const lt = new LiveTurn();
    lt.ingest(se({ type: "message_start" }));
    lt.ingest(se({ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } }));
    lt.ingest(se({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "pondering" } }));
    expect(texts(lt)).toContain("pondering");                    // live, dim
    lt.ingest(se({ type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "t2", name: "Read", input: {} } }));
    expect(texts(lt)).toContain("✦ Thinking");                   // collapsed
    expect(texts(lt)).not.toContain("pondering");
  });

  it("renders NO tool row of its own: an open call belongs to projectPending, off the retained document", () => {
    const lt = new LiveTurn(); const doc = new TranscriptDocument();
    lt.ingest(se({ type: "message_start" }));
    lt.ingest(se({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "read-1", name: "Read", input: {} } }));
    expect(texts(lt)).toEqual([]);                                // the partial tool_use is not a live line
    lt.ingest(READ_CALL); doc.appendSdk("host", READ_CALL);
    expect(texts(lt)).toEqual([]);
    expect(JSON.stringify(projectPending(doc, projectionOptions))).toContain("Read(");
  });

  it("drops the partial blocks a COMPLETE message supersedes, so the same text never renders twice", () => {
    const lt = new LiveTurn();
    lt.ingest(se({ type: "message_start" }));
    lt.ingest(se({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }));
    lt.ingest(se({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "PINECONE" } }));
    expect(texts(lt).join("")).toContain("PINECONE");
    lt.ingest({ type: "assistant", message: { content: [{ type: "text", text: "PINECONE" }] } });
    expect(lt.snapshot()).toEqual([]);                            // the document owns it from here on
  });

  // Round-1 review finding 3: with subagent text forwarding, a NESTED completed message arrives on the same
  // stream as the parent's partials. It belongs to the subagent's own turn — it supersedes nothing here, so
  // it must not wipe what the parent is still streaming (nor claim the parent turn's model).
  it("keeps the parent's in-flight partials when a NESTED completed message lands, and clears them on the parent's own", () => {
    const lt = new LiveTurn();
    lt.ingest(se({ type: "message_start" }));
    lt.ingest(se({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }));
    lt.ingest(se({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "parent still typing" } }));
    lt.ingest({ type: "assistant", parent_tool_use_id: "agent-1", message: { model: "claude-haiku-4-5", content: [{ type: "text", text: "subagent reply" }] } });
    expect(texts(lt).join("")).toContain("parent still typing");
    expect(lt.model).toBeUndefined();                              // the subagent's model is not this turn's
    lt.ingest({ type: "user", parent_tool_use_id: "agent-1", message: { content: [{ type: "tool_result", tool_use_id: "nested-1", content: "nested result" }] } });
    expect(texts(lt).join("")).toContain("parent still typing");
    lt.ingest({ type: "assistant", message: { model: "claude-sonnet-4-6", content: [{ type: "text", text: "parent still typing" }] } });
    expect(lt.snapshot()).toEqual([]);                             // the parent's own completion DOES supersede
    expect(lt.model).toBe("claude-sonnet-4-6");
  });

  it("appends a red line on fail() and keeps the partial that was streaming beside it", () => {
    const lt = new LiveTurn();
    lt.ingest(se({ type: "message_start" }));
    lt.ingest(se({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }));
    lt.ingest(se({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "partial" } }));
    lt.fail("stream died");
    const out = lt.snapshot();
    expect(out).toContainEqual({ text: "partial", gutter: { text: "● ", color: ACCENT } });
    expect(out).toContainEqual({ text: "✗ stream died", color: tok("error") });
  });

  it("captures the model from a full assistant message even with no partials", () => {
    const lt = new LiveTurn();
    lt.ingest({ type: "assistant", message: { model: "claude-sonnet-4-6", content: [{ type: "text", text: "no partials here" }] } });
    expect(lt.model).toBe("claude-sonnet-4-6");
    expect(lt.snapshot()).toEqual([]);
  });

  it("renders live assistant text as markdown with the ● bullet", () => {
    const lt = new LiveTurn();
    lt.ingest(se({ type: "message_start" }));
    lt.ingest(se({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }));
    lt.ingest(se({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "# Heading" } }));
    expect(lt.snapshot()).toContainEqual({ text: "Heading", bold: true, gutter: { text: "● ", color: ACCENT } });
  });

  it("captures the running output-token count from message_delta usage", () => {
    const lt = new LiveTurn();
    lt.ingest(se({ type: "message_start" }));
    lt.ingest(se({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }));
    lt.ingest(se({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hi" } }));
    expect(lt.outputTokens).toBe(0);
    lt.ingest(se({ type: "message_delta", delta: { stop_reason: null }, usage: { output_tokens: 42 } }));
    expect(lt.outputTokens).toBe(42);
    lt.ingest(se({ type: "message_delta", delta: {}, usage: { output_tokens: 87 } }));
    expect(lt.outputTokens).toBe(87);
  });

  it("accumulates output tokens ACROSS messages in a multi-message (tool-using) turn", () => {
    const lt = new LiveTurn();
    lt.ingest(se({ type: "message_start" }));
    lt.ingest(se({ type: "message_delta", delta: {}, usage: { output_tokens: 50 } }));   // msg1 → 50
    expect(lt.outputTokens).toBe(50);
    lt.ingest(se({ type: "message_start" }));                                            // commit msg1 (50)
    lt.ingest(se({ type: "message_delta", delta: {}, usage: { output_tokens: 30 } }));   // msg2 → total 80 (not a reset to 30)
    expect(lt.outputTokens).toBe(80);
  });
});

describe("live and replay share ONE tool grammar", () => {
  afterEach(() => setTheme("auto"));
  // The cutover's whole point: the same fixture, ingested live off the host event stream or read back off
  // disk, yields byte-identical final RenderItem[].
  it("returns equal final RenderItem[] for the same fixture from a live document and a replayed one", () => {
    const lt = new LiveTurn(); const live = new TranscriptDocument();
    for (const message of [READ_CALL, READ_RESULT_WITH_SIDECAR]) { lt.ingest(message); live.appendSdk("host", message); }
    expect(lt.snapshot()).toEqual([]);                                   // nothing rendered twice
    const disk = replayDocument([READ_CALL, READ_RESULT_WITH_SIDECAR], { id: "session-1" });
    // The replay's own display dividers shift every later resultSequence, so the id's sequence component is
    // normalized away; everything else — header segments, gutter, body — must match byte for byte.
    const toolRows = (items: readonly { kind: string; id: string }[]) =>
      items.filter((i) => !i.id.startsWith("local:replay:")).map((i) => ({ ...i, id: i.id.replace(/^tool:([^:]+):\d+:/, "tool:$1:") }));
    expect(toolRows(projectCompact(live, projectionOptions))).toEqual(toolRows(projectCompact(disk, projectionOptions)));
    expect(projectPending(live, projectionOptions)).toEqual([]);         // the call settled — nothing stays pending
  });
});
