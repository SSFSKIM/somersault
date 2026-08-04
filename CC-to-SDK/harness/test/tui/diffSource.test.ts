// F4 Task 6: the patch-source ladder. Two branches and one honesty rule — a RECOGNIZED sidecar patch is used
// verbatim with its absolute positions and NEVER re-reads disk (it can only observe state newer than the edit
// it describes); a flat-only Edit is diffed locally and anchored against disk ONLY when the expected content is
// still there exactly once. Everything else numbers approximately and SAYS SO. The counts pin guards the
// rejection recorded at toolSummaries.ts:106-108: a derived count is the CHANGED-line count, never the input's.
import { describe, expect, it, vi } from "vitest";
import { resolvePatch } from "../../src/tui/diffSource.js";

const throwingRead = (): string | undefined => { throw new Error("readFile must not be called in the sidecar branch"); };
const shape = (patch: readonly unknown[]) => ({ filePath: "/work/a.ts", oldString: "old", newString: "new", structuredPatch: patch });
const flat = (rows: readonly { kind: string; text: string }[]) => rows.map((r) => `${r.kind}:${r.text}`);

describe("resolvePatch — branch 1, the recognized sidecar", () => {
  const sidecar = shape([
    { oldStart: 40, oldLines: 4, newStart: 40, newLines: 4, lines: [" ctx", "-gone", "+kept", " tail"] },
    { oldStart: 90, oldLines: 2, newStart: 90, newLines: 3, lines: [" a", "+added", " b"] },
  ]);
  it("maps hunks directly, keeps the absolute starts and never touches disk", () => {
    const patch = resolvePatch({ input: { file_path: "/work/a.ts", old_string: "gone", new_string: "kept" }, sidecar, readFile: throwingRead });
    expect(patch).toBeDefined();
    expect(patch!.numbering).toBe("absolute");
    expect(patch!.hunks.map((h) => h.oldStart)).toEqual([40, 90]);
    expect(flat(patch!.hunks[0]!.rows)).toEqual(["context:ctx", "remove:gone", "add:kept", "context:tail"]);
    expect(flat(patch!.hunks[1]!.rows)).toEqual(["context:a", "add:added", "context:b"]);
  });
  it("counts + and - rows across every hunk (NHH/FHH), not the hunk line spans", () => {
    const patch = resolvePatch({ input: {}, sidecar, readFile: throwingRead })!;
    expect({ added: patch.added, removed: patch.removed }).toEqual({ added: 2, removed: 1 });
  });
  it("numbers approximately rather than confidently when a hunk carries no usable oldStart", () => {
    const patch = resolvePatch({ input: {}, sidecar: shape([{ oldLines: 1, newLines: 1, lines: ["-a", "+b"] }]), readFile: throwingRead })!;
    expect(patch.numbering).toBe("approximate");
    expect(patch.hunks.map((h) => h.oldStart)).toEqual([undefined]);
    expect({ added: patch.added, removed: patch.removed }).toEqual({ added: 1, removed: 1 });
  });
  it("rejects the WHOLE patch on one malformed hunk — exactly what patchLineCounts rejects today", () => {
    const bad = shape([{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: [" ok", 7] }]);
    // No flat input to fall back to ⇒ nothing diffable at all.
    expect(resolvePatch({ input: { file_path: "/work/a.ts" }, sidecar: bad, readFile: throwingRead })).toBeUndefined();
    // With a flat Edit input the ladder falls THROUGH to branch 2 instead of half-reading the bad patch.
    const derived = resolvePatch({ input: { file_path: "/work/a.ts", old_string: "beta", new_string: "BETA" }, sidecar: bad, readFile: () => undefined })!;
    expect(derived.numbering).toBe("approximate");
    expect({ added: derived.added, removed: derived.removed }).toEqual({ added: 1, removed: 1 });
  });
  // The recognition-drift pin. `patchLineCounts` alone is STRICTLY LOOSER than the gate the Edit/Write header
  // runs: toolResult's `editShape`/`writeShape` demand `filePath` plus `oldString`/`newString` (or `content`)
  // BEFORE the counts are taken, so F1 leaves `structured` unset for a bare-`structuredPatch` sidecar and
  // `editRows` emits no diff-summary row for it. Rung 1 must recognize EXACTLY that set — otherwise this module
  // hands out confident absolute line numbers for a call the rest of the clone treats as unrecognized.
  it("gates rung 1 on the editShape/writeShape guard, not on patchLineCounts alone", () => {
    const bare = { structuredPatch: [{ oldStart: 40, oldLines: 1, newStart: 40, newLines: 1, lines: ["-a", "+b"] }] };
    expect(resolvePatch({ input: { command: "ls" }, sidecar: bare, readFile: throwingRead })).toBeUndefined();
    const derived = resolvePatch({ input: { file_path: "/work/a.ts", old_string: "beta", new_string: "BETA" }, sidecar: bare, readFile: () => undefined })!;
    expect(derived.numbering).toBe("approximate");                              // fell THROUGH to rung 2, not absolute-from-sidecar
    expect(derived.hunks.every((h) => h.oldStart === undefined)).toBe(true);
    // A sidecar missing only `newString` is the same miss: half the Edit shape is not the Edit shape.
    const half = { filePath: "/work/a.ts", oldString: "old", structuredPatch: bare.structuredPatch };
    expect(resolvePatch({ input: { file_path: "/work/a.ts" }, sidecar: half, readFile: throwingRead })).toBeUndefined();
  });
});

