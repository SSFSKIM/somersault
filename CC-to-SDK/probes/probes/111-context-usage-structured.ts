// Probe 111 — Does a headless `/context` turn deliver 0.3.234's `context_usage` structured sibling,
// and ON WHICH MESSAGE?
//
// SDK 0.3.234 added `context_usage?: SDKContextUsage` to the assistant message (sdk.d.ts:3086), doc:
// "Structured twin of the /context report, carried on the synthetic assistant message that delivers
//  the markdown table. Present only on /context results from CLIs new enough to attach it; the
//  markdown in message.content remains the canonical fallback. Wrapper-level sibling — never inside
//  `message.content` — so it is not replayed to the model."
//
// "Which message" is not a detail — it decides reachability. The harness's frame fan (session.ts's
// readLoop) hands EVERY frame to `frameCbs` (the appserver router's feed), but a `result` frame is
// resolved into the submit waiter and NEVER forwarded to the per-turn `onMessage` sink that the ccx
// host re-emits as `{kind:"message"}` to fleet followers (host.ts's own comment; P106 measured 88
// message frames on a following client, zero of them results). So:
//   - carried on an `assistant` frame → both origins' routers see it
//   - carried on the `result` frame   → the in-process router sees it, the FLEET router never does
//
// Scaffold: probe 110's `openStreaming` (streaming input keeps the session open so a slash command
// runs as a real turn rather than a one-shot prompt). We log every message's type/subtype and
// `JSON.stringify(msg.context_usage ?? "ABSENT")`, so the answer is read off the raw log, not inferred.
//
// Third, smaller observation (not a third probe): a `rate_limit_event` message type was seen in a
// live stream this session. Since we already log every type, we record whether it shows up here.
//
// Keying: see probe 112's note — the credential is loaded here rather than sourced, because
// `. ../.env` resolves to the checkout the probe runs from and a git worktree has no `.env`.
// `ANTHROPIC_API_KEY` is deleted unconditionally (it shadows the OAuth token). Nothing prints a value.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";

function loadKey(): void {
  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    const file = process.env.CCX_ENV_FILE ?? resolve(import.meta.dirname, "../../.env");
    try {
      for (const line of readFileSync(file, "utf8").split("\n")) {
        const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
        if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
      }
    } catch (e) { console.log("[env] could not read env file:", (e as Error)?.name); }
  }
  delete process.env.ANTHROPIC_API_KEY;
  console.log("[env] keyed:", Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN));
}
loadKey();

const log = (...a: unknown[]) => console.log("[p111]", ...a);

function openStreaming(name: string) {
  let push: (() => void) | null = null;
  let done = false;
  const queue: unknown[] = [];
  async function* input() {
    while (!done) {
      if (queue.length) { yield queue.shift() as never; continue; }
      await new Promise<void>((r) => { push = () => { push = null; r(); }; });
    }
  }
  const q = query({ prompt: input() as never, options: { permissionMode: "bypassPermissions", allowDangerouslySkipPermissions: true } as never });
  const send = (text: string) => { queue.push({ type: "user", message: { role: "user", content: [{ type: "text", text }] }, parent_tool_use_id: null, session_id: "" }); push?.(); };
  const end = () => { done = true; push?.(); };
  return { name, q, send, end };
}

const S = openStreaming("S");

const seen: string[] = [];
const carriers: Array<{ tag: string; keys: string[] }> = [];
let sawResult = false;

