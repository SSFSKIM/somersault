import { describe, expect, it } from "vitest";
import { createServer } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RemoteChatSession } from "../../src/client/remote.js";

/** A stub host that replies out of order, so the client's correlation is actually exercised. */
function stubHost(path: string) {
  const srv = createServer((sock) => {
    let buf = "";
    sock.on("data", async (c) => {
      buf += c.toString();
      for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
        const req = JSON.parse(buf.slice(0, nl)); buf = buf.slice(nl + 1);
        const delay = req.op === "status" ? 50 : 0;      // status answers LAST despite being sent first
        setTimeout(() => sock.write(JSON.stringify({ ok: true, id: req.id, op: req.op }) + "\n"), delay);
      }
    });
  });
  return new Promise<typeof srv>((r) => srv.listen(path, () => r(srv)));
}

describe("RemoteChatSession", () => {
  it("matches replies by id even when they arrive out of order", async () => {
    const p = join(mkdtempSync(join(tmpdir(), "ccx-rc-")), "h.sock");
    const srv = await stubHost(p);
    const c = await RemoteChatSession.connect(p);
    const [status, pending] = await Promise.all([c.status(), c.pending()]);
    expect((status as any).op).toBe("status");
    expect((pending as any).op).toBe("pending");
    c.detach(); srv.close();
  });

  it("detach() closes the socket without sending stop", async () => {
    const p = join(mkdtempSync(join(tmpdir(), "ccx-rc-")), "h.sock");
    const seen: string[] = [];
    const srv = createServer((sock) => sock.on("data", (c) => seen.push(String(c))));
    await new Promise<void>((r) => srv.listen(p, () => r()));
    const c = await RemoteChatSession.connect(p);
    c.detach();
    await new Promise((r) => setTimeout(r, 30));
    expect(seen.join("")).not.toContain('"stop"');
    srv.close();
  });

  it("a pending request rejects when the host goes away, rather than hanging forever", async () => {
    const p = join(mkdtempSync(join(tmpdir(), "ccx-rc-")), "h.sock");
    const srv = createServer(() => {});                   // accepts, never replies
    await new Promise<void>((r) => srv.listen(p, () => r()));
    const c = await RemoteChatSession.connect(p);
    const inflight = c.status();
    srv.close(); (c as any).sock.destroy();
    await expect(inflight).rejects.toThrow();
    c.detach();
  });

  it("removes a settled request from the in-flight map exactly once (no dangling entry after resolve)", async () => {
    const p = join(mkdtempSync(join(tmpdir(), "ccx-rc-")), "h.sock");
    const srv = createServer((sock) => sock.on("data", (c) => {
      const req = JSON.parse(String(c).trim());
      sock.write(JSON.stringify({ ok: true, id: req.id, op: req.op }) + "\n");
    }));
    await new Promise<void>((r) => srv.listen(p, () => r()));
    const c = await RemoteChatSession.connect(p);
    await c.status();
    expect((c as any).inflight.size).toBe(0);
    c.detach(); srv.close();
  });

  function opCounter(p: string) {
    const seen: string[] = [];
    const srv = createServer((sock) => {
      let buf = "";
      sock.on("data", (chunk) => {
        buf += chunk.toString();
        for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
          const req = JSON.parse(buf.slice(0, nl)); buf = buf.slice(nl + 1);
          seen.push(req.op);
          sock.write(JSON.stringify({ ok: true, id: req.id, op: req.op }) + "\n");
        }
      });
    });
    return { seen, listen: () => new Promise<void>((r) => srv.listen(p, () => r())), close: () => srv.close() };
  }
  const settle = () => new Promise((r) => setTimeout(r, 20));

  it("follow(): the same callback subscribed twice is two independent subscriptions — dropping one leaves the other live", async () => {
    const p = join(mkdtempSync(join(tmpdir(), "ccx-rc-")), "h.sock");
    const host = opCounter(p);
    await host.listen();
    const c = await RemoteChatSession.connect(p);
    const cb = () => {};
    const off1 = c.follow(cb);
    const off2 = c.follow(cb);          // same function reference, a second subscription
    await settle();
    expect(host.seen.filter((o) => o === "follow").length).toBe(1);   // only the FIRST subscriber sends `follow`
    off1();                             // drop one of the two — the other subscription must still be live
    await settle();
    expect(host.seen.filter((o) => o === "unfollow").length).toBe(0); // premature unfollow would mean a lost subscription
    off2();                             // now the last one leaves
    await settle();
    expect(host.seen.filter((o) => o === "unfollow").length).toBe(1);
    c.detach(); host.close();
  });

  it("tears down the connection on an over-cap unterminated frame rather than growing the buffer forever", async () => {
    const p = join(mkdtempSync(join(tmpdir(), "ccx-rc-")), "h.sock");
    // A host in a bad state: writes far more than the CLIENT's own MAX_FRAME (32 MiB — see
    // src/client/remote.ts) with no newline anywhere in it. (This is deliberately well above the
    // server's separate, smaller 256 KiB cap: the two directions no longer share one constant.)
    const srv = createServer((sock) => {
      sock.on("error", () => {});    // the client destroys its end mid-write; that EPIPE is not this test's concern
      sock.write("x".repeat(33 * 1024 * 1024));
    });
    await new Promise<void>((r) => srv.listen(p, () => r()));
    const c = await RemoteChatSession.connect(p);
    const closed = new Promise<void>((r) => (c as any).sock.once("close", r));
    const inflight = c.status();               // parked before the flood lands — must reject, not hang
    // 33 MiB takes a while to land and cross the cap — long enough that this request's OWN 10s
    // deadline (REQUEST_TIMEOUT_MS) can fire before the `await closed` below resumes and the real
    // `.rejects` assertion attaches. Attach a throwaway handler now so that legitimate-but-early
    // rejection is never "unhandled" in the interim; the real assertion below still runs against the
    // same promise regardless of which of the two ways it settles.
    inflight.catch(() => {});
    await closed;                              // the client destroyed its own end of the socket
    expect((c as any).buf.length).toBe(0);     // the buffer was discarded, not left to keep growing
    await expect(inflight).rejects.toThrow();
    srv.close();
  });

  it("keeps a legitimate large frame delivered in several chunks intact, rather than tearing down the connection", async () => {
    const p = join(mkdtempSync(join(tmpdir(), "ccx-rc-")), "h.sock");
    // A real turn's event frame, not a runaway peer: comfortably over the SERVER's 256 KiB MAX_FRAME (a
    // single tool result can be far bigger — follow.ts's own TurnBuffer is sized around a 2 MiB one),
    // delivered in several chunks with a properly-terminating newline only at the very end.
    const big = "y".repeat(500 * 1024);
    const line = JSON.stringify({ t: "event", kind: "message", data: { big } }) + "\n";
    const srv = createServer((sock) => {
      sock.on("error", () => {});
      let i = 0;
      const chunk = 32 * 1024;
      const pump = () => {
        if (i >= line.length) return;
        sock.write(line.slice(i, i + chunk));
        i += chunk;
        setTimeout(pump, 1);
      };
      pump();
    });
    await new Promise<void>((r) => srv.listen(p, () => r()));
    const c = await RemoteChatSession.connect(p);
    const seen: any[] = [];
    c.follow((e) => seen.push(e));
    await new Promise((r) => setTimeout(r, 500));   // give every chunk time to land
    expect((c as any).sock.destroyed).toBe(false);   // must NOT have torn down the connection
    expect(seen).toHaveLength(1);
    expect(seen[0].data.big.length).toBe(big.length);   // and the frame must have arrived intact
    c.detach(); srv.close();
  });

  it("follow(): calling the same unsubscribe function twice sends `unfollow` only once", async () => {
    const p = join(mkdtempSync(join(tmpdir(), "ccx-rc-")), "h.sock");
    const host = opCounter(p);
    await host.listen();
    const c = await RemoteChatSession.connect(p);
    const off = c.follow(() => {});
    await settle();
    off(); off();
    await settle();
    expect(host.seen.filter((o) => o === "unfollow").length).toBe(1);
    c.detach(); host.close();
  });
});
