// tui/test/small-permissions.test.tsx — the four dialogs that complete the F6 kind registry (T8): WebFetch
// (`ull` L506735), Skill (`oll` L506582), Monitor (`Ral` L506006) and the generic fallback (`Gal` L506118).
// Frames transcribe upstream; the key contract is OURS (KB1 predates F6) and is the same in all four —
// digits to the embedded Select, `y`/`n`/Escape through the dialog's `Confirmation` scope, the legacy
// `a`/`A`/`d`/`D` letters as keys the list did not consume. The pure half is small-dialog-options.test.ts.
import React from "react";
import { describe, it, expect } from "vitest";
import { renderWithKeymap as render, tick } from "./keysTestUtil.js";
import { FetchPermission } from "../../src/tui/dialogs/FetchPermission.js";
import { SkillPermission } from "../../src/tui/dialogs/SkillPermission.js";
import { MonitorPermission } from "../../src/tui/dialogs/MonitorPermission.js";
import { GenericPermission } from "../../src/tui/dialogs/GenericPermission.js";
import { PermissionDialog } from "../../src/tui/PermissionDialog.js";
import type { PermissionDecision, PermissionUpdateLike } from "../../src/permissions/types.js";

const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) { await tick(); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
/** ONE CHARACTER PER WRITE (bash-permission.test.tsx's reasoning): a chunked write bypasses the binding
 *  table entirely, so it would type cleanly even if `n` were still bound to confirm:no. */
async function type(stdin: { write: (s: string) => void }, text: string) {
  for (const ch of text) { stdin.write(ch); await tick(); }
}

interface Req { toolName: string; input: Record<string, unknown>; description?: string; subagentType?: string; suggestions?: PermissionUpdateLike[]; decisionReason?: string }
async function mount(node: React.ReactElement, got: PermissionDecision[]) {
  const view = render(node);
  await waitFor(() => (view.lastFrame() ?? "").length > 0);
  return { ...view, got, frame: () => plain(view.lastFrame() ?? "") };
}
const mountFetch = async (req: Req) => { const got: PermissionDecision[] = []; return mount(<FetchPermission req={req} onDecision={(d) => got.push(d)} />, got); };
const mountSkill = async (req: Req, cwd = "/repo") => { const got: PermissionDecision[] = []; return mount(<SkillPermission req={req} cwd={cwd} onDecision={(d) => got.push(d)} />, got); };
const mountMonitor = async (req: Req) => { const got: PermissionDecision[] = []; return mount(<MonitorPermission req={req} onDecision={(d) => got.push(d)} />, got); };
const mountGeneric = async (req: Req, cwd = "/repo") => { const got: PermissionDecision[] = []; return mount(<GenericPermission req={req} cwd={cwd} onDecision={(d) => got.push(d)} />, got); };

const fetchReq = (url: string, extra: Partial<Req> = {}): Req => ({ toolName: "WebFetch", input: { url, prompt: "summarise" }, ...extra });
const skillReq = (skill: string, extra: Partial<Req> = {}): Req => ({ toolName: "Skill", input: { skill }, ...extra });
const monitorReq = (input: Record<string, unknown>, extra: Partial<Req> = {}): Req => ({ toolName: "Monitor", input, ...extra });
const mcpReq = (extra: Partial<Req> = {}): Req => ({ toolName: "mcp__notes__append", input: { note: "f.ts" }, ...extra });

describe("<FetchPermission> (`ull` L506735-816)", () => {
  it("titles itself `Fetch`, prints the URL with a dim description, and asks the fetch question", async () => {
    const v = await mountFetch(fetchReq("https://example.com/docs", { description: "Read the docs page" }));
    const f = v.frame();
    expect(f).toContain("Fetch");
    expect(f).toContain("https://example.com/docs");
    expect(f).toContain("Read the docs page");
    expect(f).toContain("Do you want to allow Claude to fetch this content?");
    expect(f).not.toContain("Do you want to proceed?");
    // Five bodies get a footer, not six (T4): upstream builds `ull` on a bare `jr` with no feedbackConfig,
    // so there is no amend to advertise and the escape hint lives in the No row instead.
    expect(f).not.toContain("esc cancel");
  });

  // T8 review: the printed line and the domain row are two readings of ONE field, so they cannot disagree.
  // A `{prompt, url}` payload used to print the prompt above a row naming the host.
  it("prints the URL even when `prompt` is the first key in the input", async () => {
    const got: PermissionDecision[] = [];
    const v = await mount(<FetchPermission req={{ toolName: "WebFetch", input: { prompt: "summarise this page", url: "https://example.com/a" } }} onDecision={(d) => got.push(d)} />, got);
    expect(v.frame()).toContain("https://example.com/a");
    expect(v.frame()).not.toContain("summarise this page");
    expect(v.frame()).toContain("2. Yes, and don't ask again for example.com");
  });

  it("offers the domain row and, on digit 2, writes ONE `domain:` rule to localSettings", async () => {
    const v = await mountFetch(fetchReq("https://example.com/docs"));
    expect(v.frame()).toContain("2. Yes, and don't ask again for example.com");
    v.stdin.write("2"); await waitFor(() => v.got.length === 1);
    expect(v.got[0]).toEqual({
      kind: "allow_with_updates",
      updatedPermissions: [{ type: "addRules", rules: [{ toolName: "WebFetch", ruleContent: "domain:example.com" }], behavior: "allow", destination: "localSettings" }],
    });
  });

  it("drops the domain row when the URL will not parse, leaving Yes/No", async () => {
    const v = await mountFetch(fetchReq("not a url"));
    expect(v.frame()).toContain("2. No, and tell Claude what to do differently (esc)");
    expect(v.frame()).not.toContain("don't ask again");
  });

  it("its No is a PLAIN label, so Tab on it never opens a feedback field (this dialog alone)", async () => {
    const v = await mountFetch(fetchReq("https://example.com"));
    v.stdin.write("\x1b[B"); await tick();
    v.stdin.write("\x1b[B"); await tick();                        // focus the No row
    const before = v.frame();
    v.stdin.write("\t"); await tick();
    expect(v.frame()).toBe(before);                               // Tab changed NOTHING — there is no mode to enter
    expect(v.frame()).toContain("3. No, and tell Claude what to do differently (esc)");
    v.stdin.write("\r"); await waitFor(() => v.got.length === 1);
    expect(v.got[0]).toEqual({ kind: "deny" });                   // never a `feedback` field
  });

  it("Escape denies, and the legacy letters still answer", async () => {
    const a = await mountFetch(fetchReq("https://example.com"));
    a.stdin.write("\x1b"); await waitFor(() => a.got.length === 1);
    expect(a.got[0]).toEqual({ kind: "deny" });
    const b = await mountFetch(fetchReq("https://example.com"));
    b.stdin.write("A"); await waitFor(() => b.got.length === 1);
    expect(b.got[0]).toEqual({ kind: "allow_always" });
  });
});

describe("<SkillPermission> (`oll` L506582-710)", () => {
  it("titles itself with the skill name and prints the standing caution line", async () => {
    const v = await mountSkill(skillReq("brainstorming", { description: "Start creative work" }));
    const f = v.frame();
    expect(f).toContain('Use skill "brainstorming"?');
    expect(f).toContain("Claude may use instructions, code, or files from this Skill.");
    expect(f).toContain("Start creative work");
    expect(f).toContain("Do you want to proceed?");
    expect(f).toContain("esc cancel · tab amend");   // the footer advertises the amend row (T4)
  });

  it("a two-word skill gets BOTH don't-ask-again rows — they are independent gates, not alternatives", async () => {
    const v = await mountSkill(skillReq("git commit"));
    const f = v.frame();
    expect(f).toContain("2. Yes, and don't ask again for git commit in /repo");
    expect(f).toContain("3. Yes, and don't ask again for git:* commands in /repo");
    expect(f).toContain("4. No");
    v.stdin.write("3"); await waitFor(() => v.got.length === 1);
    expect(v.got[0]).toEqual({
      kind: "allow_with_updates",
      updatedPermissions: [{ type: "addRules", rules: [{ toolName: "Skill", ruleContent: "git:*" }], behavior: "allow", destination: "localSettings" }],
    });
  });

  it("Tab on the focused No row types deny feedback (the shared feedback-mode rule)", async () => {
    const v = await mountSkill(skillReq("brainstorming"));
    v.stdin.write("\x1b[B"); await tick();
    v.stdin.write("\x1b[B"); await tick();                        // Yes · exact · No
    v.stdin.write("\t"); await tick();
    await type(v.stdin, "not that one");
    expect(v.got).toEqual([]);                                    // `n`, `a`, `o` are letters on a text row
    v.stdin.write("\r"); await waitFor(() => v.got.length === 1);
    expect(v.got[0]).toEqual({ kind: "deny", feedback: "not that one" });
  });

  it("bare y allows and bare n denies while a pick-one row has the cursor", async () => {
    const a = await mountSkill(skillReq("brainstorming"));
    a.stdin.write("y"); await waitFor(() => a.got.length === 1);
    expect(a.got[0]).toEqual({ kind: "allow_once" });
    const b = await mountSkill(skillReq("brainstorming"));
    b.stdin.write("n"); await waitFor(() => b.got.length === 1);
    expect(b.got[0]).toEqual({ kind: "deny" });
  });
});

describe("<MonitorPermission> (`Ral` L506006-093)", () => {
  it("titles itself `Monitor` and renders the MCP poll arm with the interval in seconds", async () => {
    const v = await mountMonitor(monitorReq({ mcp: { server: "github", tool: "notifications" }, interval_ms: 15000, description: "Watch for review requests" }));
    const f = v.frame();
    expect(f).toContain("Monitor");
    expect(f).toContain("Poll github/notifications every 15s");
    expect(f).toContain("Watch for review requests");
    expect(f).toContain("esc cancel · tab amend");   // the footer advertises the amend row (T4)
  });

  it("renders the WebSocket arm with its normalised URL and the subprotocol list", async () => {
    const v = await mountMonitor(monitorReq({ ws: { url: "wss://example.com", protocols: ["v1", "v2"] } }));
    expect(v.frame()).toContain("Open WebSocket wss://example.com/");
    expect(v.frame()).toContain('subprotocols: "v1", "v2"');
  });

  // T8 review: `hid` derives `monitorDescription` from `input.description` alone (L228324), and `Ral` prints
  // that and nothing else (L506064). The consult's own `description` field — which the other three bodies do
  // print — is a different sentence and never appears here.
  it("prints `input.description` and NOT the consult's own description field", async () => {
    const shown = await mountMonitor(monitorReq({ command: "tail -f log", description: "watch the app log" }));
    expect(shown.frame()).toContain("watch the app log");
    const outer = await mountMonitor(monitorReq({ command: "tail -f log" }, { description: "Run a monitor" }));
    expect(outer.frame()).not.toContain("Run a monitor");
  });

  it("falls back to the raw command when the input names neither", async () => {
    const v = await mountMonitor(monitorReq({ command: "tail -f /var/log/app.log" }));
    expect(v.frame()).toContain("tail -f /var/log/app.log");
    expect(v.frame()).not.toContain("Poll");
  });

  it("has NO don't-ask-again row without suggestions, and echoes them object-for-object with one", async () => {
    const bare = await mountMonitor(monitorReq({ command: "tail -f log" }));
    expect(bare.frame()).toContain("2. No");
    expect(bare.frame()).not.toContain("don't ask again");

    const suggestions: PermissionUpdateLike[] = [{ type: "addRules", rules: [{ toolName: "Monitor", ruleContent: "github/notifications" }], behavior: "allow", destination: "session" }];
    const v = await mountMonitor(monitorReq({ mcp: { server: "github", tool: "notifications" } }, { suggestions }));
    expect(v.frame()).toContain("2. Yes, and don't ask again for Monitor(github/notifications)");
    v.stdin.write("2"); await waitFor(() => v.got.length === 1);
    const d = v.got[0] as { kind: string; updatedPermissions: PermissionUpdateLike[] };
    expect(d.kind).toBe("allow_with_updates");
    expect(d.updatedPermissions[0]).toBe(suggestions[0]);          // reference-equal: never reconstructed
  });
});

describe("<GenericPermission> (`Gal` L506118-260)", () => {
  it("titles itself `Tool use` and renders `name(argument)` with a dim ` (MCP)` marker", async () => {
    const v = await mountGeneric(mcpReq());
    const f = v.frame();
    expect(f).toContain("Tool use");
    expect(f).toContain("mcp__notes__append(f.ts) (MCP)");
    expect(f).toContain("Do you want to proceed?");
    expect(f).toContain("esc cancel · tab amend");   // the footer advertises the amend row (T4)
    // the pre-F6 reconstruction is gone with the old body
    expect(f).not.toContain("Allow Claude to use");
  });

  it("leaves the MCP marker off a native tool", async () => {
    const v = await mountGeneric({ toolName: "WebSearch", input: { query: "ratatui" } });
    expect(v.frame()).toContain("WebSearch(ratatui)");
    expect(v.frame()).not.toContain("(MCP)");
  });

  it("clips the description at three lines (`Ktt`)", async () => {
    const v = await mountGeneric(mcpReq({ description: "one\ntwo\nthree\nfour" }));
    expect(v.frame()).toContain("three…");
    expect(v.frame()).not.toContain("four");
  });

  it("its don't-ask-again row is a WHOLE-TOOL rule with no ruleContent", async () => {
    const v = await mountGeneric(mcpReq());
    expect(v.frame()).toContain("2. Yes, and don't ask again for mcp__notes__append commands in /repo");
    v.stdin.write("2"); await waitFor(() => v.got.length === 1);
    expect(v.got[0]).toEqual({
      kind: "allow_with_updates",
      updatedPermissions: [{ type: "addRules", rules: [{ toolName: "mcp__notes__append" }], behavior: "allow", destination: "localSettings" }],
    });
  });

  it("hangs the subagent attribution on the TITLE (DG21), not on a line above the box", async () => {
    const v = await mountGeneric(mcpReq({ subagentType: "code-reviewer" }));
    expect(v.frame()).toContain("· from the code-reviewer agent");
    expect(v.frame()).not.toContain("Subagent (code-reviewer) asks:");
  });

  it("prints the engine's own decisionReason above the options", async () => {
    const v = await mountGeneric(mcpReq({ decisionReason: "Tool is not on the allowlist" }));
    expect(v.frame()).toContain("Tool is not on the allowlist");
  });

  it("keeps the whole KB1 key contract: digits, y/n, ↓↓Enter, Escape and the legacy letters", async () => {
    const one = await mountGeneric(mcpReq());
    one.stdin.write("1"); await waitFor(() => one.got.length === 1);
    expect(one.got[0]).toEqual({ kind: "allow_once" });

    const yn = await mountGeneric(mcpReq());
    yn.stdin.write("y"); await waitFor(() => yn.got.length === 1);
    yn.stdin.write("n"); await waitFor(() => yn.got.length === 2);
    expect(yn.got).toEqual([{ kind: "allow_once" }, { kind: "deny" }]);

    const nav = await mountGeneric(mcpReq());
    nav.stdin.write("\x1b[B"); await tick();
    nav.stdin.write("\x1b[B"); await tick();
    nav.stdin.write("\r"); await waitFor(() => nav.got.length === 1);
    expect(nav.got[0]).toEqual({ kind: "deny" });

    const esc = await mountGeneric(mcpReq());
    esc.stdin.write("\x1b"); await waitFor(() => esc.got.length === 1);
    expect(esc.got[0]).toEqual({ kind: "deny" });

    const legacy = await mountGeneric(mcpReq());
    legacy.stdin.write("a"); await waitFor(() => legacy.got.length === 1);
    legacy.stdin.write("A"); await waitFor(() => legacy.got.length === 2);
    legacy.stdin.write("d"); await waitFor(() => legacy.got.length === 3);
    legacy.stdin.write("D"); await waitFor(() => legacy.got.length === 4);
    expect(legacy.got).toEqual([{ kind: "allow_once" }, { kind: "allow_always" }, { kind: "deny" }, { kind: "deny" }]);
  });

  // Wave T t3, from QA repro qa3-04: Tab reads as "open me a text box", so the Enter that follows an EMPTY
  // box must not be an answer. It used to be — the row carried `allowEmptySubmitToCancel`, which carries the
  // empty submit through to `onChange` and denied the tool with no message and no visible cause. Without the
  // flag the empty Enter is `Select`'s cancel, and this body already spends its cancel on `escapeFeedbackMode`.
  it("an EMPTY Enter on the No feedback row decides NOTHING — it just closes the field (qa3-04)", async () => {
    const v = await mountGeneric(mcpReq());
    v.stdin.write("\x1b[B"); await tick();
    v.stdin.write("\x1b[B"); await tick();                        // focus No
    v.stdin.write("\t"); await tick();                            // …and open its field
    expect(v.frame()).toContain("and tell Claude what to do differently");
    v.stdin.write("\r"); await tick();
    expect(v.got).toEqual([]);                                    // NOT the bare deny it used to be
    expect(v.frame()).toContain("Do you want to proceed?");       // and the dialog is still up
    expect(v.frame()).toContain("3. No");                         // the row went back to a plain one
    // The field still works — the no-op is about EMPTY, not about the row.
    v.stdin.write("\t"); await tick();
    await type(v.stdin, "use the other tool");
    v.stdin.write("\r"); await waitFor(() => v.got.length === 1);
    expect(v.got[0]).toEqual({ kind: "deny", feedback: "use the other tool" });
  });

  // `Select.tsx`'s digit path reads the same flag, so t3's defect had a second door: a digit aimed at an empty
  // text row used to submit it. REACHING that door from a dialog is no longer possible — wave T t5 collapses
  // an empty feedback row the moment the cursor steps off it (L505162-169), which is the only way a dialog's
  // digits come back to life — so what a dialog can pin now is the collapse itself, and the primitive's own
  // behaviour stays pinned in select.test.tsx ("a digit landing on an input row focuses it when empty").
  it("collapses the untouched feedback row when the cursor leaves it, so its digit decides plainly (t5)", async () => {
    const v = await mountGeneric(mcpReq());
    v.stdin.write("\x1b[B"); await tick();
    v.stdin.write("\x1b[B"); await tick();
    v.stdin.write("\t"); await tick();                            // row 3 is now a text row…
    v.stdin.write("\x1b[A"); await tick();                        // …and the cursor steps off it while EMPTY
    v.stdin.write("\x1b[B"); await tick();                        // coming back proves which row it is now:
    expect(v.frame()).not.toContain("and tell Claude what to do differently");   // …a plain one
    expect(v.got).toEqual([]);                                    // collapsing decided nothing
    v.stdin.write("\x1b[A"); await tick();
    v.stdin.write("3"); await waitFor(() => v.got.length === 1);
    expect(v.got[0]).toEqual({ kind: "deny" });
  });

  // The other half of the rule: a row the human typed into is NOT collapsed by walking away from it — the
  // text would vanish behind a label that says nothing about it.
  it("leaves a feedback row that holds text open when the cursor moves away (t5)", async () => {
    const v = await mountGeneric(mcpReq());
    v.stdin.write("\x1b[B"); await tick();
    v.stdin.write("\x1b[B"); await tick();
    v.stdin.write("\t"); await tick();
    await type(v.stdin, "somewhere else");
    v.stdin.write("\x1b[A"); await tick();
    expect(v.frame()).toContain("No, somewhere else");             // still a field, text visible
    v.stdin.write("\x1b[B"); await tick();                         // back onto it, and it is still typable
    await type(v.stdin, "!");
    v.stdin.write("\r"); await waitFor(() => v.got.length === 1);
    expect(v.got[0]).toEqual({ kind: "deny", feedback: "somewhere else!" });
  });

  it("never reads a modified y/n as a decision", async () => {
    const v = await mountGeneric(mcpReq());
    for (const key of ["\x19", "\x0e", "\x1by", "\x1bn"]) { v.stdin.write(key); await new Promise((r) => setTimeout(r, 20)); }
    expect(v.got).toEqual([]);
  });
});

describe("PermissionDialog — the registry is complete", () => {
  const via = async (req: Req) => {
    const got: PermissionDecision[] = [];
    const view = render(<PermissionDialog req={req} cwd="/repo" onDecision={(d) => got.push(d)} />);
    await waitFor(() => (view.lastFrame() ?? "").length > 0);
    return { ...view, got, frame: () => plain(view.lastFrame() ?? "") };
  };

  it("routes WebFetch · Skill · Monitor to their own bodies", async () => {
    expect((await via(fetchReq("https://example.com"))).frame()).toContain("Fetch");
    expect((await via(skillReq("brainstorming"))).frame()).toContain('Use skill "brainstorming"?');
    expect((await via(monitorReq({ command: "tail -f log" }))).frame()).toContain("Monitor");
  });

  it("sends everything unclaimed — an MCP tool, an Edit with no derivable path — to the generic body", async () => {
    expect((await via(mcpReq())).frame()).toContain("Tool use");
    expect((await via({ toolName: "Edit", input: {} })).frame()).toContain("Tool use");
  });

  it("no route reaches the pre-F6 body any more: it is gone", async () => {
    for (const req of [fetchReq("https://example.com"), skillReq("x"), monitorReq({ command: "ls" }), mcpReq()]) {
      const f = (await via(req)).frame();
      expect(f).not.toContain("Allow Claude to use");
      expect(f).not.toContain("this session");                    // the old `allow_always` row's wording
    }
  });
});
