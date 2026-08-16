// test/live/appserver-m4-acceptance.test.ts — M4 Task 10: the spec's `## Acceptance (behavior, not
// implementation)` section executed as written, in ONE keyed run against a REAL engine. Seven items, seven
// legs, in the spec's own numbering (the `it` titles carry the LEG n tag so a failure names the acceptance
// item it broke, not just a step).
//
// Shape and discipline are `appserver-m3-acceptance.test.ts`'s, deliberately: ONE describe, sequential
// `it`s sharing state over ONE app server and ONE WS client, each with its own generous timeout. The
// sequence is stateful — a verdict cannot be asserted on a review nobody started — and independent servers
// per `it` would multiply the keyed cost for nothing. Cheap deterministic legs run FIRST (5, 6) so a broken
// build fails in seconds rather than after four model turns.
//
// NO `dist/` STALENESS GUARD, and that is a considered departure from the M3 file rather than an omission.
// M3's fleet half re-enters the BUILT binary (`spawnDetached`), so a stale `dist/` there fails the run for
// reasons that have nothing to do with the app server. Nothing in M4 touches `dist/`: the server runs
// in-process from `src/`, every thread is inProcess, the engine is the SDK's own bundled `claude`, and the
// MCP fixture is executed from TypeScript through `tsx`. The generated artifact this file DOES read — the
// vendored JSON Schema — gets the equivalent guard where it belongs, inside leg 6, by regenerating it in
// memory and comparing (`buildArtifacts`).
//
// WHICH ASSERTIONS COULD FAIL FOR MODEL REASONS. Legs 1-3 depend on a model choosing to call
// `ReportFindings` and on it noticing a planted defect, so they cannot be made purely deterministic. The
// split this file makes, and marks at each site with a `MODEL-DEPENDENT` tag:
//   · CONTRACT assertions (the majority) test OUR code — a findings payload is well formed, anchored to a
//     file that exists, published on BOTH channels, scoped to the turn, and, for leg 3, that the prompt
//     names the merge-base range this test computed itself with git. Those fail only if we broke something.
//   · MODEL-DEPENDENT assertions test that the review found the thing that is actually wrong. They are the
//     point of legs 2 and 3 and are kept — a leg that only checked well-formedness would pass against a
//     review that reported nothing about the defect — but each is tagged, so a future failure is read
//     against the model that produced it before anyone goes looking for a regression.
// The planted defects are deliberately blatant (a `<=` bound over an array, a `split("=")` whose second
// half is read unguarded) precisely so the model-dependent half is as close to a sure thing as a live model
// gets.
//
// Cost/keying: SONNET for the three legs whose subject is review QUALITY (1-3) and for the elicitation leg
// (the model has to find an MCP tool through ToolSearch — probe 43b's proven path), HAIKU for leg 4, whose
// subject is the fallback and not the review. Every review runs `permissionMode: "bypassPermissions"` with
// `settingSources: []`: the broker is M2/M3's subject, not this file's, and a review that parked on every
// `git` call would stall behind a decision no leg here is about. Each leg still asserts that NOTHING parked
// on its review thread, so "unattended" stays a checked claim rather than an assumption.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket from "ws";
import { AppServer } from "../../src/appserver/server.js";
import { listenWs } from "../../src/appserver/transport/ws.js";
import { ERR } from "../../src/appserver/rpc.js";
import { buildArtifacts } from "../../src/appserver/schema/emit.js";
import { READONLY_DISALLOW } from "../../src/config/agents.js";
import type { ReviewFinding } from "../../src/appserver/reviewFindings.js";

const live = (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN) ? describe : describe.skip;

const SONNET = "claude-sonnet-4-6";
const HAIKU = "claude-haiku-4-5-20251001";
/** The answer the elicitation leg sends, and the string that must come back out of the MCP server's own
 *  tool result. Distinctive enough that finding it anywhere else in a transcript is impossible. */
const ELICIT_ANSWER = "m4-acceptance-peregrine";
const HERE = dirname(fileURLToPath(import.meta.url));
const CC_TO_SDK = join(HERE, "..", "..", "..");
const TSX = join(HERE, "..", "..", "node_modules", ".bin", "tsx");
const ELICIT_SERVER = join(HERE, "fixtures", "elicit-stdio-server.ts");

const sleep = (ms: number): Promise<void> => delay(ms);

// ---------------------------------------------------------------------------------------------------
// The subjects. Two scratch repos, each planting a defect blatant enough that "the reviewer missed it" is
// a real signal about the model rather than ordinary variance.
// ---------------------------------------------------------------------------------------------------