describe("resolvePatch — branch 2, the derived + disk-anchored Edit", () => {
  const source = "one\ntwo\nalpha\nbeta\ngamma\nseven\n";
  const editInput = () => ({ file_path: "/work/a.ts", old_string: "alpha\nbeta\ngamma", new_string: "alpha\nBETA\ngamma" });
  it("anchors on a UNIQUE disk match and reports absolute numbering", () => {
    const readFile = vi.fn(() => source);
    const patch = resolvePatch({ input: editInput(), sidecar: undefined, readFile })!;
    expect(readFile).toHaveBeenCalledWith("/work/a.ts");
    expect(patch.numbering).toBe("absolute");
    expect(patch.hunks.map((h) => h.oldStart)).toEqual([3]);                    // snippet line 1 IS file line 3
    expect(flat(patch.hunks[0]!.rows)).toEqual(["context:alpha", "remove:beta", "add:BETA", "context:gamma"]);
    expect({ added: patch.added, removed: patch.removed }).toEqual({ added: 1, removed: 1 });
  });
  it("offsets EVERY hunk by the anchor, not just the first", () => {
    const old = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m"].join("\n");
    const next = old.replace("a", "A").replace("m", "M");
    const patch = resolvePatch({ input: { file_path: "/f", old_string: old, new_string: next }, sidecar: undefined, readFile: () => `x\ny\n${old}\n` })!;
    expect(patch.numbering).toBe("absolute");
    expect(patch.hunks.length).toBe(2);
    expect(patch.hunks[0]!.oldStart).toBe(3);                                   // snippet 1 + anchor offset 2
    expect(patch.hunks[1]!.oldStart).toBe(12);                                  // snippet 10 + anchor offset 2
  });
  it("stays approximate when the expected content appears twice (a replace_all edit included)", () => {
    const twice = "alpha\nbeta\ngamma\nfiller\nalpha\nbeta\ngamma\n";
    const patch = resolvePatch({ input: editInput(), sidecar: undefined, readFile: () => twice })!;
    expect(patch.numbering).toBe("approximate");
    expect(patch.hunks.every((h) => h.oldStart === undefined)).toBe(true);
    expect({ added: patch.added, removed: patch.removed }).toEqual({ added: 1, removed: 1 });
  });
  it("stays approximate when the file is missing or has changed under us", () => {
    expect(resolvePatch({ input: editInput(), sidecar: undefined, readFile: () => undefined })!.numbering).toBe("approximate");
    expect(resolvePatch({ input: editInput(), sidecar: undefined, readFile: () => "something\nelse\n" })!.numbering).toBe("approximate");
    expect(resolvePatch({ input: { old_string: "alpha", new_string: "ALPHA" }, sidecar: undefined, readFile: () => source })!.numbering).toBe("approximate");
  });
  it("counts the CHANGED lines, never the input line count (toolSummaries.ts:106-108 stands)", () => {
    const old = "l1\nl2\nl3\nl4\nl5", next = "l1\nl2\nCHANGED\nl4\nl5";
    const patch = resolvePatch({ input: { file_path: "/f", old_string: old, new_string: next }, sidecar: undefined, readFile: () => undefined })!;
    expect({ added: patch.added, removed: patch.removed }).toEqual({ added: 1, removed: 1 });
    expect(patch.hunks.flatMap((h) => h.rows).filter((r) => r.kind !== "context").length).toBe(2);
  });
});

