// C13b / W10b — owned Bash flag and file-effect tables for Claude Code 2.1.251.
//
// Adapter-facing declarations in chunk-fy12d89p.js (UTF-8 byte spans):
//   pL 928665-932132; Pnn 932153-933349; DP 933350-933792;
//   xnn 933793-934013; u8e 943603-944852; l_e 944853-946435;
//   Bnn 946436-958178; oro 958179-959117; Ern 982274-983900;
//   Crn 983901-984012; Arn 984013-984114.
// Bnn's effective population also owns its four spread sources from
// chunk-9e2ns8ty.js: gKe 176846-187342, wQn 194818-195889,
// TQn 195890-196215, and nyt 194418-194817. oro owns hKe 187690-193953.
//
// Mnn (934014-936257) and i8e (936257-937005) are deliberately excluded:
// they are decision functions, not tables. Mnn is called by i8e; i8e is called
// by Onn 937034-937368 and Dnn 937368-937707. The surrounding safety chain owns
// those bodies. Its cL sed classifier is the one injected helper below.
//
// The public surface keeps upstream's table names only in createBashSafetyTables,
// where a thin adapter can pair each graph capture with a readable owned value.
// Every spread source and callback dependency is local. The only injected helper
// is isSedReadOnly: upstream Bnn's sed slot calls cL, a neighboring command-safety
// classifier rather than table data, so this table unit names that seam instead
// of copying the classifier into a data module.

const COMMAND_SUBSTITUTION_OUTPUT = "__CMDSUB_OUTPUT__";
const TRACKED_VARIABLE_OUTPUT = "__TRACKED_VAR__";

function containsShellExpansion(value) {
  return value.includes(COMMAND_SUBSTITUTION_OUTPUT) ||
    value.includes(TRACKED_VARIABLE_OUTPUT);
}

function beforeDelimiter(value, delimiter) {
  const index = value.indexOf(delimiter);
  return index === -1 ? value : value.slice(0, index);
}

const GIT_REF_SCOPE_FLAGS = {
  "--all": "none",
  "--branches": "none",
  "--tags": "none",
  "--remotes": "none",
};
const GIT_DATE_RANGE_FLAGS = {
  "--since": "string",
  "--after": "string",
  "--until": "string",
  "--before": "string",
};
const GIT_DISPLAY_FLAGS = {
  "--oneline": "none",
  "--graph": "none",
  "--decorate": "none",
  "--no-decorate": "none",
  "--date": "string",
  "--relative-date": "none",
};
const GIT_LIMIT_FLAGS = { "--max-count": "number", "-n": "number" };
const GIT_DIFF_SUMMARY_FLAGS = {
  "--stat": "none",
  "--numstat": "none",
  "--shortstat": "none",
  "--name-only": "none",
  "--name-status": "none",
};
const GIT_COLOR_FLAGS = { "--color": "none", "--no-color": "none" };
const GIT_PATCH_FLAGS = {
  "--patch": "none",
  "-p": "none",
  "--no-patch": "none",
  "--no-ext-diff": "none",
  "-s": "none",
};
const GIT_FILTER_FLAGS = {
  "--author": "string",
  "--committer": "string",
  "--grep": "string",
};

const UNSAFE_GIT_FORMAT = /%[-+ ]?G|%\(\*?signature/;
const STANDARD_GIT_PRETTY_FORMATS = new Set([
  "oneline",
  "short",
  "medium",
  "full",
  "fuller",
  "email",
  "raw",
]);

function isNamedGitPrettyFormat(value) {
  if (value === "" || value.includes("%")) return false;
  if (value.startsWith("format:") || value.startsWith("tformat:")) return false;
  return !STANDARD_GIT_PRETTY_FORMATS.has(value);
}

function gitArgumentsAreDangerous(args) {
  const unsafeValue = (value) =>
    containsShellExpansion(value) || UNSAFE_GIT_FORMAT.test(value) ||
    value.includes("signature");
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (UNSAFE_GIT_FORMAT.test(arg)) return true;
    for (const flag of ["--format", "--pretty", "--sort"]) {
      let value;
      if (arg === flag && index + 1 < args.length) value = args[index + 1];
      else if (arg.startsWith(`${flag}=`)) value = arg.slice(flag.length + 1);
      if (value === undefined) continue;
      if (unsafeValue(value)) return true;
      if (flag !== "--sort" && isNamedGitPrettyFormat(value)) return true;
    }
  }
  return false;
}

