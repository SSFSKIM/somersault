// tui/test/session-picker.test.tsx — the /resume picker rebuilt on `Select` (F6 T11, DG49-DG51). The
// literals are transcriptions of 2.1.220's `moi` (L476394-476628); the bundle line sits on the assertion it
// produced. The two deliberate divergences — modeless search, and `hideIndexes` so digits reach the search
// field — are pinned here too, so a later "fix" back toward upstream's mode machine fails a test instead of
// passing silently.
//
// T-RESUME T2 (D-W9): the preview stage's OWN render tests (loading/failed/loaded-empty copy, footer chrome,
// the "no frame" shape) live in `resumeTranscriptView.test.tsx` — that component owns the preview body now.
// What stays HERE is everything that only makes sense with the whole picker mounted: the two triggers
// (Space/Ctrl+V) from list mode, the `y`/`n`/Enter/Esc confirm cycle, and the loaded-payload resume (both at
// this component's boundary and, further down, through the full `ChatApp`/`useChat` assembly).
import React from "react";
import { describe, it, expect } from "vitest";
import { renderWithKeymap as render, tick } from "./keysTestUtil.js";
import { SessionPicker } from "../../src/tui/SessionPicker.js";
import { ChatApp } from "../../src/tui/ChatApp.js";
import { fakeRemote } from "./helpers/fakeRemote.js";
import type { SessionInfo } from "../../src/tui/useChat.js";
import {
  filterSessions, isPreviewMessage, NARROWED_SCOPE, NO_CONVERSATIONS, NO_CONVERSATIONS_IN_PROJECT,
  noConversations, noSessionsMatch, PREVIEW_EMPTY, previewMessageCount, previewMeta, RENAME_FALLBACK,
  renamePlaceholder, RESUME_CANCELLED, resumeFooter, resumeHeader, resumeVisibleRows, sessionMeta,
  sessionTitle, transcriptItems, widenHints, type PreviewLoad,
} from "../../src/tui/sessionPickerModel.js";
import type { ResumeScope } from "../../src/tui/sessionPickerModel.js";
import type { RenderItem } from "../../src/tui/toolRenderer.js";

const frame = (f: () => string | undefined) => f() ?? "";
const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const flat = (s: string) => plain(s).replace(/\s*\n\s*/g, " ");
/** A projected window read back as plain text — a line is itself, a gutter block is its body. */
const text = (r: { items: readonly RenderItem[] }) =>
  r.items.map((i) => (i.kind === "line" ? i.line.text : i.body.map((b) => b.text).join("\n"))).join("\n");
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) { await tick(); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}

const NOW = 1_700_000_000_000;
const SESSIONS: SessionInfo[] = [
  { sessionId: "1111aaaa-0001", summary: "refactor the parser", lastModified: NOW },
  { sessionId: "2222bbbb-0002", summary: "write the release notes", lastModified: NOW - 3600_000 },
  { sessionId: "3333cccc-0003", summary: "fix the flaky test", lastModified: NOW - 86_400_000 },
];
/** The default loader: a `PreviewLoad` that loaded, empty — `loadMessages` speaks that tagged contract
 *  directly now (T-RESUME T2), not a bare row array. */
const loaded = (messages: unknown[] = []): Promise<PreviewLoad> => Promise.resolve({ state: "loaded", messages });

function mount(props: Partial<React.ComponentProps<typeof SessionPicker>> = {}) {
  const picked: string[] = [];
  const pickedMessages: (unknown[] | undefined)[] = [];
  const renamed: [string, string][] = [];
  let cancelled = false;
  const r = render(
    <SessionPicker
      sessions={props.sessions ?? SESSIONS}
      onPick={(s, messages) => { picked.push(s.sessionId); pickedMessages.push(messages); }}
      onCancel={() => { cancelled = true; }}
      loadMessages={props.loadMessages ?? (() => loaded())}
      renameSession={props.renameSession ?? (async (id, t) => { renamed.push([id, t]); })}
      {...(props.refreshing !== undefined ? { refreshing: props.refreshing } : {})}
      {...(props.fullscreen !== undefined ? { fullscreen: props.fullscreen } : {})}
      rows={40} columns={100}
    />,
  );
  return { ...r, picked, pickedMessages, renamed, wasCancelled: () => cancelled };
}

