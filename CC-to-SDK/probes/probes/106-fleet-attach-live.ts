// Probe 106 — the five ccx host-wire facts the M3 fleet/workspace app-server layer is being built on.
//
// M3 makes the app server a CLIENT of the ccx host socket: a fleet thread is a raw NDJSON peer of a
// detached `SessionHost`, and every adapter decision (how to rebuild a joining client's view, how to
// report a decision that somebody else answered, how to tell a stop from a crash) is a claim about that
// wire. All five claims below are currently READ OFF THE SOURCE (host.ts:513-546 for the replay order,
// server.ts's dispatch arms for the receipts). Source is a statement of intent; a live run is evidence.
//
//   Q1 REPLAY ORDER on a mid-turn attach. host.ts's follow() documents: `turn start` (only when a turn is
//      in flight) → buffered `message` frames marked `replay:true` → parked `decision` entries → the
//      background-task snapshot → `state` LAST. Two attaches measure it: one mid-turn with nothing parked,
//      one while a decision is parked (the only way the `decision` position is observable at all).
//   Q2 THE RESULT FRAME. runTask fans every session message out as `{kind:"message"}`, which implies the
//      SDK's terminal `type:"result"` message reaches a follower the same way — implied, never observed.
//      An adapter that maps turn completion off the result frame needs that to be true, and needs to know
//      whether it lands before or after `{kind:"turn",phase:"end"}`.
//   Q3 THE THREE `answer` RECEIPTS, verbatim. Lost race (`{ok:true,alreadyAnsweredBy}`), kind mismatch
//      (`{ok:false,error:"kind mismatch: …"}`), and an unknown toolUseID (`{ok:false,error:"no parked
//      request …"}`) are three DIFFERENT outcomes that a client must not collapse: `ok:true` with an
//      attribution means "somebody else already decided", not "your answer landed".
//   Q4 `decision_settled` ATTRIBUTION + the new `answer` field (M3 §1a-e, this session's code): does the
//      whole outcome object travel beside `by` and the bare `decision` kind — including a payload
//      (deny.feedback) that the kind string alone drops?
//   Q5 `stop` RECEIPT vs SOCKET CLOSE. server.ts awaits handlers.stop() — which tears the host down and
//      destroys every open socket — BEFORE it writes the reply. So the expectation is: no reply ever
//      arrives, the sockets die first. If that holds, a client that awaits its stop reply waits forever,
//      and the app server's stop path must key on the close, not on a receipt.
//
// METHOD. Spawn a real detached host through the CLI's own seam (`spawnDetached`, with process.argv[1]
// pointed at the harness bin — the value it carries in production), against a scratch cwd and a scratch
// CCX_FLEET_ROOT so the run never touches the real fleet. Then dial the UDS socket raw (node:net +
// NDJSON) from THREE independent clients and drive the phases below. Nothing here imports the SDK: the
// subject is the wire, and a probe that spoke it through the harness's own client would be measuring the
// client instead.
//
// RUN IT (keyed — the turns are real):
//   cd CC-to-SDK/probes && set -a; . ../.env; set +a; npx tsx probes/106-fleet-attach-live.ts
// Keyless it will spawn and connect fine and then fail at the first turn — which is a FAILURE, not a
// skip: this probe has nothing to say without a live engine.
import { mkdirSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createConnection } from "node:net";
import type { Socket } from "node:net";
import { fileURLToPath } from "node:url";

const HARNESS = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "harness");

// Two clocks, deliberately. WIRE_MS bounds anything the HOST answers by itself (a reply, an event it
// emits synchronously, a socket close) — 30s there is already pathological. TURN_MS bounds anything a
// MODEL has to do first (a tool call, a park, a turn ending); a turn is minutes-scale by design, so
// holding it to the wire budget would report the model being slow as a wire defect.
const WIRE_MS = 30_000;
const TURN_MS = 120_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const at = () => `+${((Date.now() - t0) / 1000).toFixed(1)}s`;
const log = (s: string) => console.log(`${at()} ${s}`);
const dump = (label: string, v: unknown) => console.log(`  ${label}: ${JSON.stringify(v)}`);

/** Everything the VERDICT block prints, in question order. Filled as each phase measures. */
const verdict: Record<string, string> = {
  Q1_replay_order_midturn: "NOT MEASURED",
  Q1_replay_order_parked: "NOT MEASURED",
  Q2_result_frame: "NOT MEASURED",
  Q3_receipt_lost_race: "NOT MEASURED",
  Q3_receipt_kind_mismatch: "NOT MEASURED",
  Q3_receipt_no_parked: "NOT MEASURED",
  Q4_decision_settled: "NOT MEASURED",
  Q5_stop_vs_close: "NOT MEASURED",
};
/** Anything that makes a verdict line unearned. Non-empty ⇒ exit 1, so the controller sees failure
 *  loudly instead of reading a half-measured verdict as a result. */
