// tui/test/species-system.test.ts — F4 Task 10b. Three surfaces that all hang off the SAME question ("what is
// this frame really?") and one honesty mechanism that runs through all of them:
//
//  · ERROR SENTINELS (`VAr`, L422714–422860). An API failure does not reach us as a throw — it reaches us as
//    an ordinary `assistant` text frame carrying one of a fixed set of literals (`_u`, L373192, stamps
//    `isApiErrorMessage:true` on every one of them; P80 §C observed exactly that on the wire). Upstream
//    switches on that text BEFORE it renders a word of it, and these tests pin the eleven cases, the two
//    default-path predicates and the 1000-character `lca` cap.
//  · SYSTEM SUBTYPES (`dVo` L428358–428518 → `Sha` L428608). A `system` frame with a string `content` paints
//    the generic bulleted row at `columns - 10`; everything else paints nothing. Two pack §9.5–9.6
//    corrections the census got wrong are pinned here: `api_error` returns null, and `level:"info"` is
//    blanket-suppressed outside verbose.
//  · THE COMPACT BOUNDARY (`XWo` shape B, L422282–422305). P81 caught the frame live, so the bulleted
//    `⏺ Compact summary (ctrl+o to expand)` form replaces the hand-rolled `─── context compacted ───` rule.
//  · THE EXPAND HINT. `(ctrl+o to expand)` was a hardcoded literal at four sites — a standing E2 violation the
//    moment a user rebinds `app:toggleTranscript`. Upstream never hardcodes it: `bn` (L183897) resolves the
//    chord through `pA` (L183751) and `$e` (L183855) composes `("(", chord, " to ", action, ")")`. These
//    tests pin the derivation AND the unbound case, where `pA` returns `""`, `$e` returns `null`, and the
//    honest render is NO clause at all rather than a dead chord.
import { describe, it, expect } from "vitest";
import {
  speciesLines, systemNoticeLines, errorSentinelLines, compactSummaryLines, COMPACT_SUMMARY_SPECIES,
  API_ERROR, PROMPT_TOO_LONG, CREDIT_BALANCE_LOW, NOT_LOGGED_IN, INVALID_API_KEY, OAUTH_REVOKED,
  REQUEST_TIMED_OUT, OPUS_HIGH_LOAD, FABLE_HIGH_LOAD, API_ERROR_ABORTED, NO_RESPONSE_REQUESTED,
  DISABLED_ORG_UPDATE, DISABLED_ORG_UNSET, GATEWAY_AUTH_FAILED, API_ERROR_TRUNCATION,
  INTERRUPTED_TEXT, TOOL_RESULT_GUTTER, LOCAL_OUTPUT_GUTTER,
} from "../../src/tui/species.js";
import { expandHintText, EXPAND_HINT_FALLBACK } from "../../src/tui/keys/hints.js";
import { renderMessage } from "../../src/tui/render.js";
import { summaryLines } from "../../src/tui/toolSummaries.js";
import { normalizeToolResult } from "../../src/tui/toolResult.js";
import { projectCompact, projectDetail, type ProjectionOptions, type RenderItem } from "../../src/tui/toolRenderer.js";
import { TranscriptDocument } from "../../src/tui/transcriptModel.js";
import type { ToolEvent } from "../../src/tui/transcriptModel.js";
import { resolveThemeColor, themeTokens } from "../../src/tui/theme.js";

const tok = (name: keyof ReturnType<typeof themeTokens>) => resolveThemeColor(themeTokens()[name] as string);
const texts = (lines: readonly { text: string }[] | null | undefined) => (lines ?? []).map((l) => l.text);
const sysFrame = (extra: Record<string, unknown>) => ({ type: "system", ...extra });

