// cli/serveToken.test.ts — `ccx serve`'s token-file policy (C2), asserted through the real exported
// loadOrMintToken. Filesystem-only (its own mkdtemp, removed in afterEach) — no port bound, no listener.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadOrMintToken } from "../../../src/cli/serveMain.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "ccx-serve-token-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("loadOrMintToken", () => {
  it("mints a fresh 32-hex token, 0o600, when no file exists yet", () => {
    const { token, tokenFile } = loadOrMintToken(undefined, join(dir, "run"));
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    expect(tokenFile).toBe(join(dir, "run", "appserver.token"));
    expect(readFileSync(tokenFile, "utf8")).toBe(token);
    expect(statSync(tokenFile).mode & 0o777).toBe(0o600);
  });

  it("reuses an existing token file verbatim (trimmed)", () => {
    const p = join(dir, "tok");
    writeFileSync(p, "  s3cret\n");
    expect(loadOrMintToken(p, dir).token).toBe("s3cret");
  });

  it("REFUSES an existing but empty token file instead of serving with no authentication", () => {
    // `touch tok && ccx serve --listen ws://0.0.0.0:9001 --token-file tok` used to yield token:"" — which
    // every `if (this.opts.token)` branch read as "no auth configured", i.e. a fully open control plane on
    // every interface, with thread/start forwarding a client's whole config (cwd, permissionMode,
    // settings, mcpServers) into openSession. nonLocalWithoutToken only checks the FLAG, never the secret.
    const p = join(dir, "empty");
    writeFileSync(p, "");
    expect(() => loadOrMintToken(p, dir)).toThrow(/empty/);
    expect(readFileSync(p, "utf8")).toBe(""); // and it does NOT silently mint over the operator's file
  });

  it("REFUSES a whitespace-only token file", () => {
    const p = join(dir, "blank");
    writeFileSync(p, "  \n\t\n");
    expect(() => loadOrMintToken(p, dir)).toThrow(/blank/); // the message names the offending path
  });

  it("names the default run-dir token file in the refusal too", () => {
    const run = join(dir, "run");
    mkdirSync(run, { recursive: true });
    writeFileSync(join(run, "appserver.token"), "\n");
    expect(() => loadOrMintToken(undefined, run)).toThrow(/appserver\.token is empty/);
  });
});
