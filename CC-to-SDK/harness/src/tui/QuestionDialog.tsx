// tui/src/QuestionDialog.tsx — the AskUserQuestion dialog (spec Goal B): sequential per-question flow,
// [i/N] progress, header chips, multiSelect (space), an always-present "Other" free-text row → `response`
// (probe 65E's proven channel; that question gets NO answers entry). Esc = deny — we never fabricate.
//
// F2 Task 8: no `useInput`. List mode pushes the `Confirmation` context (↑/↓/Enter/Esc plus the bare y/n);
// the numbered rows and the multiSelect space are bound in no context and arrive on the keymap FALLBACK.
// The "Other" free-text row is the one place the table would EAT the user's answer — `y`, `n` and `enter` are
// all bound in Confirmation — so the scope is gated off while typing (`active: other === null`) and every
// keystroke, submit included, flows through the fallback instead. The action handlers re-check the same
// condition through a ref, which closes the sub-tick where the scope flag is one render stale.
import React, { useState } from "react";
import { Box, Text } from "ink";
import { useKeyActions, useKeyFallback, useKeyScope } from "./keys/KeymapProvider.js";
import { toKeyFlags } from "./keys/editorAdapter.js";
import { useRefState } from "./keys/refState.js";
import type { KeyEvent, TextEvent } from "./keys/types.js";
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
  // null = list mode; string = typing. Ref-backed: one stdin chunk parses into several events dispatched with
  // no render in between, so an accumulating buffer must be read synchronously (keys/refState.ts).
  const [other, setOther, otherRef] = useRefState<string | null>(null);
  const q = questions[qi];
  const otherIdx = q ? q.options.length : 0;                        // the "Other" row sits after the options

  // Advance with this question's contribution; finish after the last one. `response` is ONE string on the
  // SDK output — multiple Other answers join as labeled lines.
  const advance = (value?: string, freeText?: string) => {
    const a = value !== undefined && q ? { ...answers, [q.question]: value } : answers;
    const r = freeText !== undefined && q ? [...responses, questions.length > 1 ? `${q.header ?? q.question}: ${freeText}` : freeText] : responses;
    if (qi + 1 < questions.length) { setAnswers(a); setResponses(r); setQi(qi + 1); setIdx(0); setChecked(new Set()); setOther(null); return; }
    // Leave free-text mode BEFORE the terminal callback: the rest of the same stdin chunk still dispatches
    // into this (about-to-unmount) registration, and a lingering "still typing" flag would let a pasted
    // second line submit a second answer for a decision that has already been settled.
    setOther(null);
    onAnswer(a, r.length ? r.join("\n") : undefined);
  };
  // Enter (no argument) takes the cursor row; a number key names its own. The multiSelect split between them
  // is the original handler's, unchanged: a digit TOGGLES, Enter commits whatever is checked.
  const commit = (at?: number) => {
    if (!q) return;
    const target = at ?? idx;
    if (target === otherIdx) { setOther(""); return; }
    if (q.multiSelect) {
      if (at !== undefined) { const next = new Set(checked); next.has(at) ? next.delete(at) : next.add(at); setChecked(next); return; }
      const picked = [...checked].sort((x, y) => x - y).map((i) => q.options[i].label);
      if (picked.length) advance(picked.join(", "));                 // ", " — the SDK's declared join
      return;
    }
    advance(q.options[target].label);
  };

  // Malformed/empty questions: auto-deny ON MOUNT (plan-review M7) — rendering null while `pending` is
  // non-null would be an invisible dialog eating the next keypress.
  React.useEffect(() => { if (!q) onDeny(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  useKeyScope("Confirmation", { active: other === null });
  const inList = (f: () => void) => { if (q && otherRef.current === null) f(); };
  useKeyActions({
    "confirm:previous": () => inList(() => setIdx((i) => Math.max(0, i - 1))),
    "confirm:next": () => inList(() => setIdx((i) => Math.min(otherIdx, i + 1))),
    "confirm:yes": () => inList(() => commit()),                    // enter, and the table's bare `y`
    "confirm:no": () => inList(() => onDeny()),                     // escape, and the table's bare `n`
  });
  useKeyFallback((e: KeyEvent | TextEvent) => {
    if (!q) return;                                                 // auto-deny (above) is settling this
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
    if (input === " " && q.multiSelect && idx < otherIdx) {          // space toggles (multiSelect only)
      const next = new Set(checked); next.has(idx) ? next.delete(idx) : next.add(idx); setChecked(next); return;
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
