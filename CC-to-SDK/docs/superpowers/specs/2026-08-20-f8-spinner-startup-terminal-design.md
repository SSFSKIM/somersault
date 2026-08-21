# F8 — Spinner, startup, and terminal integration

**Wave F8 of the TUI-clone fidelity program** (parent spec:
[`2026-07-31-tui-clone-fidelity-design.md`](2026-07-31-tui-clone-fidelity-design.md) § F8). The last
scheduled wave. F0–F7 have all shipped; F9 is an explicit deferred tail, not a wave.

## Purpose

Three surfaces have never been built and two have been half-built since Wave C: the way the spinner
moves, the way the startup screen behaves when the terminal is too small for it, and everything ccx
says to the terminal emulator itself — desktop notifications, reduced motion, and live theme
detection. Together they are the two weakest sections of `docs/parity/tui-ux.md` (chrome ~71%,
polish ~67%) and the three remaining rows scored at zero.

The wave is worth running for one non-scorecard reason too: **ccx currently has no way to tell you it
needs you.** When a permission prompt opens in a background tab, nothing happens. That is the single
most-felt gap in this list, and it is the one item here that changes how the product is used rather
than how it looks.

## 0. Canon, and what F8 actually is now

**Canon for this wave is 2.1.236** — the installed binary (`claude --version` → `2.1.236`), bundle at
`~/claude-code-bundle/2.1.236/cli.pretty.js`. Every line citation below is against that file. F0–F7
were measured against 2.1.220; the F8-relevant code was diffed across both and is identical where it
matters (the glyph table, the cosine, the 30-row threshold), so this re-baseline carries no
reconciliation debt. Any 220→236 delta found during implementation is recorded in § Surprises, and
**no prior wave's scorecard rows are re-audited** — that is a different job.

### 0.1 The audit — F8's parent-spec text is stale

The parent spec listed seventeen cells. Wave C shipped several of them and one was already correct.
This table is the real scope, and it is the reason this wave is roughly ten cells rather than
seventeen.

| Cell | What it is | ccx state today | Disposition |
|---|---|---|---|
| `CH12` | Glyph index: raised cosine over six base glyphs, 2000 ms period | 12-frame ping-pong at 120 ms (`TurnSpinner.tsx:31`), a divergence Wave C held because its tests pinned it | **BUILD** (Unit 2) |
| `CH13` | `xterm-ghostty` glyph variant | absent | **BUILD** (Unit 2) |
| `CH14` | Delete `"Evaporating"`, the 187th verb | **already correct** — `spinner.ts` ships 186 verbs, none of them that | no work; recorded |
| `CH15` | Random verb is the LAST fallback | verb is the only source | **BUILD** (Unit 2) |
| `CH17` | The `(a · b · c · d)` tail with per-slot width budgets | **shipped Wave C** (`spinner.ts` `spinnerStatus`) | done |
| `CH18` | Thinking-word escalation ladder | **shipped Wave C** (`spinner.ts` `thinkingWord`) | done |
| `CH21` | Rows beneath the spinner: compaction, retry, `Next:` | compaction + retry shipped with precedence (`ChatApp.tsx:1585`); queued prompts render inset | done; no `Next:` label port (see D-F8-9) |
| `CH24` | The startup header's branch ladder | one unconditional box | **BUILD, partial** (Unit 3) |
| `CH25` | Tips as a completion checklist | three static strings | **BUILD** (Unit 3) |
| `CH26` | One-line degradation under `rows < 30` | absent — the banner is 13 rows at any height | **BUILD** (Unit 3) |
| `CH28` | OSC 0 terminal title | **shipped Wave C** (`terminalTitle.ts`), two recorded skips | done; recomposed on the new builders, byte-identical (Unit 1) |
| `CH30` | OSC 21337 tab status | absent | **DEFERRED** (§ 5) |
| `CH31` | Desktop notifications per emulator | absent | **BUILD** (Unit 4) |
| `CH34` | iTerm2 progress bar | absent | **DEFERRED**, writer slot reserved (§ 5) |
| `CH36` | `SIGCONT` resize resync | **shipped** (`suspend.ts`, Wave R) | done |
| `CH37` | `prefersReducedMotion` | absent | **BUILD** (Unit 4) |
| `TH3` | `auto` theme resolved live | `auto` is an exact alias of `dark` (`theme.ts:72`) | **BUILD**, environment tier only (Unit 4) |

### 0.2 Why P90 and P93 are retired without running

The parent spec's rule is absolute: *an item whose probe has not returned is unschedulable.* F8 names
two gates. Neither survives contact with what we now know, and both are retired here **by evidence,
not by omission**.

**P90** — *"do the SDK's task items carry `activeForm`?"* — gated `CH15`. It no longer gates anything,
because canon's own ladder falls through to the task's `subject` when `activeForm` is absent
(L508022, transcribed in § 1.2). `subject` is present on every `TaskCreate` we have ever observed
(`taskList.ts` header, probe 81 Q3). The behavior is therefore fully defined for the wire we have,
whichever field arrives.

**P93** — *"can we send OSC 11 / OSC 0 / OSC 21337 from inside a live Ink render without corrupting
the frame, and does the OSC 11 reply parse?"* — is two questions wearing one number, and only one of
them is retired.

The **read** half — parsing an OSC 11 reply back off the tty — is genuinely unanswered and is exactly
what this wave defers (§ 5). Nothing in F8's built scope depends on it.

The **write** half is *narrowed, not retired* (amended in v2). Wave C's shipped `OSC 0` writer proves
a single short write from beside a live Ink render is frame-safe. It does not prove the same of what
this wave adds: DCS-wrapped payloads, ST terminators, and kitty's **three consecutive** writes per
notification. Byte-level builder tests cannot answer a frame-integrity question at all — they never
render a frame. So the predicate survives as a live acceptance cell, **A10b**, rather than as a
standalone probe: same question, answered inside the wave that raises it.

## 1. What canon does

### 1.1 The spinner's motion

The animation clock is `Cg(intervalMs | null)` (L204972), a monotone clock quantized to its interval;
`null` arms no timer at all. The spinner's own call is (L507766, inside `iQm`):

```js
let [v, E] = Cg(t ? null : e === "requesting" ? 50 : 100)
```

where `t` is reduced motion and `e` is the stream mode. So: **100 ms normally, 50 ms while a request
is in flight, and no timer whatsoever under reduced motion.**

The glyph index is a raised cosine, not a triangle wave (L495099, L507743, `c8T = 2000` at L507933):

```js
function Ero(e, t) { return (1 - Math.cos(2 * Math.PI * e / t)) / 2 }   // L495099
function y8T(e)    { return Math.round(Ero(e, 2000) * (MSt().length - 1)) }   // L507743
```

`MSt()` (L495134) is memoized on `TERM` and is **six** glyphs, not the twelve of a ping-pong array:

```js
if (V.TERM === "xterm-ghostty") return ["·", "✢", "✳", "✶", "✻", "✻"];
return                                 ["·", "✢", "✳", "✶", "✻", "✽"];
```

The cosine produces the out-and-back walk a ping-pong array produces, but **eased** — it dwells at
both ends and moves fastest through the middle. Under reduced motion the index is pinned (L507779):

```js
let te = t ? 0 : y8T(E)
```

Reduced motion itself is `hx(settings.prefersReducedMotion)` **or** the screen-reader signal
(L507998, in the parent component `EQm`): `E = hx(S.prefersReducedMotion) || hl()`. `hx` (L495142) is
`e || (Qx() && flag("tengu_cedar_marsh", false))` — a settings boolean with a flag escape hatch, and
**no operating-system query anywhere**. It surfaces in the settings dialog as
`{ id: "reduceMotion", label: "Reduce motion", type: "boolean" }` (L383488).

### 1.2 The spinner's message

Four rungs before the random verb (L508022):

```js
let B = _ === void 0 || _ === Di();                                    // this is the MAIN agent
let W = B ? R?.find((t) => t.status !== "pending" && t.status !== "completed") : void 0;
let J = (a ?? W?.activeForm ?? W?.subject ?? (y || ee)) + "…";
```

`a` is an explicit override message, `W` is the first task that is neither pending nor completed,
`y` is the store's `defaultVerb`, `ee` is a lazily-drawn random verb. The `B` gate means a
**subagent's task list never retitles the main spinner**.

### 1.3 The startup header

`Gqe` (L500756) branches four ways, on **capability and geometry — not on whether you have run
before**:

1. `if (o7O || i7O < dKm)` — screen reader, or fewer than `dKm = 30` rows (L500971) — one line:
   `Welcome to Claude Code` in the accent, then a dim `v2.1.236`. No box, no tips.
2. `V.terminal === "Apple_Terminal"` — a simplified themed component.
3. light themes — another variant.
4. otherwise — the full logo.

The tips block is genuinely a checklist (`Enc`, L559386):

```js
let r = e.filter(({isEnabled}) => isEnabled)
         .sort((a, b) => Number(a.isComplete) - Number(b.isComplete))
         .map(({text, isComplete}) => ({ text: `${isComplete ? `${et.tick} ` : ""}${text}` }));
if (cwd === homedir()) r.push({ text: "Note: You have launched claude in your home directory…" });
return { title: "Tips for getting started", lines: r };
```

and its inventory is **two mutually-exclusive entries** (L384137), not a static list:

```js
[{ key: "workspace", text: "Ask Claude to create a new app or clone a repository",
   isComplete: false, isCompletable: true, isEnabled: t },
 { key: "claudemd",  text: "Run /init to create a CLAUDE.md file with instructions for Claude",
   isComplete: e,     isCompletable: true, isEnabled: !t }]
```

where `t` is "this is a new/empty workspace" and `e` is "a CLAUDE.md already exists".

### 1.4 The terminal-integration escapes

Every escape is assembled by two helpers (L188457):

```js
function tI(...e) { let t = cTp() === "kitty" ? Y0a : FK; return `${X0a}${e.join(";")}${t}` }
function Fq(e) {                                              // multiplexer passthrough
  if (eUr() === "tmux")   return `\x1BPtmux;${e.replaceAll("\x1B","\x1B\x1B")}\x1B\\`;
  if (eUr() === "screen") return `\x1BP${e.replaceAll("\x1B","\x1B\x1B")}\x1B\\`;
  return e;
}
```

