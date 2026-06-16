# Phase 2 · A1 — Task Tools — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the four `Task*` tools (`TaskCreate/Update/Get/List`) to the `cc-harness` package as an in-process MCP server backed by a durable, file-backed task store with a status state-machine, a dependency DAG, and an `owner`/claim primitive.

**Architecture:** A `TaskStore` class (file-backed, atomic temp+rename writes, async-mutex-serialized read-modify-write) holds all task state. `createTaskMcpServer(store)` wraps it in an SDK MCP server via `createSdkMcpServer` + `tool()`. `createHarness` builds the store + server when `config.taskTools` is set, merges it into `options.mcpServers["cc-tasks"]`, and exposes `harness.tasks`. `resolveOptions` stays pure; the stateful wiring lives in `createHarness`.

**Tech Stack:** Node ≥20, TypeScript ESM (NodeNext), `@anthropic-ai/claude-agent-sdk` v0.3.x, `zod/v4`, vitest, tsx.

**Spec:** `docs/superpowers/specs/2026-06-16-phase2-a1-task-tools-design.md` (approved).

**Conventions:** paths relative to `CC-to-SDK/harness/` unless absolute. Repo root = `/Users/new/Documents/GitHub/codex_somersault`. Commits to `main`, no attribution lines. Run commands from `CC-to-SDK/harness/`. Local `.ts` imports use `.js` extensions (NodeNext). Import zod as `import { z } from "zod/v4"` (matches the SDK's `AnyZodRawShape`). The `.env` with `ANTHROPIC_API_KEY` is at `CC-to-SDK/.env` (gitignored) — load with `set -a; source ../.env; set +a` for live tests.

**Note on the spec's `createTaskMcpServer(store, agentName)` signature:** `agentName` is carried by the `TaskStore` (a `TaskStoreOptions` field), so the server factory is `createTaskMcpServer(store)`. This is a deliberate refinement — the store owns the calling-agent identity used by claim.

---

## Task 1: Task types + zod input shapes

**Files:**
- Create: `src/tasks/types.ts`
- Test: `test/unit/tasks-types.test.ts`

- [ ] **Step 1: Write the failing test** (`test/unit/tasks-types.test.ts`)
```ts
import { describe, it, expect } from "vitest";
import { z } from "zod/v4";
import { taskCreateShape, taskUpdateShape, taskGetShape, taskListShape } from "../../src/tasks/types.js";

describe("task zod shapes", () => {
  it("TaskCreate requires subject and accepts optional deps/metadata", () => {
    const schema = z.object(taskCreateShape);
    expect(schema.parse({ subject: "x", blockedBy: [1], metadata: { a: 1 } }).subject).toBe("x");
    expect(() => schema.parse({})).toThrow();
  });
  it("TaskUpdate requires id, restricts status to the enum", () => {
    const schema = z.object(taskUpdateShape);
    expect(schema.parse({ id: 3, status: "in_progress" }).id).toBe(3);
    expect(() => schema.parse({ id: 1, status: "bogus" })).toThrow();
    expect(() => schema.parse({ status: "completed" })).toThrow(); // missing id
  });
  it("TaskGet/TaskList shapes parse", () => {
    expect(z.object(taskGetShape).parse({ id: 2 }).id).toBe(2);
    expect(z.object(taskListShape).parse({ status: "pending", owner: "main" }).owner).toBe("main");
    expect(z.object(taskListShape).parse({}).status).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run — verify it fails**
Run: `npx vitest run test/unit/tasks-types.test.ts`
Expected: FAIL — cannot find module `tasks/types.js`.

- [ ] **Step 3: Implement `src/tasks/types.ts`**
```ts
import { z } from "zod/v4";

export type TaskStatus = "pending" | "in_progress" | "completed" | "deleted";

export interface Task {
  id: number;
  subject: string;
  description?: string;
  activeForm?: string;      // present-continuous label shown while in_progress (CC convention)
  status: TaskStatus;
  owner?: string;           // agent name; set on claim
  blocks: number[];         // ids this task blocks
  blockedBy: number[];      // ids blocking this task
  metadata?: Record<string, unknown>;
  createdAt: string;        // ISO
  updatedAt: string;        // ISO
}

export interface TaskStoreOptions {
  cwd?: string;
  dir?: string;             // override directory; default <cwd>/.cc-harness/tasks
  listId?: string;          // default "default"
  agentName?: string;       // default "main"
  onOwnerChange?: (task: Task, prevOwner: string | undefined) => void;
}

const STATUS = z.enum(["pending", "in_progress", "completed", "deleted"]);

// zod raw shapes (ZodRawShape = plain object of validators) for the four tools.
export const taskCreateShape = {
  subject: z.string(),
  description: z.string().optional(),
  activeForm: z.string().optional(),
  blockedBy: z.array(z.number()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
};
export const taskUpdateShape = {
  id: z.number(),
  subject: z.string().optional(),
  description: z.string().optional(),
  activeForm: z.string().optional(),
  status: STATUS.optional(),
  owner: z.string().optional(),
  blockedBy: z.array(z.number()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
};
export const taskGetShape = { id: z.number() };
export const taskListShape = {
  status: STATUS.optional(),
  owner: z.string().optional(),
};

// Input value types derived from the shapes (used by TaskStore + server).
export type TaskCreateInput = z.infer<z.ZodObject<typeof taskCreateShape>>;
export type TaskUpdateInput = z.infer<z.ZodObject<typeof taskUpdateShape>>;
export type TaskUpdatePatch = Omit<TaskUpdateInput, "id">;
export type TaskListFilter = z.infer<z.ZodObject<typeof taskListShape>>;
```

- [ ] **Step 4: Run — verify pass**
Run: `npx vitest run test/unit/tasks-types.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add CC-to-SDK/harness/src/tasks/types.ts CC-to-SDK/harness/test/unit/tasks-types.test.ts
git commit -m "feat(harness): task types + zod input shapes"
```

---

## Task 2: TaskStore core — create / get / atomic persistence

**Files:**
- Create: `src/tasks/store.ts`
- Test: `test/unit/tasks-store-core.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskStore } from "../../src/tasks/store.js";

const newStore = () => new TaskStore({ dir: mkdtempSync(join(tmpdir(), "tasks-")) });

describe("TaskStore core", () => {
  it("create returns an auto-incrementing pending task", async () => {
    const s = newStore();
    const a = await s.create({ subject: "first" });
    const b = await s.create({ subject: "second" });
    expect(a.id).toBe(1);
    expect(a.status).toBe("pending");
    expect(a.blocks).toEqual([]);
    expect(a.blockedBy).toEqual([]);
    expect(b.id).toBe(2);
  });
  it("get returns a task by id, undefined for unknown", async () => {
    const s = newStore();
    const a = await s.create({ subject: "x", description: "d", metadata: { k: 1 } });
    expect((await s.get(1))?.subject).toBe("x");
    expect((await s.get(1))?.description).toBe("d");
    expect(await s.get(99)).toBeUndefined();
  });
  it("create rejects unknown blocker ids", async () => {
    const s = newStore();
    await expect(s.create({ subject: "x", blockedBy: [42] })).rejects.toThrow(/unknown blocker/);
  });
  it("persists atomically: a fresh store on the same dir sees prior tasks", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tasks-"));
    const s1 = new TaskStore({ dir });
    await s1.create({ subject: "persisted" });
    const s2 = new TaskStore({ dir });
    expect((await s2.get(1))?.subject).toBe("persisted");
    expect((await s2.create({ subject: "next" })).id).toBe(2); // nextId survived reload
  });
});
```

- [ ] **Step 2: Run — verify it fails**
Run: `npx vitest run test/unit/tasks-store-core.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/tasks/store.ts`**
```ts
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Task, TaskStatus, TaskStoreOptions, TaskCreateInput, TaskUpdatePatch, TaskListFilter } from "./types.js";

