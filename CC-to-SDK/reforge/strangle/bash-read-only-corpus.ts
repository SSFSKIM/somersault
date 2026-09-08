// Shared inputs for C13b's `_8e` pinned-byte differential and its contract
// coverage driver. The driver owns no private commands or port states: adding
// an input here makes both consumers take it.

export type GitCwdRisk =
  | false
  | "bare-indicators"
  | "gitdir-redirect-plantable"
  | "gitdir-file-oversized";
export interface PortValues {
  spawnEnvironmentKeys: ReadonlySet<string> | null;
  gitCwdRisk: GitCwdRisk;
  sandboxingEnabled: boolean;
  currentWorkingDirectory: string;
  originalWorkingDirectory: string;
  platform: string;
  homeDirectory: string;
  subprocessEnvironmentScrubbingEnabled: boolean;
}
export interface RuntimePorts {
  getSpawnEnvironmentKeys: () => ReadonlySet<string> | null;
  inspectGitWorkingDirectory: () => GitCwdRisk;
  isSandboxingEnabled: () => boolean;
  getCurrentWorkingDirectory: () => string;
  getOriginalWorkingDirectory: () => string;
  getPlatform: () => string;
  getHomeDirectory: () => string;
  isSubprocessEnvironmentScrubbingEnabled: () => boolean;
}

export const DEFAULT_READ_ONLY_PORTS: PortValues = {
  spawnEnvironmentKeys: new Set(),
  gitCwdRisk: false,
  sandboxingEnabled: false,
  currentWorkingDirectory: "/work",
  originalWorkingDirectory: "/work",
  platform: "darwin",
  homeDirectory: "/home/reforge",
  subprocessEnvironmentScrubbingEnabled: false,
};

export function readOnlyPorts(overrides: Partial<PortValues> = {}): RuntimePorts {
  const values = { ...DEFAULT_READ_ONLY_PORTS, ...overrides };
  return {
    getSpawnEnvironmentKeys: () => values.spawnEnvironmentKeys,
    inspectGitWorkingDirectory: () => values.gitCwdRisk,
    isSandboxingEnabled: () => values.sandboxingEnabled,
    getCurrentWorkingDirectory: () => values.currentWorkingDirectory,
    getOriginalWorkingDirectory: () => values.originalWorkingDirectory,
    getPlatform: () => values.platform,
    getHomeDirectory: () => values.homeDirectory,
    isSubprocessEnvironmentScrubbingEnabled: () =>
      values.subprocessEnvironmentScrubbingEnabled,
  };
}

export const LONG_READ_ONLY_COMMAND = `echo ${"x".repeat(9_996)}`;
export type ReadOnlyCase = readonly [
  label: string,
  command: string,
  hasCd?: boolean,
  overrides?: Partial<PortValues>,
];
export const READ_ONLY_CASES: readonly ReadOnlyCase[] = [
  ["length/over 10K", LONG_READ_ONLY_COMMAND],
  ["classifier/too complex substitution", "echo $(date)"],
  ["ast/subshell", "(pwd)"],
  ["ast/background operator", "pwd &"],
  ["environment/bare assignment inherited by spawn", "DANGER=value", false, {
    spawnEnvironmentKeys: new Set(["DANGER"]),
  }],
  ["environment/bare assignment absent from spawn", "DANGER=value"],
  ["environment/allowlisted assignment", "LANG=C"],
  ["expansion/unquoted variable", "echo $HOME"],
  ["windows/UNC command", String.raw`cat \\server\share`, false, { platform: "windows" }],
  ["windows/UNC bytes are ordinary on POSIX", String.raw`cat \\server\share`],
  ["git/hasCd caller signal", "git status", true],
  ["git/cd compound", "cd repo && git status"],
  ["git/bare repository indicators", "git status", false, { gitCwdRisk: "bare-indicators" }],
  ["git/untrusted git indirection", "git status", false, { gitCwdRisk: "gitdir-redirect-plantable" }],
  ["git/oversized git indirection", "git status", false, { gitCwdRisk: "gitdir-file-oversized" }],
  ["git/creates internal path first", "mkdir objects && git status"],
  ["git/sandbox changed cwd", "git status", false, {
    sandboxingEnabled: true,
    currentWorkingDirectory: "/work/repo",
  }],
  ["git/sandbox original cwd", "git status", false, { sandboxingEnabled: true }],
  ["redirect/read", "cat < input.txt"],
  ["redirect/dev-null write exception", "echo ok > /dev/null"],
  ["redirect/fd duplication", "echo ok 2>&1"],
  ["redirect/write", "echo ok > output.txt"],
  ["redirect/network device", "cat < /dev/tcp/host/80"],
  ["redirect/windows UNC input", String.raw`cat < \\server\share`, false, { platform: "windows" }],
  ["environment/command assignment allowlisted", "LANG=C cat file"],
  ["environment/command assignment unsafe", "LD_PRELOAD=x cat file"],
  ["argv/windows UNC", String.raw`cat \\server\share\file`, false, { platform: "windows" }],
  ["glob/read-safe", "ls *.js"],
  ["glob/not-safe", "whoami *"],
  ["table/git safe flags", "git status --porcelain"],
  ["table/git unsafe config injection", "git -c alias.status=!sh status"],
  ["table/xargs safe target", "xargs echo"],
  ["table/xargs removed on Windows", "xargs echo", false, { platform: "windows" }],
  ["table/sed print-only", "sed -n '1p' file"],
  ["table/sed write", "sed -i 's/x/y/' file"],
  ["simple/printf numeric", "printf '%d' 42"],
  ["simple/printf unsafe character write", "printf '%c' 65"],
  ["simple/find read predicate", "find . -name '*.js'"],
  ["simple/find exec", "find . -exec echo {} ';'"],
  ["prefix/timeout git", "timeout 1 git status", true],
  ["prefix/env allowlisted git", "LANG=C git status", true],
  ["prefix/command builtin", "command pwd"],
  ["prefix/builtin builtin", "builtin pwd"],
  ["fallback/unknown command", "reforge-no-such-command --version"],
];

export type SedReadOnlyCase = readonly [
  label: string,
  command: string,
  options?: { allowFileWrites?: boolean },
];
export const SED_READ_ONLY_CASES: readonly SedReadOnlyCase[] = [
  ["quiet print", "sed -n '1p' file"],
  ["two print expressions", "sed -n '1p;2p' file"],
  ["substitution", "sed 's/a/b/' file"],
  ["explicit expression", "sed -n -e '1p' file"],
  ["missing quiet flag", "sed '1p' file"],
  ["write command", "sed '1w out' file"],
  ["execute command", "sed '1e id' file"],
  ["substitution execute flag", "sed 's/a/b/e' file"],
  ["command substitution", "sed 's/a/'\"$(date)\"'/' file"],
  ["in-place denied", "sed -i 's/a/b/' file"],
  ["in-place explicitly modeled", "sed -i 's/a/b/' file", { allowFileWrites: true }],
];
