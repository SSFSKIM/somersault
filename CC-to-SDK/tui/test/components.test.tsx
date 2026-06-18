import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { Transcript } from "../src/Transcript.js";
import { PermissionDialog } from "../src/PermissionDialog.js";
import { ChatStatusBar } from "../src/ChatStatusBar.js";
import type { PermissionDecision } from "cc-harness";

const frame = (f: () => string | undefined) => f() ?? "";
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) return; if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
const req = { toolName: "Edit", input: { file_path: "f.ts" }, toolUseID: "t", signal: new AbortController().signal };

describe("<Transcript>", () => {
  it("renders committed and streaming lines", () => {
    const { lastFrame } = render(<Transcript lines={[{ text: "committed" }]} streaming={[{ text: "live" }]} />);
    expect(lastFrame()).toContain("committed");
    expect(lastFrame()).toContain("live");
  });
});
describe("<PermissionDialog>", () => {
  it("reconstructs the prompt from toolName+input (no SDK title)", () => {
    const { lastFrame } = render(<PermissionDialog req={req} onDecision={() => {}} />);
    expect(lastFrame()).toContain("Edit");
    expect(lastFrame()).toContain("[a] allow once");
  });
  it("maps a/A/d to allow_once/allow_always/deny", async () => {
    const got: PermissionDecision[] = [];
    const { stdin } = render(<PermissionDialog req={req} onDecision={(d) => got.push(d)} />);
    await new Promise((r) => setTimeout(r, 20)); // let useInput subscribe (passive effect) before non-idempotent keys
    stdin.write("a"); await waitFor(() => got.length === 1);
    stdin.write("A"); await waitFor(() => got.length === 2);
    stdin.write("d"); await waitFor(() => got.length === 3);
    expect(got).toEqual([{ kind: "allow_once" }, { kind: "allow_always" }, { kind: "deny" }]);
  });
});
describe("<ChatStatusBar>", () => {
  it("shows the mode and ctx%", () => {
    const { lastFrame } = render(<ChatStatusBar mode="default" busy={false} ctxPct={42} hasPending={false} />);
    expect(lastFrame()).toContain("default");
    expect(lastFrame()).toContain("42%");
  });
});
