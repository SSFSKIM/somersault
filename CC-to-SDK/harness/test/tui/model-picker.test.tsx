// tui/test/model-picker.test.tsx — the /model picker rebuilt on `Select` (F6 T11, DG46). Every literal below
// is a transcription of 2.1.220's `zAe` (L440917-441174) and the confirmation at L471427; the bundle line sits
// on the assertion it produced.
import React from "react";
import { describe, it, expect } from "vitest";
import { renderWithKeymap as render, tick } from "./keysTestUtil.js";
import { ModelPicker, type ModelInfo } from "../../src/tui/ModelPicker.js";
import { MODEL_SUBTITLE, MODEL_TITLE, modelOverflowCount, modelVisibleCount, sessionOnlyLine } from "../../src/tui/modelPickerModel.js";
import { formatModelSet } from "../../src/tui/commands.js";
import { formatOverflowCount } from "../../src/tui/format.js";
import type { CcxPrefs } from "../../src/tui/prefs.js";

const frame = (f: () => string | undefined) => f() ?? "";
const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
/** Ink wraps the subtitle across lines and pads the tail of each — join on the whole run of whitespace so a
 *  literal that spans a wrap still reads as one sentence. */
const flat = (s: string) => plain(s).replace(/\s*\n\s*/g, " ");
const REMEMBER = "\x1b[38;2;177;185;249m";                   // dark theme `remember` (theme.ts)
const SUCCESS = "\x1b[38;2;78;186;101m";                     // dark theme `success`

async function waitFor(cond: () => boolean, timeout = 2000) {
  const start = Date.now();
  for (;;) { if (cond()) { await tick(); return; } if (Date.now() - start > timeout) throw new Error("waitFor timeout"); await new Promise((r) => setTimeout(r, 5)); }
}

const MODELS: ModelInfo[] = [
  { value: "opus", displayName: "Opus 5", description: "most capable" },
  { value: "sonnet", displayName: "Sonnet 4.7", description: "balanced" },
  { value: "haiku", displayName: "Haiku 4.5", description: "fastest" },
];
const many: ModelInfo[] = Array.from({ length: 14 }, (_, i) => ({ value: `m${i}`, displayName: `Model ${i}` }));

function mount(props: Partial<React.ComponentProps<typeof ModelPicker>> = {}) {
  const picked: { model: string; saveDefault: boolean }[] = [];
  const saved: Partial<CcxPrefs>[] = [];
  let cancelled = false;
  const r = render(
    <ModelPicker
      models={props.models ?? MODELS}
      {...(props.current !== undefined ? { current: props.current } : {})}
      {...(props.sessionModel !== undefined ? { sessionModel: props.sessionModel } : {})}
      onPick={(m, o) => picked.push({ model: m.value, saveDefault: o.saveDefault })}
      onCancel={() => { cancelled = true; }}
      savePrefs={(patch) => saved.push(patch)}
      rows={40} columns={100}
    />,
  );
  return { ...r, picked, saved, wasCancelled: () => cancelled };
}

describe("ModelPicker — the header block (L441096-441112)", () => {
  it("renders the bold `remember` title, the verbatim subtitle, and NO session line by default", async () => {
    const r = mount();
    await waitFor(() => frame(r.lastFrame).length > 0);
    expect(frame(r.lastFrame)).toContain(`${REMEMBER}${MODEL_TITLE}`);   // `hOH` L441096: color "remember", bold
    expect(MODEL_TITLE).toBe("Select model");
    expect(flat(frame(r.lastFrame))).toContain(MODEL_SUBTITLE);          // `Trf` L441099, verbatim
    expect(flat(frame(r.lastFrame))).not.toContain("for this session only. Selecting");
  });

  it("adds the third line ONLY under a session-only override, naming its DISPLAY name (`dva` L441107)", async () => {
    const r = mount({ sessionModel: "haiku" });
    await waitFor(() => frame(r.lastFrame).length > 0);
    expect(flat(frame(r.lastFrame))).toContain(sessionOnlyLine("Haiku 4.5"));
    expect(sessionOnlyLine("Haiku 4.5")).toBe("Currently using Haiku 4.5 for this session only. Selecting a model will undo this.");
  });
});

