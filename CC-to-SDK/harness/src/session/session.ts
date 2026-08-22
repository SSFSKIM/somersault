import { randomUUID } from "node:crypto";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { AsyncQueue } from "../swarm/asyncQueue.js";
import type { QueryFn } from "../swarm/types.js";
import type { ControllableSession } from "../bridge/types.js";
import { withContextTool, type QueryHolder, type RawContextUsage } from "../context/server.js";
import { withCompactTool, parseCompactOutcome, type CompactHolder, type CompactOutcome } from "../compaction/server.js";
import { classifyLimitMessage, type LimitState } from "../limits/classify.js";
import { turnFailureOf, type TurnFailure } from "./turnResult.js";
import { normalizeTurnInput, type UserTurnInput } from "./turnInput.js";

/** One live background task, as carried by system/background_tasks_changed frames. */
export interface BackgroundTaskInfo { task_id: string; task_type: string; description: string; }

/** One dropped transcript-mirror batch, as carried by system/mirror_error frames (W3.3): the SDK
 *  retried sessionStore.append() 3x and gave up — the local transcript is intact, the mirror lost
 *  a batch. Surfaced so operators are not silent on external-store data loss. */
export interface MirrorErrorInfo { error: string; key: { projectKey: string; sessionId: string; subpath?: string }; at: number; }

export interface SessionDeps { query: QueryFn; }
export interface SessionOpts { contextTool?: boolean; compactTool?: boolean; label?: string; now?: () => number; }

type UserMessageUUID = NonNullable<SDKUserMessage["uuid"]>;
type SubmittedOrigin = "human" | "auto-continuation";
type TurnKind = "normal" | "compact";

/** THE authoritative builder seam (F9 T-IMAGE Task 4/I3a, spec v3.1 "Authoritative validation lives
 *  at the Session message-builder boundary"): every turn — human, auto-continuation, steer, compact —
 *  passes through here, so this is the one place normalization can never be bypassed regardless of
 *  which public method a caller used. An array is run through `normalizeTurnInput` (which enforces
 *  every image cap by re-decoding each block's own bytes, never trusting the caller); a string is
 *  sent as-is, since `normalizeTurnInput` has nothing to check on plain text. The SDK's own
 *  `MessageParam.content` narrows `media_type` to its literal union where `UserContentBlock` keeps it
 *  a bare string (library ergonomics — no caller needs the Anthropic SDK's types just to build a
 *  turn), so the assembled content is cast at the wire boundary, not loosened upstream of it. */
function userTurn(input: UserTurnInput, uuid: UserMessageUUID, origin: SubmittedOrigin): SDKUserMessage {
  const content = Array.isArray(input) ? normalizeTurnInput(input) : input;
  return { type: "user", message: { role: "user", content: content as SDKUserMessage["message"]["content"] }, parent_tool_use_id: null, origin: { kind: origin }, uuid };
}

/** What one turn settles to. `error` (Wave T Task 14) is ADDITIVE — a turn that reached a terminal result
 *  frame and reported failure still resolves, so every `{result}`-only consumer is unaffected. */
export interface TurnOutcome { result: unknown; structuredOutput?: unknown; error?: TurnFailure; }

interface Waiter { uuid: UserMessageUUID; origin: SubmittedOrigin; kind: TurnKind; compactLifecycle: boolean; onMessage: (m: unknown) => void; resolve: (r: TurnOutcome) => void; reject: (e: Error) => void; }

/** One long-lived query() session. A turn is submit(prompt,onMessage) → streamed messages → resolved result.
 *  Captures the SDK session_id from the first system/init frame (stable per probe) → .sessionId. */
export class Session implements ControllableSession {
  lastActiveAt: number;
  readonly done: Promise<void>;            // resolves when the read-loop ends (query disposed or died)
  private input = new AsyncQueue<SDKUserMessage>();
  private q: AsyncIterable<unknown>;
  private waiters: Waiter[] = [];          // queued turns; success results find their matching UUID
  private ended = false;
  private compactRequested = false;        // set by the cc-compact tool; fires one /compact at the next boundary
  private now: () => number;
  private label: string;                   // used only in error messages
  private _sessionId?: string;             // captured from the first system/init frame
  private _limit?: LimitState;             // state-of-last-signal (result / rate_limit_event); cleared by a clean one
  private _bgTasks: BackgroundTaskInfo[] = []; // LEVEL signal: REPLACED wholesale on each background_tasks_changed
  private _mirrorErrors: MirrorErrorInfo[] = []; // EVENT log: appended per mirror_error frame (bounded, last 50)
  private _unmatchedResults = 0;           // COUNTER: result frames no waiter claimed (see the getter)
  private frameCbs = new Set<(m: unknown) => void>();

