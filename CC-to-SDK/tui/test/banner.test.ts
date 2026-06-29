import { describe, it, expect } from "vitest";
import { welcomeBanner, shortCwd, ACCENT } from "../src/banner.js";

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
