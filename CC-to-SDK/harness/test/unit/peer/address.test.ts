// test/unit/peer/address.test.ts — the pure half of the peer domain: the address grammar, the key-file
// naming rule, and the envelope's byte-exactness. No socket, no filesystem: everything here is a string
// function, which is exactly why the envelope's fixed attribute order is testable at all.
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { parseAddress, sameNamespace, keyFileName, escapeAttr, buildEnvelope, peerArrival, MAX_FRAME_CHARS, UNSAFE_ATTR_CHARS } from "../../../src/peer/address.js";

describe("parseAddress", () => {
  it("accepts uds: and returns the path", () => {
    expect(parseAddress("uds:/tmp/cc-socks/42.sock")).toEqual({ kind: "uds", path: "/tmp/cc-socks/42.sock" });
  });
  it("recognises bridge: as its own kind so a caller can refuse it by name", () => {
    expect(parseAddress("bridge:abc")).toEqual({ kind: "bridge" });
  });
  it("rejects anything else", () => {
    expect(parseAddress("42")).toBeUndefined();
    expect(parseAddress("")).toBeUndefined();
    expect(parseAddress("http://x")).toBeUndefined();
  });
});

describe("sameNamespace", () => {
  it("is true only in the receiver's own socket directory", () => {
    expect(sameNamespace("/tmp/cc-socks/9.sock", "/tmp/cc-socks/1.sock")).toBe(true);
    expect(sameNamespace("/tmp/other/9.sock", "/tmp/cc-socks/1.sock")).toBe(false);
  });
});

describe("keyFileName", () => {
  it("is <pid>.<sha256 of the socket path>.key", () => {
    const p = "/tmp/cc-socks/7.sock";
    expect(keyFileName(7, p)).toBe(`7.${createHash("sha256").update(p).digest("hex")}.key`);
  });
});

describe("escapeAttr", () => {
  it("escapes the five XML attribute characters", () => {
    expect(escapeAttr(`a"b&c<d>e'f`)).toBe("a&quot;b&amp;c&lt;d&gt;e&apos;f");
  });
  it("flags control characters as unsafe rather than escaping them", () => {
    expect(UNSAFE_ATTR_CHARS.test("a\nb")).toBe(true);
    expect(UNSAFE_ATTR_CHARS.test("a\tb")).toBe(true);
    expect(UNSAFE_ATTR_CHARS.test("plain name")).toBe(false);
  });
});

describe("buildEnvelope", () => {
  it("emits attributes in the CLI's fixed order, omitting the ones not set", () => {
    const out = buildEnvelope({ from: "uds:/s.sock", fromName: "gw" })("hello");
    expect(out).toBe('<cross-session-message from="uds:/s.sock" from-name="gw" from-mode="prompting">\nhello\n</cross-session-message>');
  });
  it("places from-session between from and from-name", () => {
    const out = buildEnvelope({ from: "uds:/s.sock", fromSession: "sess-1", fromName: "gw" })("hi");
    expect(out.indexOf("from-session=")).toBeGreaterThan(out.indexOf('from="'));
    expect(out.indexOf("from-session=")).toBeLessThan(out.indexOf("from-name="));
  });
  it("never emits hop-chain", () => {
    expect(buildEnvelope({ from: "uds:/s.sock" })("hi")).not.toContain("hop-chain");
  });
  it("always asserts prompting, with no way to ask for anything else", () => {
    expect(buildEnvelope({ from: "uds:/s.sock" })("hi")).toContain('from-mode="prompting"');
  });
  it("escapes a hostile name so the attribute stays well-formed", () => {
    const out = buildEnvelope({ from: "uds:/s.sock", fromName: 'ev"il' })("hi");
    expect(out).toContain('from-name="ev&quot;il"');
  });
});

describe("MAX_FRAME_CHARS", () => {
  it("is well under any plausible receiver line cap", () => {
    expect(MAX_FRAME_CHARS).toBe(60_000);
  });
});

