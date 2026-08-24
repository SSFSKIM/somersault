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
import React, { useEffect, useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
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
import { ChatApp } from "../../src/tui/ChatApp.js";
import { useChat } from "../../src/tui/useChat.js";
import { ChatRoot, createRendererSwitch, createResumeSafeStdout, type ResumeSafeStdout } from "../../src/tui/chatMain.js";
import { createAltScreenGuard, ENTER_ALT, EXIT_ALT, FOCUS_ON, MOUSE_ON_FULL, PASTE_OFF } from "../../src/tui/altScreen.js";
import { TUI_BUSY_REFUSAL, tuiUsageLine } from "../../src/tui/commands.js";
import type { RendererChoice } from "../../src/tui/renderer.js";
import type { RenderItem } from "../../src/tui/toolRenderer.js";
import type { TranscriptBootstrapEntry } from "../../src/tui/transcriptModel.js";

/** T17 FIX ROUND — THE LIFETIME OF INK'S `<Static>`, WHICH IS NOT OBSERVABLE FROM THE PAINT.
 *
 *  Ink caches the `<Static>` box on its root node and never clears the reference (`reconciler.js:154`), while
 *  unmounting that box FREES its Yoga node (`cleanupYogaNode` → `freeRecursive`). Every later frame then reads
 *  a freed WASM node in `renderer.js:11-14` — which usually returns another node's garbage and occasionally
 *  faults out of bounds, killing the process from inside a debounced render. Nothing in the bytes distinguishes
 *  the two, and the fault is not deterministic, so what is pinned here is the CONDITION: the component that
 *  owns the `<Static>` is never unmounted by a flip, and therefore the dangling reference has no window to
 *  open in. Counted through the real `Transcript`, wrapped rather than replaced. */
/*  Identities rather than counters, because React's unmount cleanup is scheduled and a previous case's
 *  teardown lands inside the next one — a shared pair of totals reads that as this case's unmount. */
const staticProbe = vi.hoisted(() => ({ born: [] as number[], live: new Set<number>() }));
vi.mock("../../src/tui/Transcript.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/tui/Transcript.js")>();
  const Counted = (props: React.ComponentProps<typeof actual.Transcript>) => {
    React.useEffect(() => {
      const id = staticProbe.born.length;
      staticProbe.born.push(id); staticProbe.live.add(id);
      return () => { staticProbe.live.delete(id); };
    }, []);
    return React.createElement(actual.Transcript, props);
  };
  return { ...actual, Transcript: Counted };
});

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
const FULLSCREEN: RendererChoice = { mode: "fullscreen", reason: "settings_on" };

/** The real `createRendererSwitch`, over a guard that records instead of writing, so a test can read both the
 *  ordering of the guard's calls and the bytes they would have produced. `unmount` is `runChatClient`'s own
 *  dependency (canon `zuy`'s limb — it ENDS the process's renderer), wired here as a counter for the reason
 *  the case below spends an assertion on it.
 *    THE THIRD SIDE EFFECT IS A MARKER IN THE SAME ARRAY (fix round C1). `ink-testing-library` paints into a
 *  string rather than a terminal, so there is no output proxy in this instrument's loop — but the ORDER of
 *  the screen-debt hand-over against the guard's escape is exactly what the fix is about, so the announcement
 *  is recorded where the escapes are. The byte harness below runs the real proxy instead. */
function harnessSwitch(sink: string[] = [], env: NodeJS.ProcessEnv = {}) {
  const unmounts: number[] = [];
  const guard = createAltScreenGuard({ writeSync: (s) => { sink.push(s); }, unmount: () => { unmounts.push(1); } });
  const live = { mode: CLASSIC.mode };
  const output = { noteScreenChange: (to: "alt" | "main") => { sink.push(`<screen:${to}>`); } };
  return { sink, guard, live, unmounts, rendererSwitch: createRendererSwitch({ prefs: {}, isTTY: true, env, guard, live, output }) };
}

/** `env` is the LADDER's environment, not `useChat`'s: it is what decides which rung answers a `/tui`, which
 *  is the whole subject of the forced-rung case below. */