describe("sessionPickerModel — the pure half", () => {
  it("titles a row the way `mKt` does: custom title, then summary, then first prompt, then the short id", () => {
    expect(sessionTitle({ sessionId: "abcdef123456", summary: "s", customTitle: "c" })).toBe("c");
    expect(sessionTitle({ sessionId: "abcdef123456", summary: "s" })).toBe("s");
    expect(sessionTitle({ sessionId: "abcdef123456", firstPrompt: "first line\nsecond" })).toBe("first line");
    expect(sessionTitle({ sessionId: "abcdef123456" })).toBe("abcdef12");
    // `mKt`'s `t` parameter sits AHEAD of the id — that is what makes the rename placeholder a sentence.
    expect(sessionTitle({ sessionId: "abcdef123456" }, RENAME_FALLBACK)).toBe(RENAME_FALLBACK);
    expect(renamePlaceholder({ sessionId: "abcdef123456", summary: "keep me" })).toBe("keep me");
  });

  it("filters case-insensitively over the title AND the id (`Qe` L476454-462, reachable subset)", () => {
    expect(filterSessions(SESSIONS, "PARSER").map((s) => s.sessionId)).toEqual(["1111aaaa-0001"]);
    expect(filterSessions(SESSIONS, "3333").map((s) => s.sessionId)).toEqual(["3333cccc-0003"]);
    expect(filterSessions(SESSIONS, "   ").length).toBe(3);                 // a blank query filters nothing
    expect(filterSessions(SESSIONS, "nothing here")).toEqual([]);
  });

  it("prints the `(n of m)` clause only when the list is longer than its window (L476609)", () => {
    expect(resumeHeader(3, 47, true)).toBe("Resume session (3 of 47)");
    expect(resumeHeader(1, 3, false)).toBe("Resume session");
    expect(resumeVisibleRows(40)).toBe(15);
    expect(resumeVisibleRows(4)).toBe(1);                                   // never zero
  });

  it("projects the meta line from what our store actually has (`Nqr` subset)", () => {
    expect(sessionMeta({ sessionId: "x", lastModified: NOW - 3600_000, gitBranch: "main" }, new Date(NOW))).toBe("1h ago · main");
    expect(sessionMeta({ sessionId: "x" })).toBe("");
    expect(previewMeta({ sessionId: "x", lastModified: NOW }, 1, new Date(NOW))).toBe("0s ago · 1 message");
  });

  // WAVE 2 T8's pane-projection test RETIRED at T-RESUME T2: the in-frame pane it pinned (`previewItems`/
  // `previewTail`/`previewWidth`) is gone — the picker's preview stage is `ResumeTranscriptView` now, and
  // `transcriptItems` (T1, sessionPickerModel.test.ts) is the equivalent coverage for its projection, tail
  // anchoring and painted-row budget. What THIS file still owns is the picker's OWN behaviour around it —
  // the two triggers, the confirm/cancel keys and the loaded-payload resume — further down.
});

// ── Wave S Task 10 ─────────────────────────────────────────────────────────────────────────────────
const userPrompt = (text: string) => ({ type: "user", message: { content: text } });
const assistantText = (text: string) => ({ type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text }] } });
const toolResultOnly = () => ({ type: "user", message: { content: [{ type: "tool_result", content: "x" }] } });
const toolUseOnly = () => ({ type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "tool_use", id: "t", name: "Read", input: {} }] } });
// THE TWO SHAPES THE OLD AND NEW PREDICATES DISAGREE ON (t10 review, finding 2). Without these in the fixture
// the "same predicate" pin is decorative: every other row shape is classified identically by the pane's old
// private text-emptiness test and by upstream's `$$_`/`B$_`, so reverting `previewLines` stayed green.
//  · an image-only user turn — upstream COUNTS it, the old pane dropped it (no text to print);
//  · a meta user turn carrying text — upstream EXCLUDES it, the old pane drew it. Probe 107 has since shown
//    the reader never delivers this shape at all (the row is dropped and the flag stripped), so it survives
//    here as a row shape the fixture mixes in, not as a classification the two predicates differ on.
const imageOnly = () => ({ type: "user", message: { content: [{ type: "image", source: { type: "base64", data: "x" } }] } });
const metaText = () => ({ type: "user", isMeta: true, message: { content: "<system-reminder>caveat</system-reminder>" } });
// Eight-row cycle, and deliberately NOT symmetric between the two predicates: two image rows against one meta
// row, so a revert shifts the pane's row count instead of trading one drop for one addition.
const manyMixedRows = (n: number) =>
  Array.from({ length: n }, (_, i) => [userPrompt(`ask ${i}`), toolResultOnly(), assistantText(`say ${i}`), toolUseOnly(),
                                       { type: "system", subtype: "init" }, imageOnly(), metaText(), imageOnly()][i % 8]!);