/** repo1 @ HEAD — correct. */
const CHECKOUT_OK = `// checkout.js — order totals for the storefront.
export function sumLineItems(items) {
  let total = 0;
  for (let i = 0; i < items.length; i++) {
    total += items[i].price * items[i].quantity;
  }
  return total;
}
`;
/** repo1 working tree — THE PLANTED OFF-BY-ONE (leg 2). One character, one line of diff: the loop runs one
 *  index past the end, so `items[items.length]` is `undefined` and reading `.price` off it throws a
 *  TypeError for EVERY non-empty input. Uncommitted on purpose — that is what `uncommittedChanges` means. */
const CHECKOUT_DEFECTIVE = CHECKOUT_OK.replace("i < items.length", "i <= items.length");

/** repo2 @ the merge-base, and still what `work` has — a pre-existing defect (`[0]` off an array that is
 *  empty whenever every result is ok). NOT part of the range under review. */
const BASE_DEFECTIVE = `// base.js — report why a run failed.
export function firstFailureReason(results) {
  return results.filter((r) => !r.ok)[0].reason;
}
`;
/** repo2 @ main's tip — the SAME file, fixed, on the base branch only. This is the file leg 3 asserts
 *  produces no finding: under a correct merge-base range it was never touched, while a diff against main's
 *  TIP would show it as reverting the fix, i.e. INTRODUCING the defect, which a reviewer would report. */
const BASE_FIXED = `// base.js — report why a run failed.
export function firstFailureReason(results) {
  const failed = results.filter((r) => !r.ok);
  return failed.length ? failed[0].reason : undefined;
}
`;
/** repo2 @ the `work` branch — the defect that IS in the range: a line without "=" splits to a one-element
 *  array, so `value` is undefined and `.trim()` throws. */
const PARSER_DEFECTIVE = `// parser.js — parse "key=value" configuration lines.
export function parseConfig(lines) {
  const out = {};
  for (const line of lines) {
    const [key, value] = line.split("=");
    out[key.trim()] = value.trim();
  }
  return out;
}
`;

/** Git with an identity and no signing, so the run does not depend on the developer's own global config.
 *  Throws on a non-zero exit, which is what we want for scaffolding — a repo that did not build is not a
 *  test failure to interpret, it is a setup failure to see. stderr is CAPTURED rather than inherited: git
 *  narrates ordinary branch switches on stderr (localized, at that), and a live suite's output should carry
 *  assertions and nothing else — a real failure still arrives, inside the thrown error. */
