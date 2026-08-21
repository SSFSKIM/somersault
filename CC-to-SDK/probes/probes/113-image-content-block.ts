// Probe 113 — Does the installed @anthropic-ai/claude-agent-sdk accept an IMAGE content block
// headlessly, and does the model actually SEE the pixels?
//
// Why this probe exists: ccx's parity scorecard marks image paste (ctrl+v) ❌, and the blocking
// premise is not the clipboard read (canon's mechanism is a plain `osascript`/`xclip` shell-out we
// can copy) but the LAST HOP — whether a user message whose `content` array carries
// `{type:"image", source:{type:"base64", ...}}` survives the SDK's stdio transport into the API.
// Declared ≠ reachable: sdk.d.ts:4939-4944 types `SDKUserMessage.message` as `MessageParam` and its
// own doc string names image blocks explicitly ("...content is a string or an array of content
// blocks (text, image, document, tool_result, ...)"), but a declared type is not a live wire.
//
// Two failure modes we must be able to tell apart:
//   (a) SCHEMA REJECTED — the CLI or API 400s on the block (unreachable, full stop).
//   (b) SCHEMA ACCEPTED BUT BLIND — the frame is swallowed / stripped and the model answers from the
//       text alone. A model asked "what colour is this image" with no image will still emit *a*
//       colour word. So one image is not proof. We send RED first and BLUE second, in the same
//       streaming session: only a model that actually decodes the pixels flips its answer.
//
// Two images are also the multi-turn check the brief asks for (second turn on a live session).
//
// PNGs are generated deterministically (64x64 solid RGB, hand-rolled IHDR/IDAT/IEND with zlib) so
// the probe has no fixture files and no image dependency. Both are 168 bytes.
//
// Keying: follows probe 111 — the credential is READ from ../../.env rather than sourced, so the
// probe works from a worktree too. `ANTHROPIC_API_KEY` is deleted unconditionally because it shadows
// the OAuth token. Nothing prints a credential value; only the boolean "keyed:".
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { query } from "@anthropic-ai/claude-agent-sdk";

function loadKey(): void {
  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    const file = process.env.CCX_ENV_FILE ?? resolve(import.meta.dirname, "../../.env");
    try {
      for (const line of readFileSync(file, "utf8").split("\n")) {
        const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
        if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
      }
    } catch (e) { console.log("[env] could not read env file:", (e as Error)?.name); }
  }
  // The API key SHADOWS the OAuth token, and OAuth bills the subscription — so it goes by default.
  // `CCX_ALLOW_API_KEY=1` keeps it, which is the escape hatch when the subscription is rate-limited
  // and a decisive answer is worth a few metered cents (this probe's whole run is ~200 tokens).
  if (!process.env.CCX_ALLOW_API_KEY) delete process.env.ANTHROPIC_API_KEY;
  console.log(
    "[env] credential present — oauth:", Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN),
    "| api key:", Boolean(process.env.ANTHROPIC_API_KEY),
  );
}
loadKey();

const log = (...a: unknown[]) => console.log("[p113]", ...a);

