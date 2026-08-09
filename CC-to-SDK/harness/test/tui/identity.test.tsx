// tui/test/identity.test.tsx — F4 Task 8: the two message IDENTITIES, and the one renderer each of them has.
// Assistant: the platform bullet (`Za`, bundle L41484) in the `text` token (`VAr`, L422851) — NOT the accent.
// User: the `❯ ` pointer gutter in `subtle` over a `userMessageBackground` band padded to `width - 1`
// (`xqo` L426069 + `Mqo` L426170/L426178), with the 10 000-char fold (L426143–426167, constants L426183).
// The point of pinning the LIVE path and the QUEUED path here too is that upstream has exactly one prompt-echo
// component and we now have exactly one function — a test per surface is what keeps them from drifting apart.
import { describe, it, expect, afterEach } from "vitest";
import React, { useEffect } from "react";
import { Text } from "ink";
import { render } from "ink-testing-library";
import stringWidth from "string-width";
import { renderMessage, userEchoLines } from "../../src/tui/render.js";
import { ACCENT, resolveThemeColor, setTheme, themeTokens, THEMES } from "../../src/tui/theme.js";
import { useChat, type ChatSession } from "../../src/tui/useChat.js";
import { fakeRemote } from "./helpers/fakeRemote.js";
import { renderWithKeymap } from "./keysTestUtil.js";
import { ChatApp } from "../../src/tui/ChatApp.js";
import { projectCompact, type RenderItem } from "../../src/tui/toolRenderer.js";
import { TranscriptDocument } from "../../src/tui/transcriptModel.js";

// theme.ts's `current`/ACCENT are module-scoped and vitest isolates per FILE — a test that previews a theme
// must not leak it into the next one (chat.test.tsx's own idiom).
afterEach(() => setTheme("auto"));

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) { await new Promise((r) => setTimeout(r, 0)); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}

const QUEUE_PAD = 2;                                    // ChatApp's own `$jp` (bundle L426022), pinned here
const asst = (text: string) => ({ type: "assistant", message: { content: [{ type: "text", text }] } });
const tok = (name: "text" | "subtle" | "userMessageBackground") => resolveThemeColor(themeTokens()[name]);

describe("assistant identity — the platform bullet", () => {
  it("uses ⏺ on darwin and ● everywhere else, colored with the `text` token, never the accent", () => {
    expect(renderMessage(asst("hi"), { platform: "darwin" })[0]!.gutter).toEqual({ text: "⏺ ", color: tok("text") });
    expect(renderMessage(asst("hi"), { platform: "linux" })[0]!.gutter).toEqual({ text: "● ", color: tok("text") });
    expect(renderMessage(asst("hi"), { platform: "win32" })[0]!.gutter).toEqual({ text: "● ", color: tok("text") });
    expect(renderMessage(asst("hi"), { platform: "darwin" })[0]!.gutter!.color).not.toBe(ACCENT);
  });
  it("resolves the gutter color PER CALL, so a /theme switch repaints the very next render", () => {
    setTheme("light");
    expect(renderMessage(asst("hi"), { platform: "linux" })[0]!.gutter!.color).toBe(resolveThemeColor(THEMES.light.text));
    setTheme("dark");
    expect(renderMessage(asst("hi"), { platform: "linux" })[0]!.gutter!.color).toBe(resolveThemeColor(THEMES.dark.text));
  });
  it("keeps the two-column continuation indent and puts no gutter on a continuation line", () => {
    const lines = renderMessage(asst("hello\nworld"), { platform: "darwin" });
    expect(lines.map((l) => l.text)).toEqual(["hello", "  world"]);
    expect(lines[1]!.gutter).toBeUndefined();
  });
});

