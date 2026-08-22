# QA driver recipe — driving `ccx` and `claude` from an agent

**Status:** proven end-to-end on 2026-08-06. Every command below was executed live; the
findings section records what actually happened, including the parts that failed.

**Purpose.** Let a QA agent drive the two terminal UIs — our clone `ccx` and the installed
Claude Code CLI — the way a human does: launch, type, press keys, read frames, resize, exit.
This file is the verbatim recipe. Follow it literally.

**Environment at time of proving**

| Thing | Value |
|---|---|
| `claude --version` | `2.1.222 (Claude Code)` at `/Users/new/.local/bin/claude` |
| `tmux -V` | `tmux 3.7b` |
| ccx binary | `harness/dist/cli/bin.js` (package.json `bin.ccx`) |
| platform | darwin 25.5.0 |

> The parity corpus is pinned to Claude Code 2.1.220; the installed CLI was **2.1.222** at proving
> time and **2.1.226** by sweep #2 (2026-08-10). Nothing was installed or upgraded by any agent.
> If a future run finds a different version, re-check the onboarding seed keys
> (`lastOnboardingVersion` in particular) and re-read §4.2's alternate-screen caveat.

---

## 0. Non-negotiable isolation rule

**Every TUI you launch runs under an isolated `HOME` and in a scratch project directory.**
A real incident happened here: an unisolated run wrote to the operator's live `~/.claude/ccx`.

- Isolated home: `HOME=$(mktemp -d /tmp/qa-home-XXXXXX)`
- For `ccx` additionally: `CCX_FLEET_ROOT="$HOME/.claude/ccx"` — pointing at the **isolated**
  home. (`src/fleet/paths.ts` honours `CCX_FLEET_ROOT` above everything else.)
- Scratch project: `cd`-target is its own `mktemp -d`, never the real repo.
- Never `echo`, `printf`, `cat` or log `ANTHROPIC_API_KEY` / `CLAUDE_CODE_OAUTH_TOKEN`.
  Pass them through `env` only.

**Prove isolation held.** Record the mtime of the real prefs file before and after the whole run:

```bash
stat -f '%m %Sm %N' ~/.claude/ccx/prefs.json
```

In the proving run both readings were identical (`1785951625  Aug 6 02:40:25 2026`), and the real
`~/.claude/ccx/roster` entry count was unchanged at 114.

---

## 1. Setup

### 1.1 Build ccx

```bash
cd /Users/new/Developer/GitHub/codex_somersault/CC-to-SDK/harness
npm run build          # tsc -p tsconfig.build.json
```

### 1.2 Load auth into the launching shell

```bash
set -a; . /Users/new/Developer/GitHub/codex_somersault/CC-to-SDK/.env; set +a
```

`.env` carries `CLAUDE_CODE_OAUTH_TOKEN` (subscription billing). Keep any `ANTHROPIC_API_KEY`
line commented — it shadows the OAuth token.

### 1.3 Create the scratch world

```bash
QA_ROOT=$(mktemp -d /tmp/qa-driver-XXXXXX)
CCX_HOME=$(mktemp -d "$QA_ROOT/qa-home-ccx-XXXXXX")
CCX_PROJ=$(mktemp -d "$QA_ROOT/qa-proj-ccx-XXXXXX")
CC_HOME=$(mktemp -d "$QA_ROOT/qa-home-cc-XXXXXX")
CC_PROJ=$(mktemp -d "$QA_ROOT/qa-proj-cc-XXXXXX")
CC_PROJ_REAL=$(cd "$CC_PROJ" && pwd -P)     # see §3.1 — the resolved path matters
mkdir -p "$CCX_HOME/.claude/ccx"
```

### 1.4 Driver helpers (source these)

```bash
cat > /tmp/qa-driver-helpers.sh <<'HELP'
# wait_until <session> <needle> <timeout_secs>  — poll, never a bare sleep
wait_until() {
  local s="$1" needle="$2" to="${3:-60}" i=0
  while [ $i -lt $((to*2)) ]; do
    tmux capture-pane -t "$s" -p 2>/dev/null | grep -qF -- "$needle" && return 0
    sleep 0.5; i=$((i+1))
  done
  return 1
}
# wait_idle <session> <timeout_secs> — turn is over when the interrupt hint is gone
wait_idle() {
  local s="$1" to="${2:-120}" i=0
  sleep 1                                  # let the spinner appear first
  while [ $i -lt $((to*2)) ]; do
    tmux capture-pane -t "$s" -p | grep -q "esc to interrupt" || return 0
    sleep 0.5; i=$((i+1))
  done
  return 1
}
# type_line <session> <text> — literal text, THEN a SEPARATE Enter
type_line() { tmux send-keys -t "$1" -l "$2"; sleep 0.3; tmux send-keys -t "$1" Enter; }
frame()     { tmux capture-pane -t "$1" -p; }      # plain text
frame_sgr() { tmux capture-pane -t "$1" -e -p; }   # with SGR colour escapes
HELP
source /tmp/qa-driver-helpers.sh
```

---

## 2. Driving `ccx`

### 2.1 Launch line (proven verbatim)

```bash
tmux new-session -d -s qaccx -x 120 -y 40 -c "$CCX_PROJ" \
  "env HOME=$CCX_HOME \
       CCX_FLEET_ROOT=$CCX_HOME/.claude/ccx \
       CLAUDE_CODE_OAUTH_TOKEN=$CLAUDE_CODE_OAUTH_TOKEN \
       TERM=xterm-256color \
       CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1 \
   node /Users/new/Developer/GitHub/codex_somersault/CC-to-SDK/harness/dist/cli/bin.js"

tmux set-option -t qaccx remain-on-exit on    # keeps the final frame + exit code readable
wait_until qaccx '⏸ manual mode on' 30        # ready-needle for ccx (see §8.4 — '⏎ send' is GONE)
```

