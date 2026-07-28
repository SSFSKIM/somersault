// appserver/rpc.ts — JSON-RPC "lite" framing (spec §4): no "jsonrpc" field, NDJSON lines, string|number ids.
export type RequestId = string | number;
export const ERR = { PARSE: -32700, INVALID_REQUEST: -32600, METHOD_NOT_FOUND: -32601, INVALID_PARAMS: -32602, INTERNAL: -32603, OVERLOADED: -32001, BUSY: -33001, ALREADY_SETTLED: -33002, UNAUTHENTICATED: -33003, THREAD_NOT_FOUND: -33004, ENGINE_GONE: -33005, UNSUPPORTED_FOR_ORIGIN: -33006 } as const;
export interface RpcRequest { id: RequestId; method: string; params?: Record<string, unknown> }
export interface RpcNotification { method: string; params?: Record<string, unknown> }
export type Classified =
  | { kind: "request"; id: RequestId; method: string; params?: Record<string, unknown> }
  | { kind: "notification"; method: string; params?: Record<string, unknown> }
  | { kind: "response"; id: RequestId; result: unknown }
  | { kind: "invalid" };
const isId = (v: unknown): v is RequestId => typeof v === "string" || typeof v === "number";
export function classify(v: unknown): Classified {
  if (typeof v !== "object" || v === null) return { kind: "invalid" };
  const o = v as Record<string, unknown>;
  const hasMethod = typeof o.method === "string";
  if (hasMethod && isId(o.id)) return { kind: "request", id: o.id, method: o.method as string, params: o.params as Record<string, unknown> | undefined };
  if (hasMethod && o.id === undefined) return { kind: "notification", method: o.method as string, params: o.params as Record<string, unknown> | undefined };
  if (!hasMethod && isId(o.id) && "result" in o) return { kind: "response", id: o.id, result: o.result };
  return { kind: "invalid" };
}
export function encode(msg: object): string { return JSON.stringify(msg) + "\n"; }
