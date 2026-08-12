// test/unit/renderer-select.test.ts — fullscreen-live-window Task 5. `selectRenderer` is a pure decision
// made ONCE at boot, and the whole point of it is the ORDER: a rung that fires must beat everything below it
// and lose to everything above it. Spec review I1 caught a v1 that put the screen-reader rung UNDER the env
// levers, which would have let `CLAUDE_CODE_NO_FLICKER=1` force an alt-screen renderer onto a screen-reader
// user; canon puts the reader above the env, and so does this. So the tests below are not one-per-input —
// they are one-per-RUNG, and each pins both directions of that rung's place in the ladder. A test that only
// asserted "screen reader → classic" would still pass with the two rungs swapped.
//
// Every expectation is a LITERAL. Nothing here re-derives a value from the module under test (no
// `DEFAULT_ON ? "default_on" : "default_off"`), because a test that computes its own expectation from the
// production constant agrees with the code by construction and pins nothing.
import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_ON, makeTmuxProbe, probeTmuxControlMode, selectRenderer } from "../../src/tui/renderer.js";
import { loadPrefs } from "../../src/tui/prefs.js";
import type { CcxPrefs } from "../../src/tui/prefs.js";

/** A launch with every lever pushed toward FULLSCREEN below the rung under test: env force-on, settings
 *  force-on, a TTY. Each order test starts from this and adds exactly the one input it is pinning, so a
 *  `classic` verdict can only have come from that input outranking the ones already here. */
const forcedOn = { isTTY: true, env: { CLAUDE_CODE_NO_FLICKER: "1" } as NodeJS.ProcessEnv, prefs: { tui: "fullscreen" } as CcxPrefs, platform: "darwin" as NodeJS.Platform };
/** The mirror: nothing set anywhere, a real TTY, so the ladder falls all the way through to the constant. */
const bare = { isTTY: true, env: {} as NodeJS.ProcessEnv, prefs: {} as CcxPrefs, platform: "darwin" as NodeJS.Platform };
/** `bare` plus a settings key that says "classic" — a floor sitting BELOW every auto-off rung and ABOVE the
 *  `DEFAULT_ON` constant. Falsification tests (the ones proving a rung did NOT fire) start here rather than
 *  from `bare`, so their fall-through reason is `settings_off`, a literal Task 16's flip cannot move. Only
 *  the one deliberate pin at the bottom of this file observes the default. */
const settingsFloor = { ...bare, prefs: { tui: "default" } as CcxPrefs };

