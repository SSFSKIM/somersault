// tui/src/useChat.ts — owns the in-process Session (default mode), the transcript, the streaming turn, the
// late-bound permission broker, mode switching, and idempotent teardown.
import { useEffect, useRef, useState } from "react";
import type { PermissionDecision, PermissionRequest } from "cc-harness";
import type { RenderLine } from "./render.js";
import { LiveTurn } from "./liveTurn.js";
import type { UiBrokerHandle } from "./uiBroker.js";
import { TaskList, type TaskItem } from "./taskList.js";
import { parseCommand, formatHelp, formatModel, formatThink, formatCompact, formatContext, formatUnknown, pickMostRecent, type ParsedCommand, type InitialResume } from "./commands.js";
import { parseThinkArg } from "./thinkLevels.js";
import { replayLines } from "./replay.js";
import { summarizeUsage, listSessions as realListSessions, getSessionMessages as realGetSessionMessages, resolveAutoModel } from "cc-harness";
import type { CompactOutcome, RawContextUsage } from "cc-harness";

/** The subset of the lib Session the REPL drives (the real Session satisfies this). */
export interface ChatSession {
  submit(prompt: string, onMessage: (m: unknown) => void): Promise<{ result: unknown }>;
  setPermissionMode(mode: string): Promise<void>;
  setModel(model?: string): Promise<void>;
  setMaxThinkingTokens(maxTokens: number | null): Promise<void>;
  compact(): Promise<CompactOutcome>;
  interrupt(): Promise<void>;
  getContextUsage(): Promise<unknown>;
  dispose(): Promise<void>;
  readonly sessionId?: string;
}
export interface SessionInfo { sessionId: string; summary: string; firstPrompt?: string; lastModified: number }
export interface Pending { req: PermissionRequest; resolve: (d: PermissionDecision) => void; }
export interface ChatState { lines: RenderLine[]; streaming: RenderLine[]; pending: Pending | null; mode: string; busy: boolean; ctxPct?: number; model?: string; picker: { open: boolean; sessions: SessionInfo[] }; tasks: TaskItem[]; subagentActive: boolean; thinkLevel: string; }

const LADDER = ["default", "acceptEdits", "auto"] as const;   // Tab cycles these; bypassPermissions is off-cycle (/yolo)
/** Next mode on the Tab ladder; any off-ladder mode (bypassPermissions/plan/…) re-enters at "default". */
function ladderNext(mode: string): string { const i = (LADDER as readonly string[]).indexOf(mode); return i >= 0 ? LADDER[(i + 1) % LADDER.length] : "default"; }

export function useChat(
  makeSession: (resume?: string) => ChatSession,
  ui: UiBrokerHandle,
  opts: { initialMode?: string; cwd?: string; initialResume?: InitialResume; initialThink?: string } = {},
  deps: { listSessions?: () => Promise<SessionInfo[]>; getSessionMessages?: (id: string) => Promise<any[]> } = {},
) {
  const [session, setSession] = useState<ChatSession>(() => makeSession());
  const [lines, setLines] = useState<RenderLine[]>([]);
  const [streaming, setStreaming] = useState<RenderLine[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [mode, setMode] = useState(opts.initialMode ?? "default");
  const [busy, setBusy] = useState(false);
  const [ctxPct, setCtxPct] = useState<number | undefined>(undefined);
  const [model, setModel] = useState<string | undefined>(undefined);
  const [thinkLevel, setThinkLevel] = useState(opts.initialThink ?? "default");
  const [picker, setPicker] = useState<{ open: boolean; sessions: SessionInfo[] }>({ open: false, sessions: [] });
  const taskListRef = useRef(new TaskList());
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [subagentActive, setSubagentActive] = useState(false);
  const disposed = useRef(false);
  const pendingRef = useRef<Pending | null>(null);
  pendingRef.current = pending;
  const listSessions = deps.listSessions ?? (() => realListSessions({ cwd: opts.cwd, limit: 30 }) as Promise<SessionInfo[]>);
  const getSessionMessages = deps.getSessionMessages ?? ((id: string) => realGetSessionMessages(id, { cwd: opts.cwd }) as Promise<any[]>);
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
          else append(formatModel(undefined, model));
          break;
        case "compact": append(formatCompact(await session.compact())); break;
        case "context": append(formatContext(summarizeUsage((await session.getContextUsage()) as RawContextUsage))); break;
        case "clear": if (!disposed.current) setLines([]); break;
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

  function submit(prompt: string) {
    if (disposed.current || busy || !prompt.trim()) return;
    const cmd = parseCommand(prompt);
    if (cmd) { void handleCommand(cmd); return; }
    setLines((l) => [...l, { text: `› ${prompt}`, dim: true }]);
    setStreaming([]); setBusy(true);
    const lt = new LiveTurn();
    session.submit(prompt, (m) => { if (disposed.current) return; lt.ingest(m); taskListRef.current.ingest(m); setStreaming(lt.snapshot()); setTasks(taskListRef.current.snapshot()); setSubagentActive(lt.subagentActive); })
      .then(() => {}, (e) => { lt.fail((e as Error).message); })
      .finally(() => { if (disposed.current) return; setLines((l) => [...l, ...lt.finalize()]); setStreaming([]); setBusy(false); setSubagentActive(false); if (lt.model) setModel(lt.model); void refreshCtx(); });
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
  function interrupt() { void session.interrupt().catch(() => {}); }

  return { state: { lines, streaming, pending, mode, busy, ctxPct, model, picker, tasks, subagentActive, thinkLevel } as ChatState, submit, resolvePermission, cycleMode, interrupt, closePicker, pickSession };
}