function git(repo: string, args: string[]): string {
  return execFileSync("git", ["-c", "user.name=M4 Acceptance", "-c", "user.email=m4@example.invalid", "-c", "commit.gpgsign=false", ...args],
    { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** repo1: one commit, then the planted off-by-one left UNCOMMITTED in the working tree. */
function buildDirtyRepo(dir: string): void {
  mkdirSync(dir, { recursive: true });
  git(dir, ["init", "-b", "main"]);
  writeFileSync(join(dir, "README.md"), "# m4 acceptance subject\n");
  writeFileSync(join(dir, "checkout.js"), CHECKOUT_OK);
  git(dir, ["add", "."]);
  git(dir, ["commit", "-m", "initial"]);
  writeFileSync(join(dir, "checkout.js"), CHECKOUT_DEFECTIVE);
}

/** repo2, laid out so a merge-base range and a tip diff disagree about ONE file:
 *
 *    main:  c1 (base.js defective) ─── c3 (base.js FIXED)
 *                 └── work: c2 (parser.js, defective)     ← HEAD
 *
 *  merge-base(main, HEAD) = c1, so the range `c1..HEAD` contains c2 alone → parser.js.
 *  `main..HEAD` (the WRONG diff) contains base.js too, as the fix being undone. */
function buildBranchRepo(dir: string): { mergeBase: string; mainTip: string } {
  mkdirSync(dir, { recursive: true });
  git(dir, ["init", "-b", "main"]);
  writeFileSync(join(dir, "README.md"), "# m4 acceptance base-branch subject\n");
  writeFileSync(join(dir, "base.js"), BASE_DEFECTIVE);
  git(dir, ["add", "."]);
  git(dir, ["commit", "-m", "initial"]);
  const mergeBase = git(dir, ["rev-parse", "HEAD"]);
  git(dir, ["checkout", "-b", "work"]);
  writeFileSync(join(dir, "parser.js"), PARSER_DEFECTIVE);
  git(dir, ["add", "."]);
  git(dir, ["commit", "-m", "add the config parser"]);
  git(dir, ["checkout", "main"]);
  writeFileSync(join(dir, "base.js"), BASE_FIXED);
  git(dir, ["commit", "-am", "guard firstFailureReason against an all-ok run"]);
  const mainTip = git(dir, ["rev-parse", "HEAD"]);
  git(dir, ["checkout", "work"]);
  return { mergeBase, mainTip };
}

// ---------------------------------------------------------------------------------------------------
// The wire client — the same minimal WS JSON-RPC "lite" client the M1/M2/M3 live files use (spec §4: no
// jsonrpc field), mirrored rather than imported because none of them exports it.
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
  /** Index of the next notification to arrive — hand it to `waitFor` to scope a wait to one leg. */
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

// ---------------------------------------------------------------------------------------------------
// Review-side readers. `review/findings` and the `review` item carry the SAME verdict (review.ts's
// `publish`), so every leg reads both and asserts they agree — a client on either channel alone must see
// the review.
// ---------------------------------------------------------------------------------------------------

interface Verdict { threadId: string; turnId: string; findings: ReviewFinding[]; unstructured: boolean; level?: string; prose?: string; aborted?: true }

/** One completed review: everything the wire said about it, gathered once so each leg reads, not waits. */
interface ReviewRun {
  reviewThreadId: string;
  turnId: string;
  verdicts: Verdict[];
  items: Array<Verdict & { type: "review"; id: string }>;
  /** The generated review prompt, read back off the turn's own userMessage item — the only place a test
   *  can see what the host actually told the model (leg 3's merge-base evidence). */
  prompt: string;
  turnStatus: string;
  /** Every finding the run published, in publication order. */
  findings: ReviewFinding[];
}

live("M4 acceptance: the review domain and MCP elicitation, live", () => {
  let root = "";
  let dirtyRepo = "";        // legs 1, 2, 4
  let branchRepo = "";       // leg 3
  let branchShas: { mergeBase: string; mainTip: string };
  let server: AppServer;
  let listener: { port: number; close(): Promise<void> };
  let ws: WebSocket;
  let a: RpcClient;
  let dirtyThreadId = "";    // the TARGET thread rooted at the dirty repo (legs 1, 2, 5)
  let branchThreadId = "";   // the TARGET thread rooted at the base-branch repo (leg 3)
  let mutedThreadId = "";    // the TARGET thread that DENIES ReportFindings (leg 4)
  let uncommitted: ReviewRun;  // legs 1 and 2 share one review — leg 1 checks the envelope, leg 2 the defect
  const held = new Set<string>();

  /** A target thread. Never prompted: `review/start` needs exactly ONE thing from its target — the cwd —
   *  and never touches its engine, so a target costs a session and no tokens. `settingSources: []` is
   *  load-bearing exactly as in the M1/M2/M3 acceptances (a developer's own `~/.claude/settings.json` would
   *  change the permissions and the tool set the review inherits); `bypassPermissions` is the file-level
   *  choice explained in the header, and it is INHERITED by the review thread, which is the point. */
  async function startTarget(cwd: string, model: string, extra: Record<string, unknown> = {}): Promise<string> {
    const started = await a.call("thread/start", {
      config: { cwd, model, settingSources: [], permissionMode: "bypassPermissions", maxTurns: 30, ...extra },
      unattended: "park",
    }, 120_000);
    const id = started.thread.id;
    held.add(id);
    return id;
  }

  /** Start a review and follow it to its end, gathering both channels.
   *
   *  SUBSCRIBED OFF `thread/started`, NOT off the reply. `review/findings` is a broadcast to the review
   *  thread's SUBSCRIBERS (server.ts's `broadcast`) and is live-only, so a client that learns the thread id
   *  from the reply has a window in which a verdict can be published to nobody. `review.ts` announces the
   *  thread BEFORE it starts the turn, so waiting on that announcement closes the window structurally
   *  rather than by being fast. (Items would survive the gap anyway — they ride the per-turn replay buffer
   *  — which is exactly why both channels are read below.) */
  async function runReview(targetThreadId: string, target: Record<string, unknown>, label: string, timeoutMs: number): Promise<ReviewRun> {
    const mark = a.mark();
    const started = a.call("review/start", { threadId: targetThreadId, target }, 120_000);
    const announced = await a.waitFor(`thread/started (${label}'s review thread)`, 120_000,
      (n) => n.method === "thread/started" && n.params.thread?.reviewOf === targetThreadId, mark);
    const reviewThreadId = String(announced.params.thread.id);
    held.add(reviewThreadId);
    expect((await a.call("thread/subscribe", { threadId: reviewThreadId }, 30_000)).subscribed).toBe(true);
    const reply = await started;
    expect(reply.reviewThreadId, `${label}: review/start did not name the thread it announced`).toBe(reviewThreadId);
    expect(reply.turn?.status).toBe("inProgress");
    const turnId = String(reply.turn.id);

    const done = await a.waitFor(`turn/completed (${label})`, timeoutMs,
      (n) => n.method === "turn/completed" && n.params.threadId === reviewThreadId && n.params.turn?.id === turnId, mark);
    // A short settle: `review/findings` for a reporting turn fires ahead of `turn/completed` (the read loop
    // hands every frame to its callbacks before it resolves the turn's waiter), but the unstructured
    // fallback is published from the SAME callback as the end frame, and this keeps the read below off that
    // ordering detail entirely.
    await sleep(1_000);
    const seen = a.since(mark);
    const verdicts = seen.filter((n) => n.method === "review/findings" && n.params.threadId === reviewThreadId).map((n) => n.params as Verdict);
    const items = seen.filter((n) => n.method === "item/completed" && n.params.threadId === reviewThreadId && n.params.item?.type === "review")
      .map((n) => n.params.item as Verdict & { type: "review"; id: string });
    const user = seen.find((n) => n.method === "item/completed" && n.params.threadId === reviewThreadId && n.params.item?.type === "userMessage");
    expect(user, `${label}: the review turn echoed no userMessage item, so the generated prompt is unreadable`).toBeTruthy();

    // NOTHING PARKED — the unattended claim, checked rather than assumed (see the file header).
    const parked = seen.filter((n) => n.method === "decision/requested" && n.params.threadId === reviewThreadId);
    expect(parked.map((n) => n.params.decision?.toolName),
      `${label}: the review parked a decision — this file's reviews are configured to run unattended, so a park means the config did not take`).toEqual([]);

    return {
      reviewThreadId, turnId, verdicts, items,
      prompt: String(user!.params.item.text ?? ""),
      turnStatus: String(done.params.turn.status),
      findings: verdicts.flatMap((v) => v.findings),
    };
  }

  /** OUR contract, applied to every review this file runs: the two channels agree, the additive rule holds,
   *  and every finding that arrived is well formed and anchored to a file that is really there. Nothing
   *  here depends on WHAT the model found — only on the shape of what it published. */
  function expectWellFormed(run: ReviewRun, repo: string, label: string): void {
    expect(run.turnStatus, `${label}: the review turn did not complete cleanly`).toBe("completed");
    // Both channels carry the same verdicts, in the same order (review.ts publishes to both from one call).
    expect(run.items.map(({ type: _t, id: _i, ...rest }) => rest), `${label}: the review item stream and the review/findings notifications disagree`)
      .toEqual(run.verdicts.map(({ threadId: _tid, turnId: _turn, ...rest }) => rest));
    for (const item of run.items) expect(item.id, `${label}: a review item is not stamped with its own turn`).toBe(`review_${run.turnId}_${run.items.indexOf(item) + 1}`);
    expect(run.verdicts.length, `${label}: the review published no verdict at all on either channel`).toBeGreaterThan(0);
    // The additive rule (D-M4-7): a client APPENDS. The unstructured fallback fires only when literally
    // nothing reported, so a run can never carry both kinds.
    const unstructured = run.verdicts.filter((v) => v.unstructured);
    if (run.verdicts.some((v) => !v.unstructured))
      expect(unstructured, `${label}: a review that reported findings ALSO published the unstructured fallback`).toEqual([]);
    else expect(unstructured.length, `${label}: more than one unstructured fallback for one turn`).toBe(1);
    for (const v of run.verdicts) {
      expect(v.turnId, `${label}: a verdict is not stamped with the turn review/start began`).toBe(run.turnId);
      expect(v.aborted, `${label}: a completed review was tagged aborted`).toBeUndefined();
    }
    for (const f of run.findings) {
      expect(typeof f.file, `${label}: a finding carries no file: ${JSON.stringify(f)}`).toBe("string");
      expect(f.file.length).toBeGreaterThan(0);
      expect(String(f.summary).length, `${label}: a finding carries no summary: ${JSON.stringify(f)}`).toBeGreaterThan(0);
      expect(String(f.failure_scenario).length, `${label}: a finding carries no failure_scenario: ${JSON.stringify(f)}`).toBeGreaterThan(0);
      if (f.line !== undefined) { expect(Number.isInteger(f.line)).toBe(true); expect(f.line).toBeGreaterThan(0); }
      // Acceptance 1's own words — "a `file` that exists in that repo". Repo-relative is what the prompt
      // asks for; an absolute path is accepted too, since it names the same file.
      const path = isAbsolute(f.file) ? f.file : join(repo, f.file);
      expect(existsSync(path), `${label}: a finding is anchored to a path that does not exist: ${f.file}`).toBe(true);
    }
  }

  /** Findings whose file is this basename, however the model spelled the path. */
  const about = (run: ReviewRun, basename: string): ReviewFinding[] => run.findings.filter((f) => f.file.split("/").pop() === basename);

  beforeAll(async () => {
    // `realpathSync`: on macOS `tmpdir()` is a symlink (/var -> /private/var), and these paths are compared
    // against what the model reports and against the thread's own cwd.
    root = realpathSync(mkdtempSync(join(tmpdir(), "cc-appserver-m4-")));
    dirtyRepo = join(root, "dirty");
    branchRepo = join(root, "branch");
    buildDirtyRepo(dirtyRepo);
    branchShas = buildBranchRepo(branchRepo);
    // The scaffolding's own premise: a merge-base that equals main's tip would make leg 3 vacuous.
    expect(branchShas.mergeBase, "the base-branch repo did not diverge — leg 3 would prove nothing").not.toBe(branchShas.mainTip);

    server = new AppServer({}); // no token: this run exercises the review domain, not auth (wsTransport.test.ts owns that)
    listener = await listenWs(server, {});
    ws = await wsOpen(`ws://127.0.0.1:${listener.port}`);
    a = new RpcClient(ws);
    const init = await a.call("initialize", { clientInfo: { name: "m4-acceptance" }, watchThreads: true });
    expect(init.userAgent).toBe("cc-harness-appserver");

    dirtyThreadId = await startTarget(dirtyRepo, SONNET);
    branchThreadId = await startTarget(branchRepo, SONNET);
    // Leg 4's target. Denying the tool is the ONE deterministic way to produce "a review that ends without
    // a `ReportFindings` call": the prompt's reporting contract is deliberately hardened against being
    // talked out of the call (reviewPrompt.ts), so asking the model not to call it is the wrong lever.
    // `disallowedTools` binds at session-build time — the tool never reaches the advertised list (probe
    // 110) — and `reviewConfig` MERGES the target's list with the read-only set rather than replacing it,
    // which is what makes this inheritable at all.
    mutedThreadId = await startTarget(dirtyRepo, HAIKU, { disallowedTools: ["ReportFindings"] });
  }, 300_000);

  afterAll(async () => {
    try {
      for (const id of [...held]) { try { await a?.call("thread/close", { threadId: id }, 30_000); } catch { /* already closed */ } }
      try { await server?.shutdown(); } catch { /* best-effort */ }
      ws?.close();
      try { await listener?.close(); } catch { /* best-effort */ }
    } finally {
      if (root) rmSync(root, { recursive: true, force: true });
    }
  }, 180_000);

  it("LEG 5 — delivery:\"inline\" is refused with a message naming detached", async () => {
    const refused = await rpcError("review/start with delivery:inline", a.call("review/start", { threadId: dirtyThreadId, target: { type: "uncommittedChanges" }, delivery: "inline" }, 30_000));
    expect(refused.code).toBe(ERR.INVALID_PARAMS);
    // "specific, actionable, naming detached as the supported path" (acceptance 5, D-M4-2) — a generic
    // schema rejection would leave a client unable to tell a typo from a deferral.
    expect(refused.message, `the inline refusal is not actionable: ${JSON.stringify(refused.message)}`).toContain("inline");
    expect(refused.message).toContain("detached");
    expect(refused.message).toContain("reviewThreadId");
    // …and the refusal is a refusal, not a silent degrade: no review thread was raised behind it.
    expect(a.notifications.filter((n) => n.method === "thread/started" && n.params.thread?.reviewOf === dirtyThreadId),
      "delivery:inline was refused AND started a review anyway").toEqual([]);
  }, 60_000);

  it("LEG 6 — the drift gate is green and the generated schema artifacts carry the review types", () => {
    // Exit code, not output text: the script's own note (Task 9's brief) is that its "Drift found" line
    // belongs to a separate SDK-version section and does not fail the gate. `--json` so the appserver
    // verdict is read structurally rather than scraped out of prose.
    const run = spawnSync("node", [join(CC_TO_SDK, "scripts", "drift-check.mjs"), "--json"], { cwd: CC_TO_SDK, encoding: "utf8", maxBuffer: 1 << 24 });
    expect(run.error, `drift-check.mjs could not be run: ${run.error?.message}`).toBeUndefined();
    expect(run.status, `drift-check.mjs exited ${run.status}\n${run.stderr}`).toBe(0);
    const report = JSON.parse(run.stdout) as { appserver: { missing: string[]; stale: string[]; unrowed: string[]; tally: { status: Record<string, number> } } };
    expect(report.appserver.missing, "a walked protocol token has no scorecard row").toEqual([]);
    expect(report.appserver.stale, "a scorecard row's status no longer matches the code").toEqual([]);
    expect(report.appserver.unrowed, "a registered method is named by no scorecard row").toEqual([]);
    // "with the new method rowed" — the review method and the review/findings notification.
    expect(report.appserver.tally.status["shipped(M4)"], `the scorecard rows no M4 work: ${JSON.stringify(report.appserver.tally.status)}`).toBeGreaterThanOrEqual(2);

    // "…and the generated JSON-Schema artifacts include the review types". Read from the VENDORED file,
    // then compared against a fresh generation — which is this file's staleness guard (see the header): an
    // artifact that no longer matches the registry it is derived from is exactly the stale-generated-file
    // failure M3's `dist/` check exists to prevent, one layer over.
    const vendored = JSON.parse(readFileSync(join(HERE, "..", "..", "schema", "json", "stable", "appserver.json"), "utf8")) as { methods: Record<string, any> };
    const fresh = buildArtifacts();
    expect(vendored, "the vendored stable schema artifact is stale — regenerate with `node scripts/emit-appserver-schema.mjs`").toEqual(fresh.stable);
    const method = vendored.methods["review/start"];
    expect(method, `review/start is absent from the published schema: ${Object.keys(vendored.methods).join(", ")}`).toBeTruthy();
    // Codex's four target variants, verbatim (D-M4-4) — the discriminated union survives generation.
    const variants = (method.properties.target.anyOf ?? method.properties.target.oneOf) as Array<{ properties: { type: { const?: string; enum?: string[] } } }>;
    expect(variants.map((v) => v.properties.type.const ?? v.properties.type.enum?.[0]).sort())
      .toEqual(["baseBranch", "commit", "custom", "uncommittedChanges"]);
    expect(method.properties.delivery.enum.sort()).toEqual(["detached", "inline"]);
  }, 120_000);

  it("LEG 1 — uncommittedChanges in a dirty repo: {turn, reviewThreadId}, then findings naming files that exist", async () => {
    uncommitted = await runReview(dirtyThreadId, { type: "uncommittedChanges" }, "uncommittedChanges", 900_000);
    expectWellFormed(uncommitted, dirtyRepo, "uncommittedChanges");
    // MODEL-DEPENDENT: that the reviewer called `ReportFindings` at all. Probe 109 proved the channel works
    // off a plain instruction and reviewPrompt.ts makes the call the stated deliverable, but no prompt can
    // compel it — a failure HERE (rather than in leg 2's anchoring) means the model answered in prose, and
    // the honest reading is a model-behavior regression, not a broken harvest. The fallback that covers
    // that case is leg 4's, and it is asserted deterministically there.
    expect(uncommitted.verdicts.some((v) => !v.unstructured),
      `the review published only the unstructured fallback — the model never called ReportFindings: ${JSON.stringify(uncommitted.verdicts)}`).toBe(true);
    expect(uncommitted.findings.length, "a structured verdict carried no findings at all").toBeGreaterThan(0);

    // THE DETACHED THREAD IS REALLY DETACHED, and really rooted at the target — the two facts `review/start`
    // owes beyond the reply, read off the record this test owns rather than inferred from behavior.
    const record: any = server.registry.get(uncommitted.reviewThreadId);
    expect(record, "the review thread vanished before it could be inspected").toBeTruthy();
    expect(record.reviewOf, "the review thread does not point back at its target").toBe(dirtyThreadId);
    expect(record.cwd, "the review did not run at the target thread's working directory").toBe(dirtyRepo);
    expect(record.config.resume, "the review inherited the target's session id — a detached review would have opened on the target's own transcript").toBeUndefined();
    // Read-only in POLICY (not only in the prompt), and merged rather than assigned.
    for (const tool of READONLY_DISALLOW) expect(record.config.disallowedTools, `the review thread can still call ${tool}`).toContain(tool);
    expect(uncommitted.reviewThreadId, "the review ran on the target thread instead of a new one").not.toBe(dirtyThreadId);
  }, 1_200_000);

  it("LEG 2 — the planted off-by-one is found, anchored to that file, with a concrete failure scenario", () => {
    // MODEL-DEPENDENT, and deliberately so: this leg's whole subject is that the review found the thing that
    // is actually wrong, which no amount of shape-checking can stand in for. The defect is a one-line
    // uncommitted diff turning `i < items.length` into `i <= items.length`, so that every non-empty input
    // throws a TypeError on `undefined.price` — about as unmissable as a planted defect gets. A failure here
    // with leg 1 green says the review ran and reported, but did not see it.
    expect(uncommitted, "leg 1 did not produce a review — this leg reads its findings and has nothing to read").toBeTruthy();
    const hits = about(uncommitted, "checkout.js");
    expect(hits.length, `no finding anchored to checkout.js — the planted off-by-one was not reported. All findings: ${JSON.stringify(uncommitted.findings, null, 1)}`).toBeGreaterThan(0);
    const anchored = hits.find((f) => f.line !== undefined) ?? hits[0];
    if (anchored.line !== undefined) {
      // A line inside the file, and inside the function that carries the defect — a finding anchored past
      // the end of the file would be structurally well formed and still unusable to a UI.
      const lines = readFileSync(join(dirtyRepo, "checkout.js"), "utf8").split("\n").length;
      expect(anchored.line, `the finding anchors to line ${anchored.line} of a ${lines}-line file`).toBeLessThanOrEqual(lines);
    }
    // "a `failure_scenario` naming concrete inputs" (acceptance 2). Two checks, because "concrete" is not
    // machine-decidable: the scenario must not merely restate the summary (the prompt says so outright),
    // and it must contain SOMETHING concrete — a number, a quoted/backticked token, or a name from the
    // subject. The net is wide on purpose; a scenario for this defect that mentions none of them would not
    // be a scenario.
    const concrete = hits.find((f) => f.failure_scenario !== f.summary && /\d|`|'|"|\bitems\b|\bsumLineItems\b|\bundefined\b|\bempty\b|\bTypeError\b|\blast\b/i.test(f.failure_scenario));
    expect(concrete, `no finding on checkout.js carries a concrete failure scenario: ${JSON.stringify(hits, null, 1)}`).toBeTruthy();
  }, 60_000);

  it("LEG 3 — baseBranch reviews the merge-base range: the prompt names it, and a base-only file yields no finding", async () => {
    const run = await runReview(branchThreadId, { type: "baseBranch", branch: "main" }, "baseBranch", 900_000);
    expectWellFormed(run, branchRepo, "baseBranch");

    // THE DETERMINISTIC HALF, and the one that actually distinguishes a merge-base from a diff against the
    // branch tip: the host resolved the range itself (reviewTarget.ts) and named it in the prompt, and the
    // sha it named is the merge-base this test computed independently with git — NOT main's tip.
    expect(run.prompt, `the review prompt does not name the merge-base range ${branchShas.mergeBase}..HEAD:\n${run.prompt}`)
      .toContain(`${branchShas.mergeBase}..HEAD`);
    expect(run.prompt, "the review prompt named main's TIP — the range is a tip diff, not a merge-base range").not.toContain(branchShas.mainTip);

    // THE BEHAVIORAL HALF (acceptance 3's own words). base.js was changed ONLY on the base branch, after the
    // merge-base, so it is not in the range — while under a tip diff it would appear as the fix being
    // undone, which is exactly the shape a reviewer reports. MODEL-DEPENDENT in one direction only: a
    // reviewer that wandered outside the range it was given could report base.js despite the prompt's "not
    // pre-existing ones it merely sits near". Nothing in the range references base.js, so it has no reason
    // to open it.
    expect(about(run, "base.js"), `the review reported a file changed only on the base branch — the range is not the merge-base range: ${JSON.stringify(about(run, "base.js"), null, 1)}`).toEqual([]);
    // MODEL-DEPENDENT: the positive control. Without it, a review that found NOTHING would satisfy the
    // assertion above for the wrong reason. parser.js is the only file in the range and its defect throws on
    // any line without an "=".
    expect(about(run, "parser.js").length, `the in-range file produced no finding, so the leg above proves nothing. All findings: ${JSON.stringify(run.findings, null, 1)}`).toBeGreaterThan(0);
  }, 1_200_000);

  it("LEG 4 — a review with no ReportFindings call yields findings: [] WITH unstructured: true and the prose retained", async () => {
    // DETERMINISTIC where it matters: the tool is denied at session-build time, so the model cannot call it
    // however the prompt is worded, and the fallback is the only path the turn can take. What remains
    // model-shaped is only that the reviewer SAYS something — the prose the fallback retains — which a model
    // asked to review a file and denied its reporting tool reliably does.
    const run = await runReview(mutedThreadId, { type: "uncommittedChanges" }, "no-ReportFindings", 900_000);
    expectWellFormed(run, dirtyRepo, "no-ReportFindings");
    expect(run.verdicts.length, `the fallback published more than one verdict: ${JSON.stringify(run.verdicts)}`).toBe(1);
    const verdict = run.verdicts[0];
    expect(verdict.findings, "the fallback invented findings").toEqual([]);
    // The three halves of "never a silent clean": the empty array, the flag that says why it is empty, and
    // what the reviewer actually said.
    expect(verdict.unstructured, `a review with no ReportFindings call reported findings:[] WITHOUT the unstructured flag — that is an authoritative all-clear nobody asserted: ${JSON.stringify(verdict)}`).toBe(true);
    expect(typeof verdict.prose, `the unstructured fallback dropped the reviewer's prose: ${JSON.stringify(verdict)}`).toBe("string");
    expect(String(verdict.prose).length, "the retained prose is empty").toBeGreaterThan(0);
    // And the same verdict reached the item channel — a client subscribed to items alone must not read an
    // unreported review as a review with nothing to say.
    expect(run.items.length).toBe(1);
    expect(run.items[0].unstructured).toBe(true);
    expect(run.items[0].prose).toBe(verdict.prose);
  }, 1_200_000);

  it("LEG 7 — an MCP elicitation parks as a decision, and the client's answer reaches the MCP server", async () => {
    // STDIO, not an in-process SDK-type server (spec acceptance 7, probe 43): the CLI's own MCP client is
    // the elicitation counterparty, and an SDK-type server answers "Client does not support form
    // elicitation". `bypassPermissions` so the ONLY thing that parks on this thread is the elicitation —
    // which the leg then asserts, rather than filtering for it.
    const threadId = await startTarget(root, SONNET, {
      mcpServers: { m4elicit: { type: "stdio", command: TSX, args: [ELICIT_SERVER] } },
    });
    expect((await a.call("thread/subscribe", { threadId }, 30_000)).subscribed).toBe(true);

    const mark = a.mark();
    const turn = await a.call("turn/start", { threadId, input: "Call the needsInput tool once (find it via ToolSearch if needed), then reply with exactly what it returned." }, 120_000);
    const turnId = String(turn.turn.id);

    const requested = await a.waitFor("decision/requested (the elicitation)", 600_000,
      (n) => n.method === "decision/requested" && n.params.threadId === threadId, mark);
    const entry = requested.params.decision;
    expect(entry.kind, `the park is not an elicitation: ${JSON.stringify(entry)}`).toBe("elicitation");
    expect(requested.params.turnId, "the elicitation park is not attributable to its turn").toBe(turnId);
    // No tool is involved in an elicitation, so the server NAME fills the slot a tool name usually would
    // (elicitation.ts) — that is what a dialog renders.
    expect(entry.toolName).toBe("m4elicit");
    expect(String(entry.toolUseId), `an elicitation park key must not collide with a real tool_use id: ${entry.toolUseId}`).toMatch(/^elicit:/);
    // The request itself travels in `input`, which is what a client fills a form from.
    expect(String(entry.input?.message)).toContain("codename");
    expect(entry.input?.requestedSchema?.properties?.codename?.type).toBe("string");
    // Exactly one park, and it is this one — the honesty check on `bypassPermissions`.
    const listed = await a.call("decision/list", { threadId }, 30_000);
    expect(listed.data.map((d: any) => [d.toolUseId, d.kind])).toEqual([[entry.toolUseId, "elicitation"]]);

    const answered = await a.call("decision/respond", { threadId, toolUseId: entry.toolUseId, answer: { kind: "elicitation_accept", content: { codename: ELICIT_ANSWER } } }, 60_000);
    expect(answered.ok).toBe(true);
    const resolved = await a.waitFor("decision/resolved (the elicitation)", 60_000,
      (n) => n.method === "decision/resolved" && n.params.toolUseId === entry.toolUseId, mark);
    expect(resolved.params.answer).toEqual({ kind: "elicitation_accept", content: { codename: ELICIT_ANSWER } });

    // THE PROOF THE ANSWER TRAVELLED INTO THE SERVER, and the reason this leg cannot be replaced by a unit
    // test: the accepted content comes back out in the MCP TOOL'S OWN RESULT. A park that merely settled
    // locally would leave the tool hanging or return without it.
    const called = await a.waitFor("the completed MCP tool call carrying the elicited answer", 600_000,
      (n) => n.method === "item/completed" && n.params.threadId === threadId && n.params.item?.type === "toolCall"
        && String(n.params.item.tool).includes("needsInput") && n.params.item.status !== "inProgress", mark);
    const item = called.params.item;
    expect(item.view, "an MCP tool call is not namespaced as one").toBe("mcp");
    expect(item.status, `the elicitation tool call failed: ${JSON.stringify(item)}`).toBe("completed");
    expect(String(item.result), `the elicited answer never reached the MCP server's own tool result: ${JSON.stringify(item.result)}`).toContain(ELICIT_ANSWER);
    expect(String(item.result), "the server reported something other than an accept").toContain("accept");

    const done = await a.waitFor("turn/completed (the elicitation turn)", 600_000,
      (n) => n.method === "turn/completed" && n.params.threadId === threadId && n.params.turn?.id === turnId, mark);
    expect(done.params.turn.status, `the elicitation turn did not complete: ${JSON.stringify(done.params.turn)}`).toBe("completed");
  }, 1_800_000);
});
