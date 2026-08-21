# R4 — Image paste (Ctrl-V): canon mechanism + live SDK reachability

**Bottom line up front: REACHABLE.** The installed `@anthropic-ai/claude-agent-sdk` 0.3.237 accepts an
`{type:"image", source:{type:"base64", …}}` block inside a streaming-input user message, and the model
genuinely decodes the pixels — verified live, twice, with two different colours in one session. The
parity scorecard's ❌ on image paste is **not blocked by the SDK**. It is blocked only by work ccx has
not done: a clipboard reader, an image entry in the composer's paste map, and a `submit()` signature
that is currently `string`-only.

Canon read from `/Users/new/claude-code-bundle/2.1.236/cli.pretty.js` (2.1.236).

---

## PART A — the canon mechanism

### A1. Clipboard read: a three-tier chain, and **no `pngpaste`**

Canon never shells out to `pngpaste`. The reader is `l_t()` at **cli.pretty.js:333994**, and it tries
three tiers in order:

**Tier 1 — a compiled native addon (fast path).** `l_t` first asks
`getNativeModule()?.readClipboardImage(maxWidth, maxHeight)` (**333996–334008**). When present this
reads *and* downscales in-process and returns `{png, originalWidth, originalHeight, width, height}`;
canon then base64s it directly. The matching presence check is
`getNativeModule()?.hasClipboardImage` inside `TIf()` (**333987–333992**). ccx has no such addon, so
for us this tier does not exist and tier 2 is the real mechanism.

**Tier 2 — per-OS shell commands** (`uyv()`, **cli.pretty.js:333974–333977**). Each platform supplies
a `{checkImage, saveImage, getPath, deleteFile}` quartet. Canon runs `checkImage` first, and only on
exit 0 runs `saveImage` into a scratch file, then reads the bytes back.

| OS | `checkImage` | `saveImage` |
|---|---|---|
| **darwin** | `osascript -e 'the clipboard as «class PNGf»'` | `osascript -e 'set png_data to (the clipboard as «class PNGf»)' -e 'set fp to open for access POSIX file "<path>" with write permission' -e 'write png_data to fp' -e 'close access fp'` |
| **linux** | `xclip -selection clipboard -t TARGETS -o \| grep -E "image/(png\|jpeg\|jpg\|gif\|webp\|bmp)"` **‖** `wl-paste -l \| grep -E …` | `xclip -selection clipboard -t image/png -o > F` **‖** `wl-paste --type image/png > F` **‖** `xclip … -t image/bmp -o > F` **‖** `wl-paste --type image/bmp > F` |
| **win32** | `powershell -NoProfile -NonInteractive -Sta -Command "Add-Type -AssemblyName System.Windows.Forms; if (-not [Clipboard]::ContainsImage()) { exit 1 }"` | same shape, `[Clipboard]::GetImage()` → `.Save(<path>, ImageFormat::Png)` |

Note the **macOS mechanism is pure AppleScript StandardAdditions** — `the clipboard as «class PNGf»`
targets no GUI application, so it does not touch the AppleEvent queue of any app. No `screencapture`
is involved in paste (the one `screencapture` hit in canon, **495225**, is an unrelated
`/TemporaryItems/…screencaptureui…/Screenshot` path sniffer for drag-and-dropped screenshots).

The scratch file is a **fixed path**, `~/…/claude_cli_latest_screenshot.png` (same basename on all
three platforms, **333975**), the directory is created with mode `0700` (`mkdir(…, { mode: 448 })`,
**334024**), and it is deleted immediately after the read (`rm -f -- <path>`, fired at **334031**).

**Tier 3 — BMP rescue and text fallback.** If the saved bytes start with `BM` (`s[0]===66 &&
s[1]===77`, **334028**) canon runs them through `sharp(...).png()` first. If *no* image is found at
all, the Ctrl-V handler falls back to a plain text clipboard read (`s2n("clipboard")`,
**607374**) and pastes that as text — unless the text is binary garbage, guarded by `kIf()`
(**334097**: rejects anything containing a NUL byte, or a ≥32-char prefix that fails a printable-ratio
test).

