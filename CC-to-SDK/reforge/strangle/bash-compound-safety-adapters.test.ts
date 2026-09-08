// C13b aggregate and child-decision graph-adapter controls.
//
//   npx tsx strangle/bash-compound-safety-adapters.test.ts
//
// Primitive captures cross the graph seam so the adapter can reject an owned
// semantic value that silently went stale. This suite perturbs each such value
// in its exact forwarded position and verifies that no owned root delegates
// before the named assertion fires.
import { sep as pathSeparator } from "node:path";
import { PARSE_ABORTED } from "./modules/shell-parser/reference.js";
import { BASH_DECISION_ROOTS } from "./bash-compound-safety-capture-specs.js";
import {
  BASH_DECISION_SABOTAGE_SHAPES,
  DECISION_ROOT_SPECS,
  OWNED_DECISION_HELPERS,
  OWNED_DECISION_PRIMITIVES,
  createBashCompoundSafetyAdapters,
  wrapBashCompoundSafetySabotage,
} from "./modules/bash-compound-safety.js";

let checks = 0;
const failures: string[] = [];
const check = (label: string, ok: boolean, detail = ""): void => {
  checks++;
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
};

const marker = {
  entry: { root: "entry" },
  core: { root: "core" },
  failure: {
    behavior: "deny",
    message: "failure root marker",
    decisionReason: { type: "other", reason: "failure root marker" },
  },
};
let delegations = 0;
let entryRuntime: any;
let coreRuntime: any;
let failureEffects: any;
const adapters = createBashCompoundSafetyAdapters({
  async checkBashPermission(_input: unknown, _context: unknown, _classifier: unknown, runtime: unknown) {
    delegations++;
    entryRuntime = runtime;
    return marker.entry;
  },
  async checkBashPermissionCore(_input: unknown, _context: unknown, _classifier: unknown, runtime: unknown) {
    delegations++;
    coreRuntime = runtime;
    return marker.core;
  },
  permissionCheckFailureDecision(_toolName: unknown, _context: unknown, effects: unknown) {
    delegations++;
    failureEffects = effects;
    return marker.failure;
  },
});

const unique = (name: string) => Object.assign(() => name, { captureName: name });
const input = { command: "echo ok" };
const context = { context: true };
const classifier = unique("modelClassifier");
const entryPorts = {
  readPermissionContext: unique("entry.readPermissionContext"),
  emitTelemetry: unique("entry.emitTelemetry"),
  bashTool: { name: "Bash" },
  clampRejectionReason: "bashCommandClamp: no clamp rule matches this command",
  checkCore: unique("entry.checkCore"),
  decorateDecision: unique("entry.decorateDecision"),
  sandboxAutoAllowReason: "Auto-allowed with sandbox (autoAllowBashIfSandboxed enabled)",
  parseAborted: PARSE_ABORTED,
};
const entryArgs = [
  input,
  context,
  classifier,
  entryPorts.readPermissionContext,
  entryPorts.emitTelemetry,
  entryPorts.bashTool,
  entryPorts.clampRejectionReason,
  entryPorts.checkCore,
  entryPorts.decorateDecision,
  entryPorts.sandboxAutoAllowReason,
  entryPorts.parseAborted,
];

