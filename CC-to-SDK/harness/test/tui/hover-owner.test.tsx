// test/tui/hover-owner.test.tsx — F10 T-HOVER H1: the producer matrix.
//
// Canon's hover unit is one whole SDK message (`K6w` L562778-562784, one `hoveredKey` at L563004) — coarser
// than ccx's per-line/per-call `RenderItem.id`, not finer. `RenderItem.ownerKey` is the field that makes the
// PAINTED unit a message: producers mint it beside `id`, and hover compares `ownerKey ?? sourceId(id)`.
//
// `ownerKey` is OPTIONAL at the type level (a non-transcript caller — a dialog, the markdown renderer,
// PlanDialog — legitimately is its own hover unit), which is a type-level accommodation, not a rollout
// license. THIS FILE IS WHAT HOLDS THAT: every species a transcript producer emits gets its own cell below,
// and a producer that regresses to the `sourceId(id)` fallback fails a cell here, not just a typecheck.
//
// Two shapes of cell: a PURE projection cell (most of them) that drives `projectDetail`/`projectCompact`/
// `projectPending` (toolRenderer.tsx), `streamingItems`/`queuedTranscriptItems` directly and inspects the
// `RenderItem[]` they hand back; and a MOUNTED cell (n) that drives the real `FullscreenViewport` and proves
// the wiring reaches the painted `HitRow`s an actual mouse gesture would read.
import React from "react";
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import {
  projectCompact, projectDetail, projectPending, sdkOwnerKey, localOwnerKey, toolOwnerKey, groupOwnerKey,
  agentBatchOwnerKey, streamOwnerKey, queuedOwnerKey, type ProjectionContext, type RenderItem,
} from "../../src/tui/toolRenderer.js";
import { wrapItemsToWidth, sourceId } from "../../src/tui/wrapItems.js";
import { streamingItems } from "../../src/tui/streamingItems.js";
import { queuedTranscriptItems } from "../../src/tui/ChatApp.js";
import { FullscreenViewport, type ViewportHitmap } from "../../src/tui/FullscreenViewport.js";
import { FullscreenFrame } from "../../src/tui/FullscreenFrame.js";
import { LiveTurn } from "../../src/tui/liveTurn.js";
import { TranscriptDocument } from "../../src/tui/transcriptModel.js";
import type { QueueEntry } from "../../src/tui/queue.js";
import type { RenderLine } from "../../src/tui/render.js";
import { tick } from "./keysTestUtil.js";

// ── fixtures, mirroring toolRenderer.test.tsx's own (this file duplicates them rather than importing test
// code from another test file, matching every other test in this suite) ───────────────────────────────────
const call = (id: string, name: string, input: unknown, messageId = `m-${id}`) =>
  ({ type: "assistant", parent_tool_use_id: null, message: { id: messageId, content: [{ type: "tool_use", id, name, input }] } }) as Record<string, unknown>;
const result = (id: string, content = "body", isError = false) =>
  ({ type: "user", uuid: `u-${id}`, message: { content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }] } }) as Record<string, unknown>;
const prose = (text: string, id = `t-${text.slice(0, 6)}`) =>
  ({ type: "assistant", parent_tool_use_id: null, message: { id, content: [{ type: "text", text }] } }) as Record<string, unknown>;
const agents = (specs: readonly { id: string; description?: string }[]) =>
  ({ type: "assistant", parent_tool_use_id: null, message: { id: `m-${specs.map((s) => s.id).join("-")}`, content: specs.map((s) => ({ type: "tool_use", id: s.id, name: "Agent", input: { description: s.description ?? `do ${s.id}`, prompt: "p" } })) } }) as Record<string, unknown>;
const settleAgent = (id: string) =>
  ({ type: "user", uuid: `ur-${id}`, message: { content: [{ type: "tool_result", tool_use_id: id, content: "the report", is_error: false }] } }) as Record<string, unknown>;
/** Flattens one level, so `doc([agentBatchOf([...])])` (a fixture that stands for SEVERAL messages) reads
 *  exactly as the spec's own pseudocode. */
const doc = (messages: readonly (Record<string, unknown> | readonly Record<string, unknown>[])[]): TranscriptDocument => {
  const d = new TranscriptDocument();
  for (const m of messages.flat()) d.appendSdk("host", m as Record<string, unknown>);
  return d;
};
const agentBatchOf = (ids: readonly string[]): readonly Record<string, unknown>[] =>
  [agents(ids.map((id) => ({ id }))), ...ids.map((id) => settleAgent(id))];