describe("userEchoLines — the one prompt-echo renderer", () => {
  it("bands a short prompt: ❯ gutter in `subtle`, body in `text`, userMessageBackground, padded to width-1", () => {
    const lines = userEchoLines("hi", { width: 20 });
    expect(lines).toHaveLength(1);
    const line = lines[0]!;
    expect(line.text).toBe("❯ hi" + " ".repeat(15));            // 19 columns = width - 1 (upstream paddingRight: 1)
    expect(stringWidth(line.text)).toBe(19);
    expect(line.bg).toBe(tok("userMessageBackground"));
    expect(line.segments).toEqual([
      { text: "❯ ", color: tok("subtle"), bg: tok("userMessageBackground") },
      { text: "hi" + " ".repeat(15), color: tok("text"), bg: tok("userMessageBackground") },
    ]);
  });
  it("renders NOTHING for an empty prompt (upstream returns null rather than an empty band)", () => {
    expect(userEchoLines("", { width: 40 })).toEqual([]);
  });
  it("wraps at width-3 and indents every continuation row under the gutter, banding all of them", () => {
    const lines = userEchoLines("alpha beta gamma", { width: 12 });
    expect(lines.map((l) => l.text.trimEnd())).toEqual(["❯ alpha", "  beta", "  gamma"]);
    for (const l of lines) {
      expect(stringWidth(l.text)).toBe(11);
      expect(l.bg).toBe(tok("userMessageBackground"));
      expect(l.segments![0]!.bg).toBe(tok("userMessageBackground"));
    }
    expect(lines[1]!.segments![0]!.text).toBe("  ");            // the gutter cell is blank, not repeated
    expect(lines[1]!.segments![0]!.color).toBe(tok("text"));
  });
  it("keeps hard newlines as their own rows", () => {
    expect(userEchoLines("one\ntwo", { width: 30 }).map((l) => l.text.trimEnd())).toEqual(["❯ one", "  two"]);
  });
  it("re-resolves the band per call so /theme repaints an echo rendered under another theme", () => {
    setTheme("light");
    expect(userEchoLines("hi", { width: 20 })[0]!.bg).toBe(resolveThemeColor(THEMES.light.userMessageBackground));
  });
});

describe("userEchoLines — the 10 000-char fold", () => {
  // 600 × 21 chars ≈ 12 600 — comfortably over `tWp = 1e4`, with enough newlines that `hiddenLines` is big.
  const body = Array.from({ length: 600 }, (_, i) => `line ${String(i).padStart(3, "0")} ${"x".repeat(11)}`).join("\n");
  const count = (s: string, from = 0) => { let n = 0; for (let i = s.indexOf("\n", from); i !== -1; i = s.indexOf("\n", i + 1)) n++; return n; };

  it("folds a 12k prompt into head 2 500 + a titled rule + tail 2 500, dropping the middle", () => {
    expect(body.length).toBeGreaterThan(12_000);
    const lines = userEchoLines(body, { width: 60 });
    const text = lines.map((l) => l.text).join("\n");
    const hidden = count(body, 2500) - count(body.slice(-2500));
    expect(text).toContain("line 000");                                   // head kept
    expect(text).toContain("line 599");                                   // tail kept
    expect(text).toContain(`(${hidden} lines hidden)`);
    // A line that lies wholly inside the dropped middle is gone. Char 2500 lands around line ~119.
    expect(text).not.toContain("line 300");
    expect(hidden).toBeGreaterThan(300);
  });
  it("draws the rule as Sg does with titleAlign 'start': ≤4 leading dashes, the title in `subtle`, dashes to width", () => {
    const lines = userEchoLines(body, { width: 60 });
    const rule = lines.find((l) => l.text.includes("hidden)"))!;
    expect(stringWidth(rule.text)).toBe(59);                              // banded to width - 1 like every other row
    expect(rule.text.startsWith("  ──── (")).toBe(true);                  // 2-col indent, then min(4, gap) dashes
    expect(rule.text.endsWith("─")).toBe(true);
    expect(rule.segments![1]!.color).toBe(tok("subtle"));
    expect(rule.segments![1]!.bg).toBe(tok("userMessageBackground"));
    // The DASH spans are undimmed subtle, but the TITLE span rides its own nested `<Text dimColor={true}>`
    // (L183972) — dim title inside a plain-subtle rule (t8 review Minor 1).
    const title = rule.segments!.find((s) => s.text.includes("hidden)"))!;
    expect(title.dim).toBe(true);
    expect(title.color).toBe(tok("subtle"));
    expect(rule.segments![1]!.dim).toBeUndefined();
    expect(rule.segments![3]!.dim).toBeUndefined();
  });
  it("pluralizes the title off `hiddenLines === 1`", () => {
    const one = "a".repeat(5000) + "\n" + "b".repeat(5001);               // 10 002 chars, exactly one hidden newline
    expect(one.length).toBeGreaterThan(10_000);
    expect(userEchoLines(one, { width: 60 }).map((l) => l.text).join("\n")).toContain("(1 line hidden)");
  });
  it("does NOT fold at exactly the threshold — the guard is `> 10 000`", () => {
    const at = "a".repeat(10_000);
    expect(userEchoLines(at, { width: 60 }).map((l) => l.text).join("\n")).not.toContain("hidden)");
  });
});

