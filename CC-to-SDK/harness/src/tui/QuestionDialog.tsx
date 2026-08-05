// tui/src/QuestionDialog.tsx — the AskUserQuestion dialog (spec Goal B): sequential per-question flow,
// [i/N] progress, header chips, an always-present "Other" free-text row → `response` (probe 65E's proven
// channel; that question gets NO answers entry). Esc = deny — we never fabricate.
//
// F6 Task 2 (+ its review): this component owns no keys at all any more. Both question kinds are the F6 list
// primitives, exactly as upstream wires them (L504149-504156: `V3` when `multiSelect`, `jr` — our `Select` —
// otherwise), over the same option list `[...options, Other]` (L504107-504110) with upstream's own placeholder
// inconsistency ("Type something" for multiSelect, "Type something." for single — L504097). The primitives
// bring the whole `Select` keymap with them, which is the point: `j`/`k`, `ctrl+n`/`ctrl+p`, PageUp/PageDown,
// Home/End and the digit shortcuts now work here because they are written once, not because this file grew
// five more branches.
//
// THE CONTEXT IS `SelectDecision`, NOT `Select` (review Important 1). A picker the user opened is an OVERLAY
// and unbinds the six root globals; a dialog answering the MODEL is a DECISION surface and keeps them —
// Ctrl-C must still arm the exit hint over a parked question and Ctrl-O must still open the pager, which is
// what the old `Confirmation` scope did deliberately. bindings.ts carries the full argument.
//
// Two behaviour changes this migration makes on purpose, both upstream's:
//   · THE BARE `y`/`n` ARE GONE. They were `Confirmation`'s (an F0 re-homing), and upstream's question dialog
//     is a `Select` list with no such shortcut. With the `Confirmation` scope dropped they are inert in list
//     mode — and, more importantly, they are plain text the instant the Other row has the cursor, with no
//     scope-gating trick needed: `Select` does not register select:next/previous/accept at all while an input
//     row is focused (Select.tsx's header), so every key falls through to the row.
//   · THE "OTHER" ROW IS NO LONGER A MODE. It is a permanent `type:"input"` row of the list. Consequences:
//     Enter on it with text submits that text (unchanged), Enter on it EMPTY cancels the whole question
//     (upstream's `RLe` empty-submit rule, L397115-397118 — it used to just close the row), and a multiline
//     paste is inserted rather than split at the first newline (our `InputText` drops the C0 bytes; upstream's
//     `Vs` is genuinely multiline — recorded divergence).
//
// Upstream also offers a third row, `{value:"__chat__", label:"Chat about this"}` (L504112). It is DELIBERATELY
// NOT SHIPPED: it is gated on a capability flag (`Ea()`) and single-select only, and picking it calls
// `onRespondToClaude` (L504436-504441), which assembles the partial answers into a *third* wire message — a
// channel this harness does not have. Our two callbacks are `onAnswer(answers, response?)` and `onDeny()`, and
// routing "Chat about this" into either would fabricate an answer or report a refusal the user never made.
// A dead row that looks live is worse than no row.
import React, { useState } from "react";
import { Box, Text } from "ink";
import { MultiSelect } from "./select/MultiSelect.js";
import { Select, type SelectOption } from "./select/Select.js";
import { ACCENT } from "./theme.js";

export interface QuestionSpec { question: string; header?: string; options: { label: string; description?: string }[]; multiSelect: boolean }

export function parseQuestions(input: Record<string, unknown>): QuestionSpec[] {
  const qs = (input as { questions?: unknown }).questions;
  if (!Array.isArray(qs)) return [];
  return qs.map((q: any) => ({
    question: String(q?.question ?? ""), header: q?.header ? String(q.header) : undefined,
    options: Array.isArray(q?.options) ? q.options.map((o: any) => ({ label: String(o?.label ?? ""), description: o?.description ? String(o.description) : undefined })) : [],
    multiSelect: !!q?.multiSelect,
  }));
}

const OTHER = "__other__";
const MULTI_FOOTER = "space toggle · ↓ to Submit · esc decline";
const SINGLE_FOOTER = "↑↓/j/k · number · enter · esc decline";

