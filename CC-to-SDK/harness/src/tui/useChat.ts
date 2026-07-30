// tui/src/useChat.ts — owns the session (event-driven, Goal B task 7): the host event stream is the
// SINGLE rendering source (turn/message/decision/tasks_changed/task/state events all arrive via
// ChatSession & SessionEvents & DecisionFeed & BgTasks), `submit`/`resolveDecision` are command channels
// only. Owns the transcript, the streaming turn, the decision queue, mode switching (Tab ladder + host
// truth via state events), the bg-task panel, and idempotent teardown.
import { useEffect, useRef, useState } from "react";
import type { ChatSession } from "../session/chatSession.js";
import { hasDecisionFeed, hasBgTasks, hasSessionEvents, hasRewind } from "../session/chatSession.js";
import type { RewindAnchor, RewindScope, RewindDryRun } from "../session/chatSession.js";
import type { PendingDecision } from "../permissions/pending.js";
import type { DecisionOutcome } from "../permissions/types.js";
import type { BackgroundTaskInfo } from "../session/session.js";
import type { RenderLine } from "./render.js";
import { LiveTurn } from "./liveTurn.js";
import { TaskList, type TaskItem } from "./taskList.js";
import { parseCommand, formatHelp, formatModel, formatThink, formatCompact, formatContext, formatCost, formatStatus, formatUnknown, parseMcpArgs, formatMcpStatus, formatMcpUsage, pickMostRecent, LOCAL_COMMAND_ENTRIES, LOCAL_NAMES, type ParsedCommand, type InitialResume, type SessionUsage } from "./commands.js";
import { formatUsage, usageWarning, usageSummaryLine } from "./usageFormat.js";
import { mergeCommands, toCatalogEntry, type CommandEntry } from "./commandComplete.js";
import { parseThinkArg } from "./thinkLevels.js";
import { lastAssistantText } from "../sessions/rows.js";
import type { ModelInfo } from "./ModelPicker.js";
import { replayLines } from "./replay.js";
import { runBash as realRunBash, formatBashOutput, type BashResult } from "./bash.js";
import { copyToClipboard as realCopyToClipboard } from "./copy.js";
import { appendMemory as realAppendMemory } from "./memory.js";
import { shortCwd } from "./banner.js";
import { summarizeUsage, listSessions as realListSessions, getSessionMessages as realGetSessionMessages, resolveAutoModel, resolveModelAlias } from "../index.js";
import type { RawContextUsage } from "../index.js";

// ChatSession is promoted to ../session/chatSession.ts (spec A2b §2) so the lib Session and the remote
// adapter satisfy ONE interface; re-exported here so this package's other modules' imports keep working.
export type { ChatSession };
export interface SessionInfo { sessionId: string; summary: string; firstPrompt?: string; lastModified: number }
export interface ChatState { lines: RenderLine[]; streaming: RenderLine[]; pending: PendingDecision | null; mode: string; busy: boolean; ctxPct?: number; model?: string; picker: { open: boolean; sessions: SessionInfo[] }; tasks: TaskItem[]; bgTasks: BackgroundTaskInfo[]; bgPanelOpen: boolean; thinkLevel: string; turnStartedAt: number; modelPicker: { open: boolean; models: ModelInfo[] }; commandCatalog: CommandEntry[]; queue: string[]; clearToken: number; turnTokens: number; rewindPicker: { open: boolean; anchors: RewindAnchor[] }; composerPrefill: { text: string; token: number } | null; rewinding: boolean; usageWarn?: string; shortcutsOpen: boolean; }

const LADDER = ["default", "acceptEdits", "plan", "auto"] as const;   // Tab cycles these; bypassPermissions stays off-cycle (/yolo)
/** Next mode on the Tab ladder; any off-ladder mode (e.g. bypassPermissions/dontAsk) re-enters at "default". */
function ladderNext(mode: string): string { const i = (LADDER as readonly string[]).indexOf(mode); return i >= 0 ? LADDER[(i + 1) % LADDER.length] : "default"; }

