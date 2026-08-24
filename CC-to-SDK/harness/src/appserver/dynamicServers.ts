// appserver/dynamicServers.ts — M7: the declarations become MCP servers the engine can actually mount.
//
// One server per namespace, plus `dyn` for bare functions, each a FRESH `McpServer` wrapper with two
// explicit handlers installed on its low-level `server`. Nothing here is cached: the builder is called at
// EVERY engine construction (start, resume, and all three swap factories), because an MCP `Server`
// refuses a second transport — a reused instance is a thread that silently loses its tools on the first
// rewind. The entries are `McpSdkServerConfigWithInstance`, and they ride the SERVER-OWNED transient
// engine config; `record.config` never sees them.
//
// WHY THE HANDLERS ARE WRITTEN BY HAND. `createSdkMcpServer`/`registerTool` cannot advertise what the
// client declared. Controller measurement (plan rev 4): a built zod object — v3 and v4 alike — loses
// descriptions, `minimum`/`maximum`/`minLength`/`maxLength` AND `.int()` on the way into `tools/list`, and
// a raw shape keeps only descriptions. Codex parity is the declared JSON Schema arriving at the model
// UNCHANGED, so `ListTools` returns the declaration object itself and zod is confined to the one job it
// can do losslessly: saying yes or no to the model's arguments at `CallTool`.
//
// THE ORDER OF CONSTRUCTION IS LOAD-BEARING. `Server.setRequestHandler` asks
// `assertRequestHandlerCapability` first, which throws "Server does not support tools" for `tools/list`
// and `tools/call` against a server whose capabilities never mentioned them — so the capability is
// declared in the CONSTRUCTOR, before either handler is installed. The wrapper is otherwise untouched:
// `McpServer` installs its own tools handlers lazily, from `registerTool` only, so a wrapper we never
// register a tool on leaves both slots free (verified against the pinned SDK, and pinned by a row).
//
// THREE RULES GOVERN THE CALL HANDLER, and each exists because the alternative strands the model:
//
//   DISPATCH BY NAME, over a table built ONCE per server. A namespace is many tools behind one handler,
//   and each entry carries its OWN converted schema. A `Map` rather than an object literal, so a tool
//   named after something on `Object.prototype` can neither be resolved by inheritance nor collide.
//
//   A REFUSAL IS AN ERROR, NEVER A PARK. An unknown name and inadmissible arguments both answer
//   `InvalidParams` — the JSON-RPC code for exactly this — and nothing enters the registry. Parking an
//   argument object the client's own schema forbids would announce a call the client could not honour.
//
//   WHAT PARKS IS THE VALIDATED ORIGINAL, never zod's parse output. Validation is pass/fail here; the
//   parse RESULT is a rebuilt object (see schemaToZod.ts's call-seam note: a `__proto__` own key cannot
//   survive it, and v4's loose object emits declared keys before extras, so even ordinary arguments come
//   back reordered). The client declared the schema and is about to execute the call — it must receive
//   the bytes the model sent, not this layer's reconstruction of them.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from "@modelcontextprotocol/sdk/types.js";
import type { ListToolsResult } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod/v4";
import { jsonSchemaToZod } from "./schemaToZod.js";
import { RESERVED_NAMESPACE, type DynamicToolFunction, type DynamicToolSpec } from "./dynamicTools.js";
import type { CallToolResultLike } from "./dynamicCalls.js";
import type { McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";

/** What the handler hands the park seam. `signal` is the MCP request's own `extra.signal`: an engine that
 *  gives up on its tool call (a cancelled request, an interrupted turn) aborts it, and `DynamicCalls`
 *  settles the parked promise off that abort. */
export type DynamicToolCall = {
  namespace?: string;
  tool: string;
  arguments: Record<string, unknown>;
  signal?: AbortSignal;
};

/** The one seam back into the server. Task 7 binds it to `srv.parkToolCall(threadId, generation, …)` with
 *  the immutable build context — nothing here knows a thread, an epoch or a turn exists. */
export type DynamicToolPark = (call: DynamicToolCall) => Promise<CallToolResultLike>;

/** Version reported at `initialize`, matching the harness's other in-process MCP servers (`cc-context`,
 *  `cc-tasks`, …). Nothing reads it; it is a required field of MCP's `Implementation`. */
const SERVER_VERSION = "0.1.0";

/** The per-tool row of a server's dispatch table: what to advertise, and what to validate against. */
type ToolEntry = { spec: DynamicToolFunction; validate: z.ZodType };

/** MCP's `Tool.inputSchema` insists on a literal `type: "object"`; a declaration is a
 *  `Record<string, unknown>` that the conversion subset merely permits to say so. Verbatim means the cast
 *  rather than a rewrite — a declaration that omits the key is advertised exactly as written, and a strict
 *  client refuses it. That obligation belongs to the declaration shape, not to this file. */
type AdvertisedSchema = ListToolsResult["tools"][number]["inputSchema"];

function buildServer(
  name: string,
  namespace: string | undefined,
  tools: DynamicToolFunction[],
  instructions: string | undefined,
  park: DynamicToolPark,
): McpServer {
  // Built ONCE, before either handler: conversion is not per-call work, and a table the handlers close
  // over cannot be reached — let alone mutated — from outside.
  const table = new Map<string, ToolEntry>();
  for (const spec of tools) {
    const converted = jsonSchemaToZod(spec.inputSchema);
    // `validateDeclarations` already ran this exact conversion and refused the declaration on `!ok`, so
    // reaching this line means a declaration went live without passing admission. That is a broken
    // invariant, not a client error — there is no -32602 to answer with and nothing to degrade to.
    if (!converted.ok) {
      throw new Error(`dynamic tool "${spec.name}": inputSchema did not convert (${converted.keyword})`);
    }
    table.set(spec.name, { spec, validate: converted.schema });
  }

  const wrapper = new McpServer(
    { name, version: SERVER_VERSION },
    { capabilities: { tools: {} }, ...(instructions !== undefined ? { instructions } : {}) },
  );

  wrapper.server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [...table.values()].map(({ spec }) => ({
      name: spec.name,
      description: spec.description,
      inputSchema: spec.inputSchema as AdvertisedSchema,
      // Codex's polarity, not the SDK's: an omitted or `false` `deferLoading` means DIRECT exposure, and
      // only an explicit `true` hides the tool behind ToolSearch.
      _meta: { "anthropic/alwaysLoad": spec.deferLoading !== true },
    })),
  }));

  wrapper.server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
    const entry = table.get(req.params.name);
    if (entry === undefined) throw new McpError(ErrorCode.InvalidParams, `unknown tool "${req.params.name}"`);
    // `arguments` is OPTIONAL in the MCP contract, and a zero-argument call of an empty-object tool is
    // the ordinary way a model invokes one — it must park with `{}`, not be refused.
    const args = req.params.arguments ?? {};
    const verdict = entry.validate.safeParse(args);
    if (!verdict.success) {
      const first = verdict.error.issues[0];
      const where = first !== undefined && first.path.length > 0 ? `${first.path.join(".")}: ` : "";
      const why = first?.message ?? "invalid arguments";
      throw new McpError(ErrorCode.InvalidParams, `invalid arguments for "${req.params.name}": ${where}${why}`);
    }
    return await park({
      ...(namespace !== undefined ? { namespace } : {}),
      tool: req.params.name,
      arguments: args,
      signal: extra.signal,
    });
  });

  return wrapper;
}

