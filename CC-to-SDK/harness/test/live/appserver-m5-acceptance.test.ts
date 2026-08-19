// test/live/appserver-m5-acceptance.test.ts — M5 Task 14: the config domain, thread search/archive and the
// two 0.3.234 absorb surfaces, executed against a REAL engine and a REAL session store in ONE keyed run.
//
// Shape and discipline are `appserver-m4-acceptance.test.ts`'s, deliberately: ONE describe, sequential
// `it`s sharing state over ONE app server and TWO WS clients, each with its own generous timeout. The
// sequence is stateful — a session cannot be archived before it has been recorded, and it cannot be
// searched before it holds text — and a server per `it` would multiply the keyed cost for nothing. The
// cheap deterministic leg runs FIRST (LEG 1, which needs no engine at all) so a broken build fails in
// seconds rather than after three model turns.
//
// ── THE SAFETY RULE, AND HOW IT IS CHECKED ─────────────────────────────────────────────────────────
// M5 ships config WRITES. Every path this file can reach is redirected into one temp root through the
// server's own DI: `configHome` (the user settings layer), `managedSettingsPath` (a file deliberately
// never created) and `ccxDir` (the archive marker store). The redirection is ASSERTED, never assumed,
// because a leg that silently fell back to the operator's real `~/.claude` would look identical to one
// that worked:
//   · LEG 1 compares each `versions` token against the sha256 of the temp file's OWN bytes, and each
//     `filePath` against the temp file's canonical path — a reply computed from `~/.claude/settings.json`
//     cannot satisfy either;
//   · LEG 4b asserts the archive marker exists under the injected `ccxDir` AND is absent from the default
//     state directory `fleetRoot()` would have chosen — the discriminator, not just the positive. (Under
//     vitest that default is itself a throwaway directory, since `test/setup/fleetRoot.ts` pins
//     `CCX_FLEET_ROOT` per file; the assertion is therefore about the DI being honoured, and the operator's
//     real `~/.claude/ccx` was never reachable from this process to begin with.)
//   · the SAFETY leg re-reads the operator's real `~/.claude/settings.json` / `settings.local.json` and
//     requires them byte-identical to the snapshot taken before the server was built, and requires every
//     `filePath` the server named during the run to live under the temp root.
// The ONE store this file deliberately does not redirect is the SESSION store: leg 2 is "search over the
// real store", so the threads run at a temp `cwd` and their transcripts land in the operator's real
// `~/.claude/projects/<slug-of-that-temp-cwd>`. `afterAll` deletes the session it created.
//
// ── WHICH ASSERTIONS COULD FAIL FOR ENGINE REASONS ─────────────────────────────────────────────────
// Almost everything here tests OUR code and is deterministic given a working engine: a merged config, a
// CAS conflict, a masked write, a snippet, a cursor that lands, a marker file, a broadcast. Two claims
// are about the ENGINE's own behaviour and are tagged `ENGINE-DEPENDENT` at their site:
//   · that `terminal_slash_commands` on a real init frame contains `doctor` and `color` (probe 112's
//     measurement on CLI 2.1.234). The surrounding assertions — that the field arrives at all, and that
//     `thread/capabilities/read` serves exactly what the LAST init frame carried — hold whatever the
//     engine's list is, including the empty case;
//   · that a `/context` turn delivers the structured `context_usage` twin (probe 111). Its VALUES are
//     asserted (a model name, positive token counts, a category taxonomy), never merely its shape.
// A failure at either site is read against the CLI that produced it before anyone goes looking for a
// regression in this server.
//
// ── THE ONE LINE THIS FILE PRINTS ──────────────────────────────────────────────────────────────────
// LEG 6's deliverable is a RECORD of what a real engine sends in its init frames — Task 13's absent-key
// contract rests on an SDK doc comment and nothing had yet watched a live engine emit (or omit) the key.
// A recorded observation that only lives in a green tick is not a record, so that leg prints exactly one
// tagged line. Everything else in this file is assertions and nothing else.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket from "ws";
import { AppServer, type AppServerDeps } from "../../src/appserver/server.js";
import { listenWs } from "../../src/appserver/transport/ws.js";
import { ERR } from "../../src/appserver/rpc.js";
import { openSession, type OpenSessionConfig } from "../../src/session/index.js";
import { fleetRoot } from "../../src/fleet/paths.js";

const live = (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN) ? describe : describe.skip;

const HAIKU = "claude-haiku-4-5-20251001";
/** Planted in the FIRST prompt: it therefore reaches the transcript AND the store's metadata corpus
 *  (`firstPrompt`/`summary`), which is what makes it the right term for the occurrence/jump leg. */
const MARKER = "m5-acceptance-halcyon";
/** Planted in a LATER prompt, and nowhere else. Every metadata field `thread/search` scans derives from
 *  the first prompt, so a hit on this one is a claim about the TRANSCRIPT having been read — the leg would
 *  otherwise be satisfiable by a metadata match that never opened a file. */
const MARKER2 = "m5-acceptance-quicksilver";

const sleep = (ms: number): Promise<void> => delay(ms);
const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");
/** File bytes, or `null` for "no such file" — the two states the SAFETY leg has to tell apart. */
const snap = (p: string): string | null => { try { return readFileSync(p, "utf8"); } catch { return null; } };

