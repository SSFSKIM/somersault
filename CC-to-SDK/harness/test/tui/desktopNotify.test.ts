import { describe, expect, it } from "vitest";
import { createDesktopNotifier, resolveChannel, NOTIF_DEFAULT_EVENTS, type NotifChannel, type NotifEvent } from "../../src/tui/desktopNotify.js";

const E = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;
function fire(env: NodeJS.ProcessEnv, channel: NotifChannel = "auto", events: readonly NotifEvent[] = NOTIF_DEFAULT_EVENTS): string[] {
  const writes: string[] = [];
  createDesktopNotifier({ write: (s) => writes.push(s), env, settings: () => ({ preferredNotifChannel: channel, enabledEvents: events }) })
    .notify("idle_prompt", "hi");
  return writes;
}
const TMUX = { TMUX: "/tmp/s,1,0" }, STY = { STY: "1.pts-0" };
const wrapT = (s: string) => `\x1bPtmux;${s.replaceAll("\x1b", "\x1b\x1b")}\x1b\\`;
const wrapS = (s: string) => `\x1bP${s.replaceAll("\x1b", "\x1b\x1b")}\x1b\\`;

describe("exact bytes, every channel × bare/TMUX/STY", () => {
  const iterm = "\x1b]9;ccx: hi\x07";
  it("iterm2", () => {
    expect(fire(E({ TERM_PROGRAM: "iTerm.app" }), "iterm2")).toEqual([iterm]);
    expect(fire(E({ TERM_PROGRAM: "iTerm.app", ...TMUX }), "iterm2")).toEqual([wrapT(iterm)]);
    expect(fire(E({ TERM_PROGRAM: "iTerm.app", ...STY }), "iterm2")).toEqual([wrapS(iterm)]);
  });
  it("ghostty", () => {
    const g = "\x1b]777;notify;ccx;hi\x07";
    expect(fire(E({ TERM: "xterm-ghostty" }), "ghostty")).toEqual([g]);
    expect(fire(E({ TERM: "xterm-ghostty", ...TMUX }), "ghostty")).toEqual([wrapT(g)]);
    expect(fire(E({ TERM: "xterm-ghostty", ...STY }), "ghostty")).toEqual([wrapS(g)]);
  });
  it("kitty writes three ST-terminated parts sharing one id, wrapped in both muxes", () => {
    const bare = fire(E({ TERM: "xterm-kitty" }), "kitty");
    const id = bare[0]!.match(/i=([^:]+):/)![1]!;
    const parts = [`\x1b]99;i=${id}:d=0:p=title;ccx\x1b\\`, `\x1b]99;i=${id}:p=body;hi\x1b\\`, `\x1b]99;i=${id}:d=1:a=focus;\x1b\\`];
    expect(bare).toEqual(parts);
    const muxed = fire(E({ TERM: "xterm-kitty", ...TMUX }), "kitty");
    const mid = muxed[0]!.match(/i=([^:]+):/)![1]!;
    expect(muxed).toEqual([`\x1b]99;i=${mid}:d=0:p=title;ccx\x1b\\`, `\x1b]99;i=${mid}:p=body;hi\x1b\\`, `\x1b]99;i=${mid}:d=1:a=focus;\x1b\\`].map(wrapT));
  });
  it("terminal_bell is a BARE byte in every environment", () => {
    for (const extra of [{}, TMUX, STY]) expect(fire(E({ TERM_PROGRAM: "Apple_Terminal", ...extra }), "terminal_bell")).toEqual(["\x07"]);
  });
  it("iterm2_with_bell wraps the OSC half only", () => {
    expect(fire(E({ TERM_PROGRAM: "iTerm.app", ...TMUX }), "iterm2_with_bell")).toEqual([wrapT(iterm), "\x07"]);
  });
  it("an unresolved terminal writes nothing at all", () => {
    expect(fire(E({ TERM_PROGRAM: "WezTerm" }))).toEqual([]);
    expect(fire(E({ TERM_PROGRAM: "iTerm.app" }), "notifications_disabled")).toEqual([]);
  });
});

describe("auto resolution survives a multiplexer", () => {
  it("does NOT trust TERM_PROGRAM inside tmux — it reads the surviving marker instead", () => {
    // tmux >= 3.2 stamps TERM_PROGRAM=tmux over the outer terminal's value (renderer.ts records this).
    // Using the marker recorded in Step 1, auto must still reach the real emulator.
    expect(resolveChannel("auto", E({ TERM_PROGRAM: "tmux", ...TMUX, LC_TERMINAL: "iTerm2" }))).toBe("iterm2");
    expect(resolveChannel("auto", E({ TERM_PROGRAM: "tmux", ...TMUX, KITTY_WINDOW_ID: "1" }))).toBe("kitty");
    // Measured: a pane inherits the SERVER's env, so on a pre-existing server no marker is present at
    // all. That must degrade to a bell, never to silence — see Step 1's table.
    expect(resolveChannel("auto", E({ TERM_PROGRAM: "tmux", ...TMUX }))).toBe("terminal_bell");
  });
  it("outside a multiplexer TERM_PROGRAM is trustworthy", () => {
    expect(resolveChannel("auto", E({ TERM_PROGRAM: "iTerm.app" }))).toBe("iterm2");
    expect(resolveChannel("auto", E({ TERM: "xterm-ghostty" }))).toBe("ghostty");
    expect(resolveChannel("auto", E({ TERM_PROGRAM: "Apple_Terminal" }))).toBe("terminal_bell");
  });
});

describe("policy", () => {
  it("delivers the two blocking events by default and drops the rest", () => {
    const seen: NotifEvent[] = [];
    const n = createDesktopNotifier({
      write: () => seen.push("idle_prompt"), env: E({ TERM_PROGRAM: "iTerm.app" }),
      settings: () => ({ preferredNotifChannel: "auto", enabledEvents: NOTIF_DEFAULT_EVENTS }),
    });
    for (const e of ["permission_prompt", "idle_prompt", "agent_completed", "agent_needs_input"] as NotifEvent[]) n.notify(e, "x");
    expect(seen).toHaveLength(2);
  });
  it("delivers an opted-in event", () => {
    expect(fire(E({ TERM_PROGRAM: "iTerm.app" }), "auto", ["idle_prompt", "agent_completed"])).toHaveLength(1);
  });
  it("sanitizes every dynamic part", () => {
    const writes: string[] = [];
    createDesktopNotifier({ write: (s) => writes.push(s), env: E({ TERM_PROGRAM: "iTerm.app" }), settings: () => ({ preferredNotifChannel: "auto", enabledEvents: NOTIF_DEFAULT_EVENTS }) })
      .notify("idle_prompt", "a\x1b[31mb\x07c\x7fd\x9be");
    expect(writes).toEqual(["\x1b]9;ccx: a [31mb c d e\x07"]);
  });
});
