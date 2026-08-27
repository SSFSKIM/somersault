// test/unit/linkOpen.test.ts — bl5 T-LINKOPEN Task 2. Pure module (no tui/Ink involved), so this lives in
// the unit suite rather than test/tui/. Exercises the three exports of ../../src/tui/linkOpen.ts against
// the canon 2.1.246 evidence in .doperpowers/sdd/2026-08-26-bl5-round/research-links.md §2a/§3c: the
// modifier/terminal gate (`shouldOpenOnClick`), the scheme allowlist + file: deference (`classifyLinkUrl`),
// and the fire-and-forget opener with its headless-Linux guard and warn copy (`openUrl`). Every `openUrl`
// case injects a fake `spawn`/`warn` so the suite never actually launches a browser.
import { describe, it, expect, vi } from "vitest";
import type { spawn as realSpawn } from "node:child_process";
import { shouldOpenOnClick, classifyLinkUrl, openUrl } from "../../src/tui/linkOpen.js";

describe("shouldOpenOnClick — the release-time gate (research-links.md §3c)", () => {
  // Full truth table from the plan's Global Constraints + Task 2 brief. Each row is its own `it` so a
  // single wrong term in the gate expression fails exactly one cell, not the whole table.
  it("vscode + alt-click → false (VSCode stands down entirely)", () => {
    expect(
      shouldOpenOnClick({ alt: true, ctrl: false, isWindowActivation: false }, { TERM_PROGRAM: "vscode" }, "darwin"),
    ).toBe(false);
  });

  it("plain click, ordinary terminal → false (no modifier, no Ghostty/Warp special case)", () => {
    expect(
      shouldOpenOnClick({ alt: false, ctrl: false, isWindowActivation: false }, { TERM_PROGRAM: "iTerm.app" }, "darwin"),
    ).toBe(false);
  });

  it("alt-click, ordinary terminal → true", () => {
    expect(
      shouldOpenOnClick({ alt: true, ctrl: false, isWindowActivation: false }, { TERM_PROGRAM: "iTerm.app" }, "darwin"),
    ).toBe(true);
  });

  it("ctrl-click, ordinary terminal → true", () => {
    expect(
      shouldOpenOnClick({ alt: false, ctrl: true, isWindowActivation: false }, { TERM_PROGRAM: "iTerm.app" }, "darwin"),
    ).toBe(true);
  });

  it("ghostty plain click on darwin → true (cmd+click arrives without an SGR modifier bit)", () => {
    expect(
      shouldOpenOnClick({ alt: false, ctrl: false, isWindowActivation: false }, { TERM_PROGRAM: "ghostty" }, "darwin"),
    ).toBe(true);
  });

  it("WarpTerminal plain click on darwin → true", () => {
    expect(
      shouldOpenOnClick({ alt: false, ctrl: false, isWindowActivation: false }, { TERM_PROGRAM: "WarpTerminal" }, "darwin"),
    ).toBe(true);
  });

  it("ghostty plain click on linux → false (the cmd+click special case is darwin-only)", () => {
    expect(
      shouldOpenOnClick({ alt: false, ctrl: false, isWindowActivation: false }, { TERM_PROGRAM: "ghostty" }, "linux"),
    ).toBe(false);
  });

  it("window-activation press + alt-click → false regardless of modifiers", () => {
    expect(
      shouldOpenOnClick({ alt: true, ctrl: true, isWindowActivation: true }, { TERM_PROGRAM: "iTerm.app" }, "darwin"),
    ).toBe(false);
  });

  it("window-activation press on Ghostty/darwin → still false", () => {
    expect(
      shouldOpenOnClick({ alt: false, ctrl: false, isWindowActivation: true }, { TERM_PROGRAM: "ghostty" }, "darwin"),
    ).toBe(false);
  });
});

