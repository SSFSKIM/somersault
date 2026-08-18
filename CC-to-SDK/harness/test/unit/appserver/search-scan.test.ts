// test/unit/appserver/search-scan.test.ts
import { describe, it, expect } from "vitest";
import { SEARCH_CAPS, sortForSearch, sortValueOf, compareTuple, encodeSearchCursor, decodeSearchCursor, encodeOccCursor, decodeOccCursor, rowSearchText, makeSnippet } from "../../../src/appserver/searchScan.js";

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

  it("HAZARD PIN: a non-finite sort value corrupts the order of every OTHER row (Task 7 must filter)", () => {
    // Not a guarantee we want — a record of one we do not have. `sortValueOf` passes `createdAt`/
    // `lastModified` straight through from SDK `listSessions` metadata, and the SDK's own normalizer is a
    // bare `typeof === "number"` (which NaN satisfies) while its sibling string-date normalizer explicitly
    // rejects NaN. A NaN `v` makes `a.v - b.v` NaN, .sort() treats that as "no opinion", and the sorted
    // rows below come out unsorted AND input-order-dependent. The null control on the next lines proves
    // this is specific to non-finite numbers, not to "no value". If a later task guards this in
    // compareTuple, this row goes red on purpose — update it then.
    const rows = [{ sessionId: "e", createdAt: 500 }, { sessionId: "n", createdAt: NaN }, { sessionId: "a", createdAt: 100 }, { sessionId: "z", createdAt: 900 }];
    expect(Number.isNaN(compareTuple({ v: NaN, s: "a" }, { v: 1, s: "b" }, "asc"))).toBe(true);
    const fwd = sortForSearch(rows, "asc", vo).map((r) => r.sessionId);
    const rev = sortForSearch([...rows].reverse(), "asc", vo).map((r) => r.sessionId);
    expect(fwd).not.toEqual(rev); // input-order-dependent: the defect, pinned
    expect(fwd.filter((s) => s !== "n")).not.toEqual(["a", "e", "z"]); // and the finite rows lost their order
    // Same shape with a MISSING createdAt instead of a NaN one: fully deterministic and correctly sorted.
    const ok = [{ sessionId: "e", createdAt: 500 }, { sessionId: "n" }, { sessionId: "a", createdAt: 100 }, { sessionId: "z", createdAt: 900 }];
    expect(sortForSearch(ok, "asc", vo).map((r) => r.sessionId)).toEqual(["a", "e", "z", "n"]);
    expect(sortForSearch([...ok].reverse(), "asc", vo).map((r) => r.sessionId)).toEqual(["a", "e", "z", "n"]);
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

  it("HAZARD PIN: a non-finite v does not survive the round-trip, and r is not range-checked", () => {
    // Both are recorded gaps, not defended guards. JSON has no NaN/Infinity, so a non-finite sort value
    // encodes as `null` — i.e. the cursor claims "sorts last" for a session that does not. And `r` is only
    // checked to be a number: negative, fractional and absurd values decode fine, so whichever task feeds
    // `r` to `getSessionMessages({offset})` owns clamping it.
    expect(decodeSearchCursor(encodeSearchCursor({ v: NaN, s: "a", r: 0 }))).toEqual({ v: null, s: "a", r: 0 });
    expect(decodeSearchCursor(encodeSearchCursor({ v: Infinity, s: "a", r: 0 }))).toEqual({ v: null, s: "a", r: 0 });
    expect(decodeSearchCursor(forge({ v: 1, s: "a", r: -1 }))?.r).toBe(-1);
    expect(decodeSearchCursor(forge({ v: 1, s: "a", r: 2.5 }))?.r).toBe(2.5);
    expect(decodeOccCursor(forge({ s: "a", r: 0, c: -5, e: null }))?.c).toBe(-5);
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

  it("HAZARD PIN: the window is cut on UTF-16 units, so an astral pad can leave a lone surrogate", () => {
    // Recorded, not defended: the cap is specified in UTF-16 units (D-M5-17), and slicing on units can
    // halve a surrogate pair at either edge. The wire survives — JSON.stringify escapes a lone surrogate —
    // but a client renders U+FFFD. Whoever owns the wire shape should decide whether to trim the edges.
    // (spelled as an explicit regex rather than String.isWellFormed — this tsconfig's lib predates it)
    const LONE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    const r = makeSnippet("\u{1F600}".repeat(200) + "NEEDLE" + "\u{1F600}".repeat(200), 400, 6);
    expect(r.snippet.slice(r.snippetMatchRange.start, r.snippetMatchRange.end)).toBe("NEEDLE"); // the match itself is intact
    expect(LONE.test(r.snippet)).toBe(true);
    expect(LONE.test("\u{1F600}ok\u{1F600}")).toBe(false); // the detector is not a rubber stamp
    expect(() => JSON.parse(JSON.stringify({ s: r.snippet }))).not.toThrow();
  });

  it("SEARCH_CAPS carries D-M5-17's numbers exactly", () => {
    expect(SEARCH_CAPS).toEqual({
      maxFilesPerPage: 40, maxRowsPerPage: 4000, maxRowUnits: 1_048_576, maxLimit: 50,
      defaultLimit: 20, minTerm: 2, maxTerm: 256, snippetMax: 200, windowRows: 500,
    });
    expect(SEARCH_CAPS.maxRowUnits).toBe(2 ** 20); // "1,048,576 UTF-16 units", spelled two ways
  });
});
