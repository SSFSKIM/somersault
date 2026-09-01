// The last assistant message and its text, owned outright (§2.4 `pure-helper`).
//
// Upstream, at 2.1.251, two plain functions in chunk-fy12d89p:
//   `Wy` — the last `assistant` entry of a message list.
//   `zr` — the text of a content-block array, joined by a caller-chosen
//          separator. Non-text blocks (thinking, tool_use, tool_result) are
//          dropped, not stringified.
//
// The Stop dispatcher composes them into `last_assistant_message`, which is the
// one field of the Stop record that is derived rather than copied — and the
// composition is fussier than it looks: the joined text is trimmed and an EMPTY
// result becomes `undefined` rather than `""`, so a turn that ended with a
// tool_use and no prose omits the field entirely instead of carrying a blank.
// That is the branch the corpus does not render and the parity oracle does.

/** Upstream `Wy` — the last assistant message, or `undefined` when there is none. */
export function lastAssistantMessage(messages) {
  return messages.findLast((m) => m.type === "assistant");
}

/** Upstream `zr` — the text blocks of a content array, joined. */
export function textOfContent(content, separator = "") {
  return content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join(separator);
}
