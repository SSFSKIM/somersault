// test/unit/appserver/elicitation-map.test.ts
import { describe, it, expect } from "vitest";
import { outcomeToElicitResult } from "../../../src/appserver/elicitationMap.js";
import { ANSWER_KINDS } from "../../../src/appserver/broker.js";
import { decisionOutcomeParams } from "../../../src/appserver/schema/decisions.js";

describe("outcomeToElicitResult — FAIL-CLOSED: never null", () => {
  it("maps an elicitation accept to action:accept with its content", () => {
    expect(outcomeToElicitResult({ kind: "elicitation_accept", content: { name: "ada" } }))
      .toEqual({ action: "accept", content: { name: "ada" } });
  });
  it("maps decline and cancel", () => {
    expect(outcomeToElicitResult({ kind: "elicitation_decline" })).toEqual({ action: "decline" });
    expect(outcomeToElicitResult({ kind: "elicitation_cancel" })).toEqual({ action: "cancel" });
  });
  it("maps the UNIVERSAL SYSTEM DENY to decline — the teardown path must answer, not hang", () => {
    expect(outcomeToElicitResult({ kind: "deny" })).toEqual({ action: "decline" });
  });
  it("maps every other outcome kind to a real result rather than returning null", () => {
    for (const o of [
      { kind: "allow_once" as const },
      { kind: "allow_always" as const },
      { kind: "question_answer" as const, answers: {} },
    ]) {
      const r = outcomeToElicitResult(o as never);
      expect(r).toBeTruthy();
      expect(["accept", "decline", "cancel"]).toContain(r.action);
    }
  });
});

describe("the elicitation vocabulary on the wire", () => {
  it("ANSWER_KINDS keeps `deny` valid for an elicitation park — teardown settles every kind that way", () => {
    expect(ANSWER_KINDS.elicitation).toEqual(["elicitation_accept", "elicitation_decline", "elicitation_cancel", "deny"]);
    // The pairing that makes the fail-closed rule hold end to end: the kind teardown uses is answerable,
    // and the answer it produces is a real ElicitResult rather than a null.
    expect(outcomeToElicitResult({ kind: "deny" }).action).toBe("decline");
  });
  it("accepts MCP's own content value grammar and refuses anything richer", () => {
    for (const content of [{ s: "x" }, { n: 1 }, { b: true }, { a: ["x", "y"] }, {}]) {
      expect(decisionOutcomeParams.safeParse({ kind: "elicitation_accept", content }).success, JSON.stringify(content)).toBe(true);
    }
    // A nested object is the case worth refusing AT THE WIRE: this payload is handed straight to a
    // third-party MCP server, whose own ElicitResult schema would reject it far from the client that sent it.
    expect(decisionOutcomeParams.safeParse({ kind: "elicitation_accept", content: { nested: { a: 1 } } }).success).toBe(false);
  });
  it("parses the two payload-free refusals and the content-free accept", () => {
    for (const answer of [{ kind: "elicitation_accept" }, { kind: "elicitation_decline" }, { kind: "elicitation_cancel" }]) {
      expect(decisionOutcomeParams.safeParse(answer).success, answer.kind).toBe(true);
    }
  });
});
