// Pure, copy-ready capture declarations for C13b's runtime splice roots.
// Importing this module performs no bundle I/O or validation.

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
  kind: "primitive" | "pure-helper" | "effectful-port";
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
      "kind": "effectful-port"
    },
    {
      "as": "decorateDecision",
      "kind": "effectful-port"
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
      "kind": "primitive"
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
      "kind": "effectful-port"
    },
    {
      "as": "checkTooComplexSandbox",
      "kind": "effectful-port"
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
      "kind": "effectful-port"
    },
    {
      "as": "checkSandboxAutoAllow",
      "kind": "effectful-port"
    },
    {
      "as": "checkExactPermission",
      "kind": "effectful-port"
    },
    {
      "as": "checkPipeSafety",
      "kind": "pure-helper",
      "owned": true
    },
    {
      "as": "checkPermission",
      "kind": "effectful-port"
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
      "kind": "effectful-port"
    },
    {
      "as": "currentWorkingDirectory",
      "kind": "effectful-port"
    },
    {
      "as": "checkPathSafety",
      "kind": "effectful-port"
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
      "kind": "effectful-port"
    },
    {
      "as": "isSafeCdSequence",
      "kind": "pure-helper",
      "owned": true
    },
    {
      "as": "resolveLeadingDirectoryChange",
      "kind": "effectful-port"
    },
    {
      "as": "isCdGitAstSequenceSafe",
      "kind": "effectful-port"
    },
    {
      "as": "hasUnsafeGitStructureFromAnalysis",
      "kind": "effectful-port"
    },
    {
      "as": "hasUnsafeGitStructureFromCommand",
      "kind": "effectful-port"
    },
    {
      "as": "checkDirectCommand",
      "kind": "effectful-port"
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
      "kind": "effectful-port"
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
