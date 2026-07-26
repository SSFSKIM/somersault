// A1 live e2e: the ccx PROCESS surface, exercised as real detached processes.
//
// This is the repeatable form of the acceptance run in the A1 spec: it drives the built binary
// (`dist/cli/bin.js`) exactly as a consumer does — spawn, poll, rm — and asserts the four things the
// doperpowers poller actually depends on. It deliberately does NOT assert anything about the model's
// reply: the contract under test is the process surface, and a rate-limited account still exercises
// every part of it (the 2026-07-26 acceptance run was made on one).
//
// CCX_FLEET_ROOT is pointed at a temp dir so the suite never touches the real fleet. The engine's own
// session registry (~/.claude/sessions) is shared and read-only to us, which is fine: projectRow
// tolerates a missing registry row.
import { describe, it, expect } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const live = (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN) ? describe : describe.skip;

const BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "dist", "cli", "bin.js");

interface Row { id: string; sessionId: string; state: string; status: string; cwd: string; name: string }

/** The consumer's own extraction, not a regex of our choosing: doperpowers' daemon-spawn.sh pipes the
 *  banner through exactly this sed, so a separator or spacing drift must fail HERE. */
function sedShort(banner: string): string {
  return execFileSync("sed", ["-n", String.raw`s/.*backgrounded · \([0-9a-f][0-9a-f]*\).*/\1/p`],
    { input: banner, encoding: "utf8" }).trim();
}

function ccx(root: string, args: string[]): { out: string; code: number } {
  const r = spawnSync(process.execPath, [BIN, ...args],
    { encoding: "utf8", env: { ...process.env, CCX_FLEET_ROOT: root } });
  return { out: (r.stdout ?? "") + (r.stderr ?? ""), code: r.status ?? -1 };
}
const agents = (root: string, extra: string[] = ["--all"]): Row[] =>
  JSON.parse(ccx(root, ["agents", "--json", ...extra]).out || "[]") as Row[];

const rosterRows = (root: string): { short: string; pid: number; name: string; state: string }[] => {
  const d = join(root, "roster");
  try { return readdirSync(d).map((f) => JSON.parse(readFileSync(join(d, f), "utf8"))); } catch { return []; }
};

async function until<T>(f: () => T | undefined, ms: number, every = 250): Promise<T | undefined> {
  const deadline = Date.now() + ms;
  for (;;) {
    const v = f();
    if (v !== undefined) return v;
    if (Date.now() >= deadline) return undefined;
    await new Promise((r) => setTimeout(r, every));
  }
}

live("ccx fleet (live, detached processes)", () => {
  it("spawns detached, is pollable while working, stays listed once finished, and rm removes it", async () => {
    expect(existsSync(BIN), `${BIN} missing — run \`npm run build\` first`).toBe(true);
    const root = mkdtempSync(join(tmpdir(), "ccx-fleet-live-"));
    try {
      const { out: banner, code } = ccx(root, ["--bg", "-n", "ccx-e2e", "Reply with exactly OK."]);
      expect(code).toBe(0);
      // Acceptance 1 + 17: the byte-exact banner, and a short id the consumer's sed yields as 8 hex.
      expect(banner).toMatch(/backgrounded · [0-9a-f]{8}\n/);
      const short = sedShort(banner);
      expect(short).toMatch(/^[0-9a-f]{8}$/);

      // Acceptance 2: while it is working, the row carries every key the poller reads. sessionId is
      // legitimately "" for the first beat — the engine reports one only once its init frame lands —
      // and the poller's own filter skips a row until it is non-empty, so the KEY must still be there.
      const working = await until(() => agents(root).find((r) => r.id === short && r.state === "working"), 30_000);
      expect(working, "no working row appeared within 30s").toBeDefined();
      for (const k of ["id", "sessionId", "state", "status", "cwd", "name"]) expect(working).toHaveProperty(k);
      expect(working!.status).toBe("busy");

      // Acceptance 3: a FINISHED session is still listed under --all. Rev 1 unlinked the row on exit,
      // which made the poller wait out its whole limit on a turn that had in fact finished.
      const done = await until(() => agents(root).find((r) => r.id === short && r.state === "done"), 180_000);
      expect(done, "session never reached done within 180s").toBeDefined();
      expect(done!.sessionId).toMatch(/^[0-9a-f-]{36}$/);
      expect(done!.status).toBe("idle");
      // …and hidden without --all, which is what makes `agents` a live view rather than a log.
      expect(agents(root, []).find((r) => r.id === short)).toBeUndefined();

      // Acceptance 12: rm succeeds on an already-exited session and the row is gone.
      expect(ccx(root, ["rm", short]).code).toBe(0);
      expect(agents(root).find((r) => r.id === short)).toBeUndefined();
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 240_000);

  it("projects a SIGKILLed host as error rather than leaving it working forever", async () => {
    const root = mkdtempSync(join(tmpdir(), "ccx-fleet-kill-"));
    try {
      const short = sedShort(ccx(root, ["--bg", "-n", "ccx-e2e-kill", "Reply with exactly OK."]).out);
      // The host writes its roster row inside start(), before the SDK session opens — so this window
      // exists even for a turn that would otherwise finish in seconds.
      const row = await until(() => rosterRows(root).find((r) => r.short === short), 30_000, 50);
      expect(row, "no roster row appeared within 30s").toBeDefined();
      process.kill(row!.pid, "SIGKILL");

      const seen = await until(() => agents(root).find((r) => r.id === short && r.state === "error"), 15_000);
      expect(seen, "a SIGKILLed host did not project as error").toBeDefined();
      // The row on disk is untouched: state is DERIVED at read time, never rewritten by a read command.
      expect(rosterRows(root).find((r) => r.short === short)!.state).toBe("working");
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 90_000);
});
