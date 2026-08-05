// tui/test/small-dialog-options.test.ts — the pure half of F6 T8's four remaining dialogs (WebFetch, Skill,
// Monitor, generic). Every literal here is transcribed from 2.1.220: `ull`/`Wtm`/`qtm`/`fid` (WebFetch),
// `oll`/`Dtm`/`Ptm`/`Otm`/`_id` (Skill), `Ral`/`ntm`/`otm`/`itm`/`hid`/`jrn` (Monitor) and `Gal`/`gtm`/`TDn`
// (generic), plus `Ktt` (the 3-line description clip) and `ma` (the code-unit clip `jrn` truncates with).
import { describe, it, expect } from "vitest";
import {
  clipLines, fetchDecision, fetchHostname, fetchOptions, genericDecision, genericOptions, hasMcpSuffix,
  monitorDecision, monitorOptions, monitorPayload, renderedToolUse, skillDecision, skillOf, skillOptions,
  skillPrefix, subprotocolList, suggestionRowLabel,
} from "../../src/tui/dialogs/smallDialogOptions.js";
import type { PermissionUpdateLike } from "../../src/permissions/types.js";

const labels = (options: { label: string }[]) => options.map((o) => o.label);
const values = (options: { value: string }[]) => options.map((o) => o.value);
const rule = (toolName: string, ruleContent?: string): PermissionUpdateLike =>
  ({ type: "addRules", rules: [ruleContent === undefined ? { toolName } : { toolName, ruleContent }], behavior: "allow", destination: "session" });

describe("clipLines (`Ktt` L15260)", () => {
  it("returns the text untouched at or under the limit", () => {
    expect(clipLines("a\nb\nc", 3)).toBe("a\nb\nc");
    expect(clipLines("only", 3)).toBe("only");
  });
  it("keeps the first N lines and marks the loss with a single ellipsis — no trailing newline", () => {
    expect(clipLines("a\nb\nc\nd\ne", 3)).toBe("a\nb\nc…");
  });
});

describe("renderedToolUse — the headless substitute for `renderToolUseMessage`", () => {
  it("takes the first argument, strings verbatim and anything else as JSON", () => {
    expect(renderedToolUse({ url: "https://example.com/a" })).toBe("https://example.com/a");
    expect(renderedToolUse({ ids: [1, 2] })).toBe("[1,2]");
    expect(renderedToolUse({})).toBe("");
  });
  it("clips a very long argument", () => {
    expect(renderedToolUse({ q: "x".repeat(300) }).endsWith("…")).toBe(true);
    expect(renderedToolUse({ q: "x".repeat(300) }).length).toBe(140);
  });
});

describe("WebFetch (`ull` L506735-816 · `Wtm` L506721-730 · `fid` L228310-318)", () => {
  it("derives the hostname off input.url, and empty on anything unparseable", () => {
    expect(fetchHostname({ url: "https://docs.anthropic.com/en/api" })).toBe("docs.anthropic.com");
    expect(fetchHostname({ url: "not a url" })).toBe("");
    expect(fetchHostname({ url: 7 })).toBe("");
    expect(fetchHostname({})).toBe("");
  });

  it("offers Yes · the domain row · a PLAIN-label No that names (esc)", () => {
    const options = fetchOptions({ hostname: "example.com" });
    expect(labels(options)).toEqual([
      "Yes",
      "Yes, and don't ask again for example.com",
      "No, and tell Claude what to do differently (esc)",
    ]);
    expect(values(options)).toEqual(["yes", "yes-dont-ask-again-domain", "no"]);
    // `ull` builds its No from a plain label with no `feedbackConfig` (L506757-771): it can never become a
    // text row, which is why this dialog alone has no Tab-to-feedback affordance.
    expect(options.every((o) => o.type === undefined)).toBe(true);
  });

  it("suppresses the domain row when no hostname could be derived (`qtm`'s `hostname !== \"\"`)", () => {
    expect(values(fetchOptions({ hostname: "" }))).toEqual(["yes", "no"]);
  });

  it("the domain row is ONE localSettings rule keyed `domain:<hostname>`", () => {
    expect(fetchDecision("yes-dont-ask-again-domain", { toolName: "WebFetch", hostname: "example.com" })).toEqual({
      kind: "allow_with_updates",
      updatedPermissions: [{ type: "addRules", rules: [{ toolName: "WebFetch", ruleContent: "domain:example.com" }], behavior: "allow", destination: "localSettings" }],
    });
  });

  it("Yes allows once and No denies flat — this dialog has no feedback channel", () => {
    const ctx = { toolName: "WebFetch", hostname: "example.com" };
    expect(fetchDecision("yes", ctx)).toEqual({ kind: "allow_once" });
    expect(fetchDecision("no", ctx)).toEqual({ kind: "deny" });
  });
});

