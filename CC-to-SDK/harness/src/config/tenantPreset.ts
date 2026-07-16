// W3.4 — the secure-deployment preset: compose the probe-verified isolation axes into one
// HarnessConfig for running an untrusted tenant's sessions on shared infrastructure.
//
// Axes (each individually verified):
// - settingSources: []            — no host user/project/local settings, CLAUDE.md, or skills leak in
// - per-tenant CLAUDE_CONFIG_DIR  — transcripts/config state isolated per tenant (also the seam the
//                                   sessionStore mirror pairs with for durable cross-host storage)
// - per-tenant cwd                — the tenant's working root; sandbox paths resolve against it
// - sandbox + credentials deny    — probe 48: env var unset + file read kernel-blocked in-sandbox
// - baseUrl credential proxy      — tenant traffic egresses via your proxy (ANTHROPIC_BASE_URL)
// - OTel tenant attribution       — tenant.id stamped into resourceAttributes when telemetry is on
//
// Documented NON-guarantees: MCP toggle is advisory (probe 52b — permissions are the gate);
// credential "mask" mode needs the egress proxy (untested residual); this preset isolates the
// AGENT's view, not the host OS — pair with spawnClaudeCodeProcess (probe 50) to place the
// subprocess in a container/VM for hard multi-tenancy.
import type { HarnessConfig } from "./types.js";

export interface TenantConfig {
  /** Tenant identifier — stamped into OTel resourceAttributes (tenant.id) when telemetry is on. */
  id: string;
  /** The tenant's working root (session cwd; sandbox filesystem scope). */
  workDir: string;
  /** Per-tenant CLAUDE_CONFIG_DIR. Default: `${workDir}/.claude-config`. */
  configDir?: string;
  /** Credential-proxy endpoint (ANTHROPIC_BASE_URL) — keeps the real API key out of tenant reach. */
  baseUrl?: string;
  /** Secrets to hide from sandboxed commands (probe 48 deny semantics). */
  secrets?: { envVars?: string[]; files?: string[] };
  /** SDK SandboxNetworkSettings (allowedDomains/allowLocalBinding/…). Default: no network overrides. */
  network?: Record<string, unknown>;
}

/** Build a tenant-isolated HarnessConfig. `base` supplies everything else (model, telemetry,
 *  sessionStore, …); the preset's isolation keys always win and `base` is never mutated. */
export function tenantHarnessConfig(tenant: TenantConfig, base: HarnessConfig = {}): HarnessConfig {
  const configDir = tenant.configDir ?? `${tenant.workDir}/.claude-config`;
  const baseSandbox = typeof base.sandbox === "object" ? base.sandbox : {};
  const credentials = {
    ...(tenant.secrets?.envVars?.length ? { envVars: tenant.secrets.envVars.map((name) => ({ name, mode: "deny" as const })) } : {}),
    ...(tenant.secrets?.files?.length ? { files: tenant.secrets.files.map((path) => ({ path, mode: "deny" as const })) } : {}),
  };
  return {
    ...base,
    cwd: tenant.workDir,
    settingSources: [],                                        // never inherit host settings
    env: { ...base.env, CLAUDE_CONFIG_DIR: configDir },
    ...(tenant.baseUrl ? { baseUrl: tenant.baseUrl } : {}),
    sandbox: {
      ...baseSandbox,
      enabled: true,                                           // isolation preset: sandbox is not optional
      ...(tenant.network ? { network: tenant.network } : {}),
      ...(Object.keys(credentials).length ? { credentials } : {}),
    },
    ...(base.telemetry ? { telemetry: { ...base.telemetry, resourceAttributes: { ...base.telemetry.resourceAttributes, "tenant.id": tenant.id } } } : {}),
  };
}
