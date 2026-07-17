# Wave 4 — knob completion + drift watch — implementation plan

Spec: `../specs/2026-07-17-wave4-knob-completion-design.md`. Commands from `harness/`.
Loop per increment: failing unit → impl → `npm run typecheck` + `npm run test:unit` → gated live →
commit. Wave ends: parity docs + memory + checkboxes.

## W4.1 — knob sweep  ✅ when: unit green (each knob maps + absent-by-default), live knobs test green

1. `src/config/types.ts` — the ~24 new fields (spec groups), typed off SDK imports where available
   (`SdkBeta`, `ToolConfig`, `OnElicitation`, `OnUserDialog`); jsdoc caveats on 🚫/🟡 knobs.
2. `src/config/resolveOptions.ts` — one-line wires; `continueSession` → `continue`; order-stable.
3. `test/unit/knobs.test.ts` — table-driven: each field maps to the right Options key; none set →
   none present; extraOptions still wins.
4. `test/live/knobs.live.test.ts` — one session: sessionId+title+agent honored (probe-53 shape).

## W4.2 — annotations + runStructured  ✅ when: unit green, structured live green

1. Annotate tools in `src/tasks/server.ts`, `src/swarm/server.ts`, `src/context/server.ts`,
   `src/compaction/server.ts`, `src/kairos/brief.ts` (extras arg: title/readOnlyHint/searchHint).
2. `src/structured/run.ts` — `runStructured` + `StructuredRunError`; export from index.ts (pin).
3. `test/unit/structured.test.ts` — fake QueryFn: success parse, wrong-shape → zod error,
   error-subtype → StructuredRunError; annotations present on server defs.
4. `test/live/structured.live.test.ts` — tiny schema round-trip on sonnet.

## W4.3 — drift ritual  ✅ when: script runs clean against npm HEAD, doc written, first run recorded

1. `scripts/drift-check.mjs` — name-level diff (Options/Query/message tags/exports), `--json`.
2. `docs/parity/drift-ritual.md` — procedure + first-run findings.
3. Run once; record.

## Close-out

- [ ] probes 53/53b/54 committed with spec+plan
- [ ] W4.1 knob sweep (commit + live timing)
- [ ] W4.2 annotations + runStructured (commit + live timing)
- [ ] W4.3 drift script + doc + first run (commit + findings)
- [ ] parity docs refresh + memory
