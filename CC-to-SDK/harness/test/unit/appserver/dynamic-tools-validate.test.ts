// test/unit/appserver/dynamic-tools-validate.test.ts — M7 Task 2: declaration semantics.
//
// WHAT THIS FILE PINS. `validateDeclarations` is the admission gate a client's tool declarations pass
// through ONCE, at `thread/start`/`thread/resume`, before anything is built or advertised. Everything it
// refuses becomes a -32602 naming the offender, so these rows assert on the MESSAGE, not on `ok === false`
// alone — the message IS the wire contract for a client trying to fix its declaration.
//
// THE THREE THINGS BEING PROTECTED.
//
//   THE NAMESPACE. A dynamic tool reaches the model as `mcp__<server>__<tool>`, so `__` in either half
//   makes the name ambiguous: namespace `ops` + tool `prod__run` and namespace `ops__prod` + tool `run`
//   both render `mcp__ops__prod__run`. Both orientations are refused, and both are tested.
//
//   THE SERVER SLOT. Namespaces become real MCP server names in the engine's map, alongside the client's
//   own configured servers and the harness's injected ones. The runtime normalizes a server name before
//   it ever reaches the model (chars outside [A-Za-z0-9_-] to `_`, plus a collapse-and-trim branch for
//   "claude.ai " servers), so a collision has to be judged on the CANONICAL name — `ops.prod` already
//   occupies the slot a namespace `ops_prod` wants. `canonicalServerName` mirrors that normalization, and
//   these rows drive both of its branches.
//
//   THE MODEL'S ATTENTION. Caps bound what one declaration can cost: 32 functions, and per tool an input
//   schema of 8_192 UTF-8 bytes / 8 levels / 256 nodes. Every boundary row builds a fixture that measures
//   EXACTLY the cap, asserts that measurement independently of the module, and then asserts the refusal
//   one unit over — so neither a cap that drifts nor a `>` that becomes a `>=` can slip past a fixture
//   that stopped testing it. The caps run BEFORE `jsonSchemaToZod`, which carries its own (unrelated,
//   tighter-on-one-axis) `items` recursion limit — the ordering row proves a deep schema reports the
//   DECLARATION cap rather than the converter's internal one.
//
// THE DRIFT TEST. `NATIVE_TOOL_MAP` is a hand-written interface→runtime-name mapping, and the one thing
// a hand-written mapping cannot do is notice that the SDK grew a tool. The drift row re-parses the
// vendored `sdk-tools.d.ts` union on every run and demands set equality, so an SDK bump that adds a tool
// fails here and forces someone to decide what the new tool is called.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  MAX_DYNAMIC_TOOLS,
  MAX_TOOL_DESCRIPTION_CHARS,
  MAX_SCHEMA_BYTES,
  MAX_SCHEMA_DEPTH,
  MAX_SCHEMA_NODES,
  MAX_RESULT_ITEMS,
  MAX_RESULT_PAYLOAD_BYTES,
  RESERVED_NAMESPACE,
  NATIVE_TOOL_MAP,
  NATIVE_TOOL_NAMES,
  RUNTIME_ONLY_NATIVE,
  canonicalServerName,
  overlayServerNames,
  validateDeclarations,
  type DynamicToolFunction,
  type DynamicToolSpec,
} from "../../../src/appserver/dynamicTools.js";

const harnessRoot = fileURLToPath(new URL("../../../", import.meta.url));

/** The smallest schema that converts: one optional string argument. */
const TRIVIAL_SCHEMA = { type: "object", properties: { a: { type: "string" } } } as const;

function fn(name: string, inputSchema: Record<string, unknown> = { ...TRIVIAL_SCHEMA }): DynamicToolFunction {
  return { type: "function", name, description: `the ${name} tool`, inputSchema };
}

function ns(name: string, ...tools: DynamicToolFunction[]): DynamicToolSpec {
  return { type: "namespace", name, description: `the ${name} namespace`, tools };
}

/** Validate and require refusal, handing back the message to assert on. */
function refusal(specs: DynamicToolSpec[], occupied: string[] = []): string {
  const result = validateDeclarations(specs, occupied);
  if (result.ok) throw new Error("expected the declaration to be refused, but it was accepted");
  return result.message;
}

/** Validate and require acceptance — the refusal message rides the failure so a broken row reads. */
function accepted(specs: DynamicToolSpec[], occupied: string[] = []): void {
  const result = validateDeclarations(specs, occupied);
  if (!result.ok) throw new Error(`expected the declaration to be accepted; refused with: ${result.message}`);
}

