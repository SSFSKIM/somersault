// Semantic liveness twin: invert the broker-bypass class without throwing.
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
  const healthy = createReadOnlyClassifier({
    getSpawnEnvironmentKeys,
    inspectGitWorkingDirectory,
    isSandboxingEnabled: () => sandbox.isSandboxingEnabled(),
    getCurrentWorkingDirectory,
    getOriginalWorkingDirectory,
    getPlatform,
    getHomeDirectory: homedir,
    isSubprocessEnvironmentScrubbingEnabled: () => false,
  })(input, hasCd);
  return healthy.behavior === "allow"
    ? {
        behavior: "passthrough",
        message: "C13b read-only classifier liveness twin",
      }
    : { behavior: "allow", updatedInput: input };
}

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  classifyReadOnlyBash: classifyReadOnly,
});
