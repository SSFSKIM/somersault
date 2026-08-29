// Probe 120 — Does the CLI RE-READ `crossSessionInbound` off the live flag layer, or latch it at startup?
//
// Why this exists. M8 ships the inbound policy as an ADMISSION decision: `thread/start` and
// `thread/resume` write `crossSessionInbound` into the config every engine for that thread is built
// from (appserver/peerPolicy.ts). A RUNTIME setter — `thread/crossSessionInbound/set` — would instead
// write the live flag layer via `Query.applyFlagSettings` and expect the CLI to honour it on the NEXT
// inbound message. Half of that is certain: this repository already drives `applyFlagSettings` for
// permissions, output style and effort level. The other half is not, and it is not inferable —
// probe 102 established that `applyFlagSettings` RESOLVES for values it never validates, so a
// resolved call is not evidence that anything took effect. Shipping a security-shaped knob on that
// basis would put a method on the wire that reports success for a policy change that did not happen.
//
// So the only admissible evidence is BEHAVIOURAL: send a message, flip the policy, send another, and
// see whether the disposition moved. `applyFlagSettings` merges into the "flag layer", which
// outranks lower-precedence sources (sdk.d.ts:2465) — so if the value is re-read at arrival time, a
// flip MUST beat the launch value. If it does not, the value was latched.
//
// The legs:
//   A  refuse -> accept.  Launch refusing, confirm refusal, flip to accept, send again. Does it arrive?
//   B  accept -> refuse.  The mirror, and the one that matters for safety: a policy that can be turned
//                         ON at runtime but not OFF is worse than one that cannot move at all.
//   C  control.           113c's exact configuration, unflipped — proves the send path works in THIS
//                         run, so leg A's silence reads as "refused" and never as "misdelivered".
//   D  production door.   The launch policy written the way M8 actually writes it (`options.settings`,
//                         peerPolicy's door 1) rather than through a project settings file. This is the
//                         first LIVE check that Task 8's door is honoured at all; every unit test for it
//                         asserts the config we build, not the CLI's response to it.
//
// Held fixed at the measured-good baseline. 113c proved delivery for exactly one combination:
// a bypassPermissions receiver and an envelope asserting from-mode="bypass" (mode parity). This probe
// varies `crossSessionInbound` and NOTHING else, so it reuses that combination verbatim. Note this is
// deliberately NOT production's envelope — the gateway always asserts from-mode="prompting", whose
// measured consequence (held by a bypassPermissions peer) is already recorded on the scorecard. A
// probe that changed both variables at once could not attribute its own result.
//
// Disposition is read from each receiver's own debug log at ~/.claude/debug/<session-id>.txt, where
// the CLI states it in its own words, and is cross-checked against `origin.kind === "peer"` frames on
// the SDK stream — the signal the app-server's own arrival path actually keys on.
//
// Run from CC-to-SDK/probes:
//   unset ANTHROPIC_API_KEY; npx tsx probes/120-runtime-inbound-policy.ts
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

const log = (...a: unknown[]) => console.log("[p120]", ...a);
const SESSIONS_DIR = join(homedir(), ".claude", "sessions");
const DEBUG_DIR = join(homedir(), ".claude", "debug");
const RUN = Math.random().toString(36).slice(2, 8).toUpperCase();
setTimeout(() => { log("!!! GLOBAL WATCHDOG (900s)"); process.exit(2); }, 900_000).unref?.();

/** 113c's envelope, byte for byte. The receiver re-serializes and compares, so attribute order is not
 *  ours to improve. from-mode="bypass" is the parity half of the measured-good baseline. */
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
/** The lines that state a disposition, and nothing else. Counted rather than matched on content: the
 *  CLI withholds the body from its own log ("(withheld)"), so two sends to one receiver are
 *  indistinguishable by text — only by position. */
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

type Sess = { q: any; init?: any; sessionId: string; peerFrames: number; markers: Set<string>; text: string[] };

/** `settings` is the SDK's typed object — peerPolicy's DOOR 1, the one production writes. `project`
 *  writes a settings FILE, which is 113c's proven path. Legs carry whichever they are measuring. */
