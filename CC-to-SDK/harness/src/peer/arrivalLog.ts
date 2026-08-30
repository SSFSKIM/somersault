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
// instead (`acquireMarkerLock` below, which is `withFileLock`'s directory-and-nonce shape rather than a
// smaller one — see its header for why the smaller one reproduced M5's own defect); a writer that cannot
// take it inside a bounded wait declines to guess and latches degraded, which is the honest "I cannot tell
// you" that a silent under-report was not. Degradation is a LATCH: no writer may clear one it did not set.
//
// None of it is a durability claim: power loss before the metadata flush can take the newest entries, and
// the spec claims exactly atomic visibility, an over-report-safe count, and a degraded signal as durable
// as the store it describes — nothing more.
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface ArrivalFingerprint { type: string; hash: string; timestamp?: string }
export interface ArrivalAnchor { afterUuid: string; prevUuid: string | null; fp: ArrivalFingerprint }
export interface ArrivalEntry {
  v: 1; id: string; sessionId: string;
  /** `null` says the arrival PRECEDES EVERY ROW THE SEED RETURNED — it subsumes confirmed-empty (a seed
   *  that saw zero rows) rather than meaning only that, because an arrival grounded on row 0 of a transcript
   *  full of rows records the same sentinel. It is never "unknown": an unknowable position is `ambiguous`,
   *  and the two must not collapse. */
  anchor: ArrivalAnchor | null;
  /** An arrival whose order cannot be known: the seed established no overlap, the buffered frame it was
   *  ordered against was shed by the cap, or the window was torn down before it ever resolved. Persisted
   *  and counted (they are real messages) but never placed.
   *
   *  IT OVERRIDES `anchor`, which is why the two do not collide. A window that never grounded has no ground
   *  to record, so those entries carry `anchor: null` — and the read side checks this flag first and skips,
   *  so that `null` is never read as the statement it would otherwise be. `anchor: null` means
   *  "precedes every row the seed returned" only on an entry this flag is absent from. */
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

/** ARBITRARY WIDTH, and the padding is a compatibility detail rather than a format. Names are still written
 *  six wide, but a session that reaches seq 1,000,000 writes a seventh digit — and a pattern fixed at six
 *  stopped recognising its own entries there: `readAll`, `counts` and `nextSeq` would all skip every entry
 *  past the cliff, freezing the reported count and leaving eviction with nothing to bound. */
const ENTRY_FILE = /^e-(\d+)-(.+)\.json$/;
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
 *  this is its SHAPE ported to a synchronous caller — not a smaller idea. It is not consumed directly
 *  because it is async while `append` is synchronous by contract (the observer calls it on the read loop),
 *  and what it does with that budget is different too: withFileLock BLOCKS out a lease, this one gives up
 *  in milliseconds and reports (see `append`). What is NOT different is D-M5-24, and the first version of
 *  this file learning that the hard way is why it is restated here:
 *
 *  A LOCK IS A NON-EMPTY DIRECTORY holding exactly one marker file whose NAME is `<nonce>.<lease>` — who
 *  holds the claim and when they published it — and the claim is assembled in a staging directory beside
 *  the target and RENAMED into place. Three properties fall out, each closing a defect measured on the
 *  `open(wx)` + pathname `unlink` lock this replaces:
 *
 *  1. **The claim is published atomically, already naming its owner.** `rename` onto a NON-EMPTY directory
 *     fails, so a live claim cannot be clobbered, and there is no instant in which a lock exists without
 *     saying whose it is.
 *  2. **Every delete is content-conditional, which POSIX gives no way to make an `unlink` be.** Stale
 *     recovery can only ever spell the marker name it just judged, so a successor's claim — a different
 *     name — is untouched; and removing the directory afterwards is `rmdir`, whose emptiness precondition
 *     IS the atomic "no successor has claimed this yet" test. Under the old lock, two writers meeting one
 *     corpse could both delete and both create: measured across processes at ~1 lost `dropped` increment
 *     per 60–200 trials with 8–24 contenders, silent every time, because the loser of a marker
 *     read-modify-write writes bytes identical to the winner's (test/unit/peer/arrival-log-race.test.ts).
 *  3. **The lease rides the NAME, not the mtime.** A breaker can then only delete the exact claim whose age
 *     it read; a claim republished after that judgment is unspellable by it.
 *
 *  Nothing here reads the lock's bytes, so a umask that masks the owner-read bit cannot wedge a session. */
const LOCK_DIR = ".marker.lock";
/** A holder is microseconds; anything this old is a corpse, and its leftover would otherwise wedge every
 *  later append on the session. */
const LOCK_STALE_MS = 5_000;
/** A WALL-CLOCK budget, not an attempt count: `sleepSync(2)` really sleeps ~15ms at the platform's timer
 *  granularity, so counting attempts bought an 8x longer stall than it looked like it did. The hold window
 *  is microseconds, so anything still held after this is a peer we should not wait on. */
const LOCK_WAIT_MS = 40;
const LOCK_RETRY_MS = 1;
/** A name THIS lock's own format could have written, and the reason the break path cannot delete a
 *  stranger's file: `<pid>-<hex>.<lease>`. Anything else in there was put there by something that is not
 *  this store, and removing it is not a thing this code gets to ask for. */
const LOCK_MARKER = /^\d+-[0-9a-f]+\.(\d+)$/;

/** Blocking the read loop is the one thing this file will not do, so the wait is bounded and tiny — and
 *  `Atomics.wait` rather than a spin, so waiting costs no CPU. */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Whether a CORPSE's claim was removed — the only thing that earns an immediate retry. Every other
 *  outcome (a live holder, a stranger's file at the path, a successor that claimed the emptied directory
 *  first) falls through to the caller's deadline, because treating them as progress is an unbounded spin. */
function breakDeadLock(lockPath: string): boolean {
  let names: string[];
  try { names = readdirSync(lockPath); } catch { return false; }   // gone, or not one of our directories
  if (names.length !== 1) return false;
  const lease = LOCK_MARKER.exec(names[0]);
  if (!lease || Date.now() - Number(lease[1]) <= LOCK_STALE_MS) return false;
  try { unlinkSync(join(lockPath, names[0])); } catch { return false; }   // someone else broke it first
  // ENOTEMPTY here means a successor published into the directory we had just emptied — which is exactly
  // the claim this rmdir must not destroy, and the reason the emptiness precondition is the whole test.
  try { rmdirSync(lockPath); return true; } catch { return false; }
}

/** Our marker's NAME on success — the token every later delete is conditional on — or `null` when a live
 *  holder outlasted the bounded wait. Contention never throws; a real filesystem failure (EACCES on the
 *  directory, say) still propagates, which is `append`'s existing contract. */
function acquireMarkerLock(dir: string): string | null {
  const lockPath = join(dir, LOCK_DIR);
  const nonce = `${process.pid}-${randomBytes(6).toString("hex")}`;
  const stage = `${lockPath}.stage-${nonce}`;
  const deadline = Date.now() + LOCK_WAIT_MS;
  mkdirSync(stage, { mode: 0o700 });
  let name = `${nonce}.${Date.now()}`;
  writeFileSync(join(stage, name), `${nonce}\n`, { mode: 0o600 });
  try {
    for (;;) {
      try { renameSync(stage, lockPath); return name; } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        // ENOTEMPTY/EEXIST: someone's claim is there. ENOTDIR/EISDIR: something that is not one of our
        // directories is. Anything else is a real filesystem failure and is not ours to absorb.
        if (code !== "ENOTEMPTY" && code !== "EEXIST" && code !== "ENOTDIR" && code !== "EISDIR") throw err;
      }
      if (breakDeadLock(lockPath)) continue;
      if (Date.now() >= deadline) return null;
      sleepSync(LOCK_RETRY_MS);
      // The lease starts when the claim LANDS, not when it was assembled: a waiter publishing an already
      // old lease would be broken by the next contender within milliseconds of acquiring.
      const born = `${nonce}.${Date.now()}`;
      try { renameSync(join(stage, name), join(stage, born)); name = born; } catch { /* keep the old one */ }
    }
  } finally {
    // On the success path the staging directory was RENAMED away and both of these are ENOENT no-ops. On
    // every other exit they are what stops an abandoned claim-in-waiting from accumulating.
    unlinkIfPresent(join(stage, name));
    try { rmdirSync(stage); } catch { /* gone with the rename */ }
  }
}