describe("sessionPickerModel — the resume outcome line and the widen controls (Wave S T10)", () => {
  it("prints upstream's cancel copy, exactly (A11, L476806)", () => {
    expect(RESUME_CANCELLED).toBe("Resume cancelled");
  });

  it("labels each widen control with the state it would move TO (A12, L476627)", () => {
    expect(widenHints({ allProjects: false, allWorktrees: false }, true)).toEqual([
      { chord: "Ctrl+A", action: "show all projects" },
      { chord: "Ctrl+W", action: "show all worktrees" },
    ]);
    expect(widenHints({ allProjects: true, allWorktrees: false }, true)[0])
      .toEqual({ chord: "Ctrl+A", action: "only show current repo" });
    expect(widenHints({ allProjects: false, allWorktrees: true }, true)[1])
      .toEqual({ chord: "Ctrl+W", action: "only show current worktree" });
  });

  it("qualifies the empty state by scope, dropping the qualifier once the list is all-projects (L476609)", () => {
    expect(noConversations(NARROWED_SCOPE)).toBe(NO_CONVERSATIONS_IN_PROJECT);
    expect(NO_CONVERSATIONS_IN_PROJECT).toBe("No conversations found in this project.");
    expect(noConversations({ allProjects: true, allWorktrees: false })).toBe(NO_CONVERSATIONS);
    expect(NO_CONVERSATIONS).toBe("No conversations found.");
    // the worktree axis says nothing about which PROJECTS were searched, so it must not move this copy
    expect(noConversations({ allProjects: false, allWorktrees: true })).toBe(NO_CONVERSATIONS_IN_PROJECT);
  });

  it("hides Ctrl+W when no worktree is detected (upstream's `R` gate)", () => {
    expect(widenHints(NARROWED_SCOPE, false).map((h) => h.chord)).toEqual(["Ctrl+A"]);
    expect(NARROWED_SCOPE).toEqual({ allProjects: false, allWorktrees: false });   // upstream STARTS narrowed
  });

  it("puts the widen clauses ahead of the rest of the footer, in upstream's order", () => {
    expect(resumeFooter(NARROWED_SCOPE, true))
      .toBe("Ctrl+A to show all projects · Ctrl+W to show all worktrees · space to preview · Ctrl+R to rename · Type to search · esc to cancel");
    expect(resumeFooter(NARROWED_SCOPE, false)).not.toContain("Ctrl+W");
  });

  it("counts only the rows the preview pane actually renders (qa4-07 ii, `Pqs` L369043)", () => {
    const rows = [userPrompt("hi"), assistantText("hello"), toolResultOnly(), userPrompt("again")];
    expect(previewMessageCount(rows)).toBe(3);              // the tool-result-only row is not a message
    // `$$_`/`B$_` (L369021/L369035) in full: blank text, tool-use-only and thinking-only assistant turns,
    // and every attachment/system/progress entry are all out.
    // UPSTREAM'S `isMeta` CLAUSE IS NOT PORTED, and this pins the reason rather than the omission. Probe 107
    // measured the only reader feeding this predicate: `getSessionMessages` drops meta rows and strips every
    // field outside its fixed projection, so no row reaching here can carry the flag — the test that used to
    // exclude one could never fire. A row that somehow does carry it is classified on its CONTENT like any
    // other, which is what this line says out loud.
    expect(isPreviewMessage({ type: "user", isMeta: true, message: { content: "caveat" } })).toBe(true);
    expect(isPreviewMessage({ type: "user", message: { content: "   " } })).toBe(false);
    expect(isPreviewMessage({ type: "user", message: { content: [{ type: "image" }] } })).toBe(true);
    expect(isPreviewMessage(toolUseOnly())).toBe(false);
    expect(isPreviewMessage({ type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "thinking", thinking: "hm" }] } })).toBe(false);
    expect(isPreviewMessage({ type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "  " }] } })).toBe(false);
    expect(isPreviewMessage({ type: "system", subtype: "init" })).toBe(false);
    expect(isPreviewMessage({ type: "progress" })).toBe(false);
  });

  // bl7 T-ADVISOR Task 4 (spec §3.5, A7): an advisor-only assistant message — Task 2's render arms give it a
  // real row of its own (the result sentence), so it counts toward the "N messages" footer exactly as an
  // ordinary text turn would; an assistant message whose ONLY block is `tool_use`/`tool_result` already
  // does NOT count (line 176 above), and an advisor block is neither of those.
  it("counts an advisor-only assistant message (advisor_tool_result), matching a real render arm", () => {
    const advisorOnly = { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "advisor_tool_result", tool_use_id: "srv1", content: { type: "advisor_result", text: "ok", stop_reason: "end_turn" } }] } };
    expect(isPreviewMessage(advisorOnly)).toBe(true);
  });

  // WAVE 2 T8, RE-TARGETED at T-RESUME T2 onto `transcriptItems` (the picker's ONLY projection now — the
  // in-frame pane and its `previewItems`/`PREVIEW_MESSAGE_WINDOW` windowing are gone). What survives — and is
  // the half that ever mattered (qa4-07 ii) — is that `isPreviewMessage` is the ONLY thing deciding the
  // `N messages` number, and that nothing it counted goes missing from the view. The view is a SUPERSET: it
  // also draws the tool traffic the count excludes, which is exactly upstream's arrangement (it renders the
  // whole transcript and counts through `Pqs`).
  it("count and view agree on the messages, with the view drawing the tool traffic the count excludes", () => {
    // The COUNT is still `isPreviewMessage` and nothing else — the image row in, and (since probe 107 retired
    // the unreachable `isMeta` test) the meta row counted on its content like any other user turn.
    const disagree = [userPrompt("plain ask"), imageOnly(), metaText(), assistantText("reply")];
    expect(previewMessageCount(disagree)).toBe(4);
    expect(previewMessageCount(disagree)).toBe(disagree.filter(isPreviewMessage).length);
    const drawn = text(transcriptItems(disagree, { width: 60, budget: 200 }));
    expect(drawn).toContain("plain ask");
    expect(drawn).toContain("reply");
    // The view is a SUPERSET of the count: a tool turn contributes nothing to `N messages` and still draws
    // (detail-all, forced — a resumed tool call's own header renders, unlike the old compact fold).
    const tools = [userPrompt("go"),
      { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "tool_use", id: "t9", name: "Read", input: { file_path: "/tmp/a.ts" } }] } },
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t9", content: "x" }] } }];
    expect(previewMessageCount(tools)).toBe(1);
    expect(text(transcriptItems(tools, { width: 60, budget: 200 }))).toContain("Read");
    // And the view stays inside a caller-supplied budget however long the transcript is (T1's own coverage
    // of the exact painted-row arithmetic; this is the count/view-agreement half only).
    const rows = manyMixedRows(40);
    expect(previewMessageCount(rows)).toBe(rows.filter(isPreviewMessage).length);
    expect(previewMessageCount(rows)).toBeGreaterThan(5);
    const window = transcriptItems(rows, { width: 60, budget: 5 });
    expect(window.items.length).toBeGreaterThan(0);
  });
});

