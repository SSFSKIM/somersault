// test/unit/appserver/dynamic-tools-exchange.test.ts — M7 Task 6: the INSTANCE-DIRECT half of the
// exchange. A real MCP `Client` over `InMemoryTransport.createLinkedPair()` drives the very server
// objects `buildDynamicServers` hands the engine. No app-server, no wire, no key: the transport is the
// only thing faked, and it is faked by the MCP SDK itself.
//
// WHY THE EXCHANGE IS THE TEST. Everything Task 6 promises is a claim about what a REAL MCP client sees,
// and nearly every one of those claims is invisible to a unit test that calls the handler directly:
//
//   THE ADVERTISEMENT IS THE PRODUCT. `tools/list` must return the client's declared JSON Schema
//   VERBATIM — descriptions, bounds, `integer`, `enum` and all. That is the whole reason rev 3 abandoned
//   `createSdkMcpServer`/`tool()`: BOTH zod paths lose declared constraints on the way out (built objects
//   drop descriptions, bounds and `.int()`; raw shapes keep only descriptions). A deep-equal against the
//   declaration OBJECT is the only assertion that can tell a verbatim advertisement from a lossy one.
//
//   THE CAPABILITY IS A HANDSHAKE, NOT A FIELD. A strict MCP client refuses to CALL `tools/list` unless
//   `initialize` advertised `tools`, and the pinned SDK refuses to INSTALL a handler for a capability the
//   server never registered. Both halves of that ordering are pinned below, because a server that got it
//   wrong would be a constructor that throws or a client that never asks — neither visible from inside.
//
//   VALIDATION IS PASS/FAIL, AND THE ORIGINAL IS WHAT TRAVELS. The converted zod says only whether the
//   model's arguments are admissible; what parks is `req.params.arguments ?? {}` — the object the CALLER
//   sent. zod's parse output is a rebuilt object (schemaToZod.ts's own call-seam note), and the rebuild is
//   observable: v4's loose object emits DECLARED keys first and extras after, so caller key order is the
//   discriminator between "parked the original" and "parked the parse result".
//
//   ONE HANDLER SERVES A WHOLE NAMESPACE. A namespace is one server with many tools, so the CallTool
//   handler dispatches by name over a table built once. The cross-validation rows (each tool's arguments
//   refused by the OTHER tool's schema) are what make "dispatch" a real claim rather than an accident of
//   there being one tool.
//
// TWO MEASURED BOUNDS ARE PINNED HERE RATHER THAN ASSUMED (both reported in the task report):
//   A `__proto__` own key NEVER reaches this layer — the MCP SDK's own `CallToolRequestSchema.parse`
//   rebuilds `params.arguments` as a null-prototype object and drops the key upstream of us.
//   A declaration that omits `type:"object"` is advertised verbatim and the strict client then refuses
//   the WHOLE list (`ToolSchema.inputSchema` pins `type: "object"`), taking its well-formed siblings with
//   it while the server keeps serving all of them — a declaration-shape obligation (Task 7).
import { describe, it, expect, afterEach, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ErrorCode, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  buildDynamicServers,
  type DynamicToolCall,
  type DynamicToolPark,
} from "../../../src/appserver/dynamicServers.js";
import {
  DynamicCalls,
  cancelledCallResult,
  type CallToolResultLike,
  type DynamicCallEvent,
} from "../../../src/appserver/dynamicCalls.js";
import {
  RESERVED_NAMESPACE,
  toCallResult,
  type DynamicToolFunction,
  type DynamicToolSpec,
} from "../../../src/appserver/dynamicTools.js";

/** The entry shape the builder produces, as `McpSdkServerConfigWithInstance` spells it. */
type SdkEntry = { type: "sdk"; name: string; instance: McpServer };

const entryOf = (servers: Record<string, unknown>, name: string): SdkEntry => servers[name] as SdkEntry;

/** Every client/server pair a row opens, closed after it — an in-memory transport keeps both ends alive. */
const opened: Array<{ client: Client; instance: McpServer }> = [];

afterEach(async () => {
  for (const { client, instance } of opened.splice(0)) {
    await client.close().catch(() => {});
    await instance.close().catch(() => {});
  }
});

/** A real MCP client, initialized against the built instance over a linked in-memory pair. Connecting the
 *  WRAPPER on purpose: `McpServer.connect` delegates to the low-level `server` our handlers live on, and
 *  the wrapper is what the entry hands the engine. */
