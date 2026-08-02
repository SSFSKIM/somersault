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
import { ACCENT, ANSI_COLOR_NAMES, THEMES, THEME_LABELS, THEME_TOKEN_NAMES, currentTheme, isLightTheme, isThemeColor, resolveThemeColor, setTheme, themeTokens } from "../../src/tui/theme.js";
import { loadPrefs, savePrefs } from "../../src/tui/prefs.js";
import { toolDiffLines } from "../../src/tui/render.js";

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
    expect(ANSI_COLOR_NAMES.size).toBe(16); expect(resolveThemeColor("ansi:whiteBright")).toBe("whiteBright"); expect(resolveThemeColor("rgb(1, 2, 3)")).toBe("#010203"); expect(resolveThemeColor("ansi256(196)")).toBe("#ff0000"); expect(resolveThemeColor("#aabbcc")).toBe("#aabbcc");
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
  it("removes bare color words from F1's five named consumers", async () => {
    // Match ANY bare-ANSI string literal, not just one assigned to a `color`-named property. Three of
    // the sixteen bare-colour sites in these files are indirected and would escape an attribute-anchored
    // pattern: ChatStatusBar's `modeColor()` and `ctxColor()` RETURN "red"|"cyan"|"yellow"|"green", and
    // ChatComposer has `const border = mode === "bash" ? "magenta" : mode === "memory" ? "blue" : undefined`.
    // Those are the permission-mode chip and the composer border — two of the roles §2.2 names — so an
    // attribute-anchored guard would go green with the requirement unmet. Safe once migration is complete.
    for (const file of ["render.ts", "highlight.ts", "markdown.ts", "ChatStatusBar.tsx", "ChatComposer.tsx"]) {
      const source = await readFile(new URL(`../../src/tui/${file}`, import.meta.url), "utf8");
      expect(source, file).not.toMatch(/["'](?:red|green|yellow|blue|magenta|cyan|white|black|gray|grey)(?:Bright)?["']/);
    }
  });
});

describe("render.ts diff lines read the CURRENT theme's tokens", () => {
  it("auto (default): diff colors are the dark palette's §2.2 diff pair", () => {
    const out = toolDiffLines("Edit", { file_path: "f.ts", old_string: "a", new_string: "b" });
    expect(out).toContainEqual({ text: "  1 - a", color: resolveThemeColor(themeTokens().diffRemoved) });
    expect(out).toContainEqual({ text: "  1 + b", color: resolveThemeColor(themeTokens().diffAdded) });
  });
  it("dark-daltonized: the diff pair swaps to that palette's own values", () => {
    const before = toolDiffLines("Edit", { file_path: "f.ts", old_string: "a", new_string: "b" });
    setTheme("dark-daltonized");
    const out = toolDiffLines("Edit", { file_path: "f.ts", old_string: "a", new_string: "b" });
    expect(out).toContainEqual({ text: "  1 - a", color: resolveThemeColor(THEMES["dark-daltonized"].diffRemoved) });
    expect(out).toContainEqual({ text: "  1 + b", color: resolveThemeColor(THEMES["dark-daltonized"].diffAdded) });
    expect(out.find((l) => l.text === "  1 + b")!.color).not.toBe(before.find((l) => l.text === "  1 + b")!.color);
    expect(out.find((l) => l.text === "  1 - a")!.color).not.toBe(before.find((l) => l.text === "  1 - a")!.color);
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

  it("loadPrefs still round-trips a valid theme id untouched", () => {
    const root = tmpRoot();
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "prefs.json"), JSON.stringify({ theme: "dark-daltonized" }));
    expect(loadPrefs({ CCX_FLEET_ROOT: root })).toEqual({ theme: "dark-daltonized" });
  });
});
