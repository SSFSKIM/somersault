import { describe, it, expect } from "vitest";
import { z } from "zod";
import { runStructured, StructuredRunError } from "../../src/structured/run.js";
import { buildTaskTools } from "../../src/tasks/server.js";
import { buildSwarmTools } from "../../src/swarm/server.js";
import { buildContextTools } from "../../src/context/server.js";
import { buildCompactTools } from "../../src/compaction/server.js";
import { buildBriefTools } from "../../src/kairos/brief.js";
import { TaskStore } from "../../src/tasks/store.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Fake QueryFn: yields an init frame + a result frame shaped like the SDK's (probe 53).
function fakeQuery(resultFrame: Record<string, unknown>, capture?: { options?: any }) {
  return ((args: { options: any }) => {
    if (capture) capture.options = args.options;
    return (async function* () {
      yield { type: "system", subtype: "init", session_id: "s-1" };
      yield { type: "result", ...resultFrame };
    })();
  }) as any;
}

const shape = z.object({ answer: z.number(), word: z.string() });

describe("runStructured", () => {
  it("success: sets outputFormat from the zod schema and returns parsed typed data", async () => {
    const capture: { options?: any } = {};
    const data = await runStructured(shape, "2+3?", {}, { query: fakeQuery({ subtype: "success", structured_output: { answer: 5, word: "five" } }, capture) });
    expect(data).toEqual({ answer: 5, word: "five" });
    expect(capture.options.outputFormat.type).toBe("json_schema");
    expect(capture.options.outputFormat.schema.properties.answer).toBeTruthy(); // z.toJSONSchema ran
  });

  it("replaces a caller-set outputFormat with the schema's", async () => {
    const capture: { options?: any } = {};
    await runStructured(shape, "p", { outputFormat: { type: "json_schema", schema: { stale: true } } },
      { query: fakeQuery({ subtype: "success", structured_output: { answer: 1, word: "one" } }, capture) });
    expect(capture.options.outputFormat.schema.stale).toBeUndefined();
  });

  it("non-success subtype → StructuredRunError with subtype + raw attached", async () => {
    const err = await runStructured(shape, "p", {}, { query: fakeQuery({ subtype: "error_max_structured_output_retries", result: "nope" }) }).catch((e) => e);
    expect(err).toBeInstanceOf(StructuredRunError);
    expect(err.subtype).toBe("error_max_structured_output_retries");
    expect(err.raw.result).toBe("nope");
  });

  it("success but structured_output absent → StructuredRunError", async () => {
    const err = await runStructured(shape, "p", {}, { query: fakeQuery({ subtype: "success", result: "plain text" }) }).catch((e) => e);
    expect(err).toBeInstanceOf(StructuredRunError);
    expect(err.message).toContain("no structured_output");
  });

  it("present-but-wrong-shape structured_output → zod error (not StructuredRunError)", async () => {
    const err = await runStructured(shape, "p", {}, { query: fakeQuery({ subtype: "success", structured_output: { answer: "five" } }) }).catch((e) => e);
    expect(err).toBeInstanceOf(z.ZodError);
  });
});

describe("W4.2 tool annotations", () => {
  it("all five servers' tools carry annotations with a title; read-only/destructive hints where meaningful", () => {
    const tasks = buildTaskTools(new TaskStore({ dir: mkdtempSync(join(tmpdir(), "ann-")) }));
    const swarm = buildSwarmTools({} as any);
    const ctx = buildContextTools({});
    const compact = buildCompactTools({});
    const brief = buildBriefTools({ write: async () => {} });
    for (const t of [...tasks, ...swarm, ...ctx, ...compact, ...brief] as any[]) {
      expect(t.annotations?.title, `${t.name} has a title`).toBeTruthy();
    }
    const byName = Object.fromEntries([...tasks, ...swarm, ...ctx, ...compact, ...brief].map((t: any) => [t.name, t]));
    expect(byName.TaskGet.annotations.readOnlyHint).toBe(true);
    expect(byName.TaskList.annotations.readOnlyHint).toBe(true);
    expect(byName.GetContextUsage.annotations.readOnlyHint).toBe(true);
    expect(byName.TeamDelete.annotations.destructiveHint).toBe(true);
    expect(byName.ShutdownTeammate.annotations.destructiveHint).toBe(true);
    expect(byName.CheckMessages.annotations.readOnlyHint).toBeUndefined(); // it CLEARS the inbox
  });
});