const corePorts = {
  readPermissionContext: unique("core.readPermissionContext"),
  replaceSessionEnvironmentKeys: unique("core.replaceSessionEnvironmentKeys"),
  checkTooComplexSafety: unique("core.checkTooComplexSafety"),
  checkTooComplexSandbox: unique("core.checkTooComplexSandbox"),
  emitTelemetry: unique("core.emitTelemetry"),
  bashTool: { name: "Bash" },
  checkInvalidSemanticsRules: unique("core.checkInvalidSemanticsRules"),
  checkSandboxAutoAllow: unique("core.checkSandboxAutoAllow"),
  checkExactPermission: unique("core.checkExactPermission"),
  checkPermission: unique("core.checkPermission"),
  isCdGitSequenceSafe: unique("core.isCdGitSequenceSafe"),
  currentWorkingDirectory: unique("core.currentWorkingDirectory"),
  checkPathSafety: unique("core.checkPathSafety"),
  platform: unique("core.platform"),
  allowedDirectories: unique("core.allowedDirectories"),
  resolvePathPolicy: unique("core.resolvePathPolicy"),
  filesystem: unique("core.filesystem"),
  pathSeparator,
  checkDangerousRemoval: unique("core.checkDangerousRemoval"),
  resolveLeadingDirectoryChange: unique("core.resolveLeadingDirectoryChange"),
  isCdGitAstSequenceSafe: unique("core.isCdGitAstSequenceSafe"),
  hasUnsafeGitStructureFromAnalysis: unique("core.hasUnsafeGitStructureFromAnalysis"),
  hasUnsafeGitStructureFromCommand: unique("core.hasUnsafeGitStructureFromCommand"),
  checkDirectCommand: unique("core.checkDirectCommand"),
  checkSubcommandPermission: unique("core.checkSubcommandPermission"),
  suggestionLimit: 5,
};
const coreArgs = [
  input,
  context,
  classifier,
  corePorts.readPermissionContext,
  corePorts.replaceSessionEnvironmentKeys,
  corePorts.checkTooComplexSafety,
  corePorts.checkTooComplexSandbox,
  corePorts.emitTelemetry,
  corePorts.bashTool,
  corePorts.checkInvalidSemanticsRules,
  corePorts.checkSandboxAutoAllow,
  corePorts.checkExactPermission,
  corePorts.checkPermission,
  corePorts.isCdGitSequenceSafe,
  corePorts.currentWorkingDirectory,
  corePorts.checkPathSafety,
  corePorts.platform,
  corePorts.allowedDirectories,
  corePorts.resolvePathPolicy,
  corePorts.filesystem,
  corePorts.pathSeparator,
  corePorts.checkDangerousRemoval,
  corePorts.resolveLeadingDirectoryChange,
  corePorts.isCdGitAstSequenceSafe,
  corePorts.hasUnsafeGitStructureFromAnalysis,
  corePorts.hasUnsafeGitStructureFromCommand,
  corePorts.checkDirectCommand,
  corePorts.checkSubcommandPermission,
  corePorts.suggestionLimit,
];

const failurePorts = {
  readPermissionContext: unique("failure.readPermissionContext"),
  clampFailureReason: "bashCommandClamp fail-closed: permission check crashed",
};
const failureArgs = ["Bash", context, failurePorts.readPermissionContext, failurePorts.clampFailureReason];

const entryResult = await adapters.checkOwnedBashPermission(...entryArgs);
check("healthy entry primitives delegate to the owned root", entryResult === marker.entry);
check("entry effects and owned decisions keep manifest order", [
  entryRuntime.effects.readPermissionContext,
  entryRuntime.effects.emitTelemetry,
  entryRuntime.checkCore,
  entryRuntime.decisions.decorateDecision,
].every((value, index) => value === [
  entryPorts.readPermissionContext,
  entryPorts.emitTelemetry,
  entryPorts.checkCore,
  entryPorts.decorateDecision,
][index]));
check("entry keeps subprocess environment scrubbing disabled", entryRuntime.effects.isSubprocessEnvironmentScrubbingEnabled() === false);
check(
  "entry runtime exposes only the owned root's declared namespaces",
  JSON.stringify(Object.keys(entryRuntime).sort()) ===
    JSON.stringify(["checkCore", "decisions", "effects"]),
);
check(
  "entry effects expose exactly the genuine effect ports",
  JSON.stringify(Object.keys(entryRuntime.effects).sort()) ===
    JSON.stringify([
      "emitTelemetry",
      "isSubprocessEnvironmentScrubbingEnabled",
      "readPermissionContext",
    ]),
);
check(
  "entry decisions expose exactly the owned decision ports",
  JSON.stringify(Object.keys(entryRuntime.decisions).sort()) ===
    JSON.stringify(["decorateDecision"]),
);

