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
// WHAT CONCURRENCY BUYS AND WHAT IT DOES NOT. Two app-server processes can hold one sessionId — nothing
// stops two `serve` processes resuming the same session — so the claims here are scoped to what the code
// delivers against that. For ENTRY FILES: temp-then-rename, so no reader sees a torn entry and no writer
// clobbers another's (one file per entry, not one appended JSONL, and no lock needed for either). For the
// COUNT: exact under any number of writers that ACQUIRE THE LOCK, and loudly degraded for a writer that
// cannot. Bumping `dropped` is a read-modify-write, and the losing half of a lost update leaves bytes
// identical to the winner's — measured: 22 of 25 ordinary two-process runs ended with a count too small
// and nothing to show for it. No read-back can see that, so the marker's RMW is serialised by a lock
// instead (`markerLock` below); a writer that cannot take it inside a bounded wait declines to guess and
// latches degraded, which is the honest "I cannot tell you" that a silent under-report was not.
//
// None of it is a durability claim: power loss before the metadata flush can take the newest entries, and
// the spec claims exactly atomic visibility, an over-report-safe count, and a degraded signal as durable
// as the store it describes — nothing more.
import { createHash } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
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

/** The canonical lock in this codebase is `withFileLock` (appserver/configWrite.ts, M5's lock wave), and
 *  its doctrine is what the two rules below borrow: an exclusive CREATE is the claim, and a lease is what
 *  makes a dead holder's leftover recoverable rather than permanent. It is not consumed here because it
 *  is async and `append` is synchronous by contract — the observer calls it on the read loop. So this is
 *  the minimal sync sibling, and deliberately much weaker: no nonce, no republished lease, no fencing,
 *  because the section it guards is microseconds of marker read-modify-write rather than a config commit,
 *  and the failure it must prevent (a lost `dropped` increment) is answered by exclusion alone. Where
 *  withFileLock BLOCKS and then breaks a stale claim, this one gives up quickly and reports: see `append`. */
const LOCK_FILE = ".marker.lock";
/** A holder is microseconds; anything this old is a corpse, and its leftover would otherwise wedge every
 *  later append on the session. withFileLock's lease, minus the republishing. */
const LOCK_STALE_MS = 5_000;
/** A WALL-CLOCK budget, not an attempt count: `sleepSync(2)` really sleeps ~15ms at the platform's timer
 *  granularity, so counting attempts bought an 8x longer stall than it looked like it did. The hold window
 *  is microseconds, so anything still held after this is a peer we should not wait on. */
const LOCK_WAIT_MS = 40;
const LOCK_RETRY_MS = 1;

/** Blocking the read loop is the one thing this file will not do, so the wait is bounded and tiny — and
 *  `Atomics.wait` rather than a spin, so waiting costs no CPU. */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** The fd on success, `null` when a live holder outlasted the bounded wait. Contention never throws; a
 *  real filesystem failure (EACCES on the directory, say) still propagates, which is `append`'s existing
 *  contract. */
function acquireMarkerLock(dir: string): number | null {
  const path = join(dir, LOCK_FILE);
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try { return openSync(path, "wx", 0o600); } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
    // Break a corpse's claim, and only a corpse's: a live holder's file is younger than the lease.
    try { if (Date.now() - statSync(path).mtimeMs > LOCK_STALE_MS) unlinkSync(path); } catch { /* raced */ }
    if (Date.now() >= deadline) return null;
    sleepSync(LOCK_RETRY_MS);
  }
}

