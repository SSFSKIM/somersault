// Probe 121 — When N peer messages BATCH into one engine turn, what identifies each one ON DISK?
//
// The live half is already measured. LEG 5 of harness/test/live/appserver-cross-session.test.ts forces a
// batch (idle accepting receiver; the first message takes a turn, the rest accumulate behind it) and pins
// the engine's attribution: N arrivals produce N replay frames with N distinct uuids, but only ONE
// `origin.msg_id` and ONE `origin.body` — the CAUSING message's. So the live path names the causing
// message N times and never names the others, even though all N texts reach the model.
//
// What nobody has measured is what the PERSISTED rows carry for that same batch. A scan of every main-
// session transcript on this machine found 69 peer rows across 47 messages with every `msg_id` distinct —
// but not one batch among them, so the corpus cannot answer it. Three outcomes, each licensing a different
// design for any transcript-reading history feature:
//
//   A  persisted rows carry PER-MESSAGE `origin.body` — disk is faithful where the live frame is not, and
//      the correct text is recoverable by reading the transcript.
//   B  persisted rows repeat the causing message's `origin.body`, but each row's own `message.content`
//      envelope differs — recoverable, but only from the raw envelope, and NOT from `origin.body`, which
//      is what `peerArrival` (src/peer/address.ts) prefers over the envelope by design.
//   C  neither field attributes per frame — no reader can say which message an arrival uuid names, and a
//      history feature must MARK batched arrivals ambiguous rather than render them.
//
// MEASURED, 2026-08-30, CLI 2.1.250: **C**. Three messages sent, two peer-caused turns, three live
// arrival uuids — and TWO persisted rows:
//
//     row a2a99619  msg_id=c58aadc8  1 envelope   content: M1      origin.body: M1
//     row 42364455  msg_id=4bc39d4d  2 envelopes  content: M2,M3   origin.body: M2
//     (live uuid 541d1e23 has no persisted row at all)
//
// A batch is COLLAPSED. Several messages land in ONE frame under ONE uuid; `origin.body` names one of
// them and the rest are readable only as text inside a frame that claims to be a different message. So
// switching `peerArrival` to prefer the envelope does NOT fix batch attribution — the first envelope in
// a multi-envelope frame is just a different arbitrary member — and the per-message identity a history
// feature would want does not exist in the data at all.
//
// THE VERDICT NEEDS TWO READINGS, AND THE FIRST RUN OF THIS PROBE ONLY HAD ONE. Nonce COVERAGE asks
// whether each sent text is present somewhere across the batch. That is worth knowing, but it does NOT
// license reading a message off a frame, and the first run's verdict logic treated it as if it did:
// it scored 3/3 coverage and reported outcome B ("each frame carries its own text"). Re-reading the
// transcript that run left behind showed three sent messages had produced TWO persisted rows, one of
// which carried TWO envelopes (M2 and M3) while its origin.body named only M2 — and a third live
// arrival uuid had no row at all.
//
// So the verdict now also requires a BIJECTION: every frame carrying exactly one message and every
// message landing in exactly one frame. A and B assert per-frame attribution and are gated on it; C is
// what a collapsed batch actually produces. The lesson generalises past this probe — an aggregate over
// a set answers a question about the set, never about its members.
//
// Machinery is probe 120b's and 118's, unchanged where it was already right:
//   * `--replay-user-messages` is what makes an inbound peer message visible on the stream AT ALL (120's
//     recorded correction: without it, 120 saw zero peer frames for messages it had proved were routed).
//   * the receiver's own `~/.claude/debug/<sessionId>.txt` is where the gateway's disposition is legible.
//   * our reply address is a bound socket in the RECEIVER's namespace with a key file vouching for it (118).
//
// A NON-BATCH IS NOT AN ANSWER. Batch formation is verified LEG 5's way — fewer peer-caused turns than
// messages — and a run that fails it retries on a fresh receiver with tighter sends (all frames in one
// socket write) rather than reporting three separate turns as a measurement of batching.
//
// Bodies are never printed in full: lengths, equality, distinctness and 64-char prefixes only. Each body
// carries its own nonce inside that prefix, so a probe that could not tell its own messages apart would
// be visible as such in the output.
//
// Run from CC-to-SDK/probes:
//   unset ANTHROPIC_API_KEY; npx tsx probes/121-batch-arrival-attribution.ts
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

