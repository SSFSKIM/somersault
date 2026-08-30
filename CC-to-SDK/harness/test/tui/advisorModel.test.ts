// tui/test/advisorModel.test.ts — bl8 T-ADVCMD Task 1: the pure catalog/eligibility half of `/advisor`.
// Transcribed against canon 2.1.251's `Dxe`/`ale`/`M8`/`E` (research-config-picker.md §2.2/§2.4). ccx has
// no fable consent flow (D12) and always persists (D10: no "(this session only)" suffix), so those two
// canon branches are absent here by design, not oversight.
import { describe, it, expect } from "vitest";
import { resolveModelAlias } from "../../src/config/models.js";
import {
  ADVISOR_RANKS, ADVISOR_RANK_FLOOR, advisorCatalog, supportsAdvisor, canAdvise, advisorDisplayName,
  applyAdvisorChoice,
} from "../../src/tui/advisorModel.js";

const SONNET = resolveModelAlias("sonnet")!;   // "claude-sonnet-5"
const OPUS = resolveModelAlias("opus")!;       // "claude-opus-5"
const FABLE = resolveModelAlias("fable")!;     // "claude-fable-5"
const UNKNOWN = "claude-nonexistent-9";

describe("advisorCatalog", () => {
  it("is exactly [fable, opus, sonnet] in canon order — all three clear the floor", () => {
    expect(advisorCatalog()).toEqual(["fable", "opus", "sonnet"]);
  });
  it("ADVISOR_RANK_FLOOR is canon's Aqt=2", () => {
    expect(ADVISOR_RANK_FLOOR).toBe(2);
  });
});

describe("canAdvise — pairing: advisee rank <= advisor rank", () => {
  it("sonnet main, opus advisor: true (3 <= 4)", () => {
    expect(canAdvise(SONNET, OPUS)).toBe(true);
  });
  it("opus main, sonnet advisor: false (4 <= 3 is false)", () => {
    expect(canAdvise(OPUS, SONNET)).toBe(false);
  });
  it("either side missing a rank entry: lenient default true", () => {
    expect(canAdvise(UNKNOWN, OPUS)).toBe(true);
    expect(canAdvise(SONNET, UNKNOWN)).toBe(true);
    expect(canAdvise(UNKNOWN, UNKNOWN)).toBe(true);
  });
});

describe("supportsAdvisor", () => {
  it("false for an id with no rank entry", () => {
    expect(supportsAdvisor(UNKNOWN)).toBe(false);
  });
  it("true for a ranked id even below the floor (haiku supports, but cannot itself advise)", () => {
    expect(supportsAdvisor("haiku")).toBe(true);
    expect(ADVISOR_RANKS["haiku"]).toBe(1);
  });
});

describe("applyAdvisorChoice", () => {
  it("valid pairing: action set, message with no Note", () => {
    const r = applyAdvisorChoice("opus", SONNET, undefined);
    expect(r).toEqual({ action: "set", model: OPUS, message: `Advisor set to ${advisorDisplayName(OPUS)}` });
  });
  it("weaker advisor than main: message ends with the pairing Note", () => {
    const r = applyAdvisorChoice("sonnet", OPUS, undefined);
    expect(r.action).toBe("set");
    expect(r.message).toBe(
      `Advisor set to ${advisorDisplayName(SONNET)}\nNote: ${advisorDisplayName(SONNET)} is less capable than the current main model (${advisorDisplayName(OPUS)}), so the advisor will not activate. Choose a more capable advisor, or switch to a smaller main model.`,
    );
  });
  it("main model without a rank entry: the unsupported Note", () => {
    const r = applyAdvisorChoice("opus", UNKNOWN, undefined);
    expect(r.action).toBe("set");
    expect(r.message).toBe(
      `Advisor set to ${advisorDisplayName(OPUS)}\nNote: the current main model (${advisorDisplayName(UNKNOWN)}) does not support the advisor. It will activate when you switch to a supported main model.`,
    );
  });
  it.each(["off", "unset"])("%s disables the advisor", (choice) => {
    expect(applyAdvisorChoice(choice, SONNET, OPUS)).toEqual({ action: "off", message: "Advisor disabled" });
  });
  it("an already-current choice is idempotent — still returns its normal action", () => {
    const r = applyAdvisorChoice("opus", SONNET, OPUS);
    expect(r).toEqual({ action: "set", model: OPUS, message: `Advisor set to ${advisorDisplayName(OPUS)}` });
  });
  it("garbage: invalid, with the canon message listing the catalog + off", () => {
    const r = applyAdvisorChoice("garbage", SONNET, undefined);
    expect(r).toEqual({ action: "invalid", message: "garbage cannot be used as an advisor. Valid options: fable, opus, sonnet, off" });
  });
  // bl8 F3 fix: `mainModel` genuinely UNDEFINED (an attached client that hasn't learned the host's model
  // yet, e.g. `ccx attach` with no launch config — main.ts's own comment on `hookOpts`) must print NO note
  // at all, mirroring `AdvisorDialog.tsx:61`'s own gate (`mainModel !== undefined && !supportsAdvisor(...)`).
  // Coercing an unknown main model to `""` (the pre-fix call-site shape) reads as a REAL, ranked-nowhere
  // model and produces a misleading "main model ()" note — this is the "unknown" case, distinct from
  // `UNKNOWN` above (a defined-but-unranked string, which correctly DOES get the unsupported note).
  it("mainModel undefined (not yet known): no compatibility note of either kind", () => {
    const r = applyAdvisorChoice("opus", undefined, undefined);
    expect(r).toEqual({ action: "set", model: OPUS, message: `Advisor set to ${advisorDisplayName(OPUS)}` });
  });
});
