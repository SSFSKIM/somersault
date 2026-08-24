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
// UNCHANGED, so `ListTools` returns the declaration verbatim and zod is confined to the one job it can do
// losslessly: saying yes or no to the model's arguments at `CallTool`.
//
// BOTH HALVES ARE SNAPSHOTTED AT BUILD, and that pairing is the point. The validator has always been
// built once; if the ADVERTISEMENT were a live read of the caller's spec objects, a later in-place edit
// (a normalization pass, a defaulting step, a future tool update) would move what the model is TOLD
// without moving what `CallTool` ENFORCES — advertised-versus-enforced divergence, which is the exact
// loss the verbatim design exists to prevent. So the row is snapshotted beside its validator: the
// declared schema is DEEP-COPIED and the whole advertised object DEEP-FROZEN, and `ListTools` maps over
// the frozen adverts without ever touching a caller-owned object.
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
import { MCP_NO_PREFIX_ENV } from "../config/types.js";
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

/** The per-tool row of a server's dispatch table: the frozen advertisement, and what to validate against.
 *  Both are computed at build from the SAME reading of the spec, so they cannot drift apart. */
type ToolEntry = { advert: AdvertisedTool; validate: z.ZodType };

/** MCP's `Tool.inputSchema` insists on a literal `type: "object"`; a declaration is a
 *  `Record<string, unknown>` that the conversion subset merely permits to say so. Verbatim means the cast
 *  rather than a rewrite — a declaration that omits the key is advertised exactly as written, and a strict
 *  client refuses it. That obligation belongs to the declaration shape, not to this file. */
type AdvertisedSchema = ListToolsResult["tools"][number]["inputSchema"];
type AdvertisedTool = ListToolsResult["tools"][number];

/** Freeze a value and everything reachable from it. `isFrozen` is the recursion guard as well as the
 *  early-out, so a self-referential schema terminates. Applied to a fresh deep copy only — never to
 *  anything the caller still holds. */