describe("selectRenderer — the ladder, rung by rung", () => {
  // F11 [M2a], quoted: "Non-TTY invocation (pipe) lands classic regardless of env force-on (D-F2's
  // 'regardless', pinned)." `regardless` is the whole cell — it is the ONE rung above the screen reader.
  it("not_tty is the top rung: a pipe lands classic even with env force-on, settings force-on and a screen reader", () => {
    expect(selectRenderer({ ...forcedOn, isTTY: false })).toEqual({ mode: "classic", reason: "not_tty" });
    expect(selectRenderer({ ...forcedOn, isTTY: false, env: { CLAUDE_CODE_NO_FLICKER: "1", CLAUDE_AX_SCREEN_READER: "1" } }))
      .toEqual({ mode: "classic", reason: "not_tty" });
  });

  it("screen_reader beats every env lever below it, and loses only to not_tty", () => {
    // BEATS env force-on (spec review I1: the reason this rung is here and not three lines lower).
    expect(selectRenderer({ ...forcedOn, env: { CLAUDE_CODE_NO_FLICKER: "1", CLAUDE_AX_SCREEN_READER: "1" } }))
      .toEqual({ mode: "classic", reason: "screen_reader" });
    // BEATS env force-off too — the reason word must name the reader, not the env, so `/status` says why.
    expect(selectRenderer({ ...forcedOn, env: { CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN: "1", CLAUDE_AX_SCREEN_READER: "1" } }))
      .toEqual({ mode: "classic", reason: "screen_reader" });
    // …and LOSES to not_tty.
    expect(selectRenderer({ ...forcedOn, isTTY: false, env: { CLAUDE_AX_SCREEN_READER: "1" } }))
      .toEqual({ mode: "classic", reason: "not_tty" });
  });

  it("env_off beats env_on, and both env spellings reach it", () => {
    expect(selectRenderer({ ...bare, env: { CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN: "1", CLAUDE_CODE_NO_FLICKER: "1" } }))
      .toEqual({ mode: "classic", reason: "env_off" });
    expect(selectRenderer({ ...bare, env: { CLAUDE_CODE_NO_FLICKER: "false" } })).toEqual({ mode: "classic", reason: "env_off" });
    expect(selectRenderer({ ...bare, env: { CLAUDE_CODE_NO_FLICKER: "0" } })).toEqual({ mode: "classic", reason: "env_off" });
    // The off rung also outranks the settings and the default beneath it.
    expect(selectRenderer({ ...bare, env: { CLAUDE_CODE_NO_FLICKER: "0" }, prefs: { tui: "fullscreen" } }))
      .toEqual({ mode: "classic", reason: "env_off" });
    // `CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN` is the half with no off position, so "is it set?" is a real
    // question with three answers, and the module's answer is a RECORDED DIVERGENCE from canon (which
    // truthy-parses it). Cleared and spelled-out-negation do NOT disable; anything unrecognised DOES.
    // `settings_off` is the sentinel below, not `default_off`, so these stay independent of `DEFAULT_ON`.
    expect(selectRenderer({ ...settingsFloor, env: { CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN: "" } }))
      .toEqual({ mode: "classic", reason: "settings_off" });
    expect(selectRenderer({ ...settingsFloor, env: { CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN: "0" } }))
      .toEqual({ mode: "classic", reason: "settings_off" });
    expect(selectRenderer({ ...settingsFloor, env: { CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN: "maybe" } }))
      .toEqual({ mode: "classic", reason: "env_off" });
  });

  it("env_on beats tmux -CC, Windows-over-SSH and the settings key", () => {
    expect(selectRenderer({ ...bare, env: { CLAUDE_CODE_NO_FLICKER: "1", TMUX: "/tmp/tmux-501/default,1,0", TERM_PROGRAM: "iTerm.app", TERM: "xterm-256color" } }))
      .toEqual({ mode: "fullscreen", reason: "env_on" });
    expect(selectRenderer({ ...bare, platform: "win32", env: { CLAUDE_CODE_NO_FLICKER: "1", SSH_CONNECTION: "10.0.0.1 5 10.0.0.2 22" } }))
      .toEqual({ mode: "fullscreen", reason: "env_on" });
    expect(selectRenderer({ ...bare, env: { CLAUDE_CODE_NO_FLICKER: "1" }, prefs: { tui: "default" } }))
      .toEqual({ mode: "fullscreen", reason: "env_on" });
  });

  it("tmux_cc_off fires on the cheap three-part heuristic, beats settings, and loses to env_on", () => {
    const tmuxCc = { TMUX: "/tmp/tmux-501/default,1,0", TERM_PROGRAM: "iTerm.app", TERM: "xterm-256color" };
    expect(selectRenderer({ ...bare, env: tmuxCc })).toEqual({ mode: "classic", reason: "tmux_cc_off" });
    expect(selectRenderer({ ...bare, env: tmuxCc, prefs: { tui: "fullscreen" } })).toEqual({ mode: "classic", reason: "tmux_cc_off" });
    expect(selectRenderer({ ...bare, env: { ...tmuxCc, CLAUDE_CODE_NO_FLICKER: "1" } })).toEqual({ mode: "fullscreen", reason: "env_on" });
  });

  it("the cheap heuristic needs all three parts, and each miss that names a terminal costs no subprocess", () => {
    // T16 restored the shell-out behind this rung, so "did it fire?" is no longer the only question — "did it
    // PAY?" is the other half, and a spawn that throws on call is how these four say no. Each env below names
    // a terminal (or has no tmux at all), which is canon's own gate on reaching the subprocess.
    const noSpawn = { ...settingsFloor, tmuxProbe: (env: NodeJS.ProcessEnv) => probeTmuxControlMode(env, (() => { throw new Error("spawned"); }) as never) };
    // No TMUX at all: iTerm2 on its own is not control mode.
    expect(selectRenderer({ ...noSpawn, env: { TERM_PROGRAM: "iTerm.app", TERM: "xterm-256color" } })).toEqual({ mode: "classic", reason: "settings_off" });
    // tmux under a terminal that is not iTerm2: `-CC` is an iTerm2 integration, so nothing to avoid.
    expect(selectRenderer({ ...noSpawn, env: { TMUX: "/tmp/tmux-501/default,1,0", TERM_PROGRAM: "Apple_Terminal", TERM: "xterm-256color" } }))
      .toEqual({ mode: "classic", reason: "settings_off" });
    // A `screen*`/`tmux*` TERM means the client is a REAL tmux pane, i.e. not the -CC passthrough window.
    expect(selectRenderer({ ...noSpawn, env: { TMUX: "/tmp/tmux-501/default,1,0", TERM_PROGRAM: "iTerm.app", TERM: "screen-256color" } }))
      .toEqual({ mode: "classic", reason: "settings_off" });
    expect(selectRenderer({ ...noSpawn, env: { TMUX: "/tmp/tmux-501/default,1,0", TERM_PROGRAM: "iTerm.app", TERM: "tmux-256color" } }))
      .toEqual({ mode: "classic", reason: "settings_off" });
  });

  // T16: the rung the restored probe exists for. The env heuristic cannot see this launch at all — the tmux
  // server predates the `-CC` client, so its panes carry no TERM_PROGRAM — and before the probe came back this
  // fell through to `default_on`, i.e. an alt screen inside iTerm2's control-mode window.
  it("tmux_cc_off fires on the probe's verdict alone, beats the settings key and the default, and loses to env_on", () => {
    const bareTmux = { TMUX: "/tmp/tmux-501/default,1,0", TERM: "screen-256color" };
    const onProbe = () => true;
    expect(selectRenderer({ ...bare, env: bareTmux, tmuxProbe: onProbe })).toEqual({ mode: "classic", reason: "tmux_cc_off" });
    expect(selectRenderer({ ...bare, env: bareTmux, prefs: { tui: "fullscreen" }, tmuxProbe: onProbe })).toEqual({ mode: "classic", reason: "tmux_cc_off" });
    expect(selectRenderer({ ...bare, env: { ...bareTmux, CLAUDE_CODE_NO_FLICKER: "1" }, tmuxProbe: onProbe })).toEqual({ mode: "fullscreen", reason: "env_on" });
    // …and a probe that says no leaves the ladder exactly where it was.
    expect(selectRenderer({ ...bare, env: bareTmux, tmuxProbe: () => false })).toEqual({ mode: "fullscreen", reason: "default_on" });
  });

  it("win_ssh_off needs BOTH Windows and an SSH marker, beats settings, and loses to tmux_cc_off", () => {
    for (const marker of ["SSH_CONNECTION", "SSH_CLIENT", "SSH_TTY"])
      expect(selectRenderer({ ...bare, platform: "win32", env: { [marker]: "yes" } })).toEqual({ mode: "classic", reason: "win_ssh_off" });
    // Windows with no SSH, and SSH from a non-Windows box: neither is the ConPTY re-rendering case.
    expect(selectRenderer({ ...settingsFloor, platform: "win32", env: {} })).toEqual({ mode: "classic", reason: "settings_off" });
    expect(selectRenderer({ ...settingsFloor, platform: "linux", env: { SSH_CONNECTION: "yes" } })).toEqual({ mode: "classic", reason: "settings_off" });
    expect(selectRenderer({ ...bare, platform: "win32", env: { SSH_TTY: "yes" }, prefs: { tui: "fullscreen" } }))
      .toEqual({ mode: "classic", reason: "win_ssh_off" });
    // Order between the two auto-off rungs is fixed even though both land classic: the REASON differs, and
    // `/status` prints it.
    expect(selectRenderer({ ...bare, platform: "win32", env: { SSH_TTY: "yes", TMUX: "/tmp/t,1,0", TERM_PROGRAM: "iTerm.app", TERM: "xterm-256color" } }))
      .toEqual({ mode: "classic", reason: "tmux_cc_off" });
  });

  it("the settings key decides both ways, and beats the default", () => {
    expect(selectRenderer({ ...bare, prefs: { tui: "fullscreen" } })).toEqual({ mode: "fullscreen", reason: "settings_on" });
    expect(selectRenderer({ ...bare, prefs: { tui: "default" } })).toEqual({ mode: "classic", reason: "settings_off" });
  });

  // THE DEFAULT, POST-FLIP (Task 16). The wave shipped behind a knob that was OFF and this is the one constant
  // T16 turned — the whole flip's test fallout is this single expectation, which is what the M2a gate was built
  // for. Both halves stay literal: the constant is `true`, and an unconfigured TTY launch says so. Every other
  // test in this file sits on `settingsFloor` precisely so that it did not move when this one did.
  it("DEFAULT_ON is true, so a bare TTY launch lands fullscreen with reason default_on", () => {
    expect(DEFAULT_ON).toBe(true);
    expect(selectRenderer(bare)).toEqual({ mode: "fullscreen", reason: "default_on" });
  });
});

