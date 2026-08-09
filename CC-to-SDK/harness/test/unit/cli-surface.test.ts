import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { versionLine, helpText, doctorReport, doctorFacts, unknownOptionMessage, suggestSimilar, formatItems, CCX_OPTIONS } from "../../src/cli/help.js";
import { parseCcx, UnknownFlagError } from "../../src/cli/args.js";

// An INDEPENDENT read of the same file help.ts reads — the point of the pin is that the printed version
// tracks package.json, so re-exporting help.ts's own constant would assert nothing.
const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8")) as { version: string };

/** The rows of one help section, in order, without the header or the blank line after it. */
function section(text: string, header: string): string[] {
  const lines = text.split("\n");
  const at = lines.indexOf(header);
  expect(at).toBeGreaterThan(-1);
  const rows: string[] = [];
  for (let i = at + 1; i < lines.length && lines[i] !== ""; i++) rows.push(lines[i]!);
  return rows;
}
/** The term of a two-column row (`  -c, --continue   Continue …`), or undefined for a wrapped
 *  continuation line (which starts deeper than the 2-space item indent). */
function term(row: string): string | undefined {
  const m = /^ {2}(\S.*?) {2,}\S/.exec(row);
  return m?.[1];
}

describe("versionLine — C3.1", () => {
  it("is the package version plus ccx's own identity, on one line", () => {
    expect(versionLine()).toBe(`${pkg.version} (cc-harness)`);
    expect(versionLine()).not.toContain("\n");
  });
});

describe("helpText — C3.2", () => {
  const text = helpText();
  it("opens with commander's computed usage header, a blank line and the description", () => {
    const lines = text.split("\n");
    expect(lines[0]).toBe("Usage: ccx [options] [command] [prompt]");
    expect(lines[1]).toBe("");
    // The description is upstream's sentence with our name, and it is longer than the 80-column help
    // width — so it arrives as a wrapped block, not one line. Joined, it must be the whole sentence.
    const description: string[] = [];
    for (let i = 2; lines[i] !== ""; i++) description.push(lines[i]!);
    expect(description.join(" ")).toBe("cc-harness (ccx) - starts an interactive session by default, use -p/--print for non-interactive output");
    expect(lines[2 + description.length]).toBe("");
  });
  it("has all three sections, Arguments then Options then Commands", () => {
    expect(text.indexOf("Arguments:")).toBeGreaterThan(-1);
    expect(text.indexOf("Options:")).toBeGreaterThan(text.indexOf("Arguments:"));
    expect(text.indexOf("Commands:")).toBeGreaterThan(text.indexOf("Options:"));
  });
  it("emits the Arguments section commander puts first, with the one positional", () => {
    // `formatHelp` (L392989) pushes "Arguments:" from `visibleArguments` BEFORE "Options:", and
    // `argumentTerm` (L391720) is the bare `e.name()` — so `.argument("[prompt]", "Your prompt")`
    // renders as `prompt`, without the brackets. Real `claude --help` shows exactly that row.
    expect(section(text, "Arguments:").map(term)).toEqual(["prompt"]);
    expect(section(text, "Arguments:")[0]).toContain("Your prompt");
  });
  it("sorts options by commander's key — the LONG name when there is one, else the short letter", () => {
    // compareOptions (L392993): `let e = (t) => t.long?.replace(/^--/, "") ?? t.short?.replace(/^-/, "") ?? ""`
    // — long FIRST, short only as the fallback. That is why `--permission-mode` sorts under "permission-"
    // and lands BEFORE `-p, --print`, and `-v, --version` sits between token-file and worktree.
    const terms = section(text, "Options:").map(term).filter((t): t is string => t !== undefined);
    expect(terms).toEqual([
      "--all", "--allow-origin <origin>", "--bg, --background", "-c, --continue", "--cwd <dir>",
      "--dangerously-skip-permissions", "--detachable", "--effort <level>", "-h, --help",
      "--idle-timeout <seconds>", "--json", "--listen <url>", "--model <model>", "-n, --name <name>",
      "--permission-mode <mode>", "-p, --print", "-r, --resume <value>", "--settings <file-or-json>",
      "--think <level>", "--token-file <path>", "-v, --version", "--worktree <name>",
    ]);
  });
  it("lists the real subcommand registry, sorted — including the doctor this task adds", () => {
    const terms = section(text, "Commands:").map(term).filter((t): t is string => t !== undefined);
    expect(terms).toEqual(["agents", "attach <session>", "doctor", "fleet gc", "rm <session>", "serve", "stop <session>"]);
  });
  it("indents 2 and aligns every description into one column", () => {
    // ONE pad across all three sections, as commander's `padWidth` (L391813) maxes over arguments,
    // options and subcommands together — so the `prompt` row lines up with the flag rows.
    const rows = [...section(text, "Arguments:"), ...section(text, "Options:"), ...section(text, "Commands:")].filter((r) => term(r) !== undefined);
    const columns = new Set(rows.map((r) => r.length - r.replace(/^ {2}\S.*? {2,}/, "").length));
    expect(columns.size).toBe(1);
    for (const r of rows) expect(r.startsWith("  ")).toBe(true);
  });
  it("wraps to 80 columns", () => {
    for (const line of text.split("\n")) expect(line.length).toBeLessThanOrEqual(80);
  });
  it("every long flag it advertises is one parseCcx actually accepts", () => {
    // The drift guard: help.ts owns the option table, args.ts owns the switch. A flag renamed in one and
    // not the other is a help page that documents a flag the parser rejects.
    for (const o of CCX_OPTIONS) {
      for (const long of o.longs) {
        const argv = o.value ? [long, "x"] : [long];
        try { parseCcx(argv); } catch (e) { expect(e, `${long} is unknown to parseCcx`).not.toBeInstanceOf(UnknownFlagError); }
      }
    }
  });
  it("advertises every flag args.ts's switch actually accepts — the drift guard's other direction", () => {
    // The guard above catches a flag help.ts documents and the parser rejects; this one catches the
    // silent inverse — a flag the parser accepts that the help page never mentions, which no user can
    // discover and no typo suggestion will ever offer.
    const src = readFileSync(fileURLToPath(new URL("../../src/cli/args.ts", import.meta.url)), "utf8");
    const advertised = CCX_OPTIONS.flatMap((o) => [...o.longs, ...(o.short ? [o.short] : [])]);
    for (const [, flag] of src.matchAll(/case "(-{1,2}[^"]+)":/g)) expect(advertised, `${flag} is parsed but undocumented`).toContain(flag);
  });
});

