// tui/test/file-permission.test.tsx — the FILE permission dialog (F6 T7), the highest-traffic body in the
// product. Expectations transcribe 2.1.220's `Cem` (L505875-914): the `Ed` frame titled from `UMy`, the
// symlink warning in the `warning` role, the descriptor's own body (a REAL inline diff for Edit/Write, the
// plain tool-use line for Read/Glob/Grep), `Tem`'s bold-BASENAME question, the `tal` option list inside a
// `Select`, and `L505895`'s shift+tab → accept-session shortcut.
//
// The key contract is the one `BashPermission` established (KB1 + F6 T1): digits reach the embedded Select,
// `y`/`n`/Escape resolve through the dialog's `Confirmation` scope, and the legacy `a`/`A`/`d`/`D` letters
// arrive as unconsumed keys — with `confirm:cycleMode` added on top, because two of the four session-row
// labels PRINT that chord and a printed chord that does nothing is the exact dishonesty F2 exists to remove.
import React from "react";
import { describe, it, expect } from "vitest";
import { renderWithKeymap as render, tick } from "./keysTestUtil.js";
import { FilePermission } from "../../src/tui/dialogs/FilePermission.js";
import { PermissionDialog } from "../../src/tui/PermissionDialog.js";
import { themeTokens } from "../../src/tui/theme.js";
import { parseSedEdit } from "../../src/tui/dialogs/sedEdit.js";
import { formatBindingLower } from "../../src/tui/keys/hints.js";
import type { FileFs } from "../../src/tui/dialogs/fileOptions.js";
import type { PermissionDecision, PermissionUpdateLike } from "../../src/permissions/types.js";

