// test/tui/settingsRows.test.ts — TDD Step 1 (Wave 3 task 5): the pure row/search/summary model behind
// the /config Settings dialog's Config tab. No React/Ink here — settingsRows.ts is plain data shaping,
// exactly like commands.ts's own formatters.
import { describe, it, expect } from "vitest";
import { buildRows, filterRows, cycleEnum, summarizeChanges, THINKING_WARNING, type SettingsRowCtx } from "../../src/tui/settingsRows.js";

const BASE_CTX: SettingsRowCtx = { theme: "dark", model: "claude-opus-4-8", outputStyle: "default", mode: "default", thinkLevel: "off", showTurnDuration: true, reduceMotion: false, promptSuggestionEnabled: false, progressBar: true, copyOnSelect: true };

describe("settingsRows.ts", () => {
  it("buildRows returns the 10 rows in the pinned order, copyOnSelect last below promptSuggestionEnabled", () => {
    const rows = buildRows(BASE_CTX);
    expect(rows.map((r) => r.id)).toEqual(["theme", "model", "outputStyle", "permissionMode", "thinking", "showTurnDuration", "reduceMotion", "progressBar", "promptSuggestionEnabled", "copyOnSelect"]);
  });

  // F9 T-MOUSE Task 7 — the `copyOnSelect` row itself: default TRUE (canon's own polarity, research
  // r1-mouse.md §2.5), label "Copy on select", a plain boolean row like every other setting here.
  it("the copyOnSelect row is present, boolean, and defaults to true", () => {
    const rows = buildRows(BASE_CTX);
    const row = rows.find((r) => r.id === "copyOnSelect")!;
    expect(row).toBeDefined();
    expect(row.label).toBe("Copy on select");
    expect(row.type).toBe("boolean");
    expect(row.value).toBe("true");
    const off = buildRows({ ...BASE_CTX, copyOnSelect: false }).find((r) => r.id === "copyOnSelect")!;
    expect(off.value).toBe("false");
  });

  it("row labels + hints match the Global Constraints table (theme/model carry a hint, the rest don't)", () => {
    const rows = buildRows(BASE_CTX);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId.theme.label).toBe("Theme");
    expect(byId.theme.hint).toBe("For custom themes, use /theme.");
    expect(byId.model.label).toBe("Model");
    expect(byId.model.hint).toBe("For a specific model ID, use /model.");
    expect(byId.outputStyle.label).toBe("Output style");
    expect(byId.outputStyle.hint).toBeUndefined();
    expect(byId.permissionMode.label).toBe("Default permission mode");
    expect(byId.permissionMode.hint).toBeUndefined();
    expect(byId.thinking.label).toBe("Thinking mode");
    expect(byId.thinking.hint).toBeUndefined();
    expect(byId.showTurnDuration.label).toBe("Show turn duration");
    expect(byId.showTurnDuration.hint).toBeUndefined();
    expect(byId.reduceMotion.label).toBe("Reduce motion");
    expect(byId.reduceMotion.hint).toBeUndefined();
    expect(byId.promptSuggestionEnabled.label).toBe("Prompt suggestions");
    expect(byId.promptSuggestionEnabled.hint).toBeUndefined();
  });

  it("display values: theme/outputStyle/permissionMode echo ctx verbatim, model shows the live id when set", () => {
    const rows = buildRows(BASE_CTX);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId.theme.value).toBe("dark");
    expect(byId.model.value).toBe("claude-opus-4-8");
    expect(byId.outputStyle.value).toBe("default");
    expect(byId.permissionMode.value).toBe("default");
  });

  it("an unset model displays 'Default (recommended)'", () => {
    const rows = buildRows({ ...BASE_CTX, model: undefined });
    expect(rows.find((r) => r.id === "model")!.value).toBe("Default (recommended)");
  });

  it("thinking is a boolean row: 'true' whenever thinkLevel isn't 'off', 'false' when it is", () => {
    expect(buildRows({ ...BASE_CTX, thinkLevel: "off" }).find((r) => r.id === "thinking")!.value).toBe("false");
    expect(buildRows({ ...BASE_CTX, thinkLevel: "default" }).find((r) => r.id === "thinking")!.value).toBe("true");
    expect(buildRows({ ...BASE_CTX, thinkLevel: "high" }).find((r) => r.id === "thinking")!.value).toBe("true");
  });

  // WAVE C TASK 7 (EP-C4d). Upstream's own row, under upstream's own label — the shipped client's `/config`
  // lists `Show turn duration` ungated (`docs/parity/qa-findings/frames-qa4/qa4-settings-cc.txt:24`).
  it("showTurnDuration is a boolean row echoing the pref, which defaults TRUE", () => {
    expect(buildRows(BASE_CTX).find((r) => r.id === "showTurnDuration")!.type).toBe("boolean");
    expect(buildRows(BASE_CTX).find((r) => r.id === "showTurnDuration")!.value).toBe("true");
    expect(buildRows({ ...BASE_CTX, showTurnDuration: false }).find((r) => r.id === "showTurnDuration")!.value).toBe("false");
  });

  // F8 TASK 6. Canon's own id and label, character for character (bundle L383488), riding
  // `showTurnDuration`'s exact shape one row below it — DEFAULT FALSE, canon's own polarity (`?? !1`).
  it("reduceMotion is a boolean row echoing the pref, which defaults FALSE", () => {
    expect(buildRows(BASE_CTX).find((r) => r.id === "reduceMotion")!.type).toBe("boolean");
    expect(buildRows(BASE_CTX).find((r) => r.id === "reduceMotion")!.value).toBe("false");
    expect(buildRows({ ...BASE_CTX, reduceMotion: true }).find((r) => r.id === "reduceMotion")!.value).toBe("true");
  });

  // T-CH34. Canon's own id and label, character for character (bundle L383525-383526: `{ id: "progressBar",
  // label: "Terminal progress bar", ... }`), riding `reduceMotion`'s exact shape one row below it — DEFAULT
  // TRUE, canon's own polarity (`Vd("terminalProgressBarEnabled", !0)`, L563441).
  it("progressBar is a boolean row echoing the pref, which defaults TRUE", () => {
    expect(buildRows(BASE_CTX).find((r) => r.id === "progressBar")!.type).toBe("boolean");
    expect(buildRows(BASE_CTX).find((r) => r.id === "progressBar")!.label).toBe("Terminal progress bar");
    expect(buildRows(BASE_CTX).find((r) => r.id === "progressBar")!.value).toBe("true");
    expect(buildRows({ ...BASE_CTX, progressBar: false }).find((r) => r.id === "progressBar")!.value).toBe("false");
  });

  // WAVE C TASK 12 (EP-C5). Upstream's own id and label (bundle L315485), label-only there and here — but
  // ccx's DEFAULT is the opposite one: upstream's schema is absent-means-on, ours is explicit-true-means-on.
  it("promptSuggestionEnabled is a label-only boolean row echoing the pref, which defaults FALSE", () => {
    expect(buildRows(BASE_CTX).find((r) => r.id === "promptSuggestionEnabled")!.type).toBe("boolean");
    expect(buildRows(BASE_CTX).find((r) => r.id === "promptSuggestionEnabled")!.value).toBe("false");
    expect(buildRows({ ...BASE_CTX, promptSuggestionEnabled: true }).find((r) => r.id === "promptSuggestionEnabled")!.value).toBe("true");
  });

  it("permissionMode is an enum row with exactly the 4 pinned options (bypassPermissions excluded)", () => {
    const row = buildRows(BASE_CTX).find((r) => r.id === "permissionMode")!;
    expect(row.type).toBe("enum");
    expect(row.options).toEqual(["default", "acceptEdits", "plan", "auto"]);
  });

  it("theme/model/outputStyle are managedEnum rows (open a sub-dialog, not cycled in place)", () => {
    const byId = Object.fromEntries(buildRows(BASE_CTX).map((r) => [r.id, r.type]));
    expect(byId.theme).toBe("managedEnum");
    expect(byId.model).toBe("managedEnum");
    expect(byId.outputStyle).toBe("managedEnum");
  });

  it("filterRows is a case-insensitive label substring match", () => {
    const rows = buildRows(BASE_CTX);
    expect(filterRows(rows, "THEME").map((r) => r.id)).toEqual(["theme"]);
    // "mode" is also a substring of "Model" (m-o-d-e-l), so it legitimately matches 3 rows, not 2.
    expect(filterRows(rows, "mode").map((r) => r.id)).toEqual(["model", "permissionMode", "thinking"]);
    expect(filterRows(rows, "duration").map((r) => r.id)).toEqual(["showTurnDuration"]);
    expect(filterRows(rows, "permission").map((r) => r.id)).toEqual(["permissionMode"]);
    expect(filterRows(rows, "zzz")).toEqual([]);
    expect(filterRows(rows, "")).toEqual(rows);
  });

  it("cycleEnum returns the next option and wraps past the last back to the first", () => {
    const row = buildRows(BASE_CTX).find((r) => r.id === "permissionMode")!;
    expect(cycleEnum(row)).toBe("acceptEdits");
    expect(cycleEnum({ ...row, value: "acceptEdits" })).toBe("plan");
    expect(cycleEnum({ ...row, value: "plan" })).toBe("auto");
    expect(cycleEnum({ ...row, value: "auto" })).toBe("default");   // wrap
  });

  it("cycleEnum on a row with no options is a harmless no-op (returns the current value)", () => {
    const row = buildRows(BASE_CTX).find((r) => r.id === "theme")!;   // managedEnum, no `options`
    expect(cycleEnum(row)).toBe(row.value);
  });

  it("summarizeChanges formats exactly 'Set Theme to dark' with a bold value segment, in Map insertion order", () => {
    const changes = new Map([["Theme", "dark"]]);
    const lines = summarizeChanges(changes);
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe("Set Theme to dark");
    expect(lines[0].segments).toEqual([{ text: "Set Theme to " }, { text: "dark", bold: true }]);
  });

  it("summarizeChanges on an empty map returns []", () => {
    expect(summarizeChanges(new Map())).toEqual([]);
  });

  it("summarizeChanges renders one line per entry, in insertion order", () => {
    const changes = new Map([["Theme", "dark"], ["Thinking mode", "false"]]);
    const lines = summarizeChanges(changes);
    expect(lines.map((l) => l.text)).toEqual(["Set Theme to dark", "Set Thinking mode to false"]);
  });

  it("THINKING_WARNING is the exact pinned copy", () => {
    expect(THINKING_WARNING).toBe("Changing thinking mode mid-conversation will increase latency and may reduce quality.");
  });
});
