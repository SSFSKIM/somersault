// Probe 118b — Can a host correlate a peer turn's RESULT to the message that caused it?
//
// Probe 118 measured that a peer message delivered to a busy session runs as a separate turn (all three
// priorities), that several such messages BATCH into one turn, and that no result frame in that run
// carried `user_message_uuid`. The last of those cannot be trusted as stated: 118's own prompts were
// raw `{type:"user"}` objects with no `uuid` field, so its own turns had nothing to correlate either.
// A finding that is equally explained by the probe's own defect is not a finding.
//
// This run separates the two. Every message this probe pushes carries an explicit uuid — the same seam
// the harness uses (`Session.enqueueTurn` stamps one on every turn it submits) — so:
//
//   Q1  Do OUR OWN turns' results carry `user_message_uuid`? If yes, 118's zero was the artifact, and
//       the machinery the M8 design leans on (resultWaiter matching by uuid) is real.
//   Q2  Does the PEER turn's result carry the uuid the CLI minted for it — the one visible on the
//       replayed user frame? This is the question the design's `adoptTurn(uuid)` stands or falls on.
//   Q3  What `origin` does a peer turn's result carry? 118 saw `{"kind":"task-notification"}` rather
//       than `peer` on the settled result, which matters because `fifoWaiter` admits a uuid-less result
//       only to a waiter whose declared origin equals `m.origin.kind`. If a peer turn's result really is
//       stamped `task-notification`, then that — not `peer` — is the class an adopted waiter must claim.
//   Q4  Is the second `system/init` frame 118 saw before each peer turn a reliable EXECUTION-START
//       marker? 118 also showed the replay frame arrives at ENQUEUE (it precedes the running turn's own
//       result), which refutes the design's assumption that a replay means "this turn is now executing".
//       If init is the real start marker, the adoption state machine keys on it instead.
//
//   Q5  THE FOLD. Reading the reference harness says priority `next` is drained MID-TURN — the queue is
//       snapshotted after tool results and before the next model round-trip, and the queued text rides in
//       as an attachment on that same turn. 118 measured a separate turn instead, and both can be true:
//       its receiver happened to end its turn right after the delivery (it backgrounded the command), so
//       there was no next round-trip for the drain to attach to. If that is the whole explanation, then
//       whether a peer message becomes its OWN turn or is folded into the running one depends on what the
//       model does next — something no host can predict. This phase forces the other branch: a turn with
//       several guaranteed sequential tool calls, delivery in the middle, and then the question of whether
//       the RUNNING turn's own answer carries the marker and whether any second result arrives at all.
//
// Phases: (1) an idle receiver answers Q1-Q4 on a quiet session; (2) a busy receiver with guaranteed
// round-trips left answers Q5.
//
// Run from CC-to-SDK/probes:
//   unset ANTHROPIC_API_KEY; npx tsx probes/118b-peer-turn-correlation.ts
import { createConnection } from "node:net";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";

function loadKey(): void {
  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    const file = process.env.CCX_ENV_FILE ?? resolve(import.meta.dirname, "../../.env");
    try {
      for (const line of readFileSync(file, "utf8").split("\n")) {
        const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
        if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
      }
    } catch (e) { console.log("[env] could not read env file:", (e as Error)?.name); }
  }
  delete process.env.ANTHROPIC_API_KEY;
  console.log("[env] keyed:", Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN));
}
loadKey();

