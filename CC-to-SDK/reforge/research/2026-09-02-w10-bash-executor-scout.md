# W10 bash executor scout — the shell subsystem, the private-field verdict, and the cut for C13 (pin 2.1.251)

Scope: C13 / W10 (`subsystem/bash-executor`, `tool/Bash`, plus the `tool/PowerShell` and
`subsystem/tool-result-validators` rows the campaign routed here), and enough of
`subsystem/sandboxing` (§3.6) to say what W10 is blocked on and what it is not. READ-ONLY: no build,
no gate, no recording, no scenario was run; nothing outside this file was written.

Method: TypeScript-parser spans over `chunk-fy12d89p.js` (11,314 declarators / 10,449 top-level
names, parsed clean in 0.68 s, zero diagnostics), `chunk-9e2ns8ty.js`, `chunk-fgwne0fb.js`,
`chunk-q4xe0m2r.js`, `chunk-hw8qz4q5.js`, `chunk-13d9rycm.js`; a per-class member walk that records,
for every method, the exact set of `#private` names it reads, writes and calls; a reference graph
over the engine chunk's 10,449 top-level names for caller counts; `import{…}from` graph walks across
the 1,800-file module set; substring counts over the same 1,800 files for every anchor claim; and —
new for this scout — **the 267 recorded cassettes read as an artifact**, to enumerate the Bash
commands the corpus has actually issued rather than the ones its prompts ask for. Scratch scripts in
`/tmp/w10scout/`.

Grounding: campaign spec §1.1/§1.2/§1.3/§2.1/§2.3/§2.4/§3.1/§3.6/§6-W10 + the C1, C3, C10.5, W8 and
W9 Revision Notes; `reforge/research/2026-09-02-w75-hook-executor-design.md` (whose port-cut rule
this document inherits verbatim); `reforge/research/2026-09-02-w9-session-storage-scout.md` §3;
`reforge/research/2026-09-01-w5-w7-anchor-scout.md` incl. both supersession banners;
`reforge/research/2026-09-01-w6-permission-matrix.md`; `2026-08-31-engine-census.md`;
`reforge/ledger.json`; `reforge/README.md`; `reforge/strangle/manifest.ts`;
`research/fixtures/symbol-map-2.1.251.json` and `control-protocol-2.1.251.json`.

---

## 0. Ten corrections, before anything is budgeted

Every scout so far corrected the census it was handed. This one removes the row's only named
satellite, finds two chunks nobody has ever named, and — the finding that reframes the wave —
measures that **the private-field blocker the campaign has called its deepest obstacle guards about
a third of the subsystem, and the other two thirds are pure and unblocked today.**

1. **`chunk-w7bq1qyb.js` is not the bash safety AST.** The census's bash-safety row and campaign
   §1.1 both carry it as "287 KB prefix/word analysis". Its four exports are
   `logEvalRunOutcome`, `pluginEvalHandler`, `pluginEvalInitHandler`, `resolveRoot` — it is the
   **`claude plugin eval` harness**. 286,659 B leave the row. (§1.1)

2. **The real parser is `chunk-fgwne0fb.js`, 62,907 B, and no campaign document names it.** It is a
   hand-written recursive-descent bash tokenizer and parser that emits tree-sitter-shaped nodes
   (`type`/`children`/`startIndex`/`endIndex`/`text`; the telemetry still says
   `tengu_tree_sitter_parse_abort`). 107 declarations carrying 62,258 B — **99.0 % declaration
   density**. Seven exports, **four named importers**, exactly **one import of its own** (a telemetry
   function), and zero occurrences of `process.`, `require(` or any `fs` call. **This is the cleanest
   S-chunk candidate the campaign has found anywhere**, and it is bigger than the entire debut
   S-chunk target (`y30v0ja7`, 1.4 KB) by a factor of 45. (§1.2)

3. **The command classifier is a second unnamed region, in a chunk the census assigned to
   permissions.** `chunk-9e2ns8ty.js` offsets 108,945–162,000 — 104 declarations, **53,180 B** —
   hold `dde` (the parse entry the Bash tool calls), `KTe` (the eleven-predicate "too-complex" gate),
   `ge` (9,969 B, the command-tree walker), `Ua`/`za`/`Ie`/`Wo`/`Gn`/`Yn` (argv, env-var, redirect and
   heredoc extraction). The rest of that 243 KB chunk is path-permission surface that belongs to
   C9/W6. The chunk is not S-chunk-able; this region is S-method rows. (§1.2)

4. **The Bash tool is not a class.** §2.1's W10 row and the C1 note both speak of "the Bash tool's
   command class". `yi` (`BashTool`) is an **object literal** passed to a tool factory — 11,867 B,
   26 members, zero private fields. The private-field problem is real but it lives one layer down, in
   four small classes of the process core, and it does not touch the tool object at all. (§1.3, §2)

5. **`DiskTaskOutput` is W10's, not C11c's.** The W8 scout routed `C_t` (1,839 B, twelve private
   fields — measured: twelve fields plus six private methods) behind C11c's `TaskOutputPort`. It has
   **exactly one constructor site in the whole bundle**: `jx.#p()`, the Bash executor's spill-to-disk
   path. The task family reads task output through free functions; only the shell constructs the
   writer. (§1.4, §7)

6. **`detectBlockedSleepPattern` is gate-dead at this pin.** The W5–W7 scout correctly reassigned it
   from W6 to W10. Measured further: `o_r` has **one caller** — `BashTool.validateInput` — and that
   arm is `if (RI() && !$d() && …)`, where `RI() = I("tengu_amber_sentinel", !1)` is the **Monitor
   gate W8 measured as default-false with no env override**. The whole sleep-blocking behaviour, and
   the `Monitor with an until-loop` prose in the tool description, are guarded by a gate §3.3 pins
   off. (§4.4)

7. **One of the four backgrounding arms is unreachable headlessly, and it is not the one anyone
   would guess.** `backgroundedByTurnAbort` requires `$A.backgroundsTheShell(reason, caller)`, which
   is `caller === "turn" && unwrapAbortReason(reason) === "turn-abort"`. The **sole producer** of
   `Su("turn-abort")` bundle-wide is `chunk-6thm48px.js`, the interactive session controller;
   `chunk-dvbbv89q.js` (the headless loop) never constructs it. DEAD headlessly, with the producer
   named. (§4.3)

8. **`backgroundedByUser` is reachable headlessly and cheaply, through a control subtype W7 already
   fired.** The headless loop serves `control_request` subtype **`background_tasks`**: with a
   `tool_use_id` it calls `Vdt` → `Kdt` → `ShellCommand.background()`; without one it calls `o9`,
   which backgrounds every running `local_bash` task. W7's probe fired the arm and got "answered
   success" — **against an empty registry**. The arm is FIRED; the Bash-side effect is UNREACHED, and
   the condition is one running Bash plus one control frame the installed SDK can already send
   (`sendable: true` in `control-protocol-2.1.251.json`). This is the cheapest route to the moat
   behaviour in the whole subsystem. (§4.3)

9. **"Bash has no graph-unique literal" is true of the formatter only.** The README's anchor note
   (and the `coLiteral` mechanism built for it) generalised from
   `"<error>Command was aborted before completion</error>"` (2 occurrences). Counted across all 1,800
   module files, the executor, its safety layer and its prompt carry **at least sixteen 1-of-1
   prose anchors** — `Command timed out after `, `appears to be waiting for interactive input`,
   `Session cwd remains `, `sandbox wrapWithSandboxArgv returned empty argv`,
   `Parser aborted (timeout, resource limit, or over-length)`, `# Committing changes with git`, and
   more. W10's anchor budget is comfortable, not tight. (§3.4)

10. **The sandbox is behind a settings switch, not a feature gate — and seven attestation exclusions
    say otherwise.** `pt.isSandboxingEnabled()` resolves to `Pi() = shouldForceSandboxOn() ||
    settings.sandbox.enabled ?? false`. There is no `tengu_*` gate and no environment variable in
    that path. Seven exclusion reasons in `strangle/attestation.ts` justify the Bash sandbox
    carve-out with "§3.3 pins the gate state and X6 forbids the env overrides that would flip it".
    The premise is wrong; the conclusion (unreached today) is right. The remedy is one settings key
    in one scenario, on a macOS host, not an environment fight. (§5.3, §6)

---

## 1. The subsystem, measured

### 1.1 Where it lives, and what leaves the row

| unit | bytes | what it is | verdict |
|---|---|---|---|
| `chunk-fy12d89p.js`, four regions (§1.3) | **237,971** (554 decls) | tool object, executor, spawn, snapshot, safety chain, prompt, backgrounding | W10 |
| `chunk-fgwne0fb.js` | **62,907** (107 decls, 7 exports) | the bash parser — pure, one import, zero I/O | **W10, S-chunk** |
| `chunk-9e2ns8ty.js` @108,945–162,000 | **53,180** (104 decls) | the command classifier / "too-complex" gate | W10 (S-method) |
| `chunk-hw8qz4q5.js` | **112,928** (455 decls) | `PowerShellTool` + its cmdlet safety tables + 3 shared backgrounding predicates | W10, behind a flip (§5.4) |
| `chunk-13d9rycm.js` | 26,040 (33 exports) | task-output storage incl. `DiskTaskOutput` | **shared** — W10 writes, C11c reads |
| `chunk-04aem4bh.js` (`dZe` only) | ~700 of 5,767 | the stdout truncator class — public, pure | shared helper |
| `chunk-1w22d2d7.js` | 11,911 | **the subsystem's semantic barrel** — zero importers | naming artifact, not a seam |
| `chunk-pnp2g9eb.js` | 6,400 | the task-output barrel | naming artifact |
| `chunk-w7bq1qyb.js` | 286,659 | **`claude plugin eval` — NOT this row** | REMOVED |
| `chunk-q4xe0m2r.js` | 581,554 (838 decls) | sandbox: seatbelt profile builder, bwrap, seccomp, CEL/protobuf | C15's row; W10 is its caller (§5.3) |

