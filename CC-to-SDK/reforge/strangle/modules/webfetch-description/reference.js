// PARITY LAYER (§2.5 `reference`) — the WebFetch tool's description function.
//
// Upstream: `eYn(e,t=!1)` in chunk-qe0j59w7.js @ 2.1.251, spliced at the
// free-function shape. The chunk also carries the cache-TTL resolver, the
// quoting-policy block and the answering prompt template, so it is not taken
// whole; §2.2's fallback applies.
//
// The second parameter carries its DEFAULT in the graph's adapter, not here: the
// delegation reproduces upstream's parameter list verbatim, so `t=!1` is applied
// exactly once before the bound value is forwarded (strangle/ast.ts).
//
// ## `usageNotes` is owned; the cache phrase is a port
//
// Upstream's `u()` is where the long usage-notes block lives — description text,
// which is what this wave owns — so it is a §2.4 `pure-helper` reimplemented here
// and never called on the graph. What it interpolates is not ours: upstream's
// `r()` renders "15 minutes" from `Lmn()`, which reads
// `CLAUDE_CODE_WEBFETCH_CACHE_TTL_MS`, defaults to 900000 ms and memoizes per
// host. That is an `effectful-port` and a ledger edge to the WebFetch execution
// wave; it crosses as a function and is called exactly where upstream calls it.

const ARTIFACT_EXCEPTION_LEAN =
  " Exception: claude.ai/code/artifact/{uuid} URLs ARE fetchable via your claude.ai login — use WebFetch, not curl (curl gets the SPA shell or a Cloudflare 403).";

const ARTIFACT_EXCEPTION_FULL = `- Exception: claude.ai/code/artifact/{uuid} URLs (including preview.claude.ai) ARE fetchable — WebFetch uses your claude.ai login. Use WebFetch for these, not curl or a headless browser (those return the SPA shell or a Cloudflare 403, not the content).
`;

/**
 * Upstream `u`: the usage-notes block appended to the full description. Leading
 * and trailing newlines are part of it.
 *
 * @param cacheTtlPhrase port: the rendered cache lifetime, e.g. "15 minutes"
 */
export function usageNotes(cacheTtlPhrase) {
  return `
- Fetches content from a specified URL and processes it using an AI model
- Takes a URL and a prompt as input
- Fetches the URL content, converts HTML to markdown
- Processes the content with the prompt using a small, fast model
- Returns the model's response about the content
- Use this tool when you need to retrieve and analyze web content

Usage notes:
  - IMPORTANT: If an MCP-provided web fetch tool is available, prefer using that tool instead of this one, as it may have fewer restrictions.
  - The URL must be a fully-formed valid URL
  - HTTP URLs will be automatically upgraded to HTTPS
  - The prompt should describe what information you want to extract from the page
  - This tool is read-only and does not modify any files
  - Results may be summarized if the content is very large
  - Includes a self-cleaning cache (entries expire after ${cacheTtlPhrase()}) for faster responses when repeatedly accessing the same URL
  - When a URL redirects to a different host, the tool will inform you and provide the redirect URL in a special format. You should then make a new WebFetch request with the redirect URL to fetch the content.
  - For GitHub URLs, prefer using the gh CLI via Bash instead (e.g., gh pr view, gh issue view, gh api).
`;
}

/**
 * Upstream `eYn`.
 *
 * @param model              the session model id, or undefined
 * @param artifactException  whether the claude.ai artifact carve-out applies
 * @param leanPrompt         port: is this model on the lean system prompt?
 * @param cacheTtlPhrase     port: the rendered cache lifetime
 */
export function webFetchDescription(model, artifactException, leanPrompt, cacheTtlPhrase) {
  if (leanPrompt(model)) {
    return `Fetches a URL, converts the page to markdown, and answers \`prompt\` against it using a small fast model.

- Fails on authenticated/private URLs — use an authenticated MCP tool or \`gh\` for those instead.${artifactException ? ARTIFACT_EXCEPTION_LEAN : ""}
- HTTP is upgraded to HTTPS. Cross-host redirects are returned to you rather than followed; call again with the redirect URL.
- Responses are cached for ${cacheTtlPhrase()} per URL.`;
  }
  return `IMPORTANT: WebFetch WILL FAIL for authenticated or private URLs. Before using this tool, check if the URL points to an authenticated service (e.g. Google Docs, Confluence, Jira, GitHub). If so, look for a specialized MCP tool that provides authenticated access.
${artifactException ? ARTIFACT_EXCEPTION_FULL : ""}${usageNotes(cacheTtlPhrase)}`;
}
