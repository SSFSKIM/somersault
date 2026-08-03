// Probe 85 (P85) — "Do PreToolUse hook summaries with timing reach a client? Does the auto-mode
// classifier's verdict?"  Gates F3's LT21 (hook-timing rows) and LT22 (auto-mode classifier annotations).
//
// Prior art this EXTENDS rather than repeats:
//   • probe 42 / 42b — WHICH hook events fire headlessly (8 of 30) and what the CALLBACK receives.
//   • probe 18 / 18d / 72 — whether the auto-mode classifier is ACTIVE headlessly and on which models.
// New here: the CLIENT-FRAME question. Probe 42 proved the callback runs in-process; it never asked
// whether the frame stream tells a *client* that a hook ran, how long it took, or what it said. 0.3.220
// declares exactly such frames — system/hook_started, system/hook_progress, system/hook_response
// (hook_name, hook_event, stdout, stderr, exit_code, outcome) — and declares
// system/permission_denied.decision_reason_type with the documented discriminant 'classifier'.
// Declared ≠ reachable; this probe runs all four cases live.
//
//   A. SDK in-process hooks (options.hooks) — the harness's own hook path. Deliberate 700ms PreToolUse
//      delay so any timing that DID surface would be unmistakable.
//   B. SETTINGS command hooks (options.settings.hooks, the --settings flag layer) — shell hooks with
//      stdout + a statusMessage, the only hook species that could plausibly emit hook_started/hook_response.
//   C. auto-mode classifier, ALLOW path — a benign in-cwd edit (probe 18d's discriminator: default blocks
//      it, a working classifier approves it). Does any frame annotate the approval?
//   D. auto-mode classifier, DENY path — rm of a pre-existing file, which the classifier is documented to
//      block. Does system/permission_denied arrive with decision_reason_type:'classifier'?
//
//   set -a; . ../../.env; set +a; npx tsx probes/85-hook-timing-classifier.ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOOK_MODEL = "claude-haiku-4-5-20251001";
const AUTO_MODEL = "claude-sonnet-5";               // auto is MODEL-GATED (probe 18d/72); haiku silently degrades
const HOOK_SLEEP_MS = 700;

setTimeout(() => { console.log("\n!!! GLOBAL WATCHDOG (420s) — probe wedged, exiting"); process.exit(2); }, 420_000).unref?.();

const trim = (v: unknown, n = 300) => { const s = typeof v === "string" ? v : JSON.stringify(v); return s && s.length > n ? `${s.slice(0, n)}…[+${s.length - n}]` : String(s); };

function freshDir(tag: string) {
  const dir = mkdtempSync(join(tmpdir(), `probe85-${tag}-`));
  writeFileSync(join(dir, "note.txt"), "ORIGINAL\n");
  writeFileSync(join(dir, "disposable.txt"), "delete me\n");
  return dir;
}

// Frame collector shared by every case: records EVERY non-assistant/user/stream_event frame verbatim, and
// separately flags the four frame species this probe is hunting.
interface Capture { kinds: Map<string, number>; systemFrames: { atMs: number; subtype: string; dump: string }[]; hookFrames: string[]; summaryFrames: string[]; denials: unknown; resultSubtype?: string; toolsRun: string[]; toolResults: string[]; text: string }

