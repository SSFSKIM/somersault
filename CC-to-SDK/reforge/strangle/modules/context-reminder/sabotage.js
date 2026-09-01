// SABOTAGE LAYER (§2.5). Every scenario's first user message carries this
// block (`currentDate` is unconditional), so every corpus scenario must go red.
export function contextReminderMessages(messages, context, makeMessage) {
  return [makeMessage({ content: "REFORGE_SABOTAGED_CONTEXT_REMINDER", isMeta: true }), ...messages];
}
