// OWNED HELPER (§2.4 `pure-helper`) — upstream `km`, 2.1.251, chunk-fy12d89p.
//
// The bullet formatter every prose section of the default system prompt ends
// with. Fifteen call sites bundle-wide, four of them in the sections W7.5 owns,
// so it is a `pure-helper` capture rather than a fold-in (C7's rule: many
// callers means upstream's copy stays live and reachable, one caller means the
// helper belongs inside its owner).
//
// TWO INDENTS, AND THE DIFFERENCE IS BEHAVIOUR. A string becomes a top-level
// bullet with ONE leading space; an array becomes a run of nested bullets with
// TWO. Upstream flattens in one pass, so a nested array cannot nest further —
// depth is exactly two by construction, not by convention.
//
// The leading spaces are not cosmetic in a prompt: they are the bytes the model
// reads, and a section that lost them would still "look right" in every diff a
// human skims.

/**
 * @param {(string | string[])[]} items
 * @returns {string[]} one line per bullet, in order
 */
export function bulletLines(items) {
  return items.flatMap((item) => (Array.isArray(item) ? item.map((nested) => `  - ${nested}`) : [` - ${item}`]));
}
