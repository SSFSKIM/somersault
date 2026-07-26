# Clone Roadmap — from "SDK envelope" to "Claude Code, cloned"

> **Supersedes the framing of `roadmap.md`** (Feb-era Phase 1/2/3) and **retires envelope realization
> as the primary metric.** Waves 1–4 (`full-potential.md`) are not undone — they are the *engine* this
> track surfaces. Read `coverage.md` for capability state and `tui-ux.md` for visual state; this file
> is the **sequencing** doc.
>
> **⚠️ Partly superseded 2026-07-26 by
> [`../superpowers/specs/2026-07-26-clone-process-surface-spine-design.md`](../superpowers/specs/2026-07-26-clone-process-surface-spine-design.md).**
> A brainstorming session reframed C1–C4 (this file treated interactive / headless / fleet as three
> faces; the spec treats them as **four arrangements of one host+client process model**) and **reversed
> §3 F2** — co-registration is not "guarded and fragile," it is the *existing state*, because our engine
> is the `claude` CLI and its sessions self-register (probes 56/56b/57). Stages **C5 (TUI)** and the
> §5 floor and §6 thesis below still stand; **C1–C4 are replaced by that spec's Goal A**, and the
> control-plane gaps it found became Goal B.

## 0. The goal, restated

The product is **Claude Code itself, cloned** — the thing you type `claude` and get. Interactive is
the *default face*, not a bonus on top of a headless library. Headless (`-p`) and background
(`--bg`) are **modes of the same binary**, not separate programs.

The concrete consumer that makes this testable: the **doperpowers agent system**
(`/Users/new/developer/github/doperpowers`). Its `orchestrating-daemons` skill drives durable
background sessions through a specific CLI contract, and its board pipeline dispatches workers through
that same substrate. If our binary satisfies that contract, we have cloned the part of Claude Code
that actually matters to this user.

### Why the old metric retires

Envelope realization ("what fraction of the SDK's declared surface do we reach headlessly?") measured
the wrong boundary for this goal, for two reasons:

1. **The SDK is not the product boundary.** `query()` spawns the real `claude` CLI as a subprocess.
   Everything the CLI does that the SDK does not *expose* — the interactive shell, the process
   registry, `--bg`, `attach`, worktree spawning — is invisible to an envelope score and is exactly
   what a clone needs. You can score 100% envelope and still not be Claude Code.
2. **A clone is judged end-to-end, not surface-by-surface.** "63/63 `Options` fields wired" does not
   tell you whether `daemon-spawn.sh` works. Only running it does.

**The new primary metric is binary:** does an unmodified doperpowers daemon fleet run on our binary?
Secondary metrics stay as they are — `coverage.md` (capability) and `tui-ux.md` (visual fidelity) —
but they are now *inputs*, not the goal.

---

## 1. The target, stated as a contract

Real Claude Code is **one binary with three faces**, verified against `claude --help` and
`claude agents --help` on v2.1.220:

| Face | Invocation | What it is |
|---|---|---|
| **Interactive** | `claude` (default), `-c`, `-r <id>` | the TUI; the daily driver |
| **Headless** | `claude -p` | one-shot / scriptable; `--output-format`, `--json-schema` |
| **Fleet** | `claude --bg`, `agents`, `attach`, `stop`, `rm` | durable background processes |

### The doperpowers CLI contract (the acceptance surface)

Extracted from `skills/orchestrating-daemons/scripts/*.sh`. These are the exact verbs the scripts
invoke; the binary is resolved **bare from `PATH`** (there is no `CLAUDE_BIN`-style override today):

| Invocation | Used by | Semantics that must hold |
|---|---|---|
| `claude --bg [--resume <uuid>] [--worktree <name>] [--model m] [--settings f] [--effort e] -n <name> "<task>"` | `daemon-spawn.sh`, `daemon-resume.sh` | forks a **detached** process, prints a short id, returns immediately; **survives the spawning shell exiting** |
| `claude agents --json --all [--cwd <path>]` | `daemon-list.sh`, `_lib.sh` | JSON array of sessions, `--all` including completed; no TTY required |
| `claude stop <id>` | `daemon-resume.sh` | ends the turn, **keeps** the conversation resumable |
| `claude rm <id>` | `_lib.sh` purge | deletes the session **and its worktree when clean**; works on already-exited sessions |
| `claude attach <id>` | human escalation | re-hosts a live background session in this terminal |
| `claude --resume <uuid>` | human follow-up | resumes interactively, **scoped to the cwd's project** |

