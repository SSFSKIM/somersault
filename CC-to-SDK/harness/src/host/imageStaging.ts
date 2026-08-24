// harness/src/host/imageStaging.ts — F9 T-IMAGE Task 5 (I3b): the host-side half of the negotiated
// staging protocol (spec v3.1 "Transport"). A client never sends raw image bytes over the small
// fixed-shape control socket (server.ts's MAX_FRAME bounds client→host traffic to 256 KiB) — it asks the
// host to MINT a file, writes the bytes there itself over the filesystem, then claims the file by path in
// its `prompt` op. This module owns the three host-side responsibilities that make that safe:
//   · minting a fresh `0600` file inside a `0700` staging directory and remembering what the client
//     DECLARED about it (mediaType/dimensions/size/sha256), so the prompt handler has something to check
//     the actual bytes against later;
//   · reading a claimed file back and independently verifying its ACTUAL bytes — never the caller's
//     repeated claim — match what was declared (present, in-budget, correct hash), the same
//     "header-decode, not caller-trust" posture `session/turnInput.ts`'s builder takes one layer up;
//   · sweeping the directory for files nobody ever claimed (a crashed client, an interrupted paste) — at
//     host start and on a coarse timer, so an abandoned image cannot sit on disk forever.
import { randomUUID, createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync, chmodSync } from "node:fs";
import { readFile as readFileAsync } from "node:fs/promises";
import { join } from "node:path";

/** How old an unclaimed file in the staging dir gets before the sweep removes it. Bounded so a client
 *  crash between "wrote the bytes" and "sent the prompt" cannot leave a clipboard image on disk forever —
 *  generous enough that a slow paste-to-submit gap on a loaded machine is never caught by it. No canon
 *  twin: canon has no cross-process staging step at all, so there is nothing upstream to match. */
export const ORPHAN_MAX_AGE_MS = 15 * 60 * 1000;
/** The sweep timer's own period. Deliberately the SAME value as the age bound — a file that just missed
 *  one sweep is caught by the next one at most ORPHAN_MAX_AGE_MS later, and one exported constant is one
 *  fewer number for a future reader to reconcile against this one. */
export const SWEEP_INTERVAL_MS = ORPHAN_MAX_AGE_MS;

export interface StagedDescriptor {
  mediaType: string;
  dimensions: { width: number; height: number };
  size: number;
  sha256: string;
  mintedAt: number;
}

/** One host's staging area, rooted at a directory unique to that host (fleet/paths.ts's
 *  `hostImageStagingDir`, keyed by pid like the socket file it sits beside). Constructed once per
 *  `SessionHost` in `start()`. */
export class ImageStaging {
  private readonly staged = new Map<string, StagedDescriptor>();   // path → what the client declared about it

  /** `readFile` is a DI seam — test-only, the same pattern `SessionHost`'s own `deps.disposeGraceMs`/
   *  `deps.getMessages` use: the sequence-race test needs to hold a staged read open PAST the instant the
   *  synchronous seq reservation has already been read off `turnSeq()`, and there is no way to force that
   *  timing against the real filesystem without an injectable hook. */
  constructor(private readonly dir: string, private readFile: (path: string) => Promise<Buffer> = readFileAsync) {}

  /** `0700`, asserted on every mint — cheap, and guards against a directory that survived from a
   *  differently-configured predecessor (or one a test pre-created). */
  private ensureDir(): void {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    chmodSync(this.dir, 0o700);
  }

  /** Mint a fresh EMPTY `0600` file and remember what the client declared about the bytes it is about to
   *  write there. The file is created HERE, not by the client's later write, so the mode is guaranteed
   *  regardless of how the client opens it: `fs.writeFile` on an EXISTING path never changes its mode,
   *  only its content — minting an empty placeholder first is what makes `0600` a promise this module
   *  keeps rather than one it merely hopes the client's own open() flags happen to honour. */
  stage(descriptor: Omit<StagedDescriptor, "mintedAt">): { path: string } {
    this.ensureDir();
    const path = join(this.dir, randomUUID());
    writeFileSync(path, Buffer.alloc(0), { mode: 0o600 });
    this.staged.set(path, { ...descriptor, mintedAt: Date.now() });
    return { path };
  }

