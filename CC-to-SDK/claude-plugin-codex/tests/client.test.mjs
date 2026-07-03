import test from "node:test"; import assert from "node:assert/strict";
import path from "node:path"; import { fileURLToPath } from "node:url";
const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../app-server/dist/bin.js");
const ENV = { ...process.env, CC_APPSERVER_FAKE: "1", CLAUDE_COMPANION_APPSERVER: `node ${BIN}` };
const { spawnAppServer, resolveAppserverCommand } = await import("../plugins/claude/scripts/lib/appserver-client.mjs");

test("resolveAppserverCommand: env split; null when nothing", () => {
  assert.deepEqual(resolveAppserverCommand({ CLAUDE_COMPANION_APPSERVER: `node ${BIN}`, PATH: "" }), { command: "node", args: [BIN] });
  assert.equal(resolveAppserverCommand({ PATH: "/nonexistent" }), null);
});
test("threadStart + runTurn against fake bin", async () => {
  const client = await spawnAppServer({ cwd: process.cwd(), env: ENV });
  const { threadId } = await client.threadStart({ cwd: process.cwd(), write: false });
  assert.match(threadId, /^thr_[0-9a-f]{8}$/);
  const progress = [];
  const turn = await client.runTurn({ threadId, prompt: "hello", onProgress: (t) => progress.push(t) });
  assert.equal(turn.status, "completed"); assert.equal(turn.finalText, "final text");
  await client.close();
});
test("interrupt settles a HANG turn as failed", async () => {
  const client = await spawnAppServer({ cwd: process.cwd(), env: ENV });
  const { threadId } = await client.threadStart({ cwd: process.cwd(), write: false });
  const turnP = client.runTurn({ threadId, prompt: "please HANG" });
  await new Promise((r) => setTimeout(r, 50));
  await client.interrupt({ threadId });
  assert.equal((await turnP).status, "failed");
  await client.close();
});
test("child death rejects pending turns", async () => {
  const client = await spawnAppServer({ cwd: process.cwd(), env: ENV });
  const { threadId } = await client.threadStart({ cwd: process.cwd(), write: false });
  const turnP = client.runTurn({ threadId, prompt: "please HANG" });
  await new Promise((r) => setTimeout(r, 50));
  client.child.kill("SIGKILL");
  await assert.rejects(turnP, /appserver exited/);
});