const coreResult = await adapters.checkOwnedBashPermissionCore(...coreArgs);
check("healthy core primitives delegate to the owned root", coreResult === marker.core);
const expectedCoreEffects = [
  corePorts.readPermissionContext,
  corePorts.replaceSessionEnvironmentKeys,
  corePorts.emitTelemetry,
  corePorts.currentWorkingDirectory,
  corePorts.platform,
  corePorts.allowedDirectories,
  corePorts.resolvePathPolicy,
  corePorts.filesystem,
];
const expectedCoreDecisions = [
  corePorts.checkTooComplexSafety,
  corePorts.checkTooComplexSandbox,
  corePorts.checkInvalidSemanticsRules,
  corePorts.checkSandboxAutoAllow,
  corePorts.checkExactPermission,
  corePorts.isCdGitSequenceSafe,
  corePorts.checkPathSafety,
  corePorts.checkDangerousRemoval,
  corePorts.resolveLeadingDirectoryChange,
  corePorts.isCdGitAstSequenceSafe,
  corePorts.hasUnsafeGitStructureFromAnalysis,
  corePorts.hasUnsafeGitStructureFromCommand,
  corePorts.checkDirectCommand,
  corePorts.checkSubcommandPermission,
];
check("core effects and owned decisions keep manifest order", [
  coreRuntime.effects.readPermissionContext,
  coreRuntime.effects.replaceSessionEnvironmentKeys,
  coreRuntime.effects.emitTelemetry,
  coreRuntime.effects.currentWorkingDirectory,
  coreRuntime.effects.platform,
  coreRuntime.effects.allowedDirectories,
  coreRuntime.effects.resolvePathPolicy,
  coreRuntime.effects.filesystem,
].every((value, index) => value === expectedCoreEffects[index]) && [
  coreRuntime.decisions.checkTooComplexSafety,
  coreRuntime.decisions.checkTooComplexSandbox,
  coreRuntime.decisions.checkInvalidSemanticsRules,
  coreRuntime.decisions.checkSandboxAutoAllow,
  coreRuntime.decisions.checkExactPermission,
  coreRuntime.decisions.isCdGitSequenceSafe,
  coreRuntime.decisions.checkPathSafety,
  coreRuntime.decisions.checkDangerousRemoval,
  coreRuntime.decisions.resolveLeadingDirectoryChange,
  coreRuntime.decisions.isCdGitAstSequenceSafe,
  coreRuntime.decisions.hasUnsafeGitStructureFromAnalysis,
  coreRuntime.decisions.hasUnsafeGitStructureFromCommand,
  coreRuntime.decisions.checkDirectCommand,
  coreRuntime.decisions.checkSubcommandPermission,
].every((value, index) => value === expectedCoreDecisions[index]) &&
  coreRuntime.checkPermission === corePorts.checkPermission);
check("core keeps subprocess environment scrubbing disabled", coreRuntime.effects.isSubprocessEnvironmentScrubbingEnabled() === false);
check(
  "core runtime exposes only the owned root's declared namespaces",
  JSON.stringify(Object.keys(coreRuntime).sort()) ===
    JSON.stringify(["checkPermission", "decisions", "effects"]),
);
check(
  "core effects expose exactly the genuine effect ports",
  JSON.stringify(Object.keys(coreRuntime.effects).sort()) ===
    JSON.stringify([
      "allowedDirectories",
      "currentWorkingDirectory",
      "emitTelemetry",
      "filesystem",
      "isSubprocessEnvironmentScrubbingEnabled",
      "platform",
      "readPermissionContext",
      "replaceSessionEnvironmentKeys",
      "resolvePathPolicy",
    ]),
);
check(
  "core decisions expose exactly the owned decision ports",
  JSON.stringify(Object.keys(coreRuntime.decisions).sort()) ===
    JSON.stringify([
      "checkDangerousRemoval",
      "checkDirectCommand",
      "checkExactPermission",
      "checkInvalidSemanticsRules",
      "checkPathSafety",
      "checkSandboxAutoAllow",
      "checkSubcommandPermission",
      "checkTooComplexSafety",
      "checkTooComplexSandbox",
      "hasUnsafeGitStructureFromAnalysis",
      "hasUnsafeGitStructureFromCommand",
      "isCdGitSequenceSafe",
      "isCdGitAstSequenceSafe",
      "resolveLeadingDirectoryChange",
    ].sort()),
);