const ctx = (over: Partial<ProjectionContext> = {}): ProjectionContext & { projection: "detail-all" | "detail-collapsed" } =>
  ({ cwd: "/work", home: "/home/me", platform: "darwin" as NodeJS.Platform, columns: 100, now: 0, projection: "detail-collapsed", ...over });

const ownersOf = (items: readonly RenderItem[]) => items.map((i) => i.ownerKey ?? sourceId(i.id));
const distinct = (xs: readonly string[]) => new Set(xs).size;
let qSeq = 0;
const qe = (value: string): QueueEntry => ({ id: `t${qSeq++}`, value, mode: "prompt" as const, priority: "now" as const, origin: "user" as const });

describe("H1 producer matrix — every transcript species mints ONE ownerKey per message/call", () => {
  // (a) SDK multiline message — sdkItemId(id, "block:<i>:<line>"), toolRenderer.tsx's projectMessageEntry.
  it("every line of one multi-line assistant message shares ONE ownerKey", () => {
    const items = projectDetail(doc([prose("alpha\nbeta\ngamma", "a")]), ctx());
    expect(items.length).toBeGreaterThan(2);                          // premise: it really is multi-line
    expect(distinct(ownersOf(items))).toBe(1);
    expect(distinct(items.map((i) => i.id))).toBe(items.length);      // …and the IDs are still per line
    expect(items[0]!.ownerKey).toBe(sdkOwnerKey("message:a"));
  });

  // (b) adjacent messages are DISTINCT
  it("two adjacent messages never share an ownerKey", () => {
    const items = projectDetail(doc([prose("alpha\nbeta", "a"), prose("gamma\ndelta", "b")]), ctx());
    expect(distinct(ownersOf(items))).toBe(2);
  });

  // (c) local event — localItemId(entry.identity, <line>), toolRenderer.tsx's projectLocalEvent.
  it("every line of one multi-line local event shares ONE ownerKey", () => {
    const d = new TranscriptDocument();
    d.appendLocal({ kind: "visual", lines: [{ text: "one" }, { text: "two" }, { text: "three" }] }, "local-1");
    const items = projectDetail(d, ctx());
    expect(items).toHaveLength(3);
    expect(distinct(ownersOf(items))).toBe(1);
    expect(items[0]!.ownerKey).toBe(localOwnerKey("local-1"));
  });

  // (d) gutter block — `${event.id}:result`, grouped WITH its `:call` header.
  it("a tool call's header line and its result gutter-block share ONE ownerKey", () => {
    const items = projectDetail(doc([call("read-1", "Read", { file_path: "/work/a.ts" }), result("read-1", "one\ntwo")]), ctx());
    const header = items.find((i) => i.kind === "line")!;
    const body = items.find((i) => i.kind === "gutter-block")!;
    expect(header.ownerKey).toBeDefined();
    expect(header.ownerKey).toBe(body.ownerKey);
  });

  // (e) wrapped rows — wrapItemsToWidth at a narrow width: every `#wN` fragment keeps the owner.
  it("every wrap fragment of an over-wide row keeps its source item's ownerKey", () => {
    const items = projectDetail(doc([prose("word ".repeat(30), "a")]), ctx());
    const wrapped = wrapItemsToWidth(items, 10);
    expect(wrapped.length).toBeGreaterThan(items.length);              // premise: something really wrapped
    const bySource = new Map<string, Set<string | undefined>>();
    for (const w of wrapped) {
      const src = sourceId(w.id);
      if (!bySource.has(src)) bySource.set(src, new Set());
      bySource.get(src)!.add(w.ownerKey);
    }
    for (const owners of bySource.values()) expect(owners.size).toBe(1);
  });

  // (f) pending vs settled — the pending projection of an open call, then the settled one: each internally
  //     grouped, and the two NOT equal to each other.
  it("an open call's pending owner and its settled owner are each internally grouped and mutually distinct", () => {
    const pendingItems = projectPending(doc([call("read-1", "Read", { file_path: "/work/a.ts" })]), ctx());
    expect(distinct(ownersOf(pendingItems))).toBe(1);
    const settledItems = projectDetail(doc([call("read-1", "Read", { file_path: "/work/a.ts" }), result("read-1")]), ctx());
    expect(distinct(ownersOf(settledItems))).toBe(1);
    expect(pendingItems[0]!.ownerKey).not.toBe(settledItems[0]!.ownerKey);
  });

  // (g) every reid part — header + body + part:<n> of one Agent unit share one ownerKey.
  it("every reid part of one Agent unit shares one ownerKey: header, nested header, and nested body", () => {
    const child = { type: "assistant", parent_tool_use_id: "ag-1", message: { id: "mc-1", content: [{ type: "tool_use", id: "c-1", name: "Read", input: { file_path: "/work/a.ts" } }] } } as Record<string, unknown>;
    const childResult = { type: "user", uuid: "ur-c1", message: { content: [{ type: "tool_result", tool_use_id: "c-1", content: "x", is_error: false }] } } as Record<string, unknown>;
    const d = doc([call("ag-1", "Agent", { description: "do work", prompt: "p" }), child, childResult, settleAgent("ag-1")]);
    const items = projectDetail(d, { ...ctx(), projection: "detail-all" });
    expect(items.length).toBeGreaterThan(2);
    expect(distinct(ownersOf(items))).toBe(1);
  });

  // (h) fold group — the collapsed group row and its `pending-hint` gutter block share one owner.
  it("an active fold group's row and its pending-hint gutter-block share ONE ownerKey", () => {
    const items = projectPending(doc([call("read-1", "Read", { file_path: "src/app.ts" })]), ctx());
    expect(items).toHaveLength(2);
    expect(items[0]!.id).toBe("group:read-1:pending-row");
    expect(items[1]!.id).toBe("group:read-1:pending-hint");
    expect(distinct(ownersOf(items))).toBe(1);
    expect(items[0]!.ownerKey).toBe(groupOwnerKey(["read-1"]));
  });

  // (k) AGENT BATCH — the unit here is the MEMBER, not the batch.
  it("each agent-batch member owns its row and its ⎿ status row; the header is its own unit", () => {
    const items = projectCompact(doc([agentBatchOf(["t1", "t2", "t3"])]), ctx());
    const owners = ownersOf(items);
    expect(distinct(owners)).toBe(4);                                              // header + three members
    expect(owners.filter((o) => o === toolOwnerKey("t2")).length).toBe(2);         // row + status
    expect(owners[0]).toBe(agentBatchOwnerKey(["t1", "t2", "t3"], "published"));
  });
  it("the PENDING copy of a batch shares no owner with the published one", () => {
    const ids = ["t1", "t2", "t3"];
    const pendingOwners = new Set(ownersOf(projectPending(doc([agents(ids.map((id) => ({ id })))]), ctx())));
    const publishedOwners = new Set(ownersOf(projectCompact(doc([agentBatchOf(ids)]), ctx())));
    expect(pendingOwners.size).toBeGreaterThan(0);
    for (const o of pendingOwners) expect(publishedOwners.has(o)).toBe(false);
  });

  // (l) LIVE STREAMING — streamingItems.ts, THE REAL TIER.
  it("every line and every wrap fragment of the in-flight message shares ONE ownerKey", () => {
    const rows = streamingItems([{ text: "alpha" }, { text: "b".repeat(200) }, { text: "gamma" }], 40, streamOwnerKey("msg_01"));
    expect(rows.length).toBeGreaterThan(3);                                        // premise: row 2 really wrapped
    expect(distinct(ownersOf(rows))).toBe(1);
    expect(rows[0]!.ownerKey).toBe("stream:msg_01");
    expect(distinct(rows.map((r) => r.id))).toBe(rows.length);                     // ids still per row
  });
  it("two successive in-flight messages are distinct units", () => {
    expect(streamingItems([{ text: "a" }], 40, streamOwnerKey("msg_01"))[0]!.ownerKey)
      .not.toBe(streamingItems([{ text: "a" }], 40, streamOwnerKey("msg_02"))[0]!.ownerKey);
  });
  it("LiveTurn.messageKey() changes on message_start and never returns undefined", () => {
    const lt = new LiveTurn();
    lt.ingest({ type: "stream_event", event: { type: "message_start", message: { id: "msg_abc" } } });
    const withId = lt.messageKey();
    expect(withId).toBe("msg_abc");
    lt.ingest({ type: "stream_event", event: { type: "message_start" } });         // no message.id this time
    const withoutId = lt.messageKey();
    expect(withoutId).toBeTypeOf("string");
    expect(withoutId).not.toBe(withId);
  });

  // (m) QUEUED PROMPTS — ChatApp.tsx's queuedTranscriptItems.
  it("a multi-line queued prompt is ONE hover unit and two entries are two", () => {
    const entries = [qe("alpha\nbeta\ngamma"), qe("delta")];
    const items = queuedTranscriptItems(entries, 40, "  ");
    expect(distinct(ownersOf(items))).toBe(2);
    const firstEntryOwners = new Set(items.filter((i) => i.id.startsWith(`queued:${entries[0]!.id}:`)).map((i) => i.ownerKey));
    expect(firstEntryOwners.size).toBe(1);
    expect([...firstEntryOwners][0]).toBe(queuedOwnerKey(entries[0]!.id));
  });

  // (m2) THE DRAIN DOES NOT MOVE A HOVER (r3).
  it("draining the hovered head entry retires its ownerKey rather than handing it to the next", () => {
    const entries = [qe("alpha"), qe("beta")];
    const before = queuedTranscriptItems(entries, 40, "  ");
    const held = before[0]!.ownerKey!;                                            // the pointer is on "alpha"
    expect(ownersOf(before)).toContain(held);
    const after = queuedTranscriptItems(entries.slice(1), 40, "  ");
    expect(ownersOf(after)).not.toContain(held);                                  // the key retired with its prompt
    expect(new Set(ownersOf(after)).size).toBe(1);
    expect(ownersOf(after)[0]).toBe(before.at(-1)!.ownerKey);                     // …and beta kept ITS own
  });
  it("a removal from the MIDDLE leaves the survivors' owners untouched", () => {
    const three = [qe("a"), qe("b"), qe("c")];
    const owners = (es: readonly QueueEntry[]) => new Set(ownersOf(queuedTranscriptItems(es, 40, "  ")));
    const all = owners(three), kept = owners([three[0]!, three[2]!]);
    expect([...kept].every((o) => all.has(o))).toBe(true);
    expect(kept.size).toBe(2);
  });
});

