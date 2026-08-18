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
 *  which is the honest answer: nothing was added to the effective view, so nothing of it can be masked.
 *
 *  `upsert` with `null` never reaches here — `applyEdit` refuses it, inside the lock, before any masking
 *  runs — so the fall-through that would treat it as a scalar leaf is kept only as defence against a
 *  future caller that computes leaves without writing first. It costs no branch of its own. */
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

/** NAMING ONLY — the verdict never comes from here (`maskingVerdict` states why the two are split).
 *
 *  `origins` keys the LEAVES of the effective view, so a masked leaf usually has no entry of its own and
 *  the layer worth naming sits beside it. ABOVE it: a higher layer replaced an object ANCESTOR with a
 *  scalar, and the layer that swallowed the leaf is named at the nearest ancestor that does carry an entry.
 *  BELOW it: a higher layer holds an OBJECT where this write put a leaf, and the only survivors are that
 *  layer's own leaves keyed strictly beneath it. The nearest ancestor wins over the descendants — it is the
 *  closer answer to "who is standing on this path".
 *
 *  A LIST, because an object can be assembled from several layers at once and an array's entry is already a
 *  contributor list; the caller filters it by rank. */
const addLayers = (out: LayerName[], origin: LayerName | LayerName[]): void => {
  for (const l of Array.isArray(origin) ? origin : [origin]) if (!out.includes(l)) out.push(l);
};
function contributorsNear(origins: Record<string, LayerName | LayerName[]>, leaf: string[]): LayerName[] {
  const out: LayerName[] = [];
  for (let n = leaf.length; n > 0; n--) { const hit = origins[leaf.slice(0, n).join(".")]; if (hit !== undefined) { addLayers(out, hit); return out; } }
  const under = `${leaf.join(".")}.`;
  for (const [path, origin] of Object.entries(origins)) if (path.startsWith(under)) addLayers(out, origin);
  return out;
}

/** Does this layer's OWN file put something on `keyPath` — an object included, and a non-object at any
 *  PREFIX included too, since that replaces the whole subtree beneath it?
 *
 *  The naming step's last resort, and it exists because `config/read` cannot answer this: `mergeTracked`
 *  records no `origins` entry for an OBJECT node, so an object assembled only out of empty objects is
 *  attributed to nobody, anywhere. A masked edit still owes the client an `overridingLayer`, and the layer
 *  chain already in memory can supply one. Reading the layers is safe HERE in a way it would not be for the
 *  verdict: a wrong name is a wrong signpost, while a verdict drawn from anything but the read side's own
 *  attribution is the two methods disagreeing again. */
function definesPath(cfg: Record<string, unknown> | undefined, keyPath: string[]): boolean {
  let node: unknown = cfg;
  for (const seg of keyPath) {
    if (!isPlainObject(node)) return node !== undefined; // a non-object above the path replaces all of it
    if (!Object.prototype.hasOwnProperty.call(node, seg)) return false;
    node = node[seg];
  }
  return true;
}

/** The highest-precedence layer ABOVE the target that puts anything on this path. */
function blockingLayerAbove(layers: ConfigLayer[], keyPath: string[], targetRank: number): LayerName | undefined {
  for (let r = LAYER_ORDER.length - 1; r > targetRank; r--) {
    const name = LAYER_ORDER[r];
    if (layers.some((l) => l.name === name && definesPath(l.config, keyPath))) return name;
  }
  return undefined;
}

/** Every place the merged view's DOTTED leaf addressing is ambiguous: the path of each key carrying a
 *  literal ".". `mergeTracked` keys `origins` by dotted path, so `{"a.b": …}` and `{a:{b:…}}` are one key
 *  there — a documented, closed limitation of the read side (D-M5-12). The write side cannot inherit it
 *  as a GUESS: a project `{"env.PROJKEY": "PROJ"}` under a user write of `["env","PROJKEY"]` made the
 *  reply name the value the client had just written as the value overriding it (review M1).
 *
 *  Scanned on the MERGED config rather than on each layer, because that is the object `origins` was keyed
 *  from: a dotted key some higher layer replaced away is gone from both, and cannot collide with anything.
 *  A dotted key stops the walk — the caller's prefix test covers its whole subtree. */
function dottedKeyPaths(cfg: Record<string, unknown>, prefix = "", out: string[] = []): string[] {
  for (const [k, v] of Object.entries(cfg)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (k.includes(".")) out.push(path);
    else if (isPlainObject(v)) dottedKeyPaths(v, path, out);
  }
  return out;
}

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

type MaskVerdict = { maskedEditIndexes: number[]; uncheckedEditIndexes: number[]; overriddenMetadata?: { message: string; overridingLayer: LayerName; effectiveValue?: unknown } };