// ── The expand-hint derivation (`pA` → `$e`) ───────────────────────────────────────────────────────────
describe("expandHintText — upstream `Bg` (L421333): pA(app:toggleTranscript, Global, ctrl+o) → $e(parens)", () => {
  it("composes `(chord to expand)` in the lower-case grammar", () => {
    expect(expandHintText(["ctrl+o"], "darwin")).toBe("(ctrl+o to expand)");
    expect(expandHintText(["ctrl+t"], "darwin")).toBe("(ctrl+t to expand)");
    expect(expandHintText(["alt+e"], "darwin")).toBe("(opt+e to expand)");       // `formatMemberLower`'s macOS name
  });
  it("prefers a plain key over a chord, exactly like `backgroundHintText`", () => {
    expect(expandHintText(["ctrl+x ctrl+o", "ctrl+t"], "darwin")).toBe("(ctrl+t to expand)");
  });
  it("returns EMPTY for an unbound action — E2: never advertise a dead chord", () => {
    expect(expandHintText([], "darwin")).toBe("");
  });
  it("EXPAND_HINT_FALLBACK is `pA`'s own literal fallback, composed", () => {
    expect(EXPAND_HINT_FALLBACK).toBe("(ctrl+o to expand)");
  });
});

// ── The compact boundary, `XWo` shape B ────────────────────────────────────────────────────────────────
describe("compactSummaryLines — `XWo` shape B (L422282–422305)", () => {
  it("is `⏺ ` + bold `Compact summary` + the dim hint, as ONE row", () => {
    const [row] = compactSummaryLines(EXPAND_HINT_FALLBACK, "darwin")!;
    expect(row.text).toBe("Compact summary (ctrl+o to expand)");
    expect(row.gutter).toEqual({ text: "⏺ ", color: tok("text") });
    expect(row.segments).toEqual([
      { text: "Compact summary", bold: true },
      { text: " (ctrl+o to expand)", bold: true, dim: true },
    ]);
  });
  it("drops the hint clause entirely when the chord is unbound", () => {
    const [row] = compactSummaryLines("", "darwin")!;
    expect(row.text).toBe("Compact summary");
    expect(row.segments).toEqual([{ text: "Compact summary", bold: true }]);
  });
  it("paints `●` off darwin — `Za` is per-platform (L41484)", () => {
    expect(compactSummaryLines(EXPAND_HINT_FALLBACK, "linux")![0]!.gutter!.text).toBe("● ");
  });

  // `NAr = !iRe && <h dimColor>{" "}<bn action="app:toggleTranscript" …/></h>` (L422289): under ctrl+O the
  // clause is not rendered at all, because ctrl+O IS the expansion it offers. The row is baked at ingest, so
  // the DETAIL projection re-derives it hintless off the `species` tag — every other baked notice is verbatim
  // in both projections, which is what keeps `appendFollowGap`'s dim line identical everywhere.
  it("drops the hint clause in TRANSCRIPT mode, and only for the boundary", () => {
    const doc = new TranscriptDocument();
    doc.appendLocal({ kind: "notice", lines: compactSummaryLines(EXPAND_HINT_FALLBACK, "darwin"), data: { species: COMPACT_SUMMARY_SPECIES } }, "compact-divider:u1");
    doc.appendLocal({ kind: "notice", lines: [{ text: "plain notice (ctrl+o to expand)", dim: true }] }, "notice:n1");
    const ctx = { cwd: "/work", home: "/home/me", platform: "darwin" as NodeJS.Platform, columns: 100, now: 0 };
    const rows = (items: readonly RenderItem[]) => items.filter((i) => i.kind === "line").map((i) => (i as { line: { text: string } }).line.text);
    expect(rows(projectCompact(doc, ctx))).toEqual(["Compact summary (ctrl+o to expand)", "plain notice (ctrl+o to expand)"]);
    for (const projection of ["detail-all", "detail-collapsed"] as const)
      expect(rows(projectDetail(doc, { ...ctx, projection }))).toEqual(["Compact summary", "plain notice (ctrl+o to expand)"]);
  });

  // E2, from the external whole-branch review. The chip was BAKED at ingest against the renderer that
  // happened to be painting when `/compact` landed, and only the DETAIL projections re-derived it — so a
  // `/tui` flip could not correct it in either direction: a compaction done in classic kept its
  // `(ctrl+o to expand)` alive inside fullscreen, where §3.4's suppression is BLANKET, and one done in
  // fullscreen never got its chip back on the classic screen. Deriving the whole row at projection time off
  // the species tag is what makes the stored form irrelevant, so these cells project ONE bake through the
  // other renderer and back. `expandHint: ""` is how the fullscreen renderer asks for silence
  // (`useChat.projectionContext`), and it is the same three-state channel an unbound chord uses.
  const boundary = (baked: string) => {
    const doc = new TranscriptDocument();
    doc.appendLocal({ kind: "notice", lines: compactSummaryLines(baked, "darwin"), data: { species: COMPACT_SUMMARY_SPECIES } }, "compact-divider:u1");
    return doc;
  };
  const ctx = { cwd: "/work", home: "/home/me", platform: "darwin" as NodeJS.Platform, columns: 100, now: 0 };
  const rows = (items: readonly RenderItem[]) => items.filter((i) => i.kind === "line").map((i) => (i as { line: { text: string } }).line.text);

  it("re-derives the chip from the LIVE projection, not from the renderer that baked the row", () => {
    // Compacted in CLASSIC, then `/tui fullscreen`: the surviving chip §3.4 forbids.
    expect(rows(projectCompact(boundary(EXPAND_HINT_FALLBACK), { ...ctx, fullscreen: true, expandHint: "" }))).toEqual(["Compact summary"]);
    // Compacted in FULLSCREEN, then `/tui default`: the chip classic is owed comes back.
    expect(rows(projectCompact(boundary(""), { ...ctx, expandHint: EXPAND_HINT_FALLBACK }))).toEqual(["Compact summary (ctrl+o to expand)"]);
    // A rebind moves it too, from either bake — the row is derived, so there is no second copy to go stale.
    expect(rows(projectCompact(boundary(""), { ...ctx, expandHint: "(ctrl+t to expand)" }))).toEqual(["Compact summary (ctrl+t to expand)"]);
    // …and no hint threaded at all is still the literal fallback (`pA`'s no-keymap arm), from either bake.
    for (const baked of [EXPAND_HINT_FALLBACK, ""])
      expect(rows(projectCompact(boundary(baked), ctx))).toEqual(["Compact summary (ctrl+o to expand)"]);
  });

  it("keeps the ctrl+o pager hintless from either bake, under either renderer", () => {
    for (const baked of [EXPAND_HINT_FALLBACK, ""])
      for (const expandHint of [EXPAND_HINT_FALLBACK, "", "(ctrl+t to expand)"])
        for (const projection of ["detail-all", "detail-collapsed"] as const)
          expect(rows(projectDetail(boundary(baked), { ...ctx, projection, expandHint }))).toEqual(["Compact summary"]);
  });
});

