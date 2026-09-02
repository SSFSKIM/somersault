// One-shot: insert the emitted target footprint for a new splice into its ledger
// row, in the UPSTREAM basis, verifying the bytes hash to what the emitter saw.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { BUNDLE_MODULES } from "./src/pin.js";
import { FOOTPRINTS_PATH, LEDGER_PATH, toUpstreamOffset } from "./ledger/check.js";
import type { FootprintFile } from "./strangle/footprint.js";

const NAME = process.argv[2];
const ROW = process.argv[3];
const fps = JSON.parse(readFileSync(FOOTPRINTS_PATH, "utf8")) as FootprintFile;
const s = (fps.splices ?? []).find((x) => x.name === NAME)!;
const text = readFileSync(join(BUNDLE_MODULES, s.chunk), "utf8");
const start = toUpstreamOffset(s.chunk, s.target.start);
const end = toUpstreamOffset(s.chunk, s.target.end);
const sha = createHash("sha256").update(text.slice(start, end)).digest("hex");
if (sha !== s.target.sha256) throw new Error(`rebased span does not hash to the emitted digest: ${sha} != ${s.target.sha256}`);
const led = JSON.parse(readFileSync(LEDGER_PATH, "utf8")) as { rows: { id: string; footprint?: unknown[] }[] };
const row = led.rows.find((r) => r.id === ROW)!;
(row.footprint ??= []).push({ chunk: s.chunk, target: { start, end, sha256: sha }, captures: [] });
writeFileSync(LEDGER_PATH, JSON.stringify(led, null, 2) + "\n");
console.log(`inserted ${NAME} target ${start}..${end} into ${ROW}`);
