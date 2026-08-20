// Probe 112 — Does a headless SDK init frame carry 0.3.234's `terminal_slash_commands`?
//
// SDK 0.3.234 added `terminal_slash_commands?: string[]` to SDKSystemMessage (init). Its own doc:
// "Subset of slash_commands whose UX is bound to the local terminal (e.g. exit, statusline).
//  Phone/remote UIs should hide these from command menus... Present only when non-empty; absent on
//  CLIs that predate the field, and on sessions where no advertised command carries the tag."
//
// Why we care (M5 spec, "The 0.3.234 absorb task"): the agent app-server serves remote/web clients
// through `thread/capabilities/read`, whose command list comes from `supportedCommands()` — and
// `SlashCommand` (sdk.d.ts:7618) carries NO terminal-bound marker. The init frame is therefore the
// ONLY place this classification could come from. If it is absent headless, there is nothing to wire.
//
// Three things this must distinguish, because "absent" has three different causes and only one of
// them is "the SDK does not do this headless":
//   (a) field present, non-empty          → ALIVE
//   (b) field absent AND no terminal-bound command is advertised at all (no /exit, no /statusline
//       in slash_commands) → absent is CORRECT per the doc; nothing to hide, nothing to wire
//   (c) field absent WHILE terminal-bound commands ARE advertised → the classification exists in the
//       CLI but is not published on this transport: DEAD-for-us
//
// Keying: `set -a; . ../.env; set +a` is the usual invocation, but it resolves to the CHECKOUT the
// probe runs from — a git worktree has no `.env` of its own. So this probe loads the credential
// itself: an already-set `CLAUDE_CODE_OAUTH_TOKEN` wins, else `$CCX_ENV_FILE`, else the main
// checkout's `CC-to-SDK/.env`. `ANTHROPIC_API_KEY` is deleted unconditionally — an API key in the
// environment SHADOWS the OAuth token and bills per-token instead of the subscription. Nothing here
// prints a value.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";

function loadKey(): void {
  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    const file = process.env.CCX_ENV_FILE ?? resolve(import.meta.dirname, "../../.env");
    try {
      for (const line of readFileSync(file, "utf8").split("\n")) {
        const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
        if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
      }
    } catch (e) { console.log("[env] could not read env file:", (e as Error)?.name); }
  }
  delete process.env.ANTHROPIC_API_KEY;
  console.log("[env] keyed:", Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN));
}
loadKey();

const log = (...a: unknown[]) => console.log("[p112]", ...a);

// Commands upstream binds to the local terminal. Used only to tell cause (b) from cause (c) above.
const TERMINAL_ISH = ["exit", "quit", "statusline", "vim", "terminal-setup", "install-github-app", "bashes", "ide", "config", "theme"];

let init: Record<string, unknown> | null = null;
const types: string[] = [];

for await (const m of query({
  prompt: "Reply with exactly: OK",
  options: { maxTurns: 1, permissionMode: "bypassPermissions", allowDangerouslySkipPermissions: true, allowedTools: [] } as never,
})) {
  const msg = m as Record<string, unknown>;
  types.push(`${msg.type}${msg.subtype ? `/${msg.subtype}` : ""}`);
  if (msg.type === "system" && msg.subtype === "init" && !init) init = msg;
}

if (!init) {
  log("NO INIT FRAME SEEN. message types:", types.join(","));
  process.exit(1);
}

const slash = (init.slash_commands as string[]) ?? [];
const terminal = init.terminal_slash_commands as string[] | undefined;

log("claude_code_version:", init.claude_code_version);
log("message types:", types.join(","));
log("init.slash_commands?.length:", slash.length);
log("init.terminal_slash_commands:", JSON.stringify(terminal ?? "ABSENT"));
log("init keys:", Object.keys(init).sort().join(","));
log("terminal-ish commands ADVERTISED in slash_commands:", JSON.stringify(slash.filter((c) => TERMINAL_ISH.includes(c))));
log("init.capabilities:", JSON.stringify(init.capabilities ?? "ABSENT"));
log("init.effort:", JSON.stringify(init.effort ?? "ABSENT")); // the other 0.3.234 init addition, free to observe

const advertised = slash.filter((c) => TERMINAL_ISH.includes(c)).length > 0;
log(
  "PHASE1 VERDICT:",
  terminal !== undefined
    ? "ALIVE — init carries terminal_slash_commands"
    : advertised
      ? "DEAD-for-us — field absent while terminal-bound commands ARE advertised"
      : "DEAD — field absent and no terminal-bound command is advertised (doc-consistent absence)",
);

// ---------------------------------------------------------------------------------------------
// PHASE 2 — THE PRODUCER SEAM, and the one fact that decides whether the FLEET origin can ever see it.
//
// `thread/capabilities/read` answers from `supportedCommands()`, and `SlashCommand` (sdk.d.ts:7618)
// carries NO terminal-bound marker — so the init FRAME is the only source, and something has to latch
// it off that frame. The latch point is router.ts's `routeInit`, which the appserver installs on
// `record.session.onFrame`.
//
// Two things must hold for the fleet origin, and only measurement can say whether they do:
//   1. does the init frame reach `Session.submit`'s per-turn `onMessage` sink at all? That sink is what
//      the ccx host re-emits as `{kind:"message"}` to followers (host.ts's runTask) — the fleet
//      router's only feed. Frames that only reach `onFrame` are inProcess-only by construction.
//   2. is init emitted PER TURN or once per process? A fleet thread attaches to a host that may already
//      be running; the follow burst is marked `replay: true` and router.ts drops replayed frames
//      outright. If init never recurs, a fleet attach can only ever get it as replay — i.e. never.
// Two short turns answer (2) and one answers (1).
const { openSession } = await import("../../harness/dist/index.js");

const H = openSession({});
const onFrameInits: Array<string | undefined> = [];
const onMessageInits: Array<string | undefined> = [];
const isInit = (m: unknown) => { const x = m as Record<string, unknown>; return x?.type === "system" && x?.subtype === "init"; };
const tsc = (m: unknown) => JSON.stringify((m as Record<string, unknown>)?.terminal_slash_commands ?? "ABSENT");

const off = H.onFrame((m: unknown) => { if (isInit(m)) onFrameInits.push(tsc(m)); });
const sink = (m: unknown) => { if (isInit(m)) onMessageInits.push(tsc(m)); };

await H.submit("Reply with exactly: OK", sink);
await H.submit("Reply with exactly: OK again", sink);

off();
await H.dispose();

log("---");
log("PHASE2 init frames at onFrame (appserver router's feed), 2 turns:", JSON.stringify(onFrameInits));
log("PHASE2 init frames at onMessage (fleet host relay's feed), 2 turns:", JSON.stringify(onMessageInits));
log("PHASE2 init is re-emitted per turn:", onFrameInits.length > 1);
log("PHASE2 SEAM inProcess (routeInit's feed) sees terminal_slash_commands:", onFrameInits.some((t) => t !== '"ABSENT"'));
log("PHASE2 SEAM fleet (host onMessage -> {kind:'message'} -> routeInit) sees it:", onMessageInits.some((t) => t !== '"ABSENT"'));

setTimeout(() => process.exit(0), 1000);
