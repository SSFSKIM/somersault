// Probe 109 — three AskUserQuestion tool_use blocks in ONE assistant message: who denies #2 and #3?
//
// THE BUG. In the ccx foreground REPL the model called AskUserQuestion three times in one turn. The
// first consult parked, the dialog rendered, the human answered. The second and third came back
// instantly with `Error: No user is available to answer.` — ccx's own bare-deny copy for a question
// park (harness/src/permissions/gate.ts:41), so OUR gate produced them, without a human. Native Claude
// Code asks all three, one dialog after another.
//
// The gate can only emit that string through a BARE `{kind:"deny"}` from the broker, and there are
// exactly four ways to get one:
//   (1) `requestOrAbort` sees `signal.aborted` already true on arrival           (gate.ts:46)
//   (2) the signal aborts while the request is parked                            (gate.ts:49)
//   (3) the broker rejects                                                       (gate.ts:50)
//   (4) SessionHost.broker()'s zero-connection rule: interactive + 0 sockets     (host.ts:816)
//
// ARM A (raw SDK, no ccx at all) settles (1)/(2) and tells us what the engine actually does with a
// parallel AskUserQuestion batch: how many consults arrive, when, and whether their AbortSignals are
// already aborted at entry or abort during the park. Its canUseTool holds each consult ~2s (the human
// think-time the real dialog costs) and then allows.
// ARM B rebuilds the foreground stack — SessionHost{kind:"interactive",detached:false} + a real UDS
// client socket, exactly what `cli/main.ts:397` + the loopback `RemoteChatSession` make — and answers
// each park through `host.answer()` after ~2s, which is the REPL's path. It logs `connectionCount` at
// every consult, so (4) is observable rather than inferred.
//
// Run keyed, from CC-to-SDK/probes:
//   set -a; . ../.env; set +a; npx tsx probes/109-multi-askuserquestion.ts
import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConnection } from "node:net";

const MODEL = "claude-sonnet-4-5-20250929";
const DEADLINE_MS = 180_000;
const THINK_MS = 2_000;

const PROMPT = [
  "Call the AskUserQuestion tool exactly three times in this turn, as three separate tool calls.",
  "Each call must contain exactly ONE question with exactly TWO options.",
  "Question 1: 'Which colour?' (options Red / Blue).",
  "Question 2: 'Which fruit?' (options Apple / Pear).",
  "Question 3: 'Which city?' (options Paris / Rome).",
  "Do NOT combine them into one call. Do not use any other tool.",
].join(" ");

