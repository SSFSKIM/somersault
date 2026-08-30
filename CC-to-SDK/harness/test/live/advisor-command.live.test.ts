// harness/test/live/advisor-command.live.test.ts — bl8 T-ADVCMD Task 5 (A11): keyed live proof that a
// mid-session `/advisor sonnet` threads through the REAL REPL submit chain (SessionHost + remoteChatSession,
// the same seam test/live/advisor.e2e.test.ts and knobs.live.test.ts drive) — i.e. that the engine's own
// `applyFlagSettings({advisorModel})` genuinely ACCEPTS ccx's own choke point (`applyAdvisorChoice` →
// `session.setAdvisorModel`), not just a synthetic fixture. This is deliberately the CHEAP half of A11: it
// does not try to force a consult (that costs ~$0.39 and cannot be prompted for honestly — see A9, which
// pins the render path with a synthetic advisor frame, and advisor.e2e.test.ts, which already proves a
// forced consult end to end for bl7 T-ADVISOR). Per the spec's amended A11, the consult-render half here is
// evidence-optional: only asserted if the model happens to reach for the advisor tool on its own.
//
// Pairing choice: sonnet main + sonnet advisor (rank 3 <= 3 passes canon's `ale` pairing) — the cheapest
// combination that still exercises a REAL "set" outcome with no unsupported/pairing Note, unlike an
// opus-advisor pairing which would also work but costs more for zero extra assertion value here.
//
// Run: set -a; . ../.env; set +a; unset ANTHROPIC_API_KEY; npx vitest run test/live/advisor-command.live.test.ts
// Cost: one ordinary sonnet turn (no forced consult) — run once, not in loops. NEVER print/echo/log the
// OAuth token or API key.
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionHost } from "../../src/host/host.js";
import { remoteChatSession } from "../../src/client/chatAdapter.js";
import { RemoteChatSession } from "../../src/client/remote.js";
import type { HostEvent } from "../../src/host/wire.js";
import { hostSocketPath } from "../../src/fleet/paths.js";
import { resolveModelAlias } from "../../src/config/models.js";
import { applyAdvisorChoice, advisorDisplayName } from "../../src/tui/advisorModel.js";
import { getSessionMessages } from "../../src/sessions/index.js";
import { replayDocument } from "../../src/tui/replay.js";
import { projectCompact, type ProjectionOptions } from "../../src/tui/toolRenderer.js";

const live = (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN) ? describe : describe.skip;

const SONNET = resolveModelAlias("sonnet")!; // "claude-sonnet-5"

type Frame = Record<string, unknown>;

live("bl8 T-ADVCMD Task 5 (A11) — /advisor sonnet mid-session, through the real REPL submit chain", () => {
  it("applies via the real engine's applyFlagSettings, renders the expected result line, and keeps the session usable", async () => {
    const cwd = realpathSync(mkdtempSync(join(tmpdir(), "bl8advcmd-live-")));
    const fleetRoot = mkdtempSync(join(tmpdir(), "bl8advcmd-fleet-"));
    const env = { ...process.env, CCX_FLEET_ROOT: fleetRoot } as NodeJS.ProcessEnv;
    // "open a session WITHOUT advisorModel" (Task 5 brief) — advisorModel is absent from config entirely.
    const host = new SessionHost(
      { short: "b18adc01", name: "bl8-advcmd-live", cwd, kind: "interactive", detached: false,
        config: { cwd, model: SONNET, permissionMode: "bypassPermissions", settingSources: [], maxTurns: 4 } as never,
        env },
    );
    await host.start();
    const socketPath = hostSocketPath(process.pid, env);
    const adapter = remoteChatSession(socketPath);
    let sessionId: string | undefined;
    const captureId = (m: Frame): void => { const sid = m.session_id; if (typeof sid === "string" && sid) sessionId = sid; };

    const observer = await RemoteChatSession.connect(socketPath);
    const turnEnds: Array<{ result?: unknown; failure?: unknown; error?: string }> = [];
    observer.follow((ev: HostEvent) => { if (ev.kind === "turn" && ev.phase === "end") turnEnds.push({ result: ev.result, failure: ev.failure, error: ev.error }); });
    await observer.whenFollowed();
    const nextTurnEnd = async (): Promise<{ result?: unknown; failure?: unknown; error?: string }> => {
      const deadline = Date.now() + 60_000;
      while (turnEnds.length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
      const end = turnEnds.shift();
      if (!end) throw new Error("no turn-end event observed within 60s of the submit settling");
      return end;
    };

    try {
      // ---- the pure choke point ccx's /advisor dispatch (useChat.ts's applyAdvisor) itself calls, so the
      // "result line" this asserts is EXACTLY what a real `/advisor sonnet` would append. Sonnet main +
      // sonnet advisor both support and pair (3 <= 3), so this is the plain "set" branch with no Note. ----
      const choice = applyAdvisorChoice("sonnet", SONNET, undefined);
      expect(choice).toEqual({ action: "set", model: SONNET, message: `Advisor set to ${advisorDisplayName(SONNET)}` });

      // ---- the LIVE half: the real engine's applyFlagSettings({advisorModel}) accepting the call ----
      await expect(adapter.setAdvisorModel(choice.action === "set" ? choice.model : null)).resolves.toBeUndefined();

      // ---- the session stays usable after the flag flip — one ordinary, unforced turn ----
      const frames: Frame[] = [];
      await adapter.submit("Reply with exactly one word: hello.", (m) => { frames.push(m as Frame); captureId(m as Frame); });
      const end = await nextTurnEnd();
      expect(end.error).toBeUndefined();
      expect(end.failure).toBeUndefined();
      expect(sessionId).toBeTruthy();

      // ---- evidence-optional (A11, as amended): only if the model reached for the advisor tool unprompted ----
      const ctx: ProjectionOptions = { cwd, home: process.env.HOME ?? "/tmp", platform: process.platform, columns: 100, projection: "compact", now: 0, verbose: false, advisorModel: SONNET };
      const messages = await getSessionMessages(sessionId!, { cwd });
      const doc = replayDocument(messages, { width: 100 });
      const projected = projectCompact(doc, ctx);
      const texts = projected.flatMap((i) => (i.kind === "line" ? [i.line.text] : i.kind === "gutter-block" ? i.body.map((l) => l.text) : []));
      if (texts.some((t) => t.includes("Advising using "))) {
        expect(texts.some((t) => t.includes(`Advising using ${SONNET}`))).toBe(true); // D15: verbatim id
      }
    } finally {
      adapter.detach();
      observer.detach();
      await host.stop().catch(() => {});
      rmSync(cwd, { recursive: true, force: true });
      rmSync(fleetRoot, { recursive: true, force: true });
    }
  }, 120_000);
});
