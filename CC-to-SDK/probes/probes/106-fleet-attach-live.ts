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
//      background-task snapshot → `state` LAST. Two attaches measure it: one while the turn is doing
//      tool work, one while a decision is parked (the only way the `decision` position is observable at
//      all). Two smaller claims ride along, both of which an adapter's read loop depends on: the `follow`
//      REPLY lands after the whole burst rather than delimiting it, and `stream_event` partials reach a
//      live follower but are never replayed to a late one.
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
// RUN IT (keyed — the turns are real). The runner supplies the credentials; this probe reads no `.env`
// (a fresh worktree has none — the file is gitignored and lives in the main checkout):
//   cd CC-to-SDK/probes && npx tsx probes/106-fleet-attach-live.ts
// Keyless it will spawn and connect fine and then fail at the first turn — which is a FAILURE, not a
// skip: this probe has nothing to say without a live engine.
//
// THE PERMISSION SHAPE IS THE WHOLE EXPERIMENT (run-1 scar). Run 1 launched with `ask:["Bash(*)"]` as
// park insurance, and that rule parked the turn's FIRST tool call: the host went `blocked` at +8.4s, the
// turn never progressed, and Q2-Q5 never ran. The turn's own work must therefore be ALLOWED and the park
// must be a SEPARATE, LATER trigger. So: `sleep` is allowed, `touch` asks, and the prompt runs the sleeps
// first and the touch last — one turn that is busy for real, then parks. Both rule syntaxes the engine
// honors are used for each (verified in the reference CLI's `utils/permissions/shellRuleMatching.ts`:
// `cmd:*` is the legacy PREFIX form — word boundary, and deliberately does NOT match a compound command —
// while `cmd *` is the newer WILDCARD form, whose trailing ` *` is made optional so it also matches the
// bare command). The prefix form's compound-command refusal is why the prompt insists on ONE command per
// Bash call: `sleep 2 && sleep 2` matches no allow rule and would park on the sleeps again.
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
/** Poll until `pid` is gone, up to `ms`; resolves true if it went. `ms = 0` is a single instantaneous
 *  check. Signal 0 is the probe-for-existence signal — it delivers nothing and throws ESRCH when there
 *  is nobody there. */
async function pidGone(pid: number, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  for (;;) {
    try { process.kill(pid, 0); } catch { return true; }
    if (Date.now() >= deadline) return false;
    await sleep(250);
  }
}
const t0 = Date.now();
const at = () => `+${((Date.now() - t0) / 1000).toFixed(1)}s`;
const log = (s: string) => console.log(`${at()} ${s}`);
const dump = (label: string, v: unknown) => console.log(`  ${label}: ${JSON.stringify(v)}`);

