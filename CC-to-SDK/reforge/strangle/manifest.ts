// The splice manifest — what the strangler has taken ownership of so far.
//
// Its own module because both the build and the gate need to read it, and
// importing it must not run a build. Adding a splice is: write the module + its
// sabotage twin under strangle/modules/, add a row here, name its covering
// scenarios. Nothing else changes.
export const METHOD = "mapToolResultToToolResultBlockParam";

export interface Splice {
  /** key on globalThis.__reforge AND the modules/<name>[.sabotage].js basename */
  name: string;
  /** true-substring-unique anchor inside the target method's body */
  anchor: string;
  /** delegation export name on globalThis.__reforge */
  fn: string;
  /**
   * Derive closure-captured identifiers from the original method body, to be
   * passed as extra delegation args. Throw if the expected shape is missing —
   * a silent [] would build a delegation that references nothing it needs.
   */
  deriveArgs?: (body: string) => string[];
  /** corpus scenarios that exercise this method (the gate's targeted red-check) */
  coverage: string[];
}

export const SPLICES: Splice[] = [
  {
    name: "write-tool-result",
    // the Edit tool has a sibling "has been updated successfully" template; the
    // `.${` tail disambiguates the Write tool's
    anchor: "has been updated successfully.${",
    fn: "writeToolResultBlock",
    deriveArgs: (body) => {
      // the freshness-suffix constant: `let s = r || n ? "" : <ident>`
      // (2.1.241 minified it `hui`; 2.1.251 `q6t` — hence derivation, not a constant)
      const m = body.match(/[a-zA-Z_$][\w$]*\s*=\s*[a-zA-Z_$][\w$]*\s*\|\|\s*[a-zA-Z_$][\w$]*\s*\?\s*"":\s*([a-zA-Z_$][\w$]*)/);
      if (!m) throw new Error("write-tool-result: could not derive freshness-suffix identifier");
      return [m[1]];
    },
    coverage: ["file-tools"],
  },
  {
    name: "task-create-result",
    anchor: " created successfully: ",
    fn: "taskCreateResultBlock",
    coverage: ["todo-tool"],
  },
  {
    name: "glob-result",
    anchor: 'content:"No files found"};return',
    fn: "globResultBlock",
    deriveArgs: (body) => {
      // the truncation-notice function: `...e.truncated?[<ident>(e)]:[]`
      // (2.1.241 `yzv`; 2.1.251 `APn`)
      const m = body.match(/e\.truncated\?\[([A-Za-z_$][\w$]*)\(e\)\]/);
      if (!m) throw new Error("glob-result: could not derive truncation-notice identifier");
      return [m[1]];
    },
    coverage: ["search-tools"],
  },
];
