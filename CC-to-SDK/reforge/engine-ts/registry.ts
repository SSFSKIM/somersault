// ============================================================================
// X7 — SKELETON REGISTRATION (binding interface; owner C2)
// ----------------------------------------------------------------------------
// This module is the contract surface every wave child registers its
// standalone-complete modules through (campaign spec
// docs/superpowers/specs/2026-08-31-reforge-full-campaign-design.md, §2.4 and
// contract X7). The interface is deliberately four names wide — `name`,
// `subsystem`, `register`, `ownedSet` — because at W0 the only thing the
// skeleton can honestly claim about an owned module is *that it exists and
// which closure-ledger row it belongs to*. Behavior dispatch arrives with the
// wave that first needs it; it is not speculated here.
//
// The contract for a wave child:
//
//   1. Put the module's registration in `engine-ts/modules/index.ts` (the one
//      registration site — an unregistered module under engine-ts/ is an orphan
//      and `check-reachability.ts` fails the build on it, which is how a module
//      cannot quietly sit outside the checked import graph).
//   2. `subsystem` MUST be a closure-ledger subsystem row id (reforge/ledger.json,
//      canonical list in ledger/rows.ts). `register` rejects anything else, so a
//      module cannot claim ownership of a subsystem the campaign never scoped.
//   3. Registering is *half* of dual-wiring (§2.4): the same module is also
//      spliced into the extracted graph. Registration here is the claim that the
//      module is standalone-complete — it owns its constants and helpers
//      outright and no minified identifier crosses into it (§2.4 hygiene rule,
//      contract X4).
//
// Registration is a claim of ownership, not a proof of it. The proof is the
// two-phase gate (X1) plus the ledger row the wave moves (X2).
// ============================================================================
import { SUBSYSTEM_IDS } from "../ledger/rows.js";

export interface OwnedModule {
  /** Unique module name. Matches the splice name in strangle/manifest.ts where one exists. */
  readonly name: string;
  /** The closure-ledger subsystem row id this module contributes ownership to. */
  readonly subsystem: string;
}

const registry = new Map<string, OwnedModule>();

/**
 * Register a standalone-complete module. Throws on a duplicate name or an
 * unknown subsystem — a silently-dropped registration would make the skeleton
 * under-report its owned set, which is exactly the number the campaign grades
 * itself on.
 */
export function register(module: OwnedModule): OwnedModule {
  if (!module.name) throw new Error("register: module.name is required");
  if (registry.has(module.name)) throw new Error(`register: duplicate module name '${module.name}'`);
  if (!SUBSYSTEM_IDS.includes(module.subsystem)) {
    throw new Error(`register: '${module.name}' claims unknown subsystem '${module.subsystem}' — must be a closure-ledger subsystem row id (ledger/rows.ts)`);
  }
  registry.set(module.name, module);
  return module;
}

/** Every registered module, in registration order. */
export function ownedSet(): readonly OwnedModule[] {
  return [...registry.values()];
}

/** One registered module by name, or undefined. */
export function lookup(name: string): OwnedModule | undefined {
  return registry.get(name);
}

/** Subsystem row ids with at least one registered module. */
export function ownedSubsystems(): readonly string[] {
  return [...new Set(ownedSet().map((m) => m.subsystem))];
}

/** Subsystem row ids the skeleton owns nothing of — what a refusal names. */
export function unownedSubsystems(): readonly string[] {
  const owned = new Set(ownedSubsystems());
  return SUBSYSTEM_IDS.filter((id) => !owned.has(id));
}

/** Test-only: drop all registrations. Never called by the skeleton itself. */
export function resetRegistryForTests(): void {
  registry.clear();
}
