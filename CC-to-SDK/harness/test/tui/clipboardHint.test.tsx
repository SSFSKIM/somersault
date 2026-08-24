// test/tui/clipboardHint.test.tsx — F10 T-IMGREACH Task 13 (I6): the ambient clipboard hint, end to end.
//
// Three layers, three describe blocks: the PURE model (`clipboardHint.ts`, fake-timer-free — it owns no
// clock of its own, only a state machine and a throttle bookkeeping timestamp), the WIRING through
// `ChatComposer` (real `vi.useFakeTimers()`, driving the debounce this component's own `setTimeout` owns),
// and the FOOTER's poster census (a grep-honesty check, the same shape `keys-acceptance.test.tsx` already
// runs against hardcoded chords).
import React, { act } from "react";
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { renderWithKeymap as render } from "./keysTestUtil.js";
import { ChatComposer } from "../../src/tui/ChatComposer.js";
import { initialEditorState, type EditorState } from "../../src/tui/editor.js";
import { createNotificationStore } from "../../src/tui/notifications.js";
import {
  CLIPBOARD_HINT_DEBOUNCE_MS, CLIPBOARD_HINT_KEY, CLIPBOARD_HINT_THROTTLE_MS, CLIPBOARD_HINT_TIMEOUT_MS,
  createClipboardHintModel,
} from "../../src/tui/clipboardHint.js";

const frame = (f: () => string | undefined) => f() ?? "";
async function settle() { await new Promise((r) => setTimeout(r, 20)); }        // let useInput/effects subscribe

describe("createClipboardHintModel (I6, pure)", () => {
  it("focus-in from 'unknown' arms; state moves to 'focused'", () => {
    const m = createClipboardHintModel();
    expect(m.state()).toBe("unknown");
    expect(m.onFocus(true)).toBe("arm");
    expect(m.state()).toBe("focused");
  });

  it("a second focus-in while already focused arms nothing — there is no edge", () => {
    const m = createClipboardHintModel();
    m.onFocus(true);
    expect(m.onFocus(true)).toBe("none");
  });

  it("a blur cancels, from any prior state, and moves state to 'blurred'", () => {
    const m = createClipboardHintModel();
    expect(m.onFocus(false)).toBe("cancel");             // straight from "unknown" — still a cancel signal
    expect(m.state()).toBe("blurred");
    m.onFocus(true);
    expect(m.onFocus(false)).toBe("cancel");
  });

  it("the secondary trigger: one keypress from 'unknown' arms and moves to 'focused'", () => {
    const m = createClipboardHintModel();
    expect(m.onKeypress()).toBe("arm");
    expect(m.state()).toBe("focused");
  });

  it("once focus state is known (by either route), a keypress arms nothing", () => {
    const byKeypress = createClipboardHintModel();
    byKeypress.onKeypress();
    expect(byKeypress.onKeypress()).toBe("none");

    const byFocusReport = createClipboardHintModel();
    byFocusReport.onFocus(true);                          // a real 1004 byte arrived before any keystroke
    expect(byFocusReport.onKeypress()).toBe("none");
  });

  it("throttled: false with no prior fire, and carries no debounce logic of its own — that is the caller's job", () => {
    const m = createClipboardHintModel();
    expect(m.throttled(0)).toBe(false);
  });

  it("the throttle window: within 30_000ms of a noted fire reads throttled; at 30_001ms it is clear", () => {
    const m = createClipboardHintModel();
    m.noteFire(1000);                                                               // the first fire, at t=1000
    expect(m.throttled(1000 + CLIPBOARD_HINT_THROTTLE_MS)).toBe(true);              // exactly 30_000ms later — still inside
    expect(m.throttled(1000 + CLIPBOARD_HINT_THROTTLE_MS + 1)).toBe(false);         // 30_001ms later — clear
  });

  it("only `noteFire` moves the baseline — merely checking `throttled` never restarts the window (review finding P2)", () => {
    const m = createClipboardHintModel();
    m.noteFire(0);                                        // fires at t=0 — the ONLY baseline the window is measured from
    expect(m.throttled(10_000)).toBe(true);               // a mere read at t=10_000 must NOT become the new baseline
    // A buggy implementation that recorded a fire on every read (or on a suppressed downstream attempt)
    // would answer `true` here (only 20_001ms since t=10_000); the correct answer measures from the
    // ORIGINAL fire at t=0.
    expect(m.throttled(CLIPBOARD_HINT_THROTTLE_MS + 1)).toBe(false);
  });
});

