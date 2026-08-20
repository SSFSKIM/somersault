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
const BEL = "\x07";

describe("exact bytes, every channel × bare/TMUX/STY", () => {
  const iterm = "\x1b]9;ccx: hi\x07";
  it("iterm2", () => {
    expect(fire(E({ TERM_PROGRAM: "iTerm.app" }), "iterm2")).toEqual([iterm]);
    // Inside a multiplexer, tmux's `allow-passthrough` defaults OFF (measured, see desktopNotify.ts's
    // header comment), so the wrapped sequence alone may never reach the real terminal. A bare BEL
    // follows it so at least a signal survives regardless of that setting (F8 review Finding A).
    expect(fire(E({ TERM_PROGRAM: "iTerm.app", ...TMUX }), "iterm2")).toEqual([wrapT(iterm), BEL]);
    expect(fire(E({ TERM_PROGRAM: "iTerm.app", ...STY }), "iterm2")).toEqual([wrapS(iterm), BEL]);
  });
  it("ghostty", () => {
    const g = "\x1b]777;notify;ccx;hi\x07";
    expect(fire(E({ TERM: "xterm-ghostty" }), "ghostty")).toEqual([g]);
    expect(fire(E({ TERM: "xterm-ghostty", ...TMUX }), "ghostty")).toEqual([wrapT(g), BEL]);
    expect(fire(E({ TERM: "xterm-ghostty", ...STY }), "ghostty")).toEqual([wrapS(g), BEL]);
  });
  it("kitty writes three ST-terminated parts sharing one id, wrapped in both muxes, plus a trailing bell when muxed", () => {
    const bare = fire(E({ TERM: "xterm-kitty" }), "kitty");
    const id = bare[0]!.match(/i=([^:]+):/)![1]!;
    const parts = [`\x1b]99;i=${id}:d=0:p=title;ccx\x1b\\`, `\x1b]99;i=${id}:p=body;hi\x1b\\`, `\x1b]99;i=${id}:d=1:a=focus;\x1b\\`];
    expect(bare).toEqual(parts);
    const muxed = fire(E({ TERM: "xterm-kitty", ...TMUX }), "kitty");
    const mid = muxed[0]!.match(/i=([^:]+):/)![1]!;
    expect(muxed).toEqual([`\x1b]99;i=${mid}:d=0:p=title;ccx\x1b\\`, `\x1b]99;i=${mid}:p=body;hi\x1b\\`, `\x1b]99;i=${mid}:d=1:a=focus;\x1b\\`].map(wrapT).concat(BEL));
  });
  it("terminal_bell is a BARE byte in every environment", () => {
    for (const extra of [{}, TMUX, STY]) expect(fire(E({ TERM_PROGRAM: "Apple_Terminal", ...extra }), "terminal_bell")).toEqual(["\x07"]);
  });
  it("iterm2_with_bell wraps the OSC half only, and does not double the bell when muxed", () => {
    expect(fire(E({ TERM_PROGRAM: "iTerm.app", ...TMUX }), "iterm2_with_bell")).toEqual([wrapT(iterm), "\x07"]);
  });
  it("an unresolved terminal writes nothing at all", () => {
    expect(fire(E({ TERM_PROGRAM: "WezTerm" }))).toEqual([]);
    expect(fire(E({ TERM_PROGRAM: "iTerm.app" }), "notifications_disabled")).toEqual([]);
  });
  it("an invalid preferredNotifChannel — a hand-edited config bypassing the type system — rings the bell instead of writing nothing", () => {
    const bogus = "not_a_real_channel" as unknown as NotifChannel;
    expect(fire(E({ TERM_PROGRAM: "iTerm.app" }), bogus)).toEqual([BEL]);
  });
  it("strips a semicolon from a ghostty title so OSC 777's field parser can't truncate it", () => {
    const writes: string[] = [];
    createDesktopNotifier({ write: (s) => writes.push(s), env: E({ TERM: "xterm-ghostty" }), settings: () => ({ preferredNotifChannel: "auto", enabledEvents: NOTIF_DEFAULT_EVENTS }) })
      .notify("idle_prompt", "hi", "a;b");
    expect(writes).toEqual(["\x1b]777;notify;a:b;hi\x07"]);
  });
  it("iterm2 uses notifyTerminator's ST when the env signals kitty, not a hardcoded BEL", () => {
    expect(fire(E({ TERM_PROGRAM: "iTerm.app", KITTY_WINDOW_ID: "1" }), "iterm2")).toEqual(["\x1b]9;ccx: hi\x1b\\"]);
  });
  it("ghostty uses notifyTerminator's ST when the env signals kitty, not a hardcoded BEL", () => {
    expect(fire(E({ TERM: "xterm-ghostty", KITTY_WINDOW_ID: "1" }), "ghostty")).toEqual(["\x1b]777;notify;ccx;hi\x1b\\"]);
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
  it("STY and TERM_PROGRAM===screen are each independently what marks a pane as muxed — not just TMUX (F8 review Finding B)", () => {
    // `env.STY !== undefined` on its own, no TMUX present: without this term `muxed` would be false and
    // the (unmatched) literal string "screen"/undefined would fall through to `none` instead of the bell.
    expect(resolveChannel("auto", E({ STY: "1.pts-0" }))).toBe("terminal_bell");
    expect(resolveChannel("auto", E({ STY: "1.pts-0", LC_TERMINAL: "iTerm2" }))).toBe("iterm2");
    // `env.TERM_PROGRAM === "screen"` on its own, no TMUX/STY present.
    expect(resolveChannel("auto", E({ TERM_PROGRAM: "screen" }))).toBe("terminal_bell");
    // Both together, as the review's own reproduction.
    expect(resolveChannel("auto", E({ TERM: "screen", STY: "1.pts-0" }))).toBe("terminal_bell");
    expect(resolveChannel("auto", E({ TERM: "screen", STY: "1.pts-0", LC_TERMINAL: "iTerm2" }))).toBe("iterm2");
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
  it("sanitizes a caller-supplied title too, not just the default NOTIF_TITLE (F8 review Finding H)", () => {
    const writes: string[] = [];
    createDesktopNotifier({ write: (s) => writes.push(s), env: E({ TERM_PROGRAM: "iTerm.app" }), settings: () => ({ preferredNotifChannel: "auto", enabledEvents: NOTIF_DEFAULT_EVENTS }) })
      .notify("idle_prompt", "hi", "ti\x1btle");
    expect(writes).toEqual(["\x1b]9;ti tle: hi\x07"]);
  });
  it("settings() is read at CALL time, not captured once at construction (F8 review Finding C)", () => {
    let call = 0;
    const chans: NotifChannel[] = ["terminal_bell", "iterm2"];
    const writes: string[] = [];
    const n = createDesktopNotifier({
      write: (s) => writes.push(s),
      env: E({ TERM_PROGRAM: "iTerm.app" }),
      settings: () => ({ preferredNotifChannel: chans[call++]!, enabledEvents: NOTIF_DEFAULT_EVENTS }),
    });
    n.notify("idle_prompt", "hi");
    n.notify("idle_prompt", "hi");
    // Two calls, two different channels, two different byte shapes — this can only pass if `settings()`
    // ran again on the second call. Hoisting it to `const captured = deps.settings()` at construction
    // would make both calls use the first channel.
    expect(writes).toEqual(["\x07", "\x1b]9;ccx: hi\x07"]);
  });
  it("kitty ids are unique per call, not a constant that would collapse successive notifications (F8 review Finding H)", () => {
    // Kitty's spec REPLACES a prior notification that shares its id, so a hardcoded id would make every
    // second-and-later notification silently overwrite the first instead of appearing alongside it.
    const writes: string[] = [];
    const n = createDesktopNotifier({ write: (s) => writes.push(s), env: E({ TERM: "xterm-kitty" }), settings: () => ({ preferredNotifChannel: "kitty", enabledEvents: NOTIF_DEFAULT_EVENTS }) });
    n.notify("idle_prompt", "hi");
    n.notify("idle_prompt", "hi");
    const id1 = writes[0]!.match(/i=([^:]+):/)![1]!;
    const id2 = writes[3]!.match(/i=([^:]+):/)![1]!;
    expect(id1).not.toBe(id2);
  });
});