/** Everything the VERDICT block prints, in question order. Filled as each phase measures. */
const verdict: Record<string, string> = {
  Q1_replay_order_midturn: "NOT MEASURED",
  Q1_replay_order_parked: "NOT MEASURED",
  Q1_follow_reply_position: "NOT MEASURED",
  Q1_partials_live_never_replayed: "NOT MEASURED",
  Q2_result_frame: "NOT MEASURED",
  Q3_receipt_lost_race: "NOT MEASURED",
  Q3_receipt_kind_mismatch: "NOT MEASURED",
  Q3_receipt_no_parked: "NOT MEASURED",
  Q4_decision_settled: "NOT MEASURED",
  Q5_stop_vs_close: "NOT MEASURED",
  Q5_process_exit: "NOT MEASURED",
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
      // `default`, explicitly: the ONE mode in which the broker is consulted at all, and it also overrides
      // whatever `defaultMode` the developer's own settings carry (this machine's says `auto`, which would
      // hand the decision to the classifier and park nothing).
      permissionMode: "default",
      model: "claude-sonnet-4-6",
      // The experiment itself — see the header. `sleep` runs FREE so the turn can be busy for real;
      // `touch` ASKS so the park is a separate, later trigger inside the same turn. Both syntaxes for each,
      // since both are honored and they cover different edges (prefix matches the bare command and refuses
      // compound ones; the wildcard form survives an argument shape the prefix rule's word boundary trips
      // on). The ask rules are what make the park independent of whatever the developer's own settings
      // allow — `touch` is in nobody's allowlist, but saying so explicitly is what makes this portable.
      settings: {
        permissions: {
          allow: ["Bash(sleep:*)", "Bash(sleep *)"],
          ask: ["Bash(touch:*)", "Bash(touch *)"],
        },
      },
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

  // ONE turn does all of it: sleeps for the wall clock the mid-turn attach needs (probe 103b's lesson —
  // real elapsed time, not a verbose prompt that finishes in one burst), then a `touch` that parks at the
  // END, which is what makes the parked-attach and the receipts measurable without a second turn.
  // "one command per call, no && or ;" is load-bearing, not politeness: a prefix allow rule refuses
  // compound commands outright (shellRuleMatching.ts), so a chained `sleep 2 && sleep 2` would park on
  // the sleeps and reproduce run 1's failure.
  const promptReply = await A.send({
    op: "prompt",
    text: "Do exactly this, using the Bash tool, one command per tool call, never chaining with && or ; : "
      + "call Bash four times with exactly the command `sleep 2` (four separate calls), "
      + "then call Bash once with exactly the command `touch p106-done.txt`. "
      + "Then reply with exactly: DONE",
  });
  log(`A prompt accepted — ${JSON.stringify(promptReply)}`);
  if (promptReply["ok"] !== true) throw new Error(`prompt refused: ${JSON.stringify(promptReply)}`);

  // -------------------------------------------------------------------------------------------------
  // Phase 2 (Q1a) — attach MID-TURN, with real buffered content behind us.
  // -------------------------------------------------------------------------------------------------
  // Attach as EARLY as there is anything to replay, not as late as is interesting. The first assistant
  // frame is the gate: the engine is up and has committed to a tool call, so the buffer holds real
  // content and (with four `sleep 2` steps to get through) there is plenty of turn left. A tool RESULT
  // makes the replay richer, so it is waited for — but only briefly, because a model that batched the
  // sleeps into one call would otherwise leave us attaching after the turn had already moved on.
  await A.waitEvent("turn first assistant frame", (r) => r["kind"] === "message" && ((r["data"] as Record<string, unknown>)?.["type"] === "assistant"), TURN_MS);
  await A.waitEvent("turn first tool result", (r) => r["kind"] === "message" && ((r["data"] as Record<string, unknown>)?.["type"] === "user"), 3_000)
    .catch(() => { log("no tool result within 3s of the first assistant frame — attaching anyway; the replay will be thinner"); return undefined; });
  const midStatus = await A.send({ op: "status" });
  log(`attaching now — host status ${JSON.stringify(midStatus)}`);
  // WHICH STATE THIS ATTACH CAUGHT IS RECORDED, NOT ASSERTED (run-1 scar: the probe aborted because the
  // host was parked). A turn is in flight in either of two projections — `busy` (mid-tool) or `blocked`
  // (parked mid-turn, which status() deliberately reports as idle). Neither means the turn is over, and
  // an IDLE attach is documented to replay the last completed turn with NO turn-start frame. Telling the
  // three apart is what keeps a late attach from being reported as a wire divergence.
  const turnLive = midStatus["status"] === "busy" || midStatus["state"] === "blocked";
  const attachedInto = midStatus["state"] === "blocked" ? "a PARKED turn" : turnLive ? "a BUSY turn" : "an ENDED turn (idle attach)";

  const B = new HostClient("B");
  await B.connect(socketPath);
  const bFollow = B.fireAndForget({ op: "follow" });
  await B.waitEvent("B replay tail (state)", (r) => r["kind"] === "state", WIRE_MS);
  await sleep(250);                     // let the follow reply land wherever it lands
  const bBlock = replayBlock(B);
  console.log("");
  log("Q1a MID-TURN ATTACH");
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
  // An idle attach is DOCUMENTED to omit the turn-start frame, so the expected shape depends on which of
  // the three states the attach caught — anything else reports a late attach as a wire defect.
  const bShapeOk = (turnLive ? bStartsWithTurn : !bStartsWithTurn) && bEndsWithState && bMsgsBeforeState;
  verdict.Q1_replay_order_midturn = `${bShapeOk ? "AS DOCUMENTED" : "DIVERGED"} (attached into ${attachedInto}) — ${bTags.join(" → ")}`;
  if (!turnLive) fail(`the turn was already over when B attached (${JSON.stringify(midStatus)}) — Q1a measured an IDLE attach, not a mid-turn one. The model finished or died before the attach gate fired; the frame dump above says which`);
  else if (!bStartsWithTurn) fail("mid-turn attach did not open with {kind:'turn',phase:'start'}");
  if (!bEndsWithState) fail("mid-turn attach replay did not end with {kind:'state'}");
  if (bReplayCount === 0) fail("mid-turn attach replayed zero frames marked replay:true");
  // The `follow` REPLY is not part of the replay: the server writes it only after handlers.follow()
  // returns, i.e. after the whole burst is already on the wire. A client that waits for its follow reply
  // before starting to read events therefore reads them in the right order anyway — but a client that
  // treats the reply as the START of its stream has already missed the replay.
  verdict.Q1_follow_reply_position = bFollowIdx < 0
    ? "AFTER the whole replay burst (the reply is not a delimiter — the events precede it)"
    : `INSIDE the burst at index ${bFollowIdx}/${bBlock.length}`;
  if (bFollowIdx >= 0) fail(`the follow reply landed inside the replay burst (index ${bFollowIdx}) — the documented ordering says the burst is written first`);

  // Partials ride the LIVE stream only — the turn buffer drops `stream_event` frames on the way in
  // (host.ts), because a late follower cannot use a token delta it missed the start of. Measured on both
  // clients: A followed from before the turn and should see them live; B joined mid-turn and must have
  // received none of them marked as replay.
  const livePartials = A.frames.filter((f) => f.tag.startsWith("event:message(stream_event")).length;
  const replayedPartials = [A, B].reduce((n, c) => n + c.frames.filter((f) => f.tag.startsWith("event:message(stream_event") && f.raw["replay"] === true).length, 0);
  dump("partials", { liveOnA: livePartials, replayMarkedAnywhere: replayedPartials });
  verdict.Q1_partials_live_never_replayed = `${livePartials} live stream_event frames on the following client, ${replayedPartials} ever marked replay:true`;
  if (livePartials === 0) fail("no stream_event partials arrived at all — an interactive host is supposed to stream them (host.ts's includePartialMessages default). A turn that died before generating any assistant text produces none either, so read this next to the turn's own outcome below");
  if (replayedPartials > 0) fail(`${replayedPartials} stream_event frames were replayed to a late joiner — the turn buffer is supposed to drop them`);

  // -------------------------------------------------------------------------------------------------
  // Phase 3 — the park. Same turn: the four allowed sleeps ran, and the `touch` hits the ask rule.
  // -------------------------------------------------------------------------------------------------
  const parkFrame = await A.waitEvent("a parked decision", (r) => r["kind"] === "decision", TURN_MS)
    .catch((e: Error) => { throw new Error(`${e.message} — the turn never consulted the broker. Either the model never ran the \`touch\` (check the frame dump above for what it did run) or a settings layer pre-authorized it despite the launch \`ask\` rules`); });
  const entry = parkFrame.raw["entry"] as Record<string, unknown>;
  const toolUseID = String(entry["toolUseID"]);
  const parkKind = String(entry["kind"]);
  console.log("");
  log("PARK ESTABLISHED");
  dump("decision entry", { toolUseID, kind: parkKind, toolName: entry["toolName"], input: entry["input"], suggestions: entry["suggestions"], decisionReason: entry["decisionReason"] });
  dump("status while parked", await A.send({ op: "status" }));

  // -------------------------------------------------------------------------------------------------
  // Phase 4 (Q1b) — a THIRD client attaches WHILE the decision is parked. The only way the `decision`
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
  // Phase 5 (Q3/Q4) — the three receipts, in the ONLY order that can measure all three: both refusals
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
  // -------------------------------------------------------------------------------------------------
  // Phase 6 (Q2) — the turn finishes now that the decision is answered: does the SDK's terminal
  // `result` message travel to a follower as {kind:"message"}, and on which side of `turn end`?
  // -------------------------------------------------------------------------------------------------
  const endA = await A.waitEvent("turn end", (r) => r["kind"] === "turn" && r["phase"] === "end" && r["seq"] === promptReply["seq"], TURN_MS)
    .catch(async (e: Error) => { log(`the turn did not end on its own (${e.message}) — interrupting`); dump("interrupt reply", await A.send({ op: "interrupt" })); return undefined; });
  offDrain();
  console.log("");
  log("Q2 RESULT FRAME");
  dump("turn end event", endA ? endA.raw : "(interrupted — no clean end)");
  dump("re-parks drained after the deny", drained);
  const resultFrames = A.frames.filter((f) => f.raw["t"] === "event" && f.raw["kind"] === "message"
    && ((f.raw["data"] as Record<string, unknown>)?.["type"] === "result"));
  if (resultFrames.length) {
    const rf = resultFrames[resultFrames.length - 1];
    const d = rf.raw["data"] as Record<string, unknown>;
    const side = endA ? (rf.i < endA.i ? "BEFORE" : "AFTER") : "n/a (no clean turn end)";
    dump("result frame envelope", { kind: rf.raw["kind"], replay: rf.raw["replay"] ?? null, index: rf.i, sideOfTurnEnd: side });
    dump("result frame payload keys", Object.keys(d).sort());
    dump("result frame summary", { type: d["type"], subtype: d["subtype"], is_error: d["is_error"], num_turns: d["num_turns"], duration_ms: d["duration_ms"], session_id: d["session_id"] });
    verdict.Q2_result_frame = `YES — {kind:"message"} carries data.type="result" (subtype=${String(d["subtype"])}, is_error=${String(d["is_error"])}), arriving ${side} {kind:"turn",phase:"end"}`;
  } else {
    verdict.Q2_result_frame = "NO — no {kind:'message'} frame carried data.type='result'";
    fail("no result-type message frame reached a follower");
  }
  // Volume, for the record: an app-server adapter fans every one of these out again.
  dump("A frame census", { total: A.frames.length, partials: A.frames.filter((f) => f.tag.startsWith("event:message(stream_event")).length, messages: A.events("message").length });

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

  // A THIRD fact the stop path owes an orchestrator, and the one run 1 tripped over from the outside: a
  // torn-down host is not necessarily a DEAD PROCESS. The roster row and the socket can both say "gone"
  // while the pid is still up (teardown bounds dispose at a 5s grace and then leaves; whatever the SDK
  // still holds open keeps the event loop alive). An app server that treats the roster row as proof the
  // process is gone would leak one process per stopped thread.
  const exited = await pidGone(hostPid, 20_000);
  dump("host process exited after its own stop", { pid: hostPid, exited, waitedMs: 20_000 });
  verdict.Q5_process_exit = exited
    ? "the host process exits on its own after `stop` (roster terminal AND pid gone)"
    : "the host process was STILL ALIVE 20s after `stop` — a terminal roster row is not proof the process is gone";

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
  // TEARDOWN RUNS ON EVERY PATH, including an abort from any phase timeout — run 1 aborted mid-park and
  // left the spawned host alive, which someone then had to clean up by hand.
  //
  // The ladder, in order, and each rung reported: the host's OWN `stop` op first (never a broad process
  // kill — this probe spawned exactly one process and knows its pid from the row it minted); then SIGTERM
  // to that ONE pid, which the host's own handler turns into stop("stopped"); then SIGKILL to the same
  // pid. Escalating past the first rung is itself a FINDING, not housekeeping: it means a host does not
  // reliably die of its own stop, which is exactly what an orchestrator that spawns fleets needs to know.
  if (short) {
    try {
      const row = readRoster(short);
      if (row && !(await pidGone(row.pid, 0))) {
        const c = new HostClient("cleanup");
        await c.connect(hostSocketPath(row.pid)).catch(() => { /* socket already gone: teardown got that far */ });
        if (!stopSent) c.fireAndForget({ op: "stop" });
        await pidGone(row.pid, 15_000);
        c.destroy();
      }
    } catch (e) { fail(`cleanup stop failed: ${(e as Error).message}`); }
  }
  if (hostPid && !(await pidGone(hostPid, 0))) {
    fail(`host pid ${hostPid} outlived its own stop — escalating to SIGTERM. This is a FINDING about the stop path (see Q5_process_exit), not a probe error: the verdict lines above still hold`);
    try { process.kill(hostPid, "SIGTERM"); } catch { /* it went away between the check and the signal */ }
    if (!(await pidGone(hostPid, 10_000))) {
      fail(`host pid ${hostPid} ignored SIGTERM too — escalating to SIGKILL on that one pid`);
      try { process.kill(hostPid, "SIGKILL"); } catch { /* ditto */ }
      await pidGone(hostPid, 5_000);
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
