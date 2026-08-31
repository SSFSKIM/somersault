// Negative controls for the state surface (campaign spec §3.2, C4/W1).
//
//   npx tsx src/state.test.ts
//
// A fourth diff surface that cannot see a difference is worse than no fourth
// surface: it reports "identical" on every scenario and reads as evidence. So
// each thing this surface claims to catch is watched being caught, on a
// throwaway fixture tree — and each thing it deliberately ignores is watched
// being ignored, because a snapshot that flags mtimes would flag every run.
//
// That argument applies to the sandbox ROOT as much as to its contents, which is
// what the W1 boundary review found missing: see the final block.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diffTranscripts } from "./differ.js";
import { engineOutcome, treeOf } from "./state.js";

let pass = 0;
const failures: string[] = [];
const check = (label: string, ok: boolean, detail = ""): void => {
  if (ok) pass++;
  else failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
};
const differs = (a: unknown, b: unknown) => diffTranscripts([a], [b]).length > 0;

const root = mkdtempSync(join(tmpdir(), "reforge-state-"));
try {
  mkdirSync(join(root, "sub"));
  writeFileSync(join(root, "a.txt"), "ALPHA");
  writeFileSync(join(root, "sub", "b.txt"), "BETA");
  symlinkSync("a.txt", join(root, "link"));
  const base = treeOf(root);

  check("the tree is sorted and complete, and starts at the root itself",
    JSON.stringify(base.map((e) => e.path)) === JSON.stringify([".", "a.txt", "link", "sub", "sub/b.txt"]));
  check("files carry a size and a content hash", base[1].kind === "file" && base[1].size === 5 && /^[0-9a-f]{64}$/.test(base[1].sha256 ?? ""));
  check("a symlink records its target, not its contents", base[2].kind === "symlink" && base[2].target === "a.txt");
  check("directories are entries in their own right", base[3].kind === "dir" && base[3].sha256 === undefined);
  check("an absent root is a snapshot, not a throw", treeOf(join(root, "nope")).length === 1);
  check("re-reading an unchanged tree is identical", !differs(base, treeOf(root)));

  // The claim the surface exists for: content that changed WITHOUT changing size
  // is exactly what a size-only or name-only tree walk misses.
  writeFileSync(join(root, "a.txt"), "OMEGA");
  check("a same-length content change is caught", differs(base, treeOf(root)));
  writeFileSync(join(root, "a.txt"), "ALPHA");
  check("…and restoring the content makes it identical again", !differs(base, treeOf(root)));

  writeFileSync(join(root, "extra.txt"), "x");
  check("a stray extra file is caught", differs(base, treeOf(root)));
  rmSync(join(root, "extra.txt"));

  rmSync(join(root, "sub", "b.txt"));
  check("a missing file is caught", differs(base, treeOf(root)));
  writeFileSync(join(root, "sub", "b.txt"), "BETA");
  check("…and restoring it makes it identical again", !differs(base, treeOf(root)));

  // …and the deliberate blind spot, asserted as a blind spot.
  utimesSync(join(root, "a.txt"), new Date(0), new Date(0));
  check("an mtime change is IGNORED, as the canonicalization says", !differs(base, treeOf(root)));
} finally {
  rmSync(root, { recursive: true, force: true });
}

// ---- the root's own existence (W1 boundary review) ---------------------------
// The pair the surface used to be blind to: an engine that DELETES its working
// directory and one that correctly leaves it empty both produced the same empty
// listing, on the one surface whose whole job is seeing what a run did to the
// machine. Both halves are watched — the difference must be caught, and two
// genuinely-identical empty sandboxes must still match.
{
  const box = mkdtempSync(join(tmpdir(), "reforge-root-"));
  try {
    const emptyDir = join(box, "empty");
    const alsoEmpty = join(box, "also-empty");
    const gone = join(box, "gone");
    mkdirSync(emptyDir);
    mkdirSync(alsoEmpty);

    const empty = treeOf(emptyDir);
    const absent = treeOf(gone);
    check("an EXISTING empty root reports itself as a directory",
      empty.length === 1 && empty[0].path === "." && empty[0].kind === "dir");
    check("an ABSENT root reports itself as missing",
      absent.length === 1 && absent[0].path === "." && absent[0].kind === "missing");
    check("a deleted working directory DIFFERS from an empty one", differs(absent, empty),
      "THE DEFECT: both used to be the empty array, so deleting the sandbox graded as leaving it clean");
    check("…and two existing empty roots still match", !differs(empty, treeOf(alsoEmpty)));

    // The same claim once the root is deleted out from under a populated tree.
    writeFileSync(join(emptyDir, "f.txt"), "x");
    const populated = treeOf(emptyDir);
    rmSync(emptyDir, { recursive: true, force: true });
    check("deleting the root after writing into it is caught", differs(populated, treeOf(emptyDir)));

    // A root REPLACED by a file is neither missing nor an empty directory.
    writeFileSync(gone, "not a directory");
    const asFile = treeOf(gone);
    check("a root replaced by a file records its kind, and differs from both",
      asFile.length === 1 && asFile[0].kind === "file" && differs(asFile, empty) && differs(asFile, absent));
  } finally {
    rmSync(box, { recursive: true, force: true });
  }
}

// ---- the derived exit half --------------------------------------------------
{
  check("a query that finished is 'completed'", engineOutcome([{ type: "result" }]) === "completed");
  check("a non-zero child exit is reported with its code",
    engineOutcome([{ type: "reforge-exception", name: "Error", message: "Claude Code process exited with code 3" }]) === "exit:3");
  check("a signalled child is reported with its signal",
    engineOutcome([{ type: "reforge-exception", name: "Error", message: "process killed by signal SIGKILL" }]) === "signal:SIGKILL");
  check("any other throw is reported by class",
    engineOutcome([{ type: "reforge-exception", name: "AbortError", message: "aborted" }]) === "error:AbortError");
  check("two different exits differ", differs(engineOutcome([{ type: "result" }]), engineOutcome([
    { type: "reforge-exception", name: "Error", message: "exited with code 1" },
  ])));
}

console.log(`=== state surface: ${pass} check(s) ===`);
for (const f of failures) console.log(`  FAIL — ${f}`);
if (pass === 0) {
  console.log("FAIL — no control ran");
  process.exitCode = 1;
} else {
  console.log(
    failures.length === 0
      ? "PASS — the state surface catches content, presence and exit differences, and ignores only what it says it ignores"
      : `FAIL — ${failures.length} control(s) failed`,
  );
  process.exitCode = failures.length === 0 ? 0 : 1;
}
