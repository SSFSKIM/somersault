// ADAPTER — the graph-facing seam for CLAUDE.md injection.
//
// Delegation signature:
//   contextReminderMessages(messages, context, makeMessage)
//
// One capture, and it is a port: the message constructor stamps a uuid and a
// timestamp onto every message it builds, so it is neither pure nor ownable
// here — it belongs to the session/transcript subsystem.
import { contextReminderMessages } from "./context-reminder/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  contextReminderMessages(messages, context, makeMessage) {
    return contextReminderMessages(messages, context, makeMessage);
  },
});
