// W3 corpus family — "the system prompt the harness never asked for" (campaign
// spec C6 / §3.2).
//
// THE COVERAGE PROBLEM THIS EXISTS TO FIX. `src/harness.ts:baseOptions()` sets
// `settingSources: []` and passes no `systemPrompt`, so every one of the 25
// recorded scenarios emits the SAME two-block system array: the billing header,
// and `"You are a Claude agent, built on Anthropic's Claude Agent SDK."`
// (measured across every cassette). The engine's real prompt assembly — the
// section list, the identity-line selector, the partition into
// billing / identity / reporting-outcomes / static / dynamic and its cache
// scoping — is therefore DARK on the corpus. A wave that owned prompt assembly
// against that corpus would ship a green gate meaning almost nothing: solo
// sabotage would still redden (the two blocks go through the same code), while
// the branches the wave actually reimplemented went unexecuted.
//
// So W3's first deliverable is scenarios, not splices. Each one below turns a
// specific dark branch into a graded one, and says which:
//
//   sysprompt-preset   the preset's full section list, so the partition's
//                      "everything else" bucket carries real sections and the
//                      reporting-outcomes block is present rather than absent.
//   sysprompt-append   `append:` flips the identity-line selector from the
//                      SDK identity to the append-aware one — a one-line
//                      system-array diff no other scenario produces.
//   claude-md-memory   a project CLAUDE.md reaches the first user message's
//                      `<system-reminder>` context block, giving the context
//                      formatter a second key and a non-trivial body.
//
// X6: none of these adds an environment variable. `systemPrompt` and
// `settingSources` are SDK options, passed per scenario, which is exactly the
// distinction contract X6 draws — a scenario may declare what it asks the
// engine to do; it may not change the environment the whole corpus is graded
// under.
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { baseOptions, drive, resultText, type Scenario } from "../src/harness.js";
import { SANDBOX } from "../src/runTurn.js";

/** The Claude Code preset, as the SDK's own `Options.systemPrompt` declares it. */
const PRESET = { type: "preset", preset: "claude_code" } as const;

/**
 * Give the sandbox its OWN git repository, in a fully determined state.
 *
 * MEASURED, and the reason this helper exists: the preset's prompt ends with a
 * `gitStatus:` section carrying the working tree's branch, git user, porcelain
 * status and the subjects and SHAs of the five most recent commits. The sandbox
 * lives inside this repository, so the first recording of `sysprompt-preset`
 * embedded THIS campaign's own commit log in the system prompt — a cassette that
 * would miss on the next commit, and under §3.4's fatal-fallback rule that is a
 * red gate rather than a stale recording.
 *
 * Rooting the search in the sandbox fixes it at the source instead of scrubbing
 * the symptom, and it BUYS the section rather than discarding it: an empty
 * commit with pinned author, message and both dates hashes to the same SHA on
 * every machine, so the whole section is byte-stable and therefore gradable.
 * `resetSandbox()` wipes the tree before every run — including between the two
 * replay sides — so this is re-seeded per run rather than committed as a
 * fixture.
 *
 * Verified: two seeds produce identical `.git` trees, and neither `git status`
 * nor `git log` mutates one afterwards (no tracked files means no stat cache to
 * refresh), so the state surface stays clean over the seeded repository too.
 */
function seedGitRepo(dir: string): void {
  const git = (args: string[], env?: Record<string, string>): void => {
    const r = spawnSync("git", args, { cwd: dir, encoding: "utf8", env: { ...process.env, ...env } });
    if (r.status !== 0) throw new Error(`w3: git ${args.join(" ")} failed — ${r.stderr?.trim() ?? r.error?.message}`);
  };
  git(["init", "-q", "-b", "main", "."]);
  git(["config", "user.name", "reforge"]);
  git(["config", "user.email", "reforge@example.invalid"]);
  git(["commit", "-q", "--allow-empty", "-m", "reforge sandbox baseline"], {
    GIT_AUTHOR_DATE: "2020-01-01T00:00:00Z",
    GIT_COMMITTER_DATE: "2020-01-01T00:00:00Z",
  });
}

/**
 * The memory scenario's working directory, deliberately NOT the shared sandbox.
 *
 * MEASURED, and the reason for the exception: with `settingSources: ["project"]`
 * the engine walks the working directory's ANCESTORS for `CLAUDE.md` and
 * `.claude/CLAUDE.md`, up to and including the home directory — it does not stop
 * at a git root (the seeded sandbox repository did not bound it). The sandbox
 * sits inside this repository, inside the operator's home, so the first probe
 * recording loaded four memory files: `~/.claude/CLAUDE.md` (the operator's
 * private global instructions), the monorepo's, `CC-to-SDK`'s, and the seeded
 * one. The harness's cassette leak check refused it, correctly.
 *
 * A working directory outside both the repository and the home tree has no
 * ancestor memory at all, so the only CLAUDE.md the engine can find is the one
 * this scenario wrote — which is the whole claim being graded. The price is that
 * the state surface (§3.2), which snapshots the sandbox, sees an empty tree for
 * this scenario; the filesystem effect being asserted is in the request body,
 * not on disk.
 */