/** Declarations → the MCP server entries one engine build mounts, keyed by server name.
 *
 *  Grouping follows `overlayServerNames`: a namespace takes its own name and its `description` becomes
 *  the server's `instructions` (the model-visible home Codex's namespace description would otherwise have
 *  no field for); every bare function lands on the reserved `dyn`, which has no declared description and
 *  therefore no instructions, and parks with NO namespace so the wire can tell the two apart.
 *
 *  Returns `Record<string, unknown>` because the config carrier it feeds is untyped by design — the
 *  values are `McpSdkServerConfigWithInstance`, and the `satisfies` below is what holds them to it. */
export function buildDynamicServers(specs: DynamicToolSpec[], park: DynamicToolPark): Record<string, unknown> {
  const servers: Record<string, unknown> = {};

  const bare = specs.filter((spec): spec is DynamicToolFunction => spec.type === "function");
  for (const spec of specs) {
    if (spec.type !== "namespace") continue;
    servers[spec.name] = {
      type: "sdk",
      name: spec.name,
      instance: buildServer(spec.name, spec.name, spec.tools, spec.description, park),
    } satisfies McpSdkServerConfigWithInstance;
  }
  if (bare.length > 0) {
    servers[RESERVED_NAMESPACE] = {
      type: "sdk",
      name: RESERVED_NAMESPACE,
      instance: buildServer(RESERVED_NAMESPACE, undefined, bare, undefined, park),
    } satisfies McpSdkServerConfigWithInstance;
  }

  return servers;
}
