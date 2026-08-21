// tui/test/liveTurn.test.ts — reducer unit tests over the probe-20 frame sequence. Since F1 Task 4 the
// live region is PARTIALS ONLY: a completed message belongs to the retained TranscriptDocument and an open
// tool call to projectPending, so the assertions below also pin that neither is rendered twice.
import { describe, it, expect, afterEach } from "vitest";
import { LiveTurn } from "../../src/tui/liveTurn.js";
import { TranscriptDocument } from "../../src/tui/transcriptModel.js";
import { replayDocument } from "../../src/tui/replay.js";
import { projectCompact, projectPending } from "../../src/tui/toolRenderer.js";
import { READ_CALL, READ_RESULT_WITH_SIDECAR } from "../fixtures/f1-tool-transcript.js";
import { resolveThemeColor, setTheme, themeTokens } from "../../src/tui/theme.js";

const tok = (name: "error" | "text") => resolveThemeColor(themeTokens()[name]);
/** F4 Task 8: `Za` for a non-darwin host, in the `text` token — the accent bullet died with the task. */
const BULLET = { text: "● ", color: tok("text") };
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
  lt.ingest({ type: "assistant", parent_tool_use_id: null, message: { model: "claude-sonnet-4-6", content: [
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

  it("never shows live thinking prose — an open block is silent, a collapsed one is the placeholder", () => {
    // t9 review: upstream's stream handler feeds thinking deltas ONLY to a token counter (L374721–374730);
    // no thinking-text accumulator exists, so prose that streamed and then vanished from the settled
    // transcript was OUR divergence, not a port.
    const lt = new LiveTurn();
    lt.ingest(se({ type: "message_start" }));
    lt.ingest(se({ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } }));
    lt.ingest(se({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "pondering" } }));
    expect(texts(lt)).not.toContain("pondering");                // open: nothing — the spinner is the surface
    lt.ingest(se({ type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "t2", name: "Read", input: {} } }));
    expect(texts(lt)).toContain("✻ Thinking…");                  // collapsed — F4 Task 9's `e8o` form
    expect(texts(lt)).not.toContain("pondering");
  });

  it("renders NO tool row of its own: an open call belongs to projectPending, off the retained document", () => {
    const lt = new LiveTurn(); const doc = new TranscriptDocument();
    lt.ingest(se({ type: "message_start" }));
    lt.ingest(se({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "read-1", name: "Read", input: {} } }));
    expect(texts(lt)).toEqual([]);                                // the partial tool_use is not a live line
    lt.ingest(READ_CALL); doc.appendSdk("host", READ_CALL);
    expect(texts(lt)).toEqual([]);
    // Task 5c: the default view folds an open read into ONE blinking active group row — the per-call
    // `⏺ Read(src/app.ts)` header it replaced is upstream's ctrl+o VERBOSE form, and lives on in projectDetail.
    expect((projectPending(doc, projectionOptions)[0] as { line: { text: string } }).line.text).toBe("⏺ Reading 1 file… (ctrl+o to expand)");
  });

  it("drops the partial blocks a COMPLETE message supersedes, so the same text never renders twice", () => {
    const lt = new LiveTurn();
    lt.ingest(se({ type: "message_start" }));
    lt.ingest(se({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }));
    lt.ingest(se({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "PINECONE" } }));
    expect(texts(lt).join("")).toContain("PINECONE");
    lt.ingest({ type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "PINECONE" }] } });
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
    lt.ingest({ type: "assistant", parent_tool_use_id: null, message: { model: "claude-sonnet-4-6", content: [{ type: "text", text: "parent still typing" }] } });
    expect(lt.snapshot()).toEqual([]);                             // the parent's own completion DOES supersede
    expect(lt.model).toBe("claude-sonnet-4-6");
  });

  it("appends a red line on fail() and keeps the partial that was streaming beside it", () => {
    const lt = new LiveTurn({ platform: "linux" });
    lt.ingest(se({ type: "message_start" }));
    lt.ingest(se({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }));
    lt.ingest(se({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "partial" } }));
    lt.fail("stream died");
    const out = lt.snapshot();
    expect(out).toContainEqual({ text: "partial", gutter: BULLET });
    expect(out).toContainEqual({ text: "✗ stream died", color: tok("error") });
  });

  it("captures the model from a full assistant message even with no partials", () => {
    const lt = new LiveTurn();
    lt.ingest({ type: "assistant", parent_tool_use_id: null, message: { model: "claude-sonnet-4-6", content: [{ type: "text", text: "no partials here" }] } });
    expect(lt.model).toBe("claude-sonnet-4-6");
    expect(lt.snapshot()).toEqual([]);
  });

  // F4 Task 8: the streaming bullet is the SETTLED bullet — `Za` per platform in the `text` token, threaded
  // through LiveTurn's own `platform` dep so a live message never repaints its glyph when it lands.
  it("renders live assistant text as markdown with the platform bullet", () => {
    const lt = new LiveTurn({ platform: "linux" });
    lt.ingest(se({ type: "message_start" }));
    lt.ingest(se({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }));
    lt.ingest(se({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "# Heading" } }));
    // F4 Task 2: an h1 is bold+italic+underline (`vt.bold.italic.underline`, constants pack §1.2 /
    // bundle L420613–420616); depth ≥2 is bold only.
    expect(lt.snapshot()).toContainEqual({ text: "Heading", bold: true, italic: true, underline: true, gutter: BULLET });
  });

  it("switches the live bullet to ⏺ on darwin", () => {
    const lt = new LiveTurn({ platform: "darwin" });
    lt.ingest(se({ type: "message_start" }));
    lt.ingest(se({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }));
    lt.ingest(se({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hi" } }));
    expect(lt.snapshot()[0]!.gutter).toEqual({ text: "⏺ ", color: tok("text") });
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

// F3 Task 3: the thinking clock. P82 found NO time-bearing field on any stream_event (only
// `message_start.ttft_ms`, a duration), and the on-disk transcript keeps per-message FINISH stamps
// only — so the one honest duration source is LOCAL ARRIVAL of `content_block_start` →
// `content_block_stop`, keyed by (message id, block index) because `event.index` restarts at 0 on
// every API message. Thinking-ness is latched at the START frame: `content_block_stop` carries no
// block type at all.
describe("LiveTurn thinking clock (P82 local arrival stamps)", () => {
  const clocked = () => {
    let t = 0;
    return { lt: new LiveTurn({ now: () => t }), at: (ms: number) => { t = ms; } };
  };
  const startThinking = (lt: LiveTurn, index: number) => lt.ingest(se({ type: "content_block_start", index, content_block: { type: "thinking", thinking: "", signature: "" } }));

  it("freezes a stopped block at its arrival span, under the message's own id", () => {
    const { lt, at } = clocked();
    at(1000);
    lt.ingest(se({ type: "message_start", message: { id: "m1" } }));
    startThinking(lt, 0);
    at(4200);
    lt.ingest(se({ type: "content_block_stop", index: 0 }));
    expect(lt.thinkingDurations(4200).get("m1")).toBe(3200);
    expect(lt.thinkingDurations(999999).get("m1")).toBe(3200);      // frozen: a later `now` cannot move it
  });

  it("keys by (message id, block index), so a second message re-using index 0 keys separately", () => {
    const { lt, at } = clocked();
    at(1000);
    lt.ingest(se({ type: "message_start", message: { id: "m1" } }));
    startThinking(lt, 0);
    at(4200); lt.ingest(se({ type: "content_block_stop", index: 0 }));
    at(5000);
    lt.ingest(se({ type: "message_start", message: { id: "m2" } }));
    startThinking(lt, 0);
    at(5500); lt.ingest(se({ type: "content_block_stop", index: 0 }));
    const d = lt.thinkingDurations(5500);
    expect(d.get("m1")).toBe(3200);
    expect(d.get("m2")).toBe(500);
  });

  it("sums several thinking blocks of ONE message", () => {
    const { lt, at } = clocked();
    lt.ingest(se({ type: "message_start", message: { id: "m1" } }));
    at(100); startThinking(lt, 0);
    at(600); lt.ingest(se({ type: "content_block_stop", index: 0 }));
    at(700); startThinking(lt, 2);
    at(900); lt.ingest(se({ type: "content_block_stop", index: 2 }));
    expect(lt.thinkingDurations(900).get("m1")).toBe(700);
  });

  it("ticks an UNSTOPPED block with `now`, on top of the same message's frozen blocks", () => {
    const { lt, at } = clocked();
    lt.ingest(se({ type: "message_start", message: { id: "m1" } }));
    at(0); startThinking(lt, 0);
    at(1000); lt.ingest(se({ type: "content_block_stop", index: 0 }));
    at(2000); startThinking(lt, 1);
    expect(lt.thinkingDurations(2000).get("m1")).toBe(1000);        // the open block has run 0 ms so far
    expect(lt.thinkingDurations(3500).get("m1")).toBe(2500);        // 1000 frozen + 1500 ticking
  });

  it("clocks NOTHING for a non-thinking block, and nothing for a stop with no start latched", () => {
    const { lt, at } = clocked();
    lt.ingest(se({ type: "message_start", message: { id: "m1" } }));
    at(0); lt.ingest(se({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }));
    at(9000); lt.ingest(se({ type: "content_block_stop", index: 0 }));
    lt.ingest(se({ type: "content_block_stop", index: 7 }));
    expect(lt.thinkingDurations(9000).size).toBe(0);
  });

  it("attributes nothing when the message_start carried no id (nothing to key on)", () => {
    const { lt, at } = clocked();
    lt.ingest(se({ type: "message_start" }));
    at(0); startThinking(lt, 0);
    at(3000); lt.ingest(se({ type: "content_block_stop", index: 0 }));
    expect(lt.thinkingDurations(3000).size).toBe(0);
  });

  it("hands back a SNAPSHOT: a later block cannot mutate a map the caller already holds", () => {
    const { lt, at } = clocked();
    lt.ingest(se({ type: "message_start", message: { id: "m1" } }));
    at(0); startThinking(lt, 0);
    at(1000); lt.ingest(se({ type: "content_block_stop", index: 0 }));
    const snapshot = lt.thinkingDurations(1000);
    at(2000); startThinking(lt, 1);
    at(6000); lt.ingest(se({ type: "content_block_stop", index: 1 }));
    expect(snapshot.get("m1")).toBe(1000);
    expect(lt.thinkingDurations(6000).get("m1")).toBe(5000);
  });
});

// ── Wave C Task 6: the spinner meter ──────────────────────────────────────────────────────────────────
// The spinner's parenthetical is fed from HERE, not from a second reader of the same wire: the eased token
// estimate needs a streamed-character count (upstream's `responseLength`, fed by text deltas AND tool-input
// JSON deltas — L374708–374720 — and never by thinking deltas), and the phase ladder needs the mode, the
// open-tool window and the thinking burst. All four already exist in the frames this class consumes.
describe("LiveTurn spinner meter (Wave C Task 6)", () => {
  const clocked = () => { let t = 0; return { lt: new LiveTurn({ now: () => t }), at: (ms: number) => { t = ms; } }; };

  it("counts text deltas and tool-input JSON, and never thinking prose", () => {
    const lt = new LiveTurn();
    lt.ingest(se({ type: "message_start", message: { id: "m1" } }));
    lt.ingest(se({ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } }));
    lt.ingest(se({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "0123456789" } }));
    expect(lt.meter().chars).toBe(0);                       // thinking feeds a token counter upstream, not the length
    lt.ingest(se({ type: "content_block_start", index: 1, content_block: { type: "text", text: "" } }));
    lt.ingest(se({ type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "hello" } }));
    expect(lt.meter().chars).toBe(5);
    lt.ingest(se({ type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "t1", name: "Read", input: {} } }));
    lt.ingest(se({ type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: "{\"a\":1}" } }));
    expect(lt.meter().chars).toBe(12);
  });

  it("RECONCILES the estimate to the real usage figure when a message_delta lands (D-C6)", () => {
    const lt = new LiveTurn();
    lt.ingest(se({ type: "message_start", message: { id: "m1" } }));
    lt.ingest(se({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }));
    lt.ingest(se({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "x".repeat(40) } }));
    expect(lt.meter().chars).toBe(40);                      // estimate → 10 tokens
    lt.ingest(se({ type: "message_delta", delta: {}, usage: { output_tokens: 64 } }));
    expect(lt.meter().chars).toBe(256);                     // the truth (64 tokens) becomes the target
    lt.ingest(se({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "y".repeat(400) } }));
    expect(lt.meter().chars).toBe(440);                     // and raw chars take over again once they exceed it
  });

  it("tracks the mode across a tool round-trip", () => {
    const lt = new LiveTurn();
    expect(lt.meter().mode).toBe("requesting");
    lt.ingest(se({ type: "message_start", message: { id: "m1" } }));
    lt.ingest(se({ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } }));
    expect(lt.meter().mode).toBe("thinking");
    lt.ingest(se({ type: "content_block_stop", index: 0 }));
    lt.ingest(se({ type: "content_block_start", index: 1, content_block: { type: "text", text: "" } }));
    expect(lt.meter().mode).toBe("responding");
    lt.ingest(se({ type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "t1", name: "Read", input: {} } }));
    expect(lt.meter().mode).toBe("tool-input");
    lt.ingest(se({ type: "message_stop" }));
    expect(lt.meter().mode).toBe("tool-use");
    lt.ingest({ type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "tool_use", id: "t1", name: "Read", input: {} }] } });
    expect(lt.meter().hasActiveTools).toBe(true);
    lt.ingest({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] } });
    expect(lt.meter().hasActiveTools).toBe(false);
    expect(lt.meter().mode).toBe("requesting");             // a tool result opens a NEW request
  });

  it("does not let a SUBAGENT's tool round-trip move the parent's tool window", () => {
    const lt = new LiveTurn();
    lt.ingest({ type: "assistant", parent_tool_use_id: "agent-1", message: { content: [{ type: "tool_use", id: "nested", name: "Read", input: {} }] } });
    expect(lt.meter().hasActiveTools).toBe(false);
  });

  it("reports the thinking burst: open while it streams, then its span", () => {
    const { lt, at } = clocked();
    at(1000);
    lt.ingest(se({ type: "message_start", message: { id: "m1" } }));
    lt.ingest(se({ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } }));
    expect(lt.meter().isThinking).toBe(true);
    expect(lt.meter().lastBurst).toEqual({ startedAt: 1000 });
    at(4200);
    lt.ingest(se({ type: "content_block_stop", index: 0 }));
    expect(lt.meter().isThinking).toBe(false);
    expect(lt.meter().lastBurst).toEqual({ startedAt: 1000, endedAt: 4200, ms: 3200 });
  });

  it("clocks a burst even when the message carried no id (the thinking clock cannot, and says so)", () => {
    const { lt, at } = clocked();
    at(0);
    lt.ingest(se({ type: "message_start" }));
    lt.ingest(se({ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } }));
    at(3000);
    lt.ingest(se({ type: "content_block_stop", index: 0 }));
    expect(lt.thinkingDurations(3000).size).toBe(0);        // unchanged: nothing to attribute it TO
    expect(lt.meter().lastBurst).toEqual({ startedAt: 0, endedAt: 3000, ms: 3000 });
  });
});