// ── `VAr` error sentinels ──────────────────────────────────────────────────────────────────────────────
describe("errorSentinelLines — the eleven `VAr` cases (L422726–422825)", () => {
  const opts = { width: 80, expandHint: EXPAND_HINT_FALLBACK } as const;
  const guttered = (t: string) => ({ text: t, color: tok("error"), gutter: { text: TOOL_RESULT_GUTTER, dim: true } });

  it("`dHr` (L374375) and `die`: an empty text and `No response requested.` paint NOTHING", () => {
    expect(errorSentinelLines("", opts)).toEqual([]);
    expect(errorSentinelLines("   ", opts)).toEqual([]);
    expect(errorSentinelLines("(no content)", opts)).toEqual([]);
    expect(errorSentinelLines(NO_RESPONSE_REQUESTED, opts)).toEqual([]);
  });
  it("`XG` → `Context limit reached · /compact or /clear to continue`", () => {
    expect(errorSentinelLines(PROMPT_TOO_LONG, opts)).toEqual([guttered("Context limit reached · /compact or /clear to continue")]);
  });
  it("`PYr` → the billing URL row, wrapped inside `Cr`'s column with the five-column hanging indent", () => {
    // The body is a SIBLING column of the five-column gutter box (`Cr`, L406887), so it wraps to `width − 5`
    // and the continuation sits under the `⎿`, never flush-left. At the ubiquitous 80 columns this sentence
    // is 80 characters, so the wrap is not hypothetical.
    expect(errorSentinelLines(CREDIT_BALANCE_LOW, opts)).toEqual([
      guttered("Credit balance too low · Add funds: "),
      { text: "     https://platform.claude.com/settings/billing", color: tok("error") },
    ]);
    // Wide enough and it is one row again — the wrap is the column's, not a hardcoded break.
    expect(texts(errorSentinelLines(CREDIT_BALANCE_LOW, { ...opts, width: 200 })))
      .toEqual(["Credit balance too low · Add funds: https://platform.claude.com/settings/billing"]);
  });
  it("`cir` / `uir` echo their own sentinel", () => {
    expect(errorSentinelLines(INVALID_API_KEY, opts)).toEqual([guttered(INVALID_API_KEY)]);
    expect(errorSentinelLines(OAUTH_REVOKED, opts)).toEqual([guttered(OAUTH_REVOKED)]);
  });
  // Width 200 so these stay a byte-for-byte echo of the three sentinels (all of them over 100 characters);
  // the wrap geometry itself is pinned by `PYr` above and by default-predicate-1 below.
  it("the `Apo`/`Spo`/`vpo` group echoes the sentinel too (one branch, three labels)", () => {
    for (const s of [DISABLED_ORG_UPDATE, DISABLED_ORG_UNSET, GATEWAY_AUTH_FAILED])
      expect(errorSentinelLines(s, { ...opts, width: 200 })).toEqual([guttered(s)]);
  });
  it("`ect` → `Request timed out`, plus the API_TIMEOUT_MS clause when the env var is set", () => {
    expect(errorSentinelLines(REQUEST_TIMED_OUT, opts)).toEqual([guttered("Request timed out")]);
    const saved = process.env.API_TIMEOUT_MS;
    process.env.API_TIMEOUT_MS = "60000";
    try {
      expect(texts(errorSentinelLines(REQUEST_TIMED_OUT, opts)))
        .toEqual(["Request timed out (API_TIMEOUT_MS=60000ms, try increasing it)"]);
    } finally { if (saved === undefined) delete process.env.API_TIMEOUT_MS; else process.env.API_TIMEOUT_MS = saved; }
  });
  // `gap: 1` on the column (L422800) is a real blank ROW between the two sentences, not a style — and the
  // column is `Cr`'s SIBLING column (L406887), so the blank and the second sentence are INDENTED five
  // columns under the `⎿`, not flush-left. The blank stays blank: Ink trims a row's trailing whitespace
  // (output.js:139), so padding it would print nothing and only lie in the line model.
  it("`Qlt` / `Zlt` → the high-demand pair, `gap: 1` blank included, all of it under the gutter", () => {
    const rows = errorSentinelLines(OPUS_HIGH_LOAD, { ...opts, width: 120 })!;
    expect(texts(rows)).toEqual([
      "We are experiencing high demand for Opus 4.",
      "",
      "     To continue immediately, use /model to switch to Sonnet and continue coding.",
    ]);
    expect(rows[0]!.gutter).toEqual({ text: TOOL_RESULT_GUTTER, dim: true });
    expect(rows[1]!.gutter).toBeUndefined(); expect(rows[2]!.gutter).toBeUndefined();
    // Only the FIRST sentence is error-coloured — upstream's second `<h>` names no colour (L422800).
    expect(rows[0]!.color).toBe(tok("error")); expect(rows[2]!.color).toBeUndefined();
    // …and the second sentence wraps inside that same column, every row of it still indented.
    expect(texts(errorSentinelLines(OPUS_HIGH_LOAD, opts))).toEqual([
      "We are experiencing high demand for Opus 4.",
      "",
      "     To continue immediately, use /model to switch to Sonnet and continue ",
      "     coding.",
    ]);
    expect(texts(errorSentinelLines(FABLE_HIGH_LOAD, opts))[0]).toBe("We are experiencing high demand for Fable 5.");
  });
  it("`wq` → `<BP/>`, the very interrupted row exit 9 paints", () => {
    expect(errorSentinelLines(API_ERROR_ABORTED, opts))
      .toEqual([{ text: INTERRUPTED_TEXT, dim: true, gutter: { text: TOOL_RESULT_GUTTER, dim: true } }]);
  });
  it("`lir` is RECORDED UNREACHABLE (upstream renders an interactive `<aca/>` login box) — no sentinel branch", () => {
    expect(errorSentinelLines(NOT_LOGGED_IN, opts)).toBeUndefined();
  });
  // The one arm with LIVE evidence, and the longest: ~89 characters, so at 80 columns it is also the arm
  // whose wrapping the user actually meets. `Cr` carries no `height: 1` here (L422834), so upstream wraps
  // it too — inside the column, indented under the gutter.
  it("default predicate 1 — the `Prompt is too long · …` prefix P80 §C proved live, wrapped under the gutter", () => {
    const live = `${PROMPT_TOO_LONG} · the request is ~347706 tokens (limit 200000)`;
    expect(texts(errorSentinelLines(live, { ...opts, width: 200 }))).toEqual([`${live} · /clear to start fresh`]);
    expect(texts(errorSentinelLines(live, opts))).toEqual([
      "Prompt is too long · the request is ~347706 tokens (limit 200000) · /clear ",
      "     to start fresh",
    ]);
  });
  it("default predicate 2 — `JG` routes to `lca`: a warning bullet, warning text, no `⎿` gutter", () => {
    const lines = errorSentinelLines(`${API_ERROR}: 500 upstream exploded`, opts)!;
    expect(lines[0]).toEqual({ text: "API Error: 500 upstream exploded", color: tok("warning"), gutter: { text: "⏺ ", color: tok("warning") } });
  });
  it("`lca` rewrites a BARE `API Error` into the wait-and-retry sentence (L422870)", () => {
    expect(texts(errorSentinelLines(API_ERROR, opts))).toEqual(["API Error: Please wait a moment and try again."]);
  });
  it("`lca` caps at 1000 characters and then — and only then — offers the expand hint", () => {
    const long = `${API_ERROR}: ${"x".repeat(2000)}`;
    const lines = errorSentinelLines(long, { width: 4000, expandHint: EXPAND_HINT_FALLBACK })!;
    expect(lines[0]!.text).toHaveLength(API_ERROR_TRUNCATION + 1);          // 1000 chars + the ellipsis
    expect(lines[0]!.text.endsWith("…")).toBe(true);
    // `<Bg/>` is a sibling of the body INSIDE `lca`'s column (L422911), so it sits under the text, not the glyph.
    expect(lines[1]).toEqual({ text: "  (ctrl+o to expand)", dim: true });
    // …and an UNBOUND chord removes the offer rather than advertising a dead one.
    expect(errorSentinelLines(long, { width: 4000, expandHint: "" })).toHaveLength(1);
  });
  it("an UNRECOGNISED text is not a sentinel at all — `undefined` sends it back to the ordinary render", () => {
    expect(errorSentinelLines("Here is your answer.", opts)).toBeUndefined();
    expect(errorSentinelLines("You've hit your usage limit", opts)).toBeUndefined();   // `Dcs` recorded, not ported
  });
});

