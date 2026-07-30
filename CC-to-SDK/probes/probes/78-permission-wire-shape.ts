// Probe 78 — the gate on the LARGEST cluster in the TUI-clone inventory (69 dialog/permission gaps).
//
// The bundle research found upstream has THIRTEEN per-tool permission dialogs, and that its
// "don't ask again" writes a REAL rule with content (a command prefix, `domain:<host>`, a skill name,
// a directory) into a settings file. Ours is an in-memory Set keyed by tool NAME that dies on restart.
// Two questions decide how much of that is even reachable from a client:
//
//   Q1. FIELD CENSUS — what does canUseTool actually receive? The control protocol DECLARES
//       suppress_always_allow_rule / decision_reason_type / classifier_approvable; reading sdk.mjs
//       said they are never forwarded. Verify on the live wire, and dump EVERY key of every argument
//       (incl. the 3rd `options` arg: suggestions? signal? toolUseId?) for several DIFFERENT tools —
//       upstream branches its dialog on tool identity, so per-tool payload differences are the thing.
//   Q2. updatedPermissions ROUND TRIP — does returning
//       {behavior:"allow", updatedPermissions:[{type:"addRules", rules:[...], behavior:"allow",
//        destination:"session"}]} actually SUPPRESS the next consult for a matching call?
//       That is the whole "don't ask again" feature. `session` is tested here rather than
//       localSettings so the probe cannot write into a real settings file.
// RESULT (run 2026-07-31, sonnet-4-6, keyed) — BOTH questions settled, and the answer is better than
// the inventory assumed. canUseTool's 3rd arg carries:
//   signal · suggestions · blockedPath · decisionReason · title · displayName · description ·
//   toolUseID · agentID · requestId
// A1. The three DECLARED-but-suspected-missing fields are indeed ABSENT: no suppress_always_allow_rule,
//     no decision_reason_type, no classifier_approvable (checked by name, both snake and camel). The
//     "hard ceiling" reading of sdk.mjs is CONFIRMED on the live wire.
//     BUT `decisionReason` (a STRING) *is* forwarded — e.g. "Path is outside allowed working
//     directories" — so a dialog CAN say why it is asking; only the TYPED reason enum is out of reach.
//     `displayName` ("Read"/"Write"/"Edit") and `description` (the subject: a path, "d.txt", "b.txt")
//     are the per-tool dialog title/subject upstream renders — we do not have to derive them.
// A2. `updatedPermissions` ROUND-TRIPS. Granting on the first consult made the SECOND outside-cwd Read
//     produce ZERO consults. A real "don't ask again" is buildable today; our in-memory Set is not the
//     only option.
// THE FINDING THAT CHANGES THE DESIGN: we do not have to CONSTRUCT the rule — the engine SUGGESTS it,
// per tool, in `suggestions`, in exactly the shape `updatedPermissions` accepts. Observed:
//   Read outside cwd → {"type":"addRules","rules":[{"toolName":"Read","ruleContent":"//<dir>/**"}],
//                       "behavior":"allow","destination":"session"}   (TWO variants arrive: the raw and
//                       the symlink-resolved /private path — a dialog must pick, or offer, one)
//   Write / Edit     → {"type":"setMode","mode":"acceptEdits","destination":"session"}
// That is precisely why upstream's file-edit prompt offers "accept edits" while its read prompt offers a
// directory glob: the option wording follows the suggestion KIND. Echo the suggestion back verbatim and
// the feature is done — no rule grammar of our own.
// RUN 1 was INVALID by my own design fault (round trip hung on Bash, which `echo` auto-approves, so the
// rule was never granted); kept in the header above as a caution, re-run against Read.
import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const base = join(tmpdir(), `probe78-${process.pid}`);
mkdirSync(base, { recursive: true });
writeFileSync(join(base, "a.txt"), "ALPHA\n");
writeFileSync(join(base, "b.txt"), "BETA\n");
writeFileSync(join(base, "c.txt"), "GAMMA\n");
mkdirSync(join(tmpdir(), `probe78-outside-${process.pid}`), { recursive: true });
writeFileSync(join(tmpdir(), `probe78-outside-${process.pid}`, "one.txt"), "OUTSIDE-ONE\n");
writeFileSync(join(tmpdir(), `probe78-outside-${process.pid}`, "two.txt"), "OUTSIDE-TWO\n");

const t0 = Date.now();
const dt = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
const log = (s: string) => console.log(`[${dt()}] ${s}`);

const pending: SDKUserMessage[] = [];
let notify: (() => void) | null = null;
let closed = false;
async function* input(): AsyncIterable<SDKUserMessage> {
  while (!closed) {
    while (pending.length) yield pending.shift()!;
    await new Promise<void>((r) => (notify = r));
  }
}
function send(text: string) {
  pending.push({ type: "user", message: { role: "user", content: [{ type: "text", text }] }, parent_tool_use_id: null, session_id: "" } as SDKUserMessage);
  notify?.();
}

