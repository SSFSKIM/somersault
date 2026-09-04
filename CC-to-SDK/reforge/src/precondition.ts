// H5 / C12a — the DECLARED per-scenario config-directory precondition, and the
// filesystem fault surface that rides on it.
//
// Every interesting storage case is a statement about the filesystem BEFORE the
// run (W9 scout §4.3, capability 2, and the §4.4 dirty-state matrix): a seeded
// transcript, a resumed session's file, a torn tail, a seeded counter. The
// harness had exactly one primitive for that — `resetSandbox`, which wiped
// `sandbox/` and `config/plans` — and one ad-hoc `rmSync(projectsDir)` inside
// `m2/cross-resume.ts`. Everything else was whatever the corpus happened to have
// left behind, which is the opposite of a controlled input: "the engine wrote
// 1,087 task directories over three days" is an accumulated artifact, and a
// measurement over an artifact directory inherits that directory's hygiene.
//
// So a precondition is DECLARED, not accumulated. A scenario that declares none
// gets `EMPTY_PRECONDITION`, which is a statement in its own right rather than
// an absence — see `BASELINE_CONFIG` below.
//
// It is also RECORDED. The runner writes the precondition it applied next to the
// cassette (`cassettes/m1-<tag>.precondition.json`) at record time and applies
// THAT on replay, so a replay reproduces the filesystem the recording was made
// against. A scenario whose declared precondition has since changed is a
// FINDING, named per scenario, rather than a cassette that quietly replays
// against a different world.
//
// THE FAULT SURFACE (capability 3) is the transport fault surface's sibling:
// `src/faults.ts` authors a RESPONSE the API will not produce on demand, and
// this authors a FILESYSTEM the model cannot be asked for. Both are applied
// deterministically and identically to every engine, and both are named — a
// fault that is not named cannot be re-measured.
import { createHash } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** The engine's project key for a working directory: every non-alphanumeric byte becomes `-`. */
export const projectKeyFor = (cwd: string): string => cwd.replace(/[^a-zA-Z0-9]/g, "-");

export interface SeedFile {
  /** relative to CONFIG_DIR */
  path: string;
  content: string;
}

/**
 * The filesystem faults, by name. Each is a transformation of a seeded file, and
 * each is deterministic: the same precondition produces the same bytes on every
 * engine and every replay.
 *
 *  - `torn-tail` (§4.4 D7): drop the trailing newline and part of the last
 *    record, which is what a process killed between two 100 ms drains leaves.
 *    Reaches `sealTornTailOnNextAppend` / `setTailTorn`.
 *  - `parent-cycle` (§4.4 D8): point two records' `parentUuid` at each other, so
 *    a walk up from the leaf reaches a record it has already visited. It reaches
 *    `QVt`'s timestamp fallback and fires `tengu_chain_timestamp_fallback` — NOT
 *    `tengu_chain_parent_cycle` and not the partial-transcript arm, which are
 *    unreachable in `BSe` at 2.1.251 (the parent-lookup guard diverts the
 *    already-visited parent to `QVt` before the loop-top cycle check can see it;
 *    see the D8 comment in `w9/scenarios.ts` for the offsets).
 *  - `read-only-store`: take the write permission off the directory CONTAINING
 *    the named file, so the store's write fails with EACCES — the
 *    `{EACCES, EPERM}` permission errno set (scout §4.3, the fifth of its six
 *    damaged-filesystem arms). THE DIRECTORY, and the distinction is measured,
 *    not stylistic: the act the store performs on a fresh session is CREATING a
 *    new file in the project directory, and a read-only FILE leaves that legal —
 *    the engine writes its session and the fault grades nothing. This arm
 *    chmodded its target FILE for one round while its own comment said
 *    "the DIRECTORY, not the file"; nothing called it, so nothing caught it.
 *    `src/precondition.test.ts` now creates a file through the fault (EACCES)
 *    and creates the same file without it (succeeds).
 *
 * NOT HERE, AND WHY: `enospc`. The store fence latches on `{ENOSPC, EROFS,
 * EDQUOT, ENAMETOOLONG}`, and THREE of those four — `ENOSPC`, `EROFS`,
 * `EDQUOT` — cannot be raised against a chosen path by an unprivileged process
 * on a normal filesystem: producing one needs either a filesystem we can
 * exhaust (a mounted disk image, which is a machine fact rather than a harness
 * fact) or an fs shim preloaded into the engine child (which changes the binary
 * under test and collides with the BUNFS reachability rule).
 *
 * `ENAMETOOLONG` IS THE EXCEPTION, and the first round of this wave stated the
 * blanket claim over all four. It is reachable unprivileged on a normal
 * filesystem — a 300-character filename returns it (measured) — so the fence
 * has a fourth-code route that costs nothing but a pathologically deep sandbox
 * cwd. It is not bought HERE because it is a fault of the PATH rather than of
 * the filesystem, and the store's project path is derived from the cwd, so it
 * belongs to whoever owns the fence: C12d inherits the route by name. `read-only-store` grades the OTHER latching errno family
 * and is honest about the difference: it reaches the store's error path and the
 * writer-health record, and it does NOT reach the fence's stickiness across the
 * four ENOSPC-family codes. C12d owns the fence and inherits this decision.
 */