describe("renderMessage — an assistant frame routes through the sentinel switch first", () => {
  const assistant = (text: string) => ({ type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text }] } });
  it("renders the sentinel row, not the markdown bullet", () => {
    expect(texts(renderMessage(assistant(CREDIT_BALANCE_LOW), { width: 200 })))
      .toEqual(["Credit balance too low · Add funds: https://platform.claude.com/settings/billing"]);
  });
  it("leaves ordinary prose on the markdown path", () => {
    const lines = renderMessage(assistant("**hi**"), { width: 80, platform: "darwin" });
    expect(lines[0]!.gutter!.text).toBe("⏺ ");
  });
});

// ── `dVo` / `Sha` system subtypes ──────────────────────────────────────────────────────────────────────
describe("systemNoticeLines — `dVo` (L428358) and the generic `Sha` (L428608)", () => {
  it("the generic fallthrough is `⏺ ` + trimmed content wrapped at columns − 10", () => {
    const lines = systemNoticeLines(sysFrame({ subtype: "informational", content: "  hello world  ", level: "warning" }), { width: 80, platform: "darwin" })!;
    expect(lines).toEqual([{ text: "hello world", color: tok("warning"), gutter: { text: "⏺ ", color: tok("warning") } }]);
  });
  // The inset is EXACT, not "roughly ten": `Sha`'s body box is `width: columns - 10` (L428616). A corpus that
  // merely "fits" would pass at 8 or 12 too, so this pins the break POSITION — a 20-character token plus a
  // one-character word is one row at 22 columns of budget and two at 20, and the 20-char token itself is
  // hard-broken at 18. Changing BODY_INSET to 8 or 12 fails on the first or third expectation.
  it("wraps the body at exactly `columns - 10` (L428616), not at the full width", () => {
    const at = (width: number, content: string) =>
      texts(systemNoticeLines(sysFrame({ subtype: "informational", content, level: "notice" }), { width }));
    const token = "x".repeat(20);
    // Ink's own `wrap="wrap"` is `wrapAnsi(…, {trim:false, hard:true})` (ink/build/wrap-text.js), so a break
    // carries its whitespace onto the next row; the continuation is indented two columns under the bullet.
    expect(at(30, `${token} y`)).toEqual([token, "   y"]);                  // budget 20 → the space breaks
    expect(at(32, `${token} y`)).toEqual([`${token} y`]);                   // budget 22 → one row
    expect(at(28, token)).toEqual(["x".repeat(18), "  xx"]);                // budget 18 → hard break
  });
  it("level → presentation, the §9.5 table verbatim", () => {
    const at = (level: string) => systemNoticeLines(sysFrame({ subtype: "informational", content: "x", level }), { width: 80, verbose: true })![0]!;
    expect(at("warning").color).toBe(tok("warning"));
    expect(at("notice").color).toBe(tok("inactive"));
    expect(at("suggestion").color).toBeUndefined();          // "anything else": dot, no colour, not dim
    expect(at("suggestion").gutter).toBeDefined();
    const info = at("info");
    expect(info.dim).toBe(true);
    expect(info.gutter).toBeUndefined();                     // `dot: level !== "info"` — no bullet at all
  });
  it("pack §9.6 correction 2: `level:\"info\"` is BLANKET-suppressed outside verbose (L428497)", () => {
    expect(systemNoticeLines(sysFrame({ subtype: "informational", content: "quiet", level: "info" }), { width: 80 })).toBeNull();
    expect(systemNoticeLines(sysFrame({ subtype: "informational", content: "quiet", level: "info" }), { width: 80, verbose: true })).not.toBeNull();
  });
  it("pack §9.6 correction 1: `api_error` returns NULL — it has no dedicated branch (L428499)", () => {
    expect(systemNoticeLines(sysFrame({ subtype: "api_error", content: "boom", level: "warning" }), { width: 80 })).toBeNull();
  });
  it("`thinking` and `model_refusal_no_fallback` return null (L428398/428400)", () => {
    expect(systemNoticeLines(sysFrame({ subtype: "thinking", content: "x" }), { width: 80 })).toBeNull();
    expect(systemNoticeLines(sysFrame({ subtype: "model_refusal_no_fallback", content: "refused" }), { width: 80 })).toBeNull();
  });
  it("`model_refusal_fallback` → a warning bullet, BOLD warning content, then the /config tip row", () => {
    const lines = systemNoticeLines(sysFrame({ subtype: "model_refusal_fallback", content: "Switched to Sonnet" }), { width: 80, platform: "darwin" })!;
    expect(lines[0]).toEqual({ text: "Switched to Sonnet", color: tok("warning"), bold: true, gutter: { text: "⏺ ", color: tok("warning") } });
    expect(lines[1]).toEqual({ text: "  ⎿  Tip: You can configure model switch behavior in /config", dim: true });
  });
  // `lq()` (L77579) gates the BRANCH, not the subtype: `if (lq() && subtype === …)`. With the env kill-switch
  // set, the frame does not vanish — it falls through to the generic row, losing only the bold and the tip.
  it("`CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK` drops the dedicated form and falls THROUGH to the generic row", () => {
    const saved = process.env.CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK;
    process.env.CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK = "1";
    try {
      const lines = systemNoticeLines(sysFrame({ subtype: "model_refusal_fallback", content: "x" }), { width: 80 })!;
      expect(texts(lines)).toEqual(["x"]);
      expect(lines[0]!.bold).toBeUndefined();
      expect(lines[0]!.color).toBeUndefined();
    } finally { if (saved === undefined) delete process.env.CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK; else process.env.CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK = saved; }
  });
  it("a frame with no STRING content paints nothing (L428510) — which is every other SDK system subtype", () => {
    for (const f of [
      sysFrame({ subtype: "memory_recall", mode: "select", memories: [] }),
      sysFrame({ subtype: "notification", key: "k", text: "not `content`", priority: "low" }),
      sysFrame({ subtype: "api_retry", attempt: 1, max_retries: 3 }),
      sysFrame({ subtype: "compact_boundary", compact_metadata: {} }),
    ]) expect(systemNoticeLines(f, { width: 80 })).toBeNull();
  });
  // `Sha` has NO empty guard: it trims its content and paints whatever is left (L428618–428626), so a frame
  // whose content is whitespace still shows the bullet with an empty body — "something arrived and said
  // nothing". Returning null instead would swallow a frame the CLI shows.
  it("an EMPTY trimmed content still paints the bulleted row, body and all", () => {
    expect(systemNoticeLines(sysFrame({ subtype: "informational", content: "   ", level: "warning" }), { width: 80, platform: "darwin" }))
      .toEqual([{ text: "", color: tok("warning"), gutter: { text: "⏺ ", color: tok("warning") } }]);
    expect(systemNoticeLines(sysFrame({ subtype: "informational", content: "" }), { width: 80, platform: "darwin" }))
      .toEqual([{ text: "", gutter: { text: "⏺ " } }]);
  });
  it("`local_command_output` has no `dVo` branch, so it takes the generic row", () => {
    expect(texts(systemNoticeLines(sysFrame({ subtype: "local_command_output", content: "done" }), { width: 80 }))).toEqual(["done"]);
  });
});

