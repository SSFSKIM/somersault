# Model-Switch Governance — implementation plan

Spec: `../specs/2026-08-30-model-switch-governance-design.md`. Branch `engine-core`. TDD per task;
gates after each: `npm run typecheck`, targeted vitest; full `test:unit` before the closing commit.

1. **`src/hooks/modelSwitch.ts`** — `ModelSwitchPolicy` + `buildModelSwitchHooks(policy): HooksMap`
   (PreModelSwitch guard with deny-wins composition + reason prefix; PostModelSwitch annotate; the
   onSwitch tap on both, throw-swallowed). Re-export the two SDK input types via `hooks/types.ts`.
   Unit file `test/unit/model-switch-policy.test.ts` first, red → green.
2. **Config wire** — `modelSwitchPolicy` on `HarnessConfig` (types.ts, near `hooks`); `resolveOptions`
   merges `mergeHooks(config.hooks ?? {}, buildModelSwitchHooks(policy))` when set (user fragment
   first). Merge tests beside the builder tests.
3. **Public surface** — export `buildModelSwitchHooks` + `ModelSwitchPolicy` from `src/hooks/index.ts`
   and the package barrel; update the `test/unit/index.test.ts` surface pin.
4. **Live test** — `test/live/model-switch-policy.test.ts` (2 cases per spec; keyed, skips keyless).
5. **Close-out** — full-potential §1 row → SHIPPED note; coverage.md shipped-list entry; commit.
