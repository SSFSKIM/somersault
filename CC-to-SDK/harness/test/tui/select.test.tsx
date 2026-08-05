// tui/test/select.test.tsx — the `Select` primitive (F6 T1), the component every later F6 dialog embeds.
// The expectations are transcriptions of 2.1.220's `ZJs` (L397019), its row wrapper `eg`/`Fae` (L396317) and
// gutter `uJs` (L396391), its input row `RLe` (L396465) and its key handler `DJs` (L396669) — the bundle line
// sits on the assertion it produced. Colour claims read the RAW SGR frame, because a colour IS the state
// here (focused vs current vs disabled) and nothing else in the frame says which is which.
import React from "react";
import { describe, it, expect } from "vitest";
import { renderWithKeymap as render, tick } from "./keysTestUtil.js";
import { POINTER, Select, type SelectOption } from "../../src/tui/select/Select.js";

const SUGGESTION = "\x1b[38;2;177;185;249m";                 // dark theme `suggestion` (theme.ts)
const SUCCESS = "\x1b[38;2;78;186;101m";                     // dark theme `success`
const INACTIVE = "\x1b[38;2;153;153;153m";                   // dark theme `inactive`

const frame = (f: () => string | undefined) => f() ?? "";
async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) { await tick(); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}
const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
/** Which rendered row carries the ❯ cursor. The gutter is the first cell of every row, so a line that starts
 *  with the pointer IS the focused row — and that is unambiguous in a way "the frame contains ❯" is not. */
const pointerRow = (s: string) => plain(s).split("\n").findIndex((l) => l.startsWith(POINTER));
const ten: SelectOption[] = Array.from({ length: 10 }, (_, i) => ({ value: `v${i + 1}`, label: `opt-${i + 1}` }));
const noop = () => {};

async function mount(ui: React.ReactElement) {
  const r = render(ui);
  await waitFor(() => frame(r.lastFrame).length > 0);
  return r;
}

describe("<Select> rows, indexes and gutter glyphs", () => {
  it("windows the list, numbers rows 1-based and ABSOLUTE, and pads to the count's width (L397241)", async () => {
    const r = await mount(<Select options={ten} onChange={noop} onCancel={noop} visibleOptionCount={5} rows={40} columns={100} />);
    const f = plain(frame(r.lastFrame));
    expect(f).toContain("1.  opt-1");            // `${n}.`.padEnd(EBt + 2), EBt = "10".length = 2
    expect(f).toContain("5.  opt-5");
    expect(f).not.toContain("opt-6");            // only five rows are visible
    r.stdin.write("\x1b[F");                     // end → select:last
    await waitFor(() => plain(frame(r.lastFrame)).includes("opt-10"));
    const scrolled = plain(frame(r.lastFrame));
    expect(scrolled).toContain("6.  opt-6");     // absolute, NOT window-relative (would be "1.")
    expect(scrolled).toContain("10. opt-10");
    expect(scrolled).not.toContain("opt-5");
  });

  it("paints ❯ on the focused row and dim ↓/↑ at whichever overflow edge exists (uJs, L396391-396424)", async () => {
    const r = await mount(<Select options={ten} onChange={noop} onCancel={noop} visibleOptionCount={5} rows={40} columns={100} />);
    expect(frame(r.lastFrame)).toContain(`${SUGGESTION}❯`);   // focused row, `suggestion`
    let f = plain(frame(r.lastFrame));
    expect(f).toContain("↓");                                  // more below → last visible row
    expect(f).not.toContain("↑");                              // nothing above yet
    r.stdin.write("\x1b[F");
    await waitFor(() => plain(frame(r.lastFrame)).includes("opt-10"));
    f = plain(frame(r.lastFrame));
    expect(f).toContain("↑");
    expect(f).not.toContain("↓");
  });

  it("clamps the visible count to the terminal height (Nbr, L397256-259)", async () => {
    const r = await mount(<Select options={ten} onChange={noop} onCancel={noop} visibleOptionCount={5} rows={12} columns={100} />);
    const f = plain(frame(r.lastFrame));
    expect(f).toContain("4.  opt-4");            // max(1, floor((12 - 8) / 1)) = 4
    expect(f).not.toContain("opt-5");
  });
});

