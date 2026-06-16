# Parity — 33-mode-daemon

| id | feature | verdict | SDK surface | bridge / gap | phase | conf | snap |
|---|---|---|---|---|---|---|---|
| 33.1 | Background daemon supervisor (claude daemon) | 🏗 build | — | The SDK is a headless library with no daemon/server runtime. Build the supervisor yourself (a Node process managing query()/startup() sessions); the SDK supplies the per-session engine but not the long-running process, IPC, or lifecycle. | P2 | doc | feb |
| 33.2 | Daemon worker spawning (--daemon-worker <kind>) | 🏗 build | — | Worker process management is harness-level. Spawn workers however you like and have each run query()/startup(); spawnClaudeCodeProcess lets you customize how the underlying CC subprocess is launched (VM/container/remote), but the supervisor↔worker registry and IPC are yours to build. | P2 | doc | feb |
| 33.3 | Session-kind PID-file registration (daemon / daemon-worker) | 🏗 build | — | Process bookkeeping with no LLM involvement. If you want a `ps`-style view of SDK-driven sessions, write the PID/registry files yourself; the SDK offers session listing for its own transcript store (listSessions) but not OS-process registration. | P2 | doc | feb |
| 33.4 | In-daemon hosted services (API / MCP / LSP multiplexing) | 🏗 build | — | If your daemon needs shared MCP/LSP/API services, wire them per-session through the SDK's mcpServers/query options (each query manages its own MCP connections). A shared multiplexed service tier is a custom architecture on top; the SDK has no service-host concept. | P2 | inferred | feb |
