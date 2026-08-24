// appserver/dynamicTools.ts — M7: what a dynamic tool declaration is allowed to say.
//
// A client that declares tools at `thread/start`/`thread/resume` IS the tool runtime, so its declaration
// is the one moment the server can say no. This module is that moment, and nothing else: it holds the
// caps, the canonical-name arithmetic, the native-tool catalog, and `validateDeclarations`. It never
// touches the wire, the schema registry, or `ThreadRecord` — later tasks build on these answers.
//
// SHAPE IS NOT SEMANTICS. Task 8's zod owns the shape of a declaration (the `toolName` regex, the 2_000-
// char description bound, field presence). What is left over — the things a well-shaped declaration can
// still get wrong — lives here, and every refusal becomes a -32602 whose message names the offender.
//
// THE NAME PROBLEM, which is most of this file. A dynamic tool reaches the model as
// `mcp__<server>__<tool>`, where the server is the declared namespace (or `dyn` for bare functions). Three
// consequences follow, and each is a check below:
//
//   `__` IS THE DELIMITER. Namespace `ops` + tool `prod__run` and namespace `ops__prod` + tool `run` both
//   render `mcp__ops__prod__run`. The substring is refused in EITHER position — there is no way to tell
//   the two declarations apart downstream, so neither may exist.
//
//   NAMESPACES TAKE REAL SERVER SLOTS. They join the client's configured MCP servers and the harness's
//   injected ones in a single map, and the runtime NORMALIZES a server name before the model sees it. So a
//   collision is decided on canonical names, not declared ones: `ops.prod` already holds the slot a
//   namespace `ops_prod` wants. `canonicalServerName` mirrors the runtime's own normalization.
//
//   FUNCTION NAMES SHOULD NOT READ AS NATIVE ONES. This one is CLIENT UX, not safety: the `mcp__` prefix
//   already makes model-level collision with a native tool impossible. A tool the client calls `Read` is
//   `mcp__ops__Read` to the model and can never shadow the real `Read` — but it reads as `Read` in a
//   client's own tool list, and that is worth refusing. See `RUNTIME_ONLY_NATIVE` for what that means for
//   the catalog's completeness.
//
// THE RESULT SIDE LIVES HERE TOO (bottom of the file): `toCallResult` turns a client's answer into the MCP
// content blocks the model sees. It is here because it enforces the RESULT caps, and the caps live in one
// file — the registry that holds the parked call is `dynamicCalls.ts`.
import { jsonSchemaToZod } from "./schemaToZod.js";
import { parseDataUrl } from "./turnItems.js";
import type { CallToolResultLike, ToolCallContentItem } from "./dynamicCalls.js";

/** Total declared functions across every namespace plus the bare ones. */
export const MAX_DYNAMIC_TOOLS = 32;
/** Description length bound. Enforced by TASK 8's zod (shape); named here so the caps live in one file. */
export const MAX_TOOL_DESCRIPTION_CHARS = 2_000;
/** Per-tool `inputSchema` bounds: `Buffer.byteLength(JSON.stringify(schema), "utf8")`, containment depth,
 *  and total JSON values. Measured BEFORE conversion — see `measureSchema`.
 *
 *  THE NODE CAP IS SET TO STAY CO-BINDING WITH THE BYTE CAP. `walk` counts every JSON value, so an
 *  ordinary described property costs ~4 nodes for ~90 bytes (the property object, its `type`, its
 *  `description`, and its entry in `required`); at the plan's original 64 a fifteen-property
 *  search tool was refused at 1,449 bytes — 18% of the byte cap — which made the node count the only
 *  effective limit and put it inside the range of tools people actually write. 256 nodes is ≈5,600 bytes
 *  at that density (~63 described properties), so the byte cap goes back to being the real ceiling and the
 *  node cap keeps its actual job: refusing node-explosion schemas that stay small on the wire. */
export const MAX_SCHEMA_BYTES = 8_192;
export const MAX_SCHEMA_DEPTH = 8;
export const MAX_SCHEMA_NODES = 256;
/** Result bounds, owned by Task 3's `toCallResult`: over-cap results settle `isError` naming the cap,
 *  they never refuse the method. Named here with the rest. */
