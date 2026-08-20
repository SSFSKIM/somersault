// Probe 110 — Is Claude Code's native session-to-session messaging reachable from the SDK headless?
//
// Claude Code recently shipped a native SendMessage tool (model-callable) that delivers text to
// another of the user's sessions, with ListAgents as discovery. SDK 0.3.234 *declares the receive
// side* completely — SDKMessageOrigin 'peer' (from/fromMode/name/fromSession/verifiedPeerPid via a
// per-session cross-session messaging UDS), task-notification subkind 'peer-send-message', and the
// crossSessionInbound accept|hold|refuse setting. What sdk.d.ts CANNOT say is whether a headless
// SDK session (a) carries SendMessage/ListAgents in its tool catalog, (b) hosts the messaging
// socket so peers can reach it, (c) can discover and reach another same-user session. Declared !=
// reachable — this probe settles it.
//
// Phase 1 (structural): open session A, read the init frame's tools[] — are SendMessage/ListAgents
//   in the headless catalog at all?
// Phase 2 (behavioral, only if phase 1 finds them): keep session B idle in the same process; ask A
//   to ListAgents (raw result), then to SendMessage a marker to B; watch B's stream for an inbound
//   user message carrying the marker (and print its message.origin classification if present).
import { query } from "@anthropic-ai/claude-agent-sdk";

const MODEL = "claude-sonnet-4-5";
const MARKER = `XSESS-MARKER-${Date.now().toString(36).toUpperCase()}`;
const log = (...a: unknown[]) => console.log("[p110]", ...a);

function openStreaming(name: string) {
  let push: (() => void) | null = null;
  let done = false;
  const queue: unknown[] = [];
  async function* input() {
    while (!done) {
      if (queue.length) { yield queue.shift() as never; continue; }
      await new Promise<void>((r) => { push = () => { push = null; r(); }; });
    }
  }
  const q = query({ prompt: input() as never, options: { model: MODEL, permissionMode: "bypassPermissions", allowDangerouslySkipPermissions: true } as never });
  const send = (text: string) => { queue.push({ type: "user", message: { role: "user", content: [{ type: "text", text }] }, parent_tool_use_id: null, session_id: "" }); push?.(); };
  const end = () => { done = true; push?.(); };
  return { name, q, send, end };
}

const A = openStreaming("A");
const B = openStreaming("B");

let aInit: Record<string, unknown> | null = null;
let bSessionId = "";
let bInboundMarker: unknown = null;
const aToolUses: Array<{ name: string; input: unknown }> = [];
const aTexts: string[] = [];
const bOrigins: unknown[] = [];

(async () => {
  for await (const m of B.q) {
    const msg = m as Record<string, unknown>;
    if (msg.type === "system" && msg.subtype === "init") { bSessionId = String(msg.session_id); log("B init session_id:", bSessionId); }
    if (msg.type === "user") {
      const raw = JSON.stringify(msg);
      if ((msg as { origin?: unknown }).origin) bOrigins.push((msg as { origin?: unknown }).origin);
      if (raw.includes(MARKER)) { bInboundMarker = msg; log("B RECEIVED MARKER. origin:", JSON.stringify((msg as { origin?: unknown }).origin ?? "none")); }
    }
  }
})().catch((e) => log("B reader ended:", String(e)));

(async () => {
  for await (const m of A.q) {
    const msg = m as Record<string, unknown>;
    if (msg.type === "system" && msg.subtype === "init") {
      aInit = msg;
      const tools = (msg.tools as string[]) ?? [];
      log("A init. tools count:", tools.length);
      log("PHASE1 SendMessage in catalog:", tools.includes("SendMessage"));
      log("PHASE1 ListAgents in catalog:", tools.includes("ListAgents"));
      log("catalog (messaging-adjacent):", tools.filter((t) => /send|agent|list|message|notif/i.test(t)).join(", ") || "(none)");
      log("capabilities:", JSON.stringify((msg as { capabilities?: unknown }).capabilities ?? "absent"));
    }
    if (msg.type === "assistant") {
      const content = ((msg.message as Record<string, unknown>)?.content as Array<Record<string, unknown>>) ?? [];
      for (const b of content) {
        if (b.type === "tool_use") { aToolUses.push({ name: String(b.name), input: b.input }); log("A tool_use:", b.name, JSON.stringify(b.input).slice(0, 300)); }
        if (b.type === "text") aTexts.push(String(b.text));
      }
    }
    if (msg.type === "user") {
      const content = ((msg.message as Record<string, unknown>)?.content as Array<Record<string, unknown>>) ?? [];
      for (const b of content) if (b.type === "tool_result") log("A tool_result:", JSON.stringify(b.content).slice(0, 800));
    }
    if (msg.type === "result") log("A turn result:", msg.subtype);
  }
})().catch((e) => log("A reader ended:", String(e)));

// Drive it.
await new Promise((r) => setTimeout(r, 500));
B.send("Stay idle. Reply with just: STANDING BY. Do not use any tools.");
await new Promise((r) => setTimeout(r, 6000)); // let both inits land; B becomes addressable here if it ever will
A.send("Do exactly this and nothing else: call the ListAgents tool with no arguments, then report its raw result verbatim in your reply. If the tool does not exist, say TOOL-ABSENT.");
await new Promise((r) => setTimeout(r, 30000));
const listAgentsUsed = aToolUses.some((t) => t.name === "ListAgents");
log("PHASE2 ListAgents invoked:", listAgentsUsed, "| A text tail:", (aTexts.at(-1) ?? "").slice(0, 400));
if (listAgentsUsed || (aInit && ((aInit.tools as string[]) ?? []).includes("SendMessage"))) {
  A.send(`Call the SendMessage tool to send the exact text "${MARKER}" to the session with id "${bSessionId}" (use whatever to/recipient field the tool schema offers; if it takes a name instead of an id, call ListAgents first to find a peer and use its printed name). Then report the tool's raw result verbatim. If SendMessage does not exist, say TOOL-ABSENT.`);
  await new Promise((r) => setTimeout(r, 45000));
}
log("VERDICT PHASE1 catalog:", JSON.stringify({ send: ((aInit?.tools as string[]) ?? []).includes("SendMessage"), list: ((aInit?.tools as string[]) ?? []).includes("ListAgents") }));
log("VERDICT PHASE2 round-trip: marker received by B =", bInboundMarker !== null);
log("B origin classifications seen:", JSON.stringify(bOrigins).slice(0, 500));
A.end(); B.end();
setTimeout(() => process.exit(0), 3000);