interface StoreFile { nextId: number; tasks: Task[]; }

export class TaskError extends Error {}

export interface TaskListItem {
  id: number; subject: string; status: TaskStatus; owner?: string; blockedBy: number[];
}

export class TaskStore {
  private file: string;
  private agentName: string;
  private onOwnerChange?: TaskStoreOptions["onOwnerChange"];
  private chain: Promise<unknown> = Promise.resolve(); // async mutex tail

  constructor(opts: TaskStoreOptions = {}) {
    const cwd = opts.cwd ?? process.cwd();
    const dir = opts.dir ?? join(cwd, ".cc-harness", "tasks");
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, `${opts.listId ?? "default"}.json`);
    this.agentName = opts.agentName ?? "main";
    this.onOwnerChange = opts.onOwnerChange;
  }

  /** Serialize read-modify-write so concurrent callers cannot interleave. */
  private run<T>(fn: () => T): Promise<T> {
    const result = this.chain.then(() => fn());
    this.chain = result.catch(() => {}); // keep the mutex chain alive after a rejection
    return result;
  }

  private load(): StoreFile {
    if (!existsSync(this.file)) return { nextId: 1, tasks: [] };
    return JSON.parse(readFileSync(this.file, "utf8")) as StoreFile;
  }

  private save(data: StoreFile): void {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, this.file); // atomic replace
  }

  create(input: TaskCreateInput): Promise<Task> {
    return this.run(() => {
      const data = this.load();
      const blockedBy = input.blockedBy ?? [];
      for (const b of blockedBy) {
        if (!data.tasks.some((t) => t.id === b)) throw new TaskError(`unknown blocker id ${b}`);
      }
      const now = new Date().toISOString();
      const task: Task = {
        id: data.nextId,
        subject: input.subject,
        description: input.description,
        activeForm: input.activeForm,
        status: "pending",
        blocks: [],
        blockedBy: [...blockedBy],
        metadata: input.metadata,
        createdAt: now,
        updatedAt: now,
      };
      data.tasks.push(task);
      for (const b of blockedBy) {
        const bt = data.tasks.find((t) => t.id === b)!;
        if (!bt.blocks.includes(task.id)) bt.blocks.push(task.id);
      }
      data.nextId += 1;
      this.save(data);
      return task;
    });
  }

  get(id: number): Promise<Task | undefined> {
    return this.run(() => this.load().tasks.find((t) => t.id === id));
  }
}
```

- [ ] **Step 4: Run — verify pass**
Run: `npx vitest run test/unit/tasks-store-core.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add CC-to-SDK/harness/src/tasks/store.ts CC-to-SDK/harness/test/unit/tasks-store-core.test.ts
git commit -m "feat(harness): TaskStore core (create/get + atomic file persistence + async mutex)"
```

---

## Task 3: TaskStore — update + status state-machine

**Files:**
- Modify: `src/tasks/store.ts`
- Test: `test/unit/tasks-store-update.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskStore } from "../../src/tasks/store.js";