// T-CLICKGATE Task 1 — `clickable` is minted exactly on canon's two kinds: an ERROR result whose body was
// physically clipped, or a non-error result the fold actually hid rows from. Every other species — a short
// result of either kind, a fold-group row, plain assistant text — carries no `clickable` field at all.
describe("T-CLICKGATE Task 1: clickable is minted exactly on canon's kinds", () => {
  const gutterBlockOf = (items: readonly RenderItem[]) => items.find((i) => i.kind === "gutter-block")!;
  const errorLines = (n: number) => Array.from({ length: n }, (_, i) => `err line ${i + 1}`).join("\n");
  const foldableLines = (n: number) => Array.from({ length: n }, (_, i) => `out line ${i + 1}`).join("\n");

  it("(a) an error result of 12 physical lines clips at ten, and the clipped block is clickable", () => {
    const items = projectDetail(doc([call("e-1", "Mystery", {}), result("e-1", errorLines(12), true)]), ctx());
    expect(gutterBlockOf(items).clickable).toBe(true);
  });

  it("(b) an error result of 3 physical lines never clips, and carries no clickable field", () => {
    const items = projectDetail(doc([call("e-2", "Mystery", {}), result("e-2", errorLines(3), true)]), ctx());
    expect(gutterBlockOf(items).clickable).toBeUndefined();
  });

  it("(c) an ordinary result long enough for the fold to hide rows is clickable", () => {
    const items = projectDetail(doc([call("r-1", "Mystery", {}), result("r-1", foldableLines(6), false)]), ctx());
    expect(gutterBlockOf(items).clickable).toBe(true);
  });

  it("(d) a short ordinary result the fold never truncates carries no clickable field", () => {
    const items = projectDetail(doc([call("r-2", "Mystery", {}), result("r-2", foldableLines(2), false)]), ctx());
    expect(gutterBlockOf(items).clickable).toBeUndefined();
  });

  it("(e) a fold-group's own collapsed row never carries clickable", () => {
    const items = projectPending(doc([call("read-1", "Read", { file_path: "src/app.ts" })]), ctx());
    const groupRow = items.find((i) => i.id === "group:read-1:pending-row")!;
    expect(groupRow.clickable).toBeUndefined();
  });

  it("(f) plain assistant text never carries clickable", () => {
    const items = projectDetail(doc([prose("just some prose", "t-prose")]), ctx());
    for (const item of items) expect(item.clickable).toBeUndefined();
  });

  // (g)/(h) FIX WAVE (external review): the predicate is PROJECTION-INDEPENDENT — computed as if the result
  // were folded under COMPACT, never from the projection actually being rendered. `detail-all` folds nothing
  // at all (it is the one unbounded projection), so a bit derived from the live fold would read `false` on
  // exactly the row a later collapse-click needs to find clickable. Same fixtures as (a)/(c), rendered at
  // `detail-all` instead of the default `detail-collapsed`.
  it("(g) an ordinary result that would fold under compact stays clickable even rendered at detail-all", () => {
    const items = projectDetail(doc([call("r-3", "Mystery", {}), result("r-3", foldableLines(6), false)]), { ...ctx(), projection: "detail-all" });
    expect(gutterBlockOf(items).clickable).toBe(true);
  });

  it("(h) a >10-line error stays clickable even rendered at detail-all, where the clip never triggers", () => {
    const items = projectDetail(doc([call("e-3", "Mystery", {}), result("e-3", errorLines(12), true)]), { ...ctx(), projection: "detail-all" });
    expect(gutterBlockOf(items).clickable).toBe(true);
  });

  // (i)/(j)/(k) FIX WAVE: TYPED successful results fold too — Bash's stdout/stderr fold inside its own
  // `toolSummaries.bashRows` composition (F3's typed-row layer), not through `resultBody`'s generic fold, so
  // a long successful Bash result needs its OWN truncation bit threaded up to the same mint site. No sidecar
  // on `result()` here: `bashRows` falls back to the flat result text as stdout when no structured sidecar is
  // present, same as every other flat-only Bash call in the census.
  it("(i) a long successful Bash-style result carries clickable on its typed row", () => {
    const items = projectDetail(doc([call("b-1", "Bash", { command: "seq 6" }), result("b-1", foldableLines(6), false)]), ctx());
    expect(gutterBlockOf(items).clickable).toBe(true);
  });

  it("(j) a short successful Bash-style result carries no clickable field", () => {
    const items = projectDetail(doc([call("b-2", "Bash", { command: "echo hi" }), result("b-2", foldableLines(2), false)]), ctx());
    expect(gutterBlockOf(items).clickable).toBeUndefined();
  });

  it("(k) a long successful Bash-style result stays clickable even rendered at detail-all", () => {
    const items = projectDetail(doc([call("b-3", "Bash", { command: "seq 6" }), result("b-3", foldableLines(6), false)]), { ...ctx(), projection: "detail-all" });
    expect(gutterBlockOf(items).clickable).toBe(true);
  });
});