export function useChat(
  makeSession: (resume?: string) => ChatSession,
  opts: { initialMode?: string; cwd?: string; initialResume?: InitialResume; initialThink?: string; initialLines?: RenderLine[]; initialPrompt?: string; onExit?: () => void } = {},
  deps: { listSessions?: () => Promise<SessionInfo[]>; getSessionMessages?: (id: string) => Promise<any[]>; runBash?: (cmd: string, cwd: string) => Promise<BashResult>; appendMemory?: (note: string, cwd: string) => string; clearScreen?: () => void; copyText?: (t: string) => Promise<void> } = {},
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
  const [model, setModel] = useState<string | undefined>(undefined);
  const [thinkLevel, setThinkLevel] = useState(opts.initialThink ?? "default");
  const [picker, setPicker] = useState<{ open: boolean; sessions: SessionInfo[] }>({ open: false, sessions: [] });
  const [modelPicker, setModelPicker] = useState<{ open: boolean; models: ModelInfo[] }>({ open: false, models: [] });
  const [rewindPicker, setRewindPicker] = useState<{ open: boolean; anchors: RewindAnchor[] }>({ open: false, anchors: [] });
  const [composerPrefill, setComposerPrefill] = useState<{ text: string; token: number } | null>(null);
  const [rewinding, setRewinding] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);   // the `?` help overlay (pure display)
  const [commandCatalog, setCommandCatalog] = useState<CommandEntry[]>(LOCAL_COMMAND_ENTRIES);   // local-only until the live fetch resolves
  const catalogNames = useRef<Set<string>>(new Set());                                            // catalog (non-local) names → routed to submit-as-prompt
  const taskListRef = useRef(new TaskList());
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [bgTasks, setBgTasks] = useState<BackgroundTaskInfo[]>([]);
  const [bgPanelOpen, setBgPanelOpen] = useState(false);
  const [turnTokens, setTurnTokens] = useState(0);    // live output-token count for the in-flight turn (spinner)
  const [queue, setQueue] = useState<string[]>([]);   // prompts/turns submitted while busy; drained FIFO on turn end
  const queueRef = useRef<string[]>([]); queueRef.current = queue;
  const drainGen = useRef(0);                          // bumped by interrupt → invalidates any scheduled drain (no post-interrupt dispatch)
  const [clearToken, setClearToken] = useState(0);    // bumped on clear → remounts the append-only <Static> so it truly empties
  const disposed = useRef(false);
  const listSessions = deps.listSessions ?? (() => realListSessions({ cwd: opts.cwd, limit: 30 }) as Promise<SessionInfo[]>);
  const getSessionMessages = deps.getSessionMessages ?? ((id: string) => realGetSessionMessages(id, { cwd: opts.cwd }) as Promise<any[]>);
  const runBash = deps.runBash ?? realRunBash;
  const appendMemory = deps.appendMemory ?? realAppendMemory;
  const copyText = deps.copyText ?? realCopyToClipboard;
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

  // Decision FIFO: the dialog shows the head; extras queue behind it. `pushPending`/`dropPending` are
  // driven by the DecisionFeed subscription above — never optimistically from resolveDecision.
  function pushPending(entry: PendingDecision) {
    if (pendingRef.current === null) setPending(entry);
    else setPendingQueue((q) => [...q, entry]);
  }
  function dropPending(toolUseID: string, by: string, decision: string) {
    const wasMine = answeredIds.current.has(toolUseID);
    answeredIds.current.delete(toolUseID);
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
    void (async () => { await session.setModel(v).catch(() => {}); if (!disposed.current) { setModel(v); append(formatModel(v)); } })();
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
  function stopBgTask(id: string) { if (hasBgTasks(session)) void session.stopBgTask(id).catch((e) => append([{ text: `✗ ${(e as Error).message}`, color: "red" }])); }
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
      const target = resolveAutoModel(model);
      if (model !== target) {
        await session.setModel(target).catch(() => {});
        if (disposed.current) return;
        setModel(target);
        append([{ text: model ? `↻ auto — switched model to ${target} (${model} doesn't support auto)` : `↻ auto — using ${target} (auto needs Opus 4.6+/Sonnet 4.6)`, dim: true }]);
      }
    }
    await new Promise<void>((r) => setTimeout(r, 0));
    if (disposed.current) return;
    await session.setPermissionMode(next).catch(() => {});
    if (!disposed.current) setMode(next);
  }
  function cycleMode() { void applyMode(ladderNext(mode)); }
  function interrupt() { drainGen.current++; setQueue([]); void session.interrupt().catch(() => {}); }   // Esc stops everything: queue + any scheduled drain
  function clear() { if (!disposed.current) { clearScreen(); setLines([]); setStreaming([]); setClearToken((t) => t + 1); } }   // Ctrl-L / /clear: wipe screen + model (session context kept)

  return { state: { lines, streaming, pending, mode, busy, ctxPct, model, picker, tasks, bgTasks, bgPanelOpen, thinkLevel, turnStartedAt, modelPicker, commandCatalog, queue, clearToken, turnTokens, rewindPicker, composerPrefill, rewinding, usageWarn, shortcutsOpen } as ChatState, submit, resolveDecision, cycleMode, interrupt, clear, closePicker, pickSession, closeModelPicker, pickModel, notice, openBgPanel, closeBgPanel, stopBgTask, backgroundNow, openRewind, closeRewindPicker, rewindDryRun, confirmRewind, openShortcuts, closeShortcuts, clearPrefill };
}