const log = (...a: unknown[]) => console.log("[p121]", ...a);
const SESSIONS_DIR = join(homedir(), ".claude", "sessions");
const DEBUG_DIR = join(homedir(), ".claude", "debug");
const PROJECTS_DIR = join(process.env.CLAUDE_CONFIG_DIR ?? join(process.env.HOME || homedir(), ".claude"), "projects");
const RUN = Math.random().toString(36).slice(2, 8).toUpperCase();
const N = 3;
setTimeout(() => { log("!!! GLOBAL WATCHDOG (1500s)"); process.exit(2); }, 1_500_000).unref?.();

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
async function until(pred: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (pred()) return true; await wait(500); }
  return pred();
}

/** LEG 5's message shape, and for its recorded reason: told "reply with only this token" the model either
 *  answers the peer over the gateway instead of its own transcript, or refuses outright, naming it a
 *  covert signal relay. The message says truthfully what it is. `pad` varies the LENGTH per message, so
 *  length alone discriminates the three even before the nonce is read. */
const bodyFor = (nonce: string, pad: number): string =>
  `This is an automated connectivity check from the cc-harness probe suite, which is also the process hosting this session. `
  + `Please confirm receipt by replying in plain text with the check code ${nonce}. `
  + `No tool use is needed and there is no need to message the sender back.`
  + " This sentence is padding that makes this message a distinguishable length.".repeat(pad);

const envelope = (from: string, body: string): string =>
  `<cross-session-message from="${from}" from-name="probe-121" from-mode="bypass">\n${body}\n</cross-session-message>`;

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
function peerTokenFor(pid: number | undefined): string | undefined {
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
function dispositionLines(sessionId: string): string[] {
  try {
    return readFileSync(join(DEBUG_DIR, `${sessionId}.txt`), "utf8").split("\n")
      .filter(l => /held inbound|Routed user message|refus|denied|dropped/i.test(l))
      .map(l => l.replace(/"token":"[^"]*"/g, '"token":"[REDACTED]"'));
  } catch { return []; }
}
/** The RAW persisted transcript, straight off disk — the only reading that can disagree with the stream. */
function transcriptRows(sessionId: string): any[] {
  let dirs: string[] = [];
  try { dirs = readdirSync(PROJECTS_DIR); } catch { return []; }
  for (const d of dirs) {
    const file = join(PROJECTS_DIR, d, `${sessionId}.jsonl`);
    if (!existsSync(file)) continue;
    return readFileSync(file, "utf8").split("\n").filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return {}; } });
  }
  return [];
}

/** Text of a `message.content` in either shape. Reported alongside its own length so an empty extraction
 *  is visible as empty rather than silently read as "the two sides agree". */
function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((b: any) => (typeof b?.text === "string" ? b.text : "")).join("");
  return "";
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

/** One peer frame as the LIVE stream delivered it. */
interface LiveArrival { order: number; uuid: string; msgId: string; body: string | undefined; content: string }

type Sess = { q: any; init?: any; sessionId: string; arrivals: LiveArrival[]; results: any[]; text: string[] };

