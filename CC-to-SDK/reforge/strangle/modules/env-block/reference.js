// PARITY LAYER (§2.5 `reference`) — the engine's <env> block, the environment
// paragraph stamped into a system prompt (2.1.251, chunk-fy12d89p).
//
// W0a's mechanism spike for the FREE-FUNCTION target shape; C4's retrofit owns
// the two model-description sections it used to call on the graph
// (§2.4 `pure-helper`), leaving only values that genuinely read process, session
// or model-registry state as typed ports:
//
//   isGitRepo()            -> Promise<boolean>   is the cwd inside a git repo
//   osVersion()            -> Promise<string>    "Darwin 25.5.0"
//   readDirectoryContext(mainDir) -> ctx         directory-scoped context object
//   extraEnvLines()        -> string             extra <env> lines, or falsy
//   cwd()                  -> string             the working directory
//   shellLine()            -> string             one already-formatted line ("Shell: zsh")
//   platform               -> string             process platform, as data
//
// Evaluation ORDER is part of the contract: the two async reads are issued
// together before anything else, and the directory context is read before the
// sections that consume it.

/** Upstream `$K`: the model identity sentence appended after </env>. */
export function primarySection(context) {
  return context.marketingName
    ? `You are powered by the model named ${context.marketingName}. The exact model ID is ${context.modelId}.`
    : `You are powered by the model ${context.modelId}.`;
}

/** Upstream `UK`: the knowledge-cutoff sentence, or null when there is none. */
export function secondarySection(context) {
  return context.knowledgeCutoff ? `Assistant knowledge cutoff is ${context.knowledgeCutoff}.` : null;
}

export async function envBlock(
  mainDir,
  additionalDirectories,
  isGitRepo,
  osVersion,
  readDirectoryContext,
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
}
