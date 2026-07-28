import { describe, it, expect } from "vitest";
import { classify, encode, ERR } from "../../../src/appserver/rpc.js";
describe("rpc classify", () => {
  it("routes request/notification/response/invalid", () => {
    expect(classify({ id: 1, method: "thread/start" }).kind).toBe("request");
    expect(classify({ method: "initialized" }).kind).toBe("notification");
    expect(classify({ id: "a", result: {} }).kind).toBe("response");
    expect(classify({ id: 1 }).kind).toBe("invalid");
    expect(classify("nope").kind).toBe("invalid");
    expect(classify({ id: true, method: "x" }).kind).toBe("invalid"); // id must be string|number
  });
  it("encode terminates with newline; ERR carries app codes", () => {
    expect(encode({ a: 1 }).endsWith("\n")).toBe(true);
    expect(ERR.UNSUPPORTED_FOR_ORIGIN).toBe(-33006);
  });
});
