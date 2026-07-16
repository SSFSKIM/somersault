# Wave 3 — production-service maturity — implementation plan

Spec: `../specs/2026-07-17-wave3-production-maturity-design.md`. All commands from `harness/`.
Per-increment loop: failing unit test → impl → `npm run typecheck` + `npm run test:unit` → gated live
test (controller runs keyed) → commit. Wave ends: refresh `docs/parity/{coverage,full-potential}.md`
+ memory + this plan's checkboxes.

## W3.1 — OpenTelemetry  ✅ when: unit green, live collector sees metrics+logs with session.id

1. `src/config/telemetry.ts` — `TelemetryConfig` type + `resolveTelemetry(config)` → env map (spec
   table). Absent config → `{}`.
2. Wire: `resolveOptions` merges telemetry env into the provider-env object before the
   `{...process.env, ...env}` spread; `HarnessConfig.telemetry` field; daemon `DaemonConfig.telemetry`
   → `makeSession`'s resolveOptions call.
3. `test/unit/telemetry.test.ts` — mapping/defaults/absence/no-clobber (provider env keys survive).
4. `test/live/otel.live.test.ts` — probe-51-shaped collector on 127.0.0.1:0; 1-turn session; assert
   metrics + logs arrived, `session.id` attr present; skip keyless.
5. Docs `docs/guides/observability-otel.md` + `examples/otel/{docker-compose.yml,collector.yaml,README.md}`.

## W3.3 — session-store adapter  ✅ when: conformance ×2 green, mirror_error surfaced, live resume green

1. `src/store/redisSessionStore.ts` — `RedisLike` + `createRedisSessionStore` (spec layout; SADD
   uuid-gate; per-key promise-chain around fold+write).
2. `src/store/conformance.ts` — `sessionStoreConformance(name, makeStore)`.
3. `test/unit/sessionStore.test.ts` — conformance(InMemorySessionStore) + conformance(redis over fake
   client) + fold-lock race test (parallel appends → summaries consistent).
4. Session `mirrorErrors` ring + daemon list count; `sessionStoreFlush`/`sessionStoreCallTimeoutMs`
   knobs in HarnessConfig→resolveOptions; unit for each.
5. `test/live/session-store.live.test.ts` — InMemory persist→resume recall; real-Redis conformance
   describe gated on `REDIS_URL`.
6. Export `createRedisSessionStore` + `sessionStoreConformance` from `index.ts` (pin in index test).

## W3.5 — MCP topology  ✅ when: unit green, live 52b-shape through Session green

1. Session methods (`setMcpServers`/`toggleMcpServer`/`reconnectMcpServer`/`mcpServerStatus`/
   `setMcpPermissionModeOverride`) — thin callQ wrappers, jsdoc = probed semantics.
2. Daemon ops + client methods (`mcp_status`/`mcp_set_servers`/`mcp_toggle`/`mcp_reconnect`/
   `mcp_mode_override`); SDK-type config rejected daemon-side.
3. tui: `/mcp` command (status; reconnect/toggle subcommands).
4. `test/unit/mcpTopology.test.ts` (fake query control methods; daemon rejection) +
   `test/live/mcp-topology.live.test.ts` (stdio add→call→reconnect→remove).

## W3.2 — warm pool  ✅ when: unit green, live warm<cold green

1. `src/warm/pool.ts` — spec API (`take`/`queryFn`/`stats`/`close`, delegating canUseTool holder,
   async refill).
2. Daemon `warmPool: {size}` — supervisor-held pool; `makeSession` warm-path when spawn cfg matches
   (model/permissionMode defaults, no resume); registry `warm` flag.
3. `test/unit/warmPool.test.ts` — fake startup DI; take/refill/close/binding-delegation/mismatch-cold;
   teardown-liveness (close with outstanding takes; take-after-close).
4. `test/live/warm-pool.live.test.ts` — warm vs cold init ms + both answer.

## W3.4 — tenant preset  ✅ when: unit green, live deny-isolation green

1. `src/config/tenantPreset.ts` — `tenantHarnessConfig(tenant, base?)` (spec composition).
2. `test/unit/tenantPreset.test.ts` — invariants + base-not-mutated + credentials composed.
3. `test/live/tenant.live.test.ts` — probe-48-shaped env+file deny.
4. Docs `docs/guides/secure-deployment.md`.
5. Export from `index.ts`.

## Close-out — ✅ ALL INCREMENTS SHIPPED 2026-07-17

- [x] W3.1 OTel (59a5b2e3d8; live 4.9s) · W3.3 store (4197c78e87; live 13.3s) · W3.5 topology
      (1f13851d20; live 25.1s) · W3.2 warm pool (9ae1f3cd40; live green) · W3.4 tenant (5921b3e09b; live 18.6s)
- [x] coverage.md domains (2/3/5/6 + §3 counts + docs-envelope + frontier) + full-potential.md rows/§2 (~78%)/§3
- [x] memory: wave3 file + MEMORY.md line + roadmap memory W3 line
- [x] commits per increment on main (not pushed — no push without request)