// ---------------------------------------------------------------------------------------------
// A deterministic solid-colour PNG, built by hand (no image library).
function solidPng(r: number, g: number, b: number, size = 64): string {
  const crc = (buf: Buffer) => {
    let c = ~0;
    for (const byte of buf) { c ^= byte; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
    return ~c >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit, truecolour RGB
  const raw = Buffer.alloc(size * (1 + size * 3));
  for (let y = 0; y < size; y++) {
    const o = y * (1 + size * 3);
    raw[o] = 0; // filter: none
    for (let x = 0; x < size; x++) { raw[o + 1 + x * 3] = r; raw[o + 2 + x * 3] = g; raw[o + 3 + x * 3] = b; }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]).toString("base64");
}

const RED = solidPng(255, 0, 0);
const BLUE = solidPng(0, 0, 255);
log("fixture bytes — red:", Buffer.from(RED, "base64").length, "blue:", Buffer.from(BLUE, "base64").length);

const PROMPT = "Reply with only the dominant color of this image, one word.";

// ---------------------------------------------------------------------------------------------
// Streaming-input session (probe 111's `openStreaming`, generalised: `send` takes a content ARRAY,
// which is the whole point here — the one-shot `prompt: string` form has no way to carry a block).
function openStreaming() {
  let push: (() => void) | null = null;
  let done = false;
  const queue: unknown[] = [];
  async function* input() {
    while (!done) {
      if (queue.length) { yield queue.shift() as never; continue; }
      await new Promise<void>((r) => { push = () => { push = null; r(); }; });
    }
  }
  const q = query({
    prompt: input() as never,
    options: { permissionMode: "bypassPermissions", allowDangerouslySkipPermissions: true } as never,
  });
  const send = (content: unknown) => {
    queue.push({ type: "user", message: { role: "user", content }, parent_tool_use_id: null, session_id: "" });
    push?.();
  };
  const end = () => { done = true; push?.(); };
  return { q, send, end };
}

const S = openStreaming();

type Turn = { label: string; text: string[]; error: string[] };
const turns: Turn[] = [];
const seenTypes: string[] = [];
// One mutable cell rather than bare `let`s: the reader loop and the turn driver both touch these,
// and a plain `let` assigned only inside a closure reads as never-reassigned to a type-checker.
const state: { current: Turn | null; hardError: string | null; resolveTurn: (() => void) | null } =
  { current: null, hardError: null, resolveTurn: null };

const reader = (async () => {
  try {
    for await (const m of S.q) {
      const msg = m as Record<string, unknown>;
      const tag = `${msg.type}${msg.subtype ? `/${msg.subtype}` : ""}`;
      seenTypes.push(tag);
      if (msg.type === "assistant") {
        const content = ((msg.message as Record<string, unknown>)?.content as Array<Record<string, unknown>>) ?? [];
        const text = content.filter((b) => b.type === "text").map((b) => String(b.text)).join("");
        if (text.trim()) { log("ASSISTANT:", JSON.stringify(text.trim())); state.current?.text.push(text.trim()); }
      }
      // Anything that looks like a transport/API complaint is the (a)-vs-(b) discriminator.
      if (msg.type === "result" || tag.includes("error") || tag.includes("refusal")) {
        log("FRAME", tag, JSON.stringify(msg).slice(0, 900));
        if (msg.type === "result") {
          if (msg.is_error) state.current?.error.push(String(msg.result ?? msg.subtype));
          state.resolveTurn?.();
        }
      }
    }
  } catch (e) {
    state.hardError = `${(e as Error)?.name}: ${(e as Error)?.message}`;
    log("STREAM THREW:", state.hardError);
    state.resolveTurn?.();
  }
})();

async function runTurn(label: string, content: unknown): Promise<Turn> {
  const t: Turn = { label, text: [], error: [] };
  turns.push(t); state.current = t;
  const settled = new Promise<void>((r) => { state.resolveTurn = () => { state.resolveTurn = null; r(); }; });
  S.send(content);
  await Promise.race([settled, new Promise((r) => setTimeout(r, 120_000))]);
  state.current = null;
  return t;
}

// TURN 0 — CONTROL. A text-only turn through the exact same streaming session. Without it, ANY
// failure (expired credential, rate limit, transport fault) is indistinguishable from "the image
// block was rejected", and the probe would report a false negative. The first live run of this probe
// did exactly that: a 429 weekly-limit result made the verdict read UNREACHABLE when nothing about
// the image had been tested. The control turn is what makes the image verdict attributable.
await new Promise((r) => setTimeout(r, 500));
const t0 = await runTurn("turn0 CONTROL text-only", [{ type: "text", text: "Reply with only the word: ok" }]);
const controlOk = !state.hardError && t0.error.length === 0 && t0.text.length > 0;
log("CONTROL healthy (credential + transport + streaming input all work):", controlOk);
if (!controlOk) {
  log("---");
  log("VERDICT: INCONCLUSIVE — the control turn failed, so the image block was never actually tested.");
  log("control error:", JSON.stringify(t0.error), "| hard error:", state.hardError ?? "none");
  S.end();
  process.exit(0);
}

// TURN 1 — image block FIRST, then the text. This is the order canon builds
// (cli.pretty.js:371417 puts the text block first for queued commands, but the live composer path
// appends image blocks after the typed text; either order is legal MessageParam, and turn 2 varies
// it so an order-sensitivity would show up).
await new Promise((r) => setTimeout(r, 500));
const t1 = await runTurn("turn1 IMAGE image-then-text (red)", [
  { type: "image", source: { type: "base64", media_type: "image/png", data: RED } },
  { type: "text", text: PROMPT },
]);

// TURN 2 — same live session, text FIRST, and a DIFFERENT colour. If turn 2 says "blue" the model is
// reading pixels; if it repeats "red" or guesses, the block is decorative.
const t2 = state.hardError ? { label: "turn2 (skipped)", text: [], error: ["skipped: stream already dead"] } as Turn
  : await runTurn("turn2 text-then-image (blue)", [
      { type: "text", text: PROMPT },
      { type: "image", source: { type: "base64", media_type: "image/png", data: BLUE } },
    ]);

S.end();
await Promise.race([reader, new Promise((r) => setTimeout(r, 5_000))]);

// ---------------------------------------------------------------------------------------------
const said = (t: Turn, word: string) => t.text.join(" ").toLowerCase().includes(word);
const accepted = !state.hardError && t1.error.length === 0 && t1.text.length > 0;
const sawRed = said(t1, "red");
const sawBlue = said(t2, "blue");

log("---");
log("message types seen:", [...new Set(seenTypes)].join(","));
for (const t of turns) log("TURN", t.label, "| text:", JSON.stringify(t.text), "| error:", JSON.stringify(t.error));
log("hard stream error:", state.hardError ?? "none");
log("SCHEMA ACCEPTED (no 400 / no throw, a real assistant turn came back):", accepted);
log("TURN1 named RED:", sawRed, "| TURN2 named BLUE:", sawBlue);
log(
  "VERDICT:",
  !accepted
    ? "UNREACHABLE — the image content block was rejected (see the error above)"
    : sawRed && sawBlue
      ? "REACHABLE — schema accepted AND the model read the pixels on both turns (colour flipped red→blue, so it is not guessing)"
      : sawRed || sawBlue
        ? "PARTIAL — accepted, one turn read the pixels; check the other turn's text above"
        : "ACCEPTED BUT BLIND — no 400, but neither turn named its colour: the block is being stripped",
);
process.exit(0);
