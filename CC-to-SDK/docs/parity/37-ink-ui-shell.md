# Parity — 37-ink-ui-shell

| id | feature | verdict | SDK surface | bridge / gap | phase | conf | snap |
|---|---|---|---|---|---|---|---|
| 37.1 | In-house Ink renderer + reconciler + layout pipeline | 🏗 build | — | The SDK is headless — no renderer. A TUI consumer must supply its own terminal render loop (e.g. Rust ratatui / Node Ink) and drive it from the SDK message stream. No SDK data source; this is pure presentation infrastructure. | P3 | doc | feb |
| 37.2 | App shell + REPL screen + FullscreenLayout router | 🏗 build | — | Render loop driven by the SDKMessage AsyncGenerator from query(); init handled via SDKSystemMessage(system/init) + Query.initializationResult(); setup gates map to onElicitation / onUserDialog / canUseTool. The shell logic is build-only. | P3 | doc | feb |
| 37.3 | Theme system (6 themes, auto-theme, color resolver) | 🏗 build | — | Pure client-side rendering concern; the SDK carries no theme data. A TUI rebuilds the palette and picker locally. Build-only. | P3 | doc | feb |
| 37.4 | Spinner / progress / activity animation family | 🏗 build | — | Driven by SDKStatusMessage + SDKToolProgressMessage + SDKTaskProgressMessage (running indicator) and SDKThinkingTokensMessage; tips overlay from local config. ~12 components to rebuild. | P3 | doc | feb |
