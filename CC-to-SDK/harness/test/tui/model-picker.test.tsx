// tui/test/model-picker.test.tsx — the /model picker rebuilt on `Select` (F6 T11, DG46). Every literal below
// is a transcription of 2.1.220's `zAe` (L440917-441174) and the confirmation at L471427; the bundle line sits
// on the assertion it produced.
import React from "react";
import { describe, it, expect } from "vitest";
import { renderWithKeymap as render, tick } from "./keysTestUtil.js";
import { ModelPicker, type ModelInfo } from "../../src/tui/ModelPicker.js";
import { MAX_EFFORT_CAVEAT, MODEL_FOOTER, MODEL_SUBTITLE, MODEL_TITLE, ccxDefaultModel, defaultRowDescription, effortRowText, effortUnsupportedText, modelOverflowCount, modelVisibleCount, sessionOnlyLine, withDefaultRowDescription } from "../../src/tui/modelPickerModel.js";
import { CONFIRM_CANCEL, CONFIRM_SUBTITLE, CONFIRM_TITLE, confirmAccept } from "../../src/tui/modelConfirmModel.js";
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
const WARNING = "\x1b[38;2;255;193;7m";                      // dark theme `warning` — the T12 confirm's frame
const PERMISSION = "\x1b[38;2;177;185;249m";                 // dark theme `permission` — the picker's own frame

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
  const picked: { model: string; saveDefault: boolean; confirmed?: boolean }[] = [];
  const saved: Partial<CcxPrefs>[] = [];
  let cancelled = false;
  const r = render(
    <ModelPicker
      models={props.models ?? MODELS}
      {...(props.current !== undefined ? { current: props.current } : {})}
      {...(props.sessionModel !== undefined ? { sessionModel: props.sessionModel } : {})}
      {...(props.activeModel !== undefined ? { activeModel: props.activeModel } : {})}
      {...(props.outputTokens !== undefined ? { outputTokens: props.outputTokens } : {})}
      {...(props.ackedAt !== undefined ? { ackedAt: props.ackedAt } : {})}
      {...(props.effort !== undefined ? { effort: props.effort } : {})}
      {...(props.defaultEffort !== undefined ? { defaultEffort: props.defaultEffort } : {})}
      {...(props.onEffortChange !== undefined ? { onEffortChange: props.onEffortChange } : {})}
      onPick={(m, o) => picked.push({ model: m.value, saveDefault: o.saveDefault, ...(o.confirmed ? { confirmed: true } : {}) })}
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

// WAVE C TASK 13 (EP-C8 §C8.6, `AJn` L76856). The catalog's `default` row arrives with the SDK's OWN
// description, which names the SDK's default (Sonnet 5) — a sentence that is simply false in ccx, whose
// `default` alias resolves to the opus tier (config/models.ts). Upstream's row names the model it
// CURRENTLY RESOLVES TO, so ours must name OURS.
describe("ModelPicker — the `default` row's description (§C8.6)", () => {
  // THE REAL CATALOG (t13 review finding 3), transcribed from a live `supportedModels()` run — display names,
  // descriptions and the `resolvedModel` field verbatim. The rest of this file keeps its synthetic `MODELS`
  // fixture on purpose: those tests are about geometry, focus and key handling, where a display name is an
  // arbitrary string. HERE the strings ARE the assertion — this block pins a sentence ccx renders to the user
  // — so it must be pinned against rows the engine can actually hand us. (The `sonnet` row's description is
  // the one field the review did not quote; it resolves to the same model as `default`, whose description is
  // reproduced. Nothing below reads it.)
  const LIVE: ModelInfo[] = [
    { value: "default", resolvedModel: "claude-sonnet-5", displayName: "Default (recommended)", description: "Sonnet 5 · Efficient for routine tasks" },
    { value: "opus", resolvedModel: "claude-opus-5", displayName: "Opus", description: "Opus 5 · Best for everyday, complex tasks" },
    { value: "sonnet", resolvedModel: "claude-sonnet-5", displayName: "Sonnet", description: "Sonnet 5 · Efficient for routine tasks" },
  ];
  it("rewrites it to name ccx's own resolved default, not the SDK's", async () => {
    const r = mount({ models: LIVE });
    await waitFor(() => frame(r.lastFrame).includes("Default"));
    // `Opus`, not `Opus 5`: the live row's display name is the tier word, and this is the string production
    // puts on screen. Asserted on the returned row too, because the SDK's own sentence for the default row
    // is shared with the `sonnet` row — a frame-level `not.toContain` would be pinning the wrong row.
    expect(flat(frame(r.lastFrame))).toContain(defaultRowDescription("Opus"));
    expect(defaultRowDescription("Opus")).toBe("Use the default model (currently Opus)");
    expect(withDefaultRowDescription(LIVE)[0].description).toBe("Use the default model (currently Opus)");
  });
  it("keys the sibling match off the catalog's own `resolvedModel`, not our alias table", () => {
    // A row whose VALUE our `MODEL_ALIASES` has never heard of, but which states where it points. Before the
    // fix the match ran `resolveModelAlias("opus-latest")` → the string itself → no sibling → the bare id.
    const rows = withDefaultRowDescription([LIVE[0], { value: "opus-latest", resolvedModel: "claude-opus-5", displayName: "Opus" }]);
    expect(rows[0].description).toBe(defaultRowDescription("Opus"));
  });
  it("falls back to the alias resolver for a catalog row carrying no `resolvedModel`", () => {
    const rows = withDefaultRowDescription([{ value: "default", description: "x" }, { value: "opus", displayName: "Opus 5" }]);
    expect(rows[0].description).toBe(defaultRowDescription("Opus 5"));
  });
  it("falls back to the resolved id when the catalog carries no row for it", async () => {
    const r = mount({ models: [LIVE[0], { value: "haiku", resolvedModel: "claude-haiku-4-5", displayName: "Haiku" }] });
    await waitFor(() => frame(r.lastFrame).includes("Default"));
    expect(flat(frame(r.lastFrame))).toContain(defaultRowDescription(ccxDefaultModel()));
    expect(ccxDefaultModel()).toBe("claude-opus-5");
  });
  it("leaves every other row's description alone", () => {
    const rows = withDefaultRowDescription(LIVE);
    expect(rows.slice(1)).toEqual(LIVE.slice(1));
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

// WAVE S T12 (EP-S8) — the mid-conversation cache warning, and the ORDERING it exists to fix (W-S9).
// TWO FIXTURE TRAPS this block is written around (plan review), both of which make the obvious version of
// these tests pass or fail for the wrong reason:
//  · `MODELS` above are TIER ALIASES (`opus`/`sonnet`/`haiku`), not resolved ids. `current="claude-sonnet-5"`
//    plus picking `sonnet` resolves to the SAME model, so the gate says no-confirm and the assertion tests
//    nothing. `current` here is therefore an alias the fixture actually contains, and the pick is a
//    genuinely different tier.
//  · the picker writes `savePrefs({ model: m.value })` — the RAW alias. Alias resolution happens downstream
//    in `useChat.pickModel`, so `{ model: "claude-opus-5" }` can never be the assertion; `{ model: "opus" }`
//    is.
describe("ModelPicker — the mid-conversation switch confirm (EP-S8)", () => {
  /** Open on Sonnet, move to Opus, Enter. A genuine tier change, mid-conversation. */
  async function pickOpusFromSonnet(r: ReturnType<typeof mount>) {
    await waitFor(() => frame(r.lastFrame).includes("Sonnet 4.7"));
    r.stdin.write("\x1b[A");                                              // ↑ to Opus
    await waitFor(() => plain(frame(r.lastFrame)).includes("❯ 1. Opus 5") || plain(frame(r.lastFrame)).includes("❯ Opus 5"));
    r.stdin.write("\r");
  }

  it("does not write the default-model pref when the confirm is declined (W-S9)", async () => {
    const r = mount({ current: "sonnet", outputTokens: 500 });
    await pickOpusFromSonnet(r);
    await waitFor(() => flat(frame(r.lastFrame)).includes(CONFIRM_TITLE));
    expect(flat(frame(r.lastFrame))).toContain(CONFIRM_SUBTITLE);
    expect(plain(frame(r.lastFrame))).toContain(confirmAccept("Opus 5"));  // the DISPLAY name, not the alias
    expect(plain(frame(r.lastFrame))).toContain(CONFIRM_CANCEL);
    expect(r.saved).toEqual([]);                                          // the pref must not be written BEFORE the confirm
    expect(r.picked).toEqual([]);
    r.stdin.write("\x1b");                                                // decline (Esc)
    await waitFor(() => plain(frame(r.lastFrame)).includes("most capable"));   // back to the LIST
    expect(r.saved).toEqual([]);
    expect(r.picked).toEqual([]);
    expect(r.wasCancelled()).toBe(false);                                 // declining the confirm is not cancelling the picker
  });

  it("declining via the `No, go back` row is the same path as Esc, and the SAME switch prompts again", async () => {
    const r = mount({ current: "sonnet", outputTokens: 500 });
    await pickOpusFromSonnet(r);
    await waitFor(() => flat(frame(r.lastFrame)).includes(CONFIRM_TITLE));
    r.stdin.write("\x1b[B");                                              // ↓ to `No, go back`
    await waitFor(() => plain(frame(r.lastFrame)).includes(`❯ 2. ${CONFIRM_CANCEL}`) || plain(frame(r.lastFrame)).includes(`❯ ${CONFIRM_CANCEL}`));
    r.stdin.write("\r");
    await waitFor(() => plain(frame(r.lastFrame)).includes("most capable"));
    expect(r.saved).toEqual([]); expect(r.picked).toEqual([]);
    // Nothing was stamped, so the identical pick asks again — that is condition 2 read from the other side.
    await pickOpusFromSonnet(r);
    await waitFor(() => flat(frame(r.lastFrame)).includes(CONFIRM_TITLE));
    expect(r.saved).toEqual([]);
  });

  it("switches and writes the pref when the confirm is accepted", async () => {
    const r = mount({ current: "sonnet", outputTokens: 500 });
    await pickOpusFromSonnet(r);
    await waitFor(() => flat(frame(r.lastFrame)).includes(CONFIRM_TITLE));
    r.stdin.write("\r");                                                  // the accept row is focused
    await waitFor(() => r.picked.length > 0);
    expect(r.picked).toEqual([{ model: "opus", saveDefault: true, confirmed: true }]);
    expect(r.saved).toEqual([{ model: "opus" }]);                         // the RAW alias, resolved downstream
  });

  it("does not prompt at all once the ack is stamped at this output count", async () => {
    const r = mount({ current: "sonnet", outputTokens: 500, ackedAt: 500 });
    await pickOpusFromSonnet(r);
    await waitFor(() => r.picked.length > 0);
    expect(flat(frame(r.lastFrame))).not.toContain(CONFIRM_TITLE);
    expect(r.picked).toEqual([{ model: "opus", saveDefault: true }]);      // no confirm ⇒ no stamp
    expect(r.saved).toEqual([{ model: "opus" }]);
  });

  it("does not prompt before the model has produced output — the default path is unchanged", async () => {
    const r = mount({ current: "sonnet" });                               // no outputTokens at all
    await pickOpusFromSonnet(r);
    await waitFor(() => r.picked.length > 0);
    expect(r.picked).toEqual([{ model: "opus", saveDefault: true }]);
    expect(r.saved).toEqual([{ model: "opus" }]);
  });

  it("gates the `s` (session-only) path too, and `s` is inert while the confirm is up", async () => {
    const r = mount({ current: "sonnet", outputTokens: 500 });
    await waitFor(() => frame(r.lastFrame).includes("Sonnet 4.7"));
    r.stdin.write("\x1b[A");                                              // ↑ to Opus
    await waitFor(() => plain(frame(r.lastFrame)).includes("❯ 1. Opus 5") || plain(frame(r.lastFrame)).includes("❯ Opus 5"));
    r.stdin.write("s");
    await waitFor(() => flat(frame(r.lastFrame)).includes(CONFIRM_TITLE));
    expect(r.picked).toEqual([]); expect(r.saved).toEqual([]);
    r.stdin.write("s");                                                   // the picker's own key must not re-pick behind the confirm
    await tick();
    expect(r.picked).toEqual([]);
    r.stdin.write("\r");
    await waitFor(() => r.picked.length > 0);
    expect(r.picked).toEqual([{ model: "opus", saveDefault: false, confirmed: true }]);
    expect(r.saved).toEqual([]);                                          // `s` never writes the default, confirmed or not
  });

  // RENDER PINS (review finding: deleting the whole body Box left 2967 tests green, and flipping the frame
  // role to `permission` left 36 green). The copy constants are pinned in the unit file; these two pin that
  // the component actually PUTS them on screen, and in the right colour.
  it("renders the cache sentence itself, with the target bold inside it", async () => {
    const r = mount({ current: "sonnet", outputTokens: 500 });
    await pickOpusFromSonnet(r);
    await waitFor(() => flat(frame(r.lastFrame)).includes(CONFIRM_TITLE));
    expect(flat(frame(r.lastFrame))).toContain(
      "This conversation is cached for the current model. Switching to Opus 5 means the full history gets re-read on your next message.",
    );
    expect(frame(r.lastFrame)).toContain("\x1b[1mOpus 5\x1b[22m");        // the target, BOLD, inside the sentence
  });

  it("wears the `warning` role on the frame and the title, not the picker's `permission`", async () => {
    const r = mount({ current: "sonnet", outputTokens: 500 });
    await pickOpusFromSonnet(r);
    await waitFor(() => flat(frame(r.lastFrame)).includes(CONFIRM_TITLE));
    const f = frame(r.lastFrame);
    expect(f).toContain(`${WARNING}${CONFIRM_TITLE}`);                    // the title
    const rule = f.split("\n").find((l) => l.includes("─"))!;             // DialogFrame's one horizontal rule
    expect(rule).toContain(WARNING);
    expect(rule).not.toContain(PERMISSION);                               // NOT the picker's own frame role
    // (`permission` is only absent from the FRAME here — `Select`'s focused row legitimately still wears it.)
  });

  it("compares against a session-only override when one is in force, not against the ticked row", async () => {
    // `s`-picked Opus is running; the ticked row still reads Sonnet. Re-picking Opus is not a switch.
    const r = mount({ current: "sonnet", sessionModel: "opus", outputTokens: 500 });
    await pickOpusFromSonnet(r);
    await waitFor(() => r.picked.length > 0);
    expect(flat(frame(r.lastFrame))).not.toContain(CONFIRM_TITLE);
    expect(r.picked).toEqual([{ model: "opus", saveDefault: true }]);
  });

  // Review finding 3: a session pinned to an explicit id no catalog row carries leaves `current` undefined,
  // and the gate has to fall back to the model in force instead of switching itself off.
  it("still confirms when no catalog row matched, comparing against the model in force", async () => {
    const r = mount({ activeModel: "claude-sonnet-5", outputTokens: 500 });   // NO `current` at all
    await waitFor(() => frame(r.lastFrame).includes("Opus 5"));
    r.stdin.write("\r");                                                      // the cursor opens on row 1, Opus
    await waitFor(() => flat(frame(r.lastFrame)).includes(CONFIRM_TITLE));
    expect(r.saved).toEqual([]); expect(r.picked).toEqual([]);
  });
});

// WAVE C TASK 11 (EP-C6): the effort row — `yva`, L441142 — which sits BETWEEN the list and the footer.
// The row reflects the FOCUSED catalog row's effort capability, because that is the model the picker is
// about to hand back.
//
// WAVE 2 TASK 5 (s2qa4-05/06) REWROTE THE TRANSACTION under these tests. The level is STAGED: ←/→ move a
// local value and flip a dirty bit (`lOH`, L441052), and the ONLY commit is `nvn` (L441077) — reached from
// the Select's Enter, the `s` chord, or the switch-confirm accept, and guarded on that dirty bit. Esc
// commits nothing by construction. The old pins on this describe asserted the opposite (a callback per
// keypress) and are rewritten below, not deleted: each one names what replaced it.
describe("ModelPicker — the effort row (§C6.3, L441142)", () => {
  // The Haiku row carries NO `supportsEffort` key AT ALL. That is what the live catalog returns (probe 103:
  // every model's entry has `supportsEffort: true` + `supportedEffortLevels` EXCEPT haiku, which omits both),
  // and the old fixture's hardcoded `supportsEffort: false` is exactly why a green suite coexisted with a
  // Haiku row the user could still step. Absence is the case that has to be pinned.
  const EFFORT_MODELS: ModelInfo[] = [
    { value: "opus", displayName: "Opus 5", supportsEffort: true, supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"] },
    { value: "haiku", displayName: "Haiku 4.5" },
    { value: "trim", displayName: "Trimmed", supportsEffort: true, supportedEffortLevels: ["low", "medium", "high"] },
    { value: "sonnet", displayName: "Sonnet 5", supportsEffort: true, supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"] },
  ];
  function mountEffort(props: Partial<React.ComponentProps<typeof ModelPicker>> = {}) {
    const steps: string[] = [];
    const r = mount({ models: EFFORT_MODELS, current: "opus", ...props, effort: props.effort ?? "high",
      defaultEffort: props.defaultEffort ?? "high", onEffortChange: (l) => steps.push(l) } as never);
    return { ...r, steps };
  }

  it("renders `● High effort (default) ←/→ to adjust` above the footer", async () => {
    const r = mountEffort();
    await waitFor(() => frame(r.lastFrame).includes("Opus 5"));
    const f = flat(frame(r.lastFrame));
    expect(f).toContain(effortRowText("high", true));
    expect(f.indexOf(effortRowText("high", true))).toBeLessThan(f.indexOf(MODEL_FOOTER));   // between list and footer
  });

  it("drops `(default)` when the level is not the model default, and special-cases `xHigh`", async () => {
    const r = mountEffort({ effort: "xhigh" } as never);
    await waitFor(() => frame(r.lastFrame).includes("Opus 5"));
    expect(flat(frame(r.lastFrame))).toContain("◉ xHigh effort ←/→ to adjust");
    expect(flat(frame(r.lastFrame))).not.toContain("xHigh effort (default)");
  });

  it("prints the max caveat under the row while the level is `max`", async () => {
    const r = mountEffort({ effort: "max" } as never);
    await waitFor(() => frame(r.lastFrame).includes("Opus 5"));
    expect(flat(frame(r.lastFrame))).toContain("◈ Max effort ←/→ to adjust");
    expect(flat(frame(r.lastFrame))).toContain(MAX_EFFORT_CAVEAT);
  });

  it("the FOCUSED row decides: moving onto a model without effort support swaps in the unsupported branch", async () => {
    const r = mountEffort();
    await waitFor(() => frame(r.lastFrame).includes("Opus 5"));
    r.stdin.write("\x1b[B");                                                  // down → Haiku 4.5
    await waitFor(() => flat(frame(r.lastFrame)).includes("Effort not supported"));
    expect(flat(frame(r.lastFrame))).toContain(effortUnsupportedText("Haiku 4.5"));
    expect(flat(frame(r.lastFrame))).not.toContain("←/→ to adjust");
  });

  // W2 T5 — replaces "→ and ← step the level and REPORT it". A step is now visible on the ROW and nowhere
  // else: `lOH` (L441052) writes the local value and the dirty bit, never the app-state setter. The
  // same-chunk half of the old pin survives unchanged in substance — both arrows arrive in ONE stdin write,
  // with no render in between, and the second must compute off what the first staged (`stagedRef`, which is
  // what the old `effortRef` prop bridge became).
  it("→ and ← step the ROW and report nothing; a same-chunk pair does not net one step", async () => {
    const r = mountEffort();
    await waitFor(() => frame(r.lastFrame).includes("Opus 5"));
    await tick();
    r.stdin.write("\x1b[C");
    await waitFor(() => flat(frame(r.lastFrame)).includes("xHigh effort"));
    expect(r.steps).toEqual([]);
    r.stdin.write("\x1b[D");
    await waitFor(() => flat(frame(r.lastFrame)).includes("High effort"));
    expect(r.steps).toEqual([]);
    r.stdin.write("\x1b[C\x1b[C");                                            // ONE chunk, two arrows
    await waitFor(() => flat(frame(r.lastFrame)).includes("Max effort"));     // high → xhigh → max, not one step
    expect(r.steps).toEqual([]);
  });

  it("a model with a restricted level list never steps onto one it does not support", async () => {
    const r = mountEffort({ current: "trim" } as never);
    await waitFor(() => frame(r.lastFrame).includes("Trimmed"));
    await tick();
    r.stdin.write("\x1b[C");
    await waitFor(() => flat(frame(r.lastFrame)).includes("Low effort"));     // high → wraps, `trim` stops at high
    r.stdin.write("\r");
    await waitFor(() => r.picked.length > 0);
    expect(r.steps).toEqual(["low"]);
  });

  it("an unsupported focused row makes ←/→ inert", async () => {
    const r = mountEffort();
    await waitFor(() => frame(r.lastFrame).includes("Opus 5"));
    r.stdin.write("\x1b[B");
    await waitFor(() => flat(frame(r.lastFrame)).includes("Effort not supported"));
    await tick();
    r.stdin.write("\x1b[C"); await tick();
    expect(r.steps).toEqual([]);
    // …and nothing was staged behind the unsupported row either: Enter on it commits no effort at all.
    r.stdin.write("\r");
    await waitFor(() => r.picked.length > 0);
    expect(r.steps).toEqual([]);
  });

  // ── W2 T5: THE TRANSACTION (s2qa4-05). Four commit paths and one discard, all of them `nvn`'s dirty
  // guard (L441077) read from a different side.
  it("Esc DISCARDS the staged level: nothing is committed and the row was the only thing that moved", async () => {
    const r = mountEffort();
    await waitFor(() => frame(r.lastFrame).includes("Opus 5"));
    await tick();
    r.stdin.write("\x1b[C"); await waitFor(() => flat(frame(r.lastFrame)).includes("xHigh effort"));
    r.stdin.write("\x1b[C"); await waitFor(() => flat(frame(r.lastFrame)).includes("Max effort"));
    r.stdin.write("\x1b");
    await waitFor(() => r.wasCancelled());
    expect(r.steps).toEqual([]);
    expect(r.picked).toEqual([]);
  });

  it("Enter commits the staged level ONCE, with the level the last step left", async () => {
    const r = mountEffort();
    await waitFor(() => frame(r.lastFrame).includes("Opus 5"));
    await tick();
    r.stdin.write("\x1b[C"); await waitFor(() => flat(frame(r.lastFrame)).includes("xHigh effort"));
    r.stdin.write("\x1b[C"); await waitFor(() => flat(frame(r.lastFrame)).includes("Max effort"));
    r.stdin.write("\r");
    await waitFor(() => r.picked.length > 0);
    expect(r.steps).toEqual(["max"]);                                         // once, and the FINAL level
    expect(r.picked).toEqual([{ model: "opus", saveDefault: true }]);
  });

  it("Enter with no step commits NOTHING — the dirty guard, not the equality of the values", async () => {
    const r = mountEffort();
    await waitFor(() => frame(r.lastFrame).includes("Opus 5"));
    await tick();
    r.stdin.write("\r");
    await waitFor(() => r.picked.length > 0);
    expect(r.steps).toEqual([]);
  });

  it("the `s` (session-only) chord commits the staged level too", async () => {
    const r = mountEffort();
    await waitFor(() => frame(r.lastFrame).includes("Opus 5"));
    await tick();
    r.stdin.write("\x1b[C"); await waitFor(() => flat(frame(r.lastFrame)).includes("xHigh effort"));
    r.stdin.write("s");
    await waitFor(() => r.picked.length > 0);
    expect(r.steps).toEqual(["xhigh"]);
    expect(r.picked).toEqual([{ model: "opus", saveDefault: false }]);
  });

  it("the switch confirm holds the effort with the pick: a decline commits nothing, the accept commits once", async () => {
    const r = mountEffort({ outputTokens: 500 } as never);                    // T12's gate armed
    await waitFor(() => frame(r.lastFrame).includes("Opus 5"));
    await tick();
    r.stdin.write("\x1b[C"); await waitFor(() => flat(frame(r.lastFrame)).includes("xHigh effort"));
    r.stdin.write("\x1b[B\x1b[B\x1b[B");                                      // ↓↓↓ → Sonnet 5, a real switch
    await waitFor(() => plain(frame(r.lastFrame)).includes("❯ 4. Sonnet 5") || plain(frame(r.lastFrame)).includes("❯ Sonnet 5"));
    r.stdin.write("\r");
    await waitFor(() => flat(frame(r.lastFrame)).includes(CONFIRM_TITLE));
    r.stdin.write("\x1b");                                                    // decline: back to the list
    await waitFor(() => flat(frame(r.lastFrame)).includes("xHigh effort"));
    expect(r.steps).toEqual([]);                                              // a refused switch refuses the effort with it
    expect(r.picked).toEqual([]);
    // The staging SURVIVES the decline (the Select remounts, the picker does not), so the second run through
    // the same gate commits the level that was staged before the first one.
    r.stdin.write("\x1b[B\x1b[B\x1b[B");
    await waitFor(() => plain(frame(r.lastFrame)).includes("❯ 4. Sonnet 5") || plain(frame(r.lastFrame)).includes("❯ Sonnet 5"));
    r.stdin.write("\r");
    await waitFor(() => flat(frame(r.lastFrame)).includes(CONFIRM_TITLE));
    r.stdin.write("\r");                                                      // accept
    await waitFor(() => r.picked.length > 0);
    expect(r.steps).toEqual(["xhigh"]);
    expect(r.picked).toEqual([{ model: "sonnet", saveDefault: true, confirmed: true }]);
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
