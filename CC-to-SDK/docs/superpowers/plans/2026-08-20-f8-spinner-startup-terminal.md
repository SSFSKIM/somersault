# F8 — Spinner, startup, and terminal integration: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use doperpowers:subagent-driven-development to implement
> this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close F8, the last scheduled wave of the TUI-clone fidelity program — canon's spinner motion,
the startup screen's geometry ladder, desktop notifications, reduced motion, and live theme detection.

**Architecture:** Four concerns, twelve independently reviewable tasks — **every one of which leaves the
repository typechecking**. A new pure-builder module owns
every escape string; the spinner's animation moves from a fixed tick to a monotone elapsed clock; the
banner grows a degraded branch and a real checklist; a new notifier module writes per-emulator escapes at
two trigger sites. Nothing registers a signal handler — `cli/main.ts:424` already owns all three signals
and drains `createChatTeardown`.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), React + Ink, vitest + `ink-testing-library`.

**Governing spec:** [`../specs/2026-08-20-f8-spinner-startup-terminal-design.md`](../specs/2026-08-20-f8-spinner-startup-terminal-design.md)
(v2, commit `bb62657803`). Canon bundle: `~/claude-code-bundle/2.1.236/cli.pretty.js`. Every line number
below is against that file.

## Global Constraints

- **Canon is 2.1.236.** Cite that bundle. Never re-derive a value from 2.1.220.
- **Dense hand-style, NO Prettier.** Match surrounding code. Do not reformat files you touch.
- **ESM:** import specifiers end in `.js` even though sources are `.ts`.
- **DI-by-deps:** inject `write`, `now`, `env`, `setInterval` — never reach for a global in a testable path.
- **TDD:** failing test → red → minimal implementation → green → `npm run typecheck`.
- **Never run bare `npm test`.** Only `npm run test:unit`, `npm run test:tui`, `npm run test:resize-matrix`.
- **Never touch `src/appserver/`** — a concurrent session owns it for this wave's duration.
- **Never register a `process.on("SIG…")` handler.** `cli/main.ts:424` is the single owner.
- **Spinner period:** `2000` ms. **Intervals:** `50` ms while requesting, `100` ms otherwise, `null` under
  reduced motion. **Startup row threshold:** `30`.
- **Notification copy names ccx**, not Claude: `ccx needs your permission to use <tool>` and
  `ccx is waiting for your input`; default title `ccx`.
- **Default notification events:** `permission_prompt` and `idle_prompt` only.
- Commit after every task. No `Co-Authored-By` trailer. Do not push.
- **Every assertion must fail against the nearest wrong implementation.** Before accepting a test as
  written here, ask what a plausible wrong version would do and whether this assertion would still pass:
  a range check missing its upper bound, a sniff where a parameter was required, one OR-arm of three, a
  wrap that forgot to escape. Prefer exact equality over `toContain`/`startsWith` wherever the value is
  fully known. **For each task's central assertion, confirm red-green explicitly** — break the
  implementation, watch the test fail, restore it — and report that in the task report. A regression test
  nobody has seen fail is not yet a regression test. Where a test block below is weaker than this rule
  requires, strengthen it and say so; the blocks are a starting point, not a ceiling.
- **A test that hand-sets a value proves nothing about who sets it.** Whenever a task adds WIRING — a prop
  threaded to a mount site, a case arm, a value seeded at startup — at least one of its tests must reach
  that value through the real chain, not by passing it in directly. The question to answer is not "does the
  component behave correctly when told to" but "would anything fail if nobody ever told it". Answer it the
  only way that settles it: delete the wiring, run the suite, and watch a test die. Two precedents in this
  repo do exactly this and are the shapes to copy — `test/tui/duration-row.test.tsx` drives the real hook
  and asserts the persisted patch, and `test/tui/compaction-row.test.tsx:144` pins a seam end to end through
  `ChatApp` with a comment naming the sabotages it defeats.

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/tui/terminalEscapes.ts` | **create** | Pure builders: `osc`, `passthrough`, `notifyTerminator`, `sanitizeNotificationText` |
| `src/tui/animationClock.ts` | **create** | `useAnimationClock` — monotone, quantized, `null`-disarmable |
| `src/tui/motion.ts` | **create** | `reducedMotion(prefs, env)` — the setting OR the screen reader |
| `src/tui/SettingsDialog.tsx` | modify | The `reduceMotion` row's ctx field and its apply branch |
| `src/tui/desktopNotify.ts` | **create** | Channel resolution + the four emitters + policy |
| `src/tui/spinner.ts` | modify | Glyph table → six entries; cosine index; `spinnerMessage` ladder |
| `src/tui/TurnSpinner.tsx` | modify | Consume the clock, the glyph, the ladder, reduced motion |
| `src/tui/CompactionRow.tsx` | modify | Same glyph source; honor reduced motion |
| `src/tui/RetryRow.tsx` | modify | Honor reduced motion |
| `src/tui/terminalTitle.ts` | modify | Compose via `osc`; honor reduced motion |
| `src/tui/taskList.ts` | modify | Record subagent origin at ingest |
| `src/tui/banner.ts` | modify | Degraded branch; tips checklist |
| `src/tui/theme.ts` | modify | `detectTerminalBackground`, `resolveThemeId` |
| `src/tui/renderer.ts` | modify | Extract `screenReaderEnabled` |
| `src/tui/prefs.ts` | modify | `prefersReducedMotion`, `preferredNotifChannel`, `notifEvents` |
| `src/tui/settingsRows.ts` | modify | `reduceMotion` row |
| `src/cli/main.ts` | modify | Pass `rows` + screen-reader verdict to the banner |
| `src/tui/useChat.ts` | modify | Two notifier call sites (threading only) |
| `src/tui/chatMain.tsx` | modify | Construct the notifier; thread reduced motion |

---

## Task 1: The escape builders

**Files:**
- Create: `src/tui/terminalEscapes.ts`
- Test: `test/tui/terminalEscapes.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `osc(terminator, ...parts) → string`, `passthrough(seq, env?) → string`,
  `notifyTerminator(env?) → "bel" | "st"`, `sanitizeNotificationText(s) → string`, and the constants
  `BELL`, `OSC_TITLE`, `OSC_ITERM2`, `OSC_KITTY`, `OSC_GHOSTTY`.

- [ ] **Step 1: Write the failing test**

Create `test/tui/terminalEscapes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { osc, passthrough, notifyTerminator, sanitizeNotificationText, BELL, OSC_ITERM2, OSC_KITTY, OSC_GHOSTTY, OSC_TITLE } from "../../src/tui/terminalEscapes.js";

describe("osc", () => {
  it("joins parts with ';' and terminates with BEL or ST", () => {
    expect(osc("bel", OSC_TITLE, "✳ ccx")).toBe("\x1b]0;✳ ccx\x07");
    expect(osc("st", OSC_KITTY, "i=1:d=0:p=title", "ccx")).toBe("\x1b]99;i=1:d=0:p=title;ccx\x1b\\");
  });
  it("takes the terminator as a parameter, never sniffing", () => {
    // HOSTILE ENV ON PURPOSE: on a non-kitty host this assertion passes against a SNIFFING
    // implementation too, which makes it worthless. Stub kitty in, then demand BEL anyway — the title
    // keeps BEL on every terminal, kitty included (terminalTitle.ts's Wave C skip).
    vi.stubEnv("TERM", "xterm-kitty"); vi.stubEnv("KITTY_WINDOW_ID", "1");
    expect(osc("bel", OSC_TITLE, "x")).toBe("\x1b]0;x\x07");
    vi.unstubAllEnvs();
  });
});

describe("passthrough", () => {
  const seq = "\x1b]9;hi\x07";
  it("wraps for tmux, doubling inner ESCs", () => {
    expect(passthrough(seq, { TMUX: "/tmp/s,1,0" } as NodeJS.ProcessEnv)).toBe("\x1bPtmux;\x1b\x1b]9;hi\x07\x1b\\");
  });
  it("wraps for screen without the tmux tag", () => {
    expect(passthrough(seq, { STY: "1.pts" } as NodeJS.ProcessEnv)).toBe("\x1bP\x1b\x1b]9;hi\x07\x1b\\");
  });
  it("passes through bare, and passes zellij through bare too (canon's Fq has no zellij arm)", () => {
    expect(passthrough(seq, {} as NodeJS.ProcessEnv)).toBe(seq);
    expect(passthrough(seq, { ZELLIJ: "0" } as NodeJS.ProcessEnv)).toBe(seq);
  });
});

describe("notifyTerminator", () => {
  it("is ST under kitty and BEL everywhere else", () => {
    expect(notifyTerminator({ TERM: "xterm-kitty" } as NodeJS.ProcessEnv)).toBe("st");
    expect(notifyTerminator({ TERM_PROGRAM: "iTerm.app" } as NodeJS.ProcessEnv)).toBe("bel");
    expect(notifyTerminator({ KITTY_WINDOW_ID: "1" } as NodeJS.ProcessEnv)).toBe("st");
    expect(notifyTerminator({ TERM_PROGRAM: "kitty" } as NodeJS.ProcessEnv)).toBe("st");
    expect(notifyTerminator({} as NodeJS.ProcessEnv)).toBe("bel");
  });
});

describe("sanitizeNotificationText", () => {
  it("replaces C0, DEL and C1 with a SPACE — canon's s$n, not the title's stripper", () => {
    expect(sanitizeNotificationText("a\x1b[31mb")).toBe("a [31mb");   // ESC → space, the rest is literal
    expect(sanitizeNotificationText(`a${BELL}b`)).toBe("a b");
    expect(sanitizeNotificationText("a\x7fb")).toBe("a b");
    expect(sanitizeNotificationText("a\x9bb")).toBe("a b");           // C1 — the title stripper leaves this
    expect(sanitizeNotificationText("plain")).toBe("plain");
  });
  it("never shortens the string", () => {
    const s = "\x00\x01\x02abc\x7f";
    expect(sanitizeNotificationText(s)).toHaveLength(s.length);
  });
  it("leaves every character above the C1 range alone", () => {
    // THE BOUNDARY IS THE TEST. An implementation written `c < 32 || c >= 127` — no upper bound —
    // passes every other assertion here while mangling accented letters, the spinner glyphs and every
    // box-drawing character in the product.
    expect(sanitizeNotificationText("a é✳b")).toBe("a é✳b");
    expect(sanitizeNotificationText("\x9f")).toBe(" ");        // last C1 byte, replaced
    expect(sanitizeNotificationText("\u00a0")).toBe("\u00a0");  // first byte past it, preserved
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd harness && npx vitest run test/tui/terminalEscapes.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/tui/terminalEscapes.js"`.

- [ ] **Step 3: Write the implementation**

Create `src/tui/terminalEscapes.ts`:

