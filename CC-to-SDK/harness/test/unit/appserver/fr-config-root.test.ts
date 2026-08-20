// test/unit/appserver/fr-config-root.test.ts — whole-branch review F3 / verifier cluster 1 (D-M5-23a):
// the config domain must read and write the user layer where the ENGINE keeps it.
//
// THE POINT OF THIS FILE IS THAT IT INJECTS NO `configHome`. Every other config row points the domain at a
// temp directory through that dep, which is exactly why the defect survived fifteen reviews: with the dep
// set, the resolution under test never runs. `ccx serve` constructs `new AppServer({ token })` with no deps
// at all, so these rows drive the production path and the environment is the only thing steering it.
//
// SAFETY: this milestone ships config WRITES. Both env variables are pointed at a throwaway directory and
// RESTORED afterwards, and every row asserts the redirection (the resolver's answer, and the reply's own
// `filePath`) before it looks at any bytes — a row that silently fell back to the real `~/.claude` would
// otherwise edit the operator's settings and look identical to one that worked.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AppServer } from "../../../src/appserver/server.js";
import { userLayerDir } from "../../../src/appserver/configDomain.js";
import { claudeConfigDir } from "../../../src/config/claudeHome.js";
import { sessionsDir } from "../../../src/fleet/registry.js";
import type { PeerSink } from "../../../src/appserver/peer.js";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const servers: AppServer[] = [];
let root = "", home = "", cfgdir = "";
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "m5root-"));
  home = join(root, "home"); cfgdir = join(root, "cfgdir");
  mkdirSync(join(home, ".claude"), { recursive: true });
  mkdirSync(cfgdir, { recursive: true });
  for (const k of ["HOME", "CLAUDE_CONFIG_DIR"]) savedEnv[k] = process.env[k];
  process.env.HOME = home;
  delete process.env.CLAUDE_CONFIG_DIR;
});
afterEach(async () => {
  for (const k of ["HOME", "CLAUDE_CONFIG_DIR"]) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
  for (const s of servers.splice(0)) await s.shutdown().catch(() => {});
  rmSync(root, { recursive: true, force: true });
});

/** A server on PRODUCTION defaults for the user layer. `managedSettingsPath` and `ccxDir` are still pinned
 *  at throwaway paths — they are not what these rows are about, and this machine's real `/Library` policy
 *  file would otherwise colour the result. */
function boot(): (method: string, params: unknown) => Promise<any> {
  const srv = new AppServer({} as never, { managedSettingsPath: join(root, "no-managed.json"), ccxDir: join(root, "ccx") });
  servers.push(srv);
  const lines: string[] = [];
  const conn = srv.connect({ write: (l: string) => void lines.push(l), buffered: () => 0, end: () => {} } as PeerSink);
  conn.feed(JSON.stringify({ id: 1, method: "initialize", params: { clientInfo: { name: "T" } } }) + "\n");
  let nextId = 100;
  return async (method, params) => {
    const id = nextId++;
    conn.feed(JSON.stringify({ id, method, params }) + "\n");
    for (let i = 0; i < 400; i++) {
      const hit = lines.map((l) => JSON.parse(l)).find((m: any) => m.id === id);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error(`no reply to ${method}`);
  };
}
const userFileIn = (dir: string) => join(dir, "settings.json");
const body = (p: string) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : undefined);

