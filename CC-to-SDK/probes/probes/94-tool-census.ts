// Probe 94 — F1/P94 evidence gate. This is a census helper, not the production OE port.
// It records only structural tool-wire facts: no prompts, prose, command strings, paths, IDs, or results.
// Canonical SDK 0.3.220 evidence completed 2026-08-02. The completed-frame census is provenance-aware:
// only a result associated with the originating user turn can complete a case; task/background/synthetic
// results are recorded separately. Re-run this exact source for drift, never reuse historical counts.
// tool_result.content and optional structured sidecars remain privacy-scrubbed. Full report:
// docs/superpowers/research/2026-07-31-tui-clone/07-p94-tool-census.md.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

type UnknownRecord = Record<string, unknown>;
type Distribution = {
  count: number;
  min: number | null;
  max: number | null;
  values: { value: number; count: number }[];
};
type Failure = { caseId: string; repetition: number; stage: string; kind: string };
type ToolUse = { name: string; input: unknown; result?: UnknownRecord; structuredResult?: unknown };
type ObservedCall = ToolUse & { caseId: string; repetition: number };
type StructuredResultOutcome = {
  messages: number;
  unmatched: number;
  ambiguous: number;
  duplicates: number;
  unassociatedShapes: string[];
};
type ResultOrigin = "absent" | "human" | "channel" | "peer" | "task-notification" | "coordinator" | "observer" | "auto-continuation" | "observer-activity" | "other";
type UserMessageRoute = { origin: ResultOrigin; synthetic: boolean; shouldQuery: boolean };
type ResultFrameProvenance = {
  origin: ResultOrigin;
  originSubkind: "none" | "scheduled-trigger";
  userMessageUuid: "missing" | "present";
  userMessageAssociation: "missing" | "unseen" | "matched-query" | "matched-non-query" | "matched-non-human" | "matched-synthetic";
  isOriginatingUserTurn: boolean;
};
type ResultFrame = {
  subtype: string;
  isError: boolean;
  apiErrorStatus?: number;
  unhealthyText: boolean;
  provenance: ResultFrameProvenance;
};
type PairState = {
  resolvedModel?: string;
  uses: Map<string, ToolUse>;
  unmatchedResults: number;
  duplicateUses: number;
  duplicateResults: number;
  structuredResultMessages: number;
  structuredResultUnmatched: number;
  structuredResultAmbiguous: number;
  duplicateStructuredResults: number;
  unassociatedStructuredShapes: string[];
  userMessageRoutes: Map<string, UserMessageRoute>;
  resultFrames: ResultFrame[];
};
type RunOutcome = { calls: ObservedCall[]; resolvedModel?: string; failures: Failure[]; structuredResult: StructuredResultOutcome; resultFrames: ResultFrame[] };
type Fixture = { root: string; repo: string; config: string };
type CaseSpec = { id: string; prompt: string; coverage?: "write"; tools?: string[] | { type: "preset"; preset: "claude_code" } };
type BashClassification = {
  heads: string[];
  classifiable: boolean;
  search: boolean;
  read: boolean;
  list: boolean;
  ignored: boolean;
  observedSearch: boolean;
  observedRead: boolean;
  observedList: boolean;
  observedIgnored: boolean;
};

const PROBE_VERSION = "94";
const CORPUS_REVISION = "f1-p94-r3";
const EXPECTED_SDK_VERSION = "0.3.220";
const MODEL_ALIAS = "fable";
const DEFAULT_REPETITIONS = 2;
const CASE_TIMEOUT_MS = 900_000;
const FIXTURE_COMMAND_TIMEOUT_MS = 30_000;
const MAX_TURNS = 24;
const SEARCH_HEADS = new Set(["find", "grep", "rg", "ag", "ack", "locate", "which", "whereis"]);
const READ_HEADS = new Set(["cat", "head", "tail", "less", "more", "wc", "stat", "file", "strings", "jq", "awk", "cut", "sort", "uniq", "tr"]);
const LIST_HEADS = new Set(["ls", "tree", "du"]);
const IGNORED_HEADS = new Set(["echo", "printf", "true", "false", ":"]);
const ALTERNATE_PROVIDER_ENV_VARS = [
  "ANTHROPIC_BASE_URL",
  "CLAUDE_CODE_USE_ANTHROPIC_AWS",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_FOUNDRY",
  "CLAUDE_CODE_USE_VERTEX",
] as const;
// Keep the final census at command-head granularity without publishing arbitrary executable names.
const SAFE_BASH_HEADS = new Set([
  ...SEARCH_HEADS, ...READ_HEADS, ...LIST_HEADS, ...IGNORED_HEADS,
  "git", "node", "npm", "npx", "pnpm", "tsx", "tsc", "vitest", "sed", "perl",
  "python", "python3", "bash", "sh", "mkdir", "rmdir", "touch", "rm", "cp", "mv", "readlink",
  "dirname", "basename", "cd", "export", "unset", "wait", "chmod", "chown", "chgrp", "ln",
]);
// Publish only fixed SDK/tool schema vocabulary. Unknown map keys can be user prose, paths, or IDs.
const SAFE_STRUCTURAL_KEYS = new Set([
  "activeForm", "agentId", "agentType", "bashCount", "block", "cache_creation", "cache_creation_input_tokens",
  "cache_read_input_tokens", "canReadOutputFile", "command", "content", "description", "editFileCount",
  "ephemeral_1h_input_tokens", "ephemeral_5m_input_tokens", "file", "filePath", "file_path", "inference_geo",
  "input_tokens", "interrupted", "isAsync", "isImage", "isRawTranscript", "is_error", "iterations", "lineCount",
  "lines", "linesAdded", "linesRemoved", "model", "newLines", "newStart", "newString", "new_string",
  "noOutputExpected", "numLines", "oldLines", "oldStart", "oldString", "old_string", "originalFile",
  "otherToolCount", "output", "outputFile", "output_tokens", "path", "prompt", "readCount", "replaceAll",
  "replace_all", "resolvedModel", "result", "retrieval_status", "returnCodeInterpretation", "run_in_background",
  "searchCount", "server_tool_use", "service_tier", "speed", "startLine", "status", "stderr", "stdout",
  "structuredPatch", "subagent_type", "subject", "task", "taskId", "task_id", "task_type", "text", "timeout",
  "toolStats", "tool_use_id", "totalDurationMs", "totalLines", "totalTokens", "totalToolUseCount", "type", "usage",
  "userModified", "web_fetch_requests", "web_search_requests",
]);

const NATURAL_CASES: CaseSpec[] = [
  {
    id: "orientation",
    prompt: "Give a concise orientation to this repository: identify its entry points, parsing and header-normalization responsibilities, how it is checked, and the most relevant next change area. Do not modify files.",
  },
  {
    id: "cross-file-flag-search",
    prompt: "Determine whether the acceptBareKinds migration switch is used consistently across this repository. Report each behavior it controls and any compatibility risk. Do not modify files.",
  },
  {
    id: "test-coverage-discovery",
    prompt: "Assess whether the current checks cover parser and header-normalization behavior. Identify the important covered and uncovered paths, without changing files.",
  },
  {
    id: "header-normalizer-inspection",
    prompt: "Inspect the header-normalization behavior closely. Explain its inputs, normalization rules, callers, edge cases, and whether its current checks support the intended contract. Do not modify files.",
  },
  {
    id: "parser-file-classification",
    prompt: "Classify the parser-related files in this repository into core parser, interface or normalization, checks, documentation, and unrelated support. Give concise evidence for each classification. Do not modify files.",
  },
  {
    id: "parser-behavior-edit",
    prompt: "Make the parser require the `kind=` prefix for kind tags while preserving supported prefixed values. Update the narrowest relevant check and verify the changed behavior. Keep the change focused.",
  },
  {
    id: "local-verification-selection",
    prompt: "Choose and run the narrowest local verification appropriate for parser and header-normalization changes. Do not modify files. State what the verification covers and any limitation.",
  },
  {
    id: "migration-documentation",
    prompt: "Add migration documentation explaining the move from bare kind values to required `kind=` tags, link it from the README documentation list, and verify the documentation link and the relevant local checks. Keep the documentation concise.",
  },
];

const WRITE_COVERAGE_CASE: CaseSpec = {
  id: "write-coverage",
  prompt: "Use the available Write tool exactly once to create a new three-line note at the supplied absolute path. Do not use any other tool or modify any other file.",
  coverage: "write",
  tools: ["Write"],
};
const ALL_CASES = [...NATURAL_CASES, WRITE_COVERAGE_CASE];

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function probeTempParent(): string {
  const parent = process.env.CLAUDE_JOB_DIR ? join(process.env.CLAUDE_JOB_DIR, "tmp") : tmpdir();
  mkdirSync(parent, { recursive: true });
  return parent;
}

