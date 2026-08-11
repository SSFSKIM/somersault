// Probe 95 — can the harness call web_search_20260209 / web_fetch_20260209 directly?
// Questions:
//   Q0  CONTROL: does a plain no-tools /v1/messages call work under each credential?
//   Q1  Does a direct POST /v1/messages work with CLAUDE_CODE_OAUTH_TOKEN (Bearer + oauth beta)?
//   Q2  Does web_search_20260209 run under those creds, and what do the result blocks look like?
//   Q3  Can a server tool be forced via tool_choice {type:"tool", name:"web_search"}?
//   Q4  Does web_fetch_20260209 fetch a URL present in the conversation, and what comes back?
//
// OBSERVED 2026-08-03 (oauth-bearer credential, spaced runs 8–20 s apart):
//   Q0/Q1/Q2/Q4 → HTTP 429 {"type":"rate_limit_error","message":"Error"} with NO
//     anthropic-ratelimit-* and NO retry-after headers, on EVERY request including the plain
//     no-tools control — while the same subscription served the live Claude Code session.
//     Conclusion: a policy gate on direct API use with CC OAuth tokens, not a rate limit.
//   Q3 → HTTP 400 "tool_choice.name 'web_search' cannot be used because this tool only allows
//     calls from ['code_execution_20260120']. Tools specified in tool_choice must allow 'direct'
//     calls from the model." — proves (a) the OAuth request passes auth+validation (the 429 gate
//     sits at execution), and (b) the _20260209 dynamic-filtering variant is invoked from
//     server-side code execution and CANNOT be forced via tool_choice.
//   Q2/Q4 200-path (result block shapes, request-side filters schema) remains UNVERIFIED —
//     requires an API key; pinned on the webtools-ladder gated live test.
//
// Run: npx tsx probes/95-server-web-tools-20260209.ts   (reads ../.env for creds)
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(import.meta.dirname, "../../.env");
const env: Record<string, string> = {};
try {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"#]*)"?\s*$/);
    if (m && !line.trim().startsWith("#")) env[m[1]] = m[2].trim();
  }
} catch { /* fall through to process.env */ }
const oauth = env.CLAUDE_CODE_OAUTH_TOKEN || process.env.CLAUDE_CODE_OAUTH_TOKEN;
const apiKey = env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;

const MODEL = "claude-sonnet-4-6"; // _20260209 variants need Sonnet 4.6+ / Opus 4.6+

type Cred = { label: string; headers: Record<string, string> };
const creds: Cred[] = [];
if (oauth) creds.push({ label: "oauth-bearer", headers: { authorization: `Bearer ${oauth}`, "anthropic-beta": "oauth-2025-04-20" } });
if (apiKey) creds.push({ label: "api-key", headers: { "x-api-key": apiKey } });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call(cred: Cred, body: object): Promise<{ status: number; limitHdrs: Record<string, string>; json: any }> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "anthropic-version": "2023-06-01", ...cred.headers },
    body: JSON.stringify(body),
  });
  // Capture rate-limit evidence: a genuine token-bucket 429 carries these; a policy gate doesn't.
  const limitHdrs = Object.fromEntries(
    [...res.headers.entries()].filter(([k]) => k.startsWith("anthropic-ratelimit") || k === "retry-after"),
  );
  return { status: res.status, limitHdrs, json: await res.json().catch(() => null) };
}

function summarize(json: any): string {
  if (!json?.content) return JSON.stringify(json)?.slice(0, 400) ?? "null";
  const kinds = json.content.map((b: any) => {
    if (b.type === "server_tool_use") return `server_tool_use(${b.name})`;
    if (b.type === "web_search_tool_result") {
      const c = b.content;
      return Array.isArray(c) ? `web_search_tool_result[${c.length} results]` : `web_search_tool_result(ERROR ${c?.error_code})`;
    }
    if (b.type === "web_fetch_tool_result") {
      const c = b.content;
      if (c?.type === "web_fetch_result") {
        const doc = c.content;
        const len = doc?.source?.data?.length ?? doc?.source?.text?.length ?? JSON.stringify(doc).length;
        return `web_fetch_tool_result(url=${c.url}, doc~${len}ch, retrieved_at=${c.retrieved_at ?? "?"})`;
      }
      return `web_fetch_tool_result(ERROR ${c?.error_code})`;
    }
    if (b.type === "text") return `text(${b.text.length}ch)`;
    return b.type;
  });
  return `stop=${json.stop_reason} usage.srv=${JSON.stringify(json.usage?.server_tool_use ?? null)} blocks=[${kinds.join(", ")}]`;
}

function report(label: string, r: { status: number; limitHdrs: Record<string, string>; json: any }) {
  const hdrs = Object.keys(r.limitHdrs).length ? ` limitHdrs=${JSON.stringify(r.limitHdrs)}` : " limitHdrs=NONE";
  console.log(`${label}: HTTP ${r.status}${r.status !== 200 ? hdrs : ""} — ${r.status === 200 ? summarize(r.json) : JSON.stringify(r.json)?.slice(0, 300)}`);
}

async function main() {
  if (!creds.length) { console.log("NO CREDS — put CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY in CC-to-SDK/.env"); process.exit(1); }

  for (const cred of creds) {
    console.log(`\n===== credential: ${cred.label} =====`);

    // Q0: control — no tools at all. Distinguishes "server tools gated" from "direct API gated".
    report("Q0 plain(no tools)", await call(cred, {
      model: MODEL, max_tokens: 64,
      messages: [{ role: "user", content: "Say OK." }],
    }));
    await sleep(8000);

    // Q1+Q2: plain search, auto tool choice, prompt demands a search
    const search = await call(cred, {
      model: MODEL, max_tokens: 2048,
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 2 }],
      messages: [{ role: "user", content: "Search the web for the latest Anthropic model release and list the top result titles with URLs. You must use web_search." }],
    });
    report("Q1/Q2 search(auto)", search);
    if (search.status === 200) {
      const rb = search.json.content.find((b: any) => b.type === "web_search_tool_result");
      const first = Array.isArray(rb?.content) ? rb.content[0] : null;
      if (first) console.log(`  first result keys: ${Object.keys(first).join(",")} | title="${first.title?.slice(0, 60)}" url=${first.url}`);
    }
    await sleep(8000);

    // Q3: forced tool_choice on a server tool
    report("Q3 search(forced)", await call(cred, {
      model: MODEL, max_tokens: 1024,
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 1 }],
      tool_choice: { type: "tool", name: "web_search" },
      messages: [{ role: "user", content: "claude agent sdk changelog" }],
    }));
    await sleep(8000);

    // Q4: web_fetch of a URL present in the conversation
    report("Q4 fetch", await call(cred, {
      model: MODEL, max_tokens: 2048,
      tools: [{ type: "web_fetch_20260209", name: "web_fetch", max_uses: 1, max_content_tokens: 5000 }],
      messages: [{ role: "user", content: "Fetch https://docs.claude.com/en/docs/agents-and-tools/tool-use/web-fetch-tool and tell me the first heading. You must use web_fetch." }],
    }));
  }
}

main().catch((e) => { console.error("PROBE CRASH", e); process.exit(1); });
