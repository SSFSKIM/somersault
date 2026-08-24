// harness/test/unit/boundaryTriple.ts — F10 T-IMGREACH Task 2 (I2), plan-review r2 F-BOUNDS: cap−1 /
// cap / cap+1, spelled ONCE for the whole track, so every boundary matrix in this track (Tasks 2, 3, 4,
// 5, 7, 8, 12) indexes off one definition of what "boundary" means.

/** `passes` says whether the value at that index must survive its cap; every cap in this track is
 *  INCLUSIVE (at-cap passes, cap+1 does not). */
export const triple = (cap: number) => [
  { at: cap - 1, label: "cap−1", passes: true },
  { at: cap, label: "cap", passes: true },
  { at: cap + 1, label: "cap+1", passes: false },
] as const;
