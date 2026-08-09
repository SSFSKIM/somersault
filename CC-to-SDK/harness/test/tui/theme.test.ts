// test/tui/theme.test.ts — theme tokens + the live ACCENT binding (Wave 3 task 4), and client prefs at
// ~/.claude/ccx/prefs.json (NOT Claude Code's own settings.json — settingsFile.test.ts covers that
// different file; see the module comment on prefs.ts). vitest isolates modules per FILE, not per test —
// every test here that calls setTheme() resets it in afterEach so it can never leak into a later test in
// THIS file (a leak across files is not possible: each test file gets a fresh module graph).
import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ACCENT, ANSI_COLOR_NAMES, THEMES, THEME_LABELS, THEME_TOKEN_NAMES, currentTheme, isLightTheme, isThemeColor, resolveThemeColor, setTheme, themeGeneration, themeTokens } from "../../src/tui/theme.js";
import { loadPrefs, savePrefs } from "../../src/tui/prefs.js";
import { resolveModelAlias } from "../../src/config/models.js";
import { renderDiff } from "../../src/tui/diffRender.js";
import type { ResolvedPatch } from "../../src/tui/diffSource.js";

afterEach(() => setTheme("auto"));

describe("theme.ts", () => {
  it("defaults to auto: ACCENT and themeTokens() match THEMES.auto", () => {
    expect(currentTheme()).toBe("auto");
    expect(ACCENT).toBe(resolveThemeColor(THEMES.auto.claude));
    expect(themeTokens()).toEqual(THEMES.auto);
  });

  it("setTheme flips both ACCENT and themeTokens() to the chosen theme", () => {
    setTheme("light");
    expect(currentTheme()).toBe("light");
    expect(ACCENT).toBe(resolveThemeColor(THEMES.light.claude));
    expect(themeTokens()).toEqual(THEMES.light);
  });

  it("every THEME_LABELS id has a THEMES entry, in the verbatim 2.1.220 row order", () => {
    expect(THEME_LABELS).toEqual([
      ["auto", "Auto (match terminal)"],
      ["dark", "Dark mode"],
      ["light", "Light mode"],
      ["dark-daltonized", "Dark mode (colorblind-friendly)"],
      ["light-daltonized", "Light mode (colorblind-friendly)"],
    ]);
    for (const [id] of THEME_LABELS) expect(THEMES[id]).toBeDefined();
  });

  it("clones TH2's regex grammar and resolves every accepted non-hex form for Ink", () => {
    for (const value of ["rgb(0, 1, 255)", "rgb(256,0,0)", "rgb(999,999,999)", "#abc", "#A1b2C3", "ansi256(0)", "ansi256(256)", "ansi256(999)", "ansi:red", "ansi:whiteBright"]) expect(isThemeColor(value)).toBe(true);
    for (const value of ["rgb(1000,0,0)", "rgb(-1,0,0)", "rgb(1,2)", "#abcd", "ansi256(1000)", "ansi:orange", "red"]) expect(isThemeColor(value)).toBe(false);
    expect(ANSI_COLOR_NAMES.size).toBe(16); expect(resolveThemeColor("ansi:whiteBright")).toBe("whiteBright"); expect(resolveThemeColor("rgb(1, 2, 3)")).toBe("#010203"); expect(resolveThemeColor("ansi256(196)")).toBe("ansi256(196)"); expect(resolveThemeColor("#aabbcc")).toBe("#aabbcc");
  });
  // REPLACES "resolves the ansi256 base-16 table and grayscale ramp" (Wave R t11). That test pinned a
  // flattening to hex that was a defect: `ansi256(n)` asks for the TERMINAL's palette entry n, Ink accepts
  // the form natively (`ink/build/colorize.js:23` → chalk's `ansi256`), and the hex route re-quantises — on a
  // 256-colour terminal, which is precisely where the diff renderer's `jmH` map is selected, chalk turns
  // `#ff00ff` (index 13's RGB) into index 201. Pass-through emits `\x1b[38;5;13m`, which is upstream's own
  // `z$p` (L419459) output. The clamp survives because TH2 accepts out-of-range indices that chalk does not.
  it("passes ansi256 indices THROUGH rather than flattening them to hex, clamping an out-of-range one", () => {
    for (const index of [0, 9, 15, 196, 232, 255]) expect(resolveThemeColor(`ansi256(${index})`)).toBe(`ansi256(${index})`);
    expect(resolveThemeColor("ansi256(999)")).toBe("ansi256(255)");
    expect(resolveThemeColor(resolveThemeColor("ansi256(13)"))).toBe("ansi256(13)");   // still idempotent at the Line boundary
  });
  // Consumers that CACHE a render read per-call theme values (toolRenderer's anchored-stream memo) need a
  // cheap "did the theme move" signal, since a setTheme() touches no document and bumps no revision.
  it("bumps a monotonic themeGeneration on every setTheme, including a redundant one", () => {
    const start = themeGeneration();
    setTheme("light"); const afterLight = themeGeneration();
    expect(afterLight).toBeGreaterThan(start);
    setTheme("light");                                   // redundant re-select (the /theme picker re-fires per keypress)
    expect(themeGeneration()).toBeGreaterThan(afterLight);
    expect(themeGeneration()).toBe(themeGeneration());   // a pure read never advances it
  });
  it("uses the TH4 light prefix predicate", () => { expect(isLightTheme("light")).toBe(true); expect(isLightTheme("light-daltonized")).toBe(true); expect(isLightTheme("dark")).toBe(false); expect(isLightTheme("auto")).toBe(false); });
  it("makes every existing palette structurally complete with TH7", () => {
    for (const palette of Object.values(THEMES)) { expect(Object.keys(palette).sort()).toEqual([...THEME_TOKEN_NAMES].sort()); for (const value of Object.values(palette)) expect(isThemeColor(value)).toBe(true); }
  });
  it("copies §2.2's selected upstream cells verbatim instead of merely using valid colors", () => {
    expect(THEMES.dark).toMatchObject({ claude: "rgb(215,119,87)", text: "rgb(255,255,255)", success: "rgb(78,186,101)", error: "rgb(255,107,128)", background: "rgb(0,204,204)", diffAdded: "rgb(34,92,43)", diffRemoved: "rgb(122,41,54)" });
    expect(THEMES.light).toMatchObject({ claude: "rgb(215,119,87)", text: "rgb(0,0,0)", success: "rgb(44,122,57)", error: "rgb(171,43,63)", background: "rgb(0,153,153)", diffAdded: "rgb(105,219,124)", diffRemoved: "rgb(255,168,180)" });
    expect(THEMES["dark-daltonized"]).toMatchObject({ claude: "rgb(255,153,51)", text: "rgb(255,255,255)", success: "rgb(51,153,255)", error: "rgb(255,102,102)", background: "rgb(0,204,204)", diffAdded: "rgb(0,68,102)", diffRemoved: "rgb(102,0,0)" });
    expect(THEMES["light-daltonized"]).toMatchObject({ claude: "rgb(255,153,51)", text: "rgb(0,0,0)", success: "rgb(0,102,153)", error: "rgb(204,0,0)", background: "rgb(0,153,153)", diffAdded: "rgb(153,204,255)", diffRemoved: "rgb(255,204,204)" });
    expect(THEMES.auto).toEqual(THEMES.dark);
  });
  it("removes bare color words from F1's four named consumers", async () => {
    // Match ANY bare-ANSI string literal, not just one assigned to a `color`-named property. Three of
    // the sixteen bare-colour sites in these files are indirected and would escape an attribute-anchored
    // pattern: the mode chip's `modeColor()` RETURNED "red"|"cyan"|"yellow"|"green" (it lived in
    // ChatStatusBar.tsx until Wave C Task 2 retired that file; `modeTable.ts` owns it now), and
    // ChatComposer has `const border = mode === "bash" ? "magenta" : mode === "memory" ? "blue" : undefined`.
    // Those are the permission-mode chip and the composer border — two of the roles §2.2 names — so an
    // attribute-anchored guard would go green with the requirement unmet. Safe once migration is complete.
    for (const file of ["render.ts", "markdown.ts", "Footer.tsx", "modeTable.ts", "ChatComposer.tsx"]) {
      const source = await readFile(new URL(`../../src/tui/${file}`, import.meta.url), "utf8");
      expect(source, file).not.toMatch(/["'](?:red|green|yellow|blue|magenta|cyan|white|black|gray|grey)(?:Bright)?["']/);
    }
  });
  it("highlight.ts names EXACTLY the three DhH scope colors, and no other bare color", () => {
    // F4 Task 3 made highlight.ts a deliberate, single exception to the rule above: upstream's hljs scope
    // map `DhH` (constants pack §1.10, bundle L420495) is built from CHALK CONSTANTS — `keyword: vt.blue`,
    // `string: vt.red`, `number: vt.green`, `comment: vt.green` — so fenced-code colours are theme-
    // INDEPENDENT upstream and we adopt them verbatim (recorded divergence: no /theme repaint for fenced
    // code, and red/green survive under the daltonized themes). The guard is NARROWED, not dropped: any
    // bare colour word beyond those three literals still fails here.
    return readFile(new URL("../../src/tui/highlight.ts", import.meta.url), "utf8").then((source) => {
      const bare = source.match(/["'](?:red|green|yellow|blue|magenta|cyan|white|black|gray|grey)(?:Bright)?["']/g) ?? [];
      expect(new Set(bare)).toEqual(new Set(['"blue"', '"red"', '"green"']));
    });
  });
});

// F1 Task 2's live-theme-repaint proof, RE-POINTED (not dropped) by F4 Task 7: it used to drive
// `render.toolDiffLines`, which Task 7 retired. `diffRender.renderDiff` is the diff renderer now, and it must
// keep the same property — theme tokens read PER CALL, so a setTheme() (including the /theme picker's live
// preview navigation) colors the very next frame with no cache to invalidate. The bands moved from `color` to
// `bg` with Task 1's substrate, which is the only thing that changed about the assertion.
describe("diffRender bands read the CURRENT theme's tokens", () => {
  const patch: ResolvedPatch = { hunks: [{ oldStart: 1, rows: [{ kind: "remove", text: "aaaa" }, { kind: "add", text: "bbbb" }] }], numbering: "absolute", added: 1, removed: 1 };
  const bands = () => renderDiff(patch, 20).map((line) => line.segments![0]!.bg);
  it("auto (default): diff bands are the dark palette's §2.2 diff pair", () => {
    expect(bands()).toEqual([resolveThemeColor(themeTokens().diffRemoved), resolveThemeColor(themeTokens().diffAdded)]);
  });
  it("dark-daltonized: the diff pair swaps to that palette's own values on the very next call", () => {
    const before = bands();
    setTheme("dark-daltonized");
    const after = bands();
    expect(after).toEqual([resolveThemeColor(THEMES["dark-daltonized"].diffRemoved), resolveThemeColor(THEMES["dark-daltonized"].diffAdded)]);
    expect(after[0]).not.toBe(before[0]);
    expect(after[1]).not.toBe(before[1]);
  });
});

describe("prefs.ts", () => {
  const tmpRoot = () => mkdtempSync(join(tmpdir(), "ccx-prefs-"));

  it("loadPrefs tolerates an absent file → {}", () => {
    const root = join(tmpRoot(), "not-there-yet");   // never created
    expect(loadPrefs({ CCX_FLEET_ROOT: root })).toEqual({});
  });

  it("loadPrefs tolerates a corrupt file → {}", () => {
    const root = tmpRoot();
    writeFileSync(join(root, "prefs.json"), "{not json");
    expect(loadPrefs({ CCX_FLEET_ROOT: root })).toEqual({});
  });

  it("savePrefs mkdir -p's a not-yet-existing root and read-merge-writes across two calls", () => {
    const root = join(tmpRoot(), "nested", "ccx");   // doesn't exist yet
    expect(existsSync(root)).toBe(false);
    savePrefs({ theme: "dark" }, { CCX_FLEET_ROOT: root });
    expect(existsSync(root)).toBe(true);
    expect(loadPrefs({ CCX_FLEET_ROOT: root })).toEqual({ theme: "dark" });
    savePrefs({ outputStyle: "Explanatory" }, { CCX_FLEET_ROOT: root });   // a DIFFERENT key must not drop the first
    expect(loadPrefs({ CCX_FLEET_ROOT: root })).toEqual({ theme: "dark", outputStyle: "Explanatory" });
  });

  it("savePrefs preserves unknown keys already in the file (forward-compat with a future field)", () => {
    const root = tmpRoot();
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "prefs.json"), JSON.stringify({ theme: "light", futureField: 42 }));
    savePrefs({ outputStyle: "Learning" }, { CCX_FLEET_ROOT: root });
    const raw = JSON.parse(readFileSync(join(root, "prefs.json"), "utf8"));
    expect(raw).toEqual({ theme: "light", futureField: 42, outputStyle: "Learning" });
  });

  // Review finding (Task 4, Important): a hand-edited or drifted-forward `theme` id must not reach
  // setTheme() unchecked — THEMES[id] there throws on a miss, which would crash boot (chatMain.tsx calls
  // setTheme(prefs.theme) before the first render). loadPrefs is the one tolerant-loader choke point every
  // caller goes through, so the drop belongs here, not at each call site.
  it("loadPrefs drops an unrecognized theme id, so chatMain's boot guard skips setTheme() instead of crashing", () => {
    const root = tmpRoot();
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "prefs.json"), JSON.stringify({ theme: "purple-not-a-real-theme" }));
    const prefs = loadPrefs({ CCX_FLEET_ROOT: root });
    expect(prefs.theme).toBeUndefined();
    // Mirrors chatMain.tsx's boot line verbatim: `if (prefs.theme) setTheme(prefs.theme)`. An
    // un-validated loader would leave "purple-not-a-real-theme" on prefs.theme, the guard would be
    // truthy, and setTheme would do THEMES[id].claude and throw `Cannot read properties of undefined
    // (reading 'claude')` — this is the exact crash the reviewer reproduced, reproduced at the boot site.
    expect(() => { if (prefs.theme) setTheme(prefs.theme); }).not.toThrow();
    expect(currentTheme()).toBe("auto"); // untouched — dropped, not silently coerced to some fallback
  });

  // Controller follow-up to the same finding: the first guard used `in`, which walks the prototype
  // chain — "constructor"/"toString" would have passed it, and setTheme would then read `.claude` off
  // an Object.prototype member: no throw, but ACCENT and every token become undefined (colorless UI).
  it("loadPrefs drops a prototype-chain name like \"constructor\", not just an unknown word", () => {
    const root = tmpRoot();
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "prefs.json"), JSON.stringify({ theme: "constructor" }));
    const prefs = loadPrefs({ CCX_FLEET_ROOT: root });
    expect(prefs.theme).toBeUndefined();
    expect(() => { if (prefs.theme) setTheme(prefs.theme); }).not.toThrow();
    expect(themeTokens().claude).toBe(THEMES.auto.claude);  // still a REAL token, not undefined
  });

  // Same finding one field over (codex review, F6 close): cli/main.ts hands `prefs.model` straight into the
  // host config, and resolveModelAlias calls `.trim()` on it — so a hand-edited non-string `model` crashed a
  // foreground launch, which is exactly the tolerant-file contract this loader exists to keep.
  it("loadPrefs drops a non-string model, so a hand-edited prefs file cannot crash foreground startup", () => {
    const root = tmpRoot();
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "prefs.json"), JSON.stringify({ theme: "dark", model: 5 }));
    const prefs = loadPrefs({ CCX_FLEET_ROOT: root });
    expect(prefs.model).toBeUndefined();
    expect(prefs.theme).toBe("dark");                       // …and the rest of the file survives
    // Mirrors cli/main.ts verbatim: `inv.config.model ?? deps.loadPrefs().model` → resolveModelAlias.
    expect(() => resolveModelAlias(prefs.model)).not.toThrow();

    writeFileSync(join(root, "prefs.json"), JSON.stringify({ model: { name: "opus" } }));
    expect(loadPrefs({ CCX_FLEET_ROOT: root }).model).toBeUndefined();
    writeFileSync(join(root, "prefs.json"), JSON.stringify({ model: "   " }));
    expect(loadPrefs({ CCX_FLEET_ROOT: root }).model).toBeUndefined();      // blank is no preference at all
  });

  it("loadPrefs round-trips a real model id untouched", () => {
    const root = tmpRoot();
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "prefs.json"), JSON.stringify({ model: "opus" }));
    expect(loadPrefs({ CCX_FLEET_ROOT: root })).toEqual({ model: "opus" });
  });

  it("loadPrefs still round-trips a valid theme id untouched", () => {
    const root = tmpRoot();
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "prefs.json"), JSON.stringify({ theme: "dark-daltonized" }));
    expect(loadPrefs({ CCX_FLEET_ROOT: root })).toEqual({ theme: "dark-daltonized" });
  });
});
