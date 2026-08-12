// appserver/workspace.ts — the workspace cluster: `fs/read` and `fs/search` (spec §2, M3 Task 12), the pair
// a GUI client needs to show a file the agent touched and to offer a file picker of its own, and
// `thread/shellCommand` (spec §3, Task 13), the display-only shell escape. One module because all three
// answer for THIS MACHINE's filesystem rather than for a conversation — the same trust posture, the same
// unsandboxed reasoning, and (for the two that take a directory) the same rooting.
//
// THE PAIR IS SERVER-SCOPED BY CONSTRUCTION. Neither takes a `threadId`, so neither passes through
// dispatch's -33005 or origin gates (server.ts) — there is no record to judge. That is also what makes them
// the right shape for the job: a client browsing a workspace is not addressing a conversation, and a fleet
// thread's tree is as readable as an inProcess one's because the path, not the thread, is the subject.
// `thread/shellCommand` names a thread for one reason only — a command has to run SOMEWHERE, and the
// thread is what knows where — and it is gated accordingly (see its own note).
//
// TRUSTED-CLIENT, UNSANDBOXED — Codex parity. Their reads run sandbox-None server-side, and a client that
// has already cleared the Bearer handshake can start a turn that reads any file anyway; a path allowlist
// here would refuse the reader while leaving the writer wide open. The one guard that IS worth its weight
// is the size cap, which is about the client's memory rather than the client's rights.
//
// EVERY REFUSAL IS -32602. An fs failure is bad-request-class: the request named a path this machine
// cannot serve, which is a fact about the request. -32603 would tell a client the SERVER broke and invite
// a retry that can only fail the same way.
//
// The SDK's own `Query.readFile` deliberately backs none of this: probe 104 found it callable but
// resolving null for an existing file and for a missing path alike, so there is nothing to serve from it.
import { isAbsolute, resolve } from "node:path";
import { readdir, open } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { constants } from "node:fs";
import type { Stats } from "node:fs";
import { collectEntries, rankCandidates } from "../tui/fileComplete.js";
import type { AsyncReaddirFn } from "../tui/fileComplete.js";
import { runBash, type BashResult } from "../tui/bash.js";
import { ERR } from "./rpc.js";
import { threadCwd } from "./registry.js";
import type { Handler } from "./server.js";
import { fsReadParams, fsSearchParams, shellCommandParams } from "./schema/workspace.js";

/** A RECORDED DEVIATION from Codex, which caps nothing (spec §2): a browser client asking for a 2 GB
 *  core dump gets a clear refusal instead of a base64 string a third larger than the file that OOMs the
 *  server building it and the client holding it. */
export const READ_CAP_BYTES = 4 * 1024 * 1024;
/** Codex's MATCH_LIMIT, and the schema's max — so `limit` only ever narrows. */
const DEFAULT_LIMIT = 50;
/** THE OUTER BOUND ON A `thread/shellCommand` REQUEST, above the seam's own inner 30 s — so it only ever
 *  fires for a child that IGNORED the SIGTERM that timeout sends. See the handler's note. */
export const SHELL_DEADLINE_MS = 40_000;
const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** The fd opener `fs/read` rides, exposed so a test can substitute a tracked FileHandle and assert the
 *  read rides ONE descriptor and it is closed on the refusal path (the TOCTOU fix is structural — a true
 *  swap race cannot be staged deterministically). Nothing else reads this. */
export const fsReadInternals = { open };

/** Names the kind a refused path turned out to be, so the client is told WHY its path is unservable rather
 *  than being handed a bare "not a regular file". `stat` follows symlinks, so no symlink case appears. */
const kindOf = (st: Stats): string =>
  st.isDirectory() ? "directory"
  : st.isFIFO() ? "FIFO"
  : st.isSocket() ? "socket"
  : st.isCharacterDevice() ? "character device"
  : st.isBlockDevice() ? "block device"
  : "unknown kind";

/** The walker's injected `readdir` (fileComplete.ts takes one so the TUI's tests can walk a fake tree).
 *  A symlink reads as a FILE here, `isDirectory()` being false for one — the walk therefore never follows
 *  a link, which is what keeps a cyclic tree from hanging this handler. */
