// tui/keys/UserKeymap.tsx — the live wiring between `~/.claude/keybindings.json` and the root keymap (F2 task
// 9): load once at mount, hold the parsed layers in state, and re-set them from the file watcher so an edit
// applies to the running REPL without a restart. `KeymapProvider` recompiles the table whenever `userLayers`
// changes identity, so pushing a new array IS the hot reload.
//
// It exists as its own component (rather than as code in chatMain) for one reason: the state has to sit ABOVE
// the provider, and chatMain's `runChatClient` is a one-shot async function with no render of its own to hang
// state on. Keeping it here also keeps the file-watching lifecycle testable — `load`/`watch` are injected.
//
// Issues are not swallowed and not printed: they go to `onIssues`, which chatMain routes into the transcript as
// notices. That is deliberate — the sink has to work for a RELOAD (the common case: the user is editing the file
// while ccx runs), and `console.error` into a live Ink frame would corrupt the paint.
import React, { useEffect, useRef, useState } from "react";
import { KeymapProvider, type KeymapDeps } from "./KeymapProvider.js";
import { loadUserBindings, watchUserBindings, type BindingIssue, type UserBindingsResult } from "./userBindings.js";
import type { ContextBindings } from "./bindings.js";

export interface UserKeymapDeps extends KeymapDeps {
  load?: (file: string) => UserBindingsResult;
  watch?: (file: string, onChange: (result: UserBindingsResult) => void) => () => void;
}

export function UserKeymap({ file, onIssues, deps, children }: {
  file: string;
  onIssues?: (issues: readonly BindingIssue[]) => void;
  deps?: UserKeymapDeps;
  children: React.ReactNode;
}): React.ReactElement {
  // Loaded during the FIRST render, not in an effect: the very first keypress can arrive before passive effects
  // flush, and it must already resolve against the user's table rather than the bare defaults.
  // NB for whoever makes `file` configurable: this ref-guard makes the first load once-per-MOUNT, and the effect
  // below only re-*watches* on a `file` change — a new path would keep the old file's layers and issues until its
  // first save. Re-load here (or key the component on `file`) at the same time.
  const first = useRef<UserBindingsResult>(); if (!first.current) first.current = (deps?.load ?? loadUserBindings)(file);
  const [layers, setLayers] = useState<readonly ContextBindings[]>(first.current.layers);
  const onIssuesRef = useRef(onIssues); onIssuesRef.current = onIssues;
  const depsRef = useRef(deps); depsRef.current = deps;
  // The last issue set we reported, as a signature. Autosave editors re-save on every pause, so a standing
  // warning the user has chosen to live with would otherwise append the same block to the transcript on each
  // one. A reload that CHANGES the set reports; a reload that clears it resets the memo (nothing printed), so
  // the same problem reintroduced later is announced again.
  const reportedRef = useRef("");
  useEffect(() => {
    const report = (issues: readonly BindingIssue[]) => {
      const sig = JSON.stringify(issues.map((i) => [i.type, i.detail]));
      if (sig === reportedRef.current) return;
      reportedRef.current = sig;
      if (issues.length > 0) onIssuesRef.current?.(issues);
    };
    report(first.current!.issues);                        // the startup file's problems, reported once the transcript exists
    const watch = depsRef.current?.watch ?? ((f: string, cb: (r: UserBindingsResult) => void) => watchUserBindings(f, cb));
    return watch(file, (result) => { setLayers(result.layers); report(result.issues); });
  }, [file]);
  return <KeymapProvider deps={{ ...deps, userLayers: layers }}>{children}</KeymapProvider>;
}
