// tui/src/QuestionDialog.tsx — the AskUserQuestion dialog (spec Goal B): sequential per-question flow,
// [i/N] progress, header chips, multiSelect (space), an always-present "Other" free-text row → `response`
// (probe 65E's proven channel; that question gets NO answers entry). Esc = deny — we never fabricate.
//
// F2 Task 8: no `useInput`. List mode pushes the `Confirmation` context (↑/↓/Enter/Esc plus the bare y/n);
// the numbered rows are bound in no context and arrive on the keymap FALLBACK.
// The "Other" free-text row is the one place the table would EAT the user's answer — `y`, `n` and `enter` are
// all bound in Confirmation — so the scope is gated off while typing (`active: other === null`) and every
// keystroke, submit included, flows through the fallback instead. The action handlers re-check the same
// condition through a ref, which closes the sub-tick where the scope flag is one render stale.
//
// F6 Task 2: a multiSelect question is no longer this file's hand-rolled check-boxes — it is the `MultiSelect`
// primitive, exactly as upstream wires it (L504146: `V3` for multiSelect, `jr`/Select otherwise), with the
// same option list `[...options, Other]` (L504107-504115) and the same caller-chosen submit label
// ("Submit" on the last question, "Next" before it — L504149). Three consequences worth naming:
//   · The "Other" row stops being a MODE this component enters and becomes a permanent `type:"input"` row of
//     the list — typing into it selects it, clearing it deselects it (MultiSelect, L397325-397341).
//   · Enter therefore TOGGLES the focused row; the answer is committed from the Submit row (L397399-397409).
//   · While a multiSelect question is up, the `Confirmation` scope is switched OFF and `MultiSelect` pushes
//     `Select` instead — otherwise the table's bare `y`/`n` would decide a question the user is still
//     check-boxing. Single-select questions keep every byte of the pre-F6 behaviour, which is what the
//     keys-migration pins (`keys-migration-dialogs.test.tsx`) are written against.
import React, { useState } from "react";
import { Box, Text } from "ink";
import { useKeyActions, useKeyFallback, useKeyScope } from "./keys/KeymapProvider.js";
import { toKeyFlags } from "./keys/editorAdapter.js";
import { useRefState } from "./keys/refState.js";
import type { KeyEvent, TextEvent } from "./keys/types.js";
import { MultiSelect } from "./select/MultiSelect.js";
import type { SelectOption } from "./select/Select.js";
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

