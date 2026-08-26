# M8 Cross-Session Messaging Execution Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use doperpowers:subagent-driven-execution to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the app-server a cross-session messaging domain — discover the Claude Code sessions on this machine, send an enveloped message to one, learn what became of it, and model the turn that begins when someone sends one to a thread this server hosts.

**Architecture:** The receive fabric already exists inside every session the SDK spawns (a per-session Unix-socket inbox the CLI binds itself). This milestone builds only what surrounds it: a **gateway** (one socket + one vouching key file, so replies can reach us), a **roster** read from the engine's own session registry, an **outbound** method that assembles the CLI's byte-exact envelope, and an **inbound** half that injects per-thread policy, announces arrivals, and adopts the turns those arrivals cause — keyed on the engine's own `command_lifecycle` frames rather than on timing.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), zod v4 (`zod/v4`), vitest, `@anthropic-ai/claude-agent-sdk` ^0.3.237, node ≥18. No new runtime dependencies.

**Spec:** `CC-to-SDK/docs/superpowers/specs/2026-08-26-agent-appserver-m8-cross-session-design.md` (rev 5). The plan argues from the spec; anything found in conflict during execution resolves against it, and the spec is edited rather than silently diverged from.

## Global Constraints

- All commands run from `CC-to-SDK/harness` unless a step says otherwise. The drift gate runs from `CC-to-SDK/`.
- ESM: every relative import specifier ends in `.js`, including for `.ts` sources.
- Schemas import from `zod/v4`, matching every existing file under `src/appserver/schema/`.
- Dense hand-style, no Prettier. Prefer a new module over growing a hot file.
- TDD: red → green → `npx tsc --noEmit` → commit. Every task's steps are written in that order.
- Dependency injection by default parameter (`deps = {...}`), so unit tests run keyless and touch no real socket, registry or home directory.
- **Never** hardcode `~/.claude`. Every path resolves through `claudeConfigDir(env)` (`src/config/claudeHome.ts:28`).
- `msg_id` on any outbound frame is a **UUID** — a non-UUID id silently costs the receipt's `orig_msg_id` correlation (probe 117b Q4).
- Envelope attribute order is fixed and byte-exact: `from`, `from-session`, `hop-chain`, `from-name`, `from-mode`. Only attributes actually set appear.
- `from-mode` is **always `"prompting"`**. No parameter, no thread, and no config changes it.
- New registered methods MUST appear in `src/appserver/schema/index.ts`'s `methodSchemas` — the drift gate walks that record, and a shipped method missing from it is a build failure.
- New methods publish a `result` schema (M5 convention D-M5-19).
- Commit messages carry no `Co-Authored-By` line and no trailer.
- Keyed live tests are **BLOCKED until 2026-08-31 00:00 Asia/Seoul** (account weekly limit). Task 12 is keyless and runnable now; Task 13 is keyed and runs after the reset.

---

## File Structure

**New, `src/peer/` — the machine-facing half, no app-server types in it:**
- `src/peer/address.ts` — address grammar (`uds:` / `bridge:` / bare path), namespace check, key-file naming, envelope assembly + attribute escaping. Pure; no I/O.
- `src/peer/roster.ts` — read `<claudeConfigDir()>/sessions/*.json`, project rows, liveness.
- `src/peer/gateway.ts` — bind the socket, publish/unlink the key file, parse inbound control frames, teardown.
- `src/peer/receipts.ts` — the `msgId → connection` correlation map with its retention rules.

**New, `src/appserver/` — the wire half:**
- `src/appserver/peerDomain.ts` — `peer/list`, `peer/send` handlers.
- `src/appserver/peerPolicy.ts` — policy injection into a thread's options, the settings sanitizer, `thread/crossSessionInbound/set`, and the `thread/settings/apply` reservation.
- `src/appserver/peerInbound.ts` — the arrival route and the adoption state machine.
- `src/appserver/schema/peer.ts` — params/result schemas for the three new methods.

**Modified:**
- `src/session/session.ts` — add `onUnclaimedResult`.
- `src/appserver/registry.ts` — three new `ThreadRecord` fields.
- `src/appserver/server.ts` — handler registrations, the `crossSession` capability marker, gateway lifecycle.
- `src/appserver/schema/index.ts` — three `methodSchemas` entries.
- `src/appserver/schema/core.ts` — `crossSession: z.literal(true)` on `initializeResult`.
- `src/appserver/settings.ts` — reserve `crossSessionInbound` in `thread/settings/apply`.
- `docs/parity/appserver.md`, `docs/parity/full-potential.md` — scorecard rows.

**Tests:** `test/unit/peer/{address,roster,gateway,receipts}.test.ts`, `test/unit/appserver/{peer-domain,peer-policy,peer-inbound}.test.ts`, `test/live/appserver-cross-session.test.ts`.

---

# STAGE A — the outbound half

Independently useful and independently reviewable: after Task 6 a client can discover peers, send to one, and hear what happened, with no inbound behaviour at all.

---

### Task 1: The address grammar and the byte-exact envelope

**Files:**
- Create: `src/peer/address.ts`
- Test: `test/unit/peer/address.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `parseAddress(addr: string): { kind: "uds"; path: string } | { kind: "bridge" } | undefined`
  - `sameNamespace(addrPath: string, ourSocketPath: string): boolean`
  - `keyFileName(pid: number, socketPath: string): string`
  - `escapeAttr(value: string): string`
  - `UNSAFE_ATTR_CHARS: RegExp`
  - `buildEnvelope(a: { from: string; fromSession?: string; fromName?: string }): (body: string) => string`
  - `MAX_FRAME_CHARS: number`

- [ ] **Step 1: Write the failing test**

Create `test/unit/peer/address.test.ts`:

```ts
// test/unit/peer/address.test.ts — the pure half of the peer domain: the address grammar, the key-file
// naming rule, and the envelope's byte-exactness. No socket, no filesystem: everything here is a string
// function, which is exactly why the envelope's fixed attribute order is testable at all.
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { parseAddress, sameNamespace, keyFileName, escapeAttr, buildEnvelope, MAX_FRAME_CHARS, UNSAFE_ATTR_CHARS } from "../../../src/peer/address.js";

describe("parseAddress", () => {
  it("accepts uds: and returns the path", () => {
    expect(parseAddress("uds:/tmp/cc-socks/42.sock")).toEqual({ kind: "uds", path: "/tmp/cc-socks/42.sock" });
  });
  it("recognises bridge: as its own kind so a caller can refuse it by name", () => {
    expect(parseAddress("bridge:abc")).toEqual({ kind: "bridge" });
  });
  it("rejects anything else", () => {
    expect(parseAddress("42")).toBeUndefined();
    expect(parseAddress("")).toBeUndefined();
    expect(parseAddress("http://x")).toBeUndefined();
  });
});

describe("sameNamespace", () => {
  it("is true only in the receiver's own socket directory", () => {
    expect(sameNamespace("/tmp/cc-socks/9.sock", "/tmp/cc-socks/1.sock")).toBe(true);
    expect(sameNamespace("/tmp/other/9.sock", "/tmp/cc-socks/1.sock")).toBe(false);
  });
});

describe("keyFileName", () => {
  it("is <pid>.<sha256 of the socket path>.key", () => {
    const p = "/tmp/cc-socks/7.sock";
    expect(keyFileName(7, p)).toBe(`7.${createHash("sha256").update(p).digest("hex")}.key`);
  });
});

describe("escapeAttr", () => {
  it("escapes the five XML attribute characters", () => {
    expect(escapeAttr(`a"b&c<d>e'f`)).toBe("a&quot;b&amp;c&lt;d&gt;e&apos;f");
  });
  it("flags control characters as unsafe rather than escaping them", () => {
    expect(UNSAFE_ATTR_CHARS.test("a\nb")).toBe(true);
    expect(UNSAFE_ATTR_CHARS.test("a\tb")).toBe(true);
    expect(UNSAFE_ATTR_CHARS.test("plain name")).toBe(false);
  });
});

describe("buildEnvelope", () => {
  it("emits attributes in the CLI's fixed order, omitting the ones not set", () => {
    const out = buildEnvelope({ from: "uds:/s.sock", fromName: "gw" })("hello");
    expect(out).toBe('<cross-session-message from="uds:/s.sock" from-name="gw" from-mode="prompting">\nhello\n</cross-session-message>');
  });
  it("places from-session between from and from-name", () => {
    const out = buildEnvelope({ from: "uds:/s.sock", fromSession: "sess-1", fromName: "gw" })("hi");
    expect(out.indexOf("from-session=")).toBeGreaterThan(out.indexOf('from="'));
    expect(out.indexOf("from-session=")).toBeLessThan(out.indexOf("from-name="));
  });
  it("never emits hop-chain", () => {
    expect(buildEnvelope({ from: "uds:/s.sock" })("hi")).not.toContain("hop-chain");
  });
  it("always asserts prompting, with no way to ask for anything else", () => {
    expect(buildEnvelope({ from: "uds:/s.sock" })("hi")).toContain('from-mode="prompting"');
  });
  it("escapes a hostile name so the attribute stays well-formed", () => {
    const out = buildEnvelope({ from: "uds:/s.sock", fromName: 'ev"il' })("hi");
    expect(out).toContain('from-name="ev&quot;il"');
  });
});

