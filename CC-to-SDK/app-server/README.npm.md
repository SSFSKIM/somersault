# cc-codex-appserver

The Claude-backed worker for the [**claude-companion**](https://github.com/SSFSKIM/claude-plugin-codex)
Codex plugin — a small JSON-RPC/stdio server, built on the
[Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk), that the plugin spawns to
run Claude tasks and reviews. It is a drop-in for the shape of `codex app-server`, speaking a compact
NDJSON variant of the same protocol.

You normally don't run this yourself — the `claude-companion` plugin launches it. Installing it globally is
all that's required for the plugin to find it:

```bash
npm install -g cc-codex-appserver
```

The plugin resolves the `cc-codex-appserver` binary from your `PATH` automatically. To point at a specific
build instead, set `CLAUDE_COMPANION_APPSERVER` (e.g. `CLAUDE_COMPANION_APPSERVER="node /path/to/cc-codex-appserver.mjs"`)
before launching Codex.

## Requirements

- **Node.js 18.18 or later.**
- **A local Claude Code login, or `CLAUDE_CODE_OAUTH_TOKEN` / `ANTHROPIC_API_KEY`.** The worker reuses
  whatever Claude authentication your shell already has; run `claude login` or `claude setup-token` if you
  haven't. `ANTHROPIC_API_KEY` shadows the OAuth token when both are set.

## License

Apache-2.0. See [LICENSE](./LICENSE).
