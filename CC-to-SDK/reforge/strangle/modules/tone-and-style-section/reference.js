// PARITY LAYER (§2.5 `reference`) — the "# Tone and style" section of the
// default system prompt (upstream `D8t`, 2.1.251, chunk-fy12d89p).
//
// The smallest of the six sections and the only one whose upstream body carries
// a filter that cannot currently remove anything: `.filter(x => x !== null)`
// over four literal strings. It is reproduced rather than optimised away —
// upstream keeps it because the list has held nullable entries before and will
// again, and an owned copy that dropped it would diverge the moment one comes
// back. The filter is in the branch inventory and is adjudicated there.
import { bulletLines } from "../shared/prompt-bullets.js";

const ITEMS = [
  "Only use emojis if the user explicitly requests it. Avoid using emojis in all communication unless asked.",
  "Your responses should be short and concise.",
  "When referencing specific functions or pieces of code include the pattern file_path:line_number to allow the user to easily navigate to the source code location.",
  "Do not use a colon before tool calls. Your tool calls may not be shown directly in the output, so text like \"Let me read the file:\" followed by a read tool call should just be \"Let me read the file.\" with a period.",
];

export function toneAndStyleSection() {
  const items = ITEMS.filter((item) => item !== null);
  return ["# Tone and style", ...bulletLines(items)].join("\n");
}