/** The prose half of `uncheckedEditIndexes`, DERIVED from the index list rather than accumulated beside it:
 *  the two used to be pushed to in the same breath and kept in step by hand, which is one structure wearing
 *  two coats. The indexes are the fact; this is a rendering of them. */
const uncheckedWarning = (i: number, keyPath: string[]): string =>
  `could not check whether edit ${i} ("${keyPath.join(" / ")}") is overridden — a key containing "." collides with this path, and the effective view addresses leaves by dotted path`;

/** THE MASKING RULE (spec D-M5-13b), and the split that keeps it honest:
 *
 *    An edit is masked at a leaf exactly when the read side does not attribute that leaf to the layer that
 *    was written; the edit is `okOverridden` only when NO leaf it introduces is attributed to that layer.
 *
 *  **The VERDICT is one lookup in `origins`, and nothing else.** A leaf is in force when `origins[leaf]` IS
 *  the target (a scalar's single contributor) or CONTAINS it (an array's contributor list). Anything else —
 *  INCLUDING NO ENTRY AT ALL — is masked. No climb, no descendant scan, no "nobody outranks me" clause: each
 *  of those answers the PROXY question "is some layer visible at, above or below this leaf?", and every wave
 *  of fixes this method has had was one more state where the proxy and the rule diverged, each of them a
 *  dead write or a dead delete reported `ok`. The last two the proxy still got wrong were an object above
 *  the written path assembled only from EMPTY objects (which has no `origins` entry anywhere — not at the
 *  leaf, not above it, not below it) and an ancestor flattened by one layer and rebuilt by a higher one out
 *  of the written leaf's SIBLINGS. Under the rule both are simply "not attributed to me", which is the truth.
 *
 *  **The NAME is best-effort, and cannot reach the verdict.** `overridingLayer` is required by the published
 *  schema, so a masked edit must always produce one; naming may therefore use whatever is available — the
 *  ancestor/descendant neighbourhood in `origins` first, then the layer files themselves — because a wrong
 *  signpost is a far smaller failure than a wrong verdict, and nothing it computes can turn a dead write
 *  into `ok`. KEEP THEM APART: re-merging them is exactly how the proxy came to stand in for the rule.
 *
 *  Two consequences worth stating. `effectiveValue` is read out of the MERGED config, never out of one
 *  layer's own value — that is what makes the agreement structural rather than coincidental. And the
 *  both-sides-arrays carve-out is gone rather than kept beside this: an array the target contributed to has
 *  the target in its contributor list and is in force by the rule itself, while a higher array over a
 *  written SCALAR has an array origin the target is absent from and is masked by the same rule. */
