
## 2026-09-03 — a dark row's verdict reads the whole SCENARIO, so a red on any other surface reports it as reachable

**Source:** C12a / W9a's first full gate run (`/tmp/c12a-gate4.log`, lines 336–368) ·
`reforge/strangle/gate.ts`, the `darkOver` block.

**What.** A splice adjudicated DARK is rebuilt with an inverted twin and its `darkOver` scenarios must
stay GREEN; a RED one is reported as `NO LONGER DARK. The corpus now reaches <row>; the darkReason is
stale and the row needs coverage instead`. That message is a REACHABILITY claim, and the verdict it
rests on is not: `replayTag` returns the scenario's whole verdict, which is red if ANY of its four
surfaces differed.

Measured on that run. C12a's new config-store surface had one unmapped field, so `hooks-precompact`
went red on state alone. Two dark rows cover it — `hook-output-sync` (over eighteen scenarios) and
`hook-stderr-tail` (over ten) — and both reported NO LONGER DARK, naming a reachability that did not
exist. Every other covering scenario stayed GREEN in both rows, which is exactly the shape that should
have made the claim suspect: a twin that is genuinely reached by a scenario is reached because of what
the twin changed, not because an unrelated surface moved.

**Cost.** Two of five FAILs in a three-hour gate run pointed at the wrong subsystem. The rows were
correct; the wave that read them nearly converted two sound `darkReason`s into coverage rows over a
scenario that does not reach either predicate. Both are still dark and unchanged.

**Fix, not taken here.** The dark-row check has the information it needs and does not use it: the
FAITHFUL build's verdict for the same scenario is measured in the equivalence phase of the same run.
When the faithful build is itself red on a `darkOver` scenario, the twin's red says nothing about the
twin, and the dark verdict should be INCONCLUSIVE — an outcome the gate already has language for
(`a run that graded nothing is not evidence of liveness`) — rather than a reachability claim. Cheaper
variant, if ordering makes that awkward: report which SURFACE reddened, so a state-only red is legible
as one. Not fixed in C12a because the phase ordering puts equivalence after the liveness loop and
reordering it is a change to the gate's own shape, which is not a storage-machinery wave's to make.
