// OpenTelemetry env-gate mapping (W3.1, probe 51): the SDK-spawned CLI exports OTLP metrics + log
// events headlessly when env-gated — no SDK Option exists for this, it is env-only. Observed live:
// metrics claude_code.{session.count,cost.usage,token.usage,active_time.total}; log events
// user_prompt/api_request/assistant_response/tool_decision/tool_result/hook_registered; attributes
// include session.id + prompt.id (prompt.id joins hook output to OTel events per sdk.d.ts) and
// user.id/email/account_uuid. NO traces are emitted (metrics + events only). Exports flush during
// the session and around subprocess exit, so short-lived headless runs still deliver.

export interface TelemetryConfig {
  /** OTLP endpoint, e.g. "http://collector:4318". */
  endpoint: string;
  /** OTLP wire protocol. Default "http/protobuf" (the OTLP default; probe 51 verified http/json too). */
  protocol?: "http/protobuf" | "http/json" | "grpc";
  /** Export metrics (claude_code.*). Default true. */
  metrics?: boolean;
  /** Export log events (user_prompt, tool_decision, …). Default true. */
  logs?: boolean;
  /** Exporter headers (e.g. auth) — joined as the standard comma-separated k=v list. */
  headers?: Record<string, string>;
  metricIntervalMs?: number;
  logsIntervalMs?: number;
  /** Stamp session.id on metric datapoints (CLI default is on; set false for low-cardinality backends). */
  includeSessionId?: boolean;
  /** Include prompt CONTENT on user_prompt events. Privacy-sensitive — default off (length-only). */
  logUserPrompts?: boolean;
  /** OTEL_RESOURCE_ATTRIBUTES (k=v,csv) — the per-tenant/per-service attribution seam. */
  resourceAttributes?: Record<string, string>;
}

const kvList = (o: Record<string, string>) => Object.entries(o).map(([k, v]) => `${k}=${v}`).join(",");

/** Map TelemetryConfig to the CLI's env gates. Undefined config → {} (telemetry stays off). */
export function resolveTelemetryEnv(t?: TelemetryConfig): Record<string, string> {
  if (!t) return {};
  const env: Record<string, string> = {
    CLAUDE_CODE_ENABLE_TELEMETRY: "1",
    OTEL_EXPORTER_OTLP_ENDPOINT: t.endpoint,
    OTEL_EXPORTER_OTLP_PROTOCOL: t.protocol ?? "http/protobuf",
    OTEL_METRICS_EXPORTER: (t.metrics ?? true) ? "otlp" : "none",
    OTEL_LOGS_EXPORTER: (t.logs ?? true) ? "otlp" : "none",
  };
  if (t.headers) env.OTEL_EXPORTER_OTLP_HEADERS = kvList(t.headers);
  if (t.metricIntervalMs !== undefined) env.OTEL_METRIC_EXPORT_INTERVAL = String(t.metricIntervalMs);
  if (t.logsIntervalMs !== undefined) env.OTEL_LOGS_EXPORT_INTERVAL = String(t.logsIntervalMs);
  if (t.includeSessionId !== undefined) env.OTEL_METRICS_INCLUDE_SESSION_ID = String(t.includeSessionId);
  if (t.logUserPrompts) env.OTEL_LOG_USER_PROMPTS = "1";
  if (t.resourceAttributes) env.OTEL_RESOURCE_ATTRIBUTES = kvList(t.resourceAttributes);
  return env;
}
