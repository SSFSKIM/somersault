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
// `ansi:<name>`. Ink accepts hex and `ansi256(n)` but not `rgb()` or `ansi:<name>`, so nothing hands a raw
// token to Ink — resolveThemeColor() translates a token into an Ink-safe color and every consumer applies it
// at the moment of use.
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

// ── F4 Task 10c: the eight `*_FOR_SUBAGENTS_ONLY` tokens (pack §9.9, bundle L156475) ───────────────────
// A SEPARATE table rather than eight more names in `THEME_TOKEN_NAMES`, because they are a separate thing:
// the 30 above are semantic ROLES (`error`, `success`, `permission`) and every consumer picks one by
// meaning; these eight are a PALETTE picked by index, and upstream keeps them behind their own shouting
// suffix precisely so nothing reads `red_FOR_SUBAGENTS_ONLY` as "the error colour". Widening `ThemeTokens`
// would put them in reach of `speciesLines`'s `color(name)` helper, which is the mistake the suffix names.
//
// ORDER IS LOAD-BEARING: `Ov` (bundle L188627) is `["red","blue","green","yellow","purple","orange","pink",
// "cyan"]` and `fV` maps each to its token — that array is what `subagentColor(index)` cycles.
//
// Values are the four NON-ANSI blocks of L156475 in file order (1st light, 4th light-daltonized, 5th dark,
// 6th dark-daltonized; the 2nd/3rd are the two ANSI themes this port leaves out of scope, exactly as the 30
// above do). Pack §9.9 tabulates only the first four blocks and labels the 4th "daltonized" — a direct
// bundle read resolves it as LIGHT-daltonized and supplies the two blocks the pack never extracted.
export const SUBAGENT_TOKEN_NAMES = ["red", "blue", "green", "yellow", "purple", "orange", "pink", "cyan"] as const;
export type SubagentTokenName = typeof SUBAGENT_TOKEN_NAMES[number];
export type SubagentTokens = Readonly<Record<SubagentTokenName, ThemeColor>>;
const SUB_DARK: SubagentTokens = {
  red: "rgb(220,38,38)", blue: "rgb(106,155,204)", green: "rgb(22,163,74)", yellow: "rgb(202,138,4)",
  purple: "rgb(130,125,189)", orange: "rgb(217,119,87)", pink: "rgb(196,102,134)", cyan: "rgb(8,145,178)",
};
// The light block is byte-identical to the dark one in 2.1.220 — a faithful capture, not a copy-paste slip:
// these eight are picked for mutual distinguishability rather than for contrast against a background.
const SUB_LIGHT: SubagentTokens = { ...SUB_DARK };
const SUB_DARK_DALTONIZED: SubagentTokens = {
  red: "rgb(255,102,102)", blue: "rgb(102,178,255)", green: "rgb(102,255,102)", yellow: "rgb(255,255,102)",
  purple: "rgb(178,102,255)", orange: "rgb(255,178,102)", pink: "rgb(255,153,204)", cyan: "rgb(102,204,204)",
};
const SUB_LIGHT_DALTONIZED: SubagentTokens = {
  red: "rgb(204,0,0)", blue: "rgb(0,102,204)", green: "rgb(0,204,0)", yellow: "rgb(255,204,0)",
  purple: "rgb(128,0,128)", orange: "rgb(255,128,0)", pink: "rgb(255,102,178)", cyan: "rgb(0,178,178)",
};
export const SUBAGENT_THEMES: Record<ThemeId, SubagentTokens> = {
  auto: SUB_DARK, dark: SUB_DARK, light: SUB_LIGHT, "dark-daltonized": SUB_DARK_DALTONIZED, "light-daltonized": SUB_LIGHT_DALTONIZED,
};
/** The palette for the CURRENT theme — read per render, never captured, exactly like `themeTokens()`. */
export function subagentTokens(): SubagentTokens { return SUBAGENT_THEMES[current]; }
/** One agent's INDEX → an Ink-safe colour, cycling `Ov`'s order. Upstream has no cycling at all (`t4`,
 *  L424866, reads a colour the teammate MESSAGE carries, which comes from the agent definition or a user
 *  override via `Out`, L188606, and defaults to `cyan_FOR_SUBAGENTS_ONLY`) — our SDK stream carries no such
 *  field, so the index is the substitute and `toolRenderer` owns how an agent id becomes one. Negative-safe
 *  so a caller cannot fall off the front of the array. */