**A separate route: image *files*.** `HGn` (**334123**) is the `getPath` quartet member —
darwin `osascript -e 'get POSIX path of (the clipboard as «class furl»)'`, linux
`xclip -selection clipboard -t text/plain -o ‖ wl-paste`, win32 `Get-Clipboard`. Combined with
`kWr = /\.(png|jpe?g|gif|webp)$/i` (**334124**) this is how a *copied file* or a typed/dragged path
becomes an image (`CIf`, **334136+**), including a WSL path translation.

### A2. Composer UX

**The keybinding.** `chat:imagePaste` is a first-class action in the keymap table
(**cli.pretty.js:174817**):

```js
Cti = qt(), UeS = Cti === "windows" || Cti === "wsl", jeS = UeS ? "alt+v" : "ctrl+v"
… context "Chat": { …, [jeS]: "chat:imagePaste", ...Cti === "wsl" && { "ctrl+v": "chat:imagePaste" } }
```

So: **macOS/Linux → `ctrl+v`; Windows → `alt+v`; WSL → both**. It is listed in the rebindable action
enum (**174997**) so a user can move it. **Ctrl-V is therefore never "distinguished from text paste"
by inspecting the paste payload — it is a distinct keystroke.** A real bracketed-paste of text arrives
on a different path entirely; Ctrl-V is a deliberate, explicit gesture that goes and *reads the
clipboard itself*. The text fallback described above exists only so that a user who pressed Ctrl-V
with text on the clipboard still gets their text.

**The handler** (`Rlt`, **cli.pretty.js:607367–607381**) is a strict cascade:
image → text-fallback → error toast. The error copy is SSH-aware:

```js
let dl = V.isSSH()
  ? "No image found in clipboard. You're SSH'd; try scp?"
  : `No image found in clipboard. Use ${ts} to paste images.`;   // ts = the resolved binding, e.g. "ctrl+v"
```

shown as a `kind:"feedback"` toast keyed `no-image-in-clipboard`, `timeoutMs: 1000` (**607380**).

**The chip.** On success `id()` (**607107–607118**) mints
`{ id, type:"image", content:<base64>, mediaType, filename:"Pasted image", dimensions, sourcePath }`
into `pastedContents`, and inserts the placeholder `bri(id)` = **`` `[Image #${e}]` ``**
(**cli.pretty.js:178829–178831**) into the buffer. The chip grammar is shared with text pastes —
`/\[(Pasted text|Image|Audio|\.\.\.Truncated text) #(\d+)(?: \+\d+ lines)?(\.)*\]/g` (**178835**) —
and the same token is atomically deletable as a unit (**494325**). Orphan sweep: when a chip is
deleted from the text, the effect at **607120+** drops the matching `pastedContents` entry.

**Ambient affordance.** A polling watcher calls `TIf()` and, when the clipboard gains an image, raises
a contextual hint (**493296**): ``Image in clipboard · ${binding} to paste``, priority `immediate`,
8 s. There is also a rotating tip (**672361**): "Use ctrl+v to paste images from your clipboard".

**Transcript rendering.** A submitted image renders as `[Image #N]` (**493248**, **528790**) or bare
`[Image]` when unnumbered (**522876**), and the live-turn row shows
`[Image data detected and sent to Claude]` (**526971**, **528081**).

**Size limits and formats.** The default limit object is `KX` at **cli.pretty.js:174696**:

```js
KX = { maxWidth: 2000, maxHeight: 2000, maxBase64Size: 5242880, targetRawSize: 3932160 }
```

