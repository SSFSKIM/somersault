// ADAPTER — the graph-facing seam for the identity-line selector.
//
// Delegation signature:
//   identityPrompt(session, cliIdentity, appendIdentity, sdkIdentity, provider)
//
// The three sentences are `primitive` and owned in shared/identity-prompts.js;
// they cross only so the assertions below can run. They are the SAME three the
// block partition's Set is built from, which is why one shared module holds them
// and two adapters assert them.
import { assertGraphValue } from "./shared/assert.js";
import { CLI_IDENTITY, SDK_APPEND_IDENTITY, SDK_IDENTITY } from "./shared/identity-prompts.js";
import { identityPrompt } from "./identity-prompt/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  identityPrompt(session, cliIdentity, appendIdentity, sdkIdentity, provider) {
    assertGraphValue("identity-prompt", "cliIdentity", cliIdentity, CLI_IDENTITY);
    assertGraphValue("identity-prompt", "appendIdentity", appendIdentity, SDK_APPEND_IDENTITY);
    assertGraphValue("identity-prompt", "sdkIdentity", sdkIdentity, SDK_IDENTITY);
    return identityPrompt(session, provider);
  },
});
