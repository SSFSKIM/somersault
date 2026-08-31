// probes/probes/119-hook-event-census.ts — bl8: WHICH hook events can ever appear on the headless
// wire, and how far does the `advisorModel` settings key actually go?
//
// P116 (2026-08-30, SDK 0.3.237) flipped P85's "hooks execute invisibly" verdict — but it proved the
// flip for exactly ONE event: PreToolUse. The client's standalone hook renderer has to decide, per
// event, whether a row is possible at all; "PreToolUse works, assume the rest do" is precisely the
// declared-vs-reachable guess this project refuses to make. So: a CENSUS across the events a real
// user actually configures in settings.json, plus the advisor settings questions bl8 needs settled.
//
//   1.  MULTI-EVENT settings command hooks, one cheap turn — PostToolUse(matcher Read), Stop,
//       UserPromptSubmit, SessionStart, SessionEnd, each `echo probe119-<event>`, with PreToolUse
//       (matcher "Read") as the CONTROL that separates "those events are dead" from "harness broken".
//       Measured per event: did {hook_started, hook_response} arrive, the exact hook_name/hook_event
//       strings, the started→response arrival delta (the live-counter feasibility question — a client
//       can only render "running Xms" if started leads response), and position relative to the
//       tool_use / tool_result frames.
//   1b. SessionEnd TIGHTENER — case 1 is one-shot, so its stream may simply close before SessionEnd
//       can fire. Re-measured on a STREAMING session that is explicitly closed and then drained,
//       with a marker FILE as the P116-style positive control: marker-without-frame = ran but silent
//       (dead on the wire); no-marker = the event has no headless firing point at all.
//   3.  advisorModel TIER ALIAS — P118 proved the advisor server tool is alive headlessly with a real
//       id (`claude-opus-4-8`). Is `advisorModel` a plain model-id passthrough, or does it resolve
//       tier aliases the way `model` does? Set to "opus" (an alias, NOT an id): the turn errors, an
//       advisor `server_tool_use` fires, or an `advisor_tool_result` carries a model_not_found error.
//   1c. SLOW-HOOK TIGHTENER — case 1's echo hooks finish in 4–32ms, which cannot distinguish "no
//       hook_progress frames exist" from "too fast to stream". A 3s ticking hook settles both that
//       and whether a live "running Xms" counter has any room to render.
//   3b/3c. advisorModel VALIDATION CONTROLS — case 3 alone cannot tell "alias resolved" from "any
//       string is ignored and a default advisor is used". A garbage id (3b) and an omitted key (3c)
//       bracket it. Read via the model's own thinking text, since the advisor is a SERVER tool and
//       never appears in init.tools — "I can see the advisor tool" vs "I don't see anything called
//       advisor" is the only readable signal for whether it was mounted.
//   4.  advisorModel RUNTIME MUTABILITY — decides a /config-row design: live toggle, or a prefs write
//       that takes effect next session? Session starts WITHOUT advisorModel, then after turn 1 calls
//       `Query.applyFlagSettings({advisorModel})` (sdk.d.ts:2478, streaming-input-only; P102 showed
//       the effortLevel form resolves live AND is unvalidated), then a turn 2 that tempts a consult.
//       Recorded separately: whether the control call RESOLVES (silent-accept vs reject is itself
//       load-bearing) and whether advisor frames then appear. Main model sonnet-5 — the model P118
//       proved consults with advisorModel at LAUNCH, so P118 is this case's launch-time control.
//   Cost note: each advisor consult bills real money (~$0.21 haiku-main, ~$0.56 sonnet-main observed).
//
// Run from CC-to-SDK/probes:
//   set -a; . ../.env; set +a; unset ANTHROPIC_API_KEY; npx tsx probes/119-hook-event-census.ts
//   Subset re-runs: P119_CASES=1b,3b npx tsx probes/119-hook-event-census.ts
//
// ── ANSWER (live 2026-08-30, SDK 0.3.237, OAuth) — 5 of 6 hook events REACHABLE, SessionEnd dead on
//    the wire; hook_progress ALIVE; advisorModel resolves tier aliases but fails SILENTLY. ──
// CENSUS: PreToolUse, PostToolUse, Stop, UserPromptSubmit, SessionStart all emit a clean
//   {hook_started, hook_response} PAIR sharing one hook_id — hook_name is "<Event>:<matcher>" where a
//   matcher exists ("PreToolUse:Read", "PostToolUse:Read", "SessionStart:startup") and bare "<Event>"
//   where none does ("Stop", "UserPromptSubmit"); hook_event is always the plain event name. Every
//   response carried output/stdout ("probe119-<Event>\n"), stderr "", exit_code 0, outcome "success".
// SessionEnd is the one DEAD event: on a streaming session explicitly closed and drained (1b) the
//   hook demonstrably RAN (marker file written) yet emitted ZERO frames, while the SessionStart pair
//   arrived in the same session. Ran-but-silent — a SessionEnd row can never be rendered.
// hook_progress is ALIVE (1c), just invisible to fast hooks: a 3s ticking hook produced 3 progress
//   frames at ~1s cadence carrying CUMULATIVE stdout (each frame repeats all prior lines — they are
//   snapshots, not deltas), sharing the pair's hook_id, with started→response = 3207ms.
// ORDERING/TIMING: started ALWAYS precedes response; deltas 4–32ms for echo hooks, 3207ms for the
//   slow one, so a live "running Xms" counter is real but will usually flash past. Placement is exact:
//   SessionStart pair fires BEFORE system/init; UserPromptSubmit pair between init and the first
//   assistant frame; PreToolUse pair immediately AFTER the assistant[tool_use] frame (3550→3553ms);
//   PostToolUse pair immediately BEFORE the user[tool_result] frame (3569→3570ms); Stop pair
//   immediately before `result`. So the tool cluster is bracketed Pre→Post around the call.
// ADVISOR: the tier alias "opus" IS resolved — the advisor mounted and a real consult fired. It is not
//   a blind passthrough: a garbage id (3b) and an omitted key (3c) both left the advisor unmounted,
//   with the model's own thinking saying it saw no advisor tool. But an invalid value NEVER errors —
//   no throw, no model_not_found, is_error:false — it just silently yields no advisor. A client must
//   validate the value itself; a typo is a silent no-op, not a visible failure.
// RUNTIME: applyFlagSettings({advisorModel}) resolves mid-session AND the next turn really consults
//   (server_tool_use + advisor_tool_result) → the /config row can be a live toggle.
// RENDERER TRAP: advisor_tool_result has TWO content shapes — {type:"advisor_result", text} (readable;
//   case 4, and P118) and {type:"advisor_redacted_result", encrypted_content} (nothing to show;
//   case 3). Both occur on successful turns, so a renderer must handle the redacted variant.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MODEL = "claude-haiku-4-5-20251001";
/** Case 4 needs a main model that actually consults the advisor — P118 proved sonnet-5 does. */
const RUNTIME_MAIN = "claude-sonnet-5";
const RUN = new Set((process.env.P119_CASES ?? "1,1b,1c,3,3b,3c,4").split(",").map((s) => s.trim()));
const want = (id: string) => RUN.has(id);
setTimeout(() => { console.log("\n!!! WATCHDOG (900s) — wedged, exiting"); process.exit(2); }, 900_000).unref?.();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Open-ended streaming input: applyFlagSettings is streaming-input-only, and the write side must
 *  stay open across the control call (the P102 v1 trap). */
