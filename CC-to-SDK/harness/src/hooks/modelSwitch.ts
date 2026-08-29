// Model-switch governance (engine Wave D) — the declarative policy over the 0.3.251
// PreModelSwitch/PostModelSwitch hooks, the same move guardTool made for tool gating.
// Contract evidence: probe 121 (all three answer paths live); spec
// docs/superpowers/specs/2026-08-30-model-switch-governance-design.md.
import type { PreModelSwitchHookInput, PostModelSwitchHookInput } from "@anthropic-ai/claude-agent-sdk";
import type { HooksMap, HookCallback, HookDecision } from "./types.js";

export type { PreModelSwitchHookInput, PostModelSwitchHookInput };

export interface ModelSwitchPolicy {
  /** Permitted targets. Absent = all. A bare word ("sonnet") is a FAMILY (matches `to_model`
   *  `claude-<word>-…` or `requested_model` = word — the 2.1.222 family reading); anything else is
   *  EXACT against `to_model`/`requested_model` (case/space-normalized). */
  allowModels?: string[];
  /** Deny a switch that would FORFEIT a warm prompt cache costing more than this (USD) to rebuild.
   *  Binds only while `prompt_cache_warm` — a cold cache re-writes next turn regardless of the model. */
  maxCacheWriteUsd?: number;
  /** Escape hatch, guardTool's HookDecision vocabulary: `{ block, reason? }` denies; anything else is
   *  no opinion. Runs ALONGSIDE the declarative checks (deny-wins), never instead of them. */
  decide?: (input: PreModelSwitchHookInput) => HookDecision | Promise<HookDecision>;
  /** PostModelSwitch → additionalContext on the new model's first request. null/undefined/"" = none. */
  annotate?: (input: PostModelSwitchHookInput) => string | null | undefined | Promise<string | null | undefined>;
  /** Observability tap, both phases ("pre" carries the composed denial reason). Errors swallowed —
   *  an observer must never break a switch (the `observe` builder's rule). */
  onSwitch?: (phase: "pre" | "post", input: PreModelSwitchHookInput | PostModelSwitchHookInput, denied?: string) => void | Promise<void>;
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/** The spec's two-clause list rule: bare word = family, anything else = exact. */
function inAllowList(list: string[], input: PreModelSwitchHookInput): boolean {
  const to = norm(input.to_model);
  const requested = norm(input.requested_model);
  return list.some((entry) => {
    const e = norm(entry);
    if (!e) return false;                 // a blank entry would exact-match a null requested_model (both norm to "")
    if (/^[a-z]+$/.test(e)) return to.startsWith(`claude-${e}-`) || requested === e;
    return to === e || requested === e;
  });
}

const REASON_PREFIX = "cc-harness modelSwitchPolicy";

/** Build the policy's HooksMap. Compose with user hooks via mergeHooks (resolveOptions does this for
 *  the `modelSwitchPolicy` config knob); usable directly for bespoke setups. */
export function buildModelSwitchHooks(policy: ModelSwitchPolicy): HooksMap {
  const pre: HookCallback = async (raw) => {
    const input = raw as PreModelSwitchHookInput;
    // Deny-wins: every opinion is computed; the first reason found denies. `decide` cannot override
    // a declarative deny — a soft cap is not a cap (spec decision 1).
    let reason: string | undefined;
    if (policy.allowModels && !inAllowList(policy.allowModels, input))
      reason = `target "${input.requested_model ?? input.to_model}" is outside allowModels`;
    if (!reason && policy.maxCacheWriteUsd !== undefined && input.prompt_cache_warm === true
      && typeof input.estimated_cache_write_usd === "number" && input.estimated_cache_write_usd > policy.maxCacheWriteUsd)
      reason = `switching would forfeit a warm prompt cache (~$${input.estimated_cache_write_usd} to rebuild > cap $${policy.maxCacheWriteUsd})`;
    if (policy.decide) {
      const d = await policy.decide(input);
      if (!reason && d && "block" in d && d.block) reason = d.reason ?? "blocked by decide()";
    }
    try { await policy.onSwitch?.("pre", input, reason ? `${REASON_PREFIX}: ${reason}` : undefined); } catch { /* tap must not break the switch */ }
    if (!reason) return {}; // no opinion — an interactive host's cache-miss confirm stays intact (spec decision 2)
    return { hookSpecificOutput: { hookEventName: "PreModelSwitch", permissionDecision: "deny", permissionDecisionReason: `${REASON_PREFIX}: ${reason}` } } as never;
  };
  const post: HookCallback = async (raw) => {
    const input = raw as PostModelSwitchHookInput;
    try { await policy.onSwitch?.("post", input); } catch { /* tap must not break the switch */ }
    const text = policy.annotate ? await policy.annotate(input) : undefined;
    if (text == null || text === "") return {};
    return { hookSpecificOutput: { hookEventName: "PostModelSwitch", additionalContext: text } } as never;
  };
  return { PreModelSwitch: [{ hooks: [pre] }], PostModelSwitch: [{ hooks: [post] }] };
}
