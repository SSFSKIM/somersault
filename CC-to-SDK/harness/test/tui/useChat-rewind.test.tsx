// test/tui/useChat-rewind.test.ts — Esc-Esc rewind flow (Stage C5 task 4): openRewind/closeRewindPicker/
// rewindDryRun/confirmRewind + composer prefill. Anchors are ALWAYS re-fetched (never patched locally —
// probe 68 Q4); a conversation rewind rebuilds the transcript + pre-fills the composer with the rewound
// prompt's text (CC's edit-and-resend loop); a code-only rewind only notices, composer untouched.
import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { Text } from "ink";
import { useChat, type ChatSession } from "../../src/tui/useChat.js";
import { fakeRemote, type FakeRemote, type FakeRemoteOpts } from "./helpers/fakeRemote.js";
import type { RewindAnchor, RewindDryRun, RewindScope } from "../../src/session/chatSession.js";
import { replayDocument } from "../../src/tui/replay.js";
import { projectCompact, type RenderItem } from "../../src/tui/toolRenderer.js";

const frame = (f: () => string | undefined) => (f() ?? "").replace(/\n/g, " ");
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) return; if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
const itemLines = (item: RenderItem): string[] => (item.kind === "line" ? [item.line.text] : item.body.map((l) => l.text));
function allText(c: { state: { staticItems: readonly RenderItem[]; pendingItems: readonly RenderItem[]; streaming: { text: string }[] } }): string {
  return [...[...c.state.staticItems, ...c.state.pendingItems].flatMap(itemLines), ...c.state.streaming.map((l) => l.text)].join("|");
}
const projectionOptions = { cwd: "/work", home: "/home/me", platform: "darwin" as NodeJS.Platform, columns: 100, now: 0 };

// The fake-session scaffold, extended onto the RewindOps surface (fakeRemote() alone satisfies ChatSession &
// DecisionFeed & BgTasks & SessionEvents but has no rewind methods, so hasRewind() is false on it as-is —
// exactly what case 4 below needs).
type RewindFakeOpts = {
  rewindAnchors?: () => Promise<RewindAnchor[]>;
  rewindDryRun?: (uuid: string) => Promise<RewindDryRun>;
  rewind?: (anchor: RewindAnchor, scope: RewindScope) => Promise<void>;
};
function fakeRewindSession(rewindOpts: RewindFakeOpts = {}, remoteOpts: FakeRemoteOpts = {}): FakeRemote & { rewindAnchors: () => Promise<RewindAnchor[]>; rewindDryRun: (uuid: string) => Promise<RewindDryRun>; rewind: (anchor: RewindAnchor, scope: RewindScope) => Promise<void>; } {
  const base = fakeRemote(remoteOpts);
  return {
    ...base,
    rewindAnchors: rewindOpts.rewindAnchors ?? (async () => []),
    rewindDryRun: rewindOpts.rewindDryRun ?? (async () => ({ canRewind: true })),
    rewind: rewindOpts.rewind ?? (async () => {}),
  };
}

const ANCHOR: RewindAnchor = { uuid: "u1", prevUuid: "u0", text: "fix the parser", index: 2 };

function RewindHost({ makeSession, api }: { makeSession: () => ChatSession; api: { openRewind?: () => void; closeRewindPicker?: () => void; rewindDryRun?: (uuid: string) => Promise<RewindDryRun>; confirmRewind?: (a: RewindAnchor, s: RewindScope) => void } }) {
  const c = useChat(makeSession);
  api.openRewind = (c as any).openRewind;
  api.closeRewindPicker = (c as any).closeRewindPicker;
  api.rewindDryRun = (c as any).rewindDryRun;
  api.confirmRewind = (c as any).confirmRewind;
  const s = c.state as any;
  return <Text>picker:{String(s.rewindPicker.open)}:{s.rewindPicker.anchors.length} prefill:{s.composerPrefill ? s.composerPrefill.text : "-"} busy:{String(s.busy)} {allText(c)}</Text>;
}

