# CC → Agent SDK Feature-Parity Map — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a feature-granular parity map classifying every Claude Code harness capability against the current TypeScript Agent SDK surface, with a since-February delta pass and live-SDK verification, producing a sequenced phase roadmap.

**Architecture:** Rows are authored as JSON (the single source of truth) under `docs/parity/data/`. A generator renders human-readable markdown views (`INDEX.md`, per-area files, `since-february.md`, `roadmap.md`) from the JSON. A validator enforces row schema + 43-area coverage + verification counts. ~15–25 high-stakes verdicts are confirmed by running the real SDK with `ANTHROPIC_API_KEY` under `probes/`.

**Tech Stack:** Node ESM scripts (`.mjs`, no build step), `@anthropic-ai/claude-agent-sdk` (TS) for probes run via `npx tsx`, the Feb reverse-engineered specs in `Claude Code Src/docs/specs/`, live SDK docs, and this harness's observable surface.

**Spec:** `docs/superpowers/specs/2026-06-16-cc-to-sdk-parity-map-design.md` (approved).

**Conventions for this plan**
- All paths are relative to `CC-to-SDK/` unless absolute.
- Commits go to the current branch (`main`), no attribution lines (project CLAUDE.md).
- "Reference repo root" = `/Users/new/Documents/GitHub/codex_somersault`.

---

## Row schema (canonical — used by every task)

Each row is a JSON object:

```json
{
  "id": "09.3",
  "area": "09-permission-system",
  "feature": "Ask/allow/deny rule evaluation",
  "what": "One-line description of the capability.",
  "ccSource": "spec 09 §4; src/hooks/toolPermission/",
  "verdict": "provided",
  "sdkSurface": "canUseTool + permissionMode + settings rules",
  "bridge": "Wire canUseTool callback; map CC rule syntax to PermissionResult.",
  "targetPhase": "1",
  "confidence": "doc",
  "snapshot": "feb"
}
```

**Enums:**
- `verdict`: `"provided" | "configurable" | "build" | "not-possible" | "unknown"`
- `confidence`: `"verified" | "doc" | "inferred"`
- `snapshot`: `"feb" | "post-feb"`
- `targetPhase`: `"1" | "2" | "3" | "non-goal"`

**Field rules (enforced by validator):**
- All fields present. `feature`, `what`, `ccSource`, `bridge` non-empty strings.
- `sdkSurface` may be `""` only when `verdict ∈ {build, not-possible}`.
- `id` matches `^\d{2}[a-d]?\.\d+$`. `area` is one of the 43 canonical area slugs.
- No `verdict: "unknown"` may remain in the final committed data (must resolve).

---

## Area → file → cluster map (locks decomposition)

43 canonical areas (slugs = spec filenames without `.md`). Extraction is grouped into 12 clusters; each cluster is one extraction task (Task 5) and emits one `data/<cluster>.json` plus one rendered `<area>.md` per area it covers.

| Cluster | Areas (spec IDs) | `data/*.json` |
|---|---|---|
| C1 boot-settings | 00, 01, 02 | `c1-boot-settings.json` |
| C2 query-context | 03, 04, 05, 06, 07 | `c2-query-context.json` |
| C3 tools-base-perms | 08, 09 | `c3-tools-base-perms.json` |
| C4 core-tools | 10, 11, 12, 13 | `c4-core-tools.json` |
| C5 agent-tasks | 14, 15, 30 | `c5-agent-tasks.json` |
| C6 mcp-skill-modes-tools | 16, 17, 18, 19 | `c6-mcp-skill-modes-tools.json` |
| C7 commands | 20, 21, 21a, 21b, 21c, 21d | `c7-commands.json` |
| C8 services-core | 22, 23, 24, 25 | `c8-services-core.json` |
| C9 services-ext | 26, 27, 28, 29 | `c9-services-ext.json` |
| C10 modes | 31, 32, 33, 34, 35, 36 | `c10-modes.json` |
| C11 ui-shell | 37, 37a, 37b, 37c, 38, 39 | `c11-ui-shell.json` |
| C12 persistence-misc | 40, 41, 42, 42a | `c12-persistence-misc.json` |

---

## Task 1: Scaffold the parity workspace

**Files:**
- Create: `docs/parity/data/.gitkeep`
- Create: `docs/parity/methodology.md`
- Create: `scripts/parity-areas.mjs` (canonical area list, shared by validator + generator)

- [ ] **Step 1: Create the directory + area registry**

Create `scripts/parity-areas.mjs`:

