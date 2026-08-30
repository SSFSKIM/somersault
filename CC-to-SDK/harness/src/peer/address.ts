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

/** The envelope tags in the INBOUND direction — `buildEnvelope`'s mirror, and deliberately its neighbour so
 *  the grammar cannot drift between two files that would otherwise each hold half of it. It is a DECODER and
 *  never a RECOGNISER: see `peerArrival` on why that distinction is the whole point.
 *
 *  THERE ARE TWO GRAMMARS, and only one of them is ours. A scan of every peer row on this machine
 *  (2026-08-30, 5,676 transcripts, 103 rows with `origin.kind === "peer"`) found 79 wrapped in
 *  `<agent-message from="…">` rather than the `<cross-session-message …>` this file writes — the CLI's own
 *  wrapper for an AGENT peer, where ours is the wrapper for a SESSION peer. A decoder that knew only the tag
 *  it writes was blind to three quarters of the real corpus. It rendered them correctly anyway by falling
 *  through to `origin.body`, which is precisely why the gap stayed invisible until that fallback had to
 *  narrow (see `peerArrival`): a fallback can hide a missing grammar for as long as it is the wrong answer
 *  in no measured case, and not one moment longer. */
const ENVELOPE_TAG = /<(cross-session-message|agent-message)\s[^>]*>|<\/(cross-session-message|agent-message)>/g;

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
 *  last closing tag inside it, which keeps an unbalanced quote from truncating its host as well.
 *
 *  Depth is counted PER TAG NAME, now that there are two grammars. An envelope of one grammar quoting the
 *  other's tags — a peer forwarding what a subagent sent it, which is ordinary traffic — must not have its
 *  host closed by a tag that never opened it, and two siblings of different grammars in one collapsed frame
 *  must still read as two. Tracking the name of the OUTERMOST open tag and ignoring every tag that is not
 *  that name gives both, and is what a single shared depth counter would get wrong in opposite directions.
 *
 *  EXPORTED for the SENDER's round-trip refusal (`appserver/peerDomain.ts`): the decoder is the authority on
 *  what a receiver reads back, so `peer/send` asks this function — not a second opinion about tags — whether
 *  the body it is about to wrap comes back apart as itself. */
