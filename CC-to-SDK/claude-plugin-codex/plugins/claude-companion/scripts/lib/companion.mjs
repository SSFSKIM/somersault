// Companion core: wires the job store (state.mjs/tracked-jobs.mjs/job-control.mjs) + the
// appserver client (appserver-client.mjs) into the tool defs mcp-stdio.mjs serves. Thin by
// design — job mechanics stay in the Task 10 modules, appserver mechanics in Task 11.
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveAppserverCommand, spawnAppServer as defaultSpawnAppServer } from "./appserver-client.mjs";
import { readJsonFile } from "./fs.mjs";
import { collectReviewContext, resolveReviewTarget } from "./git.mjs";
import { interpolateTemplate, loadPromptTemplate } from "./prompts.mjs";
import { parseStructuredOutput, renderReviewResult, renderStatusReport, renderStoredJobResult } from "./render.mjs";
import { generateJobId, getConfig, listJobs, resolveJobLogFile, setConfig, upsertJob, writeJobFile } from "./state.mjs";
import { appendLogLine, createJobLogFile, createJobRecord, nowIso, runTrackedJob } from "./tracked-jobs.mjs";
import {
  buildSingleJobSnapshot,
  buildStatusSnapshot,
  readStoredJob,
  resolveCancelableJob,
  resolveResultJob,
  sortJobsNewestFirst
} from "./job-control.mjs";

export const MODEL_ALIASES = { opus: "claude-opus-4-8", sonnet: "claude-sonnet-5", haiku: "claude-haiku-4-5-20251001", fable: "claude-fable-5" };
export const VALID_EFFORTS = ["low", "medium", "high", "xhigh", "max"];

// plugins/claude-companion/scripts/lib/companion.mjs -> plugins/claude-companion (where prompts/ and schemas/ live).
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const REVIEW_SCHEMA_PATH = path.join(ROOT_DIR, "schemas", "review-output.schema.json");
const REVIEW_KINDS = {
  review: { templateName: "claude-review", reviewLabel: "Review", jobPrefix: "review", kind: "review" },
  "adversarial-review": {
    templateName: "adversarial-review",
    reviewLabel: "Adversarial Review",
    jobPrefix: "advrev",
    kind: "adversarial-review"
  }
};

// At most this many rescue jobs run in the background concurrently (per companion instance);
// past that, new jobs are persisted as "queued" and drained FIFO as running ones finish.
const MAX_CONCURRENT_BACKGROUND = 3;

const WORKER_MISSING_TEXT = `Claude worker is not available. Install it with:
  npm install -g /path/to/CC-to-SDK/app-server
or point at an already-built copy without installing, e.g.:
  CLAUDE_COMPANION_APPSERVER="node /path/to/app-server/dist/bin.js"
If "node" isn't found (Codex's own launch environment often has a minimal PATH), use an absolute
node path instead — e.g. Codex Desktop's own bundled runtime:
  CLAUDE_COMPANION_APPSERVER="~/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /path/to/app-server/dist/bin.js"
then call the setup tool.`;

// Foreground `wait:true` calls never hang forever: past this ceiling we return early and tell the
// caller to poll instead, while the run itself keeps going in the background (runTrackedJob still
// persists its own completion/failure — nothing is cancelled). Kept safely under .mcp.json's
// tool_timeout_sec (1200s) so this always wins the race and reports something useful, instead of
// Codex's host silently killing the call with no diagnostic left behind.
const FOREGROUND_WAIT_TIMEOUT_MS = 15 * 60 * 1000;

