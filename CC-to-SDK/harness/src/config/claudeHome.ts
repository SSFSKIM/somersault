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
 *  a caller that ignored it would answer about a tenant it is not serving.
 *
 *  `??`, NOT `||`, and the difference is a whole env shape. The reference is `process.env.CLAUDE_CONFIG_DIR
 *  ?? join(homedir(), '.claude')`, so an EXPORTED-BUT-EMPTY variable is a value there: the engine resolves
 *  it to `''` and reads `./settings.json`, relative to its cwd. Under `||` we fell back to `$HOME/.claude`
 *  and answered about a file the engine does not read — the same class as reading only the base managed
 *  file, in the one env shape that fix did not cover. Empty is a strange thing to export, and it is what a
 *  shell writes for an unset variable in `CLAUDE_CONFIG_DIR="$SOMETHING_UNSET"`.
 *
 *  `.normalize("NFC")` is the reference's too, and it is applied to the whole result rather than to the
 *  variable alone, exactly as there. It matters where the filesystem does not fold the forms together:
 *  macOS folds, Linux does not, and on Linux the engine opens the NFC spelling — so a view that reported
 *  the NFD one would be describing a different file. `env.HOME || homedir()` is ours and stays: it is the
 *  seam that lets a caller pass an env, and node's own `homedir()` reads `$HOME` first on POSIX anyway. */
export function claudeConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  return (env.CLAUDE_CONFIG_DIR ?? join(env.HOME || homedir(), ".claude")).normalize("NFC");
}
