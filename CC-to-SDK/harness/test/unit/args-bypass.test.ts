// test/unit/args-bypass.test.ts — Wave-T T15. Two halves of one gate: the flag spelling the real CLI uses
// (`--dangerously-skip-permissions`, which ccx rejected as an unknown flag until now) and the launch-time
// consent check in main.ts that keys on the RESOLVED mode, so BOTH spellings are covered by one condition.
// Deliberately React-free: this file imports `src/cli/main.ts`, and the whole point of the `showBypassConsent`
// seam is that doing so pulls in no ink/React (the last case here pins that).
import { describe, it, expect, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
    // The --bg half states the ALREADY-ACCEPTED case: not asking is one thing, entering bypass unasked is
    // another, and the refusal below owns the second. Without a recorded acceptance this run is refused.
    const bg = gateDeps({ prefs: { skipDangerousModePermissionPrompt: true } });
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
    const src = readFileSync(MAIN_TS, "utf8");
    expect(staticImports(MAIN_TS).map((i) => i.spec)).not.toContain("../tui/bypassConsent.js");
    expect(src).toContain('await import("../tui/bypassConsent.js")');
  });
  it("…and nothing it statically imports pulls React in either, at any depth", () => {
    expect(reactEdgesFrom(MAIN_TS)).toEqual([]);
  });
});

// ── `--bg` + bypass with no recorded acceptance (T15-fix). Upstream refuses this exact combination at
// L451420-21 and names the interactive run that records the acceptance; ours says `ccx` for `claude` so the
// instruction is followable. The reasoning the consent gate rests on — a headless run has no terminal to
// consent in — justifies not ASKING, never entering bypass unasked, and a detached agent is the one that
// would run longest with the fewest checks.
const BG_REFUSAL = "ccx: --bg with bypassPermissions requires accepting the disclaimer first. Run `ccx --dangerously-skip-permissions` once interactively.";
/** stderr only — `fail()` writes the one `ccx: …` line and nothing else reaches the operator. */
async function runCapturingErr(argv: string[], d: MainDeps): Promise<{ code: number; err: string[] }> {
  const err: string[] = [];
  const e = vi.spyOn(console, "error").mockImplementation((s?: unknown) => { err.push(String(s)); });
  try { return { code: await main(argv, d), err }; } finally { e.mockRestore(); }
}

describe("--bg with bypassPermissions (upstream L451420-21)", () => {
  it("is refused when nothing has been accepted — both spellings, before anything is spawned", async () => {
    for (const argv of [["--bg", "--dangerously-skip-permissions", "hi"], ["--bg", "--permission-mode", "bypassPermissions", "hi"]]) {
      const d = gateDeps();                       // spawnDetached THROWS by name if the refusal ever lets it through
      const { code, err } = await runCapturingErr(argv, d);
      expect(code).toBe(2);
      expect(err).toEqual([BG_REFUSAL]);
      expect(d.shown).toHaveLength(0);            // and it does not try to draw a dialog at a terminal it hasn't got
    }
  });
  it("is allowed once the acceptance is recorded — the disclaimer is accepted ONCE, interactively", async () => {
    const d = gateDeps({ prefs: { skipDangerousModePermissionPrompt: true } });
    const spawned: string[] = [];
    d.spawnDetached = () => { spawned.push("x"); return { short: "00000000", banner: "b" }; };
    const { code, err } = await runCapturingErr(["--bg", "--dangerously-skip-permissions", "hi"], d);
    expect(code).toBe(0);
    expect(err).toEqual([]);
    expect(spawned).toHaveLength(1);
  });
  it("leaves every other --bg run alone", async () => {
    for (const argv of [["--bg", "hi"], ["--bg", "--permission-mode", "acceptEdits", "hi"]]) {
      const d = gateDeps();
      d.spawnDetached = () => ({ short: "00000000", banner: "b" });
      const { code, err } = await runCapturingErr(argv, d);
      expect(code).toBe(0);
      expect(err).toEqual([]);
    }
  });
});

// ── `--detachable` + bypass with NO TERMINAL (external review). The consent gate exempts a run with no TTY
// because there is nowhere to draw the dialog, and for `-p`/`--bg` that is the whole story — they leave no
// interactive host behind. `--detachable` does: it spawns a persistent REPL host that survives the terminal
// it was launched from and that every later `ccx attach` joins in whatever mode it was started in. Run from
// a script or a CI step it therefore skipped BOTH the consent gate AND the ordinary "foreground ccx needs a
// terminal" refusal (the --detachable arm returns before that line), and a fully-autonomous bypass agent came
// up unasked. Same mechanism and same words as the --bg refusal above, with the flag's own name in front.
const DETACHABLE_REFUSAL = "ccx: --detachable with bypassPermissions requires accepting the disclaimer first. Run `ccx --dangerously-skip-permissions` once interactively.";