// (i) NOTHING ESCAPES — one document exercising several species at once, across ALL FOUR TIERS.
describe("H1: nothing reaches the renderer without an ownerKey", () => {
  it("every RenderItem of every tier carries an ownerKey", () => {
    const EVERY_SPECIES_DOC = doc([
      prose("intro line", "t-intro"),
      call("read-1", "Read", { file_path: "/work/a.ts" }), result("read-1", "body"),
      agentBatchOf(["ag-1", "ag-2"]),
      prose("outro line", "t-outro"),
    ]);
    EVERY_SPECIES_DOC.appendLocal({ kind: "visual", lines: [{ text: "a local note" }] }, "local-note");
    const STREAM_LINES: readonly RenderLine[] = [{ text: "streaming line" }];
    const QUEUE_FIXTURE = [qe("queued one"), qe("queued two")];
    const tiers: (readonly RenderItem[])[] = [
      projectCompact(EVERY_SPECIES_DOC, ctx()),
      projectDetail(EVERY_SPECIES_DOC, ctx()),
      projectPending(EVERY_SPECIES_DOC, ctx()),
      streamingItems(STREAM_LINES, 80, streamOwnerKey("msg_01")),
      queuedTranscriptItems(QUEUE_FIXTURE, 80, "  "),
    ];
    for (const tier of tiers)
      for (const item of tier)
        expect(item.ownerKey, `${item.id} reached the renderer with no ownerKey`).toBeTypeOf("string");
  });

  // (j) THE NEXT PRODUCER — a source-shape guard: every `kind: "line"` / `kind: "gutter-block"` object
  // literal in any of the three producer files must carry `ownerKey` on the same line, or an explicit
  // `/* ownerKey: inherited */` marker (the spread-through sites).
  const PRODUCER_FILES = ["toolRenderer.tsx", "streamingItems.ts", "ChatApp.tsx"] as const;
  it.each(PRODUCER_FILES)("every RenderItem literal in %s mints an ownerKey", (file) => {
    const src = readFileSync(new URL(`../../src/tui/${file}`, import.meta.url), "utf8");
    const offenders = src.split("\n")
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => /kind: ("line"|"gutter-block")( as const)?[;,]/.test(line))
      .filter(({ line }) => !line.includes("ownerKey") && !line.includes("/* ownerKey: inherited */"));
    expect(offenders.map((o) => `${o.n}: ${o.line.trim()}`)).toEqual([]);
  });
});

