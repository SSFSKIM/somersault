// tui/src/QuestionDialog.tsx — the AskUserQuestion dialog (spec Goal B): sequential per-question flow,
// [i/N] progress, header chips, multiSelect (space), an always-present "Other" free-text row → `response`
// (probe 65E's proven channel; that question gets NO answers entry). Esc = deny — we never fabricate.
import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
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
  const [checked, setChecked] = useState<ReadonlySet<number>>(new Set());
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [responses, setResponses] = useState<string[]>([]);
  const [other, setOther] = useState<string | null>(null);          // null = list mode; string = typing
  const q = questions[qi];
  const otherIdx = q ? q.options.length : 0;                        // the "Other" row sits after the options

  // Advance with this question's contribution; finish after the last one. `response` is ONE string on the
  // SDK output — multiple Other answers join as labeled lines.
  const advance = (value?: string, freeText?: string) => {
    const a = value !== undefined && q ? { ...answers, [q.question]: value } : answers;
    const r = freeText !== undefined && q ? [...responses, questions.length > 1 ? `${q.header ?? q.question}: ${freeText}` : freeText] : responses;
    if (qi + 1 < questions.length) { setAnswers(a); setResponses(r); setQi(qi + 1); setIdx(0); setChecked(new Set()); setOther(null); return; }
    onAnswer(a, r.length ? r.join("\n") : undefined);
  };

  // Malformed/empty questions: auto-deny ON MOUNT (plan-review M7) — rendering null while `pending` is
  // non-null would be an invisible dialog eating the next keypress.
  React.useEffect(() => { if (!q) onDeny(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  useInput((input, key) => {
    if (!q) return;                                                 // auto-deny (above) is settling this
    if (other !== null) {                                           // free-text mode
      if (key.return) { const t = other.trim(); t ? advance(undefined, t) : setOther(null); return; }
      if (key.escape) { setOther(null); return; }
      if (key.backspace || key.delete) { setOther(other.slice(0, -1)); return; }
      if (input && !key.ctrl && !key.meta) setOther(other + input);
      return;
    }
    if (key.escape) { onDeny(); return; }
    if (key.upArrow) { setIdx((i) => Math.max(0, i - 1)); return; }
    if (key.downArrow) { setIdx((i) => Math.min(otherIdx, i + 1)); return; }
    const num = /^[1-9]$/.test(input) ? Number(input) - 1 : undefined;
    const at = num !== undefined && num <= otherIdx ? num : undefined;
    if (input === " " && q.multiSelect && idx < otherIdx) {         // space toggles (multiSelect only)
      const next = new Set(checked); next.has(idx) ? next.delete(idx) : next.add(idx); setChecked(next); return;
    }
    if (key.return || at !== undefined) {
      const target = at ?? idx;
      if (target === otherIdx) { setOther(""); return; }
      if (q.multiSelect) {
        if (at !== undefined) { const next = new Set(checked); next.has(at) ? next.delete(at) : next.add(at); setChecked(next); return; }
        const picked = [...checked].sort((a, b) => a - b).map((i) => q.options[i].label);
        if (picked.length) advance(picked.join(", "));              // ", " — the SDK's declared join
        return;
      }
      advance(q.options[target].label);
    }
  });

  if (!q) return null;
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} borderColor={ACCENT}>
      {req.subagentType ? <Text dimColor>Subagent ({req.subagentType}) asks:</Text> : null}
      <Text bold>{q.header ? <Text color={ACCENT}>[{q.header}] </Text> : null}{q.question}{questions.length > 1 ? <Text dimColor>  [{qi + 1}/{questions.length}]</Text> : null}</Text>
      <Text> </Text>
      {q.options.map((o, i) => (
        <Text key={i} color={i === idx ? ACCENT : undefined}>
          {i === idx ? "❯ " : "  "}{q.multiSelect ? (checked.has(i) ? "[x] " : "[ ] ") : ""}{i + 1}. {o.label}{o.description ? <Text dimColor>  {o.description}</Text> : null}
        </Text>
      ))}
      {other !== null
        ? <Text color={ACCENT}>❯ Other: {other}<Text inverse> </Text></Text>
        : <Text color={idx === otherIdx ? ACCENT : undefined}>{idx === otherIdx ? "❯ " : "  "}{otherIdx + 1}. Other…</Text>}
      <Text dimColor>{q.multiSelect ? "space toggle · enter submit · esc decline" : "↑↓ · number · enter · esc decline"}</Text>
    </Box>
  );
}
