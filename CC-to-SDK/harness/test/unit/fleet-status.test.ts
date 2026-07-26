import { describe, it, expect, afterEach, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import type { Server, Socket } from "node:net";
import { askStatus } from "../../src/fleet/status.js";

// Real sockets, not an injected fake: askStatus IS the network client, so a fake proves nothing about
// the behaviour that hangs it — a peer that goes away without ever sending a newline.
const root = mkdtempSync(join(tmpdir(), "ccx-status-"));   // one temp root for the file, not one per test
let nth = 0;
const servers: Server[] = [], socks: Socket[] = [];
afterEach(async () => {
  for (const s of socks.splice(0)) s.destroy();
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** A listening peer that behaves however the test says. Every accepted socket is tracked so teardown
 *  can destroy it — an undestroyed one keeps server.close() pending and the run never exits. */
async function peer(onConn: (s: Socket) => void): Promise<string> {
  const path = join(root, `p${nth++}.sock`);
  const srv = createServer((s) => { socks.push(s); s.on("error", () => {}); onConn(s); });
  servers.push(srv);
  await new Promise<void>((r) => srv.listen(path, () => r()));
  return path;
}

/** Every case must SETTLE — so time it, and fail loudly rather than hanging to the suite timeout. */
async function timed<T>(p: Promise<T>, ms = 3000): Promise<[T, number]> {
  const t0 = Date.now();
  let t: ReturnType<typeof setTimeout>;
  const v = await Promise.race([p.finally(() => clearTimeout(t)),
    new Promise<T>((_, rej) => { t = setTimeout(() => rej(new Error(`still pending after ${ms}ms`)), ms); })]);
  return [v, Date.now() - t0];
}

const reply = (o: unknown) => (s: Socket) => s.on("data", () => s.write(JSON.stringify(o) + "\n"));
const PROMPT = 200;   // under the 250ms deadline: these paths must settle on the EVENT, not wait it out

describe("askStatus", () => {
  it("returns the host's snapshot from a newline-framed reply", async () => {
    const path = await peer(reply({ ok: true, state: "blocked", status: "idle", waitingFor: "Bash(rm -rf build/)" }));
    const [v, ms] = await timed(askStatus(path));
    expect(v).toEqual({ state: "blocked", status: "idle", waitingFor: "Bash(rm -rf build/)" });
    expect(ms).toBeLessThan(PROMPT);
  });

  it("settles when the peer closes without ever sending a newline", async () => {
    // `HostServer.close()` destroys open connections on `ccx stop` — an ordinary shutdown landing inside
    // a poller's probe window. With no `close` handler this promise stayed pending forever.
    const path = await peer((s) => s.destroy());
    const [v, ms] = await timed(askStatus(path));
    expect(v).toBeUndefined();
    expect(ms).toBeLessThan(PROMPT);
  });

  it("settles when the peer half-closes with a FIN and no reply", async () => {
    const path = await peer((s) => s.end());            // a host process exiting after the kernel accepted us
    const [v, ms] = await timed(askStatus(path));
    expect(v).toBeUndefined();
    expect(ms).toBeLessThan(PROMPT);
  });

  it("settles when the peer reads the request and then destroys the connection", async () => {
    const path = await peer((s) => s.on("data", () => s.destroy()));
    const [v, ms] = await timed(askStatus(path));
    expect(v).toBeUndefined();
    expect(ms).toBeLessThan(PROMPT);
  });

  it("settles on an absolute deadline when the peer dribbles bytes with no newline", async () => {
    // The old inactivity timer was reset by every byte, so this peer held the probe open indefinitely.
    const path = await peer((s) => { const t = setInterval(() => s.write("x"), 20); s.on("close", () => clearInterval(t)); });
    const [v, ms] = await timed(askStatus(path));
    expect(v).toBeUndefined();
    expect(ms).toBeLessThan(1000);
  });

  it("gives up on a reply larger than the frame cap instead of buffering it", async () => {
    const path = await peer((s) => s.write("x".repeat(512 * 1024)));   // no newline in sight
    const [v, ms] = await timed(askStatus(path));
    expect(v).toBeUndefined();
    expect(ms).toBeLessThan(PROMPT);                    // the cap tripped, not the deadline
  });

  it("rejects an ok frame that is missing the fields the row is built from", async () => {
    // `{"ok":true}` used to come back as-is and serialize as `"state": undefined` — a row shape the
    // poller has no arm for. Half an answer is not an answer.
    expect(await timed(askStatus(await peer(reply({ ok: true }))))).toEqual([undefined, expect.any(Number)]);
    expect((await timed(askStatus(await peer(reply({ ok: true, state: "nonsense", status: "busy" })))))[0]).toBeUndefined();
    expect((await timed(askStatus(await peer(reply({ ok: true, state: "working", status: "wat" })))))[0]).toBeUndefined();
    expect((await timed(askStatus(await peer(reply({ ok: false, error: "unknown op" })))))[0]).toBeUndefined();
  });

  it("returns undefined for unparseable bytes and for a socket that cannot connect", async () => {
    const path = await peer((s) => s.write("not json at all\n"));
    expect((await timed(askStatus(path)))[0]).toBeUndefined();
    const [v, ms] = await timed(askStatus(join(root, "no-such.sock")));
    expect(v).toBeUndefined();
    expect(ms).toBeLessThan(PROMPT);
  });
});
