// SABOTAGE wiring — see the sabotage layer for what this makes go red.
import { brokerPermissionUpdates } from "./broker-permission-updates/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  brokerPermissionUpdates(...args) {
    return brokerPermissionUpdates(...args);
  },
});
