# Parity — 42-misc

| id | feature | verdict | SDK surface | bridge / gap | phase | conf | snap |
|---|---|---|---|---|---|---|---|
| 42.1 | Remote session-events pagination (server-stored history) | 🏗 build | — | Server-side session-events history is an ANT/remote-mode internal API (beta header, OAuth) not exposed by the SDK; SDK session history is the local JSONL surface instead. | Pnon-goal | inferred | feb |
| 42.2 | Bash command-execution sandbox subsystem | 🔧 configurable | Options.sandbox (SandboxSettings) configures the command-execution sandbox | Direct: the SDK's sandbox option drives the same sandbox subsystem; the /sandbox-toggle interactive command is a CLI affordance over the same config. | P1 | doc | feb |
| 42.3 | CCR upstream CONNECT-over-WebSocket proxy / relay | 🚫 not-possible | — | Pure remote-execution-container infrastructure (CLAUDE_CODE_REMOTE gated). No SDK surface and not relevant to an SDK consumer driving the agent locally. | Pnon-goal | inferred | feb |
| 42.4 | Misc residuals: native-TS ports, CLI helpers, easter-egg companion, prevent-sleep, VCR | 🏗 build | — | Internal implementation helpers, vendor ports, test infra, and an easter egg — none are parity surfaces. Reimplemented internally where the CC runtime needs them; not exposed to or required by SDK consumers. | Pnon-goal | inferred | feb |
| 42.90 | "ultracode" workflow opt-in keyword | 🏗 build | — | Harness-level UX convention layered on the (Feb-present) Workflow engine. Implement as a prompt/keyword trigger in your harness loop; no SDK surface. | P2 | inferred | post-feb |
