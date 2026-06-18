// tui/src/PermissionDialog.tsx — inline allow/always/deny gate. UI hints are absent headlessly, so the
// prompt is reconstructed from toolName+input (title used only if the SDK ever provides it).
// Implementation note: subscribes to stdin 'data' via useLayoutEffect (not useInput) so the handler
// is registered synchronously with render — making it safe to write keys immediately after render in tests.
import React, { useLayoutEffect } from "react";
import { Box, Text, useStdin } from "ink";
import type { PermissionRequest, PermissionDecision } from "cc-harness";

const briefArg = (input: Record<string, unknown>) => {
  const v = Object.values(input ?? {})[0];
  const s = v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 48 ? s.slice(0, 47) + "…" : s;
};

export function PermissionDialog({ req, onDecision }: { req: PermissionRequest; onDecision: (d: PermissionDecision) => void }) {
  const { stdin } = useStdin() as { stdin: NodeJS.ReadableStream & { on: Function; removeListener: Function } };
  useLayoutEffect(() => {
    const handler = (data: string) => {
      if (data === "a") onDecision({ kind: "allow_once" });
      else if (data === "A") onDecision({ kind: "allow_always" });
      else if (data === "d" || data === "D") onDecision({ kind: "deny" });
    };
    stdin?.on("data", handler);
    return () => { stdin?.removeListener("data", handler); };
  }, [stdin, onDecision]);
  const title = req.title ?? `${req.toolName}(${briefArg(req.input)})`;
  return (
    <Box flexDirection="column" borderStyle="double" paddingX={1} borderColor="yellow">
      <Text color="yellow">Permission needed: {title}</Text>
      <Text dimColor>[a] allow once   [A] always ({req.toolName})   [d] deny</Text>
    </Box>
  );
}