async function connect(entry: SdkEntry): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "m7-exchange", version: "0.0.0" });
  await Promise.all([entry.instance.connect(serverTransport), client.connect(clientTransport)]);
  opened.push({ client, instance: entry.instance });
  return client;
}

/** A park that records and never settles on its own — the row decides when (and with what) each call
 *  answers, which is the only way to assert two concurrent calls settle independently. */
function recordingPark(): { park: DynamicToolPark; parked: Array<{ call: DynamicToolCall; settle: (r: CallToolResultLike) => void }> } {
  const parked: Array<{ call: DynamicToolCall; settle: (r: CallToolResultLike) => void }> = [];
  const park: DynamicToolPark = (call) => new Promise<CallToolResultLike>((resolve) => parked.push({ call, settle: resolve }));
  return { park, parked };
}

const TEXT = (text: string): CallToolResultLike => ({ content: [{ type: "text", text }], isError: false });

/** Request options for the rows that assert a call is REFUSED. A refusal is an error response the client
 *  sees at once; a regression that parked instead would otherwise sit on MCP's 60-second default request
 *  timeout before the row could notice (measured — the sabotage pass took ten minutes on this file). The
 *  short deadline keeps a negative row's failure fast and its message honest either way. */
const REFUSED = { timeout: 3_000 } as const;

/** A declaration deliberately full of everything a zod round-trip is known to drop: field descriptions,
 *  string and numeric bounds, `integer`, an `enum`, and an array's `items`. */
const RICH_SCHEMA = {
  type: "object",
  description: "search the ops index",
  properties: {
    q: { type: "string", description: "the query", minLength: 2, maxLength: 40 },
    limit: { type: "integer", description: "how many rows", minimum: 1, maximum: 50 },
    mode: { type: "string", enum: ["fast", "deep"] },
    tags: { type: "array", items: { type: "string" } },
  },
  required: ["q"],
} as const;

const OPS: DynamicToolSpec = {
  type: "namespace",
  name: "ops",
  description: "operations tooling",
  tools: [
    { type: "function", name: "lookup", description: "look something up", inputSchema: RICH_SCHEMA as unknown as Record<string, unknown> },
    {
      type: "function",
      name: "count",
      description: "count something",
      inputSchema: { type: "object", properties: { n: { type: "integer", minimum: 0 } }, required: ["n"] },
    },
  ],
};

const BARE: DynamicToolSpec = {
  type: "function",
  name: "ping",
  description: "no arguments at all",
  inputSchema: { type: "object", properties: {} },
};

const STRICT: DynamicToolSpec = {
  type: "namespace",
  name: "tight",
  description: "closed-world tooling",
  tools: [
    {
      type: "function",
      name: "exact",
      description: "refuses extras",
      inputSchema: { type: "object", properties: { a: { type: "string" } }, required: ["a"], additionalProperties: false },
    },
  ],
};