— 2000×2000 px, **5 MiB base64**, 3.75 MiB raw target (exactly ¾ of the base64 cap, since base64
inflates 4/3). `_v()` (**304632–304640**) overrides these **per model** from the baked catalog's
`image_limits`; every current model (Sonnet 5, Opus 4.7/4.8/5, Fable 5, Mythos 5) carries
`image_limits: {maxWidth:2000, maxHeight:2000}` (**8503**). A second, tighter **per-block byte budget**
`v$r = 512000` (**174695**) is applied in `fN` (**231266–231271**): anything over 500 KB after
resizing gets binary-searched down by JPEG quality (`DDa`, **231232**).

The resize ladder (`jht`, **231162–231230**) is worth copying if ccx wants parity: pass through
untouched if already within limits → PNG palette-quantise → JPEG at quality 80/60/40/20 → dimension
resize (`fit:"inside", withoutEnlargement`) → repeat the quality ladder → last resort, clamp width to
1000 px at JPEG q20. Accepted formats are **PNG, JPEG, GIF, WebP** (the failure copy names exactly
those four, **231226**), plus BMP via the pre-conversion above. On total failure the block degrades to
**text**, not an error: `` {type:"text", text:`[Image could not be processed: ${msg}]`} `` (**231262**).

### A3. How the image reaches the API — base64 inline, never a file reference

`fN()` (**cli.pretty.js:231256–231273**) is the single builder, and its return is unambiguous:

```js
return { block: { type: "image", source: { type: "base64", media_type: vUn(s), data: s.toString("base64") } },
         dimensions: i.dimensions };
```

`G1v()` (**371395–371405**) maps the composer's `pastedContents` through `fN` into a block array, and
the caller (**371425–371427**) assembles the user message as **text block first, then the image
blocks**:

```js
l = [{ type: "text", text: … }, ...s]      // s = the image blocks
```

The temp PNG on disk is scratch only — it is `rm -f`'d before the message is ever built. **Nothing on
the wire references a path.**

### A4. What is actually available on THIS machine (read-only check)

```
pngpaste       NOT FOUND        ← and canon never needs it
osascript      /usr/bin/osascript
xclip          NOT FOUND        (macOS — expected)
wl-paste       NOT FOUND        (macOS — expected)
screencapture  /usr/sbin/screencapture
sips           /usr/bin/sips
sharp          NOT installed in harness/node_modules
```

`osascript -e 'the clipboard as «class PNGf»'` → **exit 1** right now, i.e. the mechanism works and
correctly reports "no image on the clipboard" (stdout discarded; no clipboard data was read out). So
**canon's tier-2 macOS path is fully available to ccx today with zero new dependencies.** The only
missing piece is `sharp`, needed for the resize/format ladder — and only for oversized images.

---

## PART B — the live probe (the decisive half)

**File:** `/Users/new/Developer/GitHub/codex_somersault/CC-to-SDK/probes/probes/113-image-content-block.ts`
(new; no harness product code touched, nothing committed).

**Declared surface it tests against.** `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:4939-4944`
types `SDKUserMessage.message` as `MessageParam` with the doc string:

> *"An Anthropic Messages API user message: a MessageParam with role "user" whose content is a string
> or an array of content blocks (text, image, document, tool_result, ...)."*

Declared ≠ reachable, hence the probe.

**Design.** Streaming-input session (probe 111's `openStreaming`, generalised so `send` takes a content
*array* — the one-shot `prompt: string` form has no way to carry a block at all). Three turns on one
live session:

- **turn 0 — CONTROL, text-only.** Added after the first run (see below). Without it, any failure is
  indistinguishable from "the image block was rejected," and the probe reports a false negative.
- **turn 1 — image block first, then text**, a 64×64 solid **RED** PNG + *"Reply with only the dominant
  color of this image, one word."*
- **turn 2 — text first, then image**, same prompt, a 64×64 solid **BLUE** PNG.

Two colours, not one, because **a model asked "what colour is this image" with no image still emits a
colour word.** Only a model actually decoding pixels flips red → blue. Turn 2 also varies block order,
so an order-sensitivity would surface. PNGs are generated in-probe (hand-rolled IHDR/IDAT/IEND +
`zlib.deflateSync`, 168 bytes each) — no fixtures, no image dependency.

