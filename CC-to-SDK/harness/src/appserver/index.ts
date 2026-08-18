// appserver/index.ts — the `cc-harness/appserver` public barrel (spec §Wave 4, gap 11: "last, after the
// wire surface exists"). CURATED like the package root's `src/index.ts`: every line here is a promise to a
// consumer, so the file lists what an embedder actually needs — construct a server, put it on a socket,
// validate against the wire contract — and nothing that would freeze an internal shape. Registry, Peer,
// the rpc/router plumbing and the per-cluster handler modules stay unexported on purpose; a consumer that
// needs them has found a protocol gap, and the fix is a method, not a deeper import.
// `test/unit/appserver/exports.test.ts` pins the value surface, so adding an export is a deliberate edit.
//
// SCHEMA ARTIFACTS. The same wire contract also ships as two vendored draft-7 JSON documents, reachable as
// `cc-harness/appserver/schema/stable.json` and `.../experimental.json`. Those subpaths make the FILES
// reachable — resolve one (`createRequire(import.meta.url).resolve(...)`, or `import.meta.resolve`) and
// read it with `fs`. Whether a bare `import ... from "cc-harness/appserver/schema/stable.json"` works is a
// Node-version and import-attributes question this package does not answer; the fs route works everywhere.
// The generator behind them is not exported: `ccx serve --emit-schema DIR` regenerates them pinned to the
// installed build, and `methodSchemas` below is the same source of truth in zod form.
// Each document carries TWO top-level maps keyed by method name: `methods` (request params, one entry per
// registered method) and `results` (the RESPONSE shape, present only for the methods that publish one —
// `MethodSchema.result` below, M5 onward). A client joins them by name. Responses sit beside `methods`
// rather than inside each entry so every value under `methods` stays a standalone draft-7 schema a strict
// validator compiles as-is; absence from `results` means "not published yet", never "no response".
import { methodSchemas as registry } from "./schema/index.js";
import type { MethodSchema } from "./schema/index.js";

export { AppServer } from "./server.js";
/** The DI seam an embedder overrides to supply its own engine/session-store implementations. */
export type { AppServerDeps } from "./server.js";
export { listenWs } from "./transport/ws.js";
export type { WsListenOpts } from "./transport/ws.js";
/** The transport seam. `listenWs` is the batteries-included WebSocket listener; an embedder putting the
 *  server on anything else (stdio, UDS, an in-process pipe) implements this and calls
 *  `AppServer.connect(sink)` itself. */
export type { PeerSink } from "./peer.js";
export type { MethodSchema };
/** The method→zod-schema registry the artifacts are generated from — walk it to validate params, or to
 *  discover which methods this build actually answers.
 *
 *  Deliberately typed LOOSER than the internal declaration (`schema/index.ts` keeps the exact record, and
 *  handlers hold direct references into it): `| undefined` forces a consumer indexing it with a method name
 *  this build does not answer to handle the miss, and `Readonly` says the registry is a description of the
 *  wire, not a place to register a method — an entry added here answers nothing. */
export const methodSchemas: Readonly<Record<string, MethodSchema | undefined>> = registry;
/** The two shapes an `AppServerDeps` override has to speak: what a thread IS, and the slice of a session
 *  the server drives (structural — the lib `Session` satisfies `EngineSession` without adapting). The
 *  third, `TurnFailure` (the tag a failed turn's result carries), is exported from the root `cc-harness`
 *  barrel — this subpath does not re-export it. */
export type { EngineSession, ThreadRecord } from "./registry.js";
