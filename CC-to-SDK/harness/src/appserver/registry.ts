// appserver/registry.ts — in-memory thread registry (spec §3.9): id minting + lookup. Per-thread
// serialization lives ON the record (`chain`), not in the registry — the registry is just a map.
import { randomBytes } from "node:crypto";
import type { Peer } from "./peer.js";
import type { ItemEvent } from "./items/types.js";

export type ThreadOrigin = "inProcess"; // fleet adoption is M3

/** The subset of the lib Session the server drives in M1 (structural — the real Session satisfies
 *  this without adapting). */
export interface EngineSession {
  submit(prompt: string, onMessage: (m: unknown) => void): Promise<{ result: unknown }>;
  interrupt(): Promise<unknown>;
  dispose(): Promise<void>;
  onFrame(cb: (m: unknown) => void): () => void;
  readonly sessionId?: string;
}

export interface ThreadRecord {
  id: string;
  origin: ThreadOrigin;
  session: EngineSession;
  unattended: "park" | "deny";
  busy: boolean;
  turnSeq: number;
  interruptRequested: boolean; // set by turn/interrupt; read by the submit-rejection handler to pick "interrupted" vs "failed"
  buffer: ItemEvent[];
  subscribers: Set<Peer>;
  chain: Promise<unknown>;      // serialization scope for thread-scoped methods (record.chain = record.chain.then(...))
  sessionId?: string;
  createdAt: number;            // unix seconds
}

export class Registry {
  private threads = new Map<string, ThreadRecord>();
  mint(): string { return "thr_" + randomBytes(6).toString("hex"); }
  add(r: ThreadRecord): void { this.threads.set(r.id, r); }
  get(id: string): ThreadRecord | undefined { return this.threads.get(id); }
  list(): ThreadRecord[] { return [...this.threads.values()]; }
  delete(id: string): void { this.threads.delete(id); }
}
