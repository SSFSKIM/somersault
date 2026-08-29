// Probe 117b — Can a sender learn anything about a message it sent, and what does vouching cost?
//
// 117 answered three of its four questions and left one wrong-shaped. It measured receipts against a
// REFUSE receiver (chosen because a refusal costs no model turn) and got zero — but the receiver's own
// debug log shows the receipt was never ATTEMPTED, on either the refuse or the delivered path: no
// `[uds-client] Sending control:peer_message_status`, no `hold-receipt skipped`, nothing. The one run
// that ever logged an attempt was 113b's, whose disposition was HELD. So the real question is narrower
// and it is the one `peer/send`'s result semantics hang on:
//
//   Q1  Does a HELD message produce a `control:peer_message_status` receipt that a correctly-shaped
//       listener actually receives? (117 proved the listener side was wrong in 113c — unvouched and
//       never closing. Here it is in-namespace, vouched, and closes on read.)
//   Q2  Does the hold then EXPIRE into a second receipt? `dialogExpiry` defaults to 5 minutes;
//       CLAUDE_CODE_USER_DIALOG_TIMEOUT_MS shortens it, so the whole lifecycle fits in one short run.
//   Q4  Does a UUID-shaped `msg_id` come back as `orig_msg_id` on the receipt? The first run of this
//       probe sent `p117b-<timestamp>` and the receipt echoed nothing, which would leave a sender unable
//       to tell WHICH of its messages a status belongs to. The CLI appears to gate that echo on the id
//       being UUID-shaped, so this run sends a real UUID and the two runs together answer it.
//   Q3  Is a KEY FILE ALONE sufficient vouching? The sender's lookup reads the key by socket path and
//       only falls back to scanning registry rows when there is none — so a gateway should not have to
//       publish a `~/.claude/sessions/<pid>.json` row at all, and therefore should not have to appear
//       in anyone's session list to receive replies. 117 published BOTH; this publishes only the key.
//
// A hold is the cheapest disposition to provoke: the message is parked and never runs, so nothing here
// spends a model turn. Mode parity does the work — a `prompting`-class sender into a bypassPermissions
// receiver is held by the documented default, with no setting involved.
//
// Run from CC-to-SDK/probes:
//   unset ANTHROPIC_API_KEY; npx tsx probes/117b-peer-receipts-and-vouching.ts
import { createConnection, createServer } from "node:net";
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

