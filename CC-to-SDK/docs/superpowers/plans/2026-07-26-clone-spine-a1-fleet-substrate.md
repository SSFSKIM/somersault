# Clone Spine A1 — Fleet Substrate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use doperpowers:subagent-driven-development (recommended) or doperpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `ccx --bg` spawn a detached, self-registering session that survives its parent, and make `ccx agents` / `stop` / `rm` report and control it faithfully enough that doperpowers' unmodified daemon scripts drive it end to end.

**Architecture:** Each session is its own OS process (a *host*) that owns an SDK `Session` and listens on a UDS socket keyed by its **pid**. Fleet truth is two-layer: **live** state is never stored — it is derived from the engine's own `~/.claude/sessions/<pid>.json` row plus a connect-probe and a status RPC — while **terminal** state is recorded in our roster (`~/.claude/ccx/roster/<short>.json`) because a finished process cannot be interrogated. `ccx agents` projects both into the row shape doperpowers already parses.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), `@anthropic-ai/claude-agent-sdk`, `node:net` UDS + NDJSON frames, `zod/v4` for op schemas, `vitest` (unit, no API key) + gated live tests.

**Spec:** `../specs/2026-07-26-clone-process-surface-spine-design.md` (rev 3.2). This plan delivers acceptance **1–4, 9, 9b, 11–18**. Acceptance 5–8 and 10 (attach, follow, park-and-answer, multi-client, `--detachable`) belong to plan **A2**, written after this one lands.

## Global Constraints

- **Short id is exactly 8 lowercase hex.** `_lib.sh` gates the whole purge on `[ "${#short}" -eq 8 ]`; any other length makes `claude rm` and the jobs cleanup silently no-op.
- **Banner is exactly `backgrounded · <short>` on stdout**, with U+00B7 (`·`), and must survive `</dev/null` and `2>&1 |` piping.
- **`agents --json` row keys:** `id`, `sessionId`, `state`, `status`, `cwd`. `state ∈ {working, blocked, done, error, stopped}`; `status ∈ {busy, idle}`.
- **`--bg --resume` uses SDK `resume: <uuid>` + `forkSession: true`** — the exact lever probe 59 verified. Never in-place resume.
- **Session identity is set by env, never by writing a registry row:** `CLAUDE_CODE_SESSION_NAME`, `CLAUDE_CODE_SESSION_KIND` (probe 57). On disk the kind reads `"bg"`; the real `claude agents` view renders that same row as `"background"` (probe 60) — assert the right string at each end.
- **The spawn path scrubs the parent agent's session variables** — `CLAUDE_JOB_DIR`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_CHILD_SESSION`. A `kind=bg` child that inherits `CLAUDE_JOB_DIR` adopts the parent's job and disappears from the agents view behind the parent's identity (probe 60).
- **`agents` is read-only.** It never unlinks anything; `ccx fleet gc` owns deletion.
- **Any explicit permission configuration wins.** The default ask-policy floor applies only to a bare `--bg` with no permission config from any source.
- **Code style:** dense hand-style, no Prettier reformatting; ESM imports end in `.js`; inject dependencies via a `deps = {...}` default parameter so unit tests run without network or real processes.
- **Commands run from `CC-to-SDK/harness/`:** `npm run typecheck`, `npx vitest run test/unit/<file>`.

---

### Task 0: Spike — close Open Question 1 (env → agents view, end to end)

**Question this answers:** Probe 57 proved `CLAUDE_CODE_SESSION_NAME`/`_KIND` reach the *disk row*, and probe 56b proved a disk row reaches the *agents view* — but no single run traced env → agents view. Acceptance 4 depends on that composition. The binary whitelists `kind` to `{bg, daemon, daemon-worker}` and drops unknown values, so this also confirms `bg` survives the whitelist.

**Deliverable is knowledge, not code.** No TDD cycle.

**Files:**
- Create: `CC-to-SDK/probes/probes/60-env-identity-in-agents-view.ts`

- [ ] **Step 1: Write the probe**

```ts
// Probe 60 — Does an env-set name/kind survive all the way into the real `claude agents` view?
// Probe 57 proved env -> disk row; probe 56b proved disk row -> agents view. Acceptance 4 needs the
// composition, and the binary whitelists `kind`, so this confirms "bg" is not silently dropped.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { execFileSync } from "node:child_process";

const NAME = `ccx-probe60-${Date.now().toString(36).slice(-6)}`;
let release!: () => void;
const gate = new Promise<void>((r) => (release = r));
async function* prompts() {
  yield { type: "user" as const, session_id: "", parent_tool_use_id: null, message: { role: "user" as const, content: "Reply with exactly: OK" } };
  await gate;
}
const q = query({ prompt: prompts(), options: {
  model: "claude-haiku-4-5-20251001", permissionMode: "bypassPermissions",
  env: { ...process.env, CLAUDE_CODE_SESSION_NAME: NAME, CLAUDE_CODE_SESSION_KIND: "bg" } as Record<string, string>,
} });

console.log("=== PROBE 60 env identity -> agents view ===  name:", NAME);
let hit: any;
for await (const m of q) {
  if (m.type === "system" && (m as any).subtype === "init") {
    let rows: any[] = [];
    try { rows = JSON.parse(execFileSync("claude", ["agents", "--json", "--all"], { encoding: "utf8", timeout: 30000 })); }
    catch (e: any) { console.log("claude agents failed:", e.message); }
    hit = rows.find((r) => r.name === NAME);
    console.log("rows:", rows.length);
    console.log("our row:", hit ? JSON.stringify(hit) : "NOT LISTED");
    release();
  }
  if ("result" in m) break;
}
console.log("");
console.log(`name survived: ${hit?.name === NAME}`);
console.log(`kind survived: ${hit?.kind === "bg"}  (whitelist check)`);
console.log(`keys present : ${hit ? Object.keys(hit).join(",") : "-"}`);
console.log(hit?.name === NAME && hit?.kind === "bg" ? "RESULT: PASS" : "RESULT: FAIL");
```

- [ ] **Step 2: Run it**

Run: `cd CC-to-SDK/probes && env -u CLAUDE_CODE_OAUTH_TOKEN -u ANTHROPIC_API_KEY npx tsx probes/60-env-identity-in-agents-view.ts`
Expected: `RESULT: PASS`, and the printed key list tells us which of `id`/`state`/`status` the real view supplies for a `kind:"bg"` sdk-cli row.

- [ ] **Step 3: Record the verdict in the spec**

Append one bullet to the spec's `## Surprises & Discoveries` stating whether env-set identity reaches the agents view and which keys that row carries. Then **delete Open Question 1** from the spec's `## Open questions` list and add a line to `## Revision Notes`:
`- 2026-07-26 rev 3.3 — Open Question 1 closed by probe 60: <verdict>.`

If the probe FAILS (name or kind dropped), stop and report: acceptance 4 is not achievable as written and the spec needs a revision before Task 1.

- [ ] **Step 4: Commit**

```bash
git add CC-to-SDK/probes/probes/60-env-identity-in-agents-view.ts CC-to-SDK/docs/superpowers/specs/2026-07-26-clone-process-surface-spine-design.md
git commit -m "probe(60): close open question 1 — env identity reaches the agents view"
```

---

### Task 1: Short ids and fleet paths

**Files:**
- Create: `harness/src/fleet/paths.ts`
- Test: `harness/test/unit/fleet-paths.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `mintShortId(rand?): string` · `isShortId(s: string): boolean` · `fleetRoot(env?): string` · `rosterPath(short, env?): string` · `runDir(env?): string` · `hostSocketPath(pid, env?): string`

- [ ] **Step 1: Write the failing test**

```ts
// harness/test/unit/fleet-paths.test.ts
import { describe, it, expect } from "vitest";
import { mintShortId, isShortId, fleetRoot, rosterPath, runDir, hostSocketPath } from "../../src/fleet/paths.js";

describe("short ids", () => {
  it("mints exactly 8 lowercase hex chars", () => {
    for (let i = 0; i < 200; i++) expect(mintShortId()).toMatch(/^[0-9a-f]{8}$/);
  });
  it("is deterministic under an injected rng", () => {
    expect(mintShortId(() => 0)).toBe("00000000");
  });
  it("validates length strictly — 7 and 9 are rejected", () => {
    // _lib.sh gates the entire purge on [ ${#short} -eq 8 ]; a 7- or 9-char id disables it silently.
    expect(isShortId("a1b2c3d4")).toBe(true);
    expect(isShortId("a1b2c3d")).toBe(false);
    expect(isShortId("a1b2c3d4e")).toBe(false);
    expect(isShortId("A1B2C3D4")).toBe(false);
    expect(isShortId("a1b2c3g4")).toBe(false);
  });
});

