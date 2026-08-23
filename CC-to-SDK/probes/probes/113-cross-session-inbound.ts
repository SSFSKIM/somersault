// Probe 113 — Is a headless SDK session ADDRESSABLE by another process? (the receive side)
//
// Probe 110 (SDK 0.3.234) concluded the cross-session fabric was asymmetric FOR US: a bare headless
// SDK session can enumerate the machine's Claude Code fleet (ListAgents) and can call SendMessage,
// but is itself absent from every peer's roster and never received a marker. It recorded that as
// "SDK sessions can look, cannot be spoken to" and scored the receive side 🚫 in
// docs/parity/full-potential.md:149. But 110 never configured anything host-side: no
// crossSessionInbound setting, no registry row, no messaging socket, no CLAUDE_CODE_* env. Its
// conclusion is therefore scoped to a BARE session, not to "the SDK cannot receive".
//
// 0.3.237 puts that scope in doubt. sdk.d.ts now declares:
//   - settings key `crossSessionInbound?: 'accept'|'hold'|'refuse'` (sdk.d.ts:7601)
//   - `SDKMessageOrigin` variant `{kind:'peer', from, fromMode, name, fromSession, verifiedPeerPid,
//     body}` (sdk.d.ts:4322-4372), where verifiedPeerPid is documented as the kernel-verified pid of
//     "the process that connected to THIS SESSION'S cross-session messaging socket" (sdk.d.ts:4352).
//   - `origin?: SDKMessageOrigin` on SDKUserMessage — the type a client WRITES to the CLI
//     (sdk.d.ts:4952).
// A per-session messaging socket only makes sense if the session hosts one. So: does it?
//
// Independent grounding (this machine, CLI 2.1.238) says the mechanism is real and is implemented
// by the CLI itself, not by the embedding host:
//   - ~/.claude/sessions/<pid>.json rows carry `messagingSocketPath: /tmp/cc-socks/<pid>.sock`,
//     `peerProtocol: 1`, `peerFeatures`, `status`. One live row has entrypoint "sdk-cli".
//   - the CLI binary contains a `[uds-messaging]` NDJSON-over-UDS server (startUdsMessaging), an
//     auth frame `{"type":"auth","token":"<32 hex>"}` whose token is published to
//     ~/.claude/sessions/<pid>.<sha256>.key, a receiver-side session_id check, and a
//     `{"type":"user", message:{content}, from, priority}` frame that is enqueued as a real turn.
//   - it is behind a server-side gate ("cross-session messaging gate off" / agents_cross_session_inbox).
//
// This probe answers, live and in order:
//   Q1  Does a plain headless SDK session bind a cross-session inbox at all? (registry row +
//       socket on disk + `messaging_socket_path` on the init frame)
//   Q2  If it does, can a SEPARATE process connect to that socket and deliver a message?
//   Q3  Does the delivered message become a real turn, and is it stamped origin.kind === 'peer'
//       with a verifiedPeerPid equal to this probe's own pid?
//   Q4  Does the receive-side `crossSessionInbound` setting apply (we set 'accept' explicitly, which
//       the doc says "always wins" over the unset mode-parity rule)?
// A negative on Q1 is a first-class result: it means the inbox is gated off for us and the receive
// side stays host work. Nothing here infers a pass from a declaration.
//
// Keying: an already-set CLAUDE_CODE_OAUTH_TOKEN wins, else $CCX_ENV_FILE, else the MAIN checkout's
// CC-to-SDK/.env (a worktree has no .env of its own). ANTHROPIC_API_KEY is deleted unconditionally —
// it shadows the OAuth token and bills metered credits. No credential value is ever printed.
//
// Run from CC-to-SDK/probes:
//   unset ANTHROPIC_API_KEY; npx tsx probes/113-cross-session-inbound.ts
import { createConnection } from "node:net";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
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

