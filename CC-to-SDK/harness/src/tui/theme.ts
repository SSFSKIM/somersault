// tui/src/theme.ts — the semantic theme contract (F1 Task 2): 30 tokens × 5 themes. Every cell below is
// copied VERBATIM from the installed-2.1.220 capture in `docs/superpowers/research/2026-07-31-tui-clone/
// 06-keys-themes.md` §2.2 (72 tokens × 6 themes; we select 30 and the 4 non-ANSI themes). Some cells read
// wrong for their own name — `background` is a teal, `remember` is not a hue anyone would guess — because
// they are faithful captures of the shipping product, NOT judgement calls. Do not "correct" one: fidelity
// to the installed product is the goal, and a role-plausible substitute is exactly the failure this table
// exists to prevent. `auto` is an exact alias of `dark` (terminal-background detection isn't reachable
// headlessly — recorded divergence); the two ANSI-only themes stay out of scope.
//
// Token VALUES use upstream's own color grammar (TH2): `rgb(r,g,b)` / `#rgb` / `#rrggbb` / `ansi256(n)` /
// `ansi:<name>`. Ink does not accept the last two, so nothing hands a raw token to Ink — resolveThemeColor()
// translates a token into an Ink-safe color and every consumer applies it at the moment of use.
// `Transcript.Line` re-applies it as the final safety boundary for preformatted RenderLine producers
// (the resolver is idempotent on hex/plain names, so double application is safe).
//
// Fixed role mapping used by the consumers: syntax/inline code `suggestion` · literal strings `success` ·
// numbers `warning` · comments and unknown code `inactive` · bash composer `bashBorder` · memory composer
// `remember` · status default `success` · status auto/permission `permission` · warnings `warning` ·
// failures `error` · hierarchy `text`/`subtle`/`inactive` · pending tool + spinner `inactive`.
//
// ACCENT stays a live ESM binding (`export let`, mutated by setTheme) so its 24 importers keep reading the
// current accent with zero refactor; it is a resolved compatibility alias of themeTokens().claude.
// No deps (leaf module) → safe to import anywhere.
export type ThemeId = "auto" | "dark" | "light" | "dark-daltonized" | "light-daltonized";

export const THEME_TOKEN_NAMES = [
  "claude", "text", "inverseText", "inactive", "subtle", "success", "error", "warning", "permission", "suggestion", "remember",
  "autoAccept", "skill", "bashBorder", "promptBorder", "planMode", "background", "selectionBg", "userMessageBackground", "composerSidebarBackground",
  "bashMessageBackgroundColor", "memoryBackgroundColor", "rate_limit_fill", "rate_limit_empty",
  "diffAdded", "diffRemoved", "diffAddedDimmed", "diffRemovedDimmed", "diffAddedWord", "diffRemovedWord",
] as const;
export type ThemeTokenName = typeof THEME_TOKEN_NAMES[number];
/** A token value in TH2's grammar — validate with isThemeColor, hand to Ink only via resolveThemeColor. */
export type ThemeColor = string;
export type ThemeTokens = Readonly<Record<ThemeTokenName, ThemeColor>>;