// THE CACHE-KEY GUARD. `renderMessage` became platform-dependent with this task, and the anchored-entry memo
// in toolRenderer keys `revision × theme × columns × projection × verbose × platform`. Drop `platform` from
// that key and this test serves the FIRST projection's glyph to the second — the exact stale-cache class the
// key exists to prevent. It is the only test that projects one document under two platforms, so without it
// the key input is unguarded (the pre-existing platform-varying test at toolRenderer.test.tsx:291 projects a
// tool-only document, whose pending row is rendered outside the cache).
describe("the platform bullet survives the anchored-entry cache", () => {
  it("projects ONE document under two platforms and gets a different glyph each time", () => {
    const doc = new TranscriptDocument();
    doc.appendSdk("host", { type: "assistant", uuid: "a-1", message: { id: "m1", content: [{ type: "text", text: "answer" }] } });
    const base = { cwd: "/work", home: "/home/me", columns: 100, now: 0 };
    const mac = projectCompact(doc, { ...base, platform: "darwin" });
    const linux = projectCompact(doc, { ...base, platform: "linux" });
    expect((mac[0] as { line: { gutter?: { text: string } } }).line.gutter!.text).toBe("⏺ ");
    expect((linux[0] as { line: { gutter?: { text: string } } }).line.gutter!.text).toBe("● ");
    // and back again, to prove the second projection did not simply evict the first
    expect((projectCompact(doc, { ...base, platform: "darwin" })[0] as { line: { gutter?: { text: string } } }).line.gutter!.text).toBe("⏺ ");
  });
});

describe("the same band on every surface", () => {
  it("a replayed SDK user frame renders through userEchoLines, not a hand-rolled `› `", () => {
    const m = { type: "user", message: { role: "user", content: [{ type: "text", text: "fix the parser" }] } };
    expect(renderMessage(m, { width: 30 })).toEqual(userEchoLines("fix the parser", { width: 30 }));
  });

  it("LIVE: a submitted prompt's local echo carries the band form (acceptance #5)", async () => {
    const fake = fakeRemote();
    const api: { run?: (s: string) => void; items?: readonly RenderItem[] } = {};
    function H() {
      const c = useChat(() => fake as unknown as ChatSession, {}, { columns: () => 24 });
      api.run = c.submit; api.items = c.state.staticItems;
      return <Text>{c.state.staticItems.length}</Text>;
    }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    api.run!("hello there");
    await waitFor(() => (api.items ?? []).length > 0);
    // The local echo is the FIRST published item and its id names the local entry that minted it — the
    // assistant reply that follows it is the fake's own, and is here only to prove the two are distinct rows.
    const items = (api.items ?? []).filter((i): i is Extract<RenderItem, { kind: "line" }> => i.kind === "line");
    const echo = items.find((i) => i.id.includes("user-echo"))!.line;
    expect(echo.text).toBe("❯ hello there" + " ".repeat(23 - 13));
    expect(echo.bg).toBe(tok("userMessageBackground"));
    expect(echo.segments![0]).toEqual({ text: "❯ ", color: tok("subtle"), bg: tok("userMessageBackground") });
    expect(echo.gutter).toBeUndefined();                             // the band carries the pointer, not a Gutter
    expect(items.map((i) => i.line.text).join("|")).not.toContain("› ");
    expect(lastFrame()).toBeDefined();
  });

  it("QUEUED: a type-ahead prompt renders through the same band, indented two columns — no `⋯ queued:` prefix", async () => {
    let fake: ReturnType<typeof fakeRemote>;
    fake = fakeRemote({
      submit: async () => { fake.pushEvent({ kind: "turn", phase: "start", seq: 1 }); return new Promise(() => {}); },
    });
    const deps = { columns: () => 40, getSessionMessages: async () => [] as any[] };
    const { stdin, lastFrame } = renderWithKeymap(<ChatApp makeSession={() => fake as unknown as ChatSession} client={{ kind: "loopback" }} cwd={process.cwd()} deps={deps} />);
    await waitFor(() => (lastFrame() ?? "").includes("❯\u00a0"));
    stdin.write("start"); await waitFor(() => (lastFrame() ?? "").includes("start"));
    stdin.write("\r"); await waitFor(() => (lastFrame() ?? "").includes("esc to interrupt"));
    stdin.write("later prompt"); await waitFor(() => (lastFrame() ?? "").includes("later prompt"));
    stdin.write("\r");
    await waitFor(() => stripAnsi(lastFrame() ?? "").includes("❯ later prompt"));
    const flat = stripAnsi(lastFrame() ?? "");
    expect(flat).not.toContain("⋯ queued:");
    const row = flat.split("\n").find((l) => l.includes("❯ later prompt"))!;
    expect(row.startsWith("  ❯ later prompt")).toBe(true);              // `wqo`'s paddingX: 2, then the band
    expect(row.replace(/\s+$/, "")).toBe("  ❯ later prompt");           // nothing else on the row — no prefix, no clip
    expect(row.length).toBe(QUEUE_PAD + (40 - QUEUE_PAD * 2) - 1);      // paddingX + the band's own width-1
    // The prompt ALREADY submitted wears the identical band in the transcript above — one renderer, two surfaces.
    expect(flat).toContain("❯ start");
  });
});