describe("buildDynamicServers — the entries", () => {
  it("mints one entry per namespace plus `dyn` for bare functions, each an sdk entry around a wrapper", () => {
    const { park } = recordingPark();
    const servers = buildDynamicServers([OPS, BARE], park);

    expect(Object.keys(servers).sort()).toEqual(["dyn", "ops"]);
    for (const name of ["ops", RESERVED_NAMESPACE]) {
      const entry = entryOf(servers, name);
      expect(entry.type).toBe("sdk");
      expect(entry.name).toBe(name);
      expect(entry.instance).toBeInstanceOf(McpServer);
    }
  });

  it("is NEVER cached — every build mints fresh instances", () => {
    const { park } = recordingPark();
    const first = buildDynamicServers([OPS], park);
    const second = buildDynamicServers([OPS], park);

    expect(entryOf(first, "ops")).not.toBe(entryOf(second, "ops"));
    expect(entryOf(first, "ops").instance).not.toBe(entryOf(second, "ops").instance);
    expect(entryOf(first, "ops").instance.server).not.toBe(entryOf(second, "ops").instance.server);
  });

  it("declares nothing when nothing was declared", () => {
    const { park } = recordingPark();
    expect(buildDynamicServers([], park)).toEqual({});
  });

  it("throws on a schema that does not convert — declaration validation already passed it, so `!ok` is an invariant violation", () => {
    const { park } = recordingPark();
    const bad: DynamicToolSpec = { type: "function", name: "broken", description: "x", inputSchema: { oneOf: [] } };
    expect(() => buildDynamicServers([bad], park)).toThrow(/broken/);
    expect(() => buildDynamicServers([bad], park)).toThrow(/oneOf/);
  });

  // The same invariant reasoning as the row above, applied to the two ways a build could LOSE tools
  // instead of refusing. Both are refused at admission today, so either one reaching the builder means a
  // declaration went live without passing it — and silent tool loss is the worst possible answer to that.
  it("throws when a namespace claims the reserved `dyn` name — the bare-function block would otherwise overwrite it", () => {
    const { park } = recordingPark();
    const shadow: DynamicToolSpec = {
      type: "namespace",
      name: RESERVED_NAMESPACE,
      description: "d",
      tools: [{ type: "function", name: "hidden", description: "d", inputSchema: { type: "object", properties: {} } }],
    };
    // With a bare function present the clobber is real; without one it is merely latent. Both refuse.
    expect(() => buildDynamicServers([shadow, BARE], park)).toThrow(/"dyn"/);
    expect(() => buildDynamicServers([shadow], park)).toThrow(/reserved/);
  });

  it("throws on two tools sharing one name in a namespace — the table would otherwise keep only the last", () => {
    const { park } = recordingPark();
    const twice: DynamicToolSpec = {
      type: "namespace",
      name: "ops",
      description: "d",
      tools: [
        { type: "function", name: "same", description: "first", inputSchema: { type: "object", properties: {} } },
        { type: "function", name: "same", description: "second", inputSchema: { type: "object", properties: {} } },
      ],
    };
    expect(() => buildDynamicServers([twice], park)).toThrow(/"same"/);
    expect(() => buildDynamicServers([twice], park)).toThrow(/twice/);
  });
});

describe("buildDynamicServers — initialize", () => {
  it("ADVERTISES the tools capability, so a strict client is willing to list and call", async () => {
    const { park } = recordingPark();
    const client = await connect(entryOf(buildDynamicServers([OPS], park), "ops"));

    expect(client.getServerCapabilities()?.tools).toEqual({});
    await expect(client.listTools()).resolves.toBeDefined();
  });

  it("carries the namespace description as the server's instructions; `dyn` has none to carry", async () => {
    const { park } = recordingPark();
    const servers = buildDynamicServers([OPS, BARE], park);

    const ns = await connect(entryOf(servers, "ops"));
    expect(ns.getInstructions()).toBe("operations tooling");

    const dyn = await connect(entryOf(servers, RESERVED_NAMESPACE));
    expect(dyn.getInstructions()).toBeUndefined();
  });

  // The pinned SDK's `Server.assertRequestHandlerCapability` throws for `tools/list` and `tools/call`
  // against a server whose capabilities never mentioned tools. This row is the measurement the ordering
  // rule rests on — the builder registers the capability at CONSTRUCTION, before either handler.
  it("the capability must precede the handlers — installing first throws in the pinned SDK", () => {
    const capabilityless = new McpServer({ name: "bare", version: "0.0.0" });
    expect(() => capabilityless.server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [] }))).toThrow(
      /does not support tools/,
    );

    const declared = new McpServer({ name: "declared", version: "0.0.0" }, { capabilities: { tools: {} } });
    expect(() => declared.server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [] }))).not.toThrow();
  });

  // The plan demanded this be verified rather than assumed: `McpServer` installs its tool handlers lazily,
  // from the tool-REGISTRATION path only, so a wrapper we never call `registerTool` on leaves both slots
  // free for ours. If a future SDK installed them eagerly, our `setRequestHandler` would throw
  // "already exists" — this row fails first, and loudly.
  it("a bare McpServer with zero registered tools installs NO conflicting tools handlers", () => {
    const bare = new McpServer({ name: "bare", version: "0.0.0" }, { capabilities: { tools: {} } });
    expect(() => bare.server.assertCanSetRequestHandler("tools/list")).not.toThrow();
    expect(() => bare.server.assertCanSetRequestHandler("tools/call")).not.toThrow();
  });
});

