# Secure deployment: the multi-tenant recipe (W3.4)

Running untrusted tenants' sessions on shared infrastructure with `cc-harness`. The composed preset
is `tenantHarnessConfig(tenant, base)`; every axis below is individually live-verified (probe number
in parentheses).

## The preset

```ts
import { tenantHarnessConfig, openSession } from "cc-harness";

const cfg = tenantHarnessConfig(
  {
    id: "acme",
    workDir: "/srv/tenants/acme",
    baseUrl: "https://llm-proxy.internal",           // tenant traffic egresses via YOUR proxy
    secrets: { envVars: ["HOST_DB_URL"], files: ["/srv/shared/creds.json"] },
    network: { allowedDomains: ["api.acme.com"] },
  },
  { model: "claude-sonnet-4-6", telemetry: { endpoint: "http://otel:4318" }, sessionStore: myStore },
);
const session = openSession(cfg);
```

## What each axis does (and proved)

| axis | mechanism | evidence |
| --- | --- | --- |
| Settings isolation | `settingSources: []` — no host user/project/local settings, CLAUDE.md, or skills reach the tenant session | long-standing, unit-pinned |
| State isolation | per-tenant `CLAUDE_CONFIG_DIR` — transcripts/config under the tenant root; pair with `sessionStore` for durable cross-host storage | store live test resumes with a FRESH config dir (W3.3) |
| Secret denial | `sandbox.credentials` deny — env var **unset** for sandboxed commands; file reads **kernel-blocked** ("Operation not permitted") | probe 48; tenant live test (W3.4) |
| Credential proxy | `baseUrl` → `ANTHROPIC_BASE_URL` — the real API key lives in your proxy, not in tenant env | provider env unit-pinned |
| Network scoping | `sandbox.network.allowedDomains` | SDK SandboxNetworkSettings (structural passthrough) |
| Attribution | `telemetry.resourceAttributes["tenant.id"]` on all metrics/events | probe 51 attrs incl. resourceAttributes |
| Model refusal layer | independent of config: an exfiltration-shaped prompt against the deny-listed file was REFUSED by the model itself | observed while writing the W3.4 live test |

## Hard multi-tenancy: container placement

The preset isolates the *agent's view*. For OS-level isolation, place the CLI subprocess itself in a
container/VM with `spawnClaudeCodeProcess` (probe 50: the callback receives full command/args/env and
the session runs end-to-end through the custom child — remote placement is a transport exercise):

```ts
const cfg2 = { ...cfg, extraOptions: { spawnClaudeCodeProcess: (o) => spawnInTenantContainer(o) } };
```

## Non-guarantees (probed, documented)

- **MCP toggle is not a gate** (probe 52b): a disabled server is resurrected by the next model tool
  call. Gate MCP with permissions (`canUseTool` / `disallowedTools`), not `toggleMcpServer`.
- **`mask` credential mode is untested** — it needs the sandbox egress proxy; only `deny` is verified.
- **`setMcpPermissionModeOverride` is rules-layer only** (probe 49): it does not silence a
  `canUseTool` broker; don't treat a mode pin as a permission boundary either way.
- Warm-pool slots (W3.2) freeze Options at warm time — per-tenant configs differ, so tenant sessions
  cold-spawn unless you run one pool per tenant config.
