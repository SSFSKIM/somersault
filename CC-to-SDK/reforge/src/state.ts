// The fourth graded surface: engine STATE (campaign spec §3.2).
//
// Transcripts, harness events and API requests all describe what the engine
// SAID. None of them describes what it DID to the machine. Two engines can agree
// on every message and still leave different files behind, or exit differently
// once the stream is over — cross-resume's session-store diff already proved
// this class of difference is real and invisible to the other three.
//
// §3.2 stages this surface: a cheap subset from W1 (sandbox filesystem tree +
// exit codes), the full version — session/config store, leaked child processes
// and sockets — with the S-module waves at W9. This is the cheap subset, and it
// is deliberate about which half is strong:
//
//  - THE FILESYSTEM HALF IS DIRECT. The sandbox is wiped before every run
//    (`resetSandbox`), so the tree a run leaves is exactly what that engine
//    created, and it is compared entry for entry with content hashes — the ROOT
//    included, so "the engine deleted its working directory" is a difference
//    rather than the same empty listing an untouched sandbox produces.
//  - THE EXIT HALF IS DERIVED, and says so. Capturing a true exit status would
//    mean either adding an env var outside the X6 schema or dropping `exec` from
//    the engine wrappers — and dropping `exec` puts a shell between the SDK and
//    the engine, so an aborted run (which the corpus has, in `interrupt` and
//    `background-task`) would signal the shell and orphan the engine. Neither
//    price is worth paying here, so this reads the outcome the runner can
//    already observe: the SDK reports a non-zero child exit as
//    "process exited with code N" on the error it throws, which the runner
//    captures. That sees a crash and its code; it cannot see a non-zero exit the
//    SDK swallows after a clean stream. Named, not rounded up — process
//    supervision arrives with the full surface at W9.
//
// CANONICALIZATION, with its justification (§3.4 requires one per rule):
//  - mtimes and inode numbers are NOT recorded. They differ between two replays
//    of the SAME engine, so including them would grade nothing and flag
//    everything. Sizes and content hashes carry the actual claim.
//  - absolute paths are recorded RELATIVE to the sandbox root, because the root
//    is the harness's own path and identical for both engines anyway; keeping it
//    would add noise to every finding without adding a claim. The root itself is
//    therefore the entry "."; its EXISTENCE and KIND are still recorded, because
//    those are facts about the engine and not about this machine's paths.
// Nothing else is normalized: a difference in this surface is a difference.
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import { join, relative } from "node:path";

export interface StateEntry {
  /** relative to the sandbox root; "." is the root itself */
  path: string;
  kind: "file" | "dir" | "symlink" | "other" | "missing";
  /** byte length, for files only */
  size?: number;
  /** sha256 of the contents, for files only */
  sha256?: string;
  /** link target, for symlinks only */
  target?: string;
}

export interface StateSnapshot {
  /** every entry under the sandbox root, sorted by path */
  sandbox: StateEntry[];
  /** how the engine process ended, as far as the runner can observe (see header) */
  engine: string;
}

/** One filesystem entry, read without following symlinks. */
function entryOf(path: string, abs: string): StateEntry {
  const st = lstatSync(abs);
  if (st.isSymbolicLink()) return { path, kind: "symlink", target: readlinkSync(abs) };
  if (st.isDirectory()) return { path, kind: "dir" };
  if (st.isFile()) {
    const bytes = readFileSync(abs);
    return { path, kind: "file", size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  }
  return { path, kind: "other" };
}

/**
 * Recursive, sorted, hash-bearing listing of a directory tree, INCLUDING the
 * root itself as its first entry (path ".").
 *
 * The root's own existence is a graded fact, not a precondition (W1 boundary
 * review). Reporting only the children made an ABSENT root and an existing but
 * EMPTY one the same snapshot — so an engine that deleted its working directory
 * graded identical to one that correctly left it empty, on the surface whose
 * entire reason for existing is to see what a run did to the machine. A missing
 * root is now recorded as `kind: "missing"`, which diffs against the `"dir"` an
 * empty one reports.
 */
export function treeOf(root: string): StateEntry[] {
  // lstat rather than existsSync: a DANGLING symlink is not "missing", it is a
  // symlink, and `existsSync` follows the link and would call it absent.
  if (!lstatSync(root, { throwIfNoEntry: false })) return [{ path: ".", kind: "missing" }];
  const rootEntry = entryOf(".", root);
  const out: StateEntry[] = [rootEntry];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const abs = join(dir, name);
      const entry = entryOf(relative(root, abs), abs);
      out.push(entry);
      if (entry.kind === "dir") walk(abs);
    }
  };
  // A root that is a file or a symlink has no children to walk, and is a
  // difference in its own right.
  if (rootEntry.kind === "dir") walk(root);
  return out;
}

/**
 * The engine's termination, from what the runner captured. `completed` means the
 * query finished without throwing; anything else names the failure, with the
 * child's exit code when the SDK reported one.
 */
export function engineOutcome(messages: readonly unknown[]): string {
  const thrown = messages.find((m) => (m as { type?: string }).type === "reforge-exception") as
    | { name?: string; message?: string }
    | undefined;
  if (!thrown) return "completed";
  const text = String(thrown.message ?? "");
  const code = /exited with code (\d+)/.exec(text);
  if (code) return `exit:${code[1]}`;
  const signal = /signal (SIG[A-Z0-9]+)/.exec(text);
  if (signal) return `signal:${signal[1]}`;
  // A thrown query that named no child status is still an outcome, and the
  // engines must agree on WHICH: the class alone, since the message text is
  // already graded on the transcript surface.
  return `error:${thrown.name ?? "Error"}`;
}

export function stateSnapshot(sandbox: string, messages: readonly unknown[]): StateSnapshot {
  return { sandbox: treeOf(sandbox), engine: engineOutcome(messages) };
}
