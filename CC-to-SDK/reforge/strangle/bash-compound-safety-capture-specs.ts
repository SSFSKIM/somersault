// Pure, copy-ready capture declarations for C13b's runtime splice roots.
// Importing this module performs no bundle I/O or validation.

import ts from "typescript";
import { freeIdentifiers } from "./scope.js";

export const BASH_SAFETY_ROOTS = {
  checkBashPermission: {
    anchor: "this agent's Bash use is clamped to a fixed set of command forms",
    params: 3,
  },
  checkBashPermissionCore: {
    anchor: "tengu_bash_ast_too_complex",
    params: 3,
  },
  permissionCheckFailureDecision: {
    anchor:
      "permission check crashed and this agent carries a per-spawn bashCommandClamp",
    coLiteral: "This command uses shell operators that require approval for safety",
    params: 2,
  },
} as const;

export type BashSafetyCapture = {
  as: string;
  kind: "primitive" | "pure-helper" | "effectful-port" | "owned-binding";
  owned?: true;
  derive: (body: string) => string;
};

const CAPTURE_IDENTIFIER = String.raw`[A-Za-z_$][\w$]*`;

function deriveCapture(root: string, as: string, pattern: string) {
  const expression = new RegExp(pattern.replaceAll("<ID>", CAPTURE_IDENTIFIER));
  return (body: string) => {
    const match = body.match(expression);
    if (!match || match[1] === undefined) {
      throw new Error(`${root}: could not derive '${as}' — ${expression}`);
    }
    return match[1];
  };
}

const CAPTURE_PATTERNS = {
  "checkBashPermission": {
    "readPermissionContext": "function <ID>\\(<ID>,<ID>,<ID>\\)\\{let <ID>=(<ID>)\\(<ID>\\)\\.bashCommandClamps",
    "checkClamp": "let <ID>=await (<ID>)\\(<ID>,<ID>\\);if\\(<ID>!==null\\)",
    "emitTelemetry": "return (<ID>)\\(\"tengu_bash_command_clamp_denied\"",
    "bashTool": "Permission to use \\$\\{(<ID>)\\.name\\} with command",
    "displaySpan": "the span \\$\\{(<ID>)\\(<ID>\\.span\\)\\} matches none",
    "clampRejectionReason": "no clamp rule can admit[\\s\\S]*?decisionReason:\\{type:\"other\",reason:(<ID>)\\}\\}\\}",
    "checkCore": "let <ID>=await (<ID>)\\(<ID>,<ID>,<ID>\\);if\\(<ID>\\.behavior!==\"allow\"",
    "decorateDecision": "command\\.includes\\(\"&\"\\)\\)return (<ID>)\\(<ID>,<ID>,<ID>\\(<ID>\\)\\)",
    "sandboxAutoAllowReason": "decisionReason\\?\\.type===\"other\"&&<ID>\\.decisionReason\\.reason===(<ID>)",
    "parseOrAbort": "let <ID>=await (<ID>)\\(<ID>\\.command\\);if\\(",
    "parseAborted": "if\\(<ID>&&<ID>!==(<ID>)&&!",
    "hasUnsafeBackgroundOperator": "!==<ID>&&!(<ID>)\\(<ID>\\)\\)return",
    "permissionMessage": "backgroundOperator\"\\};return <ID>\\(\\{behavior:\"ask\",decisionReason:<ID>,message:(<ID>)\\("
  },
  "checkBashPermissionCore": {
    "readPermissionContext": "function <ID>\\(<ID>,<ID>,<ID>\\)\\{let <ID>=(<ID>)\\(<ID>\\);",
    "replaceSessionEnvironmentKeys": ";(<ID>)\\(<ID>\\.sessionEnvVars\\?\\.keys\\(\\)\\?\\?\\[\\]\\);",
    "parseOrAbort": "let <ID>=await (<ID>)\\(<ID>\\.command\\),<ID>=<ID>\\?",
    "classifyCommand": "=<ID>\\?(<ID>)\\(<ID>\\.command,<ID>\\):\\{kind:\"simple\"",
    "checkTooComplexSafety": "kind===\"too-complex\"\\)\\{let <ID>=await (<ID>)\\(<ID>,<ID>,<ID>\\);",
    "checkTooComplexSandbox": "forRemoteExecution===!0\\?null:(<ID>)\\(<ID>,<ID>,<ID>\\.nodeType\\)",
    "emitTelemetry": "return (<ID>)\\(\"tengu_bash_ast_too_complex\"",
    "classifierNodeTypeId": "\\{nodeTypeId:(<ID>)\\(<ID>\\.nodeType\\)\\}",
    "permissionMessage": "bashMissKind:\"too-complex\"\\};return[\\s\\S]*?message:(<ID>)\\(",
    "bashTool": "bashMissKind:\"too-complex\"\\};return[\\s\\S]*?message:<ID>\\((<ID>)\\.name",
    "validateCommandSemantics": "let <ID>=<ID>\\.commands,<ID>=(<ID>)\\(<ID>\\);if\\(!<ID>\\.ok\\)",
    "checkInvalidSemanticsRules": "if\\(!<ID>\\.ok\\)\\{let <ID>=(<ID>)\\(<ID>,<ID>,<ID>\\);",
    "checkSandboxAutoAllow": "kind===\"newline-hash\"[\\s\\S]*?let <ID>=(<ID>)\\(<ID>,<ID>,<ID>,<ID>\\.bareAssignmentNames\\)",
    "checkExactPermission": "let <ID>=(<ID>)\\(<ID>,<ID>\\);if\\(<ID>\\.behavior===\"deny\"",
    "checkPipeSafety": "let <ID>=await (<ID>)\\(<ID>,\\(<ID>\\)=>",
    "checkPermission": "await <ID>\\(<ID>,\\(<ID>\\)=>(<ID>)\\(<ID>,<ID>,<ID>\\),\\{isNormalizedCdCommand",
    "isNormalizedCdCommand": "\\{isNormalizedCdCommand:(<ID>),isNormalizedGitCommand:",
    "isNormalizedGitCommand": "isNormalizedCdCommand:<ID>,isNormalizedGitCommand:(<ID>)\\}",
    "isCdGitSequenceSafe": ",\\(<ID>\\)=>(<ID>)\\(<ID>,<ID>\\(\\)\\)\\);if\\(<ID>\\.behavior",
    "currentWorkingDirectory": "if\\(<ID>\\.behavior===\"allow\"\\)\\{<ID>=<ID>\\(<ID>\\);let <ID>=<ID>\\(<ID>,(<ID>)\\(\\)",
    "checkPathSafety": "behavior===\"allow\"\\)\\{<ID>=<ID>\\(<ID>\\);let <ID>=(<ID>)\\(",
    "hasNormalizedCdCommand": "let <ID>=<ID>\\(<ID>,<ID>\\(\\),<ID>,(<ID>)\\(<ID>\\.command\\)",
    "platform": "let <ID>=<ID>\\(\\),<ID>=(<ID>)\\(\\)===\"windows\"\\?",
    "normalizeWindowsPath": "=<ID>\\(\\)===\"windows\"\\?(<ID>)\\(<ID>\\):<ID>,",
    "decomposeCommands": "\\{subcommands:<ID>,astCommandsByIdx:<ID>\\}=(<ID>)\\(<ID>,<ID>,<ID>,<ID>\\)",
    "uniqueValues": "if\\(<ID>\\.length>1\\)\\{let <ID>=(<ID>)\\(\\[<ID>,\\.\\.\\.",
    "allowedDirectories": "\\[<ID>,\\.\\.\\.(<ID>)\\(<ID>\\(<ID>\\)\\)\\]\\.flatMap",
    "resolvePathPolicy": "flatMap\\(\\(<ID>\\)=>\\{let\\{resolvedPath:<ID>\\}=(<ID>)\\(",
    "filesystem": "\\{resolvedPath:<ID>\\}=<ID>\\((<ID>)\\(\\),<ID>\\);return",
    "normalizePath": "\\.map\\(\\(<ID>\\)=>(<ID>)\\(<ID>\\)\\)\\)\\.map\\(\\(<ID>\\)=>\\(\\{exact",
    "caseFoldPath": "\\.map\\(\\(<ID>\\)=>\\(\\{exact:(<ID>)\\(<ID>\\),prefix:<ID>\\(",
    "pathSeparator": "\\?<ID>:<ID>\\+(<ID>)\\)\\}\\)",
    "peelCommandPrefixes": "let\\[<ID>,\\.\\.\\.<ID>\\]=(<ID>)\\(<ID>\\.argv\\)",
    "hasUnknownTrackedValue": "\\.startsWith\\(\"~\"\\)[\\s\\S]{0,80}?&&!(<ID>)\\(<ID>\\)&&!\\/\\(\\^\\|",
    "isAbsolutePath": "for\\(let <ID> of <ID>\\)\\{let <ID>=(<ID>)\\(<ID>\\)\\?",
    "resolvePath": "=<ID>\\(<ID>\\)\\?<ID>\\(<ID>\\):(<ID>)\\(<ID>,<ID>\\),\\{resolvedPath",
    "checkDangerousRemoval": "let <ID>=(<ID>)\\(<ID>,<ID>,<ID>,<ID>\\(<ID>\\),!<ID>\\);if\\(<ID>\\.behavior",
    "isSafeCdSequence": "&&<ID>\\(<ID>\\[0\\]\\)&&(<ID>)\\(<ID>\\.command\\)\\)",
    "resolveLeadingDirectoryChange": "let <ID>=(<ID>)\\(<ID>\\[0\\],<ID>,<ID>\\);if\\(<ID>!==null\\)",
    "isCdGitAstSequenceSafe": "&&!await (<ID>)\\(<ID>,<ID>,<ID>\\)\\)\\{let <ID>=\\{type:\"other\",reason:\"This command changes directory",
    "hasUnsafeGitStructureFromAnalysis": "\\)\\)&&\\((<ID>)\\(<ID>,<ID>\\)\\|\\|",
    "hasUnsafeGitStructureFromCommand": "&&\\(<ID>\\(<ID>,<ID>\\)\\|\\|(<ID>)\\(<ID>\\.command\\)\\)",
    "checkDirectCommand": "let <ID>=<ID>\\.map\\(\\(<ID>,<ID>\\)=>(<ID>)\\(\\{command:<ID>\\}",
    "isSedCommand": "let <ID>=<ID>\\.map\\(\\(<ID>,<ID>\\)=>\\[<ID>,<ID>\\]\\)\\.filter\\(\\(\\[<ID>\\]\\)=>(<ID>)\\(<ID>\\)\\)",
    "checkRedirectSedRisk": "let <ID>=new Set[\\s\\S]*?,<ID>=(<ID>)\\(<ID>,<ID>,<ID>\\);if\\(<ID>\\.behavior===\"ask\"",
    "countMatching": "let <ID>=<ID>\\.find[\\s\\S]*?,<ID>=(<ID>)\\(<ID>,\\(<ID>\\)=><ID>\\.behavior!==\"allow\"\\)",
    "classifierAbortError": "signal\\.aborted\\)throw new (<ID>)\\}",
    "checkSubcommandPermission": "length===1\\)return await (<ID>)\\(\\{command:<ID>\\[0\\]\\}",
    "findSafetyCheckReason": "===<ID>&&(<ID>)\\(<ID>\\.decisionReason\\)!==void 0&&<ID>\\(",
    "normalizeSuggestions": "let <ID>=\\\"suggestions\\\"in <ID>\\?<ID>\\.suggestions:void 0,<ID>=(<ID>)\\(<ID>\\);for",
    "serializeRule": "for\\(let <ID> of <ID>\\)\\{let <ID>=(<ID>)\\(<ID>\\);<ID>\\.set",
    "permissionSuggestions": "for\\(let <ID> of <ID>\\((<ID>)\\(<ID>\\)\\)\\)\\{let",
    "suggestionLimit": "Array\\.from\\(<ID>\\.values\\(\\)\\)\\.slice\\(0,(<ID>)\\)"
  },
  "permissionCheckFailureDecision": {
    "readPermissionContext": "function <ID>\\(<ID>,<ID>\\)\\{let <ID>=(<ID>)\\(<ID>\\)\\.bashCommandClamps",
    "clampFailureReason": "decisionReason:\\{type:\"other\",reason:(<ID>)\\}\\}"
  }
} as const;

