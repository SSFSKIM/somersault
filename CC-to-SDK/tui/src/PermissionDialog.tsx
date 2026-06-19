// tui/src/PermissionDialog.tsx — inline allow/always/deny gate. UI hints are absent headlessly, so the
// prompt is reconstructed from toolName+input (title used only if the SDK ever provides it).
import React from "react";
import { Box, Text, useInput } from "ink";
import type { PermissionDecision } from "cc-harness";

const briefArg = (input: Record<string, unknown>) => {
  const v = Object.values(input ?? {})[0];
  const s = v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 48 ? s.slice(0, 47) + "…" : s;
};

export function PermissionDialog({ req, onDecision }: { req: { toolName: string; input: Record<string, unknown>; title?: string }; onDecision: (d: PermissionDecision) => void }) {
  useInput((input) => {
    if (input === "a") onDecision({ kind: "allow_once" });
    else if (input === "A") onDecision({ kind: "allow_always" });
    else if (input === "d" || input === "D") onDecision({ kind: "deny" });
  });
  const title = req.title ?? `${req.toolName}(${briefArg(req.input)})`;
  return (
    <Box flexDirection="column" borderStyle="double" paddingX={1} borderColor="yellow">
      <Text color="yellow">Permission needed: {title}</Text>
      <Text dimColor>[a] allow once   [A] always ({req.toolName})   [d] deny</Text>
    </Box>
  );
}
