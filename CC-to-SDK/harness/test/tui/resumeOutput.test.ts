// tui/test/resumeOutput.test.ts — protects the render-boundary handoff after Ctrl-Z/fg.
import { describe, expect, it } from "vitest";
import { createDeferredClearBridge, createNoticeBridge, createResumeSafeStdout } from "../../src/tui/chatMain.js";

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

describe("createDeferredClearBridge", () => {
  it("buffers one pre-bind Static clear and delegates every later clear to Ink", () => {
    const bridge = createDeferredClearBridge(); let clears = 0;
    bridge.clearStaticTranscript(); bridge.clearStaticTranscript();
    bridge.bind(() => { clears++; }); expect(clears).toBe(1);
    bridge.clearStaticTranscript(); expect(clears).toBe(2);
  });
});

// F2 task 9: the keybindings.json watcher lives ABOVE useChat, so its findings need a way INTO the transcript —
// including the ones produced before the transcript exists (a broken file at launch).
describe("createNoticeBridge", () => {
  it("queues every pre-bind notice IN ORDER and replays them once the transcript is live", () => {
    const bridge = createNoticeBridge(); const seen: string[] = [];
    bridge.notify("first"); bridge.notify("second");
    expect(seen).toEqual([]);
    bridge.bind((t) => seen.push(t));
    expect(seen).toEqual(["first", "second"]);
    bridge.notify("third");                                   // and delegates directly from then on
    expect(seen).toEqual(["first", "second", "third"]);
  });
  it("replays the queue only once, even if a second client binds later", () => {
    const bridge = createNoticeBridge(); const first: string[] = [], second: string[] = [];
    bridge.notify("only once");
    bridge.bind((t) => first.push(t));
    bridge.bind((t) => second.push(t));
    expect(first).toEqual(["only once"]);
    expect(second).toEqual([]);
  });
});
