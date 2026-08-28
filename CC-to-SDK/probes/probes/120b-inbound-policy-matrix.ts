// Probe 120b — Is the runtime asymmetry a LATCH on `refuse`, or one unreachable value?
//
// Probe 120 measured two transitions against a fixed baseline and found them asymmetric:
//   accept -> refuse   MOVED   (the flag layer is re-read, and it beat the launch value)
//   refuse -> accept   did NOT (the post-flip message was refused with the same line as the pre-flip one)
// The refusal line is the same on both sends and it is early:
//   [cross-session-inbound] refused inbound peer message (uds: dropped before attachment materialization)
//
// One cell is not a rule. Two mechanisms explain 120 equally well, and they license DIFFERENT setters:
//   M1 "refuse latches the path". A session that launches refusing never materializes an inbound path,
//      so NO later value can revive it; a session that launches non-refusing consults the current value
//      per message and can be moved anywhere. Setter rule: the launch policy decides whether the thread
//      has an inbound path at all; the runtime value moves freely within a thread that has one.
//   M2 "accept is unreachable at runtime". Only the specific value `accept` cannot be written late.
//      Setter rule: everything except accept moves.
//
// They disagree about exactly two transitions, so those are what this probe measures:
//   E  hold -> accept    M1 says MOVES (the path exists). M2 says does not.
//   F  refuse -> hold    M1 says does NOT (path never materialized). M2 says MOVES.
// Two more legs pin the rest of the matrix a three-valued setter would claim:
//   G  accept -> hold    the remaining restrictive move
//   H  hold -> refuse    the remaining restrictive move, from the middle state
// Plus C, 120's control, so a silent send-path failure cannot be read as a policy result.
//
// `hold` is in the matrix because admission already accepts it: peerPolicy's CrossSessionInbound is
// "accept" | "hold" | "refuse", so a setter that refuses a value `thread/start` accepts would be an
// inconsistency of our own making rather than a measured limit.
//
// One correction to 120's configuration, carried here. 120 observed ZERO `origin.kind === "peer"`
// frames on the SDK stream even for messages the CLI routed and the model answered — because 120 did
// not pass `--replay-user-messages`, which is what makes an inbound peer message visible in the
// stream at all (probe 117). Production passes it on EVERY thread, refusing ones included
// (peerPolicy.ts). This probe passes it, so the stream observation means something.
//
// Baseline held fixed exactly as 120 held it: bypassPermissions receiver, envelope from-mode="bypass".
//
// Run from CC-to-SDK/probes:
//   unset ANTHROPIC_API_KEY; npx tsx probes/120b-inbound-policy-matrix.ts
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

const log = (...a: unknown[]) => console.log("[p120b]", ...a);
const SESSIONS_DIR = join(homedir(), ".claude", "sessions");
const DEBUG_DIR = join(homedir(), ".claude", "debug");
const RUN = Math.random().toString(36).slice(2, 8).toUpperCase();
setTimeout(() => { log("!!! GLOBAL WATCHDOG (900s)"); process.exit(2); }, 900_000).unref?.();

function envelope(from: string, name: string, body: string): string {
  return `<cross-session-message from="${from}" from-name="${name}" from-mode="bypass">\n${body}\n</cross-session-message>`;
}

