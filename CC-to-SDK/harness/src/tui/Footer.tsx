// tui/src/Footer.tsx — Wave C Task 2 (EP-C1b): everything below the composer's bottom rule, in ONE row.
//
// It replaces `ChatStatusBar.tsx` (deleted) and the hint stack `ChatComposer` used to paint under itself.
// Canon is `oVf` (L494667) → `Wci` (L493714) → `ctl` (L493890), summarised in annex §C1.1–§C1.5:
//
//   <Box width flexDirection="row" paddingLeft={2} paddingRight={2} columnGap={1}>   ← `Btl`, L494667
//     <Box flexDirection="column" flexShrink={1}>                                    ← LEFT region `Ftl`
//       {statusLine row}                                                             ← `Otl`
//       {footer row}                                                                 ← `Ntl` = <Wci/>
//     </Box>
//   </Box>
//
// `Wci` early-returns FOUR states that replace the whole row before it ever reaches the mode chip, and only
// then draws `⏸ manual mode on[ (shift+tab to cycle)] · {hints}`. The hint list truncates rather than
// wrapping and joins with a dim `" · "`; the row itself is `height={1} overflow="hidden"` so nothing below
// the composer can ever grow the block by a line.
//
// FOUR THINGS UPSTREAM PUTS HERE THAT CCX DOES NOT (plan constraint 12, each a recorded divergence):
//
//  1. THE RIGHT REGION (`Wtl`, L494681 — `marginLeft:"auto"`, `alignItems:"flex-end"`). Upstream stacks the
//     ephemeral-notification slot and the persistent chips (HIPAA badge, cloud-session badge, IDE badge,
//     `Debug`, `focus`/`memory paused` labels) there. ccx has NONE of those chips, and the notification slot
//     is mounted above the composer instead (spec EP-C1 §2, the `ds()` branch at L496241 — see
//     `ChatComposer.tsx`'s overlay mount for the measurement that settled its shape). An empty right region
//     would be an empty Box; it is omitted rather than rendered hollow, and the LEFT region's `flexShrink`
//     and the outer padding are kept so re-adding one is a one-element change.
//  2. `composerOwnsKeys` IS OURS, NOT UPSTREAM'S. Upstream's footer is mounted BY the composer (L496241) and
//     therefore cannot outlive it. ccx mounts this in `ChatApp`, one row below every dialog, exactly where
//     `ChatStatusBar` used to sit — because three dialog height budgets count one unconditional sibling
//     (`rewindModel.ts`'s `REWIND_CHROME_ROWS` and friends). So the chord-bearing content — the
//     `(shift+tab to cycle)` parenthetical and the whole hint list — is gated on the composer actually
//     holding the keyboard, which is F0's honesty rule and the same prop `ChatStatusBar` took for the same
//     reason. The CHIP carries no chord and stays: it is a statement about the session, not an offer.
//  3. THE VIM INDICATOR (`Wel`, L493786, `-- INSERT --`) has no ccx counterpart; there is no vim mode.
//  4. THE INLINE HISTORY-SEARCH BOX (`RMr`, L493783) is upstream's first child of this row. In ccx the search
//     state lives inside `ChatComposer` (`useInlineHistorySearch`), which renders `InlineSearchRow`
//     immediately above this component — visually the same slot, one row up. What DOES cross the boundary is
//     the `searching` flag, because it is half of `suppressHint`. Hoisting the box itself would mean
//     threading the query, the failed-match flag and the live editor state through `ChatApp`; the visible
//     difference is one row of vertical position while a search is open.
//
// THE EXIT-ARM KEY IS A PROP AND NEVER A LITERAL HERE. Upstream's input hook passes `Dci.key` into
// `exitMessage` and `Wci` prints whatever it is given (L493757). Ours does the same, from the arm site in
// `ChatApp` — which is also what lets this file join `test/tui/keys-acceptance.test.tsx`'s banned-chord
// sweep (that test reads the footer source OFF DISK and fails any hard-coded chord spelling in it).
import React from "react";
import { Box, Text } from "ink";
import { modeColor, modeIndicator, modeSymbol, isHomeMode } from "./modeTable.js";
import { buildHintList, HINT_JOINER, type AgentsState, type HintSegment } from "./footerModel.js";
import { expandHintText, formatBindingLower } from "./keys/hints.js";
import { resolveThemeColor, themeTokens } from "./theme.js";
import { statusLineRows } from "./statusLine.js";