const log = (...a: unknown[]) => console.log("[p117b]", ...a);
const SESSIONS_DIR = join(homedir(), ".claude", "sessions");
const DEBUG_DIR = join(homedir(), ".claude", "debug");
const MARKER = `P117B-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
const HOLD_EXPIRY_MS = 25_000;
setTimeout(() => { log("!!! GLOBAL WATCHDOG (300s)"); process.exit(2); }, 300_000).unref?.();

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
async function until(pred: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (pred()) return true; await wait(500); }
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
function udsLog(sessionId: string): string[] {
  try {
    return readFileSync(join(DEBUG_DIR, `${sessionId}.txt`), "utf8").split("\n")
      .filter(l => /uds-messaging|cross-session-inbound|uds-client/.test(l))
      .map(l => l.replace(/"token":"[^"]*"/g, '"token":"[REDACTED]"'));
  } catch { return []; }
}

const receipts: { at: number; line: string }[] = [];
const t0 = Date.now();

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

(async () => {
  // A bypassPermissions receiver with NO explicit crossSessionInbound: mode parity governs, and a
  // sender that declares `prompting` is the documented held case.
  const heldForever = new Promise<void>(() => { /* stays alive and idle */ });
  async function* input() {
    yield { type: "user" as const, message: { role: "user" as const, content: "Say OK." }, parent_tool_use_id: null, session_id: "x" };
    await heldForever;
  }
  let init: any;
  const q: any = query({
    prompt: input(),
    options: {
      model: "claude-sonnet-4-5",
      cwd: process.cwd(),
      settingSources: [],
      permissionMode: "bypassPermissions",
      env: { ...process.env, CLAUDE_CODE_USER_DIALOG_TIMEOUT_MS: String(HOLD_EXPIRY_MS) },
      extraArgs: { debug: null },
    } as any,
  });
  (async () => { for await (const m of q) { if (m.type === "system" && m.subtype === "init") init = m; } })()
    .catch(e => log("stream ended:", (e as Error).message.slice(0, 160)));
  if (!await until(() => Boolean(init), 120_000)) { log("receiver never emitted init"); process.exit(3); }

  const sock = init.messaging_socket_path as string | undefined;
  const row = rowForSession(init.session_id);
  log(`receiver session=${init.session_id} sock=${JSON.stringify(sock)} pid=${row?.pid}`);
  if (!sock || !existsSync(sock)) { log("no inbox bound"); process.exit(3); }

  // Our listener: in the receiver's own namespace, closing on read.
  const nsDir = dirname(sock);
  const ourSock = join(nsDir, `${process.pid}.sock`);
  try { unlinkSync(ourSock); } catch { /* fresh */ }
  const srv = createServer(c => {
    c.setEncoding("utf8");
    let buf = "";
    c.on("data", d => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line) continue;
        receipts.push({ at: Date.now() - t0, line: line.replace(/"token":"[^"]*"/g, '"token":"[REDACTED]"') });
        log(`RECEIPT (+${Math.round((Date.now() - t0) / 1000)}s):`, receipts[receipts.length - 1].line.slice(0, 320));
      }
      c.end();
    });
    c.on("error", () => { /* peer hung up */ });
  });
  await new Promise<void>(r => srv.listen(ourSock, () => r()));
  srv.unref();
  const ourAddr = `uds:${ourSock}`;

  // Q3 — publish the KEY FILE ONLY. No `<pid>.json` registry row: a gateway that never claims to be a
  // session should still be a valid reply address.
  const lstart = (() => { try { return execFileSync("ps", ["-o", "lstart=", "-p", String(process.pid)], { encoding: "utf8", env: { ...process.env, LC_ALL: "C", TZ: "UTC" } }).trim(); } catch { return undefined; } })();
  const keyPath = join(SESSIONS_DIR, `${process.pid}.${createHash("sha256").update(ourSock).digest("hex")}.key`);
  writeFileSync(keyPath, JSON.stringify({ peerToken: createHash("sha256").update(`p117b-${process.pid}-${Date.now()}`).digest("hex").slice(0, 32), procStart: lstart }, null, 2), { mode: 0o600 });
  const rowPath = join(SESSIONS_DIR, `${process.pid}.json`);
  log(`published KEY ONLY: ${keyPath} (registry row ${existsSync(rowPath) ? "EXISTS — not ours" : "absent, deliberately"})`);
  log(`our peer address: ${ourAddr}`);

  // A prompting-class sender into a bypassPermissions receiver: mode parity holds it.
  const token = peerTokenFor(row?.pid);
  const msgId = randomUUID();
  const frames: unknown[] = [];
  if (token) frames.push({ type: "auth", token });
  frames.push({
    type: "user",
    session_id: init.session_id,
    from: ourAddr,
    message: { content: envelope(ourAddr, "probe-117b", "prompting", `${MARKER} held-path probe`) },
    priority: "next",
    msg_id: msgId,
  });
  log(`socket outcome: ${await sendFrames(sock, frames)}`);

  await until(() => udsLog(init.session_id).some(l => /held inbound|Routed user message|refus/i.test(l)), 30_000);
  const disp = udsLog(init.session_id).filter(l => /held inbound|Routed user message|refus|peer_message_status|hold-receipt/i.test(l));
  for (const l of disp.slice(-4)) console.log("      ", l.trim());
  const joined = disp.join(" ");
  const disposition = /held inbound/i.test(joined) ? "HELD" : /Routed user message/i.test(joined) ? "DELIVERED" : /refus/i.test(joined) ? "REFUSED" : "none logged";

  const heldReceipts = await until(() => receipts.length > 0, 20_000) ? receipts.length : 0;
  // Q2 — let the hold deadline pass and watch for a second, terminal receipt.
  log(`waiting out the hold deadline (${HOLD_EXPIRY_MS}ms) for an expiry receipt…`);
  await wait(HOLD_EXPIRY_MS + 15_000);

  const tail = udsLog(init.session_id).filter(l => /peer_message_status|hold-receipt|expired|held/i.test(l));
  console.log("\n=== VERDICT (probe 117b) ===");
  console.log(`disposition: ${disposition} (mode parity: prompting sender -> bypassPermissions receiver)`);
  console.log(`[Q1] receipts received on a vouched, closing listener: ${receipts.length} ${receipts.length > 0 ? "✅" : "❌"}`);
  for (const r of receipts) console.log(`       +${Math.round(r.at / 1000)}s  ${r.line.slice(0, 320)}`);
  console.log(`[Q2] a second (expiry) receipt after the ${HOLD_EXPIRY_MS}ms deadline: ${receipts.length > 1 ? "✅ yes" : "not observed"}`);
  console.log(`[Q4] receipt echoes our UUID msg_id (${msgId}): ${receipts.some(r => r.line.includes(msgId)) ? "✅ correlatable" : "❌ not echoed — a status cannot be tied to the message that earned it"}`);
  console.log(`[Q3] key file ALONE vouched the reply address (no registry row published): ${heldReceipts > 0 ? "✅ sufficient" : "not proven by this run"}`);
  console.log(`receiver-side receipt lines:`);
  for (const l of tail.slice(-6)) console.log("       ", l.trim());

  try { unlinkSync(ourSock); } catch { /* gone */ }
  try { unlinkSync(keyPath); } catch { /* gone */ }
  process.exit(0);
})();
