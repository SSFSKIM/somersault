// tui/renderer.ts — WHICH RENDERER, AND WHY (fullscreen-live-window Task 5, spec §A2). One pure function,
// called exactly once at boot by `chatMain`, whose answer carries a one-word provenance reason that
// `/status` prints. Canon's equivalent pair is `Qs()` (the verdict) and `PJe()` (the reason word) at
// 2.1.226; ccx collapses them into one call so the two can never disagree — upstream's two functions walk
// the same ladder twice and a rung added to one but not the other would show a renderer whose stated reason
// belongs to a different branch.
//
// CITES IN THIS FILE CARRY THEIR BUNDLE VERSION, because they come from two of them and the names differ
// (T16 review, minor 5). The LADDER cites are 2.1.226 (`Qs`/`PJe`/`Eku`/`kSs`, and the `yr`/`md` word lists);
// the TMUX PROBE cites are 2.1.220 (`XOg`/`YOg`/`iau`/`ds` at L110065-110139 of `cli.pretty.js`), which is
// the bundle checked out on this machine and the only one whose line numbers can be checked back.
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
// RECORDED DIVERGENCES from canon:
//   1. THE TMUX `-CC` PROBE IS RESTORED (T16) AND ITS GATE IS ONE WORD WIDER THAN CANON'S (T16 fix round).
//      Not withdrawn — this is the live divergence, and the widening is what makes the restoration mean
//      anything.
//        RESTORED. T5 kept canon's three-part env test (`Eku()` at 2.1.226 / `iau()` at 2.1.220: TMUX set ·
//      TERM_PROGRAM === "iTerm.app" · TERM not screen*/tmux*) and dropped the shell-out behind it, on a
//      premise it stated in its own text: the miss "resolves to `classic` anyway on today's default-off
//      constant". Task 16 turned that constant on, so the premise expired with it and the same miss now
//      resolves to a fullscreen ccx inside iTerm2's `-CC` integration, where the alternate screen fights the
//      native-window/native-scrollback model that is the whole reason someone runs `-CC`. The 2 s in canon is
//      a TIMEOUT CEILING, not a cost. Measured here: 4.8 ms against a live server, 5.4 ms against a stale
//      `TMUX` socket (exit 1, no verdict, falls through).
//        WIDENED, AND WHY CANON'S GATE COULD NOT BE COPIED AS WRITTEN. Canon's `XOg()` (2.1.220, L110076-110094)
//      reaches the spawn only when `TERM_PROGRAM` is ENTIRELY UNSET. Measured on tmux 3.7b, three ways — a
//      fresh pane from a shell with `TERM_PROGRAM` unset (`env -u`), a parent-env override, and a
//      `new-session -e` override — tmux stamps `TERM_PROGRAM=tmux` and `TERM_PROGRAM_VERSION=3.7b` into every
//      pane environment it creates (tmux `environ.c` on master, unconditional at spawn). So inside modern
//      tmux — the only place this rung is about — `TERM_PROGRAM` is never unset, canon's own rung cannot fire
//      there either, and a byte-faithful port would have been a dead branch dressed as a safeguard.
//        So the gate here is `unset OR "tmux"`. Measured on the same machine: an ordinary pane answers
//      `#{client_control_mode}` = 0 and falls through (paying the ~5 ms), and a session whose only client is a
//      `tmux -CC attach` answers 1 from inside the pane, which is exactly the launch canon meant to catch.
//      The heuristic rung above is UNCHANGED and stays byte-faithful even though the same stamp makes it
//      unreachable on tmux ≥ 3.2: it costs nothing, and it is still the whole answer on an older tmux that
//      does not stamp. This divergence therefore ACHIEVES CANON'S INTENT rather than departing from it — the
//      thing it departs from is a clause that stopped working when tmux changed.
//        AND WHEN IT FIRES, IT SAYS SO: `TMUX_CC_NOTICE` below, canon's own sentence (2.1.220 L110122), once
//      per process on the boot path. Canon writes that sentence to its DEBUG LOG (`v()`, level `debug`,
//      2.1.220 L15475) where nobody in a `-CC` window will ever read it; ccx puts the same bytes in the
//      transcript. That channel change is deliberate and is the point: this rung's whole failure mode is a
//      user who cannot tell why their renderer is not the one they configured.
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

/** CANON'S OWN SENTENCE FOR THIS RUNG, byte for byte (2.1.220, `ds()` at L110122; canon guards it with the
 *  `loggedTmuxCcDisable` flag on its startup-state object, i.e. once per process). ccx emits it on the boot
 *  path when the ladder lands `tmux_cc_off` — see the divergence note above for why the channel is the
 *  transcript and not, as upstream, the debug log. Kept a literal: the value of porting it is that a user who
 *  searches the sentence lands on Claude Code's own answer, which a paraphrase would forfeit. */
export const TMUX_CC_NOTICE = "fullscreen disabled: tmux -CC (iTerm2 integration mode) detected · set CLAUDE_CODE_NO_FLICKER=1 to override";

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

