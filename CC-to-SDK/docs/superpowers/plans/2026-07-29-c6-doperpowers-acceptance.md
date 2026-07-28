# C6 — Doperpowers End-to-End Acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use doperpowers:subagent-driven-development
> (recommended) or doperpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the clone roadmap's primary metric for real — doperpowers' unmodified daemon scripts
driving `ccx` end to end with real work, a real park/answer, retire/mark coverage, and the
content-layer parity test — producing verbatim evidence and fixing whatever defects surface.

**Architecture:** An acceptance stage, not a build stage (spec:
`../specs/2026-07-29-c6-doperpowers-acceptance-design.md`, rev 2 — the spec governs on any conflict).
One subagent spike (probe 69), then four controller-run live scenarios against the eleven scripts via
a PATH shim, then conditional defect-fix tasks, then close-out. **The controller runs every keyed live
scenario itself** (C5/Goal B precedent); subagents get the probe, defect fixes, and close-out docs.

**Tech Stack:** bash (the scripts under test), Node ESM drivers in `$CLAUDE_JOB_DIR/tmp/` reusing
`acc-lib.mjs`/`ptyrun.py`, `tsx` for the probe, the built `harness/dist/cli/bin.js`.

## Global Constraints

- **Scripts are read-only.** The eleven files in
  `/Users/new/.claude/plugins/cache/doperpowers/doperpowers/7.25.0/skills/orchestrating-daemons/scripts/`
  are never edited. md5 all eleven before and after every scenario; any drift = automatic FAIL of that
  scenario.
- **Models:** scenarios ①–③ workers use `claude-haiku-4-5-20251001` (the 5th positional `model` arg of
  `daemon-spawn.sh`); scenario ④ uses each binary's own default, with both resolved models recorded.
