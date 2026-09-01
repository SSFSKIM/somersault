# W7 control-protocol subtype matrix (pin 2.1.251, SDK 0.3.251)

Measured 2026-09-02 by `reforge/w7/probe-control-subtypes.ts`, one engine session per subtype on the
no-wrapper wire, replayed offline against the raw driver's cassette. Committed here so the table is
readable without re-running the probe; the probe is the source of truth and re-derives its population
from `reforge/research/fixtures/control-protocol-2.1.251.json` every run.

## What the numbers are

| | |
|---|---|
| subtypes the pinned engine dispatches | **54**, over **52** `else if` arms (two arms carry two subtypes each) |
| subtypes the installed SDK can send | **37** — all 37 served by an arm |
| arms no installed SDK can reach | **16** — raw-driver-only territory |
| **FIRED** | **38** |
| **DEAD** | **0** |
| **OPEN** | **16** |

## How to read a verdict

- **FIRED** — a `control_response` came back for that request id. The arm ran. A REFUSAL counts: an
  arm that validates its input and answers with its own sentence has run just as much as one that
  succeeds, and the evidence column records which.
- **DEAD** — the frame was sent, the session completed, and nothing answered it.
- **OPEN** — the condition is named and not created. No claim either way, and the reason says what
  creating it would cost. OPEN is a state, not a verdict: a row leaves it the moment someone
  anywhere creates the condition it names.

The run opens with two controls and refuses to report if either fails — a subtype that MUST answer
and a fabricated one that MUST reach the ladder's terminal `else`. Without them a broken driver would
report fifty-two DEADs and look like a finding.

**Two rows were reported DEAD by the probe's first take and were not.** `get_workspace_diff` and
`register_repo_root` hand their work to the command-lifecycle wrapper, so their answers arrive on a
later turn of the loop; the probe closed stdin on the same tick it wrote the frame, and the session
ended first. A DEAD verdict earned by the instrument's own impatience is the vacuous negative one
layer down from C8's, so the probe now holds the session open until the answer lands.

## The table

`owned` marks the four subtypes W7 splices a named handler for. `sdk` marks the ones the installed
`@anthropic-ai/claude-agent-sdk` can construct into a `control_request` at all.

