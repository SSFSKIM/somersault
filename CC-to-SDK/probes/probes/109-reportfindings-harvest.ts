// probes/probes/109-reportfindings-harvest.ts — is `ReportFindings` a usable review OUTPUT channel?
//
// M4 (adopting Codex's review domain) turns on one premise. Codex's own review flattens its structured
// findings to a single plain-text string before any client sees them (`ReviewFinding` appears nowhere in
// its generated v2 schema — see docs/superpowers/grounding/2026-08-13-codex-review-domain-ground.md), so
// shipping STRUCTURED findings would be a deliberate improvement on Codex rather than a port of it. The
// proposed mechanism is that we do not invent a findings schema at all: the SDK already ships a native
// `ReportFindings` tool whose declared input IS the findings array (file/line/summary/failure_scenario/
// category/verdict — sdk-tools.d.ts:771-814), and the payload would be harvested from the tool_use INPUT
// as it streams past, not from a tool result. Declared ≠ reachable, so this probe asks the live SDK.
//
// FOUR QUESTIONS, each of which changes the M4 design if it answers no:
//   Q1 Is `ReportFindings` actually present and callable in a default headless session?
//   Q2 Does the model CALL it on a plain instruction, with no review-specific system prompt?
//   Q3 Does the findings payload ride the tool_use `input` (harvestable from the frame stream the app
//      server already maps into items), and does it match the declared shape?
//   Q4 What does the tool RESULT look like — does the call succeed, and is the turn well-formed after?
//
// Run from CC-to-SDK/probes:
//   set -a; . ../.env; set +a; npx tsx probes/109-reportfindings-harvest.ts
//
// RESULT (2026-08-13, SDK 0.3.227) — YES on all four, and the mechanism is the cheap one.
//   Q1 `ReportFindings` is present and callable in a DEFAULT headless session — `settingSources: []`, no
//      allowlist, no `agents`, no custom system prompt. It is part of the default tool set, not a surface
//      that has to be switched on.
//   Q2 The model CALLED it off a plain user instruction ("report every defect by calling the
//      ReportFindings tool"). No review-specific system prompt, no schema handed to the model, no
//      structured-output plumbing: 1 tool_use, and the tools it chose were `Bash, Read, ReportFindings`
//      — it fetched the subject itself, which is the same "let the reviewing agent run git through its
//      own shell tool" shape Codex uses, so a review needs no server-side diff seam to see code.
//   Q3 The findings ride `tool_use.input` — `{findings: [...]}`, 3 findings for 2 planted defects (it
//      also flagged a real third). First finding carried `file, line, category, summary,
//      failure_scenario, short_summary`; all three REQUIRED fields present; shape matches the declared
//      `ReportFindingsInput` exactly. It correctly diagnosed the planted off-by-one with a concrete
//      failure scenario (`lastN(['a','b','c','d'], 2)` → one extra element).
//   Q4 The call SUCCEEDS: tool_result `is_error:false`, content `"3 findings reported."`, and the turn
//      ends `subtype:"success", is_error:false`. So it is a well-behaved tool, not a trap that faults.
//
// CONSEQUENCE FOR M4: we do not invent a findings schema, do not need `outputFormat`/structured-output on
// the app-server path, and do not need a server-owned git/diff seam for the model to see code. A review is
// an ORDINARY TURN whose `ReportFindings` tool_use is intercepted on the frame stream the app server
// already maps into items, and promoted into a typed findings payload. That ships STRUCTURED findings
// where Codex ships a flattened string — a deliberate improvement on the thing we are porting.
// Caveat this probe does NOT settle: reliability. One run, one prompt, explicit instruction. It says the
// channel EXISTS and is well-formed; it does not say the model always calls it, so the design still owes
// a fallback for the no-tool-call turn (assistant prose was 681 chars here, so prose is available).
import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const CWD = "/Users/new/.claude/jobs/b2f47c85/tmp/probe109";

// A file with two defects a reviewer should find: an off-by-one bound and an unawaited promise.
const SUBJECT = `export async function lastN(items: string[], n: number): Promise<string[]> {
  const out: string[] = [];
  for (let i = items.length - n - 1; i < items.length; i++) out.push(items[i]);
  return out;
}

export async function saveAll(rows: string[], save: (r: string) => Promise<void>) {
  rows.forEach((r) => { save(r); });
  return "saved";
}
`;

