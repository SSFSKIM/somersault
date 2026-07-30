// tui/test/externalEditor.test.ts — editExternal round-trips the buffer through a fake $EDITOR.
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { editExternal } from "../../src/tui/externalEditor.js";

describe("editExternal", () => {
  it("writes the buffer to the temp file, runs the editor, returns the edited text, restores raw mode", () => {
    const rawCalls: boolean[] = [];
    const out = editExternal("original text", {
      spawn: ((cmd: string, args: string[]) => {
        expect(cmd).toBe("myeditor");
        const file = args[args.length - 1];
        expect(readFileSync(file, "utf8")).toBe("original text");
        writeFileSync(file, "edited text\n");
        return { status: 0 } as any;
      }) as any,
      setRaw: (on) => rawCalls.push(on),
      editorCmd: "myeditor",
    });
    expect(out).toBe("edited text");                        // trailing newline stripped
    expect(rawCalls).toEqual([false, true]);                // released before, restored after
  });
  it("returns null (buffer kept) when the editor exits non-zero or errors", () => {
    expect(editExternal("keep me", { spawn: (() => ({ status: 1 })) as any, setRaw: () => {}, editorCmd: "e" })).toBeNull();
    expect(editExternal("keep me", { spawn: (() => ({ error: new Error("ENOENT"), status: null })) as any, setRaw: () => {}, editorCmd: "e" })).toBeNull();
  });
  it("returns null (buffer kept) when the file is deleted after a 0-exit (atomic-rename / editor quirk)", () => {
    const rawCalls: boolean[] = [];
    const out = editExternal("keep me", {
      spawn: ((_cmd: string, args: string[]) => {
        const file = args[args.length - 1];
        rmSync(file);                                     // simulate the editor deleting/moving the file away
        return { status: 0 } as any;
      }) as any,
      setRaw: (on) => rawCalls.push(on),
      editorCmd: "e",
    });
    expect(out).toBeNull();
    expect(rawCalls).toEqual([false, true]);                // raw mode still restored
  });
  it("splits an editor command with arguments", () => {
    let seen: [string, string[]] | undefined;
    editExternal("x", { spawn: ((c: string, a: string[]) => { seen = [c, a]; return { status: 0 } as any; }) as any, setRaw: () => {}, editorCmd: "code --wait" });
    expect(seen![0]).toBe("code");
    expect(seen![1][0]).toBe("--wait");
  });
});

describe("editor resolution treats an EMPTY env var as unset", () => {
  const saved = { VISUAL: process.env.VISUAL, EDITOR: process.env.EDITOR };
  afterEach(() => {
    if (saved.VISUAL === undefined) delete process.env.VISUAL; else process.env.VISUAL = saved.VISUAL;
    if (saved.EDITOR === undefined) delete process.env.EDITOR; else process.env.EDITOR = saved.EDITOR;
  });
  it("falls through an exported-but-empty VISUAL to EDITOR", () => {
    // `??` accepted "" as set, leaving cmd undefined so spawnSync threw ERR_INVALID_ARG_TYPE straight into
    // ink's useInput handler — ChatComposer has no try/catch there, so Ctrl-X Ctrl-E crashed the REPL.
    process.env.VISUAL = ""; process.env.EDITOR = "nano";
    let seen: string | undefined;
    editExternal("x", { spawn: ((c: string) => { seen = c; return { status: 0 } as any; }) as any, setRaw: () => {} });
    expect(seen).toBe("nano");
  });
  it("falls all the way back to vi when every source is empty", () => {
    process.env.VISUAL = ""; process.env.EDITOR = "";
    let seen: string | undefined;
    editExternal("x", { spawn: ((c: string) => { seen = c; return { status: 0 } as any; }) as any, setRaw: () => {} });
    expect(seen).toBe("vi");
  });
  it("survives a whitespace-only editor command instead of spawning undefined", () => {
    let seen: string | undefined;
    editExternal("x", { spawn: ((c: string) => { seen = c; return { status: 0 } as any; }) as any, setRaw: () => {}, editorCmd: "   " });
    expect(seen).toBe("vi");
  });
});
