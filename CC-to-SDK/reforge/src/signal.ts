// SIGNAL DELIVERY TO AN ENGINE CHILD, at a declared and replay-deterministic
// point — the minimal half of C16a's capability (iii), built by C16b because
// C16b is what needs it.
//
// ## Why a frame count and never a clock
//
// "Send SIGTERM 800 ms in" is not a measurement, it is a coin flip with good
// odds. The engine's own timing moves with the machine, with whether a cassette
// entry was served from the hash index or positionally, and with whatever else
// the host is doing; a wall-clock trigger therefore delivers the signal at a
// different point in the engine's control flow on different runs, and a
// differential harness whose stimulus moves cannot attribute a difference in
// response to the engine.
//
// So the trigger is a POINT IN THE OUTPUT STREAM: "after the Nth frame of type
// T". Under strict replay both engines produce the same frames in the same
// order, so both receive the signal at the same place in their own execution,
// and the comparison between them is about what they DO with it. The declared
// point is part of the verdict, so a run where the point never arrived reports
// that rather than silently signalling something else or nothing.
//
// ## Why the verdict has to name "did not settle" as an outcome
//
// The behaviour under test does not fail, throw, or return — it stops. Upstream
// latches shutdown and then awaits a promise built never to resolve, which is
// how a turn is abandoned without unwinding it. An oracle that drove that to
// completion would hang, and a suite that hangs is worse than one that fails
// (the gate's own three-outcome rule exists for exactly this). So the shape here
// is `strangle/hooks-parity.test.ts`'s `drainBounded`/`nonSettling`, one level
// out: bounded observation, and "produced nothing further within N ms" recorded
// as a graded outcome rather than as an absence of one.
//
// ## What the exit STATUS proves, and why it is the sharpest thing here
//
// A process that ignores SIGTERM dies of it: `code === null`, `signal ===
// "SIGTERM"`. A process whose handler ran and called `process.exit(143)` reports
// `code === 143`, `signal === null`. Those are different observations, and only
// the second is evidence that the engine's own handler executed. Any grading
// that collapsed them into "it stopped" would pass a build in which the handler
// had been removed entirely.
//
// ## SEAM NOTE FOR C16a
//
// This is the primitive, not the capability. What C16a must add on top:
//   * arbitrary signals and repeat delivery (SIGINT, a second SIGTERM into a
//     handler that has already latched — upstream's once-guard has an arm for it);
//   * delivery to a DESCENDANT rather than the direct child, which needs C13c's
//     descendant snapshot to name one deterministically;
//   * triggers over the request stream as well as the response stream (the proxy
//     sees requests the wire does not), which is where capability (i)'s per-event
//     control and this one meet;
//   * a scenario-level declaration so a corpus scenario can carry a signal plan
//     instead of a bespoke driver, which is what makes it reusable beyond one tag;
//   * the SDK lane. This drives the engine as a direct child, which is why it can
//     name a pid at all; an `sdk.mjs`-driven scenario cannot, and closing that is
//     a capability rather than a refactor.
import type { ChildProcess } from "node:child_process";

/**
 * The declared delivery point: "after the Nth frame whose `type` is `frameType`".
 * `nth` is 1-based, so `{ frameType: "assistant", nth: 1 }` reads as written.
 */
export interface FrameTrigger {
  frameType: string;
  nth: number;
}

export const describeTrigger = (t: FrameTrigger): string =>
  `after the ${t.nth === 1 ? "first" : `${t.nth}th`} \`${t.frameType}\` frame`;

export interface SignalRun {
  /** every frame the engine wrote, in order */
  frames: unknown[];
  /** how many had arrived when the signal was delivered — `null` if it never was */
  framesAtSignal: number | null;
  /** frames that arrived AFTER delivery — graded against a declared allowlist, not against zero */
  framesAfterSignal: number;
  /** did the child end within the quiet window, and how */
  exited: boolean;
  exitCode: number | null;
  /** set when the OS killed it, which means its own handler did NOT run */
  killedBySignal: string | null;
  stderr: string;
}

/**
 * Watch an engine child's frame stream, deliver `signal` at the declared point,
 * then observe for `quietMs` and report.
 *
 * The caller owns the spawn and the stdin protocol; this owns only the trigger,
 * the delivery and the observation window.
 */