function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const inner of Object.values(value)) deepFreeze(inner);
  return value;
}

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
    // Same reasoning: `checkFunction`'s per-namespace seen-set already refused a repeated name, so a
    // second declaration of one here means admission was bypassed. `Map.set` would silently keep the LAST
    // — one tool of the pair advertised, the other unreachable — so the collapse is refused out loud.
    if (table.has(spec.name)) {
      throw new Error(`dynamic tool "${spec.name}": declared twice in server "${name}"`);
    }
    table.set(spec.name, {
      // The advertisement the client will see, fixed NOW. The schema is deep-copied so no later edit to
      // the caller's declaration can reach it, and the whole row is frozen so nothing downstream — a
      // client sharing our leaf objects across an in-process transport included — can rewrite it either.
      advert: deepFreeze({
        name: spec.name,
        description: spec.description,
        inputSchema: structuredClone(spec.inputSchema) as AdvertisedSchema,
        // Codex's polarity, not the SDK's: an omitted or `false` `deferLoading` means DIRECT exposure, and
        // only an explicit `true` hides the tool behind ToolSearch.
        _meta: { "anthropic/alwaysLoad": spec.deferLoading !== true },
      }),
      validate: converted.schema,
    });
  }

  const wrapper = new McpServer(
    { name, version: SERVER_VERSION },
    { capabilities: { tools: {} }, ...(instructions !== undefined ? { instructions } : {}) },
  );

  wrapper.server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [...table.values()].map(({ advert }) => advert),
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
    // THE PARK SEAM ANSWERS THE MODEL, NEVER THE TRANSPORT. Everything above this line refuses on
    // purpose and says so as an MCP error the model can read; a park that REJECTS says nothing it can —
    // an escaping rejection leaves the handler as a raw `MCP error -32603` with a stack, which the model
    // cannot distinguish from a dead server and cannot act on. The seam's own contract is that it never
    // rejects (`parkToolCall` resolves every refusal), so reaching this catch means that contract broke;
    // the model is still owed an `isError` result naming why, and the turn still has to be able to
    // continue. Guarded HERE, at the one place a park's answer becomes the model's, so the guarantee
    // holds for every park this file is ever handed — the server binding below included.
    try {
      return await park({
        ...(namespace !== undefined ? { namespace } : {}),
        tool: req.params.name,
        arguments: args,
        signal: extra.signal,
      });
    } catch (e) {
      return { content: [{ type: "text", text: `Tool call failed: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
    }
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
    // `dyn` belongs to the bare-function block, which is written LAST and would overwrite this key —
    // the namespace's tools would disappear from the model's view with nothing raised anywhere.
    // `validateDeclarations` refuses the reserved name, so a namespace wearing it here is a bypassed
    // admission, not a client error: refuse it loudly rather than lose tools quietly.
    if (spec.name === RESERVED_NAMESPACE) {
      throw new Error(`dynamic namespace "${RESERVED_NAMESPACE}": the name is reserved for bare tool declarations`);
    }
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

// -------------------------------------------------------------------------------------------------
// THE TRANSIENT OVERLAY (Task 7). Everything above builds servers; this is where they are CARRIED — onto
// the config of ONE engine build and nothing else. `record.config` stays the clean base the swap family
// rebuilds from, because an overlay left on it would hand a second engine the same `Server` instances, and
// a `Server` refuses a second transport: the agent SDK's `connectSdkMcpServer` swallows that failure with
// a debug log, so the thread would simply lose its tools with no error anywhere.

/** What one build needs to know, as a VALUE. Not the record: both admission spines call the factory BEFORE
 *  constructing their `ThreadRecord` (a synchronous factory throw must not orphan state), so at the first
 *  build there is no record to read — and the epoch is 0 there by definition. */
export type DynamicBuildCtx = { threadId: string; generation: number; specs: DynamicToolSpec[] };

/** The park seam's other end, structurally — `AppServer` satisfies it. Declared here rather than imported
 *  so this module stays free of a cycle with the server that calls into it. */
export type ParkHost = {
  parkToolCall(threadId: string, generation: number, call: DynamicToolCall, signal?: AbortSignal): Promise<CallToolResultLike>;
};

/** One engine config, plus this thread's declared tools as MCP servers. A declaration-less thread gets its
 *  config back untouched, key and all — nothing about a non-declaring thread changes.
 *
 *  THE BINDING NEVER THROWS AND NEVER REJECTS. `parkToolCall` answers every refusal with a RESOLVED
 *  cancellation; a rejecting park would reach the model as a raw `MCP error -32603` instead of an
 *  `isError` result it can read and act on. Belt AND braces: the call handler in `buildServer` catches a
 *  broken seam and answers `isError` anyway, so the guarantee is the model's regardless of which side of
 *  this binding breaks it.
 *
 *  `generation` is captured by VALUE here, which is the whole point of taking a context rather than a
 *  record: `swapEngine` bumps the epoch BEFORE it disposes the outgoing engine, so a late callback from
 *  that engine identifies itself by the OLD number and is refused, while the replacement's own build (which
 *  runs after the bump) carries the new one.
 *
 *  The env write is the other half of the naming scheme: a truthy `CLAUDE_AGENT_SDK_MCP_NO_PREFIX` strips
 *  the `mcp__<server>__` prefix off every tool name and collapses every declared namespace into one flat
 *  space. Falsified rather than deleted, because the operator's own shell is one of the places a truthy
 *  value comes from — deleting the key would let it back in.
 *
 *  ON `process.env` AS THE BASE when the caller declared no env of its own: an SDK `env` REPLACES the
 *  subprocess environment rather than augmenting it, so a bare one-key object is PATH and the credentials
 *  gone. `resolveOptions` does spread `process.env` underneath everything it forwards, which makes the
 *  one-key shape survivable today — but "safe because somebody downstream repairs it" is a property of
 *  the other file, not of this write. Stated in code here, the same way the sibling write at
 *  `resolveOptions.ts` states it, so this config is well-formed wherever it is read. */
export function withDynamicServers(host: ParkHost, ctx: DynamicBuildCtx, cfg: Record<string, unknown>): Record<string, unknown> {
  if (ctx.specs.length === 0) return cfg;
  const park: DynamicToolPark = (call) => host.parkToolCall(ctx.threadId, ctx.generation, call, call.signal);
  const base = typeof cfg.env === "object" && cfg.env !== null ? cfg.env as Record<string, unknown> : process.env;
  return {
    ...cfg,
    dynamicToolServers: buildDynamicServers(ctx.specs, park),
    env: { ...base, [MCP_NO_PREFIX_ENV]: "" },
  };
}

/** The same, for a thread that already exists — the three swap factories. Called INSIDE the replacement
 *  thunk, so `record.epoch` is read after `swapEngine`'s bump: the generation this build captures is the
 *  one its own engine will park under. */
export function withThreadDynamicServers(
  host: ParkHost,
  record: { id: string; epoch: number; dynamicTools?: DynamicToolSpec[] },
  cfg: Record<string, unknown>,
): Record<string, unknown> {
  return withDynamicServers(host, { threadId: record.id, generation: record.epoch, specs: record.dynamicTools ?? [] }, cfg);
}
