/**
 * P86 child — a minimal Ink app that records every input event Ink's `useInput` delivers,
 * alongside a competing raw `process.stdin.on("data")` tap, into one append-ordered JSONL log.
 *
 * Not run directly: it is spawned under a pty by `86-ink-input-matrix.py`. See that file's header
 * for the single rerun command.
 *
 * NB on imports: `probes/` is its own npm workspace and does NOT depend on ink/react, so bare
 * `import {render} from "ink"` cannot resolve from this file's location (Node ESM resolves from the
 * importing file, not cwd). We therefore reach into `harness/node_modules` by relative path, which
 * loads the exact same ink@5.2.1 / react@18.3.1 the harness TUI runs on. For the same reason this
 * file uses `React.createElement` instead of JSX (the automatic JSX runtime would emit an
 * unresolvable bare `react/jsx-runtime` import).
 *
 * Env:
 *   P86_LOG  — absolute path of the JSONL log to append to (required)
 *
 * Log line kinds (the driver appends `feed` lines itself, so append order pairs stimulus->events):
 *   {"kind":"input","input":<string>,"key":{...},"t":<ms>}
 *   {"kind":"raw","raw":<string>,"parsed":{...},"t":<ms>}
 *   {"kind":"feed","label":...,"bytes":...}          (written by the driver)
 */
import { appendFileSync } from "node:fs";
import React from "../../harness/node_modules/react/index.js";
import { render, Text, useInput } from "../../harness/node_modules/ink/build/index.js";
import parseKeypress from "../../harness/node_modules/ink/build/parse-keypress.js";

const LOG = process.env.P86_LOG;
if (!LOG) { console.error("P86_LOG not set"); process.exit(2); }

const t0 = Date.now();
const log = (obj: Record<string, unknown>) => {
  appendFileSync(LOG as string, JSON.stringify({ ...obj, t: Date.now() - t0 }) + "\n");
};

function Probe() {
  const [count, setCount] = React.useState(0);
  useInput((input: string, key: Record<string, boolean>) => {
    // `input`/`key` are exactly what an F2 keymap would have to dispatch on; the original byte
    // sequence is NOT available here (Ink discards it), which is itself part of the finding.
    log({ kind: "input", input, key });
    setCount((c: number) => c + 1);
  });
  React.useEffect(() => {
    // Register the competing raw tap AFTER Ink mounted and switched stdin to raw + 'readable' mode.
    // This is exactly the shape F2 would need for a mouse/paste tap layered under Ink.
    const timer = setTimeout(() => {
      process.stdin.on("data", (chunk: string | Buffer) => {
        const s = typeof chunk === "string" ? chunk : chunk.toString("utf8");
        const p = parseKeypress(s) as Record<string, unknown>;
        log({ kind: "raw", raw: s, parsed: { name: p.name, code: p.code, ctrl: p.ctrl, meta: p.meta, shift: p.shift, option: p.option } });
      });
      log({ kind: "rawtap-registered" });
    }, 50);
    return () => clearTimeout(timer);
  }, []);
  return React.createElement(Text, null, `P86 READY events=${count}`);
}

render(React.createElement(Probe), { exitOnCtrlC: false });
