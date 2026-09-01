// SABOTAGE wiring — graded by the parity oracle's control, not by a recording.
import { notificationHooks } from "./notification-hooks/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  notificationHooks() {
    return notificationHooks();
  },
});
