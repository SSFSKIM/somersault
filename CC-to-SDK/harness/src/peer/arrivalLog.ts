// src/peer/arrivalLog.ts — the durable side of an arrival: what the observer wrote down at the moment a
// peer message landed, so a later `thread/read` can put it back where it happened.
//
// Two properties earn the filesystem here, and nothing else does. (1) `seq` must keep counting across a
// restart: the entry's content fixes its position, which is only true if the counter is seeded from the
// store rather than from this process. (2) The count a client checks completeness against must never come
// out SHORT. Everything below follows from that second rule, and it is why the store makes no inference
// from `seq` values — two processes on one session can both read `nextSeq` before either appends, so seqs
// are not reliably increasing and anything derived from them (a "dropped horizon", say) under-reports
// exactly when concurrency makes it matter. Instead the MARKER NAMES ITS VICTIM: eviction records the
// filename, unlinks it, then clears the name. A crash inside that window leaves the victim both visible
// and counted dropped — an over-report by exactly one, which reveals a gap that isn't there; the reverse
// would falsely certify a complete history. The direction is chosen, and the file is arranged around it.
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
  /** Meaningful only while `isDegraded` is false. A session whose marker is unreadable cannot say how
   *  many entries it shed, and the caller must render `arrivals: null` rather than these numbers. */
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

/** The marker as this process holds it. `dropped: null` is UNKNOWN — the file exists but does not parse
 *  (a zero-length marker is the ordinary shape of power loss on ext4) — and unknown is not zero: calling
 *  it zero would under-report, and writing that zero back would destroy the real count. A session in that
 *  state is degraded, and every write from here on omits `dropped`/`seqHigh` rather than inventing them. */
interface MarkerState { dropped: number | null; seqHigh: number; pending?: string; degraded: boolean }
const PRISTINE: MarkerState = { dropped: 0, seqHigh: -1, degraded: false };
const UNREADABLE: MarkerState = { dropped: null, seqHigh: -1, degraded: true };

const ENTRY_FILE = /^e-(\d{6})-(.+)\.json$/;
const MARKER_FILE = "marker.json";

function defaultRoot(): string {
  return join(homedir(), ".claude", "cc-harness", "arrivals");
}

/** 0o600/0o700 are not decoration: an entry holds the full text of a peer message, and these files
 *  outlive the session that wrote them. House convention (fleet/roster.ts, tui/pasteCache.ts). */
function writeAtomic(dir: string, name: string, body: string): void {
  // Temp inside the SAME directory — rename is only atomic within a filesystem, and a temp in
  // `os.tmpdir()` is not guaranteed to share one with `~/.claude`.
  const tmp = join(dir, `.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`);
  writeFileSync(tmp, body, { mode: 0o600 });
  renameSync(tmp, join(dir, name));
}

