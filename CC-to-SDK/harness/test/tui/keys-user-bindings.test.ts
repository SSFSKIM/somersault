// tui/test/keys-user-bindings.test.ts — the USER layer (F2 task 9): `~/.claude/keybindings.json` load,
// validation and hot reload. Three disciplines run through everything here:
//  * NOTHING touches the real `~/.claude`. Every file lives in a `mkdtemp` dir and the watcher's fs calls are
//    injected — a test that reads the developer's own keymap would pass or fail by accident.
//  * Every key comparison is CANONICAL (keys/normalize.ts), never raw text: `ctrl+-` and `ctrl+_` are ONE
//    binding (they are the same byte), so the duplicate rule has to catch them across two spellings.
//  * A user file NEVER takes the REPL down. Each rule drops exactly the offending entry and records a typed
//    issue; only unparseable JSON costs the whole file, and even then the defaults keep running.
// The merge itself is proven end-to-end through `compileBindings([...DEFAULT_BINDINGS, ...layers])` — the same
// call the provider makes — so "later wins" and `null`-unbind are asserted as RESOLUTIONS, not as data shape.
import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { formatIssues, loadUserBindings, watchUserBindings, userBindingsPath, STARTER_KEYBINDINGS, type BindingIssue } from "../../src/tui/keys/userBindings.js";
import { compileBindings, resolveKey, type Resolution } from "../../src/tui/keys/resolver.js";
import { DEFAULT_BINDINGS, type ContextBindings } from "../../src/tui/keys/bindings.js";
import type { KeyContextName, KeyEvent } from "../../src/tui/keys/types.js";

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
/** Write a keybindings.json into a fresh temp dir and return its path. `body` is written verbatim when it is a
 *  string, so a test can hand over deliberately broken JSON. */
function fileWith(body: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "ccx-keys-")); dirs.push(dir);
  const file = join(dir, "keybindings.json");
  writeFileSync(file, typeof body === "string" ? body : JSON.stringify(body, null, 2));
  return file;
}
const ev = (name: string, m: Partial<KeyEvent> = {}): KeyEvent =>
  ({ kind: "key", name, ctrl: false, alt: false, shift: false, super: false, raw: "", ...m });
const ctrl = (name: string) => ev(name, { ctrl: true });
/** The compiled table a running REPL would have with this user file on top of the defaults. */
const merged = (layers: readonly ContextBindings[]) => compileBindings([...DEFAULT_BINDINGS, ...layers]);
const resolve = (layers: readonly ContextBindings[], e: KeyEvent, contexts: KeyContextName[]) =>
  resolveKey(e, contexts, merged(layers), []);
const types = (issues: readonly BindingIssue[]) => issues.map((i) => i.type);
/** The prefix a `chord-started` carries — in the real REPL the provider holds it between keypresses. */
const pendingOf = (r: Resolution) => { expect(r).toMatchObject({ type: "chord-started" }); return (r as Extract<Resolution, { type: "chord-started" }>).pending; };

describe("the file path", () => {
  it("is upstream's own ~/.claude/keybindings.json, with home injectable", () => {
    expect(userBindingsPath({ home: "/tmp/fake-home" })).toBe(join("/tmp/fake-home", ".claude", "keybindings.json"));
  });
  it("falls back to the real homedir() when no home is given (path only — nothing is read)", () => {
    expect(userBindingsPath()).toBe(join(homedir(), ".claude", "keybindings.json"));
  });
});