/** `Pasting…` (L493764) — one ellipsis CHARACTER. Re-exported from here now that the composer no longer
 *  owns the row; `ChatComposer.tsx` keeps its own copy for the paste tests that predate this file. */
export const FOOTER_PASTING_TEXT = "Pasting…";
/** L493772. */
export const FOOTER_PASTE_EXPAND_HINT = "paste again to expand";
/** L493959 — the bash-mode row, upstream's own literal, in `bashBorder`. */
export const FOOTER_BASH_HINT = "! for shell mode";

export interface FooterExitArm {
  /** `Ctrl-C` / `Ctrl-D`, hyphenated — upstream's own spelling (plan constraint 11). A PROP; see the header. */
  key: string;
  /** `exit` · `/clear` · `detach (session keeps running)` (L493757–L493763). */
  verb: string;
}

export interface FooterProps {
  mode: string;
  busy: boolean;
  /** `q1b` — the live draft is non-empty. Kills the hint list (annex §C1.5). */
  draftNonEmpty: boolean;
  /** `DMr` — kills the agents affordance on its own. `!draftNonEmpty` in practice; both are carried because
   *  upstream carries both and they are read by different clauses. */
  isInputEmpty: boolean;
  /** The inline history search is open. Half of `suppressHint`, and the one thing that suppresses the
   *  paste-expand hint (L493769). */
  searching: boolean;
  /** EP-C2's rendered line — the script's own normalized stdout, ANSI and all. `useChat`'s driver publishes
   *  it (Wave C Task 10); undefined until the first successful run, and it never goes back to undefined,
   *  because a failing script leaves the previous text standing (statusLine.ts's "every failure is silence"). */
  statusLineText?: string;
  /** `Mtl` — a statusLine is configured. Suppresses the hint list all by itself (qa6-03's mechanism), and it
   *  is a SEPARATE fact from `statusLineText`: the hints go the moment the setting exists, whether or not
   *  the command has produced a line yet. */
  statusLineConfigured: boolean;
  /** `V = u?.padding ?? 0` (L494935) — `paddingX` on the statusLine slot alone, not on the footer row. */
  statusLinePadding?: number;
  /** The pane height, for the `Rtl` term of the statusLine guard below. Defaults to the POSIX 24 that
   *  `ChatApp.readSize` falls back to, so a bare render is a normal-sized terminal. */
  rows?: number;
  exitArm?: FooterExitArm;
  pasting: boolean;
  pasteExpandHint: boolean;
  bashMode: boolean;
  agents: AgentsState;
  /** The live binding lookup (`useBindingLookup()` in the app, `defaultLookup` in a bare render). Every
   *  chord this component prints is derived through it — F2 task 10's rule, unchanged. */
  bindings: (action: string) => readonly string[];
  /** Divergence 2 in the header. Defaults to true so a bare render is the composer-owned case. */
  composerOwnsKeys?: boolean;
  /** The agents flash's clock (`Lci`). Injected so a test can place `now` rather than wait 2.5 s. */
  now?: () => number;
}

/** `nVf` (L494585) — the pane height below which `Rtl` hides the statusLine row. */
export const STATUS_LINE_MIN_ROWS = 15;

const dimRow = (text: string) => <Box height={1} overflow="hidden"><Text dimColor>{text}</Text></Box>;

/** The slice of the footer's props the statusLine slot is a function of. Its own type so the two readers —
 *  this component and the fullscreen dock's reservation — cannot be handed different facts. */