export function QuestionDialog({ req, onAnswer, onDeny }: {
  req: { input: Record<string, unknown>; subagentType?: string };
  onAnswer: (answers: Record<string, string>, response?: string) => void;
  onDeny: () => void;
}) {
  const questions = parseQuestions(req.input);
  const [qi, setQi] = useState(0);
  // multiSelect only: the values MultiSelect has checked (option labels, plus "__other__"), in pick order —
  // upstream keeps the same order for the same reason (L397322) — and the text the Other row is holding.
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [otherText, setOtherText] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [responses, setResponses] = useState<string[]>([]);
  const q = questions[qi];
  const multi = q?.multiSelect === true;

  // Advance with this question's contribution; finish after the last one. `response` is ONE string on the
  // SDK output — multiple Other answers join as labeled lines.
  const advance = (value?: string, freeText?: string) => {
    const a = value !== undefined && q ? { ...answers, [q.question]: value } : answers;
    const r = freeText !== undefined && q ? [...responses, questions.length > 1 ? `${q.header ?? q.question}: ${freeText}` : freeText] : responses;
    if (qi + 1 < questions.length) { setAnswers(a); setResponses(r); setQi(qi + 1); setPicked(new Set()); setOtherText(""); return; }
    onAnswer(a, r.length ? r.join("\n") : undefined);
  };

  // `I4b` (L504027): an option's own label is its value. The Other row is the same shape either way apart
  // from upstream's placeholder inconsistency (L504097).
  const rowsFor = (placeholder: string): SelectOption[] => q
    ? [
        ...q.options.map((o): SelectOption => ({ value: o.label, label: o.label, description: o.description })),
        { type: "input", value: OTHER, label: "Other", placeholder, initialValue: otherText },
      ]
    : [];

  /** Single-select: `Select` hands back the picked value, plus the typed text when the row was the Other one.
   *  An EMPTY Other submit never reaches here — `Select` calls `onCancel` for it (L397115-397118). */
  const pickSingle = (value: string, text?: string) => {
    if (value === OTHER) { const v = (text ?? "").trim(); if (v) advance(undefined, v); return; }
    advance(value);
  };
  const togglePicked = (v: string) => setPicked((prev) => { const next = new Set(prev); next.has(v) ? next.delete(v) : next.add(v); return next; });
  const submitMulti = () => {
    if (!q) return;
    const labels = [...picked].filter((v) => v !== OTHER);           // `k4b` (L504033)
    const free = picked.has(OTHER) ? otherText.trim() : "";
    if (!labels.length && !free) return;                             // nothing to answer with — Submit is inert
    advance(labels.length ? labels.join(", ") : undefined, free || undefined);   // ", " — the SDK's declared join
  };

  // Malformed/empty questions: auto-deny ON MOUNT (plan-review M7) — rendering null while `pending` is
  // non-null would be an invisible dialog eating the next keypress.
  React.useEffect(() => { if (!q) onDeny(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!q) return null;
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} borderColor={ACCENT}>
      {req.subagentType ? <Text dimColor>Subagent ({req.subagentType}) asks:</Text> : null}
      <Text bold>{q.header ? <Text color={ACCENT}>[{q.header}] </Text> : null}{q.question}{questions.length > 1 ? <Text dimColor>  [{qi + 1}/{questions.length}]</Text> : null}</Text>
      <Text> </Text>
      {/* Remounted per question, the way upstream keys its own list on `KM.question` (L504149): the focus, the
          window and the Other row's buffer all belong to ONE question. Keyed on the INDEX, not the text, so
          two questions that happen to read the same do not share a mount. */}
      {multi ? (
        <MultiSelect key={qi} options={rowsFor("Type something")} values={picked} onToggle={togglePicked}
          onSubmit={submitMulti} onCancel={onDeny} onInputChange={(_v, t) => setOtherText(t)} context="SelectDecision"
          submitButtonText={qi + 1 === questions.length ? "Submit" : "Next"} />
      ) : (
        <Select key={qi} options={rowsFor("Type something.")} onChange={pickSingle} onCancel={onDeny}
          onInputModeToggle={undefined} context="SelectDecision" />
      )}
      <Text dimColor>{multi ? MULTI_FOOTER : SINGLE_FOOTER}</Text>
    </Box>
  );
}