const failureResult = adapters.bashPermissionFailureDecision(...failureArgs);
check("healthy failure primitive delegates to the owned root", failureResult === marker.failure);
check("failure effectful port keeps manifest order", failureEffects.readPermissionContext === failurePorts.readPermissionContext);

async function stale(
  label: string,
  adapter: (...args: any[]) => unknown,
  healthyArgs: unknown[],
  index: number,
  perturbed: unknown,
  named: string,
) {
  const args = [...healthyArgs];
  args[index] = perturbed;
  const before = delegations;
  let message = "";
  try {
    await adapter(...args);
  } catch (error) {
    message = String((error as Error).message);
  }
  check(`${label} throws its named stale-value error before delegation`,
    delegations === before && message.includes(`'${named}`) && message.includes("owned copy is stale"), message.split("\n")[0]);
}

await stale("entry bashTool", adapters.checkOwnedBashPermission, entryArgs, 5, { name: "Shell" }, "bashTool");
await stale("entry clampRejectionReason", adapters.checkOwnedBashPermission, entryArgs, 6, "changed clamp reason", "clampRejectionReason");
await stale("entry sandboxAutoAllowReason", adapters.checkOwnedBashPermission, entryArgs, 9, "changed sandbox reason", "sandboxAutoAllowReason");
await stale("entry parseAborted", adapters.checkOwnedBashPermission, entryArgs, 10, Symbol("changed"), "parseAborted");
await stale("core bashTool", adapters.checkOwnedBashPermissionCore, coreArgs, 8, { name: "Shell" }, "bashTool");
await stale("core pathSeparator", adapters.checkOwnedBashPermissionCore, coreArgs, 20, pathSeparator === "/" ? "\\" : "/", "pathSeparator");
await stale("core suggestionLimit", adapters.checkOwnedBashPermissionCore, coreArgs, 28, 6, "suggestionLimit");
await stale("failure clampFailureReason", adapters.bashPermissionFailureDecision, failureArgs, 3, "changed failure reason", "clampFailureReason");

// The 25 decision-root adapters receive graph captures positionally and hand
// the owned bodies a semantic object. Drive this from the independently pinned
// capture specs so a reordered or omitted adapter entry cannot agree with its
// own duplicate by construction.
const decisionMarker = { root: "decision" };
type DecisionCapture = {
  as: string;
  kind: "primitive" | "pure-helper" | "effectful-port" | "owned-binding";
  owned?: true;
};
type DecisionRoot = {
  name: string;
  adapter: string;
  params: number;
  captures: readonly DecisionCapture[];
};
const decisionRoots = Object.values(BASH_DECISION_ROOTS) as unknown as DecisionRoot[];
const decisionRootSpecs = DECISION_ROOT_SPECS as Record<
  string,
  { params: number; captures: string[]; ownedCaptures?: string[] }
>;
const decisionPrimitiveValues = OWNED_DECISION_PRIMITIVES as Record<
  string,
  unknown
>;
const decisionHelperValues = OWNED_DECISION_HELPERS as Record<string, unknown>;
let decisionDelegations = 0;
const seenDecisionPorts = new Map<string, Record<string, unknown>>();
const decisionOverrides = Object.fromEntries(
  decisionRoots.map((root) => [
    root.adapter,
    (...args: unknown[]) => {
      decisionDelegations++;
      seenDecisionPorts.set(
        root.adapter,
        args.at(-1) as Record<string, unknown>,
      );
      return decisionMarker;
    },
  ]),
);
const decisionAdapters = createBashCompoundSafetyAdapters(
  decisionOverrides,
) as Record<string, (...args: any[]) => any>;

function graphCopy(value: unknown): unknown {
  if (value instanceof Set) return new Set(value);
  if (value instanceof RegExp) return new RegExp(value.source, value.flags);
  return value;
}

