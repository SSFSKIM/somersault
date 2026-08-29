// Probe 119b — What is in a `command_lifecycle` frame, and does a peer message get one?
//
// Probe 119's transcript carried frames of type `command_lifecycle` that nothing in this project has ever
// looked at: they appear in neither `sdk.d.ts` nor the February reference source, which puts them in the
// same category as `messaging_socket_path` — on the wire, absent from the public types.
//
// They matter because of what the reference source showed the CLI doing around its queue:
// `notifyCommandLifecycle(uuid, 'started')` before an ask() and `'completed'` after, fanned out over
// every uuid in a batch. If the emitted frame carries that pair, then the engine states per MESSAGE
// exactly what the M8 design has been trying to infer from turn shape:
//   - which queued message is now executing (and therefore whether a turn is the host's or a peer's),
//   - when it finished,
//   - and, for a batch, that N messages belong to one execution.
// That would replace the design's "model production while we believe idle" trigger with an engine
// statement, and it would resolve the fold too — a folded message is one that completes without ever
// having a turn of its own.
//
//   Q1  What are the frame's exact fields? Dumped verbatim (redacted), for our own turns.
//   Q2  Does a PEER-delivered message get the same frames, keyed by the uuid seen on its replay?
//   Q3  Does a FOLDED message get a `completed` even though it never had a turn?
//
// One short session, one host turn, one peer message delivered while idle, and one delivered mid-turn.
//
// Run from CC-to-SDK/probes:
//   unset ANTHROPIC_API_KEY; npx tsx probes/119b-command-lifecycle-frames.ts
import { createConnection } from "node:net";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";

function loadKey(): void {
  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    const file = process.env.CCX_ENV_FILE ?? resolve(import.meta.dirname, "../../.env");
    try {
      for (const line of readFileSync(file, "utf8").split("\n")) {
        const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
        if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
      }
    } catch (e) { console.log("[env] could not read env file:", (e as Error)?.name); }
  }
  delete process.env.ANTHROPIC_API_KEY;
  console.log("[env] keyed:", Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN));
}
loadKey();

const log = (...a: unknown[]) => console.log("[p119b]", ...a);
const SESSIONS_DIR = join(homedir(), ".claude", "sessions");
setTimeout(() => { log("!!! GLOBAL WATCHDOG (420s)"); process.exit(2); }, 420_000).unref?.();

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
async function until(pred: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (pred()) return true; await wait(300); }
  return pred();
}
function envelope(from: string, name: string, mode: "bypass" | "prompting", body: string): string {
  return `<cross-session-message from="${from}" from-name="${name}" from-mode="${mode}">\n${body}\n</cross-session-message>`;
}
function rowForSession(sessionId: string): any {
  try {
    for (const f of readdirSync(SESSIONS_DIR)) {
      if (!/^\d+\.json$/.test(f)) continue;
      const j = JSON.parse(readFileSync(join(SESSIONS_DIR, f), "utf8"));
      if (j.sessionId === sessionId) return j;
    }
  } catch { /* none */ }
  return undefined;
}
function peerTokenFor(pid: number): string | undefined {
  try {
    for (const f of readdirSync(SESSIONS_DIR)) {
      const m = /^(\d+)\.[0-9a-f]{64}\.key$/.exec(f);
      if (!m || Number(m[1]) !== pid) continue;
      const j = JSON.parse(readFileSync(join(SESSIONS_DIR, f), "utf8"));
      if (typeof j.peerToken === "string") return j.peerToken;   // never printed
    }
  } catch { /* absent */ }
  return undefined;
}
function sendFrames(sock: string, frames: unknown[]): Promise<string> {
  return new Promise(res => {
    const c = createConnection(sock);
    let done = false;
    const fin = (v: string) => { if (!done) { done = true; res(v); } };
    c.on("connect", () => { for (const f of frames) c.write(JSON.stringify(f) + "\n"); c.end(); });
    c.on("error", e => fin("ERROR:" + (e as NodeJS.ErrnoException).code));
    c.on("close", () => fin("CLOSED"));
    setTimeout(() => fin("TIMEOUT"), 10_000).unref?.();
  });
}
/** Frames may carry message text; keep the SHAPE and drop anything long. */
function redact(v: unknown): unknown {
  if (typeof v === "string") return v.length > 60 ? v.slice(0, 60) + "…" : v;
  if (Array.isArray(v)) return v.map(redact);
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) o[k] = k === "token" ? "[REDACTED]" : redact(x);
    return o;
  }
  return v;
}