// (n) THE REAL VIEWPORT, ALL FOUR TIERS. Not a synthetic fixture and not `hitRowsOf` in isolation: mount
// `FullscreenViewport`, publish through `hitmapRef`, and drive `hoverAt` directly (an imperative call, the
// same shape a mouse sink makes) — proving the painted `HitRow`s the real component builds group by owner,
// not by item id, for every tier at once.
describe("H1: the real FullscreenViewport groups every tier by owner", () => {
  it("the painted hitmap groups finalized, pending, streaming, and queued rows by message", async () => {
    const finalizedItems: readonly RenderItem[] = [
      { kind: "line", id: "sdk:msgA:block:0:0", ownerKey: sdkOwnerKey("msgA"), line: { text: "final-alpha", dim: true } },
      { kind: "line", id: "sdk:msgA:block:0:1", ownerKey: sdkOwnerKey("msgA"), line: { text: "final-beta", dim: true } },
    ];
    const pendingItems: readonly RenderItem[] = [
      { kind: "line", id: "tool:p1:pending:header", ownerKey: toolOwnerKey("p1", "pending"), line: { text: "pending-row", dim: true } },
    ];
    const streaming: readonly RenderLine[] = [{ text: "stream-one", dim: true }, { text: "stream-two", dim: true }, { text: "stream-three", dim: true }];
    const queuedItems: readonly RenderItem[] = [
      { kind: "line", id: "queued:q0:0", ownerKey: queuedOwnerKey("q0"), line: { text: "queued-a", dim: true } },
      { kind: "line", id: "queued:q1:0", ownerKey: queuedOwnerKey("q1"), line: { text: "queued-b", dim: true } },
    ];
    const ref: { current: ViewportHitmap | null } = { current: null };
    // Wrapped in the REAL `FullscreenFrame`, not mounted bare: `hoverAt` gates on `regionTop > 0`
    // (the renderer-gate, `FullscreenViewport.tsx`'s own header) and a bare mount publishes no origin.
    const r = render(
      <FullscreenFrame rows={24} dock={null}
        regionChildren={<FullscreenViewport finalizedItems={finalizedItems} pendingItems={pendingItems}
          streaming={streaming} streamOwnerKey={streamOwnerKey("msg_01")} queuedItems={queuedItems}
          columns={80} hitmapRef={ref} />} />,
    );
    await tick(); await tick(); await tick();

    const lines = () => (r.lastFrame() ?? "").split("\n");
    const rowOf = (needle: string): number => {
      const at = lines().findIndex((l) => l.includes(needle));
      expect(at, `"${needle}" not painted:\n${r.lastFrame()}`).toBeGreaterThanOrEqual(0);
      return at + 1;
    };
    const dimAt = (needle: string): boolean => (lines().find((l) => l.includes(needle)) ?? "").includes("\x1b[2m");

    // premise: everything painted dim before any hover.
    for (const needle of ["final-alpha", "final-beta", "pending-row", "stream-one", "stream-two", "stream-three", "queued-a", "queued-b"])
      expect(dimAt(needle), `${needle} not dim before hover`).toBe(true);

    ref.current!.hoverAt(1, rowOf("stream-two"));
    await tick(); await tick(); await tick();
    expect(dimAt("stream-one")).toBe(false);
    expect(dimAt("stream-two")).toBe(false);
    expect(dimAt("stream-three")).toBe(false);
    for (const needle of ["final-alpha", "final-beta", "pending-row", "queued-a", "queued-b"])
      expect(dimAt(needle), `${needle} un-dimmed by an unrelated hover`).toBe(true);

    ref.current!.hoverAt(1, rowOf("queued-a"));
    await tick(); await tick(); await tick();
    expect(dimAt("queued-a")).toBe(false);
    expect(dimAt("queued-b")).toBe(true);        // distinct owner PER queued entry — no cross-entry grouping
    for (const needle of ["final-alpha", "final-beta", "pending-row", "stream-one", "stream-two", "stream-three"])
      expect(dimAt(needle)).toBe(true);

    r.unmount();
  });
});