/** A victim another process already removed is a success, not a failure — the point is that it is gone. */
function unlinkIfPresent(path: string): void {
  try { unlinkSync(path); } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

export function fsArrivalStore(rootDir: string = defaultRoot()): ArrivalStore {
  // The latch survives a marker this process could not write or read (one fault domain usually took
  // both). It does NOT survive a restart — stated as a limit in the spec, not an oversight.
  const degradedLatch = new Set<string>();
  const dirOf = (sessionId: string) => join(rootDir, sessionId);

  /** ABSENT and UNREADABLE are different answers. No marker file means a session that has never evicted:
   *  zero dropped is the truth. A marker that will not parse means the count is lost, which is degraded. */
  const readMarker = (sessionId: string): MarkerState => {
    let raw: string;
    try {
      raw = readFileSync(join(dirOf(sessionId), MARKER_FILE), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return { ...PRISTINE };
      degradedLatch.add(sessionId);
      return { ...UNREADABLE };
    }
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { parsed = undefined; }
    const m = parsed as Partial<{ dropped: number; seqHigh: number; pending: string; degraded: true }>;
    if (!m || typeof m !== "object" || typeof m.dropped !== "number") {
      // Includes the marker markDegraded writes over an unreadable one: `{ degraded: true }` and no
      // count, which re-reads as unknown — self-consistent, and still honest about what was lost.
      degradedLatch.add(sessionId);
      return { ...UNREADABLE, ...(typeof m?.pending === "string" ? { pending: m.pending } : {}) };
    }
    return {
      dropped: m.dropped,
      seqHigh: typeof m.seqHigh === "number" ? m.seqHigh : -1,
      ...(typeof m.pending === "string" ? { pending: m.pending } : {}),
      degraded: m.degraded === true,
    };
  };

  const writeMarker = (dir: string, s: MarkerState): void => {
    const body = s.dropped === null
      ? { degraded: true as const, ...(s.pending ? { pending: s.pending } : {}) }
      : {
          dropped: s.dropped, seqHigh: s.seqHigh,
          ...(s.pending ? { pending: s.pending } : {}),
          ...(s.degraded ? { degraded: true as const } : {}),
        };
    writeAtomic(dir, MARKER_FILE, JSON.stringify(body));
  };

  /** Every entry file in the directory, in `(seq, id)` order — which `readdirSync().sort()` gives for
   *  free, because the name embeds a zero-padded seq ahead of the id. Nothing here parses a body, and
   *  nothing here judges a seq: what is on disk is retained, full stop. */
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

  /** "Skip unparseable entries" has to cover "parsed, but not an entry" — a stray `[]` or `123` would
   *  otherwise reach the projector as an item whose every field is undefined (roster.ts's rule). */
  const readEntry = (dir: string, file: string): ArrivalEntry | null => {
    let parsed: unknown;
    try { parsed = JSON.parse(readFileSync(join(dir, file), "utf8")); } catch { return null; }
    const e = parsed as ArrivalEntry;
    const ok = e && typeof e === "object" && e.v === 1
      && typeof e.id === "string" && typeof e.sessionId === "string"
      && typeof e.seq === "number" && typeof e.text === "string";
    return ok ? e : null;
  };

  return {
    append(e: ArrivalEntry): void {
      const dir = dirOf(e.sessionId);
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      let marker = readMarker(e.sessionId);

      // Recovery, before anything else and idempotent: the marker still names a victim, so the crash
      // landed between counting it and deleting it. Delete it now WITHOUT counting it again.
      if (marker.pending) {
        unlinkIfPresent(join(dir, marker.pending));
        marker = { ...marker, pending: undefined };
        writeMarker(dir, marker);
      }

      writeAtomic(dir, `e-${String(e.seq).padStart(6, "0")}-${e.id}.json`, JSON.stringify(e));

      // Marker-then-victim. `seqHigh` rides along so `nextSeq` still knows how far the log got after the
      // entry that proved it is gone; `pending` is cleared once, after the last unlink.
      let files = listFiles(dir);
      if (files.length <= ARRIVAL_LOG_CAP) return;
      while (files.length > ARRIVAL_LOG_CAP) {
        const victim = files[0];
        marker = {
          ...marker,
          dropped: marker.dropped === null ? null : marker.dropped + 1,
          seqHigh: Math.max(marker.seqHigh, files[files.length - 1].seq),
          pending: victim.file,
        };
        writeMarker(dir, marker);
        unlinkIfPresent(join(dir, victim.file));
        files = files.slice(1);
      }
      writeMarker(dir, { ...marker, pending: undefined });
    },

    readAll(sessionId: string): ArrivalEntry[] {
      const dir = dirOf(sessionId);
      const out: ArrivalEntry[] = [];
      for (const f of listFiles(dir)) {
        const entry = readEntry(dir, f.file);
        if (entry) out.push(entry);
      }
      return out;
    },

    /** `logged` is the PRE-eviction total: what the session actually received, which is the only number a
     *  client can check its own completeness against. An unknown `dropped` reads as 0 here, which would
     *  under-report — hence the contract above: this pair is void while `isDegraded` is true. */
    counts(sessionId: string): ArrivalCounts {
      const marker = readMarker(sessionId);
      const dropped = marker.dropped ?? 0;
      return { logged: listFiles(dirOf(sessionId)).length + dropped, dropped };
    },

    nextSeq(sessionId: string): number {
      const marker = readMarker(sessionId);
      const files = listFiles(dirOf(sessionId));
      const maxOnDisk = files.length > 0 ? Math.max(...files.map((f) => f.seq)) : -1;
      return Math.max(maxOnDisk, marker.seqHigh) + 1;
    },

    isDegraded(sessionId: string): boolean {
      return degradedLatch.has(sessionId) || readMarker(sessionId).degraded;
    },

    /** Best-effort on disk, unconditional in memory: the fault that made the store fail is often the same
     *  one that stops us recording that it failed, and this process must still abstain from a count.
     *  Read-modify-write PRESERVES whatever the marker already knew — and when it knew nothing (unknown
     *  `dropped`), writes the flag alone rather than a fabricated zero. */
    markDegraded(sessionId: string): void {
      degradedLatch.add(sessionId);
      const dir = dirOf(sessionId);
      try {
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        writeMarker(dir, { ...readMarker(sessionId), degraded: true });
      } catch { /* the latch above is the fallback, and the spec states it dies with the process */ }
    },
  };
}
