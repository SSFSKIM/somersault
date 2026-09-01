// test/tui/mcp-wiring.test.tsx — T-MENU task 4 (spec A2/D5-bl10): `/mcp` wiring through the real
// `ChatApp`/`useChat` path. A bare `/mcp` opens the dialog; `/mcp reconnect <n>`/`/mcp toggle <n> on|off`
// keep their current text behavior. A SEPARATE file from `mcp-dialog.test.tsx` (mirroring
// status-family-dialog.test.tsx's own split from its dialog's component tests) — mcp-dialog.test.tsx's own
// ~15 direct `McpDialog` renders in one vitest worker left enough accumulated event-loop pressure that a
// ChatApp-level test's composer-mount `waitFor` started missing its 2s budget (the "useInput-timing flake"
// vitest.config.ts's `fileParallelism:false` comment already names, reproduced within a file). A fresh file
// is a fresh worker's fresh event loop.
//
// Readiness is `tick()` (harness/CLAUDE.md's own discipline: `useInput` subscribes in a passive effect, so a
// key write must be preceded by at least one tick), NOT a poll for the composer's `"❯ "` prompt glyph —
// `composerFrame.tsx`'s own `PromptGlyph` trails a NBSP (`\xA0`), never a plain space, and its rendered
// cursor cell is a TRANSIENT one-shot: it shows a plain-space-then-inverse-cell for a moment right after
// mount and then settles to the NBSP form permanently, so polling for a literal `"❯ "` (regular space) can
// race that settle and hang past any timeout. `runSlash`'s own wait for the ECHOED command text is the real
// synchronization point and does not depend on that glyph at all.
import { describe, it, expect } from "vitest";
import { renderWithKeymap as render, tick } from "./keysTestUtil.js";
import { ChatApp } from "../../src/tui/ChatApp.js";
import { fakeRemote } from "./helpers/fakeRemote.js";
import { normalizeMcpServers } from "../../src/tui/mcpDialogModel.js";
import type { PendingEntry } from "../../src/permissions/pending.js";
import type { ChatSession } from "../../src/tui/useChat.js";