function setup(): void {
  rmSync(CWD, { recursive: true, force: true });
  mkdirSync(CWD, { recursive: true });
  writeFileSync(join(CWD, "subject.ts"), SUBJECT);
}

type ToolUse = { name: string; input: unknown; id: string };

async function main(): Promise<void> {
  setup();
  const toolUses: ToolUse[] = [];
  const toolResults: Array<{ id: string; isError: boolean; content: unknown }> = [];
  const seenToolNames = new Set<string>();
  let resultSubtype = "";
  let resultIsError: boolean | undefined;
  let assistantText = "";

  const q = query({
    prompt:
      "Review the file subject.ts in the current directory for correctness defects. " +
      "Read it first. Then report every defect you find by calling the ReportFindings tool — " +
      "that tool call is the deliverable; do not just describe the findings in prose.",
    options: {
      cwd: CWD,
      // The M1 lesson: without this a live probe silently tests the developer's own ~/.claude settings.
      settingSources: [],
      permissionMode: "bypassPermissions",   // probe only — we care about tool reachability, not the broker
      maxTurns: 12,
    },
  });

  for await (const m of q as AsyncIterable<Record<string, unknown>>) {
    const type = m.type as string;
    if (type === "assistant") {
      const msg = m.message as { content?: Array<Record<string, unknown>> } | undefined;
      for (const block of msg?.content ?? []) {
        if (block.type === "tool_use") {
          const name = String(block.name);
          seenToolNames.add(name);
          if (name === "ReportFindings") toolUses.push({ name, input: block.input, id: String(block.id) });
        }
        if (block.type === "text") assistantText += String(block.text ?? "");
      }
    }
    if (type === "user") {
      const msg = m.message as { content?: Array<Record<string, unknown>> } | undefined;
      for (const block of msg?.content ?? []) {
        if (block.type === "tool_result") {
          const id = String(block.tool_use_id);
          if (toolUses.some((t) => t.id === id)) {
            toolResults.push({ id, isError: block.is_error === true, content: block.content });
          }
        }
      }
    }
    if (type === "result") {
      resultSubtype = String(m.subtype ?? "");
      resultIsError = m.is_error as boolean | undefined;
    }
  }

  // ── Answers ────────────────────────────────────────────────────────────────────────────────────────
  const fired = toolUses.length > 0;
  console.log("\n=== PROBE 109 — ReportFindings as a review output channel ===\n");
  console.log("Q2 model CALLED ReportFindings unprompted-by-system-prompt:", fired ? "YES" : "NO");
  console.log("   tool_use count:", toolUses.length);
  console.log("   all tools the model used this turn:", [...seenToolNames].join(", ") || "(none)");

  if (fired) {
    const input = toolUses[0].input as { findings?: unknown[]; level?: unknown };
    const findings = Array.isArray(input?.findings) ? input.findings : [];
    console.log("\nQ3 payload rides tool_use.input:", input && typeof input === "object" ? "YES" : "NO");
    console.log("   findings count:", findings.length);
    console.log("   top-level input keys:", Object.keys(input ?? {}).join(", "));
    if (findings.length) {
      const f = findings[0] as Record<string, unknown>;
      console.log("   first finding keys:", Object.keys(f).join(", "));
      // Shape check against the declared interface — required: file, summary, failure_scenario.
      const required = ["file", "summary", "failure_scenario"];
      const missing = required.filter((k) => !(k in f));
      console.log("   required-field check:", missing.length ? `MISSING ${missing.join(",")}` : "all present");
      console.log("   sample finding:", JSON.stringify(f).slice(0, 400));
    }
    console.log("\nQ4 tool_result for the call:", toolResults.length ? JSON.stringify(toolResults[0]).slice(0, 300) : "(none observed)");
  }
  console.log("\nQ1/Q4 turn outcome — result subtype:", resultSubtype, "| is_error:", resultIsError);
  console.log("assistant prose length:", assistantText.length);
  console.log("\n=== end ===\n");
}

main().catch((e) => { console.error("PROBE FAILED:", e); process.exit(1); });
