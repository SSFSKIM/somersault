// tui/src/theme.ts — shared terminal palette + theme system (Wave 3 task 4). ThemeTokens carries the full
// per-theme palette (accent + diff colors); ACCENT stays a live ESM binding (`export let`, mutated by
// setTheme) so the 39 existing importers keep reading the current accent with zero refactor — only NEW
// callers (render.ts's diff lines, ThemeDialog's own styling) read the fuller themeTokens(). No deps (leaf
// module) → safe to import anywhere.
export type ThemeId = "auto" | "dark" | "light" | "dark-daltonized" | "light-daltonized";
export interface ThemeTokens { accent: string; diffAdd: string; diffRemove: string }

export const THEMES: Record<ThemeId, ThemeTokens> = {
  auto:               { accent: "#d97757", diffAdd: "green", diffRemove: "red" },
  dark:               { accent: "#d97757", diffAdd: "green", diffRemove: "red" },
  light:              { accent: "#b0522e", diffAdd: "green", diffRemove: "red" },
  "dark-daltonized":  { accent: "#d97757", diffAdd: "blue",  diffRemove: "yellow" },
  "light-daltonized": { accent: "#b0522e", diffAdd: "blue",  diffRemove: "yellow" },
};

// CC 2.1.220's /theme picker row order + labels, verbatim (plan Global Constraints line 32). `auto`
// currently equals `dark` — terminal-background detection isn't available headlessly (recorded divergence,
// Task 8 writes it to tui-ux.md).
export const THEME_LABELS: [ThemeId, string][] = [
  ["auto", "Auto (match terminal)"], ["dark", "Dark mode"], ["light", "Light mode"],
  ["dark-daltonized", "Dark mode (colorblind-friendly)"], ["light-daltonized", "Light mode (colorblind-friendly)"],
];

let current: ThemeId = "auto";
export let ACCENT = THEMES[current].accent; // Claude brand orange (CC "claude" theme color) — live binding, see setTheme

export function currentTheme(): ThemeId { return current; }
/** The full token set for the CURRENT theme. render.ts's diff colors and ThemeDialog's own styling call
 *  this per-render rather than caching it, so a setTheme() mid-session — including the picker's own
 *  live-preview navigation — is visible on the very next paint. */
export function themeTokens(): ThemeTokens { return THEMES[current]; }
/** Mutates ACCENT + the current theme. No persistence here — that's the caller's job: ThemeDialog calls
 *  the injected savePrefs on Enter, and boot applies a saved pref via loadPrefs() before the first render
 *  (see prefs.ts + chatMain.tsx). */
export function setTheme(id: ThemeId): void { current = id; ACCENT = THEMES[id].accent; }
