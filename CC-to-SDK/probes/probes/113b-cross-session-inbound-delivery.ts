// Probe 113b — Delivery half of probe 113: can a message actually LAND in an SDK session's inbox?
//
// 113 settled Q1 live: a plain headless SDK session DOES bind a cross-session inbox. Observed —
// roster row ~/.claude/sessions/62500.json {entrypoint:"sdk-cli", peerProtocol:1,
// messagingSocketPath:"/tmp/cc-socks/62500.sock"}, the socket present on disk at mode 0600, an auth
// key file published for the pid, and `messaging_socket_path` on the init frame (a field sdk.d.ts
// does not declare — it is on the wire but not in the public types).
//
// 113's delivery attempt produced nothing, with no diagnostics, and it had two known defects:
//   (a) stderr was filtered before it was buffered, so a dropped-frame reason could not be seen;
//   (b) `from` was set to the RECEIVER's own socket, which is a self-target — the CLI validates the
//       reply address against its own socket namespace and treats a self address specially.
// This probe fixes both and adds the native path as a second, independent route:
//   Route 1 (raw): bind a real listener of our own so `from` is a live, distinct, in-namespace peer
//                  address, then write auth + user frames onto B's socket ourselves.
//   Route 2 (native): spawn a second SDK session A and ask the model to call SendMessage at
//                  `uds:<B's socket>` — probe 110's send never had a valid target because it used a
//                  session uuid; the address grammar is `uds:<socket path>`.
// Either route landing proves addressability. Route 2 landing additionally proves the whole native
// send→receive path works between two of OUR sessions with no hand-rolled framing.
//
// Everything B's CLI writes to stderr is buffered unfiltered and printed, because the reason a frame
// is refused ("session_id mismatch", "did not authenticate", "gate off", a hold) is the finding when
// delivery fails.
//
// Run from CC-to-SDK/probes:
//   unset ANTHROPIC_API_KEY; CCX_ENV_FILE=/Users/new/Developer/GitHub/codex_somersault/CC-to-SDK/.env \
//     npx tsx probes/113b-cross-session-inbound-delivery.ts
import { createConnection, createServer } from "node:net";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
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