interface Rec { i: number; kind: string; detail: string }
const F: Rec[] = [];
const put = (kind: string, detail: string) => { F.push({ i: F.length, kind, detail }); };
const lifecycle: { i: number; frame: any }[] = [];
const results: any[] = [];
const replays: any[] = [];
let init: any;
let toolCalls = 0;

const HOST_UUID = randomUUID();
const IDLE_MARK = `P119B-IDLE-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
const FOLD_MARK = `P119B-FOLD-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

(async () => {
  let pushLong: (() => void) | undefined;
  const longGate = new Promise<void>(r => { pushLong = r; });
  const forever = new Promise<void>(() => { /* keep alive */ });

  async function* input() {
    yield { type: "user" as const, uuid: HOST_UUID, message: { role: "user" as const, content: "Say READY and nothing else." }, parent_tool_use_id: null, session_id: "x" };
    await longGate;
    yield {
      type: "user" as const, uuid: randomUUID(),
      message: { role: "user" as const, content: "Run these two bash commands in the foreground, one at a time: `sleep 8; echo x`, `sleep 8; echo y`. Then say OMEGA." },
      parent_tool_use_id: null, session_id: "x",
    };
    await forever;
  }

  const q: any = query({
    prompt: input(),
    options: {
      model: "claude-sonnet-4-5", cwd: process.cwd(), settingSources: [],
      settings: { crossSessionInbound: "accept" }, permissionMode: "bypassPermissions",
      extraArgs: { debug: null, "replay-user-messages": null },
    } as any,
  });

  (async () => {
    for await (const m of q) {
      const t = (m as any).type;
      if (t === "system" && (m as any).subtype === "init") { if (!init) init = m; put("init", ""); }
      else if (t === "command_lifecycle") { lifecycle.push({ i: F.length, frame: m }); put("command_lifecycle", JSON.stringify(redact(m))); }
      else if (t === "user") {
        if ((m as any).isReplay) { replays.push(m); put("replay", `uuid=${(m as any).uuid} origin=${(m as any).origin?.kind ?? "none"}`); }
        else put("user", "tool_result/other");
      } else if (t === "assistant") {
        for (const b of (m as any).message?.content ?? []) {
          if (b.type === "text" && b.text.trim()) put("text", b.text.trim().slice(0, 80));
          if (b.type === "tool_use") { toolCalls++; put("tool", String(b.name)); }
        }
      } else if (t === "result") { results.push(m); put("result", `uuid=${(m as any).user_message_uuid ?? "(none)"}`); }
    }
  })().catch(e => put("stream-end", (e as Error).message.slice(0, 80)));

  if (!await until(() => Boolean(init), 120_000)) { log("no init"); process.exit(3); }
  const sock = init.messaging_socket_path as string;
  const row = rowForSession(init.session_id);
  if (!sock || !existsSync(sock)) { log("no inbox"); process.exit(3); }

  const ourSock = join(dirname(sock), `${process.pid}.sock`);
  const lstart = (() => { try { return execFileSync("ps", ["-o", "lstart=", "-p", String(process.pid)], { encoding: "utf8", env: { ...process.env, LC_ALL: "C", TZ: "UTC" } }).trim(); } catch { return undefined; } })();
  const keyPath = join(SESSIONS_DIR, `${process.pid}.${createHash("sha256").update(ourSock).digest("hex")}.key`);
  writeFileSync(keyPath, JSON.stringify({ peerToken: createHash("sha256").update(`p119b-${process.pid}`).digest("hex").slice(0, 32), procStart: lstart }, null, 2), { mode: 0o600 });
  const ourAddr = `uds:${ourSock}`;
  const token = peerTokenFor(row?.pid);

  const deliver = async (mark: string) => {
    const frames: unknown[] = [];
    if (token) frames.push({ type: "auth", token });
    frames.push({
      type: "user", session_id: init.session_id, from: ourAddr,
      message: { content: envelope(ourAddr, "probe-119b", "bypass", `Reply with exactly this token and nothing else: ${mark}`) },
      priority: "next", msg_id: randomUUID(),
    });
    return sendFrames(sock, frames);
  };

  // Phase A — host turn settles, then a peer message on an IDLE session.
  if (!await until(() => results.length >= 1, 180_000)) { log("host turn 1 never settled"); process.exit(5); }
  const idleAt = F.length;
  log(`A: delivering to an idle session: ${await deliver(IDLE_MARK)}`);
  if (!await until(() => results.length >= 2, 240_000)) log("A: no second result (peer turn did not settle)");
  await wait(6000);

  // Phase B — a long host turn with round-trips left, then a peer message mid-turn (the fold).
  const foldAt = F.length;
  const resultsBeforeLong = results.length;
  const toolCallsBeforeLong = toolCalls;
  pushLong?.();
  let phaseB = "skipped";
  if (await until(() => toolCalls > toolCallsBeforeLong && results.length === resultsBeforeLong, 180_000)) {
    log(`B: delivering mid-turn (fold expected): ${await deliver(FOLD_MARK)}`);
    if (!await until(() => results.length > resultsBeforeLong, 300_000)) log("B: long turn never settled");
    phaseB = "ran";
    await wait(15_000);
  } else {
    log("B: long turn never started a tool call — phase B skipped, reporting phase A regardless");
  }

  console.log("\n--- transcript ---");
  for (const r of F) console.log(`   ${String(r.i).padStart(3)} ${r.kind.padEnd(18)} ${r.detail}`);

  console.log("\n=== VERDICT (probe 119b) ===");
  console.log(`[Q1] command_lifecycle frames seen: ${lifecycle.length}`);
  const keys = new Set<string>();
  for (const l of lifecycle) for (const k of Object.keys(l.frame ?? {})) keys.add(k);
  console.log(`      union of fields: ${[...keys].sort().join(", ") || "(none)"}`);
  for (const l of lifecycle.slice(0, 8)) console.log(`      @${String(l.i).padStart(3)} ${JSON.stringify(redact(l.frame))}`);
  const peerReplays = replays.filter(r => r.origin?.kind === "peer");
  const idleUuid = peerReplays[0]?.uuid, foldUuid = peerReplays[1]?.uuid;
  // The state field is spelled `state`. The first cut of this line guessed `subtype`/`status`/`phase`
  // and therefore printed `?` for every frame while the raw dump above carried the answer all along —
  // the same failure mode probes 118/118b had, and the reason their verdict logic was corrected too:
  // a probe that misreports its own measurement is worse than one that reports nothing.
  const carries = (u?: string) => u === undefined ? "(no replay)" : lifecycle.filter(l => JSON.stringify(l.frame).includes(u)).map(l => String(l.frame?.state ?? "?")).join(",") || "none";
  console.log(`[Q2] lifecycle entries naming the IDLE peer message (${idleUuid ?? "?"}): ${carries(idleUuid)}`);
  console.log(`[Q3] lifecycle entries naming the FOLDED peer message (${foldUuid ?? "?"}): ${carries(foldUuid)}`);
  console.log(`      host turn 1 uuid ${HOST_UUID}: ${carries(HOST_UUID)}`);
  console.log(`      markers echoed — idle: ${F.some(r => r.kind === "text" && r.detail.includes(IDLE_MARK)) ? "yes" : "no"}, fold: ${F.some(r => r.kind === "text" && r.detail.includes(FOLD_MARK)) ? "yes" : "no"}`);
  console.log(`      results: ${results.length} | peer replays: ${peerReplays.length} | phase A@${idleAt} B@${foldAt} (${phaseB})`);

  try { unlinkSync(keyPath); } catch { /* gone */ }
  process.exit(0);
})();
