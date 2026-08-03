// test/tui/f1-frame-parity.test.tsx — F1 Task 7 acceptance evidence that needs REAL Ink bytes rather than
// ink-testing-library's plain-text frame: the OSC-8 hyperlink a Read header carries, and the SGR runs a
// theme switch changes. `render()` from ink-testing-library strips neither reliably (it exposes the frame
// text, not the stream), so `rawInk` mounts the same element against a fake TTY stdout and keeps every byte.
//
// The host-vs-disk cases here are CHEAP GUARDS, not the evidence for acceptance item 1: both sides build a
// TranscriptDocument through the same `appendSdk` and the projection never reads the `source` discriminant,
// so they are near-tautological by construction. The real live-vs-replay evidence is the pyte frame diff in
// the Task 7 Step 4 captures, which drives the production host-event path against the production
// bootstrap/replay path end to end.
//
// POST-5c: the DEFAULT compact projection folds a contiguous read run into one dim summary row, so the
// per-call `⏺ Read(src/app.ts)` header (and therefore its OSC-8 link and its status colour) now lives only
// in the DETAIL projections. Every raw-byte assertion below is taken from `projectDetail`, which is exactly
// what the Ctrl-O pager renders.
import React from "react";
import { Writable } from "node:stream";
import { render as renderInk } from "ink";
import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import { ChatApp } from "../../src/tui/ChatApp.js";
import { Transcript } from "../../src/tui/Transcript.js";
import { TranscriptDocument } from "../../src/tui/transcriptModel.js";
import { setTheme } from "../../src/tui/theme.js";
import { projectCompact, projectDetail, projectPending, RenderItemView, type RenderItem } from "../../src/tui/toolRenderer.js";
import { parseFrameArgs, READ_CALL, READ_RESULT_FLAT, READ_RESULT_UPSTREAM, READ_RESULT_WITH_SIDECAR } from "../fixtures/f1-tool-transcript.js";
import { fakeRemote } from "./helpers/fakeRemote.js";

async function rawInk(element: React.ReactElement): Promise<string> {
  let output = "";
  const stdout = Object.assign(new Writable({ write(chunk, _encoding, callback) { output += Buffer.from(chunk).toString("utf8"); callback(); } }), { isTTY: true, columns: 100, rows: 40, getColorDepth: () => 24, hasColors: (_count?: number) => true });
  const app = renderInk(element, { stdout: stdout as unknown as NodeJS.WriteStream, exitOnCtrlC: false });
  await new Promise((resolve) => setTimeout(resolve, 20));
  app.unmount();
  return output;
}

const context = { cwd: "/work", home: "/home/me", platform: "darwin" as NodeJS.Platform, columns: 100, now: 0 };
function document(source: "host" | "disk", result: Record<string, unknown>): TranscriptDocument {
  const doc = new TranscriptDocument(); doc.appendSdk(source, READ_CALL); doc.appendSdk(source, result);
  return doc;
}
/** The whole DEFAULT screen, exactly as ChatApp composes it: Static's finalized items plus the transient
 *  region. A settled fold run is still growable until a breaker closes it, so `projectCompact` alone
 *  withholds it — comparing only that would compare two empty lists and prove nothing. */
const compact = (source: "host" | "disk", result: Record<string, unknown>) => {
  const doc = document(source, result);
  return [...projectCompact(doc, context), ...projectPending(doc, context)];
};
const detail = (source: "host" | "disk", result: Record<string, unknown>) => projectDetail(document(source, result), { ...context, projection: "detail-all" });
const frame = (items: readonly RenderItem[]) => render(<Transcript staticItems={items} pendingItems={[]} streaming={[]} />).lastFrame();
const itemsView = (items: readonly RenderItem[]) => <>{items.map((item) => <RenderItemView key={item.id} item={item} />)}</>;
const sgr = (output: string) => output.match(/\x1b\[[0-9;]*m/g) ?? [];
const visible = (output: string) => output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/\x1b]8;;[^\x07]*\x07/g, "");

