// SABOTAGE LAYER (§2.5). It appends the real delta as well, on purpose: dropping
// the text outright also goes red, but leaves the turn with an EMPTY assistant
// message, and the engine then retries the turn a dozen times against an
// exhausted cassette — minutes of gate time for the same one-bit answer. A twin
// should be wrong loudly AND cheaply.
export function appendTextDelta(block, delta) {
  block.text += `REFORGE_SABOTAGED_DELTA:${delta.text}`;
}
