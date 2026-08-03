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
| **probe 95** (`probes/probes/95-server-web-tools-20260209.ts`, runs 2026-08-03; includes the no-tools control and rate-limit-header capture) | Three facts. (a) `CLAUDE_CODE_OAUTH_TOKEN` + `oauth-2025-04-20` Bearer is rejected for direct `/v1/messages` with an opaque 429 (`message:"Error"`, **no** `anthropic-ratelimit-*`/`retry-after` headers) — even for a plain no-tools call, spaced 8–20 s apart, while the same subscription serves the live session. A policy gate, not a rate limit. (b) `tool_choice:{type:"tool",name:"web_search"}` on `web_search_20260209` returns 400: *"this tool only allows calls from ['code_execution_20260120']"* — the dynamic-filtering variant is invoked from server-side code execution, and **cannot be forced**; the wrapper must demand searching via prompt. (c) The 400 in (b) proves the OAuth request passes auth + validation — the 429 fires only when a request would execute. | direct |
| **probe 28** (`28-oauth-subscription-auth.ts`, shipped) | `ANTHROPIC_API_KEY` in the SDK subprocess env **shadows** the OAuth token and flips the whole session to metered billing. Combined with `resolveOptions.ts`'s `options.env = { ...process.env, ...env }` (process env is spread into the subprocess env, and `Bash` can read it), this forces the scrub rule below. | direct (paid for) |
| **probes 35/35b/35c + 33d** (shipped; memory `sdk-mcp-tools-deferred-not-inline`) | In-process MCP tools surface headlessly as **name-only behind ToolSearch** — descriptions are invisible until the model searches. The repo's twice-paid lesson: an unadvertised capability is inert (`CLAUDE_CODE_FORK_SUBAGENT` needed its paired `FORK_SUBAGENT_NOTE`). Discovery for our tools therefore needs a system-prompt advertisement, not descriptions alone. | direct (paid for) |
| Claude Code source analysis (2.1.220, session 2026-08-03) | Stock behavior being replaced: WebSearch = nested sub-turn over server tool `web_search_20250305`, hardcoded `max_uses: 8`, main model receives titles+URLs+prose only; WebFetch = local axios (10 MB/60 s) → Turndown → truncate 100 k chars → **Haiku summarization**, 15-min cache, same-host-only redirect follow, cross-host redirect costs a full extra turn. Raw page text reaches the main model only for ~110 preapproved doc hosts serving markdown < 100 k chars. CC's own WebSearch `validateInput` rejects `allowed_domains` and `blocked_domains` together — the server tools accept one list, not both. | derived from source |
| Anthropic docs (claude-api skill, 2026-08) | `web_search_20260209` / `web_fetch_20260209` require Sonnet 4.6+/Opus 4.6+ (Haiku 4.5 is limited to `web_search_20250305`); no beta header; do not also declare `code_execution` alongside the `_20260209` variants; `web_search_result` content is `encrypted_content` (title/url/page_age are the only plaintext fields extractable client-side). | declared |
| `sdk.d.ts` 0.3.220 (`betas` at :1507, `SdkBeta` at :2930) | `Options.betas` is typed to exactly `'context-1m-2025-08-07'`; there is no surface for injecting raw server tools into the bundled CLI's own requests. In-place replacement of the native tools is impossible — replacement means disallow + provide our own. | direct |
| Independent spec review (fable subagent, 2026-08-03) | 15 findings, all verified against the codebase and folded in — see Revision Notes. The load-bearing ones: the env-spread key leak, the daemon config gap, the MCP wiring-layer convention, deferred-tool discovery, and the missing allowlist wiring. | derived |

**Pinned but unverified** (must be settled by the gated live test before the tier-2 acceptance rows
can pass): (a) the exact 200-response shape of `web_search_20260209` under an API key — how many
`web_search_tool_result` blocks arrive, their result-item fields, and whether dynamic filtering
changes the block layout relative to `web_search_20250305`; (b) the **request-side** `filters`
schema for `_20260209` (probe 95 never sent `filters`). Probe 95 could not observe a 200 (no API
key in `.env`).

