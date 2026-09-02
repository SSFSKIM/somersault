// W0 acceptance for the engine-ts skeleton, run against the real wrapper the
// harness would spawn (`engines/engine-ts`) rather than against the module
// in-process — the wrapper, the runtime, and the exit code are part of the
// contract sdk.mjs and m2/raw-protocol.ts rely on.
//
// The claims (campaign spec §2.4, C2 acceptance):
//   - it BOOTS and reports the pinned engine version it targets;
//   - `--owned` reports the registered owned-module set — which is a set of
//     MODULES, and the refusal must not let that read as a set of subsystems
//     (C4 registered ten of the graph's 44 tool-result formatters, so three
//     subsystems now have an owned module and none of them is done);
//   - a stream-json line produces a structured refusal naming what is unowned —
//     not a hang, not a crash, and NOT a synthesized `result` frame;
//   - the registry (contract X7) accepts a valid registration and refuses the
//     two ways a registration could silently lie.
//
// Run: cd reforge && npx tsx engine-ts/skeleton.test.ts
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { engineEnv } from "../src/env.js";
import { BUN, ENGINE_VERSION } from "../src/pin.js";
import { SUBSYSTEM_IDS } from "../ledger/rows.js";
import { CHUNK_REPLACEMENTS, SPLICES } from "../strangle/manifest.js";
import { lookup, ownedSet, register, resetRegistryForTests, unownedSubsystems } from "./registry.js";

const WRAPPER = join(import.meta.dirname, "..", "engines", "engine-ts");
const TIMEOUT_MS = 30_000;

/**
 * X6 — THE WRAPPER IS SPAWNED THROUGH THE ALLOWLISTED ENVIRONMENT, like every
 * other engine this repository starts.
 *
 * This suite is a gate phase, and it used to hand `spawnSync` no `env` at all,
 * so the wrapper inherited whatever the operator happened to have exported. That
 * is the exact violation `strangle/prepare.ts:bootCheck` was written to close
 * one artifact over, and it matters more here than there: engine-ts is the
 * engine the inversion makes PRIMARY, so an environment-dependent skeleton test
 * would be the last thing to notice that the substrate had started reading the
 * operator's shell.
 */
const ENGINE_ENV = engineEnv({ mode: "replay", bun: BUN, configDir: join(import.meta.dirname, "..", "config") });

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const run = (args: string[], input = "") => {
  const r = spawnSync(WRAPPER, args, { input, encoding: "utf8", timeout: TIMEOUT_MS, env: ENGINE_ENV });
  return { code: r.status, signal: r.signal, out: r.stdout ?? "", err: r.stderr ?? "" };
};
const threw = (fn: () => unknown): string | null => {
  try {
    fn();
    return null;
  } catch (e) {
    return (e as Error).message;
  }
};

console.log("=== engine-ts skeleton (W0 acceptance) ===");

// X6, WITH A CONTROL OF ITS OWN.
//
// Routing this suite's spawns through `engineEnv` asserted nothing: drop the
// `env` option again and every check below still passes, because nothing here
// depends on what the child's environment contains. A fix whose absence is
// invisible is a fix the next refactor removes.
//
// The wrapper reads exactly one variable — `BUN="${BUN:-…}"` — so poisoning that
// one in the PARENT is a canary the spawn path actually consumes rather than a
// variable nobody reads: through the allowlisted environment the child never
// sees it and `--version` still reports the pin, while a child that inherits the
// parent execs a bun that does not exist and dies at 127. Both directions are
// asserted, because the passing half alone would also pass if the poison were
// inert.
const parentBun = process.env.BUN;
process.env.BUN = join(import.meta.dirname, "..", "toolchain", "bun-that-does-not-exist");
const throughEngineEnv = run(["--version"]);
const inheriting = spawnSync(WRAPPER, ["--version"], { encoding: "utf8", timeout: TIMEOUT_MS });
if (parentBun === undefined) delete process.env.BUN;
else process.env.BUN = parentBun;
check(
  "X6: a poisoned BUN in the parent env does not reach the child — the wrapper is spawned through engineEnv",
  throughEngineEnv.code === 0 && throughEngineEnv.out.includes(ENGINE_VERSION),
  `exit=${throughEngineEnv.code} out=${throughEngineEnv.out.trim()} err=${throughEngineEnv.err.trim()}`,
);
check(
  "…and the canary is live: the same spawn INHERITING the parent env dies on it",
  inheriting.status === 127,
  `exit=${inheriting.status} — the poison did nothing, so the check above proves nothing`,
);

const version = run(["--version"]);
check("--version exits 0", version.code === 0, `exit=${version.code} signal=${version.signal} ${version.err}`);
check("--version reports the pin (prepare.ts's boot check greps for it)", version.out.includes(ENGINE_VERSION), version.out.trim());
check("--version names itself, so nothing mistakes it for the real binary", /engine-ts/.test(version.out), version.out.trim());

