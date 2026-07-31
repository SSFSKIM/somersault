// tui/src/useChat.ts — owns the session (event-driven, Goal B task 7): the host event stream is the
// SINGLE rendering source (turn/message/decision/tasks_changed/task/state events all arrive via
// ChatSession & SessionEvents & DecisionFeed & BgTasks), `submit`/`resolveDecision` are command channels
// only. Owns the transcript, the streaming turn, the decision queue, mode switching (Tab ladder + host
// truth via state events), the bg-task panel, and idempotent teardown.
import { useEffect, useRef, useState } from "react";
import { writeFileSync as realWriteFileSync, readFileSync as realReadFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import type { ChatSession } from "../session/chatSession.js";
import { hasDecisionFeed, hasBgTasks, hasSessionEvents, hasRewind, hasSettingsOps } from "../session/chatSession.js";
import type { RewindAnchor, RewindScope, RewindDryRun } from "../session/chatSession.js";
import { validateAddDir, formatAddDirVerdict, formatAddDirResult, type AddDirVerdict } from "./addDir.js";
import { mergeSettingsFile, appendToArray, type SettingsFileDeps, type SettingsTarget } from "./settingsFile.js";
import { appendDenial, removeFromArray, type DenialEntry } from "./permissionsModel.js";
import type { CcxPrefs } from "./prefs.js";
import { savePrefs as realSavePrefs } from "./prefs.js";
import { currentTheme, setTheme, type ThemeId } from "./theme.js";
import { buildRows, summarizeChanges, PERMISSION_MODE_OPTIONS, type SettingsRowCtx } from "./settingsRows.js";
import { OUTPUT_STYLE_REDIRECT } from "./OutputStylePicker.js";
import type { PendingDecision } from "../permissions/pending.js";
import type { DecisionOutcome } from "../permissions/types.js";
import type { BackgroundTaskInfo } from "../session/session.js";
import type { RenderLine } from "./render.js";
import { LiveTurn } from "./liveTurn.js";
import { TaskList, type TaskItem } from "./taskList.js";
import { BgMetaHarvest, type BgTaskRow } from "./bgTaskMeta.js";
import { parseCommand, formatHelp, formatModel, formatThink, formatCompact, formatContext, formatCost, formatStatus, formatUnknown, parseMcpArgs, formatMcpStatus, formatMcpUsage, pickMostRecent, LOCAL_COMMAND_ENTRIES, LOCAL_NAMES, CLIENT_SIDE_NOTES, formatClientSide, parseConfigArg, type ParsedCommand, type InitialResume, type SessionUsage } from "./commands.js";
import { formatUsage, usageWarning, usageSummaryLine } from "./usageFormat.js";
import { mergeCommands, toCatalogEntry, type CommandEntry } from "./commandComplete.js";
import { parseThinkArg } from "./thinkLevels.js";
import { exportMarkdown, defaultExportName, filesInContext, formatFiles, formatStats, formatSessionInfo, EXPORT_HEADER } from "./sessionTools.js";
import { lastAssistantText } from "../sessions/rows.js";
import type { ModelInfo } from "./ModelPicker.js";
import { replayLines } from "./replay.js";
import { runBash as realRunBash, formatBashOutput, type BashResult } from "./bash.js";
import { copyToClipboard as realCopyToClipboard } from "./copy.js";
import { appendMemory as realAppendMemory } from "./memory.js";
import { shortCwd } from "./banner.js";
import { summarizeUsage, listSessions as realListSessions, getSessionMessages as realGetSessionMessages, resolveAutoModel, resolveModelAlias, renameSession as realRenameSession, tagSession as realTagSession, getSessionInfo as realGetSessionInfo } from "../index.js";
import type { RawContextUsage } from "../index.js";
import { promptEntries, mergeEntries, type HistEntry, type HistoryScope } from "./historySearch.js";

// ChatSession is promoted to ../session/chatSession.ts (spec A2b §2) so the lib Session and the remote
// adapter satisfy ONE interface; re-exported here so this package's other modules' imports keep working.
export type { ChatSession };
export interface SessionInfo { sessionId: string; summary: string; firstPrompt?: string; lastModified: number }
export interface ChatState { lines: RenderLine[]; streaming: RenderLine[]; pending: PendingDecision | null; mode: string; busy: boolean; ctxPct?: number; model?: string; picker: { open: boolean; sessions: SessionInfo[] }; tasks: TaskItem[]; bgTasks: BackgroundTaskInfo[]; bgRows: BgTaskRow[]; bgPanelOpen: boolean; thinkLevel: string; turnStartedAt: number; modelPicker: { open: boolean; models: ModelInfo[] }; commandCatalog: CommandEntry[]; queue: string[]; clearToken: number; turnTokens: number; rewindPicker: { open: boolean; anchors: RewindAnchor[] }; composerPrefill: { text: string; token: number } | null; rewinding: boolean; usageWarn?: string; shortcutsOpen: boolean; historyOpen: boolean; addDir: { open: boolean; prefill?: string }; themeDialog: { open: boolean }; settings: { open: boolean; tab?: string }; outputStyle: string; permissions: { open: boolean; tab?: string }; denials: DenialEntry[]; }

// Tab cycles these; bypassPermissions stays off-cycle (/yolo). Single source with settingsRows.ts's own
// permissionMode row (review finding 3) — importing it here instead of a second literal array means the
// Tab ladder and the /config cycle order can never independently drift.
const LADDER = PERMISSION_MODE_OPTIONS;
/** Next mode on the Tab ladder; any off-ladder mode (e.g. bypassPermissions/dontAsk) re-enters at "default". */
function ladderNext(mode: string): string { const i = LADDER.indexOf(mode); return i >= 0 ? LADDER[(i + 1) % LADDER.length] : "default"; }

export function useChat(
  makeSession: (resume?: string) => ChatSession,
  opts: { initialMode?: string; initialModel?: string; cwd?: string; initialResume?: InitialResume; initialThink?: string; initialOutputStyle?: string; initialLines?: RenderLine[]; initialPrompt?: string; onExit?: () => void } = {},
  deps: { listSessions?: () => Promise<SessionInfo[]>; getSessionMessages?: (id: string) => Promise<any[]>; getSessionMessagesIn?: (id: string, cwd?: string) => Promise<any[]>; runBash?: (cmd: string, cwd: string) => Promise<BashResult>; appendMemory?: (note: string, cwd: string) => string; clearScreen?: () => void; copyText?: (t: string) => Promise<void>; writeFile?: (path: string, text: string) => void; readFile?: (path: string) => string | null; renameSession?: (id: string, title: string) => Promise<void>; tagSession?: (id: string, tag: string | null) => Promise<void>; getSessionInfo?: (id: string) => Promise<any>; listHistorySessions?: (cwd?: string) => Promise<SessionInfo[]>; settingsFileDeps?: SettingsFileDeps; savePrefs?: (patch: Partial<CcxPrefs>, env?: NodeJS.ProcessEnv) => void } = {},
) {
  const [session, setSession] = useState<ChatSession>(() => makeSession());
  // Seed the scrollback with the welcome banner — unless we're launching straight into a resume (the
  // replay fills `lines` and a banner would be misleading above a rejoined transcript).
  const [lines, setLines] = useState<RenderLine[]>(() => (opts.initialResume ? [] : opts.initialLines ?? []));
  const [streaming, setStreaming] = useState<RenderLine[]>([]);
  const [pending, setPending] = useState<PendingDecision | null>(null);
  const pendingRef = useRef<PendingDecision | null>(null); pendingRef.current = pending;
  const [pendingQueue, setPendingQueue] = useState<PendingDecision[]>([]);
  const pendingQueueRef = useRef<PendingDecision[]>([]); pendingQueueRef.current = pendingQueue;
  const answeredIds = useRef<Set<string>>(new Set());     // toolUseIDs THIS client answered — dropPending consults it, not the wire's `by` label
  const liveTurnRef = useRef<LiveTurn | null>(null);       // the in-flight turn's renderer (event-driven)
  const [mode, setMode] = useState(opts.initialMode ?? "default");
  const modeRef = useRef(mode); modeRef.current = mode;    // read inside the event effect without re-subscribing on every mode change
  const [busy, setBusy] = useState(false);
  const [turnStartedAt, setTurnStartedAt] = useState(0);
  const [ctxPct, setCtxPct] = useState<number | undefined>(undefined);
  const [usageWarn, setUsageWarn] = useState<string | undefined>(undefined);
  // Seeded from the launch config, NOT left undefined until the first turn ends: the Tab ladder's `auto`
  // rung consults this to decide whether the live model supports auto, and an unknown model there used to
  // resolve to the DEFAULT and silently downgrade a `--model opus` session to sonnet before the user had
  // typed anything. Stays undefined for `ccx attach` (that client never saw the host's launch config).
  const [model, setModel] = useState<string | undefined>(opts.initialModel);
  const [thinkLevel, setThinkLevel] = useState(opts.initialThink ?? "default");
  const [picker, setPicker] = useState<{ open: boolean; sessions: SessionInfo[] }>({ open: false, sessions: [] });
  const [modelPicker, setModelPicker] = useState<{ open: boolean; models: ModelInfo[] }>({ open: false, models: [] });
  const [rewindPicker, setRewindPicker] = useState<{ open: boolean; anchors: RewindAnchor[] }>({ open: false, anchors: [] });
  const [composerPrefill, setComposerPrefill] = useState<{ text: string; token: number } | null>(null);
  const [rewinding, setRewinding] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);   // the `?` help overlay (pure display)
  const [historyOpen, setHistoryOpen] = useState(false);       // the Ctrl-R history-search overlay
  const [addDir, setAddDir] = useState<{ open: boolean; prefill?: string }>({ open: false });   // W3 T3: /add-dir overlay
  const [themeDialog, setThemeDialog] = useState<{ open: boolean }>({ open: false });   // W3 T4: /theme overlay
  const [settings, setSettings] = useState<{ open: boolean; tab?: string }>({ open: false });   // W3 T5: /config overlay
  // Baseline SettingsRowCtx captured the moment /config opens, diffed against a fresh snapshot when it
  // closes (closeSettings). A ref, not a local ref inside SettingsDialog: the Model row reuses the
  // EXISTING top-level modelPicker overlay (chain order, ChatApp.tsx), which UNMOUNTS SettingsDialog while
  // it's up — anything the dialog itself tried to remember incrementally would be lost on that round-trip.
  const settingsBaselineRef = useRef<SettingsRowCtx | null>(null);
  const [outputStyle, setOutputStyleState] = useState<string>(opts.initialOutputStyle ?? "default");   // W3 T5: seeded from loadPrefs() by the caller (chatMain.tsx), like theme
  const [permissions, setPermissions] = useState<{ open: boolean; tab?: string }>({ open: false });   // W3 T7: /permissions overlay
  const [denials, setDenials] = useState<DenialEntry[]>([]);   // recent-denials ledger — dropPending appends via appendDenial (pure, permissionsModel.ts)
  // (behavior:rule) → the settings-file target addPermRule ALSO persisted it to (every add-rule choice
  // writes BOTH the flag layer and one of the three files — the destination picker has no "session only"
  // option), so a later removePermRule of the SAME rule knows which single file to strip it from too,
  // never a blind sweep of files we don't know contain it.
  const ruleFileTargets = useRef<Map<string, SettingsTarget>>(new Map());
  const [commandCatalog, setCommandCatalog] = useState<CommandEntry[]>(LOCAL_COMMAND_ENTRIES);   // local-only until the live fetch resolves
  const catalogNames = useRef<Set<string>>(new Set());                                            // catalog (non-local) names → routed to submit-as-prompt
  const taskListRef = useRef(new TaskList());
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [bgTasks, setBgTasks] = useState<BackgroundTaskInfo[]>([]);
  const bgTasksRef = useRef<typeof bgTasks>([]); bgTasksRef.current = bgTasks;
  const bgHarvest = useRef(new BgMetaHarvest());
  const killArmAt = useRef(0);
  const [bgPanelOpen, setBgPanelOpen] = useState(false);
  const [turnTokens, setTurnTokens] = useState(0);    // live output-token count for the in-flight turn (spinner)
  const [queue, setQueue] = useState<string[]>([]);   // prompts/turns submitted while busy; drained FIFO on turn end
  const queueRef = useRef<string[]>([]); queueRef.current = queue;
  const drainGen = useRef(0);                          // bumped by interrupt → invalidates any scheduled drain (no post-interrupt dispatch)
  const [clearToken, setClearToken] = useState(0);    // bumped on clear → remounts the append-only <Static> so it truly empties
  const disposed = useRef(false);
  const listSessions = deps.listSessions ?? (() => realListSessions({ cwd: opts.cwd, limit: 30 }) as Promise<SessionInfo[]>);
  const getSessionMessages = deps.getSessionMessages ?? ((id: string) => realGetSessionMessages(id, { cwd: opts.cwd }) as Promise<any[]>);
  // Scope-aware reader for loadHistory's project/everywhere passes (F1, final review): getSessionMessages
  // above always pins `opts.cwd`, so a session from a DIFFERENT project (everywhere scope) reads back 0
  // messages under it — an undefined cwd is what makes the SDK reader search across all projects.
  const getSessionMessagesIn = deps.getSessionMessagesIn ?? ((id: string, c?: string) => realGetSessionMessages(id, c ? { cwd: c } : {}) as Promise<any[]>);
  const runBash = deps.runBash ?? realRunBash;
  const savePrefsFn = deps.savePrefs ?? realSavePrefs;   // W3 T5: applyOutputStyle is useChat's first ACTUAL reader of this dep (Task 4 only threaded it through to ThemeDialog)
  const appendMemory = deps.appendMemory ?? realAppendMemory;
  const copyText = deps.copyText ?? realCopyToClipboard;
  const writeFile = deps.writeFile ?? ((p: string, t: string) => realWriteFileSync(p, t));
  // null means "nothing there, safe to create". ENOENT is the ONLY error that earns it: a target we
  // cannot read (a directory, EACCES, a binary blob) comes back as "" so the header check below fails
  // and /export refuses — we could not prove the file is ours, so we must not truncate it.
  const readFile = deps.readFile ?? ((p: string) => {
    try { return realReadFileSync(p, "utf8"); }
    catch (e) { return (e as NodeJS.ErrnoException).code === "ENOENT" ? null : ""; }
  });
  const renameSessionFn = deps.renameSession ?? ((id: string, t: string) => realRenameSession(id, t, { cwd: opts.cwd }));
  const tagSessionFn = deps.tagSession ?? ((id: string, t: string | null) => realTagSession(id, t, { cwd: opts.cwd }));
  const getSessionInfoFn = deps.getSessionInfo ?? ((id: string) => realGetSessionInfo(id, { cwd: opts.cwd }));
  const listHistorySessions = deps.listHistorySessions ?? ((c?: string) => realListSessions({ ...(c ? { cwd: c } : {}), limit: 15 }) as Promise<SessionInfo[]>);
  const lastAssistant = useRef("");    // the last assistant reply's text, for /copy
  // Real terminal clear: wipe screen + scrollback + home cursor (Static is append-only — a model reset alone
  // can't erase already-printed lines, so we also clear the terminal, exactly like CC's /clear).
  const clearScreen = deps.clearScreen ?? (() => { try { if (process.stdout.isTTY) process.stdout.write("\x1b[2J\x1b[3J\x1b[H"); } catch { /* no tty */ } });
  const cwd = opts.cwd ?? process.cwd();
  const ranInitial = useRef(false);
  const ranInitialPrompt = useRef(false);

  // Unmount-only sentinel: mark disposed. A parked remote permission is NOT resolved here — detach ≠
  // deny (spec A2b §5): the entry stays parked on the host for another client (or the same one, re-attached)
  // to answer. Never on a session swap.
  useEffect(() => () => { disposed.current = true; }, []);
  // Dispose the PREVIOUS session whenever it changes (a /resume swap) and on unmount. Must not touch `disposed`.
  useEffect(() => () => { void session.dispose().catch(() => {}); }, [session]);
  // The host event stream is the SINGLE rendering source (spec A2b §2+§5, acceptance 7): a turn started by
  // another attached client renders exactly like one started here. Keyed on session identity.
  useEffect(() => {
    if (!hasSessionEvents(session)) return;
    const off = session.onSessionEvent((ev) => {
      if (disposed.current) return;
      if (ev.kind === "turn" && ev.phase === "start") { liveTurnRef.current = new LiveTurn(); setBusy(true); setTurnStartedAt(Date.now()); setTurnTokens(0); setStreaming([]); }
      else if (ev.kind === "message") {
        // Harvest bg-task metadata (command/output-file) BEFORE the no-live-turn guard: reconnect-buffer
        // replays carry no live turn but still need to reach the (idempotent) harvest.
        bgHarvest.current.ingestMessage(ev.data);
        // Same no-live-turn guard as everything else in this arm (F5/GHOST): a message with no owning
        // turn is a disk/buffer replay dup, not something the user is watching — so /copy must not
        // capture text from it either, or it could copy a reply that was never actually rendered.
        const l = liveTurnRef.current; if (!l) return;
        const data = ev.data as any;
        if (data?.type === "assistant") {
          const t = (data.message?.content ?? []).filter((b: any) => b?.type === "text").map((b: any) => b.text).join("\n");
          if (t.trim()) lastAssistant.current = t;
        } else if (data?.type === "system" && data.subtype === "compact_boundary") notice("─── context compacted ───");
        l.ingest(ev.data); taskListRef.current.ingest(ev.data); setStreaming(l.snapshot()); setTasks(taskListRef.current.snapshot()); setTurnTokens(l.outputTokens);
      }
      else if (ev.kind === "turn" && ev.phase === "end") {
        const l = liveTurnRef.current; liveTurnRef.current = null;
        if (l) { if (ev.error) l.fail(ev.error); setLines((x) => [...x, ...l.finalize()]); if (l.model) setModel(l.model); }
        // No live turn to fail INTO (an idle host died, or its synthetic close arrived with nothing
        // rendering) but the frame still carries an error: without this, an idle host's death is
        // invisible until the next submit times out ~10s later (F5).
        else if (ev.error) notice(`✗ connection lost: ${ev.error}`);
        setStreaming([]); setBusy(false); void refreshCtx(); void refreshUsage(); drainNext();
      }
      else if (ev.kind === "tasks_changed") setBgTasks(ev.tasks);
      else if (ev.kind === "task") {
        bgHarvest.current.ingestTask(ev.data);
        const t = ev.data as any;
        const sub = t?.type === "system" ? t.subtype : t?.type;
        if (!t?.skip_transcript) {
          if (sub === "task_started") notice(`⚙ task started: ${t.description ?? t.task_id}`);
          else if (sub === "task_notification") notice(t.status === "failed" ? `✗ task failed: ${t.summary ?? t.task_id}` : `${t.status === "stopped" ? "◼ task stopped" : "✓ task done"}: ${t.summary ?? t.task_id}`);
        }
      }
      else if (ev.kind === "rewound") void rebuildAfterRewind();   // ANOTHER client rewound: rebuild from disk (no prefill — not our prompt)
      else if (ev.kind === "state" && ev.status.permissionMode && ev.status.permissionMode !== modeRef.current) setMode(ev.status.permissionMode);
    });
    const offDecision = hasDecisionFeed(session) ? session.onDecision((entry) => { if (!disposed.current) pushPending(entry); }) : undefined;
    const offSettled = hasDecisionFeed(session) ? session.onDecisionSettled((s) => { if (!disposed.current) dropPending(s.toolUseID, s.by, s.decision); }) : undefined;
    return () => { off(); offDecision?.(); offSettled?.(); };
  }, [session]);
  // Launch-time resume: run once on mount if an initialResume intent was passed.
  useEffect(() => {
    if (ranInitial.current || !opts.initialResume) return; ranInitial.current = true;
    if (opts.initialResume.kind === "id") void resumeInto(opts.initialResume.id);
    else void doContinue();
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  // Launch-time prompt: submit once on mount if an initialPrompt was passed (mutually exclusive with
  // initialResume at the call site).
  useEffect(() => {
    if (ranInitialPrompt.current || !opts.initialPrompt) return; ranInitialPrompt.current = true;
    submit(opts.initialPrompt);
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  // Fetch the live command catalog once per session (capabilities() works pre-turn — probe 29). On a /resume
  // swap the session changes → re-fetch. A failure/empty leaves the local-only palette (still fully usable).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const caps = await session.capabilities();
        if (cancelled || disposed.current) return;
        const catalog = (caps.commands as unknown[]).map(toCatalogEntry).filter((e): e is CommandEntry => !!e);
        catalogNames.current = new Set(catalog.map((c) => c.name));
        setCommandCatalog(mergeCommands(LOCAL_COMMAND_ENTRIES, catalog));
      } catch { /* keep the local-only catalog */ }
    })();
    return () => { cancelled = true; };
  }, [session]);

  async function refreshCtx() {
    try {
      const u = (await session.getContextUsage()) as { totalTokens?: number; maxTokens?: number };
      if (!disposed.current && u?.maxTokens) setCtxPct(Math.round(((u.totalTokens ?? 0) / u.maxTokens) * 100));
    } catch { /* best-effort */ }
  }
  // Fire-and-forget at turn-end only — never poll (spec's no-polling rule). Drives the status-bar warning;
  // /status and /usage fetch usage() directly themselves and don't route through this.
  async function refreshUsage() {
    try { const u = await session.usage(); if (!disposed.current) setUsageWarn(usageWarning(u)); return u; }
    catch { return undefined; }
  }

  function append(ls: RenderLine[]) { if (!disposed.current && ls.length) setLines((l) => [...l, ...ls]); }
  function notice(text: string) { append([{ text, dim: true }]); }
  /** /export, /files and /stats all read the PERSISTED transcript, which the SDK does not write mid-turn
   *  (probes 62-64). Local commands dispatch immediately even while busy, so running one during a turn
   *  answers from the last COMPLETED turn — an export that ends before the reply on screen, a token count
   *  that omits it. Nothing else on screen says so, so this does. */
  function staleTurnNote() { if (liveTurnRef.current) notice("  (the in-flight turn isn't included — the transcript is written at turn end)"); }

  // Decision FIFO: the dialog shows the head; extras queue behind it. `pushPending`/`dropPending` are
  // driven by the DecisionFeed subscription above — never optimistically from resolveDecision.
  function pushPending(entry: PendingDecision) {
    if (pendingRef.current === null) setPending(entry);
    else setPendingQueue((q) => [...q, entry]);
  }
  function dropPending(toolUseID: string, by: string, decision: string) {
    const wasMine = answeredIds.current.has(toolUseID);
    answeredIds.current.delete(toolUseID);
    // W3 T7: the recent-denials ledger. The settling entry may be the HEAD (pendingRef) or still only
    // QUEUED (pendingQueueRef) — either way its toolName/input is needed for the ledger's display string,
    // so look it up before either branch below drops it from state. appendDenial itself is the no-op gate
    // (non-deny decisions return the same array reference, so this setDenials call is a harmless no-op).
    const entry = pendingRef.current?.toolUseID === toolUseID ? pendingRef.current : pendingQueueRef.current.find((e) => e.toolUseID === toolUseID);
    if (entry) setDenials((d) => appendDenial(d, decision, entry.toolName, entry.input, by, Date.now()));
    if (pendingRef.current?.toolUseID === toolUseID) {
      if (!wasMine) {
        const verb = decision === "deny" ? "denied" : decision === "question_answer" ? "answered" : decision === "plan_approve" ? "approved" : decision === "plan_reject" ? "sent back" : "allowed";
        notice(`↳ ${pendingRef.current.toolName} ${verb} by ${by}`);
      }
      const q = pendingQueueRef.current;
      setPending(q[0] ?? null);
      setPendingQueue(q.slice(1));
    } else {
      setPendingQueue((q) => q.filter((e) => e.toolUseID !== toolUseID));   // settled while only queued (never shown)
    }
  }

  async function handleCommand(cmd: ParsedCommand) {
    setLines((l) => [...l, { text: `› /${cmd.name}${cmd.args ? " " + cmd.args : ""}`, dim: true }]);
    try {
      switch (cmd.name) {
        case "model":
          // `/model opus` must reach the engine as an id: the SDK's own `opus` alias still means Opus 4.8 (probe 72).
          if (cmd.args) { const m = resolveModelAlias(cmd.args)!; await session.setModel(m); if (!disposed.current) setModel(m); append(formatModel(m)); }
          else { await openModelPicker(); }
          break;
        case "compact": append(formatCompact(await session.compact())); break;
        case "context": append(formatContext(summarizeUsage((await session.getContextUsage()) as RawContextUsage))); break;
        case "cost": append(formatCost((await session.usage()) as SessionUsage)); break;
        case "status": {
          const u = await session.usage().catch(() => undefined);
          append(formatStatus({ model, mode, thinkLevel, ctxPct, sessionId: session.sessionId, cwd: opts.cwd, usage: u ? usageSummaryLine(u) : undefined }));
          break;
        }
        case "usage": append(formatUsage(await session.usage())); break;
        case "clear": clear(); break;
        case "help": append(formatHelp()); break;
        case "resume": void openPicker(); break;
        case "continue": void doContinue(); break;
        case "yolo": void applyMode("bypassPermissions"); break;
        case "think":
          if (cmd.args) {
            const parsed = parseThinkArg(cmd.args);
            if (!parsed) { append([{ text: `thinking: unknown level "${cmd.args}" · try off/low/medium/high/xhigh/max or a number`, color: "red" }]); break; }
            await session.setMaxThinkingTokens(parsed.budget);
            if (!disposed.current) setThinkLevel(parsed.level);
            append(formatThink(parsed.level));
          } else append(formatThink(undefined, thinkLevel));
          break;
        case "mcp": {
          const action = parseMcpArgs(cmd.args);
          if (!action) { append(formatMcpUsage()); break; }
          if (action.kind === "status") append(formatMcpStatus(await session.mcpServerStatus()));
          else if (action.kind === "reconnect") { await session.reconnectMcpServer(action.name); append([{ text: `mcp: reconnected ${action.name}` }]); }
          else { await session.toggleMcpServer(action.name, action.enabled); append([{ text: `mcp: ${action.name} → ${action.enabled ? "enabled" : "disabled (advisory — a tool call can revive it)"}` }]); }
          break;
        }
        case "bg": openBgPanel(); break;
        case "rewind": void openRewind(); break;
        case "copy": { const t = lastAssistant.current; if (!t) { notice("nothing to copy"); break; } await copyText(t); notice(`✓ copied ${t.length} chars`); break; }
        case "export": {
          const id = session.sessionId;
          if (!id) { notice("no conversation to export yet"); break; }
          const msgs = await getSessionMessages(id).catch(() => [] as any[]);
          if (!msgs.length) { notice("no conversation to export yet"); break; }
          const md = exportMarkdown(msgs, { id });
          if (cmd.args === "clipboard") { await copyText(md); notice(`✓ copied ${md.length} chars of markdown`); staleTurnNote(); break; }
          // resolve, not join: `join(cwd, "/tmp/x.md")` silently yields "<cwd>/tmp/x.md" and then reports
          // that surprising path as success. resolve() honors an absolute path as typed.
          const path = resolvePath(cwd, cmd.args || defaultExportName(id));
          // writeFile TRUNCATES. `/export package.json` would destroy it with no prompt, so overwrite only
          // a file we can prove is a previous export of ours; anything else is the user's to lose, not ours.
          const existing = readFile(path);
          if (existing !== null && !existing.startsWith(EXPORT_HEADER)) { append([{ text: `✗ refusing to overwrite ${path} — not a previous ccx export`, color: "red" }]); break; }
          writeFile(path, md);
          notice(`✓ exported to ${path}`);
          staleTurnNote();
          break;
        }
        case "files": {
          const id = session.sessionId;
          const msgs = id ? await getSessionMessages(id).catch(() => [] as any[]) : [];
          append(formatFiles(filesInContext(msgs)));
          staleTurnNote();
          break;
        }
        // Terminal stand-in for CC's diff dialog: status for the shape, stat for the sizes.
        case "diff": append(formatBashOutput(await runBash("git status --short; git diff --stat", cwd))); break;
        case "stats": {
          const u = (await session.usage().catch(() => ({}))) as SessionUsage;
          const msgs = session.sessionId ? await getSessionMessages(session.sessionId).catch(() => [] as any[]) : [];
          append(formatStats(u, msgs));
          staleTurnNote();
          break;
        }
        case "session": {
          const id = session.sessionId;
          if (!id) { notice("no session yet — send a first prompt"); break; }
          append(formatSessionInfo({ id, cwd: opts.cwd, info: await getSessionInfoFn(id).catch(() => undefined) }));
          break;
        }
        case "rename": {
          const id = session.sessionId;
          if (!id) { notice("no session yet — send a first prompt"); break; }
          if (!cmd.args) { const i = await getSessionInfoFn(id).catch(() => undefined); notice(`title: ${(i as any)?.customTitle ?? "(auto)"} — /rename <new title> to change`); break; }
          await renameSessionFn(id, cmd.args);
          notice(`✓ renamed to "${cmd.args}"`);
          break;
        }
        case "tag": {
          const id = session.sessionId;
          if (!id) { notice("no session yet — send a first prompt"); break; }
          const i = (await getSessionInfoFn(id).catch(() => undefined)) as { tag?: string } | undefined;
          if (!cmd.args) { notice(i?.tag ? `tag: #${i.tag} — /tag ${i.tag} to clear` : "no tag — /tag <name> to set"); break; }
          const next = i?.tag === cmd.args ? null : cmd.args;   // CC semantics: toggling the same tag clears it
          await tagSessionFn(id, next);
          notice(next ? `✓ tagged #${next}` : "✓ tag cleared");
          break;
        }
        // /add-dir: no arg → entry phase (the dialog itself prompts + validates via addDirValidate below).
        // With an arg, validate NOW against cwd + the live additional-dir list: invalid → print the
        // verdict's message (the generic echo above already showed the attempt); valid → skip straight to
        // the confirm phase, pre-filled with the resolved path (no re-typing what was already typed once).
        case "add-dir": {
          if (!hasSettingsOps(session)) { notice("add-dir unsupported on this session"); break; }
          if (!cmd.args) { setAddDir({ open: true }); break; }
          const v = await addDirValidate(cmd.args);
          if (v.kind === "ok") setAddDir({ open: true, prefill: v.abs });
          else append(formatAddDirVerdict(v));
          break;
        }
        // /theme: a pure client feature (no engine round-trip) — the dialog owns setTheme/savePrefs itself
        // (theme.ts's setTheme has "no persistence — caller's job", and the dialog IS that caller); this
        // just opens/closes it and prints whatever result line it hands back via closeThemeDialog.
        case "theme": setThemeDialog({ open: true }); break;
        // /config [key=value] (W3 T6): bare → open the Settings shell at Config (openSettings always seeds
        // tab:"Config"). With a key=value arg, parseConfigArg validates it against the SAME row model
        // SettingsDialog renders (buildRows(currentSettingsCtx()) — never a second copy of the row/
        // permission-mode/theme-id lists) and returns either an error to print or a validated {id,value} to
        // apply. parseConfigArg only decided WHAT to set, never HOW — that's this switch, so a rejected
        // parse can never partially mutate state. /settings is upstream's literal alias (Task 6 brief),
        // sharing this exact case body including its own args.
        case "settings":
        case "config": {
          const result = parseConfigArg(cmd.args, buildRows(currentSettingsCtx()));
          if (result.kind === "open") { openSettings(); break; }
          if (result.kind === "error") { append(result.lines); break; }
          switch (result.id) {
            // theme applies exactly like ThemeDialog's own Enter handler (setTheme + savePrefs) — the SAME
            // primitive, no session round-trip, matching /theme's own no-engine-touch design.
            case "theme": setTheme(result.value as ThemeId); savePrefsFn({ theme: result.value as ThemeId }); break;
            // model applies exactly like /model's own arg path — resolveModelAlias is the SAME tier-alias
            // translation ("opus" must still resolve to the real id, probe 72).
            case "model": { const m = resolveModelAlias(result.value)!; await session.setModel(m); if (!disposed.current) setModel(m); break; }
            case "outputStyle": await applyOutputStyle(result.value); break;
            case "permissionMode": await applyMode(result.value); break;
            // Boolean row vocabulary ("true"/"false") → setThink's own off/default vocabulary (its doc comment).
            case "thinking": await setThink(result.value === "false" ? "off" : "default"); break;
          }
          if (!disposed.current) append(result.lines);
          break;
        }
        // /permissions (W3 T7, alias /allowed-tools — upstream's own name for the same surface): the five-
        // tab Recently-denied/Allow/Ask/Deny/Workspace dialog. Needs SettingsOps the same way /add-dir does
        // (getSettings/listDirs/addRule/removeRule/addDir/removeDir all live behind that guard).
        case "permissions":
        case "allowed-tools":
          if (!hasSettingsOps(session)) { notice("permissions unsupported on this session"); break; }
          openPermissions();
          break;
        // /output-style (W3 T6): upstream folded the standalone picker into /config's Output-style row —
        // print the exact redirect line, then open Settings AT Config (openSettings always does), never the
        // picker directly (Global Constraints line 33).
        case "output-style": notice(OUTPUT_STYLE_REDIRECT); openSettings(); break;
        // /keybindings (W3 T6): upstream opens ~/.claude/keybindings.json in $EDITOR — a file opener, no
        // in-app UI. We have no keybinding-CUSTOMIZATION mechanism to open a file for, so this opens the
        // existing read-only `?` keymap viewer instead and says so up front (recorded divergence, Global
        // Constraints line 35 — a viewer standing in for an editor-opener, not a bug).
        case "keybindings":
          notice("keybinding customization isn't supported yet — showing the built-in keymap (upstream opens ~/.claude/keybindings.json in your editor)");
          openShortcuts();
          break;
        // Same exit the Ctrl-D / Ctrl-C-twice keys use — the host owns the actual unmount (opts.onExit).
        case "exit": case "quit": opts.onExit?.(); break;
        default: append(formatUnknown(cmd.name));
      }
    } catch (e) { append([{ text: `✗ ${(e as Error).message}`, color: "red" }]); }
  }

  async function openPicker() {
    try { const sessions = await listSessions(); if (!disposed.current) setPicker({ open: true, sessions }); }
    catch (e) { append([{ text: `✗ ${(e as Error).message}`, color: "red" }]); }
  }
  function closePicker() { if (!disposed.current) setPicker({ open: false, sessions: [] }); }
  // Fetch the persisted transcript FIRST; only swap + replay if it has history (never drop into a broken resume).
  // Guarded on `busy` (mirrors the host's own busy-gated `resume` op, Task 2): swapping `session` mid-turn would
  // unsubscribe the `[session]`-keyed event effect from the OLD session before its turn-end event arrives, and
  // since busy is now cleared only by that event (no `.finally()` safety net post-refactor), busy would stay
  // stuck true forever and drainNext would never fire. We never auto-interrupt the old turn — that's the
  // human's call (Esc).
  async function resumeInto(id: string) {
    if (disposed.current) return;
    if (busy) { notice("cannot resume mid-turn — wait for the turn to finish or press Esc to interrupt"); return; }
    let msgs: any[] = [];
    try { msgs = await getSessionMessages(id); } catch { msgs = []; }
    if (disposed.current) return;
    if (!msgs.length) { append([{ text: `⚠ couldn't resume ${id.slice(0, 8)} — no history found`, dim: true }]); return; }
    setSession(makeSession(id));                                   // [session] effect disposes the old
    setStreaming([]);
    setLines(replayLines(msgs, { id }));
    lastAssistant.current = lastAssistantText(msgs);            // /copy follows what is ON SCREEN, not just live turns
    setClearToken((t) => t + 1);                                   // remount the append-only <Static> so the full replay shows (not sliced)
    taskListRef.current.reset(); setTasks([]);
    bgHarvest.current.reset();
    // The old session's bg tasks died with its engine — the old subscription is already detached, and no
    // `tasks_changed:[]` correction can ever arrive to clear them (the new host's follow() only replays a
    // NON-EMPTY snapshot). Without this, stale ⟳ running rows linger forever and killAgents targets ids
    // the new engine never had (F2, final review).
    setBgTasks([]);
  }
  async function doContinue() {
    try {
      const sessions = await listSessions();
      const id = pickMostRecent(sessions);
      if (!id) { append([{ text: "No sessions to continue here", dim: true }]); return; }
      await resumeInto(id);
    } catch (e) { append([{ text: `✗ ${(e as Error).message}`, color: "red" }]); }
  }
  function pickSession(info: SessionInfo) {
    if (disposed.current) return;
    setPicker({ open: false, sessions: [] });
    void resumeInto(info.sessionId);
  }

  async function openModelPicker() {
    try {
      const caps = await session.capabilities();
      if (disposed.current) return;
      const models: ModelInfo[] = (caps.models as any[]).map((m) => ({ value: String(m?.value ?? m), displayName: m?.displayName, description: m?.description }));
      if (!models.length) { append([{ text: "no models available", dim: true }]); return; }
      setModelPicker({ open: true, models });
    } catch (e) { append([{ text: `✗ ${(e as Error).message}`, color: "red" }]); }
  }
  function closeModelPicker() { if (!disposed.current) setModelPicker({ open: false, models: [] }); }
  function pickModel(m: ModelInfo) {
    if (disposed.current) return;
    setModelPicker({ open: false, models: [] });
    // The picker's rows come straight from supportedModels(), whose values are TIER ALIASES ("opus"), so the
    // same translation the /model command does applies here — otherwise picking "Opus" selects Opus 4.8.
    const v = resolveModelAlias(m.value)!;
    // This same picker is shared by the standalone /model command AND the Settings Model row (ChatApp's
    // overlay-chain comment on the settings arm) — `settings.open` stays true the whole time the Settings
    // route has this picker up (only the picker's OWN arm outranks it in that ternary; Settings itself never
    // closes), so it's the one signal that tells the two callers apart here. Reached via Settings, the
    // close-time change summary already reports this row's change — printing the immediate notice too would
    // report the same fact twice (review finding 1). The standalone /model path (settings closed) keeps it,
    // exactly like every other /model invocation.
    const fromSettings = settings.open;
    // Commit synchronously, BEFORE the engine round-trip — not after (final review Finding 2). The old
    // code deferred setModel(v) until `await session.setModel(v)` settled, catching any rejection into a
    // no-op first — so a failed engine call was already indistinguishable from a successful one; deferring
    // the commit bought no correctness, it only opened a window where Esc landing mid-request hit
    // closeSettings while `model` was still the OLD value, so the diff saw no change and printed "Config
    // dialog dismissed" even though the model WAS about to change. Committing first closes that window:
    // by the time any later keypress (Esc included) is processed, this state update has already rendered.
    setModel(v);
    if (!fromSettings) append(formatModel(v));
    void session.setModel(v).catch(() => {});
  }

  // W3 T3: /add-dir. `addDirValidate` is the ONE place that turns a typed path into a verdict — both the
  // command-line arg path above and the dialog's own entry-phase Enter call it, so they can never drift on
  // what counts as valid. `dirs` excludes cwd (validateAddDir takes cwd as its own parameter, matching the
  // host's own cwd/additionalDirectories split — see listDirs's doc comment on the host side).
  async function addDirValidate(raw: string): Promise<AddDirVerdict> {
    if (!hasSettingsOps(session)) throw new Error("add-dir unsupported on this session");
    const rows = await session.listDirs();
    const dirs = rows.filter((r) => r.source !== "cwd").map((r) => r.path);
    return validateAddDir(raw, cwd, dirs);
  }
  function closeAddDir() { if (!disposed.current) setAddDir({ open: false }); }
  // Accept: grant via the session FIRST (the typed door), then optionally persist to local settings. A
  // save failure does NOT roll back or hide the grant — "the session grant already succeeded" (brief) — it
  // only changes which result line prints.
  async function confirmAddDir(abs: string, remember: boolean) {
    closeAddDir();
    if (!hasSettingsOps(session)) return;
    try {
      await session.addDir(abs);
      if (disposed.current) return;
      if (!remember) { append(formatAddDirResult({ kind: "addedSession", abs })); return; }
      try {
        mergeSettingsFile("localSettings", cwd, appendToArray(["permissions", "additionalDirectories"], abs), deps.settingsFileDeps);
        append(formatAddDirResult({ kind: "addedRemembered", abs }));
      } catch (e) { append(formatAddDirResult({ kind: "addedSaveFailed", abs, err: (e as Error).message })); }
    } catch (e) { append([{ text: `✗ ${(e as Error).message}`, color: "red" }]); }
  }
  function cancelAddDir(abs?: string) {
    closeAddDir();
    append(formatAddDirResult(abs ? { kind: "cancelledPath", abs } : { kind: "cancelledEmpty" }));
  }

  // W3 T4: /theme. ThemeDialog's Enter/Esc handlers already did the setTheme/savePrefs work themselves
  // (this dialog needs no session access) — `line` is the exact verbatim result string ("Theme set to
  // {id}" / "Theme picker dismissed"), just close + print it.
  function closeThemeDialog(line: string) { if (!disposed.current) { setThemeDialog({ open: false }); notice(line); } }

  // W3 T5: /config. A snapshot-diff design, not incremental change-tracking (see the settingsBaselineRef
  // comment above) — currentSettingsCtx() reads currentTheme() FRESH each call (theme.ts's own contract:
  // never cache it) alongside whatever this hook's own state currently holds for model/outputStyle/mode/
  // thinkLevel, so both the open-time baseline and the close-time snapshot are always accurate regardless
  // of how many times the Model/Theme/Output-style sub-flows ran in between.
  function currentSettingsCtx(): SettingsRowCtx { return { theme: currentTheme(), model, outputStyle, mode, thinkLevel }; }
  function openSettings() {
    if (disposed.current) return;
    settingsBaselineRef.current = currentSettingsCtx();
    setSettings({ open: true, tab: "Config" });
  }
  function setSettingsTab(tab: string) { if (!disposed.current) setSettings((s) => ({ ...s, tab })); }
  function closeSettings() {
    if (disposed.current) return;
    const baseline = settingsBaselineRef.current;
    settingsBaselineRef.current = null;
    setSettings({ open: false });
    if (!baseline) { notice("Config dialog dismissed"); return; }
    const before = buildRows(baseline), after = buildRows(currentSettingsCtx());
    const changes = new Map<string, string>();
    before.forEach((row, i) => { if (row.value !== after[i]?.value) changes.set(row.label, after[i].value); });
    const lines = summarizeChanges(changes);
    if (lines.length) append(lines); else notice("Config dialog dismissed");
  }
  // The Thinking-mode row's boolean toggle: "off" (budget 0, disabled) or anything else canonicalized to
  // "default" (budget null — the SDK's own default thinking behavior, i.e. exactly the state before any
  // /think call ever ran). Deliberately NOT /think's off/low/medium/high/xhigh/max/<N> vocabulary — the
  // typed /think command is untouched by this, so neither can regress the other.
  async function setThink(level: string): Promise<void> {
    if (disposed.current) return;
    const next = level === "off" ? "off" : "default";
    // Commit first, same reasoning as pickModel above (final review Finding 2): the engine call's own
    // rejection is already swallowed below and never rolls this back, so committing before the await
    // removes the window where closeSettings could diff against a still-stale thinkLevel if Esc landed
    // while setMaxThinkingTokens was still in flight.
    setThinkLevel(next);
    await session.setMaxThinkingTokens(next === "off" ? 0 : null).catch(() => {});
  }
  // The Output-style row: apply the live engine style (best-effort, like every other flag-state op — a
  // session without SettingsOps just skips this leg), remember it in ccx's own prefs (the seed for next
  // boot's SettingsRowCtx.outputStyle), and write it into Claude Code's OWN local settings file so the
  // engine picks it back up natively at next launch — the same "remember" write /add-dir uses, just a
  // scalar patch instead of appendToArray.
  async function applyOutputStyle(id: string): Promise<void> {
    if (disposed.current) return;
    // Commit + persist first, same reasoning as pickModel/setThink above (final review Finding 2): the
    // awaited session.setOutputStyle call's own rejection is already swallowed below and never rolls this
    // back, so committing before the await removes the window where closeSettings could diff against a
    // still-stale outputStyle if Esc landed while the engine round trip was still in flight.
    setOutputStyleState(id);
    savePrefsFn({ outputStyle: id });
    try { mergeSettingsFile("localSettings", cwd, (current) => ({ ...(current && typeof current === "object" ? current : {}), outputStyle: id }), deps.settingsFileDeps); } catch { /* best-effort — no visible error line, mirrors theme's own silent persistence */ }
    if (hasSettingsOps(session)) await session.setOutputStyle(id).catch(() => {});
  }
  // The Settings dialog's Status/Usage/Stats tabs — mirror the /status, /usage, /stats cases exactly
  // (formatStatus/formatUsage/formatStats), just returning lines instead of appending them: the dialog
  // renders them itself, read-only.
  async function fetchSettingsStatus(): Promise<RenderLine[]> {
    const u = await session.usage().catch(() => undefined);
    return formatStatus({ model, mode, thinkLevel, ctxPct, sessionId: session.sessionId, cwd: opts.cwd, usage: u ? usageSummaryLine(u) : undefined });
  }
  async function fetchSettingsUsage(): Promise<RenderLine[]> { return formatUsage(await session.usage()); }
  async function fetchSettingsStats(): Promise<RenderLine[]> {
    const u = (await session.usage().catch(() => ({}))) as SessionUsage;
    const msgs = session.sessionId ? await getSessionMessages(session.sessionId).catch(() => [] as any[]) : [];
    return formatStats(u, msgs);
  }

  // W3 T7: /permissions. Default tab is decided HERE (not in the component), mirroring openSettings's own
  // "always Config" simplicity — "Recently denied" if there's anything to show there, else "Allow" (the
  // upstream default-tab rule, Global Constraints line 34). Computed once at open time, not re-evaluated
  // live while the dialog is already up (a denial arriving mid-session doesn't yank focus to a new tab).
  function openPermissions() {
    if (disposed.current) return;
    setPermissions({ open: true, tab: denials.length ? "Recently denied" : "Allow" });
  }
  function setPermissionsTab(tab: string) { if (!disposed.current) setPermissions((p) => ({ ...p, tab })); }
  function closePermissions() { if (!disposed.current) { setPermissions({ open: false }); notice("Permissions dialog dismissed"); } }
  async function fetchPermSettings(): Promise<unknown> { return hasSettingsOps(session) ? session.getSettings() : {}; }
  async function fetchPermDirs(): Promise<{ path: string; source: "cwd" | "launch" | "session" }[]> { return hasSettingsOps(session) ? session.listDirs() : []; }
  // Add: the flag-layer grant (immediate, this session, via SettingsOps.addRule) AND a persisted write to
  // the CHOSEN file — every add-rule choice persists (the destination picker has no "session only" option,
  // unlike /add-dir's own three-way menu). Tracks which file so a LATER delete of this exact rule can undo
  // both halves, not just the flag layer (see removePermRule below). A file-write failure does not roll
  // back the already-succeeded flag-layer grant, mirroring /add-dir's own save-failure tolerance.
  async function addPermRule(behavior: "allow" | "ask" | "deny", rule: string, target: SettingsTarget): Promise<void> {
    if (disposed.current || !hasSettingsOps(session)) return;
    await session.addRule(behavior, rule).catch(() => {});
    if (disposed.current) return;
    try {
      mergeSettingsFile(target, cwd, appendToArray(["permissions", behavior], rule), deps.settingsFileDeps);
      ruleFileTargets.current.set(`${behavior}:${rule}`, target);
    } catch { /* best-effort persistence — the flag-layer grant above already succeeded */ }
  }
  // Remove: the flag-layer revoke (always, via SettingsOps.removeRule) + the file strip ONLY when this
  // EXACT rule was added through addPermRule above and we therefore know which of the three files to touch
  // — never a blind sweep of files we don't know contain it (a rule whose row came from an ACTUAL settings
  // file, not the flag layer, is readOnly and never reaches this function at all — the dialog routes it to
  // the read-only panel instead).
  async function removePermRule(behavior: "allow" | "ask" | "deny", rule: string): Promise<void> {
    if (disposed.current || !hasSettingsOps(session)) return;
    await session.removeRule(behavior, rule).catch(() => {});
    if (disposed.current) return;
    const key = `${behavior}:${rule}`;
    const target = ruleFileTargets.current.get(key);
    if (target) {
      try { mergeSettingsFile(target, cwd, removeFromArray(["permissions", behavior], rule), deps.settingsFileDeps); } catch { /* best-effort, same tolerance as addPermRule */ }
      ruleFileTargets.current.delete(key);
    }
  }
  // Workspace tab's session-dir remove: flag-layer revoke only — a /add-dir "remember" write is never
  // un-written on removeDir (no un-remember mechanism this wave; recorded divergence, Global Constraints).
  async function removeWorkspaceDir(path: string): Promise<void> {
    if (disposed.current || !hasSettingsOps(session)) return;
    await session.removeDir(path).catch(() => {});
  }

  // Esc-Esc rewind (Stage C5 flagship). Anchors are ALWAYS re-fetched, never patched locally — the persisted
  // transcript's row arithmetic after a rewind doesn't match naive local bookkeeping (live probe 68 Q4).
  async function openRewind() {
    if (disposed.current) return;
    if (busy) { notice("cannot rewind mid-turn — Esc to interrupt first"); return; }
    if (!hasRewind(session)) { notice("rewind unsupported on this session"); return; }
    try {
      const anchors = await session.rewindAnchors();
      if (disposed.current) return;
      if (!anchors.length) { notice("nothing to rewind to"); return; }
      setRewindPicker({ open: true, anchors });
    } catch (e) { append([{ text: `✗ ${(e as Error).message}`, color: "red" }]); }
  }
  function closeRewindPicker() { if (!disposed.current) setRewindPicker({ open: false, anchors: [] }); }
  /** Rebuild the transcript from the PERSISTED session after a conversation rewind truncated it. Shared by
   *  the client that confirmed the rewind and by every other follower reacting to the host's `rewound`
   *  broadcast — a follower passes no prefill, because someone else's rewound prompt does not belong in
   *  this user's composer. Idempotent: re-reading disk and re-rendering is harmless if it runs twice. */
  async function rebuildAfterRewind(prefill?: string) {
    const id = session.sessionId;
    let msgs: any[] = [];
    if (id) { try { msgs = await getSessionMessages(id); } catch { msgs = []; } }
    if (disposed.current) return;
    setStreaming([]);
    setLines(msgs.length ? replayLines(msgs, { id, label: "⏪ rewound" }) : [{ text: "⏪ rewound", dim: true }]);
    lastAssistant.current = lastAssistantText(msgs);        // /copy follows what is on screen
    setClearToken((t) => t + 1);
    taskListRef.current.reset(); setTasks([]);
    bgHarvest.current.reset();
    if (prefill !== undefined) setComposerPrefill({ text: prefill, token: Date.now() });
  }

  function rewindDryRun(uuid: string): Promise<RewindDryRun> {
    return hasRewind(session) ? session.rewindDryRun(uuid) : Promise.resolve({ canRewind: false, error: "unsupported" });
  }
  // A conversation rewind ("both"/"conversation") rebuilds the transcript from the persisted session, bumps
  // clearToken (remount the append-only <Static>), and pre-fills the composer with the rewound prompt's text —
  // CC's edit-and-resend loop. A code-only rewind changes no conversation state: just a notice.
  function confirmRewind(anchor: RewindAnchor, scope: RewindScope) {
    closeRewindPicker();
    if (!hasRewind(session)) return;
    // A rewind is a multi-second engine operation (file restore + engine swap). Without a modal the
    // composer remounts immediately while `busy` is still false, so a prompt typed in that window is
    // cleared from the editor, forwarded, and rejected by the host as busy — silently losing what the
    // user typed. `rewinding` keeps the composer off-screen until the operation settles.
    setRewinding(true);
    void (async () => {
      try {
        await session.rewind(anchor, scope);
        if (disposed.current) return;
        if (scope === "code") { notice(`⏪ code restored to before "${anchor.text.slice(0, 40)}"`); return; }
        await rebuildAfterRewind(anchor.text);
      } catch (e) { append([{ text: `✗ rewind failed: ${(e as Error).message}`, color: "red" }]); }
      finally { if (!disposed.current) setRewinding(false); }
    })();
  }

  // The command channel: echo the prompt, then hand it to the session. ALL rendering (busy/streaming/
  // tasks/model/lines) comes from the event effect above, not from this call — a turn started by another
  // attached client renders identically (spec A2b acceptance 7). onMessage is a deliberate no-op: the
  // events, not the submit callback, own the render.
  function runTurn(prompt: string) {
    setLines((l) => [...l, { text: `› ${prompt}`, dim: true }]);
    session.submit(prompt, () => {}).catch((e) => {
      append([{ text: `✗ ${(e as Error).message}`, color: "red" }]);
      // Only reclaim busy/drain when no turn is event-owned (liveTurnRef null): a live turn — another
      // client's turn streaming, or our own turn that already started and whose end (incl. a synthetic
      // one on host death) the turn-end event arm will still deliver — owns busy/drain on its own; doing
      // it again here would double-drain the queue and can clobber busy out from under a stream that is
      // in fact still live (F2).
      if (liveTurnRef.current === null) { setBusy(false); drainNext(); }
    });
  }
  // After a turn ends, dispatch the next queued prompt (if any) on the next macrotask, so busy=false has
  // committed before dispatch may set it true again. A drained TURN re-drains via its finally (self-chaining);
  // a drained non-turn (e.g. a queued unknown/typo `/cmd`) has no finally, so we re-drain here so the chain
  // never stalls. `drainGen` lets interrupt() cancel an already-scheduled drain (no post-interrupt dispatch).
  function drainNext() {
    const q = queueRef.current;
    if (disposed.current || q.length === 0) return;
    const next = q[0]; setQueue(q.slice(1));
    const gen = drainGen.current;
    setTimeout(() => { if (disposed.current || drainGen.current !== gen) return; if (!dispatch(next)) drainNext(); }, 0);
  }
  // ! bash mode — echo the command, run it locally in cwd, append its output (no model turn; CC's shell escape).
  async function runBashMode(command: string) {
    if (disposed.current || !command) return;
    setLines((l) => [...l, { text: `! ${command}`, color: "magenta" }]);     // immediate echo
    try { const r = await runBash(command, cwd); if (!disposed.current) append(formatBashOutput(r)); }
    catch (e) { append([{ text: `✗ ${(e as Error).message}`, color: "red" }]); }
  }
  // # memory mode — append the note to the project CLAUDE.md (CC's `#` adds to a memory file).
  function memoryMode(note: string) {
    if (disposed.current || !note) return;
    try { const path = appendMemory(note, cwd); append([{ text: `✓ noted in ${shortCwd(path)}`, dim: true }]); }
    catch (e) { append([{ text: `✗ ${(e as Error).message}`, color: "red" }]); }
  }
  /** Route one prompt: ! bash · # memory · /local-command · /catalog-or-prompt turn. Returns true iff it
   *  started a turn (whose finally re-drains the queue); false for non-turn ops (drainNext must re-drain). */
  function dispatch(prompt: string): boolean {
    if (prompt.startsWith("!")) { void runBashMode(prompt.slice(1).trim()); return false; }
    if (prompt.startsWith("#")) { void memoryMode(prompt.slice(1).trim()); return false; }
    const cmd = parseCommand(prompt);
    if (cmd) {
      if (LOCAL_NAMES.has(cmd.name)) { void handleCommand(cmd); return false; }   // local → engine switch
      // U1: a catalogued client-side control gets an honest message, never a prompt the model can't act
      // on. hasOwn, not `in`: a bare object's prototype chain would match "/toString" etc.
      if (Object.hasOwn(CLIENT_SIDE_NOTES, cmd.name)) { append([{ text: `› /${cmd.name}${cmd.args ? " " + cmd.args : ""}`, dim: true }, ...formatClientSide(cmd.name)]); return false; }
      if (catalogNames.current.has(cmd.name)) { runTurn(prompt); return true; }   // catalog → run "/name …" as a turn (probe 31)
      void handleCommand(cmd); return false;                                       // unknown → formatUnknown (switch default)
    }
    runTurn(prompt); return true;
  }
  // While a turn runs, regular prompts + catalog commands QUEUE (drained FIFO on turn end); local commands and
  // !/# run immediately (control-channel / local — safe mid-turn). Type-ahead while Claude works (CC parity).
  function submit(prompt: string) {
    if (disposed.current || !prompt.trim()) return;
    if (!busy) { dispatch(prompt); return; }
    if (prompt.startsWith("!") || prompt.startsWith("#")) { dispatch(prompt); return; }
    const cmd = parseCommand(prompt);
    if (cmd && LOCAL_NAMES.has(cmd.name)) { dispatch(prompt); return; }
    setQueue((q) => [...q, prompt]);                                            // turn while busy → enqueue
  }
  // Answer the head entry via the remote feed; the dialog clears/advances on the SETTLED event (dropPending),
  // never optimistically here — a race (someone else answered first) still needs the settle to land.
  function resolveDecision(outcome: DecisionOutcome) {
    const entry = pendingRef.current;
    if (!entry || !hasDecisionFeed(session)) return;
    answeredIds.current.add(entry.toolUseID);
    void session.answerDecision(entry.toolUseID, outcome).then((r) => { if (r.alreadyAnsweredBy) notice(`answered by ${r.alreadyAnsweredBy}`); })
      .catch((e) => {
        // A designed-for rejection path (host death mid-dialog, or the 10s request deadline on a wedged
        // host) — never leave this unhandled (F1: it used to crash the whole REPL). Un-mark it as ours so
        // a LATER settle of the same entry (the park is still live host-side — never cleared here) still
        // renders correctly instead of being mistaken for our own already-applied answer.
        answeredIds.current.delete(entry.toolUseID);
        notice(`✗ answer failed: ${(e as Error).message}`);
      });
  }
  // The "already applied" knowledge lives HERE, not in a ref inside ChatComposer: the composer unmounts
  // whenever any popup arm takes over (shortcuts/rewind/bg-tasks/model/session picker, any decision
  // dialog), which resets a component-local dedup ref to its initial value while `composerPrefill` still
  // holds the already-consumed rewound prompt — so on remount the ref-guarded effect re-applies it,
  // resurrecting a stale prompt into the composer after the user already edited/submitted past it. A
  // prefill is applied at most once: the composer calls this the moment it applies the text, clearing the
  // state so no later remount (with a reset ref) can ever see a non-null prefill to re-apply.
  function clearPrefill() { if (!disposed.current) setComposerPrefill(null); }
  function openBgPanel() { if (!disposed.current) setBgPanelOpen(true); }
  function closeBgPanel() { if (!disposed.current) setBgPanelOpen(false); }
  function openShortcuts() { if (!disposed.current) setShortcutsOpen(true); }
  function closeShortcuts() { if (!disposed.current) setShortcutsOpen(false); }
  function openHistorySearch() { if (!disposed.current) setHistoryOpen(true); }
  function closeHistorySearch() { if (!disposed.current) setHistoryOpen(false); }
  // Esc/Tab (historySearch:accept): the chosen prompt lands in the composer via the same prefill seam the
  // rewind edit-and-resend uses — applied at most once, remount-safe.
  function acceptHistory(text: string) { if (disposed.current) return; setHistoryOpen(false); setComposerPrefill({ text, token: Date.now() }); }
  function executeHistory(text: string) { if (disposed.current) return; setHistoryOpen(false); submit(text); }
  async function loadHistory(scope: HistoryScope): Promise<HistEntry[]> {
    if (scope === "session") {
      const id = session.sessionId;
      const msgs = id ? await getSessionMessages(id).catch(() => [] as any[]) : [];
      return promptEntries(msgs, Date.now());
    }
    const sessions = await listHistorySessions(scope === "project" ? cwd : undefined).catch(() => [] as SessionInfo[]);
    // getSessionMessagesIn, not the pinned getSessionMessages: "everywhere" must read sessions OUTSIDE
    // this project too, and the pinned reader always scopes to opts.cwd (F1, final review).
    const readCwd = scope === "project" ? cwd : undefined;
    const lists = await Promise.all(sessions.slice(0, 15).map(async (s) => promptEntries(await getSessionMessagesIn(s.sessionId, readCwd).catch(() => [] as any[]), s.lastModified)));
    return mergeEntries(lists);
  }
  function stopBgTask(id: string) { if (hasBgTasks(session)) void session.stopBgTask(id).catch((e) => append([{ text: `✗ ${(e as Error).message}`, color: "red" }])); }
  // Ctrl-X Ctrl-K (CC chat:killAgents): double-press confirm within 3s, exactly the 2.1.220 flow —
  // "No background agents running" when idle, arm notice on the first press, stop-all on the second.
  function killAgents() {
    const tasks = bgTasksRef.current;
    if (tasks.length === 0) { notice("No background agents running"); return; }
    const now = Date.now();
    if (now - killArmAt.current <= 3000) {
      killArmAt.current = 0;
      for (const t of tasks) stopBgTask(t.task_id);
      notice(`◼ stopping ${tasks.length} background task${tasks.length === 1 ? "" : "s"}`);
      return;
    }
    killArmAt.current = now;
    notice("Press Ctrl-X Ctrl-K again to stop background agents");
  }
  function backgroundNow() {
    if (!hasBgTasks(session)) { notice("background unsupported on this session"); return; }
    void session.background().then((b) => { if (!b) notice("nothing to background"); }).catch((e) => append([{ text: `✗ ${(e as Error).message}`, color: "red" }]));
  }
  // Apply a permission mode. `auto` is model-gated (probe 24): if the live model can't run auto, swap to a
  // supported one FIRST (verified to take effect at runtime) with a notice, then set the mode. Disposed-guarded
  // across each await — incl. a macrotask yield before setPermissionMode so a cycle fired right after unmount
  // (ink runs the disposed-sentinel cleanup one macrotask late) is caught and never mutates state post-unmount.
  async function applyMode(next: string) {
    if (disposed.current) return;
    if (next === "auto") {
      // Only ever switch a model we actually KNOW. When `model` is undefined (an `attach` client that has
      // not seen a turn end) the old code resolved it to DEFAULT_AUTO_MODEL and switched — downgrading a
      // session whose model the user deliberately chose. Say what we can't determine instead of guessing.
      if (model === undefined) notice("auto — can't check this client's model; if it doesn't support auto the engine falls back to default");
      else {
        const target = resolveAutoModel(model);
        if (model !== target) {
          await session.setModel(target).catch(() => {});
          if (disposed.current) return;
          setModel(target);
          append([{ text: `↻ auto — switched model to ${target} (${model} doesn't support auto)`, dim: true }]);
        }
      }
    }
    await new Promise<void>((r) => setTimeout(r, 0));
    if (disposed.current) return;
    await session.setPermissionMode(next).catch(() => {});
    if (!disposed.current) setMode(next);
  }
  function cycleMode() { void applyMode(ladderNext(mode)); }
  function interrupt() { drainGen.current++; setQueue([]); void session.interrupt().catch(() => {}); }   // Esc stops everything: queue + any scheduled drain
  function clear() { if (!disposed.current) { clearScreen(); setLines([]); setStreaming([]); setClearToken((t) => t + 1); } }   // /clear: wipe screen + model (session context kept)

  return { state: { lines, streaming, pending, mode, busy, ctxPct, model, picker, tasks, bgTasks, bgRows: bgHarvest.current.rows(bgTasks), bgPanelOpen, thinkLevel, turnStartedAt, modelPicker, commandCatalog, queue, clearToken, turnTokens, rewindPicker, composerPrefill, rewinding, usageWarn, shortcutsOpen, historyOpen, addDir, themeDialog, settings, outputStyle, permissions, denials } as ChatState, submit, resolveDecision, cycleMode, interrupt, clear, closePicker, pickSession, closeModelPicker, pickModel, openModelPicker, notice, openBgPanel, closeBgPanel, stopBgTask, killAgents, backgroundNow, openRewind, closeRewindPicker, rewindDryRun, confirmRewind, openShortcuts, closeShortcuts, clearPrefill, openHistorySearch, closeHistorySearch, acceptHistory, executeHistory, loadHistory, addDirValidate, confirmAddDir, cancelAddDir, closeThemeDialog, applyMode, setThink, closeSettings, setSettingsTab, applyOutputStyle, fetchSettingsStatus, fetchSettingsUsage, fetchSettingsStats, closePermissions, setPermissionsTab, fetchPermSettings, fetchPermDirs, addPermRule, removePermRule, removeWorkspaceDir };
}
