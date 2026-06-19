// tui/src/useChat.ts — owns the in-process Session (default mode), the transcript, the streaming turn, the
// late-bound permission broker, mode switching, and idempotent teardown.
import { useEffect, useRef, useState } from "react";
import type { PermissionDecision, PermissionRequest } from "cc-harness";
import type { RenderLine } from "./render.js";
import { LiveTurn } from "./liveTurn.js";
import type { UiBrokerHandle } from "./uiBroker.js";

/** The subset of the lib Session the REPL drives (the real Session satisfies this). */
export interface ChatSession {
  submit(prompt: string, onMessage: (m: unknown) => void): Promise<{ result: unknown }>;
  setPermissionMode(mode: string): Promise<void>;
  interrupt(): Promise<void>;
  getContextUsage(): Promise<unknown>;
  dispose(): Promise<void>;
  readonly sessionId?: string;
}
export interface Pending { req: PermissionRequest; resolve: (d: PermissionDecision) => void; }
export interface ChatState { lines: RenderLine[]; streaming: RenderLine[]; pending: Pending | null; mode: string; busy: boolean; ctxPct?: number; model?: string; }

const OTHER_POLE: Record<string, string> = { default: "bypassPermissions", bypassPermissions: "default" };

export function useChat(makeSession: (resume?: string) => ChatSession, ui: UiBrokerHandle, opts: { initialMode?: string } = {}) {
  const [session, setSession] = useState<ChatSession>(() => makeSession());
  const [lines, setLines] = useState<RenderLine[]>([]);
  const [streaming, setStreaming] = useState<RenderLine[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [mode, setMode] = useState(opts.initialMode ?? "default");
  const [busy, setBusy] = useState(false);
  const [ctxPct, setCtxPct] = useState<number | undefined>(undefined);
  const [model, setModel] = useState<string | undefined>(undefined);
  const disposed = useRef(false);
  const pendingRef = useRef<Pending | null>(null);
  pendingRef.current = pending;

  useEffect(() => {
    ui.setHandler((req) => new Promise<PermissionDecision>((resolve) => {
      if (disposed.current) return resolve({ kind: "deny" });
      setPending({ req, resolve });
    }));
    return () => {
      disposed.current = true;
      ui.setHandler(null);
      pendingRef.current?.resolve({ kind: "deny" }); // never leave the SDK await hanging
      void session.dispose().catch(() => {});
    };
  }, [session, ui]);

  async function refreshCtx() {
    try {
      const u = (await session.getContextUsage()) as { totalTokens?: number; maxTokens?: number };
      if (!disposed.current && u?.maxTokens) setCtxPct(Math.round(((u.totalTokens ?? 0) / u.maxTokens) * 100));
    } catch { /* best-effort */ }
  }

  function submit(prompt: string) {
    if (disposed.current || busy || !prompt.trim()) return;
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

  return { state: { lines, streaming, pending, mode, busy, ctxPct, model } as ChatState, submit, resolvePermission, cycleMode, interrupt };
}
