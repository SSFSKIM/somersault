// SABOTAGE LAYER (§2.5).
//
// THE TWIN IS THE INVERTED ONE, for the reason the reference layer states: the
// plausible-but-quiet rewrite (`!("async" in json)`, or a truthiness test on the
// value) differs from upstream only on `{"async":false}` and `{"async":"yes"}`,
// which no corpus hook emits, so it would fail in the direction C9 was corrected
// for — five twins measured inert.
//
// This one flips the answer on EVERY document instead. Every sync hook result
// then reads as an async acknowledgement, so the type guard refuses the very
// documents it exists to admit, and any scenario whose hook answers with a
// result at all must see it.
export function hookOutputIsSync(json) {
  return "async" in json && json.async === true;
}
