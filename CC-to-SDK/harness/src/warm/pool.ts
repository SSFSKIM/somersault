// W3.2 — warm-spawn pool over startup()/WarmQuery (probe 40: warm handle init@51ms vs 602ms cold —
// the pre-warmed subprocess has already completed its initialize handshake).
//
// The constraint that shapes everything here: startup({options}) FREEZES the full Options at warm
// time, and WarmQuery.query(prompt) takes only the prompt. So:
// - a warm slot serves only sessions whose options equal the pool's (the daemon matches spawn cfg
//   before taking; lib callers must not pass divergent options — the queryFn IGNORES them);
// - parent-side callbacks are frozen too. The pool therefore warms with a DELEGATING canUseTool
//   that forwards to a per-slot holder bound at checkout (take({canUseTool})). Unbound, it falls
//   back to the base config's broker, else fails CLOSED (deny) — never allow-by-default. In
//   auto/bypassPermissions modes the callback is broker-replaced by the SDK and never consulted.
import { startup as sdkStartup } from "@anthropic-ai/claude-agent-sdk";
import { resolveOptions } from "../config/resolveOptions.js";
import type { HarnessConfig } from "../config/types.js";

type CanUseTool = (name: string, input: unknown, opts?: unknown) => Promise<unknown>;
export interface WarmHandle { query(prompt: unknown): unknown; close(): void; }
export type StartupFn = (params: { options: Record<string, unknown> }) => Promise<WarmHandle>;
export interface WarmPoolOpts {
  size?: number;                                   // default 2
  deps?: { startup?: StartupFn };                  // DI (unit tests)
  onWarmError?: (e: Error) => void;                // a failed warm is dropped; next take() re-fills
}
export interface WarmLease {
  /** Session-compatible QueryFn. NOTE: the options argument is IGNORED — the subprocess already
   *  runs with the pool's frozen options. Only pair with configs that match the pool's. */
  queryFn: (params: { prompt: unknown; options?: unknown }) => unknown;
  /** Discard the lease without sending a prompt (closes the underlying subprocess). */
  discard(): void;
}
export interface WarmPoolStats { warm: number; pending: number; taken: number; misses: number; }

interface Slot { handle: WarmHandle; holder: { broker?: CanUseTool }; }

export interface WarmPool {
  /** Pop a warm slot, binding a per-session broker to its frozen delegate. Null when empty (cold-spawn instead). */
  take(bindings?: { canUseTool?: CanUseTool }): WarmLease | null;
  stats(): WarmPoolStats;
  /** Discard all warm slots; in-flight warms are closed on arrival; take() returns null forever after. */
  close(): void;
}

export function createWarmPool(config: HarnessConfig, opts: WarmPoolOpts = {}): WarmPool {
  const size = opts.size ?? 2;
  const startupFn = opts.deps?.startup ?? (sdkStartup as unknown as StartupFn);
  const slots: Slot[] = [];
  let pending = 0, taken = 0, misses = 0, closed = false;

  const base = resolveOptions(config);
  const baseBroker = base.canUseTool as CanUseTool | undefined;

  const spawnSlot = () => {
    const holder: Slot["holder"] = {};
    const options: Record<string, unknown> = {
      ...base,
      canUseTool: async (name: string, input: unknown, o?: unknown) => {
        const broker = holder.broker ?? baseBroker;
        if (broker) return broker(name, input, o);
        return { behavior: "deny", message: "warm slot has no permission broker bound" }; // fail closed
      },
    };
    pending++;
    startupFn({ options })
      .then((handle) => { pending--; if (closed) { try { handle.close(); } catch {} return; } slots.push({ handle, holder }); })
      .catch((e) => { pending--; opts.onWarmError?.(e as Error); });
  };
  const refill = () => { if (!closed) while (slots.length + pending < size) spawnSlot(); };
  refill();

  return {
    take(bindings) {
      const slot = slots.shift();
      refill(); // top up regardless — a miss means demand outran the pool
      if (!slot) { misses++; return null; }
      taken++;
      slot.holder.broker = bindings?.canUseTool;
      let used = false;
      return {
        queryFn: (params) => { used = true; return slot.handle.query(params.prompt); },
        discard: () => { if (!used) try { slot.handle.close(); } catch {} },
      };
    },
    stats() { return { warm: slots.length, pending, taken, misses }; },
    close() {
      closed = true;
      for (const s of slots.splice(0)) try { s.handle.close(); } catch {}
    },
  };
}
