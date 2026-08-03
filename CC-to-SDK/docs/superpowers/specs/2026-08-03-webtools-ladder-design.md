# Web tools ladder — design

> Follow-up to the Codex-vs-Claude web-search architecture analysis (2026-08-03, session work +
> memory `web-search-architecture-codex-vs-claude`): Claude Code's research loop loses to Codex's
> not on the search index but on **where iteration happens and how lossy the pipe is**. This spec
> upgrades `ccx`'s web tools along exactly those two axes, within what credentials actually permit.

## Purpose

Give `ccx` sessions a measurably less lossy web-research pipe than stock Claude Code, as an opt-in
ladder that never disturbs the default OAuth-subscription session:

1. **`raw-fetch`** — remove the single biggest information loss in CC's pipeline: WebFetch's
   Haiku summarization. Our replacement fetch tool returns the page's raw markdown (capped), so the
   main model reads sources instead of summaries of summaries. Needs no credentials beyond the
   session's own.
2. **`server`** — additionally replace WebSearch with a wrapper over the current-generation
   server tool `web_search_20260209` (dynamic filtering, current index), called directly against
   the Anthropic API with a **separate, isolated API key**.

The ladder exists because probe 95 killed the obvious design: the Claude Code OAuth token cannot
make direct `/v1/messages` calls at all, so "just use the server tools" would have gated the whole
feature on a metered key. Splitting the free win (raw fetch) from the keyed win (server search)
keeps tier 1 available to every session.

This is **divergence-by-design**, not parity: the TUI clone tracks fidelity to CC; this feature
deliberately does better than CC where CC's design is the weakness.

## Grounding

| Evidence | What it settles | Strength |
|---|---|---|
| **probe 95** (`probes/probes/95-server-web-tools-20260209.ts`, run 2026-08-03) | Three facts. (a) `CLAUDE_CODE_OAUTH_TOKEN` + `oauth-2025-04-20` Bearer is rejected for direct `/v1/messages` with an opaque 429 (`message:"Error"`, **no** `anthropic-ratelimit-*`/`retry-after` headers) — even for a plain no-tools call, spaced 8–20 s apart, while the same subscription serves the live session. A policy gate, not a rate limit. (b) `tool_choice:{type:"tool",name:"web_search"}` on `web_search_20260209` returns 400: *"this tool only allows calls from ['code_execution_20260120']"* — the dynamic-filtering variant is invoked from server-side code execution, and **cannot be forced**; the wrapper must demand searching via prompt. (c) The 400 in (b) proves the OAuth request passes auth + validation — the 429 fires only when a request would execute. | direct |
| **probe 28** (`28-oauth-subscription-auth.ts`, shipped) | `ANTHROPIC_API_KEY` in the SDK subprocess env **shadows** the OAuth token and flips the whole session to metered billing. Hence the hard rule below: the web-tools key never enters `Options.env`. | direct (paid for) |
| Claude Code source analysis (2.1.220, session 2026-08-03) | Stock behavior being replaced: WebSearch = nested sub-turn over server tool `web_search_20250305`, hardcoded `max_uses: 8`, main model receives titles+URLs+prose only; WebFetch = local axios (10 MB/60 s) → Turndown → truncate 100 k chars → **Haiku summarization**, 15-min cache, same-host-only redirect follow, cross-host redirect costs a full extra turn. Raw page text reaches the main model only for ~110 preapproved doc hosts serving markdown < 100 k chars. | derived from source |
| Anthropic docs (claude-api skill, 2026-08) | `web_search_20260209` / `web_fetch_20260209` require Sonnet 4.6+/Opus 4.6+ (Haiku 4.5 is limited to `web_search_20250305`); no beta header; do not also declare `code_execution` alongside the `_20260209` variants; `web_search_result` content is `encrypted_content` (title/url/page_age are the only plaintext fields extractable client-side). | declared |
| `sdk.d.ts` 0.3.220 (`betas` at :1507, `SdkBeta` at :2930) | `Options.betas` is typed to exactly `'context-1m-2025-08-07'`; there is no surface for injecting raw server tools into the bundled CLI's own requests. In-place replacement of the native tools is impossible — replacement means disallow + provide our own. | direct |

**Pinned but unverified** (must be settled by the gated live test before the tier-2 acceptance row
can pass): the exact 200-response shape of `web_search_20260209` under an API key — how many
`web_search_tool_result` blocks arrive, their result-item fields, and whether dynamic filtering
changes the block layout relative to `web_search_20250305`. Probe 95 could not observe a 200 (no
API key in `.env`).

