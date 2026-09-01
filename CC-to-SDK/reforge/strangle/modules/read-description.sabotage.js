// SABOTAGE wiring — `plain` and `api-error` MUST both go red with this built.
import { readDescription } from "./read-description/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  readDescription(model, lineNumbering, maxSizeClause, offsetLimitNote, lineBudget, noRereadNote, leanPrompt, pdfCapable) {
    return readDescription(model, lineNumbering, maxSizeClause, offsetLimitNote, leanPrompt, pdfCapable);
  },
});
