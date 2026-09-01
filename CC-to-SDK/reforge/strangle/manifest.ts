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

  // TWO FUNCTIONS THIS WAVE OWNS AND DOES NOT SPLICE, recorded here because the
  // absence is a measurement rather than an oversight. `Ree`
  // (`isAskRuleDrivenReason`, 6 call sites) and `Fy` (`findSafetyCheckReason`,
  // 17 call sites) are both takeable — each has a unique anchor and zero free
  // variables — and each was spliced, built and solo-sabotaged. NEITHER turned a
  // scenario red, and the reason is the same for both: after the pre-check and
  // the rule checker take their own copies, upstream's remaining callers are the
  // mode-aware decision body's auto/dontAsk arms (gate-dead under §3.3) and the
  // broker's ask path, where the corpus's decisions carry no `decisionReason` at
  // all — so a finder that never finds anything returns exactly what the healthy
  // one does.
  //
  // That is C7's doctrine one step out: a single-caller pure helper cannot be a
  // live splice, and neither can a many-caller one whose remaining callers are
  // all dark. Both are owned as `pure-helper` captures in `shared/` — the same
  // treatment the hook fan-out rule and the last-assistant-message pair get —
  // where `strangle/permissions-parity.test.ts` grades them against their own
  // upstream bytes BEFORE either body is built on them (C7's other rule), and
  // where upstream's copies stay untouched and stay live for their own callers.

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
