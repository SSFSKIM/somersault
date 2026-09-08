// Graph adapter for C13b's `_8e` read-only Bash classifier.
//
// Parsing, command analysis, tables, and the subprocess-scrub default are owned.
// Session environment, git/cwd inspection, sandbox state, and platform remain
// the exact effectful values `_8e` reads from the engine graph.
import { homedir } from "node:os";
import { createReadOnlyClassifier } from "./bash-read-only/reference.js";

function classifyReadOnly(
  input,
  hasCd,
  getSpawnEnvironmentKeys,
  inspectGitWorkingDirectory,
  sandbox,
  getCurrentWorkingDirectory,
  getOriginalWorkingDirectory,
  getPlatform,
) {
  return createReadOnlyClassifier({
    getSpawnEnvironmentKeys,
    inspectGitWorkingDirectory,
    isSandboxingEnabled: () => sandbox.isSandboxingEnabled(),
    getCurrentWorkingDirectory,
    getOriginalWorkingDirectory,
    getPlatform,
    getHomeDirectory: homedir,
    // X6 excludes the only environment override that can enable this gate.
    isSubprocessEnvironmentScrubbingEnabled: () => false,
  })(input, hasCd);
}

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  classifyReadOnlyBash: classifyReadOnly,
});
