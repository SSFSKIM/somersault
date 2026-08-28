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
- `src/appserver/peerPolicy.ts` — policy injection into a thread's options, the settings sanitizer, and the `thread/settings/apply` reservation. (The runtime setter is Task 11's, and lands on the canonical settings spine in `settings.ts` if its measurement licenses it at all.)
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

### Task 8: Inbound policy at admission — one sanitizer, both spines, durable across swaps

**Files:**
- Create: `src/appserver/peerPolicy.ts`
- Modify: `src/appserver/server.ts`, `src/appserver/settings.ts`, `src/appserver/registry.ts`, `src/appserver/fleet.ts`
- Test: `test/unit/appserver/peer-policy.test.ts`

**Interfaces:**
- Consumes: from Task 5: `CROSS_SESSION_INBOUND` (the zod enum) and the `crossSessionInbound` field already present on `threadStartParams` and `threadResumeParams`.
- Produces:
  - `type CrossSessionInbound = "accept" | "hold" | "refuse"`
  - `DEFAULT_INBOUND: CrossSessionInbound` (`"refuse"`)
  - `SETTINGS_KEY = "crossSessionInbound"` and `RESERVED_SETTINGS_KEY` (its alias, for the `thread/settings/apply` reservation)
  - `applyPeerPolicy(config: Record<string, unknown> | undefined, value: CrossSessionInbound): Record<string, unknown>` — throws `RpcRefusal(ERR.INVALID_PARAMS, …)`
  - On `ThreadRecord`: `crossSessionInbound: CrossSessionInbound` (mandatory)

**What this task is NOT.** There is no runtime setter here. `crossSessionInbound` is decided once, at admission, and reported on `thread/get`. A setter would need the CLI to re-read the key mid-session off the flag layer, and nothing has measured that it does — `applyFlagSettings` accepts writes it never validates (probe 102), so a resolved call is not evidence of effect. Task 11 owns that question and is gated on measuring it.

**Why the policy is written into `record.config` and not only onto the record.** Every replacement engine this server builds — `thread/rewind`, `thread/clear`, `thread/reopen`, and settingsOps' own swap — is constructed from `swapBaseConfig(record.config)` (`src/appserver/rewind.ts:121`). A policy stored only as a record field would be rebuilt out of the launch config on the first swap, silently restoring whatever the thread opened with. Writing it into `record.config` at admission makes durability a property of the config spine that already exists, rather than four separate call sites each remembering to re-apply it. `record.crossSessionInbound` is the cheap read for the arrival path; `record.config` is the truth the engine is built from. **Both are written in the same statement, in `applyPeerPolicy`'s caller, and never apart.**

**Why `fleet.ts` is in the file list.** `src/appserver/fleet.ts:410` builds the repository's second `ThreadRecord` literal (`origin: "fleet"`). Making `crossSessionInbound` mandatory without seeding that literal fails `npx tsc --noEmit` before any test runs. Fleet threads are host-owned: this server does not build their engine and cannot inject settings into it, so the honest seed is `DEFAULT_INBOUND` — the value that means "this server has not enabled inbound here".

---

- [ ] **Step 1: Write the failing test**

Create `test/unit/appserver/peer-policy.test.ts`:

```ts
// test/unit/appserver/peer-policy.test.ts — the policy's doors. The property under test is not "the key
// is set" but "nothing else can decide it": not a settings file on disk, not a client's escape hatch, not
// the generic settings RPC, and not an engine swap. Every case that admits a thread runs against BOTH
// admission spines, because thread/start and thread/resume are different functions in this server and a
// policy that only one of them applies is a policy.
import { describe, it, expect } from "vitest";
import { applyPeerPolicy, DEFAULT_INBOUND, SETTINGS_KEY } from "../../../src/appserver/peerPolicy.js";
import { swapBaseConfig } from "../../../src/appserver/rewind.js";
import { ERR } from "../../../src/appserver/rpc.js";

const settingsOf = (c: Record<string, unknown>) => c.settings as Record<string, unknown>;

describe("applyPeerPolicy", () => {
  it("defaults to refuse and always writes the key explicitly", () => {
    expect(DEFAULT_INBOUND).toBe("refuse");
    // Explicitly, never by omission: the CLI's own default for an absent key is not this server's to
    // assume, and probe 117 measured that an EXPLICIT value beats mode parity in both directions.
    expect(settingsOf(applyPeerPolicy({}, "refuse"))[SETTINGS_KEY]).toBe("refuse");
    expect(settingsOf(applyPeerPolicy(undefined, "accept"))[SETTINGS_KEY]).toBe("accept");
  });

  it("passes --replay-user-messages on EVERY thread, including a refusing one", () => {
    // The flag is what makes a peer message VISIBLE in the stream at all. A refusing thread still needs
    // it: `refuse` is measured by observing that nothing arrives, and an invisible stream cannot
    // distinguish "refused" from "never sent".
    for (const v of ["accept", "hold", "refuse"] as const) {
      expect((applyPeerPolicy({}, v).extraArgs as any)["replay-user-messages"]).toBeNull();
    }
  });

  it("MERGES a client's settings rather than dropping them", () => {
    const out = applyPeerPolicy({ settings: { autoCompactEnabled: true, [SETTINGS_KEY]: "accept" } }, "refuse");
    expect(settingsOf(out)).toEqual({ autoCompactEnabled: true, [SETTINGS_KEY]: "refuse" });
  });

  it("overrides the key in every OBJECT carrier a client can reach", () => {
    const out = applyPeerPolicy({
      settings: { [SETTINGS_KEY]: "accept" },
      extraArgs: { settings: JSON.stringify({ [SETTINGS_KEY]: "accept" }) },
      extraOptions: {
        settings: { [SETTINGS_KEY]: "accept" },
        extraArgs: { settings: JSON.stringify({ [SETTINGS_KEY]: "accept" }) },
      },
    }, "refuse");
    expect(settingsOf(out)[SETTINGS_KEY]).toBe("refuse");
    expect(JSON.parse((out.extraArgs as any).settings)[SETTINGS_KEY]).toBe("refuse");
    const hatch = out.extraOptions as any;
    expect(hatch.settings[SETTINGS_KEY]).toBe("refuse");
    expect(JSON.parse(hatch.extraArgs.settings)[SETTINGS_KEY]).toBe("refuse");
  });

  it("handles the equals-encoding of an argv settings key", () => {
    const out = applyPeerPolicy({ extraArgs: { "settings={\"crossSessionInbound\":\"accept\"}": null } }, "refuse");
    const args = out.extraArgs as Record<string, unknown>;
    const key = Object.keys(args).find((k) => k.startsWith("settings"));
    const json = key!.includes("=") ? key!.slice(key!.indexOf("=") + 1) : String(args[key!]);
    expect(JSON.parse(json)[SETTINGS_KEY]).toBe("refuse");
  });

  // THE HOLE THE SDK's OWN TYPE OPENS. `Options.settings` is `string | Settings`
  // (node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1976), and a string there is a PATH to a
  // settings file on disk — not JSON this server could rewrite. `resolveOptions` spreads `extraOptions`
  // last, so an admitted path would replace the whole settings object, `crossSessionInbound` included.
  // A path cannot be sanitized without rewriting somebody else's file, so it is REFUSED instead.
  it("refuses a settings carrier this server cannot sanitize", () => {
    for (const carrier of [
      { extraOptions: { settings: "/tmp/mine.json" } },
      { extraOptions: { settings: 7 } },
      { extraOptions: { settings: null } },
      { settings: "/tmp/mine.json" },
    ]) {
      let code: number | undefined;
      try { applyPeerPolicy(carrier, "refuse"); } catch (e) { code = (e as any).code; }
      expect(code).toBe(ERR.INVALID_PARAMS);
    }
  });

  it("refuses an unparseable argv settings string rather than discarding it", () => {
    // Discarding it would silently drop settings the client asked for; admitting it would admit an
    // unsanitizable carrier. Refusing is the only answer that is true to both.
    let code: number | undefined;
    try { applyPeerPolicy({ extraArgs: { settings: "{not json" } }, "refuse"); } catch (e) { code = (e as any).code; }
    expect(code).toBe(ERR.INVALID_PARAMS);
  });

  it("strips a client-supplied replay-user-messages, which is ours now", () => {
    const out = applyPeerPolicy({ extraArgs: { "replay-user-messages": "no" } }, "refuse");
    expect((out.extraArgs as any)["replay-user-messages"]).toBeNull();
  });

  // DURABILITY, stated where it is actually enforced. Every replacement engine in this server is built
  // from `swapBaseConfig(record.config)`; a policy that survives that function survives all four swaps at
  // once, and this asserts the composition rather than trusting four call sites to remember.
  it("survives swapBaseConfig, which is what every replacement engine is built from", () => {
    const admitted = applyPeerPolicy({ model: "opus" }, "accept");
    const replacement = swapBaseConfig(admitted);
    expect(settingsOf(replacement)[SETTINGS_KEY]).toBe("accept");
    expect((replacement.extraArgs as any)["replay-user-messages"]).toBeNull();
  });
});
```

Then append the wire half — both spines, one loop:

```ts
import { AppServer } from "../../../src/appserver/server.js";
import type { PeerSink } from "../../../src/appserver/peer.js";

const mkSink = () => { const lines: string[] = []; return { lines, sink: { write: (l: string) => void lines.push(l), buffered: () => 0, end: () => {} } as PeerSink }; };
const send = (c: { feed(ch: string): void }, obj: object) => c.feed(JSON.stringify(obj) + "\n");
const parsed = (lines: string[]) => lines.map((l) => JSON.parse(l));
const tick = () => new Promise((r) => setTimeout(r, 0));

/** Both admission spines, described the way a test can drive them. `thread/start` and `thread/resume`
 *  are separate functions (server.ts's `createThread` and `startThread`), and every policy assertion
 *  below runs against both — a policy only one spine applies is the defect this table exists to catch. */
const SPINES = [
  { name: "thread/start", method: "thread/start", extra: {} as Record<string, unknown> },
  { name: "thread/resume", method: "thread/resume", extra: { sessionId: "11111111-1111-4111-8111-111111111111" } },
];

describe("crossSessionInbound at admission", () => {
  for (const spine of SPINES) {
    it(`${spine.name} defaults to refuse and records it`, async () => {
      const seen: Record<string, unknown>[] = [];
      const srv = new AppServer({ makeSession: ((cfg: Record<string, unknown>) => { seen.push(cfg); return fakeEngine(); }) as any });
      const { lines, sink } = mkSink();
      const c = srv.connect(sink);
      send(c, { id: 1, method: "initialize", params: { clientInfo: { name: "t" } } });
      send(c, { id: 2, method: spine.method, params: { ...spine.extra } });
      await tick(); await tick();
      expect((seen[0].settings as any)[SETTINGS_KEY]).toBe("refuse");
      const reply = parsed(lines).find((m) => m.id === 2);
      expect(reply.error).toBeUndefined();
    });

    it(`${spine.name} honors an explicit accept, and thread/get reports it`, async () => {
      const seen: Record<string, unknown>[] = [];
      const srv = new AppServer({ makeSession: ((cfg: Record<string, unknown>) => { seen.push(cfg); return fakeEngine(); }) as any });
      const { lines, sink } = mkSink();
      const c = srv.connect(sink);
      send(c, { id: 1, method: "initialize", params: { clientInfo: { name: "t" } } });
      send(c, { id: 2, method: spine.method, params: { ...spine.extra, crossSessionInbound: "accept" } });
      await tick(); await tick();
      expect((seen[0].settings as any)[SETTINGS_KEY]).toBe("accept");
      const threadId = parsed(lines).find((m) => m.id === 2)!.result.threadId;
      send(c, { id: 3, method: "thread/get", params: { threadId } });
      await tick();
      expect(parsed(lines).find((m) => m.id === 3)!.result.crossSessionInbound).toBe("accept");
    });

    it(`${spine.name} refuses a settings carrier it cannot sanitize`, async () => {
      const srv = new AppServer({ makeSession: (() => fakeEngine()) as any });
      const { lines, sink } = mkSink();
      const c = srv.connect(sink);
      send(c, { id: 1, method: "initialize", params: { clientInfo: { name: "t" } } });
      send(c, { id: 2, method: spine.method, params: { ...spine.extra, config: { extraOptions: { settings: "/tmp/mine.json" } } } });
      await tick(); await tick();
      expect(parsed(lines).find((m) => m.id === 2)!.error.code).toBe(ERR.INVALID_PARAMS);
    });
  }

  it("thread/settings/apply cannot reach the reserved key", async () => {
    const srv = new AppServer({ makeSession: (() => fakeEngine()) as any });
    const { lines, sink } = mkSink();
    const c = srv.connect(sink);
    send(c, { id: 1, method: "initialize", params: { clientInfo: { name: "t" } } });
    send(c, { id: 2, method: "thread/start", params: {} });
    await tick(); await tick();
    const threadId = parsed(lines).find((m) => m.id === 2)!.result.threadId;
    send(c, { id: 3, method: "thread/settings/apply", params: { threadId, settings: { [SETTINGS_KEY]: "accept" } } });
    await tick(); await tick();
    expect(parsed(lines).find((m) => m.id === 3)!.error.code).toBe(ERR.INVALID_PARAMS);
  });
});
```

