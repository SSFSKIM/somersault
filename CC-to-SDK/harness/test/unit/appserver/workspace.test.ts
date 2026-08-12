// test/unit/appserver/workspace.test.ts — M3 Task 12: the server-scoped workspace pair `fs/read` +
// `fs/search` (spec §2). Driven wire-level through `srv.connect`/`feed` against REAL files in a tmpdir:
// both methods ARE filesystem behavior, so faking the filesystem would test nothing but the fake — the
// oversize refusal, the base64 round-trip of non-UTF8 bytes and the unreadable-root degradation each
// depend on what node's fs actually does.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppServer } from "../../../src/appserver/server.js";
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
    // `stat` SUCCEEDS on a directory, so this refusal can only come from the read itself — and an fs
    // failure is bad-request-class on every path (Codex parity), never the dispatcher's internal catch.
    const e = err(await call("fs/read", { path: root }));
    expect(e.code).toBe(ERR.INVALID_PARAMS);
    expect(e.message).toContain("EISDIR");
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
});
