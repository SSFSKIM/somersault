// tui/dialogs/consentReason.ts — "why am I being asked this?", the line that sits above the option list.
//
// Upstream's `mDr` (L500531-572) is a switch over a TYPED decision reason and writes a different sentence
// per variant: `classifier` ("Classifier <name> requires confirmation for this <tool>."), `rule`
// ("Permission rule <value> requires confirmation…" plus a `/permissions to update rules` hint),
// `hook` ("Hook <name> requires confirmation…" plus the hook-source hint), `workingDir`, and
// `subcommandResults`, which recurses into the first sub-reason that asks.
//
// NONE of that is reachable from a headless broker. Probe 78 A1 established that the SDK forwards
// `decisionReason` as a bare STRING — the typed enum the control protocol declares never crosses the wire —
// so the only arm we can actually be in is `safetyCheck`/`other` at L500565-567, which is
// `{ reasonString: e.reason, configString: undefined }`: the reason verbatim and no config hint under it.
// The other arms and the `configString` line are RECORDED as out of reach, not built.
//
// So this is the identity function with upstream's own emptiness guard (`mDr` L500532: `if (!e) return
// null`) — deliberately no trimming, no wrapping and no punctuation of our own, because whatever the
// engine wrote is the sentence the human should read.

export function consentReasonLine(decisionReason: string | undefined): string | undefined {
  return decisionReason ? decisionReason : undefined;
}
