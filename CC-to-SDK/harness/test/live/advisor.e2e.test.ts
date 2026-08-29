// harness/test/live/advisor.e2e.test.ts — bl7 T-ADVISOR Task 4 (spec §5 A8): keyed live proof that the
// `advisorModel` config knob (Task 1) threads to the real SDK settings AND drives Task 2/3's render arms
// end to end — through the REAL REPL submit chain (SessionHost + remoteChatSession, chatMain's own seam),
// the same topology test/live/image-submit.e2e.test.ts drives. Probe 118 proved the SDK will mount and
// fire the server-side advisor tool headlessly when settings carry `advisorModel` and the model is invited
// to consult it (P118's exact prompt shape is reused below); this cell reruns that invitation through
// ccx's OWN submit chain and then re-projects the persisted transcript to prove D15 (the client's own
// `config.advisorModel` reaches the "Advising using {model}" clause) and A5's result-row shapes, on real
// data rather than a synthetic fixture.
//
// The consult is MODEL-JUDGED (the advisor tool is offered, never forced) — one retry turn is budgeted
// (spec-mandated ceiling: 2 turns total, same session) before letting the cell fail honestly.
//
// Run: set -a; . ../.env; set +a; unset ANTHROPIC_API_KEY; npx vitest run test/live/advisor.e2e.test.ts
// Cost ~$0.39/consult (opus advisor + sonnet main) — run once, not in loops. NEVER print/echo/log the
// OAuth token or API key.
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionHost } from "../../src/host/host.js";
import { remoteChatSession } from "../../src/client/chatAdapter.js";
import { RemoteChatSession } from "../../src/client/remote.js";
import type { HostEvent } from "../../src/host/wire.js";
import { hostSocketPath } from "../../src/fleet/paths.js";
import { getSessionMessages } from "../../src/sessions/index.js";
import { replayDocument } from "../../src/tui/replay.js";
import { projectCompact, type ProjectionOptions } from "../../src/tui/toolRenderer.js";

const live = (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN) ? describe : describe.skip;

const ADVISOR_MODEL = "claude-opus-4-8";
const PROMPT = "Read decision.md and give a one-sentence recommendation. If an advisor tool is available to you, consult it first.";

type Frame = Record<string, unknown>;
const contentOf = (m: Frame): Frame[] => (((m.message as Frame | undefined)?.content as Frame[]) ?? []);
const hasAdvisor = (frames: readonly Frame[]): boolean =>
  frames.some((m) => contentOf(m).some((b) => (b.type === "server_tool_use" && b.name === "advisor") || b.type === "advisor_tool_result"));

live("bl7 T-ADVISOR Task 4 (A8) — live advisor consult through the real REPL submit chain", () => {
  it("consults the configured advisor model, threads it into the Advising clause, and renders a result row", async () => {
    // realpathSync: macOS's tmpdir() returns the symlinked /var/... form, but the SDK's session-storage
    // project-hash keys off the RESOLVED /private/var/... path (the spawned CLI's own process.cwd()) —
    // resolving once here keeps every downstream consumer (SessionHost, the Read tool's file path, and
    // getSessionMessages below) agreeing on one canonical path, rather than silently missing the session.
    const cwd = realpathSync(mkdtempSync(join(tmpdir(), "bl7advisor-live-")));
    const fleetRoot = mkdtempSync(join(tmpdir(), "bl7advisor-fleet-"));
    // P118's exact fixture shape: a short decision question with real constraints, tempting a judgement call.
    writeFileSync(join(cwd, "decision.md"),
      "Should we cache API responses in Redis or in-process memory? Constraints: 3 app servers behind a " +
      "load balancer, responses average 50KB, freshness must stay under 5 seconds, and per-instance memory " +
      "is tight.\n");
    const env = { ...process.env, CCX_FLEET_ROOT: fleetRoot } as NodeJS.ProcessEnv;
    const host = new SessionHost(
      { short: "b17adb15", name: "bl7-advisor-live", cwd, kind: "interactive", detached: false,
        config: { cwd, model: "claude-sonnet-5", advisorModel: ADVISOR_MODEL, permissionMode: "bypassPermissions", settingSources: [], maxTurns: 8 } as never,
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
      const deadline = Date.now() + 60_000; // an advisor consult is a second model call — give it real room
      while (turnEnds.length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
      const end = turnEnds.shift();
      if (!end) throw new Error("no turn-end event observed within 60s of the submit settling");
      return end;
    };

    try {
      const allFrames: Frame[] = [];
      let consulted = false;
      // Spec-mandated ceiling: the consult is model-judged, so at most 2 turns before failing honestly.
      for (let turn = 0; turn < 2 && !consulted; turn++) {
        const frames: Frame[] = [];
        await adapter.submit(PROMPT, (m) => { frames.push(m as Frame); captureId(m as Frame); });
        const end = await nextTurnEnd();
        expect(end.error).toBeUndefined();
        expect(end.failure).toBeUndefined(); // is_error:false
        allFrames.push(...frames);
        consulted = hasAdvisor(allFrames);
      }
      expect(consulted).toBe(true); // honest failure if the model never consulted across both turns
      expect(sessionId).toBeTruthy();

      // ---- re-read the persisted session and re-project it through the real render stack ----
      // `advisorModel` here is the CLIENT's own config value (D15) — exactly what a live TUI session would
      // thread into `ProjectionOptions` from `config.advisorModel` (useChat.ts's `initialAdvisorModel`).
      const ctx: ProjectionOptions = { cwd, home: process.env.HOME ?? "/tmp", platform: process.platform, columns: 100, projection: "compact", now: 0, verbose: false, advisorModel: ADVISOR_MODEL };
      // The turn-end event fires as soon as the SDK stream closes; the underlying CLI's own on-disk JSONL
      // write can lag it by a beat (an async flush, not a rendering bug — verified by re-reading the exact
      // same session a few seconds later out-of-process). Poll rather than read once.
      let texts: string[] = [];
      const readDeadline = Date.now() + 10_000;
      do {
        const messages = await getSessionMessages(sessionId!, { cwd });
        const doc = replayDocument(messages, { width: 100 });
        const projected = projectCompact(doc, ctx);
        texts = projected.flatMap((i) => (i.kind === "line" ? [i.line.text] : i.kind === "gutter-block" ? i.body.map((l) => l.text) : []));
        if (texts.some((t) => t.includes("Advising using "))) break;
        await new Promise((r) => setTimeout(r, 300));
      } while (Date.now() < readDeadline);
      expect(texts.some((t) => t.includes("Advising using "))).toBe(true); // D15: config → projection threading, end to end
      expect(texts.some((t) =>
        t.includes("Advisor has reviewed the conversation") ||
        t.includes("Advisor declined") ||
        t.includes("Advisor unavailable ("))).toBe(true);
    } finally {
      adapter.detach();
      observer.detach();
      await host.stop().catch(() => {});
      rmSync(cwd, { recursive: true, force: true });
      rmSync(fleetRoot, { recursive: true, force: true });
    }
  }, 300_000);
});
