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
  it("registers all three methods with a published result shape", () => {
    for (const m of ["peer/list", "peer/send", "thread/crossSessionInbound/set"]) {
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

  it("crossSessionInbound takes exactly the three CLI values", () => {
    for (const v of ["accept", "hold", "refuse"]) {
      expect(methodSchemas["thread/crossSessionInbound/set"].params.safeParse({ threadId: "t", value: v }).success).toBe(true);
    }
    expect(methodSchemas["thread/crossSessionInbound/set"].params.safeParse({ threadId: "t", value: "maybe" }).success).toBe(false);
  });

  it("initialize's result publishes the crossSession capability marker", () => {
    const r = methodSchemas["initialize"].result!.safeParse({ userAgent: "x", version: "1", platformOs: "darwin", dynamicTools: true, crossSession: true });
    expect(r.success).toBe(true);
  });
});