// FSW T16 — THE RESTORED SHELL-OUT (renderer.ts divergence 1, withdrawn). T5 dropped canon's
// `tmux display-message -p '#{client_control_mode}'` because a miss "resolved to classic anyway on today's
// default-off constant"; T16 turned that constant on, so the miss now resolves to an alt screen inside
// iTerm2's `-CC` window. What has to hold is that the spawn is RARE (canon's gate) and that every way it can
// go wrong is a non-verdict rather than a crash on the boot path of a REPL.
describe("probeTmuxControlMode — the tmux -CC shell-out", () => {
  /** A spawnSync stand-in that records its calls and replays a canned result. `status: null` is what Node
   *  reports for both a killed-by-timeout child and a binary that is not on PATH. */
  const fakeSpawn = (result: { status: number | null; stdout?: string }) => {
    const calls: unknown[][] = [];
    const spawn = ((...args: unknown[]) => { calls.push(args); return { status: result.status, stdout: result.stdout ?? "", stderr: "" }; }) as never;
    return { calls, spawn };
  };
  const ccEnv = { TMUX: "/tmp/tmux-501/default,1,0", TERM: "screen-256color" } as NodeJS.ProcessEnv;

  it("asks tmux only when TMUX is set and no terminal has named itself, and reads `1` as control mode", () => {
    const yes = fakeSpawn({ status: 0, stdout: "1\n" });
    expect(probeTmuxControlMode(ccEnv, yes.spawn)).toBe(true);
    expect(yes.calls).toHaveLength(1);
    // The argv and the ceiling are canon's, verbatim — the 2 s is a TIMEOUT, not a cost (measured 4.8 ms
    // against a live server), and `windowsHide` keeps a console from flashing on Windows.
    expect(yes.calls[0][0]).toBe("tmux");
    expect(yes.calls[0][1]).toEqual(["display-message", "-p", "#{client_control_mode}"]);
    expect(yes.calls[0][2]).toMatchObject({ encoding: "utf8", timeout: 2000, windowsHide: true });
    const no = fakeSpawn({ status: 0, stdout: "0\n" });
    expect(probeTmuxControlMode(ccEnv, no.spawn)).toBe(false);
  });

  it("never spawns when the cheap env test already decided, either way", () => {
    const boom = (() => { throw new Error("spawned"); }) as never;
    // Heuristic HIT: iTerm2 named itself and the TERM is a passthrough window — answered without tmux.
    expect(probeTmuxControlMode({ TMUX: "/tmp/t,1,0", TERM_PROGRAM: "iTerm.app", TERM: "xterm-256color" }, boom)).toBe(true);
    // No tmux at all.
    expect(probeTmuxControlMode({ TERM: "xterm-256color" }, boom)).toBe(false);
    // A terminal that named itself and is not iTerm2 — canon's gate, and the reason the vast majority of
    // launches pay nothing for this rung.
    expect(probeTmuxControlMode({ TMUX: "/tmp/t,1,0", TERM_PROGRAM: "vscode", TERM: "xterm-256color" }, boom)).toBe(false);
  });

  it("every failure is a non-verdict, never a throw", () => {
    expect(probeTmuxControlMode(ccEnv, fakeSpawn({ status: 1 }).spawn)).toBe(false);            // stale TMUX, dead socket
    expect(probeTmuxControlMode(ccEnv, fakeSpawn({ status: null }).spawn)).toBe(false);         // timeout, or tmux not on PATH
    expect(probeTmuxControlMode(ccEnv, fakeSpawn({ status: 0, stdout: "" }).spawn)).toBe(false); // no output to parse
    expect(probeTmuxControlMode(ccEnv, (() => { throw new Error("EACCES"); }) as never)).toBe(false);
  });

  it("makeTmuxProbe asks once and answers every later caller from the cache", () => {
    // `/tui` re-walks the whole ladder on a keystroke; without this, each one would spawn.
    const s = fakeSpawn({ status: 0, stdout: "1\n" });
    const probe = makeTmuxProbe(s.spawn);
    expect([probe(ccEnv), probe(ccEnv), probe(ccEnv)]).toEqual([true, true, true]);
    expect(s.calls).toHaveLength(1);
    // …and a `false` verdict is cached too — it is an answer, not the absence of one.
    const n = fakeSpawn({ status: 0, stdout: "0\n" });
    const noProbe = makeTmuxProbe(n.spawn);
    expect([noProbe(ccEnv), noProbe(ccEnv)]).toEqual([false, false]);
    expect(n.calls).toHaveLength(1);
  });
});

