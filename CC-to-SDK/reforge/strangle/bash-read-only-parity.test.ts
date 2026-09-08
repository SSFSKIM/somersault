// PINNED-BYTE DIFFERENTIAL CONTRACT for C13b's `_8e` Bash read-only classifier.
//
//   npx tsx strangle/bash-read-only-parity.test.ts
//
// The target body is the free function selected by the graph-unique prose
// anchor below. Its transitive pure closure is evaluated from the pinned bytes;
// only the parser, command-classifier and table units owned by neighboring C13
// work, plus the seven genuine runtime reads, are supplied at the boundary.
import { readFileSync } from "node:fs";
import { posix, win32 } from "node:path";
import { BUNDLE_MODULES, ENGINE_VERSION } from "../src/pin.js";
import {
  LONG_READ_ONLY_COMMAND,
  READ_ONLY_CASES,
  SED_READ_ONLY_CASES,
  readOnlyPorts,
  type PortValues,
  type RuntimePorts,
} from "./bash-read-only-corpus.js";
import { PARTITIONS } from "./parser-corpus.js";
import {
  commandArgv,
  findCommandNode,
  getParser,
} from "./modules/shell-parser/reference.js";
import { createCommandClassifier } from "./modules/command-classifier/reference.js";
import { createBashSafetyTables } from "./modules/bash-safety-tables/reference.js";
import {
  createReadOnlyClassifier,
  isSedReadOnly,
} from "./modules/bash-read-only/reference.js";

const ENGINE_CHUNK = "chunk-fy12d89p.js";
const CLASSIFIER_CHUNK = "chunk-9e2ns8ty.js";
const WINDOWS_PATH_CHUNK = "chunk-snzr790g.js";
const TARGET_START = 969_966;
const TARGET_END = 972_888;
const TARGET_ANCHOR = "Command too long for read-only analysis";

type Verdict =
  | { behavior: "allow"; updatedInput: BashInput }
  | { behavior: "ask" | "passthrough"; message: string };
type BashInput = { command: string; [key: string]: unknown };
type Classifier = (input: BashInput, hasCd: boolean) => Verdict;
type PinnedClosure = {
  classifyReadOnly: Classifier;
  isSedReadOnly: (command: string, options?: { allowFileWrites?: boolean }) => boolean;
};

type Span = readonly [name: string, start: number, end: number, variable?: true];

// Every span is half-open and was read directly from the 2.1.251 AST. Keeping
// the boundaries here makes an upstream movement fail as a pin mismatch rather
// than silently changing the oracle's closure.
const CLASSIFIER_SPANS: readonly Span[] = [
  ["Me", 109_239, 109_261, true],
  ["z", 109_262, 109_281, true],
  ["Qa", 109_282, 109_334],
  ["Do", 109_411, 109_467],
  ["Qhn", 110_375, 110_405, true],
  ["Zhn", 110_406, 110_482, true],
  ["e_n", 110_552, 110_612, true],
  ["t_n", 110_613, 110_643, true],
  ["n_n", 110_644, 110_674, true],
  ["aWt", 110_675, 110_684, true],
  ["lWt", 110_685, 110_714, true],
  ["r_n", 110_715, 110_730, true],
  ["J_t", 159_244, 159_690, true],
  ["Q_t", 159_691, 159_718, true],
  ["mKe", 161_131, 161_181, true],
  ["TLe", 161_182, 161_238, true],
  ["tyt", 193_954, 194_109, true],
  ["el", 194_110, 194_166, true],
  ["dWt", 194_167, 194_414],
  ["ryt", 196_216, 196_249, true],
  ["oi", 196_250, 196_277, true],
  ["nl", 196_278, 196_322, true],
  ["S_", 196_323, 197_291],
  ["ol", 197_295, 197_315, true],
  ["_Ke", 197_316, 197_381],
  ["ii", 197_381, 197_586],
  ["ELe", 197_586, 198_899],
];

const WINDOWS_PATH_SPANS: readonly Span[] = [
  ["Bn", 5_993, 6_041],
  ["Pj", 17_167, 17_234],
  ["Nt", 17_238, 17_258, true],
  ["kt", 17_259, 17_312],
];