const t0 = Date.now();
const dt = (): string => `${((Date.now() - t0) / 1000).toFixed(2)}s`;
const log = (s: string): void => { console.log(`[${dt()}] ${s}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** header→label for every question in an AskUserQuestion input: always pick the first option. */
function firstOptionAnswers(input: Record<string, unknown>): Record<string, string> {
  const qs = (input as { questions?: { question?: string; header?: string; options?: { label?: string }[] }[] }).questions ?? [];
  const out: Record<string, string> = {};
  for (const q of qs) out[q.question ?? q.header ?? "?"] = q.options?.[0]?.label ?? "Yes";
  return out;
}
function questionText(input: Record<string, unknown>): string {
  const qs = (input as { questions?: { question?: string }[] }).questions ?? [];
  return qs.map((q) => q.question ?? "?").join(" | ");
}

function inputQueue() {
  const items: SDKUserMessage[] = [];
  let wake: (() => void) | null = null;
  let closed = false;
  const push = (text: string): void => {
    items.push({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null, session_id: "" } as unknown as SDKUserMessage);
    wake?.(); wake = null;
  };
  const close = (): void => { closed = true; wake?.(); wake = null; };
  const iterable = (async function* (): AsyncIterable<SDKUserMessage> {
    while (true) {
      if (items.length) { yield items.shift()!; continue; }
      if (closed) return;
      await new Promise<void>((r) => (wake = r));
    }
  })();
  return { iterable, push, close };
}

// ───────────────────────────── ARM A: raw SDK ─────────────────────────────

async function armA(): Promise<void> {
  log("ARM A — raw SDK, instrumented canUseTool, no ccx layer");
  const cwd = mkdtempSync(join(tmpdir(), "probe109a-"));
  const q = inputQueue();
  const ac = new AbortController();
  const timer = setTimeout(() => { log("ARM A: DEADLINE — aborting"); ac.abort(); }, DEADLINE_MS);
  let n = 0;
  const arrivals: { i: number; at: number; abortedAtEntry: boolean; abortedDuringPark: boolean; abortedAtExit: boolean }[] = [];

  try {
    const session = query({
      prompt: q.iterable,
      options: {
        model: MODEL, cwd, permissionMode: "default", abortController: ac,
        settingSources: [],
        disallowedTools: ["Task", "Agent", "Bash", "Read", "Write", "Edit", "Glob", "Grep", "WebSearch", "WebFetch"],
        canUseTool: async (toolName, input, options) => {
          const i = ++n;
          const abortedAtEntry = options.signal?.aborted === true;
          let abortedDuringPark = false;
          options.signal?.addEventListener("abort", () => { abortedDuringPark = true; log(`ARM A: consult #${i} SIGNAL ABORTED during park`); }, { once: true });
          log(`ARM A: consult #${i} ${toolName} toolUseID=${options.toolUseID} abortedAtEntry=${abortedAtEntry} q="${questionText(input)}"`);
          await sleep(THINK_MS);
          const abortedAtExit = options.signal?.aborted === true;
          arrivals.push({ i, at: Date.now() - t0, abortedAtEntry, abortedDuringPark, abortedAtExit });
          log(`ARM A: consult #${i} answering  abortedAtExit=${abortedAtExit}`);
          if (toolName !== "AskUserQuestion") return { behavior: "deny", message: "probe 109 allows only AskUserQuestion" };
          return { behavior: "allow", updatedInput: { ...input, answers: firstOptionAnswers(input) } };
        },
      },
    });
    q.push(PROMPT);
    for await (const m of session as AsyncIterable<Record<string, unknown>>) {
      const type = m["type"] as string;
      if (type === "assistant") {
        const blocks = ((m["message"] as { content?: { type: string; name?: string; id?: string }[] })?.content) ?? [];
        const uses = blocks.filter((b) => b.type === "tool_use");
        if (uses.length) log(`ARM A: assistant message carries ${uses.length} tool_use block(s): ${uses.map((u) => `${u.name}/${u.id?.slice(-6)}`).join(", ")}`);
      }
      if (type === "user") {
        const blocks = ((m["message"] as { content?: unknown })?.content);
        if (Array.isArray(blocks)) for (const b of blocks as { type: string; is_error?: boolean; content?: unknown; tool_use_id?: string }[]) {
          if (b.type === "tool_result") log(`ARM A: tool_result ${b.tool_use_id?.slice(-6)} is_error=${b.is_error} content=${JSON.stringify(b.content).slice(0, 220)}`);
        }
      }
      if (type === "result") { log(`ARM A: result subtype=${m["subtype"]}`); break; }
    }
  } catch (e) {
    log(`ARM A: THREW ${(e as Error).message}`);
  } finally {
    clearTimeout(timer); q.close(); rmSync(cwd, { recursive: true, force: true });
  }
  log(`ARM A SUMMARY: ${n} consult(s); ${JSON.stringify(arrivals)}`);
}

// ─────────────────────── ARM B: the real ccx foreground stack ───────────────────────

