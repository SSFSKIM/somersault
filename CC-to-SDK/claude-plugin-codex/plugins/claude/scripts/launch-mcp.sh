#!/bin/sh
# Entry point Codex actually spawns for the claude-companion MCP server (see ../.mcp.json).
#
# Codex's MCP child inherits the PATH of whatever process launched Codex itself — not
# necessarily an interactive dev shell's PATH (e.g. a GUI-launched app on macOS typically only
# gets /usr/bin:/bin:/usr/sbin:/sbin, missing Homebrew/nvm paths). A bare `"command": "node"` in
# .mcp.json silently fails to spawn in that case, so the server never starts and its tools never
# show up in Codex's tool discovery — with no diagnostic anywhere the model or user can see.
# This wrapper widens the search before giving up, and prints a clear reason on stderr if it does.
set -eu

DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ENTRY="$DIR/claude-companion-mcp.mjs"

if command -v node >/dev/null 2>&1; then
  exec node "$ENTRY" "$@"
fi

# CLAUDE_COMPANION_NODE_FALLBACKS overrides the candidate list below (space-separated) —
# production never sets it; tests use it to exercise the not-found branch deterministically,
# without depending on (or disturbing) whatever Node installs happen to exist on the test machine.
CANDIDATES="${CLAUDE_COMPANION_NODE_FALLBACKS-/opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node $HOME/.nvm/versions/node/*/bin/node}"
for candidate in $CANDIDATES; do
  if [ -x "$candidate" ]; then
    exec "$candidate" "$ENTRY" "$@"
  fi
done

echo "claude-companion: no Node.js runtime found (checked PATH, /opt/homebrew/bin, /usr/local/bin, /usr/bin, ~/.nvm/versions/node/*/bin). Install Node.js 18.18+ where Codex can reach it, or launch Codex from a shell that has it on PATH." >&2
exit 127
