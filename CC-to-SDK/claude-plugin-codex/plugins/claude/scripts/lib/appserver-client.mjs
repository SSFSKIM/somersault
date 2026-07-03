// Compact peer for cc-codex-appserver's v2-lite JSON-RPC (NDJSON, no "jsonrpc" field).
// Fresh module (not a port): our server's notification stream is far simpler than real Codex's
// app-server, so this replaces the blueprint's much larger app-server.mjs + captureTurn machinery.
import { spawn, spawnSync } from "node:child_process";

/** Resolve how to launch the appserver: CLAUDE_COMPANION_APPSERVER env override (space-split into
 *  command + args), else "cc-codex-appserver" if it's on PATH. Returns null when unresolvable. */
export function resolveAppserverCommand(env = process.env) {
  const override = (env.CLAUDE_COMPANION_APPSERVER ?? "").trim();
  if (override) {
    const parts = override.split(/\s+/);
    return { command: parts[0], args: parts.slice(1) };
  }
  const probe = spawnSync(process.platform === "win32" ? "where" : "which", ["cc-codex-appserver"], { env, encoding: "utf8" });
  if (probe.status === 0 && probe.stdout.trim()) return { command: "cc-codex-appserver", args: [] };
  return null;
}

/** Spawn + initialize an AppServerClient. Throws Error("worker-not-found") when unresolvable. */
export async function spawnAppServer({ cwd = process.cwd(), env = process.env, onStderr } = {}) {
  const cmd = resolveAppserverCommand(env);
  if (!cmd) { const e = new Error("worker-not-found"); e.code = "WORKER_NOT_FOUND"; throw e; }
  const child = spawn(cmd.command, [...cmd.args], { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
  const client = new AppServerClient(child, onStderr);
  await client._initialize();
  return client;
}

class AppServerClient {
  constructor(child, onStderr) {
    this.child = child; this.nextId = 1; this.pending = new Map(); this.turns = new Map(); this.buf = ""; this.exited = false;
    child.stdout.on("data", (c) => this._feed(c.toString()));
    child.stderr.on("data", (c) => onStderr?.(c.toString()));
    child.on("exit", (code, signal) => {
      this.exited = true;
      const err = new Error(`appserver exited: ${code ?? signal}`);
      for (const [, p] of this.pending) p.reject(err); this.pending.clear();
      for (const [, t] of this.turns) t.reject(err); this.turns.clear();
    });
  }
  alive() { return !this.exited; }
  _send(obj) { this.child.stdin.write(JSON.stringify(obj) + "\n"); }
  _request(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this._send({ id, method, params }); });
  }
  _feed(chunk) {
    this.buf += chunk;
    let nl;
    while ((nl = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (line) this._dispatch(line);
    }
  }
  _dispatch(line) {
    let msg; try { msg = JSON.parse(line); } catch { return; }
    if (msg.method && msg.id !== undefined && msg.id !== null) return this._send({ id: msg.id, error: { code: -32601, message: "unsupported server request" } });
    if (msg.method) return this._onNotification(msg.method, msg.params ?? {});
    const p = this.pending.get(msg.id);
    if (p) { this.pending.delete(msg.id); msg.error ? p.reject(Object.assign(new Error(msg.error.message), { rpc: msg.error })) : p.resolve(msg.result); }
  }
  _onNotification(method, params) {
    // turnId lives at the top level for item/completed + thread/tokenUsage/updated, but only nested
    // under turn.id for turn/completed|failed (see translator.ts) — try both.
    const turnId = params?.turnId ?? params?.turn?.id;
    const t = turnId && this.turns.get(turnId);
    if (!t) return;
    if (method === "item/completed" && params.item?.type === "agentMessage") {
      if (params.item.phase === "final_answer") t.finalText = params.item.text;
      else { t.commentary.push(params.item.text); t.onProgress?.(params.item.text); }
    } else if (method === "thread/tokenUsage/updated") t.usage = params.tokenUsage?.total ?? null;
    else if (method === "turn/completed") t.resolveWith("completed");
    else if (method === "turn/failed") t.resolveWith("failed");
  }
  async _initialize() {
    await this._request("initialize", { clientInfo: { name: "claude-companion", title: "Claude Plugin", version: "0.1.0" } });
    this._send({ method: "initialized" });
  }
  async threadStart({ cwd, model, effort, write, outputSchema }) {
    const r = await this._request("thread/start", { cwd, model, effort, approvalPolicy: "never", sandbox: write ? "workspace-write" : "read-only", ...(outputSchema ? { outputSchema } : {}) });
    return { threadId: r.thread.id };
  }
  async threadResume({ threadId, cwd, model, effort, write }) {
    const r = await this._request("thread/resume", { threadId, cwd, model, effort, approvalPolicy: "never", sandbox: write ? "workspace-write" : "read-only" });
    return { threadId: r.thread.id };
  }
  // Registers the turn's collector only AFTER the turn/start reply resolves. This is safe because
  // handlers.ts's turnStart() replies (peer.reply) BEFORE it kicks off the async turn (void
  // this.runTurn(...)) — so no item/turn notification for this turnId can be written to the wire
  // before the reply carrying that turnId is. Keep this comment: it documents a real, load-bearing
  // wire-ordering assumption, not just a client-side implementation detail.
  runTurn({ threadId, prompt, onProgress }) {
    return new Promise((resolve, reject) => {
      this._request("turn/start", { threadId, input: [{ type: "text", text: prompt }] }).then((r) => {
        const turnId = r.turn.id;
        const t = {
          finalText: "", commentary: [], usage: null, onProgress, reject,
          resolveWith: (status) => { this.turns.delete(turnId); resolve({ status, finalText: t.finalText, commentary: t.commentary, usage: t.usage, turnId }); },
        };
        this.turns.set(turnId, t);
        if (r.turn.status && r.turn.status !== "inProgress") t.resolveWith(r.turn.status);
      }, reject);
    });
  }
  async interrupt({ threadId }) { return this._request("turn/interrupt", { threadId }); }
  async accountRead() { const r = await this._request("account/read", {}); return r.account ?? { authenticated: false }; }
  async close() {
    try { this.child.stdin.end(); } catch {}
    const done = new Promise((r) => this.child.once("exit", r));
    const timer = setTimeout(() => this.child.kill("SIGKILL"), 2000);
    await done;
    clearTimeout(timer);
  }
}