/** A fake `onFocusChange`-shaped channel: `fire` drives whatever `ChatComposer` subscribed with, exactly as
 *  `KeymapProvider`'s dispatch would through the real `createFocusChain`. */
function makeFocusChannel() {
  let handler: ((focused: boolean) => void) | null = null;
  return {
    onFocusChange: (cb: (focused: boolean) => void) => { handler = cb; return () => { handler = null; }; },
    fire: (focused: boolean) => handler?.(focused),
  };
}

describe("ChatComposer — the ambient clipboard hint wiring (I6)", () => {
  it("focus-in from 'unknown' arms the debounce; the hint posts after 1000ms, naming the live chord", async () => {
    const editorStateRef = { current: initialEditorState() } as React.MutableRefObject<EditorState>;
    const focus = makeFocusChannel();
    const check = vi.fn(async () => true);
    const { lastFrame, unmount } = render(
      <ChatComposer editorStateRef={editorStateRef} onSubmit={() => {}} cwd="/" commandCatalog={[]}
        readClipboardImage={async () => ({ kind: "none" })} checkClipboardImage={check}
        onFocusChange={focus.onFocusChange} columns={() => 120} />,
    );
    await settle();
    vi.useFakeTimers();
    try {
      act(() => { focus.fire(true); });
      await act(async () => { await vi.advanceTimersByTimeAsync(CLIPBOARD_HINT_DEBOUNCE_MS); });
      expect(check).toHaveBeenCalledTimes(1);
      // The middle dot is canon's; the chord is the default `chat:imagePaste` binding.
      expect(frame(lastFrame)).toContain("Image in clipboard · ctrl+v to paste");
    } finally { vi.useRealTimers(); unmount(); }
  });

  it("a blur inside the debounce window cancels — nothing posts, and the check is never called", async () => {
    const editorStateRef = { current: initialEditorState() } as React.MutableRefObject<EditorState>;
    const focus = makeFocusChannel();
    const check = vi.fn(async () => true);
    const { lastFrame, unmount } = render(
      <ChatComposer editorStateRef={editorStateRef} onSubmit={() => {}} cwd="/" commandCatalog={[]}
        readClipboardImage={async () => ({ kind: "none" })} checkClipboardImage={check}
        onFocusChange={focus.onFocusChange} columns={() => 120} />,
    );
    await settle();
    vi.useFakeTimers();
    try {
      act(() => { focus.fire(true); });
      await act(async () => { await vi.advanceTimersByTimeAsync(CLIPBOARD_HINT_DEBOUNCE_MS - 100); });   // not yet elapsed
      act(() => { focus.fire(false); });                                                                 // blur cancels
      await act(async () => { await vi.advanceTimersByTimeAsync(200); });                                 // past when it WOULD have fired
      expect(check).not.toHaveBeenCalled();
      expect(frame(lastFrame)).not.toContain("Image in clipboard");
    } finally { vi.useRealTimers(); unmount(); }
  });

  it("a second focus-in within 30_000ms of a fired hint posts nothing; at 30_001ms it posts", async () => {
    const editorStateRef = { current: initialEditorState() } as React.MutableRefObject<EditorState>;
    const focus = makeFocusChannel();
    const check = vi.fn(async () => true);
    const { lastFrame, unmount } = render(
      <ChatComposer editorStateRef={editorStateRef} onSubmit={() => {}} cwd="/" commandCatalog={[]}
        readClipboardImage={async () => ({ kind: "none" })} checkClipboardImage={check}
        onFocusChange={focus.onFocusChange} columns={() => 120} />,
    );
    await settle();
    vi.useFakeTimers();
    const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
    try {
      act(() => { focus.fire(true); });
      await advance(CLIPBOARD_HINT_DEBOUNCE_MS);                    // first fire
      expect(check).toHaveBeenCalledTimes(1);
      // A blur/refocus cycle well inside the 30s window: the debounce arms again, but the throttle eats the
      // attempt before the check is ever invoked (`throttled` gates it — see `armClipboardHint`). The exact
      // 30_000/30_001ms boundary is pinned precisely at the pure-model level above; this composer-level cell
      // only has to prove the wiring end to end, with margin either side of it.
      await advance(4000);                                          // nothing pending — the clock alone moves
      act(() => { focus.fire(false); focus.fire(true); });
      await advance(CLIPBOARD_HINT_DEBOUNCE_MS);                    // only ~5s since the real fire — still inside
      expect(check).toHaveBeenCalledTimes(1);                       // suppressed
      // …and once the window is genuinely clear (well past 30s since the fire), the next edge fires.
      await advance(CLIPBOARD_HINT_THROTTLE_MS);
      act(() => { focus.fire(false); focus.fire(true); });
      await advance(CLIPBOARD_HINT_DEBOUNCE_MS);
      expect(check).toHaveBeenCalledTimes(2);
      expect(frame(lastFrame)).toContain("Image in clipboard");
    } finally { vi.useRealTimers(); unmount(); }
  });

  it("gated on image-paste availability: with readClipboardImage absent, the check is never called and nothing posts", async () => {
    const editorStateRef = { current: initialEditorState() } as React.MutableRefObject<EditorState>;
    const focus = makeFocusChannel();
    const check = vi.fn(async () => true);
    const { lastFrame, unmount } = render(
      // no readClipboardImage prop at all
      <ChatComposer editorStateRef={editorStateRef} onSubmit={() => {}} cwd="/" commandCatalog={[]}
        checkClipboardImage={check} onFocusChange={focus.onFocusChange} columns={() => 120} />,
    );
    await settle();
    vi.useFakeTimers();
    try {
      act(() => { focus.fire(true); });
      await act(async () => { await vi.advanceTimersByTimeAsync(CLIPBOARD_HINT_DEBOUNCE_MS); });
      expect(check).not.toHaveBeenCalled();
      expect(frame(lastFrame)).not.toContain("Image in clipboard");
    } finally { vi.useRealTimers(); unmount(); }
  });

  it("with no image on the (fake) clipboard, nothing posts", async () => {
    const editorStateRef = { current: initialEditorState() } as React.MutableRefObject<EditorState>;
    const focus = makeFocusChannel();
    const check = vi.fn(async () => false);
    const { lastFrame, unmount } = render(
      <ChatComposer editorStateRef={editorStateRef} onSubmit={() => {}} cwd="/" commandCatalog={[]}
        readClipboardImage={async () => ({ kind: "none" })} checkClipboardImage={check}
        onFocusChange={focus.onFocusChange} columns={() => 120} />,
    );
    await settle();
    vi.useFakeTimers();
    try {
      act(() => { focus.fire(true); });
      await act(async () => { await vi.advanceTimersByTimeAsync(CLIPBOARD_HINT_DEBOUNCE_MS); });
      expect(check).toHaveBeenCalledTimes(1);
      expect(frame(lastFrame)).not.toContain("Image in clipboard");
    } finally { vi.useRealTimers(); unmount(); }
  });

  it("F10 fix-wave review finding P2: a no-image check does not consume the throttle window — copying an image and refocusing within 30s still fires", async () => {
    // Reproduces the finding exactly: focus-in with an EMPTY clipboard (check resolves false, nothing
    // posts) must not itself start the 30s throttle clock. A blur/refocus soon after — well inside 30s,
    // once the user has actually copied an image — must still be able to fire. Before the fix, `shouldFire`
    // was consulted (and its clock advanced) BEFORE the check ran, so this second, genuinely-positive
    // attempt was silently swallowed by the throttle the first, negative attempt should never have armed.
    const editorStateRef = { current: initialEditorState() } as React.MutableRefObject<EditorState>;
    const focus = makeFocusChannel();
    const check = vi.fn(async () => false);
    const { lastFrame, unmount } = render(
      <ChatComposer editorStateRef={editorStateRef} onSubmit={() => {}} cwd="/" commandCatalog={[]}
        readClipboardImage={async () => ({ kind: "none" })} checkClipboardImage={check}
        onFocusChange={focus.onFocusChange} columns={() => 120} />,
    );
    await settle();
    vi.useFakeTimers();
    const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
    try {
      act(() => { focus.fire(true); });
      await advance(CLIPBOARD_HINT_DEBOUNCE_MS);          // first attempt — check runs, finds NOTHING
      expect(check).toHaveBeenCalledTimes(1);
      expect(frame(lastFrame)).not.toContain("Image in clipboard");

      check.mockImplementation(async () => true);          // the user has now copied an image
      await advance(5000);                                  // well inside a 30s throttle window
      act(() => { focus.fire(false); focus.fire(true); });
      await advance(CLIPBOARD_HINT_DEBOUNCE_MS);
      expect(check).toHaveBeenCalledTimes(2);               // the negative attempt never armed a throttle
      expect(frame(lastFrame)).toContain("Image in clipboard");
    } finally { vi.useRealTimers(); unmount(); }
  });

  it("first-keypress secondary trigger: with state still 'unknown' and no 1004 bytes ever seen, one keypress arms and the hint posts at 1000ms", async () => {
    const editorStateRef = { current: initialEditorState() } as React.MutableRefObject<EditorState>;
    const check = vi.fn(async () => true);
    const { stdin, lastFrame, unmount } = render(
      <ChatComposer editorStateRef={editorStateRef} onSubmit={() => {}} cwd="/" commandCatalog={[]}
        readClipboardImage={async () => ({ kind: "none" })} checkClipboardImage={check} columns={() => 120} />,
      // deliberately no onFocusChange dep at all — this terminal never sends a single 1004 byte
    );
    await settle();
    vi.useFakeTimers();
    try {
      await act(async () => { stdin.write("a"); });
      await act(async () => { await vi.advanceTimersByTimeAsync(CLIPBOARD_HINT_DEBOUNCE_MS); });
      expect(check).toHaveBeenCalledTimes(1);
      expect(frame(lastFrame)).toContain("Image in clipboard");
    } finally { vi.useRealTimers(); unmount(); }
  });

  it("a rebound chat:imagePaste renders in the hint — a hardcoded ctrl+v would fail this", async () => {
    const editorStateRef = { current: initialEditorState() } as React.MutableRefObject<EditorState>;
    const focus = makeFocusChannel();
    const check = vi.fn(async () => true);
    const { lastFrame, unmount } = render(
      <ChatComposer editorStateRef={editorStateRef} onSubmit={() => {}} cwd="/" commandCatalog={[]}
        readClipboardImage={async () => ({ kind: "none" })} checkClipboardImage={check}
        onFocusChange={focus.onFocusChange} columns={() => 120} />,
      // `f9` — a bare, unmodified key, so its rendered spelling is identical on every platform (unlike
      // `alt`, which prints `opt` on darwin) and there is no risk of colliding with another default bind.
      { userLayers: [{ context: "Chat", bindings: { "ctrl+v": null, "alt+v": null, "f9": "chat:imagePaste" } }] },
    );
    await settle();
    vi.useFakeTimers();
    try {
      act(() => { focus.fire(true); });
      await act(async () => { await vi.advanceTimersByTimeAsync(CLIPBOARD_HINT_DEBOUNCE_MS); });
      expect(frame(lastFrame)).toContain("Image in clipboard · f9 to paste");
      expect(frame(lastFrame)).not.toContain("ctrl+v");
    } finally { vi.useRealTimers(); unmount(); }
  });

  it("the posted notification is immediate-priority with canon's own 8000ms timeout", async () => {
    const editorStateRef = { current: initialEditorState() } as React.MutableRefObject<EditorState>;
    const focus = makeFocusChannel();
    const check = vi.fn(async () => true);
    const store = createNotificationStore();
    const { unmount } = render(
      <ChatComposer editorStateRef={editorStateRef} onSubmit={() => {}} cwd="/" commandCatalog={[]}
        readClipboardImage={async () => ({ kind: "none" })} checkClipboardImage={check}
        onFocusChange={focus.onFocusChange} columns={() => 120} notifications={store} />,
    );
    await settle();
    vi.useFakeTimers();
    try {
      act(() => { focus.fire(true); });
      await act(async () => { await vi.advanceTimersByTimeAsync(CLIPBOARD_HINT_DEBOUNCE_MS); });
      expect(store.state().current).toMatchObject({ key: CLIPBOARD_HINT_KEY, priority: "immediate", timeoutMs: CLIPBOARD_HINT_TIMEOUT_MS });
    } finally { vi.useRealTimers(); unmount(); }
  });
});

// The poster census, kept honest the same way `keys-acceptance.test.tsx` keeps hardcoded chords honest:
// read the SOURCE off disk and count, rather than trust the comment's own prose.
describe("Footer.tsx's poster census (I6)", () => {
  it("names the ambient clipboard hint, and NINE is the real grep count over ChatComposer + ChatApp", () => {
    const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
    const count = (text: string) => (text.match(/priority: "immediate"/g) ?? []).length;
    const total = count(src("../../src/tui/ChatComposer.tsx")) + count(src("../../src/tui/ChatApp.tsx"));
    expect(total).toBe(9);
    const footerSrc = src("../../src/tui/Footer.tsx");
    expect(footerSrc).toContain("NINE surfaces post");
    expect(footerSrc).toContain("image-in-clipboard hint");
  });
});
