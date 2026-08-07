// test/unit/diff-highlight.test.ts — EP-R5 Task 9. Pins the THREE upstream scope maps (`K$p`/`Y$p`/`jmH`,
// all on bundle L419855), the bare-filename map (`X$p`, L419856) and the palette selector. Every colour
// asserted below is a VERBATIM transcription of the bundle's own `cd(r,g,b)` / `Z3(n)` call — data, not a
// judgement — so a test that fails here means the port drifted from 2.1.220, never that the value is
// "wrong". Keyless: `selectPalette` is driven entirely through its `env`/`theme` deps, so nothing here
// reads a real terminal or the process theme.
import { describe, it, expect, afterEach, vi } from "vitest";
import { detectLanguage, highlightDiffLine, selectPalette, setHljsLoaderForTest, DIFF_SCOPES, DIFF_FOREGROUND, STORAGE_KEYWORDS, FILENAME_LANGS } from "../../src/tui/diffHighlight.js";

// K$p (Monokai/dark) — the six cells the cases below reach.
const D_KEYWORD = "#f92672", D_STORAGE = "#66d9ef", D_STRING = "#e6db74", D_NUMBER = "#be84ff", D_COMMENT = "#75715e", D_TITLE_FN = "#a6e22e", D_PARAMS = "#fd971f", D_VARIABLE = "#ffffff";
// Y$p (light) — entirely different values, which is the point of it being a second map.
const L_KEYWORD = "#a71d5d", L_STORAGE = "#a71d5d", L_STRING = "#183691", L_NUMBER = "#0086b3", L_COMMENT = "#969896", L_VARIABLE = "#0086b3";
// jmH (256-colour fallback) — palette INDICES, in the theme grammar `ansi256(n)` that `resolveThemeColor`
// already understands, so these survive the `Line` boundary as an SGR index rather than as an RGB triple.
const A_KEYWORD = "ansi256(13)", A_STORAGE = "ansi256(14)", A_STRING = "ansi256(10)", A_NUMBER = "ansi256(12)", A_COMMENT = "ansi256(8)";

const colorOf = (code: string, lang: string | undefined, palette: Parameters<typeof highlightDiffLine>[2], text: string) =>
  highlightDiffLine(code, lang, palette).find((s) => s.text === text)?.color;

// ── The whole table, pinned wholesale ────────────────────────────────────────────────────────────────
// The cases further down reach a cell only if some grammar in the sample set happens to emit its scope —
// which leaves most of the 60 free to rot silently. This fixture is the transcription itself, asserted
// key-for-key against the exported maps, so ANY drift from L419855/L419856 fails here first. It is
// deliberately spelled out rather than generated: a fixture computed from the source under test pins
// nothing.
const DARK_TABLE: Record<string, string> = {
  keyword: "#f92672", _storage: "#66d9ef", built_in: "#a6e22e", type: "#a6e22e", literal: "#be84ff", number: "#be84ff",
  string: "#e6db74", title: "#a6e22e", "title.function": "#a6e22e", "title.class": "#a6e22e", "title.class.inherited": "#a6e22e",
  params: "#fd971f", comment: "#75715e", meta: "#75715e", attr: "#a6e22e", attribute: "#a6e22e", variable: "#ffffff",
  "variable.language": "#ffffff", property: "#ffffff", operator: "#f92672", punctuation: "#f8f8f2", symbol: "#be84ff",
  regexp: "#e6db74", subst: "#f8f8f2",
};
const LIGHT_TABLE: Record<string, string> = {
  keyword: "#a71d5d", _storage: "#a71d5d", built_in: "#0086b3", type: "#0086b3", literal: "#0086b3", number: "#0086b3",
  string: "#183691", title: "#795da3", "title.function": "#795da3", "title.class": "#000000", "title.class.inherited": "#000000",
  params: "#0086b3", comment: "#969896", meta: "#969896", attr: "#0086b3", attribute: "#0086b3", variable: "#0086b3",
  "variable.language": "#0086b3", property: "#0086b3", operator: "#a71d5d", punctuation: "#333333", symbol: "#0086b3",
  regexp: "#183691", subst: "#333333",
};
const ANSI_TABLE: Record<string, string> = {
  keyword: "ansi256(13)", _storage: "ansi256(14)", built_in: "ansi256(14)", type: "ansi256(14)", literal: "ansi256(12)",
  number: "ansi256(12)", string: "ansi256(10)", title: "ansi256(11)", "title.function": "ansi256(11)",
  "title.class": "ansi256(11)", comment: "ansi256(8)", meta: "ansi256(8)",
};