const problems: string[] = [];
const fail = (s: string) => { problems.push(s); console.log(`  !! ${s}`); };

interface Frame { i: number; atMs: number; tag: string; raw: Record<string, unknown> }

/** Every client this run dialed, so an ABORT can dump what each of them actually received. A probe that
 *  reports only "X never arrived within Nms" tells the next reader nothing about what DID arrive, which
 *  is the whole of the diagnosis when a live run stops somewhere unexpected. */
const clients: HostClient[] = [];

/** One raw NDJSON peer of the host socket. Frames arrive interleaved: server-pushed events carry
 *  `t:"event"`, replies carry the `id` we sent (and nothing else identifies them), so both are recorded
 *  in ONE ordered list — the order between them is itself a finding (Q1: where the `follow` reply lands
 *  relative to the replay burst; Q5: whether the `stop` reply lands at all). */
class HostClient {
  private sock!: Socket;
  private buf = "";
  private nextId = 1;
  private pending = new Map<number, (body: Record<string, unknown>) => void>();
  readonly frames: Frame[] = [];
  closedAtMs?: number;
  /** Fired for every event frame; used for "wait until X arrives" and for the park auto-drain. */
  private watchers = new Set<(f: Frame) => void>();

  constructor(readonly name: string) { clients.push(this); }

  async connect(socketPath: string): Promise<void> {
    this.sock = createConnection(socketPath);
    await new Promise<void>((res, rej) => {
      const onErr = (e: Error) => rej(new Error(`${this.name}: connect failed: ${e.message}`));
      this.sock.once("error", onErr);
      this.sock.once("connect", () => { this.sock.off("error", onErr); res(); });
    });
    this.sock.on("error", () => { /* a host that tore the socket down under us is a measurement, not a throw */ });
    this.sock.once("close", () => { this.closedAtMs = Date.now() - t0; });
    this.sock.on("data", (chunk) => {
      this.buf += chunk.toString("utf8");
      for (let nl = this.buf.indexOf("\n"); nl >= 0; nl = this.buf.indexOf("\n")) {
        const line = this.buf.slice(0, nl); this.buf = this.buf.slice(nl + 1);
        if (!line.trim()) continue;
        let raw: Record<string, unknown>;
        try { raw = JSON.parse(line) as Record<string, unknown>; }
        catch { fail(`${this.name}: unparseable line ${JSON.stringify(line.slice(0, 120))}`); continue; }
        const f: Frame = { i: this.frames.length, atMs: Date.now() - t0, tag: tagOf(raw), raw };
        this.frames.push(f);
        if (raw["t"] === "event") for (const w of [...this.watchers]) w(f);
        else {
          const id = typeof raw["id"] === "number" ? (raw["id"] as number) : undefined;
          const r = id === undefined ? undefined : this.pending.get(id);
          if (r) { this.pending.delete(id); r(raw); }
        }
      }
    });
  }

  /** Send one op and resolve with its reply body. Rejects on timeout — an unanswered op is a finding
   *  everywhere except `stop`, which is why `send` is never used for that one (see fireAndForget). */
  async send(op: Record<string, unknown>, ms = WIRE_MS): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    const p = new Promise<Record<string, unknown>>((res, rej) => {
      this.pending.set(id, res);
      setTimeout(() => { if (this.pending.delete(id)) rej(new Error(`${this.name}: no reply to ${String(op["op"])} within ${ms}ms`)); }, ms).unref?.();
    });
    this.sock.write(JSON.stringify({ ...op, id }) + "\n");
    return p;
  }

  /** Fire an op and hand back its id WITHOUT waiting — the only honest way to ask a question whose whole
   *  point is "does a reply ever arrive?" */
  fireAndForget(op: Record<string, unknown>): number {
    const id = this.nextId++;
    this.sock.write(JSON.stringify({ ...op, id }) + "\n");
    return id;
  }

  replyFor(id: number): Frame | undefined { return this.frames.find((f) => f.raw["t"] !== "event" && f.raw["id"] === id); }

  /** Resolve with the first event frame matching `pred` — including one that ALREADY arrived, so a
   *  caller can never lose a race against a frame that landed while it was doing something else. */
  waitEvent(label: string, pred: (raw: Record<string, unknown>) => boolean, ms: number): Promise<Frame> {
    const seen = this.frames.find((f) => f.raw["t"] === "event" && pred(f.raw));
    if (seen) return Promise.resolve(seen);
    return new Promise<Frame>((res, rej) => {
      const w = (f: Frame) => { if (pred(f.raw)) { this.watchers.delete(w); res(f); } };
      this.watchers.add(w);
      setTimeout(() => { if (this.watchers.delete(w)) rej(new Error(`${this.name}: ${label} never arrived within ${ms}ms`)); }, ms).unref?.();
    });
  }

  watch(w: (f: Frame) => void): () => void { this.watchers.add(w); return () => this.watchers.delete(w); }
  events(kind: string): Frame[] { return this.frames.filter((f) => f.raw["t"] === "event" && f.raw["kind"] === kind); }
  destroy(): void { this.sock?.destroy(); }
}