function sortedCounts(counts: Map<string, number>): Record<string, number> {
  return Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function bump(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function distribution(values: number[]): Distribution {
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return {
    count: values.length,
    min: values.length ? Math.min(...values) : null,
    max: values.length ? Math.max(...values) : null,
    values: [...counts.entries()].sort(([a], [b]) => a - b).map(([value, count]) => ({ value, count })),
  };
}

function stringMeasures(value: unknown, chars: number[] = [], lines: number[] = []): { chars: number[]; lines: number[] } {
  if (typeof value === "string") {
    chars.push(value.length);
    lines.push(value.length ? value.split("\n").length : 0);
  } else if (Array.isArray(value)) {
    for (const item of value) stringMeasures(item, chars, lines);
  } else if (isRecord(value)) {
    for (const item of Object.values(value)) stringMeasures(item, chars, lines);
  }
  return { chars, lines };
}

// Values are intentionally represented by fixed schema keys, structure, and string dimensions only.
function valueShape(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return `string(chars=${value.length},newlines=${(value.match(/\n/g) ?? []).length})`;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "undefined") return typeof value;
  if (Array.isArray(value)) return `array(len=${value.length})[${value.map(valueShape).join(",")}]`;
  const known: string[] = [], dynamic: string[] = [];
  for (const [key, item] of Object.entries(value as UnknownRecord)) {
    const shape = valueShape(item);
    if (SAFE_STRUCTURAL_KEYS.has(key)) known.push(`${key}:${shape}`);
    else dynamic.push(`<dynamic-key>:${shape}`);
  }
  return `object{${[...known.sort(), ...dynamic.sort()].join(",")}}`;
}

function keySignature(value: UnknownRecord): string {
  const known = Object.keys(value).filter((key) => SAFE_STRUCTURAL_KEYS.has(key)).sort();
  const dynamic = Object.keys(value).length - known.length;
  if (dynamic) known.push(`<dynamic-keys:${dynamic}>`);
  return known.join("|") || "<empty>";
}

function inputKeySignature(input: unknown): string {
  if (!isRecord(input)) return `<${input === null ? "null" : Array.isArray(input) ? "array" : typeof input}>`;
  return keySignature(input);
}

function resultKeySignature(result: UnknownRecord): string {
  return keySignature(result);
}

function contentKind(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function safeToolName(name: unknown): string {
  const text = typeof name === "string" ? name : "Unknown";
  return /^[A-Za-z][A-Za-z0-9_:-]{0,80}$/.test(text) ? text : "Other";
}

function safeBashHead(head: string): string {
  return SAFE_BASH_HEADS.has(head) ? head : "other";
}

// This scanner deliberately handles only simple shell chains. Quotes shield separators; complex shell
// constructs return null rather than being partially classified.
function splitSimpleCommandChain(command: string): string[] | null {
  const parts: string[] = [];
  let quote: "'" | '"' | null = null;
  let escaped = false;
  let start = 0;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]!;
    const next = command[index + 1];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote) {
      if (quote === '"' && (char === "`" || (char === "$" && next === "("))) return null;
      if (quote === '"' && char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'") {
      quote = "'";
      continue;
    }
    if (char === '"') {
      quote = '"';
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    // Like upstream OE's redirected_statement unwrapping, ordinary redirections do not change the command head.
    if (char === "`" || char === "$" || char === "(" || char === ")" || char === "{" || char === "}" || (char === "&" && next !== "&")) return null;
    const separatorLength = char === ";" || char === "\n" ? 1 : (char === "|" && next !== "|") || (char === "|" && next === "|") || (char === "&" && next === "&") ? 2 : 0;
    if (!separatorLength) continue;
    const part = command.slice(start, index).trim();
    if (!part) return null;
    parts.push(part);
    if ((char === "|" || char === "&") && next === char) index += 1;
    start = index + 1;
  }
  if (quote || escaped) return null;
  const finalPart = command.slice(start).trim();
  if (!finalPart) return null;
  parts.push(finalPart);
  return parts;
}

function commandHead(part: string): string | null {
  const assignments = part.match(/^(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|[^\s]+)\s+)+/);
  if (assignments) return commandHead(part.slice(assignments[0].length));
  let quote: "'" | '"' | null = null;
  let escaped = false;
  let head = "";
  for (let index = 0; index < part.length; index += 1) {
    const char = part[index]!;
    if (escaped) {
      head += char;
      escaped = false;
      continue;
    }
    if (quote) {
      if (quote === '"' && char === "\\") escaped = true;
      else if (char === quote) quote = null;
      else head += char;
      continue;
    }
    if (/\s/.test(char)) break;
    if (char === "'") quote = "'";
    else if (char === '"') quote = '"';
    else if (char === "\\") escaped = true;
    else head += char;
  }
  return head && !quote && !escaped ? head.toLowerCase() : null;
}

function classifyBash(command: string): BashClassification | null {
  const parts = splitSimpleCommandChain(command);
  if (!parts) return null;
  const heads: string[] = [];
  let classifiable = true;
  let observedSearch = false;
  let observedRead = false;
  let observedList = false;
  let observedIgnored = false;
  for (const part of parts) {
    const head = commandHead(part);
    if (!head) return null;
    heads.push(safeBashHead(head));
    if (SEARCH_HEADS.has(head)) observedSearch = true;
    else if (READ_HEADS.has(head)) observedRead = true;
    else if (LIST_HEADS.has(head)) observedList = true;
    else if (IGNORED_HEADS.has(head)) observedIgnored = true;
    else classifiable = false;
  }
  return {
    heads,
    classifiable,
    search: classifiable && observedSearch,
    read: classifiable && observedRead,
    list: classifiable && observedList,
    ignored: classifiable && observedIgnored,
    observedSearch,
    observedRead,
    observedList,
    observedIgnored,
  };
}

