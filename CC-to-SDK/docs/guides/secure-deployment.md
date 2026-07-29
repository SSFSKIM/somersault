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
| Fail-closed engagement | `sandbox.failIfUnavailable: true` — a host whose sandbox backend is missing refuses to start the session instead of running the tenant unsandboxed | the SDK applies this default to a programmatic `enabled: true`; the preset **pins** it so a `base` config cannot set it back to `false` |
| Credential proxy | `baseUrl` → `ANTHROPIC_BASE_URL` — the real API key lives in your proxy, not in tenant env | provider env unit-pinned |
| Network scoping | `sandbox.network.allowedDomains` | SDK SandboxNetworkSettings (structural passthrough) |
| Attribution | `telemetry.resourceAttributes["tenant.id"]` on all metrics/events | probe 51 attrs incl. resourceAttributes |
| Model refusal layer | independent of config: an exfiltration-shaped prompt against the deny-listed file was REFUSED by the model itself | observed while writing the W3.4 live test |

## Platform prerequisites: the sandbox backend

`sandbox` is not implemented by us and is not an npm dependency of `cc-harness`. It is Anthropic's
**sandbox-runtime (`srt`)**, compiled into the `claude` binary the SDK spawns — verified by string
inspection of the bundled CLI (`@anthropic-ai/sandbox-runtime`, `srt-sandbox`, `srt-ca`, `srt-mux`,
`srt-win`). Which OS primitive it uses, and what the host must therefore provide, differs per platform:

| platform | primitive | host packages you must install |
| --- | --- | --- |
| macOS | `sandbox-exec` with generated Seatbelt profiles | `ripgrep` |
| Linux | `bubblewrap` (`bwrap`) + network-namespace removal | `bubblewrap`, `socat`, `ripgrep` |
| Windows | dedicated `srt-sandbox` account + WFP egress fence (**alpha**) | none — but `cc-harness` itself is Unix-only (the fleet host protocol is a Unix domain socket) |

Because the preset pins `failIfUnavailable: true` (below), a Linux host missing any of these does not
degrade quietly — **the session refuses to start**. That is the intended behavior: a tenant running
unsandboxed is worse than a tenant that fails to launch.

### Linux setup

```bash
apt-get install -y bubblewrap socat ripgrep     # Fedora: dnf install …  · Arch: pacman -S …
```

**Ubuntu 24.04 and newer additionally need a sysctl.** These releases default
`kernel.apparmor_restrict_unprivileged_userns=1`, which permits `unshare(CLONE_NEWUSER)` but strips
capabilities from the resulting namespace — and both bubblewrap and the seccomp layer need a
capability-bearing user namespace:

```bash
sysctl -w kernel.apparmor_restrict_unprivileged_userns=0   # or grant `userns` via an AppArmor profile
```

**Inside Docker without privileged namespaces**, the sandbox needs `enableWeakerNestedSandbox`. srt's
own documentation calls this "considerably weaker" and appropriate only where additional isolation is
enforced by other means — which, for this preset, is exactly the container-placement recipe below. If
you enable it, the container boundary is doing the real work and the sandbox is defense in depth.

`bwrapPath` / `socatPath` exist to override PATH auto-detection, but the SDK honors them **only from
admin-controlled managed settings** — you cannot set them per-session through this preset.

### Linux is the weaker backend — four differences that change your policy

1. **No glob patterns in filesystem paths.** macOS accepts gitignore-style globs in
   `sandbox.filesystem`; Linux takes literal paths only. A policy written and tested on a Mac can
   silently match nothing on Linux.
2. **Network filtering rides on environment variables.** Linux exports `HTTP_PROXY` / `HTTPS_PROXY` /
   `ALL_PROXY` into the sandbox; a program that ignores them is not filtered by `allowedDomains`. On
   macOS the Seatbelt profile permits exactly one localhost port, so egress is structurally forced
   through the proxy.
3. **Unix-socket blocking needs seccomp.** Pre-generated BPF filters ship for x86-64 and arm only.
   On another architecture, sockets are left **unrestricted with a warning** rather than denied.
4. **No automatic violation monitoring.** The violation store taps the macOS system log; on Linux you
   run `strace` yourself.

### Evidence status

Probe 48 verified credential `deny` (env var unset, file read kernel-blocked) under **macOS
`sandbox-exec` only**. The same settings are structurally passed through on Linux, but nothing in this
repo has yet exercised them under bubblewrap — treat Linux credential denial as expected-but-unproven
until a probe runs on a Linux host.

## Hard multi-tenancy: container placement

The preset isolates the *agent's view*. For OS-level isolation, place the CLI subprocess itself in a
container/VM with `spawnClaudeCodeProcess` (probe 50: the callback receives full command/args/env and
the session runs end-to-end through the custom child — remote placement is a transport exercise):

```ts
const cfg2 = { ...cfg, extraOptions: { spawnClaudeCodeProcess: (o) => spawnInTenantContainer(o) } };
```

The image that child lands in must carry the sandbox backend from the section above, or the pinned
`failIfUnavailable` will (correctly) refuse every session:

```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends bubblewrap socat ripgrep \
    && rm -rf /var/lib/apt/lists/*
```

## Non-guarantees (probed, documented)

- **MCP toggle is not a gate** (probe 52b): a disabled server is resurrected by the next model tool
  call. Gate MCP with permissions (`canUseTool` / `disallowedTools`), not `toggleMcpServer`.
- **`mask` credential mode is untested** — it needs the sandbox egress proxy; only `deny` is verified.
- **`setMcpPermissionModeOverride` is rules-layer only** (probe 49): it does not silence a
  `canUseTool` broker; don't treat a mode pin as a permission boundary either way.
- Warm-pool slots (W3.2) freeze Options at warm time — per-tenant configs differ, so tenant sessions
  cold-spawn unless you run one pool per tenant config.