describe("prefs.tui", () => {
  const tmpRoot = () => mkdtempSync(join(tmpdir(), "ccx-renderer-prefs-"));
  const write = (root: string, prefs: unknown) => writeFileSync(join(root, "prefs.json"), JSON.stringify(prefs));

  it("loadPrefs keeps the two legal values", () => {
    const root = tmpRoot();
    write(root, { tui: "fullscreen" });
    expect(loadPrefs({ CCX_FLEET_ROOT: root })).toEqual({ tui: "fullscreen" });
    write(root, { tui: "default" });
    expect(loadPrefs({ CCX_FLEET_ROOT: root })).toEqual({ tui: "default" });
  });

  it("loadPrefs drops a hand-edited illegal value silently, leaving the rest of the file intact", () => {
    const root = tmpRoot();
    write(root, { theme: "dark", tui: "alt-screen" });
    expect(loadPrefs({ CCX_FLEET_ROOT: root })).toEqual({ theme: "dark" });
    write(root, { theme: "dark", tui: 1 });
    expect(loadPrefs({ CCX_FLEET_ROOT: root })).toEqual({ theme: "dark" });
  });

  // The dropped key must reach `selectRenderer` as ABSENT, not as a string it will not recognise — otherwise
  // a typo'd settings value would read as "settings said nothing" only by accident of the ladder's shape.
  // Spreading the load over a `tui: "default"` floor is what makes that observable without watching the
  // constant: absent leaves the floor standing (`settings_off`), whereas a surviving `"fullscren"` would
  // overwrite it and fall past the settings rung entirely.
  it("a dropped tui value reaches selectRenderer as absent, not as an unrecognised string", () => {
    const root = tmpRoot();
    write(root, { tui: "fullscren" });
    expect(selectRenderer({ ...settingsFloor, prefs: { ...settingsFloor.prefs, ...loadPrefs({ CCX_FLEET_ROOT: root }) } }))
      .toEqual({ mode: "classic", reason: "settings_off" });
  });
});
