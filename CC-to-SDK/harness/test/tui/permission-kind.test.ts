// tui/test/permission-kind.test.ts — the pure permission-dialog router (F6 T4) and the sed-as-edit matcher
// underneath it. Transcribed from 2.1.220's `Ksn` (L279164 — registry first, then the file family, then
// Bash), the registry `w8y` (L279380), the file-tool predicate `qrn` (L228385) with its path deriver `Vrn`
// (L228408), and the sed matcher `c1t` (L227825) whose descriptor `DCs` consumes (L228484-494).
import { describe, it, expect } from "vitest";
import { permissionKind, derivePath } from "../../src/tui/dialogs/permissionKind.js";
import { parseSedEdit, splitSimpleCommand, simulateSedEdit, sedEditPreview, type SedEdit } from "../../src/tui/dialogs/sedEdit.js";

const CWD = process.cwd();

describe("permissionKind — the families", () => {
  it("routes Bash to `bash`", () => {
    expect(permissionKind("Bash", { command: "npm test" })).toEqual({ kind: "bash" });
  });

  it("routes the registry tools to their own kinds (`w8y` L279380)", () => {
    expect(permissionKind("WebFetch", { url: "https://x" }).kind).toBe("webfetch");
    expect(permissionKind("Skill", { command: "/review" }).kind).toBe("skill");
    expect(permissionKind("Monitor", {}).kind).toBe("monitor");
  });

  it("routes the six `qrn` file tools to `file` and carries the derived path", () => {
    expect(permissionKind("Edit", { file_path: "/w/a.ts" })).toEqual({ kind: "file", filePath: "/w/a.ts" });
    expect(permissionKind("Write", { file_path: "/w/b.ts" })).toEqual({ kind: "file", filePath: "/w/b.ts" });
    expect(permissionKind("NotebookEdit", { notebook_path: "/w/n.ipynb" })).toEqual({ kind: "file", filePath: "/w/n.ipynb" });
    expect(permissionKind("Read", { file_path: "/w/c.ts" })).toEqual({ kind: "file", filePath: "/w/c.ts" });
    expect(permissionKind("Grep", { pattern: "x", path: "/w/src" })).toEqual({ kind: "file", filePath: "/w/src" });
    expect(permissionKind("Glob", { pattern: "**/*.ts", path: "/w/src" })).toEqual({ kind: "file", filePath: "/w/src" });
  });

  it("falls through to `generic` when NO file path can be derived (`Vrn` returns null, L228408)", () => {
    expect(permissionKind("Edit", {})).toEqual({ kind: "generic" });
    expect(permissionKind("Edit", { file_path: "" })).toEqual({ kind: "generic" });
    expect(permissionKind("Write", { content: "x" })).toEqual({ kind: "generic" });
    expect(permissionKind("NotebookEdit", { new_source: "x" })).toEqual({ kind: "generic" });
  });

  it("gives the search/read tools the cwd fallback their own getPath has (L220178/220299/307642)", () => {
    expect(permissionKind("Read", {})).toEqual({ kind: "file", filePath: CWD });
    expect(permissionKind("Grep", { pattern: "x" })).toEqual({ kind: "file", filePath: CWD });
    expect(permissionKind("Glob", { pattern: "**/*.ts" })).toEqual({ kind: "file", filePath: CWD });
  });

  it("derives a Glob search dir only from an ABSOLUTE pattern (`eTs` L220016 returns null otherwise)", () => {
    expect(derivePath("Glob", { pattern: "/w/src/**/*.ts" })).toBe("/w/src");
    expect(derivePath("Glob", { pattern: "rel/**/*.ts", path: "/w/other" })).toBe("/w/other");
  });

  it("routes everything else — MCP tools included — to `generic`", () => {
    expect(permissionKind("TodoWrite", { todos: [] }).kind).toBe("generic");
    expect(permissionKind("mcp__linear__create_issue", { title: "x" }).kind).toBe("generic");
    expect(permissionKind("Task", { prompt: "x" }).kind).toBe("generic");
    // `PowerShell` has its own upstream dialog (`w8y` L279380 `e.name === Vi`) that we do not build.
    expect(permissionKind("PowerShell", { command: "ls" }).kind).toBe("generic");
  });
});

