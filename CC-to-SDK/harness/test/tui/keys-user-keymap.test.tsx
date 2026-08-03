// tui/test/keys-user-keymap.test.tsx — the live wiring of `~/.claude/keybindings.json` into the running keymap
// (F2 task 9): `<UserKeymap>` loads the file once, renders `<KeymapProvider>` under it, and re-sets the layers
// from the watcher so an edit reaches the NEXT keypress with no restart. `load`/`watch` are injected here, so
// nothing in this file goes near the real home directory or the real filesystem.
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { Text } from "ink";
import { render } from "ink-testing-library";
import { UserKeymap } from "../../src/tui/keys/UserKeymap.js";
import { useKeyActions, useKeyScope } from "../../src/tui/keys/KeymapProvider.js";
import type { BindingIssue, UserBindingsResult } from "../../src/tui/keys/userBindings.js";
import type { KeyEvent } from "../../src/tui/keys/types.js";

const tick = (): Promise<void> => new Promise((r) => { setTimeout(r, 0); });
const ESC = "\x1b";

function Probe({ actions }: { actions: Record<string, (e: KeyEvent) => void> }) {
  useKeyScope("Chat");
  useKeyActions(actions);
  return <Text>probe</Text>;
}
const result = (layers: UserBindingsResult["layers"], issues: BindingIssue[] = []): UserBindingsResult => ({ layers, issues });
/** A `watch` fake that hands the reload callback back to the test, and records that stop() ran. */
function fakeWatch() {
  const state = { push: undefined as undefined | ((r: UserBindingsResult) => void), stopped: 0, files: [] as string[] };
  const watch = (file: string, onChange: (r: UserBindingsResult) => void) => {
    state.files.push(file); state.push = onChange;
    return () => { state.stopped += 1; };
  };
  return { state, watch };
}

describe("<UserKeymap>", () => {
  it("applies the loaded user layers to the very first keypress", async () => {
    const cancel = vi.fn(), clear = vi.fn();
    const { watch } = fakeWatch();
    const h = render(
      <UserKeymap file="/fake/keybindings.json" deps={{ load: () => result([{ context: "Chat", bindings: { escape: "chat:clearInput" } }]), watch }}>
        <Probe actions={{ "chat:cancel": cancel, "chat:clearInput": clear }} />
      </UserKeymap>,
    );
    await tick();
    h.stdin.write(ESC);
    expect(clear).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();                       // the default escape → chat:cancel was overridden
    h.unmount();
  });

  it("a reload rebinds the LIVE table — the next keypress uses the edited file", async () => {
    const cancel = vi.fn(), clear = vi.fn();
    const { state, watch } = fakeWatch();
    const h = render(
      <UserKeymap file="/fake/keybindings.json" deps={{ load: () => result([{ context: "Chat", bindings: { escape: "chat:clearInput" } }]), watch }}>
        <Probe actions={{ "chat:cancel": cancel, "chat:clearInput": clear }} />
      </UserKeymap>,
    );
    await tick();
    h.stdin.write(ESC);
    expect(clear).toHaveBeenCalledTimes(1);
    state.push!(result([]));                                     // the user deleted their override
    await tick();
    h.stdin.write(ESC);
    expect(cancel).toHaveBeenCalledTimes(1);                     // the default is back, live
    expect(clear).toHaveBeenCalledTimes(1);
    h.unmount();
  });

  it("reports the startup file's issues once, and every reload's issues after that", async () => {
    const onIssues = vi.fn();
    const { state, watch } = fakeWatch();
    const startup: BindingIssue[] = [{ type: "invalid_action", detail: "Chat \"alt+q\": nope" }];
    const h = render(
      <UserKeymap file="/fake/keybindings.json" onIssues={onIssues} deps={{ load: () => result([], startup), watch }}>
        <Probe actions={{}} />
      </UserKeymap>,
    );
    await tick();
    expect(onIssues).toHaveBeenCalledTimes(1);
    expect(onIssues.mock.calls[0][0]).toEqual(startup);
    const reload: BindingIssue[] = [{ type: "reserved", detail: "Chat \"ctrl+c\": reserved" }];
    state.push!(result([], reload));
    await tick();
    expect(onIssues).toHaveBeenCalledTimes(2);
    expect(onIssues.mock.calls[1][0]).toEqual(reload);
    h.unmount();
  });

  it("says nothing when the file is clean", async () => {
    const onIssues = vi.fn();
    const { state, watch } = fakeWatch();
    const h = render(
      <UserKeymap file="/fake/keybindings.json" onIssues={onIssues} deps={{ load: () => result([]), watch }}><Probe actions={{}} /></UserKeymap>,
    );
    await tick();
    state.push!(result([]));
    await tick();
    expect(onIssues).not.toHaveBeenCalled();
    h.unmount();
  });

  it("watches the file it was given, and stops watching on unmount", async () => {
    const { state, watch } = fakeWatch();
    const h = render(
      <UserKeymap file="/fake/keybindings.json" deps={{ load: () => result([]), watch }}><Probe actions={{}} /></UserKeymap>,
    );
    await tick();
    expect(state.files).toEqual(["/fake/keybindings.json"]);
    expect(state.stopped).toBe(0);
    h.unmount();
    await tick();
    expect(state.stopped).toBe(1);
  });
});
