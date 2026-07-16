# Wave 3 — production-service maturity (the OTel wave) — design

**Date:** 2026-07-17 · **Status:** approved (roadmap `docs/parity/full-potential.md` §3 Wave 3; user go 2026-07-17)
**Probes:** 51 (OTel headless ✅), 52/52b (MCP topology ✅ with toggle-advisory caveat), plus Wave-2 40 (startup/WarmQuery), 48 (sandbox credentials), 50 (spawnClaudeCodeProcess) and the session-store probes (InMemorySessionStore persist→resume).

## Goal

Close the "run it in production" two-thirds of the remaining envelope gap: observability, first-turn
latency, cross-host persistence, tenant isolation, and runtime MCP control — five independent
increments, each unit-tested + gated-live-tested, ending with `coverage.md`/`full-potential.md` refresh.

## Probe evidence (what constrains the design)

- **51 — OTel is ALIVE headless**: env-gated (`CLAUDE_CODE_ENABLE_TELEMETRY=1` + `OTEL_*`) OTLP export
  works from the SDK-spawned CLI. Metrics: `claude_code.{session.count,cost.usage,token.usage,active_time.total}`.
  Log events: `user_prompt,api_request,assistant_response,tool_decision,tool_result,hook_registered`.
  Attributes include `session.id`, `prompt.id` (joins hook output per sdk.d.ts), `user.id/email/account_uuid`,
  `model`. **No traces** (matches docs: metrics+events only). Exports flush during the session and around
  exit (1s intervals honored; post-exit flush observed). `http/json` protocol works against a bare HTTP server.
- **52/52b — MCP topology trio semantics split by server type**:
  - `setMcpServers()` add/remove work for BOTH SDK-type and stdio servers ({added/removed/errors},
    status pending→connected, tools immediately ToolSearch-reachable). `setMcpServers({})` removes
    dynamics (plugin-owned exempt per sdk.d.ts).
  - `reconnectMcpServer()` works for stdio (pid change proven); THROWS `"SDK servers should be handled
    in print.ts"` for SDK-type.
  - `toggleMcpServer(false)` is **advisory**: status flips to `disabled` and the child dies, but a model
    tool call **resurrects the server on demand** (fresh pid while "disabled"). toggle(true) works for
    stdio, throws for SDK-type. → Not a security boundary; the permission layer stays the gate.
  - `mcpServerStatus()` observes throughout; after SDK-type removal a `failed` row lingers (quirk).
- **40 — `startup({options})` freezes the full Options at warm time**; `WarmQuery.query(prompt)` is
  once-per-handle; unused `close()` is clean. Parent-side callbacks (canUseTool/hooks) are part of the
  frozen Options → a pool must warm with **delegating callbacks** to serve per-session brokers.
- **SessionStore (sdk.d.ts:4671)**: append-after-local-write mirror (~100ms batches), `uuid` as
  idempotency key, `load` deep-equal (not byte-equal), optional `listSessions`/`listSessionSummaries`
  (fold via `foldSessionSummary`, store must serialize sidecar writes), optional `delete`/`listSubkeys`;
  failure after 3 retries → batch dropped + `system/mirror_error` message. `sessionStoreFlush`
  ('batched' default) + `sessionStoreCallTimeoutMs` knobs. `config.sessionStore` already passes through
  `resolveOptions` (line 67).

## Increments

### W3.1 — OpenTelemetry (flagship)

- **`src/config/telemetry.ts`**: `resolveTelemetry(config): Record<string,string>` mapping a typed
  `TelemetryConfig` to the env gates:
  `{ endpoint, protocol? ('http/protobuf' default), metrics?/logs? (default true), headers?,
  metricIntervalMs?, logsIntervalMs?, includeSessionId?, logUserPrompts?, resourceAttributes? }`
  → `CLAUDE_CODE_ENABLE_TELEMETRY=1`, `OTEL_{METRICS,LOGS}_EXPORTER=otlp`,
  `OTEL_EXPORTER_OTLP_{ENDPOINT,PROTOCOL,HEADERS}`, `OTEL_{METRIC,LOGS}_EXPORT_INTERVAL`,
  `OTEL_METRICS_INCLUDE_SESSION_ID`, `OTEL_LOG_USER_PROMPTS`, `OTEL_RESOURCE_ATTRIBUTES` (k=v,csv).
- Wire into `resolveOptions` env assembly (merge after provider env; the existing
  spread-process.env-first rule keeps auth intact). Daemon: `DaemonConfig.telemetry` flows into
  `makeSession`'s `resolveOptions` call → every daemon session exports.
- **Docs** `docs/guides/observability-otel.md`: env map, metric/event catalog (probe-51-grounded),
  privacy defaults (`logUserPrompts` OFF; note the `prompt` attribute observation for verification),
  per-tenant `resourceAttributes`. **Demo** `examples/otel/docker-compose.yml`: otel-collector
  (OTLP HTTP in → debug/logging exporter) + README run script.
- **Tests**: unit — env mapping, defaults, no-clobber of provider env, absent-when-unconfigured.
  Live (gated) — probe-51-shaped mini collector; assert ≥1 metrics + ≥1 logs export and `session.id` attr.

### W3.2 — Warm-spawn pool

