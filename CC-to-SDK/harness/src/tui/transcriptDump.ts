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
// THREE DIVERGENCES, all recorded (…and two more below: the fourth message, at the line that prints it, and
// the fifth — the hardening of the destination — at `verifiedDumpDir`):
//  1. THE PROJECTION IS OURS, NOT A SECOND RENDERER. Canon re-renders the message list into a fresh Ink tree
//     at `max(80, columns − 6)`. We hand this module the items the ctrl+O detail view is built from
//     (`useChat`'s `detailItems("detail-all")`, canon's own `showAllInTranscript: !0`), already wrapped to the
//     live width, so the file says exactly what the expanded transcript says — one projection, no second
//     rendering path that could disagree with the screen.
//  2. NO PROGRESS MESSAGE. Canon paints `rendering N messages…` first because its render is async. Ours is
//     synchronous and the editor's `spawnSync` freezes the loop straight after it, so a pre-message could
//     never reach the terminal; the caller reports the OUTCOME instead.
//  3. THE FILE IS 0600. Same argument as the 0700 directory, one level down, and it costs nothing.
import { randomBytes } from "node:crypto";
import { lstatSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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

/** Where a dump landed, and whether it landed where it was supposed to. */
export interface DumpDest { dir: string; fellBack: boolean }

/** Is this path a directory WE own, private to us, and not a symlink pointing at one? `lstat`, not `stat`:
 *  the whole question is whether the name we are about to write under is itself the thing we checked. Off
 *  POSIX (`process.getuid` absent) ownership and mode are not answerable, so only the shape is asked. */
function isOursAndPrivate(dir: string): boolean {
  try {
    const st = lstatSync(dir);
    if (!st.isDirectory()) return false;
    if (!process.getuid) return true;
    return st.uid === process.getuid() && (st.mode & 0o777) === 0o700;
  } catch { return false; }
}

/** canon `xv()` (L111521): a private directory of our own under the system temp dir, created on demand. The
 *  uid is in the NAME as well as the mode because a shared `/tmp` can already hold another user's.
 *
 *  DIVERGENCE 5, AND CANON SHARES THE EXPOSURE WE ARE CLOSING. `mkdirSync(…, {recursive:true})` SUCCEEDS on a
 *  path that already exists — including one another local user pre-created on a shared `/tmp` with a
 *  guessable name (`ccx-<uid>` is fully predictable), and including a symlink to a directory they can read.
 *  The 0700 mode then applies to nothing, because nothing was created. So the mkdir is only half the answer:
 *  the other half is verifying, AFTER it, that the name really is a directory (`lstat`, so a symlink fails),
 *  really is ours, and really is 0700 — and when it is not, writing this dump into a fresh `mkdtemp` name the
 *  attacker could not have predicted instead. Canon does the mkdir and stops; the transcript is the whole
 *  conversation, and a fallback that costs one `lstat` is cheaper than the disclosure it prevents.
 *
 *  `base` is a parameter so the check itself is testable without planting anything in the real temp dir. */
export function verifiedDumpDir(base: string): DumpDest {
  const dir = join(base, `ccx-${process.getuid?.() ?? 0}`);
  // A mkdir that throws is not a verdict — the check below is — so it is swallowed and the check decides.
  try { mkdirSync(dir, { recursive: true, mode: 0o700 }); } catch { /* the verification is the gate */ }
  if (isOursAndPrivate(dir)) return { dir, fellBack: false };
  return { dir: mkdtempSync(join(base, "ccx-")), fellBack: true };
}

/** The destination itself, for the callers (and the tests) that only want the path. */
export const dumpDir = (): string => verifiedDumpDir(tmpdir()).dir;

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
/** DIVERGENCE 5, SECOND HALF: the file is created EXCLUSIVELY. `wx` is `O_CREAT|O_EXCL`, which fails on ANY
 *  existing path at that name — a real file, and (the reason it is here) a symlink another user planted at the
 *  predictable `cc-transcript-<ms>.txt`, which a plain `writeFileSync` FOLLOWS while the 0600 mode applies only
 *  to a file it created. EEXIST is therefore two things at once — a timestamp collision within the same
 *  millisecond, and a plant — and the same answer serves both: retry once at a name nothing could have
 *  predicted, still exclusively. A second EEXIST is not a case worth a third name; it goes out as the sentence. */
function writeExclusive(dir: string, stamp: number, text: string): string {
  const file = join(dir, `cc-transcript-${stamp}.txt`);
  try { writeFileSync(file, text, { mode: 0o600, flag: "wx" }); return file; }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
  const retry = join(dir, `cc-transcript-${stamp}-${randomBytes(4).toString("hex")}.txt`);
  writeFileSync(retry, text, { mode: 0o600, flag: "wx" });
  return retry;
}

/** …and the sentence the fallback owes the user. The path in the message already says the dump is somewhere
 *  else; this says WHY, which is the part they would otherwise have to guess at. */
const FELL_BACK = "the shared ccx temp dir was not ours — wrote to a fresh private one";

export function dumpTranscript(deps: TranscriptDumpDeps): TranscriptDumpResult {
  const around = deps.around ?? (<T,>(run: () => T) => run());
  let file: string | undefined;
  try {
    const text = transcriptText(deps.items());
    const dest: DumpDest = deps.dir ? { dir: deps.dir(), fellBack: false } : verifiedDumpDir(tmpdir());
    const note = dest.fellBack ? ` · ${FELL_BACK}` : "";
    file = writeExclusive(dest.dir, (deps.now ?? Date.now)(), text);
    const opened = openInEditor(file, { ...deps.editorIO, around });
    if (opened === "opened") return { status: "opened", file, message: `opening ${file}${note}` };
    // FOURTH MESSAGE, AND IT IS OURS (divergence 4, t12 review M2): canon has three, and prints `opening …`
    // for any spawn that did not error — a non-zero editor exit included (`wDo`, L317693). We tell the user
    // the editor came back unhappy, because the file is still there and the sentence is the only place they
    // can learn that. Deliberate; the other three are canon's verbatim.
    return { status: "wrote", file, message: `wrote ${file} · ${opened === "no-editor" ? "no $VISUAL/$EDITOR set" : "the editor exited non-zero"}${note}` };
  } catch (e) {
    // canon's own wording (L549353), and it covers the write as well as the render — from the user's side
    // there is one gesture here and one thing that can be said to have failed.
    return { status: "failed", ...(file === undefined ? {} : { file }), message: `render failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}