describe("buildDynamicServers — tools/list", () => {
  it("returns the declared JSON Schema VERBATIM — the declaration object, deep-equal", async () => {
    const { park } = recordingPark();
    const client = await connect(entryOf(buildDynamicServers([OPS], park), "ops"));

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["lookup", "count"]);

    const lookup = tools[0]!;
    expect(lookup.description).toBe("look something up");
    expect(lookup.inputSchema).toEqual(RICH_SCHEMA);
    // Named individually as well: a deep-equal that somehow passed on a lossy object would still have to
    // explain these, and they are exactly what every zod path was measured to drop.
    const properties = lookup.inputSchema.properties as Record<string, Record<string, unknown>>;
    expect(properties.q).toEqual({ type: "string", description: "the query", minLength: 2, maxLength: 40 });
    expect(properties.limit).toEqual({ type: "integer", description: "how many rows", minimum: 1, maximum: 50 });
    expect(properties.mode).toEqual({ type: "string", enum: ["fast", "deep"] });
    expect(properties.tags).toEqual({ type: "array", items: { type: "string" } });
    expect(lookup.inputSchema.required).toEqual(["q"]);
    expect(lookup.inputSchema.description).toBe("search the ops index");
  });

  it("maps deferLoading with Codex's polarity at all three values", async () => {
    const { park } = recordingPark();
    const specs: DynamicToolSpec[] = [
      {
        type: "namespace",
        name: "ops",
        description: "d",
        tools: [
          { type: "function", name: "omitted", description: "d", inputSchema: { type: "object", properties: {} } },
          { type: "function", name: "explicitFalse", description: "d", inputSchema: { type: "object", properties: {} }, deferLoading: false },
          { type: "function", name: "explicitTrue", description: "d", inputSchema: { type: "object", properties: {} }, deferLoading: true },
        ],
      },
    ];
    const client = await connect(entryOf(buildDynamicServers(specs, park), "ops"));

    const { tools } = await client.listTools();
    const alwaysLoad = Object.fromEntries(tools.map((t) => [t.name, t._meta?.["anthropic/alwaysLoad"]]));
    expect(alwaysLoad).toEqual({ omitted: true, explicitFalse: true, explicitTrue: false });
  });

  // THE ADVERTISEMENT AND THE VALIDATOR ARE ONE SNAPSHOT. The validator was always built once, at
  // construction; if the advertisement stayed a live read of the caller's spec objects, any later in-place
  // edit would move what the model is TOLD without moving what CallTool ENFORCES. That divergence is
  // exactly what verbatim advertisement exists to prevent, so this row mutates every field the
  // advertisement is made of — including a nested one inside the schema — and demands both halves hold.
  it("snapshots the advertisement at build — mutating the caller's spec afterwards changes neither the list nor what CallTool enforces", async () => {
    const { park, parked } = recordingPark();
    const declared = { type: "object", properties: { q: { type: "string", minLength: 2 } }, required: ["q"] };
    const spec: DynamicToolFunction = {
      type: "function",
      name: "live",
      description: "as declared",
      inputSchema: declared as unknown as Record<string, unknown>,
    };
    const servers = buildDynamicServers([spec], park);

    spec.description = "MUTATED";
    spec.deferLoading = true;
    declared.properties.q.minLength = 40;
    (declared.properties as Record<string, unknown>).injected = { type: "string" };

    const client = await connect(entryOf(servers, RESERVED_NAMESPACE));
    const listed = (await client.listTools()).tools[0]!;
    expect(listed.description).toBe("as declared");
    expect(listed._meta?.["anthropic/alwaysLoad"]).toBe(true);
    expect(listed.inputSchema).toEqual({ type: "object", properties: { q: { type: "string", minLength: 2 } }, required: ["q"] });

    // The enforced schema is the same snapshot: `"hi"` satisfies the DECLARED minLength of 2 and would be
    // refused by the mutated 40, so a call that parks proves advert and validator still agree.
    const call = client.callTool({ name: "live", arguments: { q: "hi" } });
    await vi.waitFor(() => expect(parked).toHaveLength(1));
    expect(parked[0]!.call.arguments).toEqual({ q: "hi" });
    parked[0]!.settle(TEXT("ok"));
    await expect(call).resolves.toBeDefined();

    // And the advert is DEEP-FROZEN, which closes the other direction: the client's parsed result shares
    // our leaf property objects over this transport (zod rebuilds only the levels its schema declares), so
    // an unfrozen advert could be rewritten from the far end of the connection.
    const leaf = (listed.inputSchema.properties as Record<string, Record<string, unknown>>).q!;
    expect(Object.isFrozen(leaf)).toBe(true);
    expect(() => {
      leaf.type = "number";
    }).toThrow(TypeError);
    const relisted = (await client.listTools()).tools[0]!;
    expect((relisted.inputSchema.properties as Record<string, unknown>).q).toEqual({ type: "string", minLength: 2 });
  });

  it("lists a namespace's tools on its own server and bare functions on `dyn`", async () => {
    const { park } = recordingPark();
    const servers = buildDynamicServers([OPS, BARE], park);

    const ns = await connect(entryOf(servers, "ops"));
    expect((await ns.listTools()).tools.map((t) => t.name)).toEqual(["lookup", "count"]);

    const dyn = await connect(entryOf(servers, RESERVED_NAMESPACE));
    expect((await dyn.listTools()).tools.map((t) => t.name)).toEqual(["ping"]);
  });

  // A MEASURED BOUND, not an endorsement, and the blast radius is the whole point. `type:"object"` is
  // optional in the conversion subset but REQUIRED by MCP's own `ToolSchema`, and verbatim means verbatim
  // — so ONE malformed declaration makes the strict client refuse the ENTIRE result, and its well-formed
  // siblings vanish from the model's view while the server goes on serving them happily. Silent from the
  // server's side, total from the model's. That is why the refusal belongs at declaration validation
  // (Task 7), where the answer can be a -32602 naming the offending tool; this row pins what today's
  // behavior actually costs.
  it("BOUND: one declaration omitting `type:\"object\"` takes the WHOLE list with it — the siblings vanish from the client's view while tools/call still serves them", async () => {
    const { park, parked } = recordingPark();
    const mixed: DynamicToolSpec = {
      type: "namespace",
      name: "mixed",
      description: "two well-formed declarations and one that omits the root type",
      tools: [
        { type: "function", name: "good", description: "d", inputSchema: { type: "object", properties: {} } },
        { type: "function", name: "typeless", description: "d", inputSchema: { properties: { a: { type: "string" } } } },
        { type: "function", name: "alsoGood", description: "d", inputSchema: { type: "object", properties: {} } },
      ],
    };
    const client = await connect(entryOf(buildDynamicServers([mixed], park), "mixed"));

    await expect(client.listTools()).rejects.toThrow(/inputSchema/);

    // All three are nonetheless live: the model can never learn they exist, but every one of them answers.
    for (const name of ["good", "alsoGood", "typeless"]) {
      const call = client.callTool({ name, arguments: {} });
      await vi.waitFor(() => expect(parked).toHaveLength(1));
      expect(parked[0]!.call.tool).toBe(name);
      parked.pop()!.settle(TEXT(`served ${name}`));
      await expect(call).resolves.toMatchObject({ content: [{ type: "text", text: `served ${name}` }] });
    }
  });
});

