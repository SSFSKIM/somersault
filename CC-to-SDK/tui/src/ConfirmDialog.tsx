import React from "react";
import { Box, Text, useInput } from "ink";

export function ConfirmDialog({ message, onConfirm, onCancel }: { message: string; onConfirm: () => void; onCancel: () => void }) {
  useInput((input, key) => {
    if (input === "y" || input === "Y") onConfirm();
    else if (input === "n" || input === "N" || key.escape) onCancel();
  });
  return (<Box borderStyle="double" paddingX={1}><Text color="yellow">{message} (y/n)</Text></Box>);
}