describe("Skill (`oll` L506582-710 · `Dtm` L506560-573 · `_id` L228357)", () => {
  it("reads the skill off input.skill and nothing else headlessly", () => {
    expect(skillOf({ skill: "brainstorming" })).toBe("brainstorming");
    expect(skillOf({ skill: 3 })).toBe("");
    expect(skillOf({})).toBe("");
  });

  it("`Otm`'s prefix gate is a space at index > 0, and the prefix is the FIRST word", () => {
    expect(skillPrefix("git commit")).toBe("git");
    expect(skillPrefix("brainstorming")).toBeUndefined();
    expect(skillPrefix(" leading")).toBeUndefined();       // indexOf(" ") > 0, not >= 0
  });

  it("the exact row and the prefix row COEXIST when the name has a space (`Ptm` and `Otm` are independent)", () => {
    const options = skillOptions({ skill: "git commit", cwd: "/repo" });
    expect(labels(options)).toEqual([
      "Yes",
      "Yes, and don't ask again for git commit in /repo",
      "Yes, and don't ask again for git:* commands in /repo",
      "No",
    ]);
    expect(values(options)).toEqual(["yes", "yes-exact", "yes-prefix", "no"]);
  });

  it("a one-word skill gets the exact row only", () => {
    expect(values(skillOptions({ skill: "brainstorming", cwd: "/repo" }))).toEqual(["yes", "yes-exact", "no"]);
  });

  it("an empty skill name gets neither (`Ptm`'s `skill !== \"\"`)", () => {
    expect(values(skillOptions({ skill: "", cwd: "/repo" }))).toEqual(["yes", "no"]);
  });

  it("both rows write a Skill rule to localSettings — exact content, then `<firstWord>:*`", () => {
    const ctx = { skill: "git commit" };
    expect(skillDecision("yes-exact", ctx)).toEqual({
      kind: "allow_with_updates",
      updatedPermissions: [{ type: "addRules", rules: [{ toolName: "Skill", ruleContent: "git commit" }], behavior: "allow", destination: "localSettings" }],
    });
    expect(skillDecision("yes-prefix", ctx)).toEqual({
      kind: "allow_with_updates",
      updatedPermissions: [{ type: "addRules", rules: [{ toolName: "Skill", ruleContent: "git:*" }], behavior: "allow", destination: "localSettings" }],
    });
  });

  it("carries the deny feedback and trims it; an empty one is a plain deny", () => {
    expect(skillDecision("no", { skill: "x", text: "  use the other one  " })).toEqual({ kind: "deny", feedback: "use the other one" });
    expect(skillDecision("no", { skill: "x", text: "   " })).toEqual({ kind: "deny" });
  });

  it("turns the No row into a text row in feedback mode, and never the Yes row (T3)", () => {
    const options = skillOptions({ skill: "x", cwd: "/repo", feedback: { yes: true, no: true } });
    expect(options.at(-1)!.type).toBe("input");
    expect(options[0]!.type).toBeUndefined();
  });
});