// ── The two Task-10a contract additions ────────────────────────────────────────────────────────────────
describe("species `bash-output` — the fold Task 10a recorded as a gap (`r4e` → `p2`/`y_s`)", () => {
  const body = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join("\n");
  it("folds stdout to three rows plus a marker carrying the THREADED hint", () => {
    const lines = speciesLines("bash-output", `<bash-stdout>${body}</bash-stdout>`, { width: 80, expandHint: "(ctrl+t to expand)" })!;
    // Continuation rows are padded under the `⎿` gutter, exactly as the unfolded form already padded them.
    expect(texts(lines)).toEqual(["line 1", "     line 2", "     line 3", "     … +37 lines (ctrl+t to expand)"]);
    expect(lines[0]!.gutter).toEqual({ text: TOOL_RESULT_GUTTER, dim: true });
  });
  it("folds stderr the same way, in the error colour, marker excluded", () => {
    const lines = speciesLines("bash-output", `<bash-stderr>${body}</bash-stderr>`, { width: 80 })!;
    // Continuation rows are padded under the `⎿` gutter, exactly as the unfolded form already padded them.
    expect(texts(lines)).toEqual(["line 1", "     line 2", "     line 3", "     … +37 lines (ctrl+o to expand)"]);
    expect(lines[0]!.color).toBe(tok("error"));
    expect(lines[3]!.color).toBeUndefined();                 // the dim marker never takes the error colour
  });
  it("a detail projection is unbounded — no marker at all", () => {
    const lines = speciesLines("bash-output", `<bash-stdout>${body}</bash-stdout>`, { width: 80, projection: "detail-all" })!;
    expect(lines).toHaveLength(40);
  });
  it("short output is unfolded, and a silent pair still says `(No output)`", () => {
    expect(texts(speciesLines("bash-output", "<bash-stdout>ok</bash-stdout>", { width: 80 }))).toEqual(["ok"]);
    expect(texts(speciesLines("bash-output", "<bash-stdout></bash-stdout>", { width: 80 }))).toEqual(["(No output)"]);
  });
});

