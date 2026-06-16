// Probe 03 — filesystem commands + skills load via settingSources:['project'].
import { query } from "@anthropic-ai/claude-agent-sdk";
import { brief } from "../lib/runProbe.ts";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "probe-settings-"));
mkdirSync(join(dir, ".claude", "commands"), { recursive: true });
mkdirSync(join(dir, ".claude", "skills", "probeskill"), { recursive: true });
writeFileSync(
  join(dir, ".claude", "commands", "probecmd.md"),
  "---\ndescription: A trivial probe command\n---\nSay PROBECMD-RAN.\n",
);
writeFileSync(
  join(dir, ".claude", "skills", "probeskill", "SKILL.md"),
  "---\nname: probeskill\ndescription: A trivial probe skill used to verify settingSources loading.\n---\nThis skill exists only for the parity probe.\n",
);

const q = query({
  prompt: "Reply OK",
  options: {
    maxTurns: 1,
    permissionMode: "bypassPermissions",
    cwd: dir,
    settingSources: ["project"],
  },
});

let systemInit: any;
let cmds: any[] = [];
for await (const m of q) {
  if (m.type === "system" && (m as any).subtype === "init") {
    systemInit = m;
    try { cmds = await q.supportedCommands(); } catch (e: any) { cmds = [{ name: `ERR ${e.message}` }]; }
  }
  if ("result" in m) break;
}

const cmdNames = (cmds || []).map((c: any) => (typeof c === "string" ? c : c?.name)).filter(Boolean);
const initCmds = systemInit?.slash_commands || [];
const hasProbeCmd =
  cmdNames.some((n: string) => n.includes("probecmd")) ||
  initCmds.some((n: string) => String(n).includes("probecmd"));

// Skill detection: skills may surface in init.slash_commands (as a /-command),
// in supportedCommands, or as a loaded tool. Check broadly.
const allText = JSON.stringify({ init: systemInit, cmds });
const hasProbeSkill = /probeskill/i.test(allText);

console.log("=== PROBE 03 settingSources ===");
console.log("tmpdir:", dir);
console.log("supportedCommands.count:", cmdNames.length);
console.log("probecmd in commands:", hasProbeCmd, "| matches:", brief(cmdNames.filter((n: string) => n.includes("probe"))));
console.log("init.slash_commands has probecmd:", initCmds.some((n: string) => String(n).includes("probecmd")));
console.log("probeskill referenced anywhere:", hasProbeSkill);

const pass = hasProbeCmd;
console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
console.log("skill-load note:", hasProbeSkill ? "skill referenced (loaded)" : "skill not surfaced in init/commands");
