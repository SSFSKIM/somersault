// W7 probe — WHICH control-request subtypes the headless engine actually
// dispatches, measured one subtype at a time on the no-wrapper wire.
//
//   cd reforge && npx tsx w7/probe-control-subtypes.ts [--only <subtype>]
//
// Campaign spec C10 / the live-probe-first discipline. Offline: every session
// runs against the replay proxy over the raw driver's own cassette, so this
// costs nothing and can be re-run at will.
//
// ---------------------------------------------------------------------------
// THE POPULATION UNDER TEST IS NOT CHOSEN HERE.
//
// This is C8's twice-proven lesson applied before the mistake rather than after
// it. W5's hook probe got its answer wrong twice, and both times the error was
// upstream of the measurement: the tester wrote the list of things to watch, so
// a thing nobody thought of could not be measured as absent. W7's own scout made
// the same shape of error one level out — it counted "55 arms" and "~39 sendable
// subtypes" by reading, and both numbers were wrong.
//
// So the population comes from `research/fixtures/control-protocol-<pin>.json`,
// which derives it from two artifacts that share no machinery: the engine's own
// dispatch ladder (found by shape, confirmed by the `control_request` guard it
// sits under) and the installed SDK's sendable set. The gate re-derives it every
// run. Nothing about which subtypes "seem reachable" is decided in this file.
//
// ---------------------------------------------------------------------------
// EVERY VERDICT NAMES ITS CONDITION, and there are three of them:
//
//   FIRED  — a `control_response` came back for this subtype's request id. The
//            arm ran. A REFUSAL counts: an arm that validates its input and
//            answers with its own sentence has run just as much as one that
//            succeeds, and the response records which.
//   DEAD   — the frame WAS sent, the session completed, and no response for it
//            ever arrived. The arm was reached and answered nothing.
//   OPEN   — the frame was deliberately not sent, or it was sent and the session
//            did not finish inside its bound. Nothing is claimed either way.
//            OPEN is a STATE, not a verdict: a row leaves it the moment someone
//            creates the condition it names.
//
// A NEGATIVE IS ONLY EVIDENCE IF THE HEALTHY CASE WOULD HAVE PRODUCED A
// DIFFERENT ONE, so the run opens with two controls and refuses to report
// anything if either fails: a subtype that must answer (`get_binary_version`)
// and a fabricated one that must reach the ladder's terminal `else`. Without
// them a broken driver would report fifty-two DEADs and look like a finding.
// That is the vacuous-positive shape C9 found in the gate's own liveness read.
//
// WHY MOST OF THE LADDER IS OPEN AND THAT IS THE HONEST ANSWER. Sixteen of the
// fifty-two arms serve subtypes no installed SDK can even send, and a further
// dozen reach outside the harness — an OAuth browser flow, a relay socket, a
// feedback endpoint, a second model call. Sending those would not measure this
// engine, it would measure the operator's network. Each one carries a written
// reason naming what creating its condition would cost.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { startReplayProxy } from "../src/proxy.js";
import { enginePath, REFORGE_ROOT, SANDBOX, sdkEnv } from "../src/runTurn.js";
import { readFixture } from "../research/tools/extract-control-protocol.js";

const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : undefined;

/** How long one single-subtype session may take before it counts as OPEN. */
const SESSION_TIMEOUT_MS = 25_000;

/**
 * The per-subtype request body, and — for the rows this probe deliberately does
 * NOT send — the reason.
 *
 * `send: null` is never a negative. It means "the condition is named and not
 * created", and the reason has to say what creating it would take. `firedIn`
 * records where the campaign HAS created it, so a row that this probe declines
 * to send can still be FIRED on someone else's evidence.
 */
interface SubtypeCase {
  /** the request payload, or null when this probe deliberately does not send it */
  send: Record<string, unknown> | null;
  /** what the row's firing condition IS — printed either way */
  condition: string;
  /** where else in the campaign the condition was created and observed */
  firedIn?: string;
}