  constructor(deps: SessionDeps, options: Record<string, unknown>, sessionOpts: SessionOpts = {}) {
    this.now = sessionOpts.now ?? Date.now;
    this.label = sessionOpts.label ?? "session";
    this.lastActiveAt = this.now();
    let opts = options;
    let ctxHolder: QueryHolder | undefined;
    let compactHolder: CompactHolder | undefined;
    if (sessionOpts.contextTool) { ctxHolder = {}; opts = withContextTool(opts, ctxHolder); }
    if (sessionOpts.compactTool) { compactHolder = {}; opts = withCompactTool(opts, compactHolder); }
    this.q = deps.query({ prompt: this.input, options: opts });
    if (ctxHolder) ctxHolder.query = this.q as unknown as { getContextUsage(): Promise<RawContextUsage> };
    if (compactHolder) compactHolder.request = () => this.requestCompaction();
    this.done = this.readLoop().catch(() => {});
  }

  /** The SDK session_id, available after the first turn's init frame; undefined before then. */
  get sessionId(): string | undefined { return this._sessionId; }
  isEnded(): boolean { return this.ended; }
  /** Billing/limit state as of the last result / rate_limit_event (undefined = healthy). */
  get limitState(): LimitState | undefined { return this._limit; }
  /** Live background tasks (probe 39): the full set from the last background_tasks_changed frame. */
  get backgroundTasks(): BackgroundTaskInfo[] { return this._bgTasks; }
  /** Dropped sessionStore mirror batches (W3.3) — empty means the external mirror is loss-free so far. */
  get mirrorErrors(): MirrorErrorInfo[] { return this._mirrorErrors; }
  /** Result frames the read loop dropped because `resultWaiter` matched none of them (M2b Task 5 review).
   *  Nonzero means a turn was told nothing: whatever the frame settled, it was not the promise a caller is
   *  holding, so the symptom downstream is a thread that stays busy forever with no diagnostic anywhere.
   *  The known open question this exists to make visible: `steer()` pushes a user message with its own
   *  uuid, and probe 103b never captured which uuid a steered turn's result carries — if the engine
   *  correlates it to the STEER's, this counter is what says so instead of the appserver just hanging.
   *  Settled by the M2b Task 9 live acceptance run; until then, a nonzero value is the flag. */
  get unmatchedResults(): number { return this._unmatchedResults; }

  /** Queue a turn + its waiter. Every turn keeps its fixed input provenance so its result cannot settle a
   *  waiter owned by another origin class. `uuid` is the appserver-only seam (Task 6/gap 6, see
   *  EngineSession.submit doc): a caller-minted id stamped onto the pushed SDKUserMessage in place of the
   *  fresh mint — result correlation by `user_message_uuid` works identically, and the live userMessage
   *  item's id equals the persisted transcript id. Undefined for every other caller. */
  private enqueueTurn(prompt: UserTurnInput, onMessage: (m: unknown) => void, origin: SubmittedOrigin, kind: TurnKind = "normal", uuid?: string): Promise<TurnOutcome> {
    const turnUuid = (uuid ?? randomUUID()) as UserMessageUUID;
    return new Promise((resolve, reject) => { this.waiters.push({ uuid: turnUuid, origin, kind, compactLifecycle: false, onMessage, resolve, reject }); this.input.push(userTurn(prompt, turnUuid, origin)); });
  }
  private enqueueCompact(origin: SubmittedOrigin, onMessage: (m: unknown) => void): Promise<TurnOutcome> {
    return this.enqueueTurn("/compact", onMessage, origin, "compact");
  }

