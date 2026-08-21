// test/tui/hljsRuntime.test.ts — F9 T-SYNTAX Task 1. Pins the shared hljs runtime extracted out of
// diffHighlight.ts: the memoised singleton, alias resolution, the filename map, and the resolver-callback
// emitter walk. diffHighlight.ts's own test (test/unit/diff-highlight.test.ts) is the byte-identical gate —
// it stays unedited and still passes against diffHighlight's adapted resolver.
import { describe, it, expect } from "vitest";
import { loadHljs, canonicalLanguage, detectLanguage, walkEmitter } from "../../src/tui/hljsRuntime.js";

describe("hljsRuntime", () => {
  it("loads the real highlight.js and resolves aliases through it", () => {
    expect(loadHljs()).not.toBeNull();
    expect(canonicalLanguage("ts")).toBe("typescript");
    expect(canonicalLanguage("golang")).toBe("go");
    expect(canonicalLanguage("mysql")).toBe("sql");        // EXTRA_ALIASES row
    expect(canonicalLanguage("notalang")).toBeNull();
  });
  it("detectLanguage keeps the filename map", () => {
    expect(detectLanguage("Dockerfile")).toBe("dockerfile");
    expect(detectLanguage("a/b/c.rs")).toBe("rust");
  });
  it("walkEmitter applies the resolver and inherits styles into unscoped children", () => {
    const hl = loadHljs()!;
    const res = hl.highlight("**x**", { language: "markdown" });
    const resolve = (scope?: string) => scope === "strong" ? { bold: true as const } : {};
    const runs = walkEmitter((res as any)._emitter.rootNode, resolve);
    expect(runs.map(r => r.text).join("")).toBe("**x**");
    expect(runs.filter(r => r.text.length && r.bold).map(r => r.text).join("")).toBe("**x**"); // the whole span inherits bold
  });
  it("a color-only or style-dropping walker fails: dim/italic/underline pass through", () => {
    const resolve = () => ({ color: "cyan" as const, dim: true as const, italic: true as const, underline: true as const });
    const hl = loadHljs()!;
    const res = hl.highlight("x", { language: "plaintext" });
    const runs = walkEmitter((res as any)._emitter.rootNode, resolve);
    for (const r of runs.filter(r => r.text)) expect([r.dim, r.italic, r.underline]).toEqual([true, true, true]);
  });
});
