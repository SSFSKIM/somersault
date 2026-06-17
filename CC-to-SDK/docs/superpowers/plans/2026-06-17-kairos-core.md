# Kairos Mode Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a headless autonomous scheduled assistant — `cc-harness assistant` — that keeps one long-lived session working between human turns (self-paced by the proactive heartbeat), gates tool use with native `auto` mode (no human in the loop), and reports to the user through a dedicated Brief channel.

**Architecture:** A new `src/kairos/` module composing already-built substrate. `KairosAssistant` owns one `DaemonSupervisor` session configured via the supervisor's `sessionOptions` seam into "assistant" posture (`permissionMode: 'auto'`, persona appended to `systemPrompt`, a `cc-brief` MCP server injected), then drives it with the existing proactive loop. All user-visible output flows through a `BriefSink` (stdout by default), not raw assistant text.

**Tech Stack:** TypeScript (NodeNext ESM), `@anthropic-ai/claude-agent-sdk` `query`/`createSdkMcpServer`/`tool`, `zod/v4`, vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-17-kairos-core-design.md`

## Global Constraints

- **Permission gate is native `permissionMode: 'auto'`** (verified live 2026-06-17) — do NOT build a classifier. The optional denylist maps to `disallowedTools`, **empty by default**.
- **Compose existing substrate, no new deps.** Reuse `DaemonSupervisor` (`spawn`/`submit`/`startProactive`/`proactiveStatus`/`shutdown`), `applyProactivePersona`, and the `createSdkMcpServer`/`tool` pattern from `tasks/server.ts`.
- **ESM, `import { z } from "zod/v4"`** (not `"zod"`). MCP tool servers use `createSdkMcpServer({ name, version, tools })` with `tool(name, desc, zodShape, handler)`; handlers return `{ content: [{ type: "text", text }] }`.
- **No Prettier** — match the existing compact hand-style (single-line where the codebase does; inline `format!`-style). Never run a formatter.
- **Public API:** add the new Kairos exports to `src/index.ts` (the earlier packaging "frozen API" was scoped to that sub-project; a new feature adds exports). The dist build + `verify:pack` must still pass.
- **Deferred (out of scope, evidence-based):** calendar **cron** firing (32.5) and **push** (32.8). Live probes proved native `CronCreate` does not self-fire into a caller-owned streaming session and its durable `scheduled_tasks.json` is not written from a plain headless `query()`; push needs a transport (`disabledReason:'no_transport'` headlessly). Both belong to a follow-up "Kairos scheduling & notifications" sub-project that builds a harness-owned scheduler. The core's scheduled wakes come from the **proactive heartbeat** (already built + verified). Also deferred: Dream (32.9), channels (32.4), team-init.
- **Process:** commit to `main` (authorized; never branch, never push). Commit messages `feat(harness): …` style; **no `Co-Authored-By`/attribution lines**. Run `npm` from `CC-to-SDK/harness/`; `git` from repo root `CC-to-SDK/`. Reviews via codex `/codex:rescue --model gpt-5.5 --effort high`, falling back to a Claude reviewer if codex stalls.

---

## File Structure

- `harness/src/kairos/brief.ts` *(create)* — `BriefSink`/`BriefMessage` types, `stdoutBriefSink`, `buildBriefTools`, `createBriefMcpServer` (the `SendUserMessage` tool).
- `harness/src/kairos/persona.ts` *(create)* — `ASSISTANT_SECTION`, `applyAssistantPersona`.
- `harness/src/kairos/safety.ts` *(create)* — `PostureConfig`, `resolveAssistantPosture`.
- `harness/src/kairos/assistant.ts` *(create)* — `KairosConfig`, `KairosAssistant` orchestrator.
- `harness/src/kairos/index.ts` *(create)* — re-exports.
- `harness/src/index.ts` *(modify)* — add Kairos exports.
- `harness/src/cli.ts` *(modify)* — `assistant` subcommand.
- Tests: `harness/test/unit/kairos-brief.test.ts`, `kairos-persona.test.ts`, `kairos-safety.test.ts`, `kairos-assistant.test.ts` *(create)*; `harness/test/live/kairos.test.ts` *(create)*.

---

## Task 1: Brief output channel

The user-visible output surface. Mirrors `tasks/server.ts` exactly.

**Files:**
- Create: `harness/src/kairos/brief.ts`
- Test: `harness/test/unit/kairos-brief.test.ts`

**Interfaces:**
- Produces: `interface BriefSink { write(msg: BriefMessage): void | Promise<void> }`; `interface BriefMessage { text: string; status: "normal" | "proactive"; at?: number }`; `type BriefStatus = "normal" | "proactive"`; `const stdoutBriefSink: BriefSink`; `buildBriefTools(sink): SdkTool[]` (each has `.name`/`.handler`); `createBriefMcpServer(sink)` → an sdk server named `cc-brief`. Consumed by Task 4.

- [ ] **Step 1: Write the failing test**

Create `harness/test/unit/kairos-brief.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildBriefTools, createBriefMcpServer, stdoutBriefSink } from "../../src/kairos/brief.js";

