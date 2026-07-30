// test/tui/addDir.test.ts — pure validation + copy tests for `/add-dir` (Wave 3 task 3). validateAddDir
// takes an injected fs facade ({existsSync, statSync}) so no test touches the real filesystem; tilde
// expansion is exercised against the REAL os.homedir() (deterministic on any machine, not mocked) since
// that's the one part of the resolve pipeline that isn't fs-facaded.
import { homedir } from "node:os";
import { describe, it, expect } from "vitest";
import { validateAddDir, formatAddDirVerdict, formatAddDirResult, dirLabel, type FsFacade } from "../../src/tui/addDir.js";

const CWD = "/repo";

/** A minimal in-memory fs facade: `dirs`/`files` are absolute paths that "exist" as that kind of entry. */
function fakeFs(dirs: string[], files: string[] = []): FsFacade {
  const dirSet = new Set(dirs);
  const fileSet = new Set(files);
  return {
    existsSync: (p) => dirSet.has(p) || fileSet.has(p),
    statSync: (p) => ({ isDirectory: () => dirSet.has(p) }),
  };
}

describe("validateAddDir", () => {
  it("empty → Please provide a directory path.", () => {
    const v = validateAddDir("", CWD, [], fakeFs([]));
    expect(v).toEqual({ kind: "empty" });
    expect(formatAddDirVerdict(v)).toEqual([{ text: "Please provide a directory path." }]);
  });

  it("empty (whitespace-only) also counts as empty", () => {
    expect(validateAddDir("   ", CWD, [], fakeFs([]))).toEqual({ kind: "empty" });
  });

  it("missing path → Path <abs> was not found. (bold abs, tilde-expanded + resolved)", () => {
    const abs = `${homedir()}/nope`;
    const v = validateAddDir("~/nope", CWD, [], fakeFs([]));
    expect(v).toEqual({ kind: "missing", abs });
    const lines = formatAddDirVerdict(v);
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe(`Path ${abs} was not found.`);
    expect(lines[0].segments).toEqual([{ text: "Path " }, { text: abs, bold: true }, { text: " was not found." }]);
  });

  it("file → is not a directory + parent suggestion", () => {
    const v = validateAddDir("/repo/file.txt", CWD, [], fakeFs([], ["/repo/file.txt"]));
    expect(v).toEqual({ kind: "notDir", abs: "/repo/file.txt", parent: "/repo" });
    const lines = formatAddDirVerdict(v);
    expect(lines[0].text).toBe("/repo/file.txt is not a directory. Did you mean to add the parent directory /repo?");
    expect(lines[0].segments).toEqual([
      { text: "/repo/file.txt", bold: true },
      { text: " is not a directory. Did you mean to add the parent directory " },
      { text: "/repo", bold: true },
      { text: "?" },
    ]);
  });

  it("cwd itself → already the current working directory", () => {
    const v = validateAddDir(CWD, CWD, [], fakeFs([CWD]));
    expect(v).toEqual({ kind: "cwdSelf", abs: CWD });
    expect(formatAddDirVerdict(v)[0].text).toBe(`${CWD} is already the current working directory.`);
  });

  it("already-added dir → already added as a working directory", () => {
    const v = validateAddDir("/outside", CWD, ["/outside"], fakeFs([CWD, "/outside"]));
    expect(v).toEqual({ kind: "alreadyAdded", abs: "/outside" });
    expect(formatAddDirVerdict(v)[0].text).toBe("/outside is already added as a working directory.");
  });

  it("subdir of cwd → already accessible within the current working directory <cwd>", () => {
    const v = validateAddDir("/repo/sub", CWD, [], fakeFs([CWD, "/repo/sub"]));
    expect(v).toEqual({ kind: "subdirOfCwd", abs: "/repo/sub", cwd: CWD });
    expect(formatAddDirVerdict(v)[0].text).toBe(`/repo/sub is already accessible within the current working directory ${CWD}.`);
  });

  it("subdir of an added dir → already accessible within the additional working directory <dir>", () => {
    const v = validateAddDir("/outside/sub", CWD, ["/outside"], fakeFs([CWD, "/outside", "/outside/sub"]));
    expect(v).toEqual({ kind: "subdirOfAdded", abs: "/outside/sub", dir: "/outside" });
    expect(formatAddDirVerdict(v)[0].text).toBe("/outside/sub is already accessible within the additional working directory /outside.");
  });

  it("valid outside dir → ok with absolute path", () => {
    const v = validateAddDir("/outside", CWD, [], fakeFs([CWD, "/outside"]));
    expect(v).toEqual({ kind: "ok", abs: "/outside" });
    expect(formatAddDirVerdict(v)).toEqual([]);
  });

  it("path-segment-aware containment: /a/bc is NOT inside /a/b", () => {
    const v = validateAddDir("/a/bc", "/a/b", [], fakeFs(["/a/b", "/a/bc"]));
    expect(v).toEqual({ kind: "ok", abs: "/a/bc" });
  });

  it("relative input resolves against cwd", () => {
    const v = validateAddDir("../sibling", "/repo/nested", [], fakeFs(["/repo/nested", "/repo/sibling"]));
    expect(v).toEqual({ kind: "ok", abs: "/repo/sibling" });
  });
});

describe("formatAddDirResult", () => {
  it("addedSession", () => {
    expect(formatAddDirResult({ kind: "addedSession", abs: "/x" })[0].text)
      .toBe("Added /x as a working directory for this session · /permissions to manage");
  });
  it("addedRemembered", () => {
    expect(formatAddDirResult({ kind: "addedRemembered", abs: "/x" })[0].text)
      .toBe("Added /x as a working directory and saved to local settings · /permissions to manage");
  });
  it("addedSaveFailed", () => {
    expect(formatAddDirResult({ kind: "addedSaveFailed", abs: "/x", err: "EACCES" })[0].text)
      .toBe("Added /x as a working directory. Failed to save to local settings: EACCES · /permissions to manage");
  });
  it("cancelledEmpty", () => {
    expect(formatAddDirResult({ kind: "cancelledEmpty" })[0].text).toBe("Did not add a working directory.");
  });
  it("cancelledPath", () => {
    expect(formatAddDirResult({ kind: "cancelledPath", abs: "/x" })[0].text).toBe("Did not add /x as a working directory.");
    expect(formatAddDirResult({ kind: "cancelledPath", abs: "/x" })[0].segments).toEqual([
      { text: "Did not add " }, { text: "/x", bold: true }, { text: " as a working directory." },
    ]);
  });
});

describe("dirLabel", () => {
  it("cwd row carries the Original working directory suffix", () => {
    expect(dirLabel({ path: "/repo", source: "cwd" })).toBe("/repo (Original working directory)");
  });
  it("launch/session rows are plain", () => {
    expect(dirLabel({ path: "/x", source: "launch" })).toBe("/x");
    expect(dirLabel({ path: "/y", source: "session" })).toBe("/y");
  });
});
