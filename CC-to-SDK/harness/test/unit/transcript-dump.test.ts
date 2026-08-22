// test/unit/transcript-dump.test.ts — FSW Task 12: the transcript dump, and the editor escape hatch.
//
// Fullscreen quit destroys the conversation's terminal record on purpose (spec §A6): there is no scrollback
// to leave it in. Canon's answer is a resume pointer plus THIS — `v` renders the whole transcript to a file
// and hands it to `$VISUAL`/`$EDITOR`. The canon read, from ~/claude-code-bundle/2.1.220/cli.pretty.js:
//   · L549336-549359  the `v` handler: render every message, `cc-transcript-${Date.now()}.txt` under the
//                     private tmp dir (`xv()`, L111521 — `mkdir` with mode 0o700), then `wDo(file)`
//   · L457108 `pZo`   renders the messages through the REAL renderer and pipes them through `Ci` =
//                     `Bun.stripANSI`, then the caller strips trailing `[ \t]+` per line — the file is PLAIN
//                     TEXT, because it is going into an editor and not back onto a terminal
//   · L317693 `wDo`   the editor handoff: `enterAlternateScreen()` → `spawnSync` → `exitAlternateScreen()` in
//                     a `finally`, i.e. the child gets the MAIN screen for its whole life. Ours is T6's
//                     `guard.aroundSubprocess`, and the byte order below is what pins that it is really used.
//   · L547303         the transcript screen's hint row — `v to open in ${editor}` — which is canon's proof
//                     that this key belongs to a scrolled/READING surface, not to a focused composer.
import { describe, it, expect, vi, afterEach } from "vitest";
import { lstatSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { createAltScreenGuard } from "../../src/tui/altScreen.js";
import { dumpTranscript, transcriptText, verifiedDumpDir } from "../../src/tui/transcriptDump.js";
import type { RenderItem } from "../../src/tui/toolRenderer.js";
import type { RenderLine } from "../../src/tui/render.js";

const GUTTER = "  ⎿  " as const;   // five columns: connector + plain cells (the group-hint form, so no NBSP to muddy the trims)
const line = (id: string, l: RenderLine): RenderItem => ({ kind: "line", id, line: l });
const block = (id: string, rows: readonly string[]): RenderItem =>
  ({ kind: "gutter-block", id, gutter: GUTTER, body: rows.map((text) => ({ text })) });

/** A spawnSync stand-in: records the argv it was handed and answers like a clean editor exit. */
function fakeSpawn(status = 0) {
  const calls: Array<{ cmd: string; args: readonly string[] }> = [];
  const spawn = ((cmd: string, args: readonly string[]) => { calls.push({ cmd, args }); return { status, error: undefined }; }) as never;
  return { calls, spawn };
}
const tmpDirs: string[] = [];
const scratch = (): string => { const d = mkdtempSync(join(tmpdir(), "ccx-t12-")); tmpDirs.push(d); return d; };
afterEach(() => { for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe("transcriptText — the document as plain text", () => {
  it("renders EVERY item in order, not the window that happened to be on screen", () => {
    const text = transcriptText([line("a", { text: "first" }), line("b", { text: "second" }), line("c", { text: "third" })]);
    expect(text).toBe("first\nsecond\nthird\n");
  });

  // `RenderItemView` puts the connector in a five-column sibling Box that is filled for the block's FIRST
  // visible row and blank for the rest, so the file has to reproduce both halves — the marker once, the
  // indent on every continuation. Without it a wrapped result body reads flush against the left margin.
  it("prints a gutter block's connector once and indents its continuations to the same column", () => {
    expect(transcriptText([block("t", ["one", "two", "three"])])).toBe(
      `${GUTTER}one\n     two\n     three\n`);
  });

  it("is empty for an empty document — no lone newline", () => expect(transcriptText([])).toBe(""));

  // Canon's `Ci` is `Bun.stripANSI`. Ours has two producers to survive: the `preStyled` seam (a segment whose
  // text IS raw SGR bytes — F3 Task 1) and `osc8FileLink`, whose escape wraps a label that must SURVIVE.
  it("strips SGR runs and unwraps OSC-8 links, keeping the label", () => {
    const styled = line("s", { text: "", segments: [{ text: "\x1b[1mRead\x1b[22m", preStyled: true }] });
    const linked = line("l", { text: "\x1b]8;;file:///w/app.ts\x07app.ts\x1b]8;;\x07" });
    expect(transcriptText([styled, linked])).toBe("Read\napp.ts\n");
  });

  // A line's `text` is the plain fallback, but `Line.tsx` renders the SEGMENTS whenever it has them — so the
  // segments are what was on screen, and the file follows the screen.
  it("joins the segments when a line has them", () => {
    const header = line("h", { text: "stale", segments: [{ text: "⏺ " }, { text: "Read", bold: true }, { text: "(app.ts)" }] });
    expect(transcriptText([header])).toBe("⏺ Read(app.ts)\n");
  });

  it("carries a line's own gutter (the thinking `∴`, dividers) into the file", () =>
    expect(transcriptText([line("g", { text: "pondering", gutter: { text: "∴ " } })])).toBe("∴ pondering\n"));

  // Canon: `.replace(/[ \t]+$/gm, "")` — an editor should not open on a file full of invisible padding.
  it("strips trailing spaces and tabs from every row", () =>
    expect(transcriptText([line("p", { text: "padded   " }), line("q", { text: "tabbed\t" })])).toBe("padded\ntabbed\n"));
});

describe("dumpTranscript", () => {
  it("writes cc-transcript-<ts>.txt with the whole transcript and opens it in the editor", () => {
    const dir = scratch(), { calls, spawn } = fakeSpawn();
    const r = dumpTranscript({
      items: () => [line("a", { text: "hello" }), block("t", ["Read 3 lines"])],
      now: () => 1755000000000, dir: () => dir,
      editorIO: { spawn, editorCmd: "vi", setRaw: () => {}, restoreTty: () => {} },
    });
    const file = join(dir, "cc-transcript-1755000000000.txt");
    expect(r).toEqual({ status: "opened", file, message: `opening ${file}` });
    expect(readFileSync(file, "utf8")).toBe(`hello\n${GUTTER}Read 3 lines\n`);
    expect(calls).toEqual([{ cmd: "vi", args: [file] }]);
  });

  // THE HANDOFF IS THE POINT (T6). The editor owns the terminal for as long as it runs, so the alt screen has
  // to be handed BACK before the child starts and taken again after it exits — otherwise `vi` paints into a
  // screen we are about to discard and the user's edit session happens somewhere they cannot see.
  it("runs the editor between rmcup and smcup — the guard's handoff, in that order", () => {
    const dir = scratch(), writes: string[] = [];
    const guard = createAltScreenGuard({ writeSync: (s) => { writes.push(s); } });
    guard.enter();
    writes.length = 0;
    const spawn = ((cmd: string) => { writes.push(`<spawnSync ${cmd}>`); return { status: 0 }; }) as never;
    dumpTranscript({
      items: () => [line("a", { text: "hello" })], now: () => 1, dir: () => dir,
      around: guard.aroundSubprocess,
      editorIO: { spawn, editorCmd: "vi", setRaw: () => {}, restoreTty: () => {} },
    });
    const child = writes.indexOf("<spawnSync vi>");
    expect(child).toBeGreaterThan(0);
    expect(writes.slice(0, child)).toContain("\x1b[<u\x1b[?1049l\x1b[>4m");        // EXIT_ALT, before the child
    // …and ENTER_ALT after it, with the wheel enable canon writes beside it (FSW backlog 5; `AUe("scroll")`).
    expect(writes.slice(child + 1)).toEqual(["\x1b[?1049h\x1b[2J\x1b[H\x1b[?1000h\x1b[?1002h\x1b[?1003h\x1b[?1006h"]);
    expect(guard.active()).toBe(true);
  });

  // The file is the deliverable; the editor is a convenience. A user with neither variable set still gets the
  // dump, and is TOLD where it is — canon's own second message (L549350).
  it("still writes the file when no editor is configured, and says so", () => {
    vi.stubEnv("VISUAL", ""); vi.stubEnv("EDITOR", "");
    const dir = scratch(), { calls, spawn } = fakeSpawn();
    const r = dumpTranscript({ items: () => [line("a", { text: "hi" })], now: () => 7, dir: () => dir, editorIO: { spawn } });
    const file = join(dir, "cc-transcript-7.txt");
    expect(r).toEqual({ status: "wrote", file, message: `wrote ${file} · no $VISUAL/$EDITOR set` });
    expect(readFileSync(file, "utf8")).toBe("hi\n");
    expect(calls).toEqual([]);
    vi.unstubAllEnvs();
  });

  it("reports an editor that exited non-zero without losing the file", () => {
    const dir = scratch(), { spawn } = fakeSpawn(1);
    const r = dumpTranscript({ items: () => [], now: () => 9, dir: () => dir, editorIO: { spawn, editorCmd: "vi", setRaw: () => {}, restoreTty: () => {} } });
    expect(r.status).toBe("wrote");
    expect(r.message).toBe(`wrote ${join(dir, "cc-transcript-9.txt")} · the editor exited non-zero`);
  });

  // A dump is a convenience keystroke on a live session: whatever goes wrong (an unwritable tmp, a projection
  // that throws), it may not take the REPL down with it.
  it("never throws — a failure comes back as a message", () => {
    const r = dumpTranscript({ items: () => { throw new Error("projection exploded"); }, dir: () => scratch() });
    expect(r).toEqual({ status: "failed", message: "render failed: projection exploded" });
  });

  // ── EXTERNAL REVIEW, FINDING 2 — THE DESTINATION IS A SHARED DIRECTORY WITH A PREDICTABLE NAME ──────────
  // Both halves are about the same attacker: a second local user on a machine with a shared `/tmp`, who can
  // guess `ccx-<uid>` and can guess `cc-transcript-<ms>.txt` to within a few thousand tries. Canon has the
  // same exposure; ours is closed. See `verifiedDumpDir`'s header for the argument.

  // A planted SYMLINK at the exact name the next dump will use. `writeFileSync` follows it and the transcript
  // lands in the attacker's file with the attacker's mode; `wx` (O_CREAT|O_EXCL) refuses to open it at all.
  it("does not follow a symlink planted at the predicted path — it lands beside it instead", () => {
    const dir = scratch(), victim = join(scratch(), "victim.txt");
    writeFileSync(victim, "ORIGINAL");
    const predicted = join(dir, "cc-transcript-42.txt");
    symlinkSync(victim, predicted);
    const { calls, spawn } = fakeSpawn();
    const r = dumpTranscript({
      items: () => [line("a", { text: "secret" })], now: () => 42, dir: () => dir,
      editorIO: { spawn, editorCmd: "vi", setRaw: () => {}, restoreTty: () => {} },
    });
    expect(readFileSync(victim, "utf8")).toBe("ORIGINAL");            // the plant was never written through
    expect(lstatSync(predicted).isSymbolicLink()).toBe(true);         // …and is still just a symlink
    expect(r.status).toBe("opened");
    expect(r.file).not.toBe(predicted);
    expect(basename(r.file!)).toMatch(/^cc-transcript-42-[0-9a-f]{8}\.txt$/);
    expect(readFileSync(r.file!, "utf8")).toBe("secret\n");
    expect(calls).toEqual([{ cmd: "vi", args: [r.file!] }]);          // …and the editor opens the REAL dump
  });

  // The same refusal covers the ordinary collision the retry was designed around — two dumps inside one
  // millisecond — which is why there is one code path and not two.
  it("retries on a plain name collision rather than overwriting the earlier dump", () => {
    const dir = scratch();
    writeFileSync(join(dir, "cc-transcript-42.txt"), "FIRST");
    const r = dumpTranscript({ items: () => [line("a", { text: "second" })], now: () => 42, dir: () => dir,
      editorIO: { spawn: fakeSpawn().spawn, editorCmd: "vi", setRaw: () => {}, restoreTty: () => {} } });
    expect(readFileSync(join(dir, "cc-transcript-42.txt"), "utf8")).toBe("FIRST");
    expect(readFileSync(r.file!, "utf8")).toBe("second\n");
  });

  // …and the directory itself. `mkdirSync(…, {recursive:true})` accepts a name that already exists, so a
  // pre-created `ccx-<uid>` — here a symlink to a world-readable directory — is adopted silently and the 0700
  // mode applies to nothing. The verification catches it and the dump goes somewhere unpredictable instead.
  it("falls back to a fresh private directory when ccx-<uid> is not a directory of ours", () => {
    const base = scratch(), open = scratch();
    const planted = join(base, `ccx-${process.getuid?.() ?? 0}`);
    symlinkSync(open, planted);
    const dest = verifiedDumpDir(base);
    expect(dest.fellBack).toBe(true);
    expect(dest.dir).not.toBe(planted);
    expect(dest.dir.startsWith(join(base, "ccx-"))).toBe(true);
    expect(lstatSync(dest.dir).isDirectory()).toBe(true);
    if (process.getuid) expect(lstatSync(dest.dir).mode & 0o777).toBe(0o700);
  });

  // The mirror: a clean base gets canon's own directory, created 0700, and NO fallback — the check must not
  // be a fallback that always fires, which would make every dump land in a new directory.
  it("uses canon's ccx-<uid> when it is ours, and says nothing", () => {
    const base = scratch();
    const first = verifiedDumpDir(base);
    expect(first).toEqual({ dir: join(base, `ccx-${process.getuid?.() ?? 0}`), fellBack: false });
    expect(verifiedDumpDir(base)).toEqual(first);                     // …and again, on the second launch
    if (process.getuid) expect(lstatSync(first.dir).mode & 0o777).toBe(0o700);
  });

  // The default destination, exercised for real: canon writes into a 0700 directory of its own under tmpdir
  // (`xv()`) rather than into tmpdir itself, because a transcript is the whole conversation and /tmp is a
  // shared place. No editor is configured here, so nothing is spawned.
  it("defaults to a private directory under the system tmpdir", () => {
    vi.stubEnv("VISUAL", ""); vi.stubEnv("EDITOR", "");
    const r = dumpTranscript({ items: () => [line("a", { text: "x" })] });
    expect(r.status).toBe("wrote");
    expect(r.file!.startsWith(tmpdir())).toBe(true);
    expect(/cc-transcript-\d+\.txt$/.test(r.file!)).toBe(true);
    if (process.getuid) expect(statSync(dirname(r.file!)).mode & 0o777).toBe(0o700);
    rmSync(r.file!, { force: true });
    vi.unstubAllEnvs();
  });
});
