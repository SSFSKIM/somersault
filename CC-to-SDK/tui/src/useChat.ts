// tui/src/useChat.ts — owns the in-process Session (default mode), the transcript, the streaming turn, the
// late-bound permission broker, mode switching, and idempotent teardown.
import { useEffect, useRef, useState } from "react";
import type { PermissionDecision, PermissionRequest } from "cc-harness";
import type { RenderLine } from "./render.js";
import { LiveTurn } from "./liveTurn.js";
import type { UiBrokerHandle } from "./uiBroker.js";
import { TaskList, type TaskItem } from "./taskList.js";
import { parseCommand, formatHelp, formatModel, formatThink, formatCompact, formatContext, formatCost, formatStatus, formatUnknown, pickMostRecent, LOCAL_COMMAND_ENTRIES, LOCAL_NAMES, type ParsedCommand, type InitialResume, type SessionUsage } from "./commands.js";
import { mergeCommands, toCatalogEntry, type CommandEntry } from "./commandComplete.js";
import { parseThinkArg } from "./thinkLevels.js";
import type { ModelInfo } from "./ModelPicker.js";
import { replayLines } from "./replay.js";
import { runBash as realRunBash, formatBashOutput, type BashResult } from "./bash.js";
import { appendMemory as realAppendMemory } from "./memory.js";
import { shortCwd } from "./banner.js";
import { summarizeUsage, listSessions as realListSessions, getSessionMessages as realGetSessionMessages, resolveAutoModel } from "cc-harness";
import type { CompactOutcome, RawContextUsage } from "cc-harness";

/** The subset of the lib Session the REPL drives (the real Session satisfies this). */
export interface ChatSession {
  submit(prompt: string, onMessage: (m: unknown) => void): Promise<{ result: unknown }>;
  setPermissionMode(mode: string): Promise<void>;
  setModel(model?: string): Promise<void>;
  setMaxThinkingTokens(maxTokens: number | null): Promise<void>;
  capabilities(): Promise<{ models: unknown[]; commands: unknown[]; mcpServers: unknown[] }>;
  compact(): Promise<CompactOutcome>;
  interrupt(): Promise<void>;
  getContextUsage(): Promise<unknown>;
  usage(): Promise<unknown>;
  dispose(): Promise<void>;
  readonly sessionId?: string;
}
export interface SessionInfo { sessionId: string; summary: string; firstPrompt?: string; lastModified: number }
export interface Pending { req: PermissionRequest; resolve: (d: PermissionDecision) => void; }
export interface ChatState { lines: RenderLine[]; streaming: RenderLine[]; pending: Pending | null; mode: string; busy: boolean; ctxPct?: number; model?: string; picker: { open: boolean; sessions: SessionInfo[] }; tasks: TaskItem[]; subagentActive: boolean; thinkLevel: string; turnStartedAt: number; modelPicker: { open: boolean; models: ModelInfo[] }; commandCatalog: CommandEntry[]; queue: string[]; clearToken: number; }

const LADDER = ["default", "acceptEdits", "auto"] as const;   // Tab cycles these; bypassPermissions is off-cycle (/yolo)
/** Next mode on the Tab ladder; any off-ladder mode (bypassPermissions/plan/…) re-enters at "default". */
function ladderNext(mode: string): string { const i = (LADDER as readonly string[]).indexOf(mode); return i >= 0 ? LADDER[(i + 1) % LADDER.length] : "default"; }