## Design

### Config

`HarnessConfig.webTools` (new, optional):

```ts
webTools?: {
  mode?: "native" | "raw-fetch" | "server";   // default "native" — existing behavior untouched
  apiKey?: string;          // tier-2 only; also read from env CCX_WEB_API_KEY at resolve time
  searchModel?: string;     // default "claude-sonnet-4-6" (probe-tested; must be Sonnet 4.6+)
  searchMaxUses?: number;   // default 4 (server-side searches per wrapper turn)
  fetchMaxChars?: number;   // default 40_000 (raw markdown cap returned to the main model)
}
```

Existing `webFetchDomains.allow/deny` keeps working in every mode: in `native` it maps to
`WebFetch(domain:...)` rules as today; in the other modes the same lists are enforced inside our
fetch tool (and passed as `filters.allowed_domains`/`blocked_domains` to the server search).

### Modes and tool wiring (`resolveTools` + `resolveOptions`)

| mode | native WebSearch | native WebFetch | `mcp__web__search` | `mcp__web__fetch` |
|---|---|---|---|---|
| `native` (default) | on | on | — | — |
| `raw-fetch` | on | **disallowed** | — | on |
| `server` | **disallowed** | **disallowed** | on | on |

Tools are exposed via an in-process MCP server named `web` (`createSdkMcpServer`), wired through
`resolveOptions` — the single seam both `createHarness` and `Session` already share, so the daemon
and REPL inherit the feature for free. Discovery relies on tool descriptions only (no system-prompt
injection); each description states plainly when to reach for it, mirroring how CC's own tools
advertise.

`server` mode with no resolvable key **fails fast at session start** with an actionable message —
it is opt-in, so a silent fallback to `native` would hide a misconfiguration.

### `webtools/fetchTool.ts` — raw local fetch (tiers 1+2)

Pipeline: validate URL (https upgrade, reject credentials-in-URL, dotless hosts) → domain
allow/deny check → GET with 10 MB / 30 s caps and the harness UA → content-type branch: HTML →
Turndown → markdown; text types pass through; binary → typed refusal naming the content type →
truncate to `fetchMaxChars` with an explicit `[truncated at N chars — re-fetch with a narrower
URL or raise fetchMaxChars]` marker → return **raw text, no model in the loop**.

Redirects: same-host follows automatically (≤ 5 hops); cross-host returns a notice instructing the
model to re-call with the new URL — CC's anti-open-redirect stance preserved, because our domain
allow/deny would otherwise be bypassable by a redirect. No cache in v1 (CC's 15-min cache exists to
absorb its Haiku cost; a raw fetch re-run is cheap and always fresh).

### `webtools/searchTool.ts` — server-search wrapper (tier 2)

A direct `fetch("https://api.anthropic.com/v1/messages")` from the harness process with
`x-api-key` — a hand-rolled minimal client, no SDK involvement. One wrapper turn per tool call:
`searchModel`, `tools:[{type:"web_search_20260209", name:"web_search", max_uses, filters}]`,
prompt built from the caller's query demanding search (tool_choice force is impossible — probe 95b).

Return value to the main model, in order:
1. **Result list** — every `web_search_tool_result` item's `title / url / page_age` (the plaintext
   fields; content is `encrypted_content` and server-side only).
2. **Extractive digest** — the wrapper model's text, prompted to quote result-grounded facts and
   never editorialize, truncated at 2,000 chars.
3. A one-line pointer: fetch promising URLs with `web_fetch` for full text.

Division of labor is deliberate: server search = *discovery* (current index, dynamic filtering,
model-side relevance), raw fetch = *content* (lossless). The wrapper never becomes a second Haiku.

Errors (429/4xx/5xx from the wrapper call) return as `is_error` tool results carrying status +
body summary — the main model can fall back to its own judgment or retry.

### Key isolation (the hard rule)

The tier-2 key is read from `webTools.apiKey` or `CCX_WEB_API_KEY`, held in the harness process,
used only inside `searchTool`'s fetch. It is **never** written into `Options.env`, never exported,
never logged. Probe 28's shadowing trap is the reason: leaking `ANTHROPIC_API_KEY` into the SDK
subprocess would silently flip the main session from subscription to metered billing.