function inputQueue() {
  const items: unknown[] = []; let wake: (() => void) | null = null; let closed = false;
  const push = (m: unknown) => { items.push(m); wake?.(); wake = null; };
  const close = () => { closed = true; wake?.(); wake = null; };
  const iterable = (async function* () {
    while (true) { if (items.length) { yield items.shift(); continue; } if (closed) return; await new Promise<void>((r) => (wake = r)); }
  })();
  return { iterable, push, close };
}
const userTurn = (text: string) => ({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null });

/** Events under census. PreToolUse is the control; the rest are the open questions. */
const EVENTS = ["PreToolUse", "PostToolUse", "Stop", "UserPromptSubmit", "SessionStart", "SessionEnd"] as const;
type Ev = (typeof EVENTS)[number];

/** Settings-layer command hooks, P116 case-A mechanism. Matchers only where the event supports one. */
function hookSettings(events: readonly Ev[], extraCmd: Partial<Record<Ev, string>> = {}): string {
  const entry = (ev: Ev) => ({
    ...(ev === "PreToolUse" || ev === "PostToolUse" ? { matcher: "Read" } : {}),
    hooks: [{ type: "command", command: `${extraCmd[ev] ? extraCmd[ev] + "; " : ""}echo probe119-${ev}` }],
  });
  return JSON.stringify({ hooks: Object.fromEntries(events.map((e) => [e, [entry(e)]])) });
}