function createFixture(): Fixture {
  const root = mkdtempSync(join(probeTempParent(), "p94-tool-census-"));
  const repo = join(root, "repository");
  const config = join(root, "claude-config");
  try {
    mkdirSync(join(repo, "src"), { recursive: true });
  mkdirSync(join(repo, "test"), { recursive: true });
  mkdirSync(join(repo, "docs"), { recursive: true });
  mkdirSync(config, { recursive: true });
  writeFileSync(join(repo, "package.json"), JSON.stringify({
    name: "header-parser-lab",
    private: true,
    type: "module",
    scripts: { test: "node --test test/parser.test.mjs test/header-normalizer.test.mjs", "test:parser": "node --test test/parser.test.mjs" },
  }, null, 2) + "\n");
  writeFileSync(join(repo, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", noEmit: true } }, null, 2) + "\n");
  writeFileSync(join(repo, "README.md"), [
    "# Header Parser Lab",
    "",
    "Small TypeScript-style parser fixture for header migration work.",
    "",
    "## Documentation",
    "",
    "- [Architecture](docs/architecture.md)",
    "",
    "## Checks",
    "",
    "Run `npm test` for the local parser and normalization checks.",
    "",
  ].join("\n"));
  writeFileSync(join(repo, "src", "header-normalizer.ts"), [
    "export function normalizeHeaderName(value) {",
    "  return value.trim().toLowerCase().replace(/[_ ]+/g, \"-\");",
    "}",
    "",
    "export function normalizeHeaderValue(value) {",
    "  return value.trim().replace(/\\s+/g, \" \");",
    "}",
    "",
    "export function isTrustedHeader(name) {",
    "  return normalizeHeaderName(name).startsWith(\"x-lab-\");",
    "}",
    "",
  ].join("\n"));
  writeFileSync(join(repo, "src", "parser.ts"), [
    "import { normalizeHeaderName, normalizeHeaderValue } from \"./header-normalizer.ts\";",
    "",
    "const SUPPORTED_KINDS = new Set([\"info\", \"warning\", \"error\"]);",
    "",
    "export function parseHeader(line) {",
    "  const separator = line.indexOf(\":\");",
    "  if (separator < 1) return null;",
    "  return {",
    "    name: normalizeHeaderName(line.slice(0, separator)),",
    "    value: normalizeHeaderValue(line.slice(separator + 1)),",
    "  };",
    "}",
    "",
    "export function parseKindTag(value) {",
    "  const candidate = value.trim();",
    "  const kind = candidate.startsWith(\"kind=\") ? candidate.slice(5) : candidate;",
    "  return SUPPORTED_KINDS.has(kind) ? kind : null;",
    "}",
    "",
  ].join("\n"));
  writeFileSync(join(repo, "src", "index.ts"), [
    "export { parseHeader, parseKindTag } from \"./parser.ts\";",
    "export { normalizeHeaderName, normalizeHeaderValue, isTrustedHeader } from \"./header-normalizer.ts\";",
    "",
  ].join("\n"));
  writeFileSync(join(repo, "test", "load-module.mjs"), [
    "import { readFile } from \"node:fs/promises\";",
    "",
    "export async function loadTypeScriptModule(relativePath) {",
    "  const source = await readFile(new URL(relativePath, import.meta.url), \"utf8\");",
    "  return import(`data:text/javascript;base64,${Buffer.from(source).toString(\"base64\")}`);",
    "}",
    "",
    "export async function loadParser() {",
    "  const normalizerSource = await readFile(new URL(\"../src/header-normalizer.ts\", import.meta.url), \"utf8\");",
    "  const normalizerUrl = `data:text/javascript;base64,${Buffer.from(normalizerSource).toString(\"base64\")}`;",
    "  const parserSource = await readFile(new URL(\"../src/parser.ts\", import.meta.url), \"utf8\");",
    "  const resolved = parserSource.replace(\"./header-normalizer.ts\", normalizerUrl);",
    "  return import(`data:text/javascript;base64,${Buffer.from(resolved).toString(\"base64\")}`);",
    "}",
    "",
  ].join("\n"));
  writeFileSync(join(repo, "test", "parser.test.mjs"), [
    "import assert from \"node:assert/strict\";",
    "import test from \"node:test\";",
    "import { loadParser } from \"./load-module.mjs\";",
    "",
    "const parser = await loadParser();",
    "",
    "test(\"parses a normalized header\", () => {",
    "  assert.deepEqual(parser.parseHeader(\" X_Lab_Mode : enabled \"), { name: \"x-lab-mode\", value: \"enabled\" });",
    "});",
    "",
    "test(\"accepts supported kind tags\", () => {",
    "  assert.equal(parser.parseKindTag(\"warning\"), \"warning\");",
    "  assert.equal(parser.parseKindTag(\"kind=error\"), \"error\");",
    "  assert.equal(parser.parseKindTag(\"kind=unknown\"), null);",
    "});",
    "",
  ].join("\n"));
  writeFileSync(join(repo, "test", "header-normalizer.test.mjs"), [
    "import assert from \"node:assert/strict\";",
    "import test from \"node:test\";",
    "import { loadTypeScriptModule } from \"./load-module.mjs\";",
    "",
    "const normalizer = await loadTypeScriptModule(\"../src/header-normalizer.ts\");",
    "",
    "test(\"normalizes header names and values\", () => {",
    "  assert.equal(normalizer.normalizeHeaderName(\" X_Lab Mode \"), \"x-lab-mode\");",
    "  assert.equal(normalizer.normalizeHeaderValue(\"  one   two \"), \"one two\");",
    "});",
    "",
  ].join("\n"));
  writeFileSync(join(repo, "docs", "architecture.md"), [
    "# Architecture",
    "",
    "`src/parser.ts` separates header names and values, then delegates normalization to `src/header-normalizer.ts`.",
    "Kind values currently accept both bare values and `kind=` tags while the migration is in progress.",
    "",
  ].join("\n"));
  writeFileSync(join(repo, "docs", "flag-migration.md"), [
    "# Flag migration",
    "",
    "`acceptBareKinds` remains only for compatibility review. New callers should send `kind=<value>`.",
    "",
  ].join("\n"));
  writeFileSync(join(repo, "src", "compatibility.ts"), [
    "export const acceptBareKinds = true;",
    "export function migrationMode() { return acceptBareKinds ? \"compatibility\" : \"strict\"; }",
    "",
  ].join("\n"));
    const nullDevice = process.platform === "win32" ? "NUL" : "/dev/null";
    const gitEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: nullDevice, GIT_ATTR_NOSYSTEM: "1" };
    execFileSync("git", ["init", "-q"], { cwd: repo, env: gitEnv, stdio: "ignore", timeout: FIXTURE_COMMAND_TIMEOUT_MS });
    execFileSync("git", ["add", "."], { cwd: repo, env: gitEnv, stdio: "ignore", timeout: FIXTURE_COMMAND_TIMEOUT_MS });
    execFileSync("git", ["-c", `core.hooksPath=${nullDevice}`, "-c", "user.name=P94", "-c", "user.email=p94@example.invalid", "commit", "--no-verify", "-qm", "baseline"], { cwd: repo, env: gitEnv, stdio: "ignore", timeout: FIXTURE_COMMAND_TIMEOUT_MS });
    return { root, repo, config };
  } catch {
    rmSync(root, { recursive: true, force: true });
    throw new Error("fixture_setup_failed");
  }
}

function resultOrigin(value: unknown): Pick<ResultFrameProvenance, "origin" | "originSubkind"> {
  if (!isRecord(value)) return { origin: "absent", originSubkind: "none" };
  const kind = value.kind;
  const origin: ResultOrigin = kind === "human" || kind === "channel" || kind === "peer" || kind === "task-notification" || kind === "coordinator" || kind === "observer" || kind === "auto-continuation" || kind === "observer-activity" ? kind : "other";
  return { origin, originSubkind: origin === "task-notification" && value.subkind === "scheduled-trigger" ? "scheduled-trigger" : "none" };
}

function resultFrameProvenance(state: PairState, message: UnknownRecord): ResultFrameProvenance {
  const { origin, originSubkind } = resultOrigin(message.origin);
  const userMessageUuid = typeof message.user_message_uuid === "string" && message.user_message_uuid.length > 0 ? "present" : "missing";
  const user = userMessageUuid === "present" ? state.userMessageRoutes.get(message.user_message_uuid as string) : undefined;
  const userMessageAssociation = userMessageUuid === "missing" ? "missing"
    : !user ? "unseen"
    : user.synthetic ? "matched-synthetic"
    : !user.shouldQuery ? "matched-non-query"
    : user.origin !== "human" ? "matched-non-human"
    : "matched-query";
  const isOriginatingUserTurn = userMessageUuid === "present"
    && (origin === "absent" || origin === "human")
    && userMessageAssociation === "matched-query";
  return { origin, originSubkind, userMessageUuid, userMessageAssociation, isOriginatingUserTurn };
}

function safeResultSubtype(value: unknown): string {
  return typeof value === "string" && /^[A-Za-z0-9_:-]{1,80}$/.test(value) ? value : "unknown";
}

function consumeCompletedMessage(state: PairState, message: unknown): void {
  if (!isRecord(message)) return;
  if (message.type === "system" && message.subtype === "init" && typeof message.model === "string") state.resolvedModel = message.model;
  if (message.type === "assistant") {
    const content = isRecord(message.message) && Array.isArray(message.message.content) ? message.message.content : [];
    for (const block of content) {
      if (!isRecord(block) || block.type !== "tool_use" || typeof block.id !== "string" || block.id.length === 0) continue;
      if (state.uses.has(block.id)) {
        state.duplicateUses += 1;
        continue;
      }
      state.uses.set(block.id, { name: safeToolName(block.name), input: block.input });
    }
  }
  if (message.type === "user") {
    if (typeof message.uuid === "string" && message.uuid.length > 0 && !state.userMessageRoutes.has(message.uuid)) {
      const route = resultOrigin(message.origin);
      state.userMessageRoutes.set(message.uuid, { origin: route.origin, synthetic: message.isSynthetic === true, shouldQuery: message.shouldQuery !== false });
    }
    const content = isRecord(message.message) && Array.isArray(message.message.content) ? message.message.content : [];
    const toolResultBlocks = content.filter((block): block is UnknownRecord => isRecord(block) && block.type === "tool_result");
    const matchedUses: ToolUse[] = [];
    for (const block of toolResultBlocks) {
      if (typeof block.tool_use_id !== "string" || block.tool_use_id.length === 0) {
        state.unmatchedResults += 1;
        continue;
      }
      const use = state.uses.get(block.tool_use_id);
      if (!use) {
        state.unmatchedResults += 1;
        continue;
      }
      if (use.result) {
        state.duplicateResults += 1;
        continue;
      }
      use.result = block;
      matchedUses.push(use);
    }
    if (Object.hasOwn(message, "tool_use_result") && message.tool_use_result !== undefined) {
      state.structuredResultMessages += 1;
      const uniqueUses = [...new Set(matchedUses)];
      if (toolResultBlocks.length === 1 && uniqueUses.length === 1) {
        if (uniqueUses[0]!.structuredResult !== undefined) state.duplicateStructuredResults += 1;
        else uniqueUses[0]!.structuredResult = message.tool_use_result;
      } else {
        if (toolResultBlocks.length === 0 || uniqueUses.length === 0) state.structuredResultUnmatched += 1;
        else state.structuredResultAmbiguous += 1;
        state.unassociatedStructuredShapes.push(valueShape(message.tool_use_result));
      }
    }
  }
  if (message.type === "result") {
    const texts = [message.result, ...(Array.isArray(message.errors) ? message.errors : [])].filter((value): value is string => typeof value === "string");
    state.resultFrames.push({
      subtype: safeResultSubtype(message.subtype),
      isError: message.is_error === true,
      ...(typeof message.api_error_status === "number" ? { apiErrorStatus: message.api_error_status } : {}),
      unhealthyText: texts.some(unhealthyResultText),
      provenance: resultFrameProvenance(state, message),
    });
  }
}

function unhealthyResultText(text: string): boolean {
  return /^\s*API Error:/i.test(text);
}

function resultSubtypeFailure(subtype: string | undefined): string {
  const known = new Set(["error_during_execution", "error_max_turns", "error_max_budget_usd", "error_max_structured_output_retries"]);
  return subtype && known.has(subtype) ? subtype : "non_success_result";
}

async function* originatingPrompt(text: string, uuid: ReturnType<typeof randomUUID>): AsyncIterable<SDKUserMessage> {
  yield {
    type: "user",
    uuid,
    origin: { kind: "human" },
    message: { role: "user", content: text },
    parent_tool_use_id: null,
  };
}

function casePrompt(spec: CaseSpec, fixture: Fixture): string {
  if (spec.coverage !== "write") return spec.prompt;
  return `Use the available Write tool exactly once to create a new note containing exactly three non-empty lines at the absolute path \`${join(fixture.repo, "write-coverage.md")}\`. Do not use any other tool or modify any other file.`;
}

function writeCoverageFailureKinds(state: PairState, expectedPath: string): string[] {
  const failures: string[] = [], calls = [...state.uses.values()];
  const call = calls.length === 1 && calls[0]?.name === "Write" ? calls[0] : undefined;
  if (!call) return ["expected_exactly_one_write_call"];
  const input = isRecord(call.input) ? call.input : undefined;
  const content = typeof input?.content === "string" ? input.content : undefined;
  const lines = content?.replace(/\r\n/g, "\n").split("\n") ?? [];
  if (lines.at(-1) === "") lines.pop();
  const inputValid = input?.file_path === expectedPath && Boolean(content) && lines.length === 3 && lines.every((line) => line.trim().length > 0);
  if (!inputValid) failures.push("invalid_write_input");
  else {
    try {
      if (readFileSync(expectedPath, "utf8") !== content) failures.push("written_file_mismatch");
    } catch {
      failures.push("missing_written_file");
    }
  }
  if (!call.result) failures.push("missing_write_result");
  else if (call.result.is_error === true) failures.push("write_result_is_error");
  const sidecar = isRecord(call.structuredResult) ? call.structuredResult : undefined;
  if (!sidecar || sidecar.type !== "create" || sidecar.filePath !== expectedPath || sidecar.content !== content || sidecar.originalFile !== null || !Array.isArray(sidecar.structuredPatch) || sidecar.structuredPatch.length !== 0 || sidecar.userModified !== false) failures.push("invalid_write_sidecar");
  return failures;
}

async function runCase(spec: CaseSpec, repetition: number, privateRoots: string[]): Promise<RunOutcome> {
  let fixture: Fixture | undefined;
  const state: PairState = {
    uses: new Map(), unmatchedResults: 0, duplicateUses: 0, duplicateResults: 0,
    structuredResultMessages: 0, structuredResultUnmatched: 0, structuredResultAmbiguous: 0,
    duplicateStructuredResults: 0, unassociatedStructuredShapes: [],
    userMessageRoutes: new Map(), resultFrames: [],
  };
  const failures: Failure[] = [];
  const abortController = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    abortController.abort();
  }, CASE_TIMEOUT_MS);
  let q: ReturnType<typeof query> | undefined;
  let activeStage = "setup";
  try {
    fixture = createFixture();
    privateRoots.push(fixture.root);
    const rootTurnUuid = randomUUID();
    state.userMessageRoutes.set(rootTurnUuid, { origin: "human", synthetic: false, shouldQuery: true });
    activeStage = "query";
    q = query({
      prompt: originatingPrompt(casePrompt(spec, fixture), rootTurnUuid),
      options: {
        model: MODEL_ALIAS,
        effort: "xhigh",
        cwd: fixture.repo,
        settingSources: [],
        tools: spec.tools ?? { type: "preset", preset: "claude_code" },
        permissionMode: "auto",
        canUseTool: async (_name: string, input: unknown) => ({ behavior: "allow", updatedInput: input }),
        persistSession: false,
        maxTurns: MAX_TURNS,
        abortController,
        env: { ...process.env, CLAUDE_CONFIG_DIR: fixture.config },
      } as any,
    });
    await q.initializationResult();
    for await (const message of q) {
      // Do not consume partial/stream frames; assistant and user messages are completed transcript frames.
      if (isRecord(message) && (message.type === "assistant" || message.type === "user" || message.type === "system" || message.type === "result")) consumeCompletedMessage(state, message);
    }
    if (spec.coverage === "write") for (const kind of writeCoverageFailureKinds(state, join(fixture.repo, "write-coverage.md"))) failures.push({ caseId: spec.id, repetition, stage: "coverage", kind });
  } catch {
    failures.push({ caseId: spec.id, repetition, stage: activeStage, kind: timedOut ? `${activeStage}_timeout` : `${activeStage}_failed` });
  } finally {
    clearTimeout(timeout);
    q?.close();
    if (fixture) {
      try {
        rmSync(fixture.root, { recursive: true, force: true });
      } catch {
        failures.push({ caseId: spec.id, repetition, stage: "cleanup", kind: "cleanup_failed" });
      }
    }
  }
  if (!failures.length) {
    if (!state.resolvedModel) failures.push({ caseId: spec.id, repetition, stage: "initialization", kind: "missing_resolved_model" });
    const originatingResults = state.resultFrames.filter((frame) => frame.provenance.isOriginatingUserTurn);
    if (originatingResults.length === 0) failures.push({ caseId: spec.id, repetition, stage: "completion", kind: "missing_originating_user_result" });
    for (const subtype of new Set(originatingResults.map((frame) => frame.subtype).filter((value) => value !== "success"))) failures.push({ caseId: spec.id, repetition, stage: "completion", kind: resultSubtypeFailure(subtype) });
    if (originatingResults.some((frame) => frame.isError)) failures.push({ caseId: spec.id, repetition, stage: "completion", kind: "result_is_error" });
    if (originatingResults.some((frame) => (frame.apiErrorStatus ?? 0) >= 400 || frame.unhealthyText)) failures.push({ caseId: spec.id, repetition, stage: "health", kind: "unhealthy_result" });
    const paired = [...state.uses.values()].filter((use) => use.result).length;
    if (state.uses.size === 0) failures.push({ caseId: spec.id, repetition, stage: "census", kind: "no_tool_calls" });
    if (paired !== state.uses.size || state.unmatchedResults || state.duplicateUses || state.duplicateResults) failures.push({ caseId: spec.id, repetition, stage: "pairing", kind: "unpaired_or_duplicate" });
  }
  const calls = [...state.uses.values()]
    .filter((use): use is ToolUse & { result: UnknownRecord } => Boolean(use.result))
    .map((use) => ({ ...use, caseId: spec.id, repetition }));
  return {
    calls,
    resolvedModel: state.resolvedModel,
    failures,
    structuredResult: {
      messages: state.structuredResultMessages,
      unmatched: state.structuredResultUnmatched,
      ambiguous: state.structuredResultAmbiguous,
      duplicates: state.duplicateStructuredResults,
      unassociatedShapes: state.unassociatedStructuredShapes,
    },
    resultFrames: state.resultFrames,
  };
}

