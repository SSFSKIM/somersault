// W0 acceptance for the engine-ts skeleton, run against the real wrapper the
// harness would spawn (`engines/engine-ts`) rather than against the module
// in-process — the wrapper, the runtime, and the exit code are part of the
// contract sdk.mjs and m2/raw-protocol.ts rely on.
//
// The claims (campaign spec §2.4, C2 acceptance):
//   - it BOOTS and reports the pinned engine version it targets;
//   - `--owned` reports the registered owned-module set;
//   - a stream-json line produces a structured refusal naming what is unowned —
//     not a hang, not a crash, and NOT a synthesized `result` frame;
//   - the registry (contract X7) accepts a valid registration and refuses the
//     two ways a registration could silently lie.
//
// Run: cd reforge && npx tsx engine-ts/skeleton.test.ts
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { ENGINE_VERSION } from "../src/pin.js";
import { SUBSYSTEM_IDS } from "../ledger/rows.js";
import { lookup, ownedSet, register, resetRegistryForTests, unownedSubsystems } from "./registry.js";

const WRAPPER = join(import.meta.dirname, "..", "engines", "engine-ts");
const TIMEOUT_MS = 30_000;

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const run = (args: string[], input = "") => {
  const r = spawnSync(WRAPPER, args, { input, encoding: "utf8", timeout: TIMEOUT_MS });
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

const version = run(["--version"]);
check("--version exits 0", version.code === 0, `exit=${version.code} signal=${version.signal} ${version.err}`);
check("--version reports the pin (prepare.ts's boot check greps for it)", version.out.includes(ENGINE_VERSION), version.out.trim());
check("--version names itself, so nothing mistakes it for the real binary", /engine-ts/.test(version.out), version.out.trim());

const owned = run(["--owned"]);
check("--owned exits 0", owned.code === 0, `exit=${owned.code} ${owned.err}`);
let ownedDoc: { owned_modules?: unknown; unowned_subsystems?: unknown; targets_engine_version?: unknown } = {};
check("--owned emits parseable JSON", threw(() => (ownedDoc = JSON.parse(owned.out))) === null, owned.out.slice(0, 200));
check("--owned reports the owned-module set (empty at W0)", Array.isArray(ownedDoc.owned_modules) && ownedDoc.owned_modules.length === 0, JSON.stringify(ownedDoc.owned_modules));
check(
  `--owned names all ${SUBSYSTEM_IDS.length} unowned subsystems`,
  Array.isArray(ownedDoc.unowned_subsystems) && ownedDoc.unowned_subsystems.length === SUBSYSTEM_IDS.length,
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
check("the refusal names every unowned subsystem", Array.isArray(frame.unowned_subsystems) && (frame.unowned_subsystems as string[]).length === SUBSYSTEM_IDS.length);
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