/** Releases, and answers whether the claim released was still OURS. A `false` is the fence this lock would
 *  otherwise lack: a holder whose section outlived the lease was evicted and ran beside its successor, so
 *  whatever it computed from a marker it read before that is no longer something to vouch for. */
function releaseMarkerLock(dir: string, name: string): boolean {
  const lockPath = join(dir, LOCK_DIR);
  let held = true;
  try { unlinkSync(join(lockPath, name)); } catch { held = false; }
  try { rmdirSync(lockPath); } catch { /* a successor's claim already stands there; not ours to remove */ }
  return held;
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

  /** DEGRADATION IS A LATCH, and this is where nothing gets to clear it. The write that SETS it is
   *  deliberately unlocked — a writer that could not take the lock still has to say so, because loud beats
   *  blocked — which means it lands inside somebody else's critical section, and that somebody would
   *  otherwise write its own pre-read state over the top and re-certify a count nobody vouches for. So
   *  every writer re-reads immediately before it writes and carries forward a flag it did not set. The
   *  residual is named rather than implied: a degrade landing between this read and this write is still
   *  lost, which is one syscall pair rather than a whole section, and the in-memory latch below covers the
   *  process that set it either way. */
  const writeMarker = (dir: string, sessionId: string, s: MarkerState): void => {
    const concurrent = readMarker(sessionId).degraded || degradedLatch.has(sessionId);
    if (concurrent) s = { ...s, degraded: true };
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
    writeMarker(dir, sessionId, s);
    const back = readMarker(sessionId);
    if (back.dropped === s.dropped) return s;
    degradedLatch.add(sessionId);
    const merged: MarkerState = { ...back, degraded: true };
    try { writeMarker(dir, sessionId, merged); } catch { /* the latch stands; the flag is best-effort as ever */ }
    return merged;
  };

  /** Every entry file in the directory, in `(seq, id)` order — sorted on the PARSED seq, never on the
   *  name. The padding makes the two agree for the first million entries and then stops: `e-1000000-` sorts
   *  lexically ahead of `e-999999-`, which would silently reverse the order eviction and `readAll` both
   *  depend on. Nothing here parses a body, and nothing here judges a seq: what is on disk is retained. */
  const listFiles = (dir: string): Array<{ file: string; seq: number }> => {
    let names: string[];
    try { names = readdirSync(dir); } catch { return []; }
    const out: Array<{ file: string; seq: number; id: string }> = [];
    for (const file of names) {
      const m = ENTRY_FILE.exec(file);
      if (m) out.push({ file, seq: Number(m[1]), id: m[2] });
    }
    out.sort((a, b) => a.seq - b.seq || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
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
      writeMarker(dir, sessionId, { ...readMarker(sessionId), degraded: true });
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

      // Whether this append computed anything FROM the marker. A holder evicted mid-section that never
      // touched it lost nothing, and degrading such a session would be a false alarm rather than a latch.
      let counted = false;
      try {
        let marker = readMarker(e.sessionId);   // read UNDER the lock: an unlocked base is not a base

        // Recovery, before anything else and idempotent: the marker still names a victim, so the crash
        // landed between counting it and deleting it. Delete it now WITHOUT counting it again.
        if (marker.pending) {
          counted = true;
          unlinkIfPresent(join(dir, marker.pending));
          marker = writeMarkerChecked(dir, e.sessionId, { ...marker, pending: undefined });
        }

        writeAtomic(dir, entryFileName(e), JSON.stringify(e));

        // Marker-then-victim. `seqHigh` rides along so `nextSeq` still knows how far the log got after
        // the entry that proved it is gone; `pending` is cleared once, after the last unlink.
        let files = listFiles(dir);
        if (files.length <= ARRIVAL_LOG_CAP) return;
        counted = true;
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
        // THE FENCE. A section that outlived the lease ran beside the successor that broke it, and the
        // count it derived from a base read before that is exactly the lost update the lock exists to
        // prevent — invisible to the read-back, because both writers computed it from the same base. It
        // cannot be undone here, so it is disclosed: loud beats wrong.
        if (!releaseMarkerLock(dir, lock) && counted) degrade(e.sessionId);
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
