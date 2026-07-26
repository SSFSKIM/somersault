// Probe 62 — Two questions A2 (`ccx attach`) cannot be designed without.
//
// (1) MID-TURN TRANSCRIPT VISIBILITY. Acceptance 5 says `ccx attach <id>` "replays the conversation
//     and follows the in-flight turn". The replay path we already own (tui/src/replay.ts, probe 23)
//     reads `getSessionMessages(sessionId)` off local disk. That is only sufficient if the engine
//     writes the transcript INCREMENTALLY. If it flushes at turn end instead, a client attaching
//     mid-turn sees the conversation up to the previous turn and nothing of the one actually running
//     — precisely the case a human attaches for — and the host must keep an in-memory ring buffer of
//     the current turn and replay that itself. Very different component.
//
// (2) STREAM VOLUME. The spec's Testing section says "includePartialMessages is on by default, so
//     follow fan-out is per-token per-client over UDS. Measure before assuming it is free." So:
//     count messages and bytes on a real turn and report a per-second rate.
//
// Method: run one turn that is long enough to sample (a ~400 word essay, no tools so nothing can
// park), capture the session id from the init frame, and poll getSessionMessages on a timer WHILE the
// stream is running. Every sample records what the on-disk transcript knows at that instant.
import { query, getSessionMessages } from "@anthropic-ai/claude-agent-sdk";

const POLL_MS = 1500;

interface Sample { atMs: number; count: number; error?: string; lastKinds: string }

const samples: Sample[] = [];
let sessionId: string | undefined;
let turnOver = false;

// stream volume
let msgs = 0, partials = 0, bytes = 0;
const t0 = Date.now();

async function sampleTranscript(): Promise<void> {
  while (!turnOver) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    if (!sessionId || turnOver) continue;
    const atMs = Date.now() - t0;
    try {
      const ms = await getSessionMessages(sessionId);
      const lastKinds = ms.slice(-3).map((m: any) => m?.type ?? "?").join(",");
      samples.push({ atMs, count: ms.length, lastKinds });
      console.log(`  [poll +${atMs}ms] getSessionMessages -> ${ms.length} messages (tail: ${lastKinds || "-"})`);
    } catch (e: any) {
      samples.push({ atMs, count: -1, error: e?.message ?? String(e), lastKinds: "" });
      console.log(`  [poll +${atMs}ms] THREW: ${e?.message}`);
    }
  }
}

console.log("=== PROBE 62 mid-turn transcript visibility + stream volume ===");

const q = query({
  prompt: "Write roughly 400 words on the history of the Unix pipe, from Doug McIlroy's memo to its "
    + "appearance in Version 3 Unix. Prose only — do not use any tools.",
  options: {
    model: "claude-sonnet-4-5-20250929",
    maxTurns: 1,
    includePartialMessages: true,       // the default the spec calls out; make it explicit for the count
    settingSources: [],                  // keep the user's own settings out of the measurement
  },
});

const polling = sampleTranscript();

let result: any;
for await (const m of q) {
  const mm = m as any;
  msgs++;
  bytes += JSON.stringify(mm).length;
  if (mm.type === "stream_event") partials++;
  if (mm.type === "system" && mm.subtype === "init" && !sessionId) {
    sessionId = mm.session_id;
    console.log(`[init] session ${sessionId} at +${Date.now() - t0}ms — polling starts`);
  }
  if ("result" in mm) { result = mm; break; }
}
const turnMs = Date.now() - t0;
turnOver = true;
await polling;

// After the turn: what does disk say now?
let afterCount = -1;
try { afterCount = (await getSessionMessages(sessionId!)).length; } catch (e: any) { console.log("post-turn read threw:", e?.message); }

const midSamples = samples.filter((s) => s.count >= 0);
const grew = midSamples.length >= 2 && midSamples[midSamples.length - 1]!.count > midSamples[0]!.count;
const sawAnyMidTurn = midSamples.some((s) => s.count > 0);

console.log("");
console.log(`turn duration        : ${turnMs}ms`);
console.log(`mid-turn samples     : ${samples.length} (${midSamples.length} readable)`);
console.log(`  counts             : ${samples.map((s) => (s.count < 0 ? "ERR" : s.count)).join(" -> ")}`);
console.log(`transcript after turn: ${afterCount} messages`);
console.log("");
console.log(`stream messages      : ${msgs} (${partials} partial stream_event)`);
console.log(`stream bytes         : ${bytes} (${(bytes / 1024).toFixed(1)} KiB)`);
console.log(`rate                 : ${(msgs / (turnMs / 1000)).toFixed(1)} msg/s, ${(bytes / 1024 / (turnMs / 1000)).toFixed(1)} KiB/s`);
console.log(`result subtype       : ${result?.subtype} | is_error: ${result?.is_error}`);
if (result?.is_error) console.log(`result text          : ${JSON.stringify(result?.result).slice(0, 200)}`);
console.log("");

// The visibility question is only answered by a turn that actually ran long enough to be sampled
// twice. A turn that ends in three seconds — which is what a rate-limited account produces, the model
// answering with the limit notice and stopping — yields one sample and no growth, and reads
// identically to "the engine buffers the transcript until the turn ends". Refusing to rule on it is
// the whole point: this probe exists because an unmeasured premise is what A1 shipped a defect behind.
if (!result || result.is_error || midSamples.length < 2) {
  console.log("VERDICT: INCONCLUSIVE — the turn did not run long enough to sample the transcript twice");
  console.log(`         (${turnMs}ms, ${midSamples.length} readable sample(s)). Re-run against a working`);
  console.log("         account; a degenerate turn cannot distinguish incremental flush from buffered.");
} else if (sawAnyMidTurn && grew) {
  console.log("VERDICT: the engine writes the transcript INCREMENTALLY — an attaching client can replay");
  console.log("         the in-flight turn from getSessionMessages alone; no host-side ring buffer needed.");
} else if (sawAnyMidTurn) {
  console.log("VERDICT: PARTIAL — the transcript existed mid-turn but did not grow while the turn ran.");
  console.log("         Treat disk as 'everything up to the current turn' and replay the live turn from follow().");
} else {
  console.log("VERDICT: the transcript is NOT visible mid-turn — attach cannot rely on getSessionMessages");
  console.log("         for the running turn. The host must buffer the current turn and replay it itself.");
}
console.log(`RESULT: ${result && !result.is_error && midSamples.length >= 2 ? "PASS (measured)" : "FAIL (measurement incomplete)"}`);
