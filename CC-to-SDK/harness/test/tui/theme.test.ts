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
});
