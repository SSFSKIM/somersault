// Probe 113c — The decisive run: deliver into a headless SDK session's inbox, on 0.3.237.
//
// What 113 and 113b already established LIVE (see those files for the runs):
//   - a plain headless SDK session binds a cross-session inbox: roster row
//     ~/.claude/sessions/<pid>.json {entrypoint:"sdk-cli", peerProtocol:1, messagingSocketPath},
//     the socket on disk at 0600, an auth key file, and `messaging_socket_path` on the init frame
//     (a field sdk.d.ts does not declare — on the wire, not in the public types).
//   - a raw frame written by a SEPARATE process was accepted, authenticated and PROCESSED. It was
//     not rejected; it was HELD. From that session's own debug log:
//       [cross-session-inbound] held inbound peer message (1 held, cause=no-mode-asserted):
//         from=uds:/tmp/cc-socks/66153.sock "(withheld)"
//       [uds-client] Sending control:peer_message_status to /tmp/cc-socks/66153.sock
//     So the ingress works and the hold is a POLICY decision, not an absence of a receive path.
//
// `cause=no-mode-asserted` is the bug in 113b's frame, and it names the real contract. The sender's
// permission class is not a top-level frame field — it rides inside the message body, in the
// harness-formed envelope the CLI builds and re-parses byte-exactly (tag `cross-session-message`,
// strict attribute order from / from-session / hop-chain / from-name / from-mode). sdk.d.ts:4330
// describes the receiving end of exactly this: origin.fromMode is "the SENDING session's permission
// class as declared by the host", and "a sender that asserts no class is held only while this
// session bypasses permission prompts" (sdk.d.ts:7599). 113b's receiver was bypassPermissions and
// asserted nothing, so a hold is the documented, correct outcome.
//
// This probe therefore asks the two questions that separate "held by policy" from "not addressable":
//   Q1  With a well-formed envelope asserting from-mode="bypass" into a bypassPermissions receiver
//       (mode parity satisfied), is the message DELIVERED — routed to the turn queue?
//   Q2  Is the receive-side `crossSessionInbound` setting honored? A second receiver runs with
//       crossSessionInbound:"refuse"; the same frame should be refused rather than delivered.
// Both are read off each session's own debug log at ~/.claude/debug/<session-id>.txt, which is where
// the CLI states the disposition in its own words. That makes the result independent of model
// quota: routing to the turn queue is observable even if the account cannot afford the turn.
//
// We also bind a real listener at our own in-namespace socket path and READ it, because 113b showed
// the receiver sends `control:peer_message_status` receipts back to the sender's address. Those
// receipts are the delivery-status channel a host would consume.
//
// Run from CC-to-SDK/probes:
//   unset ANTHROPIC_API_KEY; npx tsx probes/113c-cross-session-inbound-envelope.ts
import { createConnection, createServer } from "node:net";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
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