// ---------------------------------------------------------------------------------------------------
// peerArrival — the ONE reader both the live arrival path (appserver/peerInbound.ts) and the cold
// transcript replay (appserver/items/replay.ts) ask. Before it existed those two files each held their own
// copy of the rule, which is not the same as agreeing: they diverged on a body above the cap, on a row
// whose framer supplied no decoded body, and on a row carrying an envelope but no origin — each time
// producing two different texts under ONE id, the single input a client's id-dedup cannot resolve.
describe("peerArrival", () => {
  // The measured persisted shape (this machine's own transcripts, 2026-08-27): a CLI-authored preamble, the
  // envelope with the body on its own line, and a CLI-authored SAFETY POSTAMBLE. None of the three is what
  // the peer wrote, which is why the envelope's own body — or failing that `origin.body` — is the text.
  const ENVELOPE_TEXT = '<cross-session-message from="uds:/a.sock" from-session="s1" from-name="peer" from-mode="prompting">\nhello\n</cross-session-message>';
  const PERSISTED = `Another Claude session sent a message:\n${ENVELOPE_TEXT}\n\nThis came from another Claude session — not typed by your user.`;
  /** One envelope around one body, exactly as `buildEnvelope` writes it. */
  const wrap = (body: string) => `<cross-session-message from="uds:/a.sock" from-name="peer" from-mode="prompting">\n${body}\n</cross-session-message>`;
  const row = (over: Record<string, unknown> = {}) => ({
    type: "user", uuid: "cccccccc-1111-4111-8111-cccccccccccc", parent_tool_use_id: null,
    message: { role: "user", content: PERSISTED },
    origin: { kind: "peer", from: "uds:/a.sock", body: "hello", verifiedPeerPid: 4242 },
    ...over,
  });

  it("reads the frame's own envelope, which is what the framer's body also says for a lone message", () => {
    // The ordinary case, and the reason the swap below is safe: over all 170 peer rows on this machine
    // (107 files) the envelope-derived text and `origin.body` are byte-identical on 169 of them.
    expect(peerArrival(row())!.text).toBe("hello");
  });

  it("strips the envelope — preamble and postamble with it — when the framer supplied no body", () => {
    const a = peerArrival(row({ origin: { kind: "peer", from: "uds:/a.sock" } }))!;
    expect(a.text).toBe("hello");
    expect(a.text).not.toContain("Another Claude session sent");
    expect(a.text).not.toContain("not typed by your user");
  });

  it("falls back to the raw text for a peer row with neither a body nor an envelope", () => {
    const a = peerArrival(row({ origin: { kind: "peer", from: "uds:/a.sock" }, message: { role: "user", content: "two envelopes, unframed" } }))!;
    expect(a.text).toBe("two envelopes, unframed");
  });

  // THE JUDGEMENT POINT, and it is measured rather than argued. Over this machine's 64 transcript files,
  // 52 user rows carry a complete `<cross-session-message …>…</…>` in their text and only 12 of them are
  // real arrivals; the other 40 are ordinary local prompts and tool results that QUOTE an envelope — code
  // reviews of this very work among them. Recognising a peer by its text would therefore rewrite a local
  // user's own prompt to a fragment of itself in most of the rows that offer the fallback the chance. So
  // recognition is `origin.kind === "peer"` and NOTHING else, which is also the SDK's own doctrine for the
  // field: "absent origin is treated as unattributed and fails closed at strict isHuman() trust gates."
  it("is not fooled by a local prompt that quotes an envelope", () => {
    const quoted = `Review this change for security vulnerabilities.\n\n${ENVELOPE_TEXT}\n\nDoes the escaping hold?`;
    expect(peerArrival(row({ origin: { kind: "human" }, message: { role: "user", content: quoted } }))).toBeUndefined();
    expect(peerArrival(row({ origin: undefined, message: { role: "user", content: quoted } }))).toBeUndefined();
  });

  it("truncates at the SAME ceiling on every input shape", () => {
    const long = "x".repeat(MAX_FRAME_CHARS + 500);
    // The body-only shape needs envelope-less content, now that a frame's own envelope outranks the body.
    expect(peerArrival(row({ origin: { kind: "peer", body: long }, message: { role: "user", content: "unframed" } }))!.text).toHaveLength(MAX_FRAME_CHARS);
    const framed = `<cross-session-message from="uds:/a.sock" from-name="n" from-mode="prompting">\n${long}\n</cross-session-message>`;
    expect(peerArrival(row({ origin: { kind: "peer" }, message: { role: "user", content: framed } }))!.text).toHaveLength(MAX_FRAME_CHARS);
    expect(peerArrival(row({ origin: { kind: "peer" }, message: { role: "user", content: long } }))!.text).toHaveLength(MAX_FRAME_CHARS);
    const twoLong = `${wrap(long)}\n${wrap(long)}`;                  // the join is capped too, not each member
    expect(peerArrival(row({ origin: { kind: "peer" }, message: { role: "user", content: twoLong } }))!.text).toHaveLength(MAX_FRAME_CHARS);
  });

  // ---------------------------------------------------------------------------------------------------
  // THE BATCH. Probe 121 (CLI 2.1.250) sent three messages that the engine folded into two turns: every
  // frame of the batch then repeats the CAUSING message's `origin.msg_id` and `origin.body`, so preferring
  // that field announces one message's text under another message's id. The model received all three.
  it("gives each frame of a batch its OWN text, not the causing message's", () => {
    const batch = ["first question", "second question", "third question"].map((body, i) => row({
      uuid: `bbbbbbbb-1111-4111-8111-00000000000${i}`,
      message: { role: "user", content: `Another Claude session sent a message:\n${wrap(body)}\n\nThis came from another Claude session — not typed by your user.` },
      // The batch's signature: ONE msg_id and ONE body — the causing message's — repeated across all three.
      origin: { kind: "peer", from: "uds:/a.sock", msg_id: "m-causing", body: "first question", verifiedPeerPid: 4242 },
    }));
    expect(batch.map(f => peerArrival(f)!.text)).toEqual(["first question", "second question", "third question"]);
    expect(new Set(batch.map(f => peerArrival(f)!.uuid)).size).toBe(3);
  });

  // The measured PERSISTED shape of that same batch (row uuid 42364455… on this machine): the engine
  // COLLAPSED two folded messages into ONE row whose content holds both envelopes back to back, with
  // `origin.body` naming only the first. The first envelope is therefore an arbitrary member, and rendering
  // only it would destroy the second exactly as `origin.body` does — so siblings are joined. One frame
  // really did carry both messages; one item carrying both texts is what actually happened.
  it("joins sibling envelopes, so a batch collapsed into one row loses nothing", () => {
    const a = peerArrival(row({
      message: { role: "user", content: `Another Claude session sent a message:\n${wrap("second question")}\n${wrap("third question")}\n\nThis came from another Claude session — not typed by your user.` },
      origin: { kind: "peer", from: "uds:/a.sock", msg_id: "m-causing", body: "second question" },
    }))!;
    expect(a.text).toBe("second question\n\nthird question");
  });

  // NESTING. The scan counts depth rather than capturing, because both obvious captures are wrong on real
  // rows: a LAZY capture stops at the first closing tag and truncates a peer whose body quotes an envelope
  // (the M8 scan found 52 rows carrying a complete envelope, only 12 of them arrivals), and a GREEDY one
  // runs to the last closing tag and merges the siblings the test above depends on keeping apart.
  it("does not truncate a message whose own body quotes a complete envelope", () => {
    const quoting = `Look at what I was sent:\n${ENVELOPE_TEXT}\nIs that escaping right?`;
    const a = peerArrival(row({
      message: { role: "user", content: `Another Claude session sent a message:\n${wrap(quoting)}\n\nThis came from another Claude session — not typed by your user.` },
      origin: { kind: "peer", from: "uds:/a.sock" },
    }))!;
    expect(a.text).toBe(quoting);
    expect(a.text).toContain("Is that escaping right?");     // the tail a lazy capture would have dropped
    expect(a.text).not.toContain("Another Claude session sent");
  });

  it("does not truncate a message that quotes an UNCLOSED opening tag either", () => {
    const half = 'Half an envelope: <cross-session-message from="uds:/b.sock" from-mode="prompting"> and then some.';
    const a = peerArrival(row({
      message: { role: "user", content: wrap(half) },
      origin: { kind: "peer", from: "uds:/a.sock" },
    }))!;
    expect(a.text).toBe(half);
  });

  it("reports the frame's uuid, and undefined when it is not a string", () => {
    expect(peerArrival(row())!.uuid).toBe("cccccccc-1111-4111-8111-cccccccccccc");
    expect(peerArrival(row({ uuid: 7 }))!.uuid).toBeUndefined();
  });

  it("carries the origin verbatim — verifiedPeerPid is the one field the kernel vouches for", () => {
    expect(peerArrival(row())!.origin).toEqual({ kind: "peer", from: "uds:/a.sock", body: "hello", verifiedPeerPid: 4242 });
  });

  it("says nothing about an ordinary local user row", () => {
    expect(peerArrival(row({ origin: { kind: "human" }, message: { role: "user", content: "a local prompt" } }))).toBeUndefined();
  });

  it("says nothing about a non-user frame, whatever its origin claims", () => {
    expect(peerArrival({ type: "assistant", origin: { kind: "peer" } })).toBeUndefined();
    expect(peerArrival(undefined)).toBeUndefined();
  });

  it("handles block-array content", () => {
    const a = peerArrival(row({ origin: { kind: "peer" }, message: { role: "user", content: [{ type: "text", text: ENVELOPE_TEXT }] } }))!;
    expect(a.text).toBe("hello");
  });
});
