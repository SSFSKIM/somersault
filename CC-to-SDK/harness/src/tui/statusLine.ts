// tui/src/statusLine.ts — Wave C Task 9 (EP-C2a): the statusLine hook's three moving parts — resolving the
// setting, running the command, and deciding WHEN to run it — lifted out of React so all three are testable
// objects the mount site merely drives. Canon: annex §C2.1 (the zod schema at bundle L42035), §C2.4 (`b0b`'s
// triggers, L484860) and §C2.5 (`B8s`'s execution, L366191). WAVE C TASK 10 ADDED THE LAST TWO PURE PIECES at
// the foot of this file — the stdin payload (§C2.2-§C2.3) and the render transform (§C2.6) — so the only
// statusLine code that touches React is the handful of `<Text>` lines in `Footer.tsx`. Nothing here imports
// React or Ink.
//
// THE ONE THING TO UNDERSTAND ABOUT THIS FEATURE: **every failure is silence.** Nonzero exit, spawn failure,
// timeout and thrown exception all produce `undefined`, and `undefined` means "leave the previous text
// alone" — the user is never shown an error, a stack, or a blanked row, because the status line is chrome
// and chrome that shouts about its own plumbing is worse than chrome that quietly goes stale. stderr exists
// only for the debug log. This is upstream's design (`B8s` has one `try` and three silent returns), and it
// is the reason `runStatusLine` NEVER rejects: a caller cannot forget to catch what is never thrown.
//
// ANNEX AMBIGUITY, RESOLVED. §C2.5 says both "the previous `statusLineText` is not overwritten" and
// "`state.statusLineText` is set to that value including `undefined`". Those disagree; the first is the
// observable behaviour QA-6 measured (a failing script leaves the row as it was), so `onText` here is called
// ONLY with a string. Its signature makes the other reading unrepresentable.
//
// The timeout, the debounce and the poll all go through the `deps` seam (plan constraint 15) so the unit
// tests drive a 600-second timeout and a 300 ms debounce in the same millisecond.
import { spawn as realSpawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

/** `Dee(…, 300)` (L484890) — the debounce on every state-delta trigger, and (upstream routes the poll through
 *  the same function) on every `refreshInterval` tick too. */
export const STATUS_LINE_DEBOUNCE_MS = 300;
/** `xm` (L223612), the hook-execution default: TEN MINUTES. The per-hook `timeout` field upstream can override
 *  it with is in SECONDS (`D = e.timeout ? e.timeout * 1000 : xm`, L365222) — but `statusLine`'s own schema has
 *  no `timeout` key, so that override is unreachable here and this constant is the only value in play. */
export const STATUS_LINE_TIMEOUT_MS = 600_000;

/** Annex §C2.1 verbatim in shape. `hideVimModeIndicator` is ACCEPTED AND IGNORED: it hides upstream's
 *  `-- INSERT --` row, and ccx has no vim mode to indicate (Footer.tsx records the same absence). Parsing it
 *  rather than dropping it keeps a settings file written for Claude Code from being rejected here. */
export interface StatusLineConfig {
  type: "command";
  command: string;
  padding?: number;
  refreshInterval?: number;
  hideVimModeIndicator?: boolean;
}

/** zod's `S.number()` rejects NaN and accepts everything else numeric (Infinity included). */
const isNum = (v: unknown): v is number => typeof v === "number" && !Number.isNaN(v);

/** Resolve `settings.statusLine` against the schema. The failure modes are not uniform, and the asymmetry is
 *  upstream's, straight off the zod chain:
 *   · `type`/`command`/`padding`/`hideVimModeIndicator` have no `.catch`, so a bad one fails the whole object
 *     and the status line is simply not configured.
 *   · `refreshInterval` is `.min(1).optional().catch(void 0)` — the `.catch` swallows the failure and yields
 *     `undefined`, so a bad interval drops THAT FIELD and the rest of the config still stands (it just falls
 *     back to event-driven-only updates, the default).
 *  Unknown keys are stripped, as zod objects strip by default — the returned object carries the schema's
 *  fields and nothing else, so a future upstream key cannot leak into ccx's runtime unnoticed.
 *
 *  WHICH settings object to hand in is the CALLER's decision and a load-bearing one: canon L154558 maps
 *  `statusLine: false` for the local/project sources and `true` for user/policy, i.e. a project's
 *  `.claude/settings.json` cannot install a status line on a machine that checks the repo out. ccx has no
 *  policy layer, so the only honoured source is the USER file — `readSettingsFile("userSettings", …)`.
 *
 *  `disableAllHooks` is checked HERE and nowhere else, because this is the only function that sees the whole
 *  settings object rather than the `statusLine` block. Its own schema description is "Disable all hooks and
 *  statusLine execution" (§C2.5, bundle L392), and upstream's `b0b` reads it as a startup guard beside the
 *  workspace-trust one. Upstream additionally logs `Status line is configured but disableAllHooks is true` at
 *  `warn`; ccx has no warn channel that isn't a live Ink frame, so the guard is silent — returning `undefined`
 *  is "not configured", which is exactly what every caller already handles. Strictly `=== true`: the setting
 *  is `S.boolean().optional()`, so a truthy string is a malformed value, not a request to disable. */
export function resolveStatusLineConfig(settings: Record<string, unknown> | undefined): StatusLineConfig | undefined {
  if (settings?.disableAllHooks === true) return undefined;
  const raw = settings?.statusLine;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const s = raw as Record<string, unknown>;
  if (s.type !== "command" || typeof s.command !== "string") return undefined;
  if (s.padding !== undefined && !isNum(s.padding)) return undefined;
  if (s.hideVimModeIndicator !== undefined && typeof s.hideVimModeIndicator !== "boolean") return undefined;
  const cfg: StatusLineConfig = { type: "command", command: s.command };
  if (s.padding !== undefined) cfg.padding = s.padding as number;
  if (isNum(s.refreshInterval) && s.refreshInterval >= 1) cfg.refreshInterval = s.refreshInterval;   // else: `.catch(void 0)`
  if (s.hideVimModeIndicator !== undefined) cfg.hideVimModeIndicator = s.hideVimModeIndicator as boolean;
  return cfg;
}

export interface RunStatusLineDeps {
  spawn?: typeof realSpawn;
  /** Used to classify the failure in the debug line (timeout vs plain nonzero exit), upstream's `i = Date.now()`. */
  now?: () => number;
  timeoutMs?: number;
  /** Aborts the run: SIGTERM to the child, `undefined` to the caller. The driver gives every run its own. */
  signal?: AbortSignal;
  /** The session cwd. Falls back to `fallbackCwd` if it has since been deleted — upstream's own fallback
   *  (§C2.5), and without it `spawn` throws ENOENT for a reason that has nothing to do with the command. */
  cwd?: string;
  fallbackCwd?: string;
  exists?: (p: string) => boolean;
  env?: NodeJS.ProcessEnv;
  projectDir?: string;
  columns?: number;
  lines?: number;
  /** Upstream's `v(…)` debug log. ccx has no debug-log module, so the default writes to stderr ONLY under
   *  `CCX_DEBUG` — inside a live Ink render an unguarded stderr write would land in the middle of a frame. */
  debug?: (msg: string) => void;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (h: unknown) => void;
}

const defaultDebug = (msg: string): void => { if (process.env.CCX_DEBUG) process.stderr.write(`${msg}\n`); };

/** `/bin/sh -c` on posix, ComSpec on Windows — the same pair `child_process.exec` picks, which is what
 *  `bash.ts`'s `!` shell escape already runs the user's commands through. The command string is the user's
 *  own settings file running with the user's own privileges; there is no untrusted interpolation here. */
function shellArgv(command: string, platform: NodeJS.Platform, env: NodeJS.ProcessEnv): [string, string[]] {
  if (platform === "win32") return [env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", command]];
  return ["/bin/sh", ["-c", command]];
}

/** `s.stdout.trim().split("\n").flatMap(c => c.trim() || []).join("\n")` (L366191) — trim the whole thing,
 *  trim every line, DROP the blank ones, rejoin. A `\r\n` script loses its carriage returns to the per-line
 *  trim, which is why nothing here special-cases CRLF. */
function normalizeStdout(stdout: string): string {
  return stdout.trim().split("\n").map((l) => l.trim()).filter((l) => l !== "").join("\n");
}

/** Run the command, resolve with its normalized stdout — or with `undefined` for every other outcome there
 *  is. NEVER rejects and never throws: see the file header. */
export function runStatusLine(cfg: StatusLineConfig, payloadJson: string, deps: RunStatusLineDeps = {}): Promise<string | undefined> {
  const spawn = deps.spawn ?? realSpawn;
  const now = deps.now ?? Date.now;
  const timeoutMs = deps.timeoutMs ?? STATUS_LINE_TIMEOUT_MS;
  const debug = deps.debug ?? defaultDebug;
  const arm = deps.setTimeout ?? ((fn: () => void, ms: number): unknown => { const h = setTimeout(fn, ms); h.unref?.(); return h; });
  const disarm = deps.clearTimeout ?? ((h: unknown): void => { clearTimeout(h as ReturnType<typeof setTimeout>); });
  const exists = deps.exists ?? existsSync;

  return new Promise<string | undefined>((resolve) => {
    if (deps.signal?.aborted) { resolve(undefined); return; }                    // `if (s.aborted) return;`, before we pay for a fork
    const wanted = deps.cwd ?? process.cwd();
    const cwd = exists(wanted) ? wanted : (deps.fallbackCwd ?? process.cwd());
    const parentEnv = deps.env ?? process.env;
    const env: NodeJS.ProcessEnv = {
      ...parentEnv,
      CLAUDE_PROJECT_DIR: deps.projectDir ?? cwd,
      COLUMNS: String(deps.columns ?? process.stdout.columns ?? 80),
      LINES: String(deps.lines ?? process.stdout.rows ?? 24),
    };
    const [bin, argv] = shellArgv(cfg.command, process.platform, parentEnv);
    const started = now();

    let settled = false, timer: unknown, onAbort: (() => void) | undefined;
    const done = (value: string | undefined): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) { disarm(timer); timer = undefined; }
      if (onAbort) deps.signal?.removeEventListener("abort", onAbort);
      resolve(value);
    };

    let child: ReturnType<typeof realSpawn>;
    try {
      child = spawn(bin, argv, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    } catch (e) {
      debug(`Status hook failed: ${e}`);                                          // `catch (o)` — an exec_error, still silent
      resolve(undefined);
      return;
    }

    let out = "", err = "";
    child.stdout?.on("data", (c: Buffer) => { out += c.toString(); });
    child.stderr?.on("data", (c: Buffer) => { err += c.toString(); });
    child.on("error", (e: Error) => { debug(`StatusLine [${cfg.command}] spawn failed: ${e.message}`); done(undefined); });
    child.on("close", (code: number | null) => {
      const trimmed = err.trim();
      if (trimmed) debug(`StatusLine [${cfg.command}] stderr: ${trimmed}`);       // logged on SUCCESS too, as upstream does
      if (code === 0) { done(normalizeStdout(out) || undefined); return; }        // empty output is a non-result, not an empty row
      debug(`StatusLine [${cfg.command}] completed with status ${code}${now() - started >= timeoutMs ? " (timeout)" : ""}`);
      done(undefined);
    });

    // A child that closes its stdin (or never reads it) makes the write EPIPE. Unhandled, that 'error' event
    // on the stream is an uncaught exception that takes the REPL down over a status line — the one failure
    // mode "everything is silence" must cover most loudly.
    child.stdin?.on("error", (e: Error) => { debug(`StatusLine [${cfg.command}] stdin: ${e.message}`); });
    child.stdin?.write(payloadJson);
    child.stdin?.end();

    if (deps.signal) {
      onAbort = (): void => { child.kill("SIGTERM"); done(undefined); };
      deps.signal.addEventListener("abort", onAbort, { once: true });
    }
    timer = arm(() => { child.kill("SIGTERM"); debug(`StatusLine [${cfg.command}] timed out after ${timeoutMs}ms`); done(undefined); }, timeoutMs);
  });
}

export type StatusLineRunner = (cfg: StatusLineConfig, payloadJson: string, deps?: { signal?: AbortSignal }) => Promise<string | undefined>;

export interface StatusLineDriverDeps {
  runStatusLine?: StatusLineRunner;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (h: unknown) => void;
  /** Same seam and same default as `RunStatusLineDeps.debug`: where the driver's own swallowed failures go. */
  debug?: (msg: string) => void;
}

/** `setTimeout`'s ceiling. Above 2^31−1 ms node does not fire late, it clamps the delay to **1 ms** — so an
 *  `Infinity` `refreshInterval` (which the schema accepts, since `z.number()` does) would turn the poll into a
 *  hot loop, and because every tick re-arms the 300 ms debounce, one that never actually runs the command. */
const MAX_TIMER_MS = 2_147_483_647;

export interface StatusLineDriver {
  /** `useEffect(() => (M(), …), [])` (L484931) — ONE immediate, undebounced run, and the point at which the
   *  `refreshInterval` poll (if any) starts ticking. */
  mountRun(): void;
  /** Every state delta upstream lists at L484891 (`lastAssistantMessageId`, `tokenUsage`, `permissionMode`,
   *  `mainLoopModel`, `fastMode`, `effortValue`, `thinkingEnabled`, `prStatus`) funnels here. Debounced
   *  300 ms and coalescing — `tokenUsage` alone fires on every streamed usage update, which is how QA-6
   *  watched the invocation count climb 9→15 inside one turn. `reason` is for the debug log only. */
  poke(reason: string): void;
  /** Unmount: cancels the pending debounce, stops the poll, aborts the in-flight run, and makes every later
   *  call — and every late result — inert. */
  dispose(): void;
}

/** The cadence machine. `buildPayload` is called once per RUN (never once per driver), so a run always
 *  carries the state at its own moment; `onText` receives successful output only. */
export function createStatusLineDriver(cfg: StatusLineConfig, buildPayload: () => string, onText: (t: string) => void, deps: StatusLineDriverDeps = {}): StatusLineDriver {
  const run = deps.runStatusLine ?? runStatusLine;
  const arm = deps.setTimeout ?? ((fn: () => void, ms: number): unknown => { const h = setTimeout(fn, ms); h.unref?.(); return h; });
  const disarm = deps.clearTimeout ?? ((h: unknown): void => { clearTimeout(h as ReturnType<typeof setTimeout>); });
  const debug = deps.debug ?? defaultDebug;

  let debounceTimer: unknown, pollTimer: unknown, inflight: AbortController | undefined;
  let generation = 0, disposed = false;

  // "Every failure is silence" is a promise the driver has to keep on the CALLER's behalf too, and this is
  // where it would otherwise break. `execute` reaches the event loop as a bare debounce/poll timer callback:
  // nothing is above it to catch, so a `buildPayload` that throws (the mount site's payload reads live session
  // state, which mid-teardown or pre-first-turn may not be there) is an uncaught exception, and an `onText`
  // that throws inside the `.then` is an unhandled rejection — fatal on node ≥15. Both would kill the REPL
  // over a status line. The runner itself never rejects, but the seam is a caller-supplied function and the
  // guard costs one line, so it is guarded as if it does.
  const execute = (): void => {
    if (disposed) return;
    let payload: string;
    try { payload = buildPayload(); }                                    // BEFORE the abort below: a payload we
    catch (e) { debug(`StatusLine payload failed: ${e}`); return; }      // couldn't build is no reason to kill a good run
    inflight?.abort();                                                   // `o.current?.abort()` (L484872) — one run at a time
    const ac = new AbortController();
    inflight = ac;
    const mine = ++generation;
    void run(cfg, payload, { signal: ac.signal }).then((text) => {
      // Two guards, not one: `mine !== generation` drops a superseded run whose promise settles AFTER its
      // successor's (abort is a request, not a guarantee — a script already past its last write still
      // resolves with text), and `disposed` drops a result that arrives after unmount.
      if (disposed || mine !== generation) return;
      inflight = undefined;
      if (text !== undefined) { try { onText(text); } catch (e) { debug(`StatusLine onText failed: ${e}`); } }
    }, (e) => { debug(`StatusLine run rejected: ${e}`); });
  };

  const schedule = (): void => {
    if (disposed) return;
    if (debounceTimer !== undefined) disarm(debounceTimer);              // trailing-edge debounce: the window RESTARTS
    debounceTimer = arm(() => { debounceTimer = undefined; execute(); }, STATUS_LINE_DEBOUNCE_MS);
  };

  // `Lc(B, Math.max(1, q) * 1000)` (L484903): the poll interval is in SECONDS, clamped at 1 even though the
  // schema already enforces the minimum — and it calls `B`, the DEBOUNCED function, not the runner. So a tick
  // arms the same 300 ms window a state delta would, and a tick landing mid-burst coalesces with it. Chained
  // timeouts rather than an interval, so the driver needs only the two timer seams the plan gives it.
  const armPoll = (): void => {
    if (disposed || cfg.refreshInterval === undefined) return;
    pollTimer = arm(() => { pollTimer = undefined; schedule(); armPoll(); }, Math.min(Math.max(1, cfg.refreshInterval) * 1000, MAX_TIMER_MS));
  };

  return {
    mountRun(): void {
      if (disposed) return;
      execute();
      if (pollTimer === undefined) armPoll();
    },
    poke(_reason: string): void { schedule(); },
    dispose(): void {
      disposed = true;
      if (debounceTimer !== undefined) { disarm(debounceTimer); debounceTimer = undefined; }
      if (pollTimer !== undefined) { disarm(pollTimer); pollTimer = undefined; }
      inflight?.abort();
      inflight = undefined;
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// WAVE C TASK 10 (EP-C2b), PART 1 — THE STDIN PAYLOAD (annex §C2.2 documented contract, §C2.3 `H0b`).
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
//
// The builder is PURE and takes a snapshot in CCX's OWN vocabulary, not upstream's: every mapping decision
// (which ccx number answers which upstream key, and what a field means before the first turn) is therefore
// visible in one function and pinned by one golden test, instead of being spread across `useChat`'s closure.
//
// WHAT IS BUILT AND WHAT IS NOT is the spec's EP-C2 decision, not a guess: "every field ccx can honestly
// populate, omitting the conditional fields it cannot". Present: `session_id`, `cwd`, `session_name`,
// `model`, `workspace`, `version`, `output_style`, `cost`, `context_window`, `exceeds_200k_tokens`,
// `thinking`. Absent, each for a stated reason:
//   · `transcript_path` / `prompt_id` — SDK-internal. The SDK owns the JSONL path and mints prompt ids
//     inside the engine; ccx never sees either, and inventing a path a script might `cat` is worse than
//     omitting one it can test for.
//   · `rate_limits` — the credential-scope gap (qa5-12): the buckets are only readable on some auth paths.
//   · `vim`, `fast_mode`, `agent`, `remote`, `pr`, `worktree` — no ccx counterpart exists to report.
// Upstream's own `...x && {}` idiom is what keeps the two CONDITIONAL keys (`session_id`, `session_name`)
// genuinely absent rather than present-and-`undefined`: `JSON.stringify` drops an `undefined` value, but a
// script that reads the payload through anything else would see the key, and "absent" is the contract.

const require_ = createRequire(import.meta.url);
/** ccx's own version — upstream hard-codes `"2.1.220"` here and we answer with ours (D-C9: shape fidelity,
 *  not impersonation). Same reader and same relative path as `cli/help.ts` and `appserver/server.ts`: both
 *  `src/tui/` and `dist/tui/` sit one level under the package root. */
export const CCX_VERSION: string = (require_("../../package.json") as { version: string }).version;

/** Upstream's `exceeds200kTokens` prop, as a threshold this file owns rather than a flag ccx has nowhere to
 *  get: the payload's consumer only ever asks "is this conversation past the 200k line". */
export const STATUS_LINE_200K = 200_000;

/** The `session.usage()` shape, declared structurally rather than imported: `commands.ts` owns `SessionUsage`
 *  but drags `render.ts` and the whole formatter graph in with it, and this module's promise is that it is a
 *  leaf. Every field optional for the reason `SessionUsage`'s are — a partial response must still build. */
export interface StatusLineUsage {
  session?: {
    total_cost_usd?: number; total_api_duration_ms?: number; total_duration_ms?: number;
    total_lines_added?: number; total_lines_removed?: number;
    model_usage?: Record<string, { inputTokens?: number; outputTokens?: number; cacheReadInputTokens?: number; cacheCreationInputTokens?: number }>;
  };
}

/** ccx state at the moment of ONE run. Everything optional is optional because it genuinely may not exist
 *  yet — a session with no id (pre-first-turn), no model (an `attach` client that has not seen a turn end),
 *  no context reading and no usage reading. */
export interface StatusLineSnapshot {
  /** The engine's session id, once it has handed one back. */
  sessionId?: string;
  /** `/rename`'s title ?? the engine's ai-title (Wave C Task 8's two rungs). Absent → no `session_name` key. */
  sessionName?: string;
  cwd: string;
  /** `CLAUDE_PROJECT_DIR`'s value. Defaults to `cwd`, which is what ccx's single-root sessions always are. */
  projectDir?: string;
  /** The `/add-dir` grants ONLY — not `cwd`, which upstream reports separately in `current_dir`. */
  addedDirs?: readonly string[];
  model?: string;
  /** From `capabilities().models`, when the catalog fetch has landed. Falls back to the id. */
  modelDisplayName?: string;
  outputStyle?: string;
  thinkingEnabled: boolean;
  /** The last `getContextUsage()` reading. Absent before the first turn — which is what makes
   *  `current_usage` null and both percentages null, exactly the nulls QA-6 measured. */
  context?: { totalTokens?: number; maxTokens?: number };
  /** The last `session.usage()` reading. */
  usage?: StatusLineUsage;
  /** WAVE C TASK 11 (EP-C6). The session's live effort level, or ABSENT — which is how the caller says both
   *  "this model has no effort axis" (upstream's `Fk(y)` guard) and "this client was never told one"
   *  (`ccx attach`, which sees no launch config). `useChat` collapses those two into the one absence. */
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  version?: string;
}

export interface StatusLineContextWindow {
  total_input_tokens: number;
  total_output_tokens: number;
  context_window_size: number;
  current_usage: { input_tokens: number; output_tokens: number; cache_creation_input_tokens: number; cache_read_input_tokens: number } | null;
  used_percentage: number | null;
  remaining_percentage: number | null;
}

export interface StatusLinePayload {
  session_id?: string;
  cwd: string;
  session_name?: string;
  model: { id: string; display_name: string };
  workspace: { current_dir: string; project_dir: string; added_dirs: string[] };
  version: string;
  output_style: { name: string };
  cost: { total_cost_usd: number; total_duration_ms: number; total_api_duration_ms: number; total_lines_added: number; total_lines_removed: number };
  context_window: StatusLineContextWindow;
  exceeds_200k_tokens: boolean;
  effort?: { level: "low" | "medium" | "high" | "xhigh" | "max" };
  thinking: { enabled: boolean };
}

/** `_0b` (L484843), over ccx's two readings instead of upstream's one.
 *
 *  THREE RECORDED DIVERGENCES, all forced by what the SDK actually exposes (`sdk.d.ts`'s
 *  `SDKControlGetContextUsageResponse` is a CATEGORY breakdown — `totalTokens`/`maxTokens`/`percentage` —
 *  with no input/output/cache split anywhere in it):
 *   1. `total_input_tokens` is the LIVE CONTEXT SIZE (`totalTokens`). Upstream computes
 *      `input + cache_creation + cache_read` off the last API usage block, which IS the size of the context
 *      that request carried — the same quantity by a different route, so the key keeps its meaning.
 *   2. `total_output_tokens` and `current_usage` come from `session.usage()`, which is SESSION-CUMULATIVE
 *      across every model. Upstream's is the LAST usage block alone. A script printing "tokens out" reads
 *      a running total here and a per-request count upstream; the cumulative reading is the one ccx can
 *      produce at all, and it is what the `total_` prefix says.
 *   3. `used_percentage` is ROUNDED to an integer, matching `useChat`'s own `ctxPct` (`Math.round(...*100)`)
 *      so the status line and the context chip can never disagree by a fraction on the same reading.
 *  `current_usage` is `null` until there is a usage reading with model rows in it — upstream's own
 *  pre-first-response null, reached by ccx's route. */
function contextWindow(snapshot: StatusLineSnapshot): StatusLineContextWindow {
  const total = snapshot.context?.totalTokens ?? 0, max = snapshot.context?.maxTokens ?? 0;
  const rows = Object.values(snapshot.usage?.session?.model_usage ?? {});
  const fold = rows.reduce((acc, m) => ({
    input_tokens: acc.input_tokens + (m.inputTokens ?? 0),
    output_tokens: acc.output_tokens + (m.outputTokens ?? 0),
    cache_creation_input_tokens: acc.cache_creation_input_tokens + (m.cacheCreationInputTokens ?? 0),
    cache_read_input_tokens: acc.cache_read_input_tokens + (m.cacheReadInputTokens ?? 0),
  }), { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 });
  // `max > 0` and not `context !== undefined`: a reading that came back with no window size cannot express a
  // percentage either, and a `0`/`0` division would put `NaN` on the wire — which survives no JSON round trip.
  const used = max > 0 ? Math.round((total / max) * 100) : null;
  return {
    total_input_tokens: total,
    total_output_tokens: fold.output_tokens,
    context_window_size: max,
    current_usage: rows.length > 0 ? fold : null,
    used_percentage: used,
    remaining_percentage: used === null ? null : 100 - used,
  };
}

/** The whole payload. Key ORDER is upstream's own (`H0b`'s return literal), because the JSON a user's script
 *  pipes through `jq` reads better in it and it costs nothing to preserve. */
export function buildStatusLinePayload(snapshot: StatusLineSnapshot): StatusLinePayload {
  const id = snapshot.model ?? "";
  const session = snapshot.usage?.session;
  const projectDir = snapshot.projectDir ?? snapshot.cwd;
  return {
    ...(snapshot.sessionId ? { session_id: snapshot.sessionId } : {}),
    cwd: snapshot.cwd,
    ...(snapshot.sessionName ? { session_name: snapshot.sessionName } : {}),
    model: { id, display_name: snapshot.modelDisplayName ?? id },
    workspace: { current_dir: snapshot.cwd, project_dir: projectDir, added_dirs: [...(snapshot.addedDirs ?? [])] },
    version: snapshot.version ?? CCX_VERSION,
    output_style: { name: snapshot.outputStyle ?? "default" },
    // Every one of the five is a real `session.usage()` column, so `cost` needs no divergence note — but it
    // is ZEROED rather than omitted before the first reading, because upstream's block is unconditional and
    // a script doing arithmetic on it must not have to guard the key.
    cost: {
      total_cost_usd: session?.total_cost_usd ?? 0,
      total_duration_ms: session?.total_duration_ms ?? 0,
      total_api_duration_ms: session?.total_api_duration_ms ?? 0,
      total_lines_added: session?.total_lines_added ?? 0,
      total_lines_removed: session?.total_lines_removed ?? 0,
    },
    context_window: contextWindow(snapshot),
    exceeds_200k_tokens: (snapshot.context?.totalTokens ?? 0) > STATUS_LINE_200K,
    // WAVE C TASK 11 (EP-C6): upstream's `...Fk(y) && { effort: { level: _5(y, p) } }` — CONDITIONAL, and in
    // upstream's own slot (after `exceeds_200k_tokens`, before `thinking`; the `fast_mode` key that sits
    // between them upstream is one of the blocks ccx has no producer for). The spread idiom is the same one
    // the two conditional keys above use: a script's contract is that the key is ABSENT, not `null`, when the
    // model has no effort axis — and `JSON.stringify` dropping an `undefined` value is not enough, because a
    // consumer reading the object through anything else would still see the key.
    ...(snapshot.effort ? { effort: { level: snapshot.effort } } : {}),
    thinking: { enabled: snapshot.thinkingEnabled },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// WAVE C TASK 10 (EP-C2b), PART 2 — THE RENDER TRANSFORM (annex §C2.6: `m3f` L484968, `wc` L182424).
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
//
// Upstream renders `<Text dimColor><wc>{line}</wc></Text>`: `wc` PARSES the script's ANSI into styled spans
// and the parent's `dimColor` then sets `dim = !0` on every one of them, so the script's colours survive and
// dim is forced on top of all of them.
//
// CCX CANNOT REACH THAT THROUGH INK'S PROPS, and the reason is one line of chalk. `<Text dimColor>` wraps the
// whole string in `\x1b[2m … \x1b[22m` and re-opens itself only around its OWN close code (`22`); a script
// that emits `\x1b[0m` — which is what every coloured shell prompt does — clears FAINT along with the colour
// and everything after it renders bright. So the transform is done in BYTES here and handed to a bare
// `<Text>` (the `preStyled` seam F3 Task 1 established for exactly this class of problem): dim is opened at
// the head of the line and RE-OPENED after every escape the script emits, which is the byte-level statement
// of "dim forced onto every span".
//
// This is a DIVERGENCE IN MECHANISM AND NOT IN OUTPUT: upstream's per-span `dim` and this file's re-opened
// `\x1b[2m` paint the same cells. It is recorded because the two look nothing alike in source.

/** `E0b` (L484968) — SGR sequences and OSC-8 hyperlink introducers, the two escape classes upstream replays. */
const SGR_OR_OSC8 = /\x1b\[[\d;]*m|\x1b\]8;[^\x07\x1b]*(?:\x07|\x1b\\)/g;
/** Only CSI-m sequences END A SPAN, so only they need dim re-opened after them; an OSC-8 introducer changes
 *  no attribute and gets none. */
const SGR_ONLY = /\x1b\[[\d;]*m/g;
const DIM_ON = "\x1b[2m", ALL_OFF = "\x1b[0m";

/** `m3f` (L484968): line 0 verbatim, then every later line prefixed with the concatenation of every escape
 *  emitted on ALL the lines before it. A single-line string is returned unchanged, as upstream's early return
 *  does — the prefixing only exists because a `<Text>` per line resets the terminal between them. */
export function carryForwardSgr(text: string): string[] {
  const lines = text.split("\n");
  if (lines.length === 1) return lines;
  const out = [lines[0]];
  let carried = "";
  for (let i = 1; i < lines.length; i++) {
    carried += (lines[i - 1].match(SGR_OR_OSC8) ?? []).join("");
    out.push(carried + lines[i]);
  }
  return out;
}

/** `wc` + the parent `dimColor`, as bytes. Closes with a full reset so a dim (or a colour, or an unbalanced
 *  bold the script forgot) cannot bleed into the footer row Ink draws underneath. */
export function forceDim(line: string): string {
  if (line === "") return "";
  return `${DIM_ON}${line.replace(SGR_ONLY, (m) => m + DIM_ON)}${ALL_OFF}`;
}

/** The script's normalized stdout → one finished string per rendered row. The ONE function `Footer.tsx`
 *  calls; the two halves above are exported only so each can be pinned on its own. */
export function statusLineRows(text: string): string[] {
  if (text === "") return [];
  return carryForwardSgr(text).map(forceDim);
}
