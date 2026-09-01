// Anchor resolution — which chunk a splice's anchor names, and the proof that
// the question has exactly one answer.
//
// The rule the strangler has always enforced: an anchor is TRUE-SUBSTRING-unique
// across the WHOLE graph, because a second match in another chunk makes "which
// node did we excise?" a coin flip. That rule stands. What C4 (W1) adds is the
// case it could not express.
//
// ## Why a second literal (campaign spec C4, contract X3)
//
// The Bash tool's result formatter contains no graph-unique string literal at
// all. Its complete literal set is `""`, `"string"`, `"text"`, `"tool_result"`
// (577 graph-wide) and `"<error>Command was aborted before completion</error>"`
// — which occurs TWICE in every bundle measured (2.1.220…251): once in the
// engine chunk the corpus reaches, and once in the Windows/PowerShell sibling
// tool, which shares the permission chunk. Extending the anchor in either
// direction to make it unique reaches a minified local name (`…</error>"}let p`,
// `e+="<error>…`) — a bet on a minifier letter, which is the bet this project
// has already watched lose twice in a single bump (`hui`→`q6t`, `yzv`→`APn`).
//
// So a row may declare a `coLiteral`: a SECOND literal that must occur in the
// same chunk as the anchor. Uniqueness is then asserted among the chunks
// containing BOTH, and the anchor still has to resolve to exactly one node.
//
// Deliberately NOT the chunk name. Chunk names are content-addressed and churn
// per pin — the 2.1.241 graph was one `cli` file, the 2.1.251 graph is 400+
// `chunk-<hash>.js` files — so scoping by name would convert every bump into a
// manual re-anchoring pass and destroy the mechanical-catch-up property that is
// the whole point of literal anchors. A co-occurring literal is the same kind of
// bet as the anchor itself: it survives minification, it is chosen from the same
// object literal as the target so it names the TOOL rather than the packaging,
// and when upstream moves it the build fails loudly instead of excising the
// wrong node.
//
// Failure is loud in every direction: a co-literal that occurs nowhere, one that
// never co-occurs with the anchor, and an anchor that is still ambiguous inside
// the scope all throw with the counts that made the decision.

export interface AnchorSpec {
  name: string;
  anchor: string;
  /** optional second literal that must occur in the same chunk as the anchor */
  coLiteral?: string;
  /**
   * How many nodes of the same chunk carry this anchor, VERIFIED at splice time
   * (campaign spec C5x, unit 4). Defaults to 1 — the rule that has always held.
   *
   * A `coLiteral` scopes to a CHUNK, so it cannot separate two siblings inside
   * one: the compaction wrapper `nie` shares a byte-identical five-line preamble
   * with `hRt`, and the permission pair `kye`/`von` share `decideLocation:"pre-ask"`.
   * A row that declares `siblings: n` says "I know this literal names n nodes
   * here; select among them by my structural signature" — and the count is part
   * of what is verified, so an upstream edit that adds or removes an occurrence
   * fails the build instead of silently changing which node is in play.
   *
   * Selection itself is `selectExcision` in ast.ts; this only widens the
   * uniqueness rule from "one occurrence" to "exactly the declared number, all
   * in one chunk". Two chunks carrying the anchor is still a coin flip and is
   * still refused.
   */
  siblings?: number;
}

const countSubstring = (haystack: string, needle: string) => haystack.split(needle).length - 1;

/** `path × count` for a log line or an error message. */
const describe = (hits: readonly (readonly [string, number])[], label: (p: string) => string) =>
  hits.map(([p, c]) => `${label(p)}x${c}`).join(", ");

/**
 * The one file whose anchor the splice owns. Throws unless exactly one anchor
 * occurrence survives the row's declared scope.
 *
 * @param sources  every text module of the graph, keyed by path
 * @param label    render a path for humans (usually `relative(root, p)`)
 */
export function resolveAnchor(
  sources: ReadonlyMap<string, string>,
  sp: AnchorSpec,
  label: (path: string) => string = (p) => p,
): { path: string; source: string; offsets: number[] } {
  const all = [...sources].map(([p, s]) => [p, countSubstring(s, sp.anchor)] as const).filter(([, c]) => c > 0);
  const anchorTotal = all.reduce((a, [, c]) => a + c, 0);
  if (anchorTotal === 0) {
    throw new Error(`${sp.name}: anchor not found anywhere in the graph — re-anchor it`);
  }

  let hits = all;
  if (sp.coLiteral !== undefined) {
    const co = [...sources].filter(([, s]) => s.includes(sp.coLiteral!)).map(([p]) => p);
    if (co.length === 0) {
      throw new Error(
        `${sp.name}: coLiteral ${JSON.stringify(sp.coLiteral)} occurs nowhere in the graph — the scope names nothing; ` +
          `re-verify the target (the anchor itself is at ${describe(all, label)})`,
      );
    }
    const coSet = new Set(co);
    hits = all.filter(([p]) => coSet.has(p));
    if (hits.length === 0) {
      throw new Error(
        `${sp.name}: anchor and coLiteral ${JSON.stringify(sp.coLiteral)} never co-occur — ` +
          `anchor in ${describe(all, label)}, coLiteral in ${co.map(label).join(", ")}`,
      );
    }
  }

  // One CHUNK, always: two chunks carrying the anchor makes "which node did we
  // excise?" a coin flip that no signature can settle, since the same-shaped
  // node in the other chunk is a different function entirely.
  const expected = sp.siblings ?? 1;
  const total = hits.reduce((a, [, c]) => a + c, 0);
  if (hits.length > 1 || total > expected) {
    const scope = sp.coLiteral === undefined ? "the graph" : `chunks containing ${JSON.stringify(sp.coLiteral)}`;
    throw new Error(
      `${sp.name}: anchor is not unique in ${scope} — ${total} matches (${describe(hits, label)})` +
        (expected > 1 ? `; the row declares siblings: ${expected}${hits.length > 1 ? ", but they are not all in one chunk" : ""}` : "") +
        (sp.coLiteral === undefined ? "; scope it with a coLiteral, or re-anchor" : ""),
    );
  }
  if (total < expected) {
    throw new Error(
      `${sp.name}: the row declares siblings: ${expected} but the anchor occurs ${total}× (${describe(hits, label)}) — ` +
        `an occurrence disappeared upstream, so re-verify WHICH node the row now selects before adjusting the count`,
    );
  }
  const path = hits[0][0];
  const source = sources.get(path)!;
  const offsets: number[] = [];
  for (let i = source.indexOf(sp.anchor); i >= 0; i = source.indexOf(sp.anchor, i + 1)) offsets.push(i);
  return { path, source, offsets };
}
