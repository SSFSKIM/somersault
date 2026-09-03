// The fourth graded surface: engine STATE (campaign spec §3.2).
//
// Transcripts, harness events and API requests all describe what the engine
// SAID. None of them describes what it DID to the machine. Two engines can agree
// on every message and still leave different files behind, or exit differently
// once the stream is over — cross-resume's session-store diff already proved
// this class of difference is real and invisible to the other three.
//
// §3.2 staged this surface: a cheap subset from W1 (sandbox filesystem tree +
// exit codes), the full version — session/config store, leaked child processes
// and sockets — with the S-module waves at W9. C12a/W9a is that wave's
// machinery child, and it lands the config-store half.
//
// THE SURFACE IS A LIST OF ROOTS, not a root. The mechanism is generic and two
// roots are registered today (`defaultStateRoots`): the sandbox cwd and the
// harness CONFIG dir. A third is already named and deliberately NOT here — the
// dispatched-agent output directory at `/private/tmp/claude-501/<slug>/<uuid>/
// tasks/`, which is the subagent-dispatch subsystem's artifact rather than
// storage's (W12 §0.11). C15a registers it by appending one `StateRoot`; the
// run-id map already covers the `<session-uuid>` in its path.
//
// The two registered roots are read DIFFERENTLY, and the asymmetry is the whole
// design:
//
//  - THE SANDBOX IS WALKED WHOLE. It is wiped before every run, so the tree a
//    run leaves is exactly what that engine created, and it is compared entry
//    for entry with content hashes — the ROOT included, so "the engine deleted
//    its working directory" is a difference rather than the same empty listing
//    an untouched sandbox produces.
//  - THE CONFIG DIR IS WALKED THROUGH A DECLARED INCLUDE-LIST (the W9 scout's
//    §4.2), because the engine keeps bookkeeping there that is not a claim about
//    behaviour: `backups/<name>.backup.<epoch-ms>` names a clock in its own
//    filename, `session-env/` and `shell-snapshots/` are per-process scratch.
//    A whole-tree walk would flag every run on paths that mean nothing and hide
//    the ones that mean something in the noise. What is included is what the
//    scout's §4.2 names, and each entry says why below.
//  - AND A TRANSCRIPT IS PROJECTED PER RECORD, NOT HASHED. A session file's
//    bytes carry a fresh session uuid, a fresh promptId and a millisecond clock
//    on every record, so its sha256 can never match across two runs — hashing it
//    would make the file either always-different (useless) or excluded
//    (invisible). The projection below keeps the fields that are CLAIMS about
//    the chain and drops the rest, and the ids it keeps go through the differ's
//    run-id MAP rather than a scrub, so `parentUuid` still has to equal the
//    mapped uuid of the record it points at. That is the defect class this
//    subsystem exists to avoid, and `m2/cross-resume`'s `{type, role, sorted
//    keys}` shape diff cannot see any of it.
//
// THE EXIT HALF IS DERIVED, and says so. Capturing a true exit status would
// mean either adding an env var outside the X6 schema or dropping `exec` from
// the engine wrappers — and dropping `exec` puts a shell between the SDK and
// the engine, so an aborted run (which the corpus has, in `interrupt` and
// `background-task`) would signal the shell and orphan the engine. Neither
// price is worth paying here, so this reads the outcome the runner can already
// observe: the SDK reports a non-zero child exit as "process exited with code N"
// on the error it throws, which the runner captures. That sees a crash and its
// code; it cannot see a non-zero exit the SDK swallows after a clean stream.
// Process supervision (leaked children, sockets) is still not addressed — W9's
// own carry-over, named rather than assumed (scout §6.5).
//
// CANONICALIZATION, with its justification (§3.4 requires one per rule):
//  - mtimes and inode numbers are NOT recorded. They differ between two replays
//    of the SAME engine, so including them would grade nothing and flag
//    everything. Sizes and content hashes carry the actual claim.
//  - absolute paths are recorded RELATIVE to each root, because the root is the
//    harness's own path and identical for both engines anyway; keeping it would
//    add noise to every finding without adding a claim. The root itself is
//    therefore the entry "."; its EXISTENCE and KIND are still recorded, because
//    those are facts about the engine and not about this machine's paths.
//  - a PROJECTED file records no `size` and no `sha256`. What it hides: a change
//    to a record field the projection does not list (a reordered `message`
//    payload, an added key — though the sorted KEY LIST is projected, so an
//    added key is still seen), and whitespace. What it would miss that matters:
//    nothing the other three surfaces cannot see, because the transcript's
//    message content is the SDK transcript's content and is graded there byte
//    for byte. The projection exists to grade the ENVELOPE, which no other
//    surface carries.
// Nothing else is normalized: a difference in this surface is a difference.
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import { join, relative } from "node:path";

