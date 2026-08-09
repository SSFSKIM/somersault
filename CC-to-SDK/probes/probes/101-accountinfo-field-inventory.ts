// probes/probes/101-accountinfo-field-inventory.ts — Wave C EP-C8 (spec-review finding #4):
// what does accountInfo() actually deliver headlessly under the OAuth token? Probe 28 verified only
// apiKeySource/first-party; the banner's billing label (`Claude Max` / `Claude Pro` / `Claude API` …)
// needs subscriptionType (declared in sdk.d.ts) — declared ≠ reachable, so inventory the real shape.
// Values are redacted to types/enum-ish strings; no emails/ids/secrets are printed.
// Run from CC-to-SDK/probes:  set -a; . ../.env; set +a; npx tsx probes/101-accountinfo-field-inventory.ts
import { openSession } from "../../harness/dist/index.js";

const MODEL = "claude-haiku-4-5-20251001";
// `tokenSource` is SAFE to print and must be: its value is the NAME of the env var the credential came from
// ("CLAUDE_CODE_OAUTH_TOKEN"), never the token itself, and it is the single field the banner's billing label
// keys off. Without it here the `/token/i` redactor below masks it, which is how the first run of this probe
// reported an ambiguity that was never real (t13 review finding 2).
const SAFE_KEYS = new Set(["apiKeySource", "tokenSource", "apiProvider", "subscriptionType", "hasClaudeMax", "hasClaudePro", "tier", "plan", "billingType"]);

function redact(obj: any, depth = 0): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== "object") {
    return typeof obj === "string" && obj.length > 40 ? `(string:${obj.length})` : obj;
  }
  if (depth > 2) return "(deep)";
  const out: any = Array.isArray(obj) ? [] : {};
  for (const [k, v] of Object.entries(obj)) {
    if (/email|name|id|token|key$/i.test(k) && !SAFE_KEYS.has(k)) {
      out[k] = `(${typeof v}:redacted)`;
    } else {
      out[k] = redact(v, depth + 1);
    }
  }
  return out;
}

(async () => {
  console.log("=== probe 101: accountInfo field inventory (headless, OAuth) ===");
  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    console.log("ABORT: CLAUDE_CODE_OAUTH_TOKEN not in env — source CC-to-SDK/.env first.");
    process.exit(1);
  }

  const session = openSession({ model: MODEL, permissionMode: "default" } as any);
  try {
    // accountInfo before any turn — the banner renders at launch, so pre-turn reachability matters
    let pre: any = null;
    try { pre = await session.accountInfo(); } catch (e) { pre = { threw: (e as Error).message }; }
    console.log("\npre-turn accountInfo (redacted):", JSON.stringify(redact(pre), null, 2));
    console.log("pre-turn key list:", pre && !pre.threw ? Object.keys(pre).sort().join(", ") : "(n/a)");

    await session.submit("Reply with exactly the single word OK.", () => {});

    let post: any = null;
    try { post = await session.accountInfo(); } catch (e) { post = { threw: (e as Error).message }; }
    console.log("\npost-turn accountInfo (redacted):", JSON.stringify(redact(post), null, 2));
    console.log("post-turn key list:", post && !post.threw ? Object.keys(post).sort().join(", ") : "(n/a)");

    const sub = post?.subscriptionType ?? pre?.subscriptionType;
    // `tokenSource` is the field that ACTUALLY arrives under OAuth; the first cut of this line named
    // `apiKeySource`, which is declared in sdk.d.ts but never present, so the verdict printed `undefined`
    // and made the shape look ambiguous. Both are printed now — the never-arriving one last, and clearly
    // labelled, so a rerun records which credential path this run took instead of implying a rename.
    console.log("\nVERDICT: subscriptionType =", JSON.stringify(sub),
                "| apiProvider =", JSON.stringify(post?.apiProvider ?? pre?.apiProvider),
                "| tokenSource =", JSON.stringify(post?.tokenSource ?? pre?.tokenSource),
                "| apiKeySource (declared; expected undefined under OAuth) =", JSON.stringify(post?.apiKeySource ?? pre?.apiKeySource));
  } finally {
    await session.close?.().catch?.(() => {});
    process.exit(0);
  }
})();