function maskingVerdict(edits: WriteData["edits"], target: WriteData["target"], effective: Record<string, unknown>, origins: Record<string, LayerName | LayerName[]>, layers: ConfigLayer[]): MaskVerdict {
  const targetRank = LAYER_ORDER.indexOf(target);
  const rank = (l: LayerName): number => LAYER_ORDER.indexOf(l);
  const highest = (ls: LayerName[]): LayerName => ls.reduce((a, b) => (rank(b) > rank(a) ? b : a));
  /** THE VERDICT, in full. */
  const attributedToTarget = (leaf: string[]): boolean => { const o = origins[leaf.join(".")]; return o === target || (Array.isArray(o) && o.includes(target)); };
  /** THE NAME, in full — the read side's neighbourhood first, the layer files only where it holds nothing. */
  const nameFor = (leaf: string[]): LayerName | undefined => {
    const near = contributorsNear(origins, leaf).filter((l) => rank(l) > targetRank);
    return near.length ? highest(near) : blockingLayerAbove(layers, leaf, targetRank);
  };
  const hazards = dottedKeyPaths(effective);
  const out: MaskVerdict = { maskedEditIndexes: [], uncheckedEditIndexes: [] };
  edits.forEach((e, i) => {
    const leaves = introducedLeaves(e.keyPath, e.value, e.mergeStrategy);
    // `origins` addresses leaves by DOTTED path while a keyPath is an opaque segment array (D-M5-12), so a
    // segment carrying a literal dot mis-splits and any verdict drawn from it would be a guess. TWO sides
    // carry that hazard and only one of them is this edit's own: the written keyPath and value's keys
    // (which may never reach the merged view, so they are checked structurally), and a literal dot in some
    // OTHER layer's key that lands on this edit's dotted path in `origins` (checked against the merged
    // view, whose subtrees the prefix test covers in both directions). Reporting the gap beats reporting a
    // wrong verdict: the edit is left out of the masking answer entirely, named in `warnings` BY INDEX,
    // and listed in `uncheckedEditIndexes` so a client never has to parse prose to find it.
    const paths = [e.keyPath, ...leaves];
    const unchecked = paths.some((p) => p.some((seg) => seg.includes(".")))
      || paths.map((p) => p.join(".")).some((p) => hazards.some((h) => h === p || h.startsWith(`${p}.`) || p.startsWith(`${h}.`)));
    if (unchecked) { out.uncheckedEditIndexes.push(i); return; }
    let maskedBy: LayerName | undefined;
    if (e.mergeStrategy === "replace" && e.value === null) {
      // A DELETE introduces nothing, so no attribution can prove it landed — ABSENCE has to, stated
      // precisely so it stops swallowing the states above. In force when the merged view resolves NOTHING
      // at the path; in force too when what still resolves there belongs to the target or to a layer BELOW
      // it, because then the client's own value really is gone and something lower merely shows through
      // (naming a layer the target outranks would send it to edit a file that overrides nothing). Masked
      // when the path still resolves and the layers standing on it outrank the target.
      if (valueAt(effective, e.keyPath) === undefined) return;
      const contributors = contributorsNear(origins, e.keyPath);
      const masking = contributors.filter((l) => rank(l) > targetRank);
      if (contributors.length && masking.length === 0) return;
      // NO contributor anywhere under a path that still RESOLVES is the read side's blind spot rather than
      // an answer: what survives is an object with no leaves, which `mergeTracked` attributes to nobody. The
      // naming scan is the only thing that can break that tie, and it breaks it in the one safe direction —
      // masked only if some layer above the target genuinely holds this path.
      maskedBy = masking.length ? highest(masking) : blockingLayerAbove(layers, e.keyPath, targetRank);
      if (maskedBy === undefined) return;
    } else {
      // An empty object — however deeply nested — introduces no leaf at all, so there is nothing of it to
      // mask and nothing for the rule to look up. `ok`: the effective view gained nothing from this edit.
      if (leaves.length === 0) return;
      if (leaves.some(attributedToTarget)) return; // THE RULE — the whole verdict, one lookup per leaf
      for (const leaf of leaves) { const n = nameFor(leaf); if (n !== undefined && (maskedBy === undefined || rank(n) > rank(maskedBy))) maskedBy = n; }
    }
    out.maskedEditIndexes.push(i);
    // `effectiveValue` is OMITTED, never null, when the merged view has no value at this keyPath — an
    // ancestor is a scalar, say, so the path does not resolve at all. A settings file may legitimately hold
    // a null leaf, so `null` would be indistinguishable from a real value; absence is unambiguous, and the
    // published schema marks the key optional for exactly this case.
    const effectiveValue = valueAt(effective, e.keyPath);
    // Masked with nothing above the target to name it: the edit was undone from INSIDE this same request —
    // a later edit in the batch overwrote or deleted what this one wrote. `overridingLayer` is required, so
    // the target names itself and the message says which kind of loss this is, rather than reporting `ok`
    // for an edit the client can no longer see anywhere.
    out.overriddenMetadata ??= {
      message: maskedBy !== undefined ? `the ${maskedBy} layer defines this key with higher precedence`
        : `nothing this edit introduced is in the effective view, and no layer above ${target} holds this key — what the ${target} layer itself now holds here is not what this edit wrote`,
      overridingLayer: maskedBy ?? target,
      ...(effectiveValue !== undefined ? { effectiveValue } : {}),
    };
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
    const { maskedEditIndexes, uncheckedEditIndexes, overriddenMetadata } = maskingVerdict(data.edits, data.target, effective, origins, layers);
    // DEDUPED (review M5): the warning names the top-level key, so three edits under one unknown key are
    // three copies of one sentence — noise a client has to collapse itself before showing it.
    const warnings = [...new Set([
      ...data.edits.filter((e) => !KNOWN_TOP_LEVEL.has(e.keyPath[0])).map((e) => `unknown top-level settings key "${e.keyPath[0]}" (written anyway)`),
      ...uncheckedEditIndexes.map((i) => uncheckedWarning(i, data.edits[i].keyPath)),
    ])];
    ctx.peer.reply(id, {
      status: maskedEditIndexes.length ? "okOverridden" : "ok", version: written.version, filePath,
      ...(overriddenMetadata ? { overriddenMetadata } : {}),
      ...(maskedEditIndexes.length ? { maskedEditIndexes } : {}),
      // The machine-readable half of "reported, never guessed" (review M2). `status: "ok"` beside a
      // populated `uncheckedEditIndexes` means "not reported as overridden", NOT "verified in force", and
      // a client can tell the two apart without string-matching a sentence — which is all it had before.
      ...(uncheckedEditIndexes.length ? { uncheckedEditIndexes } : {}),
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
