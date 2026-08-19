// test/unit/appserver/search-scan.test.ts
import { describe, it, expect } from "vitest";
import { SEARCH_CAPS, sortForSearch, sortValueOf, compareTuple, encodeSearchCursor, decodeSearchCursor, encodeOccCursor, decodeOccCursor, rowSearchText, makeSnippet, originalSpan } from "../../../src/appserver/searchScan.js";

describe("searchScan", () => {
  it("compareTuple: nulls last both directions; sessionId tiebreak asc", () => {
    const t = (v: number | null, s: string) => ({ v, s });
    expect(compareTuple(t(1, "a"), t(2, "a"), "asc")).toBeLessThan(0);
    expect(compareTuple(t(1, "a"), t(2, "a"), "desc")).toBeGreaterThan(0);
    expect(compareTuple(t(null, "a"), t(1, "z"), "asc")).toBeGreaterThan(0);
    expect(compareTuple(t(null, "a"), t(1, "z"), "desc")).toBeGreaterThan(0);
    expect(compareTuple(t(5, "a"), t(5, "b"), "desc")).toBeLessThan(0);
  });
  it("sortForSearch rides compareTuple: created_at asc oldest-first, missing createdAt last, id ties", () => {
    const rows = [
      { sessionId: "b", createdAt: 200, lastModified: 1 }, { sessionId: "a", createdAt: 200, lastModified: 2 },
      { sessionId: "c", createdAt: 100, lastModified: 3 }, { sessionId: "d", lastModified: 4 },
    ];
    const vo = (r: any) => sortValueOf(r, "created_at");
    expect(sortForSearch(rows, "asc", vo).map((r) => r.sessionId)).toEqual(["c", "a", "b", "d"]);
    expect(sortForSearch(rows, "desc", vo).map((r) => r.sessionId)).toEqual(["a", "b", "c", "d"]);
  });
  it("both cursor codecs round-trip and reject garbage AND each other", () => {
    const c = { v: 123, s: "sess", r: 7 };
    expect(decodeSearchCursor(encodeSearchCursor(c))).toEqual(c);
    expect(decodeSearchCursor("not-a-cursor")).toBeNull();
    const o = { s: "x", r: 3, c: 17, e: 2 };
    expect(decodeOccCursor(encodeOccCursor(o))).toEqual(o);
    expect(decodeOccCursor(encodeOccCursor({ s: "x", r: 0, c: 0, e: null }))!.e).toBeNull();
    expect(decodeOccCursor(encodeSearchCursor(c))).toBeNull();
    expect(decodeSearchCursor(encodeOccCursor(o))).toBeNull();
  });
  it("rowSearchText: prompts + assistant text are corpus; tool_results and echoes are not", () => {
    expect(rowSearchText({ type: "user", uuid: "u1", message: { content: "hello world" } })).toBe("hello world");
    expect(rowSearchText({ type: "assistant", message: { content: [{ type: "text", text: "found it" }, { type: "tool_use", name: "X", input: {} }] } })).toBe("found it");
    expect(rowSearchText({ type: "user", message: { content: [{ type: "tool_result", content: "noise" }] } })).toBeNull();
    expect(rowSearchText({ type: "user", uuid: "u2", message: { content: "<command-name>/clear</command-name>" } })).toBeNull();
  });
  it("makeSnippet: centered, capped at max(200, termLen), range indexes the snippet — a 256-unit term fits", () => {
    const long = "x".repeat(500) + "NEEDLE" + "y".repeat(500);
    const { snippet, snippetMatchRange } = makeSnippet(long, 500, 6);
    expect(snippet.length).toBeLessThanOrEqual(SEARCH_CAPS.snippetMax);
    expect(snippet.slice(snippetMatchRange.start, snippetMatchRange.end)).toBe("NEEDLE");
    const bigTerm = "T".repeat(256);
    const r2 = makeSnippet("a".repeat(50) + bigTerm + "b".repeat(50), 50, 256);
    expect(r2.snippet.slice(r2.snippetMatchRange.start, r2.snippetMatchRange.end)).toBe(bigTerm);
  });
});