describe("SessionPicker — the list stage (L476609)", () => {
  it("renders the header, the search bar and one row per session with its meta line", async () => {
    const r = mount();
    await waitFor(() => frame(r.lastFrame).includes("refactor the parser"));
    const f = flat(frame(r.lastFrame));
    expect(f).toContain("Resume session");
    expect(f).toContain("⌕");                                               // `AL`'s prefix (L41482)
    expect(f).toContain("Search…");
    for (const s of SESSIONS) expect(f).toContain(s.summary);
    expect(f).toContain("space to preview");
    expect(f).toContain("Ctrl+R to rename");
    expect(f).toContain("Type to search");
    expect(f).toContain("esc to cancel");
  });

  it("adds the dim `· Refreshing…` clause while a reload is in flight", async () => {
    const r = mount({ refreshing: true });
    await waitFor(() => frame(r.lastFrame).includes("Resume session"));
    expect(flat(frame(r.lastFrame))).toContain("Resume session · Refreshing…");
  });

  it("moves with the Select's own keys and picks the row Enter lands on", async () => {
    const r = mount();
    await waitFor(() => frame(r.lastFrame).includes("refactor the parser"));
    r.stdin.write("j");
    await waitFor(() => plain(frame(r.lastFrame)).includes("❯ write the release notes"));
    r.stdin.write("\r");
    await waitFor(() => r.picked.length > 0);
    expect(r.picked).toEqual(["2222bbbb-0002"]);
  });

  it("types into the SEARCH field instead of navigating — printables reach the picker's fallback", async () => {
    const r = mount();
    await waitFor(() => frame(r.lastFrame).includes("refactor the parser"));
    for (const c of "rele") r.stdin.write(c);
    await waitFor(() => !plain(frame(r.lastFrame)).includes("refactor the parser"));
    const f = flat(frame(r.lastFrame));
    expect(f).toContain("⌕ rele");
    expect(f).toContain("write the release notes");
    expect(f).not.toContain("fix the flaky test");
    r.stdin.write("\x7f");                                                  // backspace walks the query back
    await waitFor(() => flat(frame(r.lastFrame)).includes("⌕ rel"));
    expect(flat(frame(r.lastFrame))).toContain("write the release notes");
  });

  it("DIGITS search too — `hideIndexes` is on, so the Select's digit shortcut cannot steal them", async () => {
    const r = mount();
    await waitFor(() => frame(r.lastFrame).includes("refactor the parser"));
    r.stdin.write("2");
    await waitFor(() => flat(frame(r.lastFrame)).includes("⌕ 2"));
    expect(r.picked).toEqual([]);                                           // a digit picked NOTHING
    expect(flat(frame(r.lastFrame))).toContain("write the release notes");  // it filtered by id instead
    expect(plain(frame(r.lastFrame))).not.toContain("1. refactor");         // and there is no index column
  });

  it("says so when the filter matches nothing, naming the query (L476609)", async () => {
    const r = mount();
    await waitFor(() => frame(r.lastFrame).includes("refactor the parser"));
    for (const c of "zzz") r.stdin.write(c);
    await waitFor(() => flat(frame(r.lastFrame)).includes(noSessionsMatch("zzz")));
    expect(noSessionsMatch("zzz")).toBe('No sessions match "zzz".');
  });

  // The wording is SCOPE-AWARE (t10 review, note 6): narrowed — which is how the picker opens — says "in this
  // project", because that is the only reason the list could be empty while sessions exist elsewhere.
  it("says `No conversations found in this project.` when the store is empty, and Esc still closes", async () => {
    const r = mount({ sessions: [] });
    await waitFor(() => frame(r.lastFrame).includes(NO_CONVERSATIONS_IN_PROJECT));
    r.stdin.write("\x1b");
    await waitFor(() => r.wasCancelled());
  });

  it("Esc CLEARS a live filter first and only closes on the second press", async () => {
    const r = mount();
    await waitFor(() => frame(r.lastFrame).includes("refactor the parser"));
    r.stdin.write("f");
    await waitFor(() => flat(frame(r.lastFrame)).includes("⌕ f"));
    r.stdin.write("\x1b");
    await waitFor(() => flat(frame(r.lastFrame)).includes("Search…"));
    expect(r.wasCancelled()).toBe(false);
    r.stdin.write("\x1b");
    await waitFor(() => r.wasCancelled());
  });
});

