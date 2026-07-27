// tui/src/memory.ts — the `#` memory-mode: append a note to the project CLAUDE.md (CC's `#` adds to a
// memory file). Notes land under a "## Memories" section; the section is created on first use. Returns the
// path written, for the transcript confirmation. Impure (fs); injected as a dep so useChat stays testable.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const HEADER = "## Memories";

/** Append `- <note>` to `<cwd>/CLAUDE.md` under a "## Memories" section (created if absent). Returns the path.
 *  A multi-line note is collapsed to one bullet (newlines → spaces) so it stays a single valid list item. */
export function appendMemory(note: string, cwd: string): string {
  const path = join(cwd, "CLAUDE.md");
  const oneLine = note.replace(/\s*\n\s*/g, " ").trim();
  const hasHeader = existsSync(path) && readFileSync(path, "utf8").includes(HEADER);
  appendFileSync(path, (hasHeader ? "" : `\n${HEADER}\n`) + `- ${oneLine}\n`);
  return path;
}
