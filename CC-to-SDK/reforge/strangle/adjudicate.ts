// The attestation's ADJUDICATOR — the pure half of `strangle/attest.ts`.
//
// Its own module for one reason: a checker with no controls is a decoration, and
// controls need to call the logic without running a build and replaying the
// corpus. Everything here is a function of three inputs — the AST-derived branch
// inventory, the reviewed exclusions, and the outcomes the instrumented run
// actually recorded — so `strangle/attest.test.ts` can put each rule in front of
// the fixture that violates it.
//
// Three verdicts, and the last two are the ones that keep a green attestation
// from meaning less than it looks like:
//
//   VACUOUS        an empty inventory reports 100% coverage. It is the canonical
//                  false green and it fails.
//   UNADJUDICATED  a branch the corpus never took and nobody wrote a reason for.
//                  §3.1's "exclusions listed and reviewed" is only enforceable if
//                  the absence of a review is an error.
//   STALE          an exclusion that no longer describes reality, in EITHER
//                  direction: one naming a branch the inventory no longer has
//                  (the code moved, and the reason now protects nothing), and one
//                  the corpus has since started to execute (the reason is
//                  obsolete, and leaving it means the next real gap on that
//                  branch id would be silently excused). A stale exclusion is
//                  exactly how a genuine gap hides behind an old adjudication.
import type { BranchSite } from "./branches.js";
import { outcomesOf } from "./branches.js";

export interface Adjudication {
  branch: string;
  site: BranchSite;
  /** the outcome suffix — `T`, `F`, `taken`, `iterated` */
  outcome: string;
  state: "executed" | "excluded" | "UNADJUDICATED";
  reason?: string;
}

export interface StaleExclusion {
  branch: string;
  why: "the corpus now executes it" | "no such branch in the inventory";
}

export interface AttestationVerdict {
  rows: Adjudication[];
  inventory: string[];
  unadjudicated: Adjudication[];
  stale: StaleExclusion[];
  executedCount: number;
  excludedCount: number;
  /** true when the inventory itself is empty — a pass over nothing */
  vacuous: boolean;
  ok: boolean;
}

export function adjudicate(
  sites: readonly BranchSite[],
  exclusions: readonly { branch: string; reason: string }[],
  executed: ReadonlySet<string>,
): AttestationVerdict {
  const inventory = sites.flatMap(outcomesOf);
  const excluded = new Map(exclusions.map((e) => [e.branch, e.reason]));

  const rows: Adjudication[] = [];
  for (const site of sites) {
    for (const branch of outcomesOf(site)) {
      const state = executed.has(branch) ? "executed" : excluded.has(branch) ? "excluded" : "UNADJUDICATED";
      rows.push({ branch, site, outcome: branch.slice(branch.lastIndexOf(":") + 1), state, reason: excluded.get(branch) });
    }
  }

  const unadjudicated = rows.filter((r) => r.state === "UNADJUDICATED");
  const stale: StaleExclusion[] = [...excluded.keys()]
    .filter((b) => !inventory.includes(b) || executed.has(b))
    .map((b) => ({ branch: b, why: inventory.includes(b) ? "the corpus now executes it" : "no such branch in the inventory" }));
  const vacuous = inventory.length === 0;

  return {
    rows,
    inventory,
    unadjudicated,
    stale,
    executedCount: rows.filter((r) => r.state === "executed").length,
    excludedCount: rows.filter((r) => r.state === "excluded").length,
    vacuous,
    ok: !vacuous && unadjudicated.length === 0 && stale.length === 0,
  };
}
