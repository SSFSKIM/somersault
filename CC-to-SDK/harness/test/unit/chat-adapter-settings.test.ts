// harness/test/unit/chat-adapter-settings.test.ts — Task 2 (W3): remoteChatSession's SettingsOps surface.
// Mirrors client-chat-adapter.test.ts's tests 12/15 fake-socket pattern: a raw net stub host answers
// `follow` (the adapter's ready-gate awaits it) and canned per-op replies, recording every frame it saw —
// so each test asserts BOTH the exact op frame sent AND the reply-field unwrap, without a real SessionHost.
import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "node:net";
import type { Server } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { remoteChatSession } from "../../src/client/chatAdapter.js";
import { hasSettingsOps } from "../../src/session/chatSession.js";

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

/** `replies[op]` is the canned body (sans `id`) returned for that op; `follow` always answers `{ok:true}`
 *  unconditionally so the adapter's ready-gate never stalls. Every request the server sees is pushed to
 *  `seen` in arrival order, `id` included, for exact-frame assertions. */
function stubHost(replies: Record<string, Record<string, unknown>>) {
  const seen: Record<string, unknown>[] = [];
  const dir = mkdtempSync(join(tmpdir(), "ccx-settings-adapter-"));
  dirs.push(dir);
  const path = join(dir, "h.sock");
  const srv: Server = createServer((sock) => {
    let buf = "";
    sock.on("data", (c) => {
      buf += c.toString();
      for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
        const req = JSON.parse(buf.slice(0, nl)); buf = buf.slice(nl + 1);
        seen.push(req);
        const canned = req.op === "follow" ? { ok: true } : (replies[req.op] ?? { ok: true });
        sock.write(JSON.stringify({ ...canned, id: req.id }) + "\n");
      }
    });
  });
  const listen = () => new Promise<void>((r) => srv.listen(path, () => r()));
  return { srv, path, seen, listen };
}