export type FsFaultKind = "torn-tail" | "parent-cycle" | "read-only-store";

export interface FsFault {
  kind: FsFaultKind;
  /**
   * relative to CONFIG_DIR — the seeded file the fault is ANCHORED on. Two of
   * the three damage that file's bytes; `read-only-store` damages its
   * CONTAINING DIRECTORY and leaves the file itself alone (see the kind's note).
   * Either way the fault names a file that the precondition seeded, so a fault
   * whose anchor was never seeded fails loudly instead of chmodding a path that
   * happens to exist.
   */
  target: string;
}

export interface ConfigPrecondition {
  /** files written under CONFIG_DIR after the wipe, in order */
  seed?: SeedFile[];
  /** faults applied after seeding, in order */
  faults?: FsFault[];
}

export const EMPTY_PRECONDITION: ConfigPrecondition = {};

/**
 * What the EMPTY precondition seeds — the documented baseline every scenario
 * without a declaration starts from.
 *
 * It is not the empty directory, and the difference is measured rather than
 * assumed. On a genuinely empty config dir the engine mints `machineID`,
 * `userID` and `firstStartTime` into `.claude.json` and writes a backup of the
 * file it just created; two engines therefore mint two different identities and
 * two differently-named backups on every scenario. Seeding the post-first-run
 * state makes the identity a constant of the harness instead of a per-run mint —
 * and it is the same act that resets `skillUsage`, the shared invocation counter
 * for prompt-type slash commands and the Skill tool, which is monotonic across
 * the corpus and never reset by the engine (W11 scout §3.4).
 *
 * RESET RATHER THAN SCRUB, deliberately: a differ scrub over `skillUsage` would
 * hide a real counter defect — an engine that failed to increment, or
 * incremented twice — on the one surface that can see it. A reset restores the
 * invariant every other input to a run already has: it starts from a declared
 * state. The cost is stated where it lands: a scenario that wants a NON-ZERO
 * counter must seed it here, which is C14a's inheritance.
 *
 * The version fields are pinned to the engine pin by the caller.
 */
export function baselineConfigJson(engineVersion: string): string {
  return (
    JSON.stringify(
      {
        firstStartTime: "2026-01-01T00:00:00.000Z",
        firstStartVersion: engineVersion,
        opusProMigrationComplete: true,
        sonnet1m45MigrationComplete: true,
        seenNotifications: {},
        hasResetAutoModeOptInForDefaultOffer: true,
        migrationVersion: 13,
        // Pinned, not minted. Both are sha256-shaped in upstream's own writes;
        // these are the literal strings "reforge-machine"/"reforge-user" hashed,
        // so they are recognisable in a finding and identical on every machine.
        machineID: "5a5a1f7cb1c07a4a5f6b8b7f8c2b1de4f7a0c9d3b6e5f4a3c2b1a09f8e7d6c5b",
        userID: "9f8e7d6c5b4a39281706f5e4d3c2b1a0f9e8d7c6b5a493827160f5e4d3c2b1a0",
        cachedExtraUsageDisabledReason: null,
        // The reset (see header). Absent rather than zero, because absent is what
        // a config dir that has never seen a slash command carries — a zero entry
        // would be a state the engine never writes.
      },
      null,
      2,
    ) + "\n"
  );
}

/** The empty precondition, made concrete for a pin. */
export const emptyPreconditionFor = (engineVersion: string): ConfigPrecondition => ({
  seed: [{ path: ".claude.json", content: baselineConfigJson(engineVersion) }],
});

/**
 * The applied precondition is the DECLARED one on top of the baseline, and only
 * the declared half was ever recorded beside a cassette. The baseline is a
 * function of the engine pin (`firstStartVersion`) and of this file's own
 * contents, so two runs whose declarations match byte for byte can still have
 * been made against different filesystems — silently, because nothing compared
 * the half nobody wrote down.
 *
 * A HASH rather than the bytes: the seed is 700-odd bytes of JSON that would be
 * repeated in every one of the corpus's sidecars, and the sidecar's job is to
 * detect a change, not to reconstruct the old world. It cannot reconstruct it
 * anyway — `baselineConfigJson` only knows how to produce TODAY's baseline — so
 * a mismatch is reported as a finding and the scenario re-records deliberately.
 */
export function baselineSeedHash(engineVersion: string): string {
  const seed = emptyPreconditionFor(engineVersion).seed ?? [];
  return createHash("sha256").update(seed.map((f) => `${f.path}\0${f.content}`).join("\0")).digest("hex");
}

