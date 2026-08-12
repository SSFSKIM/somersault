// tui/test/helpers/fakeTty.tsx — REAL Ink, rendering into a stdout object that can change size.
//
// WHY THIS EXISTS, and why `ink-testing-library` cannot be used for the cases that need it: that library
// renders with `debug: true`, and `debug` is the one branch of `ink.js`'s `onRender` that returns BEFORE the
// tall-frame check (`outputHeight >= stdout.rows`, ink.js:121). So the whole class of "the frame was taller
// than the terminal and Ink reprinted the world" is invisible to every test written on it — including the
// one thing this wave exists to prevent. This harness renders the same tree through the same Ink with
// `debug: false`, over a stdout whose `rows` a test can move, and keeps every chunk Ink writes so the tall
// branch can be COUNTED rather than reasoned about.
//
// The tall write is unmistakable in the bytes: it is the only write Ink makes that opens with
// `ansiEscapes.clearTerminal`, whose head is `\x1b[2J` — and, per `chatMain.tsx`'s own note, no other write
// Ink makes ever contains it.
import { EventEmitter } from "node:events";
import type React from "react";
import { render as inkRender } from "ink";

/** `\x1b[2J` — the head of `ansiEscapes.clearTerminal`, i.e. the signature of `ink.js:121`'s tall branch. */
export const TALL_HEAD = "\x1b[2J";

class FakeStdout extends EventEmitter {
  columns: number;
  rows: number;
  isTTY = true as const;
  writes: string[] = [];
  constructor(columns: number, rows: number) { super(); this.columns = columns; this.rows = rows; this.setMaxListeners(50); }
  write = (chunk: string): boolean => { this.writes.push(chunk); return true; };
}

class FakeStdin extends EventEmitter {
  isTTY = true as const;
  private data: string | null = null;
  constructor() { super(); this.setMaxListeners(50); }
  write = (data: string): void => { this.data = data; this.emit("readable"); this.emit("data", data); };
  setEncoding(): void {}
  setRawMode(): void {}
  resume(): void {}
  pause(): void {}
  ref(): void {}
  unref(): void {}
  read = (): string | null => { const d = this.data; this.data = null; return d; };
}

export interface FakeTty {
  stdout: FakeStdout;
  stdin: FakeStdin;
  unmount: () => void;
  /** Move the terminal and fire the real `resize` event, exactly as Node's SIGWINCH handling does: the size
   *  properties are already the NEW ones by the time any listener runs. */
  resize: (size: { columns?: number; rows?: number }) => void;
  /** Chunks written since the marker returned by `mark()`. */
  since: (mark: number) => string[];
  mark: () => number;
  /** How many of those chunks took Ink's tall-frame branch. */
  tallWritesSince: (mark: number) => number;
  /** Everything painted since the marker, escapes stripped and whitespace collapsed. */
  textSince: (mark: number) => string;
}

export function renderRealInk(tree: React.ReactElement, { columns = 80, rows = 24 }: { columns?: number; rows?: number } = {}): FakeTty {
  const stdout = new FakeStdout(columns, rows);
  const stdin = new FakeStdin();
  const instance = inkRender(tree, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    debug: false, exitOnCtrlC: false, patchConsole: false,
  });
  const since = (mark: number) => stdout.writes.slice(mark);
  return {
    stdout, stdin,
    unmount: () => { instance.unmount(); instance.cleanup(); },
    resize: ({ columns: c, rows: r }) => { if (c !== undefined) stdout.columns = c; if (r !== undefined) stdout.rows = r; stdout.emit("resize"); },
    mark: () => stdout.writes.length,
    since,
    tallWritesSince: (mark: number) => since(mark).filter((w) => w.includes(TALL_HEAD)).length,
    textSince: (mark: number) => since(mark).join("").replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").replace(/\s+/g, " "),
  };
}
