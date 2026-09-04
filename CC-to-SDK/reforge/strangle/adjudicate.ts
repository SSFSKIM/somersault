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
//   UNADJUDICATED  a branch no evidence covers and nobody wrote a reason for.
//                  §3.1's "exclusions listed and reviewed" is only enforceable if
//                  the absence of a review is an error.
//   STALE          an exclusion that no longer describes reality, in EITHER
//                  direction: one naming a branch the inventory no longer has
//                  (the code moved, and the reason now protects nothing), and one
//                  something has since started to execute (the reason is
//                  obsolete, and leaving it means the next real gap on that
//                  branch id would be silently excused). A stale exclusion is
//                  exactly how a genuine gap hides behind an old adjudication.
//
// ## TWO KINDS OF EVIDENCE, AND WHY THE SECOND ONE HAD TO EXIST (C13a / W10a)
//
// Until the shell parser, every attested module was small enough that "the
// corpus executed it" and "a reason says why not" partitioned the inventory
// usefully. The parser does not fit that shape: it is 3,646 branch outcomes of
// bash grammar, and the recorded corpus issues `echo`, `ls`, `chmod` and `pwd`.
// Roughly four fifths of it is unreachable BY THE CORPUS and nonetheless graded
// — `strangle/parser-parity.test.ts` drives every one of those branches against
// upstream's own pinned bytes and compares the resulting trees node for node.
//
// Writing that down as three thousand identical exclusion reasons would have been
// the wrong shape twice over. It would claim "reviewed" for entries nobody could
// review, and it would say `excluded` about branches that a suite in this
// repository provably executes on every run. So the adjudicator takes a SECOND
// executed-set — what a differential contract suite ran, measured the same way
// the corpus's is, on the same instrumented module — and reports it as its own
// state.
//
// The two are not interchangeable and the report keeps them apart. Corpus
// evidence is end-to-end: the branch ran inside a real engine replay whose whole
// transcript was compared. Contract evidence is narrower and, for an unrendered
// branch, stronger: the branch ran against upstream's own implementation of
// itself and the outputs were required to be identical. What contract evidence
// cannot say is that anything downstream would have noticed.
import type { BranchSite } from "./branches.js";
import { outcomesOf } from "./branches.js";

export interface Adjudication {
  branch: string;
  site: BranchSite;
  /** the outcome suffix — `T`, `F`, `taken`, `iterated` */
  outcome: string;
  state: "executed" | "contract" | "excluded" | "UNADJUDICATED";
  reason?: string;
}

export interface StaleExclusion {
  branch: string;
  why: "the corpus now executes it" | "a contract suite now executes it" | "no such branch in the inventory";
}

export interface AttestationVerdict {
  rows: Adjudication[];
  inventory: string[];
  unadjudicated: Adjudication[];
  stale: StaleExclusion[];
  executedCount: number;
  /** covered by a differential contract suite rather than by a corpus replay */
  contractCount: number;
  excludedCount: number;
  /** true when the inventory itself is empty — a pass over nothing */
  vacuous: boolean;
  ok: boolean;
}

export function adjudicate(
  sites: readonly BranchSite[],
  exclusions: readonly { branch: string; reason: string }[],
  executed: ReadonlySet<string>,
  /**
   * What a differential contract suite executed on the same instrumented module.
   * Defaults to empty, so every attested module that has no such suite is
   * adjudicated exactly as it was before this channel existed.
   */
  contract: ReadonlySet<string> = new Set(),
): AttestationVerdict {
  const inventory = sites.flatMap(outcomesOf);
  const excluded = new Map(exclusions.map((e) => [e.branch, e.reason]));

  const rows: Adjudication[] = [];
  for (const site of sites) {
    for (const branch of outcomesOf(site)) {
      // Ordered by STRENGTH of evidence, not by convenience. A branch a corpus
      // replay executed is reported as such even when a contract suite also ran
      // it, because end-to-end evidence is the stronger claim and the report
      // should say the strongest true thing about each branch.
      const state = executed.has(branch)
        ? "executed"
        : contract.has(branch)
          ? "contract"
          : excluded.has(branch)
            ? "excluded"
            : "UNADJUDICATED";
      rows.push({ branch, site, outcome: branch.slice(branch.lastIndexOf(":") + 1), state, reason: excluded.get(branch) });
    }
  }

  const unadjudicated = rows.filter((r) => r.state === "UNADJUDICATED");
  const stale: StaleExclusion[] = [...excluded.keys()]
    .filter((b) => !inventory.includes(b) || executed.has(b) || contract.has(b))
    .map((b) => ({
      branch: b,
      why: !inventory.includes(b)
        ? "no such branch in the inventory"
        : executed.has(b)
          ? "the corpus now executes it"
          : "a contract suite now executes it",
    }));
  const vacuous = inventory.length === 0;

  return {
    rows,
    inventory,
    unadjudicated,
    stale,
    executedCount: rows.filter((r) => r.state === "executed").length,
    contractCount: rows.filter((r) => r.state === "contract").length,
    excludedCount: rows.filter((r) => r.state === "excluded").length,
    vacuous,
    ok: !vacuous && unadjudicated.length === 0 && stale.length === 0,
  };
}