```js
// Canonical 43 area slugs (spec filenames without .md) + cluster grouping.
export const AREAS = [
  "00-overview","01-entrypoint-bootstrap","02-settings-schemas-migrations",
  "03-query-engine","04-turn-pipeline","05-context-assembly","06-cost-token-tracking",
  "07-context-compaction","08-tool-base-registry","09-permission-system",
  "10-tool-bash","11-tool-files","12-tool-search","13-tool-web","14-tool-agent-team",
  "15-tool-tasks","16-tool-mcp-lsp","17-tool-skill","18-tool-modes","19-tool-misc",
  "20-command-system","21-command-catalog","21a-command-catalog-public",
  "21b-command-catalog-ant","21c-command-catalog-flagged","21d-command-catalog-plugin-and-misc",
  "22-service-api","23-service-mcp","24-service-lsp","25-service-oauth-auth",
  "26-service-analytics-flags","27-service-policy","28-service-plugins","29-service-memory",
  "30-coordinator-multiagent","31-mode-proactive","32-mode-kairos","33-mode-daemon",
  "34-mode-bridge","35-mode-remote-server","36-mode-voice","37-ink-ui-shell",
  "37a-components-catalog","37b-hooks-catalog","37c-ink-primitives-catalog",
  "38-output-styles","39-vim-keybindings","40-persistent-memory",
  "41-session-state-history","42-misc","42a-utils-long-tail",
];
export const CLUSTERS = {
  "c1-boot-settings": ["00-overview","01-entrypoint-bootstrap","02-settings-schemas-migrations"],
  "c2-query-context": ["03-query-engine","04-turn-pipeline","05-context-assembly","06-cost-token-tracking","07-context-compaction"],
  "c3-tools-base-perms": ["08-tool-base-registry","09-permission-system"],
  "c4-core-tools": ["10-tool-bash","11-tool-files","12-tool-search","13-tool-web"],
  "c5-agent-tasks": ["14-tool-agent-team","15-tool-tasks","30-coordinator-multiagent"],
  "c6-mcp-skill-modes-tools": ["16-tool-mcp-lsp","17-tool-skill","18-tool-modes","19-tool-misc"],
  "c7-commands": ["20-command-system","21-command-catalog","21a-command-catalog-public","21b-command-catalog-ant","21c-command-catalog-flagged","21d-command-catalog-plugin-and-misc"],
  "c8-services-core": ["22-service-api","23-service-mcp","24-service-lsp","25-service-oauth-auth"],
  "c9-services-ext": ["26-service-analytics-flags","27-service-policy","28-service-plugins","29-service-memory"],
  "c10-modes": ["31-mode-proactive","32-mode-kairos","33-mode-daemon","34-mode-bridge","35-mode-remote-server","36-mode-voice"],
  "c11-ui-shell": ["37-ink-ui-shell","37a-components-catalog","37b-hooks-catalog","37c-ink-primitives-catalog","38-output-styles","39-vim-keybindings"],
  "c12-persistence-misc": ["40-persistent-memory","41-session-state-history","42-misc","42a-utils-long-tail"],
};
```

Run: `mkdir -p docs/parity/data && touch docs/parity/data/.gitkeep`

- [ ] **Step 2: Write `methodology.md`** with: the 5-bucket taxonomy table, the row schema, the evidence-source table (copy from spec §3/§4/§5), an empty "## Coverage statement" section (filled in Task 9), and an empty "## Probe log" section (filled in Task 8). Pull text verbatim from the approved spec so the two never drift.

- [ ] **Step 3: Commit**

```bash
git add CC-to-SDK/docs/parity CC-to-SDK/scripts/parity-areas.mjs
git commit -m "chore(parity): scaffold parity workspace + area registry"
```

---

## Task 2: Write the validator (TDD: failing gate first)

**Files:**
- Create: `scripts/validate-parity.mjs`

- [ ] **Step 1: Write the validator**

