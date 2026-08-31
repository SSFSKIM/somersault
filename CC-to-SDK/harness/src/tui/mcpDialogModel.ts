// tui/mcpDialogModel.ts — pure model for the `/mcp` browser (T-MENU task 4): a typed normalization of
// `session.mcpServerStatus()` (spec D5 amended — there is NO flattened `mcp__<server>__` tool inventory,
// so every drill-down derives from the SDK's own per-server `tools` array, `sdk.d.ts:1141-1151`), the
// view-stack transitions canon's router draws (`list → server-menu → server-tools → server-tool-detail`,
// bundle chunk `j9x7bey3` L582270-582362 — the `agent-server-menu` branch is skipped, spec D5-bl10), and the
// root list's grouping. No React/session here — McpDialog.tsx is the only consumer, mirroring
// bgDialogModel.ts's own pure-model convention.
import { plural } from "./format.js";
import { windowBounds, type SelectWindow } from "./select/selectModel.js";

export interface McpToolAnnotations { readOnly?: boolean; destructive?: boolean; openWorld?: boolean }
export interface McpToolInfo { name: string; description?: string; annotations?: McpToolAnnotations }
export type McpStatus = "connected" | "failed" | "needs-auth" | "pending" | "disabled";
export interface McpServerRow {
  name: string;
  status: McpStatus;
  error?: string;
  /** `config.type` — `"stdio" | "sse" | "http" | "sdk" | "claudeai-proxy"` (sdk.d.ts:1109-1216). */
  type?: string;
  /** `config.url` (sse/http/claudeai-proxy). */
  url?: string;
  /** `config.command` (stdio). */
  command?: string;
  scope?: string;
  tools: McpToolInfo[];
}

const KNOWN_STATUSES: readonly McpStatus[] = ["connected", "failed", "needs-auth", "pending", "disabled"];

function normalizeTool(raw: unknown): McpToolInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Record<string, unknown>;
  if (typeof t.name !== "string" || t.name === "") return null;
  const tool: McpToolInfo = { name: t.name };
  if (typeof t.description === "string") tool.description = t.description;
  if (t.annotations && typeof t.annotations === "object") {
    const a = t.annotations as Record<string, unknown>;
    const annotations: McpToolAnnotations = {};
    if (typeof a.readOnly === "boolean") annotations.readOnly = a.readOnly;
    if (typeof a.destructive === "boolean") annotations.destructive = a.destructive;
    if (typeof a.openWorld === "boolean") annotations.openWorld = a.openWorld;
    if (Object.keys(annotations).length > 0) tool.annotations = annotations;
  }
  return tool;
}

/** `session.mcpServerStatus()`'s rows, normalized defensively — a malformed or absent field is OMITTED,
 *  never thrown (controller resolution: "absent/malformed fields normalize to omitted, never crash"). A
 *  row with no usable `name` is dropped entirely: there is nothing to key a drill-down on. An unrecognized
 *  `status` literal (the one REQUIRED field) falls back to `"failed"` — the safe reading for "we don't know
 *  what this connection is doing" — rather than widening the type or throwing. */
export function normalizeMcpServers(raw: unknown): McpServerRow[] {
  if (!Array.isArray(raw)) return [];
  const out: McpServerRow[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.name !== "string" || e.name === "") continue;
    const row: McpServerRow = {
      name: e.name,
      status: KNOWN_STATUSES.includes(e.status as McpStatus) ? (e.status as McpStatus) : "failed",
      tools: [],
    };
    if (typeof e.error === "string") row.error = e.error;
    if (typeof e.scope === "string") row.scope = e.scope;
    if (e.config && typeof e.config === "object") {
      const c = e.config as Record<string, unknown>;
      if (typeof c.type === "string") row.type = c.type;
      if (typeof c.url === "string") row.url = c.url;
      if (typeof c.command === "string") row.command = c.command;
    }
    if (Array.isArray(e.tools)) row.tools = e.tools.map(normalizeTool).filter((t): t is McpToolInfo => t !== null);
    out.push(row);
  }
  return out;
}

export const MCP_TITLE = "Manage MCP servers";
/** `${n} servers` / `${n} server` — canon's own subtitle shape (`${Vt} ${k(Vt,"server")}`, bundle L582001). */
export const mcpSubtitle = (count: number): string => `${count} ${plural(count, "server")}`;

// ---- Root list: grouping ----------------------------------------------------------------------------

export type McpListRow = { kind: "heading"; label: string } | { kind: "server"; server: McpServerRow };

/** Canon's scoped group order (`vo`, bundle L581775) minus `"agent"`/`"dynamic"` (D5-bl10 skips
 *  agent-server-menu and we carry no built-in-tool inventory to populate a "Built-in MCPs" group). `claude.ai`
 *  is keyed off `config.type === "claudeai-proxy"` the way canon's own list does (transport, not scope —
 *  `Ve = y.server.transport === "claudeai-proxy" ? "claude.ai" : …`, L582295), not off a `"claudeai"` scope
 *  string, so a claude.ai connector groups correctly regardless of what its `scope` field happens to say. */
const GROUP_ORDER = ["project", "local", "user", "enterprise", "claudeai"] as const;
const GROUP_LABELS: Readonly<Record<string, string>> = {
  project: "Project MCPs", local: "Local MCPs", user: "User MCPs", enterprise: "Enterprise MCPs", claudeai: "claude.ai",
};

/** A server whose `scope` this table does not recognize (or has none at all) groups under "Other MCPs"
 *  rather than being silently dropped — every server the caller hands in appears in the list. `"managed"`
 *  folds into `"enterprise"` (both read as admin-controlled in canon's own duplicate-of-scope messaging,
 *  bundle L581835-581845) rather than opening a second identically-labelled heading. */
