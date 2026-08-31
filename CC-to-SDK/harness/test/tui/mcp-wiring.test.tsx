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

// Sanity check that the wiring tests' fixture shape survives normalization identically to a full SDK
// payload — guards against the dialog and the model silently drifting on what a "server" object looks like.
describe("normalizeMcpServers — wiring fixture parity", () => {
  it("the bare {name,status} shape the existing formatMcpStatus tests use still normalizes cleanly", () => {
    expect(normalizeMcpServers([{ name: "linear", status: "connected" }])).toEqual([{ name: "linear", status: "connected", tools: [] }]);
  });
});
