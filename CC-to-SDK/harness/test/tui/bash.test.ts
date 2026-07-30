import { describe, it, expect } from "vitest";
import { formatBashOutput, formatBashLines } from "../../src/tui/bash.js";

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
    expect(formatBashOutput({ code: 1, output: "" })).toEqual([{ text: "  exit 1", color: "red" }]);
  });
  it("caps long output and notes the remainder", () => {
    const out = formatBashOutput({ code: 0, output: Array.from({ length: 50 }, (_, i) => `L${i}`).join("\n") }, 40);
    expect(out.filter((l) => l.text.startsWith("  L")).length).toBe(40);
    expect(out.at(-1)).toEqual({ text: "  … 10 more lines", dim: true });
  });
  it("says so when the 30s timeout killed the command — otherwise a hang looks like empty output", () => {
    const out = formatBashOutput({ code: 1, output: "partial", timedOut: true });
    expect(out).toContainEqual({ text: "  timed out — killed after 30s", color: "red" });
  });
  it("appends a red exit line on non-zero exit", () => {
    expect(formatBashOutput({ code: 2, output: "boom" })).toContainEqual({ text: "  exit 2", color: "red" });
  });
});

describe("formatBashLines", () => {
  it("prefixes the magenta `! command` header", () => {
    const out = formatBashLines("ls -a", { code: 0, output: "x" });
    expect(out[0]).toEqual({ text: "! ls -a", color: "magenta" });
    expect(out[1]).toEqual({ text: "  x", dim: true });
  });
});

describe("formatBashOutput: timeout suppresses the synthetic exit line", () => {
  it("reports only the timeout, never an `exit 1` the command did not return", () => {
    // A timeout kills by signal, so runBash's `code` is its own fallback 1 — printing it under the timeout
    // line would tell the user the command exited 1, which it never did.
    const out = formatBashOutput({ code: 1, output: "", timedOut: true });
    expect(out).toContainEqual({ text: "  timed out — killed after 30s", color: "red" });
    expect(out.some((l) => l.text.includes("exit"))).toBe(false);
  });
});
