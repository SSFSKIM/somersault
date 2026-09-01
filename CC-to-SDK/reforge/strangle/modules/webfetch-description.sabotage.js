// SABOTAGE wiring — `plain` and `api-error` MUST both go red with this built.
import { webFetchDescription } from "./webfetch-description/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  webFetchDescription(model, artifactException, leanPrompt, cacheTtlPhrase) {
    return webFetchDescription(model, artifactException, leanPrompt, cacheTtlPhrase);
  },
});
