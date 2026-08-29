// src/peer/arrivalLog.ts — the durable side of an arrival: what the observer wrote down at the moment a
// peer message landed, so a later `thread/read` can put it back where it happened.
//
// Two properties earn the filesystem here, and nothing else does. (1) `seq` must keep counting across a
// restart: the entry's content fixes its position, which is only true if the counter is seeded from the
// store rather than from this process. (2) The count a client checks completeness against must never come
// out SHORT. Everything below follows from that second rule — the cap deletes entries, so eviction writes
// the durable `dropped` marker BEFORE unlinking its victim, and recovery re-unlinks a victim that was
// counted but survived. A crash between those two syscalls can then only over-report, which reveals a gap
// that isn't there; the reverse would falsely certify a complete history. The direction is chosen.
//
// One file per entry, temp-then-rename — not one appended JSONL. Rename gives atomic visibility (no
// reader ever sees a torn entry, no interleaving between two app-server processes) without a lock. It is
// NOT a durability claim: power loss before the metadata flush can take the newest entries, and the spec
// claims exactly atomic visibility, an over-report-safe count, and a degraded signal as durable as the
// store it describes — nothing more.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface ArrivalFingerprint { type: string; hash: string; timestamp?: string }
export interface ArrivalAnchor { afterUuid: string; prevUuid: string | null; fp: ArrivalFingerprint }
export interface ArrivalEntry {
  v: 1; id: string; sessionId: string;
  /** `null` is CONFIRMED EMPTY — the seed read saw zero rows, so the arrival precedes all history. It is
   *  never "unknown": an unknowable position is `ambiguous`, and the two must not collapse. */
  anchor: ArrivalAnchor | null;
  /** Seed-window arrivals, whose order against the first observed frame cannot be known. Persisted and
   *  counted (they are real messages) but never placed. */
  ambiguous?: true;
  seq: number; observedAt: string;
  origin: Record<string, unknown>; text: string;
}
export interface ArrivalCounts { logged: number; dropped: number }
export interface ArrivalStore {
  /** Synchronous and throwing by design: the caller (the observer, on the read loop) catches and latches
   *  degraded, because a swallowed failure would leave a history gap nothing reports. */
  append(e: ArrivalEntry): void;
  readAll(sessionId: string): ArrivalEntry[];
  counts(sessionId: string): ArrivalCounts;
  nextSeq(sessionId: string): number;
  isDegraded(sessionId: string): boolean;
  markDegraded(sessionId: string): void;
}

/** Mirrors `peerInbound.ts`'s `MAX_ARRIVALS` deliberately (spec: Bounds). Same attacker-influenced input,
 *  same answer; this cap bounds what arrivals add to a last-resort page, and only that. */
export const ARRIVAL_LOG_CAP = 32;

/** The anchor's content fingerprint. 16 hex chars = 64 bits: enough that two adjacent rows in one session
 *  colliding is not a real event, short enough that the entry stays small. */
export function contentHash16(rawText: string): string {
  return createHash("sha256").update(rawText, "utf8").digest("hex").slice(0, 16);
}

/** `seqHigh: -1` for a store that has never been written, so `nextSeq` on an empty session is 0. */
interface Marker { dropped: number; seqHigh: number; degraded?: true }
const EMPTY_MARKER: Marker = { dropped: 0, seqHigh: -1 };

const ENTRY_FILE = /^e-(\d{6})-(.+)\.json$/;

function defaultRoot(): string {
  return join(homedir(), ".claude", "cc-harness", "arrivals");
}

/** Written temp-then-rename inside the SAME directory — rename is only atomic within a filesystem, and a
 *  temp in `os.tmpdir()` is not guaranteed to share one with `~/.claude`. */
function writeAtomic(dir: string, name: string, body: string): void {
  const tmp = join(dir, `.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`);
  writeFileSync(tmp, body);
  renameSync(tmp, join(dir, name));
}

