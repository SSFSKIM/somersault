// tui/test/bash-permission.test.tsx — the Bash permission dialog (F6 T6), the first real body on the new
// substrate. Expectations transcribe 2.1.220's `dZf` (L505224-287): the `Ed` frame titled "Bash command",
// the command rendered plain with a dim description under it, the destructive warning in the `warning`
// role, the question line, the `$Qf` option list inside a `Select`, and an `esc cancel` footer. The key
// contract is OURS (KB1 predates F6): digits reach the embedded Select, `y`/`n`/Escape resolve through the
// dialog's `Confirmation` scope, and the legacy `a`/`A`/`d`/`D` letters arrive as unconsumed keys — but only
// while no input row has the cursor, which is what keeps them out of a half-typed feedback sentence.
import React from "react";
import { describe, it, expect } from "vitest";
import { renderWithKeymap as render, tick } from "./keysTestUtil.js";
import { BashPermission } from "../../src/tui/dialogs/BashPermission.js";
import { PermissionDialog } from "../../src/tui/PermissionDialog.js";
import { themeTokens } from "../../src/tui/theme.js";
import type { PermissionDecision, PermissionUpdateLike } from "../../src/permissions/types.js";

const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const sgr = (name: "warning" | "permission") => {
  const m = /(\d+),\s*(\d+),\s*(\d+)/.exec(themeTokens()[name]);
  return `\x1b[38;2;${m![1]};${m![2]};${m![3]}m`;
};
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) { await tick(); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
/** ONE CHARACTER PER WRITE, deliberately. A multi-character write arrives as a single TextEvent, which the
 *  provider hands straight to the fallback WITHOUT consulting the binding table (KeymapProvider `dispatch`)
 *  — so a chunked `"use pnpm"` would type cleanly even if `n` were still bound to confirm:no. Typing it the
 *  way a human does is what actually exercises the gate. */
async function type(stdin: { write: (s: string) => void }, text: string) {
  for (const ch of text) { stdin.write(ch); await tick(); }
}
const bashRule = (ruleContent: string): PermissionUpdateLike =>
  ({ type: "addRules", rules: [{ toolName: "Bash", ruleContent }], behavior: "allow", destination: "session" });

interface Req { toolName: string; input: Record<string, unknown>; description?: string; subagentType?: string; suggestions?: PermissionUpdateLike[]; decisionReason?: string }
const req = (command: string, extra: Partial<Req> = {}): Req => ({ toolName: "Bash", input: { command }, ...extra });

async function mount(r: Req, cwd = "/repo") {
  const got: PermissionDecision[] = [];
  const view = render(<BashPermission req={r} cwd={cwd} onDecision={(d) => got.push(d)} />);
  await waitFor(() => (view.lastFrame() ?? "").length > 0);
  return { ...view, got, frame: () => view.lastFrame() ?? "" };
}

describe("<BashPermission> — the body (`dZf` L505286)", () => {
  it("titles itself `Bash command` and prints the command plain, with a dim description under it", async () => {
    const v = await mount(req("npm run build", { description: "Build the bundle" }));
    const f = plain(v.frame());
    expect(f).toContain("Bash command");
    expect(f).toContain("npm run build");
    expect(f).toContain("Build the bundle");
    expect(f).toContain("Do you want to proceed?");
    expect(f).toContain("esc cancel");               // the footer, on the opening Yes row (T4)
    expect(f).not.toContain("tab amend");            // …which Tab cannot amend — only the No row can (external review)
    // The old body's reconstruction dies here: no "Allow Claude to use", no `$ ` prefix.
    expect(f).not.toContain("Allow Claude to use");
    expect(f).not.toContain("$ npm run build");
  });

  it("hangs the subagent attribution on the TITLE (DG21) instead of the old `Subagent (…) asks:` line", async () => {
    const v = await mount(req("ls", { subagentType: "code-reviewer" }));
    const f = plain(v.frame());
    expect(f).toContain("· from the code-reviewer agent");
    expect(f).not.toContain("Subagent (code-reviewer) asks:");
  });

  it("prints the destructive-table warning between the command and the question, in the `warning` role", async () => {
    const v = await mount(req("rm -rf build"));
    expect(plain(v.frame())).toContain("Note: may recursively force-remove files");
    expect(v.frame()).toContain(`${sgr("warning")}Note: may recursively force-remove files`);
    const lines = plain(v.frame()).split("\n");
    const warn = lines.findIndex((l) => l.includes("Note: may"));
    expect(warn).toBeGreaterThan(lines.findIndex((l) => l.includes("rm -rf build")));
    expect(warn).toBeLessThan(lines.findIndex((l) => l.includes("Do you want to proceed?")));
  });

  it("says nothing about a command the table does not match", async () => {
    expect(plain((await mount(req("ls -la"))).frame())).not.toContain("Note: may");
  });

  it("shows the engine's own `decisionReason` above the options (`yN`/`mDr`, safetyCheck arm)", async () => {
    const v = await mount(req("ls", { decisionReason: "Path is outside allowed working directories" }));
    expect(plain(v.frame())).toContain("Path is outside allowed working directories");
  });

  it("renders the prefix row with the curly apostrophe and its seed already typed in", async () => {
    const v = await mount(req("npm run build", { suggestions: [bashRule("npm run:*")] }));
    const f = plain(v.frame());
    expect(f).toContain("2. Yes, and don’t ask again for: npm run *");
    expect(f).toContain("3. No");
  });
});

describe("<BashPermission> — the key contract", () => {
  it("digit 1 allows once", async () => {
    const v = await mount(req("ls"));
    v.stdin.write("1");
    await waitFor(() => v.got.length === 1);
    expect(v.got[0]).toEqual({ kind: "allow_once" });
  });

  it("digit 2 submits the prefix row's seed as ONE localSettings rule", async () => {
    const v = await mount(req("npm run build", { suggestions: [bashRule("npm run:*")] }));
    v.stdin.write("2");
    await waitFor(() => v.got.length === 1);
    expect(v.got[0]).toEqual({
      kind: "allow_with_updates",
      updatedPermissions: [{ type: "addRules", rules: [{ toolName: "Bash", ruleContent: "npm run *" }], behavior: "allow", destination: "localSettings" }],
    });
  });

  it("the suggestions-summary row echoes the engine's payload verbatim", async () => {
    const suggestions: PermissionUpdateLike[] = [{ type: "addDirectories", directories: ["/repo/pkg"], destination: "session" }, bashRule("npm run:*")];
    const v = await mount(req("npm run build", { suggestions }));
    expect(plain(v.frame())).toContain("2. Yes, and allow access to pkg/ and npm run commands");
    v.stdin.write("2");
    await waitFor(() => v.got.length === 1);
    const d = v.got[0] as { kind: string; updatedPermissions: PermissionUpdateLike[] };
    expect(d.kind).toBe("allow_with_updates");
    expect(d.updatedPermissions[0]).toBe(suggestions[0]);
    expect(d.updatedPermissions[1]).toBe(suggestions[1]);
  });

  it("bare y allows, bare n denies, Escape denies (KB1, through the `Confirmation` scope)", async () => {
    const a = await mount(req("ls"));
    a.stdin.write("y"); await waitFor(() => a.got.length === 1);
    expect(a.got[0]).toEqual({ kind: "allow_once" });
    const b = await mount(req("ls"));
    b.stdin.write("n"); await waitFor(() => b.got.length === 1);
    expect(b.got[0]).toEqual({ kind: "deny" });
    const c = await mount(req("ls"));
    c.stdin.write("\x1b"); await waitFor(() => c.got.length === 1);
    expect(c.got[0]).toEqual({ kind: "deny" });
  });

  it("↓ then Enter takes the highlighted No row", async () => {
    const v = await mount(req("ls"));
    v.stdin.write("\x1b[B"); await tick();
    v.stdin.write("\r"); await waitFor(() => v.got.length === 1);
    expect(v.got[0]).toEqual({ kind: "deny" });
  });

  it("keeps the legacy a/A/d letters (they arrive as keys the list did not consume)", async () => {
    const v = await mount(req("ls"));
    v.stdin.write("a"); await waitFor(() => v.got.length === 1);
    v.stdin.write("A"); await waitFor(() => v.got.length === 2);
    v.stdin.write("d"); await waitFor(() => v.got.length === 3);
    v.stdin.write("D"); await waitFor(() => v.got.length === 4);
    expect(v.got).toEqual([{ kind: "allow_once" }, { kind: "allow_always" }, { kind: "deny" }, { kind: "deny" }]);
  });

  it("never reads a modified y/n as a decision", async () => {
    const v = await mount(req("ls"));
    for (const key of ["\x19", "\x0e", "\x1by", "\x1bn"]) { v.stdin.write(key); await new Promise((r) => setTimeout(r, 20)); }
    expect(v.got).toEqual([]);
  });
});

describe("<BashPermission> — feedback mode (Tab on No)", () => {
  it("Tab turns the focused No row into a text row, and Enter sends what was typed as deny feedback", async () => {
    const v = await mount(req("ls"));
    v.stdin.write("\x1b[B"); await tick();                       // focus No
    v.stdin.write("\t"); await tick();
    expect(plain(v.frame())).toContain("and tell Claude what to do differently");
    // Every letter here is one the dialog answers to somewhere else: `y`/`n` are the Confirmation scope's two
    // actions, `k` is select:previous, `a` is a legacy allow. On a text row all four must be letters.
    await type(v.stdin, "ask any human");
    expect(v.got).toEqual([]);
    expect(plain(v.frame())).toContain("ask any human");
    v.stdin.write("\r"); await waitFor(() => v.got.length === 1);
    expect(v.got[0]).toEqual({ kind: "deny", feedback: "ask any human" });
  });

  // Wave T t8 (qa3-06, A16). `select.test.tsx` pins the single-space frame on a row it labels by setting
  // `showLabelWithValue` itself; the real amended row is labelled by the dialog's `inlineDescriptions`
  // (`BashPermission.tsx:124`), and nothing at THIS level pinned the width — every other assertion in this
  // file passes the substring test with a doubled space in the frame, which is exactly what QA filed. The
  // block cursor is an inverse-video SPACE, so on the plain frame it IS the space after the separator.
  it("renders the empty amended No row as `No,` + cursor + placeholder — one space, never two", async () => {
    const v = await mount(req("ls"));
    v.stdin.write("\x1b[B"); await tick();                        // focus No
    v.stdin.write("\t"); await tick();                            // …and turn it into the amend field
    const f = plain(v.frame());
    expect(f).toContain("No, and tell Claude what to do differently");
    expect(f).not.toContain("No,  and tell Claude what to do differently");
    expect(v.got).toEqual([]);
  });

  // Wave T t4 review (I1). The amend hint is gated on the LIVE `inputMode` the BODY passes down: once the
  // focused row is already a text field, the hint that told you how to open one is noise (`aZf` L505186).
  // `consult-footer.test.tsx` pins the component and the mount-state assertions above pin `inputMode={false}`,
  // but nothing pinned the wiring — dropping `inputMode={inputFocused}` from all five bodies at once left the
  // whole TUI suite green. Collecting EVERY footer-shaped line also pins that there is exactly one of them.
  //
  // EXTERNAL REVIEW, the other half of `aZf`'s condition: the hint is ALSO gated on the focused row being one
  // Tab can amend, and only the No row is (the test right below this one is the proof that Tab on Yes does
  // nothing). The dialog opens on Yes, so it opens with NO amend hint — advertising one there promised a
  // channel the row cannot deliver, in the one prompt where a false affordance is least affordable.
  it("advertises `tab amend` only on the No row, and drops it again once that row IS the text field", async () => {
    const v = await mount(req("ls"));
    const footer = () => plain(v.frame()).split("\n").filter((l) => l.includes("esc cancel")).map((l) => l.trim());
    expect(footer()).toEqual(["esc cancel"]);                     // opening row is Yes: Tab does nothing there
    v.stdin.write("\x1b[B"); await tick();                        // focus No
    expect(footer()).toEqual(["esc cancel · tab amend"]);         // …the one row that answers Tab
    v.stdin.write("\t"); await tick();                            // …and turn it into a field
    expect(plain(v.frame())).toContain("and tell Claude what to do differently");
    expect(footer()).toEqual(["esc cancel"]);
    // and the hint comes back with the row: Esc leaves input mode, the plain row returns, so does the hint.
    v.stdin.write("\x1b"); await tick();
    expect(footer()).toEqual(["esc cancel · tab amend"]);
    // …and moving back UP to a row Tab ignores takes it away again.
    v.stdin.write("\x1b[A"); await tick();
    expect(footer()).toEqual(["esc cancel"]);
    expect(v.got).toEqual([]);
  });

  it("Tab does nothing on the Yes row — the allow side has no feedback channel (T3)", async () => {
    const v = await mount(req("ls"));
    v.stdin.write("\t"); await tick();
    expect(plain(v.frame())).not.toContain("and tell Claude what to do next");
    expect(plain(v.frame())).toContain("1. Yes");
  });

  it("Escape leaves input mode FIRST and cancels SECOND", async () => {
    const v = await mount(req("ls"));
    v.stdin.write("\x1b[B"); await tick();
    v.stdin.write("\t"); await tick();
    v.stdin.write("\x1b"); await tick();
    expect(v.got).toEqual([]);                                    // the first Esc only left the row
    expect(plain(v.frame())).not.toContain("and tell Claude what to do differently");
    v.stdin.write("\x1b"); await waitFor(() => v.got.length === 1);
    expect(v.got[0]).toEqual({ kind: "deny" });
  });

  // Wave T t5 (L505162-169). The row is a text field only while it is worth being one: leaving it empty and
  // moving on puts the plain `No` row back, but a row holding a half-typed sentence stays open — collapsing
  // THAT would hide what was written behind a row that says nothing about it.
  //
  // An UNFOCUSED empty input row and a collapsed plain row are the same three characters on screen (`RLe`
  // prints its placeholder only while focused), so "did it collapse" is asked by coming BACK to the row: the
  // placeholder returns on a field, and does not on a plain row.
  it("keeps a feedback row that holds text open when the cursor leaves it", async () => {
    const v = await mount(req("ls"));
    v.stdin.write("\x1b[B"); await tick();                        // focus No
    v.stdin.write("\t"); await tick();
    await type(v.stdin, "use pnpm");
    v.stdin.write("\x1b[A"); await tick();                        // up, off the row
    expect(plain(v.frame())).toContain("No, use pnpm");           // still a field, and the text is visible
    expect(v.got).toEqual([]);
  });

  it("collapses an EMPTY feedback row once the cursor leaves it", async () => {
    const v = await mount(req("ls"));
    v.stdin.write("\x1b[B"); await tick();                        // focus No
    v.stdin.write("\t"); await tick();
    expect(plain(v.frame())).toContain("and tell Claude what to do differently");
    v.stdin.write("\x1b[A"); await tick();                        // up, off an untouched field
    v.stdin.write("\x1b[B"); await tick();                        // and back onto the row
    expect(plain(v.frame())).not.toContain("and tell Claude what to do differently");
    expect(plain(v.frame())).toContain("2. No");
    expect(v.got).toEqual([]);                                    // collapsing decides NOTHING
  });

  it("collapses a feedback row the human typed into and then CLEARED", async () => {
    const v = await mount(req("ls"));
    v.stdin.write("\x1b[B"); await tick();
    v.stdin.write("\t"); await tick();
    await type(v.stdin, "no");
    v.stdin.write("\x7f"); await tick();
    v.stdin.write("\x7f"); await tick();
    expect(plain(v.frame())).toContain("and tell Claude what to do differently");   // empty again
    v.stdin.write("\x1b[A"); await tick();
    v.stdin.write("\x1b[B"); await tick();
    expect(plain(v.frame())).not.toContain("and tell Claude what to do differently");
    expect(v.got).toEqual([]);
  });

  it("holds the legacy letters back while a text row has the cursor", async () => {
    const v = await mount(req("npm run build", { suggestions: [bashRule("npm run:*")] }));
    v.stdin.write("\x1b[B"); await tick();                        // focus the prefix input row
    await type(v.stdin, "ad");
    expect(v.got).toEqual([]);
    expect(plain(v.frame())).toContain("npm run *ad");
  });
});

describe("PermissionDialog — the kind switchboard", () => {
  
  it("routes Bash to the new body", async () => {
    const view = render(<PermissionDialog req={{ toolName: "Bash", input: { command: "npm run build" } }} cwd="/repo" onDecision={() => {}} />);
    await waitFor(() => (view.lastFrame() ?? "").length > 0);
    expect(plain(view.lastFrame() ?? "")).toContain("Bash command");
  });

  // Edit was the example here until T7 gave the file family a dialog of its own; an MCP tool is what is left
  // unclaimed, and T8 gave that its own body too — `GenericPermission` (`Gal` L506118), whose frame reads
  // `Tool use`. The pre-F6 body this test used to pin no longer exists.
  it("sends everything unclaimed to the generic body, key contract intact", async () => {
    const got: PermissionDecision[] = [];
    const view = render(<PermissionDialog req={{ toolName: "mcp__notes__append", input: { note: "hi" } }} onDecision={(d) => got.push(d)} />);
    await waitFor(() => (view.lastFrame() ?? "").length > 0);
    const f = plain(view.lastFrame() ?? "");
    expect(f).toContain("Tool use");
    expect(f).not.toContain("Allow Claude to use");
    expect(f).toContain("1. Yes");
    view.stdin.write("1"); await waitFor(() => got.length === 1);
    expect(got[0]).toEqual({ kind: "allow_once" });
  });

  it("sends a Bash command that is really an in-place edit to the FILE kind, not the Bash body", async () => {
    const command = "sed -i '' 's/a/b/' f.ts";
    const view = render(<PermissionDialog req={{ toolName: "Bash", input: { command } }} cwd="/repo" onDecision={() => {}} />);
    await waitFor(() => (view.lastFrame() ?? "").length > 0);
    expect(plain(view.lastFrame() ?? "")).not.toContain("Bash command");
  });
});
