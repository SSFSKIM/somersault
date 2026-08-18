// src/appserver/configDomain.ts — the config domain's three handlers: `config/read` plus the two writes.
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { homedir, platform } from "node:os";
import { ERR } from "./rpc.js";
import type { Handler } from "./server.js";
import { layerPaths, readLayers, effectiveView } from "./configLayers.js";
import type { ConfigLayer, LayerName } from "./configLayers.js";
import { ConfigError, versionToken, applyEdit, readTargetDoc, writeTargetDoc, resolveRealTarget, withFileLock, canonicalPath } from "./configWrite.js";
import { configReadParams, configValueWriteParams, configBatchWriteParams } from "./schema/config.js";

/** ConfigError → the wire. Codes are grouped by WHAT THE CLIENT SHOULD DO NEXT — the rule rpc.ts's own
 *  header states for `ATTACH_FAILED`: "One code for both because a client's move is the same." Lock
 *  contention's move is "retry shortly", which is what `BUSY` already means everywhere else in this
 *  server, so it rides -33001 rather than spending a new -330xx number. It must NOT ride
 *  `INVALID_PARAMS`: "your params are wrong" is the one reading guaranteed to stop a client retrying,
 *  and the params were fine. Everything else here really is a bad request. */
const configErrorWireCode = (code: ConfigError["code"]): number => (code === "ConfigLocked" ? ERR.BUSY : ERR.INVALID_PARAMS);

/** win32: null — the spec declares Windows managed paths out of this file-backed view, and a Linux
 *  default there would invent a drive-root layer (plan review F19). The mapping takes the platform as a
 *  PARAMETER so all three arms run on any one machine: computed inline off `platform()` at module load,
 *  the two arms this host is not could only ever be read, never executed (flagged by two reviews).
 *  `DEFAULT_MANAGED_PATH` below is unchanged in name, type and value — later tasks consume it. */
export function defaultManagedPath(platformName: string): string | null {
  if (platformName === "darwin") return "/Library/Application Support/ClaudeCode/managed-settings.json";
  if (platformName === "win32") return null;
  return "/etc/claude-code/managed-settings.json";
}
export const DEFAULT_MANAGED_PATH: string | null = defaultManagedPath(platform());

export async function resolveConfigCwd(cwd: string, deps: { realpath: (p: string) => Promise<string> } = { realpath }): Promise<string> {
  if (!isAbsolute(cwd)) throw new ConfigError("ConfigValidationError", "cwd must be an absolute path");
  let resolved: string;
  try { resolved = await deps.realpath(cwd); }
  catch { throw new ConfigError("ConfigValidationError", `cwd does not exist: ${cwd}`); }
  // `realpath` succeeds on a REGULAR FILE too, and the read would then go looking for
  // `<file>/.claude/settings.json` — a reply carrying three CAS tokens for paths that can never exist.
  // A non-directory is refused exactly as a missing directory is: same code, same error data.
  let isDir = false;
  try { isDir = (await stat(resolved)).isDirectory(); } catch { /* raced away between realpath and stat */ }
  if (!isDir) throw new ConfigError("ConfigValidationError", `cwd is not a directory: ${cwd}`);
  return resolved;
}

// THREE cases, not two — and this handler is the only place the difference is knowable (review I1).
// D-M5-18 defines "absent" as "no such file yet", the state a client's first conditional write creates.
// A file that IS there but whose bytes never reached us (EACCES, EISDIR — `readLayers` keeps the layer,
// with a `disabledReason` and no `raw`) is a DIFFERENT state, and collapsing the two destroys it at the
// one point it exists: a write-only settings file (mode 0200 is legal — write permission is independent
// of read permission) would read as "absent", and a CAS built on this same token would then take
// `expectedVersion: "absent"` as "create it" and overwrite bytes nobody ever read. The hash half is
// configWrite.ts's `versionToken` — a pure bytes→token function with TWO cases. The third token is not a
// property of any bytes but of a LAYER, so it is minted here, where layer state is what we hold.
const token = (layer: ConfigLayer | undefined): string =>
  layer === undefined ? "absent"
    : layer.raw === undefined ? "unreadable"
      : versionToken(layer.raw);