```ts
// tui/src/terminalEscapes.ts — F8 Task 1: PURE builders for every escape ccx writes to the terminal
// outside Ink's frame. No writes, no lifecycle, no signals — and that emptiness is the design, not an
// omission. Writing stays with the modules that own their output path (terminalTitle keeps its `write`
// dep; desktopNotify takes its own), and SIGHUP/SIGTERM/SIGINT stay with `cli/main.ts:424`'s single
// handler, which drains `createChatTeardown` — whose third step is already `clearTitle()`. A second
// handler here would double-register against an owner built to be singular (see altScreen.ts's
// `signalsOwned` flag) and would drop SIGHUP.
//
// Canon (2.1.236): `tI` assembles OSC (L188457), `Fq` wraps for a multiplexer (L188461), `s$n`
// sanitizes notification text (L202519), codes come from `wC` (L188790).
//
// THE TERMINATOR IS A PARAMETER, NOT A SNIFF. Canon's `tI` picks ST when the terminal is kitty. Ours
// cannot decide that internally, because the one existing caller — the terminal title — keeps BEL on
// every terminal INCLUDING kitty (terminalTitle.ts's recorded Wave C skip). A builder that sniffed
// would force a caller either to change title bytes or to bypass the seam. So callers state their
// terminator and `notifyTerminator()` supplies canon's rule for the ones that want it.

const ESC = "\x1b", OSC_INTRO = "\x1b]", ST = "\x1b\\";
/** `FK` (L129061) — the BEL terminator, and also the whole `terminal_bell` notification. */
export const BELL = "\x07";

/** `wC` (L188790), the four codes this harness emits. TAB_STATUS (21337) is deferred — spec § 5. */
export const OSC_TITLE = 0, OSC_ITERM2 = 9, OSC_KITTY = 99, OSC_GHOSTTY = 777;

export type OscTerminator = "bel" | "st";

/** canon's `tI` (L188457): `ESC ] parts.join(";") <terminator>`. */
export function osc(terminator: OscTerminator, ...parts: (string | number)[]): string {
  return OSC_INTRO + parts.join(";") + (terminator === "st" ? ST : BELL);
}

/** canon's `Fq` (L188461): the DCS passthrough a multiplexer needs to forward an escape to the real
 *  emulator. Note what canon does NOT wrap: zellij is a recognised mux in `eUr` but has no arm in `Fq`,
 *  so it passes through bare — transcribed, not corrected. */
export function passthrough(seq: string, env: NodeJS.ProcessEnv = process.env): string {
  if (env.TMUX) return `${ESC}Ptmux;${seq.replaceAll(ESC, ESC + ESC)}${ST}`;
  if (env.STY) return `${ESC}P${seq.replaceAll(ESC, ESC + ESC)}${ST}`;
  return seq;
}

/** canon's `cTp() === "kitty"` test, over the terminal identity `altScreen.resolveTerminalName` already
 *  computes. Kept as a local env read rather than an import so this module stays a leaf. */
export function notifyTerminator(env: NodeJS.ProcessEnv = process.env): OscTerminator {
  const kitty = env.TERM?.includes("kitty") === true || env.TERM_PROGRAM === "kitty" || env.KITTY_WINDOW_ID !== undefined;
  return kitty ? "st" : "bel";
}

/** canon's `s$n` (L202519): every C0 byte, DEL, and every C1 byte becomes a SPACE — length-preserving,
 *  because the point is to neutralise a byte that would terminate or reopen the sequence carrying it,
 *  not to tidy the text.
 *
 *  THIS IS NOT `terminalTitle.ts`'s SANITIZER AND MUST NEVER BE MERGED WITH IT. That one strips CSI
 *  sequences, DELETES C0/DEL, leaves C1 alone, and trims. Both are faithful to their own canon call
 *  site; one helper cannot be both. `test/tui/terminalEscapes.test.ts` and the title's own test pin the
 *  difference in opposite directions on purpose. */
export function sanitizeNotificationText(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out += c < 32 || (c >= 127 && c <= 159) ? " " : s[i];
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd harness && npx vitest run test/tui/terminalEscapes.test.ts && npm run typecheck`
Expected: PASS, 8 tests. Typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add harness/src/tui/terminalEscapes.ts harness/test/tui/terminalEscapes.test.ts
git commit -m "f5(f8): T1 — pure escape builders; the terminator is a parameter, and the two sanitizers stay two"
```

---

## Task 2: Recompose the terminal title on the builders

**Files:**
- Modify: `src/tui/terminalTitle.ts`
- Test: `test/unit/terminal-title.test.ts` (existing — the **byte-level** home; the `.tsx` file in
  `test/tui/` is the wiring half and its own header says so, so writer tests do not go there)

**Interfaces:**
- Consumes: `osc`, `OSC_TITLE` (Task 1).
- Produces: no signature change.

Nothing observable changes. The task exists so the title's bytes and the notifier's bytes come from one
builder and cannot drift apart.

- [ ] **Step 1: Write the characterization test**

Add to `test/unit/terminal-title.test.ts`, using that file's existing deterministic-timer harness:

```ts
it("keeps BEL under kitty — the title does NOT follow canon's ST rule (Wave C's recorded skip)", () => {
  const writes: string[] = [];
  const title = createTerminalTitle({ write: (s) => writes.push(s), env: { TERM: "xterm-kitty" } as NodeJS.ProcessEnv });
  title.setTitle("work");
  expect(writes.at(-1)).toBe("\x1b]0;✳ work\x07");
});
```

- [ ] **Step 2: Run it — it must pass BEFORE the refactor**

Run: `cd harness && npx vitest run test/unit/terminal-title.test.ts`
Expected: PASS. Record in the report that it passed pre-change; that is what makes it a guard.

- [ ] **Step 3: Recompose through the builder**

Add `import { osc, OSC_TITLE } from "./terminalEscapes.js";`, then replace the constant and the write:

```ts
export const TERMINAL_TITLE_CLEAR = osc("bel", OSC_TITLE, "");
```
```ts
    deps.write(osc("bel", OSC_TITLE, composed));
```

- [ ] **Step 4: Delete the stale follow-up note**

Replace the whole `FOLLOW-UP, RECORDED AND NOT THIS MODULE'S JOB` paragraph with:

```
// THE SIGTERM FOLLOW-UP THIS FILE USED TO CARRY IS DONE, and was already done when it was written down.
// `cli/main.ts:424` registers one handler each for SIGHUP/SIGTERM/SIGINT and drains `createChatTeardown`,
// whose third step is `clearTitle()` (chatMain.tsx:866). Nothing about titles needs a signal handler, and
// adding one would double-register against an owner deliberately built to be singular.
```

- [ ] **Step 5: Verify and commit**

Run: `cd harness && npx vitest run test/unit/terminal-title.test.ts test/tui/terminal-title.test.tsx && npm run typecheck`
Expected: PASS, unchanged assertion outcomes.

```bash
git add harness/src/tui/terminalTitle.ts harness/test/unit/terminal-title.test.ts
git commit -m "f5(f8): T2 — title bytes come from the shared builder; the stale SIGTERM note is deleted"
```

---

## Task 3: The spinner's glyph and its monotone clock, in one green commit

**Files:**
- Create: `src/tui/animationClock.ts`
- Modify: `src/tui/spinner.ts`, `src/tui/TurnSpinner.tsx`, `src/tui/CompactionRow.tsx`
- Test: `test/tui/animationClock.test.tsx` (create), `test/tui/spinner.test.ts`,
  `test/tui/components.test.tsx`, `test/tui/compaction-row.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `SPINNER_BASE`, `SPINNER_BASE_GHOSTTY`, `spinnerBase(env?)`, `SPINNER_PERIOD_MS = 2000`,
  `raisedCosine(ms, periodMs)`, `glyphIndex(elapsedMs, frameCount)`, `glyphFor(elapsedMs, env?)`,
  `SPINNER_INTERVAL_MS = 100`, `SPINNER_REQUESTING_INTERVAL_MS = 50`, `spinnerInterval(mode, reducedMotion)`,
  `useAnimationClock(intervalMs, startedAt, now?)`.

**This is one task, not two.** Removing `glyphFrame` breaks both of its callers, so a commit that removes
it without migrating them leaves the repository failing typecheck — a broken bisect boundary and a
contradiction of this plan's own green-at-every-commit rule.

- [ ] **Step 1: Write the failing tests**

In `test/tui/spinner.test.ts`, replace the existing 12-frame ping-pong block with:

```ts
  it("has canon's SIX base glyphs, with the ghostty variant repeating the fifth", () => {
    expect(SPINNER_BASE).toEqual(["·", "✢", "✳", "✶", "✻", "✽"]);
    expect(SPINNER_BASE_GHOSTTY).toEqual(["·", "✢", "✳", "✶", "✻", "✻"]);
    expect(spinnerBase({ TERM: "xterm-ghostty" } as NodeJS.ProcessEnv)).toEqual(SPINNER_BASE_GHOSTTY);
    expect(spinnerBase({ TERM: "xterm-256color" } as NodeJS.ProcessEnv)).toEqual(SPINNER_BASE);
  });

  it("raisedCosine is canon's (1 - cos(2*PI*t/period))/2", () => {
    expect(raisedCosine(0, 2000)).toBeCloseTo(0, 10);
    expect(raisedCosine(1000, 2000)).toBeCloseTo(1, 10);
    expect(raisedCosine(2000, 2000)).toBeCloseTo(0, 10);
    expect(raisedCosine(500, 2000)).toBeCloseTo(0.5, 10);
  });

  it("glyphIndex walks out and back across one period, eased at the ends", () => {
    const at = (ms: number) => glyphIndex(ms, 6);
    expect([at(0), at(1000), at(2000), at(3000)]).toEqual([0, 5, 0, 5]);
    expect(at(100)).toBe(at(0));            // dwells at the bottom
    expect(at(900)).toBe(at(1000));         // and at the top
    // EXACT, not merely ascending: a LINEAR walk is also ascending and would pass a sorted-check.
    // The eased sequence dwells at both ends — [0,0,2,3,5,5] where linear gives [0,1,2,3,4,5].
    expect([0, 200, 400, 600, 800, 1000].map(at)).toEqual([0, 0, 2, 3, 5, 5]);
  });

  it("glyphIndex is negative-safe and never leaves the array", () => {
    for (const ms of [-1, -10_000, 0, 1, 12_345_678]) {
      const i = glyphIndex(ms, 6);
      expect(Number.isInteger(i) && i >= 0 && i < 6).toBe(true);
    }
  });

  it("glyphFor picks from the env's table", () => {
    expect(glyphFor(0, {} as NodeJS.ProcessEnv)).toBe("·");
    expect(glyphFor(1000, {} as NodeJS.ProcessEnv)).toBe("✽");
    expect(glyphFor(1000, { TERM: "xterm-ghostty" } as NodeJS.ProcessEnv)).toBe("✻");
  });

  it("spinnerInterval is 50 requesting, 100 otherwise, and null under reduced motion", () => {
    expect(spinnerInterval("requesting", false)).toBe(50);
    expect(spinnerInterval("responding", false)).toBe(100);
    expect(spinnerInterval(undefined, false)).toBe(100);
    expect(spinnerInterval("requesting", true)).toBeNull();
  });
```

Create `test/tui/animationClock.test.tsx`:

```tsx
import React from "react";
import { render } from "ink-testing-library";
import { Text } from "ink";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { useAnimationClock } from "../../src/tui/animationClock.js";

function Probe({ interval, startedAt, now }: { interval: number | null; startedAt: number; now: () => number }) {
  return <Text>{`t=${useAnimationClock(interval, startedAt, now)}`}</Text>;
}

describe("useAnimationClock", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // ASYNC, AND THE FAKED TIMER SET IS NAMED. React commits passive effects on its own task, so a
  // synchronous `getTimerCount()` reads one mount behind and the first assertion fails 0-vs-1; and
  // vitest's DEFAULT fake set includes `setImmediate`, which strands those effects entirely. Flush after
  // every render, and fake only what this test is about.
  it("arms one timer, none when null, and exactly one across a change", async () => {
    const flush = () => new Promise((r) => setImmediate(r));
    const now = () => 1000;
    const { rerender, unmount } = render(<Probe interval={50} startedAt={1000} now={now} />);
    await flush();
    expect(vi.getTimerCount()).toBe(1);
    rerender(<Probe interval={100} startedAt={1000} now={now} />);
    expect(vi.getTimerCount()).toBe(1);
    rerender(<Probe interval={null} startedAt={1000} now={now} />);
    expect(vi.getTimerCount()).toBe(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never runs backward across the 50ms -> 100ms transition", () => {
    let clock = 1150;                              // 150ms elapsed
    const now = () => clock;
    const { lastFrame, rerender } = render(<Probe interval={50} startedAt={1000} now={now} />);
    expect(lastFrame()).toBe("t=150");
    rerender(<Probe interval={100} startedAt={1000} now={now} />);   // naive requantize gives 100
    expect(lastFrame()).toBe("t=150");
  });

  it("treats a non-positive startedAt as 'just started' rather than 1970", () => {
    const { lastFrame } = render(<Probe interval={100} startedAt={0} now={() => 1_700_000_000_000} />);
    expect(lastFrame()).toBe("t=0");
  });
});
```

- [ ] **Step 2: Run both to verify they fail**

Run: `cd harness && npx vitest run test/tui/spinner.test.ts test/tui/animationClock.test.tsx`
Expected: FAIL on unresolved imports and missing exports.

- [ ] **Step 3: Replace the glyph block in `spinner.ts`**

Replace lines 31-39 (`SPINNER_BASE` / `SPINNER_FRAMES` / `glyphFrame`) with:

```ts
/** The darwin asterisk-pulse base chars (`MSt`, L495134-495137). SIX entries, not a ping-pong of twelve:
 *  canon walks them with an eased index, and the out-and-back falls out of the cosine. */
export const SPINNER_BASE = ["·", "✢", "✳", "✶", "✻", "✽"] as const;
/** The `TERM === "xterm-ghostty"` variant (L495135) — the sixth slot repeats the fifth. */
export const SPINNER_BASE_GHOSTTY = ["·", "✢", "✳", "✶", "✻", "✻"] as const;
export function spinnerBase(env: NodeJS.ProcessEnv = process.env): readonly string[] {
  return env.TERM === "xterm-ghostty" ? SPINNER_BASE_GHOSTTY : SPINNER_BASE;
}