## Design

### Config

`HarnessConfig.webTools` (new, optional):

```ts
webTools?: {
  mode?: "native" | "raw-fetch" | "server";   // default "native" — existing behavior untouched
  apiKey?: string;          // tier-2 only; also read from env CCX_WEB_API_KEY at resolve time
  searchModel?: string;     // default "claude-sonnet-4-6" (request-validation-tested by probe 95;
                            // the 200 path is pinned on the gated live test; must be Sonnet 4.6+)
  searchMaxUses?: number;   // default 4 (server-side searches per wrapper turn)
  searchDomains?: { allow?: string[]; deny?: string[] };  // search filters — separate from
                            // webFetchDomains (a fetch content-safety control; conflating them
                            // would silently confine the search index). At most one list may be
                            // set — both together is a validateHarnessConfig error, mirroring the
                            // server tool's own one-list rule.
  maxSearchCalls?: number;  // default 50 per session — cost ceiling on the metered key; calls
                            // beyond it return is_error advising the model the budget is spent.
  fetchMaxChars?: number;   // default 40_000 (raw markdown cap returned to the main model)
}
```

`webFetchDomains.allow/deny` keeps its meaning in every mode — it governs **fetch** only. In
`native` it maps to `WebFetch(domain:...)` rules as today; in the other modes the same lists are
enforced inside our fetch tool, and `resolveTools` **suppresses** the `WebFetch(domain:...)` rule
emission (the native tool is disallowed; emitting rules for it would be dead config).

Cost note (tier 2): each `mcp__cc-web__search` call ≈ one metered `searchModel` turn + up to
`searchMaxUses` searches at server-tool pricing ($10/1k searches), with result content billed as
wrapper input tokens. `maxSearchCalls` bounds the per-session exposure; `maxBudgetUsd` does **not**
see this spend (it meters the OAuth session, not the isolated key).

### Modes and tool wiring

| mode | native WebSearch | native WebFetch | `mcp__cc-web__search` | `mcp__cc-web__fetch` |
|---|---|---|---|---|
| `native` (default) | on | on | — | — |
| `raw-fetch` | on | **disallowed** | — | on + allowlisted |
| `server` | **disallowed** | **disallowed** | on + allowlisted | on + allowlisted |

The in-process MCP server is named **`cc-web`** (harness convention: `cc-tasks`, `cc-context`,
`cc-swarm`, `cc-compact`), avoiding collision with user-supplied `mcpServers` entries under the
spread-merge pattern.

**Wiring layer** — a `withWebTools(options, resolved)` composition helper at the same layer as
`withContextTool`, **not** inside `resolveOptions` (the established convention: in-process MCP
servers wire after/outside `resolveOptions`, partly because daemon spawn configs must stay
JSON-serializable over the UDS). It: registers the `cc-web` server, appends the active tool ids to
`allowedTools` (deduped — otherwise calls stall on permissions or summon the daemon broker, the
WORKFLOW_TOOLS lesson), appends the native disallows to `disallowedTools`, and appends a one-line
**system-prompt advertisement** naming the tools and when to reach for them (the `FORK_SUBAGENT_NOTE`
pattern — probes 35/33d: deferred MCP tools are name-only behind ToolSearch, so descriptions alone
leave the capability inert).

**Reach**:
- Lib path (`createHarness` / `Session`): applied when `config.webTools` is present, alongside the
  existing `contextTool` wiring in `harness.ts` / `session/session.ts`.
- Daemon/REPL path: `SpawnConfig` gains the **serializable subset** of `webTools` (`mode`,
  `searchModel`, `searchMaxUses`, `searchDomains`, `maxSearchCalls`, `fetchMaxChars` — **never
  `apiKey`**, which must not transit the UDS or sit in supervisor state); the CLI host applies
  `withWebTools` through the existing `sessionOptions` factory seam, resolving the key daemon-side
  from `CCX_WEB_API_KEY` only. Warm-pool interplay is automatic: a non-null `sessionOptions` result
  already disqualifies the warm path (`!extra` in `makeSession`).