describe("<Select> row colours", () => {
  const opts: SelectOption[] = [
    { value: "a", label: "alpha" }, { value: "b", label: "bravo" }, { value: "c", label: "charlie", disabled: true },
  ];

  it("uses success for the current value, the focus colour for the cursor row and dim for a disabled row", async () => {
    const r = await mount(<Select options={opts} onChange={noop} onCancel={noop} defaultValue="a" defaultFocusValue="b" rows={40} columns={100} />);
    const f = frame(r.lastFrame);
    expect(f).toContain(`${SUCCESS}alpha`);          // current value (L397241 `du.value === option.value`)
    expect(f).toContain(`${SUGGESTION}bravo`);       // focused
    // Ink merges the two adjacent dim runs (index column + label) into one, so the pin is on the whole run —
    // what matters is that the disabled label lives inside `\x1b[2m…\x1b[22m` and carries NO colour of its own.
    expect(f).toContain("\x1b[2m3. charlie\x1b[22m");
    expect(f).not.toContain(`${SUGGESTION}charlie`);
    expect(f).not.toContain(`${SUCCESS}charlie`);
    expect(plain(f)).toContain("✔");                 // eg's selected tick (L396371)
  });

  it("honours a caller-supplied focusColor role", async () => {
    const r = await mount(<Select options={opts} onChange={noop} onCancel={noop} focusColor="warning" rows={40} columns={100} />);
    expect(frame(r.lastFrame)).toContain("\x1b[38;2;255;193;7m❯");    // dark theme `warning`
  });

  it("bolds the highlightText match inside the label (sK_, L396984 + L397236-397238)", async () => {
    const r = await mount(<Select options={opts} onChange={noop} onCancel={noop} highlightText="rav" rows={40} columns={100} />);
    const f = frame(r.lastFrame);
    expect(f).toContain("\x1b[1mrav\x1b[22m");
    expect(plain(f)).toContain("bravo");
  });
});

describe("<Select> description layouts", () => {
  const described: SelectOption[] = [
    { value: "a", label: "alpha", description: "the first one" }, { value: "bb", label: "bb", description: "the second" },
  ];

  it("inlineDescriptions puts the description in the label's own Text, one space, dimmed (L397241)", async () => {
    const r = await mount(<Select options={described} onChange={noop} onCancel={noop} inlineDescriptions rows={40} columns={100} />);
    expect(plain(frame(r.lastFrame))).toContain("alpha the first one");
    expect(frame(r.lastFrame)).toContain("\x1b[2m the first one");    // …and it really is DIM, space included
  });

  it("leaves a `dimDescription: false` description at full brightness (L397241 `dimDescription !== !1`)", async () => {
    const bright: SelectOption[] = [{ value: "a", label: "alpha", description: "bright", dimDescription: false }];
    const r = await mount(<Select options={bright} onChange={noop} onCancel={noop} inlineDescriptions rows={40} columns={100} />);
    const f = frame(r.lastFrame);
    expect(plain(f)).toContain("alpha bright");
    expect(f).not.toContain("\x1b[2m bright");
  });

  // DIVERGENCE PIN (see the T1 report). The brief said a non-inline description goes "on its own line below";
  // the bundle puts it in `Fae`'s gap-1 ROW as a sibling of the label (L397241 children array → L396376), so
  // label and description share one rendered line. This branch is only reachable when the list holds an input
  // row — anything else with descriptions takes the two-column branch — so the fixture needs one.
  it("keeps a non-inline description on the SAME line as its label when the list holds an input row", async () => {
    const mixed: SelectOption[] = [
      { value: "a", label: "alpha", description: "desc-alpha" },
      { value: "note", label: "Note", type: "input", placeholder: "ph" },
    ];
    const r = await mount(<Select options={mixed} onChange={noop} onCancel={noop} rows={40} columns={100} />);
    const labelLine = plain(frame(r.lastFrame)).split("\n").find((l) => l.includes("alpha"))!;
    expect(labelLine).toContain("desc-alpha");
  });

  it("aligns a two-column layout when descriptions are not inline and no row is an input (L397171-397214)", async () => {
    const r = await mount(<Select options={described} onChange={noop} onCancel={noop} rows={40} columns={100} />);
    const lines = plain(frame(r.lastFrame)).split("\n").filter((l) => l.trim().length > 0);
    // labelColumn = max(2 + 3 + 5, 2 + 3 + 2) = 10 → both descriptions start at the same column.
    const at = lines.map((l) => l.indexOf("the "));
    expect(at[0]).toBeGreaterThan(0);
    expect(at[1]).toBe(at[0]);
  });
});