describe("buildDynamicServers — tools/call", () => {
  it("parks a valid call and resolves the model's result when the park settles", async () => {
    const { park, parked } = recordingPark();
    const client = await connect(entryOf(buildDynamicServers([OPS], park), "ops"));

    const call = client.callTool({ name: "lookup", arguments: { q: "hello" } });
    await vi.waitFor(() => expect(parked).toHaveLength(1));
    expect(parked[0]!.call.namespace).toBe("ops");
    expect(parked[0]!.call.tool).toBe("lookup");
    expect(parked[0]!.call.arguments).toEqual({ q: "hello" });

    parked[0]!.settle(TEXT("answered"));
    await expect(call).resolves.toMatchObject({ content: [{ type: "text", text: "answered" }], isError: false });
  });

  it("a bare function parks with NO namespace", async () => {
    const { park, parked } = recordingPark();
    const client = await connect(entryOf(buildDynamicServers([BARE], park), RESERVED_NAMESPACE));

    const call = client.callTool({ name: "ping", arguments: {} });
    await vi.waitFor(() => expect(parked).toHaveLength(1));
    expect(parked[0]!.call.namespace).toBeUndefined();
    expect("namespace" in parked[0]!.call).toBe(false);

    parked[0]!.settle(TEXT("pong"));
    await call;
  });

  // MCP makes `arguments` OPTIONAL. A zero-argument call of an empty-object tool is the ordinary way a
  // model invokes one, and it must PARK — refusing it would make such tools uncallable.
  it("a call OMITTING `arguments` on an empty-object tool parks with `{}`", async () => {
    const { park, parked } = recordingPark();
    const client = await connect(entryOf(buildDynamicServers([BARE], park), RESERVED_NAMESPACE));

    const call = client.callTool({ name: "ping" });
    await vi.waitFor(() => expect(parked).toHaveLength(1));
    expect(parked[0]!.call.arguments).toEqual({});
    expect(Object.keys(parked[0]!.call.arguments)).toEqual([]);

    parked[0]!.settle(TEXT("pong"));
    await expect(call).resolves.toBeDefined();
  });

  it("passthrough extras survive validation and reach the parked arguments", async () => {
    const { park, parked } = recordingPark();
    const client = await connect(entryOf(buildDynamicServers([OPS], park), "ops"));

    const call = client.callTool({ name: "lookup", arguments: { q: "hi", surprise: { deep: [1, 2] } } });
    await vi.waitFor(() => expect(parked).toHaveLength(1));
    expect(parked[0]!.call.arguments).toEqual({ q: "hi", surprise: { deep: [1, 2] } });

    parked[0]!.settle(TEXT("ok"));
    await call;
  });

  // THE CONTROLLER'S RULE, MADE OBSERVABLE. Validation is pass/fail; what parks is the object the caller
  // sent. zod v4's loose object rebuilds its output DECLARED-KEYS-FIRST, so parking the parse result would
  // reorder these three keys to `q, zzz, mmm`. Key order is the discriminator that survives the transport.
  it("parks the VALIDATED ORIGINAL, not zod's parse output — caller key order is preserved verbatim", async () => {
    const { park, parked } = recordingPark();
    const client = await connect(entryOf(buildDynamicServers([OPS], park), "ops"));

    const args = JSON.parse('{"zzz":1,"q":"hi","mmm":2}') as Record<string, unknown>;
    const call = client.callTool({ name: "lookup", arguments: args });
    await vi.waitFor(() => expect(parked).toHaveLength(1));

    expect(Object.keys(parked[0]!.call.arguments)).toEqual(["zzz", "q", "mmm"]);
    expect(parked[0]!.call.arguments).toEqual({ zzz: 1, q: "hi", mmm: 2 });

    parked[0]!.settle(TEXT("ok"));
    await call;
  });

  // A MEASURED BOUND on the `__proto__` seam schemaToZod.ts's call-seam note describes. The note is about
  // OUR layer, and our layer obeys it — but a `__proto__` own key never gets that far: the MCP SDK's own
  // `CallToolRequestSchema.parse` rebuilds `params.arguments` as a NULL-PROTOTYPE object and drops the key
  // before any handler runs. Pinned so an SDK bump that starts preserving it is caught here, where the
  // rule above (park the original) already handles it correctly.
  it("BOUND: a `__proto__` own key is stripped by the MCP request parse upstream of the handler, and pollutes nothing", async () => {
    const { park, parked } = recordingPark();
    const protoTool: DynamicToolSpec = {
      type: "function",
      name: "protoTool",
      description: "admits a __proto__ property",
      inputSchema: { type: "object", properties: { __proto__: { type: "string" }, q: { type: "string" } } },
    };
    const client = await connect(entryOf(buildDynamicServers([protoTool], park), RESERVED_NAMESPACE));

    const args = JSON.parse('{"__proto__":"pollute","q":"hi"}') as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(args, "__proto__")).toBe(true);

    const call = client.callTool({ name: "protoTool", arguments: args });
    await vi.waitFor(() => expect(parked).toHaveLength(1));

    const landed = parked[0]!.call.arguments;
    expect(Object.prototype.hasOwnProperty.call(landed, "__proto__")).toBe(false);
    expect(Object.keys(landed)).toEqual(["q"]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);

    parked[0]!.settle(TEXT("ok"));
    await call;
  });

  it("an unknown tool name is InvalidParams and NEVER parks", async () => {
    const { park, parked } = recordingPark();
    const client = await connect(entryOf(buildDynamicServers([OPS], park), "ops"));

    await expect(client.callTool({ name: "nosuch", arguments: {} }, undefined, REFUSED)).rejects.toMatchObject({
      code: ErrorCode.InvalidParams,
    });
    expect(parked).toEqual([]);
  });

  it("strict extras are refused at CallTool and NEVER park", async () => {
    const { park, parked } = recordingPark();
    const client = await connect(entryOf(buildDynamicServers([STRICT], park), "tight"));

    await expect(client.callTool({ name: "exact", arguments: { a: "x", extra: 1 } }, undefined, REFUSED)).rejects.toMatchObject({
      code: ErrorCode.InvalidParams,
    });
    expect(parked).toEqual([]);

    // The same tool with only its declared key parks — the refusal is the extra, not the tool.
    const ok = client.callTool({ name: "exact", arguments: { a: "x" } });
    await vi.waitFor(() => expect(parked).toHaveLength(1));
    parked[0]!.settle(TEXT("ok"));
    await ok;
  });

  it("a bound violation errors without parking", async () => {
    const { park, parked } = recordingPark();
    const client = await connect(entryOf(buildDynamicServers([OPS], park), "ops"));

    // `q` declares minLength 2.
    await expect(client.callTool({ name: "lookup", arguments: { q: "x" } }, undefined, REFUSED)).rejects.toMatchObject({
      code: ErrorCode.InvalidParams,
    });
    // `limit` declares maximum 50 and `integer`.
    await expect(client.callTool({ name: "lookup", arguments: { q: "ok", limit: 99 } }, undefined, REFUSED)).rejects.toMatchObject({
      code: ErrorCode.InvalidParams,
    });
    await expect(client.callTool({ name: "lookup", arguments: { q: "ok", limit: 1.5 } }, undefined, REFUSED)).rejects.toMatchObject({
      code: ErrorCode.InvalidParams,
    });
    // A missing REQUIRED key is the same refusal.
    await expect(client.callTool({ name: "lookup", arguments: {} }, undefined, REFUSED)).rejects.toMatchObject({
      code: ErrorCode.InvalidParams,
    });
    expect(parked).toEqual([]);
  });

  // ONE HANDLER, MANY TOOLS. Each entry carries its OWN converted schema: `count`'s arguments must be
  // refused by `lookup` and vice versa, or the dispatch is not really dispatching.
  it("each tool in a namespace validates against ITS OWN schema", async () => {
    const { park, parked } = recordingPark();
    const client = await connect(entryOf(buildDynamicServers([OPS], park), "ops"));

    await expect(client.callTool({ name: "lookup", arguments: { n: 3 } }, undefined, REFUSED)).rejects.toMatchObject({
      code: ErrorCode.InvalidParams,
    });
    await expect(client.callTool({ name: "count", arguments: { q: "hi" } }, undefined, REFUSED)).rejects.toMatchObject({
      code: ErrorCode.InvalidParams,
    });
    expect(parked).toEqual([]);

    const counted = client.callTool({ name: "count", arguments: { n: 3 } });
    await vi.waitFor(() => expect(parked).toHaveLength(1));
    expect(parked[0]!.call.tool).toBe("count");
    parked[0]!.settle(TEXT("3"));
    await expect(counted).resolves.toMatchObject({ content: [{ type: "text", text: "3" }] });
  });

  it("two differently-shaped tools in ONE namespace run concurrently and settle in REVERSE order, each with its own result", async () => {
    const { park, parked } = recordingPark();
    const client = await connect(entryOf(buildDynamicServers([OPS], park), "ops"));

    const lookup = client.callTool({ name: "lookup", arguments: { q: "hello", mode: "deep" } });
    const count = client.callTool({ name: "count", arguments: { n: 7 } });
    await vi.waitFor(() => expect(parked).toHaveLength(2));

    expect(parked.map((p) => p.call.tool)).toEqual(["lookup", "count"]);
    expect(parked[0]!.call.arguments).toEqual({ q: "hello", mode: "deep" });
    expect(parked[1]!.call.arguments).toEqual({ n: 7 });

    parked[1]!.settle(TEXT("counted 7"));
    parked[0]!.settle(TEXT("looked up hello"));

    await expect(count).resolves.toMatchObject({ content: [{ type: "text", text: "counted 7" }] });
    await expect(lookup).resolves.toMatchObject({ content: [{ type: "text", text: "looked up hello" }] });
  });

  it("all three content kinds round-trip through a park", async () => {
    const { park, parked } = recordingPark();
    const client = await connect(entryOf(buildDynamicServers([BARE], park), RESERVED_NAMESPACE));

    const call = client.callTool({ name: "ping" });
    await vi.waitFor(() => expect(parked).toHaveLength(1));

    const png = "iVBORw0KGgo=";
    const wav = "UklGRiQAAABXQVZF";
    parked[0]!.settle(
      toCallResult(
        [
          { type: "inputText", text: "a note" },
          { type: "inputImage", imageUrl: `data:image/png;base64,${png}` },
          { type: "inputAudio", audioUrl: `data:audio/wav;base64,${wav}` },
        ],
        true,
      ),
    );

    await expect(call).resolves.toMatchObject({
      isError: false,
      content: [
        { type: "text", text: "a note" },
        { type: "image", data: png, mimeType: "image/png" },
        { type: "audio", data: wav, mimeType: "audio/wav" },
      ],
    });
  });

  it("an isError result travels as an isError result", async () => {
    const { park, parked } = recordingPark();
    const client = await connect(entryOf(buildDynamicServers([BARE], park), RESERVED_NAMESPACE));

    const call = client.callTool({ name: "ping" });
    await vi.waitFor(() => expect(parked).toHaveLength(1));
    parked[0]!.settle(toCallResult([{ type: "inputText", text: "the tool failed" }], false));

    await expect(call).resolves.toMatchObject({ isError: true, content: [{ type: "text", text: "the tool failed" }] });
  });
});

