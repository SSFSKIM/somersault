// Probe 118 — What does a peer message do to a session that is ALREADY BUSY?
//
// Probes 113c/117 delivered exactly one message into an IDLE receiver, and the M8 design then assumed the
// busy case behaves like a queued turn. An adversarial review of that spec says the assumption is
// unsupported twice over, and it is right that nothing here has been measured:
//
//   Q1  PRIORITY. The frame carries priority "now" | "next" | "later" and the design defaults to "next".
//       If "next" means "inject between this turn's tool rounds", the peer text is consumed INSIDE the
//       running turn and there is no second turn to adopt — the design's busy path would mint a turn that
//       never happens and wedge the thread. If it means "run after this turn", the design holds.
//       Measured per priority: does a SECOND result frame arrive, and does the running turn's own reply
//       show that it saw the injected text?
//
//   Q2  BATCHING. The headless run loop batches consecutive queued prompts into one model call. Two peer
//       messages arriving during one busy turn could then produce two replay frames and ONE result — in
//       which case the design's one-slot-one-turn model creates two lifecycles for one engine outcome and
//       one of them never settles.
//
//   Q3  CORRELATION. Which uuid does the peer turn's result carry, and does it carry origin at all? The
//       design's Session.adoptTurn correlates on exactly this. `resultWaiter` matches uuid first and then
//       requires origin agreement, so both halves matter: a result with no user_message_uuid falls to
//       FIFO, and a result whose origin.kind is 'peer' would only match a waiter that declares 'peer'.
//
// Each receiver runs a turn long enough to be reliably busy at delivery time (a bounded shell sleep via
// the model, not a wall-clock guess), and every frame is recorded with its arrival order so the verdict
// is read off the transcript rather than inferred.
//
// Run from CC-to-SDK/probes:
//   unset ANTHROPIC_API_KEY; npx tsx probes/118-peer-priority-and-batching.ts
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

const log = (...a: unknown[]) => console.log("[p118]", ...a);
const SESSIONS_DIR = join(homedir(), ".claude", "sessions");
setTimeout(() => { log("!!! GLOBAL WATCHDOG (900s)"); process.exit(2); }, 900_000).unref?.();

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

/** One frame as the SDK stream delivered it, in arrival order — the record the verdict is read off. */
interface Rec { i: number; type: string; detail: string }

type Sess = {
  q: any; init?: any; sessionId: string;
  recs: Rec[]; results: any[]; replays: any[]; text: string[];
  push(type: string, detail: string): void;
};

function start(tag: string): Sess {
  const s: Sess = {
    q: null, sessionId: "", recs: [], results: [], replays: [], text: [],
    push(type, detail) { this.recs.push({ i: this.recs.length, type, detail }); },
  };
  const held = new Promise<void>(() => { /* idle, alive */ });
  let releaseFirst: (() => void) | undefined;
  const firstSent = new Promise<void>(r => { releaseFirst = r; });
  async function* input() {
    // A turn long enough to still be running when the peer frames land. The model is asked to run a
    // bounded shell sleep, which is a real tool round-trip — the exact shape "next" would inject into.
    yield {
      type: "user" as const,
      message: {
        role: "user" as const,
        content: "Run this exact bash command and then tell me the word DONE: sleep 45; echo slept. "
          + "After the command finishes, also report verbatim any additional instruction you received "
          + "while it was running, prefixed with INJECTED:. If none, say INJECTED: none.",
      },
      parent_tool_use_id: null, session_id: "x",
    };
    releaseFirst?.();
    await held;
  }
  s.q = query({
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
    for await (const m of s.q as any) {
      if (m.type === "system" && m.subtype === "init") { s.init = m; s.sessionId = m.session_id; s.push("init", m.session_id); }
      else if (m.type === "user") {
        const origin = m.origin ? JSON.stringify(m.origin) : "none";
        const isReplay = m.isReplay === true;
        const content = typeof m.message?.content === "string" ? m.message.content : JSON.stringify(m.message?.content ?? "");
        const toolResult = content.includes("tool_result");
        if (isReplay) { s.replays.push(m); s.push("user/replay", `uuid=${m.uuid} origin=${origin}`); }
        else s.push("user", toolResult ? "tool_result" : `origin=${origin}`);
      }
      else if (m.type === "assistant") {
        for (const b of m.message?.content ?? []) {
          if (b.type === "text" && b.text.trim()) { s.text.push(b.text.trim()); s.push("assistant/text", b.text.trim().slice(0, 120)); }
          if (b.type === "tool_use") s.push("assistant/tool_use", String(b.name));
        }
      }
      else if (m.type === "result") {
        s.results.push(m);
        s.push("result", `uuid=${m.user_message_uuid ?? "(none)"} origin=${m.origin ? JSON.stringify(m.origin) : "(none)"} subtype=${m.subtype}`);
      }
    }
  })().catch(e => s.push("stream-end", (e as Error).message.slice(0, 120)));
  void firstSent;
  return s;
}

