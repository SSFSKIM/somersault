// tui/src/banner.ts — pure welcome-banner builder. Returns RenderLine[] seeded ONCE as the first
// lines of the Static scrollback, so it scrolls away like CC's banner does AND Ink's <Static> ordering
// stays correct (a non-static banner would paradoxically render BELOW the static transcript). One style
// per RenderLine, so the box is uniformly accent-colored (CC's logo lines are colored too).
// CC ref: components/LogoV2/WelcomeV2.tsx ("✻ Welcome to Claude Code") + feedConfigs "Tips for getting started".
import type { RenderLine } from "./render.js";
import { ACCENT } from "./theme.js";
export { ACCENT };

/** Collapse $HOME to `~` so the cwd line stays short. */
export function shortCwd(cwd: string, home = process.env.HOME ?? ""): string {
  return home && (cwd === home || cwd.startsWith(home + "/")) ? "~" + cwd.slice(home.length) : cwd;
}

export interface BannerInfo { cwd: string; model?: string; mode?: string }

/** The launch splash: an accent box + cwd/model/mode snapshot + getting-started tips. */
export function welcomeBanner(info: BannerInfo): RenderLine[] {
  const title = "✻ Welcome to Claude Code";
  const inner = Math.max(title.length, 47);                 // inner text width (between "│ " and "│")
  const bar = "─".repeat(inner + 2);
  const out: RenderLine[] = [
    { text: "╭" + bar + "╮", color: ACCENT },
    { text: "│ " + title.padEnd(inner) + " │", color: ACCENT, bold: true },
    { text: "╰" + bar + "╯", color: ACCENT },
    { text: "" },
    { text: `  cwd    ${shortCwd(info.cwd)}`, dim: true },
    { text: `  model  ${info.model ?? "(default)"}   ·   mode  ${info.mode ?? "default"}`, dim: true },
    { text: "" },
    { text: "  Tips for getting started" },
    { text: "  • Ask Claude to edit files, run commands, or explain code", dim: true },
    { text: "  • /help for commands · @ to reference files · Tab to change mode", dim: true },
    { text: "  • Esc to interrupt a response", dim: true },
    { text: "" },
  ];
  return out;
}
