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
// Classification and WIRING both follow from the class, and they are NOT the
// same rule for the two owned classes (C4 / W1 completed this retrofit):
//
//   `pure-helper`    carries `owned: true`. The module ships the implementation
//                    and uses it in both wirings, so the build derives and
//                    FOOTPRINTS the graph's binding — §5 still has to see it
//                    move — but does not forward it. The graph's function is
//                    never called.
//   `primitive`      is still FORWARDED, deliberately. The module owns the value
//                    and uses its own copy; the graph's copy crosses only so the
//                    adapter can equality-assert it, which is what turns every
//                    delegation into a free micro-differential check. A value
//                    change that leaves the name alone moves no anchor and no
//                    target hash, so this assertion is the only cheap thing that
//                    can see it. `owned` therefore stays UNSET on a primitive.
//   `effectful-port` is forwarded and stays a typed delegation argument.
import type { TargetSignature } from "./ast.js";

export type TargetShape = "sibling-method" | "free-function" | "class-method" | "switch-case" | "arrow-initializer" | "variable-declarator";

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
  /**
   * How many nodes of the resolved chunk carry the anchor, verified at splice
   * time. Default 1 — the rule that has always held. A row that declares more
   * is asking `signature` to SELECT among them (strangle/anchor.ts,
   * `selectExcision` in ast.ts); a signature that cannot separate them is a tie
   * and fails the build.
   */
  siblings?: number;
  /** delegation export name on globalThis.__reforge */
  fn: string;
  /**
   * `variable-declarator` rows only: the written carve-out for an initializer
   * that is not a plain literal, so the build cannot compare the owned value
   * against the pinned chunk's bytes.
   *
   * The comparison is the whole reason this shape exists — a constant whose
   * VALUE moves while its name stays put moves no anchor, no target hash and no
   * capture hash — so losing it is an adjudication, not a fallback. Absent, a
   * non-literal initializer FAILS the build; present, the reason is printed
   * every build and must name what grades the value instead. Same bargain
   * `darkReason` strikes for a chunk export the corpus cannot observe.
   */
  valueUngraded?: string;
  /** EVERY closure value the body takes from its scope, classified per §2.4 */
  captures: Capture[];
  /** corpus scenarios that exercise this node (the gate's targeted red-check) */
  coverage: string[];
  /**
   * Required when `coverage` is empty: WHY no corpus scenario can observe this
   * splice, and what grades it instead. Reviewed, not a skip.
   *
   * The affordance already existed one row-type over — a chunk REPLACEMENT's
   * per-export acceptance has carried `darkReason` since W2 (§2.2), because a
   * retained export the corpus cannot reach still has to be adjudicated rather
   * than left silent. A splice could not say the same thing, so the only
   * available answer for a function measured dark was to UN-SPLICE it, which is
   * what C9 did three times. That is the right answer when the function has no
   * observable effect at all. It is the wrong one when the function has a real
   * effect the corpus simply never CREATES — the "OPEN with a named condition"
   * family rather than the dead one — because un-splicing then trades owned
   * bytes for nothing.
   *
   * The bar is the same as the chunk-export one and it is deliberately high: the
   * reason must name the POPULATION it was measured over, the INVERTED twin that
   * was tried before the verdict, and the surface that grades the function
   * instead. `assertManifest` below refuses an empty coverage without one, and
   * refuses a reason alongside a non-empty coverage — a row may not hold both.
   */
  darkReason?: string;
  /**
   * THE POPULATION THE DARKNESS WAS MEASURED OVER, as scenario tags — and the
   * thing that gives `darkReason` runtime teeth.
   *
   * Without this, darkness was measured ONCE, in prose, by whoever wrote the
   * row, and never re-measured: the gate pushed a pass and skipped the build
   * entirely, so the day a scenario created the firing condition the row would
   * stay "dark, adjudicated" while running live and ungraded. A reason nothing
   * re-runs is an assertion, not a measurement — the same shape as a check
   * nobody runs (C6's X7 finding), one level in.
   *
   * So the liveness loop BUILDS the dark row's sabotage like any other, replays
   * exactly these tags, and requires every one of them GREEN. A twin that goes
   * RED means the corpus now reaches the function, and the gate fails loudly as
   * "no longer dark" rather than passing on last month's prose.
   *
   * The tags are not the row's coverage — a dark row has none by definition.
   * They are the scenarios that WOULD see the effect if the firing condition
   * ever occurred, which is exactly the population the reason claims to have
   * checked. `manifestViolations` requires them alongside a reason, in both
   * directions.
   */
  darkOver?: string[];
}

// ============================================================================
// S-CHUNK (§2.2) — whole-chunk ownership. A parallel manifest, because the unit
// is different: a splice row claims ONE node inside a chunk upstream still owns;
// a chunk row claims the whole FILE, so its schema is about the export surface
// rather than about one body's captures. The mechanism, its derivation rules and
// its refusals live in strangle/chunk.ts.
// ============================================================================

/** One binding of the original chunk — an export or an import — re-derived per build. */
export interface ChunkBinding {
  /** the handle the manifest and the replacement refer to it by */
  as: string;
  /** §2.4 class. For an export it describes what the OWNED module provides. */
  kind: CaptureClass;
  /** recover the minified identifier from the ORIGINAL chunk source; must throw when the shape moved */
  derive: (source: string) => string;
}

export interface ChunkExportSpec extends ChunkBinding {
  /** the owned binding in `<module>/reference.js` (or `sabotage.js`) this export is bound to */
  owned: string;
  /**
   * For a constant export: recover its VALUE from the pinned chunk. The build
   * compares it against the owned module's live export, which is the entire
   * parity claim for a constant no scenario renders (chunk.ts rule 5).
   */
  value?: (source: string) => string;
  /** how the replacement declares this export, given the derived name, the owned binding and a port lookup */
  declare: (name: string, owned: string, port: (as: string) => string) => string;
  /** corpus scenarios that make THIS export observable (§2.2 per-export acceptance) */
  coverage: string[];
  /** required when `coverage` is empty: why the corpus cannot observe it, reviewed */
  darkReason?: string;
  /**
   * The population the darkness was measured over — see `Splice.darkOver`. The
   * gate flattens splices and chunk exports into ONE liveness loop, so the
   * runtime teeth are the same code and the obligation is the same obligation.
   */
  darkOver?: string[];
}