`ccx` needs no onboarding seed at all — a bare isolated `HOME` lands straight in the REPL.
Note `ccx --help` is not a flag it knows (`ccx: unknown flag --help`); bare invocation on a TTY
is the interactive REPL.

**Pin ccx's renderer on the launch line, exactly as §4.2 requires for `claude`.** ccx has two
renderers of its own since the fullscreen-live-window wave, chosen ONCE at startup by
`src/tui/renderer.ts`'s `selectRenderer()` ladder and never re-evaluated:

| Pin | Renderer | Ladder rung |
|---|---|---|
| `CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1` | classic (main screen, log-update) | `env_off` |
| `CLAUDE_CODE_NO_FLICKER=1` | fullscreen (alternate screen, live window) | `env_on` |

Same spellings as `claude`'s, deliberately — a machine already configured for Claude Code is
configured for ccx. `env_off` outranks `env_on`, so never set both. Only a non-TTY (`not_tty`) and
`CLAUDE_AX_SCREEN_READER` outrank the pins; nothing below them — the `tui` prefs key, the built-in
default — can override one.

**`DEFAULT_ON` is `true` as of the wave's Task 16**, so an *unpinned* ccx launch is now **fullscreen**.
Before the flip, unpinned cells measured classic whether they said so or not and the accident was
harmless; it is not harmless now, and the failure mode is the quiet one — an unpinned cell still runs
and still passes, having changed which renderer it was about. **The rule is the same one §4.2 states
for `claude`: every ccx launch line pins a renderer, and every recorded result names the renderer it
was taken under.** `/status` names the live renderer and the rung that chose it
(`renderer   classic (env_off) · …`) — read it back whenever a cell's result surprises you, rather
than inferring the mode from the frame.

**One more rung can send an UNPINNED cell to classic, and it is not an env var — but it cannot touch a
pin.** A fullscreen pin outranks it: `env_on` (`CLAUDE_CODE_NO_FLICKER=1`) sits ABOVE the tmux rung on the
ladder, so a pinned cell gets the renderer it asked for wherever it runs. The rung only decides cells that
pin nothing. From Task 16 it asks tmux itself — `tmux display-message -p '#{client_control_mode}'`, canon's
own probe, restored because the flip made the gap reachable — whenever `TMUX` is set and `TERM_PROGRAM` is
either unset or the literal `tmux`. That last word is ccx's deliberate divergence from canon, and it is
what makes the rung work at all: measured on tmux 3.7b, tmux stamps `TERM_PROGRAM=tmux` into every pane it
spawns, so canon's "entirely unset" gate can never fire inside tmux.

So, for a cell driven from a tmux pane with no pin: an **ordinary** pane answers `0`, the rung does not
fire, and the cell lands on the new default — **fullscreen**, not classic. A pane whose client is a
`tmux -CC` control-mode session answers `1` and lands `classic (tmux_cc_off)`, saying so once in the
transcript (`fullscreen disabled: tmux -CC (iTerm2 integration mode) detected …`). Either way: pin the
cell, and read `/status` back.

**THE ONE EXCEPTION TO THE PIN RULE: a cell whose subject IS `/tui`.** The pins outrank the `tui` prefs
key, so under `CLAUDE_CODE_NO_FLICKER=1` the command answers `Saved. The default renderer does not apply
here (env_on).` and changes nothing on screen — a cell that asks `/tui` to switch renderers cannot be run
from a pinned launch at all. Such a cell **launches unpinned from a fresh isolated home** and seeds the
starting renderer through the rung `/tui` actually decides (write `{"tui":"fullscreen"}` or
`{"tui":"default"}` into `$CCX_HOME/.claude/ccx/prefs.json` before launch, or take the unpinned default and
say so). Record the departure in the result, and read `/status` back on both sides of the switch — the
provenance word (`default_on`, `settings_off`, …) is what says which rung you actually measured.

**And a cell that touches `/tui` needs its OWN isolated home, not a shared one.** `/tui` WRITES the `tui`
pref, and it writes it even when the pin makes the switch a no-op — so a pinned attempt leaves
`{"tui":"default"}` behind and the next *unpinned* cell in that home boots `classic (settings_off)` instead
of the default it was written to measure. This is a quiet failure: the cell still runs and still passes,
about a different renderer. Give every `/tui` cell a `mktemp -d` home of its own, and never reuse a home
after a cell that could have written a pref.

**Which instrument measures which renderer** (keep this table honest when adding one):

| Instrument | Renderer | How it is pinned |
|---|---|---|
| §2.1 launch line above | classic | `CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1` on the line |
| §5 resize probe | classic | inherits §2.1's session |
| §6.2 terminal-usability probe | fullscreen | `CLAUDE_CODE_NO_FLICKER=1` on the line (the alt screen is the thing whose restore it proves) |
| `harness/scripts/resize-matrix.sh` — nine classic cells (`c1`–`c4`, `h1`, `h2`, `a5`, `g1`, `m1`) plus `a3` | classic | `CLAUDE_CODE_NO_FLICKER=0`, the `launch` helper's default pin |
| `harness/scripts/resize-matrix.sh` — one fullscreen cell (`f1`) | fullscreen | `CLAUDE_CODE_NO_FLICKER=1` passed to `launch` by that cell |
| `harness/scripts/capture-frames.py` (both binaries) | classic | `CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1` written into `child_env` — the goldens in `test/fixtures/upstream-frames/` are main-screen shaped |
| `harness/scripts/drive-repl.py` | classic | `CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1` set on the child; a raw pty stream is a main-screen instrument |

### 2.2 One turn

```bash
type_line qaccx 'Reply with exactly: QA-PING-OK'
wait_idle qaccx 120
frame qaccx
```

Observed frames:

- **before** — banner, `cwd`, `model (default) · mode default`, tips, composer
  `❯ Try "create a util logging.py that..."`, footer `model claude-opus-5  mode auto (⇧Tab to cycle)  think default`
