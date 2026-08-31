// PARITY LAYER (§2.5 `reference`) — the Read tool's tool-result formatter.
//
// Upstream: the `mapToolResultToToolResultBlockParam` method of the Read tool's
// object literal (2.1.251, chunk-fy12d89p) — a switch over six result types:
// image, notebook, pdf, parts, file_unchanged, text.
//
// SIX pure helpers are owned here rather than taken from the graph (§2.4):
// the notebook cell folding, the two "already in your context" notices, the
// cat -n line numbering and its single-line form. `formatBytes` is shared with
// the Bash formatter and lives in ../shared.
//
// TWO TYPED PORTS cross the adapter, both belonging to waves that own Read's
// EXECUTION path rather than its formatting:
//
//   stalenessPrefix(result) -> string
//       A SIDE CHANNEL, not an argument: upstream keeps a module-level WeakMap
//       keyed by the result object, populated during the Read tool's `call` for
//       files under a memory directory, and renders
//       "<system-reminder>This memory is N days old…</system-reminder>\n" from a
//       clock-derived day count. Stateful AND time-dependent, so it cannot
//       become owned data at this wave; it is a declared ledger edge to the
//       Read-execution wave. Returns "" whenever the map has no entry, which is
//       every result the corpus produces.
//   tabAwareSeparator() -> boolean
//       A feature-gate read (`tengu_tab_read_sep`), resolving to its compiled-in
//       default under the pinned disabled-gate environment (§3.3). Kept as a
//       port rather than folded to `false`, so the branch it selects stays
//       visible and a gate flip is observable rather than erased.
//
// Corpus coverage, said plainly: `file-tools` renders ONE of the six arms (text,
// with content, tab separator). The other five and both numbering helpers are
// graded by strangle/contracts.test.ts.
import { formatBytes } from "../shared/format-bytes.js";

const ALREADY_IN_CONTEXT = "<system-reminder>This file is already in your context";

/** Upstream `oYn`: the notice for a file re-read after being seeded into context. */
export function seededUnchangedNotice(filePath) {
  return `${ALREADY_IN_CONTEXT} (see "Contents of ${filePath}" above) and has not changed on disk. Use that content instead of re-reading.</system-reminder>`;
}

/** Upstream `rYn`: the notice for a re-read of a file unchanged since the last Read. */
export function unchangedNotice() {
  return "Wasted call — file unchanged since your last Read. Refer to that earlier tool_result instead.";
}

/** Upstream `nVt` (chunk-vvj94wew.js): one `<n><sep><line>` row, CR stripped. */
export function numberOneLine(line, lineNumber, separator) {
  const stripped = line.endsWith("\r") ? line.slice(0, -1) : line;
  return `${lineNumber}${separator}${stripped}`;
}

/**
 * Upstream `tVt` (chunk-vvj94wew.js): cat -n over the file content.
 *
 * The separator is a tab unless the tab-aware gate is on AND the content itself
 * is tab-indented, in which case a colon is used so the numbering cannot be
 * mistaken for the file's own indentation.
 */
export function numberLines({ content, startLine, tabAwareSeparator = false }) {
  if (!content) return "";
  const separator = tabAwareSeparator && (content.startsWith("\t") || content.includes("\n\t")) ? ":" : "\t";
  const out = [];
  let lineNumber = startLine;
  let from = 0;
  let nl = content.indexOf("\n");
  while (nl !== -1) {
    out.push(numberOneLine(content.slice(from, nl), lineNumber++, separator));
    from = nl + 1;
    nl = content.indexOf("\n", from);
  }
  out.push(numberOneLine(content.slice(from), lineNumber, separator));
  return out.join("\n");
}

/** Upstream `NDn`: one notebook cell as a tagged text block. */
function notebookCellBlock(cell) {
  const tags = [];
  if (cell.cellType !== "code") tags.push(`<cell_type>${cell.cellType}</cell_type>`);
  if (cell.language !== "python" && cell.cellType === "code") tags.push(`<language>${cell.language}</language>`);
  return {
    text: `<cell id="${cell.cell_id}">${tags.join("")}${cell.source}</cell id="${cell.cell_id}">`,
    type: "text",
  };
}