// ---------------------------------------------------------------------------------------------------
// The wire client — the same minimal WS JSON-RPC "lite" client the M1/M2/M3/M4 live files use (spec §4:
// no jsonrpc field), mirrored rather than imported because none of them exports it.
// ---------------------------------------------------------------------------------------------------

interface Notif { method: string; params: any }
interface RpcErr extends Error { rpc: true; code: number; data?: Record<string, unknown> }

class RpcClient {
  private seq = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
  readonly notifications: Notif[] = [];
  private waiters: Array<{ pred: (n: Notif) => boolean; resolve: (n: Notif) => void }> = [];
  constructor(private ws: WebSocket) {
    ws.on("message", (data) => {
      const m = JSON.parse(String(data));
      if (typeof m.id !== "undefined" && (Object.prototype.hasOwnProperty.call(m, "result") || Object.prototype.hasOwnProperty.call(m, "error"))) {
        const p = this.pending.get(m.id);
        if (!p) return;
        this.pending.delete(m.id);
        if (m.error) {
          const err = new Error(m.error.message) as RpcErr;
          err.rpc = true; err.code = m.error.code; err.data = m.error.data;
          p.reject(err);
        } else p.resolve(m.result);
        return;
      }
      if (typeof m.method === "string") {
        const n: Notif = { method: m.method, params: m.params ?? {} };
        this.notifications.push(n);
        const i = this.waiters.findIndex((w) => w.pred(n));
        if (i >= 0) { const [w] = this.waiters.splice(i, 1); w.resolve(n); }
      }
    });
  }
  /** Index of the next notification to arrive — hand it to `waitFor`/`since` to scope a wait to one leg. */
  mark(): number { return this.notifications.length; }
  call(method: string, params: Record<string, unknown> = {}, timeoutMs = 30_000): Promise<any> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`timed out after ${timeoutMs}ms waiting for a reply to ${method} (id ${id})`)); }, timeoutMs);
      this.pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  waitFor(label: string, timeoutMs: number, pred: (n: Notif) => boolean, from = 0): Promise<Notif> {
    const existing = this.notifications.slice(from).find(pred);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const entry = { pred, resolve: (n: Notif) => { clearTimeout(timer); resolve(n); } };
      const timer = setTimeout(() => {
        const i = this.waiters.indexOf(entry);
        if (i >= 0) this.waiters.splice(i, 1);
        reject(new Error(`timed out after ${timeoutMs}ms waiting for ${label} (saw since mark: ${this.notifications.slice(from).map((n) => n.method).join(", ") || "<nothing>"})`));
      }, timeoutMs);
      this.waiters.push(entry);
    });
  }
  since(from: number): Notif[] { return this.notifications.slice(from); }
}