describe("remoteChatSession — SettingsOps (W3 T2)", () => {
  it("1. getSettings sends {op:get_settings} and unwraps the settings field; hasSettingsOps guards true", async () => {
    const host = stubHost({ get_settings: { ok: true, settings: { effective: { permissionMode: "default" } } } });
    await host.listen();
    const adapter = remoteChatSession(host.path);
    try {
      await adapter.whenReady();
      expect(hasSettingsOps(adapter)).toBe(true);
      await expect(adapter.getSettings()).resolves.toEqual({ effective: { permissionMode: "default" } });
      expect(host.seen.some((f) => f.op === "get_settings")).toBe(true);
    } finally {
      adapter.detach();
      host.srv.close();
    }
  });

  it("2. listDirs sends {op:list_dirs} and unwraps the dirs field", async () => {
    const dirsReply = [{ path: "/work", source: "cwd" }, { path: "/extra", source: "session" }];
    const host = stubHost({ list_dirs: { ok: true, dirs: dirsReply } });
    await host.listen();
    const adapter = remoteChatSession(host.path);
    try {
      await adapter.whenReady();
      await expect(adapter.listDirs()).resolves.toEqual(dirsReply);
      expect(host.seen.some((f) => f.op === "list_dirs")).toBe(true);
    } finally {
      adapter.detach();
      host.srv.close();
    }
  });

  it("3. addDir sends {op:add_dir, path} and resolves void on {ok:true}", async () => {
    const host = stubHost({ add_dir: { ok: true } });
    await host.listen();
    const adapter = remoteChatSession(host.path);
    try {
      await adapter.whenReady();
      await expect(adapter.addDir("/new/path")).resolves.toBeUndefined();
      const frame = host.seen.find((f) => f.op === "add_dir");
      expect(frame).toMatchObject({ op: "add_dir", path: "/new/path" });
    } finally {
      adapter.detach();
      host.srv.close();
    }
  });

  it("4. removeDir sends {op:remove_dir, path} and resolves void on {ok:true}", async () => {
    const host = stubHost({ remove_dir: { ok: true } });
    await host.listen();
    const adapter = remoteChatSession(host.path);
    try {
      await adapter.whenReady();
      await expect(adapter.removeDir("/gone")).resolves.toBeUndefined();
      const frame = host.seen.find((f) => f.op === "remove_dir");
      expect(frame).toMatchObject({ op: "remove_dir", path: "/gone" });
    } finally {
      adapter.detach();
      host.srv.close();
    }
  });

  it("5. setOutputStyle sends {op:set_output_style, style} and resolves void on {ok:true}", async () => {
    const host = stubHost({ set_output_style: { ok: true } });
    await host.listen();
    const adapter = remoteChatSession(host.path);
    try {
      await adapter.whenReady();
      await expect(adapter.setOutputStyle("concise")).resolves.toBeUndefined();
      const frame = host.seen.find((f) => f.op === "set_output_style");
      expect(frame).toMatchObject({ op: "set_output_style", style: "concise" });
    } finally {
      adapter.detach();
      host.srv.close();
    }
  });

  it("6. addRule sends {op:add_rule, behavior, rule} and resolves void on {ok:true}", async () => {
    const host = stubHost({ add_rule: { ok: true } });
    await host.listen();
    const adapter = remoteChatSession(host.path);
    try {
      await adapter.whenReady();
      await expect(adapter.addRule("allow", "Bash(npm run *)")).resolves.toBeUndefined();
      const frame = host.seen.find((f) => f.op === "add_rule");
      expect(frame).toMatchObject({ op: "add_rule", behavior: "allow", rule: "Bash(npm run *)" });
    } finally {
      adapter.detach();
      host.srv.close();
    }
  });

  it("7. removeRule sends {op:remove_rule, behavior, rule} and resolves void on {ok:true}", async () => {
    const host = stubHost({ remove_rule: { ok: true } });
    await host.listen();
    const adapter = remoteChatSession(host.path);
    try {
      await adapter.whenReady();
      await expect(adapter.removeRule("deny", "Bash(rm -rf *)")).resolves.toBeUndefined();
      const frame = host.seen.find((f) => f.op === "remove_rule");
      expect(frame).toMatchObject({ op: "remove_rule", behavior: "deny", rule: "Bash(rm -rf *)" });
    } finally {
      adapter.detach();
      host.srv.close();
    }
  });

  // WAVE C TASK 11 (EP-C6): `set_effort` is the flag-layer op the effort surfaces drive. It rides SettingsOps
  // and not ChatSession because it IS a flag-settings write — the host answers it with
  // `applyFlagSettings({effortLevel})`, which probe 102 proved is the only runtime effort hook the SDK has.
  it("9. setEffort sends {op:set_effort, level} and resolves void on {ok:true}", async () => {
    const host = stubHost({ set_effort: { ok: true } });
    await host.listen();
    const adapter = remoteChatSession(host.path);
    try {
      await adapter.whenReady();
      await expect(adapter.setEffort("xhigh")).resolves.toBeUndefined();
      expect(host.seen.find((f) => f.op === "set_effort")).toMatchObject({ op: "set_effort", level: "xhigh" });
    } finally {
      adapter.detach();
      host.srv.close();
    }
  });

  // Task 2 (bl8 T-ADVCMD): `set_advisor_model` rides the same SettingsOps surface as `set_effort` above,
  // same reasoning — the host answers it with `applyFlagSettings({advisorModel})` (P119 case 4).
  it("10. setAdvisorModel sends {op:set_advisor_model, model} and resolves void on {ok:true}", async () => {
    const host = stubHost({ set_advisor_model: { ok: true } });
    await host.listen();
    const adapter = remoteChatSession(host.path);
    try {
      await adapter.whenReady();
      if (!hasSettingsOps(adapter)) throw new Error("adapter lacks SettingsOps");
      await expect(adapter.setAdvisorModel("claude-opus-5")).resolves.toBeUndefined();
      expect(host.seen.find((f) => f.op === "set_advisor_model")).toMatchObject({ op: "set_advisor_model", model: "claude-opus-5" });
    } finally {
      adapter.detach();
      host.srv.close();
    }
  });

  // `null` must round-trip as the JSON value `null` — canon's explicit "off" — never get stringified
  // ("null") or dropped as an absent field, either of which would silently keep the wrong advisor live.
  it("11. setAdvisorModel(null) sends {op:set_advisor_model, model:null}, not a stringified/dropped value", async () => {
    const host = stubHost({ set_advisor_model: { ok: true } });
    await host.listen();
    const adapter = remoteChatSession(host.path);
    try {
      await adapter.whenReady();
      if (!hasSettingsOps(adapter)) throw new Error("adapter lacks SettingsOps");
      await expect(adapter.setAdvisorModel(null)).resolves.toBeUndefined();
      const frame = host.seen.find((f) => f.op === "set_advisor_model");
      expect(frame).toMatchObject({ op: "set_advisor_model", model: null });
      expect(frame!["model"]).not.toBe("null");
    } finally {
      adapter.detach();
      host.srv.close();
    }
  });

  it("8. an {ok:false,error} reply rejects with that error — proven on addDir and removeRule", async () => {
    const host = stubHost({
      add_dir: { ok: false, error: "already tracked" },
      remove_rule: { ok: false, error: "no such rule" },
    });
    await host.listen();
    const adapter = remoteChatSession(host.path);
    try {
      await adapter.whenReady();
      await expect(adapter.addDir("/dup")).rejects.toThrow("already tracked");
      await expect(adapter.removeRule("ask", "nope")).rejects.toThrow("no such rule");
    } finally {
      adapter.detach();
      host.srv.close();
    }
  });
});
