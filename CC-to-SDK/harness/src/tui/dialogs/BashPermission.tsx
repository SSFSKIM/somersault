// tui/dialogs/BashPermission.tsx — the Bash permission dialog (F6 T6), the first real body on the F6
// substrate. Transcribed from 2.1.220's `dZf` (L505224-287): the `Ed` frame titled "Bash command", the
// command in its own padded block with a dim description under it, the consent reason (`yN`), the
// destructive-table warning in the `warning` role, the question line, the `$Qf` option list inside a
// `Select`, and the shared `ConsultFooter` (T4).
//
// Everything pure lives in `bashOptions.ts`; this file is the wiring, and the wiring is the key contract:
//
//   · digits reach the embedded `Select` (it binds them in no context and reads them off the fallback);
//   · `y`/`n` are the `Confirmation` scope's two actions — REGISTERED ONLY while no text row has the cursor.
//     Deregistering is not a nicety: the binding still resolves, and an action with no handler falls through
//     to the fallback, which inside a Select is the Select's own — so the same `n` denies on a pick-one row
//     and types on a feedback row, with no key-sniffing anywhere;
//   · Enter and Escape belong to `SelectDecision`, which outranks `Confirmation` (the Select mounts inside
//     us, and the registry ranks by mount order). Enter therefore takes the HIGHLIGHTED row, exactly as
//     upstream's list does, and Escape arrives as the Select's `onCancel`;
//   · the legacy `a`/`A`/`d`/`D` letters ride `Select`'s `onUnhandledKey`, which is silent while a text row
//     is focused. They cannot use a fallback of our own: `fallbackHandler` hands the keyboard to exactly one
//     handler and that handler has to be the Select's. The mapping itself lives in `dialogKeys.ts`, shared
//     by all six bodies (T8).
//
// Recorded, not built: the title's `(unsandboxed)` variant (`Oo.isSandboxingEnabled()`, L505259 — this
// harness never sandboxes); the auto-mode row (`UDr` L504815, its row L504872 — a claude.ai entitlement);
// and upstream's `onFocus`-driven feedback hint node. The footer hints came in with T4.
//
// THE EXPLAIN AFFORDANCE (Wave T t7, upstream's `ZMn` hook L505015-52, rendered by `eDn` L505095-104).
// Upstream gates it on a setting (`Kdi()` = `permissionExplainerEnabled !== false`, L504907-09) and calls
// its generator directly. Ours takes the generator's TRANSPORT as a prop, undefaulted, and the gate IS that
// prop: with no transport the action registers nowhere, the footer advertises no `ctrl+e`, and the key falls
// through to the Select's fallback (so a feedback row keeps readline's end-of-line). That is the shipping
// state — W-T13 chose the route (structuredExplainTransport) but wiring a dialog that makes model calls by
// default is a separate, deliberate decision. Everything else is upstream's: the request is issued on the
// FIRST reveal only and the promise is kept, later toggles move nothing but `visible`, and unmount aborts.
import React, { useEffect, useRef, useState } from "react";
import { Box, Text } from "ink";
import { DialogFrame } from "./DialogFrame.js";
import { ConsultFooter } from "./ConsultFooter.js";
import { ExplanationBlock } from "./ExplanationBlock.js";
import { explainCommand as runExplain, type ExplainTransport, type Explanation } from "./explainCommand.js";
import { Select } from "../select/Select.js";
import { consentReasonLine } from "./consentReason.js";
import { legacyKeyDecision } from "./dialogKeys.js";
import { destructiveWarning } from "./destructive.js";
import { bashDecision, bashOptions } from "./bashOptions.js";
import { collapseOnFocusChange, escapeFeedbackMode, isAmendableRow, toggleFeedbackMode, NO_FEEDBACK, type FeedbackMode } from "./optionRows.js";
import { useKeyActions, useKeyScope } from "../keys/KeymapProvider.js";
import { resolveThemeColor, themeTokens } from "../theme.js";
import type { PermissionDecision, PermissionUpdateLike } from "../../permissions/types.js";

/** The slice of a `PermissionRequest` this body reads. Structural, so a parked decision (which carries more)
 *  satisfies it as-is. */
export interface BashPermissionRequest {
  input: Record<string, unknown>;
  /** Only the explain prompt reads it (upstream's `e.toolName`, L505231); "Bash" is what this body is for. */
  toolName?: string;
  description?: string;
  subagentType?: string;
  suggestions?: PermissionUpdateLike[];
  decisionReason?: string;
}

