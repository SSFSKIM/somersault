// test/unit/fullscreen-boot.test.ts — FSW Task 9: the boot branch, driven through the real `runChatClient`.
//
// This is the commit where ccx first takes the alternate screen, and the ONE ordering that cannot be got wrong
// is arm-then-paint: `render()` writes Ink's first frame synchronously, so a guard armed after it paints that
// frame onto the main screen and then hides it behind an rmcup. The mirror obligation is that a CLASSIC launch
// — still the default, and every existing test's world — emits not one byte of it.
//
// `writeSync` is mocked because the guard writes to fd 1 DIRECTLY (deliberately: its callers are `process.exit`
// and a dying process, neither of which drains an async queue). Unmocked, this test would put the vitest runner
// itself on the alternate screen and clear the terminal. Only that one export is replaced; the rest of `node:fs`
// — including the `mkdtempSync`/`rmSync` this file uses — is the real module.
import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ENTER_ALT, EXIT_ALT, FOCUS_ON, MOUSE_OFF, MOUSE_ON_FULL } from "../../src/tui/altScreen.js";
import { TMUX_CC_NOTICE } from "../../src/tui/renderer.js";
import { runChatClient } from "../../src/tui/chatMain.js";

const spy = vi.hoisted(() => ({ fd1: [] as string[], renderMark: -1, tree: undefined as any, exit: (() => {}) as () => void,
  // External review, finding 1: the one thing `render()` can do that the boot path never handled.
  renderThrows: undefined as Error | undefined }));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, writeSync: (_fd: number, s: unknown) => { spy.fd1.push(String(s)); return String(s).length; } };
});
vi.mock("ink", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ink")>();
  return {
    ...actual,
    render: (tree: unknown) => {
      spy.tree = tree; spy.renderMark = spy.fd1.length;      // …how many escapes had gone out BEFORE the first paint
      if (spy.renderThrows) throw spy.renderThrows;          // real Ink paints the first frame synchronously — so it can
      return { waitUntilExit: () => new Promise<void>((resolve) => { spy.exit = resolve; }), clear() {}, unmount() {}, cleanup() {}, rerender() {} };
    },
  };
});

/** Run one REPL boot to the point where the tree is mounted, hand the caller the props, then unwind it the way
 *  `/exit` does (settle `waitUntilExit`, let the `finally` run the teardown). Everything the launch reads from
 *  the environment is pinned: an isolated HOME so `loadPrefs` cannot see the developer's own settings, a fake
 *  TTY (`selectRenderer`'s top rung is not-TTY, and under vitest stdout is a pipe), and `process.stdout.write`
 *  stubbed so the terminal-title writer cannot reach the real terminal. */
/*  `renderThrows` makes the mocked `render` fail the way the real one can, and the return value is whatever
 *  `runChatClient` rejected with — so a case can assert both what the terminal got back and what the CALLER
 *  was told. The rejection is adopted on the same tick it is created: an unobserved one would take the runner
 *  down before the teardown assertions ran. */
async function boot(env: Record<string, string | undefined>, use: (props: any) => void, renderThrows?: Error): Promise<unknown> {
  const home = mkdtempSync(join(tmpdir(), "ccx-fsw-t9-"));
  const prior: Record<string, string | undefined> = { HOME: process.env.HOME, CCX_FLEET_ROOT: process.env.CCX_FLEET_ROOT, ...Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]])) };
  process.env.HOME = home; process.env.CCX_FLEET_ROOT = join(home, ".claude", "ccx");
  for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  const priorTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
  const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  spy.fd1 = []; spy.renderMark = -1; spy.tree = undefined; spy.renderThrows = renderThrows;
  let failure: unknown;
  const run = runChatClient({ socketPath: join(home, "s.sock"), client: { kind: "loopback" }, cwd: home, makeSession: () => ({}) as never })
    .then(() => undefined, (e: unknown) => { failure = e; });
  await new Promise((r) => setTimeout(r, 0));
  try { use(spy.tree?.props.children.props); } finally {
    spy.exit();
    await run;
    spy.renderThrows = undefined;
    stdout.mockRestore();
    if (priorTTY) Object.defineProperty(process.stdout, "isTTY", priorTTY); else delete (process.stdout as { isTTY?: boolean }).isTTY;
    for (const [k, v] of Object.entries(prior)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    rmSync(home, { recursive: true, force: true });
  }
  return failure;
}