describe("--detachable with bypassPermissions and no TTY", () => {
  it("is refused — both spellings, before anything is spawned", async () => {
    for (const argv of [["--detachable", "--dangerously-skip-permissions", "hi"], ["--detachable", "--permission-mode", "bypassPermissions", "hi"]]) {
      const d = gateDeps({ isTTY: () => false });   // spawnDetached/prepareAttach THROW by name if it slips through
      const { code, err } = await runCapturingErr(argv, d);
      expect(code).toBe(2);
      expect(err).toEqual([DETACHABLE_REFUSAL]);
      expect(d.shown).toHaveLength(0);              // and no dialog is attempted at a terminal it hasn't got
    }
  });
  it("is allowed once the acceptance is recorded — exactly like --bg", async () => {
    const d = gateDeps({ isTTY: () => false, prefs: { skipDangerousModePermissionPrompt: true } });
    const spawned: string[] = [];
    d.spawnDetached = () => { spawned.push("x"); return { short: "00000000", banner: "b" }; };
    d.prepareAttach = async () => ({ short: "00000000", socketPath: "/tmp/x.sock", cwd: "/tmp", initialEntries: [] }) as any;
    d.probeSocket = async () => {};
    d.runChatClient = async () => {};
    const { code, err } = await runCapturingErr(["--detachable", "--dangerously-skip-permissions", "hi"], d);
    expect(code).toBe(0);
    expect(err).toEqual([]);
    expect(spawned).toHaveLength(1);
  });
  it("leaves a --detachable run WITH a terminal to the consent dialog, which is where it belongs", async () => {
    const d = gateDeps();                            // isTTY: true
    d.spawnDetached = () => ({ short: "00000000", banner: "b" });
    d.prepareAttach = async () => ({ short: "00000000", socketPath: "/tmp/x.sock", cwd: "/tmp", initialEntries: [] }) as any;
    d.probeSocket = async () => {};
    const { code, err } = await runCapturingErr(["--detachable", "--dangerously-skip-permissions", "hi"], d);
    expect(code).toBe(0);
    expect(err).toEqual([]);
    expect(d.shown).toHaveLength(1);
  });
  it("leaves every other no-TTY --detachable run alone", async () => {
    for (const argv of [["--detachable", "hi"], ["--detachable", "--permission-mode", "acceptEdits", "hi"]]) {
      const d = gateDeps({ isTTY: () => false });
      d.spawnDetached = () => ({ short: "00000000", banner: "b" });
      d.prepareAttach = async () => ({ short: "00000000", socketPath: "/tmp/x.sock", cwd: "/tmp", initialEntries: [] }) as any;
      d.probeSocket = async () => {};
      d.runChatClient = async () => {};
      const { code, err } = await runCapturingErr(argv, d);
      expect(code).toBe(0);
      expect(err).toEqual([]);
    }
  });
});

// ── Declining costs nothing that has to be unwound (external review). The gate's own comment promises it and
// `--worktree` broke it: `ensureWorktree` ran with the other launch preparation, ABOVE the gate, so
// `ccx --worktree feature-x --dangerously-skip-permissions` cut a branch and a directory and only then asked
// — and a decline (the dialog exits the process from inside) left both behind for the operator to clean up by
// hand. The consent now sits above the creation. The empty-name check stays where it was: a bad argument must
// still be refused before a human is asked anything.
describe("the consent gate runs BEFORE --worktree touches the disk", () => {
  it("asks first, and creates the worktree only after the disclaimer is accepted", async () => {
    const order: string[] = [];
    const d = gateDeps();
    d.showBypassConsent = async () => { order.push("consent"); d.shown.push(1); };
    d.ensureWorktree = async () => { order.push("worktree"); return "/repo/.claude/worktrees/feature-x"; };
    d.makeHost = () => ({ start: async () => { order.push("host"); }, stop: async () => {} }) as any;
    expect(await main(["--worktree", "feature-x", "--dangerously-skip-permissions"], d)).toBe(0);
    expect(order).toEqual(["consent", "worktree", "host"]);
  });
  it("a DECLINE leaves no worktree behind — the dialog never returns, and nothing was cut before it", async () => {
    // The real gate exits the process from inside on a decline (main.ts's seam contract), which a unit test
    // may not do: the stand-in never resolves, which is the same thing from main()'s point of view — every
    // line after the gate is unreachable. `ensureWorktree` throws by name if it is one of them.
    const d = gateDeps();
    let asked = false;
    d.showBypassConsent = () => { asked = true; return new Promise<void>(() => {}); };
    const settled = await Promise.race([
      main(["--worktree", "feature-x", "--dangerously-skip-permissions"], d).then(() => "returned"),
      new Promise((r) => setTimeout(() => r("parked"), 20)),
    ]);
    expect(asked).toBe(true);
    expect(settled).toBe("parked");                  // and ensureWorktree — which throws by name — never ran
  });
  it("still refuses a PRESENT but empty --worktree before asking anything", async () => {
    const d = gateDeps();
    const { code, err } = await runCapturingErr(["--worktree", "", "--dangerously-skip-permissions"], d);
    expect(code).toBe(2);
    expect(err).toEqual(["ccx: --worktree requires a name"]);
    expect(d.shown).toHaveLength(0);
  });
});

