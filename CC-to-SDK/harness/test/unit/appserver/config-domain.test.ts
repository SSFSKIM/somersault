// test/unit/appserver/config-domain.test.ts — M5 Task 2: `config/read`, the settings-files domain's read half.
//
// Driven through the REAL wire (`srv.connect(sink)` + `conn.feed(...)`, review-start.test.ts's harness):
// `dispatch` is private and four-arg, so a request is the only way in — and going through it is what makes
// the params gate, the error codes and the reply shape observable at all.
//
// The whole domain is pointed at temp directories by the `configHome`/`managedSettingsPath` deps, so every
// case here reads files it wrote itself and never this machine's real ~/.claude.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AppServer, type AppServerDeps } from "../../../src/appserver/server.js";
import { DEFAULT_MANAGED_PATH, defaultManagedPath } from "../../../src/appserver/configDomain.js";
import type { PeerSink } from "../../../src/appserver/peer.js";
import { Ajv } from "ajv";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, chmodSync } from "node:fs";
import { tmpdir, platform } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const harnessRoot = fileURLToPath(new URL("../../../", import.meta.url));
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
/** Does `chmod 000` actually deny THIS process a read? Measured, never assumed: root reads regardless of
 *  mode, and a filesystem that ignores mode bits denies nothing either. Where permission is not permission
 *  the unreadable-layer case below has no premise, so it skips rather than reporting a failure it caused. */
const modeDenies = (() => {
  const dir = mkdtempSync(join(tmpdir(), "m5perm-"));
  try {
    const probe = join(dir, "probe.json"); writeFileSync(probe, "{}"); chmodSync(probe, 0o000);
    try { readFileSync(probe, "utf8"); return false; } catch { return true; }
  } finally { rmSync(dir, { recursive: true, force: true }); }
})();

const mkSink = () => { const lines: string[] = []; return { lines, sink: { write: (l: string) => void lines.push(l), buffered: () => 0, end: () => {} } as PeerSink }; };
const parsed = (lines: string[]) => lines.map((l) => JSON.parse(l) as Record<string, unknown>);
const servers: AppServer[] = [];
let conn: { feed(chunk: string): void };
let lines: string[];
let nextId = 100;

function boot(deps: AppServerDeps = {}): AppServer {
  const srv = new AppServer({}, deps);
  servers.push(srv);
  const s = mkSink();
  conn = srv.connect(s.sink);
  conn.feed(JSON.stringify({ id: 1, method: "initialize", params: { clientInfo: { name: "T" } } }) + "\n");
  s.lines.length = 0;
  lines = s.lines;
  return srv;
}

/** Feeds the request and waits for ITS reply before returning the id. The handler does real filesystem
 *  I/O (realpath + reads), so a single microtask — what `await` on the bare id would give — settles
 *  nothing; and a poll that gave up silently would turn a never-answered request into a confusing
 *  "cannot read property of undefined" instead of the honest "no reply". */
const send = async (method: string, params: unknown): Promise<number> => {
  const id = nextId++;
  conn.feed(JSON.stringify({ id, method, params }) + "\n");
  for (let i = 0; i < 200; i++) {
    if (parsed(lines).some((m) => m.id === id)) return id;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`no reply to ${method} (id ${id}) within 1s`);
};

afterEach(async () => { for (const s of servers.splice(0)) await s.shutdown().catch(() => {}); });

let home: string, proj: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "m5home-")); proj = mkdtempSync(join(tmpdir(), "m5proj-"));
  mkdirSync(join(home, ".claude"), { recursive: true }); mkdirSync(join(proj, ".claude"), { recursive: true });
});
afterEach(() => { rmSync(home, { recursive: true, force: true }); rmSync(proj, { recursive: true, force: true }); });
const deps = () => ({ configHome: home, managedSettingsPath: join(home, "managed.json"), ccxDir: join(home, "ccx") });
const reply = (id: number) => parsed(lines).find((l) => l.id === id) as any;