function start(tag: string): Sess {
  const s: Sess = { q: null, sessionId: "", arrivals: [], results: [], text: [] };
  const held = new Promise<void>(() => { /* stays alive and idle */ });
  async function* input() {
    // A short primer turn, so the receiver is a genuinely IDLE ACCEPTING thread when the burst lands —
    // which is the precondition LEG 5's batch depends on.
    yield { type: "user" as const, message: { role: "user" as const, content: "Say READY and nothing else." }, parent_tool_use_id: null, session_id: "x" };
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
      if (m.type === "system" && m.subtype === "init") { s.init = m; s.sessionId = m.session_id; }
      else if (m.type === "user" && m.origin?.kind === "peer") {
        s.arrivals.push({
          order: s.arrivals.length + 1,
          uuid: String(m.uuid ?? ""),
          msgId: String(m.origin?.msg_id ?? "(none)"),
          body: typeof m.origin?.body === "string" ? m.origin.body : undefined,
          content: contentText(m.message?.content),
        });
        log(`[${tag}] PEER FRAME #${s.arrivals.length} uuid=${String(m.uuid).slice(0, 8)} msg_id=${m.origin?.msg_id}`);
      }
      else if (m.type === "assistant") {
        for (const b of m.message?.content ?? []) if (b.type === "text" && b.text.trim()) s.text.push(b.text.trim());
      }
      else if (m.type === "result") s.results.push(m);
    }
  })().catch(e => log(`[${tag}] stream ended:`, (e as Error).message.slice(0, 160)));
  return s;
}

interface Sent { n: number; nonce: string; msgId: string; body: string }

async function deliver(target: Sess, ourAddr: string, sent: Sent[], mode: "sequential" | "one-write"): Promise<string[]> {
  const sock = (target.init as any)?.messaging_socket_path as string | undefined;
  if (!sock || !existsSync(sock)) return ["NO-INBOX"];
  const token = peerTokenFor(rowForSession(target.sessionId)?.pid);
  const frameFor = (m: Sent) => ({
    type: "user", session_id: target.sessionId, from: ourAddr,
    message: { content: envelope(ourAddr, m.body) },
    priority: "next", msg_id: m.msgId,
  });
  if (mode === "one-write") {
    // TIGHTER: every frame in a single connection's single write burst — no round trip between them.
    const frames: unknown[] = token ? [{ type: "auth", token }] : [];
    for (const m of sent) frames.push(frameFor(m));
    return [await sendFrames(sock, frames)];
  }
  const out: string[] = [];
  for (const m of sent) {
    const frames: unknown[] = token ? [{ type: "auth", token }] : [];
    frames.push(frameFor(m));
    out.push(await sendFrames(sock, frames));
  }
  return out;
}

const prefix = (s: string | undefined, n = 64): string =>
  s === undefined ? "(absent)" : JSON.stringify(s.replace(/\s+/g, " ").slice(0, n));
const distinct = (xs: (string | undefined)[]): number => new Set(xs.map(x => (x === undefined ? " absent" : x))).size;
// AGGREGATE coverage: is each nonce present SOMEWHERE across the batch? This answers "was the text
// retained at all", and it is the weaker of the two readings below.
const coverage = (nonces: string[], fields: (string | undefined)[]): string[] =>
  nonces.filter(nc => fields.some(f => typeof f === "string" && f.includes(nc)));

// PER-FRAME attribution: does each frame carry exactly ONE message, and each message land in exactly
// one frame? This is the reading that licenses "read the text off the frame", and it is NOT implied by
// coverage — this probe's first run scored 3/3 coverage on a batch the engine had COLLAPSED into two
// rows, one of which held two envelopes. Reporting that coverage as attribution is the error this
// helper exists to make impossible: the bijection is asserted, never inferred from a total.
const ENVELOPE_OPEN = /<cross-session-message\s/g;
const envelopeCount = (s: string | undefined): number =>
  typeof s === "string" ? (s.match(ENVELOPE_OPEN) ?? []).length : 0;
