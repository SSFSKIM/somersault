# bl5 — link-click URL-opening (T-LINKOPEN) + sniff-derived media type (T-SNIFF)

**Status:** v1 · 2026-08-26 · canon = installed 2.1.246 (Mach-O bundle, `~/.local/share/claude/versions/2.1.246`)
**Research:** `.doperpowers/sdd/2026-08-26-bl5-round/research-links.md` (canon link pipeline, byte-offset evidence)
and `research-sniff.md` (five-chain map, canon derive verdict, live API 400 evidence). Both reports are the
evidence base; this spec states only the conclusions and the contracts.

## Purpose

Close the two remaining bl4-parked items whose substrates are ready. Both flipped shape under research:

1. **T-LINKOPEN.** bl4 concluded "canon defers URL-opening to the terminal" (true on 2.1.237) and shipped a
   deliberate no-op at the link-click seam. Canon 2.1.246 **self-opens** clicked links behind a
   modifier/terminal gate engineered to fire exactly where the terminal would not have handled the click
   itself. "Emit OSC 8 and stop" is no longer canon-faithful; we build the opener with canon's exact gate.
2. **T-SNIFF.** The parked item said "cross-check sniff vs declared." Canon never cross-checks — it
   **derives**: every emitted image block's `media_type` comes from a byte sniff of the final bytes; the
   caller's declaration is a hint that is discarded. The API 400s a mismatch as a whole-request failure
   (verified live 2026-08-26), so deriving locally makes that failure unreachable while refusing would drop
   an image the API would have accepted relabelled. Our own `appserver/turnItems.ts` already chose derive
   independently. We generalize derive to every chain.

## T-SNIFF — sniff-derived media type

### Contract

- New pure helper in `harness/src/media/imageDims.ts` (the zero-import leaf, import-freedom is
  test-enforced): `sniffImageMediaType(buf: Buffer): "image/png" | "image/jpeg" | "image/gif" | "image/webp" | null`.
  It reuses the exact signature tests the four dimension readers already perform (PNG 8-byte signature,
  JPEG FFD8+SOF walkability, `GIF87a`/`GIF89a`, `RIFF…WEBP`); a miss returns `null`, never throws.
- **Chain 1 (authoritative), `session/turnInput.ts` `checkImageBlock`:** derive `media_type :=
  sniffImageMediaType(decoded)` and OVERWRITE the declared value in the canonical block, at the same place
  the chain already canonicalizes `data`. If the sniff returns `null` the existing unreadable-image refusal
  path stands unchanged. The `IMAGE_MEDIA_TYPES` allowlist check applies to the SNIFFED type. No second
  decode: the helper runs on the same buffer the dims chain already holds.
- **Chain 2, `client/stagedSubmit.ts` `stageBlocks`:** same derive before the block's `media_type` goes on
  the `stageImage` op wire — the client pre-check must never stage a label the seam would rewrite.
- **Chain 4, `appserver/turnItems.ts` `admitBytes` — bug fix:** it sniffs PNG/JPEG only, so a legitimate
  GIF/WebP app-server `image`/`localImage` item is refused as "unreadable image data" even though every
  other chain and the API accept both. Widen to the four-reader chain and re-home its ad-hoc
  `png ? "image/png" : "image/jpeg"` derivation onto `sniffImageMediaType`. Its existing derive posture and
  comment stay.
- **Chains 3 & 5** (appserver `imageStage.ts` registry, host `imageStaging.ts`/`assembleStagedContent`)
  inherit chain 1 downstream — no code, but a test each pins the inheritance (what the host replays as
  `mediaType` after the fix; registry refusal copy carries through).
- Behavior note (public API): a caller-declared `media_type` that contradicts the bytes is silently
  corrected, not refused — this is canon's semantics and degrades nothing (Decision D2).

### Acceptance (T-SNIFF)

