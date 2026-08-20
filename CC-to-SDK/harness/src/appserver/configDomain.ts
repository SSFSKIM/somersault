// src/appserver/configDomain.ts — the config domain's three handlers: `config/read` plus the two writes.
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { platform } from "node:os";
import { ERR } from "./rpc.js";
import type { Handler } from "./server.js";
import { claudeConfigDir } from "../config/claudeHome.js";
import { layerPaths, readLayers, effectiveView, SettingsMergeError } from "./configLayers.js";
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

/** The typed refusals of the two modules under this one, mapped in ONE place because both handlers catch
 *  the same set and a mapping written twice is a mapping that drifts once.
 *
 *  `SettingsMergeError` (configLayers, fix wave G / G5) rides `ConfigValidationError`'s code and carries
 *  its `data.code`, and the reason is the precedent `readTargetDoc` already set for unparseable bytes: the
 *  answer to a settings FILE that cannot be represented is "go fix the file", not "the server failed". It
 *  reaches `config/read` (where a layer on disk holds the shape) and the two writes (where the client's own
 *  `upsert` value does) through the same sentence, which names the index it refused. */
function replyConfigError(ctx: Parameters<Handler>[1], id: Parameters<Handler>[2], e: unknown): boolean {
  if (e instanceof ConfigError) { ctx.peer.replyError(id, configErrorWireCode(e.code), e.message, { code: e.code }); return true; }
  if (e instanceof SettingsMergeError) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, e.message, { code: "ConfigValidationError" }); return true; }
  return false;
}

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

/** WHERE the user layer is, for both handlers — one function, because two spellings of it is how the read
 *  and the write can start naming different files.
 *
 *  With no dep the answer is the ENGINE's own (`claudeConfigDir`): `CLAUDE_CONFIG_DIR` when it is set,
 *  `~/.claude` otherwise. That is not a nicety — `ccx serve` constructs `new AppServer({ token })` with no
 *  deps at all, so production always lands here, and a `CLAUDE_CONFIG_DIR` this harness's own tenant preset
 *  exports made every reply describe a file no engine would ever load: `config/read` served settings the
 *  engine ignores and `config/value/write` answered `ok` for a write nothing would read.
 *
 *  `configHome` keeps its meaning — the BASE whose `.claude` holds the file — and keeps winning, because it
 *  is a test/embedder override and the alternative is a suite that points at a temp directory and is
 *  silently redirected onto the operator's real settings by an ambient variable.
 *
 *  RESOLVED AGAINST THE REQUEST'S CWD when it is relative (fix wave G / G6). `claudeConfigDir` deliberately
 *  preserves an exported-but-EMPTY `CLAUDE_CONFIG_DIR` as a value rather than falling back, because the
 *  engine does: it resolves `''` and reads `./settings.json` — relative to the cwd the ENGINE was launched
 *  with, which for every project-scoped request is the cwd the request carries. Deriving the path without
 *  resolving it left `canonicalPath` to anchor the tail on the APP SERVER's cwd instead, so `config/read`
 *  described, and `config/value/write` successfully wrote, a `settings.json` no engine for that project
 *  would ever open — the same class as reading the wrong root, in the one env shape D-M5-23a's fix left.
 *  With no cwd in the request there is nothing else to anchor to and `process.cwd()` is the honest answer;
 *  making that explicit changes nothing and states which cwd is meant. */
