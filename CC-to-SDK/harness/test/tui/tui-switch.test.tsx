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
import { ChatApp } from "../../src/tui/ChatApp.js";
import { ChatRoot, createRendererSwitch, createResumeSafeStdout, type ResumeSafeStdout } from "../../src/tui/chatMain.js";
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
const FULLSCREEN: RendererChoice = { mode: "fullscreen", reason: "settings_on" };

/** The real `createRendererSwitch`, over a guard that records instead of writing, so a test can read both the
 *  ordering of the guard's calls and the bytes they would have produced. `unmount` is `runChatClient`'s own
 *  dependency (canon `zuy`'s limb — it ENDS the process's renderer), wired here as a counter for the reason
 *  the case below spends an assertion on it.
 *    THE THIRD SIDE EFFECT IS A MARKER IN THE SAME ARRAY (fix round C1). `ink-testing-library` paints into a
 *  string rather than a terminal, so there is no output proxy in this instrument's loop — but the ORDER of
 *  the screen-debt hand-over against the guard's escape is exactly what the fix is about, so the announcement
 *  is recorded where the escapes are. The byte harness below runs the real proxy instead. */
function harnessSwitch(sink: string[] = []) {
  const unmounts: number[] = [];
  const guard = createAltScreenGuard({ writeSync: (s) => { sink.push(s); }, unmount: () => { unmounts.push(1); } });
  const live = { mode: CLASSIC.mode };
  const output = { noteScreenChange: (to: "alt" | "main") => { sink.push(`<screen:${to}>`); } };
  return { sink, guard, live, unmounts, rendererSwitch: createRendererSwitch({ prefs: {}, isTTY: true, env: {}, guard, live, output }) };
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
    // …and on BOTH edges the screen's outstanding erase moved before the escape that changes the screen did
    // (fix round C1). Behind rmcup it would be too late: the debt is spent on the terminal, not on the guard.
    expect(sink.indexOf("<screen:alt>")).toBeLessThan(sink.indexOf(ENTER_ALT));
    expect(sink.indexOf("<screen:main>")).toBeLessThan(sink.indexOf(EXIT_ALT));
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
    const enter = writes.indexOf(ENTER_ALT, markIn);
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