function changedPrimitive(name: string, value: unknown): unknown {
  if (name === "bashTool") return { name: "Shell" };
  if (value instanceof Set) {
    const members = [...value];
    members[0] = "__c13b_perturbed_member__";
    return new Set(members);
  }
  if (value instanceof RegExp) return new RegExp(`${value.source}x`, value.flags);
  if (typeof value === "symbol") return Symbol("changed");
  if (typeof value === "string") return `${value} changed`;
  throw new Error(`no decision primitive perturbation for ${name}`);
}

const primitiveSites: string[] = [];
const ownedHelperSites: string[] = [];
for (const root of decisionRoots) {
  const expectedForwarded = root.captures
    .filter((capture) => capture.owned !== true)
    .map((capture) => capture.as);
  const expectedOwned = root.captures
    .filter((capture) => capture.owned === true)
    .map((capture) => capture.as);
  const adapterSpec = decisionRootSpecs[root.adapter];
  const forwardedCaptures = root.captures.filter(
    (capture) => capture.owned !== true,
  );
  const originalArgs = Array.from({ length: root.params }, (_, index) => ({
    root: root.name,
    argument: index,
  }));
  const graphValues = forwardedCaptures.map((capture) => {
    if (capture.as === "bashTool") return { name: "Bash" };
    if (Object.hasOwn(decisionPrimitiveValues, capture.as)) {
      return graphCopy(decisionPrimitiveValues[capture.as]);
    }
    return unique(`${root.name}.${capture.as}`);
  });
  const adapter = decisionAdapters[root.adapter];
  const result = adapter(...originalArgs, ...graphValues);
  const ports = seenDecisionPorts.get(root.adapter)!;

  check(`${root.name}: healthy decision adapter delegates`, result === decisionMarker);
  check(
    `${root.name}: adapter parameter count matches the pinned root`,
    adapterSpec.params === root.params,
  );
  check(
    `${root.name}: forwarded capture names and order match the pinned inventory`,
    JSON.stringify(adapterSpec.captures) === JSON.stringify(expectedForwarded),
  );
  check(
    `${root.name}: owned capture names match the pinned inventory`,
    JSON.stringify([...(adapterSpec.ownedCaptures ?? [])].sort()) ===
      JSON.stringify([...expectedOwned].sort()),
  );
  check(
    `${root.name}: positional captures bind to their semantic ports`,
    forwardedCaptures.every((capture, index) => {
      if (capture.as === "bashTool") return ports[capture.as] === graphValues[index];
      if (Object.hasOwn(decisionPrimitiveValues, capture.as)) {
        return ports[capture.as] === decisionPrimitiveValues[capture.as];
      }
      return ports[capture.as] === graphValues[index];
    }),
  );
  check(
    `${root.name}: owned helpers replace graph decision closure`,
    expectedOwned.every((name) => {
      ownedHelperSites.push(name);
      return name === "isUncPath"
        ? typeof ports[name] === "function"
        : ports[name] === decisionHelperValues[name];
    }),
  );

  const arityCases = [
    ...(graphValues.length > 0 ? [graphValues.slice(0, -1)] : []),
    [...graphValues, unique("extra")],
  ];
  for (const values of arityCases) {
    const before = decisionDelegations;
    let message = "";
    try {
      adapter(...originalArgs, ...values);
    } catch (error) {
      message = String((error as Error).message);
    }
    check(
      `${root.name}: capture arity mismatch refuses before delegation`,
      decisionDelegations === before &&
        message.includes(root.adapter) &&
        message.includes(`expected ${expectedForwarded.length} captures`),
      message.split("\n")[0],
    );
  }

  for (const [index, capture] of forwardedCaptures.entries()) {
    if (capture.kind !== "primitive") continue;
    primitiveSites.push(capture.as);
    const owned =
      capture.as === "bashTool"
        ? undefined
        : decisionPrimitiveValues[capture.as];
    const perturbed = [...graphValues];
    perturbed[index] = changedPrimitive(capture.as, owned);
    const before = decisionDelegations;
    let message = "";
    try {
      adapter(...originalArgs, ...perturbed);
    } catch (error) {
      message = String((error as Error).message);
    }
    const named = capture.as === "bashTool" ? "bashTool.name" : capture.as;
    check(
      `${root.name}.${capture.as}: named primitive assertion fires before delegation`,
      decisionDelegations === before &&
        message.includes(root.adapter) &&
        message.includes(named) &&
        message.includes("no longer"),
      message.split("\n")[0],
    );
  }
}