describe("<Select> keys", () => {
  it("moves with j/k, ctrl+n/ctrl+p and the arrows, wraps at both ends, and accepts with enter", async () => {
    const picked: string[] = [];
    const r = await mount(<Select options={ten} onChange={(v) => picked.push(v)} onCancel={noop} visibleOptionCount={5} rows={40} columns={100} />);
    r.stdin.write("j");
    await waitFor(() => frame(r.lastFrame).includes(`${SUGGESTION}❯`) && plain(frame(r.lastFrame)).includes("opt-2"));
    r.stdin.write("\x0e");                                        // ctrl+n
    await tick();
    r.stdin.write("\r");
    await waitFor(() => picked.length === 1);
    expect(picked[0]).toBe("v3");
    r.stdin.write("k");                                            // back up to v2
    await tick();
    r.stdin.write("\x1b[H");                                       // home → first
    await waitFor(() => plain(frame(r.lastFrame)).includes("opt-1"));
    r.stdin.write("k");                                            // wrap: previous from the first row → the last
    await waitFor(() => plain(frame(r.lastFrame)).includes("opt-10"));
    r.stdin.write("j");                                            // wrap the other way
    await waitFor(() => plain(frame(r.lastFrame)).includes("opt-1"));
  });

  it("pages with pageup/pagedown and cancels with escape", async () => {
    let cancelled = 0;
    const r = await mount(<Select options={ten} onChange={noop} onCancel={() => { cancelled++; }} visibleOptionCount={5} rows={40} columns={100} />);
    r.stdin.write("\x1b[6~");                                      // pagedown
    await waitFor(() => plain(frame(r.lastFrame)).includes("opt-6"));
    r.stdin.write("\x1b[5~");                                      // pageup
    await waitFor(() => plain(frame(r.lastFrame)).includes("opt-1"));
    r.stdin.write("\x1b");
    await waitFor(() => cancelled === 1);
  });

  // REGRESSION (codex review, F6 close). One stdin chunk parses into SEVERAL events and the provider
  // dispatches them with NO render between, so a handler reading its render closure saw the PRE-chunk focus:
  // `j\r` accepted the row the cursor had just left. In a permission dialog that is an approval of the wrong
  // row, which is why `Select` is ref-backed (keys/refState.ts) like `MultiSelect`.
  it("accepts the row the SAME CHUNK moved to, not the one it left (j + enter in one write)", async () => {
    const picked: string[] = [];
    const r = await mount(<Select options={ten} onChange={(v) => picked.push(v)} onCancel={noop} visibleOptionCount={5} rows={40} columns={100} />);
    r.stdin.write("j\r");
    await waitFor(() => picked.length === 1);
    expect(picked[0]).toBe("v2");
  });

  // Two movement keys in one chunk have to be ESCAPE sequences, not `jj`: parse.ts folds a printable RUN into
  // a single `text` event (a paste), so only the arrows can actually arrive twice per chunk.
  it("steps ONCE PER KEY when two movement keys share a chunk (down+down lands on row 3)", async () => {
    const picked: string[] = [];
    const r = await mount(<Select options={ten} onChange={(v) => picked.push(v)} onCancel={noop} visibleOptionCount={5} rows={40} columns={100} />);
    r.stdin.write("\x1b[B\x1b[B");
    await waitFor(() => pointerRow(frame(r.lastFrame)) === 2);
    r.stdin.write("\r");
    await waitFor(() => picked.length === 1);
    expect(picked[0]).toBe("v3");
  });

  it("submits an input row's SAME-CHUNK text, not the buffer as it was before the chunk", async () => {
    const got: [string, string | undefined][] = [];
    const opts: SelectOption[] = [{ value: "yes", label: "Yes" }, { value: "note", label: "Note", type: "input", placeholder: "ph" }];
    const r = await mount(<Select options={opts} onChange={(v, t) => got.push([v, t])} onCancel={noop} rows={40} columns={100} />);
    r.stdin.write("j");
    await waitFor(() => pointerRow(frame(r.lastFrame)) === 1);
    r.stdin.write("hello\r");                                       // text AND the submit together
    await waitFor(() => got.length === 1);
    expect(got[0]).toEqual(["note", "hello"]);
  });

  it("never accepts a disabled row (L396698)", async () => {
    const picked: string[] = [];
    const opts: SelectOption[] = [{ value: "a", label: "alpha", disabled: true }, { value: "b", label: "bravo" }];
    const r = await mount(<Select options={opts} onChange={(v) => picked.push(v)} onCancel={noop} rows={40} columns={100} />);
    r.stdin.write("\r");
    await tick();
    expect(picked).toEqual([]);
  });
});

