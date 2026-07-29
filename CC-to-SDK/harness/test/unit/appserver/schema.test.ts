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
