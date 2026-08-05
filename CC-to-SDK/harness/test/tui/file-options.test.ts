// tui/test/file-options.test.ts — the file permission dialog's pure half (F6 T7). Expectations transcribe
// 2.1.220's `UMy` (L228435-467, the per-tool descriptor table), `DCs` (L228484-494, the sed-as-edit one),
// `tal` (L505624-654, the option list and its four session-row wordings), `vem` (L505840-854, what each row
// returns), `m9b`/`h9b` (L505616/L505622, the two `.claude` tests), `z7`/`u1` (L371374/L371379, containment)
// and `Aid` + `Cem`'s warning node (L228419 / L505896).
import { describe, it, expect } from "vitest";
import {
  CLAUDE_FOLDER_LABEL, GLOBAL_CLAUDE_RULE, PROJECT_CLAUDE_RULE, THIS_DIRECTORY, claudeFolderScope,
  constructedUpdates, escapeRuleContent, fileDecision, fileDescriptor, fileOptions, isInWorkingDirectory,
  isReadOnlyTool, isUnder, notebookCellSource, pickSuggestions, readDirectoryRule, searchDirectory,
  sedDescriptor, sessionRowLabel, symlinkTarget, symlinkWarning, toolUseLine, type FileFs,
} from "../../src/tui/dialogs/fileOptions.js";
import { parseSedEdit } from "../../src/tui/dialogs/sedEdit.js";
import type { PermissionUpdateLike } from "../../src/permissions/types.js";

const CWD = "/repo", HOME = "/home/dev";

/** A disk made of a map. Anything absent is "not there"; `dirs` is the set that answers `isDirectory`;
 *  `links` is the realpath table (`$f`'s `resolvedPath !== path` test). */
function fakeFs(files: Record<string, string> = {}, dirs: string[] = [], links: Record<string, string> = {}): FileFs {
  const dirSet = new Set(dirs);
  return {
    readFile: (p) => files[p],
    isDirectory: (p) => dirSet.has(p),
    realPath: (p) => links[p],
  };
}
const NO_FS = fakeFs();

const label = (o: { label: string }) => o.label;
const chord = "shift+tab";
const rowArgs = { directoryName: "pkg", cycleModeChord: chord };

describe("containment (`z7`/`u1` L371374)", () => {
  it("a path at or under the directory is in it; a sibling and a parent are not", () => {
    expect(isUnder("/repo/src/a.ts", "/repo", CWD)).toBe(true);
    expect(isUnder("/repo", "/repo", CWD)).toBe(true);
    expect(isUnder("/other/a.ts", "/repo", CWD)).toBe(false);
    expect(isUnder("/rep", "/repo", CWD)).toBe(false);          // a prefix that is not a path prefix
  });
  it("collapses macOS's /private spellings so the same directory is not called two places", () => {
    expect(isUnder("/private/tmp/x/a.ts", "/tmp/x", CWD)).toBe(true);
    expect(isUnder("/tmp/x/a.ts", "/private/tmp/x", CWD)).toBe(true);
    expect(isUnder("/private/var/f/a.ts", "/var/f", CWD)).toBe(true);
  });
  it("is case SENSITIVE — `z7` passes caseFold:!1", () => expect(isUnder("/repo/SRC/a.ts", "/repo/src", CWD)).toBe(false));
  it("relative paths resolve against the SESSION cwd", () => expect(isUnder("src/a.ts", ".", CWD)).toBe(true));
  it("an EMPTY working-directory set puts nothing in-directory", () =>
    expect(isInWorkingDirectory("/repo/a.ts", [], CWD)).toBe(false));
  it("any one of several directories is enough", () =>
    expect(isInWorkingDirectory("/other/a.ts", ["/repo", "/other"], CWD)).toBe(true));
});

describe("`UK` L36504 — the directory a path names", () => {
  it("a file names its parent", () => expect(searchDirectory("/repo/src/a.ts", CWD, NO_FS)).toBe("/repo/src"));
  it("a directory names itself", () => expect(searchDirectory("/repo/src", CWD, fakeFs({}, ["/repo/src"]))).toBe("/repo/src"));
});

