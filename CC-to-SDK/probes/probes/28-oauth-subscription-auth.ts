// probes/probes/28-oauth-subscription-auth.ts — A1: does the SDK authenticate headlessly off a
// subscription OAuth token (CLAUDE_CODE_OAUTH_TOKEN) with NO ANTHROPIC_API_KEY present?
// The SDK spawns the bundled `claude` CLI subprocess (sdk.d.ts: "the subprocess inherits process.env"),
// and the harness propagates the parent env (resolveOptions: options.env = {...process.env, ...env}),
// so the token should reach the CLI and bill the Pro/Max subscription instead of metered API credits.
// Decisive signal: a turn SUCCEEDS while ANTHROPIC_API_KEY is unset; corroborated by accountInfo().apiKeySource === "oauth".
// Run from CC-to-SDK/probes:  set -a; . ../.env; set +a; unset ANTHROPIC_API_KEY; npx tsx probes/28-oauth-subscription-auth.ts
import { openSession } from "../../harness/dist/index.js"; // probes workspace has no cc-harness dep; import built dist directly

const MODEL = "claude-opus-4-8";
const ping = "Reply with exactly the single word OK.";

(async () => {
  console.log("=== probe 28: OAuth subscription auth (headless) ===");
  console.log("env: ANTHROPIC_API_KEY present?", Boolean(process.env.ANTHROPIC_API_KEY),
              "| CLAUDE_CODE_OAUTH_TOKEN present?", Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN));
  if (process.env.ANTHROPIC_API_KEY) {
    console.log("WARNING: ANTHROPIC_API_KEY is set — it shadows the OAuth token (precedence). `unset` it for a clean test.");
  }
  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    console.log("ABORT: CLAUDE_CODE_OAUTH_TOKEN not in env — source CC-to-SDK/.env first.");
    process.exit(1);
  }

  const session = openSession({ model: MODEL, permissionMode: "bypassPermissions" } as any);
  try {
    let reply = "";
    await session.submit(ping, (ev: any) => {
      // accumulate any streamed assistant text so we can prove a real generation happened
      const t = ev?.text ?? ev?.delta?.text ?? ev?.message?.content;
      if (typeof t === "string") reply += t;
    });
    console.log("\nturn SUCCEEDED — assistant reply (trimmed):", JSON.stringify(reply.trim().slice(0, 80)));

    let source: unknown = "(unavailable)";
    try {
      const info: any = await session.accountInfo();
      source = info?.apiKeySource ?? info?.api_key_source ?? info?.account?.apiKeySource ?? JSON.stringify(info)?.slice(0, 200);
    } catch (e) {
      source = `(accountInfo threw: ${(e as Error).message})`;
    }
    console.log("accountInfo apiKeySource =", source);

    console.log("\n--- verdict ---");
    console.log("REACHABLE: a turn completed with NO ANTHROPIC_API_KEY in env →",
                "the SDK authenticated off CLAUDE_CODE_OAUTH_TOKEN (subscription billing).");
    if (source === "oauth") console.log("CORROBORATED: apiKeySource === \"oauth\".");
  } catch (e) {
    const msg = (e as Error).message;
    console.log("\nturn FAILED:", msg);
    console.log("\n--- verdict ---");
    if (/auth|oauth|401|403|credential|token/i.test(msg))
      console.log("AUTH FAILURE: the OAuth token did not authenticate — check `claude setup-token` output / token freshness.");
    else if (/credit|billing|quota/i.test(msg))
      console.log("BILLING: reached the model but billing was rejected — inspect the message above.");
    else
      console.log("OTHER: not obviously an auth error — interpret the message above.");
    process.exitCode = 1;
  } finally {
    await session.dispose();
  }
})();