describe("SessionPicker — Space/Ctrl+V open the full-screen view (T-RESUME T2, canon L584023/L584057-584059)", () => {
  it("loads the highlighted session, shows the full-screen view (no header/title), and Enter resumes WITH the loaded messages (canon G8)", async () => {
    const calls: string[] = [];
    const msgs = [
      { type: "user", message: { content: "what does this do?" } },
      { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "it resumes" }] } },
    ];
    const r = mount({ loadMessages: async (id) => { calls.push(id); return { state: "loaded", messages: msgs }; } });
    await waitFor(() => frame(r.lastFrame).includes("refactor the parser"));
    r.stdin.write(" ");
    await waitFor(() => flat(frame(r.lastFrame)).includes("it resumes"));
    expect(calls).toEqual(["1111aaaa-0001"]);
    const f = flat(frame(r.lastFrame));
    expect(f).toContain("what does this do?");
    expect(f).toContain("2 messages");
    expect(f).toContain("enter to resume");
    expect(f).not.toContain("write the release notes");                     // the view REPLACES the list
    expect(f).not.toContain("Resume session");                              // …and its title too — canon has no header (L583628)
    r.stdin.write("\r");
    await waitFor(() => r.picked.length > 0);
    expect(r.picked).toEqual(["1111aaaa-0001"]);
    expect(r.pickedMessages[0]).toBe(msgs);                                 // IDENTITY — the loaded array, not a re-read
  });

  it("Ctrl+V ALSO opens the view, from list mode (canon G6, L584023)", async () => {
    const r = mount({ loadMessages: async () => ({ state: "loaded", messages: [{ type: "user", message: { content: "hi there" } }] }) });
    await waitFor(() => frame(r.lastFrame).includes("refactor the parser"));
    r.stdin.write("\x16");                                                  // ctrl+v
    await waitFor(() => flat(frame(r.lastFrame)).includes("enter to resume"));
    expect(flat(frame(r.lastFrame))).toContain("hi there");
  });

  it("y resumes with the loaded messages (identity-checked); n exits back to the intact list (canon G7)", async () => {
    const msgs = [{ type: "user", message: { content: "hi" } }];
    const r = mount({ loadMessages: async () => ({ state: "loaded", messages: msgs }) });
    await waitFor(() => frame(r.lastFrame).includes("refactor the parser"));
    r.stdin.write(" ");
    await waitFor(() => flat(frame(r.lastFrame)).includes("enter to resume"));
    r.stdin.write("y");
    await waitFor(() => r.picked.length > 0);
    expect(r.picked).toEqual(["1111aaaa-0001"]);
    expect(r.pickedMessages[0]).toBe(msgs);
  });

  it("n exits back to the intact list without resuming (canon G7)", async () => {
    const r = mount({ loadMessages: async () => ({ state: "loaded", messages: [{ type: "user", message: { content: "hi" } }] }) });
    await waitFor(() => frame(r.lastFrame).includes("refactor the parser"));
    r.stdin.write(" ");
    await waitFor(() => flat(frame(r.lastFrame)).includes("enter to resume"));
    r.stdin.write("n");
    await waitFor(() => flat(frame(r.lastFrame)).includes("space to preview"));
    expect(r.picked).toEqual([]);
    expect(r.wasCancelled()).toBe(false);
  });

  // The cost of a MODELESS search (upstream's is a mode that disables the list): space cannot be both the
  // preview key and a word separator, so it is the preview key only from an EMPTY query — the state the
  // footer advertises it in — and types once a query exists. Both arms pinned; recorded divergence (T15).
  it("space TYPES into a live query instead of opening the view, so a multi-word search is reachable", async () => {
    let loads = 0;
    const r = mount({ loadMessages: async () => { loads++; return { state: "loaded", messages: [] }; } });
    await waitFor(() => frame(r.lastFrame).includes("refactor the parser"));
    for (const c of "the") r.stdin.write(c);
    await waitFor(() => flat(frame(r.lastFrame)).includes("⌕ the"));
    r.stdin.write(" "); r.stdin.write("p");
    await waitFor(() => flat(frame(r.lastFrame)).includes("⌕ the p"));
    expect(loads).toBe(0);                                                  // no view was opened
    expect(flat(frame(r.lastFrame))).toContain("refactor the parser");      // "the p" still matches it
    expect(flat(frame(r.lastFrame))).not.toContain("fix the flaky test");
  });

  // REGRESSION (codex review, F6 close). A query and its Return can land in ONE stdin chunk, and the accept
  // path read `filtered` from a render closure — so Return resumed whatever the PRE-query list had under the
  // cursor. Both the query and the row the accept resolves against are ref-backed now.
  it("resumes against the POST-keystroke filter when query and Return share a chunk", async () => {
    const r = mount();
    await waitFor(() => frame(r.lastFrame).includes("refactor the parser"));
    r.stdin.write("flaky\r");                                               // query AND the accept together
    await waitFor(() => r.picked.length > 0);
    expect(r.picked).toEqual(["3333cccc-0003"]);                            // NOT the first row of the old list
  });

  it("Esc leaves the view for the list without resuming anything", async () => {
    const r = mount({ loadMessages: async () => ({ state: "loaded", messages: [{ type: "user", message: { content: "hi" } }] }) });
    await waitFor(() => frame(r.lastFrame).includes("refactor the parser"));
    r.stdin.write(" ");
    await waitFor(() => flat(frame(r.lastFrame)).includes("enter to resume"));
    r.stdin.write("\x1b");
    await waitFor(() => flat(frame(r.lastFrame)).includes("space to preview"));
    expect(r.picked).toEqual([]);
    expect(r.wasCancelled()).toBe(false);                                   // …and did NOT close the picker
  });

  it("shows the bare loading state until the read settles, then the full footer (canon L583604-583606)", async () => {
    let resolveLoad!: (load: PreviewLoad) => void;
    const r = mount({ loadMessages: async () => new Promise<PreviewLoad>((res) => { resolveLoad = res; }) });
    await waitFor(() => frame(r.lastFrame).includes("refactor the parser"));
    r.stdin.write(" ");
    await waitFor(() => flat(frame(r.lastFrame)).includes("Loading session"));
    const loading = flat(frame(r.lastFrame));
    expect(loading).toContain("esc to cancel");
    expect(loading).not.toContain("enter to resume");                      // no footer chrome while loading
    resolveLoad({ state: "loaded", messages: [{ type: "user", message: { content: "hi" } }] });
    await waitFor(() => flat(frame(r.lastFrame)).includes("enter to resume"));
  });

  it("a rejecting loader lands on the failure copy, not a crash (defensive catch)", async () => {
    const r = mount({ loadMessages: async () => { throw new Error("gone"); } });
    await waitFor(() => frame(r.lastFrame).includes("refactor the parser"));
    r.stdin.write(" ");
    await waitFor(() => flat(frame(r.lastFrame)).includes(PREVIEW_EMPTY));
  });

  it("a load that resolves `failed` shows the same failure copy (the normal production path)", async () => {
    const r = mount({ loadMessages: async () => ({ state: "failed", error: "ENOENT" }) });
    await waitFor(() => frame(r.lastFrame).includes("refactor the parser"));
    r.stdin.write(" ");
    await waitFor(() => flat(frame(r.lastFrame)).includes(PREVIEW_EMPTY));
  });

  it("has no `more above` indicator in this view — canon has none here (spec non-goal)", async () => {
    const long = Array.from({ length: 30 }, (_, i) => ({ type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: `reply number ${i}` }] } }));
    const r = mount({ loadMessages: async () => ({ state: "loaded", messages: long }) });
    await waitFor(() => frame(r.lastFrame).includes("refactor the parser"));
    r.stdin.write(" ");
    await waitFor(() => flat(frame(r.lastFrame)).includes("reply number 29"));
    const f = flat(frame(r.lastFrame));
    expect(f).toContain("reply number 0");                                 // well under the 200-item cap — nothing was cut
    expect(f).not.toMatch(/more above/i);
  });

  // ── WAVE 2 T8 (s2qa4-13/14), RE-TARGETED at T-RESUME T2's detail-all takeover ────────────────────────
  // The view draws `projectDetail(replayDocument(…), {projection:"detail-all"})` now — the SAME primitive
  // family the live transcript and `/resume`'s own replay use, forced verbose (canon L563347/L563371), so
  // every species router, fold and gutter arrives with it, EXPANDED rather than folded.
  const ENVELOPE = [
    { type: "user", uuid: "u1", message: { content: "what does this do?" } },
    { type: "user", uuid: "u2", message: { content: "<command-name>/cost</command-name>\n<command-message>cost</command-message>\n<command-args></command-args>" } },
    { type: "user", uuid: "u3", message: { content: "<local-command-stdout>Total cost: $0.42</local-command-stdout>" } },
    { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "/tmp/notes.ts" } }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "alpha\nbeta" }] } },
    { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "it resumes" }] } },
  ];

  it("renders the slash-command pair through the species router — no envelope tag reaches the view", async () => {
    const r = mount({ loadMessages: async () => ({ state: "loaded", messages: ENVELOPE }) });
    await waitFor(() => frame(r.lastFrame).includes("refactor the parser"));
    r.stdin.write(" ");
    await waitFor(() => flat(frame(r.lastFrame)).includes("it resumes"));
    const f = flat(frame(r.lastFrame));
    expect(f).not.toMatch(/<\/?command-(name|message|args)>|<\/?local-command-stdout>/);
    expect(f).toContain("❯ /cost");                                       // the echo, as the transcript draws it
    expect(f).toContain("Total cost: $0.42");                             // its stdout, in the `⎿` gutter
    expect(f).toContain("⎿");
  });

  it("draws the tool turn EXPANDED — detail-all forced (canon L563347/L563371), not the collapsed fold", async () => {
    const r = mount({ loadMessages: async () => ({ state: "loaded", messages: ENVELOPE }) });
    await waitFor(() => frame(r.lastFrame).includes("refactor the parser"));
    r.stdin.write(" ");
    await waitFor(() => flat(frame(r.lastFrame)).includes("it resumes"));
    const f = flat(frame(r.lastFrame));
    expect(f).toContain("Read(");                                         // the call header — detail-all shows it, compact never did
    expect(f).toContain("notes.ts");
    expect(f).not.toContain("Read 1 file");                                // the OLD compact fold's summary line — gone
    expect(f).not.toContain("file_path");
    expect(f).not.toContain("tool_use");
    expect(f).not.toContain("ctrl+o");                                    // nothing here is foldable — no expand hint
    expect(f).toContain("4 messages");                                    // …and the count is untouched by any of it (a slash command is 2)
  });
});

