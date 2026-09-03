// SABOTAGE — answer "a shutdown is already in flight", always.
//
// MEASURED EFFECT, which is upstream of the one this twin was written to
// produce and worth stating as what it is. The intended red was the headless
// SIGTERM handler's own once-guard (`if (alreadyGuarded || isShuttingDown())
// return`), which with this twin refuses the first signal and leaves the process
// to the OS. What actually happens is earlier and larger: the predicate is read
// 37 times through its facade, 29 of them inside the headless dispatcher, and
// with it answering true the engine produces NO frames at all and exits 0. Both
// signal plans go red on that, and they go red precisely: the delivery point
// never arrives, because there is no assistant frame to deliver on.
//
// Either way the red is this predicate's own — a claim that answers "yes"
// where the process has not claimed anything.
export function twnIsShuttingDown() {
  return true;
}
