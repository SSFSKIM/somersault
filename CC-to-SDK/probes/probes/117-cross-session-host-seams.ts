// Probe 117 — The three host seams a cross-session app-server domain has to stand on.
//
// 113c settled the premise: a separate process CAN deliver into a headless SDK session's turn queue,
// and `crossSessionInbound:"refuse"` is honored. What it could not settle are the three mechanics the
// DESIGN turns on. Each was traced through the installed CLI (2.1.246) by reading the compiled bundle;
// each has exactly one leaf that only a live run can close. This probe closes all three at once.
//
//   Q1  RECEIPTS. The receipt sender (`[uds-messaging]` -> `[uds-client]`) refuses to write unless the
//       reply address is (a) `uds:<path>` in the SAME directory as the receiver's own socket, (b) a
//       socket "vouched" by a live registry row and/or key file under ~/.claude/sessions, and (c) owned
//       by the SAME pid that delivered the original frame (kernel LOCAL_PEERPID pin, `expectPeerPid`).
//       It then writes one buffer and never reads: a listener that holds the connection open trips the
//       sender's 5s idle timeout ("hold-receipt send failed ... Timed out" — exactly what 113b logged).
//       113c's listener was a bare net.createServer: unvouched, and it never closed. Zero receipts.
//       -> Bind in-namespace, publish a registry row + key file for our own pid, close on read.
//       Does a `control:peer_message_status` receipt arrive, and what exactly does it carry?
//       Delivered against the REFUSE receiver, so this half costs no model turn.
//
//   Q2  POLICY INJECTION. `crossSessionInbound` is a settings key, not a query() option. 113c reached
//       it by writing .claude/settings.json into a temp cwd + settingSources:["project"] — which the
//       app-server cannot do: it hosts threads in the USER's real cwd and must not write into their
//       repo. The CLI's settings bootstrap force-adds `flagSettings` and `policySettings` to the
//       enabled set regardless of --setting-sources, so `Options.settings` (--settings) should be
//       honored even under settingSources: []. Two unknowns ride on it: whether the SDK serializes a
//       settings OBJECT correctly (the arg emitter is String(n), which would yield "[object Object]" —
//       so we pass a JSON STRING), and whether an explicit flag-layer value beats mode parity in BOTH
//       directions. Hence two receivers, each contradicting what parity alone would do:
//         R (refuse)  bypassPermissions + from-mode=bypass  -> parity says DELIVER, setting says REFUSE
//         A (accept)  default mode      + from-mode=bypass  -> parity says HOLD,    setting says DELIVER
//       Both with settingSources: [], both via --settings inline JSON. Nothing is written to any repo.
//
//   Q3  STREAM VISIBILITY. 113c saw the model act on peer text but never saw origin.kind==='peer' on
//       the SDK stream. The cause is not suppression: the SDK never passes --replay-user-messages, so
//       NO user prompt frame is emitted at all, peer or human. 2.1.246's replay filter gained an
//       explicit escape hatch for origin-bearing meta messages and its emitter now stamps `origin`.
//       -> extraArgs {"replay-user-messages": null} (the SDK already sets stream-json both ways, the
//       flag's hard precondition). Does the peer turn surface as {type:"user", isReplay:true,
//       origin:{kind:"peer", from, verifiedPeerPid, fromMode, name, body, msg_id}}? That object IS the
//       payload of the notification the app-server would broadcast, so its exact membership is design
//       input, not trivia.
//
// Two constructions below are self-validating rather than guessed: the key-file name (sha256 of WHAT,
// exactly?) and the row/key liveness fields are derived by reading a REAL live session's published
// files and confirming a candidate rule reproduces them, before we publish our own by the same rule.
//
// Run from CC-to-SDK/probes:
//   unset ANTHROPIC_API_KEY; npx tsx probes/117-cross-session-host-seams.ts
import { createConnection, createServer } from "node:net";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
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

