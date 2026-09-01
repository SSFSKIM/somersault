// test/tui/status-family-dialog.test.tsx — T-MENU task 3 (spec A1, D13): `/status`, `/usage`, `/cost` and
// `/stats` now OPEN the Settings dialog on their tab instead of printing a text dump. These are the
// information-EQUIVALENCE tests spec D13 requires: for each retired text arm, render the dialog tab it now
// opens and assert every information element the text formatter used to emit is still present.
//
// Full `ChatApp` renders throughout (not a bare `useChat` mount) — the point is to prove the real, wired-up
// dialog shows the content a real user would see, the same instrument chat.test.tsx's own `/config` test uses.
import { describe, it, expect } from "vitest";
import { renderWithKeymap as render } from "./keysTestUtil.js";
import { ChatApp } from "../../src/tui/ChatApp.js";
import { fakeRemote } from "./helpers/fakeRemote.js";

const frame = (f: () => string | undefined) => f() ?? "";
const stripAnsiAll = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");
const flat = (f: () => string | undefined) => stripAnsiAll(frame(f)).replace(/\s+/g, " ");
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) { await new Promise((r) => setTimeout(r, 0)); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
/** Types a slash command into the composer and submits it — the real user path, not `useChat.submit`. */
async function runSlash(stdin: { write: (s: string) => void }, lastFrame: () => string | undefined, cmd: string) {
  stdin.write(cmd);
  await waitFor(() => frame(lastFrame).includes(cmd));
  stdin.write("\r");
}

// A usage payload carrying BOTH halves formatUsage/formatCost read: a rate-limit window (for the plan-usage
// bar) and session cost/duration/code-change/per-model detail (for the cost breakdown).
const USAGE_PAYLOAD = {
  rate_limits_available: true,
  rate_limits: { five_hour: { utilization: 43, resets_at: "2026-08-31T18:00:00Z" } },
  session: {
    total_cost_usd: 0.0456, total_api_duration_ms: 12_340, total_duration_ms: 65_000,
    total_lines_added: 12, total_lines_removed: 3,
    model_usage: { "claude-opus-5": { inputTokens: 1000, outputTokens: 200, cacheReadInputTokens: 50, cacheCreationInputTokens: 10, webSearchRequests: 0, costUSD: 0.0456, canonicalModel: "claude-opus-5" } },
  },
  subscription_type: null,
};

describe("T-MENU task 3 — /status opens the Settings dialog on Status (D13 equivalence)", () => {
  it("shows every field formatStatus emits: model, mode, thinking, context (freshly measured), cwd, session, usage", async () => {
    const fake = fakeRemote({
      sessionId: "abc12345-session",
      getContextUsage: async () => ({ totalTokens: 30, maxTokens: 100 }),
      usage: () => USAGE_PAYLOAD,
    });
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd="/proj" />);
    await waitFor(() => frame(lastFrame).includes("❯ "));
    await runSlash(stdin, lastFrame, "/status");
    await waitFor(() => frame(lastFrame).includes("Status"));
    const f = flat(lastFrame);
    // The dialog shell itself — the tab strip and the "Status" body header formatStatus prints.
    expect(f).toContain("Settings");
    expect(f).toContain("Status");
    // Every field formatStatus (commands.ts) can emit, all present in this scenario:
    expect(f).toContain("model (default)");
    expect(f).toContain("mode default");
    expect(f).toContain("thinking default");
    expect(f).toContain("context 30% used");           // D13's named gap: a FRESH measurement, not a stale one
    expect(f).toContain("cwd /proj");
    expect(f).toContain("session abc12345");            // sessionId sliced to 8
    expect(f).toContain("5h 43%");                      // usageSummaryLine's compact row
    // No text dump was left behind in the transcript (spec A1) — the command echo is the only "/status" line.
    expect(frame(lastFrame).match(/\/status/g)?.length).toBe(1);
  });

  it("re-measures context on EVERY open — a second /status after the context changed shows the NEW number", async () => {
    let tokens = 10;
    const fake = fakeRemote({ getContextUsage: async () => ({ totalTokens: tokens, maxTokens: 100 }), usage: () => USAGE_PAYLOAD });
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("❯ "));
    await runSlash(stdin, lastFrame, "/status");
    await waitFor(() => flat(lastFrame).includes("context 10% used"));
    tokens = 55;
    stdin.write("\x1b");                                // close the dialog — a real user's route to re-issue the command
    // bl10 fix wave 8, W8-3: the Esc-close notice for a status-family route is now "Settings dialog
    // dismissed" (not "Config"), so a bare `!includes("Settings")` check would never pass — the notice
    // itself reintroduces the word. The tab strip is the thing that actually disappears when the dialog
    // closes; check for that instead.
    await waitFor(() => !flat(lastFrame).includes("Status Config Usage Stats"));
    await runSlash(stdin, lastFrame, "/status");
    await waitFor(() => flat(lastFrame).includes("context 55% used"));
    expect(flat(lastFrame)).not.toContain("context 10% used");
  });

  it("re-measures context on an ARROW-KEY entry into Status from Config — no /status command arm involved (D13)", async () => {
    // Review gap (task-3-report.md, Important 1): `fetchSettingsStatus`'s OWN re-measurement is what this
    // test exercises. Every other test in this file drives Status through the typed `/status` arm, whose own
    // `refreshCtx()` (useChat.ts:2280) freshens `ctxPct` before the dialog even mounts — masking whether the
    // dialog-side re-measure (useChat.ts:3099) does anything at all. Here Status is entered ONLY by
    // tab-arrowing in from Config, so the command arm's `refreshCtx()` never runs and the dialog-side one is
    // the sole thing standing between a stale `ctxPct` and the tab.
    let tokens = 10;
    const fake = fakeRemote({ getContextUsage: async () => ({ totalTokens: tokens, maxTokens: 100 }), usage: () => USAGE_PAYLOAD });
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("❯ "));
    // Seed a STALE `ctxPct` (10%) via one /status round trip, then close — this is the reading the arrow-key
    // path below must NOT fall back on.
    await runSlash(stdin, lastFrame, "/status");
    await waitFor(() => flat(lastFrame).includes("context 10% used"));
    stdin.write("\x1b");
    // bl10 fix wave 8, W8-3: the Esc-close notice for a status-family route is now "Settings dialog
    // dismissed" (not "Config"), so a bare `!includes("Settings")` check would never pass — the notice
    // itself reintroduces the word. The tab strip is the thing that actually disappears when the dialog
    // closes; check for that instead.
    await waitFor(() => !flat(lastFrame).includes("Status Config Usage Stats"));
    // Context changes AFTER the stale reading, with no further /status call anywhere below.
    tokens = 55;
    await runSlash(stdin, lastFrame, "/config");
    await waitFor(() => flat(lastFrame).includes("Default permission mode"));   // confirms Config tab, not Status
    stdin.write("\x1b[D");                                                    // Tabs: Config -> Status (tabs:previous), NOT the /status arm
    await waitFor(() => flat(lastFrame).includes("context 55% used") || flat(lastFrame).includes("context 10% used"));
    const f = flat(lastFrame);
    expect(f, "arrow-key entry into Status must re-measure fresh, not reuse the stale ctxPct from the earlier /status").toContain("context 55% used");
    expect(f).not.toContain("context 10% used");
  });
});

