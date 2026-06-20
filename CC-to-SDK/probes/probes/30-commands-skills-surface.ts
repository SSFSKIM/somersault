// probes/probes/30-commands-skills-surface.ts — A1 for Increment D (skills/plugins/slash-command surface).
// The audit said "skills, plugins, other slash commands all need installing." Probe 27 already showed
// supportedCommands() returns ~92 entries headless. This probe answers the DECLARED-surface questions that
// drive the design: WHAT are those 92 entries (shape/fields), are skills/plugins among them, and is there a
// native Skill tool? (Reachability — can you INVOKE a command/skill headless — is a separate probe.)
// Run from CC-to-SDK/probes:  set -a; . ../.env; set +a; unset ANTHROPIC_API_KEY; npx tsx probes/30-commands-skills-surface.ts
import { openSession } from "../../harness/dist/index.js";

(async () => {
  console.log("=== probe 30: commands / skills / plugins declared surface ===");
  const s = openSession({ model: "claude-opus-4-8", permissionMode: "bypassPermissions" } as any);
  try {
    // capabilities() works pre-turn on the harness Session path (probe 29), but pump one turn to be safe.
    await s.submit("Reply with exactly the single word OK.", () => {});
    const caps: any = await s.capabilities();
    const cmds: any[] = caps.commands ?? [];
    const models: any[] = caps.models ?? [];
    const mcp: any[] = caps.mcpServers ?? [];

    console.log(`\ncounts: commands=${cmds.length}  models=${models.length}  mcpServers=${mcp.length}`);

    // shape of a command entry
    const sample = cmds[0];
    console.log("\ncommand[0] keys:", sample ? Object.keys(sample) : "(none)");
    console.log("command[0] sample:", JSON.stringify(sample));

    // collect the union of all keys across command entries (fields may be sparse)
    const allKeys = new Set<string>();
    for (const c of cmds) for (const k of Object.keys(c ?? {})) allKeys.add(k);
    console.log("union of command keys:", [...allKeys].join(", "));

    // names — first 40, to see what kind of commands these are (built-ins? skills? plugin-namespaced?)
    const names = cmds.map((c) => c?.name ?? c?.command ?? c?.value ?? JSON.stringify(c)).filter(Boolean);
    console.log(`\nall ${names.length} command names:\n` + names.map((n: string) => "  " + n).join("\n"));

    // heuristics: which look like skills / plugins / built-ins?
    const pluginish = names.filter((n: string) => n.includes(":") || /plugin/i.test(n));
    const skillish = names.filter((n: string) => /skill/i.test(n));
    console.log(`\nplugin-namespaced (contains ':' or 'plugin'): ${pluginish.length}`, pluginish.slice(0, 20));
    console.log(`skill-ish names: ${skillish.length}`, skillish.slice(0, 20));

    // is there a per-command source/plugin/isBuiltin marker? dump a few with non-trivial fields
    const withSource = cmds.filter((c) => c && (c.source || c.pluginName || c.isBuiltin !== undefined || c.argumentHint));
    console.log(`\ncommands carrying source/plugin/isBuiltin/argumentHint: ${withSource.length}`);
    console.log(withSource.slice(0, 8).map((c) => JSON.stringify(c)).join("\n"));

    console.log("\n--- verdict ---");
    console.log(`supportedCommands() declares ${cmds.length} entries headless. See shapes above to decide:`);
    console.log("  · are these built-in slash commands, skills, plugin commands, or a mix?");
    console.log("  · is there enough per-entry metadata (name/description/argumentHint/source) to render a CC-style palette?");
  } catch (e) {
    console.log("PROBE ERROR:", (e as Error).message);
    process.exitCode = 1;
  } finally {
    await s.dispose();
  }
})();
