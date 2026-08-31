// The splice manifest — what the strangler has taken ownership of so far.
//
// Its own module because both the build and the gate need to read it, and
// importing it must not run a build. Adding a splice is: write the module + its
// sabotage twin under strangle/modules/, add a row here, name its covering
// scenarios. Nothing else changes.
//
// SCHEMA (campaign spec C1, contract X3 — §2.1 target shapes, §2.4 capture
// taxonomy). A row declares three things the build cannot guess:
//
//  1. `target` — the syntactic SHAPE of the node the anchor lives in. The
//     anchor stays a true-substring-unique string literal (that is the
//     versioning bet); the shape tells the AST walk which enclosing node is the
//     excision span, and which delegation to synthesize in its place.
//  2. `signature` — the structural fingerprint of the node that shape resolved
//     to, VERIFIED by hand at splice time. The walk takes the nearest enclosing
//     node of the declared shape, so without this an anchor that drifts into a
//     same-shaped nested helper silently excises the inner one. See
//     `TargetSignature` in ast.ts for what it is made of and why.
//  3. `captures` — every value the excised body took from its enclosing scope,
//     each CLASSIFIED per the §2.4 taxonomy and each RE-DERIVED from the
//     matched body per build. A derivation that cannot find its shape throws:
//     a silent fallback would build a delegation referencing nothing it needs.
//     The list is EXHAUSTIVE and machine-checked: the build derives the body's
//     free variables from the AST and refuses any mismatch in either direction
//     (`strangle/scope.ts`), so `captures: []` is the positive claim "verified
//     zero free variables", not an omission.
//  4. `coverage` — the corpus scenarios that exercise the splice, which is what
//     the gate's solo-sabotage phase turns red.
//
// The capture taxonomy is a claim about what the ADAPTER may do with a value,
// not a size class:
//   `primitive`      strings/numbers/frozen config. The owned module should own
//                    the value outright and the adapter equality-asserts the
//                    graph's against it — every delegation becomes a free
//                    micro-differential check.
//   `pure-helper`    a side-effect-free function. The owned module ships its own
//                    implementation and uses it in both wirings; the graph's
//                    function is neither called nor identity-compared.
//   `effectful-port` anything stateful, I/O-bearing, or whose far side is not
//                    yet owned. It stays an explicitly typed delegation
//                    argument documented in the owned module's header, and is a
//                    ledger edge to the wave that will own it.
//
// Classification and WIRING are separate facts. Most rows are still wired as a
// delegation argument regardless of class; the retrofit that makes
// `primitive`/`pure-helper` captures owned-and-asserted is W1's job (C4), and
// the classification here is the truthful input to that work. `owned: true`
// marks the captures where the retrofit has actually landed: the module ships
// the implementation, the build stops forwarding the graph's value, and the
// graph's function stops being called.
import type { TargetSignature } from "./ast.js";

export type TargetShape = "sibling-method" | "free-function" | "class-method" | "switch-case";

export type CaptureClass = "primitive" | "pure-helper" | "effectful-port";

export interface Capture {
  /** the owned module's parameter name — the documented contract for this value */
  as: string;
  /** §2.4 class: what the adapter is allowed to do with the graph's value */
  kind: CaptureClass;
  /**
   * Set on a `primitive`/`pure-helper` capture whose §2.4 retrofit has landed:
   * the owned module implements it and uses that implementation in BOTH
   * wirings, so the build derives and footprints the graph's binding (it is
   * still part of the closure surface §5 has to watch) but does not forward it.
   */
  owned?: true;
  /**
   * Recover the identifier (or member expression) from the ORIGINAL excised
   * body. Must throw when the expected shape is absent — see the header.
   */
  derive: (body: string) => string;
}

export interface Splice {
  /** key on globalThis.__reforge AND the modules/<name>[.sabotage].js basename */
  name: string;
  /** syntactic shape of the excision target (§2.1) */
  target: TargetShape;
  /** structural fingerprint of the node verified at splice time (see ast.ts) */
  signature: TargetSignature;
  /** true-substring-unique anchor inside the target node */
  anchor: string;
  /**
   * Optional SCOPE for an anchor that is not unique graph-wide: a second literal
   * that must occur in the same chunk, after which the anchor must be unique
   * among the chunks carrying both. Deliberately not a chunk NAME — chunk names
   * churn per pin and would break mechanical catch-up. See strangle/anchor.ts
   * for the full argument and the failure modes.
   */
  coLiteral?: string;
  /** delegation export name on globalThis.__reforge */
  fn: string;
  /** EVERY closure value the body takes from its scope, classified per §2.4 */
  captures: Capture[];
  /** corpus scenarios that exercise this node (the gate's targeted red-check) */
  coverage: string[];
}

