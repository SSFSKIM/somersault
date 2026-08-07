// test/unit/rewind-rebuild.test.ts — EP-S1's pure arithmetic: cut the reader's rows at the anchor the host
// resumed at. The rebuild used to render whatever `getSessionMessages` returned AT REBUILD TIME, which is
// still the PRE-rewind chain (the row that moves the leaf onto the new branch is not written until the next
// turn) — so the transcript replayed turns the model no longer holds.
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { truncateAtAnchor } from "../../src/tui/rewindRebuild.js";

const row = (uuid: string, type = "user") => ({ uuid, type, message: { content: uuid } });

describe("truncateAtAnchor", () => {
  it("cuts the reader's rows AFTER the anchor's prevUuid, inclusive", () => {
    const rows = [row("u1"), row("a1", "assistant"), row("u2"), row("a2", "assistant")];
    expect(truncateAtAnchor(rows, "a1").map((r) => r.uuid)).toEqual(["u1", "a1"]);
  });

  it("returns the rows unchanged when there is no anchor", () => {
    const rows = [row("u1"), row("a1", "assistant")];
    expect(truncateAtAnchor(rows, null).map((r) => r.uuid)).toEqual(["u1", "a1"]);
    expect(truncateAtAnchor(rows, undefined).map((r) => r.uuid)).toEqual(["u1", "a1"]);
  });

  // A2's hazard, stated as arithmetic: the cut can only ever REMOVE rows the reader returned. It has no
  // way to reach a row the reader dropped, which is what a hand-rolled parentUuid walk would do across a
  // compaction boundary.
  it("never returns a row the reader did not return", () => {
    const rows = [row("compact-summary"), row("u9"), row("a9", "assistant")];
    const out = truncateAtAnchor(rows, "pre-boundary-uuid-the-reader-dropped");
    expect(out.map((r) => r.uuid)).toEqual(["compact-summary", "u9", "a9"]);
    expect(out.every((r) => rows.includes(r))).toBe(true);
  });

  it("keeps a compaction summary row that precedes the anchor", () => {
    const rows = [row("compact-summary"), row("u9"), row("a9", "assistant"), row("u10")];
    expect(truncateAtAnchor(rows, "a9").map((r) => r.uuid)).toEqual(["compact-summary", "u9", "a9"]);
  });

  it("does not mutate its input", () => {
    const rows = [row("u1"), row("a1", "assistant"), row("u2")];
    truncateAtAnchor(rows, "a1");
    expect(rows).toHaveLength(3);
  });

  // W-S1's hazard, encoded so it cannot come back. `getSessionMessages` strips `parentUuid` and performs
  // compaction relinking through `compactMetadata.preservedMessages`; a hand-rolled walk over the returned
  // rows would both fail (the field is absent) and, if someone re-parsed the raw JSONL to get it back,
  // resurrect pre-boundary turns the model no longer holds. If this test fails, read W-S1 before "fixing"
  // it — three earlier attempts at this defect went the other way.
  it("no rewind-replay code reads parentUuid", async () => {
    for (const f of ["src/tui/rewindRebuild.ts", "src/tui/useChat.ts", "src/sessions/rows.ts"])
      expect(await readFile(new URL(`../../${f}`, import.meta.url), "utf8")).not.toMatch(/parentUuid/);
  });
});
