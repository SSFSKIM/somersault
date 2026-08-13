# M4 — the review domain (agent app-server)

**Status:** design, awaiting approval. Grounded by three research passes and one live probe, all committed
on `m4-review`.

## Why this, and why now

M3 made the app server a fleet surface: a browser console or IDE can list, adopt, drive and stop sessions
it did not spawn (58 methods / 26 notifications). The remaining Codex-only domains are review, config
write, thread search/archive, and a reverse-request channel. **Review is first** because it is the one
with a clear user-facing payoff, no architectural conflict, and — as the grounding showed — a surface so
small that most of the work is representation rather than machinery.

The purpose is narrow and worth stating plainly: **a client can ask a thread to review a target and
receive findings it can render** — anchored to file and line, severity-tagged, and stable enough to drive
a UI. Not "run a review command and print text".

## What Codex actually ships (grounded, not assumed)

From `grounding/2026-08-13-codex-review-domain-ground.md` (~150 cited references):

- **One method.** `review/start {threadId, target, delivery?}` → `{turn, reviewThreadId}`
  (`app-server-protocol/src/protocol/common.rs:908-912`, params in `protocol/v2/review.rs:17-37`). No
  cancel, no list, no review-specific notification — it reuses `turn/started`, `item/*`, `turn/completed`.
- **The unit of work is a target descriptor, not a diff** (`protocol/v2/review.rs:39-64`): four variants —
  `uncommittedChanges`, `baseBranch{branch}`, `commit{sha,title?}`, `custom{instructions}`. Codex never
  computes or injects a diff; it writes an English prompt naming the target and lets the reviewing agent
  run `git` through its own shell tool. The only host-side git is a `merge-base` subprocess for the
  base-branch case.
- **Two delivery paths.** *Inline* runs a child Codex session with a replaced system prompt and splices
  its event stream onto the parent turn by re-stamping every event with the parent turn id
  (`core/src/tasks/review.rs:95-181`). *Detached* forks a thread and runs an ordinary turn pointed at a
  bundled review skill.
- **Findings never reach a client structured.** `ReviewFinding` (title, body, confidence, priority, path,
  line range) exists only inside `codex-core` and is flattened to one plain-text string before delivery;
  it appears nowhere in the generated v2 JSON schema. Codex sends the model no schema at all and recovers
  structure with a three-step JSON-scraping fallback.

## What we ship

### The surface

`review/start {threadId, target, delivery?}` → `{turn, reviewThreadId}` — **Codex's shape verbatim**,
including the four target variants. Adopting the names costs nothing and keeps the parity scorecard
legible; inventing our own would make every future comparison a translation exercise.

### The mechanism (this is the part that differs, and it is simpler)

A review is **an ordinary turn** on a review thread, driven by a generated prompt that names the target
and instructs the model to report via `ReportFindings`. There is no child session, no event re-stamping,
no second engine loop.

Findings are harvested by **intercepting the `ReportFindings` tool_use on the frame stream the app server
already maps into items**, reading the findings out of the tool call's `input`. Probe 109 settled every
premise this rests on against the live SDK (0.3.227): the tool is present and callable in a default
headless session, the model calls it off a plain instruction with no review-specific system prompt, the
payload rides `tool_use.input` and matches the declared shape, and the call completes cleanly. The model
also fetched the subject itself via `Bash` and `Read` — the same "agent gets its own diff" shape Codex
uses, which is why **no server-owned git/diff seam is needed** for the model to see code.

The consequence is that **we ship structured findings where Codex ships a flattened string.** That is a
deliberate improvement on the thing we are porting, not a port of it, and it is available precisely
because our engine already has a native findings contract that Codex's does not.

### Wire representation

- A typed **`review/findings`** notification carrying the harvested array (`file`, `line`, `summary`,
  `short_summary`, `failure_scenario`, `category`, `verdict`, `outcome`) plus the effort `level`.
- A **review item** in the existing item stream, so a client that only subscribes to items still renders
  the review inline with the rest of the turn.
- Everything else is the existing turn lifecycle: `turn/started` → items → `turn/completed`.

### Prose fallback

Probe 109 proves the channel exists and is well-formed; it does not prove the model *always* calls the
tool. When a review turn ends with no `ReportFindings` call, the assistant prose is delivered as the
review result with `findings: []` and an explicit `unstructured: true` marker — honest about what
happened rather than reporting "no defects found".

### Base-branch resolution

`baseBranch` needs a merge-base, which the model cannot be trusted to compute consistently. The host
resolves it once and names the resulting range in the prompt. **Prior art to reuse rather than rebuild:**
`CC-to-SDK/claude-plugin-codex/plugins/claude-companion/` already contains a tested 346-line pure-git diff
module with a merge-base resolver and a diff-sizing rule, plus review prompts and a findings JSON Schema.

