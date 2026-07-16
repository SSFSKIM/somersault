// W3.1 live: the harness `telemetry` config produces real OTLP export from the CLI subprocess
// (probe 51 proved the SDK layer; this proves OUR resolveOptions wiring end-to-end).
import { describe, it, expect } from "vitest";
import http from "node:http";
import { openSession } from "../../src/session/index.js";

const live = (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN) ? describe : describe.skip;

live("telemetry config → OTLP export (live)", () => {
  it("exports metrics + logs with session.id to the configured collector", async () => {
    const hits: { path: string; body: any }[] = [];
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        try { hits.push({ path: req.url ?? "?", body: JSON.parse(Buffer.concat(chunks).toString("utf8")) }); } catch { hits.push({ path: req.url ?? "?", body: null }); }
        res.writeHead(200, { "content-type": "application/json" }); res.end("{}");
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;

    const s = openSession({
      model: "claude-sonnet-4-6", permissionMode: "bypassPermissions", settingSources: [], maxTurns: 2,
      telemetry: { endpoint: `http://127.0.0.1:${port}`, protocol: "http/json", metricIntervalMs: 1000, logsIntervalMs: 1000 },
    });
    try {
      const { result } = await s.submit("Reply with exactly: OTEL-LIVE-OK");
      expect(String(result)).toContain("OTEL-LIVE-OK");
    } finally {
      await s.dispose();
    }
    // exporters flush around subprocess exit (probe 51) — give the tail a moment
    const deadline = Date.now() + 12_000;
    while (Date.now() < deadline && !(hits.some((h) => h.path === "/v1/metrics") && hits.some((h) => h.path === "/v1/logs")))
      await new Promise((r) => setTimeout(r, 300));
    server.close();

    expect(hits.some((h) => h.path === "/v1/metrics")).toBe(true);
    expect(hits.some((h) => h.path === "/v1/logs")).toBe(true);
    const names = new Set<string>();
    let sessionIdSeen = false;
    for (const h of hits) {
      if (h.path !== "/v1/metrics" || !h.body) continue;
      for (const rm of h.body.resourceMetrics ?? []) for (const sm of rm.scopeMetrics ?? []) for (const m of sm.metrics ?? []) {
        names.add(m.name);
        for (const dp of m.sum?.dataPoints ?? m.gauge?.dataPoints ?? []) if ((dp.attributes ?? []).some((a: any) => a.key === "session.id")) sessionIdSeen = true;
      }
    }
    expect([...names].some((n) => n.startsWith("claude_code."))).toBe(true);
    expect(sessionIdSeen).toBe(true);
  }, 120_000);
});