interface Bijection { ok: boolean; perFrame: number[]; multi: number; unclaimed: string[]; shared: string[]; }
const bijection = (nonces: string[], fields: (string | undefined)[]): Bijection => {
  const perFrame = fields.map(f => nonces.filter(nc => typeof f === "string" && f.includes(nc)).length);
  const claims = (nc: string) => fields.filter(f => typeof f === "string" && f.includes(nc)).length;
  const unclaimed = nonces.filter(nc => claims(nc) === 0);
  const shared = nonces.filter(nc => claims(nc) > 1);
  return {
    ok: fields.length === nonces.length && perFrame.every(n => n === 1) && !unclaimed.length && !shared.length,
    perFrame, multi: perFrame.filter(n => n > 1).length, unclaimed, shared,
  };
};

interface Attempt {
  tag: string; sessionId: string; sent: Sent[]; live: LiveArrival[]; peerTurns: number;
  batched: boolean; noncesAnswered: string[]; persisted: Map<string, any>; rowsWithPeerOrigin: any[];
}

async function runAttempt(tag: string, mode: "sequential" | "one-write", ourAddr: string): Promise<Attempt> {
  const S = start(tag);
  if (!await until(() => Boolean(S.init), 180_000)) { log(`[${tag}] receiver never emitted init`); process.exit(3); }
  log(`[${tag}] session ${S.sessionId}`);
  if (!await until(() => S.results.length >= 1, 300_000)) { log(`[${tag}] primer turn never completed — the receiver was never idle`); process.exit(4); }
  await wait(2000);

  const resultsAtMark = S.results.length;
  const sent: Sent[] = [];
  for (let i = 1; i <= N; i++) {
    const nonce = `P121-${RUN}-${tag.toUpperCase()}-M${i}`;
    sent.push({ n: i, nonce, msgId: randomUUID(), body: bodyFor(nonce, i) });
  }
  log(`[${tag}] sending ${N} (${mode}) -> ${(await deliver(S, ourAddr, sent, mode)).join(",")}`);

  // POSITIVE terminal, LEG 5's: every message asked for its own check code back, so all N answers existing
  // is proof all N TEXTS reached the model — the claim that survives whatever the attribution does.
  await until(() => sent.every(m => S.text.some(t => t.includes(m.nonce))), 900_000);
  const noncesAnswered = sent.filter(m => S.text.some(t => t.includes(m.nonce))).map(m => m.nonce);

  // Quiescence, not a count: a bare ">= 1 new result" would stop at the first turn and could not tell a
  // batch from a run that simply had not produced its second turn yet.
  let last = -1, changed = Date.now();
  const deadline = Date.now() + 420_000;
  while (Date.now() < deadline) {
    if (S.results.length !== last) { last = S.results.length; changed = Date.now(); }
    else if (Date.now() - changed > 45_000) break;
    await wait(2000);
  }
  const peerTurns = S.results.length - resultsAtMark;
  const live = [...S.arrivals];

  // The rows are read only after every live uuid has reached disk (or a deadline says it never will) —
  // reading at quiescence alone races the engine's own write.
  await until(() => {
    const rows = transcriptRows(S.sessionId);
    return live.length > 0 && live.every(a => rows.some((r: any) => r?.uuid === a.uuid));
  }, 180_000);
  const rows = transcriptRows(S.sessionId);
  const persisted = new Map<string, any>();
  for (const a of live) { const r = rows.find((x: any) => x?.uuid === a.uuid); if (r) persisted.set(a.uuid, r); }
  const rowsWithPeerOrigin = rows.filter((r: any) => r?.origin?.kind === "peer");

  const disp = dispositionLines(S.sessionId).slice(-6);
  for (const l of disp) console.log("        ", l.trim().slice(0, 200));
  log(`[${tag}] live arrivals=${live.length} peer-caused turns=${peerTurns} rows=${rows.length} peer-origin rows=${rowsWithPeerOrigin.length}`);
  return { tag, sessionId: S.sessionId, sent, live, peerTurns, batched: peerTurns >= 1 && peerTurns < N, noncesAnswered, persisted, rowsWithPeerOrigin };
}

