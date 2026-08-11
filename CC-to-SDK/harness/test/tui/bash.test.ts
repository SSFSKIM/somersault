import { describe, it, expect, afterEach } from "vitest";
import { formatBashOutput, formatBashLines } from "../../src/tui/bash.js";
import { resolveThemeColor, setTheme, themeTokens } from "../../src/tui/theme.js";

// F1 Task 2: bash failures read the `error` token and the `! command` echo reads `bashBorder` — the same
// two roles the composer's bash mode uses, resolved through resolveThemeColor at projection time.
const ERROR = () => resolveThemeColor(themeTokens().error);
const BASH = () => resolveThemeColor(themeTokens().bashBorder);

describe("formatBashOutput", () => {
  it("renders dim indented output lines", () => {
    expect(formatBashOutput({ code: 0, output: "a\nb" })).toEqual([{ text: "  a", dim: true }, { text: "  b", dim: true }]);
  });
  it("empty output on success → an explicit (no output) line, never silence", () => {
    // A command that succeeds quietly (mkdir/touch/cd) printed NOTHING after the `! cmd` echo, which is
    // indistinguishable from the shell escape being broken — the reported "! shows no output" symptom.
    expect(formatBashOutput({ code: 0, output: "" })).toEqual([{ text: "  (no output)", dim: true }]);
  });
  it("empty output with a non-zero exit shows the exit line alone (the code IS the information)", () => {
    expect(formatBashOutput({ code: 1, output: "" })).toEqual([{ text: "  exit 1", color: ERROR() }]);
  });
  it("caps long output and notes the remainder", () => {
    const out = formatBashOutput({ code: 0, output: Array.from({ length: 50 }, (_, i) => `L${i}`).join("\n") }, 40);
    expect(out.filter((l) => l.text.startsWith("  L")).length).toBe(40);
    expect(out.at(-1)).toEqual({ text: "  … 10 more lines", dim: true });
  });
  it("says so when the 30s timeout killed the command — otherwise a hang looks like empty output", () => {
    const out = formatBashOutput({ code: 1, output: "partial", timedOut: true });
    expect(out).toContainEqual({ text: "  timed out — killed after 30s", color: ERROR() });
  });
  it("appends an `error`-token exit line on non-zero exit", () => {
    expect(formatBashOutput({ code: 2, output: "boom" })).toContainEqual({ text: "  exit 2", color: ERROR() });
  });
});

describe("formatBashLines", () => {
  it("prefixes the `bashBorder` `! command` header", () => {
    const out = formatBashLines("ls -a", { code: 0, output: "x" });
    expect(out[0]).toEqual({ text: "! ls -a", color: BASH() });
    expect(out[1]).toEqual({ text: "  x", dim: true });
  });
});

describe("formatBashOutput: timeout suppresses the synthetic exit line", () => {
  it("reports only the timeout, never an `exit 1` the command did not return", () => {
    // A timeout kills by signal, so runBash's `code` is its own fallback 1 — printing it under the timeout
    // line would tell the user the command exited 1, which it never did.
    const out = formatBashOutput({ code: 1, output: "", timedOut: true });
    expect(out).toContainEqual({ text: "  timed out — killed after 30s", color: ERROR() });
    expect(out.some((l) => l.text.includes("exit"))).toBe(false);
  });
});

describe("bash lines are themed, not ANSI-literal", () => {
  afterEach(() => setTheme("auto"));
  it("the `! command` echo and the failure line repaint when the theme changes", () => {
    const auto = formatBashLines("ls", { code: 2, output: "" });
    expect(auto[0].color).toBe(BASH());
    expect(auto.at(-1)).toEqual({ text: "  exit 2", color: ERROR() });
    setTheme("light-daltonized");
    const light = formatBashLines("ls", { code: 2, output: "" });
    expect(light[0].color).toBe(BASH());                        // re-read per call, not cached at import
    expect(light.at(-1)!.color).toBe(ERROR());
    expect(light[0].color).not.toBe(auto[0].color);
    expect(light.at(-1)!.color).not.toBe(auto.at(-1)!.color);
  });
});
