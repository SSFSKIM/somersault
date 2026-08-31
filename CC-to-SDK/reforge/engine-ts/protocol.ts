// The stream-json protocol shell — W0 half: it can *read* the wire and it can
// *refuse* on it, honestly and without hanging.
//
// The wire contract engine-ts must eventually speak is the one `m2/raw-protocol.ts`
// already drives: newline-delimited JSON on stdin/stdout, `{type, subtype, ...}`
// frames, no sdk.mjs in between. The skeleton owns MODULES, not subsystems, and
// has no behaviour dispatch at all, so the only correct behavior on session
// input is a structured refusal that NAMES what is unowned — never a synthesized
// `result` frame, which would be indistinguishable from a working turn and
// would grade as a hollow pass in the differential harness.
//
// The refusal is deliberately careful about a claim that gets easier to overstate
// with every wave: registration is PER MODULE. Once C4 registered ten of the
// graph's 44 tool-result formatters, "subsystems with at least one owned module"
// stopped meaning "owned subsystems", so the frame reports the two populations
// separately and says which is which. reforge/ledger.json is the authority on
// how far each subsystem actually is.
import { ENGINE_VERSION } from "../src/pin.js";
import { CANONICAL_ROWS } from "../ledger/rows.js";
import { ownedSet, ownedSubsystems, unownedSubsystems } from "./registry.js";

/** Distinct from a crash (non-zero, unclassified) and from success (0). */
export const EXIT_UNOWNED = 3;

export type RefusalTrigger = "stream-json-input" | "no-input" | "argv-session-request";

export interface RefusalFrame {
  type: "reforge_engine_ts_error";
  subtype: "unowned";
  is_error: true;
  engine: "engine-ts";
  /** how many modules are registered — the only ownership number this file can verify */
  owned_module_count: number;
  /** The pinned upstream engine this skeleton targets — engine-ts has no version of its own. */
  targets_engine_version: string;
  trigger: RefusalTrigger;
  owned_modules: string[];
  /** in-scope subsystems with NO owned module at all */
  unowned_subsystems: string[];
  /** in-scope subsystems with at least one owned module — partially owned, never done */
  partially_owned_subsystems: string[];
  message: string;
}

const titleOf = (id: string): string => CANONICAL_ROWS.find((r) => r.id === id)?.title ?? id;

export function refusalFrame(trigger: RefusalTrigger): RefusalFrame {
  const owned = ownedSet().map((m) => m.name);
  const unowned = [...unownedSubsystems()];
  const partial = [...ownedSubsystems()];
  const total = CANONICAL_ROWS.filter((r) => r.kind === "subsystem").length;
  return {
    type: "reforge_engine_ts_error",
    subtype: "unowned",
    is_error: true,
    engine: "engine-ts",
    owned_module_count: owned.length,
    targets_engine_version: ENGINE_VERSION,
    trigger,
    owned_modules: owned,
    unowned_subsystems: unowned,
    partially_owned_subsystems: partial,
    message:
      `engine-ts cannot serve a stream-json session: it registers ${owned.length} owned module(s) and has no behaviour dispatch. ` +
      `${unowned.length}/${total} in-scope subsystems have no owned module at all; the other ${partial.length} are PARTIALLY owned, ` +
      `not done (registration is per module — see reforge/ledger.json for each subsystem's state). ` +
      `No owned module at all: ${unowned.map(titleOf).join("; ")}.`,
  };
}

/**
 * Read the first stream-json line from stdin, without ever hanging: resolve on
 * the first complete line, on end-of-input, or on a timeout — whichever comes
 * first. A skeleton that blocks forever is worse than one that refuses, because
 * the harness driving it would stall instead of recording a verdict.
 */
export function readFirstLine(stream: NodeJS.ReadableStream & { isTTY?: boolean }, timeoutMs = 5000): Promise<string | null> {
  if (stream.isTTY) return Promise.resolve(null);
  return new Promise((resolve) => {
    let buf = "";
    let done = false;
    const finish = (line: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      stream.removeListener("data", onData);
      stream.removeListener("end", onEnd);
      if (typeof (stream as NodeJS.ReadStream).pause === "function") (stream as NodeJS.ReadStream).pause();
      resolve(line);
    };
    const onData = (chunk: Buffer | string) => {
      buf += chunk.toString();
      const nl = buf.indexOf("\n");
      if (nl >= 0) finish(buf.slice(0, nl));
    };
    const onEnd = () => finish(buf.trim() ? buf.trim() : null);
    const timer = setTimeout(() => finish(buf.trim() ? buf.trim() : null), timeoutMs);
    stream.on("data", onData);
    stream.on("end", onEnd);
  });
}