const CASES: Record<string, SubtypeCase> = {
  // ---- the wave's owned handlers, all also graded by the raw driver ---------
  initialize: { send: {}, condition: "any host handshake", firedIn: "m2/raw-protocol.ts case `initialize`; every SDK-driven corpus scenario" },
  set_permission_mode: { send: { mode: "default" }, condition: "a mode change over the channel", firedIn: "m2/raw-protocol.ts cases `set_permission_mode-{valid,invalid}`; corpus `runtime-setters`, `perm-mode-walk`" },
  set_model: { send: { model: "haiku" }, condition: "a model change over the channel", firedIn: "m2/raw-protocol.ts cases `set_model-{valid,invalid}`" },
  set_max_thinking_tokens: { send: { max_thinking_tokens: 2048, thinking_display: "summarized" }, condition: "a thinking-budget change", firedIn: "m2/raw-protocol.ts cases `set_max_thinking_tokens-{valid,invalid}`" },

  // ---- read-only queries ---------------------------------------------------
  get_binary_version: { send: {}, condition: "any host asking the version", firedIn: "m2/raw-protocol.ts case `get_binary_version`" },
  get_settings: { send: {}, condition: "any host reading settings" },
  get_session_cost: { send: {}, condition: "any host reading cost" },
  get_usage: { send: {}, condition: "any host reading usage" },
  list_models: { send: {}, condition: "any host listing models" },
  mcp_status: { send: {}, condition: "any host reading MCP status" },
  // FIRED ON THE ARM, UNREACHED ON THE EFFECT — and the two are worth separating
  // because "answered success" reads as full coverage and is not (W8a, 2026-09-03).
  // The probe sends this against an EMPTY task registry, so what it proves is
  // that the handler is dispatched and answers; the listing it exists to
  // produce has never been rendered with a row in it. The condition for that is
  // TWO things at once, which no scenario creates: one running background task
  // (a `Bash` call with `run_in_background`, or a backgrounded `Agent`) AND a
  // control frame asking for the list while it is still running. C13e owns it.
  background_tasks: { send: {}, condition: "a host listing background tasks; the ARM needs only the frame, the EFFECT needs one running background task alongside it" },
  get_plan: { send: {}, condition: "any host reading the current plan" },
  get_workspace_diff: { send: {}, condition: "any host reading the workspace diff" },
  file_suggestions: { send: { query: "READ" }, condition: "any host asking for file completions" },
  read_file: { send: { path: "does-not-exist.txt" }, condition: "any host reading a file through the channel" },
  get_context_usage: {
    send: null,
    condition: "any host asking for context usage",
    firedIn: "m2/raw-protocol.ts case `get_context_usage`, whose cassette carries the twenty-one count_tokens calls the handler makes",
  },

  // ---- session and workspace mutations ------------------------------------
  set_cwd: { send: { cwd: SANDBOX }, condition: "a host relocating the session" },
  add_directory: { send: { path: SANDBOX }, condition: "a host widening the allowed directories" },
  register_repo_root: { send: { path: SANDBOX }, condition: "a host declaring the repo root" },
  stage_file: { send: { path: "does-not-exist.txt" }, condition: "a host staging a file" },
  seed_read_state: { send: { files: [] }, condition: "a host seeding the read-state cache" },
  rename_session: { send: { title: "reforge probe" }, condition: "a host renaming the session" },
  rewind_files: { send: { user_message_id: "no-such-uuid", dry_run: true }, condition: "a host rewinding tracked files" },
  rewind_conversation: { send: { user_message_id: "no-such-uuid" }, condition: "a host rewinding the transcript" },
  cancel_async_message: { send: { message_id: "no-such-id" }, condition: "a host cancelling a queued message" },
  stop_task: { send: { task_id: "no-such-task" }, condition: "a host stopping a background task" },
  poll_event: { send: {}, condition: "a host polling for events" },
  interrupt: { send: {}, condition: "a host interrupting the turn", firedIn: "corpus scenario `interrupt`" },
  end_session: { send: { reason: "probe" }, condition: "a host ending the session" },

  // ---- MCP -----------------------------------------------------------------
  mcp_message: { send: { server_name: "no-such-server", message: { jsonrpc: "2.0", method: "ping" } }, condition: "a host relaying a JSON-RPC frame to an SDK MCP server", firedIn: "corpus scenario `mcp-tool`" },
  mcp_set_servers: { send: { servers: {} }, condition: "a host replacing the MCP server set" },
  mcp_reconnect: { send: { server_name: "no-such-server" }, condition: "a host reconnecting an MCP server" },
  mcp_toggle: { send: { server_name: "no-such-server", enabled: false }, condition: "a host enabling/disabling an MCP server" },
  mcp_call: { send: { server_name: "no-such-server", tool_name: "x", arguments: {} }, condition: "a host calling an MCP tool directly" },
  mcp_clear_auth: { send: { server_name: "no-such-server" }, condition: "a host clearing an MCP server's stored auth" },
  set_mcp_permission_mode_override: { send: { serverName: "no-such-server", mode: "default" }, condition: "a host overriding one server's permission mode" },
  reload_plugins: { send: {}, condition: "a host reloading plugins" },
  reload_skills: { send: {}, condition: "a host reloading skills" },

  // ---- deliberately NOT created, each with what it would cost --------------
  claude_authenticate: {
    send: null,
    condition: "a host starting the first-party OAuth flow",
    // (the reason is printed from NOT_CREATED below)
  },
  claude_oauth_callback: { send: null, condition: "the browser redirect landing back on the engine" },
  claude_oauth_wait_for_completion: { send: null, condition: "a host waiting out an in-flight OAuth flow" },
  mcp_authenticate: { send: null, condition: "a host starting an MCP server's OAuth flow" },
  mcp_oauth_callback_url: { send: null, condition: "the MCP OAuth redirect landing back on the engine" },
  remote_control: { send: null, condition: "a host driving the session over the remote-control relay" },
  channel_enable: { send: null, condition: "a host opening the remote channel" },
  remote_tools_announce: { send: null, condition: "a remote peer announcing its tool set" },
  register_device_hooks: { send: null, condition: "a host registering device-side hook templates" },
  upload_device_hook_template: { send: null, condition: "a host uploading a device hook template" },
  submit_feedback: { send: null, condition: "a host submitting feedback" },
  message_rated: { send: null, condition: "a host rating an assistant message" },
  generate_session_title: { send: null, condition: "a host asking the model to name the session" },
  side_question: { send: null, condition: "a host asking a side question" },
  ultrareview_launch: { send: null, condition: "a host launching an ultrareview" },
  apply_flag_settings: { send: null, condition: "a host pushing a flag-settings payload" },
};

