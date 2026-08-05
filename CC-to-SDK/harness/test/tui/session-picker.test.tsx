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
  filterSessions, NO_CONVERSATIONS, noSessionsMatch, previewLines, previewMeta, RENAME_FALLBACK,
  renamePlaceholder, resumeHeader, resumeVisibleRows, sessionMeta, sessionTitle,
} from "../../src/tui/sessionPickerModel.js";

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
      { type: "assistant", message: { content: [{ type: "text", text: "hi" }] } },
      { type: "system", subtype: "init" },
    ];
    expect(previewLines(msgs)).toEqual([{ role: "user", text: "hello there" }, { role: "assistant", text: "hi" }]);
    expect(previewLines(Array.from({ length: 30 }, () => ({ type: "user", message: { content: "x" } })), 3)).toHaveLength(3);
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

  it("says `No conversations found.` when the store is empty, and Esc still closes", async () => {
    const r = mount({ sessions: [] });
    await waitFor(() => frame(r.lastFrame).includes(NO_CONVERSATIONS));
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
        { type: "assistant", message: { content: [{ type: "text", text: "it resumes" }] } },
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

  it("with no rename seam wired, Ctrl-R is inert rather than a dead-end stage", async () => {
    const picked: string[] = [];
    const r = render(<SessionPicker sessions={SESSIONS} onPick={(s) => picked.push(s.sessionId)} onCancel={() => {}} rows={40} columns={100} />);
    await waitFor(() => frame(r.lastFrame).includes("refactor the parser"));
    r.stdin.write("\x12"); r.stdin.write(" ");
    await tick();
    expect(flat(frame(r.lastFrame))).toContain("space to preview");         // still the list
  });
});