`fakeEngine()` is the house fake — copy it verbatim from `test/unit/appserver/settings.test.ts` rather than inventing one; it is `async` exactly where the real `EngineSession` is, and a synchronous stand-in makes chain-ordering tests pass that should not.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/unit/appserver/peer-policy.test.ts`
Expected: FAIL — `Cannot find module '.../peerPolicy.js'`.

- [ ] **Step 3: Write `src/appserver/peerPolicy.ts`**

```ts
// appserver/peerPolicy.ts — the inbound policy, decided ONCE at admission and written into the config
// every engine for this thread is built from.
//
// Four doors lead to the CLI's settings, and a policy that closes three of them closes none:
//   1. `config.settings`            — the SDK's typed object
//   2. `config.extraArgs.settings`  — the `--settings` argv flag, JSON or a path
//   3. `config.extraOptions`        — the escape hatch, spread LAST by resolveOptions
//   4. a settings FILE on disk      — reachable only as a string in doors 1 and 3
//
// Doors 1-3 are rewritten. Door 4 is REFUSED: a string in `settings` is a path
// (sdk.d.ts `settings?: string | Settings`), and sanitizing it would mean rewriting a file this server
// does not own. Refusing is the only answer that neither admits an unsanitized carrier nor silently
// discards what the client asked for.
import { ERR, RpcRefusal } from "./rpc.js";

export type CrossSessionInbound = "accept" | "hold" | "refuse";

/** Refuse, always, unless a client says otherwise on the admission call. A machine-wide inbox that any
 *  local process can write to is not something a thread should acquire by default. */
export const DEFAULT_INBOUND: CrossSessionInbound = "refuse";

export const SETTINGS_KEY = "crossSessionInbound";
/** The same constant under the name the reservation reads it by (settings.ts). One constant, two
 *  readers — so the reservation cannot drift from the key it reserves. */
export const RESERVED_SETTINGS_KEY = SETTINGS_KEY;

const REPLAY_FLAG = "replay-user-messages";

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** A `settings` slot this server is allowed to rewrite: absent, or a plain object. Anything else — a
 *  path, a number, null — is refused rather than sanitized. */
function assertSanitizableSettings(v: unknown, where: string): void {
  if (v === undefined || isPlainObject(v)) return;
  throw new RpcRefusal(ERR.INVALID_PARAMS,
    `${where}.settings must be an object; this server cannot enforce ${SETTINGS_KEY} through a settings file path`);
}

/** Rewrite the `settings` value of an argv map in place-ish, honoring both spellings the CLI accepts:
 *  `{settings: "<json>"}` and the equals-encoded `{"settings=<json>": null}`. Returns a NEW map. */
function withArgvSettings(args: Record<string, unknown> | undefined, value: CrossSessionInbound): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args ?? {})) {
    if (k === REPLAY_FLAG) continue;              // ours now — stripped, then re-added below
    if (k !== "settings" && !k.startsWith("settings=")) { out[k] = v; continue; }
    const raw = k.startsWith("settings=") ? k.slice("settings=".length) : String(v ?? "");
    let obj: unknown;
    try { obj = JSON.parse(raw); } catch {
      // Unparseable means it is a PATH (the flag accepts either), which lands in the same hole as door 4.
      throw new RpcRefusal(ERR.INVALID_PARAMS,
        `extraArgs.settings must be inline JSON; this server cannot enforce ${SETTINGS_KEY} through a settings file path`);
    }
    if (!isPlainObject(obj)) throw new RpcRefusal(ERR.INVALID_PARAMS, "extraArgs.settings must be a JSON object");
    out.settings = JSON.stringify({ ...obj, [SETTINGS_KEY]: value });
  }
  // `--replay-user-messages` is what makes an inbound peer message visible in the stream at all
  // (probe 117). It is passed on EVERY thread, refusing ones included: `refuse` is verified by observing
  // that nothing arrives, and an invisible stream cannot tell "refused" from "never sent". A
  // client-supplied copy is dropped above and re-stated here so its VALUE is ours, not theirs.
  out[REPLAY_FLAG] = null;
  return out;
}

/** The one place the policy is stamped into a config. Returns a new config; never mutates the input.
 *
 *  Call this at admission and write BOTH results in the same statement — `record.config` (which every
 *  replacement engine is rebuilt from, via rewind.ts's `swapBaseConfig`) and `record.crossSessionInbound`
 *  (the arrival path's cheap read). They are one fact; storing one without the other is how a swap
 *  silently restores the launch policy. */
export function applyPeerPolicy(config: Record<string, unknown> | undefined, value: CrossSessionInbound): Record<string, unknown> {
  const src = config ?? {};
  assertSanitizableSettings(src.settings, "config");
  const hatch = isPlainObject(src.extraOptions) ? src.extraOptions : undefined;
  if (src.extraOptions !== undefined && !hatch) throw new RpcRefusal(ERR.INVALID_PARAMS, "config.extraOptions must be an object");
  if (hatch) assertSanitizableSettings(hatch.settings, "config.extraOptions");

  const out: Record<string, unknown> = { ...src };
  out.settings = { ...(isPlainObject(src.settings) ? src.settings : {}), [SETTINGS_KEY]: value };
  out.extraArgs = withArgvSettings(isPlainObject(src.extraArgs) ? src.extraArgs : undefined, value);
  if (hatch) {
    out.extraOptions = {
      ...hatch,
      settings: { ...(isPlainObject(hatch.settings) ? hatch.settings : {}), [SETTINGS_KEY]: value },
      ...(hatch.extraArgs !== undefined
        ? { extraArgs: withArgvSettings(isPlainObject(hatch.extraArgs) ? hatch.extraArgs : undefined, value) }
        : {}),
    };
  }
  return out;
}
```

- [ ] **Step 4: Wire both admission spines**

1. `src/appserver/registry.ts` — add the mandatory field to `ThreadRecord`, beside `origin`:

```ts
  /** Decided at admission, mirrored from `config.settings.crossSessionInbound`. Written together with
   *  the config it mirrors and never apart — see peerPolicy.ts's header. */
  crossSessionInbound: CrossSessionInbound;
```

2. `src/appserver/server.ts` — `createThread` (the `thread/start` spine, ~line 844) and `startThread` (the `thread/resume` spine, ~line 886) each take `crossSessionInbound?: CrossSessionInbound` in their opts, resolve it once, and use it twice:

```ts
    const inbound = opts.crossSessionInbound ?? DEFAULT_INBOUND;
    const config = applyPeerPolicy(opts.config, inbound);
```

…then pass `config` to the engine factory and seed `crossSessionInbound: inbound` on the record literal. `applyPeerPolicy` throws `RpcRefusal`, which dispatch's catch already answers with the code and message intact (server.ts:219) — do not wrap it.

3. Both handler call sites (server.ts ~533 and ~560) forward `crossSessionInbound: parsed.data.crossSessionInbound` from the already-parsed params.

4. `thread/get`'s reply (server.ts ~156, the `origin: r.origin` literal) gains `crossSessionInbound: r.crossSessionInbound`.

5. `src/appserver/fleet.ts:410` — seed the literal:

```ts
      id: srv.registry.mint(), origin: "fleet", session: engine, unattended: "park",
      crossSessionInbound: DEFAULT_INBOUND,   // host-owned engine: this server injects nothing into it
```

6. `src/appserver/settings.ts` — `settingsApply` refuses the reserved key before it touches the engine:

```ts
  if (RESERVED_SETTINGS_KEY in parsed.data.settings) {
    ctx.peer.replyError(id, ERR.INVALID_PARAMS, `${RESERVED_SETTINGS_KEY} is decided at admission and cannot be applied at runtime`);
    return;
  }
```

The reservation is not decoration: `thread/settings/apply` writes the same flag layer the policy relies on, at runtime, with no mirror write and no broadcast. Left open, any initialized connection could turn another thread's `refuse` into `accept` and then feed it.

- [ ] **Step 5: Un-advertise the method this plan no longer implements**

Task 5 registered `thread/crossSessionInbound/set` in `methodSchemas` on the assumption that Task 8 would
implement it. It does not (see this task's opening), and a registered method with no handler is worse than
an absent one: the generated schema advertises it, a client calls it, and the server answers
`METHOD_NOT_FOUND` for something it published. Remove it now and let Task 11 re-add it in the same commit
that registers its handler.

- In `src/appserver/schema/index.ts`, delete the `"thread/crossSessionInbound/set"` entry from `methodSchemas`.
- In `src/appserver/schema/peer.ts`, delete `crossSessionInboundSetParams` and `crossSessionInboundSetResult`.
  Keep `CROSS_SESSION_INBOUND` — the admission params use it.
- In `test/unit/appserver/schema.test.ts`, drop the method from the registration loop and delete the two
  assertions that parse its params (Task 5 added them at the end of the file).
- Run `npm run emit-schema` and commit the regenerated stable artifact; `schemaGen.test.ts` byte-compares it.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run test/unit/appserver/peer-policy.test.ts`
Expected: PASS.

Run: `npx vitest run test/unit/appserver` then `npx tsc --noEmit`
Expected: both green. The typecheck is the real gate on the `fleet.ts` seed — a missed record literal fails here, not in a test.

If `methodSchemas` changed shape in this task, also run `npm run emit-schema` and commit the regenerated stable artifact; `schemaGen.test.ts` byte-compares it.

- [ ] **Step 7: Commit**

