// tui/test/species.test.ts — F4 Task 10a: the sentinel router. Upstream `ERe` (bundle L426424–426532) is a
// FIFTEEN-exit switch that decides what a `user` frame actually IS before anything paints it; the pack §9.2
// enumerates every exit and §9.1 every tag constant. These tests pin (a) the classification and its
// EVALUATION ORDER (an earlier exit must win over a later one when a text matches both), (b) the per-species
// line form, and (c) that both the live path (`renderMessage`) and the disk path (`replayDocument`) route
// through the same classifier, so a sentinel can never be band-wrapped as an ordinary prompt on either.
import { describe, it, expect } from "vitest";
import { classifyUserText, speciesLines, tagInner, INTERRUPT_PLAIN, INTERRUPT_TOOL, INTERRUPTED_TEXT, TOOL_RESULT_GUTTER, LOCAL_OUTPUT_GUTTER, COMMAND_ECHO_RE, COMMAND_OUTPUT_RE, CAVEAT_RE, COMPACT_SUMMARY_RE } from "../../src/tui/species.js";
import * as rows from "../../src/sessions/rows.js";
import { renderMessage } from "../../src/tui/render.js";
import { replayDocument } from "../../src/tui/replay.js";
import { projectCompact } from "../../src/tui/toolRenderer.js";
import { resolveThemeColor, themeTokens } from "../../src/tui/theme.js";

const tok = (name: keyof ReturnType<typeof themeTokens>) => resolveThemeColor(themeTokens()[name] as string);
const textOf = (lines: readonly { text: string }[]) => lines.map((l) => l.text).join("\n");
const userMsg = (text: string) => ({ type: "user", message: { role: "user", content: [{ type: "text", text }] } });

describe("tagInner — the port of upstream `al` (L373235)", () => {
  it("returns the first BALANCED non-empty inner and null otherwise", () => {
    expect(tagInner("<summary>done</summary>", "summary")).toBe("done");
    expect(tagInner("<tick></tick>", "tick")).toBeNull();                       // empty inner is falsy upstream too
    expect(tagInner("nothing here", "summary")).toBeNull();
    expect(tagInner("<a><summary>x</summary></a>", "summary")).toBe("x");
    // attributes on the open tag are allowed (`<task-notification kind="…">`)
    expect(tagInner('<status kind="x">completed</status>', "status")).toBe("completed");
  });
});

describe("classifyUserText — the fifteen-exit order of `ERe`", () => {
  it("exit 1: empty / whitespace / the literal `(no content)` (BC, L104957)", () => {
    expect(classifyUserText("")).toBe("empty");
    expect(classifyUserText("(no content)")).toBe("empty");
    expect(classifyUserText(" (no content) ")).toBe("empty");
    // NOT whitespace: `ERe`'s guard is `!yf.text`, which a `"   "` passes — it falls all the way through to
    // the banded echo. `userEchoLines` is where that ends up painting a blank band, exactly as upstream does.
    expect(classifyUserText("   ")).toBe("prompt");
  });
  it("exit 5: a `<tick>` heartbeat prompt", () => expect(classifyUserText("<tick>wake</tick>")).toBe("tick"));
  it("exit 6: `<local-command-caveat>`", () => expect(classifyUserText("<local-command-caveat>Caveat: …</local-command-caveat>")).toBe("caveat"));
  it("exit 7: bash stdout/stderr, which must OPEN the message (startsWith, not includes)", () => {
    expect(classifyUserText("<bash-stdout>ok</bash-stdout>")).toBe("bash-output");
    expect(classifyUserText("<bash-stderr>bad</bash-stderr>")).toBe("bash-output");
    expect(classifyUserText("prose <bash-stdout>ok</bash-stdout>")).toBe("prompt");     // the asymmetry, pinned
  });
  it("exit 8: local-command stdout/stderr, also startsWith", () => {
    expect(classifyUserText("<local-command-stdout>ok</local-command-stdout>")).toBe("command-output");
    expect(classifyUserText("<local-command-stderr>bad</local-command-stderr>")).toBe("command-output");
    expect(classifyUserText("prose <local-command-stdout>ok</local-command-stdout>")).toBe("prompt");
  });
  it("exit 9: the two interrupt sentinels are EXACT-equality (L426473), not a substring", () => {
    expect(classifyUserText(INTERRUPT_PLAIN)).toBe("interrupt-plain");
    expect(classifyUserText(INTERRUPT_TOOL)).toBe("interrupt-tool");
    expect(classifyUserText(`${INTERRUPT_PLAIN} and then some`)).toBe("prompt");
  });
  it("exits 10–15: bash-input, command echo, memory, task notification, mcp update, fork boilerplate — all `includes`", () => {
    expect(classifyUserText("please <bash-input>ls</bash-input>")).toBe("bash-input");
    expect(classifyUserText("<command-name>/compact</command-name><command-message>compact</command-message>")).toBe("command-echo");
    expect(classifyUserText("<user-memory-input>prefer tabs</user-memory-input>")).toBe("memory-input");
    expect(classifyUserText('<task-notification><summary>done</summary></task-notification>')).toBe("task-notification");
    expect(classifyUserText('<mcp-resource-update server="s" uri="file:///a.txt"></mcp-resource-update>')).toBe("mcp-update");
    expect(classifyUserText('<mcp-polling-update type="t" server="s" tool="x"></mcp-polling-update>')).toBe("mcp-update");
    expect(classifyUserText("<fork-boilerplate>rules</fork-boilerplate>\nYour directive: go")).toBe("fork-boilerplate");
  });
  it("falls through to the ordinary prompt echo", () => expect(classifyUserText("fix the parser")).toBe("prompt"));
  it("honours EVALUATION ORDER: an earlier exit wins over a later one in the same text", () => {
    // caveat (6) precedes command-echo (11): a caveat row that also carries a command tag is still invisible.
    expect(classifyUserText("<local-command-caveat>c</local-command-caveat><command-message>x</command-message>")).toBe("caveat");
    // bash-output (7) precedes bash-input (10) when the text OPENS with the output tag.
    expect(classifyUserText("<bash-stdout>o</bash-stdout><bash-input>ls</bash-input>")).toBe("bash-output");
    // command-echo (11) precedes task-notification (13).
    expect(classifyUserText("<command-message>x</command-message><task-notification><summary>s</summary></task-notification>")).toBe("command-echo");
  });
});

