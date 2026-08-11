// tui/test/consent-reason.test.ts — the "why am I being asked" line (F6 T4). Upstream's `mDr`
// (L500531-572) turns a TYPED decision reason into a sentence per variant; probe 78 established that the
// only thing the SDK forwards to a headless broker is the free-text string, which is exactly `mDr`'s
// `safetyCheck`/`other` arm (L500565-567: `{ reasonString: e.reason, configString: undefined }`). So the
// reachable function is the identity-with-a-guard, and the typed variants are recorded, not built.
import { describe, it, expect } from "vitest";
import { consentReasonLine } from "../../src/tui/dialogs/consentReason.js";

describe("consentReasonLine", () => {
  it("renders the engine's free-text reason verbatim", () => {
    expect(consentReasonLine("Path is outside allowed working directories")).toBe("Path is outside allowed working directories");
  });

  it("renders nothing when there is no reason (`mDr` L500532: `if (!e) return null`)", () => {
    expect(consentReasonLine(undefined)).toBeUndefined();
    expect(consentReasonLine("")).toBeUndefined();
  });

  it("does not reflow, trim or decorate — a multi-line reason survives intact", () => {
    const reason = "Classifier flagged this command.\n  It writes outside the workspace.";
    expect(consentReasonLine(reason)).toBe(reason);
  });
});