export type FooterStatusInput = Pick<FooterProps, "statusLineConfigured" | "statusLineText" | "bashMode" | "pasting" | "exitArm" | "rows">;
/** The statusLine slot's HEIGHT: zero when it is not drawn, one per line of the script's output when it is.
 *  Exported for the fullscreen dock budget (FSW T13b review I4), which charged this whole component ONE row —
 *  true of the hint/chip row alone. With a statusLine configured the footer is taller than the reserve knew,
 *  and the dialog above it composed into rows the frame then clipped. Same predicate, same `statusLineRows`
 *  the slot is rendered from, so the reserve cannot drift from the paint. */
export function footerStatusRows({ statusLineConfigured, statusLineText, bashMode, pasting, exitArm, rows = 24 }: FooterStatusInput): number {
  const visible = statusLineConfigured && statusLineText !== undefined && statusLineText !== ""
    && !bashMode && !exitArm && !pasting && rows >= STATUS_LINE_MIN_ROWS;
  return visible ? statusLineRows(statusLineText).length : 0;
}
/** Every row the footer paints: its one unconditional row (the chip / hint / arm line, which always draws)
 *  plus the statusLine slot above it. */
export const footerRows = (input: FooterStatusInput): number => 1 + footerStatusRows(input);

/** One hint's spans. `dimColor` is `$Rr`'s default for an uncoloured run (L488834). */
function HintSpans({ hint }: { hint: HintSegment }) {
  return <>{hint.spans.map((s, i) => <Text key={i} color={s.color ? resolveThemeColor(themeTokens()[s.color]) : undefined} dimColor={s.dim}>{s.text}</Text>)}</>;
}

