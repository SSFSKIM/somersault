import React, { useLayoutEffect, useRef } from "react";
import { Box, Text, useStdin } from "ink";

export function ConfirmDialog({ message, onConfirm, onCancel }: { message: string; onConfirm: () => void; onCancel: () => void }) {
  const onConfirmRef = useRef(onConfirm);
  const onCancelRef = useRef(onCancel);
  onConfirmRef.current = onConfirm;
  onCancelRef.current = onCancel;

  const { stdin } = useStdin();
  useLayoutEffect(() => {
    const handler = (data: unknown) => {
      const s = String(data);
      if (s === "y" || s === "Y") onConfirmRef.current();
      else if (s === "n" || s === "N" || s === "\x1b") onCancelRef.current();
    };
    stdin.on("data", handler);
    return () => { stdin.off("data", handler); };
  }, [stdin]);

  return (
    <Box borderStyle="double" paddingX={1}>
      <Text color="yellow">{message} (y/n)</Text>
    </Box>
  );
}