export interface StateEntry {
  /** relative to its root; "." is the root itself */
  path: string;
  kind: "file" | "dir" | "symlink" | "other" | "missing";
  /** byte length, for HASHED files only */
  size?: number;
  /** sha256 of the contents, for HASHED files only */
  sha256?: string;
  /** link target, for symlinks only */
  target?: string;
  /**
   * The per-record semantic projection, for a PROJECTED file (see header). Set
   * instead of `size`/`sha256`, never alongside them.
   */
  records?: unknown[];
  /**
   * A JSONL file whose last line has no terminating newline — the torn tail the
   * store's `sealTornTailOnNextAppend` arm exists for (W9 scout §4.4 D7).
   * Recorded on the entry rather than left to the record list, because a torn
   * tail whose partial line happens to parse would otherwise be invisible.
   */
  tornTail?: boolean;
  /**
   * The project-key slug this entry lives under, lifted out of `path` as a
   * PROPERTY so the differ's run-id map can bind it (see `RUN_ID_KEYS`). The
   * slug is the absolute cwd with its separators flattened, so it is a fact
   * about the machine the harness runs on, not about the engine.
   */
  slug?: string;
}

export interface RootSnapshot {
  name: string;
  entries: StateEntry[];
}

export interface StateSnapshot {
  /** one per registered root, in registration order */
  roots: RootSnapshot[];
  /** how the engine process ended, as far as the runner can observe (see header) */
  engine: string;
}

/** How one file under a root is read. `null` from an `include` means "not part of the surface". */
export type ReadAs = "hash" | "transcript" | "config-json";

export interface StateRoot {
  name: string;
  path: string;
  /**
   * `undefined` walks the whole tree and hashes every file. A root that declares
   * one is walked only through the paths it admits, and each admitted file is
   * read the way the rule says.
   */
  include?: (relPath: string) => ReadAs | null;
}

// ---- the CONFIG root's include-list (W9 scout §4.2) -------------------------
//
// Declared rather than walked, and declared as PATTERNS so `descend` can be
// derived from the same list the matcher uses — a hand-written descend rule and
// a hand-written match rule drift, and the direction they drift in is silence.
//
// `*` matches one path segment; `**` matches one or more trailing segments.
const CONFIG_INCLUDE: [pattern: string, read: ReadAs, why: string][] = [
  // The global config the engine read-modify-writes. It carries `skillUsage`,
  // the shared invocation counter for prompt-type slash commands AND the Skill
  // tool (W11 scout §3.4) — the one field on this surface that is monotonic
  // rather than per-run, which is why the reset policy exists.
  [".claude.json", "config-json", "global config: skillUsage, per-project state, migration flags"],
  // The session transcripts. This is the subsystem.
  ["projects/*/*.jsonl", "transcript", "session transcripts, one per session"],
  ["projects/*/*/subagents/*.jsonl", "transcript", "subagent transcripts (route-by-agent policy; C15/W12's edge)"],
  // The peer/session registry: three subsystems share this directory (the
  // cross-session peer record, the UDS auth key file, FleetView's heartbeat),
  // and on the non-v5 path the write is unlink-then-write, so a TORN peer record
  // is reachable at this pin (W9 scout §2.6). Hashed: these are small JSON blobs
  // with no chain to project.
  ["sessions/**", "hash", "peer/session registry (C11d's edge; torn writes reachable at this pin)"],
  // The task store, keyed by session id — so a resumed session sees the prior
  // run's tasks, which is the W8 edge D10 grades (W9 scout §2.6).
  ["tasks/**", "hash", "task store, session-keyed (C11c's edge)"],
  // The file-history the Edit/Write path keeps.
  ["file-history/**", "hash", "file history"],
];

const split = (p: string): string[] => p.split("/").filter(Boolean);

/** One pattern segment as a matcher: `*` stands for any run of characters WITHIN the segment. */
const segRe = (seg: string): RegExp => new RegExp(`^${seg.split("*").map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*")}$`);

/** Does `segs` match `pat` exactly (a file), or, when `prefix`, is it a proper ancestor of a match (a dir to descend)? */
function matches(pat: string[], segs: string[], prefix: boolean): boolean {
  for (let i = 0; i < pat.length; i++) {
    if (pat[i] === "**") return prefix ? true : segs.length > i;
    if (i >= segs.length) return prefix; // ran out of path: an ancestor of this pattern
    if (!segRe(pat[i]).test(segs[i])) return false;
  }
  return prefix ? segs.length < pat.length : segs.length === pat.length;
}

/** The include-list as the two functions the walker needs. Exported for the controls. */
export const configInclude = (rel: string): ReadAs | null => {
  const segs = split(rel);
  for (const [pattern, read] of CONFIG_INCLUDE) if (matches(split(pattern), segs, false)) return read;
  return null;
};

