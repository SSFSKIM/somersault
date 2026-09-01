// The output style a session falls back to when settings name none.
//
// Owned outright (§2.4 `primitive`): upstream declares it as a bare string
// constant, so a change to its VALUE moves no anchor, no target hash and no
// capture hash. The adapter equality-asserts the graph's binding against this
// on every delegation, which is the only thing that would see such a change.
export const DEFAULT_OUTPUT_STYLE = "default";