// ── Task 6 hardening rows ──────────────────────────────────────────────────────────────────────────────
// The five rows above are the brief's. These exist because search is text processing over UNTRUSTED
// transcript content and client-supplied cursors, and because three of the brief's own assertions turned
// out not to defend the mechanism their title names (documented per row). Every row here was checked by
// breaking the mechanism it guards and confirming it goes red — see the task report for the sabotage log.
describe("searchScan — ordering under adversarial and equal keys", () => {
  const vo = (r: { createdAt?: number }) => sortValueOf({ ...r, lastModified: 0 }, "created_at");

  it("compareTuple is a consistent total order over finite and null values (generated sweep)", () => {
    // A comparator is only usable by .sort() if it is antisymmetric and transitive. Asserted by
    // construction over every pair and triple rather than by reading the branches.
    const items = [null, -1, 0, 1, 2].flatMap((v) => ["a", "b", "c"].map((s) => ({ v, s })));
    const violations: string[] = [];
    for (const dir of ["asc", "desc"] as const) {
      for (const x of items) for (const y of items) {
        if (Math.sign(compareTuple(x, y, dir)) !== -Math.sign(compareTuple(y, x, dir))) {
          violations.push(`antisymmetry ${dir} ${JSON.stringify([x, y])}`);
        }
      }
      for (const x of items) for (const y of items) for (const z of items) {
        if (compareTuple(x, y, dir) <= 0 && compareTuple(y, z, dir) <= 0 && compareTuple(x, z, dir) > 0) {
          violations.push(`transitivity ${dir} ${JSON.stringify([x, y, z])}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("the sessionId tiebreak makes equal-key order input-independent (the keyset's whole point)", () => {
    // Causal, not incidental: V8's sort is stable, so a comparator that returns 0 for two distinct rows
    // hands back whatever order the caller passed in — and a keyset cursor built on that order can skip or
    // repeat a session across pages. Feeding the SAME set in two different orders is what discriminates.
    const rows = [{ sessionId: "b", createdAt: 5 }, { sessionId: "a", createdAt: 5 }, { sessionId: "c", createdAt: 5 }];
    const fwd = sortForSearch(rows, "desc", vo).map((r) => r.sessionId);
    const rev = sortForSearch([...rows].reverse(), "desc", vo).map((r) => r.sessionId);
    expect(fwd).toEqual(["a", "b", "c"]);
    expect(rev).toEqual(fwd);
  });

  it("null sort values keep a deterministic place regardless of input order", () => {
    const rows = [{ sessionId: "e", createdAt: 500 }, { sessionId: "n" }, { sessionId: "a", createdAt: 100 }];
    const fwd = sortForSearch(rows, "asc", vo).map((r) => r.sessionId);
    expect(fwd).toEqual(["a", "e", "n"]);
    expect(sortForSearch([...rows].reverse(), "asc", vo).map((r) => r.sessionId)).toEqual(fwd);
  });

  it("sortForSearch leaves the caller's array untouched and hands back a new one", () => {
    const rows = [{ sessionId: "b", createdAt: 2 }, { sessionId: "a", createdAt: 1 }];
    const out = sortForSearch(rows, "asc", vo);
    expect(rows.map((r) => r.sessionId)).toEqual(["b", "a"]);
    expect(out).not.toBe(rows);
  });

  it("sortValueOf: updated_at and recency_at are the same field, and createdAt 0 is a value not a miss", () => {
    expect(sortValueOf({ lastModified: 5 }, "updated_at")).toBe(5);
    expect(sortValueOf({ lastModified: 5 }, "recency_at")).toBe(5);
    expect(sortValueOf({ createdAt: 0, lastModified: 5 }, "created_at")).toBe(0); // `??`, not `||`
    expect(sortValueOf({ lastModified: 5 }, "created_at")).toBeNull();
  });

  it("a non-finite sort value is screened to null: it sorts last and leaves every OTHER row's order alone", () => {
    // Was a HAZARD PIN recording the opposite — the guarantee we now have. `sortValueOf` screens with
    // `Number.isFinite`, so NaN/±Infinity become "no value" instead of poisoning `a.v - b.v` (which .sort()
    // reads as "no opinion", leaving unrelated well-formed rows in whatever order they arrived). Reachable
    // live: `lastModified` is a bring-your-own SessionStore's `mtime` passed straight through, and the
    // adapter conformance gate's `typeof mtime === "number"` is satisfied by NaN.
    expect(sortValueOf({ createdAt: NaN, lastModified: 0 }, "created_at")).toBeNull();
    expect(sortValueOf({ createdAt: Infinity, lastModified: 0 }, "created_at")).toBeNull();
    expect(sortValueOf({ lastModified: NaN }, "updated_at")).toBeNull();  // this path never had even a `??`
    expect(sortValueOf({ lastModified: JSON.parse('{"v":1e999}').v }, "recency_at")).toBeNull(); // plain JSON mints Infinity
    expect(sortValueOf({ createdAt: 0, lastModified: 5 }, "created_at")).toBe(0); // the screen subsumes `??`, keeping 0
    // The comparator is now total by construction: finite minus finite is never NaN.
    expect(compareTuple({ v: sortValueOf({ createdAt: NaN, lastModified: 0 }, "created_at"), s: "a" }, { v: 1, s: "b" }, "asc")).toBe(1);
    const rows = [{ sessionId: "e", createdAt: 500 }, { sessionId: "n", createdAt: NaN }, { sessionId: "a", createdAt: 100 }, { sessionId: "z", createdAt: 900 }];
    const fwd = sortForSearch(rows, "asc", vo).map((r) => r.sessionId);
    expect(fwd).toEqual(["a", "e", "z", "n"]);                       // poisoned row last, the other three intact
    expect(sortForSearch([...rows].reverse(), "asc", vo).map((r) => r.sessionId)).toEqual(fwd); // input-order-independent
    // …and it lands exactly where a MISSING createdAt lands — which is what the minted cursor already claims.
    const ok = [{ sessionId: "e", createdAt: 500 }, { sessionId: "n" }, { sessionId: "a", createdAt: 100 }, { sessionId: "z", createdAt: 900 }];
    expect(sortForSearch(ok, "asc", vo).map((r) => r.sessionId)).toEqual(fwd);
  });

  it("a paged keyset walk skips and repeats nothing with one poisoned row present (shuffled input)", () => {
    // The search cursor is a keyset over exactly this order — page N+1 is "everything strictly after this
    // tuple" — so an unordered sort is not cosmetic: rows the comparator has no opinion about drop out of
    // the walk or come back twice. The shuffle is load-bearing, and measured rather than assumed: with the
    // screen reverted, 40 of these 100 shuffled trials lose a WELL-FORMED session (23 skipped, 17
    // repeated), while the same fixture pre-sorted loses 0 of 100 — V8 short-circuits an already-sorted
    // run, so the comparator never runs on it (at N=1000: 0 of 999 rows misplaced pre-sorted, ~972
    // shuffled). A pre-sorted fixture would therefore prove nothing about the well-formed rows.
    let seed = 0x2f6e2b1;
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const set = [...Array.from({ length: 13 }, (_, i) => ({ sessionId: `s${String(i).padStart(2, "0")}`, createdAt: (i + 1) * 10 })), { sessionId: "sNaN", createdAt: NaN }];
    const walk = (rows: { sessionId: string; createdAt?: number }[], limit: number): string[] => {
      const seen: string[] = []; let cursor: string | null = null;
      for (let guard = 0; guard <= rows.length + 2; guard++) {
        const after = cursor === null ? null : decodeSearchCursor(cursor);
        const sorted = sortForSearch(rows, "asc", vo);
        const rest = after === null ? sorted : sorted.filter((r) => compareTuple({ v: vo(r), s: r.sessionId }, { v: after.v, s: after.s }, "asc") > 0);
        const page = rest.slice(0, limit);
        if (page.length === 0) break;
        for (const r of page) seen.push(r.sessionId);
        const last = page[page.length - 1]!;
        cursor = encodeSearchCursor({ v: vo(last), s: last.sessionId, r: 0 }); // round-tripped, so the codec is in the loop
      }
      return seen;
    };
    const anomalies: string[] = [];
    for (let trial = 0; trial < 100; trial++) {
      const rows = [...set];
      for (let i = rows.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [rows[i], rows[j]] = [rows[j]!, rows[i]!]; }
      const seen = walk(rows, 3);
      const repeated = seen.filter((s, i) => seen.indexOf(s) !== i);
      const skipped = rows.map((r) => r.sessionId).filter((s) => !seen.includes(s));
      // Split out the poisoned row itself: losing IT is the trivial half and shows up even pre-sorted, so
      // the causal signal is what happens to the other thirteen. Both are asserted; only this one is causal.
      const wellFormed = [...repeated, ...skipped].filter((s) => s !== "sNaN");
      if (repeated.length) anomalies.push(`trial ${trial} repeated ${repeated.join(",")}`);
      if (skipped.length) anomalies.push(`trial ${trial} skipped ${skipped.join(",")}`);
      if (wellFormed.length) anomalies.push(`trial ${trial} lost well-formed ${wellFormed.join(",")}`);
    }
    expect(anomalies).toEqual([]);
  });
});

describe("searchScan — cursor codecs against forged input", () => {
  const forge = (o: unknown) => Buffer.from(JSON.stringify(o), "utf8").toString("base64url");

  it("every non-object JSON payload is rejected by both codecs without throwing", () => {
    // `decode` reaches an `in` operator, which throws on a primitive — so "rejects garbage" has to cover
    // payloads that are valid JSON but not objects, not just undecodable bytes.
    for (const payload of [null, 5, "str", true, [], [1, 2]]) {
      expect(decodeSearchCursor(forge(payload))).toBeNull();
      expect(decodeOccCursor(forge(payload))).toBeNull();
    }
    for (const junk of ["", " ", "!!!", "%%%%", " ", "😀", "e30", "bnVsbA"]) {
      expect(decodeSearchCursor(junk)).toBeNull();
      expect(decodeOccCursor(junk)).toBeNull();
    }
  });

  it("a foreign field cross-rejects even when its value is null, and a clean cursor still decodes", () => {
    // What this defends is the presence of the cross-guard at all: deleting `"c" in p` turns it red.
    // What it does NOT defend — and the title deliberately no longer claims — is the guard's SPELLING.
    // Rewriting it as `p.c !== undefined` passes every row in this file, and that is correct rather than a
    // hole: JSON carries no `undefined`, so over any `JSON.parse` result the two are the same predicate
    // (checked directly, both forms agree on `c:null`, `c:0`, `c` absent, and a `__proto__` payload).
    expect(decodeSearchCursor(forge({ v: 1, s: "a", r: 2, c: null }))).toBeNull();
    expect(decodeOccCursor(forge({ s: "a", r: 1, c: 1, e: null, v: null }))).toBeNull();
    expect(decodeSearchCursor(forge({ v: 1, s: "a", r: 2 }))).toEqual({ v: 1, s: "a", r: 2 });
  });

  it("round-trip is lossless for hostile sessionIds and the encoding stays URL-safe", () => {
    for (const s of ['a"b\nc\\d', "\u{1F600}\u{10FFFF}", "\uD83D", "a/b+c=d", "  ", "—em—"]) {
      const enc = encodeSearchCursor({ v: 1, s, r: 0 });
      expect(enc).not.toMatch(/[+/=]/); // base64url, so a cursor survives a query string untouched
      expect(decodeSearchCursor(enc)).toEqual({ v: 1, s, r: 0 });
    }
  });

  it("an out-of-range offset is REFUSED at decode, and a non-finite v is now a truthful null", () => {
    // Was a HAZARD PIN recording both as gaps. A cursor is server-minted and opaque, so an out-of-range
    // offset means forged or corrupted — refusing beats clamping, which would resume a transcript at a row
    // the cursor did not name (the intra-file skip/repeat D-M5-16 exists to kill). `r` and the occurrence
    // cursor's `c` must be non-negative safe integers; ±Infinity/NaN arrive as JSON `null` and fail too.
    for (const bad of [-1, -0.5, 2.5, NaN, Infinity, -Infinity, 2 ** 53, 1e308]) {
      expect(decodeSearchCursor(forge({ v: 1, s: "a", r: bad }))).toBeNull();
      expect(decodeOccCursor(forge({ s: "a", r: bad, c: 0, e: null }))).toBeNull();
      expect(decodeOccCursor(forge({ s: "a", r: 0, c: bad, e: null }))).toBeNull();
    }
    expect(decodeSearchCursor(forge({ v: 1, s: "a", r: 0 }))).toEqual({ v: 1, s: "a", r: 0 }); // 0 is in range
    expect(decodeOccCursor(forge({ s: "a", r: 0, c: 0, e: null }))).toEqual({ s: "a", r: 0, c: 0, e: null });
    // The `v: null` round-trip is now a TRUE claim rather than a hazard: JSON has no NaN/Infinity so a
    // non-finite `v` encodes as null, and `sortValueOf` screens non-finite values to null as well — so the
    // cursor's "this session sorts last" is where `compareTuple` actually puts it.
    expect(decodeSearchCursor(encodeSearchCursor({ v: NaN, s: "a", r: 0 }))).toEqual({ v: null, s: "a", r: 0 });
    expect(decodeSearchCursor(encodeSearchCursor({ v: Infinity, s: "a", r: 0 }))).toEqual({ v: null, s: "a", r: 0 });
    expect(sortValueOf({ createdAt: NaN, lastModified: 0 }, "created_at")).toBeNull();
  });

  it("a cursor MISSING any required field decodes to null, in both codecs", () => {
    // The shipped guards are correct, but nothing noticed them: every other codec row supplies a complete
    // object, a foreign field, or a non-object payload. Relaxing `typeof p.r !== "number"` to also accept
    // `undefined` survived the whole suite — and an `undefined` `r` reaching `getSessionMessages({offset})`
    // restarts the file at row 0, returning every row of that transcript again on the next page.
    for (const drop of ["v", "s", "r"] as const) {
      const p: Record<string, unknown> = { v: 1, s: "a", r: 2 }; delete p[drop];
      expect([drop, decodeSearchCursor(forge(p))]).toEqual([drop, null]);
    }
    for (const drop of ["s", "r", "c", "e"] as const) {
      const p: Record<string, unknown> = { s: "a", r: 1, c: 2, e: 3 }; delete p[drop];
      expect([drop, decodeOccCursor(forge(p))]).toEqual([drop, null]);
    }
    expect(decodeSearchCursor(forge({ v: 1, s: "a", r: 2 }))).toEqual({ v: 1, s: "a", r: 2 }); // the complete shapes still decode
    expect(decodeOccCursor(forge({ s: "a", r: 1, c: 2, e: 3 }))).toEqual({ s: "a", r: 1, c: 2, e: 3 });
  });
});

describe("searchScan — corpus boundary over malformed rows", () => {
  it("every phantom kind rows.ts knows is out of corpus, and tool_use/thinking blocks are too", () => {
    const user = (content: unknown) => ({ type: "user", uuid: "u", message: { content } });
    expect(rowSearchText(user("<command-name>/clear</command-name>"))).toBeNull();       // command_echo
    expect(rowSearchText(user("<local-command-stdout>out</local-command-stdout>"))).toBeNull(); // command_output
    expect(rowSearchText(user("<local-command-caveat>c</local-command-caveat>"))).toBeNull();   // caveat
    expect(rowSearchText(user("This session is being continued from a previous conversation"))).toBeNull(); // compact
    expect(rowSearchText({ type: "user", message: { content: "no uuid" } })).toBeNull();  // uuid-less → "other"
    expect(rowSearchText({ type: "assistant", message: { content: [{ type: "tool_use", name: "X", input: {} }] } })).toBeNull();
    expect(rowSearchText({ type: "assistant", message: { content: [{ type: "thinking", thinking: "secret" }] } })).toBeNull();
    expect(rowSearchText({ type: "system", message: { content: "sys" } })).toBeNull();
    // …and a real prompt still IS in corpus, so the row above is a boundary, not a blanket null.
    expect(rowSearchText(user("please search me"))).toBe("please search me");
  });

  it("multiple assistant text blocks join on `\\n` — the separator the spec names, one unit wide", () => {
    // No existing row had an assistant message with two text blocks, so `join("\n")` → `join("")` left the
    // suite green. It is not cosmetic: Task 7 maps a match offset inside this joined string back through
    // `makeSnippet`, so a zero-width separator shifts `snippetMatchRange` by one unit per preceding block.
    const two = { type: "assistant", message: { content: [{ type: "text", text: "one" }, { type: "tool_use", name: "X", input: {} }, { type: "text", text: "two" }] } };
    expect(rowSearchText(two)).toBe("one\ntwo");
    const three = { type: "assistant", message: { content: [{ type: "text", text: "a" }, { type: "text", text: "b" }, { type: "text", text: "c" }] } };
    expect(rowSearchText(three)).toBe("a\nb\nc");
    expect(rowSearchText(three)!.indexOf("c")).toBe(4); // the offset Task 7 will hand to makeSnippet
  });

  it("classification is repeatable — the shared species regexes must never carry lastIndex state", () => {
    // rows.ts imports these regexes from tui/species.ts, so a `/g` added there for the TUI's benefit would
    // silently make every SECOND echo row searchable. Guarded here because the coupling is invisible there.
    const echo = { type: "user", uuid: "u", message: { content: "<command-name>/x</command-name>" } };
    expect([rowSearchText(echo), rowSearchText(echo), rowSearchText(echo)]).toEqual([null, null, null]);
    const prompt = { type: "user", uuid: "u", message: { content: "hello" } };
    expect([rowSearchText(prompt), rowSearchText(prompt)]).toEqual(["hello", "hello"]);
  });

  it("malformed and hand-edited rows return null or a string, never a throw", () => {
    const hostile: unknown[] = [
      null, undefined, 5, "str", [], { type: "user" }, { type: "assistant" },
      { type: "assistant", message: { content: null } },
      { type: "assistant", message: { content: [null, undefined, 7] } },
      { type: "assistant", message: { content: [{ type: "text" }] } },
      { type: "assistant", message: { content: [{ type: "text", text: null }] } },
      { type: "user", uuid: "u", message: { content: 7 } },
      { type: "user", uuid: "u", message: {} },
      { type: "user", uuid: "u", message: { content: "\uD83D lone surrogate" } },
      { type: "user", uuid: "u", message: { content: "a\r\nb" } },
    ];
    for (const m of hostile) {
      const r = rowSearchText(m);
      expect(r === null || typeof r === "string").toBe(true);
    }
    expect(rowSearchText({ type: "user", uuid: "u", message: { content: "a\r\nb" } })).toBe("a\r\nb"); // CRLF is preserved verbatim
  });

  it("HAZARD PIN: a hand-edited assistant row can be coerced into or out of the corpus", () => {
    // Recorded, not defended. A string-valued assistant `content` (not a shape the SDK writes, but one a
    // hand-edited or foreign file can hold) is invisible to search; and a non-string `text` is coerced by
    // `String()`, so `{text: {}}` becomes the searchable literal "[object Object]".
    expect(rowSearchText({ type: "assistant", message: { content: "plain string reply" } })).toBeNull();
    expect(rowSearchText({ type: "assistant", message: { content: [{ type: "text", text: { a: 1 } }] } })).toBe("[object Object]");
    // Locally-minted assistant frames (API errors, exit notices) ARE searchable — rows.ts excludes them
    // from /copy via `syntheticAssistant`, this corpus does not. Deliberate per spec ("visible … messages"),
    // pinned so the divergence is a decision on record rather than an accident.
    expect(rowSearchText({ type: "assistant", message: { model: "<synthetic>", content: [{ type: "text", text: "API Error: 401" }] } })).toBe("API Error: 401");
  });
});

describe("searchScan — snippet windows", () => {
  it("the snippet is CENTERED when there is room and clamps at both text edges", () => {
    // The brief's row is titled "centered" but its assertions pass with pad=0, so centering is asserted here.
    const mid = makeSnippet("x".repeat(500) + "NEEDLE" + "y".repeat(500), 500, 6);
    expect(mid.snippetMatchRange.start).toBe(97);
    expect(mid.snippet.length - mid.snippetMatchRange.end).toBe(97);
    const head = makeSnippet("NEEDLE" + "y".repeat(500), 0, 6);
    expect(head.snippetMatchRange).toEqual({ start: 0, end: 6 }); // clamped at 0, no negative offset
    expect(head.snippet.length).toBe(200);
    const tail = makeSnippet("x".repeat(500) + "NEEDLE", 500, 6);
    expect(tail.snippetMatchRange.start).toBe(97);
    expect(tail.snippet.length).toBe(103); // runs out of text rather than back-filling the unused budget
  });

  it("across every term length and match position the cap holds and the range recovers the exact match", () => {
    const fails: string[] = [];
    for (let len = 0; len <= 300; len++) {
      const text = "p".repeat(400) + "m".repeat(len) + "q".repeat(400);
      const r = makeSnippet(text, 400, len);
      if (r.snippet.length > Math.max(SEARCH_CAPS.snippetMax, len)) fails.push(`cap len=${len} got=${r.snippet.length}`);
      if (r.snippet.slice(r.snippetMatchRange.start, r.snippetMatchRange.end) !== text.slice(400, 400 + len)) fails.push(`recover len=${len}`);
    }
    const wide = "z".repeat(600);
    for (let start = 0; start + 6 <= 600; start++) {
      const r = makeSnippet(wide, start, 6);
      if (r.snippet.length > SEARCH_CAPS.snippetMax) fails.push(`cap start=${start}`);
      if (r.snippet.slice(r.snippetMatchRange.start, r.snippetMatchRange.end) !== wide.slice(start, start + 6)) fails.push(`recover start=${start}`);
    }
    expect(fails).toEqual([]);
  });

  it("the window never halves a pair IT CREATED outside the match — and a source's own lone surrogate away from the cuts passes through", () => {
    // Task 6 recorded this and left the call to whoever owned the wire shape; `thread/search` is that
    // owner, so the edges are now trimmed. Measured before the trim: with emoji around the match, ALL 40
    // probed offsets shipped a lone surrogate at BOTH edges — the 97-unit pad is odd, so the cut lands
    // mid-pair regardless of parity. The escape rides out of Node unnoticed and breaks at the client:
    // python's json.loads accepts `\ude00` and the resulting string then refuses to encode to UTF-8.
    // (spelled as an explicit regex rather than String.isWellFormed — this tsconfig's lib predates it)
    const LONE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    expect(LONE.test("\u{1F600}ok\u{1F600}")).toBe(false); // the detector is not a rubber stamp
    expect(LONE.test("\ud83d" + "ok")).toBe(true);
    // Both edges, at both parities of match offset, and the RANGE still recovers the match after the
    // leading trim shifted it — the field Task 8 publishes, which a trim that forgot to adjust would break.
    for (let lead = 0; lead < 8; lead++) {
      const text = "z".repeat(lead) + "\u{1F600}".repeat(200) + "NEEDLE" + "\u{1F600}".repeat(200);
      const r = makeSnippet(text, lead + 400, 6);
      expect(LONE.test(r.snippet), `lead=${lead}`).toBe(false);
      expect(r.snippet.slice(r.snippetMatchRange.start, r.snippetMatchRange.end)).toBe("NEEDLE");
    }
    // A trim may never eat the match itself. Two shapes, and the second is the one that reaches the
    // `from < at` half of the guard: the window only starts AT the match when there is no padding left to
    // give (a term of 200+ units), so a long term whose first unit is a lone LOW surrogate is exactly the
    // input where an unguarded trim would delete the match's own first unit and leave the published range
    // describing a string the snippet no longer holds.
    const half = "\ud83d"; // a lone high surrogate, as a client's own search term
    const withHalf = "abc" + half + "def";
    const r2 = makeSnippet(withHalf, 3, 1);
    expect(r2.snippet.slice(r2.snippetMatchRange.start, r2.snippetMatchRange.end)).toBe(half);
    const lowLed = "\udc00" + "q".repeat(SEARCH_CAPS.snippetMax - 1); // 200 units, starts with a lone LOW surrogate
    const r3 = makeSnippet("x".repeat(50) + lowLed, 50, lowLed.length);
    expect(r3.snippet.slice(r3.snippetMatchRange.start, r3.snippetMatchRange.end)).toBe(lowLed);
    // The MIRROR of that guard, on the trailing edge (`to > at + n`), which the leading row above does not
    // reach: `to === at + n` exactly when `pad === 0`, so a 200-unit term ENDING in a lone high surrogate
    // is the input where an unguarded trim shortens the snippet to 199 while the range still ends at 200 —
    // a published range pointing PAST the snippet, the wire-contract violation this function exists to stop.
    const highTailed = "q".repeat(SEARCH_CAPS.snippetMax - 1) + "\ud83d"; // 200 units, ends with a lone HIGH surrogate
    const r4 = makeSnippet("x".repeat(50) + highTailed, 50, highTailed.length);
    expect(r4.snippet.slice(r4.snippetMatchRange.start, r4.snippetMatchRange.end)).toBe(highTailed);
    expect(r4.snippetMatchRange.end).toBeLessThanOrEqual(r4.snippet.length);
    expect(r4.snippet.length).toBe(SEARCH_CAPS.snippetMax);
    // …and a lone surrogate the SOURCE already carries, away from both cuts, is passed through, not
    // rewritten: repairing a caller's content is not this function's business. The trims are positional,
    // though, so one landing exactly ON a cut outside the match IS taken — asserted, because the header
    // comment used to claim "at any position" and that claim is false at the `from` edge.
    expect(LONE.test(makeSnippet("x".repeat(50) + half + "NEEDLE" + "y".repeat(50), 51, 6).snippet)).toBe(true);
    const lead = "z" + "\udc00" + "z".repeat(96); // 98 units: the pad is 97, so `from` lands exactly on it
    const cut = makeSnippet(lead + "NEEDLE", lead.length, 6);
    expect((lead + "NEEDLE").charCodeAt(1)).toBe(0xdc00);      // the SOURCE carries it, this window did not split anything…
    expect(cut.snippet.includes("\udc00")).toBe(false);        // …and it is trimmed anyway, because `from` cuts there
    expect(cut.snippet.slice(cut.snippetMatchRange.start, cut.snippetMatchRange.end)).toBe("NEEDLE");
  });

  it("a match offset found in the LOWERCASED row maps back onto the original — the only length-changing fold is U+0130", () => {
    // `indexOf` runs over `text.toLowerCase()` while the snippet is cut from `text`, so without this mapping
    // the window slides right by one unit per preceding expansion. Swept 0..0x10FFFF: expanders = 1 (U+0130
    // LATIN CAPITAL LETTER I WITH DOT ABOVE → "i" + U+0307), shrinkers = 0 — which is what makes the
    // equal-length fast path exact rather than merely usual.
    const span = (text: string, needle: string) => { const lc = text.toLowerCase(); return originalSpan(text, lc, lc.indexOf(needle), needle.length); };
    const map = (text: string, needle: string) => span(text, needle).at;
    expect(map("plain ASCII needle here", "needle")).toBe(12);           // fast path: lengths equal, identity
    // E = 1 is already wrong without the mapping: the lowered offset is 2, the true offset is 1.
    const one = "İneedle";
    expect(one.toLowerCase().indexOf("needle")).toBe(2);
    expect(map(one, "needle")).toBe(1);
    expect(one.slice(1, 7)).toBe("needle");
    // …and it stays exact as the expansions pile up, and expansions AFTER the match never shift it.
    for (const e of [0, 1, 2, 50, 97, 98, 150]) {
      const text = "İ".repeat(e) + "y".repeat(20) + "needle" + "İ".repeat(7);
      const s = span(text, "needle");
      expect(s, `E=${e}`).toEqual({ at: e + 20, len: 6 });
      const r = makeSnippet(text, s.at, s.len);
      expect(r.snippet.slice(r.snippetMatchRange.start, r.snippetMatchRange.end), `E=${e}`).toBe("needle");
    }
    // The degenerate case a SHORT row reaches: the lowered offset (6) is past the original's own length
    // (5), so `clampIndex` pins it to the row end and the range collapses to a zero-length "occurrence"
    // pointing past the match. Both halves asserted — the repair, and the shape it repairs.
    const short = "İİİab";
    const shortLc = short.toLowerCase();
    expect([short.length, shortLc.length, shortLc.indexOf("ab")]).toEqual([5, 8, 6]);
    const sp = originalSpan(short, shortLc, 6, 2);
    const fixed = makeSnippet(short, sp.at, sp.len);
    expect(fixed.snippet.slice(fixed.snippetMatchRange.start, fixed.snippetMatchRange.end)).toBe("ab");
    const unmapped = makeSnippet(short, 6, 2);
    expect(unmapped.snippetMatchRange.start).toBe(unmapped.snippetMatchRange.end); // zero-length, past the match
  });

  it("the match's LENGTH maps back too — a fold inside the term is a second axis, and the term's own length is right on neither side of it", () => {
    // The start mapping above fixes expansions BEFORE the match. This is the other axis: an expansion
    // INSIDE the match, which changes how many ORIGINAL units the match covers. `İstanbul` is 8 units and
    // lowers to 9 ("i" + U+0307 + "stanbul"), and BOTH of these rows are hits for it — so the caller has
    // two lengths available (8, the term; 9, the lowered term) and neither is correct for both rows. Only
    // mapping the end through the same count answers it. Task 8 publishes this length as
    // `snippetMatchRange`, where being one unit off is a wrong range rather than a slightly short excerpt.
    const term = "İstanbul";
    const termLc = term.toLowerCase();
    const DEC = "i̇stanbul"; // what İstanbul lowers to, and a form a row can already be stored in
    expect([term.length, termLc.length, termLc]).toEqual([8, 9, DEC]);
    const spanOf = (text: string) => { const lc = text.toLowerCase(); return originalSpan(text, lc, lc.indexOf(termLc), termLc.length); };
    // (a) the row holds the already-DECOMPOSED form, so it is length-stable and the fast path answers —
    //     and the true span is 9, one MORE than the term's own length.
    const decomposed = `in ${DEC} today`;
    expect(decomposed.toLowerCase().length).toBe(decomposed.length);          // fast path taken
    const a = spanOf(decomposed);
    expect(a).toEqual({ at: 3, len: 9 });
    expect(decomposed.slice(a.at, a.at + a.len)).toBe(DEC);
    // (b) the row holds the COMPOSED İ, so the match covers 9 lowered units but only 8 original ones —
    //     one FEWER than the lowered term's length.
    const composed = "in İstanbul today";
    const b = spanOf(composed);
    expect(b).toEqual({ at: 3, len: 8 });
    expect(composed.slice(b.at, b.at + b.len)).toBe("İstanbul");
    // (c) BOTH axes live at once: an expansion before the match moves the start AND one inside it sets the
    //     length. Neither correction subsumes the other — the start is off by the leading count, the
    //     length by the enclosed one, and the row here needs both.
    const both = "İzmir, İstanbul";
    expect(both.toLowerCase().indexOf(termLc)).toBe(8);                       // the lowered offset…
    const c = spanOf(both);
    expect(c).toEqual({ at: 7, len: 8 });                                     // …mapped: start -1, length -1
    expect(both.slice(c.at, c.at + c.len)).toBe("İstanbul");
    // (d) a match edge landing INSIDE one expansion resolves OUTWARD, so the span still covers every
    //     original character any part of which matched: `hi` matches the `h` and the `i` U+0130 folded to,
    //     and a floored end would stop before that İ and describe a range holding only "H".
    const hi = "Hİ there";
    expect(hi.toLowerCase().indexOf("hi")).toBe(0);
    const straddle = originalSpan(hi, hi.toLowerCase(), 0, 2);
    expect(straddle).toEqual({ at: 0, len: 2 });
    expect(hi.slice(straddle.at, straddle.at + straddle.len)).toBe("Hİ");
  });

  it("the outward convention's OTHER half: a start landing inside an expansion FLOORS, so the span keeps the original character that matched", () => {
    // The row above pins the END half (`Hİ` for `hi`, where a floored end would stop before the İ that
    // matched). This is its mirror, and it needs its own row: making the START ceil as well — `straddles = 1`
    // on BOTH edges — left the entire suite green while publishing a span that EXCLUDES an original
    // character part of which matched, which is exactly the defect the end row exists to prevent. Each term
    // below opens with the combining dot U+0307, the second unit of what `İ` lowers to, so the lowered match
    // begins BETWEEN the `i` and its dot; flooring is what pulls the start back onto the İ itself. Reachable
    // over the wire rather than constructed: the term is client-authored and 2 units already clears `minTerm`.
    // Every fixture's END lands on a clean boundary, so this row answers for the START side ALONE and the row
    // above answers for the end — each side is sabotage-checked on its own rather than through a shared row.
    const DOT = "̇"; // COMBINING DOT ABOVE
    const cases: [string, string, { at: number; len: number }, string][] = [
      ["aİbc", DOT + "b", { at: 1, len: 2 }, "İb"],                              // the minimal shape
      ["xİstanbul y", DOT + "stanbul", { at: 1, len: 8 }, "İstanbul"],            // a whole word hanging off it
      ["qİİz", DOT + "i" + DOT, { at: 1, len: 2 }, "İİ"],                        // the match encloses a second expansion
      ["İİİhello", DOT + "hello", { at: 2, len: 6 }, "İhello"],                   // three expansions, two of them before the edge
      ["y".repeat(40) + "İzebra", DOT + "zebra", { at: 40, len: 6 }, "İzebra"],   // …and it holds well past the first unit
    ];
    for (const [text, needle, want, slice] of cases) {
      const lc = text.toLowerCase();
      const at = lc.indexOf(needle);
      expect(at, text).toBeGreaterThanOrEqual(0);          // the fixture really is a hit for a client-authored term…
      expect(lc.length, text).not.toBe(text.length);       // …and it really does take the slow path
      const s = originalSpan(text, lc, at, needle.length);
      expect(s, text).toEqual(want);
      expect(text.slice(s.at, s.at + s.len), text).toBe(slice);
      expect(s.at, text).toBeLessThan(at);                 // floored onto the expansion, not passed through past it
    }
  });

  it("no caller can force a negative or inverted snippetMatchRange onto the wire", () => {
    // `snippetMatchRange` is a public wire field named verbatim from Codex's protocol, so a negative or
    // inverted range is a contract violation rather than an internal caller's private problem — the inputs
    // are clamped rather than trusted. Unclamped, `start: -5` emitted `start: -5` and a negative `len`
    // emitted `end < start`.
    const text = "abcdefghij";
    const bad: [number, number][] = [[-5, 2], [3, -4], [-1, -1], [999, 2], [8, 50], [NaN, 3], [3, NaN], [Infinity, 2], [2.7, 3.9]];
    const violations: string[] = [];
    for (const [start, len] of bad) {
      const r = makeSnippet(text, start, len);
      const { start: s, end: e } = r.snippetMatchRange;
      if (!(Number.isSafeInteger(s) && Number.isSafeInteger(e) && s >= 0 && e >= s && e <= r.snippet.length)) violations.push(`${start},${len} → ${s}..${e} of ${r.snippet.length}`);
    }
    expect(violations).toEqual([]);
    expect(makeSnippet(text, -5, 2).snippetMatchRange).toEqual({ start: 0, end: 2 });   // clamped to the text start
    expect(makeSnippet(text, 3, -4).snippetMatchRange).toEqual({ start: 3, end: 3 });   // empty, never inverted
    expect(makeSnippet(text, 8, 50).snippetMatchRange).toEqual({ start: 8, end: 10 });  // never past the text end
    // …and every well-formed call is untouched by the clamp.
    const ok = makeSnippet("x".repeat(500) + "NEEDLE" + "y".repeat(500), 500, 6);
    expect(ok.snippet.slice(ok.snippetMatchRange.start, ok.snippetMatchRange.end)).toBe("NEEDLE");
  });

  it("SEARCH_CAPS carries D-M5-17's numbers exactly", () => {
    expect(SEARCH_CAPS).toEqual({
      maxFilesPerPage: 40, maxRowsPerPage: 4000, maxRowUnits: 1_048_576, maxLimit: 50,
      defaultLimit: 20, minTerm: 2, maxTerm: 256, snippetMax: 200, windowRows: 500,
    });
    expect(SEARCH_CAPS.maxRowUnits).toBe(2 ** 20); // "1,048,576 UTF-16 units", spelled two ways
  });
});
