// tui/test/bypass-consent.test.tsx — Wave-T T15, the bypass consent gate. Every copy expectation is a
// TRANSCRIPTION of 2.1.220's `SAm` (L554034-79) — the bundle line sits on the assertion it produced — and the
// exit codes come from its two refusal handlers: L554055-56 (`Lu(1)` on "decline") and L554063-64 (`Lu(0)` on
// the frame's own cancel). Nothing here calls `process.exit`: the refusal is an injected callback all the way
// down. Nothing here touches the real prefs file either — every persisting case points CCX_FLEET_ROOT at a
// temp dir, which is what `savePrefs(patch, env)` → `prefsPath(env)` → `fleetRoot(env)` actually reads.
import React from "react";
import { describe, it, expect, afterAll } from "vitest";
import { render } from "ink-testing-library";
import { Text } from "ink";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderWithKeymap, tick } from "./keysTestUtil.js";
import {
  BypassConsent, BYPASS_CANCEL_LABEL, BYPASS_CONFIRM_LABEL, BYPASS_DOCS_URL, BYPASS_PARA_1A, BYPASS_PARA_1B,
  BYPASS_PARA_2, BYPASS_TITLE, hasAcceptedBypass, showBypassConsent,
} from "../../src/tui/bypassConsent.js";
import { loadPrefs, savePrefs } from "../../src/tui/prefs.js";
import { useChat } from "../../src/tui/useChat.js";
import type { ChatSession } from "../../src/tui/useChat.js";
import { fakeRemote } from "./helpers/fakeRemote.js";
import { ChatApp } from "../../src/tui/ChatApp.js";

const roots: string[] = [];
function tmpEnv(): NodeJS.ProcessEnv {
  const dir = mkdtempSync(join(tmpdir(), "ccx-bypass-"));
  roots.push(dir);
  return { ...process.env, CCX_FLEET_ROOT: dir };
}
afterAll(() => { for (const d of roots) rmSync(d, { recursive: true, force: true }); });

const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
/** Ink hard-wraps these long paragraphs at the terminal width, so content assertions read the de-wrapped
 *  frame — the wrap point is a rendering accident, the sentence is the canon. */
const flat = (f: () => string | undefined) => plain(f() ?? "").replace(/\s+/g, " ");
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) return; if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
/** Which rendered row carries the ❯ cursor (select.test.tsx's own reading of focus). */
const pointerLine = (f: () => string | undefined) => plain(f() ?? "").split("\n").find((l) => l.trimStart().startsWith("❯")) ?? "";
/** The same question inside the FULL app tree, where the transcript's prompt-echo band also opens with a
 *  `❯` (F4's `userEchoLines`) — so the consent's focused row is the one carrying a button label too. */
const focusedButton = (f: () => string | undefined) => plain(f() ?? "").split("\n")
  .find((l) => l.includes("❯") && (l.includes(BYPASS_CANCEL_LABEL) || l.includes(BYPASS_CONFIRM_LABEL))) ?? "";

async function mount(ui: React.ReactElement) {
  const r = renderWithKeymap(ui);
  await tick();                      // useInput/keymap subscribes in a passive effect (harness/CLAUDE.md)
  await tick();
  return r;
}