const CAPTURE_METADATA = {
  "checkBashPermission": [
    {
      "as": "readPermissionContext",
      "kind": "effectful-port"
    },
    {
      "as": "checkClamp",
      "kind": "pure-helper",
      "owned": true
    },
    {
      "as": "emitTelemetry",
      "kind": "effectful-port"
    },
    {
      "as": "bashTool",
      "kind": "primitive"
    },
    {
      "as": "displaySpan",
      "kind": "pure-helper",
      "owned": true
    },
    {
      "as": "clampRejectionReason",
      "kind": "primitive"
    },
    {
      "as": "checkCore",
      "kind": "owned-binding"
    },
    {
      "as": "decorateDecision",
      "kind": "owned-binding"
    },
    {
      "as": "sandboxAutoAllowReason",
      "kind": "primitive"
    },
    {
      "as": "parseOrAbort",
      "kind": "pure-helper",
      "owned": true
    },
    {
      "as": "parseAborted",
      "kind": "primitive",
      "owned": true
    },
    {
      "as": "hasUnsafeBackgroundOperator",
      "kind": "pure-helper",
      "owned": true
    },
    {
      "as": "permissionMessage",
      "kind": "pure-helper",
      "owned": true
    }
  ],
  "checkBashPermissionCore": [
    {
      "as": "readPermissionContext",
      "kind": "effectful-port"
    },
    {
      "as": "replaceSessionEnvironmentKeys",
      "kind": "effectful-port"
    },
    {
      "as": "parseOrAbort",
      "kind": "pure-helper",
      "owned": true
    },
    {
      "as": "classifyCommand",
      "kind": "pure-helper",
      "owned": true
    },
    {
      "as": "checkTooComplexSafety",
      "kind": "owned-binding"
    },
    {
      "as": "checkTooComplexSandbox",
      "kind": "owned-binding"
    },
    {
      "as": "emitTelemetry",
      "kind": "effectful-port"
    },
    {
      "as": "classifierNodeTypeId",
      "kind": "pure-helper",
      "owned": true
    },
    {
      "as": "permissionMessage",
      "kind": "pure-helper",
      "owned": true
    },
    {
      "as": "bashTool",
      "kind": "primitive"
    },
    {
      "as": "validateCommandSemantics",
      "kind": "pure-helper",
      "owned": true
    },
    {
      "as": "checkInvalidSemanticsRules",
      "kind": "owned-binding"
    },
    {
      "as": "checkSandboxAutoAllow",
      "kind": "owned-binding"
    },
    {
      "as": "checkExactPermission",
      "kind": "owned-binding"
    },
    {
      "as": "checkPipeSafety",
      "kind": "pure-helper",
      "owned": true
    },
    {
      "as": "checkPermission",
      "kind": "owned-binding"
    },
    {
      "as": "isNormalizedCdCommand",
      "kind": "pure-helper",
      "owned": true
    },
    {
      "as": "isNormalizedGitCommand",
      "kind": "pure-helper",
      "owned": true
    },
    {
      "as": "isCdGitSequenceSafe",
      "kind": "owned-binding"
    },
    {
      "as": "currentWorkingDirectory",
      "kind": "effectful-port"
    },
    {
      "as": "checkPathSafety",
      "kind": "owned-binding"
    },
    {
      "as": "hasNormalizedCdCommand",
      "kind": "pure-helper",
      "owned": true
    },
    {
      "as": "platform",
      "kind": "effectful-port"
    },
    {
      "as": "normalizeWindowsPath",
      "kind": "pure-helper",
      "owned": true
    },
    {
      "as": "decomposeCommands",
      "kind": "pure-helper",
      "owned": true
    },
    {
      "as": "uniqueValues",
      "kind": "pure-helper",
      "owned": true
    },
    {
      "as": "allowedDirectories",
      "kind": "effectful-port"
    },
    {
      "as": "resolvePathPolicy",
      "kind": "effectful-port"
    },
    {
      "as": "filesystem",
      "kind": "effectful-port"
    },
    {
      "as": "normalizePath",
      "kind": "pure-helper",
      "owned": true
    },
    {
      "as": "caseFoldPath",
      "kind": "pure-helper",
      "owned": true
    },
    {
      "as": "pathSeparator",
      "kind": "primitive"
    },
    {
      "as": "peelCommandPrefixes",
      "kind": "pure-helper",
      "owned": true
    },
    {
      "as": "hasUnknownTrackedValue",
      "kind": "pure-helper",
      "owned": true
    },
    {
      "as": "isAbsolutePath",
      "kind": "pure-helper",
      "owned": true
    },
    {
      "as": "resolvePath",
      "kind": "pure-helper",
      "owned": true
    },
    {
      "as": "checkDangerousRemoval",
      "kind": "owned-binding"
    },
    {
      "as": "isSafeCdSequence",
      "kind": "pure-helper",
      "owned": true
    },
    {
      "as": "resolveLeadingDirectoryChange",
      "kind": "owned-binding"
    },
    {
      "as": "isCdGitAstSequenceSafe",
      "kind": "owned-binding"
    },
    {
      "as": "hasUnsafeGitStructureFromAnalysis",
      "kind": "owned-binding"
    },
    {
      "as": "hasUnsafeGitStructureFromCommand",
      "kind": "owned-binding"
    },
    {
      "as": "checkDirectCommand",
      "kind": "owned-binding"
    },
    {
      "as": "isSedCommand",
      "kind": "pure-helper",
      "owned": true
    },
    {
      "as": "checkRedirectSedRisk",
      "kind": "pure-helper",
      "owned": true
    },
    {
      "as": "countMatching",
      "kind": "pure-helper",
      "owned": true
    },
    {
      "as": "classifierAbortError",
      "kind": "pure-helper",
      "owned": true
    },
    {
      "as": "checkSubcommandPermission",
      "kind": "owned-binding"
    },
    {
      "as": "findSafetyCheckReason",
      "kind": "pure-helper",
      "owned": true
    },
    {
      "as": "normalizeSuggestions",
      "kind": "pure-helper",
      "owned": true
    },
    {
      "as": "serializeRule",
      "kind": "pure-helper",
      "owned": true
    },
    {
      "as": "permissionSuggestions",
      "kind": "pure-helper",
      "owned": true
    },
    {
      "as": "suggestionLimit",
      "kind": "primitive"
    }
  ],
  "permissionCheckFailureDecision": [
    {
      "as": "readPermissionContext",
      "kind": "effectful-port"
    },
    {
      "as": "clampFailureReason",
      "kind": "primitive"
    }
  ]
} as const;