export function envelopeBodies(raw: string): string[] {
  const tag = new RegExp(ENVELOPE_TAG.source, "g");                // fresh: a shared /g regex carries lastIndex
  const bodies: string[] = [];
  let depth = 0, start = -1, lastClose = -1, name = "";
  for (let m = tag.exec(raw); m; m = tag.exec(raw)) {
    const opening = m[1] !== undefined;
    const tagName = m[1] ?? m[2];
    if (opening) {
      if (depth === 0) { name = tagName; start = tag.lastIndex; lastClose = -1; depth = 1; }
      else if (tagName === name) depth++;
    } else if (depth > 0 && tagName === name) {
      lastClose = m.index;
      if (--depth === 0) bodies.push(unwrapBody(raw.slice(start, m.index)));
    }
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
 *  THE TEXT IS WHAT THE FRAME ITSELF CARRIES: its own envelopes, else its own raw text, and `origin.body`
 *  ONLY when the frame carries no text at all. That is a DELIBERATE DEVIATION from the SDK's guidance, which
 *  says to render `origin.body` "instead of re-parsing the message text" — right for a single message, and
 *  measurably wrong for a BATCH, where `origin.body` is the CAUSING message's text repeated across every
 *  frame of the batch. ONE measurement says so, and one thing that looked like a second does not:
 *
 *   1  COLLAPSE — measured, and the only sighting this deviation rests on. Probe 121
 *      (probes/probes/121-batch-arrival-attribution.ts, CLI 2.1.250) sent three messages the engine folded
 *      into two turns. Three sent messages left two rows, one carrying TWO envelopes (M2 and M3) under one
 *      uuid while its `origin.body` named only M2 — so M3's text exists in no `origin.body` anywhere, and
 *      preferring that field renders one message under another's id while destroying the other, though the
 *      model was given all three.
 *   2  WITHDRAWN — an envelope-less batch member was never observed. LEG 10 of
 *      test/live/appserver-cross-session.test.ts went red on 2026-08-30 and was read here as exactly that
 *      shape: a batch whose arrival items all rendered the FIRST message's `origin.body`. That reading was
 *      wrong. The reported text is ONE body, not three joined copies, so there was ONE arrival item and not
 *      three — the other two were withheld by an unresolvable anchor and never rendered at all (M9 spec,
 *      M13: an arrival was advancing the observer's anchor onto itself, so every batch member after the
 *      first named a row the transcript reader drops). Probe 121's keyed burst, the only direct measurement
 *      of the question, saw ZERO envelope-less frames (counts 1/1/2). The shape stays a stated unknown.
 *
 *  SO THE ORDER DOES NOT REST ON THAT SIGHTING, AND NEVER NEEDED TO. `origin.body` is a claim about a
 *  message SOME frame carried; the frame's own text is a fact about THIS frame. Preferring the fact is right
 *  for a lone message and right for a batch member, so this function does not have to know which it holds —
 *  which is just as well, since it is pure and sees one frame while the evidence of a batch lives across
 *  frames. The residual is narrow and named: a batch member carrying NO text would still return another
 *  message's `origin.body`. No such frame has been observed, and rendering nothing instead would break the
 *  ordinary single-message case, where `origin.body` is the only text there is and is correct.
 *
 *  PREFERRING THE FRAME'S OWN TEXT IS ONLY SAFE BECAUSE THE GRAMMAR ABOVE IS COMPLETE. Every peer row in the
 *  MAIN corpus carries the CLI's wrapper — a preamble, the envelope, and a 560-character safety postamble the
 *  peer did not write — and 79 of the 103 use `<agent-message …>`, which this decoder did not know until now.
 *  MAIN is `~/.claude/projects/<slug>/*.jsonl`, what `getSessionMessages` reads, and NOT the nested
 *  `subagents/` and `wf_…` transcripts only other readers open (2026-08-30: 5,676 files scanned, 103 peer
 *  rows; the nested corpora hold 121 more, every one of them the second grammar). Preferring raw text under the old
 *  one-grammar decoder would have rendered that boilerplate as the peer's message on three quarters of the
 *  corpus. With both grammars decoded, the new rule renders text IDENTICAL to the old one on all 103 rows
 *  (measured by replaying both rules over the corpus), and differs only where the frame carries text in a
 *  grammar nobody has seen — where a visibly over-rendered message is the honest outcome and a silently
 *  substituted one is not.
 *
 *  Sibling envelopes are JOINED rather than reduced to the first: the first is an arbitrary member of a
 *  collapsed batch, so picking it would destroy the rest exactly as `origin.body` does. One frame really did
 *  carry both messages, so one item carrying both texts is the faithful rendering — splitting them would
 *  need a second id the announcement never used and nothing could dedupe against.
 *
 *  WHAT THIS STILL DOES NOT CLAIM: which message an arrival uuid NAMES. Identity remains non-bijective —
 *  probe 121's verdict C, re-confirmed on 2026-08-30: one frame carried two messages and one announced
 *  arrival persisted no row at all. This rule is about TEXT ONLY: what is rendered is what that frame
 *  carried. `origin` is forwarded verbatim beside it and says what the engine claims, which in a batch is
 *  the causing message — the two are deliberately not reconciled here, because reconciling them would mean
 *  inventing an attribution the data does not contain. */
export function peerArrival(frame: unknown): PeerArrival | undefined {
  const f = frame as any;
  if (f?.type !== "user") return undefined;
  const origin = f.origin && typeof f.origin === "object" ? (f.origin as Record<string, unknown>) : undefined;
  if (origin?.kind !== "peer") return undefined;
  const content = f.message?.content;
  const raw = rawTextOf(content);
  const envelopes = envelopeBodies(raw);
  // A frame with NO content carries no text, whatever `rawTextOf` returns for it: that path JSON-stringifies
  // and yields the two-character string `""`, which must never outrank a body the framer did supply.
  const own = content === undefined || content === null ? "" : raw;
  const body = envelopes.length ? envelopes.join("\n\n")
    : own.trim() !== "" ? own
      : typeof origin.body === "string" ? origin.body : raw;
  return {
    // ONE ceiling, applied on every input shape. The body is written by a process this server does not
    // control, and a cap enforced on one path only is a cap that changes what a message says depending on
    // who is reading it.
    text: body.slice(0, MAX_FRAME_CHARS),
    uuid: typeof f.uuid === "string" ? f.uuid : undefined,
    origin,
  };
}