/** A schema whose SERIALIZED form is exactly `target` UTF-8 bytes — padded with single-byte characters
 *  inside a `description`, which the converter accepts and which adds no depth and one node. */
function schemaOfBytes(target: number): Record<string, unknown> {
  const build = (pad: string) => ({ type: "object", properties: { a: { type: "string", description: pad } } });
  const base = Buffer.byteLength(JSON.stringify(build("")), "utf8");
  return build("x".repeat(target - base));
}

/** A schema nested `wraps` levels of `items` deep. Measured depth is `3 + wraps` (root → `properties` →
 *  the property schema, then one per `items`). */
function schemaOfItemsDepth(wraps: number): Record<string, unknown> {
  let field: Record<string, unknown> = { type: "string" };
  for (let i = 0; i < wraps; i++) field = { type: "array", items: field };
  return { type: "object", properties: { a: field } };
}

/** The module's node definition, re-derived here: every JSON value counts once, containers included. The
 *  boundary rows assert against THIS rather than against the fixture builder's arithmetic, the same way
 *  the byte row asserts `Buffer.byteLength` — a fixture that silently stops sitting on the cap is exactly
 *  how a boundary row goes quiet. */
function countNodes(value: unknown): number {
  if (typeof value !== "object" || value === null) return 1;
  const children = Array.isArray(value) ? value : Object.values(value);
  return children.reduce<number>((n, child) => n + countNodes(child), 1);
}

/** A flat schema measuring EXACTLY `target` nodes. The empty base is 3 (root, its `type` string, the
 *  `properties` object) and each string property adds 2 (its schema object and that object's `type`
 *  string), so the family is odd; `additionalProperties: false` is the single scalar that buys the even
 *  ones. Without it no fixture could land on an even cap — which is how the original 64 ended up with no
 *  at-the-boundary accept at all. */
function schemaOfNodes(target: number): Record<string, unknown> {
  const needsScalar = (target - 3) % 2 === 1;
  const count = (target - 3 - (needsScalar ? 1 : 0)) / 2;
  const properties: Record<string, unknown> = {};
  for (let i = 0; i < count; i++) properties[`p${i}`] = { type: "string" };
  const schema: Record<string, unknown> = { type: "object", properties };
  if (needsScalar) schema.additionalProperties = false;
  return schema;
}

describe("caps are named once", () => {
  it("exports the plan's cap values", () => {
    expect(MAX_DYNAMIC_TOOLS).toBe(32);
    expect(MAX_TOOL_DESCRIPTION_CHARS).toBe(2_000);
    expect(MAX_SCHEMA_BYTES).toBe(8_192);
    expect(MAX_SCHEMA_DEPTH).toBe(8);
    expect(MAX_SCHEMA_NODES).toBe(256);
    expect(MAX_RESULT_ITEMS).toBe(16);
    expect(MAX_RESULT_PAYLOAD_BYTES).toBe(131_072);
    expect(RESERVED_NAMESPACE).toBe("dyn");
  });
});

