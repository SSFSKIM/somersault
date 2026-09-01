// W6 probe — WHICH permission modes are reachable on the headless seam, through
// WHICH path, and which arms of the decision chain a corpus can actually create.
//
// Campaign spec C9 / the live-probe-first discipline.
//
// ---------------------------------------------------------------------------
// THE POPULATION UNDER TEST IS NOT CHOSEN HERE.
//
// C8 was corrected twice for the same defect, one subsystem over: its watched
// list was written by the tester, so an event nobody thought of could not be
// measured as absent. The mode axis of this probe therefore comes from
// `research/fixtures/permission-surface-<pin>.json`, which
// `research/tools/extract-permission-surface.ts` derives from FOUR independent
// enumerations in the pinned bundle that must agree on the set, confirmed
// against the mode names the graph actually compares against. Nothing in this
// file decides which modes exist.
//
// The same fixture supplies the rule-behavior axis (allow/deny/ask) and the
// decisionReason axis (the eleven kinds upstream's own message builder renders).
//
// ---------------------------------------------------------------------------
// AND EVERY VERDICT NAMES ITS CONDITION. C8's three-valued vocabulary, adopted
// wholesale because the alternative is the failure it was invented for:
//
//   FIRED / REACHED  — observed, in the named phase
//   MEASURED-DEAD    — the condition WAS created here and the arm did not run
//   OPEN             — the condition is named and was NOT created; nothing is
//                      claimed, and this must never be counted as a negative
//
// ---------------------------------------------------------------------------
// FOUR TRAPS THIS PROBE IS BUILT AROUND, three of them inherited from C8's
// second boundary round as things that silently switched the subsystem off:
//
//   1. `bypassPermissions` was the corpus's default and it changes what the
//      decision chain does. Every phase here names its mode deliberately.
//   2. A bare `allowedTools: ["Bash"]` entry SHADOWS `canUseTool` — the SDK
//      warns and the callback is never consulted. Phase `shadowing` measures it
//      rather than inheriting it.
//   3. Default mode auto-approves read-only shell commands WITHOUT consulting
//      `canUseTool`, so a probe built on `echo` measures nothing. `mkdir -p` is
//      the cheapest command that is not read-only.
//   4. A `canUseTool` answer slower than 6000 ms fires a Notification hook
//      frame. Every answer here is immediate; the slow case is W5's and stays
//      W5's.
//
// ---------------------------------------------------------------------------
// TWO PATHS PER MODE, because they reach different code. `Options.permissionMode`
// is resolved at spawn, through the CLI's own mode parser; `set_permission_mode`
// arrives over the control channel and goes through the GUARD
// (`guardPermissionModeChange`), which is where the `auto` gate actually lives.
// A mode that is settable at spawn and refused over the channel — or the
// reverse — is a real asymmetry, and only measuring both can see it.
//
// Run: cd reforge && set -a; . ../.env; set +a; npx tsx w6/probe-permissions.ts
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { query, type Options, type PermissionMode, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { baseOptions, pushable, resetSandbox, userMessage, type ScenarioContext } from "../src/harness.js";
import { requireRecordCredential } from "../src/env.js";
import { startRecordProxy } from "../src/proxy.js";
import { enginePath, REFORGE_ROOT, SANDBOX } from "../src/runTurn.js";
import { readFixture } from "../research/tools/extract-permission-surface.js";

const SURFACE = readFixture();
/** The mode axis, in upstream's own declaration order — the enumeration of record. */
const MODES = SURFACE.modes.names as PermissionMode[];
/** The rule-behavior axis. `permissions.<behavior>` is the settings key for each. */
const RULE_BEHAVIORS = SURFACE.ruleBehaviors.names;

/**
 * Where the two permission-scoped hooks append a marker line.
 *
 * Outside the sandbox on purpose: `resetSandbox()` runs at the top of every
 * phase, so a marker written there would be wiped before it could be read.
 */
const MARKERS = join(REFORGE_ROOT, ".scratch", "w6-probe-markers");
const markerFile = (e: string) => join(MARKERS, `${e}.log`);

/** The two events the permission chain can dispatch, watched on BOTH hook paths in every phase. */
const WATCHED = ["PermissionRequest", "PermissionDenied"] as const;

const markerHook = (e: string) => ({
  hooks: [
    {
      type: "command" as const,
      command: `node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{let n,k;try{const i=JSON.parse(s);n=i.hook_event_name;k=Object.keys(i).join(",")}catch{n="<unparsed>";k=""}require("fs").appendFileSync(${JSON.stringify(
        markerFile(e),
      )},n+" | "+k+"\\n")})'`,
    },
  ],
});

function drainMarkers(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (!existsSync(MARKERS)) return out;
  for (const f of readdirSync(MARKERS)) {
    const lines = readFileSync(join(MARKERS, f), "utf8").split("\n").filter(Boolean);
    if (lines.length > 0) out.set(f.replace(/\.log$/, ""), lines);
    rmSync(join(MARKERS, f), { force: true });
  }
  return out;
}

/** One `canUseTool` consult, projected to the fields that are the ENGINE's rather than the run's. */
interface Consult {
  tool: string;
  decisionReason?: string;
  matchedAskRule?: unknown;
  blockedPath?: string;
  suggestions: number;
  title?: string;
}

interface PhaseResult {
  consults: Consult[];
  /** `{type:"system",subtype:"permission_denied"}` frames — the decision VALUE, in the transcript */
  denials: { tool: string; reasonType?: string; reason?: string; message: string }[];
  /** the authoritative record from the result message */
  resultDenials: unknown[];
  hookFires: Map<string, number>;
  hookRecords: Map<string, string[]>;
  toolsUsed: string[];
  said: string[];
  /** what `setPermissionMode` did, when the phase called it */
  modeChange?: { mode: string; ok: boolean; error?: string };
  /** the sandbox files the turn actually produced — did the tool RUN? */
  files: string[];
  warnings: string[];
  error?: string;
}

interface PhaseSpec {
  label: string;
  condition: string;
  extra: Partial<Options>;
  next: (results: number) => string | null;
  /** call `setPermissionMode` after this many results have come back */
  setModeAfter?: { results: number; mode: PermissionMode };
  focus?: string[];
}

/** Answer immediately, allow everything, and record what was asked. Trap 4: never slow. */
function recordingBroker(consults: Consult[], deny?: (tool: string, input: Record<string, unknown>) => string | null) {
  return async (tool: string, input: Record<string, unknown>, opts: Record<string, unknown>) => {
    consults.push({
      tool,
      decisionReason: opts.decisionReason as string | undefined,
      matchedAskRule: opts.matchedAskRule,
      blockedPath: opts.blockedPath as string | undefined,
      suggestions: Array.isArray(opts.suggestions) ? opts.suggestions.length : 0,
      title: opts.title as string | undefined,
    });
    const why = deny?.(tool, input);
    if (why !== null && why !== undefined) return { behavior: "deny" as const, message: why };
    return { behavior: "allow" as const, updatedInput: input };
  };
}

async function phase(spec: PhaseSpec): Promise<PhaseResult> {
  const cassette = join(REFORGE_ROOT, "cassettes", `w6-probe-${spec.label}.jsonl.tmp`);
  mkdirSync(join(REFORGE_ROOT, "cassettes"), { recursive: true });
  rmSync(cassette, { force: true });
  rmSync(MARKERS, { recursive: true, force: true });
  mkdirSync(MARKERS, { recursive: true });
  resetSandbox();

  const proxy = await startRecordProxy(cassette);
  const hookFires = new Map<string, number>();
  const ctx: ScenarioContext = {
    engine: enginePath("engine-real"),
    baseUrl: `http://127.0.0.1:${proxy.port}`,
    collect: (event) => hookFires.set(event, (hookFires.get(event) ?? 0) + 1),
    mode: "record",
  };

  const options: Options = {
    ...baseOptions(ctx),
    hooks: Object.fromEntries(WATCHED.map((e) => [e, [{ hooks: [async () => (ctx.collect(e), { continue: true } as const)] }]])) as Options["hooks"],
    ...spec.extra,
    settings: {
      ...((spec.extra.settings as Record<string, unknown>) ?? {}),
      hooks: Object.fromEntries(WATCHED.map((e) => [e, [markerHook(e)]])),
    } as Options["settings"],
  };

  const denials: PhaseResult["denials"] = [];
  const resultDenials: unknown[] = [];
  const toolsUsed: string[] = [];
  const said: string[] = [];
  const warnings: string[] = [];
  let modeChange: PhaseResult["modeChange"];
  let error: string | undefined;

  const input = pushable<SDKUserMessage>();
  const first = spec.next(0);
  if (first === null) throw new Error(`probe phase ${spec.label}: needs at least one user message`);
  input.push(userMessage(first));
  try {
    const q = query({ prompt: input, options });
    let results = 0;
    for await (const m of q) {
      const msg = m as {
        type?: string;
        subtype?: string;
        tool_name?: string;
        decision_reason_type?: string;
        decision_reason?: string;
        message?: unknown;
        result?: unknown;
        permission_denials?: unknown[];
      };
      if (msg.type === "system" && msg.subtype === "permission_denied") {
        denials.push({
          tool: String(msg.tool_name),
          reasonType: msg.decision_reason_type,
          reason: msg.decision_reason,
          message: String(msg.message ?? "").slice(0, 160),
        });
        continue;
      }
      if (msg.type === "assistant") {
        const content = (msg.message as { content?: unknown })?.content;
        if (Array.isArray(content)) for (const b of content as { type?: string; name?: string }[]) if (b?.type === "tool_use") toolsUsed.push(String(b.name));
        continue;
      }
      if (msg.type !== "result") continue;
      said.push(String(msg.result ?? "").replace(/\s+/g, " ").slice(0, 200));
      if (Array.isArray(msg.permission_denials)) resultDenials.push(...msg.permission_denials);
      results++;
      if (spec.setModeAfter && results === spec.setModeAfter.results) {
        try {
          await q.setPermissionMode(spec.setModeAfter.mode);
          modeChange = { mode: spec.setModeAfter.mode, ok: true };
        } catch (e) {
          modeChange = { mode: spec.setModeAfter.mode, ok: false, error: (e as Error).message.slice(0, 240) };
        }
      }
      const following = spec.next(results);
      if (following === null) input.end();
      else input.push(userMessage(following));
    }
  } catch (e) {
    error = (e as Error).message.slice(0, 300);
  }
  await proxy.close();
  rmSync(cassette, { force: true });

  const files = existsSync(SANDBOX) ? readdirSync(SANDBOX).sort() : [];
  return { consults: [], denials, resultDenials, hookFires, hookRecords: drainMarkers(), toolsUsed, said, modeChange, files, warnings, error };
}

/**
 * The broker's consults live outside `phase` because the callback is built into
 * the phase's own options — each spec that wants one supplies its own array.
 */
const consultsOf = new Map<string, Consult[]>();
function brokerFor(label: string, deny?: (tool: string, input: Record<string, unknown>) => string | null) {
  const list: Consult[] = [];
  consultsOf.set(label, list);
  return recordingBroker(list, deny);
}

function report(spec: PhaseSpec, r: PhaseResult): void {
  const consults = consultsOf.get(spec.label) ?? [];
  console.log(`\n=== phase ${spec.label} — ${spec.condition} ===`);
  if (r.error) console.log(`  query threw: ${r.error}`);
  if (r.modeChange) {
    console.log(`  setPermissionMode(${r.modeChange.mode}): ${r.modeChange.ok ? "ACCEPTED" : `REFUSED — ${r.modeChange.error}`}`);
  }
  console.log(`  canUseTool consulted ${consults.length}×`);
  for (const c of consults.slice(0, 6)) {
    console.log(
      `    consult tool=${c.tool} decisionReason=${JSON.stringify(c.decisionReason)?.slice(0, 110)} ` +
        `matchedAskRule=${JSON.stringify(c.matchedAskRule) ?? "-"} suggestions=${c.suggestions} blockedPath=${c.blockedPath ?? "-"}`,
    );
  }
  for (const d of r.denials) console.log(`    permission_denied tool=${d.tool} reasonType=${d.reasonType ?? "-"} reason=${JSON.stringify(d.reason)?.slice(0, 90)} message=${JSON.stringify(d.message).slice(0, 120)}`);
  if (r.resultDenials.length > 0) console.log(`    result.permission_denials: ${JSON.stringify(r.resultDenials).slice(0, 300)}`);
  console.log(`  tools attempted: ${r.toolsUsed.join(", ") || "(none)"}`);
  console.log(`  sandbox after:   ${r.files.join(", ") || "(empty)"}`);
  for (const e of WATCHED) {
    const cb = r.hookFires.get(e) ?? 0;
    const cmd = r.hookRecords.get(e) ?? [];
    if (cb > 0 || cmd.length > 0 || spec.focus?.includes(e)) {
      console.log(`  ${cb > 0 || cmd.length > 0 ? "FIRED" : "-    "}  ${e.padEnd(18)} callback=${cb} command=${cmd.length}${cmd.length ? `  record: ${cmd[0].slice(0, 200)}` : ""}`);
    }
  }
  for (const [i, t] of r.said.entries()) console.log(`  said[${i}]: ${t}`);
}

/**
 * The forcing prompts. Each names ONE tool call precisely, because a phase whose
 * condition the model declined to create is indistinguishable from an arm that
 * did not run — the confusion this whole probe exists to remove.
 */
const WRITE_PROMPT =
  `Use the Write tool exactly once to create the file ${join(SANDBOX, "probe.txt")} containing the single line REFORGE_W6. ` +
  `Do not use Bash. If the tool is denied, do not retry and do not try another tool; reply with exactly DENIED.`;
const MKDIR_PROMPT =
  "Use the Bash tool exactly once to run exactly `mkdir -p reforge-w6-dir`. Do not run anything else. " +
  "If the tool is denied, do not retry; reply with exactly DENIED.";
const ECHO_PROMPT =
  "Use the Bash tool exactly once to run exactly `echo REFORGE_W6_ECHO`. Do not run anything else. " +
  "If the tool is denied, do not retry; reply with exactly DENIED.";

const rules = (behavior: string, entries: string[]) => ({ permissions: { [behavior]: entries } });

async function main(): Promise<void> {
  requireRecordCredential();
  console.log(`permission surface @ ${SURFACE.engineVersion}`);
  console.log(`  modes (from the fixture, ${SURFACE.modes.sources.length} agreeing enumerations): ${MODES.join(", ")}`);
  console.log(`  rule behaviors: ${RULE_BEHAVIORS.join(", ")}`);
  console.log(`  mode-change guard refuses: ${SURFACE.modeGuards.guarded.map((g) => g.mode).join(", ")}`);

  const specs: PhaseSpec[] = [];

  // ---- A. every mode, at SPAWN (Options.permissionMode) --------------------
  // One Write attempt per mode, with a broker that allows. What differs between
  // modes is whether the broker is CONSULTED at all and what decision arrives
  // before it — which is the whole chain, observed from its edge.
  for (const mode of MODES) {
    specs.push({
      label: `spawn-${mode}`,
      condition: `Options.permissionMode=${JSON.stringify(mode)} at spawn, one Write attempt, broker allows`,
      extra: {
        maxTurns: 4,
        permissionMode: mode,
        ...(mode === "bypassPermissions" ? { allowDangerouslySkipPermissions: true } : {}),
        canUseTool: brokerFor(`spawn-${mode}`),
      } as Partial<Options>,
      next: (r) => (r === 0 ? WRITE_PROMPT : null),
      focus: ["PermissionRequest", "PermissionDenied"],
    });
  }

  // ---- B. every mode, over the CONTROL CHANNEL (set_permission_mode) -------
  // The guard lives here and nowhere else. A no-tool first turn, then the mode
  // change, then a Write attempt under it.
  for (const mode of MODES) {
    specs.push({
      label: `channel-${mode}`,
      condition: `set_permission_mode(${JSON.stringify(mode)}) mid-session, then one Write attempt`,
      extra: { maxTurns: 6, permissionMode: "default", canUseTool: brokerFor(`channel-${mode}`) } as Partial<Options>,
      setModeAfter: { results: 1, mode },
      next: (r) => (r === 0 ? "Reply with exactly READY." : r === 1 ? WRITE_PROMPT : null),
    });
  }

  // ---- C. the rule axis, through Options.settings (the C8 seam) ------------
  specs.push({
    label: "rule-deny",
    condition: "default mode + a DENY rule on Write; the broker would allow",
    extra: { maxTurns: 4, permissionMode: "default", settings: rules("deny", ["Write"]), canUseTool: brokerFor("rule-deny") } as Partial<Options>,
    next: (r) => (r === 0 ? WRITE_PROMPT : null),
    focus: ["PermissionDenied"],
  });
  specs.push({
    label: "rule-allow",
    condition: "default mode + an ALLOW rule on Bash(mkdir:*); a non-read-only command the broker would otherwise be asked about",
    extra: { maxTurns: 4, permissionMode: "default", settings: rules("allow", ["Bash(mkdir:*)"]), canUseTool: brokerFor("rule-allow") } as Partial<Options>,
    next: (r) => (r === 0 ? MKDIR_PROMPT : null),
  });
  specs.push({
    label: "rule-ask",
    condition: "default mode + an ASK rule on Bash(echo:*) — a read-only command default mode approves WITHOUT the broker",
    extra: { maxTurns: 4, permissionMode: "default", settings: rules("ask", ["Bash(echo:*)"]), canUseTool: brokerFor("rule-ask") } as Partial<Options>,
    next: (r) => (r === 0 ? ECHO_PROMPT : null),
  });

  // ---- D. does bypassPermissions actually short-circuit the rule engine? ---
  // The scout and the campaign spec both say it does. Upstream's pre-check
  // evaluates deny rules, ask rules and the tool's own checkPermissions BEFORE
  // it reaches the bypass arm, so this phase is the difference between reading
  // the bytes and believing the summary.
  specs.push({
    label: "bypass-vs-deny-rule",
    condition: "bypassPermissions + a DENY rule on Write — does the rule still bite?",
    extra: {
      maxTurns: 4,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      settings: rules("deny", ["Write"]),
      canUseTool: brokerFor("bypass-vs-deny-rule"),
    } as Partial<Options>,
    next: (r) => (r === 0 ? WRITE_PROMPT : null),
    focus: ["PermissionDenied"],
  });

  // ---- E. the broker's own deny, and whether PermissionDenied sees it ------
  // C8 left PermissionDenied OPEN with a named condition: "a denial whose
  // decisionReason is the AUTO-MODE CLASSIFIER". An ordinary canUseTool deny is
  // NOT that condition — so this phase either fires the event (and C8's reading
  // of the call-site guard was wrong) or upgrades the OPEN row with evidence.
  specs.push({
    label: "broker-deny",
    condition: "default mode, the broker DENIES a Write — an ordinary denial, not a classifier one",
    extra: { maxTurns: 4, permissionMode: "default", canUseTool: brokerFor("broker-deny", () => "reforge probe: denied by the broker") } as Partial<Options>,
    next: (r) => (r === 0 ? WRITE_PROMPT : null),
    focus: ["PermissionRequest", "PermissionDenied"],
  });

  // ---- E2. auto mode's CLASSIFIER, which a Write cannot reach --------------
  // Both auto phases above allowed a Write without consulting anything, and the
  // reason is in the mode-aware body: before it queues a classifier call it asks
  // whether the call "would be allowed in acceptEdits mode", and a Write would.
  // So a Write measures the FAST PATH, not the classifier.
  //
  // `chmod` is neither on the accept-edits shell allowlist nor read-only, so it
  // is the cheapest call that has to reach the classifier. Two outcomes and both
  // are findings: the classifier ALLOWS (the path is live, and PermissionDenied
  // still needs a block) or it BLOCKS (and PermissionDenied's named condition is
  // finally created).
  specs.push({
    label: "auto-classifier",
    condition: "auto mode + a command the acceptEdits fast path does not cover, so the classifier has to decide",
    extra: { maxTurns: 4, permissionMode: "auto" as PermissionMode, canUseTool: brokerFor("auto-classifier") } as Partial<Options>,
    next: (r) =>
      r === 0
        ? "Use the Bash tool exactly once to run exactly `chmod 600 /etc/hosts`. Do not run anything else and do not use any other tool. " +
          "If the tool is denied, do not retry; reply with exactly DENIED."
        : null,
    focus: ["PermissionRequest", "PermissionDenied"],
  });

  // ---- F. the shadowing trap, measured rather than inherited ---------------
  specs.push({
    label: "shadowing",
    condition: "default mode + allowedTools:['Bash'] + a broker — does the bare allow SHADOW canUseTool?",
    extra: { maxTurns: 4, permissionMode: "default", allowedTools: ["Bash"], canUseTool: brokerFor("shadowing") } as Partial<Options>,
    next: (r) => (r === 0 ? MKDIR_PROMPT : null),
  });

  // `--phase a,b,c` — a comma list, because the decisive phases are a handful and
  // a full sweep is twenty live turns. A `+` prefix selects by substring, so
  // `--phase +auto` runs both of the mode's paths.
  const arg = process.argv.includes("--phase") ? process.argv[process.argv.indexOf("--phase") + 1] : null;
  const wanted = arg === null ? null : arg.split(",").map((p) => p.trim()).filter(Boolean);
  const selected = (label: string) =>
    wanted === null || wanted.some((w) => (w.startsWith("+") ? label.includes(w.slice(1)) : label === w));
  for (const spec of specs) {
    if (!selected(spec.label)) continue;
    const r = await phase(spec);
    report(spec, r);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