describe("T-MENU task 3 — /usage and /cost both open the Settings dialog on Usage (D13 equivalence)", () => {
  it("/usage shows the plan-usage bar AND /cost's cost/duration/code-change/per-model detail", async () => {
    const fake = fakeRemote({ usage: () => USAGE_PAYLOAD });
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("❯ "));
    await runSlash(stdin, lastFrame, "/usage");
    await waitFor(() => frame(lastFrame).includes("Usage"));
    const f = flat(lastFrame);
    // formatUsage's own field — the plan-usage bar.
    expect(f).toContain("5h");
    expect(f).toContain("43%");
    // Nit (task-3-report.md, finding 4): formatUsage's own reset-time field, never asserted before.
    expect(f).toContain("resets 18:00Z");
    // D13: /cost's fields, additive in the SAME tab — none may be dropped just because /usage's own pane
    // (formatUsage) never carried them.
    expect(f).toContain("Total cost:");
    expect(f).toContain("$0.0456");
    expect(f).toContain("Total duration (API):");
    expect(f).toContain("Total duration (wall):");
    expect(f).toContain("Total code changes:");
    expect(f).toContain("12 lines added, 3 lines removed");
    expect(f).toContain("Usage by model:");
    expect(f).toContain("claude-opus-5");
    // Review gap (task-3-report.md, Important 2): the checklist marked the per-model input/output/
    // cache-read/cache-write/cost figures as verified, but the test only ever checked the model name — a
    // mutation dropping all of those numbers passed. Pin the actual numbers `formatCost` emits for
    // USAGE_PAYLOAD's fixture model (1000 input, 200 output, 50 cache read, 10 cache write, $0.0456 cost;
    // formatCompactNumber renders >=1000 with one decimal, so 1000 input reads "1.0k").
    expect(f).toContain("1.0k input, 200 output, 50 cache read, 10 cache write ($0.0456)");
  });

  it("/cost opens the SAME tab with the SAME merged content — not a separate text dump", async () => {
    const fake = fakeRemote({ usage: () => USAGE_PAYLOAD });
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("❯ "));
    await runSlash(stdin, lastFrame, "/cost");
    await waitFor(() => frame(lastFrame).includes("Usage"));
    const f = flat(lastFrame);
    expect(f).toContain("Total cost:");
    expect(f).toContain("$0.0456");
    expect(f).toContain("5h");                          // /usage's own bar is present too — one merged tab
    expect(f).toContain("43%");
    // No text dump left in the transcript — the command echo is the only "/cost" occurrence.
    expect(frame(lastFrame).match(/\/cost/g)?.length).toBe(1);
  });
});