const reader = (async () => {
  for await (const m of S.q) {
    const msg = m as Record<string, unknown>;
    const tag = `${msg.type}${msg.subtype ? `/${msg.subtype}` : ""}`;
    seen.push(tag);
    const cu = msg.context_usage;
    log(
      "MSG", tag,
      "| context_usage:", JSON.stringify(cu ?? "ABSENT"),
      "| top-level keys:", Object.keys(msg).sort().join(","),
    );
    if (cu !== undefined) carriers.push({ tag, keys: Object.keys(cu as object).sort() });
    // Is the markdown table itself on this frame? (the canonical fallback the doc names)
    if (msg.type === "assistant") {
      const content = ((msg.message as Record<string, unknown>)?.content as Array<Record<string, unknown>>) ?? [];
      const text = content.filter((b) => b.type === "text").map((b) => String(b.text)).join("\n");
      if (text) log("  assistant text head:", JSON.stringify(text.slice(0, 160)), "| looks like /context table:", /context|token|Free space|⛁|%/.test(text));
      // `message.content` must NOT carry it (wrapper-level sibling, per the doc) — check that too.
      log("  context_usage inside message wrapper:", JSON.stringify((msg.message as Record<string, unknown>)?.context_usage ?? "ABSENT"));
    }
    if (msg.type === "result") { sawResult = true; break; }
  }
})();

await new Promise((r) => setTimeout(r, 500));
S.send("/context");
await Promise.race([reader, new Promise((r) => setTimeout(r, 120_000))]);

log("---");
log("PHASE1 message types seen:", seen.join(","));
log("PHASE1 saw terminal result frame:", sawResult);
log("PHASE1 rate_limit_event seen:", seen.some((t) => t.startsWith("rate_limit_event")));
log("PHASE1 CARRIERS of context_usage:", JSON.stringify(carriers));
log(
  "PHASE1 VERDICT:",
  carriers.length === 0
    ? "ABSENT — no message on the /context path carried context_usage"
    : `PRESENT on ${carriers.map((c) => c.tag).join(" + ")}`,
);
S.end();

// ---------------------------------------------------------------------------------------------
// PHASE 2 — THE PRODUCER SEAM. "The SDK emits it" and "our server receives it" are different claims,
// and a field the SDK emits into a stream our router never sees is not a capability we have.
//
// The appserver's frame router subscribes `record.session.onFrame` (appserver/router.ts's
// installRouter). The ccx HOST — the fleet origin's producer — relays a DIFFERENT feed: the per-turn
// `onMessage` sink it hands to `Session.submit`, re-emitted as `{kind:"message"}` to every follower
// (host.ts's runTask), which fleetEngine.ts fans to the same router. The two feeds are not the same
// set: session.ts's readLoop fans every frame to `onFrame`, but resolves `result` frames into the
// submit waiter and never forwards them to `onMessage`.
//
// So both origin legs are measurable from ONE turn on the real harness Session: subscribe both feeds
// and see which of them the carrier reaches.
const { openSession } = await import("../../harness/dist/index.js");

const H = openSession({});
const onFrameTags: string[] = [];
const onFrameCarriers: string[] = [];
const onMessageTags: string[] = [];
const onMessageCarriers: string[] = [];

const tagOf = (m: unknown) => { const x = m as Record<string, unknown>; return `${x?.type}${x?.subtype ? `/${x.subtype}` : ""}`; };

const off = H.onFrame((m: unknown) => {
  onFrameTags.push(tagOf(m));
  if ((m as Record<string, unknown>)?.context_usage !== undefined) onFrameCarriers.push(tagOf(m));
});

await H.submit("/context", (m: unknown) => {
  onMessageTags.push(tagOf(m));
  if ((m as Record<string, unknown>)?.context_usage !== undefined) onMessageCarriers.push(tagOf(m));
});

off();
await H.dispose();

log("---");
log("PHASE2 onFrame (appserver router's feed) tags:", onFrameTags.join(","));
log("PHASE2 onFrame carriers:", JSON.stringify(onFrameCarriers));
log("PHASE2 onMessage (fleet host relay's feed) tags:", onMessageTags.join(","));
log("PHASE2 onMessage carriers:", JSON.stringify(onMessageCarriers));
log("PHASE2 SEAM inProcess (router.onFrame) receives the carrier:", onFrameCarriers.length > 0);
log("PHASE2 SEAM fleet (host onMessage -> {kind:'message'} -> router) receives the carrier:", onMessageCarriers.length > 0);

setTimeout(() => process.exit(0), 1000);