const log = (...a: unknown[]) => console.log("[p113]", ...a);
const SESSIONS_DIR = join(homedir(), ".claude", "sessions");
const MARKER = `P113-INBOUND-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;

setTimeout(() => { log("!!! GLOBAL WATCHDOG (300s) — exiting"); process.exit(2); }, 300_000).unref?.();

type Row = { file: string; pid: number; sessionId?: string; messagingSocketPath?: string; entrypoint?: string; kind?: string; peerProtocol?: number; peerFeatures?: string[] };

function readRoster(): Row[] {
  let files: string[] = [];
  try { files = readdirSync(SESSIONS_DIR); } catch { return []; }
  const out: Row[] = [];
  for (const f of files) {
    if (!/^\d+\.json$/.test(f)) continue;
    try {
      const j = JSON.parse(readFileSync(join(SESSIONS_DIR, f), "utf8"));
      out.push({ file: f, pid: j.pid, sessionId: j.sessionId, messagingSocketPath: j.messagingSocketPath, entrypoint: j.entrypoint, kind: j.kind, peerProtocol: j.peerProtocol, peerFeatures: j.peerFeatures });
    } catch { /* torn write */ }
  }
  return out;
}

// The inbox auth token is published as ~/.claude/sessions/<pid>.<sha256>.key containing
// {"peerToken":"<32 hex>"}. Read it, never print it.
function readPeerToken(pid: number): string | undefined {
  try {
    for (const f of readdirSync(SESSIONS_DIR)) {
      const m = /^(\d+)\.[0-9a-f]{64}\.key$/.exec(f);
      if (!m || Number(m[1]) !== pid) continue;
      const j = JSON.parse(readFileSync(join(SESSIONS_DIR, f), "utf8"));
      if (typeof j.peerToken === "string") return j.peerToken;
    }
  } catch { /* absent */ }
  return undefined;
}

function sendFrames(sock: string, frames: unknown[]): Promise<string> {
  return new Promise(res => {
    const c = createConnection(sock);
    let done = false;
    const finish = (v: string) => { if (!done) { done = true; res(v); } try { c.destroy(); } catch { /* closed */ } };
    c.on("connect", () => { for (const f of frames) c.write(JSON.stringify(f) + "\n"); c.end(); });
    c.on("error", e => finish("ERROR:" + (e as NodeJS.ErrnoException).code));
    c.on("close", () => finish("CLOSED"));
    setTimeout(() => finish("TIMEOUT"), 10_000).unref?.();
  });
}

// A project settings file is the only way to hand the CLI `crossSessionInbound` — it is a settings
// key, not a query() option. settingSources:["project"] makes the spawned CLI read it.
const cwd = mkdtempSync(join(tmpdir(), "probe113-"));
mkdirSync(join(cwd, ".claude"), { recursive: true });
writeFileSync(join(cwd, ".claude", "settings.json"), JSON.stringify({ crossSessionInbound: "accept" }, null, 2));
log("cwd:", cwd, "(project settings: crossSessionInbound=accept)");

const before = new Set(readRoster().map(r => r.file));
log("roster rows before:", before.size);

// Streaming input keeps the session alive and idle after turn 1, which is the state an inbound peer
// message has to wake. The generator never yields again on its own.
const held = new Promise<void>(() => { /* never resolves */ });
async function* input() {
  yield { type: "user" as const, message: { role: "user" as const, content: `Reply with exactly: READY. Do not use any tools.` }, parent_tool_use_id: null, session_id: "x" };
  await held;
}

const udsLines: string[] = [];
const q = query({
  prompt: input(),
  options: {
    model: "claude-sonnet-4-5",
    cwd,
    settingSources: ["project"],
    permissionMode: "bypassPermissions",
    stderr: (d: string) => { for (const l of d.split("\n")) if (l.includes("uds-messaging") || l.includes("cross_session") || l.includes("cross-session")) udsLines.push(l.trim()); },
    extraArgs: { debug: null },
  } as any,
});

let initFrame: any;
let sessionId = "";
let markerSeen = false;
let peerOrigin: any;
let turnsAfterSend = 0;
let sent = false;

(async () => {
  for await (const msg of q as any) {
    if (msg.type === "system" && msg.subtype === "init") {
      initFrame = msg;
      sessionId = msg.session_id;
      log("init: session_id =", sessionId);
      log("init frame keys:", Object.keys(msg).sort().join(", "));
      log("init.messaging_socket_path =", JSON.stringify((msg as any).messaging_socket_path));
      log("init.capabilities =", JSON.stringify((msg as any).capabilities));
    }
    if (msg.type === "user" && sent) {
      const txt = typeof msg.message?.content === "string" ? msg.message.content : JSON.stringify(msg.message?.content);
      if (txt?.includes(MARKER)) { markerSeen = true; log("MARKER arrived on a user frame"); }
      if (msg.origin) { log("user frame origin:", JSON.stringify(msg.origin)); if (msg.origin.kind === "peer") peerOrigin = msg.origin; }
    }
    if (msg.type === "assistant" && sent) {
      const txt = (msg.message?.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
      if (txt.includes(MARKER)) { markerSeen = true; log("MARKER echoed by the model:", txt.slice(0, 120)); }
    }
    if (msg.type === "result") {
      if (!sent) { void phase2(); } else { turnsAfterSend++; log("post-send turn completed:", msg.subtype); }
    }
  }
})().catch(e => log("stream error:", (e as Error).message));

async function phase2() {
  sent = true;
  log("--- Q1: did this session bind a cross-session inbox? ---");
  // Give registration + bind a moment; the row is written at startup but status updates are async.
  await new Promise(r => setTimeout(r, 3000));

  const after = readRoster();
  const fresh = after.filter(r => !before.has(r.file));
  log("new roster rows:", fresh.length, fresh.map(r => `${r.pid}(${r.entrypoint}/${r.kind})`).join(" ") || "(none)");
  let mine = after.find(r => r.sessionId === sessionId);
  if (!mine && fresh.length === 1) { mine = fresh[0]; log("no sessionId match; using the single fresh row"); }

  if (!mine) {
    log("Q1 = NO: this SDK session wrote no roster row at all.");
    log("[stderr uds lines]", udsLines.length ? udsLines.slice(0, 8).join(" | ") : "(none captured)");
    return verdict(false, undefined, "no roster row");
  }
  log("our row:", JSON.stringify(mine));
  const sock = mine.messagingSocketPath;
  const bound = Boolean(sock) && existsSync(sock!);
  log("messagingSocketPath =", sock ?? "(absent)", "| exists on disk:", bound);
  if (bound) { try { log("socket mode:", (statSync(sock!).mode & 0o777).toString(8)); } catch { /* raced */ } }
  log("[stderr uds lines]", udsLines.length ? udsLines.slice(0, 8).join(" | ") : "(none captured)");

  if (!bound) { log("Q1 = NO: roster row exists but no messaging socket is bound."); return verdict(false, mine, "row without socket"); }
  log("Q1 = YES: the SDK-spawned CLI is hosting a cross-session inbox.");

  log("--- Q2/Q3: can a separate process deliver into it? ---");
  const token = readPeerToken(mine.pid);
  log("auth key file present for pid", mine.pid, ":", token !== undefined, "(value never printed)");
  const frames: unknown[] = [];
  if (token) frames.push({ type: "auth", token });
  frames.push({
    type: "user",
    session_id: sessionId,          // receiver drops the frame on mismatch
    from: `uds:${sock}`,            // sender-authored, reply routing only
    message: { content: `${MARKER} — reply with exactly this token and nothing else.` },
    priority: "next",
    msg_id: `p113-${Date.now()}`,
  });
  const outcome = await sendFrames(sock!, frames);
  log("socket write outcome:", outcome, "| our pid (expect as verifiedPeerPid):", process.pid);

  await new Promise(r => setTimeout(r, 60_000));
  log("[stderr uds lines after send]", udsLines.length ? udsLines.slice(-10).join(" | ") : "(none captured)");
  verdict(true, mine, outcome);
}

function verdict(bound: boolean, row: Row | undefined, note: string) {
  console.log("\n=== VERDICT (probe 113) ===");
  console.log(`[Q1] SDK session hosts a cross-session inbox: ${bound ? "✅ YES" : "❌ NO"} (${note})`);
  console.log(`     roster row: ${row ? `pid=${row.pid} entrypoint=${row.entrypoint} peerProtocol=${row.peerProtocol} features=${JSON.stringify(row.peerFeatures)}` : "(none)"}`);
  console.log(`[Q2] a separate process delivered a frame into it: ${bound ? (markerSeen ? "✅ YES" : "❌ NO — marker never surfaced") : "n/a"}`);
  console.log(`[Q3] delivery became a turn stamped origin.kind='peer': ${peerOrigin ? "✅ YES" : "❌ NO"}`);
  console.log(`     origin: ${peerOrigin ? JSON.stringify(peerOrigin) : "(none observed)"}`);
  console.log(`     verifiedPeerPid matches this probe (${process.pid}): ${peerOrigin?.verifiedPeerPid === process.pid ? "✅" : "❌ " + String(peerOrigin?.verifiedPeerPid)}`);
  console.log(`[Q4] crossSessionInbound='accept' honored: ${markerSeen ? "✅ delivered without a hold" : "⚠️ not demonstrated"}`);
  console.log(`     turns after send: ${turnsAfterSend}`);
  console.log(`\n${markerSeen && peerOrigin ? "ADDRESSABLE — the 'not addressable back' premise is FALSE on 0.3.237." : bound ? "PARTIAL — inbox is bound but delivery was not observed." : "NOT ADDRESSABLE in this configuration."}`);
  process.exit(0);
}