`X0a` is `ESC ]`, `FK` is `BEL`, `Y0a` is `ESC \` (ST). So the terminator is **ST under kitty and BEL
everywhere else**, and every notification is wrapped in the tmux/screen DCS passthrough — which the
title deliberately is not (Wave C recorded that asymmetry as an open question; § 7 resolves it).

OSC codes (`wC`, L188790): `SET_TITLE_AND_ICON: 0`, `HYPERLINK: 8`, `ITERM2: 9`, `KITTY: 99`,
`GHOSTTY: 777`, `TAB_STATUS: 21337`.

The four writers live in one hook, `are()` (L202527–202566):

| Channel | Bytes |
|---|---|
| iTerm2 | `Fq(tI(9, sanitize(title ? "<title>: <message>" : "<message>")))` |
| kitty | three writes — `tI(99, "i=<id>:d=0:p=title", title)`, `tI(99, "i=<id>:p=body", body)`, `tI(99, "i=<id>:d=1:a=focus", "")` |
| ghostty | `Fq(tI(777, "notify", title, message))` |
| bell | `FK` — a bare `\x07` |

`sanitize` (`s$n`, L202519) replaces every byte below 0x20 and 0x7f–0x9f with a space.

Channel selection (`c9T`/`u9T`, L505876–505912) reads the setting `preferredNotifChannel`, whose
default is `"auto"` (L100411, `DEFAULT_GLOBAL_CONFIG`); the legal set (`Mie`, L45315) is
`["auto","iterm2","terminal_bell","iterm2_with_bell","kitty","ghostty","notifications_disabled"]`.
`auto` sniffs the terminal program: `Apple_Terminal` → bell, `iTerm.app` → iterm2, `kitty` → kitty,
`ghostty` → ghostty, anything else → **nothing at all** (`no_method_available`).

Copy: the default notification title is `"Claude Code"` (`sJm`, L505957); idle is
`"Claude is waiting for your input"` (L678604); a permission prompt is
`` `Claude needs your permission to use ${tool}` `` (L686789).

### 1.5 The `auto` theme's environment tier

`eTp()` (L188328) is a pure environment read:

```js
let e = V.COLORFGBG; if (!e) return;
let r = e.split(";").at(-1); if (r === undefined || r === "") return;
let n = Number(r); if (!Number.isInteger(n) || n < 0 || n > 15) return;
return n <= 6 || n === 8 ? "dark" : "light";
```

## 2. The cut (decided in the grill)

| # | Decision | Chosen |
|---|---|---|
| 1 | Canon baseline | 2.1.236, deltas recorded, no re-audit of prior waves |
| 2 | Terminal cluster scope | notifications + `auto` theme; tab status and progress bar deferred |
| 3 | Spinner cadence | adopt canon's cosine, replacing ccx's held ping-pong |
| 4 | Acceptance for emulator-terminal cells | byte assertions in tests + one owner-run manual pass |
| 5 | Notification default posture | ON via `auto`, **blocking events only** |
| 6 | Spinner verb ladder | port in full |
| 7 | Escape writers | one seam, and fix the signal teardown |
| 8 | Startup | keep ccx's box as the full form; add the degraded branches + the checklist |

## 3. Design

Four units. They are ordered by dependency: Unit 1 is the seam the others write through, Unit 2 owns
the reduced-motion consumer that Unit 4 introduces the setting for.

### 3.1 Unit 1 — the escape builders (`src/tui/terminalEscapes.ts`, new)

**Corrected in v2.** This unit was specified as an escape *writer* that would also become the
process's signal owner, on the strength of a follow-up note in `terminalTitle.ts`. Both halves were
wrong, and § 8 records why. What survives is smaller, and better for being smaller.

**What it is.** A **pure builder module** — no writes, no lifecycle, no signals. It owns the two
string constructions every escape in this wave needs, plus the two sanitizers.

```ts
export type OscTerminator = "bel" | "st";
/** canon's `tI` — the terminator is a PARAMETER, never sniffed inside the builder */
export function osc(terminator: OscTerminator, ...parts: (string | number)[]): string;
/** canon's `Fq` — tmux/screen DCS wrapping. NOT applied to a bare BEL. */
export function passthrough(seq: string, env?: NodeJS.ProcessEnv): string;
/** the terminator a NOTIFICATION uses on this terminal — kitty takes ST, everything else BEL */
export function notifyTerminator(env?: NodeJS.ProcessEnv): OscTerminator;
/** canon's `s$n` — C0, DEL and C1 each become a SPACE */
export function sanitizeNotificationText(s: string): string;
```

Every function is pure and total, which is what makes each escape in this wave assertable as exact
bytes with no terminal, no process and no clock. That is the whole backbone of the acceptance
strategy, and it is the reason this unit is worth having even after its other half evaporated.

**The terminator is a parameter, not a sniff.** An `osc()` that decided ST-versus-BEL internally could
not express the one exemption this codebase already relies on: the title keeps BEL on every terminal,
including kitty, which is `terminalTitle.ts`'s recorded Wave C skip. A builder that sniffs would force
an implementer either to change title bytes or to bypass the seam. So callers state their terminator,
`notifyTerminator()` supplies canon's rule for the callers that want it, and the title passes `"bel"`
unconditionally. Title bytes under kitty are pinned by their own test, independently of notification
bytes.

**Two sanitizers, because canon has two.** They are genuinely different functions and collapsing them
would silently change shipped behavior:

| | canon | what it does |
|---|---|---|
| notification | `s$n` (L202519) | replaces C0, DEL **and C1** with a **space** |
| title | inside `CVe` | strips CSI, **deletes** C0/DEL, leaves C1, trims |

`terminalTitle.ts`'s existing sanitizer is the second and stays exactly where it is, untouched. The
first is new and lives here. Every dynamic part of a notification — title and body both — goes through
it before assembly, never after.

**No writes, no signals.** Writing stays where it already is. `terminalTitle.ts` keeps its own `write`
dep and its own behavior; it merely composes its bytes with `osc("bel", 0, composed)` instead of a
local template. The notifier (§ 3.4) takes a `write` dep of its own in the same style.

**Nothing registers a signal handler.** `cli/main.ts:424` registers exactly one handler each for
`SIGHUP`, `SIGTERM` and `SIGINT` and drains `createChatTeardown` from it; `altScreen.ts:213` carries a
`signalsOwned` flag precisely so the guard does not double-register against that owner. Any teardown
this wave needs is registered as a dep of the **existing ordered teardown**, not as a new handler.
As it happens, this wave needs none — a notification is fire-and-forget, and the title's clear is
already `createChatTeardown`'s third step.

### 3.2 Unit 2 — spinner motion (`src/tui/spinner.ts`, `src/tui/TurnSpinner.tsx`)

**The glyph.** `SPINNER_FRAMES` (the 12-entry ping-pong) is replaced by the six-entry base table plus
a cosine index:

```ts
export const SPINNER_BASE_GHOSTTY = ["·", "✢", "✳", "✶", "✻", "✻"] as const;
export function spinnerBase(env?: NodeJS.ProcessEnv): readonly string[];   // TERM === "xterm-ghostty"
export const raisedCosine = (ms: number, periodMs: number): number => (1 - Math.cos(2 * Math.PI * ms / periodMs)) / 2;
export const SPINNER_PERIOD_MS = 2000;
export function glyphIndex(elapsedMs: number, frameCount: number): number;  // round(raisedCosine × (n-1))
export function glyphFor(elapsedMs: number, env?: NodeJS.ProcessEnv): string;
```

`glyphFrame(tick)` is replaced, not kept as an alias: it takes a tick, and the whole point of the
change is that the index is a function of **elapsed milliseconds**. A tick-shaped survivor would
invite a caller to keep the old model.

It has **two** callers, and both migrate: `TurnSpinner.tsx:77` and `CompactionRow.tsx:42`. The second
is not collateral — canon drives its compaction indicator from the same component and the same glyph
machinery (`isCompacting` / `compactingStartTime` are props of `iQm`), so moving `CompactionRow` onto
`glyphFor` makes it canon-shaped rather than merely consistent. It already holds `startedAt`, so the
elapsed value it needs is in hand.

**The clock.** `TurnSpinner`'s fixed `FRAME_MS = 120` becomes canon's three-way interval:

```ts
const intervalMs = reducedMotion ? null : mode === "requesting" ? 50 : 100;
```

`null` means **the interval is never armed** — not armed-and-ignored. Under reduced motion the
component does no periodic work at all, which is both canon's behavior and the honest reading of the
setting.

**The clock must be monotonic, and naively it is not.** `TurnSpinner` currently derives animation
time as `tick * FRAME_MS`. That identity holds only while the interval is constant, and this change
makes it variable, so the clock becomes elapsed-based (`now() − startedAt`) and the tick becomes a
bare repaint trigger carrying no arithmetic.

Elapsed-and-quantized is still not enough. Quantizing by the *current* interval **runs backward across
a cadence change**: at 150 ms elapsed, `floor(150/50)×50 = 150` while `floor(150/100)×100 = 100`. A
turn leaving `requesting` would step the clock back 50 ms, reversing the cosine and handing `easeChars`
a negative delta. Canon does not have this bug because `Cg` keeps a high-water ref (L204978):

```js
u.current = Math.max(u.current, Math.floor(t.now() / c) * c)
```

So the ported clock carries the same clamp: a ref holding the last value returned, and every read is
`max(previous, quantized(now))`. Three further properties the implementation owes, each of them a
thing that has already gone wrong once in this codebase or in canon:

- **The first-frame guard survives.** `TurnSpinner`'s existing non-positive `startedAt` guard exists
  because `useChat` sets busy and the start stamp in two commits, and one painted frame saw
  `now() − 0` render as `(29758130m 59s)` in a real binary. The rewrite keeps it.
- **The old interval handle is cleared when the interval changes.** A mode flip from `requesting` to
  responding must leave exactly one timer armed, and a flip to reduced motion exactly zero.
- **A mounted timer-lifecycle test covers the transitions**, asserting active timer counts of 1 → 1 →
  0 → 0 across 50 ms → 100 ms → `null` → unmount, and a continuous, non-decreasing clock across the
  first transition.

This interacts with one shipped piece and the interaction is deliberate: `easeChars` advances the
token estimate in 50 ms steps counted against the animation clock. Canon runs the identical
arrangement (the easing block at L507782 sits inside the same component, driven by the same `Cg`
clock), so the ported behavior is faithful, and the estimate simply advances in whole 50 ms steps per
100 ms repaint. Under reduced motion the easing stops with everything else, and the token figure
holds at whatever the last wire event set — which is correct, because there is no animation to ease.

**The message.** A pure resolver beside the existing verb machinery:

```ts
export interface SpinnerMessageInput {
  overrideMessage?: string;
  activeTask?: { activeForm?: string; subject?: string };
  defaultVerb?: string;
  randomVerb: string;
}
export function spinnerMessage(input: SpinnerMessageInput): string;   // canon L508022's `??` chain
```

The caller selects `activeTask` as the first task whose status is neither `pending` nor `completed`
**and whose origin is the main agent**.

That last clause needs a seam ccx does not have yet. Canon's `B` gate is not a filter over tasks — it
asks whether *this spinner* is the main agent's, and canon can ask that because its spinner store is
itself per-agent (`OCl(EDl.agentId)`, L507981). ccx has exactly one spinner, so transplanting the gate
verbatim makes it a constant `true`; meanwhile `TaskList.ingest` accepts **any** assistant frame and
never reads `parent_tool_use_id`, so a subagent's `TaskCreate` lands in the same store as the main
agent's. Ported literally, the result is a spinner a subagent's todo list can retitle — which canon
never does.

So the provenance is retained instead: `TaskItem` gains an origin recorded at ingest from the frame's
`parent_tool_use_id` (absent ⇒ main agent), and **only the spinner's active-task selection filters on
it**. The task panel keeps showing every task, because that is what it does today and nothing in this
wave argues it should change. The existing `rotateVerb` phase-transition
re-pick continues to govern the `randomVerb` rung only; a task label must not flicker on a phase
change.

**Reduced-motion consumers.** Four animations honor it: this spinner (interval `null`, glyph pinned
to index 0), `CompactionRow` and `RetryRow` (both `setInterval(…, 120)`), and `terminalTitle`'s 960 ms
braille alternation, which holds the idle `✳` prefix instead. It reaches them the way every other
cross-cutting preference does here — resolved once where settings are read, passed down as a prop or
dep, never re-read per component.

**It is not the setting alone.** Canon's value is `hx(prefersReducedMotion) || hl()` (§ 1.1) — the
persisted setting **or the screen-reader signal**. A design that threads only the setting leaves a
screen-reader user with a spinning glyph, an animating retry row and a braille-alternating tab title,
which is precisely the population the behavior exists for. One resolver produces the value:

```ts
export function reducedMotion(prefs: CcxPrefs, env?: NodeJS.ProcessEnv): boolean;
//   prefs.prefersReducedMotion === true || screenReaderEnabled(env)
```

and every one of the four consumers takes that value, not the raw setting.

### 3.3 Unit 3 — startup geometry (`src/tui/banner.ts`, `src/cli/main.ts`)

**The degraded form.** `welcomeBanner` gains a branch selected before any box is built:

```ts
export interface BannerInfo { /* …existing… */ rows?: number; screenReader?: boolean }
export const BANNER_MIN_ROWS = 30;      // canon's `dKm` (L500971)
```

When `screenReader` is true or `rows < 30`, the function returns **one** `RenderLine`: the accent
title `✻ Welcome to Claude Code` followed by a dim ` ccx v<version>`. No box, no cwd/model line, no
tips. Above the threshold, today's box renders exactly as it does now.

The banner stays a **seeded transcript notice** rather than becoming a live component (D-F8-6). The
branch is therefore chosen once, at seed time, from the rows known then. `main.ts` already reads
`process.stdout.columns` at that moment; it gains the matching `rows` read and the screen-reader
verdict.

That verdict needs a small extraction rather than a reach-in. `selectRenderer` computes it today as an
inline rung (`renderer.ts:187`), so the only way to consume it from outside would be to test
`choice.reason === "screen_reader"` — which is true only when that rung *wins*, and silently false
under a non-TTY, coupling the banner to rung ordering that has nothing to do with it. Instead
`renderer.ts` exports the predicate itself:

```ts
export function screenReaderEnabled(env: NodeJS.ProcessEnv): boolean;   // CLAUDE_AX_SCREEN_READER
```

and its own ladder calls it. One resolution, two consumers, per the rule Wave C applied to the model.
The signal stays env-only — that is `renderer.ts`'s recorded divergence 4, unchanged by this wave.

**The tips checklist.** The three static strings are replaced by canon's mechanism and canon's
inventory:

```ts
export interface Tip { key: string; text: string; isEnabled: boolean; isComplete: boolean }
export function startupTips(facts: { emptyWorkspace: boolean; hasClaudeMd: boolean; inHomeDir: boolean }): Tip[];
export function renderTips(tips: readonly Tip[], inHomeDir: boolean): RenderLine[];
```

`renderTips` filters to enabled, sorts incomplete-first, prefixes completed entries with `✔ `, and
appends the home-directory note last. Both facts are honestly evaluable at seed time from the
filesystem, which is the reason canon's two entries are portable and a longer invented list would not
be.

This **removes** ccx's three current tips. They are not canon's, the affordances they name are
reachable from `? for shortcuts` in the footer, and keeping them would mean shipping the checklist
mechanism with content that can never be checked off. Recorded as D-F8-7, and flagged as the one
content deletion in this wave.

### 3.4 Unit 4 — notifications, reduced motion, theme

**Desktop notifications** (`src/tui/desktopNotify.ts`, new) are a **separate path from the in-terminal
hint queue**, matching canon, where `lH` (L505865) and the notification store are unrelated systems.
Folding desktop delivery into `notifications.ts` would couple an ephemeral-hint queue with its own
preemption semantics to an emulator protocol that has none.

```ts
export type NotifChannel = "auto" | "iterm2" | "terminal_bell" | "iterm2_with_bell"
                         | "kitty" | "ghostty" | "notifications_disabled";
