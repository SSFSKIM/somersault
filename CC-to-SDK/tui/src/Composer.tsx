import React, { useState } from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";

export function Composer({ onSubmit }: { onSubmit: (text: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <Box borderStyle="round" paddingX={1}>
      <Text>{"› "}</Text>
      <TextInput value={value} onChange={setValue} onSubmit={(v) => { onSubmit(v); setValue(""); }} />
    </Box>
  );
}