export function Footer({ mode, busy, draftNonEmpty, isInputEmpty, searching, statusLineText, statusLineConfigured, statusLinePadding, rows = 24, exitArm, pasting, pasteExpandHint, bashMode, agents, bindings, composerOwnsKeys = true, now }: FooterProps) {
  // `Otl`'s gate (L494626), all five terms — `mode === "prompt" && !Rtl && !exitMessage.show && !isPasting
  // && statusLineConfigured`, with `Rtl = ds() && rows < 15` (`nVf = 15`, L494585). Notably NOT behind
  // `suppressHint`, which the row is itself an input to: a configured statusLine hides `? for shortcuts`
  // and then draws in the space that frees.
  //   · `mode === "prompt"` IS `!bashMode` HERE. Upstream's `mode` on this line is the COMPOSER's input mode
  //     (`mP`, the two-valued `prompt | bash` read — promptMode.ts), and ccx already carries that half of it
  //     as the `bashMode` prop the row-replacement branch below reads. ccx used to carry a THIRD mode here
  //     (`#` memory, CM65) with no upstream counterpart; Wave C Task 14 removed it, so the two-valued read is
  //     now literally upstream's and there is no third case for this component to have ignored.
  //   · The 15-row floor is upstream's protection for a pane too short to spare a line, and it is a real
  //     risk here for the same reason: three dialog height budgets already count the footer's one row
  //     (`rewindModel.REWIND_CHROME_ROWS` and friends), and this is a SECOND one they do not know about.
  //
  // THE DIVERGENCE RECORDED HERE IN WAVE C IS RETIRED (W2 T6, canon Q4). It read "upstream renders a
  // RESERVED BLANK ROW when a statusLine is configured but has produced no text yet"; the bundle shows the
  // blank is gated on `ds()` (L484981) — the FULLSCREEN / alternate-screen predicate, not a statusLine
  // concept. In the main-screen renderer, which is where ccx and canon both live by default, the slot
  // renders `null` and the footer moves up. Rendering nothing IS canon here.
  //   That gate now carries more weight than it did, because W2 T6 made a failing script take the row down
  // (`statusLineText` returns to undefined) rather than leaving the last good line standing. So this
  // condition is what implements "the row is removed on failure", and the layout does jump by one line when
  // a script breaks — which is precisely what the sweep measured claude doing.
  //   The predicate itself lives in `footerStatusRows` above, because the dock's row reservation has to ask
  // the same question and a second copy of it is a second thing to keep in step.
  const statusVisible = footerStatusRows({ statusLineConfigured, statusLineText, bashMode, pasting, exitArm, rows }) > 0;
  // `g3f` (L484937): one `<Text dimColor wrap="truncate">` for a single line, a `flexDirection="column"` of
  // them for several. Each row arrives from `statusLineRows` as FINISHED BYTES — see that function for why
  // Ink's `dimColor` prop cannot express "dim over the script's own ANSI" — so these are bare `<Text>`s and
  // no chalk wrapper gets a chance to rewrite what the script emitted. `wrap="truncate"` is Ink's own, and
  // it ends an over-wide line with `…` rather than wrapping it onto a second row.
  const statusRow = statusVisible ? ((): React.ReactElement => {
    const lines = statusLineRows(statusLineText!);
    return (
      <Box paddingX={statusLinePadding ?? 0} gap={2}>
        {lines.length === 1
          ? <Text wrap="truncate">{lines[0]}</Text>
          : <Box flexDirection="column">{lines.map((l, i) => <Text key={i} wrap="truncate">{l}</Text>)}</Box>}
      </Box>
    );
  })() : null;

  const row = ((): React.ReactElement => {
    // `Wci`'s four early returns, in upstream's own order (L493757–L493777, L493959).
    if (exitArm) return dimRow(`Press ${exitArm.key} again to ${exitArm.verb}`);
    if (pasting) return dimRow(FOOTER_PASTING_TEXT);
    if (pasteExpandHint && !searching) return dimRow(FOOTER_PASTE_EXPAND_HINT);
    if (bashMode) return <Box height={1} overflow="hidden"><Text color={resolveThemeColor(themeTokens().bashBorder)}>{FOOTER_BASH_HINT}</Text></Box>;

    // The chip. `{symbol} {indicator} on` (annex §C4.c) — the word `on` is a literal suffix, always present.
    // `HRn = !aPi(mode)`: the parenthetical is suppressed on the home state and nowhere else.
    const cycle = !isHomeMode(mode) && composerOwnsKeys ? expandHintText(bindings("chat:cycleMode"), process.platform, "cycle") : "";
    const chip = (
      <Text color={modeColor(mode)}>
        {modeSymbol(mode)}{" "}{modeIndicator(mode)}{" on"}
        {cycle !== "" ? <Text dimColor>{" " + cycle}</Text> : null}
      </Text>
    );
    const interruptKeys = bindings("chat:cancel");
    // WAVE C TASK 6 MOVED THE AFFORDANCE BACK, and this is where it landed. Task 2 shipped a `.filter` below
    // this list that built the `interrupt` hint and then dropped it, because ccx's spinner tail carried the
    // same offer (`(3s · 142 tokens · esc to interrupt)`) and printing both would have put it on two
    // adjacent rows. The spinner tail is canon's `C0p` parenthetical now, and that carries no interrupt
    // offer at all — so the footer is once again the only place it appears, exactly as upstream's own footer
    // has it (`⏸ manual mode on · esc to interrupt · ← for agents`, annex §C4.c). The hint was always BUILT,
    // because it is what crowds `? for shortcuts` out while a turn runs (annex §C1.3 #3); only the filter is
    // gone. NB it spells whatever chord is bound, so a rebound `chat:cancel` reads `alt+c to interrupt` —
    // which the old spinner literal could not do, and which a test needle must not assume away.
    const hints = (composerOwnsKeys
      ? buildHintList({
          showHint: !(draftNonEmpty || searching || statusLineConfigured),
          isInputEmpty, mode, busy,
          interruptChord: formatBindingLower(interruptKeys.find((k) => !k.includes(" ")) ?? interruptKeys[0]),
          agents, now: now ? now() : Date.now(),
        })
      : []);
    return (
      <Box height={1} overflow="hidden">
        <Text wrap="truncate">
          {chip}
          {hints.map((h) => <React.Fragment key={h.key}><Text dimColor>{HINT_JOINER}</Text><HintSpans hint={h} /></React.Fragment>)}
        </Text>
      </Box>
    );
  })();

  return (
    <Box flexDirection="row" flexWrap="wrap" alignItems="flex-start" paddingLeft={2} paddingRight={2} columnGap={1}>
      <Box flexDirection="column" flexShrink={1}>{statusRow}{row}</Box>
    </Box>
  );
}