describe("MAX_FRAME_CHARS", () => {
  it("is well under any plausible receiver line cap", () => {
    expect(MAX_FRAME_CHARS).toBe(60_000);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/unit/peer/address.test.ts`
Expected: FAIL — `Failed to resolve import "../../../src/peer/address.js"`.

- [ ] **Step 3: Write the implementation**

Create `src/peer/address.ts`:

```ts
// src/peer/address.ts — the pure half of the peer domain. Everything here is a string function, which is
// deliberate: the envelope's correctness is a BYTE property (the receiver re-serializes what it parsed and
// requires equality before honouring any attribute), and a byte property is only testable when nothing
// else is in the way.
import { createHash } from "node:crypto";
import { dirname } from "node:path";

/** The CLI's address grammar is lexical, not a lookup: `uds:<path>` | `bridge:<...>`. A session id is NOT
 *  an address in any namespace — the mistake probe 110 made, and the reason its "not addressable"
 *  conclusion had to be retracted. `bridge:` is recognised so callers can refuse it BY NAME: it is the
 *  cross-machine path, governed by a different setting (`isolatePeerMachines`) and never measured here. */
export function parseAddress(addr: string): { kind: "uds"; path: string } | { kind: "bridge" } | undefined {
  if (addr.startsWith("uds:")) { const path = addr.slice(4); return path ? { kind: "uds", path } : undefined; }
  if (addr.startsWith("bridge:")) return { kind: "bridge" };
  return undefined;
}

/** The receipt sender refuses any reply address outside the receiver's own socket DIRECTORY (measured,
 *  probe 117b). So this is a correctness test, not a convention: a listener anywhere else can be sent to
 *  and can never be answered. */
export function sameNamespace(addrPath: string, ourSocketPath: string): boolean {
  return dirname(addrPath) === dirname(ourSocketPath);
}

/** `<pid>.<sha256(socket path)>.key`. The hash is of the socket PATH — derived in probe 117 by testing
 *  candidate rules against a real session's published file rather than by guessing. */
export function keyFileName(pid: number, socketPath: string): string {
  return `${pid}.${createHash("sha256").update(socketPath).digest("hex")}.key`;
}

/** Characters we will not put in an attribute at all. The receiver compares a canonical RESERIALIZATION,
 *  so a newline or tab that we escape one way and it re-emits another silently downgrades the whole
 *  envelope to plain text — which drops the permission attribution and changes the delivery decision with
 *  nothing raised anywhere. Refusing is recoverable; a silent downgrade is not. */
export const UNSAFE_ATTR_CHARS = /[\u0000-\u001f\u007f]/;

/** The five XML attribute entities. Measured spelling for these is a delegated unknown the spec names;
 *  until a probe pins the receiver's canonical form, only these five are permitted and everything in
 *  UNSAFE_ATTR_CHARS (the C0 controls and DEL) is refused upstream. */
export function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/** Our own conservative frame cap. The CLI's sender preflights size and refuses with both figures named,
 *  but that preflight belongs to the path we do not use — we write the socket directly, so an oversize
 *  line meets the RECEIVER's length cap, which drops it before the JSON is parsed and tells nobody. The
 *  receiver's real cap is unmeasured; this is set low enough that nothing we accept can reach it. */
export const MAX_FRAME_CHARS = 60_000;

/** The envelope, with the CLI's FIXED attribute order: from, from-session, hop-chain, from-name,
 *  from-mode. `hop-chain` is never set — it is for relayed traffic, and nothing here relays. `from-mode`
 *  is always "prompting": this gateway runs no model and asks no permission, so any other claim would be
 *  a false statement about the one attribute the recipient uses to decide. */
export function buildEnvelope(a: { from: string; fromSession?: string; fromName?: string }): (body: string) => string {
  const attrs = [`from="${escapeAttr(a.from)}"`];
  if (a.fromSession !== undefined) attrs.push(`from-session="${escapeAttr(a.fromSession)}"`);
  if (a.fromName !== undefined) attrs.push(`from-name="${escapeAttr(a.fromName)}"`);
  attrs.push(`from-mode="prompting"`);
  const open = `<cross-session-message ${attrs.join(" ")}>`;
  return (body: string) => `${open}\n${body}\n</cross-session-message>`;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run test/unit/peer/address.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/peer/address.ts test/unit/peer/address.test.ts
git commit -m "feat(peer): the address grammar and the byte-exact envelope"
```

---

### Task 2: The roster — who is addressable on this machine

**Files:**
- Create: `src/peer/roster.ts`
- Test: `test/unit/peer/roster.test.ts`

**Interfaces:**
- Consumes: from Task 1: nothing directly (roster returns raw addresses that `peerDomain` will parse).
- Produces:
  - `interface PeerRow { address: string; sessionId?: string; pid: number; entrypoint?: string; kind?: string; name?: string; cwd?: string; version?: string; peerProtocol?: number; peerFeatures?: string[]; alive: boolean; inboxBound: boolean }`
  - `interface RosterDeps { readDir(dir: string): string[]; readFile(path: string): string; exists(path: string): boolean; isPidLive(pid: number, procStart?: string): Promise<boolean> }`
  - `sessionsDir(env?: NodeJS.ProcessEnv): string`
  - `readPeerRows(env?: NodeJS.ProcessEnv, deps?: RosterDeps): Promise<PeerRow[]>`
  - `peerTokenFor(socketPath: string, pid: number, env?, deps?): string | undefined`

- [ ] **Step 1: Write the failing test**

Create `test/unit/peer/roster.test.ts`:

```ts
// test/unit/peer/roster.test.ts — the roster read, fully injected: no real home directory, no ps(1), no
// sockets. The rows belong to ANOTHER program, so the load-bearing property here is that we project what
// is present and omit what is absent rather than inventing defaults.
import { describe, it, expect } from "vitest";
import { sessionsDir, readPeerRows, peerTokenFor, type RosterDeps } from "../../../src/peer/roster.js";
import { keyFileName } from "../../../src/peer/address.js";

const row = (o: Record<string, unknown>) => JSON.stringify(o);

function mkDeps(files: Record<string, string>, live: Record<number, boolean> = {}, present: string[] = []): RosterDeps {
  return {
    readDir: () => Object.keys(files),
    readFile: (p: string) => { const name = p.split("/").pop()!; if (!(name in files)) throw new Error("ENOENT"); return files[name]; },
    exists: (p: string) => present.includes(p),
    isPidLive: async (pid: number) => live[pid] ?? false,
  };
}

describe("sessionsDir", () => {
  it("resolves under CLAUDE_CONFIG_DIR when it is set, with no .claude segment", () => {
    expect(sessionsDir({ CLAUDE_CONFIG_DIR: "/tenant/cfg" } as NodeJS.ProcessEnv)).toBe("/tenant/cfg/sessions");
  });
  it("falls back to $HOME/.claude", () => {
    expect(sessionsDir({ HOME: "/home/u" } as NodeJS.ProcessEnv)).toBe("/home/u/.claude/sessions");
  });
});

describe("readPeerRows", () => {
  const env = { CLAUDE_CONFIG_DIR: "/cfg" } as NodeJS.ProcessEnv;

  it("projects present fields verbatim and omits absent ones", async () => {
    const deps = mkDeps({ "11.json": row({ pid: 11, sessionId: "s-1", messagingSocketPath: "/sock/11.sock", entrypoint: "sdk-cli", peerProtocol: 1 }) }, { 11: true }, ["/sock/11.sock"]);
    const [r] = await readPeerRows(env, deps);
    expect(r.address).toBe("uds:/sock/11.sock");
    expect(r.sessionId).toBe("s-1");
    expect(r.entrypoint).toBe("sdk-cli");
    expect(r.peerProtocol).toBe(1);
    expect("name" in r).toBe(false);
    expect("cwd" in r).toBe(false);
  });

  it("marks liveness from the pid probe and inboxBound from the socket's existence", async () => {
    const deps = mkDeps({
      "11.json": row({ pid: 11, messagingSocketPath: "/sock/11.sock" }),
      "12.json": row({ pid: 12, messagingSocketPath: "/sock/12.sock" }),
    }, { 11: true, 12: false }, ["/sock/11.sock"]);
    const rows = await readPeerRows(env, deps);
    expect(rows.find(r => r.pid === 11)).toMatchObject({ alive: true, inboxBound: true });
    expect(rows.find(r => r.pid === 12)).toMatchObject({ alive: false, inboxBound: false });
  });

  it("skips rows with no messagingSocketPath — they have no address", async () => {
    const deps = mkDeps({ "13.json": row({ pid: 13 }) }, { 13: true });
    expect(await readPeerRows(env, deps)).toEqual([]);
  });

  it("skips unparseable rows instead of failing the whole read", async () => {
    const deps = mkDeps({ "14.json": "{not json", "15.json": row({ pid: 15, messagingSocketPath: "/sock/15.sock" }) }, { 15: true }, ["/sock/15.sock"]);
    const rows = await readPeerRows(env, deps);
    expect(rows.map(r => r.pid)).toEqual([15]);
  });

  it("ignores non-row files such as the key files", async () => {
    const deps = mkDeps({ "16.abc.key": "{}", "17.json": row({ pid: 17, messagingSocketPath: "/sock/17.sock" }) }, { 17: true }, ["/sock/17.sock"]);
    expect((await readPeerRows(env, deps)).map(r => r.pid)).toEqual([17]);
  });

  it("returns [] when the directory does not exist", async () => {
    const deps: RosterDeps = { readDir: () => { throw new Error("ENOENT"); }, readFile: () => "", exists: () => false, isPidLive: async () => false };
    expect(await readPeerRows(env, deps)).toEqual([]);
  });
});

describe("peerTokenFor", () => {
  const env = { CLAUDE_CONFIG_DIR: "/cfg" } as NodeJS.ProcessEnv;
  it("reads the token from the key file named for that socket path", () => {
    const name = keyFileName(21, "/sock/21.sock");
    const deps = mkDeps({ [name]: JSON.stringify({ peerToken: "a".repeat(32) }) });
    expect(peerTokenFor("/sock/21.sock", 21, env, deps)).toBe("a".repeat(32));
  });
  it("is undefined when no key file matches", () => {
    const deps = mkDeps({});
    expect(peerTokenFor("/sock/22.sock", 22, env, deps)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/unit/peer/roster.test.ts`
Expected: FAIL — cannot resolve `src/peer/roster.js`.

- [ ] **Step 3: Write the implementation**

Create `src/peer/roster.ts`:

```ts
// src/peer/roster.ts — who is addressable on this machine, read from the ENGINE's own session registry.
// The rows are another program's file: this module projects what is present and omits what is absent,
// because a row that invents a default is a row that lies about a session we do not own.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { claudeConfigDir } from "../config/claudeHome.js";
import { isPidLive as realIsPidLive } from "../fleet/liveness.js";
import { keyFileName } from "./address.js";

export interface PeerRow {
  address: string;
  sessionId?: string;
  pid: number;
  entrypoint?: string; kind?: string; name?: string; cwd?: string;
  version?: string; peerProtocol?: number; peerFeatures?: string[];
  alive: boolean;
  inboxBound: boolean;
}

export interface RosterDeps {
  readDir(dir: string): string[];
  readFile(path: string): string;
  exists(path: string): boolean;
  isPidLive(pid: number, procStart?: string): Promise<boolean>;
}

const realDeps: RosterDeps = {
  readDir: (d) => readdirSync(d),
  readFile: (p) => readFileSync(p, "utf8"),
  exists: (p) => existsSync(p),
  isPidLive: (pid, procStart) => realIsPidLive(pid, procStart),
};

/** NEVER `~/.claude`: `CLAUDE_CONFIG_DIR` REPLACES that path outright, and this harness's own tenant
 *  preset exports it per tenant. Reading the literal home directory under a preset lists the wrong
 *  namespace's peers and omits the right ones. */
export function sessionsDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(claudeConfigDir(env), "sessions");
}

export async function readPeerRows(env: NodeJS.ProcessEnv = process.env, deps: RosterDeps = realDeps): Promise<PeerRow[]> {
  const dir = sessionsDir(env);
  let names: string[];
  try { names = deps.readDir(dir); } catch { return []; }
  const out: PeerRow[] = [];
  for (const name of names) {
    if (!/^\d+\.json$/.test(name)) continue;   // key files and anything else are not rows
    let j: Record<string, unknown>;
    try { j = JSON.parse(deps.readFile(join(dir, name))) as Record<string, unknown>; } catch { continue; }
    const sock = j.messagingSocketPath;
    const pid = j.pid;
    if (typeof sock !== "string" || !sock || typeof pid !== "number") continue; // no address, no row
    const row: PeerRow = {
      address: `uds:${sock}`,
      pid,
      alive: await deps.isPidLive(pid, typeof j.procStart === "string" ? j.procStart : undefined),
      inboxBound: deps.exists(sock),
    };
    // Present-or-absent, one key at a time, rather than a spread of the whole object: the row carries
    // fields we do not model, and forwarding them wholesale would publish another program's internals
    // as if they were our contract.
    if (typeof j.sessionId === "string") row.sessionId = j.sessionId;
    if (typeof j.entrypoint === "string") row.entrypoint = j.entrypoint;
    if (typeof j.kind === "string") row.kind = j.kind;
    if (typeof j.name === "string") row.name = j.name;
    if (typeof j.cwd === "string") row.cwd = j.cwd;
    if (typeof j.version === "string") row.version = j.version;
    if (typeof j.peerProtocol === "number") row.peerProtocol = j.peerProtocol;
    if (Array.isArray(j.peerFeatures)) row.peerFeatures = j.peerFeatures.filter((f): f is string => typeof f === "string");
    out.push(row);
  }
  return out;
}

/** The auth token a sender prepends when writing to a peer's inbox. Read by SOCKET PATH — the key file is
 *  named for the hash of that path — and never printed or logged anywhere. */
export function peerTokenFor(socketPath: string, pid: number, env: NodeJS.ProcessEnv = process.env, deps: RosterDeps = realDeps): string | undefined {
  const dir = sessionsDir(env);
  try {
    const j = JSON.parse(deps.readFile(join(dir, keyFileName(pid, socketPath)))) as { peerToken?: unknown };
    return typeof j.peerToken === "string" ? j.peerToken : undefined;
  } catch { return undefined; }
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run test/unit/peer/roster.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/peer/roster.ts test/unit/peer/roster.test.ts
git commit -m "feat(peer): the roster, read through claudeConfigDir and projected honestly"
```

---

### Task 3: The receipt correlation map and its retention rules

**Files:**
- Create: `src/peer/receipts.ts`
- Test: `test/unit/peer/receipts.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type ReceiptStatus = "held" | "expired" | "delivered" | "refused" | "denied" | "dropped"`
  - `interface ReceiptSink<C> { deliver(conn: C, msgId: string, status: ReceiptStatus, reason: string | undefined, from: string): void }`
  - `class ReceiptMap<C extends { connId: number }> { constructor(sink: ReceiptSink<C>, opts?: { now?: () => number; retentionMs?: number; perConn?: number; global?: number }); track(msgId: string, conn: C): void; route(frame: { orig_msg_id?: unknown; status?: unknown; reason?: unknown; from?: unknown }): boolean; dropConnection(connId: number): void; sweep(retentionMs?: number): void; size(): number }`

  The map holds the CONNECTION HANDLE, not an id it would have to look up elsewhere. A second
  `msgId -> connection` map in the server would outlive every release this one performs — a leak with no
  signal, and exactly the shape of bug the retention rules exist to prevent.
  - `RETENTION_MS = 30 * 60_000`, `PER_CONN_CAP = 256`, `GLOBAL_CAP = 4096`

- [ ] **Step 1: Write the failing test**

Create `test/unit/peer/receipts.test.ts`:

```ts
// test/unit/peer/receipts.test.ts — the correlation map's LIFECYCLE, which is the whole difficulty: the
// common outcomes (delivered, refused) produce no receipt at all, so nothing about the success path ever
// signals that an entry can be released. Every rule below exists because "wait for the receipt" is not a
// cleanup strategy when the receipt may never come.
import { describe, it, expect } from "vitest";
import { ReceiptMap, RETENTION_MS, PER_CONN_CAP, GLOBAL_CAP, type ReceiptStatus } from "../../../src/peer/receipts.js";

function mk(now = { t: 0 }) {
  const seen: Array<{ msgId: string; status: ReceiptStatus; reason?: string; from: string }> = [];
  const map = new ReceiptMap<{ connId: number }>({ deliver: (_conn, msgId, status, reason, from) => { seen.push({ msgId, status, ...(reason ? { reason } : {}), from }); } }, { now: () => now.t });
  const track = (msgId: string, connId: number) => map.track(msgId, { connId });
  return { map, seen, now, track };
}

describe("ReceiptMap", () => {
  it("routes a receipt to the connection that sent the message", () => {
    const { map, seen, track } = mk();
    track("m-1", 7);
    expect(map.route({ orig_msg_id: "m-1", status: "held", reason: "parity", from: "uds:/a.sock" })).toBe(true);
    expect(seen).toEqual([{ msgId: "m-1", status: "held", reason: "parity", from: "uds:/a.sock" }]);
  });

  it("ignores a receipt for a msgId it never tracked", () => {
    const { map, seen, track } = mk();
    expect(map.route({ orig_msg_id: "nope", status: "held", from: "uds:/a.sock" })).toBe(false);
    expect(seen).toEqual([]);
  });

  it("ignores a frame with no orig_msg_id — a non-UUID msg_id costs correlation, and silence is correct", () => {
    const { map, track } = mk();
    track("m-1", 7);
    expect(map.route({ status: "held", from: "uds:/a.sock" })).toBe(false);
  });

  it("KEEPS the entry after held, because expired can still follow", () => {
    const { map, seen, track } = mk();
    track("m-1", 7);
    map.route({ orig_msg_id: "m-1", status: "held", from: "uds:/a.sock" });
    expect(map.size()).toBe(1);
    map.route({ orig_msg_id: "m-1", status: "expired", from: "uds:/a.sock" });
    expect(seen.map(s => s.status)).toEqual(["held", "expired"]);
    expect(map.size()).toBe(0);
  });

  it("releases immediately on every terminal status", () => {
    for (const status of ["expired", "delivered", "refused", "denied", "dropped"] as ReceiptStatus[]) {
      const { map, track } = mk();
      track("m-1", 7);
      map.route({ orig_msg_id: "m-1", status, from: "uds:/a.sock" });
      expect(map.size()).toBe(0);
    }
  });

  it("drops a connection's entries when it closes", () => {
    const { map, track } = mk();
    track("m-1", 7); track("m-2", 8);
    map.dropConnection(7);
    expect(map.size()).toBe(1);
    expect(map.route({ orig_msg_id: "m-1", status: "held", from: "uds:/a.sock" })).toBe(false);
  });

  it("expires entries past the retention window and TELLS the sender", () => {
    const now = { t: 0 };
    const { map, seen, track } = mk(now);
    track("m-1", 7);
    now.t = RETENTION_MS + 1;
    map.sweep();
    expect(map.size()).toBe(0);
    expect(seen).toEqual([{ msgId: "m-1", status: "dropped", reason: "correlation expired", from: "" }]);
  });

  it("evicts oldest-first at the per-connection cap, and says so", () => {
    const { map, seen, track } = mk();
    for (let i = 0; i <= PER_CONN_CAP; i++) track(`m-${i}`, 7);
    expect(map.size()).toBe(PER_CONN_CAP);
    expect(seen[0]).toEqual({ msgId: "m-0", status: "dropped", reason: "correlation evicted", from: "" });
  });

  it("evicts oldest-first at the global cap across connections", () => {
    const { map, track } = mk();
    for (let i = 0; i <= GLOBAL_CAP; i++) track(`g-${i}`, i % 64);
    expect(map.size()).toBe(GLOBAL_CAP);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/unit/peer/receipts.test.ts`
Expected: FAIL — cannot resolve `src/peer/receipts.js`.

- [ ] **Step 3: Write the implementation**

Create `src/peer/receipts.ts`:

```ts
// src/peer/receipts.ts — the msgId -> connection map a `peer/send` leaves behind so a later status frame
// can be routed back to whoever asked.
//
// Its whole difficulty is that the COMMON outcomes are silent. Measured (probe 117b and the receivers'
// own logs in 117): a delivered message and a refused message produce no receipt at all; only `held` and
// `expired` do. So nothing about the success path ever signals that an entry may be released, and
// "release it when the receipt arrives" would grow this map without bound for any long-lived client.
// Hence three rules, none optional: an absolute retention window, drop-on-connection-close, and caps.
export type ReceiptStatus = "held" | "expired" | "delivered" | "refused" | "denied" | "dropped";

/** Generic over the connection handle so this module never imports an app-server type: it stores what it
 *  was handed and gives it back, which is what keeps ONE map with ONE lifecycle. */
export interface ReceiptSink<C> {
  deliver(conn: C, msgId: string, status: ReceiptStatus, reason: string | undefined, from: string): void;
}

/** Six times the CLI's 5-minute default hold deadline. FIXED here rather than derived from this process's
 *  `CLAUDE_CODE_USER_DIALOG_TIMEOUT_MS`: the deadline belongs to the RECEIVER, which may run with its own,
 *  so a locally-derived TTL could expire before a status we were still owed. */
export const RETENTION_MS = 30 * 60_000;
export const PER_CONN_CAP = 256;
export const GLOBAL_CAP = 4096;

/** `held` is NOT terminal — an `expired` follows it when the recipient never approves — so it is the one
 *  status that leaves its entry in place. */
const TERMINAL: ReadonlySet<ReceiptStatus> = new Set<ReceiptStatus>(["expired", "delivered", "refused", "denied", "dropped"]);

interface Entry<C> { conn: C; at: number }

export class ReceiptMap<C extends { connId: number }> {
  private entries = new Map<string, Entry<C>>();   // insertion-ordered, which is what makes oldest-first eviction a shift
  private readonly now: () => number;
  private readonly retentionMs: number;
  private readonly perConn: number;
  private readonly globalCap: number;

  constructor(private sink: ReceiptSink<C>, opts: { now?: () => number; retentionMs?: number; perConn?: number; global?: number } = {}) {
    this.now = opts.now ?? Date.now;
    this.retentionMs = opts.retentionMs ?? RETENTION_MS;
    this.perConn = opts.perConn ?? PER_CONN_CAP;
    this.globalCap = opts.global ?? GLOBAL_CAP;
  }

  track(msgId: string, conn: C): void {
    this.entries.set(msgId, { conn, at: this.now() });
    this.evict((e) => e.conn.connId === conn.connId, this.perConn);
    this.evict(() => true, this.globalCap);
  }

  /** Returns whether the frame was ours to route. A frame with no `orig_msg_id` is not — the CLI omits it
   *  for a non-UUID `msg_id`, which is why `peer/send` mints one rather than accepting a client's. */
  route(frame: { orig_msg_id?: unknown; status?: unknown; reason?: unknown; from?: unknown }): boolean {
    const msgId = frame.orig_msg_id;
    if (typeof msgId !== "string") return false;
    const entry = this.entries.get(msgId);
    if (!entry) return false;
    const status = (typeof frame.status === "string" ? frame.status : "dropped") as ReceiptStatus;
    this.sink.deliver(entry.conn, msgId, status, typeof frame.reason === "string" ? frame.reason : undefined, typeof frame.from === "string" ? frame.from : "");
    if (TERMINAL.has(status)) this.entries.delete(msgId);
    return true;
  }

  dropConnection(connId: number): void {
    for (const [msgId, e] of [...this.entries]) if (e.conn.connId === connId) this.entries.delete(msgId);
  }

  /** `retentionMs` is overridable so shutdown can expire everything still tracked rather than leaving
   *  those senders unanswered. */
  sweep(retentionMs: number = this.retentionMs): void {
    const cutoff = this.now() - retentionMs;
    for (const [msgId, e] of [...this.entries]) {
      if (e.at >= cutoff) continue;
      this.entries.delete(msgId);
      // Never a SILENT drop: a client that will never hear about this message again should be told that,
      // not left waiting for a status the map has already forgotten how to route.
      this.sink.deliver(e.conn, msgId, "dropped", "correlation expired", "");
    }
  }

  size(): number { return this.entries.size; }

  private evict(match: (e: Entry<C>) => boolean, cap: number): void {
    let n = 0;
    for (const e of this.entries.values()) if (match(e)) n++;
    for (const [msgId, e] of this.entries) {
      if (n <= cap) break;
      if (!match(e)) continue;
      this.entries.delete(msgId);
      this.sink.deliver(e.conn, msgId, "dropped", "correlation evicted", "");
      n--;
    }
  }
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run test/unit/peer/receipts.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/peer/receipts.ts test/unit/peer/receipts.test.ts
git commit -m "feat(peer): the receipt map, with the retention rules a silent success path forces"
```

---

### Task 4: The gateway inbox

**Files:**
- Create: `src/peer/gateway.ts`
- Test: `test/unit/peer/gateway.test.ts`

**Interfaces:**
- Consumes: from Task 1: `keyFileName`; from Task 3: `ReceiptMap`.
- Produces:
  - `interface GatewayEvents { onReceipt(frame: Record<string, unknown>): void; onStrayFrame(kind: string): void }`
  - `class PeerGateway { static async bind(events: GatewayEvents, opts?: { env?: NodeJS.ProcessEnv; socketDir?: string; pid?: number }): Promise<PeerGateway | undefined>; readonly socketPath: string; readonly address: string; readonly configRoot: string; sendFrames(socketPath: string, frames: unknown[]): Promise<"CLOSED" | string>; close(): Promise<void> }`
  - `defaultSocketDir(env?: NodeJS.ProcessEnv): string`

- [ ] **Step 1: Write the failing test**

Create `test/unit/peer/gateway.test.ts`:

```ts
// test/unit/peer/gateway.test.ts — the gateway over a REAL unix socket in a temp directory. A socket
// server is cheap and a fake would prove nothing here: the two properties that matter are wire
// properties. It must CLOSE the connection after consuming a frame (the receipt sender writes one buffer,
// never reads, and times out idle at 5s — a listener that holds the connection open turns every receipt
// into the sender's error, which is exactly what probe 113b logged and 113c never diagnosed), and it must
// publish a key file where a receiver will look for it.
import { describe, it, expect, afterAll } from "vitest";
import { createConnection } from "node:net";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PeerGateway } from "../../../src/peer/gateway.js";
import { keyFileName } from "../../../src/peer/address.js";

const roots: string[] = [];
function mkEnv() {
  const cfg = mkdtempSync(join(tmpdir(), "m8cfg-"));
  const sock = mkdtempSync(join(tmpdir(), "m8sock-"));
  roots.push(cfg, sock);
  return { env: { CLAUDE_CONFIG_DIR: cfg } as NodeJS.ProcessEnv, cfg, sock };
}
afterAll(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });

/** Write NDJSON to the gateway and report whether the gateway closed the connection on us. */
function writeLine(path: string, line: string): Promise<"closed-by-peer" | "timeout"> {
  return new Promise((res) => {
    const c = createConnection(path);
    const timer = setTimeout(() => { c.destroy(); res("timeout"); }, 2000);
    c.on("connect", () => c.write(line + "\n"));
    c.on("close", () => { clearTimeout(timer); res("closed-by-peer"); });
    c.on("error", () => { clearTimeout(timer); res("timeout"); });
  });
}

describe("PeerGateway", () => {
  it("binds, publishes a key file for its own socket, and unlinks both on close", async () => {
    const { env, cfg, sock } = mkEnv();
    const gw = await PeerGateway.bind({ onReceipt: () => {}, onStrayFrame: () => {} }, { env, socketDir: sock, pid: 4242 });
    expect(gw).toBeDefined();
    const keyPath = join(cfg, "sessions", keyFileName(4242, gw!.socketPath));
    expect(existsSync(gw!.socketPath)).toBe(true);
    expect(existsSync(keyPath)).toBe(true);
    expect(JSON.parse(readFileSync(keyPath, "utf8")).peerToken).toMatch(/^[0-9a-f]{32}$/);
    await gw!.close();
    expect(existsSync(gw!.socketPath)).toBe(false);
    expect(existsSync(keyPath)).toBe(false);
  });

  it("publishes NO registry row — it is a reply address, not a session", async () => {
    const { env, cfg, sock } = mkEnv();
    const gw = await PeerGateway.bind({ onReceipt: () => {}, onStrayFrame: () => {} }, { env, socketDir: sock, pid: 4243 });
    expect(existsSync(join(cfg, "sessions", "4243.json"))).toBe(false);
    await gw!.close();
  });

  it("routes a peer_message_status control frame and CLOSES the connection", async () => {
    const { env, sock } = mkEnv();
    const got: Record<string, unknown>[] = [];
    const gw = await PeerGateway.bind({ onReceipt: (f) => got.push(f), onStrayFrame: () => {} }, { env, socketDir: sock, pid: 4244 });
    const outcome = await writeLine(gw!.socketPath, JSON.stringify({ type: "control", action: "peer_message_status", orig_msg_id: "m-1", status: "held" }));
    expect(outcome).toBe("closed-by-peer");
    expect(got).toEqual([{ type: "control", action: "peer_message_status", orig_msg_id: "m-1", status: "held" }]);
    await gw!.close();
  });

  it("ignores an auth line without treating it as a stray", async () => {
    const { env, sock } = mkEnv();
    const strays: string[] = [];
    const gw = await PeerGateway.bind({ onReceipt: () => {}, onStrayFrame: (k) => strays.push(k) }, { env, socketDir: sock, pid: 4245 });
    await writeLine(gw!.socketPath, JSON.stringify({ type: "auth", token: "x" }));
    expect(strays).toEqual([]);
    await gw!.close();
  });

  it("reports a type:user frame as a stray — the gateway is not a session and must never look like one", async () => {
    const { env, sock } = mkEnv();
    const strays: string[] = [];
    const gw = await PeerGateway.bind({ onReceipt: () => {}, onStrayFrame: (k) => strays.push(k) }, { env, socketDir: sock, pid: 4246 });
    await writeLine(gw!.socketPath, JSON.stringify({ type: "user", message: { content: "hello" } }));
    expect(strays).toEqual(["user"]);
    await gw!.close();
  });

  it("returns undefined when the socket cannot be bound, rather than throwing", async () => {
    const { env } = mkEnv();
    const gw = await PeerGateway.bind({ onReceipt: () => {}, onStrayFrame: () => {} }, { env, socketDir: "/definitely/not/a/dir", pid: 4247 });
    expect(gw).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/unit/peer/gateway.test.ts`
Expected: FAIL — cannot resolve `src/peer/gateway.js`.

- [ ] **Step 3: Write the implementation**

Create `src/peer/gateway.ts`:

```ts
// src/peer/gateway.ts — this server's own reply address in the peer namespace.
//
// It is NOT a session, and the difference is the design: it publishes a KEY FILE and no registry row.
// A key alone vouches a reply address (measured, probe 117b Q3), so publishing a row would put the
// app-server in every session-listing tool on the machine claiming to be something it is not.
//
// Two wire properties are load-bearing and both were learned the hard way:
//   - the socket must live in the RECEIVER's own directory, because the receipt sender refuses any reply
//     address outside it;
//   - the listener must CLOSE the connection once it has consumed a frame. The sender writes one buffer,
//     never reads, and times out idle after five seconds — so a listener that stays open turns every
//     receipt into the sender's error. That is what probe 113b logged, and why 113c received nothing.
import { createConnection, createServer, type Server, type Socket } from "node:net";
import { randomBytes } from "node:crypto";
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { claudeConfigDir } from "../config/claudeHome.js";
import { keyFileName } from "./address.js";

export interface GatewayEvents {
  onReceipt(frame: Record<string, unknown>): void;
  onStrayFrame(kind: string): void;
}

const MAX_LINE = 64 * 1024;

/** Where the CLI binds its own inboxes, and therefore the only directory a reply address may sit in. */
export function defaultSocketDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.XDG_RUNTIME_DIR || "/tmp", "cc-socks");
}

export class PeerGateway {
  private constructor(
    private server: Server,
    readonly socketPath: string,
    private keyPath: string,
    readonly configRoot: string,
  ) {}

  get address(): string { return `uds:${this.socketPath}`; }

  static async bind(events: GatewayEvents, opts: { env?: NodeJS.ProcessEnv; socketDir?: string; pid?: number } = {}): Promise<PeerGateway | undefined> {
    const env = opts.env ?? process.env;
    const pid = opts.pid ?? process.pid;
    const socketDir = opts.socketDir ?? defaultSocketDir(env);
    const configRoot = claudeConfigDir(env);
    const socketPath = join(socketDir, `${pid}.sock`);
    const sessionsPath = join(configRoot, "sessions");
    const keyPath = join(sessionsPath, keyFileName(pid, socketPath));
    try {
      mkdirSync(socketDir, { recursive: true, mode: 0o700 });
      mkdirSync(sessionsPath, { recursive: true });
      try { unlinkSync(socketPath); } catch { /* nothing stale to clear */ }
      const server = createServer((c) => handleConn(c, events));
      await new Promise<void>((res, rej) => {
        server.once("error", rej);
        server.listen(socketPath, () => res());
      });
      server.unref(); // a listening reply address must never be the reason this process stays alive
      writeFileSync(keyPath, JSON.stringify({ peerToken: randomBytes(16).toString("hex") }), { mode: 0o600 });
      return new PeerGateway(server, socketPath, keyPath, configRoot);
    } catch {
      // A gateway that cannot bind is not fatal: the server runs and every peer method answers
      // unavailable. The whole inbound fabric sits behind a server-side feature gate that can turn off
      // without an SDK release, so degrading is the baseline rather than the error path.
      return undefined;
    }
  }

  /** Write NDJSON to a peer's inbox and resolve when the connection closes. No reply is read: the CLI's
   *  ingress never answers on the same connection. */
  sendFrames(socketPath: string, frames: unknown[]): Promise<"CLOSED" | string> {
    return new Promise((res) => {
      const c = createConnection(socketPath);
      let done = false;
      const fin = (v: "CLOSED" | string) => { if (!done) { done = true; res(v); } };
      c.on("connect", () => { for (const f of frames) c.write(JSON.stringify(f) + "\n"); c.end(); });
      c.on("error", (e) => fin("ERROR:" + ((e as NodeJS.ErrnoException).code ?? "unknown")));
      c.on("close", () => fin("CLOSED"));
      setTimeout(() => fin("TIMEOUT"), 10_000).unref?.();
    });
  }

  async close(): Promise<void> {
    await new Promise<void>((res) => this.server.close(() => res()));
    try { unlinkSync(this.socketPath); } catch { /* already gone */ }
    try { unlinkSync(this.keyPath); } catch { /* already gone */ }
  }
}

function handleConn(c: Socket, events: GatewayEvents): void {
  c.setEncoding("utf8");
  let buf = "";
  c.on("data", (d: string) => {
    buf += d;
    if (buf.length > MAX_LINE) { c.destroy(); return; }
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let frame: Record<string, unknown>;
      try { frame = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
      const type = typeof frame.type === "string" ? frame.type : "";
      if (type === "auth") continue;   // the sender's courtesy; we are the listener and require nothing
      if (type === "control" && frame.action === "peer_message_status") { events.onReceipt(frame); continue; }
      events.onStrayFrame(type || "unknown");
    }
    c.end();   // the sender never reads; hold this open and its 5s idle timeout kills the receipt
  });
  c.on("error", () => { /* the peer hung up mid-write; nothing to do */ });
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run test/unit/peer/gateway.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/peer/gateway.ts test/unit/peer/gateway.test.ts
git commit -m "feat(peer): the gateway inbox — key file, no registry row, closes on read"
```

---

### Task 5: The `peer/*` schemas

**Files:**
- Create: `src/appserver/schema/peer.ts`
- Modify: `src/appserver/schema/index.ts`
- Modify: `src/appserver/schema/core.ts`
- Test: `test/unit/appserver/schema.test.ts` (extend)

**Interfaces:**
- Consumes: nothing.
- Produces (all zod schemas): `peerListParams`, `peerListResult`, `peerSendParams`, `peerSendResult`, `crossSessionInboundSetParams`, `crossSessionInboundSetResult`, and the `CROSS_SESSION_INBOUND` value tuple.

- [ ] **Step 1: Write the failing test**

Append to `test/unit/appserver/schema.test.ts`:

```ts
describe("M8 peer schemas", () => {
  it("registers all three methods with a published result shape", () => {
    for (const m of ["peer/list", "peer/send", "thread/crossSessionInbound/set"]) {
      expect(methodSchemas[m]).toBeDefined();
      expect(methodSchemas[m].result).toBeDefined();
    }
  });

  it("peer/send requires a target and a message, and takes no from-mode of any spelling", () => {
    const ok = methodSchemas["peer/send"].params.safeParse({ target: "s-1", message: "hi" });
    expect(ok.success).toBe(true);
    expect(methodSchemas["peer/send"].params.safeParse({ target: "s-1" }).success).toBe(false);
    const withMode = methodSchemas["peer/send"].params.safeParse({ target: "s-1", message: "hi", asMode: "bypass" });
    expect(withMode.success && "asMode" in (withMode.data as object)).toBe(false);
  });

  it("peer/send's result states written-not-delivered, plus reachability", () => {
    const r = methodSchemas["peer/send"].result!.safeParse({ msgId: "u", address: "uds:/a.sock", delivered: false, statusReachable: true });
    expect(r.success).toBe(true);
    expect(methodSchemas["peer/send"].result!.safeParse({ msgId: "u", address: "uds:/a.sock", delivered: true, statusReachable: true }).success).toBe(false);
  });

  it("crossSessionInbound takes exactly the three CLI values", () => {
    for (const v of ["accept", "hold", "refuse"]) {
      expect(methodSchemas["thread/crossSessionInbound/set"].params.safeParse({ threadId: "t", value: v }).success).toBe(true);
    }
    expect(methodSchemas["thread/crossSessionInbound/set"].params.safeParse({ threadId: "t", value: "maybe" }).success).toBe(false);
  });

  it("initialize's result publishes the crossSession capability marker", () => {
    const r = methodSchemas["initialize"].result!.safeParse({ userAgent: "x", version: "1", platformOs: "darwin", dynamicTools: true, crossSession: true });
    expect(r.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/unit/appserver/schema.test.ts`
Expected: FAIL — `methodSchemas["peer/list"]` is undefined.

- [ ] **Step 3: Write the schemas**

Create `src/appserver/schema/peer.ts`:

```ts
// appserver/schema/peer.ts — M8's three methods. Each publishes a `result` (M5's D-M5-19): these are new,
// so there is no incremental-adoption excuse for omitting one.
import { z } from "zod/v4";

export const CROSS_SESSION_INBOUND = ["accept", "hold", "refuse"] as const;

const peerRow = z.object({
  address: z.string(),
  sessionId: z.string().optional(),
  pid: z.number().int(),
  entrypoint: z.string().optional(),
  kind: z.string().optional(),
  name: z.string().optional(),
  cwd: z.string().optional(),
  version: z.string().optional(),
  peerProtocol: z.number().int().optional(),
  peerFeatures: z.array(z.string()).optional(),
  alive: z.boolean(),
  inboxBound: z.boolean(),
  threadId: z.string().optional(),
  // Declared, not merely described: a client cannot implement "this peer can never answer" from prose.
  statusReachable: z.boolean(),
});

export const peerListParams = z.object({ aliveOnly: z.boolean().optional() });
export const peerListResult = z.object({ peers: z.array(peerRow) });

/** No `asMode`, and that absence is the security property: `from-mode` is always "prompting", decided by
 *  the gateway's own nature rather than by anything a caller can say. `fromThreadId` is ATTRIBUTION only —
 *  it sets from-session and from-name and touches the class not at all. */
export const peerSendParams = z.object({
  target: z.string().min(1),
  message: z.string().min(1),
  priority: z.enum(["now", "next", "later"]).optional(),
  fromThreadId: z.string().min(1).optional(),
});

/** `delivered` is a literal false, not a status: this method reports that the frame was WRITTEN. The CLI
 *  tells a sender nothing on the success path, so any other value would be the wire's own lie. */
export const peerSendResult = z.object({
  msgId: z.string(),
  address: z.string(),
  targetSessionId: z.string().optional(),
  delivered: z.literal(false),
  statusReachable: z.boolean(),
});

export const crossSessionInboundSetParams = z.object({
  threadId: z.string().min(1),
  value: z.enum(CROSS_SESSION_INBOUND),
});
export const crossSessionInboundSetResult = z.object({ ok: z.literal(true) });
```

In `src/appserver/schema/core.ts`, add the marker to `initializeResult` (it currently ends with `dynamicTools: z.literal(true),`):

```ts
  dynamicTools: z.literal(true),
  // M8's marker, for the same reason `dynamicTools` exists: `crossSessionInbound` rides an OPTIONAL param
  // on thread/start, and an older server's `z.object` STRIPS an optional param it has never heard of —
  // starting the thread with mode parity still in force, no error, and no signal. A client that means to
  // rely on the policy must treat this marker's absence as "this server cannot enforce it".
  crossSession: z.literal(true),
```

In `src/appserver/schema/index.ts`, add the import and three entries (place them after the `tool/callResult` entry, keeping registration order = the scorecard's listing order):

```ts
import { peerListParams, peerListResult, peerSendParams, peerSendResult, crossSessionInboundSetParams, crossSessionInboundSetResult } from "./peer.js";
```
```ts
  "peer/list": { params: peerListParams, result: peerListResult },
  "peer/send": { params: peerSendParams, result: peerSendResult },
  "thread/crossSessionInbound/set": { params: crossSessionInboundSetParams, result: crossSessionInboundSetResult },
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run test/unit/appserver/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/appserver/schema/peer.ts src/appserver/schema/index.ts src/appserver/schema/core.ts test/unit/appserver/schema.test.ts
git commit -m "feat(appserver): register the peer domain's schemas and the crossSession marker"
```

---

### Task 6: `peer/list` and `peer/send`, wired to the gateway

**Files:**
- Create: `src/appserver/peerDomain.ts`
- Modify: `src/appserver/server.ts`
- Test: `test/unit/appserver/peer-domain.test.ts`

**Interfaces:**
- Consumes: from Task 1: `parseAddress`, `sameNamespace`, `buildEnvelope`, `MAX_FRAME_CHARS`, `UNSAFE_ATTR_CHARS`; from Task 2: `readPeerRows`, `peerTokenFor`, `PeerRow`; from Task 3: `ReceiptMap`; from Task 4: `PeerGateway`; from Task 5: the schemas.
- Produces:
  - `peerList: Handler`, `peerSend: Handler`
  - On `AppServerDeps`: `peerGateway?: PeerGateway | null`, `readPeerRows?: typeof readPeerRows`, `peerEnv?: NodeJS.ProcessEnv`
  - On `AppServer`: `readonly receipts: ReceiptMap`, `gateway(): PeerGateway | undefined`

- [ ] **Step 1: Write the failing test**

Create `test/unit/appserver/peer-domain.test.ts`:

```ts
// test/unit/appserver/peer-domain.test.ts — the two outbound methods through the REAL AppServer RPC
// surface (the house pattern: mkSink/send/parsed/init, as in settings.test.ts), with the gateway and the
// roster injected so nothing here touches a real socket or a real home directory.
import { describe, it, expect } from "vitest";
import { AppServer } from "../../../src/appserver/server.js";
import { ERR } from "../../../src/appserver/rpc.js";
import type { PeerSink } from "../../../src/appserver/peer.js";
import type { PeerRow } from "../../../src/peer/roster.js";

const mkSink = () => { const lines: string[] = []; return { lines, sink: { write: (l: string) => void lines.push(l), buffered: () => 0, end: () => {} } as PeerSink }; };
const send = (c: { feed(ch: string): void }, obj: object) => c.feed(JSON.stringify(obj) + "\n");
const parsed = (lines: string[]) => lines.map((l) => JSON.parse(l));
const tick = () => new Promise((r) => setTimeout(r, 0));
const init = (c: { feed(ch: string): void }, id: number, name = "t") => send(c, { id, method: "initialize", params: { clientInfo: { name } } });

const ROW = (over: Partial<PeerRow> = {}): PeerRow => ({ address: "uds:/sock/11.sock", pid: 11, sessionId: "s-1", name: "peer-one", alive: true, inboxBound: true, ...over });

/** A gateway stand-in: same shape, records what was written, never opens a socket. */
function fakeGateway(socketPath = "/sock/99.sock") {
  const sent: Array<{ socketPath: string; frames: unknown[] }> = [];
  return {
    sent,
    gw: {
      socketPath,
      address: `uds:${socketPath}`,
      configRoot: "/cfg",
      sendFrames: async (p: string, frames: unknown[]) => { sent.push({ socketPath: p, frames }); return "CLOSED" as const; },
      close: async () => {},
    } as any,
  };
}

function boot(rows: PeerRow[], gwPath = "/sock/99.sock") {
  const { gw, sent } = fakeGateway(gwPath);
  const srv = new AppServer({}, {
    sessionFactory: () => ({ submit: async () => ({ result: {} }), interrupt: async () => ({}), dispose: async () => {}, onFrame: () => () => {}, sessionId: "sess-1" }) as any,
    listSessions: async () => [],
    peerGateway: gw,
    readPeerRows: async () => rows,
    peerEnv: { CLAUDE_CONFIG_DIR: "/cfg" } as NodeJS.ProcessEnv,
  } as any);
  const a = mkSink(); const conn = srv.connect(a.sink);
  init(conn, 1);
  return { srv, a, conn, sent };
}

describe("peer/list", () => {
  it("projects rows and marks status reachability by namespace", async () => {
    const { a, conn } = boot([ROW(), ROW({ address: "uds:/other/12.sock", pid: 12 })]);
    send(conn, { id: 2, method: "peer/list", params: {} });
    await tick();
    const peers = parsed(a.lines).find((f) => f.id === 2).result.peers;
    expect(peers.find((p: any) => p.pid === 11).statusReachable).toBe(true);
    expect(peers.find((p: any) => p.pid === 12).statusReachable).toBe(false);
  });

  it("lists dead rows by default and drops them under aliveOnly", async () => {
    const rows = [ROW(), ROW({ pid: 12, address: "uds:/sock/12.sock", alive: false })];
    const { a, conn } = boot(rows);
    send(conn, { id: 2, method: "peer/list", params: {} });
    send(conn, { id: 3, method: "peer/list", params: { aliveOnly: true } });
    await tick();
    expect(parsed(a.lines).find((f) => f.id === 2).result.peers).toHaveLength(2);
    expect(parsed(a.lines).find((f) => f.id === 3).result.peers).toHaveLength(1);
  });

  it("marks the rows this server hosts with their threadId", async () => {
    const { srv, a, conn } = boot([ROW()]);
    send(conn, { id: 2, method: "thread/start", params: {} });
    await tick();
    const threadId = parsed(a.lines).find((f) => f.id === 2).result.thread.id;
    srv.registry.get(threadId)!.sessionId = "s-1";
    send(conn, { id: 3, method: "peer/list", params: {} });
    await tick();
    expect(parsed(a.lines).find((f) => f.id === 3).result.peers[0].threadId).toBe(threadId);
  });
});

describe("peer/send", () => {
  it("resolves a target, writes an enveloped frame, and reports written-not-delivered", async () => {
    const { a, conn, sent } = boot([ROW()]);
    send(conn, { id: 2, method: "peer/send", params: { target: "s-1", message: "hello there" } });
    await tick();
    const res = parsed(a.lines).find((f) => f.id === 2).result;
    expect(res.delivered).toBe(false);
    expect(res.statusReachable).toBe(true);
    expect(res.msgId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(sent[0].socketPath).toBe("/sock/11.sock");
    const user = sent[0].frames.find((f: any) => f.type === "user") as any;
    expect(user.priority).toBe("next");
    expect(user.msg_id).toBe(res.msgId);
    expect(user.message.content).toContain('from-mode="prompting"');
    expect(user.message.content).not.toContain("hop-chain");
  });

  it("passes the requested priority through", async () => {
    const { conn, sent } = boot([ROW()]);
    send(conn, { id: 2, method: "peer/send", params: { target: "s-1", message: "hi", priority: "later" } });
    await tick();
    expect((sent[0].frames.find((f: any) => f.type === "user") as any).priority).toBe("later");
  });

  it("asserts prompting even when attributed to a bypassPermissions thread", async () => {
    const { srv, a, conn, sent } = boot([ROW()]);
    send(conn, { id: 2, method: "thread/start", params: { config: { permissionMode: "bypassPermissions" } } });
    await tick();
    const threadId = parsed(a.lines).find((f) => f.id === 2).result.thread.id;
    const rec = srv.registry.get(threadId)!;
    rec.sessionId = "mine-1"; rec.title = "my thread";
    send(conn, { id: 3, method: "peer/send", params: { target: "s-1", message: "hi", fromThreadId: threadId } });
    await tick();
    const content = (sent[0].frames.find((f: any) => f.type === "user") as any).message.content as string;
    expect(content).toContain('from-mode="prompting"');
    expect(content).toContain('from-session="mine-1"');
    expect(content).not.toContain("bypass");
  });

  it("refuses an ambiguous target and names the matches", async () => {
    const { a, conn } = boot([ROW({ name: "dup", pid: 11 }), ROW({ name: "dup", pid: 12, address: "uds:/sock/12.sock" })]);
    send(conn, { id: 2, method: "peer/send", params: { target: "dup", message: "hi" } });
    await tick();
    const err = parsed(a.lines).find((f) => f.id === 2).error;
    expect(err.code).toBe(ERR.INVALID_PARAMS);
    expect(err.message).toContain("uds:/sock/11.sock");
    expect(err.message).toContain("uds:/sock/12.sock");
  });

  it("refuses an unresolvable target and a bridge: address by name", async () => {
    const { a, conn } = boot([ROW()]);
    send(conn, { id: 2, method: "peer/send", params: { target: "nobody", message: "hi" } });
    send(conn, { id: 3, method: "peer/send", params: { target: "bridge:x", message: "hi" } });
    await tick();
    expect(parsed(a.lines).find((f) => f.id === 2).error.code).toBe(ERR.INVALID_PARAMS);
    expect(parsed(a.lines).find((f) => f.id === 3).error.message).toContain("bridge:");
  });

  it("refuses an over-cap message, naming the size and the limit", async () => {
    const { a, conn } = boot([ROW()]);
    send(conn, { id: 2, method: "peer/send", params: { target: "s-1", message: "x".repeat(70_000) } });
    await tick();
    const err = parsed(a.lines).find((f) => f.id === 2).error;
    expect(err.code).toBe(ERR.INVALID_PARAMS);
    expect(err.message).toMatch(/60000/);
  });

  it("refuses a control character in an attributed thread name rather than downgrading the envelope", async () => {
    const { srv, a, conn } = boot([ROW()]);
    send(conn, { id: 2, method: "thread/start", params: {} });
    await tick();
    const threadId = parsed(a.lines).find((f) => f.id === 2).result.thread.id;
    srv.registry.get(threadId)!.title = "bad\nname";
    send(conn, { id: 3, method: "peer/send", params: { target: "s-1", message: "hi", fromThreadId: threadId } });
    await tick();
    expect(parsed(a.lines).find((f) => f.id === 3).error.code).toBe(ERR.INVALID_PARAMS);
  });

  it("answers -33008 when no gateway is bound", async () => {
    const srv = new AppServer({}, { listSessions: async () => [], peerGateway: null, readPeerRows: async () => [ROW()] } as any);
    const a = mkSink(); const conn = srv.connect(a.sink);
    init(conn, 1);
    send(conn, { id: 2, method: "peer/send", params: { target: "s-1", message: "hi" } });
    await tick();
    expect(parsed(a.lines).find((f) => f.id === 2).error.code).toBe(ERR.ATTACH_FAILED);
  });

  it("routes a later receipt to the sending connection and drops it once that connection is gone", async () => {
    const { srv, a, conn } = boot([ROW()]);
    send(conn, { id: 2, method: "peer/send", params: { target: "s-1", message: "hi" } });
    await tick();
    const msgId = parsed(a.lines).find((f) => f.id === 2).result.msgId;
    srv.receipts.route({ orig_msg_id: msgId, status: "held", reason: "parity", from: "uds:/sock/11.sock" });
    const note = parsed(a.lines).find((f) => f.method === "peer/messageStatus");
    expect(note.params).toMatchObject({ msgId, status: "held", from: "uds:/sock/11.sock" });
    // A second send whose connection then closes must not throw when its receipt arrives.
    send(conn, { id: 3, method: "peer/send", params: { target: "s-1", message: "hi again" } });
    await tick();
    const msgId2 = parsed(a.lines).find((f) => f.id === 3).result.msgId;
    conn.close();
    expect(() => srv.receipts.route({ orig_msg_id: msgId2, status: "expired", from: "uds:/sock/11.sock" })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/unit/appserver/peer-domain.test.ts`
Expected: FAIL — the methods are not registered, so every reply is a method-not-found error.

- [ ] **Step 3: Write the handlers**

Create `src/appserver/peerDomain.ts`:

```ts
// appserver/peerDomain.ts — `peer/list` and `peer/send`. Both are SERVER-scoped: they name no thread, so
// they bypass the -33005 engine-gone and origin gates, exactly as `fleet/list` and `config/*` do.
import { randomUUID } from "node:crypto";
import { ERR } from "./rpc.js";
import type { AppServer, Handler } from "./server.js";
import { peerListParams, peerSendParams } from "./schema/peer.js";
import { buildEnvelope, MAX_FRAME_CHARS, parseAddress, sameNamespace, UNSAFE_ATTR_CHARS } from "../peer/address.js";
import { peerTokenFor, type PeerRow } from "../peer/roster.js";

/** Rows plus the two things only this server can add: which of them it holds, and whether a status could
 *  ever come back from them. */
async function rows(srv: AppServer): Promise<Array<PeerRow & { threadId?: string; statusReachable: boolean }>> {
  const gw = srv.gateway();
  const held = new Map<string, string>();
  for (const r of srv.registry.list()) if (r.sessionId) held.set(r.sessionId, r.id);
  const raw = await srv.peerRows();
  return raw.map((r) => {
    const parsedAddr = parseAddress(r.address);
    const reachable = Boolean(gw) && parsedAddr?.kind === "uds" && sameNamespace(parsedAddr.path, gw!.socketPath);
    const threadId = r.sessionId ? held.get(r.sessionId) : undefined;
    return { ...r, ...(threadId ? { threadId } : {}), statusReachable: reachable };
  });
}

export const peerList: Handler = async (srv, ctx, id, params) => {
  const parsed = peerListParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const all = await rows(srv);
  ctx.peer.reply(id, { peers: parsed.data.aliveOnly ? all.filter((p) => p.alive) : all });
};

export const peerSend: Handler = async (srv, ctx, id, params) => {
  const parsed = peerSendParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const gw = srv.gateway();
  if (!gw) { ctx.peer.replyError(id, ERR.ATTACH_FAILED, "peer gateway unavailable — this server bound no reply address"); return; }
  const { target, message, priority, fromThreadId } = parsed.data;

  const direct = parseAddress(target);
  if (direct?.kind === "bridge") { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "bridge: addresses are the cross-machine path and are not supported"); return; }

  // Resolution copies `thread/attach`'s rule exactly: a SIMULTANEOUS filter, where more than one match is
  // an error carrying the matches rather than a precedence. A wrong guess delivers into somebody else's
  // session, which no default is worth.
  const all = await rows(srv);
  const matches = all.filter((p) => p.sessionId === target || String(p.pid) === target || p.address === target || p.name === target);
  if (matches.length === 0) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, `no peer matches ${JSON.stringify(target)}`); return; }
  if (matches.length > 1) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, `ambiguous target ${JSON.stringify(target)}: ${matches.map((m) => m.address).join(", ")}`); return; }
  const peer = matches[0];
  const addr = parseAddress(peer.address);
  if (addr?.kind !== "uds") { ctx.peer.replyError(id, ERR.INVALID_PARAMS, `peer has no usable address: ${peer.address}`); return; }

  // Attribution ONLY. `from` stays the gateway's address (receipts come back over a connection whose pid
  // the kernel checks, so no other value could receive them) and `from-mode` is decided by the envelope
  // builder, which offers no way to ask for anything but "prompting".
  let fromSession: string | undefined;
  let fromName: string | undefined;
  if (fromThreadId) {
    const rec = srv.registry.get(fromThreadId);
    if (!rec) { ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return; }
    if (rec.origin === "fleet") { ctx.peer.replyError(id, ERR.UNSUPPORTED_FOR_ORIGIN, "unsupported for fleet-origin threads"); return; }
    fromSession = rec.sessionId;
    fromName = rec.title;
  }
  for (const [what, value] of [["from-session", fromSession], ["from-name", fromName]] as const) {
    if (value !== undefined && UNSAFE_ATTR_CHARS.test(value)) {
      // Refusing beats sending: an unescapable character makes the receiver's parse-and-reserialize
      // disagree with ours, which silently downgrades the envelope to plain text and drops the
      // attribution — a permission decision made on wrong information.
      ctx.peer.replyError(id, ERR.INVALID_PARAMS, `${what} contains a character that cannot ride an envelope attribute`);
      return;
    }
  }

  const body = buildEnvelope({ from: gw.address, ...(fromSession ? { fromSession } : {}), ...(fromName ? { fromName } : {}) })(message);
  if (body.length > MAX_FRAME_CHARS) {
    ctx.peer.replyError(id, ERR.INVALID_PARAMS, `message too large for cross-session delivery: ${body.length} characters, limit ${MAX_FRAME_CHARS}`);
    return;
  }

  // A UUID, always, and never the client's: a non-UUID msg_id comes back with no `orig_msg_id` on the
  // receipt, so nothing correlates and the status channel silently stops working (probe 117b Q4).
  const msgId = randomUUID();
  const token = peerTokenFor(addr.path, peer.pid, srv.peerEnv());
  const frames: unknown[] = [];
  if (token) frames.push({ type: "auth", token });
  frames.push({
    type: "user",
    ...(peer.sessionId ? { session_id: peer.sessionId } : {}),
    from: gw.address,
    message: { content: body },
    priority: priority ?? "next",
    msg_id: msgId,
  });
  srv.receipts.track(msgId, ctx);
  await gw.sendFrames(addr.path, frames);
  ctx.peer.reply(id, {
    msgId,
    address: peer.address,
    ...(peer.sessionId ? { targetSessionId: peer.sessionId } : {}),
    delivered: false,
    statusReachable: peer.statusReachable,
  });
};
```

In `src/appserver/server.ts`:

1. Add to the imports:
```ts
import { peerList, peerSend } from "./peerDomain.js";
import { ReceiptMap } from "../peer/receipts.js";
import { readPeerRows as realReadPeerRows, type PeerRow } from "../peer/roster.js";
import type { PeerGateway } from "../peer/gateway.js";
```

2. Add to `AppServerDeps` (after `imageStages?`):
```ts
  /** The bound gateway, or `null` to declare deliberately-absent (tests, and a server that could not
   *  bind). Undefined means "not wired yet" and is treated the same as null. */
  peerGateway?: PeerGateway | null;
  readPeerRows?: (env?: NodeJS.ProcessEnv) => Promise<PeerRow[]>;
  peerEnv?: NodeJS.ProcessEnv;
```

3. Add to the handlers table, beside `fleet/list` / `thread/attach`:
```ts
    // M8 (§ peer domain): server-scoped like their fleet neighbours — no threadId, so neither passes the
    // -33005 or origin gates.
    "peer/list": peerList,
    "peer/send": peerSend,
```

4. Add the fields and accessors to `AppServer` (beside `imageStages`):
```ts
  readonly receipts: ReceiptMap<ConnCtx>;
```
and in the constructor, after the `imageStages` line:
```ts
    this.receipts = new ReceiptMap<ConnCtx>({
      deliver: (conn, msgId, status, reason, from) => {
        try { conn.peer.notify("peer/messageStatus", { msgId, status, ...(reason ? { reason } : {}), from, receivedAt: Math.floor(Date.now() / 1000) }); } catch { /* the connection went away mid-notify */ }
      },
    });
```
plus the field and accessors:
```ts
  /** The bound gateway, or undefined when none is. `null` in deps means the same thing and is how a test
   *  or a failed bind says so explicitly. */
  gateway(): PeerGateway | undefined { return this.deps.peerGateway ?? undefined; }
  peerEnv(): NodeJS.ProcessEnv { return this.deps.peerEnv ?? process.env; }
  peerRows(): Promise<PeerRow[]> { return (this.deps.readPeerRows ?? realReadPeerRows)(this.peerEnv()); }
```

5. In `connect()`'s `close` callback — the one that already reads
   `this.conns.delete(connId); … this.imageStages.dropConnection(…)`, and for the same reason: a socket
   that dies must not leave this server holding state the client will never come back to claim — add:
```ts
    this.receipts.dropConnection(connId);
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run test/unit/appserver/peer-domain.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Run the whole appserver suite for regressions, then typecheck**

Run: `npx vitest run test/unit/appserver && npx tsc --noEmit`
Expected: all green; no tsc output.

- [ ] **Step 6: Commit**

```bash
git add src/appserver/peerDomain.ts src/appserver/server.ts test/unit/appserver/peer-domain.test.ts
git commit -m "feat(appserver): peer/list and peer/send, written-not-delivered"
```

---

### Task 7: Bind the gateway into the server's lifecycle

**Files:**
- Modify: `src/appserver/server.ts`
- Test: `test/unit/appserver/peer-domain.test.ts` (extend)

**Interfaces:**
- Consumes: from Task 4: `PeerGateway`; from Task 6: `AppServer.receipts`.
- Produces: `AppServer.bindGateway(): Promise<void>` and gateway teardown inside `shutdown()`.

- [ ] **Step 1: Write the failing test**

Append to `test/unit/appserver/peer-domain.test.ts`:

```ts
describe("gateway lifecycle", () => {
  it("routes gateway receipts through the receipt map, and closes the gateway on shutdown", async () => {
    let closed = false;
    const received: Array<(f: Record<string, unknown>) => void> = [];
    const gw = {
      socketPath: "/sock/99.sock", address: "uds:/sock/99.sock", configRoot: "/cfg",
      sendFrames: async () => "CLOSED" as const,
      close: async () => { closed = true; },
    } as any;
    const srv = new AppServer({}, { listSessions: async () => [], peerGateway: gw, readPeerRows: async () => [] } as any);
    void received;
    await srv.shutdown();
    expect(closed).toBe(true);
  });

  it("sweeps the receipt map on shutdown rather than leaving entries unanswered", async () => {
    const srv = new AppServer({}, { listSessions: async () => [], peerGateway: null, readPeerRows: async () => [] } as any);
    srv.receipts.track("m-1", 1);
    await srv.shutdown();
    expect(srv.receipts.size()).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/unit/appserver/peer-domain.test.ts -t "gateway lifecycle"`
Expected: FAIL — `closed` stays false; `receipts.size()` stays 1.

- [ ] **Step 3: Write the implementation**

In `src/appserver/server.ts`, add the binder (near `connect`):

```ts
  /** Bind the peer gateway, once, at startup. Never throws: a server whose gateway cannot bind still runs
   *  and answers every peer method -33008. The whole inbound fabric sits behind a server-side feature gate
   *  that can turn off without an SDK release, so degrading is the baseline rather than the error path. */
  async bindGateway(): Promise<void> {
    if (this.deps.peerGateway !== undefined) return; // already supplied (a test, or a caller that bound it)
    const gw = await PeerGateway.bind({
      onReceipt: (frame) => { this.receipts.route(frame); },
      onStrayFrame: (kind) => {
        // The gateway is a reply address, not a session. A frame that assumes otherwise is worth saying
        // out loud rather than dropping in silence.
        for (const c of this.conns.values()) this.warn(c.peer, "peerStrayFrame", `ignored a ${kind} frame on the peer gateway — it is a reply address, not a session`);
      },
    }, { env: this.peerEnv() });
    (this.deps as AppServerDeps).peerGateway = gw ?? null;
  }
```

and in `shutdown()`, before the `Promise.all` over threads:

```ts
    this.receipts.sweep(0);              // every still-tracked message is told, rather than forgotten
    await this.deps.peerGateway?.close();
```

Give `ReceiptMap.sweep` an optional override so shutdown can expire everything:

```ts
  sweep(retentionMs: number = this.retentionMs): void {
    const cutoff = this.now() - retentionMs;
```

Add the import of `PeerGateway` as a value (it is currently type-only):
```ts
import { PeerGateway } from "../peer/gateway.js";
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run test/unit/appserver/peer-domain.test.ts && npx vitest run test/unit/peer`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/appserver/server.ts src/peer/receipts.ts test/unit/appserver/peer-domain.test.ts
git commit -m "feat(appserver): bind the peer gateway into the server lifecycle"
```

---

# STAGE B — the inbound half

---

### Task 8: Inbound policy — injection, the sanitizer, the reservation, and the setter

**Files:**
- Create: `src/appserver/peerPolicy.ts`
- Modify: `src/appserver/settings.ts`, `src/appserver/server.ts`, `src/appserver/registry.ts`
- Test: `test/unit/appserver/peer-policy.test.ts`

**Interfaces:**
- Consumes: from Task 5: `crossSessionInboundSetParams`, `CROSS_SESSION_INBOUND`.
- Produces:
  - `type CrossSessionInbound = "accept" | "hold" | "refuse"`
  - `DEFAULT_INBOUND: CrossSessionInbound` (`"refuse"`)
  - `applyPeerPolicy(config: Record<string, unknown>, value: CrossSessionInbound): Record<string, unknown>`
  - `crossSessionInboundSet: Handler`
  - On `ThreadRecord`: `crossSessionInbound: CrossSessionInbound`

- [ ] **Step 1: Write the failing test**

Create `test/unit/appserver/peer-policy.test.ts`:

```ts
// test/unit/appserver/peer-policy.test.ts — the policy's four doors. The property under test is not "the
// key is set" but "nothing else can decide it": not a settings file on disk, not a client's escape hatch,
// not a later RPC, and not an engine swap.
import { describe, it, expect } from "vitest";
import { AppServer } from "../../../src/appserver/server.js";
import { ERR } from "../../../src/appserver/rpc.js";
import { applyPeerPolicy, DEFAULT_INBOUND } from "../../../src/appserver/peerPolicy.js";
import type { PeerSink } from "../../../src/appserver/peer.js";

const mkSink = () => { const lines: string[] = []; return { lines, sink: { write: (l: string) => void lines.push(l), buffered: () => 0, end: () => {} } as PeerSink }; };
const send = (c: { feed(ch: string): void }, obj: object) => c.feed(JSON.stringify(obj) + "\n");
const parsed = (lines: string[]) => lines.map((l) => JSON.parse(l));
const tick = () => new Promise((r) => setTimeout(r, 0));
const init = (c: { feed(ch: string): void }, id: number) => send(c, { id, method: "initialize", params: { clientInfo: { name: "t" } } });

describe("applyPeerPolicy", () => {
  it("defaults to refuse and always writes the key explicitly", () => {
    expect(DEFAULT_INBOUND).toBe("refuse");
    const out = applyPeerPolicy({}, "refuse");
    expect((out.settings as any).crossSessionInbound).toBe("refuse");
  });

  it("passes --replay-user-messages on EVERY thread, including a refusing one", () => {
    for (const v of ["accept", "refuse"] as const) {
      expect((applyPeerPolicy({}, v).extraArgs as any)["replay-user-messages"]).toBeNull();
    }
  });

  it("MERGES a client's settings rather than dropping them", () => {
    const out = applyPeerPolicy({ settings: { autoCompactEnabled: true, crossSessionInbound: "accept" } }, "refuse");
    expect(out.settings).toEqual({ autoCompactEnabled: true, crossSessionInbound: "refuse" });
  });

  it("overrides the key in every carrier a client can reach", () => {
    const out = applyPeerPolicy({
      settings: { crossSessionInbound: "accept" },
      extraArgs: { settings: JSON.stringify({ crossSessionInbound: "accept" }) },
      extraOptions: {
        settings: { crossSessionInbound: "accept" },
        extraArgs: { settings: JSON.stringify({ crossSessionInbound: "accept" }) },
      },
    }, "refuse");
    expect((out.settings as any).crossSessionInbound).toBe("refuse");
    expect(JSON.parse((out.extraArgs as any).settings).crossSessionInbound).toBe("refuse");
    const hatch = out.extraOptions as any;
    expect(hatch.settings.crossSessionInbound).toBe("refuse");
    expect(JSON.parse(hatch.extraArgs.settings).crossSessionInbound).toBe("refuse");
  });

  it("handles the equals-encoding of an argv settings key", () => {
    const out = applyPeerPolicy({ extraArgs: { "settings={\"crossSessionInbound\":\"accept\"}": null } }, "refuse");
    const args = out.extraArgs as Record<string, unknown>;
    const key = Object.keys(args).find((k) => k.startsWith("settings"));
    const json = key!.includes("=") ? key!.slice(key!.indexOf("=") + 1) : String(args[key!]);
    expect(JSON.parse(json).crossSessionInbound).toBe("refuse");
  });

  it("throws on an unparseable client settings string rather than discarding it", () => {
    expect(() => applyPeerPolicy({ extraArgs: { settings: "{not json" } }, "refuse")).toThrow(/settings/);
  });

  it("strips a client-supplied replay-user-messages, which is ours now", () => {
    const out = applyPeerPolicy({ extraArgs: { "replay-user-messages": null, verbose: null } }, "accept");
    expect((out.extraArgs as any).verbose).toBeNull();
    expect(Object.keys(out.extraArgs as object).filter((k) => k === "replay-user-messages")).toHaveLength(1);
  });
});

function boot() {
  const applied: Array<Record<string, unknown>> = [];
  const configs: Array<Record<string, unknown>> = [];
  const srv = new AppServer({}, {
    sessionFactory: (config: Record<string, unknown>) => {
      configs.push(config);
      return { submit: async () => ({ result: {} }), interrupt: async () => ({}), dispose: async () => {}, onFrame: () => () => {}, sessionId: "sess-1",
        applyFlagSettings: async (s: Record<string, unknown>) => { applied.push(s); } } as any;
    },
    listSessions: async () => [],
    peerGateway: null,
  } as any);
  const a = mkSink(); const conn = srv.connect(a.sink);
  init(conn, 1);
  return { srv, a, conn, applied, configs };
}

describe("the policy on the wire", () => {
  it("writes refuse into the start config when the client asks for nothing", async () => {
    const { conn, configs } = boot();
    send(conn, { id: 2, method: "thread/start", params: {} });
    await tick();
    expect((configs[0].settings as any).crossSessionInbound).toBe("refuse");
  });

  it("honours an explicit value at thread/start", async () => {
    const { conn, configs } = boot();
    send(conn, { id: 2, method: "thread/start", params: { crossSessionInbound: "accept" } });
    await tick();
    expect((configs[0].settings as any).crossSessionInbound).toBe("accept");
  });

  it("REFUSES crossSessionInbound through the generic settings RPC", async () => {
    const { a, conn, applied } = boot();
    send(conn, { id: 2, method: "thread/start", params: {} });
    await tick();
    const threadId = parsed(a.lines).find((f) => f.id === 2).result.thread.id;
    send(conn, { id: 3, method: "thread/settings/apply", params: { threadId, settings: { crossSessionInbound: "accept" } } });
    await tick();
    const err = parsed(a.lines).find((f) => f.id === 3).error;
    expect(err.code).toBe(ERR.INVALID_PARAMS);
    expect(err.message).toContain("crossSessionInbound");
    expect(applied).toEqual([]);
  });

  it("still applies unrelated settings through the generic RPC", async () => {
    const { a, conn, applied } = boot();
    send(conn, { id: 2, method: "thread/start", params: {} });
    await tick();
    const threadId = parsed(a.lines).find((f) => f.id === 2).result.thread.id;
    send(conn, { id: 3, method: "thread/settings/apply", params: { threadId, settings: { autoCompactEnabled: true } } });
    await tick();
    expect(applied).toEqual([{ autoCompactEnabled: true }]);
  });

  it("changes the policy through the dedicated setter, engine first, and broadcasts", async () => {
    const { srv, a, conn, applied } = boot();
    send(conn, { id: 2, method: "thread/start", params: {} });
    await tick();
    const threadId = parsed(a.lines).find((f) => f.id === 2).result.thread.id;
    send(conn, { id: 90, method: "thread/subscribe", params: { threadId } });
    await tick();
    a.lines.length = 0;
    send(conn, { id: 3, method: "thread/crossSessionInbound/set", params: { threadId, value: "accept" } });
    await tick();
    expect(parsed(a.lines).find((f) => f.id === 3).result).toEqual({ ok: true });
    expect(applied).toEqual([{ crossSessionInbound: "accept" }]);
    expect(srv.registry.get(threadId)!.crossSessionInbound).toBe("accept");
    expect(parsed(a.lines).some((f) => f.method === "thread/settings/changed")).toBe(true);
  });

  it("does NOT commit to the record when the engine rejects the change", async () => {
    const srv = new AppServer({}, {
      sessionFactory: () => ({ submit: async () => ({ result: {} }), interrupt: async () => ({}), dispose: async () => {}, onFrame: () => () => {}, sessionId: "s",
        applyFlagSettings: async () => { throw new Error("engine said no"); } }) as any,
      listSessions: async () => [], peerGateway: null,
    } as any);
    const a = mkSink(); const conn = srv.connect(a.sink);
    init(conn, 1);
    send(conn, { id: 2, method: "thread/start", params: {} });
    await tick();
    const threadId = parsed(a.lines).find((f) => f.id === 2).result.thread.id;
    send(conn, { id: 3, method: "thread/crossSessionInbound/set", params: { threadId, value: "accept" } });
    await tick();
    expect(parsed(a.lines).find((f) => f.id === 3).error).toBeDefined();
    expect(srv.registry.get(threadId)!.crossSessionInbound).toBe("refuse");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/unit/appserver/peer-policy.test.ts`
Expected: FAIL — `src/appserver/peerPolicy.js` does not resolve.

- [ ] **Step 3: Write the implementation**

Create `src/appserver/peerPolicy.ts`:

```ts
// appserver/peerPolicy.ts — who decides whether a hosted thread receives peer mail.
//
// The answer is: this server, and nothing else. Not a settings file on disk (an explicit flag-layer value
// beats mode parity in BOTH directions, measured in probe 117), not a client's escape hatch, not a later
// RPC, and not an engine swap. The policy is written EXPLICITLY for every value including the default,
// because an unwritten key lets something else decide.
import { ERR } from "./rpc.js";
import type { Handler } from "./server.js";
import { crossSessionInboundSetParams } from "./schema/peer.js";

export type CrossSessionInbound = "accept" | "hold" | "refuse";

/** Default REFUSE. A server product does not take turn-consuming injections no client asked for, and
 *  `hold` on a hosted thread is a DELAYED refuse anyway — the CLI says so in its own words
 *  (`headless: held peer message expired (no approval surface)`, probe 117b). */
export const DEFAULT_INBOUND: CrossSessionInbound = "refuse";

const SETTINGS_KEY = "crossSessionInbound";
const REPLAY_FLAG = "replay-user-messages";

function overrideJsonArg(args: Record<string, unknown>, value: CrossSessionInbound): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (k === REPLAY_FLAG) continue;                       // ours now; re-added unconditionally below
    const base = k.split("=")[0];
    if (base !== "settings") { out[k] = v; continue; }
    // Both argv encodings: `settings <json>` and `settings=<json>`.
    const raw = k.includes("=") ? k.slice(k.indexOf("=") + 1) : typeof v === "string" ? v : "";
    let obj: Record<string, unknown>;
    try { obj = raw ? JSON.parse(raw) as Record<string, unknown> : {}; }
    catch { throw new Error(`client settings could not be parsed, so the server's ${SETTINGS_KEY} policy could not be asserted over it`); }
    obj[SETTINGS_KEY] = value;
    out["settings"] = JSON.stringify(obj);
  }
  out[REPLAY_FLAG] = null;
  return out;
}

/** Assert the policy over EVERY carrier a client's options can reach the CLI through, after the final
 *  merge rather than per-site: `config.settings`, `extraOptions.settings` (spread LAST in resolveOptions,
 *  so it wins), `extraArgs.settings`, `extraOptions.extraArgs.settings` (which REPLACES the sanitized
 *  top-level map rather than merging), and the equals-encoding of either argv form. A guard that covers
 *  some carriers covers none.
 *
 *  A MERGE, never a strip: removing the whole `settings` key would silently delete unrelated SDK settings
 *  a client legitimately sent — a configuration regression wearing a policy guard's clothes.
 *
 *  `--replay-user-messages` rides on EVERY hosted thread, not only the accepting ones. It is startup-only
 *  argv, so a thread launched at `refuse` and later moved to `accept` could otherwise take peer input the
 *  model acts on while this server sees no arrival frame at all — invisible injection, and the worst
 *  possible failure for a surface whose whole job is to make inbound traffic visible. */
export function applyPeerPolicy(config: Record<string, unknown>, value: CrossSessionInbound): Record<string, unknown> {
  const out: Record<string, unknown> = { ...config };
  out.settings = { ...(config.settings as Record<string, unknown> | undefined), [SETTINGS_KEY]: value };
  out.extraArgs = overrideJsonArg((config.extraArgs as Record<string, unknown>) ?? {}, value);
  const hatch = config.extraOptions;
  if (hatch && typeof hatch === "object") {
    const h: Record<string, unknown> = { ...(hatch as Record<string, unknown>) };
    if (h.settings && typeof h.settings === "object") h.settings = { ...(h.settings as Record<string, unknown>), [SETTINGS_KEY]: value };
    if (h.extraArgs && typeof h.extraArgs === "object") h.extraArgs = overrideJsonArg(h.extraArgs as Record<string, unknown>, value);
    out.extraOptions = h;
  }
  return out;
}

/** The one deliberate way a policy changes after start. ENGINE FIRST, commit after accept — the rule the
 *  existing flag-layer setters already follow. Committing to the record first would leave it claiming a
 *  policy the engine rejected, and that phantom would become real at the next swap. `record.chain`
 *  already orders this against swaps, so record-first bought nothing. */
export const crossSessionInboundSet: Handler = (srv, ctx, id, params) => {
  const parsed = crossSessionInboundSetParams.safeParse(params);
  if (!parsed.success) { ctx.peer.replyError(id, ERR.INVALID_PARAMS, "Invalid params"); return; }
  const record = srv.registry.get(parsed.data.threadId);
  if (!record) { ctx.peer.replyError(id, ERR.THREAD_NOT_FOUND, "Thread not found"); return; }
  if (record.origin === "fleet") { ctx.peer.replyError(id, ERR.UNSUPPORTED_FOR_ORIGIN, "unsupported for fleet-origin threads"); return; }
  record.chain = record.chain.then(async () => {
    try {
      await record.session.applyFlagSettings?.({ [SETTINGS_KEY]: parsed.data.value });
      record.crossSessionInbound = parsed.data.value;
      ctx.peer.reply(id, { ok: true });
      // The generic settings RPC deliberately announces nothing; a POLICY change is exactly the kind of
      // thing every subscriber should see.
      srv.broadcast(record.id, "thread/settings/changed", { threadId: record.id, crossSessionInbound: parsed.data.value });
    } catch (e) {
      ctx.peer.replyError(id, ERR.INTERNAL, String((e as Error).message ?? e));
    }
  });
};

/** The reservation `thread/settings/apply` enforces: the generic method writes the SAME flag layer this
 *  policy relies on, at runtime, with no mirror write and no broadcast — so leaving it open would let any
 *  initialized connection turn another thread's `refuse` into `accept` and then feed it. */
export const RESERVED_SETTINGS_KEY = SETTINGS_KEY;
```

In `src/appserver/settings.ts`, inside `settingsApply` after the record lookup:

```ts
  if (RESERVED_SETTINGS_KEY in parsed.data.settings) {
    ctx.peer.replyError(id, ERR.INVALID_PARAMS, `${RESERVED_SETTINGS_KEY} is reserved — use thread/crossSessionInbound/set`);
    return;
  }
```
with `import { RESERVED_SETTINGS_KEY } from "./peerPolicy.js";` added.

In `src/appserver/registry.ts`, add to `ThreadRecord` (after `dynamicTools?`):

```ts
  /** M8: the inbound peer policy this thread is RUNNING under, owned by the record rather than by the
   *  launch config. A replacement engine is BUILT with this value (rewind/reopen/clear), because
   *  re-pushing it after the swap leaves a window in which a fresh engine runs the launch policy — and a
   *  best-effort re-push that fails leaves it permanently, failing exactly where the policy matters. */
  crossSessionInbound: CrossSessionInbound;
```
with `import type { CrossSessionInbound } from "./peerPolicy.js";`.

In `src/appserver/server.ts`:
- register `"thread/crossSessionInbound/set": crossSessionInboundSet,` in the handlers table;
- add `crossSessionInbound` to `FLEET_UNSUPPORTED` in `registry.ts` so the dispatch-level origin gate refuses it before the handler runs:
```ts
  "thread/settings/apply", "thread/crossSessionInbound/set", "mcpServer/set",
```
- in `createThread`, read the optional param, seed the record, and run the config through the sanitizer:
```ts
    const inbound = (opts.crossSessionInbound as CrossSessionInbound | undefined) ?? DEFAULT_INBOUND;
    const config = applyPeerPolicy(rawConfig, inbound);
```
and set `crossSessionInbound: inbound` on the record literal;
- in the swap spine (`rewind.ts`'s shared engine rebuild), run the base config through `applyPeerPolicy(base, record.crossSessionInbound)` before the replacement engine is constructed;
- add `crossSessionInbound: z.enum(CROSS_SESSION_INBOUND).optional()` to `threadStartParams` and `threadResumeParams` in `schema/threads.ts`;
- add `crossSession: true` to the `initialize` reply literal.

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run test/unit/appserver/peer-policy.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Regression + typecheck**

Run: `npx vitest run test/unit/appserver && npx tsc --noEmit`
Expected: all green; no tsc output.

- [ ] **Step 6: Commit**

```bash
git add src/appserver/peerPolicy.ts src/appserver/settings.ts src/appserver/registry.ts src/appserver/server.ts src/appserver/schema/threads.ts test/unit/appserver/peer-policy.test.ts
git commit -m "feat(appserver): inbound policy — explicit, merged, reserved, and swap-durable"
```

---

### Task 9: `Session.onUnclaimedResult`

**Files:**
- Modify: `src/session/session.ts`
- Test: `test/unit/session-unclaimed-result.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `Session.onUnclaimedResult(cb: (result: unknown) => boolean): () => void`

- [ ] **Step 1: Write the failing test**

Create `test/unit/session-unclaimed-result.test.ts`:

```ts
// test/unit/session-unclaimed-result.test.ts — the seam an adopted turn's OUTCOME arrives on. The hook
// returns whether it CLAIMED the result, and that boolean is the whole point: without it the design could
// not tell a consumed result from a leaked one, which is the only thing `unmatchedResults` has ever
// measured.
import { describe, it, expect } from "vitest";
import { Session } from "../../src/session/session.js";

/** A query stand-in that yields exactly the frames a test hands it, then ends. */
function fakeQuery(frames: unknown[]) {
  return () => ({
    async *[Symbol.asyncIterator]() { for (const f of frames) yield f; },
  }) as any;
}

describe("onUnclaimedResult", () => {
  it("fires for a result no waiter owns, and a claim suppresses the counter", async () => {
    const seen: unknown[] = [];
    const s = new Session({ query: fakeQuery([{ type: "result", subtype: "success", result: "hi" }]) }, {});
    s.onUnclaimedResult((r) => { seen.push(r); return true; });
    await s.done;
    expect(seen).toHaveLength(1);
    expect(s.unmatchedResults).toBe(0);
  });

  it("still counts a result the hook declines to claim", async () => {
    const s = new Session({ query: fakeQuery([{ type: "result", subtype: "success", result: "hi" }]) }, {});
    s.onUnclaimedResult(() => false);
    await s.done;
    expect(s.unmatchedResults).toBe(1);
  });

  it("counts as before when no hook is installed", async () => {
    const s = new Session({ query: fakeQuery([{ type: "result", subtype: "success", result: "hi" }]) }, {});
    await s.done;
    expect(s.unmatchedResults).toBe(1);
  });

  it("stops firing once unsubscribed", async () => {
    let calls = 0;
    const s = new Session({ query: fakeQuery([{ type: "result", subtype: "success" }, { type: "result", subtype: "success" }]) }, {});
    const off = s.onUnclaimedResult(() => { calls++; off(); return true; });
    await s.done;
    expect(calls).toBe(1);
    expect(s.unmatchedResults).toBe(1);
  });

  it("one hook's throw does not stop the loop or the counter", async () => {
    const s = new Session({ query: fakeQuery([{ type: "result", subtype: "success" }]) }, {});
    s.onUnclaimedResult(() => { throw new Error("boom"); });
    await s.done;
    expect(s.unmatchedResults).toBe(1);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/unit/session-unclaimed-result.test.ts`
Expected: FAIL — `s.onUnclaimedResult is not a function`.

- [ ] **Step 3: Write the implementation**

In `src/session/session.ts`, add the field beside `frameCbs` (`:88`):

```ts
  private unclaimedCbs = new Set<(result: unknown) => boolean>();
```

the subscriber beside `onFrame` (`:309`):

```ts
  /** A result frame that matched NO waiter — which is precisely what a peer-initiated turn's result is,
   *  in every shape probes 118/118b measured. The callback returns whether it CLAIMED the result: a claim
   *  supplies an adopted turn's outcome and suppresses the counter, and anything unclaimed increments it
   *  exactly as before, so `unmatchedResults` keeps its job as the tripwire for results nobody owns. */
  onUnclaimedResult(cb: (result: unknown) => boolean): () => void { this.unclaimedCbs.add(cb); return () => { this.unclaimedCbs.delete(cb); }; }
```

and replace the counter line (`:392`):

```ts
        } else if (mm.type === "result") {
          let claimed = false;
          for (const cb of [...this.unclaimedCbs]) { try { if (cb(m)) claimed = true; } catch { /* one subscriber's failure is not another's */ } }
          if (!claimed) this._unmatchedResults++;
        }
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run test/unit/session-unclaimed-result.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Regression + typecheck**

Run: `npx vitest run test/unit && npx tsc --noEmit`
Expected: all green; no tsc output.

- [ ] **Step 6: Commit**

```bash
git add src/session/session.ts test/unit/session-unclaimed-result.test.ts
git commit -m "feat(session): onUnclaimedResult — a claiming hook at the unmatched-result site"
```

---

### Task 10: Arrival and adoption

**Files:**
- Create: `src/appserver/peerInbound.ts`
- Modify: `src/appserver/registry.ts`, `src/appserver/router.ts`, `src/appserver/server.ts`
- Test: `test/unit/appserver/peer-inbound.test.ts`

**Interfaces:**
- Consumes: from Task 9: `Session.onUnclaimedResult` (through `EngineSession`); from Task 8: `record.crossSessionInbound`.
- Produces:
  - `installPeerInbound(srv: AppServer, record: ThreadRecord): () => void`
  - On `ThreadRecord`: `peerPending: PeerArrival[]`, `adoptedCommandUuid?: string`
  - `interface PeerArrival { uuid: string; origin: Record<string, unknown>; receivedAt: number }`
  - `PEER_PENDING_CAP = 32`
  - On `EngineSession`: `onUnclaimedResult?(cb: (result: unknown) => boolean): () => void`

- [ ] **Step 1: Write the failing test**

Create `test/unit/appserver/peer-inbound.test.ts`:

```ts
// test/unit/appserver/peer-inbound.test.ts — arrival and adoption, driven by the frames the ENGINE emits.
//
// Arrival and execution are separate facts here because measurement made them separate: an inbound
// message becomes its own turn, a follow-up turn, or nothing at all (folded into whatever turn was
// running), and nothing at delivery time predicts which. So the notification fires on the replayed frame,
// and a turn is adopted only when a `command_lifecycle` `started` names a command_uuid this server did
// not submit.
import { describe, it, expect } from "vitest";
import { AppServer } from "../../../src/appserver/server.js";
import type { PeerSink } from "../../../src/appserver/peer.js";

const mkSink = () => { const lines: string[] = []; return { lines, sink: { write: (l: string) => void lines.push(l), buffered: () => 0, end: () => {} } as PeerSink }; };
const send = (c: { feed(ch: string): void }, obj: object) => c.feed(JSON.stringify(obj) + "\n");
const parsed = (lines: string[]) => lines.map((l) => JSON.parse(l));
const tick = () => new Promise((r) => setTimeout(r, 0));
const init = (c: { feed(ch: string): void }, id: number) => send(c, { id, method: "initialize", params: { clientInfo: { name: "t" } } });

const peerOrigin = (msgId = "m-1") => ({ kind: "peer", from: "uds:/sock/1.sock", verifiedPeerPid: 4242, name: "sender", fromMode: "bypass", body: "hello", msg_id: msgId });

/** An engine whose frames a test drives by hand, exposing both seams the design uses. */
function driveableEngine() {
  const frameCbs = new Set<(m: unknown, replay?: true) => void>();
  const unclaimed = new Set<(r: unknown) => boolean>();
  const submitted: string[] = [];
  return {
    emit: (m: unknown) => { for (const cb of [...frameCbs]) cb(m); },
    /** Feed a result the way readLoop would when no waiter owned it. */
    emitUnclaimed: (r: unknown) => { let claimed = false; for (const cb of [...unclaimed]) if (cb(r)) claimed = true; return claimed; },
    submitted,
    engine: {
      submit: async (_p: string, _on: (m: unknown) => void, opts?: { uuid?: string }) => { if (opts?.uuid) submitted.push(opts.uuid); return { result: {} }; },
      interrupt: async () => ({}),
      dispose: async () => {},
      onFrame: (cb: (m: unknown, replay?: true) => void) => { frameCbs.add(cb); return () => frameCbs.delete(cb); },
      onUnclaimedResult: (cb: (r: unknown) => boolean) => { unclaimed.add(cb); return () => unclaimed.delete(cb); },
      sessionId: "sess-1",
    } as any,
  };
}

async function boot() {
  const d = driveableEngine();
  const srv = new AppServer({}, { sessionFactory: () => d.engine, listSessions: async () => [], peerGateway: null } as any);
  const a = mkSink(); const conn = srv.connect(a.sink);
  init(conn, 1);
  send(conn, { id: 2, method: "thread/start", params: { crossSessionInbound: "accept" } });
  await tick();
  const threadId = parsed(a.lines).find((f) => f.id === 2).result.thread.id;
  send(conn, { id: 90, method: "thread/subscribe", params: { threadId } });
  await tick();
  a.lines.length = 0;
  return { srv, a, conn, threadId, d };
}

describe("arrival", () => {
  it("announces a replayed peer frame exactly once, carrying the origin verbatim", async () => {
    const { a, d } = await boot();
    d.emit({ type: "user", isReplay: true, uuid: "cmd-1", origin: peerOrigin(), message: { content: "x" } });
    await tick();
    const notes = parsed(a.lines).filter((f) => f.method === "thread/peerMessage");
    expect(notes).toHaveLength(1);
    expect(notes[0].params.arrivalUuid).toBe("cmd-1");
    expect(notes[0].params.origin).toEqual(peerOrigin());
    expect("turnId" in notes[0].params).toBe(false);
  });

  it("ignores a replayed NON-peer frame and produces no items", async () => {
    const { a, d } = await boot();
    d.emit({ type: "user", isReplay: true, uuid: "own-1", message: { content: "x" } });
    await tick();
    expect(parsed(a.lines)).toEqual([]);
  });

  it("drops the oldest arrival at the cap and warns", async () => {
    const { a, d } = await boot();
    for (let i = 0; i < 33; i++) d.emit({ type: "user", isReplay: true, uuid: `c-${i}`, origin: peerOrigin(`m-${i}`), message: { content: "x" } });
    await tick();
    expect(parsed(a.lines).some((f) => f.method === "warning" && String(f.params.code).includes("peerPending"))).toBe(true);
  });
});

describe("adoption", () => {
  it("adopts on a started naming a command_uuid this server did not submit", async () => {
    const { a, d } = await boot();
    d.emit({ type: "user", isReplay: true, uuid: "cmd-1", origin: peerOrigin(), message: { content: "x" } });
    d.emit({ type: "command_lifecycle", command_uuid: "cmd-1", state: "started" });
    await tick();
    const started = parsed(a.lines).find((f) => f.method === "turn/started");
    expect(started).toBeDefined();
    expect(started.params.origin.kind).toBe("peer");
    // The item follows the edge, per the protocol's existing order.
    const idxStarted = a.lines.findIndex((l) => JSON.parse(l).method === "turn/started");
    const idxItem = a.lines.findIndex((l) => JSON.parse(l).method === "item/completed");
    expect(idxItem).toBeGreaterThan(idxStarted);
  });

  it("adopts NOTHING for a started naming a uuid this server submitted", async () => {
    const { a, conn, threadId, d } = await boot();
    send(conn, { id: 3, method: "turn/start", params: { threadId, input: "hello" } });
    await tick();
    a.lines.length = 0;
    d.emit({ type: "command_lifecycle", command_uuid: d.submitted[0], state: "started" });
    await tick();
    expect(parsed(a.lines).filter((f) => f.method === "turn/started")).toHaveLength(0);
  });

  it("settles on the adopted uuid's terminal frame, whatever it is called", async () => {
    for (const terminal of ["completed", "cancelled", "whatever_the_engine_calls_it"]) {
      const { a, d } = await boot();
      d.emit({ type: "user", isReplay: true, uuid: "cmd-1", origin: peerOrigin(), message: { content: "x" } });
      d.emit({ type: "command_lifecycle", command_uuid: "cmd-1", state: "started" });
      await tick();
      d.emitUnclaimed({ type: "result", subtype: "success", result: "done" });
      d.emit({ type: "command_lifecycle", command_uuid: "cmd-1", state: terminal });
      await tick();
      expect(parsed(a.lines).filter((f) => f.method === "turn/completed")).toHaveLength(1);
    }
  });

  it("a sibling's terminal frame leaves the adopted turn open", async () => {
    const { a, d } = await boot();
    d.emit({ type: "user", isReplay: true, uuid: "cmd-1", origin: peerOrigin(), message: { content: "x" } });
    d.emit({ type: "command_lifecycle", command_uuid: "cmd-1", state: "started" });
    await tick();
    d.emit({ type: "command_lifecycle", command_uuid: "cmd-other", state: "completed" });
    await tick();
    expect(parsed(a.lines).filter((f) => f.method === "turn/completed")).toHaveLength(0);
  });

  it("claims the unclaimed result exactly once, and declines when nothing is adopted", async () => {
    const { d } = await boot();
    expect(d.emitUnclaimed({ type: "result" })).toBe(false);
    d.emit({ type: "user", isReplay: true, uuid: "cmd-1", origin: peerOrigin(), message: { content: "x" } });
    d.emit({ type: "command_lifecycle", command_uuid: "cmd-1", state: "started" });
    await tick();
    expect(d.emitUnclaimed({ type: "result" })).toBe(true);
    expect(d.emitUnclaimed({ type: "result" })).toBe(false);
  });

  it("settles failed when the terminal arrives with no result claimed", async () => {
    const { a, d } = await boot();
    d.emit({ type: "user", isReplay: true, uuid: "cmd-1", origin: peerOrigin(), message: { content: "x" } });
    d.emit({ type: "command_lifecycle", command_uuid: "cmd-1", state: "started" });
    await tick();
    d.emit({ type: "command_lifecycle", command_uuid: "cmd-1", state: "cancelled" });
    await tick();
    expect(parsed(a.lines).find((f) => f.method === "turn/completed").params.turn.status).toBe("failed");
  });

  it("adopts nothing on a closing thread", async () => {
    const { a, conn, threadId, d } = await boot();
    send(conn, { id: 3, method: "thread/close", params: { threadId } });
    d.emit({ type: "user", isReplay: true, uuid: "cmd-1", origin: peerOrigin(), message: { content: "x" } });
    d.emit({ type: "command_lifecycle", command_uuid: "cmd-1", state: "started" });
    await tick();
    expect(parsed(a.lines).filter((f) => f.method === "turn/started")).toHaveLength(0);
  });

  it("emits one userMessage item per ARRIVAL, id-stable on arrivalUuid, in every outcome", async () => {
    const { a, d } = await boot();
    d.emit({ type: "user", isReplay: true, uuid: "cmd-1", origin: peerOrigin("m-1"), message: { content: "x" } });
    d.emit({ type: "user", isReplay: true, uuid: "cmd-2", origin: peerOrigin("m-2"), message: { content: "y" } });
    await tick();
    const items = parsed(a.lines).filter((f) => f.method === "item/completed");
    expect(items.map((i) => i.params.item.id).sort()).toEqual(["cmd-1", "cmd-2"]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/unit/appserver/peer-inbound.test.ts`
Expected: FAIL — no `thread/peerMessage` is ever emitted.

- [ ] **Step 3: Write the implementation**

Create `src/appserver/peerInbound.ts`:

```ts
// appserver/peerInbound.ts — the arrival notification and the adoption state machine.
//
// ARRIVAL and EXECUTION are separate facts, because measurement made them separate (probes 118/118b): an
// inbound message becomes its own turn, a follow-up turn, or nothing at all — folded into whatever turn
// was running, answered in the same reply, with no second result anywhere — and nothing observable at
// delivery time predicts which. So:
//
//   arrival   = the replayed user frame. Exact: it always fires, once per message, carrying the full peer
//               origin. `thread/peerMessage` is broadcast from there and promises nothing about a turn.
//   execution = a `command_lifecycle` frame naming a command_uuid this server did not submit. The engine
//               STATES this; we do not infer it. `started` opens the turn, the uuid's terminal closes it.
//
// Keying on the engine's own per-message frames is why this file has no reservation machinery, no frame
// buffering and no late-adoption branch: `started` arrives ahead of the turn's init and every item, so
// there is nothing to compensate for.
import { randomUUID } from "node:crypto";
import { beginTurn, emitItems } from "./turns.js";
import type { ThreadRecord } from "./registry.js";
import type { AppServer } from "./server.js";

export interface PeerArrival { uuid: string; origin: Record<string, unknown>; receivedAt: number }

/** A bookkeeping bound, not a delivery bound — the CLI has already admitted those messages either way. */
export const PEER_PENDING_CAP = 32;

const nowSec = (): number => Math.floor(Date.now() / 1000);

/** Anything that is not `queued` or `started` is terminal. Deliberately NOT a match on "completed": the
 *  run that measured these frames had its turns fail immediately, so the terminal state it saw was
 *  `cancelled`, and a healthy turn's name is a delegated unknown the spec records. A rule that matched one
 *  literal would break on exactly the failure path it most needs to survive. */
const isTerminalState = (state: unknown): boolean => typeof state === "string" && state !== "queued" && state !== "started";

export function installPeerInbound(srv: AppServer, record: ThreadRecord): () => void {
  const offFrame = record.session.onFrame((frame) => {
    const f = frame as Record<string, any>;
    if (f?.type === "user" && f.isReplay === true && f.origin?.kind === "peer" && typeof f.uuid === "string") { onArrival(srv, record, f); return; }
    if (f?.type === "command_lifecycle" && typeof f.command_uuid === "string") onLifecycle(srv, record, f.command_uuid, f.state);
  });
  const offResult = record.session.onUnclaimedResult?.((result) => claimResult(record, result)) ?? (() => {});
  return () => { offFrame(); offResult(); };
}

function onArrival(srv: AppServer, record: ThreadRecord, f: Record<string, any>): void {
  const arrival: PeerArrival = { uuid: f.uuid, origin: f.origin as Record<string, unknown>, receivedAt: nowSec() };
  record.peerPending.push(arrival);
  if (record.peerPending.length > PEER_PENDING_CAP) {
    record.peerPending.shift();
    for (const peer of record.subscribers) {
      try { peer.notify("warning", { code: "peerPendingOverflow", message: `thread ${record.id}: more than ${PEER_PENDING_CAP} unconsumed peer arrivals; the oldest was dropped from this server's bookkeeping` }); } catch { /* a subscriber went away */ }
    }
  }
  srv.broadcast(record.id, "thread/peerMessage", { threadId: record.id, arrivalUuid: arrival.uuid, origin: arrival.origin, receivedAt: arrival.receivedAt });
  // A turn is already running: this arrival folded into it, so its item belongs to that turn and can go
  // out now. Otherwise it waits for the turn its `started` will open.
  if (record.busy && record.currentTurnId) emitArrivalItem(srv, record, arrival, record.currentTurnId);
  else record.peerItemsPending.push(arrival);
}

/** ONE item per ARRIVAL, id-stable on the replayed frame's uuid — not per turn. A folded arrival has no
 *  turn of its own and still persists a prompt, and N batched arrivals share one turn, so per-turn
 *  emission would under-produce in exactly the two cases `thread/read` will disagree about.
 *
 *  It is emitted against a turn rather than free-floating, because `emitItems` keys the replay buffer by
 *  turn id and an item with no turn could never be replayed to a late subscriber. */
function emitArrivalItem(srv: AppServer, record: ThreadRecord, arrival: PeerArrival, turnId: string): void {
  emitItems(srv, record, turnId, [
    { kind: "completed", item: { type: "userMessage", id: arrival.uuid, text: String(arrival.origin.body ?? "") } as any },
  ]);
}

function onLifecycle(srv: AppServer, record: ThreadRecord, commandUuid: string, state: unknown): void {
  if (record.adoptedCommandUuid === commandUuid && isTerminalState(state)) { settleAdopted(srv, record); return; }
  if (state !== "started") return;
  if (record.adoptedCommandUuid !== undefined) return;          // one adoption at a time; siblings ride it
  if (srv.submittedTurnUuids.has(commandUuid)) return;          // ours — beginTurn already owns it
  if (record.closing || record.busy) return;                    // closing announces nothing; busy is our own turn
  adopt(srv, record, commandUuid);
}

function adopt(srv: AppServer, record: ThreadRecord, commandUuid: string): void {
  record.adoptedCommandUuid = commandUuid;
  record.adoptedEpoch = record.epoch;
  // `releaseSlot` is called IMMEDIATELY, not at settlement. Its contract is "call it the instant the
  // engine call is dispatched", and for an adopted turn the engine call was never ours to make — so
  // there is nothing to hold `record.chain` for, and holding it until settlement would park every
  // chained op for the length of somebody else's turn.
  const started = beginTurn(srv, undefined, undefined, record, (turnId, _mapper, releaseSlot) => {
    releaseSlot();
    // Items queued by arrivals that had no turn yet belong to this one, AFTER its `turn/started` — the
    // protocol's edge-before-items order, which beginTurn has already satisfied by the time a runner runs.
    for (const a of record.peerItemsPending.splice(0)) emitArrivalItem(srv, record, a, turnId);
    return new Promise((resolve) => { record.adoptedResolve = resolve as (v: unknown) => void; });
  });
  if (!started) { record.adoptedCommandUuid = undefined; record.adoptedEpoch = undefined; }
}

function claimResult(record: ThreadRecord, result: unknown): boolean {
  if (record.adoptedCommandUuid === undefined) return false;
  if (record.adoptedOutcome !== undefined) return false;         // already have one; a second is not ours
  record.adoptedOutcome = result;
  return true;
}

function settleAdopted(srv: AppServer, record: ThreadRecord): void {
  if (record.adoptedEpoch !== record.epoch) { record.adoptedCommandUuid = undefined; return; } // a swap happened under it
  const uuid = record.adoptedCommandUuid;
  record.adoptedCommandUuid = undefined;
  record.peerPending = record.peerPending.filter((a) => a.uuid !== uuid);
  const outcome = record.adoptedOutcome;
  record.adoptedOutcome = undefined;
  // A turn whose terminal arrives with no result claimed settles anyway, reported failed: an outcome the
  // engine declined to describe is still an outcome, and a thread left waiting for one is the failure
  // this whole module exists to prevent.
  record.adoptedResolve?.(outcome === undefined ? { error: { message: "peer turn ended without a result" } } as any : undefined);
  record.adoptedResolve = undefined;
}
```

In `src/appserver/registry.ts`, add to `ThreadRecord`:

```ts
  /** M8: unconsumed peer arrivals, and the adopted turn's identity. `adoptedEpoch` is stamped so a
   *  lifecycle terminal arriving after an engine swap settles nothing. */
  peerPending: PeerArrival[];
  /** Arrivals whose `userMessage` item has no turn to belong to yet; drained by the turn they open. */
  peerItemsPending: PeerArrival[];
  adoptedCommandUuid?: string;
  adoptedEpoch?: number;
  adoptedOutcome?: unknown;
  adoptedResolve?: (v: unknown) => void;
```

In `src/appserver/server.ts`: seed `peerPending: []` and `peerItemsPending: []` on every record literal, track submitted turn uuids in a `readonly submittedTurnUuids = new Set<string>()` (added in `submitRunner`'s `opts.uuid` site in `turns.ts`), call `installPeerInbound` beside the router install, and call its returned disposer in `closeRecord` beside `routerOff`.

In `src/appserver/registry.ts`'s `EngineSession`, add:
```ts
  /** M8: a claiming hook at the unmatched-result site (session.ts). Optional because the fleet engine has
   *  no equivalent — a fleet thread's engine is another process's session and this server never adopts on
   *  it. */
  onUnclaimedResult?(cb: (result: unknown) => boolean): () => void;
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run test/unit/appserver/peer-inbound.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Regression + typecheck**

Run: `npx vitest run test/unit && npx tsc --noEmit`
Expected: all green; no tsc output.

- [ ] **Step 6: Commit**

```bash
git add src/appserver/peerInbound.ts src/appserver/registry.ts src/appserver/server.ts src/appserver/turns.ts test/unit/appserver/peer-inbound.test.ts
git commit -m "feat(appserver): arrival and adoption, keyed on the engine's command_lifecycle frames"
```

---

### Task 11: Interrupt, close and shutdown for an adopted turn

**Files:**
- Modify: `src/appserver/peerInbound.ts`, `src/appserver/server.ts`
- Test: `test/unit/appserver/peer-inbound.test.ts` (extend)

**Interfaces:**
- Consumes: from Task 10: `installPeerInbound`, the record fields.
- Produces: `cancelAdopted(srv: AppServer, record: ThreadRecord): void`

- [ ] **Step 1: Write the failing test**

Append to `test/unit/appserver/peer-inbound.test.ts`:

```ts
describe("teardown", () => {
  it("cancels an adopted turn on close, BEFORE thread/closed", async () => {
    const { a, conn, threadId, d } = await boot();
    d.emit({ type: "user", isReplay: true, uuid: "cmd-1", origin: peerOrigin(), message: { content: "x" } });
    d.emit({ type: "command_lifecycle", command_uuid: "cmd-1", state: "started" });
    await tick();
    a.lines.length = 0;
    send(conn, { id: 3, method: "thread/close", params: { threadId } });
    await tick();
    const methods = parsed(a.lines).map((f) => f.method);
    const iCompleted = methods.indexOf("turn/completed");
    const iClosed = methods.indexOf("thread/closed");
    expect(iCompleted).toBeGreaterThanOrEqual(0);
    expect(iClosed).toBeGreaterThan(iCompleted);
    expect(parsed(a.lines).find((f) => f.method === "turn/completed").params.turn.status).toBe("cancelled");
  });

  it("cancels an adopted turn on shutdown", async () => {
    const { srv, a, d } = await boot();
    d.emit({ type: "user", isReplay: true, uuid: "cmd-1", origin: peerOrigin(), message: { content: "x" } });
    d.emit({ type: "command_lifecycle", command_uuid: "cmd-1", state: "started" });
    await tick();
    a.lines.length = 0;
    await srv.shutdown();
    expect(parsed(a.lines).some((f) => f.method === "turn/completed" && f.params.turn.status === "cancelled")).toBe(true);
  });

  it("settles nothing when a terminal arrives after the epoch moved", async () => {
    const { srv, a, threadId, d } = await boot();
    d.emit({ type: "user", isReplay: true, uuid: "cmd-1", origin: peerOrigin(), message: { content: "x" } });
    d.emit({ type: "command_lifecycle", command_uuid: "cmd-1", state: "started" });
    await tick();
    srv.registry.get(threadId)!.epoch++;
    a.lines.length = 0;
    d.emit({ type: "command_lifecycle", command_uuid: "cmd-1", state: "completed" });
    await tick();
    expect(parsed(a.lines).filter((f) => f.method === "turn/completed")).toHaveLength(0);
  });

  it("drops unconsumed arrivals at close without a second notification about them", async () => {
    const { a, conn, threadId, d } = await boot();
    d.emit({ type: "user", isReplay: true, uuid: "cmd-1", origin: peerOrigin(), message: { content: "x" } });
    await tick();
    a.lines.length = 0;
    send(conn, { id: 3, method: "thread/close", params: { threadId } });
    await tick();
    expect(parsed(a.lines).filter((f) => f.method === "thread/peerMessage")).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/unit/appserver/peer-inbound.test.ts -t teardown`
Expected: FAIL — no `turn/completed` before `thread/closed`.

- [ ] **Step 3: Write the implementation**

Add to `src/appserver/peerInbound.ts`:

```ts
/** An adopted turn is a real turn but is backed by no client `submit()` promise, so nothing in the
 *  existing teardown rejects it: close and shutdown flush `record.queue` and then dispose, relying on
 *  disposal rejecting waiters an adopted turn does not have — and the unclaimed-result hook never fires
 *  when disposal ends the stream with no result at all. Hence an explicit cancellation, called before the
 *  router is torn down and before the record is deleted. Epoch-guarded, so a frame arriving afterwards
 *  settles nothing. */
export function cancelAdopted(srv: AppServer, record: ThreadRecord): void {
  if (record.adoptedCommandUuid === undefined) return;
  record.adoptedCommandUuid = undefined;
  record.adoptedOutcome = undefined;
  record.peerPending = [];
  record.peerItemsPending = [];
  const resolve = record.adoptedResolve;
  record.adoptedResolve = undefined;
  resolve?.({ stopped: "cancelled" } as any);
}
```

In `src/appserver/server.ts`'s `closeRecord`, before `record.routerOff?.()`:
```ts
    cancelAdopted(this, record);
```
and in `shutdown()`, inside the per-record callback before `flushQueue(this, r)`:
```ts
      cancelAdopted(this, r);
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run test/unit/appserver/peer-inbound.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Regression + typecheck**

Run: `npx vitest run test/unit && npx tsc --noEmit`
Expected: all green; no tsc output.

- [ ] **Step 6: Commit**

```bash
git add src/appserver/peerInbound.ts src/appserver/server.ts test/unit/appserver/peer-inbound.test.ts
git commit -m "feat(appserver): an adopted turn dies like a turn — interrupt, close, shutdown"
```

---

### Task 12: Scorecard rows and the keyless gate

**Files:**
- Modify: `docs/parity/appserver.md`, `docs/parity/full-potential.md` (both under `CC-to-SDK/`)
- Test: the drift gate itself

**Interfaces:**
- Consumes: Tasks 5–11 (every registered method and notification).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Run the gate and read its complaint**

Run (from `CC-to-SDK/`): `node scripts/drift-check.mjs`
Expected: FAIL — the three new registered methods have no scorecard row (the gate's bijection direction).

- [ ] **Step 2: Add the method rows**

In `CC-to-SDK/docs/parity/appserver.md`, in the **server-origin table** (the one whose seam-token column repeats the method name), add three rows after `thread/searchOccurrences`:

```
| `peer/list` | appserver/peerDomain.ts | `peer/list` | N/A | shipped(M8) — the machine's addressable sessions, read from `<claudeConfigDir()>/sessions/*.json` (never a hardcoded `~/.claude`: the tenant preset gives each tenant its own root, and scanning the literal home directory would list the wrong namespace and omit the right one). Fields beyond `address`/`alive`/`inboxBound`/`threadId`/`statusReachable` are projected VERBATIM when present and omitted when absent — the rows belong to another program, and a row that invents a default lies about a session we do not own. `alive` is pid + `procStart` under `LC_ALL=C TZ=UTC`, the same comparison `fleet/liveness.ts` makes and for the same reason. `aliveOnly` defaults false: a dead row is information — it is why an address stopped working — and `fleet/list` already sets that precedent. `statusReachable` is a TWO-part test, not a directory comparison: a peer is reachable for status only when its socket sits in our socket directory AND it resolves the same config root we publish our key under; a peer failing either can be sent to and can never answer |
| `peer/send` | appserver/peerDomain.ts | `peer/send` | N/A | shipped(M8) — writes one enveloped frame to a peer's inbox and **reports nothing more**: `delivered` is a literal `false`, because the CLI tells a sender nothing on the success path (measured — only `held` and `expired` produce a receipt at all), so any other value would be the wire's own lie. Target resolution copies `thread/attach`'s rule exactly — a SIMULTANEOUS filter over `sessionId`/`pid`/`address`/`name`, where more than one match is an error carrying the matches rather than a precedence, because a wrong guess delivers into somebody else's session. The envelope is assembled in the CLI's fixed attribute order (`from`, `from-session`, `hop-chain`, `from-name`, `from-mode`) and compared byte-exactly by the receiver, so attribute values are ESCAPED and a value carrying a control character is refused `-32602` rather than sent — a silently downgraded envelope is a permission decision made on wrong information. **`from-mode` is always `prompting`**, and there is no parameter of any spelling that changes it: this gateway runs no model and asks no permission, and `fromThreadId` is attribution only (`from-session`, `from-name`). The recorded consequence: every message this server sends is HELD by a `bypassPermissions` peer, and on a headless peer a hold expires. `msg_id` is a server-minted UUID — a non-UUID id comes back with no `orig_msg_id` and silently costs all correlation. `hop-chain` is never set (nothing here relays). Refuses `-32602` above a 60 000-character frame cap of our own, because the CLI's sender-side preflight belongs to the path we do not use and an oversize line meets the receiver's own cap, which drops it before the JSON is parsed and tells nobody |
| `thread/crossSessionInbound/set` | appserver/peerPolicy.ts | `thread/crossSessionInbound/set` | inProcess | shipped(M8) — the one deliberate way a hosted thread's inbound policy changes after start. ENGINE FIRST, commit to the record after the engine accepts (the commit-after-accept rule the other flag-layer setters follow): a record-first write would leave the record claiming a policy the engine rejected, and that phantom would become real at the next swap. Broadcasts `thread/settings/changed`, which the generic `thread/settings/apply` deliberately does not — a policy change is exactly the kind of thing every subscriber should see. `-33006` on a fleet thread (its engine is another process's session, whose settings this server does not write) |
```

Add two notification rows (a row per consumed channel is what the convention earns):

```
| `thread/peerMessage` | appserver/peerInbound.ts | `thread/peerMessage` | inProcess | shipped(M8) — an inbound peer message ARRIVED. Fires on the replayed user frame, once per message, to the thread's SUBSCRIBERS (content, not existence — `watchThreads` is existence fan-out, a distinction the images round learned the hard way). Carries `origin` verbatim from the SDK frame rather than re-derived, because `verifiedPeerPid` is the one field the kernel vouches for and the only non-forgeable identity in the exchange. **No `turnId`, and there cannot be one**: at arrival the message's fate is undecided — it may fold into a running turn, batch with others, or cause a turn whose id does not exist yet — so the field could only be fabricated, delayed, or null. `arrivalUuid` is the replayed frame's own uuid, which is also the id of the `userMessage` item this arrival produces, so a client deduplicates against `thread/read` with it |
| `peer/messageStatus` | appserver/server.ts | `peer/messageStatus` | N/A | shipped(M8) — a delivery-status receipt, routed to the connection that sent the `peer/send` and dropped when that connection is gone (this is that request's delayed completion, not thread state). The full status vocabulary is declared because the CLI's control frame declares it, but the measured truth is narrower and stated here: **only `held` and `expired` are observed** — delivered and refused messages produce no receipt at all, so silence is the success path. Correlation is retained for an absolute 30 minutes (six times the CLI's default hold deadline, and FIXED rather than derived from this process's env, since the deadline belongs to the receiver), capped at 256 per connection and 4096 server-wide, and an entry evicted by either bound notifies its sender `dropped` rather than vanishing |
```

- [ ] **Step 3: Clear the stale full-potential rows**

In `CC-to-SDK/docs/parity/full-potential.md`, replace the 🚫 receive-side row (the one reading "probe 110: headless SDK sessions are NOT addressable"):

```
| Cross-session messaging: receive side (`SDKMessageOrigin` peer, `crossSessionInbound`, `command_lifecycle`) | ✅ | **SHIPPED (M8).** The 🚫 here was probe 110's, and it was wrong about its own cause: it addressed a session by uuid, which is not an address in any namespace, and never looked at the session registry or the socket directory. Probe 113c (2026-08-25) delivered into a headless SDK session's turn queue and the model acted on it; probes 117/117b measured what a host must do to participate (a vouched, in-namespace listener that CLOSES on read; a key file alone vouches; `msg_id` must be a UUID); probes 118/118b measured that an inbound message becomes its own turn, a follow-up turn, or nothing at all (folded into the running one); and probe 119b found the undeclared `command_lifecycle` frame that states per-message turn boundaries outright. The capability is back in the denominator and built |
```

- [ ] **Step 4: Run the gate**

Run (from `CC-to-SDK/`): `node scripts/drift-check.mjs`
Expected: exit 0. Note the two tally lines it prints (row count and registered-method count) — the sweep paragraph is restated from the gate's own numbers, never counted by hand.

- [ ] **Step 5: Restate the sweep**

In `docs/parity/appserver.md`'s Totals section, add a dated line using the gate's printed tallies, in the form the previous sweeps use, and demote the prior sweep line into the history chain.

- [ ] **Step 6: Commit**

```bash
git add docs/parity/appserver.md docs/parity/full-potential.md
git commit -m "docs(parity): row the peer domain, and retire probe 110's stale receive-side verdict"
```

---

### Task 13: Final verification — the keyless gates now, the keyed legs after the reset

**Files:**
- Create: `test/live/appserver-cross-session.test.ts`
- Modify: the spec's `## Surprises & Discoveries` / `## Outcomes & Retrospective`

**Interfaces:**
- Consumes: every prior task.
- Produces: nothing.

**This task has two halves and they run at different times.** Steps 1–4 are keyless and run now. Steps 5–8 need a key and are BLOCKED until **2026-08-31 00:00 Asia/Seoul** (the account's weekly limit). The live file is written now so it is reviewed with the code it tests; it skips cleanly without a key, exactly as every other file under `test/live/` does.

- [ ] **Step 1: Run the spec's keyless acceptance, in its own words**

Run each, from `CC-to-SDK/harness`:
```bash
npx vitest run test/unit/peer/address.test.ts
npx vitest run test/unit/peer/gateway.test.ts
npx vitest run test/unit/peer/receipts.test.ts
npx vitest run test/unit/peer/roster.test.ts
npx vitest run test/unit/appserver/peer-domain.test.ts
npx vitest run test/unit/appserver/peer-inbound.test.ts
npx vitest run test/unit/appserver/peer-policy.test.ts
```
Expected: all PASS.

- [ ] **Step 2: Run the whole unit suite and the typecheck**

Run: `npx vitest run test/unit && npx tsc --noEmit`
Expected: all green; no tsc output.

- [ ] **Step 3: Run the drift gate**

Run (from `CC-to-SDK/`): `node scripts/drift-check.mjs`
Expected: exit 0.

- [ ] **Step 4: Write the live file (keyless-skipping)**

Create `test/live/appserver-cross-session.test.ts`:

```ts
// test/live/appserver-cross-session.test.ts — M8's keyed acceptance. Gated exactly like every other live
// file: without a key the whole describe skips, so this runs in CI as a no-op and against a real engine
// when a key is present.
//
// Three of the spec's delegated unknowns close here, and each is ASSERTED rather than assumed, so a wrong
// guess is a red test rather than a silent divergence:
//   1. the healthy terminal `command_lifecycle` state's NAME (the measuring run was weekly-limited, so
//      only the failure path's `cancelled` has ever been seen);
//   2. what lifecycle a FOLDED message gets (it has no turn of its own);
//   3. whether a BATCH emits one bracket per command_uuid around one turn.
// Each is recorded into the spec's Surprises & Discoveries by the step that follows this file.
import { describe, it, expect } from "vitest";

const live = (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN) ? describe : describe.skip;

live("M8 cross-session, against a real engine", () => {
  it.todo("idle: peer/list shows this server's own thread with its threadId, peer/send reaches it, and the subscriber sees thread/peerMessage -> turn/started -> items -> turn/completed with unmatchedResults unchanged, then thread/read's persisted userMessage deep-equals the live one");
  it.todo("busy follow-up: a message delivered to a turn that ends without another round-trip produces two balanced lifecycles, no orphaned turn id, and unmatchedResults unchanged");
  it.todo("arrival-only: after thread/peerMessage lands, NO turn has started");
  it.todo("fold: a message delivered mid-turn with round-trips remaining produces thread/peerMessage and exactly one turn");
  it.todo("refuse: the same send into a crossSessionInbound:'refuse' thread produces no thread/peerMessage, no turn, and no receipt");
  it.todo("records the healthy terminal state name, the folded lifecycle, and the batched lifecycle into the spec");
});
```

Run: `npx vitest run test/live/appserver-cross-session.test.ts`
Expected: SKIPPED (no key present), 0 failures.

- [ ] **Step 5: Commit the keyless half**

```bash
git add test/live/appserver-cross-session.test.ts
git commit -m "test(m8): the keyed acceptance file, skipping cleanly until the quota resets"
```

- [ ] **Step 6: AFTER 2026-08-31 — implement and run the keyed legs**

Replace each `it.todo` with a real test following the spec's acceptance rows 7–11, then run:
```bash
set -a; . ../.env; set +a; npx vitest run test/live/appserver-cross-session.test.ts
```
Expected: all legs PASS. Assert, and do not assume: the terminal state's name, the folded message's lifecycle frames, and the batch's bracket count.

- [ ] **Step 7: AFTER 2026-08-31 — record the three verdicts in the spec**

Add to the spec's `## Surprises & Discoveries` the measured answer to each delegated unknown, and write `## Outcomes & Retrospective` against the spec's original purpose, replacing its "Pending — written at finish." line.

- [ ] **Step 8: AFTER 2026-08-31 — commit and finish the branch**

```bash
git add test/live/appserver-cross-session.test.ts ../docs/superpowers/specs/2026-08-26-agent-appserver-m8-cross-session-design.md
git commit -m "test(m8): keyed acceptance green; the three delegated unknowns are now measured"
```
Then use doperpowers:finishing-a-development-branch.
