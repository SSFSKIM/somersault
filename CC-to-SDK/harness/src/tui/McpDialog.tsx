// tui/src/McpDialog.tsx — the `/mcp` browser (T-MENU task 4, spec A2/D5-bl10): a navigation-STACK dialog
// (canon's second idiom, R1 §3.4 — distinct from the tab shell Tasks 1-3 built), `list → server-menu →
// server-tools → server-tool-detail`, riding Task 1's `DialogFrame`. Pure half is `mcpDialogModel.ts`.
//
// ONE `useSelectKeys` call drives every view (BgTasksPanel.tsx's own pattern: a hand-rendered list, because
// the root view interleaves non-selectable section headers among its rows — exactly canon's own reason for
// NOT using a generic list primitive here, bundle L581938-582001's `_e` array). `context: "Select"` (the
// default): this dialog is an OVERLAY the user opened via `/mcp`, not a decision surface answering the
// model, so the six root globals must not reach it — the same reasoning BgTasksPanel's own header spells
// out. `hintScope={["Select"]}` derives the footer from that same table: `select:previous`/`select:next`
// dedupe to one "navigate" hint, `select:accept` "select", `select:cancel` "cancel" — canon's own
// `↑↓ navigate · enter confirm · Esc cancel` (bundle L582001), close enough that reusing the shared
// vocabulary beats hand-writing a fourth spelling of the same three ideas.
//
// NO `onCancel` PASSED TO DialogFrame (task-4 brief): Esc resolves through this component's OWN
// `useSelectKeys` `onCancel`, which pops exactly one level (`popMcpView`) and closes on the root's Esc —
// never through DialogFrame's `confirm:no` hookup, which stays registered-but-inactive exactly as it does
// for every other pre-migration dialog.
import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import stringWidth from "string-width";
import { DialogFrame } from "./dialogs/DialogFrame.js";
import { useSelectKeys } from "./keys/selectKeys.js";
import { useRefState } from "./keys/refState.js";
import { POINTER } from "./select/Select.js";
import { moreAbove, moreBelow, overflowRows } from "./select/overflow.js";
import { truncateLabel } from "./select/selectModel.js";
import { resolveThemeColor, themeTokens, type ThemeTokenName } from "./theme.js";
import {
  buildListRows, flatIndexOfServer, mcpListVisibleRows, mcpToolsVisibleRows, mcpWindow,
  MCP_ROOT_VIEW, enterServerMenu, enterServerTools, enterToolDetail, popMcpView, findServer,
  serverMenuFields, statusText, toolAnnotationLabels, mcpSubtitle, MCP_TITLE,
  type McpServerRow, type McpToolInfo, type McpView,
} from "./mcpDialogModel.js";

const role = (name: ThemeTokenName) => resolveThemeColor(themeTokens()[name]);
/** Canon's own connection-status colouring (`ph`, bundle L278020-278032) reduced to the three roles our
 *  theme table actually has — `pending`/`disabled` stay the default (dim) text colour. */
const STATUS_COLOR: Partial<Record<McpServerRow["status"], ThemeTokenName>> = { connected: "success", failed: "error", "needs-auth": "warning" };

export const MCP_EMPTY = "No MCP servers configured.";
/** bl10 fix wave 1, finding 2: a REJECTED `mcpServerStatus()` (an older host, a transport failure) used to be
 *  swallowed into `setServers([])`, which reads onscreen as `MCP_EMPTY` — "No MCP servers configured." is not
 *  the truth when the real answer is "the call failed and we don't know". The old text-only `/mcp` command
 *  surfaced a failure; this dialog must too. `SettingsDialog`'s own read-only-tab fetch failure (`✗ ${message}`)
 *  is the house style this borrows. */
export const mcpFetchErrorText = (message: string): string => `✗ Couldn't load MCP servers: ${message}`;

function Row({ label, focused }: { label: React.ReactNode; focused: boolean }) {
  return (
    <Box flexDirection="row" gap={1}>
      <Text color={focused ? role("suggestion") : undefined}>{focused ? POINTER : " "}</Text>
      {label}
    </Box>
  );
}