describe("F1 frame parity", () => {
  it("matches host and disk projections for the associated-sidecar Read, compact and detail", () => {
    expect(frame(compact("host", READ_RESULT_WITH_SIDECAR))).toBe(frame(compact("disk", READ_RESULT_WITH_SIDECAR)));
    expect(frame(detail("host", READ_RESULT_WITH_SIDECAR))).toBe(frame(detail("disk", READ_RESULT_WITH_SIDECAR)));
  });
  it("matches host and disk projections for the flat-only fallback Read, compact and detail", () => {
    expect(frame(compact("host", READ_RESULT_FLAT))).toBe(frame(compact("disk", READ_RESULT_FLAT)));
    expect(frame(detail("host", READ_RESULT_FLAT))).toBe(frame(detail("disk", READ_RESULT_FLAT)));
  });
  it("projects the one-line upstream comparison fixture through the same renderer", () => {
    // The default view is the folded summary the real 2.1.220 golden also paints; the per-call header is
    // the ctrl+o form. Both come off the SAME retained document through the SAME renderer.
    expect(visible(frame(compact("disk", READ_RESULT_UPSTREAM)) ?? "")).toContain("Read 1 file (ctrl+o to expand)");
    expect(visible(frame(detail("disk", READ_RESULT_UPSTREAM)) ?? "")).toContain("Read(src/app.ts)");
  });
  it("retains exact OSC-8 bytes from actual projected RenderItemView output", async () => {
    expect(await rawInk(itemsView(detail("host", READ_RESULT_WITH_SIDECAR)))).toContain("\x1b]8;;file:///work/src/app.ts\x07src/app.ts\x1b]8;;\x07");
  });
  it("emits distinct theme SGR sequences for the same newly projected semantic elements", async () => {
    try {
      setTheme("dark"); const dark = await rawInk(itemsView(detail("host", READ_RESULT_WITH_SIDECAR)));
      setTheme("light"); const light = await rawInk(itemsView(detail("host", READ_RESULT_WITH_SIDECAR)));
      expect(visible(light)).toBe(visible(dark)); expect(sgr(light)).not.toEqual(sgr(dark));
    } finally { setTheme("auto"); }
  });
});

// ── The capture fixture's own two safety rails ─────────────────────────────────────────────────────────
describe("F1 capture fixture contract", () => {
  it("accepts exactly the six documented argv pairs and rejects everything else", () => {
    for (const route of ["live", "replay"] as const)
      for (const shape of ["sidecar", "flat", "upstream"] as const)
        expect(parseFrameArgs(["node", "frame.tsx", route, shape])).toEqual({ ok: true, route, shape });
    // The hole this closes: `liv` used to fall through to `replay`, so a mistyped capture diffed replay
    // against replay and printed a "clean" that proved nothing. Both axes now fail loud instead.
    for (const argv of [["node", "f", "liv", "sidecar"], ["node", "f", "LIVE", "sidecar"], ["node", "f", "", "sidecar"], ["node", "f"]])
      expect(parseFrameArgs(argv)).toMatchObject({ ok: false, error: expect.stringContaining("argv[2] (route)") });
    for (const argv of [["node", "f", "live", "sidcar"], ["node", "f", "live", "Upstream"], ["node", "f", "live"]])
      expect(parseFrameArgs(argv)).toMatchObject({ ok: false, error: expect.stringContaining("argv[3] (shape)") });
  });

  it("threads the fixture's pinned home and platform through useChat into the projection context", async () => {
    // Before the deps seam existed, `useChat` read `homedir()`/`process.platform` live: the `~`-shortened
    // hint path carried the RUNNER's home and the leader glyph was `⏺` only on macOS, so the golden
    // comparison was unpinnable off Darwin. Pinning a NON-host platform is what makes this test real.
    const session = fakeRemote();
    const { lastFrame } = render(
      <ChatApp makeSession={() => session} client={{ kind: "loopback" }} cwd="/work"
        deps={{ now: () => 0, columns: () => 100, home: "/home/me", platform: "linux", scheduleRepaint: () => () => {} }} />,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    session.pushEvent({ kind: "message", data: { type: "assistant", message: { id: "a-home", content: [{ type: "tool_use", id: "read-home", name: "Read", input: { file_path: "/home/me/notes.ts" } }] } } });
    const start = Date.now();
    while (!visible(lastFrame() ?? "").includes("~/notes.ts")) {
      if (Date.now() - start > 2000) throw new Error(`pinned projection never rendered: ${JSON.stringify(lastFrame())}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const painted = visible(lastFrame() ?? "");
    expect(painted).toContain("● Reading");     // `platform: "linux"` — darwin would paint `⏺`
    expect(painted).not.toContain("⏺");
    expect(painted).toContain("~/notes.ts");    // `home: "/home/me"` — the runner's real home would not shorten
  });
});