describe("speciesLines — the invisible routes", () => {
  it("renders NOTHING for empty, tick, caveat, and the TOOL-form interrupt (F3 keeps that one on the tool row)", () => {
    expect(speciesLines("empty", "(no content)")).toBeNull();
    expect(speciesLines("tick", "<tick>wake</tick>")).toBeNull();
    expect(speciesLines("caveat", "<local-command-caveat>c</local-command-caveat>")).toBeNull();
    expect(speciesLines("interrupt-tool", INTERRUPT_TOOL)).toBeNull();
  });
});

describe("speciesLines — the plain interrupt, the NEW surface (F3 gap)", () => {
  it("gives the plain sentinel its own dim `⎿` row so an interrupt with no tool in flight is not silent", () => {
    const lines = speciesLines("interrupt-plain", INTERRUPT_PLAIN)!;
    expect(lines).toEqual([{ text: INTERRUPTED_TEXT, dim: true, gutter: { text: TOOL_RESULT_GUTTER, dim: true } }]);
    expect(INTERRUPTED_TEXT).toBe("Interrupted · What should Claude do instead?");
  });
});

describe("speciesLines — the banded species", () => {
  it("command echo: the ONE prompt band, `❯ /name args` (upstream `fqo` L425646 shares `Mqo`'s band)", () => {
    const lines = speciesLines("command-echo", "<command-name>/compact</command-name><command-message>compact</command-message><command-args>--force</command-args>", { width: 40 })!;
    expect(textOf(lines)).toContain("❯ /compact --force");
    expect(lines[0]!.bg).toBe(tok("userMessageBackground"));
  });
  it("command echo: `skill-format` swaps the slash form for `Skill(name)`", () => {
    expect(textOf(speciesLines("command-echo", "<command-message>brainstorming</command-message><skill-format>true</skill-format>", { width: 40 })!)).toContain("❯ Skill(brainstorming)");
  });
  it("command echo: falls back to `<command-name>` when the row carries no `<command-message>` (our disk wire)", () => {
    expect(textOf(speciesLines("command-echo", "<command-name>/help</command-name>", { width: 40 })!)).toContain("❯ /help");
  });
  it("command echo: nothing extractable renders nothing", () => expect(speciesLines("command-echo", "<command-message></command-message>")).toBeNull());
  it("bash input: `! ` in bashBorder over the bash band (upstream `T3t` L416902)", () => {
    const lines = speciesLines("bash-input", "<bash-input>ls -la</bash-input>", { width: 30 })!;
    expect(textOf(lines)).toContain("! ls -la");
    expect(lines[0]!.bg).toBe(tok("bashMessageBackgroundColor"));
    expect(lines[0]!.segments![0]).toMatchObject({ text: "! ", color: tok("bashBorder") });
  });
  it("bash input: an empty command renders nothing", () => expect(speciesLines("bash-input", "<bash-input></bash-input>")).toBeNull());
  it("fork boilerplate: the boilerplate block and the `Your directive: ` prefix are both stripped (upstream `IWp` L426355)", () => {
    const lines = speciesLines("fork-boilerplate", "<fork-boilerplate>You are a worker fork.</fork-boilerplate>\n\nYour directive: land task 10a", { width: 40 })!;
    expect(textOf(lines)).toContain("⑂");            // `UO` (L41482) U+2442 OCR FORK, not the branch glyph
    expect(textOf(lines)).toContain("land task 10a");
    expect(textOf(lines)).not.toContain("worker fork");
    expect(textOf(lines)).not.toContain("Your directive:");
    expect(lines[0]!.bg).toBe(tok("userMessageBackground"));
  });
  it("memory input: `#` in `remember` over the memory band, then the dim acknowledgement row (upstream `Aqo` L425934)", () => {
    const lines = speciesLines("memory-input", "<user-memory-input>prefer tabs</user-memory-input>", { width: 40 })!;
    expect(lines[0]!.segments![0]).toMatchObject({ text: "#", color: tok("remember"), bg: tok("memoryBackgroundColor") });
    expect(lines[0]!.text).toBe("# prefer tabs ");
    expect(lines[1]).toEqual({ text: "Got it.", dim: true, gutter: { text: TOOL_RESULT_GUTTER, dim: true } });
  });
  it("memory input: no inner text renders nothing", () => expect(speciesLines("memory-input", "<user-memory-input></user-memory-input>")).toBeNull());
});