export const configRead: Handler = async (srv, ctx, id, params) => {
  const parsed = configReadParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const home = srv.deps.configHome ?? homedir();
  const managed = srv.deps.managedSettingsPath !== undefined ? srv.deps.managedSettingsPath : DEFAULT_MANAGED_PATH;
  try {
    const cwd = parsed.data.cwd !== undefined ? await resolveConfigCwd(parsed.data.cwd) : undefined;
    // Canonicalized HERE, before `readLayers`, so `paths` and `layers` still agree by string (the
    // `versions` walk below matches on `filePath`) and so a layer's `filePath` is the same string a write
    // reply gives for the same file — `resolveRealTarget` canonicalizes too, and one file answering to two
    // names across the two methods left a client with no way to correlate them (review I2).
    const paths = await Promise.all(layerPaths(home, managed, cwd).map(async (p) => ({ ...p, filePath: await canonicalPath(p.filePath) })));
    const layers = await readLayers(paths);
    const { config, origins } = effectiveView(layers);
    // D-M5-18: CAS tokens for every WRITABLE target in view — walked off `paths` (absent layers are
    // not in `layers`, and an absent writable file's token is the string "absent"). The LAYER is passed
    // whole, not its `raw`: `?.raw` would collapse "not in `layers`" and "in `layers` with no bytes".
    const versions: Record<string, string> = {};
    for (const { name, filePath } of paths) {
      if (name === "managed") continue;
      versions[name] = token(layers.find((l) => l.filePath === filePath));
    }
    ctx.peer.reply(id, { config, origins, versions, incomplete: true, ...(parsed.data.includeLayers ? { layers } : {}) });
  } catch (e) {
    if (e instanceof ConfigError) { ctx.peer.replyError(id, configErrorWireCode(e.code), e.message, { code: e.code }); return; }
    ctx.peer.replyError(id, ERR.INTERNAL, e instanceof Error ? e.message : String(e));
  }
};

/** Advisory only (D-M5-5): a key outside this list WARNS — upstream tolerates unknown keys, so must we.
 *  Never a refusal, which is exactly why it has to be TRUE: an untrue advisory is worse than none, and
 *  rev 1's hand-written list was wrong in both directions (review M1). It named `attributions` — upstream's
 *  key is `attribution`, singular — so writing the real key warned; it omitted real top-level keys such as
 *  `language` and `disableAllHooks`, which warned too; and it listed `defaultMode`,
 *  `disableBypassPermissionsMode` and `additionalDirectories`, which live inside `permissions` and are
 *  genuinely wrong at the top level, so the one case a warning would have helped was silent.
 *
 *  Transcribed from `Claude Code Src/src/utils/settings/types.ts` → `SettingsSchema`: every key of the
 *  outer `z.object`, including the ones behind an env/feature gate there (`.passthrough()` keeps those
 *  alive in a settings file regardless of the flag, so warning about them would be the same false
 *  positive). It will drift as upstream moves — a stale entry costs a missing warning, never a refusal. */
const KNOWN_TOP_LEVEL = new Set([
  "$schema", "apiKeyHelper", "awsCredentialExport", "awsAuthRefresh", "gcpAuthRefresh", "xaaIdp",
  "fileSuggestion", "respectGitignore", "cleanupPeriodDays", "env", "attribution", "includeCoAuthoredBy",
  "includeGitInstructions", "permissions", "model", "availableModels", "modelOverrides",
  "enableAllProjectMcpServers", "enabledMcpjsonServers", "disabledMcpjsonServers", "allowedMcpServers",
  "deniedMcpServers", "hooks", "worktree", "disableAllHooks", "defaultShell", "allowManagedHooksOnly",
  "allowedHttpHookUrls", "httpHookAllowedEnvVars", "allowManagedPermissionRulesOnly",
  "allowManagedMcpServersOnly", "strictPluginOnlyCustomization", "statusLine", "enabledPlugins",
  "extraKnownMarketplaces", "strictKnownMarketplaces", "blockedMarketplaces", "forceLoginMethod",
  "forceLoginOrgUUID", "otelHeadersHelper", "outputStyle", "language", "skipWebFetchPreflight", "sandbox",
  "feedbackSurveyRate", "spinnerTipsEnabled", "spinnerVerbs", "spinnerTipsOverride",
  "syntaxHighlightingDisabled", "terminalTitleFromRename", "alwaysThinkingEnabled", "effortLevel",
  "advisorModel", "fastMode", "fastModePerSessionOptIn", "promptSuggestionEnabled",
  "showClearContextOnPlanAccept", "agent", "companyAnnouncements", "pluginConfigs", "remote",
  "disableDeepLinkRegistration", "classifierPermissionsEnabled", "autoUpdatesChannel", "minimumVersion",
  "plansDirectory", "minSleepDurationMs", "maxSleepDurationMs", "voiceEnabled", "assistant",
  "assistantName", "channelsEnabled", "allowedChannelPlugins", "defaultView", "prefersReducedMotion",
  "autoMemoryEnabled", "autoMemoryDirectory", "autoDreamEnabled", "showThinkingSummaries",
  "skipDangerousModePermissionPrompt", "skipAutoPermissionPrompt", "useAutoModeDuringPlan", "autoMode",
  "disableAutoMode", "sshConfigs", "claudeMdExcludes", "pluginTrustMessage"]);