| subtype | owned | sdk | verdict | evidence |
|---|---|---|---|---|
| `add_directory` |  |  | **FIRED** | refused: undefined is not an object (evaluating 't.includes') |
| `apply_flag_settings` |  | yes | **OPEN** | not created here: pushes the feature-gate state, which §3.3 pins for the WHOLE corpus and X6 forbids a child changing — creating this condition would change the environment every other measurement is taken under |
| `background_tasks` |  | yes | **FIRED** | answered success |
| `cancel_async_message` |  | yes | **FIRED** | answered success |
| `channel_enable` |  | yes | **OPEN** | not created here: opens the same remote channel |
| `claude_authenticate` |  | yes | **OPEN** | not created here: starts an OAuth flow against the first-party console, outside the proxied base URL — sending it would measure the operator's network, not this engine |
| `claude_oauth_callback` |  | yes | **OPEN** | not created here: only meaningful as the second half of the flow above |
| `claude_oauth_wait_for_completion` |  | yes | **OPEN** | not created here: only meaningful as the second half of the flow above |
| `end_session` |  |  | **FIRED** | answered success |
| `file_suggestions` |  |  | **FIRED** | answered success |
| `generate_session_title` |  | yes | **OPEN** | not created here: makes its own model call — a live recording, for one title |
| `get_binary_version` |  |  | **FIRED** | answered success; also m2/raw-protocol.ts case `get_binary_version` |
| `get_context_usage` |  | yes | **FIRED** | elsewhere: m2/raw-protocol.ts case `get_context_usage`, whose cassette carries the twenty-one count_tokens calls the handler makes |
| `get_plan` |  |  | **FIRED** | answered success |
| `get_session_cost` |  |  | **FIRED** | answered success |
| `get_settings` |  | yes | **FIRED** | answered success |
| `get_usage` |  | yes | **FIRED** | answered success |
| `get_workspace_diff` |  |  | **FIRED** | answered success |
| `initialize` | yes | yes | **FIRED** | answered success; also m2/raw-protocol.ts case `initialize`; every SDK-driven corpus scenario |
| `interrupt` |  | yes | **FIRED** | answered success; also corpus scenario `interrupt` |
| `list_models` |  |  | **FIRED** | answered success |
| `mcp_authenticate` |  | yes | **OPEN** | not created here: starts an MCP server's OAuth flow, which needs a real server and a browser redirect |
| `mcp_call` |  |  | **FIRED** | refused: mcp_call: tool must be a string |
| `mcp_clear_auth` |  | yes | **FIRED** | refused: Server not found:  |
| `mcp_message` |  | yes | **FIRED** | answered success; also corpus scenario `mcp-tool` |
| `mcp_oauth_callback_url` |  | yes | **OPEN** | not created here: only meaningful as the second half of the flow above |
| `mcp_reconnect` |  | yes | **FIRED** | refused: Server not found:  |
| `mcp_set_servers` |  | yes | **FIRED** | answered success |
| `mcp_status` |  | yes | **FIRED** | answered success |
| `mcp_toggle` |  | yes | **FIRED** | refused: Server not found:  |
| `message_rated` |  | yes | **OPEN** | not created here: same endpoint |
| `poll_event` |  |  | **FIRED** | refused: poll-event delivery is not enabled for this session |
| `read_file` |  | yes | **FIRED** | refused: read denied: does-not-exist.txt |
| `register_device_hooks` |  |  | **OPEN** | not created here: device hook templates are the remote-device surface the W5 scout measured off the headless path entirely |
| `register_repo_root` |  |  | **FIRED** | refused: register_repo_root: target path could not be resolved |
| `reload_plugins` |  | yes | **FIRED** | answered success |
| `reload_skills` |  | yes | **FIRED** | answered success |
| `remote_control` |  | yes | **OPEN** | not created here: opens a relay socket to a remote-control service; the 7 KB arm is the largest in the ladder and every path in it leaves the harness |
| `remote_tools_announce` |  |  | **OPEN** | not created here: needs a remote peer on that channel |
| `rename_session` |  |  | **FIRED** | answered success |
| `rewind_conversation` |  |  | **FIRED** | refused: rewind_conversation: target_message_uuid must be a string |
| `rewind_files` |  | yes | **FIRED** | answered success |
| `seed_read_state` |  | yes | **FIRED** | answered success |
| `set_cwd` |  | yes | **FIRED** | refused: set_cwd: invalid request — path must be a non-empty string |
| `set_max_thinking_tokens` | yes | yes | **FIRED** | answered success; also m2/raw-protocol.ts cases `set_max_thinking_tokens-{valid,invalid}` |
| `set_mcp_permission_mode_override` |  | yes | **FIRED** | answered success |
| `set_model` | yes | yes | **FIRED** | answered success; also m2/raw-protocol.ts cases `set_model-{valid,invalid}` |
| `set_permission_mode` | yes | yes | **FIRED** | answered success; also m2/raw-protocol.ts cases `set_permission_mode-{valid,invalid}`; corpus `runtime-setters`, `perm-mode-walk` |
| `side_question` |  | yes | **OPEN** | not created here: makes its own model call, and a two-stage one |
| `stage_file` |  |  | **FIRED** | refused: CLAUDE_CODE_REMOTE_SESSION_ID unset |
| `stop_task` |  | yes | **FIRED** | answered success |
| `submit_feedback` |  | yes | **OPEN** | not created here: POSTs to a feedback endpoint the replay cassette does not serve; a miss hangs the session rather than answering |
| `ultrareview_launch` |  | yes | **OPEN** | not created here: launches a review agent, which is a whole subagent run |
| `upload_device_hook_template` |  |  | **OPEN** | not created here: same surface |

## The gaps this table makes visible

1. **The sixteen no-sender arms are not dead code** — the probe fires most of them. They are simply
   unreachable through the wrapper, which is what a raw driver exists for. `get_binary_version` is
   the cheapest demonstration.
2. **`get_context_usage` is the most model-expensive frame in the protocol.** Its handler counts
   tokens section by section through twenty-one further `count_tokens` calls of its own. It is also
   invisible to the SDK lane, so nothing had ever paid that cost in this harness before.
3. **`rewind_files` fires and nothing grades its answer.** The handler (`Tf`, 485 B) is takeable and
   anchorable today; what it wants is a scenario of its own.
4. **The `interrupt` arm has no named handler** — it is inlined — and the five helpers it delegates
   to are the auto-react and task-notification subsystems rather than this one. Their firing
   condition is an interrupt with live tasks, artifact subscriptions or a queued command, which the
   corpus's `interrupt` scenario creates none of.