describe("the transcribed table (K$p / Y$p / jmH L419855, GmH L419855, X$p L419856)", () => {
  it("K$p is EXACTLY 24 cells, value-for-value", () => {
    expect(Object.fromEntries(DIFF_SCOPES.dark)).toEqual(DARK_TABLE);
    expect(DIFF_SCOPES.dark.size).toBe(24);
  });
  it("Y$p is EXACTLY 24 cells, value-for-value — same keys as K$p, not one shared value", () => {
    expect(Object.fromEntries(DIFF_SCOPES.light)).toEqual(LIGHT_TABLE);
    expect(DIFF_SCOPES.light.size).toBe(24);
    expect([...DIFF_SCOPES.light.keys()]).toEqual([...DIFF_SCOPES.dark.keys()]);
  });
  it("jmH is EXACTLY 12 cells of palette INDICES — the twelve it omits are upstream's design", () => {
    expect(Object.fromEntries(DIFF_SCOPES.ansi256)).toEqual(ANSI_TABLE);
    expect(DIFF_SCOPES.ansi256.size).toBe(12);
    for (const value of DIFF_SCOPES.ansi256.values()) expect(value).toMatch(/^ansi256\(\d+\)$/);
    // Everything jmH drops relative to K$p falls through to the row foreground, never to an invented cell.
    expect([...DIFF_SCOPES.dark.keys()].filter((k) => !DIFF_SCOPES.ansi256.has(k)))
      .toEqual(["title.class.inherited", "params", "attr", "attribute", "variable", "variable.language", "property", "operator", "punctuation", "symbol", "regexp", "subst"]);
  });
  it("t2p's `foreground` term is pinned on all three palettes (L419493/419497/419502)", () => {
    expect(DIFF_FOREGROUND).toEqual({ dark: "#f8f8f2", light: "#333333", ansi256: "ansi256(7)" });
  });
  it("GmH is EXACTLY these sixteen declaration keywords", () => {
    expect([...STORAGE_KEYWORDS]).toEqual(["const", "let", "var", "function", "class", "type", "interface", "enum", "namespace", "module", "def", "fn", "func", "struct", "trait", "impl"]);
    expect(STORAGE_KEYWORDS.size).toBe(16);
  });
  it("X$p is EXACTLY these five bare filenames", () => {
    expect(Object.fromEntries(FILENAME_LANGS)).toEqual({ Dockerfile: "dockerfile", Makefile: "makefile", Rakefile: "ruby", Gemfile: "ruby", CMakeLists: "cmake" });
    expect(FILENAME_LANGS.size).toBe(5);
  });
});