// ── The React-free guarantee, checked STRUCTURALLY. The first version of this guard was line-shaped
// (`/^import\s/` per line, specifier read off the same line), which a perfectly ordinary multi-line import
// walks straight past —
//     import {
//       showBypassConsent as staticConsent,
//     } from "../tui/bypassConsent.js";
// — and it only ever looked at main.ts's own lines, so React could have arrived through `../tui/prefs.js`,
// `../tui/banner.js` or `../host/host.js` unseen. This version is statement-shaped and transitive.
const MAIN_TS = fileURLToPath(new URL("../../src/cli/main.ts", import.meta.url));

/** Comments out, string-aware: a naive `//` strip cuts `"https://…"` in half, and an apostrophe in prose
 *  ("main.ts's own lines") must not open a string — which is why comments are recognised FIRST. */
function stripComments(src: string): string {
  let out = "", i = 0;
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (c === "/" && d === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "/" && d === "*") { i += 2; while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++; i += 2; continue; }
    if (c === '"' || c === "'" || c === "`") {
      out += src[i++];
      while (i < src.length) {
        if (src[i] === "\\") { out += src.slice(i, i + 2); i += 2; continue; }
        out += src[i];
        if (src[i++] === c) break;
      }
      continue;
    }
    out += src[i++];
  }
  return out;
}

/** Every STATIC import/re-export in `file`, STATEMENT-shaped: comments out first, then each `import`/
 *  `export … from` matched across however many lines it happens to span. `[^"';]*?` is what holds a match
 *  inside one statement — it can cross newlines but never a quote or a `;`. Dynamic `await import(…)` is
 *  deliberately NOT an edge: it is the mechanism the whole guarantee is built on, and `import(` never
 *  matches `import\s*"` anyway. The self-check is the point — if the scan ever finds fewer imports than
 *  there are lines opening one, it has lost something and says so instead of quietly passing. */
function staticImports(file: string): { spec: string; type: boolean }[] {
  const src = readFileSync(file, "utf8"), bare = stripComments(src);
  const out: { spec: string; type: boolean }[] = [];
  for (const m of bare.matchAll(/(?:^|[^\w$.])(?:import|export)\s+(type\s+)?[^"';]*?\bfrom\s*"([^"]+)"/g)) out.push({ spec: m[2]!, type: Boolean(m[1]) });
  for (const m of bare.matchAll(/(?:^|[^\w$.])import\s*"([^"]+)"/g)) out.push({ spec: m[1]!, type: false });
  const opened = src.split("\n").filter((l) => /^import\b/.test(l)).length;
  if (out.length < opened) throw new Error(`import scan lost statements in ${file}: ${out.length} < ${opened}`);
  return out;
}

/** `./x.js` → the `.ts`/`.tsx` that actually backs it (ESM specifiers, TypeScript sources). Non-relative
 *  specifiers resolve to null — they are checked by NAME instead, above. */
function resolveSpec(from: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const base = join(dirname(from), spec.replace(/\.js$/, ""));
  for (const c of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) if (existsSync(c)) return c;
  return null;
}

/** Every edge in `entry`'s transitive STATIC import graph that reaches React — a `react`/`ink` package or a
 *  `.tsx` module. Type-only edges are skipped: they are erased at compile time and load nothing. */
function reactEdgesFrom(entry: string): string[] {
  const seen = new Set([entry]), queue = [entry], hits: string[] = [];
  while (queue.length) {
    const file = queue.shift()!;
    for (const { spec, type } of staticImports(file)) {
      if (type) continue;
      if (/^(?:react|ink)(?:[-/]|$)/.test(spec)) { hits.push(`${file} -> ${spec}`); continue; }
      const target = resolveSpec(file, spec);
      if (!target) continue;                                  // some other npm dependency, not our concern
      if (target.endsWith(".tsx")) { hits.push(`${file} -> ${spec}`); continue; }
      if (!seen.has(target)) { seen.add(target); queue.push(target); }
    }
  }
  return hits;
}