export function fsArrivalStore(rootDir: string = defaultRoot()): ArrivalStore {
  // The latch survives a marker this process could not write (the same fault domain usually took both).
  // It does NOT survive a restart — stated as a limit in the spec, not an oversight.
  const degradedLatch = new Set<string>();
  const dirOf = (sessionId: string) => join(rootDir, sessionId);

  const readMarker = (dir: string): Marker => {
    try {
      const m = JSON.parse(readFileSync(join(dir, "marker.json"), "utf8")) as Partial<Marker>;
      return {
        dropped: typeof m.dropped === "number" ? m.dropped : 0,
        seqHigh: typeof m.seqHigh === "number" ? m.seqHigh : -1,
        ...(m.degraded === true ? { degraded: true as const } : {}),
      };
    } catch {
      return { ...EMPTY_MARKER };
    }
  };

  /** Every entry file in the directory, in `(seq, id)` order — which `readdirSync().sort()` gives for
   *  free, because the name embeds a zero-padded seq ahead of the id. Nothing here parses a body. */
  const listFiles = (dir: string): Array<{ file: string; seq: number }> => {
    let names: string[];
    try { names = readdirSync(dir); } catch { return []; }
    const out: Array<{ file: string; seq: number }> = [];
    for (const file of names.sort()) {
      const m = ENTRY_FILE.exec(file);
      if (m) out.push({ file, seq: Number(m[1]) });
    }
    return out;
  };

  /** RETAINED means "not already counted dropped". Seqs are dense from zero within a session (the
   *  producer seeds from `nextSeq`), so the first `marker.dropped` of them are the evicted ones — and a
   *  file below that horizon is a victim whose unlink did not land. Readers must not show it: it is
   *  already inside `dropped`, so counting it again would make `logged` describe a history that never
   *  existed. `append` deletes it for real; readers merely refuse to see it. */
  const retained = (dir: string, marker: Marker) => listFiles(dir).filter((f) => f.seq >= marker.dropped);

  const readEntry = (dir: string, file: string): ArrivalEntry | null => {
    try { return JSON.parse(readFileSync(join(dir, file), "utf8")) as ArrivalEntry; } catch { return null; }
  };

  return {
    append(e: ArrivalEntry): void {
      const dir = dirOf(e.sessionId);
      mkdirSync(dir, { recursive: true });
      let marker = readMarker(dir);

      // Recovery, before anything else and idempotent: a victim the marker already counted but the crash
      // left behind is unlinked WITHOUT incrementing `dropped` — it was paid for once already.
      for (const f of listFiles(dir)) {
        if (f.seq >= marker.dropped) break;   // (seq, id) order: the horizon is a prefix
        unlinkSync(join(dir, f.file));
      }

      writeAtomic(dir, `e-${String(e.seq).padStart(6, "0")}-${e.id}.json`, JSON.stringify(e));

      // Marker-then-victim, once per eviction. `seqHigh` rides along so `nextSeq` still knows how far the
      // log got after the entry that proved it is gone.
      let files = retained(dir, marker);
      while (files.length > ARRIVAL_LOG_CAP) {
        const victim = files[0];
        marker = { ...marker, dropped: marker.dropped + 1, seqHigh: Math.max(marker.seqHigh, files[files.length - 1].seq) };
        writeAtomic(dir, "marker.json", JSON.stringify(marker));
        unlinkSync(join(dir, victim.file));
        files = files.slice(1);
      }
    },

    readAll(sessionId: string): ArrivalEntry[] {
      const dir = dirOf(sessionId);
      const out: ArrivalEntry[] = [];
      for (const f of retained(dir, readMarker(dir))) {
        const entry = readEntry(dir, f.file);
        if (entry) out.push(entry);
      }
      return out;
    },

    /** `logged` is the PRE-eviction total: what the session actually received, which is the only number a
     *  client can check its own completeness against. */
    counts(sessionId: string): ArrivalCounts {
      const dir = dirOf(sessionId);
      const marker = readMarker(dir);
      return { logged: retained(dir, marker).length + marker.dropped, dropped: marker.dropped };
    },

    nextSeq(sessionId: string): number {
      const dir = dirOf(sessionId);
      const marker = readMarker(dir);
      const files = retained(dir, marker);
      const maxRetained = files.length > 0 ? files[files.length - 1].seq : -1;
      return Math.max(maxRetained, marker.seqHigh) + 1;
    },

    isDegraded(sessionId: string): boolean {
      return degradedLatch.has(sessionId) || readMarker(dirOf(sessionId)).degraded === true;
    },

    /** Best-effort on disk, unconditional in memory: the fault that made the store fail is often the same
     *  one that stops us recording that it failed, and this process must still abstain from a count. */
    markDegraded(sessionId: string): void {
      degradedLatch.add(sessionId);
      const dir = dirOf(sessionId);
      try {
        mkdirSync(dir, { recursive: true });
        writeAtomic(dir, "marker.json", JSON.stringify({ ...readMarker(dir), degraded: true }));
      } catch { /* the latch above is the fallback, and the spec states it dies with the process */ }
    },
  };
}