export type NotifEvent = "permission_prompt" | "idle_prompt" | "agent_needs_input" | "agent_completed";
export interface NotifSettings { preferredNotifChannel: NotifChannel; enabledEvents: readonly NotifEvent[] }
export function resolveChannel(configured: NotifChannel, env?: NodeJS.ProcessEnv): ResolvedChannel;
export function createDesktopNotifier(deps: {
  write(s: string): void; settings: () => NotifSettings; env?: NodeJS.ProcessEnv;
}): { notify(event: NotifEvent, message: string, title?: string): void };
```

`resolveChannel` transcribes `u9T`'s sniff with one recorded divergence (below). Composition is
**per channel**, not one rule for all four — the bell in particular is a bare byte:

| channel | bytes |
|---|---|
| `iterm2` | `passthrough(osc(notifyTerminator(env), 9, sanitized("<title>: <body>")))` |
| `kitty` | three writes, each `passthrough(osc("st", 99, "<key>", sanitized(part)))`, sharing one id |
| `ghostty` | `passthrough(osc(notifyTerminator(env), 777, "notify", sanitized(title), sanitized(body)))` |
| `terminal_bell` | `"\x07"` — **no OSC assembly and no DCS wrapping**; a bare BEL is not an escape sequence to pass through |
| `iterm2_with_bell` | the `iterm2` bytes, then the bare BEL — the BEL half stays unwrapped |

Every dynamic part goes through `sanitizeNotificationText` before assembly (§ 3.1), never the title
sanitizer, which behaves differently on purpose.

**Inside a multiplexer, `TERM_PROGRAM` is a lie, and `auto` must not believe it.** This is the
difference between a feature and a dead feature: tmux ≥ 3.2 stamps `TERM_PROGRAM=tmux` over whatever
the outer terminal set — `renderer.ts` already records the fact, in the note explaining why its own
tmux heuristic is unreachable on modern tmux. `resolveTerminalName` reads `TERM_PROGRAM` before its
`TMUX` fallback, so inside tmux it answers `"tmux"`, `auto` resolves to `none`, and **not one
notification is ever delivered in the environment this project is actually used and tested in**. The
DCS passthrough would be wrapping bytes nobody ever emits.

So notification channel resolution does **not** reuse `resolveTerminalName`. It gets its own resolver
whose first question is whether a multiplexer is present:

- **Outside a multiplexer**, `TERM_PROGRAM` / `TERM` are trustworthy and the sniff is canon's.
- **Inside one**, they are not, and the resolver falls back to the markers a terminal exports into the
  environment its shells inherit — the same trick every tmux-aware tool uses. **Which markers those
  are is an empirical question about three specific terminals, and it is answered by measurement, not
  by assertion**: the implementing task begins by printing the environment inside a real tmux pane
  under each target terminal and recording what survives. The resolver is then written against what
  was observed, and the observation goes in § 8.
- **Whatever the sniff concludes, `preferredNotifChannel` overrides it.** That setting is the
  guaranteed escape hatch, and a user whose terminal exports nothing recognizable sets it once.

A stale marker is the known limit of this approach — a tmux server started from terminal A and later
attached from terminal B carries A's environment — and it is accepted rather than solved: the wrong
emulator's escape is ignored by the right one, and the setting overrides.

**Apple Terminal is a recorded divergence.** Canon's resolver is asynchronous there —
`case "Apple_Terminal": return await p9T() ? "terminal_bell" : "no_method_available"` (L505907) —
where `p9T` inspects the active Terminal profile. ccx resolves synchronously and always chooses
`terminal_bell` for Apple Terminal. The cost is bounded and one-directional: a user whose profile has
the bell disabled gets a byte their terminal ignores, rather than a missing notification (D-F8-11).

**Policy.** Default channel `auto`, per canon. Default **event set narrowed to the blocking pair** —
`permission_prompt` and `idle_prompt` fire; `agent_needs_input` and `agent_completed` ship complete
but default off, settable. This is a deliberate divergence from canon's all-events default (D-F8-5).

**Copy** names ccx, consistent with the title writer's existing identity divergence: `ccx needs your
permission to use <tool>` and `ccx is waiting for your input`, with the default title `ccx`
(D-F8-8).

**Trigger sites.** `permission_prompt` fires where the consult dialog is raised. `idle_prompt` fires
where the turn settles — `useChat.ts:1557`, the same `setBusy(false)` the terminal title already
drives off — but **only when the queue is empty**. That line ends `setBusy(false); … drainNext()`, so
a session with queued input goes busy again immediately; notifying there would fire between queued
turns, when ccx is not waiting on anyone. The condition is "the turn ended and nothing drained", not
"the turn ended".

Both are existing seams in `useChat.ts`; the notifier is injected as a dep, so both are unit-testable
without a terminal.

**Reduced motion** adds `prefersReducedMotion` to the settings file with a `Reduce motion` boolean row
in `SettingsDialog`, positioned as canon positions it, and threads to the four consumers named in
§ 3.2. Settings-only: canon performs no operating-system query, so neither do we.

**The `auto` theme** stops aliasing dark. `theme.ts` gains:

```ts
export function detectTerminalBackground(env?: NodeJS.ProcessEnv): "dark" | "light" | undefined;  // canon's eTp
```

and `auto` resolves through it, falling back to dark when the variable is absent or malformed —
preserving today's behavior exactly in the unset case, which is the common one. `THEMES.auto` stops
being a static alias and becomes a resolution at read time.

## 4. Acceptance (observable behavior)

Keyed live cells run under the tmux driver with an isolated HOME under `/tmp` plus `CCX_FLEET_ROOT`,
per standing project practice.

- **A1 (glyph curve).** Over one 2000 ms window the spinner walks `· ✢ ✳ ✶ ✻ ✽` and back, indexed by
  `round(((1 − cos(2π·t/2000))/2) × 5)` — visibly dwelling at both ends rather than stepping evenly.
  Under `TERM=xterm-ghostty` the sixth glyph is `✻`, not `✽`.
- **A2 (cadence).** The repaint interval is 100 ms while responding and 50 ms while a request is in
  flight. Neither `TurnSpinner` nor `CompactionRow` retains a fixed 120 ms timer, and neither derives
  animation time by multiplying a tick count by an interval.
- **A3a (reduced motion, by setting).** With `prefersReducedMotion: true`: the glyph is `·` and never
  changes; **no spinner interval is armed at all**; the compaction bar and retry row stop animating;
  the terminal title holds `✳` without alternating. The setting appears as `Reduce motion` in the
  settings dialog and survives a relaunch.
- **A3b (reduced motion, by screen reader).** With `prefersReducedMotion` unset and
  `CLAUDE_AX_SCREEN_READER=1`, **all four** of those animations are equally still. A build that
  freezes only on the setting fails this cell.
- **A3c (timer lifecycle).** Across `requesting` → responding → reduced-motion → unmount, the count of
  armed spinner intervals is 1, 1, 0, 0, and the animation clock never decreases at the 50 ms → 100 ms
  transition.
- **A4 (message ladder).** An in-progress task carrying `activeForm: "Running tests"` makes the
  spinner read `Running tests…`. A task carrying only `subject: "Fix the parser"` makes it read
  `Fix the parser…`. With no task in progress it reads a random verb.
- **A4b (provenance).** A `TaskCreate` arriving on a frame that carries a `parent_tool_use_id` — a
  subagent's task — leaves the main spinner's message **unchanged**, while still appearing in the task
  panel. Driven through the real path: `TaskList` → `useChat` → `TurnSpinner`, on nested frames.
- **A5 (startup degradation).** At 24 rows the banner is exactly one line — `✻ Welcome to Claude
  Code` plus a dim ` ccx v<version>` — with no box, no cwd/model line and no tips. At 30 rows and
  above the existing box renders unchanged. With the screen-reader ladder firing, the one-line form
  renders at any height. The leading `✻` is **not** canon's, which opens on the bare words; it is
  carried from ccx's own box title so the two forms of the same banner agree (D-F8-12).
  **The line is two spans, not one**: the title accent-coloured and the ` ccx v<version>` suffix dim,
  as canon's degraded row is (L500766). `RenderLine.segments` already expresses exactly this, so a
  uniformly-accent line is a defect the test must catch — assert the segment styles, not just the text.
- **A6 (tips checklist).** In a non-empty directory containing a `CLAUDE.md`, the tips block reads
  `✔ Run /init to create a CLAUDE.md file with instructions for Claude`. Without one, the same line
  renders unchecked. In an empty directory, the workspace tip renders instead and never carries a
  check. Launched from `$HOME`, the home-directory note is the last line.
- **A7 (notification bytes — the full matrix).** Every channel is asserted **positively and exactly**
  — full-string equality, never `startsWith` or `contains` — across **three** environments: bare,
  `$TMUX`, and `$STY`. A `contains` assertion would pass on an emitter that dropped its passthrough or
  emitted extra bytes, which is the failure this matrix exists to catch. Kitty's three writes are each
  asserted whole, and the bell halves are asserted unwrapped in both multiplexers:

  | channel | bare | under `$TMUX` / `$STY` |
  |---|---|---|
  | `iterm2` | `ESC ] 9 ; ccx: ccx needs your permission to use Bash BEL` | the same, DCS-wrapped, inner ESCs doubled |
  | `kitty` | three `OSC 99` writes, **ST**-terminated, one shared id | the same three, each DCS-wrapped |
  | `ghostty` | `ESC ] 777 ; notify ; ccx ; <body> BEL` | the same, DCS-wrapped |
  | `terminal_bell` | a single `\x07` | a single `\x07` — **unwrapped**, identical to bare |
  | `iterm2_with_bell` | iterm2 bytes then `\x07` | wrapped iterm2 bytes then a bare `\x07` |
  | `auto`, unknown terminal | nothing at all | nothing at all |
- **A8 (policy).** By default only `permission_prompt` and `idle_prompt` deliver; a subagent
  completing writes zero bytes. Enabling `agent_completed` makes the same event deliver — the opt-in
  path is exercised, not merely declared. `preferredNotifChannel: "notifications_disabled"` silences
  every event. A turn that ends with queued input waiting delivers **no** idle notification; the same
  turn with an empty queue delivers one.
- **A8b (sanitization, both dialects).** A notification body containing `ESC[31m`, `BEL`, `DEL` and a
  C1 byte reaches the terminal with **each of those replaced by a space** — canon's notification rule.
  The same string passed as a terminal *title* keeps the title's existing behavior (CSI stripped, C0
  and DEL deleted, C1 left, trimmed). One helper satisfying both would fail this cell, which is the
  point of it.
- **A9 (auto theme).** `COLORFGBG` unset → dark. `15;0` → dark. `0;15` → light. `15;8` → dark.
  `0;banana` → dark (malformed falls back, never throws).
- **A10 (signal exit, a regression guard).** `SIGTERM` to a running ccx leaves the pty with the title
  cleared — `ESC ] 0 ; BEL` on the wire — and exits cleanly. **Not 143**, which v2 of this document
  asserted and which was never ccx's contract: `cli/main.ts`'s handler ends with
  `host.stop("done").finally(() => process.exit(0))`, a deliberate graceful stop. Inventing a
  signal-exit-code requirement inside a spinner wave would change a CLI contract nothing here needs
  changed. This asserts **existing** behavior
  (`cli/main.ts`'s single handler draining `createChatTeardown`, whose third step is `clearTitle`)
  and exists so this wave's changes to title composition cannot break it.

  It deliberately makes **no claim about raw mode**. Restoring termios emits no bytes at all, so a
  byte-level cell could pass while leaving the user's shell in raw mode; that property is owned by
  `altScreen.ts` and was proved in the fullscreen wave, and this wave neither touches it nor re-asserts
  it from the wrong instrument.
- **A10b (frame integrity under out-of-band writes).** In a live pty, with the fullscreen renderer up
  and a non-empty transcript, firing ten notifications in succession — including the kitty three-write
  form and the DCS-wrapped form — leaves the visible frame's content and geometry unchanged. This is
  the narrowed survivor of P93's write half: Wave C proved a single `OSC 0` write is frame-safe, and
  this wave adds DCS passthrough, ST termination and consecutive writes, none of which that evidence
  covered (§ 0.2, amended).
- **A11 (manual pass, owner-verified).** In a real iTerm2 or Ghostty window: a permission prompt
  raises a system notification; the tab title reads `✳ …` at idle and alternates while busy; killing
  ccx with `SIGTERM` restores the tab title. Recorded in § Outcomes as owner-verified, with the date
  and the terminal used.

## 5. Deferred, with reasons

- **`CH30` tab status (OSC 21337).** Single-emulator surface with no fidelity payoff for the terminals
  this project is used in. Canon's clear form is `tI(21337, "indicator=;status=;…")` (L188791); the
  seam can express it in one line whenever it is wanted.
- **`CH34` iTerm2 progress bar.** Rides the same `OSC 9` code as iTerm notifications
  (`Onr = {NOTIFY:0, BADGE:2, PROGRESS:4}`, `Dnr = {CLEAR:0, SET:1, ERROR:2, INDETERMINATE:3}`,
  L188791), so Unit 1 leaves the writer slot reserved and this becomes a small follow-up rather than
  a new investigation.
- **`TH3` tier 2, the OSC 11 query.** The only surface in the wave requiring a **reply read back off
  the tty**, and the genuine remainder of P93. Deferred whole; the environment tier ships.

All three enter `docs/parity/tui-ux.md`'s tail list at close, with this section as their evidence.

## 6. Testing strategy

- **Unit** (`test/unit`): the pure builders — `osc`/`passthrough` byte forms, `raisedCosine`/
  `glyphIndex` across a full period and at the boundaries, `spinnerMessage`'s five rungs,
  `resolveChannel`'s sniff table, `detectTerminalBackground`'s parse ladder, `startupTips`/
  `renderTips` ordering and prefixes, sanitization. Every escape assertion is on exact bytes.
- **TUI** (`test/tui`): the rendering cells — banner branch selection by rows and screen reader, the
  four reduced-motion consumers going still, spinner glyph sequence over a driven clock.
- **Live/pty**: A1, A2, A3a/A3b, A4b, A5, A6, A9, A10 and A10b under the tmux driver. A7's wrapped
  column is genuinely observable there — notifications are DCS-wrapped and pass through — so only the
  emulator's *reaction* is out of reach, not the bytes.
- **Manual**: A11 only — the two behaviors that terminate inside an emulator we cannot drive.
- **Gates at close**: `npm run typecheck`, `npm run test:unit`, `npm run test:tui`,
  `npm run test:resize-matrix`. Never bare `npm test`.

**Landing stages.** The four units are a decomposition of the design, **not a unit of landing**. The
dependency graph is shallow — only reduced motion crosses units (Unit 4 owns the setting, Unit 2 owns
a consumer) — so the plan stages these as independently reviewable tasks in this order, and **no unit
lands atomically**:

1. the escape builders and their sanitizers (pure, no callers changed);
2. `terminalTitle` recomposed onto them, byte-identical, its tests unchanged;
3. the spinner's glyph, clock and monotonic ref;
4. task provenance in `TaskList`, then the message ladder that consumes it;
5. the reduced-motion resolver, its settings row, and its four consumers;
6. the startup degraded branch, then the tips checklist;
7. the `auto` theme's environment tier;
8. the notifier and its trigger sites.

Two files in the blast radius are already large — `useChat.ts` at 3,014 lines and `ChatApp.tsx` at
1,748 — so additions there are threading only: a dep passed, a call made. Anything with logic in it
belongs in one of the new modules, which is where every acceptance cell in § 4 points anyway.

**Close-out is a deliverable, not an afterthought.** The wave ends by rescoring
`docs/parity/tui-ux.md` (§3 and §6 are the sections this moves; the three deferred surfaces in § 5
enter its tail list with their evidence), noting in `docs/parity/coverage.md` that **no domain score
moves** — this wave consumes no SDK surface at all, exactly as the fullscreen and tool-stream waves
did — and writing § 9 of this document plus the corresponding memory file. A wave that ships code and
leaves the instrument stale is the failure F0 existed to correct.

**One boundary, standing:** `src/appserver/` is owned by a concurrent session for the duration of
this wave. Nothing in F8 touches it, and nothing in F8 needs to.

## 7. Decision Log

- **D-F8-1 — canon is 2.1.236.** *Rejected: hold 2.1.220* (the program's baseline) — the last wave
  should clone the binary the owner runs, and the F8-relevant code is identical across both, so the
  re-baseline costs nothing. *Rejected: re-baseline the whole scorecard* — a second wave's worth of
  audit bolted onto this one.
- **D-F8-2 — notifications and the environment theme tier; tab status, progress bar and OSC 11
  deferred.** *Rejected: the whole cluster* — spends most of the wave on one emulator's features.
  *Rejected: theme only* — leaves three rows at zero and skips the one item that changes how the
  product is used.
- **D-F8-3 — adopt canon's cosine, replacing ccx's 120 ms ping-pong.** *Rejected: keep ours* — the
  divergence was held for test convenience, not judgment, and freezing under reduced motion is
  defined against canon's index. *Rejected: cosine on our 120 ms tick* — leaves the visible pacing
  wrong while paying the whole cost of the change.
- **D-F8-4 — one seam of pure escape builders; signals stay where they are.** *(Amended v2.)* The
  grill authorized "one seam, and fix the signal teardown". The seam stands; the signal half is
  **withdrawn as already done** — `cli/main.ts:424` owns all three signals and drains
  `createChatTeardown`, whose third step is `clearTitle`, so the bug `terminalTitle.ts` recorded is
  fixed and its note is stale (§ 8). Adding a handler would have double-registered against an owner
  built to be singular and would have dropped `SIGHUP`. *Rejected: add writers alongside the existing
  title writer* — the builders are worth having on their own, because purity is what makes every byte
  in § 4 assertable. The terminator is a parameter rather than a sniff, so the title's BEL-under-kitty
  exemption is expressible instead of merely asserted.
- **D-F8-5 — notifications default on, blocking events only.** *Rejected: canon exactly* — a
  notification on subagent completion is louder than any chrome this project has already demoted.
  *Rejected: off by default* — a feature nobody enables is close to a feature nobody has. The
  narrowing is in the event set, not the mechanism; every event ships and is settable.
- **D-F8-6 — the banner stays a seeded transcript notice.** *Rejected: make it a live component* like
  canon's — ccx's banner scrolls away into history, so re-branching it after a resize would change
  nothing visible while adding a live subscription to rows.
- **D-F8-7 — ccx's three static tips are replaced by canon's two-entry checklist.** *Rejected: keep
  ours and add the mechanism* — it would ship a completion checklist whose entries can never be
  completed. The affordances the old tips named (`/help`, `@`, ⇧Tab) remain reachable from the
  footer's shortcuts overlay. This is the wave's one content deletion.
- **D-F8-8 — notification copy names ccx.** *Rejected: canon's strings verbatim* — the same
  impersonation rule that made the terminal title say `ccx` rather than `Claude Code` (Wave C, D-C9).
- **D-F8-9 — no `Next:` label port.** `CH21`'s other two rows shipped in Wave C with correct
  precedence, and queued prompts already render inset beneath the spinner. Canon's specific `Next:`
  labelling is a copy difference on a built surface, not a missing surface; recorded rather than
  built, so it does not masquerade as new capability.
- **D-F8-11 — Apple Terminal always gets the bell.** Canon gates it on an async profile probe
  (`p9T`) and otherwise sends nothing. *Rejected: port the probe* — it reads the terminal's own
  profile state, which is not portably reachable, and the wave has no other async resolution.
  *Rejected: send nothing, matching the negative arm* — that trades a harmless ignored byte for a
  silently missing notification. Recorded, one-directional, cheap.
- **D-F8-13 — notification channel resolution is multiplexer-aware and measurement-backed.**
  *Rejected: reuse `resolveTerminalName`* — it answers `"tmux"` inside tmux, which resolves `auto` to
  `none` and ships the feature dead where it is used. *Rejected: guess the surviving marker names from
  memory* — three external products' environment contracts are exactly the class of fact this project
  probes rather than asserts. *Rejected: drop `auto` and require an explicit setting* — a default that
  works nowhere is not a default. The measurement is one command inside a real pane and it happens
  before the resolver is written.
- **D-F8-12 — the degraded startup line keeps ccx's `✻`.** Canon's opens on the bare words. *Rejected:
  drop the glyph for byte fidelity* — the full-size form is ccx's own box whose title line carries the
  glyph, and a degraded form that drops it would make one banner disagree with itself. Recorded rather
  than smuggled into an exact-byte acceptance cell.
- **D-F8-10 — P90 retired by evidence; P93's write half narrowed to a live cell.** Reasoning in § 0.2. The parent spec's
  unschedulable rule is satisfied by *answering* a question, and an answer may come from canon, from
  shipped evidence, or from an acceptance cell — but never from silence. P93's write half turned out
  to be answered only in part, so it survives as cell A10b rather than being waved through.

## 8. Surprises & Discoveries

Seeded from the grounding pass and the v1 adversarial review; extended during implementation.

### From the adversarial review of v1 (2026-08-20)

Eleven findings, ten adopted whole and one in part; **none rebutted**. The four that changed the
design rather than the prose:

- **The signal bug this wave was chartered to fix no longer exists.** `terminalTitle.ts` carries a
  follow-up note saying a `SIGTERM` skips teardown and leaves the title set. That was true when Wave C
  wrote it. The fullscreen wave then built exactly the ordered signal teardown it asked for:
  `cli/main.ts:424` registers one handler each for `SIGHUP`/`SIGTERM`/`SIGINT` and drains
  `createChatTeardown`, whose third step is `clearTitle()`. v1 proposed installing a second handler —
  double-registering against an owner explicitly built to be singular (`altScreen.ts`'s `signalsOwned`
  flag exists for exactly that reason) and silently dropping `SIGHUP`. **A stale follow-up note reads
  as a live instruction until someone opens the file it points at**, and this one survived a grill, a
  design presentation and an owner decision before a reviewer did.
- **Canon has two sanitizers and they disagree on purpose.** The notification path replaces C0, DEL
  *and C1* with spaces (`s$n`); the title path strips CSI, deletes C0/DEL, leaves C1, and trims. v1
  proposed hoisting "the" sanitizer into the seam for both callers, which would have silently changed
  shipped title behavior. Two functions now, and a cell (A8b) that fails if anyone re-merges them.
- **An elapsed clock quantized by a varying interval runs backward.** At 150 ms elapsed, requantizing
  from 50 ms to 100 ms steps the clock from 150 to 100 — reversing the cosine and handing the token
  easing a negative delta. Canon avoids it with a high-water `Math.max` inside `Cg` that v1 read past.
  The lesson generalizes beyond this wave: **turning a constant into a variable breaks every invariant
  that was holding only because it was constant**, and monotonicity is the one that fails silently.
- **Canon's `B` gate is not the filter it resembles.** It asks "is this the main agent's spinner?",
  which canon can ask because its spinner store is per-agent. ccx has one spinner and one *global*
  task store that never records `parent_tool_use_id`, so the same gate transplanted becomes a constant
  `true`, and a subagent's todo list can retitle the main spinner. Porting a guard's code without its
  surrounding structure ports nothing at all.

### From the adversarial review of the plan (2026-08-20)

Eleven more findings, again none rebutted. Two changed the design rather than the plan:

- **`TERM_PROGRAM` is `tmux` inside tmux, and this codebase already knew.** `renderer.ts` carries the
  fact in a note explaining why its own tmux heuristic is unreachable on tmux ≥ 3.2. The notification
  design reused `resolveTerminalName` anyway, which would have resolved `auto` to `none` in every tmux
  pane — shipping the wave's one genuinely new *capability* dead in the environment the whole
  acceptance rig runs in. **A fact recorded in one module does not propagate to the next design by
  itself**; it has to be looked up, and the place to look was a file this wave was already editing.
- **An acceptance cell asserted a contract the product does not have.** A10 required exit 143 on
  `SIGTERM`. ccx's handler ends `host.stop("done").finally(() => process.exit(0))` — a deliberate
  graceful stop — so the cell was unreachable, and satisfying it would have meant changing a CLI exit
  contract from inside a spinner wave. Writing an acceptance cell from what *ought* to be true rather
  than from what is, is how a wave acquires scope nobody chose.

### From the grounding pass

- **F8's parent-spec text was stale in three places, and the audit is why.** Wave C shipped `CH17`
  and `CH18` outright; `CH14` was already correct; `CH36` shipped in Wave R. A wave planned from the
  parent spec's list alone would have re-specified four cells that were already done.
- **The startup header does not branch on first-run.** The parent spec described "the unboxed
  returning-user header versus the boxed first-run welcome". Canon's `Gqe` (L500756) branches on
  screen reader, row count, terminal program and theme — capability and geometry. There is no
  first-run rung anywhere in it. The scorecard's own row inherited the wrong description.
- **The 100 ms clock, misread once during design.** The spinner's repaint interval is
  `Cg(reducedMotion ? null : mode === "requesting" ? 50 : 100)` (L507766). An earlier reading took
  200 ms from `U = e === "requesting" ? 50 : 200` at L507779 — but that constant steps the **shimmer
  position**, a different clock in the same expression. Two clocks in one line, and only reading the
  hook call settles which is which.
- **Reduced motion passes `null`, not `true`.** Canon does not freeze an armed animation; it never
  arms the timer. The distinction is invisible in a screenshot and material in a process that is
  supposed to be quiet.
- **Notifications are DCS-wrapped; the title is not.** Every notification goes through `Fq`
  (L188461), so it survives tmux and screen; the title deliberately does not. Wave C recorded the
  title's unwrapped form as a decision with an open question about multiplexers — this resolves it:
  canon makes the same asymmetry on purpose.
- **The tips are two entries, not a list.** Canon's inventory (L384137) is one pair of mutually
  exclusive tips keyed on whether the workspace is new — far smaller than the static list ccx grew,
  and the reason the checklist mechanism is honest rather than decorative.
- **P90's answer was already in our own repo.** `taskList.ts`'s header records that a live run showed
  `TaskCreate {subject, description}` and `TaskUpdate {taskId, status}` and no `activeForm` at all.
  Canon's fallback to `subject` is what makes the rung fire anyway — the probe would have returned a
  negative that changed nothing.

**S-F8-x — Task ids cannot collide across agents, and canon works hard to guarantee it.** Task 4's
implementer flagged a hazard it could not settle: ccx keys one global map on the `Task #N` id parsed out of
the tool result, so if a subagent's numbering restarted at 1 a nested create would silently replace the main
agent's row. Canon settles it. `OBp` (L232405) allocates `String(count + 1)` scoped to ONE task list id from
`MG()` (L232296), under a file lock, with an `ifAbsent` write precondition and a retry loop that takes the
next free id when the listing under-reports. Subagents write into that same list. So ids are unique per list
by construction, not by convention — the collision is unreachable on the wire, and Task 5's selector may rely
on an id resolving to exactly one row. Residual, recorded not chased: `MG()` can be redirected per process by
`CLAUDE_CODE_TASK_LIST_ID`, so two lists in one session would break the guarantee; nothing in ccx does that.

