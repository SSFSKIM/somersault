// src/appserver/configDomain.ts — the config domain's three handlers: `config/read` plus the two writes.
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { homedir, platform } from "node:os";
import { ERR } from "./rpc.js";
import type { Handler } from "./server.js";
import { layerPaths, readLayers, effectiveView } from "./configLayers.js";
import type { ConfigLayer, LayerName } from "./configLayers.js";
import { ConfigError, versionToken, applyEdit, readTargetDoc, writeTargetDoc, resolveRealTarget, withFileLock, canonicalPath, assertWritableParent } from "./configWrite.js";
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

const LAYER_ORDER = ["user", "project", "local", "managed"] as const;
const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The leaf paths an edit INTRODUCES under its keyPath, at the read side's own granularity: a scalar or an
 *  ARRAY is itself one leaf (`effectiveView` tracks an array as a contributor list, never as a subtree), an
 *  object contributes one leaf per scalar/array nested inside it, and a `replace` with `null` — a delete —
 *  has the keyPath itself as its single leaf. An empty object introduces nothing and yields no leaves,
 *  which is the honest answer: nothing was added to the effective view, so nothing of it can be masked. */
function introducedLeaves(keyPath: string[], value: unknown, strategy: "replace" | "upsert"): string[][] {
  if (strategy === "replace" && value === null) return [keyPath];
  const out: string[][] = [];
  const walk = (v: unknown, path: string[]): void => {
    if (isPlainObject(v)) { for (const [k, child] of Object.entries(v)) walk(child, [...path, k]); return; }
    out.push(path);
  };
  walk(value, keyPath);
  return out;
}

/** `origins` keys the LEAVES of the effective view, so a leaf whose object PARENT a higher layer replaced
 *  with a scalar has no entry of its own — the layer that swallowed it is named at the nearest ancestor
 *  that does. Hence the climb: an unattributed leaf must not read as "nobody is above me". */
const originAt = (origins: Record<string, LayerName | LayerName[]>, leaf: string[]): LayerName | LayerName[] | undefined => {
  for (let n = leaf.length; n > 0; n--) { const hit = origins[leaf.slice(0, n).join(".")]; if (hit !== undefined) return hit; }
  return undefined;
};

/** Walk the merged config by SEGMENTS (never by dotted path — that is the whole point of D-M5-12's opaque
 *  keyPath). Arrays are leaves, so an array on the way down is a miss, exactly as `effectiveView` sees it. */
const valueAt = (cfg: Record<string, unknown>, keyPath: string[]): unknown => {
  let node: unknown = cfg;
  for (const seg of keyPath) {
    if (!isPlainObject(node) || !Object.prototype.hasOwnProperty.call(node, seg)) return undefined;
    node = node[seg];
  }
  return node;
};

type MaskVerdict = { maskedEditIndexes: number[]; overriddenMetadata?: { message: string; overridingLayer: LayerName; effectiveValue: unknown }; unverifiable: string[] };

/** THE MASKING RULE, derived from the read side's own output so the two methods cannot disagree by
 *  construction (review F1). Settings deep-merge, so an object write PARTIALLY lands and "masked at the
 *  written keyPath" was simply the wrong question: writing `env: {A}` over a project `env: {B}` reported
 *  `okOverridden` with `effectiveValue {B}` while the same server's `config/read` served `{A, B}` and
 *  attributed `env.A` to the layer just written. One rule instead:
 *
 *    An edit is masked at a leaf iff the effective view does not attribute that leaf to the layer that was
 *    written; the edit as a whole is masked only when NO leaf it introduces is in force there.
 *
 *  `effectiveValue` is read out of the MERGED config, never out of one layer's own value — that is what
 *  makes the agreement structural rather than coincidental. The both-sides-arrays carve-out is gone rather
 *  than kept beside this: an array the target contributed to has the target in its contributor list and is
 *  in force by the rule itself, while a higher array over a written SCALAR has an array origin the target
 *  is absent from and is masked by the same rule — one mechanism, not two.
 *
 *  A DELETE is in force by ABSENCE (nothing survives at its leaf, so nothing is attributed to it), and a
 *  delete whose leaf falls back to a LOWER layer is in force too: the target's own value really is gone,
 *  and calling a lower layer an "overriding" one would send a client to edit a file that outranks nothing. */