describe("SessionPicker — Ctrl-R renames (L476568/L476609)", () => {
  it("opens the rename field with the current title as its placeholder, saves on Enter, and shows the new title", async () => {
    const r = mount();
    await waitFor(() => frame(r.lastFrame).includes("refactor the parser"));
    r.stdin.write("\x12");                                                  // ctrl+r
    await waitFor(() => flat(frame(r.lastFrame)).includes("Rename session:"));
    const f = flat(frame(r.lastFrame));
    expect(f).toContain("refactor the parser");                             // the placeholder IS the title
    expect(f).toContain("enter to save");
    for (const c of "parser v2") r.stdin.write(c);                          // includes a SPACE, which must type
    await waitFor(() => flat(frame(r.lastFrame)).includes("parser v2"));
    r.stdin.write("\r");
    await waitFor(() => r.renamed.length > 0);
    expect(r.renamed).toEqual([["1111aaaa-0001", "parser v2"]]);
    await waitFor(() => flat(frame(r.lastFrame)).includes("space to preview"));
    expect(flat(frame(r.lastFrame))).toContain("parser v2");                // the row shows the new title
    expect(flat(frame(r.lastFrame))).not.toContain("refactor the parser");
  });

  // REGRESSION (codex review, F6 close). The rename text and its Return can land in ONE stdin chunk — a
  // paste, or fast typing over ssh — and `commitRename` read the buffer from its render closure, which would
  // commit the EMPTY pre-chunk buffer and silently drop the title. Ref-backed now (keys/refState.ts).
  it("commits the SAME-CHUNK rename text, not the buffer as it was before the chunk", async () => {
    const r = mount();
    await waitFor(() => frame(r.lastFrame).includes("refactor the parser"));
    r.stdin.write("\x12");
    await waitFor(() => flat(frame(r.lastFrame)).includes("Rename session:"));
    r.stdin.write("parser v2\r");                                           // text AND the save together
    await waitFor(() => r.renamed.length > 0);
    expect(r.renamed).toEqual([["1111aaaa-0001", "parser v2"]]);
  });

  it("Esc abandons the rename and writes nothing", async () => {
    const r = mount();
    await waitFor(() => frame(r.lastFrame).includes("refactor the parser"));
    r.stdin.write("\x12");
    await waitFor(() => flat(frame(r.lastFrame)).includes("Rename session:"));
    for (const c of "nope") r.stdin.write(c);
    await waitFor(() => flat(frame(r.lastFrame)).includes("nope"));
    r.stdin.write("\x1b");
    await waitFor(() => flat(frame(r.lastFrame)).includes("space to preview"));
    expect(r.renamed).toEqual([]);
    expect(flat(frame(r.lastFrame))).toContain("refactor the parser");
    expect(r.wasCancelled()).toBe(false);
  });

  it("an empty name is not a rename — Enter just returns to the list", async () => {
    const r = mount();
    await waitFor(() => frame(r.lastFrame).includes("refactor the parser"));
    r.stdin.write("\x12");
    await waitFor(() => flat(frame(r.lastFrame)).includes("Rename session:"));
    r.stdin.write("\r");
    await waitFor(() => flat(frame(r.lastFrame)).includes("space to preview"));
    expect(r.renamed).toEqual([]);
  });

  it("counts the previewed transcript with the view's predicate, not its raw row count (qa4-07 ii)", async () => {
    const r = mount({
      loadMessages: async () => ({ state: "loaded", messages: [
        { type: "user", message: { content: "what does this do?" } },
        { type: "user", message: { content: [{ type: "tool_result", content: "1000 lines" }] } },
        { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "tool_use", id: "t", name: "Read", input: {} }] } },
        { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "it resumes" }] } },
      ] }),
    });
    await waitFor(() => frame(r.lastFrame).includes("refactor the parser"));
    r.stdin.write(" ");
    await waitFor(() => flat(frame(r.lastFrame)).includes("it resumes"));
    expect(flat(frame(r.lastFrame))).toContain("2 messages");               // not "4 messages"
  });

  it("with no rename seam wired, Ctrl-R is inert rather than a dead-end stage", async () => {
    const picked: string[] = [];
    const r = render(<SessionPicker sessions={SESSIONS} onPick={(s) => picked.push(s.sessionId)} onCancel={() => {}} rows={40} columns={100} />);
    await waitFor(() => frame(r.lastFrame).includes("refactor the parser"));
    r.stdin.write("\x12"); r.stdin.write(" ");
    await tick();
    expect(flat(frame(r.lastFrame))).toContain("space to preview");         // still the list
  });
});