function summarizeCalls(calls: ObservedCall[]) {
  const perTool = new Map<string, {
    calls: number;
    cases: Set<string>;
    repetitions: Set<number>;
    inputKeys: Map<string, number>;
    inputShapes: Map<string, number>;
    inputChars: number[];
    inputLines: number[];
    resultKeys: Map<string, number>;
    resultKinds: Map<string, number>;
    resultShapes: Map<string, number>;
    resultErrors: Map<string, number>;
    resultChars: number[];
    resultLines: number[];
    structuredPresence: Map<string, number>;
    structuredKinds: Map<string, number>;
    structuredShapes: Map<string, number>;
    structuredChars: number[];
    structuredLines: number[];
  }>();
  const cases = new Set<string>();
  const repetitions = new Set<number>();
  const shapeCorrelations = new Map<string, { tool: string; inputKeys: string; resultContentKind: string; resultIsError: string; count: number }>();
  const byCaseRepetition = new Map<string, { caseId: string; repetition: number; calls: number; tools: Map<string, number> }>();
  const bashHeads = new Map<string, number>();
  const krFamilies = new Map<string, number>();
  const observedBashFamilies = new Map<string, number>();
  let paired = 0;
  for (const call of calls) {
    cases.add(call.caseId);
    repetitions.add(call.repetition);
    let tool = perTool.get(call.name);
    if (!tool) {
      tool = { calls: 0, cases: new Set(), repetitions: new Set(), inputKeys: new Map(), inputShapes: new Map(), inputChars: [], inputLines: [], resultKeys: new Map(), resultKinds: new Map(), resultShapes: new Map(), resultErrors: new Map(), resultChars: [], resultLines: [], structuredPresence: new Map(), structuredKinds: new Map(), structuredShapes: new Map(), structuredChars: [], structuredLines: [] };
      perTool.set(call.name, tool);
    }
    tool.calls += 1;
    tool.cases.add(call.caseId);
    tool.repetitions.add(call.repetition);
    const keys = inputKeySignature(call.input);
    const shape = valueShape(call.input);
    const result = call.result!;
    const resultKind = contentKind(result.content);
    const resultError = result.is_error === true ? "true" : result.is_error === false ? "false" : "missing";
    bump(tool.inputKeys, keys);
    bump(tool.inputShapes, shape);
    bump(tool.resultKeys, resultKeySignature(result));
    bump(tool.resultKinds, resultKind);
    bump(tool.resultShapes, valueShape(result.content));
    bump(tool.resultErrors, resultError);
    const inputMeasures = stringMeasures(call.input);
    tool.inputChars.push(...inputMeasures.chars);
    tool.inputLines.push(...inputMeasures.lines);
    const resultMeasures = stringMeasures(result.content);
    tool.resultChars.push(...resultMeasures.chars);
    tool.resultLines.push(...resultMeasures.lines);
    if (call.structuredResult === undefined) {
      bump(tool.structuredPresence, "missing");
    } else {
      bump(tool.structuredPresence, "present");
      bump(tool.structuredKinds, contentKind(call.structuredResult));
      bump(tool.structuredShapes, valueShape(call.structuredResult));
      const structuredMeasures = stringMeasures(call.structuredResult);
      tool.structuredChars.push(...structuredMeasures.chars);
      tool.structuredLines.push(...structuredMeasures.lines);
    }
    const correlationKey = [call.name, keys, resultKind, resultError].join("\u0000");
    const correlation = shapeCorrelations.get(correlationKey) ?? { tool: call.name, inputKeys: keys, resultContentKind: resultKind, resultIsError: resultError, count: 0 };
    correlation.count += 1;
    shapeCorrelations.set(correlationKey, correlation);
    const caseKey = `${call.caseId}\u0000${call.repetition}`;
    const caseEntry = byCaseRepetition.get(caseKey) ?? { caseId: call.caseId, repetition: call.repetition, calls: 0, tools: new Map() };
    caseEntry.calls += 1;
    bump(caseEntry.tools, call.name);
    byCaseRepetition.set(caseKey, caseEntry);
    if (call.name === "Bash" && isRecord(call.input) && typeof call.input.command === "string") {
      const classified = classifyBash(call.input.command);
      if (!classified) {
        bump(krFamilies, "unclassifiable");
      } else {
        for (const head of classified.heads) bump(bashHeads, head);
        bump(krFamilies, classified.classifiable ? "classifiable" : "unclassifiable");
        if (classified.classifiable) {
          if (classified.search) bump(krFamilies, "search");
          if (classified.read) bump(krFamilies, "read");
          if (classified.list) bump(krFamilies, "list");
          if (classified.ignored) bump(krFamilies, "ignored");
        }
        if (classified.observedSearch) bump(observedBashFamilies, "search");
        if (classified.observedRead) bump(observedBashFamilies, "read");
        if (classified.observedList) bump(observedBashFamilies, "list");
        if (classified.observedIgnored) bump(observedBashFamilies, "ignored");
      }
    }
    paired += 1;
  }
  return {
    calls: calls.length,
    distinct: { cases: [...cases].sort(), repetitions: [...repetitions].sort((a, b) => a - b) },
    perTool: Object.fromEntries([...perTool.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, tool]) => [name, {
      calls: tool.calls,
      distinct: { cases: [...tool.cases].sort(), repetitions: [...tool.repetitions].sort((a, b) => a - b) },
      inputKeySignatures: sortedCounts(tool.inputKeys),
      inputValueShapeSignatures: sortedCounts(tool.inputShapes),
      inputStringChars: distribution(tool.inputChars),
      inputStringLines: distribution(tool.inputLines),
      resultBlockKeySignatures: sortedCounts(tool.resultKeys),
      resultContentKinds: sortedCounts(tool.resultKinds),
      resultContentShapeSignatures: sortedCounts(tool.resultShapes),
      resultIsError: sortedCounts(tool.resultErrors),
      resultStringChars: distribution(tool.resultChars),
      resultStringLines: distribution(tool.resultLines),
      toolUseResultPresence: sortedCounts(tool.structuredPresence),
      toolUseResultKinds: sortedCounts(tool.structuredKinds),
      toolUseResultShapeSignatures: sortedCounts(tool.structuredShapes),
      toolUseResultStringChars: distribution(tool.structuredChars),
      toolUseResultStringLines: distribution(tool.structuredLines),
    }])),
    correlations: {
      toolResultPairing: { paired, unpairedToolUses: 0, unpairedResults: 0 },
      callShapes: [...shapeCorrelations.values()].sort((a, b) => `${a.tool}\u0000${a.inputKeys}\u0000${a.resultContentKind}\u0000${a.resultIsError}`.localeCompare(`${b.tool}\u0000${b.inputKeys}\u0000${b.resultContentKind}\u0000${b.resultIsError}`)),
      caseRepetitions: [...byCaseRepetition.values()].sort((a, b) => a.caseId.localeCompare(b.caseId) || a.repetition - b.repetition).map((entry) => ({ caseId: entry.caseId, repetition: entry.repetition, calls: entry.calls, tools: sortedCounts(entry.tools) })),
    },
    bash: {
      commandHeads: sortedCounts(bashHeads),
      observedFamilies: sortedCounts(observedBashFamilies),
      krFamilies: sortedCounts(krFamilies),
    },
  };
}

