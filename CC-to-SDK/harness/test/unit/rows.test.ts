import { describe, it, expect } from "vitest";
import { rowKind, rewindAnchorsFrom, promptText, lastAssistantText } from "../../src/sessions/rows.js";

const user = (text: string, uuid?: string) => ({ type: "user", uuid, message: { role: "user", content: text } });
const userBlocks = (blocks: unknown[], uuid = "u") => ({ type: "user", uuid, message: { role: "user", content: blocks } });
const assistant = (text: string, uuid: string) => ({ type: "assistant", uuid, message: { role: "assistant", content: [{ type: "text", text }] } });

describe("rowKind", () => {
  it("classifies a plain prompt", () => expect(rowKind(user("hello", "u1"))).toBe("prompt"));
  it("classifies a block-content prompt", () => expect(rowKind(userBlocks([{ type: "text", text: "hi" }]))).toBe("prompt"));
  it("classifies tool_result rows (any tool_result block)", () =>
    expect(rowKind(userBlocks([{ type: "tool_result", content: "x" }]))).toBe("tool_result"));
  it("classifies slash-command echoes", () =>
    expect(rowKind(user("<command-name>/compact</command-name> <command-message>compact</command-message>", "u2"))).toBe("command_echo"));
  it("classifies local-command stdout", () => expect(rowKind(user("<local-command-stdout>ok</local-command-stdout>", "u3"))).toBe("command_output"));
  it("classifies caveat rows", () => expect(rowKind(user("<local-command-caveat>Caveat: …</local-command-caveat>", "u4"))).toBe("caveat"));
  it("classifies compact summaries", () =>
    expect(rowKind(user("This session is being continued from a previous conversation that ran out of context. …", "u5"))).toBe("compact_summary"));
  it("a uuid-less user row is not an anchor", () => expect(rowKind(user("hello"))).toBe("other"));
  it("assistant rows are other", () => expect(rowKind(assistant("hi", "a1"))).toBe("other"));
});

describe("rewindAnchorsFrom", () => {
  it("returns prompts newest-first with prevUuid = nearest preceding REAL row", () => {
    const msgs = [user("A", "uA"), assistant("okA", "aA"), user("B", "uB"), assistant("okB", "aB")];
    const anchors = rewindAnchorsFrom(msgs);
    expect(anchors.map((a) => a.uuid)).toEqual(["uB", "uA"]);
    expect(anchors[0].prevUuid).toBe("aA");     // B's predecessor is A's reply
    expect(anchors[1].prevUuid).toBeNull();     // A is the first prompt
    expect(anchors[0].text).toBe("B");
  });
  it("prevUuid walks past phantom rows (command echo/stdout) to the last real row", () => {
    const msgs = [user("A", "uA"), assistant("okA", "aA"),
      user("<command-name>/compact</command-name>", "uE"), user("<local-command-stdout>x</local-command-stdout>", "uO"),
      user("B", "uB")];
    const anchors = rewindAnchorsFrom(msgs);
    expect(anchors[0].prevUuid).toBe("aA");     // skipped uO and uE
  });
  it("a prompt with ONLY phantom rows before it gets prevUuid null (code-only degradation)", () => {
    const msgs = [user("This session is being continued from a previous conversation …", "uS"), user("B", "uB")];
    expect(rewindAnchorsFrom(msgs)[0].prevUuid).toBeNull();
  });
  it("phantom rows are never anchors themselves", () => {
    const msgs = [user("<command-name>/x</command-name>", "uE"), user("real", "uR")];
    expect(rewindAnchorsFrom(msgs).map((a) => a.uuid)).toEqual(["uR"]);
  });
});

describe("promptText", () => {
  it("string content", () => expect(promptText(user("hello", "u"))).toBe("hello"));
  it("block content first text", () => expect(promptText(userBlocks([{ type: "text", text: "hey" }]))).toBe("hey"));
});

describe("lastAssistantText", () => {
  it("returns the LAST assistant reply's text", () => {
    const msgs = [assistant("first", "a1"), user("q", "u1"), assistant("second", "a2")];
    expect(lastAssistantText(msgs)).toBe("second");
  });
  it("skips trailing assistant rows that carry no text (tool_use only)", () => {
    const msgs = [assistant("real", "a1"), { type: "assistant", uuid: "a2", message: { role: "assistant", content: [{ type: "tool_use", name: "Bash", input: {} }] } }];
    expect(lastAssistantText(msgs)).toBe("real");
  });
  it("joins multiple text blocks of one reply", () => {
    const msgs = [{ type: "assistant", uuid: "a1", message: { role: "assistant", content: [{ type: "text", text: "one" }, { type: "text", text: "two" }] } }];
    expect(lastAssistantText(msgs)).toBe("one\ntwo");
  });
  it("returns empty string when there is no assistant text at all", () => {
    expect(lastAssistantText([user("q", "u1")])).toBe("");
  });
});