function mountRepl(opts: { entries?: readonly TranscriptBootstrapEntry[]; env?: NodeJS.ProcessEnv } = {}) {
  const saved: Record<string, unknown>[] = [];
  const h = harnessSwitch([], opts.env ?? {});
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
    // …and on BOTH edges the screen's outstanding erase moved before the escape that changes the screen did
    // (fix round C1). Behind rmcup it would be too late: the debt is spent on the terminal, not on the guard.
    expect(sink.indexOf("<screen:alt>")).toBeLessThan(sink.indexOf(ENTER_ALT + MOUSE_ON_FULL + FOCUS_ON));
    expect(sink.indexOf("<screen:main>")).toBeLessThan(sink.indexOf(EXIT_ALT));
    // …and LEAVING IS NOT EXITING, which is the whole difference between `guard.leave()` and `guard.exit()`
    // and is invisible in the rmcup they share. `exit()` runs canon `zuy`'s unmount limb — it would end the
    // renderer the flip exists to preserve — and resets bracketed paste, which the keymap provider armed on
    // mount and will not re-arm until it remounts, so every later paste would arrive as literal `200~…`.
    expect(unmounts).toEqual([]);
    expect(sink.join("")).not.toContain(PASTE_OFF);
    unmount();
  });

  // T17 FIX ROUND, FINDING 2 — the crash `/tui fullscreen` reproduced 2 of 6 times. See `staticProbe` above
  // for the mechanism and for why the fault itself cannot be asserted; the condition can, and this is it.
  // Three flips, a transcript long enough to have committed rows, and the `<Static>` is born exactly once.
  it("never unmounts the <Static>, so a flip cannot leave Ink reading a freed yoga node", async () => {
    const before = staticProbe.born.length;
    const { stdin, lastFrame, unmount } = mountRepl({ entries: alphaEntries(60) });
    await tick();
    const mine = staticProbe.born.slice(before);
    expect(mine).toHaveLength(1);
    await runSlash(stdin, lastFrame, "/tui fullscreen");
    await runSlash(stdin, lastFrame, "/tui default");
    await runSlash(stdin, lastFrame, "/tui fullscreen");
    expect(text(lastFrame)).toContain("ALPHA-59");                    // …the conversation survived all three
    expect(staticProbe.live.has(mine[0]!)).toBe(true);                // never unmounted…
    expect(staticProbe.born.slice(before)).toEqual(mine);             // …and therefore never reborn
    unmount();
  }, 20000);

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

  // EXTERNAL REVIEW, FINDING 3 — A REFUSAL IS OWED ONLY WHERE THERE IS A TRANSITION TO REFUSE.
  //
  // A rung ABOVE the settings rung — a screen reader, `CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN`, tmux `-CC`,
  // Windows over SSH — holds the mode down whatever the setting says. `/tui fullscreen` there moves no screen
  // at all, so background work is no reason to decline it, and the old gate (requested SETTING vs LIVE mode)
  // declined it anyway: the user got advice to wait for a task before a flip that could never happen, and the
  // `break` took the pref write with it, so the setting they meant for their NEXT launch was dropped too.
  it("does not refuse a request an env rung has already overruled — and still saves the pref", async () => {
    const { stdin, lastFrame, saved, sink, session, unmount } = mountRepl({ env: { CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN: "1" } });
    await tick();
    session.pushEvent({ kind: "tasks_changed", tasks: [{ taskId: "t1", status: "running", description: "build" } as never] });
    await tick();
    await runSlash(stdin, lastFrame, "/tui fullscreen");
    expect(text(lastFrame)).not.toContain(strip(TUI_BUSY_REFUSAL).replace(/\s+/g, " "));
    // …and what it says instead is the overruled outcome, naming the rung that won — the same reason word
    // `/status` prints, so a user who sees this can go and look it up.
    expect(text(lastFrame)).toContain("Saved. The fullscreen renderer does not apply here (env_off).");
    expect(saved).toEqual([{ tui: "fullscreen" }]);
    expect(sink).toEqual([]);                                          // no screen was taken; there was none to take
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

  // T16 review, minor 6 — THE PROBE IS THREADED, NOT RE-MADE. `runChatClient` builds one cached probe at boot
  // and hands it here so `/tui` never spawns a subprocess on a keystroke. Nothing above pins that the dep
  // actually reaches `selectRenderer`: a `createRendererSwitch` that dropped it would still return a choice,
  // just one that had asked a real tmux. Counting the calls is what says it went in.
  it("threads its injected tmuxProbe into the ladder, once per select", () => {
    let asked = 0;
    const guard = createAltScreenGuard({ writeSync: () => {} });
    const rendererSwitch = createRendererSwitch({ prefs: {}, isTTY: true, env: { TMUX: "/tmp/t,1,0" }, guard,
      live: { mode: "classic" as const }, output: { noteScreenChange: () => {} }, tmuxProbe: () => { asked++; return true; } });
    expect(rendererSwitch.select("fullscreen")).toEqual({ mode: "classic", reason: "tmux_cc_off" });
    expect(asked).toBe(1);
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
/** How many rows a chunk's leading erase run SPENDS. A prefix with no `\x1b[2K` is somebody homing a cursor,
 *  not log-update erasing rows, so it spends none — and `eraseLines(0)` is the empty string, i.e. also none. */
const eraseRows = (chunk: string): number => {
  const prefix = chunk.match(/^(?:\x1b\[2K|\x1b\[1A|\x1b\[G)+/)?.[0] ?? "";
  return prefix.includes("\x1b[2K") ? (prefix.match(/\x1b\[1A/g)?.length ?? 0) + 1 : 0;
};
/** Every chunk from a boundary up to and including the first one that PAINTS. That write is where the depth
 *  question lives and where it stops: log-update re-derives its counter from whatever it just painted, so
 *  every erase behind that write is a fact about the screen we are now on. */
const untilFirstPaint = (writes: readonly string[], from: number): string[] => {
  const run: string[] = [];
  for (let i = from; i < writes.length; i++) { run.push(writes[i]!); if (writes[i]!.includes("\n")) break; }
  return run;
};
const occurrences = (haystack: string, needle: string): number => haystack.split(needle).length - 1;
const streamDelta = (text: string) =>
  ({ kind: "message" as const, data: { type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } } } });

/** THE WHOLE PRODUCTION STACK FOR ONE FLIP, and the only arrangement in which the question can be asked.
 *  Real Ink with `debug: false` (so the tall branch is reachable), the REAL output proxy between it and the
 *  terminal (so log-update's erase prefixes pass through the code that owns them), and the guard writing its
 *  escapes into the SAME array — which is what gives an rmcup and an erase an order to be wrong about. */
function mountBytes(opts: { renderer?: RendererChoice; entries?: readonly TranscriptBootstrapEntry[]; session?: ReturnType<typeof fakeRemote>; rows?: number } = {}) {
  const boot = opts.renderer ?? CLASSIC;
  const session = opts.session ?? fakeRemote();
  const rows = opts.rows ?? 24;
  // The guard's sink is a variable, not a value: `runChatClient` takes the screen BEFORE it renders, so the
  // boot `enter()` has nowhere to write yet. From the render on, the two streams share one array in order.
  let sink: string[] = [];
  let out: ResumeSafeStdout | undefined;
  const guard = createAltScreenGuard({ writeSync: (s) => { sink.push(s); } });
  const live = { mode: boot.mode };
  const rendererSwitch = createRendererSwitch({ prefs: {}, isTTY: true, env: {}, guard, live,
    output: { noteScreenChange: (to) => out!.noteScreenChange(to) } });
  if (boot.mode === "fullscreen") guard.enter();
  const tty = renderRealInk(
    <KeymapProvider>
      <ChatRoot rendererSwitch={rendererSwitch} makeSession={() => session} client={{ kind: "loopback" }}
        cwd={process.cwd()} renderer={boot} hookOpts={{ rendererChoice: boot }}
        {...(opts.entries ? { initialEntries: opts.entries } : {})}
        deps={{ rows: () => rows, columns: () => 80, savePrefs: () => {}, env: {} }} />
    </KeymapProvider>,
    { columns: 80, rows, wrap: (raw) => { out = createResumeSafeStdout(raw, { altMode: () => live.mode === "fullscreen" }); return out.stdout; } });
  sink = tty.stdout.writes;
  return { tty, guard, live, session, writes: tty.stdout.writes };
}

async function typeSlash(tty: { stdin: { write: (s: string) => void } }, cmd: string): Promise<void> {
  tty.stdin.write(cmd);
  await tick(60);
  tty.stdin.write("\r");
  await tick(140);
}

describe("/tui — the guard brackets the paints", () => {
  it("enters BEFORE the first fullscreen frame and exits BEFORE the first classic paint", async () => {
    const { tty, writes } = mountBytes({ entries: alphaEntries(60) });
    await tick(80);

    // ── classic → fullscreen ──
    const markIn = writes.length;
    await typeSlash(tty, "/tui fullscreen");
    const enter = writes.indexOf(ENTER_ALT + MOUSE_ON_FULL + FOCUS_ON, markIn);
    const firstFrame = writes.findIndex((w, i) => i > markIn && paintedRows(w) >= 20);
    expect(enter).toBeGreaterThanOrEqual(0);
    expect(firstFrame).toBeGreaterThan(enter);
    // …AND THE FIRST THING ONTO THE ALTERNATE SCREEN ERASES NOTHING (fix round C1). `ENTER_ALT` ends in
    // `2J`+`H`, so log-update's carried-over classic count used to run against a blank screen at home and got
    // away with it. That was luck, and luck is not a contract: the screen we just cleared owes nobody rows.
    for (const w of untilFirstPaint(writes, enter + 1)) expect(eraseRows(w)).toBe(0);
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
    await typeSlash(tty, "/tui default");
    const exit = writes.indexOf(EXIT_ALT, markOut);
    const firstClassic = writes.findIndex((w, i) => i > markOut && w.includes("ALPHA-0"));
    expect(exit).toBeGreaterThanOrEqual(0);
    expect(firstClassic).toBeGreaterThan(exit);            // nothing classic painted while we still held the screen
    // THE DEPTH, NOT ONLY THE ORDER (fix round C1). `1049l` restores the main buffer and the cursor it saved,
    // so the rows the last classic frame painted are the whole of what the next erase is entitled to take.
    // Unclamped this was log-update's FULLSCREEN count — 24 rows of somebody else's screen at a 24-row
    // terminal — written after rmcup, onto rows this process never repaints.
    // log-update's own arithmetic for the frame it last put on the main screen: `output.split("\n").length`,
    // which keeps the empty tail after the newline it appends — i.e. the painted rows plus one.
    const classicOwed = paintedRows([...writes.slice(0, markIn)].reverse().find((w) => w.includes("\n")) ?? "") + 1;
    const run = untilFirstPaint(writes, exit + 1);
    expect(run.length).toBeGreaterThan(0);
    for (const w of run) expect(eraseRows(w)).toBeLessThanOrEqual(classicOwed);
    // …AND THE REPLAY THAT FOLLOWS IT REPLACES RATHER THAN DUPLICATES (fix round I2). The region's element
    // type changes on a flip, so the classic `<Static>` really is reborn and the committed conversation
    // really is rewritten — deliberate, canon-shaped, argued at ChatApp's region seam. What would NOT be
    // acceptable is a second copy of it in the same scrollback.
    expect(occurrences(writes.slice(markOut).join(""), "ALPHA-0")).toBe(1);
    tty.unmount();
  }, 20000);

  // THE MEASURED CASE, exactly as the review found it: a session that BOOTS fullscreen has never painted a
  // row of the main screen, so the erase log-update carries out through rmcup is spent entirely on the user's
  // shell — 24 rows asked for, sixteen destroyed behind an 8-row frame, none of them ever repainted.
  it("a fullscreen-booted session hands the shell back without erasing a row of it", async () => {
    const { tty, writes } = mountBytes({ renderer: FULLSCREEN });
    await tick(80);
    const mark = writes.length;
    await typeSlash(tty, "/tui default");
    const exit = writes.indexOf(EXIT_ALT, mark);
    expect(exit).toBeGreaterThanOrEqual(0);
    const run = untilFirstPaint(writes, exit + 1);
    expect(run.length).toBeGreaterThan(0);
    for (const w of run) expect(eraseRows(w)).toBe(0);
    tty.unmount();
  }, 20000);

  // THE MID-STREAM FLIP (fix round, reviewer's recommendation). A turn in flight is the state in which the
  // renderer and the screen have the most to disagree about: rows are arriving from the host while the
  // surface underneath them is being replaced. Nothing about the depth rule bends for it, and the turn keeps
  // rendering on the far side.
  it("flips mid-turn: no full-height erase after rmcup, and the stream keeps painting", async () => {
    const session = fakeRemote();
    const { tty, writes } = mountBytes({ renderer: FULLSCREEN, session });
    await tick(80);
    session.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    session.pushEvent({ kind: "message", data: { type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } } });
    session.pushEvent(streamDelta("STREAMTAIL"));
    await waitFor(() => writes.join("").includes("STREAMTAIL"));
    const markAlt = writes.length;
    await typeSlash(tty, "/tui default");
    const exit = writes.indexOf(EXIT_ALT, markAlt);
    expect(exit).toBeGreaterThanOrEqual(0);
    const run = untilFirstPaint(writes, exit + 1);
    expect(run.length).toBeGreaterThan(0);
    for (const w of run) expect(eraseRows(w)).toBe(0);
    expect(writes.slice(0, markAlt).join("")).toContain("STREAMTAIL");   // it was on the alternate screen…
    expect(writes.slice(exit).join("")).toContain("STREAMTAIL");         // …and it is on the main one
    session.pushEvent(streamDelta(" AND-MORE"));
    await waitFor(() => writes.slice(exit).join("").includes("AND-MORE"));   // …and the turn is still live
    tty.unmount();
  }, 20000);
});

// ── 4. The dock survives, through the real tree ──────────────────────────────────────────────────────────
// The mount counter in section 1 is a synthetic tree, and section 3 proves the REGION really does remount —
// its element type changes, which is the whole of the `<Static>` replay above. So the half that must not
// remount is worth pinning on the real thing, in the state a user would notice losing: a half-typed message
// with the cursor sitting inside it.
//
// THE FLIP IS A PROP MOVE HERE, NOT A TYPED COMMAND, and that is forced rather than convenient: `/tui` is
// typed INTO the composer and submitting it necessarily empties the draft, so no route through the command
// can ever leave one standing. The prop move is exactly what `ChatRoot`'s `setChoice` performs one line
// later — same element, same position, same reconciliation — so this asks the question the command cannot.
describe("the dock survives both flips, through the real tree", () => {
  const session = () => fakeRemote();
  const app = (renderer: RendererChoice, s: ReturnType<typeof fakeRemote>) => (
    <ChatApp makeSession={() => s} client={{ kind: "loopback" }} cwd={process.cwd()}
      renderer={renderer} hookOpts={{ rendererChoice: renderer }}
      deps={{ rows: () => 24, columns: () => 80, env: {} }} />);

  // THE USER-VISIBLE GUARANTEE, and it is worth pinning on its own terms even though it is NOT by itself
  // evidence about mounting: the editor's buffer is APP-scoped (`editorStateRef`, ChatComposer:403's
  // seed-on-remount rule), so a draft outlives a composer remount by design. What it would not outlive is the
  // frame's whole subtree being reconciled against a different element — which is what T9 hand-off 1 is about.
  it("keeps the draft text and the cursor across fullscreen → default → fullscreen", async () => {
    const s = session();
    const r = renderWithKeymap(app(FULLSCREEN, s));
    await tick();
    r.stdin.write("hello world");
    await waitFor(() => text(r.lastFrame).includes("hello world"));
    for (let i = 0; i < 5; i++) r.stdin.write("\x1b[D");                 // ← ×5: the cursor lands on the `w`
    await tick();
    // The block cursor is an inverse-video cell (`\x1b[7m…\x1b[27m`), so the RAW frame is the only place the
    // caret's position is legible at all — stripping escapes throws away the one thing under test.
    const CARET = "\x1b[7mw\x1b[27m";
    expect(r.lastFrame()).toContain(CARET);

    r.rerender(app(CLASSIC, s));
    await tick();
    expect(text(r.lastFrame)).toContain("hello world");
    expect(r.lastFrame()).toContain(CARET);

    r.rerender(app(FULLSCREEN, s));
    await tick();
    expect(text(r.lastFrame)).toContain("hello world");
    expect(r.lastFrame()).toContain(CARET);
    r.unmount();
  });

  // …AND THE ONE THAT REALLY ANSWERS "WAS IT REBORN". An open command popup is the exact state the composer
  // DISCARDS when it is remounted — its lazy initialiser nulls `mention`/`command` off the app-scoped ref
  // (ChatComposer:411, deliberate: a dialog closing must not restore a stale list). So a popup still standing
  // after the flip is a live composer instance, not a reseeded one, and it is the half section 1's mount
  // counter can only claim for a synthetic tree.
  it("keeps an open command popup, which only a composer that was never remounted can do", async () => {
    const s = session();
    const r = renderWithKeymap(app(FULLSCREEN, s));
    await tick();
    r.stdin.write("/mod");
    await waitFor(() => text(r.lastFrame).includes("/model"));

    r.rerender(app(CLASSIC, s));
    await tick();
    expect(text(r.lastFrame)).toContain("/model");

    r.rerender(app(FULLSCREEN, s));
    await tick();
    expect(text(r.lastFrame)).toContain("/model");
    r.unmount();
  });
});

// ── 4. The flip RE-FOLDS what it replays (T5b) ───────────────────────────────────────────────────────────
// Everything above this section flips a transcript whose two projections are IDENTICAL, so it can pin the
// replay's arithmetic (`N → 0 → N`, exactly once) without ever asking what SHAPE the replayed rows have. Since
// the tool-stream wave the fold policy is renderer-DEPENDENT — a run of non-read shell calls is one cluster row
// in fullscreen and one row per call in classic (`toolFold.ts`'s `fullscreen` input) — and that is the gap: rows
// committed under one policy are replayed under the other, and the next projection appends the OTHER shape
// below them because its per-call ids were never spent. Both shapes, same two calls, one screen.
//   THE CORPUS IS WHAT MAKES THE CELL POSSIBLE: two contiguous non-read `Bash` calls (which diverge) followed
// by enough prose to push them clean out of the live window (which is what COMMITS them — `commitCap()` is
// eight painted rows at 24 rows of terminal, and only a committed row can be replayed at all).
const shellRunEntries: TranscriptBootstrapEntry[] = [
  { kind: "sdk", source: "disk", message: { type: "assistant", parent_tool_use_id: null, message: { id: "m-b1", content: [{ type: "tool_use", id: "b1", name: "Bash", input: { command: "npm run build" } }] } } },
  { kind: "sdk", source: "disk", message: { type: "user", uuid: "u-b1", message: { content: [{ type: "tool_result", tool_use_id: "b1", content: "ok", is_error: false }] } } },
  { kind: "sdk", source: "disk", message: { type: "assistant", parent_tool_use_id: null, message: { id: "m-b2", content: [{ type: "tool_use", id: "b2", name: "Bash", input: { command: "npm test" } }] } } },
  { kind: "sdk", source: "disk", message: { type: "user", uuid: "u-b2", message: { content: [{ type: "tool_result", tool_use_id: "b2", content: "ok", is_error: false }] } } },
];
const foldCorpus: TranscriptBootstrapEntry[] = [...shellRunEntries, ...alphaEntries(24)];
const PER_CALL = "Bash(npm run build)";        // the classic shape of the FIRST of the two calls
const CLUSTER = "Ran 2 shell commands";        // the fullscreen shape of BOTH of them
/** The same divergence, near enough to the END of the document to be INSIDE the fullscreen viewport: that
 *  viewport takes the whole document but shows only its last `rows − 1` rows, so a corpus with twenty-four
 *  prose entries under the calls (`foldCorpus`) can pin that the cluster never reaches the classic screen
 *  while never once observing fullscreen paint it. Ten entries still push the calls clear of the eight-row
 *  commit budget, which is what makes them committed rows rather than live ones. */
const nearFoldCorpus: TranscriptBootstrapEntry[] = [...shellRunEntries, ...alphaEntries(10)];
/** A committed item's text. `state.staticItems` is the one derived fact no frame can show — fullscreen hands
 *  `<Static>` `EMPTY_ITEMS` — so the cell that reads it drives the hook directly and reads the items out. */
const itemText = (items: readonly RenderItem[]): string =>
  items.flatMap((i) => (i.kind === "line" ? [i.line.text] : i.body.map((l) => l.text))).join("\n");

/** Submit a prompt through the composer — the DOCUMENT MUTATION half of the defect: a flip alone changes no
 *  document, and it is the next projection after it that appends the second shape. */
async function sendPrompt(stdin: { write: (s: string) => void }, lastFrame: () => string | undefined, word: string): Promise<void> {
  stdin.write(word);
  await waitFor(() => text(lastFrame).includes(word));
  stdin.write("\r");
  await tick(60);
}

describe("/tui — the replay carries the NEW renderer's fold", () => {
  // `ink-testing-library` runs Ink with `debug: true`, so every write is `fullStaticOutput + output`: the last
  // frame IS the whole committed history plus the live frame, which is the only instrument in this suite that
  // can count a committed row at all. The counts are therefore taken as a DELTA across the flip — the replay
  // itself legitimately re-emits the conversation (section 2's `N → 0 → N`), so the question is never "how many
  // times has this row ever been written" but "how many shapes did THIS flip put on the screen".
  it("replaces the committed rows rather than adding a second copy of the same calls", async () => {
    const born = staticProbe.born.length;
    const { stdin, lastFrame, unmount } = mountRepl({ entries: foldCorpus });
    await tick();
    expect(text(lastFrame)).toContain(PER_CALL);                       // classic mount: two per-call rows, committed
    expect(text(lastFrame)).not.toContain(CLUSTER);

    await runSlash(stdin, lastFrame, "/tui fullscreen");
    await sendPrompt(stdin, lastFrame, "ping-one");                    // …a mutation under the widened policy
    const mid = text(lastFrame);
    const basePerCall = occurrences(mid, PER_CALL), baseCluster = occurrences(mid, CLUSTER);

    await runSlash(stdin, lastFrame, "/tui default");
    await sendPrompt(stdin, lastFrame, "ping-two");                    // …and one under the frozen one
    const after = text(lastFrame);
    expect(occurrences(after, CLUSTER) - baseCluster).toBe(0);         // the classic screen folds NOTHING…
    expect(occurrences(after, PER_CALL) - basePerCall).toBe(1);        // …and says each call exactly once
    // …and none of it came at the price of the T17 crash fix: the component owning the `<Static>` is the same
    // instance it was at mount, so Ink's cached `rootNode.staticNode` still points at a live yoga node.
    expect(staticProbe.born.slice(born)).toHaveLength(1);
    unmount();
  }, 20000);

  // …AND THE ENTERING ARM IS A SEPARATE CLAIM, which nothing above pins: delete its `refoldFor` and every
  // cell in this file and in `fullscreen-frame.test.tsx` stays green, because the LEAVING re-fold recomputes
  // from the document rather than from whatever policy fullscreen accumulated and launders the mistake on
  // the way out. What it cannot launder is the fullscreen session itself, and this is the window in which
  // that is visible: after the flip, before the next document mutation re-projects under a ref that by then
  // answers the new screen. Sabotage measured here — the alternate screen paints the classic pair a second
  // time and no cluster row at all.
  it("paints the fold of the renderer it flipped INTO, on the alternate screen's own frame", async () => {
    const { stdin, lastFrame, unmount } = mountRepl({ entries: nearFoldCorpus });
    await tick();
    const before = text(lastFrame);
    expect(occurrences(before, PER_CALL)).toBe(1);                                 // classic: one row per call…
    expect(occurrences(before, CLUSTER)).toBe(0);

    await runSlash(stdin, lastFrame, "/tui fullscreen");
    const after = text(lastFrame);
    expect(occurrences(after, CLUSTER) - occurrences(before, CLUSTER)).toBe(1);    // …fullscreen: the run, folded once
    expect(occurrences(after, PER_CALL) - occurrences(before, PER_CALL)).toBe(0);  // …and never the classic pair again
    unmount();
  }, 20000);

  // The OTHER derived fact the same arm re-mints, and the reason this one cell is driven at the hook rather
  // than through a frame: `staticItems`/`publishedIds` are the record of what has been painted, and in
  // fullscreen nothing paints them (ChatApp hands `<Static>` `EMPTY_ITEMS`), so no instrument in this file
  // can see their shape. Driven the way `ChatApp` drives it — `isFullscreen` reads a ref that only moves on
  // the re-render `switchRenderer` schedules, so the flip's own handler still asks the OLD screen. That is
  // precisely why `refoldFor` takes an override instead of reading the ref, and a sabotage of the entering
  // arm leaves the committed set holding the classic pair for the life of the fullscreen session.
  it("re-mints the COMMITTED set in the new policy's shape when it enters fullscreen", async () => {
    const fake = fakeRemote();
    let api: { submit: (prompt: string) => void } | undefined;
    let committed: readonly RenderItem[] = [];
    function Probe() {
      const [mode, setMode] = useState<"classic" | "fullscreen">("classic");
      const live = useRef(mode); live.current = mode;
      const chat = useChat(() => fake, {
        initialEntries: foldCorpus, rendererChoice: CLASSIC,
        selectRenderer: (tui) => (tui === "fullscreen" ? FULLSCREEN : CLASSIC),
        switchRenderer: (tui) => { const choice = tui === "fullscreen" ? FULLSCREEN : CLASSIC; setMode(choice.mode); return choice; },
      }, { rows: () => 24, columns: () => 80, isFullscreen: () => live.current === "fullscreen", savePrefs: () => {}, env: {} });
      api = chat; committed = chat.state.staticItems;
      return <Text>x</Text>;
    }
    const r = render(<Probe />);
    await tick(60);
    expect(itemText(committed)).toContain(PER_CALL);
    expect(itemText(committed)).not.toContain(CLUSTER);

    api!.submit("/tui fullscreen");
    await tick(120);
    expect(itemText(committed)).toContain(CLUSTER);          // every committed row is a fullscreen-shaped row…
    expect(itemText(committed)).not.toContain(PER_CALL);     // …in a list that holds only fullscreen-shaped rows
    r.unmount();
  }, 20000);

  // …AND THE THIRD ARM IS "DO NOTHING", which is a claim about BYTES rather than about tidiness. Adding a
  // `refoldFor` to it left every cell in this file green too, because at an unchanged geometry the recomputed
  // prefix IS the accumulated one — same items, same length — and `<Static>` re-emits only when
  // `items.length` moves (Static.js:20-22). So the cell has to stand up the reachable state in which the two
  // genuinely differ, which is the first of the two exceptions `refoldFor`'s header now names: a dialog
  // opening publishes the WHOLE live window, geometry ignored, so once it closes the committed set is longer
  // than the row budget would recompute. A re-fold there un-publishes that tail back into the live subtree
  // while it is still standing in the committed scrollback above — measured under the sabotage, both of the
  // last prose rows twice on one screen.
  it("a /tui that changes no screen writes nothing, even after a dialog published the live window", async () => {
    const { stdin, lastFrame, unmount } = mountRepl({ entries: foldCorpus });
    await tick();
    stdin.write("/help"); await waitFor(() => text(lastFrame).includes("/help")); stdin.write("\r");
    await waitFor(() => text(lastFrame).includes("For more help"));
    stdin.write("\x1b");                                     // …and straight back out, over-published set and all
    await waitFor(() => text(lastFrame).includes("Help dialog dismissed"));
    await tick(60);
    const rows = ["ALPHA-23", "ALPHA-20", PER_CALL];
    const before = rows.map((row) => occurrences(text(lastFrame), row));

    await runSlash(stdin, lastFrame, "/tui default");        // classic, while classic: the command changes no screen
    const after = text(lastFrame);
    expect(rows.map((row, i) => occurrences(after, row) - before[i]!)).toEqual([0, 0, 0]);
    unmount();
  }, 20000);

  // ── THE OTHER HALF OF `refoldFor`'s CLEAR (Task 8 review gap) ─────────────────────────────────────────
  // `refoldFor` clears `expandedFoldsRef` on BOTH edges of a flip, and this file pins only the ENTERING one
  // (the two cases above). The LEAVING clear guards a narrower but real case: `groupItems` consults
  // `expandedFolds` with no fullscreen gate of its own (`toolRenderer.tsx`), and `Read` is collapsible under
  // BOTH renderers (`classifyToolEvent` — unlike the non-read shell clustering above, which is fullscreen-only).
  // So an anchor opened under fullscreen names a cluster the CLASSIC projection also forms, and if the leaving
  // clear were missing, `/tui default` would carry that expansion onto the classic screen: the very
  // duplicating-replay shape this whole section exists to prevent, just entered from the fold side rather than
  // the width side. Unreachable today only because nothing outside the fullscreen mouse path calls
  // `toggleFold` — this cell drives it directly, the same way `fold-expand.test.tsx`'s hook cells do.
  it("a fold expanded under fullscreen does not survive the flip back to classic", async () => {
    const fake = fakeRemote();
    let api: { submit: (prompt: string) => void; toggleFold: (anchor: string) => void; state: { finalizedItems: readonly RenderItem[] } } | undefined;
    function Probe() {
      const [mode, setMode] = useState<"classic" | "fullscreen">("fullscreen");
      const live = useRef(mode); live.current = mode;
      const chat = useChat(() => fake, {
        cwd: "/work", rendererChoice: FULLSCREEN,
        selectRenderer: (tui) => (tui === "fullscreen" ? FULLSCREEN : CLASSIC),
        switchRenderer: (tui) => { const choice = tui === "fullscreen" ? FULLSCREEN : CLASSIC; setMode(choice.mode); return choice; },
      }, { rows: () => 24, columns: () => 100, home: "/home/me", platform: "darwin", now: () => 0,
        isFullscreen: () => live.current === "fullscreen", savePrefs: () => {}, env: {} });
      api = chat;
      return <Text>x</Text>;
    }
    const r = render(<Probe />);
    await tick();
    fake.pushEvent({ kind: "message", data: { type: "assistant", parent_tool_use_id: null, message: { id: "m-r1", content: [{ type: "tool_use", id: "r1", name: "Read", input: { file_path: "/work/a.ts" } }] } } });
    fake.pushEvent({ kind: "message", data: { type: "user", uuid: "u-r1", message: { content: [{ type: "tool_result", tool_use_id: "r1", content: "body", is_error: false }] } } });
    fake.pushEvent({ kind: "message", data: { type: "assistant", parent_tool_use_id: null, message: { id: "m-r2", content: [{ type: "tool_use", id: "r2", name: "Read", input: { file_path: "/work/b.ts" } }] } } });
    fake.pushEvent({ kind: "message", data: { type: "user", uuid: "u-r2", message: { content: [{ type: "tool_result", tool_use_id: "r2", content: "body", is_error: false }] } } });
    fake.pushEvent({ kind: "message", data: { type: "assistant", parent_tool_use_id: null, message: { id: "m-done", content: [{ type: "text", text: "done" }] } } }); // the breaker: closes the run into finalizedItems
    await waitFor(() => api!.state.finalizedItems.some((i) => i.id.startsWith("group:")));

    api!.toggleFold("r1");                                     // opens the cluster under fullscreen
    await waitFor(() => !api!.state.finalizedItems.some((i) => i.id.startsWith("group:")));

    api!.submit("/tui default");                                // the leaving arm: refoldFor(false) runs first
    await tick(120);
    // Read collapses under classic too, so a live expansion set says the SAME thing here it said in
    // fullscreen — no group row — unless the leaving clear ran. This is what fails when `useChat.ts:1071`'s
    // `expandedFoldsRef.current.clear()` is removed.
    expect(api!.state.finalizedItems.some((i) => i.id.startsWith("group:"))).toBe(true);
    r.unmount();
  }, 20000);
});

// ── E2: THE COMPACT-SUMMARY CHIP MUST FOLLOW THE LIVE RENDERER ───────────────────────────────────────────
// §3.4's suppression is BLANKET — inside fullscreen no `(ctrl+o to expand)` renders anywhere, because canon's
// `Ett` context wraps the whole virtual list. Every chip a PROJECTION derives obeys that through
// `projectionContext()`'s `expandHint: fullscreen ? "" : …`. The compact boundary was the one row that did
// not: it was baked into the transcript at ingest, so whichever renderer happened to be painting when
// `/compact` landed was frozen into it and a later `/tui` could not correct it in EITHER direction. The
// species tag is enough to re-derive the row at projection time, which is what these two cells drive through
// the real command — `refoldFor` re-projects the finalized document with the new context, so a derived row
// moves and a stored one cannot.
describe("/tui — the compact-summary chip follows the live renderer (E2)", () => {
  type Api = { submit: (prompt: string) => void; state: { finalizedItems: readonly RenderItem[]; pendingItems: readonly RenderItem[] } };
  function mountFlip(start: "classic" | "fullscreen") {
    const fake = fakeRemote();
    const box: { api?: Api } = {};
    function Probe() {
      const [mode, setMode] = useState<"classic" | "fullscreen">(start);
      const live = useRef(mode); live.current = mode;
      const chat = useChat(() => fake, {
        cwd: "/work", rendererChoice: start === "fullscreen" ? FULLSCREEN : CLASSIC,
        selectRenderer: (tui) => (tui === "fullscreen" ? FULLSCREEN : CLASSIC),
        switchRenderer: (tui) => { const choice = tui === "fullscreen" ? FULLSCREEN : CLASSIC; setMode(choice.mode); return choice; },
      }, { rows: () => 24, columns: () => 100, home: "/home/me", platform: "darwin", now: () => 0,
        isFullscreen: () => live.current === "fullscreen", savePrefs: () => {}, env: {} });
      box.api = chat;
      return <Text>x</Text>;
    }
    const r = render(<Probe />);
    return { fake, r, box };
  }
  const summaryRows = (api: Api): string[] =>
    [...api.state.finalizedItems, ...api.state.pendingItems]
      .flatMap((i) => (i.kind === "line" && i.line.text.includes("Compact summary") ? [i.line.text] : []));
  async function compactedUnder(start: "classic" | "fullscreen") {
    const m = mountFlip(start);
    await tick();
    m.fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
    m.fake.pushEvent({ kind: "message", data: { type: "system", subtype: "compact_boundary", uuid: `cb-${start}` } });
    await waitFor(() => summaryRows(m.box.api!).length > 0);
    m.fake.pushEvent({ kind: "turn", phase: "end", seq: 1 });      // a flip is refused while a turn is running
    await tick(60);
    return m;
  }

  it("a boundary compacted in CLASSIC loses its chip when the session flips to fullscreen", async () => {
    const m = await compactedUnder("classic");
    expect(summaryRows(m.box.api!)).toEqual(["Compact summary (ctrl+o to expand)"]);
    m.box.api!.submit("/tui fullscreen");
    await tick(120);
    expect(summaryRows(m.box.api!)).toEqual(["Compact summary"]);
    m.r.unmount();
  }, 20000);

  it("a boundary compacted in FULLSCREEN gets its chip back when the session flips to classic", async () => {
    const m = await compactedUnder("fullscreen");
    expect(summaryRows(m.box.api!)).toEqual(["Compact summary"]);
    m.box.api!.submit("/tui default");
    await tick(120);
    expect(summaryRows(m.box.api!)).toEqual(["Compact summary (ctrl+o to expand)"]);
    m.r.unmount();
  }, 20000);
});