/** Upstream `$Dn`: one cell output as zero, one or two content blocks. */
function notebookOutputBlocks(output) {
  const blocks = [];
  if (output.text) blocks.push({ text: `\n${output.text}`, type: "text" });
  if (output.image) {
    blocks.push({
      type: "image",
      source: { data: output.image.image_data, media_type: output.image.media_type, type: "base64" },
    });
  }
  return blocks;
}

/** Upstream `UDn`: a cell plus its outputs, flattened. */
function notebookCellBlocks(cell) {
  return [notebookCellBlock(cell), ...(cell.outputs?.flatMap(notebookOutputBlocks) ?? [])];
}

/**
 * Upstream `hyt`: the whole notebook as one tool_result, with ADJACENT TEXT
 * BLOCKS MERGED (newline-joined) so a notebook without images collapses to a
 * single block. The merge mutates the accumulated block in place, which is
 * observable if a caller held a reference — reproduced as written.
 */
export function notebookResultBlock(cells, toolUseId) {
  const blocks = cells.flatMap(notebookCellBlocks);
  return {
    tool_use_id: toolUseId,
    type: "tool_result",
    content: blocks.reduce((acc, block) => {
      if (acc.length === 0) return [block];
      const last = acc.at(-1);
      if (last && last.type === "text" && block.type === "text") {
        last.text += `\n${block.text}`;
        return acc;
      }
      acc.push(block);
      return acc;
    }, []),
  };
}

export function readToolResultBlock(result, toolUseId, stalenessPrefix, tabAwareSeparator) {
  switch (result.type) {
    case "image":
      return {
        tool_use_id: toolUseId,
        type: "tool_result",
        content: [
          { type: "image", source: { type: "base64", data: result.file.base64, media_type: result.file.type } },
        ],
      };

    case "notebook":
      return notebookResultBlock(result.file.cells, toolUseId);

    case "pdf": {
      const header = `PDF file read: ${result.file.filePath} (${formatBytes(result.file.originalSize)})`;
      return {
        tool_use_id: toolUseId,
        type: "tool_result",
        content: result.file.base64
          ? [
              { type: "text", text: header },
              { type: "document", source: { type: "base64", media_type: "application/pdf", data: result.file.base64 } },
            ]
          : header,
      };
    }

    case "parts": {
      const header = `PDF pages extracted: ${result.file.count} page(s) from ${result.file.filePath} (${formatBytes(result.file.originalSize)})`;
      const pages = result.pages ?? [];
      const firstPage = result.firstPage ?? 1;
      return {
        tool_use_id: toolUseId,
        type: "tool_result",
        content: pages.length
          ? [
              { type: "text", text: header },
              ...pages.map((page, i) =>
                page.base64
                  ? { type: "image", source: { type: "base64", data: page.base64, media_type: page.mediaType } }
                  : {
                      type: "text",
                      text: `[Page ${firstPage + i} could not be processed as an image${page.error ? `: ${page.error}` : ""}]`,
                    },
              ),
            ]
          : header,
      };
    }

    case "file_unchanged":
      return {
        tool_use_id: toolUseId,
        type: "tool_result",
        content: result.source === "seeded" ? seededUnchangedNotice(result.file.filePath) : unchangedNotice(),
      };

    case "text": {
      let content;
      if (result.file.content) {
        content = stalenessPrefix(result) + numberLines({ ...result.file, tabAwareSeparator: tabAwareSeparator() });
      } else if (result.file.numLines >= 1 && result.file.totalLines > 1) {
        // A window that landed past the end of a non-empty file: the numbering
        // still emits the requested start line, with an empty body.
        content = stalenessPrefix(result) + numberOneLine("", result.file.startLine, "\t");
      } else if (result.file.numLines >= 1 || result.file.totalLines === 0) {
        content = "<system-reminder>Warning: the file exists but the contents are empty.</system-reminder>";
      } else {
        content = `<system-reminder>Warning: the file exists but is shorter than the provided offset (${result.file.startLine}). The file has ${result.file.totalLines} lines.</system-reminder>`;
      }
      return { tool_use_id: toolUseId, type: "tool_result", content };
    }
  }
}