describe("speciesLines — the output species", () => {
  it("bash output: stdout plain, stderr in `error`, both under the `⎿` gutter, HTML entities decoded (upstream `RIe`)", () => {
    const lines = speciesLines("bash-output", "<bash-stdout>a &lt;b&gt; c</bash-stdout><bash-stderr>boom</bash-stderr>", { width: 60 })!;
    expect(lines[0]).toMatchObject({ text: "a <b> c", gutter: { text: TOOL_RESULT_GUTTER, dim: true } });
    expect(lines.find((l) => l.text === "boom")!.color).toBe(tok("error"));
  });
  it("bash output: `<persisted-output>` wins over the raw stdout body (L425617)", () => {
    expect(textOf(speciesLines("bash-output", "<bash-stdout><persisted-output>saved</persisted-output>raw</bash-stdout>", { width: 60 })!)).toContain("saved");
  });
  it("bash output: silence says so (`(No output)`, L423490)", () => {
    expect(speciesLines("bash-output", "<bash-stdout></bash-stdout>", { width: 60 })!).toEqual([{ text: "(No output)", dim: true, gutter: { text: TOOL_RESULT_GUTTER, dim: true } }]);
  });
  it("command output: stdout and stderr under the `  ⎿  ` gutter `Sqo`/`oEn` use (L425796)", () => {
    const lines = speciesLines("command-output", "<local-command-stdout>Compacted</local-command-stdout><local-command-stderr>nope</local-command-stderr>", { width: 60 })!;
    expect(lines[0]).toMatchObject({ text: "Compacted", gutter: { text: LOCAL_OUTPUT_GUTTER, dim: true } });
    expect(lines.find((l) => l.text === "nope")!.color).toBe(tok("error"));
    expect(LOCAL_OUTPUT_GUTTER).not.toBe(TOOL_RESULT_GUTTER);                  // `oEn` uses two plain spaces, `Cr` a NBSP
  });
  it("command output: an empty body — or the `(no content)` placeholder — renders nothing (L425763)", () => {
    expect(speciesLines("command-output", "<local-command-stdout></local-command-stdout>")).toBeNull();
    expect(speciesLines("command-output", "<local-command-stdout>(no content)</local-command-stdout>")).toBeNull();
  });
});

describe("speciesLines — task notification and mcp update", () => {
  it("task notification: `● summary · duration`, glyph coloured by status (upstream `Rvr` L425557)", () => {
    const lines = speciesLines("task-notification", "<task-notification><status>completed</status><summary>3 background commands completed</summary><duration_ms>72000</duration_ms></task-notification>", { width: 80, platform: "darwin" })!;
    expect(lines[0]!.gutter).toEqual({ text: "⏺ ", color: tok("success") });
    expect(lines[0]!.text).toBe("3 background commands completed · 1m 12s");
    expect(lines[0]!.segments!.at(-1)).toMatchObject({ text: " · 1m 12s", dim: true });
  });
  it("task notification: status drives the colour, and a missing summary renders nothing", () => {
    expect(speciesLines("task-notification", "<task-notification><status>failed</status><summary>s</summary></task-notification>")!.at(0)!.gutter!.color).toBe(tok("error"));
    expect(speciesLines("task-notification", "<task-notification><status>killed</status><summary>s</summary></task-notification>")!.at(0)!.gutter!.color).toBe(tok("warning"));
    expect(speciesLines("task-notification", "<task-notification><summary>s</summary></task-notification>")!.at(0)!.gutter!.color).toBe(tok("text"));
    expect(speciesLines("task-notification", "<task-notification><status>completed</status></task-notification>")).toBeNull();
  });
  it("mcp update: `↻ server: target · reason` with a `success` glyph and a `suggestion` target (pack §9.3)", () => {
    const lines = speciesLines("mcp-update", '<mcp-resource-update server="fs" uri="file:///tmp/notes.md"><reason>changed</reason></mcp-resource-update>', { width: 80 })!;
    expect(lines[0]!.text).toBe("↻ fs: notes.md · changed");
    expect(lines[0]!.segments![0]).toMatchObject({ text: "↻", color: tok("success") });
    expect(lines[0]!.segments!.find((s) => s.text === "notes.md")!.color).toBe(tok("suggestion"));
    expect(lines[0]!.segments!.find((s) => s.text === "fs:")!.dim).toBe(true);
  });
  it("mcp update: the polling shape reads server+tool, and a reasonless update drops the ` · ` clause", () => {
    expect(speciesLines("mcp-update", '<mcp-polling-update type="t" server="gh" tool="issues"></mcp-polling-update>', { width: 80 })![0]!.text).toBe("↻ gh: issues");
  });
  it("mcp update: an unparseable body renders nothing (`Pqo` bails when `Dqo` finds none)", () => {
    expect(speciesLines("mcp-update", "<mcp-resource-update>malformed</mcp-resource-update>")).toBeNull();
  });
});