function start(tag: string, opts: { settings?: Record<string, unknown>; project?: Record<string, unknown> }): Sess {
  const s: Sess = { q: null, sessionId: "", peerFrames: 0, markers: new Set(), text: [] };
  const c = mkdtempSync(join(tmpdir(), `p120-${tag}-`));
  mkdirSync(join(c, ".claude"), { recursive: true });
  writeFileSync(join(c, ".claude", "settings.json"), JSON.stringify(opts.project ?? {}, null, 2));
  const held = new Promise<void>(() => { /* session stays alive and idle */ });
  async function* input() {
    yield { type: "user" as const, message: { role: "user" as const, content: "Say OK." }, parent_tool_use_id: null, session_id: "x" };
    await held;
  }
  s.q = query({
    prompt: input(),
    options: {
      model: "claude-sonnet-4-5", cwd: c, settingSources: ["project"],
      permissionMode: "bypassPermissions", extraArgs: { debug: null },
      ...(opts.settings ? { settings: opts.settings } : {}),
    } as any,
  });
  (async () => {
    for await (const m of s.q as any) {
      if (m.type === "system" && m.subtype === "init") { s.init = m; s.sessionId = m.session_id; }
      if (m.type === "user") {
        const t = typeof m.message?.content === "string" ? m.message.content : JSON.stringify(m.message?.content ?? "");
        for (const k of t.matchAll(/P120-[A-Z0-9-]+/g)) s.markers.add(k[0]);
        if (m.origin?.kind === "peer") {
          s.peerFrames += 1;
          log(`[${tag}] PEER FRAME on stream:`, JSON.stringify(m.origin).slice(0, 260));
        }
      }
      if (m.type === "assistant") for (const b of m.message?.content ?? []) {
        if (b.type === "text" && b.text.trim()) {
          s.text.push(b.text.trim());
          for (const k of b.text.matchAll(/P120-[A-Z0-9-]+/g)) s.markers.add(k[0]);
        }
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

/** One send, attributed. Snapshots the disposition-line count first and classifies only what is NEW,
 *  because a receiver that has already taken one message carries its history in the same log. */
async function send(tag: string, S: Sess, ourAddr: string, marker: string): Promise<Disposition> {
  const row = rowForSession(S.sessionId);
  const sock = (S.init as any)?.messaging_socket_path as string | undefined;
  if (!sock || !existsSync(sock)) { log(`[${tag}] NO INBOX BOUND (sock=${JSON.stringify(sock)})`); return "NO-INBOX"; }
  const before = dispositionLines(S.sessionId).length;
  const token = readPeerToken(row?.pid);
  const frames: unknown[] = [];
  if (token) frames.push({ type: "auth", token });
  frames.push({
    type: "user",
    session_id: S.sessionId,
    from: ourAddr,
    message: { content: envelope(ourAddr, "probe-120", `${marker} reply with exactly this token and nothing else.`) },
    priority: "next",
    msg_id: `p120-${tag}-${Date.now()}`,
  });
  log(`[${tag}] send ${marker} (auth key present: ${token !== undefined}) -> ${await sendFrames(sock, frames)}`);
  await until(() => dispositionLines(S.sessionId).length > before, 40_000);
  const fresh = dispositionLines(S.sessionId).slice(before);
  for (const l of fresh) console.log("       ", l.trim());
  const d = classify(fresh);
  log(`[${tag}] disposition: ${d}`);
  return d;
}

/** The flip. Reported separately from its effect, because RESOLVED and TOOK EFFECT are the two things
 *  this probe exists to keep apart. */
async function flip(tag: string, S: Sess, value: string): Promise<string> {
  try {
    await (S.q as any).applyFlagSettings({ crossSessionInbound: value });
    log(`[${tag}] applyFlagSettings({crossSessionInbound:"${value}"}) RESOLVED (proves nothing on its own)`);
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

  // All four receivers start together: init is the slow part and they are independent.
  const A = start("A-refuse2accept", { project: { crossSessionInbound: "refuse" } });
  const B = start("B-accept2refuse", { project: { crossSessionInbound: "accept" } });
  const C = start("C-control", { project: {} });
  const D = start("D-prod-door", { settings: { crossSessionInbound: "refuse" } });
  const ready = await until(() => [A, B, C, D].every(s => Boolean(s.init)), 180_000);
  log("all four receivers initialized:", ready);
  for (const [n, s] of [["A", A], ["B", B], ["C", C], ["D", D]] as const) {
    log(`  ${n}: session=${s.sessionId || "(none)"} inbox=${JSON.stringify((s.init as any)?.messaging_socket_path)}`);
  }
  if (!ready) log("not all receivers came up — reporting what did");

  // C first: if the send path is broken this run, nothing below means anything.
  const cD = await send("C-control", C, ourAddr, `P120-${RUN}-C`);

  // D: is production's door honoured at launch at all?
  const dD = await send("D-prod-door", D, ourAddr, `P120-${RUN}-D`);

  // A: refuse -> accept
  const a1 = await send("A-pre", A, ourAddr, `P120-${RUN}-A1`);
  const aFlip = await flip("A", A, "accept");
  await wait(3000);
  const a2 = await send("A-post", A, ourAddr, `P120-${RUN}-A2`);

  // B: accept -> refuse
  const b1 = await send("B-pre", B, ourAddr, `P120-${RUN}-B1`);
  const bFlip = await flip("B", B, "refuse");
  await wait(3000);
  const b2 = await send("B-post", B, ourAddr, `P120-${RUN}-B2`);

  await wait(10_000);

  const legAMoved = a1 !== "DELIVERED" && a2 === "DELIVERED";
  const legBMoved = b1 === "DELIVERED" && b2 !== "DELIVERED";
  const sendPathOk = cD === "DELIVERED";

  console.log("\n=== VERDICT (probe 120) ===");
  console.log(`SDK 0.3.237. Baseline held fixed: bypassPermissions receiver, envelope from-mode="bypass".`);
  console.log(`| leg | launch         | pre-flip   | flip call | post-flip  | moved`);
  console.log(`| C   | (unset)        | ${cD.padEnd(10)} | -         | -          | control`);
  console.log(`| D   | refuse (door1) | ${dD.padEnd(10)} | -         | -          | ${dD !== "DELIVERED" ? "door honoured" : "DOOR NOT HONOURED"}`);
  console.log(`| A   | refuse         | ${a1.padEnd(10)} | ${aFlip.padEnd(9)} | ${a2.padEnd(10)} | ${legAMoved ? "YES" : "no"}`);
  console.log(`| B   | accept         | ${b1.padEnd(10)} | ${bFlip.padEnd(9)} | ${b2.padEnd(10)} | ${legBMoved ? "YES" : "no"}`);
  console.log(`peer frames on stream: A=${A.peerFrames} B=${B.peerFrames} C=${C.peerFrames} D=${D.peerFrames}`);
  console.log(`markers reaching a model: A=${[...A.markers].join(",") || "none"} B=${[...B.markers].join(",") || "none"} C=${[...C.markers].join(",") || "none"} D=${[...D.markers].join(",") || "none"}`);
  console.log(`receipts back to our socket: ${receipts.length}`);
  console.log(`send path working this run (leg C): ${sendPathOk ? "YES" : "NO — every other leg below is uninterpretable"}`);

  const verdict = !sendPathOk ? "INCONCLUSIVE — the send path did not deliver in this run (leg C)."
    : legAMoved && legBMoved ? "A — both directions move at runtime. The setter may ship on the settings spine."
      : !legAMoved && !legBMoved ? "B — the CLI LATCHES crossSessionInbound; the flag layer is not re-read. The setter must NOT ship as a live write."
        : `C — ASYMMETRIC. off->on moved: ${legAMoved}; on->off moved: ${legBMoved}. Only the measured direction may ship, and the other must be named on the wire.`;
  console.log(`\nVERDICT: ${verdict}`);
  process.exit(0);
})();