describe("live and replay share ONE tool grammar", () => {
  afterEach(() => setTheme("auto"));
  // The cutover's whole point: the same fixture, ingested live off the host event stream or read back off
  // disk, yields byte-identical final RenderItem[].
  // The closing prose is load-bearing since Task 5c: a fold run that nothing has closed yet is still growable,
  // so the compact projection deliberately withholds its summary row (Static is append-only).
  const CLOSED = { type: "assistant", parent_tool_use_id: null, message: { id: "assistant-done", content: [{ type: "text", text: "done" }] } };
  it("returns equal final RenderItem[] for the same fixture from a live document and a replayed one", () => {
    const lt = new LiveTurn(); const live = new TranscriptDocument();
    for (const message of [READ_CALL, READ_RESULT_WITH_SIDECAR, CLOSED]) { lt.ingest(message); live.appendSdk("host", message); }
    expect(lt.snapshot()).toEqual([]);                                   // nothing rendered twice
    const disk = replayDocument([READ_CALL, READ_RESULT_WITH_SIDECAR, CLOSED], { id: "session-1" });
    // The replay's own display dividers shift every later resultSequence, so the id's sequence component is
    // normalized away; everything else — header segments, gutter, body — must match byte for byte.
    const toolRows = (items: readonly { kind: string; id: string }[]) =>
      items.filter((i) => !i.id.startsWith("local:replay:")).map((i) => ({ ...i, id: i.id.replace(/^tool:([^:]+):\d+:/, "tool:$1:") }));
    expect(toolRows(projectCompact(live, projectionOptions))).toEqual(toolRows(projectCompact(disk, projectionOptions)));
    expect(projectPending(live, projectionOptions)).toEqual([]);         // the call settled — nothing stays pending
  });
});

