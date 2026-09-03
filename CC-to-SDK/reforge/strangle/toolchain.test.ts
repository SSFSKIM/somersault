// §3.5 — BOTH pins are the exact BYTES, and this watches them both ways.
//
// The pin used to be the version STRING: the canary asset that reports `1.4.1`
// rolls, so tomorrow's build — or any `BUN` override that printed `1.4.1` —
// would have been accepted, with a revision/hash difference downgraded to a
// printed note. A pin that a moving target satisfies is not a pin.
//
// So: the cached, verified surrogate must PASS, and bytes that are not it must
// FAIL — including bytes that differ from it by one appended byte, which is the
// cheapest realistic stand-in for "the asset rolled while nobody looked".
//
// The ORACLE pin is here for the same reason and a different failure. Its old
// home was the auto-updater's cache, where the hazard was a name DISAPPEARING;
// its new home is `reforge/toolchain/`, where the hazard is a stale or wrong
// copy sitting under the right name. A hash is what distinguishes those, so the
// same two-way control applies: the provisioned oracle passes, and bytes that
// are not it — including bytes that differ by one appended byte — do not.
//
// Run: npx tsx strangle/toolchain.test.ts
import { appendFileSync, copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ENGINE_VERSION, PINNED_BUN, PINNED_BUN_SHA256, PINNED_ENGINE_SHA256, TOOLCHAIN_BUN, TOOLCHAIN_ENGINE } from "../src/pin.js";
import { assertBunPin, assertEnginePin, sha256 } from "./toolchain.js";

let pass = 0;
const failures: string[] = [];
const check = (label: string, ok: boolean, detail = "") => {
  if (ok) pass++;
  else failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
};
const refuses = (label: string, bun: string, match: RegExp) => {
  try {
    assertBunPin(bun);
    failures.push(`${label} — accepted bytes it should have refused`);
  } catch (e) {
    const msg = String((e as Error).message);
    if (match.test(msg)) pass++;
    else failures.push(`${label} — refused for the wrong reason: ${msg.split("\n")[0]}`);
  }
};

const refusesEngine = (label: string, binary: string, match: RegExp) => {
  try {
    assertEnginePin(binary);
    failures.push(`${label} — accepted bytes it should have refused`);
  } catch (e) {
    const msg = String((e as Error).message);
    if (match.test(msg)) pass++;
    else failures.push(`${label} — refused for the wrong reason: ${msg.split("\n")[0]}`);
  }
};

const work = mkdtempSync(join(tmpdir(), "reforge-toolchain-"));

// --- the provisioned surrogate PASSES ---------------------------------------
{
  const pinned = assertBunPin(TOOLCHAIN_BUN);
  check("the cached surrogate is accepted", pinned.sha256 === PINNED_BUN_SHA256);
  check("it reports the pinned version", pinned.version === PINNED_BUN);
  check("the pin constant is the file's real hash", sha256(TOOLCHAIN_BUN) === PINNED_BUN_SHA256);
}

// --- TAMPERED BYTES fail, and fail on the HASH ------------------------------
// One appended byte. It is also why the hash is checked BEFORE execution: on
// arm64 a modified Mach-O is killed for a broken signature, so a version-first
// check would report a confusing spawn failure instead of the real reason.
{
  const tampered = join(work, "bun-tampered");
  copyFileSync(TOOLCHAIN_BUN, tampered);
  appendFileSync(tampered, "\0");
  check("the fixture really is different bytes", sha256(tampered) !== PINNED_BUN_SHA256);
  refuses("one appended byte is refused", tampered, /runtime pin violation[\s\S]*sha256/);
}

// --- anything else that is not the surrogate --------------------------------
{
  const impostor = join(work, "bun-impostor");
  writeFileSync(impostor, "#!/bin/sh\necho 1.4.1\n", { mode: 0o755 });
  refuses("a script that merely PRINTS the pinned version is refused", impostor, /runtime pin violation[\s\S]*sha256/);
  refuses("a missing binary is refused", join(work, "does-not-exist"), /pinned runtime missing/);
}

// --- the ORACLE pin, both ways ----------------------------------------------
// The provisioned copy is accepted; a wrong-checksum candidate under the right
// name is not. The tamper fixture is a TRUNCATION rather than a copy-plus-a-byte
// because the oracle is ~197 MB and this check does not need to move it twice.
{
  const pinned = assertEnginePin(TOOLCHAIN_ENGINE);
  check("the provisioned oracle is accepted", pinned.sha256 === PINNED_ENGINE_SHA256);
  check("it is the pinned version", pinned.version === ENGINE_VERSION);
  check("the pin constant is the file's real hash", sha256(TOOLCHAIN_ENGINE) === PINNED_ENGINE_SHA256);

  const tampered = join(work, `claude-${ENGINE_VERSION}`);
  writeFileSync(tampered, readFileSync(TOOLCHAIN_ENGINE).subarray(0, 1 << 20), { mode: 0o755 });
  check("the oracle fixture really is different bytes", sha256(tampered) !== PINNED_ENGINE_SHA256);
  refusesEngine("a wrong-checksum oracle under the right name is refused", tampered, /oracle pin violation[\s\S]*sha256/);
  refusesEngine("a missing oracle is refused", join(work, "no-such-claude"), /pinned oracle missing/);
}

rmSync(work, { recursive: true, force: true });

console.log(`=== oracle + runtime pins: ${pass} check(s) ===`);
for (const f of failures) console.log(`  FAIL — ${f}`);
console.log(failures.length === 0 ? "PASS — both pins are the bytes: the provisioned oracle and the verified runtime surrogate are accepted, and nothing else is" : `FAIL — ${failures.length} violation(s)`);
process.exitCode = failures.length === 0 ? 0 : 1;
