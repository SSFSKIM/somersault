// SABOTAGE LAYER (§2.5). `sysprompt-preset` MUST go red with this built: this is
// the opener of the section list, so dropping the security paragraph is a byte
// difference in the `system` array of every preset request.
export function identitySecuritySection() {
  return "\nYou are an interactive agent.";
}
export const AGENT_IDENTITY = "You are an agent working with the user toward their goals, using your own judgment along the way.";
export const SECURITY_POLICY = "IMPORTANT: Assist with authorized security testing, defensive security, CTF challenges, and educational contexts. Refuse requests for destructive techniques, DoS attacks, mass targeting, supply chain compromise, or detection evasion for malicious purposes. Dual-use security tools (C2 frameworks, credential testing, exploit development) require clear authorization context: pentesting engagements, CTF competitions, security research, or defensive use cases.";
