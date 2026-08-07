// test/unit/diff-highlight.test.ts — EP-R5 Task 9. Pins the THREE upstream scope maps (`K$p`/`Y$p`/`jmH`,
// all on bundle L419855), the bare-filename map (`X$p`, L419856) and the palette selector. Every colour
// asserted below is a VERBATIM transcription of the bundle's own `cd(r,g,b)` / `Z3(n)` call — data, not a
// judgement — so a test that fails here means the port drifted from 2.1.220, never that the value is
// "wrong". Keyless: `selectPalette` is driven entirely through its `env`/`theme` deps, so nothing here
// reads a real terminal or the process theme.
import { describe, it, expect } from "vitest";
import { detectLanguage, highlightDiffLine, selectPalette } from "../../src/tui/diffHighlight.js";

// K$p (Monokai/dark) — the six cells the cases below reach.
const D_KEYWORD = "#f92672", D_STORAGE = "#66d9ef", D_STRING = "#e6db74", D_NUMBER = "#be84ff", D_COMMENT = "#75715e", D_TITLE_FN = "#a6e22e", D_PARAMS = "#fd971f";
// Y$p (light) — entirely different values, which is the point of it being a second map.
const L_KEYWORD = "#a71d5d", L_STORAGE = "#a71d5d", L_STRING = "#183691", L_NUMBER = "#0086b3", L_COMMENT = "#969896";
// jmH (256-colour fallback) — palette INDICES, in the theme grammar `ansi256(n)` that `resolveThemeColor`
// already understands, so these survive the `Line` boundary as an SGR index rather than as an RGB triple.
const A_KEYWORD = "ansi256(13)", A_STORAGE = "ansi256(14)", A_STRING = "ansi256(10)", A_NUMBER = "ansi256(12)", A_COMMENT = "ansi256(8)";

const colorOf = (code: string, lang: string | undefined, palette: Parameters<typeof highlightDiffLine>[2], text: string) =>
  highlightDiffLine(code, lang, palette).find((s) => s.text === text)?.color;

describe("highlightDiffLine — the three scope maps", () => {
  it("dark: `keyword` is K$p's cd(249,38,114)", () => {
    // `return` is a keyword that is NOT in GmH, so it takes the plain `keyword` cell.
    expect(colorOf("  return 1;", "typescript", "dark", "return")).toBe(D_KEYWORD);
  });
  it("dark: a GmH storage keyword takes `_storage` cd(102,217,239), NOT `keyword` (qmH L419574)", () => {
    // Upstream's one irregular lookup: `keyword` whose TEXT is one of the 17 declaration keywords in `GmH`
    // is re-scoped to `_storage`. hljs emits both as scope `keyword`, so without GmH `const` and `return`
    // would be the same colour — they are not.
    expect(colorOf("const x = 1;", "typescript", "dark", "const")).toBe(D_STORAGE);
    expect(colorOf("const x = 1;", "typescript", "dark", "const")).not.toBe(D_KEYWORD);
  });
  it("dark: string / number / comment take their K$p cells", () => {
    expect(colorOf('  return "hi"; // t', "typescript", "dark", '"hi"')).toBe(D_STRING);
    expect(colorOf("const x = 1;", "typescript", "dark", "1")).toBe(D_NUMBER);
    expect(colorOf('  return "hi"; // t', "typescript", "dark", "// t")).toBe(D_COMMENT);
  });
  it("dark: a DOTTED scope falls back to its prefix (`title.function` has its own cell; `params` too)", () => {
    expect(colorOf("def f(a):", "python", "dark", "f")).toBe(D_TITLE_FN);
    expect(colorOf("def f(a):", "python", "dark", "a")).toBe(D_PARAMS);
  });
  it("light (Y$p) differs from dark (K$p) on every cell the same line touches", () => {
    const line = 'const s = "hi"; // t';
    for (const [text, dark, light] of [["const", D_STORAGE, L_STORAGE], ['"hi"', D_STRING, L_STRING], ["// t", D_COMMENT, L_COMMENT]] as const) {
      expect(colorOf(line, "typescript", "dark", text)).toBe(dark);
      expect(colorOf(line, "typescript", "light", text)).toBe(light);
      expect(dark).not.toBe(light);
    }
    expect(colorOf("const x = 1;", "typescript", "light", "1")).toBe(L_NUMBER);
    expect(colorOf("  return 1;", "typescript", "light", "return")).toBe(L_KEYWORD);
  });
  it("ansi256 (jmH) emits palette INDICES, not RGB — and covers only the 12 scopes upstream gave it", () => {
    const line = 'const s = "hi"; // t';
    expect(colorOf(line, "typescript", "ansi256", "const")).toBe(A_STORAGE);
    expect(colorOf(line, "typescript", "ansi256", '"hi"')).toBe(A_STRING);
    expect(colorOf(line, "typescript", "ansi256", "// t")).toBe(A_COMMENT);
    expect(colorOf("  return 1;", "typescript", "ansi256", "return")).toBe(A_KEYWORD);
    expect(colorOf("const x = 1;", "typescript", "ansi256", "1")).toBe(A_NUMBER);
    // `params` is one of the 12 scopes jmH does NOT carry — upstream falls through to the row foreground,
    // which for us means an UNSTYLED segment rather than an invented colour.
    expect(colorOf("def f(a):", "python", "ansi256", "a")).toBeUndefined();
  });
});