const newStore = () => new TaskStore({ dir: mkdtempSync(join(tmpdir(), "tasks-")) });

describe("TaskStore update + status machine", () => {
  it("applies field changes and bumps updatedAt", async () => {
    const s = newStore();
    await s.create({ subject: "x" });
    const u = await s.update(1, { subject: "y", description: "d" });
    expect(u.subject).toBe("y");
    expect(u.description).toBe("d");
  });
  it("allows forward transitions pending->in_progress->completed", async () => {
    const s = newStore();
    await s.create({ subject: "x" });
    expect((await s.update(1, { status: "in_progress" })).status).toBe("in_progress");
    expect((await s.update(1, { status: "completed" })).status).toBe("completed");
  });
  it("rejects backward transitions", async () => {
    const s = newStore();
    await s.create({ subject: "x" });
    await s.update(1, { status: "in_progress" });
    await s.update(1, { status: "completed" });
    await expect(s.update(1, { status: "pending" })).rejects.toThrow(/illegal transition/);
  });
  it("treats deleted as terminal and same-status as a no-op", async () => {
    const s = newStore();
    await s.create({ subject: "x" });
    expect((await s.update(1, { status: "pending" })).status).toBe("pending"); // no-op success
    await s.update(1, { status: "deleted" });
    await expect(s.update(1, { subject: "z" })).rejects.toThrow(/deleted/);
  });
  it("rejects updates to unknown ids", async () => {
    const s = newStore();
    await expect(s.update(99, { subject: "x" })).rejects.toThrow(/unknown task/);
  });
});
```

- [ ] **Step 2: Run — verify it fails**
Run: `npx vitest run test/unit/tasks-store-update.test.ts`
Expected: FAIL — `update` is not a function.

- [ ] **Step 3: Add to `src/tasks/store.ts`** (inside the `TaskStore` class, after `get`)
```ts
  private static readonly LIVE_ORDER: TaskStatus[] = ["pending", "in_progress", "completed"];

  private canTransition(from: TaskStatus, to: TaskStatus): boolean {
    if (from === to) return true;
    if (from === "deleted") return false;
    if (to === "deleted") return true;
    return TaskStore.LIVE_ORDER.indexOf(to) > TaskStore.LIVE_ORDER.indexOf(from); // forward only
  }

  update(id: number, patch: TaskUpdatePatch): Promise<Task> {
    return this.run(() => {
      const data = this.load();
      const task = data.tasks.find((t) => t.id === id);
      if (!task) throw new TaskError(`unknown task id ${id}`);
      if (task.status === "deleted") throw new TaskError(`task ${id} is deleted`);
      const prevOwner = task.owner;

      if (patch.status !== undefined && patch.status !== task.status) {
        if (!this.canTransition(task.status, patch.status)) {
          throw new TaskError(`illegal transition ${task.status}->${patch.status}`);
        }
        task.status = patch.status;
      }
      if (patch.subject !== undefined) task.subject = patch.subject;
      if (patch.description !== undefined) task.description = patch.description;
      if (patch.activeForm !== undefined) task.activeForm = patch.activeForm;
      if (patch.metadata !== undefined) task.metadata = patch.metadata;

      task.updatedAt = new Date().toISOString();
      this.save(data);
      if (task.owner !== prevOwner) this.onOwnerChange?.(task, prevOwner);
      return task;
    });
  }
