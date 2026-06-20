import { useCallback, useEffect, useRef, useState } from "react";
import { collect, resolveAutoModel } from "cc-harness";
import type { DaemonClient, DashboardSnapshot, SessionRow, PendingEntry, PermissionDecision } from "cc-harness";
import { THINK_LEVELS, thinkBudget } from "./thinkLevels.js";

const PERMISSION_MODES = ["default", "acceptEdits", "bypassPermissions", "plan", "dontAsk", "auto"] as const;
const EMPTY: DashboardSnapshot = { daemonUp: false, sessions: [], at: 0, pending: [] };
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const modelId = (m: unknown) => (typeof m === "string" ? m : ((m as any)?.value ?? (m as any)?.id ?? (m as any)?.model ?? String(m)));

export interface UseDaemonOpts {
  intervalMs?: number;
  schedule?: (fn: () => void, ms: number) => () => void;
  now?: () => number;
}

export interface DaemonView {
  snapshot: DashboardSnapshot;
  selectedIndex: number;
  selected?: SessionRow;
  focus: "list" | "input";
  stream: unknown[];
  status: string;
  select(delta: number): void;
  focusInput(): void;
  focusList(): void;
  submit(prompt: string): void;
  interrupt(): void;
  cycleModel(): void;
  cyclePermissionMode(): void;
  cycleThinking(): void;
  compact(): void;
  fork(): void;
  toggleProactive(): void;
  spawn(): void;
  stop(id?: string): void;
  teardown(): void;
  pending: PendingEntry[];
  respond(toolUseID: string, decision: PermissionDecision): void;
}