describe("<BypassConsent> — the copy is canon (SAm, L554034-79)", () => {
  it("renders the title and the three body paragraphs verbatim (L554070, L554075)", async () => {
    const r = await mount(<BypassConsent onAccept={() => {}} onRefuse={() => {}} savePrefs={() => {}} />);
    const f = flat(r.lastFrame);
    expect(f).toContain(BYPASS_TITLE);
    expect(f).toContain(BYPASS_PARA_1A);
    expect(f).toContain(BYPASS_PARA_1B);
    expect(f).toContain(BYPASS_PARA_2);
    expect(f).toContain(BYPASS_DOCS_URL);
  });
  it("pins the literals themselves, so a later edit has to be a deliberate one", () => {
    expect(BYPASS_TITLE).toBe("WARNING: Claude Code running in Bypass Permissions mode");
    expect(BYPASS_PARA_1A).toBe("In Bypass Permissions mode, Claude Code will not ask for your approval before running potentially dangerous commands.");
    expect(BYPASS_PARA_1B).toBe("This mode should only be used in a sandboxed container/VM that has restricted internet access and can easily be restored if damaged.");
    expect(BYPASS_PARA_2).toBe("By proceeding, you accept all responsibility for actions taken while running in Bypass Permissions mode.");
    expect(BYPASS_DOCS_URL).toBe("https://code.claude.com/docs/en/security");
    expect(BYPASS_CONFIRM_LABEL).toBe("Yes, I accept");
    expect(BYPASS_CANCEL_LABEL).toBe("No, exit");
  });
  it("renders CANCEL FIRST and focuses it (`cancelFirst:!0, focus:\"cancel\"`, L554075) — a safety property", async () => {
    const r = await mount(<BypassConsent onAccept={() => {}} onRefuse={() => {}} savePrefs={() => {}} />);
    const f = plain(r.lastFrame() ?? "");
    expect(f.indexOf(BYPASS_CANCEL_LABEL)).toBeGreaterThan(-1);
    expect(f.indexOf(BYPASS_CANCEL_LABEL)).toBeLessThan(f.indexOf(BYPASS_CONFIRM_LABEL));
    expect(pointerLine(r.lastFrame)).toContain(BYPASS_CANCEL_LABEL);
  });
});

describe("<BypassConsent> — the three outcomes", () => {
  it("accepting persists the acceptance and calls onAccept (L554051-53)", async () => {
    const env = tmpEnv();
    let accepted = 0;
    const r = await mount(<BypassConsent onAccept={() => { accepted++; }} onRefuse={() => { throw new Error("must not refuse"); }} env={env} />);
    r.stdin.write("\x1b[B");                                     // down → the confirm row
    await waitFor(() => pointerLine(r.lastFrame).includes(BYPASS_CONFIRM_LABEL));
    r.stdin.write("\r");
    await waitFor(() => accepted > 0);
    expect(accepted).toBe(1);
    expect(loadPrefs(env).skipDangerousModePermissionPrompt).toBe(true);
  });
  it("declining refuses with code 1 and persists NOTHING (L554055-56)", async () => {
    const env = tmpEnv();
    const codes: number[] = [];
    const r = await mount(<BypassConsent onAccept={() => { throw new Error("must not accept"); }} onRefuse={(c) => codes.push(c)} env={env} />);
    r.stdin.write("\r");                                         // enter on the focused cancel row
    await waitFor(() => codes.length > 0);
    expect(codes).toEqual([1]);
    expect(loadPrefs(env).skipDangerousModePermissionPrompt).toBeUndefined();
  });
  it("Escape refuses with code 0 (L554063-64)", async () => {
    const codes: number[] = [];
    const r = await mount(<BypassConsent onAccept={() => { throw new Error("must not accept"); }} onRefuse={(c) => codes.push(c)} savePrefs={() => {}} />);
    r.stdin.write("\x1b");
    await waitFor(() => codes.length > 0);
    expect(codes).toEqual([0]);
  });
  it("answers exactly ONCE — a second key after the answer is inert (`EAm` L554051)", async () => {
    const codes: number[] = [];
    const r = await mount(<BypassConsent onAccept={() => { throw new Error("must not accept"); }} onRefuse={(c) => codes.push(c)} savePrefs={() => {}} />);
    r.stdin.write("\r");
    await waitFor(() => codes.length > 0);
    r.stdin.write("\x1b");
    r.stdin.write("\r");
    await new Promise((res) => setTimeout(res, 20));
    expect(codes).toEqual([1]);
  });
});

describe("showBypassConsent — the launch wiring", () => {
  it("routes the decline to the INJECTED exit with 1, and Escape with 0", async () => {
    for (const [keys, code] of [["\r", 1], ["\x1b", 0]] as const) {
      const codes: number[] = [];
      let r!: ReturnType<typeof render>;
      void showBypassConsent({ exit: (c) => codes.push(c), env: tmpEnv(), mount: (node) => { r = render(node); return { unmount: () => r.unmount() }; } });
      await tick(); await tick();
      r.stdin.write(keys);
      await waitFor(() => codes.length > 0);
      expect(codes).toEqual([code]);
      r.unmount();
    }
  });
  it("resolves (and unmounts) once the warning is accepted", async () => {
    const env = tmpEnv();
    let r!: ReturnType<typeof render>;
    let unmounted = 0;
    const done = showBypassConsent({ exit: () => { throw new Error("must not exit"); }, env, mount: (node) => { r = render(node); return { unmount: () => { unmounted++; r.unmount(); } }; } });
    await tick(); await tick();
    r.stdin.write("\x1b[B");
    await waitFor(() => pointerLine(r.lastFrame).includes(BYPASS_CONFIRM_LABEL));
    r.stdin.write("\r");
    await done;
    expect(unmounted).toBe(1);
    expect(hasAcceptedBypass(loadPrefs(env))).toBe(true);
  });
});

