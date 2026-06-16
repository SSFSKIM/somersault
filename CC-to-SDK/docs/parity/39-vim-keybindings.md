# Parity — 39-vim-keybindings

| id | feature | verdict | SDK surface | bridge / gap | phase | conf | snap |
|---|---|---|---|---|---|---|---|
| 39.1 | Keybindings system (resolver, contexts, chords, user overrides) | 🏗 build | — | Pure client-side key dispatch — no SDK data. A headless SDK never sees key events; a TUI consumer reimplements the binding engine and maps actions to SDK control methods (interrupt/setMode/setModel/streamInput). Build-only. | P3 | doc | feb |
| 39.2 | Vim NORMAL/INSERT input layer | 🏗 build | — | Editor-mode input behavior, entirely client-side; the SDK only receives the final submitted prompt. No SDK data source. Build-only. | P3 | doc | feb |