type WriteData = { edits: Array<{ keyPath: string[]; value: unknown; mergeStrategy: "replace" | "upsert" }>; target: "user" | "project" | "local"; cwd?: string; expectedVersion?: string };

/** The shared spine of `config/value/write` and `config/batchWrite`. Two behaviours a client has to know
 *  about, both of them properties of the design rather than gaps in it:
 *
 *  1. **Acquiring a contended target can BLOCK for tens of seconds.** The cross-process `<file>.lock` is
 *     breakable only once it reads stale, so a request that meets another writer's leftover lock waits out
 *     the remainder of that window (30s by default) before proceeding — and usually then succeeds. The
 *     `ConfigLocked` refusal (`BUSY`, -33001) is the *rarer* outcome: the lock could not be unlinked, or a
 *     live writer held it past the deadline. A client must budget for the wait, not just for the error.
 *
 *  2. **`okOverridden` / `overriddenMetadata` are ADVISORY, and cannot be made otherwise here.** The layer
 *     chain is read after the write and outside the lock, so a concurrent edit to a higher layer in that
 *     window makes the answer stale. Moving this read inside `withFileLock` would fix nothing: the lock is
 *     keyed on the TARGET file, and a writer touching the local/project/managed file takes a different lock
 *     entirely. No arrangement of this lock makes masking atomic with the write, so do not try — the write
 *     itself is unaffected, and this metadata is a hint about the effective view, never a guarantee. */