function groupKey(row: McpServerRow): string {
  if (row.type === "claudeai-proxy") return "claudeai";
  if (row.scope === "managed") return "enterprise";
  if (row.scope && GROUP_LABELS[row.scope]) return row.scope;
  return "other";
}

/** Grouped, alphabetized-within-group (canon `cn`, L581862-581873) root-list rows — headings only for a
 *  group that actually has a member (task-4 brief). */
export function buildListRows(servers: readonly McpServerRow[]): McpListRow[] {
  const groups = new Map<string, McpServerRow[]>();
  for (const s of servers) {
    const key = groupKey(s);
    const list = groups.get(key);
    if (list) list.push(s); else groups.set(key, [s]);
  }
  const rows: McpListRow[] = [];
  for (const key of [...GROUP_ORDER, "other"]) {
    const members = groups.get(key);
    if (!members || members.length === 0) continue;
    members.sort((a, b) => a.name.localeCompare(b.name));
    rows.push({ kind: "heading", label: key === "other" ? "Other MCPs" : GROUP_LABELS[key]! });
    for (const m of members) rows.push({ kind: "server", server: m });
  }
  return rows;
}

/** The flat indices of every `"server"` row, in display order — headings are never a landing spot for the
 *  keyboard cursor. */
export function serverIndices(rows: readonly McpListRow[]): number[] {
  const out: number[] = [];
  rows.forEach((r, i) => { if (r.kind === "server") out.push(i); });
  return out;
}

/** The flat index of the Nth server row (0-based among servers only), or -1 when `pos` is out of range —
 *  the bridge between a plain "which server is focused" cursor and the combined heading+server array a
 *  window is computed over. */
export function flatIndexOfServer(rows: readonly McpListRow[], pos: number): number {
  return serverIndices(rows)[pos] ?? -1;
}

// ---- Windowing (shared machinery, MCP's own chrome budget) ------------------------------------------

/** Rows this dialog's own frame/subtitle/footer spend, leaving the rest to the list — the same shape as
 *  `settingsVisibleRows`/`permissionsVisibleRows`'s own chrome constants. */
export const MCP_LIST_CHROME_ROWS = 8;
export const mcpListVisibleRows = (rows: number): number => Math.max(1, Math.floor((rows - MCP_LIST_CHROME_ROWS) / 1));

/** The window over `count` rows that keeps `focus` visible — a thin re-export point so the dialog and its
 *  tests share one import rather than reaching into `select/selectModel.js` a second time. */
export const mcpWindow = (count: number, focus: number, visible: number): SelectWindow => windowBounds(count, focus, visible);

// ---- View stack --------------------------------------------------------------------------------------

export type McpView =
  | { type: "list" }
  | { type: "server-menu"; server: string }
  | { type: "server-tools"; server: string }
  | { type: "server-tool-detail"; server: string; tool: string };

export const MCP_ROOT_VIEW: McpView = { type: "list" };

/** Canon's router (`ve({type:…})` calls, bundle L582270-582362), minus the `agent-server-menu` branch. */
export const enterServerMenu = (server: string): McpView => ({ type: "server-menu", server });
export const enterServerTools = (server: string): McpView => ({ type: "server-tools", server });
export const enterToolDetail = (server: string, tool: string): McpView => ({ type: "server-tool-detail", server, tool });

/** Esc pops exactly one level; `null` means "close the dialog" (A2/D5-bl10 — the root view's own Esc). */
export function popMcpView(view: McpView): McpView | null {
  switch (view.type) {
    case "list": return null;
    case "server-menu": return MCP_ROOT_VIEW;
    case "server-tools": return { type: "server-menu", server: view.server };
    case "server-tool-detail": return { type: "server-tools", server: view.server };
  }
}

export const findServer = (servers: readonly McpServerRow[], name: string): McpServerRow | undefined =>
  servers.find((s) => s.name === name);
export const findTool = (server: McpServerRow, name: string): McpToolInfo | undefined =>
  server.tools.find((t) => t.name === name);

// ---- Server-menu field block -------------------------------------------------------------------------

export interface McpFieldRow { label: string; value: string }

export function statusText(row: McpServerRow): string {
  switch (row.status) {
    case "connected": return "connected";
    case "pending": return "connecting…";
    case "needs-auth": return "needs authentication";
    case "disabled": return "disabled";
    case "failed": return row.error ? `failed: ${row.error}` : "failed";
  }
}

/** Type:/URL:/Command:/Status: — fields the row carries, absent ones omitted (task-4 brief). Status always
 *  renders; it is the one field every row has. */
export function serverMenuFields(row: McpServerRow): McpFieldRow[] {
  const fields: McpFieldRow[] = [];
  if (row.type) fields.push({ label: "Type:", value: row.type });
  if (row.url) fields.push({ label: "URL:", value: row.url });
  if (row.command) fields.push({ label: "Command:", value: row.command });
  fields.push({ label: "Status:", value: statusText(row) });
  return fields;
}

/** The true annotation flags, in canon's own display order (`HUe`'s row builder, bundle L278070+). Empty
 *  when the tool carries no annotations, or none of them are true. */
export function toolAnnotationLabels(tool: McpToolInfo): string[] {
  const a = tool.annotations;
  if (!a) return [];
  const out: string[] = [];
  if (a.readOnly) out.push("read-only");
  if (a.destructive) out.push("destructive");
  if (a.openWorld) out.push("open-world");
  return out;
}