- **`src/warm/pool.ts`**: `createWarmPool(config: HarnessConfig, opts: {size?: 1..N, deps?: {startup}})`.
  Maintains `size` pre-warmed `startup({options: resolveOptions(poolConfig)})` handles; async refill on
  take; `close()` discards all. The pool's options embed **delegating callbacks**: `canUseTool` (and
  any hook slots the daemon needs) forward to a per-slot holder assigned at checkout.
  - `pool.take(bindings?: {canUseTool?}): WarmQueryHandle | null` — null on empty (caller cold-spawns).
  - `pool.queryFn(bindings?): QueryFn` — the Session-compatible seam: `({prompt}) => warm.query(prompt)`.
  - `pool.stats(): {warm, taken, misses}`.
- **Daemon**: `DaemonConfig.warmPool?: {size}` — supervisor keeps one pool warmed with the daemon's
  default spawn config; `makeSession` consumes a slot **only when** the spawn cfg matches the pool
  config on the warm-relevant axes (model, permissionMode, no resume, no per-spawn overrides) — else
  cold path unchanged. Registry rows gain `warm: boolean`.
- **Constraint honored**: `resume` is baked into Options → warm slots serve **new** sessions only.
- **Tests**: unit — fake `startup` DI: take/refill/close, bindings delegation (slot broker called, not
  pool's), mismatch falls back cold, once-per-handle respected. Live (gated) — warm vs cold init
  latency (assert warm < cold and both sessions answer).

### W3.3 — External session-store reference adapter

- **`src/store/redisSessionStore.ts`**: `createRedisSessionStore(client: RedisLike, {prefix?})` —
  dependency-free DI over a minimal `RedisLike` (`rpush,lrange,hset,hgetall,hdel,del,sadd,smembers,exists`);
  any ioredis/node-redis-compatible client satisfies it.
  Layout under `{prefix}:`: transcript list per `{projectKey}:{sessionId}[:subpath]`, per-key uuid SET
  (SADD-gate = idempotent append), sessions hash (`sessionId→mtime`) per projectKey, summaries hash
  maintained via `foldSessionSummary` inside `append()` (per-key in-process promise-chain lock;
  cross-process races documented as the adapter's caveat per the SDK contract), subkeys SET.
  `delete` implemented (removes list+uuid set+index rows). `load` returns null iff never written.
- **`src/store/conformance.ts`**: exported `sessionStoreConformance(name, makeStore)` vitest suite —
  the contract checks (append order, load deep-equal + null-for-never-written, uuid idempotency replay,
  listSessions mtimes, summaries fold, delete, subkeys). Run against SDK `InMemorySessionStore` AND the
  Redis adapter (in-memory fake client). Gated integration: real Redis when `REDIS_URL` is set.
- **`mirror_error` surfacing**: Session readLoop captures `system/mirror_error` → `session.mirrorErrors`
  (bounded ring) ; daemon `list` rows carry `mirrorErrors` count.
- **Config knobs**: `sessionStoreFlush`, `sessionStoreCallTimeoutMs` → HarnessConfig + resolveOptions.
- **Tests**: conformance ×2 (unit), mirror_error unit (fake query emits the frame), live (gated) —
  InMemorySessionStore persist→resume through lib Session (turn 1 → resume with store → recall check).

### W3.4 — Secure-deployment recipe (`tenantHarnessConfig`)

- **`src/config/tenantPreset.ts`**: `tenantHarnessConfig(tenant, base?): HarnessConfig` composing the
  probe-verified isolation set: `settingSources: []`, per-tenant `cwd` + `CLAUDE_CONFIG_DIR` env
  (ephemeral transcript root), sandbox enabled + `credentials` deny lists (probe 48), optional
  `baseUrl` credential-proxy env (via provider config), `persistSession`/`sessionStore` passthrough,
  optional `spawnClaudeCodeProcess` (probe 50) via `extraOptions` for container placement, per-tenant
  OTel `resourceAttributes` (tenant.id) when telemetry is on. Explicit **non-goals documented**: MCP
  toggle is not a gate (52b), mask-mode credentials needs an egress proxy (untested residual).
- **Docs** `docs/guides/secure-deployment.md`: the multi-tenant recipe end-to-end (isolation axes →
  config → what each probe proved → residuals).
- **Tests**: unit — composition invariants (no settings sources, config-dir env present, sandbox deny
  composed, base config not mutated). Live (gated) — probe-48-shaped: tenant session cannot read a
  planted env var + file under deny.

### W3.5 — Runtime MCP topology

- **Session methods** (thin `callQ` wrappers + jsdoc carrying the 52/52b semantics):
  `setMcpServers(servers)`, `toggleMcpServer(name, enabled)` (advisory — documented),
  `reconnectMcpServer(name)`, `mcpServerStatus()`, `setMcpPermissionModeOverride(name, mode)` (probe 49:
  rules-layer only — documented).
- **Daemon ops**: `mcp_status`, `mcp_set_servers` (JSON-safe configs only — stdio/sse/http; SDK-type
  rejected daemon-side with a clear error), `mcp_toggle`, `mcp_reconnect`, `mcp_mode_override` +
  `DaemonClient` methods.
- **Console**: minimal `/mcp` in the chat REPL (status list; `/mcp reconnect <name>`, `/mcp toggle <name>`)
  — thin, reusing the existing slash-command dispatch; richer UI stays a non-goal.
- **Tests**: unit — DI fake query with the control methods (incl. SDK-type daemon rejection). Live
  (gated) — 52b-shaped through the Session API (add stdio → call → reconnect pid change → remove).

## Order & risk

W3.1 → W3.3 → W3.5 → W3.2 → W3.4 (flagship first; docs-heavy recipe last so it absorbs the others).
Riskiest seams: pool callback delegation (new pattern) and store fold-locking (concurrency) — both get
teardown-liveness-style unit coverage before review (the [[teardown-liveness-review-pattern]] lesson).