const realReaddir: AsyncReaddirFn = async (dir) =>
  (await readdir(dir, { withFileTypes: true })).map((d) => ({ name: d.name, isDir: d.isDirectory() }));

/** `fs/read {path}` → `{dataBase64, size}`. Base64 because the payload is BYTES: a client reading an
 *  image, a lockfile or a half-written UTF-8 sequence must get back exactly what is on disk, and a JSON
 *  string cannot carry that. */
export const fsRead: Handler = async (_srv, ctx, id, params) => {
  const parsed = fsReadParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const path = parsed.data.path;
  // No cwd-relative resolution, on purpose: this server's cwd is not the client's, and quietly resolving
  // against ours would answer a DIFFERENT file than the one the client believes it asked for.
  if (!isAbsolute(path)) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "path must be absolute"); return; }
  // ONE descriptor for the whole read, which is what closes the stat→read TOCTOU: the old code `stat`ed the
  // path and then `readFile`d it by PATH, re-opening a possibly-different inode — a file swapped for a
  // FIFO/device/large file between the two calls bypassed the kind + size guard, and the read could then
  // hang or grow unbounded (the request-never-settles class). Open ONCE, `fstat` THAT descriptor (the same
  // inode the read will use), guard on it, then read from the fd — no second path resolution, so the swap
  // window is gone. `O_NONBLOCK` so opening a FIFO with no writer returns immediately rather than blocking
  // in `open(2)` (the very hang the kind guard exists to prevent); it has no effect on the regular files
  // that pass the guard. `?? 0` because Windows has no O_NONBLOCK — and no FIFOs, so an open never blocks.
  let fh: FileHandle;
  // The fs message verbatim (`ENOENT: no such file...`, `EACCES: permission denied...`): it names the
  // errno and the path, the whole of what a client can act on; any rewording would be this module guessing.
  try { fh = await fsReadInternals.open(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0)); }
  catch (e) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, msg(e)); return; }
  try {
    const st: Stats = await fh.stat();
    // ONLY A REGULAR FILE, and this guard is what makes the cap below mean anything. `fstat` reports
    // `size: 0` for every other kind, so a FIFO or a character device would sail past the cap and a read of
    // one would block (FIFO) or grow without end (`/dev/zero`). Refusing by kind closes both, and subsumes
    // the directory case. Verbatim the message the path-`stat` version produced.
    if (!st.isFile()) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, `not a regular file (${kindOf(st)})`); return; }
    if (st.size > READ_CAP_BYTES) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, `file exceeds the 4 MiB read cap (${st.size} bytes)`); return; }
    // Read from the SAME descriptor (not a re-open by path) — a regular file can still fail the read on its
    // own (`EACCES`), which is bad-request-class here, never the dispatcher's -32603, keeping this module's
    // one rule. `size` is the PAYLOAD's length, what a client sizing its decode buffer was actually sent.
    const data = await fh.readFile();
    ctx.peer.reply(id, { dataBase64: data.toString("base64"), size: data.byteLength });
  } catch (e) {
    ctx.peer.replyError(id, ERR.INVALID_PARAMS, msg(e));
  } finally {
    await fh.close().catch(() => {});   // one descriptor, released on every path — refusal and success alike
  }
};

/** `fs/search {query, roots?, limit?}` → `{matches: [{root, path, score}]}` — the TUI's @-mention ranker
 *  (`src/tui/fileComplete.ts`), one root at a time, merged.
 *
 *  REUSED, not re-implemented: `collectEntries` + `rankCandidates` are the same two functions the
 *  composer's file picker runs, so a client's search and the terminal's popup see the same candidates and
 *  SCORE them identically — including the ignore rules (`node_modules`, `.git`, dotfiles) and the
 *  1000-entry walk cap. Not byte-identical ORDER, though: `rankCandidates` breaks a score tie on path
 *  length and then lexically, while the cross-root re-sort below keeps only the lexical half, so equally
 *  scored matches can come back in a different order than the popup shows them. Directories
 *  come back as matches of their own, carrying the walker's trailing slash (its documented
 *  `isDir === path.endsWith("/")` invariant), which is how a client tells the two apart without a field.
 *
 *  `path` is ROOT-RELATIVE and `root` rides beside it, so a client can join them itself and a match is
 *  readable without knowing which root produced it. (`WalkOpts.root` is NOT this root: it is a
 *  cwd-relative prefix for re-rooting a walk BELOW its base, and the base is the first argument.)
 *
 *  No highlight indices — our ranker produces none (recorded deviation, §2). No warm index: every call
 *  re-walks, as the TUI's does. */