async function armB(): Promise<void> {
  log("ARM B — SessionHost{interactive,detached:false} + a live UDS client socket");
  const cwd = mkdtempSync(join(tmpdir(), "probe109b-"));
  const fleetRoot = mkdtempSync(join(tmpdir(), "probe109fleet-"));
  const env = { ...process.env, CCX_FLEET_ROOT: fleetRoot };
  mkdirSync(join(fleetRoot, "run"), { recursive: true });

  const { SessionHost } = await import("../../harness/dist/host/host.js") as { SessionHost: new (o: Record<string, unknown>) => any };
  const { hostSocketPath } = await import("../../harness/dist/fleet/paths.js") as { hostSocketPath: (pid: number, env?: NodeJS.ProcessEnv) => string };

  const host = new SessionHost({
    short: "a109b0ff", name: "probe109", cwd, kind: "interactive", detached: false, env,
    config: {
      cwd, model: MODEL, permissionMode: "default", settingSources: [],
      disallowedTools: ["Task", "Agent", "Bash", "Read", "Write", "Edit", "Glob", "Grep", "WebSearch", "WebFetch"],
    },
  });
  await host.start();

  // The loopback client: a real socket, exactly what the REPL's RemoteChatSession holds open. Without one
  // the zero-connection rule (host.ts:816) denies everything and the run proves nothing.
  const sockPath = hostSocketPath(process.pid, env);
  const sock = await new Promise<import("node:net").Socket>((resolve, reject) => {
    const s = createConnection(sockPath);
    s.once("error", reject);
    s.once("connect", () => { s.off("error", reject); resolve(s); });
  });
  sock.on("data", () => {});
  log(`ARM B: client socket connected to ${sockPath}`);

  const seen: string[] = [];
  const off = host.follow((ev: Record<string, unknown>) => {
    if (ev["kind"] === "decision") {
      const e = ev["entry"] as { toolUseID: string; toolName: string; kind: string; input: Record<string, unknown> };
      log(`ARM B: PARKED ${e.toolName}/${e.kind} ${e.toolUseID.slice(-6)} q="${questionText(e.input)}"`);
      seen.push(e.toolUseID);
      void (async () => {
        await sleep(THINK_MS);
        const r = host.answer(e.toolUseID, { kind: "question_answer", answers: firstOptionAnswers(e.input) }, "probe");
        log(`ARM B: answered ${e.toolUseID.slice(-6)} → ${JSON.stringify(r)}`);
      })();
    }
    if (ev["kind"] === "decision_settled") log(`ARM B: SETTLED ${String(ev["toolUseID"]).slice(-6)} by=${ev["by"]} decision=${ev["decision"]}`);
    if (ev["kind"] === "message") {
      const m = ev["data"] as Record<string, unknown> | undefined;
      const type = m?.["type"];
      if (type === "assistant") {
        const blocks = ((m?.["message"] as { content?: { type: string; name?: string; id?: string }[] })?.content) ?? [];
        const uses = blocks.filter((b) => b.type === "tool_use");
        if (uses.length) log(`ARM B: assistant message carries ${uses.length} tool_use block(s): ${uses.map((u) => `${u.name}/${u.id?.slice(-6)}`).join(", ")}`);
      }
      if (type === "user") {
        const blocks = ((m?.["message"] as { content?: unknown })?.content);
        if (Array.isArray(blocks)) for (const b of blocks as { type: string; is_error?: boolean; content?: unknown; tool_use_id?: string }[]) {
          if (b.type === "tool_result") log(`ARM B: tool_result ${b.tool_use_id?.slice(-6)} is_error=${b.is_error} content=${JSON.stringify(b.content).slice(0, 220)}`);
        }
      }
      if (type === "result") log(`ARM B: result subtype=${m?.["subtype"]}`);
    }
  });

  try {
    await host.runTask(PROMPT);
    log(`ARM B: turn returned; parks seen = ${seen.length}`);
  } catch (e) {
    log(`ARM B: runTask THREW ${(e as Error).message}`);
  } finally {
    off?.();
    sock.destroy();
    await host.stop("done").catch(() => {});
    rmSync(cwd, { recursive: true, force: true });
    rmSync(fleetRoot, { recursive: true, force: true });
  }
}


// ─────────── ARM C: the same batch, but with HUMAN think-time on the head ───────────
// Arms A/B answered every consult ~2s after it arrived, so all three were settled inside 3.5s of the
// batch landing. A real dialog costs the human tens of seconds, and the siblings sit parked for all of
// it. This arm answers #1 after HEAD_MS and then holds #2/#3 for up to TAIL_MS, logging the exact
// moment either signal aborts — the one way `requestOrAbort`'s abort arm (gate.ts:49) can fire.
const HEAD_MS = Number(process.env.P109_HEAD_MS ?? 45_000);
const TAIL_MS = Number(process.env.P109_TAIL_MS ?? 150_000);

async function armC(): Promise<void> {
  log(`ARM C — raw SDK, head answered after ${HEAD_MS}ms, tail held up to ${TAIL_MS}ms`);
  const cwd = mkdtempSync(join(tmpdir(), "probe109c-"));
  const q = inputQueue();
  const ac = new AbortController();
  const timer = setTimeout(() => { log("ARM C: DEADLINE — aborting"); ac.abort(); }, TAIL_MS + 90_000);
  let n = 0;
  try {
    const session = query({
      prompt: q.iterable,
      options: {
        model: MODEL, cwd, permissionMode: "default", abortController: ac,
        settingSources: [],
        disallowedTools: ["Task", "Agent", "Bash", "Read", "Write", "Edit", "Glob", "Grep", "WebSearch", "WebFetch"],
        canUseTool: async (toolName, input, options) => {
          const i = ++n;
          const hold = i === 1 ? HEAD_MS : TAIL_MS;
          log(`ARM C: consult #${i} ${toolName} abortedAtEntry=${options.signal?.aborted === true} hold=${hold}ms q="${questionText(input)}"`);
          const aborted = await new Promise<boolean>((resolve) => {
            const t = setTimeout(() => resolve(false), hold);
            options.signal?.addEventListener("abort", () => { clearTimeout(t); log(`ARM C: consult #${i} SIGNAL ABORTED at hold+${Date.now() - t0}ms`); resolve(true); }, { once: true });
          });
          log(`ARM C: consult #${i} releasing aborted=${aborted}`);
          if (aborted) return { behavior: "deny", message: "No user is available to answer." };
          return { behavior: "allow", updatedInput: { ...input, answers: firstOptionAnswers(input) } };
        },
      },
    });
    q.push(PROMPT);
    for await (const m of session as AsyncIterable<Record<string, unknown>>) {
      const type = m["type"] as string;
      if (type === "user") {
        const blocks = ((m["message"] as { content?: unknown })?.content);
        if (Array.isArray(blocks)) for (const b of blocks as { type: string; is_error?: boolean; content?: unknown; tool_use_id?: string }[]) {
          if (b.type === "tool_result") log(`ARM C: tool_result ${b.tool_use_id?.slice(-6)} is_error=${b.is_error} content=${JSON.stringify(b.content).slice(0, 200)}`);
        }
      }
      if (type === "result") { log(`ARM C: result subtype=${m["subtype"]}`); break; }
    }
  } catch (e) { log(`ARM C: THREW ${(e as Error).message}`); }
  finally { clearTimeout(timer); q.close(); rmSync(cwd, { recursive: true, force: true }); }
}


