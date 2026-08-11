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
export { AppServer } from "./server.js";
/** The DI seam an embedder overrides to supply its own engine/session-store implementations. */
export type { AppServerDeps } from "./server.js";
export { listenWs } from "./transport/ws.js";
export type { WsListenOpts } from "./transport/ws.js";
/** The method→zod-schema registry the artifacts are generated from — walk it to validate params, or to
 *  discover which methods this build actually answers. */
export { methodSchemas } from "./schema/index.js";
export type { MethodSchema } from "./schema/index.js";
/** The two shapes an `AppServerDeps` override has to speak: what a thread IS, and the slice of a session
 *  the server drives (structural — the lib `Session` satisfies `EngineSession` without adapting). */
export type { EngineSession, ThreadRecord } from "./registry.js";