- **Env pins (every scenario):** `CCX_FLEET_ROOT=<tmp>`, `DAEMON_HOME=<tmp>`, `DAEMON_BOOT_ID=c6-run`,
  `DAEMON_TIMEOUT=600`; `ANTHROPIC_BASE_URL` affirmatively **unset**; `CLAUDE_CONFIG_DIR` left at
  default; scrub `CLAUDE_JOB_DIR`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_CHILD_SESSION` from every
  spawn env.
- **Credentials:** `CLAUDE_CODE_OAUTH_TOKEN` from `CC-to-SDK/.env`; `ANTHROPIC_API_KEY` stays unset.
  Never print or commit either.
- **pty disciplines (C5's, verbatim):** settle after every frame change before the next key; never
  wait on a phrase the submitted prompt contains — wait on real disk state or a model-only marker.
- **Evidence:** verbatim reports in `CC-to-SDK/.doperpowers/sdd/` (`c6-scenario-<n>-report.md`).
- **Defect policy:** ours → fix task + guard test (sabotage-verified) + re-run the affected scenario
  only; the consumer's → recorded in the spec's Surprises, never worked around by editing scripts;
  environmental → documented in the report.
- Commit completed work to `main`; **no `Co-Authored-By`**; **never push** without an explicit request.

---

## File Structure

- `CC-to-SDK/probes/probes/69-transcript-at-park.ts` — Task 1 (subagent), the flush-at-park probe.
- `$CLAUDE_JOB_DIR/tmp/c6-rig.mjs` — Task 2, shared rig: shim dir, pinned env, md5 integrity, meta
  readers. Consumed by every driver.
- `$CLAUDE_JOB_DIR/tmp/acc-c6-{lifecycle,park,retire,content}.mjs` — Tasks 3–6, one driver per
  scenario. Drivers may be adapted live (that is their nature); **the PASS criteria in each task are
  the contract and do not move without a spec revision.**
- `CC-to-SDK/.doperpowers/sdd/c6-scenario-{1,2,3,4}-report.md` — evidence.
- Close-out touches `docs/parity/clone-roadmap.md`, `docs/parity/coverage.md`, the spec's Outcomes.

---

### Task 1: Probe 69 — does the transcript flush at an AskUserQuestion park? (subagent spike)

**Files:**
- Create: `CC-to-SDK/probes/probes/69-transcript-at-park.ts`

**Interfaces:**
- Produces: a one-word verdict — `FLUSHED` (the pending `tool_use` block is on disk mid-park) or
  `NOT-FLUSHED` — which Task 4 uses to pick the reply-renderer arm it asserts.

This is a spike: the deliverable is knowledge. No TDD cycle; build → run → record.

- [ ] **Step 1: Write the probe** (pattern: probes 62/65 — `query()` with a `canUseTool` that parks,
  then read the on-disk transcript while parked):

```ts
// probes/probes/69-transcript-at-park.ts — at an AskUserQuestion park, is the assistant turn
// (with the pending tool_use) flushed to the on-disk transcript? Probe 62 proved NO mid-turn
// writes for ordinary tool calls; a park may or may not behave differently. The answer decides
// which blocked-reply arm doperpowers' renderer can produce against ccx (C6 spec, scenario ②).
import { query } from "@anthropic-ai/claude-agent-sdk";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const cwd = process.cwd();
const projDir = join(homedir(), ".claude", "projects", cwd.replace(/\//g, "-"));
let sessionId = "";
let parked = false;

const q = query({
  prompt: "Before doing anything else, ask me one question via the AskUserQuestion tool: which color do I prefer, with options red and blue. Wait for my answer.",
  options: {
    cwd, permissionMode: "default", model: "claude-haiku-4-5-20251001",
    canUseTool: async (name, input) => {
      if (name === "AskUserQuestion") {
        parked = true;
        await new Promise((r) => setTimeout(r, 8000)); // hold the park; sample the transcript now
        return { behavior: "deny", message: "probe done" };
      }
      return { behavior: "allow", updatedInput: input };
    },
  },
});
(async () => {
  const sampler = setInterval(() => {
    if (!parked || !sessionId) return;
    try {
      const raw = readFileSync(join(projDir, `${sessionId}.jsonl`), "utf8");
      const hasToolUse = raw.includes('"AskUserQuestion"');
      const lines = raw.trim().split("\n").length;
      console.log(`[69] MID-PARK transcript: ${lines} lines, pending tool_use on disk: ${hasToolUse}`);
      console.log(`[69] VERDICT: ${hasToolUse ? "FLUSHED" : "NOT-FLUSHED"}`);
    } catch (e) { console.log(`[69] MID-PARK transcript unreadable: ${(e as Error).message} → NOT-FLUSHED`); }
    clearInterval(sampler);
  }, 500);
  for await (const m of q) {
    if (m.type === "system" && m.subtype === "init") sessionId = (m as any).session_id;
    if (m.type === "result") console.log(`[69] turn ended: ${m.subtype}`);
  }
})();
```

- [ ] **Step 2: Run it** — `cd CC-to-SDK/probes && set -a; . ../.env; set +a; npx tsx probes/69-transcript-at-park.ts`
  Expected: a `[69] VERDICT: FLUSHED` or `[69] VERDICT: NOT-FLUSHED` line. If `sessionId`'s file never
  appears, widen the projDir search (`readdirSync(projDir)` newest `.jsonl`) rather than concluding.
- [ ] **Step 3: Record the verdict** in the spec's `## Surprises & Discoveries` (one bullet: the
  verdict + one line of evidence) and report it as the task result. Promote/discard: the probe file
  stays (probes are the evidence base); no hardening needed.
- [ ] **Step 4: Commit** — `git add probes/probes/69-transcript-at-park.ts docs/superpowers/specs/2026-07-29-c6-doperpowers-acceptance-design.md && git commit -m "probe(69): transcript flush at AskUserQuestion park — <VERDICT>"`

### Task 2: The rig (controller)

**Files:**
- Create: `$CLAUDE_JOB_DIR/tmp/c6-rig.mjs`

**Interfaces:**
- Produces: `mkRig()` → `{ env, shimDir, fleetRoot, daemonHome, scriptsDir, sh(script, args, extra),
  md5s(), assertMd5s(), meta(uuid, key), cleanup() }`. Every driver imports this; nothing else builds
  env. `cleanup()` also covers the spec's hygiene rules: kill stray `ccx` hosts identified by the temp
  `CCX_FLEET_ROOT` in their argv (never by name), and remove the scenario's session transcripts from
  the real `~/.claude/projects/<encoded-cwd>/` (they land there because `CLAUDE_CONFIG_DIR` stays
  default — delete only files whose session uuids the driver itself recorded).

- [ ] **Step 1: Write the rig:**

```js
// c6-rig.mjs — the ONLY place C6 drivers build environment. Spec §The rig, rev 2.
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const SCRIPTS = "/Users/new/.claude/plugins/cache/doperpowers/doperpowers/7.25.0/skills/orchestrating-daemons/scripts";
const BIN = "/Users/new/Developer/GitHub/codex_somersault/CC-to-SDK/harness/dist/cli/bin.js";

export function mkRig() {
  const root = mkdtempSync(join(tmpdir(), "c6-"));
  const shimDir = join(root, "shim"); mkdirSync(shimDir);
  // The shim IS the mechanism (the roadmap's "CLAUDE_BIN override" does not exist in the scripts).
  writeFileSync(join(shimDir, "claude"), `#!/bin/sh\nexec node ${BIN} "$@"\n`);
  chmodSync(join(shimDir, "claude"), 0o755);
  const fleetRoot = join(root, "fleet"), daemonHome = join(root, "daemons");
  const env = { ...process.env,
    PATH: `${shimDir}:${process.env.PATH}`,
    CCX_FLEET_ROOT: fleetRoot, DAEMON_HOME: daemonHome,
    DAEMON_BOOT_ID: "c6-run", DAEMON_TIMEOUT: "600" };
  // Affirmative unsets — a leftover ANTHROPIC_BASE_URL silently re-creates the stalled-transport rig,
  // an inherited CLAUDE_JOB_DIR makes spawned workers adopt THIS session's job (the A1 trap).
  for (const k of ["ANTHROPIC_BASE_URL", "ANTHROPIC_API_KEY", "CLAUDE_JOB_DIR",
                   "CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_CHILD_SESSION", "CLAUDE_CONFIG_DIR"]) delete env[k];
  const md5s = () => execFileSync("md5", ["-q", ...readdirSync(SCRIPTS).filter(f => f.endsWith(".sh")).sort().map(f => join(SCRIPTS, f))], { encoding: "utf8" });
  const baseline = md5s();
  return {
    env, shimDir, fleetRoot, daemonHome, scriptsDir: SCRIPTS,
    sh: (script, args = [], extra = {}) => execFileSync("bash", [join(SCRIPTS, script), ...args], { encoding: "utf8", env, ...extra }),
    md5s, assertMd5s: () => { if (md5s() !== baseline) throw new Error("SCRIPT MD5 DRIFT — automatic FAIL"); },
    meta: (uuid, key) => { // metas are flat files under DAEMON_HOME; read via the scripts' own convention
      const dir = join(daemonHome, "daemons");
      for (const f of readdirSync(dir)) if (f.includes(uuid)) {
        const m = Object.fromEntries(readFileSync(join(dir, f), "utf8").split("\n").filter(Boolean).map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
        return key ? m[key] : m;
      }
      return undefined;
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}
```

- [ ] **Step 2: Smoke it** — a 5-line script: `mkRig()`, run `sh("daemon-list.sh")` (expect the empty
  listing), run `claude agents --json --all` **through the shim env** (expect `[]`), `assertMd5s()`.
  **Adapt `meta()` to the real on-disk layout observed here** (read `_lib.sh`'s `_meta_path` if the
  guess above is wrong — the rig bends to the scripts, never the reverse).
- [ ] **Step 3:** No commit (job-tmp file). Record the smoke output in `c6-scenario-1-report.md`'s
  preamble.

### Task 3: Scenario ① — real-work lifecycle (controller, live)

**Files:**
- Create: `$CLAUDE_JOB_DIR/tmp/acc-c6-lifecycle.mjs`, report `CC-to-SDK/.doperpowers/sdd/c6-scenario-1-report.md`

PASS criteria (spec scenario ①, verbatim contract — every step's observable goes in the report):

1. `daemon-spawn.sh <name> "<task>" <cwd> <wtname> claude-haiku-4-5-20251001` in a throwaway **git
   repo** (init with one commit). The task instructs the worker to write
   `hello.txt` containing exactly `C6-REAL-WORK` **and commit it** (clean worktree is load-bearing
   for step 7).
2. The file exists at `<repo>/.claude/worktrees/<wtname>/hello.txt` with content `C6-REAL-WORK`, on
   branch `worktree-<wtname>` — assert via `git -C <wt> rev-parse --abbrev-ref HEAD` and file read.
3. `daemon-resume.sh <id> "<task: append a second line C6-EDITED and commit>"` — assert: stable uuid
   unchanged (`meta(id,"uuid")`), fresh `current` uuid, superseded roster row gone from
   `claude agents --json --all`, and the edit landed in the worktree file.
4. `daemon-reply.sh <id>` returns actual reply text — assert non-empty and **not** a limit banner.
5. `daemon-finalize.sh <id>` prints `noop` (blocking watchers already finalized; per spec rev 2).
6. Snapshot `current` uuid; `daemon-retire.sh <id> purge` → meta/reply/err files gone, the NOTE line
   about the worktree printed, worktree still present.
7. `ccx --resume <current-uuid>` **from the worktree dir** loads the conversation (pty: banner +
   replayed turn visible, then exit). Then dirty the worktree (`touch scratch`), `ccx rm <short>` →
   assert **refusal**; clean it, `ccx rm <short>` again → worktree gone.
8. `assertMd5s()` before and after.

- [ ] **Step 1:** Write the driver (rig + `sh()` calls + the pty leg for step 7 via `ptyrun.py`, C5
  pattern). Poll disk state, never echoed text.
- [ ] **Step 2:** Run keyed (`set -a; . CC-to-SDK/.env; set +a`). Iterate on driver bugs freely;
  **any contract miss is a defect** → Task 7 loop.
- [ ] **Step 3:** Write the verbatim report; append the evidence table to the ledger; commit the
  report: `git add CC-to-SDK/.doperpowers/sdd/c6-scenario-1-report.md && git commit -m "test(c6): scenario ① real-work lifecycle — <verdict>"`

### Task 4: Scenario ② — park-and-answer (controller, live)

**Files:**
- Create: `$CLAUDE_JOB_DIR/tmp/acc-c6-park.mjs`, report `c6-scenario-2-report.md`

PASS criteria (spec scenario ② rev 2; Task 1's verdict picks the step-4 arm):

1. Spawn **worktree'd**, `--no-wait`, haiku, task: *"First ask me via the AskUserQuestion tool which
   greeting to use, options FORMAL and CASUAL. After I answer, write greeting.txt with that word and
   commit."*
2. While `state:"working"`: `daemon-finalize.sh` prints `live`, meta untouched (compare `updated`).
3. Poll `claude agents --json --all` until the row shows `{state:"blocked", status:"idle"}` with a
   `waitingFor` naming AskUserQuestion.
4. `daemon-finalize.sh` prints `idle`; the recorded reply contains the question text (probe 69 =
   FLUSHED) **or** `_lib.sh`'s harness-prompt marker (NOT-FLUSHED). Empty reply = FAIL. Second call
   prints `noop`.
5. `daemon-reply.sh` returns that recorded reply.
6. **Leg A:** `ccx attach <short>` (pty) shows the parked question; answer it (pick FORMAL); detach;
   poll roster to `state:"done"`; `greeting.txt` contains `FORMAL` in the worktree.
7. **Leg B (second parked worker, same task shape):** `daemon-resume.sh <id> "Answer: CASUAL — proceed"`
   → parked turn stopped (terminal state recorded), fork completes, reply reflects the answer,
   superseded row purged. Assert `greeting.txt` contains `CASUAL` in *that* worktree **or** record
   the observed divergence verbatim (this leg is empirically uncertain — that is why it exists).
8. `assertMd5s()`. Stretch (only if both legs pass cheaply): permission-park variant.

- [ ] **Step 1:** Write the driver (two workers, one pty attach leg).
- [ ] **Step 2:** Run keyed; defects → Task 7.
- [ ] **Step 3:** Report + ledger + commit (`test(c6): scenario ② park-and-answer — <verdict>`).

### Task 5: Scenario ③ — retire/mark edges (controller, live)

**Files:**
- Create: `$CLAUDE_JOB_DIR/tmp/acc-c6-retire.mjs`, report `c6-scenario-3-report.md`

PASS criteria (spec scenario ③): on two cheap finished daemons (haiku, trivial no-worktree tasks):

1. `daemon-mark.sh <a> awaiting-human "escalated: test note"` → mark's echo carries the note; meta
   `status=awaiting-human`, `note` set; `daemon-list.sh awaiting-human` lists exactly that row
   (`daemon-list.sh` never renders notes — do not assert it there).
2. `daemon-retire.sh <a>` (no purge) → prints `retired … (still resumable: …)`; meta `status=retired`,
   meta/reply files **kept**; `ccx --resume` of its `current` uuid still loads (pty, cwd-scoped).
3. `daemon-retire.sh <b> purge` → meta/reply/err gone.
4. `assertMd5s()`.

- [ ] **Step 1:** Driver. **Step 2:** Run keyed. **Step 3:** Report + ledger + commit
  (`test(c6): scenario ③ retire-mark — <verdict>`).

### Task 6: Scenario ④ — content-layer parity (controller, live)

**Files:**
- Create: `$CLAUDE_JOB_DIR/tmp/acc-c6-content.mjs`, report `c6-scenario-4-report.md`

PASS criteria (spec scenario ④):

1. **Baseline first — the real `claude`** (no shim; the genuine binary), clean session, fresh empty
   project dir, default model, pty. Send exactly `Let's make a react todo list`. Record: did the
   `brainstorming` skill invocation appear **before any code file exists** in the dir? Capture the
   transcript; record the resolved model (from `/status` or the banner).
2. Same run on `ccx` (default model; record what `resolveOptions` resolved — opus-4-8 expected).
   Before the prompt, confirm both binaries surface the same doperpowers 7.25.0 skills (e.g. `/`
   catalog contains the doperpowers commands on both).
3. **PASS = parity.** Both-positive = strong pass. Both-negative = recorded "vacuous-but-parity".
   ccx-negative/real-positive = FAIL → defect. real-negative/ccx-positive = record verbatim (we
   exceed the original; not a FAIL).
4. Interrupt/exit both sessions before real code gets written (the trigger is the observable, not the
   todo list). Clean the project dirs.

- [ ] **Step 1:** Driver (two pty runs; brainstorming detection = the Skill invocation line or the
  skill's announce text "brainstorming skill" in frame output, checked before any `*.tsx?/js/html`
  exists in the dir). **Step 2:** Run keyed. **Step 3:** Report + ledger + commit
  (`test(c6): scenario ④ content parity — <verdict>`).

### Task 7: Defect loop (conditional, repeats as needed)

For each defect a scenario surfaces, triage per the spec's Defect policy:

- **Ours** → dispatch a sonnet fix subagent (task brief = the failing observable + the contract line
  from the scenario task; the implementer contract: fix, covering unit/guard test where the
  teardown-liveness pattern applies, **sabotage-verify** the guard, run the covering tests, commit).
  Fresh sonnet reviewer on the diff. Then the **controller re-runs the affected scenario only**.
- **The consumer's** → one bullet in the spec's `## Surprises & Discoveries` (verbatim evidence),
  no code change, no script edit.
- **Environmental** → documented in the scenario report.

### Task 8: Close-out docs (subagent, sonnet)

**Files:**
- Modify: `CC-to-SDK/docs/parity/clone-roadmap.md` (§C6: mark shipped with a pointer to the spec +
  the evidence reports; fix the stale "via the `CLAUDE_BIN` override" wording on the C2 acceptance
  line — the mechanism is the PATH shim; add the closing status line that C1–C6 have all shipped)
- Modify: `CC-to-SDK/docs/parity/coverage.md` (rows the acceptance settles — daemon-script
  compatibility, park/answer under the scripts, content-layer trigger — cite the reports)

- [ ] **Step 1:** Make both edits, citing report filenames. **Step 2:** Commit
  (`docs(c6): close-out — roadmap C6 shipped, coverage refresh`).

### Task 9: Final verification (controller)

Execute the spec's acceptance section as written:

- [ ] **Step 1:** Confirm each of the four reports ends in a PASS table with verbatim evidence and an
  explicit md5-unchanged line. Any FAIL is either fixed-and-rerun (evidence of the re-run in the
  report) or recorded for upstream — **no silent skips**.
- [ ] **Step 2:** Run the standing gate from `harness/`: `npx tsc --noEmit && npx vitest run` —
  expected: clean typecheck, all unit tests pass (unchanged from C5's 1379 passed / 9 skipped unless
  Task 7 added guards).
- [ ] **Step 3:** Controller writes the spec's `## Outcomes & Retrospective` (per-scenario verdict
  tables from the reports + retrospective) and updates the project memory
  (`c6` entry; update `clone-roadmap-reframe.md`'s Next pointer).
- [ ] **Step 4:** Commit (`docs(c6): spec Outcomes — C6 shipped, roadmap complete`).