describe("highlightDiffLine — the three scope maps", () => {
  it("dark: `keyword` is K$p's cd(249,38,114)", () => {
    // `return` is a keyword that is NOT in GmH, so it takes the plain `keyword` cell.
    expect(colorOf("  return 1;", "typescript", "dark", "return")).toBe(D_KEYWORD);
  });
  it("dark: a GmH storage keyword takes `_storage` cd(102,217,239), NOT `keyword` (qmH L419574)", () => {
    // Upstream's one irregular lookup: `keyword` whose TEXT is one of the 16 declaration keywords in `GmH`
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
  it("dark: a scope with its OWN cell is taken directly, dot or no dot", () => {
    expect(colorOf("def f(a):", "python", "dark", "f")).toBe(D_TITLE_FN);   // `title.function` is a real cell
    expect(colorOf("def f(a):", "python", "dark", "a")).toBe(D_PARAMS);
  });
  it("qmH's PREFIX fallback: a dotted scope with no cell of its own takes the cell before the first `.`", () => {
    // Reached only by a scope none of the three maps carries. highlight.js 11.11.1 emits `variable.constant`
    // for a SCREAMING_CASE js binding and `meta.prompt` for a shell prompt — neither is one of `K$p`'s 24, so
    // both exist only to be resolved by `Wi(scope, ".")` down to `variable` / `meta`. Drive them through a
    // real grammar rather than naming the scope, so the arm stays pinned to what hljs actually emits.
    expect(colorOf("const FOO_BAR = 1;", "javascript", "dark", "FOO_BAR")).toBe(D_VARIABLE);   // variable.constant → variable
    expect(colorOf("const FOO_BAR = 1;", "javascript", "light", "FOO_BAR")).toBe(L_VARIABLE);
    expect(colorOf("$ ls", "shell", "dark", "$ ")).toBe(D_COMMENT);                            // meta.prompt → meta
    // …and when the PREFIX has no cell either, the row foreground wins: jmH carries no `variable`.
    expect(colorOf("const FOO_BAR = 1;", "javascript", "ansi256", "FOO_BAR")).toBeUndefined();
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
  it("an unknown language → ONE unstyled segment, and NOT ONE BYTE on the console", () => {
    // The `getLanguage` membership guard is load-bearing for the FRAME, not just the return value:
    // hljs 11.11.1 answers an unregistered language by `console.error`-ing "Could not find the language …"
    // and THEN throwing. The try/catch swallows the throw, so without the guard the segments still come
    // back right — while the log line lands in the middle of a live Ink paint. Nothing but a console spy
    // can see that, which is why it is asserted here rather than left to the shape assertion above.
    const errored = vi.spyOn(console, "error").mockImplementation(() => {});
    const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logged = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(highlightDiffLine("fn main() {}", "definitely-not-a-language", "dark")).toEqual([{ text: "fn main() {}" }]);
      expect(errored).not.toHaveBeenCalled();
      expect(warned).not.toHaveBeenCalled();
      expect(logged).not.toHaveBeenCalled();
    } finally { errored.mockRestore(); warned.mockRestore(); logged.mockRestore(); }
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
  it("resolves the TWELVE `lur` aliases the installed highlight.js cannot (L222493)", () => {
    // `lur` is a superset of highlight.js@11.11.1's own alias table: `getLanguage` answers `undefined` for
    // all twelve, so without the supplemental map a `.php5` diff would paint bare while the SAME name gets
    // a language label on the fenced-code path (F4's `UPSTREAM_LANGS` carries all twelve already).
    expect(detectLanguage("legacy.php5")).toBe("php");
    expect(detectLanguage("dump.mysql")).toBe("sql");
    for (const [file, lang] of [["a.mysql", "sql"], ["a.oracle", "sql"], ["a.freepascal", "delphi"], ["a.lazarus", "delphi"], ["a.lpr", "delphi"], ["a.lfm", "delphi"], ["a.php3", "php"], ["a.php4", "php"], ["a.php5", "php"], ["a.php6", "php"], ["a.php7", "php"], ["a.php8", "php"]] as const) {
      expect(detectLanguage(file)).toBe(lang);
    }
    expect(detectLanguage("A.PHP5")).toBe("php");   // sre L419379 lowercases first, aliases included
  });
});

describe("a missing or corrupt highlight.js DEGRADES — it never throws on the paint path", () => {
  afterEach(() => { setHljsLoaderForTest(); });   // restore the real `require` and drop both memos
  it("detectLanguage answers undefined instead of propagating the load failure", () => {
    // The asymmetry the review caught: both functions go through the same lazy singleton, but only
    // `highlightDiffLine` had a try/catch around it. A diff row is painted by calling BOTH.
    setHljsLoaderForTest(() => { throw new Error("Cannot find module 'highlight.js'"); });
    expect(detectLanguage("src/tui/render.ts")).toBeUndefined();
    expect(detectLanguage("Dockerfile")).toBeUndefined();      // the X$p arm resolves through hljs too
    expect(detectLanguage("legacy.php5")).toBeUndefined();
  });
  it("highlightDiffLine returns the same single unstyled segment it gives an unknown language", () => {
    setHljsLoaderForTest(() => { throw new Error("Cannot find module 'highlight.js'"); });
    expect(highlightDiffLine("const x = 1;", "typescript", "dark")).toEqual([{ text: "const x = 1;" }]);
  });
  it("a corrupt package — one that loads but has no registry — degrades the same way", () => {
    setHljsLoaderForTest(() => ({ getLanguage: () => undefined, listLanguages: () => [] }) as never);
    expect(detectLanguage("src/tui/render.ts")).toBeUndefined();
    expect(highlightDiffLine("const x = 1;", "typescript", "dark")).toEqual([{ text: "const x = 1;" }]);
  });
  it("the failure is memoized — a broken install is not re-required once per diff row", () => {
    let loads = 0;
    setHljsLoaderForTest(() => { loads++; throw new Error("boom"); });
    for (let i = 0; i < 5; i++) highlightDiffLine("const x = 1;", "typescript", "dark");
    expect(loads).toBe(1);
  });
  it("and the real loader comes back after the seam is reset", () => {
    setHljsLoaderForTest(() => { throw new Error("boom"); });
    expect(detectLanguage("a.ts")).toBeUndefined();
    setHljsLoaderForTest();
    expect(detectLanguage("a.ts")).toBe("typescript");
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