/** `c8T` (L507933) — the glyph cycle's period. */
export const SPINNER_PERIOD_MS = 2000;
/** `Ero` (L495099) — a raised cosine on [0,1]. */
export const raisedCosine = (ms: number, periodMs: number): number => (1 - Math.cos((2 * Math.PI * ms) / periodMs)) / 2;

/** `y8T` (L507743). The cosine is what makes the walk EASED: the glyph dwells at both ends of the pulse
 *  and moves fastest through the middle, where a linear ping-pong stepped evenly. Negative-safe, because
 *  `raisedCosine` is even and periodic. */
export function glyphIndex(elapsedMs: number, frameCount: number): number {
  return Math.round(raisedCosine(elapsedMs, SPINNER_PERIOD_MS) * (frameCount - 1));
}

export function glyphFor(elapsedMs: number, env: NodeJS.ProcessEnv = process.env): string {
  const table = spinnerBase(env);
  return table[glyphIndex(elapsedMs, table.length)]!;
}

/** `Cg(t ? null : e === "requesting" ? 50 : 100)` (L507766). Note what these are NOT: the 200 in
 *  `U = e === "requesting" ? 50 : 200` on the very next line steps the SHIMMER position, a different
 *  clock in the same expression. */
export const SPINNER_INTERVAL_MS = 100, SPINNER_REQUESTING_INTERVAL_MS = 50;
export function spinnerInterval(mode: SpinnerMode | undefined, reducedMotion: boolean): number | null {
  return reducedMotion ? null : mode === "requesting" ? SPINNER_REQUESTING_INTERVAL_MS : SPINNER_INTERVAL_MS;
}
```

- [ ] **Step 4: Create `src/tui/animationClock.ts`**

```ts
// tui/src/animationClock.ts — F8 Task 3: canon's `Cg` (L204972), the clock every ccx spinner reads.
// Returns MONOTONE elapsed milliseconds, quantized to the repaint interval, and arms no timer at all
// when the interval is null.
//
// THE CLAMP IS THE POINT. Quantizing elapsed time by a VARYING interval is not monotone: at 150ms,
// floor(150/50)*50 = 150 but floor(150/100)*100 = 100, so a turn leaving `requesting` would step its
// clock BACKWARD 50ms — reversing the glyph's cosine and handing the token easing a negative delta.
// Canon has the same hazard and the same fix (`u.current = Math.max(u.current, Math.floor(now/c)*c)`).
// Nothing about this is visible until the mode flips, which is why the lifecycle test exists.
//
// `null` DISARMS rather than freezes: under reduced motion the component does no periodic work at all.
import { useEffect, useRef, useState } from "react";

