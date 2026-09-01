// SABOTAGE LAYER (§2.5). `auto-compact-threshold` must go red: refusing to
// compact removes both of its boundaries, the two continuation messages and
// every downstream request the summary shaped.
//
// Deliberately the REFUSING direction. Always-true would compact on the first
// turn of all 31 scenarios and redden the corpus wholesale, which proves the
// splice is wired but says nothing about whether the covering scenario is the
// one that grades it.
export async function autoCompactTrigger() {
  return false;
}