/** bl10 fix wave 1, finding 4: `mcpListVisibleRows` budgets exactly ONE row per root-list entry, but this
 *  label used to render the name and the FULL status/failure text verbatim — a long server name or a long
 *  `failed: <error>` string wraps under Ink, so one entry silently costs two-plus rows and the window
 *  overflows the budget it was sized to, clipping the footer/counters off a narrow pane. Clipped to a single
 *  line instead: the full failure detail already lives one level down, in `serverMenuFields`' Status field
 *  (`server-menu` view) — the root row only needs to say ENOUGH to pick the right server. */
function ServerLabel({ server, width }: { server: McpServerRow; width: number }) {
  const statusColor = STATUS_COLOR[server.status];
  const status = statusText(server);
  const full = `${server.name}  ${status}`;
  if (stringWidth(full) <= width) {
    return <><Text>{server.name}</Text><Text dimColor color={statusColor ? role(statusColor) : undefined}>{"  "}{status}</Text></>;
  }
  // The name alone already fills the row (an extreme narrow-pane/long-name case) — clip it and drop the
  // status rather than split a string with nothing left to show of it.
  if (stringWidth(server.name) >= width) return <Text>{truncateLabel(server.name, width)}</Text>;
  const statusWidth = width - stringWidth(server.name) - 2;   // 2 = the "  " separator between the two runs
  return <><Text>{server.name}</Text><Text dimColor color={statusColor ? role(statusColor) : undefined}>{"  "}{truncateLabel(status, statusWidth)}</Text></>;
}

/** bl10 fix wave 2, finding 5: `ServerLabel`'s own discipline, for the `server-tools` view — only the
 *  DESCRIPTION used to be clipped (`descWidth`), never the NAME, so a long tool name wraps under Ink and
 *  costs its row more than the one physical line the window's budget counted it as. */
function ToolLabel({ tool, width }: { tool: McpToolInfo; width: number }) {
  const { name, description } = tool;
  if (description === undefined) return <Text>{truncateLabel(name, width)}</Text>;
  const full = `${name}  ${description}`;
  if (stringWidth(full) <= width) return <><Text>{name}</Text><Text dimColor>{"  "}{description}</Text></>;
  if (stringWidth(name) >= width) return <Text>{truncateLabel(name, width)}</Text>;
  const descWidth = width - stringWidth(name) - 2;             // 2 = the "  " separator between the two runs
  return <><Text>{name}</Text><Text dimColor>{"  "}{truncateLabel(description, descWidth)}</Text></>;
}