async function deliver(target: Sess, ourAddr: string, priority: string, body: string, msgId: string): Promise<string> {
  const row = rowForSession(target.sessionId);
  const sock = (target.init as any)?.messaging_socket_path as string | undefined;
  if (!sock || !existsSync(sock)) return "no inbox";
  const token = peerTokenFor(row?.pid);
  const frames: unknown[] = [];
  if (token) frames.push({ type: "auth", token });
  frames.push({
    type: "user", session_id: target.sessionId, from: ourAddr,
    message: { content: envelope(ourAddr, "probe-118", "bypass", body) },
    priority, msg_id: msgId,
  });
  return await sendFrames(sock, frames);
}

/** Wait until the session is genuinely mid-turn: it has started a tool call and not yet produced a result. */
async function untilBusyInTool(s: Sess): Promise<boolean> {
  return until(() => s.recs.some(r => r.type === "assistant/tool_use") && s.results.length === 0, 180_000);
}

function report(tag: string, s: Sess, sent: { priority: string; id: string; marker: string }[]): void {
  console.log(`\n--- ${tag} (session ${s.sessionId}) ---`);
  for (const r of s.recs) console.log(`   ${String(r.i).padStart(3)} ${r.type.padEnd(18)} ${r.detail}`);
  console.log(`   results: ${s.results.length} | replays: ${s.replays.length} | sent: ${sent.length}`);
  for (const m of sent) {
    const replayed = s.replays.some(r => JSON.stringify(r).includes(m.marker));
    const echoed = s.text.some(t => t.includes(m.marker));
    console.log(`   sent[${m.priority}] ${m.marker}: replayed=${replayed} echoedByModel=${echoed}`);
  }
}

