import { describe, it, expect } from "vitest";
import { welcomeBanner, shortCwd, ACCENT, bannerHeader, billingLabel } from "../../src/tui/banner.js";
import { CCX_VERSION } from "../../src/tui/statusLine.js";

describe("shortCwd", () => {
  it("collapses $HOME to ~", () => {
    expect(shortCwd("/home/me/proj", "/home/me")).toBe("~/proj");
    expect(shortCwd("/home/me", "/home/me")).toBe("~");
  });
  it("leaves non-home paths untouched", () => {
    expect(shortCwd("/var/tmp/x", "/home/me")).toBe("/var/tmp/x");
  });
  it("does not collapse a sibling prefix (boundary-safe)", () => {
    expect(shortCwd("/home/melon", "/home/me")).toBe("/home/melon");
  });
});

describe("welcomeBanner", () => {
  it("renders the CC welcome header in accent + the cwd/model/mode snapshot", () => {
    const lines = welcomeBanner({ cwd: "/home/me/proj", model: "claude-opus-4-8", mode: "default" });
    const text = lines.map((l) => l.text).join("\n");
    expect(text).toContain("✻ Welcome to Claude Code");
    expect(text).toContain("claude-opus-4-8");
    expect(text).toContain("mode  default");
    expect(text).toContain("Tips for getting started");
    // header line is accent + bold
    const header = lines.find((l) => l.text.includes("Welcome to Claude Code"))!;
    expect(header.color).toBe(ACCENT);
    expect(header.bold).toBe(true);
  });
  it("box borders align (top/header/bottom equal width)", () => {
    const lines = welcomeBanner({ cwd: "/x" });
    const [top, mid, bot] = lines;
    expect(top.text.length).toBe(mid.text.length);
    expect(mid.text.length).toBe(bot.text.length);
    expect(top.text.startsWith("╭")).toBe(true);
    expect(bot.text.startsWith("╰")).toBe(true);
  });
  it("falls back to (default) model when none given", () => {
    const text = welcomeBanner({ cwd: "/x" }).map((l) => l.text).join("\n");
    expect(text).toContain("model  (default)");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// WAVE C TASK 13 (EP-C8) — the banner's HEADER (§C8.2) and its MODEL/AUTH line (§C8.3).
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe("bannerHeader — §C8.2 `k6I`/`L6I` (bundle L453377)", () => {
  it("horizontal (≥70 cols) prints the version, wrapped in the leading/trailing space upstream's template has", () => {
    expect(bannerHeader(CCX_VERSION, 100)).toBe(` ccx v${CCX_VERSION} `);
    // Pinned against package.json's own reader rather than a literal, so a version bump does not red this file.
    expect(CCX_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
  it("compact (<70 cols) drops the version — `L6I` is the bare name", () => {
    expect(bannerHeader(CCX_VERSION, 69)).toBe(" ccx ");
    expect(bannerHeader(CCX_VERSION, 69)).not.toContain("v");
  });
  it("the box carries it as BORDER TEXT at offset 3, so `╭───` precedes it", () => {
    const [top] = welcomeBanner({ cwd: "/x", version: "9.9.9", columns: 100 });
    expect(top.text.startsWith(`╭─── ccx v9.9.9 ─`)).toBe(true);
  });
  it("compact moves the border text to offset 1 and the box still squares up", () => {
    const lines = welcomeBanner({ cwd: "/x", version: "9.9.9", columns: 60 });
    expect(lines[0].text.startsWith("╰")).toBe(false);
    expect(lines[0].text.startsWith("╭─ ccx ─")).toBe(true);
    expect(lines[0].text.length).toBe(lines[2].text.length);
  });
});

describe("billingLabel — §C8.3 `cpf`, mapped from what probe 101 proved REACHABLE", () => {
  it("an OAuth token source is a subscription", () => {
    expect(billingLabel({ apiProvider: "firstParty", tokenSource: "CLAUDE_CODE_OAUTH_TOKEN" })).toBe("Claude subscription");
  });
  it("any other first-party credential is metered API billing", () => {
    expect(billingLabel({ apiProvider: "firstParty", apiKeySource: "ANTHROPIC_API_KEY" })).toBe("API Usage Billing");
    expect(billingLabel({ apiProvider: "firstParty", tokenSource: "apiKeyHelper" })).toBe("API Usage Billing");
  });
  it("a non-firstParty provider prints its display name from the `r7` table", () => {
    expect(billingLabel({ apiProvider: "bedrock" })).toBe("Amazon Bedrock");
    expect(billingLabel({ apiProvider: "vertex" })).toBe("Google Vertex AI");
    expect(billingLabel({ apiProvider: "anthropicGoogleCloud" })).toBe("Claude Platform on Google Cloud");
  });
  it("an unknown/absent shape is OMITTED, never guessed — subscriptionType never arrives (probe 101)", () => {
    expect(billingLabel(undefined)).toBeUndefined();
    expect(billingLabel({})).toBeUndefined();
    expect(billingLabel({ apiProvider: "firstParty" })).toBeUndefined();
    expect(billingLabel({ apiProvider: "some-future-provider" })).toBeUndefined();
    // A prototype key is not a provider name.
    expect(billingLabel({ apiProvider: "constructor" })).toBeUndefined();
  });
});

describe("welcomeBanner — the model/auth line (§C8.3 `ARa`)", () => {
  it("prints `{model} with {Effort} effort · {billing}`", () => {
    const text = welcomeBanner({ cwd: "/x", model: "claude-opus-5", effort: "xhigh", mode: "default",
      account: { apiProvider: "firstParty", tokenSource: "CLAUDE_CODE_OAUTH_TOKEN" } }).map((l) => l.text).join("\n");
    expect(text).toContain("claude-opus-5 with xHigh effort · Claude subscription");
  });
  it("drops the effort clause when no level is known, and the billing clause when the account is not", () => {
    const text = welcomeBanner({ cwd: "/x", model: "claude-opus-5", mode: "default" }).map((l) => l.text).join("\n");
    expect(text).toContain("model  claude-opus-5   ·   mode  default");
    expect(text).not.toContain("effort");
    expect(text).not.toContain("·   ·");
  });
});