## Acceptance (observable behavior)

- A session with no `webTools` config behaves byte-identically to today (unit: `resolveTools`
  output unchanged; the existing suite stays green untouched).
- `mode:"raw-fetch"`: the model calling `mcp__web__fetch` on an HTML page receives markdown
  containing verbatim strings from the page body (not a summary); native `WebFetch` is refused by
  permissions; a cross-host redirect returns the notice, not the target page.
- `mode:"server"` without a key: session construction throws with a message naming both
  `webTools.apiKey` and `CCX_WEB_API_KEY`.
- `mode:"server"` with a key (gated live test, skips cleanly keyless): one `mcp__web__search` call
  returns ≥ 1 result with non-empty `title` and `url`, plus a digest section; the SDK subprocess
  env observed by the session contains no `ANTHROPIC_API_KEY`/`CCX_WEB_API_KEY` entry (asserted via
  the DI seam, and the main session still reports OAuth `apiProvider:"firstParty"`).
- The live test records the observed `web_search_20260209` block shape into the test file as
  assertions, discharging the pinned premise above.
- Unit tests run keyless via DI fake `fetch` for both tools.

## Non-goals

- No composite Codex-style `web_research` autonomous tool (rejected in grill — see Decision Log).
- No replacement of fetch by `web_fetch_20260209` (rejected — wrapper double-billing; local raw
  fetch dominates for content).
- No fetch cache, no JS rendering, no PDF extraction in v1 (binary → typed refusal; revisit on demand).
- No change to native-mode behavior, the TUI, or the parity scorecard's fidelity rows other than a
  `coverage.md` divergence-by-design note.

## Decision Log

- **Thin passthrough pair over Codex-style composite `web_research` tool** (owner, grill Q1).
  Composite moved iteration out of the main loop — most Codex-like — but hides raw results from
  the main model exactly the way CC does; the thin pair removes lossiness first. Composite remains
  a possible later tier on top of this one.
- **Opt-in (`native` default) over default-on** (owner, grill Q2). Existing sessions/tests keep
  their behavior; default flip is a later decision after live validation.
- **Two-tier ladder over server-pair-only or raw-fetch-only** (owner, grill Q3 — asked after probe
  95 flipped the premise). Server-pair-only would gate everything on a metered key; raw-fetch-only
  forfeits the current search index and dynamic filtering. The ladder prices each win separately.
- **Fetch stays local even in `server` mode** (agent, presented and approved). `web_fetch_20260209`
  bills page content twice (wrapper input + main-model input) and adds nothing our raw fetch lacks
  for docs-type content; rejected in favor of one lossless local path shared by both tiers.
- **Search wrapper returns title/url/page_age + extractive digest** (agent, presented and
  approved). Full result content is `encrypted_content` — unextractable client-side by design; the
  honest contract is discovery + pointer, with content owned by raw fetch.
- **`claude-sonnet-4-6` as default wrapper model** (agent, silent). `_20260209` requires Sonnet
  4.6+; Haiku is off the table (docs), and 4-6 is the name probe 95 exercised. Configurable.
- **Fail-fast on keyless `server` mode over silent `native` fallback** (agent, silent). Opt-in
  misconfiguration should be loud.
- **No system-prompt injection for discovery** (agent, silent). Tool descriptions carry the
  triggering guidance; revisit only if live use shows the model ignoring the tools.

## Surprises & Discoveries

- **Claude Code OAuth tokens cannot call `/v1/messages` directly at all** (probe 95c): opaque 429
  with no rate-limit headers on even a plain no-tools request, while validation errors (400) do
  surface — the gate sits at execution, after auth and validation. This reshaped the whole feature
  into a ladder.
- **`web_search_20260209` is not directly callable by the model** (probe 95, Q3 400): it declares
  `allowed_callers:['code_execution_20260120']` — dynamic filtering means the search runs inside
  server-side code execution. Consequence: `tool_choice` cannot force a search; prompt-demand is
  the only lever, and the docs' "do not also declare code_execution" warning is structural, not
  stylistic.
- The `_20260209` variants' Sonnet-4.6+ floor rules out the cheap-Haiku-wrapper design CC itself
  uses for its search sub-turn.

## Outcomes & Retrospective

Pending — written at finish.

## Revision Notes

- 2026-08-03 — initial design (brainstorm session: Codex-vs-CC web analysis → grill → probe 95 →
  two-tier ladder).
