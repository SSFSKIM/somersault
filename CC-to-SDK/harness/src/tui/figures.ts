// tui/src/figures.ts — canon's unicode-vs-ASCII figure predicate (`EJi`, L104958-104962) and the ONE tick
// glyph derived from it (`Ge.tick`, L104968). Canon keeps this in its own figures table, not the theme
// table (a terminal glyph is not a color token) and not `Select`'s own module (three unrelated surfaces —
// `Select`'s list rows, `banner.ts`'s startup checklist, `TaskPanel.tsx`'s completed rows — all draw this
// same glyph and must never disagree on it, so it lives in a leaf module all three already can reach
// without a select-primitive or theme-table dependency). `env`/`platform` are parameters, not bare global
// reads, for the same testability reason every other terminal-capability reader in this package takes one.
export function unicodeSupported(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): boolean {
  return platform !== "win32"
    ? env.TERM !== "linux"
    : Boolean(env.WT_SESSION) || Boolean(env.TERMINUS_SUBLIME) || env.ConEmuTask === "{cmd::Cmder}"
      || env.TERM_PROGRAM === "Terminus-Sublime" || env.TERM_PROGRAM === "vscode"
      || ["xterm-256color", "alacritty", "rxvt-unicode", "rxvt-unicode-256color"].includes(env.TERM ?? "")
      || env.TERMINAL_EMULATOR === "JetBrains-JediTerm";
}

/** `Ge.tick`. */
export const TICK = (env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string =>
  (unicodeSupported(env, platform) ? "✔" : "√");