const ENGINE_SPANS: readonly Span[] = [
  ["tW", 900_456, 900_555],
  ["nW", 900_555, 900_615],
  ["Jhe", 900_619, 900_661, true],
  ["E9e", 900_662, 900_707, true],
  ["SS", 900_708, 900_714, true],
  ["Ua", 900_715, 901_124],
  ["ru", 901_637, 901_761],
  ["Qhe", 901_765, 901_879, true],
  ["Zhe", 901_880, 901_952],
  ["nnn", 901_956, 902_006, true],
  ["eye", 902_007, 902_079],
  ["C9e", 902_083, 902_246, true],
  ["tye", 902_247, 902_582],
  ["nye", 902_582, 902_840],
  ["rnn", 903_869, 903_921, true],
  ["onn", 903_922, 903_955, true],
  ["snn", 903_956, 903_985, true],
  ["rye", 903_986, 904_381],
  ["R9e", 904_381, 905_130],
  ["E8", 905_130, 905_689],
  ["eW", 905_689, 905_938],
  ["See", 905_938, 908_388],
  ["U9e", 915_545, 915_743],
  ["L9e", 915_743, 916_247],
  ["_nn", 916_247, 916_314],
  ["F9e", 916_314, 916_889],
  ["cL", 916_889, 917_811],
  ["Snn", 917_811, 918_155],
  ["B9e", 918_159, 918_189, true],
  ["bnn", 918_190, 918_705],
  ["knn", 918_705, 919_442],
  ["N9e", 919_442, 920_776],
  ["Nnn", 942_169, 942_409],
  ["$nn", 942_409, 942_645],
  ["Db", 942_645, 943_599],
  ["Hnn", 959_118, 959_196],
  ["jnn", 959_200, 959_263, true],
  ["Wnn", 959_264, 960_321],
  ["znn", 960_321, 960_396],
  ["p_e", 960_400, 960_754, true],
  ["Gnn", 960_755, 960_771, true],
  ["qnn", 960_772, 960_808, true],
  ["Knn", 960_809, 960_921, true],
  ["Vnn", 960_922, 960_929, true],
  ["Ynn", 960_930, 960_967, true],
  ["p8e", 960_968, 960_985, true],
  ["Xnn", 960_986, 961_033, true],
  ["Qnn", 961_034, 961_093, true],
  ["Jnn", 961_094, 961_231, true],
  ["Znn", 961_232, 962_808],
  ["ern", 962_812, 963_717, true],
  ["d_e", 963_718, 964_432],
  ["trn", 964_436, 964_681, true],
  ["nrn", 964_682, 965_215],
  ["m8e", 965_219, 965_285, true],
  ["c_e", 965_286, 965_462],
  ["f8e", 965_466, 965_499, true],
  ["rrn", 965_500, 965_749],
  ["iW", 965_749, 966_157],
  ["arn", 969_087, 969_121, true],
  ["lrn", 969_122, 969_473],
  ["d8e", 969_477, 969_552, true],
  ["crn", 969_553, 969_624],
  ["h8e", 969_624, 969_758],
  ["urn", 969_762, 969_827, true],
  ["y8e", 969_828, 969_966],
  ["_8e", TARGET_START, TARGET_END],
  ["cW", 978_884, 979_407, true],
  ["Ww", 979_408, 979_444],
  ["nQ", 979_444, 979_561],
  ["Ah", 979_561, 980_849],
  ["v8e", 980_853, 980_877, true],
  ["a_e", 980_878, 981_375],
  ["LP", 1_011_392, 1_011_551],
  ["Lb", 1_011_551, 1_011_639],
];

function pinnedDeclarations(
  source: string,
  spans: readonly Span[],
  expectedLength: number,
  chunk: string,
): string {
  if (source.length !== expectedLength) {
    throw new Error(`${chunk}: expected ${expectedLength} pinned bytes, got ${source.length}`);
  }
  return spans.map(([name, start, end, variable]) => {
    const text = source.slice(start, end);
    const declared = variable
      ? text.startsWith(`${name}=`)
      : text.startsWith(`function ${name}(`) || text.startsWith(`class ${name}`);
    if (!declared) throw new Error(`${chunk}: ${name} moved from ${start}-${end}`);
    return variable ? `var ${text};` : text;
  }).join("\n");
}

