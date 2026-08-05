// tui/test/bash-options.test.ts — the Bash permission dialog's PURE half (F6 T6). Every expectation is a
// transcription of 2.1.220: the option list is `$Qf` (L504855-878), the per-value outcome is `aDn`
// (L505204-223), the prefix seed is `dZf`'s `useState` initializer (L505225-236) over `TIo`/`SSd`
// (L277676/L277704), and the suggestions-summary row is `Wdi` (L504780-804) with its `gsl`/`zMn`/`J5b`
// list formatters (L504765/L504770/L504753).
import { describe, it, expect } from "vitest";
import {
  bashOptions, bashDecision, prefixSeed, suggestionSummary, PREFIX_PLACEHOLDER, PREFIX_LABEL,
} from "../../src/tui/dialogs/bashOptions.js";
import type { PermissionUpdateLike } from "../../src/permissions/types.js";

const bashRule = (ruleContent: string): PermissionUpdateLike =>
  ({ type: "addRules", rules: [{ toolName: "Bash", ruleContent }], behavior: "allow", destination: "session" });
const readRule = (ruleContent: string): PermissionUpdateLike =>
  ({ type: "addRules", rules: [{ toolName: "Read", ruleContent }], behavior: "allow", destination: "session" });
const dirs = (...directories: string[]): PermissionUpdateLike => ({ type: "addDirectories", directories, destination: "session" });
const values = (o: { value: string }[]) => o.map((x) => x.value);

describe("bashOptions — `$Qf` order and shapes (L504855-878)", () => {
  it("is Yes/No alone when the engine suggested nothing (`e.length > 0` gates BOTH middle arms)", () => {
    expect(bashOptions({ command: "ls -la", cwd: "/w" })).toEqual([{ label: "Yes", value: "yes" }, { label: "No", value: "no" }]);
  });

  it("puts the editable-prefix row between them when the suggestions are Bash rules only (L504866)", () => {
    const o = bashOptions({ command: "npm run build", suggestions: [bashRule("npm run:*")], cwd: "/w" });
    expect(values(o)).toEqual(["yes", "yes-prefix-edited", "no"]);
    expect(o[1]).toEqual({
      type: "input", label: PREFIX_LABEL, value: "yes-prefix-edited", placeholder: PREFIX_PLACEHOLDER,
      initialValue: "npm run:*", allowEmptySubmitToCancel: true, showLabelWithValue: true, labelValueSeparator: ": ",
    });
  });

  it("types the prefix label's apostrophe as U+2019 — the one row upstream curls (L504866)", () => {
    expect(PREFIX_LABEL).toBe("Yes, and don’t ask again for");
    expect(PREFIX_LABEL).not.toContain("'");
    expect(PREFIX_PLACEHOLDER).toBe("command prefix (e.g., npm run *)");
  });

  it("swaps the prefix row for the SUMMARY row when a suggestion is not a plain Bash rule (L504865)", () => {
    const o = bashOptions({ command: "npm test", suggestions: [dirs("/repo/pkg")], cwd: "/w" });
    expect(values(o)).toEqual(["yes", "yes-apply-suggestions", "no"]);
    expect(o[1]!.type).toBeUndefined();                        // a plain pick-one row, never an input one
  });

  it("drops the middle arm entirely when `Wdi` has nothing to say (its trailing `return null`)", () => {
    const webfetch: PermissionUpdateLike = { type: "addRules", rules: [{ toolName: "WebFetch", ruleContent: "domain:x" }], behavior: "allow", destination: "session" };
    expect(values(bashOptions({ command: "ls", suggestions: [webfetch], cwd: "/w" }))).toEqual(["yes", "no"]);
  });

  it("turns ONLY the No row into a feedback input row — the allow side has no channel (T3)", () => {
    const o = bashOptions({ command: "ls", feedback: { yes: true, no: true }, cwd: "/w" });
    expect(o[0]).toEqual({ label: "Yes", value: "yes" });       // stays plain even with `yes:true`
    expect(o[1]!.type).toBe("input");
    expect(o[1]!.placeholder).toBe("and tell Claude what to do differently");
  });
});

describe("prefixSeed — `dZf`'s initializer (L505225-236) over `TIo`/`SSd`", () => {
  it("takes a single suggested Bash rule's ruleContent verbatim", () => {
    expect(prefixSeed("git status --short", [bashRule("git status:*")])).toBe("git status:*");
  });

  it("falls back to the two-word prefix `TIo` finds (L277676) — the placeholder's own example", () => {
    expect(prefixSeed("npm run build --watch")).toBe("npm run *");
    expect(prefixSeed("git status --short")).toBe("git status *");
  });

  it("falls back to the one-word prefix `SSd` finds (L277704) when the second word is not a subcommand", () => {
    expect(prefixSeed("ls -la /tmp")).toBe("ls *");
    expect(prefixSeed("cargo")).toBe("cargo *");
  });

  it("keeps the raw command when the head is a shell wrapper (`wIo`) — no prefix is safe there", () => {
    expect(prefixSeed("sudo rm -rf /")).toBe("sudo rm -rf /");
    expect(prefixSeed("bash -c 'rm x'")).toBe("bash -c 'rm x'");
  });

  it("steps over an ALLOWED env assignment and refuses an unknown one (`Gsn`)", () => {
    expect(prefixSeed("CI=1 npm run build")).toBe("npm run *");
    expect(prefixSeed("SECRET=x npm run build")).toBe("SECRET=x npm run build");
  });

  it("declines a two-word prefix whose second word is not lower-kebab, then tries one word", () => {
    expect(prefixSeed("make Build")).toBe("make *");
  });

  it("prefers the command-derived seed when there is more than one suggested Bash rule", () => {
    expect(prefixSeed("npm test && git status", [bashRule("npm test:*"), bashRule("git status:*")])).toBe("npm test *");
  });
});

