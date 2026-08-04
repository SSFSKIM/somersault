// F5 task 9 — the autocomplete TRIGGER contract (when a popup opens, over what span) and the ACCEPT contract
// (Tab vs Enter, wrapping, the empty-state string). The bundle sites these pin are cited per block.
import { describe, expect, it } from "vitest";
import { applyKey, initialEditorState, setCommandCatalog, setMentionFiles, type EditorState } from "../../src/tui/editor.js";
import type { CommandEntry } from "../../src/tui/commandComplete.js";
import { COMMAND_DENYLIST, denylistedCommand, mentionInsertion, scanCommand, scanMention } from "../../src/tui/completionTriggers.js";

const type = (s: EditorState, t: string): EditorState => applyKey(s, t, {}).state;
const press = (s: EditorState, key: Record<string, boolean>): EditorState => applyKey(s, "", key).state;
const text = (s: EditorState): string => s.lines.join("\n");

const CAT: CommandEntry[] = [
  { name: "help", description: "show help", source: "local" },
  { name: "model", description: "switch model", source: "local" },
  { name: "hello-world", description: "a prompt template", argumentHint: "<name>", source: "catalog" },
  { name: "heavy", description: "no args", source: "catalog" },
];

/** Type `t` into a fresh buffer and feed the catalog in once a command popup exists (what ChatComposer does). */
function withCatalog(t: string, catalog = CAT): EditorState {
  let s = initialEditorState();
  for (const ch of t) s = type(s, ch);
  return s.command ? setCommandCatalog(s, catalog) : s;
}

describe("completionTriggers — scanners (bundle Pli L489935, ARb L491153)", () => {
  it("Pli: a whitespace-preceded mid-text '/' opens; a letter-preceded one does not", () => {
    expect(scanCommand(" /he", 4)).toEqual({ start: 1, end: 4, query: "he", head: false });
    expect(scanCommand("x/he", 4)).toBeNull();
  });
  it("Pli: the CJK boundary characters open the trigger too", () => {
    for (const b of ["。", "、", "？", "！"]) expect(scanCommand(`${b}/he`, 4), b).not.toBeNull();
  });
  it("Pli: the token is measured past the caret, and a bare mid-text '/' suggests nothing (zJa)", () => {
    expect(scanCommand(" /model", 4)).toEqual({ start: 1, end: 7, query: "model", head: false });
    expect(scanCommand(" /", 2)).toBeNull();
  });
  it("our retained head arm: a buffer-leading '/' opens with the whole name, cursor > 0", () => {
    expect(scanCommand("/mod", 4)).toEqual({ start: 0, end: 4, query: "mod", head: true });
    expect(scanCommand("/mod", 2)).toEqual({ start: 0, end: 4, query: "mod", head: true });
    expect(scanCommand("/mod", 0)).toBeNull();               // upstream's `kt > 0`
    expect(scanCommand("/mod args", 4)).toBeNull();          // a space ends the name
  });
  it("tRb: the denylist suppresses the trigger on both arms, and holds the exact six names", () => {
    expect([...COMMAND_DENYLIST].sort()).toEqual(["add-dir", "cd", "marketplace", "plugin", "plugins", "resume"]);
    expect(denylistedCommand("/resume")).toBe(true);
    expect(denylistedCommand("/resumes")).toBe(false);       // whole name, not a prefix
    expect(scanCommand("/resume", 7)).toBeNull();
    expect(scanCommand("/resume /he", 11)).toBeNull();       // the leading name suppresses the mid-text arm too
    expect(scanCommand("/resume /he", 11, "/model")).not.toBeNull();   // …and only because of the BUFFER's name
  });
  it("ARb: '@' opens at a boundary, carries full path characters, and survives a space when quoted", () => {
    expect(scanMention("@src/x", 6)).toEqual({ start: 0, end: 6, query: "src/x", quoted: false });
    expect(scanMention("see @src/x", 10)).toEqual({ start: 4, end: 10, query: "src/x", quoted: false });
    expect(scanMention("a@src", 5)).toBeNull();
    expect(scanMention("@\"my", 4)).toEqual({ start: 0, end: 4, query: "my", quoted: true });
    expect(scanMention("@\"my file", 9)).toEqual({ start: 0, end: 9, query: "my file", quoted: true });
    expect(scanMention("@\"my file\"", 10)).toEqual({ start: 0, end: 10, query: "my file", quoted: true });
  });
  it("oQa/needsQuotes: a path with a space inserts quoted", () => {
    expect(mentionInsertion("src/a.ts")).toBe("@src/a.ts ");
    expect(mentionInsertion("my docs/a.ts")).toBe("@\"my docs/a.ts\" ");
  });
});