describe("permissionKind — Bash that is really a file edit (`c1t` L227825)", () => {
  it("re-routes an in-place sed to the file dialog with a simulated-edit descriptor", () => {
    expect(permissionKind("Bash", { command: "sed -i 's/foo/bar/' notes.md" })).toEqual({
      kind: "file",
      filePath: "notes.md",
      sedEdit: { filePath: "notes.md", pattern: "foo", replacement: "bar", flags: "", extendedRegex: false },
    });
  });

  it("accepts every in-place spelling the bundle accepts", () => {
    expect(permissionKind("Bash", { command: "sed --in-place 's/a/b/' f.txt" }).kind).toBe("file");
    expect(permissionKind("Bash", { command: "sed -i '' 's/a/b/' f.txt" }).kind).toBe("file");   // BSD sed
    expect(permissionKind("Bash", { command: "sed -i.bak s/a/b/ f.txt" }).kind).toBe("file");
    expect(permissionKind("Bash", { command: "sed -i -e 's/a/b/' f.txt" }).kind).toBe("file");
    expect(permissionKind("Bash", { command: "sed -i --expression=s/a/b/ f.txt" }).kind).toBe("file");
    expect(permissionKind("Bash", { command: "sed -E -i 's/(a)+/b/g' f.txt" }).kind).toBe("file");
  });

  it("falls back to `bash` for every form the bundle rejects", () => {
    const rejected = [
      "cat x.txt | sed -i 's/a/b/' f.txt",       // pipeline — more than one command node
      "sed -i 's/a/b/' f.txt > out.txt",         // redirected_statement
      "sed -i 's/a/b/' f.txt && echo done",      // two statements
      "sed 's/a/b/' f.txt",                      // no in-place flag
      "sed -i 's/a/b/'",                         // no file operand
      "sed -i -n 's/a/b/' f.txt",                // an unrecognised flag
      "sed -i 's/a/b/' a.txt b.txt",             // two operands after the script
      "sed -i -e s/a/b/ -e s/c/d/ f.txt",        // two scripts
      "sed -i '1,5d' f.txt",                     // not an s/// script
      "sed -i 's/a/b/z' f.txt",                  // a flag outside [gpimIM1-9]
      "sed -i 's/a/b' f.txt",                    // unterminated s///
      "FOO=1 sed -i 's/a/b/' f.txt",             // variable_assignment is not in `HMy`
      "ssed -i 's/a/b/' f.txt",                  // argv[0] is not `sed`
      "echo hi",
    ];
    for (const command of rejected) expect(permissionKind("Bash", { command }).kind).toBe("bash");
  });

  it("treats a missing / non-string command as a plain bash ask", () => {
    expect(permissionKind("Bash", {}).kind).toBe("bash");
    expect(permissionKind("Bash", { command: 42 }).kind).toBe("bash");
  });
});

describe("parseSedEdit — the argv walk in detail", () => {
  it("keeps flags and the extended-regex switch on the descriptor", () => {
    expect(parseSedEdit("sed -i 's/a/b/gi' f.txt")).toEqual({
      filePath: "f.txt", pattern: "a", replacement: "b", flags: "gi", extendedRegex: false,
    });
    expect(parseSedEdit("sed -r -i 's/a/b/' f.txt")?.extendedRegex).toBe(true);
    // Only the `-i` prefix gets the loose `startsWith` arm (L227847); every other clustered short flag —
    // `-ri` included — falls to the `startsWith("-")` reject at L227874.
    expect(parseSedEdit("sed -ri 's/a/b/' f.txt")).toBeNull();
    expect(parseSedEdit("sed -i.bak 's/a/b/' f.txt")?.filePath).toBe("f.txt");
    expect(parseSedEdit("sed --regexp-extended -i 's/a/b/' f.txt")?.extendedRegex).toBe(true);
  });

  it("consumes the token after `-i` as a backup suffix ONLY when it is empty or starts with a dot", () => {
    // `''` is the BSD backup suffix and is swallowed, leaving script + file.
    expect(parseSedEdit("sed -i '' 's/a/b/' f.txt")?.filePath).toBe("f.txt");
    expect(parseSedEdit("sed -i .bak 's/a/b/' f.txt")?.filePath).toBe("f.txt");
    // A non-suffix-looking token is NOT swallowed: it becomes the script, so the real script + file are
    // one operand too many and the whole thing is rejected.
    expect(parseSedEdit("sed -i s/a/b/ f.txt")).not.toBeNull();
    expect(parseSedEdit("sed -i extra s/a/b/ f.txt")).toBeNull();
  });

  it("keeps escaped slashes inside the s/// body (L227895-227903)", () => {
    expect(parseSedEdit("sed -i 's/a\\/b/c/' f.txt")).toEqual({
      filePath: "f.txt", pattern: "a\\/b", replacement: "c", flags: "", extendedRegex: false,
    });
  });
});