function releaseMarkerLock(dir: string, fd: number): void {
  try { closeSync(fd); } catch { /* the unlink below is what actually releases it */ }
  unlinkIfPresent(join(dir, LOCK_FILE));
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

  /** Write, then read back — an INVARIANT ASSERTION now, not the mechanism. The lock is what keeps the
   *  count exact; this only catches a writer that ignored the lock, which the read-back can see precisely
   *  because such a writer had no reason to land on the same value we did. It cannot see a lock-respecting
   *  competitor's lost update, whose bytes are identical to ours — which is why a read-back was the wrong
   *  guard for that window and a lock is the right one. On a mismatch the count is no longer ours to vouch
   *  for: latch degraded, adopt THEIR state rather than our stale one, and carry the flag forward so the
   *  rest of this eviction cannot erase it. */
  const writeMarkerChecked = (dir: string, sessionId: string, s: MarkerState): MarkerState => {
    writeMarker(dir, s);
    const back = readMarker(sessionId);
    if (back.dropped === s.dropped) return s;
    degradedLatch.add(sessionId);
    const merged: MarkerState = { ...back, degraded: true };
    try { writeMarker(dir, merged); } catch { /* the latch stands; the flag is best-effort as ever */ }
    return merged;
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
   *  otherwise reach the projector as an item whose every field is undefined (roster.ts's rule). The
   *  `anchor` KEY has to be present, not merely nullable: a file missing it reads as neither confirmed
   *  empty nor anchored, collapsing the two states the type above exists to keep apart. */
  const readEntry = (dir: string, file: string): ArrivalEntry | null => {
    let parsed: unknown;
    try { parsed = JSON.parse(readFileSync(join(dir, file), "utf8")); } catch { return null; }
    const e = parsed as ArrivalEntry;
    const ok = e && typeof e === "object" && e.v === 1 && "anchor" in e
      && typeof e.id === "string" && typeof e.sessionId === "string"
      && typeof e.seq === "number" && typeof e.text === "string";
    return ok ? e : null;
  };

  /** One degrade path for every reason to take it: latch in memory, then best-effort merge the flag into
   *  the marker. That merge is itself an unlocked read-modify-write and can clobber a concurrent writer's
   *  count — taken knowingly, because all it can do is set a flag telling every reader, in this process
   *  and any other, that this session's numbers are not to be trusted. */
  const degrade = (sessionId: string): void => {
    degradedLatch.add(sessionId);
    const dir = dirOf(sessionId);
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      writeMarker(dir, { ...readMarker(sessionId), degraded: true });
    } catch { /* the latch above is the fallback, and the spec states it dies with the process */ }
  };

  const entryFileName = (e: ArrivalEntry) => `e-${String(e.seq).padStart(6, "0")}-${e.id}.json`;

  return {
    append(e: ArrivalEntry): void {
      const dir = dirOf(e.sessionId);
      mkdirSync(dir, { recursive: true, mode: 0o700 });

      // The lock goes on BEFORE the first marker read: a base value read outside it is one another writer
      // may already have superseded, and that is the entire lost update.
      const lock = acquireMarkerLock(dir);
      if (lock === null) {
        // Loud beats blocked, blocked beats wrong, and wrong is forbidden. The message is real and its
        // entry file needs no lock (rename is the only exclusion it wants), so the entry still lands;
        // what cannot be done exactly is the count, so the count stops claiming to be exact.
        writeAtomic(dir, entryFileName(e), JSON.stringify(e));
        degrade(e.sessionId);
        return;
      }

      try {
        let marker = readMarker(e.sessionId);   // read UNDER the lock: an unlocked base is not a base

        // Recovery, before anything else and idempotent: the marker still names a victim, so the crash
        // landed between counting it and deleting it. Delete it now WITHOUT counting it again.
        if (marker.pending) {
          unlinkIfPresent(join(dir, marker.pending));
          marker = writeMarkerChecked(dir, e.sessionId, { ...marker, pending: undefined });
        }

        writeAtomic(dir, entryFileName(e), JSON.stringify(e));

        // Marker-then-victim. `seqHigh` rides along so `nextSeq` still knows how far the log got after
        // the entry that proved it is gone; `pending` is cleared once, after the last unlink.
        let files = listFiles(dir);
        if (files.length <= ARRIVAL_LOG_CAP) return;
        while (files.length > ARRIVAL_LOG_CAP) {
          const victim = files[0];
          marker = writeMarkerChecked(dir, e.sessionId, {
            ...marker,
            dropped: marker.dropped === null ? null : marker.dropped + 1,
            seqHigh: Math.max(marker.seqHigh, files[files.length - 1].seq),
            pending: victim.file,
          });
          unlinkIfPresent(join(dir, victim.file));
          files = files.slice(1);
        }
        writeMarkerChecked(dir, e.sessionId, { ...marker, pending: undefined });
      } finally {
        releaseMarkerLock(dir, lock);
      }
    },

    /** The cap is EVENTUALLY at most `ARRIVAL_LOG_CAP`, not always: a crash partway through a multi-victim
     *  eviction leaves the surplus on disk until the next `append` sheds it. Consumers must not treat the
     *  returned length as a hard bound. */
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
      degrade(sessionId);
    },
  };
}