function report(A: Attempt): void {
  const nonces = A.sent.map(m => m.nonce);
  console.log(`\n--- attempt ${A.tag} (session ${A.sessionId}) ---`);
  console.log(`sent: ${A.sent.map(m => `${m.nonce}[len=${m.body.length}]`).join("  ")}`);
  console.log(`live arrivals: ${A.live.length} | peer-caused turns: ${A.peerTurns} | BATCH FORMED: ${A.batched ? "YES" : "NO"}`);
  console.log(`nonces the model answered: ${A.noncesAnswered.length}/${N}${A.noncesAnswered.length < N ? ` (${nonces.filter(n => !A.noncesAnswered.includes(n)).join(",")} unanswered)` : ""}`);
  console.log(`persisted rows found by uuid: ${A.persisted.size}/${A.live.length} | rows with origin.kind='peer' in the file: ${A.rowsWithPeerOrigin.length}`);

  for (const a of A.live) {
    const p = A.persisted.get(a.uuid);
    const pBody = typeof p?.origin?.body === "string" ? p.origin.body : undefined;
    const pMsgId = p?.origin?.msg_id === undefined ? "(none)" : String(p.origin.msg_id);
    const pContent = p ? contentText(p.message?.content) : undefined;
    console.log(`\n  arrival #${a.order}  uuid=${a.uuid}`);
    console.log(`    LIVE      msg_id=${a.msgId}`);
    console.log(`              origin.body      len=${a.body === undefined ? "-" : a.body.length}  ${prefix(a.body)}`);
    console.log(`              message.content  len=${a.content.length}  ${prefix(a.content)}`);
    if (!p) { console.log(`    PERSISTED (no row with this uuid on disk)`); continue; }
    console.log(`    PERSISTED msg_id=${pMsgId}   origin.kind=${p?.origin?.kind ?? "(none)"}`);
    console.log(`              origin.body      len=${pBody === undefined ? "-" : pBody.length}  ${prefix(pBody)}`);
    console.log(`              message.content  len=${pContent === undefined ? "-" : pContent.length}  ${prefix(pContent)}`);
    console.log(`    EQUAL live==persisted: msg_id=${a.msgId === pMsgId} origin.body=${a.body === pBody} message.content=${a.content === pContent}`);
  }

  const liveBodies = A.live.map(a => a.body), liveContents = A.live.map(a => a.content);
  const persistedBodies = A.live.map(a => { const b = A.persisted.get(a.uuid)?.origin?.body; return typeof b === "string" ? b : undefined; });
  const persistedContents = A.live.map(a => { const p = A.persisted.get(a.uuid); return p ? contentText(p.message?.content) : undefined; });
  const liveMsgIds = A.live.map(a => a.msgId);
  const persistedMsgIds = A.live.map(a => { const v = A.persisted.get(a.uuid)?.origin?.msg_id; return v === undefined ? undefined : String(v); });

  const rowsOf = (label: string, xs: (string | undefined)[]) =>
    console.log(`  ${label.padEnd(26)} distinct=${distinct(xs)}/${xs.length}  nonces recoverable=${coverage(nonces, xs).length}/${N}  [${coverage(nonces, xs).map(n => n.split("-").pop()).join(",") || "none"}]`);
  console.log(`\n  == counts over ${A.live.length} arrival(s), ${N} sent ==`);
  rowsOf("LIVE origin.msg_id", liveMsgIds);
  rowsOf("LIVE origin.body", liveBodies);
  rowsOf("LIVE message.content", liveContents);
  rowsOf("PERSISTED origin.msg_id", persistedMsgIds);
  rowsOf("PERSISTED origin.body", persistedBodies);
  rowsOf("PERSISTED message.content", persistedContents);
  console.log(`  distinct arrival uuids: ${distinct(A.live.map(a => a.uuid))}/${A.live.length}`);
}

