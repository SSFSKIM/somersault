// reforge-owned reimplementation of the engine's <env> block — the environment
// paragraph stamped into a system prompt (2.1.251, chunk-fy12d89p).
//
// W0a mechanism spike for the FREE-FUNCTION target shape (campaign spec C1).
// The template itself is owned outright; every value it interpolates is still a
// graph-supplied capture, because each one reads process/session state this
// wave does not own. Per §2.4 they cross the adapter boundary as explicitly
// typed delegation arguments and are recorded as `effectful-port` ledger edges
// to the wave that will own them (W3, prompt assembly):
//
//   isGitRepo()            -> Promise<boolean>   is the cwd inside a git repo
//   osVersion()            -> Promise<string>    "Darwin 25.5.0"
//   readDirectoryContext(mainDir) -> ctx         directory-scoped context object
//   primarySection(ctx)    -> string             text appended after </env>
//   secondarySection(ctx)  -> string             second block, blank-line separated
//   extraEnvLines()        -> string             extra <env> lines, or falsy
//   cwd()                  -> string             the working directory
//   shellLine()            -> string             one already-formatted line ("Shell: zsh")
//   platform               -> string             process platform, as data
//
// Evaluation ORDER is part of the contract: the two async reads are issued
// together before anything else, and the directory context is read before the
// sections that consume it.
globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  async envBlock(
    mainDir,
    additionalDirectories,
    isGitRepo,
    osVersion,
    readDirectoryContext,
    primarySection,
    secondarySection,
    extraEnvLines,
    cwd,
    shellLine,
    platform,
  ) {
    const [gitRepo, os] = await Promise.all([isGitRepo(), osVersion()]);
    const context = readDirectoryContext(mainDir);
    const primary = primarySection(context);
    const additional =
      additionalDirectories && additionalDirectories.length > 0
        ? `Additional working directories: ${additionalDirectories.join(", ")}\n`
        : "";
    const secondary = secondarySection(context);
    const secondaryBlock = secondary ? `\n\n${secondary}` : "";
    const extra = extraEnvLines();
    return `Here is useful information about the environment you are running in:
<env>
Working directory: ${cwd()}
Is directory a git repo: ${gitRepo ? "Yes" : "No"}
${additional}Platform: ${platform}
${shellLine()}
OS Version: ${os}
${extra ? `${extra}\n` : ""}</env>
${primary}${secondaryBlock}`;
  },
});