const log = (...a: unknown[]) => console.log("[p113b]", ...a);
const SESSIONS_DIR = join(homedir(), ".claude", "sessions");
const MARKER = `P113B-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
setTimeout(() => { log("!!! GLOBAL WATCHDOG (280s)"); process.exit(2); }, 280_000).unref?.();

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

function mkProjectCwd(tag: string, settings: Record<string, unknown>): string {
  const c = mkdtempSync(join(tmpdir(), `p113b-${tag}-`));
  mkdirSync(join(c, ".claude"), { recursive: true });
  writeFileSync(join(c, ".claude", "settings.json"), JSON.stringify(settings, null, 2));
  return c;
}

type Sess = { q: any; init?: any; sessionId: string; stderr: string[]; sawMarker: boolean; peerOrigin?: any; text: string[] };

function start(tag: string, first: string, settings: Record<string, unknown>, onMsg?: (m: any) => void): Sess {
  const s: Sess = { q: null, sessionId: "", stderr: [], sawMarker: false, text: [] };
  const held = new Promise<void>(() => { /* keeps the session alive and idle */ });
  async function* input() {
    yield { type: "user" as const, message: { role: "user" as const, content: first }, parent_tool_use_id: null, session_id: "x" };
    await held;
  }
  s.q = query({
    prompt: input(),
    options: {
      model: "claude-sonnet-4-5",
      cwd: mkProjectCwd(tag, settings),
      settingSources: ["project"],
      permissionMode: "bypassPermissions",
      stderr: (d: string) => { for (const l of d.split("\n")) if (l.trim()) s.stderr.push(l.trim()); },
      extraArgs: { debug: null },
    } as any,
  });
  (async () => {
    for await (const m of s.q as any) {
      if (m.type === "system" && m.subtype === "init") { s.init = m; s.sessionId = m.session_id; }
      if (m.type === "user") {
        const t = typeof m.message?.content === "string" ? m.message.content : JSON.stringify(m.message?.content ?? "");
        if (t.includes(MARKER)) s.sawMarker = true;
        if (m.origin) { log(`[${tag}] user-frame origin:`, JSON.stringify(m.origin)); if (m.origin.kind === "peer") s.peerOrigin = m.origin; }
      }
      if (m.type === "assistant") {
        for (const b of m.message?.content ?? []) {
          if (b.type === "text" && b.text.trim()) { s.text.push(b.text.trim()); if (b.text.includes(MARKER)) s.sawMarker = true; }
          if (b.type === "tool_use") log(`[${tag}] tool_use:`, b.name, JSON.stringify(b.input).slice(0, 200));
        }
      }
      onMsg?.(m);
    }
  })().catch(e => log(`[${tag}] stream error:`, (e as Error).message));
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

let route1 = "not attempted";
let route2 = "not attempted";

(async () => {
  // ---- Receiver B: explicit crossSessionInbound=accept, which the doc says always wins ----
  const B = start("B", "Reply with exactly: READY-B. Do not use any tools.", { crossSessionInbound: "accept" });
  if (!await until(() => Boolean(B.init) && B.text.length > 0, 90_000)) { log("B never became ready"); process.exit(3); }
  const bSock = (B.init as any).messaging_socket_path as string | undefined;
  const bRow = rowForSession(B.sessionId);
  log("B session:", B.sessionId, "| init.messaging_socket_path:", JSON.stringify(bSock));
  log("B roster row:", bRow ? JSON.stringify(bRow) : "(none)");
  if (!bSock || !existsSync(bSock)) { log("B bound no inbox — nothing to deliver into"); process.exit(3); }

  // ---- Route 1: raw frame from a process that owns a real, distinct, in-namespace socket ----
  // The receiver vets the `from` reply address against its OWN socket namespace, so we bind a live
  // listener beside B's socket rather than asserting an address we do not hold.
  const ourSock = join(dirname(bSock), `${process.pid}.sock`);
  try { unlinkSync(ourSock); } catch { /* fresh */ }
  const srv = createServer(() => { /* accept-only: we exist so `from` resolves to a live peer */ });
  await new Promise<void>(r => srv.listen(ourSock, () => r()));
  srv.unref();
  log("bound our own peer socket:", ourSock);

  const token = readPeerToken(bRow?.pid);
  log("B auth key present:", token !== undefined, "(value never printed)");
  const frames: unknown[] = [];
  if (token) frames.push({ type: "auth", token });
  frames.push({
    type: "user",
    session_id: B.sessionId,
    from: `uds:${ourSock}`,
    from_mode: "bypass",          // sender permission class; matches B's bypassPermissions
    from_name: "probe-113b",
    message: { content: `${MARKER} — reply with exactly this token and nothing else.` },
    priority: "next",
    msg_id: `p113b-raw-${Date.now()}`,
  });
  log("route 1: writing auth + user frame to", bSock);
  log("route 1 socket outcome:", await sendFrames(bSock, frames), "| our pid:", process.pid);
  const landed1 = await until(() => B.sawMarker, 75_000);
  route1 = landed1 ? "DELIVERED" : "no marker";
  log("route 1 result:", route1);
  log("B stderr tail:", B.stderr.length ? B.stderr.slice(-25).join(" | ") : "(nothing on stderr)");

  // ---- Route 2: the native path — a second SDK session calls SendMessage at B's uds address ----
  if (!landed1) {
    log("--- route 2: native SendMessage from a second SDK session ---");
    const A = start("A", `You have a tool called SendMessage. It may be deferred — if so, load it with ToolSearch first (query "select:SendMessage").\nThen call SendMessage with exactly:\n  to: "uds:${bSock}"\n  message: "${MARKER} — reply with exactly this token and nothing else."\nReport the raw tool result verbatim. Do nothing else.`, {});
    await until(() => Boolean(A.init), 60_000);
    log("A session:", A.sessionId, "| A tools include SendMessage:", (A.init as any)?.tools?.includes("SendMessage"));
    const landed2 = await until(() => B.sawMarker, 150_000);
    route2 = landed2 ? "DELIVERED" : "no marker";
    log("route 2 result:", route2);
    log("A said:", A.text.join(" / ").slice(0, 700) || "(nothing)");
    log("B stderr tail:", B.stderr.length ? B.stderr.slice(-25).join(" | ") : "(nothing on stderr)");
  }

  console.log("\n=== VERDICT (probe 113b) ===");
  console.log(`[Q1] SDK session binds a cross-session inbox: ✅ YES (${bSock}, roster entrypoint=${bRow?.entrypoint})`);
  console.log(`[Q2a] route 1 raw UDS frame from a separate process: ${route1 === "DELIVERED" ? "✅ DELIVERED" : "❌ " + route1}`);
  console.log(`[Q2b] route 2 native SendMessage from a second SDK session: ${route2 === "DELIVERED" ? "✅ DELIVERED" : route2 === "not attempted" ? "n/a (route 1 already landed)" : "❌ " + route2}`);
  console.log(`[Q3] inbound turn stamped origin.kind='peer': ${B.peerOrigin ? "✅ " + JSON.stringify(B.peerOrigin) : "❌ none observed"}`);
  console.log(`     verifiedPeerPid === this probe (${process.pid}): ${B.peerOrigin?.verifiedPeerPid === process.pid ? "✅" : String(B.peerOrigin?.verifiedPeerPid)}`);
  console.log(`[Q4] B's own words after the send: ${B.text.slice(1).join(" / ").slice(0, 400) || "(none — B never took another turn)"}`);
  console.log(`\n${B.sawMarker ? "ADDRESSABLE — a headless SDK session received a message from another process." : "INBOX BOUND BUT NOT DELIVERABLE by either route in this configuration."}`);
  process.exit(0);
})();