/** Why each un-sent row is un-sent. Kept apart so a reason cannot be silently dropped. */
const NOT_CREATED: Record<string, string> = {
  claude_authenticate: "starts an OAuth flow against the first-party console, outside the proxied base URL — sending it would measure the operator's network, not this engine",
  claude_oauth_callback: "only meaningful as the second half of the flow above",
  claude_oauth_wait_for_completion: "only meaningful as the second half of the flow above",
  mcp_authenticate: "starts an MCP server's OAuth flow, which needs a real server and a browser redirect",
  mcp_oauth_callback_url: "only meaningful as the second half of the flow above",
  remote_control: "opens a relay socket to a remote-control service; the 7 KB arm is the largest in the ladder and every path in it leaves the harness",
  channel_enable: "opens the same remote channel",
  remote_tools_announce: "needs a remote peer on that channel",
  register_device_hooks: "device hook templates are the remote-device surface the W5 scout measured off the headless path entirely",
  upload_device_hook_template: "same surface",
  submit_feedback: "POSTs to a feedback endpoint the replay cassette does not serve; a miss hangs the session rather than answering",
  message_rated: "same endpoint",
  generate_session_title: "makes its own model call — a live recording, for one title",
  side_question: "makes its own model call, and a two-stage one",
  ultrareview_launch: "launches a review agent, which is a whole subagent run",
  apply_flag_settings: "pushes the feature-gate state, which §3.3 pins for the WHOLE corpus and X6 forbids a child changing — creating this condition would change the environment every other measurement is taken under",
  get_context_usage: "its handler makes twenty-one count_tokens calls of its own; the raw driver already creates this condition against a cassette that carries them",
};

