// tui/transcriptDump.ts — FSW Task 12: THE WAY OUT. The whole conversation, as a file, in your editor.
//
// The fullscreen renderer's one deliberate loss is the terminal record: it paints into the alternate screen,
// so on exit the shell's scrollback comes back exactly as it was and the conversation is not in it (spec §A6,
// §M2a). Canon answers that with two things and we ship both — the resume pointer `altScreen.ts` prints on
// the way out, and THIS: `v` renders every row of the retained document to a text file and hands the file to
// `$VISUAL`/`$EDITOR`, where the user can read, search, copy and keep it.
//
// CANON, from ~/claude-code-bundle/2.1.220/cli.pretty.js:
//   · L549336-549359  the handler: render, write `cc-transcript-${Date.now()}.txt`, open it, and say which of
//                     the two happened. Re-entrancy is latched; the status clears itself after 4 s.
//   · L111521 `xv()`  the destination — NOT tmpdir itself but a per-uid directory inside it, created 0o700.
//                     A transcript is the whole conversation; /tmp is a place other users can read.
//   · L457108 `pZo`   renders through the REAL renderer and pipes the result through `Ci` = `Bun.stripANSI`;
//                     the caller then strips trailing `[ \t]+` per line. The file is PLAIN TEXT because it is
//                     going into an editor, not back onto a terminal.
//   · L317693 `wDo`   the handoff: the child runs with the MAIN screen in front of it.
//
// THREE DIVERGENCES, all recorded:
//  1. THE PROJECTION IS OURS, NOT A SECOND RENDERER. Canon re-renders the message list into a fresh Ink tree
//     at `max(80, columns − 6)`. We hand this module the items the ctrl+O detail view is built from
//     (`useChat`'s `detailItems("detail-all")`, canon's own `showAllInTranscript: !0`), already wrapped to the
//     live width, so the file says exactly what the expanded transcript says — one projection, no second
//     rendering path that could disagree with the screen.
//  2. NO PROGRESS MESSAGE. Canon paints `rendering N messages…` first because its render is async. Ours is
//     synchronous and the editor's `spawnSync` freezes the loop straight after it, so a pre-message could
//     never reach the terminal; the caller reports the OUTCOME instead.
//  3. THE FILE IS 0600. Same argument as the 0700 directory, one level down, and it costs nothing.
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openInEditor, type EditorIO } from "./externalEditor.js";
import type { RenderLine } from "./render.js";
import type { RenderItem } from "./toolRenderer.js";

/** What a terminal reads and an editor should not have to. Two forms reach a `RenderLine`'s text: the OSC-8
 *  hyperlink a file-tool header wears (`osc8FileLink` — the escape goes, the LABEL stays, which is the whole
 *  reason this is not a blanket `\x1b`-to-end-of-line cut), and the raw SGR of a `preStyled` segment (F3 Task
 *  1). Everything else our renderers emit is style PROPS, which never reach a string at all. */
const ANSI = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-9;?]*[a-zA-Z]/g;
export const stripAnsi = (text: string): string => text.replace(ANSI, "");

/** One line as the screen shows it: its own gutter (the thinking `∴`, a divider) and then either its segments
 *  — which is what `Line.tsx` renders whenever it has them, so they are the truth — or its plain `text`. */
const lineText = (line: RenderLine): string =>
  (line.gutter?.text ?? "") + (line.segments?.length ? line.segments.map((s) => s.text).join("") : line.text);

/** The document as plain text. A gutter block's connector belongs to its FIRST row and every continuation is
 *  indented to the same column — `RenderItemView` renders that as a five-column sibling Box filled once, and a
 *  file that dropped the indent would read a wrapped result body flush against the margin. */
export function transcriptText(items: readonly RenderItem[]): string {
  const rows: string[] = [];
  for (const item of items) {
    if (item.kind === "line") { rows.push(lineText(item.line)); continue; }
    const blank = " ".repeat(item.gutter.length);
    item.body.forEach((line, i) => rows.push((i === 0 ? item.gutter : blank) + lineText(line)));
  }
  if (rows.length === 0) return "";
  return rows.map((row) => stripAnsi(row).replace(/[ \t]+$/, "")).join("\n") + "\n";
}

/** canon `xv()` (L111521): a private directory of our own under the system temp dir, created on demand. The
 *  uid is in the NAME as well as the mode because a shared `/tmp` can already hold another user's. */
export function dumpDir(): string {
  const dir = join(tmpdir(), `ccx-${process.getuid?.() ?? 0}`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export interface TranscriptDumpDeps {
  /** The whole retained document at the detail projection — `useChat`'s `detailItems("detail-all")`. */
  items(): readonly RenderItem[];
  /** T6's `guard.aroundSubprocess`: the editor gets the MAIN screen for its whole life, and the alternate one
   *  is taken back after it exits. Absent (classic renderer, tests) means run the child where we stand. */
  around?: <T>(run: () => T) => T;
  now?(): number;
  dir?(): string;
  /** Injected through to `openInEditor` — the spawn seam a test drives, and nothing else in production. */
  editorIO?: EditorIO;
}

/** `opened` and `wrote` are both successes: the FILE is the deliverable and the editor is the convenience, so
 *  a user with neither variable set still gets the dump and is told where it landed. */
export interface TranscriptDumpResult { status: "opened" | "wrote" | "failed"; file?: string; message: string }

/** Render, write, open — and never throw. This runs off a keypress on a live session, so an unwritable temp
 *  dir or a projection that blows up has to come back as a sentence, not as an unmount. */
export function dumpTranscript(deps: TranscriptDumpDeps): TranscriptDumpResult {
  const around = deps.around ?? (<T,>(run: () => T) => run());
  let file: string | undefined;
  try {
    const text = transcriptText(deps.items());
    file = join((deps.dir ?? dumpDir)(), `cc-transcript-${(deps.now ?? Date.now)()}.txt`);
    writeFileSync(file, text, { mode: 0o600 });
    const opened = openInEditor(file, { ...deps.editorIO, around });
    if (opened === "opened") return { status: "opened", file, message: `opening ${file}` };
    // FOURTH MESSAGE, AND IT IS OURS (divergence 4, t12 review M2): canon has three, and prints `opening …`
    // for any spawn that did not error — a non-zero editor exit included (`wDo`, L317693). We tell the user
    // the editor came back unhappy, because the file is still there and the sentence is the only place they
    // can learn that. Deliberate; the other three are canon's verbatim.
    return { status: "wrote", file, message: `wrote ${file} · ${opened === "no-editor" ? "no $VISUAL/$EDITOR set" : "the editor exited non-zero"}` };
  } catch (e) {
    // canon's own wording (L549353), and it covers the write as well as the render — from the user's side
    // there is one gesture here and one thing that can be said to have failed.
    return { status: "failed", ...(file === undefined ? {} : { file }), message: `render failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}