function verdict(A: Attempt): void {
  const nonces = A.sent.map(m => m.nonce);
  const persistedBodies = A.live.map(a => { const b = A.persisted.get(a.uuid)?.origin?.body; return typeof b === "string" ? b : undefined; });
  const persistedContents = A.live.map(a => { const p = A.persisted.get(a.uuid); return p ? contentText(p.message?.content) : undefined; });
  const liveBodies = A.live.map(a => a.body);
  const liveContents = A.live.map(a => a.content);

  const bodyCov = coverage(nonces, persistedBodies).length;
  const contentCov = coverage(nonces, persistedContents).length;
  const liveBodyCov = coverage(nonces, liveBodies).length;
  const liveContentCov = coverage(nonces, liveContents).length;

  console.log(`\n=== VERDICT (probe 121) ===`);
  if (!A.batched) {
    console.log(`NOT ANSWERED — ${A.peerTurns} peer-caused turn(s) for ${N} messages: no batch formed, so nothing here`
      + ` describes what a batched arrival persists. Do not read the table above as an answer.`);
    return;
  }
  console.log(`batch confirmed LEG 5's way: ${A.peerTurns} turn(s) < ${N} messages, ${A.live.length} live arrival(s) with ${distinct(A.live.map(a => a.uuid))} distinct uuid(s).`);
  console.log(`LEG 5's live finding reproduces: ${liveBodyCov === 1 && distinct(A.live.map(a => a.msgId)) === A.peerTurns ? "YES" : "NO"}`
    + `  (live origin.body recovers ${liveBodyCov}/${N} nonces; live message.content recovers ${liveContentCov}/${N}; distinct live msg_ids=${distinct(A.live.map(a => a.msgId))}, turns=${A.peerTurns})`);

  // THE GATE. A and B both mean "read the text off this field, per frame", so both REQUIRE a bijection
  // between frames and messages. Coverage alone cannot license either: a single frame holding every
  // envelope scores full coverage while attributing nothing. Measured on the first run — two persisted
  // rows for three sent messages, one row carrying two envelopes — so this is a corrected verdict, not
  // a hypothetical guard.
  const bodyBij = bijection(nonces, persistedBodies);
  const contentBij = bijection(nonces, persistedContents);
  const envPerRow = A.live.map(a => envelopeCount(A.persisted.get(a.uuid) ? contentText(A.persisted.get(a.uuid).message?.content) : undefined));
  console.log(`\nPER-FRAME ATTRIBUTION (what A and B actually require):`);
  console.log(`  persisted rows for ${A.live.length} live arrival(s): ${A.persisted.size}`);
  console.log(`  envelope open tags per persisted row: [${envPerRow.join(", ")}]   (>1 means one frame carries several messages)`);
  console.log(`  origin.body      bijection=${bodyBij.ok}  frames carrying >1 message=${bodyBij.multi}  unclaimed=${bodyBij.unclaimed.length}  shared=${bodyBij.shared.length}`);
  console.log(`  message.content  bijection=${contentBij.ok}  frames carrying >1 message=${contentBij.multi}  unclaimed=${contentBij.unclaimed.length}  shared=${contentBij.shared.length}`);

  const which = (bodyCov === N && bodyBij.ok) ? "A" : (contentCov === N && contentBij.ok) ? "B" : "C";
  console.log(`\nOUTCOME ${which}: ` + (which === "A"
    ? `persisted rows carry PER-MESSAGE origin.body — all ${N} nonces are recoverable from origin.body alone, so disk is faithful where the live frame is not and a history feature may read origin.body.`
    : which === "B"
      ? `persisted origin.body recovers only ${bodyCov}/${N} nonces, but each row's own message.content recovers ${contentCov}/${N} — the text survives ONLY in the raw envelope, which is NOT what peerArrival prefers.`
      : `NO per-frame attribution survives. Aggregate coverage is origin.body ${bodyCov}/${N} and message.content ${contentCov}/${N}, but the bijection fails`
        + `${contentBij.multi ? ` — ${contentBij.multi} frame(s) carry more than one message` : ""}`
        + `${A.persisted.size < A.live.length ? `, and ${A.live.length - A.persisted.size} live arrival(s) have no persisted row at all` : ""}`
        + `. A batch is COLLAPSED: several messages land in one frame under one uuid, so no reader can say which message an arrival uuid names. `
        + `A history feature must MARK batched arrivals ambiguous rather than render them, and switching peerArrival to prefer the envelope would not help — the first envelope in a multi-envelope frame is just a different arbitrary member.`));

  console.log(`\nWHAT WOULD FALSIFY THIS:`);
  console.log(`  * a batch of a different SHAPE. This is one burst of ${N} on one idle receiver at one priority`);
  console.log(`    ("next"). A batch formed while the receiver was mid-tool-call, or at "now"/"later", or with`);
  console.log(`    more messages than the engine folds into one call, may attribute differently.`);
  console.log(`  * a later read. The rows were read once every live uuid was on disk; an engine that REWRITES a`);
  console.log(`    row after the turn settles would make this a snapshot of an intermediate state.`);
  console.log(`  * the uuid join. Live and persisted are matched by uuid, so if the engine reused a uuid across`);
  console.log(`    two arrivals the pairing above is wrong — read as distinct uuids=${distinct(A.live.map(a => a.uuid))}/${A.live.length}.`);
  if (A.persisted.size < A.live.length) console.log(`  * ${A.live.length - A.persisted.size} live arrival(s) had NO row on disk at all — for those the question is moot in a fourth way the three outcomes do not name.`);
  console.log(`  * a different engine build. Measured on the CLI in this environment today; LEG 5's live finding`);
  console.log(`    was measured on 2.1.237.`);
}