export const MAX_RESULT_ITEMS = 16;
export const MAX_RESULT_PAYLOAD_BYTES = 131_072;
/** The server name bare (namespace-less) functions are published under. */
export const RESERVED_NAMESPACE = "dyn";

/** The native tool catalog: `sdk-tools.d.ts`'s `ToolInputSchemas` interface → the name the runtime answers
 *  to. Most are the interface minus `Input`; the ones that are not were read out of the shipped 0.3.237
 *  binary (the legacy-alias table `{Task:"Agent", …, ReadMcpResource:"ReadMcpResourceTool"}` and the tool
 *  roster beside it), which is why `FileEditInput→Edit`, the three MCP-resource tools keep a `Tool`
 *  suffix, and `ProposeSkillsInput` is snake_case.
 *
 *  TWO UNION MEMBERS ARE DELIBERATELY ABSENT. `ToolOutputSchemas` is a trailing reference to a different
 *  union, not a tool. `McpInput` is `{[k: string]: unknown}` — the catch-all argument shape shared by
 *  every MCP tool, with no single runtime name to guard. 45 raw `*Input` members − `McpInput` = the 44
 *  below, and the drift test in the suite re-derives that arithmetic from the vendored `.d.ts` on every
 *  run so an SDK bump forces a mapping decision instead of silently leaving a native name unguarded. */
export const NATIVE_TOOL_MAP: Readonly<Record<string, string>> = Object.freeze({
  AgentInput: "Agent",
  BashInput: "Bash",
  TaskOutputInput: "TaskOutput",
  ExitPlanModeInput: "ExitPlanMode",
  FileEditInput: "Edit",
  FileReadInput: "Read",
  FileWriteInput: "Write",
  GlobInput: "Glob",
  GrepInput: "Grep",
  TaskStopInput: "TaskStop",
  ListMcpResourcesInput: "ListMcpResourcesTool",
  RefreshMcpToolsInput: "RefreshMcpTools",
  NotebookEditInput: "NotebookEdit",
  ReadMcpResourceDirInput: "ReadMcpResourceDirTool",
  ReadMcpResourceInput: "ReadMcpResourceTool",
  ReportFindingsInput: "ReportFindings",
  TodoWriteInput: "TodoWrite",
  WebFetchInput: "WebFetch",
  WebSearchInput: "WebSearch",
  AskUserQuestionInput: "AskUserQuestion",
  SendFeedbackInput: "SendFeedback",
  ClaudeDesignInput: "ClaudeDesign",
  ProjectsInput: "Projects",
  EnterPlanModeInput: "EnterPlanMode",
  TaskCreateInput: "TaskCreate",
  TaskGetInput: "TaskGet",
  TaskUpdateInput: "TaskUpdate",
  TaskListInput: "TaskList",
  REPLInput: "REPL",
  WorkflowInput: "Workflow",
  CronCreateInput: "CronCreate",
  CronDeleteInput: "CronDelete",
  CronListInput: "CronList",
  ScheduleWakeupInput: "ScheduleWakeup",
  RemoteTriggerInput: "RemoteTrigger",
  ShowOnboardingRolePickerInput: "ShowOnboardingRolePicker",
  ReadNotificationsInput: "ReadNotifications",
  MonitorInput: "Monitor",
  ProposeSkillsInput: "propose_skills",
  ProposeGoalInput: "ProposeGoal",
  ArtifactInput: "Artifact",
  PushNotificationInput: "PushNotification",
  EnterWorktreeInput: "EnterWorktree",
  ExitWorktreeInput: "ExitWorktree",
});

