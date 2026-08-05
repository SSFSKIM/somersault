// tui/src/BgTasksPanel.tsx — THE BACKGROUND DIALOG (F6 T13, DG60), rebuilt on upstream's `rsi`
// (bundle L481110-481256): a titled frame whose subtitle counts what is running, sections with `  Label (n)`
// headers, `❯` rows carrying a status badge, and a detail sub-view behind Enter. The pure half (sections,
// badge, subtitle, clips, literals) is `bgDialogModel.ts`.
//
// Named against the one-letter trap it has always been named against: `TaskPanel.tsx` is the model's todo
// checklist, a different thing entirely. `/bg` (and now its `/tasks` + `/bashes` aliases) opens THIS.
//
// KEYS. The list is hand-rendered rather than a `Select`, because upstream's own dialog is: `rsi` draws its
// sections itself and drives the cursor from the keymap (`co({confirm:previous/next/yes}, …)`, L481132) with a
// raw `onKeyDown` beside it for `x`/`f` (L481141). Ours pushes the `Select` context through `useSelectKeys` —
// NOT `Confirmation` — for one reason the F2 table spells out: this dialog is an OVERLAY owner (ChatApp's
// `inputOwnerRef`), so the six root globals must not reach it, and `Select`'s null bindings are what says so.
// `x` and `left` are bound in no context and arrive on the keymap FALLBACK, exactly as `x` already did.
//
// WHAT THE DISMISS STRING DOES — and does NOT — do. Upstream cancels with
// `onDone("Background dialog dismissed", { display: "skip" })` (L481256), and `display:"skip"` resolves to
// `messages: []` at the local-jsx call site (L241496): the string is handed back and NOTHING is written to the
// transcript. So `BG_DISMISSED` exists as the literal and closing prints nothing — a line here would be text
// upstream deliberately does not print.
import React, { useState } from "react";
import { Box, Text } from "ink";
import { readFileSync } from "node:fs";
import { useKeyFallback } from "./keys/KeymapProvider.js";
import { useSelectKeys } from "./keys/selectKeys.js";
import { toKeyFlags } from "./keys/editorAdapter.js";
import type { KeyEvent, TextEvent } from "./keys/types.js";
import type { BgTaskRow } from "./bgTaskMeta.js";
import { DialogFrame } from "./dialogs/DialogFrame.js";
import { POINTER } from "./select/Select.js";
import { formatDuration } from "./format.js";
import { resolveThemeColor, themeTokens, type ThemeTokenName } from "./theme.js";
import {
  BG_DETAIL_FOOTER, BG_EMPTY, BG_FOOTER, BG_TITLE, bgBadge, bgGroups, bgLabelWidth, bgRowLabel, bgSection,
  bgSectionHeader, bgSubtitle, clipLine, MONITOR_DETAIL_TITLE, NO_OUTPUT, SHELL_DETAIL_TITLE, TAIL_LINES,
} from "./bgDialogModel.js";

const role = (name: ThemeTokenName) => resolveThemeColor(themeTokens()[name]);

const realReadTail = (path: string): string[] => {
  const lines = readFileSync(path, "utf8").split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines.slice(-TAIL_LINES);
};

/** `S4` (L478603): `(label)`, always dim, coloured by outcome. */
function StatusBadge({ status }: { status: string }) {
  const { label, color } = bgBadge(status);
  return <Text dimColor color={color ? role(color) : undefined}>{`(${label})`}</Text>;
}

/** `Woi`'s `local_bash` arm (L478656): the clipped label, a space, the badge. Every one of our sections
 *  renders this shape — upstream's richer agent row is built from progress fields our wire does not carry. */
function BgRow({ row, selected, columns }: { row: BgTaskRow; selected: boolean; columns: number }) {
  return (
    <Box flexDirection="row">
      <Text color={selected ? role("suggestion") : undefined}>{selected ? `${POINTER} ` : "  "}</Text>
      <Text color={selected ? role("suggestion") : undefined}>{clipLine(bgRowLabel(row), bgLabelWidth(columns))} </Text>
      <StatusBadge status={row.status} />
    </Box>
  );
}