// The abort seam, exercised end to end against the REAL registry: a client cancellation becomes
// `notifications/cancelled`, the pinned SDK aborts the handler's `extra.signal`, and that signal is the
// one `DynamicCalls.park` listens on. This is the first row in the milestone where the park promise is
// driven from the CALLER side rather than from the registry's own API.
describe("buildDynamicServers — the abort seam", () => {
  it("propagates `extra.signal` into the park callback and an abort mid-park settles the parked promise", async () => {
    const events: DynamicCallEvent[] = [];
    const calls = new DynamicCalls((ev) => events.push(ev));
    const parkPromises: Array<Promise<CallToolResultLike>> = [];
    let seen: AbortSignal | undefined;

    const servers = buildDynamicServers([OPS], (call) => {
      seen = call.signal;
      const promise = calls.park(
        {
          threadId: "th_1",
          turnId: "turn_1",
          epoch: 0,
          ...(call.namespace !== undefined ? { namespace: call.namespace } : {}),
          tool: call.tool,
          arguments: call.arguments,
        },
        call.signal,
      );
      parkPromises.push(promise);
      return promise;
    });
    const client = await connect(entryOf(servers, "ops"));

    const controller = new AbortController();
    const call = client.callTool({ name: "lookup", arguments: { q: "hello" } }, undefined, { signal: controller.signal });

    await vi.waitFor(() => expect(calls.pending()).toHaveLength(1));
    expect(seen).toBeInstanceOf(AbortSignal);
    expect(seen!.aborted).toBe(false);

    controller.abort();

    await expect(call).rejects.toThrow();
    await vi.waitFor(() => expect(seen!.aborted).toBe(true));
    await expect(parkPromises[0]!).resolves.toEqual(cancelledCallResult("aborted"));
    expect(calls.pending()).toEqual([]);
    expect(events.at(-1)).toMatchObject({ kind: "settled", outcome: "cancelled", reason: "aborted" });
  });
});

// The handler table is built ONCE per server and never consulted through a prototype chain: a tool named
// after an Object.prototype member must not resolve, and a name nobody declared must not resolve to one.
describe("buildDynamicServers — the dispatch table", () => {
  it("does not resolve inherited names", async () => {
    const { park, parked } = recordingPark();
    const client = await connect(entryOf(buildDynamicServers([OPS], park), "ops"));

    for (const name of ["toString", "constructor", "hasOwnProperty", "__proto__"]) {
      await expect(client.callTool({ name, arguments: {} }, undefined, REFUSED)).rejects.toMatchObject({ code: ErrorCode.InvalidParams });
    }
    expect(parked).toEqual([]);
  });

  it("installs exactly one handler per tools method, on the low-level server", () => {
    const { park } = recordingPark();
    const entry = entryOf(buildDynamicServers([OPS], park), "ops");

    // Both slots are taken by OUR handlers, so a second install would collide — which is what makes the
    // "no conflicting bare-server handler" row above load-bearing.
    expect(() => entry.instance.server.assertCanSetRequestHandler("tools/list")).toThrow(/already exists/);
    expect(() => entry.instance.server.assertCanSetRequestHandler("tools/call")).toThrow(/already exists/);
  });
});