describe("the native tool catalog", () => {
  // The drift gate. Re-parsing the vendored union on every run is the only way a hand-written mapping
  // learns that the SDK grew a tool: an added member fails set equality here and forces a naming decision
  // rather than silently leaving a native name unguarded.
  it("covers exactly the ToolInputSchemas union, less ToolOutputSchemas and the generic McpInput", () => {
    const dts = join(harnessRoot, "node_modules", "@anthropic-ai", "claude-agent-sdk", "sdk-tools.d.ts");
    const block = /export type ToolInputSchemas =([\s\S]*?);/.exec(readFileSync(dts, "utf8"));
    expect(block).not.toBeNull();
    const members = block![1]!
      .split("|")
      .map((m) => m.trim())
      .filter((m) => m.length > 0);

    // 45 raw `*Input` members plus the trailing `ToolOutputSchemas` reference, at SDK 0.3.237.
    expect(members).toHaveLength(46);
    expect(members.at(-1)).toBe("ToolOutputSchemas");
    const raw = members.filter((m) => m.endsWith("Input"));
    expect(raw).toHaveLength(45);

    // `McpInput` is `{[k: string]: unknown}` — the catch-all shape every MCP tool's arguments take, not
    // one tool with one runtime name. There is nothing to guard, so it is excluded from the mapping.
    expect(raw).toContain("McpInput");
    const mapped = raw.filter((m) => m !== "McpInput");
    expect(mapped).toHaveLength(44);
    expect(new Set(Object.keys(NATIVE_TOOL_MAP))).toEqual(new Set(mapped));
  });

  // Set equality above guards the KEYS only. These seven values are the ones stripping `Input` gets wrong
  // — precisely the ones a future editor would "correct" into wrongness — so they are pinned here rather
  // than living only in a report. All seven were read out of the shipped 0.3.237 binary: the file trio
  // from its legacy-alias table, the three MCP-resource tools from the same table with their `Tool`
  // suffixes (the bare `ReadMcpResource`/`ListMcpResources` appear there only as alias KEYS, while the
  // `…Tool` names appear in the live tool roster), and `propose_skills` from that roster too.
  it("pins the seven mappings that are not the obvious Input-strip", () => {
    expect(NATIVE_TOOL_MAP.FileEditInput).toBe("Edit");
    expect(NATIVE_TOOL_MAP.FileReadInput).toBe("Read");
    expect(NATIVE_TOOL_MAP.FileWriteInput).toBe("Write");
    expect(NATIVE_TOOL_MAP.ListMcpResourcesInput).toBe("ListMcpResourcesTool");
    expect(NATIVE_TOOL_MAP.ReadMcpResourceInput).toBe("ReadMcpResourceTool");
    expect(NATIVE_TOOL_MAP.ReadMcpResourceDirInput).toBe("ReadMcpResourceDirTool");
    expect(NATIVE_TOOL_MAP.ProposeSkillsInput).toBe("propose_skills");
  });

  it("appends the runtime-only natives to the mapped names", () => {
    expect(RUNTIME_ONLY_NATIVE).toEqual(expect.arrayContaining(["Skill", "ToolSearch", "LSP", "SendMessage"]));
    // The canonical tools the deprecated alias keys `ListPeers` and `Brief` resolve to; both are in the
    // binary's live roster. Guarding the alias but not its target would be backwards.
    expect(RUNTIME_ONLY_NATIVE).toEqual(expect.arrayContaining(["ListAgents", "SendUserMessage"]));
    expect(NATIVE_TOOL_NAMES).toEqual([...Object.values(NATIVE_TOOL_MAP), ...RUNTIME_ONLY_NATIVE]);
    expect(new Set(NATIVE_TOOL_NAMES).size).toBe(NATIVE_TOOL_NAMES.length);
  });
});

describe("canonicalServerName mirrors the runtime's normalizeNameForMCP", () => {
  it("replaces every character outside [A-Za-z0-9_-]", () => {
    expect(canonicalServerName("ops.prod")).toBe("ops_prod");
    expect(canonicalServerName("my server")).toBe("my_server");
    expect(canonicalServerName("cc-context")).toBe("cc-context");
    expect(canonicalServerName("keep_it")).toBe("keep_it");
  });

  it("collapses and trims underscores only for claude.ai servers", () => {
    expect(canonicalServerName("claude.ai  ops")).toBe("claude_ai_ops");
    expect(canonicalServerName("claude.ai Gmail")).toBe("claude_ai_Gmail");
    // The same character soup WITHOUT the prefix keeps its doubled and edge underscores — the collapse is
    // a claude.ai-only branch, and a canonicaliser that always collapsed would fabricate collisions.
    expect(canonicalServerName("other.ai  ops")).toBe("other_ai__ops");
    expect(canonicalServerName(" ops ")).toBe("_ops_");
  });
});

describe("overlayServerNames", () => {
  it("lists the namespaces and adds dyn only when a bare function is declared", () => {
    expect(overlayServerNames([ns("ops", fn("run")), ns("db", fn("query"))])).toEqual(["ops", "db"]);
    expect(overlayServerNames([fn("run")])).toEqual(["dyn"]);
    expect(overlayServerNames([ns("ops", fn("run")), fn("bare")])).toEqual(["ops", "dyn"]);
    expect(overlayServerNames([])).toEqual([]);
  });
});

describe("validateDeclarations — the function-count cap", () => {
  it("refuses 33 functions naming the cap", () => {
    const specs = Array.from({ length: 33 }, (_, i) => fn(`t${i}`));
    expect(refusal(specs)).toBe("too many dynamic tools: 33 declared (max 32)");
  });

  it("accepts 32 functions split across namespaces", () => {
    const first = Array.from({ length: 16 }, (_, i) => fn(`a${i}`));
    const second = Array.from({ length: 16 }, (_, i) => fn(`b${i}`));
    accepted([ns("one", ...first), ns("two", ...second)]);
  });
});