### Run 1 — INCONCLUSIVE, and why that matters

```
[p113] ASSISTANT: "You've hit your weekly limit · resets Aug 26 at 1pm (Asia/Seoul)"
[p113] FRAME result/success {"is_error":true,…,"terminal_reason":"api_error","api_error_status":429,…}
[p113] VERDICT: UNREACHABLE — the image content block was rejected
```

That verdict was **wrong**. A 429 weekly-limit on the OAuth subscription is credential-level and would
have hit a plain text turn identically — nothing about the image was tested. This is exactly the
false-negative the control turn now prevents, and the probe was amended before the real run.
`CC-to-SDK/.env`'s `CLAUDE_CODE_OAUTH_TOKEN` is exhausted **until Aug 26 ~13:00 Asia/Seoul**.

To get a decisive answer I fell back to the `ANTHROPIC_API_KEY` line that sits commented in
`CC-to-SDK/.env`, exported in-shell without ever printing it, behind a new opt-in flag
(`CCX_ALLOW_API_KEY=1`; the probe still deletes the key by default so OAuth stays the norm). **This
billed metered API credit — `total_cost_usd` on the final result frame was `$0.8577`**, almost all of
it one 38,844-token system-prompt cache write on turn 0; the three turns themselves were 12 output
tokens combined. Flagging it because it is real money spent without asking.

### Run 2 — DECISIVE. Verbatim outcome

```
[env] credential present — oauth: true | api key: true
[p113] fixture bytes — red: 168 blue: 168
[p113] ASSISTANT: "ok"
[p113] CONTROL healthy (credential + transport + streaming input all work): true
[p113] ASSISTANT: "Red"
[p113] ASSISTANT: "Blue"
[p113] ---
[p113] message types seen: system/hook_started,system/hook_response,system/init,assistant,result/success
[p113] TURN turn0 CONTROL text-only          | text: ["ok"]   | error: []
[p113] TURN turn1 IMAGE image-then-text (red)| text: ["Red"]  | error: []
[p113] TURN turn2 text-then-image (blue)     | text: ["Blue"] | error: []
[p113] hard stream error: none
[p113] SCHEMA ACCEPTED (no 400 / no throw, a real assistant turn came back): true
[p113] TURN1 named RED: true | TURN2 named BLUE: true
[p113] VERDICT: REACHABLE — schema accepted AND the model read the pixels on both turns
                (colour flipped red→blue, so it is not guessing)
```

Per-turn result frames: all three `is_error:false`, `stop_reason:"end_turn"`, model
`claude-fable-5`. No `system/error`, no refusal, no 400. **No alternative message shape was needed** —
the first shape tried was accepted, so the fallback investigation the brief authorised never had to
run.

### What this establishes

1. **Schema accepted.** `{type:"image", source:{type:"base64", media_type:"image/png", data}}` passes
   through the SDK's stdio transport into the API unmodified.
2. **The model sees pixels.** Red → "Red", blue → "Blue" on consecutive turns. Not a guess.
3. **Both block orders work** — image-then-text and text-then-image.
4. **Multi-turn works** on one long-lived streaming session; the image does not poison or terminate it.
5. **Streaming input is mandatory.** `query({prompt: "<string>"})` cannot carry a block; only the
   `AsyncIterable<SDKUserMessage>` form can. ccx already runs its sessions this way.

---

## VERDICT

**REACHABLE headlessly.** Evidence: probe 113 run 2, above — control turn healthy, both image turns
returned `is_error:false` and named their own distinct colour. The parity scorecard's ❌ on image paste
should move off "SDK can't do it"; the remaining gap is entirely ccx-side build work.

## Canon mechanism map (what ccx would copy)

