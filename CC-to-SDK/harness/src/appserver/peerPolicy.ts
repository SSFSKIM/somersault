// appserver/peerPolicy.ts — the inbound policy, decided ONCE at admission and written into the config
// every engine for this thread is built from.
//
// Four doors lead to the CLI's settings, and a policy that closes three of them closes none:
//   1. `config.settings`            — the SDK's typed object
//   2. `config.extraArgs.settings`  — the `--settings` argv flag, JSON or a path
//   3. `config.extraOptions`        — the escape hatch, spread LAST by resolveOptions
//   4. a settings FILE on disk      — reachable only as a string in doors 1 and 3
//
// Doors 1-3 are rewritten. Door 4 is REFUSED: a string in `settings` is a path
// (sdk.d.ts `settings?: string | Settings`), and sanitizing it would mean rewriting a file this server
// does not own. Refusing is the only answer that neither admits an unsanitized carrier nor silently
// discards what the client asked for.
import { ERR, RpcRefusal } from "./rpc.js";

export type CrossSessionInbound = "accept" | "hold" | "refuse";

/** Refuse, always, unless a client says otherwise on the admission call. A machine-wide inbox that any
 *  local process can write to is not something a thread should acquire by default. */
export const DEFAULT_INBOUND: CrossSessionInbound = "refuse";

export const SETTINGS_KEY = "crossSessionInbound";
/** The same constant under the name the reservation reads it by (settings.ts). One constant, two
 *  readers — so the reservation cannot drift from the key it reserves. */
export const RESERVED_SETTINGS_KEY = SETTINGS_KEY;

const REPLAY_FLAG = "replay-user-messages";

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** A `settings` slot this server is allowed to rewrite: absent, or a plain object. Anything else — a
 *  path, a number, null — is refused rather than sanitized. */
function assertSanitizableSettings(v: unknown, where: string): void {
  if (v === undefined || isPlainObject(v)) return;
  throw new RpcRefusal(ERR.INVALID_PARAMS,
    `${where}.settings must be an object; this server cannot enforce ${SETTINGS_KEY} through a settings file path`);
}

/** Rewrite the `settings` value of an argv map, honoring both spellings the CLI accepts:
 *  `{settings: "<json>"}` and the equals-encoded `{"settings=<json>": null}`. Returns a NEW map. */
function withArgvSettings(args: Record<string, unknown> | undefined, value: CrossSessionInbound): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args ?? {})) {
    if (k === REPLAY_FLAG) continue;              // ours now — stripped, then re-added below
    if (k !== "settings" && !k.startsWith("settings=")) { out[k] = v; continue; }
    const raw = k.startsWith("settings=") ? k.slice("settings=".length) : String(v ?? "");
    let obj: unknown;
    try { obj = JSON.parse(raw); } catch {
      // Unparseable means it is a PATH (the flag accepts either), which lands in the same hole as door 4.
      throw new RpcRefusal(ERR.INVALID_PARAMS,
        `extraArgs.settings must be inline JSON; this server cannot enforce ${SETTINGS_KEY} through a settings file path`);
    }
    if (!isPlainObject(obj)) throw new RpcRefusal(ERR.INVALID_PARAMS, "extraArgs.settings must be a JSON object");
    // Re-emitted under the PLAIN key whichever spelling arrived: one canonical carrier per map, so a
    // config that used the equals form cannot end up with two `settings` flags disagreeing.
    out.settings = JSON.stringify({ ...obj, [SETTINGS_KEY]: value });
  }
  // `--replay-user-messages` is what makes an inbound peer message visible in the stream at all
  // (probe 117). It is passed on EVERY thread, refusing ones included: `refuse` is verified by observing
  // that nothing arrives, and an invisible stream cannot tell "refused" from "never sent". A
  // client-supplied copy is dropped above and re-stated here so its VALUE is ours, not theirs.
  out[REPLAY_FLAG] = null;
  return out;
}

/** The one place the policy is stamped into a config. Returns a new config; never mutates the input.
 *
 *  Call this at admission and write BOTH results in the same statement — `record.config` (which every
 *  replacement engine is rebuilt from, via rewind.ts's `swapBaseConfig`) and `record.crossSessionInbound`
 *  (the arrival path's cheap read). They are one fact; storing one without the other is how a swap
 *  silently restores the launch policy.
 *
 *  Throws `RpcRefusal`, which dispatch's catch answers with the code and message intact — the same
 *  contract `admitDeclarations` (server.ts) already relies on, and for the same reason: a refusal that
 *  reached the client as -32603 "internal error" would name nothing it could fix. */
export function applyPeerPolicy(config: Record<string, unknown> | undefined, value: CrossSessionInbound): Record<string, unknown> {
  const src = config ?? {};
  assertSanitizableSettings(src.settings, "config");
  const hatch = isPlainObject(src.extraOptions) ? src.extraOptions : undefined;
  if (src.extraOptions !== undefined && !hatch) throw new RpcRefusal(ERR.INVALID_PARAMS, "config.extraOptions must be an object");
  if (hatch) assertSanitizableSettings(hatch.settings, "config.extraOptions");

  const out: Record<string, unknown> = { ...src };
  out.settings = { ...(isPlainObject(src.settings) ? src.settings : {}), [SETTINGS_KEY]: value };
  out.extraArgs = withArgvSettings(isPlainObject(src.extraArgs) ? src.extraArgs : undefined, value);
  if (hatch) {
    out.extraOptions = {
      ...hatch,
      settings: { ...(isPlainObject(hatch.settings) ? hatch.settings : {}), [SETTINGS_KEY]: value },
      ...(hatch.extraArgs !== undefined
        ? { extraArgs: withArgvSettings(isPlainObject(hatch.extraArgs) ? hatch.extraArgs : undefined, value) }
        : {}),
    };
  }
  return out;
}