```bash
git add src/appserver/peerPolicy.ts src/appserver/server.ts src/appserver/settings.ts src/appserver/registry.ts src/appserver/fleet.ts src/appserver/schema/index.ts src/appserver/schema/peer.ts test/unit/appserver/peer-policy.test.ts test/unit/appserver/schema.test.ts src/appserver/schema/json/stable/appserver.json
git commit -m "feat(appserver): inbound policy is decided at admission, on both spines, and survives every swap"
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

### Task 10: Arrival and adoption — an inbound message becomes a real turn, and every way out of it settles

**Files:**
- Create: `src/appserver/peerInbound.ts`
- Modify: `src/appserver/server.ts`, `src/appserver/registry.ts`, `src/appserver/rewind.ts`
- Test: `test/unit/appserver/peer-inbound.test.ts`

**Interfaces:**
- Consumes: from Task 1: `MAX_FRAME_CHARS`; from Task 8: `CrossSessionInbound`; from Task 9: `Session.onUnclaimedResult`.
- Produces:
  - `installPeerInbound(srv: AppServer, record: ThreadRecord): void`
  - `uninstallPeerInbound(record: ThreadRecord): void`
  - `notePeerTurnUuid(record: ThreadRecord, uuid: string): void`
  - `settleAdopted(srv: AppServer, record: ThreadRecord, reason: "cancelled" | "interrupted"): void`
  - On `ThreadRecord`: `peerInbound?: PeerInboundState` — **one optional field**, not several mandatory ones

**Why one optional field.** `src/appserver/fleet.ts:410` builds this repository's second `ThreadRecord` literal. Every mandatory field added to `ThreadRecord` must be seeded there or `npx tsc --noEmit` fails before a single test runs. A fleet thread has no inbound machinery at all — this server does not own its engine — so the state that adoption needs is one optional object that a fleet record simply never has. That is cheaper and truer than a discriminated union, and it is why only `crossSessionInbound` (Task 8) is mandatory: `thread/get` reports that one on every origin.

**Adoption goes through `beginTurn`, not around it.** An adopted turn is a real turn: subscribers must see `turn/started`, the model's items, and a `turn/completed` whose status distinguishes completed from failed from interrupted from cancelled. `beginTurn` already does all of that, including the close/interrupt re-check on the far side of the chain and the `turnFailureOf`-shaped failure tagging. Synthesizing a parallel turn beside it would mean reimplementing each of those — and getting the ones nobody tested wrong. So adoption supplies `beginTurn` with a runner, and everything else is inherited.

**Three races the shape has to survive**, because the frames do not wait for our chain:

1. **The runner is chain-deferred.** `beginTurn` installs the runner inside `record.chain.then(...)`, so a settings mutation ahead of it can hold the callback while the engine's result and terminal frames are already arriving. Frames are therefore **captured synchronously** at lifecycle start and drained into the mapper when the runner installs. If the terminal has already passed by then, the runner resolves immediately with the outcome that was recorded rather than returning a promise nobody will ever settle.
2. **`record.busy` cannot decide an arrival's turn.** The spec's measurement is explicit that a message delivered during a busy turn has three possible fates and no way to predict which. An arrival is therefore held unassigned until lifecycle evidence decides: it is emitted as an item of whichever turn actually starts, or of the running turn once that turn's own frames carry it. Nothing branches on `busy`.
3. **`busy` is set before `turn/started` goes out.** `beginTurn` sets `record.busy = true` and mints the turn id synchronously (turns.ts ~250) but broadcasts `turn/started` inside the chained callback (turns.ts:304). Items are therefore emitted only from **inside the runner**, which `beginTurn` invokes after that broadcast — never from the observer, which can run in the gap.

**The one unknown, and why the design is safe under either answer.** Whether the `command_uuid` on a `command_lifecycle` frame equals the `uuid` this server passes to `submit()` is not yet measured (Task 13's keyed half asserts it). The code matches our recorded uuid against **both** `command_uuid` and `uuid` on the frame, and if neither matches it adopts. Mis-adopting one of our own turns is harmless: `beginTurn` refuses while `record.busy` is true and returns `false`, so the attempt is a no-op rather than a second turn. The failure mode under the unmeasured half is "an own turn is briefly considered and declined", not a corrupt wire.

---

- [ ] **Step 1: Write the failing test**

Create `test/unit/appserver/peer-inbound.test.ts`:

```ts
// test/unit/appserver/peer-inbound.test.ts — adoption, and every way out of it.
//
// The tests that matter here are the ones where the ENGINE moves before the SERVER does: a chain held by
// a settings mutation, a terminal that lands before the runner installs, a swap under an installed
// observer, a close while a turn is adopted. Each is a way a thread can be left busy forever, and none of
// them is reachable by a test that lets every promise resolve in order first.
import { describe, it, expect, vi } from "vitest";
import { afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppServer } from "../../../src/appserver/server.js";
import type { PeerSink } from "../../../src/appserver/peer.js";

const mkSink = () => { const lines: string[] = []; return { lines, sink: { write: (l: string) => void lines.push(l), buffered: () => 0, end: () => {} } as PeerSink }; };
const send = (c: { feed(ch: string): void }, obj: object) => c.feed(JSON.stringify(obj) + "\n");
const parsed = (lines: string[]) => lines.map((l) => JSON.parse(l));
const tick = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); };

const fileCcxDir = mkdtempSync(join(tmpdir(), "m8ccx-peer-inbound-"));
afterAll(() => { rmSync(fileCcxDir, { recursive: true, force: true }); });
const notes = (lines: string[], method: string) => parsed(lines).filter((m) => m.method === method);

const LIFECYCLE = (state: string, uuid: string) => ({ type: "command_lifecycle", command_uuid: uuid, state, session_id: "s", uuid: "f" });
const ASSISTANT = (text: string) => ({ type: "assistant", message: { id: "m1", role: "assistant", content: [{ type: "text", text }] } });
const RESULT = (over: Record<string, unknown> = {}) => ({ type: "result", subtype: "success", is_error: false, ...over });

/** An engine fake that lets a test PUSH frames, so the observer under test is driven by frame order
 *  rather than by promise order. `onFrame` and `onUnclaimedResult` mirror the real Session seams —
 *  both return an unsubscribe, and both are consulted synchronously from the read loop. */
function pushEngine() {
  const frameSubs = new Set<(f: unknown) => void>();
  const resultSubs = new Set<(r: unknown) => boolean>();
  return {
    engine: {
      onFrame: (cb: (f: unknown) => void) => { frameSubs.add(cb); return () => frameSubs.delete(cb); },
      onUnclaimedResult: (cb: (r: unknown) => boolean) => { resultSubs.add(cb); return () => resultSubs.delete(cb); },
      submit: async () => undefined,
      dispose: async () => {},
      interrupt: async () => {},
    } as any,
    push: (f: unknown) => { for (const s of [...frameSubs]) s(f); },
    pushResult: (r: unknown) => { let claimed = false; for (const s of [...resultSubs]) claimed = s(r) || claimed; return claimed; },
    live: () => frameSubs.size,
  };
}

// The real constructor is `(opts, deps)` and the engine factory is `deps.sessionFactory` — Task 8
// measured this against the running code, so do not reintroduce a `makeSession` option. `ccxDir` and
// `listSessions` are injected for the reason peer-policy.test.ts states: without them a resume path
// reads the operator's real ~/.claude/ccx.
const boot = (engine: unknown) =>
  new AppServer({}, { ccxDir: fileCcxDir, listSessions: async () => [], sessionFactory: (() => engine) as never });

async function startAccepting(engine: any) {
  const srv = boot(engine);
  const { lines, sink } = mkSink();
  const c = srv.connect(sink);
  send(c, { id: 1, method: "initialize", params: { clientInfo: { name: "t" } } });
  send(c, { id: 2, method: "thread/start", params: { crossSessionInbound: "accept" } });
  await tick();
  // The reply is `{ thread: <view> }` — the one projection every thread-carrying reply goes through.
  const threadId = parsed(lines).find((m) => m.id === 2)!.result.thread.id;
  send(c, { id: 3, method: "thread/subscribe", params: { threadId } });
  await tick();
  lines.length = 0;
  return { srv, c, lines, threadId, record: srv.registry.get(threadId)! };
}

describe("adoption", () => {
  it("a foreign lifecycle start opens a real turn, and the model's output reaches subscribers", async () => {
    const e = pushEngine();
    const { lines } = await startAccepting(e.engine);
    e.push(LIFECYCLE("started", "foreign-1"));
    await tick();
    expect(notes(lines, "turn/started")).toHaveLength(1);

    e.push(ASSISTANT("hello from the peer's turn"));
    await tick();
    // THE POINT OF THIS CASE: an adopted turn that publishes only lifecycle edges is a turn whose
    // subscribers see none of the model's answer. The assistant frame must reach TurnMapper.ingest.
    const items = notes(lines, "item/completed").concat(notes(lines, "item/started"), notes(lines, "item/updated"));
    expect(JSON.stringify(items)).toContain("hello from the peer's turn");

    e.pushResult(RESULT());
    e.push(LIFECYCLE("completed", "foreign-1"));
    await tick();
    const done = notes(lines, "turn/completed");
    expect(done).toHaveLength(1);
    expect(done[0].params.turn.status).toBe("completed");
  });

  it("a FAILED result is reported failed, not completed", async () => {
    const e = pushEngine();
    const { lines } = await startAccepting(e.engine);
    e.push(LIFECYCLE("started", "foreign-2"));
    await tick();
    e.pushResult(RESULT({ is_error: true, subtype: "error_during_execution" }));
    e.push(LIFECYCLE("completed", "foreign-2"));
    await tick();
    expect(notes(lines, "turn/completed")[0].params.turn.status).toBe("failed");
  });

  it("no result at all still settles the turn", async () => {
    const e = pushEngine();
    const { lines } = await startAccepting(e.engine);
    e.push(LIFECYCLE("started", "foreign-3"));
    await tick();
    e.push(LIFECYCLE("cancelled", "foreign-3"));
    await tick();
    expect(notes(lines, "turn/completed")).toHaveLength(1);
  });

  // RACE 1. The chain is held, and the whole turn happens inside the hold.
  it("survives a held chain: a terminal that lands before the runner installs still settles", async () => {
    const e = pushEngine();
    const { lines, record } = await startAccepting(e.engine);
    let release!: () => void;
    record.chain = record.chain.then(() => new Promise<void>((r) => { release = r; }));
    e.push(LIFECYCLE("started", "foreign-4"));
    e.push(ASSISTANT("answered while the chain was held"));
    e.pushResult(RESULT());
    e.push(LIFECYCLE("completed", "foreign-4"));
    await tick();
    expect(notes(lines, "turn/started")).toHaveLength(0);   // nothing ran yet — the chain is held
    release();
    await tick();
    const done = notes(lines, "turn/completed");
    expect(done).toHaveLength(1);
    expect(done[0].params.turn.status).toBe("completed");
    expect(record.busy).toBe(false);                        // the thread is USABLE again — the wedge test
    expect(JSON.stringify(notes(lines, "item/completed"))).toContain("answered while the chain was held");
  });

  // RACE 2. Items never precede the turn edge that owns them.
  it("emits the arrival item after turn/started, never before", async () => {
    const e = pushEngine();
    const { lines } = await startAccepting(e.engine);
    e.push(LIFECYCLE("started", "foreign-5"));
    await tick();
    const order = parsed(lines).map((m) => m.method).filter((m) => m === "turn/started" || String(m).startsWith("item/"));
    expect(order[0]).toBe("turn/started");
  });

  // RACE 3. A swap replaces the engine; the replacement must be heard.
  it("re-observes the replacement engine after a swap, and stops observing the old one", async () => {
    const first = pushEngine();
    const second = pushEngine();
    let n = 0;
    const srv = new AppServer({}, { ccxDir: fileCcxDir, listSessions: async () => [], sessionFactory: (() => (n++ === 0 ? first.engine : second.engine)) as never });
    const { lines, sink } = mkSink();
    const c = srv.connect(sink);
    send(c, { id: 1, method: "initialize", params: { clientInfo: { name: "t" } } });
    send(c, { id: 2, method: "thread/start", params: { crossSessionInbound: "accept" } });
    await tick();
    const threadId = parsed(lines).find((m) => m.id === 2)!.result.thread.id;
    send(c, { id: 3, method: "thread/subscribe", params: { threadId } });
    await tick();
    send(c, { id: 4, method: "thread/clear", params: { threadId } });
    await tick();
    lines.length = 0;
    first.push(LIFECYCLE("started", "old-engine"));
    await tick();
    expect(notes(lines, "turn/started")).toHaveLength(0);   // the disposed engine is not listened to
    second.push(LIFECYCLE("started", "new-engine"));
    await tick();
    expect(notes(lines, "turn/started")).toHaveLength(1);   // the replacement is
  });

  it("a refusing thread adopts nothing", async () => {
    const e = pushEngine();
    const srv = boot(e.engine);
    const { lines, sink } = mkSink();
    const c = srv.connect(sink);
    send(c, { id: 1, method: "initialize", params: { clientInfo: { name: "t" } } });
    send(c, { id: 2, method: "thread/start", params: {} });     // default: refuse
    await tick();
    const threadId = parsed(lines).find((m) => m.id === 2)!.result.thread.id;
    send(c, { id: 3, method: "thread/subscribe", params: { threadId } });
    await tick();
    lines.length = 0;
    e.push(LIFECYCLE("started", "foreign-6"));
    await tick();
    expect(notes(lines, "turn/started")).toHaveLength(0);
  });
});