/** Native names the union does not describe, and cannot be made to describe: `ToolInputSchemas` only
 *  covers tools whose arguments were code-generated into the `.d.ts`, so a live tool with a hand-written
 *  or dynamic schema has no member there. This list is therefore BEST-EFFORT and openly incomplete, and
 *  that is acceptable BECAUSE THE GUARD IS CLIENT UX ONLY — a declared name reaches the model as
 *  `mcp__<server>__<name>`, so it can never collide with a native tool at the model level; the harm a
 *  missed name allows is a confusing entry in a client's own tool list, not a shadowed native tool. That
 *  asymmetry also sets the inclusion bar: over-listing refuses declarations for no safety gain, so a name
 *  earns its place only with direct evidence.
 *
 *  Both sources are the shipped 0.3.237 binary. First, six live tools with no union member: `Skill`,
 *  `ToolSearch`, `LSP`, `SendMessage`, `ListAgents`, `SendUserMessage` — the last two also being the
 *  canonical tools the alias keys `ListPeers` and `Brief` below resolve to, and listing a deprecated alias
 *  while omitting the live name it resolves to is backwards. Second, the runtime's own legacy-alias table
 *  — names it still resolves to a canonical tool, so they are native identities a client would plausibly
 *  reach for. */
export const RUNTIME_ONLY_NATIVE: readonly string[] = Object.freeze([
  "Skill",
  "ToolSearch",
  "LSP",
  "SendMessage",
  "ListAgents",
  "SendUserMessage",
  "Task",
  "KillShell",
  "KillBash",
  "BashOutput",
  "AgentOutput",
  "BashOutputTool",
  "AgentOutputTool",
  "ListPeers",
  "Brief",
  "ListMcpResources",
  "ReadMcpResource",
  "ReadMcpResourceDir",
]);

/** Every native name a declared function may not take. */
export const NATIVE_TOOL_NAMES: readonly string[] = Object.freeze([
  ...Object.values(NATIVE_TOOL_MAP),
  ...RUNTIME_ONLY_NATIVE,
]);

const NATIVE_TOOL_NAME_SET = new Set(NATIVE_TOOL_NAMES);

const CLAUDE_AI_SERVER_PREFIX = "claude.ai ";

/** The model-visible form of an MCP server name, mirroring the runtime's `normalizeNameForMCP` (verified
 *  at `Claude Code Src/src/services/mcp/normalization.ts` and again in the shipped binary). Collisions are
 *  judged on THIS, not on what was declared: `ops.prod` and `ops_prod` are one slot.
 *
 *  The second branch is claude.ai-only on purpose. Those server names arrive as `"claude.ai Gmail"` and
 *  would normalize to runs of underscores that fight the `__` delimiter, so the runtime collapses and
 *  trims them — but only for that prefix. Collapsing unconditionally would fabricate collisions between
 *  server names the runtime keeps distinct. */
export function canonicalServerName(name: string): string {
  let normalized = name.replace(/[^A-Za-z0-9_-]/g, "_");
  if (name.startsWith(CLAUDE_AI_SERVER_PREFIX)) normalized = normalized.replace(/_+/g, "_").replace(/^_|_$/g, "");
  return normalized;
}

export type DynamicToolFunction = {
  type: "function";
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  deferLoading?: boolean;
};
export type DynamicToolNamespace = {
  type: "namespace";
  name: string;
  description: string;
  tools: DynamicToolFunction[];
};
export type DynamicToolSpec = DynamicToolFunction | DynamicToolNamespace;

/** The MCP server names a declaration would add: one per namespace, plus `dyn` if any bare function was
 *  declared. Returned in declaration order and NOT deduped — a repeated namespace is a refusal
 *  `validateDeclarations` reports by name, and swallowing it here would hide it. */
export function overlayServerNames(specs: DynamicToolSpec[]): string[] {
  const names = specs.filter((s): s is DynamicToolNamespace => s.type === "namespace").map((s) => s.name);
  if (specs.some((s) => s.type === "function")) names.push(RESERVED_NAMESPACE);
  return names;
}

type Measurement = { bytes: number; depth: number; nodes: number };