const CWD = "/repo", HOME = "/home/dev";
const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const sgr = (name: "warning") => {
  const m = /(\d+),\s*(\d+),\s*(\d+)/.exec(themeTokens()[name]);
  return `\x1b[38;2;${m![1]};${m![2]};${m![3]}m`;
};
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) { await tick(); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
async function type(stdin: { write: (s: string) => void }, text: string) {
  for (const ch of text) { stdin.write(ch); await tick(); }
}

function fakeFs(files: Record<string, string> = {}, dirs: string[] = [], links: Record<string, string> = {}): FileFs {
  const dirSet = new Set(dirs);
  return { readFile: (p) => files[p], isDirectory: (p) => dirSet.has(p), realPath: (p) => links[p] };
}

interface Req { toolName: string; input: Record<string, unknown>; subagentType?: string; suggestions?: PermissionUpdateLike[] }
async function mount(req: Req, opts: { fs?: FileFs; filePath?: string; sed?: string; directories?: string[]; columns?: number } = {}) {
  const got: PermissionDecision[] = [];
  const sedEdit = opts.sed === undefined ? undefined : parseSedEdit(opts.sed)!;
  const view = render(
    <FilePermission
      req={req} cwd={CWD} home={HOME} columns={opts.columns ?? 80}
      filePath={opts.filePath ?? (req.input.file_path as string | undefined) ?? (req.input.notebook_path as string | undefined) ?? CWD}
      sedEdit={sedEdit} directories={opts.directories} fs={opts.fs ?? fakeFs()}
      onDecision={(d) => got.push(d)}
    />,
  );
  await waitFor(() => (view.lastFrame() ?? "").length > 0);
  return { ...view, got, frame: () => view.lastFrame() ?? "" };
}

describe("<FilePermission> — the frame and the question (`UMy` L228435, `Tem` L505855)", () => {
  it("Edit titles `Edit file`, subtitles the relative path, and asks over the BASENAME in bold", async () => {
    const v = await mount({ toolName: "Edit", input: { file_path: "/repo/src/app.ts", old_string: "alpha", new_string: "beta" } });
    const f = plain(v.frame());
    expect(f).toContain("Edit file");
    expect(f).toContain("src/app.ts");
    expect(f).toContain("Do you want to make this edit to app.ts?");
    // The BOLD half is the basename alone — the full path already rode the subtitle.
    expect(v.frame()).toContain("\x1b[1mapp.ts\x1b[22m");
    expect(f).not.toContain("Do you want to make this edit to /repo/src/app.ts?");
    expect(f).toContain("esc cancel");               // the footer, on the opening Yes row (T4)
    expect(f).not.toContain("tab amend");            // …which Tab cannot amend — only the No row can (external review)
    // The pre-F6 generic body is gone for this kind.
    expect(f).not.toContain("Allow Claude to use");
  });

  it("Write says Overwrite over an existing file and Create over a missing one", async () => {
    const fs = fakeFs({ "/repo/a.ts": "old\n" });
    expect(plain((await mount({ toolName: "Write", input: { file_path: "/repo/a.ts", content: "new\n" } }, { fs })).frame()))
      .toContain("Do you want to overwrite a.ts?");
    expect(plain((await mount({ toolName: "Write", input: { file_path: "/repo/b.ts", content: "x\n" } }, { fs })).frame()))
      .toContain("Do you want to create b.ts?");
  });

  it("NotebookEdit takes its verb from edit_mode and renders the cell header", async () => {
    const v = await mount({ toolName: "NotebookEdit", input: { notebook_path: "/repo/n.ipynb", edit_mode: "insert", cell_id: "c1", cell_type: "python", new_source: "print(1)" } });
    const f = plain(v.frame());
    expect(f).toContain("Edit notebook");
    expect(f).toContain("Do you want to insert this cell into n.ipynb?");
    expect(f).toContain("Insert new cell for cell c1 (python)");
    expect(f).toContain("print(1)");
  });

  it("Read/Glob/Grep take the PLAIN arm: `Read file`, `Do you want to proceed?`, a tool-use line, NO diff", async () => {
    const v = await mount({ toolName: "Grep", input: { pattern: "TODO" } }, { filePath: CWD });
    const f = plain(v.frame());
    expect(f).toContain("Read file");
    expect(f).toContain("Do you want to proceed?");
    expect(f).toContain("Grep(TODO)");
    expect(f).not.toContain("Do you want to make this edit");
  });

  it("hangs the subagent attribution on the TITLE (DG21)", async () => {
    const v = await mount({ toolName: "Read", input: { file_path: "/repo/a.ts" }, subagentType: "code-reviewer" });
    expect(plain(v.frame())).toContain("· from the code-reviewer agent");
  });
});

describe("<FilePermission> — the body is a real inline diff (`wem` L505860, F4's renderer)", () => {
  it("an Edit renders the removed and added lines, not a summary of them", async () => {
    const v = await mount({ toolName: "Edit", input: { file_path: "/repo/a.ts", old_string: "const a = 1", new_string: "const a = 2" } });
    const f = plain(v.frame());
    expect(f).toContain("-const a = 1");
    expect(f).toContain("+const a = 2");
  });

  it("an Overwrite diffs the file's CURRENT content against what would be written", async () => {
    const fs = fakeFs({ "/repo/a.ts": "one\ntwo\n" });
    const f = plain((await mount({ toolName: "Write", input: { file_path: "/repo/a.ts", content: "one\nthree\n" } }, { fs })).frame());
    expect(f).toContain("-two");
    expect(f).toContain("+three");
  });

  it("a CREATE has no diff to show, so the content itself is the body", async () => {
    const f = plain((await mount({ toolName: "Write", input: { file_path: "/repo/new.ts", content: "const x = 1\nconst y = 2\n" } })).frame());
    expect(f).toContain("const x = 1");
    expect(f).toContain("const y = 2");
    expect(f).not.toContain("+const x = 1");
  });

  it("an EMPTY create says `(No content)` rather than rendering a blank block (`ial` L505687)", async () => {
    expect(plain((await mount({ toolName: "Write", input: { file_path: "/repo/new.ts", content: "" } })).frame())).toContain("(No content)");
  });
});

// `ial` L505692 mounts its WHOLE body — the overwrite diff and the create code block alike — inside `SM`
// (L424994-425003), the dashed-rule box, at `paddingX:1`. That box is what tells a reader where the proposed
// content starts and stops when nothing else frames it: the create arm has no `+`/`-` gutter to do the job.
describe("<FilePermission> — the write body's dashed rules (`ial` L505692 → `SM` L424994-425003)", () => {
  const isRule = (r: string) => r.includes("╌╌╌");

  it("fences a CREATE's content between two dashed rules, with the left and right edges off", async () => {
    const f = plain((await mount({ toolName: "Write", input: { file_path: "/repo/new.ts", content: "const x = 1\nconst y = 2\n" } })).frame());
    const rows = f.split("\n");
    expect(rows.filter(isRule)).toHaveLength(2);                              // one above the content, one below
    const top = rows.findIndex(isRule), bottom = rows.map(isRule).lastIndexOf(true);
    expect(rows.findIndex((r) => r.includes("const x = 1"))).toBeGreaterThan(top);
    expect(rows.findIndex((r) => r.includes("const y = 2"))).toBeLessThan(bottom);
    // `borderLeft:!1, borderRight:!1` (L424999) — the vertical glyph must never paint.
    expect(f).not.toContain("╎");
  });

  it("keeps the create arm UNNUMBERED — `EM` at its default `startLine:1` renders no gutter (L423766-769)", async () => {
    const f = plain((await mount({ toolName: "Write", input: { file_path: "/repo/new.ts", content: "const x = 1\nconst y = 2\n" } })).frame());
    const row = f.split("\n").find((r) => r.includes("const x = 1"))!;
    // The numbered gutter is the OVERWRITE arm's (`lre` L420073); a create carries the bare source line.
    expect(row.trimStart()).toMatch(/^const x = 1/);
    expect(f).not.toMatch(/^\s*1\s+const x = 1/m);
  });

  it("still says `(No content)` for an EMPTY create, inside the same two rules", async () => {
    const f = plain((await mount({ toolName: "Write", input: { file_path: "/repo/new.ts", content: "" } })).frame());
    const rows = f.split("\n");
    expect(rows.filter(isRule)).toHaveLength(2);
    const top = rows.findIndex(isRule), bottom = rows.map(isRule).lastIndexOf(true);
    const at = rows.findIndex((r) => r.includes("(No content)"));
    expect(at).toBeGreaterThan(top);
    expect(at).toBeLessThan(bottom);
  });

  it("frames an OVERWRITE's diff in the same rules — `SM` wraps `ial`'s whole body, not just the create arm", async () => {
    const fs = fakeFs({ "/repo/a.ts": "one\ntwo\n" });
    const f = plain((await mount({ toolName: "Write", input: { file_path: "/repo/a.ts", content: "one\nthree\n" } }, { fs })).frame());
    expect(f.split("\n").filter(isRule)).toHaveLength(2);
    expect(f).toContain("-two");
  });

  // RECORDED GAP, pinned so it cannot be mistaken for finished work: `Qsl` (L505548) wraps the EDIT arm in
  // the same `SM`, at `paddingX:0`. Only `ial`'s box is this task's; the edit arm is still bare, and this
  // expectation is the thing a later task has to flip.
  it("does NOT yet fence the EDIT arm, though `Qsl` L505548 wraps it in `SM` too", async () => {
    const f = plain((await mount({ toolName: "Edit", input: { file_path: "/repo/a.ts", old_string: "const a = 1", new_string: "const a = 2" } })).frame());
    expect(f.split("\n").filter(isRule)).toHaveLength(0);
  });
});

describe("<FilePermission> — the sed-as-edit route (`DCs` L228484)", () => {
  it("simulates the substitution against the file and renders it as an ordinary edit diff", async () => {
    const fs = fakeFs({ "/repo/src/a.ts": "alpha\n" });
    const v = await mount({ toolName: "Bash", input: { command: "sed -i '' 's/alpha/beta/' src/a.ts" } }, { fs, sed: "sed -i '' 's/alpha/beta/' src/a.ts" });
    const f = plain(v.frame());
    expect(f).toContain("Edit file");
    expect(f).toContain("Do you want to make this edit to a.ts?");
    expect(f).toContain("-alpha");
    expect(f).toContain("+beta");
  });

  it("states the two no-change reasons instead of showing an empty diff", async () => {
    const miss = await mount({ toolName: "Bash", input: {} }, { fs: fakeFs({ "/repo/src/a.ts": "gamma\n" }), sed: "sed -i '' 's/alpha/beta/' src/a.ts" });
    expect(plain(miss.frame())).toContain("Pattern did not match any content");
    const gone = await mount({ toolName: "Bash", input: {} }, { sed: "sed -i '' 's/alpha/beta/' src/a.ts" });
    expect(plain(gone.frame())).toContain("File does not exist");
  });
});

describe("<FilePermission> — the symlink warning (L505896)", () => {
  it("warns LOUDLY in the `warning` role when the target escapes the working directory", async () => {
    const fs = fakeFs({}, [], { "/repo/link.ts": "/elsewhere/real.ts" });
    const v = await mount({ toolName: "Edit", input: { file_path: "/repo/link.ts", old_string: "a", new_string: "b" } }, { fs });
    expect(plain(v.frame())).toContain("This will modify /elsewhere/real.ts (outside working directory) via a symlink");
    expect(v.frame()).toContain(`${sgr("warning")}This will modify`);
  });
  it("states the target quietly when it stays inside", async () => {
    const fs = fakeFs({}, [], { "/repo/link.ts": "/repo/deep/real.ts" });
    const v = await mount({ toolName: "Edit", input: { file_path: "/repo/link.ts", old_string: "a", new_string: "b" } }, { fs });
    expect(plain(v.frame())).toContain("Symlink target: /repo/deep/real.ts");
  });
  it("says nothing on a READ — nothing is being modified (`Aid` L228420)", async () => {
    const fs = fakeFs({}, [], { "/repo/link.ts": "/elsewhere/real.ts" });
    const v = await mount({ toolName: "Read", input: { file_path: "/repo/link.ts" } }, { fs });
    expect(plain(v.frame())).not.toContain("symlink");
  });
});

describe("<FilePermission> — the option list (`tal` L505624)", () => {
  it("an in-directory WRITE offers the accept-edits row, with the LIVE chat:cycleMode chord in its label", async () => {
    const v = await mount({ toolName: "Edit", input: { file_path: "/repo/a.ts", old_string: "a", new_string: "b" } });
    const f = plain(v.frame());
    expect(f).toContain("1. Yes");
    expect(f).toContain("2. Yes, allow all edits during this session (shift+tab)");
    expect(f).toContain("3. No");
  });
  it("the chord in that label is RESOLVED, not typed: a user layer that rebinds it moves the label", async () => {
    const got: PermissionDecision[] = [];
    const view = render(
      <FilePermission req={{ toolName: "Edit", input: { file_path: "/repo/a.ts", old_string: "a", new_string: "b" } }}
        cwd={CWD} home={HOME} columns={80} filePath="/repo/a.ts" fs={fakeFs()} onDecision={(d) => got.push(d)} />,
      { userLayers: [{ context: "Chat", bindings: { "shift+tab": null, "alt+m": "chat:cycleMode" } }] },
    );
    await waitFor(() => (view.lastFrame() ?? "").length > 0);
    const f = plain(view.lastFrame() ?? "");
    // `alt+m` prints `opt+m` on darwin and `alt+m` everywhere else, so the expectation is DERIVED rather
    // than typed — the house convention (keys-hints.test.ts:95) for anything the platform renames.
    expect(f).toContain(`Yes, allow all edits during this session (${formatBindingLower("alt+m", process.platform)})`);
    expect(f).not.toContain("(shift+tab)");
  });

  it("an out-of-directory READ names the directory it would grant", async () => {
    const v = await mount({ toolName: "Read", input: { file_path: "/outside/pkg/a.ts" } });
    expect(plain(v.frame())).toContain("2. Yes, allow reading from pkg/ during this session");
  });
  it("an in-directory READ offers the bare session row", async () => {
    const v = await mount({ toolName: "Read", input: { file_path: "/repo/a.ts" } });
    expect(plain(v.frame())).toContain("2. Yes, during this session");
  });
  it("a write into `.claude` offers the self-edit row instead", async () => {
    const v = await mount({ toolName: "Write", input: { file_path: "/repo/.claude/settings.json", content: "{}" } });
    expect(plain(v.frame())).toContain("2. Yes, and allow Claude to edit its own settings for this session");
  });
});

describe("<FilePermission> — the key contract", () => {
  const edit: Req = { toolName: "Edit", input: { file_path: "/repo/a.ts", old_string: "a", new_string: "b" } };

  it("digit 1 allows once; digit 3 denies", async () => {
    const a = await mount(edit);
    a.stdin.write("1"); await waitFor(() => a.got.length === 1);
    expect(a.got[0]).toEqual({ kind: "allow_once" });
    const b = await mount(edit);
    b.stdin.write("3"); await waitFor(() => b.got.length === 1);
    expect(b.got[0]).toEqual({ kind: "deny" });
  });

  it("bare y allows, bare n denies, Escape denies", async () => {
    for (const [key, expected] of [["y", { kind: "allow_once" }], ["n", { kind: "deny" }], ["\x1b", { kind: "deny" }]] as const) {
      const v = await mount(edit);
      v.stdin.write(key); await waitFor(() => v.got.length === 1);
      expect(v.got[0]).toEqual(expected);
    }
  });

  it("↓ then Enter takes the highlighted row, not the first one", async () => {
    const v = await mount(edit);
    v.stdin.write("\x1b[B"); await tick();
    v.stdin.write("\x1b[B"); await tick();
    v.stdin.write("\r"); await waitFor(() => v.got.length === 1);
    expect(v.got[0]).toEqual({ kind: "deny" });
  });

  it("keeps the legacy a/A/d/D letters", async () => {
    const v = await mount(edit);
    v.stdin.write("a"); await waitFor(() => v.got.length === 1);
    v.stdin.write("A"); await waitFor(() => v.got.length === 2);
    v.stdin.write("D"); await waitFor(() => v.got.length === 3);
    expect(v.got).toEqual([{ kind: "allow_once" }, { kind: "allow_always" }, { kind: "deny" }]);
  });

  it("Tab on the No row opens the feedback field, and Enter sends what was typed", async () => {
    const v = await mount(edit);
    v.stdin.write("\x1b[B"); await tick();
    v.stdin.write("\x1b[B"); await tick();
    v.stdin.write("\t"); await tick();
    expect(plain(v.frame())).toContain("and tell Claude what to do differently");
    await type(v.stdin, "edit the other file");
    expect(v.got).toEqual([]);                                  // y/n/a/d were all letters in there
    v.stdin.write("\r"); await waitFor(() => v.got.length === 1);
    expect(v.got[0]).toEqual({ kind: "deny", feedback: "edit the other file" });
  });
});

describe("<FilePermission> — the session grant (probe 78, `vem` L505845)", () => {
  it("shift+tab takes the accept-session row DIRECTLY, wherever the cursor is (`confirm:cycleMode`)", async () => {
    const suggestions: PermissionUpdateLike[] = [{ type: "setMode", mode: "acceptEdits", destination: "session" }];
    const v = await mount({ toolName: "Edit", input: { file_path: "/repo/a.ts", old_string: "a", new_string: "b" }, suggestions });
    v.stdin.write("\x1b[Z"); await waitFor(() => v.got.length === 1);
    const d = v.got[0] as { kind: string; updatedPermissions: PermissionUpdateLike[] };
    expect(d.kind).toBe("allow_with_updates");
    expect(d.updatedPermissions[0]).toBe(suggestions[0]);        // identity: the engine's own object
  });

  it("shift+tab picks the `.claude` self-edit row when that is the accept-session row on screen", async () => {
    const v = await mount({ toolName: "Write", input: { file_path: "/repo/.claude/settings.json", content: "{}" } });
    v.stdin.write("\x1b[Z"); await waitFor(() => v.got.length === 1);
    expect(v.got[0]).toEqual({
      kind: "allow_with_updates",
      updatedPermissions: [{ type: "addRules", rules: [{ toolName: "Edit", ruleContent: "/.claude/**" }], behavior: "allow", destination: "session" }],
    });
  });

  it("digit 2 echoes the engine's suggestion verbatim — and picks the FIRST of the two read variants", async () => {
    const raw: PermissionUpdateLike = { type: "addRules", rules: [{ toolName: "Read", ruleContent: "//outside/pkg/**" }], behavior: "allow", destination: "session" };
    const resolved: PermissionUpdateLike = { type: "addRules", rules: [{ toolName: "Read", ruleContent: "//private/outside/pkg/**" }], behavior: "allow", destination: "session" };
    const v = await mount({ toolName: "Read", input: { file_path: "/outside/pkg/a.ts" }, suggestions: [raw, resolved] });
    v.stdin.write("2"); await waitFor(() => v.got.length === 1);
    const d = v.got[0] as { kind: string; updatedPermissions: PermissionUpdateLike[] };
    expect(d.updatedPermissions).toHaveLength(1);
    expect(d.updatedPermissions[0]).toBe(raw);
  });

  it("falls back to a constructed grant when the engine suggested nothing", async () => {
    const v = await mount({ toolName: "Read", input: { file_path: "/outside/pkg/a.ts" } });
    v.stdin.write("2"); await waitFor(() => v.got.length === 1);
    expect(v.got[0]).toEqual({
      kind: "allow_with_updates",
      updatedPermissions: [{ type: "addRules", rules: [{ toolName: "Read", ruleContent: "//outside/pkg/**" }], behavior: "allow", destination: "session" }],
    });
  });

  it("an extra working directory makes an otherwise-outside path in-directory", async () => {
    const v = await mount({ toolName: "Read", input: { file_path: "/outside/pkg/a.ts" } }, { directories: [CWD, "/outside"] });
    expect(plain(v.frame())).toContain("2. Yes, during this session");
  });
});

describe("PermissionDialog — the switchboard routes the file kind", () => {
  const mountVia = async (req: { toolName: string; input: Record<string, unknown> }) => {
    const got: PermissionDecision[] = [];
    const view = render(<PermissionDialog req={req} cwd={CWD} onDecision={(d) => got.push(d)} />);
    await waitFor(() => (view.lastFrame() ?? "").length > 0);
    return { ...view, got, frame: () => plain(view.lastFrame() ?? "") };
  };

  it("Edit reaches the new body", async () =>
    expect((await mountVia({ toolName: "Edit", input: { file_path: "/repo/a.ts", old_string: "a", new_string: "b" } })).frame()).toContain("Edit file"));

  it("Grep — which always derives a path — reaches it too, on the plain arm", async () =>
    expect((await mountVia({ toolName: "Grep", input: { pattern: "TODO" } })).frame()).toContain("Read file"));

  // T8 replaced the pre-F6 body with `GenericPermission` (`Gal` L506118), so the frame these two look for is
  // `Tool use` now — and WebFetch has left the fallback entirely for `FetchPermission` (`ull` L506735).
  it("an Edit with NO derivable path still falls to the generic body (`Vrn` L228408)", async () =>
    expect((await mountVia({ toolName: "Edit", input: {} })).frame()).toContain("Tool use"));

  it("WebFetch is no longer the fallback's problem — it has a dialog of its own", async () => {
    const v = await mountVia({ toolName: "WebFetch", input: { url: "https://example.com" } });
    expect(v.frame()).toContain("Fetch");
    expect(v.frame()).not.toContain("Tool use");
    v.stdin.write("1"); await waitFor(() => v.got.length === 1);
    expect(v.got[0]).toEqual({ kind: "allow_once" });
  });

  it("a Bash command that is really an in-place edit lands on the FILE body", async () =>
    expect((await mountVia({ toolName: "Bash", input: { command: "sed -i '' 's/a/b/' f.ts" } })).frame()).toContain("Edit file"));
});
