// tui/test/teammate.test.tsx — F4 Task 10c (TR39): teammate attribution. Until this task a child (subagent)
// message rendered NOTHING anywhere: `projectMessageEntry` returned `[]` for every frame carrying a
// `parent_tool_use_id`, so a dispatched agent's prose existed in the retained document and on no screen.
//
// The three forms are upstream's, pack §9.8 (bundle L425444–425520):
//  · `Cvr` — the LIVE attribution: `@ <name>❯` in the agent's own colour, then the content through the
//    markdown walker inside a `paddingLeft: 2` box.
//  · `Ivr` — the COLLAPSED run: `› N messages from @<name>`, all dim, with the singular literal `Message`
//    (capitalised, no number) at count === 1. Upstream coalesces ADJACENT same-name messages (`Jbn`), so the
//    count is a run total and not a per-frame one.
//  · `xvr` — the LIFECYCLE row: `⏺ Teammate @<name> finished | failed | was interrupted`, bullet coloured
//    success/error/warning, with a dim `: <reason>` that appears on the failed arm only.
// The eight `*_FOR_SUBAGENTS_ONLY` tokens (pack §9.9, bundle L156475) are the palette, read live off the
// theme so a /theme switch repaints them like every other token.
import { describe, it, expect } from "vitest";
import {
  teammateMessageLines, teammateCollapsedLine, teammateLifecycleLine,
  TEAMMATE_POINTER, TEAMMATE_POINTER_SMALL, TEAMMATE_FAILURE_MAX,
} from "../../src/tui/species.js";
import { projectCompact, projectDetail, type ProjectionContext, type RenderItem } from "../../src/tui/toolRenderer.js";
import { TranscriptDocument } from "../../src/tui/transcriptModel.js";
import { SUBAGENT_TOKEN_NAMES, subagentColor, subagentTokens, resolveThemeColor, setTheme, currentTheme, themeTokens } from "../../src/tui/theme.js";
import { ingestTaskFrame, type AgentMeta } from "../../src/tui/agentProgress.js";
import { SHOW_ALL_HINT, EXPAND_HINT_FALLBACK } from "../../src/tui/keys/hints.js";

const ctx: ProjectionContext = { cwd: "/work", home: "/home/me", platform: "darwin", columns: 80, now: 0 };
const rows = (items: readonly RenderItem[]): string[] => items.flatMap((i) => (i.kind === "line" ? [i.line.text] : i.body.map((b) => b.text)));
const lineAt = (items: readonly RenderItem[], text: string) => {
  const found = items.find((i) => i.kind === "line" && i.line.text === text);
  if (found === undefined || found.kind !== "line") throw new Error(`no line ${JSON.stringify(text)} in ${JSON.stringify(rows(items))}`);
  return found.line;
};
const tok = (name: keyof ReturnType<typeof themeTokens>) => resolveThemeColor(themeTokens()[name] as string);

/** One agent dispatch: the `Agent` tool_use frame that mints the id every child message points back at. */
const dispatch = (id: string, subagentType: string) => ({
  type: "assistant", uuid: `u-${id}`,
  message: { id: `m-${id}`, content: [{ type: "tool_use", id, name: "Agent", input: { subagent_type: subagentType, description: "d" } }] },
});
const dispatchResult = (id: string, content: unknown, isError = false) => ({
  type: "user", uuid: `r-${id}`, message: { content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }] },
});
/** A child frame: an ordinary assistant message wearing the parent's tool-use id. */
const child = (parent: string, uuid: string, text: string) => ({
  type: "assistant", uuid, parent_tool_use_id: parent, message: { id: `mm-${uuid}`, content: [{ type: "text", text }] },
});

