import React from "react";
import { Box, Text } from "ink";

const LIST_KEYS = "j/k move · enter prompt · i intr · m model · p mode · / compact · f fork · P proactive · x stop · n new · q quit";
const INPUT_KEYS = "type prompt · enter send · esc cancel";

export function StatusBar({ daemonUp, focus, status }: { daemonUp: boolean; focus: "list" | "input"; status?: string }) {
  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1}>
      <Box>
        <Text color={daemonUp ? "green" : "red"}>● daemon {daemonUp ? "up" : "down"}</Text>
        {status ? <Text>{"  "}{status}</Text> : null}
      </Box>
      <Text dimColor>{focus === "input" ? INPUT_KEYS : LIST_KEYS}</Text>
    </Box>
  );
}
