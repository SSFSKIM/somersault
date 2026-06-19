// tui/src/useChat.ts — owns the in-process Session (default mode), the transcript, the streaming turn, the
// late-bound permission broker, mode switching, and idempotent teardown.
import { useEffect, useRef, useState } from "react";
import type { PermissionDecision, PermissionRequest } from "cc-harness";
import type { RenderLine } from "./render.js";
import { LiveTurn } from "./liveTurn.js";
import type { UiBrokerHandle } from "./uiBroker.js";
import { parseCommand, formatHelp, formatModel, formatCompact, formatContext, formatUnknown, formatResumed, type ParsedCommand } from "./commands.js";
import { summarizeUsage, listSessions as realListSessions } from "cc-harness";
import type { CompactOutcome, RawContextUsage } from "cc-harness";

/** The subset of the lib Session the REPL drives (the real Session satisfies this). */
export interface ChatSession {
  submit(prompt: string, onMessage: (m: unknown) => void): Promise<{ result: unknown }>;
  setPermissionMode(mode: string): Promise<void>;
  setModel(model?: string): Promise<void>;
  compact(): Promise<CompactOutcome>;
  interrupt(): Promise<void>;
  getContextUsage(): Promise<unknown>;
  dispose(): Promise<void>;
  readonly sessionId?: string;
}
export interface SessionInfo { sessionId: string; summary: string; firstPrompt?: string; lastModified: number }
export interface Pending { req: PermissionRequest; resolve: (d: PermissionDecision) => void; }
export interface ChatState { lines: RenderLine[]; streaming: RenderLine[]; pending: Pending | null; mode: string; busy: boolean; ctxPct?: number; model?: string; picker: { open: boolean; sessions: SessionInfo[] }; }

const OTHER_POLE: Record<string, string> = { default: "bypassPermissions", bypassPermissions: "default" };

export function useChat(makeSession: (resume?: string) => ChatSession, ui: UiBrokerHandle, opts: { initialMode?: string } = {}, deps: { listSessions: () => Promise<SessionInfo[]> } = { listSessions: () => realListSessions({ limit: 30 }) as Promise<SessionInfo[]> }) {
  const [session, setSession] = useState<ChatSession>(() => makeSession());
  const [lines, setLines] = useState<RenderLine[]>([]);
  const [streaming, setStreaming] = useState<RenderLine[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [mode, setMode] = useState(opts.initialMode ?? "default");
  const [busy, setBusy] = useState(false);
  const [ctxPct, setCtxPct] = useState<number | undefined>(undefined);
  const [model, setModel] = useState<string | undefined>(undefined);
  const [picker, setPicker] = useState<{ open: boolean; sessions: SessionInfo[] }>({ open: false, sessions: [] });
  const disposed = useRef(false);
  const pendingRef = useRef<Pending | null>(null);
  pendingRef.current = pending;

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
        default: append(formatUnknown(cmd.name));
      }
    } catch (e) { append([{ text: `✗ ${(e as Error).message}`, color: "red" }]); }
  }

  async function openPicker() {
    try { const sessions = await deps.listSessions(); if (!disposed.current) setPicker({ open: true, sessions }); }
    catch (e) { append([{ text: `✗ ${(e as Error).message}`, color: "red" }]); }
  }
  function closePicker() { if (!disposed.current) setPicker({ open: false, sessions: [] }); }
  function pickSession(info: SessionInfo) {
    if (disposed.current) return;
    setSession(makeSession(info.sessionId));                       // effect disposes the old, wires the new
    setStreaming([]);
    setLines(formatResumed(info.summary || info.firstPrompt || "session", info.sessionId));
    setPicker({ open: false, sessions: [] });
  }

  function submit(prompt: string) {
    if (disposed.current || busy || !prompt.trim()) return;
    const cmd = parseCommand(prompt);
    if (cmd) { void handleCommand(cmd); return; }
    setLines((l) => [...l, { text: `› ${prompt}`, dim: true }]);
    setStreaming([]); setBusy(true);
    const lt = new LiveTurn();
    session.submit(prompt, (m) => { if (disposed.current) return; lt.ingest(m); setStreaming(lt.snapshot()); })
      .then(() => {}, (e) => { lt.fail((e as Error).message); })
      .finally(() => { if (disposed.current) return; setLines((l) => [...l, ...lt.finalize()]); setStreaming([]); setBusy(false); if (lt.model) setModel(lt.model); void refreshCtx(); });
  }
  function resolvePermission(d: PermissionDecision) { pendingRef.current?.resolve(d); setPending(null); }
  function cycleMode() { const next = OTHER_POLE[mode] ?? "default"; void session.setPermissionMode(next).catch(() => {}); if (!disposed.current) setMode(next); }
  function interrupt() { void session.interrupt().catch(() => {}); }

  return { state: { lines, streaming, pending, mode, busy, ctxPct, model, picker } as ChatState, submit, resolvePermission, cycleMode, interrupt, closePicker, pickSession };
}