export const userLayerDir = (deps: { configHome?: string }, env: NodeJS.ProcessEnv = process.env, cwd?: string): string => {
  const dir = deps.configHome !== undefined ? join(deps.configHome, ".claude") : claudeConfigDir(env);
  return isAbsolute(dir) ? dir : resolve(cwd ?? process.cwd(), dir);
};

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
  const managed = srv.deps.managedSettingsPath !== undefined ? srv.deps.managedSettingsPath : DEFAULT_MANAGED_PATH;
  try {
    const cwd = parsed.data.cwd !== undefined ? await resolveConfigCwd(parsed.data.cwd) : undefined;
    // AFTER the cwd, not before it (fix wave G / G6): a relative config root is anchored on the request's
    // own cwd, so the user layer cannot be derived until that cwd has been resolved.
    const userDir = userLayerDir(srv.deps, process.env, cwd);
    // Canonicalized HERE, before `readLayers`, so `paths` and `layers` still agree by string (the
    // `versions` walk below matches on `filePath`) and so a layer's `filePath` is the same string a write
    // reply gives for the same file — `resolveRealTarget` canonicalizes too, and one file answering to two
    // names across the two methods left a client with no way to correlate them (review I2).
    const paths = await Promise.all((await layerPaths(userDir, managed, cwd)).map(async (p) => ({ ...p, filePath: await canonicalPath(p.filePath) })));
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
    if (replyConfigError(ctx, id, e)) return;
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

/** Structural equality over the shapes a settings file can hold. The delete verdict below compares two
 *  MERGED views at one path, and neither cheap test will do: `===` calls every separately-merged object
 *  different, and `JSON.stringify` calls two equal objects different whenever their keys were assembled in
 *  a different order. Only values that came out of `JSON.parse` reach here — no cycles, no `undefined`
 *  members, no non-finite numbers — so this is the whole comparison, not a subset of one. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b))
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => sameValue(x, b[i]));
  if (!isPlainObject(a) || !isPlainObject(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && sameValue(a[k], b[k]));
}

type MaskVerdict = { maskedEditIndexes: number[]; uncheckedEditIndexes: number[]; overriddenMetadata?: { message: string; overridingLayer: LayerName; effectiveValue?: unknown } };

/** The prose half of `uncheckedEditIndexes`, DERIVED from the index list rather than accumulated beside it:
 *  the two used to be pushed to in the same breath and kept in step by hand, which is one structure wearing
 *  two coats. The indexes are the fact; this is a rendering of them. */
const uncheckedWarning = (i: number, keyPath: string[]): string =>
  `could not check whether edit ${i} ("${keyPath.join(" / ")}") is overridden — a key containing "." collides with this path, and the effective view addresses leaves by dotted path`;

/** THE MASKING RULE (spec D-M5-13b), and the split that keeps it honest. It has TWO branches because an
 *  edit that PUTS a value and an edit that TAKES one away are asked different questions — see
 *  `deleteMask` for the second, which shares none of this machinery:
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
 *  (A delete is not an exception to that. Its name and its verdict come out of one walk, but the walk is
 *  the VERDICT's — the name is a by-product of it, never an input to it.)
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
  /** THE DELETE VERDICT — a COUNTERFACTUAL over merges, and deliberately not one byte of attribution.
   *
   *  A delete introduces no leaf, so the rule above has nothing to look up and the question has to be put
   *  to the layer chain instead: *now that my value is gone, does any layer above me actually contribute
   *  something that surfaces at this path?* Merge every layer BUT the target's and compare that value at
   *  the path with the merge of the layers strictly BELOW the target. They agree exactly when nothing above
   *  the target changes what is served here — the key is gone, or what remains is a lower layer showing
   *  through, and both are the `ok` case. They differ exactly when a layer above put something there.
   *
   *  Two rejected shortcuts, each of which was wrong in its own direction. Asking `origins` who stands
   *  near the path: `mergeTracked` records no entry for an OBJECT node, so a single leaf from a layer BELOW
   *  the target made that neighbourhood non-empty and answered for the whole path, reporting a dead delete
   *  as `ok`. Asking whether any layer above merely DEFINES the path: an `{}` above an object defines it
   *  and contributes nothing, so a live delete would be reported masked. The counterfactual reads no
   *  attribution at all, which is why neither blind spot can reach it, and it merges through the read
   *  side's own `effectiveView`, which is what keeps the two methods agreeing by construction.
   *
   *  The NAME falls out of the same walk: the layers above the target join the chain in precedence order
   *  and the LAST one to move the value at this path is the one standing on it. It always exists when the
   *  verdict is masked — the value moved across that chain, so some single step of it moved the value.
   *
   *  A path that resolves to nothing once the target is out is `ok` whatever sits below: nothing surfaces
   *  there at all, so nothing above can be surfacing. That is the flattened-ancestor case, unchanged.
   *
   *  ONE STATE, settled deliberately, where this and `config/read`'s attribution describe the same tree in
   *  different words: a layer ABOVE the target holds exactly what a layer BELOW already serves at the path.
   *  The counterfactual calls the delete IN FORCE, and that is the right answer — take the higher layer
   *  away and nothing at the path moves, so nothing above the target is making a difference, which is the
   *  same situation as falling through to a lower layer and has never been anything but `ok`. `origins`
   *  will nonetheless name the HIGHER layer for that key, because a scalar replacement is attributed to
   *  whoever wrote last even when the bytes are identical. Both statements are true of that tree, and the
   *  contract the two methods owe each other is that they never disagree about whether an edit is in
   *  FORCE — not that last-writer attribution and the verdict reach for the same word. Do not "fix" this
   *  back into a mask; the test file pins it, and pins what `config/read` says beside it.
   *
   *  The mirror shape for a VALUE write — a layer above holding exactly what the target is writing — is
   *  masked, and stays masked. A value write introduces a leaf, so the read side has a first-class verdict
   *  about it (`origins` names the higher layer, so the target's write is not what is in force) and
   *  reporting `ok` would be the two methods disagreeing about force, not merely about naming. A delete
   *  introduces no leaf, which is exactly why its verdict has to be built here instead of looked up. */
  const deleteMask = (keyPath: string[]): { masked: boolean; by?: LayerName } => {
    const chain = layers.filter((l) => rank(l.name) < targetRank);
    const below = valueAt(effectiveView(chain).config, keyPath);
    let value = below, by: LayerName | undefined;
    for (const above of layers.filter((l) => rank(l.name) > targetRank)) {
      chain.push(above);
      const next = valueAt(effectiveView(chain).config, keyPath);
      if (!sameValue(next, value)) by = above.name;
      value = next;
    }
    return value === undefined || sameValue(value, below) ? { masked: false } : { masked: true, by };
  };
  /** A leaf, moved up to the granularity the READ side actually attributes at (fix wave G / P2-1#2).
   *  `introducedLeaves` walks the written VALUE, so an upsert of `{"0": "Bash(ls)"}` at `permissions.allow`
   *  reports `permissions.allow.0`. `effectiveView` never keys `origins` below an array: an object merged
   *  over an array is an ARRAY contributor claimed at the array's own path (configLayers.ts's `claimArray`),
   *  and its numeric keys address ELEMENTS of that array, which have no entries of their own. So the lookup
   *  missed, every such edit was `okOverridden`, and — with nothing above the target to name — self-named,
   *  telling the client its write was dead while `config/read` served exactly what it had written.
   *
   *  Truncating at the array is not a special case bolted on: it is the same granularity the rule is stated
   *  in, applied to a path that was addressing one level too deep. The NON-index keys of such an object
   *  truncate to the same path and stay MASKED, which is also right — they ride the array as properties
   *  JSON never serializes, so nothing a client can see came of them, and `claimArray` correspondingly
   *  refuses to name their layer. One mapping decides both. */
  const atArrayLeaf = (leaf: string[]): string[] => {
    let node: unknown = effective;
    for (let i = 0; i < leaf.length; i++) {
      node = isPlainObject(node) ? node[leaf[i]] : undefined;
      if (Array.isArray(node)) return leaf.slice(0, i + 1);
    }
    return leaf;
  };
  const hazards = dottedKeyPaths(effective);
  const out: MaskVerdict = { maskedEditIndexes: [], uncheckedEditIndexes: [] };
  const masked: Array<{ by?: LayerName; effectiveValue: unknown }> = [];
  edits.forEach((e, i) => {
    // DEDUPED after the truncation: two numeric keys of one object land on one array path, and a leaf
    // counted twice would only ever be looked up twice with the same answer.
    const leaves = [...new Map(introducedLeaves(e.keyPath, e.value, e.mergeStrategy).map(atArrayLeaf).map((p) => [p.join(" "), p])).values()];
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
      // A DELETE introduces nothing, so no attribution can prove it landed — the counterfactual over the
      // layer chain answers instead, verdict and name together. `deleteMask` states the whole rule.
      const verdict = deleteMask(e.keyPath);
      if (!verdict.masked) return;
      maskedBy = verdict.by;
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
    masked.push({ by: maskedBy, effectiveValue: valueAt(effective, e.keyPath) });
  });
  // WHICH masked edit the single `overriddenMetadata` describes. Not simply the first: a masked edit with
  // nothing above the target to name was undone from INSIDE this same request — a later edit overwrote or
  // deleted what it wrote — and it names the TARGET, which is the truth but is also the one name a client
  // can do nothing with. First-wins let such an edit evict a real `overridingLayer` from a batch that had
  // one, costing the reply its only actionable signpost. So: the first masked edit a layer ABOVE the target
  // overrides, and the self-named one only when the batch holds nothing better.
  const described = masked.find((m) => m.by !== undefined) ?? masked[0];
  if (described !== undefined) out.overriddenMetadata = {
    message: described.by !== undefined ? `the ${described.by} layer defines this key with higher precedence`
      : `nothing this edit introduced is in the effective view, and no layer above ${target} holds this key — what the ${target} layer itself now holds here is not what this edit wrote`,
    overridingLayer: described.by ?? target,
    ...(described.effectiveValue !== undefined ? { effectiveValue: described.effectiveValue } : {}),
  };
  return out;
}