describe("ModelPicker — the list (L441127-441132)", () => {
  it("takes its rows from the caller's catalog, with descriptions, and never invents an id", async () => {
    const r = mount();
    await waitFor(() => frame(r.lastFrame).includes("Opus 5"));
    const f = flat(frame(r.lastFrame));
    for (const m of MODELS) { expect(f).toContain(m.displayName!); expect(f).toContain(m.description!); }
    expect(f).not.toContain("claude-");                                   // ids are the CALLER's, never hardcoded here
  });

  it("marks `current` as the value in force — success colour plus the trailing tick (jr's defaultValue)", async () => {
    const r = mount({ current: "sonnet" });
    await waitFor(() => frame(r.lastFrame).includes("Sonnet 4.7"));
    expect(frame(r.lastFrame)).toContain(`${SUCCESS}`);
    expect(plain(frame(r.lastFrame))).toContain("✔");
  });

  it("windows at TEN rows and prints the caller-level `… +N models` counter below the list (L440969/L441132)", async () => {
    expect(modelVisibleCount(14)).toBe(10);
    expect(modelOverflowCount(14)).toBe(4);
    expect(modelOverflowCount(3)).toBe(0);
    const r = mount({ models: many });
    await waitFor(() => frame(r.lastFrame).includes("Model 0"));
    const f = plain(frame(r.lastFrame));
    expect(f).toContain("Model 9");
    expect(f).not.toContain("Model 10");                                  // the eleventh row is below the window
    expect(f).toContain(formatOverflowCount(4, "model"));
    expect(formatOverflowCount(4, "model")).toBe("… +4 models");
    expect(formatOverflowCount(1, "model")).toBe("… +1 model");           // `Et` pluralization (L107148)
  });

  // WAVE S T4 (A5), a DELIBERATE DIVERGENCE (W-S11). The two assertions above are upstream's arithmetic and
  // stay as the pre-migration pin; these are ours. Upstream's `… +N models` is always `length - min(10, length)`
  // and its list has no scroll gutter at all, so at a pane too short for ten rows it names a number about
  // nothing. `Select` clamps its own window by terminal height (`clampVisible`) and publishes what it drew
  // through `onViewChange`, so the counter can simply follow it.
  it("counts what the RENDERED window left off, not the fixed cap (A5)", () => {
    expect(modelOverflowCount(14, { start: 0, end: 4 })).toBe(10);       // a window is a window, wherever it sits
    expect(modelOverflowCount(14, { start: 6, end: 10 })).toBe(10);
    expect(modelOverflowCount(14, { start: 0, end: 14 })).toBe(0);
    expect(modelOverflowCount(14)).toBe(4);                              // no window → upstream's fixed-cap answer
  });

  it("renders the counter from the window the Select actually reported (A5)", async () => {
    // rows:15 → `clampVisible(10, 15, 1)` = min(10, max(1, floor((15-8)/1))) = SEVEN rows on screen, not ten.
    const r = render(
      <ModelPicker models={many} onPick={() => {}} onCancel={() => {}} savePrefs={() => {}} rows={15} columns={100} />,
    );
    await waitFor(() => frame(r.lastFrame).includes("Model 0"));
    const f = plain(frame(r.lastFrame));
    const shown = f.split("\n").filter((l) => /Model \d/.test(l)).length;
    expect(shown).toBe(7);                                               // the pane's answer, not the cap's
    expect(f).toContain(formatOverflowCount(many.length - shown, "model"));
    expect(f).not.toContain(formatOverflowCount(4, "model"));            // the fixed cap's answer, wrong for this pane
  });

  it("prints no counter at all when everything fits (bM returns null at count <= 0, L421395)", async () => {
    const r = mount();
    await waitFor(() => frame(r.lastFrame).includes("Opus 5"));
    expect(plain(frame(r.lastFrame))).not.toContain("… +");
  });
});