describe("suggestionSummary — every `Wdi` arm (L504780-804)", () => {
  it("reads only (L504787)", () => {
    expect(suggestionSummary([readRule("./src/**")], "/w")).toBe("Yes, allow reading from src/ from this project");
  });

  it("directories only (L504789)", () => {
    expect(suggestionSummary([dirs("/repo/pkg")], "/w")).toBe("Yes, and always allow access to pkg/ from this project");
  });

  it("commands only — the ONE arm that names the cwd, with an ASCII apostrophe (L504791)", () => {
    const label = suggestionSummary([bashRule("npm run:*"), { type: "addRules", rules: [{ toolName: "WebFetch", ruleContent: "d" }], behavior: "allow", destination: "session" }], "/repo");
    expect(label).toBe("Yes, and don't ask again for npm run commands in /repo");
    expect(label).not.toContain("’");
  });

  it("directories AND reads collapse into one access sentence (L504793)", () => {
    expect(suggestionSummary([dirs("/repo/pkg"), readRule("docs/**")], "/w"))
      .toBe("Yes, and always allow access to pkg/ and docs/ from this project");
  });

  it("one path plus one command reads as `access to … and … commands` (L504798)", () => {
    expect(suggestionSummary([dirs("/repo/pkg"), bashRule("npm run:*")], "/w"))
      .toBe("Yes, and allow access to pkg/ and npm run commands");
  });

  it("…and the plural form otherwise (L504799)", () => {
    expect(suggestionSummary([dirs("/a/one"), dirs("/a/two"), bashRule("npm run:*")], "/w"))
      .toBe("Yes, and allow one/ and two/ access and npm run commands");
  });

  it("says `similar` rather than list commands past 50 characters (`gsl` L504765)", () => {
    const many = ["alpha run:*", "bravo run:*", "charlie run:*", "delta run:*", "echo run:*"].map(bashRule);
    expect(suggestionSummary([...many, dirs("/a/x")], "/w")).toBe("Yes, and allow x/ access and similar commands");
  });

  it("has nothing to say about a suggestion set it cannot describe", () => {
    expect(suggestionSummary([], "/w")).toBeUndefined();
    expect(suggestionSummary([{ type: "setMode", mode: "acceptEdits", destination: "session" }], "/w")).toBeUndefined();
  });
});

describe("bashDecision — `aDn` (L505204-223)", () => {
  it("plain Yes is a plain allow_once", () => {
    expect(bashDecision("yes")).toEqual({ kind: "allow_once" });
  });

  it("the suggestions row echoes `req.suggestions` VERBATIM — same objects, no reshaping", () => {
    const suggestions = [dirs("/repo/pkg"), bashRule("npm run:*")];
    const d = bashDecision("yes-apply-suggestions", { suggestions });
    expect(d.kind).toBe("allow_with_updates");
    const updates = (d as { updatedPermissions: PermissionUpdateLike[] }).updatedPermissions;
    expect(updates).toHaveLength(2);
    expect(updates[0]).toBe(suggestions[0]);
    expect(updates[1]).toBe(suggestions[1]);
  });

  it("a typed prefix becomes ONE localSettings addRules update (L505216-219)", () => {
    expect(bashDecision("yes-prefix-edited", { text: "  npm run *  " })).toEqual({
      kind: "allow_with_updates",
      updatedPermissions: [{ type: "addRules", rules: [{ toolName: "Bash", ruleContent: "npm run *" }], behavior: "allow", destination: "localSettings" }],
    });
  });

  it("an EMPTY prefix downgrades to a plain allow_once (L505215-216)", () => {
    expect(bashDecision("yes-prefix-edited", { text: "" })).toEqual({ kind: "allow_once" });
    expect(bashDecision("yes-prefix-edited", { text: "   " })).toEqual({ kind: "allow_once" });
  });

  it("No denies, carrying trimmed feedback when there is any (L505221)", () => {
    expect(bashDecision("no")).toEqual({ kind: "deny" });
    expect(bashDecision("no", { text: "   " })).toEqual({ kind: "deny" });
    expect(bashDecision("no", { text: "  use pnpm  " })).toEqual({ kind: "deny", feedback: "use pnpm" });
  });
});
