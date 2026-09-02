// SABOTAGE wiring — `sysprompt-preset` MUST go red with this built.
//
// The primitive assertions stay live: a sabotage twin that also broke them would
// fail at the adapter rather than in the transcript, and the row would prove the
// assertion works rather than that the scenario covers the section.
import { assertGraphValue } from "./shared/assert.js";
import { AGENT_IDENTITY, SECURITY_POLICY, identitySecuritySection } from "./identity-security-section/sabotage.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  identitySecuritySection(outputStyle, agentIdentity, securityPolicy) {
    assertGraphValue("identity-security-section", "agentIdentity", agentIdentity, AGENT_IDENTITY);
    assertGraphValue("identity-security-section", "securityPolicy", securityPolicy, SECURITY_POLICY);
    return identitySecuritySection();
  },
});
