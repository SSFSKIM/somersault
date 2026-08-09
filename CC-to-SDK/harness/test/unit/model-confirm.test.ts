// test/unit/model-confirm.test.ts — the model-switch confirm's gate and its copy (Wave S T12, EP-S8).
// Every literal is upstream 2.1.220's: the gate is `XMo` (L315221), the copy L447014-447039.
import { describe, it, expect } from "vitest";
import {
  CONFIRM_CANCEL, CONFIRM_SUBTITLE, CONFIRM_TITLE, confirmAccept, confirmBody, needsModelConfirm,
  stripContextSuffix,
} from "../../src/tui/modelConfirmModel.js";
import { totalOutputTokens } from "../../src/tui/commands.js";

const base = { next: "claude-opus-5", current: "claude-sonnet-5", outputTokens: 500 };

describe("needsModelConfirm — the four conditions (XMo, L315221)", () => {
  it("does not prompt before the model has produced output", () => {
    expect(needsModelConfirm({ ...base, outputTokens: 0 })).toBe(false);
  });
  it("does not prompt again at the same output count once acknowledged", () => {
    expect(needsModelConfirm({ ...base, ackedAt: 500 })).toBe(false);
    expect(needsModelConfirm({ ...base, ackedAt: 400 })).toBe(true);
  });
  it("does not prompt when the alias resolves to the same model", () => {
    expect(needsModelConfirm({ ...base, next: "sonnet", current: "claude-sonnet-5" })).toBe(false);
  });
  it("does not prompt for a context-window variant of the same model", () => {
    expect(needsModelConfirm({ ...base, next: "claude-sonnet-5[1m]", current: "claude-sonnet-5" })).toBe(false);
    expect(needsModelConfirm({ ...base, next: "claude-sonnet-5", current: "claude-sonnet-5[2m]" })).toBe(false);
  });
  it("prompts on a real mid-conversation switch", () => {
    expect(needsModelConfirm(base)).toBe(true);
  });
  // The picker's `s` path puts a session-only model in force WITHOUT changing `current`, so the row that
  // reads as ticked is no longer the model the cache belongs to. The gate compares against what is running.
  it("compares against the session-only override when one is in force", () => {
    expect(needsModelConfirm({ ...base, next: "opus", sessionModel: "claude-opus-5" })).toBe(false);
    expect(needsModelConfirm({ ...base, next: "claude-sonnet-5", sessionModel: "claude-opus-5" })).toBe(true);
  });
  // A model we cannot name is not a model we can say differs — and a spurious confirm on a surface whose
  // decline costs the user their switch is worse than a silent one.
  it("does not prompt when there is no model in force to compare against", () => {
    expect(needsModelConfirm({ next: "claude-opus-5", outputTokens: 500 })).toBe(false);
  });
});

describe("stripContextSuffix", () => {
  it("strips the 1m/2m context-window suffix, case-insensitively, and nothing else", () => {
    expect(stripContextSuffix("claude-fable-5[1m]")).toBe("claude-fable-5");
    expect(stripContextSuffix("claude-fable-5[2M]")).toBe("claude-fable-5");
    expect(stripContextSuffix("claude-opus-5")).toBe("claude-opus-5");
  });
});

describe("the copy (L447014-447039)", () => {
  it("carries upstream's copy verbatim", () => {
    expect(CONFIRM_TITLE).toBe("Switch model?");
    expect(CONFIRM_SUBTITLE).toBe("Your next response will be slower and use more tokens");
    expect(confirmAccept("Opus 5")).toBe("Yes, switch to Opus 5");
    expect(CONFIRM_CANCEL).toBe("No, go back");
  });
  it("names the target BOLD inside the cache sentence", () => {
    const [line] = confirmBody("Opus 5");
    expect(line!.segments!.map((s) => s.text).join("")).toBe(
      "This conversation is cached for the current model. Switching to Opus 5 means the full history gets re-read on your next message.",
    );
    expect(line!.segments!.find((s) => s.text === "Opus 5")!.bold).toBe(true);
  });
});

describe("totalOutputTokens — the gate's denominator", () => {
  it("sums outputTokens across every model_usage entry", () => {
    expect(totalOutputTokens({ session: { model_usage: {
      "claude-sonnet-5": { outputTokens: 120, inputTokens: 9000 },
      "claude-opus-5": { outputTokens: 30 },
      "claude-haiku-4-5": {},
    } } })).toBe(150);
  });
  it("is 0 for an absent or empty usage payload", () => {
    expect(totalOutputTokens(undefined)).toBe(0);
    expect(totalOutputTokens({})).toBe(0);
    expect(totalOutputTokens({ session: {} })).toBe(0);
  });
});