- **during** — `· Crafting… (1s · esc to interrupt)`, footer gains `⟳ streaming`, hint becomes `Esc interrupt`
- **after** — `⏺ QA-PING-OK` in the transcript, footer gains `ctx 2%`, hint back to `Esc rewind · ? help`

### 2.3 Exit

Both work and both were verified:

```bash
type_line qaccx '/quit'                       # session ends, exit status 0
# or
tmux send-keys -t qaccx C-c; sleep 0.2; tmux send-keys -t qaccx C-c
```

After the first `C-c`, ccx shows `Press Ctrl-C again to exit`. With `remain-on-exit on`:

```bash
tmux display -p -t qaccx '#{pane_dead} #{pane_dead_status}'   # -> "1 0"
```

---

## 3. Driving the installed `claude`

An isolated `HOME` means a first-run gauntlet. There are **four** gates, and all four are
seedable. Discovered empirically by walking them once and diffing the files.

### 3.1 The onboarding seed

Two files. Write them **before** launching.

```bash
mkdir -p "$CC_HOME/.claude"

# gate 1: theme picker   gate 4: bypass-permissions consent
cat > "$CC_HOME/.claude/settings.json" <<'EOF'
{"theme":"dark","skipDangerousModePermissionPrompt":true}
EOF

# gate 2: login-method picker   gate 3: per-project trust dialog
python3 -c '
import json,sys
home,proj=sys.argv[1],sys.argv[2]
json.dump({
 "hasCompletedOnboarding":True,
 "lastOnboardingVersion":"2.1.222",
 "installMethod":"native","autoUpdates":False,
 "projects":{proj:{
   "hasTrustDialogAccepted":True,
   "projectOnboardingSeenCount":1,
   "allowedTools":[],"mcpServers":{},"mcpContextUris":[],
   "enabledMcpjsonServers":[],"disabledMcpjsonServers":[],
   "hasClaudeMdExternalIncludesApproved":False,
   "hasClaudeMdExternalIncludesWarningShown":False}}},
 open(home+"/.claude.json","w"))' "$CC_HOME" "$CC_PROJ_REAL"
```

**The `projects` key must use the fully resolved path.** On macOS `mktemp -d /tmp/...` returns
`/tmp/...` but `claude` keys the entry under `/private/tmp/...`. Use `$(cd "$dir" && pwd -P)`.
Get this wrong and the trust dialog still appears.

What each gate looks like if you miss it:

| Gate | Screen | Seed |
|---|---|---|
| 1 | "Choose the text style that looks best with your terminal" | `~/.claude/settings.json` → `theme` |
| 2 | "Select login method: Claude account / Console / 3rd-party" | `~/.claude.json` → `hasCompletedOnboarding: true` |
| 3 | "Quick safety check: Is this a project you created or one you trust?" | `~/.claude.json` → `projects[<realpath>].hasTrustDialogAccepted: true` |
| 4 | "WARNING: Claude Code running in Bypass Permissions mode" | `~/.claude/settings.json` → `skipDangerousModePermissionPrompt: true` |

Gate 4 only appears with `--dangerously-skip-permissions`. Its default highlighted option is
**"1. No, exit"** — a blind `Enter` kills the session. Seed it rather than answering it.

The OAuth token still reaches the process through `env` on the launch line; seeding
`hasCompletedOnboarding` skips the *picker*, it does not skip *authentication*.

### 3.2 Launch line (proven verbatim)

```bash
tmux new-session -d -s qacc -x 120 -y 40 -c "$CC_PROJ_REAL" \
  "env HOME=$CC_HOME \
       CLAUDE_CODE_OAUTH_TOKEN=$CLAUDE_CODE_OAUTH_TOKEN \
       TERM=xterm-256color \
   /Users/new/.local/bin/claude --dangerously-skip-permissions"

tmux set-option -t qacc remain-on-exit on
wait_until qacc 'for agents' 60        # mode-agnostic ready-needle, see fragile spots
```

Drop `--dangerously-skip-permissions` for a permission-realistic session; the CLI then starts in
`⏸ manual mode on`, where read-only tools (Read/Glob/Grep) are auto-allowed but writes and Bash
raise a dialog you must answer with arrow keys + `Enter`.

### 3.3 One turn

```bash
type_line qacc 'Reply with exactly: QA-PING-OK'
wait_idle qacc 120
frame qacc
```

Observed frames:

- **before** — welcome box `╭─── Claude Code v2.1.222 ───╮`, "Welcome back!", model/cwd, "What's new",
  composer, footer `⏸ manual mode on · ? for shortcuts · ← for agents`
- **during** — `✢ Wrangling…`, footer becomes `⏸ manual mode on · esc to interrupt · ← for agents`
- **after** — `⏺ QA-PING-OK` then `✻ Worked for 4s`

A tool-using turn under `--dangerously-skip-permissions` was also driven end-to-end
(`Create a file named ok.txt containing exactly QA-WRITE-OK`), producing
`⏺ Write(ok.txt)` / `⎿  Wrote 1 line to ok.txt` and a real file on disk. No dialog appeared.

### 3.4 Exit

`/exit` works. `C-c C-c` works **only if the two presses are close together**:

```bash
tmux send-keys -t qacc C-c; sleep 0.2; tmux send-keys -t qacc C-c    # exits
```

With `sleep 1.2` between the presses the second `C-c` was treated as a fresh first press and the
session stayed alive. `C-d` on an empty composer did **not** exit. See fragile spots.

---

## 4. Mouse probe

### 4.1 Question

Can a QA agent click a folded row — e.g. `Read 1 file (ctrl+o to expand)` — and have it expand?

### 4.2 Is the app even in mouse-reporting mode?

`capture-pane` cannot show this, but tmux tracks the DECSET modes the application requested and
exposes them as format variables. **This is the cheapest and most decisive check:**