**Denominator: ~354 KB owned by W10 proper** (engine regions + parser + classifier), plus 113 KB of
PowerShell behind a catalog flip, minus the 287 KB the census wrongly attributed.

**The barrel.** `chunk-1w22d2d7.js` is this subsystem's `chunk-e6cn1914.js`: it re-exports
`yi as BashTool`, `bun as PREAMBLE_TOOL_USE_ID_INFIX`, `dGe as SYNTHETIC_SHELL_TOOL_USE_ID_SUFFIX`,
`t_r as isSearchOrReadBashCommand`, `n_r as isBackgroundingSafe`, `r_r as isAutobackgroundingAllowed`,
`o_r as detectBlockedSleepPattern`. Nothing imports it. It names seven things and proves the
subsystem's identity; it is not a swap point.

### 1.2 The parser chunk, in full, because it changes the wave's shape

`chunk-fgwne0fb.js` exports:

| export | semantic name | bytes | role |
|---|---|---|---|
| `ZE` | (parser handle) | 24 | returns `{parse}` |
| `pEe` | (parse-or-abort) | 332 | length cap `Oe`, try/catch, returns the `w3` abort symbol + `tengu_tree_sitter_parse_abort` |
| `w3` | (abort sentinel) | 26 | `Symbol("parse-aborted")` |
| `e9t` | (parse + env-var extraction) | 200 | `{rootNode, envVars, commandNode, originalCommand}` |
| `wV` | (find command node) | 375 | walks pipelines/redirections to the first command node |
| `fEe` | (argv extraction) | 589 | concatenation/expansion-aware argv words |
| `z_n` | (shell keywords) | 118 | `if/then/elif/…` |

Internals: 107 declarations, largest `K` (4,278 B), `J` (4,111), `T` (4,064 — the tokenizer), `j`
(3,769), `Ue` (3,023), `Ge` (2,617). It carries its own UTF-8 byte-offset table, heredoc stack,
quote states, brace expansion and arithmetic handling. It is a self-contained, deterministic,
input→AST function with no clock, no filesystem and no process.

**Why this matters for the cut:** S-chunk's price is "the whole export surface" (§2.2). Here the
whole export surface is seven pure functions over strings, all four named importers are inside this
campaign's scope, and behavioural coverage per export is a contract test with no engine run at all.
Owning it is ~63 KB of the campaign's denominator for the risk profile of `y30v0ja7`.

### 1.3 The four engine-chunk regions

| region | offsets | decls | bytes | contents |
|---|---|---|---|---|
| **A** exec core | 95,366–106,547 | 32 | **11,145** | `wde` ring buffer · `uee`/`cye` output-limit clamp · `jUe` poll registry · **`jx` TaskOutput** · `GUe` host container (`liveShellCommands`, `pendingKillBackstops`) · `KKt` disk-space probe · **`vde` stream pump** · **`Pde` ShellCommand** · `B2` factory · `qUe`/`Mde` killed stub · `rw` synthetic-result builder · `zUe` pid liveness · `nct` kill-all |
| **B** provider / spawn / cwd / truncation | 2,100,092–2,137,241 | 114 | **37,017** | B1 command-spec tables for the OTel prefix (4,760) · B2 shell snapshot + selection (20,615: `XOn` snapshot script, `wht` writer, `QOn` PATH probe, `Tht` env probe, `EDn` `CLAUDE_CODE_SHELL` resolution, `jht` provider, `Hht` Windows binary) · **B3 `LG`, the spawn (7,758)** · B4 cwd tracking + env/stdio assembly (964: `Lc`/`PDn`/`Zht`/`xDn`/`MDn`/`tyt`) · B5 output truncation, image sniff, background notice (2,920) |
| **C** command safety + permission chain | 890,302–1,015,200 | 254 | **124,832** | C1 destructive classifier + git target scope (10,128) · C2 splitter/AST helpers/analysis classes (20,271: `Ua`, `ru`, `See`, `O9e`, `D9e`/`P8` parse cache, `P9e` snapshot-state class) · C3 file-effect analyzers for `cd/ls/find/mkdir/touch/rm/mv/cp/chmod` (20,506, incl. `pL` 3,467 and `Mnn` 2,243) · C4 flag tables + read-only classifier (28,602, incl. **`Bnn` 11,742** — the per-command safe-flag table) · C5 the decision chain (45,325, incl. **`jrn` 6,653**, `xrn` 2,795, `drn` 2,289, `_8e` 2,922, `qrn` 2,035, `$ct` 1,276) |
| **D** tool object, schema, prompt, backgrounding | 3,789,997–3,855,118 | 154 | **64,977** | D1 background-task handoff (7,773) · D2 AST prefix extractor `FWt` + tool detection (7,841) · D3 exit-code interpretation + read-file-state inference (5,973) · **D4 the Bash tool PROMPT (16,590)** · D5 sed-edit detect + classification sets + input/output schemas (8,254) · D6 `n_r`/`r_r`/`o_r` (578) · D7 simulated sed edit + formatter detect (1,941) · **D8 `yi`, the tool object (11,895)** · **D9 `Gcr`, the backgrounding generator (4,132)** |
| | | **554** | **237,971** | |

