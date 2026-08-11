// Test-only real Ink bootstrap for Unix Ctrl-Z/fg acceptance; it never opens an SDK session.
import React from "react";
import { render, Text, useApp, useInput, useStdin, useStdout } from "ink";
import { createResumeSafeStdout } from "../../src/tui/chatMain.js";
import { suspendProcess } from "../../src/tui/suspend.js";

const output = createResumeSafeStdout(process.stdout);

function SuspendProbe() {
  const { exit } = useApp();
  const { stdin } = useStdin();
  const { write } = useStdout();
  useInput((input, key) => {
    if (key.ctrl && input === "z") {
      suspendProcess({ stdin, stdout: output.stdout, repaint: () => output.repaint(() => write("")) });
    }
    if (key.ctrl && input === "d") exit();
  });
  React.useEffect(() => { process.stdout.write("__CCX_INPUT_READY__"); }, []);
  return <Text>__CCX_TUI_READY__</Text>;
}

const app = render(<SuspendProbe />, { exitOnCtrlC: false, stdout: output.stdout });
await app.waitUntilExit();
