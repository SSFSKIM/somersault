// SABOTAGE wiring — see the sabotage layer for what this makes go red.
import { brokerResponseMap } from "./broker-response-map/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  brokerResponseMap(...args) {
    return brokerResponseMap(...args);
  },
});