export function QuestionDialog({ req, onAnswer, onDeny }: {
  req: { input: Record<string, unknown>; subagentType?: string };
  onAnswer: (answers: Record<string, string>, response?: string) => void;
  onDeny: () => void;
}) {
  const questions = parseQuestions(req.input);
  const [qi, setQi] = useState(0);
  const [idx, setIdx] = useState(0);
  // multiSelect only: the values MultiSelect has checked (option labels, plus "__other__"), in pick order —
  // upstream keeps the same order for the same reason (L397307), and the free text the Other row is holding.
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [otherText, setOtherText] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [responses, setResponses] = useState<string[]>([]);
  // null = list mode; string = typing. Ref-backed: one stdin chunk parses into several events dispatched with
  // no render in between, so an accumulating buffer must be read synchronously (keys/refState.ts).
  const [other, setOther, otherRef] = useRefState<string | null>(null);
  const q = questions[qi];
  const multi = q?.multiSelect === true;
  const otherIdx = q ? q.options.length : 0;                        // the "Other" row sits after the options

  // Advance with this question's contribution; finish after the last one. `response` is ONE string on the
  // SDK output — multiple Other answers join as labeled lines.
  const advance = (value?: string, freeText?: string) => {
    const a = value !== undefined && q ? { ...answers, [q.question]: value } : answers;
    const r = freeText !== undefined && q ? [...responses, questions.length > 1 ? `${q.header ?? q.question}: ${freeText}` : freeText] : responses;
    if (qi + 1 < questions.length) { setAnswers(a); setResponses(r); setQi(qi + 1); setIdx(0); setPicked(new Set()); setOtherText(""); setOther(null); return; }
    // Leave free-text mode BEFORE the terminal callback: the rest of the same stdin chunk still dispatches
    // into this (about-to-unmount) registration, and a lingering "still typing" flag would let a pasted
    // second line submit a second answer for a decision that has already been settled.
    setOther(null);
    onAnswer(a, r.length ? r.join("\n") : undefined);
  };
  // SINGLE-SELECT ONLY (multiSelect is MultiSelect's now). Enter (no argument) takes the cursor row; a number
  // key names its own.
  const commit = (at?: number) => {
    if (!q) return;
    const target = at ?? idx;
    if (target === otherIdx) { setOther(""); return; }
    advance(q.options[target].label);
  };

  // ---- multiSelect: the MultiSelect wiring (upstream's own `onChange`/`onSubmit` pair, L504147-504152) ----
  const multiOptions: SelectOption[] = q
    ? [
        // `I4b` (L504027): the option's own label is its value.
        ...q.options.map((o): SelectOption => ({ value: o.label, label: o.label, description: o.description })),
        // L504107 verbatim, trailing-period inconsistency included: the placeholder is "Type something" for a
        // multiSelect question and "Type something." for a single-select one (L504097). Upstream's own.
        { type: "input", value: "__other__", label: "Other", placeholder: "Type something", initialValue: otherText },
      ]
    : [];
  const togglePicked = (v: string) => setPicked((prev) => { const next = new Set(prev); next.has(v) ? next.delete(v) : next.add(v); return next; });
  const submitMulti = () => {
    if (!q) return;
    const labels = [...picked].filter((v) => v !== "__other__");     // `k4b` (L504033)
    const free = picked.has("__other__") ? otherText.trim() : "";
    if (!labels.length && !free) return;                             // nothing to answer with — Submit is inert
    advance(labels.length ? labels.join(", ") : undefined, free || undefined);   // ", " — the SDK's declared join
  };

  // Malformed/empty questions: auto-deny ON MOUNT (plan-review M7) — rendering null while `pending` is
  // non-null would be an invisible dialog eating the next keypress.
  React.useEffect(() => { if (!q) onDeny(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  // Off for a multiSelect question: MultiSelect pushes `Select` and owns every key, and leaving Confirmation
  // live under it would let the table's bare `y`/`n` answer a question mid-check-boxing.
  useKeyScope("Confirmation", { active: other === null && !multi });
  // The ref re-check closes the sub-tick where the scope flag is one render stale. Consequence worth naming: a
  // `y` arriving in the SAME stdin chunk that just opened the Other row still MATCHES `confirm:yes` — and an
  // action always consumes — so it is dropped rather than typed into the answer. A lost character, never a
  // wrong decision; same class as PermissionsDialog's NO_ACTIONS sub-tick.
  const inList = (f: () => void) => { if (q && !multi && otherRef.current === null) f(); };
  useKeyActions({
    "confirm:previous": () => inList(() => setIdx((i) => Math.max(0, i - 1))),
    "confirm:next": () => inList(() => setIdx((i) => Math.min(otherIdx, i + 1))),
    "confirm:yes": () => inList(() => commit()),                    // enter, and the table's bare `y`
    "confirm:no": () => inList(() => onDeny()),                     // escape, and the table's bare `n`
  });
  useKeyFallback((e: KeyEvent | TextEvent) => {
    if (!q || multi) return;                                        // auto-deny is settling this / MultiSelect owns it
    const { input, key } = toKeyFlags(e);
    const typing = otherRef.current;
    if (typing !== null) {                                          // free-text mode: the scope is off, all keys land here
      if (key.escape) { setOther(null); return; }
      if (key.backspace || key.delete) { setOther(typing.slice(0, -1)); return; }
      // A bracketed paste arrives as ONE text event that can carry the submit inside it — split at the first
      // newline instead of trusting key.return alone, or the text is silently dropped (gb12).
      const t = input && !key.ctrl && !key.meta ? input : "";
      const nl = t.search(/\r\n?|\n/);
      if (key.return || nl !== -1) { const v = (typing + (nl !== -1 ? t.slice(0, nl) : t)).trim(); v ? advance(undefined, v) : setOther(null); return; }
      if (t && t >= " ") setOther(typing + t);                       // never type a bare C0 byte into an answer
      return;
    }
    const num = /^[1-9]$/.test(input) ? Number(input) - 1 : undefined;
    if (num !== undefined && num <= otherIdx) commit(num);
  });

  if (!q) return null;
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} borderColor={ACCENT}>
      {req.subagentType ? <Text dimColor>Subagent ({req.subagentType}) asks:</Text> : null}
      <Text bold>{q.header ? <Text color={ACCENT}>[{q.header}] </Text> : null}{q.question}{questions.length > 1 ? <Text dimColor>  [{qi + 1}/{questions.length}]</Text> : null}</Text>
      <Text> </Text>
      {multi ? (
        // Remounted per question (`key`), the way upstream keys its own `V3` on `KM.question` (L504146): the
        // focus, the window and the Other row's buffer all belong to ONE question.
        <MultiSelect key={q.question} options={multiOptions} values={picked} onToggle={togglePicked}
          onSubmit={submitMulti} onCancel={onDeny} onInputChange={(_v, t) => setOtherText(t)}
          submitButtonText={qi + 1 === questions.length ? "Submit" : "Next"} />
      ) : (
        <>
          {q.options.map((o, i) => (
            <Text key={i} color={i === idx ? ACCENT : undefined}>
              {i === idx ? "❯ " : "  "}{i + 1}. {o.label}{o.description ? <Text dimColor>  {o.description}</Text> : null}
            </Text>
          ))}
          {other !== null
            ? <Text color={ACCENT}>❯ Other: {other}<Text inverse> </Text></Text>
            : <Text color={idx === otherIdx ? ACCENT : undefined}>{idx === otherIdx ? "❯ " : "  "}{otherIdx + 1}. Other…</Text>}
        </>
      )}
      <Text dimColor>{multi ? "space toggle · ↓ to Submit · esc decline" : "↑↓ · number · enter · esc decline"}</Text>
    </Box>
  );
}