describe("adoption teardown", () => {
  it("thread/close settles an adopted turn instead of abandoning it", async () => {
    const e = pushEngine();
    const { c, lines, threadId, record } = await startAccepting(e.engine);
    e.push(LIFECYCLE("started", "foreign-7"));
    await tick();
    send(c, { id: 9, method: "thread/close", params: { threadId } });
    await tick();
    const done = notes(lines, "turn/completed");
    expect(done).toHaveLength(1);
    expect(done[0].params.turn.status).toBe("cancelled");
    // A thread/closed that goes out with a turn still open is a subscriber left holding a turn id that
    // never terminates — the edge must precede it.
    const methods = parsed(lines).map((m) => m.method);
    expect(methods.indexOf("turn/completed")).toBeLessThan(methods.indexOf("thread/closed"));
    expect(record.busy).toBe(false);
  });

  it("turn/interrupt on an adopted turn reports interrupted", async () => {
    const e = pushEngine();
    const { c, lines, threadId } = await startAccepting(e.engine);
    e.push(LIFECYCLE("started", "foreign-8"));
    await tick();
    send(c, { id: 9, method: "turn/interrupt", params: { threadId } });
    await tick();
    // The engine's own terminal is what actually ends the CLI's turn; the interrupt spine only asks.
    e.push(LIFECYCLE("cancelled", "foreign-8"));
    await tick();
    expect(parsed(lines).find((m) => m.id === 9)!.error).toBeUndefined();
    expect(notes(lines, "turn/completed")[0].params.turn.status).toBe("interrupted");
  });

  it("a stale-epoch lifecycle frame settles the thread rather than wedging it", async () => {
    const e = pushEngine();
    const { lines, record } = await startAccepting(e.engine);
    e.push(LIFECYCLE("started", "foreign-9"));
    await tick();
    record.epoch += 1;                        // as an engine swap would
    e.push(LIFECYCLE("completed", "foreign-9"));
    await tick();
    // The old assertion — "no completion was broadcast" — passes while the thread is permanently busy.
    // What has to be true is that the thread is USABLE.
    expect(record.busy).toBe(false);
    expect(record.peerInbound?.adopted).toBeUndefined();
    e.push(LIFECYCLE("started", "foreign-10"));
    await tick();
    expect(notes(lines, "turn/started").length).toBeGreaterThanOrEqual(2);
  });
});

