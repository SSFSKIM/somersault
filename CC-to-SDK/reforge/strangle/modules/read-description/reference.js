// PARITY LAYER (§2.5 `reference`) — the Read tool's description function.
//
// Upstream: `cYn(e,t,s,r)` in chunk-hx5r9amq.js @ 2.1.251, spliced at the
// free-function shape. That chunk is NOT taken whole (15 exports: PDF page-range
// parsing, extension tests, the already-read reminder family, the file-state
// suffix C4 already owns); §2.2's fallback applies and only the description
// function is excised.
//
// ## What the description actually fills
//
// The Read tool object has both a `description()` (the one-liner
// "Read a file from the local filesystem.") and a `prompt({model})`. Only the
// second reaches `requestBody.tools[].description`, and it is the one that calls
// this function — with three strings the CALL SITE computes and passes in, which
// is why they are parameters here and not captures:
//
//   lineNumbering  the cat -n line, tab-aware or not (`XDe() ? sYn : Nmn`)
//   maxSizeClause  the "Files larger than N will return an error" tail, or ""
//   offsetLimitNote  the targeted-range nudge, or the plain offset/limit line
//
// ## Ports and owned values
//
// `leanPrompt` and `pdfCapable` stay §2.4 `effectful-port`s: the first reaches an
// env override, a gate, clientData and a model-family test memoized per host; the
// second reads the SESSION model (`!at().toLowerCase().includes("claude-3-haiku")`),
// which is runtime state rather than a constant. `DEFAULT_LINE_BUDGET` and
// `NO_REREAD_NOTE` are `primitive`s owned here and equality-asserted at the
// adapter on every delegation.

/** Upstream `jVe`: how many lines Read returns when the caller names no limit. */
export const DEFAULT_LINE_BUDGET = 2000;

/**
 * Upstream `n`: the tail both arms append. Leading newline included — upstream
 * interpolates it directly after a sentence with no separator of its own.
 */
export const NO_REREAD_NOTE = `
- Do NOT re-read a file you just edited to verify — Edit/Write would have errored if the change failed, and the harness tracks file state for you.`;

const PDF_LEAN = ' Reads PDFs via the `pages` parameter (e.g. "1-5", max 20 pages/request; required for PDFs over 10 pages).';

const PDF_FULL = `
- This tool can read PDF files (.pdf). For large PDFs (more than 10 pages), you MUST provide the pages parameter to read specific page ranges (e.g., pages: "1-5"). Reading a large PDF without the pages parameter will fail. Maximum 20 pages per request.`;

/**
 * Upstream `cYn`.
 *
 * @param model            the session model id, or undefined
 * @param lineNumbering    call-site string: the cat -n line
 * @param maxSizeClause    call-site string: the max-size tail, or ""
 * @param offsetLimitNote  call-site string: the offset/limit line
 * @param leanPrompt       port: is this model on the lean system prompt?
 * @param pdfCapable       port: does the session model read PDFs?
 */
export function readDescription(model, lineNumbering, maxSizeClause, offsetLimitNote, leanPrompt, pdfCapable) {
  if (leanPrompt(model)) {
    return `Reads a file from the local filesystem.

- \`file_path\` must be an absolute path.
- Reads up to ${DEFAULT_LINE_BUDGET} lines by default${maxSizeClause}.
${offsetLimitNote}
${lineNumbering}
- Reads images (PNG, JPG, …) and presents them visually.${pdfCapable() ? PDF_LEAN : ""} Reads Jupyter notebooks (.ipynb) as cells with outputs.
- Reading a directory, a missing file, or an empty file returns an error or system reminder rather than content.${NO_REREAD_NOTE}`;
  }
  return `Reads a file from the local filesystem. You can access any file directly by using this tool.
Assume this tool is able to read all files on the machine. If the User provides a path to a file assume that path is valid. It is okay to read a file that does not exist; an error will be returned.

Usage:
- The file_path parameter must be an absolute path, not a relative path
- By default, it reads up to ${DEFAULT_LINE_BUDGET} lines starting from the beginning of the file${maxSizeClause}
${offsetLimitNote}
${lineNumbering}
- This tool allows Claude Code to read images (eg PNG, JPG, etc). When reading an image file the contents are presented visually as Claude Code is a multimodal LLM.${pdfCapable() ? PDF_FULL : ""}
- This tool can read Jupyter notebooks (.ipynb files) and returns all cells with their outputs, combining code, text, and visualizations.
- This tool can only read files, not directories. To list files in a directory, use the registered shell tool.
- You will regularly be asked to read screenshots. If the user provides a path to a screenshot, ALWAYS use this tool to view the file at the path. This tool will work with all temporary file paths.
- If you read a file that exists but has empty contents you will receive a system reminder warning in place of file contents.${NO_REREAD_NOTE}`;
}