describe("<Select> digit selection (DJs, L396765-396786)", () => {
  const opts: SelectOption[] = [
    { value: "a", label: "alpha" }, { value: "b", label: "bravo", disabled: true }, { value: "c", label: "charlie" },
  ];

  it("selects at the 1-based ABSOLUTE index", async () => {
    const picked: string[] = [];
    const r = await mount(<Select options={opts} onChange={(v) => picked.push(v)} onCancel={noop} rows={40} columns={100} />);
    r.stdin.write("3");
    await waitFor(() => picked.length === 1);
    expect(picked[0]).toBe("c");
  });

  it("is a dead key on a disabled row and on \"0\"", async () => {
    const picked: string[] = [];
    const r = await mount(<Select options={opts} onChange={(v) => picked.push(v)} onCancel={noop} rows={40} columns={100} />);
    r.stdin.write("2");
    await tick();
    r.stdin.write("0");
    await tick();
    r.stdin.write("9");                                             // past the end
    await tick();
    expect(picked).toEqual([]);
  });

  it("hideIndexes removes the index column AND kills digit selection — one switch (L397066)", async () => {
    const picked: string[] = [];
    const r = await mount(<Select options={opts} onChange={(v) => picked.push(v)} onCancel={noop} hideIndexes rows={40} columns={100} />);
    expect(plain(frame(r.lastFrame))).not.toContain("1.");
    r.stdin.write("3");
    await tick();
    expect(picked).toEqual([]);
  });
});

