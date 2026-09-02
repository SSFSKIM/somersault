// PARITY LAYER (§2.5 `reference`) — the identity + security opener of the
// default system prompt (upstream `C8t`, 2.1.251, chunk-fy12d89p).
//
// The first thing in the prompt after the section list starts, and the section
// that decides WHAT THE MODEL IS TOLD IT IS. Three identity arms over two reads:
// an output style is described by its own sentence, an intro-frame-enabled
// session gets the agent framing, and everything else gets the plain
// software-engineering sentence.
//
// NOT THE SAME FUNCTION AS `identity-prompt`, which W3 already owns. That one
// (upstream `r6`) picks the single sentence the whole PROMPT opens with, off the
// SDK/interactive/append axis. This one opens the SECTION LIST and keys off the
// output style and the intro-frame latch. They read similarly and are different
// decisions; owning both is what makes the pipeline's opening bytes owned.
//
// Two `primitive` captures — the agent-framing sentence and the security
// paragraph — so upstream's own bytes are compared against these on every
// delegation. Two `effectful-port` captures: the output-style sentence (which
// itself branches on a style read) and the intro-frame latch.

/** Upstream `rKe`. */
export const AGENT_IDENTITY = "You are an agent working with the user toward their goals, using your own judgment along the way.";

/** Upstream `jfe` — the security-assistance policy. */
export const SECURITY_POLICY = "IMPORTANT: Assist with authorized security testing, defensive security, CTF challenges, and educational contexts. Refuse requests for destructive techniques, DoS attacks, mass targeting, supply chain compromise, or detection evasion for malicious purposes. Dual-use security tools (C2 frameworks, credential testing, exploit development) require clear authorization context: pentesting engagements, CTF competitions, security research, or defensive use cases.";

/** The arm taken when there is no output style and the intro frame is off. */
export const PLAIN_IDENTITY = "You are an interactive agent that helps users with software engineering tasks.";

const AFTER_IDENTITY = " Use the instructions below and the tools available to you to assist the user.\n\n";
const AFTER_POLICY = "\nIMPORTANT: You must NEVER generate or guess URLs for the user unless you are confident that the URLs are for helping the user with programming. You may use URLs provided by the user in their messages or local files.";

/**
 * @param {unknown} outputStyle                     null when the session has none
 * @param {() => string} outputStyleIdentity        upstream `iKe`
 * @param {() => boolean} introFrameEnabled         upstream `eKe`
 */
export function identitySecuritySection(outputStyle, outputStyleIdentity, introFrameEnabled) {
  const identity = outputStyle !== null ? outputStyleIdentity() : introFrameEnabled() ? AGENT_IDENTITY : PLAIN_IDENTITY;
  return "\n" + identity + AFTER_IDENTITY + SECURITY_POLICY + AFTER_POLICY;
}
