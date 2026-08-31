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
//    created, and it is compared entry for entry with content hashes.
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
//    would add noise to every finding without adding a claim.
// Nothing else is normalized: a difference in this surface is a difference.
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import { join, relative } from "node:path";

export interface StateEntry {
  path: string;
  kind: "file" | "dir" | "symlink" | "other";
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

/** Recursive, sorted, hash-bearing listing of a directory tree. */
export function treeOf(root: string): StateEntry[] {
  const out: StateEntry[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const abs = join(dir, name);
      const path = relative(root, abs);
      const st = lstatSync(abs);
      if (st.isSymbolicLink()) {
        out.push({ path, kind: "symlink", target: readlinkSync(abs) });
      } else if (st.isDirectory()) {
        out.push({ path, kind: "dir" });
        walk(abs);
      } else if (st.isFile()) {
        const bytes = readFileSync(abs);
        out.push({ path, kind: "file", size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
      } else {
        out.push({ path, kind: "other" });
      }
    }
  };
  if (existsSync(root)) walk(root);
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