const frame = (f: () => string | undefined) => f() ?? "";
const stripAnsiAll = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");
const flat = (f: () => string | undefined) => stripAnsiAll(frame(f)).replace(/\s+/g, " ");
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) { await tick(); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
async function runSlash(stdin: { write: (s: string) => void }, lastFrame: () => string | undefined, cmd: string) {
  await tick();
  stdin.write(cmd);
  await waitFor(() => frame(lastFrame).includes(cmd));
  stdin.write("\r");
}

describe("T-MENU task 4 — /mcp wiring (spec A2/D5-bl10)", () => {
  it("/mcp with no args opens the dialog instead of printing formatMcpStatus text", async () => {
    const fake = fakeRemote({ mcpServerStatus: () => [{ name: "linear", status: "connected" }] });
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await runSlash(stdin, lastFrame, "/mcp");
    await waitFor(() => flat(lastFrame).includes("Manage MCP servers"));
    const f = flat(lastFrame);
    expect(f).toContain("linear");
    expect(f).not.toContain("MCP servers\n");   // formatMcpStatus's old bold header line is gone
    expect(frame(lastFrame).match(/\/mcp/g)?.length).toBe(1);   // only the command echo, no text dump
  });

  it("/mcp reconnect <name> stays text-only (no dialog)", async () => {
    let reconnected: string | undefined;
    const fake = fakeRemote({ mcpServerStatus: () => [{ name: "linear", status: "connected" }], reconnectMcpServer: (n) => { reconnected = n; } });
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await runSlash(stdin, lastFrame, "/mcp reconnect linear");
    await waitFor(() => flat(lastFrame).includes("reconnected linear"));
    expect(reconnected).toBe("linear");
    expect(flat(lastFrame)).not.toContain("Manage MCP servers");
  });

  it("/mcp toggle <name> on|off stays text-only (no dialog)", async () => {
    let toggled: { name: string; enabled: boolean } | undefined;
    const fake = fakeRemote({ mcpServerStatus: () => [{ name: "linear", status: "connected" }], toggleMcpServer: (name, enabled) => { toggled = { name, enabled }; } });
    const { stdin, lastFrame } = render(<ChatApp makeSession={() => fake} client={{ kind: "loopback" }} cwd={process.cwd()} />);
    await runSlash(stdin, lastFrame, "/mcp toggle linear off");
    await waitFor(() => flat(lastFrame).includes("disabled"));
    expect(toggled).toEqual({ name: "linear", enabled: false });
    expect(flat(lastFrame)).not.toContain("Manage MCP servers");
  });
});

// ── bl10 fix wave 1, finding 1 ────────────────────────────────────────────────────────────────────────────
// `state.mcpDialog.open` joined `paneOwned` (ChatApp.tsx:1390, T-MENU task 4/D15) but was missing from
// `inputOwnerRef`'s overlay-arm disjunction (ChatApp.tsx:593) — the SAME class of "one term short of the
// disjunction" defect the file's own header comment already sabotage-checks `themeDialog.open` against. The
// symptom is two-fold: `seamActive` (:1693, `inputOwnerRef.current === "overlay"`) never goes true for
// `/mcp` in fullscreen, so its rows-sized root list renders in the half-height DOCK instead of the seam; and
// a permission decision arriving while `/mcp` is open reads `inputOwnerRef.current === "decision"` instead
// of `"overlay"`, so `inlineDecision` renders the PermissionDialog into the dock ALONGSIDE the browser
// instead of staying suppressed behind it — exactly `fullscreen-overlays.test.tsx`'s own "gives a permission
// dialog the dock" mechanism, just missing the one gate every other user-opened overlay already has.
const isSeamRule = (line: string): boolean => /^▔+$/.test(line.replace(/\x1b\[[0-9;]*m/g, "").trim());
const seamRuleAt = (frame: string): number => frame.split("\n").findIndex(isSeamRule);
const permissionEntry = (toolUseID = "t"): PendingEntry =>
  ({ sessionId: "s", toolUseID, toolName: "Edit", kind: "permission", input: { file_path: "f.ts" }, createdAt: Date.now() });

describe("bl10 fix wave 1, finding 1 — /mcp joins the seam-owning overlay class", () => {
  it("fullscreen: /mcp draws in the seam slot (▔ rule, transcript squeezed above), not the half-height dock", async () => {
    const fake = fakeRemote({ mcpServerStatus: () => [{ name: "linear", status: "connected" }] });
    const r = render(
      <ChatApp makeSession={() => fake as unknown as ChatSession} client={{ kind: "loopback" }} cwd="/work"
        renderer={{ mode: "fullscreen", reason: "env_on" }} deps={{ columns: () => 80, rows: () => 24 }} />,
    );
    await waitFor(() => frame(r.lastFrame).includes("❯ "));
    await tick();
    r.stdin.write("/mcp");
    await waitFor(() => frame(r.lastFrame).includes("/mcp"));
    r.stdin.write("\r");
    await waitFor(() => frame(r.lastFrame).includes("Manage MCP servers"));
    await tick();
    const f = r.lastFrame() ?? "";
    const rule = seamRuleAt(f);
    expect(rule).toBeGreaterThan(0);                                    // the seam's own ▔ rule is present…
    expect(f).not.toContain("❯ ");                                 // …the composer is gone, exactly like /model
  });

  it("/mcp open + a permission arriving mid-browse: the browser keeps input, the decision stays suppressed behind it", async () => {
    const fake = fakeRemote({ mcpServerStatus: () => [{ name: "linear", status: "connected" }] });
    const r = render(
      <ChatApp makeSession={() => fake as unknown as ChatSession} client={{ kind: "loopback" }} cwd="/work"
        renderer={{ mode: "fullscreen", reason: "env_on" }} deps={{ columns: () => 80, rows: () => 24 }} />,
    );
    await waitFor(() => frame(r.lastFrame).includes("❯ "));
    await tick();
    r.stdin.write("/mcp");
    await waitFor(() => frame(r.lastFrame).includes("/mcp"));
    r.stdin.write("\r");
    await waitFor(() => frame(r.lastFrame).includes("Manage MCP servers"));
    await tick();
    fake.parkPermission(permissionEntry());
    await tick();
    // The decision never gets its own dialog while the browser owns the seam — it stays parked, not rendered.
    expect(frame(r.lastFrame)).not.toContain("Edit file");
    expect(frame(r.lastFrame)).toContain("Manage MCP servers");
    // Closing the browser reveals the decision that was waiting behind it all along.
    r.stdin.write("\x1b");
    await waitFor(() => frame(r.lastFrame).includes("Edit file"));
    expect(frame(r.lastFrame)).not.toContain("Manage MCP servers");
  });
});

// Sanity check that the wiring tests' fixture shape survives normalization identically to a full SDK
// payload — guards against the dialog and the model silently drifting on what a "server" object looks like.
describe("normalizeMcpServers — wiring fixture parity", () => {
  it("the bare {name,status} shape the existing formatMcpStatus tests use still normalizes cleanly", () => {
    expect(normalizeMcpServers([{ name: "linear", status: "connected" }])).toEqual([{ name: "linear", status: "connected", tools: [] }]);
  });
});