Two semantics in that table are load-bearing and easy to under-build:

- **"survives the spawning shell exiting"** is doperpowers' whole reason for using daemons. A fleet
  hosted inside one supervisor process does not satisfy it.
- **`--resume` is cwd-scoped.** Session lookup is per-project, not global.

---

## 2. Where we actually are

| Face | Our artifact | State |
|---|---|---|
| Interactive | `cc-harness-chat` (Ink REPL, `tui/`) | **~82%** visual parity (`tui-ux.md`); the strongest asset |
| Headless | `cc-harness "<prompt>"` (`harness/src/cli.ts`) | works; arg surface is a **stub** — `--model`/`--output-style` only, vs. 63 config fields underneath |
| Fleet | `cc-harness daemon` + `ps`/`submit`/`top` + `cc-harness-console` | **wrong shape** — see §3 F3 |

Three binaries (`cc-harness`, `cc-harness-console`, `cc-harness-chat`), three argument grammars, none
of them Claude Code's. The engine is strong; the *shell* around it is the gap.

---

## 3. Four findings that shape the plan

Each was verified this session; none is inferred from documentation alone.

### F1 — A drop-in `claude` on PATH does **not** recurse *(verified)*

The obvious fear: our clone calls the SDK, the SDK spawns `claude`, and if we *are* `claude` we loop
forever. **False.** The SDK resolves its executable from a package-relative path, not `PATH`:

```
let lh = d.pathToClaudeCodeExecutable;
if (!lh) { … resolve relative to import.meta.url … 
           throw Error(`Native CLI binary for ${platform}-${arch} not found.
                        Reinstall @anthropic-ai/claude-agent-sdk`) }
```

Shadowing `claude` on `PATH` is therefore *architecturally* safe. It remains **product-hostile** — it
breaks the user's real Claude Code — so it is not the recommendation. But it removes the hard blocker,
which changes the strategy space (see F2).

### F2 — The live registry is a directory of PID files, but co-registration is **guarded** *(tested — negative result)*

`~/.claude/sessions/<pid>.json` holds one file per live session:

```json
{"pid":1026,"sessionId":"dcf1e554-…","cwd":"/Users/new/Developer/GitHub/doperpowers",
 "startedAt":1784948673939,"procStart":"Sat Jul 25 02:55:52 2026","version":"2.1.220",
 "peerProtocol":1,"kind":"bg","entrypoint":"cli","name":"dcf1e554","agent":"claude",
 "jobId":"dcf1e554","status":"idle","updatedAt":1784948674402}
```

PIDs in that directory do appear in `claude agents --json`, and the listing carries **both**
`kind:"background"` and `kind:"interactive"` rows.

> **REVERSED 2026-07-26 — read the spec, not this section.** The negative result below was an artifact
> of the experiment. Liveness compares `procStart` against **`LC_ALL=C TZ=UTC ps -o lstart=`** and this
> test supplied locale-formatted output; worse, fabricating a row is not the production path. Exercising
> the real path instead (probe 56/56b) shows SDK-driven sessions **already self-register and already
> appear in `claude agents`**, and probe 57 shows `CLAUDE_CODE_SESSION_NAME`/`_KIND` control the row.
> Co-registration was never a decision to make. The conclusion drawn from this section — "run our own
> registry" — is replaced by the spec's **zero-state fleet**.

**The attractive hypothesis was co-registration** — write our own well-formed row and become visible
to the real `claude agents`, making `daemon-list.sh` work with zero script changes. **It was tested
and it failed**, twice: a schema-valid row naming a live non-`claude` process (first a `sleep`, then a
`node`) did not appear in `claude agents --json --all`. Two further observations from the same runs:

- The live-file count **dropped 36 → 33** across the queries: `claude agents` actively reaps rows it
  judges stale, so a foreign row is not merely ignored but liable to be collected.
- `agents --all` returned **36 rows against 33 live files** — so `--all` merges the live registry with
  a *separate* store of completed background sessions. The PID directory is one input, not the source
  of truth.