export function driveWithSignal(
  child: ChildProcess,
  trigger: FrameTrigger,
  signal: NodeJS.Signals,
  quietMs: number,
): Promise<SignalRun> {
  const frames: unknown[] = [];
  let framesAtSignal: number | null = null;
  let seenOfType = 0;
  let stderr = "";
  let buf = "";

  return new Promise<SignalRun>((resolve) => {
    let quietTimer: ReturnType<typeof setTimeout> | undefined;
    let done = false;
    const finish = (exited: boolean, exitCode: number | null, killedBySignal: string | null): void => {
      if (done) return;
      done = true;
      if (quietTimer !== undefined) clearTimeout(quietTimer);
      resolve({
        frames,
        framesAtSignal,
        framesAfterSignal: framesAtSignal === null ? 0 : frames.length - framesAtSignal,
        exited,
        exitCode,
        killedBySignal,
        stderr: stderr.slice(0, 600),
      });
    };

    child.stdout?.on("data", (c: Buffer) => {
      buf += c.toString("utf8");
      for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        let frame: unknown;
        try {
          frame = JSON.parse(line);
        } catch {
          frame = { type: "reforge-unparseable", raw: line.slice(0, 200) };
        }
        frames.push(frame);
        if (framesAtSignal !== null) continue;
        if ((frame as { type?: string }).type !== trigger.frameType) continue;
        if (++seenOfType < trigger.nth) continue;
        // THE DELIVERY POINT. Recorded before the kill, so a frame that races in
        // during the syscall counts as "after" — the conservative direction: it
        // can only make a silent engine look noisy, never the reverse.
        framesAtSignal = frames.length;
        child.kill(signal);
        // The observation window opens at delivery, not at spawn: everything
        // before it is the setup, and only what follows is the behaviour.
        quietTimer = setTimeout(() => finish(false, null, null), quietMs);
      }
    });
    child.stderr?.on("data", (c: Buffer) => (stderr += c.toString("utf8")));
    child.on("close", (code, sig) => finish(true, code, sig));
  });
}

/** The frame types this run wrote after the signal, in order and deduplicated. */
export const typesAfterSignal = (run: SignalRun): string[] =>
  run.framesAtSignal === null
    ? []
    : [...new Set(run.frames.slice(run.framesAtSignal).map((f) => {
        const m = f as { type?: string; subtype?: string };
        return `${m.type}${m.subtype ? `:${m.subtype}` : ""}`;
      }))];

/**
 * The non-settling verdict, as violations — `nonSettling`'s shape one level out.
 *
 * Both halves are stated separately for the same reason the in-process version
 * states them separately: a run that emits three more frames and THEN goes quiet
 * is a different behaviour from one that goes quiet immediately, and a verdict
 * that only asked "did it stop" would pass both.
 *
 * ## Why "after the signal" is an ALLOWLIST rather than zero
 *
 * The first version of this asserted zero frames after delivery, which is what
 * "produced no further yields" sounds like it means, and it was wrong about the
 * wire in a way only a measurement showed. A model response arrives as ONE
 * response and leaves as SEVERAL frames — one per content block — so a signal
 * delivered on the first of them is delivered in the middle of a flush the
 * engine has already committed to. Those trailing frames are not the loop
 * continuing; they are the response the engine already held, and no shutdown
 * latch is supposed to swallow them.
 *
 * So the caller DECLARES which frame types may still appear, and anything else
 * is a violation naming itself. That keeps the check sharp — a `result`, a
 * tool-result `user` frame or a second turn's `system` frame all fail — while
 * not asserting something the wire never did.
 */
export function shutdownViolations(
  run: SignalRun,
  trigger: FrameTrigger,
  expectedExitCode: number,
  allowedAfter: readonly string[],
): string[] {
  const bad: string[] = [];
  if (run.framesAtSignal === null) {
    bad.push(`the delivery point never arrived — no signal was sent ${describeTrigger(trigger)}`);
    return bad; // everything below would be grading a run that was never stimulated
  }
  const unexpected = typesAfterSignal(run).filter((t) => !allowedAfter.includes(t.split(":")[0]) && !allowedAfter.includes(t));
  if (unexpected.length > 0) {
    bad.push(`${run.framesAfterSignal} frame(s) after the signal include ${unexpected.join(", ")}, which is turn progress the shutdown path does not produce`);
  }
  if (!run.exited) bad.push("the child was still running at the end of the quiet window");
  if (run.killedBySignal !== null) {
    bad.push(`the child was killed by ${run.killedBySignal} rather than exiting, so its own handler did not run`);
  } else if (run.exited && run.exitCode !== expectedExitCode) {
    bad.push(`exited ${run.exitCode}, expected ${expectedExitCode}`);
  }
  return bad;
}
