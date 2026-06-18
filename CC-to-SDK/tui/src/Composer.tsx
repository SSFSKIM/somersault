import React, { useState, useLayoutEffect, useRef } from "react";
import { Box, Text, useStdin } from "ink";

export function Composer({ onSubmit }: { onSubmit: (text: string) => void }) {
  const [value, setValue] = useState("");
  const valueRef = useRef(value);
  const onSubmitRef = useRef(onSubmit);
  valueRef.current = value;
  onSubmitRef.current = onSubmit;

  const { stdin } = useStdin();
  useLayoutEffect(() => {
    const handler = (data: unknown) => {
      const s = String(data);
      if (s === "\r" || s === "\n") {
        onSubmitRef.current(valueRef.current);
        setValue("");
        return;
      }
      if (s === "\x7f" || s === "\b") {
        setValue((v) => v.slice(0, -1));
        return;
      }
      if (s.startsWith("\x1b") || (s.length === 1 && s.charCodeAt(0) < 32)) return;
      setValue((v) => v + s);
    };
    stdin.on("data", handler);
    return () => { stdin.off("data", handler); };
  }, [stdin]);

  return (
    <Box borderStyle="round" paddingX={1}>
      <Text>{"› "}{value}</Text>
    </Box>
  );
}