**Fail-fast** — keyless `server` mode is rejected in `validateHarnessConfig` (the front-door error
seam), with a message naming both `webTools.apiKey` and `CCX_WEB_API_KEY`. Not in `resolveOptions`
(which `resolvedPermissionMode()` also calls for status-bar seeding) and not a silent fallback to
`native` (opt-in misconfiguration should be loud). The daemon rejects at spawn the same way.

### `webtools/fetchTool.ts` — raw local fetch (tiers 1+2)

Pipeline: validate URL (https upgrade, reject credentials-in-URL, dotless hosts) → domain
allow/deny check (`webFetchDomains`) → **SSRF gate** (external review 2026-08-04, P1): the fetch
runs in the HARNESS process, outside `sandbox.network`, so a model-controlled URL must not reach
internal services — resolve the host and reject non-public addresses (loopback, RFC1918,
link-local/`169.254.0.0/16` incl. cloud metadata, `0.0.0.0/8`, IPv6 loopback/ULA/link-local),
reject literal IPs unless explicitly allowlisted in `webFetchDomains`, pin the fetch to the
resolved-and-checked address (no TOCTOU re-resolve), and re-run the gate on EVERY redirect hop →
GET with 10 MB / 30 s caps and the harness UA →
content-type branch: HTML → Turndown → markdown; text types pass through; binary → typed refusal
naming the content type → truncate to `fetchMaxChars` with an explicit `[truncated at N chars —
re-fetch with a narrower URL or raise fetchMaxChars]` marker → return **raw text, no model in the
loop**.

Redirects: same-host follows automatically (≤ 5 hops); cross-host returns a notice instructing the
model to re-call with the new URL — CC's anti-open-redirect stance preserved, because our domain
allow/deny would otherwise be bypassable by a redirect. No cache in v1 (CC's 15-min cache exists to
absorb its Haiku cost; a raw fetch re-run is cheap and always fresh).

**Sandbox note**: the fetch executes in the **harness process**, not the sandboxed SDK subprocess —
`sandbox.network` restrictions do not constrain it. `webFetchDomains` is the sole enforcement
layer for these tools; the spec states this openly rather than implying sandbox coverage.

### `webtools/searchTool.ts` — server-search wrapper (tier 2)

A direct `fetch("https://api.anthropic.com/v1/messages")` from the harness process with
`x-api-key` — a hand-rolled minimal client, no SDK involvement. One wrapper turn per tool call:
`searchModel`, `tools:[{type:"web_search_20260209", name:"web_search", max_uses, filters}]` —
`filters` carries `searchDomains`' single configured list — prompt built from the caller's query
demanding search (`tool_choice` force is impossible — probe 95).

Return value to the main model, in order:
1. **Result list** — every `web_search_tool_result` item's `title / url / page_age` (the plaintext
   fields; content is `encrypted_content` and server-side only).
2. **Extractive digest** — the wrapper model's text, prompted to quote result-grounded facts and
   never editorialize, truncated at 2,000 chars.
3. A one-line pointer: fetch promising URLs with `cc-web` fetch for full text.

**Zero-search contract**: prompt-demanded search can silently not search. If the wrapper response
contains no `web_search_tool_result` block, re-prompt once with a harder demand; a second miss
returns `is_error` naming the condition ("wrapper answered without searching") so the acceptance
row can't flake and the main model knows the search didn't happen.

Division of labor is deliberate: server search = *discovery* (current index, dynamic filtering,
model-side relevance), raw fetch = *content* (lossless). The wrapper never becomes a second Haiku.

Errors (429/4xx/5xx from the wrapper call, `maxSearchCalls` exhaustion) return as `is_error` tool
results carrying status + body summary — the main model can fall back to its own judgment.

### Key isolation (the hard rule)

The tier-2 key is read from `webTools.apiKey` or `CCX_WEB_API_KEY`, held in the harness process,
used only inside `searchTool`'s fetch, never logged. Two concrete leak paths are closed:

1. **Env spread**: `resolveOptions` builds `options.env = { ...process.env, ...env }`, so a
   process-level `CCX_WEB_API_KEY` would land in the SDK subprocess where the model can read it
   via `Bash`. The scrub therefore lives in **`resolveOptions` itself** — every produced env
   deletes `CCX_WEB_API_KEY` unconditionally, whether or not a `webTools` block exists —
   because the Reach rule above only invokes `withWebTools` when `config.webTools` is present,
   and a config-less session with the variable exported would otherwise leak it (external
   review 2026-08-04, P1). `withWebTools` keeps its own delete as belt-and-braces, but the
   "every mode" guarantee is `resolveOptions`'s, not the wrapper's.
2. **UDS transit**: `apiKey` is excluded from `SpawnConfig` (above); daemon-side resolution is
   env-var-only.

`ANTHROPIC_API_KEY` handling is unchanged: OAuth sessions must not gain one (probe 28's shadowing
trap); API-key-billed sessions legitimately carry theirs. The acceptance asserts the scrub for
`CCX_WEB_API_KEY` and the OAuth session's provider identity, not a blanket key ban.

## Acceptance (observable behavior)

- A session with no `webTools` config and no `CCX_WEB_API_KEY` in the environment behaves
  byte-identically to today (unit: `resolveTools`/`withWebTools` output unchanged; the existing
  suite stays green untouched).
- Unit, key scrub: with `CCX_WEB_API_KEY` in `process.env`, the `options.env` produced for the SDK
  contains no `CCX_WEB_API_KEY` — in every mode.
- Unit, mode wiring (`resolveTools` + `withWebTools` output): `raw-fetch` puts bare `WebFetch` in
  `disallowedTools`, adds `mcp__cc-web__fetch` to `allowedTools`, and suppresses
  `WebFetch(domain:...)` rule emission; `server` additionally disallows `WebSearch` and allowlists
  `mcp__cc-web__search`; the system prompt gains the advertisement line.
- `mode:"raw-fetch"` (live, OAuth-gated): the model calling `mcp__cc-web__fetch` on an HTML page
  receives markdown containing verbatim strings from the page body (not a summary); a cross-host
  redirect returns the notice, not the target page.
- `mode:"server"` without a key: `validateHarnessConfig` rejects with a message naming both
  `webTools.apiKey` and `CCX_WEB_API_KEY`.
- `mode:"server"` with a key (gated live test on `CCX_WEB_API_KEY`, skips cleanly keyless): one
  `mcp__cc-web__search` call returns ≥ 1 result with non-empty `title` and `url`, plus a digest
  section — or the zero-search `is_error` contract fires, which the test treats as failure with
  the wrapper transcript attached; the model running `Bash` `echo $CCX_WEB_API_KEY` in the same
  session prints nothing; the session still reports OAuth `apiProvider:"firstParty"`.
- The live test records the observed `web_search_20260209` request `filters` schema and response
  block shape into the test file as assertions, discharging both pinned premises.
- Unit tests run keyless via DI fake `fetch` for both tools (the harness `deps` default-param
  pattern).

## Non-goals

- No composite Codex-style `web_research` autonomous tool (rejected in grill — see Decision Log).
- No replacement of fetch by `web_fetch_20260209` (rejected — wrapper double-billing; local raw
  fetch dominates for content).
- No fetch cache, no JS rendering, no PDF extraction in v1 (binary → typed refusal; revisit on demand).
- No change to native-mode behavior (beyond the always-on `CCX_WEB_API_KEY` scrub), the TUI, or the
  parity scorecard's fidelity rows other than a `coverage.md` divergence-by-design note.

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
- **System-prompt advertisement over descriptions-only discovery** (review finding 4, reversing a
  silent decision). Probes 35/33d: in-process MCP tools are name-only behind ToolSearch headlessly;
  descriptions-only would leave the replacement tools inert exactly where the native ones were
  removed.