describe("hasAcceptedBypass (upstream's M8(), L43492)", () => {
  it("is true only for an explicit recorded acceptance", () => {
    expect(hasAcceptedBypass({})).toBe(false);
    expect(hasAcceptedBypass({ skipDangerousModePermissionPrompt: false })).toBe(false);
    expect(hasAcceptedBypass({ skipDangerousModePermissionPrompt: true })).toBe(true);
  });
});

// ── /yolo (spec W-T20): a ccx-specific route into bypass with no upstream precedent to inherit, because
// upstream's ladder cannot reach bypass at all (settingsRows.ts:23-27). Same consent, same persisted answer.
function YoloHost({ makeSession, api, env }: { makeSession: () => ChatSession; api: { run?: (s: string) => void }; env: NodeJS.ProcessEnv }) {
  const c = useChat(makeSession, {}, { env });
  api.run = c.submit;
  return <Text>mode:{c.state.mode} consent:{c.state.bypassConsent.open ? "open" : "closed"}</Text>;
}

describe("/yolo is gated by the same consent (spec W-T20)", () => {
  it("opens the consent on first use instead of flipping the mode", async () => {
    const env = tmpEnv();
    const modes: string[] = [];
    const session = fakeRemote({ setPermissionMode: (m: string) => { modes.push(m); } });
    const api: { run?: (s: string) => void } = {};
    const { lastFrame } = render(<YoloHost makeSession={() => session} api={api} env={env} />);
    await waitFor(() => flat(lastFrame).includes("mode:default"));
    api.run!("/yolo");
    await waitFor(() => flat(lastFrame).includes("consent:open"));
    expect(flat(lastFrame)).toContain("mode:default");
    expect(modes).toEqual([]);
  });
  it("reaches the screen in the real app tree, and accepting there flips the mode", async () => {
    const env = tmpEnv();
    const modes: string[] = [];
    const session = fakeRemote({ setPermissionMode: (m: string) => { modes.push(m); } });
    const r = renderWithKeymap(<ChatApp makeSession={() => session} client={{ kind: "loopback" }} cwd={"/tmp"} initialPrompt="/yolo" deps={{ env }} />);
    await waitFor(() => flat(r.lastFrame).includes(BYPASS_TITLE));
    expect(modes).toEqual([]);
    r.stdin.write("\x1b[B");
    await waitFor(() => focusedButton(r.lastFrame).includes(BYPASS_CONFIRM_LABEL));
    r.stdin.write("\r");
    await waitFor(() => modes.length > 0);
    expect(modes).toEqual(["bypassPermissions"]);
    expect(flat(r.lastFrame)).not.toContain(BYPASS_TITLE);       // the dialog is gone once it is answered
    expect(loadPrefs(env).skipDangerousModePermissionPrompt).toBe(true);
    r.unmount();
  });
  it("flips the mode with NO consent once the acceptance is recorded", async () => {
    const env = tmpEnv();
    savePrefs({ skipDangerousModePermissionPrompt: true }, env);
    const modes: string[] = [];
    const session = fakeRemote({ setPermissionMode: (m: string) => { modes.push(m); } });
    const api: { run?: (s: string) => void } = {};
    const { lastFrame } = render(<YoloHost makeSession={() => session} api={api} env={env} />);
    await waitFor(() => flat(lastFrame).includes("mode:default"));
    api.run!("/yolo");
    await waitFor(() => flat(lastFrame).includes("mode:bypassPermissions"));
    expect(flat(lastFrame)).toContain("consent:closed");
    expect(modes).toEqual(["bypassPermissions"]);
  });
});