/** Count every JSON value in the schema and the deepest containment level. Deliberately GENERIC — it walks
 *  the blob as JSON rather than as a schema, because it runs before anything has agreed the blob IS a
 *  schema. Scalars are one node at depth 0; a container is one node at `1 + max(child depth)`, so the
 *  smallest one-property schema measures depth 3 (root → `properties` → the property).
 *
 *  WHAT KEEPS THIS RECURSION SAFE IS NOT THE BYTE CAP — that is compared afterwards, in `checkFunction`.
 *  It is that `measureSchema` runs this walk INSIDE the same `try` as the `JSON.stringify`, so a
 *  pathologically deep blob overflowing either one returns `null` and the caller answers `inputSchema is
 *  not serializable`. In practice `stringify` gives way first — its recursion is the heavier of the two,
 *  measured at ~8k levels of nesting where this walk still returned — but that is a MARGIN, and a margin
 *  moves with the host's stack. The guarantee is the enclosing `try`, not the margin. Every outcome is a
 *  refusal carrying a message; nothing on this path may throw, or the method answers -32603 instead of
 *  naming the offender. */
function walk(value: unknown): { depth: number; nodes: number } {
  if (typeof value !== "object" || value === null) return { depth: 0, nodes: 1 };
  let depth = 0;
  let nodes = 1;
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    const measured = walk(child);
    if (measured.depth > depth) depth = measured.depth;
    nodes += measured.nodes;
  }
  return { depth: depth + 1, nodes };
}

/** `null` when the schema cannot even be serialized — the one non-measurable input, reported as its own
 *  refusal rather than crashing the walk. */
function measureSchema(schema: Record<string, unknown>): Measurement | null {
  try {
    const serialized = JSON.stringify(schema);
    // `undefined` when the blob serializes to nothing (a lone `undefined`, a function) — not a string, and
    // nothing downstream can measure it.
    if (typeof serialized !== "string") return null;
    const { depth, nodes } = walk(schema);
    return { bytes: Buffer.byteLength(serialized, "utf8"), depth, nodes };
  } catch {
    return null;
  }
}

export type ValidationResult = { ok: true } | { ok: false; message: string };

const refuse = (message: string): ValidationResult => ({ ok: false, message });
const DELIMITER_NOTE = 'may not contain "__" (the MCP tool-name delimiter)';

/** One declared function, checked in the order a client can most usefully read: what it is called, then
 *  what it costs, then whether it converts. The caps come BEFORE `jsonSchemaToZod` on purpose — the
 *  converter carries its own `items` recursion limit and would otherwise answer a deep declaration with
 *  `items: too deeply nested`, an internal detail, instead of the declaration cap the client can act on. */
function checkFunction(tool: DynamicToolFunction, namespace: string, seen: Set<string>): ValidationResult {
  if (tool.name.includes("__")) return refuse(`tool "${tool.name}" ${DELIMITER_NOTE}`);
  if (NATIVE_TOOL_NAME_SET.has(tool.name)) return refuse(`tool "${tool.name}" is the name of a native tool`);
  if (seen.has(tool.name)) return refuse(`duplicate tool "${tool.name}" in namespace "${namespace}"`);
  seen.add(tool.name);

  const measured = measureSchema(tool.inputSchema);
  if (measured === null) return refuse(`tool "${tool.name}": inputSchema is not serializable`);
  if (measured.bytes > MAX_SCHEMA_BYTES) {
    return refuse(`tool "${tool.name}": inputSchema is ${measured.bytes} bytes (max ${MAX_SCHEMA_BYTES})`);
  }
  if (measured.depth > MAX_SCHEMA_DEPTH) {
    return refuse(`tool "${tool.name}": inputSchema is ${measured.depth} levels deep (max ${MAX_SCHEMA_DEPTH})`);
  }
  if (measured.nodes > MAX_SCHEMA_NODES) {
    return refuse(`tool "${tool.name}": inputSchema has ${measured.nodes} nodes (max ${MAX_SCHEMA_NODES})`);
  }

  const converted = jsonSchemaToZod(tool.inputSchema);
  if (!converted.ok) return refuse(`tool "${tool.name}": unsupported inputSchema: ${converted.keyword}`);

  // THE ADVERTISEMENT CONSTRAINTS, and they come LAST because they are not about conversion at all — the
  // converter is a deliberately permissive subset and accepts both of these. What refuses them is a real
  // MCP client reading the schema we advertise VERBATIM, which is a fact about the wire, not about zod.
  //
  //   MCP's own `ToolSchema` pins `inputSchema.type` to the literal "object", so a declaration that omits
  //   it makes a strict client reject the ENTIRE `tools/list` response — every well-formed sibling in that
  //   namespace vanishes from the model's view while this server goes on serving all of them. (A root that
  //   names a DIFFERENT type never reaches this line: the converter already refused it, more specifically.)
  if (tool.inputSchema.type !== "object") return refuse(`tool "${tool.name}": inputSchema must declare root type "object"`);
  //   And a property named `__proto__` advertises a self-contradiction: a client's own `tools/list` parse
  //   rebuilds `properties` through zod, which cannot carry that key, while `required` goes on naming it —
  //   so the tool can never be called, and the argument-side parse strips it too. `hasOwnProperty` because
  //   that is how the key exists at all (JSON.parse makes it an own key; an object literal would not).
  const properties = tool.inputSchema.properties;
  if (typeof properties === "object" && properties !== null && Object.prototype.hasOwnProperty.call(properties, "__proto__")) {
    return refuse(`tool "${tool.name}": inputSchema declares a property named "__proto__"`);
  }
  return { ok: true };
}

