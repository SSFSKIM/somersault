// test/unit/peer/roster.test.ts — the roster read, fully injected: no real home directory, no ps(1), no
// sockets. The rows belong to ANOTHER program, so the load-bearing property here is that we project what
// is present and omit what is absent rather than inventing defaults.
import { describe, it, expect } from "vitest";
import { sessionsDir, readPeerRows, peerTokenFor, type RosterDeps } from "../../../src/peer/roster.js";
import { keyFileName } from "../../../src/peer/address.js";

const row = (o: Record<string, unknown>) => JSON.stringify(o);

function mkDeps(files: Record<string, string>, live: Record<number, boolean> = {}, present: string[] = []): RosterDeps {
  return {
    readDir: () => Object.keys(files),
    readFile: (p: string) => { const name = p.split("/").pop()!; if (!(name in files)) throw new Error("ENOENT"); return files[name]; },
    exists: (p: string) => present.includes(p),
    isPidLive: async (pid: number) => live[pid] ?? false,
  };
}

describe("sessionsDir", () => {
  it("resolves under CLAUDE_CONFIG_DIR when it is set, with no .claude segment", () => {
    expect(sessionsDir({ CLAUDE_CONFIG_DIR: "/tenant/cfg" } as NodeJS.ProcessEnv)).toBe("/tenant/cfg/sessions");
  });
  it("falls back to $HOME/.claude", () => {
    expect(sessionsDir({ HOME: "/home/u" } as NodeJS.ProcessEnv)).toBe("/home/u/.claude/sessions");
  });
});

describe("readPeerRows", () => {
  const env = { CLAUDE_CONFIG_DIR: "/cfg" } as NodeJS.ProcessEnv;

  it("projects present fields verbatim and omits absent ones", async () => {
    const deps = mkDeps({ "11.json": row({ pid: 11, sessionId: "s-1", messagingSocketPath: "/sock/11.sock", entrypoint: "sdk-cli", peerProtocol: 1 }) }, { 11: true }, ["/sock/11.sock"]);
    const [r] = await readPeerRows(env, deps);
    expect(r.address).toBe("uds:/sock/11.sock");
    expect(r.sessionId).toBe("s-1");
    expect(r.entrypoint).toBe("sdk-cli");
    expect(r.peerProtocol).toBe(1);
    expect("name" in r).toBe(false);
    expect("cwd" in r).toBe(false);
  });

  it("marks liveness from the pid probe and inboxBound from the socket's existence", async () => {
    const deps = mkDeps({
      "11.json": row({ pid: 11, messagingSocketPath: "/sock/11.sock" }),
      "12.json": row({ pid: 12, messagingSocketPath: "/sock/12.sock" }),
    }, { 11: true, 12: false }, ["/sock/11.sock"]);
    const rows = await readPeerRows(env, deps);
    expect(rows.find(r => r.pid === 11)).toMatchObject({ alive: true, inboxBound: true });
    expect(rows.find(r => r.pid === 12)).toMatchObject({ alive: false, inboxBound: false });
  });

  it("skips rows with no messagingSocketPath — they have no address", async () => {
    const deps = mkDeps({ "13.json": row({ pid: 13 }) }, { 13: true });
    expect(await readPeerRows(env, deps)).toEqual([]);
  });

  it("skips unparseable rows instead of failing the whole read", async () => {
    const deps = mkDeps({ "14.json": "{not json", "15.json": row({ pid: 15, messagingSocketPath: "/sock/15.sock" }) }, { 15: true }, ["/sock/15.sock"]);
    const rows = await readPeerRows(env, deps);
    expect(rows.map(r => r.pid)).toEqual([15]);
  });

  it("ignores non-row files such as the key files", async () => {
    const deps = mkDeps({ "16.abc.key": "{}", "17.json": row({ pid: 17, messagingSocketPath: "/sock/17.sock" }) }, { 17: true }, ["/sock/17.sock"]);
    expect((await readPeerRows(env, deps)).map(r => r.pid)).toEqual([17]);
  });

  it("returns [] when the directory does not exist", async () => {
    const deps: RosterDeps = { readDir: () => { throw new Error("ENOENT"); }, readFile: () => "", exists: () => false, isPidLive: async () => false };
    expect(await readPeerRows(env, deps)).toEqual([]);
  });
});

describe("peerTokenFor", () => {
  const env = { CLAUDE_CONFIG_DIR: "/cfg" } as NodeJS.ProcessEnv;
  it("reads the token from the key file named for that socket path", () => {
    const name = keyFileName(21, "/sock/21.sock");
    const deps = mkDeps({ [name]: JSON.stringify({ peerToken: "a".repeat(32) }) });
    expect(peerTokenFor("/sock/21.sock", 21, env, deps)).toBe("a".repeat(32));
  });
  it("is undefined when no key file matches", () => {
    const deps = mkDeps({});
    expect(peerTokenFor("/sock/22.sock", 22, env, deps)).toBeUndefined();
  });
});