Two of those numbers deserve calling out. **D4 is 16,590 B of prose** — `ycr` (6,525, the
"# Committing changes with git" section), `izt` (4,289, the tool description proper), `Scr` (1,500),
`FPe` (2,275), `_cr` (657). The Bash tool's *description* is larger than its executor. It is
prompt-oracle surface (C6/W3's grading machinery), not executor surface, and a cut that fuses them
would put 16 KB of prose behind a process-spawn oracle. **C4's `Bnn` is 11,742 B of pure data** — a
per-command table of safe flags and their argument arities for `xargs`, `rg`, `grep`, `git`, `aki`
and dozens more. Data of that size is ownable outright with an equality assertion at the adapter, no
port and no scenario.

### 1.4 The classes, and the private-field census

Six classes in the shell path declare ECMAScript private members. This is the complete list.

| class | where | bytes | members | private | public | role |
|---|---|---|---|---|---|---|
| **`Pde`** ShellCommand | `fy12d89p` @101,936 | 3,878 | 39 | **30** (19 fields, 11 methods) | 9 | the child-process handle: timeout, kill, background, completion |
| **`jx`** TaskOutput | `fy12d89p` @97,181 | 3,294 | 36 | **16** (11 fields, 5 methods) | 20 | the output buffer: line counting, tail sampling, truncation, spill |
| `vde` stream pump | `fy12d89p` @101,567 | 369 | 8 | 6 (5 fields, 1 method) | 2 | routes a child stream into TaskOutput |
| `jUe` poll registry | `fy12d89p` @96,627 | 489 | 10 | 4 (3 fields, 1 method) | 6 | who is polling which task output file |
| `P9e` snapshot state | `fy12d89p` @908,803 | 519 | 11 | 3 | 8 | `snapshotAvailable`, session/probed env keys |
| **`C_t`** DiskTaskOutput | `13d9rycm` | 1,839 | 25 | **18** (12 fields, 6 methods) | 7 | the spill writer, one constructor site: `jx.#p()` |

And the three classes on the same path with **no** private members, which is where the pure surface
starts: `wde` (663 B ring buffer, 11 public members), `qUe` (277 B, the pre-spawn-failure stub),
`dZe` (the stdout truncator, in `chunk-04aem4bh.js`, fully public).

---

## 2. The private-field question, answered by measurement

### 2.1 What a whole-body excision would actually have to marshal

For every member of `Pde`, the private names its body touches (measured by AST walk, not by
reading):

| member | bytes | private names touched | count |
|---|---|---|---|
| `#P` on-complete | **1,141** | `#P #c #e #g #i #k #m #p #t` | 9 |
| `#h` kill | 519 | `#b #e #g #h #o` | 5 |
| `#R` wire-up | 347 | `#A #C #E #P #R #S #T #_ #l #m #o #p #s #v` | **14** |
| `#T` start poll | 346 | `#T #a #c #e #h #i #u #w` | 8 |
| constructor | 305 | `#R #d #f #g #l #n #o #p #r #u #y` | 11 |
| `background` | 275 | `#T #e #h #k #s #t` | 6 |
| `cleanup` | 162 | `#d #g #k #l #n #o #r` | 7 |
| `#k` clear timers | 134 | `#S #k #l #s #w` | 5 |
| `detach` | 106 | `#g #o` | 2 |
| `#E` on-abort | 103 | `#E #f #l` | 3 |
| `#C` on-exit / `#v` on-timeout | 68 / 68 | `#C #b` / `#d #h #v #y` | 2 / 4 |
| `#w` / `#b` / `#A` | 52 / 41 / 16 | 2 each | 2 |
| `status` getter | 28 | `#e` | 1 |
| `kill` | 24 | `#h` | 1 |

Read/write classification: of the 19 private **fields**, all 19 are read, and **12 are written
outside the constructor** (`#e #t #o #s #a #c #i #l #d #m #_ #S`). So a build that wanted to permit a
whole-body excision of any member would have to synthesise **19 getters + 12 setters + 11 method
thunks = 42 accessors** for `Pde` alone. The same walk gives **25 for `jx`** (11 getters, 9 setters,
5 thunks), **10 for `vde`**, **6 for `jUe`**, **23 for `C_t`**. Total for the shell process core:
**about 83 accessors.**

### 2.2 The reason the adapter fails is not its size — it is that its derivation cannot be checked

Size alone would be tolerable; the campaign already generates derived captures per build. The
disqualifying property is different and it is measurable.

§2.1's versioning bet is that **every capture is re-derived from the matched body each build, and
`strangle/perturb.ts` proves the derivation throws when its shape is destroyed** (44 checks at this
pin). An accessor adapter cannot honour that, because a private field's identity is carried by
nothing derivable. `Pde`'s field block is, verbatim:

```
#e="running";#t;#n;#r;#o;#s=null;#a=null;#c=!1;#i=!1;#u;#l;#f;#d;#p;#y;#m=null;#g=Cde();#_=null;#S=null;
```

Of 19 fields, **two carry a unique initializer** that could serve as an anchor (`#e="running"`,
`#g=Cde()`). Four share `=null`, two share `=!1`, and **ten are bare declarations with no initializer
at all** — their only distinguishing property is **declaration order**. `jx` is worse: one of eleven
(`#r=new wde(1000)`). `C_t`: zero of twelve.

So an accessor adapter must map at least **17 of `Pde`'s 19 fields and 10 of `jx`'s 11 positionally**,
which is precisely the class of dependency §3.4 spent a wave driving to zero (the corpus-wide
zero-positional-fallback rule) and which §2.1 identifies as the failure mode literal anchors exist to
avoid. A minifier that reorders private declarations at the next pin produces a **silent** remap:
`status` becomes `backgroundTaskId`, the owned module reads a string where it expected `undefined`,
and every covering scenario still passes because the adapter still resolves. That is the campaign's
canonical failure — a gate whose emptiness passes — reintroduced at the mechanism layer.

A second, independent objection: X4's ownership-hygiene rule says no minified identifier crosses into
owned code. An accessor adapter crosses **thirty** of them per class, under names that carry no
meaning and cannot be re-derived to a meaningful one.

### 2.3 Verdict

**S-module, behind designed ports. Do not build the private-field accessor adapter.**

The §2.3 cut rule applies cleanly and gives the same answer for a second reason: `Pde` is
**pure lifecycle**. It has no data-returning method at all — its entire public surface is
`get status`, `kill()`, `background(id, opts)`, `detach()`, `cleanup()`, plus three fields
(`taskOutput`, `result`, `onTimeout`). "Identity/lifecycle → handle-shaped port" describes it
exactly. `jx` is the mixed case: a handle (write path, spill, clear) wrapping a genuinely pure core
(line counting, tail sampling, truncation), and the port cut in §3 splits it along that line rather
than owning it whole.

The cost of the S-module route is honest and it is not the 9 KB of classes — it is that grading them
needs three oracle capabilities that do not exist (§5). The cost of the adapter route is a silent
mis-splice at the next pin bump. **The private-field blocker is real, and its correct resolution
removes it from the critical path rather than paying for it**: §7's cut puts ~190 KB of pure,
unblocked work (the parser, the classifier, the safety chain, the data tables) ahead of the 9 KB that
the blocker actually guards.

---

## 3. The subsystem's shape, and its port surface

### 3.1 The execution path, end to end

```
yi.call(input, ctx)                          D8, 11,867 B — the tool object (an object literal)
  ├ Vee(command)                             sed-edit interception (1,528 B)
  ├ $ct(input, ctx)                          C5 — checkPermissions, 1,276 B → jrn (6,653 B)
  └ Gcr({input, useSandbox, taskRegistry…})  D9, 4,132 B — async generator, the backgrounding driver
       ├ WMt / bK / F0                       timeout policy: BASH_DEFAULT_TIMEOUT_MS, BASH_MAX_TIMEOUT_MS
       ├ r_r(command)  → n_r → KTe/LP        is auto-backgrounding allowed for this command
       └ LG(command, signal, "bash", opts)   B3, 7,758 B — the spawn
            ├ RDn[shell](storageV5)          provider: jht ← EDn (CLAUDE_CODE_SHELL) + wht (snapshot)
            ├ provider.buildExecCommand()    wraps with the cwd-tracking `pwd` write
            ├ cwd existence + recovery       three fallback roots; rw(…) on total failure
            ├ worktree guards                zGe + Wgt (4,701 B) → tengu_agent_worktree_cwd_escape_blocked
            ├ pt.wrapWithSandbox / …Argv     §3.6 layer, chunk-q4xe0m2r
            ├ yDn(bin, argv, {env,cwd,stdio,detached})   the actual spawn
            ├ new jx(taskId, onProgress, …)  A — TaskOutput
            ├ B2(child, signal, timeoutMs, …) → new Pde(...)   A — ShellCommand
            └ result.then(… read cwd file → Lc → tengu_shell_set_cwd …)
```

The backgrounding half of `Gcr`, which is where the moat behaviour lives:

```
t = 0            Promise.race([result, timer(kzt=2000), abortRelay])
t ≥ 2000 ms      jx.startPolling(taskId); loop:
                   YFt(...)            register a `local_bash` task, isBackgrounded:false
                   emitToolProgress({kind:"background_hint", toolUseId})
                   yield {type:"progress", output, fullOutput, elapsedTimeSeconds, totalLines, totalBytes, taskId}
on timeout       en.onTimeout(cb) → Kdt(...) → tengu_bash_command_timeout_backgrounded
on turn-abort    mn() → Kdt(...)      → tengu_bash_command_turn_abort_backgrounded   [DEAD headlessly, §4.3]
on control frame Vdt/o9 → PWt → Kdt   → backgroundedByUser
run_in_background Kee(...)            → tengu_bash_command_explicitly_backgrounded
finally          Kdt → xWt → M$e      → the notification: Wa({mode:"task-notification", priority:"next"})
                       kWt            → the STALL detector (45 s of no growth + an interactive-prompt regex)
                       CWt            → the memory-pressure reaper (process.on("memoryPressure"))
```

Two behaviours in that block have never been named in any campaign document and are, in the user's
framing, exactly what "moat" means:

- **The stall detector `kWt` (805 B).** Every 5 s it re-stats the output file. If the file has not
  grown for 45 s and the last 1,024 bytes match one of six interactive-prompt regexes (`(y/n)`,
  `[y/n]`, `(yes/no)`, `Do you|Would you|Shall I|Are you sure|Ready to`), it pushes a notification
  saying the command "appears to be waiting for interactive input" and suggests re-running with piped
  input. Anchor `appears to be waiting for interactive input`: **1 of 1 across 1,800 files.**
- **The memory-pressure reaper `CWt` (519 B).** Registers a `memoryPressure` listener that kills a
  long-running background shell and delivers a `killed` notification. Guarded by
  `CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP` and a 30-minute floor.

### 3.2 The proposed ports

The cut rule is inherited verbatim from the executor design (`…w75-hook-executor-design.md` §3.2) and
the W9 scout: **anything that returns data goes behind a read-shaped port and leaves the consuming
logic owned and pure; anything that owns identity or a lifecycle goes behind a handle-shaped port.**
Eight ports, two stubs.

1. **`ShellProcessPort`** — handle-shaped, over the child process. `spawn(bin, argv, {env, cwd,
   stdio, detached, windowsHide}) -> Handle`; `Handle: {pid, onExit(cb), onError(cb), onStdout(cb),
   onStderr(cb), unref(), kill(pid, signal)}`; plus `isAlive(pid)` and `killProcessGroup(pid)`.
   *Handle-shaped because `Pde` is pure lifecycle: 30 private members, zero data-returning methods.*
   **BINDING-CANDIDATE:** `kill` must be separable into "signal this pid", "signal this process
   group" and "is this pid alive", because `Pde.#h` sends `SIGTERM` to the group, polls liveness every
   `zKt = 100 ms`, and escalates to `process.kill(-pid, "SIGKILL")` after `WKt = 1500 ms`. A port
   with a single `kill()` erases the escalation, which is precisely what a mutation battery must be
   able to kill.

2. **`ShellOutputSinkPort`** — handle-shaped, the *effectful half* of `jx` only:
   `openForAppend(path)`, `tail(path, bytes)`, `sizeOf(taskId)`, `unlink(path)`,
   `persistSnapshot(path, dest, maxBytes)`, `openVerified(path)`. `chunk-13d9rycm.js`'s 33 exports
   are its far side. **BINDING-CANDIDATE:** `sizeOf` and `openVerified` stay distinct members,
   because `Pde.#T` distinguishes "output file grew past `MAX_TASK_OUTPUT_BYTES`" from "output file
   was swapped underneath us" (`isTaskOutputSwapRefusal`) and produces two different user-visible
   sentences.

3. **`ShellProviderPort`** — read-shaped. `resolve() -> {shellPath, getSpawnArgs(cmd),
   getEnvironmentOverrides(host, cmd, sessionEnv), buildExecCommand(cmd, opts) -> {commandString,
   cwdFilePath}, stdin, detached}`. Region B2's 20,615 B sit behind it; the snapshot script
   generation (`XOn`, 2,366 B) is pure text and stays owned.

4. **`CwdTrackingPort`** — handle-shaped. `readTrackedCwd(file, maxBytes)`, `setSessionCwd(path)`,
   `removeTrackedFile(file)`, `realpath(path)`, `exists(path)`. This is the port the W7.5 wave's
   `CwdChanged` hook fires behind; it is small (964 B of implementation) and it is the one place the
   Bash tool mutates session state.

5. **`ShellTimingPort`** — handle-shaped. `now()`, `setTimeout(ms, fn) -> cancel`,
   `setInterval(ms, fn) -> cancel`, `unref(handle)`.
   *One port, because the subsystem has **six** deadlines and an oracle that controls five of them
   controls nothing:* `kzt = 2000` (background hint), the progress cadence, `qKt = 5000` (output-file
   poll), `plr = 5000` / `mlr = 45000` (stall detect), `WKt = 1500` (SIGTERM→SIGKILL), `zKt = 100`
   (liveness poll), plus the tool's own timeout. **BINDING-CANDIDATE.**

6. **`TaskRegistryPort`** — handle-shaped. `register(record)`, `update(id, fn)`, `get(id)`,
   `remove(id)`, `all()`. **Edge → C11c/W8c.** W10 owns the shell-side records (`type:"local_bash"`)
   and the four functions that write them (`YFt`, `Kee`, `Kdt`, `xWt`); C11c owns the store.

7. **`NotificationPort`** — handle-shaped. `push({value, mode:"task-notification", priority, agentId,
   taskId, skipAttachments})` and `deliverToAgent(taskId, outcome, {toolUseId, summary, outputFile})`.
   **Edge → C11c/W8c** (the `ssn` closure factory the W8 scout named as harder than a private-field
   class). W10 owns `M$e` (838 B) and `kWt` (805 B), which *compose* the notification; the queue is
   C11c's.

8. **`ShellTelemetryPort`** — handle-shaped. The nine `tengu_bash_*` / `tengu_shell_*` /
   `task_local_shell_*` events and the `claude_code.bash.subprocess` OTel span. Compared by trace,
   never by value. **ADVISORY.**

**Stub: `SandboxPort`** — `isEnabled()`, `wrapWithSandbox(cmd, shell, cfg, signal, attr)`,
`wrapWithSandboxArgv(...)`, `annotateStderrWithSandboxFailures(id, stderr)`, `cleanupAfterCommand()`,
`filesystemPolicy()`. At the pinned defaults `isEnabled()` is **false** and every call site takes the
false arm (§5.3). **BINDING-CANDIDATE: the stub must throw on the wrap members, not return the
command unchanged** — a silent passthrough makes a wrongly-routed sandboxed call indistinguishable
from the correct unsandboxed one, which is the same trap the W9 scout named for `StorageV5Port`. Far
side belongs to C15/W12.

**Stub: `RemoteConstraintsPort`** — `constraints.background`, `.sandbox`, `.maxTimeoutMs`,
`.pinCwd`, `.additionalDenyRead/Write`, `.scrubCredentialEnv`. Every member is `undefined` on the
headless local path; the three refusal sentences in `yi.call` and `LG` are §1.2 server-boundary
periphery. ADVISORY, ships as a null object with its guard written down.

### 3.3 What stays owned and pure

| unit | ~bytes | callers | note |
|---|---|---|---|
| **`chunk-fgwne0fb.js` in full** | 62,907 | 4 chunks | tokenizer + parser + argv/env extraction; no I/O |
| `chunk-9e2ns8ty.js` classifier region | 53,180 | — | `KTe` (11 too-complex predicates), `ge` (9,969), `za`, `Ie`, `Wo`, `Gn`, `Yn` |
| `Bnn` + `oro` + `u8e` + `l_e` + `Ern` + `Crn` + `Arn` | ~17,000 | data | per-command safe-flag tables — own outright, equality-assert at the adapter |
| `pL` + `Pnn` + `DP` + `xnn` + `Mnn` + `i8e` | ~7,600 | 4–8 | per-command argument→path/effect analyzers for `cd/ls/find/mkdir/touch/rm/mv/cp/chmod` |
| `_8e` read-only classifier | 2,922 | 1 (`yi.isReadOnly`) | fold-in candidate, but it is the function that decides which Bash calls skip the broker |
| `Ua` subcommand splitter | 409 | **23** | the single highest-leverage pure helper in the subsystem |
| `ru` argv extractor | 124 | **19** | pure-helper |
| `Ah` prefix normaliser (`timeout`/`nohup`/`env`/`sudo` stripping) | 1,288 | **9** | pure-helper |
| `Db` command-prefix peeler | 954 | 8 | pure-helper |
| `t_r` isSearchOrRead / `Ncr` noOutputExpected / `wK` command_type | 397 / 162 / 151 | 1 / 1 / 2 | fold into the tool object |
| `dZe` output truncator | ~700 | shared | public class, zero private fields, `... [output truncated - NKB removed]` |
| `wde` ring buffer | 663 | 1 | 11 public members, no privates — contract-testable today |
| `uee`/`cye` output-limit clamp | 467 | 4 / 3 | `BASH_MAX_OUTPUT_LENGTH`, default 30,000, cap 150,000 |
| `_1t` blank-line trim / `uyt` line truncation / `iyt`+`y1t` data-URI image sniff | 178 / 307 / 333 | 1 each | fold-in |
| `jWt` + `Wlr` + `jlr` exit-code interpretation | ~700 | 1 | per-command exit-code → message map (`grep`: "No matches found") |
| `Qlr`/`Jlr`/`tcr`/`rcr`/`ocr`/`gcr`/`hcr` read-inference | ~2,700 | 1 (`KWt`) | infers which files a `sed`/`cat -n`/`head`/`tail`/`grep` command read |
| `n_r` / `r_r` backgrounding-safety predicates | 298 | 1 / 1 | pure over the parse tree; `$cr = ["sleep"]` is the whole deny list |
| `o_r` sleep detector | 280 | 1 | pure — but its one caller is gate-dead (§4.4) |
| `Pde.#P`'s message selection, `jx.#d`'s line/tail sampling, `jx.#m`'s unavailable-file sentence | ~900 | — | pure logic trapped inside private methods; extractable once the port exists |

**Rounded: of ~354 KB, about 165 KB is pure and contract-testable with no process spawn** (the
parser chunk, the classifier region, the flag/effect tables, the splitter family); **about 65 KB is
prompt prose** graded by the existing prompt oracle; **about 45 KB is the permission decision chain**,
which is effectful only through the permission context C9 already owns; **about 25 KB is the shell
snapshot**, effectful but write-once; and **the effectful residue an owned implementation must write
behind ports is about 25 KB** — `LG` (7.8), `Gcr` (4.1), the six classes (11.2), the cwd tracking
(1.0), the backgrounding handoff net of registry (about 3).

That distribution is the wave's whole argument: **the blocker guards the 25 KB, not the 354 KB.**

### 3.4 Anchors

Counted across all **1,800** `modules/*.js` files. Every anchor below is prose, per §2.1's
preference; the structural fallback is not needed anywhere in this subsystem.

**Unique (1 of 1), by owning unit:**

| anchor | unit |
|---|---|
| `Run shell command` | `yi.description` (already W1's `coLiteral`) |
| `execute shell commands` | `yi.searchHint` |
| `Command timed out after ` | `Pde.#P` |
| `Command killed: output file exceeded ` | `Pde.#P` |
| `Command killed: its output file was replaced or could no longer be verified` | `Pde.#P` |
| `<bash output unavailable: output file ` | `jx.#m` |
| `This usually means another Claude Code process in the same project deleted it during startup cleanup.` | `jx.#m` |
| `appears to be waiting for interactive input` · `The command is likely blocked on an interactive prompt.` | `kWt` |
| `Session cwd remains ` · `directory changes made by the backgrounded command do not apply` | `yi.call` background cwd hint |
| `no longer exists. Please restart Claude from an existing directory.` | `LG` cwd recovery |
| `sandbox wrapWithSandboxArgv returned empty argv` | `LG` |
| `Bash: command contained null bytes (argv echo redacted)` | `yi.call` pre-spawn error |
| `Creating shell snapshot` | `wht` |
| `# Committing changes with git` | `ycr` (the prompt) |
| `This command uses shell operators that require approval for safety` | `mrn` |
| `Failed to parse command` · `No pipes found in command` · `Base command not found` | `w8e` · `mrn` · `hrn` |
| `Parser aborted (timeout, resource limit, or over-length)` · `Contains lone surrogate` · `Contains control characters` · `Contains Unicode whitespace` · `Contains zsh ~[ dynamic directory syntax` · `Contains brace with quote character (expansion obfuscation)` · `Parser skipped input between top-level statements` · `Parser did not consume trailing input` | `KTe`, in `chunk-9e2ns8ty.js` |
| `tengu_bash_command_timeout_backgrounded` · `…_turn_abort_backgrounded` · `…_explicitly_backgrounded` | `Gcr` (three arms, three anchors) |
| `task_local_shell_stall_detected` · `task_local_shell_pressure_reap` | `kWt` · `CWt` |
| `claude_code.bash.subprocess` | `LG`'s OTel span |
| `CLAUDE_CODE_AUTO_BACKGROUND_TIMEOUT_MS` | `WMt` |
| `output truncated - ` | `dZe` (in `chunk-04aem4bh.js`) |

**Needs a `coLiteral` or a structural anchor (2–3 occurrences, second copy in the PowerShell chunk):**
`<error>Command was aborted before completion</error>` (2 — the known case),
`No mode-specific handling for` (3: 1 + 2 in `hw8qz4q5`), `The standard output of the command` (2),
`To wait for a condition, use Monitor with an until-loop` (2),
`Do not chain shorter sleeps to work around this block.` (2),
`Shell cwd was reset to ` (2, both in the engine chunk — the template and its extraction regex),
`lines truncated] ...` (2), `Output truncated (` (2).
`tengu_shell_set_cwd` occurs 3× **all inside the engine chunk** (`Lc`'s success arm and `LG`'s two
failure arms), so it scopes a splice to a chunk but not to a site — the `Lc` splice should anchor on
`Shell cwd was reset to ` with a `coLiteral`, not on the event name.

**Genuinely unanchorable after enumeration** (no prose of their own, and their identity is a shape):
`Ua`, `ru`, `Ah`, `Db`, `t_r`, `Ncr`, `wK`, `n_r`, `r_r`, `wde`, `uee`, `_1t`, `uyt`, and every
`Pde`/`jx` member except `#P`, `#m` and `getStdout`. All are pure or lifecycle-only; **none of them
should be an S-method row.** They ride into ownership inside the S-chunk (the parser), inside the
S-module (the classes), or as fold-ins to a spliced caller that does have an anchor. That is the
right answer rather than a gap — §2.1's anchor budget explicitly wants fewer, larger seams.

---

## 4. Coverage: what the 59 scenarios reach, and what they do not

### 4.1 The corpus, read as an artifact

**Sixteen cassette families carry a recorded Bash `tool_use`**, issuing **21 distinct commands**
across **105 occurrences**:

| scenario | commands |
|---|---|
| `bash-tool` · `hooks` · `hooks-command` · `partial-tool-args` · `perm-rule-ask` | `echo <MARKER>` (5 distinct markers) |
| `hooks-batch` · `parallel-tools` | `echo REFORGE_BATCH_1/2`, `echo REFORGE_P1/P2/P3` |
| `hooks-cwd-change` | `cd moved`, `pwd` |
| `hooks-file-watch` | `pwd`, **`sleep 3`** |
| `hooks-permission` · `perm-broker-updates` | `mkdir -p …` (3 distinct) |
| `hooks-tool-failure` | `reforge-no-such-command-probe --fail` |
| `perm-accept-edits` · `perm-rule-deny` · `perm-bypass-deny-rule` · `perm-auto-classifier-deny` | `chmod 600 perm.txt` |
| `interrupt` (m3) | `sleep 25 && echo REFORGE_SHOULD_NOT_FINISH` — never lands in a later request body because the turn is cut short |

**`run_in_background` is set on zero of the 105.** The `background-task` scenario, which the campaign
names as the moat's backgrounding evidence, drives **the Agent tool's** `run_in_background`, not
Bash's — its `substanceOnly` check asserts `dispatch.input.run_in_background === true` on an
`Agent` dispatch. **The named moat behaviour "bash with background notification" has no scenario.**

### 4.2 What that reaches, per arm

| arm | status | evidence |
|---|---|---|
| spawn → exit 0 → stdout, plain | FIRED | every `echo` |
| spawn → exit ≠ 0 | FIRED | `reforge-no-such-command-probe --fail` (127) |
| `noOutputExpected` (`Ncr`) | FIRED | `mkdir -p`, `chmod` |
| read-only auto-allow (`_8e` → `yi.isReadOnly`) | FIRED | `echo`, `pwd` — this is what makes the broker skip them |
| per-subcommand aggregate (`drn` → `subcommandResults`) | FIRED | every W6 denial (W6 matrix line 151) |
| cwd tracking (`Lc`, `tengu_shell_set_cwd`) | FIRED | `hooks-cwd-change` (W7.5) |
| kill on abort (`Pde.#E` → `#h`, SIGTERM→SIGKILL) | FIRED | `interrupt`, reason `"interrupt"` |
| progress yields + `jx.startPolling` + `YFt` + `background_hint` | **FIRED, unrecorded** | `sleep 3` exceeds `kzt = 2000 ms`, so `Gcr` registers a `local_bash` task and emits `background_hint`. No check anywhere asserts it |
| `run_in_background: true` → `Kee` | **UNREACHED** | no scenario sets it |
| auto-background on timeout → `Kdt` | **UNREACHED** | needs `timeout` < command duration and `r_r(command)` true |
| `backgroundedByUser` → `Vdt`/`o9` | **UNREACHED, condition named** | §4.3 |
| `backgroundedToDeliverMessage` → `JFt` | **UNREACHED** | needs a queued task-notification message during a live Bash |
| `backgroundedByTurnAbort` | **DEAD headlessly** | §4.3 |
| the notification (`xWt` → `M$e` → `Wa`) | **UNREACHED** | follows any backgrounding |
| stall detector `kWt` | **UNREACHED** | 45 s of no growth + an interactive-prompt tail |
| memory-pressure reaper `CWt` | **UNREACHED** | needs a real `memoryPressure` event |
| output > 30,000 chars (`dZe` truncation, `uyt`) | **UNREACHED** | longest recorded stdout is a 19-byte marker |
| spill to disk (`jx.#p` → `C_t`) | **UNREACHED** | needs > `NKt = 8,388,608` bytes buffered, or `stdoutToFile` |
| output file > `MAX_TASK_OUTPUT_BYTES` (`Pde.#T` → `#c`) | **UNREACHED** | needs a backgrounded command writing past the cap |
| output-file swap refusal (`Pde.#i`) | **UNREACHED** | needs the file replaced mid-run |
| pre-spawn error (`rw`) | **UNREACHED** | needs a deleted cwd or a null byte in the command |
| image stdout (`S1t`, `y1t`) | **UNREACHED** | needs a `data:image/…;base64,` stdout |
| sandbox wrap | **UNREACHED, settings-guarded** | §5.3 |
| `detectBlockedSleepPattern` | **GATE-DEAD** | `tengu_amber_sentinel` false (§4.4) |
| PowerShell | **OPEN, env-guarded** | §5.4 |

### 4.3 The moat behaviour: what creates it headlessly, and what it costs

This is the wave's most consequential coverage result, so it is stated with its guards rather than
its absence (the C10.5 lesson).

**Four backgrounding arms exist. Their headless firing conditions, measured:**

1. **`run_in_background: true`.** `Tzt()` — the tool's input schema — omits the field only when
   `$d()` is true, and `$d() = backgroundTasksDisabled || CLAUDE_CODE_DISABLE_BACKGROUND_TASKS`,
   neither of which is set. **The field is presented headlessly.** A prompt that asks for a
   backgrounded command reaches `Kee`, which registers the task, backgrounds the shell, and arms
   `xWt`. **Cost: one recording, two turns** (turn 1 starts it, the notification is delivered as an
   attachment on the next user turn — which is observable on the wire in the request body). This is
   the cheapest and it is the arm the moat claim actually names.

2. **Auto-background on timeout.** `Gcr` arms `en.onTimeout` only when `nn = r_r(command)` is true.
   `r_r` requires the parse to be `kind: "simple"`, no subcommand to be a `git` command (`LP`), and
   the first word not to be in `$cr = ["sleep"]`. So `sleep 30` is *excluded by design* and a
   `timeout: 2000` on something like `python -c "import time; time.sleep(30)"` is the shape that
   fires. **Cost: one recording with an explicit small `timeout`.**

3. **`backgroundedByUser` via the control protocol.** `chunk-dvbbv89q.js` serves
   `control_request` subtype **`background_tasks`**: with `tool_use_id` it calls `Vdt(id, registry)`
   (background that one), without it `o9(registry)` (background all running `local_bash`). The
   installed SDK can construct the frame (`sendable: true`), and W7's probe already fired the arm —
   against an empty registry, so it answered success without touching a shell. **Cost: one
   scenario that starts a Bash, waits for the `tool_use` frame, sends `background_tasks` with that
   `tool_use_id`, and reads back `{backgrounded: true}` plus the notification.** This is the
   `interrupt` scenario's exact shape with one frame changed, and the harness already has that
   machinery.

4. **`backgroundedByTurnAbort` — DEAD headlessly.** `$A.backgroundsTheShell(reason, caller)` is
   `caller === "turn" && unwrapAbortReason(reason) === "turn-abort"`. The abort-reason table lives in
   `chunk-t0q53bgm.js` and `Su("turn-abort")` is constructed at exactly **one** site bundle-wide:
   `chunk-6thm48px.js`'s `raiseTurnStart({… abort: () => x.abort(Su("turn-abort"))})` — the
   **interactive** session controller. The headless loop aborts with `user-cancel`, `interrupt` or
   `shutdown`, none of which background. Record it as DEAD with that producer named, not as debt.

**And the notification itself.** All four arms converge on `xWt` → `M$e`, which pushes
`{mode: "task-notification", priority: "next", taskId, toolUseId, outputFile, summary}` onto the
notification queue and calls `ys(...)` for agent delivery. The queue is C11c's (`Wa`/`Pu`, the `ssn`
closure factory). **W10 can grade the notification's *content and timing* the moment any arm fires;
it cannot own the queue.** Note also that `FE()` returns `!1` unconditionally in this build, so the
richer `taskDelivery` envelope and the output-tail read are dead, and the delivered notification is
the plain summary — which is what an owned implementation must reproduce.

### 4.4 The gate-dead and settings-dark arms, with their guards

| arm | guard | measured |
|---|---|---|
| `detectBlockedSleepPattern` + the "Monitor with an until-loop" prose | `RI() = I("tengu_amber_sentinel", !1)` | default false; W8 measured no env override. Also removes the `Monitor` bullets from the Bash description |
| the task-ack result envelope (`GMt`, `qMt`, `tengu_bash_task_ack`) | `FE()` returns `!1` **unconditionally** | dead in this build. W1's `bash-tool-result` splice carries `useTaskAck` as a derived capture on a branch nothing can take |
| the whole sandbox wrap | `settings.sandbox.enabled ?? false` | a **settings** key, not a gate (§5.3) |
| PowerShell | `CLAUDE_CODE_USE_POWERSHELL_TOOL` (off Windows: `e === !0`) | env flip; rewrites the catalog for the whole run (§5.4) |
| storage-v5 output persistence (`I$t`, `Pcr`, `Rcr`) | `O()` — `tengu_hover_rest`, default false | W9 measured this; it reaches the Bash path too, in `yi.call`'s persisted-output block |
| worktree isolation guards (`Wgt`, 4,701 B, 4 telemetry anchors) | `isolationRoot`/`agentWorktree` set | only on the Agent/worktree path — C15's condition, not W10's |
| remote-execution refusals (`cne`, three sentences) | `remoteCall.constraints` | §1.2 server boundary |

### 4.5 Recording budget

Six recordings buy the whole unreached surface that matters, ranked:

1. **`bash-background-explicit`** — `run_in_background: true`, two turns, the notification delivered
   as an attachment on turn 2. *The moat scenario.*
2. **`bash-background-control`** — start a long Bash, send `background_tasks` with its `tool_use_id`,
   assert `{backgrounded: true}` and the notification. *Reuses `interrupt`'s machinery; also closes
   W7's `background_tasks` row from "answered success on an empty registry" to a real effect.*
3. **`bash-timeout-background`** — small `timeout`, a non-`sleep` long command; grades `WMt`, `r_r`,
   `Kdt` and `timedOutAfterMs`.
4. **`bash-large-output`** — deterministic > 30 KB stdout inside the sandbox; grades `dZe`'s
   `... [output truncated - NKB removed]`, `cye`'s clamp, `jx.#d`'s tail sampling and
   `isResultTruncated`.
5. **`bash-compound-safety`** — one command with a pipe, a redirect, a subshell and two `cd`s;
   grades `Ua`, `KTe`'s too-complex arms, `drn`'s aggregate and the two live `Fy` callers W6 left
   OPEN (the multi-`cd` aggregator and the subcommand merge tie-break).
6. **`bash-prespawn-error`** — a command containing a null byte, or a deleted cwd; grades `rw` and
   the two `R(...)` refusals in `yi.call`.

Two more are cheap but need machinery first (§5.2): a stall-detector scenario (needs timer
injection — 45 s of wall clock is not acceptable in a replayed corpus) and a sandbox scenario (needs
a settings key plus a macOS host assertion).

---

## 5. The grading surface

### 5.1 What exists today

- `strangle/modules/bash-tool-result/` — one S-method splice on `mapToolResultToToolResultBlockParam`,
  anchored on `<error>Command was aborted before completion</error>` with `coLiteral`
  `"Run shell command"`, five pure-helper captures, three primitives, three ports,
  `coverage: ["bash-tool", "hooks", "partial-tool-args", "parallel-tools"]`. Its solo sabotage
  reddens four scenarios — the corpus's widest. It grades **the plain stdout arm of six** (README).
- `strangle/contracts.test.ts` — 135 checks, including "Bash's preview splitter and its strict
  halfway test".
- `src/state.ts` — the sandbox filesystem tree plus a derived exit outcome. Sees files a Bash command
  created; sees nothing about the process that created them.
- The permission chain's Bash arms are graded through C9's rows and the W6 matrix; seven attestation
  exclusions cover the sandbox carve-out.

### 5.2 The three capabilities no oracle has, that only this subsystem needs

The executor design named three (interleaved event log, stdout chunk reproduction, grading a promise
that never settles); W9 named three (flush-schedule control, dirty-precondition seeding, fs fault
injection). W10's three:

1. **A scripted child process.** Every existing Bash scenario spawns a real shell running `echo`,
   `mkdir`, `chmod` or `sleep`. To grade the executor you need a child whose behaviour is
   *specified*: writes N bytes on a stated schedule, exits with a stated code, ignores `SIGTERM`,
   holds a file descriptor open, or emits an interactive-prompt tail. Without it, `Pde.#C` (exit
   handler), `#A` (spawn error), `#h`'s SIGTERM→SIGKILL escalation and `jx`'s truncation ladder are
   graded by wall-clock luck. The cheapest form is a committed helper script inside the sandbox with
   a declarative argv, which both engines run identically.

2. **Injectable timers for the six shell deadlines.** `kzt = 2000`, the progress cadence,
   `qKt = 5000`, `plr = 5000` / `mlr = 45000`, `WKt = 1500`, `zKt = 100`. Today reaching the
   background hint costs 2 s of real time per scenario and reaching the stall detector costs 50 s;
   the SIGTERM→SIGKILL escalation cannot be reached at all without a child that ignores signals *and*
   1.5 s of patience. This is `ShellTimingPort` on the owned side and a corresponding clock control
   on the oracle side, and it is the difference between a grading matrix and a flaky one.

3. **Child-process supervision in the state surface.** `src/state.ts` snapshots files and an exit
   outcome. `Pde.detach()` calls `child.unref()` and drops the handle; `nct()` kills every live shell
   on `SIGTERM`; `CWt` reaps on memory pressure; `Kdt` caps a backgrounded shell at
   `CLAUDE_SUBAGENT_BG_SHELL_MAX_MS`. **An engine that leaks a child, or kills one it should have
   detached, is invisible to every diff surface the campaign has.** W9 named process supervision as
   its carry-over; W10 is the wave that cannot be graded without it. Concretely: after each scenario,
   enumerate the engine's descendant processes and compare the set between engines, with the
   deliberately-detached ones declared.

A fourth is worth naming as an *environment axis* rather than a capability: **the sandbox's OS
boundary**. Grading `pt.wrapWithSandbox` needs a macOS host with `/usr/bin/sandbox-exec` (or a Linux
host with `bwrap` and the seccomp helper), and the harness has no notion of a host capability that a
scenario can require. §3.6's isolation substrate lands at W13 and will need the same notion; W10
should not build it, but it should record that the sandbox rows stay OPEN until it exists.

### 5.3 The sandbox, measured, with its real guard

`chunk-q4xe0m2r.js` is 581,554 B / 838 declarations, of which the sandbox's own logic is a minority —
the chunk also carries picomatch, `@bufbuild/cel` and protobuf. The shape:

- `pt` (the `SandboxManager` façade, 2,672 B, ~50 members) delegates to `ct`, a second façade over
  the vendored `sandbox-runtime` (`srt`, 119 references).
- **macOS**: a seatbelt profile builder emitting `(version 1)`, `(deny default (with message …))`,
  then `process-exec`/`process-fork`/`mach-lookup` allow rules and generated `file-read*` /
  `file-write*` allow/deny lists, executed as
  `env -u … /usr/bin/sandbox-exec -p <profile> <shell> -c <command>`.
- **Linux**: `bwrap` (14 references) plus `apply-seccomp` (11) loaded from `/proc/self/exe` by
  `rXn()`; `SeccompFilter` (9).
- **Windows**: a separate installer/launcher path (`installWindowsSandbox`,
  `classifyWindowsSandboxLaunchExit`, `WindowsSandboxError`).
- Filesystem policy: `F2()` returns `"strict"` under env scrub or Windows, otherwise reads
  `tenguSandboxGbConfig().filesystemPolicy`, default `"strict"`.

**The headless guard, precisely:**
`pt.isSandboxingEnabled()` = `Xa()` = `!sandboxDisabledThisSession && Tm() && checkDependencies().errors.length === 0`,
where `Tm() = Pi() && qa() && xm()` and `Pi() = shouldForceSandboxOn() || settings.sandbox.enabled ?? false`.
**No `tengu_*` gate and no environment variable appears in that chain.** It is a settings key.
`bv(input, opts)` — the per-call "should this be sandboxed" decision — returns `false` immediately
when `isSandboxingEnabled()` is false, which is why `LG`'s entire wrap block and `yi.checkPermissions`'
`dangerouslyDisableSandbox` arm are unreached today.

This makes the seven attestation exclusion reasons quoted in §0.10 wrong in their premise. The
correction is small and it *helps*: reaching the sandbox conjunction costs a `settings` object, which
the W6 scenarios already know how to write, plus a host that has `sandbox-exec`. It is not an X6
fight.

### 5.4 PowerShell, measured

`chunk-hw8qz4q5.js` is 113,703 B / 455 declarations, exporting `PowerShellTool` plus the three
backgrounding predicates. **It imports 62 symbols from the engine chunk, including `LG`, `jx`,
`Kee`, `YFt`, `Kdt`, `QFt`, `ZFt`, `G4e`, `WMt`, `cye`, `bv`, `_1t`, `S1t`, `b1t`, `T1t`, `w1t`,
`H$t`, `I$t`, `x$t`, `oct`, `i1t`, `s1t`, `a1t`, `R3e`, `Aee`, `Nct`.** PowerShell is a **re-skin
over the same executor**: `LG(command, signal, shellType, opts)` already takes
`shellType ∈ {"bash","powershell"}` and dispatches through `RDn = {bash: …, powershell: ADn}`. Its own
113 KB is its cmdlet safety surface (`rt`, 10,249 B of cmdlet→operation/path mappings; `xs`, 10,878 B
permission decision; `Vn`, 6,377; `tt`, 3,756 mode handler; its own PowerShell tokenizer) plus `Aa`
(7,739 B, the tool object) and `Hs` (4,029 B, a near-copy of `Gcr`).

Catalog gate, measured in `Y0()`: `WAe = () => Ck() ? PowerShellTool : null`, and
`Ck()` off Windows is `CLAUDE_CODE_USE_POWERSHELL_TOOL === true`. Bash itself is
`...as() ? [yi] : []`, and `as()` is unconditionally true off Windows — **so the flip ADDS PowerShell
and does not remove Bash**, confirming the W8 scout's correction and refuting the substitution
reading still printed in `reforge/README.md` (§6).

**Recommendation:** own the shared executor once (C13d), then `tool/PowerShell` becomes a small row —
its tool object, its schema, its prose, its cmdlet tables — behind an env flip that rewrites the
catalog for a whole run. That makes it a *separate recording axis*, not a scenario, exactly as the
attestation already argues for the prompt section. It should be the last child, and it is legitimately
deferrable.

### 5.5 The dirty-state and edge matrix (the §3.1 S-module obligation)

Fourteen cells, each with the mechanism it grades and what creates it.

| # | cell | grades | created by |
|---|---|---|---|
| D1 | a `cd` that persists into the next command | `Lc`, `PDn`, the provider's `pwd` write-back | exists (`hooks-cwd-change`) |
| D2 | `cd` into a directory that is then deleted before the next command | `LG`'s three-root recovery + `rw`'s "Please restart Claude" | new: `cd d && rmdir` then a second command |
| D3 | two `cd`s in one command | the multi-`cd` aggregator `Drn` (W6's live-but-dark `Fy` caller) | new: `cd a && cd b` |
| D4 | env inherited from the snapshot vs. per-call overrides | `xDn`, `Tht`, `sCe`, the snapshot script | new: a command that prints a snapshot-defined alias/function |
| D5 | `CLAUDE_CODE_SHELL_PREFIX` set | `fDn`, `B6` | new (env axis; note the var is currently outside X6) |
| D6 | output exactly at, and one byte past, `BASH_MAX_OUTPUT_LENGTH` | `dZe`, `cye`, `uyt`, `isResultTruncated` | new: deterministic generator |
| D7 | output past the 8 MB in-memory cap | `jx.#p` → `C_t` spill, "Full output saved to:" | new: large generator |
| D8 | background job completes while the session is alive | `xWt` → `M$e` → the notification | new (§4.5 #1) |
| D9 | background job still running at session end | `nct()` on SIGTERM, `Kdt`'s `capMs`, leaked-child supervision | new; needs §5.2 #3 |
| D10 | abort with reason `interrupt` mid-command | `Pde.#E` → `#h`, SIGTERM then SIGKILL after 1,500 ms | exists (`interrupt`); the escalation half needs §5.2 #1 |
| D11 | command that ignores SIGTERM | `#h`'s `process.kill(-pid, "SIGKILL")` and the `zUe` liveness poll | new; needs §5.2 #1 |
| D12 | timeout with and without auto-backgrounding armed | `WMt`, `r_r`, `Kdt`, `timedOutAfterMs`, `Command timed out after ` | new (§4.5 #3) |
| D13 | output file replaced or deleted mid-run | `Pde.#i` / `jx.#m`'s "output unavailable" sentence | new; needs §5.2 #1 |
| D14 | two Bash calls in one assistant message | `isConcurrencySafe`, per-call `jx` isolation, progress-id sequencing | exists (`parallel-tools`) — but only for `echo` |

D3, D6, D10-escalation and D12 are the four that most directly harden what the corpus already
half-touches; D8 and D9 are the moat.

---

## 6. Parent-impact list

Every claim about W10 found wrong, with the measured correction. Nothing below was edited by this
scout — the orchestrator owns placement, and `strangle/*`, `ledger.json` and `attestation.ts` are
under concurrent edit.

| where | claim | measured correction |
|---|---|---|
| campaign spec §1.1, bash row | "`fy12d89p` @2.9k, @100–105k; `w7bq1qyb`" | `w7bq1qyb` is `claude plugin eval` (4 exports) — 287 KB leave the row. "@100–105k" is right (offsets 95,366–106,547). The row must gain `chunk-fgwne0fb.js` (62,907 B, the parser), `chunk-9e2ns8ty.js` @108,945–162,000 (53,180 B, the classifier), and `chunk-13d9rycm.js` as a shared edge |
| census line 40–41 | "Bash tool (exec…) ~200 KB; Bash command safety / AST `fy12d89p` @28–30k; `w7bq1qyb` ~350 KB" | the safety chain is at **890k–1,015k**, not @28–30k; the two rows together are ~354 KB, not ~550 KB |
| census line 40, seam quality | "**high** — ES class with `#`-private fields" | the *tool* is an object literal with no private fields; four small classes (11.2 KB total) carry them. Seam quality is **high for the parser (S-chunk), medium for the safety chain (S-method), low for the process core (S-module)** |
| campaign §2.1 + §6-W10 + C1 Revision Note | "the Bash tool's command class… W10 must budget a declared private-field accessor adapter, or take the executor at S-module granularity" | measured: 83 accessors for the core, of which **31 field identities are positional-only** (10 of `Pde`'s 19 and 10 of `jx`'s 11 have no initializer). The adapter is buildable and **should not be built** — its derivation is unverifiable, which contradicts §2.1's bet and §3.4's zero-positional rule. **S-module.** And the blocker guards ~25 KB of ~354 KB |
| §6-W10 row, mechanism | "S-method (class-method shape) → S-module" | four tiers, in this order: **S-chunk** (the parser), **S-method** (the safety chain + the prompt + the tool object's members), **owned data** (17 KB of flag tables), **S-module** (the process core). The class-method shape is not needed at all |
| §1.3 / ledger | no `tool/PowerShell` row; `subsystem/bash-executor` has zero edges | add `tool/PowerShell` → C13; add edges from `subsystem/bash-executor` to `subsystem/moat-tools` (task registry + notifications), `subsystem/permissions`, `subsystem/hook-dispatch` (shared `Pde`/`jx` via `Nq`), `subsystem/sandboxing`, `subsystem/session-storage` (`storageV5` output persistence) |
| ledger `subsystem/tool-result-validators` | `"wave": "C4"`, note says "the roadmap owes it a wave assignment" | the spec's C13 section assigns it to C13. The ledger row still says C4 |
| W8 scout §C11c | "`TaskOutputPort` (with `DiskTaskOutput`'s twelve private fields behind the port)" | `C_t` has **one** constructor site bundle-wide — `jx.#p()`, the Bash spill path. Twelve private fields **and six private methods**. It belongs behind W10's `ShellOutputSinkPort`; C11c's task tools reach task output through free functions |
| `reforge/README.md` §Flip-liveness (~line 918) | "`Read` leaves the presented tool array and `PowerShell` takes its place" | superseded by W8 and confirmed here from `Y0()`: `as()` is true off Windows so `yi` stays; `WAe()` appends. The catalog **grows by one** and positions shift — a positional diff misread |
| `reforge/README.md` anchor note (~line 1165) | "**Bash has no graph-unique literal**" | true of the *formatter*. The executor, safety layer and prompt carry ≥16 anchors that are 1-of-1 across all 1,800 module files (§3.4) |
| `strangle/attestation.ts`, 7 sandbox exclusions | "§3.3 pins the gate state and X6 forbids the env overrides that would flip it" | `isSandboxingEnabled()` reads `settings.sandbox.enabled ?? false` — **a settings key, not a gate, and no env var is in the chain**. Conclusion (unreached) stands; the reason is wrong and the remedy is cheaper than stated |
| `strangle/manifest.ts` `bash-tool-result` | capture `useTaskAck` derived from `if((ID)())return{tool_use_id` | that gate is `FE()`, which returns `!1` unconditionally in this build. The capture is live as a derivation; the **branch** is dead, and the row's coverage claim should say so |
| W5–W7 scout §0 | "`hw8qz4q5` (114 KB) = the PowerShell tool + Bash backgrounding safety. Belongs to W10" | correct, and now completed: it also **imports 62 symbols from the engine chunk and shares `LG`, `jx`, `Kee`, `Kdt` and the whole notification path**. Owning the executor gets most of PowerShell for free |
| W7 matrix, `background_tasks` | "**FIRED** — answered success" | the *arm* fired against an **empty registry**. The Bash-side effect (`Vdt` → `Kdt` → `background()` → notification) is unreached. Verdict should read FIRED (arm) / UNREACHED (effect), with the condition named |
| campaign §3.2 "the four named moat behaviours" | "bash with background notification" counted as covered by `background-task` | `background-task` drives the **Agent** tool's `run_in_background`. Zero of 105 recorded Bash `tool_use` inputs set `run_in_background`. The behaviour has **no** scenario |
| executor design (`…w75-hook-executor-design.md`) `ProcessPort` | designed to serve `Nq`'s callers | measured: `Nq` uses `B2` and `jx` and **not** `LG`. The shared core is the process handle + output buffer, one level below the Bash-specific spawn. **They should share `ShellProcessPort` and `ShellOutputSinkPort`; they must not share the layer above** (shell provider, snapshot, sandbox wrap, worktree guards, cwd write-back are Bash-only) |

---

## 7. A proposed cut for C13 — advisory

**W10 is not one wave.** It is ~354 KB across four mechanism tiers, its S-module third is blocked on
three oracle capabilities that do not exist, and its other two thirds are pure and unblocked today.
Fusing them would put the campaign's best S-chunk candidate and 165 KB of contract-testable code
behind a process-spawn oracle — the same mistake the W9 cut avoided by putting the reader before the
writer, and the same one the hook-executor design avoided by refusing to implement before its oracle
existed.

Five children plus one advisory, machinery interleaved rather than first (unlike W9, because two
children need no machinery at all).

**C13a / W10a — the shell parser, whole-chunk.** *(autonomous, opus-tier; cut NOW, blocked-by
nothing)*
Own `chunk-fgwne0fb.js` outright: 62,907 B, 7 exports, 4 named importers, one import of its own, zero
I/O. Full export-and-consumer inventory per §2.2, coverage attestation per §3.1, contract tests over
partitioned command strings (quoting, heredocs, brace expansion, arithmetic, process substitution,
the byte-offset table, the `Oe` length cap and the abort symbol). No port, no scenario, no engine run.
*Observable acceptance:* every export behaviourally covered and sabotage-RED; the coverage
attestation's branch inventory generated from the chunk's own AST; the corpus stays green.
*Why first:* it is 18 % of the row's denominator at the risk profile of the 1.4 KB S-chunk pilot, and
it is the substrate everything else in W10 parses through.

**C13b / W10b — the command-safety chain and its data tables.** *(autonomous, opus-tier; cut NOW,
blocked-by C13a for the parse types only)*
Regions C1–C5 (124,832 B) plus `chunk-9e2ns8ty.js`'s classifier region (53,180 B). Own the ~17 KB of
flag/effect tables outright with adapter equality assertions; S-method rows on the prose anchors
(`KTe`'s eight too-complex sentences, `mrn`, `hrn`, `w8e`, `_8e`, `drn`); fold in the unanchorable
pure helpers (`Ua`, `ru`, `Ah`, `Db`) at their spliced callers. Adds `bash-compound-safety` (§4.5 #5),
which also closes the two live-but-dark `Fy` callers W6 recorded.
*Edges:* → C9/W6 (this is the Bash half of the permission surface C9 explicitly did not own — the
`subcommandResults` aggregate the corpus's every Bash denial carries).
*Observable acceptance:* the W6 permission matrix's Bash cells stay green under the owned chain; the
per-subcommand aggregate is reproduced for a compound command; each table's adapter assertion fires
on a perturbed entry.

**C13c / W10c — executor oracle machinery.** *(controlled, opus-tier; cut NOW, blocked-by nothing;
serializes through the orchestrator per X5)*
The three §5.2 capabilities: a scripted-child helper committed into the sandbox with a declarative
argv (byte schedule, exit code, signal behaviour, prompt-shaped tail); timer control for the six
shell deadlines; and child-process supervision added to `src/state.ts` as a third snapshot root
(descendant set at scenario end, with deliberately-detached children declared). Plus the six
recordings of §4.5 that need no machinery, and the two that do.
*Observable acceptance:* each capability ships with a negative control — a scripted child whose
schedule is perturbed must change the graded output; a scenario that leaks a child must FAIL the
state diff; a timer whose value is perturbed must move the background hint.
*Why a child and not a prologue:* it is the only piece W10 shares with W9's named carry-over and with
W13's isolation substrate, and it is dispatchable in parallel with C13a/C13b.

**C13d / W10d — the executor S-module.** *(fable-tier; ADVISORY, cut when C13c lands)*
`ShellProcessPort`, `ShellOutputSinkPort`, `ShellProviderPort`, `CwdTrackingPort`, `ShellTimingPort`,
`ShellTelemetryPort`, plus the `SandboxPort` and `RemoteConstraintsPort` stubs. Owns `Pde`, `jx`,
`vde`, `jUe`, `C_t`, `LG`, `Gcr`, the snapshot machinery and the cwd write-back — about 25 KB of
effectful residue and 25 KB of snapshot. §3.1's full S-module bar: the §5.5 dirty-state matrix
(D1–D14), the bounded mutation battery (swallowed exit codes, dropped kill escalation, reordered
progress yields, ignored cancellation, wrong task-id propagation, missing spill), and coverage
attestation.
*Edges:* → C8/W5 (**share `ShellProcessPort` and `ShellOutputSinkPort` with the hook runner `Nq`;
do not share `ShellProviderPort` or above** — measured, §6), → C15/W12 (`SandboxPort`'s far side),
→ C11c/W8c (`TaskRegistryPort`), → C12/W9 (`storageV5` output persistence).
*On the ProcessPort question, plainly:* the Bash executor should **share** the process-handle and
output-sink ports with the hook executor and **own** everything above them. `Nq` calls `B2` and `jx`
directly and never touches `LG`; the layer `LG` adds (shell provider, snapshot, sandbox wrap,
worktree guards, cwd write-back, the OTel span) has exactly one other consumer, and that consumer is
PowerShell.

**C13e / W10e — the backgrounding and notification moat.** *(fable-tier; ADVISORY, cut when C13d's
ports exist; may start its scenarios as soon as C13c lands)*
`Gcr`'s four arms, `YFt`/`Kee`/`Kdt`/`xWt`/`M$e`, the stall detector `kWt`, the pressure reaper
`CWt`, the `background_hint` progress channel, and the cwd/`backgroundCwdHint` interaction. Records
`bash-background-explicit` and `bash-background-control`; records `backgroundedByTurnAbort` as DEAD
with its producer named.
*Edges:* → C11c/W8c (the notification queue and the task store are C11c's; W10 owns what composes the
notification and when).
*Why separate from C13d:* this is the wave's product claim. Fusing it with the port work would let a
green executor hide an ungraded moat behaviour, which is exactly the shape §3.1 warns about.

**C13f / W10f — PowerShell and the validators row.** *(autonomous, opus-tier; ADVISORY, cut last)*
`tool/PowerShell` (its tool object, schema, prose and cmdlet tables — the executor comes free from
C13d) behind the `CLAUDE_CODE_USE_POWERSHELL_TOOL` recording axis; and
`subsystem/tool-result-validators` (the Edit `validateInput` unit C4 split out, 3,317 chars, plus its
19 siblings), which the spec routed here on the reasonable ground that W10 is the execution-depth
wave. Both are genuinely deferrable and neither blocks anything.

**Ordering.** C13a ∥ C13b ∥ C13c now (disjoint files; C13c's recordings serialize per X5). C13d after
C13c. C13e after C13d. C13f last.
**Tiers.** C13a/C13b/C13f opus (bounded, well-anchored, no ports). C13c controlled-opus (machinery
with negative controls). C13d/C13e fable (§4's rule for S-module work, and C13e carries the campaign's
product claim).

**The one number the orchestrator should grade this cut on:** C13a and C13b together are **179 KB of
the 354 KB row, unblocked today, needing no port, no oracle capability and no new machinery** — which
is what the private-field measurement bought. The blocker is real and it guards 25 KB.

---

## 8. Method notes and reproduction

- Region boundaries were fixed by reading the declarations at each edge, not by vocabulary scoring: a
  density scan over shell vocabulary was run first and rejected as too noisy to bound a region
  honestly (the safety chain interleaves with path-permission surface at both ends).
- A call-graph BFS from 183 Bash roots with an in-degree gate was run and **rejected**: at any gate
  loose enough to include `Ua` (23 callers) it bled to 1.5 MB. Caller counts from that graph are used
  (they are exact); the closure is not.
- All anchor counts are over the full 1,800-file `modules/*.js` set, counted as substrings, not over
  the pretty reprint.
- Cassette figures come from parsing all 267 `cassettes/*.jsonl` and matching Bash `tool_use` blocks
  in request bodies (where prior-turn tool calls are echoed back verbatim); the `interrupt`
  scenario's command is absent from that population by construction, and is counted separately.
- Scratch scripts: `/tmp/w10scout/{decls,classes,privs,rw,graph}.mjs`, `{importers,anchors}.py`.