// Exported so tests can drive the bail-out path directly with a short timeoutMs instead of
// waiting out FOREGROUND_WAIT_TIMEOUT_MS for real.
export async function runForegroundWait(cwd, job, runner, { timeoutMs = FOREGROUND_WAIT_TIMEOUT_MS } = {}) {
  const settle = runTrackedJob(job, runner);
  const timedOut = Symbol("foreground-wait-timeout");
  let timer;
  // A bare setTimeout's handle keeps the event loop (and, in a test process, the whole run) alive
  // for the full timeoutMs even after `settle` already won the race — clearTimeout below is not
  // optional cleanup, it's what lets the process exit once the real work is done.
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(timedOut), timeoutMs);
  });
  const winner = await Promise.race([settle, timeout]);
  clearTimeout(timer);
  if (winner !== timedOut) {
    return { timedOut: false, execution: winner };
  }
  // Not cancelling `settle` — it keeps running and will persist its own completion/failure.
  settle.catch(() => {});
  upsertJob(cwd, { id: job.id, note: `foreground wait exceeded ${Math.round(timeoutMs / 60000)}m; continuing in background` });
  return { timedOut: true, execution: null };
}

export function normalizeModel(m) {
  if (Object.prototype.hasOwnProperty.call(MODEL_ALIASES, m)) return MODEL_ALIASES[m];
  if (typeof m === "string" && m.startsWith("claude-")) return m;
  throw new Error(`Unknown model "${m}". Use opus|sonnet|haiku|fable or a full claude-* model id.`);
}

function formatAge(isoOrNull) {
  const ms = Date.now() - Date.parse(isoOrNull ?? "");
  if (!Number.isFinite(ms) || ms < 0) return "recently";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}

// Newest job in this repo that finished (not queued/running) with a stored threadId, tagged as
// a rescue ("task") job — the thread a bare `rescue` call could offer to resume.
function findResumeCandidate(cwd) {
  const jobs = sortJobsNewestFirst(listJobs(cwd));
  return (
    jobs.find(
      (job) => job.jobClass === "task" && job.threadId && job.status !== "queued" && job.status !== "running"
    ) ?? null
  );
}

function formatResumeOffer(candidate) {
  const age = formatAge(candidate.completedAt ?? candidate.updatedAt ?? candidate.createdAt);
  return `A recent Claude rescue thread exists for this repo (job ${candidate.id}, ${age}). Call rescue again with resume:true to continue it, or fresh:true to start over. Ask the user if unsure.`;
}

// Single-flight guard: without it, two callers that both observe companion.client === null
// before either await resolves (realistic — background rescue calls fire without waiting, and
// an MCP host can pipeline concurrent tools/call on one stdio pipe) would each independently
// spawnAppServer(), orphaning whichever child loses the race to set companion.client. In-flight
// spawns are tracked on companion.spawning so concurrent callers await the SAME promise; it's
// cleared on settle (success or failure) so a later call can retry after a failed spawn.
export async function ensureClient(companion) {
  if (companion.client && companion.client.alive()) return companion.client;
  if (!companion.spawning) {
    companion.spawning = companion
      .spawnAppServer({ cwd: companion.cwd, env: companion.env })
      .then((client) => {
        companion.client = client;
        companion.spawning = null;
        return client;
      })
      .catch((error) => {
        companion.spawning = null;
        throw error;
      });
  }
  return companion.spawning;
}

async function runRescueTurn({ client, cwd, jobId, model, effort, write, prompt, resumeThreadId }) {
  upsertJob(cwd, { id: jobId, phase: "starting-thread" });
  const { threadId } = resumeThreadId
    ? await client.threadResume({ threadId: resumeThreadId, cwd, model, effort, write })
    : await client.threadStart({ cwd, model, effort, write });
  // Persisted as soon as it's known (not just at completion) so the cancel tool has a live
  // threadId to interrupt while the turn is still in flight.
  upsertJob(cwd, { id: jobId, threadId, phase: "running-turn" });
  const turn = await client.runTurn({ threadId, prompt });
  const rendered = turn.finalText || (turn.commentary ?? []).join("\n");
  return {
    exitStatus: turn.status === "completed" ? 0 : 1,
    threadId,
    turnId: turn.turnId,
    payload: { finalText: turn.finalText, commentary: turn.commentary, usage: turn.usage, status: turn.status },
    rendered,
    summary: rendered.slice(0, 160)
  };
}

