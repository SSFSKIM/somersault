// tui/test/console-permission.test.tsx
import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { App } from "../src/App.js";

const frame = (f: () => string | undefined) => f() ?? "";
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) { await new Promise((r) => setTimeout(r, 0)); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}

function fakeClient(responded: Array<[string, unknown]>): any {
  return {
    list: async () => [{ id: "sess-1", daemonPid: 1, status: "idle", model: "claude-sonnet-4-6", createdAt: 0, lastActiveAt: 0 }],
    contextUsage: async () => ({ totalTokens: 5, maxTokens: 100 }),
    pendingPermissions: async () => [{ sessionId: "sess-1", toolUseID: "tu1", toolName: "Edit", input: { file_path: "f.ts" }, createdAt: 0 }],
    respondPermission: async (id: string, dec: unknown) => { responded.push([id, dec]); },
  };
}

describe("<App> daemon permission dialog", () => {
  it("surfaces a parked permission as a dialog and 'a' answers allow_once", async () => {
    const responded: Array<[string, unknown]> = [];
    const { stdin, lastFrame } = render(<App client={fakeClient(responded)} hookOpts={{ schedule: () => () => {} }} />);
    await waitFor(() => frame(lastFrame).includes("Allow Claude to use")); // poll surfaced the parked request
    expect(lastFrame()).toContain("Edit");
    stdin.write("a");
    await waitFor(() => responded.length > 0);
    expect(responded[0]).toEqual(["tu1", { kind: "allow_once" }]);
  });
});