describe("species `command-output` — upstream renders local stdout as MARKDOWN (`km`, L421121)", () => {
  it("bolds a `**…**` span instead of printing the asterisks", () => {
    const lines = speciesLines("command-output", "<local-command-stdout>**bold** tail</local-command-stdout>", { width: 80 })!;
    expect(lines[0]!.text).toBe("bold tail");
    expect(lines[0]!.segments?.some((s) => s.bold)).toBe(true);
    expect(lines[0]!.gutter).toEqual({ text: LOCAL_OUTPUT_GUTTER, dim: true });
  });
  it("stderr stays PLAIN in the error colour — `oEn` runs only stdout through the walker", () => {
    const lines = speciesLines("command-output", "<local-command-stderr>**raw**</local-command-stderr>", { width: 80 })!;
    expect(lines[0]!.text).toBe("**raw**");
    expect(lines[0]!.color).toBe(tok("error"));
  });
});

// ── The fourth expand-hint site ────────────────────────────────────────────────────────────────────────
// `toolSummaries`' search sentence is pinned HERE rather than in the live useChat test: its hint is
// compact-only (upstream `$Wo`'s non-verbose branch, L421528), and a live compact transcript folds every
// read/search call into the group row that replaces the typed body — so the projection has to be named
// directly to reach it. The threading is the same field the other three read.
describe("toolSummaries `Found N files` — the fourth expand-hint site", () => {
  const grepEvent = (): ToolEvent => ({
    id: "g1", name: "Grep", input: { pattern: "x" }, callSequence: 1, route: "top-level",
    result: { content: "a.ts", isError: false, resultSequence: 2, sidecar: { scope: "call", value: { mode: "files_with_matches", numFiles: 3, filenames: ["a.ts", "b.ts", "c.ts"] } } },
  });
  const opts = (expandHint?: string): ProjectionOptions => ({
    cwd: "/tmp", home: "/home", platform: "darwin", columns: 80, projection: "compact", now: 0, verbose: false,
    ...(expandHint === undefined ? {} : { expandHint }),
  });
  const sentence = (expandHint?: string) => {
    const event = grepEvent();
    return texts(summaryLines(event, normalizeToolResult(event, { verbose: false }), opts(expandHint)))[0];
  };
  it("carries the THREADED chord, keeps the literal when nothing is threaded, and drops the clause when unbound", () => {
    expect(sentence("(ctrl+t to expand)")).toBe("Found 3 files (ctrl+t to expand)");
    expect(sentence()).toBe("Found 3 files (ctrl+o to expand)");
    expect(sentence("")).toBe("Found 3 files");
  });
});
