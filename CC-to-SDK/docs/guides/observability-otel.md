# Observability: OpenTelemetry export (W3.1)

The Claude Code CLI that the Agent SDK spawns has a built-in, env-gated OpenTelemetry exporter.
`cc-harness` exposes it as the typed `telemetry` config on `HarnessConfig` (and daemon-wide via
`DaemonOptions.telemetry`) — every session's subprocess then exports OTLP **metrics + log events**
directly to your collector. No harness-side OTel dependency; the CLI is the emitter.

Verified live (probe `probes/probes/51-otel-headless.ts`, SDK 0.3.211 / CLI 2.1.211): export works
headlessly, flushes during the session and around subprocess exit, and `http/json` + `http/protobuf`
both work. **No traces are emitted** — the surface is metrics + events.

## Quick start

```ts
import { openSession } from "cc-harness";

const s = openSession({
  telemetry: {
    endpoint: "http://localhost:4318",     // your OTLP/HTTP collector
    resourceAttributes: { "service.namespace": "my-app", "tenant.id": "t1" },
  },
});
```

Daemon-wide:

```ts
new DaemonSupervisor(deps, { telemetry: { endpoint: "http://otel-collector:4318" } });
```

Try it against a local collector: `examples/otel/` has a one-command docker-compose demo.

## Config → env mapping

`TelemetryConfig` maps to the CLI's env gates (a user `env` override on the config always wins):

| field | env var | default |
| --- | --- | --- |
| *(presence)* | `CLAUDE_CODE_ENABLE_TELEMETRY=1` | off when absent |
| `endpoint` | `OTEL_EXPORTER_OTLP_ENDPOINT` | required |
| `protocol` | `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/protobuf` |
| `metrics` | `OTEL_METRICS_EXPORTER` = `otlp`/`none` | `true` |
| `logs` | `OTEL_LOGS_EXPORTER` = `otlp`/`none` | `true` |
| `headers` | `OTEL_EXPORTER_OTLP_HEADERS` (k=v,csv) | — |
| `metricIntervalMs` / `logsIntervalMs` | `OTEL_{METRIC,LOGS}_EXPORT_INTERVAL` | CLI defaults |
| `includeSessionId` | `OTEL_METRICS_INCLUDE_SESSION_ID` | CLI default on |
| `logUserPrompts` | `OTEL_LOG_USER_PROMPTS=1` | **off** (privacy) |
| `resourceAttributes` | `OTEL_RESOURCE_ATTRIBUTES` (k=v,csv) | — |

For rotating auth headers the CLI also supports `CLAUDE_CODE_OTEL_HEADERS_HELPER` (path to a script
that prints headers) — pass it through the config `env` escape hatch if you need it.

## What arrives (probe-51 catalog)

**Metrics** (`claude_code.` namespace): `session.count`, `cost.usage`, `token.usage`,
`active_time.total`.

**Log events**: `user_prompt`, `api_request`, `assistant_response`, `tool_decision`, `tool_result`,
`hook_registered`.

**Attributes**: `session.id`, `prompt.id`, `user.id`, `user.email`, `user.account_uuid`, `model`,
`terminal.type`, plus your `resourceAttributes`. `prompt.id` is the join key the SDK also stamps on
hook payloads — hook-side data and OTel events correlate at prompt grain.

## Cardinality, privacy, tenancy

- `session.id` on metric datapoints is high-cardinality; set `includeSessionId: false` for
  Prometheus-style backends and keep session grain in the log events instead.
- `logUserPrompts` defaults off: `user_prompt` events then carry `prompt_length` but not content.
  Treat the exported stream as sensitive regardless — it includes user ids/emails.
- Multi-tenant: stamp `tenant.id` via `resourceAttributes` per session/daemon; pair with the
  secure-deployment recipe (`docs/guides/secure-deployment.md`).