  /** UUID-bearing results are turn-owned. UUID-less results may use FIFO only with matching explicit
   *  provenance, or for a compact waiter that has observed its own compact lifecycle marker. */
  private fifoWaiter(m: any): Waiter | undefined {
    const waiter = this.waiters[0];
    if (!waiter) return undefined;
    // An api_error terminal frame is fatal to the WHOLE query — probe 96 measured the async iterator
    // throwing immediately after it — so no later result can arrive for any waiter and there is no
    // "wrong waiter" to protect. Settling the head one with the failure is what stops readLoop's
    // `finally` from rejecting it "<label> disposed", a message that names the wrong cause and printed a
    // second, wrong line underneath the honest one.
    if (m.terminal_reason === "api_error") return waiter;
    if (m.origin != null) return m.origin.kind === waiter.origin ? waiter : undefined;
    return waiter.kind === "compact" && waiter.compactLifecycle ? waiter : undefined;
  }
  // Correlation is by the presence of `user_message_uuid`, NOT by subtype: probe 96's dead-connection
  // frame is `subtype:"success"` with `is_error:true`, and a subtype gate here made the routing depend on
  // a field that lies. Whether the turn SUCCEEDED is turnFailureOf()'s job, not this one's.
  private resultWaiter(m: any): Waiter | undefined {
    const uuid = m.user_message_uuid;
    if (typeof uuid !== "string" || uuid.length === 0) return this.fifoWaiter(m);
    const waiter = this.waiters.find((w) => w.uuid === uuid);
    return waiter && (m.origin == null || m.origin.kind === waiter.origin) ? waiter : undefined;
  }

  /** Run one turn; non-result messages stream to onMessage; resolves with the turn's result (and, when the
   *  SDK's outputFormat produced one, `structuredOutput` — additive, so `{result}`-only callers are unaffected).
   *  A turn that REACHED a terminal result frame and reported failure also resolves, carrying an additive
   *  `error` tag (Task 14): it has a session id, usage, cost and an error text, which a rejection would
   *  throw away. Only a genuine transport exception — the query dying with no terminal frame — rejects.
   *  Rejects immediately if the underlying query has already ended (else the waiter would never drain).
   *  `opts.uuid` is optional and additive (Task 6/gap 6) — every existing 1/2-arg caller is unaffected.
   *  `prompt` widened to `UserTurnInput` (F9 T-IMAGE Task 4/I3a): an array reaches `userTurn`'s builder
   *  and is normalized there UNCONDITIONALLY — this is the one submit surface library callers reach
   *  directly, so it is the one that has to accept the array form at all. Every other submit path
   *  (`submitAutomatic`, `steer`, `/compact`) stays string-only; nothing about them needed to carry
   *  an image. */
  submit(prompt: UserTurnInput, onMessage: (m: unknown) => void = () => {}, opts?: { uuid?: string }): Promise<TurnOutcome> {
    if (this.ended) return Promise.reject(new Error(`${this.label} is not running`));
    return this.enqueueTurn(prompt, onMessage, "human", "normal", opts?.uuid);
  }

  /** Mid-turn STEER (probe 103b, ALIVE): push a user message into the live prompt stream so the model
   *  abandons what it is doing and follows the injection, WITHOUT registering a result waiter.
   *
   *  Deliberately not routed through `enqueueTurn`: that pairs every push with a waiter, and a steer has
   *  no result of its own — it folds into the turn already in flight, whose waiter is the one that
   *  settles. A waiter here would desync the FIFO: a uuid-less result goes to the waiter at the HEAD of
   *  the queue, so a stale steer sitting there would swallow the result the next real turn earned (and
   *  the frames routed to `waiters[0].onMessage` with it).
   *
   *  Same message shape and `human` provenance as `submit` (one builder, `userTurn`): a steer IS a human
   *  input. Void: there is nothing to await — the push is synchronous and the outcome arrives as the
   *  steered turn's own result.
   *
   *  Unverified, and only a live run can settle it: probe 103b proved the injection influences the
   *  running turn but did not capture the result frame's `user_message_uuid`. `resultWaiter` scores a
   *  present-but-unknown uuid as "no waiter" (uuid-bearing results are turn-owned, deliberately), so an
   *  engine that correlated a steered turn's result to the STEER's uuid rather than the prompt's would
   *  leave the turn unsettled. Fixing that on a guess would mean weakening turn-ownership for every
   *  result, so it stays a live-acceptance question rather than a speculative widening here. */
  steer(text: string): void {
    this.assertRunning();
    this.input.push(userTurn(text, randomUUID() as UserMessageUUID, "human"));
  }