describe("the `.claude` folder tests (`m9b` L505616 / `h9b` L505622)", () => {
  it("names the project folder and the home folder apart", () => {
    expect(claudeFolderScope("/repo/.claude/settings.json", CWD, HOME)).toBe("claude-folder");
    expect(claudeFolderScope("/home/dev/.claude/agents/x.md", CWD, HOME)).toBe("global-claude-folder");
    expect(claudeFolderScope("/repo/src/a.ts", CWD, HOME)).toBeNull();
  });
  it("the folder NODE itself is not inside it — both tests are startsWith(dir + sep)", () =>
    expect(claudeFolderScope("/repo/.claude", CWD, HOME)).toBeNull());
  it("folds case the way `Ny` does", () =>
    expect(claudeFolderScope("/repo/.CLAUDE/settings.json", CWD, HOME)).toBe("claude-folder"));
});

describe("the symlink warning (`Aid` L228419, `Cem`'s node L505896)", () => {
  const fs = fakeFs({}, [], { "/repo/link.ts": "/elsewhere/real.ts", "/repo/inside.ts": "/repo/deep/real.ts" });
  it("a READ never resolves a target — nothing is being modified", () =>
    expect(symlinkTarget("/repo/link.ts", "read", CWD, fs)).toBeUndefined());
  it("a write through a symlink resolves it", () =>
    expect(symlinkTarget("/repo/link.ts", "write", CWD, fs)).toBe("/elsewhere/real.ts"));
  it("a plain file has no target", () => expect(symlinkTarget("/repo/a.ts", "write", CWD, fs)).toBeUndefined());
  it("a target that escapes the cwd gets the LOUD sentence; one inside gets the quiet one", () => {
    expect(symlinkWarning("/elsewhere/real.ts", CWD)).toBe("This will modify /elsewhere/real.ts (outside working directory) via a symlink");
    expect(symlinkWarning("/repo/deep/real.ts", CWD)).toBe("Symlink target: /repo/deep/real.ts");
  });
});

