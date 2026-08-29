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

/** The envelope's two tags in the INBOUND direction — `buildEnvelope`'s mirror, and deliberately its
 *  neighbour so the grammar cannot drift between two files that would otherwise each hold half of it. It is
 *  a DECODER and never a RECOGNISER: see `peerArrival` on why that distinction is the whole point. */
const ENVELOPE_TAG = /<cross-session-message\s[^>]*>|<\/cross-session-message>/g;

/** `buildEnvelope` writes the body as `\n${body}\n`. Undoing exactly that one wrapping pair — never more —
 *  is what makes a row read as the body the framer would have decoded. */
const unwrapBody = (s: string): string => s.replace(/^\n/, "").replace(/\n$/, "");

/** Every TOP-LEVEL envelope body in a frame's text, in order — a depth-counting scan rather than a regex
 *  capture, because both of the obvious captures are measurably wrong on this machine's own transcripts:
 *
 *  * a LAZY capture stops at the FIRST closing tag, so a peer whose body quotes or forwards an envelope
 *    (the M8 scan found 52 rows carrying a complete envelope in their text, only 12 of them arrivals — the
 *    rest quote one, code reviews of this very work among them) is silently TRUNCATED at the inner tag.
 *  * a GREEDY capture — equivalently, a scan to the last closing tag — runs to the FINAL tag, which merges
 *    SIBLING envelopes. That is not hypothetical either: probe 121's batch row (uuid 42364455…) persists
 *    two whole envelopes back to back in one row's content, and greedy returns 1067 characters of two
 *    bodies with the intervening tags still in them.
 *
 *  Counting depth is the only rule that reads both correctly: a quoted envelope stays inside its host's
 *  body verbatim, and siblings stay separate. An opening tag the text never closes is terminated at the
 *  last closing tag inside it, which keeps an unbalanced quote from truncating its host as well. */
function envelopeBodies(raw: string): string[] {
  const tag = new RegExp(ENVELOPE_TAG.source, "g");                // fresh: a shared /g regex carries lastIndex
  const bodies: string[] = [];
  let depth = 0, start = -1, lastClose = -1;
  for (let m = tag.exec(raw); m; m = tag.exec(raw)) {
    if (m[0][1] !== "/") { if (depth === 0) { start = tag.lastIndex; lastClose = -1; } depth++; }
    else if (depth > 0) { lastClose = m.index; if (--depth === 0) bodies.push(unwrapBody(raw.slice(start, m.index))); }
  }
  if (depth > 0 && lastClose > start) bodies.push(unwrapBody(raw.slice(start, lastClose)));
  return bodies;
}

/** The text a frame carries, before any envelope is considered. A block array is joined on its text blocks
 *  rather than JSON-stringified: stringifying turns a real newline into the two characters `\` and `n`, so
 *  the envelope's own line breaks would survive into what a user reads. */
/** EXPORTED for M9's anchor fingerprint (peer/arrivalLog.ts's `contentHash16` hashes exactly this): the
 *  live observer hashes a FRAME's content and the read side hashes a ROW's, and the two must be the same
 *  bytes or every anchor withholds. One function is what makes that true by construction rather than by
 *  two transcriptions agreeing. */
export const rawTextOf = (content: unknown): string =>
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
 *  as unattributed and fails closed". Failing to recognise an unstamped arrival degrades it to a visibly raw
 *  message; falsely recognising one silently destroys a message nobody sent. The envelope below is read only
 *  AFTER this gate has said "peer", to learn what an arrival SAYS — never to decide that it is one.
 *
 *  THE TEXT IS THE FRAME'S OWN ENVELOPES, and `origin.body` only when the frame carries none. That is a
 *  DELIBERATE DEVIATION from the SDK's guidance, which says to render `origin.body` "instead of re-parsing
 *  the message text" — right for a single message, and measurably wrong for a BATCH. Probe 121
 *  (probes/probes/121-batch-arrival-attribution.ts, CLI 2.1.250) sent three messages that the engine folded
 *  into two turns, and the engine COLLAPSES such a batch: three sent messages left two rows, one of them
 *  carrying TWO envelopes (M2 and M3) under one uuid while its `origin.body` named only M2. So M3's text
 *  exists in no `origin.body` anywhere, and preferring that field renders one message's text under another
 *  message's id while the other message is destroyed — the model was given all three.
 *
 *  Preferring the envelope is safe because it is not a different answer anywhere it is not the batch: over
 *  all 170 peer rows on this machine (107 files) this rule returns byte-identical text on 169 and differs on
 *  exactly one — probe 121's own batch row, where it recovers the message that was otherwise unrecoverable.
 *  150 of those rows carry `origin.body` and NO envelope, which is why the fallback stays.
 *
 *  Sibling envelopes are JOINED rather than reduced to the first: the first is an arbitrary member of a
 *  collapsed batch, so picking it would destroy the rest exactly as `origin.body` does. One frame really did
 *  carry both messages, so one item carrying both texts is the faithful rendering — splitting them would
 *  need a second id the announcement never used and nothing could dedupe against.
 *
 *  THE LIMIT THIS DOES NOT CLOSE: an arrival that batches and carries NO envelope. Such a frame falls back
 *  to `origin.body`, which in a batch is the CAUSING message's text — and `peerArrival` cannot detect the
 *  case, because it is pure and sees ONE frame while the evidence for a batch is a repeated `msg_id` ACROSS
 *  frames, which only the caller can see. No frame in the measured corpus is both envelope-less and batched;
 *  this is a documented limit rather than an oversight, and guessing would be worse than naming it. */
export function peerArrival(frame: unknown): PeerArrival | undefined {
  const f = frame as any;
  if (f?.type !== "user") return undefined;
  const origin = f.origin && typeof f.origin === "object" ? (f.origin as Record<string, unknown>) : undefined;
  if (origin?.kind !== "peer") return undefined;
  const raw = rawTextOf(f.message?.content);
  const envelopes = envelopeBodies(raw);
  const body = envelopes.length ? envelopes.join("\n\n") : typeof origin.body === "string" ? origin.body : raw;
  return {
    // ONE ceiling, applied on every input shape. The body is written by a process this server does not
    // control, and a cap enforced on one path only is a cap that changes what a message says depending on
    // who is reading it.
    text: body.slice(0, MAX_FRAME_CHARS),
    uuid: typeof f.uuid === "string" ? f.uuid : undefined,
    origin,
  };
}