export function useAnimationClock(intervalMs: number | null, startedAt: number, now: () => number = Date.now): number {
  const [, setTick] = useState(0);
  const highWater = useRef(0);
  useEffect(() => {
    if (intervalMs === null) return;
    const h = setInterval(() => setTick((n) => n + 1), intervalMs);
    return () => clearInterval(h);
  }, [intervalMs]);
  // A non-positive stamp reads as "just started" — `useChat` sets busy and the start stamp in two
  // setStates that do not commit together, so one painted frame can hold busy=true and startedAt=0, and
  // `now() - 0` rendered as "(29758130m 59s)" in a real binary (pty acceptance, w3.9).
  // THE HIGH-WATER IS SCOPED TO ONE TURN. Canon clamps an absolute clock that only ever rises, so it
  // never needs resetting; ours clamps ELAPSED time, which restarts at zero every turn. Without the
  // reset, a component handed a fresh `startedAt` would sit frozen on the previous turn's maximum for
  // the whole of the next one — a sixty-second turn would leave the next spinner motionless.
  const startRef = useRef(startedAt);
  if (startRef.current !== startedAt) { startRef.current = startedAt; highWater.current = 0; }
  // `null` MEANS FROZEN, not merely un-self-triggered. If the disarmed arm kept recomputing elapsed
  // time, every parent rerender would advance it — and a caller that derives an animation from this
  // value would keep animating while believing it had stopped. That is not hypothetical: with a live
  // disarmed clock, `CompactionRow`'s reduced-motion branch is a PROVABLE no-op, because
  // `compactionRatio` is monotone with its own floor, so `ratio(max(elapsed))` equals
  // `max(prev, ratio(elapsed))`. The glyph would freeze and the bar would creep on.
  if (intervalMs === null) return highWater.current;
  const elapsed = startedAt > 0 ? Math.max(0, now() - startedAt) : 0;
  const quantized = Math.floor(elapsed / intervalMs) * intervalMs;
  if (quantized > highWater.current) highWater.current = quantized;
  return highWater.current;
}
```

- [ ] **Step 5: Migrate `TurnSpinner.tsx`**

Delete `FRAME_MS`, the `tick` state and its `useEffect`. New body:

```tsx
export function TurnSpinner({ startedAt, verb, meter = IDLE_METER, columns = 80, verbose = false, reducedMotion = false, env = process.env, now = Date.now, pick = pickVerb }: {
  startedAt: number; verb?: string; meter?: SpinnerMeter; columns?: number; verbose?: boolean;
  reducedMotion?: boolean; env?: NodeJS.ProcessEnv; now?: () => number; pick?: () => string;
}) {
  const verbRef = useRef<string>();
  if (verbRef.current === undefined) verbRef.current = verb ?? pick();
  const animRef = useRef({ chars: 0, at: 0 });
  const phaseRef = useRef(initPhaseState());
  const kindRef = useRef<SpinnerPhase["kind"]>("none");

  const animMs = useAnimationClock(spinnerInterval(meter.mode, reducedMotion), startedAt, now);
  // Under reduced motion the eased count SNAPS to its target (canon L507780: `if (t) ie.current = B`).
  // There is no animation to ease, and easing against a clock nobody advances would freeze the number.
  if (reducedMotion) animRef.current = { chars: meter.chars, at: animMs };
  else {
    const steps = Math.floor((animMs - animRef.current.at) / EASE_STEP_MS);
    if (steps > 0) animRef.current = { chars: easeChars(animRef.current.chars, meter.chars, steps), at: animRef.current.at + steps * EASE_STEP_MS };
  }

  const clock = now();
  const elapsedMs = startedAt > 0 ? clock - startedAt : 0;
  const input = {
    now: clock, isThinking: meter.isThinking, hasActiveTools: meter.hasActiveTools,
    thinkingStatus: thinkingStatusOf(meter.lastBurst, meter.isThinking, clock),
    showToolTimer: true,
  };
  phaseRef.current = advancePhase(phaseRef.current, input);
  const phase = phaseFor(phaseRef.current, input);
  if (phase.kind !== kindRef.current) {
    if (verb === undefined) verbRef.current = rotateVerb(verbRef.current!, kindRef.current, phase.kind, pick);
    kindRef.current = phase.kind;
  }

  const gerund = `${verbRef.current!}…`;
  const status = spinnerStatus({
    elapsedMs, tokens: estimateTokens(animRef.current.chars), mode: meter.mode, phase,
    columns, messageWidth: stringWidth(gerund), verbose,
  });
  return (
    <Text>
      <Text color={ACCENT}>{reducedMotion ? spinnerBase(env)[0]! : glyphFor(animMs, env)}</Text>
      <Text>{` ${gerund}`}</Text>
      {status ? <Text dimColor>{` ${status}`}</Text> : null}
    </Text>
  );
}
```

Imports: drop `glyphFrame`, `useEffect`, `useState`; add `glyphFor, spinnerBase, spinnerInterval` from
`./spinner.js` and `useAnimationClock` from `./animationClock.js`.

- [ ] **Step 6: Migrate `CompactionRow.tsx`**

Swap `glyphFrame` for `glyphFor`, delete its `tick` state and `useEffect`, and change the signature and
the two lines that used the tick:

```tsx
export function CompactionRow({ startedAt, now = Date.now, columns, reducedMotion = false, env = process.env }: { startedAt: number; now?: () => number; columns: number; reducedMotion?: boolean; env?: NodeJS.ProcessEnv }) {
  const ratioRef = useRef(0);
  const animMs = useAnimationClock(reducedMotion ? null : SPINNER_INTERVAL_MS, startedAt, now);
  // The BAR freezes with the glyph. Its ratio is a function of wall-clock elapsed, so left reading
  // `now()` it would keep advancing on any unrelated parent rerender while the glyph stood still — a
  // half-stopped animation, worse than either state. Under reduced motion it reads the clock instead,
  // which `useAnimationClock` holds frozen on its disarmed arm — and that freeze is what makes this
  // branch do anything at all. `ratioRef`'s monotonic floor keeps it from ever walking back.
  const ratio = ratioRef.current = compactionRatio(reducedMotion ? animMs : (startedAt > 0 ? now() - startedAt : 0), ratioRef.current);
```

and the glyph:

```tsx
        <Text color={ACCENT}>{reducedMotion ? spinnerBase(env)[0]! : glyphFor(animMs, env)}</Text>
```

Add `SPINNER_INTERVAL_MS, spinnerBase, glyphFor` to its `./spinner.js` import.

- [ ] **Step 7: Verify green, then commit**

Run: `cd harness && npm run test:tui && npm run typecheck`
Expected: PASS and clean — **this commit must typecheck**. If an existing assertion pinned the old
ping-pong glyph at a tick, convert it to the cosine's glyph for the same elapsed time; do not
reintroduce a tick-indexed helper.

```bash
git add harness/src/tui harness/test/tui
git commit -m "f5(f8): T3 — six glyphs on a monotone cosine clock, both callers migrated in one green commit"
```

---

## Task 4: Task provenance in `TaskList`

**Files:**
- Modify: `src/tui/taskList.ts`
- Test: `test/tui/taskList.test.ts`

**Interfaces:**
- Produces: `TaskItem.subagent?: true`, set at ingest from the frame's `parent_tool_use_id`.

Canon's `B` gate asks "is this the main agent's spinner?" and can, because its spinner store is per-agent
(`OCl(EDl.agentId)`, L507981). ccx has one spinner and one global task store that never reads
`parent_tool_use_id`, so the same gate transplanted is a constant `true` and a subagent's todo list would
retitle the main spinner. The provenance is recorded here; only Task 5's selector filters on it, and
**the task panel keeps showing every task**.

- [ ] **Step 1: Write the failing test**

Add to `test/tui/taskList.test.ts`:

```ts
it("marks a task created on a nested frame as a subagent's, and leaves a top-level one unmarked", () => {
  const list = new TaskList();
  list.ingest({ type: "assistant", message: { content: [{ type: "tool_use", id: "tu_main", name: "TaskCreate", input: { subject: "Main work" } }] } });
  list.ingest({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu_main", content: "Task #1 created successfully: Main work" }] } });
  list.ingest({ type: "assistant", parent_tool_use_id: "agent_1", message: { content: [{ type: "tool_use", id: "tu_sub", name: "TaskCreate", input: { subject: "Nested work" } }] } });
  list.ingest({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu_sub", content: "Task #2 created successfully: Nested work" }] } });

  const snap = list.snapshot();
  expect(snap).toHaveLength(2);                                    // the PANEL still sees both
  expect(snap.find((t) => t.subject === "Main work")!.subagent).toBeUndefined();
  expect(snap.find((t) => t.subject === "Nested work")!.subagent).toBe(true);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd harness && npx vitest run test/tui/taskList.test.ts`
Expected: FAIL — `expected undefined to be true`.

- [ ] **Step 3: Implement**

Add to `TaskItem`, after `activeForm`:

```ts
  /** Set when this task's `TaskCreate` arrived on a NESTED frame (the frame carried a
   *  `parent_tool_use_id`). Absent = the main agent's, following this file's absent-rather-than-empty
   *  rule. Only the spinner's message ladder reads it; the panel shows every task regardless. */
  subagent?: true;
```

Widen the pending map: `private pending = new Map<string, { subject: string; activeForm?: string; subagent?: true }>();`

In `ingest`, read the origin off the FRAME (not the block) and thread it through the `TaskCreate` arm
and the result-drain that moves `pending` into `tasks`:

```ts
    if (mm?.type === "assistant") {
      const nested = typeof mm.parent_tool_use_id === "string" && mm.parent_tool_use_id !== "" ? true as const : undefined;
      for (const b of mm.message?.content ?? []) {
```

- [ ] **Step 4: Verify and commit**

Run: `cd harness && npm run test:tui && npm run typecheck`
Expected: PASS. The no-filter guarantee needs a suite that actually drives `TaskList.ingest` with a real
TaskCreate/tool_result pair — `test/tui/task-panel.test.tsx` builds `TaskItem` objects by hand and never
calls `ingest`, so it CANNOT detect an ingest-side filter. `test/tui/chat.test.tsx` and
`test/tui/rewind-picker.test.tsx` do drive the real wire pair; the whole suite is the cheap way to cover
both plus anything else that reads a snapshot.

```bash
git add harness/src/tui/taskList.ts harness/test/tui/taskList.test.ts
git commit -m "f5(f8): T4 — task origin recorded at ingest; the panel still shows everything"
```

---

## Task 5: The message ladder, proved through the real path

**Files:**
- Modify: `src/tui/spinner.ts`, `src/tui/TurnSpinner.tsx`, `src/tui/ChatApp.tsx`
- Test: `test/tui/spinner.test.ts`, `test/tui/chat.test.tsx`

**Interfaces:**
- Consumes: `TaskItem.subagent` (Task 4).
- Produces: `spinnerMessage(input)`, `activeSpinnerTask(tasks)`.

- [ ] **Step 1: Write the unit tests**

Add to `test/tui/spinner.test.ts`:

```ts
describe("spinnerMessage", () => {
  it("walks canon's ladder: override, activeForm, subject, defaultVerb, random", () => {
    const base = { randomVerb: "Baking" };
    expect(spinnerMessage({ ...base, overrideMessage: "Compacting", activeTask: { activeForm: "Running tests", subject: "Fix parser" } })).toBe("Compacting");
    expect(spinnerMessage({ ...base, activeTask: { activeForm: "Running tests", subject: "Fix parser" } })).toBe("Running tests");
    expect(spinnerMessage({ ...base, activeTask: { subject: "Fix parser" } })).toBe("Fix parser");
    expect(spinnerMessage({ ...base, defaultVerb: "Churning" })).toBe("Churning");
    expect(spinnerMessage(base)).toBe("Baking");
  });
  it("treats an empty or blank rung as absent", () => {
    expect(spinnerMessage({ randomVerb: "Baking", overrideMessage: "  ", activeTask: { subject: "" } })).toBe("Baking");
  });
});

describe("activeSpinnerTask", () => {
  const t = (subject: string, status: TaskStatus, extra: Partial<TaskItem> = {}): TaskItem => ({ id: subject, subject, status, ...extra });
  it("picks the first task that is neither pending nor completed", () => {
    expect(activeSpinnerTask([t("a", "completed"), t("b", "in_progress"), t("c", "in_progress")])!.subject).toBe("b");
    expect(activeSpinnerTask([t("a", "pending"), t("b", "completed")])).toBeUndefined();
  });
  it("never picks a subagent's task", () => {
    expect(activeSpinnerTask([t("nested", "in_progress", { subagent: true })])).toBeUndefined();
    expect(activeSpinnerTask([t("nested", "in_progress", { subagent: true }), t("mine", "in_progress")])!.subject).toBe("mine");
  });
});
```

- [ ] **Step 2: Write the end-to-end test — this is the one that proves A4b**

The unit tests above would all stay green if nobody wired `tasks` into the spinner. Add to
`test/tui/chat.test.tsx`, driving real frames through `fakeRemote` exactly as the neighbouring
transcript tests do:

```tsx
it("an in-progress task retitles the spinner; a subagent's does not (F8 A4/A4b)", async () => {
  let fake: ReturnType<typeof fakeRemote>;
  fake = fakeRemote({
    submit: async (_p, onMessage) => {
      fake.pushEvent({ kind: "turn", phase: "start", seq: 1 });
      onMessage({ type: "assistant", message: { content: [{ type: "tool_use", id: "tu1", name: "TaskCreate", input: { subject: "Fix the parser" } }] } });
      onMessage({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu1", content: "Task #1 created successfully: Fix the parser" }] } });
      onMessage({ type: "assistant", message: { content: [{ type: "tool_use", id: "tu2", name: "TaskUpdate", input: { taskId: "1", status: "in_progress" } }] } });
      return new Promise(() => {});                       // hold the turn open so the spinner stays up
    },
  });
  const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
  await waitFor(() => frame(lastFrame).includes("❯ "));
  stdin.write("go"); stdin.write("\r");
  await waitFor(() => frame(lastFrame).includes("Fix the parser…"));   // the SUBJECT rung, live

  // now a NESTED task goes in progress — the spinner must not follow it
  deliver({ type: "assistant", parent_tool_use_id: "agent_1", message: { content: [{ type: "tool_use", id: "tu3", name: "TaskCreate", input: { subject: "Nested chore", activeForm: "Doing a nested chore" } }] } });
  deliver({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu3", content: "Task #2 created successfully: Nested chore" }] } });
  deliver({ type: "assistant", parent_tool_use_id: "agent_1", message: { content: [{ type: "tool_use", id: "tu4", name: "TaskUpdate", input: { taskId: "2", status: "in_progress" } }] } });
  await waitFor(() => frame(lastFrame).includes("Nested chore"));      // it DID reach the panel
  expect(spinnerLine(lastFrame)).toContain("Fix the parser…");         // and the spinner did not move
  expect(spinnerLine(lastFrame)).not.toContain("Doing a nested chore");
});
```

**Frame delivery — the snippet's channel is WRONG and correcting it is part of this task.** `useChat.ts:1405`
ingests into `TaskList` from `ev.data` of a `{ kind: "message" }` EVENT, not from the `onMessage` callback,
and `fakeRemote` has no `pushMessage` at all — its only push is `pushEvent`. So EVERY frame in this test,
the first three included, must be delivered the way the neighbouring tests already do it
(`test/tui/chat.test.tsx:321`):

```tsx
const deliver = (m: unknown) => { onMessage(m); fake.pushEvent({ kind: "message", data: m }); };
```

`onMessage` alone feeds the transcript but never the task store, so a test written against it would sit on
an empty panel and prove nothing about the ladder. Hold a reference to `onMessage` so the nested trio can be
delivered the same way after the first `waitFor` observes the subject rung.

**The negatives MUST be scoped to the spinner's own line, not the whole frame.** `TaskPanel.tsx:57` draws
an in-progress task's `activeForm` followed by the same ellipsis (`{activity}{ELLIPSIS}`), so the nested
task's label appears in the frame no matter what the spinner does — a whole-frame `not.toContain` would fail
against CORRECT code and read as a ladder defect. Scoping is also what makes the test non-vacuous in both
directions at once: the panel showing the nested task proves it reached the store, while the spinner's line
proves the ladder refused it. Add a helper that isolates the spinner row by its glyph and take the LAST match
(`render.ts`'s collapsed-thinking placeholder can sit above it in the transcript).

- [ ] **Step 3: Run both and watch them fail**

Run: `cd harness && npx vitest run test/tui/spinner.test.ts test/tui/chat.test.tsx -t "spinnerMessage|activeSpinnerTask|retitles"`
Expected: FAIL — `spinnerMessage` is not exported and the spinner shows a random verb.

- [ ] **Step 4: Implement**

Append to `src/tui/spinner.ts`:

```ts
// ── The message ladder (canon L508022) ───────────────────────────────────────────────────────────────

import type { TaskItem } from "./taskList.js";

export interface SpinnerMessageInput {
  /** canon's `a` — an explicit override; nothing sets one yet, and the rung stays so something can. */
  overrideMessage?: string;
  activeTask?: { activeForm?: string; subject?: string };
  /** canon's `y`, the store's `defaultVerb`. */
  defaultVerb?: string;
  /** canon's `ee`, drawn once per turn. */
  randomVerb: string;
}

const rung = (s: string | undefined): string | undefined => (s !== undefined && s.trim() !== "" ? s : undefined);

/** `J = (a ?? W?.activeForm ?? W?.subject ?? (y || ee))` (L508022). The `subject` rung is why this ladder
 *  fires at all on our wire: `activeForm` is optional in the tool schema and a real run was observed
 *  sending `TaskCreate {subject, description}` with no `activeForm` (taskList.ts's header). */
export function spinnerMessage(input: SpinnerMessageInput): string {
  return rung(input.overrideMessage) ?? rung(input.activeTask?.activeForm) ?? rung(input.activeTask?.subject)
    ?? rung(input.defaultVerb) ?? input.randomVerb;
}

/** canon's `W`, with canon's `B` gate folded in as a provenance filter — see taskList.ts's `subagent`. */
export function activeSpinnerTask(tasks: readonly TaskItem[]): TaskItem | undefined {
  return tasks.find((t) => t.subagent !== true && t.status !== "pending" && t.status !== "completed");
}
```

In `TurnSpinner.tsx` add `tasks = []` to the props (`tasks?: readonly TaskItem[]`) and replace the
gerund:

```tsx
  const gerund = `${spinnerMessage({ activeTask: activeSpinnerTask(tasks), randomVerb: verbRef.current! })}…`;
```

In `ChatApp.tsx`, add `tasks={state.tasks}` to the `<TurnSpinner …>` mount.

- [ ] **Step 5: Verify and commit**

Run: `cd harness && npm run test:tui && npm run typecheck`

```bash
git add harness/src/tui harness/test/tui
git commit -m "f5(f8): T5 — the four-rung message ladder, proved through TaskList to the painted frame"
```

---

## Task 6: Reduced motion, end to end

**Files:**
- Create: `src/tui/motion.ts`
- Modify: `src/tui/renderer.ts`, `src/tui/prefs.ts`, `src/tui/settingsRows.ts`,
  `src/tui/SettingsDialog.tsx`, `src/tui/useChat.ts`, `src/tui/ChatApp.tsx`, `src/tui/chatMain.tsx`,
  `src/tui/RetryRow.tsx`, `src/tui/terminalTitle.ts`
- Test: `test/tui/motion.test.ts` (create), `test/tui/settingsRows.test.ts`,
  `test/tui/settings-dialog.test.tsx`, `test/unit/terminal-title.test.ts`, `test/tui/components.test.tsx`,
  `test/tui/compaction-row.test.tsx`, `test/unit/renderer-select.test.ts`

**Interfaces:**
- Consumes: the `reducedMotion` props added in Task 3.
- Produces: `screenReaderEnabled(env)` from `renderer.ts`, `reducedMotion(prefs, env?)` from `motion.ts`,
  `CcxPrefs.prefersReducedMotion?: boolean`, `SettingsRowCtx.reduceMotion: boolean`,
  `TerminalTitleDeps.reducedMotion?: boolean`.

**This is one task because a settings row is not a deliverable until it does something.** A row with no
apply branch, no hook state, no setter and no persistence is inert; a resolver read once at startup
cannot respond to a toggle. Both halves land together or neither is testable.

**The eight touch points a boolean preference has in this codebase** — transcribed from `showTurnDuration`,
which is the closest existing analogue:

| # | File | What |
|---|---|---|
| 1 | `prefs.ts` | the `CcxPrefs` field + loader validation |
| 2 | `useChat.ts:691` | `useState`, seeded from `opts.initialPrefersReducedMotion` |
| 3 | `useChat.ts:2478` | the setter: set state, then `savePrefsFn({ … }, historyEnv)` |
| 4 | `useChat.ts:2132` | the `/config` result switch arm |
| 5 | `useChat.ts:590` | the `SettingsRowCtx` snapshot |
| 6 | `SettingsDialog.tsx:320/330/372/421` | prop, prop type, ctx construction, apply branch |
| 7 | `ChatApp.tsx:1477` | thread state + setter into `SettingsDialog` |
| 8 | `chatMain.tsx` | seed `initialPrefersReducedMotion` from loaded prefs |
| 9 | `useChat.ts` `ChatState` | publish it: the interface field AND the returned state object |

Touch point 9 is easy to miss and the table used to omit it: `ChatApp` reads `state.prefersReducedMotion`,
so the value has to leave `useChat` the way `showTurnDuration` does — declared on the `ChatState` interface
and included in the object the hook returns. A `useState` that never reaches `ChatState` typechecks inside
the hook and fails only at the call site.

- [ ] **Step 1: Write the failing tests**

Create `test/tui/motion.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { reducedMotion } from "../../src/tui/motion.js";
import { screenReaderEnabled } from "../../src/tui/renderer.js";

describe("screenReaderEnabled", () => {
  it("reads CLAUDE_AX_SCREEN_READER and nothing else", () => {
    expect(screenReaderEnabled({ CLAUDE_AX_SCREEN_READER: "1" } as NodeJS.ProcessEnv)).toBe(true);
    expect(screenReaderEnabled({ CLAUDE_AX_SCREEN_READER: "0" } as NodeJS.ProcessEnv)).toBe(false);
    expect(screenReaderEnabled({} as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe("reducedMotion", () => {
  it("is the setting OR the screen-reader signal — canon's hx(...) || hl()", () => {
    expect(reducedMotion({ prefersReducedMotion: true }, {} as NodeJS.ProcessEnv)).toBe(true);
    expect(reducedMotion({}, { CLAUDE_AX_SCREEN_READER: "1" } as NodeJS.ProcessEnv)).toBe(true);
    expect(reducedMotion({}, {} as NodeJS.ProcessEnv)).toBe(false);
  });
});
```

Add to `test/unit/terminal-title.test.ts`:

```ts
it("does not alternate the busy prefix under reduced motion", () => {
  const writes: string[] = [];
  let fire: (() => void) | undefined;
  const title = createTerminalTitle({
    write: (s) => writes.push(s), reducedMotion: true,
    setInterval: (fn) => { fire = fn; return 1; }, clearInterval: () => {},
  });
  title.setTitle("work"); title.setBusy(true);
  expect(fire).toBeUndefined();                        // no animation timer armed at all
  expect(writes.at(-1)).toBe("\x1b]0;✳ work\x07");     // the IDLE prefix, held
});
```

Add to `test/tui/components.test.tsx` — **all four consumers, and both arms of the resolver**:

```tsx
it("freezes the spinner glyph under reduced motion, by setting or by screen reader", () => {
  const bySetting = render(<TurnSpinner startedAt={1000} verb="Baking" reducedMotion now={() => 2000} />);
  expect(bySetting.lastFrame()).toContain("· Baking…");
  // the screen-reader arm arrives as the same prop, resolved one level up — pinned here so the
  // component contract is explicit even though the resolver is what maps the env onto it
  expect(reducedMotion({}, { CLAUDE_AX_SCREEN_READER: "1" } as NodeJS.ProcessEnv)).toBe(true);
});
```

Add to `test/tui/compaction-row.test.tsx`:

```tsx
it("freezes BOTH the glyph and the bar under reduced motion, even across a parent rerender", () => {
  let clock = 1000;
  const { lastFrame, rerender } = render(<CompactionRow startedAt={1000} columns={80} reducedMotion now={() => clock} />);
  const first = lastFrame();
  clock = 60_000;                                     // a minute of wall clock passes
  rerender(<CompactionRow startedAt={1000} columns={80} reducedMotion now={() => clock} />);
  expect(lastFrame()).toBe(first);                    // the bar must not have advanced either
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd harness && npx vitest run test/tui/motion.test.ts test/unit/terminal-title.test.ts test/tui/compaction-row.test.tsx`
Expected: FAIL — no `motion.js`, no `screenReaderEnabled`, no `reducedMotion` dep on the title.

- [ ] **Step 3: Extract the predicate and write the resolver**

In `renderer.ts`, above `selectRenderer`:

```ts
/** The screen-reader rung as a predicate rather than an inline test, because F8's banner and its motion
 *  resolver need the same verdict and `choice.reason === "screen_reader"` is not it — that is true only
 *  when this rung WINS, and is silently false under a non-TTY. Env-only, per divergence 4 above. */
export function screenReaderEnabled(env: NodeJS.ProcessEnv): boolean { return envBool(env.CLAUDE_AX_SCREEN_READER) === true; }
```

and replace the rung with `if (screenReaderEnabled(env)) return { mode: "classic", reason: "screen_reader" };`.

Create `src/tui/motion.ts`:

```ts
// tui/src/motion.ts — F8 Task 6: one resolver for "should anything be animating right now".
//
// It is NOT the setting alone. Canon's value is `hx(S.prefersReducedMotion) || hl()` (L507998) — the
// persisted preference OR the screen-reader signal. Threading only the preference leaves a screen-reader
// user with a spinning glyph, an animating retry row and a braille-alternating tab title: precisely the
// population the behaviour exists for. Canon performs no operating-system query anywhere, so neither do
// we — `prefersReducedMotion` is a setting and `CLAUDE_AX_SCREEN_READER` is an env var, and that is all.
import type { CcxPrefs } from "./prefs.js";
import { screenReaderEnabled } from "./renderer.js";

export function reducedMotion(prefs: Pick<CcxPrefs, "prefersReducedMotion">, env: NodeJS.ProcessEnv = process.env): boolean {
  return prefs.prefersReducedMotion === true || screenReaderEnabled(env);
}
```

- [ ] **Step 4: Walk all eight touch points**

1. `prefs.ts`: add `prefersReducedMotion?: boolean;` to `CcxPrefs`. Do NOT add loader validation — the
   loader validates only `theme`, `model` and `tui`, and NO boolean field is validated there, so "handle it
   like the other booleans" means adding nothing. That is also correct rather than merely consistent: those
   three are validated because a bad value reaches a lookup or a ladder rung that has no case for it, while
   every boolean is read through an explicit `=== true`, which makes any hand-edited garbage safely falsy.
2. `useChat.ts` beside line 691: `const [prefersReducedMotion, setPrefersReducedMotionState] = useState<boolean>(opts.initialPrefersReducedMotion ?? false);`
3. `useChat.ts` beside line 2478:
   ```ts
   function setPrefersReducedMotion(next: boolean): void {
     if (disposed.current) return;
     setPrefersReducedMotionState(next);
     try { savePrefsFn({ prefersReducedMotion: next }, historyEnv); } catch { /* best-effort */ }
   }
   ```
4. `useChat.ts` beside line 2132: `case "reduceMotion": setPrefersReducedMotion(result.value !== "false"); break;`
5. `useChat.ts:590`: add `reduceMotion: prefersReducedMotion` to the `SettingsRowCtx` snapshot.
6. `SettingsDialog.tsx`: add `reduceMotion: boolean` and `setReduceMotion: (v: boolean) => void` to the
   props and their type; add `reduceMotion` to the ctx at line 372; add the apply branch beside line 421:
   `else if (row.id === "reduceMotion") setReduceMotion(row.value !== "true");`
7. `ChatApp.tsx:1477`: `reduceMotion={state.prefersReducedMotion} setReduceMotion={setPrefersReducedMotion}`
8. `chatMain.tsx`: `initialPrefersReducedMotion: prefs.prefersReducedMotion ?? false`

Then `settingsRows.ts`: widen the `id` union with `| "reduceMotion"`, add `reduceMotion: boolean` to
`SettingsRowCtx`, and insert the row after `showTurnDuration`:

```ts
    { id: "reduceMotion", label: "Reduce motion", type: "boolean", value: String(ctx.reduceMotion) },
```

- [ ] **Step 5: Wire the live value to all four consumers**

In `terminalTitle.ts`: add `reducedMotion?: boolean;` to `TerminalTitleDeps`; in `emit`, the prefix
becomes `busy && deps.reducedMotion !== true ? BUSY_FRAMES[…] : IDLE_PREFIX`; in `setBusy`, arm the
interval only when `next && deps.reducedMotion !== true`.

In `RetryRow.tsx`: add `reducedMotion = false` to the props and replace its `setInterval` with
`useAnimationClock(reducedMotion ? null : 120, startedAt, now)`, keeping its countdown arithmetic.

In `ChatApp.tsx`, compute the live value once and pass it to all three components at the mount site
around line 1585:

```tsx
  const motionReduced = state.prefersReducedMotion || screenReaderEnabled(process.env);
```

**Read live, not at startup**: a `/config` toggle must take effect on the next frame, which it cannot do
if the value was resolved once in `chatMain`. `chatMain` still passes `reducedMotion` into
`createTerminalTitle` — that one is a long-lived object rather than a rendered component, so it takes the
startup value and a mid-session toggle reaches it on the next relaunch. Record that asymmetry in the
task report; do not silently widen the title's interface to fix it.

- [ ] **Step 6: Verify and commit**

Run: `cd harness && npm run test:unit && npm run test:tui && npm run typecheck`
Expected: all PASS. `renderer-select` must be unchanged.

```bash
git add harness/src harness/test
git commit -m "f5(f8): T6 — reduced motion, all eight touch points and all four animations"
```

---

## Task 7: The banner's degraded branch

**Files:**
- Modify: `src/tui/banner.ts`, `src/cli/main.ts`
- Test: `test/tui/banner.test.ts`

**Interfaces:**
- Consumes: `screenReaderEnabled` (Task 6).
- Produces: `BANNER_MIN_ROWS = 30`; `BannerInfo` gains `rows?: number`, `screenReader?: boolean`.

- [ ] **Step 1: Write the failing test — assert the SEGMENTS, not just the text**

```ts
it("degrades to ONE two-span line below 30 rows", () => {
  const lines = welcomeBanner({ cwd: "/tmp/x", model: "opus", rows: 24 });
  expect(lines).toHaveLength(1);
  expect(lines[0]!.text).toBe(`✻ Welcome to Claude Code ccx v${CCX_VERSION}`);
  // A5: the title is accent, the version suffix is dim. A uniformly-accent line is the defect.
  expect(lines[0]!.segments).toEqual([
    { text: "✻ Welcome to Claude Code", color: ACCENT },
    { text: ` ccx v${CCX_VERSION}`, dim: true },
  ]);
});

it("degrades for a screen reader at any height", () => {
  expect(welcomeBanner({ cwd: "/tmp/x", rows: 200, screenReader: true })).toHaveLength(1);
});

it("renders the full box at exactly 30 rows, and when rows is unknown", () => {
  expect(welcomeBanner({ cwd: "/tmp/x", rows: 30 })[0]!.text.startsWith("╭")).toBe(true);
  expect(welcomeBanner({ cwd: "/tmp/x" }).length).toBeGreaterThan(1);
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd harness && npx vitest run test/tui/banner.test.ts`

- [ ] **Step 3: Implement**

Add to `BannerInfo`:

```ts
  /** Terminal height at seed time. Absent = unknown, which renders the FULL form: a banner that hid
   *  itself because nobody measured would be worse than one row too many. */
  rows?: number;
  /** `renderer.screenReaderEnabled(env)`, resolved by the caller so one verdict serves both consumers. */
  screenReader?: boolean;
```

Add `export const BANNER_MIN_ROWS = 30;` beside `BANNER_COMPACT_COLUMNS`, and at the top of
`welcomeBanner`:

```ts
  // canon `Gqe`'s first branch (L500758): `if (o7O || i7O < dKm)` — a screen reader, or a terminal too
  // short for the box. TWO SPANS, as canon's is: the greeting coloured and the version dim. Ours carries
  // ccx's own `✻` where canon opens on the bare words, so the degraded form and the full form (whose
  // title line is `✻ Welcome to Claude Code`) agree with each other (spec D-F8-12).
  if (info.screenReader === true || (info.rows !== undefined && info.rows < BANNER_MIN_ROWS)) {
    const head = "✻ Welcome to Claude Code", tail = ` ccx v${info.version ?? CCX_VERSION}`;
    return [{ text: head + tail, segments: [{ text: head, color: ACCENT }, { text: tail, dim: true }] }];
  }
```

- [ ] **Step 4: Feed it from the launch site**

At `src/cli/main.ts`'s `welcomeBanner({…})` call, add:

```ts
              rows: process.stdout.rows, screenReader: screenReaderEnabled(process.env),
```

importing `screenReaderEnabled` from `../tui/renderer.js`.

- [ ] **Step 5: Prove the CALL SITE passes them — the banner tests above cannot**

Every test in Step 1 hands `rows`/`screenReader` to `welcomeBanner` directly, so all of them stay green if
Step 4 is never done and the launch site passes neither. That is the Global Constraint's wiring case, and
this file already has the harness for it: `test/unit/cli-main.test.ts:443-461` tests the banner's CALL SITE
rather than the function, written after a bug where `welcomeBanner` was correct and the call site handed it
the wrong thing. Its shape:

```ts
const clientCalls: any[] = [];
const fakeHost = { start: async () => {}, stop: async () => {} } as any;
await captureLog(() => main(["task"], deps({
  isTTY: () => true, makeHost: () => fakeHost, runChatClient: async (o) => { clientCalls.push(o); },
})));
const text = bannerText(clientCalls[0]);          // helper at :449
```

Add a case there that stubs the screen-reader env (`vi.stubEnv("CLAUDE_AX_SCREEN_READER", "1")`) and asserts
the banner comes back as the ONE-line degraded form. The env arm is the cheap one to drive; if `rows` can be
injected through `deps` as cleanly, pin that arm too, and if it cannot, say so in your report rather than
reaching into `process.stdout`.

**Confirm by sabotage:** delete `screenReader: screenReaderEnabled(process.env)` from the call site, watch
this new test fail, restore it. Report the result.

- [ ] **Step 6: Verify and commit**

Run: `cd harness && npx vitest run test/tui/banner.test.ts test/unit/cli-main.test.ts && npm run typecheck`

```bash
git add harness/src/tui/banner.ts harness/src/cli/main.ts harness/test/tui/banner.test.ts harness/test/unit/cli-main.test.ts
git commit -m "f5(f8): T7 — the banner degrades below 30 rows and for screen readers, in canon's two spans"
```

---

## Task 8: Tips as a completion checklist

**Files:**
- Modify: `src/tui/banner.ts`, `src/cli/main.ts`
- Test: `test/tui/banner.test.ts`

**Interfaces:**
- Produces: `Tip`, `startupTips(facts)`, `renderTips(tips, inHomeDir)`.

ccx's three static tips are replaced by canon's two-entry conditional pair (L384137) — spec D-F8-7, the
wave's only content deletion.

- [ ] **Step 1: Write the failing test**

```ts
describe("startupTips", () => {
  it("offers the workspace tip in an empty directory and the init tip otherwise", () => {
    expect(startupTips({ emptyWorkspace: true, hasClaudeMd: false }).filter((t) => t.isEnabled).map((t) => t.key)).toEqual(["workspace"]);
    expect(startupTips({ emptyWorkspace: false, hasClaudeMd: false }).filter((t) => t.isEnabled).map((t) => t.key)).toEqual(["claudemd"]);
  });
  it("completes the init tip once a CLAUDE.md exists, and never completes the workspace tip", () => {
    expect(startupTips({ emptyWorkspace: false, hasClaudeMd: true }).find((t) => t.key === "claudemd")!.isComplete).toBe(true);
    expect(startupTips({ emptyWorkspace: true, hasClaudeMd: true }).find((t) => t.key === "workspace")!.isComplete).toBe(false);
  });
});

describe("renderTips", () => {
  const tips = [
    { key: "done", text: "Finished thing", isEnabled: true, isComplete: true },
    { key: "todo", text: "Unfinished thing", isEnabled: true, isComplete: false },
    { key: "off", text: "Hidden thing", isEnabled: false, isComplete: false },
  ];
  it("drops disabled tips, sorts incomplete first, ticks the complete", () => {
    expect(renderTips(tips, false).map((l) => l.text)).toEqual(["  Unfinished thing", "  ✔ Finished thing"]);
  });
  it("appends the home-directory note last", () => {
    expect(renderTips(tips, true).at(-1)!.text).toContain("home directory");
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd harness && npx vitest run test/tui/banner.test.ts -t "Tips|renderTips|startupTips"`

- [ ] **Step 3: Implement**

```ts
/** canon's tip inventory (L384137) — TWO entries, mutually exclusive on whether this is a fresh
 *  workspace, and both completable. ccx's previous three static tips are gone (spec D-F8-7): a checklist
 *  whose entries can never complete is a checklist in shape only, and the affordances they named stay
 *  reachable from `? for shortcuts`. */
export interface Tip { key: string; text: string; isEnabled: boolean; isComplete: boolean }

export function startupTips(facts: { emptyWorkspace: boolean; hasClaudeMd: boolean }): Tip[] {
  return [
    { key: "workspace", text: "Ask Claude to create a new app or clone a repository", isComplete: false, isEnabled: facts.emptyWorkspace },
    { key: "claudemd", text: "Run /init to create a CLAUDE.md file with instructions for Claude", isComplete: facts.hasClaudeMd, isEnabled: !facts.emptyWorkspace },
  ];
}

/** canon's `Enc` (L559386): enabled only, incomplete first, `✔ ` on the complete, home-dir note last.
 *  The sort key is `Number(isComplete)` and `Array.sort` is stable, so same-state tips keep their order. */
export function renderTips(tips: readonly Tip[], inHomeDir: boolean): RenderLine[] {
  const rows = tips.filter((t) => t.isEnabled).slice()
    .sort((a, b) => Number(a.isComplete) - Number(b.isComplete))
    .map((t) => ({ text: `  ${t.isComplete ? "✔ " : ""}${t.text}`, dim: true }));
  if (inHomeDir) rows.push({ text: "  Note: You have launched ccx in your home directory. For the best experience, launch it in a project directory.", dim: true });
  return rows;
}
```

Replace the three literal tip lines in `welcomeBanner`'s `out` array with:

```ts
    { text: "  Tips for getting started" },
    ...renderTips(startupTips({ emptyWorkspace: info.emptyWorkspace === true, hasClaudeMd: info.hasClaudeMd === true }), info.inHomeDir === true),
```

adding `emptyWorkspace?: boolean; hasClaudeMd?: boolean; inHomeDir?: boolean;` to `BannerInfo`.

- [ ] **Step 4: Feed the three facts**

In `src/cli/main.ts`, beside Task 7's additions:

```ts
              emptyWorkspace: readdirSync(cwd).filter((n) => !n.startsWith(".")).length === 0,
              hasClaudeMd: existsSync(join(cwd, "CLAUDE.md")),
              inHomeDir: cwd === homedir(),
```

importing `readdirSync`/`existsSync` from `node:fs`, `join` from `node:path`, `homedir` from `node:os`.

- [ ] **Step 5: Verify and commit**

Run: `cd harness && npx vitest run test/tui/banner.test.ts && npm run typecheck`

```bash
git add harness/src/tui/banner.ts harness/src/cli/main.ts harness/test/tui/banner.test.ts
git commit -m "f5(f8): T8 — tips become canon's two-entry completion checklist"
```

---

## Task 9: The `auto` theme resolves from the environment

**Files:**
- Modify: `src/tui/theme.ts`
- Test: `test/tui/theme.test.ts`

**Interfaces:**
- Produces: `detectTerminalBackground(env?)`, `resolveThemeId(id, env?)`.

- [ ] **Step 1: Write the failing test**

```ts
describe("detectTerminalBackground", () => {
  const e = (COLORFGBG?: string) => ({ ...(COLORFGBG !== undefined ? { COLORFGBG } : {}) }) as NodeJS.ProcessEnv;
  it("reads the LAST field and maps 0-6 and 8 to dark", () => {
    expect(detectTerminalBackground(e("15;0"))).toBe("dark");
    expect(detectTerminalBackground(e("15;6"))).toBe("dark");
    expect(detectTerminalBackground(e("15;8"))).toBe("dark");
    expect(detectTerminalBackground(e("0;15"))).toBe("light");
    expect(detectTerminalBackground(e("0;7"))).toBe("light");
  });
  it("returns undefined for absent, empty, non-integer or out-of-range values", () => {
    for (const v of [undefined, "", "0;", "0;banana", "0;16", "0;-1", "0;7.5"]) expect(detectTerminalBackground(e(v))).toBeUndefined();
  });
});

describe("resolveThemeId", () => {
  it("maps auto onto the detected background, defaulting to dark", () => {
    expect(resolveThemeId("auto", { COLORFGBG: "0;15" } as NodeJS.ProcessEnv)).toBe("light");
    expect(resolveThemeId("auto", { COLORFGBG: "15;0" } as NodeJS.ProcessEnv)).toBe("dark");
    expect(resolveThemeId("auto", {} as NodeJS.ProcessEnv)).toBe("dark");
  });
  it("leaves an explicit theme alone", () => {
    expect(resolveThemeId("light", { COLORFGBG: "15;0" } as NodeJS.ProcessEnv)).toBe("light");
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd harness && npx vitest run test/tui/theme.test.ts`

- [ ] **Step 3: Implement**

Above `let current: ThemeId = "auto";`:

```ts
/** canon's `eTp` (L188328): the LAST `;`-separated field of COLORFGBG, an integer 0-15, where 0-6 and 8
 *  are dark. A pure env read — no terminal round trip, nothing to await, nothing to parse off the tty.
 *  (The OSC 11 query tier canon also has is deferred whole — spec § 5.) */
export function detectTerminalBackground(env: NodeJS.ProcessEnv = process.env): "dark" | "light" | undefined {
  const raw = env.COLORFGBG;
  if (!raw) return undefined;
  const last = raw.split(";").at(-1);
  if (last === undefined || last === "") return undefined;
  const n = Number(last);
  if (!Number.isInteger(n) || n < 0 || n > 15) return undefined;
  return n <= 6 || n === 8 ? "dark" : "light";
}

/** `auto` stops being a static alias of dark. Everything else passes through. The fallback IS dark —
 *  exactly what `auto` resolved to before this wave — so a terminal that reports nothing sees no change. */
export function resolveThemeId(id: ThemeId, env: NodeJS.ProcessEnv = process.env): ThemeId {
  return id === "auto" ? (detectTerminalBackground(env) === "light" ? "light" : "dark") : id;
}
```

Route the four `current`-keyed reads through it:

```ts
export function themeTokens(): ThemeTokens { return THEMES[resolveThemeId(current)]; }
export function subagentTokens(): SubagentTokens { return SUBAGENT_THEMES[resolveThemeId(current)]; }
export function setTheme(id: ThemeId): void { current = id; ACCENT = resolveThemeColor(THEMES[resolveThemeId(id)].claude); generation++; }
export const isLightTheme = (id: ThemeId) => resolveThemeId(id).startsWith("light");
```

and seed `ACCENT` at module load with `resolveThemeColor(THEMES[resolveThemeId("auto")].claude)`.

- [ ] **Step 4: Verify and commit**

Run: `cd harness && npm run test:tui && npm run typecheck`
Expected: PASS. The full tui suite matters — `themeTokens()` has many consumers, and a machine with a
light `COLORFGBG` would otherwise flip colours under test. If a suite proves environment-sensitive, pin
`COLORFGBG` in that test rather than weakening the resolver.

```bash
git add harness/src/tui/theme.ts harness/test/tui/theme.test.ts
git commit -m "f5(f8): T9 — auto theme resolves from COLORFGBG instead of aliasing dark"
```

---

## Task 10: The desktop notifier

**Files:**
- Create: `src/tui/desktopNotify.ts`
- Test: `test/tui/desktopNotify.test.ts`

**Interfaces:**
- Consumes: Task 1's builders.
- Produces: `NotifChannel`, `NotifEvent`, `NOTIF_DEFAULT_EVENTS`, `NOTIF_TITLE`, `NotifSettings`,
  `resolveChannel(configured, env?)`, `createDesktopNotifier(deps)`.

- [ ] **Step 1: Measure, before writing the resolver**

**This step produces knowledge, not code, and it exists because the design depends on an external fact.**
`resolveTerminalName` cannot be reused here: `renderer.ts` records that tmux ≥ 3.2 stamps
`TERM_PROGRAM=tmux`, so inside tmux it answers `"tmux"`, `auto` resolves to `none`, and no notification
is ever delivered in the environment this project is used and tested in.

Run, and paste the output into the task report:

```bash
env | grep -iE '^(TERM|TERM_PROGRAM|TERM_PROGRAM_VERSION|LC_TERMINAL|LC_TERMINAL_VERSION|KITTY_|GHOSTTY_|ITERM_|COLORTERM|TMUX|STY)' | sed 's/=.*/=<set>/' | sort
tmux new-session -d -s f8probe 'env > /tmp/f8-tmux-env.txt; sleep 2' && sleep 3 && grep -iE '^(TERM|TERM_PROGRAM|LC_TERMINAL|KITTY_|GHOSTTY_)' /tmp/f8-tmux-env.txt | sed 's/=.*/=<set>/' | sort; tmux kill-session -t f8probe
```

Record which markers survive into the tmux pane and which do not. Write the marker table into the task
report and into the spec's § 8. **Kill only the `f8probe` session by name — never `tmux kill-server`.**

The markers this resolver looks for, in order, are then written **against what was observed**. Where the
observation is inconclusive for a terminal not installed on this machine, say so in the report and leave
that terminal's marker to the owner's manual pass (acceptance A11), which exercises the real thing.

- [ ] **Step 2: Write the failing test — an EXACT byte matrix across three environments**

Create `test/tui/desktopNotify.test.ts`. Every assertion is full-string equality; `startsWith` and
`contains` would pass on an emitter that dropped its passthrough or emitted extra bytes.

```ts
import { describe, expect, it } from "vitest";
import { createDesktopNotifier, resolveChannel, NOTIF_DEFAULT_EVENTS, type NotifChannel, type NotifEvent } from "../../src/tui/desktopNotify.js";

const E = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;
function fire(env: NodeJS.ProcessEnv, channel: NotifChannel = "auto", events: readonly NotifEvent[] = NOTIF_DEFAULT_EVENTS): string[] {
  const writes: string[] = [];
  createDesktopNotifier({ write: (s) => writes.push(s), env, settings: () => ({ preferredNotifChannel: channel, enabledEvents: events }) })
    .notify("idle_prompt", "hi");
  return writes;
}
const TMUX = { TMUX: "/tmp/s,1,0" }, STY = { STY: "1.pts-0" };
const wrapT = (s: string) => `\x1bPtmux;${s.replaceAll("\x1b", "\x1b\x1b")}\x1b\\`;
const wrapS = (s: string) => `\x1bP${s.replaceAll("\x1b", "\x1b\x1b")}\x1b\\`;

describe("exact bytes, every channel × bare/TMUX/STY", () => {
  const iterm = "\x1b]9;ccx: hi\x07";
  it("iterm2", () => {
    expect(fire(E({ TERM_PROGRAM: "iTerm.app" }), "iterm2")).toEqual([iterm]);
    expect(fire(E({ TERM_PROGRAM: "iTerm.app", ...TMUX }), "iterm2")).toEqual([wrapT(iterm)]);
    expect(fire(E({ TERM_PROGRAM: "iTerm.app", ...STY }), "iterm2")).toEqual([wrapS(iterm)]);
  });
  it("ghostty", () => {
    const g = "\x1b]777;notify;ccx;hi\x07";
    expect(fire(E({ TERM: "xterm-ghostty" }), "ghostty")).toEqual([g]);
    expect(fire(E({ TERM: "xterm-ghostty", ...TMUX }), "ghostty")).toEqual([wrapT(g)]);
    expect(fire(E({ TERM: "xterm-ghostty", ...STY }), "ghostty")).toEqual([wrapS(g)]);
  });
  it("kitty writes three ST-terminated parts sharing one id, wrapped in both muxes", () => {
    const bare = fire(E({ TERM: "xterm-kitty" }), "kitty");
    const id = bare[0]!.match(/i=([^:]+):/)![1]!;
    const parts = [`\x1b]99;i=${id}:d=0:p=title;ccx\x1b\\`, `\x1b]99;i=${id}:p=body;hi\x1b\\`, `\x1b]99;i=${id}:d=1:a=focus;\x1b\\`];
    expect(bare).toEqual(parts);
    const muxed = fire(E({ TERM: "xterm-kitty", ...TMUX }), "kitty");
    const mid = muxed[0]!.match(/i=([^:]+):/)![1]!;
    expect(muxed).toEqual([`\x1b]99;i=${mid}:d=0:p=title;ccx\x1b\\`, `\x1b]99;i=${mid}:p=body;hi\x1b\\`, `\x1b]99;i=${mid}:d=1:a=focus;\x1b\\`].map(wrapT));
  });
  it("terminal_bell is a BARE byte in every environment", () => {
    for (const extra of [{}, TMUX, STY]) expect(fire(E({ TERM_PROGRAM: "Apple_Terminal", ...extra }), "terminal_bell")).toEqual(["\x07"]);
  });
  it("iterm2_with_bell wraps the OSC half only", () => {
    expect(fire(E({ TERM_PROGRAM: "iTerm.app", ...TMUX }), "iterm2_with_bell")).toEqual([wrapT(iterm), "\x07"]);
  });
  it("an unresolved terminal writes nothing at all", () => {
    expect(fire(E({ TERM_PROGRAM: "WezTerm" }))).toEqual([]);
    expect(fire(E({ TERM_PROGRAM: "iTerm.app" }), "notifications_disabled")).toEqual([]);
  });
});

describe("auto resolution survives a multiplexer", () => {
  it("does NOT trust TERM_PROGRAM inside tmux — it reads the surviving marker instead", () => {
    // tmux >= 3.2 stamps TERM_PROGRAM=tmux over the outer terminal's value (renderer.ts records this).
    // Using the marker recorded in Step 1, auto must still reach the real emulator.
    expect(resolveChannel("auto", E({ TERM_PROGRAM: "tmux", ...TMUX, LC_TERMINAL: "iTerm2" }))).toBe("iterm2");
    expect(resolveChannel("auto", E({ TERM_PROGRAM: "tmux", ...TMUX, KITTY_WINDOW_ID: "1" }))).toBe("kitty");
    expect(resolveChannel("auto", E({ TERM_PROGRAM: "tmux", ...TMUX }))).toBe("none");
  });
  it("outside a multiplexer TERM_PROGRAM is trustworthy", () => {
    expect(resolveChannel("auto", E({ TERM_PROGRAM: "iTerm.app" }))).toBe("iterm2");
    expect(resolveChannel("auto", E({ TERM: "xterm-ghostty" }))).toBe("ghostty");
    expect(resolveChannel("auto", E({ TERM_PROGRAM: "Apple_Terminal" }))).toBe("terminal_bell");
  });
});

describe("policy", () => {
  it("delivers the two blocking events by default and drops the rest", () => {
    const seen: NotifEvent[] = [];
    const n = createDesktopNotifier({
      write: () => seen.push("idle_prompt"), env: E({ TERM_PROGRAM: "iTerm.app" }),
      settings: () => ({ preferredNotifChannel: "auto", enabledEvents: NOTIF_DEFAULT_EVENTS }),
    });
    for (const e of ["permission_prompt", "idle_prompt", "agent_completed", "agent_needs_input"] as NotifEvent[]) n.notify(e, "x");
    expect(seen).toHaveLength(2);
  });
  it("delivers an opted-in event", () => {
    expect(fire(E({ TERM_PROGRAM: "iTerm.app" }), "auto", ["idle_prompt", "agent_completed"])).toHaveLength(1);
  });
  it("sanitizes every dynamic part", () => {
    const writes: string[] = [];
    createDesktopNotifier({ write: (s) => writes.push(s), env: E({ TERM_PROGRAM: "iTerm.app" }), settings: () => ({ preferredNotifChannel: "auto", enabledEvents: NOTIF_DEFAULT_EVENTS }) })
      .notify("idle_prompt", "a\x1b[31mb\x07c\x7fd\x9be");
    expect(writes).toEqual(["\x1b]9;ccx: a [31mb c d e\x07"]);
  });
});
```

**If Step 1's measurement contradicts `LC_TERMINAL` / `KITTY_WINDOW_ID`, change these two assertions to
the markers that were actually observed** and say so in the report. The test is written against the
measurement, not the other way around.

- [ ] **Step 3: Run and watch it fail**

Run: `cd harness && npx vitest run test/tui/desktopNotify.test.ts`

- [ ] **Step 4: Implement**

Create `src/tui/desktopNotify.ts`:

```ts
// tui/src/desktopNotify.ts — F8 Task 10: OS-level notifications, per emulator.
//
// A SEPARATE PATH FROM `notifications.ts`, deliberately. That module is the in-terminal ephemeral hint
// queue with its own preemption, folding and pinning; this one hands a string to the terminal emulator
// and forgets it. Canon keeps them apart too (`lH`, L505865, touches no notification store).
//
// IT DOES NOT USE `resolveTerminalName`. That resolver reads TERM_PROGRAM before its TMUX fallback, and
// tmux >= 3.2 stamps `TERM_PROGRAM=tmux` over whatever the outer terminal set — a fact `renderer.ts`
// already records, in the note explaining why its own tmux heuristic is dead there. Reusing it would
// resolve `auto` to `none` in every tmux pane, so this wave's one new capability would ship dead in the
// environment the whole acceptance rig runs in. Inside a multiplexer we read the markers a terminal
// exports into the environment its shells inherit; outside one, TERM/TERM_PROGRAM are trustworthy.
//
// Canon: channels `Mie` (L45315), default `"auto"` (L100411), auto-resolution `u9T` (L505906), the four
// emitters in `are()` (L202527-202566), copy at L678604 / L686789.
import { BELL, OSC_GHOSTTY, OSC_ITERM2, OSC_KITTY, notifyTerminator, osc, passthrough, sanitizeNotificationText } from "./terminalEscapes.js";

/** `Mie` (L45315), verbatim. */
export type NotifChannel = "auto" | "iterm2" | "terminal_bell" | "iterm2_with_bell" | "kitty" | "ghostty" | "notifications_disabled";
/** The reachable subset of canon's `Yxu` — the events ccx can actually observe. */
export type NotifEvent = "permission_prompt" | "idle_prompt" | "agent_needs_input" | "agent_completed";
export type ResolvedChannel = "iterm2" | "iterm2_with_bell" | "kitty" | "ghostty" | "terminal_bell" | "none";

/** Every legal channel, for validating a hand-edited preference. */
export const NOTIF_CHANNELS: readonly NotifChannel[] = ["auto", "iterm2", "terminal_bell", "iterm2_with_bell", "kitty", "ghostty", "notifications_disabled"];
export const NOTIF_EVENTS: readonly NotifEvent[] = ["permission_prompt", "idle_prompt", "agent_needs_input", "agent_completed"];

/** DIVERGENCE FROM CANON (spec D-F8-5): canon's default fires every event; ccx defaults to the two that
 *  mean "ccx is blocked on you". Both others ship and are settable. */
export const NOTIF_DEFAULT_EVENTS: readonly NotifEvent[] = ["permission_prompt", "idle_prompt"];

/** ccx's identity, standing in for canon's `sJm = "Claude Code"` (L505957) — the terminal title's rule
 *  (spec D-C9): shape fidelity, not impersonation. */
export const NOTIF_TITLE = "ccx";

export interface NotifSettings { preferredNotifChannel: NotifChannel; enabledEvents: readonly NotifEvent[] }

/** The emulator underneath, multiplexer-aware. Marker order is set by Task 10 Step 1's measurement. */
function underlyingTerminal(env: NodeJS.ProcessEnv): string | undefined {
  const muxed = env.TMUX !== undefined || env.STY !== undefined || env.TERM_PROGRAM === "tmux" || env.TERM_PROGRAM === "screen";
  if (!muxed) {
    if (env.TERM === "xterm-ghostty" || env.GHOSTTY_RESOURCES_DIR !== undefined) return "ghostty";
    if (env.TERM?.includes("kitty") === true || env.KITTY_WINDOW_ID !== undefined) return "kitty";
    return env.TERM_PROGRAM;
  }
  // Inside a multiplexer TERM and TERM_PROGRAM belong to the multiplexer, not the emulator. These are
  // the variables a terminal exports into the environment its shells inherit, which tmux captures at
  // session creation. KNOWN LIMIT, accepted: a server started from terminal A and attached from B keeps
  // A's markers. The wrong emulator's escape is ignored by the right one, and `preferredNotifChannel`
  // overrides the sniff entirely — which is the escape hatch this limit is why we keep.
  if (env.GHOSTTY_RESOURCES_DIR !== undefined) return "ghostty";
  if (env.KITTY_WINDOW_ID !== undefined || env.KITTY_PID !== undefined) return "kitty";
  if (env.LC_TERMINAL === "iTerm2") return "iTerm.app";
  return undefined;
}

/** canon's `u9T` (L505906), over the resolver above.
 *
 *  RECORDED DIVERGENCE (spec D-F8-11): canon's Apple Terminal arm is asynchronous — `await p9T()`
 *  inspects the active Terminal profile and returns `no_method_available` when it says no. ccx resolves
 *  synchronously and always chooses the bell: one byte an unconfigured terminal ignores, versus a
 *  notification that silently never arrives. */
export function resolveChannel(configured: NotifChannel, env: NodeJS.ProcessEnv = process.env): ResolvedChannel {
  if (configured === "notifications_disabled") return "none";
  if (configured !== "auto") return configured;
  switch (underlyingTerminal(env)) {
    case "iTerm.app": return "iterm2";
    case "kitty": return "kitty";
    case "ghostty": return "ghostty";
    case "Apple_Terminal": return "terminal_bell";
    default: return "none";
  }
}

export interface DesktopNotifierDeps {
  /** Direct stdout, bypassing Ink — `terminalTitle`'s arrangement, for the same reason. */
  write(s: string): void;
  /** Read at CALL time, never captured: a `/config` change must take effect on the next event. */
  settings: () => NotifSettings;
  env?: NodeJS.ProcessEnv;
}

export interface DesktopNotifier { notify(event: NotifEvent, message: string, title?: string): void }

export function createDesktopNotifier(deps: DesktopNotifierDeps): DesktopNotifier {
  const env = deps.env ?? process.env;
  let seq = 0;
  return {
    notify(event, message, title = NOTIF_TITLE): void {
      const settings = deps.settings();
      if (!settings.enabledEvents.includes(event)) return;
      const channel = resolveChannel(settings.preferredNotifChannel, env);
      if (channel === "none") return;
      const t = sanitizeNotificationText(title), body = sanitizeNotificationText(message);
      const term = notifyTerminator(env);
      // COMPOSITION IS PER CHANNEL. The bell is a BARE byte: not an escape sequence, so there is nothing
      // for a multiplexer to pass through — and canon does not wrap it either, including the BEL half of
      // `iterm2_with_bell`.
      switch (channel) {
        case "iterm2": deps.write(passthrough(osc(term, OSC_ITERM2, `${t}: ${body}`), env)); return;
        case "iterm2_with_bell": deps.write(passthrough(osc(term, OSC_ITERM2, `${t}: ${body}`), env)); deps.write(BELL); return;
        case "kitty": {
          const id = `ccx-${seq++}`;
          deps.write(passthrough(osc("st", OSC_KITTY, `i=${id}:d=0:p=title`, t), env));
          deps.write(passthrough(osc("st", OSC_KITTY, `i=${id}:p=body`, body), env));
          deps.write(passthrough(osc("st", OSC_KITTY, `i=${id}:d=1:a=focus`, ""), env));
          return;
        }
        case "ghostty": deps.write(passthrough(osc(term, OSC_GHOSTTY, "notify", t, body), env)); return;
        case "terminal_bell": deps.write(BELL); return;
      }
    },
  };
}
```

- [ ] **Step 5: Verify and commit**

Run: `cd harness && npx vitest run test/tui/desktopNotify.test.ts && npm run typecheck`

```bash
git add harness/src/tui/desktopNotify.ts harness/test/tui/desktopNotify.test.ts
git commit -m "f5(f8): T10 — per-emulator notifications that survive tmux; the bell stays a bare byte"
```

---

## Task 11: Wire the notifier to its two real seams

**Files:**
- Modify: `src/tui/prefs.ts`, `src/tui/chatMain.tsx`, `src/tui/useChat.ts`
- Test: `test/tui/chat.test.tsx`, `test/tui/prefs.test.ts`

**Interfaces:**
- Consumes: Task 10's notifier.
- Produces: `CcxPrefs.preferredNotifChannel?: NotifChannel`, `CcxPrefs.notifEvents?: NotifEvent[]`;
  `useChat` deps gain `notifier?: DesktopNotifier`.

**Two seams, both already in this file, and neither is where the first draft of this plan pointed.**

- **Permission** is `pushPending(entry)` (`useChat.ts:1801`) — a single FIFO carrying **every** decision
  kind (`PendingEntry.kind: DecisionKind` covers permission, question, plan and elicitation). Notifying
  unconditionally there would announce a plan approval as a permission prompt.
- **Idle** is the settle path (`useChat.ts:1557`), gated on `queueRef.current.length === 0` — the same
  ref `drainNext` (`useChat.ts:2752`) reads, and the file's discipline is that the ref is written beside
  the state precisely because the state is a commit behind.

- [ ] **Step 1: Write the failing tests**

Add to `test/tui/chat.test.tsx`. The turn is held behind an explicit deferred so the queue state is
deterministic rather than racing a zero-delay timer:

```tsx
it("notifies on a permission prompt only, and on idle only with an empty queue (F8 A8)", async () => {
  const events: string[] = [];
  const notifier = { notify: (e: string) => events.push(e) };
  let release!: () => void;
  let fake: ReturnType<typeof fakeRemote>;
  let turns = 0;
  fake = fakeRemote({
    submit: async () => {
      const seq = ++turns;
      fake.pushEvent({ kind: "turn", phase: "start", seq });
      if (seq === 1) await new Promise<void>((r) => { release = r; });     // held open on purpose
      fake.pushEvent({ kind: "turn", phase: "end", seq });
      return { result: "done" };
    },
  });
  const { stdin, lastFrame } = render(
    <ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} deps={{ notifier }} />,
  );
  await waitFor(() => frame(lastFrame).includes("❯ "));

  stdin.write("first"); stdin.write("\r");
  await waitFor(() => frame(lastFrame).includes("esc to interrupt"));
  stdin.write("second"); await waitFor(() => frame(lastFrame).includes("second"));
  stdin.write("\r");
  await waitFor(() => isQueued(lastFrame, "second"));      // a turn runs with one prompt queued behind it

  release();                                               // turn 1 settles WITH the queue non-empty
  await waitFor(() => turns === 2);
  expect(events).not.toContain("idle_prompt");             // nobody is being waited on yet

  await waitFor(() => !frame(lastFrame).includes("esc to interrupt"));
  await waitFor(() => events.includes("idle_prompt"));     // turn 2 settles with an EMPTY queue
  expect(events.filter((e) => e === "idle_prompt")).toHaveLength(1);
});

it("notifies for a permission decision and for no other decision kind", async () => {
  const events: string[] = [];
  const notifier = { notify: (e: string, msg: string) => events.push(`${e}:${msg}`) };
  // …drive a permission park and a plan park through the same decision feed this file already uses for
  // its consult-dialog tests, asserting one notification with the exact permission copy and none for the
  // plan…
  expect(events).toEqual(["permission_prompt:ccx needs your permission to use Bash"]);
});
```

For the second test, use whichever decision-feed driver the existing consult-dialog tests in this file
use to push a `PendingEntry`; push one with `kind: "permission", toolName: "Bash"` and one with
`kind: "plan"`, and assert exactly the array above.

- [ ] **Step 2: Run and watch them fail**

Run: `cd harness && npx vitest run test/tui/chat.test.tsx -t "notifies"`

- [ ] **Step 3: Add and validate the preferences**

In `prefs.ts` add to `CcxPrefs`:

```ts
  preferredNotifChannel?: NotifChannel; notifEvents?: NotifEvent[];
```

and validate BOTH in the loader — the channel against `NOTIF_CHANNELS`, and `notifEvents` as **an array
whose every member is in `NOTIF_EVENTS`**. A hand-edited non-array would otherwise reach
`enabledEvents.includes(...)` and throw at the exact moment a permission prompt opens, turning a bad
setting into a crash on the path that matters most. Add a `prefs.test.ts` case for each malformed shape.

- [ ] **Step 4: Construct the notifier with live settings**

In `chatMain.tsx`, beside `createTerminalTitle`:

```ts
  const notifier = createDesktopNotifier({
    write: (s) => { if (process.stdout.isTTY) process.stdout.write(s); },
    settings: () => ({
      preferredNotifChannel: loadPrefs(historyEnv).preferredNotifChannel ?? "auto",
      enabledEvents: loadPrefs(historyEnv).notifEvents ?? NOTIF_DEFAULT_EVENTS,
    }),
  });
```

**Read through `loadPrefs`, not the startup `prefs` object.** `savePrefs` writes a new object to disk and
does not mutate the one loaded at boot, so a getter closing over that object is a startup snapshot
wearing a call-time signature. Reading the file per event is affordable at these rates (two events per
turn at most) and is what makes the `settings: () => …` contract honest.

Thread `notifier` into `useChat`'s deps.

- [ ] **Step 5: Call it at the two seams**

In `useChat.ts`, inside `pushPending` (line 1801):

```ts
    // ONE FIFO, FOUR KINDS. `PendingDecision` carries permission, question, plan and elicitation parks
    // through this single function, so an unguarded notify here would announce a plan approval as a
    // permission prompt. Only the permission kind gets the permission copy.
    if (entry.kind === "permission") deps.notifier?.notify("permission_prompt", `ccx needs your permission to use ${entry.toolName}`);
```

and at the settle path (line 1557), after `setBusy(false)`:

```ts
        // The QUEUE is the condition, not the turn: `drainNext()` on this same line may start another
        // turn immediately, and a notification fired between two queued turns tells the user ccx wants
        // them when it does not. `queueRef.current` is the same source `drainNext` reads.
        if (queueRef.current.length === 0) deps.notifier?.notify("idle_prompt", "ccx is waiting for your input");
```

- [ ] **Step 6: Verify and commit**

Run: `cd harness && npm run test:unit && npm run test:tui && npm run typecheck`

```bash
git add harness/src harness/test
git commit -m "f5(f8): T11 — notifier on the real decision and settle seams, with validated live settings"
```

---

## Task 12: Final verification — the spec's acceptance, executed

**Files:**
- Modify: `docs/parity/tui-ux.md`, `docs/parity/coverage.md`, the spec's § 9
- Test: everything

- [ ] **Step 1: Run every gate**

```bash
cd harness && npm run typecheck && npm run test:unit && npm run test:tui && npm run test:resize-matrix
```

Record the exact counts in the report.

- [ ] **Step 2: Execute the keyless acceptance cells**

Work spec § 4 cells **A1, A2, A3a, A3b, A3c, A4, A4b, A6, A7, A8, A8b, A9**, recording PASS/FAIL, the
command, and the observed output for each.

- [ ] **Step 3: Execute the live pty cells**

Under an isolated HOME beneath `/tmp` with `CCX_FLEET_ROOT` set, and with prefixed tmux sessions killed
**individually by name** — never `tmux kill-server` — run **A5, A10, A10b**.

**A10 asserts the title is cleared and the process exits cleanly. It does NOT assert exit 143**: ccx's
handler ends `host.stop("done").finally(() => process.exit(0))`, a deliberate graceful stop, and
inventing a signal-exit-code requirement inside a spinner wave would change a CLI contract nothing here
needs changed.

**A10b** is the narrowed survivor of probe P93's write half: with the fullscreen renderer up and a
non-empty transcript, fire ten notifications including the kitty three-write form and the DCS-wrapped
form, and compare the visible frame's content and geometry before and after.

- [ ] **Step 4: Hand the owner the manual cell**

A11 cannot be automated. Write a short reproduction script and report it rather than attempting it: in a
real iTerm2 or Ghostty window, confirm a permission prompt raises a system notification, the tab title
reads `✳ …` at idle and alternates while busy, and killing ccx restores the tab title. **This cell also
closes Task 10 Step 1's delegated unknown** — whether the marker the resolver sniffs is the one that
actually survives into that terminal's tmux panes. Record it in spec § 9 as owner-verified pending, with
the date and terminal to be filled in.

- [ ] **Step 5: Rescore the parity documents**

`docs/parity/tui-ux.md`: § 3 (chrome) and § 6 (polish) are what this wave moves — take the spinner glyph
and verb rows, terminal title, desktop notifications and reduced motion to their earned states, and add
the three deferred surfaces from spec § 5 to the tail list **with their evidence**.
`docs/parity/coverage.md`: add the wave's entry and state plainly that **no domain score moves** — F8
consumes no SDK surface at all, as the fullscreen and tool-stream waves did.

- [ ] **Step 6: Write the retrospective and refresh the memory**

Fill spec § 9 with what shipped, what the acceptance run found, and every divergence held.

- [ ] **Step 7: Commit**

```bash
git add CC-to-SDK/docs
git commit -m "f5(f8): T12 — acceptance executed, parity rescored, wave closed out"
```

---

## Self-Review

**Spec coverage.** § 3.1 → T1/T2. § 3.2 → T3/T4/T5. § 3.3 → T7/T8. § 3.4 → T6/T9/T10/T11. Every § 4
cell is executed in T12. Every § 5 deferral is recorded in T12 Step 5.

**Every commit typechecks.** The first draft split the glyph change from its callers and knowingly
committed a broken tree; T3 now lands both in one commit.

**Every settings row does something.** T6 walks all eight touch points a boolean preference has in this
codebase, transcribed from `showTurnDuration` — the first draft touched two of them and would have
shipped an inert row that could not typecheck.

**Type consistency.** `reducedMotion` is the prop name on all four components and the resolver name in
`motion.ts`; the resolver is imported in `ChatApp.tsx` and `chatMain.tsx` only. `glyphFor(elapsedMs, env)`
has one signature at both call sites. `TaskItem.subagent?: true` is written in T4 and read only in T5.
`NotifSettings` is defined in T10 and constructed in T11. `fakeRemote`'s `submit` returns
`Promise<{ result: unknown }>` in every snippet that defines one.

**One step deliberately reuses rather than transcribes**, and says so where it is used: T6 Step 5 keeps
`RetryRow`'s existing countdown arithmetic and swaps only its animation source.

**Two test snippets end in an ellipsis, and both name the driver to use** (T5 Step 2's nested-frame
delivery, T11 Step 1's decision-feed push). Both are instructions to reuse the driver already in that
file rather than invent a second one; neither leaves a requirement unstated.

**Interfaces verified against the real files before this plan was committed**, because each is
load-bearing and none is obvious: `ChatApp` exposes `deps?: Parameters<typeof useChat>[2]`
(`ChatApp.tsx:214`); `queueRef.current` is the authoritative queue depth (`useChat.ts:2752`);
`pushPending` is the single decision FIFO (`useChat.ts:1801`) and `PendingEntry.kind` distinguishes the
kinds; `RenderLine.segments` exists for per-span styling (`render.ts:10`); `fakeRemote.submit` returns
`Promise<{ result: unknown }>`; the byte-level title tests live in `test/unit/terminal-title.test.ts`,
whose sibling `.tsx` file states in its own header that it is the wiring half.
