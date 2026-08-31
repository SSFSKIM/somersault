// The one registration site for engine-ts's owned modules (contract X7).
//
// `main.ts` imports this module for its side effects, before it reads the
// registry. A wave child that ships a standalone-complete module adds its
// import + `register(...)` call here and moves its closure-ledger row in the
// same commit.
//
// EMPTY AT W0 — and that is the honest state: the skeleton owns nothing yet, so
// `engines/engine-ts --owned` reports an empty set and any session input is
// refused by name (see main.ts). Nothing here fakes a working turn.
//
// Example of the shape a wave child adds:
//
//   import { register } from "../registry.js";
//   import { writeToolResultBlock } from "./write-tool-result.js";
//   register({ name: "write-tool-result", subsystem: "subsystem/tool-result-formatters" });
//
export {};
