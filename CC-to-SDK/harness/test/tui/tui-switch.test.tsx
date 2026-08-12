// test/tui/tui-switch.test.tsx — FSW Task 15: `/tui` swaps the renderer UNDER a live conversation.
//
// The whole task is one claim — the flip is a PROP CHANGE, not a new session — and it has three independent
// halves, each pinned here by the instrument that can actually see it:
//
//   1. THE WRAPPER (T9 hand-off 1). React reconciles by element TYPE at a position, so two branches returning
//      two different root types unmount everything below them on a flip, however stable the children are.
//      `FullscreenFrame` is now the wrapper in both modes, so only its props move — pinned with a mount
//      counter, alongside the contrast case that shows what the old shape did.
//   2. THE COMMAND, through the real `ChatRoot`/`ChatApp`/`useChat` stack: transcript survives both flips,
//      `/status` names the LIVE renderer rather than the boot one (T9 hand-off 2), the pref is written, and a
//      flip is REFUSED while background work is running — in canon's own words, byte-verified below against
//      `~/claude-code-bundle/2.1.220/cli.pretty.js` when it is on this machine.
//   3. THE BYTES, through real Ink (`debug: false`) with the alt-screen guard writing into the SAME recording
//      array, which is the only instrument that can put a guard escape and a paint in one order. Two edges:
//      enter-then-frame going in, exit-then-classic-paint coming out. The I8/I9 hazard rides here too —
//      `fullStaticOutput` is never reset (ink.js:57), so the only thing standing between a fullscreen session
//      and a replay of its classic scrollback is that the fixed frame never takes Ink's tall branch.
import React, { useEffect } from "react";
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { render } from "ink-testing-library";
import { Box, Text } from "ink";
import { renderWithKeymap } from "./keysTestUtil.js";
import { renderRealInk, TALL_HEAD } from "./helpers/fakeTty.js";
import { KeymapProvider } from "../../src/tui/keys/KeymapProvider.js";
import { fakeRemote } from "./helpers/fakeRemote.js";
import { FullscreenFrame } from "../../src/tui/FullscreenFrame.js";
import { ChatRoot, createRendererSwitch } from "../../src/tui/chatMain.js";
import { createAltScreenGuard, ENTER_ALT, EXIT_ALT, PASTE_OFF } from "../../src/tui/altScreen.js";
import { TUI_BUSY_REFUSAL, tuiUsageLine } from "../../src/tui/commands.js";
import type { RendererChoice } from "../../src/tui/renderer.js";
import type { TranscriptBootstrapEntry } from "../../src/tui/transcriptModel.js";

const strip = (s: string): string => s.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "");
const text = (f: () => string | undefined): string => strip(f() ?? "").replace(/\s+/g, " ");
const lines = (f: () => string | undefined): string[] => strip(f() ?? "").replace(/\s+$/, "").split("\n");
async function waitFor(cond: () => boolean, timeout = 3000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (cond()) { await new Promise((r) => setTimeout(r, 0)); return; }
    if (Date.now() - start > timeout) throw new Error("waitFor timeout");
    await new Promise((r) => setTimeout(r, 5));
  }
}
const tick = (ms = 30): Promise<void> => new Promise((r) => { setTimeout(r, ms); });

// ── 1. The wrapper ───────────────────────────────────────────────────────────────────────────────────────
let mounts: string[] = [];
function MountProbe({ tag }: { tag: string }) {
  useEffect(() => { mounts.push(tag); }, []);
  return <Text>{tag}</Text>;
}

describe("the frame is the wrapper in BOTH modes", () => {
  it("a live flip re-props it — the region and the dock are NOT remounted", async () => {
    mounts = [];
    const tree = (mode: "classic" | "fullscreen") => (
      <FullscreenFrame mode={mode} rows={24} regionChildren={<MountProbe tag="region" />} dock={<MountProbe tag="dock" />} />
    );
    const r = render(tree("classic"));
    await tick();
    expect(mounts).toEqual(["region", "dock"]);
    r.rerender(tree("fullscreen"));
    await tick();
    expect(mounts).toEqual(["region", "dock"]);          // …and nothing below the seam was born again
    expect(lines(r.lastFrame)).toHaveLength(23);         // the fullscreen arm is bounded: rows − 1
    r.rerender(tree("classic"));
    await tick();
    expect(mounts).toEqual(["region", "dock"]);
    expect(lines(r.lastFrame)).toHaveLength(2);          // …and the classic arm is unbounded: content height
    r.unmount();
  });

  it("the shape T9 warned about — a different ROOT TYPE — does remount everything below it", async () => {
    mounts = [];
    const r = render(<Box flexDirection="column"><MountProbe tag="region" /><MountProbe tag="dock" /></Box>);
    await tick();
    expect(mounts).toEqual(["region", "dock"]);
    r.rerender(<FullscreenFrame rows={24} regionChildren={<MountProbe tag="region" />} dock={<MountProbe tag="dock" />} />);
    await tick();
    expect(mounts).toEqual(["region", "dock", "region", "dock"]);
    r.unmount();
  });
});