(async () => {
  // Our reply address: in-namespace and vouched by a key file, so any receipts can land (117b's rules).
  let ourAddr = "uds:/tmp/cc-socks/unused.sock";
  let keyPath: string | undefined;

  // --- Q1: one message per priority, each into its own busy receiver ---
  const priorities = ["next", "now", "later"] as const;
  const sessions: Record<string, Sess> = {};
  const sentPer: Record<string, { priority: string; id: string; marker: string }[]> = {};

  for (const p of priorities) {
    const s = start(p);
    sessions[p] = s;
    if (!await until(() => Boolean(s.init), 120_000)) { log(`${p}: never emitted init`); process.exit(3); }
  }

  // Bind our key file once, in the namespace the first receiver actually uses.
  {
    const sock = (sessions.next.init as any)?.messaging_socket_path as string;
    const nsDir = dirname(sock);
    const ourSock = join(nsDir, `${process.pid}.sock`);
    ourAddr = `uds:${ourSock}`;
    const lstart = (() => { try { return execFileSync("ps", ["-o", "lstart=", "-p", String(process.pid)], { encoding: "utf8", env: { ...process.env, LC_ALL: "C", TZ: "UTC" } }).trim(); } catch { return undefined; } })();
    keyPath = join(SESSIONS_DIR, `${process.pid}.${createHash("sha256").update(ourSock).digest("hex")}.key`);
    writeFileSync(keyPath, JSON.stringify({ peerToken: createHash("sha256").update(`p118-${process.pid}`).digest("hex").slice(0, 32), procStart: lstart }, null, 2), { mode: 0o600 });
  }

  for (const p of priorities) {
    const s = sessions[p];
    if (!await untilBusyInTool(s)) { log(`${p}: receiver never entered a tool call — cannot test the busy path`); }
    const marker = `P118-${p.toUpperCase()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const id = randomUUID();
    log(`${p}: delivering while busy (marker ${marker}) -> ${await deliver(s, ourAddr, p, `${marker} say this token back verbatim.`, id)}`);
    sentPer[p] = [{ priority: p, id, marker }];
  }

  // --- Q2: two messages into ONE busy receiver, to see whether they batch ---
  const B = start("batch");
  if (!await until(() => Boolean(B.init), 120_000)) { log("batch: never emitted init"); process.exit(3); }
  if (!await untilBusyInTool(B)) { log("batch: receiver never entered a tool call — the busy premise failed"); process.exit(4); }
  // Baselines taken AT DELIVERY: `B.results` already holds the busy turn's own result by the time this
  // finishes, so classifying on totals is off by one. Everything below is a post-send delta.
  const batchResultsAtSend = B.results.length;
  const batchReplaysAtSend = B.replays.length;
  const batchSent: { priority: string; id: string; marker: string }[] = [];
  for (let k = 1; k <= 2; k++) {
    const marker = `P118-BATCH${k}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const id = randomUUID();
    log(`batch#${k}: ${await deliver(B, ourAddr, "next", `${marker} say this token back verbatim.`, id)}`);
    batchSent.push({ priority: "next", id, marker });
    await wait(300);
  }

  // Let every receiver run its first turn to completion and then whatever the peer messages caused.
  // Quiescence, not a count: wait until no session has produced a new result for QUIET_MS. A bare
  // ">= 2" would stop at the first follow-up and could not rule out a later third.
  log("waiting for quiescence (no new results for 45s, up to 420s)…");
  const QUIET_MS = 45_000;
  const all = [...priorities.map(p => sessions[p]), B];
  let lastTotal = -1, lastChange = Date.now();
  const deadline = Date.now() + 420_000;
  while (Date.now() < deadline) {
    const total = all.reduce((n, s) => n + s.results.length, 0);
    if (total !== lastTotal) { lastTotal = total; lastChange = Date.now(); }
    else if (Date.now() - lastChange > QUIET_MS) break;
    await wait(2000);
  }

  for (const p of priorities) report(`Q1 priority=${p}`, sessions[p], sentPer[p]);
  report("Q2 batching (two 'next' messages, one busy turn)", B, batchSent);

  console.log("\n=== VERDICT (probe 118) ===");
  for (const p of priorities) {
    const s = sessions[p];
    const secondTurn = s.results.length >= 2;
    const insideFirst = s.text.some(t => /INJECTED:\s*(?!none)/i.test(t));
    console.log(`[Q1 ${p}] results=${s.results.length} replays=${s.replays.length} -> ${secondTurn ? "SEPARATE TURN (a second result arrived)" : "NO second result"}${insideFirst ? " | the running turn REPORTED seeing an injected instruction" : ""}`);
  }
  const dReplays = B.replays.length - batchReplaysAtSend;
  const dResults = B.results.length - batchResultsAtSend;
  console.log(`[Q2 batching] two 'next' messages -> AFTER DELIVERY: replays +${dReplays}, results +${dResults}`
    + ` -> ${dReplays === 2 && dResults === 1 ? "BATCHED (both replayed, one turn)"
      : dReplays === 2 && dResults >= 2 ? "NOT batched (a turn each)"
      : "inconclusive — read the transcript above"}`);
  const allResults = [...priorities.map(p => sessions[p]), B].flatMap(s => s.results);
  const peerResults = allResults.filter(r => r?.origin?.kind === "peer");
  console.log(`[Q3 correlation] result frames carrying origin.kind='peer': ${peerResults.length} of ${allResults.length}`);
  for (const r of peerResults.slice(0, 3)) console.log(`      uuid=${r.user_message_uuid ?? "(none)"} origin=${JSON.stringify(r.origin)}`);
  console.log(`      result frames carrying user_message_uuid at all: ${allResults.filter(r => r.user_message_uuid).length} of ${allResults.length}`);

  try { if (keyPath) unlinkSync(keyPath); } catch { /* gone */ }
  process.exit(0);
})();