```

- [ ] **Step 4: Run — verify pass**
Run: `npx vitest run test/unit/tasks-store-update.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add CC-to-SDK/harness/src/tasks/store.ts CC-to-SDK/harness/test/unit/tasks-store-update.test.ts
git commit -m "feat(harness): TaskStore update + status state-machine"
```

---

## Task 4: TaskStore — dependencies (DAG + cycle rejection)

**Files:**
- Modify: `src/tasks/store.ts`
- Test: `test/unit/tasks-store-deps.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskStore } from "../../src/tasks/store.js";

const newStore = () => new TaskStore({ dir: mkdtempSync(join(tmpdir(), "tasks-")) });

describe("TaskStore dependencies", () => {
  it("setting blockedBy syncs the reverse blocks side", async () => {
    const s = newStore();
    await s.create({ subject: "a" }); // 1
    await s.create({ subject: "b" }); // 2
    await s.update(2, { blockedBy: [1] });
    expect((await s.get(2))?.blockedBy).toEqual([1]);
    expect((await s.get(1))?.blocks).toEqual([2]);
  });
  it("clearing blockedBy removes the reverse edge", async () => {
    const s = newStore();
    await s.create({ subject: "a" }); // 1
    await s.create({ subject: "b", blockedBy: [1] }); // 2
    await s.update(2, { blockedBy: [] });
    expect((await s.get(1))?.blocks).toEqual([]);
  });
  it("rejects unknown blocker ids and self-dependency", async () => {
    const s = newStore();
    await s.create({ subject: "a" }); // 1
    await expect(s.update(1, { blockedBy: [99] })).rejects.toThrow(/unknown blocker/);
    await expect(s.update(1, { blockedBy: [1] })).rejects.toThrow(/cycle/);
  });
  it("rejects a dependency that would create a cycle", async () => {
    const s = newStore();
    await s.create({ subject: "a" }); // 1
    await s.create({ subject: "b", blockedBy: [1] }); // 2 depends on 1
    // making 1 depend on 2 closes a loop
    await expect(s.update(1, { blockedBy: [2] })).rejects.toThrow(/cycle/);
  });
});
```

- [ ] **Step 2: Run — verify it fails**
Run: `npx vitest run test/unit/tasks-store-deps.test.ts`
Expected: FAIL — `blockedBy` changes are ignored (no reverse sync / cycle check yet).

- [ ] **Step 3: Add to `src/tasks/store.ts`** (a private helper, and wire it into `update`)

First add this private method to the `TaskStore` class (after `canTransition`):
```ts
  /** Replace task.blockedBy with `blockedBy`, keeping reverse `blocks` edges in sync and rejecting cycles. */
  private setBlockedBy(data: StoreFile, task: Task, blockedBy: number[]): void {
    for (const b of blockedBy) {
      if (!data.tasks.some((t) => t.id === b)) throw new TaskError(`unknown blocker id ${b}`);
    }
    // A cycle forms if any new blocker `b` already depends (transitively) on `task`.
    const reaches = (start: number, target: number): boolean => {
      const seen = new Set<number>();
      const stack = [start];
      while (stack.length) {
        const cur = stack.pop()!;
        if (cur === target) return true;
        if (seen.has(cur)) continue;
        seen.add(cur);
        const t = data.tasks.find((x) => x.id === cur);
        if (t) stack.push(...t.blockedBy);
      }
      return false;
    };
    for (const b of blockedBy) {
      if (b === task.id || reaches(b, task.id)) throw new TaskError(`dependency cycle via task ${b}`);
    }
    // Apply: drop task from old blockers no longer present, set new list, add reverse edges.
    for (const t of data.tasks) {
      const i = t.blocks.indexOf(task.id);
      if (i >= 0 && !blockedBy.includes(t.id)) t.blocks.splice(i, 1);
    }
    task.blockedBy = [...blockedBy];
    for (const b of blockedBy) {
      const bt = data.tasks.find((t) => t.id === b)!;
      if (!bt.blocks.includes(task.id)) bt.blocks.push(task.id);
    }
  }
```

Then, in `update`, add the dependency handling immediately before `task.updatedAt = ...`:
```ts
      if (patch.blockedBy !== undefined) this.setBlockedBy(data, task, patch.blockedBy);
