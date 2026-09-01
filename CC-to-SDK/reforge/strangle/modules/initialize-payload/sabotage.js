// SABOTAGE LAYER (§2.5). The handshake answers with an EMPTY payload.
//
// Observable because the raw driver reads the initialize response off the wire
// and asserts the payload's stable keys, and because the whole-wire diff then
// sees ~1 KB of the oracle's answer against nothing. A subtler twin — one wrong
// field — would have been just as red here, but this one also proves the
// driver's own case assertion is not vacuous: it names six keys, and this twin
// removes all of them.
export async function buildInitializeResponsePayload() {
  return {};
}
