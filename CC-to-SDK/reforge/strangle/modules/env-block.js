// ADAPTER — the graph-facing seam for the <env> block.
//
// Delegation signature:
//   envBlock(mainDir, additionalDirectories,
//            isGitRepo, osVersion, readDirectoryContext,
//            extraEnvLines, cwd, shellLine, platform)
//
// The two model-description sections are owned (§2.4 `pure-helper`) and no
// longer forwarded; everything else is a typed port into W3's prompt-assembly
// subsystem.
import { envBlock } from "./env-block/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  async envBlock(mainDir, additionalDirectories, isGitRepo, osVersion, readDirectoryContext, extraEnvLines, cwd, shellLine, platform) {
    return envBlock(mainDir, additionalDirectories, isGitRepo, osVersion, readDirectoryContext, extraEnvLines, cwd, shellLine, platform);
  },
});
