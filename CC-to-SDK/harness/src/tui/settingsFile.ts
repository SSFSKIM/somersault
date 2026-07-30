// tui/src/settingsFile.ts — read-parse-merge-write for JSON settings files, preserving unknown keys (Wave 3
// SHARED module: Task 3's /add-dir "remember this directory" is the first caller; Tasks 5/7 reuse it for
// permission-rule and config saves). EVERY path goes through the injectable `deps` seam — production code
// is the only caller allowed to omit it (or a given field of it); an Ink test must always supply its own
// read/write/home fakes, or it risks touching the developer's REAL ~/.claude/settings.json.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface SettingsFileDeps { read?: (p: string) => string; write?: (p: string, s: string) => void; home?: string }
export type SettingsTarget = "localSettings" | "projectSettings" | "userSettings";

/** target → the JSON file it maps to. `userSettings` resolves `home` from `deps` first, falling back to
 *  the real `os.homedir()` only when no deps (or no `home` field) were given. */
export function settingsPath(target: SettingsTarget, cwd: string, deps?: SettingsFileDeps): string {
  if (target === "localSettings") return join(cwd, ".claude", "settings.local.json");
  if (target === "projectSettings") return join(cwd, ".claude", "settings.json");
  return join(deps?.home ?? homedir(), ".claude", "settings.json");
}

/** Read (missing OR corrupt → `{}`) → patch → write, pretty-printed. `patch` receives the WHOLE parsed
 *  object (or `{}`) and returns the whole next object — callers own the merge shape; `appendToArray` below
 *  is the one every /add-dir-shaped caller needs. */
export function mergeSettingsFile(target: SettingsTarget, cwd: string, patch: (current: any) => any, deps?: SettingsFileDeps): void {
  const path = settingsPath(target, cwd, deps);
  const read = deps?.read ?? ((p: string) => readFileSync(p, "utf8"));
  const write = deps?.write ?? ((p: string, s: string) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, s); });
  let current: unknown;
  try { current = JSON.parse(read(path)); } catch { current = {}; }   // ENOENT or bad JSON → patch applies fresh, same either way
  const next = patch(current && typeof current === "object" ? current : {});
  write(path, `${JSON.stringify(next, null, 2)}\n`);
}

/** A `patch` factory: ensures `current[...path]` is an array containing `value` (deduped), shallow-cloning
 *  every object along `path` (so sibling keys at each level survive untouched, and the caller's own
 *  `current` object is never mutated in place) and creating intermediate objects that don't exist yet.
 *  `mergeSettingsFile("localSettings", cwd, appendToArray(["permissions","additionalDirectories"], abs))`
 *  is the /add-dir "remember this directory" call. */
export function appendToArray(path: string[], value: string): (current: any) => any {
  return (current: any) => {
    const next: any = current && typeof current === "object" ? { ...current } : {};
    let cursor = next;
    for (const key of path.slice(0, -1)) {
      cursor[key] = cursor[key] && typeof cursor[key] === "object" && !Array.isArray(cursor[key]) ? { ...cursor[key] } : {};
      cursor = cursor[key];
    }
    const leaf = path[path.length - 1];
    const arr: string[] = Array.isArray(cursor[leaf]) ? [...cursor[leaf]] : [];
    if (!arr.includes(value)) arr.push(value);
    cursor[leaf] = arr;
    return next;
  };
}