describe("highlightDiffLine — the plain arms", () => {
  it("an unknown language → ONE unstyled segment (upstream i2p's `if (!e.lang)` bail)", () => {
    expect(highlightDiffLine("fn main() {}", "definitely-not-a-language", "dark")).toEqual([{ text: "fn main() {}" }]);
  });
  it("no language at all → ONE unstyled segment", () => {
    expect(highlightDiffLine("fn main() {}", undefined, "dark")).toEqual([{ text: "fn main() {}" }]);
  });
  it("unscoped text inside a KNOWN language carries no colour (the row's own foreground owns it)", () => {
    const out = highlightDiffLine("const x = 1;", "typescript", "dark");
    expect(out.find((s) => s.text.includes("x"))!.color).toBeUndefined();
  });
  it("segments reconstruct the line EXACTLY — no dropped characters and no trailing newline", () => {
    // i2p highlights `line + "\n"` because several grammars need the line end to close a construct; that
    // newline must not survive into a diff row, whose width the caller has already budgeted.
    for (const [line, lang] of [["const x = 1;", "typescript"], ['  return "a // b"; // real', "typescript"], ["def f(a):", "python"], ["FROM node:20", "dockerfile"], ["", "typescript"]] as const) {
      expect(highlightDiffLine(line, lang, "dark").map((s) => s.text).join("")).toBe(line);
    }
  });
});

describe("detectLanguage (n2p L419530 + X$p L419856)", () => {
  it("maps the five bare filenames X$p carries", () => {
    expect(detectLanguage("Dockerfile")).toBe("dockerfile");
    expect(detectLanguage("Makefile")).toBe("makefile");
    expect(detectLanguage("Rakefile")).toBe("ruby");
    expect(detectLanguage("Gemfile")).toBe("ruby");
    expect(detectLanguage("CMakeLists.txt")).toBe("cmake");
  });
  it("the filename map is probed on the STEM too, and beats the extension", () => {
    // `Wi(base, ".")` — everything before the first dot. `CMakeLists.txt` would otherwise resolve as
    // plaintext off its `.txt`, which is why upstream probes the map first.
    expect(detectLanguage("/repo/build/Dockerfile.dev")).toBe("dockerfile");
  });
  it("resolves an extension through hljs's alias table to the CANONICAL name", () => {
    expect(detectLanguage("src/tui/render.ts")).toBe("typescript");
    expect(detectLanguage("a/b/c.py")).toBe("python");
    expect(detectLanguage("Foo.RS")).toBe("rust");            // sre L419379 lowercases first
  });
  it("undefined for an extension hljs does not know, and for a bare unmapped filename", () => {
    expect(detectLanguage("notes.zzz")).toBeUndefined();
    expect(detectLanguage("LICENSE")).toBeUndefined();
  });
});

describe("selectPalette", () => {
  it("ansi256 when COLORTERM is unset — jmH's only reachable route in this port", () => {
    expect(selectPalette({ env: {}, theme: "dark" })).toBe("ansi256");
    expect(selectPalette({ env: { COLORTERM: "" }, theme: "light" })).toBe("ansi256");
    expect(selectPalette({ env: { COLORTERM: "256color" }, theme: "dark" })).toBe("ansi256");
  });
  it("dark/light from the active theme once COLORTERM says truecolor", () => {
    expect(selectPalette({ env: { COLORTERM: "truecolor" }, theme: "dark" })).toBe("dark");
    expect(selectPalette({ env: { COLORTERM: "24bit" }, theme: "dark" })).toBe("dark");
    expect(selectPalette({ env: { COLORTERM: "truecolor" }, theme: "light" })).toBe("light");
    expect(selectPalette({ env: { COLORTERM: "24bit" }, theme: "light-daltonized" })).toBe("light");
    expect(selectPalette({ env: { COLORTERM: "truecolor" }, theme: "dark-daltonized" })).toBe("dark");
    expect(selectPalette({ env: { COLORTERM: "TrueColor" }, theme: "dark" })).toBe("dark");
    // `auto` is theme.ts's alias of dark (terminal-background detection is not reachable headlessly).
    expect(selectPalette({ env: { COLORTERM: "truecolor" }, theme: "auto" })).toBe("dark");
  });
});
