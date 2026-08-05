// tui/test/multiselect.test.tsx — the `MultiSelect` primitive (F6 T2). Expectations are transcriptions of
// 2.1.220's `V3`/`mQs` (L397428/L397448, the render) and `tQs` (L397306, the state + key handler); the bundle
// line sits on the assertion it produced. Colour and weight claims read the RAW SGR frame, because "selected"
// (success) vs "focused" (suggestion) vs "the submit row" (bold) are attributes and nothing else in the frame
// distinguishes them.
import React from "react";
import { describe, it, expect } from "vitest";
import { renderWithKeymap as render, tick } from "./keysTestUtil.js";
import { MultiSelect } from "../../src/tui/select/MultiSelect.js";
import { POINTER, type SelectOption } from "../../src/tui/select/Select.js";

const SUGGESTION = "\x1b[38;2;177;185;249m";                 // dark theme `suggestion` (theme.ts)
const SUCCESS = "\x1b[38;2;78;186;101m";                     // dark theme `success`
const INACTIVE = "\x1b[38;2;153;153;153m";                   // dark theme `inactive`

const frame = (f: () => string | undefined) => f() ?? "";
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) { await tick(); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
/** Which rendered row carries the ❯ cursor — the gutter is the first cell of every row, submit row included. */
const pointerRow = (s: string) => plain(s).split("\n").findIndex((l) => l.startsWith(POINTER));

const THREE: SelectOption[] = [{ value: "a", label: "alpha" }, { value: "b", label: "bravo" }, { value: "c", label: "charlie" }];
const OTHER: SelectOption = { value: "__other__", label: "Other", type: "input", placeholder: "Type something" };

/** The controlled shape every caller uses: the host owns the `Set` and mutates it from `onToggle`. */
function Harness({ options = THREE, submitButtonText = "Submit", initial = [], onSubmit = () => {}, onCancel = () => {}, onValues, onText, rows = 40, visibleOptionCount }: {
  options?: SelectOption[]; submitButtonText?: string; initial?: string[];
  onSubmit?: () => void; onCancel?: () => void; onValues?: (v: string[]) => void; onText?: (v: string, t: string) => void;
  rows?: number; visibleOptionCount?: number;
}) {
  const [values, setValues] = React.useState<ReadonlySet<string>>(new Set(initial));
  const toggle = (v: string) => setValues((prev) => {
    const next = new Set(prev);
    next.has(v) ? next.delete(v) : next.add(v);
    onValues?.([...next]);
    return next;
  });
  return (
    <MultiSelect options={options} values={values} onToggle={toggle} onSubmit={onSubmit} onCancel={onCancel}
      submitButtonText={submitButtonText} onInputChange={onText} rows={rows} visibleOptionCount={visibleOptionCount} />
  );
}
async function mount(ui: React.ReactElement) {
  const r = render(ui);
  await waitFor(() => frame(r.lastFrame).length > 0);
  return r;
}

describe("<MultiSelect> rows and the submit row (mQs, L397470-397505)", () => {
  it("numbers rows 1-based and absolute, boxes each one, and paints the selected box in success", async () => {
    const r = await mount(<Harness initial={["b"]} />);
    const f = frame(r.lastFrame);
    expect(plain(f)).toContain("1. [ ] alpha");
    expect(f).toContain(`${SUCCESS}[✔]`);                    // the CHECKED box carries the colour (L397489)
    expect(f).toContain(`${SUGGESTION}❯`);                   // focused gutter, `suggestion`
    expect(f).toContain(`${SUGGESTION}alpha`);               // …and the focused LABEL with it
    expect(plain(f)).not.toContain("[x]");                   // upstream boxes a `Ge.tick`, not an "x"
  });

  it("ends in a bold submit row at marginLeft 3 whose pointer only lights when it is focused (L397499)", async () => {
    const r = await mount(<Harness />);
    expect(frame(r.lastFrame)).toContain("\x1b[1mSubmit\x1b[22m");
    expect(plain(frame(r.lastFrame))).toContain("     Submit");   // gutter + gap(1) + marginLeft(3)
    expect(pointerRow(frame(r.lastFrame))).toBe(0);               // still on alpha
  });

  it("renders a description on its OWN line, indented 2, in `inactive` (eg, L396382)", async () => {
    const r = await mount(<Harness options={[{ value: "a", label: "alpha", description: "the first one" }]} />);
    const f = frame(r.lastFrame);
    expect(f).toContain(`${INACTIVE}the first one`);
    const lines = plain(f).split("\n");
    expect(lines[0]).toContain("alpha");
    expect(lines[1]).toBe("  the first one");
  });

  it("windows the list and shows the overflow arrows (Nbr + uJs, shared with Select)", async () => {
    const ten: SelectOption[] = Array.from({ length: 10 }, (_, i) => ({ value: `v${i + 1}`, label: `opt-${i + 1}` }));
    const r = await mount(<Harness options={ten} visibleOptionCount={3} />);
    let f = plain(frame(r.lastFrame));
    expect(f).toContain("1. [ ] opt-1");
    expect(f).not.toContain("opt-4");
    expect(f).toContain("↓");
    expect(f).not.toContain("↑");
    r.stdin.write("\x1b[6~");                                     // pagedown
    await waitFor(() => plain(frame(r.lastFrame)).includes("opt-4"));
    f = plain(frame(r.lastFrame));
    expect(f).toContain("4. [ ] opt-4");                          // absolute, not window-relative
    expect(f).toContain("↑");
  });
});

describe("<MultiSelect> toggling (tQs, L397399-397415)", () => {
  it("space toggles the focused row, and so does enter while a submit row exists", async () => {
    const seen: string[][] = [];
    const r = await mount(<Harness onValues={(v) => seen.push(v)} />);
    r.stdin.write(" ");
    await waitFor(() => seen.length === 1);
    expect(seen[0]).toEqual(["a"]);
    r.stdin.write("\x1b[B");                                      // ↓ to bravo
    await waitFor(() => pointerRow(frame(r.lastFrame)) === 1);
    r.stdin.write("\r");                                          // enter TOGGLES here — it does not submit
    await waitFor(() => seen.length === 2);
    expect(seen[1]).toEqual(["a", "b"]);
    r.stdin.write(" ");                                           // …and toggles back off
    await waitFor(() => seen.length === 3);
    expect(seen[2]).toEqual(["a"]);
  });

  it("enter SUBMITS instead when there is no submitButtonText at all, while space still toggles (L397405)", async () => {
    let submits = 0;
    const seen: string[][] = [];
    const r = await mount(<Harness submitButtonText="" onSubmit={() => { submits++; }} onValues={(v) => seen.push(v)} />);
    expect(plain(frame(r.lastFrame))).not.toContain("Submit");
    r.stdin.write(" ");
    await waitFor(() => seen.length === 1);
    r.stdin.write("\r");
    await waitFor(() => submits === 1);
    expect(seen).toEqual([["a"]]);                                // enter added nothing — it submitted
  });

  it("a digit toggles at the 1-based ABSOLUTE index, and is a dead key on a disabled row or past the end", async () => {
    const opts: SelectOption[] = [{ value: "a", label: "alpha" }, { value: "b", label: "bravo", disabled: true }, { value: "c", label: "charlie" }];
    const seen: string[][] = [];
    const r = await mount(<Harness options={opts} onValues={(v) => seen.push(v)} />);
    r.stdin.write("3");
    await waitFor(() => seen.length === 1);
    expect(seen[0]).toEqual(["c"]);
    expect(pointerRow(frame(r.lastFrame))).toBe(0);               // a digit toggles WITHOUT moving the cursor
    r.stdin.write("2"); await tick();                             // disabled
    r.stdin.write("0"); await tick();                             // never a target
    r.stdin.write("9"); await tick();                             // past the end
    expect(seen).toHaveLength(1);
  });

  it("escape cancels (L397418)", async () => {
    let cancelled = 0;
    const r = await mount(<Harness onCancel={() => { cancelled++; }} />);
    r.stdin.write("\x1b");
    await waitFor(() => cancelled === 1);
  });
});

describe("<MultiSelect> focus, the submit row and wrapping (L397374-397398)", () => {
  it("steps DOWN off the last option onto the submit row, submits there, and steps back UP onto the last option", async () => {
    let submits = 0;
    const r = await mount(<Harness onSubmit={() => { submits++; }} />);
    for (let i = 0; i < 3; i++) { r.stdin.write("j"); await tick(); }   // alpha → bravo → charlie → submit
    await waitFor(() => pointerRow(frame(r.lastFrame)) === 3);
    expect(frame(r.lastFrame)).toContain(`${SUGGESTION}Submit`);        // …and the label lights with it
    r.stdin.write("j"); await tick();
    expect(pointerRow(frame(r.lastFrame))).toBe(3);                     // a dead end, never a wrap to alpha
    r.stdin.write("\r");
    await waitFor(() => submits === 1);
    r.stdin.write("k");
    await waitFor(() => pointerRow(frame(r.lastFrame)) === 2);          // back onto charlie
  });

  it("space on the submit row submits too (the shared return/space branch, L397403)", async () => {
    let submits = 0;
    const seen: string[][] = [];
    const r = await mount(<Harness onSubmit={() => { submits++; }} onValues={(v) => seen.push(v)} />);
    r.stdin.write("\x1b[Z");                                            // shift+tab off the FIRST row wraps to charlie…
    await waitFor(() => pointerRow(frame(r.lastFrame)) === 2);
    r.stdin.write("\t");                                                // …and tab from the last option reaches submit
    await waitFor(() => pointerRow(frame(r.lastFrame)) === 3);
    r.stdin.write(" ");
    await waitFor(() => submits === 1);
    expect(seen).toEqual([]);
  });

  it("previous from the first row wraps to the LAST OPTION, never onto the submit row", async () => {
    const r = await mount(<Harness />);
    expect(pointerRow(frame(r.lastFrame))).toBe(0);
    r.stdin.write("k");
    await waitFor(() => pointerRow(frame(r.lastFrame)) === 2);           // charlie (row 2), not Submit (row 3)
  });
});

describe("<MultiSelect> input rows (RLe with a check-box child, L397482-397487)", () => {
  const withOther = [...THREE, OTHER];

  it("keeps digits, space and j/k as literal TEXT while the input row has the cursor (L397352-397356)", async () => {
    const seen: string[][] = [];
    const r = await mount(<Harness options={withOther} onValues={(v) => seen.push(v)} />);
    r.stdin.write("4");                                                 // toggles the Other row from a normal row
    await waitFor(() => seen.length === 1);
    expect(seen[0]).toEqual(["__other__"]);
    r.stdin.write("\x1b[B"); r.stdin.write("\x1b[B"); r.stdin.write("\x1b[B");
    await waitFor(() => pointerRow(frame(r.lastFrame)) === 3);           // now ON the input row
    r.stdin.write("j"); await tick();
    r.stdin.write("2"); await tick();
    r.stdin.write(" "); await tick();
    r.stdin.write("k"); await tick();
    await waitFor(() => plain(frame(r.lastFrame)).includes("j2 k"));
    expect(pointerRow(frame(r.lastFrame))).toBe(3);                      // nothing moved…
    expect(seen).toHaveLength(1);                                        // …and nothing else toggled
  });

  it("typing SELECTS the input row and emptying it DESELECTS it (L397325-397341)", async () => {
    const seen: string[][] = [];
    const text: string[] = [];
    const r = await mount(<Harness options={[OTHER]} onValues={(v) => seen.push(v)} onText={(_v, t) => text.push(t)} />);
    expect(frame(r.lastFrame)).toContain(`${INACTIVE}Type something`);   // unfocused-style placeholder is gone once focused…
    r.stdin.write("h");
    await waitFor(() => seen.length === 1);
    expect(seen[0]).toEqual(["__other__"]);
    expect(text).toEqual(["h"]);
    r.stdin.write("i"); await waitFor(() => text.length === 2);
    expect(seen).toHaveLength(1);                                        // still selected — no second toggle
    r.stdin.write("\x7f"); await waitFor(() => text.length === 3);       // backspace
    r.stdin.write("\x7f"); await waitFor(() => text.length === 4);       // …now empty
    expect(text[3]).toBe("");
    await waitFor(() => seen.length === 2);
    expect(seen[1]).toEqual([]);
  });

  it("enter on an input row toggles it (a submit row exists) and ctrl+enter submits (L397400-397402)", async () => {
    let submits = 0;
    const seen: string[][] = [];
    const r = await mount(<Harness options={[OTHER]} onSubmit={() => { submits++; }} onValues={(v) => seen.push(v)} />);
    r.stdin.write("\r");
    await waitFor(() => seen.length === 1);
    expect([seen[0], submits]).toEqual([["__other__"], 0]);
    r.stdin.write("\x1b[13;5u");                                         // ctrl+enter (CSI-u)
    await waitFor(() => submits === 1);
  });

  it("still leaves the row with up/down and escape (the four keys upstream lets through)", async () => {
    let cancelled = 0;
    const r = await mount(<Harness options={withOther} onCancel={() => { cancelled++; }} />);
    r.stdin.write("\x1b[B"); r.stdin.write("\x1b[B"); r.stdin.write("\x1b[B");
    await waitFor(() => pointerRow(frame(r.lastFrame)) === 3);
    r.stdin.write("\x1b[A");
    await waitFor(() => pointerRow(frame(r.lastFrame)) === 2);
    r.stdin.write("\x1b[B");
    await waitFor(() => pointerRow(frame(r.lastFrame)) === 3);
    r.stdin.write("\x1b");
    await waitFor(() => cancelled === 1);
  });
});
