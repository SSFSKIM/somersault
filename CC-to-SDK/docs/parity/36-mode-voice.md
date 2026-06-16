# Parity — 36-mode-voice

| id | feature | verdict | SDK surface | bridge / gap | phase | conf | snap |
|---|---|---|---|---|---|---|---|
| 36.1 | Voice mode: hold-to-talk dictation backend | 🏗 build | — | Voice is a UI-input feature with no LLM-loop wiring (transcripts splice into the input buffer, then submit via the normal path). The SDK is headless and has zero audio/STT surface; the whole capture→STT→splice pipeline is a harness build on top of query()/streamInput. | P2 | doc | feb |
| 36.2 | Microphone capture backends (cpal NAPI / arecord / SoX) | 🏗 build | — | Mic capture is pure OS/native integration the SDK does not touch. Reuse a native audio module yourself; nothing in the SDK helps or hinders. Note CC blocks voice under CLAUDE_CODE_REMOTE, reinforcing that this is local-only client tooling. | P2 | doc | feb |
| 36.3 | voice_stream STT WebSocket client (Anthropic endpoint) | 🚫 not-possible | — | The voice_stream STT endpoint is an Anthropic-hosted service (claude.ai-internal, OAuth-only) the SDK does not surface — there is no SDK STT API or endpoint config. You could point your own STT pipeline at a third-party provider, but that is not parity with the CC voice_stream backend. | Pnon-goal | doc | feb |
| 36.4 | Voice UI: push-to-talk key handling, indicator, splicing, keybinding | 🏗 build | — | All TUI/keybinding/indicator/splicing concerns belong to the terminal UI, which the headless SDK does not provide. Deferred to the UI cluster (C11) as a P3 client-UI feature; the SDK contributes nothing to key handling or input-buffer rendering. | P3 | doc | feb |
