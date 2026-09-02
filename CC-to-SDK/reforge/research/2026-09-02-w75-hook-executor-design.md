# The hook executors — the campaign's first S-module design pass

**Pin 2.1.251 · written 2026-09-02 (W7.5/C10.5) · this document GATES implementation**

> **Revised 2026-09-02 after C10.5's boundary review.** Because this document is the brief for the
> C10.6–C10.8 executor waves, every sentence a reviewer showed to be wrong was corrected in place
> rather than annotated: `Fq`'s call-site count and its transitive reachability through `d6n`;
> `Wie`'s count and its third consumer `DUt`; the `AM` dedupe key's one environment read; the
> async-detection example in §5(b), which was wrong about the mechanism while right about the
> capability; the `IE` correction, which was stated as a contradiction of something the ledger never
> claimed; the `AE` caller count the ledger actually names; and the classifier cap, now cited.

`subsystem/hook-dispatch` has been `spliced` since W5 and cannot close. Twenty-two dispatchers are
owned — every per-event entry point the engine is measured to fire headlessly except the
model-switch pair — and every one of them delegates into an execution layer nobody owns. This is
the design pass §2.3 requires before that layer is reimplemented: what it is, what its port surface
actually is, where the cut lines go, what an oracle can and cannot see, and what the honest staging
looks like.

It is deliberately a design pass and not an implementation. The measurement below changed the size
of the problem by a factor of two, and the campaign's own rule is that an S-module is design-first.

---

## 1. The target is twice the size the campaign has been quoting

The ledger, the spec and the README all describe the gap as "the 23 KB generator executor (`Qxt`,
with `Rzn`/`Xxt`/`jy`), its awaiting sibling `AE`, and the watcher-hooks helper `zxt`" — call it
30 KB across three functions plus three helpers. Measured against the pin:

| symbol | bytes | call sites | what it is |
|---|---|---|---|
| `Qxt` | **23,385** | 2 | the streaming executor: 20 destructured options, matching, five invocation kinds, timeouts, cancellation, aggregation |
| `AE` | **6,323** | **13** | the awaiting sibling: 9 options, a flat array return, no attachments, no yields |
| `Nq` | **7,209** | 5 | **the command-hook subprocess runner** — called by BOTH executors, and by three non-hook callers |
| `Fq` | **5,993** | **5** | **the JSON-contract interpreter** — hook output → result fields. Reached only through `Qxt`, one of them transitively |
| `Rzn` | 3,129 | 2 | matcher evaluation, per-type dedupe, `if:` conditions, the SessionStart/Setup HTTP ban |
| `Xxt` | 964 | 2 | the delegated-observation result filter |
| `Wie` | 398 | **4** | **the matcher-source fan-out** — which layers contribute matchers at all |
| `jy` | 261 | 19 | the shutdown wrapper |
| `zxt` | 298 | 2 | the watcher-hooks helper |

Plus a helper belt of roughly **13.9 KB** across ~34 already-pure functions (`Czn`, `xPe`, `Ypt`,
`AM`, `$Me`, `PUt`, `Xpt`, `D5n`, `iMt`, `Lq`, `Yxt`, …), the model-facing evaluators `Cxt` (5,156 B)
and `Oxt` (4,074 B), the served-call pair `U5n`/`H5n` (4,585 B), and the session registry class
`k2e` (1,867 B).

**So the layer is ~42.5 KB of executor across seven functions, plus ~14 KB of helpers — about
56 KB, not 30 KB.** `Nq` and `Fq` are the mass, and neither was named in any prior scoping.

**Two of those call-site counts were corrected by C10.5's boundary review**, and both corrections
change something an implementer would do:

- **`Fq` has five call sites, not four.** The fifth is a spread — `...Fq(` inside `d6n`
  (`chunk-fy12d89p.js` @3084902), the `function`/callback arm's per-hook body. An
  identifier-boundary regex that excludes a preceding `.` skips it. `d6n` has exactly one caller of
  its own (`Qxt` @3055332, a `yield await`), so **"reached only through `Qxt`" survives, but
  transitively** — an owned `Fq` must satisfy two callers, not one, and the second reaches it through
  a function that is itself only `Qxt`'s.