```js
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AREAS } from "./parity-areas.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "docs/parity/data");
const VERDICTS = new Set(["provided","configurable","build","not-possible","unknown"]);
const CONF = new Set(["verified","doc","inferred"]);
const SNAP = new Set(["feb","post-feb"]);
const PHASE = new Set(["1","2","3","non-goal"]);
const ID_RE = /^\d{2}[a-d]?\.\d+$/;

const errors = [];
const rows = [];
for (const f of existsSync(DATA) ? readdirSync(DATA) : []) {
  if (!f.endsWith(".json")) continue;
  let arr;
  try { arr = JSON.parse(readFileSync(join(DATA, f), "utf8")); }
  catch (e) { errors.push(`${f}: invalid JSON — ${e.message}`); continue; }
  if (!Array.isArray(arr)) { errors.push(`${f}: top-level must be an array`); continue; }
  for (const r of arr) rows.push([f, r]);
}

const reqStr = ["feature","what","ccSource","bridge"];
for (const [f, r] of rows) {
  const at = `${f} ${r.id ?? "?"}`;
  if (!ID_RE.test(r.id || "")) errors.push(`${at}: bad id`);
  if (!AREAS.includes(r.area)) errors.push(`${at}: unknown area "${r.area}"`);
  if (!VERDICTS.has(r.verdict)) errors.push(`${at}: bad verdict`);
  if (r.verdict === "unknown") errors.push(`${at}: unresolved "unknown" verdict`);
  if (!CONF.has(r.confidence)) errors.push(`${at}: bad confidence`);
  if (!SNAP.has(r.snapshot)) errors.push(`${at}: bad snapshot`);
  if (!PHASE.has(r.targetPhase)) errors.push(`${at}: bad targetPhase`);
  for (const k of reqStr) if (typeof r[k] !== "string" || !r[k].trim()) errors.push(`${at}: empty ${k}`);
  const surfaceOptional = r.verdict === "build" || r.verdict === "not-possible";
  if (!surfaceOptional && (typeof r.sdkSurface !== "string" || !r.sdkSurface.trim()))
    errors.push(`${at}: sdkSurface required for verdict "${r.verdict}"`);
}

const covered = new Set(rows.map(([, r]) => r.area));
const missing = AREAS.filter((a) => !covered.has(a));
if (missing.length) errors.push(`Areas with no rows: ${missing.join(", ")}`);

const verified = rows.filter(([, r]) => r.confidence === "verified").length;
if (verified < 15) errors.push(`Only ${verified} verified rows; need >=15`);

const ids = rows.map(([, r]) => r.id);
const dupes = ids.filter((x, i) => ids.indexOf(x) !== i);
if (dupes.length) errors.push(`Duplicate ids: ${[...new Set(dupes)].join(", ")}`);

if (errors.length) {
  console.error(`PARITY VALIDATION FAILED (${errors.length}):`);
  for (const e of errors) console.error(" - " + e);
  process.exit(1);
}
console.log(`OK: ${rows.length} rows, ${AREAS.length} areas covered, ${verified} verified.`);
```

- [ ] **Step 2: Run it — verify it FAILS (no data yet)**

Run: `node CC-to-SDK/scripts/validate-parity.mjs`
Expected: FAIL — "Areas with no rows: …" and "Only 0 verified rows; need >=15", exit code 1.

- [ ] **Step 3: Commit**

```bash
git add CC-to-SDK/scripts/validate-parity.mjs
git commit -m "test(parity): add row-schema + coverage validator (failing gate)"
```

---

## Task 3: Capture the SDK surface reference (the verdict basis / columns)

**Files:**
- Create: `docs/parity/_sdk-surface.md`

- [ ] **Step 1: Install the SDK locally to read its real types**

Run:
```bash
cd CC-to-SDK && mkdir -p probes && cd probes
npm init -y >/dev/null 2>&1
npm install @anthropic-ai/claude-agent-sdk@latest
```
Expected: installs current SDK (~0.3.x) + bundled native Claude Code binary.

- [ ] **Step 2: Extract the real exported types**

Run:
```bash
cd CC-to-SDK/probes
find node_modules/@anthropic-ai/claude-agent-sdk -name "*.d.ts" | head
sed -n '1,400p' node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts 2>/dev/null || \
  cat node_modules/@anthropic-ai/claude-agent-sdk/dist/*.d.ts | head -600
```
Expected: the `Options` type, `Query` interface, `AgentDefinition`, `HookEvent`, `PermissionMode`, message-type union, session functions.

- [ ] **Step 3: Write `_sdk-surface.md`** — a structured reference with sections: Exported functions; `Options` fields (full table, exact names + types from the `.d.ts`, not just the docs); `Query` methods; message types; `AgentDefinition`; `McpServerConfig`; permission modes; hook events; setting sources; session functions. Mark each field's source (`d.ts` vs docs) so verdicts cite ground truth. Cross-check against the live doc capture already in the conversation; note any field present in `.d.ts` but absent from docs (or vice-versa).

- [ ] **Step 4: Commit**