function tools(sink: any) { const m: Record<string, any> = {}; for (const t of buildBriefTools(sink)) m[t.name] = t; return m; }

describe("brief channel", () => {
  it("exposes the SendUserMessage tool", () => {
    expect(Object.keys(tools({ write() {} }))).toEqual(["SendUserMessage"]);
  });
  it("createBriefMcpServer returns an sdk server named cc-brief", () => {
    const srv: any = createBriefMcpServer({ write() {} });
    expect(srv.type).toBe("sdk");
    expect(srv.name).toBe("cc-brief");
  });
  it("routes message to the sink with default status normal", async () => {
    const msgs: any[] = [];
    const t = tools({ write: (m: any) => { msgs.push(m); } });
    const res = await t.SendUserMessage.handler({ message: "hi" }, {});
    expect(msgs).toEqual([{ text: "hi", status: "normal" }]);
    expect(res.content[0].text).toBe("delivered");
  });
  it("passes through proactive status", async () => {
    const msgs: any[] = [];
    const t = tools({ write: (m: any) => { msgs.push(m); } });
    await t.SendUserMessage.handler({ message: "u", status: "proactive" }, {});
    expect(msgs[0].status).toBe("proactive");
  });
  it("ships a default stdout sink", () => { expect(typeof stdoutBriefSink.write).toBe("function"); });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/new/Documents/GitHub/codex_somersault/CC-to-SDK/harness && npx vitest run test/unit/kairos-brief.test.ts`
Expected: FAIL — cannot resolve `../../src/kairos/brief.js`.

- [ ] **Step 3: Implement `brief.ts`**

Create `harness/src/kairos/brief.ts`:

```ts
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod/v4";

export type BriefStatus = "normal" | "proactive";
export interface BriefMessage { text: string; status: BriefStatus; at?: number }
export interface BriefSink { write(msg: BriefMessage): void | Promise<void> }

/** Default sink: print to stdout, tagging proactive messages (the push-eligibility signal). */
export const stdoutBriefSink: BriefSink = {
  write(msg) { process.stdout.write(`[brief${msg.status === "proactive" ? ":proactive" : ""}] ${msg.text}\n`); },
};

const sendUserMessageShape = { message: z.string(), status: z.enum(["normal", "proactive"]).optional() };

/** Exported for direct handler testing (mirrors tasks/server.ts buildTaskTools). */
export function buildBriefTools(sink: BriefSink) {
  return [
    tool("SendUserMessage",
      "Send a user-visible message through the Brief channel. Use status 'proactive' for messages worth a push notification; 'normal' otherwise.",
      sendUserMessageShape,
      async (args) => { await sink.write({ text: args.message, status: args.status ?? "normal" }); return { content: [{ type: "text" as const, text: "delivered" }] }; }),
  ];
}

/** Wrap a BriefSink as an in-process SDK MCP server exposing the SendUserMessage tool. */
export function createBriefMcpServer(sink: BriefSink) {
  return createSdkMcpServer({ name: "cc-brief", version: "0.1.0", tools: buildBriefTools(sink) });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/unit/kairos-brief.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/new/Documents/GitHub/codex_somersault/CC-to-SDK
git add harness/src/kairos/brief.ts harness/test/unit/kairos-brief.test.ts
git commit -m "feat(harness): kairos Brief output channel (SendUserMessage MCP tool + BriefSink)"
```

---

## Task 2: Assistant persona

The systemPrompt append that latches "assistant" behavior. Mirrors `applyProactivePersona`.

**Files:**
- Create: `harness/src/kairos/persona.ts`
- Test: `harness/test/unit/kairos-persona.test.ts`

**Interfaces:**
- Consumes: `applyProactivePersona(options)` from `../proactive/prompts.js` (sets `systemPrompt` to `{ type:"preset", preset:"claude_code", append: AUTONOMOUS_SECTION }`, where `AUTONOMOUS_SECTION` contains "autonomous heartbeat" and "IDLE").
- Produces: `const ASSISTANT_SECTION: string` (contains "SendUserMessage"); `applyAssistantPersona(options: Record<string, unknown>): void`. Consumed by Task 4.

- [ ] **Step 1: Write the failing test**

Create `harness/test/unit/kairos-persona.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { applyProactivePersona } from "../../src/proactive/prompts.js";
import { applyAssistantPersona, ASSISTANT_SECTION } from "../../src/kairos/persona.js";

describe("assistant persona", () => {
  it("creates a claude_code preset append when systemPrompt is unset", () => {
    const o: Record<string, unknown> = {};
    applyAssistantPersona(o);
    expect(o.systemPrompt).toEqual({ type: "preset", preset: "claude_code", append: ASSISTANT_SECTION });
  });
  it("composes after the proactive persona (both sections present, proactive first)", () => {
    const o: Record<string, unknown> = {};
    applyProactivePersona(o);
    applyAssistantPersona(o);
    const append = (o.systemPrompt as any).append as string;
    expect(append).toContain("autonomous heartbeat");   // proactive section
    expect(append).toContain("SendUserMessage");          // assistant section
    expect(append.indexOf("autonomous heartbeat")).toBeLessThan(append.indexOf("SendUserMessage"));
  });
  it("appends to an existing string systemPrompt", () => {
    const o: Record<string, unknown> = { systemPrompt: "BASE" };
    applyAssistantPersona(o);
    expect(o.systemPrompt).toBe("BASE\n\n" + ASSISTANT_SECTION);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/unit/kairos-persona.test.ts`
Expected: FAIL — cannot resolve `../../src/kairos/persona.js`.

- [ ] **Step 3: Implement `persona.ts`**

Create `harness/src/kairos/persona.ts`:

```ts
/** Assistant-mode standing instructions (parity 32.1/32.3). Applied as a systemPrompt append at spawn,
 *  alongside applyProactivePersona (which carries the heartbeat/IDLE contract). */
export const ASSISTANT_SECTION = [
  "You are running as an autonomous scheduled assistant (Kairos mode); no human is watching in real time.",
  "Report progress, results, and anything the user should see by calling the SendUserMessage tool (the Brief channel) — plain assistant text is NOT surfaced to the user in this mode.",
  "Use status \"proactive\" for messages worth a push notification; status \"normal\" otherwise.",
  "On a heartbeat tick with nothing useful to do, reply with exactly IDLE so the loop backs off; never ask the human questions on a tick.",
].join(" ");

/** Mutate resolved SDK options to append the assistant section (mirrors applyProactivePersona). */
export function applyAssistantPersona(options: Record<string, unknown>): void {
  const sp = options.systemPrompt as { type?: string; preset?: string; append?: string } | string | undefined;
  if (sp && typeof sp === "object") {
    options.systemPrompt = { ...sp, append: (sp.append ? sp.append + "\n\n" : "") + ASSISTANT_SECTION };
  } else if (typeof sp === "string") {
    options.systemPrompt = sp + "\n\n" + ASSISTANT_SECTION;
  } else {
    options.systemPrompt = { type: "preset", preset: "claude_code", append: ASSISTANT_SECTION };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/unit/kairos-persona.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/new/Documents/GitHub/codex_somersault/CC-to-SDK
git add harness/src/kairos/persona.ts harness/test/unit/kairos-persona.test.ts
git commit -m "feat(harness): kairos assistant persona (systemPrompt append)"
```

---

## Task 3: Safety posture

Forces native `auto`; refuses silent `bypass`. The denylist is optional/empty (not a security boundary — see spec §2/§5.5).

**Files:**
- Create: `harness/src/kairos/safety.ts`
- Test: `harness/test/unit/kairos-safety.test.ts`

**Interfaces:**
- Produces: `interface PostureConfig { permissionMode?: string; allowBypass?: boolean; denyTools?: string[] }`; `resolveAssistantPosture(config?: PostureConfig): { permissionMode: string; disallowedTools?: string[] }`. Consumed by Task 4.

- [ ] **Step 1: Write the failing test**

Create `harness/test/unit/kairos-safety.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveAssistantPosture } from "../../src/kairos/safety.js";

describe("assistant safety posture", () => {
  it("defaults to permissionMode auto with no denylist", () => {
    expect(resolveAssistantPosture()).toEqual({ permissionMode: "auto" });
  });
  it("maps denyTools to disallowedTools", () => {
    expect(resolveAssistantPosture({ denyTools: ["Bash(rm *)"] })).toEqual({ permissionMode: "auto", disallowedTools: ["Bash(rm *)"] });
  });
  it("ignores an empty denyTools array", () => {
    expect(resolveAssistantPosture({ denyTools: [] })).toEqual({ permissionMode: "auto" });
  });
  it("refuses bypassPermissions without allowBypass", () => {
    expect(() => resolveAssistantPosture({ permissionMode: "bypassPermissions" })).toThrow(/bypass/i);
  });
  it("permits bypass only with explicit allowBypass escalation", () => {
    expect(resolveAssistantPosture({ permissionMode: "bypassPermissions", allowBypass: true })).toEqual({ permissionMode: "bypassPermissions" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/unit/kairos-safety.test.ts`
Expected: FAIL — cannot resolve `../../src/kairos/safety.js`.

- [ ] **Step 3: Implement `safety.ts`**

Create `harness/src/kairos/safety.ts`:

```ts
export interface PostureConfig { permissionMode?: string; allowBypass?: boolean; denyTools?: string[] }

/** Resolve the autonomous-mode permission posture: always native `auto` (the model classifier governs),
 *  unless the caller explicitly escalates to bypass. The denylist is optional defense-in-depth, not a
 *  security boundary (a regex deny is trivially bypassable; the sandbox is the real hardening). */
export function resolveAssistantPosture(config: PostureConfig = {}): { permissionMode: string; disallowedTools?: string[] } {
  if (config.permissionMode === "bypassPermissions" && !config.allowBypass)
    throw new Error("Kairos refuses bypassPermissions in autonomous mode without allowBypass:true");
  const permissionMode = config.permissionMode === "bypassPermissions" ? "bypassPermissions" : "auto";
  const out: { permissionMode: string; disallowedTools?: string[] } = { permissionMode };
  if (config.denyTools && config.denyTools.length) out.disallowedTools = config.denyTools;
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/unit/kairos-safety.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/new/Documents/GitHub/codex_somersault/CC-to-SDK
git add harness/src/kairos/safety.ts harness/test/unit/kairos-safety.test.ts
git commit -m "feat(harness): kairos safety posture (force auto, refuse silent bypass)"
```

---

## Task 4: KairosAssistant orchestrator + public exports

Composes Tasks 1–3 onto a `DaemonSupervisor` session + the proactive loop.

**Files:**
- Create: `harness/src/kairos/assistant.ts`, `harness/src/kairos/index.ts`
- Modify: `harness/src/index.ts`
- Test: `harness/test/unit/kairos-assistant.test.ts`

**Interfaces:**
- Consumes: `DaemonSupervisor` from `../daemon/supervisor.js` — `new DaemonSupervisor({ query }, { sessionOptions, idleTimeoutMs })`; `spawn({ model? }) → id`; `submit(id, prompt, onMessage) → Promise<{result}>`; `startProactive(id, config?) → ProactiveStatus`; `proactiveStatus(id) → ProactiveStatus | undefined`; `shutdown() → Promise<void>`. `QueryFn` from `../swarm/types.js`. `ProactiveConfigInput`/`ProactiveStatus` from `../proactive/types.js`. `applyProactivePersona` from `../proactive/prompts.js`. Tasks 1–3 outputs.
- Produces: `interface KairosConfig { cwd?; model?; sink?: BriefSink; proactive?: ProactiveConfigInput; posture?: PostureConfig }`; `class KairosAssistant` with `constructor(deps:{query:QueryFn}, config?)`, `start(seedPrompt?) → Promise<void>`, `status() → { sessionId?; proactive? }`, `stop() → Promise<void>`. Consumed by Task 5.

- [ ] **Step 1: Write the failing test**

Create `harness/test/unit/kairos-assistant.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { KairosAssistant } from "../../src/kairos/assistant.js";

/** Fake query: capture the FIRST spawned session's options; consume its input queue so dispose() ends. */
function fakeQueryCapturing() {
  const captured: { options?: any } = {};
  const query = ((arg: any) => {
    if (!captured.options) captured.options = arg.options;
    return (async function* () { for await (const _ of arg.prompt) { /* swallow turns; emit no result */ } })();
  }) as any;
  return { query, captured };
}

describe("KairosAssistant orchestration", () => {
  it("spawns a session in assistant posture (auto + cc-brief + persona + allowlist)", async () => {
    const { query, captured } = fakeQueryCapturing();
    const k = new KairosAssistant({ query }, { cwd: "/tmp/kairos-x", proactive: { intervalMs: 999_999 } });
    await k.start();
    const o = captured.options;
    expect(o.permissionMode).toBe("auto");
    expect(o.cwd).toBe("/tmp/kairos-x");
    expect(o.mcpServers["cc-brief"]).toBeTruthy();
    expect(o.allowedTools).toContain("mcp__cc-brief__SendUserMessage");
    expect(JSON.stringify(o.systemPrompt)).toMatch(/SendUserMessage/);
    expect(JSON.stringify(o.systemPrompt)).toMatch(/IDLE/);
    await k.stop();
  });

  it("reports a running heartbeat after start; stop() is idempotent", async () => {
    const { query } = fakeQueryCapturing();
    const k = new KairosAssistant({ query }, { proactive: { intervalMs: 999_999 } });
    await k.start();
    expect(k.status().proactive?.state).toBe("running");
    await k.stop();
    await k.stop(); // idempotent — must not throw
    expect(k.status().sessionId).toBeTruthy();
  });

  it("rejects a second start()", async () => {
    const { query } = fakeQueryCapturing();
    const k = new KairosAssistant({ query }, { proactive: { intervalMs: 999_999 } });
    await k.start();
    await expect(k.start()).rejects.toThrow(/already started/);
    await k.stop();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/unit/kairos-assistant.test.ts`
Expected: FAIL — cannot resolve `../../src/kairos/assistant.js`.

- [ ] **Step 3: Implement `assistant.ts` and `kairos/index.ts`**

Create `harness/src/kairos/assistant.ts`:

```ts
import { DaemonSupervisor } from "../daemon/supervisor.js";
import type { QueryFn } from "../swarm/types.js";
import type { ProactiveConfigInput, ProactiveStatus } from "../proactive/types.js";
import { applyProactivePersona } from "../proactive/prompts.js";
import { applyAssistantPersona } from "./persona.js";
import { resolveAssistantPosture } from "./safety.js";
import type { PostureConfig } from "./safety.js";
import { createBriefMcpServer, stdoutBriefSink } from "./brief.js";
import type { BriefSink } from "./brief.js";

export interface KairosConfig {
  cwd?: string;
  model?: string;
  sink?: BriefSink;
  proactive?: ProactiveConfigInput;
  posture?: PostureConfig;
}

/** Autonomous scheduled assistant: one long-lived session, self-paced by the proactive heartbeat,
 *  permission-gated by native `auto`, reporting through the Brief channel. */
export class KairosAssistant {
  private sup: DaemonSupervisor;
  private model?: string;
  private proactiveCfg?: ProactiveConfigInput;
  private id?: string;
  private stopped = false;

  constructor(deps: { query: QueryFn }, config: KairosConfig = {}) {
    const sink = config.sink ?? stdoutBriefSink;
    this.model = config.model;
    this.proactiveCfg = config.proactive;
    // Build the COMPLETE assistant session options (a daemon session's base is only { model }).
    const sessionOptions = (_id: string): Record<string, unknown> => {
      const opts: Record<string, unknown> = {};
      if (config.cwd) opts.cwd = config.cwd;
      applyProactivePersona(opts);                 // heartbeat/IDLE contract
      applyAssistantPersona(opts);                 // assistant + Brief instructions
      Object.assign(opts, resolveAssistantPosture(config.posture)); // permissionMode 'auto' (+ optional denylist)
      opts.mcpServers = { "cc-brief": createBriefMcpServer(sink) };
      opts.allowedTools = ["mcp__cc-brief__SendUserMessage"]; // never let the Brief channel be gated
      return opts;
    };
    this.sup = new DaemonSupervisor(deps, { sessionOptions, idleTimeoutMs: 0 }); // 0 → no idle reaper
  }

  async start(seedPrompt?: string): Promise<void> {
    if (this.id) throw new Error("KairosAssistant already started");
    this.id = this.sup.spawn({ model: this.model });
    if (seedPrompt) await this.sup.submit(this.id, seedPrompt, () => {}); // seed context; output via the sink
    this.sup.startProactive(this.id, this.proactiveCfg);
  }

  status(): { sessionId?: string; proactive?: ProactiveStatus } {
    return { sessionId: this.id, proactive: this.id ? this.sup.proactiveStatus(this.id) : undefined };
  }

  async stop(): Promise<void> {
    if (this.stopped) return;        // idempotent
    this.stopped = true;
    await this.sup.shutdown();        // stops the heartbeat loop + disposes the session
  }
}
```

Create `harness/src/kairos/index.ts`:

```ts
export { KairosAssistant } from "./assistant.js";
export type { KairosConfig } from "./assistant.js";
export { applyAssistantPersona, ASSISTANT_SECTION } from "./persona.js";
export { resolveAssistantPosture } from "./safety.js";
export type { PostureConfig } from "./safety.js";
export { buildBriefTools, createBriefMcpServer, stdoutBriefSink } from "./brief.js";
export type { BriefSink, BriefMessage, BriefStatus } from "./brief.js";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/unit/kairos-assistant.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Add the public exports**

In `harness/src/index.ts`, append these two lines after the existing `daemon` export line:

```ts
export { KairosAssistant, createBriefMcpServer, stdoutBriefSink, applyAssistantPersona, resolveAssistantPosture } from "./kairos/index.js";
export type { KairosConfig, BriefSink, BriefMessage, BriefStatus, PostureConfig } from "./kairos/index.js";
```

- [ ] **Step 6: Verify typecheck + full unit suite green**

Run: `npm run typecheck`
Expected: exits 0.

Run: `npm run test:unit`
Expected: all pass (existing 222 + the new kairos unit tests).

- [ ] **Step 7: Commit**

```bash
cd /Users/new/Documents/GitHub/codex_somersault/CC-to-SDK
git add harness/src/kairos/assistant.ts harness/src/kairos/index.ts harness/src/index.ts harness/test/unit/kairos-assistant.test.ts
git commit -m "feat(harness): KairosAssistant orchestrator + public exports"
```

---

## Task 5: CLI `assistant` subcommand + live test

Wires the engine to `cc-harness assistant` and proves it end-to-end against the real SDK.

**Files:**
- Modify: `harness/src/cli.ts`
- Test: `harness/test/live/kairos.test.ts`

**Interfaces:**
- Consumes: `KairosAssistant` (Task 4); `query` from `@anthropic-ai/claude-agent-sdk`.
- Produces: `cc-harness assistant [--cwd <dir>] [--model <m>] [--allow-bypass] ["<seed>"]` — starts an autonomous assistant until SIGINT/SIGTERM.

- [ ] **Step 1: Write the failing live test**

Create `harness/test/live/kairos.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KairosAssistant } from "../../src/kairos/assistant.js";
import type { BriefMessage } from "../../src/kairos/brief.js";

const live = process.env.ANTHROPIC_API_KEY ? describe : describe.skip;

live("live kairos (real SDK)", () => {
  it("a heartbeat tick reports through the Brief channel under permissionMode auto", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "kairos-live-"));
    const briefs: BriefMessage[] = [];
    const k = new KairosAssistant({ query }, {
      cwd,
      sink: { write: (m) => { briefs.push(m); } },
      proactive: {
        tickPrompt: "Call the SendUserMessage tool with message exactly HEARTBEAT_BRIEF and status normal. Then reply with exactly IDLE.",
        intervalMs: 1500,
        idleBackoff: { stopAfterIdle: 100 },
      },
    });
    await k.start();

    const sawBrief = await new Promise<boolean>((resolve) => {
      const t0 = Date.now();
      const poll = () => {
        if (briefs.some((b) => /HEARTBEAT_BRIEF/.test(b.text))) return resolve(true);
        if (Date.now() - t0 > 90_000) return resolve(false);
        setTimeout(poll, 2000);
      };
      poll();
    });
    expect(sawBrief).toBe(true); // a real autonomous tick delivered a Brief, no human in the loop

    await k.stop();
  }, 120_000);
});
```

- [ ] **Step 2: Run the live test to verify it fails for the right reason**

Run: `set -a && . /Users/new/Documents/GitHub/codex_somersault/CC-to-SDK/.env && set +a && cd /Users/new/Documents/GitHub/codex_somersault/CC-to-SDK/harness && npx vitest run test/live/kairos.test.ts`
Expected: FAIL — the test imports `KairosAssistant` (exists from Task 4) but the CLI subcommand isn't built yet; this step confirms the live harness wiring compiles and runs. (If `ANTHROPIC_API_KEY` is unset it SKIPS — set it via the `.env` as shown.) Once the engine works the test should PASS even before the CLI step, since it drives `KairosAssistant` directly; if it already passes here, that is acceptable — proceed to wire the CLI.

- [ ] **Step 3: Add the `assistant` subcommand to `cli.ts`**

In `harness/src/cli.ts`, add this import near the other local imports (after the daemon imports):

```ts
import { KairosAssistant } from "./kairos/index.js";
```

Add this function just above `async function main()`:

```ts
/** `cc-harness assistant [--cwd dir] [--model m] [--allow-bypass] ["<seed>"]` — run an autonomous assistant. */
async function runAssistant(args: string[]): Promise<void> {
  let cwd: string | undefined, model: string | undefined, allowBypass = false, seed: string | undefined;
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === "--cwd") cwd = args[++i];
    else if (a === "--model") model = args[++i];
    else if (a === "--allow-bypass") allowBypass = true;
    else if (!a.startsWith("--") && seed === undefined) seed = a;
  }
  const posture = allowBypass ? { permissionMode: "bypassPermissions", allowBypass: true } : undefined;
  const k = new KairosAssistant({ query: sdkQuery }, { cwd, model, posture });
  await k.start(seed);
  console.error(`cc-harness assistant running (session ${k.status().sessionId}); Ctrl-C to stop`);
  await new Promise<void>((resolve) => {
    const onSig = async () => { await k.stop().catch(() => {}); resolve(); };
    process.on("SIGINT", onSig); process.on("SIGTERM", onSig);
  });
}
```

In `main()`, add this line immediately after `if (await daemonCli(process.argv.slice(2))) return;`:

```ts
  if (process.argv[2] === "assistant") { await runAssistant(process.argv.slice(2)); return; }
```

- [ ] **Step 4: Run the live test to verify it passes**

Run: `set -a && . /Users/new/Documents/GitHub/codex_somersault/CC-to-SDK/.env && set +a && cd /Users/new/Documents/GitHub/codex_somersault/CC-to-SDK/harness && npx vitest run test/live/kairos.test.ts`
Expected: PASS — within ~90s `briefs` contains a `HEARTBEAT_BRIEF` message (a real autonomous tick fired and reported through Brief).

- [ ] **Step 5: Manual CLI smoke (optional, ~10s)**

Run: `set -a && . /Users/new/Documents/GitHub/codex_somersault/CC-to-SDK/.env && set +a && cd /Users/new/Documents/GitHub/codex_somersault/CC-to-SDK/harness && timeout 12 npm run cli -- assistant --cwd /tmp "Send me a brief that says STARTED, then go idle." ; true`
Expected: prints `cc-harness assistant running (session sess-1); …` to stderr and at least one `[brief] …` line to stdout, then exits on the timeout. (`timeout` sends SIGTERM, which triggers clean stop.)

- [ ] **Step 6: Typecheck + commit**

Run: `npm run typecheck`
Expected: exits 0.

```bash
cd /Users/new/Documents/GitHub/codex_somersault/CC-to-SDK
git add harness/src/cli.ts harness/test/live/kairos.test.ts
git commit -m "feat(harness): cc-harness assistant subcommand + live Brief-tick test"
```

---

## Final verification (after all tasks)

- [ ] `cd harness && npm run typecheck` — clean.
- [ ] `cd harness && npm run test:unit` — all green (existing 222 + new kairos units: brief 5, persona 3, safety 5, assistant 3).
- [ ] `set -a && . ../.env && set +a && cd harness && npx vitest run test/live/kairos.test.ts` — PASS (one autonomous Brief tick).
- [ ] `cd harness && npm run build && npm run verify:pack` — dist build + tarball acceptance still pass with the new exports.
- [ ] `git log --oneline -5` shows the five task commits; `git status` clean; no `dist/`/`*.tgz`/secrets staged.
- [ ] Dispatch the two-stage review (spec compliance, then code quality) per subagent-driven-development; codex via `/codex:rescue --model gpt-5.5 --effort high`, Claude reviewer fallback. Pay special attention to the teardown/liveness surface ([[teardown-liveness-review-pattern]]): `KairosAssistant.stop()` idempotency and that `shutdown()` reliably stops the heartbeat + disposes the session without hanging.

---

## Self-Review (plan ↔ spec)

**Spec coverage:**
- §3 latch (32.1): persona (Task 2) + `KairosAssistant` orchestrator + CLI subcommand (Tasks 4–5). ✓
- §3 Brief (32.3): `SendUserMessage` MCP tool + `BriefSink` (Task 1); surfaced as the user-visible channel (Task 4 wiring + Task 5 live proof). ✓
- §5.5 safety posture (force `auto`, refuse silent bypass, optional empty denylist): Task 3. ✓
- §2 permission gate = native `auto` (no classifier): Task 3 + Task 4 wiring; proven by the live test (Task 5). ✓
- §6 liveness: `stop()` idempotency + heartbeat teardown tested (Task 4) and called out for review (Final verification). ✓
- §7 verification: unit + integration + one live `auto` Brief tick + build/verify:pack — all in Final verification. ✓
- §8 success criteria: `cc-harness assistant` runs autonomously, self-paces via the heartbeat, surfaces output through Brief, never silently bypasses, new exports don't break the build. ✓
- **Deferred (spec §3 + Global Constraints):** cron firing + push — explicitly carved out with the live-probe evidence; the core's scheduling is the proactive heartbeat. ✓

**Placeholder scan:** every code step shows complete file content; every run step has an exact command + expected output. No TBD/"handle errors"/"similar to". ✓

**Type/name consistency:** `BriefSink`/`BriefMessage`/`BriefStatus`, `buildBriefTools`/`createBriefMcpServer`/`stdoutBriefSink`, `ASSISTANT_SECTION`/`applyAssistantPersona`, `PostureConfig`/`resolveAssistantPosture`, `KairosConfig`/`KairosAssistant` (`start`/`status`/`stop`), and the `mcp__cc-brief__SendUserMessage` allow-list entry are used identically across Tasks 1–5 and the exports. The consumed supervisor signatures (`spawn`/`submit`/`startProactive`/`proactiveStatus`/`shutdown`) match `daemon/supervisor.ts`. ✓
