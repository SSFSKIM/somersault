// tui/src/statusLine.ts — Wave C Task 9 (EP-C2a): the statusLine hook's three moving parts — resolving the
// setting, running the command, and deciding WHEN to run it — lifted out of React so all three are testable
// objects the mount site merely drives. Canon: annex §C2.1 (the zod schema at bundle L42035), §C2.4 (`b0b`'s
// triggers, L484860) and §C2.5 (`B8s`'s execution, L366191). WAVE C TASK 10 ADDED THE LAST TWO PURE PIECES at
// the foot of this file — the stdin payload (§C2.2-§C2.3) and the render transform (§C2.6) — so the only
// statusLine code that touches React is the handful of `<Text>` lines in `Footer.tsx`. Nothing here imports
// React or Ink.
//
// THE ONE THING TO UNDERSTAND ABOUT THIS FEATURE: **every failure is silence.** Nonzero exit, spawn failure,
// timeout and thrown exception all produce `undefined` — the user is never shown an error message or a
// stack trace, because the status line is chrome and chrome that shouts about its own plumbing is worse
// than chrome that says nothing. stderr exists only for the debug log. This is upstream's design (`B8s` has
// one `try` and three silent returns), and it is the reason `runStatusLine` NEVER rejects: a caller cannot
// forget to catch what is never thrown.
//
// WHAT SILENCE MEANS WAS DECIDED THE OTHER WAY IN WAVE 2 TASK 6 (s2qa6-06, canon Q4). §C2.5's annex says
// both "the previous `statusLineText` is not overwritten" and "`state.statusLineText` is set to that value
// including `undefined`"; Wave C read the ambiguity the first way and encoded it in the type. The 2.1.220
// bundle settles it the second way and leaves no room: `y0b` (L484821) forwards the runner's `undefined` to
// `onResult` UNCONDITIONALLY (the truthiness guard beside it gates telemetry, not the state write),
// `onResult` (L484883) writes it straight into app state, and the render (L484981) collapses the slot to
// `null` on a falsy `statusLineText` in the main-screen renderer. So the row is REMOVED on any failure —
// and on a script that exits 0 with empty stdout, which reaches the same `undefined`. `onText` is therefore
// called with `string | undefined`, and the caller's job is to publish whichever it gets.
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
/** W2 T6 FIX / SPEC D-W11 — the ceiling on the mount-time `getContextUsage()` the BOOT run waits for.
 *
 *  Sized off a measurement, exactly as `ACCOUNT_LABEL_BUDGET_MS` (`cli/main.ts`) is: the Task 6 review timed
 *  `getContextUsage()` at **~1.2 s warm** — four times the 300 ms debounce — so the shipped shape (fire the
 *  read, run the boot on the debounce) could only ever be TWO runs, the first of them carrying
 *  `context_window_size: 0`. Gating the boot run on the read fixes that; racing the gate against this cap is
 *  what stops a control call that never answers from suppressing the row for the rest of the session.
 *  1500 ms because it clears the measured warm case with room for a cold one and matches the one other
 *  first-paint budget in the codebase. The cost when the cap is LOST is the honest one: the boot run goes out
 *  with a zero window, and the first turn end corrects it. */
export const STATUS_LINE_MOUNT_CONTEXT_BUDGET_MS = 1500;

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
  /** `useEffect(() => (M(), …), [])` (L484931) — the boot run, and the point at which the `refreshInterval`
   *  poll (if any) starts ticking.
   *
   *  IT GOES THROUGH THE DEBOUNCE, AND UPSTREAM'S DOES NOT (W2 T6, s2qa6-22's real half). Upstream can
   *  afford an immediate undebounced run because at its mount every input the payload wants is already
   *  known synchronously — `mainLoopModel`, `permissionMode`, the context window size are all local reads.
   *  ccx's are not: the model catalog, the host's first `state` frame, the effort capability and the
   *  mount-time `getContextUsage()` all land as promises a tick or two later, each one a delta on the same
   *  list, so an immediate run published a knowably incomplete payload and was superseded ~300 ms later.
   *  QA-6 measured exactly that: **two runs per boot** where canon runs once. Routing the boot through the
   *  same trailing window makes the observable cadence canon's (one run per settled moment) at the cost of
   *  ccx's first paint being one debounce late — which is nothing next to a script's own fork-and-exec.
   *
   *  THE DEBOUNCE ALONE WAS NOT ENOUGH (Task 6 review, spec D-W11). The slowest of those late inputs is the
   *  mount-time `getContextUsage()`, measured at ~1.2 s warm against a 300 ms window — so a real boot still
   *  produced two runs, the first with a zero context window. The MOUNT SITE therefore does not call this at
   *  mount: it calls it when the context read resolves, or when `STATUS_LINE_MOUNT_CONTEXT_BUDGET_MS`
   *  expires, whichever comes first. Everything about the cadence machine stays here; the one thing the
   *  driver cannot know is which of the caller's promises the boot is actually waiting on. */
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
 *  carries the state at its own moment; `onText` receives the run's OUTCOME — the script's text, or
 *  `undefined` for every failure there is (see the file header: the row comes down). */
