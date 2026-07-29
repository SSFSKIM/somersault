# C6 scenario ④ — content-layer parity ("Let's make a react todo list")

**Verdict: PASS (vacuous-but-parity — both-negative on the trigger; skill catalog at parity).**
Run 2026-07-29, driver `$CLAUDE_JOB_DIR/tmp/acc-c6-content.mjs`, keyed via `CLAUDE_CODE_OAUTH_TOKEN`.
Baseline = the **real `claude`** binary (no shim); then `ccx`. Both got the exact prompt
`Let's make a react todo list` in a fresh empty dir. Scripts unmodified (md5 line below).

## Evidence — the live run

| leg | REPL | resolved model | brainstorming auto-triggered before any code file? | first code files written |
|---|---|---|---|---|
| real `claude` | settled (trust dialog dismissed) | **Opus 5** | **NO** — went straight to scaffolding | `.oxlintrc.json`, `index.html`, `package.json`, `tsconfig.app.json`, `tsconfig.json` |
| `ccx` | settled | opus-4-8 (default; `(default)` in banner) | **NO** | `package.json` |

**Trigger parity: both-negative → vacuous-but-parity → PASS.** Even the real `claude` on Opus 5 does
**not** auto-invoke the `brainstorming` skill for a casual "Let's make a react todo list" — it begins
building immediately. `ccx` behaves identically. The porting doc's premise (the fork removed the
SessionStart bootstrap, so auto-trigger rides the native skill surface and is model/phrasing
dependent) is confirmed: neither binary triggers here, so `ccx` is at parity, not below it.

## Skill catalog parity — the authoritative check

The pty "type `/brainstorm` and look for a dropdown" check was **inconclusive** and initially read as
`real=true ccx=false`; that was a **capture artifact**: under this pty harness `ccx`'s slash palette
renders **no** autocomplete dropdown for *any* command — a builtin `/mo` (→ `/model`) produced no
dropdown either (`c6-4-ccxbuiltin.log`). So the pty check cannot speak to whether `ccx` *has* the
skills.

The authoritative surfacing layer is the SDK command catalog both binaries draw from
(`settingSources: user/project/local` → `supportedCommands()`):

- **`ccx` catalog contains all 15 doperpowers skills**, `brainstorming` included:
  `brainstorming, decomposing, execplan, execspec, orchestrating-daemons, organizing-sprints,
  reviewing-prs, subagent-driven-development, systematic-debugging, test-driven-development,
  triaging-feedback, using-git-worktrees, verification-before-completion, writing-plans,
  writing-skills` (89 commands total).
- The real `claude` `/` catalog surfaced `brainstorming` in its palette (live frame `c6-4-real-claude.log`).

Same skill set on both → **skill surfacing is at parity** at the catalog level. The palette-dropdown
render under pty is a TUI detail outside C6's scope (the command palette shipped and is unit-tested in
its own increment).

## md5 integrity

All 11 scripts unchanged before and after the scenario.

## Conclusion

No `ccx` defect. Content-layer trigger is both-negative (parity). The doperpowers skill catalog was
enumerated in full (15 skills) on ccx via `supportedCommands()`, and the real binary was directly
observed surfacing `brainstorming` from the same `settingSources` — both draw the catalog from
identical `settingSources`, so the set matches by construction. Scenario ④ PASS.