function summarizeResultFrameGroup(frames: ResultFrame[]) {
  const subtypes = new Map<string, number>();
  const apiStatuses = new Map<string, number>();
  let errors = 0;
  let unhealthyText = 0;
  for (const frame of frames) {
    bump(subtypes, frame.subtype);
    if (frame.isError) errors += 1;
    if (frame.unhealthyText) unhealthyText += 1;
    if (frame.apiErrorStatus !== undefined) bump(apiStatuses, String(frame.apiErrorStatus));
  }
  return { count: frames.length, subtypes: sortedCounts(subtypes), errors, unhealthyText, apiErrorStatuses: sortedCounts(apiStatuses) };
}

function summarizeResultFrames(outcomes: RunOutcome[]) {
  const frames = outcomes.flatMap((outcome) => outcome.resultFrames);
  const originating = frames.filter((frame) => frame.provenance.isOriginatingUserTurn);
  const origins = new Map<string, number>();
  const originSubkinds = new Map<string, number>();
  const userMessageUuid = new Map<string, number>();
  const userMessageAssociation = new Map<string, number>();
  for (const frame of frames) {
    bump(origins, frame.provenance.origin);
    bump(originSubkinds, frame.provenance.originSubkind);
    bump(userMessageUuid, frame.provenance.userMessageUuid);
    bump(userMessageAssociation, frame.provenance.userMessageAssociation);
  }
  return {
    perRun: {
      total: distribution(outcomes.map((outcome) => outcome.resultFrames.length)),
      originatingUserTurn: distribution(outcomes.map((outcome) => outcome.resultFrames.filter((frame) => frame.provenance.isOriginatingUserTurn).length)),
    },
    originatingUserTurn: summarizeResultFrameGroup(originating),
    nonOriginating: summarizeResultFrameGroup(frames.filter((frame) => !frame.provenance.isOriginatingUserTurn)),
    provenance: {
      origins: sortedCounts(origins),
      originSubkinds: sortedCounts(originSubkinds),
      userMessageUuid: sortedCounts(userMessageUuid),
      userMessageAssociation: sortedCounts(userMessageAssociation),
    },
  };
}

