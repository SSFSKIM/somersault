// tui/test/session-picker.test.tsx — the /resume picker rebuilt on `Select` (F6 T11, DG49-DG51). The
// literals are transcriptions of 2.1.220's `moi` (L476394-476628) and its preview pane `fGa` (L476095); the
// bundle line sits on the assertion it produced. The two deliberate divergences — modeless search, and
// `hideIndexes` so digits reach the search field — are pinned here too, so a later "fix" back toward
// upstream's mode machine fails a test instead of passing silently.
import React from "react";
import { describe, it, expect } from "vitest";
import { renderWithKeymap as render, tick } from "./keysTestUtil.js";
import { SessionPicker } from "../../src/tui/SessionPicker.js";
import type { SessionInfo } from "../../src/tui/useChat.js";
import {
  filterSessions, isPreviewMessage, NARROWED_SCOPE, NO_CONVERSATIONS, NO_CONVERSATIONS_IN_PROJECT,
  noConversations, noSessionsMatch, PREVIEW_ATTACHMENT, PREVIEW_ROWS, previewLines, previewMessageCount,
  previewMeta, RENAME_FALLBACK, renamePlaceholder, RESUME_CANCELLED, resumeFooter, resumeHeader,
  resumeVisibleRows, sessionMeta, sessionTitle, widenHints,
} from "../../src/tui/sessionPickerModel.js";
import type { ResumeScope } from "../../src/tui/sessionPickerModel.js";

const frame = (f: () => string | undefined) => f() ?? "";
const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const flat = (s: string) => plain(s).replace(/\s*\n\s*/g, " ");
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

