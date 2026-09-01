// W5 probe — WHICH hook events actually fire on the headless seam, and can a
// COMMAND hook (a shell script, not a callback) be registered without touching
// the filesystem's settings layers?
//
// Campaign spec C8 / the live-probe-first discipline. The W5 scout inherited
// "8 of 30 events fire headlessly" from `docs/parity/coverage.md`, which is a
// 2026-06 measurement against a different pin. The wave's whole corpus plan and
// every exclusion it records rests on that set, so it is re-measured here
// against the PINNED engine before any scenario is recorded.
//
// The second question is the wave's one non-trivial fixture. `Options.hooks`
// takes CALLBACKS only (`HookCallbackMatcher.hooks: HookCallback[]`), and a
// callback never reaches the executor's command path — so nothing in the corpus
// grades the hook-input record as the BYTE STREAM a command hook reads on stdin,
// which is what the owned PostToolUse module's field order actually is. Command
// hooks live in settings, and `settingSources: ["project"]` would drag the
// operator's ancestor `.claude/` directories in (the W3 recording trap). The
// SDK's `Options.settings` is the way out if it works: an INLINE settings object
// loaded into the flag-settings layer, no filesystem source enabled.
//
// One live turn, recorded to a throwaway cassette that is deleted afterwards.
//
// Run: cd reforge && set -a; . ../.env; set +a; npx tsx w5/probe-hook-events.ts
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { query, type HookEvent } from "@anthropic-ai/claude-agent-sdk";
import { baseOptions, resetSandbox, type ScenarioContext } from "../src/harness.js";
import { requireRecordCredential } from "../src/env.js";
import { startRecordProxy } from "../src/proxy.js";
import { enginePath, REFORGE_ROOT, SANDBOX } from "../src/runTurn.js";

requireRecordCredential();

/**
 * Every event with a dispatcher in the pinned engine chunk that a single
 * tool-using turn could plausibly reach, plus the four `coverage.md` calls
 * dormant or out of band — the point is to measure the boundary, not to confirm
 * the middle.
 */
const WATCHED: HookEvent[] = [
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "PostToolBatch",
  "UserPromptSubmit",
  "Stop",
  "SubagentStart",
  "SubagentStop",
  "MessageDisplay",
  "SessionStart",
  "SessionEnd",
  "Notification",
  "PreCompact",
];

const STDIN_DUMP = join(SANDBOX, "probe-command-hook-stdin.json");

async function main(): Promise<void> {
  const cassette = join(REFORGE_ROOT, "cassettes", "w5-probe.jsonl.tmp");
  rmSync(cassette, { force: true });
  mkdirSync(join(REFORGE_ROOT, "cassettes"), { recursive: true });
  resetSandbox();
  const proxy = await startRecordProxy(cassette);
  const fired = new Map<string, number>();
  const ctx: ScenarioContext = {
    engine: enginePath("engine-real"),
    baseUrl: `http://127.0.0.1:${proxy.port}`,
    collect: (event) => fired.set(event, (fired.get(event) ?? 0) + 1),
    mode: "record",
  };

  const hooks = Object.fromEntries(
    WATCHED.map((e) => [
      e,
      [{ hooks: [async () => (ctx.collect(e), { continue: true } as const)] }],
    ]),
  );

  try {
    for await (const _m of query({
      prompt:
        "You must emit TWO Bash tool_use blocks in a SINGLE assistant response — do not wait for any result before issuing the next. The two commands, in this order: `echo REFORGE_PROBE_1`, `echo REFORGE_PROBE_2`. After both results come back, reply with their outputs joined by a comma.",
      options: {
        ...baseOptions(ctx),
        allowedTools: ["Bash"],
        maxTurns: 4,
        permissionMode: "bypassPermissions",
        hooks,
        // The question this probe exists for: an inline settings object, with
        // `settingSources: []` still in force from baseOptions().
        settings: {
          hooks: {
            PostToolUse: [
              { hooks: [{ type: "command", command: `cat > ${JSON.stringify(STDIN_DUMP)}` }] },
            ],
          },
        },
      },
    })) {
      void _m;
    }
  } catch (e) {
    console.log(`  query threw: ${(e as Error).message.slice(0, 200)}`);
  }
  await proxy.close();
  rmSync(cassette, { force: true });

  console.log("\n=== which callback events fired (pinned engine, headless SDK seam) ===");
  for (const e of WATCHED) console.log(`  ${fired.has(e) ? "FIRED" : "-    "}  ${e}  ${fired.get(e) ?? 0}`);

  console.log("\n=== command hook via Options.settings (flag-settings layer) ===");
  try {
    const raw = readFileSync(STDIN_DUMP, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    console.log(`  RAN — ${raw.length} bytes on stdin`);
    console.log(`  key order: ${Object.keys(parsed).join(", ")}`);
  } catch {
    console.log("  did NOT run (no stdin dump written)");
  }
}

await main();