const declaredPrimitiveNames = new Set<string>();
for (const root of decisionRoots) {
  for (const capture of root.captures) {
    if (capture.kind === "primitive") declaredPrimitiveNames.add(capture.as);
  }
}
check(
  "every decision primitive capture site has a perturbation control",
  primitiveSites.length === 23 &&
    primitiveSites.every((name) => declaredPrimitiveNames.has(name)),
  `${primitiveSites.length} controlled site(s)`,
);
check(
  "no owned decision primitive assertion lacks a pinned capture site",
  Object.keys(OWNED_DECISION_PRIMITIVES).every((name) =>
    declaredPrimitiveNames.has(name),
  ) && declaredPrimitiveNames.has("bashTool"),
);
{
  const root = decisionRoots.find(
    (candidate) => candidate.name === "bash-same-directory-cd",
  )!;
  const forwarded = root.captures.filter((capture) => capture.owned !== true);
  let platformReads = 0;
  const graphValues = forwarded.map((capture) => {
    if (capture.as === "platform") {
      return () => {
        platformReads++;
        return "windows";
      };
    }
    if (Object.hasOwn(decisionPrimitiveValues, capture.as)) {
      return graphCopy(decisionPrimitiveValues[capture.as]);
    }
    return unique(`unc-binding.${capture.as}`);
  });
  decisionAdapters[root.adapter](
    ...Array.from({ length: root.params }, (_, index) => ({ index })),
    ...graphValues,
  );
  const bound = seenDecisionPorts.get(root.adapter)!.isUncPath as (
    value: string,
    scanEmbedded?: boolean,
  ) => boolean;
  check(
    "owned UNC helper reads the root platform port at call time",
    bound("//server/share", true) === true && platformReads === 1,
    `${platformReads} platform read(s)`,
  );
}

const helperSites = decisionRoots.flatMap((root) =>
  root.captures.map((capture) => ({ root: root.name, ...capture })),
);
const forwardedPureHelperSites = helperSites.filter(
  (capture) => capture.kind === "pure-helper" && capture.owned !== true,
);
check(
  "no child decision calls a graph-side pure helper",
  forwardedPureHelperSites.length === 0,
  forwardedPureHelperSites
    .map((capture) => `${capture.root}.${capture.as}`)
    .join(", "),
);
const requiredEnginePureHelperSites: Record<string, number> = {
  isClassifierRoutedSafetyCheck: 1,
  permissionMessage: 5,
  countMatching: 3,
  uniqueValues: 1,
  hasUnsafeGlobRoot: 1,
  hasBlockedPathShape: 1,
  isCriticalPath: 1,
  pathContains: 1,
  isUncPath: 1,
  formatAllowedDirectories: 2,
  directoryRuleSuggestion: 1,
  shellExpansionIndex: 1,
};
check(
  "all 19 pinned engine-helper sites bind to owned production helpers",
  Object.entries(requiredEnginePureHelperSites).every(([name, count]) =>
    helperSites.filter(
      (capture) => capture.as === name && capture.owned === true,
    ).length === count && Object.hasOwn(decisionHelperValues, name),
  ),
);
const directPathHelperSites: Record<string, number> = {
  isAbsolutePath: 4,
  resolvePath: 4,
  normalizePath: 1,
  basename: 1,
};
check(
  "all 10 node:path function sites bind to owned direct library imports",
  Object.entries(directPathHelperSites).every(([name, count]) =>
    helperSites.filter(
      (capture) => capture.as === name && capture.owned === true,
    ).length === count && Object.hasOwn(decisionHelperValues, name),
  ),
);
check(
  "the node:path separator crosses as one asserted primitive",
  helperSites.filter(
    (capture) =>
      capture.as === "pathSeparator" && capture.kind === "primitive" &&
      capture.owned !== true,
  ).length === 1 && Object.hasOwn(OWNED_DECISION_PRIMITIVES, "pathSeparator"),
);
check(
  "both statSync-bearing dirname sites remain effectful ports",
  helperSites.filter(
    (capture) =>
      capture.as === "dirname" && capture.kind === "effectful-port" &&
      capture.owned !== true,
  ).length === 2,
);