const configDescend = (rel: string): boolean => {
  const segs = split(rel);
  return CONFIG_INCLUDE.some(([pattern]) => matches(split(pattern), segs, true) || matches(split(pattern), segs, false));
};

/** What the include-list admits, as data — the ledger/README/spec quote this rather than re-reading the code. */
export const configIncludePatterns = (): { pattern: string; read: ReadAs; why: string }[] =>
  CONFIG_INCLUDE.map(([pattern, read, why]) => ({ pattern, read, why }));

// ---- the per-record semantic projection (W9 scout §4.2, "which fields") -----
//
// The envelope `insertMessageChain` wraps every record in, minus what is a fact
// about this machine or this instant. A shape diff over `{type, role, sorted
// keys}` — which is everything the harness had before this wave — passes a wrong
// `parentUuid`, a divergent `leafUuid` and a torn tail; these are the fields that
// make it fail.
const ENVELOPE_FIELDS = [
  "type",
  "subtype",
  "isSidechain",
  "isMeta",
  "parentUuid",
  "logicalParentUuid",
  "leafUuid",
  "sessionId",
  "agentId",
  "promptId",
  "uuid",
  "cwd",
  "entrypoint",
  "userType",
  "version",
  "gitBranch",
  "slug",
  "sessionKind",
  "teamName",
  "agentName",
  // `queue-operation`'s payload. Not in the scout's field list because the
  // scout's list is the message envelope; this record type has no envelope and
  // its whole claim is the operation name. It is the record `ssn` writes and
  // C11c shares (scout §6.4), so the two waves grade it here.
  "operation",
] as const;

/** One stored record, projected to the fields that are claims about the chain. */
export function projectRecord(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of ENVELOPE_FIELDS) if (f in record) out[f] = record[f];
  const message = record.message as { role?: unknown } | undefined;
  if (message && typeof message === "object" && "role" in message) out.role = message.role;
  // The sorted key list — what `m2/cross-resume` had, kept because it is the
  // only thing that sees a key the projection does not name.
  out.keys = Object.keys(record).sort();
  // A boundary's whole metadata, including `preservedMessages.uuids`: those name
  // messages the SDK never emits, so this projection is the only place they can
  // be graded (the same argument C7/W4 made for the differ's map).
  if (record.compactMetadata !== undefined) out.compactMetadata = record.compactMetadata;
  return out;
}

/** A JSONL transcript, projected record by record; an unparseable trailing line is recorded as one. */
export function projectTranscript(text: string): { records: unknown[]; tornTail: boolean } {
  const lines = text.split("\n");
  const tornTail = text.length > 0 && !text.endsWith("\n");
  const records: unknown[] = [];
  for (const line of lines) {
    if (line === "") continue;
    try {
      records.push(projectRecord(JSON.parse(line) as Record<string, unknown>));
    } catch {
      // A torn write, a cycle-seeded rewrite that broke JSON, or a half-flushed
      // record. Its BYTES are not projected — the tail of a real record would
      // carry ids and prose that the other surfaces already grade — but its
      // presence and length are a claim about what the engine left behind.
      records.push({ malformed: true, bytes: line.length });
    }
  }
  return { records, tornTail };
}

/**
 * `.claude.json`, projected.
 *
 * NOTHING IS HIDDEN, and that is a decision the precondition primitive bought.
 * `machineID`, `userID` and `firstStartTime` are minted the first time the engine
 * meets an empty config dir, so under a per-run wipe two engines would mint two
 * different identities and this surface would diff on every scenario for a reason
 * that is not behaviour. The obvious fix — project them away — would have made
 * the surface blind to an engine that RE-MINTED an identity it was handed, which
 * is a real storage defect (the read-modify-write around this file is the
 * contract). So the empty precondition SEEDS them instead (`src/precondition.ts`),
 * they become a declared input rather than a mint, and the projection grades them
 * like everything else. Measured: with the seed present the engine preserves all
 * three byte for byte and writes no `backups/` entry at all; without it, it mints
 * fresh ones and a clock-named backup on every run.
 *
 * The sorted `keys` list rides alongside the values for the same reason it does
 * on a transcript record: it is the only thing that sees a key the projection
 * would otherwise not name.
 */
export function projectConfigJson(text: string): unknown {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { malformed: true, bytes: text.length };
  }
  return { keys: Object.keys(parsed).sort(), ...parsed };
}