// ── 2. The command ───────────────────────────────────────────────────────────────────────────────────────
const CLASSIC: RendererChoice = { mode: "classic", reason: "default_off" };

/** The real `createRendererSwitch`, over a guard that records instead of writing, so a test can read both the
 *  ordering of the guard's calls and the bytes they would have produced. `unmount` is `runChatClient`'s own
 *  dependency (canon `zuy`'s limb — it ENDS the process's renderer), wired here as a counter for the reason
 *  the case below spends an assertion on it. */
function harnessSwitch(sink: string[] = []) {
  const unmounts: number[] = [];
  const guard = createAltScreenGuard({ writeSync: (s) => { sink.push(s); }, unmount: () => { unmounts.push(1); } });
  const live = { mode: CLASSIC.mode };
  return { sink, guard, live, unmounts, rendererSwitch: createRendererSwitch({ prefs: {}, isTTY: true, env: {}, guard, live }) };
}

function mountRepl(opts: { entries?: readonly TranscriptBootstrapEntry[] } = {}) {
  const saved: Record<string, unknown>[] = [];
  const h = harnessSwitch();
  const session = fakeRemote();
  const r = renderWithKeymap(
    <ChatRoot rendererSwitch={h.rendererSwitch} makeSession={() => session} client={{ kind: "loopback" }}
      cwd={process.cwd()} renderer={CLASSIC} hookOpts={{ rendererChoice: CLASSIC }}
      {...(opts.entries ? { initialEntries: opts.entries } : {})}
      deps={{ rows: () => 24, columns: () => 80, savePrefs: (p) => { saved.push(p as Record<string, unknown>); }, env: {} }} />);
  return { ...r, ...h, saved, session };
}

async function runSlash(stdin: { write: (s: string) => void }, lastFrame: () => string | undefined, cmd: string): Promise<void> {
  stdin.write(cmd);
  await waitFor(() => text(lastFrame).includes(cmd));
  stdin.write("\r");
  await tick(60);
}

describe("/tui — the live flip", () => {
  it("flips both ways with the conversation intact, and writes the pref each time", async () => {
    const { stdin, lastFrame, saved, sink, unmounts, unmount } = mountRepl();
    await tick();
    stdin.write("hello-transcript");
    await waitFor(() => text(lastFrame).includes("hello-transcript"));
    stdin.write("\r");
    await waitFor(() => text(lastFrame).includes("ok"));

    await runSlash(stdin, lastFrame, "/tui fullscreen");
    expect(lines(lastFrame)).toHaveLength(23);                        // the bounded frame is up…
    expect(text(lastFrame)).toContain("hello-transcript");            // …over the same conversation
    expect(saved).toEqual([{ tui: "fullscreen" }]);
    expect(sink.join("")).toContain(ENTER_ALT);

    await runSlash(stdin, lastFrame, "/tui default");
    expect(lines(lastFrame).length).toBeLessThan(23);
    expect(text(lastFrame)).toContain("hello-transcript");
    expect(saved).toEqual([{ tui: "fullscreen" }, { tui: "default" }]);
    expect(sink.join("")).toContain(EXIT_ALT);
    // …and LEAVING IS NOT EXITING, which is the whole difference between `guard.leave()` and `guard.exit()`
    // and is invisible in the rmcup they share. `exit()` runs canon `zuy`'s unmount limb — it would end the
    // renderer the flip exists to preserve — and resets bracketed paste, which the keymap provider armed on
    // mount and will not re-arm until it remounts, so every later paste would arrive as literal `200~…`.
    expect(unmounts).toEqual([]);
    expect(sink.join("")).not.toContain(PASTE_OFF);
    unmount();
  });

  it("/status reports the renderer in force NOW, not the one the session booted on", async () => {
    const { stdin, lastFrame, unmount } = mountRepl();
    await tick();
    await runSlash(stdin, lastFrame, "/status");
    expect(text(lastFrame)).toContain("renderer classic (default_off)");
    await runSlash(stdin, lastFrame, "/tui fullscreen");
    await runSlash(stdin, lastFrame, "/status");
    await waitFor(() => text(lastFrame).includes("renderer fullscreen"));
    expect(text(lastFrame)).toContain("renderer fullscreen (settings_on)");
    unmount();
  });

  it("refuses while background work is running, saves nothing and takes no screen", async () => {
    const { stdin, lastFrame, saved, sink, session, unmount } = mountRepl();
    await tick();
    session.pushEvent({ kind: "tasks_changed", tasks: [{ taskId: "t1", status: "running", description: "build" } as never] });
    await tick();
    await runSlash(stdin, lastFrame, "/tui fullscreen");
    expect(text(lastFrame)).toContain(strip(TUI_BUSY_REFUSAL).replace(/\s+/g, " "));
    expect(saved).toEqual([]);
    expect(sink).toEqual([]);
    unmount();
  });

  it("prints canon's usage for a bare or unknown argument and changes nothing", async () => {
    const { stdin, lastFrame, saved, unmount } = mountRepl();
    await tick();
    await runSlash(stdin, lastFrame, "/tui");
    expect(text(lastFrame)).toContain(`Current renderer: default. ${tuiUsageLine()}`);
    await runSlash(stdin, lastFrame, "/tui sideways");
    expect(text(lastFrame)).toContain(`Unknown renderer "sideways". ${tuiUsageLine()}`);
    expect(saved).toEqual([]);
    unmount();
  });

  it("the refusal is canon's copy, byte for byte (bundle L482603)", () => {
    const bundle = join(homedir(), "claude-code-bundle", "2.1.220", "cli.pretty.js");
    if (!existsSync(bundle)) return;                                  // not on this machine; the cite stands
    // The bundle spells its em dash `—`; decode that one escape and the two strings are the same bytes.
    const line = (readFileSync(bundle, "utf8").split("\n")[482602] ?? "").replace(/\\u2014/g, "—");
    expect(line).toContain(`e(${JSON.stringify(TUI_BUSY_REFUSAL)}, { display: "system" })`);
  });
});