/**
 * A declaration's identity, for the one job a sidecar's PROVENANCE has: naming
 * the world this cassette used to be sealed against without carrying it. The
 * same argument as `baselineSeedHash` — a seeded transcript is kilobytes, and a
 * predecessor that cannot be reconstructed is not worth storing whole.
 */
export function declarationSha256(declared: ConfigPrecondition): string {
  return createHash("sha256").update(JSON.stringify(declared)).digest("hex");
}

/** What the runner writes beside a cassette: the declaration AND the baseline it was applied on top of. */
export interface RecordedPrecondition {
  declared: ConfigPrecondition;
  /** `baselineSeedHash(engineVersion)` at record time */
  baselineSha256: string;
  /**
   * H1 — set when this sidecar was written by a RE-SEAL rather than by a
   * recording: the identity of the sidecar it replaced, proven redundant by a
   * clean strict replay of the new declaration against the same cassette
   * (`src/reseal.ts`).
   *
   * THE IMMEDIATE PREDECESSOR ONLY. Re-sealing a re-sealed sidecar overwrites
   * this rather than appending to it, so a chain keeps its last link and nothing
   * else: the field answers "what did this cassette answer before, and is that
   * the world I remember", which is a question about one step. The whole history
   * belongs to the commit log, which has it.
   *
   * No clock and no absolute path, here or anywhere in a sidecar: a fixture that
   * carries either cannot be compared across machines or across days.
   */
  resealedFrom?: {
    declaredSha256: string;
    /** absent when the replaced sidecar was a pre-F4 one, which recorded no baseline */
    baselineSha256?: string;
  };
}

// ---- application ------------------------------------------------------------

function applyFault(configDir: string, fault: FsFault): void {
  const abs = join(configDir, fault.target);
  switch (fault.kind) {
    case "torn-tail": {
      const text = readFileSync(abs, "utf8");
      const lines = text.split("\n").filter(Boolean);
      const last = lines[lines.length - 1] ?? "";
      // Half of the last record, and no trailing newline: a write that stopped.
      writeFileSync(abs, lines.slice(0, -1).map((l) => l + "\n").join("") + last.slice(0, Math.floor(last.length / 2)));
      break;
    }
    case "parent-cycle": {
      const rows = readFileSync(abs, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
      const chained = rows.filter((r) => typeof r.uuid === "string");
      if (chained.length < 2) throw new Error(`parent-cycle: ${fault.target} has fewer than two chained records`);
      const [a, b] = chained.slice(-2);
      a.parentUuid = b.uuid;
      b.parentUuid = a.uuid;
      writeFileSync(abs, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
      break;
    }
    case "read-only-store": {
      // The DIRECTORY, not the file, and `abs` is the file: the store CREATES
      // its session file inside the project directory, so a read-only file
      // would only fail an append to an existing one — the case the engine does
      // not perform. Read the anchor first so a fault pointed at a path nothing
      // seeded fails by name rather than silently chmodding a parent.
      readFileSync(abs);
      chmodSync(dirname(abs), 0o500);
      break;
    }
  }
}

/**
 * Seed `configDir` to the declared precondition. The caller has already emptied
 * it; this only writes.
 */
export function applyPrecondition(configDir: string, pre: ConfigPrecondition, engineVersion: string): void {
  mkdirSync(configDir, { recursive: true });
  for (const file of [...(emptyPreconditionFor(engineVersion).seed ?? []), ...(pre.seed ?? [])]) {
    const abs = join(configDir, file.path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, file.content);
  }
  for (const fault of pre.faults ?? []) applyFault(configDir, fault);
}

/**
 * Empty `configDir` of everything, restoring write permission on the way down:
 * the `read-only-store` fault leaves a directory the wipe itself cannot enter,
 * and a reset that can be defeated by the previous scenario's fault is not a
 * reset.
 */
export function wipeConfigDir(configDir: string): void {
  mkdirSync(configDir, { recursive: true });
  restoreWritable(configDir);
  for (const entry of readdirSync(configDir)) rmSync(join(configDir, entry), { recursive: true, force: true });
}

function restoreWritable(dir: string): void {
  try {
    chmodSync(dir, 0o700);
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      // `lstat`, and NEVER through the link. A directory symlink under
      // CONFIG_DIR resolves to a tree the reset does not own, and `statSync`
      // here would chmod that tree 0o700 — a write to somebody else's
      // filesystem performed by a function whose whole job is to make OUR
      // directory removable. `rmSync` unlinks the link itself, which is all the
      // wipe needs; the target is not the harness's to touch.
      if (lstatSync(abs).isDirectory()) restoreWritable(abs);
    }
  } catch {
    // Unreadable or already gone: rmSync's `force` handles the rest.
  }
}