  /** Fixed route for host-generated follow-up turns; callers cannot choose another provenance class. */
  submitAutomatic(prompt: string, onMessage: (m: unknown) => void = () => {}): Promise<TurnOutcome> {
    if (this.ended) return Promise.reject(new Error(`${this.label} is not running`));
    return prompt === "/compact" ? this.enqueueCompact("auto-continuation", onMessage) : this.enqueueTurn(prompt, onMessage, "auto-continuation");
  }

  /** Convenience: run one turn as an async generator. Yields the turn's streamed (non-result) messages,
   *  then a terminal { type:"result", result } — or { type:"error", error } both when the turn rejects and
   *  when it resolves error-tagged. The tag is the SAME failure a rejection used to be (Task 14 changed how
   *  it settles, not whether it failed), so this public generator must not report it as a result: the
   *  terminal shape is what a `stream()` consumer branches on. Sugar over submit. */
  async *stream(prompt: string): AsyncGenerator<unknown> {
    const out = new AsyncQueue<unknown>();
    const done = this.submit(prompt, (m) => out.push(m)).then(
      (r) => out.push(r.error ? { type: "error", error: r.error.message } : { type: "result", result: r.result }),
      (e) => out.push({ type: "error", error: (e as Error).message }),
    ).finally(() => out.close());
    for await (const m of out) yield m;
    await done;
  }

  /** Inject `/compact` as a turn (with its own correlated waiter) and return the structured outcome. */
  async compact(): Promise<CompactOutcome> {
    this.assertRunning();
    const frames: unknown[] = [];
    await this.enqueueCompact("human", (m) => {
      const mm = m as any;
      if (mm.type === "system" && (mm.subtype === "status" || mm.subtype === "compact_boundary")) frames.push(mm);
    });
    return parseCompactOutcome(frames);
  }

  /** Record intent (set by the cc-compact tool); consumed at the next turn boundary in readLoop. */
  requestCompaction(): void { this.compactRequested = true; }

  /** End the query (in-flight turn finishes) and wait for the read-loop. */
  async dispose(): Promise<void> { this.input.close(); await this.done; }

  protected assertRunning(): void { if (this.ended) throw new Error(`${this.label} is not running`); }

  private callQ(name: string, ...args: unknown[]): Promise<unknown> {
    const fn = (this.q as any)[name];
    if (typeof fn !== "function") return Promise.reject(new Error(`unsupported: ${name}`));
    return fn.apply(this.q, args);
  }
  private callQValue(name: string): Promise<unknown> {
    const fn = (this.q as any)[name];
    if (typeof fn !== "function") return Promise.reject(new Error(`unsupported: ${name}`));
    return fn.apply(this.q);
  }

