// tui/test/liveTurn.test.ts — reducer unit tests over the probe-20 frame sequence.
import { describe, it, expect, afterEach } from "vitest";
import { LiveTurn } from "../../src/tui/liveTurn.js";
import { ACCENT, resolveThemeColor, setTheme, themeTokens } from "../../src/tui/theme.js";

// F1 Task 2 roles for the live region: a settled/pending tool marker is `inactive`, a completed one is
// `success`, a failed one is `error` — resolved through resolveThemeColor at snapshot time.
const tok = (name: "inactive" | "success" | "error") => resolveThemeColor(themeTokens()[name]);

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
    expect(line!.color).toBe(tok("error"));
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
    expect(out).toContainEqual({ text: "partial", gutter: { text: "● ", color: ACCENT } });
    expect(out).toContainEqual({ text: "✗ stream died", color: tok("error") });
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
    expect(out).toContain("  1 - x");
    expect(out).toContain("  1 + y");
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

  it("renders live assistant text as markdown with the ● bullet", () => {
    const lt = new LiveTurn(() => 0);
    lt.ingest({ type: "assistant", message: { content: [{ type: "text", text: "# Heading" }] } });
    expect(lt.snapshot()).toContainEqual({ text: "Heading", bold: true, gutter: { text: "● ", color: ACCENT } });
  });

  it("nests subagent (Agent) turns under the parent and collapses on the top-level result", () => {
    let t = 0; const lt = new LiveTurn(() => t);
    // top-level Agent tool_use (full message — no partials for the agent's own content)
    lt.ingest({ type: "assistant", message: { content: [{ type: "tool_use", id: "ag1", name: "Agent", input: { description: "research" } }] } });
    expect(texts(lt).some((x) => x.startsWith("● Agent"))).toBe(true);
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
    const collapsed = texts(lt);
    expect(collapsed.some((x) => /● Agent .*✓ \(1 tools? · 12s\)/.test(x))).toBe(true);
    expect(collapsed.some((x) => x.includes("the output is hi"))).toBe(false); // nested hidden after collapse
  });
});

describe("live-region lines carry semantic tokens, never ANSI literals", () => {
  afterEach(() => setTheme("auto"));
  const toolTurn = (lt: LiveTurn) => {
    lt.ingest(se({ type: "message_start" }));
    lt.ingest(se({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "s1", name: "Read", input: {} } }));
    lt.ingest({ type: "assistant", message: { content: [{ type: "tool_use", id: "s1", name: "Read", input: { file_path: "f.ts" } }] } });
  };
  it("running, settled, done and failed tool markers each read their own token", () => {
    const lt = new LiveTurn(() => 0); toolTurn(lt);
    expect(lt.snapshot()).toContainEqual({ text: "⟳ Read f.ts", color: tok("inactive") });      // pending
    lt.ingest({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "s1", content: "ok" }] } });
    expect(lt.snapshot()).toContainEqual({ text: "✓ Read f.ts  │ ok", color: tok("success") });
    const bad = new LiveTurn(() => 0); toolTurn(bad);
    bad.ingest({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "s1", is_error: true, content: "boom" }] } });
    expect(bad.snapshot()).toContainEqual({ text: "✗ Read f.ts", color: tok("error") });
    const settled = new LiveTurn(() => 0); toolTurn(settled);
    expect(settled.finalize()).toContainEqual({ text: "· Read f.ts", color: tok("inactive"), dim: true });
  });
  it("repaints those markers when the theme changes mid-session (read per snapshot, not cached)", () => {
    const lt = new LiveTurn(() => 0); toolTurn(lt);
    const auto = lt.snapshot().find((l) => l.text.startsWith("⟳"))!.color;
    setTheme("light");
    expect(lt.snapshot()).toContainEqual({ text: "⟳ Read f.ts", color: tok("inactive") });
    expect(lt.snapshot().find((l) => l.text.startsWith("⟳"))!.color).not.toBe(auto);
  });
});