describe("splitSimpleCommand — the one-simple-command gate", () => {
  it("splits on whitespace and strips quoting the way `Xco`/`$Vg` do (L143914-143920)", () => {
    expect(splitSimpleCommand("sed -i 's/a b/c/' 'my file.txt'")).toEqual(["sed", "-i", "s/a b/c/", "my file.txt"]);
    expect(splitSimpleCommand('sed -i "s/a/b/" f.txt')).toEqual(["sed", "-i", "s/a/b/", "f.txt"]);
    expect(splitSimpleCommand("sed -i '' f.txt")).toEqual(["sed", "-i", "", "f.txt"]);
    expect(splitSimpleCommand("rm a\\ b")).toEqual(["rm", "a b"]);
    expect(splitSimpleCommand("ls -la # a trailing comment")).toEqual(["ls", "-la"]);
  });

  it("rejects anything that is not ONE simple command", () => {
    for (const bad of ["a | b", "a && b", "a; b", "a > f", "a < f", "a & ", "a\nb", "a `b`", "a $(b)", "a $HOME", "a 'unterminated"]) {
      expect(splitSimpleCommand(bad)).toBeNull();
    }
  });
});

describe("simulateSedEdit / sedEditPreview (`Qod` L227911, `DCs` L228484)", () => {
  const sed = (over: Partial<SedEdit> = {}): SedEdit =>
    ({ filePath: "f.txt", pattern: "a", replacement: "b", flags: "", extendedRegex: false, ...over });

  it("replaces once without `g` and everywhere with it", () => {
    expect(simulateSedEdit("aaa", sed())).toBe("baa");
    expect(simulateSedEdit("aaa", sed({ flags: "g" }))).toBe("bbb");
  });

  it("maps sed's `&` onto the whole match and honours `\\&`", () => {
    expect(simulateSedEdit("cat", sed({ pattern: "a", replacement: "[&]" }))).toBe("c[a]t");
    expect(simulateSedEdit("cat", sed({ pattern: "a", replacement: "\\&" }))).toBe("c&t");
  });

  it("translates BRE escapes unless -E/-r was given", () => {
    expect(simulateSedEdit("aab", sed({ pattern: "a\\+", replacement: "X" }))).toBe("Xb");     // BRE: \+ is the quantifier
    expect(simulateSedEdit("a+b", sed({ pattern: "a+", replacement: "X" }))).toBe("Xb");       // BRE: bare + is literal
    expect(simulateSedEdit("aab", sed({ pattern: "a+", replacement: "X", extendedRegex: true }))).toBe("Xb");
  });

  it("returns the content untouched when the pattern will not compile", () => {
    expect(simulateSedEdit("abc", sed({ pattern: "[", extendedRegex: true }))).toBe("abc");
  });

  it("builds the descriptor's edit list off an injected reader, never the real fs", () => {
    const hit = sedEditPreview(sed({ filePath: "/w/f.txt" }), { readFile: () => "a a a" });
    expect(hit.edits).toEqual([{ old_string: "a a a", new_string: "b a a", replace_all: false }]);
    expect(hit.message).toBeUndefined();

    const miss = sedEditPreview(sed({ filePath: "/w/f.txt" }), { readFile: () => "zzz" });
    expect(miss.edits).toEqual([]);
    expect(miss.message).toBe("Pattern did not match any content");

    const gone = sedEditPreview(sed({ filePath: "/w/f.txt" }), { readFile: () => undefined });
    expect(gone.edits).toEqual([]);
    expect(gone.message).toBe("File does not exist");
  });

  it("resolves the descriptor path against the injected cwd (`Pi` in `DCs` L228485)", () => {
    expect(sedEditPreview(sed({ filePath: "notes.md" }), { readFile: () => undefined, cwd: "/w" }).filePath).toBe("/w/notes.md");
  });
});