describe("loading a valid file", () => {
  it("merges AFTER the defaults: a user rebinding of a default key wins", () => {
    const { layers, issues } = loadUserBindings(fileWith({ bindings: [{ context: "Chat", bindings: { escape: "chat:clearInput" } }] }));
    expect(issues).toEqual([]);
    expect(resolve(layers, ev("escape"), ["Chat", "Global"])).toMatchObject({ type: "match", action: "chat:clearInput" });
  });
  it("accepts the ARRAY inner form ([{key, action}]) identically to the object map", () => {
    const arr = loadUserBindings(fileWith({ bindings: [{ context: "Chat", bindings: [{ key: "alt+g", action: "chat:externalEditor" }] }] }));
    const map = loadUserBindings(fileWith({ bindings: [{ context: "Chat", bindings: { "alt+g": "chat:externalEditor" } }] }));
    expect(arr.issues).toEqual([]);
    expect(arr.layers).toEqual(map.layers);
    expect(resolve(arr.layers, ev("g", { alt: true }), ["Chat"])).toMatchObject({ type: "match", action: "chat:externalEditor" });
  });
  it("a null action reaches resolution as `unbound` — and STOPS the search, so Global does not inherit it", () => {
    const { layers } = loadUserBindings(fileWith({ bindings: [{ context: "Chat", bindings: { "ctrl+o": null } }] }));
    expect(resolve(layers, ctrl("o"), ["Chat", "Global"])).toEqual({ type: "unbound" });
    expect(resolve(layers, ctrl("o"), ["Global"])).toMatchObject({ type: "match", action: "app:toggleTranscript" });
  });
  it("the documented MOVE recipe works: unbind the default key, bind the new one", () => {
    const { layers } = loadUserBindings(fileWith({ bindings: [
      { context: "Chat", bindings: { "shift+tab": null, "alt+m": "chat:cycleMode" } },
    ] }));
    expect(resolve(layers, ev("tab", { shift: true }), ["Chat"])).toEqual({ type: "unbound" });
    expect(resolve(layers, ev("m", { alt: true }), ["Chat"])).toMatchObject({ type: "match", action: "chat:cycleMode" });
  });
  it("a re-SPELLING of a default key still overwrites it (canonical comparison, not raw text)", () => {
    const { layers, issues } = loadUserBindings(fileWith({ bindings: [{ context: "Chat", bindings: { "SHIFT+TAB": "chat:clearInput" } }] }));
    expect(types(issues)).toEqual(["suspicious_key"]);                       // caps modifiers warn, never drop
    expect(resolve(layers, ev("tab", { shift: true }), ["Chat"])).toMatchObject({ type: "match", action: "chat:clearInput" });
  });
  it("a chord binds like any other key", () => {
    const { layers } = loadUserBindings(fileWith({ bindings: [{ context: "Chat", bindings: { "ctrl+x ctrl+r": "chat:clearInput" } }] }));
    const table = merged(layers);
    const started = resolveKey(ctrl("x"), ["Chat"], table, []);
    expect(started).toMatchObject({ type: "chord-started" });
    expect(resolveKey(ctrl("r"), ["Chat"], table, pendingOf(started)))
      .toMatchObject({ type: "match", action: "chat:clearInput" });
  });
  it("a missing file is not an error — empty layers, zero issues", () => {
    const dir = mkdtempSync(join(tmpdir(), "ccx-keys-")); dirs.push(dir);
    expect(loadUserBindings(join(dir, "keybindings.json"))).toEqual({ layers: [], issues: [] });
  });
  it("a file with no `bindings` key contributes nothing and complains about nothing", () => {
    expect(loadUserBindings(fileWith({ $schema: "https://example.invalid/schema.json" }))).toEqual({ layers: [], issues: [] });
  });
  it("reads through an injected readFile — the real fs is never required", () => {
    const readFile = vi.fn(() => JSON.stringify({ bindings: [{ context: "Chat", bindings: { "alt+g": "chat:externalEditor" } }] }));
    const { layers } = loadUserBindings("/nowhere/keybindings.json", { readFile });
    expect(readFile).toHaveBeenCalledWith("/nowhere/keybindings.json", "utf8");
    expect(layers).toEqual([{ context: "Chat", bindings: { "alt+g": "chat:externalEditor" } }]);
  });
});