/** The declaration admission gate. Returns the FIRST refusal, in a fixed order — the global cap, then
 *  namespace identity, then the server slots the declaration would take, then the functions themselves —
 *  so a client fixing one problem at a time sees the same message for the same declaration every run.
 *
 *  `occupiedServerNames` is the effective pre-overlay MCP server set (the caller's job to assemble: the
 *  configured map under `resolveOptions`' own-property replacement semantics, plus the harness's injected
 *  built-ins). It arrives RAW and is canonicalized here. */
export function validateDeclarations(specs: DynamicToolSpec[], occupiedServerNames: string[]): ValidationResult {
  const total = specs.reduce((n, spec) => n + (spec.type === "namespace" ? spec.tools.length : 1), 0);
  if (total > MAX_DYNAMIC_TOOLS) {
    return refuse(`too many dynamic tools: ${total} declared (max ${MAX_DYNAMIC_TOOLS})`);
  }

  // Uniqueness is decided on the CANONICAL name, for the same reason the occupied-slot check below is:
  // two namespaces are duplicates when they want one server slot, and `ops.a` and `ops_a` want the same
  // one. Canonicalization is the identity under Task 8's shape regex, but this check does not lean on
  // another layer's promise. The refusal names the namespace AS DECLARED.
  const namespaces = new Set<string>();
  for (const spec of specs) {
    if (spec.type !== "namespace") continue;
    if (spec.name.includes("__")) return refuse(`namespace "${spec.name}" ${DELIMITER_NOTE}`);
    if (spec.name === RESERVED_NAMESPACE) {
      return refuse(`namespace "${RESERVED_NAMESPACE}" is reserved for bare tool declarations`);
    }
    const canonical = canonicalServerName(spec.name);
    if (namespaces.has(canonical)) return refuse(`duplicate namespace "${spec.name}"`);
    namespaces.add(canonical);
  }

  // Canonical on BOTH sides. The declared side is regex-constrained by Task 8's shape gate, where
  // canonicalization is the identity — applying it anyway keeps this comparison correct on its own terms
  // rather than on another layer's promise. The occupied name is reported AS DECLARED so the client can
  // find it in its own config.
  const occupied = new Map(occupiedServerNames.map((name) => [canonicalServerName(name), name]));
  for (const wanted of overlayServerNames(specs)) {
    const clash = occupied.get(canonicalServerName(wanted));
    if (clash !== undefined) return refuse(`server name "${wanted}" collides with the MCP server "${clash}"`);
  }

  // Function names are unique per SERVER, not globally: `mcp__ops__run` and `mcp__db__run` are different
  // tools, so each namespace (and `dyn`) gets its own seen-set.
  const bareSeen = new Set<string>();
  for (const spec of specs) {
    if (spec.type === "function") {
      const result = checkFunction(spec, RESERVED_NAMESPACE, bareSeen);
      if (!result.ok) return result;
      continue;
    }
    const seen = new Set<string>();
    for (const tool of spec.tools) {
      const result = checkFunction(tool, spec.name, seen);
      if (!result.ok) return result;
    }
  }

  return { ok: true };
}

