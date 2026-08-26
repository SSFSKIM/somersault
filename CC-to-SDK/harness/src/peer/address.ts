// src/peer/address.ts — the pure half of the peer domain. Everything here is a string function, which is
// deliberate: the envelope's correctness is a BYTE property (the receiver re-serializes what it parsed and
// requires equality before honouring any attribute), and a byte property is only testable when nothing
// else is in the way.
import { createHash } from "node:crypto";
import { dirname } from "node:path";

/** The CLI's address grammar is lexical, not a lookup: `uds:<path>` | `bridge:<...>`. A session id is NOT
 *  an address in any namespace — the mistake probe 110 made, and the reason its "not addressable"
 *  conclusion had to be retracted. `bridge:` is recognised so callers can refuse it BY NAME: it is the
 *  cross-machine path, governed by a different setting (`isolatePeerMachines`) and never measured here. */
export function parseAddress(addr: string): { kind: "uds"; path: string } | { kind: "bridge" } | undefined {
  if (addr.startsWith("uds:")) { const path = addr.slice(4); return path ? { kind: "uds", path } : undefined; }
  if (addr.startsWith("bridge:")) return { kind: "bridge" };
  return undefined;
}

/** The receipt sender refuses any reply address outside the receiver's own socket DIRECTORY (measured,
 *  probe 117b). So this is a correctness test, not a convention: a listener anywhere else can be sent to
 *  and can never be answered. */
export function sameNamespace(addrPath: string, ourSocketPath: string): boolean {
  return dirname(addrPath) === dirname(ourSocketPath);
}

/** `<pid>.<sha256(socket path)>.key`. The hash is of the socket PATH — derived in probe 117 by testing
 *  candidate rules against a real session's published file rather than by guessing. */
export function keyFileName(pid: number, socketPath: string): string {
  return `${pid}.${createHash("sha256").update(socketPath).digest("hex")}.key`;
}

/** Characters we will not put in an attribute at all: the C0 controls and DEL. The receiver compares a
 *  canonical RESERIALIZATION, so a newline or tab that we escape one way and it re-emits another silently
 *  downgrades the whole envelope to plain text — which drops the permission attribution and changes the
 *  delivery decision with nothing raised anywhere. Refusing is recoverable; a silent downgrade is not. */
export const UNSAFE_ATTR_CHARS = /[\u0000-\u001f\u007f]/;

/** The five XML attribute entities. Measured spelling for these is a delegated unknown the spec names;
 *  until a probe pins the receiver's canonical form, only these five are permitted and everything in
 *  UNSAFE_ATTR_CHARS is refused upstream. */
export function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/** Our own conservative frame cap. The CLI's sender preflights size and refuses with both figures named,
 *  but that preflight belongs to the path we do not use — we write the socket directly, so an oversize
 *  line meets the RECEIVER's length cap, which drops it before the JSON is parsed and tells nobody. The
 *  receiver's real cap is unmeasured; this is set low enough that nothing we accept can reach it. */
export const MAX_FRAME_CHARS = 60_000;

/** The envelope, with the CLI's FIXED attribute order: from, from-session, hop-chain, from-name,
 *  from-mode. `hop-chain` is never set — it is for relayed traffic, and nothing here relays. `from-mode`
 *  is always "prompting": this gateway runs no model and asks no permission, so any other claim would be
 *  a false statement about the one attribute the recipient uses to decide. */
export function buildEnvelope(a: { from: string; fromSession?: string; fromName?: string }): (body: string) => string {
  const attrs = [`from="${escapeAttr(a.from)}"`];
  if (a.fromSession !== undefined) attrs.push(`from-session="${escapeAttr(a.fromSession)}"`);
  if (a.fromName !== undefined) attrs.push(`from-name="${escapeAttr(a.fromName)}"`);
  attrs.push(`from-mode="prompting"`);
  const open = `<cross-session-message ${attrs.join(" ")}>`;
  return (body: string) => `${open}\n${body}\n</cross-session-message>`;
}