interface Frame { atMs: number; lbl: string; raw: any }
const isHook = (f: Frame) => /^system\/hook_/.test(f.lbl);
const hasBlock = (f: Frame, t: string) =>
  Array.isArray(f.raw?.message?.content) && f.raw.message.content.some((b: any) => b?.type === t);
const kindsOf = (fs: Frame[]) => {
  const m = new Map<string, number>();
  for (const f of fs) m.set(f.lbl, (m.get(f.lbl) ?? 0) + 1);
  return [...m.entries()].map(([k, v]) => `${k}×${v}`).join("  ") || "(none)";
};

/** One advisor case: set advisorModel to `value` (or omit it when null), tempt a consult, report
 *  what came back. NB: `result.usage.server_tool_use` is a COUNTER object, so a bare substring match
 *  on "server_tool_use" false-positives on every result frame — match the block `"type"` instead. */
async function advisorCase(label: string, value: string | null, model: string) {
  console.log(`\n========== ${label} — advisorModel:${value === null ? "(omitted)" : JSON.stringify(value)}, main ${model} ==========`);
  const dir = mkdtempSync(join(tmpdir(), "probe119adv-"));
  writeFileSync(join(dir, "puzzle.md"), "Shard by tenant or by region? 40 tenants, 3 regions, residency locked to 1 region, hot-tenant skew 100:1.\n");
  const frames: Frame[] = [];
  let thrown: string | null = null;
  let initTools: string[] = [];
  const t0 = Date.now();
  try {
    for await (const m of query({
      prompt: "Read puzzle.md and give a one-sentence recommendation. If an advisor tool is available to you, consult it first.",
      options: {
        model, cwd: dir, settingSources: [], permissionMode: "bypassPermissions",
        ...(value === null ? {} : { settings: JSON.stringify({ advisorModel: value }) }),
      } as any,
    })) {
      const mm = m as any;
      if (mm.type === "system" && mm.subtype === "init" && Array.isArray(mm.tools)) initTools = mm.tools;
      frames.push({ atMs: Date.now() - t0, lbl: mm.type === "system" ? `system/${mm.subtype}` : String(mm.type), raw: mm });
    }
  } catch (e: any) {
    thrown = `${e?.name ?? "Error"}: ${e?.message ?? String(e)}`;
  }
  const raw = JSON.stringify(frames.map((f) => f.raw));
  const serverToolUse = raw.includes('"type":"server_tool_use"');
  const advResult = raw.includes("advisor_tool_result");
  // Does the MODEL believe an advisor tool exists? Its thinking text is the only readable signal,
  // since the advisor is a server tool and never appears in init.tools.
  const mentionsAdvisor = frames.filter((f) => f.lbl === "assistant" && /advisor/i.test(JSON.stringify(f.raw)));
  console.log("  frame kinds:", kindsOf(frames));
  console.log("  thrown:", thrown ?? "none");
  console.log(`  advisor-named tool in init.tools: ${initTools.some((t) => /advisor/i.test(t))} (server tools never appear there)`);
  console.log(`  assistant frames mentioning "advisor": ${mentionsAdvisor.length}`);
  for (const f of mentionsAdvisor.slice(0, 4)) console.log(`    @${f.atMs}ms ${JSON.stringify(f.raw).slice(0, 600)}`);
  const errHits = frames.filter((f) => /model_not_found|not_found_error|invalid_request/i.test(JSON.stringify(f.raw)));
  console.log(`  frames carrying a model-not-found/invalid-request error: ${errHits.length}`);
  for (const f of errHits) console.log(`    @${f.atMs}ms ${f.lbl} ${JSON.stringify(f.raw).slice(0, 500)}`);
  const res = frames.find((f) => f.lbl === "result");
  if (res) console.log(`  result: subtype=${res.raw.subtype} is_error=${res.raw.is_error} cost=${res.raw.total_cost_usd} text=${String(res.raw.result ?? "").slice(0, 200)}`);
  return {
    thrown, serverToolUse, advResult,
    mentions: mentionsAdvisor.length,
    plainText: raw.includes('"advisor_result"'),
    redacted: raw.includes('"advisor_redacted_result"'),
    isError: res?.raw?.is_error ?? null,
    cost: res?.raw?.total_cost_usd ?? null,
  };
}

