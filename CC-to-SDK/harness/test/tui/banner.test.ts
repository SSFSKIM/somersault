import { describe, it, expect, vi } from "vitest";
import { welcomeBanner, shortCwd, ACCENT, bannerHeader, billingLabel, startupTips, renderTips, tipsVisible } from "../../src/tui/banner.js";
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
  // F8 T8 re-review: the blank line above the checklist belongs TO the checklist. Once `tipsVisible` goes
  // false — the common case in any repo that already has a CLAUDE.md — a standalone separator would leave
  // the banner ending on two consecutive empty lines. Asserting the last two entries rather than "contains
  // no double blank" so the assertion fails on the exact shape the bug produced.
  it("does not end on a double blank line when the checklist is complete and hidden", () => {
    const lines = welcomeBanner({ cwd: "/x", emptyWorkspace: false, hasClaudeMd: true }).map((l) => l.text);
    expect(lines.at(-1)).toBe("");
    expect(lines.at(-2)).not.toBe("");
    expect(lines.some((l) => l.includes("Tips for getting started"))).toBe(false);
  });

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
// F8 TASK 7 — the degraded branch (canon `Gqe`'s L500758 `if (o7O || i7O < dKm)`): a screen reader,
// or a terminal shorter than BANNER_MIN_ROWS, collapses the box to one two-span line.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe("welcomeBanner — the degraded (below-30-rows / screen-reader) branch", () => {
  it("degrades to ONE two-span line below 30 rows", () => {
    const lines = welcomeBanner({ cwd: "/tmp/x", model: "opus", rows: 24 });
    expect(lines).toHaveLength(1);
    expect(lines[0]!.text).toBe(`✻ Welcome to Claude Code ccx v${CCX_VERSION}`);
    // A5: the title is accent, the version suffix is dim. A uniformly-accent line is the defect.
    expect(lines[0]!.segments).toEqual([
      { text: "✻ Welcome to Claude Code", color: ACCENT },
      { text: ` ccx v${CCX_VERSION}`, dim: true },
    ]);
  });

  it("degrades for a screen reader at any height", () => {
    expect(welcomeBanner({ cwd: "/tmp/x", rows: 200, screenReader: true })).toHaveLength(1);
  });

  it("renders the full box at exactly 30 rows, and when rows is unknown", () => {
    expect(welcomeBanner({ cwd: "/tmp/x", rows: 30 })[0]!.text.startsWith("╭")).toBe(true);
    expect(welcomeBanner({ cwd: "/tmp/x" }).length).toBeGreaterThan(1);
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

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// F8 TASK 8 — the getting-started checklist (spec D-F8-7): canon's TWO-entry, mutually-exclusive,
// completable tip inventory (L384137), replacing ccx's former three static (and never completable) tips.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe("startupTips", () => {
  it("offers the workspace tip in an empty directory and the init tip otherwise", () => {
    expect(startupTips({ emptyWorkspace: true, hasClaudeMd: false }).filter((t) => t.isEnabled).map((t) => t.key)).toEqual(["workspace"]);
    expect(startupTips({ emptyWorkspace: false, hasClaudeMd: false }).filter((t) => t.isEnabled).map((t) => t.key)).toEqual(["claudemd"]);
  });
  it("completes the init tip once a CLAUDE.md exists, and never completes the workspace tip", () => {
    expect(startupTips({ emptyWorkspace: false, hasClaudeMd: true }).find((t) => t.key === "claudemd")!.isComplete).toBe(true);
    expect(startupTips({ emptyWorkspace: true, hasClaudeMd: true }).find((t) => t.key === "workspace")!.isComplete).toBe(false);
  });
});