describe("classifyLinkUrl — allowlist + file: deference (research-links.md §2a)", () => {
  // Canon's exact 13-entry set, offset 184275720 (the plan's brief rounds this to "12" in prose; the
  // literal list it hands the implementer is this exact set, copied verbatim below). Every entry gets its
  // own accept cell so a typo in the allowlist (a dropped scheme, a stray trailing slash) fails a specific,
  // nameable test.
  const ALLOWED = [
    "https:", "http:", "vscode:", "vscode-insiders:", "cursor:", "windsurf:", "zed:",
    "jetbrains:", "idea:", "slack:", "linear:", "notion:", "figma:",
  ];
  for (const scheme of ALLOWED) {
    it(`accepts ${scheme}`, () => {
      expect(classifyLinkUrl(`${scheme}//example.com/x`)).toEqual({ kind: "open" });
    });
  }

  it("file: is a no-op (spec D6 — no editor panel to route it to)", () => {
    expect(classifyLinkUrl("file:///etc/hosts")).toEqual({ kind: "file-noop" });
  });

  it("javascript: is refused", () => {
    expect(classifyLinkUrl("javascript:alert(1)")).toEqual({ kind: "refused", scheme: "javascript:" });
  });

  it("data: is refused", () => {
    expect(classifyLinkUrl("data:text/plain,hi")).toEqual({ kind: "refused", scheme: "data:" });
  });

  it("mailto: is refused", () => {
    expect(classifyLinkUrl("mailto:a@b.com")).toEqual({ kind: "refused", scheme: "mailto:" });
  });

  it("an unparseable URL is refused", () => {
    const result = classifyLinkUrl("not a url at all");
    expect(result.kind).toBe("refused");
  });
});