(async () => {
  console.log("=== PROBE 119 — hook EVENT CENSUS + advisorModel surface, SDK 0.3.237 ===");
  console.log("cases:", [...RUN].join(","), "| events:", EVENTS.join(", "));
  const verdicts: Record<string, string> = {};
  let sessionEndTight = "not run";
  let slowNote = "not run";
  let adv3: Awaited<ReturnType<typeof advisorCase>> | null = null;
  let adv3b: Awaited<ReturnType<typeof advisorCase>> | null = null;
  let adv3c: Awaited<ReturnType<typeof advisorCase>> | null = null;
  let applyOutcome = "not run";
  let rtServerTool = false, rtAdvResult = false;

  // ───────────────────────── Case 1: multi-event hook census ─────────────────────────
  if (want("1")) {
    const dir = mkdtempSync(join(tmpdir(), "probe119-"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "probe119-fixture", version: "0.0.1" }, null, 2) + "\n");
    const frames: Frame[] = [];
    const t0 = Date.now();
    for await (const m of query({
      prompt: "Read the file ./package.json and tell me its name field, briefly.",
      options: {
        model: MODEL, cwd: dir, settingSources: [], permissionMode: "bypassPermissions",
        includeHookEvents: true, settings: hookSettings(EVENTS),
      } as any,
    })) {
      const mm = m as any;
      frames.push({ atMs: Date.now() - t0, lbl: mm.type === "system" ? `system/${mm.subtype}` : String(mm.type), raw: mm });
    }
    console.log("\n[census] frame kinds:", kindsOf(frames));

    const marks = frames.filter((f) => isHook(f) || hasBlock(f, "tool_use") || hasBlock(f, "tool_result") || f.lbl === "system/init" || f.lbl === "result");
    console.log("\n[census] ordered timeline (hook frames + init/tool_use/tool_result/result):");
    for (const f of marks) {
      const tag = isHook(f)
        ? `${f.lbl} name=${JSON.stringify(f.raw.hook_name)} event=${JSON.stringify(f.raw.hook_event)} id=${f.raw.hook_id}`
        : f.lbl === "system/init" ? "system/init" : f.lbl === "result" ? "result"
        : hasBlock(f, "tool_use") ? "assistant[tool_use]" : "user[tool_result]";
      console.log(`  @${String(f.atMs).padStart(6)}ms  ${tag}`);
    }

    console.log("\n[census] per-event verdict:");
    for (const ev of EVENTS) {
      const mine = frames.filter((f) => isHook(f) && f.raw.hook_event === ev);
      const started = mine.filter((f) => f.lbl === "system/hook_started");
      const responses = mine.filter((f) => f.lbl === "system/hook_response");
      const progress = mine.filter((f) => f.lbl === "system/hook_progress");
      if (!mine.length) {
        verdicts[ev] = "DEAD (no frames)";
        console.log(`  ${ev.padEnd(17)} DEAD — no hook_started/hook_response on the wire`);
        continue;
      }
      const deltas = started.map((s) => {
        const r = responses.find((x) => x.raw.hook_id === s.raw.hook_id);
        return r ? `${r.atMs - s.atMs}ms` : "no-response";
      });
      verdicts[ev] = `REACHABLE (started×${started.length} response×${responses.length} progress×${progress.length}, deltas ${deltas.join("/")})`;
      console.log(`  ${ev.padEnd(17)} REACHABLE — started×${started.length} response×${responses.length} progress×${progress.length}` +
        `  name=${JSON.stringify(mine[0].raw.hook_name)}  deltas=[${deltas.join(", ")}]`);
      for (const f of mine) console.log(`      ${f.lbl} @${f.atMs}ms  ${JSON.stringify(f.raw).slice(0, 500)}`);
    }

    const unexpected = frames.filter((f) => isHook(f) && !EVENTS.includes(f.raw.hook_event));
    if (unexpected.length) {
      console.log("\n[census] hook frames for UNCONFIGURED events (surprise surface):");
      for (const f of unexpected) console.log(`  @${f.atMs}ms ${JSON.stringify(f.raw).slice(0, 400)}`);
    }
  }

  // ───────────────────── Case 1b: SessionEnd on a closed streaming session ─────────────────────
  if (want("1b")) {
    console.log("\n========== CASE 1b: SessionEnd on a STREAMING session that is closed + drained ==========");
    const dir = mkdtempSync(join(tmpdir(), "probe119end-"));
    const marker = join(dir, "sessionend.marker");
    const frames: Frame[] = [];
    let results = 0;
    const t0 = Date.now();
    const q = inputQueue();
    const handle: any = query({
      prompt: q.iterable as any,
      options: {
        model: MODEL, cwd: dir, settingSources: [], permissionMode: "bypassPermissions",
        includeHookEvents: true, maxTurns: 4,
        // SessionStart kept alongside as the positive control that these settings hooks are live.
        settings: hookSettings(["SessionStart", "SessionEnd"], { SessionEnd: `date +%s%N > "${marker}"` }),
      } as any,
    });
    const consume = (async () => {
      for await (const m of handle) {
        const mm = m as any;
        frames.push({ atMs: Date.now() - t0, lbl: mm.type === "system" ? `system/${mm.subtype}` : String(mm.type), raw: mm });
        if (mm.type === "result") results++;
      }
    })();
    q.push(userTurn("Reply with exactly one word: DONE"));
    for (let i = 0; i < 200 && results < 1; i++) await sleep(300);
    q.close();
    // Drain to completion, then give any post-close SessionEnd hook room to land on disk.
    await Promise.race([consume, sleep(20_000)]);
    await sleep(2000);
    const ran = existsSync(marker);
    const endFrames = frames.filter((f) => isHook(f) && f.raw.hook_event === "SessionEnd");
    const startFrames = frames.filter((f) => isHook(f) && f.raw.hook_event === "SessionStart");
    console.log("  frame kinds:", kindsOf(frames));
    console.log(`  SessionStart control frames: ${startFrames.length}`);
    console.log(`  SessionEnd hook RAN (marker file): ${ran}${ran ? ` (${readFileSync(marker, "utf8").trim().slice(0, 24)})` : ""}`);
    console.log(`  SessionEnd frames on wire: ${endFrames.length}`);
    for (const f of endFrames) console.log(`    @${f.atMs}ms ${JSON.stringify(f.raw).slice(0, 400)}`);
    sessionEndTight = endFrames.length > 0
      ? "REACHABLE on a closed streaming session (one-shot query just ends too early)"
      : ran
        ? "DEAD ON WIRE — hook RAN (marker written) but emitted no frame: renderer can never show a SessionEnd row"
        : "NO FIRING POINT — hook never ran at all headlessly, even on an explicitly closed session";
    console.log(`  → ${sessionEndTight}`);
  }

  // ─────────────── Case 1c: SLOW hook — does hook_progress ever fire, and does the pair straddle it?
  // Case 1's echo hooks finish in 4–32ms, which cannot distinguish "no progress frames exist" from
  // "too fast to stream". A 3s ticking hook settles both that and whether a live counter has room. ──
  if (want("1c")) {
    console.log("\n========== CASE 1c: SLOW PreToolUse hook (3s, ticking stdout) — hook_progress? ==========");
    const dir = mkdtempSync(join(tmpdir(), "probe119slow-"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "probe119-slow", version: "0.0.1" }, null, 2) + "\n");
    const frames: Frame[] = [];
    const t0 = Date.now();
    for await (const m of query({
      prompt: "Read the file ./package.json and tell me its name field, briefly.",
      options: {
        model: MODEL, cwd: dir, settingSources: [], permissionMode: "bypassPermissions", includeHookEvents: true,
        settings: JSON.stringify({
          hooks: { PreToolUse: [{ matcher: "Read", hooks: [{ type: "command", command: "for i in 1 2 3; do echo probe119-tick-$i; sleep 1; done" }] }] },
        }),
      } as any,
    })) {
      const mm = m as any;
      frames.push({ atMs: Date.now() - t0, lbl: mm.type === "system" ? `system/${mm.subtype}` : String(mm.type), raw: mm });
    }
    const hookFrames = frames.filter(isHook);
    console.log("  frame kinds:", kindsOf(frames));
    for (const f of hookFrames) console.log(`    @${f.atMs}ms ${f.lbl} ${JSON.stringify(f.raw).slice(0, 400)}`);
    const st = hookFrames.find((f) => f.lbl === "system/hook_started");
    const rs = hookFrames.find((f) => f.lbl === "system/hook_response");
    const prog = hookFrames.filter((f) => f.lbl === "system/hook_progress");
    slowNote = `started→response ${st && rs ? `${rs.atMs - st.atMs}ms` : "n/a"}, hook_progress×${prog.length}`;
    console.log(`  → ${slowNote}${prog.length ? "" : " (no streaming stdout: a client must run its own timer between the pair)"}`);
  }

  // ───────────────────── Cases 3 / 3b: advisorModel value handling ─────────────────────
  if (want("3")) adv3 = await advisorCase("CASE 3: tier ALIAS", "opus", MODEL);
  if (want("3b")) adv3b = await advisorCase("CASE 3b: GARBAGE id (validation control)", "not-a-real-model-xyz-119", MODEL);
  if (want("3c")) adv3c = await advisorCase("CASE 3c: advisorModel OMITTED (baseline)", null, MODEL);

  // ───────────────────── Case 4: advisorModel runtime mutability ─────────────────────
  if (want("4")) {
    console.log(`\n========== CASE 4: applyFlagSettings({advisorModel}) mid-session, main ${RUNTIME_MAIN} ==========`);
    const dirR = mkdtempSync(join(tmpdir(), "probe119rt-"));
    writeFileSync(join(dirR, "puzzle.md"), "Shard by tenant or by region? 40 tenants, 3 regions, residency locked to 1 region, hot-tenant skew 100:1.\n");
    const rtFrames: Frame[] = [];
    let results = 0;
    const tr = Date.now();
    const q = inputQueue();
    const handle: any = query({
      prompt: q.iterable as any,
      // NOTE: no advisorModel at launch — the whole point is whether it can be turned on later.
      options: { model: RUNTIME_MAIN, cwd: dirR, settingSources: [], permissionMode: "bypassPermissions", maxTurns: 12 } as any,
    });
    const consume = (async () => {
      for await (const m of handle) {
        const mm = m as any;
        rtFrames.push({ atMs: Date.now() - tr, lbl: mm.type === "system" ? `system/${mm.subtype}` : String(mm.type), raw: mm });
        if (mm.type === "result") results++;
      }
    })();
    q.push(userTurn("Reply with exactly one word: READY"));
    for (let i = 0; i < 200 && results < 1; i++) await sleep(300);
    const turn1End = rtFrames.length;
    try {
      await handle.applyFlagSettings({ advisorModel: "claude-opus-4-8" });
      applyOutcome = "RESOLVED";
    } catch (e: any) {
      applyOutcome = `THREW: ${e?.message ?? String(e)}`.slice(0, 300);
    }
    console.log(`  applyFlagSettings({advisorModel:"claude-opus-4-8"}) → ${applyOutcome}`);
    q.push(userTurn("Read puzzle.md and give a one-sentence recommendation. If an advisor tool is available to you, consult it first."));
    for (let i = 0; i < 300 && results < 2; i++) await sleep(300);
    q.close();
    await Promise.race([consume, sleep(8000)]);
    console.log("  frame kinds:", kindsOf(rtFrames));
    const turn2 = rtFrames.slice(turn1End);
    const rtHits = turn2.filter((f) => /advisor_tool_result|server_tool_use|model_not_found/i.test(JSON.stringify(f.raw)));
    console.log(`  turn-2 frames with advisor blocks: ${rtHits.length}`);
    for (const f of rtHits) console.log(`    @${f.atMs}ms ${f.lbl} ${JSON.stringify(f.raw).slice(0, 700)}`);
    const rawT2 = JSON.stringify(turn2.map((f) => f.raw));
    rtServerTool = rawT2.includes('"server_tool_use"');
    rtAdvResult = rawT2.includes("advisor_tool_result");
    for (const f of rtFrames.filter((x) => x.lbl === "result")) {
      console.log(`  result: subtype=${f.raw.subtype} is_error=${f.raw.is_error} cost=${f.raw.total_cost_usd} text=${String(f.raw.result ?? "").slice(0, 160)}`);
    }
  }

  // ───────────────────────── VERDICT ─────────────────────────
  console.log("\n================= VERDICT =================");
  for (const ev of EVENTS) if (verdicts[ev]) console.log(`  ${ev.padEnd(17)} ${verdicts[ev]}`);
  if (want("1b")) console.log(`  SessionEnd (1b)   ${sessionEndTight}`);
  if (want("1c")) console.log(`  slow hook (1c)    ${slowNote}`);
  const fmt = (a: typeof adv3) => a && `thrown=${a.thrown ? "YES" : "no"} server_tool_use=${a.serverToolUse} advisor_tool_result=${a.advResult} shape=${[a.plainText && "advisor_result", a.redacted && "advisor_redacted_result"].filter(Boolean).join("+") || "—"} model_mentions=${a.mentions} is_error=${a.isError} cost=${a.cost}`;
  if (adv3) console.log(`  advisorModel "opus"          ${fmt(adv3)}`);
  if (adv3b) console.log(`  advisorModel garbage-id      ${fmt(adv3b)}`);
  if (adv3c) console.log(`  advisorModel omitted         ${fmt(adv3c)}`);
  if (adv3 && adv3b) {
    console.log(adv3b.thrown || adv3b.isError
      ? '  → advisorModel IS validated: garbage is rejected while the "opus" ALIAS is accepted — the key resolves tier aliases.'
      : adv3b.advResult
        ? '  → advisorModel is an UNVALIDATED PASSTHROUGH: garbage consults just as happily as "opus", so alias acceptance proves nothing about resolution. A client must not present the value as a validated picker.'
        : '  → garbage neither errored nor consulted, while "opus" consulted: the value gates whether the advisor is OFFERED at all, so the alias is genuinely RESOLVED (compare the omitted baseline in 3c for the off-by-default reading).');
  } else if (adv3) {
    console.log('  → alias accepted, but case 3b (garbage control) was not run — cannot distinguish resolution from silent ignore.');
  }
  if (want("4")) {
    console.log(`  advisorModel runtime          applyFlagSettings=${applyOutcome} turn2 server_tool_use=${rtServerTool} advisor_tool_result=${rtAdvResult}`);
    console.log(applyOutcome !== "RESOLVED"
      ? '  → advisorModel is LAUNCH-ONLY (control call rejected) — the /config row must be a prefs write taking effect next session.'
      : rtServerTool || rtAdvResult
        ? '  → advisorModel is LIVE mid-session — the /config row can be a live toggle.'
        : '  → SILENT ACCEPT: the call resolved but no advisor fired in turn 2; weigh against P118 (same model + prompt, advisorModel at LAUNCH → consult fired).');
  }
  process.exit(0);
})();
