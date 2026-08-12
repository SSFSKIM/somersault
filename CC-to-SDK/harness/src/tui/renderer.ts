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
//   1. WITHDRAWN AT TASK 16 — THE TMUX `-CC` PROBE IS BACK. T5 kept canon's three-part env test (`Eku()`:
//      TMUX set · TERM_PROGRAM === "iTerm.app" · TERM not screen*/tmux*) and dropped the shell-out behind it,
//      on a premise it stated in its own text: the miss "resolves to `classic` anyway on today's default-off
//      constant". Task 16 turned that constant on, so the premise expired with it and the same miss now
//      resolves to a fullscreen ccx inside iTerm2's `-CC` integration, where the alternate screen fights the
//      native-window/native-scrollback model that is the whole reason someone runs `-CC`. The cost that
//      justified dropping it was also overstated: canon does NOT spawn for every tmux user. `XOg()` reaches
//      the spawn only when the env test misses AND `TMUX` is set AND `TERM_PROGRAM` is entirely unset — so
//      every macOS/iTerm2/VS Code/Terminal.app launch, the population the heuristic already answers, pays
//      nothing — and the 2 s is a TIMEOUT CEILING, not a cost. Measured here: 4.8 ms against a live server,
//      5.4 ms against a stale `TMUX` socket (exit 1, no verdict, falls through). See `probeTmuxControlMode`.
//   2. NO `bg_forced_on` RUNG. Canon's top rung forces fullscreen for `CLAUDE_CODE_SESSION_KIND=bg`; ccx's
//      background sessions never construct a TUI at all, so the rung would be unreachable.
//   3. NO STATSIG SLOT. Canon's last two rungs are feature gates (`tengu_amber_creek` / `tengu_pewter_brook`);
//      ours is the `DEFAULT_ON` constant below, which is what the spec means by "canon's statsig slot
//      resolves to our default".
//   4. SCREEN READER READS THE ENV ONLY. Canon activates from three sources — an `--ax-screen-reader` flag,
//      `CLAUDE_AX_SCREEN_READER`, and an `axScreenReader` setting — and reports which one fired. ccx has
//      neither the flag nor the setting, so the env var IS the rung. Same spelling as canon's, so a machine
//      already configured for Claude Code is already configured for ccx.
import { spawnSync } from "node:child_process";
import type { CcxPrefs } from "./prefs.js";

export type RendererMode = "fullscreen" | "classic";
/** One word per rung, in ladder order. `*_off`/`*_on` say which way the rung went, so `/status` can print a
 *  reason without also printing the mode to disambiguate it. */
export type RendererReason =
  | "not_tty" | "screen_reader" | "env_off" | "env_on" | "tmux_cc_off" | "win_ssh_off"
  | "settings_on" | "settings_off" | "default_on" | "default_off";
export interface RendererChoice { mode: RendererMode; reason: RendererReason }

/** THE DEFAULT, AND THE WHOLE OF WHAT TASK 16 CHANGED. Through M2a this was `false` — the shippability gate,
 *  so an install that configured nothing kept the classic renderer and every new path stayed opt-in. The wave
 *  is complete and the gate is open: an install that configures nothing now gets the fullscreen renderer, and
 *  the ladder above is what an install that configures something gets instead. The `boolean` annotation is
 *  deliberate and stays (plan review I7): it stops the type narrowing to a literal, so BOTH branches below
 *  remain live code and the constant can be turned back with the same one-token edit that turned it. */
export const DEFAULT_ON: boolean = true;

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
function tmuxEnvHeuristic(env: NodeJS.ProcessEnv): boolean {
  if (!env.TMUX) return false;
  if (env.TERM_PROGRAM !== "iTerm.app") return false;
  const term = env.TERM ?? "";
  return !term.startsWith("screen") && !term.startsWith("tmux");
}

export type SpawnSyncFn = typeof spawnSync;
/** Canon `XOg()`'s second half, ported at Task 16 (divergence 1, withdrawn above). ASKING TMUX ITSELF is the
 *  only way to see a `-CC` client whose pane env does not advertise iTerm2 — a server started before the
 *  control-mode client attached keeps the environment it was started with, so `TERM_PROGRAM` is simply absent
 *  and the heuristic above has nothing to match on.
 *
 *  THE GATE IS THE COST CONTROL, and it is canon's, not ours: the spawn happens only when `TMUX` is set and
 *  `TERM_PROGRAM` is UNSET. A set-but-unrecognised `TERM_PROGRAM` is a terminal that told us what it is and
 *  is not iTerm2, so there is no -CC integration to avoid and no reason to pay for a subprocess.
 *
 *  EVERY FAILURE IS "NO VERDICT", never a throw and never a crash: tmux missing from PATH (spawn error,
 *  `status === null`), a stale `TMUX` pointing at a dead socket (exit 1), a wedged server (the 2 s timeout
 *  kills the child and leaves `status === null`), or unparseable output all fall through to `false`, which is
 *  the same answer as "not control mode" and lets the ladder continue. `spawn` is injected so unit tests
 *  never touch a real tmux. */