- Unit: helper returns each of the four types on the committed real fixtures and `null` on garbage/empty/
  truncated-signature buffers (`test/unit/imageDims.test.ts`).
- Unit: a PNG declared `image/gif` normalizes to a block whose `media_type` is `image/png` (chain 1) and
  stages client-side with the corrected type without degrading (chain 2); symmetric GIF-declared-PNG cell.
- Unit: chain 4 admits real GIF and WebP bytes with correct derived type (regression: today refused).
- Existing suites stay green: `npm run typecheck`, `npm run test:unit`, `npm run test:tui` from `harness/`.
- Live (gated, `.env` key/token): a deliberately mislabelled block round-trips 200 (today: API 400
  "specified using the image/gif media type, but the image appears to be a image/png image").

## T-LINKOPEN — canon 2.1.246 link-click opening

### Canon contract being transcribed (research-links.md, offsets cited there)

On mouse RELEASE, when the click resolved to no handled target ("unhandled") and the release position
carries a hyperlink: canon opens it iff ALL of
- not a VSCode/xterm.js-hosted terminal (host handles OSC 8 itself — stand-down), AND
- (alt or ctrl modifier bit set) OR (darwin AND `TERM_PROGRAM` is `ghostty` or `WarpTerminal` — those
  forward cmd+click without an SGR modifier bit), AND
