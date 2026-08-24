# T-IMGREACH — Task 14 track verification: acceptance cells 8–12 + boundary roll-up

Branch `f10-imgreach`, head `a4b774f22c` at the time this ledger was written. No implementation in this
task — it runs the cells spec v4 acceptance 8–12 requires and records the evidence. Full report:
`.doperpowers/sdd/2026-08-23-f10-t-imgreach/task-14-report.md`.

**Headline finding, as originally recorded (read this before the cell log): Cell 12's live pty half
fails.** The I6 ambient clipboard hint (Task 13) is built and its own unit/component suite is green, but a
live tmux-pty run of the real `ccx` binary never produces the hint. Root cause and reproduction are under
"Cell 12" below. This is a genuine, live-verified defect against a spec acceptance criterion, not a tooling
or environment blocker.

**Update — fix wave closed this finding.** `ChatApp.tsx` now threads `readClipboardImage`/
`checkClipboardImage` to `<ChatComposer>`; a mounted regression (`clipboardHintChatAppWiring.test.tsx`)
proves the wiring through production code paths (red-before/green-after measured), and the same
tmux + fake-`osascript` pty recipe now shows the hint firing live. See "Fix wave update (Task 14 Cell 12
finding, closed)" under Cell 12 below for full evidence.

---

## Cell 8 — no stranded sessions (keyed live)

New suite `test/live/image-reach.e2e.test.ts` — three submit paths, each an IMAGE-ONLY array (no text
block at all), each asserted present in `listSessions({cwd})` with a non-empty `firstPrompt`:

- (a) the real REPL topology — `SessionHost` + `remoteChatSession`, the same `buildSession` seam
  `chatMain.tsx` uses (copied from `test/live/image-submit.e2e.test.ts`'s own harness).
- (b) a direct `Session.submit([image])` via `openSession()`.
- (c) `harness.run([image])` via `createHarness()`.

Run: `set -a; . ../.env; set +a; npx vitest run test/live/image-reach.e2e.test.ts` (model
`claude-sonnet-4-6`, OAuth-token-billed, no output containing the token).

```
 RUN  v2.1.9 /Users/new/Developer/GitHub/codex_somersault/.claude/worktrees/f10-imgreach/CC-to-SDK/harness

(node:5649) [CLAUDE_SDK_CAN_USE_TOOL_SHADOWED] Warning: canUseTool will not be invoked: permissionMode 'bypassPermissions' auto-approves every tool call (except explicit deny rules) before the callback is consulted. To gate every tool call, use a PreToolUse hook instead.
(Use `node --trace-warnings ...` to show where the warning was created)
 ✓ test/live/image-reach.e2e.test.ts (4 tests) 22721ms
   ✓ F10 T-IMGREACH Task 14 — acceptance 8: no stranded sessions (three submit paths) > (a) the real REPL topology: an image-only submit through SessionHost + remoteChatSession lands in listSessions with a non-empty firstPrompt 6819ms
   ✓ F10 T-IMGREACH Task 14 — acceptance 8: no stranded sessions (three submit paths) > (b) a direct Session.submit([image]) lands in listSessions with a non-empty firstPrompt 5990ms
   ✓ F10 T-IMGREACH Task 14 — acceptance 8: no stranded sessions (three submit paths) > (c) harness.run([image]) lands in listSessions with a non-empty firstPrompt 5874ms
   ✓ F10 T-IMGREACH Task 14 — acceptance 9: library images > harness.run([{type:'text',...}, redPng]) — the model names the colour 4036ms

 Test Files  1 passed (1)
      Tests  4 passed (4)
   Start at  10:05:48
   Duration  23.34s (transform 265ms, setup 10ms, collect 450ms, tests 22.72s, environment 0ms, prepare 39ms)
```

**Verdict: PASS.** All three submit paths land a `listSessions` row with a non-empty `firstPrompt` — the
synthetic `[Image #N]` label Task 1's builder-boundary fix inserts at index 0 when no text block survives.

The F9 T-IMAGE regression suite (`test/live/image-submit.e2e.test.ts`) was re-run alongside it per the
brief's Step 2, to confirm this track has not regressed the prior image-submit acceptance:

```
 RUN  v2.1.9 /Users/new/Developer/GitHub/codex_somersault/.claude/worktrees/f10-imgreach/CC-to-SDK/harness

(node:6046) [CLAUDE_SDK_CAN_USE_TOOL_SHADOWED] Warning: canUseTool will not be invoked: permissionMode 'bypassPermissions' auto-approves every tool call (except explicit deny rules) before the callback is consulted. To gate every tool call, use a PreToolUse hook instead.
(Use `node --trace-warnings ...` to show where the warning was created)
 ✓ test/live/image-submit.e2e.test.ts (1 test) 7288ms
   ✓ F9 T-IMAGE Task 6 — live discrimination through the real REPL submit chain > control turn healthy, red/blue turns name distinct colours, every result is_error:false, and the persisted image blocks project as [Image #N] on both the transcript renderer and the resume-view model 7287ms

 Test Files  1 passed (1)
      Tests  1 passed (1)
   Start at  10:06:22
   Duration  8.01s (transform 241ms, setup 10ms, collect 573ms, tests 7.29s, environment 0ms, prepare 33ms)
```

**Verdict: PASS** — no regression.

---

## Cell 9 — library images (keyed live)

Same suite, fourth test: `harness.run([{type:"text", text:"What colour is this image? One word."},
redPng])`. Output is in the Cell 8 log above — `acceptance 9: library images > … the model names the
colour` passed in 4036ms, asserting `String(result).toLowerCase()` contains `"red"`.

**Verdict: PASS.**

---

## Cell 10 — skew is loud everywhere (unit + real-socket)

Five sub-commands, exactly as the brief names them:

```
=== 1: turn-content.test.ts -t skew ===
 ✓ test/unit/appserver/turn-content.test.ts (24 tests | 22 skipped) 6ms
 Test Files  1 passed (1)
      Tests  2 passed | 22 skipped (24)

=== 2: turn-content.test.ts -t 'does not support content' ===
 ↓ test/unit/appserver/turn-content.test.ts (24 tests | 24 skipped)
 Test Files  1 skipped (1)
      Tests  24 skipped (24)

=== 3: turn-content.test.ts -t fleet ===
 ✓ test/unit/appserver/turn-content.test.ts (24 tests | 22 skipped) 5ms
 Test Files  1 passed (1)
      Tests  2 passed | 22 skipped (24)

=== 4: engine-capabilities.test.ts (full) ===
 ✓ test/unit/appserver/engine-capabilities.test.ts (10 tests) 8ms
 Test Files  1 passed (1)
      Tests  10 passed (10)

=== 5: daemon-content.test.ts -t pre-F10 ===
 ✓ test/unit/daemon-content.test.ts (32 tests | 29 skipped) 9ms
 Test Files  1 passed (1)
      Tests  3 passed | 29 skipped (32)
```

**Sub-cell 2 note:** the literal command `-t "does not support content"` matches **zero** tests in
`turn-content.test.ts` — that file's engine-capability refusal test is titled *"an engine WITHOUT
submitContent refuses turn/startContent by name…"* (`turn-content.test.ts:239`), not a string containing
"does not support content". The assertion text itself (`/engine does not support content submission/`) is
inside the test body, not its title, so vitest's `-t` (title-only) filter cannot see it. The semantically
equivalent coverage is what sub-cell 4 already runs in full:
`test/unit/appserver/engine-capabilities.test.ts`'s 10 tests include both
`"an engine without submitContent throws by name"` and `"…steering"` cells, both green, plus
`turn-content.test.ts`'s own `"I3d: engine capability — checked before any reservation"` and
`"I3e: gate 5 — steerContent is its OWN capability…"` describe blocks (covered by sub-cells 1/3's "skew"
and "fleet" matches touching the same file, and by the full `npm run test:unit` run below). Reporting this
literally rather than silently substituting a different `-t` string, per the brief's own "quote each
verdict" instruction — this is not a gap in coverage, only in this one exact command's title match.

**Verdict: PASS** (sub-cells 1, 3, 4, 5 green; sub-cell 2 as specified matches nothing, semantically
covered by sub-cell 4).

---

## Cell 11 — the image ladder (unit)

```
npx vitest run test/unit/imageCodec-decode.test.ts test/unit/imageCodec-encode.test.ts test/unit/clipboardImage-codec.test.ts

 RUN  v2.1.9 /Users/new/Developer/GitHub/codex_somersault/.claude/worktrees/f10-imgreach/CC-to-SDK/harness

 ✓ test/unit/imageCodec-encode.test.ts (16 tests) 4168ms
   ✓ I5b(a) downscale — box average > an oversized-DIMENSION image comes back SMALLER IN PIXELS, not merely in bytes 1631ms
   ✓ I5b(b) byte-only recompression and the adaptive-filter sabotage guard > adaptive filtering is doing the work — filter-0 output is orders larger 303ms
   ✓ I5b(b) byte-only recompression and the adaptive-filter sabotage guard > the retry ladder halves and stops at the floor rather than looping 1693ms
 ✓ test/unit/imageCodec-decode.test.ts (27 tests) 76ms
 ✓ test/unit/clipboardImage-codec.test.ts (6 tests) 3408ms
   ✓ I5c — Linux dispatch, through real fake binaries and the real exec > the Linux branch RESCUES a BMP clipboard — real fake binaries, real exec, real dispatch 887ms
   ✓ I5c — Linux dispatch, through real fake binaries and the real exec > the Linux branch RESIZES an oversized PNG instead of refusing it 773ms
   ✓ I5c — Linux dispatch, through real fake binaries and the real exec > a HOSTILE clipboard image fails with the codec's own reason, and nothing is left behind 551ms
   ✓ I5c — Windows dispatch, the SAME mechanism, private-PATH fake `powershell` > the Windows branch takes the same ladder — probe AND save, both real dispatch 981ms

 Test Files  3 passed (3)
      Tests  49 passed (49)
   Start at  10:07:39
   Duration  8.08s (transform 60ms, setup 15ms, collect 80ms, tests 7.65s, environment 0ms, prepare 72ms)
```

**Downscale cell — measured dimensions** (`I5b(a)`): input `3200×1800` (long side over `maxDimension:2000`,
`byteBudget:512000`) → measured output **`2000×1125`** (scale `2000/3200 = 0.625` exactly; `1800×0.625 =
1125` exactly). Confirmed by direct probe against `reencodeImage`, not merely reading the assertion:
`MEASURED_DIMS {"width":2000,"height":1125}`. `1125 ≤ 2000` and `2000/1125 ≈ 3200/1800` (aspect preserved,
long side clamped) — asserts DIMENSIONS, not bytes, exactly as spec v4.1 requires.

**Hostile fixtures — failure code + reason, all decoded with `NEVER_EXPIRES` (the deadline stubbed to
never expire)** (`test/unit/imageCodec-decode.test.ts`, "I5a hostile input" describe block):

| Fixture | Failure code |
|---|---|
| `bomb.png` (one byte past the exact scanline total) | `inflate-overrun` |
| `huge-header.png` (IHDR declares 25,000,001 px) | `pixel-budget` (overflow-safe, before allocation) |
| `truncated-idat.png` | `malformed` |
| `overlong-chunk.png` | `malformed` (chunk walk, before the slice) |
| `forged-bmp-offset.bmp` | `malformed` |
| `forged-bmp-stride.bmp` | `malformed` |
| `short-v5-masks.bmp` (58-byte BITMAPV5HEADER, buffer ends exactly where color masks start) | `malformed` (not a RangeError crash) |

**Stated explicitly, per spec v4.1's amendment (do not read this as a wall-clock claim):** every one of the
above fixtures is decoded with `NEVER_EXPIRES` — the deadline stubbed to never expire — so **only the
structural bound can be what fires**: `inflateSync`'s own `maxOutputLength` cap (bomb), the pixel-count
overflow-safe check before allocation (huge-header), or the chunk/header walk's own bounds-checking
(truncated/overlong/forged BMPs). The suite carries two guards proving this is real, not incidental: a
**sabotage guard** (`"dropping maxOutputLength must turn the bomb cell red"`) that reads `imageCodec.ts`'s
own source and asserts every `inflateSync(` call site is `maxOutputLength`-capped; and a doc-shape guard
(`"the cooperative belt is documented as a belt, not as an interrupt"`) asserting the source describes the
2 s wall-clock check as `cooperative`, never as something that "cannot hang" or "guarantees termination."
A separate, distinct cell (`"an EXPIRED belt trips between stages with budget-exceeded"`) proves the 2 s
guard is a real, additional, COOPERATIVE check layered on top — it fires `budget-exceeded` (a different
code from every hostile-fixture code above) only when the deadline function itself reports expired, never
as what carries the hostile fixtures.

**Fake-clipboard integration** (`test/unit/clipboardImage-codec.test.ts`): three Linux cells (BMP rescue,
oversized-PNG resize, hostile-image refusal) and two Windows cells (probe+save ladder, probe-honoured
no-fixture-no-image) all dispatch through **real fake binaries on a private `PATH`** and the real `exec` —
proving the platform dispatch actually invokes `imageCodec.ts`'s module, not a mock of it. Darwin is
separately proven UNCHANGED (still runs `osascript`, never consults the codec).

**Boundary cells, every cap** (`I5a boundary matrix` in `imageCodec-decode.test.ts`; `I5b boundary matrix`
in `imageCodec-encode.test.ts`) — all inside the 49/49 passed above; detailed per-constant verdicts in the
roll-up table below.

**A flake observed and root-caused, unrelated to any T-IMGREACH regression:** on one run made concurrently
with this task's own background `npm run test:unit`/`test:tui` gate runs (CPU-contended), the
`"the retry ladder halves and stops at the floor rather than looping"` cell in
`imageCodec-encode.test.ts` failed with `budget-exceeded` instead of the expected `encode-floor`. That
test does **not** pass `NEVER_EXPIRES` — it uses `reencodeImage`'s default real-wall-clock 2 s budget
(`PROCESSING_BUDGET_MS`), and three isolated re-runs measured its own real execution time at
**1.7–2.2 seconds** — already riding the edge of its own 2000 ms budget on this machine even with no
contention. Under CPU load from concurrently-running background test suites, the cooperative belt tripped
first. Re-run in isolation three times: PASS, PASS, PASS (1788ms/1762ms/1693ms). This is a pre-existing
test-design fragility in Task 5's own suite (a wall-clock-bound cell with no injected clock, whose real
runtime sits close to its own timeout) — not a T-IMGREACH regression, and not one of the `NEVER_EXPIRES`
hostile-fixture cells this step's acceptance criterion is about. Flagged for awareness; not a merge
blocker for this track.