```

- [ ] **Step 4: Run — verify pass**
Run: `npx vitest run test/unit/tasks-store-deps.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add CC-to-SDK/harness/src/tasks/store.ts CC-to-SDK/harness/test/unit/tasks-store-deps.test.ts
git commit -m "feat(harness): TaskStore dependency DAG (bidirectional sync + cycle rejection)"
```

---

## Task 5: TaskStore — claim CAS, ownership, list filtering, concurrency

**Files:**
- Modify: `src/tasks/store.ts`
- Test: `test/unit/tasks-store-claim.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskStore } from "../../src/tasks/store.js";

const dir = () => mkdtempSync(join(tmpdir(), "tasks-"));

describe("TaskStore claim + ownership + list", () => {
  it("claims for the calling agent on in_progress", async () => {
    const s = new TaskStore({ dir: dir(), agentName: "alice" });
    await s.create({ subject: "x" });
    expect((await s.update(1, { status: "in_progress" })).owner).toBe("alice");
  });
  it("refuses to claim when a blocker is unresolved", async () => {
    const s = new TaskStore({ dir: dir(), agentName: "alice" });
    await s.create({ subject: "blocker" });           // 1
    await s.create({ subject: "work", blockedBy: [1] }); // 2
    await expect(s.update(2, { status: "in_progress" })).rejects.toThrow(/blocked by/);
    await s.update(1, { status: "in_progress" });
    await s.update(1, { status: "completed" });
    expect((await s.update(2, { status: "in_progress" })).owner).toBe("alice"); // now claimable
  });
  it("refuses to claim a task owned by a different agent", async () => {
    const d = dir();
    const alice = new TaskStore({ dir: d, agentName: "alice" });
    const bob = new TaskStore({ dir: d, agentName: "bob" });
    await alice.create({ subject: "x" });
    await alice.update(1, { status: "in_progress" }); // alice owns it
    await expect(bob.update(1, { status: "in_progress" })).rejects.toThrow(/already owned/);
  });
  it("explicit owner change is a reassignment and fires onOwnerChange", async () => {
    const cb = vi.fn();
    const s = new TaskStore({ dir: dir(), agentName: "alice", onOwnerChange: cb });
    await s.create({ subject: "x" });
    const u = await s.update(1, { owner: "carol" });
    expect(u.owner).toBe("carol");
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ id: 1, owner: "carol" }), undefined);
  });
  it("list excludes deleted, filters by status/owner, shows unresolved blockers only", async () => {
    const s = new TaskStore({ dir: dir(), agentName: "alice" });
    await s.create({ subject: "a" });               // 1
    await s.create({ subject: "b", blockedBy: [1] }); // 2
    await s.create({ subject: "gone" });            // 3
    await s.update(3, { status: "deleted" });
    let l = await s.list();
    expect(l.map((t) => t.id)).toEqual([1, 2]);     // no deleted
    expect(l.find((t) => t.id === 2)?.blockedBy).toEqual([1]); // unresolved blocker shown
    await s.update(1, { status: "in_progress" });
    await s.update(1, { status: "completed" });
    l = await s.list();
    expect(l.find((t) => t.id === 2)?.blockedBy).toEqual([]); // completed blocker filtered out
    expect((await s.list({ status: "completed" })).map((t) => t.id)).toEqual([1]);
  });
  it("serializes concurrent updates (consistent final nextId)", async () => {
    const s = new TaskStore({ dir: dir(), agentName: "alice" });
    await Promise.all([1, 2, 3, 4, 5].map((n) => s.create({ subject: `t${n}` })));
    expect((await s.list()).length).toBe(5);
    expect((await s.create({ subject: "next" })).id).toBe(6); // ids never collided
  });
});
```

- [ ] **Step 2: Run — verify it fails**
Run: `npx vitest run test/unit/tasks-store-claim.test.ts`
Expected: FAIL — no claim logic / `list` is not a function.

- [ ] **Step 3: Update `src/tasks/store.ts`**

(a) Replace the status-transition block in `update` (the `if (patch.status !== undefined ...)` block) with this claim-aware version:
```ts
      if (patch.status !== undefined && patch.status !== task.status) {
        if (!this.canTransition(task.status, patch.status)) {
          throw new TaskError(`illegal transition ${task.status}->${patch.status}`);
        }
        if (patch.status === "in_progress") {
          const unresolved = task.blockedBy.filter((b) => {
            const bt = data.tasks.find((t) => t.id === b);
            return !bt || bt.status !== "completed";
          });
          if (unresolved.length) throw new TaskError(`blocked by unresolved tasks: ${unresolved.join(",")}`);
          if (task.owner && task.owner !== this.agentName) throw new TaskError(`already owned by ${task.owner}`);
          task.owner = this.agentName;
        }
        task.status = patch.status;
      }