describe("useChat: rewind flow", () => {
  it("1. openRewind fetches anchors and opens the picker", async () => {
    const anchors = [ANCHOR];
    const session = fakeRewindSession({ rewindAnchors: async () => anchors });
    const api: Parameters<typeof RewindHost>[0]["api"] = {};
    const { lastFrame } = render(<RewindHost makeSession={() => session} api={api} />);
    await new Promise((r) => setTimeout(r, 20));
    api.openRewind!();
    await waitFor(() => frame(lastFrame).includes("picker:true:1"));
  });

  it("2. openRewind with zero anchors notices 'nothing to rewind to' and stays closed", async () => {
    const session = fakeRewindSession({ rewindAnchors: async () => [] });
    const api: Parameters<typeof RewindHost>[0]["api"] = {};
    const { lastFrame } = render(<RewindHost makeSession={() => session} api={api} />);
    await new Promise((r) => setTimeout(r, 20));
    api.openRewind!();
    await waitFor(() => frame(lastFrame).includes("nothing to rewind to"));
    expect(frame(lastFrame)).toContain("picker:false:0");
  });

  it("3. openRewind while busy notices and does not fetch", async () => {
    let fetched = 0;
    let session!: ReturnType<typeof fakeRewindSession>;
    session = fakeRewindSession(
      { rewindAnchors: async () => { fetched++; return [ANCHOR]; } },
      { submit: async () => { session.pushEvent({ kind: "turn", phase: "start", seq: 1 }); return new Promise<{ result: unknown }>(() => {}); } },
    );
    const api: Parameters<typeof RewindHost>[0]["api"] = {};
    function H() {
      const c = useChat(() => session);
      api.openRewind = (c as any).openRewind;
      return <Text>{c.state.busy ? "BUSY" : "IDLE"} {allText(c)}</Text>;
    }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    (session as any).submit("go");
    await waitFor(() => frame(lastFrame).includes("BUSY"));
    api.openRewind!();
    await waitFor(() => frame(lastFrame).includes("cannot rewind mid-turn"));
    expect(fetched).toBe(0);
  });

  it("4. openRewind on a session without RewindOps notices 'rewind unsupported' and does not crash", async () => {
    const session = fakeRemote();   // plain ChatSession fake — no rewind methods at all
    const api: Parameters<typeof RewindHost>[0]["api"] = {};
    const { lastFrame } = render(<RewindHost makeSession={() => session} api={api} />);
    await new Promise((r) => setTimeout(r, 20));
    api.openRewind!();
    await waitFor(() => frame(lastFrame).includes("rewind unsupported"));
    expect(frame(lastFrame)).toContain("picker:false:0");
  });

  it("5. confirmRewind(anchor, 'both') rewinds, re-fetches messages, renders the ⏪ rewound header, and pre-fills the composer", async () => {
    const rewindCalls: { anchor: RewindAnchor; scope: RewindScope }[] = [];
    const msgs = [{ type: "user", uuid: "u-fix", message: { content: [{ type: "text", text: "fix the parser" }] }, timestamp: "2026-07-28T08:00:00.000Z" }];   // uuid: rowKind() only calls a user row a "prompt" (hence a counted turn) when it carries one, as every real transcript row does
    const session = fakeRewindSession({ rewind: async (a, s) => { rewindCalls.push({ anchor: a, scope: s }); } });
    let fetched = 0;
    const deps = { getSessionMessages: async () => { fetched++; return msgs; } };
    const api: Parameters<typeof RewindHost>[0]["api"] = {};
    function H() {
      const c = useChat(() => session, {}, deps);
      api.confirmRewind = (c as any).confirmRewind;
      const s = c.state as any;
      return <Text>prefill:{s.composerPrefill ? s.composerPrefill.text : "-"} {allText(c)}</Text>;
    }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    api.confirmRewind!(ANCHOR, "both");
    await waitFor(() => frame(lastFrame).includes("prefill:fix the parser"));
    expect(rewindCalls).toEqual([{ anchor: ANCHOR, scope: "both" }]);
    expect(fetched).toBe(1);
    // the DERIVED header ("… · 1 turn"), not the bare "⏪ rewound" fallback that an empty fetch also renders
    expect(frame(lastFrame)).toContain("⏪ rewound: fix the parser · 1 turn");
  });

  it("5b. after a rewind, /copy copies the assistant reply the REPLAY put on screen (never 'nothing to copy')", async () => {
    const msgs = [
      { type: "user", uuid: "u-fix2", message: { content: [{ type: "text", text: "fix the parser" }] }, timestamp: "2026-07-28T08:00:00.000Z" },
      { type: "assistant", message: { content: [{ type: "text", text: "the parser is fixed" }] } },
    ];
    const session = fakeRewindSession({ rewind: async () => {} });
    let copied: string | undefined;
    const deps = { getSessionMessages: async () => msgs, copyText: async (t: string) => { copied = t; } };
    const api: Parameters<typeof RewindHost>[0]["api"] & { run?: (p: string) => void } = {};
    function H() {
      const c = useChat(() => session, {}, deps);
      api.confirmRewind = (c as any).confirmRewind; (api as any).run = c.submit;
      return <Text>{allText(c)}</Text>;
    }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    api.confirmRewind!(ANCHOR, "both");
    await waitFor(() => frame(lastFrame).includes("⏪ rewound"));
    (api as any).run!("/copy");
    await waitFor(() => frame(lastFrame).includes("✓ copied"));
    expect(copied).toBe("the parser is fixed");
  });

  it("6. confirmRewind(anchor, 'code') rewinds but never fetches messages, notices 'code restored', and leaves the composer alone", async () => {
    const rewindCalls: RewindScope[] = [];
    let fetched = 0;
    const session = fakeRewindSession({ rewind: async (_a, s) => { rewindCalls.push(s); } });
    const deps = { getSessionMessages: async () => { fetched++; return []; } };
    const api: Parameters<typeof RewindHost>[0]["api"] = {};
    function H() {
      const c = useChat(() => session, {}, deps);
      api.confirmRewind = (c as any).confirmRewind;
      const s = c.state as any;
      return <Text>prefill:{s.composerPrefill ? s.composerPrefill.text : "-"} {allText(c)}</Text>;
    }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    api.confirmRewind!(ANCHOR, "code");
    await waitFor(() => frame(lastFrame).includes("code restored"));
    expect(rewindCalls).toEqual(["code"]);
    expect(fetched).toBe(0);
    expect(frame(lastFrame)).toContain("prefill:-");
  });

  it("7. confirmRewind rejection surfaces '✗ rewind failed: busy', closes the picker, and does not crash", async () => {
    const session = fakeRewindSession({ rewindAnchors: async () => [ANCHOR], rewind: async () => { throw new Error("busy"); } });
    const api: Parameters<typeof RewindHost>[0]["api"] = {};
    const { lastFrame } = render(<RewindHost makeSession={() => session} api={api} />);
    await new Promise((r) => setTimeout(r, 20));
    api.openRewind!();
    await waitFor(() => frame(lastFrame).includes("picker:true:1"));
    api.confirmRewind!(ANCHOR, "both");
    await waitFor(() => frame(lastFrame).includes("✗ rewind failed: busy"));
    expect(frame(lastFrame)).toContain("picker:false:0");
  });

  it("8. replayDocument({label}) overrides the header prefix (default 'resumed')", () => {
    const msgs = [{ type: "user", message: { content: [{ type: "text", text: "fix it" }] }, timestamp: "2026-07-28T08:00:00.000Z" }];
    const out = projectCompact(replayDocument(msgs, { label: "⏪ rewound" }), projectionOptions);
    expect((out[0] as any).line.text.startsWith("─── ⏪ rewound:")).toBe(true);
    expect((out.at(-1) as any).line.text).toBe("─── ⏪ rewound here · live ───");
  });

  it("11. a completed rewind rebuilds the document from the RESTORED persisted messages only, and the composer stays usable", async () => {
    const msgs = [{ type: "user", uuid: "u-keep", message: { content: [{ type: "text", text: "the surviving prompt" }] }, timestamp: "2026-07-28T08:00:00.000Z" }];
    const session = fakeRewindSession({ rewind: async () => {} });
    const deps = { getSessionMessages: async () => msgs };
    const api: Parameters<typeof RewindHost>[0]["api"] & { run?: (p: string) => void } = {};
    const submitted: string[] = [];
    function H() {
      const c = useChat(() => ({ ...session, submit: async (p: string) => { submitted.push(p); return { result: "ok" }; } } as any), {}, deps);
      api.confirmRewind = (c as any).confirmRewind; (api as any).run = c.submit;
      return <Text>epoch:{c.state.staticEpoch} {allText(c)}</Text>;
    }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    (api as any).run!("this prompt predates the rewind");
    await waitFor(() => frame(lastFrame).includes("this prompt predates the rewind"));
    api.confirmRewind!(ANCHOR, "both");
    await waitFor(() => frame(lastFrame).includes("the surviving prompt"));
    expect(frame(lastFrame)).toContain("epoch:1");                          // a terminal boundary, fresh <Static>
    expect(frame(lastFrame)).not.toContain("this prompt predates the rewind");   // derived ONLY from restored rows
    (api as any).run!("after rewind");
    await waitFor(() => submitted.includes("after rewind"));
  });

  it("9. a `rewound` broadcast from ANOTHER client rebuilds this follower's transcript (no prefill — not our prompt)", async () => {
    // The host swaps the engine and truncates the persisted conversation; a generic `state` event only
    // syncs permissionMode, so without this every other attached client keeps rendering the pre-rewind
    // transcript while its next prompt runs against the truncated host conversation.
    const msgs = [
      { type: "user", uuid: "u-a", message: { content: [{ type: "text", text: "the surviving prompt" }] }, timestamp: "2026-07-28T08:00:00.000Z" },
      { type: "assistant", message: { content: [{ type: "text", text: "the surviving reply" }] } },
    ];
    const session = fakeRewindSession();
    const deps = { getSessionMessages: async () => msgs };
    function H() {
      const c = useChat(() => session, {}, deps);
      const st = c.state as any;
      return <Text>prefill:{st.composerPrefill ? st.composerPrefill.text : "-"} {allText(c)}</Text>;
    }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    session.pushEvent({ kind: "rewound", sessionId: "s1" } as any);
    await waitFor(() => frame(lastFrame).includes("the surviving reply"));
    expect(frame(lastFrame)).toContain("⏪ rewound");
    expect(frame(lastFrame)).toContain("prefill:-");     // a follower must NOT inherit the other user's prompt
  });

  it("10. the composer is held behind a modal while a rewind runs, so a prompt typed mid-rewind cannot be lost", async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    const session = fakeRewindSession({ rewind: async () => { await held; } });
    const deps = { getSessionMessages: async () => [] as any[] };
    const api: Parameters<typeof RewindHost>[0]["api"] = {};
    function H() {
      const c = useChat(() => session, {}, deps);
      api.confirmRewind = (c as any).confirmRewind;
      const st = c.state as any;
      return <Text>rewinding:{String(st.rewinding)} {allText(c)}</Text>;
    }
    const { lastFrame } = render(<H />);
    await new Promise((r) => setTimeout(r, 20));
    api.confirmRewind!(ANCHOR, "both");
    await waitFor(() => frame(lastFrame).includes("rewinding:true"));
    release();
    await waitFor(() => frame(lastFrame).includes("rewinding:false"));
  });
});
