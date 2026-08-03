// tui/keys/refState.ts — `useState` whose latest value is also readable SYNCHRONOUSLY (F2 task 8).
//
// WHY the dialogs need it: one raw stdin chunk parses into SEVERAL events (keys/parse.ts splits a printable
// run from the `\r` that follows it, and `\n` is its own control byte), and the provider dispatches them in a
// loop with NO render in between. A handler that reads its render closure therefore sees the value as it was
// before the earlier events of the same chunk — so a pasted `"answer\r"` would submit an empty string, and
// `"a\nb\n"` would submit twice. Ink's `useInput` never had this problem because it handed the whole chunk
// over as one string, which is exactly what the dialogs' newline-splitting was written against.
//
// ChatComposer solves the same problem with a hand-rolled `stateRef` + `commitState`; every free-text dialog
// (QuestionDialog's Other row, PlanDialog's feedback line, AddDirDialog's path, SettingsDialog's search,
// PermissionsDialog's rule entry) needs it too, so it lives here once. The setter is the ONLY writer, so the
// ref can never drift from the state it mirrors.
import { useRef, useState } from "react";

/** `[value, set, ref]` — render with `value`, branch/accumulate on `ref.current` inside a key handler. */
export function useRefState<T>(initial: T): [T, (next: T) => void, { readonly current: T }] {
  const [value, setValue] = useState(initial);
  const ref = useRef(value);
  const set = (next: T) => { ref.current = next; setValue(next); };
  return [value, set, ref];
}
