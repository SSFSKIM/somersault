// probes/probes/70-usermessage-uuid.ts — does a caller-supplied SDKUserMessage.uuid survive into the
// persisted transcript? (M2 spec probe 6; decides the gap-6 userMessage item id.)
// Run (controller, keyed): cd CC-to-SDK/probes && npx tsx probes/70-usermessage-uuid.ts
import { randomUUID } from "node:crypto";
import { query, getSessionMessages } from "@anthropic-ai/claude-agent-sdk";

const suppliedUuid = randomUUID();
async function* prompts(): AsyncGenerator<any> {
  yield {
    type: "user",
    uuid: suppliedUuid, // the field under test — sdk.d.ts declares uuid?: string on SDKUserMessage
    session_id: "",
    parent_tool_use_id: null,
    message: { role: "user", content: "Reply with exactly: ok" },
  };
}

let sessionId = "";
const q = query({
  prompt: prompts(),
  options: {
    settingSources: [],
    permissionMode: "bypassPermissions",
    model: "claude-haiku-4-5-20251001",
  },
});
for await (const m of q as AsyncIterable<any>) {
  if (m.type === "system" && m.subtype === "init") sessionId = m.session_id;
  if (m.type === "result") break;
}
await new Promise((r) => setTimeout(r, 1500)); // transcript is written at/after turn end (probe 62)
const rows: any[] = (await getSessionMessages(sessionId)) as any[];
const userRows = rows.filter((r: any) => r.type === "user");
const match = userRows.find((r: any) => r.uuid === suppliedUuid);
console.log(
  JSON.stringify(
    {
      sessionId,
      suppliedUuid,
      persistedUserUuids: userRows.map((r: any) => r.uuid),
      verdict: match ? "ALIVE — supplied uuid persisted" : "DEAD — CLI re-minted the uuid",
    },
    null,
    2,
  ),
);