describe("resolvePatch — nothing diffable", () => {
  it("returns undefined for a Write CREATE and never reads disk for it", () => {
    const readFile = vi.fn(() => "x");
    expect(resolvePatch({ input: { file_path: "/work/new.ts", content: "a\nb\n" }, sidecar: undefined, readFile })).toBeUndefined();
    expect(resolvePatch({ input: { file_path: "/work/new.ts", content: "a\nb\n" }, sidecar: { filePath: "/work/new.ts", content: "a\nb\n" }, readFile })).toBeUndefined();
    expect(readFile).not.toHaveBeenCalled();
  });
  it("returns undefined for a non-edit tool input", () => {
    expect(resolvePatch({ input: { command: "ls" }, sidecar: undefined, readFile: throwingRead })).toBeUndefined();
  });
  // The create exclusion is EXPLICIT rather than a consequence of the census shape carrying an empty
  // `structuredPatch` (P94 recorded N=1). A create keeps F3's preview-alone row whatever its patch says.
  it("never routes a Write CREATE sidecar through rung 1 — empty patch or not", () => {
    const create = (patch: readonly unknown[]) => ({ type: "create", filePath: "/work/new.ts", content: "a\nb\n", structuredPatch: patch });
    const input = () => ({ file_path: "/work/new.ts", content: "a\nb\n" });
    expect(resolvePatch({ input: input(), sidecar: create([]), readFile: throwingRead })).toBeUndefined();
    expect(resolvePatch({ input: input(), sidecar: create([{ oldStart: 1, oldLines: 0, newStart: 1, newLines: 2, lines: ["+a", "+b"] }]), readFile: throwingRead })).toBeUndefined();
  });
  // A RECOGNIZED patch that describes no change is answered by rung 1 — with `undefined`. It does NOT fall
  // through to the derived rung: the sidecar is the better description of the edit, and it says nothing moved.
  it("returns undefined for a recognized sidecar whose structuredPatch is empty", () => {
    expect(resolvePatch({ input: { file_path: "/work/a.ts" }, sidecar: shape([]), readFile: throwingRead })).toBeUndefined();
    expect(resolvePatch({ input: { file_path: "/work/a.ts", old_string: "beta", new_string: "BETA" }, sidecar: shape([]), readFile: throwingRead })).toBeUndefined();
  });
  // `input` is unknown-typed tool input at the call site; a non-record must be answered, not thrown on. The
  // guard runs BEFORE the memo (a primitive is not a legal WeakMap key), so it precedes rung 1 too.
  it("returns undefined for a non-record input instead of throwing", () => {
    expect(resolvePatch({ input: undefined as never, sidecar: undefined, readFile: throwingRead })).toBeUndefined();
    expect(resolvePatch({ input: "not an object" as never, sidecar: undefined, readFile: throwingRead })).toBeUndefined();
    expect(resolvePatch({ input: undefined as never, sidecar: shape([{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ["-a", "+b"] }]), readFile: throwingRead })).toBeUndefined();
  });
});

describe("resolvePatch — memoized per event, not per repaint", () => {
  it("resolves ONCE across five projections of the same retained call", () => {
    const readFile = vi.fn(() => "one\ntwo\nalpha\nbeta\ngamma\n");
    const input = { file_path: "/work/a.ts", old_string: "beta", new_string: "BETA" };   // the retained call's input object
    const patches = Array.from({ length: 5 }, () => resolvePatch({ input, sidecar: undefined, readFile }));
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(patches.every((p) => p === patches[0])).toBe(true);
    expect(patches[0]!.numbering).toBe("absolute");
  });
  it("re-resolves when a LATER richer sidecar lands on the same retained call (transcriptModel's in-place upgrade)", () => {
    const input = { file_path: "/work/a.ts", old_string: "beta", new_string: "BETA" };
    const before = resolvePatch({ input, sidecar: undefined, readFile: () => undefined })!;
    expect(before.numbering).toBe("approximate");
    const after = resolvePatch({ input, sidecar: shape([{ oldStart: 77, oldLines: 1, newStart: 77, newLines: 1, lines: ["-beta", "+BETA"] }]), readFile: throwingRead })!;
    expect(after.numbering).toBe("absolute");
    expect(after.hunks[0]!.oldStart).toBe(77);
  });
});
