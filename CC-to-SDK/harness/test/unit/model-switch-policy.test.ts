import { describe, it, expect } from "vitest";
import { buildModelSwitchHooks, type PreModelSwitchHookInput, type PostModelSwitchHookInput } from "../../src/hooks/modelSwitch.js";
import { resolveOptions } from "../../src/config/resolveOptions.js";

// Probe-121-shaped inputs (the live payload of 2026-08-30), warm cache by default.
const preInput = (over: Partial<PreModelSwitchHookInput> = {}): PreModelSwitchHookInput => ({
  session_id: "s", transcript_path: "/t", cwd: "/", hook_event_name: "PreModelSwitch",
  from_model: "claude-haiku-4-5-20251001", to_model: "claude-sonnet-5", requested_model: "sonnet",
  source: "sdk", context_tokens: 18_643, prompt_cache_warm: true, cache_ttl: "1h",
  estimated_cache_write_usd: 0.0746, pricing: "catalog", ...over,
} as PreModelSwitchHookInput);
const postInput = (): PostModelSwitchHookInput => ({ ...preInput(), hook_event_name: "PostModelSwitch" } as never);

const firePre = async (policy: Parameters<typeof buildModelSwitchHooks>[0], input = preInput()) => {
  const cb = buildModelSwitchHooks(policy).PreModelSwitch![0].hooks[0];
  return (await cb(input as never, undefined as never, undefined as never)) as any;
};
const firePost = async (policy: Parameters<typeof buildModelSwitchHooks>[0]) => {
  const cb = buildModelSwitchHooks(policy).PostModelSwitch![0].hooks[0];
  return (await cb(postInput() as never, undefined as never, undefined as never)) as any;
};
const denyReason = (out: any): string | undefined =>
  out?.hookSpecificOutput?.permissionDecision === "deny" ? out.hookSpecificOutput.permissionDecisionReason : undefined;

describe("model-switch policy (Wave D, probe 121)", () => {
  it("no policy opinion → {} (never an explicit allow — the interactive confirm stays intact)", async () => {
    expect(await firePre({})).toEqual({});
  });

  it("allowModels: a bare word admits its FAMILY via to_model prefix", async () => {
    expect(denyReason(await firePre({ allowModels: ["sonnet"] }))).toBeUndefined();
    expect(denyReason(await firePre({ allowModels: ["haiku"] }, preInput({ to_model: "claude-haiku-4-5-20251001", requested_model: "claude-haiku-4-5-20251001" })))).toBeUndefined();
  });
  it("allowModels: outside the list denies with the prefixed reason", async () => {
    const reason = denyReason(await firePre({ allowModels: ["haiku"] }));
    expect(reason).toMatch(/^cc-harness modelSwitchPolicy: /);
    expect(reason).toContain('"sonnet" is outside allowModels');
  });
  it("allowModels: an exact id admits only itself, matched on to_model or requested_model", async () => {
    expect(denyReason(await firePre({ allowModels: ["claude-sonnet-5"] }))).toBeUndefined();
    expect(denyReason(await firePre({ allowModels: ["claude-sonnet-4-5"] }))).toBeDefined();
  });

  it("maxCacheWriteUsd: denies only a WARM-cache forfeiture over the cap", async () => {
    expect(denyReason(await firePre({ maxCacheWriteUsd: 0.01 }))).toContain("forfeit a warm prompt cache");
    expect(denyReason(await firePre({ maxCacheWriteUsd: 0.01 }, preInput({ prompt_cache_warm: false })))).toBeUndefined();
    expect(denyReason(await firePre({ maxCacheWriteUsd: 0.10 }))).toBeUndefined(); // under the cap
  });

  it("deny-wins: decide()'s allow cannot override a declarative deny; its block adds one", async () => {
    expect(denyReason(await firePre({ allowModels: ["haiku"], decide: () => ({ allow: true }) }))).toBeDefined();
    expect(denyReason(await firePre({ decide: async () => ({ block: true, reason: "budget freeze" }) }))).toContain("budget freeze");
  });

  it("annotate: text → PostModelSwitch additionalContext; empty/nullish → {}", async () => {
    const out = await firePost({ annotate: (i) => `now on ${i.to_model}` });
    expect(out.hookSpecificOutput).toEqual({ hookEventName: "PostModelSwitch", additionalContext: "now on claude-sonnet-5" });
    expect(await firePost({ annotate: () => "" })).toEqual({});
    expect(await firePost({})).toEqual({});
  });

  it("onSwitch tap: fires on both phases, carries the composed denial, and a throwing tap is swallowed", async () => {
    const seen: Array<[string, string | undefined]> = [];
    const policy = { allowModels: ["haiku"], onSwitch: (phase: string, _i: unknown, denied?: string) => { seen.push([phase, denied]); } };
    await firePre(policy as never);
    await firePost(policy as never);
    expect(seen[0][0]).toBe("pre");
    expect(seen[0][1]).toMatch(/outside allowModels/);
    expect(seen[1]).toEqual(["post", undefined]);
    expect(denyReason(await firePre({ allowModels: ["haiku"], onSwitch: () => { throw new Error("tap boom"); } }))).toBeDefined();
  });

  it("an ASYNC throwing tap is swallowed on both phases (its rejection is awaited, not left unhandled)", async () => {
    const onSwitch = async () => { throw new Error("async tap boom"); };
    expect(denyReason(await firePre({ allowModels: ["haiku"], onSwitch }))).toBeDefined();
    expect(await firePost({ onSwitch })).toEqual({});
  });

  it("resolveOptions mounts the policy's hooks and merges them AFTER a user fragment", () => {
    const userCb = async () => ({});
    const opts = resolveOptions({
      modelSwitchPolicy: { allowModels: ["sonnet"] },
      hooks: { PreModelSwitch: [{ hooks: [userCb] }] },
    }) as any;
    expect(opts.hooks.PreModelSwitch).toHaveLength(2);
    expect(opts.hooks.PreModelSwitch[0].hooks[0]).toBe(userCb); // user first, policy appended
    expect(opts.hooks.PostModelSwitch).toHaveLength(1);
  });
  it("resolveOptions with only the policy still mounts both events; without it, user hooks pass through untouched", () => {
    const opts = resolveOptions({ modelSwitchPolicy: {} }) as any;
    expect(opts.hooks.PreModelSwitch).toHaveLength(1);
    expect(opts.hooks.PostModelSwitch).toHaveLength(1);
    const user = { PreModelSwitch: [{ hooks: [async () => ({})] }] };
    expect((resolveOptions({ hooks: user }) as any).hooks).toBe(user);
  });
});