function readPeerToken(pid: number | undefined): string | undefined {
  if (pid === undefined) return undefined;
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
const dispositionLines = (sessionId: string): string[] =>
  udsLog(sessionId).filter(l => /held inbound|Routed user message|refus|denied|dropped/i.test(l));

type Disposition = "DELIVERED" | "HELD" | "REFUSED" | "SILENT" | "NO-INBOX";
function classify(lines: string[]): Disposition {
  const j = lines.join(" ");
  if (!lines.length) return "SILENT";
  if (/Routed user message/i.test(j)) return "DELIVERED";
  if (/refus|denied|dropped/i.test(j)) return "REFUSED";
  if (/held inbound/i.test(j)) return "HELD";
  return "SILENT";
}

type Sess = { q: any; init?: any; sessionId: string; peerFrames: number; markers: Set<string> };

function start(tag: string, project: Record<string, unknown>): Sess {
  const s: Sess = { q: null, sessionId: "", peerFrames: 0, markers: new Set() };
  const c = mkdtempSync(join(tmpdir(), `p120b-${tag}-`));
  mkdirSync(join(c, ".claude"), { recursive: true });
  writeFileSync(join(c, ".claude", "settings.json"), JSON.stringify(project, null, 2));
  const held = new Promise<void>(() => { /* stays alive and idle */ });
  async function* input() {
    yield { type: "user" as const, message: { role: "user" as const, content: "Say OK." }, parent_tool_use_id: null, session_id: "x" };
    await held;
  }
  s.q = query({
    prompt: input(),
    options: {
      model: "claude-sonnet-4-5", cwd: c, settingSources: ["project"],
      permissionMode: "bypassPermissions",
      // `--replay-user-messages` is what makes an inbound peer message visible in the stream at all.
      // 120 omitted it and therefore saw zero peer frames for messages it had proved were delivered.
      extraArgs: { debug: null, "replay-user-messages": null },
    } as any,
  });
  (async () => {
    for await (const m of s.q as any) {
      if (m.type === "system" && m.subtype === "init") { s.init = m; s.sessionId = m.session_id; }
      if (m.type === "user") {
        const t = typeof m.message?.content === "string" ? m.message.content : JSON.stringify(m.message?.content ?? "");
        for (const k of t.matchAll(/P120B-[A-Z0-9-]+/g)) s.markers.add(k[0]);
        if (m.origin?.kind === "peer") {
          s.peerFrames += 1;
          log(`[${tag}] PEER FRAME:`, JSON.stringify(m.origin).slice(0, 300));
        }
      }
      if (m.type === "assistant") for (const b of m.message?.content ?? []) {
        if (b.type === "text" && b.text.trim()) for (const k of b.text.matchAll(/P120B-[A-Z0-9-]+/g)) s.markers.add(k[0]);
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

async function send(tag: string, S: Sess, ourAddr: string, marker: string): Promise<Disposition> {
  const row = rowForSession(S.sessionId);
  const sock = (S.init as any)?.messaging_socket_path as string | undefined;
  if (!sock || !existsSync(sock)) { log(`[${tag}] NO INBOX BOUND`); return "NO-INBOX"; }
  const before = dispositionLines(S.sessionId).length;
  const token = readPeerToken(row?.pid);
  const frames: unknown[] = [];
  if (token) frames.push({ type: "auth", token });
  frames.push({
    type: "user", session_id: S.sessionId, from: ourAddr,
    message: { content: envelope(ourAddr, "probe-120b", `${marker} reply with exactly this token and nothing else.`) },
    priority: "next", msg_id: `p120b-${tag}-${Date.now()}`,
  });
  log(`[${tag}] send ${marker} -> ${await sendFrames(sock, frames)}`);
  await until(() => dispositionLines(S.sessionId).length > before, 40_000);
  const fresh = dispositionLines(S.sessionId).slice(before);
  for (const l of fresh) console.log("       ", l.trim());
  const d = classify(fresh);
  log(`[${tag}] disposition: ${d}`);
  return d;
}

async function flip(tag: string, S: Sess, value: string): Promise<string> {
  try {
    await (S.q as any).applyFlagSettings({ crossSessionInbound: value });
    log(`[${tag}] applyFlagSettings({crossSessionInbound:"${value}"}) RESOLVED`);
    return "resolved";
  } catch (e) {
    log(`[${tag}] applyFlagSettings THREW: ${(e as Error).message.slice(0, 160)}`);
    return "threw";
  }
}

(async () => {
  const nsDir = "/tmp/cc-socks";
  mkdirSync(nsDir, { recursive: true, mode: 0o700 });
  const ourSock = join(nsDir, `${process.pid}.sock`);
  try { unlinkSync(ourSock); } catch { /* fresh */ }
  const srv = createServer(c => {
    c.setEncoding("utf8");
    c.on("data", d => { for (const l of d.split("\n")) if (l.trim()) { receipts.push(l.trim()); log("RECEIPT:", l.trim().slice(0, 240)); } });
    c.on("error", () => { /* peer hung up */ });
  });
  await new Promise<void>(r => srv.listen(ourSock, () => r()));
  srv.unref();
  const ourAddr = `uds:${ourSock}`;
  log("our peer address:", ourAddr, "| run:", RUN);

  const C = start("C-control", {});
  const E = start("E-hold2accept", { crossSessionInbound: "hold" });
  const F = start("F-refuse2hold", { crossSessionInbound: "refuse" });
  const G = start("G-accept2hold", { crossSessionInbound: "accept" });
  const H = start("H-hold2refuse", { crossSessionInbound: "hold" });
  const ready = await until(() => [C, E, F, G, H].every(s => Boolean(s.init)), 180_000);
  log("all five receivers initialized:", ready);

  const cD = await send("C-control", C, ourAddr, `P120B-${RUN}-C`);

  const e1 = await send("E-pre", E, ourAddr, `P120B-${RUN}-E1`);
  await flip("E", E, "accept"); await wait(3000);
  const e2 = await send("E-post", E, ourAddr, `P120B-${RUN}-E2`);

  const f1 = await send("F-pre", F, ourAddr, `P120B-${RUN}-F1`);
  await flip("F", F, "hold"); await wait(3000);
  const f2 = await send("F-post", F, ourAddr, `P120B-${RUN}-F2`);

  const g1 = await send("G-pre", G, ourAddr, `P120B-${RUN}-G1`);
  await flip("G", G, "hold"); await wait(3000);
  const g2 = await send("G-post", G, ourAddr, `P120B-${RUN}-G2`);

  const h1 = await send("H-pre", H, ourAddr, `P120B-${RUN}-H1`);
  await flip("H", H, "refuse"); await wait(3000);
  const h2 = await send("H-post", H, ourAddr, `P120B-${RUN}-H2`);

  await wait(10_000);

  const moved = (pre: Disposition, post: Disposition) => pre !== post;
  console.log("\n=== VERDICT (probe 120b) ===");
  console.log(`control (leg C, unset): ${cD}${cD === "DELIVERED" ? "" : "  <-- send path suspect; legs below uninterpretable"}`);
  console.log(`| leg | launch | flip to | pre        | post       | moved`);
  console.log(`| E   | hold   | accept  | ${e1.padEnd(10)} | ${e2.padEnd(10)} | ${moved(e1, e2) ? "YES" : "no"}`);
  console.log(`| F   | refuse | hold    | ${f1.padEnd(10)} | ${f2.padEnd(10)} | ${moved(f1, f2) ? "YES" : "no"}`);
  console.log(`| G   | accept | hold    | ${g1.padEnd(10)} | ${g2.padEnd(10)} | ${moved(g1, g2) ? "YES" : "no"}`);
  console.log(`| H   | hold   | refuse  | ${h1.padEnd(10)} | ${h2.padEnd(10)} | ${moved(h1, h2) ? "YES" : "no"}`);
  console.log(`peer frames on stream (with --replay-user-messages): C=${C.peerFrames} E=${E.peerFrames} F=${F.peerFrames} G=${G.peerFrames} H=${H.peerFrames}`);
  console.log(`markers reaching a model: C=${[...C.markers].join(",") || "none"} E=${[...E.markers].join(",") || "none"} F=${[...F.markers].join(",") || "none"} G=${[...G.markers].join(",") || "none"} H=${[...H.markers].join(",") || "none"}`);
  console.log(`receipts: ${receipts.length}`);

  // M1 predicts: E moves, F does not (launch-refuse latches the whole path).
  // M2 predicts: E does not move, F does (only the value `accept` is unreachable late).
  const m1 = moved(e1, e2) && !moved(f1, f2);
  const m2 = !moved(e1, e2) && moved(f1, f2);
  console.log(`\nVERDICT: ${m1
    ? "M1 — a thread that LAUNCHES refusing has no inbound path and no runtime value revives it; a thread that launches non-refusing consults the live value per message and moves freely."
    : m2
      ? "M2 — only the value `accept` is unreachable at runtime; every other value moves, including out of refuse."
      : `NEITHER as stated — E moved: ${moved(e1, e2)}, F moved: ${moved(f1, f2)}. The matrix above is the finding; do not generalize past it.`}`);
  process.exit(0);
})();
