/**
 * P86b child — settles the P86 §5 "not determined" items.
 *
 * Two modes, selected by P86B_MODE:
 *
 *   raw   (default) — an Ink app with **no `useInput` anywhere**. It takes input via
 *                     `useStdin()`: calls `setRawMode(true)` and attaches its own `data` listener to
 *                     the returned `stdin`. This is the candidate F2 architecture: a single root raw
 *                     consumer that sees bytes before Ink's 14-boolean flattening.
 *   focus           — an Ink app with two `useFocus` focusables **and** a `useInput` logger, to test
 *                     whether Ink's own tab/shift+tab focus traversal (App.js:152-158) alters or
 *                     suppresses the events `useInput` receives.
 *
 * Not run directly: spawned under a pty by `86b-ink-rawstdin-matrix.py`. See that file's header for
 * the rerun command.
 *
 * Env:
 *   P86B_LOG              absolute path of the JSONL log to append to (required)
 *   P86B_MODE             "raw" (default) | "focus"
 *   P86B_EXIT_ON_CTRL_C   "1" (default) | "0"  -> render({exitOnCtrlC})
 *   P86B_ENCODING         "" (leave Ink's forced utf8) | e.g. "latin1" to re-set the encoding after
 *                         setRawMode, testing non-UTF-8 byte recovery. NB `setEncoding(null)` does
 *                         NOT clear the decoder — Node's `new StringDecoder(null)` defaults to utf8 —
 *                         so latin1 (a lossless 1:1 byte<->codepoint map) is the way to get bytes back.
 *   P86B_DIRECT           "1" to bypass `useStdin().setRawMode` entirely and drive
 *                         `process.stdin.setRawMode(true)` ourselves. Ink then never attaches its own
 *                         'readable' listener (App.js:120), which tests whether its ctrl+C exit and
 *                         its utf8 forcing come with it — and whether it still restores termios.
 *
 * Feeding the byte "Q" makes the child unmount cleanly, so the driver can inspect termios afterwards.
 *
 * NB on imports: `probes/` is its own npm workspace without ink/react, and Node ESM resolves from the
 * importing file rather than cwd, so ink/react are reached by relative path into harness/node_modules
 * (the exact ink@5.2.1 the harness TUI runs on). Same reason this file uses React.createElement
 * instead of JSX.
 */
import { Buffer } from "node:buffer";
import { appendFileSync } from "node:fs";
import React from "../../harness/node_modules/react/index.js";
import { render, Text, useStdin, useInput, useFocus } from "../../harness/node_modules/ink/build/index.js";

const LOG = process.env.P86B_LOG;
if (!LOG) { console.error("P86B_LOG not set"); process.exit(2); }

const MODE = process.env.P86B_MODE ?? "raw";
const EXIT_ON_CTRL_C = process.env.P86B_EXIT_ON_CTRL_C !== "0";
const ENCODING = process.env.P86B_ENCODING ?? "";
const DIRECT = process.env.P86B_DIRECT === "1";

const t0 = Date.now();
const log = (obj: Record<string, unknown>) => {
  appendFileSync(LOG as string, JSON.stringify({ ...obj, t: Date.now() - t0 }) + "\n");
};

let instance: { unmount: () => void } | undefined;
const quit = () => { setTimeout(() => { instance?.unmount(); }, 30); };

function RawProbe() {
  const [count, setCount] = React.useState(0);
  const { stdin, setRawMode, isRawModeSupported } = useStdin() as {
    stdin: NodeJS.ReadStream; setRawMode: (v: boolean) => void; isRawModeSupported: boolean;
  };
  React.useEffect(() => {
    log({ kind: "mount", mode: "raw", isRawModeSupported, exitOnCtrlC: EXIT_ON_CTRL_C,
          encoding: ENCODING || "(ink default)", direct: DIRECT });
    const src: NodeJS.ReadStream = DIRECT ? process.stdin : stdin;
    if (DIRECT) {
      // Never touch Ink's setRawMode, so App.handleSetRawMode (and its 'readable' listener,
      // its setEncoding('utf8'), and its ctrl+C handling) is never engaged.
      src.setRawMode(true);
      src.resume();
    } else {
      setRawMode(true);
    }
    if (ENCODING) src.setEncoding(ENCODING as BufferEncoding);
    const onData = (chunk: string | Buffer) => {
      // Re-encode with the SAME encoding the stream decoded with, so `hex` is the byte sequence the
      // listener can actually recover — not a utf8 re-encoding of it.
      const buf = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk as string, (ENCODING || "utf8") as BufferEncoding);
      log({
        kind: "data",
        isBuffer: Buffer.isBuffer(chunk),
        len: buf.length,
        hex: buf.toString("hex"),
        text: Buffer.isBuffer(chunk) ? chunk.toString("latin1") : (chunk as string),
      });
      setCount((c: number) => c + 1);
      if (buf.includes(0x51 /* 'Q' */)) { log({ kind: "quit-requested" }); quit(); }
    };
    src.on("data", onData);
    return () => {
      src.off("data", onData);
      // In DIRECT mode we deliberately do NOT restore raw mode, so that the driver's post-exit
      // tcgetattr answers the real question: does Ink restore termios it never set?
      if (!DIRECT) setRawMode(false);
      log({ kind: "unmount-cleanup", restoredByUs: !DIRECT });
    };
  }, []);
  return React.createElement(Text, null, `P86B READY mode=raw events=${count}`);
}

function Focusable({ id }: { id: string }) {
  const { isFocused } = useFocus({ id }) as { isFocused: boolean };
  return React.createElement(Text, null, `[${id}:${isFocused ? "focused" : "blur"}]`);
}

function FocusProbe() {
  const [count, setCount] = React.useState(0);
  useInput((input: string, key: Record<string, boolean>) => {
    log({ kind: "input", input, key });
    setCount((c: number) => c + 1);
    if (input === "Q") { log({ kind: "quit-requested" }); quit(); }
  });
  React.useEffect(() => { log({ kind: "mount", mode: "focus", exitOnCtrlC: EXIT_ON_CTRL_C }); }, []);
  return React.createElement(
    Text,
    null,
    React.createElement(Focusable, { id: "one", key: "one" }),
    React.createElement(Focusable, { id: "two", key: "two" }),
    ` P86B READY mode=focus events=${count}`,
  );
}

process.on("exit", (code) => { log({ kind: "process-exit", code }); });

instance = render(
  React.createElement(MODE === "focus" ? FocusProbe : RawProbe),
  { exitOnCtrlC: EXIT_ON_CTRL_C },
) as { unmount: () => void };
