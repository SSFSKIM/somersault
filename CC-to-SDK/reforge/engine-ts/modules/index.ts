// The one registration site for engine-ts's owned modules (contract X7).
//
// `main.ts` imports this module for its side effects, before it reads the
// registry. A wave child that ships a standalone-complete module adds its import
// + `register(...)` call here and moves its closure-ledger row in the same
// commit.
//
// ## What "dual-wired" means concretely (§2.4)
//
// There is ONE owned implementation per module, and it lives at
// `strangle/modules/<name>/reference.js` — plain ESM, no globalThis, no
// minified identifier anywhere in it. Two wirings import that same file:
//
//   1. the strangler adapter (`strangle/modules/<name>.js`), which installs it
//      into the extracted graph's `globalThis.__reforge` and equality-asserts
//      the graph's `primitive` captures against the module's owned values;
//   2. this file, which registers it as part of engine-ts's owned set.
//
// Importing it HERE is not decoration: `check-reachability.ts` walks this import
// graph, so every reference module is proven — statically, per run — to reach no
// extraction chunk, no pinned binary and no `build/` artifact. A registration
// that merely named a string would prove nothing about the code it names.
//
// Registration is still a claim of ownership, not a proof of it. The proof is
// the two-phase gate (X1) plus the ledger row the wave moves (X2). The `entry`
// column below is checked so the claim at least refers to something that exists.
import { register } from "../registry.js";

import * as writeToolResult from "../../strangle/modules/write-tool-result/reference.js";
import * as editToolResult from "../../strangle/modules/edit-tool-result/reference.js";
import * as readToolResult from "../../strangle/modules/read-tool-result/reference.js";
import * as bashToolResult from "../../strangle/modules/bash-tool-result/reference.js";
import * as grepToolResult from "../../strangle/modules/grep-tool-result/reference.js";
import * as globResult from "../../strangle/modules/glob-result/reference.js";
import * as taskCreateResult from "../../strangle/modules/task-create-result/reference.js";
import * as taskGetResult from "../../strangle/modules/task-get-result/reference.js";
import * as taskListResult from "../../strangle/modules/task-list-result/reference.js";
import * as taskUpdateResult from "../../strangle/modules/task-update-result/reference.js";
import * as envBlock from "../../strangle/modules/env-block/reference.js";
import * as textDelta from "../../strangle/modules/text-delta/reference.js";
import * as sessionMaterialize from "../../strangle/modules/session-materialize/reference.js";
import * as globDescription from "../../strangle/modules/glob-description/reference.js";
import * as readDescription from "../../strangle/modules/read-description/reference.js";
import * as grepDescription from "../../strangle/modules/grep-description/reference.js";
import * as webFetchDescription from "../../strangle/modules/webfetch-description/reference.js";

/** name, closure-ledger subsystem row, and the module's entry point. */
const OWNED: [string, string, unknown][] = [
  // Ten of the graph's 44 tool-result formatters (C4 / W1).
  ["write-tool-result", "subsystem/tool-result-formatters", writeToolResult.writeToolResultBlock],
  ["edit-tool-result", "subsystem/tool-result-formatters", editToolResult.editToolResultBlock],
  ["read-tool-result", "subsystem/tool-result-formatters", readToolResult.readToolResultBlock],
  ["bash-tool-result", "subsystem/tool-result-formatters", bashToolResult.bashToolResultBlock],
  ["grep-tool-result", "subsystem/tool-result-formatters", grepToolResult.grepToolResultBlock],
  ["glob-result", "subsystem/tool-result-formatters", globResult.globResultBlock],
  ["task-create-result", "subsystem/tool-result-formatters", taskCreateResult.taskCreateResultBlock],
  ["task-get-result", "subsystem/tool-result-formatters", taskGetResult.taskGetResultBlock],
  ["task-list-result", "subsystem/tool-result-formatters", taskListResult.taskListResultBlock],
  ["task-update-result", "subsystem/tool-result-formatters", taskUpdateResult.taskUpdateResultBlock],
  // The W0a mechanism spikes, standalone-complete since C4's retrofit. Their
  // SUBSYSTEMS belong to later waves — one owned module is not an owned
  // subsystem, and the ledger says so.
  ["env-block", "subsystem/environment-and-system-prompt", envBlock.envBlock],
  ["text-delta", "subsystem/query-loop", textDelta.appendTextDelta],
  ["session-materialize", "subsystem/session-storage", sessionMaterialize.materializeSessionFile],
  // Four of the catalog's tool descriptions (C5 / W2). `glob-description` is the
  // campaign's first S-CHUNK: it is not a function spliced out of a chunk but the
  // whole of chunk-y30v0ja7, so registering it claims its two tool-name constants
  // as well as its description function. The other three are S-method splices —
  // their chunks carry 15/17/4 exports of unrelated behaviour and stay upstream's.
  //
  // The SUBSYSTEM row they contribute to does not close on them: its charter is
  // every description function plus the satellite chunks' other exports, and
  // three of those four chunks are still upstream's. reforge/ledger.json says so.
  ["glob-description", "subsystem/tool-descriptions", globDescription.globDescription],
  ["read-description", "subsystem/tool-descriptions", readDescription.readDescription],
  ["grep-description", "subsystem/tool-descriptions", grepDescription.grepDescription],
  ["webfetch-description", "subsystem/tool-descriptions", webFetchDescription.webFetchDescription],
];

for (const [name, subsystem, entry] of OWNED) {
  if (typeof entry !== "function") {
    throw new Error(`engine-ts: '${name}' registers a module whose entry point is not a function — the reference module moved or its export was renamed`);
  }
  register({ name, subsystem });
}

export {};