describe("validation: each rule drops ONLY the offending entry", () => {
  it("parse_error: unparseable JSON costs the whole file, and nothing else", () => {
    const { layers, issues } = loadUserBindings(fileWith("{ bindings: [ oops"));
    expect(layers).toEqual([]);
    expect(types(issues)).toEqual(["parse_error"]);
    expect(issues[0].detail).toContain("not valid JSON");
  });
  it("parse_error: an unparseable KEY spec drops that binding, keeping the rest of the block", () => {
    const { layers, issues } = loadUserBindings(fileWith({ bindings: [
      { context: "Chat", bindings: { "ctrl+": "chat:clearInput", "alt+g": "chat:externalEditor" } },
    ] }));
    expect(types(issues)).toEqual(["parse_error"]);
    expect(issues[0].detail).toContain("ctrl+");
    expect(layers).toEqual([{ context: "Chat", bindings: { "alt+g": "chat:externalEditor" } }]);
  });
  it("parse_error: a block whose `bindings` is neither object nor array is dropped whole", () => {
    const { layers, issues } = loadUserBindings(fileWith({ bindings: [
      { context: "Chat", bindings: "ctrl+g" },
      { context: "Global", bindings: { "alt+g": "app:toggleTodos" } },
    ] }));
    expect(types(issues)).toEqual(["parse_error"]);
    expect(layers).toEqual([{ context: "Global", bindings: { "alt+g": "app:toggleTodos" } }]);
  });
  it("invalid_context: an unknown context drops that block, later blocks still load", () => {
    const { layers, issues } = loadUserBindings(fileWith({ bindings: [
      { context: "Nope", bindings: { "alt+g": "chat:externalEditor" } },
      { context: "Chat", bindings: { "alt+g": "chat:externalEditor" } },
    ] }));
    expect(types(issues)).toEqual(["invalid_context"]);
    expect(issues[0].detail).toContain("Nope");
    expect(layers).toEqual([{ context: "Chat", bindings: { "alt+g": "chat:externalEditor" } }]);
  });
  it("invalid_action: an unknown action drops the binding, its siblings survive", () => {
    const { layers, issues } = loadUserBindings(fileWith({ bindings: [
      { context: "Chat", bindings: { "alt+q": "chat:nope", "alt+g": "chat:externalEditor" } },
    ] }));
    expect(types(issues)).toEqual(["invalid_action"]);
    expect(issues[0].detail).toContain("chat:nope");
    expect(layers).toEqual([{ context: "Chat", bindings: { "alt+g": "chat:externalEditor" } }]);
    expect(resolve(layers, ev("q", { alt: true }), ["Chat"])).toEqual({ type: "no-match" });
  });
  it("invalid_action: a non-string, non-null action (a number, an object) is dropped", () => {
    const { layers, issues } = loadUserBindings(fileWith({ bindings: [{ context: "Chat", bindings: { "alt+q": 7, "alt+w": { a: 1 } } }] }));
    expect(types(issues)).toEqual(["invalid_action", "invalid_action"]);
    expect(layers).toEqual([]);
  });
  // The array form's own hole: `{ "key": "ctrl+g" }` is a plausible half-typed entry, and treating a MISSING
  // `action` as null would silently unbind ctrl+g — the loudest possible outcome from the quietest typo. Only an
  // EXPLICIT null means unbind, in both inner forms.
  it("invalid_action: an array entry with no `action` property is a typo, not an unbind", () => {
    const { layers, issues } = loadUserBindings(fileWith({ bindings: [
      { context: "Chat", bindings: [{ key: "ctrl+g" }, { key: "alt+g", action: "chat:externalEditor" }] },
    ] }));
    expect(types(issues)).toEqual(["invalid_action"]);
    expect(issues[0].detail).toContain("ctrl+g");
    expect(layers).toEqual([{ context: "Chat", bindings: { "alt+g": "chat:externalEditor" } }]);
    expect(resolve(layers, ctrl("g"), ["Chat", "Global"])).not.toEqual({ type: "unbound" });   // NOT unbound behind our back
  });
  it("an EXPLICIT null action still unbinds, in the array form as well as the object map", () => {
    const arr = loadUserBindings(fileWith({ bindings: [{ context: "Chat", bindings: [{ key: "ctrl+o", action: null }] }] }));
    const map = loadUserBindings(fileWith({ bindings: [{ context: "Chat", bindings: { "ctrl+o": null } }] }));
    expect(arr.issues).toEqual([]);
    expect(map.issues).toEqual([]);
    expect(arr.layers).toEqual(map.layers);
    expect(resolve(arr.layers, ctrl("o"), ["Chat", "Global"])).toEqual({ type: "unbound" });
  });
  it("duplicate: the SAME key under two spellings in one block — later wins, issue recorded", () => {
    const { layers, issues } = loadUserBindings(fileWith({ bindings: [
      { context: "Chat", bindings: [{ key: "ctrl+-", action: "chat:clearInput" }, { key: "ctrl+_", action: "chat:cancel" }] },
    ] }));
    expect(types(issues)).toEqual(["duplicate"]);
    expect(resolve(layers, ctrl("_"), ["Chat"])).toMatchObject({ type: "match", action: "chat:cancel" });
  });
  it("duplicate: the array form's literal repeat is caught too", () => {
    const { issues } = loadUserBindings(fileWith({ bindings: [
      { context: "Chat", bindings: [{ key: "alt+g", action: "chat:clearInput" }, { key: "alt+g", action: "chat:cancel" }] },
    ] }));
    expect(types(issues)).toEqual(["duplicate"]);
  });
  it("duplicate is per BLOCK — the same key in two blocks of one context is a normal later-wins merge", () => {
    const { layers, issues } = loadUserBindings(fileWith({ bindings: [
      { context: "Chat", bindings: { "alt+g": "chat:clearInput" } },
      { context: "Chat", bindings: { "alt+g": "chat:cancel" } },
    ] }));
    expect(issues).toEqual([]);
    expect(resolve(layers, ev("g", { alt: true }), ["Chat"])).toMatchObject({ type: "match", action: "chat:cancel" });
  });
  it("reserved (severity error): the binding is dropped", () => {
    const { layers, issues } = loadUserBindings(fileWith({ bindings: [{ context: "Chat", bindings: { "ctrl+c": "chat:clearInput" } }] }));
    expect(types(issues)).toEqual(["reserved"]);
    expect(issues[0].detail).toContain("interrupt/exit");
    expect(layers).toEqual([]);
    expect(resolve(layers, ctrl("c"), ["Chat", "Global"])).toMatchObject({ type: "match", action: "app:interrupt" });
  });
  it("reserved (severity error) inside a CHORD is dropped too — a reserved key must never arm a prefix", () => {
    const { layers, issues } = loadUserBindings(fileWith({ bindings: [{ context: "Chat", bindings: { "ctrl+c ctrl+k": "chat:killAgents" } }] }));
    expect(types(issues)).toEqual(["reserved"]);
    expect(layers).toEqual([]);
  });
  it("reserved (severity warning): ctrl+z is reported but KEPT", () => {
    const { layers, issues } = loadUserBindings(fileWith({ bindings: [{ context: "Chat", bindings: { "ctrl+z": "chat:clearInput" } }] }));
    expect(types(issues)).toEqual(["reserved"]);
    expect(issues[0].detail).toContain("SIGTSTP");
    expect(layers).toEqual([{ context: "Chat", bindings: { "ctrl+z": "chat:clearInput" } }]);
  });
  it("an explicit UNBIND of a reserved key is not a rebinding — no issue, and it applies", () => {
    const { layers, issues } = loadUserBindings(fileWith({ bindings: [{ context: "Transcript", bindings: { "ctrl+c": null } }] }));
    expect(issues).toEqual([]);
    expect(resolve(layers, ctrl("c"), ["Transcript", "Global"])).toEqual({ type: "unbound" });
  });
  it("every issue carries an actionable detail — context, key and reason", () => {
    const { issues } = loadUserBindings(fileWith({ bindings: [{ context: "Chat", bindings: { "alt+q": "chat:nope" } }] }));
    expect(issues[0].detail).toContain("Chat");
    expect(issues[0].detail).toContain("alt+q");
  });
});