describe("<Select> onFocus (m5o, L396843-845)", () => {
  const inputFirst: SelectOption[] = [
    { value: "note", label: "Note", type: "input", placeholder: "say something" },
    { value: "b", label: "bravo" },
  ];

  it("reports the INITIAL row on mount, then each change, never the same row twice running", async () => {
    const seen: string[] = [];
    const r = await mount(<Select options={ten} onChange={noop} onCancel={noop} onFocus={(v) => seen.push(v)} rows={40} columns={100} />);
    expect(seen).toEqual(["v1"]);                     // the mount fire — upstream's effect seeds on `t[0].value`
    r.stdin.write("j"); await tick();
    expect(seen).toEqual(["v1", "v2"]);               // and no duplicate from the synchronous `moveTo` report
  });

  // The reason the mount fire is required rather than nice: an embedding dialog gates its letter shortcuts on
  // "is a text row focused" (BashPermission), and a list whose FIRST row is a text row would otherwise leave
  // them live over the field until the user happened to move.
  it("reports a first row that is a TEXT row before any key is pressed", async () => {
    const seen: string[] = [];
    await mount(<Select options={inputFirst} onChange={noop} onCancel={noop} onFocus={(v) => seen.push(v)} rows={40} columns={100} />);
    expect(seen).toEqual(["note"]);
    expect(inputFirst.find((o) => o.value === seen[0])?.type).toBe("input");
  });
});