const consults: { tool: string; at: string }[] = [];
let grantedRule = false;
// RUN 1 DESIGN FAULT (recorded, not hidden): the round trip was hung on Bash, but `echo` is
// auto-approved and Bash NEVER reached the callback — so the rule was never granted and turn 2's zero
// consults proved nothing. The reliable trigger is a READ OUTSIDE cwd: run 1 consulted exactly those,
// with decisionReason "Path is outside allowed working directories". So grant on the first Read and
// re-read a DIFFERENT outside file afterwards.
const OUT = join(tmpdir(), `probe78-outside-${process.pid}`);

const q = query({
  prompt: input(),
  options: {
    model: "claude-sonnet-4-6",
    cwd: base,
    settingSources: [],
    permissionMode: "default",          // default, NOT bypass: we want the broker to actually fire
    maxTurns: 24,
    canUseTool: async (name, toolInput, options) => {
      consults.push({ tool: name, at: dt() });
      // Q1: the census. Print the FULL key set of every argument — a declared-but-never-forwarded
      // field shows up here as an absence, which is exactly the thing we need to know.
      log(`CONSULT #${consults.length} tool=${name}`);
      log(`  input keys=[${Object.keys(toolInput ?? {}).join(",")}]`);
      const o = (options ?? {}) as Record<string, unknown>;
      log(`  options keys=[${Object.keys(o).join(",")}]`);
      for (const [k, v] of Object.entries(o)) {
        const t = v && typeof v === "object" ? (Array.isArray(v) ? `array(len=${v.length})` : `object{${Object.keys(v).join(",")}}`) : typeof v;
        log(`    options.${k}: ${t}${t === "string" || t === "boolean" || t === "number" ? ` = ${JSON.stringify(v)}` : ""}`);
      }
      for (const declared of ["suppress_always_allow_rule", "suppressAlwaysAllowRule", "decision_reason_type", "decisionReasonType", "classifier_approvable", "classifierApprovable"]) {
        if (declared in o) log(`    !! DECLARED FIELD PRESENT: ${declared} = ${JSON.stringify(o[declared])}`);
      }

      // The `suggestions` array is the interesting one: upstream's "don't ask again" row is built from
      // a suggested RULE, and one arrived on every consult. Dump it whole — its shape IS the feature.
      if (Array.isArray(o.suggestions)) for (const s of o.suggestions as unknown[]) log(`    suggestion: ${JSON.stringify(s)}`);

      // Q2: grant on the FIRST Read consult (the reliable trigger — see the run-1 note above). If the
      // round trip works, the SECOND outside-cwd Read must NOT reach this callback at all.
      if (name === "Read" && !grantedRule) {
        grantedRule = true;
        const sug = (o.suggestions as unknown[] | undefined)?.[0];
        // Prefer the engine's OWN suggestion verbatim when it gives one — if anything round-trips, that does.
        const perms = sug ? [sug] : [{ type: "addRules", rules: [{ toolName: "Read" }], behavior: "allow", destination: "session" }];
        log(`  → returning allow + updatedPermissions=${JSON.stringify(perms)}`);
        return { behavior: "allow", updatedInput: toolInput, updatedPermissions: perms } as any;
      }
      return { behavior: "allow", updatedInput: toolInput };
    },
  },
});

async function drainTurn(label: string): Promise<void> {
  while (true) {
    const { value: m, done } = await q.next();   // manual .next(): a for-await break kills the transport (probe 75)
    if (done) return;
    const mm = m as any;
    if (mm.type === "result") { log(`${label}: result=${mm.subtype}`); return; }
  }
}

try {
  await q.initializationResult();

  // Turn 1 — several DIFFERENT tool kinds, so Q1's census covers more than one payload shape. The
  // outside-cwd Read is the one guaranteed to consult; Write/Edit inside cwd may or may not.
  send(`Using tools only, no commentary: Read ${join(OUT, "one.txt")}, then Write d.txt containing the single line HELLO, then Edit b.txt replacing BETA with DELTA.`);
  await drainTurn("turn 1 (census + rule grant)");
  const afterTurn1 = consults.length;
  log(`Q1 census: ${afterTurn1} consults — ${JSON.stringify(consults.map((c) => c.tool))}`);
  if (!grantedRule) log(`Q2 INVALID: no Read consult ever fired, so no rule was granted — turn 2 proves nothing.`);

  // Turn 2 — a DIFFERENT outside-cwd file. Same rule shape, so if updatedPermissions took, no consult.
  send(`Using tools only: Read ${join(OUT, "two.txt")} and repeat its contents.`);
  await drainTurn("turn 2 (round-trip check)");
  const newOnes = consults.slice(afterTurn1);
  const readAgain = newOnes.filter((c) => c.tool === "Read").length;
  log(`Q2 VERDICT (valid only if a rule was granted above): turn-2 consults=${JSON.stringify(newOnes.map((c) => c.tool))} — ` +
      `Read consulted ${readAgain}× (0 = updatedPermissions WORKS, so a real persisted "don't ask again" is buildable; ` +
      `1+ = the rule was ignored and our in-memory Set is the only option)`);
} finally {
  closed = true;
  notify?.();
  q.close();
  rmSync(base, { recursive: true, force: true }); rmSync(OUT, { recursive: true, force: true });
}
log("probe 78 done");
process.exit(0);