export const fsSearch: Handler = async (_srv, ctx, id, params) => {
  const parsed = fsSearchParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const { query } = parsed.data;
  const limit = parsed.data.limit ?? DEFAULT_LIMIT;
  // Before any walk: an empty query matches everything, and `rankCandidates` would answer it with the
  // first `limit` paths in walk order — a listing dressed up as a search result. §2 says empty.
  if (!query.trim()) { ctx.peer.reply(id, { matches: [] }); return; }
  // This process's cwd is the only "the workspace" this server knows — it holds no configured root, and
  // inventing a second source of truth for one is what `threadView.cwd` (server.ts) already avoids by
  // reporting the same value for an inProcess thread whose config named no cwd.
  // Dedupe by NORMALIZED path before any walk (external review F4): "x", "./x" and "x/" name one directory,
  // and each spelling would otherwise drive its own independent recursive walk — the disproportionate fs
  // work the schema's root cap bounds. The FIRST spelling seen is kept, since the original string rides
  // beside each match as `root`; the schema has already refused an over-cap array (-32602) above.
  const requested = parsed.data.roots ?? [process.cwd()];
  const seen = new Set<string>();
  const roots = requested.filter((r) => { const key = resolve(r); if (seen.has(key)) return false; seen.add(key); return true; });
  const merged: Array<{ root: string; path: string; score: number }> = [];
  for (const root of roots) {
    // A ROOT THAT CANNOT BE WALKED CONTRIBUTES NOTHING, and the request still succeeds (§2, Codex's own
    // behavior): a client searching three roots, one of which it lacks permission on, wants the other
    // two's answers rather than an error naming none of them. No catch is needed for it here — the swallow
    // lives in the walker: `collectEntries` wraps EVERY `readdir`, the base directory's included
    // (`fileComplete.ts:61`), so an unwalkable root returns `[]` instead of throwing.
    const paths = (await collectEntries(root, realReaddir)).map((e) => e.path);
    for (const c of rankCandidates(paths, query, limit)) merged.push({ root, path: c.path, score: c.score });
  }
  // Re-sorted ACROSS roots — each root was ranked against the same query, so the scores are comparable,
  // and concatenating per-root blocks would put a weak hit from the first root above a strong one from
  // the second. Ties break on path so the answer is stable between identical calls.
  merged.sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  ctx.peer.reply(id, { matches: merged.slice(0, limit) });
};

