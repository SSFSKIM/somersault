// PARITY LAYER (§2.5 `reference`) — CLAUDE.md injection (upstream `HAt`,
// 2.1.251, chunk-fy12d89p).
//
// This is where a project's memory actually enters a conversation. The engine
// collects the session's ambient context into a plain `{ key: value }` map —
// `claudeMd` (every discovered CLAUDE.md, concatenated with its provenance
// headers), `userEmail`, `attachedProject`, `currentDate` — and this function
// renders it as ONE meta user message prepended to the message list, wrapped in
// a `<system-reminder>` element with an instruction not to answer it.
//
// It is a user message and not a system block on purpose: the context is
// session-specific and would otherwise sit inside the cacheable prefix. The
// message is marked `isMeta`, which is what keeps it out of the transcript the
// user sees.
//
// Two details are the whole formatting contract, and both are load-bearing:
// each entry renders as a markdown heading followed by its body on the next
// line, and the entries are joined by a SINGLE newline — so with one entry the
// separator never appears at all. The corpus reached only that one-entry shape
// (`currentDate`) until `claude-md-memory`, which renders two.
//
// The empty-context arm returns the message list untouched. No corpus scenario
// reaches it: `currentDate` is unconditional, so the map is never empty on a
// graded run. `strangle/prompt-parity.test.ts` grades it against upstream.

/**
 * @param messages    the message list to prepend to
 * @param context     `{ [key]: value }` — the session's ambient context
 * @param makeMessage ({ content, isMeta }) -> message  (port: stamps uuid + timestamp)
 */
export function contextReminderMessages(messages, context, makeMessage) {
  const entries = Object.entries(context);
  if (entries.length === 0) return messages;
  const body = entries.map(([key, value]) => `# ${key}\n${value}`).join("\n");
  return [
    makeMessage({
      content: `<system-reminder>
As you answer the user's questions, you can use the following context:
${body}

      IMPORTANT: this context may or may not be relevant to your tasks. You should not respond to this context unless it is highly relevant to your task.
</system-reminder>
`,
      isMeta: true,
    }),
    ...messages,
  ];
}
