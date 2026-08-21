import { describe, it, expect } from "vitest";
import { rowKind, rewindAnchorsFrom, promptText, recentAssistantTexts } from "../../src/sessions/rows.js";

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

describe("recentAssistantTexts", () => {
  // Generalized from the old single-slot `lastAssistantText` (T-COPY): a NEWEST-FIRST ring so `/copy N`
  // can index into it (N=1 ⇒ index 0). Canon `tjh` (R1 §1.6): backwards walk, push instead of early-return.
  it("index 0 is the newest reply", () => {
    const msgs = [assistant("first", "a1"), user("q", "u1"), assistant("second", "a2")];
    expect(recentAssistantTexts(msgs)[0]).toBe("second");
  });
  it("orders every entry newest-first, not just the head — this is what /copy N indexes into", () => {
    const msgs = [assistant("one", "a1"), assistant("two", "a2"), assistant("three", "a3")];
    expect(recentAssistantTexts(msgs)).toEqual(["three", "two", "one"]);
  });
  // Canon's cap is `sHw = 20` (R1 §1.6.1) and counts COLLECTED entries, not rows scanned.
  it("caps at 20 by default — the 21st-oldest reply falls off the ring", () => {
    const msgs = Array.from({ length: 21 }, (_, i) => assistant(`msg${i}`, `a${i}`));   // msg0 oldest … msg20 newest
    const out = recentAssistantTexts(msgs);
    expect(out).toHaveLength(20);
    expect(out[0]).toBe("msg20");                  // newest
    expect(out[19]).toBe("msg1");                  // the 20th-newest, exactly at the cap
    expect(out).not.toContain("msg0");              // the 21st-back, one past the cap, dropped
  });
  it("a list of exactly 20 replies is not truncated (the boundary's other edge)", () => {
    const msgs = Array.from({ length: 20 }, (_, i) => assistant(`msg${i}`, `a${i}`));
    expect(recentAssistantTexts(msgs)).toHaveLength(20);
  });
  it("cap is overridable by the caller", () => {
    const msgs = Array.from({ length: 5 }, (_, i) => assistant(`m${i}`, `a${i}`));
    expect(recentAssistantTexts(msgs, 2)).toEqual(["m4", "m3"]);
  });
  it("skips trailing assistant rows that carry no text (tool_use only)", () => {
    const msgs = [assistant("real", "a1"), { type: "assistant", uuid: "a2", message: { role: "assistant", content: [{ type: "tool_use", name: "Bash", input: {} }] } }];
    expect(recentAssistantTexts(msgs)).toEqual(["real"]);
  });
  // Fidelity decision 1 (T-COPY brief): canon joins text blocks with a BLANK LINE (`xd(o, "\n\n")`,
  // R1 §1.6.4), not a bare newline — ccx previously joined with "\n" here.
  it("joins multiple text blocks of one reply with a blank line, matching canon's xd(o, \"\\n\\n\")", () => {
    const msgs = [{ type: "assistant", uuid: "a1", message: { role: "assistant", content: [{ type: "text", text: "one" }, { type: "text", text: "two" }] } }];
    expect(recentAssistantTexts(msgs)).toEqual(["one\n\ntwo"]);
  });
  it("returns an empty array when there is no assistant text at all", () => {
    expect(recentAssistantTexts([user("q", "u1")])).toEqual([]);
  });
  // Fidelity decision 2 (T-COPY brief): canon's list gate is bare truthiness on the joined string (`if(i)`),
  // not `.trim()` — a text block whose only content is whitespace still qualifies and enters the ring.
  it("bare-truthiness gate: a whitespace-only text block QUALIFIES (canon's `if(i)`, not `.trim()`)", () => {
    const msgs = [{ type: "assistant", uuid: "a1", message: { role: "assistant", content: [{ type: "text", text: " " }] } }];
    expect(recentAssistantTexts(msgs)).toEqual([" "]);
  });
  // A failed turn persists as an ordinary-looking assistant row whose only tell is `is_api_error_message`
  // (probe 96's synthetic frame). Seeding /copy from it on resume would hand the user "API Error: 401 …" as
  // the assistant's reply, so the disk seeder skips it exactly like the live writer does — and it is
  // excluded from the ring entirely, not merely from index 0, so it can never surface at any N.
  const apiError = (text: string, uuid: string) => ({ ...assistant(text, uuid), is_api_error_message: true, error: "authentication_failed" });
  it("skips api-error rows everywhere in the ring, not just at the head", () => {
    const msgs = [assistant("oldest real", "a0"), apiError("Failed to authenticate. API Error: 401", "aerr"), assistant("newest real", "a2")];
    expect(recentAssistantTexts(msgs)).toEqual(["newest real", "oldest real"]);
  });
  it("returns an empty array when the only assistant row is an api error", () => {
    expect(recentAssistantTexts([user("q", "u1"), apiError("API Error: 401", "a1")])).toEqual([]);
  });
  // The shape that actually arrives here. Measured against a real session on SDK 0.3.220: getSessionMessages
  // STRIPS the row-level flag, so a disk row's only tell is the synthetic model marker inside `message`.
  const diskSynthetic = (text: string, uuid: string) =>
    ({ type: "assistant", uuid, session_id: "s", parent_tool_use_id: null, parent_agent_id: null, timestamp: "t",
       message: { id: "m", role: "assistant", model: "<synthetic>", type: "message", content: [{ type: "text", text }] } });
  it("skips a disk-read synthetic row (flag stripped, model \"<synthetic>\" survives)", () => {
    const msgs = [assistant("real", "a1"), user("q", "u1"), diskSynthetic("You've hit your session limit · resets 10:50am", "a2")];
    expect(recentAssistantTexts(msgs)).toEqual(["real"]);
    expect(recentAssistantTexts([diskSynthetic("API Error: 401", "a1")])).toEqual([]);
  });
});