```

(b) Add a `list` method to the `TaskStore` class (after `update`):
```ts
  list(filter: TaskListFilter = {}): Promise<TaskListItem[]> {
    return this.run(() => {
      const data = this.load();
      return data.tasks
        .filter((t) => t.status !== "deleted")
        .filter((t) => !filter.status || t.status === filter.status)
        .filter((t) => !filter.owner || t.owner === filter.owner)
        .map((t) => ({
          id: t.id,
          subject: t.subject,
          status: t.status,
          owner: t.owner,
          blockedBy: t.blockedBy.filter((b) => {
            const bt = data.tasks.find((x) => x.id === b);
            return !!bt && bt.status !== "completed";
          }),
        }));
    });
  }
```

- [ ] **Step 4: Run — verify pass**
Run: `npx vitest run test/unit/tasks-store-claim.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add CC-to-SDK/harness/src/tasks/store.ts CC-to-SDK/harness/test/unit/tasks-store-claim.test.ts
git commit -m "feat(harness): TaskStore claim CAS + ownership + list filtering"
```

---

## Task 6: Task MCP server (the four tools)

**Files:**
- Create: `src/tasks/server.ts`
- Test: `test/unit/tasks-server.test.ts`

- [ ] **Step 1: Write the failing test** (drives the handlers directly via the SDK tool definitions)
```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskStore } from "../../src/tasks/store.js";
import { createTaskMcpServer } from "../../src/tasks/server.js";

// Pull the SDK tool definitions back out of the server instance to call their handlers.
function tools(store: TaskStore) {
  const server: any = createTaskMcpServer(store);
  const list = server.instance?.tools ?? server.tools ?? server._tools;
  const map: Record<string, any> = {};
  for (const t of list) map[t.name] = t;
  return map;
}
const text = (r: any) => r.content[0].text;

describe("task MCP server", () => {
  it("exposes the four Task tools", () => {
    const t = tools(new TaskStore({ dir: mkdtempSync(join(tmpdir(), "tasks-")) }));
    expect(Object.keys(t).sort()).toEqual(["TaskCreate", "TaskGet", "TaskList", "TaskUpdate"]);
  });
  it("TaskCreate then TaskGet round-trips through the store", async () => {
    const t = tools(new TaskStore({ dir: mkdtempSync(join(tmpdir(), "tasks-")) }));
    const created = await t.TaskCreate.handler({ subject: "hello" }, {});
    expect(JSON.parse(text(created)).id).toBe(1);
    const got = await t.TaskGet.handler({ id: 1 }, {});
    expect(JSON.parse(text(got)).subject).toBe("hello");
  });
  it("domain errors come back as isError results, not throws", async () => {
    const t = tools(new TaskStore({ dir: mkdtempSync(join(tmpdir(), "tasks-")) }));
    const bad = await t.TaskUpdate.handler({ id: 99, subject: "x" }, {});
    expect(bad.isError).toBe(true);
    expect(text(bad)).toMatch(/unknown task/);
    const missing = await t.TaskGet.handler({ id: 5 }, {});
    expect(missing.isError).toBe(true);
  });
});
```

- [ ] **Step 2: Run — verify it fails**
Run: `npx vitest run test/unit/tasks-server.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/tasks/server.ts`**
```ts
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import type { TaskStore } from "./store.js";
import { taskCreateShape, taskUpdateShape, taskGetShape, taskListShape } from "./types.js";

const ok = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data) }] });
const fail = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true });

/** Wrap a TaskStore as an in-process SDK MCP server exposing the four Task* tools. */
export function createTaskMcpServer(store: TaskStore) {
  return createSdkMcpServer({
    name: "cc-tasks",
    version: "0.1.0",
    tools: [
      tool("TaskCreate", "Create a durable task (starts pending). Optionally blockedBy other task ids.", taskCreateShape, async (args) => {
        try { return ok(await store.create(args)); } catch (e) { return fail((e as Error).message); }
      }),
      tool("TaskUpdate", "Update a task's fields, status, owner, or dependencies by id.", taskUpdateShape, async (args) => {
        const { id, ...patch } = args;
        try { return ok(await store.update(id, patch)); } catch (e) { return fail((e as Error).message); }
      }),
      tool("TaskGet", "Get a single task by id.", taskGetShape, async (args) => {
        const t = await store.get(args.id);
        return t ? ok(t) : fail(`unknown task id ${args.id}`);
      }),
      tool("TaskList", "List non-deleted tasks (showing only unresolved blockers). Filter by status/owner.", taskListShape, async (args) => {
        return ok(await store.list(args));
      }),
    ],
  });
}
```

- [ ] **Step 4: Run — verify pass**
Run: `npx vitest run test/unit/tasks-server.test.ts`
Expected: PASS. If the test's `tools()` reflection cannot find the definitions array on the server instance, inspect the object shape once with `console.log(Object.keys(server), Object.keys(server.instance ?? {}))` and adjust the `list` lookup accordingly — do NOT weaken the handler assertions.

- [ ] **Step 5: Commit**
```bash
git add CC-to-SDK/harness/src/tasks/server.ts CC-to-SDK/harness/test/unit/tasks-server.test.ts
git commit -m "feat(harness): Task* MCP server (createSdkMcpServer + tool handlers)"
```

---

## Task 7: Integration — config, createHarness wiring, public exports

**Files:**
- Create: `src/tasks/index.ts`
- Modify: `src/config/types.ts` (add `taskTools`)
- Modify: `src/harness.ts` (build/merge server, expose `harness.tasks`)
- Modify: `src/index.ts` (re-export task API)
- Test: `test/unit/tasks-integration.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHarness } from "../../src/index.js";

