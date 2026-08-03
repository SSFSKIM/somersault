// tui/src/PlanDialog.tsx — the ExitPlanMode approval dialog (spec Goal B, probe 66): the plan rendered
// as markdown in a scrollable window, then CC's three choices. Approval releases the park; the CLI flips
// the mode itself and the HOST layers the acceptEdits upgrade on its status frame — this component only
// reports the human's choice. Reject opens a one-line feedback input (deny message the model sees).
//
// F2 Task 8: no `useInput`. The choosing view pushes the `Confirmation` context — ↑/↓ scroll the plan window,
// Esc/`n` open the feedback line, Enter/`y` approve. Enter/`y` are NEW here (the old handler read only 1/2/3
// and Esc) and deliberately map to the CONSERVATIVE approval, "yes, and manually approve edits": granting
// auto-accept must stay an explicit "1". The three digits stay in the component's own FALLBACK. The feedback
// line is free text, so — exactly like QuestionDialog's Other row — the scope is gated off while typing or
// `y`/`n`/`enter` would be eaten out of the user's message.
import React, { useMemo, useState } from "react";
import { Box, Text } from "ink";
import { useKeyActions, useKeyFallback, useKeyScope } from "./keys/KeymapProvider.js";
import { toKeyFlags } from "./keys/editorAdapter.js";
import { useRefState } from "./keys/refState.js";
import type { KeyEvent, TextEvent } from "./keys/types.js";
import { renderMarkdown } from "./markdown.js";
// The transcript's line renderer, reused verbatim: renderMarkdown's RenderLine carries bold/italic/segments
// (not just `{text, dim?, color?}`), and one renderer keeps the dialog's styling from drifting from the
// transcript's. `gutter` is never set on markdown output, so the shared branch is simply inert here.
import { Line } from "./Transcript.js";
import { ACCENT } from "./theme.js";

const WINDOW = 14;   // visible plan lines; ↑/↓ scrolls when longer

export function PlanDialog({ req, onDecision }: {
  req: { input: Record<string, unknown>; subagentType?: string };
  onDecision: (o: { kind: "plan_approve"; acceptEdits: boolean } | { kind: "plan_reject"; feedback?: string }) => void;
}) {
  const lines = useMemo(() => renderMarkdown(String((req.input as { plan?: unknown }).plan ?? "")), [req.input]);
  const [top, setTop] = useState(0);
  // null = choosing; string = typing. Ref-backed so a multi-event stdin chunk accumulates correctly
  // (keys/refState.ts) — the render closure would still read the buffer as it was before that chunk.
  const [feedback, setFeedback, feedbackRef] = useRefState<string | null>(null);
  const maxTop = Math.max(0, lines.length - WINDOW);
  // Leave the feedback line before the terminal callback, for the same reason QuestionDialog's advance does:
  // the rest of the chunk still dispatches here, and a second embedded newline must not reject twice.
  const reject = (v: string) => { setFeedback(null); onDecision({ kind: "plan_reject", ...(v ? { feedback: v } : {}) }); };
  useKeyScope("Confirmation", { active: feedback === null });
  const choosing = (f: () => void) => { if (feedbackRef.current === null) f(); };
  useKeyActions({
    "confirm:previous": () => choosing(() => setTop((t) => Math.max(0, t - 1))),
    "confirm:next": () => choosing(() => setTop((t) => Math.min(maxTop, t + 1))),
    "confirm:yes": () => choosing(() => onDecision({ kind: "plan_approve", acceptEdits: false })),   // enter / y
    "confirm:no": () => choosing(() => setFeedback("")),                                             // escape / n
  });
  useKeyFallback((e: KeyEvent | TextEvent) => {
    const { input, key } = toKeyFlags(e);
    const typing = feedbackRef.current;
    if (typing !== null) {
      if (key.escape) { setFeedback(null); return; }
      if (key.backspace || key.delete) { setFeedback(typing.slice(0, -1)); return; }
      // Same chunked-submit hazard as QuestionDialog's "Other" row (gb12): a paste can carry typed text AND
      // the submit together, so split at the first newline instead of trusting key.return alone.
      const t = input && !key.ctrl && !key.meta ? input : "";
      const nl = t.search(/\r\n?|\n/);
      if (key.return || nl !== -1) { reject((typing + (nl !== -1 ? t.slice(0, nl) : t)).trim()); return; }
      if (t && t >= " ") setFeedback(typing + t);
      return;
    }
    if (input === "1") { onDecision({ kind: "plan_approve", acceptEdits: true }); return; }
    if (input === "2") { onDecision({ kind: "plan_approve", acceptEdits: false }); return; }
    if (input === "3") setFeedback("");
  });
  const visible = lines.slice(top, top + WINDOW);
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} borderColor={ACCENT}>
      {req.subagentType ? <Text dimColor>Subagent ({req.subagentType}) asks:</Text> : null}
      <Text bold>Claude has finished planning. <Text color={ACCENT}>Approve this plan?</Text></Text>
      {top > 0 ? <Text dimColor>… ↑ {top} more</Text> : null}
      {visible.map((l, i) => <Line key={top + i} l={l} />)}
      {top < maxTop ? <Text dimColor>… ↓ {maxTop - top} more</Text> : null}
      <Text> </Text>
      {feedback !== null
        ? <Text color={ACCENT}>❯ What should Claude do differently? {feedback}<Text inverse> </Text></Text>
        : (<>
            <Text>1. Yes, and auto-accept edits</Text>
            <Text>2. Yes, and manually approve edits</Text>
            <Text>3. No, keep planning (esc)</Text>
            <Text dimColor>↑↓ scroll · 1/2/3 · y approve · esc</Text>
          </>)}
    </Box>
  );
}
