import { describe, it, expect } from "vitest";
import { methodSchemas } from "../../../src/appserver/schema/index.js";

describe("appserver schema registry", () => {
  it("registers every M1 method with a params schema", () => {
    const m1 = ["initialize", "server/status", "thread/start", "thread/resume", "thread/list",
      "thread/close", "thread/subscribe", "thread/unsubscribe", "thread/read",
      "turn/start", "turn/interrupt", "decision/list", "decision/respond"];
    for (const method of m1) {
      expect(methodSchemas[method], `${method} missing from methodSchemas`).toBeDefined();
    }
  });
  it("thread/start params round-trip through the registry entry", () => {
    const parsed = methodSchemas["thread/start"].params.safeParse({ config: { model: "x" }, unattended: "deny" });
    expect(parsed.success).toBe(true);
  });
});

describe("M8 peer schemas", () => {
  it("registers both methods with a published result shape", () => {
    for (const m of ["peer/list", "peer/send"]) {
      expect(methodSchemas[m]).toBeDefined();
      expect(methodSchemas[m].result).toBeDefined();
    }
  });

  it("peer/send requires a target and a message, and takes no from-mode of any spelling", () => {
    const ok = methodSchemas["peer/send"].params.safeParse({ target: "s-1", message: "hi" });
    expect(ok.success).toBe(true);
    expect(methodSchemas["peer/send"].params.safeParse({ target: "s-1" }).success).toBe(false);
    const withMode = methodSchemas["peer/send"].params.safeParse({ target: "s-1", message: "hi", asMode: "bypass" });
    expect(withMode.success && "asMode" in (withMode.data as object)).toBe(false);
  });

  it("peer/send's result states written-not-delivered, plus reachability", () => {
    const r = methodSchemas["peer/send"].result!.safeParse({ msgId: "u", address: "uds:/a.sock", delivered: false, statusReachable: true });
    expect(r.success).toBe(true);
    expect(methodSchemas["peer/send"].result!.safeParse({ msgId: "u", address: "uds:/a.sock", delivered: true, statusReachable: true }).success).toBe(false);
  });

  // The policy is an admission param on BOTH spines — a param only one of them publishes is a policy only
  // one of them can be given — and, since probes 120/120b, also a runtime method. The enum is pinned in all
  // three places a client can send it, from ONE tuple, so no carrier can drift from the others.
  it("crossSessionInbound rides both admission spines and its own setter, taking exactly the three CLI values", () => {
    for (const m of ["thread/start", "thread/resume", "thread/crossSessionInbound/set"]) {
      if (m === "thread/crossSessionInbound/set") {
        for (const v of ["accept", "hold", "refuse"]) {
          expect(methodSchemas[m].params.safeParse({ threadId: "t", value: v }).success).toBe(true);
        }
        expect(methodSchemas[m].params.safeParse({ threadId: "t", value: "maybe" }).success).toBe(false);
        // `value` is REQUIRED here, unlike the admission param: a setter with no value names no policy.
        expect(methodSchemas[m].params.safeParse({ threadId: "t" }).success).toBe(false);
        // The setter's own params carry no ratchet — the schema cannot see the thread's current value, so
        // `accept` is a well-formed REQUEST and the handler is what refuses a loosening one (-32602).
        expect(methodSchemas[m].params.safeParse({ threadId: "t", value: "accept" }).success).toBe(true);
        continue;
      }
      const base = m === "thread/resume" ? { sessionId: "s-1" } : {};
      for (const v of ["accept", "hold", "refuse"]) {
        expect(methodSchemas[m].params.safeParse({ ...base, crossSessionInbound: v }).success).toBe(true);
      }
      expect(methodSchemas[m].params.safeParse({ ...base, crossSessionInbound: "maybe" }).success).toBe(false);
      // OPTIONAL, and its omitted reading is the server's own default — which is why `initialize`
      // publishes the capability marker below.
      expect(methodSchemas[m].params.safeParse(base).success).toBe(true);
    }
  });

  it("initialize's result publishes the crossSession capability marker", () => {
    const r = methodSchemas["initialize"].result!.safeParse({ userAgent: "x", version: "1", platformOs: "darwin", dynamicTools: true, crossSession: true });
    expect(r.success).toBe(true);
  });
});
