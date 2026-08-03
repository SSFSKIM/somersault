// test/tui/sgr-passthrough.test.tsx — F3 Task 1: pins the raw-SGR passthrough seam the bold-count
// mechanism stands on. F1 proved `<Text dimColor bold>` drops bold (emits `\x1b[2m…\x1b[22m`, never
// `\x1b[1m`), so the only way to put a BOLD count inside a DIM run is to hand Ink the bytes ready-made.
// A `preStyled` Segment renders through a BARE <Text>; these tests are the pin on that.
//
// ONE observed caveat, measured here and pinned by the third test: Ink does not pass a frame's bytes
// through untouched — its output pipeline parses the text into styled characters and re-emits a MINIMAL
// SGR stream, so codes that change nothing get dropped (`\x1b[22m\x1b[22m` → `\x1b[22m`, a close
// immediately followed by a re-open of the same attribute → just the re-open, a trailing no-op closer →
// nothing) and an unclosed attribute gets an auto-closer appended. That is normalization, NOT mangling:
// every code that changes the rendered style survives byte-for-byte, `\x1b[1m` included. A STYLED <Text>
// is the mangling case, and the last test holds the two apart.
import { test, expect } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { Text } from "ink";
import { Line } from "../../src/tui/Line.js";

const DIM = "\x1b[2m", BOLD = "\x1b[1m", B_OFF = "\x1b[22m";

test("an unstyled Text preserves raw SGR bytes verbatim (the mechanism's load-bearing premise)", () => {
  const raw = `${DIM}Read ${BOLD}3${B_OFF} files${B_OFF}`;
  const { lastFrame } = render(<Line l={{ text: raw, segments: [{ text: raw, preStyled: true }] }} />);
  // Byte-identical through the last code that carries meaning: the nested `\x1b[1m` is still there and the
  // author's `\x1b[22m` still reads as written (a PLAIN " files" tail), i.e. chalk did not rewrite the
  // nested closer. Only the fixture's trailing second `\x1b[22m` — a no-op, the first already turned both
  // bold and dim off — is absent, dropped by Ink's minimal re-emit.
  expect(lastFrame()).toContain(`${DIM}Read ${BOLD}3${B_OFF} files`);
  expect(lastFrame()).toContain(BOLD);                              // the byte `<Text dimColor bold>` cannot produce
});

test("a preStyled segment coexists with ordinary styled siblings", () => {
  const raw = `${DIM}x${B_OFF}`;
  const { lastFrame } = render(<Line l={{ text: `● ${raw}`, segments: [
    { text: "● ", color: "green" }, { text: raw, preStyled: true },
  ] }} />);
  expect(lastFrame()).toContain(raw);
});

test("the clause-run shape F3 Task 2 will emit renders with the intended styling", () => {
  // What Task 2 hands over: dim clause, bold count, dim again. Ink collapses the `\x1b[22m\x1b[2m` hinge
  // to a bare `\x1b[2m` (same rendered result, one code fewer) and supplies the final closer itself.
  const raw = `${DIM}Read ${BOLD}3${B_OFF}${DIM} files${B_OFF}`;
  const { lastFrame } = render(<Line l={{ text: raw, segments: [{ text: raw, preStyled: true }] }} />);
  expect(lastFrame()).toContain(`${DIM}Read ${BOLD}3${DIM} files${B_OFF}`);
});

test("the styled path mangles the same bytes — which is why preStyled exists", () => {
  // " files" is written PLAIN (the `\x1b[22m` closes the dim). Through a styled <Text> chalk rewrites that
  // closer into `\x1b[2m` to restore its own dim, so the tail comes out dim — the author's intent lost.
  const raw = `${DIM}Read ${BOLD}3${B_OFF} files`;
  // The ride-along `dim: true` is the guard's teeth (review finding): preStyled must WIN over it. Without
  // the ride-along, deleting the preStyled branch sends this segment down the styled path with every prop
  // undefined — an identical frame, and the contrast proves nothing.
  const bare = render(<Line l={{ text: raw, segments: [{ text: raw, preStyled: true, dim: true }] }} />).lastFrame();
  const styled = render(<Line l={{ text: raw, segments: [{ text: raw, dim: true }] }} />).lastFrame();
  expect(bare).toContain(`${BOLD}3${B_OFF} files`);
  expect(styled).toContain(`${BOLD}3${DIM} files`);
  expect(bare).not.toEqual(styled);
});

test("preStyled ignores any style fields that ride along on the same segment", () => {
  const raw = `${DIM}x${B_OFF}`;
  const seg = { text: raw, preStyled: true as const, color: "green", dim: true, bold: true };
  const { lastFrame } = render(<Line l={{ text: raw, segments: [seg] }} />);
  expect(lastFrame()).toEqual(render(<Text>{raw}</Text>).lastFrame());
});