function summarizeStructuredResultChannel(outcomes: RunOutcome[]) {
  const unassociatedShapes = new Map<string, number>();
  let messages = 0;
  let unmatched = 0;
  let ambiguous = 0;
  let duplicates = 0;
  for (const outcome of outcomes) {
    messages += outcome.structuredResult.messages;
    unmatched += outcome.structuredResult.unmatched;
    ambiguous += outcome.structuredResult.ambiguous;
    duplicates += outcome.structuredResult.duplicates;
    for (const shape of outcome.structuredResult.unassociatedShapes) bump(unassociatedShapes, shape);
  }
  const associated = outcomes.flatMap((outcome) => outcome.calls).filter((call) => call.structuredResult !== undefined).length;
  return { messages, associated, unmatched, ambiguous, duplicates, unassociatedShapeSignatures: sortedCounts(unassociatedShapes) };
}

function credentialValues(env: NodeJS.ProcessEnv): string[] {
  return Object.entries(env)
    .filter(([key, value]) => /(api[_-]?key|token|secret|password|credential|auth)/i.test(key) && Boolean(value) && value!.length >= 4)
    .map(([, value]) => value!);
}

function oauthCredentialFailure(env: NodeJS.ProcessEnv): string | undefined {
  if (env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN) return "non_oauth_credentials_present";
  if (!env.CLAUDE_CODE_OAUTH_TOKEN) return "oauth_token_missing";
  if (ALTERNATE_PROVIDER_ENV_VARS.some((key) => env[key])) return "alternate_provider_route_present";
  return undefined;
}

function privacyReason(output: string, privateRoots: string[], secrets: string[], home: string): string | undefined {
  if (secrets.some((secret) => output.includes(secret))) return "credential";
  if (privateRoots.some((root) => output.includes(root))) return "private_root";
  if (home && output.includes(home)) return "home_path";
  if (/\b[^\s@/:]+@[^\s/:]+:\//.test(output)) return "identity_path";
  if (/\b(?:sk-ant-[A-Za-z0-9_-]+|sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]+|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{20,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]+)\b/.test(output)) return "token_pattern";
  return undefined;
}

function sdkVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../node_modules/@anthropic-ai/claude-agent-sdk/package.json", import.meta.url), "utf8")) as UnknownRecord;
    return typeof pkg.version === "string" && /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(pkg.version) ? pkg.version : "unknown";
  } catch {
    return "unknown";
  }
}

function safeRuntime() {
  return { platform: process.platform, node: process.version, sdk: sdkVersion() };
}

function safeConfiguration(cases: readonly CaseSpec[]) {
  const configurations = [...new Map(cases.map((spec) => {
    const tools = spec.tools ?? { type: "preset", preset: "claude_code" as const };
    const value = Array.isArray(tools) ? { type: "explicit", names: [...tools].sort() } : tools;
    return [JSON.stringify(value), value] as const;
  })).values()];
  return { modelAlias: MODEL_ALIAS, effort: "xhigh", permissionMode: "auto", settingSources: [], tools: configurations.length === 1 ? configurations[0] : { type: "mixed", configurations }, maxTurns: MAX_TURNS, caseTimeoutMs: CASE_TIMEOUT_MS };
}

function emitJson(report: UnknownRecord, privateRoots: string[] = [], secrets: string[] = credentialValues(process.env)): boolean {
  const serialized = JSON.stringify(report);
  if (privacyReason(serialized, privateRoots, secrets, homedir())) {
    const fallback = JSON.stringify({ probeVersion: PROBE_VERSION, corpusRevision: CORPUS_REVISION, status: "failed", error: "privacy_guard" });
    if (privacyReason(fallback, [], [], "")) throw new Error("privacy guard fallback failed");
    process.stdout.write(`${fallback}\n`);
    process.exitCode = 1;
    return false;
  }
  process.stdout.write(`${serialized}\n`);
  return true;
}

function safeFailureReport(expectedRuns: number, cases: readonly CaseSpec[], failures: Failure[], outcomes: RunOutcome[]): UnknownRecord {
  const kinds = new Map<string, number>();
  const failedRuns = new Set<string>();
  const successfulOutcomes = outcomes.filter((outcome) => outcome.failures.length === 0);
  const successfulCalls = successfulOutcomes.flatMap((outcome) => outcome.calls);
  for (const failure of failures) {
    bump(kinds, failure.kind);
    failedRuns.add(`${failure.caseId}\u0000${failure.repetition}`);
  }
  return {
    probeVersion: PROBE_VERSION,
    corpusRevision: CORPUS_REVISION,
    configuration: safeConfiguration(cases),
    runtime: safeRuntime(),
    corpusCaseIds: cases.map((spec) => spec.id),
    status: "failed",
    completion: { expectedRuns, completedRuns: expectedRuns - failedRuns.size, failedRuns: failedRuns.size },
    failures: failures.sort((a, b) => a.caseId.localeCompare(b.caseId) || a.repetition - b.repetition || a.stage.localeCompare(b.stage) || a.kind.localeCompare(b.kind)),
    failureKinds: sortedCounts(kinds),
    partialAggregate: successfulOutcomes.length ? { ...summarizeCalls(successfulCalls), resultFrames: summarizeResultFrames(successfulOutcomes), toolUseResultChannel: summarizeStructuredResultChannel(successfulOutcomes) } : undefined,
  };
}

function parseArgs(args: string[]): { repetitions: number; caseId?: string; selfTest: boolean } | undefined {
  let repetitions = DEFAULT_REPETITIONS;
  let caseId: string | undefined;
  let selfTest = false;
  for (const arg of args) {
    if (arg === "--self-test") {
      selfTest = true;
      continue;
    }
    if (arg.startsWith("--repetitions=")) {
      const value = arg.slice("--repetitions=".length);
      if (!/^[1-9]\d*$/.test(value)) return undefined;
      repetitions = Number(value);
      if (!Number.isSafeInteger(repetitions)) return undefined;
      continue;
    }
    if (arg.startsWith("--case=")) {
      const value = arg.slice("--case=".length);
      if (!ALL_CASES.some((spec) => spec.id === value)) return undefined;
      caseId = value;
      continue;
    }
    return undefined;
  }
  return selfTest && args.length !== 1 ? undefined : { repetitions, caseId, selfTest };
}

