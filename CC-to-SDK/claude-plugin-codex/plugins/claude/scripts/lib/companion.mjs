// Companion core: wires the job store (state.mjs/tracked-jobs.mjs/job-control.mjs) + the
// appserver client (appserver-client.mjs) into the tool defs mcp-stdio.mjs serves. Thin by
// design — job mechanics stay in the Task 10 modules, appserver mechanics in Task 11.
import { spawnAppServer } from "./appserver-client.mjs";
import { generateJobId, listJobs, upsertJob } from "./state.mjs";
import { createJobRecord, runTrackedJob } from "./tracked-jobs.mjs";
import { sortJobsNewestFirst } from "./job-control.mjs";

export const MODEL_ALIASES = { opus: "claude-opus-4-8", sonnet: "claude-sonnet-5", haiku: "claude-haiku-4-5-20251001", fable: "claude-fable-5" };
export const VALID_EFFORTS = ["low", "medium", "high", "xhigh", "max"];

// At most this many rescue jobs run in the background concurrently (per companion instance);
// past that, new jobs are persisted as "queued" and drained FIFO as running ones finish.
const MAX_CONCURRENT_BACKGROUND = 3;

const WORKER_MISSING_TEXT = `Claude worker is not available. Install it with:
  npm install -g /Users/new/Documents/GitHub/codex_somersault/CC-to-SDK/app-server
or point CLAUDE_COMPANION_APPSERVER at a cc-codex-appserver binary, then call the setup tool.`;

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

async function ensureClient(companion) {
  if (companion.client && companion.client.alive()) return companion.client;
  companion.client = await spawnAppServer({ cwd: companion.cwd, env: companion.env });
  return companion.client;
}

async function runRescueTurn({ client, cwd, model, effort, write, prompt, resumeThreadId }) {
  const { threadId } = resumeThreadId
    ? await client.threadResume({ threadId: resumeThreadId, cwd, model, effort, write })
    : await client.threadStart({ cwd, model, effort, write });
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

// Runs a background rescue job now: bumps the in-flight counter, fires runTrackedJob without
// awaiting the caller, and always resolves (never rejects — runTrackedJob already persisted any
// failure to the job store, so there's nothing left for the caller to react to; swallowing here
// keeps this an intentional fire-and-forget instead of an unhandled-rejection warning).
function runBackgroundNow(companion, job, runner) {
  companion.runningBackground += 1;
  return runTrackedJob(job, runner)
    .catch(() => {})
    .finally(() => {
      companion.runningBackground -= 1;
      drainQueue(companion);
    });
}

function drainQueue(companion) {
  if (companion.runningBackground >= MAX_CONCURRENT_BACKGROUND) return;
  const next = companion.queue.shift();
  if (!next) return;
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
    const job = createJobRecord({
      id: jobId,
      workspaceRoot: cwd,
      jobClass: "task",
      kind: "task",
      prompt,
      model: model ?? null,
      effort: effort ?? null
    });
    const resumeThreadId = resume ? candidate?.threadId ?? null : null;
    const runner = () => runRescueTurn({ client, cwd, model, effort, write, prompt, resumeThreadId });

    if (wait) {
      const execution = await runTrackedJob(job, runner);
      return `${execution.rendered}\n\nContinue in this thread later with rescue {resume:true}. (job ${jobId})`;
    }

    startBackground(companion, job, runner);
    return `Started background job ${jobId}. Poll with the status tool; fetch output with the result tool.`;
  } catch (error) {
    if (error && error.code === "WORKER_NOT_FOUND") return WORKER_MISSING_TEXT;
    throw error;
  }
}

const SETUP_TOOL = {
  name: "setup",
  description: "Report claude-companion runtime environment (scaffold stub).",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  handler: async () =>
    JSON.stringify(
      {
        cwd: process.cwd(),
        node: process.version,
        env: {
          HOME: !!process.env.HOME,
          PATH: !!process.env.PATH,
          CLAUDE_CODE_OAUTH_TOKEN: !!process.env.CLAUDE_CODE_OAUTH_TOKEN,
          ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
          CLAUDE_COMPANION_APPSERVER: process.env.CLAUDE_COMPANION_APPSERVER ?? null
        }
      },
      null,
      2
    )
};

export function createCompanion({ cwd = process.cwd(), env = process.env } = {}) {
  const companion = { cwd, env, client: null, runningBackground: 0, queue: [] };

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

  return {
    tools: [SETUP_TOOL, rescueTool],
    dispose: async () => {
      if (!companion.client) return;
      const client = companion.client;
      companion.client = null;
      await client.close();
    }
  };
}