export function probeTmuxControlMode(env: NodeJS.ProcessEnv, spawn: SpawnSyncFn = spawnSync): boolean {
  if (tmuxEnvHeuristic(env)) return true;
  if (!env.TMUX || env.TERM_PROGRAM) return false;
  try {
    const r = spawn("tmux", ["display-message", "-p", "#{client_control_mode}"], { encoding: "utf8", timeout: 2000, env, windowsHide: true });
    return r.status === 0 && String(r.stdout ?? "").trim() === "1";
  } catch { return false; }
}

/** ASKED ONCE PER PROCESS, AND THE CACHE IS A CLOSURE RATHER THAN A MODULE GLOBAL. `selectRenderer` runs at
 *  boot and again on every `/tui` (T15's `RendererSwitch`), and re-asking tmux on a keystroke would put a
 *  subprocess between the command and the paint it triggers — so `runChatClient` builds ONE of these and hands
 *  it to both callers. Canon caches the same answer the same way, in its startup-state object
 *  (`YOg().tmuxControlModeProbed`). A module-level `let` would do it in fewer lines and be wrong: the cached
 *  verdict is only valid for the environment it was taken in, and a process-wide cache silently answers for a
 *  different one — harmless in production, where there is exactly one `process.env`, and a trap in any test
 *  that walks several. `??=` is safe for a boolean; `false` is a decided verdict and is not nullish. */
export function makeTmuxProbe(spawn: SpawnSyncFn = spawnSync): (env: NodeJS.ProcessEnv) => boolean {
  let probed: boolean | undefined;
  return (env) => (probed ??= probeTmuxControlMode(env, spawn));
}

/** Canon `kSs()`: ConPTY re-renders the screen underneath us on a Windows host reached over SSH, which
 *  desynchronizes an alt-screen frame. Any of the three SSH markers counts. */
function windowsOverSsh(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): boolean {
  if (platform !== "win32") return false;
  return Boolean(env.SSH_CONNECTION || env.SSH_CLIENT || env.SSH_TTY);
}

/** Decided ONCE, at startup; a resize never re-runs it (spec §L2.1). `platform` is injectable for the same
 *  reason `useChat`'s is — the Windows-over-SSH rung would otherwise be unpinnable off Windows — and
 *  defaults to the live process, so the three-field shape the plan declares is what every caller writes.
 *  `tmuxProbe` is the fourth and last seam (T16): it defaults to the real, UNCACHED probe — correct for the
 *  one-shot callers that do not pass one, since the rung's expensive half only runs when the cheap env test
 *  has already missed — and `runChatClient` injects a `makeTmuxProbe()` closure so its two calls share one
 *  answer. A test can pin either verdict without a tmux on the machine. */
export function selectRenderer(deps: { isTTY: boolean; env: NodeJS.ProcessEnv; prefs: CcxPrefs; platform?: NodeJS.Platform; tmuxProbe?: (env: NodeJS.ProcessEnv) => boolean }): RendererChoice {
  const { isTTY, env, prefs, platform = process.platform, tmuxProbe = probeTmuxControlMode } = deps;
  if (!isTTY) return { mode: "classic", reason: "not_tty" };
  if (envBool(env.CLAUDE_AX_SCREEN_READER) === true) return { mode: "classic", reason: "screen_reader" };
  if (envSet(env.CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN) || envBool(env.CLAUDE_CODE_NO_FLICKER) === false) return { mode: "classic", reason: "env_off" };
  if (envBool(env.CLAUDE_CODE_NO_FLICKER) === true) return { mode: "fullscreen", reason: "env_on" };
  if (tmuxProbe(env)) return { mode: "classic", reason: "tmux_cc_off" };
  if (windowsOverSsh(env, platform)) return { mode: "classic", reason: "win_ssh_off" };
  if (prefs.tui === "fullscreen") return { mode: "fullscreen", reason: "settings_on" };
  if (prefs.tui === "default") return { mode: "classic", reason: "settings_off" };
  return DEFAULT_ON ? { mode: "fullscreen", reason: "default_on" } : { mode: "classic", reason: "default_off" };
}