// ─── ARM D: what ONE interrupt looks like on the wire, vs two separate declines ───
// The owner's transcript shows two denies 478 ms apart followed by `[Request interrupted by user]`.
// Two readings fit: three Esc presses (decline the 2nd dialog, decline the 3rd, then interrupt the
// turn — which requires both dialogs to have been mounted), or ONE Esc with no dialog mounted, whose
// single `denyAll()` settles both parks in the same microtask. They are distinguishable by the GAP:
// this arm answers the head and then calls `host.interrupt()` once, and stamps each denied tool_result
// as it arrives.
async function armD(): Promise<void> {
  log("ARM D — one host.interrupt() over two live parks: how far apart do the denied results land?");
  const cwd = mkdtempSync(join(tmpdir(), "probe109d-"));
  const fleetRoot = mkdtempSync(join(tmpdir(), "probe109dfleet-"));
  const env = { ...process.env, CCX_FLEET_ROOT: fleetRoot };
  mkdirSync(join(fleetRoot, "run"), { recursive: true });
  const { SessionHost } = await import("../../harness/dist/host/host.js") as { SessionHost: new (o: Record<string, unknown>) => any };
  const { hostSocketPath } = await import("../../harness/dist/fleet/paths.js") as { hostSocketPath: (pid: number, env?: NodeJS.ProcessEnv) => string };
  const host = new SessionHost({
    short: "d109c0de", name: "probe109d", cwd, kind: "interactive", detached: false, env,
    config: { cwd, model: MODEL, permissionMode: "default", settingSources: [],
      disallowedTools: ["Task", "Agent", "Bash", "Read", "Write", "Edit", "Glob", "Grep", "WebSearch", "WebFetch"] },
  });
  await host.start();
  const sock = await new Promise<import("node:net").Socket>((resolve, reject) => {
    const s = createConnection(hostSocketPath(process.pid, env));
    s.once("error", reject);
    s.once("connect", () => { s.off("error", reject); resolve(s); });
  });
  sock.on("data", () => {});
  let parks = 0;
  let interrupted = false;
  const off = host.follow((ev: Record<string, unknown>) => {
    if (ev["kind"] === "decision") {
      const e = ev["entry"] as { toolUseID: string; input: Record<string, unknown> };
      parks++;
      log(`ARM D: PARKED #${parks} ${e.toolUseID.slice(-6)}`);
      if (parks === 1) void (async () => {
        await sleep(2_000);
        log(`ARM D: answering the head ${e.toolUseID.slice(-6)}`);
        host.answer(e.toolUseID, { kind: "question_answer", answers: firstOptionAnswers(e.input) }, "probe");
      })();
      if (parks === 3 && !interrupted) { interrupted = true; void (async () => {
        await sleep(3_000);
        log("ARM D: ONE host.interrupt() now");
        await host.interrupt();
      })(); }
    }
    if (ev["kind"] === "message") {
      const m = ev["data"] as Record<string, unknown> | undefined;
      if (m?.["type"] === "user") {
        const blocks = ((m["message"] as { content?: unknown })?.content);
        if (Array.isArray(blocks)) for (const b of blocks as { type: string; is_error?: boolean; content?: unknown; tool_use_id?: string }[]) {
          if (b.type === "tool_result") log(`ARM D: tool_result ${b.tool_use_id?.slice(-6)} err=${b.is_error} ${JSON.stringify(b.content).slice(0, 80)}`);
        }
      }
    }
  });
  try { await host.runTask(PROMPT); } catch (e) { log(`ARM D: runTask threw ${(e as Error).message}`); }
  finally {
    off?.(); sock.destroy(); await host.stop("done").catch(() => {});
    rmSync(cwd, { recursive: true, force: true }); rmSync(fleetRoot, { recursive: true, force: true });
  }
}

const which = process.argv[2] ?? "both";
if (which === "a" || which === "both") await armA();
if (which === "b" || which === "both") await armB();
if (which === "c") await armC();
if (which === "d") await armD();
log("done");
process.exit(0);