export function useChat(
  makeSession: (resume?: string) => ChatSession,
  ui: UiBrokerHandle,
  opts: { initialMode?: string; cwd?: string; initialResume?: InitialResume; initialThink?: string; initialLines?: RenderLine[] } = {},
  deps: { listSessions?: () => Promise<SessionInfo[]>; getSessionMessages?: (id: string) => Promise<any[]>; runBash?: (cmd: string, cwd: string) => Promise<BashResult>; appendMemory?: (note: string, cwd: string) => string; clearScreen?: () => void } = {},
) {
  const [session, setSession] = useState<ChatSession>(() => makeSession());
  // Seed the scrollback with the welcome banner — unless we're launching straight into a resume (the
  // replay fills `lines` and a banner would be misleading above a rejoined transcript).
  const [lines, setLines] = useState<RenderLine[]>(() => (opts.initialResume ? [] : opts.initialLines ?? []));
  const [streaming, setStreaming] = useState<RenderLine[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [mode, setMode] = useState(opts.initialMode ?? "default");
  const [busy, setBusy] = useState(false);
  const [turnStartedAt, setTurnStartedAt] = useState(0);
  const [ctxPct, setCtxPct] = useState<number | undefined>(undefined);
  const [model, setModel] = useState<string | undefined>(undefined);
  const [thinkLevel, setThinkLevel] = useState(opts.initialThink ?? "default");
  const [picker, setPicker] = useState<{ open: boolean; sessions: SessionInfo[] }>({ open: false, sessions: [] });
  const [modelPicker, setModelPicker] = useState<{ open: boolean; models: ModelInfo[] }>({ open: false, models: [] });
  const [commandCatalog, setCommandCatalog] = useState<CommandEntry[]>(LOCAL_COMMAND_ENTRIES);   // local-only until the live fetch resolves
  const catalogNames = useRef<Set<string>>(new Set());                                            // catalog (non-local) names → routed to submit-as-prompt
  const taskListRef = useRef(new TaskList());
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [subagentActive, setSubagentActive] = useState(false);
  const [queue, setQueue] = useState<string[]>([]);   // prompts/turns submitted while busy; drained FIFO on turn end
  const queueRef = useRef<string[]>([]); queueRef.current = queue;
  const [clearToken, setClearToken] = useState(0);    // bumped on clear → remounts the append-only <Static> so it truly empties
  const disposed = useRef(false);
  const pendingRef = useRef<Pending | null>(null);
  pendingRef.current = pending;
  const listSessions = deps.listSessions ?? (() => realListSessions({ cwd: opts.cwd, limit: 30 }) as Promise<SessionInfo[]>);
  const getSessionMessages = deps.getSessionMessages ?? ((id: string) => realGetSessionMessages(id, { cwd: opts.cwd }) as Promise<any[]>);
  const runBash = deps.runBash ?? realRunBash;
  const appendMemory = deps.appendMemory ?? realAppendMemory;
  // Real terminal clear: wipe screen + scrollback + home cursor (Static is append-only — a model reset alone
  // can't erase already-printed lines, so we also clear the terminal, exactly like CC's /clear).
  const clearScreen = deps.clearScreen ?? (() => { try { if (process.stdout.isTTY) process.stdout.write("\x1b[2J\x1b[3J\x1b[H"); } catch { /* no tty */ } });
  const cwd = opts.cwd ?? process.cwd();
  const ranInitial = useRef(false);

  // Unmount-only sentinel: mark disposed + settle any parked permission promise (never on a session swap).
  useEffect(() => () => { disposed.current = true; pendingRef.current?.resolve({ kind: "deny" }); }, []);
  // Dispose the PREVIOUS session whenever it changes (a /resume swap) and on unmount. Must not touch `disposed`.
  useEffect(() => () => { void session.dispose().catch(() => {}); }, [session]);
  // Late-bound permission handler, keyed on the broker identity only.
  useEffect(() => {
    ui.setHandler((req) => new Promise<PermissionDecision>((resolve) => {
      if (disposed.current) return resolve({ kind: "deny" });
      setPending({ req, resolve });
    }));
    return () => { ui.setHandler(null); };
  }, [ui]);
  // Launch-time resume: run once on mount if an initialResume intent was passed.
  useEffect(() => {
    if (ranInitial.current || !opts.initialResume) return; ranInitial.current = true;
    if (opts.initialResume.kind === "id") void resumeInto(opts.initialResume.id);
    else void doContinue();
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

  function append(ls: RenderLine[]) { if (!disposed.current && ls.length) setLines((l) => [...l, ...ls]); }

  async function handleCommand(cmd: ParsedCommand) {
    setLines((l) => [...l, { text: `› /${cmd.name}${cmd.args ? " " + cmd.args : ""}`, dim: true }]);
    try {
      switch (cmd.name) {
        case "model":
          if (cmd.args) { await session.setModel(cmd.args); if (!disposed.current) setModel(cmd.args); append(formatModel(cmd.args)); }
          else { await openModelPicker(); }
          break;
        case "compact": append(formatCompact(await session.compact())); break;
        case "context": append(formatContext(summarizeUsage((await session.getContextUsage()) as RawContextUsage))); break;
        case "cost": append(formatCost((await session.usage()) as SessionUsage)); break;
        case "status": append(formatStatus({ model, mode, thinkLevel, ctxPct, sessionId: session.sessionId, cwd: opts.cwd })); break;
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
  async function resumeInto(id: string) {
    if (disposed.current) return;
    let msgs: any[] = [];
    try { msgs = await getSessionMessages(id); } catch { msgs = []; }
    if (disposed.current) return;
    if (!msgs.length) { append([{ text: `⚠ couldn't resume ${id.slice(0, 8)} — no history found`, dim: true }]); return; }
    setSession(makeSession(id));                                   // [session] effect disposes the old
    setStreaming([]);
    setLines(replayLines(msgs, { id }));
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
    void (async () => { await session.setModel(m.value).catch(() => {}); if (!disposed.current) { setModel(m.value); append(formatModel(m.value)); } })();
  }

  function runTurn(prompt: string) {
    setLines((l) => [...l, { text: `› ${prompt}`, dim: true }]);
    setStreaming([]); setBusy(true); setTurnStartedAt(Date.now());
    const lt = new LiveTurn();
    session.submit(prompt, (m) => { if (disposed.current) return; lt.ingest(m); taskListRef.current.ingest(m); setStreaming(lt.snapshot()); setTasks(taskListRef.current.snapshot()); setSubagentActive(lt.subagentActive); })
      .then(() => {}, (e) => { lt.fail((e as Error).message); })
      .finally(() => { if (disposed.current) return; setLines((l) => [...l, ...lt.finalize()]); setStreaming([]); setBusy(false); setSubagentActive(false); if (lt.model) setModel(lt.model); void refreshCtx(); drainNext(); });
  }
  // After a turn ends, dispatch the next queued prompt (if any) on the next macrotask, so busy=false has
  // committed before dispatch may set it true again. Each drained turn's finally re-drains → self-chaining.
  function drainNext() {
    const q = queueRef.current;
    if (disposed.current || q.length === 0) return;
    const next = q[0]; setQueue(q.slice(1));
    setTimeout(() => { if (!disposed.current) dispatch(next); }, 0);
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
  /** Route one prompt: ! bash · # memory · /local-command · /catalog-or-prompt turn. */
  function dispatch(prompt: string) {
    if (prompt.startsWith("!")) { void runBashMode(prompt.slice(1).trim()); return; }
    if (prompt.startsWith("#")) { void memoryMode(prompt.slice(1).trim()); return; }
    const cmd = parseCommand(prompt);
    if (cmd) {
      if (LOCAL_NAMES.has(cmd.name)) { void handleCommand(cmd); return; }      // local → engine switch
      if (catalogNames.current.has(cmd.name)) { runTurn(prompt); return; }     // catalog → run "/name …" as a turn (probe 31)
      void handleCommand(cmd); return;                                          // unknown → formatUnknown (switch default)
    }
    runTurn(prompt);
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
  function resolvePermission(d: PermissionDecision) { pendingRef.current?.resolve(d); setPending(null); }
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
  function interrupt() { setQueue([]); void session.interrupt().catch(() => {}); }   // Esc stops everything: queue too
  function clear() { if (!disposed.current) { clearScreen(); setLines([]); setStreaming([]); setClearToken((t) => t + 1); } }   // Ctrl-L / /clear: wipe screen + model (session context kept)

  return { state: { lines, streaming, pending, mode, busy, ctxPct, model, picker, tasks, subagentActive, thinkLevel, turnStartedAt, modelPicker, commandCatalog, queue, clearToken } as ChatState, submit, resolvePermission, cycleMode, interrupt, clear, closePicker, pickSession, closeModelPicker, pickModel };
}