export interface ChunkReplacement {
  /** row name; also the `--sabotage <name>:<export>` prefix */
  name: string;
  /** true-substring-unique literal that identifies the chunk (never its NAME — see anchor.ts) */
  anchor: string;
  coLiteral?: string;
  /** the owned module directory under strangle/modules/ */
  module: string;
  exports: ChunkExportSpec[];
  imports: ChunkBinding[];
  /** owned bindings the prologue needs, by path relative to strangle/modules/ */
  helpers?: { from: string; names: string[] }[];
  /** statements emitted before the declarations — the `primitive` equality assertions */
  prologue?: (port: (as: string) => string) => string;
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

const SIBLING_METHOD: TargetSignature = { params: 2, ancestry: ["ObjectLiteralExpression", "SourceFile"] };

export const SPLICES: Splice[] = [
  // ---- tool-result formatters (subsystem/tool-result-formatters) -----------
  // Ten of the graph's 44 `mapToolResultToToolResultBlockParam` methods. All
  // share one shape and one signature; each is anchored on prose only it emits.

  {
    name: "write-tool-result",
    target: "sibling-method",
    signature: SIBLING_METHOD,
    // the Edit tool has a sibling "has been updated successfully" template; the
    // `.${` tail disambiguates the Write tool's
    anchor: "has been updated successfully.${",
    fn: "writeToolResultBlock",
    captures: [
      {
        // the freshness-suffix constant: `let s = r || n ? "" : <ident>`
        // (2.1.241 minified it `hui`; 2.1.251 `q6t` — hence derivation, not a constant)
        as: "freshnessSuffix",
        // Owned as `FRESHNESS_SUFFIX` in modules/shared/file-state.js and shared
        // with the Edit formatter; still forwarded so the adapter can assert it.
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
    // The Edit tool's SUCCESS formatter. Its error results ("String to replace
    // not found in file.", "File has not been read yet.") come from a different
    // sibling method — `validateInput`, 3,317 minified chars with filesystem,
    // gate and telemetry captures — which is its own closure-ledger row
    // (subsystem/tool-result-validators) and deliberately not this wave's.
    name: "edit-tool-result",
    target: "sibling-method",
    signature: SIBLING_METHOD,
    anchor: "All occurrences were successfully replaced.",
    fn: "editToolResultBlock",
    captures: [
      {
        // the same constant the Write row derives, at a DIFFERENT use site: Edit
        // nests it in a three-way conditional, so it needs its own shape.
        as: "freshnessSuffix",
        kind: "primitive",
        derive: pick("edit-tool-result", "freshnessSuffix", new RegExp(`\\?"":(${ID});if\\(`)),
      },
    ],
    coverage: ["edit-tool"],
  },

  {
    name: "read-tool-result",
    target: "sibling-method",
    signature: SIBLING_METHOD,
    anchor: "PDF pages extracted: ",
    fn: "readToolResultBlock",
    captures: [
      {
        as: "notebookResultBlock",
        kind: "pure-helper",
        owned: true,
        derive: pick("read-tool-result", "notebookResultBlock", new RegExp(`case"notebook":return\\s*(${ID})\\(`)),
      },
      {
        // a single-export chunk (chunk-n2te6bm7.js): pure bytes -> "12.3KB".
        // Shared with the Bash formatter, so it is owned in modules/shared/.
        as: "formatBytes",
        kind: "pure-helper",
        owned: true,
        derive: pick(
          "read-tool-result",
          "formatBytes",
          new RegExp(`PDF file read: \\$\\{${ID}\\.file\\.filePath\\} \\(\\$\\{(${ID})\\(`),
        ),
      },
      {
        as: "seededUnchangedNotice",
        kind: "pure-helper",
        owned: true,
        derive: pick("read-tool-result", "seededUnchangedNotice", new RegExp(`==="seeded"\\?(${ID})\\(`)),
      },
      {
        as: "unchangedNotice",
        kind: "pure-helper",
        owned: true,
        derive: pick("read-tool-result", "unchangedNotice", new RegExp(`:(${ID})\\(\\)\\};case"text"`)),
      },
      {
        // A WeakMap + clock side channel, not an argument: upstream populates the
        // map during the Read tool's `call` for memory-directory files and renders
        // a day count from `Date.now()`. Stateful and time-dependent, so it stays
        // a typed port and a ledger edge to the Read-execution wave.
        as: "stalenessPrefix",
        kind: "effectful-port",
        derive: pick("read-tool-result", "stalenessPrefix", new RegExp(`\\.content\\)${ID}=(${ID})\\(`)),
      },
      {
        as: "numberLines",
        kind: "pure-helper",
        owned: true,
        derive: pick(
          "read-tool-result",
          "numberLines",
          new RegExp(`\\+(${ID})\\(\\{\\.\\.\\.${ID}\\.file,tabAwareSeparator:`),
        ),
      },
      {
        // a feature-gate read (`tengu_tab_read_sep`), resolving to its compiled-in
        // default under the pinned disabled-gate environment (§3.3). Kept a port
        // rather than folded to `false` so a flip stays observable.
        as: "tabAwareSeparator",
        kind: "effectful-port",
        derive: pick("read-tool-result", "tabAwareSeparator", new RegExp(`tabAwareSeparator:(${ID})\\(\\)\\}`)),
      },
      {
        as: "numberOneLine",
        kind: "pure-helper",
        owned: true,
        derive: pick("read-tool-result", "numberOneLine", new RegExp(`\\+(${ID})\\(""`)),
      },
    ],
    coverage: ["file-tools"],
  },

  {
    // The one row in the manifest whose anchor is NOT unique graph-wide: the
    // same abort marker appears in the Windows/PowerShell sibling tool, in every
    // bundle measured. Scoped by a co-occurring literal taken from the SAME
    // object literal as the target — see strangle/anchor.ts for why that is a
    // literal and never a chunk name.
    name: "bash-tool-result",
    target: "sibling-method",
    signature: SIBLING_METHOD,
    anchor: "<error>Command was aborted before completion</error>",
    coLiteral: "Run shell command",
    fn: "bashToolResultBlock",
    captures: [
      {
        as: "imageResultBlock",
        kind: "pure-helper",
        owned: true,
        derive: pick(
          "bash-tool-result",
          "imageResultBlock",
          new RegExp(`=(${ID})\\(${ID},${ID}\\);if\\(${ID}\\)\\{let ${ID}=typeof`),
        ),
      },
      {
        as: "splitPreview",
        kind: "pure-helper",
        owned: true,
        derive: pick(
          "bash-tool-result",
          "splitPreview",
          new RegExp(`\\{let ${ID}=(${ID})\\(${ID},${ID}\\);${ID}=${ID}\\(\\{filepath:`),
        ),
      },
      {
        // `var $De=2000` — the persisted-output preview budget.
        as: "previewBytes",
        kind: "primitive",
        derive: pick(
          "bash-tool-result",
          "previewBytes",
          new RegExp(`\\{let ${ID}=${ID}\\(${ID},(${ID})\\);${ID}=${ID}\\(\\{filepath:`),
        ),
      },
      {
        as: "persistedOutputNotice",
        kind: "pure-helper",
        owned: true,
        derive: pick("bash-tool-result", "persistedOutputNotice", new RegExp(`=(${ID})\\(\\{filepath:`)),
      },
      {
        // `var kK = "\n"` — the separator between stderr and the abort marker.
        as: "newline",
        kind: "primitive",
        derive: pick(
          "bash-tool-result",
          "newline",
          new RegExp(`\\+=(${ID});${ID}\\+="<error>Command was aborted`),
        ),
      },
      {
        as: "backgroundNotice",
        kind: "pure-helper",
        owned: true,
        derive: pick("bash-tool-result", "backgroundNotice", new RegExp(`=(${ID})\\(\\{backgroundTaskId:`)),
      },
      {
        // `var _t="Read"` — the Read tool's name, as it appears in prose.
        as: "readToolName",
        kind: "primitive",
        derive: pick("bash-tool-result", "readToolName", new RegExp(`readToolName:(${ID})\\}`)),
      },
      {
        // `function FE(){return!1}` — a constant in this build, but a POLICY
        // predicate by nature, so it is owned as a predicate and the branch it
        // guards is kept rather than folded away.
        as: "useTaskAck",
        kind: "pure-helper",
        owned: true,
        derive: pick("bash-tool-result", "useTaskAck", new RegExp(`if\\((${ID})\\(\\)\\)return\\{tool_use_id`)),
      },
      {
        // reads the live background output-path registry + session dir.
        as: "backgroundOutputPath",
        kind: "effectful-port",
        derive: pick("bash-tool-result", "backgroundOutputPath", new RegExp(`outputPath:(${ID})\\(`)),
      },
      {
        // reaches a gate and the configured Bash timeout through a helper.
        as: "taskAckEnvelope",
        kind: "effectful-port",
        derive: pick("bash-tool-result", "taskAckEnvelope", new RegExp(`content:(${ID})\\(${ID},\\[`)),
      },
      {
        as: "taskAckEnding",
        kind: "effectful-port",
        derive: pick("bash-tool-result", "taskAckEnding", new RegExp(`ending:(${ID})\\(`)),
      },
    ],
    // Solo-sabotaging this one reddens FOUR scenarios, not one: every scenario
    // that runs a Bash command reads its result back. All four are listed so the
    // expected-RED set is not mistaken for a regression.
    coverage: ["bash-tool", "hooks", "partial-tool-args", "parallel-tools"],
  },

  {
    name: "grep-tool-result",
    target: "sibling-method",
    signature: SIBLING_METHOD,
    anchor: '"occurrence":"occurrences"',
    fn: "grepToolResultBlock",
    captures: [
      {
        as: "paginationNote",
        kind: "pure-helper",
        owned: true,
        derive: pick("grep-tool-result", "paginationNote", new RegExp(`"content"\\)\\{let ${ID}=(${ID})\\(`)),
      },
      {
        // `k(n, singular, plural = singular + "s")` from chunk-04aem4bh.js.
        as: "plural",
        kind: "pure-helper",
        owned: true,
        derive: pick("grep-tool-result", "plural", new RegExp(`\\$\\{(${ID})\\(${ID},"file"\\)\\}`)),
      },
    ],
    coverage: ["search-tools"],
  },

  {
    name: "glob-result",
    target: "sibling-method",
    signature: SIBLING_METHOD,
    anchor: 'content:"No files found"};return',
    fn: "globResultBlock",
    captures: [
      {
        // the truncation-notice function: `...e.truncated?[<ident>(e)]:[]`
        // (2.1.241 `yzv`; 2.1.251 `APn`). Owned since C4; the corpus never
        // truncates, so its three outputs are graded by the contract test.
        as: "truncationNotice",
        kind: "pure-helper",
        owned: true,
        derive: pick("glob-result", "truncationNotice", new RegExp(`e\\.truncated\\?\\[(${ID})\\(e\\)\\]`)),
      },
    ],
    coverage: ["search-tools"],
  },

  {
    name: "task-create-result",
    target: "sibling-method",
    signature: SIBLING_METHOD,
    anchor: " created successfully: ",
    fn: "taskCreateResultBlock",
    // Verified zero free variables: the body reads only its own parameters.
    captures: [],
    coverage: ["todo-tool"],
  },

  {
    name: "task-get-result",
    target: "sibling-method",
    signature: SIBLING_METHOD,
    anchor: "Blocked by: ${",
    fn: "taskGetResultBlock",
    captures: [],
    coverage: ["task-family"],
  },

  {
    name: "task-list-result",
    target: "sibling-method",
    signature: SIBLING_METHOD,
    anchor: "No tasks found",
    fn: "taskListResultBlock",
    captures: [],
    coverage: ["task-family"],
  },

  {
    name: "task-update-result",
    target: "sibling-method",
    signature: SIBLING_METHOD,
    anchor: "Task completed. Call TaskList now",
    fn: "taskUpdateResultBlock",
    captures: [
      {
        // the session's agent/team identity (chunk-mk4am7jk.js).
        as: "agentTeamContext",
        kind: "effectful-port",
        derive: pick("task-update-result", "agentTeamContext", new RegExp(`\\?\\.to==="completed"&&(${ID})\\(\\)&&`)),
      },
      {
        // env CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS + the `tengu_amber_flint` gate
        // (chunk-9rtx6cwj.js). Both ports are false headlessly, so the completion
        // nudge they guard is DARK in the corpus — the contract test grades it.
        as: "agentTeamsEnabled",
        kind: "effectful-port",
        derive: pick("task-update-result", "agentTeamsEnabled", new RegExp(`==="completed"&&${ID}\\(\\)&&(${ID})\\(\\)\\)`)),
      },
    ],
    coverage: ["task-family"],
  },

  // ---- tool descriptions (subsystem/tool-descriptions) ---------------------
  // The three description functions whose chunks are NOT clean for whole-file
  // ownership (15 / 17 / 4 exports carrying real behaviour), so §2.2's fallback
  // applies and only the description function is excised. The fourth — Glob's —
  // sits in a chunk that IS clean, and is owned whole; see CHUNK_REPLACEMENTS.
  //
  // All four share one upstream shape: `leanPrompt(model) ? brief : full`. What
  // reaches the differential surface is the tool object's `prompt({model})`
  // method, which is what calls these; the sibling `description()` returns a
  // one-liner that never appears in a request.

  {
    name: "read-description",
    target: "free-function",
    signature: { params: 4, ancestry: ["SourceFile"] },
    anchor: "Assume this tool is able to read all files on the machine.",
    fn: "readDescription",
    captures: [
      {
        // `var jVe=2000` — the default line budget, in BOTH arms' prose.
        as: "lineBudget",
        kind: "primitive",
        derive: pick("read-description", "lineBudget", new RegExp(`- Reads up to \\$\\{(${ID})\\} lines by default`)),
      },
      {
        // `var n` — the "Do NOT re-read" tail both arms append.
        as: "noRereadNote",
        kind: "primitive",
        derive: pick("read-description", "noRereadNote", new RegExp(`rather than content\\.\\$\\{(${ID})\\}`)),
      },
      {
        as: "leanPrompt",
        kind: "effectful-port",
        derive: pick("read-description", "leanPrompt", new RegExp(`\\{if\\((${ID})\\(${ID}\\)\\)return\`Reads a file`)),
      },
      {
        // `BVe()` — `!at().toLowerCase().includes("claude-3-haiku")`, i.e. a read
        // of the SESSION model. Pure in form, runtime state in substance.
        as: "pdfCapable",
        kind: "effectful-port",
        derive: pick("read-description", "pdfCapable", new RegExp(`presents them visually\\.\\$\\{(${ID})\\(\\)\\?`)),
      },
    ],
    // Read's description is in 23 of the 24 scenarios' requests; `api-error` is
    // the one carrying the LEAN arm (its deliberately invalid model id falls
    // outside the lean-prompt family test). The pair is chosen to cover both
    // `leanPrompt` arms rather than to enumerate every red.
    coverage: ["plain", "api-error"],
  },

  {
    name: "grep-description",
    target: "free-function",
    signature: { params: 1, ancestry: ["SourceFile"] },
    anchor: "Content search built on ripgrep. Prefer this over",
    fn: "grepDescription",
    captures: [
      {
        as: "grepToolName",
        kind: "primitive",
        derive: pick("grep-description", "grepToolName", new RegExp(`- ALWAYS use \\$\\{(${ID})\\} for search tasks`)),
      },
      {
        as: "bashToolName",
        kind: "primitive",
        // The bundle escapes non-ASCII in its template literals, so the em dash
        // is the six characters of a \\u2014 escape in the SOURCE, not the character.
        derive: pick("grep-description", "bashToolName", new RegExp(`via \\$\\{(${ID})\\} \\\\u2014 results integrate`)),
      },
      {
        as: "agentToolName",
        kind: "primitive",
        derive: pick("grep-description", "agentToolName", new RegExp(`- Use \\$\\{(${ID})\\} tool \\(if available\\)`)),
      },
      {
        as: "leanPrompt",
        kind: "effectful-port",
        derive: pick("grep-description", "leanPrompt", new RegExp(`\\{if\\((${ID})\\(${ID}\\)\\)return\`Content search built`)),
      },
      {
        // latches on first call and emits telemetry when non-default.
        as: "subagentSteer",
        kind: "effectful-port",
        derive: pick("grep-description", "subagentSteer", new RegExp(`\\$\\{(${ID})\\(\\)==="default"\\?`)),
      },
    ],
    coverage: ["search-tools", "search-tools-lean"],
  },

  {
    name: "webfetch-description",
    target: "free-function",
    signature: { params: 2, ancestry: ["SourceFile"] },
    anchor: "Fetches a URL, converts the page to markdown, and answers",
    fn: "webFetchDescription",
    captures: [
      {
        as: "leanPrompt",
        kind: "effectful-port",
        derive: pick("webfetch-description", "leanPrompt", new RegExp(`\\{if\\((${ID})\\(${ID}\\)\\)return\`Fetches a URL`)),
      },
      {
        // `r()` renders "15 minutes" from a per-host memo over
        // CLAUDE_CODE_WEBFETCH_CACHE_TTL_MS (default 900000) — a port, and a
        // ledger edge to the WebFetch execution wave.
        as: "cacheTtlPhrase",
        kind: "effectful-port",
        derive: pick("webfetch-description", "cacheTtlPhrase", new RegExp(`- Responses are cached for \\$\\{(${ID})\\(\\)\\} per URL`)),
      },
      {
        // `u()` — the usage-notes block, i.e. description text, so it is owned.
        as: "usageNotes",
        kind: "pure-helper",
        owned: true,
        derive: pick("webfetch-description", "usageNotes", new RegExp(`\\$\\{(${ID})\\(\\)\\}\`\\}$`)),
      },
    ],
    coverage: ["plain", "api-error"],
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
        // / `e.knowledgeCutoff` and return a string or null), so `pure-helper`
        // — and owned since C4. `readDirectoryContext` above stays
        // `effectful-port`: it reads the model registry, populated at runtime.
        as: "primarySection",
        kind: "pure-helper",
        owned: true,
        derive: (body) => sections("primarySection", body)[0],
      },
      {
        as: "secondarySection",
        kind: "pure-helper",
        owned: true,
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
        // they are `pure-helper` — and owned since C4's retrofit.
        as: "errorCode",
        kind: "pure-helper",
        owned: true,
        derive: pick("session-materialize", "errorCode", new RegExp(`\\}catch\\(t\\)\\{let ${ID}=(${ID})\\(t\\);if\\(`)),
      },
      {
        as: "isExpected",
        kind: "pure-helper",
        owned: true,
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
        owned: true,
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

  {
    // GENERATOR shape (campaign spec C5x, unit 1) — the mechanism spike for
    // `async function*` targets, and W5's hard blocker: all eight per-event hook
    // dispatchers are async generators, so before this the hook-dispatch wave
    // had no target at all. `signature.generator` records what was verified;
    // ast.ts renders `return yield* …` rather than `return …`, which is the only
    // delegation that preserves a generator's three-part contract (the yielded
    // sequence, the completion value, and `next`/`throw`/`return` signalling).
    //
    // PostToolUse is the smallest of the eight (363 minified chars) and the
    // `hooks` scenario registers a PostToolUse callback, so it is live under
    // solo sabotage. The 23 KB shared executor it delegates to stays a port —
    // the scout flagged it S-module-shaped, and it belongs to W5's own cut.
    name: "post-tool-hooks",
    target: "free-function",
    signature: { params: 10, ancestry: ["SourceFile"], generator: true },
    anchor: 'hook_event_name:"PostToolUse"',
    fn: "postToolHooks",
    // Capture ORDER is the delegation's argument order after the parameters —
    // it must match the owned adapter's signature, and nothing but reading both
    // enforces that (a mismatch shows up as a faithful build going red, which is
    // how this row's first draft announced itself).
    captures: [
      {
        // `Ea` / createBaseHookInput: reads app state, the model registry and
        // the permission layers, so a port and a ledger edge to W5.
        as: "createBaseHookInput",
        kind: "effectful-port",
        derive: pick(
          "post-tool-hooks",
          "createBaseHookInput",
          new RegExp(`\\{\\.\\.\\.(${ID})\\(${ID}\\.session,${ID}\\(\\),${ID},${ID}\\),hook_event_name:"PostToolUse"`),
        ),
      },
      {
        // the same working-directory reader the env block captures.
        as: "cwd",
        kind: "effectful-port",
        derive: pick("post-tool-hooks", "cwd", new RegExp(`\\{\\.\\.\\.${ID}\\(${ID}\\.session,(${ID})\\(\\),`)),
      },
      {
        // `C=Li` — the parameter DEFAULT, evaluated in the chunk's scope and so
        // a free variable of the body. Forwarded (never used) so the adapter can
        // equality-assert it: 600000 changing to 300000 upstream would move no
        // anchor, no target hash and no capture-hash shape.
        as: "defaultHookTimeoutMs",
        kind: "primitive",
        derive: pick("post-tool-hooks", "defaultHookTimeoutMs", new RegExp(`,${ID}=(${ID}),${ID},${ID}\\)\\{let`)),
      },
      {
        // `jy` / executeHooks — itself an async generator, which is why the
        // owned module has to `yield*` it rather than await it.
        as: "executeHooks",
        kind: "effectful-port",
        derive: pick("post-tool-hooks", "executeHooks", new RegExp(`yield\\*(${ID})\\(\\{session:`)),
      },
    ],
    // `hooks` registers a PostToolUse CALLBACK; `hooks-command` registers a
    // command hook, which is the only scenario that grades this record as the
    // byte stream it is serialised into (W5 — the field order the module's
    // header calls behaviour rather than style).
    coverage: ["hooks", "hooks-command"],
  },

  {
    // ARROW-INITIALIZER shape (campaign spec C5x, unit 2) — the mechanism spike
    // for an arrow that initializes one declarator of a multi-declarator `var`,
    // and W6's other hard blocker: the permission chain's three entry points are
    // ONE statement (`Dd=…,kye=…,von=…`), so the excision has to take the arrow
    // and leave the neighbours, the commas and the `var` keyword alone.
    //
    // It is also the campaign's first SIBLING-DISAMBIGUATED row (unit 4). The
    // only literal inside `kye` is `decideLocation:"pre-ask"`, which its own
    // 11.6 KB neighbour `von` also stamps — same chunk, so a `coLiteral` cannot
    // help, and the two are both 7-parameter arrows at the same ancestry, so
    // `params` + `ancestry` tie. Their positions in the declaration list do not:
    // `declarator: 1` is what selects, and an upstream edit to the list makes the
    // build refuse rather than pick the 11.6 KB neighbour.
    name: "permission-decision",
    target: "arrow-initializer",
    signature: { params: 7, ancestry: ["SourceFile"], declarator: 1 },
    anchor: 'decideLocation:"pre-ask"',
    siblings: 2,
    fn: "permissionDecisionWithSink",
    captures: [
      {
        // `von` — the mode-aware decision body. Stateful (app state, denial
        // tracking, the ask path's promises), so a port and a ledger edge to W6.
        as: "decide",
        kind: "effectful-port",
        derive: pick("permission-decision", "decide", new RegExp(`let ${ID}=await (${ID})\\(${ID},`)),
      },
    ],
    coverage: ["permission-broker", "permission-bag"],
  },

  // ==========================================================================
  // W6 / C9 — the permission subsystem (subsystem/permissions).
  //
  // Read them as the decision's own order, because that is what they are:
  //
  //   permission-precheck        the ladder every headless tool call descends
  //   rule-based-permissions     the same ladder with the modes removed
  //   allow-rule-decision        what a matched ALLOW rule actually decides
  //   ask-rule-reason            was this ask forced by a user's rule?
  //   safety-check-reason        the objection no mode may override
  //   permission-message         the sentence a request is rendered as
  //   classifier-streak          whether the denial counter may be reset
  //   mode-change-guard          may this session move to that mode?
  //   mode-transition            what the move DOES
  //   set-permission-mode        the seam that joins those two
  //   permission-request-hook-decision  the hook that races the SDK host
  //   broker-response-map        the host's answer, turned back into a decision
  //   broker-permission-updates  which of its permission updates are accepted
  //   control-response-success   the envelope every success leaves through
  //   control-response-error     the envelope every refusal leaves through
  //
  // TWO NAMED GAPS, both §2.3 deferrals rather than omissions, both on the
  // ledger row: the 11.6 KB mode-aware body ABOVE the pre-check (`von` — a
  // classifier call, a mutable denial counter, sixty free variables) and the
  // broker's `createCanUseTool`, a class method closing over five mutable maps
  // on its receiver. A third, `Dd`, carries no string literal at all and is not
  // takeable by this mechanism; its whole body is two lines and both of its
  // neighbours are owned.
  {
    // The decision every headless tool call actually gets. One call site, and
    // that site runs on every tool call in every mode.
    //
    // ANCHOR: `Cannot call ${` is unique bundle-wide and lives in this body's
    // plan-mode MCP override. Prose rather than structure, which §2.1 measures
    // as the stronger kind — and the alternative here was `Permission to use ${`
    // at fifteen carriers in this chunk alone.
    //
    // THE PORT COUNT IS THE ROW'S PRICE, and it is recorded rather than
    // minimised: twenty-eight forwarded ports plus two owned helpers. Every one
    // is a free variable the AST derived and `strangle/scope.ts` machine-checks
    // in both directions, so the list cannot quietly go stale — but it is also
    // the measurement behind this wave's decision NOT to take the 11.6 KB body
    // above it, whose surface is twice as wide over mutable state.
    name: "permission-precheck",
    target: "free-function",
    signature: { params: 4, ancestry: ["SourceFile"] },
    anchor: "Cannot call ${",
    fn: "permissionPrecheck",
    captures: [
      {
        // `Ze` / AbortError — a CONSTRUCTOR, forwarded as a port because the
        // owned module has to `new` the graph's class for the caller's
        // `instanceof` checks to keep working.
        as: "AbortError",
        kind: "effectful-port",
        derive: pick("permission-precheck", "AbortError", new RegExp(`signal\\.aborted\\)throw new (${ID})`)),
      },
      {
        // `he` / getToolPermissionContext — reads app state.
        as: "toolPermissionContext",
        kind: "effectful-port",
        derive: pick("permission-precheck", "toolPermissionContext", new RegExp(`throw new ${ID};let ${ID}=(${ID})\\(${ID}\\),`)),
      },
      {
        as: "matchedToolDenyRule",
        kind: "effectful-port",
        derive: pick(
          "permission-precheck",
          "matchedToolDenyRule",
          new RegExp(`let ${ID}=${ID}\\(${ID}\\),${ID}=(${ID})\\(${ID},${ID}\\);if\\(${ID}\\)return\\{behavior:"deny"`),
        ),
      },
      {
        // `JF` — the input-rule matcher, called twice with different behaviors
        // ("deny" here, "ask" further down). One port, two uses.
        as: "matchedInputRule",
        kind: "effectful-port",
        derive: pick("permission-precheck", "matchedInputRule", new RegExp(`let ${ID}=(${ID})\\(${ID},${ID},${ID},"deny"\\)`)),
      },
      {
        as: "matchedToolAllowRule",
        kind: "effectful-port",
        derive: pick("permission-precheck", "matchedToolAllowRule", new RegExp(`let ${ID}=(${ID})\\(${ID},${ID}\\);if\\(${ID}\\)\\{let`)),
      },
      {
        as: "denyRuleMessage",
        kind: "effectful-port",
        derive: pick("permission-precheck", "denyRuleMessage", new RegExp(`rule:${ID}\\},message:(${ID})\\(${ID}\\.name,${ID}\\)\\}`)),
      },
      {
        // `ql` — the message builder, which this wave ALSO owns. Forwarded
        // rather than owned because this seam does not carry the four sub-ports
        // that module needs; the delegation reaches the strangled graph's copy,
        // which is the owned module behind its own adapter.
        as: "permissionMessage",
        kind: "effectful-port",
        derive: pick("permission-precheck", "permissionMessage", new RegExp(`behavior:"passthrough",message:(${ID})\\(${ID}\\.name\\)\\}`)),
      },
      {
        // `y7e` — the allow-rule decision, also owned by this wave, forwarded
        // for the same reason. Note the FOUR-argument call: the rule checker
        // passes a fifth (its options), this one does not.
        as: "allowRuleDecision",
        kind: "effectful-port",
        derive: pick("permission-precheck", "allowRuleDecision", new RegExp(`if\\(!${ID}&&!${ID}\\)return (${ID})\\(${ID},${ID},${ID},${ID}\\)\\}`)),
      },
      {
        as: "classifyToolError",
        kind: "effectful-port",
        derive: pick(
          "permission-precheck",
          "classifyToolError",
          new RegExp(`catch\\(${ID}\\)\\{let ${ID}=(${ID})\\(${ID},${ID},${ID},${ID}\\);if\\(${ID}!==void 0\\)`),
        ),
      },
      {
        // `Qe = "Bash"` — owned in shared/tool-names.js and asserted by the
        // adapter. The sandbox arm is Bash-only, so this literal decides which
        // tool gets it.
        as: "bashToolName",
        kind: "primitive",
        derive: pick("permission-precheck", "bashToolName", new RegExp(`${ID}\\.name===(${ID})&&${ID}\\.forRemoteExecution!==!0`)),
      },
      {
        // `pt` — the sandbox manager object, two methods read off it.
        as: "sandbox",
        kind: "effectful-port",
        derive: pick("permission-precheck", "sandbox", new RegExp(`&&(${ID})\\.isSandboxingEnabled\\(\\)`)),
      },
      {
        as: "bashAutoAllowable",
        kind: "effectful-port",
        derive: pick("permission-precheck", "bashAutoAllowable", new RegExp(`isAutoAllowBashIfSandboxedEnabled\\(\\)&&(${ID})\\(${ID}\\)`)),
      },
      {
        as: "sandboxConfirmed",
        kind: "effectful-port",
        derive: pick("permission-precheck", "sandboxConfirmed", new RegExp(`,${ID}=${ID}&&(${ID})\\(${ID}\\),${ID}=${ID}&&!${ID}`)),
      },
      {
        // `a` — the process environment reader.
        as: "env",
        kind: "effectful-port",
        derive: pick("permission-precheck", "env", new RegExp(`source==="mcpServerPolicy"&&(${ID})\\.CLAUDE_CODE_REMOTE`)),
      },
      {
        // `I` — the feature-gate resolver. Pinned to compiled-in defaults by
        // §3.3, so on this corpus it always answers with the call-site default.
        as: "featureGate",
        kind: "effectful-port",
        derive: pick("permission-precheck", "featureGate", new RegExp(`&&(${ID})\\("tengu_mcp_server_policy_bypass_exempt",!0\\)`)),
      },
      {
        // `kH` — the tool's EFFECTIVE mode, which is the session mode narrowed
        // by any MCP-server override. Called twice.
        as: "effectiveMode",
        kind: "effectful-port",
        derive: pick("permission-precheck", "effectiveMode", new RegExp(`CLAUDE_CODE_REMOTE&&(${ID})\\(${ID},${ID}\\)==="bypassPermissions"`)),
      },
      {
        as: "isReadOnlyMcpInput",
        kind: "effectful-port",
        derive: pick("permission-precheck", "isReadOnlyMcpInput", new RegExp(`\\.mode==="plan"&&!(${ID})\\(${ID}\\(${ID}\\),${ID}\\)`)),
      },
      {
        // `my` — the tool's rule identity, which is not always its name.
        as: "toolIdentity",
        kind: "effectful-port",
        derive: pick("permission-precheck", "toolIdentity", new RegExp(`\\.mode==="plan"&&!${ID}\\((${ID})\\(${ID}\\),${ID}\\)`)),
      },
      {
        as: "organizationAskReason",
        kind: "primitive",
        derive: pick(
          "permission-precheck",
          "organizationAskReason",
          new RegExp(`effectiveMaxPermission==="ask"\\)\\{let ${ID}=\\{type:"other",reason:(${ID})\\}`),
        ),
      },
      {
        // `hTt` / isBypassImmuneCircuitBreaker — the FILTER the safety-check
        // finder is given under bypass. It is what makes the floor asymmetric.
        as: "bypassImmuneSafetyCheck",
        kind: "effectful-port",
        derive: pick("permission-precheck", "bypassImmuneSafetyCheck", new RegExp(`\\?${ID}\\(${ID}\\.decisionReason,(${ID})\\):void 0`)),
      },
      {
        as: "isPlanModeFloor",
        kind: "effectful-port",
        derive: pick("permission-precheck", "isPlanModeFloor", new RegExp(`==="sandboxOverride"\\|\\|(${ID})\\(${ID}\\.decisionReason\\)`)),
      },
      {
        // `u7e` — the input an allow carries: the tool's rewrite when there is
        // one, the raw input otherwise. Both allow arms use it.
        as: "resolvedInput",
        kind: "effectful-port",
        derive: pick(
          "permission-precheck",
          "resolvedInput",
          new RegExp(`return\\{behavior:"allow",updatedInput:(${ID})\\(${ID},${ID}\\),decisionReason:\\{type:"mode"`),
        ),
      },
      {
        as: "wholeToolAllowRule",
        kind: "effectful-port",
        derive: pick(
          "permission-precheck",
          "wholeToolAllowRule",
          new RegExp(`let ${ID}=(${ID})\\(${ID}\\(${ID}\\),${ID}\\);if\\(${ID}&&${ID}\\.ignoresWholeToolAllowRule`),
        ),
      },
      {
        as: "isChromeTool",
        kind: "effectful-port",
        derive: pick("permission-precheck", "isChromeTool", new RegExp(`!==!0&&!\\((${ID})\\(${ID}\\(${ID}\\)\\)&&`)),
      },
      {
        as: "chromeClassifierApplies",
        kind: "effectful-port",
        derive: pick("permission-precheck", "chromeClassifierApplies", new RegExp(`&&\\((${ID})\\(${ID}\\(${ID}\\)\\)\\|\\|${ID}\\(${ID}\\)\\.chromeClassifierFloorEnabled`)),
      },
      {
        as: "ruleScopedAway",
        kind: "effectful-port",
        derive: pick("permission-precheck", "ruleScopedAway", new RegExp(`chromeClassifierFloorEnabled===!0\\)\\)&&!(${ID})\\(${ID},${ID},${ID},${ID}\\)\\)`)),
      },
      {
        as: "log",
        kind: "effectful-port",
        derive: pick("permission-precheck", "log", new RegExp(`${ID}\\.suggestions\\)(${ID})\\(\`Permission suggestions`)),
      },
      {
        as: "stringify",
        kind: "effectful-port",
        derive: pick("permission-precheck", "stringify", new RegExp(`Permission suggestions for \\$\\{${ID}\\.name\\}: \\$\\{(${ID})\\(${ID}\\.suggestions,null,2\\)\\}`)),
      },
      {
        // OWNED (§2.4): the ask-rule predicate. Upstream keeps four other
        // callers, so its own splice stays live.
        as: "isAskRuleDrivenReason",
        kind: "pure-helper",
        owned: true,
        derive: pick(
          "permission-precheck",
          "isAskRuleDrivenReason",
          new RegExp(`==="ask"&&(${ID})\\(${ID}\\.decisionReason\\)\\)return ${ID};if\\(${ID}\\.mcpInfo`),
        ),
      },
      {
        // OWNED (§2.4): the safety-check finder, used twice here — once with the
        // bypass-immune filter and once bare. Upstream keeps fifteen other
        // callers.
        as: "findSafetyCheckReason",
        kind: "pure-helper",
        owned: true,
        derive: pick("permission-precheck", "findSafetyCheckReason", new RegExp(`\\?(${ID})\\(${ID}\\.decisionReason,${ID}\\):void 0`)),
      },
    ],
    coverage: ["bash-tool", "permission-bag"],
  },

  {
    // The same ladder with the modes removed. Eight call sites across five
    // chunks; the one this wave can reach is the PermissionRequest hook seam,
    // which re-checks a hook's rewritten input against the rules.
    //
    // ANCHOR: `crashIsObjection===!0` has exactly two carriers, both in this
    // chunk — this and the allow-rule decision it delegates to — and the two are
    // separated by parameter count. `siblings: 2` makes an anchor that quietly
    // stopped being a pair fail loudly rather than pick the other one.
    name: "rule-based-permissions",
    target: "free-function",
    signature: { params: 4, ancestry: ["SourceFile"] },
    anchor: "crashIsObjection===!0",
    siblings: 2,
    fn: "checkRuleBasedPermissions",
    captures: [
      {
        as: "toolPermissionContext",
        kind: "effectful-port",
        derive: pick(
          "rule-based-permissions",
          "toolPermissionContext",
          new RegExp(`\\)\\{let ${ID}=(${ID})\\(${ID}\\),${ID}=${ID}\\(${ID},${ID}\\);if\\(${ID}\\)return\\{behavior:"deny"`),
        ),
      },
      {
        as: "matchedToolDenyRule",
        kind: "effectful-port",
        derive: pick(
          "rule-based-permissions",
          "matchedToolDenyRule",
          new RegExp(`let ${ID}=${ID}\\(${ID}\\),${ID}=(${ID})\\(${ID},${ID}\\);if\\(${ID}\\)return\\{behavior:"deny"`),
        ),
      },
      {
        as: "matchedInputRule",
        kind: "effectful-port",
        derive: pick("rule-based-permissions", "matchedInputRule", new RegExp(`let ${ID}=(${ID})\\(${ID},${ID},${ID},"deny"\\)`)),
      },
      {
        as: "matchedToolAllowRule",
        kind: "effectful-port",
        derive: pick("rule-based-permissions", "matchedToolAllowRule", new RegExp(`let ${ID}=(${ID})\\(${ID},${ID}\\);if\\(${ID}\\)\\{let`)),
      },
      {
        as: "denyRuleMessage",
        kind: "effectful-port",
        derive: pick("rule-based-permissions", "denyRuleMessage", new RegExp(`rule:${ID}\\},message:(${ID})\\(${ID}\\.name,${ID}\\)\\}`)),
      },
      {
        as: "permissionMessage",
        kind: "effectful-port",
        derive: pick("rule-based-permissions", "permissionMessage", new RegExp(`behavior:"passthrough",message:(${ID})\\(${ID}\\.name\\)\\}`)),
      },
      {
        // The FIVE-argument call: this one passes its options through, so the
        // crash arm reaches one level further down than the pre-check's does.
        as: "allowRuleDecision",
        kind: "effectful-port",
        derive: pick("rule-based-permissions", "allowRuleDecision", new RegExp(`\\)\\)return (${ID})\\(${ID},${ID},${ID},${ID},${ID}\\)\\}`)),
      },
      {
        as: "classifyToolError",
        kind: "effectful-port",
        derive: pick("rule-based-permissions", "classifyToolError", new RegExp(`catch\\(${ID}\\)\\{let ${ID}=(${ID})\\(${ID},${ID},${ID},${ID}\\)`)),
      },
      {
        // Scoped to the CRASH arm's own guard. `{type:"other",reason:X}` appears
        // twice in this body — here and at the MCP ask ceiling — and a regex that
        // matched either would keep resolving after this binding was renamed,
        // which `strangle/perturb.ts` caught as a SILENT derivation.
        as: "crashReason",
        kind: "primitive",
        derive: pick(
          "rule-based-permissions",
          "crashReason",
          new RegExp(`crashIsObjection===!0\\)\\{let ${ID}=\\{type:"other",reason:(${ID})\\}`),
        ),
      },
      {
        as: "bashToolName",
        kind: "primitive",
        derive: pick("rule-based-permissions", "bashToolName", new RegExp(`${ID}\\.name===(${ID})&&${ID}\\.forRemoteExecution!==!0`)),
      },
      {
        as: "sandbox",
        kind: "effectful-port",
        derive: pick("rule-based-permissions", "sandbox", new RegExp(`&&(${ID})\\.isSandboxingEnabled\\(\\)`)),
      },
      {
        as: "bashAutoAllowable",
        kind: "effectful-port",
        derive: pick("rule-based-permissions", "bashAutoAllowable", new RegExp(`isAutoAllowBashIfSandboxedEnabled\\(\\)&&(${ID})\\(${ID}\\)`)),
      },
      {
        as: "sandboxConfirmed",
        kind: "effectful-port",
        derive: pick("rule-based-permissions", "sandboxConfirmed", new RegExp(`,${ID}=${ID}&&(${ID})\\(${ID}\\);if\\(!\\(${ID}&&!${ID}\\)\\)`)),
      },
      {
        // `e1t` — "does the hook's rewritten input satisfy a tool that needs
        // interaction". Its presence is the reason a PermissionRequest hook can
        // answer for such a tool at all; the pre-check has no equivalent.
        as: "interactionSatisfied",
        kind: "effectful-port",
        derive: pick("rule-based-permissions", "interactionSatisfied", new RegExp(`if\\(!(${ID})\\(${ID},${ID}\\?\\.hookUpdatedInput\\)`)),
      },
      {
        as: "organizationAskReason",
        kind: "primitive",
        derive: pick(
          "rule-based-permissions",
          "organizationAskReason",
          new RegExp(`effectiveMaxPermission==="ask"\\)\\{let ${ID}=\\{type:"other",reason:(${ID})\\}`),
        ),
      },
      {
        as: "isAskRuleDrivenReason",
        kind: "pure-helper",
        owned: true,
        derive: pick(
          "rule-based-permissions",
          "isAskRuleDrivenReason",
          new RegExp(`==="ask"&&(${ID})\\(${ID}\\.decisionReason\\)\\)return ${ID};if\\(${ID}\\.mcpInfo`),
        ),
      },
      {
        as: "findSafetyCheckReason",
        kind: "pure-helper",
        owned: true,
        derive: pick(
          "rule-based-permissions",
          "findSafetyCheckReason",
          new RegExp(`&&\\((${ID})\\(${ID}\\.decisionReason\\)\\|\\|${ID}\\.decisionReason\\?\\.type==="sandboxOverride"\\)\\)return`),
        ),
      },
    ],
    coverage: ["perm-hook-rewrite"],
  },

  {
    // What a matched ALLOW rule actually decides — which is not "allow".
    //
    // ANCHOR: `matchedAskRule:o}` is unique bundle-wide. Structural rather than
    // prose (§2.1's weaker kind), but it is the shape that makes this function
    // what it is: the field named for an ASK rule carrying the ALLOW rule that
    // matched.
    name: "allow-rule-decision",
    target: "free-function",
    signature: { params: 5, ancestry: ["SourceFile"] },
    anchor: "matchedAskRule:o}",
    fn: "allowRuleDecision",
    captures: [
      {
        as: "permissionMessage",
        kind: "effectful-port",
        derive: pick("allow-rule-decision", "permissionMessage", new RegExp(`rule:${ID}\\},message:(${ID})\\(${ID}\\.name\\)`)),
      },
      {
        as: "classifyToolError",
        kind: "effectful-port",
        derive: pick("allow-rule-decision", "classifyToolError", new RegExp(`catch\\(${ID}\\)\\{let ${ID}=(${ID})\\(${ID},${ID},${ID},${ID}\\)`)),
      },
      {
        as: "crashReason",
        kind: "primitive",
        derive: pick("allow-rule-decision", "crashReason", new RegExp(`\\{type:"other",reason:(${ID})\\}`)),
      },
    ],
    coverage: ["perm-hook-rewrite"],
  },


  // TWO FUNCTIONS THIS WAVE MEASURED DARK, WRONGLY, AND C9'S FIX ROUND SPLICED.
  //
  // `Fy` (`findSafetyCheckReason`, 17 call sites) and `Ree`
  // (`isAskRuleDrivenReason`, 6 call sites) were spliced, built, solo-sabotaged
  // and then UN-spliced as unobservable. Two things were wrong with that.
  //
  //   THE TWINS COULD NOT HAVE BEEN OBSERVED BY ANYTHING. `Fy`'s returned
  //     `undefined` and `Ree`'s returned `false` — which is exactly what the
  //     healthy functions return on every input the corpus produces, because
  //     both answer by finding something (a `safetyCheck` reason; an ask a
  //     user's own rule forced) that no corpus decision carries. A twin that
  //     agrees with the original on the whole domain under test measures the
  //     twin, not the code. The twins are INVERTED now: this one always finds a
  //     safety check, that one always claims the ask was rule-forced.
  //   THE CORPUS HAD NO `auto` CELL. Upstream's remaining callers include the
  //     mode-aware decision body, which runs only under `auto`, and nothing in
  //     the corpus had ever entered that mode. `perm-auto-classifier-deny` does,
  //     and under the inverted twins the scenario diverges on the transcript and
  //     the request surfaces both.
  //
  // The general shape is worth more than either row: A DARKNESS VERDICT IS A
  // MEASUREMENT, and it inherits every limitation of the twin and the corpus it
  // was taken against. Adding one scenario turned two of them over.
  {
    // ANCHOR: the return that distinguishes this finder from every other
    // safety-check test in the graph — the others compare without returning the
    // reason they found.
    name: "safety-check-reason",
    target: "free-function",
    signature: { params: 2, ancestry: ["SourceFile"] },
    anchor: 'type==="safetyCheck")return ',
    fn: "findSafetyCheckReason",
    // `captures: []` — the positive claim "verified zero free variables". The
    // filter parameter's default is a literal arrow and the recursive call
    // resolves to the function's own binding.
    captures: [],
    coverage: ["perm-auto-classifier-deny"],
  },

  {
    // ANCHOR: `rule.ruleBehavior==="ask"` alone has six carriers in four chunks,
    // two of them one-parameter top-level functions in this one, which the
    // signature cannot separate. With `)return!0` it is unique bundle-wide.
    name: "ask-rule-reason",
    target: "free-function",
    signature: { params: 1, ancestry: ["SourceFile"] },
    anchor: 'rule.ruleBehavior==="ask")return!0',
    fn: "isAskRuleDrivenReason",
    captures: [],
    coverage: ["perm-auto-classifier-deny"],
  },

  // WHERE THOSE TWO CAME FROM, AND WHAT THE WITHDRAWN JUSTIFICATION GOT WRONG.
  // The rows above replace a written adjudication that both functions were dark,
  // and the adjudication was wrong in every particular a reader could check.
  //
  //   "the remaining callers are the mode-aware body's auto/dontAsk arms
  //     (gate-dead under §3.3)". They are not gate-dead: the same wave measured
  //     `auto` ACCEPTED through both paths, because upstream's auto gate is three
  //     local conditions and not a remote flag. The dontAsk half is wrong for a
  //     different reason — the mode-aware body returns on `dontAsk` BEFORE it
  //     reaches either call, so those callers are the `auto` arm alone.
  //   "the corpus's decisions carry no `decisionReason` at all". They do. Every
  //     Bash denial in the corpus carries `subcommandResults`, which is exactly
  //     the shape both functions recurse into.
  //   the two callers that stayed after the pre-check and the rule checker took
  //     their copies are on the LIVE headless Bash path — the multi-`cd`
  //     aggregator and the subcommand merge's tie-break. What kept them quiet was
  //     never a gate: each needs a command SHAPE no cell wrote (two `cd`s in one
  //     command; the same normalized subcommand twice at equal decision rank).
  //
  // C7's doctrine still holds — a single-caller pure helper cannot be a live
  // splice. What does not follow from it is that a many-caller one is dark
  // because one twin, run against one corpus, failed to move anything.

  // A THIRD FUNCTION OWNED WITHOUT BEING SPLICED, and the reason is different
  // from the other two. `ql`/`createPermissionRequestMessage` has FORTY-FIVE call
  // sites and runs on every tool call in every mode — reachability is not the
  // problem. Its OUTPUT is: on every path a headless corpus can create, the
  // sentence it builds is absorbed before it reaches an observable.
  //
  //   the pre-check builds `{behavior:"passthrough", message: builder(name)}`
  //     before it evaluates anything, and every arm below either replaces the
  //     decision or returns an allow, which carries no message;
  //   an ASK's message does not travel to the SDK host — the `can_use_tool`
  //     request carries `decision_reason` (a different renderer, which returns
  //     undefined for a `rule` reason) and a `description` built from the tool's
  //     own input, never `decision.message`;
  //   the one path on which an ask's message DOES reach the model — a
  //     PermissionRequest hook's rewrite, re-checked and objected to — takes the
  //     rule checker's ANNOTATING arm, which keeps the tool's own message and
  //     never calls the builder. `w6/scenarios.ts` reached that path and
  //     measured exactly this.
  //
  // So it is owned in `shared/` as a `pure-helper`, where the parity oracle
  // grades all eleven of its decisionReason arms against upstream's bytes across
  // three tool names. A splice would be a row the gate could not prove live, and
  // the campaign's answer to that is C1's: drop the row, keep the finding.

  // A FIFTH FUNCTION MEASURED DARK, and the one that shows why the gate's own
  // reading mattered. `Uct`/`classifierOnlyStreakActive` is sixty-two bytes on
  // the allow arm of every tool call in every mode, including the twenty-two
  // bypass scenarios — by call count the cheapest live unit in the subsystem.
  // Its ANSWER is pinned: §3.3 holds the streak gate at its disabled default, so
  // upstream returns false on every graded run, and the maximal twin (return
  // `true` always, suppressing the denial-streak reset on every allowed call)
  // leaves both covering scenarios byte-identical. The counter it guards is read
  // only by the auto-mode classifier, whose denial is this wave's standing OPEN
  // condition.
  //
  // It was carried as LIVE for most of the wave, on a RED the gate inferred from
  // a non-zero exit rather than from a graded verdict. When the gate started
  // requiring the runner's own verdict line, the phase turned green and stayed
  // green under a manual re-run. Owned in `shared/` and graded by the parity
  // oracle from a synthetic row; the splice is dropped.

  {
    // The only gate on the mode axis. Its refusals are what
    // `research/fixtures/permission-surface-<pin>.json` reads the guard table
    // from, and the `auto` arm is where §3.3's pinned-disabled gate decides
    // whether that mode exists at all on this corpus.
    //
    // ANCHOR: the launch-flag refusal, unique bundle-wide and the longest prose
    // in the subsystem.
    name: "mode-change-guard",
    target: "free-function",
    signature: { params: 2, ancestry: ["SourceFile"] },
    anchor: "Cannot set permission mode to bypassPermissions because the session was not launched",
    fn: "guardPermissionModeChange",
    captures: [
      {
        as: "parsePermissionMode",
        kind: "effectful-port",
        derive: pick("mode-change-guard", "parsePermissionMode", new RegExp(`let ${ID}=(${ID})\\(${ID}\\);if\\(${ID}===void 0\\)`)),
      },
      {
        // Upstream builds this by joining its own mode enumeration in SORTED
        // order, so it is a second, independent statement of the mode axis.
        as: "unrecognizedModeError",
        kind: "primitive",
        derive: pick("mode-change-guard", "unrecognizedModeError", new RegExp(`if\\(${ID}===void 0\\)return\\{ok:!1,error:(${ID})\\}`)),
      },
      {
        as: "restrictedBypassError",
        kind: "primitive",
        derive: pick("mode-change-guard", "restrictedBypassError", new RegExp(`\\.restricted\\)return\\{ok:!1,error:(${ID})\\}`)),
      },
      {
        as: "bypassDisabled",
        kind: "effectful-port",
        derive: pick("mode-change-guard", "bypassDisabled", new RegExp(`if\\((${ID})\\(\\)\\)return\\{ok:!1,error:"Cannot set permission mode to bypassPermissions because it is disabled`)),
      },
      {
        as: "autoModeGateEnabled",
        kind: "effectful-port",
        derive: pick("mode-change-guard", "autoModeGateEnabled", new RegExp(`==="auto"&&!(${ID})\\(\\)`)),
      },
      {
        as: "autoModeUnavailableReason",
        kind: "effectful-port",
        derive: pick("mode-change-guard", "autoModeUnavailableReason", new RegExp(`\\{let ${ID}=(${ID})\\(\\);return\\{ok:!1,error:${ID}\\?`)),
      },
      {
        as: "autoModeUnavailableNotification",
        kind: "effectful-port",
        derive: pick(
          "mode-change-guard",
          "autoModeUnavailableNotification",
          new RegExp(`Cannot set permission mode to auto: \\$\\{(${ID})\\(${ID}\\)\\}`),
        ),
      },
    ],
    coverage: ["runtime-setters", "perm-mode-walk"],
  },

  {
    // What the move DOES: twelve ports, every one a side effect whose far side
    // belongs to a subsystem W6 does not own.
    //
    // ANCHOR: the auto-gate assertion, unique bundle-wide.
    name: "mode-transition",
    target: "free-function",
    signature: { params: 4, ancestry: ["SourceFile"] },
    anchor: "Cannot transition to auto mode: gate is not enabled",
    fn: "transitionPermissionMode",
    captures: [
      {
        as: "setProvisionalStartupMode",
        kind: "effectful-port",
        derive: pick("mode-transition", "setProvisionalStartupMode", new RegExp(`return ${ID};if\\((${ID})\\(void 0\\),`)),
      },
      {
        as: "recordModeChange",
        kind: "effectful-port",
        derive: pick("mode-transition", "recordModeChange", new RegExp(`\\(void 0\\),(${ID})\\(\\{from:`)),
      },
      {
        as: "handlePlanModeTransition",
        kind: "effectful-port",
        derive: pick("mode-transition", "handlePlanModeTransition", new RegExp(`trigger:${ID}\\}\\),(${ID})\\(${ID},${ID}\\),`)),
      },
      {
        as: "handleAutoModeTransition",
        kind: "effectful-port",
        derive: pick("mode-transition", "handleAutoModeTransition", new RegExp(`trigger:${ID}\\}\\),${ID}\\(${ID},${ID}\\),(${ID})\\(${ID},${ID}\\),`)),
      },
      {
        as: "setHasExitedPlanMode",
        kind: "effectful-port",
        derive: pick("mode-transition", "setHasExitedPlanMode", new RegExp(`!=="plan"\\)(${ID})\\(!0\\)`)),
      },
      {
        as: "prepareContextForPlanMode",
        kind: "effectful-port",
        derive: pick("mode-transition", "prepareContextForPlanMode", new RegExp(`!=="plan"\\)return (${ID})\\(${ID}\\)`)),
      },
      {
        as: "isAutoModeActive",
        kind: "effectful-port",
        derive: pick("mode-transition", "isAutoModeActive", new RegExp(`==="plan"&&(${ID})\\(\\),${ID}=${ID}==="auto"`)),
      },
      {
        as: "isAutoModeGateEnabled",
        kind: "effectful-port",
        derive: pick("mode-transition", "isAutoModeGateEnabled", new RegExp(`if\\(!(${ID})\\(\\)\\)throw Error\\("Cannot transition to auto mode`)),
      },
      {
        as: "setAutoModeActive",
        kind: "effectful-port",
        derive: pick("mode-transition", "setAutoModeActive", new RegExp(`gate is not enabled"\\);(${ID})\\(!0\\)`)),
      },
      {
        as: "setNeedsAutoModeExitAttachment",
        kind: "effectful-port",
        derive: pick("mode-transition", "setNeedsAutoModeExitAttachment", new RegExp(`\\(!1\\),(${ID})\\(!0\\),`)),
      },
      {
        as: "stripDangerousPermissionsForAutoMode",
        kind: "effectful-port",
        derive: pick("mode-transition", "stripDangerousPermissionsForAutoMode", new RegExp(`,${ID}=(${ID})\\(${ID}\\)\\}else if`)),
      },
      {
        as: "restoreDangerousPermissions",
        kind: "effectful-port",
        derive: pick("mode-transition", "restoreDangerousPermissions", new RegExp(`\\(!0\\),${ID}=(${ID})\\(${ID}\\);if\\(${ID}==="plan"`)),
      },
    ],
    coverage: ["perm-mode-walk"],
  },

  // A FOURTH FUNCTION MEASURED OFF THE HEADLESS PATH, and this one is a plain
  // DEAD SPLICE rather than an unobservable one. `K0`/`setPermissionModeWithGuards`
  // joins the guard to the transition and looks like the obvious seam for
  // `set_permission_mode` — the W5–W7 scout tables it as exactly that. It is not
  // the one the control channel uses: the headless runtime's handler (`um`)
  // calls the GUARD directly and applies the mode itself, and `K0`'s single call
  // site in that chunk is a different entry point's `onSetPermissionMode`
  // callback. Spliced, built and solo-sabotaged against a mode walk that makes a
  // tool call after every change — including a twin that REFUSES every change,
  // which cannot be absorbed — it stayed green.
  //
  // Dropped rather than kept as an ungated row, which is what C1 did with the
  // interrupt clause for the same reason. The two functions it joins are both
  // owned and both live (`mode-change-guard`, `mode-transition`), so the seam's
  // ends are covered and only the joint is not.

  {
    // The hook that races the SDK host on every ask.
    //
    // ANCHOR: `Permission denied by PermissionRequest hook` is unique
    // bundle-wide — the default message the deny arm supplies.
    name: "permission-request-hook-decision",
    target: "free-function",
    signature: { params: 5, ancestry: ["SourceFile"] },
    anchor: "Permission denied by PermissionRequest hook",
    fn: "permissionRequestHookDecision",
    captures: [
      {
        as: "toolPermissionContext",
        kind: "effectful-port",
        derive: pick("permission-request-hook-decision", "toolPermissionContext", new RegExp(`let ${ID}=(${ID})\\(${ID}\\)\\.mode,`)),
      },
      {
        // `Tee` / executePermissionRequestHooks — the dispatcher W5 already
        // OWNS, so this port's far side is another reforge module rather than
        // extracted code. Ownership composing across waves, at a seam.
        as: "dispatchHooks",
        kind: "effectful-port",
        derive: pick(
          "permission-request-hook-decision",
          "dispatchHooks",
          new RegExp(`,${ID}=(${ID})\\(${ID}\\.name,${ID},${ID},${ID},${ID},${ID},${ID}\\.abortController\\.signal\\)`),
        ),
      },
      {
        as: "guardHookUpdatedInput",
        kind: "effectful-port",
        derive: pick("permission-request-hook-decision", "guardHookUpdatedInput", new RegExp(`let ${ID}=(${ID})\\(await ${ID}\\(`)),
      },
      {
        // `Gx` — the rule checker, which this wave also owns. Forwarded for the
        // same reason as the message builder: this seam does not carry the
        // fifteen sub-ports that module needs.
        as: "checkRules",
        kind: "effectful-port",
        derive: pick(
          "permission-request-hook-decision",
          "checkRules",
          new RegExp(`=${ID}\\(await (${ID})\\(${ID},${ID},\\{\\.\\.\\.${ID},toolUseId:`),
        ),
      },
      {
        // `YXe` — a frozen reason OBJECT, not a string, so it stays a port: the
        // adapter's `primitive` assertion is `Object.is`, which cannot compare
        // two structurally equal objects, and a members comparison would be a
        // second transcription of a shape this wave does not otherwise own.
        as: "headlessDenyReason",
        kind: "effectful-port",
        derive: pick("permission-request-hook-decision", "headlessDenyReason", new RegExp(`decisionReason:${ID}\\.decisionReason\\?\\?(${ID}),`)),
      },
      {
        as: "interactionSatisfied",
        kind: "effectful-port",
        derive: pick("permission-request-hook-decision", "interactionSatisfied", new RegExp(`if\\(!(${ID})\\(${ID},${ID}\\.updatedInput\\)&&`)),
      },
      {
        as: "withoutRemoteScope",
        kind: "effectful-port",
        derive: pick("permission-request-hook-decision", "withoutRemoteScope", new RegExp(`===!0\\?(${ID})\\(${ID}\\.updatedPermissions\\?\\?\\[\\]\\)`)),
      },
      {
        as: "applySessionUpdates",
        kind: "effectful-port",
        derive: pick("permission-request-hook-decision", "applySessionUpdates", new RegExp(`setSessionToolPermissionContext\\(\\(${ID}\\)=>(${ID})\\(`)),
      },
      {
        as: "persistUpdates",
        kind: "effectful-port",
        derive: pick("permission-request-hook-decision", "persistUpdates", new RegExp(`,await (${ID})\\(${ID},${ID}\\.storageV5\\)`)),
      },
      {
        as: "isPersistedDestination",
        kind: "effectful-port",
        derive: pick(
          "permission-request-hook-decision",
          "isPersistedDestination",
          new RegExp(`permanent:${ID}\\.some\\(\\(${ID}\\)=>(${ID})\\(${ID}\\.destination\\)\\)`),
        ),
      },
    ],
    coverage: ["hooks-permission", "perm-hook-deny"],
  },

  {
    // The headless seam's RETURN leg: the SDK host's answer turned back into an
    // engine decision, with the eleventh decisionReason kind stamped on it.
    //
    // ANCHOR: `type:"permissionPromptTool"` is unique bundle-wide — the fixture
    // records it as the one reason kind upstream RENDERS but nothing else
    // CONSTRUCTS, because it is built here as a whole object.
    name: "broker-response-map",
    target: "free-function",
    signature: { params: 6, ancestry: ["SourceFile"] },
    anchor: 'type:"permissionPromptTool"',
    fn: "brokerResponseMap",
    captures: [
      {
        as: "filterPermissionUpdates",
        kind: "effectful-port",
        derive: pick("broker-response-map", "filterPermissionUpdates", new RegExp(`let ${ID}=(${ID})\\(${ID}\\.updatedPermissions,`)),
      },
      {
        as: "applySessionUpdates",
        kind: "effectful-port",
        derive: pick("broker-response-map", "applySessionUpdates", new RegExp(`setSessionToolPermissionContext\\(\\(${ID}\\)=>(${ID})\\(`)),
      },
      {
        as: "persistUpdates",
        kind: "effectful-port",
        derive: pick("broker-response-map", "persistUpdates", new RegExp(`,(${ID})\\(${ID},${ID}\\.storageV5\\)\\.catch\\(`)),
      },
      {
        as: "lastKnownInput",
        kind: "effectful-port",
        derive: pick("broker-response-map", "lastKnownInput", new RegExp(`\\.length>0\\?${ID}\\.updatedInput:(${ID})\\(${ID}\\.name,${ID}\\)`)),
      },
      {
        as: "logError",
        kind: "effectful-port",
        derive: pick("broker-response-map", "logError", new RegExp(`\\.storageV5\\)\\.catch\\((${ID})\\)`)),
      },
      {
        as: "log",
        kind: "effectful-port",
        derive: pick("broker-response-map", "log", new RegExp(`\\.interrupt\\)(${ID})\\(\``)),
      },
    ],
    coverage: ["permission-bag"],
  },

  {
    // Which of the host's requested permission updates the engine will accept —
    // deny-by-default in two of its four arms.
    //
    // ANCHOR: the OTHER suppression predicate. `suppressesAllPermissionUpdates`
    // reads like the natural anchor and is not one: it has fourteen carriers
    // across five chunks, two of them in this chunk, and those two — this and
    // the hook decision above — are BOTH five-parameter top-level functions, so
    // `params` + `ancestry` tie and the build refuses rather than guessing.
    // (`async` would separate them and the signature has no such dimension; a
    // flow-back note for the next mechanism round, not a blocker here.)
    // `suppressesAlwaysAllowRule` occurs once in this chunk and only this
    // function reads it, so the chunk scope alone makes it unique.
    name: "broker-permission-updates",
    target: "free-function",
    signature: { params: 5, ancestry: ["SourceFile"] },
    anchor: "suppressesAlwaysAllowRule",
    coLiteral: 'type:"permissionPromptTool"',
    fn: "brokerPermissionUpdates",
    captures: [
      {
        as: "isExemptContext",
        kind: "effectful-port",
        derive: pick("broker-permission-updates", "isExemptContext", new RegExp(`forRemoteExecution===!0\\|\\|(${ID})\\(${ID}\\)\\)return`)),
      },
      {
        as: "withoutRemoteScope",
        kind: "effectful-port",
        derive: pick("broker-permission-updates", "withoutRemoteScope", new RegExp(`\\{let ${ID}=(${ID})\\(${ID}\\);return ${ID}\\.length>0`)),
      },
      {
        as: "stripWholeToolGrants",
        kind: "effectful-port",
        derive: pick("broker-permission-updates", "stripWholeToolGrants", new RegExp(`\\|\\|${ID}\\)\\?(${ID})\\(${ID},${ID},`)),
      },
      {
        as: "toolPermissionContext",
        kind: "effectful-port",
        derive: pick("broker-permission-updates", "toolPermissionContext", new RegExp(`\\?${ID}\\(${ID},${ID},(${ID})\\(${ID}\\)\\):${ID}\\}`)),
      },
    ],
    coverage: ["perm-broker-updates"],
  },

  {
    // The success envelope every headless control_response leaves through.
    // Seven call sites; `initialize` is the first request of every SDK-driven
    // run, so its liveness is universal.
    //
    // ANCHOR: `subtype:"success",request_id:` has three carriers in this chunk
    // and twenty-four bundle-wide, so it needs BOTH a chunk scope and a sibling
    // count. The co-literal is the permission-prompt reason kind, which only
    // this chunk constructs.
    name: "control-response-success",
    target: "free-function",
    signature: { params: 2, ancestry: ["SourceFile"] },
    anchor: 'subtype:"success",request_id:',
    coLiteral: 'type:"permissionPromptTool"',
    siblings: 3,
    fn: "controlResponseSuccess",
    captures: [],
    // MEASURED, and it corrects the scout: `initialize` does NOT go through
    // here. The headless runtime builds the initialize and reinitialize
    // responses as INLINE object literals and routes every OTHER subtype through
    // this constructor, so the first request of every run is the one request it
    // never serves. Sabotaging it leaves `plain` green and turns
    // `runtime-setters` — a `set_permission_mode` over the channel — red.
    coverage: ["runtime-setters"],
  },

  {
    // The error envelope, and the only thing carrying a guard's own sentence out
    // to an SDK host.
    //
    // ANCHOR: same shape as its twin — two carriers in this chunk, thirty
    // bundle-wide.
    name: "control-response-error",
    target: "free-function",
    signature: { params: 2, ancestry: ["SourceFile"] },
    anchor: 'subtype:"error",request_id:',
    coLiteral: 'type:"permissionPromptTool"',
    siblings: 2,
    fn: "controlResponseError",
    captures: [],
    coverage: ["perm-mode-walk"],
  },

  // ---- system-prompt assembly (subsystem/environment-and-system-prompt) ----
  // W3's five splices, all `free-function` — the shape W0a spiked on `env-block`,
  // which is the sixth member of this subsystem and already owned.
  //
  // Read them as a pipeline, because that is what they are on every request:
  //
  //   identity-prompt        picks the one sentence the prompt opens with
  //   context-prompt-lines   appends the ambient context as `key: value` lines
  //   system-prompt-blocks   partitions the flat list into scoped blocks
  //   system-prompt-wire     turns those into the API's `system` array
  //   context-reminder       renders the same context as the first user message
  //   subagent-prompt        the parallel assembly for a dispatched agent
  //
  // Three of them were DARK on the corpus until this wave recorded
  // `sysprompt-preset`, `sysprompt-append` and `claude-md-memory` (see
  // w3/scenarios.ts): the harness passes no `systemPrompt`, so every earlier
  // recording carried the same two blocks and none of the section machinery.

  {
    // The block partition and its cache scoping — the function every request's
    // `system` array comes out of. Anchored on its own telemetry event, unique
    // graph-wide.
    //
    // FOUR of its six captures are `primitive`, which is the highest yield in
    // the manifest: the boundary marker, the billing prefix, the three identity
    // sentences and the reporting-outcomes prose are all compared against the
    // graph on every single delegation. A prompt constant that is REWORDED
    // upstream moves no anchor, no target hash and no capture hash — these
    // comparisons are the only thing that would see it.
    name: "system-prompt-blocks",
    target: "free-function",
    signature: { params: 2, ancestry: ["SourceFile"] },
    anchor: "tengu_sysprompt_boundary_found",
    fn: "systemPromptBlocks",
    captures: [
      {
        // `Kde()` — two feature gates plus a `firstParty`/`anthropicAws`
        // provider test. FALSE under §3.3's pinned gate state, measured through
        // `sysprompt-preset` (the preset's section list carries no boundary
        // marker, which only happens on the gate's empty arm).
        as: "staticPromptEnabled",
        kind: "effectful-port",
        derive: pick(
          "system-prompt-blocks",
          "staticPromptEnabled",
          new RegExp(`let ${ID}=(${ID})\\(\\),${ID}=e\\.findIndex`),
        ),
      },
      {
        // `wO` — the SDK's public `SYSTEM_PROMPT_DYNAMIC_BOUNDARY`.
        as: "boundaryMarker",
        kind: "primitive",
        derive: pick("system-prompt-blocks", "boundaryMarker", new RegExp(`=>${ID}===(${ID})\\)`)),
      },
      {
        // `tL="x-anthropic-billing-header:"`.
        as: "billingHeaderPrefix",
        kind: "primitive",
        derive: pick("system-prompt-blocks", "billingHeaderPrefix", new RegExp(`\\.startsWith\\((${ID})\\)`)),
      },
      {
        // `n6` — the frozen Set of the three identity sentences, shared with the
        // `identity-prompt` row that PRODUCES them. A Set is not `Object.is`
        // comparable, so its adapter asserts the members in declaration order
        // (shared/assert.js `assertGraphMembers`); a blanket equality assertion
        // over a Set would be vacuous in both directions.
        as: "identityPrompts",
        kind: "primitive",
        derive: pick("system-prompt-blocks", "identityPrompts", new RegExp(`else if\\((${ID})\\.has\\(`)),
      },
      {
        // `aE` — the "# Reporting outcomes" section. Recognised by identity, so
        // the owned copy has to be the same 907 characters.
        as: "reportingOutcomes",
        kind: "primitive",
        derive: pick("system-prompt-blocks", "reportingOutcomes", new RegExp(`else if\\(${ID}===(${ID})\\)`)),
      },
      {
        as: "telemetry",
        kind: "effectful-port",
        derive: pick(
          "system-prompt-blocks",
          "telemetry",
          new RegExp(`(${ID})\\("tengu_sysprompt_using_tool_based_cache"`),
        ),
      },
    ],
    // Every scenario in the corpus: this is the one function no request can
    // avoid. Listed in full so the expected-RED set is not read as a regression
    // (the `bash-tool-result` precedent).
    coverage: [
      "plain",
      "bash-tool",
      "file-tools",
      "permission-broker",
      "hooks",
      "multi-turn",
      "resume",
      "api-error",
      "thinking",
      "subagent",
      "partial-tool-args",
      "mcp-tool",
      "parallel-tools",
      "slash-compact",
      "runtime-setters",
      "todo-tool",
      "search-tools",
      "uuid-correlation",
      "interrupt",
      "permission-bag",
      "background-task",
      "fork-session",
      "edit-tool",
      "task-family",
      "search-tools-lean",
      "sysprompt-preset",
      "sysprompt-append",
      "sysprompt-boundary",
      "claude-md-memory",
      "compact-continue",
      "auto-compact-threshold",
    ],
  },

  {
    // Scoped blocks -> the API's `system` array. The scout filed this one
    // "unanchorable"; it is not. Its distinctive substring is the pair of
    // property names `cacheScope,ttl:` — one occurrence graph-wide, and no
    // minified identifier in it, which is the property the anchor doctrine
    // actually asks for (a `coLiteral` exists for anchors that are not unique,
    // not for anchors that are not PROSE).
    name: "system-prompt-wire",
    target: "free-function",
    signature: { params: 3, ancestry: ["SourceFile"] },
    anchor: "cacheScope,ttl:",
    fn: "systemPromptTextBlocks",
    captures: [
      {
        // `tOe` — the graph's binding for the partition above, which this wave
        // also owns. Kept a port rather than an owned helper: it is effectful
        // (telemetry) and its own six captures belong to the graph, so the call
        // reaches owned code through the delegation rather than by import.
        as: "partition",
        kind: "effectful-port",
        derive: pick("system-prompt-wire", "partition", new RegExp(`return (${ID})\\(e,\\{skipGlobalCacheForSystemPrompt`)),
      },
      {
        // `fF({scope,ttl})` — builds the `cache_control` object, reading the
        // prompt-cache TTL policy. A ledger edge to the query-loop wave.
        as: "cacheControl",
        kind: "effectful-port",
        derive: pick("system-prompt-wire", "cacheControl", new RegExp(`cache_control:(${ID})\\(\\{scope:`)),
      },
    ],
    // Same reason as the partition it calls: no request avoids it.
    coverage: ["plain", "subagent", "sysprompt-preset", "sysprompt-append", "claude-md-memory"],
  },

  {
    // The identity-line selector. Anchored on `?.isNonInteractive` — 19
    // occurrences graph-wide but exactly ONE in the engine chunk, so a
    // `coLiteral` scopes it: the append-aware identity sentence, which is
    // declared immediately above this function and read by nothing else.
    // Neither part carries a minified identifier.
    name: "identity-prompt",
    target: "free-function",
    signature: { params: 1, ancestry: ["SourceFile"] },
    anchor: "?.isNonInteractive",
    coLiteral: "You are Claude Code, Anthropic's official CLI for Claude, running within the Claude Agent SDK.",
    fn: "identityPrompt",
    captures: [
      {
        // `Efe` — returned by BOTH the Vertex arm and the interactive arm, so
        // one derivation with two use sites.
        as: "cliIdentity",
        kind: "primitive",
        derive: pick("identity-prompt", "cliIdentity", new RegExp(`==="vertex"\\)return (${ID});`)),
      },
      {
        as: "appendIdentity",
        kind: "primitive",
        derive: pick("identity-prompt", "appendIdentity", new RegExp(`\\.hasAppendSystemPrompt\\)return (${ID});`)),
      },
      {
        as: "sdkIdentity",
        kind: "primitive",
        derive: pick("identity-prompt", "sdkIdentity", new RegExp(`\\.hasAppendSystemPrompt\\)return ${ID};return (${ID})\\}`)),
      },
      {
        // `Ne()` — the resolved API provider. Pinned to first-party by the
        // harness's own base URL, so the Vertex arm is unreachable and adjudicated.
        as: "provider",
        kind: "effectful-port",
        derive: pick("identity-prompt", "provider", new RegExp(`if\\((${ID})\\(\\)==="vertex"\\)`)),
      },
    ],
    // 27 scenarios render the SDK arm; `sysprompt-append` is the only recording
    // in the corpus that carries the append arm's sentence.
    coverage: ["plain", "subagent", "sysprompt-preset", "sysprompt-append", "claude-md-memory"],
  },

  {
    // CLAUDE.md injection: the ambient context as the first user message.
    name: "context-reminder",
    target: "free-function",
    signature: { params: 2, ancestry: ["SourceFile"] },
    anchor: "<system-reminder>\nAs you answer the user's questions",
    fn: "contextReminderMessages",
    captures: [
      {
        // `xe({content,isMeta})` — the message constructor, which stamps a uuid
        // and a timestamp. A ledger edge to the session/transcript subsystem.
        as: "makeMessage",
        kind: "effectful-port",
        derive: pick("context-reminder", "makeMessage", new RegExp(`return\\[(${ID})\\(\\{content:`)),
      },
    ],
    // `currentDate` is unconditional, so every scenario renders the one-entry
    // shape; `claude-md-memory` is the only one that renders two entries, i.e.
    // the only one where the join separator is observable at all.
    coverage: ["plain", "subagent", "claude-md-memory"],
  },

  {
    // The same context, appended to the SYSTEM prompt as `key: value` lines —
    // where a Claude Code prompt's `gitStatus:` paragraph comes from.
    //
    // The scout filed this one unanchorable too, and it is the manifest's
    // weakest anchor: `].filter(Boolean)}` is punctuation, with no prose and no
    // semantics. It is takeable because it occurs ONCE in the engine chunk and
    // a `coLiteral` scopes it there — the context reminder's own opening line,
    // which is the adjacent function and the other half of the same context
    // rendering. Both failure modes are loud: a second occurrence fails the
    // uniqueness check, and a drifted node fails the signature.
    name: "context-prompt-lines",
    target: "free-function",
    signature: { params: 2, ancestry: ["SourceFile"] },
    anchor: "].filter(Boolean)}",
    coLiteral: "<system-reminder>\nAs you answer the user's questions",
    fn: "contextPromptLines",
    // Verified zero free variables.
    captures: [],
    // Called on every request, but only OBSERVABLE where the context map is
    // non-empty — which on this corpus is the two preset scenarios.
    coverage: ["sysprompt-preset", "sysprompt-append"],
  },

  {
    // A dispatched agent's system prompt. Anchored on the provenance-and-
    // authority sentence it appends, which is unique graph-wide.
    name: "subagent-prompt",
    target: "free-function",
    signature: { params: 3, ancestry: ["SourceFile"] },
    anchor: "Messages from the agent that launched you",
    fn: "subagentPrompt",
    captures: [
      {
        // `ar="Write"` — interpolated into the notes block's last bullet.
        as: "writeToolName",
        kind: "primitive",
        derive: pick("subagent-prompt", "writeToolName", new RegExp(`- Do NOT \\$\\{(${ID})\\} report/summary`)),
      },
      {
        // `W8t` — the env-info section, which wraps the ALREADY OWNED env block
        // (W0a's `env-block` splice). The first owned module in the campaign
        // whose port's far side is also owned; recorded as a ledger edge rather
        // than folded away.
        as: "envInfoSection",
        kind: "effectful-port",
        derive: pick("subagent-prompt", "envInfoSection", new RegExp(`,${ID}=await (${ID})\\(t,r\\),`)),
      },
      {
        // `kKe` — the `<total_tokens>` attachment; reads env kill-switches and
        // the session's token budget.
        as: "tokenAttachment",
        kind: "effectful-port",
        derive: pick("subagent-prompt", "tokenAttachment", new RegExp(`,${ID}=(${ID})\\(t\\);return\\[`)),
      },
    ],
    coverage: ["subagent", "background-task"],
  },

  {
    // VARIABLE-DECLARATOR shape (campaign spec C5x, unit 3) — the mechanism
    // spike for owning a top-level constant's initializer, on the target W4
    // actually wants: the compaction summarization prompt. It is declarator 0 of
    // a four-declarator `var` (`l1n`, `c1n`, `u1n`, `gRt`), so the excision has
    // to take the initializer and leave three siblings alone.
    //
    // Upstream writes it as a template literal whose one substitution is a
    // string literal — a constant fold — so `captures: []` here is the verified
    // claim "this initializer reads nothing from its scope", and the owned
    // module ships the concatenation verbatim.
    name: "compaction-prompt",
    target: "variable-declarator",
    signature: { params: 0, ancestry: ["SourceFile"], declarator: 0 },
    anchor: "Your task is to create a detailed summary of the conversation",
    fn: "summarizationPrompt",
    captures: [],
    coverage: ["slash-compact", "compact-continue", "auto-compact-threshold"],
  },


  // ---- the OS() prompt SECTIONS (subsystem/environment-and-system-prompt, C10.5 / W7.5)
  // W3 owns the prompt PIPELINE — which sentence opens it, how the flat list is
  // partitioned into cache-scoped blocks, how those become the API's `system`
  // array. What it did not own is the list itself: the ~20-section figure quoted
  // since W3 is 27 dynamic section records plus a six-element static head (in a
  // five-element return array of which exactly one element follows the dynamic
  // set), now derived from the pin as
  // `research/fixtures/prompt-sections-<pin>.json` and re-derived by the gate.
  //
  // These six rows take the static head — the sections that are not gated behind
  // an experiment, a background job or a remote surface, and that the corpus
  // actually renders. `sysprompt-preset`'s recorded request carries every one of
  // them, which is what makes each row's solo sabotage a byte difference on the
  // requests surface rather than an argument.
  //
  // THE ANCHORS ARE PROSE AND EACH OCCURS ONCE over the 1,802-file module set
  // `prepare.ts:textModules()` builds — the strongest anchor class the doctrine
  // has, and a deliberate contrast with C6's two structural anchors. Two
  // near-misses are recorded on their rows rather than in someone's memory.

  {
    // ZERO CAPTURES, 3,625 upstream bytes: one template literal, no free
    // variable, no branch. `captures: []` is a positive claim the build
    // re-derives every time and `strangle/perturb.ts` requires to be complete.
    name: "executing-actions-section",
    target: "free-function",
    signature: { params: 0, ancestry: ["SourceFile"] },
    anchor: "# Executing actions with care",
    fn: "executingActionsSection",
    captures: [],
    coverage: ["sysprompt-preset"],
  },

  {
    // The largest prose section (4,067 B). Its one free variable is the feature
    // gate whose true arm adds the verified-vs-assumed bullet; that arm is dark
    // under §3.3's pinned gate state and is graded by prompt-parity.test.ts.
    name: "doing-tasks-section",
    target: "free-function",
    signature: { params: 0, ancestry: ["SourceFile"] },
    anchor: "# Doing tasks",
    fn: "doingTasksSection",
    captures: [
      {
        as: "featureGate",
        kind: "effectful-port",
        derive: pick("doing-tasks-section", "featureGate", new RegExp(`\\.\\.\\.(${ID})\\("tengu_verified_vs_assumed"`)),
      },
      {
        // Upstream `km`, the bullet formatter. FIFTEEN call sites bundle-wide,
        // so it is a `pure-helper` rather than a fold-in: the owned module ships
        // its own copy (modules/shared/prompt-bullets.js), upstream's stays live
        // for its other callers, and the graph's function is neither called nor
        // compared by identity.
        as: "bulletLines",
        kind: "pure-helper",
        owned: true,
        derive: pick("doing-tasks-section", "bulletLines", new RegExp(`"# Doing tasks",\\.\\.\\.(${ID})\\(`)),
      },
    ],
    coverage: ["sysprompt-preset"],
  },

  {
    // The harness-describing section. One forwarded port and one FOLD-IN: the
    // hooks paragraph (upstream `_8t`) is pure with exactly one caller, so C7's
    // rule puts it inside the owned module instead of giving it a row that would
    // be dead the moment this one lands. The system-reminder note is the
    // opposite case — two callers and a latch read — so it stays a port.
    name: "system-section",
    target: "free-function",
    signature: { params: 1, ancestry: ["SourceFile"] },
    anchor: "# System",
    fn: "systemSection",
    captures: [
      {
        as: "systemReminderNote",
        kind: "effectful-port",
        derive: pick("system-section", "systemReminderNote", new RegExp(`adjust your approach\\.",(${ID})\\(`)),
      },
      {
        // The FOLD-IN, and it is still declared: C7's rule moves a single-caller
        // pure helper INSIDE the owned module rather than giving it a row, but
        // the build keeps deriving its upstream binding so §5 keeps footprinting
        // the declaration. Owned, so it is not forwarded and not called.
        as: "hooksNote",
        kind: "pure-helper",
        owned: true,
        derive: pick("system-section", "hooksNote", new RegExp(`before continuing\\.",(${ID})\\(\\)`)),
      },
      {
        // Upstream `km`, the bullet formatter. FIFTEEN call sites bundle-wide,
        // so it is a `pure-helper` rather than a fold-in: the owned module ships
        // its own copy (modules/shared/prompt-bullets.js), upstream's stays live
        // for its other callers, and the graph's function is neither called nor
        // compared by identity.
        as: "bulletLines",
        kind: "pure-helper",
        owned: true,
        derive: pick("system-section", "bulletLines", new RegExp(`"# System",\\.\\.\\.(${ID})\\(`)),
      },
    ],
    coverage: ["sysprompt-preset"],
  },

  {
    // The smallest section, and the only owned body carrying a filter that
    // cannot currently remove anything — reproduced rather than optimised away,
    // and adjudicated in the branch inventory.
    name: "tone-and-style-section",
    target: "free-function",
    signature: { params: 0, ancestry: ["SourceFile"] },
    anchor: "# Tone and style",
    fn: "toneAndStyleSection",
    captures: [
      {
        // Upstream `km`, the bullet formatter. FIFTEEN call sites bundle-wide,
        // so it is a `pure-helper` rather than a fold-in: the owned module ships
        // its own copy (modules/shared/prompt-bullets.js), upstream's stays live
        // for its other callers, and the graph's function is neither called nor
        // compared by identity.
        as: "bulletLines",
        kind: "pure-helper",
        owned: true,
        derive: pick("tone-and-style-section", "bulletLines", new RegExp(`"# Tone and style",\\.\\.\\.(${ID})\\(`)),
      },
    ],
    coverage: ["sysprompt-preset"],
  },

  {
    // NINE `primitive` captures — the highest yield in the manifest. They are
    // tool NAMES, and a renamed tool moves no anchor, no target hash and no
    // capture hash, so the adapter's nine per-delegation comparisons are the
    // only thing in the campaign that would see one.
    //
    // ANCHOR, and this is the row where the doctrine's two failure modes both
    // show up at once: `# Using your tools` occurs TWICE, once in each arm of
    // this same body, which `selectExcision` reads as a tie and refuses (it
    // counts candidates, not spans — C6's recorded mechanism note). And the
    // SHORT form of the parallel-tools sentence also occurs twice. So the anchor
    // is the long form, one occurrence graph-wide.
    name: "using-tools-section",
    target: "free-function",
    signature: { params: 1, ancestry: ["SourceFile"] },
    anchor:
      "You can call multiple tools in a single response. If you intend to call multiple tools and there are no dependencies between them",
    fn: "usingToolsSection",
    captures: [
      {
        as: "taskCreateTool",
        kind: "primitive",
        derive: pick("using-tools-section", "taskCreateTool", new RegExp(`let ${ID}=\\[(${ID}),${ID}\\]\\.find`)),
      },
      {
        as: "todoWriteTool",
        kind: "primitive",
        derive: pick("using-tools-section", "todoWriteTool", new RegExp(`let ${ID}=\\[${ID},(${ID})\\]\\.find`)),
      },
      {
        as: "bashTool",
        kind: "primitive",
        derive: pick("using-tools-section", "bashTool", new RegExp(`\\.has\\((${ID})\\),${ID}=${ID}\\?`)),
      },
      {
        as: "powershellTool",
        kind: "primitive",
        derive: pick("using-tools-section", "powershellTool", new RegExp(`\\?${ID}:(${ID}),${ID}=\\[`)),
      },
      {
        as: "readTool",
        kind: "primitive",
        derive: pick(
          "using-tools-section",
          "readTool",
          new RegExp(`=${ID}\\(\\),${ID}=${ID}\\.has\\(${ID}\\),${ID}=${ID}\\?${ID}:${ID},${ID}=\\[(${ID}),`),
        ),
      },
      {
        as: "editTool",
        kind: "primitive",
        derive: pick("using-tools-section", "editTool", new RegExp(`,${ID}=\\[${ID},(${ID}),${ID},\\.\\.\\.`)),
      },
      {
        as: "writeTool",
        kind: "primitive",
        derive: pick("using-tools-section", "writeTool", new RegExp(`,${ID}=\\[${ID},${ID},(${ID}),\\.\\.\\.`)),
      },
      {
        as: "globTool",
        kind: "primitive",
        derive: pick("using-tools-section", "globTool", new RegExp(`\\[\\]:\\[(${ID}),${ID}\\]\\]\\.join`)),
      },
      {
        as: "grepTool",
        kind: "primitive",
        derive: pick("using-tools-section", "grepTool", new RegExp(`\\[\\]:\\[${ID},(${ID})\\]\\]\\.join`)),
      },
      {
        // The REPL predicate that selects the short arm. FALSE on every headless
        // run, so the corpus renders the full arm and the short one — including
        // its empty-string answer, the only "" in the pipeline — is graded by
        // prompt-parity.test.ts.
        as: "isRepl",
        kind: "effectful-port",
        derive: pick(
          "using-tools-section",
          "isRepl",
          new RegExp(`\\.find\\(\\(${ID}\\)=>${ID}\\.has\\(${ID}\\)\\);if\\((${ID})\\(\\)\\)`),
        ),
      },
      {
        as: "searchToolsEnabled",
        kind: "effectful-port",
        derive: pick("using-tools-section", "searchToolsEnabled", new RegExp(`let ${ID}=(${ID})\\(\\),${ID}=${ID}\\.has`)),
      },
      {
        // Upstream `km`, the bullet formatter. FIFTEEN call sites bundle-wide,
        // so it is a `pure-helper` rather than a fold-in: the owned module ships
        // its own copy (modules/shared/prompt-bullets.js), upstream's stays live
        // for its other callers, and the graph's function is neither called nor
        // compared by identity.
        as: "bulletLines",
        kind: "pure-helper",
        owned: true,
        derive: pick("using-tools-section", "bulletLines", new RegExp(`"# Using your tools",\\.\\.\\.(${ID})\\(`)),
      },
    ],
    coverage: ["sysprompt-preset"],
  },

  {
    // The opener of the section list, and NOT the function `identity-prompt`
    // already owns: that one (upstream `r6`) picks the sentence the whole prompt
    // starts with off the SDK/interactive/append axis; this one keys off the
    // output style and an intro-frame latch. Two similar decisions, two
    // functions, and owning both is what makes the prompt's opening bytes owned.
    name: "identity-security-section",
    target: "free-function",
    signature: { params: 1, ancestry: ["SourceFile"] },
    anchor: "IMPORTANT: You must NEVER generate or guess URLs",
    fn: "identitySecuritySection",
    captures: [
      {
        as: "agentIdentity",
        kind: "primitive",
        derive: pick("identity-security-section", "agentIdentity", new RegExp(`\\(\\)\\?(${ID}):"You are an interactive agent`)),
      },
      {
        as: "securityPolicy",
        kind: "primitive",
        derive: pick("identity-security-section", "securityPolicy", new RegExp(`assist the user\\.\\n\\n\\$\\{(${ID})\\}`)),
      },
      {
        as: "outputStyleIdentity",
        kind: "effectful-port",
        derive: pick("identity-security-section", "outputStyleIdentity", new RegExp(`!==null\\?(${ID})\\(\\)`)),
      },
      {
        as: "introFrameEnabled",
        kind: "effectful-port",
        derive: pick("identity-security-section", "introFrameEnabled", new RegExp(`\\(\\):(${ID})\\(\\)\\?`)),
      },
    ],
    coverage: ["sysprompt-preset"],
  },

  // ---- compaction (subsystem/compaction, C7 / W4) --------------------------
  // The four units downstream of the summarization prompt C5x already owns:
  // what the model's answer becomes, what the session wakes up with, what the
  // boundary records, and what decides a compaction is needed at all.

  {
    // The `compact_boundary` constructor. Anchored on the prose it stamps into
    // every boundary plus the property name after it — "Conversation compacted"
    // occurs five times graph-wide (a zod schema and two renderers say it too),
    // and the `content:`/`,isMeta` frame is what makes this the CONSTRUCTOR's
    // occurrence rather than a description of one. No minified identifier in it.
    name: "compact-boundary",
    target: "free-function",
    signature: { params: 5, ancestry: ["SourceFile"] },
    anchor: 'content:"Conversation compacted",isMeta',
    fn: "compactBoundary",
    captures: [
      {
        // `randomUUID` from node's `crypto`, imported under a minified alias.
        // An external module is a boundary rather than a hole (C5x's correction
        // to W2's closure-walk debt), and identity minting belongs to the
        // session subsystem — a ledger edge to C12, not something to own here.
        as: "uuid",
        kind: "effectful-port",
        derive: pick("compact-boundary", "uuid", new RegExp(`uuid:(${ID})\\(\\),level:"info"`)),
      },
    ],
    coverage: ["slash-compact", "compact-continue", "auto-compact-threshold"],
  },

  {
    // Boundary metadata -> the SDK's `compact_metadata`. The scout proposed
    // `pre_tokens:e.preTokens`, which carries the minified parameter name; the
    // anchor doctrine asks for no minified identifiers, not for prose, so the
    // nested wire keys serve instead. `{preserved_segment:{head_uuid:` occurs
    // once graph-wide and is pure wire contract.
    name: "compact-boundary-wire",
    target: "free-function",
    signature: { params: 1, ancestry: ["SourceFile"] },
    anchor: "{preserved_segment:{head_uuid:",
    fn: "compactBoundaryWire",
    // Verified zero free variables.
    captures: [],
    coverage: ["slash-compact", "compact-continue", "auto-compact-threshold"],
  },

  {
    // The post-compaction continuation message, AND the summary rewriter it
    // calls (upstream `d1n`). Two upstream functions, one owned module, one row:
    // `d1n` is a pure helper with exactly one caller, so once `Cq` is owned the
    // graph's copy is unreachable and a separate splice of it would be a dead
    // one. Measured, not assumed — it was tried as its own row and its solo
    // sabotage came back GREEN on both covering scenarios. See the module header.
    name: "compact-continuation",
    target: "free-function",
    signature: { params: 2, ancestry: ["SourceFile"] },
    anchor: "This session is being continued from a previous conversation that ran out of context.",
    fn: "compactContinuation",
    captures: [
      {
        // `d1n` — the summary rewriter, which this wave also owns. A pure
        // helper, so the module ships it and upstream's copy is neither called
        // nor compared; the build still footprints the binding.
        as: "summaryText",
        kind: "pure-helper",
        owned: true,
        derive: pick("compact-continuation", "summaryText", new RegExp(`\\$\\{(${ID})\\(e\\)\\}`)),
      },
    ],
    coverage: ["slash-compact", "compact-continue", "auto-compact-threshold"],
  },

  {
    // The auto-compaction predicate. Anchored on the decision line it logs,
    // which is unique graph-wide and is the only externally visible trace the
    // predicate leaves.
    //
    // Ten captures — the largest inventory in the manifest — and that is the
    // honest shape of a policy that reads its inputs from four subsystems. Two
    // are owned pure helpers; the other eight stay ports because their far
    // sides (settings, the model registry, the token estimator, the threshold
    // arithmetic) belong to waves that have not run.
    name: "auto-compact-trigger",
    target: "free-function",
    signature: { params: 6, ancestry: ["SourceFile"] },
    anchor: "autocompact: tokens=",
    fn: "autoCompactTrigger",
    captures: [
      {
        // `FD` — `querySource === "compact"`. Pure, two lines, owned.
        as: "isCompactQuerySource",
        kind: "pure-helper",
        owned: true,
        derive: pick("auto-compact-trigger", "isCompactQuerySource", new RegExp(`\\{if\\((${ID})\\(${ID}\\)\\)return!1;if\\(`)),
      },
      {
        // `tC` — membership in a frozen four-string set. Pure, owned with the set.
        as: "isSuppressedQuerySource",
        kind: "pure-helper",
        owned: true,
        derive: pick("auto-compact-trigger", "isSuppressedQuerySource", new RegExp(`return!1;if\\((${ID})\\(${ID}\\)\\)return!1;if\\(!`)),
      },
      {
        // `Qf()` — the `autoCompactEnabled` setting plus two kill-switch env vars.
        as: "autoCompactEnabled",
        kind: "effectful-port",
        derive: pick("auto-compact-trigger", "autoCompactEnabled", new RegExp(`return!1;if\\(!(${ID})\\(\\)\\)return!1;if\\(`)),
      },
      {
        // `QB()` — false only while a remote surface's circuit is closed.
        as: "compactionSurfaceOpen",
        kind: "effectful-port",
        derive: pick("auto-compact-trigger", "compactionSurfaceOpen", new RegExp(`if\\((${ID})\\(\\)&&!${ID}\\(`)),
      },
      {
        // `$G(model, window)` — the window's source is not "auto".
        as: "windowIsConfigured",
        kind: "effectful-port",
        derive: pick("auto-compact-trigger", "windowIsConfigured", new RegExp(`\\(\\)&&!(${ID})\\(${ID},${ID}\\)\\)return!1`)),
      },
      {
        // `Ih(messages, charsPerToken)` — last reported usage plus an estimate
        // of everything after it. The query loop's context accounting (C16).
        as: "contextTokens",
        kind: "effectful-port",
        derive: pick("auto-compact-trigger", "contextTokens", new RegExp(`=(${ID})\\(${ID},${ID}\\(${ID}\\)\\)-`)),
      },
      {
        // `If(model)` — 3 or 4, from the model registry.
        as: "charsPerToken",
        kind: "effectful-port",
        derive: pick("auto-compact-trigger", "charsPerToken", new RegExp(`=${ID}\\(${ID},(${ID})\\(${ID}\\)\\)-`)),
      },
      {
        // `Nee(tokens, model, window)` — ok / warn / compact / blocked.
        as: "classifyContextLevel",
        kind: "effectful-port",
        derive: pick("auto-compact-trigger", "classifyContextLevel", new RegExp(`,${ID}=(${ID})\\(${ID},${ID},${ID}\\);return`)),
      },
      {
        as: "log",
        kind: "effectful-port",
        derive: pick("auto-compact-trigger", "log", new RegExp("return (" + ID + ")\\(`autocompact: tokens=")),
      },
      {
        // `eF(model, window)` — evaluated EAGERLY inside the log line.
        as: "effectiveWindow",
        kind: "effectful-port",
        derive: pick("auto-compact-trigger", "effectiveWindow", new RegExp(`effectiveWindow=\\$\\{(${ID})\\(`)),
      },
    ],
    coverage: ["auto-compact-threshold"],
  },

  // ---- hook dispatch (subsystem/hook-dispatch) -----------------------------
  // W5's six splices, plus C5x's `post-tool-hooks` above. Together they are
  // SEVEN dispatchers covering all EIGHT events the engine fires headlessly —
  // one function (`y9`) serves Stop and SubagentStop through an internal
  // conditional, and the corpus reaches both arms.
  //
  // They share one shape (`async function*`), one anchor family
  // (`hook_event_name:"<Event>"`, prose-free but minifier-stable and unique
  // bundle-wide for six of the seven) and one contract: build ONE hook-input
  // record and `yield*`-delegate the whole execution into the shared executor.
  // What differs between them — and what each module therefore owns — is the
  // record's field set, the guard that decides whether to dispatch at all, and
  // the options the executor is called with.
  //
  // The 23 KB executor itself stays a PORT this wave: the W5–W7 scout measured
  // it S-MODULE-shaped (20+ destructured options, process spawning, timeouts,
  // cancellation), and §2.3 says a stateful core is owned behind a designed port
  // rather than transcribed. It is a ledger edge, not an omission.

  {
    // The narrowest dispatcher, and the one whose record is built from a MESSAGE
    // rather than a tool call. Two things only this one does: it calls the
    // common-prefix builder with TWO arguments (so the record carries no
    // permission_mode/agent_id/agent_type) and it SYNTHESISES its tool-use id
    // from the message it announces.
    name: "message-display-hooks",
    target: "free-function",
    signature: { params: 7, ancestry: ["SourceFile"], generator: true },
    anchor: 'hook_event_name:"MessageDisplay"',
    fn: "messageDisplayHooks",
    captures: [
      {
        as: "createBaseHookInput",
        kind: "effectful-port",
        derive: pick(
          "message-display-hooks",
          "createBaseHookInput",
          new RegExp(`\\{\\.\\.\\.(${ID})\\(${ID},${ID}\\(\\)\\),hook_event_name:"MessageDisplay"`),
        ),
      },
      {
        as: "cwd",
        kind: "effectful-port",
        derive: pick(
          "message-display-hooks",
          "cwd",
          new RegExp(`\\{\\.\\.\\.${ID}\\(${ID},(${ID})\\(\\)\\),hook_event_name:"MessageDisplay"`),
        ),
      },
      {
        // the parameter DEFAULT, evaluated in the chunk's scope (§2.4 `primitive`).
        as: "defaultHookTimeoutMs",
        kind: "primitive",
        derive: pick("message-display-hooks", "defaultHookTimeoutMs", new RegExp(`,${ID}=(${ID}),${ID},${ID}\\)\\{let`)),
      },
      {
        as: "executeHooks",
        kind: "effectful-port",
        derive: pick("message-display-hooks", "executeHooks", new RegExp(`yield\\*(${ID})\\(\\{session:`)),
      },
    ],
    coverage: ["hooks-prompt-submit"],
  },

  {
    // The dispatcher that needs a turn SHAPE, not a matcher: PostToolBatch fires
    // once for a batch of tool calls issued together, so `hooks-batch` demands
    // two tool_use blocks in one assistant message. Its registration guard reads
    // the registry under the FAN-OUT agent ids, which the owned module
    // implements (`shared/hook-agent-context.js`) rather than forwarding.
    name: "post-tool-batch-hooks",
    target: "free-function",
    signature: { params: 6, ancestry: ["SourceFile"], generator: true },
    anchor: 'hook_event_name:"PostToolBatch"',
    fn: "postToolBatchHooks",
    captures: [
      {
        as: "hasHookForEvent",
        kind: "effectful-port",
        derive: pick("post-tool-batch-hooks", "hasHookForEvent", new RegExp(`if\\(!(${ID})\\("PostToolBatch",`)),
      },
      {
        // `Hb` — the fan-out rule. Owned (§2.4 `pure-helper`): footprinted, never
        // forwarded. Its upstream copy stays live for the dispatchers this wave
        // does not take, so splicing here does not make the row dead.
        as: "hookAgentIds",
        kind: "pure-helper",
        owned: true,
        derive: pick(
          "post-tool-batch-hooks",
          "hookAgentIds",
          new RegExp(`${ID}\\.sessionHooksRegistry,(${ID})\\(${ID},"PostToolBatch"`),
        ),
      },
      {
        as: "createBaseHookInput",
        kind: "effectful-port",
        derive: pick(
          "post-tool-batch-hooks",
          "createBaseHookInput",
          new RegExp(`\\{\\.\\.\\.(${ID})\\(${ID}\\.session,${ID}\\(\\),${ID},${ID}\\),hook_event_name:"PostToolBatch"`),
        ),
      },
      {
        as: "cwd",
        kind: "effectful-port",
        derive: pick(
          "post-tool-batch-hooks",
          "cwd",
          new RegExp(`\\{\\.\\.\\.${ID}\\(${ID}\\.session,(${ID})\\(\\),${ID},${ID}\\),hook_event_name:"PostToolBatch"`),
        ),
      },
      {
        as: "defaultHookTimeoutMs",
        kind: "primitive",
        derive: pick("post-tool-batch-hooks", "defaultHookTimeoutMs", new RegExp(`,${ID},${ID}=(${ID})\\)\\{if\\(`)),
      },
      {
        as: "executeHooks",
        kind: "effectful-port",
        derive: pick("post-tool-batch-hooks", "executeHooks", new RegExp(`yield\\*(${ID})\\(\\{session:`)),
      },
    ],
    coverage: ["hooks-batch"],
  },

  {
    // The subagent-start dispatcher. Its executor request is the odd one of the
    // family: the session hooks and the agent context are handed over EXPLICITLY
    // rather than read off a tool-use context, because the context of the agent
    // being started does not exist yet.
    name: "subagent-start-hooks",
    target: "free-function",
    signature: { params: 8, ancestry: ["SourceFile"], generator: true },
    anchor: 'hook_event_name:"SubagentStart"',
    fn: "subagentStartHooks",
    captures: [
      {
        as: "createBaseHookInput",
        kind: "effectful-port",
        derive: pick(
          "subagent-start-hooks",
          "createBaseHookInput",
          new RegExp(`\\{\\.\\.\\.(${ID})\\(${ID}\\.session,${ID}\\(\\)\\),hook_event_name:"SubagentStart"`),
        ),
      },
      {
        as: "cwd",
        kind: "effectful-port",
        derive: pick(
          "subagent-start-hooks",
          "cwd",
          new RegExp(`\\{\\.\\.\\.${ID}\\(${ID}\\.session,(${ID})\\(\\)\\),hook_event_name:"SubagentStart"`),
        ),
      },
      {
        as: "defaultHookTimeoutMs",
        kind: "primitive",
        derive: pick("subagent-start-hooks", "defaultHookTimeoutMs", new RegExp(`,${ID}=(${ID}),${ID},${ID},${ID}\\)\\{let`)),
      },
      {
        // `randomUUID`, imported into the chunk: this event has no real tool
        // call, so its correlation id is minted.
        as: "uuid",
        kind: "effectful-port",
        derive: pick("subagent-start-hooks", "uuid", new RegExp(`toolUseID:(${ID})\\(\\),matchQuery:`)),
      },
      {
        as: "executeHooks",
        kind: "effectful-port",
        derive: pick("subagent-start-hooks", "executeHooks", new RegExp(`yield\\*(${ID})\\(\\{session:`)),
      },
    ],
    coverage: ["hooks-subagent"],
  },

  {
    // The only dispatcher whose results change the CONVERSATION — a hook's
    // `additionalContext` is folded into the prompt the model sees — and the
    // only one with its own timeout (30 s, not the shared 600 s).
    //
    // SIBLING-DISAMBIGUATED. `hook_event_name:"UserPromptSubmit"` occurs twice,
    // both inside chunk-fy12d89p, so a `coLiteral` cannot separate them (it
    // scopes to a chunk). The other carrier is `Y4e`, the REPL-side dispatcher
    // that takes its session hooks and storage directly; it has six parameters
    // where this one has five, so the verified signature selects, and an
    // upstream edit that changed either arity makes the build refuse rather than
    // splice the wrong function.
    name: "user-prompt-submit-hooks",
    target: "free-function",
    signature: { params: 5, ancestry: ["SourceFile"], generator: true },
    anchor: 'hook_event_name:"UserPromptSubmit"',
    siblings: 2,
    fn: "userPromptSubmitHooks",
    captures: [
      {
        as: "hasHookForEvent",
        kind: "effectful-port",
        derive: pick(
          "user-prompt-submit-hooks",
          "hasHookForEvent",
          new RegExp(`${ID}\\.managedHooksOnly&&!(${ID})\\("UserPromptSubmit",`),
        ),
      },
      {
        as: "createBaseHookInput",
        kind: "effectful-port",
        derive: pick(
          "user-prompt-submit-hooks",
          "createBaseHookInput",
          new RegExp(`\\{\\.\\.\\.(${ID})\\(${ID}\\.session,${ID}\\(\\),${ID}\\),hook_event_name:"UserPromptSubmit"`),
        ),
      },
      {
        as: "cwd",
        kind: "effectful-port",
        derive: pick(
          "user-prompt-submit-hooks",
          "cwd",
          new RegExp(`\\{\\.\\.\\.${ID}\\(${ID}\\.session,(${ID})\\(\\),${ID}\\),hook_event_name:"UserPromptSubmit"`),
        ),
      },
      {
        // `Yc` / getCurrentSessionTitle — reads the session store's title cache.
        as: "sessionTitle",
        kind: "effectful-port",
        derive: pick("user-prompt-submit-hooks", "sessionTitle", new RegExp(`session_title:(${ID})\\(${ID}\\.session\\.id\\)`)),
      },
      {
        as: "uuid",
        kind: "effectful-port",
        derive: pick("user-prompt-submit-hooks", "uuid", new RegExp(`toolUseID:(${ID})\\(\\),signal:`)),
      },
      {
        // `I_e` — 30,000 ms, and NOT the shared hook timeout. Forwarded so the
        // adapter can equality-assert it (§2.4 `primitive`): this is the one
        // number in the family that is different on purpose, so it is the one
        // most worth watching for a silent change.
        as: "promptSubmitTimeoutMs",
        kind: "primitive",
        derive: pick("user-prompt-submit-hooks", "promptSubmitTimeoutMs", new RegExp(`timeoutMs:(${ID}),toolUseContext:`)),
      },
      {
        as: "executeHooks",
        kind: "effectful-port",
        derive: pick("user-prompt-submit-hooks", "executeHooks", new RegExp(`yield\\*(${ID})\\(\\{session:`)),
      },
    ],
    coverage: ["hooks-prompt-submit"],
  },

  {
    // ONE function, TWO events: an agent id decides whether the record is a
    // SubagentStop (with `agent_id`, `agent_transcript_path`, `agent_type`) or
    // the session's own Stop. Both arms are covered — `hooks-prompt-submit` for
    // the plain Stop, `hooks-subagent` for a run that fires the subagent arm and
    // then the parent's.
    //
    // Anchored on the SubagentStop literal rather than the Stop one: both are
    // unique, and this is the arm whose field set the anchor names.
    //
    // Four of its free variables are owned pure helpers rather than ports — the
    // two agent-context predicates and the two message-text helpers — so the
    // module reimplements the rule that decides `last_assistant_message` rather
    // than calling the graph's.
    name: "stop-hooks",
    target: "free-function",
    signature: { params: 9, ancestry: ["SourceFile"], generator: true },
    anchor: 'hook_event_name:"SubagentStop"',
    fn: "stopHooks",
    captures: [
      {
        as: "defaultHookTimeoutMs",
        kind: "primitive",
        derive: pick("stop-hooks", "defaultHookTimeoutMs", new RegExp(`,${ID}=(${ID}),${ID}=!1,`)),
      },
      {
        // `ka` — the delegated-observation subagent predicate, the guard that
        // refuses outright.
        as: "isDelegatedObservationSubagent",
        kind: "pure-helper",
        owned: true,
        derive: pick("stop-hooks", "isDelegatedObservationSubagent", new RegExp(`if\\((${ID})\\(${ID}\\.agentContext\\)\\)return`)),
      },
      {
        // `DR` — the built-in web-fetch subagent predicate, which both bypasses
        // the registration guard and narrows the executor to managed hooks.
        as: "isBuiltInWebFetchSubagent",
        kind: "pure-helper",
        owned: true,
        derive: pick("stop-hooks", "isBuiltInWebFetchSubagent", new RegExp(`let ${ID}=(${ID})\\(${ID}\\.agentContext\\),`)),
      },
      {
        as: "hasHookForEvent",
        kind: "effectful-port",
        derive: pick("stop-hooks", "hasHookForEvent", new RegExp(`&&!(${ID})\\(${ID},${ID}\\.sessionHooksRegistry,${ID}\\)\\)return`)),
      },
      {
        // `Wy` — the last assistant message of the turn.
        as: "lastAssistantMessage",
        kind: "pure-helper",
        owned: true,
        derive: pick("stop-hooks", "lastAssistantMessage", new RegExp(`=${ID}\\?(${ID})\\(${ID}\\):void 0,`)),
      },
      {
        // `zr` — its text blocks, joined.
        as: "textOfContent",
        kind: "pure-helper",
        owned: true,
        derive: pick("stop-hooks", "textOfContent", new RegExp(`=${ID}\\?(${ID})\\(${ID}\\.message\\.content,`)),
      },
      {
        // `Gxt` — the task registry's wire projection. A ledger edge to the
        // background-task subsystem, whose wave owns the far side.
        as: "backgroundTasks",
        kind: "effectful-port",
        derive: pick("stop-hooks", "backgroundTasks", new RegExp(`background_tasks:(${ID})\\(`)),
      },
      {
        as: "sessionCrons",
        kind: "effectful-port",
        derive: pick("stop-hooks", "sessionCrons", new RegExp(`session_crons:(${ID})\\(\\)`)),
      },
      {
        as: "createBaseHookInput",
        kind: "effectful-port",
        derive: pick(
          "stop-hooks",
          "createBaseHookInput",
          new RegExp(`,${ID}=(${ID})\\(${ID}\\.session,${ID}\\(\\),${ID},${ID}\\),${ID}=${ID}\\?\\{`),
        ),
      },
      {
        as: "cwd",
        kind: "effectful-port",
        derive: pick(
          "stop-hooks",
          "cwd",
          new RegExp(`,${ID}=${ID}\\(${ID}\\.session,(${ID})\\(\\),${ID},${ID}\\),${ID}=${ID}\\?\\{`),
        ),
      },
      {
        // `mp` — the child agent's transcript file. A ledger edge to session storage.
        as: "agentTranscriptPath",
        kind: "effectful-port",
        derive: pick("stop-hooks", "agentTranscriptPath", new RegExp(`agent_transcript_path:(${ID})\\(${ID}\\),`)),
      },
      {
        as: "uuid",
        kind: "effectful-port",
        derive: pick("stop-hooks", "uuid", new RegExp(`toolUseID:(${ID})\\(\\),signal:`)),
      },
      {
        as: "executeHooks",
        kind: "effectful-port",
        derive: pick("stop-hooks", "executeHooks", new RegExp(`yield\\*(${ID})\\(\\{session:`)),
      },
    ],
    coverage: ["hooks-prompt-submit", "hooks-subagent"],
  },

  {
    // The largest dispatcher and the only one with two execution paths: the
    // in-process FUNCTION-HOOK CHAIN (which can rewrite a tool's input, deny it
    // or defer it) and the plain settings-hook execution it falls back to. Which
    // one runs is decided by a managed pass, a module-handler registry and a
    // plain-object test on the tool input — three reads, one of which
    // (`isPlainObject`) the owned module implements outright.
    name: "pre-tool-hooks",
    target: "free-function",
    signature: { params: 8, ancestry: ["SourceFile"], generator: true },
    anchor: 'hook_event_name:"PreToolUse"',
    fn: "preToolHooks",
    captures: [
      {
        // `dl` — the stable-key namespace. Captured as the NAMESPACE, because
        // that is what the body references; the owned module calls
        // `.stableKey` through it.
        as: "stableKeys",
        kind: "effectful-port",
        derive: pick("pre-tool-hooks", "stableKeys", new RegExp(`(${ID})\\.stableKey\\(`)),
      },
      {
        // `Pd` — the in-process module-handler registry namespace.
        as: "moduleHandlers",
        kind: "effectful-port",
        derive: pick("pre-tool-hooks", "moduleHandlers", new RegExp(`(${ID})\\.hasModuleHandlers\\("PreToolUse"\\)`)),
      },
      {
        // `He` — the plain-object test. Owned (§2.4 `pure-helper`): it decides
        // whether the tool call is eligible for the chain at all, and it has
        // callers all over the engine, so upstream's copy stays live.
        as: "isPlainObject",
        kind: "pure-helper",
        owned: true,
        derive: pick("pre-tool-hooks", "isPlainObject", new RegExp(`hasModuleHandlers\\("PreToolUse"\\)\\)&&(${ID})\\(${ID}\\)\\?`)),
      },
      {
        as: "hasHookForEvent",
        kind: "effectful-port",
        derive: pick("pre-tool-hooks", "hasHookForEvent", new RegExp(`&&!(${ID})\\("PreToolUse",${ID}\\.sessionHooksRegistry,`)),
      },
      {
        as: "hookAgentIds",
        kind: "pure-helper",
        owned: true,
        derive: pick("pre-tool-hooks", "hookAgentIds", new RegExp(`${ID}\\.sessionHooksRegistry,(${ID})\\(${ID},"PreToolUse"`)),
      },
      {
        // the verbose logger. Forwarded and CALLED: the log stream is an
        // observable surface, and a dispatcher that stopped logging would be a
        // difference this wave should not introduce.
        as: "log",
        kind: "effectful-port",
        derive: pick("pre-tool-hooks", "log", new RegExp("(" + ID + ")\\(`executePreToolHooks called for tool:")),
      },
      {
        as: "createBaseHookInput",
        kind: "effectful-port",
        derive: pick(
          "pre-tool-hooks",
          "createBaseHookInput",
          new RegExp(`\\{\\.\\.\\.(${ID})\\(${ID}\\.session,${ID}\\(\\),${ID},${ID}\\),hook_event_name:"PreToolUse"`),
        ),
      },
      {
        as: "cwd",
        kind: "effectful-port",
        derive: pick(
          "pre-tool-hooks",
          "cwd",
          new RegExp(`\\{\\.\\.\\.${ID}\\(${ID}\\.session,(${ID})\\(\\),${ID},${ID}\\),hook_event_name:"PreToolUse"`),
        ),
      },
      {
        as: "defaultHookTimeoutMs",
        kind: "primitive",
        derive: pick("pre-tool-hooks", "defaultHookTimeoutMs", new RegExp(`,${ID}=(${ID}),${ID}\\)\\{let ${ID}=${ID}\\.managedPass`)),
      },
      {
        // reached through the inner `runSettingsHooks` closure, which the owned
        // module reimplements — so the executor is a plain `return`, not a
        // `yield*`, at this call site.
        as: "executeHooks",
        kind: "effectful-port",
        derive: pick("pre-tool-hooks", "executeHooks", new RegExp(`return (${ID})\\(\\{session:${ID}\\.session,hookInput:`)),
      },
      {
        // `fW` — the function-hook chain namespace.
        as: "preToolChain",
        kind: "effectful-port",
        derive: pick("pre-tool-hooks", "preToolChain", new RegExp(`of (${ID})\\.executePreToolUseChain\\(`)),
      },
      {
        // `cun` / stripConfinedHookApproval — reads whether the session was
        // launched confined, so a port rather than a pure helper.
        as: "stripConfinedHookApproval",
        kind: "effectful-port",
        derive: pick(
          "pre-tool-hooks",
          "stripConfinedHookApproval",
          new RegExp(`yield (${ID})\\(${ID},"PreToolUse function-hook chain"\\)`),
        ),
      },
    ],
    coverage: ["hooks"],
  },

  // ---- hook dispatch, the four events C8's boundary review found live -------
  // The wave shipped believing eight events fire headlessly. Its probe drove ONE
  // batched tool turn and registered CALLBACKS only, so its negatives were
  // vacuous twice over: the turn created none of the missing firing conditions,
  // and a callback reaches a dispatcher only if that dispatcher hands the
  // executor a session hooks registry. Re-measured with a phase per condition
  // and both kinds of hook, twelve events fire (`w5/probe-hook-events.ts`).
  //
  // These four are the difference, and they break the family's shape in ways the
  // first seven did not:
  //
  //   two of them are NOT generators. `tz` and `ZSe` AWAIT a different executor
  //       (upstream `AE`, the sibling of `jy`) because their callers have no
  //       conversation left to stream results into — so the delegation is a
  //       plain `return`, and `executeHooksAwait` is a second unowned executor
  //       port on the ledger row.
  //   one of them RETURNS A VERDICT the engine obeys. `tz` reduces its results
  //       to custom instructions, a display message and a blocking reason, and
  //       the compactor acts on all three. It is the only dispatcher in the
  //       family whose output is behaviour rather than a stream.
  //   one of them is never seen by a CALLBACK. `vUt`'s dispatch precedes
  //       host-hook registration, so the corpus reaches it through a settings
  //       command hook and the state surface — the second command-hook cell.
  //       (The first fix read that silence as structural, on the reasoning that
  //       `vUt` passes no registry. The registry fact is true; the inference is
  //       not, and C8's second round withdrew it — `Options.hooks` entries live
  //       in a global store the executor's lookup consults unconditionally.)

  {
    // The OTHER arm of a tool call: upstream runs failure and success through
    // two dispatchers off one call site, and a corpus whose tools always succeed
    // grades one of them. `hooks-tool-failure` runs a command that does not
    // exist, which is the whole reason this row was missing.
    name: "post-tool-failure-hooks",
    target: "free-function",
    signature: { params: 10, ancestry: ["SourceFile"], generator: true },
    anchor: 'hook_event_name:"PostToolUseFailure"',
    fn: "postToolFailureHooks",
    captures: [
      {
        as: "hasHookForEvent",
        kind: "effectful-port",
        derive: pick("post-tool-failure-hooks", "hasHookForEvent", new RegExp(`if\\(!(${ID})\\("PostToolUseFailure",`)),
      },
      {
        as: "hookAgentIds",
        kind: "pure-helper",
        owned: true,
        derive: pick(
          "post-tool-failure-hooks",
          "hookAgentIds",
          new RegExp(`${ID}\\.sessionHooksRegistry,(${ID})\\(${ID},"PostToolUseFailure"`),
        ),
      },
      {
        as: "createBaseHookInput",
        kind: "effectful-port",
        derive: pick(
          "post-tool-failure-hooks",
          "createBaseHookInput",
          new RegExp(`\\{\\.\\.\\.(${ID})\\(${ID}\\.session,${ID}\\(\\),${ID},${ID}\\),hook_event_name:"PostToolUseFailure"`),
        ),
      },
      {
        as: "cwd",
        kind: "effectful-port",
        derive: pick(
          "post-tool-failure-hooks",
          "cwd",
          new RegExp(`\\{\\.\\.\\.${ID}\\(${ID}\\.session,(${ID})\\(\\),${ID},${ID}\\),hook_event_name:"PostToolUseFailure"`),
        ),
      },
      {
        as: "defaultHookTimeoutMs",
        kind: "primitive",
        derive: pick("post-tool-failure-hooks", "defaultHookTimeoutMs", new RegExp(`,${ID}=(${ID}),${ID}\\)\\{if\\(!`)),
      },
      {
        as: "executeHooks",
        kind: "effectful-port",
        derive: pick("post-tool-failure-hooks", "executeHooks", new RegExp(`yield\\*(${ID})\\(\\{session:`)),
      },
    ],
    coverage: ["hooks-tool-failure"],
  },

  {
    // The event no callback observes — not structurally (SDK callbacks land in a
    // global store the executor consults unconditionally) but because this
    // dispatch precedes host-hook registration. Its record is graded as the BYTE
    // STREAM a command hook reads, on the state surface, because that is the
    // only surface it has, and `hooks-session-start` asserts the callback stays
    // silent beside it.
    name: "session-start-hooks",
    target: "free-function",
    signature: { params: 12, ancestry: ["SourceFile"], generator: true },
    anchor: 'hook_event_name:"SessionStart"',
    fn: "sessionStartHooks",
    captures: [
      {
        as: "createBaseHookInput",
        kind: "effectful-port",
        derive: pick(
          "session-start-hooks",
          "createBaseHookInput",
          new RegExp(`\\{\\.\\.\\.(${ID})\\(${ID},${ID}\\(\\)\\),hook_event_name:"SessionStart"`),
        ),
      },
      {
        as: "cwd",
        kind: "effectful-port",
        derive: pick(
          "session-start-hooks",
          "cwd",
          new RegExp(`\\{\\.\\.\\.${ID}\\(${ID},(${ID})\\(\\)\\),hook_event_name:"SessionStart"`),
        ),
      },
      {
        // `Gu` — the session-id coercion applied to the OVERRIDE only.
        as: "sessionId",
        kind: "effectful-port",
        derive: pick("session-start-hooks", "sessionId", new RegExp(`\\{id:(${ID})\\(${ID}\\),project:`)),
      },
      {
        // `Yc` — reads the app's current session state, so a port.
        as: "sessionTitle",
        kind: "effectful-port",
        derive: pick("session-start-hooks", "sessionTitle", new RegExp(`session_title:${ID}\\?\\?(${ID})\\(${ID}\\.id\\)`)),
      },
      {
        // `tx` — takes the activity refcount hold this dispatch is bracketed by.
        as: "beginActivity",
        kind: "effectful-port",
        derive: pick("session-start-hooks", "beginActivity", new RegExp(`;(${ID})\\("hook_exec",${ID}\\);try\\{`)),
      },
      {
        as: "uuid",
        kind: "effectful-port",
        derive: pick("session-start-hooks", "uuid", new RegExp(`toolUseID:(${ID})\\(\\),matchQuery:`)),
      },
      {
        as: "executeHooks",
        kind: "effectful-port",
        derive: pick("session-start-hooks", "executeHooks", new RegExp(`yield\\*(${ID})\\(\\{session:`)),
      },
      {
        // `ox` — releases the hold, in a `finally`, so an executor that throws
        // still releases it.
        as: "endActivity",
        kind: "effectful-port",
        derive: pick("session-start-hooks", "endActivity", new RegExp(`\\}finally\\{(${ID})\\("hook_exec",`)),
      },
      {
        as: "defaultHookTimeoutMs",
        kind: "primitive",
        derive: pick("session-start-hooks", "defaultHookTimeoutMs", new RegExp(`,${ID}=(${ID}),${ID},${ID},${ID},${ID}\\)\\{let`)),
      },
      {
        // `Uie` — the hold's reason string. A `primitive`, so it is forwarded
        // and equality-asserted: its VALUE moving would move no anchor and no
        // target hash.
        as: "activityHold",
        kind: "primitive",
        derive: pick("session-start-hooks", "activityHold", new RegExp(`\\("hook_exec",(${ID})\\);try\\{`)),
      },
    ],
    coverage: ["hooks-session-start"],
  },

  {
    // Not a generator, and the first in the family: a session that is ending has
    // no conversation to stream hook results into, so this one awaits them and
    // consumes them itself — stderr for the failures, then an unconditional
    // registry teardown. `/clear` is upstream's one headlessly reachable call
    // site, and `hooks-session-end` drives it.
    name: "session-end-hooks",
    target: "free-function",
    signature: { params: 3, ancestry: ["SourceFile"] },
    anchor: 'hook_event_name:"SessionEnd"',
    fn: "sessionEndHooks",
    captures: [
      {
        as: "createBaseHookInput",
        kind: "effectful-port",
        derive: pick(
          "session-end-hooks",
          "createBaseHookInput",
          new RegExp(`\\{\\.\\.\\.(${ID})\\(${ID},${ID}\\(\\)\\),hook_event_name:"SessionEnd"`),
        ),
      },
      {
        as: "cwd",
        kind: "effectful-port",
        derive: pick(
          "session-end-hooks",
          "cwd",
          new RegExp(`\\{\\.\\.\\.${ID}\\(${ID},(${ID})\\(\\)\\),hook_event_name:"SessionEnd"`),
        ),
      },
      {
        // `AE` — the AWAITING executor, the sibling of `jy` the generator
        // dispatchers delegate into. A second unowned executor, and a second
        // ledger edge.
        as: "executeHooksAwait",
        kind: "effectful-port",
        derive: pick("session-end-hooks", "executeHooksAwait", new RegExp(`await (${ID})\\(\\{session:`)),
      },
      {
        // `oun` — 1500 ms, and NOT the shared 600,000 ms hook timeout. Forwarded
        // so the adapter equality-asserts it: a session is ending, and the
        // engine will not wait ten minutes for a hook holding it open.
        as: "sessionEndTimeoutMs",
        kind: "primitive",
        derive: pick("session-end-hooks", "sessionEndTimeoutMs", new RegExp(`timeoutMs:(${ID}),storageV5:`)),
      },
    ],
    coverage: ["hooks-session-end"],
  },

  {
    // The only dispatcher whose RESULTS the engine acts on: it is awaited on the
    // compaction path and returns a verdict — custom instructions, a display
    // message, a blocking reason — that the compactor obeys. None of the
    // reduction is reachable from a callback that returns `{continue:true}`, so
    // `hooks-precompact` grades the record and the no-op arm and the parity
    // oracle grades the rest.
    name: "pre-compact-hooks",
    target: "free-function",
    signature: { params: 5, ancestry: ["SourceFile"] },
    anchor: 'hook_event_name:"PreCompact"',
    fn: "preCompactHooks",
    captures: [
      {
        // `ka` — already owned by the stop dispatcher. Its callers are all over
        // the engine, so upstream's copy stays live and this stays a capture.
        as: "isDelegatedObservationSubagent",
        kind: "pure-helper",
        owned: true,
        derive: pick("pre-compact-hooks", "isDelegatedObservationSubagent", new RegExp(`\\{let ${ID}=(${ID})\\(${ID}\\.agentContext\\),`)),
      },
      {
        as: "createBaseHookInput",
        kind: "effectful-port",
        derive: pick(
          "pre-compact-hooks",
          "createBaseHookInput",
          new RegExp(`\\{\\.\\.\\.(${ID})\\(${ID},${ID}\\(\\)\\),hook_event_name:"PreCompact"`),
        ),
      },
      {
        as: "cwd",
        kind: "effectful-port",
        derive: pick(
          "pre-compact-hooks",
          "cwd",
          new RegExp(`\\{\\.\\.\\.${ID}\\(${ID},(${ID})\\(\\)\\),hook_event_name:"PreCompact"`),
        ),
      },
      {
        as: "executeHooksAwait",
        kind: "effectful-port",
        derive: pick("pre-compact-hooks", "executeHooksAwait", new RegExp(`await (${ID})\\(\\{session:`)),
      },
      {
        as: "defaultHookTimeoutMs",
        kind: "primitive",
        derive: pick("pre-compact-hooks", "defaultHookTimeoutMs", new RegExp(`,${ID}=(${ID})\\)\\{let`)),
      },
    ],
    coverage: ["hooks-precompact"],
  },
  // ---- hook dispatch, the nine events C8's SECOND round found live ---------
  // The first round re-measured the hook set and got twelve. It still chose its
  // own watched list, though, so three live events sat outside the measurement
  // entirely and the six whose conditions nobody created were never asked. This
  // round derives the population from upstream's own dispatcher registry
  // (`research/fixtures/hook-registry-2.1.251.json`, 33 events) and creates a
  // firing condition per event: TWENTY-THREE fire, none of the created
  // conditions came back dead, and ten remain OPEN with their conditions named.
  //
  // These nine are the dispatchers that became spliceable as a result. They add
  // no new SHAPE to the family — every one is a free function that builds one
  // record and hands it to an executor — but they do widen it in three ways:
  //
  //   `CUt` (FileChanged) reaches NEITHER executor. It hands the whole execution
  //       to the watcher-hooks helper it shares with CwdChanged, so its port is
  //       a third unowned execution path and a ledger edge to the file-watcher
  //       subsystem. It is also the only dispatcher in the family that is not
  //       async and takes no timeout.
  //   `kPe` (PostCompact) is PreCompact's sibling with the verdict cut down:
  //       the compaction has already happened, so there is nothing left to block
  //       and no summarisation prompt left to extend, and the reduction is the
  //       display message alone.
  //   `xUt`/`eGe` (TaskCreated/TaskCompleted) are near-twins — same nine
  //       parameters, same record shape, same executor request, one differing
  //       string — and `hooks-tasks` grades both, because a corpus that graded
  //       one would be stating the twinning as a coincidence.
  //
  // TWO REGISTRY EVENTS THAT FIRE ARE DELIBERATELY NOT HERE: PreModelSwitch
  // (`mdt`) and PostModelSwitch (`gdt`). They are the family's only stateful
  // members — between them they reach a plugin loader, a model prefetch and
  // validation preamble, a per-session decision holder that `gdt` MUTATES
  // (`landedOn`, a `pending` queue, an `inFlight` promise set) and a
  // fire-and-forget promise the caller never awaits — about seventeen forwarded
  // ports each. §2.3 puts a stateful core behind a designed port rather than
  // transcribing it, and doubling this wave's capture inventory for two events
  // is not that design. Recorded as a ledger gap, not as an omission.

  {
    // PreCompact's sibling, and the second half of one compaction: upstream's
    // compaction function awaits `tz` and then, after the summary exists, `kPe`.
    // Same awaited shape, same executor, and a verdict cut down to its display
    // half — by the time this runs there is nothing left to block and no
    // summarisation prompt left to extend, so a hook here can change what the
    // operator is TOLD and nothing else.
    //
    // The reduction is therefore PreCompact's display loop exactly, and the
    // early return on zero results is still observable: `{}` has no
    // `userDisplayMessage` key at all, where every later arm sets it (to
    // `undefined` when nothing was said, which JSON then drops — a different
    // thing from never having had the key).
    name: "post-compact-hooks",
    target: "free-function",
    signature: { params: 5, ancestry: ["SourceFile"] },
    anchor: 'hook_event_name:"PostCompact"',
    fn: "postCompactHooks",
    captures: [
      {
        // `ka` — already owned by the stop and pre-compact dispatchers.
        as: "isDelegatedObservationSubagent",
        kind: "pure-helper",
        owned: true,
        derive: pick("post-compact-hooks", "isDelegatedObservationSubagent", new RegExp(`\\{if\\((${ID})\\(${ID}\\.agentContext\\)\\)return\\{\\}`)),
      },
      {
        as: "createBaseHookInput",
        kind: "effectful-port",
        derive: pick(
          "post-compact-hooks",
          "createBaseHookInput",
          new RegExp(`\\{\\.\\.\\.(${ID})\\(${ID},${ID}\\(\\)\\),hook_event_name:"PostCompact"`),
        ),
      },
      {
        as: "cwd",
        kind: "effectful-port",
        derive: pick(
          "post-compact-hooks",
          "cwd",
          new RegExp(`\\{\\.\\.\\.${ID}\\(${ID},(${ID})\\(\\)\\),hook_event_name:"PostCompact"`),
        ),
      },
      {
        as: "executeHooksAwait",
        kind: "effectful-port",
        derive: pick("post-compact-hooks", "executeHooksAwait", new RegExp(`await (${ID})\\(\\{session:`)),
      },
      {
        as: "defaultHookTimeoutMs",
        kind: "primitive",
        derive: pick("post-compact-hooks", "defaultHookTimeoutMs", new RegExp(`,${ID}=(${ID})\\)\\{if\\(`)),
      },
    ],
    coverage: ["hooks-precompact"],
  },

  {
    // The event the first round called the one genuine negative. It was not: its
    // condition is a can_use_tool request left unanswered past the 6000 ms notify
    // timer, and every phase that round ran was under `bypassPermissions`, which
    // skips the permission system entirely — so no timer was ever armed. The
    // dispatcher itself is the family's simplest awaited one: build a record,
    // await the executor, DROP the results. Nothing reads them.
    //
    // Its third parameter is a destructured options bag with a default, so the
    // delegation forwards the bag REBUILT from the bound names (ast.ts,
    // `paramArgs`) — the timeout default is applied once, in the graph, before it
    // crosses. The owned module keeps upstream's own default anyway, so it
    // observes what the excised body observed under either caller.
    name: "notification-hooks",
    target: "free-function",
    signature: { params: 3, ancestry: ["SourceFile"] },
    anchor: 'hook_event_name:"Notification"',
    fn: "notificationHooks",
    captures: [
      {
        as: "createBaseHookInput",
        kind: "effectful-port",
        derive: pick(
          "notification-hooks",
          "createBaseHookInput",
          new RegExp(`\\{\\.\\.\\.(${ID})\\(${ID},${ID}\\(\\)\\),hook_event_name:"Notification"`),
        ),
      },
      {
        as: "cwd",
        kind: "effectful-port",
        derive: pick(
          "notification-hooks",
          "cwd",
          new RegExp(`\\{\\.\\.\\.${ID}\\(${ID},(${ID})\\(\\)\\),hook_event_name:"Notification"`),
        ),
      },
      {
        as: "executeHooksAwait",
        kind: "effectful-port",
        derive: pick("notification-hooks", "executeHooksAwait", new RegExp(`await (${ID})\\(\\{session:`)),
      },
      {
        as: "defaultHookTimeoutMs",
        kind: "primitive",
        derive: pick("notification-hooks", "defaultHookTimeoutMs", new RegExp(`\\{timeoutMs:${ID}=(${ID}),storageV5:`)),
      },
    ],
    coverage: ["hooks-permission"],
  },

  {
    // One dispatch per memory file the engine loads. Its record is the family's
    // oddest: three of its five event-specific fields come out of an options bag
    // that a top-level project memory does not fill, so on the recorded seam
    // they are undefined and JSON drops them — the corpus grades their absence
    // and the parity oracle grades the values.
    //
    // It is also the only dispatcher whose options bag is destructured INSIDE
    // the body (`u ?? {}`) rather than in the parameter list, so unlike
    // Notification the whole bag crosses the seam intact.
    name: "instructions-loaded-hooks",
    target: "free-function",
    signature: { params: 5, ancestry: ["SourceFile"] },
    anchor: 'hook_event_name:"InstructionsLoaded"',
    fn: "instructionsLoadedHooks",
    captures: [
      {
        as: "createBaseHookInput",
        kind: "effectful-port",
        derive: pick(
          "instructions-loaded-hooks",
          "createBaseHookInput",
          new RegExp(`\\{\\.\\.\\.(${ID})\\(${ID},${ID}\\(\\)\\),hook_event_name:"InstructionsLoaded"`),
        ),
      },
      {
        as: "cwd",
        kind: "effectful-port",
        derive: pick(
          "instructions-loaded-hooks",
          "cwd",
          new RegExp(`\\{\\.\\.\\.${ID}\\(${ID},(${ID})\\(\\)\\),hook_event_name:"InstructionsLoaded"`),
        ),
      },
      {
        as: "executeHooksAwait",
        kind: "effectful-port",
        derive: pick("instructions-loaded-hooks", "executeHooksAwait", new RegExp(`await (${ID})\\(\\{session:`)),
      },
      {
        as: "defaultHookTimeoutMs",
        kind: "primitive",
        derive: pick("instructions-loaded-hooks", "defaultHookTimeoutMs", new RegExp(`timeoutMs:${ID}=(${ID}),storageV5:`)),
      },
    ],
    coverage: ["hooks-memory"],
  },

  {
    // The turn-end dispatcher's failure arm. `y9` runs when a turn ENDS; this
    // one runs when a turn ends BADLY — an api_error, a prompt_too_long, an
    // exhausted malformed-tool-use retry — and the two are mutually exclusive,
    // which `hooks-stop-failure` asserts as a split rather than as a presence.
    //
    // Two refusals, and the second is the one that matters most: a session with
    // no StopFailure hook registered returns before building anything, which is
    // the common case on every session in the world and is reachable by no
    // scenario at all (a run with no hook produces no observable). The parity
    // oracle grades it.
    //
    // It is also the only dispatcher in the family that hands the executor BOTH
    // the session hooks registry and `getAppState` off its context — the
    // executor request, not the record, is where this one differs from its
    // siblings.
    name: "stop-failure-hooks",
    target: "free-function",
    signature: { params: 3, ancestry: ["SourceFile"] },
    anchor: 'hook_event_name:"StopFailure"',
    fn: "stopFailureHooks",
    captures: [
      {
        as: "isDelegatedObservationSubagent",
        kind: "pure-helper",
        owned: true,
        derive: pick("stop-failure-hooks", "isDelegatedObservationSubagent", new RegExp(`\\{if\\((${ID})\\(${ID}\\.agentContext\\)\\)return;`)),
      },
      {
        as: "hasHookForEvent",
        kind: "effectful-port",
        derive: pick("stop-failure-hooks", "hasHookForEvent", new RegExp(`if\\(!(${ID})\\("StopFailure",`)),
      },
      {
        // `zr` — already owned by the stop dispatcher.
        as: "textOfContent",
        kind: "pure-helper",
        owned: true,
        derive: pick("stop-failure-hooks", "textOfContent", new RegExp(`let ${ID}=(${ID})\\(${ID}\\.message\\.content,`)),
      },
      {
        as: "createBaseHookInput",
        kind: "effectful-port",
        derive: pick(
          "stop-failure-hooks",
          "createBaseHookInput",
          new RegExp(`\\{\\.\\.\\.(${ID})\\(${ID}\\.session,${ID}\\(\\),void 0,${ID}\\),hook_event_name:"StopFailure"`),
        ),
      },
      {
        as: "cwd",
        kind: "effectful-port",
        derive: pick(
          "stop-failure-hooks",
          "cwd",
          new RegExp(`\\{\\.\\.\\.${ID}\\(${ID}\\.session,(${ID})\\(\\),void 0,${ID}\\),hook_event_name:"StopFailure"`),
        ),
      },
      {
        as: "executeHooksAwait",
        kind: "effectful-port",
        derive: pick("stop-failure-hooks", "executeHooksAwait", new RegExp(`await (${ID})\\(\\{session:`)),
      },
      {
        as: "defaultHookTimeoutMs",
        kind: "primitive",
        derive: pick("stop-failure-hooks", "defaultHookTimeoutMs", new RegExp(`,${ID}=(${ID})\\)\\{if\\(`)),
      },
    ],
    coverage: ["hooks-stop-failure"],
  },

  {
    // Dispatched inside the TaskCreate tool's own `call()` rather than from the
    // query loop, which is why no turn-shaped scenario ever reached it. The
    // record's five event-specific fields are the task's identity plus the
    // teammate and team names, and on a headless run the last two are undefined.
    name: "task-created-hooks",
    target: "free-function",
    signature: { params: 9, ancestry: ["SourceFile"], generator: true },
    anchor: 'hook_event_name:"TaskCreated"',
    fn: "taskCreatedHooks",
    captures: [
      {
        as: "createBaseHookInput",
        kind: "effectful-port",
        derive: pick(
          "task-created-hooks",
          "createBaseHookInput",
          new RegExp(`\\{\\.\\.\\.(${ID})\\(${ID}\\.session,${ID}\\(\\),${ID}\\),hook_event_name:"TaskCreated"`),
        ),
      },
      {
        as: "cwd",
        kind: "effectful-port",
        derive: pick(
          "task-created-hooks",
          "cwd",
          new RegExp(`\\{\\.\\.\\.${ID}\\(${ID}\\.session,(${ID})\\(\\),${ID}\\),hook_event_name:"TaskCreated"`),
        ),
      },
      {
        as: "uuid",
        kind: "effectful-port",
        derive: pick("task-created-hooks", "uuid", new RegExp(`toolUseID:(${ID})\\(\\),signal:`)),
      },
      {
        as: "executeHooks",
        kind: "effectful-port",
        derive: pick("task-created-hooks", "executeHooks", new RegExp(`yield\\*(${ID})\\(\\{session:`)),
      },
      {
        as: "defaultHookTimeoutMs",
        kind: "primitive",
        derive: pick("task-created-hooks", "defaultHookTimeoutMs", new RegExp(`,${ID}=(${ID}),${ID}\\)\\{let`)),
      },
    ],
    coverage: ["hooks-tasks"],
  },

  {
    // `xUt`'s twin, and the only thing that differs between them is the event
    // name each stamps. Two rows rather than one because they are two functions
    // with two anchors and two footprints: an upstream edit to either has to
    // fail on its own row, and a shared row would hide it.
    //
    // Its call sites are not twins, though. TaskCreated is dispatched from the
    // TaskCreate tool; this one from the TaskUpdate arm that moves a status to
    // `completed`, and again from the teammate loop when an owned in-progress
    // task finishes. `hooks-tasks` reaches the first.
    name: "task-completed-hooks",
    target: "free-function",
    signature: { params: 9, ancestry: ["SourceFile"], generator: true },
    anchor: 'hook_event_name:"TaskCompleted"',
    fn: "taskCompletedHooks",
    captures: [
      {
        as: "createBaseHookInput",
        kind: "effectful-port",
        derive: pick(
          "task-completed-hooks",
          "createBaseHookInput",
          new RegExp(`\\{\\.\\.\\.(${ID})\\(${ID}\\.session,${ID}\\(\\),${ID}\\),hook_event_name:"TaskCompleted"`),
        ),
      },
      {
        as: "cwd",
        kind: "effectful-port",
        derive: pick(
          "task-completed-hooks",
          "cwd",
          new RegExp(`\\{\\.\\.\\.${ID}\\(${ID}\\.session,(${ID})\\(\\),${ID}\\),hook_event_name:"TaskCompleted"`),
        ),
      },
      {
        as: "uuid",
        kind: "effectful-port",
        derive: pick("task-completed-hooks", "uuid", new RegExp(`toolUseID:(${ID})\\(\\),signal:`)),
      },
      {
        as: "executeHooks",
        kind: "effectful-port",
        derive: pick("task-completed-hooks", "executeHooks", new RegExp(`yield\\*(${ID})\\(\\{session:`)),
      },
      {
        as: "defaultHookTimeoutMs",
        kind: "primitive",
        derive: pick("task-completed-hooks", "defaultHookTimeoutMs", new RegExp(`,${ID}=(${ID}),${ID}\\)\\{let`)),
      },
    ],
    coverage: ["hooks-tasks"],
  },

  {
    // The dispatcher whose results the PERMISSION system obeys: a hook for this
    // event can allow a tool call, deny it, or hand back a rewritten input, and
    // three separate call sites read `permissionRequestResult` off the stream.
    // It is also the only tool-scoped dispatcher that forwards the REAL
    // tool-use id instead of minting one, because at this point the call exists
    // and has not run.
    //
    // Its record carries `permission_suggestions`, which exists nowhere else:
    // upstream's offer to a hook that wants to rewrite the RULE rather than the
    // call. The seam supplies none, so `hooks-permission` grades its absence.
    name: "permission-request-hooks",
    target: "free-function",
    signature: { params: 8, ancestry: ["SourceFile"], generator: true },
    anchor: 'hook_event_name:"PermissionRequest"',
    fn: "permissionRequestHooks",
    captures: [
      {
        // Forwarded AND CALLED, like the PreToolUse dispatcher's: the verbose
        // log stream is an observable surface, and a dispatcher that stopped
        // logging would be a difference this wave should not introduce.
        as: "log",
        kind: "effectful-port",
        derive: pick("permission-request-hooks", "log", new RegExp("(" + ID + ")\\(`executePermissionRequestHooks called for tool:")),
      },
      {
        as: "createBaseHookInput",
        kind: "effectful-port",
        derive: pick(
          "permission-request-hooks",
          "createBaseHookInput",
          new RegExp(`\\{\\.\\.\\.(${ID})\\(${ID}\\.session,${ID}\\(\\),${ID},${ID}\\),hook_event_name:"PermissionRequest"`),
        ),
      },
      {
        as: "cwd",
        kind: "effectful-port",
        derive: pick(
          "permission-request-hooks",
          "cwd",
          new RegExp(`\\{\\.\\.\\.${ID}\\(${ID}\\.session,(${ID})\\(\\),${ID},${ID}\\),hook_event_name:"PermissionRequest"`),
        ),
      },
      {
        as: "executeHooks",
        kind: "effectful-port",
        derive: pick("permission-request-hooks", "executeHooks", new RegExp(`yield\\*(${ID})\\(\\{session:`)),
      },
      {
        as: "defaultHookTimeoutMs",
        kind: "primitive",
        derive: pick("permission-request-hooks", "defaultHookTimeoutMs", new RegExp(`,${ID}=(${ID})\\)\\{${ID}\\(`)),
      },
    ],
    coverage: ["hooks-permission"],
  },

  {
    // `Tee`'s counterpart on the other side of the decision: PermissionRequest
    // asks, this one REPORTS — and it reports almost nothing, because its single
    // call site is guarded so narrowly that C8 and C9's first round both left the
    // event OPEN.
    //
    // THE GUARD IS THE POINT. Upstream dispatches this event only when the
    // denial's `decisionReason` is `{type:"classifier", classifier:"auto-mode"}`,
    // so no rule denial, no mode denial and no host denial reaches it — C8's
    // probe created an ordinary broker deny with both hook paths armed and
    // measured the event DEAD while `result.permission_denials` filled in. The
    // condition that does create it is the auto-mode classifier's FAIL-CLOSED
    // arm, and `perm-auto-classifier-deny` reaches it by choosing a 400 for the
    // classifier's own API call at record time.
    //
    // It is also the only dispatcher whose results the caller reads for a RETRY
    // flag: a PermissionDenied hook that answers `retry` makes the engine append
    // a companion message inviting another attempt. A dispatcher that yielded
    // nothing would lose that silently, which is what its twin does.
    //
    // Two things are its own within the family. Its record carries `reason` —
    // the denial's sentence — which no other event has; and it is the only
    // tool-scoped dispatcher that carries BOTH the real `tool_use_id` in the
    // record and the same id as the executor's `toolUseID`, where its
    // PermissionRequest sibling puts the id only in the request and spends the
    // record field on `permission_suggestions` instead.
    name: "permission-denied-hooks",
    target: "free-function",
    signature: { params: 8, ancestry: ["SourceFile"], generator: true },
    anchor: 'hook_event_name:"PermissionDenied"',
    fn: "permissionDeniedHooks",
    captures: [
      {
        as: "hasHookForEvent",
        kind: "effectful-port",
        derive: pick("permission-denied-hooks", "hasHookForEvent", new RegExp(`if\\(!(${ID})\\("PermissionDenied",`)),
      },
      {
        // `Hb` — the fan-out rule, already owned by the PostToolBatch
        // dispatcher (§2.4 `pure-helper`): footprinted, never forwarded.
        as: "hookAgentIds",
        kind: "pure-helper",
        owned: true,
        derive: pick(
          "permission-denied-hooks",
          "hookAgentIds",
          new RegExp(`${ID}\\.sessionHooksRegistry,(${ID})\\(${ID},"PermissionDenied"`),
        ),
      },
      {
        as: "createBaseHookInput",
        kind: "effectful-port",
        derive: pick(
          "permission-denied-hooks",
          "createBaseHookInput",
          new RegExp(`\\{\\.\\.\\.(${ID})\\(${ID}\\.session,${ID}\\(\\),${ID},${ID}\\),hook_event_name:"PermissionDenied"`),
        ),
      },
      {
        as: "cwd",
        kind: "effectful-port",
        derive: pick(
          "permission-denied-hooks",
          "cwd",
          new RegExp(`\\{\\.\\.\\.${ID}\\(${ID}\\.session,(${ID})\\(\\),${ID},${ID}\\),hook_event_name:"PermissionDenied"`),
        ),
      },
      {
        as: "executeHooks",
        kind: "effectful-port",
        derive: pick("permission-denied-hooks", "executeHooks", new RegExp(`yield\\*(${ID})\\(\\{session:`)),
      },
      {
        as: "defaultHookTimeoutMs",
        kind: "primitive",
        derive: pick("permission-denied-hooks", "defaultHookTimeoutMs", new RegExp(`,${ID},${ID}=(${ID})\\)\\{if\\(`)),
      },
    ],
    coverage: ["perm-auto-classifier-deny"],
  },

  {
    // Fires when a slash command, a skill or an MCP prompt is EXPANDED into the
    // prompt the model will see — a moment between the user's keystroke and the
    // UserPromptSubmit dispatch that nothing else in the corpus reaches.
    //
    // Two things are its alone. Its registration guard keys on the AGENT id when
    // there is one and the session id otherwise, where every other guarded
    // dispatcher passes a registry and a session id; and its signal comes off
    // the context's own abort controller with the timeout hard-coded to the
    // shared constant, so unlike its siblings it has no timeout parameter at all.
    name: "user-prompt-expansion-hooks",
    target: "free-function",
    signature: { params: 7, ancestry: ["SourceFile"], generator: true },
    anchor: 'hook_event_name:"UserPromptExpansion"',
    fn: "userPromptExpansionHooks",
    captures: [
      {
        as: "hasHookForEvent",
        kind: "effectful-port",
        derive: pick("user-prompt-expansion-hooks", "hasHookForEvent", new RegExp(`if\\(!(${ID})\\("UserPromptExpansion",`)),
      },
      {
        as: "createBaseHookInput",
        kind: "effectful-port",
        derive: pick(
          "user-prompt-expansion-hooks",
          "createBaseHookInput",
          new RegExp(`\\{\\.\\.\\.(${ID})\\(${ID}\\.session,${ID}\\(\\),${ID}\\),hook_event_name:"UserPromptExpansion"`),
        ),
      },
      {
        as: "cwd",
        kind: "effectful-port",
        derive: pick(
          "user-prompt-expansion-hooks",
          "cwd",
          new RegExp(`\\{\\.\\.\\.${ID}\\(${ID}\\.session,(${ID})\\(\\),${ID}\\),hook_event_name:"UserPromptExpansion"`),
        ),
      },
      {
        as: "uuid",
        kind: "effectful-port",
        derive: pick("user-prompt-expansion-hooks", "uuid", new RegExp(`toolUseID:(${ID})\\(\\),signal:`)),
      },
      {
        as: "executeHooks",
        kind: "effectful-port",
        derive: pick("user-prompt-expansion-hooks", "executeHooks", new RegExp(`yield\\*(${ID})\\(\\{session:`)),
      },
      {
        as: "defaultHookTimeoutMs",
        kind: "primitive",
        derive: pick("user-prompt-expansion-hooks", "defaultHookTimeoutMs", new RegExp(`timeoutMs:(${ID}),toolUseContext:`)),
      },
    ],
    coverage: ["hooks-slash"],
  },

  {
    // The only dispatcher the FILESYSTEM reaches rather than the conversation,
    // the only one that is neither async nor a generator, the only one with no
    // timeout, and the only one that talks to neither executor: it hands the
    // whole execution to the watcher-hooks helper it shares with CwdChanged,
    // which awaits the executor and folds the results into the shape the file
    // watcher needs (the results, the union of every `watchPaths` a hook
    // returned, the system messages). That helper is a third unowned execution
    // path and a ledger edge to the file-watcher subsystem.
    //
    // How it is armed is not what the field names suggest: upstream reads the
    // registered FileChanged hooks' MATCHERS, splits each on `|`, resolves the
    // pieces against the cwd and watches those. A hook with no matcher arms
    // nothing, and nothing a hook prints arms it either.
    name: "file-changed-hooks",
    target: "free-function",
    signature: { params: 4, ancestry: ["SourceFile"] },
    anchor: 'hook_event_name:"FileChanged"',
    fn: "fileChangedHooks",
    captures: [
      {
        as: "createBaseHookInput",
        kind: "effectful-port",
        derive: pick(
          "file-changed-hooks",
          "createBaseHookInput",
          new RegExp(`\\{\\.\\.\\.(${ID})\\(${ID},${ID}\\(\\)\\),hook_event_name:"FileChanged"`),
        ),
      },
      {
        as: "cwd",
        kind: "effectful-port",
        derive: pick(
          "file-changed-hooks",
          "cwd",
          new RegExp(`\\{\\.\\.\\.${ID}\\(${ID},(${ID})\\(\\)\\),hook_event_name:"FileChanged"`),
        ),
      },
      {
        // `zxt` — the shared watcher-hook helper. Unowned, and the only
        // execution port in the family that is neither `jy` nor `AE`.
        as: "executeWatcherHooks",
        kind: "effectful-port",
        derive: pick("file-changed-hooks", "executeWatcherHooks", new RegExp(`return (${ID})\\(${ID},${ID},${ID}\\)\\}`)),
      },
    ],
    coverage: ["hooks-file-watch"],
  },

  {
    // W7.5. FileChanged's twin and the family's other watcher event, unspliceable
    // until this wave because nothing had ever created its firing condition: W5
    // left CwdChanged OPEN, correctly, since no phase moved the tracked working
    // directory. The Bash tool appends a `pwd` write to every command and reads
    // it back, so one persisting `cd` is the whole condition — measured FIRED,
    // then recorded as `hooks-cwd-change`.
    //
    // Structurally `AUt` is `CUt` with one string and two record keys changed
    // (114 B against 115 B), so this row is the family template applied
    // unchanged: same arity, same declaration shape, same three ports, same
    // "return the helper's promise rather than awaiting it" contract.
    //
    // ANCHOR: the event literal is exactly what separates the twins, and
    // `hook_event_name:"CwdChanged"` occurs once graph-wide — the same 1/1
    // shape as the FileChanged row above. Do NOT shorten it: bare `CwdChanged`
    // spans six chunks, and `old_cwd:`/`new_cwd:` each occur again in the
    // hook-input schema chunk.
    name: "cwd-changed-hooks",
    target: "free-function",
    signature: { params: 4, ancestry: ["SourceFile"] },
    anchor: 'hook_event_name:"CwdChanged"',
    fn: "cwdChangedHooks",
    captures: [
      {
        as: "createBaseHookInput",
        kind: "effectful-port",
        derive: pick(
          "cwd-changed-hooks",
          "createBaseHookInput",
          new RegExp(`\\{\\.\\.\\.(${ID})\\(${ID},${ID}\\(\\)\\),hook_event_name:"CwdChanged"`),
        ),
      },
      {
        as: "cwd",
        kind: "effectful-port",
        derive: pick(
          "cwd-changed-hooks",
          "cwd",
          new RegExp(`\\{\\.\\.\\.${ID}\\(${ID},(${ID})\\(\\)\\),hook_event_name:"CwdChanged"`),
        ),
      },
      {
        // `zxt` — the shared watcher-hook helper, the same port the FileChanged
        // row forwards. Unowned; the ledger edge to the file-watcher subsystem
        // is now carried by two rows rather than one.
        as: "executeWatcherHooks",
        kind: "effectful-port",
        derive: pick("cwd-changed-hooks", "executeWatcherHooks", new RegExp(`return (${ID})\\(${ID},${ID},${ID}\\)\\}`)),
      },
    ],
    coverage: ["hooks-cwd-change"],
  },

  {
    // W7.6a. NOT a dispatcher — the layer BENEATH them. `Fq` is the only thing
    // in the engine that reads a hook's parsed JSON output, and every one of the
    // executor's four answer paths (internal callback, HTTP, MCP, command) plus
    // the general callback path `d6n` funnels its document through it. So the
    // nineteen dispatchers above decide which hooks run; this decides what a
    // hook's answer MEANS.
    //
    // IT THROWS, on three conditions, and the row owns the throws as behaviour:
    // an unknown legacy `decision`, an unknown PreToolUse `permissionDecision`
    // in the pre-pass, and a `hookSpecificOutput.hookEventName` that disagrees
    // with the caller's `expectedHookEvent`. The internal-callback fast path in
    // `Qxt` has no try/catch around its call, so that third throw reaches the
    // dispatcher; the other three call sites catch. Reproduced, not repaired.
    //
    // ANCHOR: four candidate literals were measured across the 1,802-file graph.
    // Three occur in exactly one file AND exactly once — `Unknown hook decision
    // type: `, `Unknown hook permissionDecision type: ` and `Hook returned
    // incorrect event name: expected `. The fourth, the terminalSequence
    // rejection prose, is in one file but TWICE, so it is not usable without a
    // `siblings` claim. The legacy decision message is taken: it is the oldest
    // and least-churned half of the contract, and it names the function's job.
    //
    // ALL FIVE CAPTURES ARE `effectful-port`, and four of them are effectful in
    // the ordinary sense: the attachment builder mints a uuid and reads a clock,
    // the dead probe reads per-host state and emits telemetry, the JSON
    // serialiser opens a trace span, and the log is the engine log.
    //
    // THE FIFTH IS NOT, AND THE TAXONOMY NAMES IT WRONGLY ON PURPOSE. The
    // terminal-sequence filter `bge` is PURE — it is a parser (`yJt`) and a set
    // of constants, with no clock, no host read and no side effect. It is
    // classified `effectful-port` because the class this manifest has for it is
    // the wrong axis: `pure-helper` means "this module ships an owned COPY", and
    // an owned copy would have to carry the whole parser chain beneath it, which
    // no wave owns and which is not this row's to take. So the honest reading is
    // an UNOWNED PURE CHAIN, FORWARDED — the value is pure, the ownership is
    // somebody else's, and the row forwards the binding rather than duplicating
    // a subgraph it cannot grade. Re-cutting it as `pure-helper` would be worse
    // than the mislabel: it would claim an owned copy this module does not have.
    // Five ledger edges, all to the hook EXECUTOR wave and the layers under it.
    name: "hook-json-contract",
    target: "free-function",
    signature: { params: 1, ancestry: ["SourceFile"] },
    anchor: "Unknown hook decision type: ",
    fn: "hookJsonContract",
    captures: [
      {
        // `bge` — the OSC/BEL allowlist filter. `null` means rejected.
        as: "sanitizeTerminalSequence",
        kind: "effectful-port",
        derive: pick(
          "hook-json-contract",
          "sanitizeTerminalSequence",
          new RegExp(`\\.terminalSequence\\)\\{let ${ID}=(${ID})\\(${ID}\\.terminalSequence\\)`),
        ),
      },
      {
        // `n` — the engine debug log, and the ONLY thing a rejected terminal
        // sequence produces. A hook cannot tell that it was refused.
        as: "logDebug",
        kind: "effectful-port",
        derive: pick(
          "hook-json-contract",
          "logDebug",
          new RegExp(`else (${ID})\\(\`Hook \\$\\{${ID}\\} \\(\\$\\{${ID}\\}\\) returned a terminalSequence`),
        ),
      },
      {
        // `b` — the traced `JSON.stringify` the event-name throw embeds the
        // WHOLE document with.
        as: "stringify",
        kind: "effectful-port",
        derive: pick("hook-json-contract", "stringify", new RegExp(`Full stdout: \\$\\{(${ID})\\(${ID},null,2\\)\\}`)),
      },
      {
        // `R5n` — the dead probe for the legacy MCP rewrite field, fired only
        // when `updatedMCPToolOutput` is truthy and carrying whether the modern
        // `updatedToolOutput` was set alongside it.
        as: "probeMcpRewrite",
        kind: "effectful-port",
        derive: pick(
          "hook-json-contract",
          "probeMcpRewrite",
          new RegExp(`\\.updatedMCPToolOutput\\)(${ID})\\(${ID}\\.hookSpecificOutput\\.updatedToolOutput!==void 0\\)`),
        ),
      },
      {
        // `Mn` — the attachment builder both return arms go through. Its second
        // parameter defaults to a clock and a uuid generator, which is why it is
        // a port and not a helper this module could own.
        as: "hookMessage",
        kind: "effectful-port",
        derive: pick("hook-json-contract", "hookMessage", new RegExp(`\\?(${ID})\\(\\{type:"hook_blocking_error"`)),
      },
    ],
    // The two scenarios whose hooks answer with a `hookSpecificOutput` AND whose
    // answer changes what the engine then does: the UserPromptSubmit arm's
    // injected context, which has to reach the model, and the PermissionRequest
    // arm's deny, which has to reach the tool result. Both are red under the
    // twin, which flattens the nested contract away.
    coverage: ["hooks-prompt-submit", "perm-hook-deny"],
  },

  {
    // "Is this hook-output document SYNCHRONOUS?" (upstream `ip`, 52 B) — and
    // the first of the two splices C10.6's FIX ROUND takes to prove a corrected
    // claim rather than to add bytes.
    //
    // THE CLAIM IT CORRECTS. The wave reported the belt as "not takeable by
    // anchor": 84 of 151 with no string literal, only four of 43 pure ones
    // uniquely anchorable. That measured string literals of twelve characters or
    // more — which is not what an anchor is. `strangle/anchor.ts` asks for a
    // true-substring-unique span carrying no minified identifier, and half this
    // manifest is anchored on structural fragments rather than prose. Re-derived
    // by that rule, 125 of 151 declarations are anchorable and 31 of the 40 pure
    // ones are; the anchor below is `){return!(("async"in `, which contains no
    // literal at all and occurs ONCE in the 1,802-module graph.
    //
    // WHY THIS ONE AND NOT A LARGER ONE. The corrected doctrine is that purity
    // decides whether a helper is WORTH owning and anchorability decides whether
    // it CAN be taken, and worth is a separate argument: a single-caller pure
    // helper folds into its caller's future module (the C7 rule), so only a
    // MULTI-CALLER pure helper is a §2.4 capture in its own right. This is the
    // cheapest anchorable multi-caller pure function in the belt — four
    // consumers, nineteen call sites, 52 bytes — which makes it the cheapest
    // possible demonstration that the population is takeable.
    //
    // `captures: []` IS THE POSITIVE CLAIM: upstream's body has zero free
    // variables, derived from the AST and refused in either direction.
    name: "hook-output-sync",
    target: "free-function",
    signature: { params: 1, ancestry: ["SourceFile"] },
    anchor: '){return!(("async"in ',
    fn: "hookOutputIsSync",
    captures: [],
    // MEASURED DARK, and the measurement is the point of the row rather than a
    // disappointment. It was spliced expecting liveness — nineteen call sites,
    // four consumers — and the inverted twin was built and replayed against
    // EIGHTEEN scenarios — every one that registers a hook of any kind — before the
    // verdict was written. Twelve at the wave; the C10.6-fix verification round
    // found six more hook-registering scenarios the sentence had omitted (hooks,
    // hooks-tasks, hooks-stop-failure, hooks-file-watch, hooks-cwd-change,
    // perm-hook-rewrite), replayed them under the twin, and all eighteen stayed GREEN.
    //
    // DARK IS NOT UNREACHED, and this row is the campaign's clearest example of
    // the difference. The branch attestation records this predicate's FALSE arm
    // on the corpus, so it IS called. What no scenario reaches is a CONSUMER of
    // the answer: every use of it is dominated by a second condition the
    // corpus's hook documents never satisfy — the legacy `decision:"block"`
    // field (both answering hooks use `hookSpecificOutput` instead), a
    // `terminalSequence`, a delegated-observation subagent, or the parser fast
    // path, which only a command hook whose STDOUT parses as JSON reaches and
    // none of the eleven in `w5/scenarios.ts` writes JSON to stdout.
    //
    // So the sibling row `hook-output-async` is live on the same scenarios and
    // this one is not, which is the sharpest available statement of what the
    // corpus reaches: it asks "is this an acknowledgement?" on every callback
    // answer and acts on the reply, and it asks "is this a result?" without ever
    // acting on that one.
    coverage: [],
    darkOver: [
      "hooks-prompt-submit",
      "perm-hook-deny",
      "hooks-permission",
      "hooks-batch",
      "hooks-subagent",
      "hooks-precompact",
      "hooks-command",
      "hooks-session-start",
      "hooks-session-end",
      "hooks-tool-failure",
      "hooks-slash",
      "hooks-memory",
      "hooks",
      "hooks-tasks",
      "hooks-stop-failure",
      "hooks-file-watch",
      "hooks-cwd-change",
      "perm-hook-rewrite",
    ],
    darkReason:
      "The predicate is CALLED — the branch attestation records its false arm on the corpus — but no CONSUMER of the answer reaches an observable: every use of it is dominated by a second condition the corpus never satisfies. The callback sites read the LEGACY decision:\"block\" field while both answering corpus hooks use hookSpecificOutput; the terminal-sequence sink returns early without a terminalSequence; the delegated-observation filter needs a subagent observation; and the parser's fast path needs a command hook whose STDOUT parses as JSON, which none of the eleven in w5/scenarios.ts writes. " +
      "The INVERTED twin was built and replayed over eighteen scenarios — every scenario that registers a hook of any kind (twelve at the wave, six added by the C10.6-fix verification round) — and all stayed GREEN; the SIBLING row hook-output-async, whose twin is the same inversion of the complementary predicate, reddens two of them, so this is the call sites never being reached rather than a weak twin. " +
      "Graded instead by strangle/hooks-parity.test.ts's hook-output-sync block, which runs the WHOLE domain against upstream's own bytes — every document shape the union admits, including the two the corpus cannot make (`async:false` and a non-boolean `async`) — with controls for each of the two decisions the body makes.",
  },

  {
    // "Is this hook-output document an ASYNC ACKNOWLEDGEMENT?" (upstream `mS`,
    // 47 B) — the second of the fix round's two takes, and the complement of the
    // row above. Anchor `){return"async"in `, one occurrence in the graph.
    //
    // NOT the negation of its sibling, even though the bodies say so: upstream
    // declares both, and they guard different things. The sync predicate admits
    // a result document; this one recognises the acknowledgement and takes the
    // BACKGROUNDING path — the subprocess runner adopts the hook as a background
    // job, the awaiting executor returns a bare success, the standalone callback
    // runner returns empty output. Ten call sites over four consumers.
    name: "hook-output-async",
    target: "free-function",
    signature: { params: 1, ancestry: ["SourceFile"] },
    anchor: '){return"async"in ',
    fn: "hookOutputIsAsync",
    captures: [],
    coverage: ["hooks-prompt-submit", "perm-hook-deny"],
  },

  {
    // The text that says WHAT a hook will run (upstream `_9`, 291 B) — the
    // largest MULTI-CALLER pure function in the belt, six consumers inside the
    // layer and nine call sites, and the second live take of the fix round.
    //
    // Its anchor is `;case"callback":return"callback";case"function":return"function"}`:
    // one occurrence in the 1,802-module graph, no minified identifier in it,
    // and no prose either. The first candidate tried — `.type){case"command":return `
    // — occurs in TWO chunks, which is the check the anchor rule exists for and
    // the reason a candidate is counted before it is trusted.
    //
    // WHY IT IS WORTH OWNING and not just takeable: the streaming executor uses
    // the result as the COMMAND IT EXECUTES (after a `${CLAUDE_PLUGIN_ROOT}`
    // substitution), while three other consumers use the same string to identify
    // a hook in an attachment or as the `statusMessage` fallback. That is a
    // multi-caller pure helper in the §2.4 sense — one projection, several
    // fates — rather than a private detail of one caller.
    name: "hook-invocation-text",
    target: "free-function",
    signature: { params: 1, ancestry: ["SourceFile"] },
    anchor: ';case"callback":return"callback";case"function":return"function"}',
    fn: "hookInvocationText",
    captures: [],
    // MEASURED, and narrower than the shape suggests. The twin returns the
    // hook's KIND for every arm, so every command hook runs the wrong command —
    // yet only `hooks-precompact` reddens. `hooks-command`, `hooks-session-start`,
    // `hooks-session-end` and `hooks-tool-failure` all stay GREEN: their hooks
    // project into a FILE or write only to stderr, and neither reaches a graded
    // surface. `hooks-precompact` is the one whose command hook echoes an
    // instruction that has to arrive in the compaction request.
    coverage: ["hooks-precompact"],
  },

  {
    // The stderr tail on a hook-output VALIDATION ERROR (upstream `Xpt`, 96 B) —
    // a pure, multi-caller, anchorable member of the belt, and the second thing
    // Stage 1 took.
    //
    // THE SENTENCE ABOVE USED TO SAY "the belt's ONE genuinely pure,
    // multi-caller, anchorable member", and that was wrong. It rested on a scan
    // for string literals of twelve characters or more — "84 of the 151 carry no
    // string literal, four of the 43 pure ones are uniquely anchorable" — which
    // is not what `strangle/anchor.ts` calls an anchor. Re-derived by the anchor
    // rule, `research/fixtures/hook-helper-belt-<pin>.json` measures 125 of the
    // 151 declarations anchorable and 31 of the 40 pure ones, and the fix round
    // took three more of them (`hook-output-sync`, `hook-output-async`,
    // `hook-invocation-text`). What remains true is the DOCTRINE the wave drew
    // from the wrong number: purity decides whether a helper is worth owning,
    // anchorability decides whether the mechanism can take it, and a
    // single-caller pure helper folds into its caller's future module rather
    // than becoming a row.
    //
    // `captures: []` IS THE POSITIVE CLAIM. Upstream's body has zero free
    // variables and the build derives that from the AST and refuses any
    // mismatch in either direction, so the empty list is "verified zero" rather
    // than an omission — the only row in this manifest that can say so about a
    // function both executors call.
    //
    // THE ANCHOR IS THE PROSE AFTER THE BLANK LINE, not before it. The blank
    // line is two literal newlines INSIDE the template rather than a join, so an
    // anchor taken from the head would have to carry them; `Hook exited ` occurs
    // once in one file and once in that file.
    name: "hook-stderr-tail",
    target: "free-function",
    signature: { params: 3, ancestry: ["SourceFile"] },
    anchor: "Hook exited ",
    fn: "hookStderrTail",
    captures: [],
    // MEASURED DARK, and the verdict is the row's own evidence rather than a
    // shrug. Both call sites are guarded on `xPe(stdout)` having produced a
    // VALIDATION ERROR — not on the hook having failed — so the condition is a
    // command hook whose stdout PARSES AS JSON and then fails the hook-output
    // schema, with a non-zero exit that is also not 2.
    //
    // POPULATION: all 59 corpus scenarios, whose command hooks are the ELEVEN in
    // `w5/scenarios.ts` (counted, not recalled — the first version of this row
    // said ten and mis-split them). SEVEN write nothing to stdout (`exit 1`
    // twice, `true` twice, and three that echo only to stderr before exiting
    // non-zero); TWO `echo` plain text to stdout — which the parser returns as
    // `plainText`, not as a validation error; and TWO are `node -e` projections
    // that write their result to a FILE (`STDIN_PROJECTION`,
    // `SESSION_START_PROJECTION`) and print nothing. None emits a JSON document
    // that then fails the schema, so the guard is never satisfied and the
    // function is never called.
    //
    // THE INVERTED TWIN WAS TRIED FIRST, which is what makes this a measurement.
    // It appends unconditionally rather than only when the hook failed loudly,
    // so it changes the result on EVERY call rather than on the rare input; the
    // obvious twin (`!exitCode`, or the stderr left untrimmed) differs only on
    // the rare one and would have failed in the quiet direction, which is the
    // shape C9's five inert twins established. Built and replayed against
    // `hooks-command` and `hooks-precompact`: both stayed GREEN. That is the
    // call site never being reached, not a weak twin.
    //
    // WHAT GRADES IT INSTEAD: `strangle/hooks-parity.test.ts`, the
    // `hook-stderr-tail` block — the full 90-case cross-product of its three
    // inputs against upstream's own bytes (three error texts x five exit codes
    // including `undefined` x six stderr shapes, which is the whole domain
    // rather than a sample), with seven `mustDiffer` controls, one per decision
    // the body makes.
    //
    // THE CONDITION IS NAMED AND CHEAP, and belongs to the wave that owns the
    // executor: one command hook printing `{"decision":"maybe"}` and exiting 1.
    // It is not taken here because it changes what the engine sends to the model
    // and therefore needs a re-recording, and because the arm it would light is
    // C10.8's rather than this wave's.
    coverage: [],
    // THE POPULATION, AS TAGS THE GATE REPLAYS. The reason below is a claim
    // about what the corpus's command hooks write to stdout; these are the
    // scenarios that register one, or that drive a hook to a loud failure —
    // the ten a reviewer replayed to check the verdict. The liveness loop
    // builds the twin and requires every one of them GREEN, so the day a
    // scenario starts emitting a JSON document that fails the schema, this row
    // fails as "no longer dark" instead of coasting on the prose above.
    darkOver: [
      "hooks-command",
      "hooks-precompact",
      "hooks-session-start",
      "hooks-session-end",
      "hooks-stop-failure",
      "hooks-tool-failure",
      "hooks-file-watch",
      "hooks-cwd-change",
      "hooks-prompt-submit",
      "perm-hook-deny",
    ],
    darkReason:
      "Both call sites are guarded on a hook-output VALIDATION ERROR — stdout that parses as JSON and then fails the schema — with a non-zero exit that is also not 2. " +
      "Measured over all 59 scenarios: of the corpus's ELEVEN command hooks, seven write nothing to stdout, two echo plain text (which the parser returns as plainText, not as a validation error) and two are node -e projections that write to a file, so the guard is never satisfied. " +
      "The INVERTED twin was built and replayed first — it appends unconditionally, so it changes the result on every call rather than on the rare input — and hooks-command and hooks-precompact both stayed GREEN, which is the call site never being reached rather than a weak twin. " +
      "Graded instead by strangle/hooks-parity.test.ts's hook-stderr-tail block: the whole 90-case domain (three error texts x five exit codes including undefined x six stderr shapes) against upstream's own bytes, with seven controls. " +
      "The firing condition is named and cheap — one command hook printing {\"decision\":\"maybe\"} and exiting 1 — but it changes what the engine sends to the model and so needs a re-recording, and the arm it lights is C10.8's.",
  },

  // ---- the control protocol (subsystem/control-protocol) -------------------
  // W7. The seam is NOT the dispatch ladder. `research/fixtures/
  // control-protocol-<pin>.json` derives it from the bundle: fifty-two `else if`
  // arms over fifty-four subtypes, seventeen of them carrying a `continue`
  // relative to the enclosing `for await` and all of them closing over the
  // frame-handler's locals. An excised arm would have to hand its loop control
  // back through a return value, which is a different mechanism, not a
  // generalisation of an existing one.
  //
  // What IS takeable is the named handler each live arm delegates to, and every
  // one of them is a plain top-level function:
  //
  //   initialize-handler        the handshake every SDK session sends
  //   initialize-payload        the ~1 KB answer that handshake returns
  //   permission-mode-setter    set_permission_mode
  //   model-switch              set_model
  //   thinking-config           set_max_thinking_tokens
  //
  // W6 already owns the two response ENVELOPES these answer through
  // (`control-response-success` / `control-response-error`), so the round trip
  // is owned end to end for the subtypes above.
  //
  // ALL FIVE ARE SINGLE-CALLER, and that is fine here for a reason C7's rule
  // makes explicit: the rule refuses a single-caller pure helper whose ONLY
  // caller is itself owned. These callers are the arms, which stay upstream, so
  // each delegation is a real seam the graph crosses.

  {
    // `Sf`. The session's thinking budget, and the only thing a host can change
    // it with.
    //
    // ANCHOR: `budgetTokens:` is a STRUCTURAL anchor (§2.1) — this function
    // emits no prose of its own. Nine carriers bundle-wide, ONE in this chunk,
    // so the `coLiteral` scopes it to the chunk and it is unique there. The
    // co-literal is the initialize arm's own validation sentence, which is
    // unique bundle-wide and lives in the same frame handler; a chunk NAME would
    // not survive a bump (strangle/anchor.ts).
    name: "thinking-config",
    target: "free-function",
    signature: { params: 3, ancestry: ["SourceFile"] },
    anchor: "budgetTokens:",
    coLiteral: "initialize: sdkMcpServers and webSearchIsolationExemptMcpServers",
    fn: "resolveThinkingConfig",
    captures: [
      {
        // `nN` — true when no explicit thinking override is pinned, which is
        // what makes an absent budget resolve to `adaptive` rather than to
        // nothing.
        as: "adaptiveThinkingAllowed",
        kind: "effectful-port",
        derive: pick("thinking-config", "adaptiveThinkingAllowed", new RegExp(`!==void 0&&(${ID})\\(\\)\\?\\{type:"adaptive"`)),
      },
    ],
    coverage: ["raw-protocol"],
  },

  {
    // `um`. The `set_permission_mode` handler — the campaign's SECOND candidate
    // for this seam. C9 spliced `K0`, which composes the same guard with the
    // same transition and reads exactly like a control handler, and measured it
    // dark: the headless runtime never calls it. This one has a single call
    // site and that call site is the arm.
    //
    // ANCHOR: `,context:t};return{ok:` is structural and true-substring-unique
    // BUNDLE-WIDE, which is the strongest a function with no string literal at
    // all can manage. It is also rename-fragile by construction — it names the
    // minified parameter — so the expected failure at a pin bump is a loud
    // missing anchor, not a mis-splice (§2.1 prices exactly this).
    name: "permission-mode-setter",
    target: "free-function",
    signature: { params: 2, ancestry: ["SourceFile"] },
    anchor: ",context:t};return{ok:",
    fn: "applyPermissionModeRequest",
    captures: [
      {
        // `GIe` — W6's `mode-change-guard`. Forwarded, never re-implemented:
        // a second copy here would be two owned answers to one question.
        as: "guardPermissionModeChange",
        kind: "effectful-port",
        derive: pick("permission-mode-setter", "guardPermissionModeChange", new RegExp(`let ${ID}=(${ID})\\(e\\.mode,t\\)`)),
      },
      {
        // `V0` — W6's `mode-transition`, the eight side effects a real change has.
        as: "transitionPermissionMode",
        kind: "effectful-port",
        derive: pick("permission-mode-setter", "transitionPermissionMode", new RegExp(`context:\\{\\.\\.\\.(${ID})\\(t\\.mode,${ID}\\.mode,t\\)`)),
      },
    ],
    coverage: ["raw-protocol", "runtime-setters"],
  },

  {
    // `_f`. The ~1 KB answer to the handshake, and the wave's clearest case of
    // behaviour with no observer: `sdk.mjs` consumes the initialize response, so
    // until the raw driver started sending `initialize` and reading the reply
    // off the wire, not one field of this had ever been graded.
    //
    // ANCHOR: `available_output_styles` — one of the payload's own key names.
    // Five carriers bundle-wide, ONE in this chunk, so the co-literal scopes it.
    // Structural rather than prose (§2.1), and cheap to re-anchor if the key is
    // renamed, which would be a wire-visible change anyway.
    name: "initialize-payload",
    target: "free-function",
    signature: { params: 9, ancestry: ["SourceFile"] },
    anchor: "available_output_styles",
    coLiteral: "initialize: sdkMcpServers and webSearchIsolationExemptMcpServers",
    fn: "buildInitializeResponsePayload",
    captures: [
      {
        // `En` — the settings record the chosen output style comes from.
        as: "settings",
        kind: "effectful-port",
        derive: pick("initialize-payload", "settings", new RegExp(`let ${ID}=(${ID})\\(\\)\\?\\.outputStyle\\|\\|`)),
      },
      {
        // `Zw="default"` — owned as DEFAULT_OUTPUT_STYLE, forwarded so the
        // adapter can equality-assert it.
        as: "defaultOutputStyle",
        kind: "primitive",
        derive: pick("initialize-payload", "defaultOutputStyle", new RegExp(`\\?\\.outputStyle\\|\\|(${ID}),`)),
      },
      {
        as: "listOutputStyles",
        kind: "effectful-port",
        derive: pick("initialize-payload", "listOutputStyles", new RegExp(`=await (${ID})\\(${ID}\\(\\),${ID}\\),`)),
      },
      {
        as: "cwd",
        kind: "effectful-port",
        derive: pick("initialize-payload", "cwd", new RegExp(`=await ${ID}\\((${ID})\\(\\),${ID}\\),`)),
      },
      {
        as: "accountInformation",
        kind: "effectful-port",
        derive: pick("initialize-payload", "accountInformation", new RegExp(`\\),${ID}=(${ID})\\(\\),${ID}=${ID}\\(\\)\\.toolPermissionContext\\.mode`)),
      },
      {
        // `mN` — the VS-Code-entrypoint predicate. It gates BOTH the nudge
        // computation and the two auto-mode payload fields, so one port, two uses.
        as: "isVsCodeEntrypoint",
        kind: "effectful-port",
        derive: pick("initialize-payload", "isVsCodeEntrypoint", new RegExp(`\\.toolPermissionContext\\.mode,${ID}=(${ID})\\(\\)&&${ID}\\(\\)\\?`)),
      },
      {
        as: "autoDefaultNudgeEligible",
        kind: "effectful-port",
        derive: pick("initialize-payload", "autoDefaultNudgeEligible", new RegExp(`\\.toolPermissionContext\\.mode,${ID}=${ID}\\(\\)&&(${ID})\\(\\)\\?`)),
      },
      {
        as: "autoDefaultNudge",
        kind: "effectful-port",
        derive: pick("initialize-payload", "autoDefaultNudge", new RegExp(`\\?(${ID})\\(${ID}\\(\\)\\.toolPermissionContext,\\{requireOnboarding:!1\\}\\)`)),
      },
      {
        as: "toSlashCommands",
        kind: "effectful-port",
        derive: pick("initialize-payload", "toSlashCommands", new RegExp(`\\{commands:(${ID})\\(e\\),agents:`)),
      },
      {
        as: "apiProvider",
        kind: "effectful-port",
        derive: pick("initialize-payload", "apiProvider", new RegExp(`apiProvider:(${ID})\\(\\)\\},pid:process\\.pid`)),
      },
      {
        // `sd` — a mode's host-facing name. Called twice: for the session's own
        // mode and for the nudge's.
        as: "renderPermissionMode",
        kind: "effectful-port",
        derive: pick("initialize-payload", "renderPermissionMode", new RegExp(`current_permission_mode:(${ID})\\(${ID}\\),hooks_applied:`)),
      },
      {
        as: "modeIsDefaultFallback",
        kind: "effectful-port",
        derive: pick("initialize-payload", "modeIsDefaultFallback", new RegExp(`permission_mode_from_default_fallback:(${ID})\\(\\)&&`)),
      },
      {
        as: "feedbackSurveyConfig",
        kind: "effectful-port",
        derive: pick("initialize-payload", "feedbackSurveyConfig", new RegExp(`feedback_survey_config:(${ID})\\(\\),`)),
      },
      {
        as: "analyticsDisabled",
        kind: "effectful-port",
        derive: pick("initialize-payload", "analyticsDisabled", new RegExp(`analytics_disabled:(${ID})\\(\\),`)),
      },
      {
        as: "footerIndicator",
        kind: "effectful-port",
        derive: pick("initialize-payload", "footerIndicator", new RegExp(`footer_indicator:(${ID})\\(\\)\\}`)),
      },
      {
        as: "proactivity",
        kind: "effectful-port",
        derive: pick("initialize-payload", "proactivity", new RegExp(`proactivity:(${ID})\\(${ID}\\(\\)\\),footer_indicator:`)),
      },
      {
        // `fNe` — the operator's stored remote-control preference. Read once and
        // used twice: once as the value, once as the `=== undefined` test that
        // decides whether the session was auto-enabled BY DEFAULT.
        as: "remoteControlPreference",
        kind: "effectful-port",
        derive: pick("initialize-payload", "remoteControlPreference", new RegExp(`\\},${ID}=(${ID})\\(\\),${ID}=!${ID}\\(\\)&&\\(${ID}\\?\\?`)),
      },
      {
        as: "remoteControlSuppressed",
        kind: "effectful-port",
        derive: pick("initialize-payload", "remoteControlSuppressed", new RegExp(`,${ID}=!(${ID})\\(\\)&&\\(${ID}\\?\\?${ID}\\(\\)\\);`)),
      },
      {
        as: "remoteControlDefault",
        kind: "effectful-port",
        derive: pick("initialize-payload", "remoteControlDefault", new RegExp(`&&\\(${ID}\\?\\?(${ID})\\(\\)\\);`)),
      },
      {
        as: "remoteControlAvailable",
        kind: "effectful-port",
        derive: pick("initialize-payload", "remoteControlAvailable", new RegExp(`\\.remote_control_available=(${ID})\\(\\)`)),
      },
      {
        // `I` — the feature-gate resolver. §3.3 pins every gate to its
        // compiled-in default, so the second argument is the answer this row
        // always gets; the port stays forwarded because the RESOLUTION is what a
        // pin bump can change.
        as: "featureGate",
        kind: "effectful-port",
        derive: pick("initialize-payload", "featureGate", new RegExp(`\\.ide_rc_auto_enable_gate=(${ID})\\("tengu_ide_rc_auto_enable"`)),
      },
      {
        as: "fastModeState",
        kind: "effectful-port",
        derive: pick("initialize-payload", "fastModeState", new RegExp(`\\.fast_mode_state=(${ID})\\(${ID}\\?\\?null,`)),
      },
      {
        as: "fastModeDisabledReason",
        kind: "effectful-port",
        derive: pick("initialize-payload", "fastModeDisabledReason", new RegExp(`\\.fast_mode_disabled_reason=(${ID})\\(${ID}\\?\\?null\\)`)),
      },
    ],
    coverage: ["raw-protocol"],
  },

  {
    // `km`. The only control subtype that changes the model request body, and
    // therefore the wave's single required live recording.
    //
    // ANCHOR: `set_model: system_prompt must be a non-empty string when present`
    // — one of its own refusal sentences, true-substring-unique bundle-wide.
    // Prose, which §2.1 measures as the stronger kind. Its sibling
    // `set_model: model must be a string` has two carriers (the interactive
    // driver emits the same sentence), and `set_model failed` lives in the ARM
    // rather than here, so neither of the two more obvious choices would do.
    name: "model-switch",
    target: "free-function",
    signature: { params: 2, ancestry: ["SourceFile"] },
    anchor: "set_model: system_prompt must be a non-empty string when present",
    fn: "applyModelSwitchRequest",
    captures: [
      {
        // `p` / logFeatureBad — six call sites, every refusal arm.
        as: "logFeatureBad",
        kind: "effectful-port",
        derive: pick("model-switch", "logFeatureBad", new RegExp(`\\{if\\((${ID})\\("model_switch","invalid_model_type"\\)`)),
      },
      {
        as: "normalizeModel",
        kind: "effectful-port",
        derive: pick("model-switch", "normalizeModel", new RegExp(`\\?\\?"default",${ID}=(${ID})\\(${ID}\\),`)),
      },
      {
        as: "logEvent",
        kind: "effectful-port",
        derive: pick("model-switch", "logEvent", new RegExp(`if\\((${ID})\\("tengu_set_model_unrecognized"`)),
      },
      {
        as: "enumShape",
        kind: "effectful-port",
        derive: pick("model-switch", "enumShape", new RegExp(`"tengu_set_model_unrecognized",\\{shape:(${ID})\\(`)),
      },
      {
        as: "unrecognizedModelError",
        kind: "effectful-port",
        derive: pick("model-switch", "unrecognizedModelError", new RegExp(`return\\{ok:!1,error:(${ID})\\(${ID}\\(${ID}\\),${ID}\\.suggestion\\)\\}`)),
      },
      {
        as: "describeModel",
        kind: "effectful-port",
        derive: pick("model-switch", "describeModel", new RegExp(`return\\{ok:!1,error:${ID}\\((${ID})\\(${ID}\\),${ID}\\.suggestion\\)\\}`)),
      },
      {
        as: "authTokenSource",
        kind: "effectful-port",
        derive: pick("model-switch", "authTokenSource", new RegExp(`case"blocked":\\{let ${ID}=(${ID})\\(${ID}\\.getActiveModel\\(\\)\\)`)),
      },
      {
        as: "restrictedModelError",
        kind: "effectful-port",
        derive: pick("model-switch", "restrictedModelError", new RegExp(`return\\{ok:!1,error:(${ID})\\(${ID},${ID}\\?\\?${ID}\\(\\)\\)\\}\\}case"default"`)),
      },
      {
        // `at` / getMainLoopModel — four call sites, and the "before" half of
        // the breadcrumb condition.
        as: "activeMainLoopModel",
        kind: "effectful-port",
        derive: pick("model-switch", "activeMainLoopModel", new RegExp(`error:${ID}\\(${ID},${ID}\\?\\?(${ID})\\(\\)\\)\\}\\}case"default"`)),
      },
      {
        as: "defaultMainLoopModel",
        kind: "effectful-port",
        derive: pick("model-switch", "defaultMainLoopModel", new RegExp(`case"default":${ID}=(${ID})\\(\\),${ID}=null`)),
      },
      {
        as: "consultModelSwitchHooks",
        kind: "effectful-port",
        derive: pick("model-switch", "consultModelSwitchHooks", new RegExp(`${ID}=await (${ID})\\(${ID}\\.session,${ID},${ID},"sdk"\\);if\\(${ID}\\.decision`)),
      },
      {
        // `g` / logFeatureSad — the hook refusal and the stepped-down alias.
        as: "logFeatureSad",
        kind: "effectful-port",
        derive: pick("model-switch", "logFeatureSad", new RegExp(`\\{if\\((${ID})\\("model_switch","blocked_by_hook"\\)`)),
      },
      {
        as: "hookRefusalError",
        kind: "effectful-port",
        derive: pick("model-switch", "hookRefusalError", new RegExp(`return\\{ok:!1,error:(${ID})\\(${ID}\\)\\}\\}let`)),
      },
      {
        as: "recordModelChange",
        kind: "effectful-port",
        derive: pick("model-switch", "recordModelChange", new RegExp(`if\\((${ID})\\(${ID}\\.session,${ID}\\(\\),${ID},"sdk"\\),${ID}\\.applyModel`)),
      },
      {
        // `Ot` / parseUserSpecifiedModel — called twice inside the breadcrumb
        // condition, once per side of the comparison.
        as: "parseModel",
        kind: "effectful-port",
        derive: pick("model-switch", "parseModel", new RegExp(`\\|\\|(${ID})\\(${ID}\\)!==${ID}\\(${ID}\\?\\?${ID}\\)\\)&&`)),
      },
      {
        as: "shouldInjectBreadcrumbs",
        kind: "effectful-port",
        derive: pick("model-switch", "shouldInjectBreadcrumbs", new RegExp(`\\)\\)&&(${ID})\\(\\{appliedModel:`)),
      },
      {
        as: "logFeatureOk",
        kind: "effectful-port",
        derive: pick("model-switch", "logFeatureOk", new RegExp(`else (${ID})\\("model_switch"\\);`)),
      },
      {
        as: "toNotice",
        kind: "effectful-port",
        derive: pick("model-switch", "toNotice", new RegExp(`\\{ok:!0,notices:${ID}\\.messages\\.map\\((${ID})\\)\\}`)),
      },
    ],
    coverage: ["raw-protocol"],
  },

  {
    // `Ey`. The handshake handler — maximal liveness in this wave, because every
    // SDK-driven scenario sends exactly one `initialize` before its first prompt
    // and this is where the whole configuration surface is applied.
    //
    // ANCHOR: `tengu_reinit_pending_redelivery`, its own telemetry event and
    // true-substring-unique bundle-wide. Prose (§2.1's stronger kind), and it
    // names the REINITIALIZE arm, which is the half no corpus scenario reaches —
    // an anchor in dark code is fine, an EXCISION with no covering scenario is
    // not, and this one's covering scenarios reach the other half.
    //
    // THIRTY-ONE PORTS AND NO OWNED HELPER, which is unusual and is the row's honest
    // price. This handler's job is effects: it mutates the launch options,
    // registers hook callbacks, rewrites app state and enqueues frames. There is
    // nothing pure in its closure to own.
    name: "initialize-handler",
    target: "free-function",
    signature: { params: 14, ancestry: ["SourceFile"] },
    anchor: "tengu_reinit_pending_redelivery",
    fn: "handleInitialize",
    captures: [
      {
        // `ju` — may the host's hooks be applied at all? Answers `undefined`
        // when the host does not own the stdin origin, which the telemetry and
        // the payload both report as a distinct state from `false`.
        as: "hostOwnsHooks",
        kind: "effectful-port",
        derive: pick("initialize-handler", "hostOwnsHooks", new RegExp(`let ${ID}=(${ID})\\(e,${ID}\\),${ID}=0;`)),
      },
      {
        // `qu` — the deny-shaped answer a RETIRED host hook callback gives, so
        // an in-flight consult cannot hang on a callback nobody will answer.
        as: "retiredCallbackAnswer",
        kind: "effectful-port",
        derive: pick("initialize-handler", "retiredCallbackAnswer", new RegExp(`\\.retireSdkHostHookCallbacks\\((${ID})\\)`)),
      },
      {
        // `El` — registers the callbacks. Two call sites: the reinitialize arm
        // and the ordinary one.
        as: "registerHookCallbacks",
        kind: "effectful-port",
        derive: pick("initialize-handler", "registerHookCallbacks", new RegExp(`\\.retireSdkHostHookCallbacks\\(${ID}\\),(${ID})\\(`)),
      },
      {
        as: "logEvent",
        kind: "effectful-port",
        derive: pick("initialize-handler", "logEvent", new RegExp(`return (${ID})\\("tengu_reinit_pending_redelivery"`)),
      },
      {
        as: "telemetryNumber",
        kind: "effectful-port",
        derive: pick("initialize-handler", "telemetryNumber", new RegExp(`\\{n_pending_permissions:(${ID})\\(`)),
      },
      {
        // `_f` — the payload builder, itself an owned splice. Forwarded rather
        // than imported so sabotaging it alone still reddens through here.
        as: "buildPayload",
        kind: "effectful-port",
        derive: pick("initialize-handler", "buildPayload", new RegExp(`request_id:t,response:await (${ID})\\(_,`)),
      },
      {
        as: "activeAgents",
        kind: "effectful-port",
        derive: pick("initialize-handler", "activeAgents", new RegExp(`request_id:t,response:await ${ID}\\(_,(${ID})\\(${ID}\\(\\)\\),`)),
      },
      {
        as: "onReinitialized",
        kind: "effectful-port",
        derive: pick("initialize-handler", "onReinitialized", new RegExp(`pending_user_dialog_requests:${ID}\\}\\}\\),(${ID})\\(${ID}\\(\\)\\),\\{\\}`)),
      },
      {
        as: "isEmptySystemPrompt",
        kind: "effectful-port",
        derive: pick("initialize-handler", "isEmptySystemPrompt", new RegExp(`\\.systemPrompt=(${ID})\\(e\\.systemPrompt\\)\\?""`)),
      },
      {
        as: "normalizeDialogKinds",
        kind: "effectful-port",
        derive: pick("initialize-handler", "normalizeDialogKinds", new RegExp(`\\{let ${ID}=(${ID})\\(e\\.supportedDialogKinds\\);`)),
      },
      {
        as: "recordDialogKinds",
        kind: "effectful-port",
        derive: pick("initialize-handler", "recordDialogKinds", new RegExp(`\\(e\\.supportedDialogKinds\\);(${ID})\\(${ID},`)),
      },
      {
        as: "isRestartedWorkerEpoch",
        kind: "effectful-port",
        derive: pick("initialize-handler", "isRestartedWorkerEpoch", new RegExp(`\\(e\\.supportedDialogKinds\\);${ID}\\(${ID},(${ID})\\(${ID}\\.CLAUDE_CODE_WORKER_EPOCH\\)`)),
      },
      {
        // the process-environment record, reached for one variable.
        as: "env",
        kind: "effectful-port",
        derive: pick("initialize-handler", "env", new RegExp(`\\((${ID})\\.CLAUDE_CODE_WORKER_EPOCH\\)\\?"attach_time"`)),
      },
      {
        as: "setPerTaskStopAffordance",
        kind: "effectful-port",
        derive: pick("initialize-handler", "setPerTaskStopAffordance", new RegExp(`perTaskStopAffordance===!0\\)(${ID})\\(!0\\)`)),
      },
      {
        as: "applySkills",
        kind: "effectful-port",
        derive: pick("initialize-handler", "applySkills", new RegExp(`e\\.skills!==void 0\\)(${ID})\\(e\\.skills\\)`)),
      },
      {
        as: "parseAgentDefinitions",
        kind: "effectful-port",
        derive: pick("initialize-handler", "parseAgentDefinitions", new RegExp(`if\\(e\\.agents\\)${ID}=(${ID})\\(e\\.agents,"flagSettings"\\)`)),
      },
      {
        as: "mainThreadAgentType",
        kind: "effectful-port",
        derive: pick("initialize-handler", "mainThreadAgentType", new RegExp(`let ${ID}=(${ID})\\(\\)===${ID}\\.agent,`)),
      },
      {
        as: "findAgentDefinition",
        kind: "effectful-port",
        derive: pick("initialize-handler", "findAgentDefinition", new RegExp(`===${ID}\\.agent,${ID}=(${ID})\\(${ID}\\(\\),${ID}\\.agent\\)`)),
      },
      {
        as: "setActiveAgentType",
        kind: "effectful-port",
        derive: pick("initialize-handler", "setActiveAgentType", new RegExp(`if\\((${ID})\\(${ID}\\.agentType\\),`)),
      },
      {
        as: "applyAgentDefinition",
        kind: "effectful-port",
        derive: pick("initialize-handler", "applyAgentDefinition", new RegExp(`\\(${ID}\\.agentType\\),(${ID})\\(${ID}\\),!${ID}\\.systemPrompt`)),
      },
      {
        as: "isBuiltInAgent",
        kind: "effectful-port",
        derive: pick("initialize-handler", "isBuiltInAgent", new RegExp(`\\.systemPrompt&&!(${ID})\\(${ID}\\)\\)\\{let`)),
      },
      {
        as: "parseModel",
        kind: "effectful-port",
        derive: pick("initialize-handler", "parseModel", new RegExp(`!=="inherit"\\)\\{let ${ID}=(${ID})\\(${ID}\\.model\\);`)),
      },
      {
        as: "isExemptModelPick",
        kind: "effectful-port",
        derive: pick("initialize-handler", "isExemptModelPick", new RegExp(`\\(${ID}\\.model\\);if\\((${ID})\\(${ID}\\)\\|\\|`)),
      },
      {
        as: "isModelAllowed",
        kind: "effectful-port",
        derive: pick("initialize-handler", "isModelAllowed", new RegExp(`\\(${ID}\\.model\\);if\\(${ID}\\(${ID}\\)\\|\\|(${ID})\\(${ID}\\)\\)`)),
      },
      {
        as: "applyModelOverride",
        kind: "effectful-port",
        derive: pick("initialize-handler", "applyModelOverride", new RegExp(`\\|\\|${ID}\\(${ID}\\)\\)(${ID})\\(${ID}\\);else ${ID}=${ID}\\.model\\}`)),
      },
      {
        as: "applyJsonSchema",
        kind: "effectful-port",
        derive: pick("initialize-handler", "applyJsonSchema", new RegExp(`if\\(e\\.jsonSchema\\)(${ID})\\(e\\.jsonSchema\\)`)),
      },
      {
        as: "countBy",
        kind: "effectful-port",
        derive: pick("initialize-handler", "countBy", new RegExp(`mcp_pending_count:(${ID})\\(`)),
      },
      {
        as: "mcpNonBlocking",
        kind: "effectful-port",
        derive: pick("initialize-handler", "mcpNonBlocking", new RegExp(`mcpNonBlocking:(${ID})\\(\\),session_mirror:`)),
      },
      {
        // `iN` — the auth-status singleton, reached as a CLASS rather than a
        // function, which is why the owned module calls `getInstance()` on it.
        as: "authStatusService",
        kind: "effectful-port",
        derive: pick("initialize-handler", "authStatusService", new RegExp(`\\{let ${ID}=(${ID})\\.getInstance\\(\\)\\.getStatus\\(\\);`)),
      },
      {
        as: "newUuid",
        kind: "effectful-port",
        derive: pick("initialize-handler", "newUuid", new RegExp(`error:${ID}\\.error,uuid:(${ID})\\(\\),session_id:`)),
      },
      {
        as: "currentSessionId",
        kind: "effectful-port",
        derive: pick("initialize-handler", "currentSessionId", new RegExp(`,session_id:(${ID})\\(\\)\\}\\)\\}return\\{restrictedAgentModel`)),
      },
    ],
    // `raw-protocol` reaches the handler and its answer; `sysprompt-append`
    // reaches the half the driver cannot — the CONFIGURATION, which lands in the
    // next request body rather than on the control wire.
    //
    // `sysprompt-preset` was listed here and MEASURED GREEN under the twin, so
    // it is not a covering scenario and does not stay on the row: the SDK sends
    // a preset selection outside the initialize payload, so the preset scenario
    // reaches this handler with nothing for it to apply. A coverage tag that
    // cannot go red is a row the gate passes without testing.
    coverage: ["raw-protocol", "sysprompt-append"],
  },

  // ---- the moat-tool DESCRIPTION belt (subsystem/moat-tools, C11a / W8a) ----
  //
  // Sixteen rows, one per moat tool whose description the engine renders into
  // every graded request body and which no scenario has ever EXECUTED. That
  // asymmetry is the wave: the ledger assigns C11 twenty tool rows, all twenty
  // put their description and JSON schema on the differential surface on every
  // turn, and sixteen of them do nothing else — so this belt is ~30 KB of owned
  // prose bought with zero new recordings, on a surface where every arm is live.
  //
  // THE POPULATION IS DERIVED, not listed. `research/fixtures/moat-tools-<pin>.json`
  // reads the recorded request bodies for what the engine actually presented
  // (901 bodies, 12 distinct catalogs, baseline 22 tools) and then finds each
  // description's producing DECLARATIONS by searching the graph for the rendered
  // text itself. Five descriptions turn out to have more than one carrier; each
  // row below claims the primary one and the fixture records the remainder, so
  // "we own Workflow's description" is stated as 102 of 110 locatable windows
  // rather than as a whole.
  //
  // THE ANCHORS ARE PROSE AND EACH OCCURS ONCE over the 1,802-file module set.
  // Two of them are NOT the tool's opening sentence, deliberately: CronDelete's
  // and CronList's opening clauses occur twice apiece, once per arm of their own
  // ternary, and an anchor that matches twice inside its own target is a tie the
  // resolver refuses. The derivations obey the same rule one level down — every
  // one is a window that overlaps exactly one renameable identifier, its own
  // capture, so no derivation bets on a second minifier letter.
  //
  // COVERAGE IS TWO TAGS, and the split is measured: thirteen of the sixteen are
  // in all 267 recorded catalogs, so `plain` covers them; AskUserQuestion,
  // EnterPlanMode and ExitPlanMode are in the 51-cassette plan-mode catalog
  // only, so `perm-plan-mode` covers those three.

  {
    name: "cron-create-description",
    target: "free-function",
    signature: { params: 1, ancestry: ["SourceFile"] },
    anchor: "Schedule a prompt to be enqueued at a future time",
    fn: "cronCreateDescription",
    captures: [
      {
        as: "cronCreateToolName",
        kind: "primitive",
        derive: pick("cron-create-description", "cronCreateToolName", new RegExp(`\\$\\{(${ID})\\} re-runs a prompt at fixed wall-clock i`)),
      },
      {
        as: "cronDeleteToolName",
        kind: "primitive",
        derive: pick("cron-create-description", "cronDeleteToolName", new RegExp(`ns a job ID you can pass to \\$\\{(${ID})`)),
      },
      {
        as: "monitorToolName",
        kind: "primitive",
        derive: pick("cron-create-description", "monitorToolName", new RegExp(`the moment something changes, use the \\$\\{(${ID})`)),
      },
      {
        as: "recurringMaxAgeDays",
        kind: "primitive",
        derive: pick("cron-create-description", "recurringMaxAgeDays", new RegExp(`ion lifetime\\. Tell the user about the \\$\\{(${ID})`)),
      },
      {
        as: "monitorEnabled",
        kind: "effectful-port",
        derive: pick("cron-create-description", "monitorEnabled", new RegExp(`\\$\\{(${ID})\\(\\)\\?\`\\n## Not for live watch`)),
      },
    ],
    coverage: ["plain"],
  },

  {
    name: "cron-delete-description",
    target: "free-function",
    signature: { params: 1, ancestry: ["SourceFile"] },
    anchor: "Removes it from .claude/scheduled_tasks.json (durable jobs)",
    fn: "cronDeleteDescription",
    captures: [
      {
        as: "cronCreateToolName",
        kind: "primitive",
        derive: pick("cron-delete-description", "cronCreateToolName", new RegExp(`eduled with \\$\\{(${ID})\\}\\. Removes it from the in-memory session`)),
      },
    ],
    coverage: ["plain"],
  },

  {
    name: "cron-list-description",
    target: "free-function",
    signature: { params: 1, ancestry: ["SourceFile"] },
    anchor: ", both durable (.claude/scheduled_tasks.json) and session-only.",
    fn: "cronListDescription",
    captures: [
      {
        as: "cronCreateToolName",
        kind: "primitive",
        derive: pick("cron-list-description", "cronCreateToolName", new RegExp(`all cron jobs scheduled via \\$\\{(${ID})\\} in this session\\.`)),
      },
    ],
    coverage: ["plain"],
  },

  {
    name: "enter-worktree-description",
    target: "free-function",
    signature: { params: 0, ancestry: ["SourceFile"] },
    anchor: "Use this tool ONLY when explicitly instructed to work in a worktree",
    fn: "enterWorktreeDescription",
    captures: [],
    coverage: ["plain"],
  },

  {
    name: "exit-worktree-description",
    target: "free-function",
    signature: { params: 0, ancestry: ["SourceFile"] },
    anchor: "Exit a worktree session created by EnterWorktree and return",
    fn: "exitWorktreeDescription",
    captures: [],
    coverage: ["plain"],
  },

  {
    name: "report-findings-description",
    target: "variable-declarator",
    signature: { params: 0, ancestry: ["SourceFile"], declarator: 1 },
    anchor: "Report code-review findings as a typed list",
    fn: "reportFindingsDescription",
    captures: [],
    coverage: ["plain"],
  },

  {
    name: "task-stop-description",
    target: "variable-declarator",
    signature: { params: 0, ancestry: ["SourceFile"], declarator: 1 },
    anchor: "- Stops a running background task by its ID",
    fn: "taskStopDescription",
    captures: [],
    coverage: ["plain"],
  },

  {
    name: "remote-trigger-description",
    target: "variable-declarator",
    signature: { params: 0, ancestry: ["SourceFile"], declarator: 2 },
    anchor: "Call the claude.ai remote-trigger API.",
    fn: "remoteTriggerDescription",
    captures: [],
    coverage: ["plain"],
  },

  {
    name: "list-agents-description",
    target: "variable-declarator",
    signature: { params: 0, ancestry: ["SourceFile"], declarator: 0 },
    anchor: "Names are the address: send with",
    fn: "listAgentsDescription",
    valueUngraded:
      "the interpolated SendMessage tool name makes this a template EXPRESSION; `strangle/moat-parity.test.ts` grades the value against upstream's own declarator.",
    captures: [
      {
        as: "sendMessageToolName",
        kind: "primitive",
        derive: pick("list-agents-description", "sendMessageToolName", new RegExp(`ists agents you can \\$\\{(${ID})`)),
      },
    ],
    coverage: ["plain"],
  },

  {
    name: "send-message-description",
    target: "free-function",
    signature: { params: 1, ancestry: ["SourceFile"] },
    anchor: "the name IS the address; there is no separate address syntax",
    fn: "sendMessageDescription",
    captures: [
      {
        as: "listAgentsToolName",
        kind: "primitive",
        derive: pick("send-message-description", "listAgentsToolName", new RegExp(`er it now AND subscribe\\. Never poll \\\\\`\\$\\{(${ID})`)),
      },
      {
        as: "crossSessionEnabled",
        kind: "effectful-port",
        derive: pick("send-message-description", "crossSessionEnabled", new RegExp(`(${ID})\\(\\)\\?\`\\n\\n## Cross-session\\n\\nUs`)),
      },
    ],
    coverage: ["plain"],
  },

  {
    name: "schedule-wakeup-description",
    target: "free-function",
    signature: { params: 1, ancestry: ["SourceFile"] },
    // NOT the "ticks are collapsed" sentence, which reads as the obvious choice
    // and is a TRAP: this chunk single-quotes the string, so its source carries
    // `user\'s` while chunk-fy12d89p carries the same sentence unescaped. An
    // occurrence count over the graph therefore says "unique" and points at the
    // WRONG FILE. Checking the escape layer before counting an anchor is the
    // scout's own rule (§3a, written for `\u2014`); it bites on quoting too.
    anchor: "There is no cache cliff inside that range to pace around",
    fn: "scheduleWakeupDescription",
    captures: [
      {
        as: "scheduleWakeupPreamble",
        kind: "primitive",
        derive: pick("schedule-wakeup-description", "scheduleWakeupPreamble", new RegExp(`\\$\\{(${ID})\\}\\n\\n\\$\\{'Set \`noop: true\` if nothing change`)),
      },
    ],
    coverage: ["plain"],
  },

  {
    name: "task-output-description",
    target: "sibling-method",
    signature: { params: 0, ancestry: ["ObjectLiteralExpression", "SourceFile"] },
    anchor: "DEPRECATED: Background tasks return their output file path",
    fn: "taskOutputDescription",
    captures: [],
    coverage: ["plain"],
  },

  {
    name: "workflow-description",
    target: "variable-declarator",
    signature: { params: 0, ancestry: ["SourceFile"], declarator: 4 },
    anchor: "Execute a workflow script that orchestrates multiple subagents",
    fn: "workflowDescription",
    valueUngraded:
      "the interpolated Agent tool name makes this a template EXPRESSION; `strangle/moat-parity.test.ts` grades the value against upstream's own declarator.",
    captures: [
      {
        as: "agentToolName",
        kind: "primitive",
        derive: pick("workflow-description", "agentToolName", new RegExp(`NOT call this tool\\. Use the \\$\\{(${ID})`)),
      },
    ],
    coverage: ["plain"],
  },

  {
    name: "enter-plan-mode-description",
    target: "free-function",
    signature: { params: 0, ancestry: ["SourceFile"] },
    anchor: "Use this tool proactively when you're about to start",
    fn: "enterPlanModeDescription",
    captures: [
      {
        as: "askUserQuestionToolName",
        kind: "primitive",
        derive: pick("enter-plan-mode-description", "askUserQuestionToolName", new RegExp(`u would use \\$\\{(${ID})\\} to clarify the approach, use EnterPlan`)),
      },
      {
        as: "whatHappensSection",
        kind: "effectful-port",
        derive: pick("enter-plan-mode-description", "whatHappensSection", new RegExp(`\\$\\{(${ID})\\(\\)\\}## Examples\\n\\n### GOOD - Use EnterPlan`)),
      },
      {
        as: "agentToolNote",
        kind: "effectful-port",
        derive: pick("enter-plan-mode-description", "agentToolNote", new RegExp(`(${ID})\\(\\);return\`Use this tool proactively when`)),
      },
    ],
    coverage: ["perm-plan-mode"],
  },

  {
    name: "exit-plan-mode-description",
    target: "variable-declarator",
    signature: { params: 0, ancestry: ["SourceFile"], declarator: 0 },
    anchor: "Use this tool when you are in plan mode and have finished writing",
    fn: "exitPlanModeDescription",
    valueUngraded:
      "the initializer interpolates the AskUserQuestion tool name, so it is a template EXPRESSION and the build cannot fold it. `strangle/moat-parity.test.ts` evaluates upstream's own declarator with upstream's own constant and requires byte identity with this module's output — a stronger check than the fold, because it also grades the arms no request renders.",
    captures: [
      {
        as: "askUserQuestionToolName",
        kind: "primitive",
        derive: pick("exit-plan-mode-description", "askUserQuestionToolName", new RegExp(`s about requirements or approach, use \\$\\{(${ID})`)),
      },
    ],
    coverage: ["perm-plan-mode"],
  },

  {
    name: "ask-user-question-description",
    target: "variable-declarator",
    signature: { params: 0, ancestry: ["SourceFile"], declarator: 2 },
    anchor: "Use this tool only when you are blocked on a decision",
    fn: "askUserQuestionDescription",
    valueUngraded:
      "two interpolated tool names make the initializer a template EXPRESSION; `strangle/moat-parity.test.ts` grades the value against upstream's own declarator, evaluated with upstream's own constants.",
    captures: [
      {
        as: "enterPlanModeToolName",
        kind: "primitive",
        derive: pick("ask-user-question-description", "enterPlanModeToolName", new RegExp(` switch into plan mode, use \\$\\{(${ID})`)),
      },
      {
        as: "exitPlanModeToolName",
        kind: "primitive",
        derive: pick("ask-user-question-description", "exitPlanModeToolName", new RegExp(`er cannot see the plan until you call \\$\\{(${ID})`)),
      },
    ],
    coverage: ["perm-plan-mode"],
  },
];


/**
 * Whole chunks the strangler owns (§2.2). One row so far: the campaign's S-chunk
 * debut, chosen because it is the smallest surface that exercises the whole
 * mechanism — three exports, two of them constants thirteen other chunks read,
 * one function with a single consumer, and two effectful imports that must stay
 * ports.
 */
export const CHUNK_REPLACEMENTS: ChunkReplacement[] = [
  {
    name: "glob-description",
    module: "glob-description",
    // The Glob lean description. Unique graph-wide, and the only literal INSIDE
    // this chunk that is: the full-arm bullets live in a module-level `var`.
    anchor: 'Fast file pattern matching. Supports glob patterns like "**/*.js"',
    exports: [
      {
        // `var ti="Glob"` — the tool-name literal. Thirteen chunks read it: the
        // tool object's `name`, permission-rule matching, hook matchers, prompt
        // prose, tool-name sets, the tool-use counter.
        as: "globToolName",
        kind: "primitive",
        owned: "GLOB_TOOL_NAME",
        derive: pick("glob-description", "globToolName", new RegExp(`var (${ID})="Glob"`)),
        // Anchored on the value, because nothing else says WHICH minified binding
        // is the tool name — which means an upstream value change fails in the
        // NAME derivation above, before this one is reached. What this catches is
        // the owned constant drifting from the pinned bytes. Both loud, but not
        // the same direction; see rule 5 in chunk.ts.
        value: pick("glob-description", "globToolName value", new RegExp(`var ${ID}="(Glob)"`)),
        declare: (name, owned) => `var ${name}=${owned};`,
        coverage: ["search-tools"],
      },
      {
        // `var $s="REPL"` — the grab-bag half, unrelated to Glob.
        as: "replToolName",
        kind: "primitive",
        owned: "REPL_TOOL_NAME",
        derive: pick("glob-description", "replToolName", new RegExp(`var (${ID})="REPL"`)),
        value: pick("glob-description", "replToolName value", new RegExp(`var ${ID}="(REPL)"`)),
        declare: (name, owned) => `var ${name}=${owned};`,
        // No corpus scenario can observe it, and that is a property of the
        // ENGINE rather than of the corpus: the REPL tool is gated behind
        // `ty()`, which requires an interactive entrypoint ("cli"/"remote") and
        // is false on every headless run. Its four readers — REPL content-block
        // matching, `tool_progress` emission, disallowedTools assembly, an
        // allowed-tools predicate — are all downstream of that gate. Measured:
        // the literal "REPL" appears in no recorded request except as prose
        // inside an unrelated tool's description.
        //
        // What grades it instead is stronger than a scenario would be: chunk.ts
        // rule 5 compares the owned constant against the value the PINNED CHUNK
        // declares, every build. A differential red can only see a constant a
        // scenario happens to render; this sees any change at all.
        coverage: [],
        // The population, as tags the gate replays. The two scenarios that
        // render this chunk's tool surface are where a REPL name would first
        // become observable if the entrypoint gate ever opened, so they are
        // what the darkness was measured over; the liveness loop builds the
        // twin and requires both GREEN every run.
        darkOver: ["search-tools", "search-tools-lean"],
        darkReason:
          "the REPL tool is unreachable headlessly (`ty()` requires an interactive entrypoint), so no corpus request can carry this name; " +
          "graded instead by the build-time value comparison against the pinned chunk (chunk.ts rule 5)",
      },
      {
        // `O_n(e)` — the Glob description. One consumer, called both as
        // `description()` (no model) and as `prompt({model})` (the one that
        // fills requestBody.tools[].description).
        as: "globDescription",
        kind: "pure-helper",
        owned: "globDescription",
        derive: pick(
          "glob-description",
          "globDescription",
          new RegExp(`function (${ID})\\(${ID}\\)\\{if\\(${ID}\\(${ID}\\)\\)return'Fast file pattern matching`),
        ),
        declare: (name, owned, port) =>
          `function ${name}(model){return ${owned}(model,${port("leanPrompt")},${port("subagentSteer")})}`,
        coverage: ["search-tools", "search-tools-lean"],
      },
    ],
    imports: [
      {
        // `yt="Agent"` from the pure-constants chunk.
        as: "agentToolName",
        kind: "primitive",
        derive: pick("glob-description", "agentToolName", new RegExp(`use the \\$\\{(${ID})\\} tool instead`)),
      },
      {
        as: "leanPrompt",
        kind: "effectful-port",
        derive: pick("glob-description", "leanPrompt", new RegExp(`\\{if\\((${ID})\\(${ID}\\)\\)return'Fast file pattern`)),
      },
      {
        as: "subagentSteer",
        kind: "effectful-port",
        derive: pick("glob-description", "subagentSteer", new RegExp(`return (${ID})\\(\\)==="default"\\?`)),
      },
    ],
    helpers: [
      { from: "shared/assert.js", names: ["assertGraphValue"] },
      { from: "shared/tool-names.js", names: ["AGENT_TOOL_NAME"] },
    ],
    // The one `primitive` that crosses INTO the replacement rather than out of
    // it. Asserted once at module load, which is where upstream interpolated it.
    prologue: (port) => `assertGraphValue("glob-description","agentToolName",${port("agentToolName")},AGENT_TOOL_NAME);`,
  },
];

/**
 * Everything `--sabotage` accepts, and everything the gate's liveness loop walks.
 * A splice is one target; a chunk replacement is one target PER EXPORT, because
 * §2.2 asks for sabotage evidence per retained export and a whole-chunk twin
 * would pass on any single live export.
 */
export const SABOTAGE_TARGETS: string[] = [
  ...SPLICES.map((sp) => sp.name),
  ...CHUNK_REPLACEMENTS.flatMap((cr) => cr.exports.map((e) => `${cr.name}:${e.as}`)),
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

/**
 * The manifest's own integrity check, run at import so no consumer can read a
 * row that has not passed it.
 *
 * One rule today, and it is the splice counterpart of the guard `chunk.ts` has
 * carried for chunk exports since W2: a splice with no covering scenario must
 * carry a reviewed `darkReason`, and a splice that HAS covering scenarios must
 * not carry one. Both directions matter. Without the first, a row with an empty
 * coverage list reaches the gate's liveness loop and is reported as
 * unprovable — which is correct but late, and says nothing about whether anyone
 * looked. Without the second, a reason could sit beside a live coverage list and
 * quietly become the row's story after the scenarios that covered it were
 * renamed away.
 */
export function manifestViolations(rows: readonly Pick<Splice, "name" | "coverage" | "darkReason" | "darkOver">[]): string[] {
  const bad: string[] = [];
  for (const sp of rows) {
    if (sp.coverage.length === 0 && sp.darkReason === undefined) {
      bad.push(`${sp.name}: declares no covering scenario and no darkReason — an ungated splice must be adjudicated, not left silent`);
    }
    if (sp.coverage.length > 0 && sp.darkReason !== undefined) {
      bad.push(`${sp.name}: declares BOTH covering scenarios and a darkReason — a row is either graded by the corpus or adjudicated, not both`);
    }
    // The second rule, and the one that turns the adjudication into a
    // measurement: a reason must name the population it was measured over, as
    // tags the gate can replay. Both directions, for the same argument the
    // first pair makes — a `darkOver` with no reason is a population nobody
    // adjudicated, and a reason with no `darkOver` is an adjudication nothing
    // re-runs.
    if (sp.darkReason !== undefined && (sp.darkOver === undefined || sp.darkOver.length === 0)) {
      bad.push(`${sp.name}: declares a darkReason with no darkOver — darkness measured over no population is an assertion, and the gate has nothing to re-measure it against`);
    }
    if (sp.darkReason === undefined && sp.darkOver !== undefined) {
      bad.push(`${sp.name}: declares darkOver without a darkReason — a population with no adjudication grades nothing`);
    }
  }
  return bad;
}
{
  // Chunk exports go through the SAME rules: the gate flattens both row types
  // into one liveness loop, so an export adjudicated dark owes the same
  // population a splice does. `chunk.ts` keeps its own build-time refusal for
  // the coverage/reason pair; this adds the `darkOver` half at import, where
  // every consumer of the manifest sees it.
  const bad = manifestViolations([
    ...SPLICES,
    ...CHUNK_REPLACEMENTS.flatMap((cr) => cr.exports.map((e) => ({ name: `${cr.name}:${e.as}`, coverage: e.coverage, darkReason: e.darkReason, darkOver: e.darkOver }))),
  ]);
  if (bad.length > 0) throw new Error(`manifest: ${bad.join("; ")}`);
}