describe("editor triggers — the scan runs per edit AND per motion", () => {
  it("mid-text ' /he' opens the popup; 'x/he' never does", () => {
    expect(withCatalog("see /he").command?.query).toBe("he");
    expect(withCatalog("seex/he").command).toBeNull();
  });
  it("a CJK boundary opens it", () => {
    expect(withCatalog("。/he").command?.query).toBe("he");
  });
  it("a leading '/resume' shows NO popup but still submits", () => {
    const s = withCatalog("/resume");
    expect(s.command).toBeNull();
    const r = applyKey(s, "", { return: true });
    expect(r.submit).toBe("/resume");
  });
  it("a leading '/mod' still opens — our retained head path", () => {
    expect(withCatalog("/mod").command?.head).toBe(true);
  });
  it("the mention survives a '/' inside the path (mid-text @, upstream's char class)", () => {
    let s = initialEditorState();
    for (const ch of "see @src") s = type(s, ch);
    s = setMentionFiles(s, ["src/app.ts", "other.ts"]);
    s = type(s, "/");
    expect(s.mention?.query).toBe("src/");
    expect(s.mention?.items[0].path).toBe("src/app.ts");
  });
  it("a cursor motion out of the token closes the popup, and back in reopens it", () => {
    let s = withCatalog("see /he");
    expect(s.command).not.toBeNull();
    s = applyKey(s, "a", { ctrl: true }).state;               // Ctrl-A → column 0, outside the token
    expect(s.command).toBeNull();
    s = applyKey(s, "e", { ctrl: true }).state;               // Ctrl-E → back to the token end
    expect(s.command?.query).toBe("he");
  });
  it("the command scan is prompt-mode only — a bash or memory line never opens it", () => {
    expect(withCatalog("!ls /tm").command).toBeNull();
    expect(withCatalog("#note the /pla").command).toBeNull();
    expect(withCatalog("note the /pla").command?.query).toBe("pla");
  });
  it("…but the @ scan is not mode-gated", () => {
    let s = initialEditorState();
    for (const ch of "!cat @a") s = type(s, ch);
    expect(s.mention).not.toBeNull();
  });
  it("Escape stays dismissed across a motion, and lifts once the text changes", () => {
    let s = withCatalog("/mod");
    s = press(s, { escape: true });
    expect(s.command).toBeNull();
    s = press(s, { leftArrow: true });
    expect(s.command).toBeNull();                             // upstream's `Se.current` latch
    s = type(s, "e");
    expect(s.command).not.toBeNull();
  });
});

describe("acceptance — Tab vs Enter (CM28: XJa L490110, Tab L490855, Enter L490989)", () => {
  const at = (s: EditorState, name: string): EditorState => {   // move the highlight onto `name`
    const i = s.command!.items.findIndex((e) => e.name === name);
    let out = s; for (let k = 0; k < i; k++) out = press(out, { downArrow: true });
    return out;
  };
  it("Tab accepts without executing", () => {
    const r = applyKey(at(withCatalog("/mod"), "model"), "", { tab: true });
    expect(r.submit).toBeUndefined();
    expect(text(r.state)).toBe("/model ");
    expect(r.state.command).toBeNull();
  });
  it("Enter on a LOCAL command submits", () => {
    const r = applyKey(at(withCatalog("/mod"), "model"), "", { return: true });
    expect(r.submit).toBe("/model");
  });
  it("Enter on a CATALOG command with an argumentHint inserts only", () => {
    const r = applyKey(at(withCatalog("/hello"), "hello-world"), "", { return: true });
    expect(r.submit).toBeUndefined();
    expect(text(r.state)).toBe("/hello-world ");
  });
  it("Enter on a CATALOG command without a hint submits", () => {
    const r = applyKey(at(withCatalog("/heav"), "heavy"), "", { return: true });
    expect(r.submit).toBe("/heavy");
  });
  it("Enter on a MID-TEXT command only inserts — upstream's mid-text path never executes", () => {
    const r = applyKey(at(withCatalog("see /mod"), "model"), "", { return: true });
    expect(r.submit).toBeUndefined();
    expect(text(r.state)).toBe("see /model ");
  });
  it("Tab on a mid-text command replaces only the token, keeping the tail", () => {
    let s = initialEditorState();
    for (const ch of "see /mod done") s = type(s, ch);
    expect(s.command).toBeNull();                             // the caret is past the token, in " done"
    for (let k = 0; k < 5; k++) s = press(s, { leftArrow: true });   // back to just after "mod"
    s = setCommandCatalog(s, CAT);
    expect(s.command?.query).toBe("mod");
    const r = applyKey(at(s, "model"), "", { tab: true });
    expect(text(r.state)).toBe("see /model  done");
  });
  it("Enter on a file mention only inserts, never submits", () => {
    let s = initialEditorState();
    for (const ch of "look @a") s = type(s, ch);
    s = setMentionFiles(s, ["a.ts"]);
    const r = applyKey(s, "", { return: true });
    expect(r.submit).toBeUndefined();
    expect(text(r.state)).toBe("look @a.ts ");
  });
  it("a mention whose path has spaces inserts the quoted form", () => {
    let s = type(initialEditorState(), "@");
    s = setMentionFiles(s, ["my docs/a.ts"]);
    const r = applyKey(s, "", { tab: true });
    expect(text(r.state)).toBe("@\"my docs/a.ts\" ");
  });
});

describe("CM29 — selection wraps both ends in both popups (bundle L491065/L491067)", () => {
  it("the command popup wraps up from the first entry and down from the last", () => {
    let s = withCatalog("/");
    expect(s.command!.items.length).toBe(4);
    s = press(s, { upArrow: true });
    expect(s.command!.index).toBe(3);
    s = press(s, { downArrow: true });
    expect(s.command!.index).toBe(0);
  });
  it("the mention popup wraps too", () => {
    let s = setMentionFiles(type(initialEditorState(), "@"), ["a.ts", "b.ts", "c.ts"]);
    s = press(s, { upArrow: true });
    expect(s.mention!.index).toBe(2);
    s = press(s, { downArrow: true });
    expect(s.mention!.index).toBe(0);
  });
});