export function subagentColor(index: number): string {
  const name = SUBAGENT_TOKEN_NAMES[((Math.trunc(index) % SUBAGENT_TOKEN_NAMES.length) + SUBAGENT_TOKEN_NAMES.length) % SUBAGENT_TOKEN_NAMES.length]!;
  return resolveThemeColor(subagentTokens()[name]);
}

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
/** One token → a color Ink accepts. rgb() becomes hex, `ansi:<name>` becomes the bare Ink color name,
 *  `ansi256(n)` PASSES THROUGH (clamped), hex and anything else pass through — so it is idempotent and safe
 *  to re-apply at the boundary.
 *  `ansi256(n)` used to be flattened to hex here, and that was wrong (Wave R t11, settling t9's open note):
 *  a palette INDEX is not a colour, it is a request for the terminal's own entry n, which is the entire point
 *  of upstream's `Z3`/`z$p` (L419441/L419459 — emitted as a bare `\x1b[38;5;n m`) and of the 256-colour diff
 *  scope map `jmH` that rides on it. Ink resolves the form itself (`ink/build/colorize.js:23` → chalk's
 *  `ansi256`), and MEASURED against this repo's chalk: pass-through emits `\x1b[38;5;13m` at every chalk
 *  level, while the hex route emits `\x1b[38;5;201m` at level 2 — a DIFFERENT palette entry, and level 2 is
 *  exactly the 256-colour terminal `jmH` exists for — and `\x1b[37m` at level 1. Clamping stays because TH2
 *  accepts an out-of-range `ansi256(999)`, which chalk would turn into an invalid SGR. */
export function resolveThemeColor(value: ThemeColor): string { const rgb = rgbMatch(value); if (rgb) return hex(byte(rgb[1]!), byte(rgb[2]!), byte(rgb[3]!)); const ansi256 = ansi256Match(value); if (ansi256) return `ansi256(${byte(ansi256[1]!)})`; return value.startsWith("ansi:") ? value.slice(5) : value; }
/** TH4: upstream's is-light predicate (`lpo(e) { return e.startsWith("light") }`), used for contrast calls. */
export const isLightTheme = (id: ThemeId) => id.startsWith("light");

let current: ThemeId = "auto";
export let ACCENT = resolveThemeColor(THEMES.auto.claude); // Claude brand orange — live binding, see setTheme
let generation = 0;

export function currentTheme(): ThemeId { return current; }
/** Monotonic counter of live-theme MUTATIONS (`setTheme` is the only one — `current`/`ACCENT` are written
 *  nowhere else). Consumers that read the theme per call need nothing from it; it exists for the ones that
 *  CACHE a render — toolRenderer's anchored-stream memo — which otherwise cannot see a repaint, because a
 *  setTheme() touches no document and so bumps no `TranscriptDocument.revision()`. Bumped unconditionally,
 *  including on a redundant re-select of the current id: an extra rebuild is cheap, a stale palette is not. */
export function themeGeneration(): number { return generation; }
/** The full token set for the CURRENT theme. Consumers call this per render/projection rather than caching
 *  it, so a setTheme() mid-session — including the /theme picker's own live-preview navigation — is visible
 *  on the very next paint. */
export function themeTokens(): ThemeTokens { return THEMES[current]; }
/** Mutates ACCENT + the current theme. No persistence here — that's the caller's job: ThemeDialog calls
 *  the injected savePrefs on Enter, and boot applies a saved pref via loadPrefs() before the first render
 *  (see prefs.ts + chatMain.tsx). */
export function setTheme(id: ThemeId): void { current = id; ACCENT = resolveThemeColor(THEMES[id].claude); generation++; }
