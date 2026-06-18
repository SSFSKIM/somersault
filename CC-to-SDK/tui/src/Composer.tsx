import React, { useState, useRef } from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";

export function Composer({ onSubmit }: { onSubmit: (text: string) => void }) {
  const [value, setValue] = useState("");
  const ref = useRef(""); // sync mirror — survives batched-update lag between onChange and onSubmit
  const handleChange = (v: string) => { ref.current = v; setValue(v); };
  const handleSubmit = () => { const v = ref.current; ref.current = ""; setValue(""); onSubmit(v); };
  return (
    <Box borderStyle="round" paddingX={1}>
      <Text>{"› "}</Text>
      <TextInput value={value} onChange={handleChange} onSubmit={handleSubmit} />
    </Box>
  );
}