function selfTest(): void {
  assert.deepEqual(splitSimpleCommandChain('rg "a|b" src && cat "name;part" | wc -l'), ['rg "a|b" src', 'cat "name;part"', "wc -l"]);
  assert.equal(splitSimpleCommandChain("rg 'unterminated"), null);
  assert.equal(splitSimpleCommandChain('cat "$(find src -type f)"'), null);
  assert.equal(splitSimpleCommandChain('cat "`find src -type f`"'), null);
  assert.deepEqual(splitSimpleCommandChain('cat "\\$(literal)"'), ['cat "\\$(literal)"']);
  assert.deepEqual(classifyBash('rg "a|b" src && cat "name;part" | wc -l'), {
    heads: ["rg", "cat", "wc"], classifiable: true, search: true, read: true, list: false, ignored: false,
    observedSearch: true, observedRead: true, observedList: false, observedIgnored: false,
  });
  assert.deepEqual(classifyBash("echo ready && true"), {
    heads: ["echo", "true"], classifiable: true, search: false, read: false, list: false, ignored: true,
    observedSearch: false, observedRead: false, observedList: false, observedIgnored: true,
  });
  assert.deepEqual(classifyBash("cd src && FOO=1 rg marker && git status"), {
    heads: ["cd", "rg", "git"], classifiable: false, search: false, read: false, list: false, ignored: false,
    observedSearch: true, observedRead: false, observedList: false, observedIgnored: false,
  });
  assert.deepEqual(classifyBash("rg marker > hits.txt"), {
    heads: ["rg"], classifiable: true, search: true, read: false, list: false, ignored: false,
    observedSearch: true, observedRead: false, observedList: false, observedIgnored: false,
  });
  assert.deepEqual(classifyBash("unknown-command marker > hits.txt"), {
    heads: ["other"], classifiable: false, search: false, read: false, list: false, ignored: false,
    observedSearch: false, observedRead: false, observedList: false, observedIgnored: false,
  });
  assert.deepEqual(parseArgs(["--case=write-coverage"]), { repetitions: DEFAULT_REPETITIONS, caseId: "write-coverage", selfTest: false });
  assert.equal(NATURAL_CASES.some((spec) => spec.id === WRITE_COVERAGE_CASE.id), false);
  assert.deepEqual(WRITE_COVERAGE_CASE.tools, ["Write"]);
  assert.equal(casePrompt(WRITE_COVERAGE_CASE, { root: "/private", repo: "/private/repo", config: "/private/config" }).includes(`absolute path \`${join("/private/repo", "write-coverage.md")}\``), true);
  const writeRoot = mkdtempSync(join(probeTempParent(), "p94-write-selftest-")), writePath = join(writeRoot, "write-coverage.md"), writeContent = "one\ntwo\nthree";
  try {
    writeFileSync(writePath, writeContent);
    const validWriteState: PairState = {
      uses: new Map([["write-1", { name: "Write", input: { file_path: writePath, content: writeContent }, result: { type: "tool_result", tool_use_id: "write-1", content: "created" }, structuredResult: { type: "create", filePath: writePath, content: writeContent, originalFile: null, structuredPatch: [], userModified: false } }]]),
      unmatchedResults: 0, duplicateUses: 0, duplicateResults: 0, structuredResultMessages: 1, structuredResultUnmatched: 0, structuredResultAmbiguous: 0, duplicateStructuredResults: 0, unassociatedStructuredShapes: [], userMessageRoutes: new Map(), resultFrames: [],
    };
    assert.deepEqual(writeCoverageFailureKinds(validWriteState, writePath), []);
    validWriteState.uses.set("failed-write", { name: "Write", input: {}, result: { type: "tool_result", is_error: true } });
    assert.deepEqual(writeCoverageFailureKinds(validWriteState, writePath), ["expected_exactly_one_write_call"]);
    validWriteState.uses.delete("failed-write");
    const writeUse = validWriteState.uses.get("write-1")!;
    writeUse.input = { file_path: join(writeRoot, "wrong.md"), content: writeContent };
    assert.equal(writeCoverageFailureKinds(validWriteState, writePath).includes("invalid_write_input"), true);
    writeUse.input = { file_path: writePath, content: writeContent }; writeFileSync(writePath, "changed");
    assert.equal(writeCoverageFailureKinds(validWriteState, writePath).includes("written_file_mismatch"), true);
    writeFileSync(writePath, writeContent); writeUse.structuredResult = { type: "create", filePath: writePath, content: "wrong", originalFile: null, structuredPatch: [], userModified: false };
    assert.equal(writeCoverageFailureKinds(validWriteState, writePath).includes("invalid_write_sidecar"), true);
    for (const structuredResult of [
      { type: "update", filePath: writePath, content: writeContent, originalFile: null, structuredPatch: [], userModified: false },
      { type: "create", filePath: writePath, content: writeContent, originalFile: null, structuredPatch: [], userModified: true },
      { type: "create", filePath: writePath, content: writeContent, originalFile: null, structuredPatch: [{ oldStart: 1 }], userModified: false },
    ]) {
      writeUse.structuredResult = structuredResult;
      assert.equal(writeCoverageFailureKinds(validWriteState, writePath).includes("invalid_write_sidecar"), true);
    }
  } finally {
    rmSync(writeRoot, { recursive: true, force: true });
  }

  const structural = summarizeCalls([{
    caseId: "orientation", repetition: 1, name: "Read", input: { path: "/private/value" },
    result: { type: "tool_result", tool_use_id: "hidden", content: "one\ntwo", is_error: false },
  }]);
  assert.deepEqual(structural.perTool.Read.inputKeySignatures, { path: 1 });
  assert.equal(Object.keys(structural.perTool.Read.inputValueShapeSignatures)[0]?.includes("/private/value"), false);
  const dynamicShape = valueShape({ answers: { "Proceed with secret?": "yes" }, "/private/path": { credential: "hidden" } });
  for (const unsafe of ["answers", "Proceed with secret?", "/private/path", "credential"]) assert.equal(dynamicShape.includes(unsafe), false);
  assert.equal(dynamicShape.includes("<dynamic-key>"), true);
  assert.equal(inputKeySignature({ file_path: "/private/value", "Proceed with secret?": true }), "file_path|<dynamic-keys:1>");
  assert.deepEqual(structural.perTool.Read.resultContentShapeSignatures, { "string(chars=7,newlines=1)": 1 });
  assert.deepEqual(structural.perTool.Read.resultStringChars.values, [{ value: 7, count: 1 }]);
  assert.deepEqual(stringMeasures(""), { chars: [0], lines: [0] });

  const pairState: PairState = {
    uses: new Map(), unmatchedResults: 0, duplicateUses: 0, duplicateResults: 0,
    structuredResultMessages: 0, structuredResultUnmatched: 0, structuredResultAmbiguous: 0,
    duplicateStructuredResults: 0, unassociatedStructuredShapes: [],
    userMessageRoutes: new Map(), resultFrames: [],
  };
  consumeCompletedMessage(pairState, { type: "assistant", message: { content: [{ type: "tool_use", id: "toolu-1", name: "Read", input: { path: "x" } }] } });
  consumeCompletedMessage(pairState, { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "toolu-1", content: "body" }] }, tool_use_result: { file: { content: "body", lineCount: 1 } } });
  assert.equal(pairState.uses.get("toolu-1")?.result?.content, "body");
  assert.deepEqual(pairState.uses.get("toolu-1")?.structuredResult, { file: { content: "body", lineCount: 1 } });
  assert.equal(pairState.structuredResultMessages, 1);
  assert.equal(pairState.unmatchedResults, 0);

  const malformedPairState: PairState = {
    uses: new Map(), unmatchedResults: 0, duplicateUses: 0, duplicateResults: 0,
    structuredResultMessages: 0, structuredResultUnmatched: 0, structuredResultAmbiguous: 0,
    duplicateStructuredResults: 0, unassociatedStructuredShapes: [],
    userMessageRoutes: new Map(), resultFrames: [],
  };
  consumeCompletedMessage(malformedPairState, { type: "assistant", message: { content: [{ type: "tool_use", id: "", name: "Read", input: {} }] } });
  consumeCompletedMessage(malformedPairState, { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "", content: "body" }] }, tool_use_result: { file: {} } });
  assert.equal(malformedPairState.uses.size, 0);
  assert.equal(malformedPairState.unmatchedResults, 1);
  assert.equal(malformedPairState.structuredResultUnmatched, 1);

  consumeCompletedMessage(malformedPairState, { type: "assistant", message: { content: [{ type: "tool_use", id: "toolu-2", name: "Read", input: {} }] } });
  consumeCompletedMessage(malformedPairState, { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "toolu-2", content: "body" }, { type: "tool_result", content: "malformed" }] }, tool_use_result: { file: {} } });
  assert.equal(malformedPairState.uses.get("toolu-2")?.structuredResult, undefined);
  assert.equal(malformedPairState.structuredResultAmbiguous, 1);
  assert.equal(malformedPairState.unmatchedResults, 2);

  consumeCompletedMessage(pairState, { type: "user", uuid: "synthetic-turn", isSynthetic: true, shouldQuery: true, origin: { kind: "task-notification" }, message: { content: [] } });
  consumeCompletedMessage(pairState, { type: "result", subtype: "success", is_error: false, user_message_uuid: "synthetic-turn", origin: { kind: "task-notification" }, result: "done" });
  pairState.userMessageRoutes.set("human-turn", { origin: "human", synthetic: false, shouldQuery: true });
  consumeCompletedMessage(pairState, { type: "user", uuid: "human-turn", isSynthetic: false, shouldQuery: true, message: { content: [] } });
  assert.deepEqual(pairState.userMessageRoutes.get("human-turn"), { origin: "human", synthetic: false, shouldQuery: true });
  consumeCompletedMessage(pairState, { type: "result", subtype: "success", is_error: false, user_message_uuid: "human-turn", origin: { kind: "human" }, result: "done" });
  assert.deepEqual(pairState.resultFrames.map((frame) => frame.provenance), [
    { origin: "task-notification", originSubkind: "none", userMessageUuid: "present", userMessageAssociation: "matched-synthetic", isOriginatingUserTurn: false },
    { origin: "human", originSubkind: "none", userMessageUuid: "present", userMessageAssociation: "matched-query", isOriginatingUserTurn: true },
  ]);
  consumeCompletedMessage(pairState, { type: "result", subtype: "success", is_error: false, user_message_uuid: "unseen-turn", origin: { kind: "human" }, result: "done" });
  assert.deepEqual(pairState.resultFrames.at(-1)?.provenance, {
    origin: "human", originSubkind: "none", userMessageUuid: "present", userMessageAssociation: "unseen", isOriginatingUserTurn: false,
  });
  consumeCompletedMessage(pairState, { type: "user", uuid: "peer-turn", isSynthetic: false, shouldQuery: true, origin: { kind: "peer" }, message: { content: [] } });
  consumeCompletedMessage(pairState, { type: "result", subtype: "success", is_error: false, user_message_uuid: "peer-turn", result: "done" });
  assert.deepEqual(pairState.resultFrames.at(-1)?.provenance, {
    origin: "absent", originSubkind: "none", userMessageUuid: "present", userMessageAssociation: "matched-non-human", isOriginatingUserTurn: false,
  });
  consumeCompletedMessage(pairState, { type: "user", uuid: "unattributed-turn", isSynthetic: false, shouldQuery: true, message: { content: [] } });
  consumeCompletedMessage(pairState, { type: "result", subtype: "success", is_error: false, user_message_uuid: "unattributed-turn", origin: { kind: "human" }, result: "done" });
  assert.deepEqual(pairState.resultFrames.at(-1)?.provenance, {
    origin: "human", originSubkind: "none", userMessageUuid: "present", userMessageAssociation: "matched-non-human", isOriginatingUserTurn: false,
  });

  assert.equal(unhealthyResultText("API Error: 502 unknown provider for model"), true);
  for (const text of ["No tests are disabled.", "The fixture needs no API key.", "Billing is out of scope.", "completed normally"]) assert.equal(unhealthyResultText(text), false);
  assert.equal(resultSubtypeFailure("error_max_turns"), "error_max_turns");
  assert.equal(resultSubtypeFailure("custom"), "non_success_result");
  const resultSummary = summarizeResultFrames([{
    calls: [], failures: [], structuredResult: { messages: 0, unmatched: 0, ambiguous: 0, duplicates: 0, unassociatedShapes: [] },
    resultFrames: [
      { subtype: "success", isError: false, unhealthyText: false, provenance: { origin: "human", originSubkind: "none", userMessageUuid: "present", userMessageAssociation: "matched-query", isOriginatingUserTurn: true } },
      { subtype: "success", isError: false, unhealthyText: false, provenance: { origin: "task-notification", originSubkind: "scheduled-trigger", userMessageUuid: "missing", userMessageAssociation: "missing", isOriginatingUserTurn: false } },
    ],
  }]);
  assert.deepEqual(resultSummary.perRun, {
    total: { count: 1, min: 2, max: 2, values: [{ value: 2, count: 1 }] },
    originatingUserTurn: { count: 1, min: 1, max: 1, values: [{ value: 1, count: 1 }] },
  });
  assert.equal(resultSummary.originatingUserTurn.count, 1);
  assert.equal(resultSummary.nonOriginating.count, 1);
  assert.deepEqual(resultSummary.provenance, {
    origins: { human: 1, "task-notification": 1 },
    originSubkinds: { none: 1, "scheduled-trigger": 1 },
    userMessageUuid: { missing: 1, present: 1 },
    userMessageAssociation: { "matched-query": 1, missing: 1 },
  });

  assert.equal(sdkVersion(), EXPECTED_SDK_VERSION);
  assert.equal(oauthCredentialFailure({ CLAUDE_CODE_OAUTH_TOKEN: "oauth" }), undefined);
  assert.equal(oauthCredentialFailure({}), "oauth_token_missing");
  assert.equal(oauthCredentialFailure({ CLAUDE_CODE_OAUTH_TOKEN: "oauth", ANTHROPIC_API_KEY: "api" }), "non_oauth_credentials_present");
  assert.equal(oauthCredentialFailure({ CLAUDE_CODE_OAUTH_TOKEN: "oauth", ANTHROPIC_AUTH_TOKEN: "auth" }), "non_oauth_credentials_present");
  for (const key of ALTERNATE_PROVIDER_ENV_VARS) {
    assert.equal(oauthCredentialFailure({ CLAUDE_CODE_OAUTH_TOKEN: "oauth", [key]: "enabled" }), "alternate_provider_route_present");
  }

  const fixture = createFixture();
  try {
    execFileSync(process.execPath, ["--test", "test/parser.test.mjs", "test/header-normalizer.test.mjs"], { cwd: fixture.repo, stdio: "ignore", timeout: FIXTURE_COMMAND_TIMEOUT_MS });
    assert.equal(execFileSync("git", ["status", "--porcelain"], { cwd: fixture.repo, encoding: "utf8", timeout: FIXTURE_COMMAND_TIMEOUT_MS }), "");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }

  const policy = { roots: ["/tmp/private-root"], secrets: ["secret-value"], home: "/Users/example" };
  assert.equal(privacyReason(JSON.stringify({ status: "ok" }), policy.roots, policy.secrets, policy.home), undefined);
  for (const unsafe of ["secret-value", "/tmp/private-root", "/Users/example", "user@host:/work", "sk-ant-api03-private-token"]) assert.notEqual(privacyReason(unsafe, policy.roots, policy.secrets, policy.home), undefined);
  process.stdout.write("P94 SELF-TEST PASS\n");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    emitJson({ probeVersion: PROBE_VERSION, corpusRevision: CORPUS_REVISION, status: "failed", error: "invalid_arguments" }, [], []);
    process.exitCode = 1;
    return;
  }
  if (args.selfTest) {
    selfTest();
    return;
  }
  const actualSdkVersion = sdkVersion();
  if (actualSdkVersion !== EXPECTED_SDK_VERSION) {
    emitJson({ probeVersion: PROBE_VERSION, corpusRevision: CORPUS_REVISION, status: "failed", error: "sdk_version_mismatch", expectedSdkVersion: EXPECTED_SDK_VERSION, runtime: safeRuntime() }, [], []);
    process.exitCode = 1;
    return;
  }
  const credentialFailure = oauthCredentialFailure(process.env);
  if (credentialFailure) {
    emitJson({ probeVersion: PROBE_VERSION, corpusRevision: CORPUS_REVISION, status: "failed", error: credentialFailure, runtime: safeRuntime() }, [], []);
    process.exitCode = 1;
    return;
  }
  const selected = args.caseId ? ALL_CASES.filter((spec) => spec.id === args.caseId) : NATURAL_CASES;
  const privateRoots: string[] = [];
  const outcomes: RunOutcome[] = [];
  for (const spec of selected) for (let repetition = 1; repetition <= args.repetitions; repetition += 1) outcomes.push(await runCase(spec, repetition, privateRoots));
  const failures = outcomes.flatMap((outcome) => outcome.failures);
  const expectedRuns = selected.length * args.repetitions;
  if (failures.length) {
    emitJson(safeFailureReport(expectedRuns, selected, failures, outcomes), privateRoots);
    process.exitCode = 1;
    return;
  }
  const calls = outcomes.flatMap((outcome) => outcome.calls);
  const resolvedModels = [...new Set(outcomes.map((outcome) => outcome.resolvedModel).filter((model): model is string => Boolean(model)))].sort();
  const report: UnknownRecord = {
    probeVersion: PROBE_VERSION,
    corpusRevision: CORPUS_REVISION,
    configuration: safeConfiguration(selected),
    resolvedModels,
    runtime: safeRuntime(),
    corpusCaseIds: selected.map((spec) => spec.id),
    status: "completed",
    completion: { expectedRuns, completedRuns: expectedRuns, failedRuns: 0 },
    aggregate: { ...summarizeCalls(calls), resultFrames: summarizeResultFrames(outcomes), toolUseResultChannel: summarizeStructuredResultChannel(outcomes) },
  };
  if (!emitJson(report, privateRoots)) return;
}

try {
  await main();
} catch {
  emitJson({ probeVersion: PROBE_VERSION, corpusRevision: CORPUS_REVISION, status: "failed", error: "unexpected_failure" }, [], []);
  process.exitCode = 1;
}
