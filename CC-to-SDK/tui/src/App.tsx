import React, { useState } from "react";
import { Box, useApp, useInput } from "ink";
import type { DaemonClient } from "cc-harness";
import { useDaemon, type UseDaemonOpts } from "./useDaemon.js";
import { Pool } from "./Pool.js";
import { Detail } from "./Detail.js";
import { Composer } from "./Composer.js";
import { StatusBar } from "./StatusBar.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { PermissionDialog } from "./PermissionDialog.js";

export function App({ client, hookOpts }: { client: DaemonClient; socketPath?: string; hookOpts?: UseDaemonOpts }) {
  const d = useDaemon(client, hookOpts);
  const { exit } = useApp();
  const [confirm, setConfirm] = useState<{ message: string; action: () => void } | null>(null);
  const pending = d.pending[0];

  const quit = () => { d.teardown(); exit(); };

  // list-mode keys: navigation + selection-scoped ops + pool-level spawn; inactive while typing or confirming
  useInput((input, key) => {
    if (input === "q" || (key.ctrl && input === "c")) { quit(); return; }
    if (input === "j" || key.downArrow) d.select(1);
    else if (input === "k" || key.upArrow) d.select(-1);
    else if (key.return) d.focusInput();
    else if (input === "i") d.interrupt();
    else if (input === "m") d.cycleModel();
    else if (input === "p") d.cyclePermissionMode();
    else if (input === "/") d.compact();
    else if (input === "f") d.fork();
    else if (input === "P") d.toggleProactive();
    else if (input === "n") d.spawn();
    else if (input === "x" && d.selected) {
      const id = d.selected.id;
      setConfirm({ message: `Stop session ${id}?`, action: () => d.stop(id) });
    }
  }, { isActive: d.focus === "list" && !confirm && !pending });

  // input-mode: Esc returns to the list (typing + Enter are handled by Composer's TextInput)
  useInput((_input, key) => { if (key.escape) d.focusList(); }, { isActive: d.focus === "input" && !confirm && !pending });

  return (
    <Box flexDirection="column">
      <Box>
        <Pool rows={d.snapshot.sessions} selectedIndex={d.selectedIndex} />
        <Detail row={d.selected} stream={d.stream} />
      </Box>
      {d.focus === "input" ? <Composer onSubmit={(t) => { d.submit(t); d.focusList(); }} /> : null}
      {pending ? <PermissionDialog req={pending} onDecision={(dec) => d.respond(pending.toolUseID, dec)} /> : null}
      {confirm ? <ConfirmDialog message={confirm.message} onConfirm={() => { confirm.action(); setConfirm(null); }} onCancel={() => setConfirm(null)} /> : null}
      <StatusBar daemonUp={d.snapshot.daemonUp} focus={d.focus} status={d.status} />
    </Box>
  );
}