export function BashPermission({ req, onDecision, cwd = process.cwd(), explainCommand }: {
  req: BashPermissionRequest;
  onDecision: (d: PermissionDecision) => void;
  /** The SESSION's working directory (see permissionKind.ts) — the suggestions-summary row names it. */
  cwd?: string;
  /** The explain transport (explainCommand.ts). Undefined = no explainer: no key, no hint. See the header. */
  explainCommand?: ExplainTransport;
}) {
  const command = typeof req.input.command === "string" ? req.input.command : "";
  const suggestions = req.suggestions ?? [];
  // Upstream keeps `yesInputMode`/`noInputMode` as a pair; only the `no` half is reachable here (the SDK's
  // allow arm has no message field — T3), so Tab on Yes is dropped rather than toggling a mode whose row
  // would never render as text and whose Esc would then eat a keypress doing nothing visible.
  const [feedback, setFeedback] = useState<FeedbackMode>(NO_FEEDBACK);
  // What the feedback row currently holds, mirrored off `Select`'s `onInputChange` (t5). A REF, not state:
  // one stdin chunk parses into several events with no render between them, so a same-chunk `x` + `up` read
  // off a render closure would still see the empty field and collapse a row that just got its first letter.
  const feedbackText = useRef("");
  const options = bashOptions({ command, suggestions, feedback, cwd });
  const [focus, setFocus] = useState<string>(options[0]!.value);
  const inputFocused = options.find((o) => o.value === focus)?.type === "input";

  const warning = destructiveWarning(command);
  const reason = consentReasonLine(req.decisionReason);

  const [explainVisible, setExplainVisible] = useState(false);
  const [explanation, setExplanation] = useState<Promise<Explanation> | null>(null);
  const explainAbort = useRef<AbortController | null>(null);
  useEffect(() => () => explainAbort.current?.abort(), []);
  const toggleExplanation = () => {
    if (!explainVisible && !explanation && explainCommand) {
      const ac = new AbortController(); explainAbort.current = ac;
      const p = runExplain({ toolName: req.toolName ?? "Bash", toolInput: req.input, toolDescription: req.description, signal: ac.signal }, explainCommand);
      p.catch(() => {});          // the BLOCK reports the rejection; this only keeps node from calling it unhandled
      setExplanation(p);
    }
    setExplainVisible((v) => !v);
  };

  useKeyScope("Confirmation");
  useKeyActions({
    ...(inputFocused ? {} : {
      "confirm:yes": () => onDecision({ kind: "allow_once" }),
      "confirm:no": () => onDecision({ kind: "deny" }),
    }),
    // Registered ONLY with a transport in hand — see the header. Unlike y/n this stays live on a feedback
    // row: upstream's gate is the setting alone (L505039), and T4's footer keeps advertising it there.
    ...(explainCommand ? { "confirm:toggleExplanation": toggleExplanation } : {}),
  });

  return (
    <DialogFrame title="Bash command" subagentType={req.subagentType}>
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text dimColor={explainVisible}>{command}</Text>
        {req.description && !explainVisible ? <Text dimColor>{req.description}</Text> : null}
        <ExplanationBlock visible={explainVisible} promise={explanation} />
      </Box>
      <Box flexDirection="column">
        {reason ? <Text>{reason}</Text> : null}
        {warning ? <Box marginBottom={1}><Text color={resolveThemeColor(themeTokens().warning)}>{warning}</Text></Box> : null}
        <Text>Do you want to proceed?</Text>
        <Select
          options={options} inlineDescriptions context="SelectDecision"
          onChange={(value, text) => onDecision(bashDecision(value, { text, suggestions }))}
          // Esc has two jobs and they are ordered (optionRows.ts): leave a half-typed feedback row first,
          // cancel the whole dialog second.
          onCancel={() => { const next = escapeFeedbackMode(feedback); if (next) setFeedback(next); else onDecision({ kind: "deny" }); }}
          // Leaving an EMPTY feedback row puts the plain row back (L505162-169); one holding text stays open.
          onFocus={(value) => { setFocus(value); setFeedback((m) => collapseOnFocusChange(m, value, feedbackText.current.trim() === "")); }}
          onInputChange={(value, text) => { if (value === "no") feedbackText.current = text; }}
          onInputModeToggle={(value) => { if (isAmendableRow(value)) setFeedback(toggleFeedbackMode(feedback, value)); }}
          onUnhandledKey={(e) => { const d = legacyKeyDecision(e); if (d) onDecision(d); }}
        />
      </Box>
      <ConsultFooter amendable={isAmendableRow(focus)} inputMode={inputFocused} explain={explainCommand ? (explainVisible ? "hide" : "explain") : undefined} />
    </DialogFrame>
  );
}
