// cli/serveArgs.test.ts — Task 11: the `ccx serve` grammar, asserted through the real exported
// `parseCcx` (same idiom as cli-args.test.ts) — no port bound, no filesystem/network touched. The
// listener itself is Task 10's suite (test/unit/appserver/wsTransport.test.ts); the live run is Task 13.
import { describe, it, expect } from "vitest";
import { parseCcx, nonLocalWithoutToken } from "../../../src/cli/args.js";

describe("parseCcx serve", () => {
  it("defaults to loopback:ephemeral, no token file, no allow-listed origins", () => {
    const a = parseCcx(["serve"]);
    expect(a).toMatchObject({ command: "serve", listen: { host: "127.0.0.1", port: 0 }, allowOrigins: [] });
    expect(a.tokenFile).toBeUndefined();
  });

  it("parses --listen ws://HOST:PORT", () => {
    const a = parseCcx(["serve", "--listen", "ws://0.0.0.0:9001"]);
    expect(a.listen).toEqual({ host: "0.0.0.0", port: 9001 });
  });

  it("--listen with no port defaults to ephemeral (0)", () => {
    const a = parseCcx(["serve", "--listen", "ws://localhost"]);
    expect(a.listen).toEqual({ host: "localhost", port: 0 });
  });

  it("strips IPv6 brackets from --listen ws://[::1]:PORT, recognizing it as loopback", () => {
    // `URL#hostname` keeps the brackets ("[::1]") — LOOPBACK_HOSTS and net.Server.listen both need the
    // bare "::1"; a bracketed string neither matches loopback nor binds (ENOTFOUND).
    const a = parseCcx(["serve", "--listen", "ws://[::1]:9001"]);
    expect(a.listen).toEqual({ host: "::1", port: 9001 });
    expect(nonLocalWithoutToken(a)).toBe(false); // loopback, no --token-file required
  });

  it("a non-loopback bracketed IPv6 --listen still triggers the token-file refusal", () => {
    const a = parseCcx(["serve", "--listen", "ws://[2001:db8::1]:9001"]);
    expect(a.listen).toEqual({ host: "2001:db8::1", port: 9001 });
    expect(nonLocalWithoutToken(a)).toBe(true);
  });

  it("rejects a --listen value that isn't a ws:// URL", () => {
    expect(() => parseCcx(["serve", "--listen", "not a url"])).toThrow(/ws:\/\//);
    expect(() => parseCcx(["serve", "--listen", "http://127.0.0.1:9001"])).toThrow(/ws:\/\//);
  });

  it("parses --token-file", () => {
    const a = parseCcx(["serve", "--token-file", "/tmp/appserver.token"]);
    expect(a.tokenFile).toBe("/tmp/appserver.token");
  });

  it("--allow-origin is repeatable and accumulates in order", () => {
    const a = parseCcx(["serve", "--allow-origin", "http://a.test", "--allow-origin", "http://b.test"]);
    expect(a.allowOrigins).toEqual(["http://a.test", "http://b.test"]);
  });

  it("rejects an unexpected positional argument — serve takes no target", () => {
    expect(() => parseCcx(["serve", "extra"])).toThrow(/extra/);
  });

  it("throws on a dangling --listen/--token-file/--allow-origin with no value", () => {
    expect(() => parseCcx(["serve", "--listen"])).toThrow(/--listen/);
    expect(() => parseCcx(["serve", "--token-file"])).toThrow(/--token-file/);
    expect(() => parseCcx(["serve", "--allow-origin"])).toThrow(/--allow-origin/);
  });

  describe("nonLocalWithoutToken — spec §11's last rule, pure (no I/O)", () => {
    it("refuses a non-loopback --listen with no --token-file", () => {
      expect(nonLocalWithoutToken(parseCcx(["serve", "--listen", "ws://0.0.0.0:9001"]))).toBe(true);
    });
    it("allows a non-loopback --listen once --token-file is given", () => {
      expect(nonLocalWithoutToken(parseCcx(["serve", "--listen", "ws://0.0.0.0:9001", "--token-file", "/tmp/tok"]))).toBe(false);
    });
    it("allows the loopback default with no --token-file", () => {
      expect(nonLocalWithoutToken(parseCcx(["serve"]))).toBe(false);
    });
    it("never fires for a non-serve command", () => {
      expect(nonLocalWithoutToken(parseCcx(["agents"]))).toBe(false);
    });
  });
});
