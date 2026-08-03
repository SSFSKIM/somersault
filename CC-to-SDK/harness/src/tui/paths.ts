// tui/src/paths.ts — the ONE display-path rule (upstream `wd()`, L36791–36799), extracted out of
// toolRenderer.tsx by F1 Task 5c so the fold model can share it: `toolFold.ts` needs `displayPath` for a
// read run's `⎿` hint, and toolRenderer.tsx needs the fold model for its group rows — importing it from a
// leaf module is what keeps those two out of an import cycle. toolRenderer.tsx re-exports it, so its public
// surface is unchanged. No deps beyond node:path → safe to import anywhere.
import { relative, resolve, sep } from "node:path";

/** cwd-first, home-second: a path inside the session cwd shows relative to it even when the project itself lives
 *  under $HOME (so `~/project/src/app.ts` reads `src/app.ts`); only an outside path falls back to `~`/absolute. */
export function displayPath(path: string, cwd: string, home: string): string {
  const absolute = resolve(cwd, path), fromCwd = relative(cwd, absolute);
  if (!fromCwd || (fromCwd !== ".." && !fromCwd.startsWith(`..${sep}`))) return fromCwd || ".";
  if (absolute === home) return "~";
  if (absolute.startsWith(home + sep)) return `~/${relative(home, absolute)}`;
  return absolute;
}