/** A one-line identity for a frame, dense enough to read a whole replay burst as a sequence. Message
 *  frames carry the SDK message's own `type`/`subtype`, because "the buffered replay" and "the result
 *  frame" are both claims about WHICH messages travel as `{kind:"message"}`. */
function tagOf(raw: Record<string, unknown>): string {
  if (raw["t"] !== "event") return `reply(id=${String(raw["id"] ?? "-")},ok=${String(raw["ok"])})`;
  const kind = String(raw["kind"]);
  if (kind !== "message") {
    const extra = kind === "turn" ? `:${String(raw["phase"])}` : kind === "decision_settled" ? `:${String(raw["decision"])}` : "";
    return `event:${kind}${extra}`;
  }
  const d = (raw["data"] ?? {}) as Record<string, unknown>;
  const sub = d["subtype"] ? `/${String(d["subtype"])}` : "";
  return `event:message(${String(d["type"])}${sub})${raw["replay"] ? ",replay" : ""}`;
}

/** The replay burst a follower is handed: every frame up to and INCLUDING the first `state` event, which
 *  host.ts documents as the last thing follow() delivers before live relaying starts. The `follow` reply
 *  is included wherever it lands — its position is part of the answer. */
function replayBlock(c: HostClient): Frame[] {
  const end = c.frames.findIndex((f) => f.raw["t"] === "event" && f.raw["kind"] === "state");
  return end < 0 ? c.frames.slice() : c.frames.slice(0, end + 1);
}
function printBlock(label: string, block: Frame[]): void {
  console.log(`  ${label} (${block.length} frames):`);
  for (const f of block) console.log(`    [${String(f.i).padStart(2)}] +${(f.atMs / 1000).toFixed(1)}s ${f.tag}`);
}

// ---------------------------------------------------------------------------------------------------
// Phase 0 — a real detached host, on scratch everything.
// ---------------------------------------------------------------------------------------------------
console.log("=== PROBE 106 ccx host wire: replay order, result frame, answer receipts, settled attribution, stop/close ===");
const root = mkdtempSync(join(tmpdir(), "p106-"));
const scratchCwd = join(root, "cwd");
const fleetRoot = join(root, "fleet");
mkdirSync(scratchCwd); mkdirSync(fleetRoot);
// Inherited by the spawned child (spawnDetached forwards process.env), so the roster row, the socket and
// every `ccx` artifact of this run live under `root` and die with it.
process.env.CCX_FLEET_ROOT = fleetRoot;
log(`scratch root ${root}`);

const { spawnDetached } = await import(join(HARNESS, "src", "cli", "spawn.ts"));
const { hostSocketPath } = await import(join(HARNESS, "src", "fleet", "paths.ts"));
const { readRoster, TERMINAL } = await import(join(HARNESS, "src", "fleet", "roster.ts"));

let short = "";
let hostPid = 0;
let stopSent = false;