// ---------------------------------------------------------------------------

interface Answer {
  subtype: "success" | "error";
  error?: string;
}

/** Drive one control frame into a fresh engine session and return what came back. */
function sendOne(requestId: string, request: Record<string, unknown>, baseUrl: string): Promise<{ answer: Answer | null; finished: boolean }> {
  mkdirSync(SANDBOX, { recursive: true });
  const child = spawn(
    enginePath("engine-real"),
    ["--print", "--verbose", "--input-format", "stream-json", "--output-format", "stream-json", "--dangerously-skip-permissions", "--max-turns", "1", "--setting-sources", ""],
    { cwd: SANDBOX, env: sdkEnv("replay", baseUrl), stdio: ["pipe", "pipe", "pipe"] },
  );
  let answer: Answer | null = null;
  let buf = "";
  /**
   * THE SESSION IS HELD OPEN UNTIL THE ANSWER LANDS, and it has to be. Several
   * arms hand their work to the command-lifecycle wrapper rather than doing it
   * inline — the workspace diff dynamic-imports its builder, the repo-root and
   * add-directory arms defer through the same wrapper — so the answer arrives on
   * a later turn of the loop. Closing stdin the moment the frame is written ends
   * the session first, and the probe's first take reported two of those arms
   * DEAD for that reason alone. A DEAD verdict earned by the instrument's own
   * impatience is exactly the vacuous negative this file's header refuses.
   */
  const GRACE_MS = 6_000;
  child.stdout.on("data", (c: Buffer) => {
    buf += c.toString("utf8");
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      try {
        const frame = JSON.parse(line) as { type?: string; response?: { request_id?: string; subtype?: "success" | "error"; error?: string } };
        if (frame.type === "control_response" && frame.response?.request_id === requestId && frame.response.subtype) {
          answer = { subtype: frame.response.subtype, error: frame.response.error };
        }
      } catch {
        /* a non-JSON line is not an answer */
      }
    }
  });
  child.stderr.resume();
  child.stdin.write(JSON.stringify({ type: "control_request", request_id: requestId, request }) + "\n");

  return new Promise((resolve) => {
    const closeStdin = () => {
      if (!child.stdin.destroyed) child.stdin.end();
    };
    const grace = setTimeout(closeStdin, GRACE_MS);
    const poll = setInterval(() => {
      if (answer) {
        clearInterval(poll);
        clearTimeout(grace);
        closeStdin();
      }
    }, 100);
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      clearInterval(poll);
      clearTimeout(grace);
      resolve({ answer, finished: false });
    }, SESSION_TIMEOUT_MS);
    child.on("close", () => {
      clearTimeout(timer);
      clearTimeout(grace);
      clearInterval(poll);
      resolve({ answer, finished: true });
    });
  });
}

const fixture = readFixture();
const dispatched = [...new Set(fixture.arms.flatMap((a) => a.subtypes))].sort();
const sendable = new Set(fixture.sdk.sendable);

console.log("=== W7: control-request subtype verdicts ===");
console.log(`  population: ${dispatched.length} subtypes over ${fixture.counts.arms} arms, derived from research/fixtures/control-protocol-${fixture.engineVersion}.json`);
console.log(`  sdk ${fixture.sdk.version} can send ${fixture.counts.sendable} of them; ${fixture.counts.armsWithoutSender} arms have no sender at all`);