const log = (...a: unknown[]) => console.log("[p113c]", ...a);
const SESSIONS_DIR = join(homedir(), ".claude", "sessions");
const DEBUG_DIR = join(homedir(), ".claude", "debug");
const MARKER = `P113C-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
setTimeout(() => { log("!!! GLOBAL WATCHDOG (280s)"); process.exit(2); }, 280_000).unref?.();

// The harness-formed envelope. Attribute order is fixed and the receiver re-serializes and compares
// byte-exactly, so anything out of order is silently treated as un-enveloped text.
function envelope(from: string, name: string, mode: "bypass" | "prompting", body: string): string {
  return `<cross-session-message from="${from}" from-name="${name}" from-mode="${mode}">\n${body}\n</cross-session-message>`;
}

function readPeerToken(pid: number): string | undefined {
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
function udsLog(sessionId: string): string[] {
  try {
    return readFileSync(join(DEBUG_DIR, `${sessionId}.txt`), "utf8").split("\n")
      .filter(l => /uds-messaging|cross-session-inbound|uds-client/.test(l))
      .map(l => l.replace(/"token":"[^"]*"/g, '"token":"[REDACTED]"'));
  } catch { return []; }
}

type Sess = { q: any; init?: any; sessionId: string; sawMarker: boolean; peerOrigin?: any; text: string[] };
function start(tag: string, settings: Record<string, unknown>): Sess {
  const s: Sess = { q: null, sessionId: "", sawMarker: false, text: [] };
  const c = mkdtempSync(join(tmpdir(), `p113c-${tag}-`));
  mkdirSync(join(c, ".claude"), { recursive: true });
  writeFileSync(join(c, ".claude", "settings.json"), JSON.stringify(settings, null, 2));
  const held = new Promise<void>(() => { /* session stays alive and idle */ });
  async function* input() {
    yield { type: "user" as const, message: { role: "user" as const, content: "Say OK." }, parent_tool_use_id: null, session_id: "x" };
    await held;
  }
  s.q = query({
    prompt: input(),
    options: { model: "claude-sonnet-4-5", cwd: c, settingSources: ["project"], permissionMode: "bypassPermissions", extraArgs: { debug: null } } as any,
  });
  (async () => {
    for await (const m of s.q as any) {
      if (m.type === "system" && m.subtype === "init") { s.init = m; s.sessionId = m.session_id; }
      if (m.type === "user") {
        const t = typeof m.message?.content === "string" ? m.message.content : JSON.stringify(m.message?.content ?? "");
        if (t.includes(MARKER)) s.sawMarker = true;
        if (m.origin) { log(`[${tag}] user-frame origin:`, JSON.stringify(m.origin)); if (m.origin.kind === "peer") s.peerOrigin = m.origin; }
      }
      if (m.type === "assistant") for (const b of m.message?.content ?? []) {
        if (b.type === "text" && b.text.trim()) { s.text.push(b.text.trim()); if (b.text.includes(MARKER)) s.sawMarker = true; }
      }
    }
  })().catch(e => log(`[${tag}] stream ended:`, (e as Error).message.slice(0, 160)));
  return s;
}

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
async function until(pred: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (pred()) return true; await wait(500); }
  return pred();
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

const receipts: string[] = [];

async function deliver(tag: string, B: Sess, ourAddr: string): Promise<{ sock?: string; disposition: string }> {
  const row = rowForSession(B.sessionId);
  const sock = (B.init as any)?.messaging_socket_path as string | undefined;
  log(`[${tag}] session=${B.sessionId} sock=${JSON.stringify(sock)} row=${row ? `pid=${row.pid} entrypoint=${row.entrypoint} v=${row.version} proto=${row.peerProtocol}` : "(none)"}`);
  if (!sock || !existsSync(sock)) return { disposition: "no inbox bound" };

  const token = readPeerToken(row?.pid);
  const frames: unknown[] = [];
  if (token) frames.push({ type: "auth", token });
  frames.push({
    type: "user",
    session_id: B.sessionId,
    from: ourAddr,
    message: { content: envelope(ourAddr, "probe-113c", "bypass", `${MARKER} reply with exactly this token and nothing else.`) },
    priority: "next",
    msg_id: `p113c-${tag}-${Date.now()}`,
  });
  log(`[${tag}] auth key present: ${token !== undefined} (never printed); writing enveloped frame`);
  log(`[${tag}] socket outcome: ${await sendFrames(sock, frames)}`);

  // The disposition is written to the receiver's own debug log within a beat; a delivered message
  // additionally tries to take a turn, which may fail on quota without changing the routing fact.
  await until(() => udsLog(B.sessionId).some(l => /held inbound|Routed user message|refus|denied|dropped/i.test(l)), 45_000);
  const lines = udsLog(B.sessionId);
  const verdictLine = lines.filter(l => /held inbound|Routed user message|refus|denied|dropped/i.test(l)).slice(-3);
  log(`[${tag}] disposition lines:`);
  for (const l of verdictLine) console.log("      ", l.trim());
  const joined = verdictLine.join(" ");
  const disposition = /Routed user message/i.test(joined) ? "DELIVERED"
    : /refus/i.test(joined) ? "REFUSED"
    : /held inbound/i.test(joined) ? "HELD"
    : "no disposition logged";
  return { sock, disposition };
}

(async () => {
  // Our own live, in-namespace peer address, so `from` resolves and receipts can come back.
  const nsDir = "/tmp/cc-socks";
  mkdirSync(nsDir, { recursive: true, mode: 0o700 });
  const ourSock = join(nsDir, `${process.pid}.sock`);
  try { unlinkSync(ourSock); } catch { /* fresh */ }
  const srv = createServer(c => {
    c.setEncoding("utf8");
    c.on("data", d => { for (const l of d.split("\n")) if (l.trim()) { receipts.push(l.trim()); log("RECEIPT from receiver:", l.trim().slice(0, 240)); } });
    c.on("error", () => { /* peer hung up */ });
  });
  await new Promise<void>(r => srv.listen(ourSock, () => r()));
  srv.unref();
  const ourAddr = `uds:${ourSock}`;
  log("our peer address:", ourAddr);

  // Q1 — mode parity satisfied, no explicit setting.
  const B1 = start("accept", {});
  if (!await until(() => Boolean(B1.init), 90_000)) { log("B1 never emitted init"); process.exit(3); }
  const r1 = await deliver("Q1-parity", B1, ourAddr);

  // Q2 — same frame, receiver opts out via the 0.3.237 setting.
  const B2 = start("refuse", { crossSessionInbound: "refuse" });
  if (!await until(() => Boolean(B2.init), 90_000)) { log("B2 never emitted init"); process.exit(3); }
  const r2 = await deliver("Q2-refuse", B2, ourAddr);

  await wait(8000);

  console.log("\n=== VERDICT (probe 113c) ===");
  console.log(`SDK wrapper 0.3.237 / bundled CLI 2.1.237. Receiver inbox: ${r1.sock ?? "(none)"}`);
  console.log(`[Q1] enveloped frame, from-mode=bypass into a bypassPermissions receiver: ${r1.disposition === "DELIVERED" ? "✅ DELIVERED (routed to the turn queue)" : "❌ " + r1.disposition}`);
  console.log(`[Q2] same frame into crossSessionInbound:"refuse": ${r2.disposition === "REFUSED" ? "✅ REFUSED (setting honored)" : r2.disposition === "DELIVERED" ? "❌ DELIVERED (setting NOT honored)" : "⚠️ " + r2.disposition}`);
  console.log(`[Q3] origin.kind='peer' observed on the SDK stream: ${B1.peerOrigin ? "✅ " + JSON.stringify(B1.peerOrigin) : "not observed (needs the turn to actually run)"}`);
  console.log(`[Q4] delivery-status receipts sent back to our socket: ${receipts.length} — ${receipts.slice(0, 2).join(" | ").slice(0, 300) || "(none)"}`);
  console.log(`[Q5] marker reached the model: ${B1.sawMarker ? "✅ yes" : "not observed"} | B1 text: ${B1.text.join(" / ").slice(0, 200) || "(none)"}`);
  console.log(`\n${r1.disposition === "DELIVERED"
    ? "ADDRESSABLE — a separate process delivered a message into a headless SDK session's turn queue. The 'not addressable back' premise is FALSE on 0.3.237."
    : "Ingress reached, disposition " + r1.disposition + " — see the disposition lines above."}`);
  process.exit(0);
})();