export function createStatusLineDriver(cfg: StatusLineConfig, buildPayload: () => string, onText: (t: string | undefined) => void, deps: StatusLineDriverDeps = {}): StatusLineDriver {
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
      // W2 T6: `undefined` is PUBLISHED, not swallowed (`y0b` L484821 forwards it unconditionally). The two
      // guards above are still the whole filter — a superseded run's late `undefined` must not take down a
      // successor's good row.
      try { onText(text); } catch (e) { debug(`StatusLine onText failed: ${e}`); }
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
      schedule();                                          // W2 T6 — see the interface doc: one run per boot
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
// populate, omitting the conditional fields it cannot". WAVE 2 TASK 6 (EP-D4) re-asked that question of the
// 2.1.220 builder itself (`H0b` L484844 over the shared prefix `Kf` L364980, adjudicated as canon Q3) and
// four of the six stated reasons turned out to be stale. Present now: `session_id`, `transcript_path`,
// `cwd`, `prompt_id`, `session_name`, `model`, `workspace`, `version`, `output_style`, `cost`,
// `context_window`, `exceeds_200k_tokens`, `fast_mode`, `effort`, `thinking`, `rate_limits`. Still absent,
// each for a reason that survived:
//   · `permission_mode` — canon DROPS it. `H0b` calls `Kf()` bare, so `Kf`'s own `permission_mode`,
//     `agent_id` and `effort` are `undefined` and `JSON.stringify` removes them. The hook-input shape
//     declares the key; the statusLine payload does not carry it, and neither does this one.
//   · `vim`, `agent`, `remote`, `pr`, `worktree` — no ccx counterpart exists to report.
// Upstream's own `...x && {}` idiom is what keeps the CONDITIONAL keys genuinely absent rather than
// present-and-`undefined`: `JSON.stringify` drops an `undefined` value, but a script that reads the payload
// through anything else would see the key, and "absent" is the contract.
//
// THE THREE MOMENTS the conditional keys are pinned against (canon Q3's per-moment table) are first paint /
// after a turn / after `/clear`, and ccx matches canon on all of them for `session_id` and `fast_mode`,
// and matches it from the first turn on for `transcript_path` and `prompt_id`. The one recorded gap:
// canon has `transcript_path` from process start (it DERIVES the path from the session id), while ccx
// LEARNS it from a `UserPromptSubmit` hook and therefore has none before the first prompt of a
// conversation. Deriving it would mean re-implementing the SDK's project-slug rule and handing a script a
// path it may `cat`; an absent key a script can test for is the honest answer until the SDK exposes one.

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
  /** W2 T6: `false` when plan rate limits do not apply at all — an API key, Bedrock/Vertex, or a token with
   *  no profile scope (`claude setup-token`, which is THIS project's own credential). The SDK then sends
   *  `rate_limits: null`, and the payload key is omitted. */
  rate_limits_available?: boolean;
  rate_limits?: Partial<Record<StatusLineRateWindow, { utilization?: number | null; resets_at?: string | null } | null>> | null;
}

/** The two windows canon's payload carries (`H0b`'s `k`). `session.usage()` returns more of them
 *  (`seven_day_oauth_apps`, `seven_day_opus`, `seven_day_sonnet`, `model_scoped`, `extra_usage` — see
 *  `usageFormat.ts`, which renders the lot); the STATUS LINE contract is these two, so a script's key set
 *  cannot grow under it when the account gains a bucket. */
export type StatusLineRateWindow = "five_hour" | "seven_day";
const RATE_WINDOWS: readonly StatusLineRateWindow[] = ["five_hour", "seven_day"];

/** ccx state at the moment of ONE run. Everything optional is optional because it genuinely may not exist
 *  yet — a session with no id (pre-first-turn), no model (an `attach` client that has not seen a turn end),
 *  no context reading and no usage reading. */
