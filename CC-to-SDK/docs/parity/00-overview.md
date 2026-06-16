# Parity — 00-overview

| id | feature | verdict | SDK surface | bridge / gap | phase | conf | snap |
|---|---|---|---|---|---|---|---|
| 00.1 | Settings cascade ordering invariant (no env source, no defaults source) | ✅ provided | settingSources + settings + managedSettings + resolveSettings() | The SDK's source tiers (user/project/local/flag/managed) reproduce the same ordering; resolveSettings applies it. Defaults remain consumer-side ?? fallbacks exactly as in CC. Direct. | P1 | doc | feb |
| 00.2 | Build-time feature flags / ANT-only gating (bun:bundle DCE) | 🚫 not-possible | — | Feature-flag gating is internal to the CC build (GrowthBook + bun:bundle DCE); the SDK consumer cannot toggle these. External builds already strip ANT-only code. No SDK surface; not a parity target. | Pnon-goal | doc | feb |
| 00.3 | Pre-module-eval boot prefetch (MDM/keychain/preconnect) | ✅ provided | startup() -> WarmQuery | The internal prefetch ordering is an implementation detail of the spawned binary; the SDK's user-facing equivalent for warm starts is startup(). The micro-optimizations themselves are inherited, not configurable. Direct via startup(). | P1 | inferred | feb |