// ── 3. The bytes ─────────────────────────────────────────────────────────────────────────────────────────
/** The same sixty-row corpus `fullscreen-frame.test.tsx` uses, and for the same reason: sixty rows is enough
 *  to reach `state.staticItems`, which is the only input that puts a `<Static>` on the classic screen. */
const alphaEntries = (n: number): TranscriptBootstrapEntry[] =>
  Array.from({ length: n }, (_, i) => ({
    kind: "sdk" as const, source: "disk" as const,
    message: { type: "assistant", parent_tool_use_id: null, uuid: `u-${i}`, message: { id: `m-${i}`, content: [{ type: "text", text: `ALPHA-${i}` }] } },
  }));
/** How many rows a written chunk paints — the frame is `str + "\n"` (log-update.js:12). */
const paintedRows = (chunk: string): number => (chunk.match(/\n/g) ?? []).length;

describe("/tui — the guard brackets the paints", () => {
  it("enters BEFORE the first fullscreen frame and exits BEFORE the first classic paint", async () => {
    let tty: ReturnType<typeof renderRealInk> | undefined;
    const guard = createAltScreenGuard({ writeSync: (s) => { tty!.stdout.writes.push(s); } });
    const live = { mode: CLASSIC.mode };
    const rendererSwitch = createRendererSwitch({ prefs: {}, isTTY: true, env: {}, guard, live });
    const session = fakeRemote();
    tty = renderRealInk(
      <KeymapProvider>
        <ChatRoot rendererSwitch={rendererSwitch} makeSession={() => session} client={{ kind: "loopback" }}
          cwd={process.cwd()} renderer={CLASSIC} hookOpts={{ rendererChoice: CLASSIC }}
          initialEntries={alphaEntries(60)}
          deps={{ rows: () => 24, columns: () => 80, savePrefs: () => {}, env: {} }} />
      </KeymapProvider>, { columns: 80, rows: 24 });
    await tick(80);

    // ── classic → fullscreen ──
    const writes = tty.stdout.writes;
    const markIn = writes.length;
    tty.stdin.write("/tui fullscreen");
    await tick(60);
    tty.stdin.write("\r");
    await tick(120);
    const enter = writes.indexOf(ENTER_ALT, markIn);
    const firstFrame = writes.findIndex((w, i) => i > markIn && paintedRows(w) >= 20);
    expect(enter).toBeGreaterThanOrEqual(0);
    expect(firstFrame).toBeGreaterThan(enter);
    // I8/I9 — the committed transcript is NEVER replayed onto the alternate screen. It rests entirely on the
    // fixed frame never taking Ink's tall branch: `fullStaticOutput` still holds every ALPHA row and there is
    // no way to clear it.
    expect(writes.slice(markIn).join("")).not.toContain("ALPHA-0");
    // …and the branch that would have replayed it never ran. `tallWritesSince` cannot be used here: it looks
    // for `\x1b[2J` ANYWHERE in a chunk and the guard's own smcup carries one, so the tall head is matched
    // where Ink puts it — at position 0 of `clearTerminal + fullStaticOutput + output` (ink.js:122).
    expect(writes.slice(markIn).filter((w) => w.startsWith(TALL_HEAD))).toEqual([]);

    // ── fullscreen → classic ──
    const markOut = writes.length;
    tty.stdin.write("/tui default");
    await tick(60);
    tty.stdin.write("\r");
    await tick(120);
    const exit = writes.indexOf(EXIT_ALT, markOut);
    const firstClassic = writes.findIndex((w, i) => i > markOut && w.includes("ALPHA-0"));
    expect(exit).toBeGreaterThanOrEqual(0);
    expect(firstClassic).toBeGreaterThan(exit);            // nothing classic painted while we still held the screen
    tty.unmount();
  }, 20000);
});
