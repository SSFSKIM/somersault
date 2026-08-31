// The `primitive` half of the §2.4 capture taxonomy, in one place.
//
// A `primitive` capture is a value the owned module OWNS outright: it declares
// its own copy and uses that copy in both wirings. The graph's binding is still
// forwarded across the adapter — not because the module needs it, but because
// comparing the two makes every single delegation a free micro-differential
// check. An upstream constant that changes value (rather than name) does not
// move any anchor, does not move the target span's hash, and would otherwise be
// invisible until some scenario happened to render it.
//
// So the assertion is deliberately fatal. A mismatch means the owned copy has
// silently stopped being a copy, which is the one thing a parity gate cannot
// tolerate; the pinned bundle is the source of truth and the row must be
// re-verified by hand (§5's staling, done early).
export function assertGraphValue(splice, as, graph, owned) {
  if (Object.is(graph, owned)) return owned;
  throw new Error(
    `reforge ${splice}: the graph's '${as}' no longer equals the owned value.\n` +
      `  owned: ${JSON.stringify(owned)}\n` +
      `  graph: ${JSON.stringify(graph)}\n` +
      `  The owned copy is stale. Re-verify the upstream declaration in the pinned bundle and update the ` +
      `owned constant deliberately — never by copying whatever the graph now says.`,
  );
}