export function McpDialog({ fetchServers, onClose, rows = process.stdout.rows ?? 24, columns = process.stdout.columns ?? 80 }: {
  fetchServers: () => Promise<McpServerRow[]>;
  onClose: () => void;
  rows?: number;
  columns?: number;
}) {
  const [servers, setServers] = useState<McpServerRow[] | undefined>(undefined);
  // bl10 fix wave 1, finding 2: a rejected fetch is a DISTINCT state from "fetched zero servers" — the empty
  // list still renders (so the frame/subtitle/footer chrome stays intact) but the body says so instead of
  // silently reading as `MCP_EMPTY`.
  const [fetchError, setFetchError] = useState<string | undefined>(undefined);
  // Fetched once per MOUNT (D13's own philosophy — a fresh measurement on open — via the caller unmounting
  // and remounting this component on every `/mcp` open, exactly like `bgPanelOpen`'s conditional overlay arm).
  useEffect(() => {
    let cancelled = false;
    void fetchServers().then((s) => { if (!cancelled) setServers(s); })
      .catch((e: unknown) => { if (!cancelled) { setFetchError(e instanceof Error ? e.message : String(e)); setServers([]); } });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [view, setView] = useState<McpView>(MCP_ROOT_VIEW);
  // bl10 fix wave 2, finding 4: ref-backed, mirroring `Select.tsx`'s own pattern — `useSelectKeys`'s contract
  // (selectKeys.ts:18-22) requires a GETTER for any focus that can move more than once per stdin chunk, and a
  // plain `index` number (what this used to pass) is captured once per render. `onMove`/`onAccept` below read
  // the ref, never the render-closed state, so a same-chunk move+accept always acts on the POST-move row.
  const [serverFocus, setServerFocus, serverFocusRef] = useRefState(0);
  const [toolFocus, setToolFocus, toolFocusRef] = useRefState(0);

  const listRows = buildListRows(servers ?? []);
  const currentServer = view.type !== "list" ? findServer(servers ?? [], view.server) : undefined;
  const serverCount = listRows.reduce((n, r) => n + (r.kind === "server" ? 1 : 0), 0);

  const pop = () => { const next = popMcpView(view); if (next === null) onClose(); else setView(next); };

  // What THIS render's list-shaped concern is — the single hook call below reads whichever of these applies
  // to the CURRENT view. `server-menu` has no real list, only a one-row "View tools" affordance that exists
  // (count 1) exactly when the server has tools to show (canon's own gate, `_e.push({label:"View tools"}) if
  // …&& b>0`, bundle L278041); `server-tool-detail` has no list at all (count stays 0, `onAccept` a no-op —
  // `select:accept` still resolves on an empty list per `useSelectKeys`'s own contract, it just does nothing).
  let count = 0;
  let onAccept: () => void = () => {};
  if (view.type === "list") {
    count = serverCount;
    onAccept = () => {
      const flat = flatIndexOfServer(listRows, serverFocusRef.current);
      const row = flat >= 0 ? listRows[flat] : undefined;
      if (row?.kind === "server") setView(enterServerMenu(row.server.name));
    };
  } else if (view.type === "server-menu") {
    count = currentServer && currentServer.tools.length > 0 ? 1 : 0;
    onAccept = () => { if (currentServer && currentServer.tools.length > 0) { setToolFocus(0); setView(enterServerTools(currentServer.name)); } };
  } else if (view.type === "server-tools") {
    count = currentServer?.tools.length ?? 0;
    onAccept = () => { const t = currentServer?.tools[toolFocusRef.current]; if (currentServer && t) setView(enterToolDetail(currentServer.name, t.name)); };
  }

  useSelectKeys({
    count,
    index: () => (view.type === "server-tools" ? toolFocusRef.current : serverFocusRef.current),
    onMove: (i) => { if (view.type === "server-tools") setToolFocus(i); else setServerFocus(i); },
    onAccept, onCancel: pop,
  });

  const body = (() => {
    if (servers === undefined) return <Text dimColor>Loading…</Text>;

    if (view.type === "list") {
      if (serverCount === 0) {
        if (fetchError !== undefined) return <Text color={role("error")}>{mcpFetchErrorText(fetchError)}</Text>;
        return <Text dimColor>{MCP_EMPTY}</Text>;
      }
      const flatFocus = flatIndexOfServer(listRows, serverFocus);
      const visible = mcpListVisibleRows(rows);
      const win = mcpWindow(listRows.length, flatFocus, visible);
      const { above, below } = overflowRows(win, listRows.length);
      // bl10 fix wave 1, finding 4: the chrome each root row sits behind — `DialogFrame`'s own `innerPaddingX`
      // (1 column either side) plus `Row`'s pointer glyph and its `gap={1}` (1 + 1) — so the label itself
      // never gets more than `columns` minus that fixed cost, exactly one row of it.
      const rootRowWidth = Math.max(10, columns - 4);
      return (
        <Box flexDirection="column">
          {above > 0 ? <Box paddingLeft={2}><Text dimColor>{moreAbove(above)}</Text></Box> : null}
          {listRows.slice(win.start, win.end).map((r, i) => {
            const at = win.start + i;
            if (r.kind === "heading") return <Text key={`h-${at}`} bold dimColor>{r.label}</Text>;
            return <Row key={r.server.name} focused={at === flatFocus} label={<ServerLabel server={r.server} width={rootRowWidth} />} />;
          })}
          {below > 0 ? <Box paddingLeft={2}><Text dimColor>{moreBelow(below)}</Text></Box> : null}
        </Box>
      );
    }

    if (!currentServer) return <Text dimColor>Server not found.</Text>;

    if (view.type === "server-menu") {
      const fields = serverMenuFields(currentServer);
      return (
        <Box flexDirection="column">
          <Text bold>{currentServer.name}</Text>
          <Box flexDirection="column" marginTop={1}>
            {fields.map((f) => (
              <Box key={f.label} flexDirection="row" gap={1}>
                <Text bold>{f.label}</Text><Text dimColor>{f.value}</Text>
              </Box>
            ))}
          </Box>
          {currentServer.tools.length > 0
            ? <Box marginTop={1}><Row focused label={<Text>{`Tools (${currentServer.tools.length})`}</Text>} /></Box>
            : null}
        </Box>
      );
    }

    if (view.type === "server-tools") {
      const tools = currentServer.tools;
      // bl10 fix wave 2, finding 5: this view's OWN budget, not the root list's — it pays two chrome rows
      // (the bold name line above, the `marginTop={1}` below) `mcpListVisibleRows` never charges for.
      const visible = mcpToolsVisibleRows(rows);
      const win = mcpWindow(tools.length, toolFocus, visible);
      const { above, below } = overflowRows(win, tools.length);
      // Same chrome the root list's `rootRowWidth` spends (`DialogFrame`'s paddingX + `Row`'s pointer+gap) —
      // this view's rows sit behind the identical `Row` primitive, so the identical budget applies.
      const toolRowWidth = Math.max(10, columns - 4);
      return (
        <Box flexDirection="column">
          <Text bold>{currentServer.name}</Text>
          <Box flexDirection="column" marginTop={1}>
            {tools.length === 0
              ? <Text dimColor>No tools.</Text>
              : <>
                  {above > 0 ? <Box paddingLeft={2}><Text dimColor>{moreAbove(above)}</Text></Box> : null}
                  {tools.slice(win.start, win.end).map((t, i) => {
                    const at = win.start + i;
                    return (
                      <Row key={t.name} focused={at === toolFocus}
                        label={<ToolLabel tool={t} width={toolRowWidth} />} />
                    );
                  })}
                  {below > 0 ? <Box paddingLeft={2}><Text dimColor>{moreBelow(below)}</Text></Box> : null}
                </>}
          </Box>
        </Box>
      );
    }

    // server-tool-detail
    const tool: McpToolInfo | undefined = currentServer.tools.find((t) => t.name === view.tool);
    if (!tool) return <Text dimColor>Tool not found.</Text>;
    const annotations = toolAnnotationLabels(tool);
    return (
      <Box flexDirection="column">
        <Text dimColor>{currentServer.name}</Text>
        <Text bold>{tool.name}</Text>
        {tool.description ? (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>Description:</Text>
            <Text>{tool.description}</Text>
          </Box>
        ) : null}
        {annotations.length > 0 ? (
          <Box flexDirection="row" gap={1} marginTop={1}>
            <Text bold>Annotations:</Text><Text dimColor>{annotations.join(", ")}</Text>
          </Box>
        ) : null}
      </Box>
    );
  })();

  // bl10 fix wave 1, finding 3: `Select`'s own table binds navigate/select unconditionally, but `count === 0`
  // means there is nothing to move a cursor onto or accept — the empty root list (no servers configured), a
  // server-menu with no tools (no "View tools" row), server-tools with an empty tool array, and the leaf
  // server-tool-detail view (which is never a list at all) all land here. Advertising "navigate"/"select" in
  // those states is exactly the no-op-hint defect: only `select:cancel`'s Esc-to-pop is ever live, named
  // directly rather than pulled from the whole scope.
  const mcpHintScope = count > 0 ? (["Select"] as const) : undefined;
  const mcpHintActions = count > 0 ? undefined : ([{ action: "select:cancel", scope: "Select" }] as const);
  return (
    <DialogFrame title={MCP_TITLE} subtitle={mcpSubtitle(serverCount)}
      {...(mcpHintScope ? { hintScope: mcpHintScope } : {})} {...(mcpHintActions ? { hintActions: mcpHintActions } : {})}>
      {body}
    </DialogFrame>
  );
}