/** Canon `Eku()` (2.1.226) / `iau()` (2.1.220 L110068), exactly: tmux's own env marker, iTerm2 as the outer
 *  terminal, and a TERM that is NOT a real tmux/screen pane — under `-CC` the pane is an iTerm2 native window,
 *  so a `screen-256color` TERM is the tell that this is an ordinary tmux session rather than control mode.
 *  All three, or no verdict.
 *
 *  KEPT BYTE-FAITHFUL THOUGH MEASURED UNREACHABLE ON TMUX ≥ 3.2 (T16 fix round): tmux stamps
 *  `TERM_PROGRAM=tmux` over whatever the outer terminal set, so the second clause cannot match inside tmux
 *  and this rung answers only on an older tmux that does not stamp. It costs nothing to keep and it is the
 *  only rung that works there, so it stays exactly as canon wrote it; the SPAWN below is where the fix went. */
function tmuxEnvHeuristic(env: NodeJS.ProcessEnv): boolean {
  if (!env.TMUX) return false;
  if (env.TERM_PROGRAM !== "iTerm.app") return false;
  const term = env.TERM ?? "";
  return !term.startsWith("screen") && !term.startsWith("tmux");
}

export type SpawnSyncFn = typeof spawnSync;
/** Canon `XOg()`'s second half (2.1.220 L110076-110094), ported at Task 16 — divergence 1 above, and this is
 *  where it lives. ASKING TMUX ITSELF is the only way to see a `-CC` client whose pane env does not advertise
 *  iTerm2, which since tmux began stamping `TERM_PROGRAM` is every one of them.
 *
 *  THE GATE IS THE COST CONTROL, AND IT IS CANON'S PLUS ONE WORD: the spawn happens when `TMUX` is set and
 *  `TERM_PROGRAM` is either UNSET or the literal `tmux`. A `TERM_PROGRAM` naming any other terminal is a
 *  terminal that told us what it is and is not iTerm2, so there is no `-CC` integration to avoid and no
 *  reason to pay for a subprocess — that clause is canon's and still does all the work, since it is what
 *  keeps every non-tmux launch free. The `"tmux"` word is the divergence, and without it the gate is dead on
 *  arrival: tmux writes that exact value into every pane it spawns, so canon's "unset" is a state that does
 *  not occur where the rung applies. Full measurement in the header.
 *
 *  EVERY FAILURE IS "NO VERDICT", never a throw and never a crash: tmux missing from PATH (spawn error,
 *  `status === null`), a stale `TMUX` pointing at a dead socket (exit 1), a wedged server (the 2 s timeout
 *  kills the child and leaves `status === null`), or unparseable output all fall through to `false`, which is
 *  the same answer as "not control mode" and lets the ladder continue. `spawn` is injected so unit tests
 *  never touch a real tmux. */
export function probeTmuxControlMode(env: NodeJS.ProcessEnv, spawn: SpawnSyncFn = spawnSync): boolean {
  if (tmuxEnvHeuristic(env)) return true;
  if (!env.TMUX || (env.TERM_PROGRAM && env.TERM_PROGRAM !== "tmux")) return false;
  try {
    // `env` IS THE INJECTED ONE, not `process.env` (canon passes the latter): a test that hands this a
    // synthetic environment with no PATH gets a spawn failure and therefore a non-verdict, which is the
    // deliberate answer — the probe has no way to ask tmux and "no verdict" is what it says then.
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
 *  that walks several. `??=` is safe for a boolean; `false` is a decided verdict and is not nullish.
 *  (`YOg()` is 2.1.220 L110065.) */
export function makeTmuxProbe(spawn: SpawnSyncFn = spawnSync): (env: NodeJS.ProcessEnv) => boolean {
  let probed: boolean | undefined;
  return (env) => (probed ??= probeTmuxControlMode(env, spawn));
}

/** Canon `kSs()` (2.1.226) / `LZi()` (2.1.220 L110101): ConPTY re-renders the screen underneath us on a
 *  Windows host reached over SSH, which desynchronizes an alt-screen frame. Any of the three SSH markers
 *  counts. */
function windowsOverSsh(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): boolean {
  if (platform !== "win32") return false;
  return Boolean(env.SSH_CONNECTION || env.SSH_CLIENT || env.SSH_TTY);
}

/** The screen-reader rung as a predicate rather than an inline test, because F8's banner and its motion
 *  resolver need the same verdict and `choice.reason === "screen_reader"` is not it — that is true only
 *  when this rung WINS, and is silently false under a non-TTY. Env-only, per divergence 4 above. */
export function screenReaderEnabled(env: NodeJS.ProcessEnv): boolean { return envBool(env.CLAUDE_AX_SCREEN_READER) === true; }

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
  if (screenReaderEnabled(env)) return { mode: "classic", reason: "screen_reader" };
  if (envSet(env.CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN) || envBool(env.CLAUDE_CODE_NO_FLICKER) === false) return { mode: "classic", reason: "env_off" };
  if (envBool(env.CLAUDE_CODE_NO_FLICKER) === true) return { mode: "fullscreen", reason: "env_on" };
  if (tmuxProbe(env)) return { mode: "classic", reason: "tmux_cc_off" };
  if (windowsOverSsh(env, platform)) return { mode: "classic", reason: "win_ssh_off" };
  if (prefs.tui === "fullscreen") return { mode: "fullscreen", reason: "settings_on" };
  if (prefs.tui === "default") return { mode: "classic", reason: "settings_off" };
  return DEFAULT_ON ? { mode: "fullscreen", reason: "default_on" } : { mode: "classic", reason: "default_off" };
}
