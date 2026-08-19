// src/config/claudeHome.ts — where the ENGINE keeps its per-user state, in one spelling.
import { homedir } from "node:os";
import { join } from "node:path";

/** `CLAUDE_CONFIG_DIR` REPLACES `~/.claude` outright — the file is `$CLAUDE_CONFIG_DIR/settings.json`,
 *  with no `.claude` segment — so no "home directory" value can express it and every caller has to ask
 *  for the directory itself. Measured against the shipped `claude` 2.1.234 (a setting in the env dir is
 *  reported by `claude doctor`; the identical setting in `$HOME/.claude` is ignored entirely while the
 *  variable is set) and stated in the reference's `getClaudeConfigHomeDir` (utils/envUtils.ts).
 *
 *  ONE spelling for the whole harness: the fleet registry reads the engine's session rows from under this
 *  directory (probe 61) and the config domain reads and writes the user settings layer under it. They must
 *  not drift, because this harness's own tenant preset EXPORTS the variable (`config/tenantPreset.ts`), so
 *  a caller that ignored it would answer about a tenant it is not serving. */
export function claudeConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.CLAUDE_CONFIG_DIR || join(env.HOME || homedir(), ".claude");
}
