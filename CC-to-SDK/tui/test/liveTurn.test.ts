// tui/test/liveTurn.test.ts — reducer unit tests over the probe-20 frame sequence.
import { describe, it, expect } from "vitest";
import { LiveTurn } from "../src/liveTurn.js";

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

  it("flips a tool from running to done with a result preview", () => {
    const lt = new LiveTurn();
    lt.ingest(se({ type: "message_start" }));
    lt.ingest(se({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t3", name: "Read", input: {} } }));
    expect(texts(lt)).toContain("⟳ Read");                       // running, no target yet
    lt.ingest({ type: "assistant", message: { content: [{ type: "tool_use", id: "t3", name: "Read", input: { file_path: "f.ts" } }] } });
    expect(texts(lt)).toContain("⟳ Read f.ts");                  // target filled from full message
    lt.ingest({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t3", content: "ok\nmore" }] } });
    expect(texts(lt)).toContain("✓ Read f.ts  │ ok");            // done + first-line preview
  });

  it("marks a failed tool with ✗", () => {
    const lt = new LiveTurn();
    lt.ingest(se({ type: "message_start" }));
    lt.ingest(se({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t4", name: "Bash", input: {} } }));
    lt.ingest({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t4", is_error: true, content: "boom" }] } });
    const line = lt.snapshot().find((l) => l.text.startsWith("✗ Bash"));
    expect(line).toBeTruthy();
    expect(line!.color).toBe("red");
  });

  it("keeps per-message blocks distinct (message-2 text@0 does not clobber message-1 thinking@0) and never double-renders", () => {
    const lt = new LiveTurn(); feed(lt);
    lt.ingest(se({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "PINECONE." } }));
    lt.ingest(se({ type: "message_stop" }));
    lt.ingest({ type: "assistant", message: { content: [{ type: "text", text: "The codeword is PINECONE." }] } });
    lt.ingest({ type: "result", result: "The codeword is PINECONE." });
    const out = lt.finalize().map((l) => l.text);
    expect(out).toContain("✦ Thinking");                         // message-1 thinking survived
    expect(out.some((t) => t.startsWith("✓ Read fact.txt"))).toBe(true);
    expect(out).toContain("The codeword is PINECONE.");          // message-2 text present
    expect(out.filter((t) => t === "The codeword is PINECONE.").length).toBe(1); // not double-rendered
  });

  it("appends a red line on fail() and includes it in finalize", () => {
    const lt = new LiveTurn();
    lt.ingest(se({ type: "message_start" }));
    lt.ingest(se({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }));
    lt.ingest(se({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "partial" } }));
    lt.fail("stream died");
    const out = lt.finalize();
    expect(out).toContainEqual({ text: "partial" });
    expect(out).toContainEqual({ text: "✗ stream died", color: "red" });
  });

  it("settles a still-running tool at finalize (no dangling ⟳)", () => {
    const lt = new LiveTurn();
    lt.ingest(se({ type: "message_start" }));
    lt.ingest(se({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t5", name: "Read", input: {} } }));
    lt.ingest({ type: "assistant", message: { content: [{ type: "tool_use", id: "t5", name: "Read", input: { file_path: "f.ts" } }] } });
    const out = lt.finalize().map((l) => l.text);
    expect(out.some((t) => t.startsWith("⟳"))).toBe(false);
    expect(out).toContain("· Read f.ts");
  });

  it("renders a full assistant message that arrived with no partials (fallback)", () => {
    const lt = new LiveTurn();
    lt.ingest({ type: "assistant", message: { model: "claude-sonnet-4-6", content: [{ type: "text", text: "no partials here" }] } });
    expect(texts(lt)).toContain("no partials here");
    expect(lt.model).toBe("claude-sonnet-4-6");
  });

  it("shows elapsed on a still-running tool only after ≥1s, via an injected clock", () => {
    let t = 1000; const lt = new LiveTurn(() => t);
    lt.ingest(se({ type: "message_start" }));
    lt.ingest(se({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tk", name: "Bash", input: {} } }));
    expect(texts(lt).find((x) => x.startsWith("⟳ Bash"))).toBe("⟳ Bash");   // 0s → no suffix
    t = 4000;                                                                 // 3s later
    expect(texts(lt).find((x) => x.startsWith("⟳ Bash"))).toBe("⟳ Bash 3s"); // elapsed shown
  });

  it("renders an inline diff for an Edit tool (not just a one-line marker)", () => {
    const lt = new LiveTurn();
    lt.ingest(se({ type: "message_start" }));
    lt.ingest(se({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "e1", name: "Edit", input: {} } }));
    lt.ingest({ type: "assistant", message: { content: [{ type: "tool_use", id: "e1", name: "Edit", input: { file_path: "f.ts", old_string: "x", new_string: "y" } }] } });
    const out = texts(lt);
    expect(out).toContain("  - x");
    expect(out).toContain("  + y");
  });

  it("nests subagent (Agent) turns under the parent and collapses on the top-level result", () => {
    let t = 0; const lt = new LiveTurn(() => t);
    // top-level Agent tool_use (full message — no partials for the agent's own content)
    lt.ingest({ type: "assistant", message: { content: [{ type: "tool_use", id: "ag1", name: "Agent", input: { description: "research" } }] } });
    expect(lt.subagentActive).toBe(true);
    expect(texts(lt).some((x) => x.startsWith("⚙ Agent"))).toBe(true);
    // nested subagent turns (parent_tool_use_id = ag1)
    lt.ingest({ type: "user", parent_tool_use_id: "ag1", message: { content: [{ type: "text", text: "do the thing" }] } });
    lt.ingest({ type: "assistant", parent_tool_use_id: "ag1", message: { content: [{ type: "tool_use", id: "b1", name: "Bash", input: { command: "echo hi" } }] } });
    lt.ingest({ type: "user", parent_tool_use_id: "ag1", message: { content: [{ type: "tool_result", tool_use_id: "b1", content: "hi" }] } });
    lt.ingest({ type: "assistant", parent_tool_use_id: "ag1", message: { content: [{ type: "text", text: "the output is hi" }] } });
    const expanded = texts(lt);
    expect(expanded.some((x) => x.includes("Bash"))).toBe(true);             // nested tool shown while running
    expect(expanded.some((x) => x.includes("the output is hi"))).toBe(true);// nested text shown
    // top-level Agent result closes + collapses
    t = 12000;
    lt.ingest({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "ag1", content: "done" }] } });
    expect(lt.subagentActive).toBe(false);
    const collapsed = texts(lt);
    expect(collapsed.some((x) => /⚙ Agent .*✓ \(1 tools? · 12s\)/.test(x))).toBe(true);
    expect(collapsed.some((x) => x.includes("the output is hi"))).toBe(false); // nested hidden after collapse
  });
});