/** `thread/shellCommand {threadId, command}` → `{code, output, timedOut?}` (spec §3) — the TUI's `!cmd`
 *  over the wire, run in the thread's own cwd over the SAME primitive (`src/tui/bash.ts`'s `runBash`: a
 *  full shell string through `exec`, a 30 s SIGTERM timeout, a 4 MiB output cap, and a promise that never
 *  rejects, so every outcome is a result rather than an RPC error).
 *
 *  DISPLAY-ONLY, and this is the spec's recorded deviation from Codex (D-M3-2): their `thread/shellCommand`
 *  streams output into the turn, so the model reads it. Ours returns it to the ONE client that asked and
 *  leaves the conversation untouched — the TUI's `!` semantics, which is what an escape hatch is for. A
 *  client that wants the model to see something still has `turn/start`.
 *
 *  UN-CHAINED, deliberately: no busy check and no `record.chain`. Every other thread-scoped method
 *  serializes because it drives the engine, and this one never touches it — the command runs concurrently
 *  with whatever the turn is doing, exactly as `!` does mid-turn in the terminal. Queuing it behind a turn
 *  would make "peek at the disk while it works" the one thing the escape hatch cannot do.
 *
 *  TWO TIMEOUTS, and only the outer one bounds the REQUEST. The seam's `timeout: 30_000` bounds the CHILD,
 *  and it bounds it with a SIGTERM that `runBash` never escalates — so a command that ignores TERM
 *  (`trap '' TERM`, or any process with a handler that declines to exit) leaves that promise unsettled
 *  forever and this RPC never answers at all. Un-chained, that is worse than a slow method: a client can
 *  stack up hung requests, each holding a JSON-RPC id that will never be released. The handler therefore
 *  races `runBash` against `SHELL_DEADLINE_MS`, set ABOVE the inner 30 s so the ordinary timeout path still
 *  belongs to the seam and this arm fires only for a TERM-proof child.
 *
 *  Its reply is an ADMISSION, not a kill: we abandon the child and say so, because escalating to SIGKILL
 *  would mean reaching past `runBash` into a process the shared TUI seam owns. The child leaks — a real
 *  residual, acceptable only because this method already hands a trusted client arbitrary unsandboxed
 *  execution, so a process it deliberately made unkillable is its own to clean up. The note names the leak
 *  so a client is never told "timed out" while something of its making is still running. The leak has a
 *  SECOND half, and it is ours rather than the client's: the abandoned child also pins THIS process's exit.
 *  `exec`'s stdio handles stay referenced in our event loop and `runBash` hands back only a promise, so
 *  there is no handle here to unref — measured, the reply lands at 1503 ms and the server process exits at
 *  10037 ms, when the child finally died. A supervisor awaiting a graceful exit therefore hangs until
 *  something outside this handler kills the child.
 *
 *  GATED NORMALLY on -33005 (it is NOT in `ENGINE_GONE_EXEMPT`), which is the opposite choice and the
 *  right one: a thread whose engine is gone is dead for every method a client can name on it, and one
 *  surface that kept working would invite a client to treat a dead thread as half-alive. The record is the
 *  only thing this handler reads, so that lookup is the whole of its engine adjacency.
 *
 *  Unsandboxed by design, like Codex's — see this module's trust note. */
export const shellCommand: Handler = async (srv, ctx, id, params) => {
  const parsed = shellCommandParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const record = srv.registry.get(parsed.data.threadId);
  if (!record) { ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return; }
  // `threadCwd` is `threadView.cwd`'s own function (registry.ts), so the command lands where the client was
  // told this thread lives. Undefined means a fleet record that attached with no roster cwd — TYPE-
  // unreachable (`RosterRow.cwd` is required) but RUNTIME-reachable, because `readRoster` casts parsed JSON
  // and validates `short` alone (fleet/roster.ts), so a legacy or hand-edited row can carry no cwd at all.
  // This refusal is therefore load-bearing rather than tidy: defaulting would run an unsandboxed command in
  // a directory the caller never named, and "somewhere else" is not a safe degradation for an exec.
  const cwd = threadCwd(record);
  if (cwd === undefined) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "thread has no cwd to run in"); return; }
  const deadlineMs = srv.deps.shellDeadlineMs ?? SHELL_DEADLINE_MS;
  // The deadline is a RESULT, not a rejection, so it composes with the primitive's own "never rejects"
  // contract and the reply shape stays one type. `Promise.race` is what makes the double-reply structurally
  // impossible: whichever arm lands first is the only value this `await` ever sees, and a late `runBash`
  // settle (the child finally dying, minutes later) is discarded with nothing left listening for it.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const abandoned = new Promise<BashResult>((resolve) => {
    timer = setTimeout(() => resolve({ code: 1, timedOut: true, output: `<harness note: command ignored SIGTERM and exceeded the ${deadlineMs / 1000}s harness deadline; its process may still be running>` }), deadlineMs);
    (timer as { unref?: () => void }).unref?.();   // a pending deadline must not be a reason to stay alive
  });
  const result = await Promise.race([runBash(parsed.data.command, cwd), abandoned]);
  clearTimeout(timer);                              // the ordinary path leaves no timer behind
  ctx.peer.reply(id, result);
};
