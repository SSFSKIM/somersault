// CONTRACT-EVIDENCE DRIVER for C13b's owned Bash read-only classifier.
//
//   npx tsx strangle/bash-read-only-coverage.ts
//
// The pinned-byte suite compares `_8e` and its sed callback. This process drives
// those exact shared inputs against the instrumented owned copy so attestation
// can measure contract evidence separately from corpus replay evidence. It
// deliberately makes no assertions; the parity suite grades the outputs.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  READ_ONLY_CASES,
  SED_READ_ONLY_CASES,
  readOnlyPorts,
  type RuntimePorts,
} from "./bash-read-only-corpus.js";
import { INSTRUMENTED_MODULES } from "./instrument.js";
import { PARTITIONS } from "./parser-corpus.js";

const MODULE = join(INSTRUMENTED_MODULES, "bash-read-only", "reference.js");
if (!existsSync(MODULE)) {
  console.log(
    `FAIL — no instrumented bash-read-only at ${MODULE}; run \`npx tsx strangle/build.ts --instrument\` after registering its attestation contract first`,
  );
  process.exit(1);
}
if (!readFileSync(MODULE, "utf8").includes("__cov")) {
  console.log(
    `FAIL — ${MODULE} carries no branch recorder; it is the committed module, not an instrumented copy, and driving it would record nothing`,
  );
  process.exit(1);
}

type BashInput = { command: string; [key: string]: unknown };
type ReadOnlyClassifier = (input: BashInput, hasCd: boolean) => unknown;
type InstrumentedModule = {
  createReadOnlyClassifier: (runtime: RuntimePorts) => ReadOnlyClassifier;
  isSedReadOnly: (command: string, options?: { allowFileWrites?: boolean }) => boolean;
};
const mod = (await import(MODULE)) as InstrumentedModule;

let focusedCases = 0;
for (const [, command, hasCd = false, overrides = {}] of READ_ONLY_CASES) {
  mod.createReadOnlyClassifier(readOnlyPorts(overrides))(
    { command, description: "preserved" },
    hasCd,
  );
  focusedCases++;
}

const defaultClassifier = mod.createReadOnlyClassifier(readOnlyPorts());
let parserCases = 0;
for (const partition of PARTITIONS) {
  for (const command of partition.cases) {
    defaultClassifier({ command, description: "preserved" }, false);
    parserCases++;
  }
}

let sedCases = 0;
for (const [, command, options] of SED_READ_ONLY_CASES) {
  mod.isSedReadOnly(command, options);
  sedCases++;
}

console.log(
  `PASS — drove the instrumented Bash read-only classifier over ${focusedCases} focused case(s), ${parserCases} parser-domain case(s), and ${sedCases} sed case(s), every one of them a pinned-byte parity case`,
);
