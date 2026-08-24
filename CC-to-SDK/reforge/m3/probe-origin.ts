// M3-A probe — WHO strips a non-human origin: sdk.mjs or the engine?
// Measured through the wrapper, only {kind:"human"} survives onto the result
// frame; `peer` (a declared SDK kind) comes back null. That distinction is
// material for a reimplementation: if the wrapper strips it, engine-ts need not
// implement peer attribution at all; if the ENGINE strips it, engine-ts must
// reproduce the stripping (it is a trust boundary, not a cosmetic field).
//
// Run: cd reforge && set -a; . ../.env; set +a; unset ANTHROPIC_API_KEY; npx tsx m3/probe-origin.ts
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR } from "../src/harness.js";
import { startReplayProxy } from "../src/proxy.js";
import { enginePath, REFORGE_ROOT, SANDBOX } from "../src/runTurn.js";

const cassette = join(REFORGE_ROOT, "cassettes", "m1-plain.jsonl");
if (!existsSync(cassette)) {
  console.error("ABORT: plain cassette missing — run: npx tsx m1/run.ts --scenario plain");
  process.exit(1);
}

const ORIGINS = [
  { label: "human", origin: { kind: "human" } },
  { label: "peer", origin: { kind: "peer", from: "reforge-peer", fromMode: "bypass" } },
  { label: "channel", origin: { kind: "channel", server: "reforge-server" } },
  { label: "bogus", origin: { kind: "auto-continuation" } },
];

async function rawTurn(origin: unknown): Promise<{ origin: unknown; uuid: unknown }> {
  const proxy = await startReplayProxy(cassette);
  mkdirSync(SANDBOX, { recursive: true });
  const child = spawn(
    enginePath("engine-real"),
    ["--print", "--verbose", "--input-format", "stream-json", "--output-format", "stream-json",
     "--dangerously-skip-permissions", "--max-turns", "1", "--setting-sources", ""],
    {
      cwd: SANDBOX,
      env: {
        ...process.env,
        CLAUDE_CONFIG_DIR: CONFIG_DIR,
        ANTHROPIC_BASE_URL: `http://127.0.0.1:${proxy.port}`,
        DISABLE_TELEMETRY: "1",
        DISABLE_ERROR_REPORTING: "1",
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const uuid = "44444444-4444-4444-8444-444444444444";
  let buf = "";
  let result: { origin?: unknown; user_message_uuid?: unknown } | null = null;
  child.stdout.on("data", (c: Buffer) => {
    buf += c.toString("utf8");
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      try {
        const m = JSON.parse(line);
        if (m.type === "result") result = m;
      } catch {
        /* ignore */
      }
    }
  });
  child.stdin.write(
    JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "text", text: "Reply with exactly the single word SELFTEST_OK and nothing else." }] },
      parent_tool_use_id: null,
      uuid,
      origin,
      session_id: "",
    }) + "\n",
  );
  child.stdin.end();
  await new Promise<void>((r) => child.on("close", () => r()));
  await proxy.close();
  return { origin: result?.origin ?? null, uuid: result?.user_message_uuid ?? null };
}

console.log("=== M3-A probe: origin survival on the RAW stream-json path (no sdk.mjs) ===");
for (const { label, origin } of ORIGINS) {
  const got = await rawTurn(origin);
  const sent = JSON.stringify(origin);
  console.log(`  sent ${label.padEnd(8)} ${sent.padEnd(70)} -> result.origin = ${JSON.stringify(got.origin)}`);
}
console.log(
  "\nIf non-human kinds survive here but not through sdk.mjs, the WRAPPER strips them.\n" +
    "If they are null here too, the ENGINE strips them and engine-ts must reproduce that.",
);
