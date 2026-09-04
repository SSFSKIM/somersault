// Controls for the config-directory precondition and the filesystem fault
// surface (C12a/W9a). A fault that does not damage anything is a scenario that
// grades nothing while looking like evidence, so each transformation is watched
// doing what its name says — and the wipe is watched surviving the one fault
// designed to defeat it.
//
//   npx tsx src/precondition.test.ts
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyPrecondition, baselineConfigJson, projectKeyFor, wipeConfigDir } from "./precondition.js";
import { censusConfigDir } from "./observed.js";

let pass = 0;
const failures: string[] = [];
const check = (label: string, ok: boolean, detail = ""): void => {
  if (ok) pass++;
  else failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
};

const PIN = "2.1.251";
const REL = "projects/-box-sandbox/s.jsonl";
const line = (r: Record<string, unknown>) => JSON.stringify(r) + "\n";
const transcript =
  line({ type: "user", uuid: "u1", parentUuid: null }) +
  line({ type: "assistant", uuid: "u2", parentUuid: "u1" }) +
  line({ type: "user", uuid: "u3", parentUuid: "u2" }) +
  line({ type: "last-prompt", leafUuid: "u3" });

const rows = (text: string) => text.split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);

const box = mkdtempSync(join(tmpdir(), "reforge-pre-"));
try {
  // ---- the project key, which every seed path is built from -----------------
  check("the project key flattens every non-alphanumeric byte to a dash",
    projectKeyFor("/private/tmp/reforge w9.test") === "-private-tmp-reforge-w9-test",
    projectKeyFor("/private/tmp/reforge w9.test"));

  // ---- the EMPTY precondition seeds a baseline, not nothing ------------------
  const cfg = join(box, "config");
  applyPrecondition(cfg, {}, PIN);
  check("the empty precondition seeds .claude.json", existsSync(join(cfg, ".claude.json")));
  check("…with the pin's version and a fixed identity, so nothing is minted per run",
    (() => {
      const j = JSON.parse(readFileSync(join(cfg, ".claude.json"), "utf8")) as Record<string, unknown>;
      return j.firstStartVersion === PIN && typeof j.machineID === "string" && j.skillUsage === undefined;
    })());
  check("…and it is byte-identical to baselineConfigJson (the seed IS the documented baseline)",
    readFileSync(join(cfg, ".claude.json"), "utf8") === baselineConfigJson(PIN));

  // ---- torn tail -------------------------------------------------------------
  {
    const c = join(box, "torn");
    applyPrecondition(c, { seed: [{ path: REL, content: transcript }], faults: [{ kind: "torn-tail", target: REL }] }, PIN);
    const text = readFileSync(join(c, REL), "utf8");
    check("torn-tail leaves the file WITHOUT a trailing newline", !text.endsWith("\n"));
    check("…and its last line no longer parses", (() => { try { JSON.parse(text.split("\n").pop()!); return false; } catch { return true; } })());
    check("…while every record before it survives whole", rows(text.split("\n").slice(0, -1).join("\n")).length === 3);
    // The negative control on the fault itself: the healthy seed is NOT torn.
    const h = join(box, "healthy");
    applyPrecondition(h, { seed: [{ path: REL, content: transcript }] }, PIN);
    check("…and an unfaulted seed is byte-identical to what the scenario declared", readFileSync(join(h, REL), "utf8") === transcript);
  }

  // ---- parent cycle ----------------------------------------------------------
  {
    const c = join(box, "cycle");
    applyPrecondition(c, { seed: [{ path: REL, content: transcript }], faults: [{ kind: "parent-cycle", target: REL }] }, PIN);
    const r = rows(readFileSync(join(c, REL), "utf8"));
    const chained = r.filter((x) => typeof x.uuid === "string");
    const [a, b] = chained.slice(-2);
    check("parent-cycle points the last two chained records at each other", a.parentUuid === b.uuid && b.parentUuid === a.uuid);
    check("…so a walk up from the leaf cannot reach the first exchange",
      (() => {
        const byUuid = new Map(chained.map((x) => [x.uuid as string, x]));
        const seen = new Set<string>();
        let at: string | null = r.find((x) => x.type === "last-prompt")!.leafUuid as string;
        while (at !== null && !seen.has(at)) {
          seen.add(at);
          at = (byUuid.get(at)?.parentUuid ?? null) as string | null;
        }
        return !seen.has("u1");
      })());
    check("…and no record is added or lost", r.length === 4);
  }

  // ---- read-only store, and the wipe that has to survive it -------------------
  {
    const c = join(box, "ro");
    const keep = "projects/-box-sandbox/.keep";
    // THROUGH THE FAULT KIND. This control used to seed the mode inline
    // (`dirMode: 0o500`) and never pass `kind: "read-only-store"` at all, so the
    // fault it is named for had no caller in the repo and was inert under the
    // usage its own contract documented — it chmodded the TARGET FILE, which
    // leaves creating a new file in the directory legal, which is the act the
    // store performs.
    applyPrecondition(c, { seed: [{ path: keep, content: "" }], faults: [{ kind: "read-only-store", target: keep }] }, PIN);
    const create = (root: string): string => {
      try {
        writeFileSync(join(root, "projects/-box-sandbox/new.jsonl"), "x");
        return "";
      } catch (e) {
        return (e as NodeJS.ErrnoException).code ?? "?";
      }
    };
    const denied = create(c);
    check("read-only-store makes the store's own act — CREATING a session file in the project directory — fail with EACCES",
      denied === "EACCES", denied === "" ? "the write SUCCEEDED" : denied);
    // THE ABSENCE CONTROL: without the fault the identical write lands, so the
    // check above is not passing on something the seed did.
    const w = join(box, "ro-absent");
    applyPrecondition(w, { seed: [{ path: keep, content: "" }] }, PIN);
    check("…and with the fault ABSENT the identical write succeeds", create(w) === "", create(w) || "still denied");
    // AND IT IS THE DIRECTORY: the file the fault names keeps its own mode.
    check("…the fault takes the write bit off the CONTAINING DIRECTORY and leaves the named file writable",
      (lstatSync(join(c, "projects/-box-sandbox")).mode & 0o200) === 0 && (lstatSync(join(c, keep)).mode & 0o200) !== 0,
      `dir ${(lstatSync(join(c, "projects/-box-sandbox")).mode & 0o777).toString(8)}, file ${(lstatSync(join(c, keep)).mode & 0o777).toString(8)}`);
    // THE REASON THIS CONTROL EXISTS: the reset runs after the faulted run, and a
    // reset the previous scenario can defeat is not a reset.
    wipeConfigDir(c);
    check("…and the wipe still empties the directory afterwards", readdirSync(c).length === 0);
  }

  // ---- a symlink is a LEAF: neither the wipe nor the census goes through one --
  // Both walks used `statSync`, which resolves the link. The wipe would then
  // chmod 0o700 down a tree it does not own (it restores write permission on
  // the way down so the read-only fault cannot defeat the reset), and the census
  // would tally another directory's contents as config-dir writes — or, for a
  // link to an ancestor, throw ELOOP and take the reset with it.
  {
    const c = join(box, "link");
    const outside = join(box, "outside");
    mkdirSync(join(outside, "sub"), { recursive: true });
    writeFileSync(join(outside, "sub", "keepme"), "external");
    chmodSync(join(outside, "sub"), 0o500);
    mkdirSync(c, { recursive: true });
    symlinkSync(outside, join(c, "elsewhere"));
    writeFileSync(join(c, "own.txt"), "x");
    const censusPath = join(box, "census.json");
    censusConfigDir(c, censusPath, PIN);
    const entries = Object.keys((JSON.parse(readFileSync(censusPath, "utf8")) as { entries: Record<string, unknown> }).entries);
    check("the census records a directory symlink as a leaf and nothing beneath it",
      entries.includes("elsewhere") && entries.includes("own.txt") && !entries.some((k) => k.startsWith("elsewhere/")),
      entries.join(", "));

    // …AND SO IS A SYMLINKED `.jsonl`, in the SECOND walk — the transcript
    // census under `projects/`, which read `isDirectory()` alone. A link to a
    // file is not a directory, so it fell through to the queue and
    // `readFileSync` FOLLOWED it: another file's ids tallied as this config
    // dir's. A dangling one threw, inside a reset. The first round of this fix
    // took the directory walk only, and its commit claimed the census "no
    // longer walks through one" — true of directory links alone.
    const proj = join(c, "projects", "-box-sandbox-links");
    mkdirSync(proj, { recursive: true });
    writeFileSync(join(outside, "elsewhere.jsonl"), JSON.stringify({ type: "user", linkedOnly: "cafebabecafebabe" }) + "\n");
    symlinkSync(join(outside, "elsewhere.jsonl"), join(proj, "linked.jsonl"));
    symlinkSync(join(outside, "never-existed.jsonl"), join(proj, "dangling.jsonl"));
    writeFileSync(join(proj, "own.jsonl"), JSON.stringify({ type: "user", ownOnly: "0123456789ab" }) + "\n");
    const linkCensus = join(box, "census-links.json");
    censusConfigDir(c, linkCensus, PIN);
    const shapes = Object.keys((JSON.parse(readFileSync(linkCensus, "utf8")) as { idShapes: Record<string, unknown> }).idShapes);
    check("a symlinked .jsonl is neither read through by the transcript census nor fatal when it dangles",
      shapes.includes("ownOnly") && !shapes.includes("linkedOnly"), shapes.join(", "));

    wipeConfigDir(c);
    check("…and the wipe removes the link itself", readdirSync(c).length === 0);
    check("…including the linked transcript, whose target survives the wipe",
      readFileSync(join(outside, "elsewhere.jsonl"), "utf8").includes("linkedOnly"));
    check("…leaving the external tree it pointed at untouched, mode and contents",
      (lstatSync(join(outside, "sub")).mode & 0o777) === 0o500 && readFileSync(join(outside, "sub", "keepme"), "utf8") === "external",
      `mode ${(lstatSync(join(outside, "sub")).mode & 0o777).toString(8)}`);
  }

  // ---- the wipe is total, and the seed comes back on top ---------------------
  {
    const c = join(box, "wipe");
    mkdirSync(join(c, "tasks", "list-1"), { recursive: true });
    writeFileSync(join(c, "tasks", "list-1", "meta"), "{}");
    writeFileSync(join(c, ".claude.json"), JSON.stringify({ skillUsage: { probe: { usageCount: 299 } } }));
    wipeConfigDir(c);
    check("the wipe removes everything the engine wrote, including a monotonic counter", readdirSync(c).length === 0);
    applyPrecondition(c, {}, PIN);
    check("…and the counter comes back ABSENT, which is what a config dir that has seen no skill carries",
      JSON.parse(readFileSync(join(c, ".claude.json"), "utf8")).skillUsage === undefined);
  }
} finally {
  try {
    chmodSync(join(box, "outside", "sub"), 0o700);
    chmodSync(join(box, "ro", "projects", "-box-sandbox"), 0o700);
  } catch {
    // already restored by the wipe control above
  }
  rmSync(box, { recursive: true, force: true });
}

console.log(`=== config precondition + fs faults: ${pass} check(s) ===`);
for (const f of failures) console.log(`  FAIL — ${f}`);
if (pass === 0) {
  console.log("FAIL — no control ran");
  process.exitCode = 1;
} else {
  console.log(failures.length === 0 ? "PASS — every seed lands and every fault damages exactly what its name says" : `FAIL — ${failures.length} control(s) failed`);
  process.exitCode = failures.length === 0 ? 0 : 1;
}