const owned = run(["--owned"]);
check("--owned exits 0", owned.code === 0, `exit=${owned.code} ${owned.err}`);
let ownedDoc: { owned_modules?: unknown; owned_subsystems?: unknown; unowned_subsystems?: unknown; targets_engine_version?: unknown } = {};
check("--owned emits parseable JSON", threw(() => (ownedDoc = JSON.parse(owned.out))) === null, owned.out.slice(0, 200));
// The registry is the OTHER half of dual-wiring (§2.4): every spliced module has
// to be registered here, or half the wiring is a claim nobody checks. Comparing
// against the manifest rather than a literal keeps the two in step by force.
const ownedNames = Array.isArray(ownedDoc.owned_modules) ? (ownedDoc.owned_modules as { name?: string }[]).map((m) => m.name) : [];
// One registered module per manifest ROW, and a chunk replacement is a row as
// much as a splice is — it is the strangler's other unit of ownership, so
// leaving it out here would let a whole owned chunk go unregistered.
const rowNames = [...SPLICES.map((sp) => sp.name), ...CHUNK_REPLACEMENTS.map((cr) => cr.name)];
const missing = rowNames.filter((n) => !ownedNames.includes(n));
check("--owned reports one registered module per manifest row (splice or chunk)", missing.length === 0 && ownedNames.length === rowNames.length,
  `registered ${ownedNames.length}/${rowNames.length}; missing ${missing.join(", ") || "none"}`);
check(
  "--owned partitions the subsystems: with an owned module vs with none, and the two are disjoint and complete",
  Array.isArray(ownedDoc.owned_subsystems) &&
    Array.isArray(ownedDoc.unowned_subsystems) &&
    (ownedDoc.owned_subsystems as string[]).length + (ownedDoc.unowned_subsystems as string[]).length === SUBSYSTEM_IDS.length &&
    (ownedDoc.owned_subsystems as string[]).every((id) => !(ownedDoc.unowned_subsystems as string[]).includes(id)),
  JSON.stringify(ownedDoc.unowned_subsystems),
);
check("--owned reports the engine version it targets", ownedDoc.targets_engine_version === ENGINE_VERSION);

const sessionLine = JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: "hi" }] }, parent_tool_use_id: null, session_id: "" });
const session = run(["--print", "--verbose", "--input-format", "stream-json", "--output-format", "stream-json"], sessionLine + "\n");
check("a stream-json session does not hang", session.signal === null, `signal=${session.signal}`);
check("a stream-json session exits with the unowned code (3), not 0 and not a crash", session.code === 3, `exit=${session.code} ${session.err.slice(0, 200)}`);
let frame: Record<string, unknown> = {};
check("the refusal is one parseable JSON frame on stdout", threw(() => (frame = JSON.parse(session.out.trim()))) === null, session.out.slice(0, 200));
check("the refusal is a reforge-namespaced error, not a faked turn", frame.type === "reforge_engine_ts_error" && frame.is_error === true, JSON.stringify(frame.type));
check("the refusal does not emit a result frame", !/"type"\s*:\s*"result"/.test(session.out));
check("the refusal names every subsystem with no owned module",
  Array.isArray(frame.unowned_subsystems) &&
    Array.isArray(frame.partially_owned_subsystems) &&
    (frame.unowned_subsystems as string[]).length + (frame.partially_owned_subsystems as string[]).length === SUBSYSTEM_IDS.length);
check("the refusal reports the owned MODULE count, and says partial ownership is not ownership",
  frame.owned_module_count === rowNames.length && /PARTIALLY owned/.test(String(frame.message)),
  String(frame.message).slice(0, 200));
check("the refusal records what triggered it", frame.trigger === "stream-json-input", String(frame.trigger));
check("the refusal is also human-readable on stderr", session.err.includes("engine-ts"), session.err.slice(0, 120));

const noInput = run(["--print"], "");
check("empty stdin refuses instead of hanging", noInput.signal === null && noInput.code === 3, `exit=${noInput.code} signal=${noInput.signal}`);

// --- X7 registry contract ---
resetRegistryForTests();
check("registry starts empty", ownedSet().length === 0);
check("every subsystem is unowned when nothing is registered", unownedSubsystems().length === SUBSYSTEM_IDS.length);
register({ name: "probe-module", subsystem: SUBSYSTEM_IDS[0] });
check("a registered module appears in the owned set", ownedSet().map((m) => m.name).includes("probe-module"));
check("lookup finds it by name", lookup("probe-module")?.subsystem === SUBSYSTEM_IDS[0]);
check("its subsystem drops out of the unowned set", !unownedSubsystems().includes(SUBSYSTEM_IDS[0]) && unownedSubsystems().length === SUBSYSTEM_IDS.length - 1);
check("a duplicate name is refused", /duplicate/.test(threw(() => register({ name: "probe-module", subsystem: SUBSYSTEM_IDS[1] })) ?? ""));
check("a subsystem outside the closure ledger is refused", /unknown subsystem/.test(threw(() => register({ name: "rogue", subsystem: "subsystem/telepathy" })) ?? ""));
check("lookup of an unregistered name is undefined", lookup("never-registered") === undefined);
resetRegistryForTests();

console.log(failures === 0 ? "\nPASS — the skeleton boots, reports its owned set, and refuses a session by name" : `\nFAIL — ${failures} check(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;