try {
  // spawnDetached builds the child's argv as [...execArgv, process.argv[1], "--__host", …] — argv[1] IS
  // the binary in production. Under tsx it is this probe, so point it at the harness bin for the call and
  // put it back: the child then re-enters the real CLI, with tsx's loader riding execArgv exactly as the
  // seam's own comment describes for a dev run.
  const argv1 = process.argv[1];
  process.argv[1] = join(HARNESS, "src", "cli", "bin.ts");
  const spawned = spawnDetached({
    command: "run", bg: false, detachable: true, print: false, json: false, all: false,
    continue: false, version: false, help: false, name: "p106",
    listen: { host: "127.0.0.1", port: 0 }, allowOrigins: [],
    // A backstop, not a mechanism: every path below ends with an explicit `stop`. If this probe dies
    // between spawn and stop, the host reaps itself instead of outliving the run.
    idleTimeoutSec: 600,
    config: {
      cwd: scratchCwd,
      // LAUNCH-time bypass, because a runtime upgrade to it is engine-refused (M2b run-1). Phase 1 needs a
      // turn that CANNOT park (the replay order is the subject, and a park would end the turn early);
      // phase 4 downgrades to `default` over the wire, which is the direction that works.
      permissionMode: "bypassPermissions",
      model: "claude-sonnet-4-6",
      // Insurance for the park phase only. The harness loads user+project+local settings by default, and a
      // developer's own allowlist can pre-authorize the command the park depends on (the M1 live test's
      // scar). An `ask` rule cannot make phase 1 park — bypassPermissions never consults the broker at all.
      settings: { permissions: { ask: ["Bash(*)"] } },
    },
  });
  process.argv[1] = argv1;
  short = spawned.short;
  log(`spawned detached host ${short} — banner ${JSON.stringify(spawned.banner)}`);

  // The row is written inside start(), before the session opens; the socket follows immediately after.
  let row: { pid: number; state: string } | undefined;
  for (let i = 0; i < 120 && !row; i++) { row = readRoster(short); if (!row) await sleep(250); }
  if (!row) throw new Error(`host ${short} never wrote a roster row`);
  hostPid = row.pid;
  const socketPath = hostSocketPath(hostPid);
  for (let i = 0; i < 120 && !existsSync(socketPath); i++) await sleep(250);
  if (!existsSync(socketPath)) throw new Error(`host ${short} (pid ${hostPid}) never opened ${socketPath}`);
  log(`roster row + socket up: pid=${hostPid} ${socketPath}`);

  // -------------------------------------------------------------------------------------------------
  // Phase 1 — client A follows from BEFORE the turn, then drives a real multi-step, wall-clock turn.
  // -------------------------------------------------------------------------------------------------
  const A = new HostClient("A");
  await A.connect(socketPath);
  const idleFollow = await A.send({ op: "follow" });
  log(`A followed an IDLE host — reply ${JSON.stringify(idleFollow)}`);
  printBlock("A idle-attach replay", replayBlock(A));
  dump("A status", await A.send({ op: "status" }));

  // Sequential sleeps, not a long prompt: the turn has to occupy real WALL-CLOCK time or there is no
  // mid-turn to attach into (probe 103b's lesson — a verbose prompt finishes in one burst).
  const promptReply = await A.send({
    op: "prompt",
    text: "Run these three bash commands one at a time, in order, waiting for each to finish before starting the next: "
      + "(1) `sleep 2 && echo p106-step-1`  (2) `sleep 2 && echo p106-step-2`  (3) `sleep 2 && echo p106-step-3`. "
      + "Use the Bash tool for each. Then reply with exactly: DONE",
  });
  log(`A prompt accepted — ${JSON.stringify(promptReply)}`);
  if (promptReply["ok"] !== true) throw new Error(`prompt refused: ${JSON.stringify(promptReply)}`);

  // -------------------------------------------------------------------------------------------------
  // Phase 2 (Q1a) — attach MID-TURN, with real buffered content behind us and nothing parked.
  // -------------------------------------------------------------------------------------------------
  // Attach as late as is SAFE, not as late as is interesting. The first assistant frame is the gate:
  // it means the engine is up and has committed to a tool call, so there is real buffered content and
  // (with two `sleep 2` steps still to come) plenty of turn left. The tool RESULT after it makes the
  // replay richer, so it is waited for — but only briefly, and its absence is not a failure: a model
  // that batched the three commands into one call would otherwise leave us attaching after the turn.
  await A.waitEvent("turn-1 first assistant frame", (r) => r["kind"] === "message" && ((r["data"] as Record<string, unknown>)?.["type"] === "assistant"), TURN_MS);
  await A.waitEvent("turn-1 first tool result", (r) => r["kind"] === "message" && ((r["data"] as Record<string, unknown>)?.["type"] === "user"), 10_000)
    .catch(() => { log("no tool result within 10s of the first assistant frame — attaching anyway; the replay will be thinner"); return undefined; });
  const midStatus = await A.send({ op: "status" });
  log(`mid-turn reached — status ${JSON.stringify(midStatus)}`);
  if (midStatus["status"] !== "busy") fail(`expected a busy host at the mid-turn attach, got ${JSON.stringify(midStatus)}`);

  const B = new HostClient("B");
  await B.connect(socketPath);
  const bFollow = B.fireAndForget({ op: "follow" });
  await B.waitEvent("B replay tail (state)", (r) => r["kind"] === "state", WIRE_MS);
  await sleep(250);                     // let the follow reply land wherever it lands
  const bBlock = replayBlock(B);
  console.log("");
  log("Q1a MID-TURN ATTACH (nothing parked)");
  printBlock("B replay burst", bBlock);
  const bTags = bBlock.map((f) => f.tag);
  const bFollowIdx = bBlock.findIndex((f) => f.raw["t"] !== "event" && f.raw["id"] === bFollow);
  const bReplayCount = bBlock.filter((f) => f.raw["replay"] === true).length;
  const bStartsWithTurn = bTags[0]?.startsWith("event:turn:start") ?? false;
  const bEndsWithState = bTags[bTags.length - 1] === "event:state";
  // Between the opening `turn start` and the closing `state`, only replayed messages belong — plus the
  // two frames the documented order also permits there (a background-task snapshot, and the `follow`
  // reply itself, wherever the server happens to write it).
  const bMsgsBeforeState = bTags.slice(1, -1).every((t) => t.startsWith("event:message") || t.startsWith("reply(") || t === "event:tasks_changed");
  dump("B follow reply position in the burst", { index: bFollowIdx, ofFrames: bBlock.length, note: bFollowIdx < 0 ? "reply landed AFTER the state frame" : "reply landed inside the burst" });
  dump("B replay-marked frames", bReplayCount);
  verdict.Q1_replay_order_midturn = `${bStartsWithTurn && bEndsWithState && bMsgsBeforeState ? "AS DOCUMENTED" : "DIVERGED"} — ${bTags.join(" → ")}`;
  if (!bStartsWithTurn) fail("mid-turn attach did not open with {kind:'turn',phase:'start'}");
  if (!bEndsWithState) fail("mid-turn attach replay did not end with {kind:'state'}");
  if (bReplayCount === 0) fail("mid-turn attach replayed zero frames marked replay:true");

  // -------------------------------------------------------------------------------------------------
  // Phase 3 (Q2) — does the SDK's terminal `result` message travel as {kind:"message"}?
  // -------------------------------------------------------------------------------------------------
  const endA = await A.waitEvent("turn-1 end", (r) => r["kind"] === "turn" && r["phase"] === "end", TURN_MS);
  const resultFrames = A.frames.filter((f) => f.raw["t"] === "event" && f.raw["kind"] === "message"
    && ((f.raw["data"] as Record<string, unknown>)?.["type"] === "result"));
  console.log("");
  log("Q2 RESULT FRAME");
  dump("turn end event", endA.raw);
  if (resultFrames.length) {
    const rf = resultFrames[resultFrames.length - 1];
    const d = rf.raw["data"] as Record<string, unknown>;
    dump("result frame envelope", { kind: rf.raw["kind"], replay: rf.raw["replay"] ?? null, index: rf.i, beforeTurnEnd: rf.i < endA.i });
    dump("result frame payload keys", Object.keys(d).sort());
    dump("result frame summary", { type: d["type"], subtype: d["subtype"], is_error: d["is_error"], num_turns: d["num_turns"], duration_ms: d["duration_ms"], session_id: d["session_id"] });
    verdict.Q2_result_frame = `YES — {kind:"message"} carries data.type="result" (subtype=${String(d["subtype"])}, is_error=${String(d["is_error"])}), and it arrives ${rf.i < endA.i ? "BEFORE" : "AFTER"} {kind:"turn",phase:"end"}`;
  } else {
    verdict.Q2_result_frame = "NO — no {kind:'message'} frame carried data.type='result'";
    fail("no result-type message frame reached a follower");
  }
  // Volume, for the record: an app-server adapter fans every one of these out again.
  const partials = A.frames.filter((f) => f.tag.startsWith("event:message(stream_event")).length;
  dump("A frame census (turn 1)", { total: A.frames.length, partials, nonPartialMessages: A.events("message").length - partials });

  // -------------------------------------------------------------------------------------------------
  // Phase 4 — downgrade to `default` and park a real permission decision.
  // -------------------------------------------------------------------------------------------------
  console.log("");
  dump("set_permission_mode default", await A.send({ op: "set_permission_mode", mode: "default" }));
  const turn2 = await A.send({
    op: "prompt",
    text: "Run exactly one bash command: `sleep 2 && echo p106-park-marker`. Use the Bash tool. Then reply with exactly: DONE",
  });
  log(`turn 2 accepted — ${JSON.stringify(turn2)}`);
  if (turn2["ok"] !== true) throw new Error(`turn 2 refused: ${JSON.stringify(turn2)}`);

  const parkFrame = await A.waitEvent("a parked decision", (r) => r["kind"] === "decision", TURN_MS)
    .catch((e: Error) => { throw new Error(`${e.message} — the turn ran without ever consulting the broker; a settings layer probably pre-authorized Bash (see the launch \`ask\` rule above)`); });
  const entry = parkFrame.raw["entry"] as Record<string, unknown>;
  const toolUseID = String(entry["toolUseID"]);
  const parkKind = String(entry["kind"]);
  console.log("");
  log("PARK ESTABLISHED");
  dump("decision entry", { toolUseID, kind: parkKind, toolName: entry["toolName"], input: entry["input"], suggestions: entry["suggestions"], decisionReason: entry["decisionReason"] });
  dump("status while parked", await A.send({ op: "status" }));

  // -------------------------------------------------------------------------------------------------
  // Phase 5 (Q1b) — a THIRD client attaches WHILE the decision is parked. The only way the `decision`
  // position in the replay order is observable at all.
  // -------------------------------------------------------------------------------------------------
  const C = new HostClient("C");
  await C.connect(socketPath);
  const cFollow = C.fireAndForget({ op: "follow" });
  await C.waitEvent("C replay tail (state)", (r) => r["kind"] === "state", WIRE_MS);
  await sleep(250);
  const cBlock = replayBlock(C);
  console.log("");
  log("Q1b PARKED ATTACH");
  printBlock("C replay burst", cBlock);
  const cTags = cBlock.map((f) => f.tag);
  const iTurn = cTags.findIndex((t) => t.startsWith("event:turn:start"));
  const iLastMsg = cTags.map((t, i) => (t.startsWith("event:message") ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
  const iDecision = cTags.indexOf("event:decision");
  const iState = cTags.indexOf("event:state");
  dump("C burst positions", { turnStart: iTurn, lastReplayedMessage: iLastMsg, decision: iDecision, state: iState, followReplyIndex: cBlock.findIndex((f) => f.raw["t"] !== "event" && f.raw["id"] === cFollow) });
  const cOrdered = iTurn === 0 && iDecision > iLastMsg && iState === cTags.length - 1;
  verdict.Q1_replay_order_parked = `${cOrdered ? "AS DOCUMENTED" : "DIVERGED"} — ${cTags.join(" → ")}`;
  if (iDecision < 0) fail("a client attaching while a decision was parked was NOT replayed that decision");
  else if (!cOrdered) fail(`parked-attach replay order diverged from host.ts:513-546 — ${cTags.join(" → ")}`);
  dump("C pending op (the poll channel the replay is supposed to make unnecessary)", await C.send({ op: "pending" }));

  // -------------------------------------------------------------------------------------------------
  // Phase 6 (Q3/Q4) — the three receipts, in the ONLY order that can measure all three: both refusals
  // are only reachable while the park is still open, so they run before the answer that settles it.
  // -------------------------------------------------------------------------------------------------
  console.log("");
  log("Q3 ANSWER RECEIPTS");
  // (a) kind mismatch — an outcome from a DIFFERENT decision family than the park. Chosen off the live
  //     entry's own kind rather than hardcoded, so this measures the rule and not our guess about which
  //     family parked.
  const wrongKind: Record<string, unknown> = parkKind === "permission"
    ? { kind: "question_answer", answers: { p106: "wrong-family" } }
    : { kind: "allow_once" };
  const mismatch = await C.send({ op: "answer", toolUseID, by: "probe-C-wrongkind", answer: wrongKind });
  dump(`receipt: kind mismatch (${parkKind} park answered with ${String(wrongKind["kind"])})`, mismatch);
  verdict.Q3_receipt_kind_mismatch = JSON.stringify(mismatch);
  if (mismatch["ok"] !== false) fail(`a kind-mismatched answer was not refused: ${JSON.stringify(mismatch)}`);

  // (b) an id nothing ever parked under.
  const bogus = await B.send({ op: "answer", toolUseID: "p106-no-such-tool-use-id", by: "probe-B-bogus", answer: { kind: "allow_once" } });
  dump("receipt: unknown toolUseID", bogus);
  verdict.Q3_receipt_no_parked = JSON.stringify(bogus);
  if (bogus["ok"] !== false) fail(`an answer for an unparked id was not refused: ${JSON.stringify(bogus)}`);

  // (c) the real answer. `deny` WITH FEEDBACK on purpose: the feedback is payload that the bare
  //     `decision` kind string cannot carry, so it is what proves (or disproves) Q4's `answer` field.
  const feedback = "P106 probe: denied deliberately, to prove the payload travels";
  const winner = await A.send({ op: "answer", toolUseID, by: "probe-A-winner", answer: { kind: "deny", feedback } });
  dump("receipt: first answer (winner)", winner);
  if (winner["ok"] !== true) fail(`the first answer was refused: ${JSON.stringify(winner)}`);

  // (d) the loser of the race, same id, arriving after the park is gone.
  const loser = await B.send({ op: "answer", toolUseID, by: "probe-B-loser", answer: { kind: "deny", feedback: "second answerer" } });
  dump("receipt: second answer (lost race)", loser);
  verdict.Q3_receipt_lost_race = JSON.stringify(loser);
  if (!(loser["ok"] === true && typeof loser["alreadyAnsweredBy"] === "string")) {
    fail(`the lost race did not report {ok:true, alreadyAnsweredBy}: ${JSON.stringify(loser)}`);
  } else if (loser["alreadyAnsweredBy"] !== "probe-A-winner") {
    fail(`lost-race attribution named ${JSON.stringify(loser["alreadyAnsweredBy"])}, not the client that won`);
  }

  console.log("");
  log("Q4 decision_settled");
  const settledOn = (c: HostClient) => c.events("decision_settled").find((f) => f.raw["toolUseID"] === toolUseID);
  for (const c of [A, B, C]) {
    await c.waitEvent(`${c.name}: decision_settled`, (r) => r["kind"] === "decision_settled" && r["toolUseID"] === toolUseID, WIRE_MS)
      .catch((e: Error) => { fail(e.message); return undefined; });
  }
  const settledA = settledOn(A), settledB = settledOn(B), settledC = settledOn(C);
  dump("settled frame as A saw it", settledA?.raw ?? null);
  dump("settled frame as B saw it (the client that lost the race)", settledB?.raw ?? null);
  dump("settled frame as C saw it (the client that never answered)", settledC?.raw ?? null);
  const ans = settledA?.raw["answer"] as Record<string, unknown> | undefined;
  const byOk = settledA?.raw["by"] === "probe-A-winner";
  const answerOk = ans?.["kind"] === "deny" && ans?.["feedback"] === feedback;
  const fanOut = [settledA, settledB, settledC].filter(Boolean).length;
  verdict.Q4_decision_settled = `by=${JSON.stringify(settledA?.raw["by"])} decision=${JSON.stringify(settledA?.raw["decision"])} answer=${JSON.stringify(ans ?? null)} — reached ${fanOut}/3 attached clients`;
  if (!byOk) fail(`decision_settled.by did not name the answering client: ${JSON.stringify(settledA?.raw["by"])}`);
  if (!answerOk) fail(`decision_settled.answer did not carry the whole outcome (deny + feedback): ${JSON.stringify(ans ?? null)}`);
  if (fanOut !== 3) fail(`decision_settled reached ${fanOut}/3 attached clients`);

  // The denied model may try again; every later park is drained the same way so the turn can end. Counted,
  // because "how many times does a denied engine re-ask" is worth knowing for an unattended fleet thread.
  let drained = 0;
  const offDrain = A.watch((f) => {
    if (f.raw["kind"] !== "decision") return;
    const id = String((f.raw["entry"] as Record<string, unknown>)["toolUseID"]);
    if (id === toolUseID) return;
    drained++;
    void A.send({ op: "answer", toolUseID: id, by: "probe-drain", answer: { kind: "deny", feedback: "P106 drain" } }).catch(() => {});
  });
  const endB = await A.waitEvent("turn-2 end", (r) => r["kind"] === "turn" && r["phase"] === "end" && r["seq"] === turn2["seq"], TURN_MS)
    .catch(async (e: Error) => { log(`turn 2 did not end on its own (${e.message}) — interrupting`); dump("interrupt reply", await A.send({ op: "interrupt" })); return undefined; });
  offDrain();
  dump("turn 2 end", endB ? endB.raw : "(interrupted)");
  dump("re-parks drained after the deny", drained);

  // -------------------------------------------------------------------------------------------------
  // Phase 7 (Q5) — `stop`: is there a receipt at all, and what closes first?
  // -------------------------------------------------------------------------------------------------
  console.log("");
  log("Q5 STOP vs SOCKET CLOSE");
  const sentAt = Date.now() - t0;
  const stopId = A.fireAndForget({ op: "stop" });   // deliberately NOT awaited — see fireAndForget
  stopSent = true;
  const deadline = Date.now() + WIRE_MS;
  while (Date.now() < deadline && [A, B, C].some((c) => c.closedAtMs === undefined)) await sleep(100);
  await sleep(1000);                                 // a late reply, if the host ever writes one, lands here
  const stopReply = A.replyFor(stopId);
  dump("stop op sent at (ms since probe start)", sentAt);
  dump("socket close times (ms since probe start)", { A: A.closedAtMs ?? null, B: B.closedAtMs ?? null, C: C.closedAtMs ?? null });
  dump("reply to the stop op", stopReply ? stopReply.raw : "(none — no frame ever carried that id)");
  dump("frames A received after the stop was written", A.frames.filter((f) => f.atMs >= sentAt).map((f) => f.tag));
  const closedCount = [A, B, C].filter((c) => c.closedAtMs !== undefined).length;
  verdict.Q5_stop_vs_close = stopReply
    ? `RECEIPT EXISTS — ${JSON.stringify(stopReply.raw)}; ${closedCount}/3 sockets then closed (A at +${A.closedAtMs}ms vs stop at +${sentAt}ms)`
    : `NO RECEIPT — the sockets die first (${closedCount}/3 closed, A ${(A.closedAtMs ?? NaN) - sentAt}ms after the stop was written); a client awaiting a stop reply waits forever`;
  if (closedCount !== 3) fail(`only ${closedCount}/3 sockets closed within ${WIRE_MS}ms of the stop op`);

  // The terminal roster row is the other half of "stopped, not crashed".
  let finalRow = readRoster(short);
  for (let i = 0; i < 40 && finalRow && !TERMINAL.has(finalRow.state); i++) { await sleep(250); finalRow = readRoster(short); }
  dump("roster row after stop", finalRow ?? null);
  dump("socket file removed", !existsSync(socketPath));
  if (!finalRow || !TERMINAL.has(finalRow.state)) fail(`roster row did not reach a terminal state: ${JSON.stringify(finalRow ?? null)}`);
  else if (finalRow.state !== "stopped") fail(`an operator stop recorded ${finalRow.state}, not "stopped"`);

  A.destroy(); B.destroy(); C.destroy();
} catch (e) {
  fail(`ABORTED: ${(e as Error)?.stack ?? String(e)}`);
  // What each client HAD received when the run stopped — the only thing that makes a timeout diagnosable
  // without re-running the whole probe.
  for (const c of clients) {
    console.log(`  ${c.name}: ${c.frames.length} frames, tail:`);
    for (const f of c.frames.slice(-25)) console.log(`    [${f.i}] +${(f.atMs / 1000).toFixed(1)}s ${f.tag}`);
  }
} finally {
  // Cleanup is the host's OWN stop op, never a broad process kill: this probe spawns exactly one process
  // and knows its pid from the row it minted. The SIGTERM below is the last resort for that ONE pid (the
  // host's own handler turns it into stop("stopped")), and it is itself reported as a problem — a stop
  // that needed a signal is a finding, not housekeeping.
  if (short && !stopSent) {
    try {
      const row = readRoster(short);
      if (row && !TERMINAL.has(row.state)) {
        const c = new HostClient("cleanup");
        await c.connect(hostSocketPath(row.pid));
        c.fireAndForget({ op: "stop" });
        await sleep(8_000);
        c.destroy();
      }
    } catch (e) { fail(`cleanup stop failed: ${(e as Error).message}`); }
  }
  if (hostPid) {
    let alive = true;
    for (let i = 0; i < 40 && alive; i++) {
      try { process.kill(hostPid, 0); await sleep(250); } catch { alive = false; }
    }
    if (alive) {
      fail(`host pid ${hostPid} still alive after its own stop — sending SIGTERM to that one pid`);
      try { process.kill(hostPid, "SIGTERM"); } catch { /* it went away between the check and the signal */ }
    }
  }
  rmSync(root, { recursive: true, force: true });

  console.log("");
  console.log("=== VERDICT ===");
  for (const [k, v] of Object.entries(verdict)) console.log(`${k}: ${v}`);
  console.log("");
  if (problems.length) {
    console.log(`RESULT: FAIL (${problems.length})`);
    for (const p of problems) console.log(`  - ${p}`);
  } else {
    console.log("RESULT: PASS — every question above was measured on a live host");
  }
  process.exit(problems.length ? 1 : 0);
}