```bash
git add CC-to-SDK/docs/parity/_sdk-surface.md CC-to-SDK/probes/package.json CC-to-SDK/probes/package-lock.json
echo "node_modules/" > CC-to-SDK/probes/.gitignore
git add CC-to-SDK/probes/.gitignore
git commit -m "docs(parity): capture authoritative SDK surface reference"
```

---

## Task 4: Capture the current-harness surface + Feb-delta checklist

**Files:**
- Create: `docs/parity/_current-surface.md`

- [ ] **Step 1: Enumerate this harness's observable surface.** From the live session, record: built-in tools, deferred tools (e.g. Monitor, Cron*, DesignSync, EnterWorktree, RemoteTrigger, PushNotification, ScheduleWakeup, Workflow, ToolSearch, LSP, Task*, NotebookEdit, EnterPlanMode/ExitPlanMode), agent types, available skills, hook event names, output styles, permission modes. (These are visible in the system context of a current CC session.)

- [ ] **Step 2: Enumerate current CC public capabilities** via WebFetch/WebSearch of `code.claude.com/docs` for: slash commands, settings.json keys, hooks, subagents, output styles, skills, plugins, sandboxing, background tasks, scheduled/cron agents ("routines"), git-worktrees, checkpointing/rewind, plan mode, MCP. Record each with a one-line description + doc URL.

- [ ] **Step 3: Build the delta checklist.** In `_current-surface.md`, produce a flat checklist of every current capability with a column "exists in Feb source? (yes/no/unknown)". Items marked `no` are candidate `snapshot: post-feb` rows; this checklist is the authoritative input to Task 7 (reconciliation). Cross-reference the `Claude Code Src/src/` tree to decide yes/no quickly:
  Run (example check): `ls "/Users/new/Documents/GitHub/codex_somersault/Claude Code Src/src/tools" | grep -iE "monitor|cron|worktree|workflow"`

- [ ] **Step 4: Commit**

```bash
git add CC-to-SDK/docs/parity/_current-surface.md
git commit -m "docs(parity): capture current-harness surface + Feb-delta checklist"
```

---

## Task 5: Per-cluster parity extraction (12 instantiations, parallelizable)

This task runs **once per cluster** (C1–C12 from the cluster map). Each instantiation is identical in procedure and differs only by its input areas and output file. **Dispatch as parallel sub-agents** (see superpowers:dispatching-parallel-agents) — clusters are independent.

**Files (per cluster `<C>` covering areas `<areas>`):**
- Read: `Claude Code Src/docs/specs/<area>.md` for each area in the cluster
- Read (as needed): `docs/parity/_sdk-surface.md`, `docs/parity/_current-surface.md`
- Spot-check (as needed): `Claude Code Src/src/...` files cited by the spec
- Create: `docs/parity/data/<C>.json` (array of rows)

**Exact sub-agent procedure (the parameterized "code" of this task):**

1. Read each assigned `<area>.md` spec in full. For catalog areas (37a/37b/37c/42a), do **not** create one row per file — create cluster/rollup rows that name the file count and the dominant verdict (per spec §6).
2. For each discrete user-facing or behavioral feature, emit one row using the canonical row schema. Set:
   - `verdict` by checking `_sdk-surface.md`: if a named Option/Query-method/type/built-in-tool covers it → `provided`; if a primitive exists but needs content/wiring → `configurable`; if nothing in the SDK covers it (UI, mode, keybindings) → `build`; if it depends on claude.ai login or internal-only services → `not-possible`; if genuinely unsure → `unknown` (flag for Task 8).
   - `sdkSurface` = the exact option/method/type name (or `""` for build/not-possible).
   - `snapshot` = `feb` by default; `post-feb` only if the feature is absent from the Feb `src/` (the row will be reconciled again in Task 7).
   - `confidence` = `doc` if grounded in `_sdk-surface.md`/specs; `inferred` if reasoned without a direct citation.
   - `targetPhase`: `1` for headless core/config-wiring parity, `2` for non-UI modes (daemon/bridge/remote/proactive/voice backends), `3` for interactive TUI/REPL/vim/UI, `non-goal` for `not-possible`.
   - `id` = `<areaNumber>.<n>`, e.g. `09.1`, `37a.3`.
3. Write the rows array to `docs/parity/data/<C>.json`.
4. Return a ≤200-word summary: row count, verdict tally, any `unknown` rows (with the question to resolve), any cross-cutting features deferred to another cluster's owner.

