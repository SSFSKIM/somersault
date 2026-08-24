# ptc-surface

The PTC kernel itself has moved: it now lives and is developed at
**https://github.com/SSFSKIM/ptc-tool** (which is also its Claude Code plugin
marketplace — `/plugin marketplace add SSFSKIM/ptc-tool`), together with its living
spec and execution plan under `docs/doperpowers/`. The pre-split history (150
monorepo commits, the 16-round review campaign) remains in this repo's log under
`ptc-surface/ptc/`.

What stays here is the research context the work grew out of:

- `Conversation.md` — the original RLM/PTC conversation that seeded the project
- `prime-agent/` — Prime Intellect's Prime Agent, vendored as a doctrine reference
  (read-only; never built)
