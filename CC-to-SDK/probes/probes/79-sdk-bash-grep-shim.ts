/**
 * Probe 79 — does an SDK-spawned agent's Bash tool get the `grep` → ugrep shim?
 *
 * Established without a probe:
 *   - the SDK's manifest.json pins the `claude` binary 2.1.220 per platform, and
 *     that binary has ugrep 7.5.0 embedded (`exec -a ugrep <binary> --version`);
 *   - sdk.mjs / bridge.mjs contain ZERO `ugrep` references, so the wrapper does
 *     not install the shim.
 *
 * Unsettled, and only a live run can settle it: the shim is a shell FUNCTION
 * installed into the Bash tool's shell. Interactive Claude Code installs it.
 * Does the headless SDK path? `strings` on the binary finds nothing, but the
 * executable embeds compressed JS, so that is not evidence of absence.
 *
 * Verdict is decided by `type grep` inside the agent's own Bash tool.
 *
 * VERDICT (live, 2026-07-31, sonnet-4-6): SHIM PRESENT headlessly.
 *   grep is a shell function from /Users/new/.claude/shell-snapshots/snapshot-zsh-*.sh
 *   grep --version -> ugrep 7.5.0 aarch64-apple-macosx +neon/AArch64; -P:pcre2jit
 *
 * MECHANISM (the part neither the JS bundle nor `strings` revealed): the CLI
 * snapshots the user's real shell into ~/.claude/shell-snapshots/ and sources it
 * into every Bash tool call. The snapshot appends three shims, each re-execing
 * the claude binary under a different ARGV0 -- so one 256MB executable is also
 * ripgrep, bfs and ugrep:
 *   grep -> ARGV0=ugrep ... -G --ignore-files --hidden -I --exclude-dir=.git ...
 *   find -> ARGV0=bfs   ... -S dfs -regextype findutils-default
 *   rg   -> ARGV0=rg    ... (args passed through)
 * Each falls back to `command <name>` when the binary is unreachable.
 *
 * The SDK-spawned session writes its own snapshot and DELETES it on exit; the
 * interactive session's snapshot persists.
 */
import { query } from "@anthropic-ai/claude-agent-sdk";

const PROMPT = [
  "Run exactly this in Bash and report the raw stdout verbatim, nothing else:",
  "",
  "  type grep; echo '---'; grep --version 2>&1 | head -1",
  "",
  "Do not summarise or interpret. Paste the output.",
].join("\n");

const text: string[] = [];

for await (const msg of query({
  prompt: PROMPT,
  options: {
    model: "claude-sonnet-4-6",
    allowedTools: ["Bash"],
    permissionMode: "bypassPermissions",
    maxTurns: 4,
  },
})) {
  if (msg.type === "assistant") {
    for (const block of msg.message.content) {
      if (block.type === "text") text.push(block.text);
    }
  }
  if (msg.type === "result") {
    const out = text.join("\n");
    console.log("=== agent-reported Bash output ===");
    console.log(out);
    console.log("=== verdict ===");
    const shimmed = /ugrep/i.test(out) || /_cc_bin|CLAUDE_CODE_EXECPATH/.test(out);
    const isFunction = /is a (shell )?function|grep \(\)/.test(out);
    console.log("mentions ugrep / claude exec path :", shimmed);
    console.log("grep reported as shell function   :", isFunction);
    console.log(
      "VERDICT:",
      shimmed || isFunction
        ? "SHIM PRESENT headlessly — SDK-spawned Bash inherits the ugrep grep"
        : "SHIM ABSENT headlessly — SDK-spawned Bash gets the plain system grep",
    );
  }
}