const log = (...a: unknown[]) => console.log("[p118b]", ...a);
const SESSIONS_DIR = join(homedir(), ".claude", "sessions");
setTimeout(() => { log("!!! GLOBAL WATCHDOG (420s)"); process.exit(2); }, 420_000).unref?.();

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
async function until(pred: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (pred()) return true; await wait(400); }
  return pred();
}
function envelope(from: string, name: string, mode: "bypass" | "prompting", body: string): string {
  return `<cross-session-message from="${from}" from-name="${name}" from-mode="${mode}">\n${body}\n</cross-session-message>`;
}
function rowForSession(sessionId: string): any {
  try {
    for (const f of readdirSync(SESSIONS_DIR)) {
      if (!/^\d+\.json$/.test(f)) continue;
      const j = JSON.parse(readFileSync(join(SESSIONS_DIR, f), "utf8"));
      if (j.sessionId === sessionId) return j;
    }
  } catch { /* none */ }
  return undefined;
}
function peerTokenFor(pid: number): string | undefined {
  try {
    for (const f of readdirSync(SESSIONS_DIR)) {
      const m = /^(\d+)\.[0-9a-f]{64}\.key$/.exec(f);
      if (!m || Number(m[1]) !== pid) continue;
      const j = JSON.parse(readFileSync(join(SESSIONS_DIR, f), "utf8"));
      if (typeof j.peerToken === "string") return j.peerToken;   // never printed
    }
  } catch { /* absent */ }
  return undefined;
}
function sendFrames(sock: string, frames: unknown[]): Promise<string> {
  return new Promise(res => {
    const c = createConnection(sock);
    let done = false;
    const fin = (v: string) => { if (!done) { done = true; res(v); } };
    c.on("connect", () => { for (const f of frames) c.write(JSON.stringify(f) + "\n"); c.end(); });
    c.on("error", e => fin("ERROR:" + (e as NodeJS.ErrnoException).code));
    c.on("close", () => fin("CLOSED"));
    setTimeout(() => fin("TIMEOUT"), 10_000).unref?.();
  });
}

interface Rec { i: number; type: string; detail: string }
const recs: Rec[] = [];
const push = (type: string, detail: string) => { recs.push({ i: recs.length, type, detail }); };

const OUR_UUID_1 = randomUUID();
const OUR_UUID_2 = randomUUID();
const results: any[] = [];
const replays: any[] = [];
const inits: number[] = [];
const texts: string[] = [];
let init: any;