const DARK: ThemeTokens = {
  claude: "rgb(215,119,87)", text: "rgb(255,255,255)", inverseText: "rgb(0,0,0)", inactive: "rgb(153,153,153)", subtle: "rgb(80,80,80)",
  success: "rgb(78,186,101)", error: "rgb(255,107,128)", warning: "rgb(255,193,7)", permission: "rgb(177,185,249)", suggestion: "rgb(177,185,249)", remember: "rgb(177,185,249)",
  autoAccept: "rgb(175,135,255)", skill: "rgb(175,135,255)", bashBorder: "rgb(253,93,177)", promptBorder: "rgb(136,136,136)", planMode: "rgb(72,150,140)",
  background: "rgb(0,204,204)", selectionBg: "rgb(38, 79, 120)", userMessageBackground: "rgb(55, 55, 55)", composerSidebarBackground: "rgb(38, 38, 38)",
  bashMessageBackgroundColor: "rgb(65, 60, 65)", memoryBackgroundColor: "rgb(55, 65, 70)", rate_limit_fill: "rgb(177,185,249)", rate_limit_empty: "rgb(80,83,112)",
  diffAdded: "rgb(34,92,43)", diffRemoved: "rgb(122,41,54)", diffAddedDimmed: "rgb(71,88,74)", diffRemovedDimmed: "rgb(105,72,77)", diffAddedWord: "rgb(56,166,96)", diffRemovedWord: "rgb(179,89,107)",
};
const LIGHT: ThemeTokens = {
  claude: "rgb(215,119,87)", text: "rgb(0,0,0)", inverseText: "rgb(255,255,255)", inactive: "rgb(102,102,102)", subtle: "rgb(175,175,175)",
  success: "rgb(44,122,57)", error: "rgb(171,43,63)", warning: "rgb(150,108,30)", permission: "rgb(87,105,247)", suggestion: "rgb(87,105,247)", remember: "rgb(0,0,255)",
  autoAccept: "rgb(135,0,255)", skill: "rgb(135,0,255)", bashBorder: "rgb(255,0,135)", promptBorder: "rgb(153,153,153)", planMode: "rgb(0,102,102)",
  background: "rgb(0,153,153)", selectionBg: "rgb(180, 213, 255)", userMessageBackground: "rgb(240, 240, 240)", composerSidebarBackground: "rgb(245, 245, 245)",
  bashMessageBackgroundColor: "rgb(250, 245, 250)", memoryBackgroundColor: "rgb(230, 245, 250)", rate_limit_fill: "rgb(87,105,247)", rate_limit_empty: "rgb(39,47,111)",
  diffAdded: "rgb(105,219,124)", diffRemoved: "rgb(255,168,180)", diffAddedDimmed: "rgb(199,225,203)", diffRemovedDimmed: "rgb(253,210,216)", diffAddedWord: "rgb(47,157,68)", diffRemovedWord: "rgb(209,69,75)",
};
const DARK_DALTONIZED: ThemeTokens = {
  claude: "rgb(255,153,51)", text: "rgb(255,255,255)", inverseText: "rgb(0,0,0)", inactive: "rgb(153,153,153)", subtle: "rgb(80,80,80)",
  success: "rgb(51,153,255)", error: "rgb(255,102,102)", warning: "rgb(255,204,0)", permission: "rgb(153,204,255)", suggestion: "rgb(153,204,255)", remember: "rgb(153,204,255)",
  autoAccept: "rgb(175,135,255)", skill: "rgb(175,135,255)", bashBorder: "rgb(51,153,255)", promptBorder: "rgb(136,136,136)", planMode: "rgb(102,153,153)",
  background: "rgb(0,204,204)", selectionBg: "rgb(38, 79, 120)", userMessageBackground: "rgb(55, 55, 55)", composerSidebarBackground: "rgb(38, 38, 38)",
  bashMessageBackgroundColor: "rgb(65, 60, 65)", memoryBackgroundColor: "rgb(55, 65, 70)", rate_limit_fill: "rgb(153,204,255)", rate_limit_empty: "rgb(69,92,115)",
  diffAdded: "rgb(0,68,102)", diffRemoved: "rgb(102,0,0)", diffAddedDimmed: "rgb(62,81,91)", diffRemovedDimmed: "rgb(62,44,44)", diffAddedWord: "rgb(0,119,179)", diffRemovedWord: "rgb(179,0,0)",
};
const LIGHT_DALTONIZED: ThemeTokens = {
  claude: "rgb(255,153,51)", text: "rgb(0,0,0)", inverseText: "rgb(255,255,255)", inactive: "rgb(102,102,102)", subtle: "rgb(175,175,175)",
  success: "rgb(0,102,153)", error: "rgb(204,0,0)", warning: "rgb(255,153,0)", permission: "rgb(51,102,255)", suggestion: "rgb(51,102,255)", remember: "rgb(51,102,255)",
  autoAccept: "rgb(135,0,255)", skill: "rgb(135,0,255)", bashBorder: "rgb(0,102,204)", promptBorder: "rgb(153,153,153)", planMode: "rgb(51,102,102)",
  background: "rgb(0,153,153)", selectionBg: "rgb(180, 213, 255)", userMessageBackground: "rgb(220, 220, 220)", composerSidebarBackground: "rgb(235, 235, 235)",
  bashMessageBackgroundColor: "rgb(250, 245, 250)", memoryBackgroundColor: "rgb(230, 245, 250)", rate_limit_fill: "rgb(51,102,255)", rate_limit_empty: "rgb(23,46,114)",
  diffAdded: "rgb(153,204,255)", diffRemoved: "rgb(255,204,204)", diffAddedDimmed: "rgb(209,231,253)", diffRemovedDimmed: "rgb(255,233,233)", diffAddedWord: "rgb(51,102,204)", diffRemovedWord: "rgb(153,51,51)",
};

export const THEMES: Record<ThemeId, ThemeTokens> = { auto: DARK, dark: DARK, light: LIGHT, "dark-daltonized": DARK_DALTONIZED, "light-daltonized": LIGHT_DALTONIZED };