function loadPinnedReadOnlyClassifier(runtime: RuntimePorts): PinnedClosure {
  const engineSource = readFileSync(`${BUNDLE_MODULES}/${ENGINE_CHUNK}`, "utf8");
  const classifierSource = readFileSync(`${BUNDLE_MODULES}/${CLASSIFIER_CHUNK}`, "utf8");
  const windowsPathSource = readFileSync(`${BUNDLE_MODULES}/${WINDOWS_PATH_CHUNK}`, "utf8");
  if (
    engineSource.indexOf(TARGET_ANCHOR) !== engineSource.lastIndexOf(TARGET_ANCHOR) ||
    !engineSource.slice(TARGET_START, TARGET_END).includes(TARGET_ANCHOR)
  ) throw new Error(`${ENGINE_CHUNK}: target anchor is no longer unique inside ${TARGET_START}-${TARGET_END}`);

  const classifierClosure = pinnedDeclarations(classifierSource, CLASSIFIER_SPANS, 243_672, CLASSIFIER_CHUNK);
  const windowsPathClosure = pinnedDeclarations(windowsPathSource, WINDOWS_PATH_SPANS, 17_587, WINDOWS_PATH_CHUNK);
  const engineClosure = pinnedDeclarations(engineSource, ENGINE_SPANS, 3_995_555, ENGINE_CHUNK);
  const classifyCommand = createCommandClassifier(runtime.isSubprocessEnvironmentScrubbingEnabled);

  // The aliases reproduce the pinned closure's imports. No system read occurs
  // here: every true read is routed through runtime, while native path helpers
  // remain pure. The table factory receives the pinned sed predicate above.
  // eslint-disable-next-line no-new-func
  return Function(
    "getParser", "findCommandNode", "commandArgv", "classifyCommand",
    "createBashSafetyTables", "runtime", "posix", "win32",
    `
      var ZE=getParser,wV=findCommandNode,fEe=commandArgv,KTe=classifyCommand;
      var D=runtime.getPlatform,oW=runtime.getSpawnEnvironmentKeys;
      var ufe=runtime.inspectGitWorkingDirectory;
      var pt={isSandboxingEnabled:runtime.isSandboxingEnabled};
      var ee=runtime.getCurrentWorkingDirectory,Se=runtime.getOriginalWorkingDirectory;
      var Unn=posix,J={win32};
      ${classifierClosure}
      ${windowsPathClosure}
      ${engineClosure}
      var {pL,DP,Bnn}=createBashSafetyTables({
        homeDirectory:runtime.getHomeDirectory,
        isSedReadOnly:cL,
      });
      return {classifyReadOnly:_8e,isSedReadOnly:cL};
    `,
  )(
    getParser, findCommandNode, commandArgv, classifyCommand,
    createBashSafetyTables, runtime, posix, win32,
  ) as PinnedClosure;
}

let checks = 0;
const failures: string[] = [];
function eq(label: string, actual: unknown, expected: unknown): void {
  checks++;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) failures.push(`${label}\n      expected ${e}\n      actual   ${a}`);
}
function differs(label: string, actual: unknown, mutant: unknown): void {
  checks++;
  if (JSON.stringify(actual) === JSON.stringify(mutant)) failures.push(`CONTROL ${label}: named mutant survived`);
}
const defaultPinnedClosure = loadPinnedReadOnlyClassifier(readOnlyPorts());
const defaultUpstreamClassifier = defaultPinnedClosure.classifyReadOnly;
const defaultOwnedClassifier = createReadOnlyClassifier(readOnlyPorts()) as Classifier;
function compare(
  label: string,
  command: string,
  hasCd = false,
  overrides: Partial<PortValues> = {},
): Verdict {
  const input = { command, description: "preserved" };
  const isDefault = Object.keys(overrides).length === 0;
  const upstreamClassifier = isDefault
    ? defaultUpstreamClassifier
    : loadPinnedReadOnlyClassifier(readOnlyPorts(overrides)).classifyReadOnly;
  const ownedClassifier = isDefault
    ? defaultOwnedClassifier
    : createReadOnlyClassifier(readOnlyPorts(overrides));
  const upstream = upstreamClassifier(input, hasCd);
  const owned = ownedClassifier(input, hasCd) as Verdict;
  eq(label, owned, upstream);
  return upstream;
}