const GIT_SAFE_COMMANDS = {
  "git diff": {
    safeFlags: {
      ...GIT_DIFF_SUMMARY_FLAGS,
      ...GIT_COLOR_FLAGS,
      "--dirstat": "none",
      "--summary": "none",
      "--patch-with-stat": "none",
      "--word-diff": "none",
      "--word-diff-regex": "string",
      "--color-words": "none",
      "--no-renames": "none",
      "--no-ext-diff": "none",
      "--check": "none",
      "--ws-error-highlight": "string",
      "--full-index": "none",
      "--binary": "none",
      "--abbrev": "number",
      "--break-rewrites": "none",
      "--find-renames": "none",
      "--find-copies": "none",
      "--find-copies-harder": "none",
      "--irreversible-delete": "none",
      "--diff-algorithm": "string",
      "--histogram": "none",
      "--patience": "none",
      "--minimal": "none",
      "--ignore-space-at-eol": "none",
      "--ignore-space-change": "none",
      "--ignore-all-space": "none",
      "--ignore-blank-lines": "none",
      "--inter-hunk-context": "number",
      "--function-context": "none",
      "--exit-code": "none",
      "--quiet": "none",
      "--cached": "none",
      "--staged": "none",
      "--pickaxe-regex": "none",
      "--pickaxe-all": "none",
      "--no-index": "none",
      "--relative": "string",
      "--diff-filter": "string",
      "-p": "none",
      "-u": "none",
      "-s": "none",
      "-M": "none",
      "-C": "none",
      "-B": "none",
      "-D": "none",
      "-l": "none",
      "-S": "string",
      "-G": "string",
      "-O": "string",
      "-R": "none",
    },
  },
  "git log": {
    safeFlags: {
      ...GIT_DISPLAY_FLAGS,
      ...GIT_REF_SCOPE_FLAGS,
      ...GIT_DATE_RANGE_FLAGS,
      ...GIT_LIMIT_FLAGS,
      ...GIT_DIFF_SUMMARY_FLAGS,
      ...GIT_COLOR_FLAGS,
      ...GIT_PATCH_FLAGS,
      ...GIT_FILTER_FLAGS,
      "--abbrev-commit": "none",
      "--full-history": "none",
      "--dense": "none",
      "--sparse": "none",
      "--simplify-merges": "none",
      "--ancestry-path": "none",
      "--source": "none",
      "--first-parent": "none",
      "--merges": "none",
      "--no-merges": "none",
      "--reverse": "none",
      "--walk-reflogs": "none",
      "--skip": "number",
      "--max-age": "number",
      "--min-age": "number",
      "--no-min-parents": "none",
      "--no-max-parents": "none",
      "--follow": "none",
      "--no-walk": "none",
      "--left-right": "none",
      "--cherry-mark": "none",
      "--cherry-pick": "none",
      "--boundary": "none",
      "--topo-order": "none",
      "--date-order": "none",
      "--author-date-order": "none",
      "--pretty": "string",
      "--format": "string",
      "--diff-filter": "string",
      "-S": "string",
      "-G": "string",
      "--pickaxe-regex": "none",
      "--pickaxe-all": "none",
    },
    additionalCommandIsDangerousCallback: (_command, args) =>
      gitArgumentsAreDangerous(args),
  },
  "git show": {
    safeFlags: {
      ...GIT_DISPLAY_FLAGS,
      ...GIT_DIFF_SUMMARY_FLAGS,
      ...GIT_COLOR_FLAGS,
      ...GIT_PATCH_FLAGS,
      "--abbrev-commit": "none",
      "--word-diff": "none",
      "--word-diff-regex": "string",
      "--color-words": "none",
      "--pretty": "string",
      "--format": "string",
      "--first-parent": "none",
      "--raw": "none",
      "--diff-filter": "string",
      "-m": "none",
      "--quiet": "none",
    },
    additionalCommandIsDangerousCallback: (_command, args) =>
      gitArgumentsAreDangerous(args),
  },
  "git shortlog": {
    safeFlags: {
      ...GIT_REF_SCOPE_FLAGS,
      ...GIT_DATE_RANGE_FLAGS,
      "-s": "none",
      "--summary": "none",
      "-n": "none",
      "--numbered": "none",
      "-e": "none",
      "--email": "none",
      "-c": "none",
      "--committer": "none",
      "--group": "string",
      "--format": "string",
      "--no-merges": "none",
      "--author": "string",
    },
    additionalCommandIsDangerousCallback: (_command, args) =>
      gitArgumentsAreDangerous(args),
  },
  "git reflog": {
    safeFlags: {
      ...GIT_DISPLAY_FLAGS,
      ...GIT_REF_SCOPE_FLAGS,
      ...GIT_DATE_RANGE_FLAGS,
      ...GIT_LIMIT_FLAGS,
      ...GIT_FILTER_FLAGS,
    },
    additionalCommandIsDangerousCallback: (_command, args) => {
      let allowedReflogSubcommands = new Set(["show", "list"]),
        mutatingReflogSubcommands = new Set([
          "expire",
          "delete",
          "exists",
          "drop",
          "write",
        ]),
        subcommand = args[0];
      if (
        subcommand && !subcommand.startsWith("-") &&
        !allowedReflogSubcommands.has(subcommand)
      ) return true;
      for (let arg of args) if (mutatingReflogSubcommands.has(arg)) return true;
      return false;
    },
  },
  "git stash list": {
    safeFlags: {
      ...GIT_DISPLAY_FLAGS,
      ...GIT_REF_SCOPE_FLAGS,
      ...GIT_LIMIT_FLAGS,
    },
  },
  "git ls-remote": {
    safeFlags: {
      "--branches": "none",
      "-b": "none",
      "--tags": "none",
      "-t": "none",
      "--heads": "none",
      "-h": "none",
      "--refs": "none",
      "--quiet": "none",
      "-q": "none",
      "--exit-code": "none",
      "--get-url": "none",
      "--symref": "none",
      "--sort": "string",
    },
    additionalCommandIsDangerousCallback: (_command, args) => {
      if (gitArgumentsAreDangerous(args)) return true;
      let afterDoubleDash = false;
      for (let index = 0; index < args.length; index++) {
        let arg = args[index];
        if (!afterDoubleDash && arg === "--") {
          afterDoubleDash = true;
          continue;
        }
        if (!afterDoubleDash && (!arg || arg.startsWith("-"))) {
          if (arg === "--sort") index++;
          continue;
        }
        return true;
      }
      return false;
    },
  },
  "git status": {
    safeFlags: {
      "--short": "none",
      "-s": "none",
      "--branch": "none",
      "-b": "none",
      "--porcelain": "none",
      "--long": "none",
      "--verbose": "none",
      "-v": "none",
      "--untracked-files": "string",
      "-u": "string",
      "--ignored": "none",
      "--ignore-submodules": "string",
      "--column": "none",
      "--no-column": "none",
      "--ahead-behind": "none",
      "--no-ahead-behind": "none",
      "--renames": "none",
      "--no-renames": "none",
      "--find-renames": "string",
      "-M": "string",
    },
  },
  "git blame": {
    safeFlags: {
      ...GIT_COLOR_FLAGS,
      "-L": "string",
      "--porcelain": "none",
      "-p": "none",
      "--line-porcelain": "none",
      "--incremental": "none",
      "--root": "none",
      "--show-stats": "none",
      "--show-name": "none",
      "--show-number": "none",
      "-n": "none",
      "--show-email": "none",
      "-e": "none",
      "-f": "none",
      "--date": "string",
      "-w": "none",
      "--ignore-rev": "string",
      "--ignore-revs-file": "string",
      "-M": "none",
      "-C": "none",
      "--score-debug": "none",
      "--abbrev": "number",
      "-s": "none",
      "-l": "none",
      "-t": "none",
    },
  },
  "git ls-files": {
    safeFlags: {
      "--cached": "none",
      "-c": "none",
      "--deleted": "none",
      "-d": "none",
      "--modified": "none",
      "-m": "none",
      "--others": "none",
      "-o": "none",
      "--ignored": "none",
      "-i": "none",
      "--stage": "none",
      "-s": "none",
      "--killed": "none",
      "-k": "none",
      "--unmerged": "none",
      "-u": "none",
      "--directory": "none",
      "--no-empty-directory": "none",
      "--eol": "none",
      "--full-name": "none",
      "--abbrev": "number",
      "--debug": "none",
      "-z": "none",
      "-t": "none",
      "-v": "none",
      "-f": "none",
      "--exclude": "string",
      "-x": "string",
      "--exclude-from": "string",
      "-X": "string",
      "--exclude-per-directory": "string",
      "--exclude-standard": "none",
      "--error-unmatch": "none",
      "--recurse-submodules": "none",
    },
  },
  "git config --get": {
    safeFlags: {
      "--local": "none",
      "--global": "none",
      "--system": "none",
      "--worktree": "none",
      "--default": "string",
      "--type": "string",
      "--bool": "none",
      "--int": "none",
      "--bool-or-int": "none",
      "--path": "none",
      "--expiry-date": "none",
      "-z": "none",
      "--null": "none",
      "--name-only": "none",
      "--show-origin": "none",
      "--show-scope": "none",
    },
  },
  "git remote show": {
    safeFlags: { "-n": "none" },
    additionalCommandIsDangerousCallback: (_command, args) => {
      let separatorIndex = args.indexOf("--"),
        flagArgs = separatorIndex === -1 ? args : args.slice(0, separatorIndex),
        trailingArgs = separatorIndex === -1
          ? []
          : args.slice(separatorIndex + 1),
        remoteNames = flagArgs.filter((arg) => arg !== "-n").concat(
          trailingArgs,
        );
      if (remoteNames.length !== 1) return true;
      if (!flagArgs.includes("-n")) return true;
      return !/^[a-zA-Z0-9_][a-zA-Z0-9_-]*$/.test(remoteNames[0]);
    },
  },
  "git remote": {
    safeFlags: { "-v": "none", "--verbose": "none" },
    additionalCommandIsDangerousCallback: (_command, args) =>
      args.some((arg) => arg !== "-v" && arg !== "--verbose"),
  },
  "git merge-base": {
    safeFlags: {
      "--is-ancestor": "none",
      "--fork-point": "none",
      "--octopus": "none",
      "--independent": "none",
      "--all": "none",
    },
  },
  "git rev-parse": {
    safeFlags: {
      "--verify": "none",
      "--short": "string",
      "--abbrev-ref": "none",
      "--symbolic": "none",
      "--symbolic-full-name": "none",
      "--show-toplevel": "none",
      "--show-cdup": "none",
      "--show-prefix": "none",
      "--git-dir": "none",
      "--git-common-dir": "none",
      "--absolute-git-dir": "none",
      "--show-superproject-working-tree": "none",
      "--is-inside-work-tree": "none",
      "--is-inside-git-dir": "none",
      "--is-bare-repository": "none",
      "--is-shallow-repository": "none",
      "--is-shallow-update": "none",
      "--path-prefix": "none",
    },
  },
  "git rev-list": {
    safeFlags: {
      ...GIT_REF_SCOPE_FLAGS,
      ...GIT_DATE_RANGE_FLAGS,
      ...GIT_LIMIT_FLAGS,
      ...GIT_FILTER_FLAGS,
      "--count": "none",
      "--reverse": "none",
      "--first-parent": "none",
      "--ancestry-path": "none",
      "--merges": "none",
      "--no-merges": "none",
      "--min-parents": "number",
      "--max-parents": "number",
      "--no-min-parents": "none",
      "--no-max-parents": "none",
      "--skip": "number",
      "--max-age": "number",
      "--min-age": "number",
      "--walk-reflogs": "none",
      "--oneline": "none",
      "--abbrev-commit": "none",
      "--pretty": "string",
      "--format": "string",
      "--abbrev": "number",
      "--full-history": "none",
      "--dense": "none",
      "--sparse": "none",
      "--source": "none",
      "--graph": "none",
    },
    additionalCommandIsDangerousCallback: (_command, args) =>
      gitArgumentsAreDangerous(args),
  },
  "git describe": {
    safeFlags: {
      "--tags": "none",
      "--match": "string",
      "--exclude": "string",
      "--long": "none",
      "--abbrev": "number",
      "--always": "none",
      "--contains": "none",
      "--first-match": "none",
      "--exact-match": "none",
      "--candidates": "number",
      "--dirty": "none",
      "--broken": "none",
    },
  },
  "git cat-file": {
    safeFlags: {
      "-t": "none",
      "-s": "none",
      "-p": "none",
      "-e": "none",
      "--batch-check": "none",
      "--allow-undetermined-type": "none",
    },
  },
  "git for-each-ref": {
    safeFlags: {
      "--format": "string",
      "--sort": "string",
      "--count": "number",
      "--contains": "string",
      "--no-contains": "string",
      "--merged": "string",
      "--no-merged": "string",
      "--points-at": "string",
    },
    additionalCommandIsDangerousCallback: (_command, args) =>
      gitArgumentsAreDangerous(args),
  },
  "git grep": {
    safeFlags: {
      "-e": "string",
      "-E": "none",
      "--extended-regexp": "none",
      "-G": "none",
      "--basic-regexp": "none",
      "-F": "none",
      "--fixed-strings": "none",
      "-P": "none",
      "--perl-regexp": "none",
      "-i": "none",
      "--ignore-case": "none",
      "-v": "none",
      "--invert-match": "none",
      "-w": "none",
      "--word-regexp": "none",
      "-n": "none",
      "--line-number": "none",
      "-c": "none",
      "--count": "none",
      "-l": "none",
      "--files-with-matches": "none",
      "-L": "none",
      "--files-without-match": "none",
      "-h": "none",
      "-H": "none",
      "--heading": "none",
      "--break": "none",
      "--full-name": "none",
      "--color": "none",
      "--no-color": "none",
      "-o": "none",
      "--only-matching": "none",
      "-A": "number",
      "--after-context": "number",
      "-B": "number",
      "--before-context": "number",
      "-C": "number",
      "--context": "number",
      "--and": "none",
      "--or": "none",
      "--not": "none",
      "--max-depth": "number",
      "--untracked": "none",
      "--no-index": "none",
      "--recurse-submodules": "none",
      "--cached": "none",
      "--threads": "number",
      "-q": "none",
      "--quiet": "none",
    },
  },
  "git stash show": {
    safeFlags: {
      ...GIT_DIFF_SUMMARY_FLAGS,
      ...GIT_COLOR_FLAGS,
      ...GIT_PATCH_FLAGS,
      "--word-diff": "none",
      "--word-diff-regex": "string",
      "--diff-filter": "string",
      "--abbrev": "number",
    },
  },
  "git worktree list": {
    safeFlags: {
      "--porcelain": "none",
      "-v": "none",
      "--verbose": "none",
      "--expire": "string",
    },
  },
  "git tag": {
    safeFlags: {
      "-l": "none",
      "--list": "none",
      "-n": "number",
      "--contains": "string",
      "--no-contains": "string",
      "--merged": "string",
      "--no-merged": "string",
      "--sort": "string",
      "--format": "string",
      "--points-at": "string",
      "--column": "none",
      "--no-column": "none",
      "-i": "none",
      "--ignore-case": "none",
    },
    additionalCommandIsDangerousCallback: (_command, args) => {
      if (gitArgumentsAreDangerous(args)) return true;
      let flagsWithValues = new Set([
          "--contains",
          "--no-contains",
          "--merged",
          "--no-merged",
          "--points-at",
          "--sort",
          "--format",
          "-n",
        ]),
        index = 0,
        listMode = false,
        afterDoubleDash = false;
      while (index < args.length) {
        let arg = args[index];
        if (!arg) {
          index++;
          continue;
        }
        if (arg === "--" && !afterDoubleDash) {
          afterDoubleDash = true, index++;
          continue;
        }
        if (!afterDoubleDash && arg.startsWith("-")) {
          if (arg === "--list" || arg === "-l") listMode = true;
          else if (
            arg[0] === "-" && arg[1] !== "-" && arg.length > 2 &&
            !arg.includes("=") &&
            arg.slice(1).includes("l")
          ) listMode = true;
          if (arg.includes("=")) index++;
          else if (flagsWithValues.has(arg)) index += 2;
          else index++;
        } else {
          if (!listMode) return true;
          index++;
        }
      }
      return false;
    },
  },
  "git branch": {
    safeFlags: {
      "-l": "none",
      "--list": "none",
      "-a": "none",
      "--all": "none",
      "-r": "none",
      "--remotes": "none",
      "-v": "none",
      "-vv": "none",
      "--verbose": "none",
      "--color": "none",
      "--no-color": "none",
      "--column": "none",
      "--no-column": "none",
      "--abbrev": "number",
      "--no-abbrev": "none",
      "--contains": "string",
      "--no-contains": "string",
      "--merged": "none",
      "--no-merged": "none",
      "--points-at": "string",
      "--sort": "string",
      "--show-current": "none",
      "-i": "none",
      "--ignore-case": "none",
    },
    additionalCommandIsDangerousCallback: (_command, args) => {
      if (gitArgumentsAreDangerous(args)) return true;
      let flagsWithValues = new Set([
          "--contains",
          "--no-contains",
          "--points-at",
          "--sort",
        ]),
        mergeFilterFlags = new Set(["--merged", "--no-merged"]),
        index = 0,
        previousFlag = "",
        listMode = false,
        afterDoubleDash = false;
      while (index < args.length) {
        let arg = args[index];
        if (!arg) {
          index++;
          continue;
        }
        if (arg === "--" && !afterDoubleDash) {
          afterDoubleDash = true, previousFlag = "", index++;
          continue;
        }
        if (!afterDoubleDash && arg.startsWith("-")) {
          if (arg === "--list" || arg === "-l") listMode = true;
          else if (
            arg[0] === "-" && arg[1] !== "-" && arg.length > 2 &&
            !arg.includes("=") &&
            arg.slice(1).includes("l")
          ) listMode = true;
          if (arg.includes("=")) {
            previousFlag = beforeDelimiter(arg, "="), index++;
          } else if (flagsWithValues.has(arg)) previousFlag = arg, index += 2;
          else previousFlag = arg, index++;
        } else {
          let mergeFilterMode = mergeFilterFlags.has(previousFlag);
          if (!listMode && !mergeFilterMode) return true;
          index++;
        }
      }
      return false;
    },
  },
};

