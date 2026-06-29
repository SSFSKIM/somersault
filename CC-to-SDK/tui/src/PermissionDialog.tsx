// tui/src/PermissionDialog.tsx — CC-style approval gate: a numbered, arrow-selectable menu
// (Yes / Yes-don't-ask-again / No) over the tool + its full target. ↑/↓ + Enter, 1/2/3, Esc = No; the
// legacy a/A/d shortcuts still work. UI hints are absent headlessly, so the prompt is reconstructed from
// toolName + input. Shared by the chat REPL (ChatApp) and the daemon console (App).
import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { PermissionDecision } from "cc-harness";
import { ACCENT } from "./theme.js";

/** The salient target of a tool: the Bash command, the file path, else the first arg. */
function target(toolName: string, input: Record<string, unknown>): string {
  if (toolName === "Bash") return String(input.command ?? "");
  if (toolName === "Edit" || toolName === "Write" || toolName === "Read") return String(input.file_path ?? input.path ?? "");
  const v = Object.values(input ?? {})[0];
  return v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v);
}
const clip = (s: string, n = 140): string => (s.length > n ? s.slice(0, n - 1) + "…" : s);

interface Opt { key: string; label: string; decision: PermissionDecision }

export function PermissionDialog({ req, onDecision }: { req: { toolName: string; input: Record<string, unknown>; title?: string }; onDecision: (d: PermissionDecision) => void }) {
  const opts: Opt[] = [
    { key: "1", label: "Yes", decision: { kind: "allow_once" } },
    { key: "2", label: `Yes, and don't ask again for ${req.toolName} this session`, decision: { kind: "allow_always" } },
    { key: "3", label: "No, and tell Claude what to do differently (esc)", decision: { kind: "deny" } },
  ];
  const [idx, setIdx] = useState(0);
  useInput((input, key) => {
    if (key.escape) { onDecision({ kind: "deny" }); return; }
    if (key.upArrow) { setIdx((i) => Math.max(0, i - 1)); return; }
    if (key.downArrow) { setIdx((i) => Math.min(opts.length - 1, i + 1)); return; }
    if (key.return) { onDecision(opts[idx].decision); return; }
    const n = opts.findIndex((o) => o.key === input);
    if (n >= 0) { onDecision(opts[n].decision); return; }
    if (input === "a") onDecision({ kind: "allow_once" });          // legacy shortcuts
    else if (input === "A") onDecision({ kind: "allow_always" });
    else if (input === "d" || input === "D") onDecision({ kind: "deny" });
  });
  const tgt = clip(target(req.toolName, req.input));
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} borderColor={ACCENT}>
      <Text bold>Allow Claude to use <Text color={ACCENT}>{req.toolName}</Text>?</Text>
      {tgt ? <Text dimColor>{"  "}{req.toolName === "Bash" ? "$ " : ""}{tgt}</Text> : null}
      <Text> </Text>
      {opts.map((o, i) => (
        <Text key={o.key} color={i === idx ? ACCENT : undefined}>{i === idx ? "❯ " : "  "}{o.key}. {o.label}</Text>
      ))}
    </Box>
  );
}
