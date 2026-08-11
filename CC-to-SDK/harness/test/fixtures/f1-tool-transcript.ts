// F1 tool-transcript fixtures — exact 0.3.220 message/sidecar shapes taken from the P94 census
// (docs/superpowers/research/2026-07-31-tui-clone/07-p94-tool-census.md). Structural only: no counts or
// frequencies are copied from that report, because sidecar presence is per call, never per tool or session.
export const UPSTREAM_READ_PROMPT = { type: "user", parent_tool_use_id: null, uuid: "user-upstream-prompt", message: { role: "user", content: "Use the Read tool to read src/app.ts, then stop without adding an assistant response." } } as const;
export const READ_CALL = { type: "assistant", parent_tool_use_id: null, message: { id: "assistant-1", content: [{ type: "tool_use", id: "read-1", name: "Read", input: { file_path: "/work/src/app.ts" } }] } } as const;
export const READ_RESULT_WITH_SIDECAR = { type: "user", parent_tool_use_id: null, uuid: "user-result-1", message: { content: [{ type: "tool_result", tool_use_id: "read-1", content: "export const app = 1;\n", is_error: false }] }, tool_use_result: { type: "read", file: { filePath: "/work/src/app.ts", content: "export const app = 1;\n", numLines: 41, startLine: 1, totalLines: 41 } } } as const;
export const READ_RESULT_UPSTREAM = { type: "user", parent_tool_use_id: null, uuid: "user-result-upstream", message: { content: [{ type: "tool_result", tool_use_id: "read-1", content: "export const app = 1;\n", is_error: false }] }, tool_use_result: { type: "read", file: { filePath: "/work/src/app.ts", content: "export const app = 1;\n", numLines: 1, startLine: 1, totalLines: 1 } } } as const;
export const READ_RESULT_FLAT = { type: "user", parent_tool_use_id: null, uuid: "user-result-2", message: { content: [{ type: "tool_result", tool_use_id: "read-1", content: "one\ntwo\nthree", is_error: false }] } } as const;
export const AMBIGUOUS_SIDECAR_RESULT = { type: "user", parent_tool_use_id: null, message: { content: [{ type: "tool_result", tool_use_id: "read-1", content: "one", is_error: false }, { type: "tool_result", tool_use_id: "other-1", content: "two", is_error: false }] }, tool_use_result: { type: "read", file: { numLines: 2 } } } as const;
export const DUPLICATE_READ_CALL = { type: "assistant", parent_tool_use_id: null, message: { id: "assistant-duplicate", content: [{ type: "tool_use", id: "read-1", name: "Read", input: { file_path: "/work/src/copy.ts" } }] } } as const;
export const NESTED_READ_CALL = { type: "assistant", parent_tool_use_id: "agent-1", message: { id: "assistant-nested", content: [{ type: "tool_use", id: "nested-read-1", name: "Read", input: { file_path: "/work/agent.ts" } }] } } as const;
export const WRITE_CALL = { type: "assistant", parent_tool_use_id: null, message: { id: "assistant-write", content: [{ type: "tool_use", id: "write-1", name: "Write", input: { file_path: "/work/note.md", content: "one\ntwo\nthree" } }] } } as const;
export const WRITE_RESULT_WITH_SIDECAR = { type: "user", parent_tool_use_id: null, uuid: "user-write", message: { content: [{ type: "tool_result", tool_use_id: "write-1", content: "Created /work/note.md" }] }, tool_use_result: { type: "create", filePath: "/work/note.md", content: "one\ntwo\nthree", originalFile: null, structuredPatch: [], userModified: false } } as const;
export const EDIT_CALL = { type: "assistant", parent_tool_use_id: null, message: { id: "assistant-edit", content: [{ type: "tool_use", id: "edit-1", name: "Edit", input: { file_path: "/work/a.ts", old_string: "old", new_string: "new" } }] } } as const;
export const EDIT_RESULT_WITH_SIDECAR = { type: "user", parent_tool_use_id: null, uuid: "user-edit", message: { content: [{ type: "tool_result", tool_use_id: "edit-1", content: "Updated /work/a.ts" }] }, tool_use_result: { filePath: "/work/a.ts", oldString: "old", newString: "new", originalFile: "old", replaceAll: false, userModified: false, structuredPatch: [{ oldStart: 7, oldLines: 1, newStart: 7, newLines: 1, lines: ["-old", "+new"] }] } } as const;
export const BASH_CALL = { type: "assistant", parent_tool_use_id: null, message: { id: "assistant-bash", content: [{ type: "tool_use", id: "bash-1", name: "Bash", input: { command: "printf ok" } }] } } as const;
export const BASH_RESULT_WITH_SIDECAR = { type: "user", parent_tool_use_id: null, uuid: "user-bash", message: { content: [{ type: "tool_result", tool_use_id: "bash-1", content: "ok" }] }, tool_use_result: { stdout: "ok", stderr: "", interrupted: false, noOutputExpected: false, isImage: false, returnCodeInterpretation: "fixture-status" } } as const;

// ── The capture entry's argv grammar ───────────────────────────────────────────────────────────────────
// Kept in THIS module, not in `f1-tool-transcript-frame.tsx`, because importing that file mounts Ink — a
// pure parser here is the unit-testable seam. Neither axis may fall back to a default: the capture's whole
// value is a live-vs-replay (or sidecar-vs-flat) diff, so a typo like `liv` silently selecting `replay`
// would compare replay against replay and report a vacuous "clean".
export const FRAME_ROUTES = ["live", "replay"] as const;
export const FRAME_SHAPES = ["sidecar", "flat", "upstream"] as const;
export type FrameRoute = (typeof FRAME_ROUTES)[number];
export type FrameShape = (typeof FRAME_SHAPES)[number];
export type FrameArgs = { ok: true; route: FrameRoute; shape: FrameShape } | { ok: false; error: string };
const oneOf = <T extends string>(allowed: readonly T[], value: string | undefined): value is T => (allowed as readonly (string | undefined)[]).includes(value);
/** `argv` is a whole `process.argv`: positions 2 and 3 are the route and the shape. */
export function parseFrameArgs(argv: readonly string[]): FrameArgs {
  const route = argv[2], shape = argv[3];
  if (!oneOf(FRAME_ROUTES, route)) return { ok: false, error: `argv[2] (route) must be exactly one of ${FRAME_ROUTES.join("|")}, got ${JSON.stringify(route)}` };
  if (!oneOf(FRAME_SHAPES, shape)) return { ok: false, error: `argv[3] (shape) must be exactly one of ${FRAME_SHAPES.join("|")}, got ${JSON.stringify(shape)}` };
  return { ok: true, route, shape };
}
