// Probe 82 — the two keyed questions the F6 wave close depends on.
//
//   Q1. Do headless BASH consults carry `suggestions`? Probe 78's Bash arm was invalidated (echo is
//       auto-approved, never consulted) and re-run against Read — so the only observed suggestion
//       shapes are addRules(Read) and setMode(Write/Edit). T6's dialog gates BOTH middle rows
//       ("Yes, and don't ask again for" prefix input + the Wdi summary row) on a non-empty
//       suggestion payload, exactly as upstream's $Qf does (if/else-if, both behind e.length>0).
//       If Bash consults arrive suggestion-less, acceptance #2's flow shows Yes/No alone — worth
//       knowing whether that's upstream-equivalent reality or a headless gap to record.
//   Q2. What does the rewind dry-run's ENGINE hop actually cost? T10 measured the keyless hops
//       (UDS 0.05 ms, git diff 17.7-27.4 ms) and set REWIND_SUMMARY_WINDOW = 10 on the strength of
//       client/remote.ts's live 60 s rewind timeout comment. Time query.rewindFiles(uuid,
//       {dryRun:true}) per anchor on a real session with real checkpoints.
//
// RESULT (run 2026-08-06, sonnet-4-6, keyed):
//   Q1 SETTLED YES — Bash consults DO carry suggestions, and RICHER than Read's:
//     · `git init` → {"type":"addRules","rules":[{toolName:"Bash",ruleContent:"git init *"}],
//       behavior:"allow","destination":"localSettings"} — the engine's OWN destination is already
//       localSettings for Bash (Read's was session), and the ruleContent is exactly the prefix
//       grammar T6's seed derives (`git init *`). Acceptance #2's flow is fully live-real.
//     · Compound `mkdir -p sub && touch sub/a.txt` → ONE addRules with TWO per-subcommand rules.
//     · `rm -f sub/a.txt` → THREE suggestions (exact-command addRules localSettings +
//       addDirectories session + setMode acceptEdits session) — the Wdi mixed-arm wording is
//       reachable for Bash after all.
//     · decisionReason "This command requires approval" arrived on the first consult only.
//   Q2 PARTIAL — the engine hop for rewindFiles(dryRun) is 0-3 ms per anchor in-process… with
//     canRewind:false everywhere, because a raw query() has no file checkpointing enabled. The
//     cheap-path hop is settled (NOT multi-second in-process; the 60 s timeout precedent is an
//     attach/loaded-machine artifact); the checkpointed diff path stays unmeasured here — observe
//     the picker's responsiveness in the real-TTY pass instead. REWIND_SUMMARY_WINDOW=10 stands.
import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const base = join(tmpdir(), `probe82-${process.pid}`);
mkdirSync(base, { recursive: true });

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

const userUuids: string[] = [];
let bashConsults = 0;

const q = query({
  prompt: input(),
  options: {
    model: "claude-sonnet-4-6", cwd: base, settingSources: [], permissionMode: "default", maxTurns: 20,
    canUseTool: async (name, toolInput, options) => {
      const o = (options ?? {}) as Record<string, unknown>;
      const sugs = Array.isArray(o.suggestions) ? (o.suggestions as unknown[]) : [];
      log(`CONSULT tool=${name} suggestions=${sugs.length}`);
      if (name === "Bash") {
        bashConsults++;
        log(`  Q1 BASH consult #${bashConsults}: command=${JSON.stringify((toolInput as any)?.command)}`);
        for (const s of sugs) log(`  Q1 suggestion: ${JSON.stringify(s)}`);
        if (!sugs.length) log(`  Q1: NO suggestions on this Bash consult — the T6 middle rows would not render here`);
        log(`  Q1 decisionReason=${JSON.stringify(o.decisionReason)}`);
      }
      return { behavior: "allow", updatedInput: toolInput };
    },
  },
});

async function drainTurn(label: string): Promise<void> {
  while (true) {
    const { value: m, done } = await q.next();
    if (done) return;
    const mm = m as any;
    if (mm.type === "user" && mm.uuid && !mm.parent_tool_use_id) userUuids.push(mm.uuid);
    if (mm.type === "result") { log(`${label}: result=${mm.subtype}`); return; }
  }
}

try {
  await q.initializationResult();

  // Q1 — three different Bash shapes: a benign-but-not-auto-approved command, a write-ish one, and a
  // destructive-pattern one (also exercises whether decisionReason arrives for the warning row's context).
  send(`Using tools only, no commentary: run \`git init\` in the current directory with Bash.`);
  await drainTurn("turn 1 (bash git init)");
  send(`Using tools only: run \`mkdir -p sub && touch sub/a.txt\` with Bash, then Write a file b.txt containing HELLO, then Edit b.txt replacing HELLO with WORLD.`);
  await drainTurn("turn 2 (bash mkdir/touch + write/edit anchors)");
  send(`Using tools only: run \`rm -f sub/a.txt\` with Bash.`);
  await drainTurn("turn 3 (bash rm -f — destructive pattern)");
  log(`Q1 SUMMARY: ${bashConsults} Bash consults total (0 = Bash never consults under default mode with these commands — a different finding)`);

  // Q2 — time the dry-run engine hop per anchor, newest-first, over however many user-message anchors
  // the three turns produced.
  const anchors = userUuids.slice().reverse();
  log(`Q2: ${anchors.length} anchors captured; timing rewindFiles dryRun per anchor…`);
  for (const [i, uuid] of anchors.entries()) {
    const s = Date.now();
    try {
      const r = await (q as any).rewindFiles(uuid, { dryRun: true });
      log(`  Q2 anchor[${i}] ${uuid.slice(0, 8)}: ${Date.now() - s} ms → canRewind=${r?.canRewind} files=${r?.filesChanged ?? r?.files_changed} +${r?.insertions} -${r?.deletions}`);
    } catch (e) {
      log(`  Q2 anchor[${i}] ${uuid.slice(0, 8)}: ${Date.now() - s} ms → THREW ${(e as Error)?.message?.slice(0, 120)}`);
    }
  }
} finally {
  closed = true; notify?.(); q.close();
  rmSync(base, { recursive: true, force: true });
}
log("probe 82 done");
process.exit(0);
