// src/appserver/configDomain.ts — config/read here; the writes land in Task 4.
import { realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { homedir, platform } from "node:os";
import { ERR } from "./rpc.js";
import type { Handler } from "./server.js";
import { layerPaths, readLayers, effectiveView } from "./configLayers.js";
import { configReadParams } from "./schema/config.js";

/** win32: null — the spec declares Windows managed paths out of this file-backed view, and a Linux
 *  default there would invent a drive-root layer (plan review F19). */
export const DEFAULT_MANAGED_PATH: string | null = platform() === "darwin"
  ? "/Library/Application Support/ClaudeCode/managed-settings.json"
  : platform() === "win32" ? null : "/etc/claude-code/managed-settings.json";

// Task 3 moves this class to configWrite.ts and re-imports it here — the write primitives throw it too.
export class ConfigError extends Error {
  constructor(public code: "ConfigVersionConflict" | "ConfigValidationError", message: string) { super(message); }
}

export async function resolveConfigCwd(cwd: string, deps: { realpath: (p: string) => Promise<string> } = { realpath }): Promise<string> {
  if (!isAbsolute(cwd)) throw new ConfigError("ConfigValidationError", "cwd must be an absolute path");
  try { return await deps.realpath(cwd); }
  catch { throw new ConfigError("ConfigValidationError", `cwd does not exist: ${cwd}`); }
}

// Task 3 replaces this inline token with configWrite.ts's versionToken (same contract).
const token = (raw: string | undefined): string => raw === undefined ? "absent" : createHash("sha256").update(raw).digest("hex");

export const configRead: Handler = async (srv, ctx, id, params) => {
  const parsed = configReadParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const home = srv.deps.configHome ?? homedir();
  const managed = srv.deps.managedSettingsPath !== undefined ? srv.deps.managedSettingsPath : DEFAULT_MANAGED_PATH;
  try {
    const cwd = parsed.data.cwd !== undefined ? await resolveConfigCwd(parsed.data.cwd) : undefined;
    const paths = layerPaths(home, managed, cwd);
    const layers = await readLayers(paths);
    const { config, origins } = effectiveView(layers);
    // D-M5-18: CAS tokens for every WRITABLE target in view — walked off `paths` (absent layers are
    // not in `layers`, and an absent writable file's token is the string "absent").
    const versions: Record<string, string> = {};
    for (const { name, filePath } of paths) {
      if (name === "managed") continue;
      versions[name] = token(layers.find((l) => l.filePath === filePath)?.raw);
    }
    ctx.peer.reply(id, { config, origins, versions, incomplete: true, ...(parsed.data.includeLayers ? { layers } : {}) });
  } catch (e) {
    if (e instanceof ConfigError) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, e.message, { code: e.code }); return; }
    ctx.peer.replyError(id, ERR.INTERNAL, e instanceof Error ? e.message : String(e));
  }
};
