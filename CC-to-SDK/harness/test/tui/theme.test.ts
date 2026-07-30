// test/tui/theme.test.ts — theme tokens + the live ACCENT binding (Wave 3 task 4), and client prefs at
// ~/.claude/ccx/prefs.json (NOT Claude Code's own settings.json — settingsFile.test.ts covers that
// different file; see the module comment on prefs.ts). vitest isolates modules per FILE, not per test —
// every test here that calls setTheme() resets it in afterEach so it can never leak into a later test in
// THIS file (a leak across files is not possible: each test file gets a fresh module graph).
import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ACCENT, THEMES, THEME_LABELS, currentTheme, themeTokens, setTheme } from "../../src/tui/theme.js";
import { loadPrefs, savePrefs } from "../../src/tui/prefs.js";
import { toolDiffLines } from "../../src/tui/render.js";

afterEach(() => setTheme("auto"));

describe("theme.ts", () => {
  it("defaults to auto: ACCENT and themeTokens() match THEMES.auto", () => {
    expect(currentTheme()).toBe("auto");
    expect(ACCENT).toBe(THEMES.auto.accent);
    expect(themeTokens()).toEqual(THEMES.auto);
  });

  it("setTheme flips both ACCENT and themeTokens() to the chosen theme", () => {
    setTheme("light");
    expect(currentTheme()).toBe("light");
    expect(ACCENT).toBe(THEMES.light.accent);
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
});

describe("render.ts diff lines read the CURRENT theme's tokens", () => {
  it("auto (default): diff colors are green/red", () => {
    const out = toolDiffLines("Edit", { file_path: "f.ts", old_string: "a", new_string: "b" });
    expect(out).toContainEqual({ text: "  1 - a", color: "red" });
    expect(out).toContainEqual({ text: "  1 + b", color: "green" });
  });
  it("dark-daltonized: diff colors switch to yellow/blue", () => {
    setTheme("dark-daltonized");
    const out = toolDiffLines("Edit", { file_path: "f.ts", old_string: "a", new_string: "b" });
    expect(out).toContainEqual({ text: "  1 - a", color: "yellow" });
    expect(out).toContainEqual({ text: "  1 + b", color: "blue" });
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
    // truthy, and setTheme would do THEMES[id].accent and throw `Cannot read properties of undefined
    // (reading 'accent')` — this is the exact crash the reviewer reproduced, reproduced at the boot site.
    expect(() => { if (prefs.theme) setTheme(prefs.theme); }).not.toThrow();
    expect(currentTheme()).toBe("auto"); // untouched — dropped, not silently coerced to some fallback
  });

  it("loadPrefs still round-trips a valid theme id untouched", () => {
    const root = tmpRoot();
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "prefs.json"), JSON.stringify({ theme: "dark-daltonized" }));
    expect(loadPrefs({ CCX_FLEET_ROOT: root })).toEqual({ theme: "dark-daltonized" });
  });
});
