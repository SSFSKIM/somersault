// test/unit/args-bypass.test.ts — Wave-T T15. Two halves of one gate: the flag spelling the real CLI uses
// (`--dangerously-skip-permissions`, which ccx rejected as an unknown flag until now) and the launch-time
// consent check in main.ts that keys on the RESOLVED mode, so BOTH spellings are covered by one condition.
// Deliberately React-free: this file imports `src/cli/main.ts`, and the whole point of the `showBypassConsent`
// seam is that doing so pulls in no ink/React (the last case here pins that).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseCcx } from "../../src/cli/args.js";
import { main } from "../../src/cli/main.js";
import type { MainDeps } from "../../src/cli/main.js";
import type { CcxPrefs } from "../../src/tui/prefs.js";

describe("--dangerously-skip-permissions", () => {
  it("parses to permissionMode bypassPermissions", () => {
    expect(parseCcx(["--dangerously-skip-permissions"]).config.permissionMode).toBe("bypassPermissions");
  });
  it("lands on the SAME config field as --permission-mode bypassPermissions, so one resolved-mode check covers both", () => {
    expect(parseCcx(["--dangerously-skip-permissions"]).config)
      .toEqual(parseCcx(["--permission-mode", "bypassPermissions"]).config);
  });
  it("takes no value — the next positional is still the prompt", () => {
    expect(parseCcx(["--dangerously-skip-permissions", "fix the bug"]).prompt).toBe("fix the bug");
  });
});

/** Only the seams the gate itself reads. Everything else throws by name: a test that reaches past the gate
 *  fails loudly instead of opening a session. `isTTY` is true because this is the interactive launch. */
function gateDeps(over: Partial<MainDeps> & { prefs?: CcxPrefs } = {}): MainDeps & { shown: number[] } {
  const shown: number[] = [];
  const { prefs, ...rest } = over;
  return {
    runHostMain: async () => { throw new Error("runHostMain must not run"); },
    collectFleet: async () => { throw new Error("collectFleet must not run"); },
    spawnDetached: () => { throw new Error("spawnDetached must not run"); },
    ensureWorktree: async () => { throw new Error("ensureWorktree must not run"); },
    stopSession: async () => { throw new Error("stopSession must not run"); },
    rmSession: async () => { throw new Error("rmSession must not run"); },
    fleetGc: async () => { throw new Error("fleetGc must not run"); },
    runChatClient: async () => {},
    makeHost: () => ({ start: async () => {}, stop: async () => {} }) as any,
    runOnce: async () => { throw new Error("runOnce must not run"); },
    isTTY: () => true,
    prepareAttach: async () => { throw new Error("prepareAttach must not run"); },
    probeSocket: async () => { throw new Error("probeSocket must not run"); },
    runServe: async () => { throw new Error("runServe must not run"); },
    // NEVER the real file: a unit test may not read ~/.claude/ccx/prefs.json.
    loadPrefs: () => prefs ?? {},
    showBypassConsent: async () => { shown.push(1); },
    ...rest, shown,
  };
}

describe("the launch consent gate (Wave-T T15)", () => {
  it("shows the consent before the host starts when the launch mode resolves to bypass", async () => {
    for (const argv of [["--dangerously-skip-permissions"], ["--permission-mode", "bypassPermissions"]]) {
      const d = gateDeps();
      let started = false;
      d.makeHost = () => ({ start: async () => { started = d.shown.length > 0; }, stop: async () => {} }) as any;
      expect(await main(argv, d)).toBe(0);
      expect(d.shown).toHaveLength(1);
      expect(started).toBe(true);                       // consent ran BEFORE the session existed
    }
  });
  it("does NOT show it once the acceptance is recorded (upstream's M8(), L43492)", async () => {
    const d = gateDeps({ prefs: { skipDangerousModePermissionPrompt: true } });
    expect(await main(["--dangerously-skip-permissions"], d)).toBe(0);
    expect(d.shown).toHaveLength(0);
  });
  it("does NOT show it for a launch that is not bypass", async () => {
    const d = gateDeps();
    expect(await main([], d)).toBe(0);
    expect(d.shown).toHaveLength(0);
  });
  it("does NOT show it on the headless paths — there is no terminal to consent in", async () => {
    const p = gateDeps({ runOnce: async () => "ok" });
    expect(await main(["-p", "--dangerously-skip-permissions", "hi"], p)).toBe(0);
    expect(p.shown).toHaveLength(0);
    const bg = gateDeps();
    bg.spawnDetached = () => ({ short: "00000000", banner: "b" });
    expect(await main(["--bg", "--dangerously-skip-permissions", "hi"], bg)).toBe(0);
    expect(bg.shown).toHaveLength(0);
  });
  it("gates the --detachable launch too — it is an interactive REPL like any other", async () => {
    const d = gateDeps();
    d.spawnDetached = () => ({ short: "00000000", banner: "b" });
    d.prepareAttach = async () => ({ short: "00000000", socketPath: "/tmp/x.sock", cwd: "/tmp", initialEntries: [] }) as any;
    d.probeSocket = async () => {};
    expect(await main(["--detachable", "--dangerously-skip-permissions"], d)).toBe(0);
    expect(d.shown).toHaveLength(1);
  });
  it("main.ts stays React-free: the consent module is reached ONLY through a dynamic import", () => {
    const src = readFileSync(new URL("../../src/cli/main.ts", import.meta.url), "utf8");
    // VALUE imports only — `import type` is erased at compile time, which is exactly why chatMain's props
    // may be named up there at all. A `.tsx` specifier in this list would be a React module by definition.
    const values = src.split("\n")
      .filter((l) => /^import\s/.test(l) && !/^import\s+type\b/.test(l))
      .map((l) => /from\s+"([^"]+)"/.exec(l)?.[1] ?? "");
    expect(values).not.toContain("../tui/bypassConsent.js");
    expect(values.filter((s) => s === "react" || s === "ink" || s.endsWith(".tsx") || /chatMain|ChatApp/.test(s))).toEqual([]);
    expect(src).toContain('await import("../tui/bypassConsent.js")');
  });
});
