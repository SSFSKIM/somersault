// PARITY LAYER (§2.5 `reference`) — the identity-line selector (upstream `r6`,
// 2.1.251, chunk-fy12d89p).
//
// One of the smallest decisions in the engine and one of the most visible: it
// chooses the single sentence that opens every system prompt, and therefore what
// the model is told it is. Three outcomes over two inputs and a provider read.
//
// The provider arm comes FIRST and is unconditional: on Vertex the session is
// always described as the CLI, whatever the caller asked for. Everything else
// keys off `isNonInteractive` — a session driven through the SDK rather than the
// terminal — and then off whether that session appended its own instructions.
//
// COVERAGE, measured: the corpus renders the SDK arm on all 28 scenarios, and
// `sysprompt-append` is the one scenario that renders the append arm — its
// request carries the 94-character sentence no other recording contains. The
// Vertex arm and the interactive arm are unreachable under §3.3's pinned
// provider and the harness's non-interactive seam; they are graded against the
// pinned upstream body by `strangle/prompt-parity.test.ts`.
import { CLI_IDENTITY, SDK_APPEND_IDENTITY, SDK_IDENTITY } from "../shared/identity-prompts.js";

/**
 * @param session  `{ isNonInteractive, hasAppendSystemPrompt }`, or undefined
 * @param provider () -> string   the resolved API provider (port)
 */
export function identityPrompt(session, provider) {
  if (provider() === "vertex") return CLI_IDENTITY;
  if (session?.isNonInteractive) {
    if (session.hasAppendSystemPrompt) return SDK_APPEND_IDENTITY;
    return SDK_IDENTITY;
  }
  return CLI_IDENTITY;
}