describe("paths", () => {
  const env = { HOME: "/home/u" } as NodeJS.ProcessEnv;
  it("roots the fleet under ~/.claude/ccx", () => { expect(fleetRoot(env)).toBe("/home/u/.claude/ccx"); });
  it("keys the roster by short id", () => { expect(rosterPath("a1b2c3d4", env)).toBe("/home/u/.claude/ccx/roster/a1b2c3d4.json"); });
  it("keys the socket by pid, not session id", () => {
    // The session id does not exist when --bg must already listen, and it rotates on /resume.
    expect(hostSocketPath(4242, env)).toBe("/home/u/.claude/ccx/run/4242.sock");
    expect(runDir(env)).toBe("/home/u/.claude/ccx/run");
  });
  it("honours CCX_FLEET_ROOT for test isolation", () => {
    expect(fleetRoot({ HOME: "/home/u", CCX_FLEET_ROOT: "/tmp/t1" })).toBe("/tmp/t1");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/unit/fleet-paths.test.ts`
Expected: FAIL — `Cannot find module '../../src/fleet/paths.js'`

- [ ] **Step 3: Write the implementation**

```ts
// harness/src/fleet/paths.ts
import { homedir } from "node:os";
import { join } from "node:path";

/** Exactly 8 lowercase hex. NOT cosmetic: doperpowers' _lib.sh gates its entire purge path on
 *  `[ "${#short}" -eq 8 ]`, so any other length silently disables `claude rm` + jobs cleanup. */
const SHORT_RE = /^[0-9a-f]{8}$/;

export function mintShortId(rand: () => number = Math.random): string {
  let s = "";
  for (let i = 0; i < 8; i++) s += Math.floor(rand() * 16).toString(16);
  return s;
}
export function isShortId(s: string): boolean { return SHORT_RE.test(s); }

/** Our fleet state root. CCX_FLEET_ROOT overrides it so tests never touch the real fleet. */
export function fleetRoot(env: NodeJS.ProcessEnv = process.env): string {
  if (env.CCX_FLEET_ROOT) return env.CCX_FLEET_ROOT;
  return join(env.HOME ?? homedir(), ".claude", "ccx");
}
/** The `roster` segment lives here only — a second copy in roster.ts would fail silently, since a
 *  readdir of the wrong directory just yields an empty fleet. */
export function rosterDir(env: NodeJS.ProcessEnv = process.env): string { return join(fleetRoot(env), "roster"); }
export function rosterPath(short: string, env: NodeJS.ProcessEnv = process.env): string {
  return join(rosterDir(env), `${short}.json`);
}
export function runDir(env: NodeJS.ProcessEnv = process.env): string { return join(fleetRoot(env), "run"); }
/** Keyed by pid — immutable for the host's life. Not /tmp: macOS sweeps unaccessed /tmp files. */
export function hostSocketPath(pid: number, env: NodeJS.ProcessEnv = process.env): string {
  return join(runDir(env), `${pid}.sock`);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/unit/fleet-paths.test.ts && npm run typecheck`
Expected: PASS, 5 tests; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add harness/src/fleet/paths.ts harness/test/unit/fleet-paths.test.ts
git commit -m "feat(fleet): short ids and pid-keyed fleet paths"
```

---

### Task 2: Liveness — procStart comparison and socket probe

**Files:**
- Create: `harness/src/fleet/liveness.ts`
- Test: `harness/test/unit/fleet-liveness.test.ts`

**Interfaces:**
- Consumes: `hostSocketPath` (Task 1).
- Produces: `procStartOf(pid, deps?): Promise<string | undefined>` · `isPidLive(pid, procStart, deps?): Promise<boolean>` · `socketAnswers(path, deps?): Promise<boolean>`

- [ ] **Step 1: Write the failing test**

```ts
// harness/test/unit/fleet-liveness.test.ts
import { describe, it, expect } from "vitest";
import { isPidLive, socketAnswers } from "../../src/fleet/liveness.js";

const ps = (out: string | undefined) => ({ procStartOf: async () => out });

describe("isPidLive", () => {
  it("is live when procStart matches", async () => {
    expect(await isPidLive(10, "Sat Jul 25 02:55:52 2026", ps("Sat Jul 25 02:55:52 2026"))).toBe(true);
  });
  it("is DEAD when procStart differs — the PID-reuse guard", async () => {
    expect(await isPidLive(10, "Sat Jul 25 02:55:52 2026", ps("Sun Jul 26 09:00:00 2026"))).toBe(false);
  });
  it("is dead when the process is gone", async () => {
    expect(await isPidLive(10, "Sat Jul 25 02:55:52 2026", ps(undefined))).toBe(false);
  });
  it("treats a missing stored procStart as live, matching the binary's gB()", async () => {
    expect(await isPidLive(10, undefined, ps("anything"))).toBe(true);
  });
  it("is LIVE when the probe itself breaks — a broken `ps` must not condemn a running session", async () => {
    // `ps` missing from PATH, or killed by the 1s timeout, tells us nothing about the pid. Answering
    // "dead" there projects `error` over a healthy worker and terminates a doperpowers poller early.
    const boom = { procStartOf: async () => { throw Object.assign(new Error("spawn ps ENOENT"), { code: "ENOENT" }); } };
    expect(await isPidLive(10, "Sat Jul 25 02:55:52 2026", boom)).toBe(true);
  });
});

describe("socketAnswers", () => {
  it("is true when connect succeeds", async () => {
    expect(await socketAnswers("/x.sock", { connect: async () => "ok" })).toBe(true);
  });
  it("is true on EBUSY — busy still means alive, as the binary's Jnd() has it", async () => {
    expect(await socketAnswers("/x.sock", { connect: async () => { throw Object.assign(new Error("busy"), { code: "EBUSY" }); } })).toBe(true);
  });
  it("is false on ENOENT/ECONNREFUSED — a stale socket file", async () => {
    expect(await socketAnswers("/x.sock", { connect: async () => { throw Object.assign(new Error("gone"), { code: "ECONNREFUSED" }); } })).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/unit/fleet-liveness.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// harness/src/fleet/liveness.ts
import { execFile } from "node:child_process";
import { connect as netConnect } from "node:net";
import { promisify } from "node:util";
const execFileP = promisify(execFile);

/** MUST be C locale + UTC: the binary compares against `LC_ALL=C TZ=UTC ps -o lstart=`, and a
 *  locale-formatted value silently fails the comparison (this cost us a wrong roadmap finding). */
export async function procStartOf(pid: number): Promise<string | undefined> {
  let stdout: string;
  try {
    ({ stdout } = await execFileP("ps", ["-o", "lstart=", "-p", String(pid)], {
      env: { ...process.env, LC_ALL: "C", TZ: "UTC" }, timeout: 1000,
    }));
  } catch (e: any) {
    // `ps -p <gone pid>` exits non-zero with no output — that IS the answer. But a `ps` we could not
    // run at all (ENOENT) or one the timeout killed tells us nothing, and answering "gone" there would
    // report every live session as dead. Distinguish, and let the caller fail safe.
    if (typeof e?.code === "number" && !e?.killed) return undefined;
    throw e;
  }
  const s = stdout.trim();
  return s.length ? s : undefined;
}

export async function isPidLive(pid: number, procStart: string | undefined,
  deps: { procStartOf: (p: number) => Promise<string | undefined> } = { procStartOf }): Promise<boolean> {
  if (procStart === undefined) return true;          // matches the binary's gB(): unknown start ⇒ assume live
  try {
    const actual = await deps.procStartOf(pid);
    return actual !== undefined && actual === procStart;
  } catch { return true; }                           // a broken probe must not declare a live session dead
}

const CONNECT_TIMEOUT_MS = 250;                       // the binary uses 250ms
async function realConnect(path: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const sock = netConnect({ path });
    const done = (fn: () => void) => { sock.destroy(); fn(); };
    sock.once("connect", () => done(() => resolve("ok")));
    sock.once("error", (e) => done(() => reject(e)));
    sock.setTimeout(CONNECT_TIMEOUT_MS, () => done(() => reject(new Error("timeout"))));
  });
}

export async function socketAnswers(path: string,
  deps: { connect: (p: string) => Promise<string> } = { connect: realConnect }): Promise<boolean> {
  try { await deps.connect(path); return true; }
  catch (e: any) { return e?.code === "EBUSY"; }      // busy ⇒ someone is listening ⇒ alive
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/unit/fleet-liveness.test.ts && npm run typecheck`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add harness/src/fleet/liveness.ts harness/test/unit/fleet-liveness.test.ts
git commit -m "feat(fleet): procStart PID-reuse guard and 250ms socket probe"
```

---

### Task 3: The roster — terminal state store

**Files:**
- Create: `harness/src/fleet/roster.ts`
- Test: `harness/test/unit/fleet-roster.test.ts`

**Interfaces:**
- Consumes: `rosterPath`, `fleetRoot` (Task 1).
- Produces: `RosterRow` (type) · `writeRoster(row, env?)` · `readRoster(short, env?)` · `listRoster(env?)` · `finalizeRoster(short, state, env?)`
- `RosterRow = { short: string; sessionId?: string; pid: number; cwd: string; worktree?: string; kind: "bg" | "interactive"; name: string; state: FleetState; startedAt: number; endedAt?: number; noHumanSeam?: boolean; procStart?: string }`
- `FleetState = "working" | "blocked" | "done" | "error" | "stopped"`

- [ ] **Step 1: Write the failing test**

```ts
// harness/test/unit/fleet-roster.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeRoster, readRoster, listRoster, finalizeRoster } from "../../src/fleet/roster.js";
import type { RosterRow } from "../../src/fleet/roster.js";

let env: NodeJS.ProcessEnv;
const row = (over: Partial<RosterRow> = {}): RosterRow => ({
  short: "a1b2c3d4", pid: 100, cwd: "/w", kind: "bg", name: "worker-1", state: "working", startedAt: 1, ...over,
});
beforeEach(() => { env = { CCX_FLEET_ROOT: mkdtempSync(join(tmpdir(), "ccx-roster-")) }; });
afterEach(() => { rmSync(env.CCX_FLEET_ROOT!, { recursive: true, force: true }); });

describe("roster", () => {
  it("round-trips a row", () => {
    writeRoster(row(), env);
    expect(readRoster("a1b2c3d4", env)).toMatchObject({ short: "a1b2c3d4", name: "worker-1", state: "working" });
  });
  it("returns undefined for an unknown short", () => { expect(readRoster("ffffffff", env)).toBeUndefined(); });
  it("lists every row", () => {
    writeRoster(row(), env); writeRoster(row({ short: "b2c3d4e5", pid: 101 }), env);
    expect(listRoster(env).map((r) => r.short).sort()).toEqual(["a1b2c3d4", "b2c3d4e5"]);
  });
  it("finalize stamps the terminal state and endedAt without losing other fields", () => {
    writeRoster(row({ sessionId: "sid-1", worktree: "/w/.claude/worktrees/wt" }), env);
    finalizeRoster("a1b2c3d4", "done", env, () => 999);
    const r = readRoster("a1b2c3d4", env)!;
    expect(r.state).toBe("done"); expect(r.endedAt).toBe(999);
    expect(r.sessionId).toBe("sid-1"); expect(r.worktree).toBe("/w/.claude/worktrees/wt");
  });
  it("finalize on an unknown short is a no-op, not a throw — it must be idempotent for rm/stop", () => {
    expect(() => finalizeRoster("ffffffff", "stopped", env)).not.toThrow();
  });
  it("first terminal state wins — a losing `stop` must not overwrite a truthful `done`", () => {
    writeRoster(row(), env);
    finalizeRoster("a1b2c3d4", "done", env, () => 100);
    finalizeRoster("a1b2c3d4", "stopped", env, () => 200);
    const r = readRoster("a1b2c3d4", env)!;
    expect(r.state).toBe("done"); expect(r.endedAt).toBe(100);
  });
  it("leaves no partial row behind — a reader never sees a truncated file", () => {
    // writeFileSync truncates before writing; a host killed in that window strands the session
    // permanently, because finalizeRoster early-returns on an unreadable row.
    writeRoster(row(), env);
    expect(readdirSync(join(env.CCX_FLEET_ROOT!, "roster")).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
  it("refuses to write a row whose short is not 8 hex — it would be written but never listed", () => {
    expect(() => writeRoster(row({ short: "nope" }), env)).toThrow(/nope/);
  });
  it("skips well-formed JSON that is not a row", () => {
    writeRoster(row(), env);
    writeFileSync(join(env.CCX_FLEET_ROOT!, "roster", "dddddddd.json"), "[]");
    expect(listRoster(env).map((r) => r.short)).toEqual(["a1b2c3d4"]);
  });
  it("returns [] when the roster directory does not exist at all", () => {
    expect(listRoster({ CCX_FLEET_ROOT: join(tmpdir(), "ccx-does-not-exist-" + Date.now()) })).toEqual([]);
  });
  it("round-trips the noHumanSeam flag, which agents surfaces", () => {
    writeRoster(row({ noHumanSeam: true }), env);
    expect(readRoster("a1b2c3d4", env)!.noHumanSeam).toBe(true);
  });
  it("skips unparseable rows rather than failing the whole listing", () => {
    writeRoster(row(), env);
    mkdirSync(join(env.CCX_FLEET_ROOT!, "roster"), { recursive: true });
    writeFileSync(join(env.CCX_FLEET_ROOT!, "roster", "cccccccc.json"), "{ not json");
    expect(listRoster(env).map((r) => r.short)).toEqual(["a1b2c3d4"]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/unit/fleet-roster.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// harness/src/fleet/roster.ts
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { rosterDir, rosterPath, isShortId } from "./paths.js";

export type FleetState = "working" | "blocked" | "done" | "error" | "stopped";
export const TERMINAL: ReadonlySet<FleetState> = new Set<FleetState>(["done", "error", "stopped"]);

export interface RosterRow {
  short: string; sessionId?: string; pid: number; cwd: string; worktree?: string;
  kind: "bg" | "interactive"; name: string; state: FleetState; startedAt: number; endedAt?: number;
  /** Our own copy of the host's `ps -o lstart=` stamp. The ENGINE's registry row carries one too, but
   *  it is unlinked when the session exits — and a roster row outlives it. Without our own copy,
   *  `isPidLive(pid, undefined)` answers "live" for every dead-but-unfinalized session, so a crashed
   *  host would read `working`/unresponsive forever instead of `error`. */
  procStart?: string;
  /** A bare `--bg` with no permission config from any source: nothing can ever route a decision to a
   *  human, so `agents` must say so. Set once at start by the host; never derived at read time. */
  noHumanSeam?: boolean;
}

/** Write-then-rename, not a bare write. `writeFileSync` truncates first, so a host killed mid-write
 *  leaves a permanently unparseable row — and since finalizeRoster early-returns on an unreadable row,
 *  that session could never be marked terminal and a poller would wait on it forever. The temp name
 *  carries the pid so two writers cannot clobber each other's staging file; `listRoster`'s isShortId
 *  filter already ignores anything ending in `.tmp`. */
export function writeRoster(row: RosterRow, env: NodeJS.ProcessEnv = process.env): void {
  if (!isShortId(row.short)) throw new Error(`refusing to write a roster row with short ${JSON.stringify(row.short)}`);
  const p = rosterPath(row.short, env);
  mkdirSync(dirname(p), { recursive: true, mode: 0o700 });
  const tmp = `${p}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(row), { mode: 0o600 });
  renameSync(tmp, p);                          // same-directory rename is atomic on POSIX
}

export function readRoster(short: string, env: NodeJS.ProcessEnv = process.env): RosterRow | undefined {
  let parsed: unknown;
  try { parsed = JSON.parse(readFileSync(rosterPath(short, env), "utf8")); } catch { return undefined; }
  // "skip unparseable rows" has to cover "parsed, but not a row" — a stray `[]` or `123` would
  // otherwise enter the listing as a row whose every field is undefined.
  const r = parsed as RosterRow;
  return r && typeof r === "object" && isShortId(r.short) ? r : undefined;
}

export function listRoster(env: NodeJS.ProcessEnv = process.env): RosterRow[] {
  let files: string[];
  try { files = readdirSync(rosterDir(env)); } catch { return []; }
  const out: RosterRow[] = [];
  for (const f of files) {
    const short = f.replace(/\.json$/, "");
    if (!isShortId(short)) continue;
    const r = readRoster(short, env);           // a corrupt row must not sink the listing
    if (r) out.push(r);
  }
  return out;
}

/** Stamp the terminal state. Silent on an unknown short, and FIRST TERMINAL WINS: `stop` legitimately
 *  races a session's own exit, and the loser must not overwrite a truthful `done` with `stopped` or
 *  re-stamp endedAt. That guard is what makes this genuinely idempotent. */
export function finalizeRoster(short: string, state: FleetState, env: NodeJS.ProcessEnv = process.env,
  now: () => number = Date.now): void {
  const r = readRoster(short, env);
  if (!r || TERMINAL.has(r.state)) return;
  writeRoster({ ...r, state, endedAt: now() }, env);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/unit/fleet-roster.test.ts && npm run typecheck`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add harness/src/fleet/roster.ts harness/test/unit/fleet-roster.test.ts
git commit -m "feat(fleet): roster store for terminal session state"
```

---

### Task 4: Registry reader — the engine's live rows

**Files:**
- Create: `harness/src/fleet/registry.ts`
- Test: `harness/test/unit/fleet-registry.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `RegistryRow` (type) · `sessionsDir(env?): string` · `readRegistry(env?): RegistryRow[]`
- `RegistryRow = { pid: number; sessionId?: string; cwd: string; name?: string; kind?: string; entrypoint?: string; procStart?: string; startedAt?: number; status?: string }`

- [ ] **Step 1: Write the failing test**

```ts
// harness/test/unit/fleet-registry.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readRegistry } from "../../src/fleet/registry.js";

let env: NodeJS.ProcessEnv, dir: string;
beforeEach(() => {
  const home = mkdtempSync(join(tmpdir(), "ccx-reg-"));
  dir = join(home, ".claude", "sessions");
  mkdirSync(dir, { recursive: true });
  env = { HOME: home };
});
const put = (pid: number, body: unknown) => writeFileSync(join(dir, `${pid}.json`), JSON.stringify(body));

describe("readRegistry", () => {
  it("reads <pid>.json rows written by the engine", () => {
    put(4242, { pid: 4242, sessionId: "sid-1", cwd: "/w", name: "worker-1", kind: "bg", entrypoint: "sdk-cli", procStart: "Sat Jul 25 02:55:52 2026" });
    expect(readRegistry(env)).toEqual([expect.objectContaining({ pid: 4242, sessionId: "sid-1", kind: "bg", name: "worker-1" })]);
  });
  it("ignores non-<pid>.json files", () => {
    put(4242, { pid: 4242, cwd: "/w" });
    writeFileSync(join(dir, "notes.txt"), "x");
    writeFileSync(join(dir, "abc.json"), "{}");
    expect(readRegistry(env).map((r) => r.pid)).toEqual([4242]);
  });
  it("skips corrupt rows instead of throwing", () => {
    put(1, { pid: 1, cwd: "/w" });
    writeFileSync(join(dir, "2.json"), "{ nope");
    expect(readRegistry(env).map((r) => r.pid)).toEqual([1]);
  });
  it("returns [] when the directory does not exist", () => { expect(readRegistry({ HOME: "/nope" })).toEqual([]); });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/unit/fleet-registry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// harness/src/fleet/registry.ts
import { readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** A row the ENGINE writes for itself at session start and unlinks on exit. We never write these —
 *  identity is steered via CLAUDE_CODE_SESSION_NAME / _KIND (probe 57). */
export interface RegistryRow {
  pid: number; sessionId?: string; cwd: string; name?: string; kind?: string;
  entrypoint?: string; procStart?: string; startedAt?: number; status?: string;
}

export function sessionsDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.HOME ?? homedir(), ".claude", "sessions");
}

export function readRegistry(env: NodeJS.ProcessEnv = process.env): RegistryRow[] {
  let files: string[];
  try { files = readdirSync(sessionsDir(env)); } catch { return []; }
  const out: RegistryRow[] = [];
  for (const f of files) {
    if (!/^\d+\.json$/.test(f)) continue;
    try {
      const r = JSON.parse(readFileSync(join(sessionsDir(env), f), "utf8")) as RegistryRow;
      if (typeof r?.pid === "number") out.push(r);
    } catch { /* a corrupt row must not sink the listing */ }
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/unit/fleet-registry.test.ts && npm run typecheck`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add harness/src/fleet/registry.ts harness/test/unit/fleet-registry.test.ts
git commit -m "feat(fleet): reader for the engine's live session registry"
```

---

### Task 5: Projection — the four-arm state rule

This is the task that makes acceptance 3, 9b and the hung-host arm true. Get the table right before anything consumes it.

**Files:**
- Create: `harness/src/fleet/project.ts`
- Test: `harness/test/unit/fleet-project.test.ts`

**Interfaces:**
- Consumes: `RosterRow`/`TERMINAL` (Task 3), `RegistryRow` (Task 4).
- Produces: `AgentsRow` (type) · `projectRow(input): AgentsRow`
- `AgentsRow = { id: string; sessionId: string; state: FleetState; status: "busy" | "idle"; cwd: string; name: string; unresponsive?: boolean }`
- `projectRow(input: { roster: RosterRow; registry?: RegistryRow; pidLive: boolean; socketAnswers: boolean; liveStatus?: { state: FleetState; status: "busy" | "idle" } }): AgentsRow`

- [ ] **Step 1: Write the failing test**

```ts
// harness/test/unit/fleet-project.test.ts
import { describe, it, expect } from "vitest";
import { projectRow } from "../../src/fleet/project.js";
import type { RosterRow } from "../../src/fleet/roster.js";

const roster = (over: Partial<RosterRow> = {}): RosterRow => ({
  short: "a1b2c3d4", sessionId: "sid-1", pid: 100, cwd: "/w", kind: "bg", name: "w1", state: "working", startedAt: 1, ...over,
});

describe("projectRow — the four arms", () => {
  it("arm 1: a terminal roster state projects as-is, even long after exit", () => {
    // Acceptance 3: a finished session must STILL be listed, or _poll_until_done never terminates.
    const r = projectRow({ roster: roster({ state: "done", endedAt: 9 }), pidLive: false, socketAnswers: false });
    expect(r.state).toBe("done"); expect(r.status).toBe("idle");
  });
  it("arm 1 covers stopped and error too", () => {
    expect(projectRow({ roster: roster({ state: "stopped" }), pidLive: false, socketAnswers: false }).state).toBe("stopped");
    expect(projectRow({ roster: roster({ state: "error" }), pidLive: false, socketAnswers: false }).state).toBe("error");
  });
  it("arm 1 BEATS a live host — reordering the terminal guard is the regression this catches", () => {
    // Every other arm-1 test passes pidLive:false, so moving the terminal guard below the live arms
    // keeps the suite green. This is the one that notices: a `done` session whose pid was recycled and
    // whose socket answers must still report done, not the stranger's live status.
    const r = projectRow({ roster: roster({ state: "done" }), pidLive: true, socketAnswers: true, liveStatus: { state: "working", status: "busy" } });
    expect(r.state).toBe("done"); expect(r.status).toBe("idle"); expect(r.unresponsive).toBeUndefined();
  });
  it("arm 1 keeps its OWN sessionId even when a registry row claims that pid", () => {
    // Registry rows are keyed by pid and unlinked on exit, so one matching a FINISHED session's pid is
    // a different process. Handing the consumer a stranger's sessionId is worse than handing it none.
    const r = projectRow({ roster: roster({ state: "done", sessionId: "sid-mine" }),
      registry: { pid: 100, cwd: "/w", sessionId: "sid-stranger" }, pidLive: true, socketAnswers: true });
    expect(r.sessionId).toBe("sid-mine");
  });
  it("an answering socket suppresses `unresponsive` even with no live status to report", () => {
    // Deleting this branch leaves the suite green while every healthy host reads as hung.
    const r = projectRow({ roster: roster(), pidLive: true, socketAnswers: true });
    expect(r.unresponsive).toBeUndefined(); expect(r.status).toBe("busy");
  });
  it("arm 2: live pid + answering socket projects the LIVE status from the host", () => {
    const r = projectRow({ roster: roster(), pidLive: true, socketAnswers: true, liveStatus: { state: "blocked", status: "idle" } });
    expect(r.state).toBe("blocked"); expect(r.status).toBe("idle"); expect(r.unresponsive).toBeUndefined();
  });
  it("arm 3: live pid + silent socket keeps the roster state and flags unresponsive", () => {
    // A live process is not evidence of failure; adjudicating a hang is the spawner's timeout to make.
    const r = projectRow({ roster: roster({ state: "working" }), pidLive: true, socketAnswers: false });
    expect(r.state).toBe("working"); expect(r.unresponsive).toBe(true);
  });
  it("arm 4: non-terminal roster + dead pid projects error", () => {
    // Acceptance 9b: a SIGKILLed host must not report `working` forever and hang the poller.
    const r = projectRow({ roster: roster({ state: "working" }), pidLive: false, socketAnswers: false });
    expect(r.state).toBe("error"); expect(r.status).toBe("idle");
  });
  it("prefers the registry sessionId once the engine has one, and emits '' before that", () => {
    // The poller treats an empty sessionId as not-yet-ready and keeps waiting — that is the startup window.
    expect(projectRow({ roster: roster({ sessionId: undefined }), pidLive: true, socketAnswers: true }).sessionId).toBe("");
    expect(projectRow({ roster: roster({ sessionId: undefined }), registry: { pid: 100, cwd: "/w", sessionId: "sid-live" }, pidLive: true, socketAnswers: true }).sessionId).toBe("sid-live");
  });
  it("emits the short id as `id` and carries cwd and name", () => {
    const r = projectRow({ roster: roster({ cwd: "/repo/.claude/worktrees/wt" }), pidLive: false, socketAnswers: false });
    expect(r.id).toBe("a1b2c3d4"); expect(r.cwd).toBe("/repo/.claude/worktrees/wt"); expect(r.name).toBe("w1");
  });
  it("carries noHumanSeam through from the roster, and omits the key when it is not set", () => {
    // Acceptance 9's reporting half: `agents` must be able to say a worker has nothing to ask.
    expect(projectRow({ roster: roster({ noHumanSeam: true }), pidLive: false, socketAnswers: false }).noHumanSeam).toBe(true);
    expect("noHumanSeam" in projectRow({ roster: roster(), pidLive: false, socketAnswers: false })).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/unit/fleet-project.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// harness/src/fleet/project.ts
import { TERMINAL } from "./roster.js";
import type { FleetState, RosterRow } from "./roster.js";
import type { RegistryRow } from "./registry.js";

/** The row shape doperpowers' _poll_until_done parses: id (short), sessionId, state, status, cwd. */
export interface AgentsRow {
  id: string; sessionId: string; state: FleetState; status: "busy" | "idle";
  cwd: string; name: string;
  unresponsive?: boolean;   // live pid, silent socket — a hung host, not a failed one
  noHumanSeam?: boolean;    // a bare --bg with no permission config: nothing can ever route to `ask`
}

export interface ProjectInput {
  roster: RosterRow;
  registry?: RegistryRow;
  pidLive: boolean;
  socketAnswers: boolean;
  liveStatus?: { state: FleetState; status: "busy" | "idle" };
}

/** State is DERIVED at read time — we never rewrite the roster from a read command. Four arms:
 *   terminal                      → as-is
 *   live pid + socket answers     → the host's live status
 *   live pid + socket silent      → roster state, flagged unresponsive (a live process is not a failure)
 *   dead pid                      → error (or the poller waits forever on a SIGKILLed host) */
export function projectRow(input: ProjectInput): AgentsRow {
  const { roster, registry, pidLive, socketAnswers, liveStatus } = input;
  const base = { id: roster.short, cwd: roster.cwd, name: roster.name,
    ...(roster.noHumanSeam ? { noHumanSeam: true } : {}) };

  // A finished session's identity comes from its OWN row. The engine unlinks its registry row on exit
  // and files those rows by pid, so a registry row still matching a dead session's pid belongs to a
  // DIFFERENT process — taking its sessionId would hand the consumer a stranger's session to act on.
  if (TERMINAL.has(roster.state)) return { ...base, sessionId: roster.sessionId ?? "", state: roster.state, status: "idle" };
  const sessionId = registry?.sessionId ?? roster.sessionId ?? "";
  if (pidLive && socketAnswers && liveStatus) return { ...base, sessionId, state: liveStatus.state, status: liveStatus.status };
  if (pidLive && socketAnswers) return { ...base, sessionId, state: roster.state, status: "busy" };
  if (pidLive) return { ...base, sessionId, state: roster.state, status: "busy", unresponsive: true };
  return { ...base, sessionId, state: "error", status: "idle" };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/unit/fleet-project.test.ts && npm run typecheck`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add harness/src/fleet/project.ts harness/test/unit/fleet-project.test.ts
git commit -m "feat(fleet): four-arm read-time state projection"
```

---

### Task 6: Host server — per-session UDS with a status op

Lift the NDJSON + zod pattern from `daemon/server.ts`; do **not** reuse the file (its 26 ops are supervisor-id-addressed and it is one-shot per connection).

**Files:**
- Create: `harness/src/host/ops.ts`, `harness/src/host/server.ts`
- Test: `harness/test/unit/host-server.test.ts`

**Interfaces:**
- Consumes: `hostSocketPath` (Task 1), `FleetState` (Task 3).
- Produces: `HostOp` (zod union) · `HostStatus = { state: FleetState; status: "busy" | "idle"; waitingFor?: string }` · `class HostServer { constructor(handlers: { status(): HostStatus; stop(): Promise<void> }, socketPath: string); listen(): Promise<void>; close(): Promise<void>; readonly closed: Promise<void> }`

- [ ] **Step 1: Write the failing test**

```ts
// harness/test/unit/host-server.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "node:net";
import { HostServer } from "../../src/host/server.js";

let srv: HostServer | undefined;
afterEach(async () => { await srv?.close(); srv = undefined; });

function ask(path: string, op: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const s = connect({ path }, () => s.write(JSON.stringify(op) + "\n"));
    let buf = "";
    s.on("data", (d) => { buf += d; const i = buf.indexOf("\n"); if (i >= 0) { s.end(); resolve(JSON.parse(buf.slice(0, i))); } });
    s.on("error", reject);
  });
}

describe("HostServer", () => {
  it("answers a status op with the handler's snapshot", async () => {
    const sock = join(mkdtempSync(join(tmpdir(), "ccx-host-")), "h.sock");
    srv = new HostServer({ status: () => ({ state: "blocked", status: "idle", waitingFor: "Bash(rm -rf build/)" }), stop: async () => {} }, sock);
    await srv.listen();
    expect(await ask(sock, { op: "status" })).toEqual({ ok: true, state: "blocked", status: "idle", waitingFor: "Bash(rm -rf build/)" });
  });
  it("rejects an unknown op without killing the connection handler", async () => {
    const sock = join(mkdtempSync(join(tmpdir(), "ccx-host-")), "h.sock");
    srv = new HostServer({ status: () => ({ state: "working", status: "busy" }), stop: async () => {} }, sock);
    await srv.listen();
    const bad = await ask(sock, { op: "nonsense" });
    expect(bad.ok).toBe(false);
    expect(await ask(sock, { op: "status" })).toMatchObject({ ok: true, state: "working" });
  });
  it("invokes the stop handler and resolves `closed`", async () => {
    const sock = join(mkdtempSync(join(tmpdir(), "ccx-host-")), "h.sock");
    let stopped = false;
    srv = new HostServer({ status: () => ({ state: "working", status: "busy" }), stop: async () => { stopped = true; } }, sock);
    await srv.listen();
    expect(await ask(sock, { op: "stop" })).toMatchObject({ ok: true });
    expect(stopped).toBe(true);
  });
  it("close() does not block on an open client connection", async () => {
    // node's server.close() waits for every open connection to end. Without destroying them, the
    // `stop` op deadlocks: the handler calls close(), which waits for the very connection that is
    // waiting for the stop ack. It self-heals only when the client's 1s timeout fires.
    const sock = join(mkdtempSync(join(tmpdir(), "ccx-host-")), "h.sock");
    srv = new HostServer({ status: () => ({ state: "working", status: "busy" }), stop: async () => {} }, sock);
    await srv.listen();
    const held = connect({ path: sock });
    await new Promise((r) => held.once("connect", r));
    await Promise.race([srv.close(),
      new Promise((_, rej) => setTimeout(() => rej(new Error("close() hung on an open connection")), 2000))]);
    held.destroy();
    srv = undefined;
  });
  it("close() is idempotent and removes the socket file", async () => {
    const sock = join(mkdtempSync(join(tmpdir(), "ccx-host-")), "h.sock");
    srv = new HostServer({ status: () => ({ state: "working", status: "busy" }), stop: async () => {} }, sock);
    await srv.listen(); await srv.close(); await srv.close();
    const { existsSync } = await import("node:fs");
    expect(existsSync(sock)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/unit/host-server.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// harness/src/host/ops.ts
import { z } from "zod/v4";
import type { FleetState } from "../fleet/roster.js";

export interface HostStatus { state: FleetState; status: "busy" | "idle"; waitingFor?: string }
export const hostOp = z.discriminatedUnion("op", [
  z.object({ op: z.literal("status") }),
  z.object({ op: z.literal("stop") }),
]);
export type HostOp = z.infer<typeof hostOp>;
```

```ts
// harness/src/host/server.ts
import { createServer } from "node:net";
import type { Server, Socket } from "node:net";
import { mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { hostOp } from "./ops.js";
import type { HostStatus } from "./ops.js";

export interface HostHandlers { status(): HostStatus; stop(): Promise<void> }

/** One UDS listener per SESSION (not per fleet). NDJSON frames, one op per line; the connection stays
 *  open so A2 can add a long-lived `follow` stream over the same socket. */
export class HostServer {
  private server: Server;
  private closing = false;
  private open = new Set<Socket>();
  private closeResolve!: () => void;
  readonly closed: Promise<void> = new Promise((r) => { this.closeResolve = r; });

  constructor(private handlers: HostHandlers, private socketPath: string) {
    this.server = createServer((s) => this.onConnection(s));
  }

  async listen(): Promise<void> {
    mkdirSync(dirname(this.socketPath), { recursive: true, mode: 0o700 });
    rmSync(this.socketPath, { force: true });          // a stale file from a SIGKILLed predecessor
    await new Promise<void>((resolve, reject) => {
      const onErr = (e: Error) => reject(e);
      this.server.once("error", onErr);
      this.server.listen(this.socketPath, () => { this.server.off("error", onErr); resolve(); });
    });
  }

  async close(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    const done = new Promise<void>((resolve) => this.server.close(() => resolve()));
    for (const s of this.open) s.destroy();   // close() waits for every open connection; the `stop` op
    this.open.clear();                        // is answered over one, so waiting on it would deadlock
    await done;
    rmSync(this.socketPath, { force: true });
    this.closeResolve();
  }

  private onConnection(sock: Socket): void {
    this.open.add(sock);
    sock.once("close", () => this.open.delete(sock));
    let buf = "";
    sock.on("data", async (chunk) => {
      buf += chunk.toString("utf8");
      for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        sock.write(JSON.stringify(await this.dispatch(line)) + "\n");
      }
    });
    sock.on("error", () => { /* a client that vanished mid-write is not our failure */ });
  }

  private async dispatch(line: string): Promise<Record<string, unknown>> {
    let parsed: unknown;
    try { parsed = JSON.parse(line); } catch { return { ok: false, error: "bad json" }; }
    const op = hostOp.safeParse(parsed);
    if (!op.success) return { ok: false, error: "unknown op" };
    switch (op.data.op) {
      case "status": return { ok: true, ...this.handlers.status() };
      case "stop": await this.handlers.stop(); return { ok: true };
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/unit/host-server.test.ts && npm run typecheck`
Expected: PASS, 5 tests.

> **Note on the `stop` op:** `dispatch` awaits `handlers.stop()` before replying, and the real handler
> (Task 7) closes this very server. That is safe only because `close()` destroys open connections —
> the ack is therefore best-effort, and the caller in Task 11 treats a missing ack as "already gone"
> rather than as a failure. Do not "fix" this by making `close()` wait politely.

- [ ] **Step 5: Commit**

```bash
git add harness/src/host/ops.ts harness/src/host/server.ts harness/test/unit/host-server.test.ts
git commit -m "feat(host): per-session UDS server with status and stop ops"
```

---

### Task 7: SessionHost — wire the SDK session to roster and status

**Files:**
- Create: `harness/src/host/host.ts`
- Test: `harness/test/unit/host-session.test.ts`

**Interfaces:**
- Consumes: `HostServer`/`HostStatus` (Task 6), roster fns (Task 3), `hostSocketPath` (Task 1), `openSession` from `../session/index.js`.
- Produces: `class SessionHost { constructor(opts: SessionHostOpts, deps?); start(): Promise<void>; runTask(prompt: string): Promise<void>; status(): HostStatus; stop(): Promise<void>; readonly short: string }`
- `SessionHostOpts = { short: string; name: string; cwd: string; kind: "bg" | "interactive"; worktree?: string; noHumanSeam?: boolean; config: HarnessConfig; env?: NodeJS.ProcessEnv }`

- [ ] **Step 1: Write the failing test**

```ts
// harness/test/unit/host-session.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionHost } from "../../src/host/host.js";
import { readRoster } from "../../src/fleet/roster.js";

let env: NodeJS.ProcessEnv;
beforeEach(() => { env = { CCX_FLEET_ROOT: mkdtempSync(join(tmpdir(), "ccx-host-")), HOME: "/home/u" }; });

const opts = () => ({ short: "a1b2c3d4", name: "w1", cwd: "/w", kind: "bg" as const, config: {}, env });
/** Always inject procStartOf: a unit test must not spawn `ps`. */
const deps = (openSession: any) => ({ openSession, procStartOf: async () => "Sat Jul 25 02:55:52 2026" });
/** A fake session: resolves the turn only when we let it, so we can observe `working` mid-flight. */
function fakeSession() {
  let finish!: () => void;
  const turn = new Promise<void>((r) => (finish = r));
  return { finish, session: { submit: async () => { await turn; return { result: {} }; }, sessionId: "sid-1", dispose: async () => {} } };
}

describe("SessionHost", () => {
  it("writes a working roster row at start, before any session id exists", async () => {
    const h = new SessionHost(opts(), deps(() => fakeSession().session as any));
    await h.start();
    expect(readRoster("a1b2c3d4", env)).toMatchObject({ short: "a1b2c3d4", name: "w1", state: "working", kind: "bg" });
    await h.stop();
  });
  it("records its own procStart, so a crashed host can later be told apart from a live one", async () => {
    const h = new SessionHost(opts(), deps(() => fakeSession().session as any));
    await h.start();
    expect(readRoster("a1b2c3d4", env)!.procStart).toBe("Sat Jul 25 02:55:52 2026");
    await h.stop();
  });
  it("records noHumanSeam on the roster row when the caller reports one", async () => {
    const h = new SessionHost({ ...opts(), noHumanSeam: true }, deps(() => fakeSession().session as any));
    await h.start();
    expect(readRoster("a1b2c3d4", env)!.noHumanSeam).toBe(true);
    await h.stop();
  });
  it("reports busy while a turn runs and idle/done after it finishes", async () => {
    const f = fakeSession();
    const h = new SessionHost(opts(), deps(() => f.session as any));
    await h.start();
    const running = h.runTask("do it");
    expect(h.status()).toMatchObject({ state: "working", status: "busy" });
    f.finish(); await running;
    expect(h.status()).toMatchObject({ state: "done", status: "idle" });
    await h.stop();
  });
  it("finalizes the roster to done when the task completes", async () => {
    const f = fakeSession();
    const h = new SessionHost(opts(), deps(() => f.session as any));
    await h.start(); const running = h.runTask("x"); f.finish(); await running; await h.stop();
    const r = readRoster("a1b2c3d4", env)!;
    expect(r.state).toBe("done"); expect(typeof r.endedAt).toBe("number");
  });
  it("finalizes to error when the turn throws", async () => {
    const h = new SessionHost(opts(), deps(() => ({ submit: async () => { throw new Error("boom"); }, sessionId: "s", dispose: async () => {} }) as any));
    await h.start(); await h.runTask("x").catch(() => {}); await h.stop();
    expect(readRoster("a1b2c3d4", env)!.state).toBe("error");
  });
  it("stop() finalizes to stopped, not done — daemon-finalize.sh routes it down the error arm", async () => {
    const h = new SessionHost(opts(), deps(() => fakeSession().session as any));
    await h.start(); await h.stop("stopped");
    expect(readRoster("a1b2c3d4", env)!.state).toBe("stopped");
  });
  it("records the sessionId into the roster once the engine reports one", async () => {
    const f = fakeSession();
    const h = new SessionHost(opts(), deps(() => f.session as any));
    await h.start(); const running = h.runTask("x"); f.finish(); await running; await h.stop();
    expect(readRoster("a1b2c3d4", env)!.sessionId).toBe("sid-1");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/unit/host-session.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// harness/src/host/host.ts
import { HostServer } from "./server.js";
import type { HostStatus } from "./ops.js";
import { hostSocketPath } from "../fleet/paths.js";
import { finalizeRoster, readRoster, writeRoster } from "../fleet/roster.js";
import { procStartOf as realProcStartOf } from "../fleet/liveness.js";
import type { FleetState, RosterRow } from "../fleet/roster.js";
import { openSession as realOpenSession } from "../session/index.js";
import type { HarnessConfig } from "../config/types.js";

export interface SessionHostOpts {
  short: string; name: string; cwd: string; kind: "bg" | "interactive";
  worktree?: string; noHumanSeam?: boolean; config: HarnessConfig; env?: NodeJS.ProcessEnv;
}

/** Owns one SDK session, its UDS socket, and its roster row. Live truth is answered over the socket;
 *  only the TERMINAL state is written down, because a finished process cannot be interrogated. */
export class SessionHost {
  readonly short: string;
  private session: any;
  private server?: HostServer;
  private state: FleetState = "working";
  private busy = false;
  private env: NodeJS.ProcessEnv;

  constructor(private opts: SessionHostOpts,
    private deps: { openSession: (c: HarnessConfig) => any; procStartOf?: (p: number) => Promise<string | undefined> }
      = { openSession: realOpenSession as any }) {
    this.short = opts.short;
    this.env = opts.env ?? process.env;
  }

  async start(): Promise<void> {
    // Our OWN copy of the start stamp. The engine writes one too, but unlinks it on exit — and a
    // roster row outlives that, so without this a crashed host reads live forever (see RosterRow).
    const procStart = await (this.deps.procStartOf ?? realProcStartOf)(process.pid).catch(() => undefined);
    const row: RosterRow = {
      short: this.opts.short, pid: process.pid, cwd: this.opts.cwd, kind: this.opts.kind,
      name: this.opts.name, state: "working", startedAt: Date.now(),
      ...(procStart ? { procStart } : {}),
      ...(this.opts.worktree ? { worktree: this.opts.worktree } : {}),
      ...(this.opts.noHumanSeam ? { noHumanSeam: true } : {}),
    };
    writeRoster(row, this.env);                        // written BEFORE any session id exists
    this.session = this.deps.openSession(this.opts.config);
    this.server = new HostServer({ status: () => this.status(), stop: () => this.stop("stopped") },
      hostSocketPath(process.pid, this.env));
    await this.server.listen();
  }

  async runTask(prompt: string): Promise<void> {
    this.busy = true; this.state = "working";
    try { await this.session.submit(prompt, () => {}); this.state = "done"; }
    catch (e) { this.state = "error"; throw e; }
    finally { this.busy = false; this.syncRoster(); }
  }

  status(): HostStatus { return { state: this.state, status: this.busy ? "busy" : "idle" }; }

  /** `final` lets stop() record `stopped` while a completed run records `done`/`error`. */
  async stop(final?: FleetState): Promise<void> {
    if (final) this.state = final;
    this.syncRoster();
    await this.session?.dispose?.().catch?.(() => {});
    await this.server?.close();
  }

  private syncRoster(): void {
    const sid = this.session?.sessionId;
    if (sid) {
      const r = readRoster(this.opts.short, this.env);
      if (r) writeRoster({ ...r, sessionId: sid }, this.env);
    }
    finalizeRoster(this.opts.short, this.state, this.env);
  }
}
```

> **Note for the implementer:** the `require` inside `syncRoster` is a placeholder for the ESM import already at the top of the file — replace it with a direct call to the imported `writeRoster`/`readRoster`. It is written this way only to keep the diff of Step 3 self-contained; a `require` in an ESM module will fail typecheck, which Step 4 will catch.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/unit/host-session.test.ts && npm run typecheck`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add harness/src/host/host.ts harness/test/unit/host-session.test.ts
git commit -m "feat(host): SessionHost wiring session lifecycle to roster and status"
```

---

### Task 8: CLI grammar and the banner

**Files:**
- Create: `harness/src/cli/args.ts`, `harness/src/cli/banner.ts`
- Test: `harness/test/unit/cli-args.test.ts`, `harness/test/unit/cli-banner.test.ts`

**Interfaces:**
- Consumes: `HarnessConfig` from `../config/types.js`.
- Produces: `parseCcx(argv): CcxInvocation` · `formatBanner(short): string`
- `CcxInvocation = { command: "run" | "agents" | "attach" | "stop" | "rm" | "gc"; prompt?: string; target?: string; bg: boolean; detachable: boolean; name?: string; worktree?: string; print: boolean; json: boolean; all: boolean; cwdFilter?: string; idleTimeoutMs?: number; hasExplicitPermissionConfig: boolean; config: HarnessConfig }`

- [ ] **Step 1: Write the failing tests**

```ts
// harness/test/unit/cli-banner.test.ts
import { describe, it, expect } from "vitest";
import { formatBanner } from "../../src/cli/banner.js";

describe("formatBanner", () => {
  it("emits `backgrounded · <short>` with U+00B7", () => {
    expect(formatBanner("a1b2c3d4")).toBe("backgrounded · a1b2c3d4");
  });
  it("round-trips through the exact sed doperpowers uses", () => {
    // sed -n 's/.*backgrounded · \([0-9a-f][0-9a-f]*\).*/\1/p'
    const m = formatBanner("a1b2c3d4").match(/.*backgrounded · ([0-9a-f][0-9a-f]*).*/);
    expect(m?.[1]).toBe("a1b2c3d4");
  });
  it("refuses a short id that is not exactly 8 hex — that would silently disable the purge", () => {
    expect(() => formatBanner("a1b2c3d")).toThrow(/8/);
  });
});
```

```ts
// harness/test/unit/cli-args.test.ts
import { describe, it, expect } from "vitest";
import { parseCcx } from "../../src/cli/args.js";

describe("parseCcx", () => {
  it("parses doperpowers' exact spawn line", () => {
    const a = parseCcx(["--bg", "--permission-mode", "auto", "-n", "worker-3", "--worktree", "wt", "do the thing"]);
    expect(a).toMatchObject({ command: "run", bg: true, name: "worker-3", worktree: "wt", prompt: "do the thing" });
    expect(a.config.permissionMode).toBe("auto");
  });
  it("flags explicit permission config so the default ask-policy floor stays off", () => {
    // A blanket default would park every doperpowers worker at its first tool.
    expect(parseCcx(["--bg", "--permission-mode", "auto", "-n", "w", "x"]).hasExplicitPermissionConfig).toBe(true);
    expect(parseCcx(["--bg", "-n", "w", "x"]).hasExplicitPermissionConfig).toBe(false);
    expect(parseCcx(["--bg", "--settings", "{}", "-n", "w", "x"]).hasExplicitPermissionConfig).toBe(true);
  });
  it("parses the resume fork", () => {
    const a = parseCcx(["--bg", "--resume", "uuid-1", "-n", "w", "next"]);
    expect(a.config.resume).toBe("uuid-1"); expect(a.bg).toBe(true);
  });
  it("parses subcommands with their flags", () => {
    expect(parseCcx(["agents", "--json", "--all"])).toMatchObject({ command: "agents", json: true, all: true });
    expect(parseCcx(["agents", "--cwd", "/repo"])).toMatchObject({ command: "agents", cwdFilter: "/repo" });
    expect(parseCcx(["stop", "a1b2c3d4"])).toMatchObject({ command: "stop", target: "a1b2c3d4" });
    expect(parseCcx(["rm", "a1b2c3d4"])).toMatchObject({ command: "rm", target: "a1b2c3d4" });
    expect(parseCcx(["attach", "a1b2c3d4"])).toMatchObject({ command: "attach", target: "a1b2c3d4" });
    expect(parseCcx(["fleet", "gc"])).toMatchObject({ command: "gc" });
  });
  it("parses -p and --detachable", () => {
    expect(parseCcx(["-p", "hello"])).toMatchObject({ command: "run", print: true, prompt: "hello" });
    expect(parseCcx(["--detachable"])).toMatchObject({ command: "run", detachable: true });
  });
  it("fails loudly on a recognized-but-unsupported flag", () => {
    // A silently ignored --permission-mode in a background worker is a safety bug, not a UX wart.
    expect(() => parseCcx(["--bg", "--remote-control", "x"])).toThrow(/--remote-control/);
  });
  it("fails on an unknown flag rather than treating it as the prompt", () => {
    expect(() => parseCcx(["--nope"])).toThrow(/--nope/);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run test/unit/cli-banner.test.ts test/unit/cli-args.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementations**

```ts
// harness/src/cli/banner.ts
import { isShortId } from "../fleet/paths.js";

/** MUST stay byte-exact: doperpowers parses it with
 *  `sed -n 's/.*backgrounded · \([0-9a-f][0-9a-f]*\).*/\1/p'`, and the separator is U+00B7. */
export function formatBanner(short: string): string {
  if (!isShortId(short)) throw new Error(`short id must be exactly 8 lowercase hex, got ${JSON.stringify(short)}`);
  return `backgrounded · ${short}`;
}
```

```ts
// harness/src/cli/args.ts
import type { HarnessConfig } from "../config/types.js";

export interface CcxInvocation {
  command: "run" | "agents" | "attach" | "stop" | "rm" | "gc";
  prompt?: string; target?: string;
  bg: boolean; detachable: boolean; print: boolean;
  name?: string; worktree?: string;
  json: boolean; all: boolean; cwdFilter?: string; idleTimeoutMs?: number;
  hasExplicitPermissionConfig: boolean;
  config: HarnessConfig;
}

/** Flags the real CLI has that we deliberately do not support yet. Listing them means we reject them
 *  by name instead of ignoring them — silence here is a safety bug in an unattended worker. */
const KNOWN_UNSUPPORTED = new Set(["--remote-control", "--chrome", "--ide", "--tmux", "--bare", "--gateway"]);

export function parseCcx(argv: string[]): CcxInvocation {
  const a: CcxInvocation = { command: "run", bg: false, detachable: false, print: false, json: false, all: false, hasExplicitPermissionConfig: false, config: {} };
  let i = 0;
  const sub = argv[0];
  if (sub === "agents" || sub === "attach" || sub === "stop" || sub === "rm") { a.command = sub; i = 1; }
  else if (sub === "fleet" && argv[1] === "gc") { a.command = "gc"; return a; }

  for (; i < argv.length; i++) {
    const t = argv[i];
    if (KNOWN_UNSUPPORTED.has(t)) throw new Error(`${t} is not supported by ccx (recognized, deliberately unimplemented)`);
    switch (t) {
      case "--bg": case "--background": a.bg = true; break;
      case "--detachable": a.detachable = true; break;
      case "-p": case "--print": a.print = true; break;
      case "--json": a.json = true; break;
      case "--all": a.all = true; break;
      case "-n": case "--name": a.name = argv[++i]; break;
      case "--worktree": a.worktree = argv[++i]; break;
      case "--cwd": if (a.command === "agents") a.cwdFilter = argv[++i]; else a.config.cwd = argv[++i]; break;
      case "--idle-timeout": a.idleTimeoutMs = Number(argv[++i]) * 1000; break;
      case "--model": a.config.model = argv[++i]; break;
      case "--effort": (a.config as any).effort = argv[++i]; break;
      case "-r": case "--resume": a.config.resume = argv[++i]; break;
      case "--permission-mode": a.config.permissionMode = argv[++i] as any; a.hasExplicitPermissionConfig = true; break;
      case "--settings": (a.config as any).settings = argv[++i]; a.hasExplicitPermissionConfig = true; break;
      default:
        if (t.startsWith("-")) throw new Error(`unknown flag ${t}`);
        if (a.command === "run" && a.prompt === undefined) a.prompt = t;
        else if (a.command !== "run" && a.target === undefined) a.target = t;
    }
  }
  return a;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/unit/cli-banner.test.ts test/unit/cli-args.test.ts && npm run typecheck`
Expected: PASS, 3 + 7 tests.

- [ ] **Step 5: Commit**

```bash
git add harness/src/cli/args.ts harness/src/cli/banner.ts harness/test/unit/cli-args.test.ts harness/test/unit/cli-banner.test.ts
git commit -m "feat(cli): ccx grammar and the byte-exact backgrounded banner"
```

---

### Task 9: Detached spawn — `ccx --bg`

**Files:**
- Create: `harness/src/cli/spawn.ts`, `harness/src/cli/hostMain.ts`
- Test: `harness/test/unit/cli-spawn.test.ts`

**Interfaces:**
- Consumes: `mintShortId` (Task 1), `formatBanner` (Task 8), `CcxInvocation` (Task 8), `SessionHost` (Task 7).
- Produces: `spawnDetached(inv, deps?): { short: string; banner: string }` · `runHostMain(argv): Promise<void>` (the child entry point)

- [ ] **Step 1: Write the failing test**

```ts
// harness/test/unit/cli-spawn.test.ts
import { describe, it, expect } from "vitest";
import { spawnDetached } from "../../src/cli/spawn.js";
import { parseCcx } from "../../src/cli/args.js";

function fakeSpawner() {
  const calls: any[] = [];
  return { calls, spawn: (cmd: string, args: string[], opts: any) => { calls.push({ cmd, args, opts }); return { pid: 4242, unref: () => { calls.push({ unref: true }); } }; } };
}

describe("spawnDetached", () => {
  it("returns an 8-hex short id and the exact banner", () => {
    const s = fakeSpawner();
    const r = spawnDetached(parseCcx(["--bg", "-n", "w1", "task"]), { spawn: s.spawn, rand: () => 0 });
    expect(r.short).toBe("00000000");
    expect(r.banner).toBe("backgrounded · 00000000");
  });
  it("detaches the child and unrefs it so the parent shell can exit", () => {
    const s = fakeSpawner();
    spawnDetached(parseCcx(["--bg", "-n", "w1", "task"]), { spawn: s.spawn, rand: () => 0 });
    expect(s.calls[0].opts.detached).toBe(true);
    expect(s.calls[0].opts.stdio).toEqual(["ignore", "ignore", "ignore"]);
    expect(s.calls.some((c) => c.unref)).toBe(true);
  });
  it("passes identity through env, never by writing a registry row", () => {
    const s = fakeSpawner();
    spawnDetached(parseCcx(["--bg", "-n", "worker-3", "task"]), { spawn: s.spawn, rand: () => 0 });
    expect(s.calls[0].opts.env.CLAUDE_CODE_SESSION_NAME).toBe("worker-3");
    expect(s.calls[0].opts.env.CLAUDE_CODE_SESSION_KIND).toBe("bg");
  });
  it("defaults the name to the short id when -n is absent", () => {
    const s = fakeSpawner();
    spawnDetached(parseCcx(["--bg", "task"]), { spawn: s.spawn, rand: () => 0 });
    expect(s.calls[0].opts.env.CLAUDE_CODE_SESSION_NAME).toBe("00000000");
  });
  it("forwards the short id and the task to the child entry point", () => {
    const s = fakeSpawner();
    spawnDetached(parseCcx(["--bg", "-n", "w1", "do the thing"]), { spawn: s.spawn, rand: () => 0 });
    expect(s.calls[0].args).toContain("--__host");
    expect(s.calls[0].args).toContain("00000000");
    expect(s.calls[0].args).toContain("do the thing");
  });
  it("forwards the config flags, so the child re-parses the same permission mode", () => {
    // Without this, doperpowers' `--bg --permission-mode auto` worker silently runs on the DEFAULT
    // mode and parks at its first tool. Acceptance 18 dies here.
    const s = fakeSpawner();
    spawnDetached(parseCcx(["--bg", "--permission-mode", "auto", "--model", "m1", "-n", "w1", "task"]), { spawn: s.spawn, rand: () => 0 });
    const args: string[] = s.calls[0].args;
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("auto");
    expect(args[args.indexOf("--model") + 1]).toBe("m1");
  });
  it("scrubs the parent agent's session variables from the child env", () => {
    // Probe 60: a kind=bg child that inherits CLAUDE_JOB_DIR adopts the PARENT's job. The agents view
    // then renders the parent job's id, name and state, and our session is unfindable by pid,
    // sessionId or name. daemon-spawn.sh runs inside an agent, so this is the production path.
    const s = fakeSpawner();
    Object.assign(process.env, { CLAUDE_JOB_DIR: "/x/jobs/475ad71d", CLAUDE_CODE_SESSION_ID: "sid-parent", CLAUDE_CODE_CHILD_SESSION: "1" });
    try {
      spawnDetached(parseCcx(["--bg", "-n", "w1", "task"]), { spawn: s.spawn, rand: () => 0 });
      const env = s.calls[0].opts.env;
      expect(env.CLAUDE_JOB_DIR).toBeUndefined();
      expect(env.CLAUDE_CODE_SESSION_ID).toBeUndefined();
      expect(env.CLAUDE_CODE_CHILD_SESSION).toBeUndefined();
      expect(env.CLAUDE_CODE_SESSION_NAME).toBe("w1");   // our own identity still gets through
    } finally {
      delete process.env.CLAUDE_JOB_DIR; delete process.env.CLAUDE_CODE_SESSION_ID; delete process.env.CLAUDE_CODE_CHILD_SESSION;
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/unit/cli-spawn.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// harness/src/cli/spawn.ts
import { spawn as realSpawn } from "node:child_process";
import { mintShortId } from "../fleet/paths.js";
import { formatBanner } from "./banner.js";
import type { CcxInvocation } from "./args.js";

export interface SpawnDeps { spawn: typeof realSpawn | ((c: string, a: string[], o: any) => any); rand?: () => number }

/** A Claude Code agent's OWN session variables must not reach a detached child. Probe 60: a child that
 *  declares kind=bg while inheriting CLAUDE_JOB_DIR adopts the parent's job, and the agents view then
 *  renders the parent job's id, name and state instead of ours — the session becomes unfindable by
 *  pid, sessionId or name. doperpowers' daemon-spawn.sh runs inside an agent, so this is the real path. */
const INHERITED_SESSION_VARS = ["CLAUDE_JOB_DIR", "CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_CHILD_SESSION"];

/** Reconstructed, not forwarded raw: the parent has already resolved --worktree into config.cwd, and
 *  --bg itself must not repeat or the child would fork again. */
function configFlags(inv: CcxInvocation): string[] {
  const out: string[] = [];
  const c = inv.config as Record<string, string | undefined>;
  for (const [flag, key] of [["--model", "model"], ["--effort", "effort"], ["--resume", "resume"],
    ["--permission-mode", "permissionMode"], ["--settings", "settings"]] as const) {
    if (c[key]) out.push(flag, c[key]!);
  }
  return out;
}

/** Forks a fully detached host and returns immediately. The child re-enters this binary via --__host,
 *  which keeps one code path for the session regardless of how it was started. */
export function spawnDetached(inv: CcxInvocation, deps: SpawnDeps = { spawn: realSpawn }): { short: string; banner: string } {
  const short = mintShortId(deps.rand ?? Math.random);
  const name = inv.name ?? short;
  const kind = inv.bg ? "bg" : "interactive";
  const args = [process.argv[1], "--__host", short, "--__kind", kind, ...configFlags(inv), ...(inv.prompt ? [inv.prompt] : [])];
  const env: NodeJS.ProcessEnv = { ...process.env, CLAUDE_CODE_SESSION_NAME: name, CLAUDE_CODE_SESSION_KIND: kind };
  for (const v of INHERITED_SESSION_VARS) delete env[v];
  const child = deps.spawn(process.execPath, args, {
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],   // nothing may hold the parent shell open
    cwd: inv.config.cwd ?? process.cwd(),
    env,
  });
  child.unref?.();
  return { short, banner: formatBanner(short) };
}
```

```ts
// harness/src/cli/hostMain.ts
import { SessionHost } from "../host/host.js";
import { parseCcx } from "./args.js";

/** The detached child's entry point. Never called by a user directly; `--__host` is internal. */
export async function runHostMain(argv: string[]): Promise<void> {
  const short = argv[argv.indexOf("--__host") + 1];
  const kind = (argv[argv.indexOf("--__kind") + 1] ?? "bg") as "bg" | "interactive";
  const inv = parseCcx(argv.filter((a, i) => !["--__host", "--__kind"].includes(a) && !["--__host", "--__kind"].includes(argv[i - 1])));
  // The child re-parses the forwarded config flags, so hasExplicitPermissionConfig is recomputed here
  // rather than smuggled across in yet another flag. A bare --bg has nothing that can route to `ask`.
  const noHumanSeam = kind === "bg" && !inv.hasExplicitPermissionConfig;
  const host = new SessionHost({
    short, name: process.env.CLAUDE_CODE_SESSION_NAME ?? short, cwd: process.cwd(), kind,
    ...(inv.worktree ? { worktree: inv.worktree } : {}), ...(noHumanSeam ? { noHumanSeam } : {}),
    config: inv.config,
  });
  await host.start();
  try { if (inv.prompt) await host.runTask(inv.prompt); }
  finally { await host.stop(); }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/unit/cli-spawn.test.ts && npm run typecheck`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add harness/src/cli/spawn.ts harness/src/cli/hostMain.ts harness/test/unit/cli-spawn.test.ts
git commit -m "feat(cli): detached --bg spawn with env-carried identity"
```

---

### Task 10: `ccx agents` — the fleet view

**Files:**
- Create: `harness/src/fleet/index.ts`, `harness/src/cli/agents.ts`
- Test: `harness/test/unit/cli-agents.test.ts`

**Interfaces:**
- Consumes: `listRoster` (Task 3), `readRegistry` (Task 4), `projectRow` (Task 5), `isPidLive`/`socketAnswers` (Task 2), `hostSocketPath` (Task 1).
- Produces: `collectFleet(env?, deps?): Promise<AgentsRow[]>` · `renderAgents(rows, opts): string`

- [ ] **Step 1: Write the failing test**

```ts
// harness/test/unit/cli-agents.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectFleet } from "../../src/fleet/index.js";
import { writeRoster } from "../../src/fleet/roster.js";
import type { RosterRow } from "../../src/fleet/roster.js";

let env: NodeJS.ProcessEnv;
beforeEach(() => { env = { CCX_FLEET_ROOT: mkdtempSync(join(tmpdir(), "ccx-fleet-")), HOME: "/nope" }; });
const row = (o: Partial<RosterRow> = {}): RosterRow => ({ short: "a1b2c3d4", pid: 100, cwd: "/w", kind: "bg", name: "w1", state: "working", startedAt: 1, ...o });

const deps = (over: any = {}) => ({
  readRegistry: () => [], isPidLive: async () => false, socketAnswers: async () => false,
  askStatus: async () => undefined, ...over,
});

describe("collectFleet", () => {
  it("lists a FINISHED session — the whole reason the roster exists", async () => {
    writeRoster(row({ state: "done", sessionId: "sid-1", endedAt: 5 }), env);
    const rows = await collectFleet(env, deps());
    expect(rows).toEqual([expect.objectContaining({ id: "a1b2c3d4", sessionId: "sid-1", state: "done", status: "idle" })]);
  });
  it("asks the live host for status when its socket answers", async () => {
    writeRoster(row({ sessionId: "sid-1" }), env);
    const rows = await collectFleet(env, deps({
      isPidLive: async () => true, socketAnswers: async () => true,
      askStatus: async () => ({ state: "blocked", status: "idle" }),
    }));
    expect(rows[0]).toMatchObject({ state: "blocked", status: "idle" });
  });
  it("projects error for a dead pid with a non-terminal roster row", async () => {
    writeRoster(row({ state: "working", sessionId: "sid-1" }), env);
    expect((await collectFleet(env, deps()))[0].state).toBe("error");
  });
  it("falls back to the roster's own procStart once the engine has unlinked its row", async () => {
    // The engine unlinks ~/.claude/sessions/<pid>.json on exit, but our roster row outlives it. With
    // no stamp at all, isPidLive(pid, undefined) answers "live" and the poller waits on a corpse.
    writeRoster(row({ state: "working", sessionId: "sid-1", procStart: "Sat Jul 25 02:55:52 2026" }), env);
    const seen: (string | undefined)[] = [];
    const rows = await collectFleet(env, deps({ isPidLive: async (_p: number, ps?: string) => { seen.push(ps); return false; } }));
    expect(seen[0]).toBe("Sat Jul 25 02:55:52 2026");
    expect(rows[0].state).toBe("error");
  });
  it("prefers a live registry sessionId over the roster's", async () => {
    writeRoster(row({ sessionId: undefined }), env);
    const rows = await collectFleet(env, deps({
      readRegistry: () => [{ pid: 100, cwd: "/w", sessionId: "sid-live" }],
      isPidLive: async () => true, socketAnswers: async () => true, askStatus: async () => ({ state: "working", status: "busy" }),
    }));
    expect(rows[0].sessionId).toBe("sid-live");
  });
  it("never unlinks anything — agents is read-only", async () => {
    writeRoster(row({ state: "working" }), env);
    await collectFleet(env, deps());
    const { existsSync } = await import("node:fs");
    expect(existsSync(join(env.CCX_FLEET_ROOT!, "roster", "a1b2c3d4.json"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/unit/cli-agents.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// harness/src/fleet/index.ts
import { listRoster } from "./roster.js";
import { readRegistry as realReadRegistry } from "./registry.js";
import { isPidLive as realIsPidLive, socketAnswers as realSocketAnswers } from "./liveness.js";
import { hostSocketPath } from "./paths.js";
import { projectRow } from "./project.js";
import type { AgentsRow } from "./project.js";
import type { HostStatus } from "../host/ops.js";
import { connect } from "node:net";

export * from "./paths.js"; export * from "./roster.js"; export * from "./registry.js";
export * from "./liveness.js"; export * from "./project.js";

async function realAskStatus(path: string): Promise<HostStatus | undefined> {
  return await new Promise((resolve) => {
    const s = connect({ path }, () => s.write(JSON.stringify({ op: "status" }) + "\n"));
    let buf = ""; const done = (v?: HostStatus) => { s.destroy(); resolve(v); };
    s.on("data", (d) => { buf += d; const i = buf.indexOf("\n"); if (i >= 0) { try { const j = JSON.parse(buf.slice(0, i)); done(j?.ok ? j : undefined); } catch { done(undefined); } } });
    s.on("error", () => done(undefined));
    s.setTimeout(250, () => done(undefined));
  });
}

export interface FleetDeps {
  readRegistry: typeof realReadRegistry;
  isPidLive: (pid: number, procStart?: string) => Promise<boolean>;
  socketAnswers: (p: string) => Promise<boolean>;
  askStatus: (p: string) => Promise<HostStatus | undefined>;
}

/** Read-only. Rows are projected at read time; nothing here writes or unlinks — `ccx fleet gc` owns that. */
export async function collectFleet(env: NodeJS.ProcessEnv = process.env,
  deps: FleetDeps = { readRegistry: realReadRegistry, isPidLive: realIsPidLive, socketAnswers: realSocketAnswers, askStatus: realAskStatus }): Promise<AgentsRow[]> {
  const registry = deps.readRegistry(env);
  return await Promise.all(listRoster(env).map(async (roster) => {
    const reg = registry.find((r) => r.pid === roster.pid);
    const sock = hostSocketPath(roster.pid, env);
    // Prefer the engine's stamp, fall back to ours. Ours is the one that survives the engine
    // unlinking its row on exit — without it, a crashed host reads live forever.
    const pidLive = await deps.isPidLive(roster.pid, reg?.procStart ?? roster.procStart);
    const answers = pidLive ? await deps.socketAnswers(sock) : false;
    const liveStatus = answers ? await deps.askStatus(sock) : undefined;
    return projectRow({ roster, ...(reg ? { registry: reg } : {}), pidLive, socketAnswers: answers, ...(liveStatus ? { liveStatus } : {}) });
  }));
}
```

```ts
// harness/src/cli/agents.ts
import type { AgentsRow } from "../fleet/project.js";

export function renderAgents(rows: AgentsRow[], opts: { json: boolean; all: boolean; cwdFilter?: string }): string {
  let out = rows;
  if (opts.cwdFilter) out = out.filter((r) => r.cwd === opts.cwdFilter || r.cwd.startsWith(opts.cwdFilter + "/"));
  if (!opts.all) out = out.filter((r) => r.state === "working" || r.state === "blocked");
  if (opts.json) return JSON.stringify(out, null, 2);   // extra keys are inert for the poller's .get() reads
  return out.map((r) => `${r.id}  ${r.state.padEnd(8)} ${r.status.padEnd(5)} ${r.name}  ${r.cwd}`
    + `${r.unresponsive ? "  (unresponsive)" : ""}${r.noHumanSeam ? "  ⚠ no human seam" : ""}`).join("\n");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/unit/cli-agents.test.ts && npm run typecheck`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add harness/src/fleet/index.ts harness/src/cli/agents.ts harness/test/unit/cli-agents.test.ts
git commit -m "feat(cli): ccx agents — read-only fleet view over roster + registry"
```

---

### Task 11: `stop`, `rm`, `fleet gc`, and identifier resolution

**Files:**
- Create: `harness/src/cli/lifecycle.ts`
- Test: `harness/test/unit/cli-lifecycle.test.ts`

**Interfaces:**
- Consumes: roster fns (Task 3), `hostSocketPath` (Task 1), `socketAnswers` (Task 2).
- Produces: `resolveTarget(target, env?): RosterRow` · `stopSession(target, env?, deps?): Promise<void>` · `rmSession(target, env?, deps?): Promise<void>` · `fleetGc(env?, deps?): Promise<string[]>`

- [ ] **Step 1: Write the failing test**

```ts
// harness/test/unit/cli-lifecycle.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveTarget, stopSession, rmSession } from "../../src/cli/lifecycle.js";
import { writeRoster, readRoster } from "../../src/fleet/roster.js";
import type { RosterRow } from "../../src/fleet/roster.js";

let env: NodeJS.ProcessEnv;
beforeEach(() => { env = { CCX_FLEET_ROOT: mkdtempSync(join(tmpdir(), "ccx-life-")) }; });
const row = (o: Partial<RosterRow> = {}): RosterRow => ({ short: "a1b2c3d4", sessionId: "sid-1", pid: 100, cwd: "/w", kind: "bg", name: "w1", state: "working", startedAt: 1, ...o });

describe("resolveTarget", () => {
  it("resolves by short id", () => { writeRoster(row(), env); expect(resolveTarget("a1b2c3d4", env).short).toBe("a1b2c3d4"); });
  it("resolves by full session id", () => { writeRoster(row(), env); expect(resolveTarget("sid-1", env).short).toBe("a1b2c3d4"); });
  it("resolves by name", () => { writeRoster(row(), env); expect(resolveTarget("w1", env).short).toBe("a1b2c3d4"); });
  it("throws listing matches when a name is ambiguous — never picks one silently", () => {
    writeRoster(row(), env); writeRoster(row({ short: "b2c3d4e5", pid: 101, sessionId: "sid-2" }), env);
    expect(() => resolveTarget("w1", env)).toThrow(/a1b2c3d4[\s\S]*b2c3d4e5|b2c3d4e5[\s\S]*a1b2c3d4/);
  });
  it("throws a clear error for an unknown target", () => { expect(() => resolveTarget("zzzzzzzz", env)).toThrow(/zzzzzzzz/); });
});

describe("stopSession", () => {
  it("records `stopped`, which daemon-finalize.sh routes down its error arm", async () => {
    writeRoster(row(), env);
    await stopSession("a1b2c3d4", env, { sendStop: async () => true });
    expect(readRoster("a1b2c3d4", env)!.state).toBe("stopped");
  });
  it("is idempotent on an already-dead session", async () => {
    writeRoster(row({ state: "done" }), env);
    await expect(stopSession("a1b2c3d4", env, { sendStop: async () => false })).resolves.toBeUndefined();
  });
});

describe("rmSession", () => {
  it("deletes the roster row for an already-exited session", async () => {
    writeRoster(row({ state: "done" }), env);
    await rmSession("a1b2c3d4", env, { sendStop: async () => false, worktreeClean: async () => true, removeWorktree: async () => {} });
    expect(existsSync(join(env.CCX_FLEET_ROOT!, "roster", "a1b2c3d4.json"))).toBe(false);
  });
  it("removes a CLEAN worktree", async () => {
    writeRoster(row({ state: "done", worktree: "/repo/.claude/worktrees/wt" }), env);
    let removed = false;
    await rmSession("a1b2c3d4", env, { sendStop: async () => false, worktreeClean: async () => true, removeWorktree: async () => { removed = true; } });
    expect(removed).toBe(true);
  });
  it("refuses a DIRTY worktree, reporting why, and keeps the roster row", async () => {
    writeRoster(row({ state: "done", worktree: "/repo/.claude/worktrees/wt" }), env);
    await expect(rmSession("a1b2c3d4", env, { sendStop: async () => false, worktreeClean: async () => false, removeWorktree: async () => {} }))
      .rejects.toThrow(/dirty/i);
    expect(readRoster("a1b2c3d4", env)).toBeDefined();
  });
  it("is idempotent — a second rm does not throw", async () => {
    writeRoster(row({ state: "done" }), env);
    const d = { sendStop: async () => false, worktreeClean: async () => true, removeWorktree: async () => {} };
    await rmSession("a1b2c3d4", env, d);
    await expect(rmSession("a1b2c3d4", env, d)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/unit/cli-lifecycle.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// harness/src/cli/lifecycle.ts
import { connect } from "node:net";
import { rmSync, existsSync, readdirSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { fleetRoot, hostSocketPath, rosterPath } from "../fleet/paths.js";
import { finalizeRoster, listRoster, readRoster } from "../fleet/roster.js";
import type { RosterRow } from "../fleet/roster.js";
import { socketAnswers } from "../fleet/liveness.js";
const execFileP = promisify(execFile);

/** short id | full session id | name. Ambiguity is an error listing matches — doperpowers addresses
 *  daemons by short and uuid, and a wrong guess would act on someone else's worker. */
export function resolveTarget(target: string, env: NodeJS.ProcessEnv = process.env): RosterRow {
  const all = listRoster(env);
  const hits = all.filter((r) => r.short === target || r.sessionId === target || r.name === target);
  if (hits.length === 1) return hits[0];
  if (hits.length === 0) throw new Error(`no session matches ${JSON.stringify(target)}`);
  throw new Error(`ambiguous target ${JSON.stringify(target)} — matches: ${hits.map((h) => `${h.short} (${h.name})`).join(", ")}`);
}

async function realSendStop(path: string): Promise<boolean> {
  if (!(await socketAnswers(path))) return false;
  return await new Promise((resolve) => {
    const s = connect({ path }, () => s.write(JSON.stringify({ op: "stop" }) + "\n"));
    const done = (v: boolean) => { s.destroy(); resolve(v); };
    s.on("data", () => done(true)); s.on("error", () => done(false)); s.setTimeout(1000, () => done(false));
  });
}

export interface LifecycleDeps {
  sendStop: (socketPath: string) => Promise<boolean>;
  worktreeClean?: (wt: string) => Promise<boolean>;
  removeWorktree?: (wt: string) => Promise<void>;
}
const defaults: Required<LifecycleDeps> = {
  sendStop: realSendStop,
  worktreeClean: async (wt) => {
    try { const { stdout } = await execFileP("git", ["-C", wt, "status", "--porcelain"], { timeout: 5000 }); return stdout.trim() === ""; }
    catch { return false; }
  },
  removeWorktree: async (wt) => { await execFileP("git", ["-C", wt, "worktree", "remove", "--force", wt], { timeout: 15000 }).catch(() => { rmSync(wt, { recursive: true, force: true }); }); },
};

/** Ends the turn; the session stays resumable by uuid; idempotent on an already-dead session. */
export async function stopSession(target: string, env: NodeJS.ProcessEnv = process.env, deps: LifecycleDeps = defaults): Promise<void> {
  const row = resolveTarget(target, env);
  await deps.sendStop(hostSocketPath(row.pid, env));
  finalizeRoster(row.short, "stopped", env);
}

/** Deletes the session and its worktree WHEN CLEAN; works on already-exited sessions; idempotent. */
export async function rmSession(target: string, env: NodeJS.ProcessEnv = process.env, deps: LifecycleDeps = defaults): Promise<void> {
  let row: RosterRow;
  try { row = resolveTarget(target, env); } catch { return; }   // already gone ⇒ nothing to do
  await deps.sendStop(hostSocketPath(row.pid, env));
  if (row.worktree) {
    const clean = await (deps.worktreeClean ?? defaults.worktreeClean)(row.worktree);
    if (!clean) throw new Error(`refusing to remove ${row.short}: worktree ${row.worktree} is dirty — commit or discard first`);
    await (deps.removeWorktree ?? defaults.removeWorktree)(row.worktree);
  }
  rmSync(rosterPath(row.short, env), { force: true });
}

/** The only deleter of stale state — `agents` must stay read-only because unlinking races a restart. */
export async function fleetGc(env: NodeJS.ProcessEnv = process.env): Promise<string[]> {
  const removed: string[] = [];
  const run = join(fleetRoot(env), "run");
  let files: string[] = [];
  try { files = readdirSync(run); } catch { return removed; }
  for (const f of files) {
    const p = join(run, f);
    if (existsSync(p) && !(await socketAnswers(p))) { rmSync(p, { force: true }); removed.push(p); }
  }
  return removed;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/unit/cli-lifecycle.test.ts && npm run typecheck`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add harness/src/cli/lifecycle.ts harness/test/unit/cli-lifecycle.test.ts
git commit -m "feat(cli): stop, rm with clean-worktree guard, gc, and target resolution"
```

---

### Task 12: Worktree creation and the `ccx` entry point

**Files:**
- Create: `harness/src/cli/worktree.ts`, `harness/src/cli/main.ts`
- Modify: `harness/package.json` (add the `ccx` bin)
- Test: `harness/test/unit/cli-worktree.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `worktreePaths(repo, name)` → `{ path, branch }` · `ensureWorktree(repo, name, deps?): Promise<string>` · `main(argv): Promise<number>`

- [ ] **Step 1: Write the failing test**

```ts
// harness/test/unit/cli-worktree.test.ts
import { describe, it, expect } from "vitest";
import { worktreePaths, ensureWorktree } from "../../src/cli/worktree.js";

describe("worktreePaths", () => {
  it("uses the layout daemon-spawn.sh assumes — fixed, not configurable", () => {
    expect(worktreePaths("/repo", "wt")).toEqual({ path: "/repo/.claude/worktrees/wt", branch: "worktree-wt" });
  });
});

describe("ensureWorktree", () => {
  it("creates the worktree on branch worktree-<name> when absent", async () => {
    const calls: string[][] = [];
    const p = await ensureWorktree("/repo", "wt", { exists: () => false, git: async (a) => { calls.push(a); return ""; } });
    expect(p).toBe("/repo/.claude/worktrees/wt");
    expect(calls[0]).toEqual(["-C", "/repo", "worktree", "add", "-b", "worktree-wt", "/repo/.claude/worktrees/wt"]);
  });
  it("REUSES an existing worktree instead of failing", async () => {
    const calls: string[][] = [];
    const p = await ensureWorktree("/repo", "wt", { exists: () => true, git: async (a) => { calls.push(a); return ""; } });
    expect(p).toBe("/repo/.claude/worktrees/wt");
    expect(calls).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/unit/cli-worktree.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementations**

```ts
// harness/src/cli/worktree.ts
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
const execFileP = promisify(execFile);

/** Fixed layout, not configurable: daemon-spawn.sh already assumes exactly these paths. */
export function worktreePaths(repo: string, name: string): { path: string; branch: string } {
  return { path: join(repo, ".claude", "worktrees", name), branch: `worktree-${name}` };
}

export interface WorktreeDeps { exists: (p: string) => boolean; git: (args: string[]) => Promise<string> }
const defaults: WorktreeDeps = {
  exists: existsSync,
  git: async (args) => (await execFileP("git", args, { timeout: 30000 })).stdout,
};

export async function ensureWorktree(repo: string, name: string, deps: WorktreeDeps = defaults): Promise<string> {
  const { path, branch } = worktreePaths(repo, name);
  if (deps.exists(path)) return path;                 // reuse; re-adding would fail
  await deps.git(["-C", repo, "worktree", "add", "-b", branch, path]);
  return path;
}
```

```ts
// harness/src/cli/main.ts
import { parseCcx } from "./args.js";
import { spawnDetached } from "./spawn.js";
import { runHostMain } from "./hostMain.js";
import { collectFleet } from "../fleet/index.js";
import { renderAgents } from "./agents.js";
import { stopSession, rmSession, fleetGc } from "./lifecycle.js";
import { ensureWorktree } from "./worktree.js";

export async function main(argv: string[]): Promise<number> {
  if (argv.includes("--__host")) { await runHostMain(argv); return 0; }
  let inv;
  try { inv = parseCcx(argv); } catch (e: any) { console.error(e.message); return 2; }

  switch (inv.command) {
    case "agents":
      console.log(renderAgents(await collectFleet(), { json: inv.json, all: inv.all, ...(inv.cwdFilter ? { cwdFilter: inv.cwdFilter } : {}) }));
      return 0;
    case "stop": try { await stopSession(inv.target!); return 0; } catch (e: any) { console.error(e.message); return 1; }
    case "rm": try { await rmSession(inv.target!); return 0; } catch (e: any) { console.error(e.message); return 1; }
    case "gc": for (const p of await fleetGc()) console.log(`removed ${p}`); return 0;
    case "attach": console.error("attach ships in plan A2"); return 2;
    case "run": {
      if (inv.worktree) inv.config.cwd = await ensureWorktree(inv.config.cwd ?? process.cwd(), inv.worktree);
      if (inv.bg || inv.detachable) { console.log(spawnDetached(inv).banner); return 0; }
      console.error("foreground run ships in plan A2 (it needs the client)"); return 2;
    }
  }
}
```

- [ ] **Step 4: Add the bin and run the tests**

Add to `harness/package.json` `"bin"`: `"ccx": "./dist/cli/bin.js"`, and create `harness/src/cli/bin.ts`:

```ts
#!/usr/bin/env node
import { main } from "./main.js";
main(process.argv.slice(2)).then((c) => process.exit(c)).catch((e) => { console.error(e); process.exit(1); });
```

Run: `npx vitest run test/unit/cli-worktree.test.ts && npm run typecheck && npm run build`
Expected: PASS, 3 tests; typecheck and build clean.

- [ ] **Step 5: Commit**

```bash
git add harness/src/cli/worktree.ts harness/src/cli/main.ts harness/src/cli/bin.ts harness/package.json harness/test/unit/cli-worktree.test.ts
git commit -m "feat(cli): worktree layout and the ccx entry point"
```

---

### Task 13: Contract test — run doperpowers' real poller against our JSON

The consumer verifies the shape, not our reading of it.

**Files:**
- Create: `harness/test/unit/fixtures/agents-rows.ts`, `harness/test/contract/poll-until-done.test.ts`
- Modify: `harness/package.json` (add `"test:contract": "vitest run test/contract"`)

**Interfaces:**
- Consumes: `renderAgents` (Task 10), `AgentsRow` (Task 5).
- Produces: nothing consumed downstream.

- [ ] **Step 1: Write the failing test**

```ts
// harness/test/contract/poll-until-done.test.ts
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { renderAgents } from "../../src/cli/agents.js";
import type { AgentsRow } from "../../src/fleet/project.js";

/** The exact python filter from doperpowers _lib.sh:_poll_until_done. If our JSON does not satisfy
 *  THIS, spawn/resume hang until the watcher times out — verified against the consumer, not our reading. */
const FILTER = `
import json, os, sys
s = os.environ["DAEMON_SHORT"]
try: d = json.load(sys.stdin)
except Exception: d = []
for a in d:
    if a.get("id") == s and a.get("sessionId"):
        st = a.get("state", "")
        if st == "working" and a.get("status") == "idle": st = "done"
        print(a.get("sessionId"), st, a.get("cwd", "")); break
`;

/** execFileSync, not execFile: only the *Sync/spawn family accepts `input`. `execFile` would leave the
 *  child's stdin open and unwritten, and the filter's `json.load(sys.stdin)` would block forever. */
function poll(rows: AgentsRow[], short: string): string {
  const json = renderAgents(rows, { json: true, all: true });
  return execFileSync("python3", ["-c", FILTER], {
    env: { ...process.env, DAEMON_SHORT: short }, input: json, encoding: "utf8", timeout: 10_000,
  }).trim();
}

const row = (o: Partial<AgentsRow> = {}): AgentsRow => ({ id: "a1b2c3d4", sessionId: "sid-1", state: "working", status: "busy", cwd: "/w", name: "w1", ...o });

describe("doperpowers _poll_until_done contract", () => {
  it("extracts uuid, state and cwd from a working row", async () => {
    expect(await poll([row()], "a1b2c3d4")).toBe("sid-1 working /w");
  });
  it("terminates on a done row — the acceptance-3 case that rev 1 would have broken", async () => {
    expect(await poll([row({ state: "done", status: "idle" })], "a1b2c3d4")).toBe("sid-1 done /w");
  });
  it("coerces working+idle to done, exactly as the script does", async () => {
    expect(await poll([row({ state: "working", status: "idle" })], "a1b2c3d4")).toBe("sid-1 done /w");
  });
  it("terminates on blocked and on error", async () => {
    expect((await poll([row({ state: "blocked", status: "idle" })], "a1b2c3d4")).split(" ")[1]).toBe("blocked");
    expect((await poll([row({ state: "error", status: "idle" })], "a1b2c3d4")).split(" ")[1]).toBe("error");
  });
  it("yields nothing while sessionId is empty — the startup window keeps the poller waiting", async () => {
    expect(await poll([row({ sessionId: "" })], "a1b2c3d4")).toBe("");
  });
  it("reports a worktree cwd verbatim, since the script uses it to locate the worktree", async () => {
    expect(await poll([row({ state: "done", status: "idle", cwd: "/repo/.claude/worktrees/wt" })], "a1b2c3d4"))
      .toBe("sid-1 done /repo/.claude/worktrees/wt");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/contract/poll-until-done.test.ts`
Expected: FAIL — `renderAgents` not yet exercised this way, or a shape mismatch.

- [ ] **Step 3: Fix whatever the contract rejects**

No new module. If a test fails, the defect is in `renderAgents` or `projectRow` — fix it there, not in the test. The script is the authority.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/contract && npm run typecheck`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add harness/test/contract harness/package.json
git commit -m "test(contract): verify agents JSON against doperpowers' real poller filter"
```

---

### Task 14: Final verification — the spec's acceptance, executed

**Files:**
- Create: `harness/test/live/ccx-fleet.e2e.test.ts`
- Modify: `CC-to-SDK/docs/parity/coverage.md` (fleet row), the spec's `## Outcomes & Retrospective`

- [ ] **Step 1: Run the whole unit and contract suite**

Run: `npm run test:unit && npx vitest run test/contract && npm run typecheck && npm run build`
Expected: all green.

- [ ] **Step 2: Execute acceptance 1, 2, 3, 9b, 12, 13, 17 by hand and record the output**

```bash
cd CC-to-SDK/harness && npm run build
export PATH="$PWD/dist/cli:$PATH"   # PATH shadowing is the integration mechanism

# 1 — banner, immediate return, survives the parent shell
bash -c 'node dist/cli/bin.js --bg -n w1 "Reply OK." </dev/null 2>&1 | tee /tmp/ccx-banner.txt'
grep -qE 'backgrounded · [0-9a-f]{8}' /tmp/ccx-banner.txt && echo "ACCEPT-1 banner OK"
SHORT=$(sed -n 's/.*backgrounded · \([0-9a-f][0-9a-f]*\).*/\1/p' /tmp/ccx-banner.txt)
test ${#SHORT} -eq 8 && echo "ACCEPT-17 exactly 8 hex OK"

# 2 + 3 — row keys while running, and STILL listed after it finishes
node dist/cli/bin.js agents --json --all | tee /tmp/ccx-agents.json
S=$SHORT node -e 'const r=require("/tmp/ccx-agents.json").find(x=>x.id===process.env.S);if(!r)throw new Error("row missing");for(const k of ["id","sessionId","state","status","cwd"])if(!(k in r))throw new Error("missing key "+k);console.log("ACCEPT-2 keys OK",r.state)'
sleep 20
node dist/cli/bin.js agents --json --all | S=$SHORT node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s).find(x=>x.id===process.env.S);if(!r)throw new Error("ACCEPT-3 FAILED: finished session vanished");console.log("ACCEPT-3 finished session still listed:",r.state)})'

# 12 — rm works on an already-exited session
node dist/cli/bin.js rm $SHORT && echo "ACCEPT-12 rm on exited session OK"
```

- [ ] **Step 3: Execute acceptance 4 (the real `claude agents` sees us) and 9b (crash projection)**

```bash
# 4 — while a --bg session runs, the REAL claude binary lists it with our name and kind.
# Probe 60 pinned both ends of this assertion: the registry row on disk reads kind:"bg", but the
# agents VIEW renders that same row as kind:"background". Asserting "bg" here misreads as a drop.
node dist/cli/bin.js --bg -n ccx-accept4 "Sleep by counting slowly to 40, one number per line."
sleep 5
claude agents --json --all | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s).find(x=>x.name==="ccx-accept4");if(!r)return console.log("ACCEPT-4 NOT LISTED");console.log("ACCEPT-4 real claude agents lists us:",JSON.stringify(r));console.log("ACCEPT-4 kind:",r.kind,r.kind==="background"?"OK":"UNEXPECTED")})'

# If ACCEPT-4 says NOT LISTED, check the CLAUDE_JOB_DIR scrub from Task 9 FIRST — an inherited
# CLAUDE_JOB_DIR makes a kind=bg child adopt the parent's job and vanish from the view (probe 60).
grep -q '"jobId"' ~/.claude/sessions/*.json 2>/dev/null && echo "  ^ a session row carries jobId — the scrub is not working"

# 9b — SIGKILL the host, then confirm the projection is `error`, not `working`
PID=$(node -e 'const {readdirSync,readFileSync}=require("node:fs");const d=(process.env.CCX_FLEET_ROOT||process.env.HOME+"/.claude/ccx")+"/roster";const r=readdirSync(d).map(f=>JSON.parse(readFileSync(d+"/"+f,"utf8"))).find(x=>x.name==="ccx-accept4");console.log(r.pid)')
kill -9 $PID
node dist/cli/bin.js agents --json --all | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s).find(x=>x.name==="ccx-accept4");console.log("ACCEPT-9b state after SIGKILL:",r.state, r.state==="error"?"OK":"FAILED")})'
```

- [ ] **Step 4: Execute acceptance 18 — the doperpowers scripts, unmodified**

```bash
export PATH="/Users/new/Developer/GitHub/codex_somersault/CC-to-SDK/harness/dist/cli:$PATH"
cd /Users/new/developer/github/doperpowers/skills/orchestrating-daemons
./scripts/daemon-spawn.sh "ccx-accept" "Reply with exactly DONE and stop." /tmp/ccx-accept-repo
./scripts/daemon-list.sh
```
Expected: `daemon-spawn.sh` prints `daemon spawned: ccx-accept [<short> / <uuid>] state=done`, and `daemon-list.sh` shows the row. Any hang means the poller contract is unmet — fix `projectRow`/`renderAgents`, not the script.

- [ ] **Step 5: Record outcomes and commit**

Fill the spec's `## Outcomes & Retrospective` with what shipped, which acceptance items passed with their observed output, and anything the acceptance run surprised you with (append those to `## Surprises & Discoveries`). Update `docs/parity/coverage.md`'s fleet/daemon row. Then:

```bash
git add -A CC-to-SDK/harness CC-to-SDK/docs
git commit -m "feat(a1): fleet substrate complete — doperpowers scripts run on ccx"
```

---

## Amendments during execution

Recorded here rather than by rewriting the tasks above, so a reader can see what changed and why.

- **2026-07-26, pre-flight (controller).** Five defects found scanning the plan before Task 1:
  1. `noHumanSeam` was rendered by Task 10 but had no producer anywhere. `RosterRow` now carries it, `SessionHost` writes it at start, `projectRow` passes it through, and `runHostMain` derives it as `kind === "bg" && !hasExplicitPermissionConfig`. Without this, acceptance 9's *reporting* half was unimplementable.
  2. `spawnDetached` dropped every config flag, so doperpowers' `--bg --permission-mode auto` worker would have run on the default mode and parked at its first tool — acceptance 18 would have failed with no obvious cause. It now reconstructs the flags into the child argv.
  3. `HostServer.close()` deadlocked the `stop` op: node's `server.close()` waits for open connections, and the handler was invoked from a connection awaiting its own ack. `close()` now destroys tracked sockets; the ack is best-effort by design.
  4. Task 3's test used `require("node:fs")` inside an ESM test file.
  5. Task 13 used `execFile` with an `input` option that only the `*Sync`/spawn family accepts; the python filter would have blocked on stdin until the timeout.
- **2026-07-26, from Task 0's spike.** `spawnDetached` must scrub `CLAUDE_JOB_DIR`, `CLAUDE_CODE_SESSION_ID` and `CLAUDE_CODE_CHILD_SESSION`. Probe 60 found that a `kind=bg` child inheriting `CLAUDE_JOB_DIR` adopts the parent's *job*: the agents view then renders the parent job's id, name and state, and our session is unfindable by pid, session id or name. `daemon-spawn.sh` runs inside a Claude Code agent, so this is the production path. Task 9 gained a test; Task 14's acceptance 4 gained a diagnostic pointing here first.
- **2026-07-26, from Task 0's spike.** Acceptance 4 asserts `kind: "background"` in the agents view against `"bg"` on the registry row.
- **2026-07-26, from the Task 6 review.** Rewriting the daemon's one-shot connection into a persistent NDJSON one silently dropped the dispatch-level `try/catch` that `src/daemon/server.ts` has. Since the `data` listener is `async` and nothing owned its rejection, any handler throw became an unhandled rejection — which Node terminates the process for. In a *detached background host* that means the host dies silently, and a dead host is precisely the condition this listener exists to report on. Task 7's handlers close a server and dispose a session, so the reachable moment was the very next task. Fixed, along with four smaller hardening items the same review found: `close()` re-entrancy now returns the real completion rather than resolving early, a permanent `error` listener survives `listen()` (an accept-time `EMFILE` would otherwise be a fatal unhandled `'error'` event), the line buffer is capped, and the NDJSON framing itself — two ops in one packet, one op split across two — finally has tests, which is the entire reason for hand-rolling framing.
  *Left for A2:* dispatch is serialized by an inline `await` inside the line loop, so the long-lived `follow` stream the class comment promises would wedge every subsequent line on that connection. Replies also carry no correlation id. Both must be resolved before `follow` ships, not after.
- **2026-07-26, from the Task 4 review — a premise flipped by probe 61.** `sessionsDir` hard-coded `<HOME>/.claude/sessions`, but this repo's own tenant isolation spawns sessions with `CLAUDE_CONFIG_DIR` set. Nobody had checked where the engine then writes the row. Probe 61 settled it: **the engine honors `CLAUDE_CONFIG_DIR`**, and the row lands *only* under it — so every tenant-isolated session was invisible to us, and invisibly so, because a missing directory returns an empty list that reads exactly like "no sessions running." `sessionsDir` now derives from `CLAUDE_CONFIG_DIR` first. The registry row guard was also tightened to an integer pid > 0 with a string `cwd`, since the old `typeof pid === "number"` check was weaker than the type it returned at what is explicitly an untrusted-input boundary.
- **2026-07-26, from the Task 5 review (three defects, all plan-mandated).** The projection's two central guarantees had no test that could fail: moving the terminal guard below the live arms kept all 8 tests green, and deleting the answering-socket-without-live-status branch also kept them green while every healthy host started reading as hung. Both now have a test that notices. Third and more than coverage: `sessionId` was resolved before arm dispatch, so a *terminal* row would take a registry row's session id — and since registry rows are keyed by pid and unlinked on exit, one matching a finished session's pid belongs to a different process. A finished session now takes its identity only from its own roster row.
- **2026-07-26, from the Task 2 and Task 3 reviews (three defects, all plan-mandated).**
  1. *`procStartOf` conflated "pid gone" with "the probe broke."* `ps -p <gone pid>` exiting non-zero is the answer; a `ps` missing from `PATH` or killed by the timeout is not. It now rethrows the latter and `isPidLive` fails safe to *live* — answering "dead" there would project `error` over a healthy worker and terminate a doperpowers poller early.
  2. *The roster had no `procStart` of its own, which made the crashed-host arm unreachable in its most common form.* The engine unlinks `~/.claude/sessions/<pid>.json` on exit, but our roster row outlives it — so `isPidLive(pid, undefined)` answered "live" for every dead-but-unfinalized session, and a crashed host would read `working`/unresponsive forever instead of `error`. `RosterRow` now carries `procStart`, `SessionHost` records it at start, and `collectFleet` prefers the engine's stamp and falls back to ours. This was found by following the review's finding rather than in the review itself.
  3. *`finalizeRoster` was documented idempotent but was not, and `writeRoster` was not atomic.* First-terminal-wins now guards the former (a `stop` losing the race must not overwrite a truthful `done`), and write-then-rename guards the latter (a host killed mid-write left a permanently unparseable row, which `finalizeRoster` then refused to touch — stranding the session and hanging the poller forever). `readRoster` also rejects well-formed JSON that is not a row, and `rosterDir` now lives only in `paths.ts`.

---

## Self-Review

**Spec coverage.** Acceptance 1 → Task 8/9 + T14; 2 → Task 5/10 + T13; 3 → Task 3/5 + T13/T14; 4 → Task 0 + T14; 9 → Task 8 (`hasExplicitPermissionConfig`); 9b → Task 5 + T14; 11 → Task 11 (`fleetGc`); 12 → Task 11; 13 → Task 12; 14 → global constraint + T14; 15 → Task 8; 16 → Task 7/11; 17 → Task 1/8; 18 → Task 14. Acceptance 5–8, 10 are A2 by the rev-3.2 split. **Gap found and closed:** acceptance 9's *reporting* half (agents showing "no human seam") needs a field on `AgentsRow`; the plan currently only parses the flag in Task 8. Task 10's `renderAgents` must surface it — added to Task 10's scope note below.

**Placeholder scan.** One deliberate marker remains in Task 7 Step 3 (the `require` inside `syncRoster`) with an explicit note telling the implementer to replace it with the top-level import and stating that typecheck will catch it. Everything else is complete code.

**Type consistency.** `FleetState` is defined once (Task 3) and used by Tasks 5, 6, 7, 11. `AgentsRow` is defined in Task 5 and consumed by Tasks 10 and 13. `RosterRow` fields used in Task 11 (`worktree`, `sessionId`, `name`) all exist in the Task 3 definition. `hostSocketPath(pid)` is pid-keyed in Tasks 1, 7, 10, 11 with no session-id variant anywhere.

**Spec drift.** Planning revealed one: acceptance 9 requires `agents` to *report* the no-human-seam condition, which needs a carrier on the wire row. `AgentsRow` gains an optional `noHumanSeam?: boolean` set when a bare `--bg` ran without permission config; `renderAgents` prints it in the human view and includes it in JSON. This does not change the doperpowers contract (extra keys are ignored by the poller's `.get()` reads). Add to the spec's `## Revision Notes`:
`- 2026-07-26 rev 3.4 — planning: AgentsRow carries an optional noHumanSeam flag so acceptance 9 has a wire carrier; extra keys are inert for the doperpowers poller.`

---

**Plan complete and saved to `CC-to-SDK/docs/superpowers/plans/2026-07-26-clone-spine-a1-fleet-substrate.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