describe("SessionPicker — the widen controls (Wave S T10, A12)", () => {
  const OTHER: SessionInfo[] = [{ sessionId: "4444dddd-0004", summary: "a session from another repo", lastModified: NOW }];
  const WORKTREE: SessionInfo[] = [{ sessionId: "5555eeee-0005", summary: "a session from a linked worktree", lastModified: NOW }];

  function mountWiden(hasWorktree: boolean) {
    const calls: ResumeScope[] = [];
    const reload = async (scope: ResumeScope) => {
      calls.push(scope);
      return scope.allProjects ? [...SESSIONS, ...OTHER] : scope.allWorktrees ? [...SESSIONS, ...WORKTREE] : SESSIONS;
    };
    const r = render(
      <SessionPicker sessions={SESSIONS} onPick={() => {}} onCancel={() => {}} reload={reload} hasWorktree={hasWorktree}
                     rows={40} columns={100} />,
    );
    return { ...r, calls };
  }

  it("Ctrl+A widens to every project, re-queries WITHOUT the cwd filter, and flips its own label", async () => {
    const r = mountWiden(true);
    await waitFor(() => frame(r.lastFrame).includes("refactor the parser"));
    expect(flat(frame(r.lastFrame))).toContain("Ctrl+A to show all projects");
    r.stdin.write("\x01");                                                  // Ctrl+A
    await waitFor(() => flat(frame(r.lastFrame)).includes("a session from another repo"));
    expect(r.calls.at(-1)).toEqual({ allProjects: true, allWorktrees: false });
    expect(flat(frame(r.lastFrame))).toContain("Ctrl+A to only show current repo");
    r.stdin.write("\x01");                                                  // …and back
    await waitFor(() => !flat(frame(r.lastFrame)).includes("a session from another repo"));
    expect(r.calls.at(-1)).toEqual({ allProjects: false, allWorktrees: false });
    expect(flat(frame(r.lastFrame))).toContain("Ctrl+A to show all projects");
  });

  it("Ctrl+W widens to every worktree of this repo, and only when one was detected", async () => {
    const r = mountWiden(true);
    await waitFor(() => frame(r.lastFrame).includes("refactor the parser"));
    expect(flat(frame(r.lastFrame))).toContain("Ctrl+W to show all worktrees");
    r.stdin.write("\x17");                                                  // Ctrl+W
    await waitFor(() => flat(frame(r.lastFrame)).includes("a session from a linked worktree"));
    expect(r.calls.at(-1)).toEqual({ allProjects: false, allWorktrees: true });
    expect(flat(frame(r.lastFrame))).toContain("Ctrl+W to only show current worktree");
  });

  it("hides Ctrl+W — and leaves the chord inert — with no worktree detected", async () => {
    const r = mountWiden(false);
    await waitFor(() => frame(r.lastFrame).includes("refactor the parser"));
    expect(flat(frame(r.lastFrame))).not.toContain("Ctrl+W");
    r.stdin.write("\x17");
    await tick();
    expect(r.calls).toEqual([]);
    expect(flat(frame(r.lastFrame))).toContain("refactor the parser");      // and it did NOT type into the query
  });

  it("re-words the empty state when Ctrl+A widens past this project (t10 review, note 6)", async () => {
    const r = render(
      <SessionPicker sessions={[]} onPick={() => {}} onCancel={() => {}} reload={async () => []} rows={40} columns={100} />,
    );
    await waitFor(() => frame(r.lastFrame).includes(NO_CONVERSATIONS_IN_PROJECT));
    r.stdin.write("\x01");                                                  // Ctrl+A
    await waitFor(() => flat(frame(r.lastFrame)).includes(NO_CONVERSATIONS));
    expect(flat(frame(r.lastFrame))).not.toContain("in this project");      // nothing anywhere, so no qualifier
  });

  it("with no reload seam wired, neither chord is offered (upstream gates Ctrl+A on the callback existing)", async () => {
    const r = mount();                                                      // no `reload` prop
    await waitFor(() => frame(r.lastFrame).includes("refactor the parser"));
    const f = flat(frame(r.lastFrame));
    expect(f).not.toContain("Ctrl+A");
    expect(f).not.toContain("Ctrl+W");
    expect(f).toContain("space to preview");
  });

  // EXTERNAL REVIEW, FINDING 2. Widening the LIST was only half of Ctrl+A: preview and rename still read
  // through the caller's launch directory, so a row from another project previewed empty and renamed the
  // wrong project's store. Every row carries the directory it belongs to (`cwd` on `SDKSessionInfo` — there
  // is no `projectPath` field on it, verified against the installed sdk.d.ts), and both verbs pass it.
  it("previews and renames a widened row through THAT row's own directory, not the launch cwd", async () => {
    const foreign: SessionInfo = { sessionId: "4444dddd-0004", summary: "a session from another repo", lastModified: NOW, cwd: "/elsewhere" };
    const loads: [string, string | undefined][] = [];
    const renames: [string, string, string | undefined][] = [];
    const r = render(
      <SessionPicker sessions={[foreign]} onPick={() => {}} onCancel={() => {}} rows={40} columns={100}
                     loadMessages={async (id, dir) => { loads.push([id, dir]); return { state: "loaded", messages: [{ type: "user", message: { content: "over there" } }] }; }}
                     renameSession={async (id, t, dir) => { renames.push([id, t, dir]); }} />,
    );
    await waitFor(() => frame(r.lastFrame).includes("a session from another repo"));
    r.stdin.write(" ");
    await waitFor(() => flat(frame(r.lastFrame)).includes("over there"));
    expect(loads).toEqual([["4444dddd-0004", "/elsewhere"]]);
    r.stdin.write("\x1b");
    await waitFor(() => flat(frame(r.lastFrame)).includes("space to preview"));
    r.stdin.write("\x12");                                                  // ctrl+r
    await waitFor(() => flat(frame(r.lastFrame)).includes("Rename session:"));
    r.stdin.write("renamed there\r");
    await waitFor(() => renames.length > 0);
    expect(renames).toEqual([["4444dddd-0004", "renamed there", "/elsewhere"]]);
  });
});

