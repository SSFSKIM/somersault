// F4 wave-close live checks (controller-run, gated). Three things only a live run can settle:
//   A. A markdown-rich reply off the REAL wire renders through the F4 walkers without a crash and with the
//      forms present (box table, list markers, fenced code) — every unit test upstreamed a fixture; this is
//      the first time the composite pipeline eats a genuine assistant frame.
//   B. A REAL Edit's diff body carries ABSOLUTE numbers that match the file on disk (the structuredPatch
//      sidecar rung, P94), with the background bands present in both projections — and the compact form
//      does not crash on it.
//   C. The band × `⎿`-gutter GEOMETRY, which every F4 task computed and none ever SAW (t7 handoff, t11
//      reviewer): the Edit's rows are rendered through the real <Line> component and the frame's bytes are
//      inspected — the bands must reach the terminal as bg SGR runs, and the frame is printed for the
//      wave-close report.
import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionHost } from "../../src/host/host.js";
import type { HostEvent } from "../../src/host/wire.js";
import { TranscriptDocument } from "../../src/tui/transcriptModel.js";
import { projectCompact, projectDetail, RenderItemView, type RenderItem } from "../../src/tui/toolRenderer.js";
import type { RenderLine } from "../../src/tui/render.js";

const live = (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN) ? describe : describe.skip;
// A tool's result body projects as a `gutter-block` item (the `⎿` connector + body rows), NOT as bare
// `line` items — the first cut of this test filtered `kind === "line"` only and concluded the live Edit
// rendered no diff at all. Flatten both so assertions see what the terminal sees.
const lines = (items: readonly RenderItem[]): RenderLine[] =>
  items.flatMap((i) => (i.kind === "line" ? [(i as { line: RenderLine }).line] : i.kind === "gutter-block" ? [...(i as { body: readonly RenderLine[] }).body] : []));

// Ten short, distinct lines: the edit target sits at a KNOWN position so `cat -n` is the oracle.
const FILE_BODY = Array.from({ length: 10 }, (_, i) => `item number ${String(i + 1).padStart(2, "0")}`).join("\n") + "\n";

live("F4 static transcript (wave-close)", () => {
  it("renders a live markdown reply, a real Edit with absolute numbers + bands, and the frame geometry", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "f4live-"));
    const target = join(cwd, "list.txt");
    writeFileSync(target, FILE_BODY);
    const host = new SessionHost(
      { short: "f4f4f4f4", name: "f4-live", cwd, kind: "interactive", detached: false,
        config: { cwd, model: "claude-sonnet-4-6", permissionMode: "bypassPermissions", settingSources: [], maxTurns: 4 } as never,
        env: { ...process.env, CCX_FLEET_ROOT: mkdtempSync(join(tmpdir(), "ccx-f4live-")) } },
    );
    await host.start();
    try {
      const frames: unknown[] = [];
      host.follow((e: HostEvent) => { if (e.kind === "message") frames.push(e.data); });
      const ctx = { cwd, home: cwd, platform: "darwin" as NodeJS.Platform, columns: 100, now: 0 };
      const doc = () => {
        const d = new TranscriptDocument();
        for (const m of frames) if ((m as any)?.type === "assistant" || (m as any)?.type === "user") d.appendSdk("host", m as Record<string, unknown>);
        return d;
      };

      // A. the markdown-rich reply, straight off the wire into the compact projection.
      await host.runTask([
        "Reply with EXACTLY this markdown and nothing else: a table with header `| name | count |`,",
        "separator, and two data rows (`alpha`/`1`, `beta`/`2`); then a bulleted list with items `one`",
        "and `two`; then a fenced code block tagged `ts` containing the single line `const x = 1;`.",
      ].join(" "));
      const md = lines(projectCompact(doc(), ctx)).map((l) => l.text);
      expect(md.some((t) => t.includes("┌"))).toBe(true);                       // box table drew
      expect(md.some((t) => t.includes("│") && t.includes("alpha"))).toBe(true);
      expect(md.some((t) => /[•-]\s+one|- one/.test(t) || t.trimStart().startsWith("- one"))).toBe(true);
      expect(md.some((t) => t.includes("const x = 1;"))).toBe(true);            // fence body survived

      // B. one real Edit. The oracle: `item number 04` is line 4 of the file on disk.
      frames.length = 0;
      await host.runTask(
        `Use the Edit tool ONCE on ${target}: replace the exact string "item number 04" with "item number FOUR". Then reply DONE.`,
      );
      expect(readFileSync(target, "utf8")).toContain("item number FOUR");       // the edit really landed
      const document = doc();
      const compact = lines(projectCompact(document, ctx));
      const detail = lines(projectDetail(document, { ...ctx, projection: "detail-all" }));
      for (const view of [compact, detail]) {
        const header = view.find((l) => /Added \d+ lines?/.test(l.text) || /Removed \d+ lines?/.test(l.text));
        expect(header, "diff header present").toBeTruthy();
        const banded = view.filter((l) => l.segments?.some((s) => s.bg !== undefined) && /item number/.test(l.text));
        expect(banded.length, "banded diff rows present").toBeGreaterThanOrEqual(2);
        // Absolute numbering: the remove row must carry the on-disk line number 4 (chH pairs the add at 4 too).
        const removeRow = banded.find((l) => l.text.includes("item number 04"))!;
        expect(removeRow, "remove row present").toBeTruthy();
        expect(removeRow.text).toMatch(/^\s*4\s/);                              // matches `cat -n` — and no `~`
        expect(removeRow.text.includes("~")).toBe(false);
      }

      // C. the geometry, SEEN: the Edit's whole gutter-block through the REAL RenderItemView — the ⎿
      // connector and the banded body in one frame, exactly what the terminal composes.
      const editBlock = projectCompact(document, ctx).find(
        (i) => i.kind === "gutter-block" && (i as { body: readonly RenderLine[] }).body.some((l) => /item number/.test(l.text)),
      );
      expect(editBlock, "Edit gutter-block present").toBeTruthy();
      const { lastFrame } = render(<RenderItemView item={editBlock!} />);
      const frame = lastFrame()!;
      expect(frame).toMatch(/\x1b\[48;2;\d+;\d+;\d+m/);                          // bands reach the terminal as bg SGR
      expect(frame).toContain("⎿");                                         // beside the real ⎿ gutter
      console.log(`[f4-live] Edit frame under 100 cols:\n${frame}`);             // the wave-close report quotes this
    } finally {
      await host.stop().catch(() => {});
    }
  }, 300_000);
});
