# engine-ts — the reforge-owned engine (W0 skeleton)

The endpoint of the reforge lane: a standalone TypeScript engine that speaks the
headless stream-json contract with the extracted substrate gone. Today it is a
**skeleton**, and everything below is written to keep that honest.

Contract: `docs/superpowers/specs/2026-08-31-reforge-full-campaign-design.md`
(campaign spec) — §2.4 dual-wiring, §1.1 the closure ledger, child **C2**,
cross-child contracts **X2** (ledger) and **X7** (registration).

## Why it exists at W0 and not at the end

Round-1 review of the campaign design found a dependency-direction flaw: spliced
modules receive closure values *from* the extracted graph, so every "owned"
module was secretly substrate-dependent and a final assembly wave would have
degenerated into the big-bang rewrite the whole lane exists to avoid. The fix is
**dual-wiring**: each wave both splices the graph *and* registers its
standalone-complete module here. The skeleton is the second wire. It exists from
W0 so that "is this module standalone?" is a question something can answer on
day one — `check-reachability.ts` answers it continuously.

## What it does today

```sh
./engines/engine-ts --version   # 2.1.251 (reforge engine-ts skeleton — targets Claude Code 2.1.251)
./engines/engine-ts --owned     # the registered owned-module set + the unowned subsystems, as JSON
echo '{"type":"user",...}' | ./engines/engine-ts --input-format stream-json   # structured refusal, exit 3
```

- **It boots.** `engines/engine-ts` is an extension-less wrapper like its
  siblings (sdk.mjs spawns a non-`.js` path as a native binary), but it needs no
  `strangle/prepare.ts` step: there is nothing to materialize, because the code
  is committed source. It runs under **bun** — the pinned compile-target runtime
  (§3.5) — which executes TypeScript directly.
- **Its version story is the pin.** engine-ts has no version of its own; it
  targets one upstream release (`src/pin.ts`), the same release the oracle and
  the extracted graph are materialized from, because the differential gate only
  means anything when all three engines answer for the same release. The
  `--version` line carries the pin (so a `prepare.ts`-style boot check that greps
  for it passes) *and* says what it is (so nothing mistakes it for the binary).
- **It refuses sessions by name.** Any session input yields one
  `reforge_engine_ts_error` JSON line listing every unowned subsystem, plus a
  human line on stderr, and **exit 3** — a code distinct from success and from a
  crash. It never synthesizes a `result` frame: a faked turn is indistinguishable
  from a working one to the differ, which is exactly the hollow pass this repo
  keeps catching in other guises.
- **It never hangs.** stdin is read for the first line only, with an
  end-of-input and a timeout path, so a harness driving it always gets a verdict.

## X7 — the registration contract (for wave children)

`registry.ts` is the interface every wave child registers its
standalone-complete modules through. It is four names wide on purpose: at W0 the
only thing the skeleton can honestly claim about an owned module is that it
exists and which closure-ledger row it belongs to. Behavior dispatch arrives
with the wave that first needs it.

```ts
interface OwnedModule { readonly name: string; readonly subsystem: string }
register(module: OwnedModule): OwnedModule   // throws on duplicate name / unknown subsystem
ownedSet(): readonly OwnedModule[]
lookup(name: string): OwnedModule | undefined
ownedSubsystems() / unownedSubsystems(): readonly string[]
```

To land a module: add its `register(...)` call to **`modules/index.ts`** (the one
registration site) and move its ledger row in the same commit. `subsystem` must
be a closure-ledger subsystem row id — `register` refuses anything else, so a
module cannot claim ownership of a subsystem the campaign never scoped.
Registration is a *claim* of ownership; the proof is the two-phase gate (X1) and
the ledger row (X2).

## Checks

```sh
npx tsx engine-ts/check-reachability.ts    # static ownership: no import reaches the substrate
npx tsx engine-ts/reachability.test.ts     # its controls (30)
npx tsx engine-ts/skeleton.test.ts         # W0 acceptance: boot, --owned, refusal, registry (25)
npx tsx ledger/check.ts                    # the closure ledger against its canonical row list
npx tsx ledger/check.test.ts               # its controls (56)
npx tsc --noEmit                           # from reforge/
```