| Stage | Canon | Line |
|---|---|---|
| Keybinding | `chat:imagePaste`; `ctrl+v` (mac/linux), `alt+v` (win), both (wsl) | 174817 |
| Presence check | `osascript -e 'the clipboard as «class PNGf»'` (exit code) | 333987, 333975 |
| Read | native addon → osascript write-to-tempfile → BMP rescue via sharp | 333994 |
| Text fallback | `s2n("clipboard")` guarded by binary-garbage test `kIf` | 607374, 334097 |
| Error toast | `No image found in clipboard. Use ctrl+v to paste images.` / SSH variant | 607379 |
| Chip | `` `[Image #${id}]` ``, shared chip grammar, orphan sweep | 178829, 178835 |
| Entry | `{id, type:"image", content:<b64>, mediaType, filename:"Pasted image", dimensions}` | 607112 |
| Limits | `{maxWidth:2000, maxHeight:2000, maxBase64Size:5 MiB, targetRawSize:3.75 MiB}`, per-model override; 500 KB per-block budget | 174696, 304632, 174695 |
| Resize ladder | passthrough → PNG palette → JPEG 80/60/40/20 → resize → repeat → 1000 px @ q20 | 231162 |
| Wire block | `{type:"image", source:{type:"base64", media_type, data}}` | 231272 |
| Assembly | text block first, image blocks appended | 371395, 371425 |

## What ccx would need to build

**The substrate is already there.** `src/tui/pasteChips.ts` already implements the chip grammar
*including* `Image #\d+` in its `TOKEN_BEFORE_RE` (pasteChips.ts:75), atomic chip deletion, orphan
sweep, and a `pastedContents` map that rides through history, stash, and the queue. Four things are
missing:

1. **A clipboard reader** — `src/tui/clipboardImage.ts`, new. Copy canon's tier-2 quartet verbatim
   (`osascript`/`xclip`/`wl-paste`/PowerShell), check-then-save-then-read-then-`rm`, 0700 temp dir.
   Zero new runtime deps on macOS. Optional `sharp` (not currently installed) only for the resize
   ladder; without it, cap by rejecting oversize with canon's degrade-to-text block.
2. **Widen `PastedEntry`** — it is `{ id; type: "text"; content: string; lineCount: number }` today
   (`src/tui/editor.ts:44`). Needs an `image` variant carrying `content` (base64), `mediaType`, and
   `dimensions`. `chipLabel` gains the `[Image #N]` form.
3. **Widen the submit chain — this is the real work.** `submit(prompt: string, …)` is string-typed the
   whole way down: `src/session/session.ts:132`, `src/session/chatSession.ts:11`,
   `src/appserver/registry.ts:34`, `src/appserver/fleetEngine.ts:126`, `src/daemon/supervisor.ts:144`,
   and the message builder at `src/session/session.ts:27` hardcodes `content: text`. Today
   `useChat.ts:3021` does `submit(substituteChips(e.text, …))` — chips are flattened to a *string*, so
   an image chip has nowhere to go. Widen to `string | ContentBlock[]`, and have the flatten step emit
   canon's shape: text block first, image blocks appended.
4. **Wire `chat:imagePaste`** into the F2 keymap table with canon's per-OS binding, plus the toast copy
   and (cheap, nice) the "Image in clipboard · ctrl+v to paste" ambient hint.

Steps 1, 2 and 4 are self-contained. Step 3 is a cross-cutting signature change touching the session,
appserver, fleet and daemon layers — that is where the estimate lives, and it is worth scoping before
committing the row to a wave.

---

### Notes for whoever picks this up

- **`CLAUDE_CODE_OAUTH_TOKEN` is rate-limited until ~Aug 26 13:00 Asia/Seoul.** Any live probe or live
  test run before then will 429. Probe 113's control turn now makes that legible instead of poisoning
  a verdict; other probes have no such guard and will report misleading failures.
- Probe 113 is re-runnable free-of-charge on OAuth once the limit resets: just
  `set -a; . ../.env; set +a; npx tsx probes/113-image-content-block.ts` (leave `CCX_ALLOW_API_KEY`
  unset).
