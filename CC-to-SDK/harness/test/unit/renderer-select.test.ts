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
import { DEFAULT_ON, selectRenderer } from "../../src/tui/renderer.js";
import { loadPrefs } from "../../src/tui/prefs.js";
import type { CcxPrefs } from "../../src/tui/prefs.js";

/** A launch with every lever pushed toward FULLSCREEN below the rung under test: env force-on, settings
 *  force-on, a TTY. Each order test starts from this and adds exactly the one input it is pinning, so a
 *  `classic` verdict can only have come from that input outranking the ones already here. */
const forcedOn = { isTTY: true, env: { CLAUDE_CODE_NO_FLICKER: "1" } as NodeJS.ProcessEnv, prefs: { tui: "fullscreen" } as CcxPrefs, platform: "darwin" as NodeJS.Platform };
/** The mirror: nothing set anywhere, a real TTY, so the ladder falls all the way through to the constant. */
const bare = { isTTY: true, env: {} as NodeJS.ProcessEnv, prefs: {} as CcxPrefs, platform: "darwin" as NodeJS.Platform };

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

  it("tmux_cc_off needs all three parts — no shell-out means each one alone must falsify it", () => {
    // No TMUX at all: iTerm2 on its own is not control mode.
    expect(selectRenderer({ ...bare, env: { TERM_PROGRAM: "iTerm.app", TERM: "xterm-256color" } })).toEqual({ mode: "classic", reason: "default_off" });
    // tmux under a terminal that is not iTerm2: `-CC` is an iTerm2 integration, so nothing to avoid.
    expect(selectRenderer({ ...bare, env: { TMUX: "/tmp/tmux-501/default,1,0", TERM_PROGRAM: "Apple_Terminal", TERM: "xterm-256color" } }))
      .toEqual({ mode: "classic", reason: "default_off" });
    // A `screen*`/`tmux*` TERM means the client is a REAL tmux pane, i.e. not the -CC passthrough window.
    expect(selectRenderer({ ...bare, env: { TMUX: "/tmp/tmux-501/default,1,0", TERM_PROGRAM: "iTerm.app", TERM: "screen-256color" } }))
      .toEqual({ mode: "classic", reason: "default_off" });
    expect(selectRenderer({ ...bare, env: { TMUX: "/tmp/tmux-501/default,1,0", TERM_PROGRAM: "iTerm.app", TERM: "tmux-256color" } }))
      .toEqual({ mode: "classic", reason: "default_off" });
  });

  it("win_ssh_off needs BOTH Windows and an SSH marker, beats settings, and loses to tmux_cc_off", () => {
    for (const marker of ["SSH_CONNECTION", "SSH_CLIENT", "SSH_TTY"])
      expect(selectRenderer({ ...bare, platform: "win32", env: { [marker]: "yes" } })).toEqual({ mode: "classic", reason: "win_ssh_off" });
    // Windows with no SSH, and SSH from a non-Windows box: neither is the ConPTY re-rendering case.
    expect(selectRenderer({ ...bare, platform: "win32", env: {} })).toEqual({ mode: "classic", reason: "default_off" });
    expect(selectRenderer({ ...bare, platform: "linux", env: { SSH_CONNECTION: "yes" } })).toEqual({ mode: "classic", reason: "default_off" });
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

  // THE M2a SHIPPABILITY GATE. The wave ships behind a knob that is OFF, and Task 16 flips this one constant
  // and nothing else. Both halves are literal: the constant is `false`, and an unconfigured TTY launch says so.
  it("DEFAULT_ON is false today, so a bare TTY launch lands classic with reason default_off", () => {
    expect(DEFAULT_ON).toBe(false);
    expect(selectRenderer(bare)).toEqual({ mode: "classic", reason: "default_off" });
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
  it("a dropped tui value falls through to the default rung", () => {
    const root = tmpRoot();
    write(root, { tui: "fullscren" });
    expect(selectRenderer({ ...bare, prefs: loadPrefs({ CCX_FLEET_ROOT: root }) })).toEqual({ mode: "classic", reason: "default_off" });
  });
});