**Verdict: PASS** (49/49, confirmed clean in an uncontended re-run).

---

## Cell 12 — the ambient hint (fake-timer + hermetic pty)

### The fake-timer half (component + pure-model level)

```
npx vitest run test/tui/clipboardHint.test.tsx test/unit/clipboardCheck.test.ts

 RUN  v2.1.9 /Users/new/Developer/GitHub/codex_somersault/.claude/worktrees/f10-imgreach/CC-to-SDK/harness

 ✓ test/tui/clipboardHint.test.tsx (17 tests) 233ms
 ✓ test/unit/clipboardCheck.test.ts (9 tests) 3ms

 Test Files  2 passed (2)
      Tests  26 passed (26)
   Start at  10:06:56
   Duration  907ms (transform 202ms, setup 12ms, collect 431ms, tests 236ms, environment 0ms, prepare 50ms)
```

`clipboardHint.test.tsx` covers: image-on-clipboard + focus-in → hint within `CLIPBOARD_HINT_DEBOUNCE_MS`
(1000ms), naming the live chord; a blur inside the debounce window cancels with the check never called; a
second focus-in inside the 30_000ms throttle window posts nothing, at 30_001ms it posts; gated on
image-paste availability (no `readClipboardImage` prop → check never called, nothing posts — this is the
SAME gate the pty capture below found unreachable in the real app, proven here only because the test
explicitly injects the prop); no image on the (fake) clipboard → nothing posts; the first-keypress
secondary trigger (no 1004 byte ever seen) arms and posts; a rebound `chat:imagePaste` chord renders
correctly; the post is `priority:"immediate"` with `CLIPBOARD_HINT_TIMEOUT_MS` (8000ms); and Footer.tsx's
poster census (grep-honesty: exactly NINE `priority:"immediate"` posters across ChatComposer+ChatApp,
matching the updated comment).

