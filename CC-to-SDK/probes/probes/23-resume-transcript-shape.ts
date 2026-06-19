// Probe 23 — session resume TRANSCRIPT shape (for chat REPL increment 9 / runway F).
// Increment 9 wants to (a) RENDER the prior conversation on resume (via getSessionMessages) and (b) pick the
// MOST-RECENT session for --continue//continue (via listSessions). Both hinge on shapes the chat's render.ts /
// SessionPicker must consume. This captures, against a fresh persisted session in a scoped cwd:
//   1. getSessionMessages(id,{dir}) → the persisted SessionMessage[] shape: is it {type,message:{content[...]}}
//      like the LIVE stream (so render.ts can consume it directly), and does it include tool_use/tool_result?
//   2. listSessions({dir,limit}) → SDKSessionInfo fields (id? timestamp? a preview/summary/first-prompt?) and
//      ORDERING (is [0] the most-recent → drives --continue///continue).
//   3. resume → does the resumed query report a session_id equal to the original (so we can getSessionMessages it)?
import { query, getSessionMessages, listSessions } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brief } from "../lib/runProbe.ts";

const dir = mkdtempSync(join(tmpdir(), "probe23-"));
writeFileSync(join(dir, "fact.txt"), "The codeword is GRANITE.\n");

async function run(prompt: string, options: Record<string, unknown>) {
  const messages: any[] = []; let result: any; let sessionId: string | undefined;
  for await (const m of query({ prompt, options: { permissionMode: "bypassPermissions", cwd: dir, maxTurns: 3, ...options } })) {
    messages.push(m);
    if (m.type === "system" && (m as any).subtype === "init") sessionId = (m as any).session_id;
    if ("result" in m) result = m;
  }
  return { messages, result, sessionId };
}

console.log("=== PROBE 23 resume transcript shape ===");
console.log("cwd:", dir);

// Turn 1: a prompt that forces a tool_use (Read) so the transcript has a tool round-trip to inspect.
const t1 = await run("Read the file fact.txt in the current directory and tell me the codeword. Then reply OK.", { maxTurns: 3 });
const sid = t1.sessionId!;
console.log("\n[1] turn1 session_id:", sid, "| result.subtype:", t1.result?.subtype);

// 2. Read the persisted transcript back.
const msgs: any[] = await getSessionMessages(sid, { dir } as any);
console.log("\n[2] getSessionMessages → count:", msgs.length);
console.log("    message type discriminators (in order):", msgs.map((m) => m.type).join(", "));
for (let i = 0; i < msgs.length; i++) {
  const m = msgs[i];
  const inner = m.message ?? m;
  const content = inner?.content;
  const blocks = Array.isArray(content) ? content.map((b: any) => b.type ?? typeof b).join("+") : typeof content;
  console.log(`    [${i}] type=${m.type} role=${inner?.role ?? "-"} keys={${Object.keys(m).join(",")}} contentBlocks=[${blocks}]`);
}
console.log("\n[2b] FULL shape of first user + first assistant message:");
const firstUser = msgs.find((m) => m.type === "user");
const firstAsst = msgs.find((m) => m.type === "assistant");
console.log("    first user:", brief(firstUser, 800));
console.log("    first assistant:", brief(firstAsst, 1000));
const toolUse = msgs.find((m) => Array.isArray(m.message?.content) && m.message.content.some((b: any) => b.type === "tool_use"));
const toolRes = msgs.find((m) => Array.isArray(m.message?.content) && m.message.content.some((b: any) => b.type === "tool_result"));
console.log("    has tool_use message:", !!toolUse, "| has tool_result message:", !!toolRes);

// 3. listSessions ordering + fields.
const list: any[] = await listSessions({ dir, limit: 5 } as any);
console.log("\n[3] listSessions(dir) → count:", list.length);
console.log("    [0] (claimed most-recent) keys:", list[0] ? Object.keys(list[0]).join(",") : "(none)");
console.log("    [0] full:", brief(list[0], 700));
console.log("    our session at index:", list.findIndex((s) => (s.id ?? s.sessionId ?? s.session_id) === sid));

// 4. Resume → does the resumed query's init report the same session id?
const t2 = await run("What was the codeword? Reply with just the word.", { resume: sid });
console.log("\n[4] resume → resumed init session_id:", t2.sessionId, "| equals original:", t2.sessionId === sid);
console.log("    recall ok:", String(t2.result?.result || "").toUpperCase().includes("GRANITE"));
process.exit(0);