// review/adversarial_review: resolve the git target (git.mjs), collect diff/context
// (collectReviewContext's inline-diff-vs-self-collect sizing rule), build the schema-JSON prompt
// (claude-review.md / adversarial-review.md), run a read-only turn, then parse+render. The
// appserver doesn't yet surface the SDK's structured_output field (see cc-codex-appserver's
// runTurn), so `outputSchema` is still passed (forward-compatible, harmless no-op today) but the
// prompt's own "output strictly JSON" instruction is what actually has to carry the contract; a
// non-JSON finalText degrades to renderReviewResult's raw-fallback branch rather than crashing.
function buildReviewPrompt(reviewKind, context, focusText) {
  const template = loadPromptTemplate(ROOT_DIR, reviewKind.templateName);
  return interpolateTemplate(template, {
    TARGET_LABEL: context.target.label,
    REVIEW_INPUT: context.content,
    REVIEW_COLLECTION_GUIDANCE: context.collectionGuidance,
    USER_FOCUS: focusText || "No extra focus provided."
  });
}

async function runReviewTurn({ client, cwd, jobId, target, reviewKind, focusText }) {
  upsertJob(cwd, { id: jobId, phase: "starting-thread" });
  const context = collectReviewContext(cwd, target);
  const prompt = buildReviewPrompt(reviewKind, context, focusText);
  const { threadId } = await client.threadStart({
    cwd,
    write: false,
    outputSchema: readJsonFile(REVIEW_SCHEMA_PATH)
  });
  // See runRescueTurn: persisted immediately so cancel can target this turn while it's in flight.
  upsertJob(cwd, { id: jobId, threadId, phase: "running-turn" });
  const turn = await client.runTurn({ threadId, prompt });
  const parsed = parseStructuredOutput(turn.finalText, { failureMessage: "Claude did not return a final message." });
  const rendered = renderReviewResult(parsed, { reviewLabel: reviewKind.reviewLabel, targetLabel: context.target.label });

  return {
    exitStatus: turn.status === "completed" ? 0 : 1,
    threadId,
    turnId: turn.turnId,
    payload: {
      result: parsed.parsed,
      rawOutput: parsed.rawOutput,
      parseError: parsed.parseError,
      target,
      contextSummary: context.summary
    },
    rendered,
    summary: parsed.parsed?.summary ?? parsed.parseError ?? rendered.slice(0, 160)
  };
}

// Runs a background rescue job now: bumps the in-flight counter, fires runTrackedJob without
// awaiting the caller, and always resolves (never rejects — runTrackedJob already persisted any
// failure to the job store, so there's nothing left for the caller to react to; swallowing here
// keeps this an intentional fire-and-forget instead of an unhandled-rejection warning).
// activeRuns lets cancel() await a specific job's in-flight runTrackedJob settle-and-persist before
// stamping its own "cancelled" write — otherwise the turn's own natural completion write (racing
// the interrupt) could land after cancel's and clobber "cancelled" back to "failed"/"completed".
function runBackgroundNow(companion, job, runner) {
  companion.runningBackground += 1;
  const settle = runTrackedJob(job, runner)
    .catch(() => {})
    .finally(() => {
      companion.runningBackground -= 1;
      companion.activeRuns.delete(job.id);
      drainQueue(companion);
    });
  companion.activeRuns.set(job.id, settle);
  return settle;
}

function drainQueue(companion) {
  if (companion.runningBackground >= MAX_CONCURRENT_BACKGROUND) return;
  const next = companion.queue.shift();
  if (!next) return;
  // upsertJob merges (doesn't replace), and runTrackedJob's running/completed/failed patches never
  // carry a `note` key — so the "waiting for a free slot" note stamped by startBackground would
  // otherwise survive merged-in forever. Clear it explicitly the instant this job leaves the queue.
  upsertJob(next.job.workspaceRoot, { id: next.job.id, note: null });
  void runBackgroundNow(companion, next.job, next.runner);
}

