import { describe, it, expect } from "vitest";
import { tenantHarnessConfig } from "../../src/config/tenantPreset.js";
import { resolveOptions } from "../../src/config/resolveOptions.js";
import type { HarnessConfig } from "../../src/config/types.js";

const T = { id: "acme", workDir: "/srv/tenants/acme" };

describe("tenantHarnessConfig (W3.4)", () => {
  it("composes the isolation invariants", () => {
    const cfg = tenantHarnessConfig({ ...T, secrets: { envVars: ["OPENAI_API_KEY"], files: ["/srv/shared/creds.json"] }, baseUrl: "https://proxy.internal" });
    expect(cfg.settingSources).toEqual([]);
    expect(cfg.cwd).toBe("/srv/tenants/acme");
    expect(cfg.env?.CLAUDE_CONFIG_DIR).toBe("/srv/tenants/acme/.claude-config");
    expect(cfg.baseUrl).toBe("https://proxy.internal");
    const sb = cfg.sandbox as Record<string, unknown>;
    expect(sb.enabled).toBe(true);
    expect(sb.credentials).toEqual({
      envVars: [{ name: "OPENAI_API_KEY", mode: "deny" }],
      files: [{ path: "/srv/shared/creds.json", mode: "deny" }],
    });
  });

  it("resolves through resolveOptions: proxy env + config-dir env + sandbox land in SDK options", () => {
    const o = resolveOptions(tenantHarnessConfig({ ...T, baseUrl: "https://proxy.internal" })) as any;
    expect(o.settingSources).toEqual([]);
    expect(o.env.CLAUDE_CONFIG_DIR).toBe("/srv/tenants/acme/.claude-config");
    expect(o.env.ANTHROPIC_BASE_URL).toBe("https://proxy.internal");
    expect(o.sandbox.enabled).toBe(true);
    expect(o.cwd).toBe("/srv/tenants/acme");
  });

  it("base config supplies the rest, isolation keys win, base is never mutated", () => {
    const base: HarnessConfig = {
      model: "claude-sonnet-4-6",
      settingSources: ["user", "project", "local"],           // must be overridden
      env: { MY_FLAG: "1" },
      sandbox: { excludedCommands: ["docker"] },
      telemetry: { endpoint: "http://otel:4318", resourceAttributes: { env: "prod" } },
    };
    const snapshot = JSON.parse(JSON.stringify(base));
    const cfg = tenantHarnessConfig(T, base);
    expect(cfg.model).toBe("claude-sonnet-4-6");
    expect(cfg.settingSources).toEqual([]);
    expect(cfg.env).toMatchObject({ MY_FLAG: "1", CLAUDE_CONFIG_DIR: `${T.workDir}/.claude-config` });
    expect((cfg.sandbox as any).excludedCommands).toEqual(["docker"]);
    expect((cfg.sandbox as any).enabled).toBe(true);
    expect(cfg.telemetry).toEqual({ endpoint: "http://otel:4318", resourceAttributes: { env: "prod", "tenant.id": "acme" } });
    expect(base).toEqual(snapshot);                            // no mutation
  });

  it("a base sandbox cannot disable the tenant sandbox", () => {
    const cfg = tenantHarnessConfig(T, { sandbox: { enabled: false } });
    expect((cfg.sandbox as any).enabled).toBe(true);
  });

  it("configDir override and network settings pass through", () => {
    const cfg = tenantHarnessConfig({ ...T, configDir: "/var/cc/acme", network: { allowedDomains: ["api.acme.com"] } });
    expect(cfg.env?.CLAUDE_CONFIG_DIR).toBe("/var/cc/acme");
    expect((cfg.sandbox as any).network).toEqual({ allowedDomains: ["api.acme.com"] });
  });
});
