// test/tui/settingsFile.test.ts — the shared JSON-settings read/merge/write module (Wave 3 task 3; Tasks
// 5/7 reuse it). EVERY test supplies its own read/write/home fakes so nothing here ever touches the real
// filesystem or the developer's actual ~/.claude/settings.json — mirroring the seam's own design contract.
import { describe, it, expect } from "vitest";
import { settingsPath, mergeSettingsFile, appendToArray, type SettingsFileDeps } from "../../src/tui/settingsFile.js";

/** An in-memory fake fs: `files` is the backing store, `deps` the injectable seam under test. */
function fakeFiles(initial: Record<string, string> = {}) {
  const files = { ...initial };
  const writes: { path: string; content: string }[] = [];
  const deps: SettingsFileDeps = {
    read: (p) => {
      if (!(p in files)) { const e: any = new Error("ENOENT"); e.code = "ENOENT"; throw e; }
      return files[p];
    },
    write: (p, s) => { files[p] = s; writes.push({ path: p, content: s }); },
    home: "/fake/home",
  };
  return { files, writes, deps };
}

describe("settingsPath", () => {
  it("localSettings → <cwd>/.claude/settings.local.json", () => {
    expect(settingsPath("localSettings", "/repo")).toBe("/repo/.claude/settings.local.json");
  });
  it("projectSettings → <cwd>/.claude/settings.json", () => {
    expect(settingsPath("projectSettings", "/repo")).toBe("/repo/.claude/settings.json");
  });
  it("userSettings honors the injected home", () => {
    expect(settingsPath("userSettings", "/repo", { home: "/fake/home" })).toBe("/fake/home/.claude/settings.json");
  });
});

describe("mergeSettingsFile", () => {
  it("merge preserves unknown keys (siblings at every level survive)", () => {
    const { files, writes, deps } = fakeFiles({
      "/repo/.claude/settings.local.json": JSON.stringify({ theme: "dark", permissions: { allow: ["Bash"] } }),
    });
    mergeSettingsFile("localSettings", "/repo", appendToArray(["permissions", "additionalDirectories"], "/outside"), deps);
    expect(writes).toHaveLength(1);
    const written = JSON.parse(files["/repo/.claude/settings.local.json"]);
    expect(written.theme).toBe("dark");
    expect(written.permissions.allow).toEqual(["Bash"]);
    expect(written.permissions.additionalDirectories).toEqual(["/outside"]);
  });

  it("missing file → treated as {} with the patch applied fresh", () => {
    const { files, deps } = fakeFiles({});   // no entry at all → read() throws ENOENT
    mergeSettingsFile("localSettings", "/repo", appendToArray(["permissions", "additionalDirectories"], "/outside"), deps);
    expect(JSON.parse(files["/repo/.claude/settings.local.json"])).toEqual({ permissions: { additionalDirectories: ["/outside"] } });
  });

  it("corrupt file → treated as {} with the patch applied fresh", () => {
    const { files, deps } = fakeFiles({ "/repo/.claude/settings.local.json": "{not json at all" });
    mergeSettingsFile("localSettings", "/repo", appendToArray(["permissions", "additionalDirectories"], "/outside"), deps);
    expect(JSON.parse(files["/repo/.claude/settings.local.json"])).toEqual({ permissions: { additionalDirectories: ["/outside"] } });
  });

  it("userSettings path honors the injected home", () => {
    const { files, deps } = fakeFiles({});
    mergeSettingsFile("userSettings", "/repo", appendToArray(["a"], "b"), deps);
    expect(Object.keys(files)).toEqual(["/fake/home/.claude/settings.json"]);
  });

  it("does not mutate the object the patch function received (sibling arrays untouched)", () => {
    // Exercise appendToArray directly against a captured `current` — mergeSettingsFile's own
    // JSON.parse(read(path)) call always hands the patch a freshly-parsed object, so routing through the
    // full merge (as the previous version of this test did) can only ever prove something about the
    // WRITTEN json, never about whether appendToArray mutated the object it was actually given. Calling it
    // here directly, then re-inspecting `original` afterwards, is what makes an in-place mutation fail.
    const original = { permissions: { additionalDirectories: ["/keep"] } };
    const originalDirs = original.permissions.additionalDirectories;
    const patch = appendToArray(["permissions", "additionalDirectories"], "/new");
    const next = patch(original);
    // The input object (and its nested array) are untouched — appendToArray shallow-clones at every level
    // instead of writing through.
    expect(original).toEqual({ permissions: { additionalDirectories: ["/keep"] } });
    expect(original.permissions.additionalDirectories).toBe(originalDirs);   // same array reference, not just equal contents
    // The returned object is a genuinely different value carrying the merged result.
    expect(next).not.toBe(original);
    expect(next.permissions).not.toBe(original.permissions);
    expect(next.permissions.additionalDirectories).toEqual(["/keep", "/new"]);
  });
});

describe("appendToArray", () => {
  it("dedups: appending the same value twice keeps one entry", () => {
    const patch = appendToArray(["permissions", "additionalDirectories"], "/outside");
    const once = patch({});
    const twice = patch(once);
    expect(twice.permissions.additionalDirectories).toEqual(["/outside"]);
  });
  it("creates intermediate objects that don't exist yet", () => {
    const patch = appendToArray(["a", "b", "c"], "v");
    expect(patch({})).toEqual({ a: { b: { c: ["v"] } } });
  });
});