const log = (...a: unknown[]) => console.log("[p117]", ...a);
const SESSIONS_DIR = join(homedir(), ".claude", "sessions");
const DEBUG_DIR = join(homedir(), ".claude", "debug");
const MARKER = `P117-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
setTimeout(() => { log("!!! GLOBAL WATCHDOG (420s)"); process.exit(2); }, 420_000).unref?.();

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
async function until(pred: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (pred()) return true; await wait(500); }
  return pred();
}

// Attribute order is fixed; the receiver re-serializes and compares byte-exactly.
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
function keyFileFor(pid: number): { name: string; body: any } | undefined {
  try {
    for (const f of readdirSync(SESSIONS_DIR)) {
      const m = /^(\d+)\.[0-9a-f]{64}\.key$/.exec(f);
      if (!m || Number(m[1]) !== pid) continue;
      return { name: f, body: JSON.parse(readFileSync(join(SESSIONS_DIR, f), "utf8")) };
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
function psLstart(pid: number): string | undefined {
  try {
    return execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8", env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
    }).trim();
  } catch { return undefined; }
}

type Sess = { q: any; init?: any; sessionId: string; sawMarker: boolean; peerFrames: any[]; text: string[] };
function start(tag: string, opts: { settings?: Record<string, unknown>; permissionMode?: string; replay?: boolean }): Sess {
  const s: Sess = { q: null, sessionId: "", sawMarker: false, peerFrames: [], text: [] };
  const held = new Promise<void>(() => { /* session stays alive and idle */ });
  async function* input() {
    yield { type: "user" as const, message: { role: "user" as const, content: "Say OK." }, parent_tool_use_id: null, session_id: "x" };
    await held;
  }
  const extraArgs: Record<string, string | null> = { debug: null };
  if (opts.replay) extraArgs["replay-user-messages"] = null;
  s.q = query({
    prompt: input(),
    options: {
      model: "claude-sonnet-4-5",
      cwd: process.cwd(),                       // the REAL cwd: nothing is written into any repo
      settingSources: [],                       // the isolation mode a hosted thread would use
      ...(opts.settings ? { settings: JSON.stringify(opts.settings) } : {}),
      ...(opts.permissionMode ? { permissionMode: opts.permissionMode } : {}),
      extraArgs,
    } as any,
  });
  (async () => {
    for await (const m of s.q as any) {
      if (m.type === "system" && m.subtype === "init") { s.init = m; s.sessionId = m.session_id; }
      if (m.type === "user") {
        const t = typeof m.message?.content === "string" ? m.message.content : JSON.stringify(m.message?.content ?? "");
        if (t.includes(MARKER)) s.sawMarker = true;
        if (m.origin || m.isReplay) {
          log(`[${tag}] user frame: isReplay=${m.isReplay === true} origin=${JSON.stringify(m.origin ?? null)}`);
          if (m.origin?.kind === "peer") s.peerFrames.push(m);
        }
      }
      if (m.type === "assistant") for (const b of m.message?.content ?? []) {
        if (b.type === "text" && b.text.trim()) { s.text.push(b.text.trim()); if (b.text.includes(MARKER)) s.sawMarker = true; }
      }
    }
  })().catch(e => log(`[${tag}] stream ended:`, (e as Error).message.slice(0, 200)));
  return s;
}

const receipts: string[] = [];

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

async function deliver(tag: string, target: Sess, ourAddr: string, mode: "bypass" | "prompting", body: string): Promise<string> {
  const row = rowForSession(target.sessionId);
  const sock = (target.init as any)?.messaging_socket_path as string | undefined;
  if (!sock || !existsSync(sock)) return "no inbox bound";
  const key = row ? keyFileFor(row.pid) : undefined;
  const frames: unknown[] = [];
  if (key?.body?.peerToken) frames.push({ type: "auth", token: key.body.peerToken });   // never printed
  frames.push({
    type: "user",
    session_id: target.sessionId,
    from: ourAddr,
    message: { content: envelope(ourAddr, "probe-117", mode, body) },
    priority: "next",
    msg_id: `p117-${tag}-${Date.now()}`,
  });
  const before = udsLog(target.sessionId).length;
  log(`[${tag}] -> ${sock} (auth key present: ${Boolean(key?.body?.peerToken)}); socket outcome: ${await sendFrames(sock, frames)}`);
  await until(() => udsLog(target.sessionId).slice(before).some(l => /held inbound|Routed user message|refus|denied|dropped/i.test(l)), 45_000);
  const lines = udsLog(target.sessionId).slice(before).filter(l => /held inbound|Routed user message|refus|denied|dropped/i.test(l));
  for (const l of lines.slice(-2)) console.log("      ", l.trim());
  const joined = lines.join(" ");
  return /Routed user message/i.test(joined) ? "DELIVERED"
    : /refus/i.test(joined) ? "REFUSED"
    : /held inbound/i.test(joined) ? "HELD"
    : "no disposition logged";
}

// --- our own published peer identity -------------------------------------------------------------
// The receipt sender vouches the reply socket against ~/.claude/sessions before it will connect. We
// publish a row + key file for our own pid, deriving the file-naming and liveness rules from a REAL
// session's files rather than guessing at them.
function publishIdentity(ourSock: string, sampleRow: any, sampleKey: { name: string; body: any } | undefined): { rowPath: string; keyPath?: string; notes: string[] } {
  const notes: string[] = [];
  const rowPath = join(SESSIONS_DIR, `${process.pid}.json`);

  // Which liveness fields does a real row carry, and does `ps -o lstart=` reproduce them?
  const sampleLstart = psLstart(sampleRow?.pid);
  notes.push(`real row keys: ${Object.keys(sampleRow ?? {}).sort().join(",")}`);
  notes.push(`real row procStart=${JSON.stringify(sampleRow?.procStart)} procStartFt=${JSON.stringify(sampleRow?.procStartFt)} | ps lstart=${JSON.stringify(sampleLstart)} | ps reproduces procStart: ${sampleRow?.procStart === sampleLstart}`);

  const ourLstart = psLstart(process.pid);
  const row: Record<string, unknown> = {
    ...sampleRow,
    pid: process.pid,
    sessionId: `p117-${process.pid}`,
    messagingSocketPath: ourSock,
    startedAt: new Date().toISOString(),
  };
  if ("procStart" in (sampleRow ?? {})) row.procStart = ourLstart;
  if ("procStartFt" in (sampleRow ?? {}) && ourLstart) row.procStartFt = Date.parse(ourLstart + " UTC") || undefined;
  writeFileSync(rowPath, JSON.stringify(row, null, 2));

  // The key file name is <pid>.<sha256 of ???>.key. Test candidate rules against the real one.
  let keyPath: string | undefined;
  if (sampleKey) {
    const realHash = /^\d+\.([0-9a-f]{64})\.key$/.exec(sampleKey.name)![1];
    const sampleSock = sampleRow?.messagingSocketPath as string;
    const candidates: Record<string, string> = {
      path: createHash("sha256").update(sampleSock).digest("hex"),
      realpath: (() => { try { return createHash("sha256").update(realpathSync(sampleSock)).digest("hex"); } catch { return ""; } })(),
      pathNewline: createHash("sha256").update(sampleSock + "\n").digest("hex"),
    };
    const winner = Object.entries(candidates).find(([, h]) => h === realHash)?.[0];
    notes.push(`key-file hash rule: ${winner ?? "NONE OF path|realpath|pathNewline matched"} (real key body keys: ${Object.keys(sampleKey.body ?? {}).sort().join(",")})`);
    if (winner) {
      const ourHash = winner === "realpath"
        ? createHash("sha256").update(realpathSync(ourSock)).digest("hex")
        : winner === "pathNewline"
          ? createHash("sha256").update(ourSock + "\n").digest("hex")
          : createHash("sha256").update(ourSock).digest("hex");
      keyPath = join(SESSIONS_DIR, `${process.pid}.${ourHash}.key`);
      const body: Record<string, unknown> = { ...sampleKey.body, peerToken: createHash("sha256").update(`p117-${process.pid}-${Date.now()}`).digest("hex").slice(0, 32) };
      if ("procStart" in sampleKey.body) body.procStart = ourLstart;
      if ("procStartFt" in sampleKey.body && ourLstart) body.procStartFt = Date.parse(ourLstart + " UTC") || undefined;
      writeFileSync(keyPath, JSON.stringify(body, null, 2), { mode: 0o600 });
    }
  } else {
    notes.push("no key file published by the sample session — cannot derive the naming rule");
  }
  return { rowPath, keyPath, notes };
}

(async () => {
  // R: bypassPermissions (parity with a bypass sender would DELIVER) + flag-layer refuse.
  const R = start("R-refuse", { settings: { crossSessionInbound: "refuse" }, permissionMode: "bypassPermissions" });
  if (!await until(() => Boolean(R.init), 120_000)) { log("R never emitted init"); process.exit(3); }
  const rRow = rowForSession(R.sessionId);
  const rSock = (R.init as any)?.messaging_socket_path as string | undefined;
  log(`R session=${R.sessionId} sock=${JSON.stringify(rSock)} row=${rRow ? `pid=${rRow.pid} entrypoint=${rRow.entrypoint} proto=${rRow.peerProtocol}` : "(none)"}`);
  if (!rSock) { log("R bound no inbox — cannot proceed"); process.exit(3); }

  // Bind our listener in the RECEIVER's own socket namespace, and close on read (the 5s idle timeout
  // on the sender's side is what turned 113b's receipt into "Timed out").
  const nsDir = dirname(rSock);
  mkdirSync(nsDir, { recursive: true, mode: 0o700 });
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
        receipts.push(line.replace(/"token":"[^"]*"/g, '"token":"[REDACTED]"'));
        log("RECEIPT:", receipts[receipts.length - 1].slice(0, 300));
      }
      c.end();                                   // the sender never reads; hold it open and it times out
    });
    c.on("error", () => { /* peer hung up */ });
  });
  await new Promise<void>(r => srv.listen(ourSock, () => r()));
  srv.unref();
  const ourAddr = `uds:${ourSock}`;
  log("our peer address:", ourAddr);

  const ident = publishIdentity(ourSock, rRow, rRow ? keyFileFor(rRow.pid) : undefined);
  for (const n of ident.notes) log("identity:", n);
  log(`identity published: row=${ident.rowPath} key=${ident.keyPath ?? "(none)"}`);

  // --- Q2a + Q1 (vouched sender) ---
  const dR1 = await deliver("Q2a-refuse", R, ourAddr, "bypass", `${MARKER} vouched`);
  await wait(6000);
  const receiptsAfterVouched = receipts.length;

  // --- Q1 control: same delivery with our identity RETRACTED (unvouched reply address) ---
  try { if (ident.keyPath) unlinkSync(ident.keyPath); } catch { /* gone */ }
  try { unlinkSync(ident.rowPath); } catch { /* gone */ }
  const dR2 = await deliver("Q1-unvouched", R, ourAddr, "bypass", `${MARKER} unvouched`);
  await wait(6000);
  const receiptsAfterUnvouched = receipts.length - receiptsAfterVouched;

  // --- Q2b + Q3: explicit accept beats parity, and the peer turn on the stream ---
  const A = start("A-accept", { settings: { crossSessionInbound: "accept" }, replay: true });
  if (!await until(() => Boolean(A.init), 120_000)) { log("A never emitted init"); process.exit(3); }
  log(`A session=${A.sessionId} sock=${JSON.stringify((A.init as any)?.messaging_socket_path)}`);
  const dA = await deliver("Q2b-accept", A, ourAddr, "bypass", `${MARKER} reply with exactly this token and nothing else.`);
  await until(() => A.sawMarker && A.peerFrames.length > 0, 120_000);
  await wait(5000);

  console.log("\n=== VERDICT (probe 117) ===");
  console.log(`CLI: ${(R.init as any)?.version ?? "?"} | receiver inbox namespace: ${nsDir}`);
  console.log(`[Q1] peer_message_status receipts, vouched + closing listener: ${receiptsAfterVouched} ${receiptsAfterVouched > 0 ? "✅" : "❌"}`);
  console.log(`     receipts after retracting our registry row/key (control): ${receiptsAfterUnvouched} ${receiptsAfterUnvouched === 0 ? "(vouching is load-bearing)" : "(vouching NOT required)"}`);
  for (const r of receipts.slice(0, 3)) console.log("       ", r.slice(0, 300));
  console.log(`[Q2a] --settings inline JSON refuse, settingSources:[] , parity would deliver: ${dR1} ${dR1 === "REFUSED" ? "✅ flag layer wins" : "❌"}`);
  console.log(`[Q2b] --settings inline JSON accept, settingSources:[] , parity would hold:   ${dA} ${dA === "DELIVERED" ? "✅ flag layer wins" : "❌"}`);
  console.log(`[Q3] peer user frame on the SDK stream with --replay-user-messages: ${A.peerFrames.length > 0 ? "✅ " + A.peerFrames.length : "❌ none"}`);
  if (A.peerFrames.length > 0) {
    const f = A.peerFrames[0];
    console.log(`      isReplay=${f.isReplay === true} uuid=${Boolean(f.uuid)} origin=${JSON.stringify(f.origin)}`);
    console.log(`      origin field membership: ${Object.keys(f.origin ?? {}).sort().join(",")}`);
  }
  console.log(`[Q4] marker reached the model on A: ${A.sawMarker ? "✅ yes" : "not observed"} | text: ${A.text.join(" / ").slice(0, 200) || "(none)"}`);
  console.log(`[Q5] second delivery disposition (unvouched reply address): ${dR2}  — ingress should be unaffected; only the receipt path depends on vouching`);

  try { unlinkSync(ourSock); } catch { /* gone */ }
  try { if (ident.keyPath) unlinkSync(ident.keyPath); } catch { /* gone */ }
  try { unlinkSync(ident.rowPath); } catch { /* gone */ }
  process.exit(0);
})();