function maskingVerdict(edits: WriteData["edits"], target: WriteData["target"], effective: Record<string, unknown>, origins: Record<string, LayerName | LayerName[]>): MaskVerdict {
  const targetRank = LAYER_ORDER.indexOf(target);
  const out: MaskVerdict = { maskedEditIndexes: [], unverifiable: [] };
  edits.forEach((e, i) => {
    const leaves = introducedLeaves(e.keyPath, e.value, e.mergeStrategy);
    // `origins` addresses leaves by DOTTED path while a keyPath is an opaque segment array (D-M5-12), so a
    // segment carrying a literal dot mis-splits and any verdict drawn from it would be a guess. The same
    // hazard rides the written value's own keys, so both are checked. Reporting the gap beats reporting a
    // wrong verdict: the edit is left out of the masking answer entirely and says so in `warnings`.
    if ([e.keyPath, ...leaves].some((p) => p.some((seg) => seg.includes(".")))) {
      out.unverifiable.push(`could not check whether "${e.keyPath.join(" / ")}" is overridden — a key contains "." and the effective view addresses leaves by dotted path`);
      return;
    }
    let inForce = false;
    let maskedBy: LayerName | undefined;
    for (const leaf of leaves) {
      const origin = originAt(origins, leaf);
      const contributors = origin === undefined ? [] : Array.isArray(origin) ? origin : [origin];
      const masking = contributors.filter((l) => LAYER_ORDER.indexOf(l) > targetRank);
      // In force when the effective view attributes this leaf to the layer we wrote — or, for a DELETE,
      // when it attributes it to nobody ABOVE us, absence being all a delete can offer as proof. There is
      // no separate delete branch on purpose: after a delete the target can never appear in its own
      // leaf's contributors, so the two tests never disagree, and a branch that never disagrees is one
      // nobody can exercise. The `masking.length === 0` half also covers a delete that falls back to a
      // LOWER layer — the target's own value really is gone, and naming a layer it outranks as the
      // "overriding" one would send a client to edit a file that cannot override anything.
      if (contributors.includes(target) || masking.length === 0) { inForce = true; continue; }
      for (const l of masking) if (maskedBy === undefined || LAYER_ORDER.indexOf(l) > LAYER_ORDER.indexOf(maskedBy)) maskedBy = l;
    }
    if (inForce || maskedBy === undefined) return;
    out.maskedEditIndexes.push(i);
    out.overriddenMetadata ??= { message: `the ${maskedBy} layer defines this key with higher precedence`, overridingLayer: maskedBy, effectiveValue: valueAt(effective, e.keyPath) };
  });
  return out;
}

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
    // Asserted BEFORE the lock, because the lock file lives in that same directory: a parent that exists
    // but is not a usable directory (a dangling link, a symlink loop, a regular file where `.claude` should
    // be) used to surface as node's raw `mkdir` message under -32603, which a client can do nothing with.
    await assertWritableParent(filePath);
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
    // Masking: EVERY edit evaluated (plan review F15), against the SAME `effectiveView` `config/read`
    // serves — see `maskingVerdict` for why that shared derivation is the contract.
    const managed = srv.deps.managedSettingsPath !== undefined ? srv.deps.managedSettingsPath : DEFAULT_MANAGED_PATH;
    const layers = await readLayers(layerPaths(home, managed, cwdReal));
    const { config: effective, origins } = effectiveView(layers);
    const { maskedEditIndexes, overriddenMetadata, unverifiable } = maskingVerdict(data.edits, data.target, effective, origins);
    // DEDUPED (review M5): the warning names the top-level key, so three edits under one unknown key are
    // three copies of one sentence — noise a client has to collapse itself before showing it.
    const warnings = [...new Set([
      ...data.edits.filter((e) => !KNOWN_TOP_LEVEL.has(e.keyPath[0])).map((e) => `unknown top-level settings key "${e.keyPath[0]}" (written anyway)`),
      ...unverifiable,
    ])];
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