describe("ModelPicker — Enter vs `s`, the whole point of the surface (DG46)", () => {
  it("Enter applies AND writes the default: savePrefs({model}) with the CATALOG value, then onPick(saveDefault)", async () => {
    const r = mount();
    await waitFor(() => frame(r.lastFrame).includes("Opus 5"));
    r.stdin.write("\x1b[B");                                              // ↓ to Sonnet
    await waitFor(() => plain(frame(r.lastFrame)).includes("❯ Sonnet 4.7") || plain(frame(r.lastFrame)).includes("❯ 2. Sonnet 4.7"));
    r.stdin.write("\r");
    await waitFor(() => r.picked.length > 0);
    expect(r.picked).toEqual([{ model: "sonnet", saveDefault: true }]);
    expect(r.saved).toEqual([{ model: "sonnet" }]);                       // `Dcn` L315170's ccx-side twin
  });

  it("`s` applies the FOCUSED row for this session only — no prefs write at all (L441070)", async () => {
    const r = mount();
    await waitFor(() => frame(r.lastFrame).includes("Opus 5"));
    r.stdin.write("\x1b[B"); r.stdin.write("\x1b[B");                     // ↓↓ to Haiku
    await waitFor(() => plain(frame(r.lastFrame)).includes("❯ 3. Haiku 4.5"));
    r.stdin.write("s");
    await waitFor(() => r.picked.length > 0);
    expect(r.picked).toEqual([{ model: "haiku", saveDefault: false }]);
    expect(r.saved).toEqual([]);
  });

  // REGRESSION (codex review, F6 close). ↓ and `s` in ONE stdin chunk dispatch back to back with no render
  // guaranteed in between, and `s` read its focus from the render closure — so it could apply the model the
  // cursor had just left. The focus is ref-backed now (keys/refState.ts, the house law MultiSelect follows).
  it("`s` in the SAME CHUNK as a move applies the row the move landed on", async () => {
    const r = mount();
    await waitFor(() => frame(r.lastFrame).includes("Opus 5"));
    r.stdin.write("\x1b[Bs");                                             // ↓ and `s` together
    await waitFor(() => r.picked.length > 0);
    expect(r.picked).toEqual([{ model: "sonnet", saveDefault: false }]);
    expect(r.saved).toEqual([]);
  });

  // The prefs write is best-effort, exactly like every other `savePrefs` caller (ChatApp's app:toggleTodos):
  // KeymapProvider does not catch action-handler exceptions, so an unwritable prefs dir would otherwise take
  // the whole REPL down on Enter (codex review, F6 close).
  it("still picks when the prefs write throws — the exception never escapes the key handler", async () => {
    const picked: { model: string; saveDefault: boolean }[] = [];
    const r = render(
      <ModelPicker
        models={MODELS} current="opus"
        onPick={(m, o) => picked.push({ model: m.value, saveDefault: o.saveDefault })}
        onCancel={() => {}}
        savePrefs={() => { throw new Error("EACCES: prefs dir is read-only"); }}
        rows={40} columns={100}
      />,
    );
    await waitFor(() => frame(r.lastFrame).includes("Opus 5"));
    r.stdin.write("\r");
    await waitFor(() => picked.length > 0);
    expect(picked).toEqual([{ model: "opus", saveDefault: true }]);
  });

  it("`s` is the ModelPicker context's key, so it never reaches the Select as a letter", async () => {
    const r = mount();
    await waitFor(() => frame(r.lastFrame).includes("Opus 5"));
    r.stdin.write("s");
    await waitFor(() => r.picked.length > 0);
    expect(r.picked[0]!.model).toBe("opus");                              // the row the cursor was on, not a search
  });

  it("Esc cancels without picking or writing anything", async () => {
    const r = mount();
    await waitFor(() => frame(r.lastFrame).includes("Opus 5"));
    r.stdin.write("\x1b");
    await waitFor(() => r.wasCancelled());
    expect(r.picked).toEqual([]);
    expect(r.saved).toEqual([]);
  });

  it("advertises both halves plus cancel in the footer (`bva` L441157)", async () => {
    const r = mount();
    await waitFor(() => frame(r.lastFrame).length > 0);
    const f = flat(frame(r.lastFrame));
    expect(f).toContain("enter to set as default");
    expect(f).toContain("s to use this session only");
    expect(f).toContain("esc to cancel");
  });

  it("an EMPTY catalog renders the header and cannot crash (useChat guards the open; the component still must)", async () => {
    const r = mount({ models: [] });
    await waitFor(() => frame(r.lastFrame).length > 0);
    expect(plain(frame(r.lastFrame))).toContain(MODEL_TITLE);
    r.stdin.write("s"); r.stdin.write("\r");
    await tick();
    expect(r.picked).toEqual([]);
    expect(r.saved).toEqual([]);
  });
});

describe("formatModelSet — the confirmation notice (L471427)", () => {
  it("says which of the two things happened, with the model name in bold", () => {
    const [saved] = formatModelSet("Opus 5", true);
    expect(saved!.segments!.map((s) => s.text).join("")).toBe("Set model to Opus 5 and saved as your default for new sessions");
    expect(saved!.segments![1]).toEqual({ text: "Opus 5", bold: true });
    const [session] = formatModelSet("Haiku 4.5", false);
    expect(session!.segments!.map((s) => s.text).join("")).toBe("Set model to Haiku 4.5 for this session only");
  });
});