describe("formatItems — the term-overflow arm", () => {
  it("aligns into the pad column while the term fits", () => {
    expect(formatItems([{ term: "--x", description: "d" }], 36)).toEqual([`  --x${" ".repeat(35)}d`]);
  });
  it("drops the description to its own line at a 4-space hanging indent once the term outgrows the pad", () => {
    // commander's `I4o` (L392968-976): the aligned arm needs `termWidth <= pad`; otherwise it emits the
    // term alone, then the description indented `Hhn + Egp` (2 + 4 = 6) and wrapped to
    // `helpWidth - Hhn - Egp` (80 - 2 - 4 = 74). `padEnd` cannot express this — past the pad it is a
    // no-op, which glued the description to the term with no gap at all.
    const long = `--${"x".repeat(40)}`;
    const description = Array.from({ length: 30 }, () => "word").join(" ");
    const rows = formatItems([{ term: long, description }], 36);
    expect(rows[0]).toBe(`  ${long}`);
    expect(rows.length).toBeGreaterThan(1);
    for (const r of rows.slice(1)) {
      expect(r.startsWith("      ")).toBe(true);
      expect(r[6]).not.toBe(" ");
      expect(r.length).toBeLessThanOrEqual(80);
    }
    expect(rows.slice(1).map((r) => r.trim()).join(" ")).toBe(description);
  });
});

describe("unknownOptionMessage — C3.4", () => {
  it("names the token exactly as typed, with no usage block", () => {
    expect(unknownOptionMessage("--nosuchflag")).toBe("error: unknown option '--nosuchflag'");
  });
  it("suggests the near miss on the second line", () => {
    expect(unknownOptionMessage("--nope")).toBe("error: unknown option '--nope'\n(Did you mean --name?)");
    expect(unknownOptionMessage("--modxy")).toBe("error: unknown option '--modxy'\n(Did you mean --model?)");
  });
  it("applies commander's STRICT similarity gate — 0.4 exactly does not suggest", () => {
    // `--modxy` → model is distance 2 of 5 → 0.6, suggested above. `--moxyz` is distance 3 of 5 → exactly
    // 0.4, and the rule is `> 0.4` (L391971), so it must stay silent.
    expect(unknownOptionMessage("--moxyz")).toBe("error: unknown option '--moxyz'");
  });
  it("never suggests for a token that is not `--`-prefixed", () => {
    // The `e.startsWith("--")` guard: `-z` is close to nothing anyway, but `-nope` would otherwise reach
    // the same candidate list as `--nope` did above.
    expect(unknownOptionMessage("-z")).toBe("error: unknown option '-z'");
    expect(unknownOptionMessage("-nope")).toBe("error: unknown option '-nope'");
  });
});

describe("suggestSimilar", () => {
  it("returns the `one of` form, alphabetically, on a tie", () => {
    expect(suggestSimilar("--flig", ["--flag", "--flog", "--unrelated"])).toBe("\n(Did you mean one of --flag, --flog?)");
  });
  it("returns the empty string when nothing is close", () => {
    expect(suggestSimilar("--zzzzzzzzzz", ["--flag"])).toBe("");
  });
  it("keeps only the closest candidates, not every one that clears the gate", () => {
    expect(suggestSimilar("--model", ["--model", "--modxy"])).toBe("\n(Did you mean --model?)");
  });
});

describe("doctorReport — C3.3", () => {
  const facts = { ccxVersion: "0.1.0", node: "v22.14.0", sdk: "0.3.220", platform: "darwin-arm64", invoked: "/tmp/bin/ccx" };
  it("prints the identity block, then the no-issues line after a blank", () => {
    expect(doctorReport(facts)).toBe([
      "ccx doctor",
      "",
      "Running: cc-harness (0.1.0)",
      "Node: v22.14.0",
      "SDK: @anthropic-ai/claude-agent-sdk 0.3.220",
      "Platform: darwin-arm64",
      "Invoked: /tmp/bin/ccx",
      "",
      "No installation issues found.",
    ].join("\n"));
  });
  it("reads its facts from this process by default", () => {
    const f = doctorFacts();
    expect(f.ccxVersion).toBe(pkg.version);
    expect(f.node).toBe(process.version);
    expect(f.platform).toBe(`${process.platform}-${process.arch}`);
    // The SDK's package.json is NOT an export (ERR_PACKAGE_PATH_NOT_EXPORTED), so this only passes if the
    // reader resolves the entry point and walks to the sibling manifest.
    expect(f.sdk).toMatch(/^\d+\.\d+\.\d+/);
  });
});
