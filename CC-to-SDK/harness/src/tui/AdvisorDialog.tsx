// tui/src/AdvisorDialog.tsx — bl8 T-ADVCMD Task 3: the standalone `/advisor` dialog, canon's `Z`
// (@185591490, spec §3.1) cloned on the ThemeDialog/OutputStylePicker family — a plain round-bordered
// `Box` (not `DialogFrame`, which is the permission-dialog anatomy), the `Select` context (`useSelectKeys`,
// F2 task 8) for j/k · ctrl+n/ctrl+p · pageup/pagedown/home/end for free, and Enter/Esc as the only two
// outcomes this component reports — the ENGINE round-trip (setAdvisorModel + the pref write) is the
// caller's job (useChat's `applyAdvisor`, mirroring how ThemeDialog owns its own apply but a picker with a
// live session round-trip never does; see EffortDialog for the precedent this one follows instead).
//
// ROWS (spec §3.1 step 4): the fixed 3-entry catalog (`advisorCatalog()`, already rank-filtered) in ITS
// OWN order, then a PINNED row for a currently-configured id the catalog doesn't cover (e.g. a hand-set
// `--advisor-model` pointing at an id outside ccx's 4-row rank table — D8's static table has no room to
// grow at dialog-render time, so a custom id would otherwise vanish from the list it is currently the
// value of), then `{label:"No advisor", value:"off"}` always last (canon's own fixed tail). Default focus
// is the CURRENT advisor's row, or `"off"` when none is set.
import React, { useState } from "react";
import { Box, Text } from "ink";
import { useSelectKeys } from "./keys/selectKeys.js";
import { resolveThemeColor, themeTokens, ACCENT, type ThemeTokenName } from "./theme.js";
import {
  advisorCatalog, advisorDisplayName, supportsAdvisor, advisorUnsupportedWarning,
  ADVISOR_TITLE, ADVISOR_BLURB, ADVISOR_RECOMMEND_PREFIX, ADVISOR_RECOMMEND_BODY, ADVISOR_LINK, ADVISOR_OFF_LABEL,
} from "./advisorModel.js";
import { resolveModelAlias } from "../config/models.js";

const role = (name: ThemeTokenName) => resolveThemeColor(themeTokens()[name]);
const FOOTER = "Enter to select · Esc to cancel";

interface AdvisorRow { label: string; value: string }

/** `current` is the ref value `useChat` carries (a RESOLVED id, or undefined for off — see `advisorModel.ts`'s
 *  `applyAdvisorChoice` return shape), never a bare alias; comparisons below resolve the catalog's own
 *  aliases the same way so a `sonnet` row matches a `current` of `resolveModelAlias("sonnet")`. Recomputed
 *  every render like `OutputStylePicker`'s own row list — cheap (a 3-entry filter) and `current` never
 *  changes across this dialog's lifetime, so there is nothing to memoize. */
function buildRows(current: string | undefined): AdvisorRow[] {
  const catalogAliases = advisorCatalog();
  const currentResolved = current !== undefined ? (resolveModelAlias(current) ?? current) : undefined;
  const inCatalog = currentResolved !== undefined
    && catalogAliases.some((alias) => (resolveModelAlias(alias) ?? alias) === currentResolved);
  const pinned = currentResolved !== undefined && !inCatalog ? currentResolved : undefined;
  return [
    ...catalogAliases.map((alias) => ({ label: advisorDisplayName(alias), value: alias })),
    ...(pinned !== undefined ? [{ label: advisorDisplayName(pinned), value: pinned }] : []),
    { label: ADVISOR_OFF_LABEL, value: "off" },
  ];
}

export function AdvisorDialog({ current, mainModel, onChoose, onCancel }: {
  current?: string;
  mainModel?: string;
  onChoose: (choice: string) => void;
  onCancel: () => void;
}) {
  const rows = buildRows(current);
  const currentResolved = current !== undefined ? (resolveModelAlias(current) ?? current) : undefined;
  const [idx, setIdx] = useState(() => currentResolved === undefined
    ? rows.length - 1
    : Math.max(0, rows.findIndex((r) => (resolveModelAlias(r.value) ?? r.value) === currentResolved)));
  useSelectKeys({ count: rows.length, index: idx, onMove: setIdx, onCancel, onAccept: () => onChoose(rows[idx].value) });

  const unsupported = mainModel !== undefined && !supportsAdvisor(mainModel);
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} borderColor={ACCENT}>
      <Text bold>{ADVISOR_TITLE}</Text>
      <Text dimColor>{ADVISOR_BLURB}</Text>
      {unsupported ? <Text color={role("warning")}>{advisorUnsupportedWarning(advisorDisplayName(mainModel!))}</Text> : null}
      <Text> </Text>
      {rows.map((r, i) => (
        <Text key={r.value} color={i === idx ? ACCENT : undefined}>{i === idx ? "❯ " : "  "}{r.label}</Text>
      ))}
      <Text> </Text>
      <Text><Text color={role("suggestion")}>{ADVISOR_RECOMMEND_PREFIX}</Text>{ADVISOR_RECOMMEND_BODY}</Text>
      <Text dimColor>{ADVISOR_LINK}</Text>
      <Text dimColor>{FOOTER}</Text>
    </Box>
  );
}