describe("runChatClient — the fullscreen boot", () => {
  it("arms the alt-screen guard BEFORE the first paint and hands ChatApp the choice", async () => {
    let props: any;
    await boot({ CLAUDE_CODE_NO_FLICKER: "1" }, (p) => { props = p; });
    const enter = spy.fd1.indexOf(ENTER_ALT + MOUSE_ON_FULL + FOCUS_ON);      // I6 — focus reporting rides the same write
    expect(enter).toBeGreaterThanOrEqual(0);                 // the screen was taken…
    expect(enter).toBeLessThan(spy.renderMark);              // …and taken before Ink painted into it
    expect(props.renderer).toEqual({ mode: "fullscreen", reason: "env_on" });
    // The choice reaches /status by the SAME value, so the two surfaces cannot disagree about the mode.
    expect(props.hookOpts.rendererChoice).toEqual(props.renderer);
    // The size chain survives the gating: ChatApp still learns about resizes, it is only the main-screen
    // REPAIR machinery that is not constructed.
    expect(typeof props.onResize).toBe("function");
  });

  it("hands the terminal back on the way out, mouse-off first", async () => {
    await boot({ CLAUDE_CODE_NO_FLICKER: "1" }, () => {});
    const joined = spy.fd1.join("");
    expect(joined).toContain(EXIT_ALT);
    expect(joined.indexOf(MOUSE_OFF)).toBeLessThan(joined.indexOf(EXIT_ALT));
  });

  // EXTERNAL REVIEW, FINDING 1 — THE FIRST PAINT IS INSIDE THE GUARD NOW.
  //
  // The screen is taken one line before `render()`, and `render()` paints Ink's first frame synchronously —
  // so a component that throws on mount takes the throw out through this call. Before the fix that throw ran
  // no teardown at all: the alternate screen stayed entered, the resize/title/signal handlers stayed live, and
  // the error `bin.ts` prints landed on a screen the shell was about to discard. What the user saw was a
  // launch that vanished for no stated reason.
  //
  // Both halves are asserted, because either alone would be satisfied by the wrong fix: the terminal must be
  // handed back (rmcup on the wire), AND the error must still reach the caller rather than being swallowed by
  // the cleanup that now runs first.
  it("hands the screen back and rethrows when the FIRST RENDER throws", async () => {
    const boom = new Error("yoga said no");
    const failure = await boot({ CLAUDE_CODE_NO_FLICKER: "1" }, () => {}, boom);
    expect(failure).toBe(boom);                              // …the caller still learns why it died
    const joined = spy.fd1.join("");
    expect(joined).toContain(ENTER_ALT);                     // the screen really had been taken…
    expect(joined).toContain(EXIT_ALT);                      // …and it really was handed back
    expect(joined.indexOf(ENTER_ALT)).toBeLessThan(joined.indexOf(EXIT_ALT));
    // …in the same order a graceful exit uses, which is what says it went through the ONE teardown rather
    // than a second copy of its bytes written by the error path.
    expect(joined.indexOf(MOUSE_OFF)).toBeLessThan(joined.indexOf(EXIT_ALT));
  });

  // The mirror on the other screen: a classic launch that dies in `render()` owes the terminal nothing but
  // still owes the caller the error — and must not now emit an rmcup for a screen it never took.
  it("a classic launch whose render throws rethrows without touching the screen", async () => {
    const boom = new Error("mount exploded");
    const failure = await boot({ CLAUDE_CODE_NO_FLICKER: undefined, CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN: "1" }, () => {}, boom);
    expect(failure).toBe(boom);
    expect(spy.fd1).toEqual([]);
  });

  it("a classic launch writes nothing to fd 1 and says so on the prop", async () => {
    let props: any;
    await boot({ CLAUDE_CODE_NO_FLICKER: undefined, CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN: "1" }, (p) => { props = p; });
    expect(spy.fd1).toEqual([]);
    expect(props.renderer).toEqual({ mode: "classic", reason: "env_off" });
  });

  // T16 FIX ROUND — THE TMUX RUNG TELLS THE USER IT FIRED. Every other rung on the ladder is one the user
  // asked for: they set the env var, they wrote the settings key, they piped the output. This one is ccx
  // overruling a fullscreen default on their behalf, in a window that gives them no clue why — so the reason
  // word in `/status` is not enough on its own, and canon logs a sentence here too.
  //
  // THE RUNG IS PINNED THROUGH THE CHEAP HEURISTIC, NOT THE SPAWN. This test drives the real `runChatClient`,
  // so a `TMUX` value would reach a real `tmux display-message` on the machine running the suite — a fake
  // socket answers "exit 1, no verdict" and the rung would silently not fire. The three-part env test is the
  // same rung reached without a subprocess, which is what makes this deterministic and keyless.
  it("queues canon's tmux -CC sentence on the notice bridge, exactly once, when the rung fires", async () => {
    let props: any;
    await boot({ CLAUDE_CODE_NO_FLICKER: undefined, CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN: undefined,
                 TMUX: "/tmp/tmux-501/default,1,0", TERM_PROGRAM: "iTerm.app", TERM: "xterm-256color" }, (p) => { props = p; });
    expect(props.renderer).toEqual({ mode: "classic", reason: "tmux_cc_off" });
    // The bridge is what carries text from above the tree into the transcript, and it QUEUES until `useChat`
    // binds — which is the whole reason a boot-time notice can use it at all. Binding here is what a mounted
    // `useChat` does, so this reads exactly what the user would have seen.
    const seen: string[] = [];
    props.noticeBridge.bind((t: string) => seen.push(t));
    expect(seen).toEqual([TMUX_CC_NOTICE]);
    expect(spy.fd1).toEqual([]);                             // …and no alt screen was taken on the way past
  });

  // The mirror, and the one that stops the notice becoming noise: a launch that is classic for any OTHER
  // reason says nothing. `env_off` is the user's own pin — telling them what they just asked for would be the
  // start of a boot banner nobody wants.
  it("says nothing when some other rung chose classic", async () => {
    let props: any;
    await boot({ CLAUDE_CODE_NO_FLICKER: "0", CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN: undefined }, (p) => { props = p; });
    expect(props.renderer).toEqual({ mode: "classic", reason: "env_off" });
    const seen: string[] = [];
    props.noticeBridge.bind((t: string) => seen.push(t));
    expect(seen).toEqual([]);
  });
});