**Cross-cutting ownership (avoid double-counting):** permissions UI rows belong to C11 (cite C3); MCP UI rows belong to C11 (cite C6/C8); swarm UI belongs to C11 (cite C5). Each feature is owned by exactly one cluster; others cross-reference by `id` in their `bridge` note.

- [ ] **C1 boot-settings** → `data/c1-boot-settings.json`
- [ ] **C2 query-context** → `data/c2-query-context.json`
- [ ] **C3 tools-base-perms** → `data/c3-tools-base-perms.json`
- [ ] **C4 core-tools** → `data/c4-core-tools.json`
- [ ] **C5 agent-tasks** → `data/c5-agent-tasks.json`
- [ ] **C6 mcp-skill-modes-tools** → `data/c6-mcp-skill-modes-tools.json`
- [ ] **C7 commands** → `data/c7-commands.json`
- [ ] **C8 services-core** → `data/c8-services-core.json`
- [ ] **C9 services-ext** → `data/c9-services-ext.json`
- [ ] **C10 modes** → `data/c10-modes.json`
- [ ] **C11 ui-shell** → `data/c11-ui-shell.json`
- [ ] **C12 persistence-misc** → `data/c12-persistence-misc.json`

- [ ] **After all 12: run the validator** (expect remaining failures only for `<15 verified` and any `unknown` rows — those are resolved in Tasks 7/8).

Run: `node CC-to-SDK/scripts/validate-parity.mjs`
Expected: area-coverage error gone; may still fail on verified-count / unknowns.

- [ ] **Commit** (after each cluster, or batched):

```bash
git add CC-to-SDK/docs/parity/data/*.json
git commit -m "feat(parity): extract rows for clusters C1-C12"
```

---

## Task 6: Probe harness scaffold (real SDK, TS)

**Files:**
- Create: `probes/tsconfig.json`
- Create: `probes/lib/runProbe.ts` (shared probe helper)
- Create: `probes/.env.example`

- [ ] **Step 1: Confirm the API key is present**

Run: `cd CC-to-SDK/probes && node -e "console.log(!!process.env.ANTHROPIC_API_KEY)"`
Expected: `true` (repo provides `ANTHROPIC_API_KEY`). If `false`, stop and surface to the user.

- [ ] **Step 2: Add tsx runner**

Run: `cd CC-to-SDK/probes && npm install -D tsx typescript`

- [ ] **Step 3: Write `lib/runProbe.ts`** — a helper that wraps `query()`, collects the message stream into an array, and returns `{ messages, result, systemInit }` so each probe asserts against real output. Include a 60s timeout and `permissionMode: "bypassPermissions"` for non-interactive runs.

```ts
import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";

export async function runProbe(prompt: string, options: Record<string, unknown> = {}) {
  const messages: SDKMessage[] = [];
  let result: any, systemInit: any;
  for await (const m of query({ prompt, options: { permissionMode: "bypassPermissions", ...options } })) {
    messages.push(m);
    if (m.type === "system" && (m as any).subtype === "init") systemInit = m;
    if ("result" in m) result = m;
  }
  return { messages, result, systemInit };
}
```

- [ ] **Step 4: Smoke test**

Run: `cd CC-to-SDK/probes && npx tsx -e "import {runProbe} from './lib/runProbe.ts'; const r = await runProbe('Reply with the single word OK.'); console.log(r.result?.result ?? r.result?.subtype);"`
Expected: model replies; prints `OK` (or a result subtype). Confirms SDK + key work end-to-end.

- [ ] **Step 5: Commit**

```bash
git add CC-to-SDK/probes/tsconfig.json CC-to-SDK/probes/lib CC-to-SDK/probes/.env.example CC-to-SDK/probes/package.json CC-to-SDK/probes/package-lock.json
git commit -m "feat(parity): SDK probe harness scaffold"
```

---

## Task 7: February-delta reconciliation