describe("F4 Task 10c — teammate attribution", () => {
  describe("the nested branch", () => {
    it("renders NOTHING in the compact projection — F3's agent-progress rows are that surface", () => {
      const doc = new TranscriptDocument();
      doc.appendSdk("host", dispatch("t1", "reviewer"));
      doc.appendSdk("host", child("t1", "c1", "found a bug"));
      expect(rows(projectCompact(doc, ctx)).some((r) => r.includes("@ reviewer") || r.includes("from @reviewer"))).toBe(false);
    });

    it("attributes the child in detail-all: `@ <subagent_type>❯` then the content at paddingLeft 2", () => {
      const doc = new TranscriptDocument();
      doc.appendSdk("host", dispatch("t1", "reviewer"));
      doc.appendSdk("host", child("t1", "c1", "found a bug"));
      const items = projectDetail(doc, { ...ctx, projection: "detail-all" });
      const header = lineAt(items, `@ reviewer${TEAMMATE_POINTER}`);
      expect(header.segments?.[0]?.color).toBe(subagentColor(0));
      expect(rows(items)).toContain("  found a bug");
    });

    it("gives two different agents two different colours, stable across each agent's own messages", () => {
      const doc = new TranscriptDocument();
      doc.appendSdk("host", dispatch("t1", "alpha"));
      doc.appendSdk("host", dispatch("t2", "beta"));
      doc.appendSdk("host", child("t1", "c1", "one"));
      doc.appendSdk("host", child("t2", "c2", "two"));
      doc.appendSdk("host", child("t1", "c3", "three"));
      const items = projectDetail(doc, { ...ctx, projection: "detail-all" });
      const headers = items.filter((i): i is Extract<RenderItem, { kind: "line" }> => i.kind === "line" && i.line.text.startsWith("@ "));
      expect(headers.map((h) => h.line.text)).toEqual([`@ alpha${TEAMMATE_POINTER}`, `@ beta${TEAMMATE_POINTER}`, `@ alpha${TEAMMATE_POINTER}`]);
      const colors = headers.map((h) => h.line.segments?.[0]?.color);
      expect(colors[0]).toBe(colors[2]);                                     // same agent → same colour
      expect(colors[0]).not.toBe(colors[1]);                                 // different agent → different colour
    });
  });

  describe("the collapsed run (`Ivr`)", () => {
    it("coalesces ADJACENT same-agent messages into one dim row, offering the detail view's own chord", () => {
      const doc = new TranscriptDocument();
      doc.appendSdk("host", dispatch("t1", "reviewer"));
      doc.appendSdk("host", child("t1", "c1", "one"));
      doc.appendSdk("host", child("t1", "c2", "two"));
      const items = projectDetail(doc, { ...ctx, projection: "detail-collapsed" });
      const line = lineAt(items, `${TEAMMATE_POINTER_SMALL} 2 messages from @reviewer ${SHOW_ALL_HINT}`);
      expect(line.dim).toBe(true);
    });

    it("does NOT coalesce across agents — two adjacent teammates keep two rows (`Jbn`'s name guard)", () => {
      // The run accumulator is keyed on the DISPLAY NAME as well as adjacency: upstream `Jbn` opens a new
      // run the moment the name changes. Without that half of the guard two different agents' adjacent
      // frames merge into one `› 2 messages from @alpha`, which attributes beta's prose to alpha — the one
      // thing this whole feature exists to prevent.
      const doc = new TranscriptDocument();
      doc.appendSdk("host", dispatch("t1", "alpha"));
      doc.appendSdk("host", dispatch("t2", "beta"));
      doc.appendSdk("host", child("t1", "c1", "one"));
      doc.appendSdk("host", child("t2", "c2", "two"));
      const collapsed = rows(projectDetail(doc, { ...ctx, projection: "detail-collapsed" })).filter((r) => r.startsWith(TEAMMATE_POINTER_SMALL));
      expect(collapsed).toEqual([
        `${TEAMMATE_POINTER_SMALL} Message from @alpha ${SHOW_ALL_HINT}`,
        `${TEAMMATE_POINTER_SMALL} Message from @beta ${SHOW_ALL_HINT}`,
      ]);
    });

    it("PACK §9.8: count === 1 is the singular literal `Message`, with no number at all", () => {
      expect(teammateCollapsedLine("reviewer", 1, "").text).toBe(`${TEAMMATE_POINTER_SMALL} Message from @reviewer`);
      expect(teammateCollapsedLine("reviewer", 2, "").text).toBe(`${TEAMMATE_POINTER_SMALL} 2 messages from @reviewer`);
    });

    it("an EMPTY hint drops the parenthetical entirely rather than advertising a dead chord", () => {
      expect(teammateCollapsedLine("reviewer", 3, "").text.endsWith("@reviewer")).toBe(true);
      expect(teammateCollapsedLine("reviewer", 3, EXPAND_HINT_FALLBACK).text.endsWith(EXPAND_HINT_FALLBACK)).toBe(true);
    });
  });

  describe("the lifecycle row (`xvr`)", () => {
    const cases = [
      { reason: "available" as const, verb: "finished", token: "success" as const },
      { reason: "failed" as const, verb: "failed", token: "error" as const },
      { reason: "interrupted" as const, verb: "was interrupted", token: "warning" as const },
    ];
    for (const { reason, verb, token } of cases)
      it(`${reason} → \`⏺ Teammate @name ${verb}\` with the ${token} bullet`, () => {
        const line = teammateLifecycleLine("reviewer", "#abcdef", reason, undefined, "darwin");
        expect(line.text).toBe(`⏺ Teammate @reviewer ${verb}`);
        expect(line.segments?.[0]).toEqual({ text: "⏺", color: tok(token) });
        expect(line.segments?.find((s) => s.text === "@reviewer")).toEqual({ text: "@reviewer", color: "#abcdef", bold: true });
      });

    it("the `: <reason>` suffix is dim, FAILED-only, first-lined and capped at `snn`", () => {
      const long = `${"x".repeat(TEAMMATE_FAILURE_MAX + 40)}\nsecond line`;
      const failed = teammateLifecycleLine("r", "#fff", "failed", long, "darwin");
      expect(failed.text).toBe(`⏺ Teammate @r failed: ${"x".repeat(TEAMMATE_FAILURE_MAX)}`);
      expect(failed.segments?.at(-1)?.dim).toBe(true);
      expect(teammateLifecycleLine("r", "#fff", "interrupted", "boom", "darwin").text).toBe("⏺ Teammate @r was interrupted");
    });

    it("closes an agent's detail block, reading the verb off the tool result — and never in compact", () => {
      const doc = new TranscriptDocument();
      doc.appendSdk("host", dispatch("t1", "reviewer"));
      doc.appendSdk("host", dispatchResult("t1", "boom", true));
      expect(rows(projectDetail(doc, { ...ctx, projection: "detail-all" }))).toContain("⏺ Teammate @reviewer failed: boom");
      expect(rows(projectCompact(doc, ctx)).some((r) => r.startsWith("⏺ Teammate"))).toBe(false);
    });

    it("stays off an ANONYMOUS dispatch — `general-purpose` has no identity to close on (`Out`, L188606)", () => {
      const doc = new TranscriptDocument();
      doc.appendSdk("host", dispatch("t1", "general-purpose"));
      doc.appendSdk("host", dispatchResult("t1", "ok"));
      expect(rows(projectDetail(doc, { ...ctx, projection: "detail-all" })).some((r) => r.startsWith("⏺ Teammate"))).toBe(false);
      // …but a child of that same anonymous dispatch still gets attributed: "whose prose is this" is a
      // question the bare noun answers, and leaving it unattributed reads as the leader talking.
      doc.appendSdk("host", child("t1", "c1", "hello"));
      expect(rows(projectDetail(doc, { ...ctx, projection: "detail-all" }))).toContain(`@ Agent${TEAMMATE_POINTER}`);
    });
  });

  describe("the palette (pack §9.9 corrected, bundle L156475)", () => {
    // BYTE-EXACT, all 8 tokens × all 4 non-ANSI blocks, asserted as LITERALS rather than through the
    // resolver or through `SUBAGENT_THEMES` identity: the pack's §9.9 table was both incomplete (it
    // extracted 4 of the 6 objects on L156475) and mislabelled (its "daltonized" row is LIGHT-daltonized),
    // so the only defence against a re-introduced pack value is the bundle's own strings written out here.
    // Object identities on L156475, matched by their ordinary 30-token cells: bZg=light, EZg=light-ansi,
    // SZg=dark-ansi, AZg=light-daltonized, vZg=dark, TZg=dark-daltonized.
    const LIGHT_AND_DARK = {                                                 // bZg === vZg, byte-for-byte upstream
      red: "rgb(220,38,38)", blue: "rgb(106,155,204)", green: "rgb(22,163,74)", yellow: "rgb(202,138,4)",
      purple: "rgb(130,125,189)", orange: "rgb(217,119,87)", pink: "rgb(196,102,134)", cyan: "rgb(8,145,178)",
    };
    const BLOCKS: [Parameters<typeof setTheme>[0], Record<string, string>][] = [
      ["light", LIGHT_AND_DARK],
      ["dark", LIGHT_AND_DARK],
      ["auto", LIGHT_AND_DARK],                                              // auto aliases dark, as THEMES' own auto does
      ["light-daltonized", {                                                 // AZg — the block the pack mislabelled
        red: "rgb(204,0,0)", blue: "rgb(0,102,204)", green: "rgb(0,204,0)", yellow: "rgb(255,204,0)",
        purple: "rgb(128,0,128)", orange: "rgb(255,128,0)", pink: "rgb(255,102,178)", cyan: "rgb(0,178,178)",
      }],
      ["dark-daltonized", {                                                  // TZg — the block the pack never extracted
        red: "rgb(255,102,102)", blue: "rgb(102,178,255)", green: "rgb(102,255,102)", yellow: "rgb(255,255,102)",
        purple: "rgb(178,102,255)", orange: "rgb(255,178,102)", pink: "rgb(255,153,204)", cyan: "rgb(102,204,204)",
      }],
    ];
    it("carries all eight tokens VERBATIM in every non-ANSI theme block", () => {
      expect([...SUBAGENT_TOKEN_NAMES]).toEqual(["red", "blue", "green", "yellow", "purple", "orange", "pink", "cyan"]);
      const before = currentTheme(), tokensBefore = themeTokens();
      try {
        for (const [theme, expected] of BLOCKS) {
          setTheme(theme);
          expect(subagentTokens(), `subagent palette for ${theme}`).toEqual(expected);
          // …and every one of the eight is reachable BY INDEX in `Ov`'s order, which is what an agent wears.
          for (const [index, name] of SUBAGENT_TOKEN_NAMES.entries())
            expect(subagentColor(index), `${theme} index ${index} (${name})`).toBe(resolveThemeColor(expected[name]!));
        }
      } finally { setTheme(before); }
      expect(themeTokens()).toEqual(tokensBefore);
    });

    it("cycles: the ninth agent wraps back onto the first colour", () => {
      expect(subagentColor(8)).toBe(subagentColor(0));
      expect(new Set([0, 1, 2, 3, 4, 5, 6, 7].map(subagentColor)).size).toBe(8);
    });
  });

  describe("the anchored cache sees agentMeta", () => {
    // `teammateName` reads the LIVE `agentMeta` map, and `buildAnchoredEntries` — which is where every
    // teammate row is built — is memoized. The map is mutated in place by `ingestTaskFrame` on a `task`
    // event that need not touch the document, so without `agentMetaGeneration()` in the cache epoch the
    // memo keeps serving the anonymous `@Agent` header after the name has arrived. This is the attach
    // case exactly: a child frame whose dispatch we never received, named later by `task_started`.
    const attachedChild = () => {
      const doc = new TranscriptDocument();
      doc.appendSdk("host", child("t9", "c1", "found a bug"));
      return doc;
    };
    const started = (id: string, subagentType: string) => ({ type: "system", subtype: "task_started", tool_use_id: id, subagent_type: subagentType });

    it("re-attributes after a `task_started` that writes NO document row (detail-all header)", () => {
      const doc = attachedChild(), agentMeta = new Map<string, AgentMeta>();
      const options = { ...ctx, agentMeta, projection: "detail-all" as const };
      expect(rows(projectDetail(doc, options))).toContain(`@ Agent${TEAMMATE_POINTER}`);
      ingestTaskFrame(agentMeta, started("t9", "reviewer"), 0);              // live map mutated, document untouched
      expect(rows(projectDetail(doc, options))).toContain(`@ reviewer${TEAMMATE_POINTER}`);
    });

    it("re-attributes the COLLAPSED row too — the same cached builder produces it", () => {
      const doc = attachedChild(), agentMeta = new Map<string, AgentMeta>();
      const options = { ...ctx, agentMeta, projection: "detail-collapsed" as const };
      expect(rows(projectDetail(doc, options))).toContain(`${TEAMMATE_POINTER_SMALL} Message from @Agent ${SHOW_ALL_HINT}`);
      ingestTaskFrame(agentMeta, started("t9", "reviewer"), 0);
      expect(rows(projectDetail(doc, options))).toContain(`${TEAMMATE_POINTER_SMALL} Message from @reviewer ${SHOW_ALL_HINT}`);
    });
  });

  describe("markdown + width", () => {
    it("runs the content through the markdown walker at the inset width", () => {
      const lines = teammateMessageLines("r", "#abc", "**bold** text", { width: 40 });
      expect(lines[0]?.text).toBe(`@ r${TEAMMATE_POINTER}`);
      expect(lines[1]?.text).toBe("  bold text");
      expect(lines[1]?.segments?.[0]?.text).toBe("  ");                      // the paddingLeft: 2 box, its own segment
      expect(lines[1]?.segments?.some((s) => s.bold === true)).toBe(true);
    });

    it("an EMPTY content renders the bare attributed header and no body rows (`tpa &&`)", () => {
      expect(teammateMessageLines("r", "#abc", "", { width: 40 }).map((l) => l.text)).toEqual([`@ r${TEAMMATE_POINTER}`]);
    });
  });
});