```bash
tmux display -p -t qacc \
  'any=#{mouse_any_flag} btn=#{mouse_button_flag} std=#{mouse_standard_flag} sgr=#{mouse_sgr_flag} all=#{mouse_all_flag}'
```

Result for `claude` 2.1.222 — `any=0 btn=0 std=0 sgr=0 all=0`, in **every** state tested: fresh
REPL, mid-turn, after a folded tool row, after `ctrl+o` expansion, and with the `/model` picker
open. `ccx` reports the same all-zero set. ~~**Neither TUI ever enables mouse reporting.**~~

> **STALE for `ccx`'s fullscreen renderer since F9 T-MOUSE (`bb3db3569a`, 2026-08-22).** The
> all-zero reading above was `ccx`-classic (this proving run's subject) and `claude` 2.1.222 — both
> still true as stated. Fullscreen `ccx` now arms the maximum set by default:
> `?1000h ?1002h ?1003h ?1006h` (`MOUSE_ON_FULL`, `mouseMode`/`mouseEnable` in `src/tui/altScreen.ts`,
> pinned byte-for-byte by `test/unit/alt-screen.test.ts`). Re-verified live in this same harness
> (T-MOUSE task 8, isolated home, private tmux socket): after an unpinned/`CLAUDE_CODE_NO_FLICKER=1`
> launch, `tmux display -p 'any=#{mouse_any_flag} btn=#{mouse_button_flag} std=#{mouse_standard_flag}
> sgr=#{mouse_sgr_flag} all=#{mouse_all_flag}'` read `any=1 btn=0 std=0 sgr=1 all=1`, and a
> `pipe-pane`-captured raw log showed the exact enter bytes `\x1b[?1000h\x1b[?1002h\x1b[?1003h\x1b[?1006h`
> right after `smcup`. `CLAUDE_CODE_DISABLE_MOUSE_CLICKS=1` restores precisely the two-mode arm this
> section originally measured (`\x1b[?1000h\x1b[?1006h`, flags `any=1 std=1 sgr=1 btn=0 all=0`,
> confirmed both by raw bytes and by feeding a motion+drag sweep at a transcript row and finding the
> frame byte-identical before and after). `CLAUDE_CODE_DISABLE_MOUSE=1` still arms nothing at all
> (`std=btn=sgr=all=0`, no `?100xh` bytes anywhere in the enter sequence). See
> `docs/superpowers/specs/2026-08-22-f9-wave-design.md` Track T-MOUSE and
> `.doperpowers/sdd/2026-08-22-f9-t-mouse/task-8-report.md` for the full evidence.

> **STALE for claude ≥2.1.226 — and the trigger is NOT geometry** (sweep #2 filed s2qa6-19 as
> "alt screen at ≤24 rows"; the FULLSCREEN-1 grounding, 2026-08-12, overturned the mechanism with
> 32 captures): the renderer is a **rollout-flag decision cached in `$HOME`**, chosen ONCE at
> startup and never re-evaluated on resize. A **cold** isolated home falls back to the flag
> default (main screen, mouse off); the **second** launch in the same home reads the cached flag
> and goes fullscreen **at every size tested (8–40 rows, 40–200 cols)** with SGR + any-motion
> mouse reporting ON. The fleet's "24 enters, 40 doesn't" was cold-vs-warm home, not pane height.
> **RULE: every claude launch line MUST pin the renderer explicitly** —
> `CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1` (classic) or `CLAUDE_CODE_NO_FLICKER=1` (fullscreen) —
> or the cell is silently sampling one of two renderers depending on home warmth. "Neither TUI
> ever enables mouse reporting" above is true only of the classic renderer.

### 4.2a Two more DECSET mirrors: `alternate_on` and `cursor_flag`

tmux tracks two more of the DECSET modes the fullscreen work turns on and off, and exposes them the
same way. Both have been used ad hoc for a while — `alternate_on` carried the FULLSCREEN-1
grounding's captures, `cursor_flag` Wave R's cursor-parking measurements — and neither was ever
written down here. Read them with the same `display -p` invocation as the mouse flags (`display` is
the alias for `display-message`):

```bash
tmux display -p -t qaccx 'alt=#{alternate_on} cursor=#{cursor_flag}'
```

| Variable | Meaning | Reads |
|---|---|---|
| `alternate_on` | the app holds the **alternate screen** (DECSET 1049 / 1047 / 47) | `1` fullscreen, `0` main screen |
| `cursor_flag` | the cursor is **visible** (DECSET 25) | `1` shown, `0` hidden |

Verified live on tmux 3.7b, 2026-08-12, against a scratch pane rather than assumed from the manual:
baseline `alt=0 cursor=1`; after writing `\033[?1049h\033[?25l` to the pane, `alt=1 cursor=0`; after
`\033[?1049l\033[?25h`, back to `alt=0 cursor=1`. Both appear in `tmux display-message -a`, so a
future tmux that renames them will say so there.

**Startup-only, not continuous.** For `claude`, `alternate_on` never changes on resize in either
direction (FULLSCREEN-1 grounding, `startup-vs-live-resize.txt`: launched fullscreen it stays `1`
from 80×40 down to 80×24 and back; launched forced-off it stays `0` across the same legs). ccx's
`selectRenderer()` is likewise a boot-time decision. So a cell that resizes is not re-testing the
renderer choice — pin it (§2.1) and read `alternate_on` once to confirm which one you got.

**Why `cursor_flag` earns its place: it is half of the exit guarantee, checked from outside the
process.** ccx's crash path writes mouse-off, rmcup and `\x1b[?25h` with `writeSync`
(`src/tui/altScreen.ts`), which is exactly the class of claim a QA cell should not take on trust
from the source. After any exit, `any=0 sgr=0 all=0 alt=0 cursor=1` is the four-way assertion that
the terminal was handed back.

**What these variables CANNOT see: termios raw mode and bracketed paste (DECSET 2004).** tmux
exposes no format variable for either, and the crash path writes `\x1b[?2004l` too. Those two need a
live shell — §6.

### 4.3 Injecting mouse bytes — which method actually delivers

Two methods were tested against the live pane.

**Method A — write escape bytes to the pane's slave tty. Does not work; do not use.**

```bash
TTY=$(tmux display -p -t qacc '#{pane_tty}')     # e.g. /dev/ttys029
printf '\033[<0;10;22M\033[<0;10;22m' > "$TTY"   # write succeeds, app never sees it
```

The write returns success and produces no effect. This is expected once you think about the pty
direction: `/dev/ttysNNN` is the **slave** side, which is the application's stdout. Writing to it
pushes bytes toward the terminal *as if the app had printed them* — it does not enqueue them on
the application's stdin. tmux parsed the CSI, found nothing renderable, and dropped it. There is
no input path here. (macOS also restricts `TIOCSTI`, so the classic stuff-the-input-queue trick
is unavailable.)

**Method B — `tmux send-keys -H`. This is the one that works.**

```bash
# SGR press:   ESC [ < 0 ; 10 ; 22 M
tmux send-keys -t qacc -H 1b 5b 3c 30 3b 31 30 3b 32 32 4d
# SGR release: ESC [ < 0 ; 10 ; 22 m
tmux send-keys -t qacc -H 1b 5b 3c 30 3b 31 30 3b 32 32 6d
```

`-H` takes raw hex bytes and enqueues them on the pane's **input**. Delivery was proven with a
control byte rather than assumed:

```bash
tmux send-keys -t qacc -H 5a      # 0x5a = 'Z'  ->  composer shows "❯ Z"
```

`Z` appeared in the composer in both TUIs, so the channel is real and the mouse bytes genuinely
reached both applications.

**Coordinates.** SGR mouse coordinates are 1-based from the top-left of the screen, and
`tmux capture-pane -p` emits one output line per pane row, so *capture line N == mouse row N*.
Find the row with `capture-pane -p | cat -n`, then encode `ESC [ < 0 ; COL ; ROW M`.

### 4.4 Verdict

- **claude: click-to-expand did NOT work.** The folded row `Read 1 file (ctrl+o to expand)` was
  unchanged after a press+release delivered at its exact coordinates. That is not an injection
  failure — `claude` never requested mouse reporting (§4.2), so there is no click to receive. The
  row is keyboard-only, exactly as its own label says.
- **`ctrl+o` does work**, and is the supported way to expand:
  ```bash
  tmux send-keys -t qacc C-o
  ```
  It replaced the folded row with the full
  `⏺ Read(/private/tmp/.../bigfile.txt)` + `⎿  Read 201 lines` view (plus timestamps and the model
  name). `ctrl+o` again re-folds it.
- **ccx handled the identical bytes cleanly — no leak, no break.** Sent to the ccx pane, the SGR
  press+release left the composer showing its untouched placeholder
  (`❯ Try "create a util logging.py that..."`), the process stayed alive, and the frame was
  unchanged. Nothing appeared as text.
- **Legacy X10 encoding is also swallowed cleanly by both.** `ESC [ M <sp> * 6`
  (`tmux send-keys -H 1b 5b 4d 20 2a 36`, button 0 at col 10 row 22) — the encoding most likely to
  leak because its payload bytes are printable — produced no composer text and no corruption in
  either TUI.

So the escape-sequence parsers on both sides are well-behaved. There is simply nothing to click.

> **STALE for `ccx`'s fullscreen renderer since F9 T-MOUSE (2026-08-22).** This whole section's
> proving run was against `ccx`-classic (the subject at the time), and every bullet above is still
> true as a description of that renderer and of `claude` itself — neither enables mouse reporting,
> so neither has anything to click. It stopped being true of `ccx` as a whole: fullscreen `ccx` now
> arms the full mouse set by default and there genuinely is something to click — a fold cluster
> toggles (tool-stream wave, 2026-08-19), a transcript row hovers and can be dragged into a
> selection that auto-copies, and a composer click positions the caret (F9 T-MOUSE). See §4.2's own
> correction above and `.doperpowers/sdd/2026-08-22-f9-t-mouse/task-8-report.md` for the byte-level
> captures.

---

## 5. Resize probe

**Renderer: classic.** This probe drives §2.1's session, which pins
`CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1`, and both observations below were recorded under it. They do
not transfer: the fullscreen renderer owns a fixed viewport with no scrollback to strand a stale rule
in, so "the rules stay 120 wide" is not a claim about it. The scripted successor to this probe —
`harness/scripts/resize-matrix.sh` — is classic-only for the same reason and says so in its header.

```bash
tmux resize-window -t <session> -x 80 -y 24
sleep 2
tmux capture-pane -t <session> -p
tmux display -p -t <session> '#{pane_width}x#{pane_height}'   # confirm the app got SIGWINCH
```

- **claude: clean pass.** At 80×24 the assistant paragraph re-wrapped to 80 columns, the rules
  redrew at 80, and no stale content remained.
- **ccx: reflows but leaves artifacts.** Reproduced twice, including on a freshly launched session
  with no turn history. The 120-wide separator rules stay 120 wide and hard-wrap into an
  80-column line plus a 40-column remainder, and the composer block is painted **twice**:

  ```
  ────────────────────────────────────────────────────────────────────────────────
  ────────────────────────────────────────
  ❯ Try "create a util logging.py that..."
  ────────────────────────────────────────────────────────────────────────────────
  ────────────────────────────────────────
  ❯ Try "create a util logging.py that..."
  ```

  It does not self-heal on a timer. A keystroke forces a partial repaint that collapses the
  duplicate composer, but one stale wrapped rule survives above it. Resizing back to 120×40
  restores a correct frame.

  This is recorded as an observation, not a fix — it is exactly the class of defect this harness
  exists to catch.

---

## 6. Terminal-usability probe — proving the app gave the terminal back

### 6.1 Why a format variable is not enough

Most of the modes an exiting TUI must restore have tmux mirrors — mouse (§4.2), alternate screen and
cursor (§4.2a). **Two do not: termios raw mode and bracketed paste (DECSET 2004).** tmux tracks
neither, and they are precisely the two whose absence a user discovers ten minutes later in a shell
that is not ours — no echo, or a pasted line arriving as `200~text201~`.

The only instrument that sees them is a real interactive shell in the same pane, typed into after
the app is gone. If it echoes and executes, the terminal is usable; there is no cheaper proof.

### 6.2 The pattern

Make the pane's command a shell that runs the app and then **`exec sh`**, so the pty survives the
app and stays interactive. **Renderer: fullscreen, deliberately** — `CLAUDE_CODE_NO_FLICKER=1` below
is a choice, not boilerplate, because the alternate screen is one of the modes whose restore this
probe exists to prove. Run the classic pin as a second cell when you want both:

```bash
tmux new-session -d -s qaexit -x 120 -y 40 -c "$CCX_PROJ" \
  "sh -c 'env HOME=$CCX_HOME \
              CCX_FLEET_ROOT=$CCX_HOME/.claude/ccx \
              CLAUDE_CODE_OAUTH_TOKEN=$CLAUDE_CODE_OAUTH_TOKEN \
              TERM=xterm-256color \
              CLAUDE_CODE_NO_FLICKER=1 \
          node /Users/new/Developer/GitHub/codex_somersault/CC-to-SDK/harness/dist/cli/bin.js; exec sh'"

tmux set-option -t qaexit remain-on-exit off      # NOT on — see §6.4
wait_until qaexit '⏸ manual mode on' 30
```

**Signal the app, not the pane.** `#{pane_pid}` is the outer `sh`; the app is its child, and killing
the pane pid tells you nothing about the app's own cleanup:

```bash
APP_PID=$(pgrep -P "$(tmux display -p -t qaexit '#{pane_pid}')" | head -1)
kill -INT "$APP_PID"       # F5 — kill -TERM for F5b
sleep 1
```

Then assert the mode restore from outside, and the usability from inside:

```bash
tmux display -p -t qaexit \
  'alt=#{alternate_on} cursor=#{cursor_flag} any=#{mouse_any_flag} sgr=#{mouse_sgr_flag} all=#{mouse_all_flag}'
# expect: alt=0 cursor=1 any=0 sgr=0 all=0

tmux send-keys -t qaexit -l 'echo QA-TTY-$((6*7))'; sleep 0.3; tmux send-keys -t qaexit Enter
sleep 0.5
tmux capture-pane -t qaexit -p | grep -qF 'QA-TTY-42'   # THE assertion
```

**The needle is the computed `42`, not the literal typed.** §8.2's trap applies here too: the typed
line `echo QA-TTY-$((6*7))` is itself echoed into the frame, so a needle matching what you sent is
satisfied by the echo alone. Only `QA-TTY-42` requires that the shell also read the line and ran
it — one needle covering echo, line discipline and execution. Verified frame:

```
sh-3.2$ echo QA-TTY-$((6*7))
QA-TTY-42
```

### 6.3 The assertion has teeth — verified by sabotage

Both halves were run live on tmux 3.7b, 2026-08-12, with a stand-in app in place of ccx:

| Pane command | `#{pane_dead}` after the kill | `QA-TTY` needle |
|---|---|---|
| `sh -c 'sleep 60; exec sh'` (clean exit) | `0` | **present** |
| `sh -c 'stty raw -echo; …; sleep 60; exec sh'` (tty left in raw mode) | `0` | **absent** |

So the probe distinguishes a usable terminal from a wrecked one, and **`#{pane_dead}` alone does
not** — the wrecked pane is just as alive. Liveness is a precondition, the echo is the finding.

One more thing the echo does not prove: it lands on whichever screen is current, so a session that
leaked the alternate screen still echoes normally (measured — `alt=1` with the needle present).
Assert `alternate_on=0` separately; the two claims are independent.

### 6.4 `remain-on-exit off` — the one place §8.7's rule is inverted

Everywhere else in this file `remain-on-exit on` is what preserves the final frame and the exit code.
Here it is wrong. The `exec sh` exists so the pane never reaches the dead state; with
`remain-on-exit on`, a pane whose shell *did* die lingers and answers `capture-pane` with a frozen
frame while silently discarding `send-keys` — "the needle is absent" and "the shell is gone" become
the same observation. With it off, `tmux has-session -t qaexit` is a real liveness check and the
needle is a real usability check. Check liveness first (§8.6: `display -p` returns empty, not an
error, for a dead session).

You do give up one thing: `#{pane_dead_status}` (§2.3) never fires, because the pane outlives the
app. Capture the code inside the wrapper instead — verified live, and note `\$?` must be escaped
past the outer double quotes so it is the *wrapper's* `$?` and not the launching shell's:

```bash
tmux new-session -d -s qaexit … "sh -c '<app>; echo EXIT=\$?; exec sh'"
tmux capture-pane -t qaexit -p | grep '^EXIT='
```

**Do not assert 128+signal on ccx.** A foreground ccx REPL owns all three signals in
`src/cli/main.ts`, whose handler ends in `process.exit(0)` — so a killed foreground session prints
`EXIT=0`, not `EXIT=130`/`EXIT=143`. Only `ccx attach`, which has no host and no handler of its own,
falls to the alt-screen guard's own map (`SIGINT` 130, `SIGTERM` 143, `SIGHUP` 129). The code is
worth capturing; just read it as a recording, not as a pass/fail gate, and never as a substitute for
the echo.

### 6.5 Which cells need this

**F5** (`kill -INT` mid-turn inside the frame) and **F5b** (`kill -TERM`, the `cli/main.ts` signal
interlock) — both ask for "terminal usable after", and neither is checkable without a surviving
shell. Everything else in the spec's acceptance set is answerable from format variables and frames.
Deliver the signal **mid-turn**, as the cells say: submit a prompt and kill inside `wait_idle`'s
window, not from an idle REPL — the interesting path is the one that interrupts a live render.

The exit path they test writes mouse-off, rmcup, `\x1b[?2004l` and `\x1b[?25h` with `writeSync`
before the process dies; **the point of these two cells is to verify that from OUTSIDE the process**,
so read the mirrored modes with tmux and the two unmirrored ones with the shell — never from the
source.

---

## 7. Cleanup

```bash
tmux kill-session -t qaccx 2>/dev/null
tmux kill-session -t qacc  2>/dev/null
rm -rf "$QA_ROOT"
stat -f '%m %Sm %N' ~/.claude/ccx/prefs.json     # compare against the pre-run reading
```

Proving run: identical before and after (`1785951625  Aug 6 02:40:25 2026`); real
`~/.claude/ccx` (mtime 01:43) and `history.jsonl` (02:35) both predate the run's 03:53 start;
roster count unchanged at 114. All writes landed inside `$QA_ROOT` — including
`$CCX_HOME/.claude.json`, which is the SDK's bundled `claude` subprocess correctly inheriting the
isolated `HOME` from ccx.

---

## 8. Fragile spots

Things that needed retries or timing care. Read this before debugging a flaky QA run.

1. **Text and Enter must be separate `send-keys` calls.** `send-keys -l 'text\r'` is read as a
   paste, not a submit. Always `send-keys -l '<text>'`, then `send-keys Enter`. A ~0.3 s gap
   between them was used throughout and never failed.

2. **The completion needle must not match the echoed prompt.** Waiting for `QA-PING-OK` returned
   *immediately* — the composer echoes the user's line into the transcript, so the needle was
   already on screen before the model replied. Use `wait_idle` (absence of `esc to interrupt`)
   as the completion signal and only then assert on content.

3. **`wait_idle` must sleep before it polls.** Between submitting and the spinner appearing there
   is a window where `esc to interrupt` is absent and the turn looks finished. The helper sleeps
   1 s first.

4. **The ready-needle differs by permission mode.** `? for shortcuts` is the manual-mode footer;
   under `--dangerously-skip-permissions` the footer reads `⏵⏵ bypass permissions on (shift+tab to
   cycle)` instead, and a wait on `for shortcuts` burned its full 30 s timeout on a REPL that was
   ready in 1 s. Use `for agents`, which is in both footers.

   **For ccx use `⏸ manual mode on`.** This needle has now rotted TWICE: first `⇧Tab to cycle`
   vanished, then Wave C's footer unification removed the `⏎ send` composer hint row entirely
   (sweep #2: all six agents burned a full timeout on it — s2qa1-21, s2qa2-14). The footer now
   mirrors claude's `⏸ manual mode on · ? for shortcuts`, so the manual-mode chip is the ready
   needle on BOTH TUIs' default launches. Frames quoted elsewhere in this file are *recordings*
   from older builds — read them as history, never as needles to copy. When a needle burns its
   timeout, capture the actual frame before assuming the app is dead.

5. **claude's double-`C-c` window is short.** 0.2 s apart exits; 1.2 s apart does not (the second
   press is treated as a new first press). `C-d` on an empty composer did not exit at all.
   Prefer `/exit` for determinism.

6. **`tmux display -p -t <session>` silently returns empty for a dead session** rather than
   erroring — it printed `tty:  size: x` for a session that had gone away, which reads like a
   parse bug. Check liveness with `tmux has-session -t <s>` or
   `tmux list-panes -a -F '#{session_name} #{pane_tty}'` first.

7. **Set `remain-on-exit on` right after creating the session.** Without it the tmux session
   vanishes the instant the program exits, taking the final frame and the exit code with it. With
   it you get `#{pane_dead}` and `#{pane_dead_status}`.

8. **`claude` keys `projects` by the resolved path.** `/tmp/...` vs `/private/tmp/...` on macOS —
   use `pwd -P`. See §3.1.

9. **Shell-quoting the grep for escape bytes.** `grep -c $'\033['` fails under the `ugrep`-backed
   `grep` on this machine (`error at position 5 … mismatched [`). Use
   `LC_ALL=C grep -c $'\x1b'` and inspect with `cat -v`.

10. **One unexplained ccx session death.** The first `qaccx` session disappeared at some point
    after a resize to 80×24 and a `x`/`BSpace` keystroke pair. It was **not reproduced** — a second
    session survived the same resize, resized back, and exited cleanly via `/quit`. Recorded
    honestly as unexplained; if a QA run sees a session vanish mid-suite, this precedent exists.
    Always assert `tmux has-session` between steps rather than assuming liveness.

11. **Cold start is slow.** `claude` took several seconds to first paint on a fresh isolated HOME
    (it fetches the changelog and writes cache files). Give the ready-wait a 60 s timeout.

---

## 9. Capabilities matrix

What a QA agent **can** and **cannot** do with this harness.

### Observation

| Capability | Status | How |
|---|---|---|
| Plain text of the current frame | **YES** | `tmux capture-pane -t <s> -p` |
| Colours / styling (truecolor SGR) | **YES** | `capture-pane -e -p`; verified `\033[38;2;80;80;80m` etc. present with `-e`, and zero escapes without it |
| Bold / underline / reverse attributes | **YES** | same `-e` capture; they are SGR params in the same stream |
| Scrollback above the viewport | **YES** | `capture-pane -p -S -1000` (viewport-only by default) |
| Pane dimensions | **YES** | `tmux display -p '#{pane_width}x#{pane_height}'` |
| Whether the app enabled mouse reporting | **YES** | `#{mouse_any_flag}` / `#{mouse_sgr_flag}` / `#{mouse_all_flag}` — the single most useful non-obvious probe here |
| Alternate-screen state | **YES** | `#{alternate_on}` — startup-only for both TUIs; see §4.2a |
| Terminal title the app set | **YES** | `#{pane_title}` (claude sets it to the turn summary, e.g. `_ QA ping verification`) |
| Process exit code | **YES** | `remain-on-exit on` + `#{pane_dead_status}` (lost under §6's `exec sh` — capture it in the wrapper) |
| Cursor position | **YES** | `#{cursor_x}` / `#{cursor_y}` |
| Cursor visibility (DECSET 25) | **YES** | `#{cursor_flag}` — half of the post-exit restore assertion (§4.2a) |
| Termios raw mode / bracketed paste after exit | **YES, indirectly** | no format variable exists for either; prove it with §6's surviving shell and a typed-echo needle |
| True pixel-level hover / rendered glyphs | **NO** | tmux is a character grid. No pixel raster, no font rendering, no images. |
| Sixel / iTerm2 inline images | **NO** | not representable in `capture-pane` output |
| Frame-by-frame animation timing | **PARTIAL** | you can poll `capture-pane` in a loop, but you get samples, not a guaranteed-complete frame sequence; a spinner tick can be missed between polls |

### Injection

| Capability | Status | How |
|---|---|---|
| Literal text | **YES** | `send-keys -t <s> -l '<text>'` |
| Enter / Escape / Backspace / Tab | **YES** | `send-keys -t <s> Enter` \| `Escape` \| `BSpace` \| `Tab` |
| Control keys | **YES** | `send-keys -t <s> C-o` / `C-c` / `C-d` |
| Arrow keys (dialog navigation) | **YES** | `send-keys -t <s> Down` then `Enter` — used to answer the trust and bypass dialogs |
| Shift+Tab (mode cycling) | **YES** | `send-keys -t <s> BTab` |
| Arbitrary raw bytes | **YES** | `send-keys -t <s> -H <hex> <hex> …` — the general escape hatch |
| SGR mouse events | **YES (delivered)** | `send-keys -H` with `ESC [ < b ; col ; row M/m`; delivery proven. **No effect on `claude`/`ccx`-classic** (neither enables mouse reporting), but **live effect on `ccx`'s fullscreen renderer since F9 T-MOUSE** — a motion sweep un-dims/backgrounds a hovered transcript row, a press-drag-release sweep paints `selectionBg` and auto-copies (native clipboard + OSC 52, tmux-DCS-wrapped under `$TMUX`), and click/double/triple-click position the caret or select word/line — all confirmed via this exact byte-injection method, task-8 report has the captures |
| X10 mouse events | **YES (delivered)** | `send-keys -H 1b 5b 4d …`; same — delivered, swallowed cleanly |
| Mouse events via pane tty write | **NO** | wrong pty direction; see §4.3 Method A |
| Mouse events via `send-keys -M` | **NO** | only valid inside a tmux key binding with a live mouse event in context; not scriptable |
| Bracketed paste | **YES** | wrap with `-H 1b 5b 32 30 30 7e` … `1b 5b 32 30 31 7e` (not exercised in this run) |
| Window resize / SIGWINCH | **YES** | `tmux resize-window -t <s> -x W -y H` |
| Real clicks | **YES, on `ccx`'s fullscreen renderer since F9 T-MOUSE** | `claude`/`ccx`-classic still have nothing to click (§4.2 — the proving run below was against `ccx`-classic); fullscreen `ccx` hovers, drags-to-select, double/triple-clicks and copies, and positions the composer caret — see the SGR mouse events row above |

### Net

The harness gives a QA agent **everything a keyboard user has, plus colour and exit-code
introspection a human does not**. The one axis genuinely out of reach is pixel-level rendering —
and the mouse axis turns out to be moot rather than blocked: both TUIs are keyboard-only by
design, and both parse and discard injected mouse bytes without leaking them into the composer.

---

## 10. Recommendations for the QA fleet design

1. **Make isolation structural, not procedural.** Every finding here depended on a five-line
   preamble (isolated `HOME`, `CCX_FLEET_ROOT`, scratch project, resolved-path seed) that is easy
   to forget once — and forgetting it once already caused a real incident. Ship a
   `qa-session-open <ccx|claude> [flags]` helper that mints the sandbox, writes the onboarding
   seed, launches under tmux with `remain-on-exit on`, waits for the correct per-target ready
   needle, and returns a session handle. Agents should never hand-assemble a launch line. Pair it
   with a `qa-session-close` that kills the session, removes `$QA_ROOT`, and **asserts** the real
   `~/.claude/ccx/prefs.json` mtime is unchanged — turning the isolation guarantee into a test
   that fails loudly rather than a rule someone remembers.

2. **Assert on frame *transitions*, not on single frames.** The two sharpest traps in this run
   were both single-frame illusions: the completion needle that was already satisfied by the
   echoed prompt, and the ready-needle that was correct for one permission mode and silently
   wrong for the other. Both vanish if the harness's primitive is a state machine —
   `wait_ready → send → wait_busy → wait_idle → assert` — where each edge has its own needle and a
   missing *busy* edge is itself a failure. A QA case that asserts only on the final frame will
   pass against a TUI that never ran the turn at all.

3. **Spend the fleet's budget on resize, reflow, and repaint — that is where the parity gap
   actually is.** The single real defect this session surfaced was ccx's resize artifacting
   (stale 120-wide rules, a doubled composer block, no self-heal), reproduced on a clean session
   while claude passed the identical probe. Meanwhile the mouse axis — the one the sprint was
   framed around — turned out to be a non-axis: neither TUI enables mouse reporting, so there is
   no interaction to compare. Redirect that effort into a matrix of widths (80/100/120/160) ×
   heights (24/40) × content states (empty, mid-turn, folded tool row, expanded), driven purely
   by `resize-window` + `capture-pane`. It is cheap, fully deterministic, needs no model tokens
   after the content is staged, and it is demonstrably where the clone diverges.
