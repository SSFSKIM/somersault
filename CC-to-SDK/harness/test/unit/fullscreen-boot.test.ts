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
import { ENTER_ALT, EXIT_ALT, MOUSE_OFF } from "../../src/tui/altScreen.js";
import { runChatClient } from "../../src/tui/chatMain.js";

const spy = vi.hoisted(() => ({ fd1: [] as string[], renderMark: -1, tree: undefined as any, exit: (() => {}) as () => void }));

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
      return { waitUntilExit: () => new Promise<void>((resolve) => { spy.exit = resolve; }), clear() {}, unmount() {}, cleanup() {}, rerender() {} };
    },
  };
});

/** Run one REPL boot to the point where the tree is mounted, hand the caller the props, then unwind it the way
 *  `/exit` does (settle `waitUntilExit`, let the `finally` run the teardown). Everything the launch reads from
 *  the environment is pinned: an isolated HOME so `loadPrefs` cannot see the developer's own settings, a fake
 *  TTY (`selectRenderer`'s top rung is not-TTY, and under vitest stdout is a pipe), and `process.stdout.write`
 *  stubbed so the terminal-title writer cannot reach the real terminal. */
async function boot(env: Record<string, string | undefined>, use: (props: any) => void): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), "ccx-fsw-t9-"));
  const prior: Record<string, string | undefined> = { HOME: process.env.HOME, CCX_FLEET_ROOT: process.env.CCX_FLEET_ROOT, ...Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]])) };
  process.env.HOME = home; process.env.CCX_FLEET_ROOT = join(home, ".claude", "ccx");
  for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  const priorTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
  const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  spy.fd1 = []; spy.renderMark = -1; spy.tree = undefined;
  const run = runChatClient({ socketPath: join(home, "s.sock"), client: { kind: "loopback" }, cwd: home, makeSession: () => ({}) as never });
  await new Promise((r) => setTimeout(r, 0));
  try { use(spy.tree.props.children.props); } finally {
    spy.exit();
    await run;
    stdout.mockRestore();
    if (priorTTY) Object.defineProperty(process.stdout, "isTTY", priorTTY); else delete (process.stdout as { isTTY?: boolean }).isTTY;
    for (const [k, v] of Object.entries(prior)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    rmSync(home, { recursive: true, force: true });
  }
}

describe("runChatClient — the fullscreen boot", () => {
  it("arms the alt-screen guard BEFORE the first paint and hands ChatApp the choice", async () => {
    let props: any;
    await boot({ CLAUDE_CODE_NO_FLICKER: "1" }, (p) => { props = p; });
    const enter = spy.fd1.indexOf(ENTER_ALT);
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

  it("a classic launch writes nothing to fd 1 and says so on the prop", async () => {
    let props: any;
    await boot({ CLAUDE_CODE_NO_FLICKER: undefined, CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN: "1" }, (p) => { props = p; });
    expect(spy.fd1).toEqual([]);
    expect(props.renderer).toEqual({ mode: "classic", reason: "env_off" });
  });
});