/** `Jf.Row` (L479820-479852) as a two-column line: a bold label, then the value. */
function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return <Box flexDirection="row"><Box width={10} flexShrink={0}><Text bold>{label}</Text></Box><Box flexGrow={1}>{children}</Box></Box>;
}

const runtimeOf = (row: BgTaskRow, now: number): string | undefined =>
  row.startedAt === undefined ? undefined : formatDuration((row.endedAt ?? now) - row.startedAt);

/** `X8a` (L479740-479886). `Status:` / `Runtime:` / `Command:` and then the tail of the output file in a
 *  rounded box. TWO of upstream's clauses are UNREACHABLE here and are therefore absent rather than faked:
 *  the ` (exit code: N)` suffix (our `task_notification` carries `{status, summary}` and no code — probe 74)
 *  and the `of <bytes>` half of the line counter (we tail the file, we do not measure it). */
function ShellDetail({ row, columns, tail, now }: { row: BgTaskRow; columns: number; tail: string[]; now: number }) {
  const runtime = runtimeOf(row, now);
  const statusColor = row.status === "running" ? "background" : row.status === "completed" ? "success" : "error";
  return (
    <Box flexDirection="column">
      <DetailRow label="Status:"><Text color={role(statusColor)}>{row.status}</Text></DetailRow>
      {runtime ? <DetailRow label="Runtime:"><Text>{runtime}</Text></DetailRow> : null}
      <DetailRow label={bgSection(row.task_type) === "monitors" ? "Script:" : "Command:"}>
        <Text>{clipLine(row.command ?? row.description, 280)}</Text>
      </DetailRow>
      <Box flexDirection="column" marginTop={1}>
        <Text bold>Output:</Text>
        {tail.length === 0
          ? <Text dimColor>{NO_OUTPUT}</Text>
          : <>
              {/* upstream's `maxWidth: columns - 6` (L479924); stock Ink 5's Box has no maxWidth, so the same
                  budget is spent as a fixed `width` — the box is a reading pane either way. */}
              <Box borderStyle="round" paddingX={1} flexDirection="column" width={Math.max(20, columns - 6)}>
                {tail.map((l, i) => <Text key={i}>{l || " "}</Text>)}
              </Box>
              <Text dimColor italic>{`Showing ${tail.length} lines`}</Text>
            </>}
      </Box>
    </Box>
  );
}

/** `Zja` (L478311-478354, its frame at L478424): the agent sub-view puts `<agentType> › <description>` in the
 *  TITLE and the status line in the subtitle. `selectedAgent?.agentType ?? "agent"` is upstream's own fallback
 *  and it is all we have — the snapshot names the TYPE of task, not the agent definition behind it. */
const agentTitle = (row: BgTaskRow): string =>
  `${row.task_type === "local_agent" || row.task_type === "agent" ? "agent" : row.task_type} › ${row.description || "Async agent"}`;

function AgentStatusLine({ row, now }: { row: BgTaskRow; now: number }) {
  const runtime = runtimeOf(row, now);
  const word = row.status === "completed" ? "Completed" : row.status === "running" ? "Running" : row.status === "failed" ? "Failed" : "Stopped";
  const { color } = bgBadge(row.status);
  return (
    <Box flexDirection="row">
      <Text color={color ? role(color) : undefined}>{word}</Text>
      {runtime ? <Text dimColor>{` · ${runtime}`}</Text> : null}
      {row.summary ? <Text dimColor>{` · ${row.summary}`}</Text> : null}
    </Box>
  );
}