// Every dispatched subtype must have a row, or the table is reporting on a
// population narrower than the artifact's — the exact failure this file's
// header exists to refuse.
const missing = dispatched.filter((s) => !(s in CASES));
if (missing.length > 0) {
  console.log(`FAIL — ${missing.length} dispatched subtype(s) have no row here: ${missing.join(", ")}`);
  console.log("  The fixture moved. Add a row (with a condition, and a reason if it is not sent) before trusting this table.");
  process.exit(1);
}
const extra = Object.keys(CASES).filter((s) => !dispatched.includes(s));
if (extra.length > 0) {
  console.log(`FAIL — ${extra.length} row(s) name a subtype the pinned engine does not dispatch: ${extra.join(", ")}`);
  process.exit(1);
}
for (const [name, c] of Object.entries(CASES)) {
  if (c.send === null && !(name in NOT_CREATED)) {
    console.log(`FAIL — '${name}' is not sent and carries no written reason; an un-created condition without one is an omission, not a verdict`);
    process.exit(1);
  }
}

const proxy = await startReplayProxy(join(REFORGE_ROOT, "cassettes", "m2-raw.jsonl"));
const baseUrl = `http://127.0.0.1:${proxy.port}`;
try {
  // ---- the instrument's own controls, before it measures anything ----------
  const positive = await sendOne("probe-control-positive", { subtype: "get_binary_version" }, baseUrl);
  const negative = await sendOne("probe-control-negative", { subtype: "reforge_no_such_subtype" }, baseUrl);
  const positiveOk = positive.answer?.subtype === "success";
  const negativeOk = negative.answer?.subtype === "error" && (negative.answer.error ?? "").includes("Unsupported control request subtype");
  console.log(`\n  control (a subtype that MUST answer):      ${positiveOk ? "ok" : `BROKEN — ${JSON.stringify(positive.answer)}`}`);
  console.log(`  control (a subtype that MUST reach the else): ${negativeOk ? "ok" : `BROKEN — ${JSON.stringify(negative.answer)}`}`);
  if (!positiveOk || !negativeOk) {
    console.log("\nFAIL — the instrument cannot distinguish a dispatched subtype from an undispatched one; every verdict below would be vacuous");
    process.exit(1);
  }

  // ---- the measurement -----------------------------------------------------
  const verdicts: { subtype: string; verdict: "FIRED" | "DEAD" | "OPEN"; detail: string }[] = [];
  for (const subtype of dispatched) {
    if (only && subtype !== only) continue;
    const c = CASES[subtype];
    if (c.send === null) {
      verdicts.push(
        c.firedIn
          ? { subtype, verdict: "FIRED", detail: `elsewhere: ${c.firedIn}` }
          : { subtype, verdict: "OPEN", detail: `not created here: ${NOT_CREATED[subtype]}` },
      );
      continue;
    }
    const { answer, finished } = await sendOne(`probe-${subtype}`, { subtype, ...c.send }, baseUrl);
    if (answer) {
      const how = answer.subtype === "success" ? "answered success" : `refused: ${(answer.error ?? "").slice(0, 90)}`;
      verdicts.push({ subtype, verdict: "FIRED", detail: c.firedIn ? `${how}; also ${c.firedIn}` : how });
    } else if (finished) {
      verdicts.push({ subtype, verdict: "DEAD", detail: "the frame was sent, the session completed, and no answer for it ever arrived" });
    } else {
      verdicts.push({ subtype, verdict: "OPEN", detail: `the session did not finish inside ${SESSION_TIMEOUT_MS / 1000}s — the arm blocks on something this cassette does not serve` });
    }
  }

  const tally = { FIRED: 0, DEAD: 0, OPEN: 0 };
  console.log("\n  subtype                              sdk  verdict  evidence");
  for (const v of verdicts) {
    tally[v.verdict]++;
    console.log(`  ${v.subtype.padEnd(36)} ${sendable.has(v.subtype) ? "yes" : "-  "}  ${v.verdict.padEnd(6)}  ${v.detail}`);
  }
  console.log(`\n  FIRED ${tally.FIRED}   DEAD ${tally.DEAD}   OPEN ${tally.OPEN}   (of ${verdicts.length})`);
  console.log(
    "\n  FIRED means a control_response came back for that request id — a refusal counts, because an arm that\n" +
      "        validates and answers has run. DEAD means the frame was sent and nothing answered it. OPEN means the\n" +
      "        condition is named but not created — no claim either way, and the reason says what creating it costs.",
  );
} finally {
  await proxy.close();
}