describe("the descriptor (`UMy` L228435-467)", () => {
  it("Edit: `Edit file`, the relative path, and the `make this edit to` verb over the BASENAME", () => {
    const d = fileDescriptor({ toolName: "Edit", input: { file_path: "/repo/src/app.ts", old_string: "a", new_string: "b" }, filePath: "/repo/src/app.ts", cwd: CWD, fs: NO_FS });
    expect(d.title).toBe("Edit file");
    expect(d.subtitle).toBe("src/app.ts");
    expect(d.question).toEqual({ kind: "file-action", verbPhrase: "make this edit to", fileName: "app.ts" });
    expect(d.content).toEqual({ kind: "file-edit-diff", filePath: "/repo/src/app.ts", edits: [{ old_string: "a", new_string: "b", replace_all: false }] });
    expect(d.operationType).toBe("write");
  });
  it("Write over an EXISTING file overwrites; over a missing one creates", () => {
    const fs = fakeFs({ "/repo/a.ts": "old\n" });
    const over = fileDescriptor({ toolName: "Write", input: { file_path: "/repo/a.ts", content: "new\n" }, filePath: "/repo/a.ts", cwd: CWD, fs });
    expect(over.title).toBe("Overwrite file");
    expect(over.question).toMatchObject({ verbPhrase: "overwrite" });
    expect(over.content).toEqual({ kind: "file-write-diff", filePath: "/repo/a.ts", content: "new\n", fileExists: true, oldContent: "old\n" });
    const make = fileDescriptor({ toolName: "Write", input: { file_path: "/repo/b.ts", content: "x" }, filePath: "/repo/b.ts", cwd: CWD, fs });
    expect(make.title).toBe("Create file");
    expect(make.question).toMatchObject({ verbPhrase: "create" });
    expect(make.content).toMatchObject({ fileExists: false, oldContent: "" });
  });
  it("NotebookEdit: `Edit notebook`, NO subtitle, and a verb per edit_mode", () => {
    const of = (edit_mode: string) => fileDescriptor({ toolName: "NotebookEdit", input: { notebook_path: "/repo/n.ipynb", edit_mode, new_source: "x", cell_id: "c1" }, filePath: "/repo/n.ipynb", cwd: CWD, fs: NO_FS });
    expect(of("insert").title).toBe("Edit notebook");
    expect(of("insert").subtitle).toBeUndefined();
    expect(of("insert").question).toMatchObject({ verbPhrase: "insert this cell into", fileName: "n.ipynb" });
    expect(of("delete").question).toMatchObject({ verbPhrase: "delete this cell from" });
    expect(of("replace").question).toMatchObject({ verbPhrase: "make this edit to" });
  });
  it("Read/Glob/Grep take the FINAL return (L228464): `Read file`, a plain question, a tool-use line", () => {
    for (const toolName of ["Read", "Glob", "Grep"]) {
      const d = fileDescriptor({ toolName, input: { file_path: "/repo/a.ts", pattern: "**/*.ts" }, filePath: "/repo/a.ts", cwd: CWD, fs: NO_FS });
      expect(d.title, toolName).toBe("Read file");
      expect(d.subtitle, toolName).toBeUndefined();
      expect(d.question, toolName).toEqual({ kind: "plain", text: "Do you want to proceed?" });
      expect(d.content.kind, toolName).toBe("tool-use-line");
      expect(d.operationType, toolName).toBe("read");
    }
  });
  it("the tool-use line is `Name(argument)`, and Glob/Grep name their PATTERN", () => {
    expect(toolUseLine("Read", { file_path: "/repo/a.ts" }, "/repo/a.ts")).toBe("Read(/repo/a.ts)");
    expect(toolUseLine("Grep", { pattern: "TODO" }, "/repo")).toBe("Grep(TODO)");
    expect(toolUseLine("Glob", {}, "/repo")).toBe("Glob(/repo)");
  });
  it("splits the six-tool family the way `isReadOnly` does", () => {
    for (const t of ["Read", "Glob", "Grep"]) expect(isReadOnlyTool(t), t).toBe(true);
    for (const t of ["Edit", "Write", "NotebookEdit"]) expect(isReadOnlyTool(t), t).toBe(false);
  });
});

describe("the notebook cell lookup (`fal` L505730)", () => {
  const notebook = JSON.stringify({ cells: [{ id: "abc", source: ["print(", "1)"] }, { id: "def", source: "x = 2" }] });
  const fs = fakeFs({ "/repo/n.ipynb": notebook });
  it("a numeric cell_id INDEXES the list; a name matches `id`; an array source joins", () => {
    expect(notebookCellSource("/repo/n.ipynb", "0", CWD, fs)).toEqual({ oldSource: "print(1)", notebookRead: true });
    expect(notebookCellSource("/repo/n.ipynb", "def", CWD, fs)).toEqual({ oldSource: "x = 2", notebookRead: true });
  });
  it("a cell that is not there reads empty but the notebook still counts as READ", () =>
    expect(notebookCellSource("/repo/n.ipynb", "zzz", CWD, fs)).toEqual({ oldSource: "", notebookRead: true }));
  it("an unreadable or unparseable notebook is NOT read — the body falls back to the new source alone", () => {
    expect(notebookCellSource("/repo/missing.ipynb", "0", CWD, fs)).toEqual({ oldSource: "", notebookRead: false });
    expect(notebookCellSource("/repo/n.ipynb", "0", CWD, fakeFs({ "/repo/n.ipynb": "not json" }))).toEqual({ oldSource: "", notebookRead: false });
  });
});

