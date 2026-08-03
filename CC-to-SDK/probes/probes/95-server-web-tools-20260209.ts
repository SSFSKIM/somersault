// Probe 95 — can the harness call web_search_20260209 / web_fetch_20260209 directly?
// Questions:
//   Q1  Does a direct POST /v1/messages work with CLAUDE_CODE_OAUTH_TOKEN (Bearer + oauth beta)?
//   Q2  Does web_search_20260209 run under those creds, and what do the result blocks look like?
//   Q3  Can a server tool be forced via tool_choice {type:"tool", name:"web_search"}?
//   Q4  Does web_fetch_20260209 fetch a URL present in the conversation, and what comes back?
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

async function call(cred: Cred, body: object): Promise<{ status: number; json: any }> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "anthropic-version": "2023-06-01", ...cred.headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
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

async function main() {
  if (!creds.length) { console.log("NO CREDS — put CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY in CC-to-SDK/.env"); process.exit(1); }

  for (const cred of creds) {
    console.log(`\n===== credential: ${cred.label} =====`);

    // Q1+Q2: plain search, auto tool choice, prompt demands a search
    const search = await call(cred, {
      model: MODEL, max_tokens: 2048,
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 2 }],
      messages: [{ role: "user", content: "Search the web for the latest Anthropic model release and list the top result titles with URLs. You must use web_search." }],
    });
    console.log(`Q1/Q2 search(auto): HTTP ${search.status} — ${search.status === 200 ? summarize(search.json) : JSON.stringify(search.json)?.slice(0, 300)}`);
    if (search.status === 200) {
      const rb = search.json.content.find((b: any) => b.type === "web_search_tool_result");
      const first = Array.isArray(rb?.content) ? rb.content[0] : null;
      if (first) console.log(`  first result keys: ${Object.keys(first).join(",")} | title="${first.title?.slice(0, 60)}" url=${first.url}`);
    }

    // Q3: forced tool_choice on a server tool
    const forced = await call(cred, {
      model: MODEL, max_tokens: 1024,
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 1 }],
      tool_choice: { type: "tool", name: "web_search" },
      messages: [{ role: "user", content: "claude agent sdk changelog" }],
    });
    console.log(`Q3 search(forced): HTTP ${forced.status} — ${forced.status === 200 ? summarize(forced.json) : JSON.stringify(forced.json)?.slice(0, 300)}`);

    // Q4: web_fetch of a URL present in the conversation
    const fetchRes = await call(cred, {
      model: MODEL, max_tokens: 2048,
      tools: [{ type: "web_fetch_20260209", name: "web_fetch", max_uses: 1, max_content_tokens: 5000 }],
      messages: [{ role: "user", content: "Fetch https://docs.claude.com/en/docs/agents-and-tools/tool-use/web-fetch-tool and tell me the first heading. You must use web_fetch." }],
    });
    console.log(`Q4 fetch: HTTP ${fetchRes.status} — ${fetchRes.status === 200 ? summarize(fetchRes.json) : JSON.stringify(fetchRes.json)?.slice(0, 300)}`);
  }
}

main().catch((e) => { console.error("PROBE CRASH", e); process.exit(1); });