- **`Wie` has four call sites, not five.** The fifth occurrence is its own declaration. The four are
  `Rzn` (@3045351), `Qxt` (@3051548), and **`DUt` TWICE** (@3044856, @3044911). `DUt` is not an
  executor: it calls `Wie` for `UserPromptSubmit` with and without `managedHooksOnly` and
  `JSON.stringify`s the pair into a fingerprint of the session's prompt-submit hooks for the host.
  So `HookSourcePort` has a consumer outside `Rzn`/`Qxt` — recorded on the port in §3.2.

### Three names the campaign has been using are wrong, and each changes a design decision

1. **`getMatchingHooks` is two functions.** `Rzn` does *matching*. **`Wie`** (398 B, 5 call sites)
   does *source resolution* — it is where the settings layers, the policy gates and the session
   registry are read. Owning `Rzn` alone owns no sources, which would make the owned matcher a
   function of inputs nobody produced.
2. **The ledger and the spec name `IE` where the design needs `k2e`.** They call `IE` "the lookup
   the executor consults unconditionally", which is accurate as far as it goes: `IE` (310 B) is a
   composed *layer reader* — gate, SDK-callback global store, four policy filters, then
   concatenation with the settings snapshot and the main-thread agent hooks. What neither names is
   the STORE those layers read through: **`class k2e`** (1,867 B), instantiated per session and
   passed in as `sessionHooks` / `sessionHooksRegistry`. Its fields are **public**, not
   ECMAScript-private — the single most important structural fact for this design, because W10's Bash
   executor is blocked on exactly the opposite (see §7). The correction is an addition, not a
   contradiction: an inventory that stops at the layer reader never reaches the fact that decides
   whether this subsystem is ownable at all.
3. **`jy` suppresses on SHUTDOWN, not on headlessness.** Its predicate reads one process-wide
   `committed` boolean, set only in exit paths. On shutdown, six events *hang forever* on a promise
   that never settles and every other event returns silently. Calling it "the headless-suppression
   wrapper" — as C8's note and this repository's ledger both do — describes a filter that does not
   exist and hides a fail-closed gate that does.

