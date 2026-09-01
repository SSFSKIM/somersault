// SABOTAGE wiring — every corpus scenario MUST go red: `currentDate` is
// unconditional, so every run carries this block in its first user message.
import { contextReminderMessages } from "./context-reminder/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  contextReminderMessages(messages, context, makeMessage) {
    return contextReminderMessages(messages, context, makeMessage);
  },
});