describe("the command: action form", () => {
  it("is accepted in Chat and resolves as that action", () => {
    const { layers, issues } = loadUserBindings(fileWith({ bindings: [{ context: "Chat", bindings: { "alt+k": "command:clear" } }] }));
    expect(issues).toEqual([]);
    expect(resolve(layers, ev("k", { alt: true }), ["Chat"])).toMatchObject({ type: "match", action: "command:clear" });
  });
  it("is rejected outside Chat", () => {
    const { layers, issues } = loadUserBindings(fileWith({ bindings: [{ context: "Global", bindings: { "alt+k": "command:clear" } }] }));
    expect(types(issues)).toEqual(["invalid_action"]);
    expect(issues[0].detail).toContain("Chat");
    expect(layers).toEqual([]);
  });
  it("rejects a malformed command name (upstream's ^command:[a-zA-Z0-9:\\-_]+$)", () => {
    const { issues } = loadUserBindings(fileWith({ bindings: [{ context: "Chat", bindings: { "alt+k": "command:", "alt+j": "command:no spaces" } }] }));
    expect(types(issues)).toEqual(["invalid_action", "invalid_action"]);
  });
});

// Task 2 carry-forward. Key NAMES are deliberately not whitelisted (an unknown name may be a future terminal
// key), so these two are warnings that keep the binding live — never drops.
describe("suspicious specs warn but stay live", () => {
  it("all-caps modifiers are flagged, and the binding still fires", () => {
    const { layers, issues } = loadUserBindings(fileWith({ bindings: [{ context: "Chat", bindings: { "CTRL+G": "chat:clearInput" } }] }));
    expect(types(issues)).toEqual(["suspicious_key"]);
    expect(issues[0].detail).toContain("CTRL+G");
    // …on ctrl+SHIFT+g, not ctrl+g: a capital LETTER is the documented shift shorthand, which is exactly the
    // trap the caps warning exists for — someone shouting the modifier usually shouted the key name too.
    expect(resolve(layers, ev("g", { ctrl: true, shift: true }), ["Chat"])).toMatchObject({ type: "match", action: "chat:clearInput" });
    expect(resolve(layers, ctrl("g"), ["Chat"])).toMatchObject({ type: "match", action: "chat:externalEditor" });   // the default, untouched
  });
  it("a likely key-name typo is flagged, and the binding is still installed", () => {
    const { layers, issues } = loadUserBindings(fileWith({ bindings: [{ context: "Chat", bindings: { "ctrl+ecsape": "chat:clearInput" } }] }));
    expect(types(issues)).toEqual(["suspicious_key"]);
    expect(issues[0].detail).toContain("ecsape");
    expect(layers).toEqual([{ context: "Chat", bindings: { "ctrl+ecsape": "chat:clearInput" } }]);
  });
  it("real key names — including the ones only some terminals send — never warn", () => {
    const { issues } = loadUserBindings(fileWith({ bindings: [{ context: "Chat", bindings: {
      f13: "chat:clearInput", pagedown: "chat:cancel", space: "chat:cycleMode", "ctrl+_": "chat:killAgents",
    } }] }));
    expect(issues).toEqual([]);
  });
});