  /** Read a CLAIMED file back and verify the ACTUAL bytes — present, no larger than `maxBytes`, and
   *  hashing to `claimedSha256` — rather than trusting anything the caller repeats about them. Gated on
   *  `path` being a file THIS instance minted (looked up in `staged`, never assumed): a caller-forged
   *  path — one this host never handed out — reads back as "missing" without ever touching the
   *  filesystem, the same defence `release` below applies to deletion. `mediaType` rides the success
   *  arm from the ORIGINAL `stage()` descriptor (the file's bytes prove nothing about media type; canon
   *  expects one on the wire regardless). Never throws: a missing/unreadable file is exactly the
   *  "missing" verdict, not an exception a turn has to survive by accident. */
  async readAndValidate(path: string, claimedSha256: string, maxBytes: number): Promise<{ ok: true; data: string; mediaType: string } | { ok: false; reason: string }> {
    const descriptor = this.staged.get(path);
    if (!descriptor) return { ok: false, reason: "staged image file is missing" };
    let buf: Buffer;
    try { buf = await this.readFile(path); }
    catch { return { ok: false, reason: "staged image file is missing" }; }
    if (buf.length > maxBytes) return { ok: false, reason: `staged image exceeds the ${maxBytes}-byte limit` };
    const actual = createHash("sha256").update(buf).digest("hex");
    if (actual !== claimedSha256) return { ok: false, reason: "staged image failed integrity check (hash mismatch)" };
    return { ok: true, data: buf.toString("base64"), mediaType: descriptor.mediaType };
  }

  /** Unclaim + delete ONE file, whatever its processing outcome was — the `finally` half of "the host
   *  deletes every claimed file in a finally around assembly" (spec v3.1). Gated on membership, same as
   *  `readAndValidate`: a path this instance never minted is never passed to `unlink`, so a forged
   *  `stagedId` cannot be used to delete an arbitrary file the host process can reach. Swallows an
   *  already-missing file: one the sweep already reaped is not a second failure here. */
  release(path: string): void {
    if (!this.staged.has(path)) return;
    this.staged.delete(path);
    try { unlinkSync(path); } catch { /* already gone */ }
  }

  /** Delete every file in the staging dir older than `maxAgeMs`, reading mtime off the FILESYSTEM rather
   *  than the in-memory `staged` map — a process restart loses the map but not the files on disk, and a
   *  crash between mint and claim is exactly the case this exists to clean up after. Safe to call before
   *  the directory exists (a fresh host with no prior staging activity ever).
   *
   *  TWO LOOPS, because the file and its map entry can outlive each other independently. The DIRECTORY
   *  loop is authoritative for the bytes — it sees files this process never minted, which is the whole
   *  point of reading the filesystem — and prunes the map entry of every file it deletes. But the client
   *  owns a staged file until the host claims it, and on an aborted turn deletes it ITSELF over the
   *  shared filesystem (`client/stagedSubmit.ts`'s `cleanup`), leaving a map entry whose file the
   *  directory loop will never meet again: repeated aborted image turns would grow this map without
   *  bound. The MAP loop is that entry's only reaper. It is age-gated by the SAME cutoff, which is what
   *  protects the mint→client-write window — a just-minted entry has to survive every sweep until the
   *  client has had its chance to write the bytes and claim them. */
  sweepOrphans(maxAgeMs: number = ORPHAN_MAX_AGE_MS): void {
    const cutoff = Date.now() - maxAgeMs;
    if (existsSync(this.dir)) {
      for (const name of readdirSync(this.dir)) {
        const path = join(this.dir, name);
        let mtime: number;
        try { mtime = statSync(path).mtimeMs; } catch { continue; }   // vanished between readdir and stat
        if (mtime < cutoff) { this.staged.delete(path); try { unlinkSync(path); } catch { /* already gone */ } }
      }
    }
    for (const [path, descriptor] of this.staged) if (descriptor.mintedAt < cutoff) this.staged.delete(path);
  }

  /** Arm the periodic sweep. Returns the disarm function (the same timer-handle discipline `host.ts`'s
   *  own `armIdle` uses) — `unref`'d so a lone sweep timer never keeps the process alive past its
   *  otherwise-natural exit. */
  startPeriodicSweep(intervalMs: number = SWEEP_INTERVAL_MS): () => void {
    const t = setInterval(() => this.sweepOrphans(), intervalMs);
    (t as { unref?: () => void }).unref?.();
    return () => clearInterval(t);
  }
}