describe("the sed descriptor (`DCs` L228484-494)", () => {
  const sed = parseSedEdit("sed -i '' 's/alpha/beta/' src/a.ts")!;
  it("is always an EDIT, and simulates the substitution against the file's current content", () => {
    const d = sedDescriptor(sed, CWD, fakeFs({ "/repo/src/a.ts": "alpha\n" }));
    expect(d.title).toBe("Edit file");
    expect(d.subtitle).toBe("src/a.ts");
    expect(d.question).toEqual({ kind: "file-action", verbPhrase: "make this edit to", fileName: "a.ts" });
    expect(d.filePath).toBe("/repo/src/a.ts");
    expect(d.operationType).toBe("write");
    expect(d.content).toEqual({ kind: "file-edit-diff", filePath: "/repo/src/a.ts", edits: [{ old_string: "alpha\n", new_string: "beta\n", replace_all: false }] });
  });
  it("says so when the pattern matched nothing, and when the file is not there at all", () => {
    expect(sedDescriptor(sed, CWD, fakeFs({ "/repo/src/a.ts": "gamma\n" })).content).toEqual({ kind: "no-changes", message: "Pattern did not match any content" });
    expect(sedDescriptor(sed, CWD, NO_FS).content).toEqual({ kind: "no-changes", message: "File does not exist" });
  });
});

describe("the option list (`tal` L505624-654)", () => {
  const base = { operationType: "write", inDirectory: true, claudeScope: null, ...rowArgs } as const;
  it("is Yes · exactly ONE middle row · No", () => {
    const o = fileOptions(base);
    expect(o.map((r) => r.value)).toEqual(["yes", "yes-session", "no"]);
    expect(o.map(label)).toEqual(["Yes", `Yes, allow all edits during this session (${chord})`, "No"]);
  });
  it("the four session-row wordings, by in-directory × read/write", () => {
    expect(sessionRowLabel({ ...rowArgs, operationType: "read", inDirectory: true })).toBe("Yes, during this session");
    expect(sessionRowLabel({ ...rowArgs, operationType: "write", inDirectory: true })).toBe(`Yes, allow all edits during this session (${chord})`);
    expect(sessionRowLabel({ ...rowArgs, operationType: "read", inDirectory: false })).toBe("Yes, allow reading from pkg/ during this session");
    expect(sessionRowLabel({ ...rowArgs, operationType: "write", inDirectory: false })).toBe(`Yes, allow all edits in pkg/ during this session (${chord})`);
  });
  it("an UNBOUND chat:cycleMode drops the parenthetical rather than printing an empty one", () => {
    expect(sessionRowLabel({ ...rowArgs, cycleModeChord: "", operationType: "write", inDirectory: true }))
      .toBe("Yes, allow all edits during this session");
  });
  it("a rebound chord is what the label prints — the literal is never hardcoded", () =>
    expect(sessionRowLabel({ ...rowArgs, cycleModeChord: "alt+m", operationType: "write", inDirectory: false }))
      .toBe("Yes, allow all edits in pkg/ during this session (alt+m)"));
  it("names an unnameable directory `this directory` (L505641)", () => expect(THIS_DIRECTORY).toBe("this directory"));
  it("a WRITE inside `.claude` replaces the session row entirely", () => {
    const o = fileOptions({ ...base, claudeScope: "claude-folder" });
    expect(o.map((r) => r.value)).toEqual(["yes", "yes-claude-folder", "no"]);
    expect(o[1]!.label).toBe(CLAUDE_FOLDER_LABEL);
  });
  it("but a READ inside `.claude` keeps the ordinary session row (`r !== \"read\"`, L505630)", () =>
    expect(fileOptions({ ...base, operationType: "read", claudeScope: "claude-folder" }).map((r) => r.value))
      .toEqual(["yes", "yes-session", "no"]));
  it("feedback mode turns the No row into a text row", () =>
    expect(fileOptions({ ...base, feedback: { yes: false, no: true } })[2]).toMatchObject({ type: "input", value: "no" }));
});