describe("config/read", () => {
  it("merges the chain, attributes leaf origins, serves CAS tokens, flags incompleteness", async () => {
    writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ model: "opus", permissions: { allow: ["WebFetch"] } }));
    writeFileSync(join(proj, ".claude", "settings.local.json"), JSON.stringify({ model: "sonnet" }));
    boot(deps());
    const id = await send("config/read", { cwd: proj });
    const r = reply(id).result;
    expect(r.config).toEqual({ model: "sonnet", permissions: { allow: ["WebFetch"] } });
    expect(r.origins["model"]).toBe("local");
    expect(r.origins["permissions.allow"]).toEqual(["user"]);
    expect(r.incomplete).toBe(true);
    // D-M5-18: versions ALWAYS present for the writable targets in view — the first-conditional-write
    // token. Every present file is compared against ITS OWN bytes: a `typeof === "string"` on `local`
    // passes just as happily when the token is computed from the user file, and a client's first
    // conditional write to settings.local.json would then carry another file's hash (review I3).
    expect(r.versions.user).toBe(sha256(readFileSync(join(home, ".claude", "settings.json"), "utf8")));
    expect(r.versions.local).toBe(sha256(readFileSync(join(proj, ".claude", "settings.local.json"), "utf8")));
    expect(r.versions.user).not.toBe(r.versions.local);
    expect(r.versions.project).toBe("absent"); // no such file — the one state that is NOT a hash
    expect(r.layers).toBeUndefined();
  });
  it("includeLayers returns raw parses; malformed layer = disabledReason, healthy layers still serve", async () => {
    writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ model: "opus" }));
    writeFileSync(join(proj, ".claude", "settings.json"), "{broken");
    boot(deps());
    const id = await send("config/read", { cwd: proj, includeLayers: true });
    const r = reply(id).result;
    expect(r.config).toEqual({ model: "opus" });
    expect(r.layers.find((l: any) => l.name === "project").disabledReason).toMatch(/JSON/);
    // A malformed file still HAS bytes, so it still has a real CAS token — that is the whole point of
    // `readLayers` retaining `raw` on the disabled layer, and the client is owed the token precisely for
    // the file it must go fix. Asserting the hash, not merely a string: minting "absent" here would be
    // the exact inverse of what this row promises, and reads as "no such file" to a conditional write.
    expect(r.versions.project).toBe(sha256("{broken"));
  });
  it.skipIf(!modeDenies)("a present-but-unreadable layer mints \"unreadable\", never \"absent\"", async () => {
    // D-M5-18's "absent" means NO SUCH FILE. A file that exists but whose bytes never reached us is a
    // third state, and this handler is the only place the difference is knowable — downstream sees the
    // token string alone. Mode 000 is the reproduction; EISDIR (a settings path that is a directory)
    // takes the same branch, since `readLayers` keeps every non-ENOENT failure as a layer without `raw`.
    writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ model: "opus" }));
    const projSettings = join(proj, ".claude", "settings.json");
    writeFileSync(projSettings, JSON.stringify({ model: "sonnet" }));
    chmodSync(projSettings, 0o000);
    try {
      boot(deps());
      const id = await send("config/read", { cwd: proj, includeLayers: true });
      const r = reply(id).result;
      expect(r.layers.find((l: any) => l.name === "project").disabledReason).toMatch(/EACCES|permission/i);
      expect(r.layers.find((l: any) => l.name === "project").raw).toBeUndefined();
      expect(r.versions.project).toBe("unreadable");
      expect(r.versions.user).toBe(sha256(readFileSync(join(home, ".claude", "settings.json"), "utf8"))); // healthy neighbour unaffected
      expect(r.versions.local).toBe("absent"); // and "absent" still means exactly what it meant
      expect(r.config).toEqual({ model: "opus" }); // the unreadable layer contributes nothing
    } finally { chmodSync(projSettings, 0o600); }
  });
  it("the reply on the wire validates against the published result schema — both arms", async () => {
    // D-M5-19 ships a RESULT schema, and a result schema nothing ever validates is decoration: this is the
    // one place the generated artifact meets an actual reply. `additionalProperties: false` is doing the
    // work in both directions — a key the handler invents fails here just as loudly as a required one it
    // drops. Both arms, because `layers` is the only optional key and includeLayers is what produces it.
    writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ model: "opus" }));
    boot(deps());
    const validate = new Ajv({ strict: true }).compile(
      (JSON.parse(readFileSync(join(harnessRoot, "schema", "json", "stable", "appserver.json"), "utf8")) as { results: Record<string, object> }).results["config/read"],
    );
    for (const params of [{ cwd: proj }, { cwd: proj, includeLayers: true }]) {
      const id = await send("config/read", params);
      expect(validate(reply(id).result), JSON.stringify(validate.errors)).toBe(true);
    }
  });
  it("relative and nonexistent cwd refuse -32602 ConfigValidationError; without cwd only user in versions", async () => {
    boot(deps());
    let id = await send("config/read", { cwd: "rel/path" });
    expect(reply(id).error.data).toEqual({ code: "ConfigValidationError" });
    // The MESSAGE, not just the code: a relative cwd and a missing one refuse with the same code, so
    // without this the absoluteness rule could be deleted outright and this case would still pass —
    // `realpath("rel/path")` merely fails for the other reason. What absoluteness actually guards is the
    // relative path that DOES resolve, against this process's cwd rather than the client's.
    expect(reply(id).error.message).toMatch(/absolute/);
    id = await send("config/read", { cwd: join(proj, "nope") });
    expect(reply(id).error.code).toBe(-32602);
    id = await send("config/read", {});
    expect(Object.keys(reply(id).result.versions)).toEqual(["user"]);
  });
  it("a cwd that is a regular file refuses exactly like one that does not exist", async () => {
    // `realpath` succeeds on a file, so without a directory check the read proceeds against
    // `<file>/.claude/settings.json` and answers with CAS tokens for two paths that can never exist —
    // a client could then send a conditional write against a hallucinated target.
    const file = join(proj, "settings-but-a-file.json");
    writeFileSync(file, "{}");
    boot(deps());
    const id = await send("config/read", { cwd: file });
    expect(reply(id).error.code).toBe(-32602);
    expect(reply(id).error.data).toEqual({ code: "ConfigValidationError" });
    expect(reply(id).error.message).toMatch(/not a directory/);
    expect(reply(id).result).toBeUndefined();
  });
});

describe("defaultManagedPath", () => {
  it("maps every platform arm, and DEFAULT_MANAGED_PATH is this host's", () => {
    // The win32 arm is the reason this is a function: read off `platform()` at module load, two of the
    // three arms are unrunnable on any given machine, and an inverted or dropped `null` there would ship
    // a Linux path as a Windows drive-root layer with no test able to say so.
    expect(defaultManagedPath("darwin")).toBe("/Library/Application Support/ClaudeCode/managed-settings.json");
    expect(defaultManagedPath("win32")).toBeNull();
    expect(defaultManagedPath("linux")).toBe("/etc/claude-code/managed-settings.json");
    expect(defaultManagedPath("freebsd")).toBe("/etc/claude-code/managed-settings.json"); // anything-but-those-two
    expect(DEFAULT_MANAGED_PATH).toBe(defaultManagedPath(platform())); // the exported const is that call
  });
});
