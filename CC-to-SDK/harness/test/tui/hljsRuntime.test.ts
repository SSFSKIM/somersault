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
  // Fix wave (task review, Important #1): "**x**" attaches all three of its children DIRECTLY to the one
  // `strong` node, so the "inherits styles into unscoped children" test above never sends a style through
  // the `inherited` PARAMETER across a node boundary — resolve() is called once and its result trivially
  // covers all three children. `"***bold italic***"` is the genuine cross-node fixture: hljs parses it as
  // `strong` → literal "**" + a NESTED `emphasis` node + literal "**" (confirmed against a real
  // highlight.js@11.11.1 run: `{scope:"strong", children:["**", {scope:"emphasis", children:["*bold
  // italic*"]}, "**"]}`). The resolver below sets a field ONLY the ancestor provides (`bold`, on `strong`)
  // and a field BOTH provide with DIFFERING values (`color`: strong→"red", emphasis→"blue"), so one test
  // catches both directions of a merge regression: dropping `...inherited` loses `bold` on the emphasis
  // node's text (mutation (a)); inverting the merge order lets the ancestor's `color` win over the node's
  // own nearer-scope `color` (mutation (b)).
  it("walkEmitter carries ancestor style ACROSS a real node boundary, nearer scope winning on overlap", () => {
    const hl = loadHljs()!;
    const res = hl.highlight("***bold italic***", { language: "markdown" });
    const resolve = (scope?: string) => {
      if (scope === "strong") return { bold: true as const, color: "red" as const };
      if (scope === "emphasis") return { italic: true as const, color: "blue" as const };
      return {};
    };
    const runs = walkEmitter((res as any)._emitter.rootNode, resolve);
    expect(runs.map(r => r.text).join("")).toBe("***bold italic***");
    // The literal "**" bookends are `strong`'s own direct string children: only `strong`'s style, no italic.
    const bookend = runs.find(r => r.text === "**");
    expect(bookend).toMatchObject({ bold: true, color: "red" });
    expect(bookend?.italic).toBeUndefined();
    // The nested `emphasis` text must have INHERITED `bold` from its `strong` ancestor (mutation (a) drops
    // this — the field only the ancestor sets) AND its OWN `color` must win over the ancestor's (mutation
    // (b) inverts the merge order so the ancestor's "red" would leak through instead of "blue").
    const nested = runs.find(r => r.text === "*bold italic*");
    expect(nested).toMatchObject({ bold: true, italic: true, color: "blue" });
  });
});