/** One filesystem entry, read without following symlinks. `read` decides how a file is recorded. */
function entryOf(path: string, abs: string, read: ReadAs): StateEntry {
  const st = lstatSync(abs);
  if (st.isSymbolicLink()) return { path, kind: "symlink", target: readlinkSync(abs) };
  if (st.isDirectory()) return { path, kind: "dir" };
  if (!st.isFile()) return { path, kind: "other" };
  const bytes = readFileSync(abs);
  const entry: StateEntry = { path, kind: "file" };
  if (read === "transcript") {
    const { records, tornTail } = projectTranscript(bytes.toString("utf8"));
    entry.records = records;
    if (tornTail) entry.tornTail = true;
  } else if (read === "config-json") {
    entry.records = [projectConfigJson(bytes.toString("utf8"))];
  } else {
    entry.size = bytes.length;
    entry.sha256 = createHash("sha256").update(bytes).digest("hex");
  }
  return withSlug(entry);
}

/** The project-key slug, lifted out of the path so the differ can map it (see `StateEntry.slug`). */
function withSlug(entry: StateEntry): StateEntry {
  const segs = entry.path.split("/");
  if (segs[0] === "projects" && segs.length > 1) entry.slug = segs[1];
  return entry;
}

/**
 * Recursive, sorted, hash-bearing listing of one root, INCLUDING the root itself
 * as its first entry (path ".").
 *
 * The root's own existence is a graded fact, not a precondition (W1 boundary
 * review). Reporting only the children made an ABSENT root and an existing but
 * EMPTY one the same snapshot — so an engine that deleted its working directory
 * graded identical to one that correctly left it empty, on the surface whose
 * entire reason for existing is to see what a run did to the machine. A missing
 * root is now recorded as `kind: "missing"`, which diffs against the `"dir"` an
 * empty one reports.
 *
 * A root with an `include` rule walks only the paths that rule admits: the
 * directories on the way to an admitted file are recorded (so a missing one is a
 * difference) and nothing else is opened.
 */
export function rootEntriesOf(root: StateRoot): StateEntry[] {
  // lstat rather than existsSync: a DANGLING symlink is not "missing", it is a
  // symlink, and `existsSync` follows the link and would call it absent.
  if (!lstatSync(root.path, { throwIfNoEntry: false })) return [{ path: ".", kind: "missing" }];
  const rootEntry = entryOf(".", root.path, "hash");
  const out: StateEntry[] = [rootEntry];
  const admits = root.include;
  const descend = admits === undefined ? () => true : (rel: string) => configDescend(rel);
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const abs = join(dir, name);
      const rel = relative(root.path, abs);
      const isDir = lstatSync(abs).isDirectory();
      if (isDir) {
        if (!descend(rel)) continue;
        out.push(withSlug({ path: rel, kind: "dir" }));
        walk(abs);
        continue;
      }
      const read = admits === undefined ? "hash" : admits(rel);
      if (read === null) continue;
      out.push(entryOf(rel, abs, read));
    }
  };
  if (rootEntry.kind === "dir") walk(root.path);
  return out;
}

/** The whole-tree walk, unchanged, for callers that have a path rather than a root. */
export const treeOf = (root: string): StateEntry[] => rootEntriesOf({ name: "sandbox", path: root });

/**
 * The registered roots, in registration order. Two today; C15a appends the
 * dispatched-agent output directory as a third (see header).
 */
export function defaultStateRoots(sandbox: string, configDir: string): StateRoot[] {
  return [
    { name: "sandbox", path: sandbox },
    { name: "config", path: configDir, include: configInclude },
  ];
}

/**
 * The engine's termination, from what the runner captured. `completed` means the
 * query finished without throwing; anything else names the failure, with the
 * child's exit code when the SDK reported one.
 */
export function engineOutcome(messages: readonly unknown[]): string {
  const thrown = messages.find((m) => (m as { type?: string }).type === "reforge-exception") as
    | { name?: string; message?: string }
    | undefined;
  if (!thrown) return "completed";
  const text = String(thrown.message ?? "");
  const code = /exited with code (\d+)/.exec(text);
  if (code) return `exit:${code[1]}`;
  const signal = /signal (SIG[A-Z0-9]+)/.exec(text);
  if (signal) return `signal:${signal[1]}`;
  // A thrown query that named no child status is still an outcome, and the
  // engines must agree on WHICH: the class alone, since the message text is
  // already graded on the transcript surface.
  return `error:${thrown.name ?? "Error"}`;
}

export function stateSnapshot(roots: readonly StateRoot[], messages: readonly unknown[]): StateSnapshot {
  return { roots: roots.map((r) => ({ name: r.name, entries: rootEntriesOf(r) })), engine: engineOutcome(messages) };
}

/** The entries of one registered root, by name — for reporting, never for grading a subset. */
export const entriesOf = (snap: StateSnapshot, name: string): StateEntry[] =>
  snap.roots.find((r) => r.name === name)?.entries ?? [];