describe("Monitor (`Ral` L506006-093 · `ntm`/`otm`/`itm` L505982-8005 · `hid` L228324 · `jrn` L228116)", () => {
  it("reads the MCP arm, the WebSocket arm and the raw command off the input", () => {
    expect(monitorPayload({ mcp: { server: "gh", tool: "notifications" }, interval_ms: 5000 }))
      .toEqual({ mcp: { server: "gh", tool: "notifications" }, intervalMs: 5000 });
    expect(monitorPayload({ ws: { url: "wss://example.com", protocols: ["v1", 2] } }))
      .toEqual({ ws: { url: "wss://example.com/", protocols: ["v1"] }, intervalMs: 30000 });
    expect(monitorPayload({ command: "tail -f log", description: "watch it" }))
      .toEqual({ command: "tail -f log", description: "watch it", intervalMs: 30000 });
  });

  it("defaults the interval to 30000 and needs BOTH mcp halves before it is an MCP poll", () => {
    expect(monitorPayload({ mcp: { server: "gh" } }).mcp).toBeUndefined();
    expect(monitorPayload({}).intervalMs).toBe(30000);
  });

  it("`jrn` quotes the first four subprotocols and counts the rest", () => {
    expect(subprotocolList(["a", "b"])).toBe('"a", "b"');
    expect(subprotocolList(["a", "b", "c", "d", "e", "f"])).toBe('"a", "b", "c", "d" (+2 more)');
    expect(subprotocolList(["x".repeat(60)])).toBe(`"${"x".repeat(48)}…"`);
  });

  it("`itm` names the single suggested rule, and counts them otherwise", () => {
    expect(suggestionRowLabel([rule("Monitor", "gh/notifications")])).toBe("Yes, and don't ask again for Monitor(gh/notifications)");
    expect(suggestionRowLabel([rule("Monitor", "a"), rule("Monitor", "b")])).toBe("Yes, and add 2 suggested permission rules");
    // a lone rule with NO ruleContent falls to the counting arm, exactly as `itm`'s `t[0].ruleContent` does
    expect(suggestionRowLabel([rule("Monitor")])).toBe("Yes, and add 1 suggested permission rules");
  });

  it("offers the suggestion row only when the engine suggested something (`otm`)", () => {
    expect(values(monitorOptions({ suggestions: [] }))).toEqual(["yes", "no"]);
    expect(values(monitorOptions({ suggestions: [rule("Monitor", "gh/x")] }))).toEqual(["yes", "yes-apply-suggestions", "no"]);
  });

  it("the suggestion row echoes the engine's payload OBJECT-FOR-OBJECT", () => {
    const suggestions = [rule("Monitor", "gh/x"), { type: "addDirectories", directories: ["/repo"], destination: "session" }];
    const decision = monitorDecision("yes-apply-suggestions", { suggestions }) as { kind: string; updatedPermissions: PermissionUpdateLike[] };
    expect(decision.kind).toBe("allow_with_updates");
    expect(decision.updatedPermissions[0]).toBe(suggestions[0]);
    expect(decision.updatedPermissions[1]).toBe(suggestions[1]);
  });
});

describe("generic (`Gal` L506118-260 · `gtm` L506108-116)", () => {
  it("our reachable MCP test is the `mcp__` name prefix, not upstream's ` (MCP)` userFacingName suffix", () => {
    expect(hasMcpSuffix("mcp__notes__append")).toBe(true);
    expect(hasMcpSuffix("WebSearch")).toBe(false);
  });

  it("names the tool and the cwd on its don't-ask-again row", () => {
    const options = genericOptions({ userFacingName: "mcp__notes__append", cwd: "/repo" });
    expect(labels(options)).toEqual([
      "Yes",
      "Yes, and don't ask again for mcp__notes__append commands in /repo",
      "No",
    ]);
    expect(values(options)).toEqual(["yes", "yes-dont-ask-again", "no"]);
  });

  it("that row is a WHOLE-TOOL rule — no ruleContent at all (`gtm` L506108-109)", () => {
    expect(genericDecision("yes-dont-ask-again", { toolName: "mcp__notes__append" })).toEqual({
      kind: "allow_with_updates",
      updatedPermissions: [{ type: "addRules", rules: [{ toolName: "mcp__notes__append" }], behavior: "allow", destination: "localSettings" }],
    });
  });

  it("keeps the deny feedback channel", () => {
    expect(genericDecision("no", { toolName: "X", text: "do it differently" })).toEqual({ kind: "deny", feedback: "do it differently" });
    expect(genericDecision("yes", { toolName: "X" })).toEqual({ kind: "allow_once" });
  });
});
