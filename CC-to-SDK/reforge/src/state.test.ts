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
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diffTranscripts, makeRunNormalizer } from "./differ.js";
import { configInclude, engineOutcome, projectTranscript, rootEntriesOf, treeOf } from "./state.js";

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

// ---- the CONFIG root: the include-list, and what it deliberately does not see -
// C12a/W9a. The second registered root is walked through a DECLARED list rather
// than whole, so the list itself has to be watched admitting and refusing — an
// include-list nobody tests is a blind spot with a comment on it.
{
  const cfg = mkdtempSync(join(tmpdir(), "reforge-config-"));
  try {
    const slug = "-private-tmp-reforge-sandbox";
    mkdirSync(join(cfg, "projects", slug), { recursive: true });
    mkdirSync(join(cfg, "projects", slug, "sess-1", "subagents"), { recursive: true });
    mkdirSync(join(cfg, "sessions"), { recursive: true });
    mkdirSync(join(cfg, "tasks", "list-1"), { recursive: true });
    // …and the three families the list REFUSES, each present in the real config
    // dir today and each excluded for a stated reason (see src/state.ts).
    mkdirSync(join(cfg, "backups"), { recursive: true });
    mkdirSync(join(cfg, "session-env", "sess-1"), { recursive: true });
    mkdirSync(join(cfg, "shell-snapshots"), { recursive: true });
    writeFileSync(join(cfg, "backups", ".claude.json.backup.1788415170183"), "{}");
    writeFileSync(join(cfg, "session-env", "sess-1", "env"), "X=1");
    writeFileSync(join(cfg, "shell-snapshots", "snapshot-zsh-1788-abc.sh"), "true");
    writeFileSync(join(cfg, "sessions", "4711.json"), '{"pid":4711}');
    writeFileSync(join(cfg, "tasks", "list-1", "meta"), "{}");
    writeFileSync(join(cfg, ".claude.json"), JSON.stringify({ machineID: "m", userID: "u", firstStartTime: "t", skillUsage: {} }));
    const line = (r: Record<string, unknown>) => JSON.stringify(r) + "\n";
    const transcript =
      line({ type: "user", uuid: "u1-aaaaaaaa", parentUuid: null, sessionId: "s1-aaaaaaaa", message: { role: "user" } }) +
      line({ type: "assistant", uuid: "u2-aaaaaaaa", parentUuid: "u1-aaaaaaaa", sessionId: "s1-aaaaaaaa", message: { role: "assistant" } });
    writeFileSync(join(cfg, "projects", slug, "s1-aaaaaaaa.jsonl"), transcript);
    writeFileSync(join(cfg, "projects", slug, "sess-1", "subagents", "child.jsonl"), line({ type: "user", uuid: "c1-aaaaaaaa", agentId: "a0123456789abcdef" }));

    const root = { name: "config", path: cfg, include: configInclude };
    const entries = rootEntriesOf(root);
    const paths = entries.map((e) => e.path);
    check("the include-list admits the six §4.2 families",
      [".claude.json", `projects/${slug}/s1-aaaaaaaa.jsonl`, `projects/${slug}/sess-1/subagents/child.jsonl`, "sessions/4711.json", "tasks/list-1/meta"].every((p) => paths.includes(p)),
      JSON.stringify(paths));
    check("…and refuses backups/, session-env/ and shell-snapshots/ — including their directories",
      !paths.some((p) => p.startsWith("backups") || p.startsWith("session-env") || p.startsWith("shell-snapshots")));
    check("an admitted transcript is PROJECTED, never hashed",
      (() => { const e = entries.find((x) => x.path.endsWith("s1-aaaaaaaa.jsonl"))!; return e.records?.length === 2 && e.sha256 === undefined && e.size === undefined; })());
    check("a registry file outside the transcript families is HASHED",
      (() => { const e = entries.find((x) => x.path === "sessions/4711.json")!; return typeof e.sha256 === "string" && e.records === undefined; })());
    check("the project-key slug is lifted out of the path as a property the differ can map",
      entries.filter((e) => e.path.startsWith("projects/")).every((e) => e.slug === slug));
    check(".claude.json is projected with its keys AND its values",
      (() => {
        const p = (entries.find((x) => x.path === ".claude.json")!.records ?? [])[0] as Record<string, unknown>;
        return p.machineID === "m" && JSON.stringify(p.keys) === JSON.stringify(["firstStartTime", "machineID", "skillUsage", "userID"]);
      })());
    // The per-install identity is a DECLARED INPUT (the empty precondition seeds
    // it), so an engine that re-minted one is a difference rather than noise.
    writeFileSync(join(cfg, ".claude.json"), JSON.stringify({ machineID: "OTHER", userID: "u", firstStartTime: "t", skillUsage: {} }));
    check("an engine that RE-MINTED the seeded machine identity is caught", differs(entries, rootEntriesOf(root)));
    writeFileSync(join(cfg, ".claude.json"), JSON.stringify({ machineID: "m", userID: "u", firstStartTime: "t", skillUsage: { probe: { usageCount: 1 } } }));
    check("…but a changed skillUsage counter is caught", differs(entries, rootEntriesOf(root)));

    // THE CLAIM THE PROJECTION EXISTS FOR (spec's C12a bullet): a wrong
    // parentUuid, which the {type, role, sorted keys} shape diff m2/cross-resume
    // has cannot see. Both halves demonstrated — the shape diff PASSING it is
    // what makes the projection catching it evidence.
    const shapeOf = (text: string) =>
      text.split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>)
        .map((r) => ({ type: r.type, role: (r.message as { role?: string })?.role, keys: Object.keys(r).sort() }));
    const rechained = transcript.replace('"parentUuid":"u1-aaaaaaaa"', '"parentUuid":"u2-aaaaaaaa"');
    check("THE DEFECT: the old shape diff passes a record chained to the wrong parent",
      !differs(shapeOf(transcript), shapeOf(rechained)));
    check("…and the semantic projection catches it",
      differs(projectTranscript(transcript).records, projectTranscript(rechained).records));
    // …and it survives the differ's run-id MAP, which is the point of mapping
    // rather than scrubbing: both sides are normalized against their own map first.
    const mapped = (t: string) => { const r = projectTranscript(t).records; return r.map(makeRunNormalizer(r)); };
    check("…and still catches it after both sides go through the run-id map",
      differs(mapped(transcript), mapped(rechained)));
    check("…while a genuine re-run with different uuids does NOT diff",
      !differs(mapped(transcript), mapped(transcript.split("aaaaaaaa").join("bbbbbbbb"))));

    // TWO SESSIONS IN ONE PROJECT — the `/clear` shape, and the one that made
    // `hooks-session-end` report fifty meaningless differences: the file names
    // are random uuids, so listing them alphabetically is a coin flip. Ordered
    // by session creation, two runs whose files sort in OPPOSITE alphabetical
    // order still agree; and a run that lost a session still diffs.
    {
      const twoRuns = (names: [string, string]) => {
        const dir = join(cfg, "projects", slug);
        for (const f of readdirSync(dir)) if (f.endsWith(".jsonl")) rmSync(join(dir, f));
        writeFileSync(join(dir, `${names[0]}.jsonl`), line({ type: "user", uuid: `${names[0]}-u`, sessionId: names[0], timestamp: "2026-09-03T00:00:01.000Z", message: { role: "user" } }));
        writeFileSync(join(dir, `${names[1]}.jsonl`), line({ type: "user", uuid: `${names[1]}-u`, sessionId: names[1], timestamp: "2026-09-03T00:00:02.000Z", message: { role: "user" } }));
        return rootEntriesOf(root).filter((e) => e.path.endsWith(".jsonl"));
      };
      const ascending = twoRuns(["aaaa1111-first", "zzzz9999-second"]);
      const descending = twoRuns(["zzzz9999-first", "aaaa1111-second"]);
      check("two sessions are listed in CREATION order, not file-name order",
        !differs(ascending.map(makeRunNormalizer(ascending)), descending.map(makeRunNormalizer(descending))),
        JSON.stringify(descending.map((e) => e.path)));
      // …and the negative control: losing one is still a difference.
      rmSync(join(cfg, "projects", slug, "aaaa1111-second.jsonl"));
      const one = rootEntriesOf(root).filter((e) => e.path.endsWith(".jsonl"));
      check("…and a run that left only one session still diffs", differs(descending.map(makeRunNormalizer(descending)), one.map(makeRunNormalizer(one))));
      for (const f of readdirSync(join(cfg, "projects", slug))) if (f.endsWith(".jsonl")) rmSync(join(cfg, "projects", slug, f));
      writeFileSync(join(cfg, "projects", slug, "s1-aaaaaaaa.jsonl"), transcript);
    }

    // The torn tail (scout §4.4 D7): a file whose last line has no newline.
    writeFileSync(join(cfg, "projects", slug, "s1-aaaaaaaa.jsonl"), transcript.slice(0, -20));
    const torn = rootEntriesOf(root).find((e) => e.path.endsWith("s1-aaaaaaaa.jsonl"))!;
    check("a torn tail is recorded as one, and its partial record is not silently dropped",
      torn.tornTail === true && (torn.records ?? []).some((r) => (r as { malformed?: boolean }).malformed === true));
    // …and the negative control: a WHOLE file is not reported torn.
    writeFileSync(join(cfg, "projects", slug, "s1-aaaaaaaa.jsonl"), transcript);
    check("a whole file is not reported torn", rootEntriesOf(root).find((e) => e.path.endsWith("s1-aaaaaaaa.jsonl"))!.tornTail === undefined);
  } finally {
    rmSync(cfg, { recursive: true, force: true });
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
      ? "PASS — the state surface catches content, presence, chain and exit differences, and ignores only what it says it ignores"
      : `FAIL — ${failures.length} control(s) failed`,
  );
  process.exitCode = failures.length === 0 ? 0 : 1;
}
