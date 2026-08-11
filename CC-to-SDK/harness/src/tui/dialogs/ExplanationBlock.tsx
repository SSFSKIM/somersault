// tui/dialogs/ExplanationBlock.tsx — what ctrl+e puts under the command line, transcribed from 2.1.220's
// `Rsl` + `eDn` (L505053-104): a `marginTop:1` column holding the explanation, the reasoning one blank line
// below it, and a risk row whose `<riskLabel>:` carries the level's colour and whose text follows after a
// single space. `visible && promise` gates the whole thing (`eDn` L505095-99) — a dialog that has never been
// asked renders nothing at all, and hiding keeps the resolved promise so re-showing is free.
//
// Upstream reads the promise with `use()` inside a `<Suspense fallback={<Lsl/>}>`; ccx resolves it in an
// effect instead. Two reasons: Ink's reconciler is not driven by a Suspense-aware root here, and OUR
// generator REJECTS on a malformed result (explainCommand.ts) where upstream's resolves to null — an effect
// can watch both arms, a `use()` boundary would need an error boundary alongside the fallback to say the
// same thing. The two failure arms print the one string upstream prints for its null: `Explanation
// unavailable`. `Loading explanation…` is upstream's `Xdi` (L505105) minus its per-character shimmer.
import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { riskColorRole, riskLabel, type Explanation } from "./explainCommand.js";
import { resolveThemeColor, themeTokens } from "../theme.js";

type State = { status: "loading" } | { status: "ready"; value: Explanation } | { status: "failed" };

export function ExplanationBlock({ visible, promise }: { visible: boolean; promise?: Promise<Explanation> | null }) {
  const [state, setState] = useState<State>({ status: "loading" });
  // Keyed on the promise IDENTITY, not on `visible`: the request is one-shot and outlives every hide/show,
  // so toggling must never restart the effect and flash the loading row back over a resolved explanation.
  useEffect(() => {
    if (!promise) return;
    let live = true;
    setState({ status: "loading" });
    promise.then((value) => { if (live) setState({ status: "ready", value }); }, () => { if (live) setState({ status: "failed" }); });
    return () => { live = false; };
  }, [promise]);

  if (!visible || !promise) return null;
  if (state.status === "loading") return <Box marginTop={1}><Text dimColor>Loading explanation…</Text></Box>;
  if (state.status === "failed") return <Box marginTop={1}><Text dimColor>Explanation unavailable</Text></Box>;
  const { explanation, reasoning, risk, riskLevel } = state.value;
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text>{explanation}</Text>
      <Box marginTop={1}><Text>{reasoning}</Text></Box>
      <Box marginTop={1}><Text><Text color={resolveThemeColor(themeTokens()[riskColorRole(riskLevel)])}>{riskLabel(riskLevel)}:</Text><Text> {risk}</Text></Text></Box>
    </Box>
  );
}