describe("validateDeclarations — the per-tool schema caps", () => {
  it("accepts a schema of exactly MAX_SCHEMA_BYTES and refuses one byte more", () => {
    const atCap = schemaOfBytes(MAX_SCHEMA_BYTES);
    expect(Buffer.byteLength(JSON.stringify(atCap), "utf8")).toBe(8_192);
    accepted([fn("fits", atCap)]);

    const overCap = schemaOfBytes(MAX_SCHEMA_BYTES + 1);
    expect(Buffer.byteLength(JSON.stringify(overCap), "utf8")).toBe(8_193);
    expect(refusal([fn("big", overCap)])).toBe('tool "big": inputSchema is 8193 bytes (max 8192)');
  });

  it("accepts depth 8 and refuses depth 9", () => {
    accepted([fn("shallow", schemaOfItemsDepth(5))]);
    expect(refusal([fn("deep", schemaOfItemsDepth(6))])).toBe('tool "deep": inputSchema is 9 levels deep (max 8)');
  });

  // ORDERING (Task 1 review ⚠️). `jsonSchemaToZod` refuses an `items` chain deeper than 8 with its own
  // `items: too deeply nested`. A declaration deep enough to trip both must report the DECLARATION cap,
  // which only happens if the caps are measured before conversion is attempted.
  it("reports the declaration depth cap, not the converter's items limit, on a doubly-deep schema", () => {
    const message = refusal([fn("verydeep", schemaOfItemsDepth(9))]);
    expect(message).toBe('tool "verydeep": inputSchema is 12 levels deep (max 8)');
    expect(message).not.toContain("too deeply nested");
  });

  it("accepts a schema of exactly MAX_SCHEMA_NODES and refuses one node more", () => {
    const atCap = schemaOfNodes(MAX_SCHEMA_NODES);
    expect(countNodes(atCap)).toBe(256);
    // The node fixture must stay well inside the byte cap or it would be refused for the wrong reason —
    // which is the whole point of the amended 256: the two caps are now roughly co-binding, not wildly
    // apart, and 256 nodes of ordinary described properties is still only a few thousand bytes.
    expect(Buffer.byteLength(JSON.stringify(atCap), "utf8")).toBeLessThan(MAX_SCHEMA_BYTES);
    accepted([fn("narrow", atCap)]);

    const overCap = schemaOfNodes(MAX_SCHEMA_NODES + 1);
    expect(countNodes(overCap)).toBe(257);
    expect(refusal([fn("wide", overCap)])).toBe('tool "wide": inputSchema has 257 nodes (max 256)');
  });

  // A fifteen-property described tool is an ordinary declaration, and under the original cap of 64 it was
  // refused at 1,449 bytes — 18% of the byte cap. This row is the one that fails if the node cap is ever
  // tightened back down to where it refuses tools people actually write.
  it("accepts a fifteen-property described tool", () => {
    const properties: Record<string, unknown> = {};
    for (let i = 0; i < 15; i++) {
      properties[`field${i}`] = { type: "string", description: `what field ${i} is for` };
    }
    const schema = { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
    accepted([fn("form", schema)]);
  });

  // NOTHING IN THE MEASURE MAY THROW — a throw is a -32603 for a declaration the client could have fixed.
  // What protects the recursive walk is not the byte cap (that is compared afterwards) but the
  // `JSON.stringify` ahead of it: measured on this host, `stringify` gives way at ~8k levels while the
  // walk survives past 8k, so the walk is never handed a tree it cannot descend and the `catch` answers
  // `not serializable` instead. The row pins the outcome, not which refusal — the crossover depth moves
  // with the host's stack, and both messages are equally correct answers.
  it("answers a pathologically deep schema with a refusal, never a throw", () => {
    const message = refusal([fn("abyss", schemaOfItemsDepth(20_000))]);
    expect(message.startsWith('tool "abyss": inputSchema is')).toBe(true);
  });

  it("names the converter's keyword and the tool when the schema is outside the subset", () => {
    const message = refusal([fn("choosy", { oneOf: [{ type: "object" }] })]);
    expect(message).toBe('tool "choosy": unsupported inputSchema: oneOf');
  });

  it("refuses a required array that repeats a property, naming the property", () => {
    // The advertisement harm the converter's own rule catches: draft-07 pins `required` to unique items,
    // the declared schema is advertised VERBATIM, and ajv refuses the DOCUMENT rather than the keyword
    // (measured: "schema is invalid: data/required must NOT have duplicate items", strict and non-strict
    // alike). So the thread would start, the namespace would advertise, and every tool in it would vanish
    // from a standards-validating client's view. This refusal lands at declaration instead.
    const schema = { type: "object", properties: { a: { type: "string" } }, required: ["a", "a"] };
    expect(refusal([fn("dup", schema)])).toBe('tool "dup": unsupported inputSchema: required:a duplicated');
    // The same names, declared once each, are an ordinary tool.
    accepted([fn("fine", { type: "object", properties: { a: { type: "string" } }, required: ["a"] })]);
  });
});

// THE ADVERTISEMENT CONSTRAINTS (T6 discoveries). Both are things the CONVERTER happily accepts and a real
// MCP client then refuses — measured against a live client over an in-memory transport, not reasoned about
// — so they are declaration-time refusals rather than conversion ones, and they are checked LAST, after the
// converter has had its say, so a schema that is outside the subset still hears about that first.
describe("validateDeclarations — the advertisement constraints", () => {
  it("refuses a schema without a root type:object, which would kill its whole namespace's tools/list", () => {
    // MCP's own `ToolSchema` pins `inputSchema.type` to the literal "object". The declaration is advertised
    // VERBATIM, so a strict client rejects the entire `tools/list` response — every well-formed sibling in
    // that namespace disappears from the model's view while the server goes on serving all of them.
    expect(refusal([fn("typeless", { properties: { a: { type: "string" } } })]))
      .toBe('tool "typeless": inputSchema must declare root type "object"');
    expect(refusal([fn("empty", {})])).toBe('tool "empty": inputSchema must declare root type "object"');
    // A root that names a DIFFERENT type never reaches this check — the converter has already refused it,
    // and its keyword is the more specific answer.
    expect(refusal([fn("wrongtype", { type: "string" })])).toBe('tool "wrongtype": unsupported inputSchema: type:string');
    accepted([fn("proper", { type: "object", properties: { a: { type: "string" } } })]);
  });

  it("refuses a property named __proto__, which a client's own parse drops while `required` keeps naming it", () => {
    // JSON.parse is how such a key reaches us at all — an object literal `{__proto__: …}` sets the prototype
    // instead of creating an own key, so the fixture has to travel the same road the wire does.
    const schema = JSON.parse('{"type":"object","properties":{"__proto__":{"type":"string"}},"required":["__proto__"]}');
    expect(refusal([fn("polluted", schema)])).toBe('tool "polluted": inputSchema declares a property named "__proto__"');
  });

  it("leaves an ordinary property named after something else on Object.prototype alone", () => {
    // The refusal is about the ONE key a client's zod rebuild silently drops, not about prototype names in
    // general: `constructor` and `toString` survive that rebuild and are perfectly callable tool arguments.
    accepted([fn("ordinary", { type: "object", properties: { constructor: { type: "string" }, toString: { type: "string" } } })]);
  });
});

describe("validateDeclarations — namespace names", () => {
  it("refuses the reserved dyn namespace", () => {
    expect(refusal([ns("dyn", fn("run"))])).toBe('namespace "dyn" is reserved for bare tool declarations');
  });

  it("refuses a duplicate namespace", () => {
    expect(refusal([ns("ops", fn("run")), ns("ops", fn("other"))])).toBe('duplicate namespace "ops"');
  });

  // Two namespaces are duplicates when they want ONE server slot, and the slot is the canonical name.
  // Task 8's shape regex would reject the dot before this check ever ran, but the neighbouring
  // occupied-slot check declines to rely on that promise and so does this one; the message still names the
  // namespace as the client declared it.
  it("refuses two namespaces whose canonical names collide", () => {
    expect(refusal([ns("ops.a", fn("run")), ns("ops_a", fn("other"))])).toBe('duplicate namespace "ops_a"');
  });

  it("refuses __ in a namespace", () => {
    expect(refusal([ns("ops__prod", fn("run"))])).toBe(
      'namespace "ops__prod" may not contain "__" (the MCP tool-name delimiter)',
    );
  });
});

describe("validateDeclarations — server-slot collisions", () => {
  it("refuses a namespace whose canonical name is already an MCP server", () => {
    expect(refusal([ns("ops_prod", fn("run"))], ["ops.prod"])).toBe(
      'server name "ops_prod" collides with the MCP server "ops.prod"',
    );
  });

  it("refuses a namespace colliding through the claude.ai collapse-and-trim branch", () => {
    expect(refusal([ns("claude_ai_ops", fn("run"))], ["claude.ai  ops"])).toBe(
      'server name "claude_ai_ops" collides with the MCP server "claude.ai  ops"',
    );
  });

  it("refuses bare functions when dyn is already occupied", () => {
    expect(refusal([fn("run")], ["dyn"])).toBe('server name "dyn" collides with the MCP server "dyn"');
  });

  it("refuses a namespace colliding with an injected built-in server", () => {
    expect(refusal([ns("cc-context", fn("run"))], ["cc-context"])).toBe(
      'server name "cc-context" collides with the MCP server "cc-context"',
    );
  });

  it("lets namespaces through when nothing occupies their slot", () => {
    accepted([ns("ops", fn("run")), fn("bare")], ["cc-context", "claude.ai Gmail"]);
  });
});

describe("validateDeclarations — function names", () => {
  it("refuses __ in a function name", () => {
    expect(refusal([ns("ops", fn("prod__run"))])).toBe(
      'tool "prod__run" may not contain "__" (the MCP tool-name delimiter)',
    );
    expect(refusal([fn("prod__run")])).toBe('tool "prod__run" may not contain "__" (the MCP tool-name delimiter)');
  });

  it("refuses a duplicate function within one namespace and within dyn", () => {
    expect(refusal([ns("ops", fn("run"), fn("run"))])).toBe('duplicate tool "run" in namespace "ops"');
    expect(refusal([fn("run"), fn("run")])).toBe('duplicate tool "run" in namespace "dyn"');
  });

  it("allows the same function name in two different namespaces", () => {
    accepted([ns("ops", fn("run")), ns("db", fn("run")), fn("run")]);
  });

  it("refuses a function named after a native tool from the union", () => {
    expect(refusal([ns("ops", fn("TaskCreate"))])).toBe('tool "TaskCreate" is the name of a native tool');
    expect(refusal([fn("AskUserQuestion")])).toBe('tool "AskUserQuestion" is the name of a native tool');
  });

  it("refuses a function named after a runtime-only native outside the union", () => {
    expect(refusal([fn("Skill")])).toBe('tool "Skill" is the name of a native tool');
    expect(refusal([ns("ops", fn("ToolSearch"))])).toBe('tool "ToolSearch" is the name of a native tool');
  });

  it("refuses a function named after an alias target as well as the alias", () => {
    expect(refusal([fn("ListPeers")])).toBe('tool "ListPeers" is the name of a native tool');
    expect(refusal([fn("ListAgents")])).toBe('tool "ListAgents" is the name of a native tool');
    expect(refusal([ns("ops", fn("Brief"))])).toBe('tool "Brief" is the name of a native tool');
    expect(refusal([ns("ops", fn("SendUserMessage"))])).toBe('tool "SendUserMessage" is the name of a native tool');
  });
});

describe("validateDeclarations — a realistic declaration", () => {
  // Codex-shaped: one namespace of exec-ish tools plus a bare helper, the argument shapes a real client
  // sends. This is the row that fails when a cap is tightened past what the design is meant to carry.
  it("accepts a Codex-shaped declaration", () => {
    const specs: DynamicToolSpec[] = [
      ns(
        "codex",
        {
          type: "function",
          name: "exec_command",
          description: "Run a shell command in the workspace and return its combined output.",
          inputSchema: {
            type: "object",
            properties: {
              command: { type: "array", items: { type: "string" }, description: "argv, already split" },
              cwd: { type: "string", description: "absolute working directory" },
              timeout_ms: { type: "integer", minimum: 1, maximum: 600_000 },
            },
            required: ["command"],
            additionalProperties: false,
          },
        },
        {
          type: "function",
          name: "apply_patch",
          description: "Apply a unified diff to the workspace.",
          inputSchema: {
            type: "object",
            properties: { patch: { type: "string", minLength: 1 }, dry_run: { type: "boolean" } },
            required: ["patch"],
          },
          deferLoading: true,
        },
      ),
      {
        type: "function",
        name: "read_workspace_file",
        description: "Read one file from the workspace.",
        inputSchema: {
          type: "object",
          properties: { path: { type: "string" }, encoding: { type: "string", enum: ["utf8", "base64"] } },
          required: ["path"],
          additionalProperties: false,
        },
      },
    ];
    accepted(specs, ["cc-context"]);
    expect(overlayServerNames(specs)).toEqual(["codex", "dyn"]);
  });

  it("accepts an empty declaration", () => {
    accepted([]);
  });
});
