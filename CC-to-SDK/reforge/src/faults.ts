// H2 — synthetic fault cassettes. Retry/backoff/stream-interruption paths are a
// large share of engine code and are never reached by happy-path recordings.
// The replay proxy already owns the response side, so faults are free: derive a
// broken cassette from a healthy one and replay it into every engine.
//
// A derived cassette must stay *plausible* — same request shape, same headers —
// so the engine takes the real error path rather than a parse path.
import { readFileSync, writeFileSync } from "node:fs";
import type { CassetteEntry, RecordInjector } from "./proxy.js";

export type FaultKind = "overloaded" | "rate-limited" | "server-error" | "truncated-stream" | "malformed-event";

const errorBody = (type: string, message: string) => JSON.stringify({ type: "error", error: { type, message } });

/**
 * Is this request the AUTO-MODE CLASSIFIER's own call, rather than the main loop's?
 *
 * Both go to `/v1/messages` on the same base URL, so the caller has to be
 * identified from the body. Upstream's `querySource: "auto_mode"` is a
 * client-side label and never reaches the wire; what does reach it is the shape
 * the classifier builds and nothing else does — a toolless, non-streaming
 * request whose stop sequence closes the verdict tag it asks the model to emit
 * (`</severity>` for the two-stage severity arm, `</block>` for the older
 * boolean one). MEASURED against a live `auto` recording, not assumed:
 * `w6/probe-permissions.ts --phase auto-classifier --keep-cassettes` puts the
 * classifier exchange in the cassette next to the two main-loop ones.
 */
export function isAutoModeClassifierRequest(body: string): boolean {
  if (!body.includes("/severity>") && !body.includes("/block>")) return false;
  let parsed: { stop_sequences?: unknown; tools?: unknown; stream?: unknown };
  try {
    parsed = JSON.parse(body) as typeof parsed;
  } catch {
    return false;
  }
  const stops = Array.isArray(parsed.stop_sequences) ? (parsed.stop_sequences as unknown[]) : [];
  if (!stops.some((s) => s === "</severity>" || s === "</block>")) return false;
  return parsed.stream !== true && (parsed.tools === undefined || (Array.isArray(parsed.tools) && parsed.tools.length === 0));
}

/**
 * Make the auto-mode classifier UNAVAILABLE, at record time.
 *
 * The status is chosen against upstream's own retry predicate rather than for
 * realism: the classifier retries `wall_clock_timeout`, `connection_*`, 429 and
 * 5xx on an outer loop, so any of those would multiply the live take by the
 * retry bound. A 400 is not retryable on either the SDK client's loop or the
 * classifier's, so the fail-closed arm is reached on the first answer — which
 * is what makes this cheap enough to keep in a corpus.
 */
export const classifierUnavailable: RecordInjector = (req) =>
  req.path.includes("/v1/messages") && isAutoModeClassifierRequest(req.body)
    ? { status: 400, contentType: "application/json", body: errorBody("invalid_request_error", "reforge W6: auto-mode classifier made unavailable at record time") }
    : null;

/** Rewrite the FIRST /v1/messages exchange of a cassette to exhibit `kind`. */
export function deriveFaultCassette(source: string, dest: string, kind: FaultKind): CassetteEntry[] {
  const entries: CassetteEntry[] = readFileSync(source, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  const target = entries.find((e) => e.path.includes("/v1/messages"));
  if (!target) throw new Error(`no /v1/messages exchange in ${source}`);
  // Engines retry; without this the retry finds nothing and sees the proxy's
  // fallback instead of the fault we are trying to test.
  target.repeat = true;

  switch (kind) {
    case "overloaded":
      target.status = 529;
      target.contentType = "application/json";
      target.responseBody = errorBody("overloaded_error", "Overloaded");
      break;
    case "rate-limited":
      target.status = 429;
      target.contentType = "application/json";
      target.responseBody = errorBody("rate_limit_error", "Number of requests has exceeded your rate limit");
      break;
    case "server-error":
      target.status = 500;
      target.contentType = "application/json";
      target.responseBody = errorBody("api_error", "Internal server error");
      break;
    case "truncated-stream": {
      // Keep status 200 and the SSE content type, but cut the stream partway:
      // the engine sees a well-formed prefix that simply stops (no
      // message_stop) — the mid-flight disconnection case.
      const blocks = target.responseBody.split("\n\n").filter(Boolean);
      const keep = Math.max(1, Math.floor(blocks.length / 2));
      target.responseBody = blocks.slice(0, keep).join("\n\n") + "\n\n";
      break;
    }
    case "malformed-event": {
      // A single event carrying invalid JSON, mid-stream.
      const blocks = target.responseBody.split("\n\n").filter(Boolean);
      const at = Math.min(2, blocks.length - 1);
      blocks[at] = "event: content_block_delta\ndata: {not-json";
      target.responseBody = blocks.join("\n\n") + "\n\n";
      break;
    }
  }

  // THE ENGINE DOWNGRADES OUT OF SSE AFTER A MID-STREAM FAILURE.
  //
  // Measured at 2.1.251: a truncated or malformed stream makes the engine retry
  // the SAME request with `"stream": false` — a one-character body difference
  // and a real behavioral contract a reimplementation must reproduce. The
  // derived cassette had no entry for that request, so the retry was served the
  // streaming entry POSITIONALLY: both engines then "failed identically" on a
  // response that was never matched to what they asked for. Invisible until
  // §3.4 made fallbacks fatal.
  //
  // So the derivation answers the downgraded retry explicitly, with the same
  // injected fault: the suite's claim is that both engines fail the same way on
  // the same fault, and that claim is only meaningful if each request is served
  // the response it actually matched.
  if (kind === "truncated-stream" || kind === "malformed-event") {
    try {
      const asked = JSON.parse(target.requestBody) as Record<string, unknown>;
      if (asked.stream === true) {
        entries.push({ ...target, seq: entries.length, requestBody: JSON.stringify({ ...asked, stream: false }), repeat: true });
      }
    } catch {
      // A non-JSON body cannot be downgraded; leave the cassette as derived and
      // let the fallback report itself rather than guessing at a variant.
    }
  }

  writeFileSync(dest, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return entries;
}
