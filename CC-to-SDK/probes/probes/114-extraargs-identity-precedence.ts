// probe 114 — extraArgs vs typed identity flags: who wins the argv?
//
// The M5 parking lot's `extraArgs` item rests on two premises, one per layer:
//   (A) the SDK appends `extraArgs` entries AFTER every typed identity flag (read off sdk.mjs's
//       initialize(): `--continue`/`--resume=`/`--fork-session`/`--resume-session-at`/
//       `--resume-drops-turn`/`--session-id` all push before the Object.entries(extraArgs) loop) —
//       confirmed here at RUNTIME with a stub executable that dumps its argv;
//   (B) the CLI adopts the LAST occurrence of a repeated flag (commander's default, but declared ≠
//       reachable) — measured here by handing the real native binary `--session-id A --session-id B`
//       and reading which UUID the result envelope / transcript filename carries, in BOTH orders so
//       the conclusion is order-driven rather than value-driven.
// Only if BOTH hold does `extraArgs: {resume: ...}` hijack a swap/review the way the extraOptions
// hatch could before stripIdentityHatch — which is what decides whether sessionIdentity.ts needs a
// third strip list.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

// ── Part A: runtime argv order ─────────────────────────────────────────────────────────────────────
const stubDir = mkdtempSync(join(tmpdir(), "p114-"));
const argvFile = join(stubDir, "argv.json");
const stub = join(stubDir, "stub.js");
writeFileSync(stub, `require("fs").writeFileSync(${JSON.stringify(argvFile)}, JSON.stringify(process.argv)); process.exit(0);\n`);
const RESUME_TYPED = randomUUID(), RESUME_EXTRA = randomUUID();
try {
  const q = query({
    prompt: "hi",
    options: {
      resume: RESUME_TYPED,
      extraArgs: { resume: RESUME_EXTRA },
      pathToClaudeCodeExecutable: stub,
      executable: "node" as const,
      cwd: stubDir,
    },
  });
  for await (const _ of q) { /* stub exits immediately; drain until the transport errors */ }
} catch (e) {
  console.log(`A: query failed as expected (stub exits): ${String((e as Error).message).slice(0, 80)}`);
}
if (existsSync(argvFile)) {
  const argv: string[] = JSON.parse(readFileSync(argvFile, "utf8"));
  const hits = argv.map((a, i) => ({ a, i })).filter(({ a }) => a.startsWith("--resume") || a === RESUME_TYPED || a === RESUME_EXTRA);
  console.log("A: resume-related argv entries in order:", JSON.stringify(hits));
  const typedIdx = argv.findIndex((a) => a.includes(RESUME_TYPED));
  const extraIdx = argv.findIndex((a) => a.includes(RESUME_EXTRA) || (argv[argv.indexOf(a) - 1] === "--resume" && a === RESUME_EXTRA));
  const extraIdx2 = argv.indexOf(RESUME_EXTRA);
  console.log(`A: typed --resume at index ${typedIdx}, extraArgs resume value at index ${extraIdx2 !== -1 ? extraIdx2 : extraIdx}`);
  console.log(`A: VERDICT — extraArgs ${((extraIdx2 !== -1 ? extraIdx2 : extraIdx) > typedIdx) ? "AFTER" : "BEFORE"} typed flag`);
} else {
  console.log("A: NO argv dump — stub never ran; part A inconclusive");
}

// ── Part B: does the real CLI adopt the last occurrence? ───────────────────────────────────────────
// The native binary ships as one per-host package, so the path is composed from THIS host rather than
// pinned to the one that first ran the probe — otherwise part B silently measures nothing off darwin/arm64.
// Three host facts go into it: the package is `-<platform>-<arch>`, but linux ALSO ships musl-suffixed
// variants (only one of the two is installed, so try both rather than re-deriving the SDK's libc sniff);
// the file inside is `claude.exe` on win32; and the URL→path conversion must go through fileURLToPath,
// since `.pathname` keeps percent-escapes (a repo under "…/my repo/…" yields "%20") and prefixes the drive
// letter with a slash on Windows.
const exe = process.platform === "win32" ? "claude.exe" : "claude";
const nativePkgs = [`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`,
  ...(process.platform === "linux" ? [`@anthropic-ai/claude-agent-sdk-linux-${process.arch}-musl`] : [])];
const candidates = nativePkgs.map((pkg) => fileURLToPath(new URL(`../node_modules/${pkg}/${exe}`, import.meta.url)));
const bin = candidates.find((p) => existsSync(p)) ?? candidates[0];
console.log(`B: binary: ${bin} exists=${existsSync(bin)}`);
function adoptedSession(first: string, second: string, label: string): void {
  const cfg = mkdtempSync(join(tmpdir(), "p114cfg-"));
  const cwd = mkdtempSync(join(tmpdir(), "p114cwd-"));
  let stdout = "", code: number | string = 0;
  try {
    stdout = execFileSync(bin, [
      "-p", "--output-format", "json", "--model", "claude-haiku-4-5",
      "--session-id", first, "--session-id", second,
      "reply with just: ok",
    ], { cwd, env: { ...process.env, CLAUDE_CONFIG_DIR: cfg }, timeout: 60_000, encoding: "utf8" });
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    code = err.status ?? "signal";
    stdout = err.stdout ?? "";
    console.log(`B[${label}]: exit ${code}; stderr tail: ${String(err.stderr ?? "").slice(-160).replace(/\n/g, " ")}`);
  }
  const m = stdout.match(/"session_id"\s*:\s*"([0-9a-f-]{36})"/);
  console.log(`B[${label}]: envelope session_id: ${m ? m[1] : "(none)"}${m ? (m[1] === second ? "  == SECOND (last wins)" : m[1] === first ? "  == FIRST (first wins)" : "  == neither?!") : ""}`);
  const projects = join(cfg, "projects");
  const files: string[] = [];
  if (existsSync(projects)) for (const d of readdirSync(projects)) for (const f of readdirSync(join(projects, d))) files.push(f);
  console.log(`B[${label}]: transcript files: ${JSON.stringify(files)}`);
  const byFile = files.find((f) => f.includes(first)) ? "FIRST" : files.find((f) => f.includes(second)) ? "SECOND" : "(none)";
  console.log(`B[${label}]: transcript names the ${byFile} id`);
}
const A = randomUUID(), B = randomUUID();
if (existsSync(bin)) {
  adoptedSession(A, B, "A-then-B");
  adoptedSession(B, A, "B-then-A (control)");
} else {
  // Said out loud, because an absent binary is an UNMEASURED part B — not a passing one. The candidates
  // are printed too: on a host where none matched, the list is the whole of what was looked for.
  console.log(`B: binary not installed for this platform (${process.platform}/${process.arch}); tried ${JSON.stringify(candidates)} — part B NOT measured`);
}
console.log("done");
