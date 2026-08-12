// test/unit/appserver/workspace.test.ts — M3 Task 12: the server-scoped workspace pair `fs/read` +
// `fs/search` (spec §2). Driven wire-level through `srv.connect`/`feed` against REAL files in a tmpdir:
// both methods ARE filesystem behavior, so faking the filesystem would test nothing but the fake — the
// oversize refusal, the base64 round-trip of non-UTF8 bytes and the unreadable-root degradation each
// depend on what node's fs actually does.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppServer } from "../../../src/appserver/server.js";
import { fsReadInternals, READ_CAP_BYTES } from "../../../src/appserver/workspace.js";
import * as fileComplete from "../../../src/tui/fileComplete.js";
import { MAX_SEARCH_ROOTS } from "../../../src/appserver/schema/workspace.js";
import { ERR } from "../../../src/appserver/rpc.js";
import type { PeerSink } from "../../../src/appserver/peer.js";

const mkSink = () => { const lines: string[] = []; return { lines, sink: { write: (l: string) => void lines.push(l), buffered: () => 0, end: () => {} } as PeerSink }; };
const parsed = (lines: string[]) => lines.map((l) => JSON.parse(l) as Record<string, unknown>);

const servers: AppServer[] = [];
let root = "";
let conn: { feed(chunk: string): void };
let lines: string[];
let nextId = 100;

function boot(): void {
  const srv = new AppServer({}, {});
  servers.push(srv);
  const s = mkSink();
  conn = srv.connect(s.sink);
  conn.feed(JSON.stringify({ id: 1, method: "initialize", params: { clientInfo: { name: "T" } } }) + "\n");
  s.lines.length = 0;
  lines = s.lines;
}

/** One request, one reply. Both handlers touch the disk, so the reply is always a tick or more away. */
async function call(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const id = nextId++;
  conn.feed(JSON.stringify({ id, method, params }) + "\n");
  let frame: Record<string, unknown> | undefined;
  await vi.waitFor(() => { frame = parsed(lines).find((f) => f.id === id); expect(frame, `no reply for ${method}`).toBeDefined(); }, { timeout: 2000 });
  return frame as Record<string, unknown>;
}

const err = (frame: Record<string, unknown>): { code: number; message: string } => frame.error as { code: number; message: string };
const ok = (frame: Record<string, unknown>): Record<string, unknown> => frame.result as Record<string, unknown>;
type Match = { root: string; path: string; score: number };
const matches = (frame: Record<string, unknown>): Match[] => (ok(frame).matches as Match[]);