Two smaller corrections: `Xxt`'s predicate is specifically *delegated-observation* subagents, not
agent context generally; and `AE` has **13** callers, not the **six** the ledger names ("six await a
second executor (`AE`) because their callers have no conversation left to stream into").

---

## 2. `AE` is not `Qxt`'s wrapper, and that decides the architecture

The obvious design — one owned core, two façades — is wrong, and the measurement says so.

The two executors share their first ~892 bytes in behaviour: trust refusal, match, the empty and
pre-aborted returns, the same telemetry event computed by the same helpers, the same stringify. But
their callee sets overlap by **30 of 87 (`Qxt`) and 30 of 38 (`AE`)** — `AE` calls almost nothing
`Qxt` does not, while `Qxt` calls 57 things `AE` never touches — and everything after the front
matter diverges:

- **Disjoint return types.** `Qxt` yields attachments, permission behaviours, updated inputs and
  messages. `AE` resolves to a flat array of `{command, succeeded, output, blocked, watchPaths?,
  systemMessage?, cancelled?}`. There is no yield, no attachment, no permission surface.
- **`AE` never calls `Fq`.** It re-derives `blocked` and `output` inline and honours only
  `decision === "block"`, `reason`, `systemMessage` and two `hookSpecificOutput` fields. The entire
  permission contract — `permissionDecision`, `updatedInput`, `additionalContext`,
  `classifierContext`, `retry`, elicitation responses, `sessionTitle`, `reloadSkills`,
  `continue:false` — is **silently ignored** on the awaiting path.
- **Two arms are stubs.** `prompt` and `agent` return "not yet supported outside REPL".
- **Ordering differs.** `AE` is `Promise.all` — results in hook index order. `Qxt` merges with
  unbounded concurrency — results in completion order.
- **Shutdown differs and is stronger in `AE`**: every event except SessionEnd hangs, with no
  allowlist, and SessionEnd is exempt precisely so shutdown can run it.

**Design consequence, and it is the load-bearing one: model them as two consumers of shared pure
helpers, not one core with two façades.** A unified core with a projection layer would make `AE`
honour fields upstream drops, which is an observable behaviour change on PreCompact, SessionEnd,
FileChanged, CwdChanged, Notification and eight other events — i.e. exactly the class of "improvement"
the parity gate exists to catch, arriving in the one place the gate is weakest (the awaiting path has
no yields to compare).

---

## 3. The port surface

### 3.1 What the executors read and write

Grouped by kind; each entry is READ unless marked.

**Hook definitions** — managed policy settings hooks; the settings-layer snapshot; main-thread agent
hooks; the **SDK-callback global store** (READ by the executors, **WRITTEN** by the initialize
handler mid-session, with a change signal); six policy gates; the composed layer read; and the
**session hooks registry** (`k2e`: READ by matching, **WRITTEN** by SessionEnd's `clear` and
indirectly by the `onHookSuccess` closures the aggregation loop invokes). Lifetime: the stores are
host-global and mutate mid-session, so every read is per-invocation and none may be cached.

**Cancellation and time** — the caller's `AbortSignal`; a derived signal + timer created **per hook**
and requiring cleanup; the timeout constants; the process-wide shutdown flag; a never-settling
promise; the clock and uuid stamped into every attachment; a 1 Hz progress poller per command hook;
a nested `AbortController` per agent hook.

**Child processes** — spawn, stream accumulation, an async-detection path that can background a hook
into a registry that outlives the call.

**HTTP** — one POST with allowlist, header env interpolation, proxy discovery, pinned DNS.

**MCP** — the global client accessor, ensure-connected, call-tool, a global timeout cap, and a
cgroup cap release that mutates a host-scoped server list.

**Model** — one structured query for prompt hooks; a full nested agent loop with a synthetic agent
id, a temporary transcript grant and a 50-turn cap for agent hooks.

**Environment reads** — subprocess env, cwd, original cwd, home, platform, **default shell**, shell
discovery, terminal size, path existence, plugin user config and data dir, the session env file, the
transcript path. One of these reaches further up than it looks: **the dedupe key `AM` is not pure.**
Its `command` arm is
`` `command\x00${e.shell ?? UD()}\x00${e.command}\x00…` `` and `UD()` (`chunk-2z83fvw5`) is
`as() ? "bash" : "powershell"` — a platform read. So the matcher's per-type dedupe, which §4 lists on
the pure side, needs exactly one `EnvironmentPort` member (`defaultShell()`) injected. It is one
argument, but it is the difference between an owned dedupe that reproduces upstream on Windows and
one that silently collapses two distinct command hooks into one.

**Conversation-visible events** — three record kinds enqueued into the interleaved stream. **These
are output, not telemetry**, and the distinction is a design decision (§3.2, port 7).

**Telemetry** — debug and error logs, `tengu_*` events, OTel events and spans, a duration metric,
feature health, a plugin-usage ledger, a plugin activity ring buffer, plugin metrics.

**Persistence** — hook output over 10,000 characters is written to disk and replaced by a reference
string.

**Host UI and shared caches** — raw terminal-escape writes; a failure-notice singleton holding an
emitter, a six-slot table and an 8-entry LRU; a session-env cache reset reached only from `zxt`.

**Dedupe / memo state** — a per-call stdin JSON memo, and four **process-global, never-reset** sets:
surfaced spawn failures keyed `event:command`, bare-MCP-matcher warnings, missing-cwd warnings, and
pending async-rewake promises.

**Served-call attestation** — 4,585 B of filesystem-reach judgement, reachable only when the caller
carries a remote call.

### 3.2 The proposed partition — nine ports, one of them conditional

**The cut rule: anything that returns data goes behind a read-shaped port and leaves the logic that
consumes it owned and pure; anything that owns identity or a lifecycle goes behind a handle-shaped
port.** That is what makes the pure mass (§4) actually owned rather than nominally owned.

1. **`HookSourcePort`** — `policy()`, `configuredMatchers(event)`, `sessionMatchers(sessionIds, event)`,
   `sessionFunctionMatchers(sessionId, event)`, `sessionEntry(sessionId, event, matcher, hook)`,
   `clearSession(sessionId)`, `toolAliases()`.
   *One port because three mechanisms answer one question* — "which matchers exist for this event?" —
   and the **merge order is the only observable thing about them**. Behind it, `Wie` + `IE` + `oT`
   become data and `Rzn`'s 3.1 KB of dedupe, `if:` evaluation and regex matching becomes an owned
   function — *pure except for one `EnvironmentPort.defaultShell()` read*, which the dedupe key `AM`
   needs (§3.1). The port must be re-read per invocation: the stores mutate mid-session, and that
   race is the mechanism behind the SessionStart-callback-silence timing artifact already recorded.
   **Its consumers are `Rzn`, `Qxt` AND `DUt`** — the last one a non-executor that fingerprints the
   session's `UserPromptSubmit` hooks for the host by calling `Wie` twice, with and without
   `managedHooksOnly`. So the port's shape must serve a caller that wants the raw matcher lists and
   nothing else, which is an argument for keeping `configuredMatchers`/`sessionMatchers` as separate
   members rather than fusing them into one resolved answer.

2. **`SchedulingPort`** — `derive(parent, timeoutMs) -> {signal, cleanup}`, `now()`, `isoNow()`,
   `uuid()`, `isShuttingDown()`, `hang()`, `isStreamClosedAbort(e)`, `pollProgress(getOutput, onTick)`.
   *One port because every member is a per-hook create/dispose pair or a clock read, and an oracle
   must control all of them together or it controls none.* Keeping `hang()` here rather than
   inventing a shutdown port leaves `jy` and `AE`'s shutdown guard as two-line owned predicates.

3. **`ProcessPort`** — `run(spec) -> CommandResult`, `adoptBackground(handle, meta)`.
   `spec` is **fully resolved data**: argv or shell command, env table, cwd, stdin, timeout, signal,
   async policy. *This cut is what makes the design pay*: roughly 4.5 KB of `Nq` is env assembly,
   plugin-variable substitution, shell selection and Windows branching, and behind this port that
   becomes a pure `buildCommandSpec(...)`. Only spawn, stream accumulation and async detection stay
   behind the port. It also isolates the one place `Nq` spills outside hooks — the statusline,
   file-suggestion and device-hook callers can share the same port.

4. **`TransportPort`** — `http(req)`, `httpPolicy()`, `mcpClients()`, `mcpEnsureConnected()`,
   `mcpCall()`, `mcpReleaseServerCap()`.
   *HTTP and MCP together because both are "send a serialized hook input somewhere, get text back",
   both fail into the same three-shape result, and neither owns state outliving a call except a
   read.* Splitting them doubles the stub surface for no behavioural distinction.

5. **`ModelPort`** — `evaluateCondition(req)`, `runAgentHook(req)`.
   *Deliberately coarse.* The two evaluators are 9.2 KB and they reach the model loop and the agent
   loop. Own the system prompt text and the JSON schema as data — that is the interesting part and it
   is pure — and port the single "run it" call. A finer cut here costs the whole engine and buys
   nothing this subsystem needs.

6. **`EnvironmentPort`** — the fifteen reads listed in §3.1.
   *Separate from `ProcessPort` because they are all reads and all trivially stubbable, and because
   they are precisely what turns the command-spec builder into a pure function.* Fusing them would
   make that builder untestable without a spawn stub.

7. **`EventStreamPort`** — `enabled(event)`, `started(rec)`, `progress(rec)`, `response(rec)`.
   *Its own port, and not part of telemetry, because these enqueue into the interleaved stream the
   SDK yields to the caller.* They are output: the oracle compares them by value. Everything in
   `TelemetryPort` it compares by trace, or not at all.

8. **`TelemetryPort`** — the logging, event, OTel, metric, span, feature-health and plugin-ledger
   calls, plus the three `once*` predicates.
   *The `once*` predicates live here because their only observable effect is whether a message is
   emitted, and they are the process-global sets a replay must be able to reset.* Putting them
   elsewhere scatters global reset across ports.

9. **`HostEffectsPort`** — `persistLargeOutput()`, `writeTerminalSequence()`, `noteHookFailure()`,
   `invalidateSessionEnvCache()`.
   *One port for four one-line writes into host singletons.* Four ports for four one-line writes is
   not a design.

**Conditional: `ServedCallPort`** — `describeEnvironment()`, `judgeProgram()`. 4,585 B of
filesystem-reach analysis with nothing to do with hook semantics, unreachable unless the caller
carries a remote call. Behind it the whole served-call branch reduces to three pure decisions. If the
headless corpus never sets a remote call — and it does not — this port may ship as a throwing stub
with the branch graded by its guard alone, which is an honest exclusion rather than dead owned code.

Ports 1, 2, 7 and 8 are needed by both executors; 3–6 and 9 by `Qxt`; `AE` needs 3, 4, 6 and a subset
of 8.

---

## 4. What is pure, and therefore what ownership actually buys

**Already pure, as free functions of their inputs:** ~13.9 KB across ~34 helpers — the JSON-contract
interpreter (5,993 B, needing only an injected clock and uuid), the match query builder, the two
output parsers, the served-call refusal and rewrite, the matcher regex test, the missing-script
heuristic, the delegated-observation filter, and two dozen leaf predicates.

**Pure with ONE injected read:** the dedupe key `AM`, whose `command` arm falls back to `UD()` —
`as() ? "bash" : "powershell"` — when a hook declares no `shell`. One `EnvironmentPort.defaultShell()`
argument makes it pure; leaving it out makes the owned dedupe wrong on Windows and right on every
machine that would notice.

**Pure once ported:** the command-spec builder (~4.5 KB of `Nq`), the matcher body minus source
resolution (~2.6 KB of `Rzn`), `Qxt`'s aggregation projection table and permission-precedence reducer
(~3.3 KB), `AE`'s per-arm output derivation (~1.2 KB), and `Qxt`'s exit-code interpretation table
(~1.4 KB).

**Irreducibly effectful:** spawn and stream handling (~2.7 KB), the HTTP POST and proxy discovery,
the MCP connect/call, the two model paths (9.2 KB, essentially all of it), the derived-signal pair,
background adoption, the disk write, every interleaved enqueue, every telemetry call, the served-call
reach analysis, and the registry's own mutation.

**Rounded: of ~56 KB, about 27 KB is pure or pure-once-ported and about 29 KB is effect
orchestration** — and 9.2 KB of that effect side is the two model arms. With a coarse `ModelPort` and
a stubbed `ServedCallPort`, **the effectful residue an owned implementation must actually write is
about 12 KB.** That is the number that makes this tractable, and it is a direct consequence of the
port cuts in §3.2 rather than of optimism about the target.

---

## 5. The grading surface, and three things that make it hard

The oracle shape is settled doctrine: extract the pinned upstream body, bind it to UPSTREAM's own
helpers (never the wave's), drive the owned side through its adapter with the manifest's derived
captures, and compare output **and** a port trace. Three things here are new.

**(a) The merge is nondeterministic.** `Qxt` races its per-hook generators with unbounded
concurrency, so yield ORDER across hooks depends on wall-clock timing. `AE` does not have this
problem. A yield-sequence comparison is sound only for single-hook cases; multi-hook cases must be
compared as **per-hook subsequences plus a global multiset**, and the corpus needs at least one
deliberately multi-hook scenario to exercise the merge at all.

**(b) Chunk boundaries are semantic — though not in the way this document first said.** The
`data` handler is

```js
Tn = (Yn) => { if (Sn += Yn, fn += Yn, !hn) {
  let xr = wr(Sn).trim();          // wr = first line of the ACCUMULATED stdout
  if (!xr.includes("}")) return;   // not yet — wait for more
  hn = !0;                         // spent, once and for all
  try { let er = V(xr); … } catch (er) { /* debug log only */ }
} };
```

It parses the accumulated buffer, not the individual write, so the tempting example is wrong: a hook
printing `{"async"` and then `:true}` in two writes behaves **identically** to one printing
`{"async":true}` in a single write. The first write leaves no `}` in the first line and returns; the
second re-reads the whole buffer and parses it.

The sensitivity is real but narrower, and it is a one-shot latch. If a write ends *after* a nested
closing brace — a hook emitting `{"a":{"b":1}` and then `,"async":true}` — the first line already
contains `}`, so `hn` is set, `V` parses a truncated document, the `catch` logs and returns, and **the
complete document that arrives next is never examined**. Byte-equal stdout delivered in a different
number of writes is therefore different behaviour, and a replay harness must reproduce stdout
CHUNKING, not just stdout bytes — which no surface in this campaign currently does. The capability
stays on Stage 0; only the example changes.

**(c) The shutdown arm never settles.** Any oracle that awaits the executor to completion deadlocks
on that path. It has to be graded as "produced no yields and did not settle within N ms", driven by
stubbing `SchedulingPort.isShuttingDown()`.

**Arms that differ only by effect** — these need the trace, and an output comparison would pass on
all of them: the per-invocation telemetry suppression flag (zero yields differ, every telemetry call
disappears); the interleaved-event enable flag, which is off for 31 of 33 events and makes success
and error on the command path yield the same attachment shape; the **second** occurrence of a given
`event:command` spawn failure, which yields a message-less error where the first yields a message —
gradeable only by sequencing two identical failures in one scenario, with the port resettable between
replays; and two other once-per-process warnings of the same shape.

**Arms that refuse before any effect** — grade the guard, not the trace: the trust refusal, the empty
match, the pre-aborted signal, the internal-callback fast path, the served-call filters and held
verdicts, the matcher miss, the `if:` filter, the SessionStart/Setup HTTP ban, three policy gates,
the shutdown guard, and the confined-session grant strip. The correct assertion for each is "no port
other than `HookSourcePort` was touched."

**This is where the tech-debt tracker's interleaved-event-log rewrite unlocks.** That entry deferred
replacing the hooks oracle's per-port call lists with one ordered event log, on the explicit ground
that the dispatchers are straight-line and "the hook EXECUTOR itself is the obvious candidate: it
spawns processes, races timeouts and propagates cancellation, and for that one interleaving IS the
behaviour." The measurement confirms it and adds a second reason the entry did not anticipate: the
**cleanup pairing** for derived signals. The command arm cleans up on six different paths plus its
catch, and "every derived signal was cleaned exactly once" is a property only an ordered log can
state. So the rewrite is not optional here — it is a precondition, and it must land before or with
the first executor module rather than after.

**Injection points the oracle must own:** the attachment clock and uuid, the hook-id generator,
`Date.now()` behind every duration, the 10,000-character persistence threshold and the reference path
it returns, the classifier cap, and the default timeout constant itself.

The classifier cap was named without a citation in this document's first draft and C10.5's review
could not find it; it is real and here it is. The constant is **`fP = 2000`**
(`chunk-fy12d89p.js` @669804), applied through `ce(value, fP)` — a surrogate-safe head truncation in
`chunk-04aem4bh.js` @954 — at the aggregation site @3068735, whose debug line reads
`provided classifierContext (${…} chars after cap)`. It is enforced at exactly one place inside this
layer, so it is one injection point, not a family. The bound is also asserted in the hook-output
schema's own prose ("Capped at 2000 UTF-16 code units"), which is where a reader looking for a
`.max(2000)` would fail to find one — the schema does not enforce it, the executor does.

---

## 6. Staging — and the honest verdict on scope

The charter says the design pass gates the implementation. Having done the pass, the recommendation
is that **the implementation is not a completions-wave item**, for reasons that are properties of the
target rather than of the schedule:

- the target is ~56 KB, not the ~30 KB every prior scoping assumed;
- three of the pieces (`Nq`, `Fq`, `Wie`) were not in any prior scope at all, and one of them spills
  outside this subsystem;
- the oracle needs a machinery change (the interleaved event log) *before* the first module, plus
  two new capabilities it does not have (stdout chunk reproduction, non-settling-path grading);
- the corpus needs at least one multi-hook scenario and one repeated-spawn-failure scenario that do
  not exist, purely to make the merge and the once-per-process arms gradeable.

Forcing it into this wave would produce the shape the campaign has already paid for twice: a module
shipped ahead of its oracle, where "the debt is real and the interest is invisible" (C8). The staging
that follows from the design:

**Stage 0 — machinery (must precede any executor module).** Rewrite the hooks oracle's trace as one
interleaved event log with cleanup pairing, retiring the tech-debt entry; teach the replay surface to
reproduce stdout chunking; add non-settling-path grading.

**Stage 1 — the pure belt, no ports.** The ~13.9 KB of already-pure helpers, led by the JSON-contract
interpreter (5,993 B), which is the single highest-yield unit in the layer: it is what turns hook
output into behaviour, its five call sites are all `Qxt`'s (four directly, one through `d6n`), and it
is a pure function of its input given an injected clock. Graded entirely by the contract-test shape,
no scenario needed.

**Stage 2 — `HookSourcePort` + the matcher.** Sources behind the port, the matching body owned pure
except for the one `EnvironmentPort.defaultShell()` read the dedupe key needs. This is what makes
"which hooks ran, in which order" an owned decision, and its execution order is by hook TYPE with
dedupe that deliberately does not apply to callbacks — a contract nothing currently states. The port
serves three consumers, not two: `Rzn`, `Qxt` and the host-facing fingerprint `DUt`.

**Stage 3 — `AE`.** The smaller executor, taken as its own consumer of the Stage-1 belt. Its
`Promise.all` ordering makes it gradeable without the merge machinery, and thirteen callers give it
the widest existing coverage in the family.

**Stage 4 — `ProcessPort` + the command-spec builder.** The largest pure win outside Stage 1, and the
point at which the statusline and file-suggestion callers get a shared seam.

**Stage 5 — `Qxt`.** The merge, the aggregation projection, the permission-precedence reducer and the
five arms, on top of everything above.

`zxt` (298 B) rides with Stage 3 — it is `AE` plus a cache reset and a three-field projection, and it
is the only thing standing between the two watcher dispatchers and a closed edge.

**What closes the ledger row.** `subsystem/hook-dispatch` reaches `standalone-complete` at the end of
Stage 5, not before — but Stages 1–3 are individually shippable, individually gradeable, and each
moves the row's evidence. The recommendation was that they be scoped as their own wave rather than
folded into a wave that owns something else.

**That cut was made on 2026-09-02**, in the campaign spec's Deferred section under "The executor
cut": three children, each reviewed before the next is cut, with this document as the brief for all
three.

| child | stages | track |
|---|---|---|
| **C10.6 / W7.6a** | 0–1 — the oracle machinery, then the pure belt led by `Fq` | controlled, opus-tier |
| **C10.7 / W7.6b** | 2–3 — `HookSourcePort` + the matcher, then `AE` and `zxt` | fable-tier |
| **C10.8 / W7.6c** | 4–5 — `ProcessPort` + the command-spec builder, then `Qxt` | fable-tier |

The reason for three children rather than one wave is Stage 0: it is oracle machinery **only this
subsystem needs**, so a wave that owned something else would carry it as overhead and be tempted to
skip it — which is precisely how a module ends up shipped ahead of its oracle. C10.6 also carries the
module-level-state reset obligation of §7 item 7, because it is a harness change and every later
stage's replay depends on it.

---

## 7. Risks an implementer will hit

1. **The default timeout is ten minutes, not sixty seconds.** `Li = 600000`
   (`chunk-fy12d89p.js` @1070693) — one declaration, 34 references, never reassigned. An owned copy that "corrects" it changes real behaviour and would trip the
   equality assertion the existing adapters already carry. The SessionEnd timeout really is 1.5
   seconds.
2. **The subprocess runner is not hooks-only.** Three non-hook callers share it. Owning it either
   drags them in or requires the port to serve both — decide deliberately, and prefer the port.
3. **Do not unify the two executors** (§2). Their return types are disjoint and the awaiting one
   deliberately drops the permission contract.
4. **Match order is execution order, and it is by hook TYPE** — command, prompt, agent, http,
   mcp_tool, callback, function — with settings order preserved only within a type. Dedupe keys are
   undefined for callback and function hooks, so **registering the same callback twice runs it
   twice**. Both are contracts an owned matcher must reproduce and neither is written down anywhere
   today.
5. **All progress messages precede all execution.** One per matched hook, yielded before the first
   hook runs. Interleaving them would change the stream.
6. **The contract interpreter throws** on an unknown decision or a mismatched event name. Inside the
   per-hook generator that becomes a non-blocking-error yield whose message can then be suppressed by
   the once-per-process set; on the internal-callback fast path there is **no try/catch**, so the
   same throw propagates out of the executor to the dispatcher.
7. **Module-level mutable state survives across calls** — the failure-notice singleton, the shutdown
   flag, six host-scoped lazy singletons and a plugin-usage map. None of it is per-session, so a
   replay that does not reset it leaks between scenarios. This is a harness obligation, not an
   implementation detail.
8. **Live bindings are observable.** The source reads happen at call time, so hook registration
   racing dispatch is a real behaviour — and it is the mechanism behind an artifact this repository
   has already recorded once.
9. **Windows and PowerShell branch in five places** inside the subprocess runner, and the exec form
   (args present) bypasses the shell on every platform with a different substitution path. The
   `${user_config.*}` substitution is *refused* in shell form because the value would be re-parsed.
10. **The delegated-observation filter drops `message` entirely** and forwards a blocking error only
    for PreToolUse, so a Stop hook's block is invisible inside such a subagent; a result reduced to
    an empty object is not yielded at all.
11. **The captured stream-closed abort is rethrown LAST**, after siblings drain and all telemetry
    runs. Rethrowing early loses the completion event and the span close.
12. **Good news, and it is the reason this is tractable at all:** the session registry uses **public**
    class fields. W10's Bash executor is blocked because its state lives in ECMAScript private fields
    that a whole-body excision cannot marshal. This one does not have that problem — the registry can
    cross the adapter boundary as a typed port over its nine public methods. **The campaign's first
    S-module is the right first S-module.**