function mount(props: Partial<React.ComponentProps<typeof SessionPicker>> = {}) {
  const picked: string[] = [];
  const renamed: [string, string][] = [];
  let cancelled = false;
  const r = render(
    <SessionPicker
      sessions={props.sessions ?? SESSIONS}
      onPick={(s) => picked.push(s.sessionId)}
      onCancel={() => { cancelled = true; }}
      loadMessages={props.loadMessages ?? (async () => [])}
      renameSession={props.renameSession ?? (async (id, t) => { renamed.push([id, t]); })}
      {...(props.refreshing !== undefined ? { refreshing: props.refreshing } : {})}
      rows={40} columns={100}
    />,
  );
  return { ...r, picked, renamed, wasCancelled: () => cancelled };
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

  it("takes the TAIL of a transcript, one line per conversational message, tool traffic dropped", () => {
    const msgs = [
      { type: "user", message: { content: "hello there\nmore" } },
      { type: "user", message: { content: [{ type: "tool_result", content: "x" }] } },
      { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "hi" }] } },
      { type: "system", subtype: "init" },
    ];
    expect(previewLines(msgs)).toEqual([{ role: "user", text: "hello there" }, { role: "assistant", text: "hi" }]);
    expect(previewLines(Array.from({ length: 30 }, () => ({ type: "user", message: { content: "x" } })), 3)).toHaveLength(3);
  });
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
//  · a meta user turn carrying text — upstream EXCLUDES it, the old pane drew it.
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
    // `$$_`/`B$_` (L369021/L369035) in full: meta user turns, blank text, tool-use-only and thinking-only
    // assistant turns, and every attachment/system/progress entry are all out.
    expect(isPreviewMessage({ type: "user", isMeta: true, message: { content: "caveat" } })).toBe(false);
    expect(isPreviewMessage({ type: "user", message: { content: "   " } })).toBe(false);
    expect(isPreviewMessage({ type: "user", message: { content: [{ type: "image" }] } })).toBe(true);
    expect(isPreviewMessage(toolUseOnly())).toBe(false);
    expect(isPreviewMessage({ type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "thinking", thinking: "hm" }] } })).toBe(false);
    expect(isPreviewMessage({ type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "  " }] } })).toBe(false);
    expect(isPreviewMessage({ type: "system", subtype: "init" })).toBe(false);
    expect(isPreviewMessage({ type: "progress" })).toBe(false);
  });

  it("count and pane apply the SAME predicate", () => {
    // NOT "the count equals the pane's row count" — `previewLines` ends `return out.slice(-PREVIEW_ROWS)`,
    // so for any transcript longer than the window the total and the windowed tail MUST differ. What has to
    // be shared is the predicate, and the way to pin THAT is to assert the pane's rows one for one against
    // the rows the count admitted — a length check alone can be satisfied by one wrong drop plus one wrong
    // addition, which is exactly how the first version of this test failed to notice a reverted pane.
    const disagree = [userPrompt("plain ask"), imageOnly(), metaText(), assistantText("reply")];
    expect(previewMessageCount(disagree)).toBe(3);                     // the meta row is out, the image row in
    expect(previewLines(disagree)).toEqual([
      { role: "user", text: "plain ask" },
      { role: "user", text: PREVIEW_ATTACHMENT },                      // counted, so it is DRAWN, never dropped
      { role: "assistant", text: "reply" },
    ]);
    const rows = manyMixedRows(40);
    expect(previewMessageCount(rows)).toBe(rows.filter(isPreviewMessage).length);
    expect(previewMessageCount(rows)).toBeGreaterThan(PREVIEW_ROWS);
    expect(previewLines(rows).length).toBeLessThanOrEqual(PREVIEW_ROWS);
    // …and no row the count admits is silently dropped by the pane: on a short transcript they agree exactly.
    const short = manyMixedRows(16);
    expect(previewLines(short).length).toBe(previewMessageCount(short));
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

describe("SessionPicker — Space opens the preview pane (L476570/L476095)", () => {
  it("loads the highlighted session, shows its tail and its meta, and resumes on Enter", async () => {
    const calls: string[] = [];
    const r = mount({
      loadMessages: async (id) => { calls.push(id); return [
        { type: "user", message: { content: "what does this do?" } },
        { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "it resumes" }] } },
      ]; },
    });
    await waitFor(() => frame(r.lastFrame).includes("refactor the parser"));
    r.stdin.write(" ");
    await waitFor(() => flat(frame(r.lastFrame)).includes("it resumes"));
    expect(calls).toEqual(["1111aaaa-0001"]);
    const f = flat(frame(r.lastFrame));
    expect(f).toContain("what does this do?");
    expect(f).toContain("2 messages");
    expect(f).toContain("enter to resume");
    expect(f).not.toContain("write the release notes");                     // the pane REPLACES the list
    r.stdin.write("\r");
    await waitFor(() => r.picked.length > 0);
    expect(r.picked).toEqual(["1111aaaa-0001"]);
  });

  // The cost of a MODELESS search (upstream's is a mode that disables the list): space cannot be both the
  // preview key and a word separator, so it is the preview key only from an EMPTY query — the state the
  // footer advertises it in — and types once a query exists. Both arms pinned; recorded divergence (T15).
  it("space TYPES into a live query instead of previewing, so a multi-word search is reachable", async () => {
    let loads = 0;
    const r = mount({ loadMessages: async () => { loads++; return []; } });
    await waitFor(() => frame(r.lastFrame).includes("refactor the parser"));
    for (const c of "the") r.stdin.write(c);
    await waitFor(() => flat(frame(r.lastFrame)).includes("⌕ the"));
    r.stdin.write(" "); r.stdin.write("p");
    await waitFor(() => flat(frame(r.lastFrame)).includes("⌕ the p"));
    expect(loads).toBe(0);                                                  // no preview was opened
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

  it("Esc leaves the pane for the list without resuming anything", async () => {
    const r = mount({ loadMessages: async () => [{ type: "user", message: { content: "hi" } }] });
    await waitFor(() => frame(r.lastFrame).includes("refactor the parser"));
    r.stdin.write(" ");
    await waitFor(() => flat(frame(r.lastFrame)).includes("enter to resume"));
    r.stdin.write("\x1b");
    await waitFor(() => flat(frame(r.lastFrame)).includes("space to preview"));
    expect(r.picked).toEqual([]);
    expect(r.wasCancelled()).toBe(false);                                   // …and did NOT close the picker
  });

  it("a preview that cannot be read is an empty pane, not a crash", async () => {
    const r = mount({ loadMessages: async () => { throw new Error("gone"); } });
    await waitFor(() => frame(r.lastFrame).includes("refactor the parser"));
    r.stdin.write(" ");
    await waitFor(() => flat(frame(r.lastFrame)).includes("(no messages)"));
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

  it("counts the previewed transcript with the PANE's predicate, not its raw row count (qa4-07 ii)", async () => {
    const r = mount({
      loadMessages: async () => [
        { type: "user", message: { content: "what does this do?" } },
        { type: "user", message: { content: [{ type: "tool_result", content: "1000 lines" }] } },
        { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "tool_use", id: "t", name: "Read", input: {} }] } },
        { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "it resumes" }] } },
      ],
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
                     loadMessages={async (id, dir) => { loads.push([id, dir]); return [{ type: "user", message: { content: "over there" } }]; }}
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