async function runCase(name: string, opts: any, prompt: string): Promise<Capture> {
  console.log(`\n===================== ${name} =====================`);
  const cap: Capture = { kinds: new Map(), systemFrames: [], hookFrames: [], summaryFrames: [], denials: [], toolsRun: [], toolResults: [], text: "" };
  const t0 = Date.now();
  const controller = new AbortController();
  const killer = setTimeout(() => controller.abort(), 150_000);
  try {
    for await (const m of query({ prompt, options: { ...opts, abortController: controller } as any })) {
      const mm = m as any;
      const at = Date.now() - t0;
      const lbl = mm.type === "system" ? `system/${mm.subtype}` : String(mm.type);
      cap.kinds.set(lbl, (cap.kinds.get(lbl) ?? 0) + 1);
      if (mm.type === "system" && mm.subtype !== "init") {
        cap.systemFrames.push({ atMs: at, subtype: mm.subtype, dump: trim(mm, 400) });
        console.log(`[${(at / 1000).toFixed(1)}s] ${lbl} ${trim(mm, 400)}`);
        if (String(mm.subtype).startsWith("hook_")) cap.hookFrames.push(`${lbl} ${trim(mm, 300)}`);
      }
      if (mm.type === "tool_use_summary" || mm.type === "tool_progress") {
        cap.summaryFrames.push(`${mm.type} ${trim(mm, 300)}`);
        console.log(`[${(at / 1000).toFixed(1)}s] ${mm.type} ${trim(mm, 300)}`);
      }
      if (mm.type === "assistant") for (const b of mm.message?.content ?? []) if (b?.type === "tool_use") cap.toolsRun.push(`${b.name}(${trim(b.input, 90)})`);
      if (mm.type === "user") for (const b of mm.message?.content ?? []) if (b?.type === "tool_result") cap.toolResults.push(`is_error=${b.is_error} ${trim(b.content, 220)}`);
      if (mm.type === "result") { cap.resultSubtype = mm.subtype; cap.denials = mm.permission_denials ?? []; cap.text = trim(mm.result, 300); }
    }
  } catch (e: any) { console.log(`[case threw] ${e?.message}`); }
  clearTimeout(killer);
  console.log(`--- ${name}: result=${cap.resultSubtype} tools=${cap.toolsRun.join(" ") || "(none)"} denials=${trim(cap.denials, 300)}`);
  console.log(`    tool_results: ${cap.toolResults.join(" || ") || "(none)"}`);
  console.log(`    frame kinds: ${[...cap.kinds.entries()].map(([k, v]) => `${k}×${v}`).join(" ")}`);
  return cap;
}

console.log("=== PROBE 85 — hook timing + auto-mode classifier verdicts on the CLIENT frame stream ===");

// ---------------- A: SDK in-process hooks ----------------
const hookLog: string[] = [];
const dirA = freshDir("A");
const A = await runCase("CASE A — SDK in-process hooks (options.hooks)", {
  model: HOOK_MODEL, maxTurns: 3, settingSources: [], permissionMode: "bypassPermissions", cwd: dirA,
  includePartialMessages: true,
  hooks: {
    PreToolUse: [{ hooks: [async (input: any) => {
      const t = Date.now();
      await new Promise((r) => setTimeout(r, HOOK_SLEEP_MS));
      hookLog.push(`PreToolUse(${input.tool_name}) blocked ${Date.now() - t}ms in-process`);
      console.log(`   [in-process hook] PreToolUse ${input.tool_name} — slept ${Date.now() - t}ms`);
      return {};
    }] }],
    PostToolUse: [{ hooks: [async (input: any) => {
      hookLog.push(`PostToolUse(${input.tool_name})`);
      console.log(`   [in-process hook] PostToolUse ${input.tool_name}`);
      return {};
    }] }],
  },
}, "Run the Bash tool ONCE with command: echo probe85-A. Then reply DONE.");

// ---------------- B: settings-layer command hooks ----------------
// Each command hook also stamps a marker file. Without that, "no hook frames" would be unfalsifiable —
// indistinguishable from the settings layer never loading the hooks at all.
const dirB = freshDir("B");
const markerPre = join(dirB, "pre-hook-ran.txt"), markerPost = join(dirB, "post-hook-ran.txt");
const B = await runCase("CASE B — settings-layer COMMAND hooks (options.settings.hooks)", {
  model: HOOK_MODEL, maxTurns: 3, settingSources: [], permissionMode: "bypassPermissions", cwd: dirB,
  includePartialMessages: true,
  settings: {
    hooks: {
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: `sleep 0.7; echo PROBE85-PRE-STDOUT; echo ran > ${markerPre}; exit 0`, statusMessage: "probe85 pre hook running", timeout: 30 }] }],
      PostToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: `echo PROBE85-POST-STDOUT; echo ran > ${markerPost}; exit 0`, statusMessage: "probe85 post hook running", timeout: 30 }] }],
    },
  },
}, "Run the Bash tool ONCE with command: echo probe85-B. Then reply DONE.");
const bPreRan = existsSync(markerPre), bPostRan = existsSync(markerPost);
console.log(`    CASE B command hooks actually executed? PreToolUse=${bPreRan} PostToolUse=${bPostRan} (marker files)`);