// Task 4 carry-forward. Our resolver interleaves exact-then-prefix WITHIN each context as the ordered active
// array is walked, which makes upstream's Q4u ordering ambiguity unobservable under DEFAULT_BINDINGS alone —
// no default chord head collides with another context's exact binding. A USER rebind surfaces it, so the
// behaviour we actually have is pinned here: a future resolver change cannot flip it silently.
describe("a user chord head in an INNER context vs an exact binding in an outer one", () => {
  // `Autocomplete` binds neither ctrl+o nor ctrl+k by default, so nothing but the user's chord is in play.
  const load = () => loadUserBindings(fileWith({ bindings: [{ context: "Autocomplete", bindings: { "ctrl+o ctrl+k": "autocomplete:accept" } }] })).layers;
  const active: KeyContextName[] = ["Autocomplete", "Global"];
  it("the inner chord head ARMS — Global's exact ctrl+o (toggleTranscript) does not fire", () => {
    expect(resolve(load(), ctrl("o"), active)).toMatchObject({ type: "chord-started" });
  });
  it("completing the chord matches the inner binding", () => {
    const table = merged(load());
    const started = resolveKey(ctrl("o"), active, table, []);
    expect(resolveKey(ctrl("k"), active, table, pendingOf(started)))
      .toMatchObject({ type: "match", action: "autocomplete:accept", context: "Autocomplete" });
  });
  it("a NON-completion swallows an outer exact binding: ctrl+o ctrl+r does not open history search", () => {
    const table = merged(load());
    const started = resolveKey(ctrl("o"), active, table, []);
    expect(resolveKey(ctrl("r"), active, table, pendingOf(started))).toEqual({ type: "no-match" });
  });
  // The other direction of the same interleave, and the reason the case above had to avoid `Select`: exact
  // beats prefix WITHIN one context, so a context that already unbinds the head key never arms it at all.
  it("an EXACT binding in the same context outranks that context's own chord head (Select's default ctrl+o: null)", () => {
    const layers = loadUserBindings(fileWith({ bindings: [{ context: "Select", bindings: { "ctrl+o ctrl+k": "select:accept" } }] })).layers;
    expect(resolve(layers, ctrl("o"), ["Select", "Global"])).toEqual({ type: "unbound" });
  });
});