/** A capture with its per-build identifier resolved — what the build actually wires. */
export interface DerivedCapture {
  as: string;
  kind: CaptureClass;
  owned: boolean;
  identifier: string;
}

const IDENT_EXPR = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/;

/** Re-derive a row's captured identifiers from a matched body. Shared by the build and the gate. */
export function deriveCaptures(sp: Splice, body: string): DerivedCapture[] {
  return sp.captures.map((c) => {
    const identifier = c.derive(body); // throws when the upstream shape moved
    if (!IDENT_EXPR.test(identifier)) {
      throw new Error(`${sp.name}: capture '${c.as}' derived ${JSON.stringify(identifier)}, which is not a binding`);
    }
    return { as: c.as, kind: c.kind, owned: c.owned === true, identifier };
  });
}

/** A derivation helper: one regex, one capture group, one loud failure. */
function pick(splice: string, as: string, re: RegExp): (body: string) => string {
  return (body) => {
    const m = body.match(re);
    if (!m || m[1] === undefined) throw new Error(`${splice}: could not derive '${as}' — ${re}`);
    return m[1];
  };
}

const ID = "[A-Za-z_$][\\w$]*";

export const SPLICES: Splice[] = [
  {
    name: "write-tool-result",
    target: "sibling-method",
    signature: { params: 2, ancestry: ["ObjectLiteralExpression", "SourceFile"] },
    // the Edit tool has a sibling "has been updated successfully" template; the
    // `.${` tail disambiguates the Write tool's
    anchor: "has been updated successfully.${",
    fn: "writeToolResultBlock",
    captures: [
      {
        // the freshness-suffix constant: `let s = r || n ? "" : <ident>`
        // (2.1.241 minified it `hui`; 2.1.251 `q6t` — hence derivation, not a constant)
        as: "freshnessSuffix",
        // a module-level string constant: ownable outright, so the adapter
        // should equality-assert it once W1 retrofits this splice.
        kind: "primitive",
        derive: pick(
          "write-tool-result",
          "freshnessSuffix",
          new RegExp(`${ID}\\s*=\\s*${ID}\\s*\\|\\|\\s*${ID}\\s*\\?\\s*"":\\s*(${ID})`),
        ),
      },
    ],
    coverage: ["file-tools"],
  },
  {
    name: "task-create-result",
    target: "sibling-method",
    signature: { params: 2, ancestry: ["ObjectLiteralExpression", "SourceFile"] },
    anchor: " created successfully: ",
    fn: "taskCreateResultBlock",
    // Verified zero free variables: the body reads only its own parameters.
    captures: [],
    coverage: ["todo-tool"],
  },
  {
    name: "glob-result",
    target: "sibling-method",
    signature: { params: 2, ancestry: ["ObjectLiteralExpression", "SourceFile"] },
    anchor: 'content:"No files found"};return',
    fn: "globResultBlock",
    captures: [
      {
        // the truncation-notice function: `...e.truncated?[<ident>(e)]:[]`
        // (2.1.241 `yzv`; 2.1.251 `APn`)
        as: "truncationNotice",
        // a formatter over the tool output — side-effect free, so the owned
        // module should ship its own copy rather than call the graph's.
        kind: "pure-helper",
        derive: pick("glob-result", "truncationNotice", new RegExp(`e\\.truncated\\?\\[(${ID})\\(e\\)\\]`)),
      },
    ],
    coverage: ["search-tools"],
  },

  // ---- W0a mechanism spikes: one real splice per new target shape ----------

  {
    // FREE-FUNCTION shape. The <env> block the engine stamps into a system
    // prompt. Anchored on its own template text, which is unique graph-wide.
    // Covered by `subagent`: the main headless system prompt does not carry an
    // env block, but a dispatched Agent's does — measured in the recorded
    // request bodies of m1-subagent.jsonl.
    name: "env-block",
    target: "free-function",
    signature: { params: 2, ancestry: ["SourceFile"] },
    anchor: "Is directory a git repo: ",
    fn: "envBlock",
    captures: [
      {
        as: "isGitRepo",
        kind: "effectful-port",
        derive: pick("env-block", "isGitRepo", new RegExp(`await Promise\\.all\\(\\[(${ID})\\(\\),${ID}\\(\\)\\]\\)`)),
      },
      {
        as: "osVersion",
        kind: "effectful-port",
        derive: pick("env-block", "osVersion", new RegExp(`await Promise\\.all\\(\\[${ID}\\(\\),(${ID})\\(\\)\\]\\)`)),
      },
      {
        as: "readDirectoryContext",
        kind: "effectful-port",
        derive: pick("env-block", "readDirectoryContext", new RegExp(`\\]\\),${ID}=(${ID})\\(e\\),`)),
      },
      {
        // Both sections are pure formatters over the context object
        // (chunk-fy12d89p.js @ 2.1.251: `$K`/`UK` interpolate `e.marketingName`
        // / `e.knowledgeCutoff` and return a string or null), so `pure-helper`.
        // `readDirectoryContext` above stays `effectful-port`: it reads the
        // model registry, which is populated at runtime.
        as: "primarySection",
        kind: "pure-helper",
        derive: (body) => sections("primarySection", body)[0],
      },
      {
        as: "secondarySection",
        kind: "pure-helper",
        derive: (body) => sections("secondarySection", body)[1],
      },
      {
        as: "extraEnvLines",
        kind: "effectful-port",
        derive: pick("env-block", "extraEnvLines", new RegExp(`,${ID}=(${ID})\\(\\);return\`Here is useful information`)),
      },
      {
        as: "cwd",
        kind: "effectful-port",
        derive: pick("env-block", "cwd", new RegExp(`Working directory: \\$\\{(${ID})\\(\\)\\}`)),
      },
      {
        as: "shellLine",
        kind: "effectful-port",
        derive: pick("env-block", "shellLine", new RegExp(`\\n\\$\\{(${ID})\\(\\)\\}\\nOS Version:`)),
      },
      {
        // a plain string read out of the platform shim. Not ownable (it IS the
        // environment), so it crosses as data rather than as an asserted constant.
        as: "platform",
        kind: "effectful-port",
        derive: pick("env-block", "platform", new RegExp(`Platform: \\$\\{(${ID}\\.${ID})\\}`)),
      },
    ],
    coverage: ["subagent"],
  },

  {
    // SWITCH-CASE shape. The `text_delta` arm of the streaming assembler's
    // delta switch: every streamed character of assistant text lands here, so
    // the plainest scenario in the corpus covers it and sabotage is visible in
    // the transcript immediately.
    //
    // The first switch-case target tried here — the engine's `interrupt` intent
    // clause in chunk-g461tywa — was excised and boot-checked cleanly but its
    // sabotage stayed GREEN: that switch belongs to the interactive engine
    // driver, and headless `Query.interrupt()` lands in print mode's if/else
    // chain instead. A splice nothing reaches is dead code, so it was dropped
    // rather than kept as an ungated row.
    name: "text-delta",
    target: "switch-case",
    signature: { params: 0, ancestry: ["SwitchStatement", "SwitchStatement", "FunctionDeclaration", "SourceFile"] },
    anchor: "content_block_type_mismatch_text",
    fn: "appendTextDelta",
    captures: [
      {
        as: "block",
        kind: "effectful-port",
        derive: pick("text-delta", "block", new RegExp(`if\\((${ID})\\.type!=="text"\\)throw`)),
      },
      {
        as: "delta",
        kind: "effectful-port",
        derive: pick("text-delta", "delta", new RegExp(`\\+=(${ID})\\.text;break`)),
      },
      {
        as: "recordStreamingError",
        kind: "effectful-port",
        derive: pick("text-delta", "recordStreamingError", new RegExp(`throw (${ID})\\("tengu_streaming_error"`)),
      },
      {
        // `known`/`describe` are the telemetry sanitizers. Upstream
        // (chunk-9rhc0mtn.js @ 2.1.251) they are `function w(n){return r(n)}` /
        // `function c(n){return r(n)}` over `function r(n){return n}` — an
        // erased type brand, identity at runtime. So they are `pure-helper`,
        // not `effectful-port`; the owned module ships them and neither calls
        // nor identity-compares the graph's (§2.4), which is why they are
        // `owned` and the build does not forward them.
        as: "known",
        kind: "pure-helper",
        owned: true,
        derive: pick("text-delta", "known", new RegExp(`error_type:(${ID})\\("content_block_type_mismatch_text"\\)`)),
      },
      {
        as: "describe",
        kind: "pure-helper",
        owned: true,
        derive: pick("text-delta", "describe", new RegExp(`actual_type:(${ID})\\(${ID}\\.type\\)`)),
      },
    ],
    coverage: ["plain"],
  },

  {
    // CLASS-METHOD shape. The transcript store's session-file materializer —
    // the step that turns a session's buffered entries into the on-disk
    // transcript, so `resume` cannot find its predecessor without it. Chosen
    // over the Bash executor (the census's suggestion) because that class keeps
    // its whole state in PRIVATE fields, which are unreachable from a delegated
    // module; see the note in ast.ts.
    name: "session-materialize",
    target: "class-method",
    signature: { params: 1, ancestry: ["ClassDeclaration", "SourceFile"] },
    anchor: "Session file materialize failed (",
    fn: "materializeSessionFile",
    captures: [
      {
        // errorCode / isExpected / formatError are pure predicates over the
        // caught value (chunk-qr1avfxy.js @ 2.1.251: `n.code` extraction, an
        // `errno` typeof test, `n instanceof Error?n.message:String(n)`), so
        // they are `pure-helper`. Still forwarded: owning them is W1's retrofit
        // (C4), and the classification is that work's input.
        as: "errorCode",
        kind: "pure-helper",
        derive: pick("session-materialize", "errorCode", new RegExp(`\\}catch\\(t\\)\\{let ${ID}=(${ID})\\(t\\);if\\(`)),
      },
      {
        as: "isExpected",
        kind: "pure-helper",
        derive: pick("session-materialize", "isExpected", new RegExp(`\\}catch\\(t\\)\\{let ${ID}=${ID}\\(t\\);if\\((${ID})\\(t\\)\\)`)),
      },
      {
        as: "logLine",
        kind: "effectful-port",
        derive: pick("session-materialize", "logLine", new RegExp(`(${ID})\\(\`Session file materialize failed \\(`)),
      },
      {
        as: "formatError",
        kind: "pure-helper",
        derive: pick(
          "session-materialize",
          "formatError",
          new RegExp(`Session file materialize failed \\(\\$\\{${ID}\\}\\): \\$\\{(${ID})\\(t\\)\\}`),
        ),
      },
      {
        as: "reportError",
        kind: "effectful-port",
        derive: pick(
          "session-materialize",
          "reportError",
          new RegExp(`\\{level:"error"\\}\\);else (${ID})\\(t\\);${ID}\\(this\\.store\\.writerHealth`),
        ),
      },
      {
        as: "recordWriterHealth",
        kind: "effectful-port",
        derive: pick(
          "session-materialize",
          "recordWriterHealth",
          new RegExp(`(${ID})\\(this\\.store\\.writerHealth,"materialize"`),
        ),
      },
    ],
    coverage: ["resume"],
  },
];

/**
 * The env block reads two sections out of the same directory-context value
 * (`d=$K(u)` and later `C=UK(u)`), so both derivations share one scan: find the
 * local the context was bound to, then the two functions applied to it in order.
 */
function sections(as: string, body: string): [string, string] {
  const local = body.match(new RegExp(`\\]\\),(${ID})=${ID}\\(e\\),`))?.[1];
  if (!local) throw new Error(`env-block: could not derive '${as}' — no directory-context binding`);
  const applied = [...body.matchAll(new RegExp(`=(${ID})\\(${local}\\)`, "g"))].map((m) => m[1]);
  if (applied.length < 2) throw new Error(`env-block: could not derive '${as}' — expected two sections over ${local}, got ${applied.length}`);
  return [applied[0], applied[1]];
}
