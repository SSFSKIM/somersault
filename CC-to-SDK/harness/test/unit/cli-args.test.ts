import { describe, it, expect } from "vitest";
import { parseCcx } from "../../src/cli/args.js";

describe("parseCcx", () => {
  it("parses doperpowers' exact spawn line", () => {
    const a = parseCcx(["--bg", "--permission-mode", "auto", "-n", "worker-3", "--worktree", "wt", "do the thing"]);
    expect(a).toMatchObject({ command: "run", bg: true, name: "worker-3", worktree: "wt", prompt: "do the thing" });
    expect(a.config.permissionMode).toBe("auto");
  });
  it("flags explicit permission config so the default ask-policy floor stays off", () => {
    // A blanket default would park every doperpowers worker at its first tool.
    expect(parseCcx(["--bg", "--permission-mode", "auto", "-n", "w", "x"]).hasExplicitPermissionConfig).toBe(true);
    expect(parseCcx(["--bg", "-n", "w", "x"]).hasExplicitPermissionConfig).toBe(false);
    expect(parseCcx(["--bg", "--settings", "{}", "-n", "w", "x"]).hasExplicitPermissionConfig).toBe(true);
  });
  it("parses the resume fork", () => {
    const a = parseCcx(["--bg", "--resume", "uuid-1", "-n", "w", "next"]);
    expect(a.config.resume).toBe("uuid-1"); expect(a.bg).toBe(true);
  });
  it("parses subcommands with their flags", () => {
    expect(parseCcx(["agents", "--json", "--all"])).toMatchObject({ command: "agents", json: true, all: true });
    expect(parseCcx(["agents", "--cwd", "/repo"])).toMatchObject({ command: "agents", cwdFilter: "/repo" });
    expect(parseCcx(["stop", "a1b2c3d4"])).toMatchObject({ command: "stop", target: "a1b2c3d4" });
    expect(parseCcx(["rm", "a1b2c3d4"])).toMatchObject({ command: "rm", target: "a1b2c3d4" });
    expect(parseCcx(["attach", "a1b2c3d4"])).toMatchObject({ command: "attach", target: "a1b2c3d4" });
    expect(parseCcx(["fleet", "gc"])).toMatchObject({ command: "gc" });
  });
  it("parses -p and --detachable", () => {
    expect(parseCcx(["-p", "hello"])).toMatchObject({ command: "run", print: true, prompt: "hello" });
    expect(parseCcx(["--detachable"])).toMatchObject({ command: "run", detachable: true });
  });
  it("fails loudly on a recognized-but-unsupported flag", () => {
    // A silently ignored --permission-mode in a background worker is a safety bug, not a UX wart.
    expect(() => parseCcx(["--bg", "--remote-control", "x"])).toThrow(/--remote-control/);
  });
  it("fails on an unknown flag rather than treating it as the prompt", () => {
    expect(() => parseCcx(["--nope"])).toThrow(/--nope/);
  });
});