/** The post-write masking pass, and the one place it is allowed to give up. It runs AFTER the bytes are on
 *  disk, so its failure is not the write's failure: every edit becomes `unchecked` and the reason is
 *  reported, which is the same answer shape a dotted-key collision already produces. Only the ANALYSIS is
 *  fenced — the write itself, and every refusal that precedes it, are untouched. */
async function maskingAnalysis(srv: Parameters<Handler>[0], data: WriteData, cwdReal: string | undefined): Promise<{ verdict: MaskVerdict; failure?: string }> {
  const managed = srv.deps.managedSettingsPath !== undefined ? srv.deps.managedSettingsPath : DEFAULT_MANAGED_PATH;
  try {
    // Masking: EVERY edit evaluated (plan review F15), against the SAME `effectiveView` `config/read`
    // serves — see `maskingVerdict` for why that shared derivation is the contract.
    const layers = await readLayers(await layerPaths(userLayerDir(srv.deps, process.env, cwdReal), managed, cwdReal));
    const { config: effective, origins } = effectiveView(layers);
    return { verdict: maskingVerdict(data.edits, data.target, effective, origins, layers) };
  } catch (e) {
    return {
      verdict: { maskedEditIndexes: [], uncheckedEditIndexes: data.edits.map((_, i) => i) },
      failure: `the write landed, but whether it is overridden could not be checked: the settings layers could not be merged (${e instanceof Error ? e.message : String(e)})`,
    };
  }
}