## Acceptance (behavior, not implementation)

1. A client calls `review/start` with `uncommittedChanges` against a thread in a dirty repo and receives
   `{turn, reviewThreadId}`; a `review/findings` notification then arrives whose findings each carry a
   `file` that exists in that repo and a `summary`.
2. A planted defect is found: a file with a known off-by-one produces at least one finding anchored to
   that file with a `failure_scenario` naming concrete inputs.
3. `baseBranch` against a branch with two commits reviews the range from the merge-base, not the whole
   history — a file changed only on the base branch produces no finding.
4. A review that ends without a `ReportFindings` call yields `findings: []` with `unstructured: true` and
   the prose retained — never a silent "clean".
5. `delivery: "inline"` is refused with a specific, actionable error naming detached as the supported
   path (M4 scope; see D-M4-2).
6. The scorecard's drift gate stays green with the new method rowed, and the generated JSON-Schema
   artifacts include the review types.

## Decision Log

- **D-M4-1 — Structured findings, not Codex-parity text.** Rejected: flattening to a string for strict
  parity. The whole reason to have a findings contract is to drive a UI, our engine hands us one for free
  (probe 109), and the scorecard tracks capability, not byte-identical output. We have deviated
  deliberately before on the same reasoning (decisions-as-state over reverse-RPC).
- **D-M4-2 — Detached delivery only in M4.** Rejected: (a) *inline as an ordinary turn on the caller's
  thread* — cheap, but it contaminates the conversation with review content, which is exactly what
  Codex's child session exists to prevent; (b) *child-session splice* — closest to Codex, but it depends
  on re-stamping a child's events onto a parent turn, which the SDK does not let us do. Inline is
  deferred to a later increment, refused explicitly rather than silently degraded.
- **D-M4-3 — No server-owned diff seam.** Rejected: the server computing a diff and injecting it. Probe
  109 shows the agent fetches its own subject, and `thread/shellCommand` is display-only by design, so a
  server-injected diff would mean a new seam for no gain.
- **D-M4-4 — Adopt Codex's method and target names verbatim.** Rejected: our own vocabulary. Parity
  legibility is worth more than naming taste here.
- **D-M4-5 — Review turns park like any other turn.** Rejected: a "never ask for approval" clamp of the
  kind Codex has. Our decisions-as-state park is the honest behavior for a detached review, and Codex's
  own clamp has questionable reliability (their app-server test expects approval prompts during a review
  — flagged as an open question in the grounding).
- **D-M4-6 — MCP elicitation becomes a fourth decision kind.** See the open fork below; this is the one
  genuine adoption to come out of the reverse-request scoping.

## Open forks (need a decision before planning)

1. **Does the MCP elicitation decision kind ride along in M4?** Our engine already supports elicitation
   (`onElicitation`, live-verified by probe 43b) but the app server has no decision kind for it, so it is
   currently unreachable through the control plane. Adding a fourth kind is small and converts the
   reverse-request research into a shipped deliverable. *Recommendation: yes.*
2. **Is detached-only acceptable for M4?** Inline is the delivery a UI most naturally wants ("review this
   thread's work in place"), and deferring it means the first release is the less obvious one.
   *Recommendation: yes, defer inline* — the honest inline story needs an ephemeral session whose findings
   are emitted onto the parent turn, which is its own increment and should not gate the domain landing.

## Surprises & Discoveries

- **The reverse-request channel largely dissolved on contact.** Of Codex's 11 reverse requests, four are
  already covered by our park model, one (MCP elicitation) needs a decision *kind* rather than a channel,
  five are Codex-internal (two of them dead code), and **exactly one** —
  `item/tool/call`, where the client is the tool runtime — genuinely requires a server→client request,
  and it is a feature we have never built. The evidence ran opposite to the assumption: Codex itself has
  converged toward park-shaped behavior (broadcast approvals, first-answer-wins, byte-identical replay of
  pending requests on resume) while keeping the failure modes a park avoids — no approval timeout, a
  vanished client hangs the turn indefinitely, and their request path lacks the zero-connection guard
  their notification path has.
- **Codex's review domain is one method.** The expectation going in was a domain; it is a single request
  reusing the turn lifecycle. Most of the adoption cost is representation, not machinery.
- **The SDK already had the findings contract we were about to design.** `ReportFindings` has shipped all
  along, default-on, and this project's standing policy recorded it as "rely-on, not consume".

## Outcomes & Retrospective

Pending — written at finish.

## Revision Notes

- 2026-08-13 rev 1: initial design, grounded by `2026-08-13-codex-review-domain-ground.md`,
  `2026-08-13-reverse-request-scoping-ground.md`, `2026-08-13-our-review-substrate-ground.md`, and probe
  109.