function wsOpen(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

/** Await a call that MUST be refused, and hand back the refusal. A resolved call is the failure. */
async function rpcError(label: string, p: Promise<unknown>): Promise<RpcErr> {
  let value: unknown;
  try { value = await p; }
  catch (e) {
    if ((e as RpcErr)?.rpc === true) return e as RpcErr;
    throw e;                                   // a transport/timeout failure is not the refusal under test
  }
  throw new Error(`${label}: expected an RPC refusal, got ${JSON.stringify(value)}`);
}

live("M5 acceptance: config writes, thread search/archive and the 0.3.234 absorb surfaces, live", () => {
  let root = "";
  let home = "";          // deps.configHome — the USER settings layer's base
  let proj = "";          // the `cwd` the project/local layers are composed from
  let work = "";          // the `cwd` every thread runs at (kept apart from `proj` so no engine can
                          // stumble into the settings files the config legs are asserting on)
  let ccxDir = "";        // deps.ccxDir — where the archive markers must land
  let managedPath = "";   // deliberately never created: an absent managed layer, deterministically
  let userFile = "", localFile = "";
  let realUserSettings = "", realLocalSettings = "";
  let realUserBefore: string | null = null, realLocalBefore: string | null = null;
  /** Every `filePath` the server named in a config reply — the SAFETY leg re-checks all of them. */
  const reportedPaths: string[] = [];
  /** Every `system/init` frame a real engine emitted, teed off the session the server actually opened
   *  (see the factory in `beforeAll`). LEG 6 reads its own evidence out of here. */
  const initFrames: Array<Record<string, any>> = [];

  let server: AppServer;
  let listener: { port: number; close(): Promise<void> };
  let ws: WebSocket, wsB: WebSocket;
  let a: RpcClient;       // the driver
  let b: RpcClient;       // the SECOND client, watching: the archive broadcasts are asserted HERE
  let threadM = "";       // the live thread the markers are planted in
  let sessionM = "";      // its store session id — the identity every cold-side method uses
  const held = new Set<string>();

  /** A thread at `work`, configured exactly as the M2/M3/M4 acceptances configure theirs: `settingSources:
   *  []` so a developer's own `~/.claude/settings.json` cannot change the engine's tools or permissions,
   *  `bypassPermissions` so nothing parks (asserted per turn in `runTurn`). */
  async function startThread(model: string): Promise<string> {
    const started = await a.call("thread/start", {
      config: { cwd: work, model, settingSources: [], permissionMode: "bypassPermissions", maxTurns: 5 },
      unattended: "park",
    }, 180_000);
    const id = String(started.thread.id);
    held.add(id);
    return id;
  }

  /** One turn, followed to its end. Returns the mark taken before it started so a leg can read exactly
   *  the notifications that turn produced. */
  async function runTurn(threadId: string, input: string, label: string): Promise<{ mark: number; turnId: string }> {
    const mark = a.mark();
    const started = await a.call("turn/start", { threadId, input }, 180_000);
    expect(started.turn?.status, `${label}: turn/start did not report an in-flight turn`).toBe("inProgress");
    const turnId = String(started.turn.id);
    const done = await a.waitFor(`turn/completed (${label})`, 900_000,
      (n) => n.method === "turn/completed" && n.params.threadId === threadId && n.params.turn?.id === turnId, mark);
    expect(done.params.turn.status, `${label}: the turn did not complete cleanly: ${JSON.stringify(done.params.turn)}`).toBe("completed");
    // Nothing parked — the unattended claim, checked rather than assumed (the M4 file's discipline).
    expect(a.since(mark).filter((n) => n.method === "decision/requested" && n.params.threadId === threadId).map((n: any) => n.params.decision?.toolName),
      `${label}: a decision parked on a bypassPermissions thread — the config did not take`).toEqual([]);
    return { mark, turnId };
  }

  const hasSession = (rows: any[], sessionId: string): boolean => rows.some((r: any) => r.sessionId === sessionId);

  beforeAll(async () => {
    // `realpathSync`: on macOS `tmpdir()` is a symlink (/var -> /private/var), and these paths are compared
    // against what the server reports back as the canonical file it wrote.
    root = realpathSync(mkdtempSync(join(tmpdir(), "cc-appserver-m5-")));
    home = join(root, "home"); proj = join(root, "proj"); work = join(root, "work"); ccxDir = join(root, "ccx");
    managedPath = join(root, "managed-settings.json");
    mkdirSync(join(home, ".claude"), { recursive: true });
    mkdirSync(join(proj, ".claude"), { recursive: true });
    mkdirSync(work, { recursive: true });
    userFile = join(home, ".claude", "settings.json");
    localFile = join(proj, ".claude", "settings.local.json");
    // The operator's OWN files, snapshotted before anything in this run can reach them (SAFETY leg).
    realUserSettings = join(homedir(), ".claude", "settings.json");
    realLocalSettings = join(homedir(), ".claude", "settings.local.json");
    realUserBefore = snap(realUserSettings); realLocalBefore = snap(realLocalSettings);
    expect(home.startsWith(homedir()), "the temp config home is inside the operator's real home — pick another tmpdir").toBe(false);
    expect(existsSync(managedPath), "the managed layer file must not exist: this run asserts an absent managed layer").toBe(false);

    // The engine factory, TEED. It is the server's own default (`openSession`) with one read-only
    // observer attached, and it exists for LEG 6 alone: `thread/capabilities/read` serves a value DERIVED
    // from the init frame, so without the raw frame beside it the leg could only check our derivation
    // against itself. `onFrame` is a plain callback registry (session.ts) — subscribing changes nothing
    // about how the session runs.
    const deps: AppServerDeps = {
      configHome: home, managedSettingsPath: managedPath, ccxDir,
      sessionFactory: (c: Record<string, unknown>) => {
        const s = openSession(c as OpenSessionConfig);
        s.onFrame((m: unknown) => {
          const f = m as { type?: string; subtype?: string };
          if (f?.type === "system" && f.subtype === "init") initFrames.push(m as Record<string, any>);
        });
        return s;
      },
    };
    server = new AppServer({}, deps); // no token: this run exercises M5's domains, not auth (wsTransport.test.ts owns that)
    listener = await listenWs(server, {});
    ws = await wsOpen(`ws://127.0.0.1:${listener.port}`);
    a = new RpcClient(ws);
    const init = await a.call("initialize", { clientInfo: { name: "m5-acceptance" }, watchThreads: true });
    expect(init.userAgent).toBe("cc-harness-appserver");
    // The SECOND client. `thread/archived`/`thread/unarchived` are server-scoped fan-out to connections
    // that opted in with `watchThreads: true` (fanout.ts), so this is what "observed on a second
    // subscribed client" means on this wire — and asserting them HERE rather than on the driver is what
    // makes them a broadcast rather than a reply the caller happened to see.
    wsB = await wsOpen(`ws://127.0.0.1:${listener.port}`);
    b = new RpcClient(wsB);
    expect((await b.call("initialize", { clientInfo: { name: "m5-acceptance-watcher" }, watchThreads: true })).userAgent).toBe("cc-harness-appserver");
  }, 120_000);

  afterAll(async () => {
    try {
      for (const id of [...held]) { try { await a?.call("thread/close", { threadId: id }, 60_000); } catch { /* already closed */ } }
      // The one thing this run leaves in a REAL store: the session it created under `work`. Removed here
      // rather than left as litter in the operator's `~/.claude/projects`.
      if (sessionM) { try { await a?.call("thread/delete", { threadId: sessionM }, 60_000); } catch { /* best-effort */ } }
      try { await server?.shutdown(); } catch { /* best-effort */ }
      ws?.close(); wsB?.close();
      try { await listener?.close(); } catch { /* best-effort */ }
    } finally {
      if (root) rmSync(root, { recursive: true, force: true });
    }
  }, 180_000);

  it("LEG 1 — the config chain live: deep merge, leaf origins, CAS tokens, a stale-token conflict, a masked write", async () => {
    // Acceptance 1/2/4, and the whole leg runs against TEMP files: no engine, no network, no key needed
    // beyond the gate above. Planted exactly as the spec's acceptance 1 words it — allow in user, deny in
    // local — because upstream deep-merges and a single-winner attribution would be untruthful here.
    writeFileSync(userFile, JSON.stringify({ model: "opus", permissions: { allow: ["WebFetch"] } }));
    writeFileSync(localFile, JSON.stringify({ model: "sonnet", permissions: { deny: ["Bash"] } }));

    const read = await a.call("config/read", { cwd: proj, includeLayers: true }, 60_000);
    // THE DEEP MERGE: both survive, from two different files, under one key.
    expect(read.config.permissions, "the chain did not deep-merge — one layer's permissions replaced the other's").toEqual({ allow: ["WebFetch"], deny: ["Bash"] });
    expect(read.config.model, "local must win the scalar").toBe("sonnet");
    // PER-LEAF ORIGINS: an array leaf names every contributing layer, a scalar names its winner.
    expect(read.origins["permissions.allow"]).toEqual(["user"]);
    expect(read.origins["permissions.deny"]).toEqual(["local"]);
    expect(read.origins["model"]).toBe("local");
    expect(read.incomplete, "the file-backed view must declare itself incomplete (non-file policy sources)").toBe(true);
    // THE VERSION TOKENS — and this is also the redirection proof. Each token is compared against the
    // sha256 of THAT file's own bytes: a reply computed from the operator's real ~/.claude/settings.json
    // satisfies neither, and a `typeof === "string"` check would satisfy both.
    expect(read.versions.user, "versions.user is not the sha256 of the TEMP user settings file's bytes").toBe(sha256(readFileSync(userFile, "utf8")));
    expect(read.versions.local, "versions.local is not the sha256 of the TEMP local settings file's bytes").toBe(sha256(readFileSync(localFile, "utf8")));
    expect(read.versions.user).not.toBe(read.versions.local);
    expect(read.versions.project, "a file that does not exist is the one token that is not a hash").toBe("absent");
    // The raw per-layer contents, and every path in them under the temp root.
    expect(read.layers.map((l: any) => l.name).sort()).toEqual(["local", "user"]);
    for (const l of read.layers) { reportedPaths.push(String(l.filePath)); expect(l.disabledReason, `layer ${l.name} could not be read: ${l.disabledReason}`).toBeUndefined(); }
    expect(read.layers.find((l: any) => l.name === "user").filePath).toBe(realpathSync(userFile));
    expect(read.layers.find((l: any) => l.name === "local").filePath).toBe(realpathSync(localFile));

    // ── THE CAS PAIR: fresh, then stale. Sequential rather than concurrent on purpose — the outcome is
    // then decided by the token alone, so a failure names the CAS and not a scheduling accident. No `cwd`
    // here, so project/local are not in view and the write is unmasked by construction.
    const fresh = await a.call("config/value/write", { keyPath: ["model"], value: "haiku", mergeStrategy: "replace", target: "user", expectedVersion: read.versions.user }, 60_000);
    reportedPaths.push(String(fresh.filePath));
    expect(fresh.status, `the fresh-token write did not land: ${JSON.stringify(fresh)}`).toBe("ok");
    expect(fresh.filePath, "the write did not report the canonical TEMP user settings path").toBe(realpathSync(userFile));
    expect(fresh.version).toBe(sha256(readFileSync(userFile, "utf8")));
    // Landed in the bytes, and the sibling it never mentioned survived (acceptance 3's preservation rule).
    expect(JSON.parse(readFileSync(userFile, "utf8"))).toEqual({ model: "haiku", permissions: { allow: ["WebFetch"] } });

    const stale = await rpcError("the second write carrying the now-stale token", a.call("config/value/write",
      { keyPath: ["model"], value: "never-lands", mergeStrategy: "replace", target: "user", expectedVersion: read.versions.user }, 60_000));
    expect(stale.code).toBe(ERR.INVALID_PARAMS);
    expect(stale.data?.code, `the conflict is not named on error.data.code: ${JSON.stringify(stale.data)}`).toBe("ConfigVersionConflict");
    // The loser wrote NOTHING — a conflict that still mutated the file would be worse than no CAS at all.
    expect(JSON.parse(readFileSync(userFile, "utf8")).model, "the losing writer's value reached the file").toBe("haiku");

    // ── THE MASKED WRITE. Same target, same key, but with `cwd` so the local layer is in view: local
    // already defines `model`, so the write lands and says so.
    const masked = await a.call("config/value/write", { keyPath: ["model"], value: "opus", mergeStrategy: "replace", target: "user", cwd: proj }, 60_000);
    reportedPaths.push(String(masked.filePath));
    expect(masked.status).toBe("okOverridden");
    expect(masked.overriddenMetadata.overridingLayer, "the mask must name the EFFECTIVE layer, not the first one found").toBe("local");
    expect(masked.overriddenMetadata.effectiveValue, "effectiveValue must be the MERGED view's value, not one layer's private copy").toBe("sonnet");
    expect(masked.maskedEditIndexes).toEqual([0]);
    expect(JSON.parse(readFileSync(userFile, "utf8")).model, "okOverridden does not mean the write was refused — it landed").toBe("opus");
    // …and the two methods AGREE about who is in force (D-M5-13b's rule: assert the agreement, never a
    // transcript of one side). This is the assertion that cannot pass while the write reply lies.
    const after = await a.call("config/read", { cwd: proj }, 60_000);
    expect(after.config.model).toBe("sonnet");
    expect(after.origins["model"], "the write reported local as overriding while the read attributes the key elsewhere").toBe("local");
    expect(after.versions.user).toBe(masked.version);
  }, 120_000);

  it("LEG 5a — a real engine's init frame reaches thread/capabilities/read as terminalSlashCommands", async () => {
    // The thread every later leg reads. Two marker turns: the FIRST plants MARKER (transcript + the
    // store's metadata corpus), the SECOND plants MARKER2 in a later row only, which is what makes LEG 2
    // a claim about the transcript rather than about a title.
    threadM = await startThread(HAIKU);
    expect((await a.call("thread/subscribe", { threadId: threadM }, 30_000)).subscribed).toBe(true);
    await runTurn(threadM, `Reply with exactly this token and nothing else: ${MARKER}`, "marker turn 1");
    await runTurn(threadM, `Reply with exactly this token and nothing else: ${MARKER2}`, "marker turn 2");
    sessionM = String(server.registry.get(threadM)?.sessionId ?? "");
    expect(sessionM, "the engine never reported a session id — every cold-side leg addresses the thread by it").toMatch(/^[0-9a-f-]{8,}$/i);
    // The wire agrees about that identity (nothing later reads the registry).
    const listed = await a.call("thread/list", { cwd: work, limit: 100 }, 120_000);
    expect(listed.data.find((r: any) => r.id === threadM)?.sessionId, "thread/list disagrees with the record about this thread's session").toBe(sessionM);

    const caps = await a.call("thread/capabilities/read", { threadId: threadM }, 120_000);
    expect(Array.isArray(caps.capabilities?.commands), "the engine's own command catalog is missing").toBe(true);
    expect(caps.capabilities.commands.length, "the engine advertised no slash commands at all").toBeGreaterThan(0);
    // THE ABSORB SURFACE, end to end through this server's wire for the first time (Task 13 concern 4):
    // an init frame the engine emitted -> routeTerminalCommands -> the record -> this reply.
    expect(caps.terminalSlashCommands, "the key is absent, which on this contract means NO init frame ever reached the router").toBeDefined();
    expect(Array.isArray(caps.terminalSlashCommands)).toBe(true);
    for (const c of caps.terminalSlashCommands) expect(typeof c).toBe("string");
    expect(caps.terminalSlashCommands.length, "the engine reported no terminal-bound command — see LEG 6, which records what the init frame actually carried").toBeGreaterThan(0);
    // ENGINE-DEPENDENT: probe 112 measured `["doctor","color"]` on CLI 2.1.234's headless init frame.
    // `arrayContaining` rather than equality — a CLI that tags a THIRD command is not a regression in this
    // server, while losing these two would mean the classification stopped arriving.
    expect(caps.terminalSlashCommands, `ENGINE-DEPENDENT (probe 112 saw ["doctor","color"]): got ${JSON.stringify(caps.terminalSlashCommands)}`)
      .toEqual(expect.arrayContaining(["doctor", "color"]));
  }, 900_000);

  it("LEG 5b — a /context turn carries contextUsage on item/started AND item/completed", async () => {
    expect(threadM, "LEG 5a did not start a thread — this leg has nothing to run against").toBeTruthy();
    // The NEGATIVE control first, and it is the half that makes the key's absence mean something: the two
    // ordinary turns above emitted item events too, and not one of them may carry a twin.
    const before = a.notifications.filter((n) => (n.method === "item/started" || n.method === "item/completed") && n.params.threadId === threadM);
    expect(before.length, "the marker turns emitted no item events, so this control proves nothing").toBeGreaterThan(0);
    expect(before.filter((n) => n.params.contextUsage !== undefined).map((n) => n.method),
      "an ORDINARY turn carried a contextUsage twin — the field's absence is how a client tells the two apart").toEqual([]);

    const { mark, turnId } = await runTurn(threadM, "/context", "/context");
    // A short settle: the turn's last item notification and `turn/completed` are emitted from the same
    // read loop, and this keeps the read below off that ordering detail entirely (the M4 file's device).
    await sleep(1_000);
    const items = a.since(mark).filter((n) => (n.method === "item/started" || n.method === "item/completed") && n.params.threadId === threadM);
    expect(items.length, "the /context turn produced no item events at all").toBeGreaterThan(0);
    const carriers = items.filter((n) => n.params.contextUsage !== undefined);
    expect(carriers.length, `no item notification on the /context turn carried contextUsage: ${JSON.stringify(items.map((n) => n.method))}`).toBeGreaterThan(0);
    // BOTH kinds. A text block on a non-streamed assistant frame emits the started/completed PAIR
    // (items/mapper.ts's onAssistant) and the twin is stamped on every event that frame produced, so
    // seeing only one of the two would mean the stamp reached the mapper's output but not the wire.
    // "Non-streamed" is a property of this thread rather than an assumption: `includePartialMessages` is
    // opt-in in `resolveOptions` and nothing in `thread/start`'s config sets it, so the SDK emits no
    // `stream_event` here and the mapper's full-frame path is the one that runs. (A thread that DID enable
    // partials is the configuration Task 13 parked as unobserved — it is not this leg's subject.)
    expect([...new Set(carriers.map((n) => n.method))].sort(), "the twin did not ride BOTH item edges").toEqual(["item/completed", "item/started"]);
    for (const c of carriers) {
      expect(c.params.turnId, "a twin is not attributable to the turn that produced it").toBe(turnId);
      expect(c.params.item, "the twin replaced the item rather than riding beside it").toBeTruthy();
    }
    // ONE frame, ONE value: every carrier relays the same object, verbatim.
    const cu = carriers[0].params.contextUsage;
    for (const c of carriers) expect(c.params.contextUsage).toEqual(cu);
    // VALUES, not shape. `SDKContextUsage` (sdk.d.ts): a main-loop model name, an unclamped token total,
    // the window it is measured against, a percentage, and a per-category taxonomy — the semantic `kind`
    // classification is precisely what this twin adds over the free `thread/contextUsage/read` payload.
    expect(typeof cu.model).toBe("string");
    expect(String(cu.model).length).toBeGreaterThan(0);
    expect(cu.total_tokens, "an in-progress session cannot be using zero tokens").toBeGreaterThan(0);
    expect(cu.raw_max_tokens).toBeGreaterThan(0);
    expect(cu.percentage).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(cu.categories)).toBe(true);
    expect(cu.categories.length, "the structured card carried no category rows").toBeGreaterThan(0);
    for (const cat of cu.categories) {
      expect(["used", "free", "buffer", "deferred"], `unknown category kind ${JSON.stringify(cat.kind)}`).toContain(cat.kind);
      expect(typeof cat.tokens).toBe("number");
    }
    expect(cu.categories.some((c: any) => c.kind === "used"), "no category is classified as occupying the window").toBe(true);
  }, 900_000);

  it("LEG 6 — what a real engine actually sends: init recurs per turn, and the served list is the last frame's", async () => {
    // Task 13's absent-key contract rests on an SDK doc comment ("present only when non-empty; absent on
    // CLIs that predate the field, and on sessions where no advertised command carries the tag") and
    // nothing had watched a real engine emit or omit the key. This leg is where that is measured.
    expect(sessionM, "LEG 5a did not reach a session id — there are no frames to attribute").toBeTruthy();
    const inits = initFrames.filter((f) => f.session_id === sessionM);
    // Three turns ran above, and the route's whole design (last-frame-wins, self-healing) rests on init
    // being re-emitted per turn rather than once per process.
    expect(inits.length, `init was not re-emitted per turn: ${inits.length} frame(s) for ${sessionM}`).toBeGreaterThanOrEqual(3);
    const present = inits.map((f) => Object.prototype.hasOwnProperty.call(f, "terminal_slash_commands"));
    const last = inits[inits.length - 1];
    // THE RECORD. This is the one line this file prints, and it is the leg's deliverable: a keyed run's
    // output has to carry what the engine actually sent, not merely that an assertion passed.
    console.log(`[M5 LEG 6] session ${sessionM}: ${inits.length} system/init frames; terminal_slash_commands present on ${present.filter(Boolean).length}/${present.length}; last value = ${JSON.stringify(last.terminal_slash_commands ?? null)}`);

    // THE CONTRACT, checked against the engine's OWN BYTES, and written so it holds under BOTH engine
    // behaviours: a frame carrying the key is served verbatim, a frame omitting it is served as `[]`
    // (router.ts: omission is how the engine reports "none"). If a real engine ever sent `[]` instead of
    // omitting, this still holds — the route accepts both and means the same by them.
    const caps = await a.call("thread/capabilities/read", { threadId: threadM }, 120_000);
    expect(caps.terminalSlashCommands, "thread/capabilities/read does not serve what the LAST init frame carried").toEqual(last.terminal_slash_commands ?? []);
    // One session, one answer: an engine that carried the key on some frames and not others would make
    // "latest wins" observable as a flapping list, and the record above would be the place to see it.
    expect(present.every((p) => p === present[0]), `the engine changed its mind about the key mid-session: ${JSON.stringify(present)}`).toBe(true);

    // THE EMPTY CASE, and why it is not staged here rather than contrived. The two commands the engine
    // tags are `doctor` and `color` — CLI built-ins, not settings-, plugin- or skill-derived — and this
    // thread already runs with `settingSources: []`, which strips every settings-supplied command and
    // still leaves them tagged. No parameter this wire accepts removes a built-in command, so a key-less
    // init frame is not reachable from here; staging one would mean editing the engine, which measures
    // our fake rather than the CLI. What IS established: the shipped rule agrees with the engine's real
    // frames, and the branch the doc comment describes is pinned by absorb.test.ts's constructed rows.
    if (Object.prototype.hasOwnProperty.call(last, "terminal_slash_commands"))
      expect(Array.isArray(last.terminal_slash_commands) && last.terminal_slash_commands.length > 0,
        "the engine sent the key carrying an empty list — the SDK declares it present only when non-empty, so this contradicts the producer's own declaration (harmless for us: the route means the same by [] and by omission)").toBe(true);
  }, 300_000);

  it("LEG 3 — the jump: every readCursor, fed to thread/read UNCHANGED, lands a window holding the match", async () => {
    // Spec acceptance 6, and the cell a fake cannot fake: the cursor this server PUBLISHED is handed back
    // to the pager exactly as received — never reconstructed, never re-derived — and the window that
    // comes out must contain the hit.
    expect(threadM, "LEG 5a did not start a thread — this leg has nothing to search").toBeTruthy();
    const occ = await a.call("thread/searchOccurrences", { threadId: threadM, searchTerm: MARKER, limit: 50 }, 300_000);
    expect(occ.data.length, `the planted marker produced no occurrence on its own live thread: ${JSON.stringify(occ)}`).toBeGreaterThan(0);
    expect(occ.skipped, "a row was too large to search — this transcript is a handful of short rows").toBeUndefined();
    for (const o of occ.data) {
      // The published range indexes into THIS occurrence's own snippet and must describe the match itself.
      expect(o.snippet.slice(o.snippetMatchRange.start, o.snippetMatchRange.end).toLowerCase(),
        `snippetMatchRange does not describe the match: ${JSON.stringify(o)}`).toBe(MARKER.toLowerCase());
      expect(Number.isInteger(o.rowOffset) && o.rowOffset >= 0, `a bad rowOffset: ${JSON.stringify(o)}`).toBe(true);
      // Every row here is top-level (nothing in this run spawns a subagent) on a LIVE thread, so every
      // occurrence owes a jump. `null` would mean the pager cannot reach the row — the state a cold
      // session and a nested row earn, and neither is reachable in this leg.
      expect(o.readCursor, `a live top-level occurrence published no jump: ${JSON.stringify(o)}`).not.toBeNull();
      expect(typeof o.readCursor).toBe("string");
    }
    for (const o of occ.data) {
      const page = await a.call("thread/read", { threadId: threadM, cursor: o.readCursor, limit: 100 }, 120_000);
      expect(Array.isArray(page.data), `readCursor ${o.readCursor} was refused by thread/read`).toBe(true);
      expect(page.data.length, `readCursor ${o.readCursor} returned an empty window`).toBeGreaterThan(0);
      // The match is IN the window the server's own cursor selected. Asserted on the marker rather than on
      // the snippet because a snippet may hold newlines and quotes that JSON escapes, which would make the
      // comparison a fact about serialization rather than about the window.
      expect(JSON.stringify(page.data), `readCursor ${o.readCursor} landed a window that does not contain the match`).toContain(MARKER);
    }
  }, 600_000);

  it("LEG 4a — archiving a LIVE thread refuses BUSY, by either spelling of its id", async () => {
    expect(threadM && sessionM, "LEG 5a did not produce a live thread to refuse").toBeTruthy();
    const byThread = await rpcError("thread/archive on a live registry id", a.call("thread/archive", { threadId: threadM }, 60_000));
    expect(byThread.code).toBe(ERR.BUSY);
    expect(byThread.message, `the refusal does not tell the client what to do: ${JSON.stringify(byThread.message)}`).toContain("close it first");
    // The guard is on the SESSION, not on the spelling: a client that names the bare store id of a live
    // thread must meet the same refusal, or the shelf could be applied behind the registry's back.
    const bySession = await rpcError("thread/archive on the live thread's bare store id", a.call("thread/archive", { threadId: sessionM }, 60_000));
    expect(bySession.code).toBe(ERR.BUSY);
    expect(bySession.message).toBe(byThread.message);
    // A refusal is a refusal: no marker was minted behind either one.
    expect(existsSync(join(ccxDir, "archived", sessionM)), "a refused archive left a marker behind").toBe(false);
  }, 120_000);

  it("LEG 2 — the closed session is found by thread/search over the real store, with a snippet", async () => {
    expect(threadM && sessionM, "LEG 5a did not produce a session to close").toBeTruthy();
    const mark = a.mark();
    expect((await a.call("thread/close", { threadId: threadM }, 120_000)).ok).toBe(true);
    await a.waitFor("thread/closed", 60_000, (n) => n.method === "thread/closed" && n.params.threadId === threadM, mark);
    held.delete(threadM);

    // MARKER2 was planted in a LATER user row and appears in no metadata field the scan reads
    // (customTitle/summary/firstPrompt/tag all derive from the first prompt), so this hit is a claim about
    // the TRANSCRIPT having been opened and read — not about a title.
    const found = await a.call("thread/search", { searchTerm: MARKER2, cwd: work, limit: 20 }, 300_000);
    const hit = found.data.find((d: any) => d.thread?.sessionId === sessionM);
    expect(hit, `thread/search did not find the marker planted in this session's transcript: ${JSON.stringify(found)}`).toBeTruthy();
    expect(hit.snippet, "the hit came back without the match in its snippet").toContain(MARKER2);
    // A closed session renders as the store-only row — its `id` IS the store session id, since no
    // registry thread exists for it any more.
    expect(hit.thread.id, "a closed session did not render as the store-only row").toBe(sessionM);

    // …and the first marker, which the metadata corpus also carries, is found by the same call.
    const alsoFound = await a.call("thread/search", { searchTerm: MARKER, cwd: work, limit: 20 }, 300_000);
    expect(hasSession(alsoFound.data.map((d: any) => d.thread), sessionM), `the first marker was not found: ${JSON.stringify(alsoFound)}`).toBe(true);
  }, 900_000);

  it("LEG 4b — archive round-trip: hidden, revealed, broadcast to a second client, and resume unshelves it", async () => {
    // Spec acceptance 7 plus D-M5-21, over ONE session and both partitioned methods.
    expect(sessionM, "there is no closed session to shelve").toBeTruthy();
    const markB = b.mark();
    expect((await a.call("thread/archive", { threadId: sessionM }, 60_000)).ok).toBe(true);
    const archived = await b.waitFor("thread/archived on the SECOND client", 60_000,
      (n) => n.method === "thread/archived" && n.params.sessionId === sessionM, markB);
    expect(archived.params, "the broadcast payload is not {sessionId} (thread/delete's precedent)").toEqual({ sessionId: sessionM });
    // REDIRECTION, with its discriminator: archived-ness is a FILE, and it went to the injected state
    // directory rather than to the one the default (`fleetRoot()`) would have chosen.
    expect(existsSync(join(ccxDir, "archived", sessionM)), "no marker file appeared under the injected ccxDir").toBe(true);
    expect(existsSync(join(fleetRoot(), "archived", sessionM)), "the marker went to the DEFAULT state directory — deps.ccxDir was not honoured").toBe(false);

    // The partition, on BOTH methods the spec hands it to, in both directions.
    expect(hasSession((await a.call("thread/list", { cwd: work, limit: 100 }, 120_000)).data, sessionM), "an archived session is still in the default listing").toBe(false);
    expect(hasSession((await a.call("thread/list", { cwd: work, limit: 100, archived: true }, 120_000)).data, sessionM), "an archived session is absent from the archived listing — it is in neither half").toBe(true);
    const hiddenSearch = await a.call("thread/search", { searchTerm: MARKER2, cwd: work, limit: 20 }, 300_000);
    expect(hiddenSearch.data.some((d: any) => d.thread?.sessionId === sessionM), "thread/search still returns an archived session by default").toBe(false);
    const shownSearch = await a.call("thread/search", { searchTerm: MARKER2, cwd: work, limit: 20, archived: true }, 300_000);
    expect(shownSearch.data.some((d: any) => d.thread?.sessionId === sessionM), "thread/search {archived:true} does not return it either — it is in neither half").toBe(true);

    // D-M5-21: ADMISSION UNSHELVES. Opening a conversation takes it off the shelf, which is the rule that
    // keeps "a live thread is never hidden from the default list" true across servers as well as within one.
    const markB2 = b.mark();
    const resumed = await a.call("thread/resume", {
      sessionId: sessionM,
      config: { cwd: work, model: HAIKU, settingSources: [], permissionMode: "bypassPermissions" },
      unattended: "park",
    }, 180_000);
    const resumedId = String(resumed.thread.id);
    held.add(resumedId);
    expect(resumed.thread.sessionId, "a non-forking resume must report the session it admitted").toBe(sessionM);
    const unarchived = await b.waitFor("thread/unarchived on the SECOND client", 60_000,
      (n) => n.method === "thread/unarchived" && n.params.sessionId === sessionM, markB2);
    expect(unarchived.params).toEqual({ sessionId: sessionM });
    expect(existsSync(join(ccxDir, "archived", sessionM)), "the marker survived an admission — the session is archived AND live").toBe(false);
    expect(hasSession((await a.call("thread/list", { cwd: work, limit: 100 }, 120_000)).data, sessionM), "the resumed thread is still hidden from the default listing").toBe(true);
    expect(hasSession((await a.call("thread/list", { cwd: work, limit: 100, archived: true }, 120_000)).data, sessionM), "the resumed thread is still in the archived half").toBe(false);
    // Idempotent both ways: unarchiving something already off the shelf still answers ok.
    expect((await a.call("thread/unarchive", { threadId: sessionM }, 60_000)).ok).toBe(true);
  }, 900_000);

  it("SAFETY — the operator's own ~/.claude never entered this run", async () => {
    // The negative half of the redirection assertions above, and the one that would catch a fallback no
    // positive check can see: if any config path had resolved to the real settings chain, these bytes
    // would have moved.
    expect(snap(realUserSettings), `${realUserSettings} changed during this run — a config write fell back to the operator's real settings chain`).toBe(realUserBefore);
    expect(snap(realLocalSettings), `${realLocalSettings} changed during this run — a config write fell back to the operator's real settings chain`).toBe(realLocalBefore);
    // Every file the server named back to us lives under the temp root — checked over the whole run
    // rather than at each site, so a path that drifted mid-run is caught even if its own leg passed.
    expect(reportedPaths.length, "no config filePath was collected, so this check proves nothing").toBeGreaterThan(0);
    for (const p of reportedPaths) expect(p.startsWith(`${root}/`), `the server named a config file OUTSIDE the temp root: ${p}`).toBe(true);
  }, 60_000);
});