export interface StatusLineSnapshot {
  /** The conversation's identity. W2 T6 / spec D-W4 made this MINT-AND-RECONCILE at the caller: a client
   *  uuid at launch and at every conversation boundary, overwritten by the engine's own id the moment it
   *  lands. It is therefore effectively always present from `useChat` — the conditional spread below stays
   *  because the builder is a pure function other callers may hand a snapshot with nothing to say. */
  sessionId?: string;
  /** W2 T6: the engine's JSONL path, latched from a `UserPromptSubmit` hook input (`BaseHookInput`). Absent
   *  until the first prompt of the conversation — see the divergence note at the head of this section. */
  transcriptPath?: string;
  /** W2 T6: the hook input's `prompt_id`, the uuid correlating one prompt with everything it causes. Canon
   *  drops the key until the first prompt and drops it AGAIN at `/clear` (`Ot.promptId = null`), which is
   *  exactly what clearing the latch at the conversation boundary reproduces. */
  promptId?: string;
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

export interface StatusLineRateLimits {
  five_hour?: { used_percentage: number; resets_at: string | null };
  seven_day?: { used_percentage: number; resets_at: string | null };
}

export interface StatusLinePayload {
  session_id?: string;
  transcript_path?: string;
  cwd: string;
  prompt_id?: string;
  /** Canon's own slot, which is HERE and not down beside `fast_mode` (Task 6 review, MINOR 3): `mh()`'s
   *  object literal owns the `effort` key immediately after `prompt_id`, and the later `...Fk(y) && {…}`
   *  spread that fills it in updates the VALUE at the existing key rather than appending a new one — so
   *  canon's emitted order puts it fourth. Verified against the shipped 2.1.220 bundle. */
  effort?: { level: "low" | "medium" | "high" | "xhigh" | "max" };
  session_name?: string;
  model: { id: string; display_name: string };
  workspace: { current_dir: string; project_dir: string; added_dirs: string[] };
  version: string;
  output_style: { name: string };
  cost: { total_cost_usd: number; total_duration_ms: number; total_api_duration_ms: number; total_lines_added: number; total_lines_removed: number };
  context_window: StatusLineContextWindow;
  exceeds_200k_tokens: boolean;
  fast_mode: boolean;
  thinking: { enabled: boolean };
  rate_limits?: StatusLineRateLimits;
}

/** `H0b`'s `k` (L484844), over `session.usage()` instead of upstream's response-header cache.
 *
 *  ONE UNIT DIVERGENCE, and it is a correction rather than a drift: canon writes
 *  `used_percentage: w.five_hour.utilization * 100` because ITS `utilization` comes from the
 *  `anthropic-ratelimit-unified-5h-utilization` header as a 0-1 fraction. The SDK's control response
 *  declares its own `utilization` as "Percentage of the window used, 0-100" (sdk.d.ts,
 *  `SDKControlGetUsageResponse`), so multiplying here would render a 42% window as 4200%. `usageFormat.ts`
 *  already learned this the hard way — its own comment forbids re-introducing unit inference. Same key,
 *  same meaning, no scale factor.
 *
 *  THE WHOLE-BLOCK GATE IS CANON'S: the key is OMITTED — `...(k.five_hour || k.seven_day) && {…}` — when the
 *  credential cannot see the buckets at all (`rate_limits_available === false`), when no reading has landed
 *  yet, or when neither window has anything to say.
 *
 *  THE PER-WINDOW GATE IS A NAMED DIVERGENCE (Task 6 review, MINOR 4), not canon's own spread. Canon gates
 *  each window on the window OBJECT's truthiness and then reads `utilization` out of it, so a window that is
 *  present with a `null` reading emits `used_percentage: 0` — a real 0% and "we have not been told" printed
 *  identically, and 0% is the reading a script is most likely to act on ("plenty of headroom"). ccx gates on
 *  `typeof utilization === "number"` instead, so an unread window is ABSENT rather than a fabricated zero.
 *  That is the same hidden-until-measured rule Wave S applied to the context percentage, and it is kept
 *  deliberately: the payload's contract already lets a script test for an absent key, and there is no way for
 *  it to test a zero that means "unknown". */
function rateLimits(usage: StatusLineUsage | undefined): StatusLineRateLimits | undefined {
  if (!usage || usage.rate_limits_available === false || !usage.rate_limits) return undefined;
  const out: StatusLineRateLimits = {};
  for (const key of RATE_WINDOWS) {
    const w = usage.rate_limits[key];
    if (typeof w?.utilization !== "number") continue;
    out[key] = { used_percentage: w.utilization, resets_at: w.resets_at ?? null };
  }
  return out.five_hour || out.seven_day ? out : undefined;
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
  const limits = rateLimits(snapshot.usage);
  return {
    ...(snapshot.sessionId ? { session_id: snapshot.sessionId } : {}),
    ...(snapshot.transcriptPath ? { transcript_path: snapshot.transcriptPath } : {}),
    cwd: snapshot.cwd,
    ...(snapshot.promptId ? { prompt_id: snapshot.promptId } : {}),
    // WAVE C TASK 11 (EP-C6): upstream's `...Fk(y) && { effort: { level: _5(y, p) } }` — CONDITIONAL, and in
    // upstream's own slot, which the Task 6 review corrected to HERE: `mh()`'s literal declares `effort`
    // right after `prompt_id`, and the conditional spread that fills it updates that key's value rather than
    // moving it to the end. The spread idiom is the same one the conditional keys above use: a script's
    // contract is that the key is ABSENT, not `null`, when the model has no effort axis — and
    // `JSON.stringify` dropping an `undefined` value is not enough, because a consumer reading the object
    // through anything else would still see the key.
    ...(snapshot.effort ? { effort: { level: snapshot.effort } } : {}),
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
    // W2 T6: upstream's own slot, filled with the only honest value. `fast_mode` is `Options.fastMode`
    // (sdk.d.ts) and ccx exposes no control for it, so the session never runs in it — and canon emits the
    // key UNCONDITIONALLY as a boolean (`r`, from `Ve(K => K.fastMode ?? !1)`), never omits it. A literal
    // rather than a snapshot field precisely because there is nothing to snapshot: the day ccx wires
    // `fastMode` into `resolveOptions` this becomes a real read with no consumer change.
    fast_mode: false,
    thinking: { enabled: snapshot.thinkingEnabled },
    ...(limits ? { rate_limits: limits } : {}),
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