export function BgTasksPanel({ tasks, onStop, onClose, readTail, columns = 80, now = Date.now }: {
  tasks: BgTaskRow[];
  onStop: (taskId: string) => void;
  onClose: () => void;
  readTail?: (path: string) => string[];
  columns?: number;
  now?: () => number;
}) {
  const [idx, setIdx] = useState(0);
  const [detail, setDetail] = useState<string | null>(null);          // the task_id whose sub-view is open
  const { groups, flat } = bgGroups(tasks);
  const sel = Math.min(idx, Math.max(0, flat.length - 1));
  // A detail view whose task VANISHED (it finished and aged out of the finished cap, or a rewind cleared the
  // list) falls back to the list — `inDetail`, not `detail !== null`, is therefore what every key and the
  // render below branch on. Upstream does the same in an effect (L481205-481217).
  const detailRow = detail === null ? undefined : flat.find((t) => t.task_id === detail);
  const inDetail = detailRow !== undefined;
  const current = detailRow ?? flat[sel];
  const read = readTail ?? realReadTail;

  // The tail is read ONCE per detail open (upstream re-polls its own promise every second while the shell
  // runs; a keyless clone re-reads on re-entry instead — Escape/left and Enter again is the refresh).
  const [tail, setTail] = useState<string[]>([]);
  const openDetail = () => {
    const t = flat[sel];
    if (!t) return;
    setDetail(t.task_id);
    if (bgSection(t.task_type) === "agents") { setTail([]); return; }
    // A local_agent's `.output` is a symlink to the whole subagent transcript JSONL (bundle warning), which is
    // why only shell-shaped rows are tailed at all.
    if (!t.outputFile) { setTail([]); return; }
    try { setTail(read(t.outputFile)); } catch (e) { setTail([`✗ ${(e as Error).message}`]); }
  };
  const stopCurrent = () => { if (current?.status === "running") onStop(current.task_id); };

  useSelectKeys({
    count: flat.length, index: sel,
    onMove: (i) => { if (!inDetail) setIdx(i); },
    // Enter opens the detail view; inside it every accept key closes the whole dialog (`nr`'s own
    // `confirm:yes` → `onDone`, L479767).
    onAccept: () => { if (inDetail) onClose(); else openDetail(); },
    onCancel: onClose,
  });
  useKeyFallback((e: KeyEvent | TextEvent) => {
    const { input, key } = toKeyFlags(e);
    if (input === "x" && !key.ctrl && !key.meta) { stopCurrent(); return; }
    if (!inDetail) return;
    if (e.kind === "key" && e.name === "left") { setDetail(null); return; }        // `left` goes back (L479773)
    if (e.kind === "key" && e.name === "space") onClose();                          // space closes (L479771)
  });

  if (inDetail && detailRow) {
    const current = detailRow;
    const section = bgSection(current.task_type);
    const agent = section === "agents";
    return (
      <DialogFrame title={agent ? agentTitle(current) : section === "monitors" ? MONITOR_DETAIL_TITLE : SHELL_DETAIL_TITLE}
                   titleColor="background" color="background"
                   {...(agent ? { subtitle: <AgentStatusLine row={current} now={now()} /> } : {})}>
        {agent ? null : <ShellDetail row={current} columns={columns} tail={tail} now={now()} />}
        <Box marginTop={1}><Text dimColor italic>{BG_DETAIL_FOOTER}</Text></Box>
      </DialogFrame>
    );
  }

  const subtitle = bgSubtitle(tasks);
  return (
    <DialogFrame title={BG_TITLE} titleColor="background" color="background" {...(subtitle ? { subtitle } : {})}>
      {flat.length === 0
        ? <Text dimColor>{BG_EMPTY}</Text>
        : groups.map((g, gi) => (
            <Box key={g.key} flexDirection="column" marginTop={gi > 0 ? 1 : 0}>
              {/* `zSt` L481285: the LABEL is bold, the ` (n)` beside it only dim. */}
              <Text dimColor><Text bold>{`  ${g.label}`}</Text>{` (${g.rows.length})`}</Text>
              {g.rows.map((row) => <BgRow key={row.task_id} row={row} columns={columns} selected={row.task_id === flat[sel]?.task_id} />)}
            </Box>
          ))}
      <Box marginTop={1}><Text dimColor italic>{BG_FOOTER}</Text></Box>
    </DialogFrame>
  );
}