describe("T-MENU task 3 — /stats opens the Settings dialog on Stats (D13 equivalence)", () => {
  const msgs = [
    { type: "user", uuid: "u1", message: { content: [{ type: "text", text: "fix it" }] } },
    { type: "assistant", parent_tool_use_id: null, message: { content: [
      { type: "text", text: "ok" },
      { type: "tool_use", id: "t1", name: "Read", input: { file_path: "/a.ts" } },
    ] } },
  ];

  it("shows prompt/reply/tool-call counts, tokens, cost and per-model detail (formatStats' full field set)", async () => {
    const fake = fakeRemote({ sessionId: "s1", usage: () => USAGE_PAYLOAD });
    const { stdin, lastFrame } = render(
      <ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()}
        deps={{ getSessionMessages: async () => msgs }} />,
    );
    await waitFor(() => frame(lastFrame).includes("❯ "));
    await runSlash(stdin, lastFrame, "/stats");
    await waitFor(() => frame(lastFrame).includes("Stats"));
    const f = flat(lastFrame);
    expect(f).toContain("Session stats");
    expect(f).toContain("prompts");
    expect(f).toContain("replies");
    expect(f).toContain("tool calls");
    expect(f).toContain("tokens");
    expect(f).toContain("cost");
    expect(f).toContain("claude-opus-5");
    // No in-flight turn here — the disclaimer must be ABSENT.
    expect(f).not.toContain("in-flight turn");
  });

  it("carries /stats' in-flight staleness disclaimer INTO the tab when a turn is streaming (D13)", async () => {
    const fake = fakeRemote({ sessionId: "s1", usage: () => USAGE_PAYLOAD });
    const { stdin, lastFrame } = render(
      <ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()}
        deps={{ getSessionMessages: async () => msgs }} />,
    );
    await waitFor(() => frame(lastFrame).includes("❯ "));
    fake.pushEvent({ kind: "turn", phase: "start" } as any);
    await waitFor(() => frame(lastFrame).includes("BUSY") || true);   // let the event land
    await runSlash(stdin, lastFrame, "/stats");
    await waitFor(() => flat(lastFrame).includes("Session stats"));
    expect(flat(lastFrame)).toContain("the in-flight turn isn't included");
  });
});

describe("T-MENU task 3 — /config and /settings are UNCHANGED (Config tab, regression sentinel)", () => {
  it("/config still opens on the Config tab, not Status/Usage/Stats", async () => {
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fakeRemote()} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await waitFor(() => frame(lastFrame).includes("❯ "));
    await runSlash(stdin, lastFrame, "/config");
    await waitFor(() => frame(lastFrame).includes("Settings"));
    expect(flat(lastFrame)).toContain("Default permission mode");   // a Config-tab-only row
  });
});
