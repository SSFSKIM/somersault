---
name: claude-delegation
description: How to delegate tasks and reviews to Claude workers via the claude-companion tools (rescue, review, adversarial_review, status, result, cancel, setup), and how to present their results.
---

# Delegating to Claude workers

## Tool etiquette

- **Always pass `cwd` explicitly** on every `claude-companion` tool call (run `pwd` first if unsure). The
  server's own default `cwd` is wherever it happened to start (its plugin install directory), not your
  session's workspace. Omitting `cwd` silently targets the wrong repo for git diffing, job storage, resume
  lookup, and — for `rescue` — the directory the delegated Claude worker actually operates in. This is the
  single most important rule: get it wrong and the call looks like it worked but did the wrong thing.
- One `rescue` call per delegation. Do not decompose the user's request into multiple rescue calls; pass the
  whole task as `prompt` (required).
- Long tasks and reviews default to BACKGROUND: the tool returns a job id immediately and you poll for the
  outcome. Use `wait:true` only for quick, small tasks the user is actively waiting on.
- If `rescue` returns a resume-offer message instead of starting a job (this happens whenever a prior rescue
  thread exists for the repo and neither `resume` nor `fresh` was passed), relay the choice to the user unless
  their request already implies it — a follow-up on the same problem means call `rescue` again with
  `resume:true`; clearly new work means `fresh:true`. The offer itself does not start any work.
- `model` accepts `opus`, `sonnet`, `haiku`, `fable`, or a full `claude-*` model id; omit it to use the
  worker's default. `effort` accepts `low`, `medium`, `high`, `xhigh`, or `max` and controls thinking budget;
  omit it to use the default too.
- Rescue defaults to write access (`write` defaults to `true`). Pass `write:false` when the user asks for
  investigation only, with no edits.
- `review` and `adversarial_review` target the working tree or a branch diff: `scope` is `auto` (default,
  picks working-tree when dirty else branch), `working-tree`, or `branch`; `base` sets the branch ref to diff
  against. `adversarial_review` additionally accepts `focus` (free text) to steer what it should challenge.
  Both are read-only — they never edit files.
- `status` takes an optional `job_id` (accepts a unique id prefix) and reports one job, or all jobs when
  omitted; `wait:true` polls (every ~2s, up to 240s) until the job(s) leave queued/running instead of
  returning an in-flight snapshot. `result` fetches the stored output of a finished job (`job_id` optional,
  defaults to the latest finished job). `cancel` stops an active job (`job_id` required only if more than one
  job is active).
- If any tool reports the worker is unavailable, run `setup` and relay its guidance verbatim — don't improvise
  an alternate install or auth flow.

## Presenting results

- Preserve the worker's verdict, findings, and next steps. Findings first, ordered by severity, with exact
  file:line references. Do not soften severities.
- CRITICAL: after `review` / `adversarial_review` findings, STOP. Never auto-apply fixes, even obvious ones.
  Present the findings and ask the user how to proceed.
- If a result includes a thread reference, mention that the conversation can be continued with
  `rescue {resume:true}` (same repo, same `cwd`).
- If `rescue` failed or came back incomplete, report that plainly and stop — do not quietly attempt the task
  yourself as a fallback.
