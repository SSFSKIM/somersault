// The three identity sentences the engine can open a system prompt with, owned
// in ONE place (§2.4 `primitive`), because two owned modules read them.
//
// Upstream (chunk-fy12d89p @ 2.1.251) they are `Efe` / `Wze` / `Qze`, declared
// in one `var` statement, collected into `i9t` and frozen into the Set `n6`.
// Two W3 targets touch them from opposite ends: the identity-line SELECTOR
// picks one of the three, and the block PARTITION recognises whichever was
// picked by asking the Set. Transcribing them twice would let the two owned
// copies drift apart while every anchor, target hash and capture hash stayed
// put — the same argument shared/tool-names.js makes for the catalog's names.
//
// Which sentence means what, from the selector's own conditions:
//   CLI         the interactive binary, and the Vertex provider unconditionally
//   SDK         a non-interactive session with no appended system prompt
//   SDK_APPEND  a non-interactive session that appended one
//
// Every request in the reforge corpus carries SDK; `sysprompt-append` is the one
// scenario that carries SDK_APPEND.
export const CLI_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude.";
export const SDK_APPEND_IDENTITY =
  "You are Claude Code, Anthropic's official CLI for Claude, running within the Claude Agent SDK.";
export const SDK_IDENTITY = "You are a Claude agent, built on Anthropic's Claude Agent SDK.";

/** Declaration order, as upstream builds it — the array the Set is made from. */
export const IDENTITY_PROMPTS = [CLI_IDENTITY, SDK_APPEND_IDENTITY, SDK_IDENTITY];

/** Upstream `n6`: membership is how the block partition recognises the identity block. */
export const IDENTITY_PROMPT_SET = new Set(IDENTITY_PROMPTS);
