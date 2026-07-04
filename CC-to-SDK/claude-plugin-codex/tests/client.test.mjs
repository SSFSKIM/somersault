import test from "node:test"; import assert from "node:assert/strict";
import { workerBin } from "./_worker-bin.mjs";
const BIN = workerBin();
const ENV = { ...process.env, CC_APPSERVER_FAKE: "1", CLAUDE_COMPANION_APPSERVER: `node ${BIN}` };
const { spawnAppServer, resolveAppserverCommand } = await import("../plugins/claude-companion/scripts/lib/appserver-client.mjs");

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
test("close() resolves promptly when child already exited (review finding)", async () => {
  const client = await spawnAppServer({ cwd: process.cwd(), env: ENV });
  client.child.kill("SIGKILL");
  await new Promise((r) => client.child.once("exit", r));
  assert.equal(client.alive(), false);
  const start = Date.now();
  await Promise.race([
    client.close(),
    new Promise((_, rej) => setTimeout(() => rej(new Error("close() hung after child already exited")), 1500)),
  ]);
  assert.ok(Date.now() - start < 1500, "close() must not wait for the 2s SIGKILL fallback");
});
// Regression for the reviewer-found race: runTurn() only registers its notification collector
// (this.turns.set(turnId, t)) inside the turn/start reply's .then() — at least one microtask tick
// after the reply itself is dispatched. If a turn/start reply and that turn's own notifications
// (item/completed final_answer + turn/completed) ever arrive in ONE _feed() chunk, _dispatch runs
// them all synchronously in the same call, so the notifications used to hit the "not yet
// registered" gap and be silently dropped forever (runTurn() would never resolve). Reproduced here
// deterministically (no reliance on real OS-pipe timing): start the real runTurn() flow (so it sends
// a real turn/start request and attaches its real .then()), then — in the SAME synchronous tick,
// before any microtask (including that .then()) can run — feed a synthetic NDJSON chunk containing
// both the reply for that exact request id and that turn's notifications. That synthetic feed always
// wins the race against the real child's (slower, I/O-bound) reply.
test("runTurn survives a coalesced turn/start-reply + notifications chunk (review finding)", async () => {
  const client = await spawnAppServer({ cwd: process.cwd(), env: ENV });
  const { threadId } = await client.threadStart({ cwd: process.cwd(), write: false });
  const nextRequestId = client.nextId; // the id runTurn's turn/start request is about to claim
  const turnP = client.runTurn({ threadId, prompt: "hello" });
  const turnId = "turn_synthetic_race";
  const chunk = [
    JSON.stringify({ id: nextRequestId, result: { turn: { id: turnId, status: "inProgress" } } }),
    JSON.stringify({ method: "item/completed", params: { itemId: "item_1", threadId, turnId, item: { type: "agentMessage", text: "final text", phase: "final_answer" } } }),
    JSON.stringify({ method: "turn/completed", params: { turn: { id: turnId, status: "completed" } } }),
  ].join("\n") + "\n";
  client._feed(chunk); // synchronous — races ahead of the real child's async reply
  const result = await Promise.race([
    turnP,
    new Promise((_, rej) => setTimeout(() => rej(new Error("runTurn hung: notification race regression")), 1500)),
  ]);
  assert.equal(result.status, "completed");
  assert.equal(result.finalText, "final text");
  await client.close();
});
