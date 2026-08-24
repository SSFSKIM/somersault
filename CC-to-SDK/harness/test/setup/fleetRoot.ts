// test/setup/fleetRoot.ts — one throwaway `CCX_FLEET_ROOT` PER TEST FILE (vitest runs `setupFiles` once per
// file). Registered in vitest.config.ts.
//
// Why this exists, as of F5 task 7: the chat composer now writes to the fleet root during ordinary use — a
// submitted prompt appends a line to `history.jsonl`, and a paste too big to inline goes into `paste-cache/`
// — and it seeds its history back off that same file at mount. Before this, only a handful of tests touched
// the root and each pinned its own; now EVERY file that renders `<ChatComposer>` or `<ChatApp>` reads and
// writes it. A single static root shared by the whole run makes those files couple through the filesystem
// (file A's submitted prompt is file B's seeded history) and makes a second run differ from the first.
//
// A file that wants to observe its own writes still pins its own root or passes an explicit env; this only
// guarantees that a file which does NEITHER gets a private, empty one instead of the shared static path (and,
// as before, never the developer's real `~/.claude/ccx`).
//
// The hermetic-root ASSERTION below is the loud half. The quiet failure it replaces cost five days: a run
// whose fleet root resolved to the operator's real `~/.claude/ccx` left five zero-byte archive markers
// there, and every later `thread/list` that did not inject `ccxDir` read them back and filtered live
// threads named after those markers out of their own replies — with no error, on a byte-identical tree.
// Reading the operator's live state is never a legitimate configuration for this suite, so treat it as a
// setup failure rather than a silent fallback.
import { afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fleetRoot } from "../../src/fleet/paths.js";

/** homedir() itself, or anything beneath it. Path-segment comparison, not a string prefix, so a sibling
 *  directory whose name merely starts with the home path (`/Users/newer`) is not mistaken for a child. */
function underHome(p: string): boolean {
  const rel = relative(resolve(homedir()), resolve(p));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function assertHermetic(when: string): void {
  const root = fleetRoot();
  if (!underHome(root)) return;
  throw new Error(
    `[test/setup/fleetRoot.ts] refusing to run: the fleet root resolves ${when} to ${root}, inside your ` +
    `home directory (${homedir()}). The suite would read and write your LIVE ccx state — stale archive ` +
    `markers left there silently filter live threads out of thread/list replies. Point CCX_FLEET_ROOT at ` +
    `a throwaway directory, or run vitest so it discovers CC-to-SDK/harness/vitest.config.ts (which sets ` +
    `CCX_FLEET_ROOT for the whole run) rather than a foreign --config or a --root above the harness.`,
  );
}

// On entry: catches an invocation that loaded this file but not the config's `env` block (CCX_FLEET_ROOT
// unset ⇒ fleetRoot() falls through to $HOME/.claude/ccx), and an inherited shell export pointing home.
assertHermetic("on entry");
const root = mkdtempSync(join(tmpdir(), "ccx-vitest-"));
process.env.CCX_FLEET_ROOT = root;
// After pinning: catches a TMPDIR that itself lives under $HOME, so the private root is no safer.
assertHermetic("after this file pinned its own temp root");
afterAll(() => { rmSync(root, { recursive: true, force: true }); });
