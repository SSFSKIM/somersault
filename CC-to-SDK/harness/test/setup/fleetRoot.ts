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
import { afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "ccx-vitest-"));
process.env.CCX_FLEET_ROOT = root;
afterAll(() => { rmSync(root, { recursive: true, force: true }); });
