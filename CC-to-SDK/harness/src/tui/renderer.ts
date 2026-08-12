// tui/renderer.ts — WHICH RENDERER, AND WHY (fullscreen-live-window Task 5, spec §A2). One pure function,
// called exactly once at boot by `chatMain`, whose answer carries a one-word provenance reason that
// `/status` prints. Canon's equivalent pair is `Qs()` (the verdict) and `PJe()` (the reason word) at
// 2.1.226; ccx collapses them into one call so the two can never disagree — upstream's two functions walk
// the same ladder twice and a rung added to one but not the other would show a renderer whose stated reason
// belongs to a different branch.
//
// THE ORDER IS THE CONTRACT, not the individual rungs. Two placements are load-bearing:
//   · NOT-TTY IS THE TOP RUNG, above everything including a force-on env (D-F2's "regardless"). A pipe has
//     no alternate screen to enter; honouring a force-on there writes `ESC[?1049h` into someone's file.
//   · THE SCREEN READER SITS ABOVE THE ENV LEVERS, as in canon. Spec review I1 caught a first draft with it
//     below: `CLAUDE_CODE_NO_FLICKER=1` in a shell profile would then have imposed a virtualized alt-screen
//     frame on a screen-reader user, which is precisely the user who cannot recover from it.
// Everything else follows canon's order: env off → env on → tmux `-CC` → Windows-over-SSH → the settings
// key → the default.
//
// RECORDED DIVERGENCES from canon (2.1.226):
//   1. TMUX `-CC` IS THE CHEAP HEURISTIC ONLY. Canon's `zDe()` starts from the same three-part env test
//      (`Eku()`: TMUX set · TERM_PROGRAM === "iTerm.app" · TERM not screen*/tmux*) and then, when that
//      misses, SHELLS OUT — `tmux display-message -p '#{client_control_mode}'` with a 2 s timeout. We keep
//      the env half and drop the spawn: a synchronous 2 s subprocess sits directly on the boot path of a
//      REPL whose whole purpose here is to paint faster, and the miss it covers (tmux -CC under a
//      TERM_PROGRAM the heuristic does not know) resolves to `classic` anyway on today's default-off
//      constant. A user in that corner can pin either way with `CLAUDE_CODE_NO_FLICKER`.
//   2. NO `bg_forced_on` RUNG. Canon's top rung forces fullscreen for `CLAUDE_CODE_SESSION_KIND=bg`; ccx's
//      background sessions never construct a TUI at all, so the rung would be unreachable.
//   3. NO STATSIG SLOT. Canon's last two rungs are feature gates (`tengu_amber_creek` / `tengu_pewter_brook`);
//      ours is the `DEFAULT_ON` constant below, which is what the spec means by "canon's statsig slot
//      resolves to our default".
//   4. SCREEN READER READS THE ENV ONLY. Canon activates from three sources — an `--ax-screen-reader` flag,
//      `CLAUDE_AX_SCREEN_READER`, and an `axScreenReader` setting — and reports which one fired. ccx has
//      neither the flag nor the setting, so the env var IS the rung. Same spelling as canon's, so a machine
//      already configured for Claude Code is already configured for ccx.
import type { CcxPrefs } from "./prefs.js";

export type RendererMode = "fullscreen" | "classic";
/** One word per rung, in ladder order. `*_off`/`*_on` say which way the rung went, so `/status` can print a
 *  reason without also printing the mode to disambiguate it. */
export type RendererReason =
  | "not_tty" | "screen_reader" | "env_off" | "env_on" | "tmux_cc_off" | "win_ssh_off"
  | "settings_on" | "settings_off" | "default_on" | "default_off";
export interface RendererChoice { mode: RendererMode; reason: RendererReason }

/** THE M2a SHIPPABILITY GATE: the wave ships behind a knob that is OFF, so an install that configures
 *  nothing keeps today's classic renderer and every new path stays opt-in. Task 16 flips this ONE token and
 *  nothing else (plan review I7) — which is also why it is annotated `boolean` rather than left to narrow to
 *  the literal `false`: the `default_on` branch below must stay live code both before and after the flip. */
