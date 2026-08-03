// F3 wave-close live checks (controller-run, gated). Two premises only a live run can settle:
//   A. The INTERACTIVE default now delivers `stream_event` frames end-to-end (t3's SessionHost.engineConfig
//      seam — every prior live e2e set includePartialMessages explicitly, so the default was unproven), and
//      the reconnect replay stays partial-free (t3 review's TurnBuffer rule).
//   B. A real parallel Agent dispatch ASSEMBLES the batch unit (t8 review: the engine emits one frame per
//      content block, so the batch key must ride the API message id — proven here against the live wire, not
//      a fixture).
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionHost } from "../../src/host/host.js";
import type { HostEvent } from "../../src/host/wire.js";
import { TranscriptDocument } from "../../src/tui/transcriptModel.js";
import { agentBatches } from "../../src/tui/agentProgress.js";

const live = (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN) ? describe : describe.skip;
const tmpFleet = () => mkdtempSync(join(tmpdir(), "ccx-f3live-"));

live("F3 live turn (wave-close)", () => {
  it("interactive default streams partials live, keeps the replay partial-free, and assembles a parallel batch", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "f3live-"));
    const host = new SessionHost(
      { short: "f3f3f3f3", name: "f3-live", cwd, kind: "interactive", detached: false,
        config: { cwd, model: "claude-sonnet-4-6", permissionMode: "bypassPermissions", settingSources: [], maxTurns: 4 } as never,
        env: { ...process.env, CCX_FLEET_ROOT: tmpFleet() } },
    );
    await host.start();
    try {
      const frames: unknown[] = [];
      host.follow((e: HostEvent) => { if (e.kind === "message") frames.push(e.data); });

      // A. one tiny text turn — the default interactive engine must emit stream_event frames.
      await host.runTask("Reply with exactly: HELLO");
      const partials = frames.filter((m: any) => m?.type === "stream_event");
      expect(partials.length).toBeGreaterThan(0);                                  // t3 seam live-proven
      const late: unknown[] = [];
      host.follow((e: HostEvent) => { if (e.kind === "message") late.push(e.data); });
      expect(late.filter((m: any) => m?.type === "stream_event")).toHaveLength(0); // replay partial-free

      // B. one parallel dispatch — the batch must form over the live frame shape, whatever it is.
      frames.length = 0;
      await host.runTask([
        "Dispatch exactly TWO subagents using the Agent tool, and dispatch them IN PARALLEL — both Agent",
        "tool calls in one single response. First agent: description \"say alpha\", prompt \"Reply with",
        "exactly: alpha\". Second agent: description \"say beta\", prompt \"Reply with exactly: beta\".",
        "After both return, reply with exactly: BOTH-DONE",
      ].join(" "));
      const doc = new TranscriptDocument();
      for (const m of frames) if ((m as any)?.type === "assistant" || (m as any)?.type === "user") doc.appendSdk("host", m as Record<string, unknown>);
      const agents = doc.toolEvents().filter((e) => e.name === "Agent" && e.route === "top-level");
      expect(agents.length).toBeGreaterThanOrEqual(2);
      // The load-bearing assertion: however the wire split the frames, the unit assembles.
      const batches = agentBatches(doc.toolEvents());
      expect(batches).toHaveLength(1);
      expect(batches[0]!.members.length).toBeGreaterThanOrEqual(2);
      // Evidence for the ledger: record whether the dispatch actually arrived frame-split.
      const ids = new Set(agents.map((a) => a.apiMessageId ?? "none")), seqs = new Set(agents.map((a) => a.callSequence));
      console.log(`[f3-live] agent frames: apiMessageIds=${[...ids].join(",")} callSequences=${[...seqs].join(",")} split=${seqs.size > ids.size}`);
    } finally {
      await host.stop().catch(() => {});
    }
  }, 300_000);
});