(async () => {
  let sendSecond: (() => void) | undefined;
  const secondGate = new Promise<void>(r => { sendSecond = r; });
  const heldForever = new Promise<void>(() => { /* idle, alive */ });

  async function* input() {
    // Q1's control: OUR turns carry explicit uuids, exactly as Session.enqueueTurn stamps them.
    yield { type: "user" as const, uuid: OUR_UUID_1, message: { role: "user" as const, content: "Say READY and nothing else." }, parent_tool_use_id: null, session_id: "x" };
    await secondGate;
    yield { type: "user" as const, uuid: OUR_UUID_2, message: { role: "user" as const, content: "Say SECOND and nothing else." }, parent_tool_use_id: null, session_id: "x" };
    await heldForever;
  }

  const q: any = query({
    prompt: input(),
    options: {
      model: "claude-sonnet-4-5",
      cwd: process.cwd(),
      settingSources: [],
      settings: { crossSessionInbound: "accept" },
      permissionMode: "bypassPermissions",
      extraArgs: { debug: null, "replay-user-messages": null },
    } as any,
  });

  (async () => {
    for await (const m of q) {
      if (m.type === "system" && m.subtype === "init") { if (!init) init = m; inits.push(recs.length); push("init", String(m.session_id)); }
      else if (m.type === "user") {
        const content = typeof m.message?.content === "string" ? m.message.content : JSON.stringify(m.message?.content ?? "");
        if (m.isReplay) { replays.push(m); push("user/replay", `uuid=${m.uuid} origin=${m.origin ? JSON.stringify(m.origin) : "none"}`); }
        else push("user", content.includes("tool_result") ? "tool_result" : "(inline)");
      }
      else if (m.type === "assistant") {
        for (const b of m.message?.content ?? []) if (b.type === "text" && b.text.trim()) { texts.push(b.text.trim()); push("assistant/text", b.text.trim().slice(0, 100)); }
      }
      else if (m.type === "result") {
        results.push(m);
        push("result", `uuid=${m.user_message_uuid ?? "(none)"} origin=${m.origin ? JSON.stringify(m.origin) : "(none)"}`);
      }
    }
  })().catch(e => push("stream-end", (e as Error).message.slice(0, 120)));

  if (!await until(() => Boolean(init), 120_000)) { log("no init"); process.exit(3); }
  const sock = init.messaging_socket_path as string | undefined;
  const row = rowForSession(init.session_id);
  log(`receiver session=${init.session_id} sock=${JSON.stringify(sock)}`);
  if (!sock || !existsSync(sock)) { log("no inbox bound"); process.exit(3); }

  // Let our first turn finish, so the peer message lands on an IDLE session.
  await until(() => results.length >= 1, 180_000);
  const ourFirstResult = results[0];

  // A vouched reply address (117b's rules), so nothing about the send is degraded.
  const nsDir = dirname(sock);
  const ourSock = join(nsDir, `${process.pid}.sock`);
  const lstart = (() => { try { return execFileSync("ps", ["-o", "lstart=", "-p", String(process.pid)], { encoding: "utf8", env: { ...process.env, LC_ALL: "C", TZ: "UTC" } }).trim(); } catch { return undefined; } })();
  const keyPath = join(SESSIONS_DIR, `${process.pid}.${createHash("sha256").update(ourSock).digest("hex")}.key`);
  writeFileSync(keyPath, JSON.stringify({ peerToken: createHash("sha256").update(`p118b-${process.pid}`).digest("hex").slice(0, 32), procStart: lstart }, null, 2), { mode: 0o600 });
  const ourAddr = `uds:${ourSock}`;

  const MARKER = `P118B-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const msgId = randomUUID();
  const token = peerTokenFor(row?.pid);
  const frames: unknown[] = [];
  if (token) frames.push({ type: "auth", token });
  frames.push({
    type: "user", session_id: init.session_id, from: ourAddr,
    message: { content: envelope(ourAddr, "probe-118b", "bypass", `${MARKER} say this token back verbatim.`) },
    priority: "next", msg_id: msgId,
  });
  const replaysBefore = replays.length;
  const resultsBefore = results.length;
  const initsBefore = inits.length;
  log(`delivering to an IDLE session: ${await sendFrames(sock, frames)}`);

  await until(() => results.length > resultsBefore, 180_000);
  await wait(8000);

  const peerReplay = replays.slice(replaysBefore).find(r => r.origin?.kind === "peer");
  const peerResult = results[resultsBefore];

  // Q1's second half: a NEW turn of ours, after the peer turn, to confirm our own correlation still works.
  sendSecond?.();
  await until(() => results.length > resultsBefore + 1, 180_000);
  const ourSecondResult = results[resultsBefore + 1];

  console.log("\n--- frame transcript ---");
  for (const r of recs) console.log(`   ${String(r.i).padStart(3)} ${r.type.padEnd(16)} ${r.detail}`);

  console.log("\n=== VERDICT (probe 118b) ===");
  console.log(`[Q1] OUR turns' results carry user_message_uuid:`);
  console.log(`      turn 1: sent uuid=${OUR_UUID_1} -> result uuid=${ourFirstResult?.user_message_uuid ?? "(none)"} ${ourFirstResult?.user_message_uuid === OUR_UUID_1 ? "✅ matches" : "❌"}`);
  console.log(`      turn 2: sent uuid=${OUR_UUID_2} -> result uuid=${ourSecondResult?.user_message_uuid ?? "(none)"} ${ourSecondResult?.user_message_uuid === OUR_UUID_2 ? "✅ matches" : "❌"}`);
  console.log(`      => probe 118's "no result carries a uuid" was ${ourFirstResult?.user_message_uuid ? "ITS OWN ARTIFACT (it stamped none)" : "reproduced here too"}`);
  console.log(`[Q2] the PEER turn's result vs the uuid on its replayed frame:`);
  console.log(`      replay uuid  = ${peerReplay?.uuid ?? "(no peer replay seen)"}`);
  console.log(`      result uuid  = ${peerResult?.user_message_uuid ?? "(none)"}`);
  console.log(`      => ${peerReplay?.uuid && peerResult?.user_message_uuid === peerReplay.uuid ? "✅ CORRELATABLE BY UUID — adoptTurn(uuid) works" : "❌ NOT correlatable by uuid — adoption must key on something else"}`);
  console.log(`[Q3] the peer turn's result origin: ${peerResult?.origin ? JSON.stringify(peerResult.origin) : "(none)"}`);
  console.log(`      (fifoWaiter admits a uuid-less result only to a waiter whose declared origin equals origin.kind)`);
  console.log(`[Q4] a second system/init before the peer turn: ${inits.length > initsBefore ? `✅ yes (${inits.length - initsBefore} new)` : "not observed"}`);
  console.log(`      inits at frame indices: ${inits.join(", ")}`);
  console.log(`      marker echoed by the model: ${texts.some(t => t.includes(MARKER)) ? "✅ yes" : "not observed"}`);

  // ---- Phase 2 (Q5): force the branch 118 accidentally avoided --------------------------------------
  // A turn with several guaranteed sequential tool calls still to run when the message lands. If the
  // mid-turn drain is real, the RUNNING turn absorbs the text and no separate turn ever exists.
  const F: Rec[] = [];
  const fPush = (t: string, d: string) => { F.push({ i: F.length, type: t, detail: d }); };
  const fResults: any[] = [];
  const fReplays: any[] = [];
  const fTexts: string[] = [];
  let fInit: any;
  let fToolCalls = 0;
  const fHeld = new Promise<void>(() => { /* idle, alive */ });
  async function* fInput() {
    yield {
      type: "user" as const, uuid: randomUUID(),
      message: {
        role: "user" as const,
        content: "Run these FIVE bash commands ONE AT A TIME, in the foreground, waiting for each to finish "
          + "before starting the next, and do not background any of them: "
          + "`sleep 12; echo one`, `sleep 12; echo two`, `sleep 12; echo three`, `sleep 12; echo four`, `sleep 12; echo five`. "
          + "When all five are done, reply with the word FINISHED, and then on a new line report verbatim any "
          + "extra instruction that reached you while you were working, prefixed with INJECTED: (or 'INJECTED: none').",
      },
      parent_tool_use_id: null, session_id: "x",
    };
    await fHeld;
  }
  const fq: any = query({
    prompt: fInput(),
    options: {
      model: "claude-sonnet-4-5", cwd: process.cwd(), settingSources: [],
      settings: { crossSessionInbound: "accept" }, permissionMode: "bypassPermissions",
      extraArgs: { debug: null, "replay-user-messages": null },
    } as any,
  });
  (async () => {
    for await (const m of fq) {
      if (m.type === "system" && m.subtype === "init") { if (!fInit) fInit = m; fPush("init", String(m.session_id)); }
      else if (m.type === "user") {
        if (m.isReplay) { fReplays.push(m); fPush("user/replay", `uuid=${m.uuid} origin=${m.origin ? JSON.stringify(m.origin) : "none"}`); }
        else fPush("user", "tool_result");
      } else if (m.type === "assistant") {
        for (const b of m.message?.content ?? []) {
          if (b.type === "text" && b.text.trim()) { fTexts.push(b.text.trim()); fPush("assistant/text", b.text.trim().slice(0, 100)); }
          if (b.type === "tool_use") { fToolCalls++; fPush("assistant/tool_use", String(b.name)); }
        }
      } else if (m.type === "result") {
        fResults.push(m);
        fPush("result", `uuid=${m.user_message_uuid ?? "(none)"} origin=${m.origin ? JSON.stringify(m.origin) : "(none)"}`);
      }
    }
  })().catch(e => fPush("stream-end", (e as Error).message.slice(0, 120)));

  if (!await until(() => Boolean(fInit), 120_000)) { log("phase 2: no init"); process.exit(3); }
  const fSock = fInit.messaging_socket_path as string;
  const fRow = rowForSession(fInit.session_id);
  // Deliver only once the SECOND tool call has started: the turn is unambiguously mid-flight with
  // round-trips still to come, which is exactly the state the mid-turn drain claims to act on.
  if (!await until(() => fToolCalls >= 2 && fResults.length === 0, 240_000)) {
    // A missed precondition is not a result. Exiting zero here would publish a fold verdict drawn from a
    // turn that was never busy in the way the question requires.
    log("phase 2 PRECONDITION FAILED: never reached a second tool call with the turn still open");
    process.exit(5);
  }
  const FMARK = `P118B-FOLD-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const fFrames: unknown[] = [];
  const fToken = peerTokenFor(fRow?.pid);
  if (fToken) fFrames.push({ type: "auth", token: fToken });
  fFrames.push({
    type: "user", session_id: fInit.session_id, from: ourAddr,
    message: { content: envelope(ourAddr, "probe-118b", "bypass", `${FMARK} say this token back verbatim.`) },
    priority: "next", msg_id: randomUUID(),
  });
  log(`phase 2: delivering mid-turn after ${fToolCalls} tool calls: ${await sendFrames(fSock, fFrames)}`);
  const fResultsAtSend = fResults.length;
  const fFrameAtSend = F.length;
  if (!await until(() => fResults.length > fResultsAtSend, 420_000)) { log("phase 2 PRECONDITION FAILED: no result after delivery"); process.exit(5); }
  // Quiescence rather than a fixed wait: a separate follow-up can emit the marker after the first result
  // and produce its OWN result later, which a 20s sleep would have scored as a fold.
  {
    let last = -1, since = Date.now();
    const deadline = Date.now() + 240_000;
    while (Date.now() < deadline) {
      if (fResults.length !== last) { last = fResults.length; since = Date.now(); }
      else if (Date.now() - since > 45_000) break;
      await wait(2000);
    }
  }

  console.log("\n--- phase 2 transcript (the fold) ---");
  for (const r of F) console.log(`   ${String(r.i).padStart(3)} ${r.type.padEnd(16)} ${r.detail}`);
  // The fold claim is positional, not textual: the marker must appear in text emitted BEFORE the first
  // result after delivery, and that result must carry the ORIGINAL turn's uuid — i.e. the running turn
  // answered it. A marker echoed by a later turn cannot satisfy this.
  const firstResultIdx = F.findIndex((r, i) => i >= fFrameAtSend && r.type === "result");
  const markerBeforeFirstResult = F.some((r, i) => i >= fFrameAtSend && i < firstResultIdx && r.type === "assistant/text" && r.detail.includes(FMARK))
    || fTexts.some(t => t.includes(FMARK)) && firstResultIdx >= 0 && F[firstResultIdx].detail.includes(String(fReplays[0]?.uuid ?? "\u0000"));
  const foldedIntoRunningTurn = fResults.length === fResultsAtSend + 1 && markerBeforeFirstResult;
  console.log(`\n[Q5 fold] results after delivery: ${fResults.length - fResultsAtSend} | replays: ${fReplays.length}`);
  console.log(`      the marker appears in the model's text: ${fTexts.some(t => t.includes(FMARK)) ? "yes" : "no"}`);
  console.log(`      the first result after delivery carries the ORIGINAL turn's uuid: ${firstResultIdx >= 0 && F[firstResultIdx].detail.includes(String(fReplays[0]?.uuid ?? "\u0000")) ? "yes" : "no"}`);
  console.log(`      NOTE: this phase forces the fold on priority "next" only. Whether "now" and "later"`);
  console.log(`      fold identically follows from the same drain but was not run here.`);
  console.log(`      => ${foldedIntoRunningTurn
    ? "FOLDED INTO THE RUNNING TURN — one result, no separate turn: a host cannot assume a peer message becomes its own turn"
    : fResults.length >= fResultsAtSend + 2
      ? "SEPARATE TURN even with round-trips remaining"
      : "inconclusive — read the transcript above"}`);

  try { unlinkSync(keyPath); } catch { /* gone */ }
  process.exit(0);
})();