describe("what a row means (`vem` L505840-854)", () => {
  const ctx = { claudeScope: null, operationType: "write", inDirectory: true, searchDir: "/repo/src" } as const;
  it("Yes is a plain allow_once, with no updatedInput echoed back", () =>
    expect(fileDecision("yes", ctx)).toEqual({ kind: "allow_once" }));
  it("No carries typed feedback, and nothing when empty", () => {
    expect(fileDecision("no", { ...ctx, text: "use the other file" })).toEqual({ kind: "deny", feedback: "use the other file" });
    expect(fileDecision("no", { ...ctx, text: "   " })).toEqual({ kind: "deny" });
  });
  it("the `.claude` row grants the literal rule for its scope (`$ro`/`Bro` L100719)", () => {
    expect(fileDecision("yes-claude-folder", { ...ctx, claudeScope: "claude-folder" })).toEqual({
      kind: "allow_with_updates",
      updatedPermissions: [{ type: "addRules", rules: [{ toolName: "Edit", ruleContent: PROJECT_CLAUDE_RULE }], behavior: "allow", destination: "session" }],
    });
    expect(fileDecision("yes-claude-folder", { ...ctx, claudeScope: "global-claude-folder" }))
      .toMatchObject({ updatedPermissions: [{ rules: [{ ruleContent: GLOBAL_CLAUDE_RULE }] }] });
  });
  it("the session row ECHOES the engine's suggestion object-for-object (probe 78)", () => {
    const suggestions: PermissionUpdateLike[] = [{ type: "setMode", mode: "acceptEdits", destination: "session" }];
    const d = fileDecision("yes-session", { ...ctx, suggestions }) as { kind: string; updatedPermissions: PermissionUpdateLike[] };
    expect(d.kind).toBe("allow_with_updates");
    expect(d.updatedPermissions[0]).toBe(suggestions[0]);          // identity: verbatim, never reconstructed
  });
  it("picks the FIRST of the raw / `/private`-resolved variant PAIR an outside read arrives with", () => {
    const raw: PermissionUpdateLike = { type: "addRules", rules: [{ toolName: "Read", ruleContent: "//tmp/out/**" }], behavior: "allow", destination: "session" };
    const resolved: PermissionUpdateLike = { type: "addRules", rules: [{ toolName: "Read", ruleContent: "//private/tmp/out/**" }], behavior: "allow", destination: "session" };
    expect(pickSuggestions([raw, resolved])).toEqual([raw]);
    const d = fileDecision("yes-session", { ...ctx, operationType: "read", inDirectory: false, suggestions: [raw, resolved] });
    expect(d).toEqual({ kind: "allow_with_updates", updatedPermissions: [raw] });
  });
  it("but keeps two suggestions that are genuinely DIFFERENT kinds", () => {
    const mode: PermissionUpdateLike = { type: "setMode", mode: "acceptEdits", destination: "session" };
    const dirs: PermissionUpdateLike = { type: "addDirectories", directories: ["/out"], destination: "session" };
    expect(pickSuggestions([mode, dirs])).toEqual([mode, dirs]);
  });
  it("constructs `iHr`'s own grant when the engine suggested NOTHING", () => {
    expect(fileDecision("yes-session", { ...ctx, searchDir: "/repo/src" })).toEqual({
      kind: "allow_with_updates", updatedPermissions: [{ type: "setMode", mode: "acceptEdits", destination: "session" }],
    });
    expect(constructedUpdates({ operationType: "write", inDirectory: false, searchDir: "/out" })).toEqual([
      { type: "setMode", mode: "acceptEdits", destination: "session" },
      { type: "addDirectories", directories: ["/out"], destination: "session" },
    ]);
    expect(constructedUpdates({ operationType: "read", inDirectory: false, searchDir: "/out" })).toEqual([
      { type: "addRules", rules: [{ toolName: "Read", ruleContent: "//out/**" }], behavior: "allow", destination: "session" },
    ]);
  });
  it("`p1t`'s leading-slash doubling is upstream's, and probe 78 saw it on the wire", () =>
    expect(readDirectoryRule("/tmp/out")).toMatchObject({ rules: [{ ruleContent: "//tmp/out/**" }] }));
  it("refuses to grant the ROOT directory (L228678)", () => expect(readDirectoryRule("/")).toBeUndefined());
  it("escapes rule metacharacters so a directory named `a(b)` is a directory, not a pattern", () =>
    expect(escapeRuleContent("/repo/a(b)*")).toBe("/repo/a\\(b\\)\\*"));
});