(async () => {
  // Our reply address: bound, in the RECEIVER's socket namespace, and vouched by a key file (117b/118).
  const probeSess = start("addr-probe");
  if (!await until(() => Boolean(probeSess.init), 180_000)) { log("could not bring up a receiver to read the socket namespace"); process.exit(3); }
  const nsDir = dirname((probeSess.init as any).messaging_socket_path as string);
  const ourSock = join(nsDir, `p121-${process.pid}.sock`);
  try { unlinkSync(ourSock); } catch { /* fresh */ }
  const receipts: string[] = [];
  const srv = createServer(c => {
    c.setEncoding("utf8");
    c.on("data", d => { for (const l of String(d).split("\n")) if (l.trim()) receipts.push(l.trim()); });
    c.on("error", () => { /* peer hung up */ });
  });
  await new Promise<void>(r => srv.listen(ourSock, () => r()));
  srv.unref();
  const ourAddr = `uds:${ourSock}`;
  const lstart = (() => { try { return execFileSync("ps", ["-o", "lstart=", "-p", String(process.pid)], { encoding: "utf8", env: { ...process.env, LC_ALL: "C", TZ: "UTC" } }).trim(); } catch { return undefined; } })();
  const keyPath = join(SESSIONS_DIR, `${process.pid}.${createHash("sha256").update(ourSock).digest("hex")}.key`);
  writeFileSync(keyPath, JSON.stringify({ peerToken: createHash("sha256").update(`p121-${process.pid}`).digest("hex").slice(0, 32), procStart: lstart }, null, 2), { mode: 0o600 });
  log("our peer address:", ourAddr, "| run:", RUN);

  const attempts: Attempt[] = [];
  attempts.push(await runAttempt("seq", "sequential", ourAddr));
  if (!attempts[0].batched) {
    log(`attempt 1 produced ${attempts[0].peerTurns} turns for ${N} messages — NOT a batch. Retrying on a fresh receiver with all frames in one write.`);
    attempts.push(await runAttempt("burst", "one-write", ourAddr));
  }

  for (const A of attempts) report(A);
  const answering = attempts.find(A => A.batched) ?? attempts[attempts.length - 1];
  verdict(answering);
  console.log(`\nreceipts on our address: ${receipts.length}`);

  try { unlinkSync(keyPath); } catch { /* gone */ }
  try { unlinkSync(ourSock); } catch { /* gone */ }
  process.exit(0);
})();