// T-RESUME T2 — THE ASSEMBLED PATH (plan-review catch, brief cell b2). Every test above mounts
// `SessionPicker` bare, which proves the COMPONENT'S contract but not the WIRING: `ChatApp.tsx` threads
// `previewSession` into `loadMessages` and `pickSession` into `onPick`, and `useChat.ts`'s `resumeInto` is
// what decides whether a confirm re-reads the file. This test goes through the real `ChatApp`/`useChat`
// assembly with an INSTRUMENTED loader that fails on any call beyond the first, so a regression that
// silently reintroduced a second read (the exact defect `resumeInto`'s old unconditional
// `getSessionMessages` call was) fails LOUD here even though every unit above it would still pass green.
describe("T-RESUME T2 — the assembled path: ChatApp/useChat, y resumes with zero further loader calls", () => {
  it("previews once, then `y` resumes WITHOUT reading the session a second time", async () => {
    let calls = 0;
    const deps = {
      hasWorktrees: async () => false,
      listSessions: async () => SESSIONS,
      getSessionMessages: async () => {
        calls++;
        if (calls > 1) throw new Error("resumeInto must not read the session a second time");
        return [{ type: "user", message: { content: "hello from disk" } }];
      },
    };
    const fake = fakeRemote();
    const r = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} deps={deps as never} />);
    await waitFor(() => frame(r.lastFrame).includes("❯\u00a0"));      // composer mounted (chat.test.tsx's own marker — NBSP, not a plain space)
    r.stdin.write("/resume");
    await waitFor(() => frame(r.lastFrame).includes("/resume"));
    r.stdin.write("\r");
    await waitFor(() => frame(r.lastFrame).includes("Resume session"));
    r.stdin.write(" ");                                                     // space: open the full-screen view
    await waitFor(() => flat(frame(r.lastFrame)).includes("hello from disk"));
    expect(calls).toBe(1);                                                  // the preview's ONE read
    r.stdin.write("y");                                                     // confirm — must NOT read again
    await waitFor(() => !flat(frame(r.lastFrame)).includes("Resume session"));
    expect(calls).toBe(1);                                                  // still just one — the loaded payload resumed it
    expect(flat(frame(r.lastFrame))).toContain("hello from disk");          // …and the resumed transcript is really on screen
    r.unmount();
  });
});