// CC 2.1.220's /theme picker row order + labels, verbatim (plan Global Constraints line 32).
export const THEME_LABELS: [ThemeId, string][] = [
  ["auto", "Auto (match terminal)"], ["dark", "Dark mode"], ["light", "Light mode"],
  ["dark-daltonized", "Dark mode (colorblind-friendly)"], ["light-daltonized", "Light mode (colorblind-friendly)"],
];

// TH2: upstream's own color validator, cloned including its quirks. `decimal` is SYNTAX-bound, not
// range-bound — "rgb(999,999,999)" and "ansi256(999)" are ACCEPTED by 2.1.220 and must stay accepted here;
// resolveThemeColor is what clamps them at use time. Four accepted forms, no others.
export const ANSI_COLOR_NAMES = new Set(["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white", "blackBright", "redBright", "greenBright", "yellowBright", "blueBright", "magentaBright", "cyanBright", "whiteBright"]);
const decimal = (value: string) => /^\d{1,3}$/.test(value);
const rgbMatch = (value: string) => /^rgb\(\s?(\d{1,3}),\s?(\d{1,3}),\s?(\d{1,3})\s?\)$/.exec(value);
const ansi256Match = (value: string) => /^ansi256\((\d{1,3})\)$/.exec(value);
export function isThemeColor(value: unknown): value is ThemeColor {
  if (typeof value !== "string") return false;
  const rgb = rgbMatch(value); if (rgb) return decimal(rgb[1]!) && decimal(rgb[2]!) && decimal(rgb[3]!);
  if (/^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/.test(value)) return true;
  const ansi256 = ansi256Match(value); if (ansi256) return decimal(ansi256[1]!);
  return value.startsWith("ansi:") && ANSI_COLOR_NAMES.has(value.slice(5));
}
const byte = (value: string) => Math.min(255, Number(value));
const hex = (red: number, green: number, blue: number) => `#${red.toString(16).padStart(2, "0")}${green.toString(16).padStart(2, "0")}${blue.toString(16).padStart(2, "0")}`;
const ANSI256_BASE = [[0, 0, 0], [128, 0, 0], [0, 128, 0], [128, 128, 0], [0, 0, 128], [128, 0, 128], [0, 128, 128], [192, 192, 192], [128, 128, 128], [255, 0, 0], [0, 255, 0], [255, 255, 0], [0, 0, 255], [255, 0, 255], [0, 255, 255], [255, 255, 255]] as const;
function ansi256Hex(value: string): string { const index = byte(value); if (index < 16) { const base = ANSI256_BASE[index]!; return hex(base[0], base[1], base[2]); } if (index < 232) { const n = index - 16, levels = [0, 95, 135, 175, 215, 255]; return hex(levels[Math.floor(n / 36)]!, levels[Math.floor(n / 6) % 6]!, levels[n % 6]!); } const gray = 8 + (index - 232) * 10; return hex(gray, gray, gray); }
/** One token → a color Ink accepts. rgb()/ansi256() become hex, `ansi:<name>` becomes the bare Ink color
 *  name, hex and anything else pass through — so it is idempotent and safe to re-apply at the boundary. */
export function resolveThemeColor(value: ThemeColor): string { const rgb = rgbMatch(value); if (rgb) return hex(byte(rgb[1]!), byte(rgb[2]!), byte(rgb[3]!)); const ansi256 = ansi256Match(value); if (ansi256) return ansi256Hex(ansi256[1]!); return value.startsWith("ansi:") ? value.slice(5) : value; }
/** TH4: upstream's is-light predicate (`lpo(e) { return e.startsWith("light") }`), used for contrast calls. */
export const isLightTheme = (id: ThemeId) => id.startsWith("light");

let current: ThemeId = "auto";
export let ACCENT = resolveThemeColor(THEMES.auto.claude); // Claude brand orange — live binding, see setTheme

export function currentTheme(): ThemeId { return current; }
/** The full token set for the CURRENT theme. Consumers call this per render/projection rather than caching
 *  it, so a setTheme() mid-session — including the /theme picker's own live-preview navigation — is visible
 *  on the very next paint. */
export function themeTokens(): ThemeTokens { return THEMES[current]; }
/** Mutates ACCENT + the current theme. No persistence here — that's the caller's job: ThemeDialog calls
 *  the injected savePrefs on Enter, and boot applies a saved pref via loadPrefs() before the first render
 *  (see prefs.ts + chatMain.tsx). */
export function setTheme(id: ThemeId): void { current = id; ACCENT = resolveThemeColor(THEMES[id].claude); }