describe("<Select> input rows (RLe, L396465-396652)", () => {
  const withInput = (over: Partial<SelectOption> = {}): SelectOption[] => [
    { value: "yes", label: "Yes" },
    { value: "note", label: "Note", type: "input", placeholder: "say something", ...over },
  ];

  it("renders an unfocused empty input row as its placeholder in the inactive colour (L396612)", async () => {
    const r = await mount(<Select options={withInput()} onChange={noop} onCancel={noop} rows={40} columns={100} />);
    const f = frame(r.lastFrame);
    expect(plain(f)).toContain("say something");
    expect(f).toContain(`${INACTIVE}say something`);
  });

  it("renders an unfocused input row that has a value as `label, sep, value` when showLabelWithValue", async () => {
    const r = await mount(<Select options={withInput({ showLabelWithValue: true, initialValue: "hi there" })} onChange={noop} onCancel={noop} rows={40} columns={100} />);
    expect(plain(frame(r.lastFrame))).toContain("Note, hi there");
  });

  it("types into the focused row instead of navigating, and leaves it with down/ctrl+n (L396717-396749)", async () => {
    const r = await mount(<Select options={withInput()} onChange={noop} onCancel={noop} rows={40} columns={100} />);
    r.stdin.write("j");                                             // move onto the input row (still a nav key here)
    await waitFor(() => pointerRow(frame(r.lastFrame)) === 1);
    r.stdin.write("jk");                                            // the very same keys are literal text now
    await waitFor(() => plain(frame(r.lastFrame)).includes("jk"));
    expect(pointerRow(frame(r.lastFrame))).toBe(1);                 // …and they did NOT move the cursor
    r.stdin.write("\x7f");                                          // backspace
    await waitFor(() => !plain(frame(r.lastFrame)).includes("jk"));
    r.stdin.write("\x1b[A");                                        // up DOES still leave the row (L396738)
    await waitFor(() => pointerRow(frame(r.lastFrame)) === 0);
  });

  it("submits the option WITH its text on enter (L397229-397230)", async () => {
    const got: [string, string | undefined][] = [];
    const r = await mount(<Select options={withInput()} onChange={(v, t) => got.push([v, t])} onCancel={noop} rows={40} columns={100} />);
    r.stdin.write("j");                                             // still a nav key on a non-input row
    await waitFor(() => pointerRow(frame(r.lastFrame)) === 1);
    r.stdin.write("done");
    await waitFor(() => plain(frame(r.lastFrame)).includes("done"));
    r.stdin.write("\r");
    await waitFor(() => got.length === 1);
    expect(got[0]).toEqual(["note", "done"]);
  });

  it("an EMPTY submit cancels the whole Select — unless allowEmptySubmitToCancel, which submits empty (L397115-118)", async () => {
    let cancelled = 0;
    const got: [string, string | undefined][] = [];
    const r = await mount(<Select options={withInput()} onChange={(v, t) => got.push([v, t])} onCancel={() => { cancelled++; }} rows={40} columns={100} />);
    r.stdin.write("j");                                             // still a nav key on a non-input row
    await waitFor(() => pointerRow(frame(r.lastFrame)) === 1);
    r.stdin.write("   ");                                           // whitespace only — `.trim()` is falsy
    await tick();
    r.stdin.write("\r");
    await waitFor(() => cancelled === 1);
    expect(got).toEqual([]);

    const r2 = await mount(<Select options={withInput({ allowEmptySubmitToCancel: true })} onChange={(v, t) => got.push([v, t])} onCancel={() => { cancelled++; }} rows={40} columns={100} />);
    r2.stdin.write("j");
    await waitFor(() => pointerRow(frame(r2.lastFrame)) === 1);
    r2.stdin.write("\r");
    await waitFor(() => got.length === 1);
    expect(got[0]).toEqual(["note", ""]);
    expect(cancelled).toBe(1);
  });

  it("a digit landing on an input row focuses it when empty, and submits it when it already has text (L396772-396782)", async () => {
    const got: [string, string | undefined][] = [];
    const r = await mount(<Select options={withInput()} onChange={(v, t) => got.push([v, t])} onCancel={noop} rows={40} columns={100} />);
    r.stdin.write("2");
    await waitFor(() => pointerRow(frame(r.lastFrame)) === 1);
    expect(got).toEqual([]);                                        // focused, not submitted

    const r2 = await mount(<Select options={withInput({ initialValue: "seed" })} onChange={(v, t) => got.push([v, t])} onCancel={noop} rows={40} columns={100} />);
    r2.stdin.write("2");
    await waitFor(() => got.length === 1);
    expect(got[0]).toEqual(["note", "seed"]);
  });

  // DIVERGENCE PIN (see the T1 report). `RLe` builds its number unconditionally and only zeroes the WIDTH
  // (L396593-396596 with `maxIndexWidth` = 0 from L397142), so `hideIndexes` leaves a bare `2.` on an input
  // row while stripping the column everywhere else. Faithful to 2.1.220, and pinned so it is not "fixed".
  it("still numbers an input row under hideIndexes — upstream only zeroes the column WIDTH", async () => {
    const r = await mount(<Select options={withInput()} onChange={noop} onCancel={noop} hideIndexes rows={40} columns={100} />);
    const lines = plain(frame(r.lastFrame)).split("\n");
    expect(lines.find((l) => l.includes("Yes"))).not.toContain("1.");     // the plain row loses its index…
    expect(lines.find((l) => l.includes("say something"))).toContain("2.");  // …the input row keeps its number
  });

  // DIVERGENCE PIN (see the T1 report). The digit branch (L396765) sits BELOW `if (H) { … return }`
  // (L396717-396749), so with an input row focused a digit is text, never a selection.
  it("types a digit into a focused input row instead of selecting — no onChange at all", async () => {
    const got: [string, string | undefined][] = [];
    const r = await mount(<Select options={withInput()} onChange={(v, t) => got.push([v, t])} onCancel={noop} rows={40} columns={100} />);
    r.stdin.write("j");
    await waitFor(() => pointerRow(frame(r.lastFrame)) === 1);
    r.stdin.write("1");                                             // would have selected row 1 on any other row
    await waitFor(() => plain(frame(r.lastFrame)).includes("1"));
    expect(got).toEqual([]);
    expect(pointerRow(frame(r.lastFrame))).toBe(1);                 // still on the input row
    r.stdin.write("\r");                                            // and the digit really did land in the text
    await waitFor(() => got.length === 1);
    expect(got[0]).toEqual(["note", "1"]);
  });

  it("tab fires onInputModeToggle with the focused value (L396712-396715)", async () => {
    const toggled: string[] = [];
    const r = await mount(<Select options={withInput()} onChange={noop} onCancel={noop} onInputModeToggle={(v) => toggled.push(v)} rows={40} columns={100} />);
    r.stdin.write("\t");
    await waitFor(() => toggled.length === 1);
    expect(toggled[0]).toBe("yes");
  });
});