**Files:**
- Modify: `docs/parity/data/*.json` (add any missing Post-Feb rows)
- Create: `docs/parity/data/zz-post-feb.json` (Post-Feb features that don't belong to an existing cluster file)

- [ ] **Step 1: Diff.** For every item in `_current-surface.md` marked "exists in Feb source? = no", search the existing `data/*.json` for a matching row (by feature name / SDK surface).
  Run: `grep -rIl "Monitor\|Cron\|Worktree\|Workflow\|outputFormat\|sessionStore\|enableFileCheckpointing\|dontAsk" CC-to-SDK/docs/parity/data/`
- [ ] **Step 2: Add missing rows.** For each unmatched current capability, add a row with `snapshot: "post-feb"`, correct `verdict`/`sdkSurface`, `ccSource: "n/a (post-Feb); current CC docs <url>"`, to the most relevant cluster file (or `zz-post-feb.json`). Assign `id` using the closest area number, suffixing as needed.
- [ ] **Step 3: Re-tag.** Flip `snapshot` to `post-feb` on any existing row whose feature is confirmed absent from Feb `src/`.
- [ ] **Step 4: Run validator** — must still pass structure checks.
  Run: `node CC-to-SDK/scripts/validate-parity.mjs`
- [ ] **Step 5: Commit**

```bash
git add CC-to-SDK/docs/parity/data
git commit -m "feat(parity): February-delta reconciliation (post-Feb rows)"
```

---

## Task 8: Empirical spot-verification (~15–25 high-stakes probes)

**Files:**
- Create: `probes/probes/<NN-name>.ts` (one per probe)
- Create: `docs/parity/probe-results/<NN-name>.txt` (captured output)
- Modify: affected rows in `docs/parity/data/*.json` → `confidence: "verified"`
- Modify: `docs/parity/methodology.md` → fill "## Probe log"

**Probe list (each resolves specific rows):**
1. `systemPrompt:{preset:'claude_code'}` reproduces CC system prompt (inspect `systemInit`/first assistant context).
2. `settingSources:['project']` loads `.claude/commands/*.md` → appears in `supportedCommands()`.
3. `settingSources` loads `.claude/skills/*/SKILL.md` → skill invocable.
4. `supportedCommands()` enumerates built-in slash commands.
5. Skill auto-trigger vs explicit `/name`.
6. `agents` subagent dispatch + `parent_tool_use_id` threading (needs `Agent` in allowedTools).
7. `createSdkMcpServer` + `tool()` in-process custom tool round-trip.
8. `canUseTool` deny path blocks a tool; `permissionMode` transitions via `setPermissionMode`.
9. `outputFormat:{type:'json_schema'}` returns structured result.
10. Session `resume` retains context; `forkSession` branches; `getSessionMessages` reads transcript.
11. `hooks.PreToolUse` can block; `hooks.PostToolUse` fires.
12. `mcpServers` (stdio) connects + `mcpServerStatus()`.
13. Compaction boundary emitted on long context (`SDKCompactBoundaryMessage`).
14. `enableFileCheckpointing` + `rewindFiles()` reverts a write.
15. `plugins:[{type:'local',path}]` loads a local plugin's skill/agent/hook.
16. `model`/`fallbackModel`/`effort`/`thinking` accepted; `supportedModels()`.
17. `maxTurns` / `maxBudgetUsd` stop conditions.
18. `dontAsk` / `auto` permission modes behave as documented.
19. Background task / `Task*` messages (`stopTask`).
20. `AskUserQuestion` tool behavior in non-interactive mode (`onElicitation`/stream).

(Run the highest-value 15 first; add up to 25 if time permits. Log any that can't run — e.g. require interactivity — as `inferred` with the reason, never silently dropped.)

- [ ] **Step 1: Write probe `01-system-prompt.ts`**

```ts
import { runProbe } from "../lib/runProbe.ts";
const { systemInit, messages } = await runProbe("Say hi.", {
  systemPrompt: { type: "preset", preset: "claude_code" },
});
console.log("tools:", systemInit?.tools?.length);
console.log("slash_commands:", systemInit?.slash_commands?.slice?.(0, 10));
console.log("model:", systemInit?.model);
```

Run: `cd CC-to-SDK/probes && npx tsx probes/01-system-prompt.ts | tee ../docs/parity/probe-results/01-system-prompt.txt`
Expected: prints non-trivial tool count + built-in slash commands → confirms preset wires the real CC environment. Record verdict in the matching rows; set `confidence: "verified"`.

- [ ] **Step 2: Write + run the remaining probes** (2…N) following the same pattern: one `.ts` per probe, `tee` output to `probe-results/`, then update the rows it resolves to `confidence: "verified"` and resolve any `unknown` verdicts. Append a one-line entry per probe to methodology.md "## Probe log": `NN | claim | result | rows updated`.

- [ ] **Step 3: Run validator — now expect ≥15 verified**

Run: `node CC-to-SDK/scripts/validate-parity.mjs`
Expected: PASS (or only non-probe issues remain).

- [ ] **Step 4: Commit**

```bash
git add CC-to-SDK/probes/probes CC-to-SDK/docs/parity/probe-results CC-to-SDK/docs/parity/data CC-to-SDK/docs/parity/methodology.md
git commit -m "feat(parity): live SDK spot-verification of high-stakes verdicts"
```

---

## Task 9: Generator — render markdown views from JSON

**Files:**
- Create: `scripts/render-parity.mjs`
- Generates: `docs/parity/INDEX.md`, `docs/parity/<area>.md` (one per area with rows), `docs/parity/since-february.md`

- [ ] **Step 1: Write `render-parity.mjs`**

```js
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AREAS } from "./parity-areas.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "docs/parity");
const DATA = join(DIR, "data");
const EMOJI = { provided:"✅", configurable:"🔧", build:"🏗", "not-possible":"🚫", unknown:"❔" };

const rows = [];
for (const f of readdirSync(DATA)) if (f.endsWith(".json"))
  rows.push(...JSON.parse(readFileSync(join(DATA, f), "utf8")));
rows.sort((a,b) => a.id.localeCompare(b.id, undefined, { numeric:true }));

const cell = (s="") => String(s).replace(/\|/g,"\\|").replace(/\n/g," ");
const rowLine = (r) => `| ${r.id} | ${cell(r.feature)} | ${EMOJI[r.verdict]} ${r.verdict} | ${cell(r.sdkSurface||"—")} | ${cell(r.bridge)} | P${r.targetPhase} | ${r.confidence} | ${r.snapshot} |`;
const HEAD = "| id | feature | verdict | SDK surface | bridge / gap | phase | conf | snap |\n|---|---|---|---|---|---|---|---|";

// Per-area files
for (const area of AREAS) {
  const ar = rows.filter(r => r.area === area);
  if (!ar.length) continue;
  writeFileSync(join(DIR, `${area}.md`),
    `# Parity — ${area}\n\n${HEAD}\n${ar.map(rowLine).join("\n")}\n`);
}

// Tallies
const tally = {};
for (const r of rows) tally[r.verdict] = (tally[r.verdict]||0)+1;
const tallyTable = Object.entries(EMOJI)
  .map(([k,e]) => `| ${e} ${k} | ${tally[k]||0} |`).join("\n");

// 43-area summary
const summary = AREAS.map(a => {
  const ar = rows.filter(r => r.area === a);
  const t = {}; for (const r of ar) t[r.verdict]=(t[r.verdict]||0)+1;
  const dom = Object.entries(t).sort((x,y)=>y[1]-x[1])[0]?.[0] ?? "—";
  return `| ${a} | ${ar.length} | ${EMOJI[dom]||""} ${dom} |`;
}).join("\n");

writeFileSync(join(DIR, "INDEX.md"),
`# CC → Agent SDK Parity Map — Index

Total rows: **${rows.length}**. Generated from \`docs/parity/data/*.json\` via \`scripts/render-parity.mjs\`.

## Verdict tallies
| verdict | count |
|---|---|
${tallyTable}

## Per-area summary
| area | rows | dominant verdict |
|---|---|---|
${summary}

## All rows
${HEAD}
${rows.map(rowLine).join("\n")}
`);

// since-february.md
const post = rows.filter(r => r.snapshot === "post-feb");
writeFileSync(join(DIR, "since-february.md"),
`# Since-February delta

Capabilities present in current CC/SDK but absent from the February source snapshot. Count: **${post.length}**.

${HEAD}
${post.map(rowLine).join("\n")}
`);

console.log(`Rendered INDEX + ${new Set(rows.map(r=>r.area)).size} area files + since-february (${post.length} post-Feb rows).`);
```

- [ ] **Step 2: Run it**

Run: `node CC-to-SDK/scripts/render-parity.mjs`
Expected: prints rendered counts; creates INDEX.md, per-area files, since-february.md.

- [ ] **Step 3: Fill the coverage statement** in `methodology.md` "## Coverage statement": confirm all 43 areas accounted for; for each catalog rollup (37a/37b/37c/42a) state the file count subsumed and why collapsed; note any area intentionally thin. Pull counts from INDEX.md.

- [ ] **Step 4: Commit**

```bash
git add CC-to-SDK/docs/parity/*.md CC-to-SDK/scripts/render-parity.mjs
git commit -m "feat(parity): render markdown views + coverage statement"
```

---

## Task 10: Derive `roadmap.md` (the payoff)

**Files:**
- Create: `docs/parity/roadmap.md`

- [ ] **Step 1: Generate phase buckets.** From the JSON, list all `build` + `configurable` rows grouped by `targetPhase`. Within each phase, sub-group by area/cluster.
  Run: `node -e "const fs=require('fs'),p='CC-to-SDK/docs/parity/data';const rows=fs.readdirSync(p).filter(f=>f.endsWith('.json')).flatMap(f=>JSON.parse(fs.readFileSync(p+'/'+f)));for(const ph of ['1','2','3']){console.log('\n# Phase',ph);for(const r of rows.filter(r=>r.targetPhase===ph&&r.verdict!=='provided'))console.log('-',r.id,r.feature,'('+r.verdict+')')}"`
- [ ] **Step 2: Write `roadmap.md`** with: a one-paragraph thesis (SDK provides the engine; we build the shell); **Phase 1 — headless harness core** (config wiring: settings/skills/commands/plugins/hooks/MCP/subagents/memory + the SDK `query` loop + structured output); **Phase 2 — non-UI modes** (daemon/bridge/remote-server/proactive/voice backends); **Phase 3 — interactive TUI** (Ink REPL, components, vim, keybindings, status/cost UI). Each phase: goal, the row ids it covers, dependencies, and a note that it gets its own spec→plan→build cycle. End with **Non-goals** = all `not-possible` rows (esp. claude.ai login).
- [ ] **Step 3: Commit**

```bash
git add CC-to-SDK/docs/parity/roadmap.md
git commit -m "feat(parity): derive sequenced build roadmap from parity map"
```

---

## Task 11: Final consistency self-review + parity.json

**Files:**
- Create: `docs/parity/parity.json` (concatenated mirror)
- Modify: `docs/parity/INDEX.md` (link the sub-docs)

- [ ] **Step 1: Emit `parity.json`**

Run: `node -e "const fs=require('fs'),p='CC-to-SDK/docs/parity/data';const rows=fs.readdirSync(p).filter(f=>f.endsWith('.json')).flatMap(f=>JSON.parse(fs.readFileSync(p+'/'+f)));rows.sort((a,b)=>a.id.localeCompare(b.id,undefined,{numeric:true}));fs.writeFileSync('CC-to-SDK/docs/parity/parity.json',JSON.stringify(rows,null,2))"`

- [ ] **Step 2: Final validation gate**

Run: `node CC-to-SDK/scripts/validate-parity.mjs && node CC-to-SDK/scripts/render-parity.mjs`
Expected: validator prints OK (≥15 verified, all areas covered, no unknowns); render succeeds.

- [ ] **Step 3: Self-review against spec success criteria** (spec §10): every area has rows/rollup; every row has verdict+surface+snapshot+confidence; ≥15 verified; since-february enumerated; roadmap sequences all 🔧/🏗. Fix any gap by editing the relevant `data/*.json` and re-running Steps 1–2.

- [ ] **Step 4: Add navigation** to INDEX.md top: links to `methodology.md`, `roadmap.md`, `since-february.md`, `_sdk-surface.md`, `_current-surface.md`.

- [ ] **Step 5: Final commit**

```bash
git add CC-to-SDK/docs/parity
git commit -m "feat(parity): finalize parity map (parity.json + navigation + review)"
```

---

## Self-Review (plan vs spec)

- **Spec §1 goal (parity map + roadmap, docs-only):** Tasks 5/9 (map), 10 (roadmap), no harness code. ✓
- **Spec §3.1 Feb delta (first-class):** Task 4 (checklist) + Task 7 (reconciliation) + `since-february.md` (Task 9) + `snapshot` field enforced by validator (Task 2). ✓
- **Spec §4 taxonomy (5 buckets):** encoded in validator enum + render emoji. ✓
- **Spec §5 row schema (incl. snapshot):** canonical schema section + validator. ✓
- **Spec §6 granularity/coverage (collapse catalogs, no silent truncation):** Task 5 rollup rule + Task 9 coverage statement. ✓
- **Spec §7 method (SDK surface, current surface, fan-out, probes, roadmap):** Tasks 3,4,5,8,10. ✓
- **Spec §8 outputs (INDEX/per-area/methodology/since-february/roadmap/parity.json):** Tasks 1,9,10,11. ✓
- **Spec §10 success criteria:** Task 11 self-review checks each. ✓
- **Placeholder scan:** validator/generator/probe code is complete; extraction procedure is fully specified + parameterized by the cluster table (not a "similar to" reference). ✓
- **Type consistency:** `verdict`/`confidence`/`snapshot`/`targetPhase` enums identical across schema, validator, and render. Field names (`sdkSurface`, `ccSource`, `bridge`, `targetPhase`) consistent throughout. ✓
