// tui/src/copy.ts — clipboard via the platform's own tool (DI'd for tests, like bash.ts's runBash):
// pbcopy on darwin, xclip on linux. No clipboard-library dependency for a LOW-priority row.
import { spawn as realSpawn } from "node:child_process";

export function copyToClipboard(text: string, deps: { platform?: string; spawn?: typeof realSpawn } = {}): Promise<void> {
  const platform = deps.platform ?? process.platform;
  const spawn = deps.spawn ?? realSpawn;
  const cmd = platform === "darwin" ? ["pbcopy"] : platform === "linux" ? ["xclip", "-selection", "clipboard"] : undefined;
  if (!cmd) return Promise.reject(new Error(`no clipboard tool for ${platform}`));
  return new Promise((resolve, reject) => {
    const p = spawn(cmd[0], cmd.slice(1), { stdio: ["pipe", "ignore", "ignore"] });
    p.on("error", (e) => reject(new Error(`${cmd[0]} unavailable: ${e.message}`)));
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd[0]} exited ${code}`))));
    p.stdin!.end(text);
  });
}