**`check-reachability.ts`** walks the import graph from `main.ts` and fails on:
an import that resolves — or textually points — into the extraction bundle, the
pinned binary, or `reforge/build/` (symlinks followed, since `build/real-binary`
is one); a `/$bunfs/root/` specifier; a computed dynamic `import()` (not
statically checkable, and §3.6 names it a delegation route); an unresolvable
local import; a bare specifier that neither resolves nor is a node builtin; a
file the parser reports syntax errors for; and **any `.ts` under `engine-ts/` the
walk never reached** — an unregistered module would otherwise carry a forbidden
import invisibly.

Two properties are worth stating because their absence was a real hole. Discovery
is a **TypeScript AST walk** (the same parser `strangle/ast.ts` excises with),
not a regex sweep: the regexes required whitespace after `import`/`export`, so
the compact forms a bundler emits — `export{x}from"<chunk>"`, `export*from"…"` —
were invisible, and a re-export chain through one such line hid a whole subgraph.
And a **bare specifier is not a leaf**: anything that resolves outside
`ALLOWED_PACKAGES` (today `typescript`; node builtins are allowed separately and
are not packages) is walked, because a workspace or `node_modules` entry that
re-exports an extracted chunk is a delegation route like any other. Adding a name
to that allowlist is the deliberate act of vouching for a dependency's own import
graph.

Stated honestly: this is the *static* half. An engine that reads and evals
extracted source at runtime, or spawns the real binary, passes it while owning
nothing — which is why §3.6 adds the OS-enforced hermetic gate with one negative
control per delegation route at W13/W14. This checker is the cheap continuous
half, not the proof.

## The closure ledger (X2, in `../ledger/`)

`reforge/ledger.json` is the campaign's primary progress metric (§5): one row per
in-scope subsystem (§1.1, 15 rows) and one per headless catalog tool (§1.3, 31
rows), each carrying an ownership state, dependency edges, and the upstream
implementation footprint its owner replaces.

- `ledger/rows.ts` — the **canonical row list**, transcribed from the spec. The
  ledger's shape; `ledger.json` carries the state. A row leaves this list only by
  moving to `EXCLUDED_ROWS` with a reason and evidence (§1.2).
- `ledger/check.ts` — refuses any `ledger.json` whose row set is not exactly the
  canonical list, whose state is outside §1.1's five, whose edges dangle or
  self-reference, whose `stale` row lacks an adjudication note, or whose
  `engineVersion` has drifted from the pin (so a pin bump fails until §5's
  semantic invalidation has been run).
- Footprint slots carry the record C1's strangler build and C2's ledger share:
  `{chunk, target: {start, end, sha256}, captures: [{name, declStart, declEnd,
  sha256}]}`, `null` until the owning wave records one. `standalone-complete` and
  `assembled` **require** one: §5's pin-bump staling is blind without it.
  `spliced` may still be null — footprint emission is C1's deliverable and the
  pre-campaign splices predate it. `captures` is optional *only* while C1's
  emitter is mid-transition; the checker names every footprint missing one and
  the omission becomes an error once the emitter lands.
- A footprint is checked against what it points at, not merely for shape (W0
  boundary review): the span must be sane and inside the chunk; with the pinned
  extraction bundle present the chunk must exist and its bytes at that span must
  hash to `target.sha256` (bundle absent → warn and skip, since another machine
  may not have one; a hash mismatch → hard fail); an owned state must carry at
  least one resolvable evidence link (`commit:<sha>` or `scenario:<tag>`) and,
  for `standalone-complete` on a subsystem row, a matching X7 registration; and
  every `spliced` footprint must correspond to a splice in
  `build/footprints.json` when that file exists for this pin.
- **Span basis:** the ledger records offsets into the upstream bundle module,
  which are identical on every machine. `strangle/build.ts` emits offsets into
  its materialized copy, whose absolute path shifts them, so the checker accepts
  either basis and fails only when neither reproduces the digest.

State at W0: 42 `unowned`, 4 `spliced` — the rows covering the six existing leaf
splices; `spliced` rather than `standalone-complete` because those modules still
receive closure values from the extracted graph.
