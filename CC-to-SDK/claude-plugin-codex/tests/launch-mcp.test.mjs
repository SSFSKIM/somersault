import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { run } from "./helpers.mjs";

// Live-testing feedback: Codex's MCP child inherits whatever PATH launched Codex itself, not
// necessarily an interactive dev shell's — a bare `"command": "node"` in .mcp.json silently
// failed to spawn in that case, so claude-companion's tools never showed up in Codex's tool
// discovery with no diagnostic anywhere. launch-mcp.sh widens the search and fails loudly instead.
const SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../plugins/claude/scripts/launch-mcp.sh"
);

function launch(env, input) {
  return run("sh", [SCRIPT], { env: { HOME: process.env.HOME, ...env }, input });
}

test("launch-mcp.sh execs the real server when node is on PATH", () => {
  const result = launch(
    { PATH: process.env.PATH },
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n'
  );
  assert.match(result.stdout, /"serverInfo":\{"name":"claude-companion"/);
  assert.equal(result.status, 0);
});

test("launch-mcp.sh falls back to a common absolute node path when PATH lacks node", () => {
  // Point the fallback list at the real node binary under a name PATH can't see, proving the
  // fallback branch (not the `command -v node` fast path) is what found it.
  const result = launch(
    { PATH: "/usr/bin:/bin", CLAUDE_COMPANION_NODE_FALLBACKS: process.execPath },
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n'
  );
  assert.match(result.stdout, /"serverInfo":\{"name":"claude-companion"/);
  assert.equal(result.status, 0);
});

test("launch-mcp.sh fails loudly with a clear diagnostic when no node can be found anywhere", () => {
  const result = launch({ PATH: "/usr/bin:/bin", CLAUDE_COMPANION_NODE_FALLBACKS: "" }, "");
  assert.equal(result.status, 127);
  assert.match(result.stderr, /no Node\.js runtime found/);
  assert.equal(result.stdout, "");
});
