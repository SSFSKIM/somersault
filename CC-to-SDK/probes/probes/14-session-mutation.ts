// Probe 14 — SESSION-STORE MUTATION CRUD (P3). renameSession / tagSession / deleteSession are
// declared store fns (sdk.d.ts:2508/6335/535). This persists a session, then tags / renames /
// deletes it and re-lists to confirm each mutation lands headlessly against the default file
// store — including that deleteSession actually removes it. Fields are discovered, not assumed:
// we log the whole listed record and check membership of the tag/title string rather than a field.
import { query, listSessions, getSessionMessages, renameSession, tagSession, deleteSession } from "@anthropic-ai/claude-agent-sdk";
import { brief } from "../lib/runProbe.ts";

const MODEL = "claude-haiku-4-5-20251001";
const TAG = "PROBE-TAG-4417";
const TITLE = "PROBE-RENAMED-4417";

// 1) Create a persisted session; capture its id from init.
let sid: string | undefined;
for await (const m of query({ prompt: "Reply OK.", options: { model: MODEL, permissionMode: "bypassPermissions", maxTurns: 1 } })) {
  if (m.type === "system" && (m as any).subtype === "init") sid = (m as any).session_id;
  if ("result" in m) break;
}
console.log("=== PROBE 14 session mutation ===  sid:", sid);

const find = async (id: string) => (await listSessions()).find((s: any) => s.sessionId === id);
const before = sid ? await find(sid) : undefined;
console.log("after create — listed:", !!before, "record:", brief(before, 260));

// 2) tagSession
let tagErr: string | undefined;
try {
  await tagSession(sid!, TAG);
} catch (e: any) {
  tagErr = e.message;
}
const afterTag = sid ? await find(sid) : undefined;
const tagLanded = !!afterTag && JSON.stringify(afterTag).includes(TAG);
console.log("after tag —", tagErr ? `THREW ${tagErr}` : "ok", "| landed:", tagLanded, "| record:", brief(afterTag, 220));

// 3) renameSession
let renErr: string | undefined;
try {
  await renameSession(sid!, TITLE);
} catch (e: any) {
  renErr = e.message;
}
const afterRen = sid ? await find(sid) : undefined;
const titleLanded = !!afterRen && JSON.stringify(afterRen).includes(TITLE);
console.log("after rename —", renErr ? `THREW ${renErr}` : "ok", "| landed:", titleLanded, "| record:", brief(afterRen, 220));

// 4) deleteSession — destructive; confirm it is gone.
let delErr: string | undefined;
try {
  await deleteSession(sid!);
} catch (e: any) {
  delErr = e.message;
}
const afterDel = sid ? await find(sid) : undefined;
let msgsAfterDel: string;
try {
  const mm = await getSessionMessages(sid!);
  msgsAfterDel = `array[${mm.length}]`;
} catch (e: any) {
  msgsAfterDel = `THREW ${e.message}`;
}
console.log("after delete —", delErr ? `THREW ${delErr}` : "ok", "| still listed:", !!afterDel, "| getSessionMessages:", msgsAfterDel);

const pass = !!sid && !tagErr && tagLanded && !renErr && titleLanded && !delErr && !afterDel;
console.log(pass ? "RESULT: PASS (full CRUD)" : "RESULT: PARTIAL/FAIL — see lines above");
