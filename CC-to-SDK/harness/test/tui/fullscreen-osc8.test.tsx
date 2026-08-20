// test/tui/fullscreen-osc8.test.tsx — THE HYPERLINK LABEL DROP (tui-ux.md §2's tool-stream-wave mark-down):
// in the fullscreen renderer a file-tool header painted `⏺ Read(` and STOPPED, where classic paints
// `⏺ Read(src/app.ts)`. The mechanism, measured before the fix: Ink's clip path (`output.js:88`) runs EVERY
// line of a horizontally-clipped box through `sliceAnsi(line, 0, stringWidth(line))` — a no-op slice by
// intent — but `string-width` is OSC-8-aware (the link's URL bytes are zero columns) while `slice-ansi`
// 7.1.2 is NOT (it counts them as printable), so the "no-op" cuts the line mid-URL and both the URL and the
// label are gone. Classic never clips, which is why only fullscreen lost the label; wrap-ansi and a
// genuinely-fitting slice both pass the link intact, which is why nothing upstream of the clip was at fault.
//   THE FIX IS AXIS-SCOPED CLIPPING: `overflowY: "hidden"` in place of `overflow: "hidden"` on the frame's
// three bands and the region pager's clip box. The vertical clip is `lines.slice` — byte-safe — and it is
// the only load-bearing one (the I9a clip-not-shove case is about ROWS); horizontally nothing can overhang,
// because every surface inside the frame wraps to its width BEFORE windowing (wrapItems' rule). `overflow`
// never reaches Yoga in Ink 5.2.1 (`styles.js` has no overflow branch — it is a paint-time flag read at
// `render-node-to-output.js:60`), so the layout is untouched by construction.
//   Each case below reaches the bytes through one of the changed clip boxes, so reverting any single site
// back to `overflow: "hidden"` turns its case red. `ink-testing-library` IS a sufficient instrument here —
// debug mode skips log-update, not the Output clip, and the mangle reproduced on it byte-for-byte.
import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { Text } from "ink";
import { FullscreenFrame } from "../../src/tui/FullscreenFrame.js";
import { RegionPager } from "../../src/tui/RegionPager.js";
import { RenderItemView, osc8FileLink, renderToolEvent, type RenderItem } from "../../src/tui/toolRenderer.js";
import { normalizeToolResult } from "../../src/tui/toolResult.js";
import { renderWithKeymap, tick } from "./keysTestUtil.js";

// The strip below is the same pair toolRenderer.test.tsx uses: SGR first, then WHOLE OSC-8 sequences. On the
// pre-fix bytes the label sat INSIDE an unterminated introducer (`…Read(\x1b]8;;file:///work/src/a\x1b]8;;\x07`),
// so this strip erased it with the escape — `Read(` with nothing after — which is exactly what the terminal
// showed. A naive `toContain("src/app.ts")` would have passed on the mangled frame via the URL's own bytes.
const visible = (frame: string | undefined) => (frame ?? "").replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b]8;;[^\x07]*\x07/g, "");

const read = { id: "read-1", name: "Read", input: { file_path: "/work/src/app.ts" }, callSequence: 1, route: "top-level" as const, result: { content: "a\nb", isError: false, resultSequence: 2 } };
const options = { cwd: "/work", home: "/home/me", platform: "darwin" as NodeJS.Platform, columns: 80, projection: "compact" as const, now: 0, verbose: false };
const headerItem = (): RenderItem => renderToolEvent(read, normalizeToolResult(read), options)[0]!;
const settle = async () => { for (let i = 0; i < 4; i++) await tick(); };

describe("fullscreen clip boxes pass OSC-8 hyperlinks through intact", () => {
  it("a real file-tool header inside the bounded frame keeps its label, parens and URL", async () => {
    const r = render(
      <FullscreenFrame rows={24} regionChildren={<RenderItemView item={headerItem()} />} dock={<Text>dock</Text>} />,
    );
    await settle();
    const frame = r.lastFrame() ?? "";
    expect(visible(frame)).toContain("Read(src/app.ts)");                       // the label the user reads
    expect(frame).toContain("\x1b]8;;file:///work/src/app.ts\x07src/app.ts\x1b]8;;\x07");  // the link itself, untruncated
    r.unmount();
  });

  it("the dock band (slot clip) passes a link through too", async () => {
    const link = osc8FileLink("/work/notes.md", "notes.md");
    const r = render(
      <FullscreenFrame rows={24} regionChildren={<Text>region</Text>} dock={<Text>{`status ${link}`}</Text>} />,
    );
    await settle();
    expect(visible(r.lastFrame())).toContain("status notes.md");
    expect(r.lastFrame() ?? "").toContain("\x1b]8;;file:///work/notes.md\x07notes.md\x1b]8;;\x07");
    r.unmount();
  });

  it("the region pager's own clip box passes a header's link through", async () => {
    const r = renderWithKeymap(
      <FullscreenFrame rows={24} dock={<Text>dock</Text>}
        regionChildren={<RegionPager makeItems={() => [headerItem()]} onClose={() => {}} columns={80} />} />,
    );
    await settle();
    expect(visible(r.lastFrame())).toContain("Read(src/app.ts)");
    r.unmount();
  });
});
