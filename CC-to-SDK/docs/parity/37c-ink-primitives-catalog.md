# Parity — 37c-ink-primitives-catalog

| id | feature | verdict | SDK surface | bridge / gap | phase | conf | snap |
|---|---|---|---|---|---|---|---|
| 37c.1 | Ink host components + render/layout/buffer pipeline | 🏗 build | — | The in-house terminal-rendering substrate — zero SDK data dependency. A non-Ink TUI (e.g. ratatui) replaces this layer wholesale rather than porting it. ~58 primitives subsumed. | P3 | doc | feb |
| 37c.2 | Ink event system + capability detection + low-level hooks | 🏗 build | — | Terminal-capability and input-event plumbing, independent of the SDK. ~38 primitives subsumed; replaced by the host's own event loop. | P3 | doc | feb |
