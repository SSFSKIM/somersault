# Lane F — the session and information panel commands

**Lane.** F. The terminal surfaces that *show session state* or *act on the session as a whole*:
the tabbed Settings/Status dialog, the context grid, cost and usage, the Background dialog, the
Help dialog, the resume picker, the rewind message selector, the diff dialog, export, the
session-lifecycle commands (`/clear`, `/compact`, `/fork`, `/branch`, `/rename`), the
scheduling surfaces (`/loops`, `/goal`, `/workflows`), the diagnostics commands (`/doctor`,
`/release-notes`, `/bug`, `/feedback`, `/upgrade`), and the pass-through prompt commands.

**Date.** 2026-09-09. **Canon.** Claude Code 2.1.263.

## What I read

SPEC 263 chapters (`/Users/new/claude-code-bundle/2.1.263/SPEC/`):
`41-tui-rendering.md` §41.22.1–41.22.3 (the 74-entry lazy dialog registry, mount flags, failure
strings), §41.23; `28-slash-commands.md` §5 (the built-in catalogue), §5.0a, §9.3–9.5, §10,
§11, §12, §22; `35-session-persistence.md` §35.19 (the whole `/resume` picker: data flow,
grouping, filters, search, constants, pagination, row rendering, every verbatim string,
keybindings, telemetry), §35.20, §35.21 (`/export`), §35.22 (`/branch`, `/fork`);
`15-file-tools.md` §15.12.7–15.12.8 (rewind restore and entry points), §15.13.1–15.13.3
(`/diff`); `42-input-and-keybindings.md` §42.21.3 (double-Escape message selector);
`13-context-management.md` §13.18.1–13.18.3 (`/compact`, `/context`, `/autocompact`) and the
grid geometry at §13.18.2; `20-tasks-and-background-work.md` §20.14 (the `/tasks` dialog) and
§20.15.1; `49-updates-and-diagnostics.md` §49.18–49.22, §49.28 (`/status`, `/doctor`, `/debug`,
`/bug`, `/feedback`, `/upgrade`, `/wellbeing`, `/version`, `/release-notes`);
`22-scheduling-loops-and-goals.md` §22.20–22.21; `40-workflows.md` §40.17.4–40.17.5;
`08-auth-and-credentials.md` §13.1–13.1.1.

afleet: the root design spec `§7.7`, `§8.2`, `§8.4`, `§8.5`, `§7.5`; C5 §4–5; C6.2 "Edit,
rewind and Fork from here"; C6.3 "The Thread tab"; `App/Fleet/`, `App/Switcher/`,
`App/Threads/`, `App/Header/`, `App/Panels/`, `App/Composer/EditAndRewind.swift`,
`App/Decisions/TaskCardView.swift`, `App/Views/QuickSwitcherView.swift`;
`docs/tui-parity/README.md` §4 findings 8/9/10/17/20, §5 areas `A-28`, `A-20`,
`A-13/10/23`, `A-03/49/35`, `A-22/47/40`, §7; `docs/tui-parity/areas/28-slash-commands.md`,
`areas/20-tasks-background.md`, `areas/03-49-35-settings-diagnostics-sessions.md`,
`areas/15-16-17-file-bash-sandbox.md`, `areas/13-10-23-context-memory-session-tools.md`.

somersault clone: `CC-to-SDK/docs/parity/tui-ux.md` §4 and §5 rows for the resume picker, the
`/resume` preview body, the Background-dialog detail sub-dialogs, the rewind picker anatomy,
`/cost`, `/status`, `/export`, `/diff`, `/stats`, `/session`, `/rewind`; the Wave S section and
`docs/superpowers/specs/2026-08-07-wave-s-session-truth-design.md`.

## Verification spent (`cli.pretty.js` at 2.1.263)

1. `grep -n 'No code restore' cli.pretty.js` → **498276**: the message-selector row renderer,
   which confirms the per-row dry-run summary anatomy verbatim — a two-or-three-line row whose
   second line is `` `${basename(filesChanged[0])} ` `` for one file, `` `${N} files changed ` ``
   otherwise, followed by a `+A −R` stat element; `No code changes` when the dry run is clean;
   and `⚠ No code restore` when there is no checkpoint at all. The same line shows the special
   first row `/resume <id> (previous session)`.
2. `grep -n 'Show help and available commands' cli.pretty.js` → **787261**, then reading the
   `/help` chunk at **219086–219500**: SPEC 263 has **no section for the `/help` dialog**
   (chapter 41 stops at the transcript pager's help panel), so the whole card F-16 is built
   from the binary. Verified: `qp({ title: "Help", color: "professionalBlue", defaultTab:
   "general" })` at **219517** with three tabs `General` / `Commands` / `Custom commands`
   (219371, 219460, 219464); the General body at 219386–219411 (the tagline, the
   `New here? Run /powerup …` line suppressed below 44 rows, the bold `Shortcuts` heading and
   the shortcut grid); the footers at 219484–219492 (`For more help:
   https://code.claude.com/docs/en/overview` always, `Something else? Use /feedback to report
   bugs or request features.` conditionally, then `Esc to cancel` / `Press <key> again to
   exit`); dismissal message `Help dialog dismissed`; the Custom-commands empty message
   `No custom commands found`.
3. `grep -n 'defaultTab: "Status"' cli.pretty.js` → **416266**, confirming `/status` is three
   lines that open the shared four-tab `Settings` dialog rather than a status screen.

## Denominator covered

Every surface named in the lane brief, plus five I found and added: `/debug` (SPEC 49.20, a
sibling of `/doctor`), `/autocompact` (SPEC 13.18.3 — the setting behind the context meter),
`/recap` (SPEC 35, a `local` one-line session recap), the `/feedback` **draft panel and its
footer counter** (SPEC 49.22.11–49.22.14, a distinct surface from the `/bug` dialog), and the
lazy-dialog **failure strings** (SPEC 41.22.3) which are what a user sees when a panel command
cannot load. Two brief items resolve differently than the brief assumed and are carded as
such: **`/tag` is not a command in 2.1.263** — `tag` is a read-only session field with no
writer (SPEC 35.15.8, and 35 line 1069 says so explicitly) — and **`/review`, `/commit`,
`/security-review`, `/doctor` are bundled *skills*, not table commands** (SPEC 49.19,
28 §13/§20).