- alt-screen active (our fullscreen viewport — inherently true at this seam),
then opens AFTER A 500 ms TIMER, cancelled if a double/triple-click arrives in the window. The opener
scheme-allowlists the URL — `https: http:` plus app schemes `vscode: vscode-insiders: cursor: windsurf:
zed: jetbrains: idea: slack: linear: notion: figma:` (canon's 12-entry set verbatim) — refuses others with
a warn log, and spawns `$BROWSER || open <url>` fire-and-forget (house pattern: `copy.ts`'s spawn with
ignored stdio). `file:` URLs open in canon's editor panel — we have no panel: `file:` is a NO-OP this
round (parked, D6). Plain unmodified left-click on a link stays a no-op for the opener (it already defers
to expansion precedence — see below).

### Design

1. **Universal per-row link spans.** `HitRow.linkRanges` today comes only from `FoldClause.linkRanges`
   (T-PRLINK fold rows). Markdown prose links emit OSC 8 into the styled row text (`markdownInline.ts`) but
   produce no ranges, so prose links are invisible to the resolver. Generalize `linkRangesOf` (or a sibling
   in `mouse/hitmap.ts`) to ALSO recover spans by parsing embedded OSC 8 open/close sequences from the
   row's styled text — the moral equivalent of canon's per-cell grid readback. One recovery function, two
   sources, deduplicated; offsets are in SGR-stripped character space exactly as today (the
   `columnToChar` contract is unchanged).
2. **Opener module** `src/tui/linkOpen.ts`: `openUrl(url, io?)` — scheme allowlist (D4), `$BROWSER`
   override then `open` (darwin) / `xdg-open` (linux) via injectable spawn (DI-by-deps house style),
   headless-linux guard (`linux && !DISPLAY && !WAYLAND_DISPLAY` → refuse), warn-log refusal for
   non-allowlisted schemes. Pure decision function separated from the spawn so tests never spawn.
3. **Gate + dispatch** in `FullscreenViewport.tsx`: the click resolver's current link-hit answer
   (`undefined` = "unhandled", exactly canon's `allowDefault` outcome) stays; a NEW release-path branch
   resolves the link under the release cell and, if the gate passes (modifiers from the
   `MouseInputEvent`'s own `ctrl`/`alt` fields; `TERM_PROGRAM` checks), arms a 500 ms timer via the
   injectable clock; `multiClickSelectionAt` cancels a pending timer (canon's cancellation). Expansion
   precedence is untouched: a link-span click still never toggles expansion.
4. **Terminal detection**: `TERM_PROGRAM === "vscode"` → stand-down; darwin + `TERM_PROGRAM`
   `ghostty`/`WarpTerminal` → modifier-free open. XTVERSION-based Ghostty detection (canon's secondary
   probe) is PARKED — we have no XTVERSION plumbing (D5).
5. **Fold-in cell**: hover-suppression-while-expanded — an owner in `expandedItems` must not brighten on
   hover (bl4 shipped the mechanism; this round pins it with an e2e cell).

### Acceptance (T-LINKOPEN)

- Unit: OSC 8 span recovery from a styled prose row (marked-rendered link), from a fold row (existing
  ranges), and their disagreement dedup; `columnToChar` mapping through a row containing OSC 8.
- Unit: gate truth table — {vscode, plain-click, alt-click, ctrl-click, ghostty-plain-click,
  warp-plain-click, linux-headless} × open/refuse; 500 ms defer fires exactly once with fake timers;
  double-click within the window cancels; non-allowlisted scheme refused with warn and no spawn.
- Unit: expansion precedence unchanged — a gated link click never toggles `expandedItems`; a clickable
  owner's non-link cell still toggles.
- e2e (pty, real binary gate): with `BROWSER` set to a recorder script, an alt-click on a rendered link in
  ccx fullscreen invokes the recorder with the exact URL (SGR bytes from a SAVED SCRIPT FILE — inline
  sends drop the tap); hover-suppression-while-expanded cell on the same harness run.
- `npm run typecheck`, `test:unit`, `test:tui` green from `harness/`.

## Decision Log

- **D1 (round scope):** T-LINKOPEN + T-SNIFF only; GIF/WebP downscale stays parked (decoder cost, zero-dep
  codec house style). Owner-approved 2026-08-26.
- **D2 (derive over refuse):** canon parity, whole-request-400 avoidance, and our own chain-4 precedent;
  REJECTED: refuse-on-mismatch (drops images the API accepts relabelled; louder but strictly worse for the
  user). The declared field on the public API becomes a hint, matching canon.
- **D3 (bare-URL fallback PARKED):** canon also regex-recovers bare `https://` text from the RECONSTRUCTED
  soft-wrapped logical line and bails on elided spans. We lack logical-line reconstruction in the hitmap; a
  single-visual-row approximation risks opening a TRUNCATED URL — worse than not opening. Parked with the
  canon evidence (research-links.md §3d) for a later round.
- **D4 (allowlist verbatim):** canon's 12-scheme set copied exactly, not curated; fidelity-first.
  REJECTED: https/http-only (diverges observably for slack:/linear:/etc links).
- **D5 (xtversion Ghostty probe PARKED):** no XTVERSION plumbing exists; `TERM_PROGRAM` covers Ghostty and
  Warp in the direct case. Parked, not silently dropped.
- **D6 (`file:` NO-OP):** canon routes file: to its editor panel (`fileLinkOpensInPanel`); we have no
  panel. Opening in the browser would diverge from canon; no-op with the span still non-toggling. Parked.
- **D7 (500 ms timer via injectable clock):** house testability rule; canon's `pE=500` verbatim.
- **D8 (new canon clickable kinds NOTED, not built):** 2.1.246's `isItemClickable` adds
  `collapsed_read_search`, `goal_status` attachments with reason, and advisor results — recorded for the
  parity doc; out of round scope.

## Surprises & Discoveries

- Canon FLIPPED between 2.1.237 and 2.1.246: self-opening links shipped upstream after bl4's research.
  A parked "convenience" item turned out to be a parity regression in waiting. (Re-verify canon per
  subsystem, every round — the bl4 lesson, now with a version-flip instance.)
- Canon's media-type posture is derive-not-validate; the parked item's own title encoded a wrong premise.
- Chain 4's PNG/JPEG-only sniff was a live bl4 coverage gap no review had caught.

## Outcomes & Retrospective

Pending — written at finish.

## Revision Notes

- v1: initial, both research reports folded in.
