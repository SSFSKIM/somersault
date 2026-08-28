// test/unit/peer/gateway.test.ts — the gateway over a REAL unix socket in a temp directory. A socket
// server is cheap and a fake would prove nothing here: the two properties that matter are wire
// properties. It must CLOSE the connection after consuming a frame (the receipt sender writes one buffer,
// never reads, and times out idle at 5s — a listener that holds the connection open turns every receipt
// into the sender's error, which is exactly what probe 113b logged and 113c never diagnosed), and it must
// publish a key file where a receiver will look for it.
import { describe, it, expect, afterAll } from "vitest";
import { createConnection } from "node:net";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PeerGateway } from "../../../src/peer/gateway.js";
import { keyFileName } from "../../../src/peer/address.js";

const roots: string[] = [];
function mkEnv() {
  const cfg = mkdtempSync(join(tmpdir(), "m8cfg-"));
  const sock = mkdtempSync(join(tmpdir(), "m8sock-"));
  roots.push(cfg, sock);
  return { env: { CLAUDE_CONFIG_DIR: cfg } as NodeJS.ProcessEnv, cfg, sock };
}
afterAll(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });

/** Write NDJSON to the gateway and report whether the gateway closed the connection on us. */
function writeLine(path: string, line: string): Promise<"closed-by-peer" | "timeout"> {
  return new Promise((res) => {
    const c = createConnection(path);
    const timer = setTimeout(() => { c.destroy(); res("timeout"); }, 2000);
    c.on("connect", () => c.write(line + "\n"));
    c.on("close", () => { clearTimeout(timer); res("closed-by-peer"); });
    c.on("error", () => { clearTimeout(timer); res("timeout"); });
  });
}

describe("PeerGateway", () => {
  it("binds, publishes a key file for its own socket, and unlinks both on close", async () => {
    const { env, cfg, sock } = mkEnv();
    const gw = await PeerGateway.bind({ onReceipt: () => {}, onStrayFrame: () => {} }, { env, socketDir: sock, pid: 4242 });
    expect(gw).toBeDefined();
    const keyPath = join(cfg, "sessions", keyFileName(4242, gw!.socketPath));
    expect(existsSync(gw!.socketPath)).toBe(true);
    expect(existsSync(keyPath)).toBe(true);
    expect(JSON.parse(readFileSync(keyPath, "utf8")).peerToken).toMatch(/^[0-9a-f]{32}$/);
    await gw!.close();
    expect(existsSync(gw!.socketPath)).toBe(false);
    expect(existsSync(keyPath)).toBe(false);
  });

  it("publishes NO registry row — it is a reply address, not a session", async () => {
    const { env, cfg, sock } = mkEnv();
    const gw = await PeerGateway.bind({ onReceipt: () => {}, onStrayFrame: () => {} }, { env, socketDir: sock, pid: 4243 });
    expect(existsSync(join(cfg, "sessions", "4243.json"))).toBe(false);
    await gw!.close();
  });

  it("routes a peer_message_status control frame and CLOSES the connection", async () => {
    const { env, sock } = mkEnv();
    const got: Record<string, unknown>[] = [];
    const gw = await PeerGateway.bind({ onReceipt: (f) => got.push(f), onStrayFrame: () => {} }, { env, socketDir: sock, pid: 4244 });
    const outcome = await writeLine(gw!.socketPath, JSON.stringify({ type: "control", action: "peer_message_status", orig_msg_id: "m-1", status: "held" }));
    expect(outcome).toBe("closed-by-peer");
    expect(got).toEqual([{ type: "control", action: "peer_message_status", orig_msg_id: "m-1", status: "held" }]);
    await gw!.close();
  });

  it("ignores an auth line without treating it as a stray", async () => {
    const { env, sock } = mkEnv();
    const strays: string[] = [];
    const gw = await PeerGateway.bind({ onReceipt: () => {}, onStrayFrame: (k) => strays.push(k) }, { env, socketDir: sock, pid: 4245 });
    await writeLine(gw!.socketPath, JSON.stringify({ type: "auth", token: "x" }));
    expect(strays).toEqual([]);
    await gw!.close();
  });

  it("reports a type:user frame as a stray — the gateway is not a session and must never look like one", async () => {
    const { env, sock } = mkEnv();
    const strays: string[] = [];
    const gw = await PeerGateway.bind({ onReceipt: () => {}, onStrayFrame: (k) => strays.push(k) }, { env, socketDir: sock, pid: 4246 });
    await writeLine(gw!.socketPath, JSON.stringify({ type: "user", message: { content: "hello" } }));
    expect(strays).toEqual(["user"]);
    await gw!.close();
  });

  it("returns undefined when the socket cannot be bound, rather than throwing", async () => {
    const { env } = mkEnv();
    const gw = await PeerGateway.bind({ onReceipt: () => {}, onStrayFrame: () => {} }, { env, socketDir: "/definitely/not/a/dir", pid: 4247 });
    expect(gw).toBeUndefined();
  });
});