  async setModel(model?: string): Promise<void> { this.assertRunning(); await this.callQ("setModel", model); }
  async setPermissionMode(mode: string): Promise<void> { this.assertRunning(); await this.callQ("setPermissionMode", mode); }
  async setMaxThinkingTokens(maxTokens: number | null): Promise<void> { this.assertRunning(); await this.callQ("setMaxThinkingTokens", maxTokens); }
  // 0.3.211 returns a receipt ({ still_queued: [...] }) — surfaced to callers; still a benign no-op when idle.
  // Probe 38 caution: interrupting an in-flight turn resolves it error_during_execution and the query
  // stream may then die at teardown — daemon restart policy covers revival.
  async interrupt(): Promise<unknown> { return this.callQ("interrupt"); }
  /** Re-send `initialize` to the running CLI → a FRESH init payload (commands/agents/models/account…),
   *  unlike the cached initializationResult(). Probe 38: safe mid-session, even with a permission parked
   *  (the parked request is deduped, NOT redelivered to this process). */
  async reinitialize(): Promise<unknown> { this.assertRunning(); return this.callQValue("reinitialize"); }
  /** Re-scan plugins / skills on the running CLI (probe 105: both ALIVE). Each answers with a FRESH
   *  CATALOG — commands+agents+plugins+mcpServers for plugins, skills for skills — not a bare ack, so a
   *  reload is a capabilities refresh and callers that mirror those catalogs must re-read them. Relayed
   *  verbatim: the shape is the SDK's own. */
  async reloadPlugins(): Promise<unknown> { this.assertRunning(); return this.callQValue("reloadPlugins"); }
  async reloadSkills(): Promise<unknown> { this.assertRunning(); return this.callQValue("reloadSkills"); }
  /** Stop a running background task; the CLI emits task_notification{stopped} + a changed frame. */
  async stopTask(taskId: string): Promise<void> { this.assertRunning(); await this.callQ("stopTask", taskId); }
  /** Ctrl+B: background in-flight FOREGROUND tasks (all, or the one started by `toolUseId`). The blocked
   *  tool call returns "backgrounded" immediately and the turn continues (probe 39 Q3). */
  async backgroundAll(toolUseId?: string): Promise<boolean> { this.assertRunning(); return (await this.callQ("backgroundTasks", toolUseId)) as boolean; }
  /** Async accessor for the live background-task set (bridge/daemon payload shape). */
  async listBackgroundTasks(): Promise<BackgroundTaskInfo[]> { return this._bgTasks; }

  /** Persistent frame listener — fires for EVERY frame the read-loop sees, waiter or not. This is the one
   *  session-layer change of Goal B: between turns there is no waiter, so system frames (task changes,
   *  status/mode) previously vanished (spec §session-layer). Subscribers are independent; one throwing
   *  does not starve another. */
  onFrame(cb: (m: unknown) => void): () => void { this.frameCbs.add(cb); return () => { this.frameCbs.delete(cb); }; }

  async getContextUsage(): Promise<unknown> { this.assertRunning(); return this.callQValue("getContextUsage"); }
  async accountInfo(): Promise<unknown> { this.assertRunning(); return this.callQValue("accountInfo"); }

  // Experimental SDK method name (it warns it will change); the wrapper insulates callers behind usage().
  async usage(): Promise<unknown> { this.assertRunning(); return this.callQValue("usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET"); }
  async initializationResult(): Promise<unknown> { this.assertRunning(); return this.callQValue("initializationResult"); }
  async applyFlagSettings(settings: Record<string, unknown>): Promise<void> { this.assertRunning(); await this.callQ("applyFlagSettings", settings); }
  /** Untyped control door (probe 75): every declared subtype rides the same funnel the typed methods use. */
  async getSettings(): Promise<unknown> {
    this.assertRunning();
    const res = (await this.callQ("request", { subtype: "get_settings" })) as { response?: unknown };
    return res?.response ?? res;
  }

  // ---- runtime MCP topology (W3.5; probes 52/52b) ----
  /** Replace the session's DYNAMIC MCP server set mid-session (stdio/sse/http and SDK-type both work).
   *  Returns {added, removed, errors}. `{}` removes all dynamics (plugin-owned servers are exempt —
   *  sdk.d.ts). New servers' tools are ToolSearch-reachable on the next turn (probe 52). */
  async setMcpServers(servers: Record<string, unknown>): Promise<{ added: string[]; removed: string[]; errors: Record<string, string> }> {
    this.assertRunning();
    return (await this.callQ("setMcpServers", servers)) as { added: string[]; removed: string[]; errors: Record<string, string> };
  }
  /** Kill + respawn a PROCESS-BASED server (probe 52b: pid change proven). THROWS for SDK-type servers
   *  ("SDK servers should be handled in print.ts") — they are caller-owned and need no subprocess restart. */
  async reconnectMcpServer(serverName: string): Promise<void> { this.assertRunning(); await this.callQ("reconnectMcpServer", serverName); }
  /** ADVISORY enable/disable (probe 52b): disabling flips status + kills the child, but a model tool
   *  call RESURRECTS the server via on-demand bring-up — this is NOT a security boundary; gate with
   *  permissions (canUseTool/disallowedTools) instead. toggle(true) throws for SDK-type servers. */
  async toggleMcpServer(serverName: string, enabled: boolean): Promise<void> { this.assertRunning(); await this.callQ("toggleMcpServer", serverName, enabled); }
  /** Live connection status for all servers ([{name, status}, …]). */
  async mcpServerStatus(): Promise<unknown[]> { this.assertRunning(); return (await this.callQValue("mcpServerStatus")) as unknown[]; }
  /** Per-server permission-mode pin (probe 49: RULES-LAYER only — a canUseTool broker is still
   *  consulted; use for rule/classifier posture, not to silence a broker). null clears the pin. */
  async setMcpPermissionModeOverride(serverName: string, mode: string | null): Promise<unknown> {
    this.assertRunning();
    return this.callQ("setMcpPermissionModeOverride", serverName, mode);
  }