describe("renderTips", () => {
  const tips = [
    { key: "done", text: "Finished thing", isEnabled: true, isComplete: true, isCompletable: true },
    { key: "todo", text: "Unfinished thing", isEnabled: true, isComplete: false, isCompletable: true },
    { key: "off", text: "Hidden thing", isEnabled: false, isComplete: false, isCompletable: true },
  ];
  // Review finding H: the expected literal is pinned by fixing TERM, not by calling TICK() in the
  // assertion — asserting a value via the function that produces it is tautological against any glyph.
  it("drops disabled tips, sorts incomplete first, ticks the complete", () => {
    vi.stubEnv("TERM", "xterm-256color");
    try { expect(renderTips(tips, false).map((l) => l.text)).toEqual(["  Unfinished thing", "  ✔ Finished thing"]); }
    finally { vi.unstubAllEnvs(); }
  });
  it("appends the home-directory note last", () => {
    expect(renderTips(tips, true).at(-1)!.text).toContain("home directory");
  });
  it("ends canon's home-directory note on 'instead' (finding C)", () => {
    expect(renderTips([], true)[0]!.text).toBe("  Note: You have launched ccx in your home directory. For the best experience, launch it in a project directory instead.");
  });
});

// Review finding B: canon hides the WHOLE section (header, rows, and the home-dir note alike) once every
// completable, enabled tip is complete — not just the ticked row. Without gating this, a repo that already
// has a CLAUDE.md (this one included) prints a permanent tick forever.
describe("tipsVisible", () => {
  it("hides once every completable+enabled tip is complete", () => {
    expect(tipsVisible([{ key: "a", text: "t", isEnabled: true, isComplete: true, isCompletable: true }])).toBe(false);
  });
  it("stays visible while any completable+enabled tip is incomplete", () => {
    expect(tipsVisible([{ key: "a", text: "t", isEnabled: true, isComplete: false, isCompletable: true }])).toBe(true);
  });
  it("ignores a complete tip that is disabled or not completable", () => {
    expect(tipsVisible([{ key: "a", text: "t", isEnabled: false, isComplete: false, isCompletable: true }])).toBe(false);
    expect(tipsVisible([{ key: "a", text: "t", isEnabled: true, isComplete: false, isCompletable: false }])).toBe(false);
  });
});

describe("welcomeBanner — the checklist wired end to end", () => {
  it("shows the workspace tip in an empty directory, and the init tip (uncompleted) otherwise", () => {
    const empty = welcomeBanner({ cwd: "/x", emptyWorkspace: true }).map((l) => l.text).join("\n");
    expect(empty).toContain("Ask Claude to create a new app or clone a repository");
    expect(empty).not.toContain("/init");
    const notEmpty = welcomeBanner({ cwd: "/x", emptyWorkspace: false }).map((l) => l.text).join("\n");
    expect(notEmpty).toContain("Run /init to create a CLAUDE.md file with instructions for Claude");
    expect(notEmpty).not.toContain("✔");
  });
  // Review finding B (red→green): the ONLY enabled tip in this scenario (claudemd) is now complete, so the
  // section — including its header — must disappear entirely, not print a permanently-ticked row. Before
  // the fix this test read `expect(text).toContain("✔ Run /init…")`; that is now the WRONG expectation, since
  // the mechanism's natural terminal state (a repo that already has a CLAUDE.md) is silence, not a tick.
  it("hides the checklist section entirely once its only enabled tip (claudemd) is complete", () => {
    const text = welcomeBanner({ cwd: "/x", emptyWorkspace: false, hasClaudeMd: true }).map((l) => l.text).join("\n");
    expect(text).not.toContain("Tips for getting started");
    expect(text).not.toContain("/init");
    expect(text).not.toContain("✔");
  });
  it("still shows the section (uncompleted) when hasClaudeMd is false", () => {
    const text = welcomeBanner({ cwd: "/x", emptyWorkspace: false, hasClaudeMd: false }).map((l) => l.text).join("\n");
    expect(text).toContain("Tips for getting started");
    expect(text).toContain("Run /init to create a CLAUDE.md file with instructions for Claude");
  });
  it("appends the home-directory note only when inHomeDir is true", () => {
    const home = welcomeBanner({ cwd: "/home/me", inHomeDir: true }).map((l) => l.text).join("\n");
    expect(home).toContain("launched ccx in your home directory");
    const notHome = welcomeBanner({ cwd: "/x", inHomeDir: false }).map((l) => l.text).join("\n");
    expect(notHome).not.toContain("home directory");
  });
});
