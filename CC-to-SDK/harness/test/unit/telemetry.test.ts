import { describe, it, expect } from "vitest";
import { resolveTelemetryEnv } from "../../src/config/telemetry.js";
import { resolveOptions } from "../../src/config/resolveOptions.js";
import { validateHarnessConfig, HarnessConfigError } from "../../src/config/validate.js";

describe("resolveTelemetryEnv (W3.1, probe 51)", () => {
  it("returns {} when unconfigured — telemetry stays off", () => {
    expect(resolveTelemetryEnv(undefined)).toEqual({});
  });

  it("maps the minimal config to the probe-verified env gates with defaults", () => {
    expect(resolveTelemetryEnv({ endpoint: "http://otel:4318" })).toEqual({
      CLAUDE_CODE_ENABLE_TELEMETRY: "1",
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://otel:4318",
      OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf",
      OTEL_METRICS_EXPORTER: "otlp",
      OTEL_LOGS_EXPORTER: "otlp",
    });
  });

  it("maps every knob", () => {
    const env = resolveTelemetryEnv({
      endpoint: "http://c:4318", protocol: "http/json", metrics: false, logs: true,
      headers: { Authorization: "Bearer x", "X-T": "y" },
      metricIntervalMs: 5000, logsIntervalMs: 2500,
      includeSessionId: false, logUserPrompts: true,
      resourceAttributes: { "tenant.id": "t1", env: "prod" },
    });
    expect(env.OTEL_EXPORTER_OTLP_PROTOCOL).toBe("http/json");
    expect(env.OTEL_METRICS_EXPORTER).toBe("none");
    expect(env.OTEL_LOGS_EXPORTER).toBe("otlp");
    expect(env.OTEL_EXPORTER_OTLP_HEADERS).toBe("Authorization=Bearer x,X-T=y");
    expect(env.OTEL_METRIC_EXPORT_INTERVAL).toBe("5000");
    expect(env.OTEL_LOGS_EXPORT_INTERVAL).toBe("2500");
    expect(env.OTEL_METRICS_INCLUDE_SESSION_ID).toBe("false");
    expect(env.OTEL_LOG_USER_PROMPTS).toBe("1");
    expect(env.OTEL_RESOURCE_ATTRIBUTES).toBe("tenant.id=t1,env=prod");
  });

  it("logUserPrompts defaults OFF (privacy) — the gate is simply absent", () => {
    expect(resolveTelemetryEnv({ endpoint: "e" })).not.toHaveProperty("OTEL_LOG_USER_PROMPTS");
  });
});

describe("telemetry wiring through resolveOptions", () => {
  it("absent telemetry adds no OTEL keys", () => {
    const o = resolveOptions({}) as { env?: Record<string, string> };
    for (const k of Object.keys(o.env ?? {})) expect(k).not.toMatch(/^OTEL_|CLAUDE_CODE_ENABLE_TELEMETRY/);
  });

  it("telemetry env lands in options.env alongside provider env (no clobber either way)", () => {
    const o = resolveOptions({ telemetry: { endpoint: "http://c:4318" }, baseUrl: "https://proxy.example" }) as { env: Record<string, string> };
    expect(o.env.CLAUDE_CODE_ENABLE_TELEMETRY).toBe("1");
    expect(o.env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe("http://c:4318");
    expect(o.env.ANTHROPIC_BASE_URL).toBe("https://proxy.example");
    expect(o.env.PATH).toBe(process.env.PATH); // process.env spread survives (SDK env REPLACES contract)
  });

  it("a user env override wins over the typed telemetry config", () => {
    const o = resolveOptions({ telemetry: { endpoint: "http://typed:4318" }, env: { OTEL_EXPORTER_OTLP_ENDPOINT: "http://user:4318" } }) as { env: Record<string, string> };
    expect(o.env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe("http://user:4318");
    expect(o.env.CLAUDE_CODE_ENABLE_TELEMETRY).toBe("1"); // rest of the typed config still applies
  });
});

describe("telemetry validation", () => {
  it("rejects an empty endpoint", () => {
    expect(() => validateHarnessConfig({ telemetry: { endpoint: "" } })).toThrow(HarnessConfigError);
  });
  it("accepts a well-formed telemetry config", () => {
    expect(() => validateHarnessConfig({ telemetry: { endpoint: "http://c:4318", logs: false } })).not.toThrow();
  });
});
