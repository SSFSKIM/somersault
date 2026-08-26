// test/unit/peer/address.test.ts — the pure half of the peer domain: the address grammar, the key-file
// naming rule, and the envelope's byte-exactness. No socket, no filesystem: everything here is a string
// function, which is exactly why the envelope's fixed attribute order is testable at all.
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { parseAddress, sameNamespace, keyFileName, escapeAttr, buildEnvelope, MAX_FRAME_CHARS, UNSAFE_ATTR_CHARS } from "../../../src/peer/address.js";

describe("parseAddress", () => {
  it("accepts uds: and returns the path", () => {
    expect(parseAddress("uds:/tmp/cc-socks/42.sock")).toEqual({ kind: "uds", path: "/tmp/cc-socks/42.sock" });
  });
  it("recognises bridge: as its own kind so a caller can refuse it by name", () => {
    expect(parseAddress("bridge:abc")).toEqual({ kind: "bridge" });
  });
  it("rejects anything else", () => {
    expect(parseAddress("42")).toBeUndefined();
    expect(parseAddress("")).toBeUndefined();
    expect(parseAddress("http://x")).toBeUndefined();
  });
});

describe("sameNamespace", () => {
  it("is true only in the receiver's own socket directory", () => {
    expect(sameNamespace("/tmp/cc-socks/9.sock", "/tmp/cc-socks/1.sock")).toBe(true);
    expect(sameNamespace("/tmp/other/9.sock", "/tmp/cc-socks/1.sock")).toBe(false);
  });
});

describe("keyFileName", () => {
  it("is <pid>.<sha256 of the socket path>.key", () => {
    const p = "/tmp/cc-socks/7.sock";
    expect(keyFileName(7, p)).toBe(`7.${createHash("sha256").update(p).digest("hex")}.key`);
  });
});

describe("escapeAttr", () => {
  it("escapes the five XML attribute characters", () => {
    expect(escapeAttr(`a"b&c<d>e'f`)).toBe("a&quot;b&amp;c&lt;d&gt;e&apos;f");
  });
  it("flags control characters as unsafe rather than escaping them", () => {
    expect(UNSAFE_ATTR_CHARS.test("a\nb")).toBe(true);
    expect(UNSAFE_ATTR_CHARS.test("a\tb")).toBe(true);
    expect(UNSAFE_ATTR_CHARS.test("plain name")).toBe(false);
  });
});

describe("buildEnvelope", () => {
  it("emits attributes in the CLI's fixed order, omitting the ones not set", () => {
    const out = buildEnvelope({ from: "uds:/s.sock", fromName: "gw" })("hello");
    expect(out).toBe('<cross-session-message from="uds:/s.sock" from-name="gw" from-mode="prompting">\nhello\n</cross-session-message>');
  });
  it("places from-session between from and from-name", () => {
    const out = buildEnvelope({ from: "uds:/s.sock", fromSession: "sess-1", fromName: "gw" })("hi");
    expect(out.indexOf("from-session=")).toBeGreaterThan(out.indexOf('from="'));
    expect(out.indexOf("from-session=")).toBeLessThan(out.indexOf("from-name="));
  });
  it("never emits hop-chain", () => {
    expect(buildEnvelope({ from: "uds:/s.sock" })("hi")).not.toContain("hop-chain");
  });
  it("always asserts prompting, with no way to ask for anything else", () => {
    expect(buildEnvelope({ from: "uds:/s.sock" })("hi")).toContain('from-mode="prompting"');
  });
  it("escapes a hostile name so the attribute stays well-formed", () => {
    const out = buildEnvelope({ from: "uds:/s.sock", fromName: 'ev"il' })("hi");
    expect(out).toContain('from-name="ev&quot;il"');
  });
});

describe("MAX_FRAME_CHARS", () => {
  it("is well under any plausible receiver line cap", () => {
    expect(MAX_FRAME_CHARS).toBe(60_000);
  });
});
