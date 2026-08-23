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
//   schema of 8_192 UTF-8 bytes / 8 levels / 64 nodes. The boundary rows measure the fixture they built
//   and assert the measured number, so a cap can never drift silently past a fixture that stopped testing
//   it. The caps run BEFORE `jsonSchemaToZod`, which carries its own (unrelated, tighter-on-one-axis)
//   `items` recursion limit — the ordering row proves a deep schema reports the DECLARATION cap rather
//   than the converter's internal one.
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

/** A flat schema with `count` string properties. Measured node count is `3 + 2 * count`. */
function schemaOfProperties(count: number): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (let i = 0; i < count; i++) properties[`p${i}`] = { type: "string" };
  return { type: "object", properties };
}

describe("caps are named once", () => {
  it("exports the plan's cap values", () => {
    expect(MAX_DYNAMIC_TOOLS).toBe(32);
    expect(MAX_TOOL_DESCRIPTION_CHARS).toBe(2_000);
    expect(MAX_SCHEMA_BYTES).toBe(8_192);
    expect(MAX_SCHEMA_DEPTH).toBe(8);
    expect(MAX_SCHEMA_NODES).toBe(64);
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

  it("pins the three renamed file tools", () => {
    expect(NATIVE_TOOL_MAP.FileEditInput).toBe("Edit");
    expect(NATIVE_TOOL_MAP.FileReadInput).toBe("Read");
    expect(NATIVE_TOOL_MAP.FileWriteInput).toBe("Write");
  });

  it("appends the runtime-only natives to the mapped names", () => {
    expect(RUNTIME_ONLY_NATIVE).toEqual(expect.arrayContaining(["Skill", "ToolSearch", "LSP", "SendMessage"]));
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

  it("accepts 63 nodes and refuses 65", () => {
    accepted([fn("narrow", schemaOfProperties(30))]);
    expect(refusal([fn("wide", schemaOfProperties(31))])).toBe('tool "wide": inputSchema has 65 nodes (max 64)');
  });

  it("names the converter's keyword and the tool when the schema is outside the subset", () => {
    const message = refusal([fn("choosy", { oneOf: [{ type: "object" }] })]);
    expect(message).toBe('tool "choosy": unsupported inputSchema: oneOf');
  });
});

describe("validateDeclarations — namespace names", () => {
  it("refuses the reserved dyn namespace", () => {
    expect(refusal([ns("dyn", fn("run"))])).toBe('namespace "dyn" is reserved for bare tool declarations');
  });

  it("refuses a duplicate namespace", () => {
    expect(refusal([ns("ops", fn("run")), ns("ops", fn("other"))])).toBe('duplicate namespace "ops"');
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
