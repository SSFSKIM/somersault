# SDK Potential — Realized vs. Available

> Companion to `parity.json` / `roadmap.md`. Those score **Claude Code feature parity** (551 CC
> features → SDK). This scores the inverse: **of the Agent SDK's own capability envelope, how much
> have we actually realized?** Measured 2026-06-17 against `@anthropic-ai/claude-agent-sdk@0.3.178`
> from the installed `.d.ts` and live probes — not the Feb snapshot. **Remeasured 2026-07-17** against
> installed 0.3.178 + npm HEAD 0.3.211 + the live web docs (30 pages) — see §7 for the drift + the
> refreshed frontier list. **The forward plan now lives in [`full-potential.md`](full-potential.md)** —
> the exhaustive capability map (~150 rows) + the waved roadmap to 100% of the reachable envelope.
>
> **Shipped since first draft:**
> - **Wave 4 — knob completion + drift watch** (2026-07-17, spec/plan `2026-07-17-wave4-knob-completion`,
>   probes 53/53b/54): **the Options long tail closed** — 27 new first-class `HarnessConfig` fields
>   (sessionId/title/agent/continueSession/abortController/additionalDirectories/skills/toolConfig/
>   strictMcpConfig/betas/maxThinkingTokens/planModeInstructions/permissionPromptToolName/
>   onElicitation/onUserDialog/supportedDialogKinds/spawnClaudeCodeProcess/process-plumbing/debug…) →
>   **all 63 declared Options fields now modeled**; probe 53 verified sessionId/title/agent/
>   structured_output/betas ALIVE, probes 53/53b settled `includeHookEvents` + `promptSuggestions`
>   **DEAD headless** and `agentProgressSummaries` PARTIAL (wired with caveats); **`runStructured<T>()`**
>   (Zod → draft-7 json_schema → validated `structured_output`; the CLI's ajv rejects zod's default
>   2020-12 meta-schema — caught live); **tool annotations** on all 15 tools across the 5 MCP servers
>   (probe 54: extras accepted); **the drift ritual** — `scripts/drift-check.mjs` (name-level installed-vs-npm-HEAD
>   diff, false-clean guard) + `docs/parity/drift-ritual.md`; first run 0.3.211→0.3.212 zero drift.
> - **Wave 3 — production-service maturity** (2026-07-17, spec/plan `2026-07-17-wave3-production-maturity`,
>   probes 51/52/52b): **OTel** typed `telemetry` config + daemon-wide + guide/compose demo (probe 51:
>   env-gated OTLP ALIVE headless — 4 metrics + 6 log-event types, session.id/prompt.id attrs, NO traces);
>   **warm-spawn pool** (`createWarmPool` delegating-broker slots + daemon `warmPool:{size}` warm path);
>   **external session-store** (`createRedisSessionStore` + `sessionStoreConformance` + `mirrorErrors` +
>   flush/timeout knobs; cross-host resume live-proven; SDK rejects checkpointing+store → auto-off);
>   **secure deployment** (`tenantHarnessConfig` + guide; typed `sandbox.credentials`); **runtime MCP
>   topology** (Session methods + daemon `mcp_*` ops + `/mcp`; toggle is ADVISORY — on-demand bring-up
>   resurrects disabled servers). Envelope ~71%→~78%.
> - **Session persistence spine** (domain 5) — `resume` / `persistSession` / `sessionStore` config
>   passthrough, `resumeHarness()`, `--resume` / `--no-persist` CLI flags, daemon `spawn({resume})`.
>   Spec `specs/2026-06-17-session-persistence-spine-design.md`, commits `99cab31..583f0db`.
> - **Observability read API** (domain 6) — `src/sessions/reader.ts` (`listSessions` /
>   `getSessionMessages` / `getSessionInfo`, `cwd`→`dir`), `Harness.getContextUsage()` / `accountInfo()`,
>   daemon `sessions` / `messages` ops + `context_usage` / `account_info` control frames.
>   Spec `specs/2026-06-17-observability-read-api-design.md`, commits `798ea5b..14f8c09`.
> - **Context introspection tool** (domain 6, *agent-facing*) — `src/context/server.ts` `cc-context` MCP
>   server with one `GetContextUsage` tool (`summarizeUsage` → `{percentUsed, tokensUsed, maxTokens,
>   tokensRemaining, status}`), opt-in via `createHarness({ contextTool })` and daemon-wide
>   `DaemonOptions.contextTool`; late-bound `QueryHolder` seam (no re-entrancy deadlock). Read-only.
>   Spec `specs/2026-06-17-context-introspection-tool-design.md`, commits `eb4415a..9fd074b`.
> - **Self-compaction** (domain 1/6, context lifecycle) — config knobs `autoCompactEnabled`/`autoCompactWindow`
>   (→ `options.settings`, all paths), a daemon on-demand `compact()` op (`DaemonSession.compact()` injects
>   `/compact` via a shared `enqueueTurn`, parses `compact_result`/`compact_boundary` → `CompactOutcome`), and an
>   opt-in agent-facing `cc-compact` `RequestCompaction` tool that fires `/compact` at the turn boundary
>   (intent flag consumed in `readLoop`, fire-and-forget, own FIFO waiter). On-demand is **daemon-only** (no
>   `Query.compact()` method; one-shot has no input queue). Live: 31590→5664 tokens. Spec
>   `specs/2026-06-17-self-compaction-design.md`, commits `0faf597..b62d006`.
> - **Lib interactive `Session` primitive** (domain 5/1/6) — `src/session/session.ts` promotes
>   `DaemonSession`'s streaming engine into a public, daemon-independent `Session` (open → `submit` turns →
>   `compact()`/control/`getContextUsage`/`rewind` → `.sessionId` (captured from `init`, capture-once) →
>   `resume` → `dispose`), `openSession`/`resumeSession` factories, a `stream()` convenience; `DaemonSession`
>   is now a thin `extends Session` subclass (129→19 lines). **Lifts the "multi-turn = daemon-only" restriction:**
>   on-demand `compact()`, `cc-context`, and the control surface now work library-side too. Spec
>   `specs/2026-06-17-lib-session-primitive-design.md`, commits `d0e209a..c87a414`. Live 3/3 (stable sessionId,
>   compact, resume round-trip preserving the id). Keystone of the 3-spec session cluster (Specs 2 & 3 depend on `.sessionId`).
> - **Daemon durable sessions** (domain 5) — `SessionRecord` gains `sessionId` (captured from `Session.sessionId`,
>   persisted in `supervisor.submit()`); on-failure `restart()` now RESUMES that captured sdk session (context
>   intact) instead of going fresh (the `supervisor.ts:248` bug). Resumes the CAPTURED id, not the spawn-time hint;
>   fresh if none captured (graceful degradation). Link-not-swap (registry stays the operational store; the SDK
>   owns the transcript). Spec `specs/2026-06-17-daemon-durable-sessions-design.md`, commits `42acf43..880d0a5`.
>   Live 1/1 (a daemon turn captured a real UUID; that id resumed + recalled).
> - **Session forking** (domain 5) — `src/sessions/fork.ts` `forkSession(id, opts?)` wraps the SDK fork fn
>   (`cwd`→`dir` + DI, mirrors `reader.ts`) + a daemon `fork` op (`supervisor.fork(id)` reads the live
>   `Session.sessionId`, mints a fork, spawns a new session resuming it). Fork MINTS a new id (original
>   untouched), reached via `resumeSession(forkId)` — the explicit branch, vs `resume` which preserves the id.
>   Spec `specs/2026-06-17-session-forking-design.md`, commits `d968a1b..7abd8c4`. Live 1/1 (the branch recalled
>   the pre-fork codeword but NOT the original's post-fork one — a true independent branch). **Completes the
>   3-spec session cluster.**
> - **SDK capability closeout** (P1–P4 frontier, 2026-06-18) — three parts on existing seams: **(A) turn
>   controls** `effort`/`thinking`/`maxBudgetUsd`/`taskBudget`/`includePartialMessages`/`forwardSubagentText`
>   via `resolveOptions` passthrough (domain 1); **(B) introspection methods** `usage()`/`initializationResult()`
>   on `Harness`+`Session`, `applyFlagSettings()` on `Session`, + daemon `usage`/`init`/`apply_flag_settings`
>   ops (domains 6/9); **(C) session-store mutation** `renameSession`/`tagSession`/`deleteSession` lib wrappers
>   + daemon `rename`/`tag`/`delete` ops (domain 5). Live-probed first (probes 11–15); `maxBudgetUsd` is
>   pass-through-don't-swallow (exceed-path is throw OR empty result, timing-dependent); `taskBudget` opus-4-8-only;
>   `usage()` wraps the unstable SDK method name. Spec `specs/2026-06-18-sdk-capability-closeout-design.md`,
>   commits `83762229c6..ee389d80da` (6 tasks, subagent-driven). Unit 340/340, live 6/6 keyed.
> - **Daemon boot-rehydration** (domain 5, 2026-06-18) — the last non-knob session item: a restarted daemon
>   transparently re-adopts the sessions it owned instead of reaping them. Lazy + opt-in: `SessionRegistry.rehydrate(pid)`
>   claims orphaned-resumable records (reaps errored/no-sessionId, leaves live-pid alone) and the `restart` policy is
>   now persisted on `SessionRecord`; `DaemonSupervisor` gains a `rehydrate` flag + an `ensureLive(id)` seam that
>   revives a claimed session on first access (resumes the captured `sessionId` — continue, not branch) — **no subprocess
>   at boot, no new daemon op, `server.ts` untouched.** Graceful `stop`/`shutdown` forget unrevived claims (only a crash
>   rehydrates). Premise live-verified (probe 16, cross-process resume). Spec `specs/2026-06-18-daemon-boot-rehydration-design.md`,
>   commits `8931bf97f8..5bb3339bbf` (4 tasks, subagent-driven). Unit 348/348, live 1/1 keyed. **The session cluster +
>   its durability story are now complete.**
> - **Public-API hardening** (harden-and-ship sub-project 2, 2026-06-18) — a packaging/quality milestone (no new
>   SDK capability, so no domain-% change): the public boundary of `src/index.ts` is now **curated** (5 plumbing
>   exports pruned), **validated** (zod `HarnessConfigError` fail-fast guard at every front door, matching — not
>   exceeding — the SDK), **leak-free** (teardown-liveness sweep across Session/harness/daemon/swarm — all surfaces
>   already correct, invariants now locked), and **frozen** (44-name surface snapshot + `harness/API-STABILITY.md`
>   tiers). Keyless (no live test). Commits `f9aab5ac00..12e74819b1` (6 tasks). Unit 366/366. The harness is now
>   publish-ready (still `private:true`). See memory `harden-and-ship-over-phase3`.
> - **Public-API docs** (harden-and-ship sub-project 3, 2026-06-18) — a documentation milestone (no new SDK
>   capability, so no domain-% change): `harness/README.md` is **rewritten** around the frozen 44-export surface
>   (a tour of all 9 core surfaces with runnable examples, the refreshed `HarnessConfig` table, the CC-faithful
>   bridges de-Phase-framed); `package.json` gains **publish metadata** (`description`/`keywords`/`repository`/
>   `homepage`/`license: Apache-2.0`); and a **self-maintaining drift gate** (`test/unit/readme.test.ts`) asserts
>   every `cc-harness` import in the README is a real export (value names from `Object.keys(index.js)`, type names
>   from `index.ts` source) so the docs can't silently rot. Keyless. Commits `9977f73dcf..9e9d906af3` (3 tasks).
>   Unit 368/368. Front door now accurate + complete (still `private:true`). See memory `harden-and-ship-over-phase3`.
> - **Test & CI hardening** (harden-and-ship sub-project 4, 2026-06-18) — an enforcement milestone (no new SDK
>   capability): CC-to-SDK had **zero CI**; this adds `.github/workflows/cc-to-sdk.yml`, a **keyless** gate that
>   runs `npm ci → typecheck → build → test:unit → verify:pack` on Node **[18, 22]**, path-scoped to `CC-to-SDK/**`
>   (disjoint from the upstream Rust syncs the fork receives) with SHA-pinned house actions + least-privilege
>   `permissions: contents: read`. So the guards sub-projects 2–3 built (frozen surface, README-drift, validation,
>   teardown) are now **enforced on every change**, not just on demand. One file, no source/lockfile change (`npm ci`
>   verified green as-is). Commit `3103c675b5` (+ hardening `c1c2a69f88`). **With this, the whole harden-and-ship
>   track — packaging · boundary · docs · test+CI — is COMPLETE.** See memory `harden-and-ship-over-phase3`.
> - **Increment A — harness defaults & daemon config parity** (2026-06-20) — **[corrected 2026-08-06 by
>   Wave T: the `auto` half of this is no longer harness-*wide*.** `DEFAULTS.permissionMode` is untouched,
>   so headless `-p`, `--bg`, the daemon and every library caller still open in `auto` — but an
>   **interactive host** (`ccx`, and `ccx --detachable`, scoped to the host *kind* rather than to one call
>   site) is now born in `default`/Manual, because the QA fleet caught `rm` and `git init` executing
>   unconsulted in a fresh foreground REPL. See `tui-ux.md`'s Wave T section.**]** `resolveOptions` centrally
>   enforces opus-4-8 · xhigh · auto as harness-wide defaults (auto model-gate centralized so every
>   `createHarness`/`openSession`/`resumeSession` caller is born auto-safe); daemon `makeSession` now routes
>   through `resolveOptions` (closing the bare-daemon gap: a `spawn({})` with no model/mode picks up the CC
>   system-prompt preset, `settingSources`, tool preset, and the opus-4-8 default — live-proved no-400 via
>   gated e2e `test/live/daemon-defaults.e2e.test.ts`).
> - **TUI/UX parity round (`cc-harness-chat`, 2026-06-29)** — a 13-increment push (U1–U13) bringing the
>   interactive REPL to the look-and-feel of the real Claude Code, scored in the new **`tui-ux.md`**
>   scorecard (the source of truth for *visual/interaction* parity, vs this file's *SDK-capability* parity):
>   welcome banner, the authentic ✻ asterisk-pulse spinner with the 187 random verbs + live tokens +
>   esc-to-interrupt, `●`/`⎿` message identity, inline markdown spans, `!` bash + `#` memory modes,
>   queued-while-busy input, readline editor keys (Ctrl-A/E/K/U/W) + placeholder + Ctrl-C/D/L, the CC-style
>   numbered permission dialog, `/cost`+`/status`, and a context-threshold warning. Overall TUI/UX parity
>   **~46% → ~82%**; **entirely `tui/`-side** (one tiny harness-agnostic addition: none — no `harness/src`
>   change). Domain 10 below.
> - **TUI clone fidelity waves F0–F5 (2026-08-02 → 2026-08-05)** — the ~82% above was measured against a
>   stale February reference; re-derived against the real 2.1.220 bundle it is **~63%**, and the fidelity
>   waves are the work of closing that honestly. F0 removed the user-harm cases, F1 unified the renderer on
>   one retained transcript document, **F2 replaced every `useInput` callback with a declarative keymap**
>   — one binding table, an ordered-context resolver, generic chords, `~/.claude/keybindings.json` with hot
>   reload, and hint strings derived from the live binding rather than typed beside the handler — and
>   **F3 rebuilt the live turn**: the fold row's genuinely bold count via a raw-SGR writer, a thinking clock
>   that outlives its turn, 19 typed result-row templates, the Write create preview, the subagent unit with
>   an honest sidecar→notification→derived totals ladder, same-API-message Agent batches, and the
>   `ctrl+b` background hint. F3 left the headline at **~65%** by arithmetic, because the five upstream
>   surfaces it gave §2 rows for enlarged the denominator by exactly as much as the wave closed, and one
>   over-shipped §8 row was deleted; see `tui-ux.md`'s F3 recount for the split. F3 also recorded **six
>   upstream behaviours as provably unreachable** (probes 84/85 plus two bundle reads: Bash stdout is
>   wire-silent, hooks execute invisibly, the auto-classifier annotates nothing, and the elapsed suffix and
>   conjugation table are fullscreen-only dead code) — those are excluded from the denominator rather than
>   approximated. **F4 then closed the static transcript** — everything the reader looks at once a turn is
>   over: the lightweight markdown renderer was replaced by a `marked` token walker transcribing the
>   bundle's own node switch (nested and `start`-honouring lists, task lists, blockquote rail, `hr`,
>   depth-varying headings), box tables with per-column alignment and a rule between every data-row pair,
>   OSC-8 links / images / strikethrough behind their real terminal-capability gates, the Edit/Write diff
>   rebuilt as a **source ladder** (recognized sidecar → disk-anchored local diff → visibly approximate,
>   never a confident wrong line number) feeding a banded renderer with word-level highlighting and no cap,
>   the corrected prompt and assistant identity glyphs with a 10 000-char prompt fold, thinking hidden by
>   default with upstream's `∴` detail form, and the **user-frame sentinel router** that decides whether a
>   `user` frame is a prompt at all (12 of `ERe`'s 15 exits, plus error sentinels, system notices, the
>   compact boundary and teammate attribution), taking §2 from 62.5% to 70.4% and the headline to ~66%.
>   **F5 then closed the composer** — everything that happens before Enter: `[Pasted text #N +M lines]`
>   chips with atomic deletion, paste-again-to-expand and a persisted content-hash cache; a prompt history
>   that survives a relaunch (`history.jsonl` in upstream's own line shape, whole-scan newest-wins dedup, a
>   per-index edit cache, the bash-mode filter); the queue drained back into the buffer by Up; the
>   placeholder's four-rule ladder over a git-seeded `Try "…"` pool; upstream's trigger and accept contracts
>   (Tab accepts, Enter accepts *and* executes) with mid-text ghost text and the inline `argumentHint`; one
>   popup at `DXe`'s real geometry; a debounced async `@`-walk whose directories complete iteratively; and
>   both history-search surfaces. TUI/UX parity now **~67%**: §1 rises 85.7% → 87.9% on three promoted rows
>   and three new ✅ rows, while one previously-✅ row (`@`-mention) is marked down on the
>   longest-common-prefix Tab that closing three census gaps made visible, and two new 🟡 rows grow its
>   denominator from 28 to 33. **Named remaining gaps, honestly:** fenced-code and diff-body syntax
>   highlighting covers 10 languages where upstream covers ~383 (the largest single gap); the composer's
>   own residue is small and named (lane-A common-prefix Tab, the popup's query highlighting, `ctrl+b`
>   shadowed by our background binding, no paste-cache eviction) but **three real-TTY checks are owed** —
>   the external-editor stdin handoff, the bracketed-paste mode round trips, and the frame at real widths,
>   all of which were only ever exercised through `ink-testing-library`; F7 has not started on the chrome
>   surfaces (`statusLine`, the notification queue, terminal title, the exclusive below-composer hint slot);
>   F6 has not started on the dialog surfaces (§4's `Select`/`Tabs` primitives, `DiffDialog`,
>   `EnterPlanMode`, the 13-kind permission matrix). The keybinding detail is `tui-ux.md` §1a; the live-turn
>   detail is its F3 section, the static-transcript detail its F4 section and the composer detail its F5
>   section. Still `tui/`-side only — no `harness/src`
>   capability change, so no domain score below moves. Spec
>   `docs/superpowers/specs/2026-07-31-tui-clone-fidelity-design.md`.
> - **TUI clone F6 + Wave T (2026-08-06)** — F6 closed the **dialog** surfaces (the `Select`/`Tabs`
>   primitives, upstream's six-arm permission kind registry, the `Ready to code?` plan dialog, both pickers,
>   the todo and `Background` panels, `/help`'s tabbed dialog) and **Wave T** — the first wave driven by the
>   QA fleet rather than the census — closed the **trust** surfaces: the interactive REPL now launches in
>   `default`/Manual with banner, status chip and engine agreeing; entering `auto` prints Claude Code's own
>   safety notice once per install; consults advertise escape/amend/explain and an empty amend collapses the
>   row instead of silently denying; approving a plan grants the mode its label names on both the host and
>   app-server wires; `system/api_retry` frames replace the spinner with a live countdown; turn results are
>   classified by `is_error` rather than `subtype`, so a dead connection is no longer judged a success; and
>   entering bypass permissions requires accepting a warning on every interactive door (`--dangerously-skip-permissions`,
>   `--permission-mode bypassPermissions`, `--detachable`, `/yolo`), with `--bg` into bypass refused outright.
>   TUI/UX parity is **~71%** (`tui-ux.md`, post-Wave-T recount: §3 and §4 each gain one to two new rows;
>   nothing previously counted changes state). **No domain score below moves.** Wave T *does* touch
>   `harness/src` — `cli/main.ts`, `cli/hostMain.ts`, `config/resolveOptions.ts`, `host/host.ts`,
>   `session/turnResult.ts`, `permissions/types.ts` and `appserver/{planUpgrade,turns,registry,server}.ts` —
>   but it consumes no new SDK surface: every lever it uses (`permissionMode`, `setPermissionMode`,
>   `setModel`, `canUseTool`, the `system`/`result` frame stream) was already modeled. Two live probes ran:
>   **96** (transport-failure surface) and **97** (plan-decision wire shape) grounded the spec, **98** settled
>   whether a one-off model call is reachable from this harness at all, and **99** corrected a standing
>   premise — see the domain-3 and domain-10 notes below. Spec
>   `docs/superpowers/specs/2026-08-06-wave-t-trust-safety-design.md`.
> - **Waves R + S (2026-08-08/09)** — the QA sprint's second and third waves. **Wave R (repaint &
>   geometry, 13 tasks — its omission from this list until now was an oversight; the retrospective lives in
>   the spec)** made the frame the unit of truth: one repaint primitive owns every full-screen reset, the
>   resize matrix runs as CI (`npm run test:resize-matrix`), and four QA premises fell to measurement.
>   **Wave S (session truth, 13 tasks, spec `2026-08-07-wave-s-session-truth-design.md`) closed the gap
>   between what the session IS and what the REPL says it is**: the rewind rebuild reads the SDK reader's
>   already-resolved branch (W-S1 inverted at spec time — no `parentUuid` walking); every
>   dialog whose height derives from `rows` sits behind one `paneOwned` gate with a derivation-based
>   membership rule; `/cost`, `/context` and the token surfaces are transcriptions of upstream's two
>   compact formatters routed per-surface (my one-formatter collapse was itself the wave's lesson);
>   the context percentage dies with the conversation it measured (`replaceDocument` is the boundary;
>   `/compact` re-measures on the spot — premise live-verified by probe 82 on the compact_boundary frame);
>   `ccx --continue` ships and `--resume` resolves every id form ccx itself prints (full UUID validated
>   against the directory's listing, `/status`'s 8-char prefix, the fleet banner's short id — five loud
>   outcomes, none a fresh REPL; a deliberate, recorded extension, W-S6); `/resume` gains its cancel line,
>   two backed widen controls (Ctrl+A/Ctrl+W — `includeWorktrees:false` proven live; Ctrl+B stays
>   CTRL-B-1) and a preview count sharing the pane's predicate; `/compact` gets a real busy state with
>   upstream's fake saturating curve labelled as theatre; and mid-conversation model switches confirm
>   before the prefs write, with the ack dying at the same conversation boundary as every other
>   measurement. Verification (Task 13) executed every acceptance cell as written — full suite + build,
>   eight keyless cells, nine keyed live cells under an isolated pty (evidence in the spec's Outcomes) —
>   and its own yield was a live-only defect fixed same-day: a resumed session presented as EMPTY to
>   rewind/stats until its first turn. TUI/UX parity: see `tui-ux.md`. **No domain score below moves** —
>   like Wave T this consumes no new SDK surface; probe 82 is the one new probe.
> - **Wave C (2026-08-10)** — the QA sprint's last wave; **F7 (chrome) is no longer "not started"**.
>   Fifteen tasks, A1–A15 all pass (keyed cells live over OAuth). The chrome surfaces exist and speak
>   upstream's language: one-row footer with the right-aligned region (ChatStatusBar deleted); the full
>   **statusLine** stack (user-settings config with field-drop semantics, silent-failure runner —
>   nonzero/spawn-fail/timeout/exception all yield "keep the previous text" — 300 ms debounced driver,
>   upstream's payload key inventory, dim forced over the script's own ANSI in raw SGR); the
>   **notification queue** (immediate/high/medium/low, fold, invalidates, pinned dedup) and its
>   below-composer slot; **terminal title** (OSC 0, ✳/⠂⠐ busy alternation, ai-title, kill switch);
>   the **token-warning ladder** on the queue (ceiling corrected mid-wave to upstream's real
>   window − 33 000 — the spec's ×0.8 had cited the compaction pre-warming fraction); the
>   **follow-up suggestion** generated by a warm haiku session behind a deny-all broker (upstream's
>   32-line prompt verbatim, thirteen-rule post-filter, off by default — built because probe 100
>   proved the SDK's own suggestion channel dead headless); **effort surfaces end to end** (picker
>   row, `/effort` dialog, `set_effort` wire op → `applyFlagSettings({effortLevel})` with client-side
>   validation since probe 102 proved the SDK validates nothing, engine-swap replay, decaying hint);
>   **banner truth** (resolved model, ` ccx v0.1.0 `, probe-101 billing mapping under a bounded
>   accountInfo race). Owner decisions executed: `#` memory mode REMOVED, inline ctx%%/usageWarn/bg
>   chips REMOVED (info survives via statusLine payload, `/status`, the queue). Three new probes
>   (100/101/102) — see domain notes; the `set_effort` op is the wave's one new wire surface.
>   TUI/UX parity: see `tui-ux.md`. Spec `docs/superpowers/specs/2026-08-09-wave-c-chrome-composer-design.md`.
> - **QA wave-2 delta (2026-08-11)** — the second QA sweep's repair wave: ten tasks against the ranked
>   worklist in `docs/parity/qa-sweep-2-triage.md` §3, acceptance A1–A10 all passing as written after a
>   two-cell fix round. **No domain score below moves, and that is the accurate result** — almost all of it
>   is fidelity *inside* capability rows this file already claimed: `/copy` reading the live wire and dying
>   with its conversation; consult dialogs submitting an amended denial instead of reverting it; the effort
>   picker becoming a stage-commit-discard transaction with a working Haiku lock; the `statusLine` payload
>   speaking canon's contract (`transcript_path`, `prompt_id`, a never-null `session_id`, `fast_mode`,
>   `rate_limits`, and a failed command **removing** the row — reversing a Wave C divergence decided off
>   sweep-1 testimony); resize bursts settling once and tall dialogs resyncing on grow; the `/resume`
>   preview rendering the projected transcript instead of raw persisted text; `ctrl+c` reaching the exit arm
>   over six overlay contexts; and SDK warnings leaving the Ink frame for a debug seam. **Three SDK-level
>   facts came out of it, all probed live and all recorded in the domain rows below:** the deny arm's
>   `interrupt` field ends a turn (probe 106 — domain 3, and it corrects probe 66's standing premise),
>   `transcript_path`/`prompt_id` are reachable only by latching the headless-firing `UserPromptSubmit`
>   hook (probe `104b-userpromptsubmit-transcript-path` — domain 8), and a pre-turn `getContextUsage()`
>   resolves with real numbers but costs ~1.2 s warm (probe 103 — domain 6). TUI/UX parity: see `tui-ux.md`
>   (overall flat at ~75%; §3 up on the resize row, §2/§4/§5 down on four newly named gaps). Spec
>   `docs/superpowers/specs/2026-08-11-qa-wave-2-delta-design.md`.
>   **Probe-number collision, RESOLVED 2026-08-12:** this wave's probe collided with the app-server M2b
>   `104-readfile.ts` and has been renamed `104b-userpromptsubmit-transcript-path.ts` (the repo's existing
>   `b`-suffix convention). Bare "probe 104" in wave-2 ledger prose means the hook probe; cite by filename.

> - **SDK 0.3.211 bump + Workflow surfacing** (2026-07-17) — all four packages bumped ^0.3.178→^0.3.211
>   (typecheck/build/unit green everywhere; the 0.3.211 removals touch nothing we import). Re-probe: probe 36
>   re-verified REACHABLE on 0.3.211; after an auth interruption (the old subscription OAuth token was
>   rejected account-side; user re-minted) the **full live suite is GREEN — 40/40** across all 22 files.
>   Two failures were root-caused and fixed along the way: (1) a REAL 2.1.211-surfaced bug — the standalone
>   `taskTools` path never disallowed the native Task tools (unlike the swarm/daemon paths), so on 2.1.211
>   the model picked native `TaskCreate` over the deferred `mcp__cc-tasks__*` and wrote to the WRONG store
>   (the D3-shadowing lesson); now disallowed + unit-locked; live re-verified. (2) a stale test premise —
>   `daemon-permissions.e2e` spawned bare expecting default-mode parking, but Increment A made bare spawns
>   auto-mode (which bypasses the broker); the test now requests `permissionMode:"default"` explicitly.
>   **Workflow SHIPPED opt-in**:
>   `HarnessConfig.workflow` (default false — a workflow is a cost multiplier) allowlists
>   `Workflow`+`TaskOutput`/`TaskGet`/`TaskList` AND advertises the async launch→`TaskOutput` retrieval
>   pattern via `WORKFLOW_NOTE` (the 33d lesson: unadvertised capability is inert). Unit 438/438; gated
>   live e2e `test/live/workflow.e2e.test.ts` written, pending working auth. Domain 7 ~50%→~58%.

## How to read this

"How much of the SDK have we used?" has two honest denominators:

1. **Raw API surface** — how many of the SDK's typed knobs we touch (§3). A *low* number here is the
   intended design: 313 of 551 CC features are verdict `provided`, i.e. the SDK already does them
   natively, so consuming more of the API would mean re-implementing what is free.
2. **Capability envelope** — of everything the SDK *makes possible*, how much have we turned into
   working harness capability (§2). This is the number that answers "considering the SDK's full
   potential, how much have we made?"

**Headline (2026-07-17 remeasure):** roughly **~63% of the SDK's reachable capability envelope** — the
numerator grew since 2026-06-17 (structured `outputFormat` now consumed by the app-server; probes 35/36
flipped two priors — MCP tools are ToolSearch-deferred i.e. token-cheap, and the native `Workflow`
orchestrator RUNS headlessly), but the *denominator grew faster*: the live docs + 0.3.211 expose whole
sub-surfaces we haven't touched (OpenTelemetry, hosting/warm-spawn, sandbox credential redaction, runtime
MCP control, `resumeSessionAt`). Same story as before at finer grain — strong
(60–90%) on the *execution & orchestration* half (turn loop, tools, permissions, multi-agent,
settings, autonomy). The *state & observability* half has now largely closed, and the **SDK capability
closeout** (2026-06-18) pushed the last ready-made frontiers in: **turn controls** (`effort`/`thinking`/
`maxBudgetUsd`/`taskBudget`/`includePartialMessages`/`forwardSubagentText` — domain 1 → ~85%),
**introspection methods** (`usage()`/`initializationResult()`/`applyFlagSettings()` — domain 6 → ~88%),
and **session-store mutation** (`rename`/`tag`/`delete`) now join the persistence
cluster, observability read API, agent-facing context tools, and programmatic hooks (domain 8) already
built. **Daemon-process boot-rehydration** (2026-06-18) then closed the last non-knob session item — a
restarted daemon re-adopts its sessions and resumes their context on first access (domain 5 → ~93%). The
remaining frontiers are narrow and mostly out of reach: `toolConfig` shaping, and rate-limit surfacing
(`null` on API-key auth — bridge-coupled).

---

## §1 — Verification status legend

- **✅ built** — shipped in `harness/src`, unit + (mostly) live tested.
- **🟡 verified-unused** — probed live this session, works headlessly, not yet wired into the harness.
- **⚪ untouched** — available in the SDK, neither built nor probed.
- **🚫 unreachable** — bridge-/claude.ai-coupled or build-internal; out by definition.

---

## §2 — Capability-domain scorecard

Each domain is a slice of the SDK's potential. "Realized" = fraction turned into working harness
capability, weighted by what is *reachable* (🚫 items excluded from the denominator).

| # | Capability domain | Realized | State | Evidence / gap |
|---|---|---|---|---|
| 1 | **Turn execution & streaming** — `query()` loop, streaming I/O, partial messages, `thinking`/`effort`, `maxTurns`/`maxBudgetUsd`/`taskBudget`, compaction | **~88%** | ✅ built | `daemon/session` drives `query()` via a shared `Session` engine; **multi-turn lib-side** (`openSession`/`Session.submit`/`stream`); **compaction built**; **turn controls SHIPPED** (closeout) — `effort`/`thinking`/`maxBudgetUsd`/`taskBudget`/`includePartialMessages`/`forwardSubagentText` config passthrough (`maxBudgetUsd` exceed-path is pass-through-don't-swallow; `taskBudget` opus-4-8-only; partial frames already flow through `stream()`). **W4.2 `runStructured<T>()`** — Zod→draft-7 json_schema→validated `structured_output` (probe 53 ✅; the CLI's ajv rejects zod's default 2020-12 meta-schema). Remaining: deeper partial-stream ergonomics |
| 2 | **Tool system** — 37 native tools (default-on), `createSdkMcpServer`+`tool()`, allow/deny/`toolAliases`, `toolConfig`, runtime MCP topology | ~80% | ✅ | 3 MCP servers built (tasks/swarm/brief); gating wired; **runtime MCP topology SHIPPED (W3.5)** — `Session.setMcpServers/toggleMcpServer/reconnectMcpServer/mcpServerStatus/setMcpPermissionModeOverride` + daemon `mcp_*` ops + chat-REPL `/mcp` (probes 52/52b: toggle ADVISORY, reconnect stdio-only, add/remove both types); **W4**: `toolConfig` first-class + annotations (title/readOnly/destructive hints + searchHints) on all 15 tools across the 5 servers (probe 54) |
| 3 | **Permission & safety** — 6 `permissionMode`s, `canUseTool`, `sandbox`, `allowDangerouslySkip` | ~83% | ✅ | **6/6 modes** now characterized (default/plan/auto/bypass + `acceptEdits`/`dontAsk` added in closeout — `acceptEdits` keeps the `canUseTool` broker for non-edits, `dontAsk` replaces it); `canUseTool` broker in swarm; sandbox modeled; **W3.4**: typed `sandbox.credentials` (probe 48 deny verified) + `tenantHarnessConfig` secure-deployment preset (settings/state/secret/proxy/attribution isolation; live deny proof + guide). **GB (2026-07-28) — control-plane fidelity SHIPPED**: the permission park generalized to a `kind`-discriminated decision park — `AskUserQuestion` (probe 65: consults `canUseTool` in *every* mode incl. `bypassPermissions`, no `ask` rule needed — previously parked as a raw generic permission with no answer channel at all) and `ExitPlanMode` (probe 66: `deny(message)` loops the model back into planning, `allow` lets the CLI flip `permissionMode` itself) now get first-class dialogs (`QuestionDialog`/`PlanDialog`) with a real answer channel (`updatedInput.answers`/`response`); spec `docs/superpowers/specs/2026-07-28-control-plane-fidelity-design.md`. **Wave T (2026-08-06) — score UNCHANGED at ~83%, and the reason is worth stating: this wave corrected how we *characterize* two of the six modes rather than realizing new envelope.** (a) **Probe 99 overturns a standing premise**: a runtime `setPermissionMode` can be **REFUSED**. `auto` off its supported model set is rejected outright ("Cannot set permission mode to auto: auto mode unavailable for this model") and the session stays in the previous mode — it does **not** silently fall back to `default`, which is what this project had assumed since probe 24; `bypassPermissions` at runtime is refused the same way. Consequence, now built: the plan applier swaps the model **before** granting `auto` (an unswapped grant is *lost*, not degraded), and every refusal is reported instead of swallowed. (b) `allowDangerouslySkipPermissions` gained a **consent gate** on every interactive door and a refusal on `--bg`, and the interactive launch posture moved to `default` while headless/daemon keep `auto` (see the Increment-A correction above). Both are harness/UX behavior over an already-modeled knob, so the fraction does not move. **QA wave-2 delta (2026-08-11) — score UNCHANGED at ~83%, and one standing premise corrected.** Probe 66 recorded that `deny(message)` on `ExitPlanMode` "loops the model back into planning". That is true of the *feedback* arm and wrong as a general rule: a **bare** rejection should end the turn, and ours did not — the harness had papered over the difference by fabricating `"User rejected the plan. Continue planning."` into the deny message, which the model then obeyed. **Probe 106** settles the mechanism: the deny arm's **`interrupt` field** ends the turn outright, the session survives with its id unchanged, and the engine substitutes its own rejection copy, so the harness never has to author an instruction it does not mean. It is now set on the bare arm only. One more field of an already-modeled callback return type is realized, not a new sub-surface, so the fraction stays put |
| 4 | **Multi-agent** — `agents`/`AgentDefinition`, native subagents, `Agent`/`Task*` tools, coordination | ~74% | ✅ | `swarm/` coordinator + bus + teammates; **fork subagent SHIPPED default-on (2026-06-26)** — `forkSubagent` config wires `CLAUDE_CODE_FORK_SUBAGENT=1` + a `FORK_SUBAGENT_NOTE` advertisement through `resolveOptions`/`outputStyle`, so the model AUTONOMOUSLY spawns a transcript-inheriting `subagent_type:"fork"` (probe 33d: env var alone is inert without the advertisement; live 1/1 autonomous end-to-end). `forkSubagent:false` restores clean defaults. Native subagent transcripts (`listSubagents`) still unused. **GB (2026-07-28)**: the REPL's subagent view gained attribution — parked decisions and task-lifecycle notices now carry best-effort subagent attribution (`Subagent (<type>) asks:`) via a host-side `parentToolUseID`→`subagentType` correlation map built from nested/`task_started` frames; a correlation miss renders unattributed and never blocks (spec `2026-07-28-control-plane-fidelity-design.md`; still no per-subagent drill-in transcript view — recorded non-goal) |
| 5 | **Session lifecycle & persistence** — `resume`, `forkSession`, `persistSession`, `sessionStore`, `enableFileCheckpointing`+`rewindFiles` | **~97%** | ✅ built | **Full session cluster shipped (3 of 3):** `resume`/`persistSession`/`sessionStore` config, `resumeHarness()`, CLI flags, daemon `spawn({resume})`, `rewindFiles`; **lib `Session` primitive** (`openSession`/`resumeSession`, multi-turn + `.sessionId` capture + `resume` preserves id); **daemon durable sessions** (`SessionRecord.sessionId` persisted; on-failure `restart()` resumes the captured session); **forking** (`forkSession` lib wrapper + daemon `fork` op — mints a new id, branch reached via resume); **session-store mutation SHIPPED** (closeout) — `renameSession`/`tagSession`/`deleteSession` lib wrappers (mirror `fork.ts`) + daemon `rename`/`tag`/`delete` ops, live-verified CRUD on the default file store; **boot-rehydration SHIPPED** (`daemon-boot-rehydration`, 2026-06-18) — lazy opt-in: a restarted daemon re-adopts orphaned `SessionRecord`s (`SessionRegistry.rehydrate` claims/reaps; `restart` policy now persisted) and revives each on first access via the `ensureLive` seam (`DaemonOptions.rehydrate`, no subprocess at boot / no new daemon op), live-verified cross-instance resume; **W3.3 external store SHIPPED** — `createRedisSessionStore` (RedisLike DI, uuid-idempotent retry-safe) + `sessionStoreConformance` + `Session.mirrorErrors`/daemon count + `sessionStoreFlush`/`sessionStoreLoadTimeoutMs`; cross-host resume live-proven (fresh CONFIG_DIR + store); checkpointing auto-off with a store (SDK rejects the pair); **Postgres adapter SHIPPED** (2026-07-30, execplan `2026-07-30-postgres-session-store`) — `createPostgresSessionStore`/`ensurePostgresSessionStoreSchema`/`postgresSessionStoreDDL` (PgLike DI; in-insert uuid dedup; summary = full re-fold of the committed transcript under generation-token seq-CAS; TEXT payloads — jsonb rejects U+0000/lone surrogates; atomic CTE delete), conformance green on PGlite; hardened through 4 codex rounds |
| 6 | **Introspection & observability** — `getContextUsage`, `usage`, `accountInfo`, `mcpServerStatus`, `listSessions`/`getSessionMessages`/`getSessionInfo`, `supportedModels`/`Commands`/`Agents`, `initializationResult`, **OpenTelemetry** | **~93%** | ✅ built | **Read API + agent-facing tool + introspection methods shipped:** reader module, `Harness.getContextUsage()`/`accountInfo()`, daemon `sessions`/`messages`/`context_usage`/`account_info`; **`cc-context` MCP tool**; **closeout added** `usage()`/`initializationResult()`/`applyFlagSettings()` on `Harness`+`Session` + daemon `usage`/`init`/`apply_flag_settings` ops (live-verified; `usage()` wraps the unstable SDK method name). **W3.1 OpenTelemetry SHIPPED** — typed `telemetry` config → CLI env gates (+ daemon-wide `DaemonOptions.telemetry`), guide + docker-compose demo; probe 51 catalog: `claude_code.*` metrics + 6 log-event types, `session.id`/`prompt.id` attrs (prompt.id joins hooks), NO traces, `logUserPrompts` privacy-off. **W3.2 warm pool** feeds daemon ops (`warm:true` rows). Remaining: `usage().rate_limits` — **probe 55 (2026-07-25) corrects the earlier "bridge-coupled" reading to auth-mode-coupled**: `null` under `CLAUDE_CODE_OAUTH_TOKEN` (the `setup-token` credential lacks the `user:profile` scope) but fully populated under the interactive `~/.claude/.credentials.json` credential. Reachable; surface not yet built. **QA wave-2 delta (2026-08-11) — score UNCHANGED at ~93%; one cost fact about an already-built method, recorded because it changed a design.** `getContextUsage()` resolves **pre-turn with real numbers** (probe 103 — which is what let the `statusLine` payload stop reporting a `context_window_size` of 0 at first paint), but a reviewer **measured** it at ~1.2 s warm, four times the 300 ms debounce the chrome drives it on. "One boot run" and "a real window at first paint" were therefore mutually impossible as first shipped; the run now waits on the mount read against a ~1.5 s cap (D-W11), and `/status` awaits its own fresh measurement rather than reading someone else's. A method being reachable says nothing about what it costs to call on a paint path — the deadline-needs-its-own-measurement lesson, recurring |
| 7 | **Scheduling & autonomy** — proactive self-wake, `Workflow` orchestration, `CronCreate`, `PushNotification`, assistant worker | ~58%¹ | ✅/🚫 | `proactive/` + `kairos/` latch built; **Workflow SHIPPED opt-in (2026-07-17)** — `config.workflow` allowlist + `WORKFLOW_NOTE` advertisement (probe 36 re-verified on 0.3.211); cron dead headless, push has no transport, worker export DELETED in 0.3.211; `/goal` settled DEAD headless (Wave 2 probes 46/46b/46c: "UI command" — all three dispatch forms fail; replicate via the proactive latch); **Monitor + inter-agent SendMessage settled ALIVE** (probes 47, 41/41b: Monitor wakes a full model turn per stdout line; SendMessage = queued-at-next-tool-round to a running named agent) |
| 8 | **Extensibility** — `plugins`, `skills`, **30 hook events**, output styles, dynamic MCP | **~63%** | ✅ | plugins/skills/styles/MCP passthrough; **programmatic hooks shipped** — typed `config.hooks` → `options.hooks` (all 30 reachable), `injectContext`/`guardTool`/`blockTool`/`observe` builders + `mergeHooks` for the live-verified subset (**17 of 30 fire headlessly post-Wave-2** — probes 42/42b/43b added PostToolUseFailure, PostToolBatch, PermissionRequest, TaskCreated/Completed, MessageDisplay, PostCompact, InstructionsLoaded, Elicitation, ElicitationResult; `SessionStart` fires at the /compact boundary; `defer` PARKS the call for the host — no execution, no canUseTool; `PermissionDenied` never fires for callback/hook denials), daemon path via `sessionOptions`. **Increment D SHIPPED — command palette** (`cc-harness-chat`): the live 105-entry slash-command catalog (skills + plugin + user commands, inherited via `settingSources`) is now *surfaced and dispatched* in the chat REPL — an inline `/`-autocomplete (a pure `commandComplete.ts` catalog merge+fuzzy-rank mirroring the `@`-mention path, a `command` state in `editor.ts`, a `CommandPopup` in `ChatComposer` live-fed from `capabilities().commands`, rows showing `argumentHint` per spec) routes LOCAL names to the engine switch and CATALOG names submit-as-prompt (skills/plugins execute as turns — probe 31; built-ins gate headless — probe 21; local wins on a name collision). Keyed-OAuth live e2e proves the catalog is non-empty headless (probe 30 = 105 entries). NO harness change; spec/plan `2026-06-20-command-palette`. Deeper plugin/skill lifecycle integration (disk install, output styles) remains. **QA wave-2 delta (2026-08-11) — score UNCHANGED at ~63%; the first time a hook is consumed for a *product* surface rather than probed.** The `statusLine` payload owes canon two fields, `transcript_path` and `prompt_id`, and neither is on any frame the harness receives — probe `104b-userpromptsubmit-transcript-path.ts` establishes that the headless-firing `UserPromptSubmit` hook is the only route to them, so ccx latches both off the hook into refs beside the statusLine context and clears them at the conversation boundary. Accepted consequence, documented rather than worked around: both are **absent before the first turn**, because `SessionStart` is dormant headlessly (the 17-of-30 reachability finding, now load-bearing instead of informational) |
| 9 | **Settings & config** — `settingSources` cascade, `settings`/`managedSettings`, provider/env, sandbox | ~98% | ✅ | fully modeled in `config/`; **`applyFlagSettings` (mid-session merge) now wired** (closeout — `Session.applyFlagSettings()` + daemon `apply_flag_settings` op, streaming-input only); **W4.1: all 63 Options fields first-class** (the 27-knob long tail incl. sessionId/title/agent/callbacks/process plumbing; 3 wired-but-dead knobs documented) + **the drift ritual** (`scripts/drift-check.mjs` + `docs/parity/drift-ritual.md`) keeps the map current |
| 10 | **Remote / bridge / voice / UI** — `connectRemoteControl`, remote server, voice, Ink TUI | ~72%¹ | ✅/🚫 | `bridge/` control-protocol shim built; **Phase-3 increment 1 SHIPPED — `cc-harness top`, a read-only terminal daemon-observability dashboard** (lightweight, no-Ink `monitor/`: polls `list`+`context_usage`, renders the live pool / ctx% / token usage / proactive heartbeat with idempotent teardown; CLI-internal, public surface unchanged — spec/plan `2026-06-18-daemon-observability-dashboard`). **Phase-3 increment 2 SHIPPED — `cc-harness-console`, an interactive Ink daemon console** (new `cc-harness-tui` package over the core's new public `connectDaemon`/`DaemonClient`: master-detail pool/detail, inject prompts via streaming `submit`, drive control ops — interrupt/setModel/setPermissionMode/compact/fork/proactive — with confirm-gated `stop`; spec/plan `2026-06-18-interactive-daemon-console`). **Phase-3 increment 3 SHIPPED — `cc-harness-chat`, an in-process chat REPL** (in `cc-harness-tui` alongside the console bin: drives a live `openSession`/`Session` in `default` permission mode with rich tool rendering via `render.ts` — bespoke Edit/Write/Bash/Read formatters — and inline permission dialogs via `createPermissionGate`/`PermissionBroker` advanced-seam wired through `uiBroker.ts`/`useChat.ts`; spec/plan `2026-06-19-chat-repl-permission-prompts`). **Phase-3 increment 4 SHIPPED — daemon-attached interactive permissions** (auto-autonomy + poll-based escape-hatch wire: `PendingPermissions` registry parks `default`-mode edit requests via `createPermissionGate`; `DaemonSupervisor.pendingPermissions()`/`respondPermission()` expose the poll/answer surface; clients poll the snapshot `pending` list and answer via `DaemonClient.respondPermission()`; auto-mode sessions bypass the broker entirely — no pending ever queued; gated live e2e confirms both paths; spec/plan `2026-06-19-daemon-permissions`). **Phase-3 increment 5 SHIPPED — live streaming + live status bar** (`cc-harness-chat`): a pure `tui/src/liveTurn.ts` reducer turns SDK partial `stream_event` frames into live token-by-token text, stream-then-collapse thinking (`✦ Thinking`), and in-place tool `⟳ running → ✓/✗ done` status; the status bar shows live model · mode · ctx% · `⟳ streaming`. Engine change is one flag (`includePartialMessages`) — no harness source change. Probe 20 verified partials flow in the multi-turn streaming-input Session path; spec/plan `2026-06-19-chat-live-streaming`. **Phase-3 increment 6 SHIPPED — slash commands** (`cc-harness-chat`): `/model /compact /context /clear /help /resume` intercepted locally (probe 21: the SDK gates /model//help//resume "not available" headless) and dispatched to engine ops already built — `setModel`, `Session.compact`, `getContextUsage`/`summarizeUsage`, `listSessions`/`resumeSession`. A pure `commands.ts` (parser + table + formatters) + a `SessionPicker` modal; `useChat` is now factory-owned so `/resume` swaps the session (marker+continue). No new harness exports; spec/plan `2026-06-19-chat-slash-commands`. **Phase-3 increment 7 SHIPPED — rich tool rendering + display-G** (`cc-harness-chat`): subagent (`Agent`) turns nest under their parent via `parent_tool_use_id` and collapse-on-done (`⚙ Agent … ✓ (N tools · Ts)`); a pinned `TaskPanel` live-reduces native `TaskCreate`/`TaskUpdate` ops (probe 22b: the SDK has no `TodoWrite`); inline Edit/Write diffs; a status-bar subagent indicator. Two pure reducers (`liveTurn` extended, new `taskList`) + a clock injection; one flag (`forwardSubagentText`, already plumbed) — no harness change. Probes 22/22b verified nesting reachable headless; spec/plan `2026-06-19-chat-rich-tool-rendering`. **Phase-3 increment 8 SHIPPED — input ergonomics** (`cc-harness-chat`): a new multiline editor replaces the single-line input — `\`-continuation + multi-line paste (probe `ink-paste-key-delivery`: a paste is one `useInput` call), in-memory prompt history (Up/Down recall with draft stash/restore), and `@`-mention fuzzy file completion (recursive walk with basic ignores, path-token insert). A pure `editor.ts` reducer + a pure `fileComplete.ts` ranker (injected `readdir`) + a thin `ChatComposer.tsx`; the shared console `<Composer>` is untouched. No harness change; spec/plan `2026-06-19-chat-input-ergonomics`. **Phase-3 increment 9 SHIPPED — session resume/continue** (`cc-harness-chat`): resume now *renders the conversation you're rejoining* — launch `--resume <id>` / `--continue` (most-recent), a `/continue` command, and the incr-6 `/resume` picker all converge on one `resumeInto` that fetches `getSessionMessages` first (empty → notice, no swap) then replays the transcript full-fidelity. A pure `replay.ts` reuses `render.ts` (`renderMessage` promoted to render prompts + delegate Edit/Write diffs to the shared `toolDiffLines`), skips tool_result bodies, caps the last ~200 messages, and frames the block with resumed/live dividers. Probe 23 verified the persisted message shape = the live shape; no harness change; spec/plan `2026-06-20-session-resume-continue`. **Phase-3 increment 10 SHIPPED — mature `auto` + graceful permission ladder** (`cc-harness-chat`): `Tab` now cycles `default → acceptEdits → auto` (bypass gated behind `/yolo` + `--permission-mode`); the `auto` rung self-heals the model live (`setModel` to a supported model + a notice) since `auto` is the model-gated headless classifier (probe 24: it bypasses the broker entirely — no inline dialog for safe ops, and actively blocks dangerous ones). The `auto` model-gate is now centralized in `resolveOptions` (every lib/`createHarness` caller is born auto-safe, not just the daemon), `resolveAutoModel`/`isAutoSupportedModel` are exported (advanced-seam), and the console's `cyclePermissionMode→auto` issues a `setModel` repair op. Probe 24 verified the lib-seam auto behavior + runtime enable/repair; spec/plan `2026-06-20-auto-permission-ladder`. **Phase-3 increment 11 SHIPPED — interactive thinking-budget control** (`cc-harness-chat` + console): a `/think <off|low|medium|high|xhigh|max|N>` command sets the extended-thinking budget at runtime via the already-built `Session.setMaxThinkingTokens` lever (probe 25: it takes effect mid-session and `0` disables thinking, which is ON by default), a `--think <level>` launch flag opens at a baseline budget (`thinking` config), the status bar shows `think:<level>`, and the daemon console gains a `cycleThinking` (`t` key) issuing the existing `set_thinking` control frame. The level vocabulary borrows the SDK effort enum; the mechanism is the thinking token budget. A pure `thinkLevels.ts` is the single source of truth — NO harness change (every lever was already built). Spec/plan `2026-06-20-thinking-budget-control`. **Increment B SHIPPED — chat REPL UX fidelity** (`cc-harness-chat`): three CC-faithfulness gaps closed — (#11) **markdown rendering** via a pure `markdown.ts` (`renderMarkdown` → styled `RenderLine[]`: whole-line bold/italic/inline-code, headers, bullet/numbered lists, fenced code dim+indented, blockquotes; mixed-style line strips markers as the accepted lightweight-parser limit) wired into the assistant + live *text* branches only (thinking/user/tool lines stay raw — and resumed transcripts inherit it free via `replay.ts`'s `renderMessage` reuse); (#10) a **`ThinkingIndicator`** spinner + elapsed shown in the transcript the instant you submit (one interval mounted only during the `busy && streaming-empty` gap); (#8) a **`/model` picker** modal (mirrors `SessionPicker`) fed by the *live* `session.capabilities().models` (probe 27: `supportedModels()` returns a rich 6-model list headless — flipping the dashboard m-bug's "empty headless" trace), with the free-text `/model <name>` fast-path preserved. Entirely `tui/` — NO harness change. Spec/plan `2026-06-20-chat-repl-ux-fidelity`. **Increment C SHIPPED — dashboard live state** (`cc-harness-console`): the daemon console now *mirrors live per-session state* by closing the control→display loop — (#6) **model cycling fixed** — the real root cause was `modelId` reading `.id`/`.model` (→ `set_model="[object Object]"`); now maps the SDK objects' `.value` (the audit's "supportedModels empty headless" trace was DISPROVED by probe 29: the harness `Session` returns the 6-model list pre-turn because `readLoop` primes the control channel in the constructor) — and the cycle is now *visible* via a daemon **source-of-truth write-back**: `supervisor.control()` writes the new model/permissionMode back to the registry record + `configs` on a successful `set_model`/`set_permission_mode`, so `list()→collect()→SessionRow` reflect live state for any client (surviving reconnect); (#2) **per-session permission mode** carried `SessionRecord`→`ListEntry`→`SessionRow` and shown in Detail; (#4) **enriched Detail** — a dim `mode · ctx% · tokens · age · proactive` line; (#5) **proactive glyph** in Pool (`▶` running / `⏸` paused). Daemon source-of-truth chosen over console-display-only; basic proactive state (no new daemon API). Gated live e2e proves the write-back end-to-end (GREEN under OAuth subscription auth — probe 28). All new fields optional → backward-compatible. Probes 28/29 ground it; spec/plan `2026-06-20-dashboard-live-state`. **Increment D SHIPPED — command palette** (`cc-harness-chat`): the chat REPL now surfaces the live slash-command catalog as an inline `/`-autocomplete and dispatches it (capability gain logged under domain 8). A1 triple-flip recorded: #13 was a *surfacing* problem, not installation — the 105-command catalog (skills + plugin + user commands) is already loaded (probe 30, inherited via `settingSources`) and already invokable (probe 31: built-ins gate, but skills/plugin/user commands execute as prompts); the REPL just discarded `capabilities().commands`. Mirrors the `@`-mention mechanism: a pure `commandComplete.ts` (catalog entry type + `mergeCommands` local-wins + `rankCommands` reusing the `fileComplete` fuzzy scorer), a `command` state in `editor.ts` parallel to `mention` (mutually exclusive, command-first in every shared branch; `/` opens only at buffer start; **Enter completes-AND-submits `/name`** — the deliberate divergence from `acceptMention`; Tab completes the name + space; Esc/space/cursor-leave close), a `CommandPopup` in `ChatComposer` (Box-row, live-injected catalog, `argumentHint` shown), and 3-way dispatch routing in `useChat` (LOCAL→engine switch / CATALOG→submit-as-prompt / unknown→`formatUnknown`; the `/zzz`-unknown regression preserved). Entirely `tui/` — NO harness change (`Session.capabilities()` already existed). 9th ZERO-PER-TASK-FIX-CYCLE increment (5/5 tasks clean on first review; one post-final-review polish commit = `argumentHint` render aligning to spec D3 + a close-path test). Keyed-OAuth live e2e GREEN (catalog non-empty headless, 8s). Probes 30/31 ground it; spec/plan `2026-06-20-command-palette`. **Agent app-server M1 SHIPPED (2026-07-29)** — a new JSON-RPC control plane (`harness/src/appserver/`) over WebSocket (`ccx serve`) so a future web UI can drive a real `Session` remotely: `initialize`/`thread/*`/`turn/*`/`decision/*`/`thread/subscribe`+`thread/read` plus `item/*`/`turn/*`/`decision/*` notifications, built on **decisions-as-state** (a permission/question/plan request parks; any client can `decision/respond` later — no reverse-RPC). Live-accepted end to end (spawn→subscribe→turn→park→respond→completed, a real Bash permission park over a real WS connection, `harness/test/live/appserver-m1.test.ts`). Seam-coverage scorecard (generated from the four real seam sources, not hand-counted) at `docs/parity/appserver.md`; plan `docs/superpowers/plans/2026-07-28-agent-appserver-m1-core-loop.md`. **Wave T (2026-08-06) — score UNCHANGED at ~66%; two corrections to the text above.** (1) Increment 10's "the `auto` rung self-heals the model live … since `auto` is the model-gated headless classifier" is right about the repair and **wrong about what happens without it**: probe 99 shows the engine *refuses* the mode rather than degrading it, so an unrepaired `auto` request leaves the session where it was — which is why the plan applier now swaps first and why a refused change is reported rather than painted. (2) Increment 3's "drives a live `openSession`/`Session` in `default` permission mode" is true again for the interactive REPL, but only because Wave T restored it: Increment A had made every caller `auto`, and the QA fleet found a fresh `ccx` executing `rm` unconsulted as a result. Wave T also added the app-server's share of the plan-grant work (`planUpgrade.ts` applies the mode the approval *granted*, not a hard-coded `acceptEdits`), and gave the REPL a live retry indicator driven by `system/api_retry` frames that were already arriving unrecognised. No new SDK surface is consumed, so the fraction does not move. **Agent app-server M2a + M2b SHIPPED (2026-08-11) — raised ~66% → ~72%**, the first move in this domain since M1, and it is realized envelope rather than re-characterization: M1's core loop is now a complete control plane over an in-process SDK engine — **51 registered JSON-RPC methods and 26 notifications** (`harness/src/appserver/`) covering settings + introspection, the session library (`thread/list|read|fork|name/set|tag/set|delete`), lifecycle (`thread/reinitialize|close`), the rewind trio, the MCP quintet, background tasks, the nine settings-ops methods the host wire had grown past the spec's 25-op inventory (scorecard gap 6), a server-side turn queue with enqueue-minted ids and a closing latch, and three probe-promoted seams — `turn/steer` over `streamInput`, `plugin/reload`, `skill/reload` (probes 103b/105; probe 104 retired `readFile` as **dead** — resolves null for existing and missing paths alike, so M3's `fs/read` cannot back onto it). Every method is zod-typed with generated draft-7 JSON-Schema artifacts (`--emit-schema`) and re-exported at the `cc-harness/appserver` subpath, and the seam scorecard is machine-gated in three directions — presence, status staleness, and method↔row bijection — so a shipped-vs-planned lie is a red build rather than doc rot (the M2a lesson: 15 methods once shipped while their rows read `planned(M2)` and the gate stayed green). **The acceptance proved the plane against a real engine, not fakes**: one keyed live run performed the spec's full sequence — 14/14 assertions in 48s — including two-client write-back fan-out, a decision park and respond, rewind anchors + `dryRun`, queue enqueue→drain, a steer whose result correlated to the *prompt's* uuid, compact with an outcome, a fork sharing item ids with its parent, `thread/clear`, and a clean shutdown leaving zero registry entries; a zero-dependency HTML console (a deliberately foreign consumer) then drove every waves-3–4 panel live with zero runtime errors. **What holds the domain below higher is M3, and it is named**: fleet adoption (`thread/attach`/`thread/stop` — the only non-shipped row on the scorecard's 82; until it lands, a fleet-origin thread's `-33006` is defined-but-unemitted and the host-wire/bridge seams stay unimported), the workspace surfaces `fs/*` and `shellCommand`, and a re-open path for the one known residual (a factory throw inside the engine swap leaves the record holding a disposed engine — scorecard gap 10, reads honestly as `-33005` but has no recovery short of close + resume). Spec `docs/superpowers/specs/2026-07-30-agent-appserver-m2-design.md`; plans `…-m2a-spine-controls.md` / `…-m2b-rewind-queue.md`; scorecard `docs/parity/appserver.md`. **QA wave-2 delta (2026-08-11) — score UNCHANGED at ~72%.** Ten tasks of chat-REPL repair (see the wave entry above and `tui-ux.md`'s wave-2 recount) consuming no new SDK surface: every lever they use — the `canUseTool` deny arm, `applyFlagSettings`, `getContextUsage`, the hook channel, the session reader's message array — was already modeled. The one thing worth carrying here is a *deployment* fact the wave forced: because ccx always passes `canUseTool` and permission mode is runtime-mutable while the callback is construction-only, the SDK's `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` warning fires on every bypass launch and used to print raw over the Ink frame. Dropping the callback in bypass is **not** safe — a bypass launch would be permanently brokerless after a runtime step-down — so the fix is a warning-channel takeover at the CLI entry (SDK-coded warnings to a debug seam, everything else re-printed once above the frame). Any embedder rendering its own frame over this SDK inherits the same problem |
| 11 | **Process & fleet surface** — detached `--bg` sessions, the `agents` view, `stop`/`rm`/`fleet gc`, worktrees, co-registration with the real `claude agents` | **~90%** | ✅ built | **A1 (fleet substrate) SHIPPED 2026-07-26** — the `ccx` binary: `--bg` forks a fully detached host that outlives its parent, prints the byte-exact `backgrounded · <8-hex>` banner (U+00B7, the separator doperpowers' `sed` depends on), and re-enters itself via an internal `--__host` marker so one code path serves every start. State is **two-layer — live is asked, terminal is recorded**: a UDS host answers `status` while the process lives, and only a TERMINAL state is written to the roster, so `agents` derives every row at read time (`projectRow`) and never rewrites state from a read command. That is what makes the two hard cases work: a **finished** session stays listed under `--all` (rev 1 unlinked it, which would have hung doperpowers' completion poll forever), and a **SIGKILLed** host projects `error` rather than `working`. Ships `agents --json --all --cwd`, `stop`, `rm` (works post-exit; on a dirty worktree it **deregisters the row and keeps the worktree** with a `kept worktree` notice — the deliberate consumer-driven behavior confirmed in C6 ①.7, *not* a refusal), `fleet gc`, `--worktree`, and loud refusal of recognized-but-unsupported flags. **Verified as real detached processes, not mocks** (2026-07-26): acceptance 1, 2, 3, 4, 9, 9b, 11, 12, 15, 17 by hand, and **acceptance 18 — doperpowers' unmodified `daemon-spawn.sh` + `daemon-list.sh` drove our binary end to end under PATH shadowing** (MD5-identical scripts before and after). Interop is structural, not built: our engine *is* the `claude` CLI, so the real `claude agents --json --all` lists our sessions under the name we set with `kind:"background"` — provided the spawn path **scrubs `CLAUDE_JOB_DIR`** (probe 60: inherited from a parent Claude Code agent it absorbs our session into that agent's job row). Repeatable as `test/live/ccx-fleet.e2e.test.ts`. **A2 (attach & the human seam) — CLOSED (A2a/A2b 2026-07-27, GB 2026-07-28, C6 2026-07-29):** `ccx attach` ships (replay, park/answer, `/detach` from the composer, `Ctrl+Z` terminal suspend, multi-client first-answer-wins — acceptance 5–8/10), and the resume/fork half of the doperpowers contract (`daemon-resume.sh`, `daemon-reply.sh`, `daemon-finalize.sh`, the `_lib.sh` purge path) is now **live-tested and PASSING** (C6, below). Spec `specs/2026-07-26-clone-process-surface-spine-design.md`. **GB — control-plane fidelity SHIPPED 2026-07-28**: closes the control-plane gap the spine spec's own Goal-boundary table had flagged separate (`AskUserQuestion` answering · background shells · `ExitPlanMode` · subagent view) — `BgTasksPanel`/`/bg` surface `Session.backgroundAll()`/`stopTask()` (probe 39) live in the REPL with background-task notices, and the generalized decision park (question/plan kinds, probes 65/66) works identically over `ccx attach` — a detached worker's human seam now covers AskUserQuestion and plan approval, not just generic permissions. **Live acceptance ran 2026-07-28** (`specs/2026-07-28-control-plane-fidelity-design.md` § Outcomes): the question round-trip (incl. detached attach + Other free-text), the plan-approval loop, and subagent attribution all PASS live; background shells PASS for the **model-initiated** path (`run_in_background: true` → panel + count + stop-from-panel), but **`Ctrl+B` does not background an already-running foreground shell live** — the op is wired and the SDK reports success, yet the real CLI runs the call to completion in the foreground regardless (see `docs/parity/tui-ux.md` §8). **C6 (doperpowers end-to-end) SHIPPED 2026-07-29 — the resume/fork half of the contract flagged above is now TESTED and PASSING**: spec `docs/superpowers/specs/2026-07-29-c6-doperpowers-acceptance-design.md`, evidence `.doperpowers/sdd/c6-scenario-{1,2,3,4}-report.md`. Four live scenarios, all PASS, zero harness defects: ① a real-work lifecycle (spawn into a worktree, commit → `daemon-resume.sh` fork + edit → `daemon-reply.sh` → `daemon-finalize.sh` noop-on-already-finalized → `daemon-retire.sh` purge → all three `ccx --resume`/`ccx rm` arms); ② park-and-answer (`--no-wait` spawn parks on `AskUserQuestion`, `daemon-finalize.sh` walks `live→idle→noop`, and **both** answer paths — `ccx attach`'s `QuestionDialog` and the scripts' own `daemon-resume.sh <id> "<answer>"` fork — land the edit on disk); ③ `daemon-mark.sh`/`daemon-list.sh` status-filter/retire-keep/retire-purge edges; ④ content-layer parity (both the real `claude` and `ccx` are both-negative on auto-triggering `brainstorming` for a casual prompt, and `ccx`'s SDK command catalog carries all 15 doperpowers skills). All 11 scripts MD5-identical before and after every run. Raised **~74%→~90%**: the previously-flagged gap (`daemon-resume.sh`/`daemon-reply.sh`/`daemon-finalize.sh`/the `_lib.sh` purge path untested) is closed, so the full doperpowers script contract now drives `ccx` spawn-through-retire. Genuine remainder holding it below higher: the `Ctrl+B` foreground-backgrounding gap noted just above (unrelated to the script contract, still open), and two upstream-candidate observations recorded (not filed) in the scenario reports — a stale-uuid resume hint after a fork, and a driver addressing convention that doesn't survive a resume. **Wave T (2026-08-06) — score UNCHANGED at ~90%; two process-surface behaviors changed and both are recorded here rather than scored.** (1) `ccx --detachable` — which forks a host and then attaches to it — now inherits the interactive launch posture (`default`/Manual) rather than the `DEFAULTS` `auto`, because the fix is scoped to the host *kind* in `hostMain.ts`, not to the foreground call site; a call-site-scoped fix would have left the same REPL silently in `auto` while the acceptance passed anyway. `--bg` and `-p` are untouched and keep `auto` deliberately. (2) `ccx --bg` into `bypassPermissions` is now **refused** unless the disclaimer was accepted in a prior interactive run — transcribed from upstream's own `--bg` validator (L451420-21), and the message names the interactive run that records the acceptance. A detached, never-prompting agent could otherwise have run in the one mode that stops checking, with every later `ccx attach` inheriting it |

¹ Of the *reachable* sub-surface — much of domains 7 and 10 is 🚫 unreachable (bridge-coupled), so the
low number is a design boundary, not a shortfall.

**Domain 11 is not an SDK-envelope domain.** The other ten measure how much of the *SDK's* surface we
turned into capability; this one measures how much of *Claude Code's process surface* we reproduced, which
is the metric the clone reframe (`clone-roadmap.md`) made primary. It is scored against that roadmap's
verb list, not against `sdk.d.ts`.

**Reading the shape:** domains 1–4 + 9 (execution, tools, permissions, multi-agent, config) are the
orchestration substrate — the part the SDK does *not* hand you — and they sit at 60–90%. Domains 5
(persistence — now incl. the lib interactive `Session` primitive) and 6 (observability) have joined them
with the spine + read API + the interactive session surface. **Domain 8 (hooks) now ships first-class
programmatic hooks** (`config.hooks` + builders; 8 of 30 events verified-fired, all 30 reachable via
passthrough). The remaining ready-made levers are incremental — turn-level surfaces (partial messages,
`thinking`/`effort`, budget caps) in domain 1 and `usage`/`initializationResult` in domain 6. Domains 7,
10 are capped by bridge-coupling we cannot cross headlessly.

---

## §3 — Raw API surface reference

| SDK surface | Size | We use | Note |
|---|---|---|---|
| `Options` fields | 63 (unchanged in 0.3.211) | **63 — ALL modeled** (W4.1 knob sweep added the 27-field long tail on top of Wave-1/3's 36) + `extraOptions` escape hatch | 3 knobs wired but probed dead/partial headless (`includeHookEvents` 🚫, `promptSuggestions` 🚫, `agentProgressSummaries` 🟡 — probes 53/53b/54); the map is field-complete |
| `Query` control methods | 27 in 0.3.211 | **22** (W3.5 added `setMcpServers`/`toggleMcpServer`/`reconnectMcpServer`/`setMcpPermissionModeOverride`; Wave 1 added `reinitialize`, `stopTask`, `backgroundTasks`; prior 15: `interrupt` (now with receipt), `setModel`, `setPermissionMode`, `setMaxThinkingTokens`, `rewindFiles`, `getContextUsage`, `accountInfo`, `usage`, `initializationResult`, `applyFlagSettings`, `supportedModels`/`Commands`/`Agents`, `mcpServerStatus`, `close`) | 5 unused (`readFile`, `reloadPlugins`/`reloadSkills`, `seedReadState`, `streamInput` (internal)); `usage().rate_limits` populates only under the interactive credential, not `CLAUDE_CODE_OAUTH_TOKEN` (probe 55) |
| Core builders (`query`, `createSdkMcpServer`, `tool`) | 3 | 3 | 100% |
| In-process MCP servers built | — | 5 (`cc-tasks`, `cc-swarm`, `cc-brief`, `cc-context`, `cc-compact`) | `cc-context` = self-introspection (`GetContextUsage`); `cc-compact` = self-compaction (`RequestCompaction`) |
| Native model tools | 37 (+4 in 0.3.211: `ReportFindings`, `ClaudeDesign`, `RefreshMcpTools`, `ReadMcpResourceDir`) | 0 reimplemented; 2 deliberately shadowed by our MCP (Task→swarm, Tasks); `CronCreate` probed dead; **`Workflow` SURFACED opt-in** (`config.workflow`, probe 36 re-verified on 0.3.211) | rely-on, not consume; probes 35/35b/35c: MCP tools are **ToolSearch-deferred** (~11 tok/turn), not inline |
| Subpath exports | 7 | 1 used (`.`), 2 probed-and-rejected (`/assistant`, `/bridge`), 1 types-only (`/sdk-tools`) | 0.3.211 **deletes `/assistant`** (`runAssistantWorker` gone) + removes the `connectRemoteControl` exports — two 🚫 rows now nonexistent |
| Hook events (`HOOK_EVENTS`) | 30 | first-class `config.hooks` + 4 builders + `mergeHooks` | 8 verified-fired headlessly; all 30 reachable via passthrough; SessionStart/End dormant (documented) |
| `permissionMode` values | 6 | **6 characterized** | default/plan/auto/bypass(gated) + `acceptEdits`/`dontAsk` (closeout). **Wave T / probe 99:** a runtime `setPermissionMode` is not guaranteed to take — `auto` off its supported model set and `bypassPermissions` at runtime are both **refused**, and the session stays in its previous mode (no silent fallback to `default`, correcting the earlier reading). Callers must treat the setter as fallible: swap the model before granting `auto`, and report a refusal rather than assuming it applied |
| Session-store top-level fns | 10 | **7 used** (`listSessions`/`getSessionMessages`/`getSessionInfo` via `sessions/reader.ts`, `forkSession` via `sessions/fork.ts`, **`renameSession`/`tagSession`/`deleteSession` via `sessions/mutate.ts`**); `resume`/`persistSession`/`sessionStore` (Options) wired | all documented store fns now wrapped |

---

## §4 — The session-store + introspection family (verified live 2026-06-17)

This was the largest *available-but-unbuilt* lever, and unlike cron/push it is **fully functional
headlessly with an API key**. Probe (`probe-sessionstore.mjs`, model `claude-haiku-4-5`) results, now
annotated with build status — **✅ shipped** (persistence spine or observability read API),
**⚪ deferred**:

| API | Result | Status / implication |
|---|---|---|
| persist → **resume** round-trip | recalled the codeword across two separate `query()` calls (`true`) | **✅ shipped** (persistence) — `resume` config + `resumeHarness()` + daemon `spawn({resume})` |
| `InMemorySessionStore` injection (`sessionStore`) | custom store received the mirror (`size: 1`) | **✅ shipped** (persistence) — `sessionStore` config passthrough (BYO backend seam) |
| `enableFileCheckpointing` + `Query.rewindFiles(id)` | two-turn edit (VERSION_ONE→TWO) **reverted to VERSION_ONE on disk**; `dryRun` returns `{canRewind, filesChanged, insertions, deletions}` | **✅ shipped** (persistence) — `Harness.rewind` (checkpointing default-on); undo/time-travel; **surfaced interactively in C5** (2026-07-28) — Esc-Esc in the chat REPL opens `RewindPicker.tsx`, backed by a content-shape anchor classifier (`sessions/rows.ts`) and host ops (`host/host.ts` `rewindAnchors`/`rewindDryRun`/`rewind`) offering CC's 3-way conversation/code restore (`docs/parity/tui-ux.md` §6, spec `2026-07-28-c5-tui-closure-design.md`) |
| `getContextUsage()` | 17-field breakdown — `totalTokens: 26191`, `maxTokens`, `percentage`, per-category `memoryFiles`/`mcpTools`/`agents`/`skills`/`slashCommands`, `messageBreakdown`, `apiUsage`, autocompact state | **✅ shipped** (observability) — `Harness.getContextUsage()` + daemon `context_usage` frame; **+ agent-facing** `cc-context` `GetContextUsage` MCP tool (model self-introspection, `summarizeUsage` concise digest), spec `2026-06-17-context-introspection-tool-design.md` |
| `listSessions()` | `array[801]` w/ `sessionId, summary, firstPrompt, gitBranch, cwd, tag, createdAt, lastModified` | **✅ shipped** (observability) — `sessions/reader.ts` + daemon `sessions` op; **`cwd`→`dir` scoping is the actual fix** (the "global store" was a probe passing a non-field `cwd`) |
| `getSessionMessages(id)` | transcript `array[3]` | **✅ shipped** (observability) — reader + daemon `messages` op |
| `accountInfo()` | `{tokenSource, apiKeySource, apiProvider}` | **✅ shipped** (observability) — `Harness.accountInfo()` + daemon `account_info` frame |
| `supportedModels` / `Commands` / `Agents` / `mcpServerStatus` | arrays `[6]` / `[94]` / `[15]` / `[6]` | **✅ shipped** — `bridge/` + `Harness` capability methods |
| `forkSession(id)` | new `{sessionId}` (resume PRESERVES the id, fork MINTS a new one) | **✅ shipped** — `sessions/fork.ts` (`cwd`→`dir` wrapper) + daemon `fork` op; live-verified true independent branch (Spec 3 `session-forking`) |

**Wiring lesson (verified):** `rewindFiles()`'s anchor must be a genuine **user-prompt UUID**, resolved
from the transcript via `getSessionMessages()` — **not** from live stream frames (in streaming mode the
`type:"user"` frames are tool-results, which carry no checkpoint and return "No file checkpoint found").

**Hooks (domain 8) — SHIPPED** (`hooks-support`, 2026-06-18): first-class programmatic hooks — typed
`config.hooks` → `options.hooks` passthrough (all 30 `HOOK_EVENTS` reachable), the `injectContext` /
`guardTool` / `blockTool` / `observe` builders + `mergeHooks`, public type re-exports, and the daemon path
via the existing `sessionOptions` factory (no daemon code change). Live-probed first (`probes/probes/09-hooks-coverage.ts`,
`10`): **8 of 30 events fire headlessly** (PreToolUse/PostToolUse/PostToolBatch/UserPromptSubmit/Stop/
SubagentStart/SubagentStop/MessageDisplay); context-injection + tool-block + subagent-attribution all
verified; `SessionStart`/`SessionEnd` dormant via the programmatic path (documented, no builder). Unit
+15 (328 total), live 2/2 keyed. The **session cluster is also COMPLETE (3 of 3)**.

**SDK capability closeout (domains 1/3/5/6/9) — SHIPPED** (`sdk-capability-closeout`, 2026-06-18): the P1–P4
turn-level + introspection + session-mutation frontiers, all live-probed first (probes 11–15) then built on
existing seams: **(A)** `effort`/`thinking`/`maxBudgetUsd`/`taskBudget`/`includePartialMessages`/
`forwardSubagentText` config passthrough; **(B)** `usage()`/`initializationResult()` on `Harness`+`Session`,
`applyFlagSettings()` on `Session`, + daemon `usage`/`init`/`apply_flag_settings` ops; **(C)** `renameSession`/
`tagSession`/`deleteSession` wrappers + daemon `rename`/`tag`/`delete` ops; plus the `acceptEdits`/`dontAsk`
permission modes characterized. `maxBudgetUsd` exceed-path is pass-through-don't-swallow (throw OR empty
result, timing-dependent); `taskBudget` opus-4-8-only. Commits `83762229c6..ee389d80da` (6 tasks). Unit
340/340¹, live 6/6 keyed. See [[sdk-turn-controls-and-store-mutation-verified]].

**Daemon boot-rehydration (domain 5) — SHIPPED** (`daemon-boot-rehydration`, 2026-06-18): lazy, opt-in — a
restarted daemon re-adopts orphaned `SessionRecord`s instead of reaping them. `SessionRegistry.rehydrate(pid)`
claims orphaned-resumable records (normalize→idle, reap errored/no-sessionId, leave live-pid alone); the
`restart` policy is now persisted on the record; `DaemonSupervisor` gains a `rehydrate` flag + an `ensureLive(id)`
seam that revives a claimed session on first access (resumes the captured `sessionId` — continue, not branch) —
**no subprocess at boot, no new daemon op, `server.ts` untouched.** Graceful `stop`/`shutdown` forget unrevived
claims (only a crash rehydrates). Premise live-verified by probe 16 (cross-process resume, `db4e30bc23`). Commits
`8931bf97f8..5bb3339bbf` (4 tasks, subagent-driven; one review-fix: shutdown clears unrevived claims). Unit
348/348, live 1/1 keyed. See [[harden-and-ship-over-phase3]].

**Remaining frontiers** (now narrow): deeper partial-stream ergonomics in domain 1; deeper plugin/skill
lifecycle integration in domain 8. Mostly-out-of-reach: `toolConfig` shaping (marginal) and
`SDKRateLimitEvent` surfacing. **Correction (probe 55, 2026-07-25):** `usage().rate_limits` is *not*
bridge-coupled — it is **auth-mode-coupled** and fully reachable under the interactive credential; see
`clone-roadmap.md` §3 F4.

¹ unit suite count at closeout completion; verify with `npx vitest run test/unit` as the suite grows.

---

## §6 — App-server: a Codex-protocol drop-in (new product surface, 2026-06-21)

**`cc-codex-appserver`** (new peer package `CC-to-SDK/app-server/`, sibling of `tui/`) — a **drop-in
replacement for `codex app-server`**: it speaks the Codex **v2 JSON-RPC** protocol (NDJSON over stdio,
no `jsonrpc` field) but is backed by the Claude Agent SDK via the public `cc-harness` `Session`. The
consumer is the **Director** (`~/Documents/GitHub/agent-harness`), which spawns one server per worker
turn; the binary replaces `codex app-server` with no change to the Director's transport/handshake/turn
loop. The required surface was derived from the consumer's own source (`app_server.py` +
`_mock_app_server.py` + tests), not guessed.

- **Architecture** (`engine → translator → peer`, one-directional, review-enforced): a bidirectional
  JSON-RPC stdio peer; a pure translator mapping the SDK message stream → Codex notifications
  (`item/completed` agentMessage `commentary`/`final_answer`, `turn/completed`,
  `thread/tokenUsage/updated`); a thread/turn registry over `openSession`. Required surface =
  `initialize`/`initialized`/`thread/start`/`turn/start` + two server→client request paths:
  approvals and `item/tool/call` (dynamic tools).
- **dynamicTools brokered to the client** (the **B2** rework — faithful codex behavior, no Claude-specific
  channel): every Director-advertised tool (`linear_graphql`, `report_outcome`) is relayed back over the
  codex **`item/tool/call`** server→client request (`broker.ts` → `peer.request`), with the documented
  `item/started`→request→`item/completed` lifecycle. The guardrail (`authority.py`) and the
  `LINEAR_API_KEY` therefore stay **entirely Director-side** — the server holds no key and no guardrail.
  `normalizeSpecs` accepts the flat form the Director sends and expands `{type:"namespace"}` specs;
  `report_outcome` rides the same path (the earlier `turn/completed.outcome` channel + capability +
  Director companion were dropped — a drop-in conforms to the consumer, not the reverse).
- **Posture**: `approvals_reviewer=auto_review` (the Director's default) → `permissionMode:"auto"` (the
  SDK AI classifier self-governs; brokered tools are allowlisted so they fire under `auto` — probe 34b);
  `on-request`/`untrusted` without auto_review → `default` + a broker emitting
  `item/commandExecution|fileChange/requestApproval`.
- **Proven**: a cross-repo contract test drives the REAL built binary with a faithful port of the
  Director's wire client and asserts a full `item/tool/call` round-trip (drop-in fit, not a mock); a
  **keyed live e2e is GREEN** (a real SDK turn completes end-to-end under OAuth). A1: probe 34 (an SDK MCP
  handler can park on an out-of-band reply) + probe 34b (a brokered tool fires under `permissionMode:auto`).
  38 unit+contract + 1 gated-live; an independent `codex review` pass (0 P1; 2 P2 protocol-fidelity fixes
  folded in: `item.id` lifecycle shape + namespace expansion).
- **Cutover (Director-side, zero code)**: point `--codex` at `node <abs>/CC-to-SDK/app-server/dist/bin.js`
  and declare the auth vars (`CLAUDE_CODE_OAUTH_TOKEN`, `LINEAR_API_KEY`) in `.harness.json`
  `worker_policy.worker_env`. The stock Director already brokers `item/tool/call` (linear_graphql via
  `authority.py`, report_outcome via its sink) — no companion needed. Spec/plan
  `2026-06-21-claude-codex-appserver`.
- **`claude-plugin-codex` — a second wire consumer (2026-07-03)**: `CC-to-SDK/claude-plugin-codex/` is a
  Codex plugin (a Claude-flavored mirror of `codex-plugin-cc`) that drives `cc-codex-appserver` from
  *inside Codex itself* — the Director is no longer the only client of the v0.2 protocol. It required
  the v0.2 surface above (`thread/resume`, `turn/interrupt`, `account/read`, `thread/name/set`,
  `config/read`) plus `effort`/`outputSchema` passthrough on `thread/start`. Spec/plan
  `2026-07-03-claude-plugin-codex-design`.

---

## §5 — Permanently out of reach (the 🚫 floor)

58 parity items are `not-possible` and ~77 are non-goals: claude.ai bridge-coupled surfaces
(`connectRemoteControl`, `runAssistantWorker`, `RemoteTrigger`, native `CronCreate` firing,
`PushNotification` transport), build-internal feature-flag/DCE gating, and the interactive Ink TUI
(deferred under the "harden & ship over Phase 3" decision). These are excluded from every "realized"
fraction above — measuring against them would understate true coverage of the reachable envelope.
**2026-07-17 update:** SDK 0.3.211 *deletes* `runAssistantWorker` (the whole `/assistant` subpath) and
the `connectRemoteControl` exports — both moved from 🚫 to nonexistent, validating the probed-and-rejected
calls and shrinking the 🚫 floor.

---

## §7 — 2026-07-17 remeasure: SDK drift + refreshed frontiers

Inputs: installed 0.3.178 `.d.ts` vs npm HEAD **0.3.211** (structured diff), the **live web docs**
(all 30 `code.claude.com/docs/en/agent-sdk/*` pages), and a full consumption audit of
`harness/`+`tui/`+`app-server/`. Headline moves ~64% → **~63%** — not because we regressed, but because
the denominator grew (new documented/declared surface) faster than the numerator (shipped since 6/17:
structured outputs consumed by the app-server, probes 35/36, forkSubagent, TUI rounds).

### 0.3.178 → 0.3.211 drift (declared; each item needs a probe before building on it)

**Flat:** `Options` (63 fields byte-identical), `HOOK_EVENTS` (30), `PermissionMode` (6), `EffortLevel` (5).

**Added:** `Query.reinitialize()` (recover a gapped control channel — directly relevant to daemon
boot-rehydration/reattach) · `Query.setMcpPermissionModeOverride()` (per-server tighten-only mode pin) ·
`interrupt()` now returns a receipt (`still_queued` semantics) · 4 native tools (`ReportFindings`
structured code-review findings, `ClaudeDesign` opaque action dispatcher, `RefreshMcpTools`,
`ReadMcpResourceDir`) · new `SDKMessage` members (`background_tasks_changed` REPLACE-snapshot,
`conversation_reset`, `model_refusal_no_fallback`, `control_request_progress` retry telemetry) ·
`active_goal` StdoutMessage (a `/goal` Stop-hook autonomy loop — unprobed) · **sandbox credential
redaction** (`SandboxSettings.credentials` + `SandboxCredentialsConfig`: deny/mask env vars + files,
per-host injection allow-lists) · `USAGE_*`/`ORG_POLICY_LIMIT_PREFIXES` classification constants ·
a `manifest.json` `sdkCompat` wrapper-compatibility contract.

**Removed (breaking, but not for us):** `/assistant` subpath + `runAssistantWorker`;
`ConnectRemoteControl*` exports; `setMcpServers({})` no longer clears plugin-owned servers.

### Docs-envelope check (30 pages) — status of the 10 capabilities the docs emphasize

| Docs-emphasized capability | Our status |
|---|---|
| Structured outputs (`outputFormat` json_schema + retries) | ✅ built (resolveOptions + app-server consumer; probe 36-output-format) |
| External `sessionStore` (S3/Redis/Postgres seam) | ✅ **W3.3**: Redis reference adapter + conformance suite + mirror_error surfacing; cross-host resume live-proven. ✅ **2026-07-30**: `createPostgresSessionStore` (PgLike DI — `pg.Pool`/PGlite as-is; partial-UNIQUE + ON CONFLICT uuid dedup = cross-process retry safety; summary re-folded from the committed transcript under generation-token seq-CAS; TEXT payloads; atomic CTE delete; DDL export + idempotent `ensurePostgresSessionStoreSchema`) — full conformance incl. SHOULD-dedup green against real Postgres (PGlite) keylessly; exceeds the official SDK example (no dedup, no summaries there) |
| Hosting guide (`startup()`/`WarmQuery` pre-warm, `spawnClaudeCodeProcess`, scaling/session-pinning) | 🟡 **W3.2** warm pool shipped (lib + daemon); spawn placement documented in the secure-deployment guide; scaling/sizing ops guide remains |
| Secure deployment + `sandbox` (isolation tiers, credential proxy; 0.3.211 credentials redaction) | ✅ **W3.4**: `tenantHarnessConfig` + `docs/guides/secure-deployment.md`; typed credentials deny live-verified; proxy via `baseUrl`; mask-mode residual |
| Tool search (defer-and-discover, on by default) | 🟡 verified (probes 35/35b/35c) — rely-on; informs "default-on MCP is cheap" |
| File checkpointing (`enableFileCheckpointing` + `rewindFiles`) | ✅ built; **surfaced interactively in C5** (Esc-Esc rewind picker) |
| `Workflow` tool + agent teams | 🟡 Workflow verified headless (probe 36) but NOT surfaced in harness config/TUI; agent teams CLI-only (out of SDK scope) |
| OpenTelemetry (metrics/logs/traces, trace-context, per-user attribution) | ✅ **W3.1**: typed `telemetry` config + daemon-wide + guide/demo (probe 51; metrics+events, no traces) |
| Budget controls (`maxBudgetUsd`/`taskBudget`) + effort/thinking | ✅ built |
| Expanded hooks (incl. `defer`, async side-effect mode) + `auto` mode | ✅ built (**17/30 verified-fired post-Wave-2**; `defer` semantics settled — parks the call for the host) |

### Refreshed frontier list (ranked)

1. ~~**Upgrade 0.3.178 → 0.3.211**~~ — **SHIPPED 2026-07-17** (all 4 packages; unit/typecheck/build green;
   re-probe found no code regressions — the live failures were billing: subscription disabled account-side
   + API credits exhausted).
2. ~~**Surface `Workflow`**~~ — **SHIPPED 2026-07-17**: `config.workflow` opt-in knob (allowlist +
   `WORKFLOW_NOTE`); gated live e2e pending working auth.
3. ~~**OpenTelemetry**~~ — **SHIPPED 2026-07-17 (W3.1)**: probe 51 proved env-gated OTLP alive headless; typed config + daemon-wide + guide/compose demo.
4. ~~**`resumeSessionAt`**~~ — **SHIPPED 2026-07-17 (Wave 1)**: probes 37/37b settled the semantics
   (in-place = destructive truncation, same sid; `forkSession` = safe branch; user-uuid anchors valid →
   one anchor drives conversation AND `rewindFiles`); shipped as `resumeAt`/`forkSession` config,
   `rewindSession()`, and the daemon `rewind` op (in-place pool swap / anchored fork). Live e2e green.
5. ~~**Daemon resilience via `reinitialize()`** + interrupt receipts~~ — **SHIPPED 2026-07-17 (Wave 1)**:
   probe 38 (fresh full init payload; parked `can_use_tool` DEDUPED in-process → a capability-refresh
   lever, not permission recovery; interrupt receipt `{still_queued}`; interrupted turn ends
   `error_during_execution` and the stream can die at teardown). `Session.reinitialize()`/`interrupt()`
   receipt + `reinitialize` control frame. Wave 1 also shipped the OTHER two items: **billing/limit
   classification** (`limits/classify` over `USAGE_*`/`ORG_POLICY` prefixes + the observed incident
   families; `Session.limitState` + registry `limit`) and **background-task visibility** (probe 39:
   `background_tasks_changed` streams headlessly; `Session.backgroundTasks`/`stopTask`/`backgroundAll`
   + bridge frames; live e2e green). `control_request_progress` telemetry remains open.
6. **Runtime MCP control** — `setMcpServers`/`reconnectMcpServer`/`toggleMcpServer` (+ 0.3.211
   `RefreshMcpTools`, `setMcpPermissionModeOverride`): dynamic tool topology for the daemon.
   *Wave 2 (probe 49) pre-settled the 0.3.211 pair: the override resolves but acts at the
   rules/classifier layer only (a `canUseTool` broker still gets consulted); `RefreshMcpTools`
   is absent for SDK-type servers.*
7. **Warm-spawn** (`startup()`/`WarmQuery`) — kills daemon first-turn latency; `spawnClaudeCodeProcess`
   opens remote/container placement. *Wave 2 probes 40/50: BOTH ALIVE — warm init@51ms vs 602ms cold;
   custom spawn runs end-to-end. Build the pool in Wave 3.*
8. ~~**Sandbox credential redaction**~~ — **PROBED ALIVE 2026-07-17 (Wave 2, probe 48)**: deny-mode
   env+file redaction verified under engaged sandbox-exec; already flows through `resolveSandbox`;
   `mask` mode needs egress-proxy infra (untested).
9. ~~**Probe candidates**~~ — **ALL SETTLED 2026-07-17 (Wave 2, probes 40–50)**: `ReportFindings`
   ALIVE (44) · `ClaudeDesign` DEAD headless (45) · `/goal` DEAD headless — UI command (46/46b/46c) ·
   `onElicitation` ALIVE for stdio servers, full round-trip incl. both hooks (43/43b; SDK-type
   servers can't elicit) · `onUserDialog` wireable but no deterministic headless trigger;
   `supportedDialogKinds` without the callback throws (fail-closed intake).