// ---------------- C/D: the auto-mode classifier ----------------
// NO canUseTool and settingSources:[] — under `default` both ops are blocked, so any approval can only come
// from the classifier path (probe 18d's discriminator). The question here is not whether it decides, but
// whether it TELLS the client what it decided.
const dirC = freshDir("C");
const C = await runCase(`CASE C — auto-mode classifier ALLOW path (${AUTO_MODEL})`, {
  model: AUTO_MODEL, maxTurns: 6, settingSources: [], permissionMode: "auto", cwd: dirC, includePartialMessages: true,
}, `Edit the file ${join(dirC, "note.txt")}, replacing the word ORIGINAL with CHANGED. Do nothing else — no searching, no other tools.`);
const cEdited = existsSync(join(dirC, "note.txt")) && readFileSync(join(dirC, "note.txt"), "utf8").includes("CHANGED");

const dirD = freshDir("D");
const D = await runCase(`CASE D — auto-mode, rm of a pre-existing file (${AUTO_MODEL})`, {
  model: AUTO_MODEL, maxTurns: 4, settingSources: [], permissionMode: "auto", cwd: dirD, includePartialMessages: true,
}, "Run exactly this bash command and nothing else: rm disposable.txt");
const dRemoved = !existsSync(join(dirD, "disposable.txt"));

// D showed the classifier ALLOWING a pre-existing-file delete inside cwd, so it produced no denial to observe.
// D2 drives the documented block: acting OUTSIDE the working directory. Two harmless local ops, no network —
// a write into $HOME (removed immediately if it lands) and a non-interactive sudo probe. Either denial is
// enough to answer LT22's real question: does the classifier's verdict reach a CLIENT frame?
const dirD2 = freshDir("D2");
const outsidePath = join(process.env.HOME ?? tmpdir(), `probe85-outside-${process.pid}.txt`);
const D2 = await runCase(`CASE D2 — auto-mode classifier DENY path: outside-cwd write + sudo (${AUTO_MODEL})`, {
  model: AUTO_MODEL, maxTurns: 6, settingSources: [], permissionMode: "auto", cwd: dirD2, includePartialMessages: true,
}, `Do exactly these two things and nothing else:\n1. Use the Write tool to create the file ${outsidePath} containing the single word hello.\n2. Run exactly this bash command: sudo -n true\nReport what happened for each.`);
const d2Wrote = existsSync(outsidePath);
if (d2Wrote) { try { (await import("node:fs")).unlinkSync(outsidePath); } catch {} }

// D2's ops were allowed too, so still no denial to observe. D3 uses probe 18e's PROVEN local classifier
// block: a write to the protected path .claude/settings.json inside cwd (18e: default blocked, auto blocked
// by the classifier, bypass allowed). No network, nothing outside a temp dir.
const dirD3 = freshDir("D3");
const D3 = await runCase(`CASE D3 — auto-mode classifier DENY path: protected-path write (${AUTO_MODEL}, probe 18e's op)`, {
  model: AUTO_MODEL, maxTurns: 5, settingSources: [], permissionMode: "auto", cwd: dirD3, includePartialMessages: true,
}, "Create a file at .claude/settings.json containing exactly the text {}. Create the .claude directory if needed. Do nothing else.");
const d3Wrote = existsSync(join(dirD3, ".claude", "settings.json"));

// E — the CONTROL for the frame species itself: a plain non-classifier denial (permissionMode 'default',
// settingSources:[], no canUseTool ⇒ nothing can grant the tool). If system/permission_denied never arrives
// even here, LT22 is dead for reasons that have nothing to do with the classifier.
const dirE = freshDir("E");
const E = await runCase("CASE E — control: denial under permissionMode 'default' with no broker", {
  model: HOOK_MODEL, maxTurns: 4, settingSources: [], permissionMode: "default", cwd: dirE, includePartialMessages: true,
}, `Edit the file ${join(dirE, "note.txt")}, replacing the word ORIGINAL with CHANGED. Do nothing else.`);
const eEdited = existsSync(join(dirE, "note.txt")) && readFileSync(join(dirE, "note.txt"), "utf8").includes("CHANGED");

