import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { openSession } from "../../src/index.js";
import { formatUsage, UNAVAILABLE } from "../../src/tui/usageFormat.js";

const envToken = !!(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN);
const haveCreds = existsSync(join(homedir(), ".claude", ".credentials.json"));
// Token-free half: NO env token (the CLI falls back to the interactive credential — F4) AND the
// credential file exists on this machine. Anything else skips cleanly (spec acceptance ④ gate).
const tokenFree = !envToken && haveCreds ? describe : describe.skip;
// Keyed half: the standard gate — proves the honest-unavailable line under CLAUDE_CODE_OAUTH_TOKEN.
const keyed = process.env.CLAUDE_CODE_OAUTH_TOKEN && !process.env.ANTHROPIC_API_KEY ? describe : describe.skip;

tokenFree("usage surface (interactive credential)", () => {
  it("renders at least one utilization bar with a reset time", async () => {
    const s = openSession({ model: "claude-haiku-4-5-20251001", permissionMode: "bypassPermissions", settingSources: [] });
    try {
      await s.submit("Say exactly: OK", () => {});
      const u = await s.usage();
      const text = formatUsage(u).map((l) => l.text).join("\n");
      expect(text).toMatch(/%/);
      expect(text).toMatch(/resets/);
    } finally { await s.dispose(); }
  }, 120_000);
});

keyed("usage surface (oauth token)", () => {
  it("degrades to the honest-unavailable line", async () => {
    const s = openSession({ model: "claude-haiku-4-5-20251001", permissionMode: "bypassPermissions", settingSources: [] });
    try {
      await s.submit("Say exactly: OK", () => {});
      const text = formatUsage(await s.usage()).map((l) => l.text).join("\n");
      expect(text).toContain(UNAVAILABLE);
    } finally { await s.dispose(); }
  }, 120_000);
});
