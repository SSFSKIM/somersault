# bl10 fix wave 9 report — Settings read-only scroll window skips an oversized line

## Status
Done. One commit on `main`, no `Co-Authored-By`, explicit-path staging (`git add
src/tui/SettingsDialog.tsx test/tui/settings-dialog.test.tsx` — never `git add -A`; the
pre-existing untracked `fixwave{6,7,8}-*.md` files and the unrelated modified
`../reforge/m2/raw-protocol.ts` / `../reforge/ctx.tmp.ts` were left alone).

## Commit
- `2a30510e9` — bl10 fw9: an oversized logical line in a Settings read-only tab stays reachable

## The finding
`readOnlyScrollWindow` (`SettingsDialog.tsx` ~:157-175) windowed the read-only tab body
(Status/Usage/Stats) by LOGICAL lines: the `end` loop adds `costs[end]` (that line's own
wrapped-row cost, from `paintedRows`) until the budget would be exceeded. When ONE line's
wrapped cost alone exceeded the whole budget, the loop broke on its very first iteration
(`end === start`), and `readOnlyTabBody` sliced `lines.slice(start, start)` — an empty
range. Because scrolling advances by logical lines, that line rendered at NO offset:
permanent, unconditional content loss, on exactly the payload the wave-8 scroll window
was built to keep fully reachable (spec D13).

## Red evidence
Added a `describe("SettingsDialog — an oversized logical line stays reachable instead of
being skipped (bl10 fw9)")` block to `test/tui/settings-dialog.test.tsx`: a payload of
7 lines at `rows={15} columns={100}` (overflow budget 6 painted rows) — three short lines,
one line of 600 unbroken `X` characters (costs `ceil(600/98) = 7` painted rows, one more
than the budget), then three more short lines. Scrolling down 3 (down arrow → `select:next`)
puts `start` at index 3, the oversized line.

Before the fix, `expect(f).toMatch(/X{10,}/)` on the post-scroll frame failed:

```
- Expected: /X{10,}/
+ Received:
"
────────────────────────────────────────────────────────────────────────────────────
 Settings
  Status   Config   Usage   Stats

 ↑ 3 more above
 ↓ 4 more below

 Esc cancel · ↑ navigate · Tab switch tab"
```

The oversized line is entirely absent from the frame — the exact skip the finding
describes — while `↑ 3 more above` / `↓ 4 more below` claim everything else is accounted
for.

## The fix
`readOnlyScrollWindow` now detects `end === start` (the line at `start` alone exceeded
`budget`) and:
- forces `end = start + 1` so the line still counts as "shown" and scrolling advances
  past it instead of getting stuck skipping it forever,
- returns a new `oversizedRows` field (`= budget`) telling the caller how many of that
  line's `paintedRows` fit.

`readOnlyTabBody` checks `win.oversizedRows`: when set, it paints only
`paintedRows(lines[win.start].text, width).slice(0, win.oversizedRows).join("\n")` (the
line's head) instead of the whole line, and forces the `below` count to at least 1 even
when `lines.length - win.end === 0`, so the down marker never lies by omission about the
line's own hidden tail — "the overflow markers still accounting truthfully," per the
brief. `above`/`below` for every other case (full logical lines) are unchanged.

Deeper physical-row scrolling inside one oversized line was explicitly out of scope this
round — showing its head with the `↓ more` marker is what the brief asked for, and that
is what shipped: no logical line is unreachable, but panning further into a single
giant line is not (yet) supported.

## Test output

```
npx vitest run test/tui/settings-dialog.test.tsx
✓ test/tui/settings-dialog.test.tsx (32 tests)
```

(3 new tests replaced the temporary 1-test red probe, which was removed once its
assertion inverted post-fix: head-renders-and-stays-in-budget, the wave-2/wave-8
frame-height invariant walked across the oversized line, and a normal payload unaffected.)

```
npm run typecheck
> tsc --noEmit
(clean, no output)
```

```
npx vitest run test/tui/
Test Files  201 passed | 10 skipped (211)
     Tests  5101 passed | 11 skipped (5112)
  Duration  178.02s
```

## Concerns
None blocking. Two narrower, in-scope-limitation notes for the record:
- The fix truncates by overriding the `RenderLine.text` field on a shallow copy; a line
  that also carried `segments` (none of the Status/Usage/Stats formatters — `formatCost`/
  `formatStatus`/`formatUsage` — currently emit any) would still render its full,
  un-truncated segment content, since `Line.tsx` prefers `segments` over `text`. Not
  exercised by any current caller, and fixing it would mean segment-aware slicing with no
  present motivating case — deferred, not fixed silently.
- `maxOffset`'s reverse-accumulation loop can still return `costs.length` (one past the
  last valid index) if the very last line's own cost alone exceeds `budget` — a pre-existing,
  narrower shape of the same class of bug, but not the one this brief named (its scroll
  loop already handles that value correctly via `Math.min(offset, maxOffset)` and this
  round's `oversized` branch), so left as tech debt rather than folded into this fix.