check(
  "every owned decision helper replacement has a pinned owned capture site",
  Object.keys(OWNED_DECISION_HELPERS).every((name) =>
    ownedHelperSites.includes(name),
  ),
);

check(
  "every decision root declares exactly one sabotage result shape",
  JSON.stringify(Object.keys(BASH_DECISION_SABOTAGE_SHAPES).sort()) ===
    JSON.stringify(
      decisionRoots
        .map((root) => root.adapter)
        .sort(),
    ),
);
const syncDecisionTwin: any = wrapBashCompoundSafetySabotage(
  "checkBashExactPermission",
  () => ({ behavior: "allow", updatedInput: input }),
)();
check(
  "a synchronous decision twin stays synchronous and changes the decision",
  !(syncDecisionTwin instanceof Promise) && syncDecisionTwin.behavior === "deny",
);
const asyncDecisionTwin: any = wrapBashCompoundSafetySabotage(
  "checkBashTooComplexRules",
  async () => ({ behavior: "allow", updatedInput: input }),
)();
check(
  "an asynchronous decision twin stays asynchronous and changes the decision",
  asyncDecisionTwin instanceof Promise &&
    (await asyncDecisionTwin).behavior === "deny",
);
const syncBooleanTwin: any = wrapBashCompoundSafetySabotage(
  "hasUnsafeBashGitStructureFromCommand",
  () => false,
)();
check(
  "a synchronous boolean twin stays synchronous and negates the result",
  !(syncBooleanTwin instanceof Promise) && syncBooleanTwin === true,
);
const asyncBooleanTwin: any = wrapBashCompoundSafetySabotage(
  "checkSameDirectoryCd",
  async () => false,
)();
check(
  "an asynchronous boolean twin stays asynchronous and negates the result",
  asyncBooleanTwin instanceof Promise && (await asyncBooleanTwin) === true,
);
const nullableTwin: any = wrapBashCompoundSafetySabotage(
  "parseCdTarget",
  () => null,
)();
check(
  "a nullable-value twin stays synchronous and changes absence to a value",
  !(nullableTwin instanceof Promise) && typeof nullableTwin === "string",
);
const nullablePresentTwin: any = wrapBashCompoundSafetySabotage(
  "resolveBashLeadingDirectoryChange",
  () => "/present",
)();
check(
  "a nullable-value twin changes a present value to absence",
  nullablePresentTwin === null,
);
const factoryTwin: any = wrapBashCompoundSafetySabotage(
  "createPathCommandChecker",
  () => () => ({ behavior: "passthrough", message: "healthy" }),
)();
check(
  "a factory twin stays callable and changes its produced decision",
  typeof factoryTwin === "function" && factoryTwin().behavior === "deny",
);
const aggregateSyncTwin: any = wrapBashCompoundSafetySabotage(
  "bashPermissionFailureDecision",
  () => ({ behavior: "deny", message: "healthy" }),
)();
check(
  "the synchronous aggregate failure twin stays synchronous",
  !(aggregateSyncTwin instanceof Promise) && aggregateSyncTwin.behavior === "allow",
);

console.log(`=== Bash compound-safety adapters: ${checks} check(s) ===`);
for (const failure of failures) console.log(`  FAIL — ${failure}`);
console.log(
  failures.length === 0
    ? "PASS — aggregate and decision-root graph contracts assert before healthy delegation"
    : `FAIL — ${failures.length} violation(s)`,
);
process.exitCode = failures.length === 0 ? 0 : 1;