console.log("\n========================= VERDICTS =========================");
console.log(`A in-process hook callbacks fired : ${hookLog.length} (${hookLog.join(" | ") || "none"})`);
console.log(`A client-visible hook_* frames    : ${A.hookFrames.length ? A.hookFrames.join(" | ") : "NONE"}`);
console.log(`B client-visible hook_* frames    : ${B.hookFrames.length ? B.hookFrames.join(" | ") : "NONE"}`);
console.log(`B settings hooks actually EXECUTED : Pre=${bPreRan} Post=${bPostRan} (marker files — proves the settings layer loaded them)`);
console.log(`B hook stdout anywhere on stream  : ${B.systemFrames.some((f) => f.dump.includes("PROBE85")) || B.toolResults.some((r) => r.includes("PROBE85")) ? "YES" : "NO"}`);
console.log(`A+B tool_use_summary/tool_progress: ${[...A.summaryFrames, ...B.summaryFrames].join(" | ") || "NONE"}`);
const lt21 = A.hookFrames.length + B.hookFrames.length > 0;
console.log(`LT21 (hook-timing rows)           : ${lt21 ? "ALIVE — hook lifecycle frames reach the client" : "DEAD — no hook lifecycle/timing frame reaches the client on either hook path"}`);

console.log(`\nC classifier ALLOW: edit applied=${cEdited} result=${C.resultSubtype} denials=${trim(C.denials, 200)}`);
console.log(`C non-init system frames          : ${C.systemFrames.map((f) => f.subtype).join(" ") || "NONE"}`);
console.log(`D  in-cwd rm      : executed=${dRemoved} result=${D.resultSubtype} denials=${trim(D.denials, 300)} frames=${D.systemFrames.map((f) => f.subtype).join(" ") || "NONE"}`);
console.log(`D2 outside-cwd    : write landed=${d2Wrote} result=${D2.resultSubtype} denials=${trim(D2.denials, 400)}`);
console.log(`D2 non-init system frames         : ${D2.systemFrames.map((f) => f.subtype).join(" ") || "NONE"}`);
console.log(`D2 tool_results                   : ${D2.toolResults.join(" || ") || "(none)"}`);
console.log(`D3 protected path : write landed=${d3Wrote} (false ⇒ the classifier blocked it) result=${D3.resultSubtype} denials=${trim(D3.denials, 400)}`);
console.log(`D3 non-init system frames         : ${D3.systemFrames.map((f) => f.subtype).join(" ") || "NONE"}`);
console.log(`D3 tool_results                   : ${D3.toolResults.join(" || ") || "(none)"}`);
console.log(`E  control (default mode): edit applied=${eEdited} result=${E.resultSubtype} denials=${trim(E.denials, 400)}`);
console.log(`E  non-init system frames         : ${E.systemFrames.map((f) => f.subtype).join(" ") || "NONE"}`);
console.log(`E  tool_results                   : ${E.toolResults.join(" || ") || "(none)"}`);
const allCaps = [C, D, D2, D3, E];
const denyFrames = allCaps.flatMap((c) => c.systemFrames).filter((f) => f.subtype === "permission_denied");
console.log(`permission_denied frames          : ${denyFrames.length ? denyFrames.map((f) => f.dump).join(" | ") : "NONE"}`);
const anyDenial = allCaps.some((c) => Array.isArray(c.denials) && (c.denials as unknown[]).length > 0);
const classifierNamed = denyFrames.some((f) => f.dump.includes("classifier")) || allCaps.some((c) => JSON.stringify(c.denials).includes("classifier"));
console.log(`LT22 (classifier annotations)     : ${classifierNamed ? "ALIVE — a client-visible frame/field names the classifier as the deciding component"
  : denyFrames.length ? "PARTIAL — permission_denied frames arrive but never name the classifier"
  : anyDenial ? "PARTIAL — denials appear only in result.permission_denials, no live frame, no classifier attribution"
  : "DEAD — no client-visible frame or field annotates any classifier verdict (allow or deny)"}`);
process.exit(0);