function fakeQuery() {
  const q: any = (async function* () { yield { type: "result", subtype: "success", result: "ok" }; })();
  return q;
}

describe("taskTools integration", () => {
  it("does not register the server when taskTools is unset", () => {
    const h = createHarness({}, { query: fakeQuery });
    expect(h.tasks).toBeUndefined();
    expect((h.options as any).mcpServers?.["cc-tasks"]).toBeUndefined();
  });
  it("registers cc-tasks and exposes harness.tasks when enabled", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tasks-"));
    const h = createHarness({ taskTools: { dir } }, { query: fakeQuery });
    expect((h.options as any).mcpServers["cc-tasks"]).toBeTruthy();
    expect(h.tasks).toBeTruthy();
    const t = await h.tasks!.create({ subject: "wired" });
    expect(t.id).toBe(1);
  });
  it("preserves user-supplied mcpServers alongside cc-tasks", () => {
    const dir = mkdtempSync(join(tmpdir(), "tasks-"));
    const h = createHarness(
      { taskTools: { dir }, mcpServers: { other: { type: "stdio", command: "echo" } } },
      { query: fakeQuery },
    );
    expect((h.options as any).mcpServers.other).toBeTruthy();
    expect((h.options as any).mcpServers["cc-tasks"]).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run — verify it fails**
Run: `npx vitest run test/unit/tasks-integration.test.ts`
Expected: FAIL — `h.tasks` is undefined / `taskTools` not honored.

- [ ] **Step 3a: Add `taskTools` to `HarnessConfig`** in `src/config/types.ts` (in the `// checkpointing / mcp / plugins` group, right after `enableFileCheckpointing`):
```ts
  // task tools (Phase 2 A1): durable Task* MCP server
  taskTools?: boolean | { dir?: string; listId?: string; agentName?: string };
```

- [ ] **Step 3b: Create `src/tasks/index.ts`**
```ts
export { TaskStore, TaskError } from "./store.js";
export type { TaskListItem } from "./store.js";
export { createTaskMcpServer } from "./server.js";
export type { Task, TaskStatus, TaskStoreOptions } from "./types.js";
```

- [ ] **Step 3c: Wire the store into `src/harness.ts`.**

Add imports at the top:
```ts
import { TaskStore } from "./tasks/store.js";
import { createTaskMcpServer } from "./tasks/server.js";
```

Add `tasks` to the `Harness` interface (after `supportedAgents`):
```ts
  tasks?: TaskStore;
```

In `createHarness`, after `const options = resolveOptions(config);` build and merge the server:
```ts
  let tasks: TaskStore | undefined;
  if (config.taskTools) {
    const opts = config.taskTools === true ? {} : config.taskTools;
    tasks = new TaskStore({ cwd: config.cwd, dir: opts.dir, listId: opts.listId, agentName: opts.agentName });
    const existing = (options.mcpServers as Record<string, unknown>) ?? {};
    options.mcpServers = { ...existing, "cc-tasks": createTaskMcpServer(tasks) };
  }
```

Add `tasks` to the returned object (in the final `return { ... }`):
```ts
    tasks,
```

- [ ] **Step 3d: Re-export the task API** from `src/index.ts` (append):
```ts
export { TaskStore, TaskError, createTaskMcpServer } from "./tasks/index.js";
export type { Task, TaskStatus, TaskStoreOptions, TaskListItem } from "./tasks/index.js";
```

- [ ] **Step 4: Run — verify pass + full unit suite + typecheck**
Run: `npx vitest run test/unit && npx tsc --noEmit`
Expected: all unit tests PASS; tsc clean.

- [ ] **Step 5: Commit**
```bash
git add CC-to-SDK/harness/src/tasks/index.ts CC-to-SDK/harness/src/config/types.ts CC-to-SDK/harness/src/harness.ts CC-to-SDK/harness/src/index.ts CC-to-SDK/harness/test/unit/tasks-integration.test.ts
git commit -m "feat(harness): wire taskTools into createHarness + public exports"
```

---

## Task 8: Live verification (real SDK)

**Files:**
- Create: `test/live/tasks.test.ts`

- [ ] **Step 1: Write the live test**
```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHarness } from "../../src/index.js";

const live = process.env.ANTHROPIC_API_KEY ? describe : describe.skip;

live("live task tools (real SDK)", () => {
  it("the model creates dependent tasks and lists them via the MCP tools", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tasks-live-"));
    const h = createHarness({
      taskTools: { dir },
      permissionMode: "bypassPermissions",
      maxTurns: 8,
    });
    await h.run(
      "Use the TaskCreate tool to create a task with subject 'first'. " +
      "Then use TaskCreate to create a task 'second' that is blockedBy the first task's id. " +
      "Then call TaskList. Do not ask me anything; just use the tools.",
    );
    const all = await h.tasks!.list();
    expect(all.length).toBe(2);
    const second = all.find((t) => t.subject.toLowerCase().includes("second"));
    expect(second?.blockedBy.length).toBe(1); // depends on 'first'
  });
});
```

- [ ] **Step 2: Run the live suite**
Run: `cd CC-to-SDK/harness && set -a; source ../.env; set +a && npx vitest run test/live/tasks.test.ts`
Expected: PASS (1 test). If `ANTHROPIC_API_KEY` is unset or the account has no credit, the suite auto-skips / errors on balance — that is environmental, not a code failure; record it and proceed. Do NOT weaken the assertions to make a credit-less run "pass".

- [ ] **Step 3: Commit**
```bash
git add CC-to-SDK/harness/test/live/tasks.test.ts
git commit -m "test(harness): live verification for Task* tools (real SDK)"
```

---

## Task 9: README + final verification

**Files:**
- Modify: `harness/README.md`

- [ ] **Step 1: Document the task tools in `harness/README.md`.** Add a "## Task tools (Phase 2 · A1)" section covering: enabling via `taskTools: true | { dir?, listId?, agentName? }`; the four `Task*` tools and their behavior; the durable store location (`<cwd>/.cc-harness/tasks/<listId>.json`); the status state-machine, dependency DAG, and `owner`/claim semantics; `harness.tasks` for programmatic access; and the `onOwnerChange` seam reserved for the A2 swarm. Keep it consistent with the existing README's note style.

- [ ] **Step 2: Final verify**
Run: `cd CC-to-SDK/harness && npx tsc --noEmit && npx vitest run test/unit`
Expected: tsc clean; all unit tests pass.

- [ ] **Step 3: Commit**
```bash
git add CC-to-SDK/harness/README.md
git commit -m "docs(harness): document Task tools (Phase 2 A1)"
```

---

## Self-Review (plan vs spec)

- **Spec §1 goal (four Task* tools as MCP server over a durable store):** Tasks 1–6 build store+tools; Task 7 wires the server. ✓
- **Spec §4 modules:** types(T1), store(T2–T5), server(T6), index+config+harness(T7). ✓
- **Spec §5 schema + semantics:** schema/types T1; persistence+atomic+mutex T2; status machine T3; deps DAG+cycle T4; claim CAS + ownership + onOwnerChange + list filtering T5. ✓
- **Spec §6 four tools + isError semantics:** T6 (errors returned as `isError`, verified). ✓
- **Spec §7 integration (taskTools → createHarness → mcpServers + harness.tasks):** T7. ✓
- **Spec §8 verification (unit + live):** unit T1–T7 (incl. concurrency in T5, isError in T6, mcpServers preservation in T7); live T8. ✓
- **Spec §9 non-goals:** no TodoWrite/nudge/full-hooks/multi-process-lock tasks present. `onOwnerChange` seam shipped (T5), notify deferred. ✓
- **Spec §10 success criteria:** model-callable tools (T8), durable store survives reload (T2), state-machine/DAG/claim unit-tested (T3–T5), createHarness auto-registers (T7), tsc/vitest green (T7/T9). ✓
- **Placeholder scan:** every code step has complete code; README step (T9-S1) is descriptive prose for a doc file, not code — acceptable. ✓
- **Type consistency:** `TaskStore`, `TaskError`, `TaskListItem`, `TaskStoreOptions`, `Task`, `TaskStatus`, `taskCreateShape/taskUpdateShape/taskGetShape/taskListShape`, `TaskCreateInput/TaskUpdatePatch/TaskListFilter`, `createTaskMcpServer(store)`, `createHarness().tasks`, `config.taskTools` consistent across T1–T9. ✓
- **Note:** `update`'s status block is introduced in T3 and **replaced** in T5 (claim-aware). T5 Step 3a states this explicitly to avoid a stale duplicate. ✓