describe("bounded state", () => {
  it("holds a bounded number of arrivals and drops the oldest", async () => {
    const e = pushEngine();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { record } = await startAccepting(e.engine);
    for (let i = 0; i < 200; i++) e.push({ type: "user", message: { role: "user", content: `<cross-session-message from="uds:/a.sock" from-session="s" hop-chain="a" from-name="n" from-mode="prompting">m${i}</cross-session-message>` } });
    await tick();
    expect(record.peerInbound.arrivals.length).toBeLessThanOrEqual(32);
    warn.mockRestore();
  });

  it("does not accumulate our own turn uuids across turns", async () => {
    const e = pushEngine();
    const { record } = await startAccepting(e.engine);
    for (let i = 0; i < 50; i++) {
      const u = `own-${i}`;
      (record.peerInbound.ourUuids as Set<string>).add(u);
      e.push(LIFECYCLE("started", u));
      e.push(LIFECYCLE("completed", u));
    }
    await tick();
    // Every own turn that reached a terminal has been forgotten. A set that only grows is a leak with no
    // signal, and a long-lived thread is exactly where it would not be noticed.
    expect((record.peerInbound.ourUuids as Set<string>).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/unit/appserver/peer-inbound.test.ts`
Expected: FAIL — `Cannot find module '.../peerInbound.js'`.

- [ ] **Step 3: Write `src/appserver/peerInbound.ts`**

```ts
// appserver/peerInbound.ts — an inbound peer message becomes a REAL turn.
//
// The engine does not wait for this server's chain. Every hard case here is the same shape: a frame
// arrives before the machinery that was going to handle it exists. The answer is always to record what
// happened synchronously and let the machinery drain it when it installs — never to assume ordering the
// read loop does not promise.
import { randomUUID } from "node:crypto";
import { TurnMapper } from "./items/mapper.js";
import { turnFailureOf } from "../session/turnResult.js";
import { beginTurn, emitItems } from "./turns.js";
import type { ThreadRecord } from "./registry.js";
import type { AppServer } from "./server.js";

/** How many un-adopted arrivals one thread holds. Attacker-influenced — any local process that can write
 *  this session's socket can produce them — so it is capped and oldest-first evicted, never grown. */
const MAX_ARRIVALS = 32;
/** How many frames one adopted turn captures while its runner is still behind the chain. Bounded for the
 *  same reason; a turn that overruns it loses the earliest frames rather than the process. */
const MAX_CAPTURED = 512;

interface Arrival { msgId: string; text: string; at: number }

interface AdoptedTurn {
  commandUuid: string;
  /** The `record.epoch` adoption started under. A frame that arrives after a swap belongs to a
   *  conversation that no longer exists, and acting on it would move a turn that is not this one. */
  epoch: number;
  captured: unknown[];
  mapper?: TurnMapper;
  turnId?: string;
  resolve?: (o: { stopped?: string; error?: { message: string } } | undefined) => void;
  /** Set when the terminal arrives. If the runner has not installed yet, this is what it resolves with
   *  the moment it does — the difference between a settled turn and a thread busy forever. */
  outcome?: { stopped?: string; error?: { message: string } };
  terminated: boolean;
}

export interface PeerInboundState {
  off?: () => void;
  offResult?: () => void;
  arrivals: Arrival[];
  /** The command uuids of turns THIS server submitted, so their lifecycle brackets are not adopted.
   *  Per-record (it dies with the thread) and deleted at each terminal (it does not grow with turns). */
  ourUuids: Set<string>;
  adopted?: AdoptedTurn;
}

const ENVELOPE = /<cross-session-message\s[^>]*>([\s\S]*?)<\/cross-session-message>/;

/** Record a uuid this server is about to submit under, so its own lifecycle bracket is recognised.
 *  Called from turns.ts's `submitRunner` beside the `randomUUID()` that mints it. */
export function notePeerTurnUuid(record: ThreadRecord, uuid: string): void {
  record.peerInbound?.ourUuids.add(uuid);
}

const isOurs = (state: PeerInboundState, frame: any): boolean =>
  // BOTH fields, because which one carries the submit uuid is not yet measured (Task 13's keyed half).
  // Under the wrong guess this over-adopts, and beginTurn's busy gate makes that a no-op — see the task
  // header. Under the right one it never adopts an own turn at all.
  state.ourUuids.has(String(frame.command_uuid)) || state.ourUuids.has(String(frame.uuid));

const forget = (state: PeerInboundState, frame: any): void => {
  state.ourUuids.delete(String(frame.command_uuid));
  state.ourUuids.delete(String(frame.uuid));
};

/** `queued` and `started` are the two non-terminal states probe 119b observed; anything else ends the
 *  bracket. Written as "not one of these" rather than as a list of terminals because the healthy
 *  terminal's NAME is a delegated unknown — only the failure path's `cancelled` has been seen — and a
 *  closed list would silently fail to settle a turn whose terminal is spelled something else. */
const isTerminalState = (s: unknown): boolean => s !== "queued" && s !== "started";

export function installPeerInbound(srv: AppServer, record: ThreadRecord): void {
  if (record.crossSessionInbound === "refuse") return;   // nothing is coming; observe nothing
  const state: PeerInboundState = record.peerInbound ?? { arrivals: [], ourUuids: new Set() };
  record.peerInbound = state;

  const onFrame = (frame: any): void => {
    if (!frame || typeof frame !== "object") return;

    if (frame.type === "command_lifecycle") {
      const adopted = state.adopted;
      if (adopted && String(frame.command_uuid) === adopted.commandUuid) {
        if (!isTerminalState(frame.state)) return;
        adopted.terminated = true;
        // A frame from a conversation that has been swapped out settles the turn as CANCELLED and clears
        // everything — the branch that used to clear only the uuid left `busy` true forever.
        if (record.epoch !== adopted.epoch) { settleAdopted(srv, record, "cancelled"); return; }
        const resolve = adopted.resolve;
        state.adopted = undefined;
        if (resolve) resolve(adopted.outcome);
        // else: the runner has not installed. It reads `outcome` off the object it still holds.
        return;
      }
      if (isOurs(state, frame)) { if (isTerminalState(frame.state)) forget(state, frame); return; }
      if (adopted) return;                               // one adopted turn at a time
      if (isTerminalState(frame.state)) return;          // a terminal for a bracket we never saw open
      adopt(srv, record, state, String(frame.command_uuid));
      return;
    }

    const adopted = state.adopted;
    if (adopted && !adopted.terminated) {
      if (adopted.mapper && adopted.turnId) {
        emitItems(srv, record, adopted.turnId, adopted.mapper.ingest(frame));
      } else if (adopted.captured.length < MAX_CAPTURED) {
        adopted.captured.push(frame);
      }
    }

    if (frame.type === "user") noteArrival(state, frame);
  };

  state.off = record.session.onFrame?.(onFrame);
  state.offResult = record.session.onUnclaimedResult?.((result: unknown) => {
    const adopted = state.adopted;
    if (!adopted || adopted.terminated) return false;
    // Normalized through the SAME reader ordinary turns use. A raw result stored and reported as "some
    // result arrived" makes `is_error` and an API error read as a clean completion.
    const failure = turnFailureOf(result);
    adopted.outcome = failure ? { error: failure } : undefined;
    if (adopted.mapper && adopted.turnId) emitItems(srv, record, adopted.turnId, adopted.mapper.ingest(result));
    else if (adopted.captured.length < MAX_CAPTURED) adopted.captured.push(result);
    return true;                                          // CLAIMED — this is what keeps it off the unmatched counter
  });
}

function noteArrival(state: PeerInboundState, frame: any): void {
  const content = frame?.message?.content;
  const text = typeof content === "string" ? content : JSON.stringify(content ?? "");
  const m = ENVELOPE.exec(text);
  if (!m) return;
  state.arrivals.push({ msgId: randomUUID(), text: m[1], at: Date.now() });
  // Oldest-first, and the drop is announced: a silently truncated queue reads to an operator exactly like
  // a queue nothing was ever written to.
  while (state.arrivals.length > MAX_ARRIVALS) {
    state.arrivals.shift();
    console.warn(`[peer] arrival queue full on thread ${state.arrivals.length}; dropped the oldest`);
  }
}

function adopt(srv: AppServer, record: ThreadRecord, state: PeerInboundState, commandUuid: string): void {
  const adopted: AdoptedTurn = { commandUuid, epoch: record.epoch, captured: [], terminated: false };
  state.adopted = adopted;
  const started = beginTurn(srv, undefined, undefined, record, (turnId, mapper, releaseSlot) => {
    // Released IMMEDIATELY: the slot's contract is to release the instant the engine call is dispatched,
    // and for an adopted turn there is no engine call of ours to dispatch. Holding it would park every
    // op chained behind this thread for the length of somebody ELSE's turn.
    releaseSlot();
    if (record.epoch !== adopted.epoch) return Promise.resolve({ stopped: "cancelled" });
    adopted.mapper = mapper;
    adopted.turnId = turnId;
    // Everything the engine said while we were behind the chain, in order, through the same mapper an
    // ordinary turn uses. This runs INSIDE the runner, which beginTurn invokes after it has broadcast
    // turn/started — so no item can precede the turn edge that owns it.
    const captured = adopted.captured;
    adopted.captured = [];
    for (const f of captured) emitItems(srv, record, turnId, mapper.ingest(f));
    // The arrivals this turn is carrying, as user items, now that a turn exists to carry them.
    const arrivals = state.arrivals.splice(0, state.arrivals.length);
    for (const a of arrivals) {
      emitItems(srv, record, turnId, [{ kind: "completed", item: { id: a.msgId, type: "userMessage", text: a.text } as any }]);
    }
    if (adopted.terminated) { state.adopted = undefined; return Promise.resolve(adopted.outcome); }
    return new Promise((resolve) => { adopted.resolve = resolve; });
  });
  // beginTurn refuses a busy thread. That is the safety net under the unmeasured uuid correlation: an
  // own turn mistaken for a foreign one is declined here rather than becoming a second turn.
  if (!started) state.adopted = undefined;
}

/** Settle an adopted turn from OUTSIDE the frame stream — a close, a shutdown, a stale epoch. Idempotent:
 *  a turn already settled has no resolver left to call. */
export function settleAdopted(srv: AppServer, record: ThreadRecord, reason: "cancelled" | "interrupted"): void {
  const adopted = record.peerInbound?.adopted;
  if (!adopted) return;
  record.peerInbound!.adopted = undefined;
  adopted.terminated = true;
  adopted.resolve?.({ stopped: reason });
}

export function uninstallPeerInbound(record: ThreadRecord): void {
  const state = record.peerInbound;
  if (!state) return;
  state.off?.(); state.off = undefined;
  state.offResult?.(); state.offResult = undefined;
  state.arrivals.length = 0;
}
```

- [ ] **Step 4: Wire it into the four lifecycle moments**

1. `src/appserver/registry.ts` — `peerInbound?: PeerInboundState` on `ThreadRecord` (optional; `fleet.ts` needs no seed).

2. `src/appserver/server.ts` — call `installPeerInbound(this, record)` in **both** admission spines, immediately after `installRouter`, so the two engines are observed by the same rule.

3. `src/appserver/rewind.ts`'s `swapEngine` — beside the two router lines it already has, and for the same reason:

```ts
  record.routerOff?.();
  uninstallPeerInbound(record);          // the outgoing engine is about to be disposed
  …
  installRouter(srv, record);
  installPeerInbound(srv, record);       // the replacement is a different engine; the old handle is deaf
```

Before the dispose, `settleAdopted(srv, record, "cancelled")` — a swap discards the conversation the adopted turn belonged to, and a turn whose conversation is gone must not be left open.

4. `src/appserver/server.ts`'s `closeRecord` (~line 1070, beside `record.routerOff?.()`) and the shutdown path:

```ts
    settleAdopted(this, record, "cancelled");   // the turn edge FIRST — before thread/closed goes out
    uninstallPeerInbound(record);
```

5. `src/appserver/turns.ts`'s `submitRunner`, beside the `const userUuid = randomUUID();` at ~line 452:

```ts
      notePeerTurnUuid(record, userUuid);   // so this turn's own lifecycle bracket is not adopted
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run test/unit/appserver/peer-inbound.test.ts`
Expected: PASS.

Run: `npx vitest run test/unit/appserver` then `npx vitest run test/unit` then `npx tsc --noEmit`
Expected: all green. The whole-`test/unit` run matters here and not in the earlier tasks: this one edits `turns.ts` and `rewind.ts`, which every turn and every swap in the suite goes through.

- [ ] **Step 6: Commit**

```bash
git add src/appserver/peerInbound.ts src/appserver/server.ts src/appserver/registry.ts src/appserver/rewind.ts src/appserver/turns.ts test/unit/appserver/peer-inbound.test.ts
git commit -m "feat(appserver): an inbound peer message becomes a real turn, and every way out of it settles"
```

---

### Task 10b: `thread/peerMessage` — the arrival notification the rewrite dropped

**Files:**
- Modify: `src/appserver/peerInbound.ts`, `docs/parity/appserver.md` (under `CC-to-SDK/`)
- Test: `test/unit/appserver/peer-inbound.test.ts` (extend)

**Interfaces:**
- Consumes: from Task 10: `installPeerInbound`, `PeerInboundState`, the arrival queue.
- Produces: the `thread/peerMessage` notification.

**Why this task exists.** The spec gives this notification its own section and four keyed acceptance legs are written against it, but the rev-6 rewrite of Task 10 authored an arrival path that never emits it — an omission, not a decision. Two things follow from leaving it out, and both are why this cannot wait for a later round:

- **The peer's identity never reaches a client at all.** `verifiedPeerPid` is the only field in the whole exchange the kernel vouches for; `from` is sender-authored and forgeable by any same-user process. Without this notification the one non-forgeable fact is read by this server and then discarded.
- **An arrival that causes no turn is announced on nothing.** A message that folds into a running turn, or that the CLI holds, produces no turn edge of its own, so a subscriber cannot distinguish "a message arrived and was absorbed" from "nothing happened".

**What the SDK gives us, and why the current parse should defer to it.** The replayed user frame (`SDKUserMessageReplay`) carries three fields this path should be using and currently is not:

- `uuid` — the frame's own transcript id. Task 10 mints a fresh `randomUUID()` for the arrival instead, which means the `userMessage` item it emits carries an id that will NOT match the one `thread/read` returns from the persisted transcript. The spec's whole reason for exposing `arrivalUuid` is that a client can deduplicate the live item against the replayed one; a minted id silently breaks that.
- `origin` — the `SDKMessageOrigin` union. Its `kind: "peer"` variant is the CLI's own signal that this is a cross-session message, which is a stronger discriminator than matching an envelope by regex.
- `origin.body` — "Decoded message body with the peer envelope stripped — byte-exact with what the model sees." That is exactly what the regex is reconstructing by hand, supplied by the process that did the framing.

The regex stays as a fallback, because `origin.body` is documented as present "only when the turn is exactly one harness-formed envelope" and this server does not control what a peer sends.

---

- [ ] **Step 1: Write the failing tests**

Append to `test/unit/appserver/peer-inbound.test.ts`. `PEER_FRAME` builds a replayed user frame the way the CLI does — note that `origin` is what makes it a peer message, and the envelope text is what a sender without an `origin` would produce:

```ts
const PEER_FRAME = (over: Record<string, unknown> = {}) => ({
  type: "user",
  uuid: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
  session_id: "s",
  isReplay: true,
  parent_tool_use_id: null,
  message: { role: "user", content: "<cross-session-message from=\"uds:/a.sock\" from-session=\"s1\" hop-chain=\"a\" from-name=\"peer\" from-mode=\"prompting\">hello</cross-session-message>" },
  origin: { kind: "peer", from: "uds:/a.sock", fromMode: "prompting", name: "peer", fromSession: "s1", body: "hello", verifiedPeerPid: 4242 },
  ...over,
});

describe("thread/peerMessage", () => {
  it("announces an arrival, carrying the origin verbatim", async () => {
    const e = pushEngine();
    const { lines } = await startAccepting(e.engine);
    e.push(PEER_FRAME());
    await tick();
    const note = notes(lines, "thread/peerMessage");
    expect(note).toHaveLength(1);
    // VERBATIM, not re-derived: verifiedPeerPid is the only field the kernel vouches for, and a
    // reconstructed origin would be this server's opinion of an identity it did not verify.
    expect(note[0].params.origin).toEqual({
      kind: "peer", from: "uds:/a.sock", fromMode: "prompting", name: "peer",
      fromSession: "s1", body: "hello", verifiedPeerPid: 4242,
    });
    expect(note[0].params.arrivalUuid).toBe("aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa");
    // No turnId, and there cannot be one: at arrival the message's fate is undecided.
    expect(note[0].params.turnId).toBeUndefined();
  });

  it("fires exactly once per message, even when a turn adopts it", async () => {
    const e = pushEngine();
    const { lines } = await startAccepting(e.engine);
    e.push(PEER_FRAME());
    e.push(LIFECYCLE("started", "foreign-b1"));
    await tick();
    e.pushResult(RESULT());
    e.push(LIFECYCLE("completed", "foreign-b1"));
    await tick();
    expect(notes(lines, "thread/peerMessage")).toHaveLength(1);
  });

  it("announces an arrival that never causes a turn", async () => {
    // THE CASE THAT MOTIVATES THE CHANNEL. No lifecycle frame follows, so there is no turn edge; without
    // this notification the arrival would be indistinguishable from silence.
    const e = pushEngine();
    const { lines } = await startAccepting(e.engine);
    e.push(PEER_FRAME());
    await tick();
    expect(notes(lines, "thread/peerMessage")).toHaveLength(1);
    expect(notes(lines, "turn/started")).toHaveLength(0);
  });

  it("the emitted item's id is the FRAME's uuid, so a client can dedupe against thread/read", async () => {
    const e = pushEngine();
    const { lines } = await startAccepting(e.engine);
    e.push(PEER_FRAME());
    e.push(LIFECYCLE("started", "foreign-b2"));
    await tick();
    const items = notes(lines, "item/completed").filter((m) => JSON.stringify(m.params).includes("hello"));
    expect(items).toHaveLength(1);
    expect(items[0].params.item.id).toBe("aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa");
  });

  it("prefers origin.body over re-parsing the envelope", async () => {
    const e = pushEngine();
    const { lines } = await startAccepting(e.engine);
    // The body and the envelope text deliberately disagree; the FRAMER's decoding wins.
    e.push(PEER_FRAME({ origin: { kind: "peer", from: "uds:/a.sock", body: "decoded by the framer" } }));
    e.push(LIFECYCLE("started", "foreign-b3"));
    await tick();
    expect(JSON.stringify(notes(lines, "item/completed"))).toContain("decoded by the framer");
  });

  it("falls back to the envelope when no origin is present", async () => {
    // origin.body is documented as present only when the turn is exactly one harness-formed envelope, and
    // this server does not control what a peer sends.
    const e = pushEngine();
    const { lines } = await startAccepting(e.engine);
    e.push(PEER_FRAME({ origin: undefined }));
    await tick();
    expect(notes(lines, "thread/peerMessage")).toHaveLength(1);
    expect(notes(lines, "thread/peerMessage")[0].params.origin).toBeUndefined();
  });

  it("says nothing about an ordinary local user frame", async () => {
    const e = pushEngine();
    const { lines } = await startAccepting(e.engine);
    e.push({ type: "user", uuid: "bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb", session_id: "s", isReplay: true, parent_tool_use_id: null, message: { role: "user", content: "just a local prompt" }, origin: { kind: "human" } });
    await tick();
    expect(notes(lines, "thread/peerMessage")).toHaveLength(0);
  });

  it("a refusing thread announces nothing", async () => {
    const e = pushEngine();
    const srv = boot(e.engine);
    const { lines, sink } = mkSink();
    const c = srv.connect(sink);
    send(c, { id: 1, method: "initialize", params: { clientInfo: { name: "t" } } });
    send(c, { id: 2, method: "thread/start", params: {} });
    await tick();
    const threadId = parsed(lines).find((m) => m.id === 2)!.result.thread.id;
    send(c, { id: 3, method: "thread/subscribe", params: { threadId } });
    await tick();
    lines.length = 0;
    e.push(PEER_FRAME());
    await tick();
    expect(notes(lines, "thread/peerMessage")).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run test/unit/appserver/peer-inbound.test.ts -t "thread/peerMessage"`
Expected: FAIL — no such notification is emitted.

- [ ] **Step 3: Emit it from the arrival path**

In `src/appserver/peerInbound.ts`, rewrite `noteArrival` so that it recognises a peer frame by the SDK's own signal, keeps the frame's identity, and announces the arrival:

```ts
/** Note one arrival; returns whether the frame was a cross-session message at all.
 *
 *  Recognition is `origin.kind === "peer"` FIRST — that is the CLI's own statement about the frame,
 *  and it is not reconstructible from the text. The envelope regex is the fallback for a sender whose
 *  host stamps no origin, which the SDK's own field docs say is possible. */
function noteArrival(srv: AppServer, record: ThreadRecord, state: PeerInboundState, frame: any): boolean {
  const origin = frame?.origin;
  const isPeer = origin?.kind === "peer";
  const content = frame?.message?.content;
  const text = typeof content === "string" ? content : JSON.stringify(content ?? "");
  const envelope = ENVELOPE.exec(text);
  if (!isPeer && !envelope) return false;

  // The FRAMER's decoding wins over ours: `origin.body` is documented byte-exact with what the model
  // saw, while the regex is this server's second-hand reconstruction of the same thing.
  const body = typeof origin?.body === "string" ? origin.body : (envelope ? envelope[1] : text);
  // The FRAME's own uuid, never a minted one. This id is what the transcript persists, and it is the id
  // the `userMessage` item below carries — which is the whole mechanism by which a client deduplicates
  // the live item against the one `thread/read` replays. A fresh uuid here would make every arrival
  // appear twice to any client that reads its own history.
  const arrivalUuid = typeof frame?.uuid === "string" ? frame.uuid : randomUUID();

  state.arrivals.push({ msgId: arrivalUuid, text: body.slice(0, MAX_FRAME_CHARS), at: Date.now() });
  while (state.arrivals.length > MAX_ARRIVALS) {
    state.arrivals.shift();
    console.warn(`[peer] arrival queue full on thread ${record.id} (cap ${MAX_ARRIVALS}); dropped the oldest`);
  }

  // ANNOUNCED HERE, at arrival, and with NO turnId — at this moment the message's fate is genuinely
  // undecided (it may fold into a running turn, batch with others, or cause a turn whose id does not
  // exist yet), so the field could only be fabricated, delayed, or null. A client correlates through
  // `arrivalUuid`, which is also the id of the item this arrival eventually produces.
  //
  // `origin` travels VERBATIM. `verifiedPeerPid` is the only field in this exchange the kernel vouches
  // for — `from` is sender-authored and forgeable by any same-user process — so re-deriving the object
  // would replace a verified fact with this server's opinion of it.
  srv.broadcast(record.id, "thread/peerMessage", {
    threadId: record.id,
    arrivalUuid,
    ...(origin !== undefined ? { origin } : {}),
  });
  return true;
}
```

Update its one caller to pass `srv`:

```ts
    if (frame.type === "user" && noteArrival(srv, record, state, frame)) drainArrivals(srv, record, state);
```

**Verify rather than assume:** that `srv.broadcast` is the right fan-out for this. It must reach the thread's SUBSCRIBERS, which is a different audience from the server-scoped watchers — an arrival is content, not the existence of a thread, and the images round already established that distinction. Read `src/appserver/fanout.ts` and confirm before settling on the call.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/unit/appserver/peer-inbound.test.ts`
Expected: PASS — Task 10's twelve plus this task's eight.

Run: `npx vitest run test/unit/appserver`, then `npx vitest run test/unit`, then `npx tsc --noEmit`.
Expected: all green, and the total is the prior baseline plus this task's new tests.

- [ ] **Step 5: Row it, and close gap 12**

Task 12 recorded this omission as gap 12 in `CC-to-SDK/docs/parity/appserver.md`'s "Notable gaps and discrepancies" section, and referenced it from `full-potential.md`. Now that the code sends the notification, add its row to the same server-origin table Task 12 appended to:

```
| `thread/peerMessage` | appserver/peerInbound.ts | `thread/peerMessage` | inProcess | shipped(M8) — an inbound peer message ARRIVED. Fires on the replayed user frame, once per message, to the thread's SUBSCRIBERS (content, not existence — `watchThreads` is existence fan-out, a distinction the images round established). Recognition is the SDK's own `origin.kind === "peer"`, with the envelope regex as the fallback for a sender whose host stamps no origin. Carries `origin` VERBATIM rather than re-derived, because `verifiedPeerPid` is the one field the kernel vouches for and the only non-forgeable identity in the exchange — `from` is sender-authored. **No `turnId`, and there cannot be one**: at arrival the message's fate is undecided (fold, batch, or a turn whose id does not exist yet), so the field could only be fabricated, delayed, or null. `arrivalUuid` is the replayed frame's OWN uuid, which is also the id of the `userMessage` item the arrival produces, so a client deduplicates against `thread/read` with it |
```

Then delete gap 12 and the reference to it, since the gap is closed rather than merely documented.

Run (from `CC-to-SDK/`): `node scripts/drift-check.mjs`
Expected: exit 0. Restate the Totals sweep from the gate's own printed tallies — the row count moves by one.

- [ ] **Step 6: Commit**

```bash
git add CC-to-SDK/harness/src/appserver/peerInbound.ts CC-to-SDK/harness/test/unit/appserver/peer-inbound.test.ts CC-to-SDK/docs/parity/appserver.md CC-to-SDK/docs/parity/full-potential.md
git commit -m "feat(appserver): an arrival is announced, carrying the one identity the kernel vouches for"
```

---

### Task 10c: One arrival, one text — the replay path adopts the framer's decoding too

**Files:**
- Modify: `src/appserver/items/replay.ts`
- Test: `test/unit/appserver/items-replay.test.ts` (or whichever file already covers `replay.ts` — find it rather than creating a second one)

**Interfaces:**
- Consumes: from Task 10b: the rule that a peer arrival's display text is `origin.body` when the framer supplied one.
- Produces: nothing new; it restores an invariant this file already declares.

**The defect, and why this file is where it is fixed.** Task 10b made the LIVE arrival item carry `origin.body` — the body the framing process already decoded, byte-exact with what the model saw. The COLD path still builds its item from the raw persisted text. Both items now carry the same id (the frame's `uuid`, which is the point of Task 10b) and different text. A client that deduplicates by id therefore keeps whichever copy it happened to see first, so the text a user reads depends on whether they were subscribed at the time.

`items/replay.ts` states the governing rule itself, in the comment above the very line that needs changing: *"the cold-vs-live id stitch rests on the two paths producing identical items."* Task 10b broke that for peer arrivals. This task restores it, on the side that is wrong — the live path is right, because the SDK's own field documentation says to render `origin.body` "instead of re-parsing the message text".

**This is measured, not inferred.** Persisted transcript rows for real cross-session messages on this machine carry `origin` with `kind: "peer"`, `body`, `verifiedPeerPid`, `msg_id`, `from`, `fromMode` and `name`. The raw persisted `content` additionally carries a CLI-added preamble (`"Another Claude session sent a message: <cross-session-message …>"`), which is a second, independent reason the raw text is the wrong thing to display: it is not what the peer sent, and it is not what `peer/send` wrote.

**Worth recording while you are here.** The persisted `origin` carries **`msg_id`**, which the installed SDK's `SDKMessageOrigin` peer variant does not declare. That is the sender's own correlation id — the same id `peer/send` mints and `peer/messageStatus` reports against — and it is strictly more useful for correlation than anything currently on the notification. Do not add it to the notification in this task; `origin` already travels verbatim, so it is already reaching clients. Record the undeclared field in the spec's `## Surprises & Discoveries` as Step 4.

---

- [ ] **Step 1: Write the failing test**

Find the existing test file for `items/replay.ts` and append. Build the persisted row the way the measurement above found it — preamble in `content`, decoded body in `origin`:

```ts
it("a replayed peer arrival displays the framer's decoded body, not the raw envelope", () => {
  const rows = [{
    type: "user",
    uuid: "cccccccc-1111-4111-8111-cccccccccccc",
    parent_tool_use_id: null,
    message: { role: "user", content: "Another Claude session sent a message: <cross-session-message from=\"uds:/a.sock\" from-session=\"s1\" hop-chain=\"a\" from-name=\"peer\" from-mode=\"prompting\">hello</cross-session-message>" },
    origin: { kind: "peer", from: "uds:/a.sock", fromMode: "prompting", name: "peer", body: "hello", verifiedPeerPid: 4242, msg_id: "m-1" },
  }];
  const items = replayItems(rows as never);
  const user = items.filter((i) => i.type === "userMessage");
  expect(user).toHaveLength(1);
  // The id is the frame's uuid — that is what makes the live/cold stitch possible at all.
  expect(user[0].id).toBe("cccccccc-1111-4111-8111-cccccccccccc");
  // And the TEXT must equal what the live path emits for the same arrival. Same id plus different text
  // is worse than either alone: a client that dedupes by id shows whichever copy arrived first, so the
  // rendered message depends on whether anyone happened to be subscribed.
  expect(user[0].text).toBe("hello");
  expect(user[0].text).not.toContain("cross-session-message");
  expect(user[0].text).not.toContain("Another Claude session sent");
});

it("an ordinary local user row is untouched by the peer rule", () => {
  const rows = [{
    type: "user",
    uuid: "dddddddd-1111-4111-8111-dddddddddddd",
    parent_tool_use_id: null,
    message: { role: "user", content: "just a local prompt" },
    origin: { kind: "human" },
  }];
  const user = replayItems(rows as never).filter((i) => i.type === "userMessage");
  expect(user[0].text).toBe("just a local prompt");
});

it("a peer row whose framer supplied no body falls back to the raw text", () => {
  // origin.body is documented as present only when the turn is exactly one harness-formed envelope.
  const rows = [{
    type: "user",
    uuid: "eeeeeeee-1111-4111-8111-eeeeeeeeeeee",
    parent_tool_use_id: null,
    message: { role: "user", content: "two envelopes, unframed" },
    origin: { kind: "peer", from: "uds:/a.sock" },
  }];
  const user = replayItems(rows as never).filter((i) => i.type === "userMessage");
  expect(user[0].text).toBe("two envelopes, unframed");
});
```

Adapt the import and the entry-point name to whatever the file actually exports — read it first.

- [ ] **Step 2: Run it to verify it fails**

Run the file with a `-t` filter on the new tests.
Expected: FAIL — the first test's `text` is the full preamble-plus-envelope string.

- [ ] **Step 3: Prefer the framer's decoding**

In `src/appserver/items/replay.ts`, at the `userItem(flattenForDisplay(content as UserTurnInput), String(f.uuid ?? ""))` line, take the body from `origin` when it is there:

```ts
      if (!hasToolResult) {
        // A PEER arrival's display text is the framer's, not ours — the same rule the live arrival path
        // follows (peerInbound.ts), and the reason this branch exists at all: the comment above says the
        // cold-vs-live id stitch rests on the two paths producing identical items, and these two paths
        // now agree on the text as well as the id. The raw persisted `content` additionally carries a
        // CLI-added preamble, so it is not what the peer sent either.
        const body = f.origin?.kind === "peer" && typeof f.origin.body === "string" ? f.origin.body : undefined;
        items.push(userItem(body ?? flattenForDisplay(content as UserTurnInput), String(f.uuid ?? "")));
        continue;
      }
```

**Verify rather than assume:** that `userItem`'s first parameter really is the display string on both paths, and that nothing else in this function or its callers re-derives the text from `content` afterwards. If the live and cold items differ in any other field for a peer row, say so in your report — the invariant is about the whole item, not only the text.

- [ ] **Step 4: Record the undeclared field**

Add to the spec's `## Surprises & Discoveries` in
`CC-to-SDK/docs/superpowers/specs/2026-08-26-agent-appserver-m8-cross-session-design.md`:

```
- **The persisted peer `origin` carries `msg_id`, which the SDK does not declare.** Measured on this
  machine's own transcripts (2026-08-27): a persisted cross-session row's `origin` holds
  `{kind, from, fromMode, name, body, verifiedPeerPid, msg_id}`, while the installed SDK's
  `SDKMessageOrigin` peer variant (sdk.d.ts 0.3.237) declares every one of those except `msg_id`. It is
  the sender's own correlation id — the same value `peer/send` mints and `peer/messageStatus` reports
  against — so a receiving client can tie an arrival to a specific send without this server correlating
  anything. It reaches clients already, because `thread/peerMessage` carries `origin` verbatim; it is
  recorded here because an undeclared field is one an SDK bump can remove without a type error.
- **The persisted `content` is not what the peer sent.** The CLI prefixes the envelope with
  `"Another Claude session sent a message: "` before persisting. Any path that renders a peer arrival
  from raw transcript text therefore shows a preamble the sender never wrote — which is the second
  reason, independent of the live/cold stitch, that `origin.body` is the display text.
```

- [ ] **Step 5: Gates and commit**

Run: the replay test file, then `npx vitest run test/unit/appserver`, then `npx vitest run test/unit`, then `npx tsc --noEmit`, then `node scripts/drift-check.mjs` from `CC-to-SDK/`.
Expected: all green; the gate's row count is unchanged by this task.

```bash
git add CC-to-SDK/harness/src/appserver/items/replay.ts CC-to-SDK/harness/test/unit/appserver/items-replay.test.ts CC-to-SDK/docs/superpowers/specs/2026-08-26-agent-appserver-m8-cross-session-design.md
git commit -m "fix(appserver): a peer arrival reads the same live and replayed"
```

---

### Task 10d: One rule, one reader — the live and cold paths stop agreeing by coincidence

**Files:**
- Modify: `src/peer/address.ts`, `src/appserver/peerInbound.ts`, `src/appserver/items/replay.ts`
- Test: `test/unit/peer/address.test.ts` (extend), `test/unit/appserver/items/replay.test.ts` (extend)

**Interfaces:**
- Produces, from `src/peer/address.ts`:
  - `peerArrival(frame: unknown): { text: string; uuid: string | undefined; origin: Record<string, unknown> | undefined } | undefined`
    — `undefined` when the frame is not a cross-session arrival at all.

**Why this task exists.** Tasks 10b and 10c made the live and replayed items for one arrival identical *for the measured shape*, by writing the same rule into two files. Task 10c's own report then named three inputs where the two still disagree, all of them the same defect the previous two tasks were fixing:

1. **Truncation.** The live path caps the body at `MAX_FRAME_CHARS`; the replay path does not. A body above that ceiling renders truncated live and complete when replayed — under the same id, which is precisely the condition that makes a client's dedup show whichever it saw first.
2. **Envelope fallback.** A peer row carrying `origin` but no `body` is envelope-stripped live and shown raw — CLI preamble included — when replayed. A row carrying an envelope but no `origin` at all is recognised as an arrival live and treated as an ordinary prompt when replayed.
3. **A non-string uuid** mints a random id live and yields the empty string cold.

Two files agreeing by construction is not the same as one rule. The fix is the one Task 10c's report proposed: a single function that decides what a peer arrival IS and what it reads as, called by both paths, so a future change cannot move one without the other.

**Why `src/peer/address.ts` is the home.** That module already owns the envelope in the outbound direction — `buildEnvelope`, the fixed attribute order, the escaping rules and `MAX_FRAME_CHARS`. The inbound reading of the same envelope is its mirror, and putting it anywhere else leaves the grammar split across two files that must not drift. It also keeps `src/appserver/items/replay.ts` free of any import from `appserver/peerInbound.ts`, which would be a new dependency from the cold path onto the live one.

---

- [ ] **Step 1: Write the failing tests**

Append to `test/unit/peer/address.test.ts`. This is where the rule now lives, so this is where its edges are pinned:

```ts
describe("peerArrival", () => {
  const ENVELOPE_TEXT = "<cross-session-message from=\"uds:/a.sock\" from-session=\"s1\" hop-chain=\"a\" from-name=\"peer\" from-mode=\"prompting\">hello</cross-session-message>";
  const row = (over: Record<string, unknown> = {}) => ({
    type: "user", uuid: "cccccccc-1111-4111-8111-cccccccccccc", parent_tool_use_id: null,
    message: { role: "user", content: `Another Claude session sent a message: ${ENVELOPE_TEXT}` },
    origin: { kind: "peer", from: "uds:/a.sock", body: "hello", verifiedPeerPid: 4242 },
    ...over,
  });

  it("prefers the framer's decoded body", () => {
    expect(peerArrival(row())!.text).toBe("hello");
  });

  it("strips the envelope when the framer supplied no body", () => {
    // The CLI-authored preamble goes with it: it is not what the peer sent.
    const a = peerArrival(row({ origin: { kind: "peer", from: "uds:/a.sock" } }))!;
    expect(a.text).toBe("hello");
  });

  it("recognises an arrival that carries an envelope but no origin", () => {
    // A sender whose host stamps no origin is still a peer. The live path already treated this as an
    // arrival; before this task the cold path read it as an ordinary local prompt.
    const a = peerArrival(row({ origin: undefined }))!;
    expect(a.text).toBe("hello");
    expect(a.origin).toBeUndefined();
  });

  it("truncates at the SAME ceiling on every input shape", () => {
    const long = "x".repeat(MAX_FRAME_CHARS + 500);
    expect(peerArrival(row({ origin: { kind: "peer", body: long } }))!.text).toHaveLength(MAX_FRAME_CHARS);
    const framed = `<cross-session-message from="uds:/a.sock" from-session="s" hop-chain="a" from-name="n" from-mode="prompting">${long}</cross-session-message>`;
    expect(peerArrival(row({ origin: undefined, message: { role: "user", content: framed } }))!.text).toHaveLength(MAX_FRAME_CHARS);
  });

  it("reports the frame's uuid, and undefined when it is not a string", () => {
    expect(peerArrival(row())!.uuid).toBe("cccccccc-1111-4111-8111-cccccccccccc");
    expect(peerArrival(row({ uuid: 7 }))!.uuid).toBeUndefined();
  });

  it("says nothing about an ordinary local user row", () => {
    expect(peerArrival(row({ origin: { kind: "human" }, message: { role: "user", content: "a local prompt" } }))).toBeUndefined();
  });

  it("says nothing about a non-user frame", () => {
    expect(peerArrival({ type: "assistant", origin: { kind: "peer" } })).toBeUndefined();
  });

  it("handles block-array content", () => {
    const a = peerArrival(row({ origin: undefined, message: { role: "user", content: [{ type: "text", text: ENVELOPE_TEXT }] } }))!;
    expect(a.text).toBe("hello");
  });
});
```

Then append to `test/unit/appserver/items/replay.test.ts` the two cases the cold path previously got wrong. Use the file's real entry point, `itemsFromTranscript`, and its whole-item `toEqual` style:

```ts
  it("reads an envelope-only peer row as an arrival, like the live path", () => {
    const rows = [{ type: "user", uuid: "ffffffff-1111-4111-8111-ffffffffffff", parent_tool_use_id: null,
      message: { role: "user", content: "Another Claude session sent a message: <cross-session-message from=\"uds:/a.sock\" from-session=\"s1\" hop-chain=\"a\" from-name=\"peer\" from-mode=\"prompting\">hello</cross-session-message>" } }];
    expect(itemsFromTranscript(rows as never).filter((i) => i.type === "userMessage"))
      .toEqual([{ type: "userMessage", id: "ffffffff-1111-4111-8111-ffffffffffff", text: "hello" }]);
  });

  it("truncates a replayed peer body at the same ceiling the live path uses", () => {
    const long = "y".repeat(MAX_FRAME_CHARS + 500);
    const rows = [{ type: "user", uuid: "99999999-1111-4111-8111-999999999999", parent_tool_use_id: null,
      message: { role: "user", content: "x" }, origin: { kind: "peer", from: "uds:/a.sock", body: long } }];
    expect(itemsFromTranscript(rows as never).filter((i) => i.type === "userMessage")[0].text).toHaveLength(MAX_FRAME_CHARS);
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run both files.
Expected: FAIL — `peerArrival` does not exist, and the two replay cases produce raw text and an untruncated body.

- [ ] **Step 3: Move the rule into `src/peer/address.ts`**

Add, beside `buildEnvelope` (whose mirror this is):

```ts
/** The envelope in the INBOUND direction — `buildEnvelope`'s mirror, and deliberately its neighbour so the
 *  grammar cannot drift between the two files that would otherwise each hold half of it. */
const ENVELOPE = /<cross-session-message\s[^>]*>([\s\S]*?)<\/cross-session-message>/;

/** What a frame IS, when it is a cross-session arrival — and `undefined` when it is not.
 *
 *  ONE reader for both paths (the live `onFrame` observer and the cold transcript replay). Before this
 *  existed the two agreed by construction, which is not the same as agreeing: they diverged on a body
 *  above the cap, on a row whose framer supplied no decoded body, and on a row carrying an envelope but
 *  no origin at all — each time producing two different texts under ONE id, which is exactly the input a
 *  client's id-dedup cannot resolve.
 *
 *  Recognition is `origin.kind === "peer"` first, because that is the CLI's own statement about the frame
 *  and is not reconstructible from text; the envelope match is the fallback for a sender whose host
 *  stamps no origin. The text is the framer's `body` when it supplied one — documented byte-exact with
 *  what the model saw — else the envelope's own capture, which also drops the CLI-authored
 *  "Another Claude session sent a message: " preamble that is not what the peer wrote. */
export function peerArrival(frame: unknown): { text: string; uuid: string | undefined; origin: Record<string, unknown> | undefined } | undefined {
  const f = frame as any;
  if (f?.type !== "user") return undefined;
  const origin = f.origin && typeof f.origin === "object" ? f.origin as Record<string, unknown> : undefined;
  const isPeer = origin?.kind === "peer";
  const content = f.message?.content;
  const raw = typeof content === "string" ? content : JSON.stringify(content ?? "");
  const envelope = ENVELOPE.exec(raw);
  if (!isPeer && !envelope) return undefined;
  const body = typeof origin?.body === "string" ? origin.body : (envelope ? envelope[1] : raw);
  return {
    // ONE ceiling, applied on every input shape. The body is written by a process this server does not
    // control, and a cap enforced on one path only is a cap that changes what a message says depending on
    // who is reading it.
    text: body.slice(0, MAX_FRAME_CHARS),
    uuid: typeof f.uuid === "string" ? f.uuid : undefined,
    origin,
  };
}
```

- [ ] **Step 4: Both callers read the one rule**

In `src/appserver/peerInbound.ts`, `noteArrival` keeps its queueing, capping and broadcasting, and delegates the *decision* — is this an arrival, and what does it read as — to `peerArrival`. Delete the module-private `ENVELOPE` regex and the inline body/uuid derivation; keep the `randomUUID()` fallback for a frame with no usable uuid, which is a live-only concern.

In `src/appserver/items/replay.ts`, the direct user-row branch asks the same function first:

```ts
      if (!hasToolResult) {
        // The SAME reader the live arrival path uses (peer/address.ts). Asking it here is what makes the
        // cold-vs-live id stitch this file's comment above depends on true for peer rows by construction
        // of one rule, rather than by two files happening to hold the same one.
        const arrival = peerArrival(f);
        items.push(arrival
          ? userItem(arrival.text, String(f.uuid ?? ""))
          : userItem(flattenForDisplay(content as UserTurnInput), String(f.uuid ?? "")));
        continue;
      }
```

**Verify rather than assume:** that no ordinary local user row can match `peerArrival`. A local prompt that merely quotes the string `<cross-session-message …>` — a transcript of this very work would — must still read as an ordinary prompt on both paths. If the envelope-only fallback makes that possible, say so and tighten the recognition rather than shipping it; a review prompt that pastes an envelope is a real row that exists in this repository's own transcripts.

- [ ] **Step 5: Gates and commit**

Run: both test files, then `npx vitest run test/unit/peer`, `npx vitest run test/unit/appserver`, `npx vitest run test/unit`, `npx tsc --noEmit`, then `node scripts/drift-check.mjs` from `CC-to-SDK/`.
Expected: all green; the gate's row count is unchanged.

```bash
git add CC-to-SDK/harness/src/peer/address.ts CC-to-SDK/harness/src/appserver/peerInbound.ts CC-to-SDK/harness/src/appserver/items/replay.ts CC-to-SDK/harness/test/unit/peer/address.test.ts CC-to-SDK/harness/test/unit/appserver/items/replay.test.ts
git commit -m "refactor(peer): one reader decides what an arrival is, and what it reads as"
```

---

### Task 11: The runtime policy setter — a spike first, then whichever implementation the measurement licenses

**BLOCKED until 2026-08-31 00:00 Asia/Seoul** (the account's weekly limit). Step 1 is keyed. Nothing else in the plan depends on this task: Stage B is complete and shippable without it, and `crossSessionInbound` is already decided at admission on both spines (Task 8) and reported by `thread/get`.

**Files (Step 1):**
- Create: `CC-to-SDK/probes/probes/120-runtime-inbound-policy.ts`

**Files (Step 3, only under verdict A):**
- Modify: `src/appserver/settings.ts`, `src/appserver/router.ts`, `src/appserver/schema/peer.ts`, `src/appserver/schema/index.ts`
- Test: `test/unit/appserver/peer-policy.test.ts` (extended)

**Why this is a spike and not an implementation.** A runtime setter has to write `crossSessionInbound` into the CLI's live flag layer through `applyFlagSettings` and have the CLI *re-read it* on the next inbound message. The first half is certain — this repository already drives `applyFlagSettings` for permissions, output style and effort level. The second half is not measured, and it is not inferable: probe 102 established that `applyFlagSettings` accepts values it never validates, so a resolved call is not evidence that anything took effect. Shipping the setter on that basis would put a method on the wire that reports success for a policy change that did not happen — the one failure mode a security-shaped knob cannot have.

---

- [ ] **Step 1: Build and run the measurement**

Create `CC-to-SDK/probes/probes/120-runtime-inbound-policy.ts`, modelled on `113c` (which already builds a receiver, sends an enveloped frame to it, and reports whether the body reached the model). The new legs:

- **Leg A — refuse ➜ accept.** Open a receiver with `crossSessionInbound: "refuse"`. Send a message; confirm nothing arrives. Call `applyFlagSettings({ crossSessionInbound: "accept" })` on the live session. Send a second message. **Does it arrive?**
- **Leg B — accept ➜ refuse.** The mirror image, which is the one that matters for safety: a policy that can be turned on at runtime but not off is worse than one that cannot move at all.
- **Leg C — the control.** A third receiver opened at `accept` from the start, to prove the send path itself is working in this run and that leg A's silence means "refused", not "misdelivered".

Record every leg's verdict verbatim in the spec's `## Surprises & Discoveries`, whichever way it goes.

Run: `cd CC-to-SDK/probes && npx tsx probes/120-runtime-inbound-policy.ts`
Expected output: a per-leg PASS/FAIL table and one overall verdict line.

- [ ] **Step 2: Apply the promote-or-discard criteria**

- **Verdict A — both legs move the policy.** The setter ships. Continue to Step 3.
- **Verdict B — the CLI latches the value at startup (leg A and/or leg B does not move).** The setter does **not** ship as a live write. Record the finding, and record the alternative it leaves: the same effect is reachable through the engine swap `settingsOps.ts` already performs for settings that require one — at the cost of a fresh CLI process per policy change. Do not build that here; open it as its own round with the measurement attached. Delete the probe's scaffolding but keep the probe file.
- **Verdict C — asymmetric** (say, off works and on does not). Ship only the direction that was measured, and name the missing direction on the wire — a method that silently no-ops in one direction is the failure this whole task exists to avoid.

Either way, add the verdict to the spec's Decision Log and close the spec's open item. Under B or C, also strike the setter row from the scorecard (Task 12) rather than leaving a row nothing implements.

- [ ] **Step 3 (verdict A only): Implement the setter on the canonical settings spine**

> **What actually landed: verdict C, so this step shipped NARROWED (2026-08-28).** Probes 120/120b found the
> re-read real but one-directional — every tightening move took effect, every loosening move was ignored in
> silence — so the method ships as a monotonic tightening ratchet, compared against the thread's CURRENT
> recorded value and refusing a loosening request `-32602` at arrival time. Two items below are dead as
> written and were NOT implemented: item 4's `installPeerInbound` branch (no transition the ratchet admits
> can need one, since loosening never happens) and the test bullet "`refuse` ➜ `accept` ➜ a foreign
> lifecycle frame **is** adopted" (that flip is now a refusal). Everything else in this step shipped as
> written, plus one addition the code demanded: the `refuse` branch settles an adopted turn before
> uninstalling the observer, because detaching the frame observer deafens this server to that turn's
> terminal and would otherwise leave the thread busy forever. The row this step's commit adds to the
> scorecard is the one Task 12 Step 2 deliberately deferred here.

The house has exactly one `thread/settings/changed` payload shape, built by two sites: `settings.ts`'s `broadcastSettings` (the client leg) and `router.ts`'s `routeSettingsMirror` (the engine leg). A setter that invents a fourth, partial payload gives one change two incompatible announcements. So:

1. Extend `broadcastSettings`'s payload with `crossSessionInbound: record.crossSessionInbound`, and extend `routeSettingsMirror`'s payload identically — reading the server's own mirror, not the frame, since the engine's settings mirror does not carry this key.
2. Write the setter beside the other three in `settings.ts`, following `modelSet` line for line: `safeParse` guard, registry lookup, `record.origin === "fleet"` ➜ `ERR.UNSUPPORTED_FOR_ORIGIN` (this server does not own a fleet thread's engine), then the body inside `record.chain.then`.
3. Inside the body, in this order: `await record.session.applyFlagSettings?.({ [SETTINGS_KEY]: value })`; then `record.crossSessionInbound = value`; then **`record.config = applyPeerPolicy(record.config, value)`** — without that line the next engine swap rebuilds from the launch config and silently restores the old policy (Task 8's header); then `record.updatedAt = nowSec()`; then `broadcastSettings(srv, record)`; then reply.
4. If the new value is `"refuse"` call `uninstallPeerInbound(record)`, and if it moves off `"refuse"` call `installPeerInbound(srv, record)` — the observer is installed conditionally on the policy (Task 10), so a policy that moves without it is a policy the arrival path never learns about.
5. Catch through `replyEngineThrow(record, ctx, id, e, ERR.INTERNAL)`, never a bare `replyError`: these bodies are chain-deferred, so the engine can die after dispatch's arrival-time gate let the request through, and a dead read loop owes the caller -33005, not -32603.

Tests to add to `test/unit/appserver/peer-policy.test.ts`:
- the full `thread/settings/changed` payload is **deep-equal** to the canonical five-key shape plus the new key, on **two** subscribers — a test that asserts only "some notification exists" passes while the payload is wrong;
- `updatedAt` moved;
- a dead engine answers `-33005` (drive it the way `settings.test.ts`'s dead-engine cases do);
- a fleet-origin thread answers `-33006`;
- `accept` ➜ `refuse` ➜ a foreign lifecycle frame is **not** adopted, and `refuse` ➜ `accept` ➜ a foreign lifecycle frame **is**;
- after the setter, an engine swap leaves the policy where the setter put it (compose through `swapBaseConfig`, as Task 8's durability test does).

- [ ] **Step 4: Gates and commit**

Run: `npx vitest run test/unit/appserver/peer-policy.test.ts`, then `npx vitest run test/unit/appserver`, then `npx tsc --noEmit`, then `npm run emit-schema` and commit the regenerated stable artifact (this task adds a method to `methodSchemas`).

```bash
git add CC-to-SDK/probes/probes/120-runtime-inbound-policy.ts
git commit -m "probe(120): does the CLI re-read crossSessionInbound off the live flag layer"
# then, under verdict A only:
git add src/appserver/settings.ts src/appserver/router.ts src/appserver/schema/peer.ts src/appserver/schema/index.ts test/unit/appserver/peer-policy.test.ts src/appserver/schema/json/stable/appserver.json
git commit -m "feat(appserver): the inbound policy moves at runtime, on the settings spine that already exists"
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
Expected: FAIL — the two new registered methods (`peer/list`, `peer/send`) have no scorecard row (the gate's bijection direction).

- [ ] **Step 2: Add the method rows**

In `CC-to-SDK/docs/parity/appserver.md`, in the **server-origin table** (the one whose seam-token column repeats the method name), add two rows after `thread/searchOccurrences`.

**A third row belongs to Task 11 and is not added here.** `thread/crossSessionInbound/set` ships only under
that task's verdict A, and Task 11 is blocked on a keyed measurement. The drift gate's bijection runs over
REGISTERED methods, so a row for a method no task has registered fails the gate exactly as a registered
method with no row does. Add its row in Task 11, in the same commit that registers it.

```
| `peer/list` | appserver/peerDomain.ts | `peer/list` | N/A | shipped(M8) — the machine's addressable sessions, read from `<claudeConfigDir()>/sessions/*.json` (never a hardcoded `~/.claude`: the tenant preset gives each tenant its own root, and scanning the literal home directory would list the wrong namespace and omit the right one). Fields beyond `address`/`alive`/`inboxBound`/`threadId`/`statusReachable` are projected VERBATIM when present and omitted when absent — the rows belong to another program, and a row that invents a default lies about a session we do not own. `alive` is pid + `procStart` under `LC_ALL=C TZ=UTC`, the same comparison `fleet/liveness.ts` makes and for the same reason. `aliveOnly` defaults false: a dead row is information — it is why an address stopped working — and `fleet/list` already sets that precedent. `statusReachable` is a TWO-part test, not a directory comparison: a peer is reachable for status only when its socket sits in our socket directory AND it resolves the same config root we publish our key under; a peer failing either can be sent to and can never answer |
| `peer/send` | appserver/peerDomain.ts | `peer/send` | N/A | shipped(M8) — writes one enveloped frame to a peer's inbox and **reports nothing more**: `delivered` is a literal `false`, because the CLI tells a sender nothing on the success path (measured — only `held` and `expired` produce a receipt at all), so any other value would be the wire's own lie. Target resolution copies `thread/attach`'s rule exactly — a SIMULTANEOUS filter over `sessionId`/`pid`/`address`/`name`, where more than one match is an error carrying the matches rather than a precedence, because a wrong guess delivers into somebody else's session. The envelope is assembled in the CLI's fixed attribute order (`from`, `from-session`, `hop-chain`, `from-name`, `from-mode`) and compared byte-exactly by the receiver, so attribute values are ESCAPED and a value carrying a control character is refused `-32602` rather than sent — a silently downgraded envelope is a permission decision made on wrong information. **`from-mode` is always `prompting`**, and there is no parameter of any spelling that changes it: this gateway runs no model and asks no permission, and `fromThreadId` is attribution only (`from-session`, `from-name`). The recorded consequence: every message this server sends is HELD by a `bypassPermissions` peer, and on a headless peer a hold expires. `msg_id` is a server-minted UUID — a non-UUID id comes back with no `orig_msg_id` and silently costs all correlation. `hop-chain` is never set (nothing here relays). Refuses `-32602` above a 60 000-character frame cap of our own, because the CLI's sender-side preflight belongs to the path we do not use and an oversize line meets the receiver's own cap, which drops it before the JSON is parsed and tells nobody |
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
Expected: exit 0. Tasks 12 and 10b both moved the row count; the Totals sweep should already be restated
from the gate's own tallies, and this run is the check that it was.

- [ ] **Step 4: Write the live file (keyless-skipping)**

Create `test/live/appserver-cross-session.test.ts`:

```ts
// test/live/appserver-cross-session.test.ts — M8's keyed acceptance. Gated exactly like every other live
// file: without a key the whole describe skips, so this runs in CI as a no-op and against a real engine
// when a key is present.
//
// Four of the spec's delegated unknowns close here, and each is ASSERTED rather than assumed, so a wrong
// guess is a red test rather than a silent divergence:
//   1. the healthy terminal `command_lifecycle` state's NAME (the measuring run was weekly-limited, so
//      only the failure path's `cancelled` has ever been seen);
//   2. what lifecycle a FOLDED message gets (it has no turn of its own);
//   3. whether a BATCH emits one bracket per command_uuid around one turn;
//   4. WHICH field of the lifecycle frame carries the uuid this server passed to `submit()` —
//      `command_uuid`, `uuid`, or neither. Task 10 matches against both and relies on beginTurn's busy
//      gate to make a wrong guess a no-op; this is the assertion that turns that safety net into a fact.
// Each is recorded into the spec's Surprises & Discoveries by the step that follows this file.
import { describe, it, expect } from "vitest";

const live = (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN) ? describe : describe.skip;

live("M8 cross-session, against a real engine", () => {
  it.todo("idle: peer/list shows this server's own thread with its threadId, peer/send reaches it, and the subscriber sees thread/peerMessage -> turn/started -> items -> turn/completed with unmatchedResults unchanged, then thread/read's persisted userMessage deep-equals the live one");
  it.todo("busy follow-up: a message delivered to a turn that ends without another round-trip produces two balanced lifecycles, no orphaned turn id, and unmatchedResults unchanged");
  it.todo("arrival-only: after thread/peerMessage lands, NO turn has started");
  it.todo("fold: a message delivered mid-turn with round-trips remaining produces thread/peerMessage and exactly one turn");
  it.todo("refuse: the same send into a crossSessionInbound:'refuse' thread produces no thread/peerMessage, no turn, and no receipt");
  it.todo("own turns are never adopted: a local turn/start emits exactly ONE turn/started, and its command_uuid or uuid equals the uuid this server submitted under");
  it.todo("records the healthy terminal state name, the folded lifecycle, the batched lifecycle, and which field carries the submit uuid, into the spec");
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
Expected: all legs PASS. Assert, and do not assume: the terminal state's name, the folded message's lifecycle frames, the batch's bracket count, and which lifecycle field carries the submit uuid.

If the uuid leg shows that NEITHER field carries it, say so plainly rather than working around it — that
result means own turns cannot be told from foreign ones by uuid at all, and adoption needs a different
discriminator. It does not break what shipped (the busy gate keeps a mis-adoption a no-op), but it is a
finding, not a detail.

- [ ] **Step 7: AFTER 2026-08-31 — record the four verdicts in the spec, and run Task 11's spike**

Add to the spec's `## Surprises & Discoveries` the measured answer to each delegated unknown. **Task 11 is unblocked by the same reset** — run its spike (probe 120) and apply its promote-or-discard criteria before finishing the branch, since its verdict decides whether a method and a scorecard row exist at all. Then write `## Outcomes & Retrospective` against the spec's original purpose, replacing its "Pending — written at finish." line.

- [ ] **Step 8: AFTER 2026-08-31 — commit and finish the branch**

```bash
git add test/live/appserver-cross-session.test.ts ../docs/superpowers/specs/2026-08-26-agent-appserver-m8-cross-session-design.md
git commit -m "test(m8): keyed acceptance green; the three delegated unknowns are now measured"
```
Then use doperpowers:finishing-a-development-branch.
