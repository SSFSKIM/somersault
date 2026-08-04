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
import { SUBAGENT_TOKEN_NAMES, subagentColor, subagentTokens, resolveThemeColor, setTheme, themeTokens } from "../../src/tui/theme.js";
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

  describe("the palette (pack §9.9, bundle L156475)", () => {
    it("carries the eight tokens VERBATIM for every non-ANSI theme", () => {
      expect([...SUBAGENT_TOKEN_NAMES]).toEqual(["red", "blue", "green", "yellow", "purple", "orange", "pink", "cyan"]);
      const before = themeTokens();
      setTheme("light");
      expect(subagentTokens()).toEqual({
        red: "rgb(220,38,38)", blue: "rgb(106,155,204)", green: "rgb(22,163,74)", yellow: "rgb(202,138,4)",
        purple: "rgb(130,125,189)", orange: "rgb(217,119,87)", pink: "rgb(196,102,134)", cyan: "rgb(8,145,178)",
      });
      setTheme("dark-daltonized");
      expect(subagentTokens().red).toBe("rgb(255,102,102)");
      expect(subagentTokens().cyan).toBe("rgb(102,204,204)");
      setTheme("auto");
      expect(themeTokens()).toEqual(before);
    });

    it("cycles: the ninth agent wraps back onto the first colour", () => {
      expect(subagentColor(8)).toBe(subagentColor(0));
      expect(new Set([0, 1, 2, 3, 4, 5, 6, 7].map(subagentColor)).size).toBe(8);
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

    it("carries the optional summary in the DEFAULT colour beside the coloured header", () => {
      const [header] = teammateMessageLines("r", "#abc", "", { width: 40, summary: "reviewing" });
      expect(header?.text).toBe(`@ r${TEAMMATE_POINTER} reviewing`);
      expect(header?.segments?.[1]).toEqual({ text: " reviewing" });
    });
  });
});