// Copy-ready manifest rows: each derivation follows a semantic use-site shape,
// never a minified identifier or free-variable ordinal.
export const COPY_READY_BASH_SAFETY_CAPTURES = Object.fromEntries(
  Object.entries(CAPTURE_METADATA).map(([root, captures]) => [
    root,
    captures.map((capture) => ({
      ...capture,
      derive: deriveCapture(
        root,
        capture.as,
        (CAPTURE_PATTERNS as Record<string, Record<string, string>>)[root][
          capture.as
        ],
      ),
    })),
  ]),
) as unknown as Record<
  keyof typeof BASH_SAFETY_ROOTS,
  readonly BashSafetyCapture[]
>;


const decisionCaptureCache = new Map<string, string[]>();

function decisionFreeIdentifiers(
  body: string,
  target: "free-function" | "arrow-initializer",
): string[] {
  const key = `${target}\\0${body}`;
  const cached = decisionCaptureCache.get(key);
  if (cached) return cached;
  const wrapped = target === "arrow-initializer"
    ? `const __decision = ${body};`
    : body;
  const sourceFile = ts.createSourceFile(
    "bash-decision-capture.js",
    wrapped,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.JS,
  );
  const parseDiagnostics = (
    sourceFile as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  if (parseDiagnostics.length > 0) {
    throw new Error(
      `could not parse ${target} decision capture: ${parseDiagnostics
        .map((diagnostic) =>
          ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
        )
        .join("; ")}`,
    );
  }
  let node: ts.Node | undefined;
  if (target === "free-function") {
    node = sourceFile.statements.find(ts.isFunctionDeclaration);
  } else {
    const statement = sourceFile.statements.find(ts.isVariableStatement);
    node = statement?.declarationList.declarations[0]?.initializer;
  }
  if (!node) throw new Error(`could not parse ${target} decision capture`);
  const identifiers = freeIdentifiers(node);
  decisionCaptureCache.set(key, identifiers);
  return identifiers;
}

type DecisionCaptureDerivation = ((body: string) => string) & {
  expectedIdentifier: string;
};

const decisionCaptureCounts = new Map<string, number>();

function deriveDecisionCapture(
  root: string,
  target: "free-function" | "arrow-initializer",
  index: number,
  expectedIdentifier: string,
): DecisionCaptureDerivation {
  decisionCaptureCounts.set(
    root,
    Math.max(decisionCaptureCounts.get(root) ?? 0, index + 1),
  );
  const derive = ((body: string): string => {
    const identifiers = decisionFreeIdentifiers(body, target);
    const expectedCount = decisionCaptureCounts.get(root)!;
    if (identifiers.length !== expectedCount) {
      throw new Error(
        `${root}: expected ${expectedCount} captures, got ${identifiers.length} from [${identifiers.join(", ")}]`,
      );
    }
    const actual = identifiers[index];
    if (actual === undefined) {
      throw new Error(`${root}: capture ${index} is missing`);
    }
    return actual;
  }) as DecisionCaptureDerivation;
  derive.expectedIdentifier = expectedIdentifier;
  return derive;
}

export function expectedDecisionCaptureIdentifier(
  capture: { derive: (body: string) => string },
): string {
  const expected = (capture.derive as Partial<DecisionCaptureDerivation>)
    .expectedIdentifier;
  if (expected === undefined) {
    throw new Error("decision capture is missing its pinned expected identifier");
  }
  return expected;
}

export const BASH_DECISION_ROOTS = {
  "decorateBashAskDecision": {
    name: "bash-decision-decorator",
    adapter: "decorateBashAskDecision",
    binding: "D8e",
    anchor: "matchedAskRule:C",
    target: "free-function",
    params: 3,
    captures: [
      {
        as: "isAutoOrActivePlanMode",
        kind: "effectful-port",
        derive: deriveDecisionCapture("decorateBashAskDecision", "free-function", 0, "Tyt"),
      },
      {
        as: "findSafetyCheckReason",
        kind: "owned-binding",
        derive: deriveDecisionCapture("decorateBashAskDecision", "free-function", 1, "Fy"),
      },
      {
        as: "isClassifierRoutedSafetyCheck",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("decorateBashAskDecision", "free-function", 2, "_Tt"),
      },
      {
        as: "splitSubcommands",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("decorateBashAskDecision", "free-function", 3, "Ua"),
      },
      {
        as: "matchRules",
        kind: "effectful-port",
        derive: deriveDecisionCapture("decorateBashAskDecision", "free-function", 4, "zw"),
      },
    ],
  },
  "checkBashTooComplexRules": {
    name: "bash-too-complex-rules",
    adapter: "checkBashTooComplexRules",
    binding: "Urn",
    anchor: "e.g. `rm -rf $UNSET/*` becomes `rm -rf /*`. This requires explicit approval and cannot be auto-allowed by permission rules.",
    target: "free-function",
    params: 3,
    captures: [
      {
        as: "checkPrefixAndExactRules",
        kind: "owned-binding",
        derive: deriveDecisionCapture("checkBashTooComplexRules", "free-function", 0, "J8e"),
      },
      {
        as: "splitSubcommands",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkBashTooComplexRules", "free-function", 1, "Ua"),
      },
      {
        as: "matchRules",
        kind: "effectful-port",
        derive: deriveDecisionCapture("checkBashTooComplexRules", "free-function", 2, "zw"),
      },
      {
        as: "bashTool",
        kind: "primitive",
        derive: deriveDecisionCapture("checkBashTooComplexRules", "free-function", 3, "yi"),
      },
      {
        as: "findDangerousRemovalExpansion",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkBashTooComplexRules", "free-function", 4, "i_e"),
      },
      {
        as: "emitTelemetry",
        kind: "effectful-port",
        derive: deriveDecisionCapture("checkBashTooComplexRules", "free-function", 5, "s"),
      },
      {
        as: "dangerousRemovalDecision",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkBashTooComplexRules", "free-function", 6, "Bw"),
      },
      {
        as: "parseAborted",
        kind: "primitive",
        owned: true,
        derive: deriveDecisionCapture("checkBashTooComplexRules", "free-function", 7, "w3"),
      },
      {
        as: "checkNestedDangerousRemoval",
        kind: "owned-binding",
        derive: deriveDecisionCapture("checkBashTooComplexRules", "free-function", 8, "Brn"),
      },
      {
        as: "currentWorkingDirectory",
        kind: "effectful-port",
        derive: deriveDecisionCapture("checkBashTooComplexRules", "free-function", 9, "ee"),
      },
    ],
  },
  "checkBashTooComplexSandbox": {
    name: "bash-too-complex-sandbox",
    adapter: "checkBashTooComplexSandbox",
    binding: "xrn",
    anchor: "if(/\\/proc\\/.*\\/environ/.test(e.command.replace(/['\"\\\\]/g,\"\")))return null",
    target: "free-function",
    params: 3,
    captures: [
      {
        as: "sandbox",
        kind: "effectful-port",
        derive: deriveDecisionCapture("checkBashTooComplexSandbox", "free-function", 0, "pt"),
      },
      {
        as: "isSandboxEligible",
        kind: "effectful-port",
        derive: deriveDecisionCapture("checkBashTooComplexSandbox", "free-function", 1, "bv"),
      },
      {
        as: "isSandboxAutoAllowSuspended",
        kind: "effectful-port",
        derive: deriveDecisionCapture("checkBashTooComplexSandbox", "free-function", 2, "Q8e"),
      },
      {
        as: "splitClampCommands",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkBashTooComplexSandbox", "free-function", 3, "rW"),
      },
      {
        as: "matchRules",
        kind: "effectful-port",
        derive: deriveDecisionCapture("checkBashTooComplexSandbox", "free-function", 4, "zw"),
      },
      {
        as: "bashTool",
        kind: "primitive",
        derive: deriveDecisionCapture("checkBashTooComplexSandbox", "free-function", 5, "yi"),
      },
      {
        as: "stripEnvironmentAssignments",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkBashTooComplexSandbox", "free-function", 6, "Irn"),
      },
      {
        as: "peelCommandPrefixes",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkBashTooComplexSandbox", "free-function", 7, "Db"),
      },
      {
        as: "isDangerousEnvironmentVariable",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkBashTooComplexSandbox", "free-function", 8, "XTe"),
      },
      {
        as: "isSandboxExcludedCommand",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkBashTooComplexSandbox", "free-function", 9, "SQn"),
      },
      {
        as: "sandboxBlockedCommands",
        kind: "primitive",
        derive: deriveDecisionCapture("checkBashTooComplexSandbox", "free-function", 10, "R8e"),
      },
      {
        as: "sandboxDynamicCommands",
        kind: "primitive",
        derive: deriveDecisionCapture("checkBashTooComplexSandbox", "free-function", 11, "Mrn"),
      },
      {
        as: "arithmeticComparisonOperators",
        kind: "primitive",
        derive: deriveDecisionCapture("checkBashTooComplexSandbox", "free-function", 12, "mKe"),
      },
      {
        as: "sandboxUnsupportedCommands",
        kind: "primitive",
        derive: deriveDecisionCapture("checkBashTooComplexSandbox", "free-function", 13, "uWt"),
      },
      {
        as: "findActions",
        kind: "primitive",
        derive: deriveDecisionCapture("checkBashTooComplexSandbox", "free-function", 14, "o_n"),
      },
      {
        as: "findValueOptionPattern",
        kind: "primitive",
        derive: deriveDecisionCapture("checkBashTooComplexSandbox", "free-function", 15, "J_t"),
      },
      {
        as: "findQuotedValuePattern",
        kind: "primitive",
        derive: deriveDecisionCapture("checkBashTooComplexSandbox", "free-function", 16, "Q_t"),
      },
      {
        as: "safeSetLongOptions",
        kind: "primitive",
        derive: deriveDecisionCapture("checkBashTooComplexSandbox", "free-function", 17, "a_n"),
      },
      {
        as: "safeSetShortOptions",
        kind: "primitive",
        derive: deriveDecisionCapture("checkBashTooComplexSandbox", "free-function", 18, "l_n"),
      },
      {
        as: "permissionMessage",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkBashTooComplexSandbox", "free-function", 19, "ql"),
      },
      {
        as: "sandboxAutoAllowReason",
        kind: "primitive",
        derive: deriveDecisionCapture("checkBashTooComplexSandbox", "free-function", 20, "JNe"),
      },
    ],
  },
  "checkBashInvalidSemanticsRules": {
    name: "bash-invalid-semantics-rules",
    adapter: "checkBashInvalidSemanticsRules",
    binding: "Hrn",
    anchor: "astCommand:u}).matchingDenyRules",
    target: "free-function",
    params: 3,
    captures: [
      {
        as: "checkPrefixAndExactRules",
        kind: "owned-binding",
        derive: deriveDecisionCapture("checkBashInvalidSemanticsRules", "free-function", 0, "J8e"),
      },
      {
        as: "matchRules",
        kind: "effectful-port",
        derive: deriveDecisionCapture("checkBashInvalidSemanticsRules", "free-function", 1, "zw"),
      },
      {
        as: "bashTool",
        kind: "primitive",
        derive: deriveDecisionCapture("checkBashInvalidSemanticsRules", "free-function", 2, "yi"),
      },
    ],
  },
  "checkBashSandboxAutoAllow": {
    name: "bash-sandbox-auto-allow",
    adapter: "checkBashSandboxAutoAllow",
    binding: "A8e",
    anchor: "if(A&&x)return null;return u",
    target: "free-function",
    params: 4,
    captures: [
      {
        as: "sandbox",
        kind: "effectful-port",
        derive: deriveDecisionCapture("checkBashSandboxAutoAllow", "free-function", 0, "pt"),
      },
      {
        as: "isSandboxEligible",
        kind: "effectful-port",
        derive: deriveDecisionCapture("checkBashSandboxAutoAllow", "free-function", 1, "bv"),
      },
      {
        as: "isSandboxAutoAllowSuspended",
        kind: "effectful-port",
        derive: deriveDecisionCapture("checkBashSandboxAutoAllow", "free-function", 2, "Q8e"),
      },
      {
        as: "checkSandboxRules",
        kind: "owned-binding",
        derive: deriveDecisionCapture("checkBashSandboxAutoAllow", "free-function", 3, "Orn"),
      },
      {
        as: "spawnEnvironmentKeys",
        kind: "effectful-port",
        derive: deriveDecisionCapture("checkBashSandboxAutoAllow", "free-function", 4, "oW"),
      },
      {
        as: "isSafeEnvironmentVariable",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkBashSandboxAutoAllow", "free-function", 5, "Ww"),
      },
      {
        as: "peelCommandPrefixes",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkBashSandboxAutoAllow", "free-function", 6, "Db"),
      },
      {
        as: "checkDangerousRemoval",
        kind: "owned-binding",
        derive: deriveDecisionCapture("checkBashSandboxAutoAllow", "free-function", 7, "dL"),
      },
      {
        as: "currentWorkingDirectory",
        kind: "effectful-port",
        derive: deriveDecisionCapture("checkBashSandboxAutoAllow", "free-function", 8, "ee"),
      },
    ],
  },
  "checkBashExactPermission": {
    name: "bash-exact-permission",
    adapter: "checkBashExactPermission",
    binding: "aQ",
    anchor: "suggestions:w3e(r)",
    target: "arrow-initializer",
    params: 2,
    captures: [
      {
        as: "matchRules",
        kind: "effectful-port",
        derive: deriveDecisionCapture("checkBashExactPermission", "arrow-initializer", 0, "zw"),
      },
      {
        as: "bashTool",
        kind: "primitive",
        derive: deriveDecisionCapture("checkBashExactPermission", "arrow-initializer", 1, "yi"),
      },
      {
        as: "permissionMessage",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkBashExactPermission", "arrow-initializer", 2, "ql"),
      },
      {
        as: "permissionSuggestions",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkBashExactPermission", "arrow-initializer", 3, "w3e"),
      },
    ],
  },
  "checkBashCdGitSequence": {
    name: "bash-cd-git-sequence",
    adapter: "checkBashCdGitSequence",
    binding: "$rn",
    anchor: "if(Q(e,(d)=>Lb(d.trim()))>1",
    target: "free-function",
    params: 2,
    captures: [
      {
        as: "directoryIdentity",
        kind: "effectful-port",
        derive: deriveDecisionCapture("checkBashCdGitSequence", "free-function", 0, "m_e"),
      },
      {
        as: "countMatching",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkBashCdGitSequence", "free-function", 1, "Q"),
      },
      {
        as: "isNormalizedCdCommand",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkBashCdGitSequence", "free-function", 2, "Lb"),
      },
      {
        as: "parseCdTarget",
        kind: "owned-binding",
        derive: deriveDecisionCapture("checkBashCdGitSequence", "free-function", 3, "z8e"),
      },
      {
        as: "checkSameDirectoryCd",
        kind: "owned-binding",
        derive: deriveDecisionCapture("checkBashCdGitSequence", "free-function", 4, "V8e"),
      },
    ],
  },
  "checkBashPathSafety": {
    name: "bash-path-safety",
    adapter: "checkBashPathSafety",
    binding: "I8",
    anchor: "Process substitution (>(...) or <(...)) can execute arbitrary commands and requires manual approval",
    target: "free-function",
    params: 6,
    captures: [
      {
        as: "analyzeAstRedirections",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkBashPathSafety", "free-function", 0, "Fnn"),
      },
      {
        as: "analyzeOutputRedirections",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkBashPathSafety", "free-function", 1, "See"),
      },
      {
        as: "expandHomePath",
        kind: "effectful-port",
        derive: deriveDecisionCapture("checkBashPathSafety", "free-function", 2, "Rm"),
      },
      {
        as: "resolvePath",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkBashPathSafety", "free-function", 3, "r8e"),
      },
      {
        as: "isAbsolutePath",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkBashPathSafety", "free-function", 4, "uL"),
      },
      {
        as: "resolvePathVariants",
        kind: "effectful-port",
        derive: deriveDecisionCapture("checkBashPathSafety", "free-function", 5, "ao"),
      },
      {
        as: "matchPathRule",
        kind: "effectful-port",
        derive: deriveDecisionCapture("checkBashPathSafety", "free-function", 6, "fa"),
      },
      {
        as: "checkSuspiciousPath",
        kind: "effectful-port",
        derive: deriveDecisionCapture("checkBashPathSafety", "free-function", 7, "oY"),
      },
      {
        as: "checkOutputRedirections",
        kind: "owned-binding",
        derive: deriveDecisionCapture("checkBashPathSafety", "free-function", 8, "Lnn"),
      },
      {
        as: "checkAstPathCommand",
        kind: "owned-binding",
        derive: deriveDecisionCapture("checkBashPathSafety", "free-function", 9, "Dnn"),
      },
      {
        as: "splitSubcommands",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkBashPathSafety", "free-function", 10, "Ua"),
      },
      {
        as: "checkTextPathCommand",
        kind: "owned-binding",
        derive: deriveDecisionCapture("checkBashPathSafety", "free-function", 11, "Onn"),
      },
    ],
  },
  "checkBashDangerousRemoval": {
    name: "bash-dangerous-removal",
    adapter: "checkBashDangerousRemoval",
    binding: "dL",
    anchor: "No dangerous removals detected for ",
    target: "free-function",
    params: 5,
    captures: [
      {
        as: "pathArgumentExtractors",
        kind: "owned-binding",
        derive: deriveDecisionCapture("checkBashDangerousRemoval", "free-function", 0, "pL"),
      },
      {
        as: "resolvePathPolicy",
        kind: "effectful-port",
        derive: deriveDecisionCapture("checkBashDangerousRemoval", "free-function", 1, "Qo"),
      },
      {
        as: "filesystem",
        kind: "effectful-port",
        derive: deriveDecisionCapture("checkBashDangerousRemoval", "free-function", 2, "le"),
      },
      {
        as: "uniqueValues",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkBashDangerousRemoval", "free-function", 3, "te"),
      },
      {
        as: "allowedDirectories",
        kind: "effectful-port",
        derive: deriveDecisionCapture("checkBashDangerousRemoval", "free-function", 4, "TT"),
      },
      {
        as: "expandHomePath",
        kind: "effectful-port",
        derive: deriveDecisionCapture("checkBashDangerousRemoval", "free-function", 5, "Rm"),
      },
      {
        as: "isAbsolutePath",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkBashDangerousRemoval", "free-function", 6, "uL"),
      },
      {
        as: "resolvePath",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkBashDangerousRemoval", "free-function", 7, "r8e"),
      },
      {
        as: "normalizePath",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkBashDangerousRemoval", "free-function", 8, "Enn"),
      },
      {
        as: "dangerousRemovalDecision",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkBashDangerousRemoval", "free-function", 9, "Bw"),
      },
      {
        as: "pathSeparator",
        kind: "primitive",
        derive: deriveDecisionCapture("checkBashDangerousRemoval", "free-function", 10, "Cnn"),
      },
      {
        as: "hasUnsafeGlobRoot",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkBashDangerousRemoval", "free-function", 11, "kze"),
      },
      {
        as: "hasUnknownTrackedValue",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkBashDangerousRemoval", "free-function", 12, "Qa"),
      },
      {
        as: "hasBlockedPathShape",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkBashDangerousRemoval", "free-function", 13, "Bn"),
      },
      {
        as: "isCriticalPath",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkBashDangerousRemoval", "free-function", 14, "pwe"),
      },
      {
        as: "pathContains",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkBashDangerousRemoval", "free-function", 15, "nf"),
      },
      {
        as: "countMatching",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkBashDangerousRemoval", "free-function", 16, "Q"),
      },
    ],
  },
  "resolveBashLeadingDirectoryChange": {
    name: "bash-leading-directory",
    adapter: "resolveBashLeadingDirectoryChange",
    binding: "Frn",
    anchor: "if(e.argv.length!==2||e.argv[0]!==\"cd\")",
    target: "free-function",
    params: 3,
    captures: [
      {
        as: "hasUnknownTrackedValue",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("resolveBashLeadingDirectoryChange", "free-function", 0, "Qa"),
      },
      {
        as: "isPathLike",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("resolveBashLeadingDirectoryChange", "free-function", 1, "K8e"),
      },
      {
        as: "isAbsolutePath",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("resolveBashLeadingDirectoryChange", "free-function", 2, "lW"),
      },
      {
        as: "platform",
        kind: "effectful-port",
        derive: deriveDecisionCapture("resolveBashLeadingDirectoryChange", "free-function", 3, "D"),
      },
      {
        as: "isSafeWindowsPath",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("resolveBashLeadingDirectoryChange", "free-function", 4, "X8e"),
      },
      {
        as: "checkPathPolicy",
        kind: "effectful-port",
        derive: deriveDecisionCapture("resolveBashLeadingDirectoryChange", "free-function", 5, "Omt"),
      },
      {
        as: "isPathAllowed",
        kind: "effectful-port",
        derive: deriveDecisionCapture("resolveBashLeadingDirectoryChange", "free-function", 6, "Xy"),
      },
    ],
  },
  "checkBashCdGitAstSequence": {
    name: "bash-cd-git-ast-sequence",
    adapter: "checkBashCdGitAstSequence",
    binding: "Nrn",
    anchor: "if(C.argv.length!==2||C.argv[0]!==\"cd\")",
    target: "free-function",
    params: 3,
    captures: [
      {
        as: "directoryIdentity",
        kind: "effectful-port",
        derive: deriveDecisionCapture("checkBashCdGitAstSequence", "free-function", 0, "m_e"),
      },
      {
        as: "countMatching",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkBashCdGitAstSequence", "free-function", 1, "Q"),
      },
      {
        as: "isNormalizedCdCommand",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkBashCdGitAstSequence", "free-function", 2, "Lb"),
      },
      {
        as: "hasUnknownTrackedValue",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkBashCdGitAstSequence", "free-function", 3, "Qa"),
      },
      {
        as: "platform",
        kind: "effectful-port",
        derive: deriveDecisionCapture("checkBashCdGitAstSequence", "free-function", 4, "D"),
      },
      {
        as: "parseCdTarget",
        kind: "owned-binding",
        derive: deriveDecisionCapture("checkBashCdGitAstSequence", "free-function", 5, "z8e"),
      },
      {
        as: "checkSameDirectoryCd",
        kind: "owned-binding",
        derive: deriveDecisionCapture("checkBashCdGitAstSequence", "free-function", 6, "V8e"),
      },
    ],
  },
  "hasUnsafeBashGitStructureFromAnalysis": {
    name: "bash-git-structure-analysis",
    adapter: "hasUnsafeBashGitStructureFromAnalysis",
    binding: "tQ",
    anchor: "--no-target-directory",
    target: "free-function",
    params: 2,
    captures: [
      {
        as: "readRedirectOperators",
        kind: "primitive",
        derive: deriveDecisionCapture("hasUnsafeBashGitStructureFromAnalysis", "free-function", 0, "orn"),
      },
      {
        as: "hasUnknownTrackedValue",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("hasUnsafeBashGitStructureFromAnalysis", "free-function", 1, "Qa"),
      },
      {
        as: "hasUnsafePath",
        kind: "effectful-port",
        derive: deriveDecisionCapture("hasUnsafeBashGitStructureFromAnalysis", "free-function", 2, "eQ"),
      },
      {
        as: "peelCommandPrefixes",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("hasUnsafeBashGitStructureFromAnalysis", "free-function", 3, "Db"),
      },
      {
        as: "pathEffectKinds",
        kind: "owned-binding",
        derive: deriveDecisionCapture("hasUnsafeBashGitStructureFromAnalysis", "free-function", 4, "DP"),
      },
      {
        as: "gitRiskExcludedCommands",
        kind: "primitive",
        derive: deriveDecisionCapture("hasUnsafeBashGitStructureFromAnalysis", "free-function", 5, "f8e"),
      },
      {
        as: "pathArgumentExtractors",
        kind: "owned-binding",
        derive: deriveDecisionCapture("hasUnsafeBashGitStructureFromAnalysis", "free-function", 6, "pL"),
      },
      {
        as: "hasUnsafeMkdirPath",
        kind: "effectful-port",
        derive: deriveDecisionCapture("hasUnsafeBashGitStructureFromAnalysis", "free-function", 7, "srn"),
      },
      {
        as: "expandHomePath",
        kind: "effectful-port",
        derive: deriveDecisionCapture("hasUnsafeBashGitStructureFromAnalysis", "free-function", 8, "Rm"),
      },
      {
        as: "filesystem",
        kind: "effectful-port",
        derive: deriveDecisionCapture("hasUnsafeBashGitStructureFromAnalysis", "free-function", 9, "le"),
      },
      {
        as: "realpath",
        kind: "effectful-port",
        derive: deriveDecisionCapture("hasUnsafeBashGitStructureFromAnalysis", "free-function", 10, "ex"),
      },
      {
        as: "resolvePath",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("hasUnsafeBashGitStructureFromAnalysis", "free-function", 11, "u_e"),
      },
      {
        as: "resolveExistingPath",
        kind: "effectful-port",
        derive: deriveDecisionCapture("hasUnsafeBashGitStructureFromAnalysis", "free-function", 12, "g8e"),
      },
      {
        as: "isPathAncestor",
        kind: "effectful-port",
        derive: deriveDecisionCapture("hasUnsafeBashGitStructureFromAnalysis", "free-function", 13, "irn"),
      },
      {
        as: "shellExpansionIndex",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("hasUnsafeBashGitStructureFromAnalysis", "free-function", 14, "DU"),
      },
      {
        as: "basename",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("hasUnsafeBashGitStructureFromAnalysis", "free-function", 15, "a8e"),
      },
      {
        as: "hasSymlinkTraversalRisk",
        kind: "effectful-port",
        derive: deriveDecisionCapture("hasUnsafeBashGitStructureFromAnalysis", "free-function", 16, "mL"),
      },
    ],
  },
  "hasUnsafeBashGitStructureFromCommand": {
    name: "bash-git-structure-command",
    adapter: "hasUnsafeBashGitStructureFromCommand",
    binding: "iW",
    anchor: "let{redirections:r}=See(e)",
    target: "free-function",
    params: 1,
    captures: [
      {
        as: "splitSubcommands",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("hasUnsafeBashGitStructureFromCommand", "free-function", 0, "Ua"),
      },
      {
        as: "pathArgumentsFromCommand",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("hasUnsafeBashGitStructureFromCommand", "free-function", 1, "rrn"),
      },
      {
        as: "peelCommandPrefixes",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("hasUnsafeBashGitStructureFromCommand", "free-function", 2, "Db"),
      },
      {
        as: "commandArgv",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("hasUnsafeBashGitStructureFromCommand", "free-function", 3, "ru"),
      },
      {
        as: "createsGitInternalPath",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("hasUnsafeBashGitStructureFromCommand", "free-function", 4, "c_e"),
      },
      {
        as: "analyzeOutputRedirections",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("hasUnsafeBashGitStructureFromCommand", "free-function", 5, "See"),
      },
    ],
  },
  "checkBashDirectCommand": {
    name: "bash-direct-command",
    adapter: "checkBashDirectCommand",
    binding: "j8e",
    anchor: "suggestions:w3e(_)",
    target: "arrow-initializer",
    params: 6,
    captures: [
      {
        as: "currentWorkingDirectory",
        kind: "effectful-port",
        derive: deriveDecisionCapture("checkBashDirectCommand", "arrow-initializer", 0, "ee"),
      },
      {
        as: "checkExactPermission",
        kind: "owned-binding",
        derive: deriveDecisionCapture("checkBashDirectCommand", "arrow-initializer", 1, "aQ"),
      },
      {
        as: "matchRules",
        kind: "effectful-port",
        derive: deriveDecisionCapture("checkBashDirectCommand", "arrow-initializer", 2, "zw"),
      },
      {
        as: "bashTool",
        kind: "primitive",
        derive: deriveDecisionCapture("checkBashDirectCommand", "arrow-initializer", 3, "yi"),
      },
      {
        as: "permissionMessage",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkBashDirectCommand", "arrow-initializer", 4, "ql"),
      },
      {
        as: "checkPathSafety",
        kind: "owned-binding",
        derive: deriveDecisionCapture("checkBashDirectCommand", "arrow-initializer", 5, "I8"),
      },
      {
        as: "checkSedSafety",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkBashDirectCommand", "arrow-initializer", 6, "H9e"),
      },
      {
        as: "checkModeCommands",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkBashDirectCommand", "arrow-initializer", 7, "T8e"),
      },
      {
        as: "spawnEnvironmentKeys",
        kind: "effectful-port",
        derive: deriveDecisionCapture("checkBashDirectCommand", "arrow-initializer", 8, "oW"),
      },
      {
        as: "hasUnsafeEnvironmentAssignment",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkBashDirectCommand", "arrow-initializer", 9, "vrn"),
      },
      {
        as: "isSafeEnvironmentVariable",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkBashDirectCommand", "arrow-initializer", 10, "Ww"),
      },
      {
        as: "readOnlyAllowReason",
        kind: "primitive",
        derive: deriveDecisionCapture("checkBashDirectCommand", "arrow-initializer", 11, "yTt"),
      },
      {
        as: "permissionSuggestions",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkBashDirectCommand", "arrow-initializer", 12, "w3e"),
      },
    ],
  },
  "checkBashSubcommandPermission": {
    name: "bash-subcommand-permission",
    adapter: "checkBashSubcommandPermission",
    binding: "C8e",
    anchor: "r?.commandPrefix?wrn",
    target: "free-function",
    params: 7,
    captures: [
      {
        as: "checkExactPermission",
        kind: "owned-binding",
        derive: deriveDecisionCapture("checkBashSubcommandPermission", "free-function", 0, "aQ"),
      },
      {
        as: "checkDirectCommand",
        kind: "owned-binding",
        derive: deriveDecisionCapture("checkBashSubcommandPermission", "free-function", 1, "j8e"),
      },
      {
        as: "classifierPrefixSuggestion",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkBashSubcommandPermission", "free-function", 2, "wrn"),
      },
      {
        as: "permissionSuggestions",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkBashSubcommandPermission", "free-function", 3, "w3e"),
      },
    ],
  },
  "checkBashPrefixAndExactRules": {
    name: "bash-prefix-exact-rules",
    adapter: "checkBashPrefixAndExactRules",
    binding: "J8e",
    anchor: "if(u.behavior!==\"passthrough\")return u;return null",
    target: "free-function",
    params: 2,
    captures: [
      {
        as: "matchRules",
        kind: "effectful-port",
        derive: deriveDecisionCapture("checkBashPrefixAndExactRules", "free-function", 0, "zw"),
      },
      {
        as: "bashTool",
        kind: "primitive",
        derive: deriveDecisionCapture("checkBashPrefixAndExactRules", "free-function", 1, "yi"),
      },
      {
        as: "checkExactPermission",
        kind: "owned-binding",
        derive: deriveDecisionCapture("checkBashPrefixAndExactRules", "free-function", 2, "aQ"),
      },
      {
        as: "permissionMessage",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkBashPrefixAndExactRules", "free-function", 3, "ql"),
      },
    ],
  },
  "checkNestedDangerousRemoval": {
    name: "bash-nested-dangerous-removal",
    adapter: "checkNestedDangerousRemoval",
    binding: "Brn",
    anchor: "too many command substitutions",
    target: "free-function",
    params: 3,
    captures: [
      {
        as: "dangerousRemovalDecision",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkNestedDangerousRemoval", "free-function", 0, "Bw"),
      },
      {
        as: "hasNormalizedCdCommand",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkNestedDangerousRemoval", "free-function", 1, "fL"),
      },
      {
        as: "splitSubcommands",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkNestedDangerousRemoval", "free-function", 2, "Ua"),
      },
      {
        as: "findDangerousRemovalExpansion",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkNestedDangerousRemoval", "free-function", 3, "i_e"),
      },
      {
        as: "classifyCommandText",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkNestedDangerousRemoval", "free-function", 4, "dde"),
      },
      {
        as: "peelCommandPrefixes",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkNestedDangerousRemoval", "free-function", 5, "Db"),
      },
      {
        as: "basenameCommand",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkNestedDangerousRemoval", "free-function", 6, "x8"),
      },
      {
        as: "checkDangerousRemoval",
        kind: "owned-binding",
        derive: deriveDecisionCapture("checkNestedDangerousRemoval", "free-function", 7, "dL"),
      },
    ],
  },
  "checkSandboxRules": {
    name: "bash-sandbox-rules",
    adapter: "checkSandboxRules",
    binding: "Orn",
    anchor: "astCommand:r.length===1",
    target: "free-function",
    params: 3,
    captures: [
      {
        as: "matchRules",
        kind: "effectful-port",
        derive: deriveDecisionCapture("checkSandboxRules", "free-function", 0, "zw"),
      },
      {
        as: "bashTool",
        kind: "primitive",
        derive: deriveDecisionCapture("checkSandboxRules", "free-function", 1, "yi"),
      },
      {
        as: "permissionMessage",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkSandboxRules", "free-function", 2, "ql"),
      },
      {
        as: "sandboxAutoAllowReason",
        kind: "primitive",
        derive: deriveDecisionCapture("checkSandboxRules", "free-function", 3, "JNe"),
      },
    ],
  },
  "parseCdTarget": {
    name: "bash-cd-target",
    adapter: "parseCdTarget",
    binding: "z8e",
    anchor: "if(!t.startsWith(\"cd \"))return null",
    target: "free-function",
    params: 1,
    captures: [
      {
        as: "platform",
        kind: "effectful-port",
        derive: deriveDecisionCapture("parseCdTarget", "free-function", 0, "D"),
      },
    ],
  },
  "checkSameDirectoryCd": {
    name: "bash-same-directory-cd",
    adapter: "checkSameDirectoryCd",
    binding: "V8e",
    anchor: "return u===r",
    target: "free-function",
    params: 3,
    captures: [
      {
        as: "isPathLike",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkSameDirectoryCd", "free-function", 0, "K8e"),
      },
      {
        as: "platform",
        kind: "effectful-port",
        derive: deriveDecisionCapture("checkSameDirectoryCd", "free-function", 1, "D"),
      },
      {
        as: "isUncPath",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkSameDirectoryCd", "free-function", 2, "S_"),
      },
      {
        as: "isSafeWindowsPath",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkSameDirectoryCd", "free-function", 3, "X8e"),
      },
      {
        as: "isAbsolutePath",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkSameDirectoryCd", "free-function", 4, "lW"),
      },
      {
        as: "resolvePath",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkSameDirectoryCd", "free-function", 5, "F8e"),
      },
      {
        as: "directoryIdentity",
        kind: "effectful-port",
        derive: deriveDecisionCapture("checkSameDirectoryCd", "free-function", 6, "m_e"),
      },
    ],
  },
  "checkOutputRedirections": {
    name: "bash-output-redirections",
    adapter: "checkOutputRedirections",
    binding: "Lnn",
    anchor: "No unsafe redirections found",
    target: "free-function",
    params: 4,
    captures: [
      {
        as: "checkPathPolicy",
        kind: "effectful-port",
        derive: deriveDecisionCapture("checkOutputRedirections", "free-function", 0, "Omt"),
      },
      {
        as: "allowedDirectories",
        kind: "effectful-port",
        derive: deriveDecisionCapture("checkOutputRedirections", "free-function", 1, "TT"),
      },
      {
        as: "formatAllowedDirectories",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkOutputRedirections", "free-function", 2, "Rpn"),
      },
      {
        as: "dirname",
        kind: "effectful-port",
        derive: deriveDecisionCapture("checkOutputRedirections", "free-function", 3, "qN"),
      },
    ],
  },
  "checkAstPathCommand": {
    name: "bash-ast-path-command",
    adapter: "checkAstPathCommand",
    binding: "Dnn",
    anchor: "let u=Db(e.argv)",
    target: "free-function",
    params: 4,
    captures: [
      {
        as: "peelCommandPrefixes",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkAstPathCommand", "free-function", 0, "Db"),
      },
      {
        as: "basenameCommand",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkAstPathCommand", "free-function", 1, "x8"),
      },
      {
        as: "pathCommands",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkAstPathCommand", "free-function", 2, "s8e"),
      },
      {
        as: "isSedReadOnly",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkAstPathCommand", "free-function", 3, "cL"),
      },
      {
        as: "normalizeCommandPrefix",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkAstPathCommand", "free-function", 4, "Ah"),
      },
      {
        as: "createPathCommandChecker",
        kind: "owned-binding",
        derive: deriveDecisionCapture("checkAstPathCommand", "free-function", 5, "i8e"),
      },
    ],
  },
  "checkTextPathCommand": {
    name: "bash-text-path-command",
    adapter: "checkTextPathCommand",
    binding: "Onn",
    anchor: "let u=Ah(e),d=Inn(u)",
    target: "free-function",
    params: 4,
    captures: [
      {
        as: "normalizeCommandPrefix",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkTextPathCommand", "free-function", 0, "Ah"),
      },
      {
        as: "commandArgv",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkTextPathCommand", "free-function", 1, "Inn"),
      },
      {
        as: "basenameCommand",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkTextPathCommand", "free-function", 2, "x8"),
      },
      {
        as: "pathCommands",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkTextPathCommand", "free-function", 3, "s8e"),
      },
      {
        as: "isSedReadOnly",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkTextPathCommand", "free-function", 4, "cL"),
      },
      {
        as: "createPathCommandChecker",
        kind: "owned-binding",
        derive: deriveDecisionCapture("checkTextPathCommand", "free-function", 5, "i8e"),
      },
    ],
  },
  "createPathCommandChecker": {
    name: "bash-path-command-checker",
    adapter: "createPathCommandChecker",
    binding: "i8e",
    anchor: "let _=Mnn(e,r,o,u,d,t);if(_.behavior===\"deny\")",
    target: "free-function",
    params: 2,
    captures: [
      {
        as: "checkPathCommand",
        kind: "owned-binding",
        derive: deriveDecisionCapture("createPathCommandChecker", "free-function", 0, "Mnn"),
      },
      {
        as: "checkDangerousRemoval",
        kind: "owned-binding",
        derive: deriveDecisionCapture("createPathCommandChecker", "free-function", 1, "dL"),
      },
      {
        as: "pathEffectKinds",
        kind: "owned-binding",
        derive: deriveDecisionCapture("createPathCommandChecker", "free-function", 2, "DP"),
      },
      {
        as: "dirname",
        kind: "effectful-port",
        derive: deriveDecisionCapture("createPathCommandChecker", "free-function", 3, "qN"),
      },
      {
        as: "directoryRuleSuggestion",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("createPathCommandChecker", "free-function", 4, "YTe"),
      },
    ],
  },
  "checkPathCommand": {
    name: "bash-path-command",
    adapter: "checkPathCommand",
    binding: "Mnn",
    anchor: "Path validation passed for ",
    target: "free-function",
    params: 6,
    captures: [
      {
        as: "pathArgumentExtractors",
        kind: "owned-binding",
        derive: deriveDecisionCapture("checkPathCommand", "free-function", 0, "pL"),
      },
      {
        as: "pathEffectKinds",
        kind: "owned-binding",
        derive: deriveDecisionCapture("checkPathCommand", "free-function", 1, "DP"),
      },
      {
        as: "hasUnknownTrackedValue",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkPathCommand", "free-function", 2, "Qa"),
      },
      {
        as: "pathFlagValidators",
        kind: "owned-binding",
        derive: deriveDecisionCapture("checkPathCommand", "free-function", 3, "xnn"),
      },
      {
        as: "checkPathPolicy",
        kind: "effectful-port",
        derive: deriveDecisionCapture("checkPathCommand", "free-function", 4, "Omt"),
      },
      {
        as: "allowedDirectories",
        kind: "effectful-port",
        derive: deriveDecisionCapture("checkPathCommand", "free-function", 5, "TT"),
      },
      {
        as: "formatAllowedDirectories",
        kind: "pure-helper",
        owned: true,
        derive: deriveDecisionCapture("checkPathCommand", "free-function", 6, "Rpn"),
      },
      {
        as: "pathEffectDescriptions",
        kind: "owned-binding",
        derive: deriveDecisionCapture("checkPathCommand", "free-function", 7, "Pnn"),
      },
    ],
  },
} as const;