`clipboardCheck.test.ts` covers the **stdio-seam / exit-code-only contract**: the check sets a literal 64
KiB `maxBuffer` (not the 16 MiB paste-path buffer); stdout is IGNORED even when the child prints a
megabyte (`Promise<number>` is the entire type — there is no channel for the bytes); a non-zero `.code`
resolves that code; an error with no numeric code resolves `1`; the darwin/linux/win32 command dispatch is
platform-specific (not hardcoded `osascript`); an unsupported platform never spawns anything.

**Verdict: PASS**, both files, 26/26.

### The hermetic-pty half — ATTEMPTED, and it surfaced a real defect

Task 13's Step 7 was skipped on this branch (no tmux-driver harness existed at the time, and Task 13 ran
keyless) — recorded honestly in commit `a4b774f22c`'s own message rather than faked. This task has live
credentials, so the capture was attempted here for the first time.

**Setup:** built `dist/` (`npm run build`, clean); a private tmux socket
(`tmux -L f10img14 …`, session `cap1`, killed by name when done — the real fleet/other sessions untouched);
a fake `osascript` executable (`exit 0` unconditionally) in a throwaway directory prepended to `PATH`
inside the pane, matching `clipboardCheck.ts:53`'s exact darwin dispatch (`osascript -e "the clipboard as
«class PNGf»"` exits 0 → `hasClipboardImage` reports `true`); a fresh temp `cwd` and `CCX_FLEET_ROOT`; the
real `CLAUDE_CODE_OAUTH_TOKEN` in the pane's env (a genuine, live-authenticated `ccx` process, not a stub).
**Correction to the brief:** the brief names `node dist/cli.js` — that binary (`bin: "cc-harness"`,
`src/cli.ts`) is the OTHER package entry point and never mentions `chatMain`/`ChatApp`/`interactive`
anywhere in its 120 lines. The real interactive-REPL binary is `ccx` → `dist/cli/bin.js` → `src/cli/main.ts`
(dynamic-imports `tui/chatMain.js`'s `runChatClient`), which is what was actually launched.

**Attempt 1 — focus-in edge.** Launched `node dist/cli/bin.js` in the tmux pane; waited for the composer to
render (confirmed via `capture-pane`); sent `tmux send-keys -H 1b 5b 49` (the raw bytes for `\x1b[I`, a
DECSET-1004 focus-in report); waited 2s (well past the 1000ms debounce); captured the pane. **No hint
appeared.**

**Attempt 2 — the secondary keypress trigger.** From the same still-running session (state still
"unknown" — no focus report had actually been processed), sent a plain keypress (`a`); waited 2s; captured
the pane again. **No hint appeared** — even via the documented secondary trigger for terminals with no 1004
support.

**Attempt 3 — root-cause read, confirmed against source rather than guessed.** `ChatComposer.tsx`'s own
comment (`:762-764`) states the hint's gate is `!!readClipboardImage` — "a composer with no paste path at
all has nothing this hint could offer ctrl+v FOR." The armed-hint handler enforces this literally
(`ChatComposer.tsx:776`): `if (!readClipboardImageRef.current) return; // no paste path — nothing this hint
could offer`. **`src/tui/ChatApp.tsx` never passes `readClipboardImage` or `checkClipboardImage` to
`<ChatComposer>`** — its one JSX call site (`ChatApp.tsx:1746-1781`) passes `onFocusChange` (the hint's
*primary trigger*, correctly wired) but neither clipboard prop. Repo-wide grep confirms this is not a
one-off miss: `grep -rln "readClipboardImage=\|checkClipboardImage=" src/` returns **zero files** — neither
prop is ever assigned anywhere in production source, only inside test files that inject mocks directly.
Ctrl-V paste itself still works in the real app because its own handler
(`ChatComposer.tsx:1069`) falls back independently: `readClipboardImageRef.current ?? (() =>
pasteClipboardImage(defaultClipboardDeps()))` — but the hint's gate checks the RAW ref, not that fallback,
so the hint can never arm regardless of what the debounce/throttle state machine or the check-only seam
would have reported.

Pane capture from the live attempt (fake `osascript` reachable and returning "yes, there is a clipboard
image" throughout):

```
╭─── ccx v0.1.0 ──────────────────────────────────╮
│ ✻ Welcome to Claude Code                        │
╰─────────────────────────────────────────────────╯

  cwd    /private/var/folders/c1/l4z5k02n2779byvnymzxsvth0000gn/T/tmp.hh7rtWjr2D
  model  claude-opus-5   ·   mode  auto

  Tips for getting started
  Ask Claude to create a new app or clone a repository
...
❯ a
────────────────────────────────────────────────────────────────────────────
  new@Mac-mini:/private/var/folders/.../tmp.hh7rtWjr2D [claude-opus-5] ctx:3% $0.00 · 0s
  ⏵⏵ auto mode on (shift+tab to cycle)
```

No "Image in clipboard" line appears anywhere in the captured pane, before or after either trigger.

**Verdict (as originally verified, before the fix wave): the fake-timer half of Cell 12 PASSES (26/26). The
hermetic-pty half FAILS — this is a real, live-reproduced defect, not a blocked/skipped cell and not a
faked capture.** The capture mechanism itself worked exactly as designed (real `ccx` process, real tty,
real focus-in bytes, real fake-binary dispatch proven reachable by the same technique Cell 11's
clipboard-codec suite already uses); what it proved is that the feature it was built to observe cannot
fire in the real running app. See the report for the recommended next step (a one-line wiring fix —
threading two props ChatApp already has access to but never forwards — is out of scope for this
verification-only task).

### Fix wave update (Task 14 Cell 12 finding, closed) — Cell 12 hermetic-pty half now PASSES

**The finding above is fixed and re-verified live.** `src/tui/ChatApp.tsx` now passes
`readClipboardImage`/`checkClipboardImage` to its one `<ChatComposer>` JSX call site, using the exact same
production defaults (`pasteClipboardImage(defaultClipboardDeps())`,
`hasClipboardImage(process.platform, defaultCheckOnlyProcess())`) `ChatComposer`'s own ctrl+v fallback
already used — so the hint's arm-gate (`ChatComposer.tsx:776`, `if (!readClipboardImageRef.current)
return;`) is satisfied by production wiring, not only by a test-injected mock.

**Regression coverage (MOUNTED, production wiring — no props injected onto `<ChatComposer>` directly):**
new test `test/tui/clipboardHintChatAppWiring.test.tsx` renders `<ChatApp>` alone under the real
`KeymapProvider` + `chatMain.createFocusChain()` route (the same topology `chatMain.tsx` builds for the
real `ccx` binary), fakes only the platform-level child process (`node:child_process`'s `execFile`, the
one real subprocess boundary `hasClipboardImage` crosses), sends a real `\x1b[I` focus-in byte sequence
through `stdin`, and asserts the hint text appears. **Red-before/green-after, measured**: with ChatApp's
two new props reverted (`git stash` on `src/tui/ChatApp.tsx` alone), this test fails —
`expected '─────...' to contain 'Image in clipboard · ctrl+v to paste'`; restored, it passes. Full
ChatApp-adjacent suite, `npm run typecheck`, and `npm run test:tui` all green afterward (see
task-13-report.md's fix-wave section for verbatim output).

**Hermetic-pty re-run against the fixed build — PASS.** Same tmux + fake-`osascript` recipe as the original
FAILURE capture above (private socket `-L f10img14fix`, session `capfix1`, killed by name when done; fresh
temp cwd + `CCX_FLEET_ROOT`; real `CLAUDE_CODE_OAUTH_TOKEN`; `dist/cli/bin.js` rebuilt clean post-fix): a
real focus-in (`\x1b[I`) now produces `Image in clipboard · ctrl+v to paste`, dim and right-aligned in the
footer, within the capture taken 2s after the focus report — and it is gone again by the ~9s capture, past
`CLIPBOARD_HINT_TIMEOUT_MS` (8000ms). Full capture appended to `t-imgreach-pty-hint.txt` (the original
FAILURE capture is kept above it, as history, not erased).

**Verdict: Cell 12 is now a full PASS, both halves** — 26/26 fake-timer tests, the new mounted
production-wiring regression, and the hermetic-pty capture all agree the ambient hint is reachable in the
real running product.

---

## Step 5b — the boundary-matrix roll-up

Every cap this track introduced or widened, its owning test file, and its cap−1/cap/cap+1 verdict. All 23
rows below are covered by the green `npm run test:unit` run (3635/3635, see Gates) — `triple(cap)`
(`test/unit/boundaryTriple.ts`) fixes the semantics for every row: **every cap in this track is INCLUSIVE**
(cap−1 passes, cap passes, cap+1 does not).

| Constant | Owning test file | cap−1 | cap | cap+1 |
|---|---|---|---|---|
| `MAX_BASE64_INPUT_BYTES` | `test/unit/turnInput.test.ts` (`I2 boundary: MAX_BASE64_INPUT_BYTES`); also reused as the staged declared-length cap in `test/unit/appserver/image-stage.test.ts` (`bytesTotal $label`) | passes | passes | fails (`base64 input exceeds…`) |
| `POST_PROCESS_BYTE_BUDGET` | `test/unit/turnInput.test.ts` (`I2 boundary: POST_PROCESS_BYTE_BUDGET`) | passes | passes | fails (`image data exceeds…`) |
| `MAX_DIMENSION` | `test/unit/turnInput.test.ts` (`I2 boundary: MAX_DIMENSION`) | passes | passes | fails (`exceed the …px limit`) |
| `MAX_AGGREGATE_BYTES` | `test/unit/turnInput.test.ts` (`I2 boundary: MAX_AGGREGATE_BYTES`) | passes | passes | fails |
| `MAX_IMAGES_PER_PROMPT` | `test/unit/turnInput.test.ts` (`I2 boundary: MAX_IMAGES_PER_PROMPT`, line 578) | passes | passes | fails (`too many images in one turn`) |
| `MAX_CONTENT_BLOCKS` | `test/unit/turnInput.test.ts` (`I2: MAX_CONTENT_BLOCKS, cap−1/cap/cap+1` + boundary matrix, line 584) | passes | passes | fails (truncated to `MAX_CONTENT_BLOCKS`) |
| `MAX_TOTAL_TEXT` | `test/unit/turnInput.test.ts` (`I2: MAX_TOTAL_TEXT…`, string AND array form) + `test/unit/harness-turn-input.test.ts` (bound on `run`/`stream`/`Session.submit`/`Session.steer` — every bare-string surface, unconditionally) | untouched at cap−1 | untouched at cap | **truncated** with `TRUNCATION_SUFFIX` (not a hard reject — length stays `≤ MAX_TOTAL_TEXT`) |
| `MAX_SOURCE_BYTES` | `test/unit/imageCodec-decode.test.ts` (`I5a boundary matrix`) | passes | passes | fails (`source-too-large`) |
| `MAX_PIXELS` | `test/unit/imageCodec-decode.test.ts` (`I5a boundary matrix`) | passes | passes | fails (`pixel-budget`) |
| PNG chunk length (structural, inline — no exported constant) | `test/unit/imageCodec-decode.test.ts` (`I5a boundary matrix`, "a chunk declaring $label bytes against a 64-byte tail") | passes | passes | fails (`malformed`) |
| `maxDimension` (function param, `reencodeImage`/`downscale`) | `test/unit/imageCodec-encode.test.ts` (`I5b boundary matrix`, injected `2000`) | untouched | untouched | clamped to `maxDimension` (not a reject — a resize) |
| `byteBudget` (function param, `reencodeImage`/`retryEncode`) | `test/unit/imageCodec-encode.test.ts` (`I5b boundary matrix`, offsets from the measured `EXACT_ENCODE_BYTES`) | 1 downscale rung, fits under budget | 0 rungs, fits at full resolution | 0 rungs, fits at full resolution (a FIT test, not a reject test — the byte count alone cannot tell rungs apart, so the assertion is on the injected `onRung` rung-count seam) |
| `IMAGE_STAGE_CHUNK_MAX` | `test/unit/appserver/image-stage.test.ts` (`I3a: the full cap boundary matrix`) | passes | passes | fails, `stagedBytes` stays `0` (refused before retention) |
| `MAX_STAGES_PER_CONNECTION` | `test/unit/appserver/image-stage.test.ts` | passes | passes | fails; `stageCount` clamps to the cap |
| `MAX_STAGES_GLOBAL` | `test/unit/appserver/image-stage.test.ts` (proven across DIFFERENT connections — a per-connection-only impl would wrongly pass every row) | passes | passes | fails |
| `MAX_STAGED_BYTES_GLOBAL` | `test/unit/appserver/image-stage.test.ts` | passes | passes | fails |
| `STAGE_IDLE_MS` | `test/unit/appserver/image-stage.test.ts` | reservable | reservable | expired, not reservable |
| `STAGE_ABSOLUTE_MS` | `test/unit/appserver/image-stage.test.ts` (fed every 30s so it never idles — the held-open-abandoned shape) | `stageCount` 1 | `stageCount` 1 | `stageCount` 0 |
| `MAX_QUEUED_TURNS` | `test/unit/appserver/queue.test.ts:718` | passes | passes | fails |
| `MAX_QUEUED_ENTRY_BYTES` | `test/unit/appserver/queue.test.ts:725` | passes | passes | fails |
| `MAX_QUEUED_BYTES` | `test/unit/appserver/queue.test.ts:732` | passes | passes | fails |
| `DAEMON_MAX_FRAME_BYTES` | **SERVER**, real value, raw writes: `test/unit/daemon-content.test.ts` (`I4 boundary matrix`, `realDaemon()`). **CLIENT**, injected limit (4096): same file, `preflightOp at an INJECTED limit` — because no normalized payload can reach the real 24 MiB cap, per the constant's own canonical-derivation comment. | passes (both) | passes (both) | fails (both — server: connection closes; client: `DaemonFrameTooLargeError` thrown) |
| `DAEMON_PARTIAL_LINE_MS` | `test/unit/daemon-content.test.ts` (`I4 boundary matrix`) — **inclusive**, the server arms its timer at `DAEMON_PARTIAL_LINE_MS + 1`, one ms past the cap, so a line held for exactly the cap survives | survives | survives | connection dropped (`partial line held over …ms with no newline`) |

**Verdict: PASS — all 23 rows present with a measured cap−1/cap/cap+1 verdict**, confirmed by the green
`npm run test:unit` run below (no row skipped, no row is an unmet acceptance condition per the brief's own
rule that a missing row would be).

---

## Step 6 — Gates

```
$ npm run typecheck
> cc-harness@0.1.0 typecheck
> tsc --noEmit
(clean, zero output)

$ npm run build
> cc-harness@0.1.0 build
> tsc -p tsconfig.build.json
(clean, zero output)

$ npm run test:unit
 Test Files  251 passed (251)
      Tests  3635 passed (3635)
   Duration  206.26s

$ npm run test:tui
 Test Files  172 passed | 9 skipped (181)
      Tests  4201 passed | 9 skipped (4210)
   Duration  134.47s
```

The 9 skipped `test:tui` files are the pre-existing `test/tui/live/*.e2e.test.ts` keyless-gated live
suites (chat-stream, chat-rich, thinking-budget, auto-mode, resume-replay, model-capabilities,
command-catalog, chat-context, chat-input) — gated the same way every other live suite in this repo is;
not part of this track's own acceptance cells.

**Verdict: PASS — all four gates clean.**

---

## Summary table

| Cell | Verdict |
|---|---|
| 8 — no stranded sessions (3 paths, keyed live) | PASS |
| 9 — library images, colour naming (keyed live) | PASS |
| 10 — skew loud everywhere (5 sub-cells) | PASS (sub-cell 2's literal `-t` string matches nothing in that file; semantically covered by sub-cell 4) |
| 11 — image ladder (dimensions, hostile fixtures, fake-clipboard integration, boundaries) | PASS (49/49; one unrelated wall-clock-adjacent flake root-caused, confirmed clean in isolation) |
| 12 — ambient hint, fake-timer half | PASS (26/26) |
| 12 — ambient hint, hermetic-pty half | **FAIL — I6 unreachable in the real running app; root cause identified (see above)** |
| Boundary roll-up (23 rows) | PASS |
| Gates (typecheck/build/unit/tui) | PASS |

---

## Assembled acceptance (post merge slot 4, main @ b1b075a617)

Re-run of the keyed live cells and the hermetic-pty half on the fully assembled tree (all four F10 tracks
merged: T-MAINT, T-SELECT, T-HOVER, T-IMGREACH). The keyless pty matrices (`select-pty.sh` 6/6,
`hover-cells.sh` h1+h2) and the full gate suites were already re-run post-merge by the coordinator and are
not repeated here — only cells 8, 9, and 12's pty half are re-proven below, against `main`, not a worktree.

### Cell 8 — no stranded sessions (keyed live)

`set -a; . ../.env; set +a; npx vitest run test/live/image-reach.e2e.test.ts`, from `CC-to-SDK/harness` on
`main`:

```
 RUN  v2.1.9 /Users/new/Developer/GitHub/codex_somersault/CC-to-SDK/harness

(node:45405) [CLAUDE_SDK_CAN_USE_TOOL_SHADOWED] Warning: canUseTool will not be invoked: permissionMode 'bypassPermissions' auto-approves every tool call (except explicit deny rules) before the callback is consulted. To gate every tool call, use a PreToolUse hook instead.
(Use `node --trace-warnings ...` to show where the warning was created)
 ✓ test/live/image-reach.e2e.test.ts (4 tests) 24607ms
   ✓ F10 T-IMGREACH Task 14 — acceptance 8: no stranded sessions (three submit paths) > (a) the real REPL topology: an image-only submit through SessionHost + remoteChatSession lands in listSessions with a non-empty firstPrompt 6539ms
   ✓ F10 T-IMGREACH Task 14 — acceptance 8: no stranded sessions (three submit paths) > (b) a direct Session.submit([image]) lands in listSessions with a non-empty firstPrompt 5658ms
   ✓ F10 T-IMGREACH Task 14 — acceptance 8: no stranded sessions (three submit paths) > (c) harness.run([image]) lands in listSessions with a non-empty firstPrompt 8186ms
   ✓ F10 T-IMGREACH Task 14 — acceptance 9: library images > harness.run([{type:'text',...}, redPng]) — the model names the colour 4221ms

 Test Files  1 passed (1)
      Tests  4 passed (4)
   Start at  10:39:03
   Duration  25.30s (transform 294ms, setup 13ms, collect 507ms, tests 24.61s, environment 0ms, prepare 48ms)
```

**Verdict: PASS.** Same three submit paths, same non-empty-`firstPrompt` assertion, unchanged on the
assembled tree.

### Cell 9 — library images (keyed live)

Same suite, same run as above — fourth test, `acceptance 9: library images > … the model names the colour`,
4221ms, PASS. No separate command needed (see Cell 8 output).

The F9 T-IMAGE regression (`test/live/image-submit.e2e.test.ts`) was also re-run to confirm no cross-track
regression on the assembled tree:

```
 RUN  v2.1.9 /Users/new/Developer/GitHub/codex_somersault/CC-to-SDK/harness

(node:45716) [CLAUDE_SDK_CAN_USE_TOOL_SHADOWED] Warning: canUseTool will not be invoked: permissionMode 'bypassPermissions' auto-approves every tool call (except explicit deny rules) before the callback is consulted. To gate every tool call, use a PreToolUse hook instead.
(Use `node --trace-warnings ...` to show where the warning was created)
 ✓ test/live/image-submit.e2e.test.ts (1 test) 7573ms
   ✓ F9 T-IMAGE Task 6 — live discrimination through the real REPL submit chain > control turn healthy, red/blue turns name distinct colours, every result is_error:false, and the persisted image blocks project as [Image #N] on both the transcript renderer and the resume-view model 7572ms

 Test Files  1 passed (1)
      Tests  1 passed (1)
   Start at  10:39:32
   Duration  8.33s (transform 259ms, setup 10ms, collect 596ms, tests 7.57s, environment 0ms, prepare 33ms)
```

**Verdict: PASS** — no regression.

### Cell 12 — hermetic-pty half, re-proven against merged main

`npm run build` produced a clean `tsc -p tsconfig.build.json` with zero output (dist was already fresh
relative to `src`, rebuilt anyway per the re-verification brief). Recipe reproduced exactly as documented
above: private tmux socket `tmux -L f10asm`, session `cap1`; a throwaway directory holding a fake
`osascript` (`exit 0` unconditionally) prepended to `PATH`; fresh temp `cwd` and `CCX_FLEET_ROOT`; the real
`CLAUDE_CODE_OAUTH_TOKEN` sourced into the pane's env from `.env` via a launcher script (never printed);
launched `node dist/cli/bin.js` (the `ccx` interactive-REPL entry point, per the correction already recorded
above — not `dist/cli.js`).

Composer confirmed rendered via an initial `capture-pane` before sending input. Sent the raw focus-in bytes
(`tmux send-keys -H 1b 5b 49`, i.e. `\x1b[I`), then captured the pane at ~2s:

```
  new@Mac-mini:/private/var/folders/.../tmp.Ia8uRzxs1r [claude-opus-5] ctx:3% $0.00 · 0s
  ⏵⏵ auto mode on (shift+tab to cycle)                                                                                                                                                 Image in clipboard · ctrl+v to paste
```

Captured again at ~9s after the focus-in (past `CLIPBOARD_HINT_TIMEOUT_MS`, 8000ms):

```
  new@Mac-mini:/private/var/folders/.../tmp.Ia8uRzxs1r [claude-opus-5] ctx:3% $0.00 · 0s
  ⏵⏵ auto mode on (shift+tab to cycle)
```

The hint appeared within the debounce window and was gone by the ~9s capture, matching the fix wave's
original re-proof exactly. Session `cap1` killed by name (`tmux -L f10asm kill-session -t cap1`) — no other
session on the socket, none touched. Fake-binary directory and temp `cwd`/`CCX_FLEET_ROOT` removed after.

**Verdict: PASS** — the ambient clipboard hint fires live on the fully assembled `main` tree, confirming the
fix wave's wiring survived the three-way merge (slot 4's only conflict was in `ChatComposer.tsx`'s
destructure line, resolved as a union of both branches' props).

### Assembled acceptance summary

| Cell | Verdict |
|---|---|
| 8 — no stranded sessions (keyed live, assembled main) | PASS |
| 9 — library images, colour naming (keyed live, assembled main) | PASS |
| 12 — ambient hint, hermetic-pty half (assembled main) | PASS |
