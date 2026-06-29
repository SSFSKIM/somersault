import { describe, it, expect } from "vitest";
import { formatBashOutput, formatBashLines } from "../src/bash.js";

describe("formatBashOutput", () => {
  it("renders dim indented output lines", () => {
    expect(formatBashOutput({ code: 0, output: "a\nb" })).toEqual([{ text: "  a", dim: true }, { text: "  b", dim: true }]);
  });
  it("empty output → no lines", () => {
    expect(formatBashOutput({ code: 0, output: "" })).toEqual([]);
  });
  it("caps long output and notes the remainder", () => {
    const out = formatBashOutput({ code: 0, output: Array.from({ length: 50 }, (_, i) => `L${i}`).join("\n") }, 40);
    expect(out.filter((l) => l.text.startsWith("  L")).length).toBe(40);
    expect(out.at(-1)).toEqual({ text: "  … 10 more lines", dim: true });
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
