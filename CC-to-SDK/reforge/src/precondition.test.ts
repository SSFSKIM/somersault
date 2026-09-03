// Controls for the config-directory precondition and the filesystem fault
// surface (C12a/W9a). A fault that does not damage anything is a scenario that
// grades nothing while looking like evidence, so each transformation is watched
// doing what its name says — and the wipe is watched surviving the one fault
// designed to defeat it.
//
//   npx tsx src/precondition.test.ts
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyPrecondition, baselineConfigJson, projectKeyFor, wipeConfigDir } from "./precondition.js";

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
    applyPrecondition(c, { seed: [{ path: keep, content: "", dirMode: 0o500 }] }, PIN);
    let denied = "";
    try {
      writeFileSync(join(c, "projects/-box-sandbox/new.jsonl"), "x");
    } catch (e) {
      denied = (e as NodeJS.ErrnoException).code ?? "";
    }
    check("read-only-store makes a write into the project directory fail with EACCES", denied === "EACCES", denied || "the write SUCCEEDED");
    // THE REASON THIS CONTROL EXISTS: the reset runs after the faulted run, and a
    // reset the previous scenario can defeat is not a reset.
    wipeConfigDir(c);
    check("…and the wipe still empties the directory afterwards", readdirSync(c).length === 0);
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
