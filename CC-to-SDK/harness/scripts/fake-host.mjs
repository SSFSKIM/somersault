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
  // bl5 T-LINKOPEN task 4 — FIRST-colon split, not `.split(":")`'s all-colons one: a `message:` payload
  // carrying a markdown link (`[text](https://host/path)`) has TWO more colons of its own (the `https:`
  // scheme, and none else here, but the general case is real), and the old `const [name, arg] =
  // word.split(":")` silently truncated `arg` at the SECOND colon — dropping everything from `//host/path`
  // onward. Every existing caller (`tasks:3`, `message:<text with no colon>`) has at most one colon, so this
  // is a strict widening, not a behavior change for them.
  const sep = word.indexOf(":");
  const name = sep === -1 ? word : word.slice(0, sep);
  const arg = sep === -1 ? undefined : word.slice(sep + 1);
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
  // bl5 T-LINKOPEN task 4 — a real `gh pr create` Bash call, scraped by `gitOps.ts`'s `recognizeGitOps` into
  // a linked `GitPrOp`, through the fold pipeline into ONE collapsed-cluster row whose clause reads
  // "Created PR #12" with an OSC-8 hyperlink on `#12` (the exact fixture `fullscreen-prlink.test.tsx`/
  // `hitmap.test.ts` pin — reused here verbatim so the pty cell exercises the same, already-proven wire
  // shape rather than an invented one). The closing prose message is the fold-run BREAKER
  // (`projectCompact`'s own rule: a trailing run stays pending, not `group:`-published, until something
  // after it closes it) — without it the cluster row never reaches Static at all.
  if (name === "prlink") {
    return [
      { kind: "message", data: { type: "assistant", parent_tool_use_id: null, message: { id: "m-bash-1", content: [{ type: "tool_use", id: "bash-1", name: "Bash", input: { command: "gh pr create --fill" } }] } } },
      { kind: "message", data: { type: "user", uuid: "u-bash-1", message: { content: [{ type: "tool_result", tool_use_id: "bash-1", content: "https://github.com/o/r/pull/12\n", is_error: false }] } } },
      { kind: "message", data: { type: "assistant", parent_tool_use_id: null, message: { id: "m-prlink-done", content: [{ type: "text", text: "pr done" }] } } },
    ];
  }
  // bl5 T-LINKOPEN task 4 — the hover-suppression producer, lifted verbatim from `test/tui/hover.test.tsx`'s
  // own `CLUSTER_BASH`/`NO_OUTPUT` fixture (the "T3 (b, review Critical)" cell): two `cat`-headed Bash calls
  // fold into ONE "read" cluster (`classifyBashCommand`'s `BASH_READ` set), the second's EMPTY result makes
  // `toolSummaries.ts`'s `bashRows` emit a genuinely dim `(No output)` row — content that (unlike an error's
  // "…+N lines" marker, or an ordinary fold's own marker) survives being re-projected at `detail-all` once
  // the cluster is expanded, which is exactly the state a hover-suppression assertion needs to not be
  // vacuous (that file's own review note: a fixture with nothing dim at `detail-all` cannot tell "hover
  // suppressed" from "there was never anything to un-dim"). The collapsed clause reads "Read 2 files".
  if (name === "errcluster") {
    return [
      { kind: "message", data: { type: "assistant", parent_tool_use_id: null, message: { id: "m-bash-c1", content: [{ type: "tool_use", id: "bash-c1", name: "Bash", input: { command: "cat a.txt" } }] } } },
      { kind: "message", data: { type: "user", uuid: "u-bash-c1", message: { content: [{ type: "tool_result", tool_use_id: "bash-c1", content: "line one", is_error: false }] } } },
      { kind: "message", data: { type: "assistant", parent_tool_use_id: null, message: { id: "m-bash-c2", content: [{ type: "tool_use", id: "bash-c2", name: "Bash", input: { command: "cat b.txt" } }] } } },
      { kind: "message", data: { type: "user", uuid: "u-bash-c2", message: { content: [{ type: "tool_result", tool_use_id: "bash-c2", content: "", is_error: false }] } } },
      { kind: "message", data: { type: "assistant", parent_tool_use_id: null, message: { id: "m-cluster-done", content: [{ type: "text", text: "cluster done" }] } } },
    ];
  }
  // bl5 T-LINKOPEN task 4 — the DISTRACTOR clickable owner for the hover-suppression cell: a standalone
  // (never fold-classified — "Mystery" claims no species in `toolFold.ts`) tool whose error result is 12
  // physical lines, one past `ERROR_PHYSICAL_ROWS` (ten), so `resultBody` stamps its gutter-block
  // `clickable: true` and renders a genuinely dim "… +2 lines" marker under the transcript's default
  // (collapsed) projection — the same fixture `hover-owner.test.tsx`/`hover.test.tsx`'s own T-CLICKGATE
  // cells use. Left un-clicked (never expanded) for the whole cell, so its marker stays dim until hovered.
  if (name === "mysteryerr") {
    const lines = Array.from({ length: 12 }, (_, i) => `err line ${i + 1}`).join("\n");
    return [
      { kind: "message", data: { type: "assistant", parent_tool_use_id: null, message: { id: "m-mystery-1", content: [{ type: "tool_use", id: "mystery-1", name: "Mystery", input: {} }] } } },
      { kind: "message", data: { type: "user", uuid: "u-mystery-1", message: { content: [{ type: "tool_result", tool_use_id: "mystery-1", content: lines, is_error: true }] } } },
      { kind: "message", data: { type: "assistant", parent_tool_use_id: null, message: { id: "m-mystery-done", content: [{ type: "text", text: "mystery done" }] } } },
    ];
  }
  return [];
}

// F10 T-SELECT S4c (step 6.8) — the `stream-shift` pty cell's second arm needs a frame to land AFTER the
// sweep it is testing is already in progress, which a script fixed at connect time (`FAKE_HOST_SCRIPT`)
// cannot produce. Every currently-following connection's own `pushEvent` is kept here so a line on THIS
// process's stdin — the same `word` syntax `FAKE_HOST_SCRIPT` uses, e.g. `message:more text` — can be
// pushed on demand: `tmux send-keys` into the fake host's own pane delivers it as a normal line, since
// nothing here puts the tty into raw mode.
const followers = new Set();
let stdinBuf = "";
process.stdin.on("data", (chunk) => {
  stdinBuf += chunk.toString();
  for (let nl = stdinBuf.indexOf("\n"); nl >= 0; nl = stdinBuf.indexOf("\n")) {
    const word = stdinBuf.slice(0, nl).trim(); stdinBuf = stdinBuf.slice(nl + 1);
    if (!word) continue;
    for (const ev of framesFor(word)) for (const push of followers) push(ev);
  }
});

const server = createServer((sock) => {
  let buf = "";
  let following = false;
  const send = (obj) => { try { sock.write(JSON.stringify(obj) + "\n"); } catch { /* socket already gone */ } };
  const pushEvent = (ev) => send({ t: "event", ...ev });
  sock.on("close", () => followers.delete(pushEvent));

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
          followers.add(pushEvent);
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