function githubArgumentsAreDangerous(_command, args) {
  for (const arg of args) {
    if (!arg) continue;
    let value = arg;
    if (arg.startsWith("-")) {
      const equals = arg.indexOf("=");
      if (equals === -1) continue;
      value = arg.slice(equals + 1);
      if (!value) continue;
    }
    if (containsShellExpansion(value)) return true;
    if (
      !value.includes("/") && !value.includes("://") && !value.includes("@")
    ) continue;
    if (value.includes("://") || value.includes("@")) return true;
    if ((value.match(/\//g) || []).length >= 2) return true;
  }
  return false;
}

const GITHUB_SAFE_COMMANDS = {
  "gh pr view": {
    safeFlags: {
      "--json": "string",
      "--comments": "none",
      "--repo": "string",
      "-R": "string",
    },
    additionalCommandIsDangerousCallback: githubArgumentsAreDangerous,
  },
  "gh pr list": {
    safeFlags: {
      "--state": "string",
      "-s": "string",
      "--author": "string",
      "--assignee": "string",
      "--label": "string",
      "--limit": "number",
      "-L": "number",
      "--base": "string",
      "--head": "string",
      "--search": "string",
      "--json": "string",
      "--draft": "none",
      "--app": "string",
      "--repo": "string",
      "-R": "string",
    },
    additionalCommandIsDangerousCallback: githubArgumentsAreDangerous,
  },
  "gh pr diff": {
    safeFlags: {
      "--color": "string",
      "--name-only": "none",
      "--patch": "none",
      "--repo": "string",
      "-R": "string",
    },
    additionalCommandIsDangerousCallback: githubArgumentsAreDangerous,
  },
  "gh pr checks": {
    safeFlags: {
      "--watch": "none",
      "--required": "none",
      "--fail-fast": "none",
      "--json": "string",
      "--interval": "number",
      "--repo": "string",
      "-R": "string",
    },
    additionalCommandIsDangerousCallback: githubArgumentsAreDangerous,
  },
  "gh issue view": {
    safeFlags: {
      "--json": "string",
      "--comments": "none",
      "--repo": "string",
      "-R": "string",
    },
    additionalCommandIsDangerousCallback: githubArgumentsAreDangerous,
  },
  "gh issue list": {
    safeFlags: {
      "--state": "string",
      "-s": "string",
      "--assignee": "string",
      "--author": "string",
      "--label": "string",
      "--limit": "number",
      "-L": "number",
      "--milestone": "string",
      "--search": "string",
      "--json": "string",
      "--app": "string",
      "--repo": "string",
      "-R": "string",
    },
    additionalCommandIsDangerousCallback: githubArgumentsAreDangerous,
  },
  "gh repo view": {
    safeFlags: { "--json": "string" },
    additionalCommandIsDangerousCallback: githubArgumentsAreDangerous,
  },
  "gh run list": {
    safeFlags: {
      "--branch": "string",
      "-b": "string",
      "--status": "string",
      "-s": "string",
      "--workflow": "string",
      "-w": "string",
      "--limit": "number",
      "-L": "number",
      "--json": "string",
      "--repo": "string",
      "-R": "string",
      "--event": "string",
      "-e": "string",
      "--user": "string",
      "-u": "string",
      "--created": "string",
      "--commit": "string",
      "-c": "string",
    },
    additionalCommandIsDangerousCallback: githubArgumentsAreDangerous,
  },
  "gh run view": {
    safeFlags: {
      "--log": "none",
      "--log-failed": "none",
      "--exit-status": "none",
      "--verbose": "none",
      "-v": "none",
      "--json": "string",
      "--repo": "string",
      "-R": "string",
      "--job": "string",
      "-j": "string",
      "--attempt": "number",
      "-a": "number",
    },
    additionalCommandIsDangerousCallback: githubArgumentsAreDangerous,
  },
  "gh auth status": {
    safeFlags: {
      "--active": "none",
      "-a": "none",
      "--hostname": "string",
      "-h": "string",
      "--json": "string",
    },
    additionalCommandIsDangerousCallback: githubArgumentsAreDangerous,
  },
  "gh pr status": {
    safeFlags: {
      "--conflict-status": "none",
      "-c": "none",
      "--json": "string",
      "--repo": "string",
      "-R": "string",
    },
    additionalCommandIsDangerousCallback: githubArgumentsAreDangerous,
  },
  "gh issue status": {
    safeFlags: { "--json": "string", "--repo": "string", "-R": "string" },
    additionalCommandIsDangerousCallback: githubArgumentsAreDangerous,
  },
  "gh release list": {
    safeFlags: {
      "--exclude-drafts": "none",
      "--exclude-pre-releases": "none",
      "--json": "string",
      "--limit": "number",
      "-L": "number",
      "--order": "string",
      "-O": "string",
      "--repo": "string",
      "-R": "string",
    },
    additionalCommandIsDangerousCallback: githubArgumentsAreDangerous,
  },
  "gh release view": {
    safeFlags: { "--json": "string", "--repo": "string", "-R": "string" },
    additionalCommandIsDangerousCallback: githubArgumentsAreDangerous,
  },
  "gh workflow list": {
    safeFlags: {
      "--all": "none",
      "-a": "none",
      "--json": "string",
      "--limit": "number",
      "-L": "number",
      "--repo": "string",
      "-R": "string",
    },
    additionalCommandIsDangerousCallback: githubArgumentsAreDangerous,
  },
  "gh workflow view": {
    safeFlags: {
      "--ref": "string",
      "-r": "string",
      "--yaml": "none",
      "-y": "none",
      "--repo": "string",
      "-R": "string",
    },
    additionalCommandIsDangerousCallback: githubArgumentsAreDangerous,
  },
  "gh label list": {
    safeFlags: {
      "--json": "string",
      "--limit": "number",
      "-L": "number",
      "--order": "string",
      "--search": "string",
      "-S": "string",
      "--sort": "string",
      "--repo": "string",
      "-R": "string",
    },
    additionalCommandIsDangerousCallback: githubArgumentsAreDangerous,
  },
  "gh search repos": {
    safeFlags: {
      "--archived": "none",
      "--created": "string",
      "--followers": "string",
      "--forks": "string",
      "--good-first-issues": "string",
      "--help-wanted-issues": "string",
      "--include-forks": "string",
      "--json": "string",
      "--language": "string",
      "--license": "string",
      "--limit": "number",
      "-L": "number",
      "--match": "string",
      "--number-topics": "string",
      "--order": "string",
      "--owner": "string",
      "--size": "string",
      "--sort": "string",
      "--stars": "string",
      "--topic": "string",
      "--updated": "string",
      "--visibility": "string",
    },
  },
  "gh search issues": {
    safeFlags: {
      "--app": "string",
      "--assignee": "string",
      "--author": "string",
      "--closed": "string",
      "--commenter": "string",
      "--comments": "string",
      "--created": "string",
      "--include-prs": "none",
      "--interactions": "string",
      "--involves": "string",
      "--json": "string",
      "--label": "string",
      "--language": "string",
      "--limit": "number",
      "-L": "number",
      "--locked": "none",
      "--match": "string",
      "--mentions": "string",
      "--milestone": "string",
      "--no-assignee": "none",
      "--no-label": "none",
      "--no-milestone": "none",
      "--no-project": "none",
      "--order": "string",
      "--owner": "string",
      "--project": "string",
      "--reactions": "string",
      "--repo": "string",
      "-R": "string",
      "--sort": "string",
      "--state": "string",
      "--team-mentions": "string",
      "--updated": "string",
      "--visibility": "string",
    },
  },
  "gh search prs": {
    safeFlags: {
      "--app": "string",
      "--assignee": "string",
      "--author": "string",
      "--base": "string",
      "-B": "string",
      "--checks": "string",
      "--closed": "string",
      "--commenter": "string",
      "--comments": "string",
      "--created": "string",
      "--draft": "none",
      "--head": "string",
      "-H": "string",
      "--interactions": "string",
      "--involves": "string",
      "--json": "string",
      "--label": "string",
      "--language": "string",
      "--limit": "number",
      "-L": "number",
      "--locked": "none",
      "--match": "string",
      "--mentions": "string",
      "--merged": "none",
      "--merged-at": "string",
      "--milestone": "string",
      "--no-assignee": "none",
      "--no-label": "none",
      "--no-milestone": "none",
      "--no-project": "none",
      "--order": "string",
      "--owner": "string",
      "--project": "string",
      "--reactions": "string",
      "--repo": "string",
      "-R": "string",
      "--review": "string",
      "--review-requested": "string",
      "--reviewed-by": "string",
      "--sort": "string",
      "--state": "string",
      "--team-mentions": "string",
      "--updated": "string",
      "--visibility": "string",
    },
  },
  "gh search commits": {
    safeFlags: {
      "--author": "string",
      "--author-date": "string",
      "--author-email": "string",
      "--author-name": "string",
      "--committer": "string",
      "--committer-date": "string",
      "--committer-email": "string",
      "--committer-name": "string",
      "--hash": "string",
      "--json": "string",
      "--limit": "number",
      "-L": "number",
      "--merge": "none",
      "--order": "string",
      "--owner": "string",
      "--parent": "string",
      "--repo": "string",
      "-R": "string",
      "--sort": "string",
      "--tree": "string",
      "--visibility": "string",
    },
  },
  "gh search code": {
    safeFlags: {
      "--extension": "string",
      "--filename": "string",
      "--json": "string",
      "--language": "string",
      "--limit": "number",
      "-L": "number",
      "--match": "string",
      "--owner": "string",
      "--repo": "string",
      "-R": "string",
      "--size": "string",
    },
  },
};

const DOCKER_CONNECTION_FLAGS = [
  "-H",
  "-c",
  "-r",
  "--host",
  "--context",
  "--config",
  "--tlscacert",
  "--tlscert",
  "--tlskey",
  "--url",
  "--connection",
  "--identity",
  "--remote",
  "--module",
  "--out",
];
const DOCKER_CONNECTION_SHORT_FLAGS = new Set(
  DOCKER_CONNECTION_FLAGS.filter((flag) => flag.length === 2).map((flag) =>
    flag[1]
  ),
);

function dockerArgumentsAreDangerous(args) {
  return args.some((arg) => {
    if (
      DOCKER_CONNECTION_FLAGS.some((flag) =>
        arg === flag || arg.startsWith(`${flag}=`) ||
        flag.length === 2 && arg.length > 2 && arg.startsWith(flag)
      )
    ) return true;
    const cluster = arg.match(/^-([A-Za-z]+)/)?.[1];
    if (cluster !== undefined && cluster.length >= 2) {
      for (const flag of cluster) {
        if (DOCKER_CONNECTION_SHORT_FLAGS.has(flag)) return true;
      }
    }
    return false;
  });
}

const DOCKER_SAFE_COMMANDS = {
  "docker logs": {
    safeFlags: {
      "--follow": "none",
      "-f": "none",
      "--tail": "string",
      "-n": "string",
      "--timestamps": "none",
      "-t": "none",
      "--since": "string",
      "--until": "string",
      "--details": "none",
    },
    additionalCommandIsDangerousCallback: (_command, args) =>
      dockerArgumentsAreDangerous(args),
  },
  "docker inspect": {
    safeFlags: {
      "--format": "string",
      "-f": "string",
      "--type": "string",
      "--size": "none",
      "-s": "none",
    },
    additionalCommandIsDangerousCallback: (_command, args) =>
      dockerArgumentsAreDangerous(args),
  },
};
const RIPGREP_SAFE_COMMANDS = {
  rg: {
    safeFlags: {
      "-e": "string",
      "--regexp": "string",
      "-f": "string",
      "-i": "none",
      "--ignore-case": "none",
      "-S": "none",
      "--smart-case": "none",
      "-F": "none",
      "--fixed-strings": "none",
      "-w": "none",
      "--word-regexp": "none",
      "-v": "none",
      "--invert-match": "none",
      "-c": "none",
      "--count": "none",
      "-l": "none",
      "--files-with-matches": "none",
      "--files-without-match": "none",
      "-n": "none",
      "--line-number": "none",
      "-o": "none",
      "--only-matching": "none",
      "-A": "number",
      "--after-context": "number",
      "-B": "number",
      "--before-context": "number",
      "-C": "number",
      "--context": "number",
      "-H": "none",
      "-h": "none",
      "--heading": "none",
      "--no-heading": "none",
      "-q": "none",
      "--quiet": "none",
      "--column": "none",
      "-g": "string",
      "--glob": "string",
      "-t": "string",
      "--type": "string",
      "-T": "string",
      "--type-not": "string",
      "--type-list": "none",
      "--hidden": "none",
      "--no-ignore": "none",
      "-u": "none",
      "-m": "number",
      "--max-count": "number",
      "-d": "number",
      "--max-depth": "number",
      "-a": "none",
      "--text": "none",
      "-L": "none",
      "--follow": "none",
      "--color": "string",
      "--json": "none",
      "--stats": "none",
      "--help": "none",
      "--version": "none",
      "--debug": "none",
      "--": "none",
    },
  },
};
const PYRIGHT_SAFE_COMMANDS = {
  pyright: {
    respectsDoubleDash: false,
    safeFlags: {
      "--outputjson": "none",
      "--pythonversion": "string",
      "--pythonplatform": "string",
      "--level": "string",
      "--stats": "none",
      "--verbose": "none",
      "--version": "none",
      "--dependencies": "none",
      "--warnings": "none",
    },
    additionalCommandIsDangerousCallback: (_command, args) =>
      args.some((arg) => arg === "--watch" || arg === "-w"),
  },
};

export const FD_SAFE_FLAGS = {
  "-h": "none",
  "--help": "none",
  "-V": "none",
  "--version": "none",
  "-H": "none",
  "--hidden": "none",
  "-I": "none",
  "--no-ignore": "none",
  "--no-ignore-vcs": "none",
  "--no-ignore-parent": "none",
  "-s": "none",
  "--case-sensitive": "none",
  "-i": "none",
  "--ignore-case": "none",
  "-g": "none",
  "--glob": "none",
  "--regex": "none",
  "-F": "none",
  "--fixed-strings": "none",
  "-a": "none",
  "--absolute-path": "none",
  "-L": "none",
  "--follow": "none",
  "-p": "none",
  "--full-path": "none",
  "-0": "none",
  "--print0": "none",
  "-d": "number",
  "--max-depth": "number",
  "--min-depth": "number",
  "--exact-depth": "number",
  "-t": "string",
  "--type": "string",
  "-e": "string",
  "--extension": "string",
  "-S": "string",
  "--size": "string",
  "--changed-within": "string",
  "--changed-before": "string",
  "-o": "string",
  "--owner": "string",
  "-E": "string",
  "--exclude": "string",
  "--ignore-file": "string",
  "-c": "string",
  "--color": "string",
  "-j": "number",
  "--threads": "number",
  "--max-buffer-time": "string",
  "--max-results": "number",
  "-1": "none",
  "-q": "none",
  "--quiet": "none",
  "--show-errors": "none",
  "--strip-cwd-prefix": "none",
  "--one-file-system": "none",
  "--prune": "none",
  "--search-path": "string",
  "--base-directory": "string",
  "--path-separator": "string",
  "--batch-size": "number",
  "--no-require-git": "none",
  "--hyperlink": "string",
  "--and": "string",
  "--format": "string",
};
export const GREP_SAFE_FLAGS = {
  "-e": "string",
  "--regexp": "string",
  "-f": "string",
  "--file": "string",
  "-F": "none",
  "--fixed-strings": "none",
  "-G": "none",
  "--basic-regexp": "none",
  "-E": "none",
  "--extended-regexp": "none",
  "-P": "none",
  "--perl-regexp": "none",
  "-i": "none",
  "--ignore-case": "none",
  "--no-ignore-case": "none",
  "-v": "none",
  "--invert-match": "none",
  "-w": "none",
  "--word-regexp": "none",
  "-x": "none",
  "--line-regexp": "none",
  "-c": "none",
  "--count": "none",
  "--color": "string",
  "--colour": "string",
  "-L": "none",
  "--files-without-match": "none",
  "-l": "none",
  "--files-with-matches": "none",
  "-m": "number",
  "--max-count": "number",
  "-o": "none",
  "--only-matching": "none",
  "-q": "none",
  "--quiet": "none",
  "--silent": "none",
  "-s": "none",
  "--no-messages": "none",
  "-b": "none",
  "--byte-offset": "none",
  "-H": "none",
  "--with-filename": "none",
  "-h": "none",
  "--no-filename": "none",
  "--label": "string",
  "-n": "none",
  "--line-number": "none",
  "-T": "none",
  "--initial-tab": "none",
  "-u": "none",
  "--unix-byte-offsets": "none",
  "-Z": "none",
  "--null": "none",
  "-z": "none",
  "--null-data": "none",
  "-A": "number",
  "--after-context": "number",
  "-B": "number",
  "--before-context": "number",
  "-C": "number",
  "--context": "number",
  "--group-separator": "string",
  "--no-group-separator": "none",
  "-a": "none",
  "--text": "none",
  "--binary-files": "string",
  "-I": "none",
  "-D": "string",
  "--devices": "string",
  "-d": "string",
  "--directories": "string",
  "--exclude": "string",
  "--exclude-from": "string",
  "--exclude-dir": "string",
  "--include": "string",
  "-r": "none",
  "--recursive": "none",
  "-R": "none",
  "--dereference-recursive": "none",
  "--line-buffered": "none",
  "-U": "none",
  "--binary": "none",
  "--help": "none",
  "-V": "none",
  "--version": "none",
};

const TEST_NUMERIC_OPERATORS = new Set([
  "-eq",
  "-ne",
  "-lt",
  "-le",
  "-gt",
  "-ge",
]);
const SHELL_INTEGER_PATTERN =
  /^-?(0[xX][0-9a-fA-F]+|[0-9]+#[0-9a-zA-Z]+|[0-9]+)$/;

export function createSafeCommandTable(isSedReadOnly) {
  return {
    xargs: {
      safeFlags: {
        "-I": "{}",
        "-n": "number",
        "-P": "number",
        "-L": "number",
        "-s": "number",
        "-E": "EOF",
        "-0": "none",
        "-t": "none",
        "-r": "none",
        "-x": "none",
        "-d": "char",
      },
    },
    ...GIT_SAFE_COMMANDS,
    file: {
      safeFlags: {
        "--brief": "none",
        "-b": "none",
        "--mime": "none",
        "-i": "none",
        "--mime-type": "none",
        "--mime-encoding": "none",
        "--apple": "none",
        "--check-encoding": "none",
        "-c": "none",
        "--exclude": "string",
        "--exclude-quiet": "string",
        "--print0": "none",
        "-0": "none",
        "-F": "string",
        "--separator": "string",
        "--help": "none",
        "--version": "none",
        "-v": "none",
        "--no-dereference": "none",
        "-h": "none",
        "--dereference": "none",
        "-L": "none",
        "--keep-going": "none",
        "-k": "none",
        "--list": "none",
        "-l": "none",
        "--no-buffer": "none",
        "-n": "none",
        "--preserve-date": "none",
        "-p": "none",
        "--raw": "none",
        "-r": "none",
        "-s": "none",
        "--special-files": "none",
      },
    },
    sed: {
      safeFlags: {
        "--expression": "string",
        "-e": "string",
        "--quiet": "none",
        "--silent": "none",
        "-n": "none",
        "--regexp-extended": "none",
        "-r": "none",
        "--posix": "none",
        "-E": "none",
        "--line-length": "number",
        "-l": "number",
        "--zero-terminated": "none",
        "-z": "none",
        "--separate": "none",
        "-s": "none",
        "--unbuffered": "none",
        "-u": "none",
        "--debug": "none",
        "--help": "none",
        "--version": "none",
      },
      additionalCommandIsDangerousCallback: (command, _args) =>
        !isSedReadOnly(command),
    },
    sort: {
      safeFlags: {
        "--ignore-leading-blanks": "none",
        "-b": "none",
        "--dictionary-order": "none",
        "-d": "none",
        "--ignore-case": "none",
        "-f": "none",
        "--general-numeric-sort": "none",
        "-g": "none",
        "--human-numeric-sort": "none",
        "-h": "none",
        "--ignore-nonprinting": "none",
        "-i": "none",
        "--month-sort": "none",
        "-M": "none",
        "--numeric-sort": "none",
        "-n": "none",
        "--random-sort": "none",
        "-R": "none",
        "--reverse": "none",
        "-r": "none",
        "--sort": "string",
        "--stable": "none",
        "-s": "none",
        "--unique": "none",
        "-u": "none",
        "--version-sort": "none",
        "-V": "none",
        "--zero-terminated": "none",
        "-z": "none",
        "--key": "string",
        "-k": "string",
        "--field-separator": "string",
        "-t": "string",
        "--check": "none",
        "-c": "none",
        "--check-char-order": "none",
        "-C": "none",
        "--merge": "none",
        "-m": "none",
        "--buffer-size": "string",
        "-S": "string",
        "--parallel": "number",
        "--batch-size": "number",
        "--help": "none",
        "--version": "none",
      },
    },
    man: {
      additionalCommandIsDangerousCallback: (_command, args) => {
        let searchFlags = new Set(["-k", "-f", "--apropos", "--whatis"]),
          flagsWithValues = new Set(["-S", "-s"]),
          compactSearchMode = false;
        for (let arg of args) {
          if (arg === "--") break;
          if (!arg.startsWith("-") || arg === "-") continue;
          if (arg.startsWith("--")) {
            if (searchFlags.has(arg)) compactSearchMode = true;
          } else if (/[kf]/.test(arg.slice(1))) compactSearchMode = true;
        }
        let searchMode = false, operandsStarted = false;
        for (let index = 0; index < args.length; index++) {
          let arg = args[index];
          if (!operandsStarted && arg === "--") {
            operandsStarted = true;
            continue;
          }
          if (!(operandsStarted || !arg.startsWith("-") || arg === "-")) {
            if (searchFlags.has(arg)) searchMode = true;
            else if (flagsWithValues.has(arg)) index++;
            continue;
          }
          if (operandsStarted = true, containsShellExpansion(arg)) return true;
          if (compactSearchMode && arg.startsWith("-")) return true;
          if (
            !searchMode &&
            (arg.includes("/") || arg.includes("\\") || arg.includes("~"))
          ) {
            return true;
          }
        }
        return false;
      },
      safeFlags: {
        "-a": "none",
        "--all": "none",
        "-d": "none",
        "-f": "none",
        "--whatis": "none",
        "-h": "none",
        "-k": "none",
        "--apropos": "none",
        "-w": "none",
        "-S": "string",
        "-s": "string",
      },
    },
    help: {
      additionalCommandIsDangerousCallback: (_command, args) =>
        args.some((arg) =>
          arg.includes("/") || arg.includes("\\") || arg.includes("~") ||
          containsShellExpansion(arg)
        ),
      safeFlags: { "-d": "none" },
    },
    netstat: {
      safeFlags: {
        "-a": "none",
        "-L": "none",
        "-l": "none",
        "-n": "none",
        "-f": "string",
        "-g": "none",
        "-i": "none",
        "-I": "string",
        "-s": "none",
        "-r": "none",
        "-m": "none",
        "-v": "none",
      },
    },
    ps: {
      safeFlags: {
        "-e": "none",
        "-A": "none",
        "-a": "none",
        "-d": "none",
        "-N": "none",
        "--deselect": "none",
        "-f": "none",
        "-F": "none",
        "-l": "none",
        "-j": "none",
        "-y": "none",
        "-w": "none",
        "-ww": "none",
        "--width": "number",
        "-c": "none",
        "-H": "none",
        "--forest": "none",
        "--headers": "none",
        "--no-headers": "none",
        "-n": "string",
        "--sort": "string",
        "-L": "none",
        "-T": "none",
        "-m": "none",
        "-C": "string",
        "-G": "string",
        "-g": "string",
        "-p": "string",
        "--pid": "string",
        "-q": "string",
        "--quick-pid": "string",
        "-s": "string",
        "--sid": "string",
        "-t": "string",
        "--tty": "string",
        "-U": "string",
        "-u": "string",
        "--user": "string",
        "--help": "none",
        "--info": "none",
        "-V": "none",
        "--version": "none",
      },
      additionalCommandIsDangerousCallback: (_command, args) =>
        args.some((arg) =>
          !arg.startsWith("-") && /^[a-zA-Z]*e[a-zA-Z]*$/.test(arg)
        ),
    },
    base64: {
      respectsDoubleDash: false,
      safeFlags: {
        "-d": "none",
        "-D": "none",
        "--decode": "none",
        "-b": "number",
        "--break": "number",
        "-w": "number",
        "--wrap": "number",
        "-i": "string",
        "--input": "string",
        "--ignore-garbage": "none",
        "-h": "none",
        "--help": "none",
        "--version": "none",
      },
    },
    grep: { safeFlags: GREP_SAFE_FLAGS },
    egrep: { safeFlags: GREP_SAFE_FLAGS },
    fgrep: { safeFlags: GREP_SAFE_FLAGS },
    ...RIPGREP_SAFE_COMMANDS,
    sha256sum: {
      safeFlags: {
        "-b": "none",
        "--binary": "none",
        "-t": "none",
        "--text": "none",
        "-c": "none",
        "--check": "none",
        "--ignore-missing": "none",
        "--quiet": "none",
        "--status": "none",
        "--strict": "none",
        "-w": "none",
        "--warn": "none",
        "--tag": "none",
        "-z": "none",
        "--zero": "none",
        "--help": "none",
        "--version": "none",
      },
    },
    sha1sum: {
      safeFlags: {
        "-b": "none",
        "--binary": "none",
        "-t": "none",
        "--text": "none",
        "-c": "none",
        "--check": "none",
        "--ignore-missing": "none",
        "--quiet": "none",
        "--status": "none",
        "--strict": "none",
        "-w": "none",
        "--warn": "none",
        "--tag": "none",
        "-z": "none",
        "--zero": "none",
        "--help": "none",
        "--version": "none",
      },
    },
    md5sum: {
      safeFlags: {
        "-b": "none",
        "--binary": "none",
        "-t": "none",
        "--text": "none",
        "-c": "none",
        "--check": "none",
        "--ignore-missing": "none",
        "--quiet": "none",
        "--status": "none",
        "--strict": "none",
        "-w": "none",
        "--warn": "none",
        "--tag": "none",
        "-z": "none",
        "--zero": "none",
        "--help": "none",
        "--version": "none",
      },
    },
    tree: {
      safeFlags: {
        "-a": "none",
        "-d": "none",
        "-l": "none",
        "-f": "none",
        "-x": "none",
        "-L": "number",
        "-P": "string",
        "-I": "string",
        "--gitignore": "none",
        "--gitfile": "string",
        "--ignore-case": "none",
        "--matchdirs": "none",
        "--metafirst": "none",
        "--prune": "none",
        "--info": "none",
        "--infofile": "string",
        "--noreport": "none",
        "--charset": "string",
        "--filelimit": "number",
        "-q": "none",
        "-N": "none",
        "-Q": "none",
        "-p": "none",
        "-u": "none",
        "-g": "none",
        "-s": "none",
        "-h": "none",
        "--si": "none",
        "--du": "none",
        "-D": "none",
        "--timefmt": "string",
        "-F": "none",
        "--inodes": "none",
        "--device": "none",
        "-v": "none",
        "-t": "none",
        "-c": "none",
        "-U": "none",
        "-r": "none",
        "--dirsfirst": "none",
        "--filesfirst": "none",
        "--sort": "string",
        "-i": "none",
        "-A": "none",
        "-S": "none",
        "-n": "none",
        "-C": "none",
        "-X": "none",
        "-J": "none",
        "-H": "string",
        "--nolinks": "none",
        "--hintro": "string",
        "--houtro": "string",
        "-T": "string",
        "--hyperlink": "none",
        "--scheme": "string",
        "--authority": "string",
        "--fromfile": "none",
        "--fromtabfile": "none",
        "--fflinks": "none",
        "--help": "none",
        "--version": "none",
      },
    },
    date: {
      safeFlags: {
        "-d": "string",
        "--date": "string",
        "-r": "string",
        "--reference": "string",
        "-u": "none",
        "--utc": "none",
        "--universal": "none",
        "-I": "none",
        "--iso-8601": "string",
        "-R": "none",
        "--rfc-email": "none",
        "--rfc-3339": "string",
        "--debug": "none",
        "--help": "none",
        "--version": "none",
      },
      additionalCommandIsDangerousCallback: (_command, args) => {
        let flagsWithValues = new Set([
            "-d",
            "--date",
            "-r",
            "--reference",
            "--rfc-3339",
          ]),
          index = 0;
        while (index < args.length) {
          let arg = args[index];
          if (arg.startsWith("--") && arg.includes("=")) index++;
          else if (arg.startsWith("-")) {
            if (flagsWithValues.has(arg)) index += 2;
            else index++;
          } else {
            if (!arg.startsWith("+")) return true;
            index++;
          }
        }
        return false;
      },
    },
    hostname: {
      safeFlags: {
        "-f": "none",
        "--fqdn": "none",
        "--long": "none",
        "-s": "none",
        "--short": "none",
        "-i": "none",
        "--ip-address": "none",
        "-I": "none",
        "--all-ip-addresses": "none",
        "-a": "none",
        "--alias": "none",
        "-d": "none",
        "--domain": "none",
        "-A": "none",
        "--all-fqdns": "none",
        "-v": "none",
        "--verbose": "none",
        "-h": "none",
        "--help": "none",
        "-V": "none",
        "--version": "none",
      },
      regex: /^hostname(?:\s+(?:-[a-zA-Z]|--[a-zA-Z-]+))*\s*$/,
    },
    lsof: {
      safeFlags: {
        "-?": "none",
        "-h": "none",
        "-v": "none",
        "-a": "none",
        "-b": "none",
        "-C": "none",
        "-l": "none",
        "-n": "none",
        "-N": "none",
        "-O": "none",
        "-P": "none",
        "-Q": "none",
        "-R": "none",
        "-t": "none",
        "-U": "none",
        "-V": "none",
        "-X": "none",
        "-H": "none",
        "-E": "none",
        "-F": "none",
        "-g": "none",
        "-i": "none",
        "-K": "none",
        "-L": "none",
        "-o": "none",
        "-r": "none",
        "-s": "none",
        "-S": "none",
        "-T": "none",
        "-x": "none",
        "-A": "string",
        "-c": "string",
        "-d": "string",
        "-e": "string",
        "-k": "string",
        "-p": "string",
        "-u": "string",
      },
      additionalCommandIsDangerousCallback: (_command, args) => {
        for (let index = 0; index < args.length; index++) {
          let arg = args[index];
          if (arg === "+m" || arg.startsWith("+m")) return true;
          if (/^-[a-zA-Z]*i\S*@/.test(arg)) {
            let host = beforeDelimiter(arg.slice(arg.indexOf("@") + 1), ":");
            if (/[a-zA-Z]/.test(host)) return true;
          }
          if (/^-[a-zA-Z]*i$/.test(arg)) {
            let nextArg = args[index + 1] ?? "";
            if (nextArg.includes("@")) {
              let host = beforeDelimiter(
                nextArg.slice(nextArg.indexOf("@") + 1),
                ":",
              );
              if (/[a-zA-Z]/.test(host)) return true;
            }
          }
        }
        return false;
      },
    },
    pgrep: {
      safeFlags: {
        "-d": "string",
        "--delimiter": "string",
        "-l": "none",
        "--list-name": "none",
        "-a": "none",
        "--list-full": "none",
        "-v": "none",
        "--inverse": "none",
        "-w": "none",
        "--lightweight": "none",
        "-c": "none",
        "--count": "none",
        "-f": "none",
        "--full": "none",
        "-g": "string",
        "--pgroup": "string",
        "-G": "string",
        "--group": "string",
        "-i": "none",
        "--ignore-case": "none",
        "-n": "none",
        "--newest": "none",
        "-o": "none",
        "--oldest": "none",
        "-O": "string",
        "--older": "string",
        "-P": "string",
        "--parent": "string",
        "-s": "string",
        "--session": "string",
        "-t": "string",
        "--terminal": "string",
        "-u": "string",
        "--euid": "string",
        "-U": "string",
        "--uid": "string",
        "-x": "none",
        "--exact": "none",
        "-F": "string",
        "--pidfile": "string",
        "-L": "none",
        "--logpidfile": "none",
        "-r": "string",
        "--runstates": "string",
        "--ns": "string",
        "--nslist": "string",
        "--help": "none",
        "-V": "none",
        "--version": "none",
      },
    },
    tput: {
      safeFlags: { "-T": "string", "-V": "none", "-x": "none" },
      additionalCommandIsDangerousCallback: (_command, args) => {
        let unsafeCapabilities = new Set([
            "init",
            "reset",
            "rs1",
            "rs2",
            "rs3",
            "is1",
            "is2",
            "is3",
            "iprog",
            "if",
            "rf",
            "clear",
            "flash",
            "mc0",
            "mc4",
            "mc5",
            "mc5i",
            "mc5p",
            "pfkey",
            "pfloc",
            "pfx",
            "pfxl",
            "smcup",
            "rmcup",
          ]),
          flagsWithValues = new Set(["-T"]),
          index = 0,
          afterDoubleDash = false;
        while (index < args.length) {
          let arg = args[index];
          if (arg === "--") afterDoubleDash = true, index++;
          else if (!afterDoubleDash && arg.startsWith("-")) {
            if (arg === "-S") return true;
            if (!arg.startsWith("--") && arg.length > 2 && arg.includes("S")) {
              return true;
            }
            if (flagsWithValues.has(arg)) index += 2;
            else index++;
          } else {
            if (unsafeCapabilities.has(arg)) return true;
            index++;
          }
        }
        return false;
      },
    },
    ss: {
      safeFlags: {
        "-h": "none",
        "--help": "none",
        "-V": "none",
        "--version": "none",
        "-n": "none",
        "--numeric": "none",
        "-a": "none",
        "--all": "none",
        "-l": "none",
        "--listening": "none",
        "-o": "none",
        "--options": "none",
        "-e": "none",
        "--extended": "none",
        "-m": "none",
        "--memory": "none",
        "-p": "none",
        "--processes": "none",
        "-i": "none",
        "--info": "none",
        "-s": "none",
        "--summary": "none",
        "-4": "none",
        "--ipv4": "none",
        "-6": "none",
        "--ipv6": "none",
        "-0": "none",
        "--packet": "none",
        "-t": "none",
        "--tcp": "none",
        "-M": "none",
        "--mptcp": "none",
        "-S": "none",
        "--sctp": "none",
        "-u": "none",
        "--udp": "none",
        "-d": "none",
        "--dccp": "none",
        "-w": "none",
        "--raw": "none",
        "-x": "none",
        "--unix": "none",
        "--tipc": "none",
        "--vsock": "none",
        "-f": "string",
        "--family": "string",
        "-A": "string",
        "--query": "string",
        "--socket": "string",
        "-Z": "none",
        "--context": "none",
        "-z": "none",
        "--contexts": "none",
        "-b": "none",
        "--bpf": "none",
        "-E": "none",
        "--events": "none",
        "-H": "none",
        "--no-header": "none",
        "-O": "none",
        "--oneline": "none",
        "--tipcinfo": "none",
        "--tos": "none",
        "--cgroup": "none",
        "--inet-sockopt": "none",
      },
      additionalCommandIsDangerousCallback: (_command, args) => {
        let filterKeywords =
            /^(dst|src|dport|sport|and|or|not|eq|ne|ge|le|gt|lt|autobound|state|exclude|dev|fwmark|cgroup)$/,
          keywordsWithOperand =
            /^(state|exclude|dport|sport|dev|fwmark|cgroup)$/,
          flagsWithValues = /^(-f|--family|-A|--query|--socket)$/,
          operands = [],
          afterDoubleDash = false;
        for (let index = 0; index < args.length; index++) {
          let arg = args[index];
          if (!afterDoubleDash && arg === "--") {
            afterDoubleDash = true;
            continue;
          }
          if (!afterDoubleDash && arg.startsWith("-")) {
            if (flagsWithValues.test(arg)) index++;
            continue;
          }
          operands.push(arg);
        }
        let tokens = operands.join(" ").split(/[\s()=!<>&|,]+/).filter(Boolean),
          skipNextOperand = false;
        for (let token of tokens) {
          if (skipNextOperand) {
            skipNextOperand = false;
            continue;
          }
          if (filterKeywords.test(token)) {
            skipNextOperand = keywordsWithOperand.test(token);
            continue;
          }
          if (
            /[g-zG-Z]/.test(token) ||
            /[a-fA-F]/.test(token) &&
              (token.includes(".") || !token.includes(":"))
          ) return true;
        }
        return false;
      },
    },
    fd: { safeFlags: { ...FD_SAFE_FLAGS } },
    fdfind: { safeFlags: { ...FD_SAFE_FLAGS } },
    ...PYRIGHT_SAFE_COMMANDS,
    ...DOCKER_SAFE_COMMANDS,
    test: {
      respectsDoubleDash: false,
      safeFlags: {
        "-b": "string",
        "-c": "string",
        "-d": "string",
        "-e": "string",
        "-f": "string",
        "-g": "string",
        "-G": "string",
        "-h": "string",
        "-k": "string",
        "-L": "string",
        "-N": "string",
        "-O": "string",
        "-p": "string",
        "-r": "string",
        "-s": "string",
        "-S": "string",
        "-t": "string",
        "-u": "string",
        "-w": "string",
        "-x": "string",
        "-z": "string",
        "-n": "string",
        "-eq": "string",
        "-ne": "string",
        "-lt": "string",
        "-le": "string",
        "-gt": "string",
        "-ge": "string",
        "-nt": "string",
        "-ot": "string",
        "-ef": "string",
      },
      additionalCommandIsDangerousCallback: (_command, args) => {
        if (
          args.some((arg) =>
            arg === "-v" || arg === "-R" || arg === "-a" || arg === "-o" ||
            /\[/.test(arg)
          )
        ) return true;
        for (let index = 0; index < args.length; index++) {
          if (TEST_NUMERIC_OPERATORS.has(args[index])) {
            for (let operand of [args[index - 1], args[index + 1]]) {
              if (operand !== void 0 && !SHELL_INTEGER_PATTERN.test(operand)) {
                return true;
              }
            }
          }
          if (args[index] === "-t") {
            let descriptor = args[index + 1];
            if (
              descriptor !== void 0 && !SHELL_INTEGER_PATTERN.test(descriptor)
            ) return true;
          }
        }
        return false;
      },
    },
  };
}

export const OPTIONAL_SAFE_COMMANDS = {
  ...GITHUB_SAFE_COMMANDS,
  aki: {
    safeFlags: {
      "-h": "none",
      "--help": "none",
      "-k": "none",
      "--keyword": "none",
      "-s": "none",
      "--semantic": "none",
      "--no-adaptive": "none",
      "-n": "number",
      "--limit": "number",
      "-o": "number",
      "--offset": "number",
      "--source": "string",
      "--exclude-source": "string",
      "-a": "string",
      "--after": "string",
      "-b": "string",
      "--before": "string",
      "--collection": "string",
      "--drive": "string",
      "--folder": "string",
      "--descendants": "none",
      "-m": "string",
      "--meta": "string",
      "-t": "string",
      "--threshold": "string",
      "--kw-weight": "string",
      "--sem-weight": "string",
      "-j": "none",
      "--json": "none",
      "-c": "none",
      "--chunk": "none",
      "--preview": "none",
      "-d": "none",
      "--full-doc": "none",
      "-v": "none",
      "--verbose": "none",
      "--stats": "none",
      "-S": "number",
      "--summarize": "number",
      "--explain": "none",
      "--examine": "string",
      "--url": "string",
      "--multi-turn": "number",
      "--multi-turn-model": "string",
      "--multi-turn-context": "string",
      "--no-rerank": "none",
      "--audit": "none",
      "--local": "none",
      "--staging": "none",
    },
  },
};

function positionalArguments(args) {
  const positional = [];
  let afterDoubleDash = false;
  let foundOperand = false;
  for (const arg of args) {
    if (afterDoubleDash || foundOperand) positional.push(arg);
    else if (arg === "--") afterDoubleDash = true;
    else if (arg === "-" || !arg?.startsWith("-")) {
      positional.push(arg);
      foundOperand = true;
    }
  }
  return positional;
}

function extractorSkippingFlagValues(flagsWithValues) {
  return (args) => {
    const positional = [];
    let afterDoubleDash = false;
    let foundOperand = false;
    for (let index = 0; index < args.length; index++) {
      const arg = args[index];
      if (arg === undefined || arg === null) continue;
      if (afterDoubleDash || foundOperand) positional.push(arg);
      else if (arg === "--") afterDoubleDash = true;
      else if (arg !== "-" && arg.startsWith("-")) {
        if (flagsWithValues.has(arg)) index++;
      } else {
        positional.push(arg);
        foundOperand = true;
      }
    }
    return positional;
  };
}

function attachedFlagValue(arg, flags) {
  if (!arg.startsWith("-")) return undefined;
  const equals = arg.indexOf("=");
  if (equals >= 0) {
    return flags.includes(arg.slice(0, equals))
      ? arg.slice(equals + 1)
      : undefined;
  }
  for (const flag of flags) {
    if (
      flag.length === 2 && flag[0] === "-" && arg.startsWith(flag) &&
      arg !== flag
    ) return arg.slice(2);
  }
  return undefined;
}

function searchArguments(args, flagsWithValues, fallback = []) {
  const paths = [];
  let foundPattern = false;
  let afterDoubleDash = false;
  let foundOperand = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === undefined || arg === null) continue;
    if (!afterDoubleDash && !foundOperand && arg === "--") {
      afterDoubleDash = true;
      continue;
    }
    if (
      !afterDoubleDash && !foundOperand && arg !== "-" && arg.startsWith("-")
    ) {
      const equals = arg.indexOf("=");
      const flag = equals >= 0 ? arg.slice(0, equals) : arg;
      if (["-e", "--regexp", "-f", "--file"].includes(flag)) {
        foundPattern = true;
        if (flag === "-f" || flag === "--file") {
          const file = equals >= 0 ? arg.slice(equals + 1) : args[index + 1];
          if (file) paths.push(file);
        }
      }
      if (flagsWithValues.has(flag) && equals < 0) index++;
      continue;
    }
    if (foundOperand && !afterDoubleDash) {
      const file = attachedFlagValue(arg, ["-f", "--file"]);
      if (file !== undefined) paths.push(file);
    }
    foundOperand = true;
    if (!foundPattern) {
      foundPattern = true;
      continue;
    }
    paths.push(arg);
  }
  return paths.length > 0 ? paths : fallback;
}

export function createFileArgumentExtractors(homeDirectory) {
  return {
    cd: (args) => {
      let positional = positionalArguments(args);
      if (positional.length === 0) {
        return args.at(-1) === "-" ? ["-"] : [homeDirectory()];
      }
      return [positional[0]];
    },
    ls: (args) => {
      let positional = positionalArguments(args);
      return positional.length > 0 ? positional : ["."];
    },
    find: (args) => {
      let paths = [],
        referenceFlags = new Set([
          "-newer",
          "-anewer",
          "-cnewer",
          "-mnewer",
          "-samefile",
          "-path",
          "-wholename",
          "-ilname",
          "-lname",
          "-ipath",
          "-iwholename",
        ]),
        referenceFlagPattern = /^-newer[acmBt][acmtB]$/,
        expressionStarted = false,
        afterDoubleDash = false;
      for (let index = 0; index < args.length; index++) {
        let arg = args[index];
        if (!arg) continue;
        if (afterDoubleDash) {
          paths.push(arg);
          continue;
        }
        if (arg === "--") {
          afterDoubleDash = true;
          continue;
        }
        if (arg.startsWith("-")) {
          if (["-H", "-L", "-P"].includes(arg)) continue;
          if (
            expressionStarted = true,
              referenceFlags.has(arg) || referenceFlagPattern.test(arg)
          ) {
            let referencePath = args[index + 1];
            if (referencePath) paths.push(referencePath), index++;
          }
          continue;
        }
        if (!expressionStarted) paths.push(arg);
      }
      return paths.length > 0 ? paths : ["."];
    },
    mkdir: positionalArguments,
    touch: positionalArguments,
    rm: positionalArguments,
    rmdir: positionalArguments,
    mv: positionalArguments,
    cp: positionalArguments,
    cat: positionalArguments,
    head: positionalArguments,
    tail: positionalArguments,
    sort: positionalArguments,
    uniq: positionalArguments,
    wc: positionalArguments,
    cut: extractorSkippingFlagValues(
      new Set([
        "-d",
        "--delimiter",
        "-f",
        "--fields",
        "-b",
        "--bytes",
        "-c",
        "--characters",
        "--output-delimiter",
      ]),
    ),
    paste: extractorSkippingFlagValues(new Set(["-d", "--delimiters"])),
    column: extractorSkippingFlagValues(
      new Set([
        "-s",
        "--separator",
        "-o",
        "--output-separator",
        "-c",
        "--output-width",
      ]),
    ),
    file: positionalArguments,
    stat: positionalArguments,
    diff: positionalArguments,
    awk: (args) => {
      let flagsWithValues = new Set([
          "-F",
          "--field-separator",
          "-v",
          "--assign",
          "-e",
          "--source",
        ]),
        programFileFlags = new Set(["-f", "--file", "-E", "--exec"]),
        paths = [],
        afterDoubleDash = false,
        programSeen = false,
        operandSeen = false;
      for (let index = 0; index < args.length; index++) {
        let arg = args[index];
        if (arg === void 0 || arg === null) continue;
        if (!afterDoubleDash && !operandSeen && arg === "--") {
          afterDoubleDash = true;
          continue;
        }
        if (
          !afterDoubleDash && !operandSeen && arg !== "-" && arg.startsWith("-")
        ) {
          let equalsIndex = arg.indexOf("="),
            flag = equalsIndex >= 0 ? arg.slice(0, equalsIndex) : arg;
          if (flagsWithValues.has(flag)) {
            if (flag === "-e" || flag === "--source") programSeen = true;
            if (equalsIndex < 0) index++;
            continue;
          }
          if (programFileFlags.has(flag)) {
            if (programSeen = true, equalsIndex >= 0) {
              paths.push(arg.slice(equalsIndex + 1));
            } else {
              let programFile = args[index + 1];
              if (programFile !== void 0) paths.push(programFile), index++;
            }
            continue;
          }
          continue;
        }
        if (operandSeen && !afterDoubleDash) {
          let attachedPath = attachedFlagValue(arg, [
            "-f",
            "--file",
            "-E",
            "--exec",
          ]);
          if (attachedPath !== void 0) paths.push(attachedPath);
        }
        if (operandSeen = true, !programSeen) {
          programSeen = true;
          continue;
        }
        paths.push(arg);
      }
      return paths;
    },
    strings: positionalArguments,
    hexdump: positionalArguments,
    od: positionalArguments,
    base64: positionalArguments,
    nl: positionalArguments,
    sha256sum: positionalArguments,
    sha1sum: positionalArguments,
    md5sum: positionalArguments,
    tr: (args) => {
      let deleteMode = args.some((arg) =>
        arg === "-d" || arg === "--delete" ||
        arg.startsWith("-") && arg.includes("d")
      );
      return positionalArguments(args).slice(deleteMode ? 1 : 2);
    },
    grep: (args) => {
      let paths = searchArguments(
        args,
        new Set([
          "-e",
          "--regexp",
          "-f",
          "--file",
          "--exclude",
          "--include",
          "--exclude-dir",
          "--include-dir",
          "-m",
          "--max-count",
          "-A",
          "--after-context",
          "-B",
          "--before-context",
          "-C",
          "--context",
        ]),
      );
      if (
        paths.length === 0 &&
        args.some((arg) => ["-r", "-R", "--recursive"].includes(arg))
      ) return ["."];
      return paths;
    },
    rg: (args) =>
      searchArguments(
        args,
        new Set([
          "-e",
          "--regexp",
          "-f",
          "--file",
          "-t",
          "--type",
          "-T",
          "--type-not",
          "-g",
          "--glob",
          "-m",
          "--max-count",
          "--max-depth",
          "-r",
          "--replace",
          "-A",
          "--after-context",
          "-B",
          "--before-context",
          "-C",
          "--context",
        ]),
        ["."],
      ),
    sed: (args) => {
      let paths = [],
        skipNext = false,
        expressionSeen = false,
        afterDoubleDash = false,
        operandSeen = false;
      for (let index = 0; index < args.length; index++) {
        if (skipNext) {
          skipNext = false;
          continue;
        }
        let arg = args[index];
        if (!arg) continue;
        if (!afterDoubleDash && !operandSeen && arg === "--") {
          afterDoubleDash = true;
          continue;
        }
        if (
          !afterDoubleDash && !operandSeen && arg !== "-" && arg.startsWith("-")
        ) {
          if (["-f", "--file"].includes(arg)) {
            let file = args[index + 1];
            if (file) paths.push(file), skipNext = true;
            expressionSeen = true;
          } else if (["-e", "--expression"].includes(arg)) {
            skipNext = true, expressionSeen = true;
          } else if (arg.includes("e") || arg.includes("f")) {
            expressionSeen = true;
          }
          continue;
        }
        if (operandSeen = true, !expressionSeen) {
          expressionSeen = true;
          continue;
        }
        paths.push(arg);
      }
      return paths;
    },
    jq: (args) => {
      let paths = [],
        flagsWithValues = new Set([
          "-e",
          "--expression",
          "--arg",
          "--argjson",
          "--args",
          "--jsonargs",
          "-L",
          "--library-path",
          "--indent",
          "--tab",
        ]),
        filterSeen = false,
        afterDoubleDash = false;
      for (let index = 0; index < args.length; index++) {
        let arg = args[index];
        if (arg === void 0 || arg === null) continue;
        if (!afterDoubleDash && arg === "--") {
          afterDoubleDash = true;
          continue;
        }
        if (!afterDoubleDash && arg.startsWith("-")) {
          let equalsIndex = arg.indexOf("="),
            flag = equalsIndex >= 0 ? arg.slice(0, equalsIndex) : arg;
          if (["-e", "--expression"].includes(flag)) filterSeen = true;
          if (["-f", "--from-file"].includes(flag)) {
            if (filterSeen = true, equalsIndex >= 0) {
              paths.push(arg.slice(equalsIndex + 1));
            } else {
              let file = args[index + 1];
              if (file !== void 0) paths.push(file), index++;
            }
            continue;
          }
          if (["--slurpfile", "--rawfile"].includes(flag)) {
            let file = args[index + 2];
            if (file !== void 0) paths.push(file);
            index += 2;
            continue;
          }
          if (flagsWithValues.has(flag) && equalsIndex < 0) index++;
          continue;
        }
        if (!filterSeen) {
          filterSeen = true;
          continue;
        }
        paths.push(arg);
      }
      return paths;
    },
    git: (args) => {
      if (args.length >= 1 && args[0] === "diff") {
        if (args.includes("--no-index")) {
          return positionalArguments(args.slice(1));
        }
      }
      return [];
    },
  };
}

export const FILE_EFFECT_PHRASES = {
  cd: "change directories to",
  ls: "list files in",
  find: "search files in",
  mkdir: "create directories in",
  touch: "create or modify files in",
  rm: "remove files from",
  rmdir: "remove directories from",
  mv: "move files to/from",
  cp: "copy files to/from",
  cat: "concatenate files from",
  head: "read the beginning of files from",
  tail: "read the end of files from",
  sort: "sort contents of files from",
  uniq: "filter duplicate lines from files in",
  wc: "count lines/words/bytes in files from",
  cut: "extract columns from files in",
  paste: "merge files from",
  column: "format files from",
  tr: "transform text from files in",
  file: "examine file types in",
  stat: "read file stats from",
  diff: "compare files from",
  awk: "process text from files in",
  strings: "extract strings from files in",
  hexdump: "display hex dump of files from",
  od: "display octal dump of files from",
  base64: "encode/decode files from",
  nl: "number lines in files from",
  grep: "search for patterns in files from",
  rg: "search for patterns in files from",
  sed: "edit files in",
  git: "access files with git from",
  jq: "process JSON from files in",
  sha256sum: "compute SHA-256 checksums for files in",
  sha1sum: "compute SHA-1 checksums for files in",
  md5sum: "compute MD5 checksums for files in",
};
export const FILE_EFFECT_KINDS = {
  cd: "read",
  ls: "read",
  find: "read",
  mkdir: "create",
  touch: "create",
  rm: "write",
  rmdir: "write",
  mv: "write",
  cp: "write",
  cat: "read",
  head: "read",
  tail: "read",
  sort: "read",
  uniq: "read",
  wc: "read",
  cut: "read",
  paste: "read",
  column: "read",
  tr: "read",
  file: "read",
  stat: "read",
  diff: "read",
  awk: "read",
  strings: "read",
  hexdump: "read",
  od: "read",
  base64: "read",
  nl: "read",
  grep: "read",
  rg: "read",
  sed: "write",
  git: "read",
  jq: "read",
  sha256sum: "read",
  sha1sum: "read",
  md5sum: "read",
};
export const FILE_ARGUMENT_SAFETY = {
  mv: (args) => !args.some((arg) => arg?.startsWith("-")),
  cp: (args) => !args.some((arg) => arg?.startsWith("-")),
  cd: (args) => {
    let positionalStarted = false, positionalCount = 0;
    for (let arg of args) {
      if (!positionalStarted) {
        if (arg === "--") {
          positionalStarted = true;
          continue;
        }
        if (arg.startsWith("-") && arg !== "-") continue;
        positionalStarted = true;
      }
      positionalCount++;
    }
    return positionalCount <= 1;
  },
};
export const WRAPPER_VALUE_FLAGS = {
  env: new Set(["-u", "-C", "--unset", "--chdir"]),
  sudo: new Set([
    "-u",
    "-g",
    "-U",
    "-C",
    "-D",
    "-h",
    "-p",
    "-r",
    "-R",
    "-t",
    "-T",
    "--user",
    "--group",
    "--other-user",
    "--close-from",
    "--chdir",
    "--host",
    "--prompt",
    "--role",
    "--chroot",
    "--type",
    "--command-timeout",
    "-a",
    "--auth-type",
  ]),
  doas: new Set(["-a", "-u", "-C"]),
  pkexec: new Set(["--user"]),
  watch: new Set(["-n", "--interval", "--equexit"]),
  ionice: new Set([
    "-c",
    "-n",
    "-p",
    "-P",
    "-u",
    "--class",
    "--classdata",
    "--pid",
    "--pgid",
    "--uid",
  ]),
  setsid: new Set([]),
  taskset: new Set(["-c", "--cpu-list"]),
  chrt: new Set([
    "-p",
    "--pid",
    "-T",
    "-P",
    "-D",
    "--sched-runtime",
    "--sched-period",
    "--sched-deadline",
  ]),
  strace: new Set([
    "-e",
    "-o",
    "-p",
    "-s",
    "-E",
    "-P",
    "-S",
    "-a",
    "-b",
    "-I",
    "-u",
    "-X",
    "-O",
    "-U",
    "--output",
    "--trace",
    "--expr",
    "--attach",
    "--string-limit",
    "--env",
    "--trace-path",
    "--columns",
    "--user",
    "--interruptible",
    "--detach-on",
    "--const-print-style",
    "--summary-sort-by",
    "--summary-syscall-overhead",
    "--summary-columns",
  ]),
  ltrace: new Set([
    "-a",
    "-A",
    "-e",
    "-l",
    "-n",
    "-o",
    "-p",
    "-s",
    "-u",
    "-x",
    "-D",
    "-F",
    "--align",
    "--config",
    "--debug",
    "--indent",
    "--library",
    "--output",
    "--string-max",
    "-w",
    "--where",
  ]),
  flock: new Set(["-w", "-E", "--timeout", "--wait", "--conflict-exit-code"]),
  script: new Set([
    "-E",
    "-T",
    "-m",
    "-o",
    "-O",
    "-B",
    "-I",
    "--echo",
    "--log-timing",
    "--logging-format",
    "--output-limit",
    "--log-out",
    "--log-io",
    "--log-in",
  ]),
  unshare: new Set([
    "-R",
    "-w",
    "-S",
    "-G",
    "--setuid",
    "--setgid",
    "--root",
    "--wd",
    "--propagation",
    "--setgroups",
    "--monotonic",
    "--boottime",
  ]),
  nsenter: new Set(["-t", "-S", "-G", "--target", "--setuid", "--setgid"]),
  exec: new Set(["-a"]),
  command: new Set([]),
  builtin: new Set([]),
  noglob: new Set([]),
  nocorrect: new Set([]),
};
export const WRAPPER_COMMAND_FLAGS = {
  env: new Set(["-S", "--split-string"]),
  flock: new Set(["-c", "--command"]),
  script: new Set(["-c", "--command"]),
};
export const WRAPPER_POSITIONAL_VALIDATORS = {
  chrt: (value) => /^\d+$/.test(value),
  taskset: (value) => /^(0x[\da-f]+|\d+)$/i.test(value),
  flock: () => true,
  script: () => true,
};

/** Build the eleven adapter-facing values, keyed by their pinned graph names. */
export function createBashSafetyTables({ homeDirectory, isSedReadOnly }) {
  return {
    pL: createFileArgumentExtractors(homeDirectory),
    Pnn: FILE_EFFECT_PHRASES,
    DP: FILE_EFFECT_KINDS,
    xnn: FILE_ARGUMENT_SAFETY,
    u8e: FD_SAFE_FLAGS,
    l_e: GREP_SAFE_FLAGS,
    Bnn: createSafeCommandTable(isSedReadOnly),
    oro: OPTIONAL_SAFE_COMMANDS,
    Ern: WRAPPER_VALUE_FLAGS,
    Crn: WRAPPER_COMMAND_FLAGS,
    Arn: WRAPPER_POSITIONAL_VALIDATORS,
  };
}
