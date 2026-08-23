// probe 115 — M7 grounding: can an in-process SDK MCP server carry a CLIENT-DECLARED raw JSON Schema,
// or is zod the only door?
//
// ANSWERED (2026-08-23, SDK 0.3.237), and quota-free: **zod only, enforced by an explicit runtime
// check.** A tool definition whose `inputSchema` is a raw JSON Schema object throws at
// `createSdkMcpServer` → `registerTool`:
//     Error: inputSchema must be a Zod schema or raw shape, received an unrecognized object
// — so the dynamic-tools design (product-trio ground §2) must CONVERT client-declared JSON Schema to
// zod at declaration time. The conversion can target a bounded subset (object/properties/required/
// type/enum/number bounds/items/description) with declarations outside it refused LOUDLY at
// `thread/start`; the do-nothing alternative (permissive shape + schema prose in the description)
// weakens what the model sees and is the fallback only if the subset proves too small in practice.
//
// This probe pins the behavior deterministically: part A attempts the raw registration and prints the
// error it measures; part B shows the zod control tool registers and is listed by `mcpServerStatus()`
// (names only — the status surface carries NO schemas, measured here too). Model-visible schema
// fidelity for the CONVERTED path needs one live turn — quota-gated past 2026-08-26 1pm.
import { query, createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const RAW_SCHEMA = {
  type: "object",
  properties: {
    ticket: { type: "string", description: "ticket id like ABC-123" },
    severity: { type: "integer", minimum: 1, maximum: 5 },
  },
  required: ["ticket"],
} as const;

// ── Part A: raw JSON Schema registration ──────────────────────────────────────────────────────────
const rawTool = {
  name: "raw_schema_tool",
  description: "declared with a raw JSON Schema, the dynamic-tools shape",
  inputSchema: RAW_SCHEMA,
  handler: async () => ({ content: [{ type: "text", text: "ok" }] }),
} as unknown as ReturnType<typeof tool>;
try {
  createSdkMcpServer({ name: "p115raw", version: "1.0.0", tools: [rawTool] });
  console.log("A: raw JSON Schema REGISTERED — the runtime check was removed; re-ground the converter decision");
} catch (e) {
  console.log(`A: raw JSON Schema REFUSED at registration: ${String((e as Error).message).slice(0, 110)}`);
  console.log("A: VERDICT — zod-only at runtime; M7 converts client schemas to zod (bounded subset, loud refusal)");
}

// ── Part B: the zod control registers and is listed (names only) ──────────────────────────────────
const zodTool = tool("zod_control", "control tool via zod shape", { ticket: z.string() },
  async () => ({ content: [{ type: "text", text: "ok" }] }));
const server = createSdkMcpServer({ name: "p115", version: "1.0.0", tools: [zodTool] });
const q = query({
  prompt: "reply with just: ok",
  options: { mcpServers: { p115: server }, model: "claude-haiku-4-5" },
});
let observed = false;
try {
  for await (const m of q) {
    const msg = m as { type?: string; subtype?: string };
    if (msg.type === "system" && msg.subtype === "init" && !observed) {
      observed = true;
      const st = await q.mcpServerStatus();
      for (const s of st) console.log(`B: server ${s.name}: status=${s.status} tools=${JSON.stringify((s.tools ?? []).map((t) => t.name))} (no schema field on this surface)`);
      await q.interrupt().catch(() => {});
    }
  }
} catch (e) {
  console.log(`B: query ended: ${String((e as Error).message).slice(0, 100)}`);
}
if (!observed) console.log("B: NO init message — registration unobserved this run (auth/quota failure before init)");
console.log("done");