**S-F8-y — canon's create-result id is `\S+`, ours is `\d+`.** Canon parses with `/^Task #(\S+) created
successfully/` (L235685) while ccx uses `/Task #(\d+) created/`. Since the allocator emits a stringified
integer, the two agree on every id that actually occurs, and ccx additionally sorts by `Number(id)`. Recorded
as a latent fidelity gap rather than a defect: if canon ever emits a non-numeric id, ccx drops the task
entirely and the sort would go to `NaN`.

**S-F8-z — a DELETED task titles the spinner, and F8 is what made it visible.** `taskList.ts` casts the
wire's `status` straight into our three-value `TaskStatus` union without validating it. Canon's TaskUpdate
schema (`sPS`, L235685) admits a fourth value, `"deleted"`, and canon handles it at the INGEST boundary:
`safeParse` first, `return !1` on failure, then `if (i === "deleted") return e.tasks.delete(o)` (L235620-5).
Its tool description does not merely permit the value — it instructs the model to send it ("Use `deleted` to
permanently remove a task", L340107) and ships the worked example `{"taskId":"1","status":"deleted"}`
(L340127). So this is reachable on every real run, not a hypothetical wire shape.

Before F8 the consequence in ccx was a stale panel row with an undefined glyph. Task 5's ladder made it
user-visible and worse: `activeSpinnerTask` takes the FIRST non-pending, non-completed task and a deleted
task keeps its position in the id sort, so the spinner is titled by a task the model explicitly removed, for
the rest of the turn. Task 5's implementer was right that the fix belongs at ingest rather than in the
selector — narrowing the selector to `=== "in_progress"` would hide one symptom while the panel, the row
counts and the ordering all keep reading the same unmodelled value — and right to leave canon's double
negative in the selector as the faithful transplant. **Decided against the original deferral and folded into
Task 5's fix wave:** a wave that makes a latent defect user-visible owns it. Two behaviors transplanted —
`"deleted"` removes the task, and a status in neither union discards the whole update including any
`subject`/`activeForm` carried with it, which is what canon's `safeParse` rejection does.

**S-F8-w — `chatMain.tsx`'s option assembly is structurally untestable, and F8 keeps adding to it.**
Task 6's reviewer established that `runChatClient` is never executed anywhere in the suite — `test/unit/
cli-main.test.ts` carries it only as a stub that throws if called. So every line of that function's
`hookOpts` assembly is unpinned, including the pre-existing `initialShowTurnDuration` and
`initialPromptSuggestionEnabled` seeds beside F8's new `initialPrefersReducedMotion` and the terminal
title's startup `reducedMotion`. Confirmed by sabotage: cutting the title's link contributed ZERO failures
to a three-link cut that otherwise killed four tests. Both halves either side of the seam are independently
tested — the title's own behavior, and the hook honoring a seeded value — so what is unpinned is exactly one
argument per option. This is a wave-level gap, not a task-level one: closing it means building a `chatMain`
harness, which no F8 task is scoped to do. Recorded so the next wave that adds an option here knows the
seam it is adding to has no net under it. Task 12 (the notifier wiring) lands in the same function — its
review should read this first.

**S-F8-v — terminal geometry is `undefined` in every test worker, which makes a bare global read inert
rather than merely unpinned.** Task 7's reviewer measured it: under `script -q /dev/null npx vitest run` —
a genuine pty, not a pipe — a worker reports `isTTY=undefined rows=undefined cols=undefined`, because the
default forks pool gives the worker a pipe regardless of the launching terminal. The consequence is sharper
than "this line has no test": `rows: process.stdout.rows` at the launch site always evaluated to `undefined`
under test, `undefined` is exactly the unknown case that renders the FULL banner, and passing it versus not
passing it were indistinguishable to any test this harness could contain. Deleting it left 118/118 green.
Fixed by seaming it through `MainDeps`, the idiom `useChat.ts:239` already uses. Recorded because the same
trap waits for anything that reads terminal geometry at a call site — and because the seam must keep
returning `number | undefined` rather than defaulting, or every unknown silently becomes a measurement.

**S-F8-u — the startup checklist reads the filesystem, and the plan's version would have killed the
launch.** Task 8's facts (`emptyWorkspace`, `hasClaudeMd`) come from real `readdirSync`/`existsSync` calls
at the launch site. The plan specified them unguarded. `cwd` is NOT guaranteed to exist on disk there —
`args-bypass.test.ts`'s consent-gate test fakes `ensureWorktree` and `makeHost` so the directory is never
created — and the throw propagates out of banner construction and takes down the whole program. A crash at
startup, caused by a decorative tip. Guarded with a helper returning safe defaults on any read failure,
matching the rule this file already applies to the account-info billing label: chrome must never cost the
user their launch. The fallback is `emptyWorkspace: false`, which shows the `/init` tip rather than the
empty-workspace one — the right way round, since a directory we could not read is not evidence of emptiness.

**S-F8-t — the tips checklist needs a visibility gate, or its own success becomes a permanent wart.**
Task 8's reviewer found that canon's tip inventory carries a third field the plan omitted, `isCompletable`,
and that the field exists to drive a gate the plan never mentioned. Verified at L384140 / L384155-6:
`show = !inventory.filter(t => t.isCompletable && t.isEnabled).every(t => t.isComplete)`. Without it, every
repository that already has a `CLAUDE.md` — most of them, this one included — prints `✔ Run /init to create
a CLAUDE.md file` on every launch forever. That is the mechanism's natural terminal state, and it is worse
than the three static tips F8 deleted. Folded into Task 8's fix wave as a pure predicate: the whole block,
header included, hides once every applicable entry is complete. Same reasoning as S-F8-z's reversal — a wave
that introduces a surface owns its end state.

**DEFERRED, deliberately:** canon's other two hide rungs are a persisted `hasCompletedProjectOnboarding`
flag and `projectOnboardingSeenCount >= 4` (stop showing tips after four launches even when incomplete).
Both need new persisted preference state, which F8 is not adding. Consequence of deferring: a user sitting
in a genuinely empty directory sees the workspace tip on every launch, since that entry can never complete.
Canon's counter is what stops that, and ccx will not until the counter lands.

**S-F8-s — a tmux pane inherits the SERVER's environment, which breaks emulator sniffing far more often
than the design assumed.** Measured on tmux 3.7b before Task 10 was dispatched. Two findings.

The premise the design was built on is confirmed: tmux OVERWRITES both `TERM` (to `tmux-256color`) and
`TERM_PROGRAM` (to `tmux`) inside a pane, so neither identifies the emulator and reusing
`resolveTerminalName` would have resolved `auto` to `none` in every pane — the wave's one new capability
shipping dead in the environment the acceptance rig runs in.

The finding that was NOT anticipated: `LC_TERMINAL`, `KITTY_WINDOW_ID` and `GHOSTTY_RESOURCES_DIR` were
delivered into a pane when the tmux server was FRESH (verified on a private `-L` socket) and were ABSENT
ENTIRELY when a server was already running — even though all three were set in the shell that ran
`new-session`. A pane inherits the server's environment, not the client's. The plan had recorded this as a
known limit phrased as staleness ("a server started from terminal A and attached from B keeps A's
markers"); the measurement shows the common case is not a stale marker but no marker at all, on any
long-running server, any server started from a launch agent, and any started from a bare shell.

**Design changed on the evidence:** an unidentifiable emulator inside a multiplexer resolves to
`terminal_bell`, not `none`. Silence is the one outcome a user cannot distinguish from a broken feature,
and a bell is one byte an unconfigured terminal ignores — the identical argument already recorded in
D-F8-11 for the Apple Terminal arm, applied to the same problem. `preferredNotifChannel` remains the
override for naming the emulator outright.

**Not measured, left to the owner's manual pass (A11):** whether each specific emulator really exports the
marker attributed to it. This machine's shell carries none of them, so the survival test used synthetic
values. What was measured is the transport — whether tmux forwards them at all — not the claim that iTerm2
sets `LC_TERMINAL`.

**S-F8-r — tmux discards the passthrough by default, so the emulator sniff SUCCEEDING is the silent case.**
Task 10's reviewer found what S-F8-s missed, and I measured it: `allow-passthrough` is **off** on tmux 3.7b
with a null config, has defaulted off since tmux 3.3, and this machine's `~/.tmux.conf` does not set it.
The consequence inverts which half of the tmux problem the design was solving. When the marker sniff FAILS
we fall back to a bell and the user hears something; when it SUCCEEDS — a fresh server, markers present —
`auto` resolves to a real emulator, the module emits DCS-wrapped bytes, and tmux drops them. Silence, in
the case the design treated as working. Fixed in Task 10's fix wave: a detected multiplexer also emits a
bare unwrapped BEL alongside the wrapped sequence (skipped when the channel already carries one), so
passthrough-on gives the rich notification plus a bell and passthrough-off gives at least a bell. This is
canon's own `iterm2_with_bell` idea applied to the multiplexer case.

**S-F8-q — two canon bugs transcribed deliberately, now recorded so nobody "fixes" them.** Task 10's
reviewer checked the escape bytes against the terminals' own sources rather than against the brief that
specified them — the one check no test inside the task could perform — and found two divergences from the
documented protocols, both faithful to canon 2.1.236:
· **kitty**: the body chunk omits `d`, which kitty documents as defaulting to 1, so the notification
  completes and displays at chunk 2 and the third chunk is a separate command kitty discards. Benign
  (`a=focus` is kitty's default anyway). Our test actively rejects the protocol-correct form.
· **GNU screen**: `passthrough` doubles ESC for screen as well as tmux, but screen's string machine already
  passes a single ESC verbatim, so doubling corrupts the sequence. `terminalEscapes.ts` already had the
  precedent for this call ("transcribed, not corrected", about zellij); nobody had recorded it here, and
  Task 10 pinned it with exact-byte equality in three more places.

**S-F8-p — a faithful transcriber cannot audit the thing being transcribed.** Task 10 was the first task in
the wave whose implementer reported NO defect in its brief, and the review established why: the brief was
taken on faith. Thirteen of seventeen mutations survived its test file, and the brief's OWN binding
constraints went unasserted — "settings read at call time" had no test, and the brief's headline design
change (unidentifiable-in-a-multiplexer rings the bell) was pinned for tmux but not for screen, whose code
arm sat three lines away. The generalizable lesson for this wave's method: a clean implementer report is
weak evidence when the implementer's job was transcription, and the checks a task cannot perform on itself
— here, verifying escape bytes against the terminals rather than against the brief — have to be assigned
explicitly to the review.

## 9. Outcomes & Retrospective

**Status: shipped and closed, 2026-08-20.** Eleven implementation tasks, each independently reviewed,
plus this verification pass. All four units in § 3 landed across the eight stages § 6 named; no unit
landed atomically, and every commit typechecks.

### 9.1 What shipped

- **Unit 1 — the escape builders** (`src/tui/terminalEscapes.ts`). A leaf module of pure builders:
  `osc()`, `passthrough()`, `isMuxed()`, `notifyTerminator()`, `sanitizeNotificationText()`. It writes
  nothing and owns no lifecycle, and that emptiness is the design — writing stays with the modules
  that own their output path, and the signal handler stays singular in `cli/main.ts`. Two canon bugs
  are transcribed rather than corrected and are now recorded so nobody "fixes" them: `passthrough`
  doubles ESC for GNU screen as well as tmux (screen's string machine already passes a single ESC
  verbatim, so doubling corrupts it), and zellij is a recognised multiplexer with no wrapping arm.
- **Unit 2 — spinner motion.** `SPINNER_BASE`'s six glyphs walked by `raisedCosine`/`glyphIndex` over
  a 2000 ms period, the ghostty six-glyph variant, `spinnerInterval`'s 100/50 ms cadence, and
  `animationClock.ts` — canon's `Cg`, monotone, quantized to the live interval and clamped so a mode
  flip cannot step the clock backwards. `TurnSpinner` and `CompactionRow` both read it; the
  twelve-frame 120 ms ping-pong is gone.
- **Unit 2 — the message ladder.** `spinnerMessage`'s four rungs and `activeSpinnerTask`'s provenance
  filter, fed by `TaskItem.subagent` recorded at ingest from the frame's `parent_tool_use_id`.
- **Unit 3 — startup geometry.** `welcomeBanner`'s degraded branch (screen reader, or fewer than 30
  rows) as two spans; `startupTips`/`tipsVisible`/`renderTips` — canon's two-entry checklist, its tick,
  its home-directory note and its hide-when-complete gate — replacing ccx's three static strings.
- **Unit 4 — notifications, reduced motion, theme.** `desktopNotify.ts` (six channels plus a disable,
  per-emulator composition, multiplexer-aware resolution) on the permission-consult and turn-settle
  seams; `motion.ts`'s one resolver and its four consumers plus the `Reduce motion` settings row;
  `detectTerminalBackground` and a live-resolving `auto` theme.

### 9.2 What the acceptance run found

**16 of 16 cells now pass — 15 executed at wave close, and A11 owner-verified 2026-08-21.** Gates at close:
`npm run typecheck` clean · `npm run test:unit` 2902 passed in 221 files · `npm run test:tui` 3869
passed in 151 files, 9 live-skips · `npm run test:resize-matrix` 10 passed / 0 failed, with 2 keyed
cells skipping for want of a credential.

| Cell | Verdict | Instrument |
|---|---|---|
| A1 glyph curve | PASS | Keyless. Index matches `round(((1−cos(2πt/2000))/2)×5)` at all 2001 ms of one period; walk `·✢✳✶✻✽✻✶✳✢·`; dwell histogram 42,32,27,27,32,41 shows the easing; ghostty sixth glyph `✻` |
| A2 cadence | PASS | Keyless. 100 ms responding, 50 ms requesting, `null` under reduced motion; neither `TurnSpinner` nor `CompactionRow` retains a 120 ms timer (the only `120` in either file is a comment about the old one) and both derive time from `useAnimationClock`, never from a tick count × interval |
| A3a reduced motion, by setting | PASS | Keyless render. Glyph `·` and unchanging, **zero** intervals armed, compaction bar and retry row frozen, title holds `✳`; `Reduce motion` row present; pref round-trips through the prefs file. Every freeze paired with a motion-on control that must differ |
| A3b reduced motion, by screen reader | PASS | Keyless render. All four surfaces equally still with `prefersReducedMotion` unset and `CLAUDE_AX_SCREEN_READER=1` |
| A3c timer lifecycle | PASS | Keyless render with an instrumented `setInterval`. Armed count 1 · 1 · 0 · 0 across requesting → responding → reduced-motion → unmount; the clock reads 150 at 150 ms on the 50 ms quantum and does not fall to 100 when the quantum becomes 100 |
| A4 message ladder | PASS | Keyless. All five rungs, including the empty-string-is-absence rule |
| A4b provenance | PASS | End to end through the real path (`TaskList` → `useChat` → `TurnSpinner`) on nested frames; the nested task appears in the panel and never in the spinner |
| A5 startup degradation | PASS | **Live pty.** One line at 24 rows with no box, no cwd/model line, no tips; the box unchanged at 30; the one-line form at 40 rows under the screen-reader ladder. The two spans asserted on the SGR bytes: `ESC[38;2;215;119;87m ✻ Welcome to Claude Code ESC[2m ESC[39m ccx v0.1.0` |
| A6 tips checklist | PASS (on the amended design — see 9.3) | Keyless. Ticked line, unchecked line, workspace tip, home note last, and the visibility gate |
| A7 notification bytes | PASS (5 of 6 rows verbatim; the sixth on the amendment — see 9.3) | Keyless, 28 full-string equality assertions over six channels × three environments, kitty's three writes each asserted whole, both bell halves asserted unwrapped in both multiplexers |
| A8 policy | PASS | Keyless. Default pair delivers; a subagent completing writes zero bytes; enabling `agent_completed` makes the same event deliver; `notifications_disabled` silences all four; settings read at call time |
| A8b sanitization | PASS | Keyless, both dialects driven through their shipped call sites. Notification: `ESC`, `BEL`, `DEL`, `U+0085` each → a space, length preserved. Title: CSI stripped, C0 and DEL deleted, `U+0085` left, trimmed. The outputs differ, which is the point of the cell |
| A9 auto theme | PASS | Keyless. unset → dark · `15;0` → dark · `0;15` → light · `15;8` → dark · `0;banana` → dark, no throw |
| A10 signal exit | PASS | **Live pty.** `SIGTERM` put `ESC ] 0 ; BEL` on the wire (captured with `pipe-pane`) and the pane exited status 0. Asserts the title clear and a clean exit; **not** 143, and makes no raw-mode claim |
| A10b frame integrity | PASS | **Live pty**, fullscreen renderer, 12 staged transcript rows. Ten notifications — 688 bytes, 41 ESCs, including both kitty three-write forms and four DCS-wrapped sequences — written straight to the pane's tty. The captured frame is **byte-identical** before and after, the alternate screen is still up, and the dock is still on row 39 of 100×40 |
| A11 manual pass | **PASS (owner-verified 2026-08-21)** | Could not be automated; see 9.4 |

**Isolation held.** Live cells ran on a private tmux server (`tmux -L f8verify`) under an isolated
`HOME` beneath `/tmp` with `CCX_FLEET_ROOT` set. Every session was `f8v-`-prefixed and killed by name;
the owner's two long-lived sessions on the default server were listed before and after and were
untouched.

### 9.3 Divergences held, and two acceptance cells the spec's own evidence superseded

Recording these is the point: a wave that quietly re-writes its acceptance text to match what it built
has not been verified at all.

- **A7's last table row is stale, and the implementation is right.** The row says `auto` on an
  unidentified terminal writes "nothing at all" in both columns. S-F8-s changed that design on
  measurement after § 4 was written: a tmux pane inherits the *server's* environment, so an emulator
  sniff finding nothing is the ordinary case rather than the exotic one, and silence is the single
  outcome a user cannot distinguish from a broken feature. The muxed-unknown arm rings a bell.
  Executed both ways: bare + `auto` + unknown writes nothing (the row holds); `$TMUX`/`$STY` + `auto`
  + unknown writes one bare `\x07`. The other five rows pass verbatim.
- **A6's first sentence is stale, and the implementation is right.** It says that in a repository
  carrying a `CLAUDE.md` the tips block reads the ticked `/init` line. S-F8-t added the visibility gate
  afterwards, so `renderTips` produces exactly that line and `welcomeBanner` prints no tips section at
  all in that case — which is the whole point of the gate, since most repositories have a `CLAUDE.md`
  and would otherwise carry a permanent tick forever. Both halves executed; both pass.
- **Deliberate divergences shipped as designed:** the narrowed default event set (D-F8-5), Apple
  Terminal always answering the bell (D-F8-11), the degraded banner's leading `✻` (D-F8-12), the two
  canon bugs transcribed in `passthrough` and in kitty's body chunk (S-F8-q), and kitty ids being
  monotonic per notifier rather than random (better, not a shortcut — a repeated id replaces the prior
  notification in kitty's protocol).
- **One asymmetry, recorded rather than hidden:** `terminalTitle` is a long-lived object rather than a
  rendered component, so it resolves `reducedMotion` once at construction. A mid-session `/config`
  toggle reaches the spinner, the compaction bar and the retry row on the next frame, and reaches the
  tab title only on the next launch. This is what holds `tui-ux.md`'s reduced-motion row at 🟡.

### 9.4 A11 — PASSED (owner-verified)

**Date verified: 2026-08-21 · Terminal used: owner's real emulator · Result: PASS — the owner confirmed a
desktop notification reaching them.** This also closes Task 10 Step 1's delegated unknown in the field:
the resolver's sniffed marker chain produced a notification the owner actually received.

A11 terminates inside an emulator no instrument in this repo can drive, so it could not be marked passed
until the owner ran it. It
also closes **Task 10 Step 1's delegated unknown**: whether the environment marker the notification
resolver sniffs for each terminal is the one that actually survives into that terminal's tmux panes.
This machine's shell carries none of those markers, so the survival test used synthetic values — the
*transport* was measured, the *attribution* was not.

Reproduction, in a real **iTerm2** or **Ghostty** window (not inside tmux for steps 2–4; step 5 is the
tmux half):

```bash
# 1. Build, and use a scratch HOME so nothing touches your real prefs.
cd CC-to-SDK/harness && npm run build
export H=$(mktemp -d)/home && mkdir -p "$H/.claude/ccx"

# 2. Confirm the marker this terminal actually exports (the delegated unknown).
#    iTerm2 is expected to set LC_TERMINAL=iTerm2; Ghostty, GHOSTTY_RESOURCES_DIR.
env | grep -E 'LC_TERMINAL|KITTY_WINDOW_ID|KITTY_PID|GHOSTTY_RESOURCES_DIR|TERM=|TERM_PROGRAM='

# 3. Launch ccx and ask it for something needing permission, e.g. "run `ls` for me".
#    EXPECT: the permission prompt raises a SYSTEM notification titled "ccx".
HOME=$H CCX_FLEET_ROOT=$H/.claude/ccx node dist/cli/bin.js

# 4. While it runs, watch the TAB TITLE.
#    EXPECT: "✳ ccx" (or "✳ <session title>") at idle, and the prefix alternating
#            between ⠂ and ⠐ roughly once a second while a turn is in flight.
#    Then, from a second window:  kill -TERM <the ccx pid>
#    EXPECT: ccx exits cleanly AND the tab title returns to the shell's own.

# 5. The tmux half — the delegated unknown proper. From THIS terminal:
tmux -L a11check kill-server 2>/dev/null; tmux -L a11check new-session -d -s a11 \
  'env | grep -E "LC_TERMINAL|KITTY_WINDOW_ID|GHOSTTY_RESOURCES_DIR" > /tmp/a11-markers.txt; sleep 5'
sleep 6; cat /tmp/a11-markers.txt; tmux -L a11check kill-server
#    EXPECT (the claim under test): the marker seen in step 2 appears here too.
#    If it is EMPTY, `auto` cannot identify this emulator inside tmux and correctly falls back to the
#    bell — which is the designed behaviour, not a defect. Record which of the two happened.
```

Two facts to hold while reading the result. tmux overwrites both `TERM` and `TERM_PROGRAM` inside a
pane, so neither identifies the emulator. And `allow-passthrough` has defaulted **off** since tmux 3.3,
so inside tmux a DCS-wrapped notification is dropped unless the user enabled it — which is exactly why
an `auto`-resolved channel also rings a bell there. Hearing a bell but seeing no banner inside tmux is
the *designed* outcome on a default configuration, not a failure of step 3.

### 9.5 Parity

`docs/parity/tui-ux.md` rescored in the F8 recount: **§3 ~71% → ~79%** (the spinner glyph and verb rows
reach ✅; desktop notifications and reduced motion leave ❌ for 🟡, each with its arms named),
**§6 ~67% → ~75%** (the two mirror rows rise; one new 🟡 row for the `auto` theme), **overall ~76% →
~78%**. The § 5 deferrals — `CH30`, `CH34`, `TH3` tier 2 — are in that file's tail list with this
section as their evidence.

`docs/parity/coverage.md` carries the wave's entry and states plainly that **no domain score moves**:
F8 consumes no SDK surface at all, exactly as the fullscreen and tool-stream waves did. The only wire
field it reads is `parent_tool_use_id`, which that table already claims. Two environment facts were
carried there instead, because any embedder writing to a terminal inherits them: a tmux pane inherits
the *server's* environment (so emulator markers are commonly absent, not stale), and `allow-passthrough`
defaults off (so the sniff *succeeding* is the silent case).

### 9.6 What this wave should be remembered for

**A faithful transcriber cannot audit the thing being transcribed** (S-F8-p). Task 10 was the only task
whose implementer reported no defect in its brief, and its review established why: the brief was taken
on faith, thirteen of seventeen mutations survived its tests, and the brief's own binding constraints
went unasserted. The checks a task cannot perform on itself — here, verifying escape bytes against the
terminals' own documentation rather than against the brief — have to be assigned to the review
explicitly.

**Measurement beat the design twice, in opposite directions, inside one unit.** S-F8-s found that the
emulator sniff *failing* is the ordinary case inside tmux; S-F8-r then found that the sniff
*succeeding* is the silent one, because tmux drops the passthrough by default. Neither was reachable by
reasoning; both came from running tmux and reading what came back.

**An acceptance section written before the evidence is not self-updating.** Two of the sixteen cells in
§ 4 were made stale by findings recorded in § 8 of this same document, and both were caught only
because the verification pass executed the cell text as written rather than executing the tests the
wave had already produced. The habit worth keeping: read § 4 against the shipped code with a fresh
instrument, and when they disagree, say which one is wrong and why.

## 10. Revision Notes

- **v1 (2026-08-20)** — authored from the grounding pass against 2.1.236 and an eight-question grill.
  Born landed: every decision in § 7 was settled before writing, and § 0.1's audit replaces the
  parent spec's cell list as this wave's scope of record.
- **v3 (2026-08-20, adversarial review of the implementation plan — 4 high / 6 medium / 1 low; 11
  adopted, 0 rebutted).** Two spec-level changes. **Notification channel resolution is now
  multiplexer-aware and measurement-backed** (§ 3.4, D-F8-13): reusing `resolveTerminalName` would have
  answered `"tmux"` inside tmux and resolved `auto` to `none`, shipping the wave's one new capability
  dead in the environment it is tested in. **A10 drops its exit-143 requirement**, which was invented
  rather than observed — ccx exits 0 on a signal by design. A5 now requires the degraded line's two
  spans (accent title, dim version) rather than a uniformly-accent line, and A7 requires exact
  full-string equality across bare / `$TMUX` / `$STY` for every channel, because a `contains`
  assertion passes on an emitter that dropped its passthrough. The remaining eight findings were plan
  defects and are fixed there.
- **v2 (2026-08-20, adversarial review — 3 high / 7 medium / 1 low; 10 adopted, 1 adopted in part,
  0 rebutted).** Unit 1 rewritten: it is a **pure builder module**, it registers no signal handler,
  and the signal half of its charter is withdrawn as already-done (§ 8). Two sanitizers instead of
  one; the OSC terminator becomes a parameter so the title's BEL exemption is expressible; the bell is
  exempt from DCS wrapping. The spinner clock gains canon's monotonic high-water clamp, keeps the
  non-positive-`startedAt` guard, and owes a timer-lifecycle test (A3c). Reduced motion is derived
  from the setting **or** the screen-reader signal, with its own acceptance arm (A3b) — the finding
  with the clearest user cost. `TaskList` gains origin provenance so the message ladder cannot be
  retitled by a subagent (A4b). Apple Terminal's async profile probe becomes a recorded divergence
  (D-F8-11), and the degraded banner's `✻` likewise (D-F8-12). P93's write half is narrowed to a live
  frame-integrity cell (A10b) rather than retired. A7 becomes a positive channel × multiplexer matrix
  and A8 gains opt-in and queued-turn arms, so no declared branch can pass as a no-op. A10 drops its
  raw-mode claim, which bytes cannot prove. § 6 gains explicit landing stages.