export function useDaemon(client: DaemonClient, opts: UseDaemonOpts = {}): DaemonView {
  const intervalMs = opts.intervalMs ?? 1000;
  const now = opts.now ?? Date.now;
  const schedule = opts.schedule ?? ((fn, ms) => { const t = setInterval(fn, ms); return () => clearInterval(t); });

  const [snapshot, setSnapshot] = useState<DashboardSnapshot>(EMPTY);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [focus, setFocus] = useState<"list" | "input">("list");
  const [stream, setStream] = useState<unknown[]>([]);
  const [status, setStatus] = useState("");

  const disposed = useRef(false);
  const inFlight = useRef(false);
  const cancelRef = useRef<() => void>(() => {});
  const pmIndex = useRef(0);
  const thinkIndex = useRef(0);
  const models = useRef<{ list: string[]; idx: number } | undefined>(undefined);

  const rows = snapshot.sessions;
  const idx = rows.length ? Math.min(selectedIndex, rows.length - 1) : 0;
  const selected = rows[idx];

  const tick = useCallback(async () => {
    if (inFlight.current || disposed.current) return;
    inFlight.current = true;
    try { const s = await collect(client, { now }); if (!disposed.current) setSnapshot(s); }
    finally { inFlight.current = false; }
  }, [client, now]);

  const teardown = useCallback(() => {
    if (disposed.current) return;     // idempotent: explicit quit + unmount collapse to one teardown
    disposed.current = true;
    cancelRef.current();
  }, []);

  useEffect(() => {
    void tick();                                          // immediate first paint
    cancelRef.current = schedule(() => void tick(), intervalMs);
    return () => { teardown(); };                         // unmount → teardown (cancel poll once)
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // run an op against the selected session; settle status (string on success, error text on failure); drop after teardown
  const run = useCallback((label: string, fn: (id: string) => Promise<string>) => {
    const id = selected?.id;
    if (!id) { setStatus("no session selected"); return; }
    fn(id).then((s) => { if (!disposed.current) setStatus(s); })
          .catch((e) => { if (!disposed.current) setStatus(`${label}: ${msg(e)}`); });
  }, [selected?.id]);

  const ctl = (label: string, frame: any) => (id: string) =>
    client.control(id, frame).then((r) => (r.ok ? label : `error: ${(r as any).error ?? "failed"}`));

  const select = useCallback((delta: number) => {
    setSelectedIndex((i) => { const n = rows.length; if (!n) return 0; return (((i + delta) % n) + n) % n; });
    models.current = undefined;                           // reset the model-cycle cache on selection change
    pmIndex.current = 0;                                  // reset permission-mode cursor on selection change
    thinkIndex.current = 0;                               // reset thinking cursor on selection change (mirror pmIndex)
  }, [rows.length]);

  const focusInput = useCallback(() => setFocus("input"), []);
  const focusList = useCallback(() => setFocus("list"), []);

  const submit = useCallback((prompt: string) => {
    const id = selected?.id; if (!id || !prompt.trim()) return;
    setStream([]); setStatus("submitting…");
    client.submit(id, prompt, (m) => { if (!disposed.current) setStream((s) => [...s, m]); })
      .then(() => { if (!disposed.current) setStatus("done"); })
      .catch((e) => { if (!disposed.current) setStatus(`submit: ${msg(e)}`); });
  }, [selected?.id, client]);

  const interrupt = useCallback(() => run("interrupted", ctl("interrupted", { type: "interrupt" })), [run]);
  const compact = useCallback(() => run("compact", (id) => client.compact(id).then(() => "compacted")), [run, client]);
  const fork = useCallback(() => run("fork", (id) => client.fork(id).then((f) => `forked → ${f.id}`)), [run, client]);

  const cyclePermissionMode = useCallback(() => {
    pmIndex.current = (pmIndex.current + 1) % PERMISSION_MODES.length;
    const mode = PERMISSION_MODES[pmIndex.current];
    if (mode === "auto") {                                  // auto is model-gated (probe 24) — force a supported model first
      const cur = modelId(selected?.model);
      const target = resolveAutoModel(cur);
      if (target !== cur) run(`model=${target}`, ctl(`model=${target}`, { type: "set_model", model: target }));
    }
    run(`mode=${mode}`, ctl(`mode=${mode}`, { type: "set_permission_mode", mode }));
  }, [run, selected?.model]);

  const cycleModel = useCallback(() => {
    const id = selected?.id; if (!id) { setStatus("no session selected"); return; }
    const advance = (list: string[]) => {
      if (!list.length) { setStatus("no models"); return; }
      const next = models.current ? (models.current.idx + 1) % list.length : 0;
      models.current = { list, idx: next };
      run(`model=${list[next]}`, ctl(`model=${list[next]}`, { type: "set_model", model: list[next] }));
    };
    if (models.current) { advance(models.current.list); return; }
    client.control(id, { type: "initialize" }).then((res) => {
      if (disposed.current) return;
      advance((res.ok ? ((res as any).models ?? []) : []).map(modelId));
    }).catch((e) => { if (!disposed.current) setStatus(`initialize: ${msg(e)}`); });
  }, [selected?.id, client, run]);

  const cycleThinking = useCallback(() => {
    thinkIndex.current = (thinkIndex.current + 1) % THINK_LEVELS.length;
    const level = THINK_LEVELS[thinkIndex.current];
    run(`thinking=${level}`, ctl(`thinking=${level}`, { type: "set_thinking", maxTokens: thinkBudget(level) }));
  }, [run]);

  const toggleProactive = useCallback(() => {
    const active = selected?.proactive === "running" || selected?.proactive === "paused";
    run("proactive", (id) => active
      ? client.stopProactive(id).then(() => "proactive stopped")
      : client.startProactive(id).then((st) => `proactive ${st.state}`));
  }, [run, client, selected?.proactive]);

  const spawn = useCallback(() => {
    client.spawn().then((id) => { if (!disposed.current) { setStatus(`spawned ${id}`); void tick(); } })
      .catch((e) => { if (!disposed.current) setStatus(`spawn: ${msg(e)}`); });
  }, [client, tick]);

  const stop = useCallback((id?: string) => {
    const target = id ?? selected?.id;
    if (!target) { setStatus("no session selected"); return; }
    client.stop(target).then(() => { if (!disposed.current) { setStatus("stopped"); void tick(); } })
      .catch((e) => { if (!disposed.current) setStatus(`stop: ${msg(e)}`); });
  }, [selected?.id, client, tick]);

  const respond = useCallback((toolUseID: string, decision: PermissionDecision) => {
    client.respondPermission(toolUseID, decision)
      .then(() => { if (!disposed.current) void tick(); })       // refresh the poll so the dialog clears
      .catch((e) => { if (!disposed.current) setStatus(`respond: ${msg(e)}`); });
  }, [client, tick]);

  return { snapshot, selectedIndex: idx, selected, focus, stream, status, pending: snapshot.pending,
    select, focusInput, focusList, submit, interrupt, cycleModel, cyclePermissionMode, cycleThinking, compact, fork, toggleProactive, spawn, stop, respond, teardown };
}
