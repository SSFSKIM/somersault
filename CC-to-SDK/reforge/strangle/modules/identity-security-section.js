// ADAPTER — the graph-facing seam for the identity + security opener.
//
// Delegation signature:
//   identitySecuritySection(outputStyle, agentIdentity, securityPolicy,
//                           outputStyleIdentity, introFrameEnabled)
//
// Two `primitive` captures crossing only so they can be compared, and two
// `effectful-port` captures that are actually called. The primitives are the two
// longest fixed strings in the opener; a reword upstream moves no anchor and no
// hash, so these assertions are the only thing that would see it.
import { assertGraphValue } from "./shared/assert.js";
import { AGENT_IDENTITY, SECURITY_POLICY, identitySecuritySection } from "./identity-security-section/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  identitySecuritySection(outputStyle, agentIdentity, securityPolicy, outputStyleIdentity, introFrameEnabled) {
    assertGraphValue("identity-security-section", "agentIdentity", agentIdentity, AGENT_IDENTITY);
    assertGraphValue("identity-security-section", "securityPolicy", securityPolicy, SECURITY_POLICY);
    return identitySecuritySection(outputStyle, outputStyleIdentity, introFrameEnabled);
  },
});
