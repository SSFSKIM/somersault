// Probe 18c — can the headless auto-mode classifier be FORCE-ACTIVATED via env flags?
// 18 + 18b proved auto ≡ default headlessly (classifier dormant). The bundle declares the classifier behind
// env flags: CLAUDE_CODE_AUTO_MODE_MODEL (str), CLAUDE_CODE_BG_CLASSIFIER_MODEL (str), CLAUDE_CODE_TWO_STAGE_
// CLASSIFIER (bool). This decides the increment-4 architecture: is the classifier "dormant-but-activatable"
// (flip a flag) or "truly absent from the headless engine" (must build our own classifier-broker)?
//
// Setup mirrors 18b (NO canUseTool, settingSources:[]) so only an in-engine classifier could approve a
// mutation — but here we FORCE the flags on via options.env. NOTE: options.env REPLACES the subprocess env
// (sdk-options-gotchas memory), so we spread process.env to keep PATH + ANTHROPIC_API_KEY + auth intact.
//   baseline (18b): auto edit-benign → blocked
//   if forced flags → CHANGED  ⇒ classifier DORMANT-BUT-ACTIVATABLE (increment 4 can flip a flag)
//   if forced flags → blocked  ⇒ classifier TRULY ABSENT headlessly (increment 4 must build its own)
import { query } from "@anthropic-ai/claude-agent-sdk";
import { brief } from "../lib/runProbe.ts";
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MODEL = "claude-haiku-4-5-20251001";
const CLASSIFIER_ENV = {
  CLAUDE_CODE_AUTO_MODE_MODEL: "claude-haiku-4-5-20251001",
  CLAUDE_CODE_BG_CLASSIFIER_MODEL: "claude-haiku-4-5-20251001",
  CLAUDE_CODE_TWO_STAGE_CLASSIFIER: "1",
};

type Op = { key: string; prompt: string; changed: (dir: string) => boolean };
const OPS: Op[] = [
  { key: "edit-benign", prompt: "Edit note.txt, replacing the word ORIGINAL with CHANGED. Do nothing else.",
    changed: (d) => existsSync(join(d, "note.txt")) && readFileSync(join(d, "note.txt"), "utf8").includes("CHANGED") },
  { key: "bash-rm",     prompt: "Run exactly this bash command and nothing else: rm disposable.txt",
    changed: (d) => !existsSync(join(d, "disposable.txt")) },
];

function freshDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "probe18c-"));
  writeFileSync(join(dir, "note.txt"), "ORIGINAL\n");
  writeFileSync(join(dir, "disposable.txt"), "delete me\n");
  return dir;
}

async function cell(mode: string, op: Op, forceFlags: boolean) {
  const dir = freshDir();
  const toolsRun: string[] = []; const denials: string[] = [];
  let result: any, err: string | undefined;
  const opts: Record<string, unknown> = { model: MODEL, cwd: dir, maxTurns: 6, permissionMode: mode as any, settingSources: [] };
  if (forceFlags) opts.env = { ...process.env, ...CLASSIFIER_ENV };  // spread keeps auth+PATH (env REPLACES)
  try {
    for await (const m of query({ prompt: op.prompt, options: opts as any })) {
      if (m.type === "assistant")
        for (const b of (m as any).message?.content ?? []) if (b?.type === "tool_use") toolsRun.push(b.name);
      if (m.type === "user")
        for (const b of (m as any).message?.content ?? [])
          if (b?.type === "tool_result" && typeof b.content === "string" && /permission|denied|not allowed|requires/i.test(b.content))
            denials.push(brief(b.content, 90));
      if ("result" in m) result = m;
    }
  } catch (e: any) { err = e.message; }
  return { changed: op.changed(dir), toolsRun: [...new Set(toolsRun)], denials, subtype: result?.subtype, err };
}

console.log("=== PROBE 18c — force-activate auto-mode classifier via env flags ===  model:", MODEL);
console.log("forced env:", brief(CLASSIFIER_ENV), "\n");

const ROWS: Array<{ label: string; mode: string; force: boolean }> = [
  { label: "auto (no flags / baseline)", mode: "auto", force: false },
  { label: "auto (CLASSIFIER FLAGS forced)", mode: "auto", force: true },
  { label: "default (CLASSIFIER FLAGS forced)", mode: "default", force: true },
  { label: "bypassPermissions (control)", mode: "bypassPermissions", force: false },
];

const grid: Record<string, Record<string, boolean[]>> = {};
for (const row of ROWS) {
  grid[row.label] = {};
  console.log(`[${row.label}]`);
  for (const op of OPS) {
    const r1 = await cell(row.mode, op, row.force);
    const r2 = await cell(row.mode, op, row.force);
    grid[row.label][op.key] = [r1.changed, r2.changed];
    console.log(
      `  ${op.key.padEnd(12)} changed:${r1.changed}/${r2.changed}  ranTools:${brief([...new Set([...r1.toolsRun, ...r2.toolsRun])])}` +
      `  subtype:${r1.subtype}${r1.denials.length || r2.denials.length ? "  denial:" + brief(r1.denials[0] ?? r2.denials[0], 60) : ""}` +
      `${r1.err || r2.err ? "  ERR:" + brief(r1.err ?? r2.err, 50) : ""}`,
    );
  }
  console.log("");
}

console.log("========================= VERDICT =========================");
const det = (a: boolean[]) => (a.every((x) => x) ? "CHANGED" : a.every((x) => !x) ? "blocked" : "FLAKY");
const baseline = det(grid["auto (no flags / baseline)"]["edit-benign"]);
const forced = det(grid["auto (CLASSIFIER FLAGS forced)"]["edit-benign"]);
console.log(`auto edit-benign:  baseline=${baseline}   forced-flags=${forced}`);
if (baseline === "blocked" && forced === "CHANGED")
  console.log("  → DORMANT-BUT-ACTIVATABLE: env flags wake the headless classifier ⇒ increment 4 can flip a flag.");
else if (forced === "blocked")
  console.log("  → TRULY ABSENT headlessly: forcing the flags changes nothing ⇒ increment 4 must build its own classifier-broker.");
else
  console.log("  → INCONCLUSIVE — inspect rows.");