Candidate discriminants — the `procStart` locale mismatch is the leading hypothesis and matches the
binary's `gB()`, but the confirming re-run (same row, C-locale `procStart`) was never done, so it
remains a hypothesis, not the established cause: a process-identity check on
the PID, or a `procStart` mismatch — note that `ps -o lstart=` renders in the user's locale
(`2026년 7월 25일 토요일 …`) while the real rows carry C-locale (`Sat Jul 25 02:55:52 2026`).

**Consequence for C2 — and it points the opposite way from the hypothesis.** Interop-by-file-write is
not a free win, and even if the guard were satisfied, it would make us depend on an unversioned
private format that can change in any Claude Code release. **Recommendation: run our own registry and
our own `ccx agents`.** The doperpowers scripts resolve `claude` bare from `PATH`, so pointing them at
our binary needs a `CLAUDE_BIN`-style override — a one-line change in a fork **the user already owns**
(`/Users/new/developer/github/doperpowers`), and a change worth upstreaming on its own merits since it
also unblocks every other harness. That is a far cheaper and more durable dependency than a guarded
private file format.

### F3 — Our daemon's process model is the wrong shape *(structural)*

| | Claude Code | `cc-harness daemon` |
|---|---|---|
| Process model | **N independent OS processes**, one per session | **1 supervisor**, N in-process sessions |
| Discovery | shared on-disk registry, scanned | private UDS socket at `~/.claude/cc-daemon/` |
| Failure blast radius | one session | **the whole fleet** |
| Survives parent exit | yes, inherently | only while the supervisor lives |
| Sees interactive sessions | yes | no such concept |

This is **a rewrite of the process model, not an increment** — and it is the single largest item on
the roadmap. The consolation is that the transport work is not wasted: `daemon/server.ts`'s UDS
machinery is exactly what a *per-session* peer server needs, which is what `attach` requires (C4). The
supervisor becomes a per-process server; the registry moves from memory to disk.

### F4 — `usage().rate_limits` is auth-mode-coupled, **not** bridge-coupled *(verified — corrects `coverage.md`)*

We had recorded this as a 🚫 ("`null` on API-key auth — bridge-coupled"). Probe 55 shows the real
discriminant is **which credential the CLI ends up using**:

| Auth path | `subscription_type` | `rate_limits_available` | `rate_limits` |
|---|---|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`) | `null` | `false` | `null` |
| interactive login, i.e. `~/.claude/.credentials.json` | `"max"` | `true` | **fully populated** |

The mechanism is the scope set. The interactive credential carries `user:profile` (alongside
`user:inference`, `user:mcp_servers`, `user:file_upload`) plus `subscriptionType` and `rateLimitTier`;
the `setup-token` credential does not reach the claude.ai usage endpoint. This is precisely the
`sdk.d.ts` clause we had read past — *"API key, Bedrock, Vertex, **or missing profile scope**"*.

Populated payload includes `five_hour` / `seven_day` / `seven_day_opus` / `seven_day_sonnet` windows
(`utilization`, `resets_at`), an `extra_usage` block (`monthly_limit`, `used_credits`,
`spend_limit_reached`, `disabled_reason`), and a `limits[]` array of
`{kind, group, percent, severity, resets_at}`.

**Consequence for the clone:** a real Claude Code status bar / `/status` / `/cost` showing plan
utilization is **reachable**, and it retires a 🚫 from the floor. **Consequence for our test rig:** the
project convention of exporting `CLAUDE_CODE_OAUTH_TOKEN` from `.env` *degrades* this surface. The
richer default is to export **no** token and let the spawned CLI fall back to the interactive
credential — same subscription billing, strictly more capability.

---

## 4. The stages

Sequenced by dependency, then by leverage. Each stage is a spec → plan → subagent-execution cycle in
the usual project workflow, and ends by updating `coverage.md` / `tui-ux.md` / this file.

### C1 — One binary, one argument grammar

**Goal.** Collapse three binaries into one entry point whose grammar is Claude Code's.

**Why first.** Every fleet verb (`--bg`, `agents`, `attach`) is a flag or subcommand *on this binary* —
C2 through C4 have nowhere to land until it exists. It is also where **Wave 4 finally pays off**: 63
`HarnessConfig` fields are wired to the SDK today with no way for a user to set them, because
`cli.ts` parses `--model` and `--output-style` and nothing else.

**Delivers.**
- A single bin. Bare invocation = interactive (today's `cc-harness-chat`); `-p/--print` = today's
  one-shot; `-c`/`-r <id>` = resume paths that already exist in the REPL.
- Subcommand skeleton: `agents`, `mcp`, `plugin`, `doctor`, `auth`, `project`.
- A **flag → `HarnessConfig` field** mapping table, committed as a doc, so the CLI surface and the
  config surface stop drifting. Unsupported-but-real flags must **fail loudly**, never silently no-op
  — a silently-ignored `--permission-mode` in a background worker is a safety bug, not a UX wart.

**Acceptance.** `ccx --help` structurally mirrors `claude --help` for supported flags; every one of
the 63 fields is either reachable from the CLI or explicitly listed as library-only.

**Risk.** Low. Mostly mechanical, but it touches the entry point of all three current binaries.

### C2 — Process model: process-per-session + co-registration

**Goal.** `ccx --bg` produces a detached process that outlives its parent and is visible to the fleet.

**Delivers.**
- `--bg` forks a detached process which registers itself, keeps `status`/`updatedAt` fresh, runs its
  turn, and leaves the transcript resumable.
- **Our own registry**, in our own directory, borrowing the real schema's *field set* (`pid`,
  `sessionId`, `cwd`, `procStart`, `kind`, `name`, `jobId`, `status`, `updatedAt`) because those
  fields are the right ones — `procStart` in particular exists to disambiguate PID reuse, and we need
  that for the same reason they do. **Not** co-registration into `~/.claude/sessions/` (F2).
- `ccx agents [--json] [--all] [--cwd]` emitting **row-shape-compatible JSON**, so anything parsing
  `claude agents --json` parses ours. `--all` requires a completed-session store distinct from the
  live registry (F2's 36-rows-vs-33-files observation).
- `ccx stop <id>` (end turn, keep conversation) and `ccx rm <id>` (delete session + clean worktree,
  works post-exit) — note the asymmetry: `rm` must work on already-exited sessions, `stop` need not.
- Stale-row reaping, since the real implementation demonstrably needs it too.

**Acceptance (the real test, not a unit test).** Spawn `ccx --bg`, kill the parent shell, confirm the
session keeps working and that `ccx agents --json` lists it. Then run `daemon-spawn.sh` against our
binary via the `CLAUDE_BIN` override (C6) and have it succeed with no other script change.

**Risk.** Highest on the roadmap. Detached-process lifecycle, orphan/stale-registry reaping (PID reuse
is a real hazard — `procStart` exists in the schema precisely to disambiguate it), and crash-safety of
the on-disk registry. Budget for this being the long pole.

### C3 — Fork-resume and worktree lifecycle

**Goal.** Match doperpowers' turn model, which is subtler than "resume."

**Delivers.**
- `--bg --resume <uuid>`: each resume **forks a new background turn** carrying the conversation
  forward, with the superseded turn purged — this is why `rm` must handle exited sessions, and why the
  registry needs the daemon-identity-vs-session-id indirection the scripts already maintain.
- `--worktree <name>`: create/reuse `<repo>/.claude/worktrees/<name>` on branch `worktree-<name>`;
  resume and reply-reading follow it; `rm` deletes it **only when clean**.
- cwd-scoped session lookup for `--resume`.

**Risk.** Medium. Git worktree plumbing is well-understood; the dirty-guard on delete is the part
worth writing tests for first.

### C4 — `attach`: re-hosting a live session

**Goal.** `ccx attach <id>` streams a running background session into this terminal, accepts input,
and detaches without killing it.

**Note on the unknown.** The registry advertises `peerProtocol: 1`, so the real CLI clearly runs a
live IPC endpoint, but no unix socket appeared at the obvious paths — **transport unidentified**. We
do not need to reverse-engineer it: we own both ends of *our* fleet, so we define our own peer
transport. This is where the C2 rewrite pays back the existing daemon investment — `daemon/server.ts`
becomes a **per-session** UDS server rather than a fleet supervisor, and the console's client code
mostly carries over.

**Acceptance.** Attach to a working session, see live output, send a message, detach with the session
still running, re-attach.

**Risk.** Medium-high, but *bounded* — it is our protocol, so there is no compatibility target.

### C5 — TUI closure (~82% → ~95%)

**Goal.** Close `tui-ux.md`'s remaining gaps, led by the one with the highest fidelity payoff.

**Delivers.** **U12 Esc-Esc rewind / message edit** first — it is marked HARD in the scorecard, but
**its engine already shipped in Wave 1** (`rewindFiles`, transcript truncation, the destructive-vs-fork
semantics). What is missing is only the interactive surface. Then: plan-mode (`ExitPlanMode`) approval
dialog, code-block syntax highlighting + tables, word-wise cursor movement, `/copy`, vim mode.

Plus the F4 dividend: a real plan-utilization surface in `/status` and the status bar.

### C6 — doperpowers end-to-end

**Goal.** The primary metric, actually run.

**Delivers.** `daemon-spawn.sh` / `daemon-resume.sh` / `daemon-list.sh` / `daemon-reply.sh` /
`daemon-retire.sh` executed against our binary, unmodified where possible. A worker spawned into a
worktree, parked, answered, and resumed. Plus the content-layer acceptance test from
`docs/porting-to-a-new-harness.md`: a clean session, the message *"Let's make a react todo list"*,
and `brainstorming` auto-triggering.

**Note on the content layer.** Skills and plugins already load — the SDK spawns the real CLI with our
`settingSources`, so doperpowers' skills are present and invokable today (this was settled in the
command-palette increment: *surfacing, not installing*). C6 is about the **substrate**, not the
content.

---

## 5. The floor, restated for a clone

The old 🚫 list was written against a headless-library goal. Under a clone goal it shrinks, because
things unreachable *through the SDK* are often reimplementable *by us* — we are writing a CLI, not
only calling one.

**Still genuinely out of reach** (server-side or account-coupled, no client can synthesize them):

- `claude ultrareview` — cloud-hosted multi-agent review; we can shell out to the real binary, not clone it.
- `--remote-control` / the claude.ai bridge, `RemoteTrigger`, `PushNotification` — bound to claude.ai endpoints.
- `claude gateway` — enterprise auth/telemetry service.
- `claude install` / `update` — native-installer plumbing for a binary that is not ours.

**No longer on the floor:**

- `usage().rate_limits` — reachable under interactive credentials (F4).
- `--bg` / `agents` / fleet lifecycle — reimplementable against the observed registry (F2).
- `attach` — our own transport, our own protocol (C4).

**Deliberate non-goals:** cloning Anthropic-internal analytics; the OpenAI provider path; voice.

---

## 6. The thesis that should drive sequencing

> **Waves 1–4 built engine capability faster than the interactive surface could consume it.**

The evidence is a consistent backlog of built-but-unsurfaced levers:

| Shipped engine capability | Interactive surface |
|---|---|
| Wave 1 `rewindFiles` + rewind semantics | **none** — Esc-Esc is still `❌` in `tui-ux.md` |
| Wave 1 background tasks | **none** — no `--bg` |
| Wave 3 warm pool | **none** — no CLI |
| Wave 4 all 63 `Options` fields | **~2 flags** in `cli.ts` |
| Wave 4 `runStructured<T>()` | **none** — no `--json-schema` |

This was previously observed one feature at a time (the thinking-budget audit found the same pattern:
*"the lever was built lib-side with no interactive surface"*). Stated as a trend it becomes a planning
rule:

**The clone track is mostly surfacing work, not engine work.** C1 and C5 are largely *exposure* of
things that already exist. Only C2–C4 require genuinely new machinery, and of those only C2 is a
rewrite. That is a materially cheaper roadmap than "83% → 100% envelope" would suggest — and it is
also why continuing to push the envelope metric would have been the wrong investment.

---

## 7. What to do first

1. **C1**, because nothing else has a place to attach until it exists, and it converts Wave 4 from
   wired-but-unusable into usable.
2. **Open a `CLAUDE_BIN`-style override PR against the user's doperpowers fork**, early rather than at
   C6. It is a one-line change, it is the integration seam the whole clone track depends on, and
   landing it first means C2 can be tested against the real scripts the day it works instead of
   waiting for a big-bang integration. (F2 established this is the *only* viable seam — the
   file-registry alternative is guarded and fragile.)
3. **Flip the live-test auth default** to no-token (interactive credential) per F4 — strictly more
   capability at identical billing, and it unblocks the plan-utilization surface in C5.

**Already done this session** (the two experiments that would otherwise have opened C2): the
co-registration probe (F2, negative — design changed as a result) and the auth-mode probe
(F4, positive — `probes/probes/55-rate-limits-oauth.ts`, a 🚫 retired).