/** The shared spine of `config/value/write` and `config/batchWrite`. Two behaviours a client has to know
 *  about, both of them properties of the design rather than gaps in it:
 *
 *  1. **Acquiring a contended target can BLOCK for tens of seconds, and then may still refuse.** The
 *     cross-process `<file>.lock` is breakable only once its owner's LEASE has expired (30s by default),
 *     so a request that meets a dead writer's leftover waits out the remainder of that window, breaks it,
 *     and proceeds. A writer that is merely SLOW keeps refreshing that lease, so it is never broken and
 *     the waiter refuses `ConfigLocked` (`BUSY`, -33001) at the deadline instead — the honest answer, and
 *     the one D-M5-24 chose over the eviction that used to silently destroy one of the two writes. A
 *     client must budget for the wait AND handle the refusal; both mean "retry shortly".
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
    const userDir = userLayerDir(srv.deps, process.env, cwdReal);
    const nominal = data.target === "user" ? join(userDir, "settings.json")
      : join(cwdReal as string, ".claude", data.target === "project" ? "settings.json" : "settings.local.json");
    // Resolved BEFORE the lock, and the SAME resolved path feeds the read and the write: `withFileLock`'s
    // in-process queue is keyed by the path string, so two spellings of one file would otherwise take two
    // different locks and lose mutual exclusion between them.
    const filePath = await resolveRealTarget(nominal);
    // Asserted BEFORE the lock, because the lock file lives in that same directory: a parent that exists
    // but is not a usable directory (a dangling link, a symlink loop, a regular file where `.claude` should
    // be) used to surface as node's raw `mkdir` message under -32603, which a client can do nothing with.
    await assertWritableParent(filePath);
    const written = await withFileLock(filePath, async (fence) => {
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
      // The CAS is asserted TWICE: once here against the client's token, and once inside the commit
      // against the bytes still on disk one syscall before the rename (D-M5-24). The second assertion is
      // not redundant — it is the one that holds when mutual exclusion itself fails, and it is what makes
      // "a reply of `ok` means the bytes survived" true rather than merely intended. It costs one small
      // re-read of a file this process read moments ago, and it refuses BEFORE any byte moves, so the
      // retry a `ConfigLocked` invites is safe even for the non-idempotent `upsert` of an array.
      return writeTargetDoc(filePath, next, { expectVersion: version, fence });
    });
    // PAST THE COMMIT. Everything below describes bytes already on disk, so nothing below may turn this
    // into a failure reply: a client told its write failed retries it, and an `upsert` of an array is not
    // idempotent (arrays concatenate and dedupe by SameValueZero, so object entries never collapse), which
    // turned one hook registration into two. The reachable failure is real, not hypothetical — a
    // pathologically deep object in ANOTHER layer blows `effectiveView`'s recursion at a depth `JSON.parse`
    // accepts, and the write path's own depth screen covers only the value it was handed. So the masking
    // pass is fenced: if it cannot be computed, the reply says `ok` with every edit UNCHECKED — the
    // vocabulary this reply already has for "not reported as overridden, and not verified in force".
    const analysis = await maskingAnalysis(srv, data, cwdReal);
    const { maskedEditIndexes, uncheckedEditIndexes, overriddenMetadata } = analysis.verdict;
    // DEDUPED (review M5): the warning names the top-level key, so three edits under one unknown key are
    // three copies of one sentence — noise a client has to collapse itself before showing it.
    const warnings = [...new Set([
      ...data.edits.filter((e) => !KNOWN_TOP_LEVEL.has(e.keyPath[0])).map((e) => `unknown top-level settings key "${e.keyPath[0]}" (written anyway)`),
      ...(analysis.failure !== undefined ? [analysis.failure] : uncheckedEditIndexes.map((i) => uncheckedWarning(i, data.edits[i].keyPath))),
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
    if (replyConfigError(ctx, id, e)) return;
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
