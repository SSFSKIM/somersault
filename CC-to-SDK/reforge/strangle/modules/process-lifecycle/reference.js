// PARITY LAYER (§2.5 `reference`) — the whole of upstream's shutdown latch
// chunk (2.1.251, `chunk-29shcjw2.js`: 780 bytes of file, 165 of code).
//
// The campaign's SECOND S-CHUNK (§2.2), and its smallest ownership by two orders
// of magnitude. Upstream, whole:
//
//     class t{committed=!1}var e=new t;
//     function xo(){return e.committed}
//     function S8e(){e.committed=!0}
//     var n=new Promise(()=>{});function pm(){return n}
//     export{xo,S8e,pm};
//
// Three exports, no imports, no re-exports, and — measured per build rather than
// believed — no top-level statement that is not a declaration.
//
// ## What this module IS: one bit and one promise that never keeps its word
//
// `isShuttingDown()` reads a boolean that starts false and is set exactly once.
// `commitShutdown()` is the only writer, and there is NO clearer anywhere in the
// bundle: once the process has decided it is going down, nothing takes that
// back. `hang()` returns a promise constructed with an empty executor, so it
// neither resolves nor rejects, ever.
//
// That last one reads like a mistake and is the design. Sixty-two call sites
// consult the latch and twenty-five of them answer it the same way —
// `if (isShuttingDown() && !signal.aborted) await hang()` — which is how the
// engine stops a turn mid-flight WITHOUT unwinding it: the continuation simply
// never runs. There is no rejection to catch, no cancellation to race, no
// half-finished tool result to write back. The process is going to exit; the
// cheapest correct thing for everything still in flight is to stop existing.
//
// ## IDENTITY IS THE SEMANTICS, and it is why this is a chunk and not a splice
//
// The three exports are meaningless apart. A reader that read a different
// boolean from the one the setter set, or a hang that returned a fresh promise
// per call, would type-check and pass every output comparison in the corpus
// while destroying the behaviour. So the unit of ownership is the MODULE, and
// the thing the module owns is one instance of each: ESM evaluates a module body
// once per process and caches it by URL, which is exactly the guarantee
// upstream's `var e = new t` has. The build declares that in the manifest row's
// `moduleState` and re-derives it from the pinned bytes every run (chunk.ts rule
// 2b), because "replacing the file whole would drop this construction" is the
// right default and this is the one shape it is wrong about.
//
// ## THE ORACLE EVALUATES THIS PER CASE. THIS MODULE DOES NOT.
//
// `strangle/hooks-parity.test.ts` grades the hook layer's shutdown arms by
// `eval`ing upstream's chunk text once per case, precisely so a case that
// commits shutdown does not commit it for the whole suite. That per-case reset
// is a property of the ORACLE, not of the engine: in a real process there is one
// latch, it is one-way, and the wave that owns it must not quietly make it
// resettable to be easier to test. So this module has no reset, and the parity
// comparison in that suite is ORDERED instead — every claim about the clear
// state is made before the one commit, and the commit is terminal.

/**
 * Upstream `class t{committed=!1}` plus `var e=new t`.
 *
 * A one-field object rather than a bare `let`, matching upstream: the field is
 * what `isShuttingDown` reads and `commitShutdown` writes, and keeping the
 * indirection means the two functions share a referent the way upstream's do
 * rather than closing over independent copies.
 */
const latch = { committed: false };

/**
 * Upstream `var n=new Promise(()=>{})`.
 *
 * Constructed ONCE, at module scope. The executor takes neither `resolve` nor
 * `reject` and does nothing, so nothing can ever settle it — that is the whole
 * mechanism, and a per-call `new Promise(() => {})` would be observably
 * different to any caller that compares identity or races two of them.
 */
const never = new Promise(() => {});

/** Upstream `xo` — `SchedulingPort.isShuttingDown()` in the hook-executor design. */
export function isShuttingDown() {
  return latch.committed;
}

/** Upstream `S8e` — the one-way commit. Three call sites bundle-wide. */
export function commitShutdown() {
  latch.committed = true;
}

/** Upstream `pm` — `SchedulingPort.hang()`. The same promise every time, forever. */
export function hang() {
  return never;
}