beforeEach(() => { root = mkdtempSync(join(tmpdir(), "ccx-fs-")); boot(); });
afterEach(async () => {
  for (const srv of servers.splice(0)) await srv.shutdown().catch(() => {});
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

describe("fs/read", () => {
  it("round-trips the exact bytes of a binary file", async () => {
    // Bytes no UTF-8 decode survives — the whole reason the payload is base64 rather than a string.
    const bytes = Buffer.from([0x00, 0x01, 0xff, 0xfe, 0x80, 0x0a, 0xc3, 0x28]);
    const file = join(root, "blob.bin");
    writeFileSync(file, bytes);
    const res = ok(await call("fs/read", { path: file }));
    expect(res.size).toBe(bytes.length);
    expect(Buffer.compare(Buffer.from(res.dataBase64 as string, "base64"), bytes)).toBe(0);
  });

  it("refuses a relative path with -32602", async () => {
    const e = err(await call("fs/read", { path: "blob.bin" }));
    expect(e.code).toBe(ERR.INVALID_PARAMS);
    expect(e.message).toMatch(/absolute/i);
  });

  it("refuses a missing file with -32602 carrying the fs error", async () => {
    const e = err(await call("fs/read", { path: join(root, "nope.txt") }));
    expect(e.code).toBe(ERR.INVALID_PARAMS);
    expect(e.message).toContain("ENOENT");
  });

  it("refuses a file over the 4 MiB cap, naming the cap and the size", async () => {
    const file = join(root, "big.bin");
    writeFileSync(file, Buffer.alloc(5 * 1024 * 1024));
    const e = err(await call("fs/read", { path: file }));
    expect(e.code).toBe(ERR.INVALID_PARAMS);
    expect(e.message).toBe("file exceeds the 4 MiB read cap (5242880 bytes)");
  });

  it("refuses a directory with -32602 rather than -32603", async () => {
    // `stat` SUCCEEDS on a directory, so this refusal comes from the kind check — and an fs failure is
    // bad-request-class on every path (Codex parity), never the dispatcher's internal catch.
    const e = err(await call("fs/read", { path: root }));
    expect(e.code).toBe(ERR.INVALID_PARAMS);
    expect(e.message).toBe("not a regular file (directory)");
  });

  it.skipIf(process.platform === "win32")("refuses a FIFO instead of hanging on it forever", async () => {
    // THE CAP'S HOLE, and the worst failure this module can have: `stat` reports `size: 0` for a FIFO, so
    // the 4 MiB cap waves it through, and `readFile` then blocks in `open(2)` until a writer appears —
    // which never happens. The handler never replies, the request id leaks and the caller waits forever.
    // `call`'s 2 s deadline is what turns that hang into a failing assertion here.
    const fifo = join(root, "pipe");
    execFileSync("mkfifo", [fifo]);                                  // node's fs has no mkfifo; the tool is on darwin+linux
    const e = err(await call("fs/read", { path: fifo }));
    expect(e.code).toBe(ERR.INVALID_PARAMS);
    expect(e.message).toBe("not a regular file (FIFO)");
  });

  it.skipIf(process.platform === "win32")("refuses a character device, which `stat` also sizes at 0", async () => {
    // The same hole pointed the other way: `/dev/zero` passes the cap and then reads without end, growing
    // the buffer until the process dies. One `isFile()` guard closes both.
    const e = err(await call("fs/read", { path: "/dev/zero" }));
    expect(e.code).toBe(ERR.INVALID_PARAMS);
    expect(e.message).toBe("not a regular file (character device)");
  });
});

// F3: the read rides ONE descriptor — open once, fstat THAT fd, read from it — closing the stat→read swap
// window by construction (a true TOCTOU race cannot be staged deterministically). These assert the fd
// structure through a tracked FileHandle: open is called exactly once, and the descriptor is closed on
// every path, refusal included (a leak here is the descriptor-exhaustion failure the finally-close prevents).
describe("fs/read rides one descriptor (F3 — TOCTOU closed by construction)", () => {
  function trackedHandle(stats: Record<string, unknown>, bytes = Buffer.from("hi")) {
    const calls: string[] = [];
    let pos = 0;   // how many bytes already handed out — a real fd's read advances a cursor and hits EOF
    const fh = {
      stat: vi.fn(async () => { calls.push("stat"); return stats; }),
      read: vi.fn(async (buf: Buffer, off: number, len: number) => {
        calls.push("read");
        const n = Math.min(len, bytes.length - pos);
        bytes.copy(buf, off, pos, pos + n);
        pos += n;
        return { bytesRead: n, buffer: buf };
      }),
      close: vi.fn(async () => { calls.push("close"); }),
    };
    return { fh, calls };
  }

  it("opens once, fstats that same fd, reads from it, then closes — one descriptor, in order", async () => {
    const { fh, calls } = trackedHandle({ isFile: () => true, size: 2 });
    const spy = vi.spyOn(fsReadInternals, "open").mockResolvedValue(fh as never);
    const res = ok(await call("fs/read", { path: join(root, "x.txt") }));
    expect(spy).toHaveBeenCalledTimes(1);                    // ONE open — no second path resolution for the read
    expect(calls[0]).toBe("stat");                           // fstat first…
    expect(calls.at(-1)).toBe("close");                      // …close last, all on that fd
    expect(calls.filter((c) => c === "read").length).toBeGreaterThanOrEqual(1);
    expect(Buffer.from(res.dataBase64 as string, "base64").toString()).toBe("hi");
    expect(res.size).toBe(2);
  });

  it("closes the fd on the refusal path and never reads through it", async () => {
    // A non-regular file is refused AFTER the fstat and BEFORE any read — and the fd must still be released.
    const { fh, calls } = trackedHandle({ isFile: () => false, isDirectory: () => true, size: 0 });
    vi.spyOn(fsReadInternals, "open").mockResolvedValue(fh as never);
    const e = err(await call("fs/read", { path: join(root, "d") }));
    expect(e.code).toBe(ERR.INVALID_PARAMS);
    expect(e.message).toBe("not a regular file (directory)");
    expect(fh.read).not.toHaveBeenCalled();                  // never read a non-regular file…
    expect(fh.close).toHaveBeenCalledTimes(1);               // …but the descriptor is still closed
    expect(calls).toEqual(["stat", "close"]);
  });

  it("caps on the BYTES actually read, not the fstat size: a file grown past the cap after fstat is refused (final review R12)", async () => {
    // The fstat reports a small size, but the read returns more than the cap — a regular file that GREW
    // between the two. Enforcing the cap on the fstat alone would return the oversized body; the bounded
    // read refuses instead. The fd is still released.
    const calls: string[] = [];
    const fh = {
      stat: vi.fn(async () => { calls.push("stat"); return { isFile: () => true, size: 10 }; }), // stale, small
      read: vi.fn(async (_buf: Buffer, _off: number, len: number) => { calls.push("read"); return { bytesRead: len, buffer: _buf }; }), // fills the whole cap+1 buffer → over cap
      close: vi.fn(async () => { calls.push("close"); }),
    };
    vi.spyOn(fsReadInternals, "open").mockResolvedValue(fh as never);
    const e = err(await call("fs/read", { path: join(root, "grew.bin") }));
    expect(e.code).toBe(ERR.INVALID_PARAMS);
    expect(e.message).toBe("file exceeds the 4 MiB read cap");
    expect(calls.at(-1)).toBe("close");                      // the fd is released on the cap refusal too
  });

  it("reads a small file in bounded chunks, never allocating the full 4 MiB cap per read (scoped review SR3)", async () => {
    // R12's bounded read allocated Buffer.allocUnsafe(READ_CAP_BYTES + 1) = 4 MiB+1 for EVERY read, even a
    // 5-byte file — so a client pipelining many ordinary small reads could hold hundreds of MiB at once. The
    // chunked read bounds each iteration's allocation to one 64 KiB chunk. Asserted STRUCTURALLY on the read
    // length (which IS the buffer size handed to `fh.read`): a tiny file never triggers a multi-MiB read.
    const bytes = Buffer.from("hello");
    const readLens: number[] = [];
    let pos = 0;
    const fh = {
      stat: vi.fn(async () => ({ isFile: () => true, size: bytes.length })),
      read: vi.fn(async (buf: Buffer, off: number, len: number) => {
        readLens.push(len);
        const n = Math.min(len, bytes.length - pos);
        bytes.copy(buf, off, pos, pos + n);
        pos += n;
        return { bytesRead: n, buffer: buf };
      }),
      close: vi.fn(async () => {}),
    };
    vi.spyOn(fsReadInternals, "open").mockResolvedValue(fh as never);
    const res = ok(await call("fs/read", { path: join(root, "tiny.txt") }));
    expect(Buffer.from(res.dataBase64 as string, "base64").toString()).toBe("hello");
    expect(res.size).toBe(5);
    expect(readLens.length).toBeGreaterThan(0);                          // the read did proceed
    expect(Math.max(...readLens)).toBeLessThanOrEqual(64 * 1024);        // …bounded by the 64 KiB chunk…
    expect(Math.max(...readLens)).toBeLessThan(READ_CAP_BYTES);          // …never the full 4 MiB cap (pre-SR2: cap+1)
  });
});

describe("fs/search", () => {
  it("finds a nested file by fuzzy query, reporting a root-relative path", async () => {
    mkdirSync(join(root, "src", "deep"), { recursive: true });
    writeFileSync(join(root, "src", "deep", "widget.ts"), "x");
    const m = matches(await call("fs/search", { query: "widget", roots: [root] }));
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ root, path: "src/deep/widget.ts" });
    expect(m[0].score).toBeGreaterThan(0);
  });

  it("answers an empty or whitespace query with no matches", async () => {
    writeFileSync(join(root, "a.ts"), "x");
    expect(matches(await call("fs/search", { query: "", roots: [root] }))).toEqual([]);
    expect(matches(await call("fs/search", { query: "   ", roots: [root] }))).toEqual([]);
  });

  it.skipIf(process.platform === "win32")("degrades an unreadable root to zero matches, not an error", async () => {
    const denied = join(root, "denied");
    mkdirSync(denied);
    writeFileSync(join(denied, "target.ts"), "x");
    chmodSync(denied, 0o000);
    try {
      const frame = await call("fs/search", { query: "target", roots: [denied] });
      expect(frame.error).toBeUndefined();
      expect(matches(frame)).toEqual([]);
    } finally { chmodSync(denied, 0o755); }
  });

  it("caps the result set at `limit`", async () => {
    for (const n of [1, 2, 3, 4, 5]) writeFileSync(join(root, `target${n}.ts`), "x");
    expect(matches(await call("fs/search", { query: "target", roots: [root], limit: 2 }))).toHaveLength(2);
  });

  it("merges two roots into one score-ordered list", async () => {
    const a = join(root, "a"), b = join(root, "b");
    mkdirSync(join(a, "alpha"), { recursive: true });
    mkdirSync(b, { recursive: true });
    writeFileSync(join(a, "alpha", "target.ts"), "x");
    writeFileSync(join(b, "target.ts"), "x");
    const m = matches(await call("fs/search", { query: "target", roots: [a, b] }));
    // The bare `target.ts` outranks the nested one (the ranker's match-at-index-0 bonus), so the merge
    // must re-sort ACROSS roots rather than concatenating per-root blocks.
    expect(m.map((x) => [x.root, x.path])).toEqual([[b, "target.ts"], [a, "alpha/target.ts"]]);
    expect(m[0].score).toBeGreaterThan(m[1].score);
  });

  it("defaults the root to the server's cwd", async () => {
    writeFileSync(join(root, "target.ts"), "x");
    vi.spyOn(process, "cwd").mockReturnValue(root);
    const m = matches(await call("fs/search", { query: "target" }));
    expect(m).toEqual([expect.objectContaining({ root, path: "target.ts" })]);
  });

  it(`refuses more than ${MAX_SEARCH_ROOTS} roots with -32602 (F4)`, async () => {
    // Each root drives its own recursive walk BEFORE the limit applies, so an unbounded array is
    // disproportionate fs work off one frame — the schema caps it, same precedent as the queue cap.
    const roots = Array.from({ length: MAX_SEARCH_ROOTS + 1 }, (_, i) => join(root, `r${i}`));
    const e = err(await call("fs/search", { query: "x", roots }));
    expect(e.code).toBe(ERR.INVALID_PARAMS);
  });

  it("dedupes roots that name the same directory — one walk, one match (F4)", async () => {
    // Two spellings of one root must not double the walk (the disproportionate work the cap bounds) nor
    // double the match. The walker is spied to prove the fs work itself is deduped, not just the output.
    writeFileSync(join(root, "target.ts"), "x");
    const spy = vi.spyOn(fileComplete, "collectEntries");
    const m = matches(await call("fs/search", { query: "target", roots: [root, root, root + "/"] }));
    expect(m).toHaveLength(1);                                                       // not three copies
    expect(spy.mock.calls.filter((c) => (c[0] as string).startsWith(root))).toHaveLength(1); // walked once
  });
});
