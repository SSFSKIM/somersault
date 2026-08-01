// tui/test/resumeOutput.test.ts — protects the render-boundary handoff after Ctrl-Z/fg.
import { describe, expect, it } from "vitest";
import { createResumeSafeStdout } from "../../src/tui/chatMain.js";

const staleErase = "\x1b[2K\x1b[1A\x1b[2K";

class RecordingTerminal {
  isTTY = true;
  readonly chunks: string[] = [];
  write(chunk: string): boolean { this.chunks.push(chunk); return true; }
  get output(): string { return this.chunks.join(""); }
}

class FakeInk {
  constructor(private readonly stdout: { write(chunk: string): boolean }) {}
  resume(frame: string): void {
    this.stdout.write(staleErase); // Ink's stale log.clear() before it resets its own count.
    this.stdout.write("");
    this.stdout.write(frame);       // Ink's normal replay after that reset.
  }
  render(frame: string): void { this.stdout.write(staleErase + frame); }
}

describe("createResumeSafeStdout", () => {
  it("drops only the first stale Ink erase after resume, preserving shell output before the refreshed frame", () => {
    const terminal = new RecordingTerminal();
    const output = createResumeSafeStdout(terminal as any);
    const ink = new FakeInk(output.stdout as any);

    terminal.write("SHELL-OUTPUT\n");
    output.repaint(() => ink.resume("TUI-REFRESH"));

    expect(terminal.output).toBe("SHELL-OUTPUT\nTUI-REFRESH");
    ink.render("TUI-NEXT");
    expect(terminal.output).toBe("SHELL-OUTPUT\nTUI-REFRESH" + staleErase + "TUI-NEXT");
  });
});