describe("the config domain's user layer follows CLAUDE_CONFIG_DIR", () => {
  it("claudeConfigDir: the variable REPLACES ~/.claude, and the fleet registry spells it the same way", () => {
    expect(claudeConfigDir({ HOME: "/h" })).toBe("/h/.claude");
    expect(claudeConfigDir({ HOME: "/h", CLAUDE_CONFIG_DIR: "/t/cfg" })).toBe("/t/cfg");   // NOT /t/cfg/.claude
    // One spelling for the whole harness. `sessionsDir` had it right since probe 61 and the config domain
    // had its own; this holds the two together so a later edit to either cannot re-split them.
    for (const env of [{ HOME: "/h" }, { HOME: "/h", CLAUDE_CONFIG_DIR: "/t/cfg" }])
      expect(sessionsDir(env)).toBe(join(claudeConfigDir(env), "sessions"));
    // An EXPORTED-BUT-EMPTY variable is a VALUE, not an absence — the reference resolves with `??` and
    // reads `./settings.json` relative to its cwd, so `||` answered about a file the engine does not
    // read. The one env shape the original fix did not cover, and a shell writes it for
    // `CLAUDE_CONFIG_DIR="$SOMETHING_UNSET"`. Absent still falls back, which is the other side.
    expect(claudeConfigDir({ HOME: "/h", CLAUDE_CONFIG_DIR: "" })).toBe("");
    expect(claudeConfigDir({ HOME: "/h" })).toBe("/h/.claude");
    // NFC, the reference's own, applied to the whole result: on a filesystem that does not fold the two
    // forms together the engine opens the composed spelling, and a view reporting the decomposed one
    // would be describing a different file. Two spellings of `café`, one answer.
    expect(claudeConfigDir({ CLAUDE_CONFIG_DIR: "/t/cafe\u0301" })).toBe("/t/caf\u00e9");  // NFD in, NFC out
  });
  it("userLayerDir: the env answers in production, and an injected configHome still wins over it", () => {
    // Both sides. Without the dep the environment decides — that is the whole finding. With the dep, the
    // dep decides even when the variable is set, because the alternative is a suite (or the keyed live
    // acceptance) that points at a temp directory and is silently redirected onto the operator's real
    // settings by an ambient variable.
    expect(userLayerDir({}, { HOME: "/h" })).toBe("/h/.claude");
    expect(userLayerDir({}, { HOME: "/h", CLAUDE_CONFIG_DIR: "/t/cfg" })).toBe("/t/cfg");
    expect(userLayerDir({ configHome: "/injected" }, { HOME: "/h", CLAUDE_CONFIG_DIR: "/t/cfg" })).toBe("/injected/.claude");
  });
  it("config/read and config/value/write both serve $CLAUDE_CONFIG_DIR, and leave $HOME/.claude untouched", async () => {
    process.env.CLAUDE_CONFIG_DIR = cfgdir;
    expect(claudeConfigDir()).toBe(cfgdir);                                   // the redirection, asserted before any write
    writeFileSync(userFileIn(join(home, ".claude")), JSON.stringify({ model: "FROM-HOME-DOT-CLAUDE" }));
    writeFileSync(userFileIn(cfgdir), JSON.stringify({ model: "FROM-CLAUDE-CONFIG-DIR" }));
    const send = boot();
    const rd = await send("config/read", {});
    expect(rd.result.config).toEqual({ model: "FROM-CLAUDE-CONFIG-DIR" });    // the file the engine reads
    expect(rd.result.layers, "no layers requested").toBeUndefined();
    const wr = await send("config/value/write", { keyPath: ["model"], value: "WRITTEN", mergeStrategy: "replace" });
    expect(wr.result.status).toBe("ok");
    expect(wr.result.filePath.replace(/^\/private/, "")).toBe(userFileIn(cfgdir));
    expect(body(userFileIn(cfgdir))).toEqual({ model: "WRITTEN" });
    // The half that makes `ok` a lie when it is wrong: the OTHER candidate file must not have moved.
    expect(body(userFileIn(join(home, ".claude")))).toEqual({ model: "FROM-HOME-DOT-CLAUDE" });
  });
  it("with no CLAUDE_CONFIG_DIR the user layer is $HOME/.claude, read and written", async () => {
    expect(claudeConfigDir()).toBe(join(home, ".claude"));                    // the redirection, asserted
    writeFileSync(userFileIn(join(home, ".claude")), JSON.stringify({ model: "FROM-HOME-DOT-CLAUDE" }));
    writeFileSync(userFileIn(cfgdir), JSON.stringify({ model: "NOT-IN-USE" }));
    const send = boot();
    const rd = await send("config/read", {});
    expect(rd.result.config).toEqual({ model: "FROM-HOME-DOT-CLAUDE" });
    const wr = await send("config/value/write", { keyPath: ["model"], value: "WRITTEN", mergeStrategy: "replace" });
    expect(wr.result.filePath.replace(/^\/private/, "")).toBe(userFileIn(join(home, ".claude")));
    expect(body(userFileIn(join(home, ".claude")))).toEqual({ model: "WRITTEN" });
    expect(body(userFileIn(cfgdir))).toEqual({ model: "NOT-IN-USE" });
  });
  it("the CAS token, the layer's filePath and the write reply all name the SAME file under the env root", async () => {
    // The read side reports where a layer is LOOKED UP and the write side where bytes LANDED; a client
    // correlates the two by string. Moving the user layer's root is exactly the change that could split
    // them, so the agreement is asserted at the env root rather than assumed from the rows above.
    process.env.CLAUDE_CONFIG_DIR = cfgdir;
    writeFileSync(userFileIn(cfgdir), JSON.stringify({ model: "SEED" }));
    const send = boot();
    const rd = await send("config/read", { includeLayers: true });
    const layer = rd.result.layers.find((l: any) => l.name === "user");
    expect(layer.filePath.replace(/^\/private/, "")).toBe(userFileIn(cfgdir));
    const wr = await send("config/value/write", { keyPath: ["model"], value: "NEXT", mergeStrategy: "replace", expectedVersion: rd.result.versions.user });
    expect(wr.result.status).toBe("ok");
    expect(wr.result.filePath).toBe(layer.filePath);
    const after = await send("config/read", {});
    expect(after.result.versions.user).toBe(wr.result.version);
  });

  /** FIX WAVE G / G6 — the one env shape D-M5-23a left open. `claudeConfigDir` deliberately keeps an
   *  exported-but-EMPTY `CLAUDE_CONFIG_DIR` as a VALUE (the first row above pins that), because the engine
   *  resolves it to '' and reads `./settings.json` relative to the cwd it was launched with. Both handlers
   *  then derived the user layer from that empty root WITHOUT resolving it, so `canonicalPath` anchored the
   *  tail on the APP SERVER's own cwd — which for this suite is the harness checkout. Measured before the
   *  fix: `config/read` named `<harness>/settings.json` for the user layer and `config/value/write` created
   *  that file, both replying `ok`, while an engine for the request's project would read a different file
   *  entirely. A successful operation on the wrong file, which is the class wave B exists for.
   *
   *  A shell writes an empty value for `CLAUDE_CONFIG_DIR="$SOMETHING_UNSET"`, so this is not exotic. */
  it("an EMPTY CLAUDE_CONFIG_DIR is anchored on the REQUEST's cwd, not on the app server's", async () => {
    process.env.CLAUDE_CONFIG_DIR = "";
    const proj = join(root, "proj");
    mkdirSync(join(proj, ".claude"), { recursive: true });
    writeFileSync(userFileIn(proj), JSON.stringify({ model: "FROM-THE-REQUEST-CWD" }));
    const send = boot();
    const rd = await send("config/read", { cwd: proj, includeLayers: true });
    const layer = rd.result.layers.find((l: any) => l.name === "user");
    // The redirection FIRST, before any bytes are believed: the layer must name the file under the
    // request's cwd and NOT one under the process cwd this suite happens to run in.
    expect(layer.filePath.replace(/^\/private/, "")).toBe(userFileIn(proj));
    expect(layer.filePath.startsWith(process.cwd())).toBe(false);
    expect(rd.result.config.model).toBe("FROM-THE-REQUEST-CWD");
    // …and the write lands in the same file, leaving nothing behind in the app server's own directory.
    const wr = await send("config/value/write", { keyPath: ["model"], value: "WRITTEN-THERE", mergeStrategy: "replace", target: "user", cwd: proj });
    expect([wr.result.status, wr.result.filePath]).toEqual(["ok", layer.filePath]);
    expect(body(userFileIn(proj))).toEqual({ model: "WRITTEN-THERE" });
    expect(existsSync(join(process.cwd(), "settings.json"))).toBe(false);
  });
  it("…and with no cwd to anchor on, the app server's own is what is left — which is what an engine here would resolve too", () => {
    // The other side, and it is NOT a defect: a request that names no project has no project cwd to
    // resolve against, and the process cwd is what an engine started here would resolve too. Asserted on
    // the resolver rather than on the wire because the wire half would mean writing into the app server's
    // own directory, which for this suite is the checkout. The row exists so a later "fix" that refuses,
    // or that silently falls back to $HOME/.claude, has to argue with a test.
    expect(userLayerDir({}, { HOME: "/h", CLAUDE_CONFIG_DIR: "" })).toBe(process.cwd());
    expect(userLayerDir({}, { HOME: "/h", CLAUDE_CONFIG_DIR: "" }, "/proj")).toBe("/proj");
    // A relative-but-non-empty root resolves the same way — empty is not a special case, it is the
    // smallest relative path, and the engine treats it as one.
    expect(userLayerDir({}, { HOME: "/h", CLAUDE_CONFIG_DIR: "cfg/here" }, "/proj")).toBe("/proj/cfg/here");
    // …and an ABSOLUTE root is never re-anchored, whatever cwd the request carries.
    expect(userLayerDir({}, { HOME: "/h", CLAUDE_CONFIG_DIR: "/t/cfg" }, "/proj")).toBe("/t/cfg");
    expect(userLayerDir({ configHome: "/injected" }, { HOME: "/h", CLAUDE_CONFIG_DIR: "" }, "/proj")).toBe("/injected/.claude");
  });
});