// ── F4 Task 5: the live region's own width seam, and the mid-stream fence ────────────────────────────────
describe("LiveTurn markdown width + streaming fence (F4 Task 5)", () => {
  const stream = (lt: LiveTurn, text: string) => {
    lt.ingest(se({ type: "message_start" }));
    lt.ingest(se({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }));
    lt.ingest(se({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }));
  };
  // A table is the one block whose rendering is a function of the terminal width, so it is what makes the
  // `columns` DI observable. The dep mirrors `now`'s: the REPL passes its own `columnsFn`, tests pin a value.
  const TABLE = "| name | value |\n| --- | --- |\n| alphabeticalcolumnvalue | oneoneoneoneoneoneone |\n";
  const streamed = (cols?: number) => { const lt = cols === undefined ? new LiveTurn() : new LiveTurn({ columns: () => cols }); stream(lt, TABLE); return texts(lt); };

  it("renders live markdown at the injected column count, defaulting to 80", () => {
    expect(streamed(40)[0]!.length).toBeLessThan(streamed(100)[0]!.length);
    expect(streamed()).toEqual(streamed(80));
  });

  it("re-reads `columns()` per snapshot, so a mid-turn resize repaints the in-flight message", () => {
    let cols = 100;
    const lt = new LiveTurn({ columns: () => cols }); stream(lt, TABLE);
    const wide = texts(lt);
    cols = 40;
    expect(texts(lt)).not.toEqual(wide);
  });

  // TR18 (spec settlement 4): a mid-stream OPEN fence has no closer yet. `marked` treats the unterminated
  // fence as a code block, so the partial body is HIGHLIGHTED as it arrives — it does not read as prose and
  // then flip. Pinned here, at the only place a half-typed fence exists.
  it("highlights the body of an unterminated fence while it is still streaming", () => {
    const lt = new LiveTurn();
    stream(lt, "```ts\nconst x = 1");
    const line = lt.snapshot()[0]!;
    expect(line.text).toBe("const x = 1");
    // F9 T2: real hljs replaces the ten-language regex lexer — `=` is its own (unstyled) operator node in
    // the actual TypeScript grammar, so " x " and "= " are two segments rather than one " x = " span; same
    // rendered text.
    expect(line.segments?.map((s) => s.text)).toEqual(["const", " x ", "= ", "1"]);
    expect(line.segments?.filter((s) => s.color !== undefined).length).toBeGreaterThan(0);
  });
});
