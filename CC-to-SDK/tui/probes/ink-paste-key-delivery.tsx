// tui/probes/ink-paste-key-delivery.tsx — CLIENT-SIDE Ink behavior probe for increment-8 input ergonomics.
// A1 live-probe-first: the multiline editor's paste + `\`-continuation handling depends on HOW Ink's
// useInput delivers a multi-byte write — as ONE call with the whole string (incl. embedded "\n"), or as
// many per-character calls; and whether Ink strips bracketed-paste markers (\x1b[200~ … \x1b[201~). Not an
// SDK probe (no API) — run with ink-testing-library (the same harness the component tests use) via tsx.
// Run: cd tui && npx tsx probes/ink-paste-key-delivery.tsx
import React from "react";
import { render } from "ink-testing-library";
import { Text, useInput } from "ink";

type Ev = { input: string; keys: string };
const events: Ev[] = [];

function Probe() {
  useInput((input, key) => {
    const keys = Object.entries(key).filter(([, v]) => v).map(([k]) => k).join("+") || "—";
    events.push({ input: JSON.stringify(input), keys });
  });
  return <Text>probe</Text>;
}

async function run(label: string, data: string): Promise<void> {
  events.length = 0;
  const { stdin, unmount } = render(<Probe />);
  await new Promise((r) => setTimeout(r, 40));   // let useInput subscribe (passive effect) before writing
  stdin.write(data);
  await new Promise((r) => setTimeout(r, 40));    // let Ink parse + dispatch
  console.log(`\n${label}`);
  console.log(`  wrote: ${JSON.stringify(data)}`);
  console.log(`  → ${events.length} useInput call(s):`);
  for (const e of events) console.log(`      input=${e.input}  keys=${e.keys}`);
  unmount();
}

console.log("=== PROBE — Ink useInput key/paste delivery (ink-testing-library) ===");
await run("A. multi-char single write 'abc'", "abc");
await run("B. embedded newline 'a\\nb'", "a\nb");
await run("C. embedded CRs 'a\\rb'", "a\rb");
await run("D. bracketed-paste wrapped 'hi\\nyo'", "\x1b[200~hi\nyo\x1b[201~");
await run("E. backslash then CR ('\\\\' then '\\r')", "\\\r");
await run("F. lone CR (Enter)", "\r");
await run("G. lone LF", "\n");
await run("H. up-arrow ESC[A", "\x1b[A");
await run("I. multi-line paste w/ trailing text 'a\\nb\\nc'", "a\nb\nc");
console.log("\nINTERPRETATION: if a multi-char/newline write arrives as ONE call (input=the whole string), the");
console.log("editor treats any multi-char `input` as a literal insert (paste) and splits on \\n/\\r internally;");
console.log("if it arrives per-character, the reducer accretes char-by-char. Either way: Enter = key.return on a");
console.log("lone CR, and `\\`-continuation = an input='\\\\' insert immediately followed by a key.return.");
process.exit(0);