const MEMORY_DIR = join(tmpdir(), "reforge-w3-memory");

export const W3_SCENARIOS: Scenario[] = [
  {
    // The unlock. Without it W3 owns the block partition while the corpus
    // exercises one of its three paths with two blocks in it.
    tag: "sysprompt-preset",
    title: "the Claude Code preset system prompt, rendered",
    run: (ctx) => {
      seedGitRepo(SANDBOX);
      return drive("Reply with exactly the single word REFORGE_PRESET_OK and nothing else.", {
        ...baseOptions(ctx),
        systemPrompt: PRESET,
        allowedTools: [],
        maxTurns: 1,
        permissionMode: "bypassPermissions",
      });
    },
    check: (msgs) => (resultText(msgs).includes("REFORGE_PRESET_OK") ? null : "result lacks REFORGE_PRESET_OK"),
  },

  {
    // The identity-line selector's second arm. The instruction lives in the
    // APPENDED text and the prompt is the trigger, so a result carrying the
    // marker is evidence the append actually reached the model rather than
    // evidence that the option was accepted.
    tag: "sysprompt-append",
    title: "the preset plus an appended instruction",
    run: (ctx) => {
      seedGitRepo(SANDBOX);
      return drive("PING", {
        ...baseOptions(ctx),
        systemPrompt: {
          ...PRESET,
          append: "When the user's message is exactly PING, reply with exactly the single word REFORGE_APPEND_OK and nothing else.",
        },
        allowedTools: [],
        maxTurns: 1,
        permissionMode: "bypassPermissions",
      });
    },
    check: (msgs) =>
      resultText(msgs).includes("REFORGE_APPEND_OK") ? null : "result lacks REFORGE_APPEND_OK — the appended prompt did not reach the model",
  },

  {
    // The one input to the block partition a CALLER fully controls. The SDK
    // exports the marker as `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` and documents
    // placing it as a standalone element of a `string[]` prompt to split the
    // globally-cacheable prefix from the session-specific suffix.
    //
    // A custom prompt REPLACES the preset entirely, so this is also the corpus's
    // only recording of that path. What it grades in the partition is the
    // marker's removal: the sentinel must be dropped from every block on every
    // path, and a build that leaked it would put a literal
    // `__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__` into the request body.
    //
    // What it does NOT reach is the "global" cache scope the marker exists for:
    // that path is behind `staticPromptEnabled()`, pinned false by §3.3's gate
    // environment, so the marker is dropped and the split is not honoured. The
    // parity test grades the honoured case against upstream.
    tag: "sysprompt-boundary",
    title: "a custom prompt split by the dynamic-boundary marker",
    run: (ctx) =>
      drive("PING", {
        ...baseOptions(ctx),
        systemPrompt: [
          "You are a test fixture. When the user's message is exactly PING, reply with exactly the single word REFORGE_BOUNDARY_OK and nothing else.",
          // Imported by value rather than from the SDK: the literal is what the
          // engine compares against, and the owned module declares its own copy,
          // so writing it here keeps the scenario a black-box caller.
          "__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__",
          "Session-specific suffix, after the boundary.",
        ],
        allowedTools: [],
        maxTurns: 1,
        permissionMode: "bypassPermissions",
      }),
    check: (msgs) =>
      resultText(msgs).includes("REFORGE_BOUNDARY_OK") ? null : "result lacks REFORGE_BOUNDARY_OK — the custom system prompt did not reach the model",
  },

  {
    // CLAUDE.md injection. The memory is seeded from the scenario body rather
    // than committed as a fixture because `resetSandbox()` wipes the tree
    // before every run — including between the two replay sides, so a file
    // written once by hand would be there for A and gone for B.
    tag: "claude-md-memory",
    title: "a project CLAUDE.md reaches the context block",
    run: (ctx) => {
      rmSync(MEMORY_DIR, { recursive: true, force: true });
      mkdirSync(MEMORY_DIR, { recursive: true });
      seedGitRepo(MEMORY_DIR);
      writeFileSync(
        join(MEMORY_DIR, "CLAUDE.md"),
        "# Sandbox conventions\n\nWhen the user's message is exactly PING, reply with exactly the single word REFORGE_MEMORY_OK and nothing else.\n",
      );
      return drive("PING", {
        ...baseOptions(ctx),
        cwd: MEMORY_DIR,
        // The one option that makes the engine read project files at all. The
        // directory deliberately carries no settings.json: `project` admits one,
        // and a settings file would change permissions and hooks for this
        // scenario only.
        settingSources: ["project"],
        allowedTools: [],
        maxTurns: 1,
        permissionMode: "bypassPermissions",
      });
    },
    check: (msgs) =>
      resultText(msgs).includes("REFORGE_MEMORY_OK") ? null : "result lacks REFORGE_MEMORY_OK — the seeded CLAUDE.md did not reach the prompt",
  },
];
