// §3.5 — the runtime pin is the exact BYTES, and this watches it both ways.
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
// Run: npx tsx strangle/toolchain.test.ts
import { appendFileSync, copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PINNED_BUN, PINNED_BUN_SHA256, TOOLCHAIN_BUN } from "../src/pin.js";
import { assertBunPin, sha256 } from "./toolchain.js";

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

rmSync(work, { recursive: true, force: true });

console.log(`=== runtime pin: ${pass} check(s) ===`);
for (const f of failures) console.log(`  FAIL — ${f}`);
console.log(failures.length === 0 ? "PASS — the pin is the bytes: the surrogate is accepted and nothing else is" : `FAIL — ${failures.length} violation(s)`);
process.exitCode = failures.length === 0 ? 0 : 1;
