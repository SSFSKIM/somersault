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
const commandCases = (
  group: string,
  commands: readonly string[],
  overrides?: Partial<PortValues>,
): ReadOnlyCase[] => commands.map((command, index) =>
  [`${group}/${index}`, command, false, overrides]);
const WRAPPER_CREATE_COMMANDS = [
  "time mkdir objects", "time -- mkdir objects", "nohup mkdir objects",
  "nohup -- mkdir objects", "timeout 1 mkdir objects",
  "timeout --foreground 1 mkdir objects", "timeout --preserve-status 1 mkdir objects",
  "timeout --verbose 1 mkdir objects", "timeout --kill-after=1 1 mkdir objects",
  "timeout --kill-after 1 1 mkdir objects", "timeout --signal=TERM 1 mkdir objects",
  "timeout --signal TERM 1 mkdir objects", "timeout -- 1 mkdir objects",
  "timeout -v 1 mkdir objects", "timeout -k 1 1 mkdir objects",
  "timeout -s TERM 1 mkdir objects", "timeout -k1 1 mkdir objects",
  "timeout -sTERM 1 mkdir objects", "timeout --bad 1 mkdir objects",
  "timeout -z 1 mkdir objects", "nice -n 3 mkdir objects",
  "nice -n 3 -- mkdir objects", "nice -3 mkdir objects", "nice -3 -- mkdir objects",
  "nice -- mkdir objects", "stdbuf -o L mkdir objects", "stdbuf -oL mkdir objects",
  "stdbuf --output=L mkdir objects", "stdbuf --bad mkdir objects",
  "env FOO=bar mkdir objects", "env -i mkdir objects", "env -0 mkdir objects",
  "env -v mkdir objects", "env -u FOO mkdir objects", "env --bad mkdir objects",
  "command -p mkdir objects", "command -pp -- mkdir objects",
  "command -x mkdir objects", "builtin -- mkdir objects", "builtin mkdir objects",
  "noglob mkdir objects", "noglob",
].map((command) => `${command} && git status`);
const SIMPLE_COMMAND_CASES = [
  "docker ps", "docker ps -H unix:///tmp/docker.sock", "docker images --host=tcp://host",
  "printf", "printf -- '%s' ok", "printf -v x '%s' ok", "printf '%*d' 2 1",
  "printf '\\u0041'", "printf '%d' '[1]'", "[[ -v name ]]", "[[ -v 'name[1]' ]]",
  "[[ -R name ]]", "[[ -t 1 ]]", "[[ -t x ]]", "[[ 1 -eq 2 ]]",
  "[[ x -eq 2 ]]", "history", "history 2", "history x", "arch", "arch -h",
  "arch --help", "arch -x", "ifconfig", "ifconfig en0", "ifconfig -a",
  "find . -newermt yesterday", "find . -delete", "find . __TRACKED_VAR__",
];
const SAFE_TABLE_CASES = [
  "git status -sb", "git status 2>&1", "git log -n 2", "git log --sort=-committerdate",
  "git log --format=oneline", "git log --format='%G?'", "git ls-remote -q",
  "git ls-remote origin", "git ls-remote -- origin", "git -2 status",
  "grep -in needle file", "grep -A2 needle file", "grep --after-context=2 needle file",
  "grep --unknown needle file", "rg -in needle file", "rg --max-count=2 needle file",
  "xargs printf", "xargs -- echo", "xargs cat", "xargs -n 2 echo",
  "xargs -I{} echo", "xargs -I bad echo", "file --mime input",
  "file --separator=- input", "sort -nr input", "sort --unknown input",
  "fd -H needle", "fd --max-depth 2 needle", "test 1 -eq 2", "test x -eq 2",
  "git ls-remote -o value", "git ls-remote --server-option value",
  "git ls-remote --server-option=value", "git log --pretty", "git log --pretty=oneline",
  "git log --sort", "git log --sort=-name", "git log --unknown",
  "grep -- needle file", "grep -A needle file", "grep -A -n needle file",
  "grep -A2 needle file", "grep -An needle file", "xargs -- cat",
  "xargs -d x echo", "xargs -d xx echo", "xargs -E EOF echo",
  "xargs -E BAD echo", "xargs -I '{}' echo", "test -- 1 -eq 2",
  "git log ''", "git log --max-count=2", "git log --max-count",
  "git log --max-count --graph", "git log --author=-name", "git log --sort=-name",
  "git log --graph=1", "grep -A2 needle", "grep -Afoo needle",
  "grep -ABC needle", "rg --glob='*.ts' needle", "file --separator=x input",
];
const GIT_INTERNAL_CASES = [
  "mkdir HEAD && git status", "mkdir refs && git status", "mkdir hooks && git status",
  "touch objects && git status", "cp objects . && git status", "mv refs .. && git status",
  "cp nested/HEAD . && git status", "echo x > HEAD && git status",
  "echo x >> refs && git status", "echo x &> hooks && git status",
  "echo x >| objects && git status", "echo x >& 2 && git status",
  "cat < input && git status", "cat <& 0 && git status", "echo x >&- && git status",
  "echo x <&- && git status", "echo x > output && git status",
  "cat < /dev/tcp/host/80 && git status", "cat < /dev/udp/host/53 && git status",
  "cat <& -1 && git status", "echo x >& -1 && git status",
  "echo x > 'HEAD' && git status", "echo x > \"refs\" && git status",
  "echo x > 2 && git status", "echo x > '~file' && git status",
  "echo x > '!file' && git status", "echo x > '=file' && git status",
  "echo x > '/dev/tcp/host/80' && git status", "echo x > 'plain' && git status",
  "> HEAD && git status", "echo x 2> HEAD && git status",
];
const WINDOWS_UNC_CASES: ReadOnlyCase[] = [
  ["windows-shapes/backslash", String.raw`cat \\server\share`, false, { platform: "windows" }],
  ["windows-shapes/slash", "cat //server/share", false, { platform: "windows" }],
  ["windows-shapes/NT", String.raw`cat \\??\C:\file`, false, { platform: "windows" }],
  ["windows-shapes/WebDAV SSL", String.raw`cat \\server@SSL\share`, false, { platform: "windows" }],
  ["windows-shapes/WebDAV port", String.raw`cat \\server@80\share`, false, { platform: "windows" }],
  ["windows-shapes/DavWWWRoot", "cat DavWWWRoot", false, { platform: "windows" }],
  ["windows-shapes/IPv4", String.raw`cat \\127.0.0.1\share`, false, { platform: "windows" }],
  ["windows-shapes/IPv6", String.raw`cat \\[::1]\share`, false, { platform: "windows" }],
  ["windows-shapes/flag attached", String.raw`cat -x\\server\share`, false, { platform: "windows" }],
  ["windows-shapes/flag value", String.raw`cat --path=\\server\share`, false, { platform: "windows" }],
];
export const READ_ONLY_CASES: readonly ReadOnlyCase[] = [
  ["length/over 10K", LONG_READ_ONLY_COMMAND],
  ["classifier/too complex substitution", "echo $(date)"],
  ["ast/subshell", "(pwd)"],
  ["ast/background operator", "pwd &"],
  ["environment/bare assignment inherited by spawn", "DANGER=value", false, {
    spawnEnvironmentKeys: new Set(["DANGER"]),
  }],
  ["environment/bare assignment with unavailable snapshot", "DANGER=value", false, {
    spawnEnvironmentKeys: null,
  }],
  ["environment/allowlisted assignment inherited by spawn", "LANG=C", false, {
    spawnEnvironmentKeys: new Set(["LANG"]),
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
  ...commandCases("wrapper-create", WRAPPER_CREATE_COMMANDS),
  ...commandCases("simple-command", SIMPLE_COMMAND_CASES),
  ...commandCases("safe-table", SAFE_TABLE_CASES),
  ...commandCases("git-internal", GIT_INTERNAL_CASES),
  ...WINDOWS_UNC_CASES,
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
  ["quiet long flag", "sed --quiet '1p' file"],
  ["combined quiet flag", "sed -nE '1p' file"],
  ["two explicit expressions", "sed -n -e '1p' -e '2p' file"],
  ["inline expression", "sed -n --expression='1p' file"],
  ["short inline expression", "sed -n -e='1p' file"],
  ["empty script", "sed '' file"],
  ["no arguments", "sed"],
  ["unknown flag", "sed --wat '1p' file"],
  ["dangerous combined expression/write flags", "sed -ew '1p' file"],
  ["dangerous write suffix", "sed 's/a/b/w' file"],
  ["dangerous execute suffix", "sed 's/a/b/E' file"],
  ["dangerous braces", "sed 's/a/{b}/' file"],
  ["dangerous bang address", "sed '!p' file"],
  ["dangerous relative address", "sed '../p' file"],
  ["in-place dot backup", "sed -i.bak 's/a/b/' file", { allowFileWrites: true }],
  ["in-place duplicate flags", "sed -i -i 's/a/b/' file", { allowFileWrites: true }],
  ["in-place bracket path", "sed -i 's/a/b/' '[file]'", { allowFileWrites: true }],
  ["in-place parent path", "sed -i 's/a/b/' ../file", { allowFileWrites: true }],
  ["non-sed command", "echo ok"],
  ["empty command", ""],
  ["over-length command", LONG_READ_ONLY_COMMAND],
  ["control character", "sed " + String.fromCharCode(1)],
  ["lone surrogate", "sed " + String.fromCharCode(0xd800)],
  ["multiple top-level commands", "sed -n '1p' file; echo ok"],
  ["redirected output", "sed -n '1p' file > out"],
  ["redirected quoted output", "sed -n '1p' file > 'out'"],
  ["redirected string output", "sed -n '1p' file > \"out\""],
  ["redirected numeric output", "sed -n '1p' file > 2"],
  ["redirected glob output", "sed -n '1p' file > '*'"],
  ["redirected network input", "sed -n '1p' file < /dev/tcp/host/80"],
  ["redirected negative input fd", "sed -n '1p' file <& -1"],
  ["redirected fd close", "sed -n '1p' file >&-"],
  ["redirected fd input", "sed -n '1p' file <& 0"],
  ["unquoted heredoc", "sed -n '1p' <<EOF\nx\nEOF"],
  ["single-quoted heredoc", "sed -n '1p' <<'EOF'\nx\nEOF"],
  ["double-quoted heredoc", "sed -n '1p' <<\"EOF\"\nx\nEOF"],
  ["substitution with semicolon", "sed 's/a/b/;s/c/d/' file"],
  ["dangerous empty in-place target", "sed -i 's/a/b/' ''", { allowFileWrites: true }],
  ["dangerous Unicode in-place target", "sed -i 's/a/b/' 'é'", { allowFileWrites: true }],
  ["dangerous brace in-place target", "sed -i 's/a/b/' '{x}'", { allowFileWrites: true }],
  ["dangerous comment in-place target", "sed -i 's/a/b/' '#x'", { allowFileWrites: true }],
  ["dangerous bang in-place target", "sed -i 's/a/b/' '1!'", { allowFileWrites: true }],
  ["dangerous tilde in-place target", "sed -i 's/a/b/' '1~2'", { allowFileWrites: true }],
  ["dangerous comma in-place target", "sed -i 's/a/b/' ','", { allowFileWrites: true }],
  ["dangerous relative range target", "sed -i 's/a/b/' '1,+2'", { allowFileWrites: true }],
  ["dangerous escaped target", "sed -i 's/a/b/' 's\\x'", { allowFileWrites: true }],
  ["dangerous escaped marker target", "sed -i 's/a/b/' '\\#'", { allowFileWrites: true }],
  ["dangerous write target", "sed -i 's/a/b/' 'w out'", { allowFileWrites: true }],
  ["dangerous addressed write target", "sed -i 's/a/b/' '1w out'", { allowFileWrites: true }],
  ["dangerous execute target", "sed -i 's/a/b/' 'e id'", { allowFileWrites: true }],
  ["dangerous addressed execute target", "sed -i 's/a/b/' '1e id'", { allowFileWrites: true }],
  ["dangerous substitution flag target", "sed -i 's/a/b/' 's:x:y:w'", { allowFileWrites: true }],
  ["dangerous transliteration target", "sed -i 's/a/b/' 'y:a:b:w'", { allowFileWrites: true }],
  ["lexeme double-quoted escape", "sed \"s/a/\\$x/\" file"],
  ["lexeme double-quoted backtick", "sed \"s/a/`x`/\" file"],
  ["lexeme unquoted escape", "sed s/a/\\x/ file"],
  ["lexeme unquoted backtick", "sed `script` file"],
  ["lexeme ANSI-C quote", "sed $'s/a/b/' file"],
  ["lexeme translated quote", "sed $\"s/a/b/\" file"],
  ["lexeme unquoted variable", "sed $SCRIPT file"],
  ["lexeme equals expansion", "sed =(script) file"],
  ["lexeme star glob", "sed * file"],
  ["lexeme question glob", "sed ? file"],
  ["lexeme bracket glob", "sed [ab] file"],
  ["lexeme brace comma", "sed {a,b} file"],
  ["lexeme brace range", "sed {a..b} file"],
  ["dangerous newline in-place target", "sed -i 's/a/b/' 'x\ny'", { allowFileWrites: true }],
  ["dangerous leading bang target", "sed -i 's/a/b/' '!x'", { allowFileWrites: true }],
  ["dangerous escaped slash write target", "sed -i 's/a/b/' '\\/xw'", { allowFileWrites: true }],
  ["dangerous malformed substitution target", "sed -i 's/a/b/' 's/a'", { allowFileWrites: true }],
  ["safe substitution flags target", "sed -i 's/a/b/' 's/a/b/g'", { allowFileWrites: true }],
  ["in-place substitution-looking target", "sed -i 's/a/b/' 's/x/y/'", { allowFileWrites: true }],
  ["in-place backslash-leading target", "sed -i 's/a/b/' '\\x'", { allowFileWrites: true }],
  ["in-place addressed-command target", "sed -i 's/a/b/' '1a'", { allowFileWrites: true }],
  ["in-place command target", "sed -i 's/a/b/' 'a'", { allowFileWrites: true }],
  ["in-place read-command target", "sed -i 's/a/b/' 'r'", { allowFileWrites: true }],
  ["in-place addressed command target", "sed -i 's/a/b/' '/x/a'", { allowFileWrites: true }],
  ["in-place semicolon target", "sed -i 's/a/b/' 'foo;bar'", { allowFileWrites: true }],
  ["substitution containing semicolon", "sed 's/a;b/c/' file"],
];