describe("openUrl — spawn wrapper (research-links.md §2a `f(r)`/`p()`)", () => {
  it("refused scheme: warns the exact canon copy, spawns nothing", () => {
    const spawn = vi.fn();
    const warn = vi.fn();
    openUrl("javascript:alert(1)", { spawn, env: {}, platform: "darwin", warn });
    expect(warn).toHaveBeenCalledWith(
      "[hyperlink] refusing to dispatch clicked link with non-allowlisted scheme javascript:",
    );
    expect(spawn).not.toHaveBeenCalled();
  });

  it("file: URL is a silent no-op — no spawn, no warn", () => {
    const spawn = vi.fn();
    const warn = vi.fn();
    openUrl("file:///etc/hosts", { spawn, env: {}, platform: "darwin", warn });
    expect(spawn).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("$BROWSER override wins over the platform default", () => {
    const spawn = vi.fn(() => fakeChild()) as unknown as typeof realSpawn;
    openUrl("https://example.com", { spawn, env: { BROWSER: "firefox" }, platform: "darwin" });
    expect(spawn).toHaveBeenCalledWith(
      "firefox",
      ["https://example.com"],
      expect.objectContaining({ stdio: ["ignore", "ignore", "ignore"] }),
    );
  });

  it("darwin default (no $BROWSER) spawns 'open' with the url as the sole arg", () => {
    const spawn = vi.fn(() => fakeChild()) as unknown as typeof realSpawn;
    openUrl("https://example.com", { spawn, env: {}, platform: "darwin" });
    expect(spawn).toHaveBeenCalledWith(
      "open",
      ["https://example.com"],
      expect.objectContaining({ stdio: ["ignore", "ignore", "ignore"] }),
    );
  });

  it("linux default (no $BROWSER, DISPLAY set) spawns 'xdg-open'", () => {
    const spawn = vi.fn(() => fakeChild()) as unknown as typeof realSpawn;
    openUrl("https://example.com", { spawn, env: { DISPLAY: ":0" }, platform: "linux" });
    expect(spawn).toHaveBeenCalledWith(
      "xdg-open",
      ["https://example.com"],
      expect.objectContaining({ stdio: ["ignore", "ignore", "ignore"] }),
    );
  });

  it("headless linux (no DISPLAY, no WAYLAND_DISPLAY, no $BROWSER) refuses to spawn", () => {
    const spawn = vi.fn();
    openUrl("https://example.com", { spawn, env: {}, platform: "linux" });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("headless linux still spawns when $BROWSER is explicitly set", () => {
    const spawn = vi.fn(() => fakeChild()) as unknown as typeof realSpawn;
    openUrl("https://example.com", { spawn, env: { BROWSER: "firefox" }, platform: "linux" });
    expect(spawn).toHaveBeenCalledWith(
      "firefox",
      ["https://example.com"],
      expect.objectContaining({ stdio: ["ignore", "ignore", "ignore"] }),
    );
  });

  it("a spawn that throws synchronously does not propagate", () => {
    const spawn = vi.fn(() => { throw new Error("ENOENT"); });
    expect(() => openUrl("https://example.com", { spawn, env: {}, platform: "darwin" })).not.toThrow();
  });

  // Fix-wave (bl5 round review, finding 3, P2). Before this fix, win32 fell through to the darwin/linux
  // ternary's `xdg-open` branch — a binary that does not exist on Windows — so every qualifying click was a
  // silent no-op there (the ENOENT is swallowed by the same `try`/`child.on("error")` pair the cell above
  // exercises). `rundll32 url.dll,FileProtocolHandler <url>` is Windows' own "hand this to the registered
  // handler" call, and — like `open`/`xdg-open` above — the url travels as its OWN argv entry, never through
  // `cmd /c start`'s shell grammar (`&|<>^"` are live metacharacters there; a malicious `url` could inject a
  // second command). `classifyLinkUrl` allowlists the URL's SCHEME, not the rest of the string, so the argv
  // boundary here is the only thing standing between a crafted path/query and command injection.
  it("win32 default (no $BROWSER) spawns 'rundll32' via url.dll, not a shell", () => {
    const spawn = vi.fn(() => fakeChild()) as unknown as typeof realSpawn;
    openUrl("https://example.com", { spawn, env: {}, platform: "win32" });
    expect(spawn).toHaveBeenCalledWith(
      "rundll32",
      ["url.dll,FileProtocolHandler", "https://example.com"],
      expect.objectContaining({ stdio: ["ignore", "ignore", "ignore"] }),
    );
  });

  it("$BROWSER override wins on win32 too, exactly as it does on darwin/linux", () => {
    const spawn = vi.fn(() => fakeChild()) as unknown as typeof realSpawn;
    openUrl("https://example.com", { spawn, env: { BROWSER: "firefox" }, platform: "win32" });
    expect(spawn).toHaveBeenCalledWith(
      "firefox",
      ["https://example.com"],
      expect.objectContaining({ stdio: ["ignore", "ignore", "ignore"] }),
    );
  });

  // `isHeadlessLinux` names `platform==="linux"` explicitly (openUrl's own guard above), so this is really
  // pinning that the guard's scope never silently widens: the identical env a linux box would refuse under
  // (no DISPLAY, no WAYLAND_DISPLAY, no BROWSER) still spawns on win32 — the DISPLAY concept does not exist
  // there and must never gate it.
  it("win32 is NOT subject to the linux headless-DISPLAY guard", () => {
    const spawn = vi.fn(() => fakeChild()) as unknown as typeof realSpawn;
    openUrl("https://example.com", { spawn, env: {}, platform: "win32" });
    expect(spawn).toHaveBeenCalledWith(
      "rundll32",
      ["url.dll,FileProtocolHandler", "https://example.com"],
      expect.objectContaining({ stdio: ["ignore", "ignore", "ignore"] }),
    );
  });
});

/** A minimal spawn-result stand-in: `openUrl` is fire-and-forget, so it only needs the shape it actually
 *  touches — an `on` it may attach an "error" listener to, nothing that ever needs to fire in these tests.
 *  Cast through `unknown` (rather than matching every overload of the real `child_process.spawn`) the same
 *  way `copy.test.ts`'s own `fakeSpawn` does. */
function fakeChild() {
  return { on: () => {}, unref: () => {} } as unknown as ReturnType<typeof realSpawn>;
}
