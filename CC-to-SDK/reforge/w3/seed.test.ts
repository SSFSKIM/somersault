// Control for the W3 corpus seed's ENVIRONMENT independence (campaign spec C6
// fix, finding 2).
//
// `seedGitRepo` builds the repository whose branch, git user and commit list the
// preset system prompt renders into every W3 recording. Its determinism claim is
// "an empty commit with pinned author, message and both dates hashes to the same
// SHA on every machine" — but `git` reads the operator's global and system
// config and their `GIT_*` overrides, so until this control the claim held only
// on a CLEAN config. A recorder with `commit.gpgsign=true`, an
// `init.defaultObjectFormat`, a `core.abbrev` or an exported `GIT_COMMITTER_NAME`
// would have re-rolled the baseline for everyone downstream.
//
// §3.1's non-vacuity rule applies to a determinism control as much as to a
// checker: proving the hardened seed survives a poisoned environment says
// nothing unless the poison provably BITES. So each case runs twice — once
// through `seedGitRepo`, once through `naiveSeed`, a verbatim copy of the
// pre-fix helper — and the naive side must move while the hardened side does
// not.
//
// The read side is graded too. The ENGINE renders `git log`/`git config` later,
// under the operator's own environment rather than the seed's, so the
// repository-local `core.abbrev` and `user.*` pins are what keep the rendered
// section stable; the assertions below read the seeded repository back WITH the
// poison still in place, which is exactly the engine's situation.
//
// Run: cd reforge && npx tsx w3/seed.test.ts
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SEED_COMMIT, seedGitRepo } from "./scenarios.js";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const roots: string[] = [];
const freshDir = (): string => {
  const d = mkdtempSync(join(tmpdir(), "reforge-seed-"));
  roots.push(d);
  return d;
};

/** Read the seeded repository back the way the engine does: our env, not the seed's. */
const readBack = (dir: string, args: string[]): string => {
  const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : `<git failed: ${r.stderr?.trim()}>`;
};

/**
 * The helper as it stood before this fix: repository-local identity, pinned
 * dates, and everything else inherited. Kept here — and only here — so the
 * poison profiles below are measured rather than asserted.
 */
function naiveSeed(dir: string): void {
  const git = (args: string[], env?: Record<string, string>): void => {
    const r = spawnSync("git", args, { cwd: dir, encoding: "utf8", env: { ...process.env, ...env } });
    if (r.status !== 0) throw new Error(`naive: git ${args.join(" ")} failed — ${r.stderr?.trim() ?? r.error?.message}`);
  };
  git(["init", "-q", "-b", "main", "."]);
  git(["config", "user.name", "reforge"]);
  git(["config", "user.email", "reforge@example.invalid"]);
  git(["commit", "-q", "--allow-empty", "-m", "reforge sandbox baseline"], {
    GIT_AUTHOR_DATE: "2020-01-01T00:00:00Z",
    GIT_COMMITTER_DATE: "2020-01-01T00:00:00Z",
  });
}

/** Seed with `seed`, returning the resulting HEAD — or null when the seed refused to run. */
function seedHead(seed: (dir: string) => void): string | null {
  const dir = freshDir();
  try {
    seed(dir);
  } catch {
    return null;
  }
  return readBack(dir, ["rev-parse", "HEAD"]);
}

/** Run `body` with `env` merged into `process.env`, then restore it exactly. */
function withEnv(env: Record<string, string>, body: () => void): void {
  const saved = new Map(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  try {
    body();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/** A global gitconfig file the poison profiles point `GIT_CONFIG_GLOBAL` at. */
function poisonConfig(body: string): string {
  const path = join(freshDir(), "gitconfig");
  writeFileSync(path, body);
  return path;
}

console.log("=== W3 corpus seed: environment independence ===");

// --- the baseline itself -----------------------------------------------------
check(`a clean environment seeds the pinned baseline ${SEED_COMMIT.slice(0, 7)}`, seedHead(seedGitRepo) === SEED_COMMIT, String(seedHead(seedGitRepo)));
check("…and the naive seed agrees there, so the poison below is what moves it", seedHead(naiveSeed) === SEED_COMMIT, String(seedHead(naiveSeed)));

// --- profile 1: the SILENT re-roll, the dangerous direction -------------------
// Identity and clock overrides plus a global config that changes the object
// format and the abbreviation width. Nothing here fails; it just produces a
// different, plausible-looking baseline.
const SILENT = {
  GIT_CONFIG_GLOBAL: poisonConfig("[core]\n\tabbrev = 12\n[init]\n\tdefaultObjectFormat = sha256\n\tdefaultBranch = poison\n[user]\n\tname = poison\n\temail = poison@example.invalid\n"),
  GIT_AUTHOR_NAME: "poison",
  GIT_AUTHOR_EMAIL: "poison@example.invalid",
  GIT_AUTHOR_DATE: "2021-06-06T06:06:06Z",
  GIT_COMMITTER_NAME: "poison",
  GIT_COMMITTER_EMAIL: "poison@example.invalid",
  GIT_COMMITTER_DATE: "2021-06-06T06:06:06Z",
};
withEnv(SILENT, () => {
  const naive = seedHead(naiveSeed);
  check("a poisoned environment silently re-rolls the naive seed", naive !== SEED_COMMIT, `naive still produced ${naive}`);
  check("…the hardened seed produces the pinned baseline anyway", seedHead(seedGitRepo) === SEED_COMMIT, String(seedHead(seedGitRepo)));

  // The read side, under the same poison the engine would be running in.
  const dir = freshDir();
  seedGitRepo(dir);
  check("…renders the pinned abbreviated commit, not the global core.abbrev width", readBack(dir, ["log", "--oneline", "-n", "5"]) === `${SEED_COMMIT.slice(0, 7)} reforge sandbox baseline`, readBack(dir, ["log", "--oneline", "-n", "5"]));
  check("…renders the pinned git user, not the global one", readBack(dir, ["config", "user.name"]) === "reforge", readBack(dir, ["config", "user.name"]));
  check("…is on branch main, not the global init.defaultBranch", readBack(dir, ["rev-parse", "--abbrev-ref", "HEAD"]) === "main", readBack(dir, ["rev-parse", "--abbrev-ref", "HEAD"]));
  check("…and is clean, so the status section stays empty", readBack(dir, ["status", "--porcelain"]) === "", readBack(dir, ["status", "--porcelain"]));
});

// --- profile 2: the LOUD failure ---------------------------------------------
// A global config that makes committing itself impossible. The naive seed throws
// on it, which would strand the next recorder rather than corrupt a cassette —
// still a machine the corpus cannot be recorded on.
const LOUD = {
  GIT_CONFIG_GLOBAL: poisonConfig("[commit]\n\tgpgsign = true\n[gpg]\n\tprogram = /nonexistent/gpg\n"),
};
withEnv(LOUD, () => {
  check("a signing-required global config breaks the naive seed", seedHead(naiveSeed) !== SEED_COMMIT, "naive committed anyway");
  check("…the hardened seed is unaffected", seedHead(seedGitRepo) === SEED_COMMIT, String(seedHead(seedGitRepo)));
});

for (const r of roots) rmSync(r, { recursive: true, force: true });

console.log(failures === 0 ? "\nPASS — the corpus seed is decided by its arguments, not by the recorder's git config" : `\nFAIL — ${failures} control(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;