async function runConfigWrite(srv: Parameters<Handler>[0], ctx: Parameters<Handler>[1], id: Parameters<Handler>[2], data: WriteData): Promise<void> {
  try {
    // cwd canonicalized ONCE, FIRST — before target resolution, the lock, or any write. A refusal must
    // leave every file byte-identical (plan review F5: rev 1 validated a user-target cwd only after
    // the write had landed, so the error reply lied about refusing).
    const cwdReal = data.cwd !== undefined ? await resolveConfigCwd(data.cwd) : undefined;
    if ((data.target === "project" || data.target === "local") && cwdReal === undefined)
      throw new ConfigError("ConfigValidationError", `target "${data.target}" requires cwd`);
    const home = srv.deps.configHome ?? homedir();
    const nominal = data.target === "user" ? join(home, ".claude", "settings.json")
      : join(cwdReal as string, ".claude", data.target === "project" ? "settings.json" : "settings.local.json");
    // Resolved BEFORE the lock, and the SAME resolved path feeds the read and the write: `withFileLock`'s
    // in-process queue is keyed by the path string, so two spellings of one file would otherwise take two
    // different locks and lose mutual exclusion between them.
    const filePath = await resolveRealTarget(nominal);
    const written = await withFileLock(filePath, async () => {
      // `"unreadable"` (Task 2 review I1) is refused as an ASSERTION, ahead of the compare: it is a
      // sentinel for the server's inability to read the file, not a state of its content, so a client
      // holding it never saw the bytes it would be asserting continuity of. Mechanically it can never
      // legitimately match — still unreadable and `readTargetDoc` refuses; readable again and the token
      // is a hash — so this is only about failing closed BY DESIGN with a diagnosable message rather
      // than by accident with an opaque one.
      if (data.expectedVersion === "unreadable")
        throw new ConfigError("ConfigValidationError", 'expectedVersion "unreadable" cannot be asserted — re-read config first');
      const { doc, version } = await readTargetDoc(filePath);
      if (data.expectedVersion !== undefined && data.expectedVersion !== version)
        throw new ConfigError("ConfigVersionConflict", `expectedVersion ${data.expectedVersion} does not match current ${version}`);
      let next = doc;
      for (const e of data.edits) next = applyEdit(next, e.keyPath, e.value, e.mergeStrategy);
      return writeTargetDoc(filePath, next);
    });
    // DEDUPED (review M5): the warning names the top-level key, so three edits under one unknown key are
    // three copies of one sentence — noise a client has to collapse itself before showing it.
    const warnings = [...new Set(data.edits.filter((e) => !KNOWN_TOP_LEVEL.has(e.keyPath[0])).map((e) => `unknown top-level settings key "${e.keyPath[0]}" (written anyway)`))];
    // Masking: EVERY edit evaluated (plan review F15).
    const managed = srv.deps.managedSettingsPath !== undefined ? srv.deps.managedSettingsPath : DEFAULT_MANAGED_PATH;
    const layers = await readLayers(layerPaths(home, managed, cwdReal));
    const order = ["user", "project", "local", "managed"] as const;
    const above = order.slice(order.indexOf(data.target) + 1);
    const leafOf = (cfg: Record<string, unknown> | undefined, keyPath: string[]): { present: boolean; value?: unknown } => {
      let node: unknown = cfg;
      for (const seg of keyPath) {
        if (typeof node !== "object" || node === null || Array.isArray(node) || !Object.prototype.hasOwnProperty.call(node, seg)) return { present: false };
        node = (node as Record<string, unknown>)[seg];
      }
      return { present: true, value: node };
    };
    const maskedEditIndexes: number[] = [];
    let overriddenMetadata: { message: string; overridingLayer: string; effectiveValue: unknown } | undefined;
    data.edits.forEach((e, i) => {
      // `above` runs LOWEST precedence first, so the whole slice is walked and the LAST hit wins — the
      // first would name a layer the client can edit and still be masked, while `effectiveValue` reported
      // a value `config/read` disagreed with (review I1: project "PROJECT" named, local "LOCAL" served).
      let masked = false;
      let top: { name: LayerName; value: unknown } | undefined;
      for (const name of above) {
        const hit = leafOf(layers.find((l) => l.name === name)?.config, e.keyPath);
        if (!hit.present) continue;
        top = { name, value: hit.value }; // whatever the client will actually see at this leaf
        // The array carve-out needs BOTH sides to be arrays (review M2): arrays merge by contribution, so
        // a higher array does not mask a lower one and the read side's contributor origins tell that
        // story. A higher array over a written SCALAR is a plain replacement — the scalar never reaches
        // the effective view — and exempting that reported `ok` for a write that had no effect at all.
        if (!(Array.isArray(hit.value) && Array.isArray(e.value))) masked = true;
      }
      if (!masked || top === undefined) return;
      maskedEditIndexes.push(i);
      overriddenMetadata ??= { message: `the ${top.name} layer defines this key with higher precedence`, overridingLayer: top.name, effectiveValue: top.value };
    });
    ctx.peer.reply(id, {
      status: maskedEditIndexes.length ? "okOverridden" : "ok", version: written.version, filePath,
      ...(overriddenMetadata ? { overriddenMetadata } : {}),
      ...(maskedEditIndexes.length ? { maskedEditIndexes } : {}),
      ...(warnings.length ? { warnings } : {}),
    });
  } catch (e) {
    if (e instanceof ConfigError) { ctx.peer.replyError(id, configErrorWireCode(e.code), e.message, { code: e.code }); return; }
    ctx.peer.replyError(id, ERR.INTERNAL, e instanceof Error ? e.message : String(e));
  }
}

export const configValueWrite: Handler = async (srv, ctx, id, params) => {
  const parsed = configValueWriteParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const { keyPath, value, mergeStrategy, target, cwd, expectedVersion } = parsed.data;
  await runConfigWrite(srv, ctx, id, { edits: [{ keyPath, value, mergeStrategy }], target, cwd, expectedVersion });
};

export const configBatchWrite: Handler = async (srv, ctx, id, params) => {
  const parsed = configBatchWriteParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  await runConfigWrite(srv, ctx, id, parsed.data);
};
