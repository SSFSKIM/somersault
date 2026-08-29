// Probe 119 — Is there a DEFINITIVE turn-boundary signal, and who owns the next turn at a contested one?
//
// The M8 design's hardest problem is knowing when a turn this server did not start begins. Rev 3 inferred
// it from "model production while we believe the thread is idle", and an adversarial review rightly called
// that timing inference: at settlement the server clears busy and drains its own queue, so a queued client
// turn and a peer turn can both be starting, and production alone cannot say whose output is arriving.
//
// But the transcripts of 118/118b already suggest the engine states it outright. Counting `system/init`
// frames against turns in all three measured outcomes:
//     separate follow-up : 2 inits, 2 results      (our turn, then the peer turn)
//     batched (2 msgs)   : 2 inits, 2 results      (our turn, then ONE peer turn for both)
//     folded             : 1 init,  1 result       (no second turn, and no second init)
// and 118b's idle phase saw 3 inits for 3 turns, two of which were ours. That is one init per turn, ours
// included — an explicit engine signal, not a heuristic. This probe tests that hypothesis where it is
// hardest and where the design actually depends on it:
//
//   Q1  Is `system/init` emitted exactly once per turn, for OUR turns as well as peer turns? Counted over
//       a run with a known number of turns of each kind.
//   Q2  THE CONTESTED BOUNDARY. A peer message arrives while a turn is running, and the host pushes its
//       OWN next turn during the same busy window — the exact interleaving the review names. When the
//       running turn settles, two turns are pending inside the CLI. Which init comes first, and can each
//       init be attributed to its turn by what follows it? If the peer's runs first (it was enqueued
//       first), a host can attribute by cohort: at settlement, the next init belongs to the oldest
//       unconsumed arrival, and only after those are exhausted does an init belong to the host's own
//       dispatch.
//   Q3  Does anything OTHER than a turn start emit an init on a live session (so that a host keying
//       adoption on init would mint a phantom turn)? Watched across the whole run.
//
// Every message this probe pushes carries an explicit uuid, so our own turns are correlatable and the
// attribution question is answerable from the transcript rather than from timing.
//
// Run from CC-to-SDK/probes:
//   unset ANTHROPIC_API_KEY; npx tsx probes/119-turn-boundary-signal.ts
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

const log = (...a: unknown[]) => console.log("[p119]", ...a);
const SESSIONS_DIR = join(homedir(), ".claude", "sessions");
setTimeout(() => { log("!!! GLOBAL WATCHDOG (600s)"); process.exit(2); }, 600_000).unref?.();

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
async function until(pred: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (pred()) return true; await wait(300); }
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

interface Rec { i: number; kind: "init" | "replay" | "text" | "tool" | "toolresult" | "result" | "other"; detail: string }
const F: Rec[] = [];
const put = (kind: Rec["kind"], detail: string) => { F.push({ i: F.length, kind, detail }); };

const HOST_TURN_1 = randomUUID();
const HOST_TURN_2 = randomUUID();
const PEER_MARK = `P119-PEER-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
const HOST_MARK = `P119-HOST-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
let init: any;
let toolCalls = 0;
const results: any[] = [];

