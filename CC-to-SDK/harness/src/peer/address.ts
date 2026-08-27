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

/** The envelope in the INBOUND direction — `buildEnvelope`'s mirror, and deliberately its neighbour so the
 *  grammar cannot drift between two files that would otherwise each hold half of it. It is a DECODER and
 *  never a RECOGNISER: see `peerArrival` on why that distinction is the whole point. */
const ENVELOPE = /<cross-session-message\s[^>]*>([\s\S]*?)<\/cross-session-message>/;

/** `buildEnvelope` writes the body as `\n${body}\n`. Undoing exactly that one wrapping pair — never more —
 *  is what makes a row the framer left no `body` on read as the body the framer would have decoded. */
const unwrapBody = (s: string): string => s.replace(/^\n/, "").replace(/\n$/, "");

/** The text a frame carries, before any envelope is considered. A block array is joined on its text blocks
 *  rather than JSON-stringified: stringifying turns a real newline into the two characters `\` and `n`, so
 *  the envelope's own line breaks would survive into what a user reads. */
const rawTextOf = (content: unknown): string =>
  typeof content === "string" ? content
    : Array.isArray(content) ? content.map((b: any) => (typeof b?.text === "string" ? b.text : "")).join("\n")
      : JSON.stringify(content ?? "");

export interface PeerArrival {
  text: string;
  /** The frame's own uuid, or `undefined` when the frame carries none usable. What to do about that is the
   *  CALLER's: the live path must mint one, and the cold path has no id to mint that a client could match. */
  uuid: string | undefined;
  /** Verbatim. `verifiedPeerPid` is the only field in this exchange the kernel vouches for — `from` is
   *  sender-authored and forgeable by any same-user process — so re-deriving it would replace a verified
   *  fact with this server's opinion of it. */
  origin: Record<string, unknown>;
}

/** What a frame IS, when it is a cross-session arrival — and `undefined` when it is not.
 *
 *  ONE reader for both paths (the live `onFrame` observer in appserver/peerInbound.ts and the cold
 *  transcript replay in appserver/items/replay.ts). Before this existed the two agreed by construction,
 *  which is not the same as agreeing: they diverged on a body above the cap, on a row whose framer supplied
 *  no decoded body, and on a row carrying an envelope but no origin — each time producing two different
 *  texts under ONE id, which is exactly the input a client's id-dedup cannot resolve.
 *
 *  RECOGNITION IS `origin.kind === "peer"` AND NOTHING ELSE. An earlier envelope-text fallback was measured
 *  against this machine's own transcripts (2026-08-27, 64 files): 52 user rows carry a complete
 *  `<cross-session-message …>…</…>` in their text and only 12 are real arrivals — the other 40 are ordinary
 *  local prompts and tool results that QUOTE an envelope, code reviews of this very work among them. Text
 *  recognition would rewrite a local user's own prompt to a fragment of itself, which is strictly worse
 *  than the divergences it was meant to close. It is also what the SDK says: an absent `origin` "is treated
 *  as unattributed and fails closed", and `origin.body` is to be rendered "instead of re-parsing the
 *  message text". Failing to recognise an unstamped arrival degrades it to a visibly raw message; falsely
 *  recognising one silently destroys a message nobody sent.
 *
 *  The TEXT is the framer's `body` when it supplied one — documented byte-exact with what the model saw —
 *  else the envelope's own capture, which also drops the CLI-authored preamble and safety postamble that
 *  the peer did not write, else the raw text. */
export function peerArrival(frame: unknown): PeerArrival | undefined {
  const f = frame as any;
  if (f?.type !== "user") return undefined;
  const origin = f.origin && typeof f.origin === "object" ? (f.origin as Record<string, unknown>) : undefined;
  if (origin?.kind !== "peer") return undefined;
  const raw = rawTextOf(f.message?.content);
  const envelope = ENVELOPE.exec(raw);
  const body = typeof origin.body === "string" ? origin.body : envelope ? unwrapBody(envelope[1]) : raw;
  return {
    // ONE ceiling, applied on every input shape. The body is written by a process this server does not
    // control, and a cap enforced on one path only is a cap that changes what a message says depending on
    // who is reading it.
    text: body.slice(0, MAX_FRAME_CHARS),
    uuid: typeof f.uuid === "string" ? f.uuid : undefined,
    origin,
  };
}
