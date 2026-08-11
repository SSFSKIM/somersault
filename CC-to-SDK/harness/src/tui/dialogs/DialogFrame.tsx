// tui/dialogs/DialogFrame.tsx — the frame every permission-family dialog sits in (F6 T4). Transcribed from
// 2.1.220's `Ed` (L437992-438014) and its header `BAe` (L437937-986).
//
// The border is the signature: `borderStyle:"round"` with LEFT, RIGHT and BOTTOM switched off, so all that
// paints is a single horizontal rule above the dialog (L438011). There is no box — the dialog bleeds into
// the transcript below it, which is why `marginTop:1` is part of the frame rather than the caller's job.
// The border takes the `permission` role unless the caller names another: `planMode` for the plan dialogs,
// `warning` for the pause/limit ones.
//
// Two things upstream has that we deliberately do not:
//   · `Ed` passes `srPrefix:"Permission Required:"` down to `BAe`, which hangs it on the title as an
//     `aria-label` (L437995/L437959). Ink has no aria surface — there is nothing to attach it to, and an
//     invisible Text node would pollute every frame with a phantom line — so we render NOTHING and the
//     prefix is recorded UNREACHABLE beside DG22/DG23 in the T15 ledger.
//   · `BAe` takes a structured `requestSource` (`{type:"subagent", agentName}` /
//     `{type:"workflow-agent", workflowName}`), which can say "a subagent, name unknown". Our props are
//     flat, so an EMPTY STRING is how a caller says the same thing — that is what drives the
//     "· from a subagent" / "· from a workflow" fallbacks at L437944/L437951.
//
// This replaces the old `Subagent (<type>) asks:` line that PermissionDialog printed ABOVE its box; the
// attribution is a suffix on the title now (DG21). Task 6 does that rewiring — this module only ships the
// frame.

import React from "react";
import { Box, Text } from "ink";
import stringWidth from "string-width";
import { resolveThemeColor, themeTokens, type ThemeTokenName } from "../theme.js";
import { truncateLabel } from "../select/selectModel.js";

const role = (name: ThemeTokenName) => resolveThemeColor(themeTokens()[name]);

/** `oa(name, 24, !0)` L106993 with the single-line flag on. A multi-line name is cut at its first newline
 *  and gets an ellipsis for the lines it lost — unless the first line ALONE plus that ellipsis would
 *  already overflow (`Ut(n) + 1 > t`), in which case the ordinary clip runs instead. The clip itself is
 *  `gi` (L106951), which is character-for-character our `truncateLabel`. */
const NAME_WIDTH = 24;
function attributionName(name: string): string {
  const nl = name.indexOf("\n");
  if (nl === -1) return truncateLabel(name, NAME_WIDTH);
  const head = name.slice(0, nl);
  return stringWidth(head) + 1 > NAME_WIDTH ? truncateLabel(head, NAME_WIDTH) : `${head}…`;
}

export interface DialogFrameProps {
  title: string;
  /** A string renders dim and `truncate-start` (L437975); a node is rendered as given. */
  subtitle?: React.ReactNode;
  /** The BORDER role (`Ed`'s `color`, L437993). */
  color?: ThemeTokenName;
  /** The TITLE role (`Ed`'s `titleColor`, handed to `BAe` as its `color`). Defaults to the same
   *  `permission` role the border does — `BAe` has its own identical default at L437938. */
  titleColor?: ThemeTokenName;
  /** DG21 attribution. A non-empty name renders `· from the <name> agent`; the EMPTY STRING means "a
   *  subagent whose name we do not have" and renders `· from a subagent`. */
  subagentType?: string;
  /** As above, for a workflow: `· from the "<name>" workflow`, empty string → `· from a workflow`.
   *  Checked FIRST, matching `BAe`'s switch order (L437941). */
  workflowName?: string;
  /** Right-hand side of the header row, opposite the title (L438004). */
  titleRight?: React.ReactNode;
  /** `Ed`'s `innerPaddingX`, default 1 (L437993). */
  innerPaddingX?: number;
  children?: React.ReactNode;
}

/** `BAe` L437937-986. Exported because the plan/pause dialogs reuse the header without the rule. */
export function DialogHeader({ title, subtitle, color = "permission", subagentType, workflowName }:
Pick<DialogFrameProps, "title" | "subtitle" | "subagentType" | "workflowName"> & { color?: ThemeTokenName }) {
  let attribution: string | undefined;
  if (workflowName !== undefined) attribution = workflowName !== "" ? `from the "${attributionName(workflowName)}" workflow` : "from a workflow";
  else if (subagentType !== undefined) attribution = subagentType !== "" ? `from the ${attributionName(subagentType)} agent` : "from a subagent";
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1}>
        <Text bold color={role(color)}>{title}</Text>
        {attribution !== undefined ? <Text><Text dimColor>{"· "}</Text>{attribution}</Text> : null}
      </Box>
      {subtitle != null
        ? (typeof subtitle === "string" ? <Text dimColor wrap="truncate-start">{subtitle}</Text> : subtitle)
        : null}
    </Box>
  );
}

/** `Ed` L437992-438014. */
export function DialogFrame({
  title, subtitle, color = "permission", titleColor, subagentType, workflowName, titleRight,
  innerPaddingX = 1, children,
}: DialogFrameProps) {
  return (
    <Box
      flexDirection="column"
      borderStyle="round" borderColor={role(color)}
      borderLeft={false} borderRight={false} borderBottom={false}
      marginTop={1}
    >
      <Box paddingX={1} flexDirection="column">
        <Box justifyContent="space-between">
          <DialogHeader title={title} subtitle={subtitle} color={titleColor} subagentType={subagentType} workflowName={workflowName} />
          {titleRight}
        </Box>
      </Box>
      <Box flexDirection="column" paddingX={innerPaddingX}>{children}</Box>
    </Box>
  );
}