  /** Rewind the file checkpoint to a prior user-prompt message. The anchor must be a real user-prompt UUID
   *  from the transcript (getSessionMessages), NOT a live-stream type:"user" frame. */
  async rewind(userMessageId: string, opts?: { dryRun?: boolean }): Promise<unknown> {
    this.assertRunning();
    const fn = (this.q as any).rewindFiles;
    if (typeof fn !== "function") return Promise.reject(new Error("unsupported: rewindFiles"));
    return fn.call(this.q, userMessageId, opts);
  }

  /** `agents` is the session's available SUBAGENTS (Query.supportedAgents) — the fourth catalog the SDK
   *  exposes alongside models/commands/mcpServers, and the one a client needs to offer a subagent picker.
   *  Same optional-call shape as the other three: an engine build without the method yields []. */
  async capabilities(): Promise<{ models: unknown[]; commands: unknown[]; mcpServers: unknown[]; agents: unknown[] }> {
    const q = this.q as any;
    const [models, commands, mcpServers, agents] = await Promise.all([
      q.supportedModels?.() ?? [], q.supportedCommands?.() ?? [], q.mcpServerStatus?.() ?? [], q.supportedAgents?.() ?? [],
    ]);
    return { models, commands, mcpServers, agents };
  }

  private async readLoop(): Promise<void> {
    try {
      for await (const m of this.q) {
        this.lastActiveAt = this.now();
        for (const cb of [...this.frameCbs]) { try { cb(m); } catch { /* one subscriber's failure is not another's */ } }
        const mm = m as any;
        if (mm.type === "system" && mm.subtype === "init" && !this._sessionId) this._sessionId = mm.session_id;
        if (mm.type === "system" && ((mm.subtype === "status" && mm.status === "compacting") || mm.subtype === "compact_boundary")) {
          const waiter = this.waiters[0]; if (waiter?.kind === "compact") waiter.compactLifecycle = true;
        }
        if (mm.type === "system" && mm.subtype === "background_tasks_changed") this._bgTasks = mm.tasks ?? []; // REPLACE, never merge
        if (mm.type === "system" && mm.subtype === "mirror_error") { this._mirrorErrors.push({ error: mm.error, key: mm.key, at: this.now() }); if (this._mirrorErrors.length > 50) this._mirrorErrors.shift(); }
        const waiter = mm.type === "result" ? this.resultWaiter(mm) : undefined;
        if (waiter) this._limit = classifyLimitMessage(mm); // clean result CLEARS
        else if (mm.type === "rate_limit_event") {          // allowed only clears a rate-limit state
          const rl = classifyLimitMessage(mm);
          if (rl) this._limit = rl; else if (this._limit?.kind === "rate-limit") this._limit = undefined;
        }
        if (waiter) {
          this.waiters.splice(this.waiters.indexOf(waiter), 1);
          const failure = turnFailureOf(mm);   // is_error / api_error_status — never subtype (probe 96)
          waiter.resolve({ result: mm.result, structuredOutput: mm.structured_output, ...(failure ? { error: failure } : {}) });
          if (this.compactRequested && !this.ended) { this.compactRequested = false; void this.enqueueCompact("auto-continuation", () => {}).catch(() => {}); }
        } else if (mm.type === "result") this._unmatchedResults++; // dropped, but no longer traceless (see the getter)
        else this.waiters[0]?.onMessage(m);
      }
    } finally {
      this.ended = true;
      for (const w of this.waiters.splice(0)) w.reject(new Error(`${this.label} disposed`));
    }
  }
}