describe("the hot-reload watcher", () => {
  type StatLike = { mtimeMs: number; size: number };
  /** A fake `fs.watchFile` that hands the registered listener back to the test. */
  function fakeWatch() {
    const calls: { file: string; interval: number; listener: (c: StatLike, p: StatLike) => void }[] = [];
    const unwatched: { file: string; listener: unknown }[] = [];
    return {
      calls, unwatched,
      watchFile: (file: string, opts: { interval: number }, listener: (c: StatLike, p: StatLike) => void) => { calls.push({ file, interval: opts.interval, listener }); },
      unwatchFile: (file: string, listener: unknown) => { unwatched.push({ file, listener }); },
      fire: (curr: StatLike, prev: StatLike) => { calls[calls.length - 1].listener(curr, prev); },
    };
  }
  const stat = (mtimeMs: number, size = 10): StatLike => ({ mtimeMs, size });

  it("polls the file at 500 ms by default", () => {
    const w = fakeWatch();
    watchUserBindings("/tmp/k.json", () => {}, { watchFile: w.watchFile, unwatchFile: w.unwatchFile });
    expect(w.calls[0]).toMatchObject({ file: "/tmp/k.json", interval: 500 });
  });
  it("re-parses on an mtime change and hands the caller the NEW result", () => {
    const file = fileWith({ bindings: [{ context: "Chat", bindings: { "alt+g": "chat:externalEditor" } }] });
    const w = fakeWatch();
    const onChange = vi.fn();
    watchUserBindings(file, onChange, { watchFile: w.watchFile, unwatchFile: w.unwatchFile });
    expect(onChange).not.toHaveBeenCalled();                              // load-once is the CALLER's job
    writeFileSync(file, JSON.stringify({ bindings: [{ context: "Chat", bindings: { "alt+g": "chat:clearInput" } }] }));
    w.fire(stat(2), stat(1));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].layers).toEqual([{ context: "Chat", bindings: { "alt+g": "chat:clearInput" } }]);
  });
  it("reports issues from a reload the same way as from the first load", () => {
    const file = fileWith({ bindings: [] });
    const w = fakeWatch();
    const onChange = vi.fn();
    watchUserBindings(file, onChange, { watchFile: w.watchFile, unwatchFile: w.unwatchFile });
    writeFileSync(file, "{ broken");
    w.fire(stat(2), stat(1));
    expect(types(onChange.mock.calls[0][0].issues)).toEqual(["parse_error"]);
  });
  it("ignores a poll tick that reports no change", () => {
    const w = fakeWatch();
    const onChange = vi.fn();
    watchUserBindings(fileWith({ bindings: [] }), onChange, { watchFile: w.watchFile, unwatchFile: w.unwatchFile });
    w.fire(stat(1), stat(1));
    expect(onChange).not.toHaveBeenCalled();
  });
  it("a DELETED file reverts to the defaults instead of freezing the last good layers", () => {
    const file = fileWith({ bindings: [{ context: "Chat", bindings: { "alt+g": "chat:externalEditor" } }] });
    const w = fakeWatch();
    const onChange = vi.fn();
    watchUserBindings(file, onChange, { watchFile: w.watchFile, unwatchFile: w.unwatchFile });
    rmSync(file);
    w.fire(stat(0, 0), stat(1));                                          // fs.watchFile reports mtime 0 for a gone file
    expect(onChange.mock.calls[0][0]).toEqual({ layers: [], issues: [] });
  });
  it("stop() unwatches the SAME listener and silences a late poll", () => {
    const w = fakeWatch();
    const onChange = vi.fn();
    const stop = watchUserBindings(fileWith({ bindings: [] }), onChange, { watchFile: w.watchFile, unwatchFile: w.unwatchFile });
    stop();
    expect(w.unwatched[0].listener).toBe(w.calls[0].listener);
    w.fire(stat(2), stat(1));
    expect(onChange).not.toHaveBeenCalled();
    stop();                                                               // idempotent
    expect(w.unwatched).toHaveLength(1);
  });
});

describe("formatIssues — what the user actually reads", () => {
  const issue = (n: number): BindingIssue => ({ type: "invalid_action", detail: `problem ${n}` });
  it("is silent when there is nothing to say", () => expect(formatIssues([], "/home/u/.claude/keybindings.json")).toEqual([]));
  it("heads with the file and the count, then one line per issue", () => {
    const lines = formatIssues([issue(1), issue(2)], "/home/u/.claude/keybindings.json");
    expect(lines[0]).toBe("⚠ /home/u/.claude/keybindings.json: 2 problems");
    expect(lines[1]).toContain("invalid_action");
    expect(lines[1]).toContain("problem 1");
    expect(lines).toHaveLength(3);
  });
  it("says \"problem\" once and \"problems\" more than once", () =>
    expect(formatIssues([issue(1)], "k.json")[0]).toBe("⚠ k.json: 1 problem"));
  it("caps the body so a badly broken file cannot flood the transcript", () => {
    const lines = formatIssues([1, 2, 3, 4, 5, 6, 7].map(issue), "k.json");
    expect(lines).toHaveLength(7);                                        // head + 5 + the elision line
    expect(lines[lines.length - 1]).toContain("2 more");
  });
});

describe("the starter file", () => {
  it("is valid JSON that loads to nothing — a blank canvas, not a broken one", () => {
    const { layers, issues } = loadUserBindings(fileWith(STARTER_KEYBINDINGS));
    expect(issues).toEqual([]);
    expect(layers).toEqual([]);
  });
});
