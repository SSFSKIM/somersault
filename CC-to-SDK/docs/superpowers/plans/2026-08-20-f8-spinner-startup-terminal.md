# F8 — Spinner, startup, and terminal integration: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use doperpowers:subagent-driven-development to implement
> this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close F8, the last scheduled wave of the TUI-clone fidelity program — canon's spinner motion,
the startup screen's geometry ladder, desktop notifications, reduced motion, and live theme detection.

**Architecture:** Four concerns, fourteen independently reviewable tasks. A new pure-builder module owns
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

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/tui/terminalEscapes.ts` | **create** | Pure builders: `osc`, `passthrough`, `notifyTerminator`, `sanitizeNotificationText` |
| `src/tui/animationClock.ts` | **create** | `useAnimationClock` — monotone, quantized, `null`-disarmable |
| `src/tui/motion.ts` | **create** | `reducedMotion(prefs, env)` — the setting OR the screen reader |
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
    // the title keeps BEL on EVERY terminal, kitty included (terminalTitle.ts's Wave C skip)
    expect(osc("bel", OSC_TITLE, "x").endsWith("\x07")).toBe(true);
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
// sanitizes notification text (L202524), codes come from `wC` (L188790).
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

/** canon's `s$n` (L202524): every C0 byte, DEL, and every C1 byte becomes a SPACE — length-preserving,
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
- Modify: `src/tui/terminalTitle.ts` (the `emit` closure and `TERMINAL_TITLE_CLEAR`)
- Test: `test/tui/terminal-title.test.tsx` (existing — add one case, change none)

**Interfaces:**
- Consumes: `osc`, `OSC_TITLE` from Task 1.
- Produces: no signature change. `createTerminalTitle` keeps its exact deps and behavior.

The point of this task is that **nothing observable changes**. It exists so the title's bytes are built
by the same code the notifier will use, and so a future change to OSC assembly cannot silently diverge
between the two.

- [ ] **Step 1: Write the failing test**

Add to `test/tui/terminal-title.test.tsx`:

```ts
it("keeps BEL under kitty — the title does NOT follow canon's ST rule (Wave C skip)", () => {
  const writes: string[] = [];
  const title = createTerminalTitle({ write: (s) => writes.push(s), env: { TERM: "xterm-kitty" } as NodeJS.ProcessEnv });
  title.setTitle("work");
  expect(writes.at(-1)).toBe("\x1b]0;✳ work\x07");
  expect(writes.at(-1)!.endsWith("\x1b\\")).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it passes already**

Run: `cd harness && npx vitest run test/tui/terminal-title.test.tsx`
Expected: PASS. This is a **characterization** test — it pins today's behavior before the refactor so
Step 3 cannot change it unnoticed. Record in the task report that it passed before the change.

- [ ] **Step 3: Recompose the bytes through the builder**

In `src/tui/terminalTitle.ts`, add the import beside the existing ones:

```ts
import { osc, OSC_TITLE } from "./terminalEscapes.js";
```

Replace the `TERMINAL_TITLE_CLEAR` constant:

```ts
/** `a0u` (L148428) — OSC 0 with an empty payload; clears the title on exit. */
export const TERMINAL_TITLE_CLEAR = osc("bel", OSC_TITLE, "");
```

and in the `emit` closure, replace the write line:

```ts
    deps.write(osc("bel", OSC_TITLE, composed));
```

Leave the header comment's "TWO RECORDED SKIPS" block intact, and append to the kitty skip:

```
//    (F8 T2: the ST variant now EXISTS — `terminalEscapes.osc("st", …)`, used by kitty notifications —
//    and the title still does not use it. The skip is now a choice among available options rather than
//    an absence, which is what makes `terminal-title.test.tsx`'s kitty case meaningful.)
```

- [ ] **Step 4: Run the tests to verify nothing moved**

Run: `cd harness && npx vitest run test/tui/terminal-title.test.tsx && npm run typecheck`
Expected: PASS with the same assertion count as Step 2 plus the new one. No snapshot churn.

- [ ] **Step 5: Delete the now-dead follow-up note**

In `src/tui/terminalTitle.ts`, **delete** the whole `FOLLOW-UP, RECORDED AND NOT THIS MODULE'S JOB`
paragraph and replace it with:

```
// THE SIGTERM FOLLOW-UP THIS FILE USED TO CARRY IS DONE, and was already done when it was written down.
// `cli/main.ts:424` registers one handler each for SIGHUP/SIGTERM/SIGINT and drains `createChatTeardown`,
// whose third step is `clearTitle()` (chatMain.tsx:866). Nothing about titles needs a signal handler, and
// adding one would double-register against an owner deliberately built to be singular.
```

- [ ] **Step 6: Commit**

```bash
git add harness/src/tui/terminalTitle.ts harness/test/tui/terminal-title.test.tsx
git commit -m "f5(f8): T2 — title bytes come from the shared builder; the stale SIGTERM note is deleted, not inherited"
```

---

## Task 3: The spinner glyph — six frames and a raised cosine

**Files:**
- Modify: `src/tui/spinner.ts:32-39`
- Test: `test/tui/spinner.test.ts:26-33` (replace the frame block)

**Interfaces:**
- Consumes: nothing.
- Produces: `SPINNER_BASE`, `SPINNER_BASE_GHOSTTY`, `spinnerBase(env?) → readonly string[]`,
  `SPINNER_PERIOD_MS = 2000`, `raisedCosine(ms, periodMs) → number`,
  `glyphIndex(elapsedMs, frameCount) → number`, `glyphFor(elapsedMs, env?) → string`.
  **`glyphFrame` and `SPINNER_FRAMES` are removed** — Task 4 migrates both callers.

- [ ] **Step 1: Write the failing test**

In `test/tui/spinner.test.ts`, replace the existing frames block (currently asserting the 12-entry
ping-pong and `glyphFrame`) with:

```ts
  it("has canon's SIX base glyphs, with the ghostty variant repeating the fifth", () => {
    expect(SPINNER_BASE).toEqual(["·", "✢", "✳", "✶", "✻", "✽"]);
    expect(SPINNER_BASE_GHOSTTY).toEqual(["·", "✢", "✳", "✶", "✻", "✻"]);
    expect(spinnerBase({ TERM: "xterm-ghostty" } as NodeJS.ProcessEnv)).toEqual(SPINNER_BASE_GHOSTTY);
    expect(spinnerBase({ TERM: "xterm-256color" } as NodeJS.ProcessEnv)).toEqual(SPINNER_BASE);
  });

  it("raisedCosine is canon's (1 - cos(2*PI*t/period))/2 — 0 at both ends, 1 at the half period", () => {
    expect(raisedCosine(0, 2000)).toBeCloseTo(0, 10);
    expect(raisedCosine(1000, 2000)).toBeCloseTo(1, 10);
    expect(raisedCosine(2000, 2000)).toBeCloseTo(0, 10);
    expect(raisedCosine(500, 2000)).toBeCloseTo(0.5, 10);
  });

  it("glyphIndex walks out and back across one period, dwelling at the ends", () => {
    const at = (ms: number) => glyphIndex(ms, 6);
    expect(at(0)).toBe(0);
    expect(at(1000)).toBe(5);          // half period → last glyph
    expect(at(2000)).toBe(0);          // full period → back to the first
    expect(at(3000)).toBe(5);          // and it keeps cycling
    // eased, not linear: the first and last fifths of the ramp hold their glyph longer than the middle
    expect(at(100)).toBe(at(0));
    expect(at(900)).toBe(at(1000));
    // monotone up over the first half
    const firstHalf = [0, 200, 400, 600, 800, 1000].map(at);
    expect(firstHalf).toEqual([...firstHalf].sort((a, b) => a - b));
  });

  it("glyphIndex is negative-safe and never leaves the array", () => {
    for (const ms of [-1, -10_000, 0, 1, 12_345_678]) {
      const i = glyphIndex(ms, 6);
      expect(Number.isInteger(i)).toBe(true);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(6);
    }
  });

  it("glyphFor picks from the env's table", () => {
    expect(glyphFor(0, {} as NodeJS.ProcessEnv)).toBe("·");
    expect(glyphFor(1000, {} as NodeJS.ProcessEnv)).toBe("✽");
    expect(glyphFor(1000, { TERM: "xterm-ghostty" } as NodeJS.ProcessEnv)).toBe("✻");
  });
```

and update the file's import to:

```ts
import {
  SPINNER_VERBS, SPINNER_BASE, SPINNER_BASE_GHOSTTY, spinnerBase, raisedCosine, glyphIndex, glyphFor,
  SPINNER_PERIOD_MS, pickVerb, spinnerStatus,
```

(keep every other name the file already imports).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd harness && npx vitest run test/tui/spinner.test.ts`
Expected: FAIL — `SPINNER_BASE_GHOSTTY` / `raisedCosine` / `glyphIndex` / `glyphFor` are not exported.

- [ ] **Step 3: Write the implementation**

In `src/tui/spinner.ts`, replace lines 31-39 (the `SPINNER_BASE` / `SPINNER_FRAMES` / `glyphFrame` block)
with:

```ts
/** The darwin asterisk-pulse base chars (`MSt`, L495134-495137). SIX entries, not a ping-pong of twelve:
 *  canon walks them with an eased index, and the out-and-back falls out of the cosine. */
export const SPINNER_BASE = ["·", "✢", "✳", "✶", "✻", "✽"] as const;
/** The `TERM === "xterm-ghostty"` variant (L495135) — the sixth slot repeats the fifth rather than
 *  reaching `✽`, which ghostty renders at a different width. */
export const SPINNER_BASE_GHOSTTY = ["·", "✢", "✳", "✶", "✻", "✻"] as const;
/** `MSt` is memoized on TERM upstream; ours takes the env so a test can pin either table. */
export function spinnerBase(env: NodeJS.ProcessEnv = process.env): readonly string[] {
  return env.TERM === "xterm-ghostty" ? SPINNER_BASE_GHOSTTY : SPINNER_BASE;
}

/** `c8T` (L507933) — the glyph cycle's period. */
export const SPINNER_PERIOD_MS = 2000;
/** `Ero` (L495099) — a raised cosine on [0,1]. Zero at 0 and at every whole period, one at the half. */
export const raisedCosine = (ms: number, periodMs: number): number => (1 - Math.cos((2 * Math.PI * ms) / periodMs)) / 2;

/** `y8T` (L507743) — the frame index. The cosine is what makes the walk EASED: the glyph dwells at both
 *  ends of the pulse and moves fastest through the middle, where a linear ping-pong stepped evenly.
 *  Negative-safe: `raisedCosine` is even and periodic, so a negative elapsed maps onto the same curve as
 *  its absolute value rather than indexing off the front of the array. */
export function glyphIndex(elapsedMs: number, frameCount: number): number {
  return Math.round(raisedCosine(elapsedMs, SPINNER_PERIOD_MS) * (frameCount - 1));
}

/** The glyph for an elapsed time — the whole public surface the two component callers need. */
export function glyphFor(elapsedMs: number, env: NodeJS.ProcessEnv = process.env): string {
  const table = spinnerBase(env);
  return table[glyphIndex(elapsedMs, table.length)]!;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd harness && npx vitest run test/tui/spinner.test.ts`
Expected: PASS for the new cases. `npm run typecheck` will still FAIL with two errors — `TurnSpinner.tsx`
and `CompactionRow.tsx` import the now-deleted `glyphFrame`. That is expected and Task 4 fixes it; do not
add a compatibility alias to silence it.

- [ ] **Step 5: Commit**

```bash
git add harness/src/tui/spinner.ts harness/test/tui/spinner.test.ts
git commit -m "f5(f8): T3 — six glyphs on a raised cosine; the ping-pong array is gone"
```

---

## Task 4: The monotone animation clock, and both spinner callers

**Files:**
- Create: `src/tui/animationClock.ts`
- Modify: `src/tui/TurnSpinner.tsx`, `src/tui/CompactionRow.tsx`
- Test: `test/tui/animationClock.test.tsx` (create), `test/tui/components.test.tsx` (existing),
  `test/tui/compaction-row.test.tsx` (existing)

**Interfaces:**
- Consumes: `glyphFor`, `SPINNER_PERIOD_MS` (Task 3).
- Produces: `useAnimationClock(intervalMs: number | null, startedAt: number, now?: () => number) → number`,
  and the constants `SPINNER_INTERVAL_MS = 100`, `SPINNER_REQUESTING_INTERVAL_MS = 50` from `spinner.ts`.

**Why the clock is its own module.** Quantizing elapsed time by a *varying* interval is not monotone:
at 150 ms, `floor(150/50)×50 = 150` but `floor(150/100)×100 = 100`. A turn leaving `requesting` would
step its clock back 50 ms, reversing the cosine and handing `easeChars` a negative delta. Canon avoids
this with a high-water ref inside `Cg` (L204978: `u.current = Math.max(u.current, …)`). This module is
that clamp, in one place, tested once.

- [ ] **Step 1: Write the failing test**

Create `test/tui/animationClock.test.tsx`:

```tsx
import React from "react";
import { render } from "ink-testing-library";
import { Text } from "ink";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { useAnimationClock } from "../../src/tui/animationClock.js";

function Probe({ interval, startedAt, now }: { interval: number | null; startedAt: number; now: () => number }) {
  const t = useAnimationClock(interval, startedAt, now);
  return <Text>{`t=${t}`}</Text>;
}

describe("useAnimationClock", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("arms exactly one timer, and none at all when the interval is null", () => {
    const now = () => 1000;
    const a = render(<Probe interval={100} startedAt={1000} now={now} />);
    expect(vi.getTimerCount()).toBe(1);
    a.unmount();
    expect(vi.getTimerCount()).toBe(0);

    const b = render(<Probe interval={null} startedAt={1000} now={now} />);
    expect(vi.getTimerCount()).toBe(0);
    b.unmount();
  });

  it("re-arms exactly one timer when the interval changes", () => {
    const now = () => 1000;
    const { rerender, unmount } = render(<Probe interval={50} startedAt={1000} now={now} />);
    expect(vi.getTimerCount()).toBe(1);
    rerender(<Probe interval={100} startedAt={1000} now={now} />);
    expect(vi.getTimerCount()).toBe(1);          // re-armed, not stacked
    rerender(<Probe interval={null} startedAt={1000} now={now} />);
    expect(vi.getTimerCount()).toBe(0);
    unmount();
  });

  it("never runs backward across the 50ms -> 100ms transition", () => {
    let clock = 1000;
    const now = () => clock;
    const { lastFrame, rerender } = render(<Probe interval={50} startedAt={1000} now={now} />);
    clock = 1150;                                 // 150ms elapsed, quantized by 50 -> 150
    rerender(<Probe interval={50} startedAt={1000} now={now} />);
    expect(lastFrame()).toBe("t=150");
    rerender(<Probe interval={100} startedAt={1000} now={now} />);   // naive requantize would give 100
    expect(lastFrame()).toBe("t=150");
  });

  it("treats a non-positive startedAt as 'just started' rather than 1970", () => {
    const { lastFrame } = render(<Probe interval={100} startedAt={0} now={() => 1_700_000_000_000} />);
    expect(lastFrame()).toBe("t=0");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd harness && npx vitest run test/tui/animationClock.test.tsx`
Expected: FAIL — cannot resolve `../../src/tui/animationClock.js`.

- [ ] **Step 3: Write the implementation**

Create `src/tui/animationClock.ts`:

```ts
// tui/src/animationClock.ts — F8 Task 4: canon's `Cg` (L204972), the animation clock every ccx spinner
// reads. Returns MONOTONE elapsed milliseconds, quantized to the repaint interval, and arms no timer at
// all when the interval is null.
//
// THE CLAMP IS THE POINT. Quantizing elapsed time by a varying interval is not monotone: at 150ms,
// floor(150/50)*50 = 150 but floor(150/100)*100 = 100, so a turn leaving `requesting` would step its
// clock BACKWARD 50ms — reversing the glyph's cosine and handing the token easing a negative delta.
// Canon has the same hazard and the same fix (`u.current = Math.max(u.current, Math.floor(now/c)*c)`).
// Nothing about this is visible until the mode flips, which is why the timer-lifecycle test exists.
//
// `null` DISARMS, it does not freeze: under reduced motion the component does no periodic work at all,
// which is both canon's behaviour and the honest reading of the setting.
import { useEffect, useRef, useState } from "react";

export function useAnimationClock(intervalMs: number | null, startedAt: number, now: () => number = Date.now): number {
  const [, setTick] = useState(0);
  const highWater = useRef(0);
  useEffect(() => {
    if (intervalMs === null) return;
    const h = setInterval(() => setTick((n) => n + 1), intervalMs);
    return () => clearInterval(h);
  }, [intervalMs]);
  // A non-positive stamp reads as "just started". TurnSpinner's own guard, kept here because this module
  // now owns the subtraction: `useChat` sets busy and the start stamp in two setStates that do not commit
  // together, so one painted frame can legally hold busy=true and startedAt=0 — and `now() - 0` rendered
  // as "(29758130m 59s)" in a real binary (pty acceptance, w3.9).
  const elapsed = startedAt > 0 ? Math.max(0, now() - startedAt) : 0;
  const quantized = intervalMs === null ? elapsed : Math.floor(elapsed / intervalMs) * intervalMs;
  if (quantized > highWater.current) highWater.current = quantized;
  return highWater.current;
}
```

- [ ] **Step 4: Run the clock test to verify it passes**

Run: `cd harness && npx vitest run test/tui/animationClock.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 5: Add the interval constants to `spinner.ts`**

Beneath `SPINNER_PERIOD_MS` in `src/tui/spinner.ts`:

```ts
/** `Cg(t ? null : e === "requesting" ? 50 : 100)` (L507766) — the repaint cadence. Note what these are
 *  NOT: the 200 in `U = e === "requesting" ? 50 : 200` on the very next line steps the SHIMMER position,
 *  a different clock in the same expression. Two clocks, one line; only the hook call settles which. */
export const SPINNER_INTERVAL_MS = 100, SPINNER_REQUESTING_INTERVAL_MS = 50;
/** The interval for a frame, or `null` to arm no timer at all. */
export function spinnerInterval(mode: SpinnerMode | undefined, reducedMotion: boolean): number | null {
  return reducedMotion ? null : mode === "requesting" ? SPINNER_REQUESTING_INTERVAL_MS : SPINNER_INTERVAL_MS;
}
```

- [ ] **Step 6: Migrate `TurnSpinner.tsx`**

Replace the `FRAME_MS` constant and its `useEffect`/`tick` machinery. The new body of `TurnSpinner`:

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
  // Under reduced motion the eased count SNAPS to its target (canon L507775: `if (t) ie.current = B`).
  // There is no animation to ease, and easing against a clock nobody is advancing would freeze the
  // number at whatever the last wire event left rather than showing the truth.
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

Update its imports: drop `glyphFrame` and `useEffect`/`useState`, add
`glyphFor, spinnerBase, spinnerInterval` from `./spinner.js` and `useAnimationClock` from
`./animationClock.js`.

- [ ] **Step 7: Migrate `CompactionRow.tsx`**

Replace its import of `glyphFrame` with `glyphFor` from `./spinner.js` plus `useAnimationClock` from
`./animationClock.js`, delete its `tick` state and `useEffect`, and change the two lines:

```tsx
export function CompactionRow({ startedAt, now = Date.now, columns, reducedMotion = false, env = process.env }: { startedAt: number; now?: () => number; columns: number; reducedMotion?: boolean; env?: NodeJS.ProcessEnv }) {
  const ratioRef = useRef(0);
  const animMs = useAnimationClock(reducedMotion ? null : SPINNER_INTERVAL_MS, startedAt, now);
```

and the glyph:

```tsx
        <Text color={ACCENT}>{reducedMotion ? spinnerBase(env)[0]! : glyphFor(animMs, env)}</Text>
```

Add `SPINNER_INTERVAL_MS, spinnerBase, glyphFor` to its `./spinner.js` import. Leave `ratioRef` and the
bar untouched — the bar's monotonic ratio is a separate mechanism and this task does not touch it.

- [ ] **Step 8: Run the affected suites**

Run: `cd harness && npx vitest run test/tui/animationClock.test.tsx test/tui/compaction-row.test.tsx test/tui/components.test.tsx test/tui/spinner.test.ts && npm run typecheck`
Expected: all PASS, typecheck clean (the two Task 3 errors are now resolved). If an existing spinner
assertion pinned the old ping-pong glyph at a given tick, update it to the cosine's glyph for the same
elapsed time — do not reintroduce a tick-indexed helper.

- [ ] **Step 9: Commit**

```bash
git add harness/src/tui/animationClock.ts harness/src/tui/spinner.ts harness/src/tui/TurnSpinner.tsx harness/src/tui/CompactionRow.tsx harness/test/tui/
git commit -m "f5(f8): T4 — the monotone animation clock, and both spinner callers on it"
```

---

## Task 5: Task provenance in `TaskList`

**Files:**
- Modify: `src/tui/taskList.ts`
- Test: `test/tui/taskList.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `TaskItem.subagent?: true`, set at ingest when the frame carries a `parent_tool_use_id`.

**Why.** Canon's `B` gate (L508022) asks "is this the main agent's spinner?" and can ask it because its
spinner store is per-agent (`OCl(EDl.agentId)`). ccx has one spinner and one global task store that never
reads `parent_tool_use_id`, so transplanting the gate makes it a constant `true` and a subagent's todo
list would retitle the main spinner — which canon never does. The provenance is recorded here; only
Task 6's selector filters on it. **The task panel keeps showing every task.**

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
  expect(snap).toHaveLength(2);                                   // the PANEL still sees both
  expect(snap.find((t) => t.subject === "Main work")!.subagent).toBeUndefined();
  expect(snap.find((t) => t.subject === "Nested work")!.subagent).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd harness && npx vitest run test/tui/taskList.test.ts`
Expected: FAIL — `expected undefined to be true` on the nested task.

- [ ] **Step 3: Write the implementation**

In `src/tui/taskList.ts`, add the field to `TaskItem` after `activeForm`:

```ts
  /** Set when this task's `TaskCreate` arrived on a NESTED frame (the frame carried a
   *  `parent_tool_use_id`). Absent = the main agent's, following this file's absent-rather-than-empty
   *  rule. Only the spinner's message ladder reads it; the task panel shows every task regardless. */
  subagent?: true;
```

Widen the `pending` map's value type to carry it:

```ts
  private pending = new Map<string, { subject: string; activeForm?: string; subagent?: true }>();
```

In `ingest`, capture the frame's origin before the content loop and thread it into the `TaskCreate` arm:

```ts
    if (mm?.type === "assistant") {
      // The FRAME carries the provenance, not the block: a nested tool_use is announced by the message's
      // own `parent_tool_use_id`, which is null/absent on the main agent's frames.
      const nested = typeof mm.parent_tool_use_id === "string" && mm.parent_tool_use_id !== "" ? true as const : undefined;
      for (const b of mm.message?.content ?? []) {
```

and in the `TaskCreate` branch add `...(nested ? { subagent: nested } : {})` to the object stored in
`pending`; where `pending` is drained into `tasks` on the result, carry `subagent` across the same way.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd harness && npx vitest run test/tui/taskList.test.ts test/tui/task-panel.test.tsx && npm run typecheck`
Expected: PASS. The panel suite must be unchanged — if a panel assertion moved, the filter leaked out of
the selector and into ingest; put it back.

- [ ] **Step 5: Commit**

```bash
git add harness/src/tui/taskList.ts harness/test/tui/taskList.test.ts
git commit -m "f5(f8): T5 — task origin recorded at ingest; the panel still shows everything"
```

---

## Task 6: The spinner's message ladder

**Files:**
- Modify: `src/tui/spinner.ts` (add `spinnerMessage`), `src/tui/TurnSpinner.tsx`, `src/tui/ChatApp.tsx`
- Test: `test/tui/spinner.test.ts`, `test/tui/components.test.tsx`

**Interfaces:**
- Consumes: `TaskItem` (Task 5).
- Produces: `spinnerMessage(input: SpinnerMessageInput) → string` and
  `activeSpinnerTask(tasks: readonly TaskItem[]) → TaskItem | undefined`.

- [ ] **Step 1: Write the failing test**

Add to `test/tui/spinner.test.ts`:

```ts
describe("spinnerMessage", () => {
  it("walks canon's ladder: override, then activeForm, then subject, then the verb", () => {
    const base = { randomVerb: "Baking" };
    expect(spinnerMessage({ ...base, overrideMessage: "Compacting", activeTask: { activeForm: "Running tests", subject: "Fix parser" } })).toBe("Compacting");
    expect(spinnerMessage({ ...base, activeTask: { activeForm: "Running tests", subject: "Fix parser" } })).toBe("Running tests");
    expect(spinnerMessage({ ...base, activeTask: { subject: "Fix parser" } })).toBe("Fix parser");
    expect(spinnerMessage({ ...base, defaultVerb: "Churning" })).toBe("Churning");
    expect(spinnerMessage(base)).toBe("Baking");
  });
  it("treats an empty string at any rung as absent", () => {
    expect(spinnerMessage({ randomVerb: "Baking", overrideMessage: "", activeTask: { subject: "" } })).toBe("Baking");
  });
});

describe("activeSpinnerTask", () => {
  const t = (subject: string, status: TaskStatus, extra: Partial<TaskItem> = {}): TaskItem => ({ id: subject, subject, status, ...extra });
  it("picks the first task that is neither pending nor completed", () => {
    expect(activeSpinnerTask([t("a", "completed"), t("b", "in_progress"), t("c", "in_progress")])!.subject).toBe("b");
    expect(activeSpinnerTask([t("a", "pending"), t("b", "completed")])).toBeUndefined();
  });
  it("never picks a subagent's task — canon's B gate, expressed where ccx keeps the provenance", () => {
    expect(activeSpinnerTask([t("nested", "in_progress", { subagent: true })])).toBeUndefined();
    expect(activeSpinnerTask([t("nested", "in_progress", { subagent: true }), t("mine", "in_progress")])!.subject).toBe("mine");
  });
});
```

Import `spinnerMessage`, `activeSpinnerTask` from `../../src/tui/spinner.js` and `TaskItem`, `TaskStatus`
from `../../src/tui/taskList.js`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd harness && npx vitest run test/tui/spinner.test.ts -t "spinnerMessage"`
Expected: FAIL — `spinnerMessage` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `src/tui/spinner.ts`:

```ts
// ── The message ladder (canon L508022) ───────────────────────────────────────────────────────────────

import type { TaskItem } from "./taskList.js";

export interface SpinnerMessageInput {
  /** canon's `a` — an explicit override; nothing in ccx sets one yet, and the rung stays so one can. */
  overrideMessage?: string;
  /** canon's `W` — see `activeSpinnerTask`. */
  activeTask?: { activeForm?: string; subject?: string };
  /** canon's `y`, the store's `defaultVerb`. */
  defaultVerb?: string;
  /** canon's `ee`, drawn once per turn. */
  randomVerb: string;
}

const rung = (s: string | undefined): string | undefined => (s !== undefined && s.trim() !== "" ? s : undefined);

/** `J = (a ?? W?.activeForm ?? W?.subject ?? (y || ee))` (L508022). The `subject` rung is why this ladder
 *  fires at all on our wire: `activeForm` is optional in the tool schema and a real run was observed
 *  sending `TaskCreate {subject, description}` with no `activeForm` at all (taskList.ts's header). */
export function spinnerMessage(input: SpinnerMessageInput): string {
  return rung(input.overrideMessage) ?? rung(input.activeTask?.activeForm) ?? rung(input.activeTask?.subject)
    ?? rung(input.defaultVerb) ?? input.randomVerb;
}

/** canon's `W` — the first task that is neither pending nor completed — with canon's `B` gate folded in.
 *  Upstream can express that gate as "am I the main agent's spinner?" because its spinner store is
 *  per-agent; ccx has one spinner and one shared task store, so the same guarantee has to be a filter
 *  over task provenance instead (taskList.ts's `subagent`). Same observable behaviour, different seam. */
export function activeSpinnerTask(tasks: readonly TaskItem[]): TaskItem | undefined {
  return tasks.find((t) => t.subagent !== true && t.status !== "pending" && t.status !== "completed");
}
```

- [ ] **Step 4: Wire it into the component**

In `TurnSpinner.tsx`, add `tasks?: readonly TaskItem[]` to the props, and replace the `gerund` line:

```tsx
  const gerund = `${spinnerMessage({ activeTask: activeSpinnerTask(tasks), randomVerb: verbRef.current! })}…`;
```

with `tasks = []` defaulted in the destructure. In `ChatApp.tsx`, pass the task list the todo panel
already holds to the `<TurnSpinner …>` mount: add `tasks={state.tasks}`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd harness && npx vitest run test/tui/spinner.test.ts test/tui/components.test.tsx && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add harness/src/tui/spinner.ts harness/src/tui/TurnSpinner.tsx harness/src/tui/ChatApp.tsx harness/test/tui/
git commit -m "f5(f8): T6 — the four-rung message ladder, gated on task provenance"
```

---

## Task 7: Reduced motion — the resolver, the preference, the settings row

**Files:**
- Create: `src/tui/motion.ts`
- Modify: `src/tui/renderer.ts`, `src/tui/prefs.ts`, `src/tui/settingsRows.ts`
- Test: `test/tui/motion.test.ts` (create), `test/unit/renderer-select.test.ts`,
  `test/tui/settingsRows.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `screenReaderEnabled(env) → boolean` (from `renderer.ts`),
  `reducedMotion(prefs, env?) → boolean` (from `motion.ts`), `CcxPrefs.prefersReducedMotion?: boolean`,
  and a `reduceMotion` row id in `settingsRows.ts`.

- [ ] **Step 1: Write the failing test**

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

- [ ] **Step 2: Run test to verify it fails**

Run: `cd harness && npx vitest run test/tui/motion.test.ts`
Expected: FAIL — neither `screenReaderEnabled` nor `motion.js` exists.

- [ ] **Step 3: Extract the predicate in `renderer.ts`**

Above `selectRenderer`, add:

```ts
/** The screen-reader rung, as a predicate rather than an inline test, because F8's banner needs the same
 *  verdict and `choice.reason === "screen_reader"` is not it — that is true only when this rung WINS, and
 *  is silently false under a non-TTY. Env-only, per this module's recorded divergence 4. */
export function screenReaderEnabled(env: NodeJS.ProcessEnv): boolean { return envBool(env.CLAUDE_AX_SCREEN_READER) === true; }
```

and replace the rung inside `selectRenderer` with:

```ts
  if (screenReaderEnabled(env)) return { mode: "classic", reason: "screen_reader" };
```

- [ ] **Step 4: Create `src/tui/motion.ts`**

```ts
// tui/src/motion.ts — F8 Task 7: one resolver for "should anything be animating right now".
//
// It is NOT the setting alone. Canon's value is `hx(S.prefersReducedMotion) || hl()` (L507999) — the
// persisted preference OR the screen-reader signal. Threading only the preference leaves a screen-reader
// user with a spinning glyph, an animating retry row and a braille-alternating tab title: precisely the
// population the behaviour exists for. Canon performs no operating-system query anywhere, so neither do
// we; `prefersReducedMotion` is a setting and `CLAUDE_AX_SCREEN_READER` is an env var, and that is all.
import type { CcxPrefs } from "./prefs.js";
import { screenReaderEnabled } from "./renderer.js";

export function reducedMotion(prefs: Pick<CcxPrefs, "prefersReducedMotion">, env: NodeJS.ProcessEnv = process.env): boolean {
  return prefs.prefersReducedMotion === true || screenReaderEnabled(env);
}
```

- [ ] **Step 5: Add the preference**

In `src/tui/prefs.ts`, add `prefersReducedMotion?: boolean;` to `CcxPrefs`, and — following the exact
pattern the file already uses for `showTurnDuration` — accept it in the loader's validation (a value that
is not a boolean is dropped, not coerced).

- [ ] **Step 6: Add the settings row**

In `src/tui/settingsRows.ts`, widen the `id` union with `| "reduceMotion"`, add the context field, and
insert the row after `showTurnDuration` (canon groups it with the display toggles):

```ts
    { id: "reduceMotion", label: "Reduce motion", type: "boolean", value: String(ctx.reduceMotion) },
```

Add the matching assertion to `test/tui/settingsRows.test.ts` alongside the existing row assertions.

- [ ] **Step 7: Run the tests**

Run: `cd harness && npx vitest run test/tui/motion.test.ts test/tui/settingsRows.test.ts test/tui/settings-dialog.test.tsx test/unit/renderer-select.test.ts && npm run typecheck`
Expected: all PASS. `renderer-select` must be unchanged — the extraction is behavior-preserving.

- [ ] **Step 8: Commit**

```bash
git add harness/src/tui/motion.ts harness/src/tui/renderer.ts harness/src/tui/prefs.ts harness/src/tui/settingsRows.ts harness/test/
git commit -m "f5(f8): T7 — reduced motion is the setting OR the screen reader, resolved once"
```

---

## Task 8: Reduced motion reaches all four animations

**Files:**
- Modify: `src/tui/chatMain.tsx`, `src/tui/ChatApp.tsx`, `src/tui/RetryRow.tsx`, `src/tui/terminalTitle.ts`
- Test: `test/tui/components.test.tsx`, `test/tui/compaction-row.test.tsx`,
  `test/tui/terminal-title.test.tsx`

**Interfaces:**
- Consumes: `reducedMotion` (Task 7); the `reducedMotion` props added to `TurnSpinner` and
  `CompactionRow` in Task 4.
- Produces: `TerminalTitleDeps.reducedMotion?: boolean`.

- [ ] **Step 1: Write the failing test**

Add to `test/tui/terminal-title.test.tsx`:

```ts
it("does not alternate the busy prefix under reduced motion", () => {
  const writes: string[] = [];
  let fire: (() => void) | undefined;
  const title = createTerminalTitle({
    write: (s) => writes.push(s), reducedMotion: true,
    setInterval: (fn) => { fire = fn; return 1; }, clearInterval: () => {},
  });
  title.setTitle("work");
  title.setBusy(true);
  expect(fire).toBeUndefined();                       // no animation timer armed at all
  expect(writes.at(-1)).toBe("\x1b]0;✳ work\x07");    // the IDLE prefix, held
});
```

and to `test/tui/components.test.tsx`:

```tsx
it("freezes the spinner glyph under reduced motion", () => {
  const { lastFrame } = render(<TurnSpinner startedAt={1000} verb="Baking" reducedMotion now={() => 2000} />);
  expect(lastFrame()).toContain("· Baking…");         // index 0, not the cosine's glyph for 1000ms
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd harness && npx vitest run test/tui/terminal-title.test.tsx test/tui/components.test.tsx`
Expected: FAIL — `reducedMotion` is not a `TerminalTitleDeps` field; the spinner case may already pass
from Task 4, in which case record that and keep the assertion as a guard.

- [ ] **Step 3: Honor it in `terminalTitle.ts`**

Add `reducedMotion?: boolean;` to `TerminalTitleDeps`, and in `setBusy`:

```ts
    setBusy(next): void {
      if (disabled || next === busy) return;
      busy = next;
      // Reduced motion holds the IDLE prefix rather than freezing on a braille frame: the animation is
      // the thing being suppressed, and `✳` is what the tab says when nothing is animating.
      if (next && deps.reducedMotion !== true) { frame = 0; emit(); handle = arm(() => { frame++; emit(); }, TERMINAL_TITLE_FRAME_MS); }
      else { stop(); emit(); }
    },
```

and in `emit`, guard the prefix choice:

```ts
    const prefix = busy && deps.reducedMotion !== true ? TERMINAL_TITLE_BUSY_FRAMES[frame % TERMINAL_TITLE_BUSY_FRAMES.length] : TERMINAL_TITLE_IDLE_PREFIX;
```

- [ ] **Step 4: Honor it in `RetryRow.tsx`**

Add `reducedMotion = false` to its props and replace its `useEffect` interval with the same
`useAnimationClock` call shape Task 4 used, passing `reducedMotion ? null : 120`. Keep its existing
countdown arithmetic; only the animation source changes.

- [ ] **Step 5: Thread it from the top**

In `chatMain.tsx`, resolve once beside the other preference reads:

```ts
  const motionReduced = reducedMotion(prefs, process.env);
```

pass `reducedMotion: motionReduced` into `createTerminalTitle({…})`, and pass `reducedMotion={motionReduced}`
down to `ChatApp`, which forwards it to `TurnSpinner`, `CompactionRow` and `RetryRow` at the mount site
around `ChatApp.tsx:1585`.

- [ ] **Step 6: Run the tests**

Run: `cd harness && npm run test:tui && npm run typecheck`
Expected: PASS, full tui suite.

- [ ] **Step 7: Commit**

```bash
git add harness/src/tui harness/test/tui
git commit -m "f5(f8): T8 — all four animations honour reduced motion, screen readers included"
```

---

## Task 9: The banner's degraded branch

**Files:**
- Modify: `src/tui/banner.ts`, `src/cli/main.ts:476`
- Test: `test/tui/banner.test.ts`

**Interfaces:**
- Consumes: `screenReaderEnabled` (Task 7).
- Produces: `BANNER_MIN_ROWS = 30`; `BannerInfo` gains `rows?: number` and `screenReader?: boolean`.

- [ ] **Step 1: Write the failing test**

Add to `test/tui/banner.test.ts`:

```ts
it("degrades to ONE line below 30 rows — no box, no cwd/model line, no tips", () => {
  const lines = welcomeBanner({ cwd: "/tmp/x", model: "opus", rows: 24 });
  expect(lines).toHaveLength(1);
  expect(lines[0]!.text).toBe("✻ Welcome to Claude Code ccx v" + CCX_VERSION);
  expect(lines.some((l) => l.text.includes("╭"))).toBe(false);
});

it("degrades for a screen reader at any height", () => {
  expect(welcomeBanner({ cwd: "/tmp/x", rows: 200, screenReader: true })).toHaveLength(1);
});

it("renders the full box at exactly 30 rows", () => {
  const lines = welcomeBanner({ cwd: "/tmp/x", rows: 30 });
  expect(lines.length).toBeGreaterThan(1);
  expect(lines[0]!.text.startsWith("╭")).toBe(true);
});

it("renders the full box when rows is unknown", () => {
  expect(welcomeBanner({ cwd: "/tmp/x" }).length).toBeGreaterThan(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd harness && npx vitest run test/tui/banner.test.ts`
Expected: FAIL — `rows` is not a `BannerInfo` field and the full box renders.

- [ ] **Step 3: Write the implementation**

In `src/tui/banner.ts`, add to `BannerInfo`:

```ts
  /** Terminal height at seed time. Absent = unknown, which renders the FULL form: a banner that hid
   *  itself because nobody measured would be worse than one row too many. */
  rows?: number;
  /** `renderer.screenReaderEnabled(env)`, resolved by the caller so one verdict serves both consumers. */
  screenReader?: boolean;
```

Add the constant beside `BANNER_COMPACT_COLUMNS`:

```ts
/** §C8.1's sibling: canon's `dKm = 30` (L500971). Below it, `Gqe` returns one line — no logo, no tips. */
export const BANNER_MIN_ROWS = 30;
```

and at the top of `welcomeBanner`, before the box is built:

```ts
  // canon `Gqe`'s first branch (L500761): `if (o7O || i7O < dKm)` — a screen reader, or a terminal too
  // short for the box. Ours carries ccx's own `✻` where canon opens on the bare words, so the degraded
  // form and the full form (whose title line is `✻ Welcome to Claude Code`) agree with each other
  // (spec D-F8-12). Everything else about the branch is canon's: one line, and nothing else at all.
  if (info.screenReader === true || (info.rows !== undefined && info.rows < BANNER_MIN_ROWS))
    return [{ text: `✻ Welcome to Claude Code ccx v${info.version ?? CCX_VERSION}`, color: ACCENT }];
```

- [ ] **Step 4: Feed it from the launch site**

In `src/cli/main.ts`, at the `welcomeBanner({…})` call (line ~476), add the two facts:

```ts
              rows: process.stdout.rows, screenReader: screenReaderEnabled(process.env),
```

importing `screenReaderEnabled` from `../tui/renderer.js`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd harness && npx vitest run test/tui/banner.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add harness/src/tui/banner.ts harness/src/cli/main.ts harness/test/tui/banner.test.ts
git commit -m "f5(f8): T9 — the banner degrades below 30 rows and for screen readers"
```

---

## Task 10: Tips as a completion checklist

**Files:**
- Modify: `src/tui/banner.ts`
- Test: `test/tui/banner.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `Tip { key, text, isEnabled, isComplete }`,
  `startupTips(facts: { emptyWorkspace: boolean; hasClaudeMd: boolean }) → Tip[]`,
  `renderTips(tips, inHomeDir) → RenderLine[]`.

**Note the content change.** ccx's three current tips are replaced by canon's two-entry conditional pair
(L384137). Spec decision D-F8-7 — this is the wave's only content deletion, and it is what makes the
checklist honest rather than decorative.

- [ ] **Step 1: Write the failing test**

Add to `test/tui/banner.test.ts`:

```ts
describe("startupTips", () => {
  it("offers the workspace tip in an empty directory and the init tip otherwise", () => {
    expect(startupTips({ emptyWorkspace: true, hasClaudeMd: false }).filter((t) => t.isEnabled).map((t) => t.key)).toEqual(["workspace"]);
    expect(startupTips({ emptyWorkspace: false, hasClaudeMd: false }).filter((t) => t.isEnabled).map((t) => t.key)).toEqual(["claudemd"]);
  });
  it("marks the init tip complete once a CLAUDE.md exists, and never completes the workspace tip", () => {
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
  it("drops disabled tips, sorts incomplete first, and ticks the complete ones", () => {
    expect(renderTips(tips, false).map((l) => l.text)).toEqual(["  Unfinished thing", "  ✔ Finished thing"]);
  });
  it("appends the home-directory note last", () => {
    const out = renderTips(tips, true);
    expect(out.at(-1)!.text).toContain("home directory");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd harness && npx vitest run test/tui/banner.test.ts -t "Tips"`
Expected: FAIL — `startupTips` is not exported.

- [ ] **Step 3: Write the implementation**

In `src/tui/banner.ts`:

```ts
/** canon's tip inventory (L384137) — TWO entries, mutually exclusive on whether this is a fresh
 *  workspace, and both `isCompletable`. ccx's previous three static tips are gone (spec D-F8-7): a
 *  completion checklist whose entries can never complete is a checklist in shape only, and the
 *  affordances they named stay reachable from `? for shortcuts`. */
export interface Tip { key: string; text: string; isEnabled: boolean; isComplete: boolean }

export function startupTips(facts: { emptyWorkspace: boolean; hasClaudeMd: boolean }): Tip[] {
  return [
    { key: "workspace", text: "Ask Claude to create a new app or clone a repository", isComplete: false, isEnabled: facts.emptyWorkspace },
    { key: "claudemd", text: "Run /init to create a CLAUDE.md file with instructions for Claude", isComplete: facts.hasClaudeMd, isEnabled: !facts.emptyWorkspace },
  ];
}

/** canon's `Enc` (L559386): enabled only, incomplete first, `✔ ` on the complete, home-dir note last.
 *  The sort is `Number(isComplete) - Number(isComplete)` — stable, so same-state tips keep their order. */
export function renderTips(tips: readonly Tip[], inHomeDir: boolean): RenderLine[] {
  const rows = tips.filter((t) => t.isEnabled).slice()
    .sort((a, b) => Number(a.isComplete) - Number(b.isComplete))
    .map((t) => ({ text: `  ${t.isComplete ? "✔ " : ""}${t.text}`, dim: true }));
  if (inHomeDir) rows.push({ text: "  Note: You have launched ccx in your home directory. For the best experience, launch it in a project directory.", dim: true });
  return rows;
}
```

and replace the three literal tip lines in `welcomeBanner`'s `out` array with:

```ts
    { text: "  Tips for getting started" },
    ...renderTips(startupTips({ emptyWorkspace: info.emptyWorkspace === true, hasClaudeMd: info.hasClaudeMd === true }), info.inHomeDir === true),
```

adding `emptyWorkspace?: boolean; hasClaudeMd?: boolean; inHomeDir?: boolean;` to `BannerInfo`.

- [ ] **Step 4: Feed the three facts from the launch site**

In `src/cli/main.ts`, beside the `rows`/`screenReader` additions from Task 9:

```ts
              emptyWorkspace: readdirSync(cwd).filter((n) => !n.startsWith(".")).length === 0,
              hasClaudeMd: existsSync(join(cwd, "CLAUDE.md")),
              inHomeDir: cwd === homedir(),
```

importing `readdirSync`/`existsSync` from `node:fs`, `join` from `node:path`, `homedir` from `node:os`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd harness && npx vitest run test/tui/banner.test.ts && npm run typecheck`
Expected: PASS. Any existing assertion naming one of the three deleted tips must be updated, not
restored.

- [ ] **Step 6: Commit**

```bash
git add harness/src/tui/banner.ts harness/src/cli/main.ts harness/test/tui/banner.test.ts
git commit -m "f5(f8): T10 — tips become canon's two-entry completion checklist"
```

---

## Task 11: The `auto` theme resolves from the environment

**Files:**
- Modify: `src/tui/theme.ts`
- Test: `test/tui/theme.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `detectTerminalBackground(env?) → "dark" | "light" | undefined`,
  `resolveThemeId(id, env?) → ThemeId`.

- [ ] **Step 1: Write the failing test**

Add to `test/tui/theme.test.ts`:

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

- [ ] **Step 2: Run test to verify it fails**

Run: `cd harness && npx vitest run test/tui/theme.test.ts`
Expected: FAIL — neither function is exported.

- [ ] **Step 3: Write the implementation**

In `src/tui/theme.ts`, above `let current: ThemeId = "auto";`:

```ts
/** canon's `eTp` (L188328): the LAST `;`-separated field of COLORFGBG, an integer 0-15, where 0-6 and 8
 *  are dark. A pure env read — no terminal round trip, nothing to await, nothing to parse off the tty.
 *  (The OSC 11 query tier that canon also has is deferred whole — spec § 5.) */
export function detectTerminalBackground(env: NodeJS.ProcessEnv = process.env): "dark" | "light" | undefined {
  const raw = env.COLORFGBG;
  if (!raw) return undefined;
  const last = raw.split(";").at(-1);
  if (last === undefined || last === "") return undefined;
  const n = Number(last);
  if (!Number.isInteger(n) || n < 0 || n > 15) return undefined;
  return n <= 6 || n === 8 ? "dark" : "light";
}

/** `auto` stops being a static alias of dark. Everything else passes through untouched. The fallback is
 *  dark, which is exactly what `auto` resolved to before this wave — so a terminal that reports nothing
 *  sees no change at all. */
export function resolveThemeId(id: ThemeId, env: NodeJS.ProcessEnv = process.env): ThemeId {
  return id === "auto" ? (detectTerminalBackground(env) === "light" ? "light" : "dark") : id;
}
```

Then route the four `current`-keyed lookups through it — `themeTokens()`, `subagentTokens()`,
`setTheme()`'s `ACCENT` assignment, and `isLightTheme` where it is called with a possibly-`auto` id:

```ts
export function themeTokens(): ThemeTokens { return THEMES[resolveThemeId(current)]; }
export function subagentTokens(): SubagentTokens { return SUBAGENT_THEMES[resolveThemeId(current)]; }
export function setTheme(id: ThemeId): void { current = id; ACCENT = resolveThemeColor(THEMES[resolveThemeId(id)].claude); generation++; }
export const isLightTheme = (id: ThemeId) => resolveThemeId(id).startsWith("light");
```

and change the module-load `ACCENT` seed to `resolveThemeColor(THEMES[resolveThemeId("auto")].claude)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd harness && npx vitest run test/tui/theme.test.ts && npm run test:tui && npm run typecheck`
Expected: PASS. The full tui suite matters here — `themeTokens()` has many consumers, and a machine with
`COLORFGBG` set to a light value would otherwise flip colours under test. If any suite proves
environment-sensitive, pin `COLORFGBG` in that test rather than weakening the resolver.

- [ ] **Step 5: Commit**

```bash
git add harness/src/tui/theme.ts harness/test/tui/theme.test.ts
git commit -m "f5(f8): T11 — auto theme resolves from COLORFGBG instead of aliasing dark"
```

---

## Task 12: The desktop notifier

**Files:**
- Create: `src/tui/desktopNotify.ts`
- Test: `test/tui/desktopNotify.test.ts`

**Interfaces:**
- Consumes: `osc`, `passthrough`, `notifyTerminator`, `sanitizeNotificationText`, `BELL`, `OSC_ITERM2`,
  `OSC_KITTY`, `OSC_GHOSTTY` (Task 1); `resolveTerminalName` from `./altScreen.js`.
- Produces: `NotifChannel`, `NotifEvent`, `NOTIF_DEFAULT_EVENTS`, `resolveChannel(configured, env?)`,
  `createDesktopNotifier(deps)`.

- [ ] **Step 1: Write the failing test**

Create `test/tui/desktopNotify.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createDesktopNotifier, resolveChannel, NOTIF_DEFAULT_EVENTS } from "../../src/tui/desktopNotify.js";

const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;
function notifier(o: { env: NodeJS.ProcessEnv; channel?: any; events?: any }) {
  const writes: string[] = [];
  const n = createDesktopNotifier({
    write: (s) => writes.push(s), env: o.env,
    settings: () => ({ preferredNotifChannel: o.channel ?? "auto", enabledEvents: o.events ?? NOTIF_DEFAULT_EVENTS }),
  });
  return { n, writes };
}

describe("resolveChannel", () => {
  it("auto sniffs the terminal", () => {
    expect(resolveChannel("auto", env({ TERM_PROGRAM: "iTerm.app" }))).toBe("iterm2");
    expect(resolveChannel("auto", env({ TERM: "xterm-kitty" }))).toBe("kitty");
    expect(resolveChannel("auto", env({ TERM: "xterm-ghostty" }))).toBe("ghostty");
    expect(resolveChannel("auto", env({ TERM_PROGRAM: "Apple_Terminal" }))).toBe("terminal_bell");
    expect(resolveChannel("auto", env({ TERM_PROGRAM: "WezTerm" }))).toBe("none");
    expect(resolveChannel("auto", env({}))).toBe("none");
  });
  it("an explicit channel wins, and disabled means disabled", () => {
    expect(resolveChannel("ghostty", env({ TERM_PROGRAM: "iTerm.app" }))).toBe("ghostty");
    expect(resolveChannel("notifications_disabled", env({ TERM_PROGRAM: "iTerm.app" }))).toBe("none");
  });
});

describe("emitters", () => {
  it("iterm2 writes OSC 9 with 'title: body', wrapped under tmux", () => {
    const bare = notifier({ env: env({ TERM_PROGRAM: "iTerm.app" }) });
    bare.n.notify("idle_prompt", "ccx is waiting for your input");
    expect(bare.writes).toEqual(["\x1b]9;ccx: ccx is waiting for your input\x07"]);

    const muxed = notifier({ env: env({ TERM_PROGRAM: "iTerm.app", TMUX: "/tmp/s,1,0" }) });
    muxed.n.notify("idle_prompt", "hi");
    expect(muxed.writes[0]).toBe("\x1bPtmux;\x1b\x1b]9;ccx: hi\x07\x1b\\");
  });
  it("kitty writes three ST-terminated OSC 99 parts sharing one id", () => {
    const { n, writes } = notifier({ env: env({ TERM: "xterm-kitty" }) });
    n.notify("idle_prompt", "hi");
    expect(writes).toHaveLength(3);
    for (const w of writes) expect(w.endsWith("\x1b\\")).toBe(true);
    const id = writes[0]!.match(/i=([^:]+):/)![1];
    for (const w of writes) expect(w).toContain(`i=${id}:`);
    expect(writes[0]).toContain(":d=0:p=title;ccx");
    expect(writes[1]).toContain(":p=body;hi");
    expect(writes[2]).toContain(":d=1:a=focus;");
  });
  it("ghostty writes OSC 777;notify;title;body", () => {
    const { n, writes } = notifier({ env: env({ TERM: "xterm-ghostty" }) });
    n.notify("idle_prompt", "hi");
    expect(writes).toEqual(["\x1b]777;notify;ccx;hi\x07"]);
  });
  it("the bell is a BARE byte — never OSC-assembled, never DCS-wrapped", () => {
    const { n, writes } = notifier({ env: env({ TERM_PROGRAM: "Apple_Terminal", TMUX: "/tmp/s,1,0" }), channel: "terminal_bell" });
    n.notify("idle_prompt", "hi");
    expect(writes).toEqual(["\x07"]);
  });
  it("iterm2_with_bell writes the wrapped OSC then the bare bell", () => {
    const { n, writes } = notifier({ env: env({ TERM_PROGRAM: "iTerm.app", TMUX: "/tmp/s,1,0" }), channel: "iterm2_with_bell" });
    n.notify("idle_prompt", "hi");
    expect(writes).toHaveLength(2);
    expect(writes[0]!.startsWith("\x1bPtmux;")).toBe(true);
    expect(writes[1]).toBe("\x07");
  });
  it("an unknown terminal writes nothing at all", () => {
    const { n, writes } = notifier({ env: env({ TERM_PROGRAM: "WezTerm" }) });
    n.notify("idle_prompt", "hi");
    expect(writes).toEqual([]);
  });
});

describe("policy", () => {
  it("delivers the two blocking events by default and drops the rest", () => {
    const { n, writes } = notifier({ env: env({ TERM_PROGRAM: "iTerm.app" }) });
    n.notify("permission_prompt", "a"); n.notify("idle_prompt", "b");
    n.notify("agent_completed", "c"); n.notify("agent_needs_input", "d");
    expect(writes).toHaveLength(2);
  });
  it("delivers an opted-in event", () => {
    const { n, writes } = notifier({ env: env({ TERM_PROGRAM: "iTerm.app" }), events: ["agent_completed"] });
    n.notify("agent_completed", "c");
    expect(writes).toHaveLength(1);
  });
  it("sanitizes every dynamic part", () => {
    const { n, writes } = notifier({ env: env({ TERM_PROGRAM: "iTerm.app" }) });
    n.notify("idle_prompt", "a\x1b[31mb\x07c\x7fd\x9be");
    expect(writes[0]).toBe("\x1b]9;ccx: a [31mb c d e\x07");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd harness && npx vitest run test/tui/desktopNotify.test.ts`
Expected: FAIL — cannot resolve `desktopNotify.js`.

- [ ] **Step 3: Write the implementation**

Create `src/tui/desktopNotify.ts`:

```ts
// tui/src/desktopNotify.ts — F8 Task 12: OS-level notifications, per emulator.
//
// A SEPARATE PATH FROM `notifications.ts`, and deliberately so. That module is the in-terminal ephemeral
// hint queue with its own preemption, folding and pinning semantics; this one hands a string to the
// terminal emulator and forgets it. Canon keeps them apart too (`lH`, L505865, touches no notification
// store). Folding one into the other would couple a queue that reasons about screen real estate to a
// protocol that has none.
//
// Canon: channels `Mie` (L45315), default `"auto"` (L100411), auto-resolution `u9T` (L505906), the four
// emitters in `are()` (L202527-202566), copy at L678604 / L686789.
import { resolveTerminalName } from "./altScreen.js";
import { BELL, OSC_GHOSTTY, OSC_ITERM2, OSC_KITTY, notifyTerminator, osc, passthrough, sanitizeNotificationText } from "./terminalEscapes.js";

/** `Mie` (L45315), verbatim. */
export type NotifChannel = "auto" | "iterm2" | "terminal_bell" | "iterm2_with_bell" | "kitty" | "ghostty" | "notifications_disabled";
/** The reachable subset of canon's `Yxu` — the events ccx can actually observe. */
export type NotifEvent = "permission_prompt" | "idle_prompt" | "agent_needs_input" | "agent_completed";
/** A resolved delivery method; `"none"` covers disabled, unknown-terminal and no-method-available alike. */
export type ResolvedChannel = "iterm2" | "iterm2_with_bell" | "kitty" | "ghostty" | "terminal_bell" | "none";

/** DIVERGENCE FROM CANON (spec D-F8-5): canon's default fires every event. ccx defaults to the two that
 *  mean "ccx is blocked on you" and ships the other two off. A desktop notification is louder than any
 *  chrome this project has demoted before, and a notification for work that finished on its own is the
 *  kind nobody keeps enabled. Both remain settable. */
export const NOTIF_DEFAULT_EVENTS: readonly NotifEvent[] = ["permission_prompt", "idle_prompt"];

/** ccx's identity, standing in for canon's `sJm = "Claude Code"` (L505957) — the same rule the terminal
 *  title follows (spec D-C9): shape fidelity, not impersonation. */
export const NOTIF_TITLE = "ccx";

export interface NotifSettings { preferredNotifChannel: NotifChannel; enabledEvents: readonly NotifEvent[] }

/** canon's `u9T` (L505906), over `resolveTerminalName` — the terminal identity this codebase already
 *  computes for the kitty keyboard-protocol gate.
 *
 *  RECORDED DIVERGENCE (spec D-F8-11): canon's Apple Terminal arm is asynchronous — `await p9T()`
 *  inspects the active Terminal profile and returns `no_method_available` when it says no. ccx resolves
 *  synchronously and always chooses the bell. The cost is one byte an unconfigured terminal ignores;
 *  the alternative trades that for a notification that silently never arrives. */
export function resolveChannel(configured: NotifChannel, env: NodeJS.ProcessEnv = process.env): ResolvedChannel {
  if (configured === "notifications_disabled") return "none";
  if (configured !== "auto") return configured;
  switch (resolveTerminalName(env)) {
    case "iTerm.app": return "iterm2";
    case "kitty": return "kitty";
    case "ghostty": return "ghostty";
    case "Apple_Terminal": return "terminal_bell";
    default: return "none";
  }
}

export interface DesktopNotifierDeps {
  /** Direct stdout, bypassing Ink — the same arrangement `terminalTitle` uses and for the same reason. */
  write(s: string): void;
  /** Read at CALL time, never captured: a `/config` change mid-session must take effect on the next event. */
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
      // COMPOSITION IS PER CHANNEL. The bell in particular is a BARE byte: it is not an escape sequence,
      // so there is nothing for a multiplexer to pass through, and canon does not wrap it either — in
      // `iterm2_with_bell` the OSC half is wrapped and the BEL half is not.
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

- [ ] **Step 4: Run test to verify it passes**

Run: `cd harness && npx vitest run test/tui/desktopNotify.test.ts && npm run typecheck`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add harness/src/tui/desktopNotify.ts harness/test/tui/desktopNotify.test.ts
git commit -m "f5(f8): T12 — per-emulator desktop notifications; the bell stays a bare byte"
```

---

## Task 13: Wire the notifier to its two trigger sites

**Files:**
- Modify: `src/tui/chatMain.tsx`, `src/tui/useChat.ts`, `src/tui/prefs.ts`
- Test: `test/tui/chat.test.tsx`

**Interfaces:**
- Consumes: `createDesktopNotifier`, `NOTIF_DEFAULT_EVENTS` (Task 12).
- Produces: `CcxPrefs.preferredNotifChannel?: NotifChannel`, `CcxPrefs.notifEvents?: NotifEvent[]`;
  `useChat` gains an optional `notifier` dep.

**The idle condition is not "the turn ended".** `useChat.ts:1557` reads
`setStreaming([]); setBusy(false); … drainNext();` — a session with queued input goes busy again
immediately. Notifying there would fire between queued turns, when ccx is waiting on nobody.

- [ ] **Step 1: Write the failing test**

Add to `test/tui/chat.test.tsx`, following the `fakeRemote` + `pushEvent` pattern the queue tests in this
file already use (see the "Esc with a running turn and 3 queued messages" test for the shape):

```tsx
it("notifies on idle only when the queue is empty (F8 A8)", async () => {
  const events: string[] = [];
  const notifier = { notify: (e: string) => events.push(e) };
  let fake: ReturnType<typeof fakeRemote>;
  let n = 0;
  // A turn that starts, then ends on the next tick — enough for useChat to reach its settle path.
  fake = fakeRemote({
    submit: async () => {
      const seq = ++n;
      fake.pushEvent({ kind: "turn", phase: "start", seq });
      await new Promise((r) => setTimeout(r, 0));
      fake.pushEvent({ kind: "turn", phase: "end", seq });
    },
  });
  const { stdin, lastFrame } = render(
    <ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} deps={{ notifier }} />,
  );
  await waitFor(() => frame(lastFrame).includes("❯\u00a0"));

  stdin.write("alone"); await waitFor(() => frame(lastFrame).includes("alone"));
  stdin.write("\r");
  await waitFor(() => events.includes("idle_prompt"));      // empty queue → the user IS being waited on

  events.length = 0;
  stdin.write("first"); await waitFor(() => frame(lastFrame).includes("first"));
  stdin.write("\r");
  await waitFor(() => frame(lastFrame).includes("esc to interrupt"));
  stdin.write("second"); await waitFor(() => frame(lastFrame).includes("second"));
  stdin.write("\r");
  await waitFor(() => isQueued(lastFrame, "second"));       // a turn is running with one queued behind it
  await waitFor(() => n === 3);                             // the queued prompt drained into its own turn
  // The FIRST turn settled with a queued prompt waiting, so it must not have notified. Exactly one
  // idle_prompt is legal here — the one from the LAST turn, which settled with an empty queue.
  expect(events.filter((e) => e === "idle_prompt")).toHaveLength(1);
});
```

`ChatApp` already carries a `deps` prop (it threads `deps?.now` to `CompactionRow` at `ChatApp.tsx:1586`);
`notifier` joins it there and is forwarded into `useChat`'s deps.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd harness && npx vitest run test/tui/chat.test.tsx -t "notifies on idle"`
Expected: FAIL — `useChat` accepts no `notifier` dep.

- [ ] **Step 3: Add the preferences**

In `src/tui/prefs.ts`, add to `CcxPrefs`:

```ts
  preferredNotifChannel?: NotifChannel; notifEvents?: NotifEvent[];
```

with the same drop-on-invalid validation the loader applies to `theme` — an unknown channel string is
dropped rather than passed through, because `resolveChannel` would otherwise return it verbatim as a
resolved channel and the switch would fall through to no write at all, which reads as "notifications are
broken" rather than "that setting is invalid".

- [ ] **Step 4: Construct the notifier**

In `chatMain.tsx`, beside the `createTerminalTitle` construction:

```ts
  const notifier = createDesktopNotifier({
    write: (s) => { if (process.stdout.isTTY) process.stdout.write(s); },
    settings: () => ({
      preferredNotifChannel: prefs.preferredNotifChannel ?? "auto",
      enabledEvents: prefs.notifEvents ?? NOTIF_DEFAULT_EVENTS,
    }),
  });
```

and thread it into `useChat`'s deps.

- [ ] **Step 5: Call it at the two sites**

In `useChat.ts`, at the turn-settled line (~1557), after `setBusy(false)`:

```ts
        // The queue is the condition, not the turn: `drainNext()` on the next line may start another turn
        // immediately, and a notification fired between two queued turns tells the user ccx wants them
        // when it does not.
        if (queueRef.current.length === 0) deps.notifier?.notify("idle_prompt", "ccx is waiting for your input");
```

(read the queue through whatever accessor this file already uses at that point; do not add a second
source of truth for queue depth). At the consult-dialog seam, where a permission decision is parked:

```ts
        deps.notifier?.notify("permission_prompt", `ccx needs your permission to use ${toolName}`);
```

- [ ] **Step 6: Run the tests**

Run: `cd harness && npm run test:tui && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add harness/src/tui harness/test/tui
git commit -m "f5(f8): T13 — notifier wired to the permission and idle seams; idle gates on an empty queue"
```

---

## Task 14: Final verification — the spec's acceptance, executed

**Files:**
- Modify: `docs/parity/tui-ux.md`, `docs/parity/coverage.md`,
  `docs/superpowers/specs/2026-08-20-f8-spinner-startup-terminal-design.md` (§ 9)
- Test: everything

- [ ] **Step 1: Run every gate**

```bash
cd harness && npm run typecheck && npm run test:unit && npm run test:tui && npm run test:resize-matrix
```

Expected: all green. Record the exact counts in the task report.

- [ ] **Step 2: Execute the keyless acceptance cells**

Work through spec § 4 cells **A1, A2, A3a, A3b, A3c, A4, A4b, A6, A7, A8, A8b, A9** and record for each
one: PASS/FAIL, the command run, and the observed output. These are all reachable from the unit and tui
suites plus the tmux driver.

- [ ] **Step 3: Execute the live pty cells**

Under an isolated HOME beneath `/tmp` with `CCX_FLEET_ROOT` set, and using prefixed tmux session names
killed individually — **never `tmux kill-server`** — run **A5, A10, A10b**. A10b is the narrowed survivor
of probe P93's write half: with the fullscreen renderer up and a non-empty transcript, fire ten
notifications including the kitty three-write form and the DCS-wrapped form, and compare the visible
frame's content and geometry before and after.

- [ ] **Step 4: Hand the owner the manual cell**

A11 cannot be automated. Write a short reproduction script and report it to the owner rather than
attempting it: in a real iTerm2 or Ghostty window, confirm that a permission prompt raises a system
notification, that the tab title reads `✳ …` at idle and alternates while busy, and that killing ccx
with `SIGTERM` restores the tab title. Record it in the spec's § 9 as **owner-verified pending**, with
the date and terminal to be filled in when they run it.

- [ ] **Step 5: Rescore the parity documents**

In `docs/parity/tui-ux.md`: § 3 (chrome) and § 6 (polish) are the sections this wave moves. Take the
spinner glyph and verb rows, terminal title, desktop notifications, tab status, and reduced motion to
their earned states; add the three deferred surfaces from spec § 5 to the tail list **with their
evidence**. In `docs/parity/coverage.md`: add the wave's entry and state plainly that **no domain score
moves** — F8 consumes no SDK surface at all, exactly as the fullscreen and tool-stream waves did.

- [ ] **Step 6: Write the retrospective and the memory**

Fill spec § 9 (`Outcomes & Retrospective`) with what shipped, what the acceptance run found, and every
divergence held. Refresh the corresponding memory file.

- [ ] **Step 7: Commit**

```bash
git add CC-to-SDK/docs
git commit -m "f5(f8): T14 — acceptance executed, parity rescored, wave closed out"
```

---

## Self-Review

**Spec coverage.** Every § 3 unit maps to tasks: 3.1 → T1/T2, 3.2 → T3/T4/T5/T6, 3.3 → T9/T10,
3.4 → T7/T8/T11/T12/T13. Every § 4 cell is executed in T14. Every § 5 deferral is recorded in T14
Step 5. Spec § 6's eight landing stages map onto T1–T13 in order.

**Type consistency.** `reducedMotion` is the prop name on all four components and the function name in
`motion.ts` — the function is imported once, in `chatMain.tsx`, and the value is passed as a prop
thereafter, so the shadowing is confined to one file. `glyphFor(elapsedMs, env)` has the same signature
at both call sites. `TaskItem.subagent?: true` is written in T5 and read only in T6's
`activeSpinnerTask`. `NotifSettings` is defined in T12 and constructed in T13.

**Placeholder scan.** One was found and fixed rather than shipped: T13 Step 1 originally carried two
ellipses where the turn-completion driver belonged. It now transcribes the real `fakeRemote` +
`pushEvent` pattern the queue tests in that file already use.

**Two steps deliberately read surrounding code rather than transcribe it**, and both say so at the point
of use: T13 Step 5 reads the queue through whatever accessor is already in scope at `useChat.ts:1557`
(adding a second source of truth for queue depth would be worse than naming the first), and T8 Step 4
reuses `RetryRow`'s existing countdown arithmetic while swapping only its animation source. Neither is a
gap in the requirements — both are instructions to not duplicate.