(async () => {
  let pushSecond: (() => void) | undefined;
  const secondGate = new Promise<void>(r => { pushSecond = r; });
  const forever = new Promise<void>(() => { /* keep alive */ });

  async function* input() {
    // Turn 1: guaranteed foreground round-trips, so the peer message lands unambiguously mid-turn.
    yield {
      type: "user" as const, uuid: HOST_TURN_1,
      message: {
        role: "user" as const,
        content: "Run these THREE bash commands one at a time in the foreground, waiting for each to finish: "
          + "`sleep 5; echo a`, `sleep 5; echo b`, `sleep 5; echo c`. Then reply with the single word ALPHA.",
      },
      parent_tool_use_id: null, session_id: "x",
    };
    // Turn 2: pushed DURING turn 1's busy window, after the peer message is already queued. This is the
    // contested boundary — two turns pending inside the CLI when turn 1 settles.
    await secondGate;
    yield {
      type: "user" as const, uuid: HOST_TURN_2,
      message: { role: "user" as const, content: `Reply with exactly this token and nothing else: ${HOST_MARK}` },
      parent_tool_use_id: null, session_id: "x",
    };
    await forever;
  }

  const q: any = query({
    prompt: input(),
    options: {
      model: "claude-sonnet-4-5", cwd: process.cwd(), settingSources: [],
      settings: { crossSessionInbound: "accept" }, permissionMode: "bypassPermissions",
      extraArgs: { debug: null, "replay-user-messages": null },
    } as any,
  });

  (async () => {
    for await (const m of q) {
      if (m.type === "system" && m.subtype === "init") { if (!init) init = m; put("init", `session=${m.session_id}`); }
      else if (m.type === "user") {
        const content = typeof m.message?.content === "string" ? m.message.content : JSON.stringify(m.message?.content ?? "");
        if (m.isReplay) put("replay", `uuid=${m.uuid} origin=${m.origin?.kind ?? "none"}${m.origin?.msg_id ? ` msg_id=${m.origin.msg_id}` : ""}`);
        else if (content.includes("tool_result")) put("toolresult", "");
        else put("other", "user");
      } else if (m.type === "assistant") {
        for (const b of m.message?.content ?? []) {
          if (b.type === "text" && b.text.trim()) put("text", b.text.trim().slice(0, 90));
          if (b.type === "tool_use") { toolCalls++; put("tool", String(b.name)); }
        }
      } else if (m.type === "result") {
        results.push(m);
        put("result", `uuid=${m.user_message_uuid ?? "(none)"} origin=${m.origin?.kind ?? "(none)"}`);
      } else if (m.type !== "stream_event") put("other", String(m.type));
    }
  })().catch(e => put("other", "stream-end: " + (e as Error).message.slice(0, 80)));

  if (!await until(() => Boolean(init), 120_000)) { log("no init"); process.exit(3); }
  const sock = init.messaging_socket_path as string;
  const row = rowForSession(init.session_id);
  if (!sock || !existsSync(sock)) { log("no inbox"); process.exit(3); }

  // Vouched reply address (117b's rules).
  const ourSock = join(dirname(sock), `${process.pid}.sock`);
  const lstart = (() => { try { return execFileSync("ps", ["-o", "lstart=", "-p", String(process.pid)], { encoding: "utf8", env: { ...process.env, LC_ALL: "C", TZ: "UTC" } }).trim(); } catch { return undefined; } })();
  const keyPath = join(SESSIONS_DIR, `${process.pid}.${createHash("sha256").update(ourSock).digest("hex")}.key`);
  writeFileSync(keyPath, JSON.stringify({ peerToken: createHash("sha256").update(`p119-${process.pid}`).digest("hex").slice(0, 32), procStart: lstart }, null, 2), { mode: 0o600 });
  const ourAddr = `uds:${ourSock}`;

  // Wait until turn 1 is unambiguously mid-flight with round-trips still to come.
  if (!await until(() => toolCalls >= 1 && results.length === 0, 240_000)) {
    log("PRECONDITION FAILED: turn 1 never reached a tool call while still open"); process.exit(5);
  }
  const peerMsgId = randomUUID();
  const frames: unknown[] = [];
  const token = peerTokenFor(row?.pid);
  if (token) frames.push({ type: "auth", token });
  frames.push({
    type: "user", session_id: init.session_id, from: ourAddr,
    message: { content: envelope(ourAddr, "probe-119", "bypass", `Reply with exactly this token and nothing else: ${PEER_MARK}`) },
    priority: "next", msg_id: peerMsgId,
  });
  log(`peer message delivered mid-turn: ${await sendFrames(sock, frames)}`);
  await wait(1500);
  // ...and NOW the host queues its own next turn, behind the peer's, inside the same busy window.
  log("host queues its own turn 2 behind the peer message");
  pushSecond?.();

  // Quiescence, with a FLOOR. A bare "no change for 40s" is satisfied by a count that has never moved off
  // zero, which is how this probe's first run concluded while turn 1 was still executing. Quiescence may
  // only be declared once the run has produced at least the turns it is asking about.
  const MIN_RESULTS = 2;
  {
    let last = -1, since = Date.now();
    const deadline = Date.now() + 480_000;
    while (Date.now() < deadline) {
      if (results.length !== last) { last = results.length; since = Date.now(); }
      else if (results.length >= MIN_RESULTS && Date.now() - since > 40_000) break;
      await wait(2000);
    }
  }
  if (results.length < MIN_RESULTS) {
    console.log(`\n[p119] PRECONDITION FAILED: only ${results.length} result(s) — the run never reached the boundary this probe asks about.`);
    console.log("--- transcript so far ---");
    for (const r of F) console.log(`   ${String(r.i).padStart(3)} ${r.kind.padEnd(11)} ${r.detail}`);
    try { unlinkSync(keyPath); } catch { /* gone */ }
    process.exit(5);
  }

  console.log("\n--- transcript ---");
  for (const r of F) console.log(`   ${String(r.i).padStart(3)} ${r.kind.padEnd(11)} ${r.detail}`);

  const inits = F.filter(r => r.kind === "init");
  const res = F.filter(r => r.kind === "result");
  // Attribute each init to the turn that follows it: the first marker text or result after that init.
  const segments = inits.map((initRec, k) => {
    const from = initRec.i;
    const to = k + 1 < inits.length ? inits[k + 1].i : F.length;
    const slice = F.slice(from, to);
    const text = slice.filter(r => r.kind === "text").map(r => r.detail).join(" | ");
    const resultRec = slice.find(r => r.kind === "result");
    const owner = text.includes(PEER_MARK) ? "PEER"
      : text.includes(HOST_MARK) ? "HOST-turn2"
      : text.includes("ALPHA") ? "HOST-turn1"
      : resultRec?.detail.includes(HOST_TURN_1) ? "HOST-turn1"
      : resultRec?.detail.includes(HOST_TURN_2) ? "HOST-turn2"
      : "unattributed";
    return { at: from, owner, result: resultRec?.detail ?? "(none)" };
  });

  console.log("\n=== VERDICT (probe 119) ===");
  console.log(`[Q1] inits=${inits.length} results=${res.length} -> ${inits.length === res.length ? "✅ ONE INIT PER TURN (ours included)" : "❌ counts differ — init is not a per-turn signal"}`);
  console.log(`[Q2] the contested boundary — each init and the turn that followed it:`);
  for (const s of segments) console.log(`      init@${String(s.at).padStart(3)} -> ${s.owner.padEnd(12)} result: ${s.result}`);
  const order = segments.map(s => s.owner);
  const peerIdx = order.indexOf("PEER"), host2Idx = order.indexOf("HOST-turn2");
  console.log(`      => ${peerIdx >= 0 && host2Idx >= 0
    ? (peerIdx < host2Idx
        ? "PEER RAN FIRST — the arrival enqueued before the host's dispatch keeps its place, so at a contested boundary the next init belongs to the oldest unconsumed arrival"
        : "HOST RAN FIRST — a host cannot assume its queued turn waits behind an earlier arrival")
    : "inconclusive — one of the two turns never ran (see the transcript)"}`);
  console.log(`[Q3] inits not followed by any turn output (phantom risk): ${segments.filter(s => s.owner === "unattributed").length}`);
  console.log(`[Q4] peer marker echoed: ${F.some(r => r.kind === "text" && r.detail.includes(PEER_MARK)) ? "yes" : "no"} | host marker echoed: ${F.some(r => r.kind === "text" && r.detail.includes(HOST_MARK)) ? "yes" : "no"}`);

  try { unlinkSync(keyPath); } catch { /* gone */ }
  process.exit(0);
})();
