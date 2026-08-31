// PARITY LAYER (§2.5 `reference`) — the Grep tool's tool-result formatter.
//
// Upstream: the `mapToolResultToToolResultBlockParam` method of the Grep tool's
// object literal (2.1.251, chunk-fy12d89p). Standalone-complete: both of its
// captures were `pure-helper`s and are owned here, so nothing crosses the
// adapter but the tool output itself.
//
// The `mode` parameter carries a DEFAULT upstream (`"files_with_matches"`),
// applied in the adapter's own parameter list before the value is forwarded —
// see strangle/ast.ts. This module therefore always sees a resolved mode.
//
// Corpus coverage, said plainly: `search-tools` exercises only the
// files_with_matches arm. The content and count arms, the pagination note and
// the pluralizer are graded by the contract test (strangle/contracts.test.ts),
// which is what §2.4 asks for when a helper's domain is wider than the corpus.

/** Upstream `iEe`: the "limit: N, offset: M" fragment, empty when neither applies. */
export function paginationNote(appliedLimit, appliedOffset) {
  const parts = [];
  if (appliedLimit !== undefined) parts.push(`limit: ${appliedLimit}`);
  if (appliedOffset) parts.push(`offset: ${appliedOffset}`);
  return parts.join(", ");
}

/** Upstream `k` (chunk-04aem4bh.js): English pluralization by count. */
export function plural(count, singular, pluralForm = `${singular}s`) {
  return count === 1 ? singular : pluralForm;
}

export function grepToolResultBlock(output, toolUseId) {
  const { mode, numFiles, filenames, content, numMatches, totalFiles, totalLines, appliedLimit, appliedOffset } = output;

  if (mode === "content") {
    const note = paginationNote(appliedLimit, appliedOffset);
    const body = content || (appliedOffset && (totalLines ?? 0) > 0 ? "No entries at this offset" : "No matches found");
    return {
      tool_use_id: toolUseId,
      type: "tool_result",
      content: note ? `${body}\n\n[Showing results with pagination = ${note}]` : body,
    };
  }

  if (mode === "count") {
    const note = paginationNote(appliedLimit, appliedOffset);
    const matches = numMatches ?? 0;
    const files = numFiles ?? 0;
    // Faithful oddity: the "no entries at this offset" wording is selected by
    // matches > 0 upstream, not by matches === 0.
    const body = content || (matches > 0 ? "No entries at this offset" : "No matches found");
    const tally =
      `\n\nFound ${matches} total ${plural(matches, "occurrence")} across ${files} ${plural(files, "file")}.` +
      `${note ? ` with pagination = ${note}` : ""}`;
    return { tool_use_id: toolUseId, type: "tool_result", content: body + tally };
  }

  const note = paginationNote(appliedLimit, appliedOffset);
  if (numFiles === 0) {
    return {
      tool_use_id: toolUseId,
      type: "tool_result",
      content:
        appliedOffset && (totalFiles ?? 0) > 0
          ? `No entries at this offset. [Showing results with pagination = ${note}]`
          : "No files found",
    };
  }
  return {
    tool_use_id: toolUseId,
    type: "tool_result",
    content: `Found ${numFiles} ${plural(numFiles, "file")}${note ? ` ${note}` : ""}\n${filenames.join("\n")}`,
  };
}