describe("the tag regexes are SHARED with sessions/rows.ts, never duplicated", () => {
  it("rows.ts classifies through the species constants", () => {
    expect(COMMAND_ECHO_RE.test("<command-name>/x</command-name>")).toBe(true);
    expect(COMMAND_OUTPUT_RE.test("<local-command-stdout>x</local-command-stdout>")).toBe(true);
    expect(CAVEAT_RE.test("<local-command-caveat>x</local-command-caveat>")).toBe(true);
    expect(COMPACT_SUMMARY_RE.test("This session is being continued from a previous conversation…")).toBe(true);
    // The behaviour rows.ts's own consumers depend on is unchanged by the extraction.
    const user = (text: string, uuid = "u") => ({ type: "user", uuid, message: { role: "user", content: text } });
    expect(rows.rowKind(user("<command-name>/compact</command-name>"))).toBe("command_echo");
    expect(rows.rowKind(user("<local-command-stdout>ok</local-command-stdout>"))).toBe("command_output");
    expect(rows.rowKind(user("<local-command-caveat>c</local-command-caveat>"))).toBe("caveat");
    expect(rows.rowKind(user("hi"))).toBe("prompt");
  });
});

describe("routing parity — the live path and the disk path use the ONE router", () => {
  it("renderMessage never band-wraps a sentinel: a caveat renders nothing and a plain interrupt gets its own row", () => {
    expect(renderMessage(userMsg("<local-command-caveat>Caveat: …</local-command-caveat>"), { width: 60 })).toEqual([]);
    expect(renderMessage(userMsg(INTERRUPT_PLAIN), { width: 60 })).toEqual([{ text: INTERRUPTED_TEXT, dim: true, gutter: { text: TOOL_RESULT_GUTTER, dim: true } }]);
    expect(textOf(renderMessage(userMsg("<bash-input>ls</bash-input>"), { width: 60 }))).toContain("! ls");
    expect(textOf(renderMessage(userMsg("<bash-input>ls</bash-input>"), { width: 60 }))).not.toContain("❯");
  });
  it("renderMessage still bands an ordinary prompt", () => expect(textOf(renderMessage(userMsg("fix the parser"), { width: 60 }))).toContain("❯ fix the parser"));
  it("renderMessage reads a STRING `message.content` too — the shape half our disk rows carry", () => {
    expect(textOf(renderMessage({ type: "user", message: { role: "user", content: "fix the parser" } }, { width: 60 }))).toContain("❯ fix the parser");
  });
  it("replayDocument routes a disk sentinel through the same species: command output becomes a real row, a caveat stays invisible", () => {
    const msgs = [
      { type: "user", uuid: "u1", message: { role: "user", content: "hi" } },
      { type: "user", uuid: "u2", message: { role: "user", content: "<local-command-stdout>Compacted 12 messages</local-command-stdout>" } },
      { type: "user", uuid: "u3", message: { role: "user", content: "<local-command-caveat>Caveat: the messages below were generated…</local-command-caveat>" } },
      { type: "user", uuid: "u4", message: { role: "user", content: INTERRUPT_PLAIN } },
    ];
    const text = JSON.stringify(projectCompact(replayDocument(msgs, {}), { cwd: "/work", home: "/home/me", platform: "darwin" as NodeJS.Platform, columns: 100, now: 0 }));
    expect(text).toContain("Compacted 12 messages");
    expect(text).not.toContain("local-command-stdout");     // the TAG never leaks, only its body
    expect(text).not.toContain("Caveat:");
    expect(text).toContain(INTERRUPTED_TEXT);
  });
});