function startBackground(companion, job, runner) {
  if (companion.runningBackground >= MAX_CONCURRENT_BACKGROUND) {
    upsertJob(job.workspaceRoot, { ...job, status: "queued", note: `waiting for a free background slot (max ${MAX_CONCURRENT_BACKGROUND} concurrent)` });
    companion.queue.push({ job, runner });
    return;
  }
  void runBackgroundNow(companion, job, runner);
}

async function rescueHandler(companion, args = {}) {
  const cwd = args.cwd ?? companion.cwd ?? process.cwd();
  const prompt = typeof args.prompt === "string" ? args.prompt : "";
  if (!prompt.trim()) throw new Error('rescue: "prompt" is required.');

  const wait = args.wait === true;
  const resume = args.resume === true;
  const fresh = args.fresh === true;
  const effort = args.effort;
  const write = args.write ?? true;
  const model = args.model ? normalizeModel(args.model) : undefined;

  const candidate = findResumeCandidate(cwd);
  if (candidate && !resume && !fresh) {
    return formatResumeOffer(candidate);
  }

  try {
    const client = await ensureClient(companion);
    const jobId = generateJobId("task");
    const logFile = createJobLogFile(cwd, jobId, "Claude rescue task");
    const job = createJobRecord({
      id: jobId,
      workspaceRoot: cwd,
      jobClass: "task",
      kind: "task",
      prompt,
      model: model ?? null,
      effort: effort ?? null,
      logFile
    });
    const resumeThreadId = resume ? candidate?.threadId ?? null : null;
    const runner = () => runRescueTurn({ client, cwd, jobId, model, effort, write, prompt, resumeThreadId });

    if (wait) {
      const { timedOut, execution } = await runForegroundWait(cwd, job, runner);
      if (timedOut) {
        return `Still running in the background as job ${jobId} after ${Math.round(FOREGROUND_WAIT_TIMEOUT_MS / 60000)}m — poll with the status tool or fetch output with the result tool once it finishes.`;
      }
      return `${execution.rendered}\n\nContinue in this thread later with rescue {resume:true}. (job ${jobId})`;
    }

    startBackground(companion, job, runner);
    return `Started background job ${jobId}. Poll with the status tool; fetch output with the result tool.`;
  } catch (error) {
    if (error && error.code === "WORKER_NOT_FOUND") return WORKER_MISSING_TEXT;
    throw error;
  }
}

async function reviewToolHandler(companion, kindKey, args = {}) {
  const cwd = args.cwd ?? companion.cwd ?? process.cwd();
  const reviewKind = REVIEW_KINDS[kindKey];
  // resolveReviewTarget throws synchronously for a non-git cwd (ensureGitRepository) — that's
  // deliberately allowed to propagate as a rejected promise rather than being swallowed, same as
  // any other unexpected error below.
  const target = resolveReviewTarget(cwd, { base: args.base, scope: args.scope });
  const wait = args.wait === true;
  const focusText = typeof args.focus === "string" ? args.focus.trim() : "";

  try {
    const client = await ensureClient(companion);
    const jobId = generateJobId(reviewKind.jobPrefix);
    const logFile = createJobLogFile(cwd, jobId, `Claude ${reviewKind.kind}`);
    const job = createJobRecord({
      id: jobId,
      workspaceRoot: cwd,
      jobClass: "review",
      kind: reviewKind.kind,
      kindLabel: reviewKind.kind,
      prompt: focusText || target.label,
      logFile
    });
    const runner = () => runReviewTurn({ client, cwd, jobId, target, reviewKind, focusText });

    if (wait) {
      const { timedOut, execution } = await runForegroundWait(cwd, job, runner);
      if (timedOut) {
        return `Still running in the background as job ${jobId} after ${Math.round(FOREGROUND_WAIT_TIMEOUT_MS / 60000)}m — poll with the status tool or fetch output with the result tool once it finishes.`;
      }
      return execution.rendered;
    }

    startBackground(companion, job, runner);
    return `Started background job ${jobId}. Poll with the status tool; fetch output with the result tool.`;
  } catch (error) {
    if (error && error.code === "WORKER_NOT_FOUND") return WORKER_MISSING_TEXT;
    throw error;
  }
}

