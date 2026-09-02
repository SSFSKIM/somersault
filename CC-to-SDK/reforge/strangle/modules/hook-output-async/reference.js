// PARITY LAYER (§2.5 `reference`) — "is this hook-output document an ASYNC
// ACKNOWLEDGEMENT?" (upstream `mS`, 2.1.251, chunk-fy12d89p @653728, 47 bytes).
//
// THE OTHER HALF of the pair `hook-output-sync` documents, and the second of the
// two splices C10.6's fix round takes to prove the corrected anchorability
// claim. Its anchor is `){return"async"in ` — again a structural fragment
// carrying no prose, which the retired twelve-character string-literal scan
// could not see and which the doctrine's own rule finds immediately.
//
// WHAT IT DECIDES, and it is NOT `!hookOutputIsSync`. Upstream declares the two
// separately and the difference is visible in what each guards. The sync
// predicate is a TYPE GUARD that admits a result document. This one is a
// DISPATCH TEST that recognises the acknowledgement `{"async":true}` and takes
// the backgrounding path: the subprocess runner adopts the hook as a background
// job, the awaiting executor returns a bare success without ever building a
// result, and the standalone callback runner returns empty output. Ten call
// sites over four consumers.
//
// The two decisions are the same two, read the other way round: the key is
// tested with `in`, and the value is compared against `true` by identity, so an
// acknowledgement is only ever an acknowledgement when it says so exactly.

/**
 * @param json a parsed hook-output document
 * @returns true when it is an async acknowledgement rather than a result
 */
export function hookOutputIsAsync(json) {
  return "async" in json && json.async === true;
}
