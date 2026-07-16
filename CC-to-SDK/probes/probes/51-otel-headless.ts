// Probe 51 — OpenTelemetry headless emission (the Wave 3 flagship premise).
//
// Declared surface: the 2.1.211 CLI binary contains CLAUDE_CODE_ENABLE_TELEMETRY + the OTEL_* env
// gates (exporters, intervals, OTEL_METRICS_INCLUDE_SESSION_ID, CLAUDE_CODE_OTEL_HEADERS_HELPER),
// and sdk.d.ts says hook `prompt.id` joins OTel events at prompt grain. NEVER runtime-verified.
// Questions:
//   1. Does an env-gated headless session export OTLP metrics? logs? traces?
//   2. What metric names / log event names arrive? Are session.id / prompt.id attributes present?
//   3. Does the exporter flush on session end (short-lived headless runs are the risky case)?
// Gotcha guarded: options.env REPLACES the subprocess env — spread process.env in.
import http from "node:http";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { brief } from "../lib/runProbe.ts";

console.log("=== PROBE 51 OTel headless ===");
setTimeout(() => { console.log("\n!!! GLOBAL WATCHDOG (240s) — probe wedged, exiting"); process.exit(2); }, 240_000).unref?.();

type Hit = { path: string; body: any };
const hits: Hit[] = [];
const server = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    let body: any = null;
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { body = `<non-json ${Buffer.concat(chunks).length}B ct=${req.headers["content-type"]}>`; }
    hits.push({ path: req.url ?? "?", body });
    console.log("[collector]", req.method, req.url, typeof body === "string" ? body : `json ${Buffer.concat(chunks).length}B`);
    res.writeHead(200, { "content-type": "application/json" }); res.end("{}");
  });
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const port = (server.address() as any).port;
console.log("[collector] listening on", port);

const handle = query({
  prompt: "Run this bash command: echo otel-probe-51. Then reply with exactly: DONE",
  options: {
    model: "claude-sonnet-4-6", permissionMode: "bypassPermissions", maxTurns: 4, settingSources: [],
    env: {
      ...process.env,
      CLAUDE_CODE_ENABLE_TELEMETRY: "1",
      OTEL_METRICS_EXPORTER: "otlp", OTEL_LOGS_EXPORTER: "otlp", OTEL_TRACES_EXPORTER: "otlp",
      OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
      OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${port}`,
      OTEL_METRIC_EXPORT_INTERVAL: "1000", OTEL_LOGS_EXPORT_INTERVAL: "1000",
      OTEL_METRICS_INCLUDE_SESSION_ID: "true",
    },
  } as any,
});
for await (const m of handle as any) {
  if (m.type === "system" && m.subtype === "init") console.log("[init] session", m.session_id);
  if (m.type === "result") console.log("[result]", m.subtype, "|", brief(m.result, 100));
}
console.log("[session done] waiting 10s for post-exit flush…");
await new Promise((r) => setTimeout(r, 10_000));
server.close();

// ---- analyze ----
const byPath = new Map<string, any[]>();
for (const h of hits) { const a = byPath.get(h.path) ?? []; a.push(h.body); byPath.set(h.path, a); }
const metricNames = new Set<string>(); const logEvents = new Set<string>(); const spanNames = new Set<string>();
const attrs = new Set<string>();
const walkAttrs = (kvs: any[]) => { for (const kv of kvs ?? []) attrs.add(kv.key); };
for (const b of byPath.get("/v1/metrics") ?? []) if (typeof b === "object")
  for (const rm of b.resourceMetrics ?? []) { walkAttrs(rm.resource?.attributes); for (const sm of rm.scopeMetrics ?? []) for (const met of sm.metrics ?? []) { metricNames.add(met.name); for (const dp of met.sum?.dataPoints ?? met.gauge?.dataPoints ?? met.histogram?.dataPoints ?? []) walkAttrs(dp.attributes); } }
for (const b of byPath.get("/v1/logs") ?? []) if (typeof b === "object")
  for (const rl of b.resourceLogs ?? []) for (const sl of rl.scopeLogs ?? []) for (const lr of sl.logRecords ?? []) { const ev = (lr.attributes ?? []).find((a: any) => a.key === "event.name")?.value?.stringValue; logEvents.add(ev ?? (typeof lr.body?.stringValue === "string" ? lr.body.stringValue.slice(0, 40) : "?")); walkAttrs(lr.attributes); }
for (const b of byPath.get("/v1/traces") ?? []) if (typeof b === "object")
  for (const rs of b.resourceSpans ?? []) for (const ss of rs.scopeSpans ?? []) for (const sp of ss.spans ?? []) spanNames.add(sp.name);

console.log("\n=== VERDICT ===");
for (const [p, bodies] of byPath) console.log(`[signal] ${p}: ${bodies.length} export(s)`);
console.log("[metrics]", metricNames.size ? `✅ ${brief([...metricNames], 400)}` : "❌ none");
console.log("[logs/events]", logEvents.size ? `✅ ${brief([...logEvents], 400)}` : "❌ none");
console.log("[traces]", spanNames.size ? `✅ ${brief([...spanNames], 300)}` : "— none (docs: metrics+events only)");
console.log("[attr keys seen]", brief([...attrs].filter((k) => /session|prompt|user|model|terminal|app/.test(k)), 400));
if (metricNames.size || logEvents.size) console.log("REACHABLE ✅ — env-gated OTLP export works headlessly.");
else console.log("NOT REACHED ❌ — no OTLP hit the collector (gate dead headless, or flush lost).");
process.exit(0);
