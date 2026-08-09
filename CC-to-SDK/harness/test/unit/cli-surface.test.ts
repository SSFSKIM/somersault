import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { versionLine, helpText, doctorReport, doctorFacts, unknownOptionMessage, suggestSimilar, CCX_OPTIONS } from "../../src/cli/help.js";
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
  it("has both sections, Options before Commands", () => {
    expect(text.indexOf("Options:")).toBeGreaterThan(-1);
    expect(text.indexOf("Commands:")).toBeGreaterThan(text.indexOf("Options:"));
  });
  it("sorts options by commander's key — the short letter when there is one, else the long name", () => {
    // compareOptions (L392992): `short ?? long`, dashes stripped. That is why `-p, --print` sorts under
    // "p" and lands BEFORE `--permission-mode`, and `-v, --version` sits between token-file and worktree.
    const terms = section(text, "Options:").map(term).filter((t): t is string => t !== undefined);
    expect(terms).toEqual([
      "--all", "--allow-origin <origin>", "--bg, --background", "-c, --continue", "--cwd <dir>",
      "--dangerously-skip-permissions", "--detachable", "--effort <level>", "-h, --help",
      "--idle-timeout <seconds>", "--json", "--listen <url>", "--model <model>", "-n, --name <name>",
      "-p, --print", "--permission-mode <mode>", "-r, --resume <value>", "--settings <file-or-json>",
      "--think <level>", "--token-file <path>", "-v, --version", "--worktree <name>",
    ]);
  });
  it("lists the real subcommand registry, sorted — including the doctor this task adds", () => {
    const terms = section(text, "Commands:").map(term).filter((t): t is string => t !== undefined);
    expect(terms).toEqual(["agents", "attach <session>", "doctor", "fleet gc", "rm <session>", "serve", "stop <session>"]);
  });
  it("indents 2 and aligns every description into one column", () => {
    const rows = [...section(text, "Options:"), ...section(text, "Commands:")].filter((r) => term(r) !== undefined);
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