export const DEFAULT_ON: boolean = false;

// Canon's env word lists (`yr`/`md` at 2.1.226), kept verbatim so a value that means "on" to Claude Code
// means "on" here. Anything else is UNDECIDED, which matters: the off rung and the on rung read the same
// variable, and a garbage value must fall through both rather than pick one.
const TRUTHY = ["1", "true", "yes", "on"], FALSY = ["0", "false", "no", "off"];
function envBool(raw: string | undefined): boolean | undefined {
  if (raw === undefined) return undefined;
  const value = raw.toLowerCase().trim();
  if (TRUTHY.includes(value)) return true;
  if (FALSY.includes(value)) return false;
  return undefined;
}
/** "Set" for a switch that has no off position: present, non-empty, and not one of the negative words. A
 *  bare `CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=` in a profile means the user cleared it, and `=0` means they
 *  wrote the negation out — neither should disable anything. (Canon truthy-parses this one, so `=maybe`
 *  reads as unset there and as set here; the brief's spelling is "set", and the generous reading is the one
 *  that cannot strand a user who wrote something we did not anticipate on an alt screen.) */
function envSet(raw: string | undefined): boolean {
  if (raw === undefined || raw.trim() === "") return false;
  return envBool(raw) !== false;
}

/** Canon `Eku()`, exactly: tmux's own env marker, iTerm2 as the outer terminal, and a TERM that is NOT a
 *  real tmux/screen pane — under `-CC` the pane is an iTerm2 native window, so a `screen-256color` TERM is
 *  the tell that this is an ordinary tmux session rather than control mode. All three, or no verdict. */
function tmuxControlMode(env: NodeJS.ProcessEnv): boolean {
  if (!env.TMUX) return false;
  if (env.TERM_PROGRAM !== "iTerm.app") return false;
  const term = env.TERM ?? "";
  return !term.startsWith("screen") && !term.startsWith("tmux");
}

/** Canon `kSs()`: ConPTY re-renders the screen underneath us on a Windows host reached over SSH, which
 *  desynchronizes an alt-screen frame. Any of the three SSH markers counts. */
function windowsOverSsh(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): boolean {
  if (platform !== "win32") return false;
  return Boolean(env.SSH_CONNECTION || env.SSH_CLIENT || env.SSH_TTY);
}

/** Decided ONCE, at startup; a resize never re-runs it (spec §L2.1). `platform` is injectable for the same
 *  reason `useChat`'s is — the Windows-over-SSH rung would otherwise be unpinnable off Windows — and
 *  defaults to the live process, so the three-field shape the plan declares is what every caller writes. */
export function selectRenderer(deps: { isTTY: boolean; env: NodeJS.ProcessEnv; prefs: CcxPrefs; platform?: NodeJS.Platform }): RendererChoice {
  const { isTTY, env, prefs, platform = process.platform } = deps;
  if (!isTTY) return { mode: "classic", reason: "not_tty" };
  if (envBool(env.CLAUDE_AX_SCREEN_READER) === true) return { mode: "classic", reason: "screen_reader" };
  if (envSet(env.CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN) || envBool(env.CLAUDE_CODE_NO_FLICKER) === false) return { mode: "classic", reason: "env_off" };
  if (envBool(env.CLAUDE_CODE_NO_FLICKER) === true) return { mode: "fullscreen", reason: "env_on" };
  if (tmuxControlMode(env)) return { mode: "classic", reason: "tmux_cc_off" };
  if (windowsOverSsh(env, platform)) return { mode: "classic", reason: "win_ssh_off" };
  if (prefs.tui === "fullscreen") return { mode: "fullscreen", reason: "settings_on" };
  if (prefs.tui === "default") return { mode: "classic", reason: "settings_off" };
  return DEFAULT_ON ? { mode: "fullscreen", reason: "default_on" } : { mode: "classic", reason: "default_off" };
}