function readJobIdArg(args) {
  return typeof args.job_id === "string" && args.job_id.trim() ? args.job_id.trim() : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const STATUS_WAIT_INTERVAL_MS = 2000;
const STATUS_WAIT_TIMEOUT_MS = 240000;

function isActiveStatus(status) {
  return status === "queued" || status === "running";
}

// Polls a single job (buildSingleJobSnapshot) until it leaves queued/running, or gives up once
// timeoutMs has elapsed — never hangs forever on a job that's stuck.
export async function pollSingleJobUntilTerminal(cwd, jobId, options = {}) {
  const intervalMs = options.intervalMs ?? STATUS_WAIT_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? STATUS_WAIT_TIMEOUT_MS;
  const start = Date.now();
  let snap = buildSingleJobSnapshot(cwd, jobId);
  while (isActiveStatus(snap.job.status) && Date.now() - start < timeoutMs) {
    await sleep(intervalMs);
    snap = buildSingleJobSnapshot(cwd, jobId);
  }
  return snap;
}

// Same idea for the no-job_id aggregate view: polls buildStatusSnapshot until nothing is
// queued/running, or the timeout elapses.
export async function pollStatusUntilIdle(cwd, options = {}) {
  const intervalMs = options.intervalMs ?? STATUS_WAIT_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? STATUS_WAIT_TIMEOUT_MS;
  const start = Date.now();
  let report = buildStatusSnapshot(cwd);
  while (report.running.length > 0 && Date.now() - start < timeoutMs) {
    await sleep(intervalMs);
    report = buildStatusSnapshot(cwd);
  }
  return report;
}

// Reuses renderStatusReport (Task 13) for the single-job view too, by placing the one job into
// whichever bucket (running vs. latestFinished) renderStatusReport already knows how to render —
// same tested markdown shape, no new render surface needed.
function renderSingleJobStatus(cwd, snap) {
  const config = getConfig(cwd);
  const active = isActiveStatus(snap.job.status);
  return renderStatusReport({
    config,
    running: active ? [snap.job] : [],
    latestFinished: active ? null : snap.job,
    recent: [],
    needsReview: Boolean(config.stopReviewGate)
  });
}

async function statusHandler(companion, args = {}) {
  const cwd = args.cwd ?? companion.cwd ?? process.cwd();
  const jobId = readJobIdArg(args);
  const wait = args.wait === true;

  if (jobId) {
    const snap = wait ? await pollSingleJobUntilTerminal(cwd, jobId) : buildSingleJobSnapshot(cwd, jobId);
    return renderSingleJobStatus(cwd, snap);
  }

  const report = wait ? await pollStatusUntilIdle(cwd) : buildStatusSnapshot(cwd);
  return renderStatusReport(report);
}

async function resultHandler(companion, args = {}) {
  const cwd = args.cwd ?? companion.cwd ?? process.cwd();
  const jobId = readJobIdArg(args);
  const { workspaceRoot, job } = resolveResultJob(cwd, jobId);
  const storedJob = readStoredJob(workspaceRoot, job.id);
  return renderStoredJobResult(job, storedJob);
}

// Drops a (possibly wedged) worker connection: nulls the shared reference first so a concurrent
// ensureClient() call never hands out a client this function is about to close, then closes it.
// ensureClient() respawns lazily the next time anything needs the worker.
async function dropClient(companion) {
  const client = companion.client;
  companion.client = null;
  if (client) {
    await client.close().catch(() => {});
  }
}

function markJobCancelled(workspaceRoot, job) {
  const completedAt = nowIso();
  const existing = readStoredJob(workspaceRoot, job.id) ?? job;
  const errorMessage = existing.errorMessage ?? "Cancelled by user.";
  writeJobFile(workspaceRoot, job.id, {
    ...existing,
    ...job,
    status: "cancelled",
    phase: "cancelled",
    pid: null,
    completedAt,
    errorMessage
  });
  upsertJob(workspaceRoot, { id: job.id, status: "cancelled", phase: "cancelled", pid: null, completedAt, errorMessage });
  appendLogLine(job.logFile ?? resolveJobLogFile(workspaceRoot, job.id), "Cancelled by user.");
}

// Part A tuning: resolveCancelableJob's snapshot can predate runRescueTurn/runReviewTurn's
// mid-flight upsertJob({threadId}) write (reachable mainly via job-id-less `cancel {}` piped
// right after `rescue`/`review` with no await between them). Re-reading fresh usually finds it
// immediately; this bounds a brief poll for the rest of the cases where it lands a beat later.
const CANCEL_THREADID_POLL_INTERVAL_MS = 120;
const CANCEL_THREADID_POLL_TIMEOUT_MS = 1500;
// Part B: cancel must return promptly no matter what — this is the hard ceiling on the final
// "wait for the job's own settle" step, regardless of whether an interrupt was sent.
const CANCEL_SETTLE_TIMEOUT_MS = 5000;

// Re-reads a job's current record straight from the job store (listJobs re-parses state.json on
// every call, same source resolveCancelableJob/buildSingleJobSnapshot already read from) rather
// than trusting a possibly-stale snapshot handed in from earlier in the call.
function readFreshJob(workspaceRoot, jobId) {
  return listJobs(workspaceRoot).find((candidate) => candidate.id === jobId) ?? null;
}

// Polls for a threadId to land on a still-active (queued/running) job before giving up on ever
// sending an interrupt — closes the narrow race window in the Task 14 report ("Narrow
// threadId-assignment race in cancel"): threadStart/threadResume hasn't resolved yet, so
// runRescueTurn/runReviewTurn's own upsertJob({threadId}) hasn't landed.
async function waitForFreshThreadId(workspaceRoot, jobId, initialJob) {
  const start = Date.now();
  let current = initialJob;
  while (!current?.threadId && isActiveStatus(current?.status) && Date.now() - start < CANCEL_THREADID_POLL_TIMEOUT_MS) {
    await sleep(CANCEL_THREADID_POLL_INTERVAL_MS);
    current = readFreshJob(workspaceRoot, jobId) ?? current;
  }
  return current;
}

export async function cancelHandler(companion, args = {}) {
  const cwd = args.cwd ?? companion.cwd ?? process.cwd();
  const jobId = readJobIdArg(args);
  const { workspaceRoot, job: snapshotJob } = resolveCancelableJob(cwd, jobId);

  // Queued (never started) job: drop it from the in-memory background queue too, so drainQueue
  // never resurrects it once a slot frees up.
  if (companion.queue) {
    const queueIndex = companion.queue.findIndex((entry) => entry.job.id === snapshotJob.id);
    if (queueIndex !== -1) companion.queue.splice(queueIndex, 1);
  }

  // Part A: don't trust resolveCancelableJob's snapshot for the interrupt decision — re-read fresh,
  // and if threadId is still missing on an otherwise-active job, give it a brief window to land.
  let job = readFreshJob(workspaceRoot, snapshotJob.id) ?? snapshotJob;
  if (!job.threadId && isActiveStatus(job.status)) {
    job = await waitForFreshThreadId(workspaceRoot, snapshotJob.id, job);
  }

  if (job.threadId && companion.client) {
    if (companion.client.alive()) {
      try {
        await companion.client.interrupt({ threadId: job.threadId });
      } catch {
        // RPC failure (unknown thread, dead worker, etc.): fall back to closing the connection.
        await dropClient(companion);
      }
    } else {
      // Already dead: calling interrupt() would send a request nothing will ever reply to (the
      // exit event that rejects pending requests already fired once) — that would hang forever.
      await dropClient(companion);
    }
  }

  // Part B: if this job's own background run is still settling (e.g. the interrupted turn's
  // rejection is mid-flight through runTrackedJob's completion write), wait for it so our
  // "cancelled" write lands last and can't be clobbered back to "failed"/"completed" by that race
  // — but never past CANCEL_SETTLE_TIMEOUT_MS. cancel must always return promptly; if the turn is
  // genuinely still running past the ceiling, its eventual natural completion is handled by
  // runTrackedJob's own already-shipped completion path, not by this call waiting around for it.
  const settle = companion.activeRuns?.get(job.id);
  if (settle) {
    // Matches startBackground/drainQueue's existing defensive pattern: attach a no-op catch so a
    // rejection that arrives after we've already raced past it never becomes an unhandled rejection.
    settle.catch(() => {});
    // clearTimeout matters even for a short ceiling like this one: an uncleared handle keeps a
    // short-lived process (e.g. a test run) alive for the rest of CANCEL_SETTLE_TIMEOUT_MS even
    // after settle already won the race.
    let timer;
    await Promise.race([settle, new Promise((resolve) => { timer = setTimeout(resolve, CANCEL_SETTLE_TIMEOUT_MS); })]);
    clearTimeout(timer);
  }

  markJobCancelled(workspaceRoot, job);
  return `Cancelled job ${job.id}.`;
}

const WORKER_HANDSHAKE_TIMEOUT_MS = 5000;

export function formatAuthStatus(account) {
  if (!account?.authenticated) {
    return "Not authenticated. Run `claude setup-token`, or set CLAUDE_CODE_OAUTH_TOKEN / ANTHROPIC_API_KEY and add it to this plugin's .mcp.json env_vars whitelist.";
  }
  switch (account.method) {
    case "oauth-token":
      return "Claude subscription (OAuth) ✓";
    case "api-key":
      return "API key ✓ (note: shadows OAuth)";
    case "cli-login":
      return "CLI stored login ✓";
    default:
      return "Authenticated (unknown method).";
  }
}

async function setupHandler(companion, args = {}) {
  const cwd = args.cwd ?? companion.cwd ?? process.cwd();
  const lines = ["# Claude Companion Setup", ""];

  const resolved = resolveAppserverCommand(companion.env);
  if (!resolved) {
    lines.push("Worker: not found.");
    lines.push(WORKER_MISSING_TEXT);
  } else {
    lines.push(`Worker: found (${[resolved.command, ...resolved.args].join(" ")}).`);

    let client = null;
    let handshakeTimer;
    try {
      client = await Promise.race([
        ensureClient(companion),
        new Promise((_, reject) => {
          handshakeTimer = setTimeout(() => reject(new Error(`handshake timed out after ${WORKER_HANDSHAKE_TIMEOUT_MS}ms`)), WORKER_HANDSHAKE_TIMEOUT_MS);
        })
      ]);
      lines.push("Handshake: ok.");
    } catch (error) {
      lines.push(`Handshake: failed (${error.message}).`);
    } finally {
      clearTimeout(handshakeTimer);
    }

    if (client) {
      try {
        const account = await client.accountRead();
        lines.push(`Auth: ${formatAuthStatus(account)}`);
      } catch (error) {
        lines.push(`Auth: could not be checked (${error.message}).`);
      }
    } else {
      lines.push("Auth: not checked (worker unavailable).");
    }
  }

  if (args.enable_review_gate === true) setConfig(cwd, "stopReviewGate", true);
  if (args.disable_review_gate === true) setConfig(cwd, "stopReviewGate", false);
  const gateEnabled = Boolean(getConfig(cwd).stopReviewGate);
  lines.push(`Review gate: ${gateEnabled ? "enabled" : "disabled"}.`);

  return `${lines.join("\n").trimEnd()}\n`;
}

export function createCompanion({ cwd = process.cwd(), env = process.env, spawnAppServer = defaultSpawnAppServer } = {}) {
  const companion = { cwd, env, client: null, spawning: null, spawnAppServer, runningBackground: 0, queue: [], activeRuns: new Map() };

  const rescueTool = {
    name: "rescue",
    description: "Delegate a coding/investigation task to the Claude worker (background by default).",
    inputSchema: {
      type: "object",
      required: ["prompt"],
      additionalProperties: false,
      properties: {
        prompt: { type: "string", description: "The task for the Claude worker." },
        model: { type: "string", description: "opus|sonnet|haiku|fable or a full claude-* model id." },
        effort: { type: "string", enum: VALID_EFFORTS },
        write: { type: "boolean", description: "Allow file edits (workspace-write). Default true." },
        resume: { type: "boolean", description: "Continue the latest rescue thread in this repo." },
        fresh: { type: "boolean", description: "Force a new thread even if one is resumable." },
        wait: { type: "boolean", description: "Run in the foreground and return the final output. Default false (background job)." },
        cwd: { type: "string", description: "Workspace root override; defaults to the server cwd." }
      }
    },
    handler: (args) => rescueHandler(companion, args ?? {})
  };

  const reviewTargetProperties = {
    base: { type: "string", description: "Base ref to diff against (branch mode)." },
    scope: { type: "string", enum: ["auto", "working-tree", "branch"], description: "auto (default) picks working-tree when dirty, else branch." },
    wait: { type: "boolean", description: "Run in the foreground and return the final output. Default false (background job)." },
    cwd: { type: "string", description: "Workspace root override; defaults to the server cwd." }
  };

  const reviewTool = {
    name: "review",
    description: "Review the working tree or a branch diff for correctness, security, and convention issues (background by default).",
    inputSchema: { type: "object", additionalProperties: false, properties: reviewTargetProperties },
    handler: (args) => reviewToolHandler(companion, "review", args ?? {})
  };

  const adversarialReviewTool = {
    name: "adversarial_review",
    description: "Adversarially review the working tree or a branch diff, actively trying to disprove the change (background by default).",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        ...reviewTargetProperties,
        focus: { type: "string", description: "Optional user focus area to weight heavily." }
      }
    },
    handler: (args) => reviewToolHandler(companion, "adversarial-review", args ?? {})
  };

  const cwdProperty = { cwd: { type: "string", description: "Workspace root override; defaults to the server cwd." } };

  const setupTool = {
    name: "setup",
    description: "Report claude-companion readiness: worker resolution, handshake, auth, and the review-gate state.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        enable_review_gate: { type: "boolean", description: "Turn on the stop-time review gate for this workspace." },
        disable_review_gate: { type: "boolean", description: "Turn off the stop-time review gate for this workspace." },
        ...cwdProperty
      }
    },
    handler: (args) => setupHandler(companion, args ?? {})
  };

  const statusTool = {
    name: "status",
    description: "Report background Claude job status (all jobs, or one job via job_id).",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        job_id: { type: "string", description: "Inspect one job by id (or unique id prefix)." },
        wait: { type: "boolean", description: "Poll (every 2s, up to 240s) until the job(s) leave queued/running." },
        ...cwdProperty
      }
    },
    handler: (args) => statusHandler(companion, args ?? {})
  };

  const resultTool = {
    name: "result",
    description: "Fetch the stored output of a finished Claude job.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        job_id: { type: "string", description: "Which job's result to fetch; defaults to the latest finished job." },
        ...cwdProperty
      }
    },
    handler: (args) => resultHandler(companion, args ?? {})
  };

  const cancelTool = {
    name: "cancel",
    description: "Cancel an active (queued or running) Claude job.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        job_id: { type: "string", description: "Which job to cancel; required if more than one job is active." },
        ...cwdProperty
      }
    },
    handler: (args) => cancelHandler(companion, args ?? {})
  };

  return {
    tools: [setupTool, rescueTool, reviewTool, adversarialReviewTool, statusTool, resultTool, cancelTool],
    dispose: async () => {
      if (!companion.client) return;
      const client = companion.client;
      companion.client = null;
      await client.close();
    }
  };
}
