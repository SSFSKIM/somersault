// test/unit/appserver/elicitation-map.test.ts
import { describe, it, expect } from "vitest";
import { outcomeToElicitResult } from "../../../src/appserver/elicitationMap.js";
import { ANSWER_KINDS } from "../../../src/appserver/broker.js";
import { decisionOutcomeParams } from "../../../src/appserver/schema/decisions.js";
import type { DecisionOutcome } from "../../../src/permissions/types.js";

// One sample per DecisionOutcome member, keyed BY KIND so the compiler owns the exhaustiveness: adding a
// member to the union turns this literal red at `npm run typecheck`, which is the only way "every outcome
// maps to a real result" can stay true of a union that grows.
const EVERY_OUTCOME: { [K in DecisionOutcome["kind"]]: Extract<DecisionOutcome, { kind: K }> } = {
  allow_once: { kind: "allow_once" },
  allow_with_updates: { kind: "allow_with_updates", updatedPermissions: [] },
  allow_always: { kind: "allow_always" },
  deny: { kind: "deny" },
  question_answer: { kind: "question_answer", answers: {} },
  plan_approve: { kind: "plan_approve", mode: "default" },
  plan_reject: { kind: "plan_reject" },
  elicitation_accept: { kind: "elicitation_accept" },
  elicitation_decline: { kind: "elicitation_decline" },
  elicitation_cancel: { kind: "elicitation_cancel" },
};

describe("outcomeToElicitResult — FAIL-CLOSED: never null", () => {
  it("maps an elicitation accept to action:accept with its content", () => {
    expect(outcomeToElicitResult({ kind: "elicitation_accept", content: { name: "ada" } }))
      .toEqual({ action: "accept", content: { name: "ada" } });
  });
  it("OMITS content on a content-free accept rather than sending it as undefined", () => {
    // toStrictEqual, not toEqual: `{action:"accept", content: undefined}` passes toEqual and is exactly what
    // the file's comment says we must not send (an url-mode accept has nothing to fill in, and MCP reads an
    // ABSENT content as "nothing filled in"). Only the strict form pins the claim.
    expect(outcomeToElicitResult({ kind: "elicitation_accept" })).toStrictEqual({ action: "accept" });
    expect("content" in outcomeToElicitResult({ kind: "elicitation_accept" })).toBe(false);
  });
  it("maps decline and cancel", () => {
    expect(outcomeToElicitResult({ kind: "elicitation_decline" })).toEqual({ action: "decline" });
    expect(outcomeToElicitResult({ kind: "elicitation_cancel" })).toEqual({ action: "cancel" });
  });
  it("maps the UNIVERSAL SYSTEM DENY to cancel — nobody declined anything when a thread tears down", () => {
    expect(outcomeToElicitResult({ kind: "deny" })).toEqual({ action: "cancel" });
    // And the asymmetry that decided it: a client that MEANS decline still has its own kind.
    expect(outcomeToElicitResult({ kind: "elicitation_decline" })).toEqual({ action: "decline" });
  });
  it("maps EVERY DecisionOutcome member to a real result rather than returning null", () => {
    for (const [kind, outcome] of Object.entries(EVERY_OUTCOME)) {
      const r = outcomeToElicitResult(outcome);
      expect(r, kind).toBeTruthy();
      expect(["accept", "decline", "cancel"], kind).toContain(r.action);
    }
  });
});

describe("the elicitation vocabulary on the wire", () => {
  it("ANSWER_KINDS keeps `deny` valid for an elicitation park — teardown settles every kind that way", () => {
    expect(ANSWER_KINDS.elicitation).toEqual(["elicitation_accept", "elicitation_decline", "elicitation_cancel", "deny"]);
    // The pairing that makes the fail-closed rule hold end to end: the kind teardown uses is answerable,
    // and the answer it produces is a real ElicitResult rather than a null. `cancel` is as real an answer
    // as `decline` — fail-closed is about ANSWERING, not about which refusal.
    expect(outcomeToElicitResult({ kind: "deny" }).action).toBe("cancel");
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