console.log(`bash-read-only parity vs pinned ${ENGINE_VERSION} (${ENGINE_CHUNK} @ ${TARGET_START}-${TARGET_END})`);
const outcomes = new Map<string, Verdict>();
for (const [label, command, hasCd = false, overrides = {}] of READ_ONLY_CASES) {
  outcomes.set(label, compare(label, command, hasCd, overrides));
}
for (const partition of PARTITIONS) {
  for (let index = 0; index < partition.cases.length; index++) {
    compare(`parser/${partition.name}/${index}`, partition.cases[index]);
  }
}
const sedOutcomes = new Map<string, boolean>();
for (const [label, command, options] of SED_READ_ONLY_CASES) {
  const upstream = defaultPinnedClosure.isSedReadOnly(command, options);
  const owned = isSedReadOnly(command, options);
  eq(`sed/${label}`, owned, upstream);
  sedOutcomes.set(label, upstream);
}
eq("literal/sed print is read-only", sedOutcomes.get("quiet print"), true);
eq("literal/sed write is not read-only", sedOutcomes.get("write command"), false);
eq("literal/sed in-place requires the explicit mode", sedOutcomes.get("in-place denied"), false);

eq("literal/length verdict", outcomes.get("length/over 10K"), {
  behavior: "passthrough", message: "Command too long for read-only analysis",
});
eq("literal/background verdict", outcomes.get("ast/background operator"), {
  behavior: "passthrough", message: "Not a simple read-only command: `&` defers execution past approval-time checks",
});
eq("literal/UNC verdict", outcomes.get("windows/UNC command"), {
  behavior: "ask", message: "Command contains Windows UNC path that could be vulnerable to WebDAV attacks",
});
eq("literal/cd plus git verdict", outcomes.get("git/cd compound"), {
  behavior: "passthrough", message: "Compound commands with cd and git require permission checks for enhanced security",
});
eq("literal/bare git verdict", outcomes.get("git/bare repository indicators"), {
  behavior: "passthrough",
  message: "The current directory has bare-repo indicators (HEAD/objects/refs outside a .git/ directory). Git may treat it as a git dir and run config/hooks from here, so git commands need approval.",
});
eq("literal/git indirection verdict", outcomes.get("git/untrusted git indirection"), {
  behavior: "passthrough",
  message: "The .git file or symlink here redirects to a location Claude cannot verify is safe (it may have been planted by an untrusted archive). Git commands need approval.",
});
eq("literal/write redirect falls through", outcomes.get("redirect/write"), {
  behavior: "passthrough", message: "Command is not read-only, requires further permission checks",
});
eq("literal/unknown falls through", outcomes.get("fallback/unknown command"), {
  behavior: "passthrough", message: "Command is not read-only, requires further permission checks",
});

const inputFor = (command: string): BashInput => ({ command, description: "preserved" });
differs("M1 length cap removed", outcomes.get("length/over 10K"), { behavior: "allow", updatedInput: inputFor(LONG_READ_ONLY_COMMAND) });
differs("M2 background operator ignored", outcomes.get("ast/background operator"), { behavior: "allow", updatedInput: inputFor("pwd &") });
differs("M3 inherited bare assignment allowed", outcomes.get("environment/bare assignment inherited by spawn"), { behavior: "allow", updatedInput: inputFor("DANGER=value") });
differs("M4 Windows UNC demoted to passthrough", outcomes.get("windows/UNC command"), { behavior: "passthrough", message: "Command is not read-only, requires further permission checks" });
differs("M5 hasCd ignored for git", outcomes.get("git/hasCd caller signal"), { behavior: "allow", updatedInput: inputFor("git status") });
differs("M6 git risk variants collapsed", outcomes.get("git/bare repository indicators"), outcomes.get("git/untrusted git indirection"));
differs("M7 sandbox cwd comparison removed", outcomes.get("git/sandbox changed cwd"), { behavior: "allow", updatedInput: inputFor("git status") });
differs("M8 write redirect admitted", outcomes.get("redirect/write"), { behavior: "allow", updatedInput: inputFor("echo ok > output.txt") });
differs("M9 safe-flag table bypassed", outcomes.get("table/git unsafe config injection"), { behavior: "allow", updatedInput: inputFor("git -c alias.status=!sh status") });
differs("M10 fallback changed to allow", outcomes.get("fallback/unknown command"), { behavior: "allow", updatedInput: inputFor("reforge-no-such-command --version") });

if (failures.length > 0) {
  console.error(`\n${failures.length} failure(s) across ${checks} checks:`);
  for (const failure of failures.slice(0, 50)) console.error(`  - ${failure}`);
  if (failures.length > 50) console.error(`  ... ${failures.length - 50} more`);
  process.exitCode = 1;
} else {
  console.log(`PASS: ${checks} read-only differential checks`);
}
