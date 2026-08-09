// tui/src/statusLine.ts — Wave C Task 9 (EP-C2a): the statusLine hook's three moving parts — resolving the
// setting, running the command, and deciding WHEN to run it — lifted out of React so all three are testable
// objects the mount site merely drives. Canon: annex §C2.1 (the zod schema at bundle L42035), §C2.4 (`b0b`'s
// triggers, L484860) and §C2.5 (`B8s`'s execution, L366191). Task 10 adds the payload builder and the render
// slot; nothing here imports React or Ink.
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
