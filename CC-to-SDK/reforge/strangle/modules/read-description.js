// ADAPTER — the graph-facing seam for the Read tool's description function.
//
// Delegation signature:
//   readDescription(model, lineNumbering, maxSizeClause, offsetLimitNote,
//                   lineBudget, noRereadNote, leanPrompt, pdfCapable)
//
// The first four are the original parameters, forwarded verbatim. `lineBudget`
// and `noRereadNote` are §2.4 `primitive`s the module owns — the graph's copies
// cross only so this adapter can prove they still agree on every delegation. The
// last two are typed ports, documented in the reference module's header.
import { DEFAULT_LINE_BUDGET, NO_REREAD_NOTE, readDescription } from "./read-description/reference.js";
import { assertGraphValue } from "./shared/assert.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  readDescription(model, lineNumbering, maxSizeClause, offsetLimitNote, lineBudget, noRereadNote, leanPrompt, pdfCapable) {
    assertGraphValue("read-description", "lineBudget", lineBudget, DEFAULT_LINE_BUDGET);
    assertGraphValue("read-description", "noRereadNote", noRereadNote, NO_REREAD_NOTE);
    return readDescription(model, lineNumbering, maxSizeClause, offsetLimitNote, leanPrompt, pdfCapable);
  },
});