// -------------------------------------------------------------------------------------------------
// THE RESULT SIDE. A client's `tool/callResult` carries wire items; the model needs MCP content blocks.
// This is that conversion, and it is the LAST place a dynamic tool call can be judged — which decides
// everything about how it fails:
//
//   IT SETTLES, IT NEVER REFUSES. An over-cap or malformed result is a bad ANSWER, not a bad REQUEST. The
//   method still returns `{}`; the model is handed an `isError` result naming what went wrong. A -32602
//   here would leave the call parked with the client believing it had answered.
//
//   IT NEVER THROWS (D-M4-9). Same reason, one step further: a throw would surface as -32603 AND leave the
//   call parked. The item shapes below are zod-validated at the wire, so nothing here is expected to fail
//   — the enclosing `try` is what makes "expected" unnecessary.

/** One converted block plus what it costs the budget. */
type BlockVerdict = { ok: true; block: Record<string, unknown>; bytes: number } | { ok: false; reason: string };

const errorResult = (note: string): CallToolResultLike => ({ content: [{ type: "text", text: note }], isError: true });

/** Wire item → MCP block. The media branches keep the DECLARED media type (`parseDataUrl`) rather than
 *  sniffing it the way the image-input resolver does: an MCP image/audio block carries a `mimeType`, and
 *  audio has no sniffer to derive one from. What is left checkable is the FAMILY, and that check is worth
 *  making here — an `inputImage` declaring `text/plain` reaches the model as an image block the API will
 *  reject, failing the whole request instead of this one tool call. */
function toBlock(item: ToolCallContentItem): BlockVerdict {
  if (item.type === "inputText") {
    return { ok: true, block: { type: "text", text: item.text }, bytes: Buffer.byteLength(item.text, "utf8") };
  }
  const [url, family, blockType] = item.type === "inputImage"
    ? [item.imageUrl, "image/", "image"]
    : [item.audioUrl, "audio/", "audio"];
  const parsed = parseDataUrl(url);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  if (!parsed.mimeType.toLowerCase().startsWith(family)) {
    return { ok: false, reason: `declared MIME type "${parsed.mimeType}" is not ${family}*` };
  }
  return {
    ok: true,
    block: { type: blockType, data: parsed.payload, mimeType: parsed.mimeType },
    // The base64 payload is charged VERBATIM — it is what travels, and it is ~4/3 of the bytes it decodes
    // to. Nothing here decodes anything: this layer never needs the bytes, only their cost.
    bytes: Buffer.byteLength(parsed.payload, "utf8") + Buffer.byteLength(parsed.mimeType, "utf8"),
  };
}

/** The client's answer, as the model will see it. `success:false` is the client's own tool error and keeps
 *  its content; every cap violation replaces the content with a note naming the cap.
 *
 *  THE BUDGET IS UTF-8 BYTES OF THE EMITTED BLOCKS — every block's `text`/`data`/`mimeType` summed. Not
 *  characters (60_000 Hangul characters are 180_000 bytes), and not the request's own size: the 256 KiB
 *  inbound frame is a separate, larger bound the peer enforces before this is ever reached. */
export function toCallResult(items: ToolCallContentItem[], success: boolean): CallToolResultLike {
  try {
    if (items.length > MAX_RESULT_ITEMS) {
      return errorResult(`tool result has ${items.length} content items (max ${MAX_RESULT_ITEMS})`);
    }
    const content: Array<Record<string, unknown>> = [];
    let bytes = 0;
    for (const [index, item] of items.entries()) {
      const verdict = toBlock(item);
      // The index, because a note naming only the reason cannot say WHICH of sixteen items to fix.
      if (!verdict.ok) return errorResult(`tool result content item ${index}: ${verdict.reason}`);
      content.push(verdict.block);
      bytes += verdict.bytes;
    }
    if (bytes > MAX_RESULT_PAYLOAD_BYTES) {
      return errorResult(`tool result is ${bytes} bytes (max ${MAX_RESULT_PAYLOAD_BYTES})`);
    }
    return { content, isError: !success };
  } catch (e) {
    return errorResult(`tool result could not be converted: ${e instanceof Error ? e.message : String(e)}`);
  }
}