- **`withWebTools` at the contextTool layer, fail-fast in `validateHarnessConfig`** (review
  finding 3, reversing "wired through resolveOptions"). Matches the established MCP-layering
  convention, keeps spawn configs serializable, and keeps `resolvedPermissionMode()` throw-free.
- **`cc-web` server name over `web`** (review finding 10). Harness naming convention + collision
  safety under the `mcpServers` spread-merge.
- **`searchDomains` separate from `webFetchDomains`** (review finding 7). Fetch domain lists are a
  content-safety control; silently reusing them as search filters would confine the search index —
  a different intent. One-list-only enforced at validation (finding 6; CC's own tool rejects both).
- **`maxSearchCalls` per-session ceiling, default 50** (review finding 15). The isolated key sits
  outside `maxBudgetUsd`'s metering; an unbounded main model could otherwise run up the metered
  key invisibly.
- **`claude-sonnet-4-6` as default wrapper model** (agent, silent; label softened per review
  finding 11). `_20260209` requires Sonnet 4.6+; Haiku is off the table (docs). Request-validation
  passed under probe 95; the 200 path is pinned on the live test. Configurable.
- **Fail-fast on keyless `server` mode over silent `native` fallback** (agent, silent). Opt-in
  misconfiguration should be loud.

## Surprises & Discoveries

- **Claude Code OAuth tokens cannot call `/v1/messages` directly at all** (probe 95 control run):
  opaque 429 with no rate-limit headers on even a plain no-tools request, while validation errors
  (400) do surface — the gate sits at execution, after auth and validation. This reshaped the
  whole feature into a ladder.
- **`web_search_20260209` is not directly callable by the model** (probe 95, Q3 400): it declares
  `allowed_callers:['code_execution_20260120']` — dynamic filtering means the search runs inside
  server-side code execution. Consequence: `tool_choice` cannot force a search; prompt-demand is
  the only lever, and the docs' "do not also declare code_execution" warning is structural, not
  stylistic.
- The `_20260209` variants' Sonnet-4.6+ floor rules out the cheap-Haiku-wrapper design CC itself
  uses for its search sub-turn.
- **The env spread is a live exfiltration path** (review finding 1): `resolveOptions` copies
  `process.env` into the SDK subprocess env, so any secret env var the harness holds is readable
  by the model via `Bash` unless explicitly scrubbed. Generalizable beyond this feature.

## Outcomes & Retrospective

Pending — written at finish.

## Revision Notes

- 2026-08-03 — initial design (brainstorm session: Codex-vs-CC web analysis → grill → probe 95 →
  two-tier ladder).
- 2026-08-03 — independent review round (fable subagent, 15 findings, all verified and folded in):
  key-scrub rule + acceptance rewrite (1), daemon reach via `SpawnConfig` serializable subset +
  `sessionOptions` seam (2, 14), wiring moved to the `withWebTools` layer with fail-fast in
  `validateHarnessConfig` (3), system-prompt advertisement (4), allowlist wiring (5), one-list
  filters rule + request-schema pinned (6), `searchDomains` split (7), probe 95 extended with the
  no-tools control + header capture (8), acceptance restated as `resolveTools` assertions +
  domain-rule suppression (9), `cc-web` rename (10), evidence label softened (11), zero-search
  contract (12), sandbox-bypass note (13), `maxSearchCalls` ceiling (15).
- 2026-08-04 — external whole-branch review (codex gpt-5.6-sol) returned two P1s against this
  spec, both folded in: (1) the key scrub moved from `withWebTools` to `resolveOptions`
  unconditionally — the Reach rule only applied the wrapper when a `webTools` block existed, so a
  config-less session with `CCX_WEB_API_KEY` exported would have spread it into the subprocess
  env; (2) the raw-fetch pipeline gained an SSRF gate — resolve-and-reject non-public addresses
  (loopback/RFC1918/link-local/metadata/IPv6 equivalents), literal IPs allowlist-only, address
  pinning, re-checked per redirect hop — because the fetch runs in the harness process outside
  `sandbox.network`.
