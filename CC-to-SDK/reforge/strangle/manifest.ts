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
    coverage: ["hooks"],
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
      "claude-md-memory",
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
    coverage: ["slash-compact"],
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
