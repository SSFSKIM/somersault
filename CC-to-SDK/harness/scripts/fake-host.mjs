#!/usr/bin/env node
// harness/scripts/fake-host.mjs — F10 T-SELECT S1 (step 1.21a): a keyless stand-in for a real ccx host,
// on the exact wire `ccx attach` speaks (src/host/wire.ts). It buys the busy/task-panel occupant cells
// (`caret-busy` in select-pty.sh) WITHOUT a model turn: `state.busy` is set only by the `turn`/`start`
// EVENT HANDLER (useChat.ts), and the task panel only by `tasks_changed`/`task` events — both reach the
// REPL over this socket whenever it runs as `ccx attach`, so a host that pushes them buys the cell.
//
// WHAT THIS DOES NOT PRETEND TO BE: a real engine. Every op reply below is the SMALLEST shape the REPL's
// own code accepts without throwing (read off `chatAdapter.ts` and `useChat.ts`, not guessed from the op
// table) — `whenFollowed()` only awaits ITS reply arriving, `capabilities()` degrades to the local-only
// palette on a failure OR an empty catalog, and neither `status` nor `pending` gates the composer's own
// mount. Anything this script gets wrong about an op's shape shows up as "ccx attach never reached a
// painted fullscreen REPL against the fake" in select-pty.sh, which is exactly the failure mode the task
// brief says to report rather than paper over.
//
// USAGE: CCX_FLEET_ROOT=<isolated root> FAKE_HOST_SCRIPT=turn-start,tasks:3 node scripts/fake-host.mjs
// Prints its own short id (`SHORT=<id>`) once the roster row is written and the socket is listening, so
// the caller can `ccx attach <that id>`. Holds the connection open until killed (SIGTERM/SIGINT).
import { createServer } from "node:net";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { writeRoster } from "../dist/fleet/roster.js";
import { hostSocketPath, mintShortId } from "../dist/fleet/paths.js";

const short = mintShortId(Math.random);
const pid = process.pid;
const cwd = process.cwd();

// A "working" (non-terminal) row: `prepareAttach` refuses any TERMINAL state outright (attach.ts), and
// `sessionId` is left UNSET on purpose — a set id sends `ccx attach` down `getSessionMessages` for a
// session that does not exist on disk, which is caught (falls back to a "no persisted history" notice)
// but is one more thing to get right for a cell that does not need it.
writeRoster({ short, pid, cwd, kind: "interactive", name: `fake-${short}`, state: "working", startedAt: Date.now() });

const socketPath = hostSocketPath(pid);
mkdirSync(dirname(socketPath), { recursive: true, mode: 0o700 });   // the `run/` dir — writeRoster only makes `roster/`
const ops = [];   // this run's own op log — printed on SIGTERM/SIGINT so a probe run can read back what the REPL asked for

/** The frames `FAKE_HOST_SCRIPT` can name, each producing zero or more `HostEvent`s (host/wire.ts). Kept
 *  to exactly what `caret-busy` needs: a live-turn spinner and a task panel, no model text at all. */
function framesFor(word) {
  const [name, arg] = word.split(":");
  if (name === "turn-start") return [{ kind: "turn", phase: "start", seq: 1 }];
  if (name === "turn-end") return [{ kind: "turn", phase: "end", seq: 1 }];
  if (name === "tasks") {
    const n = Number(arg) || 1;
    const out = [];
    for (let i = 1; i <= n; i++) {
      out.push({ kind: "message", data: { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "tool_use", id: `tu${i}`, name: "TaskCreate", input: { subject: `todo-item-${i}` } }] } } });
      out.push({ kind: "message", data: { type: "user", message: { content: [{ type: "tool_result", tool_use_id: `tu${i}`, content: `Task #${i} created successfully: todo-item-${i}` }] } } });
    }
    return out;
  }
  if (name === "message") return [{ kind: "message", data: { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: arg ?? "" }] } } }];
  return [];
}

const server = createServer((sock) => {
  let buf = "";
  let following = false;
  const send = (obj) => { try { sock.write(JSON.stringify(obj) + "\n"); } catch { /* socket already gone */ } };
  const pushEvent = (ev) => send({ t: "event", ...ev });

  sock.on("data", (chunk) => {
    buf += chunk.toString();
    for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      let req;
      try { req = JSON.parse(line); } catch { continue; }
      ops.push(req.op);
      // ONE MINIMAL REPLY SHAPE PER OP, each the smallest the REPL's own read site accepts (see the
      // module header). Anything not named here still gets `{ok:true, id}` — a request whose absence
      // would matter shows up as the REPL stalling, which is the probe's job to catch, not this script's
      // to guess at in advance.
      const base = { ok: true, id: req.id };
      if (req.op === "capabilities") send({ ...base, models: [], commands: [], mcpServers: [], agents: [] });
      else if (req.op === "status") send({ ...base, sessionId: undefined, busy: false, permissionMode: "default" });
      else if (req.op === "pending") send({ ...base, pending: [] });
      else if (req.op === "tasks") send({ ...base, tasks: [] });
      else if (req.op === "usage") send({ ...base, usage: {} });
      else if (req.op === "follow") {
        send(base);
        if (!following) {
          following = true;
          // After the FIRST follow ack, push the requested frames with a small delay between them — long
          // enough that the REPL's own effects (spinner mount, task-panel mount) settle between events
          // rather than coalescing into one render the pty cell could not tell apart from a single frame.
          const script = (process.env.FAKE_HOST_SCRIPT ?? "").split(",").map((s) => s.trim()).filter(Boolean);
          let delay = 300;
          for (const word of script) {
            for (const ev of framesFor(word)) { setTimeout(() => pushEvent(ev), delay); delay += 300; }
          }
        }
      } else send(base);
    }
  });
  sock.on("error", () => {});
});

server.listen(socketPath, () => {
  console.log(`SHORT=${short}`);
  console.log(`SOCKET=${socketPath}`);
});

function shutdown() {
  console.error(`OPS=${ops.join(",")}`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
