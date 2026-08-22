// Probe 100 — does `listSessions()` silently EXCLUDE an image-only session?
//
// F9's T-IMAGE ledger recorded a suspicion it never proved: the SDK's session listing appears to drop
// sessions whose first user turn carries no extractable text — i.e. a turn that is nothing but image
// content blocks. If true, a ccx user who opens a session by pasting a screenshot and typing nothing
// can never find that session again in the `/resume` picker (src/tui/sessionPickerModel.ts renders
// exactly what `listSessions()` returns, via src/sessions/reader.ts's passthrough wrapper).
//
// Questions:
//   Q1. Does an image-only-first-turn session appear in `listSessions({ dir })` at all?
//   Q2. If it appears, what do `summary` / `firstPrompt` / `customTitle` hold? (`SDKSessionInfo.summary`
//       is documented as "custom title, auto-generated summary, or first prompt" — with no text in the
//       first prompt, all three inputs to that ladder are empty, so the row may be present-but-blank
//       rather than absent. Present-but-blank and absent need DIFFERENT fixes, which is why this probe
//       reports the fields rather than just a boolean.)
//   Q3. Does the transcript exist on disk regardless — i.e. is the exclusion a LISTING-layer filter
//       (recoverable: read the store directly) or a PERSISTENCE failure (not recoverable)? Checked two
//       ways: `getSessionInfo(id)` (documented as a single-session read that does NOT go through the
//       listing) and `getSessionMessages(id)`.
//
//   Q4. THE ONE THAT DECIDES WHETHER ccx IS ACTUALLY EXPOSED. ccx never sends a bare image array: its
//       builder (`assembleUserContent`, harness/src/session/turnInput.ts) ALWAYS emits one text block
//       first, even when the user typed nothing — so the real REPL wire shape for "paste a screenshot,
//       press enter" is `[{type:"text",text:""}, {type:"image",...}]`. Does that EMPTY text block clear
//       whatever gate A trips, or is an empty string just as unextractable as no string at all? A and
//       C differ by exactly that one block, so the answer is attributable to it alone.
//
// Method: three sessions in ONE fresh tmp project dir, so the listing has a positive control.
//   · Session A — first (and only) user turn is `[{type:"image",...}]` with NO text block at all.
//   · Session B — first turn is ordinary text. If B is listed and A is not, the exclusion is real and
//     specific to A's shape rather than to the tmp dir, the model, or persistence being off.
//   · Session C — `[{type:"text",text:""}, {type:"image",...}]`: ccx's own builder output verbatim.
// All three run one cheap haiku turn with `settingSources: []` (no user/project config), every tool
// disallowed (nothing to run, nothing to write), and `persistSession` left at its default (on).
//
// The image is a 1x1 transparent PNG, 68 bytes, inlined as base64 — no network, no fixture file.
//
// SECRETS: this probe never reads, prints, or writes ANTHROPIC_API_KEY / CLAUDE_CODE_OAUTH_TOKEN. Auth
// comes from the ambient env only. Run with:
//   cd CC-to-SDK/probes && set -a; . ../.env; set +a; npx tsx probes/100-listsessions-image-only.ts
//
// RESULT (run 2026-08-23, claude-haiku-4-5): see the ANSWER block at the bottom, written from the run.
import { query, listSessions, getSessionInfo, getSessionMessages, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MODEL = "claude-haiku-4-5-20251001";
const DEADLINE_MS = 180_000;

/** A 1x1 fully-transparent PNG (68 bytes decoded). Smallest thing that is a real, decodable image. */
const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const t0 = Date.now();
const dt = () => `${((Date.now() - t0) / 1000).toFixed(2)}s`;
const log = (s: string) => console.log(`[${dt()}] ${s}`);

type Content = SDKUserMessage["message"]["content"];

/** One-shot streaming-input iterable: yields a single user turn whose content is EXACTLY what the
 *  caller hands over (a bare string, or the content-block array that is the whole point of this probe),
 *  then closes so the session ends after that turn. */
function oneTurn(content: Content): AsyncIterable<SDKUserMessage> {
  return (async function* () {
    yield {
      type: "user",
      message: { role: "user", content },
      parent_tool_use_id: null,
      session_id: "",
    } as unknown as SDKUserMessage;
  })();
}

async function runSession(label: string, cwd: string, content: Content): Promise<string | undefined> {
  const ac = new AbortController();
  const timer = setTimeout(() => { log(`${label}: DEADLINE — aborting`); ac.abort(); }, DEADLINE_MS);
  let sessionId: string | undefined;
  try {
    const q = query({
      prompt: oneTurn(content),
      options: {
        model: MODEL,
        cwd,
        maxTurns: 1,
        abortController: ac,
        settingSources: [],                 // no user/project config bleeding in
        permissionMode: "default",
        // Nothing to run and nothing to write: the turn must be a pure text answer.
        disallowedTools: ["Agent", "Task", "Bash", "Read", "Write", "Edit", "Glob", "Grep", "WebSearch", "WebFetch"],
      },
    });
    for await (const m of q) {
      const mm = m as { type?: string; subtype?: string; session_id?: string; result?: unknown };
      if (mm.type === "system" && mm.subtype === "init") {
        sessionId = mm.session_id;
        log(`${label}: init · session_id=${sessionId}`);
      }
      if (mm.type === "result") {
        const r = typeof mm.result === "string" ? mm.result.replace(/\s+/g, " ").slice(0, 120) : String(mm.result);
        log(`${label}: result (subtype=${mm.subtype}) · ${JSON.stringify(r)}`);
      }
    }
  } catch (e) {
    log(`${label}: THREW ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    clearTimeout(timer);
  }
  return sessionId;
}

const cwd = mkdtempSync(join(tmpdir(), "probe100-"));
console.log("=== PROBE 100 — listSessions() and the image-only first turn ===");
console.log(`cwd: ${cwd} · model: ${MODEL}\n`);

// --- Session A: image-only first turn (NO text block at all) -----------------------------------
const imageOnly: Content = [
  { type: "image", source: { type: "base64", media_type: "image/png", data: PNG_1X1 } },
] as unknown as Content;
const idA = await runSession("A(image-only)", cwd, imageOnly);

// --- Session B: ordinary text first turn (positive control) ------------------------------------
const idB = await runSession("B(text-control)", cwd, "Reply with the single word: ok");

// --- Session C: ccx's ACTUAL builder output — an EMPTY text block, then the image ----------------
const emptyTextPlusImage: Content = [
  { type: "text", text: "" },
  { type: "image", source: { type: "base64", media_type: "image/png", data: PNG_1X1 } },
] as unknown as Content;
const idC = await runSession("C(empty-text+image)", cwd, emptyTextPlusImage);

// --- The listing ---------------------------------------------------------------------------------
console.log("\n--- listSessions({ dir: cwd }) ---");
const rows = await listSessions({ dir: cwd });
log(`returned ${rows.length} row(s)`);
for (const r of rows) {
  console.log(JSON.stringify({
    sessionId: r.sessionId,
    which: r.sessionId === idA ? "A(image-only)" : r.sessionId === idB ? "B(text-control)"
      : r.sessionId === idC ? "C(empty-text+image)" : "?",
    summary: r.summary,
    firstPrompt: r.firstPrompt,
    customTitle: r.customTitle,
    fileSize: r.fileSize,
    lastModified: r.lastModified,
  }, null, 2));
}

const listedA = rows.some((r) => r.sessionId === idA);
const listedB = rows.some((r) => r.sessionId === idB);
const listedC = rows.some((r) => r.sessionId === idC);
console.log(`\nQ1  A(image-only) listed: ${listedA} · B(text-control) listed: ${listedB}`);
console.log(`Q4  C(empty-text+image) listed: ${listedC}  ← ccx's real REPL wire shape`);

// --- Q3: is the transcript there anyway? ----------------------------------------------------------
console.log("\n--- getSessionInfo / getSessionMessages, per session ---");
for (const [label, id] of [["A(image-only)", idA], ["B(text-control)", idB], ["C(empty-text+image)", idC]] as const) {
  if (!id) { log(`${label}: no session id captured — nothing to look up`); continue; }
  let info: unknown;
  try { info = await getSessionInfo(id, { dir: cwd }); }
  catch (e) { info = `THREW ${e instanceof Error ? e.message : String(e)}`; }
  console.log(`${label} getSessionInfo → ${JSON.stringify(info)}`);
  try {
    const msgs = await getSessionMessages(id, { dir: cwd });
    const first = msgs[0] as { type?: string; message?: { content?: unknown } } | undefined;
    const firstContent = first?.message?.content;
    console.log(`${label} getSessionMessages → ${msgs.length} message(s); first.type=${first?.type}; `
      + `first.content=${typeof firstContent === "string" ? JSON.stringify(firstContent.slice(0, 80)) : JSON.stringify(firstContent)?.slice(0, 200)}`);
  } catch (e) {
    console.log(`${label} getSessionMessages → THREW ${e instanceof Error ? e.message : String(e)}`);
  }
}

console.log("\n=== VERDICT ===");
if (!idA) console.log("INCONCLUSIVE — session A never reported an init session_id.");
else if (!listedB) console.log("INCONCLUSIVE — the text control is also missing; the listing itself did not see this project dir.");
else if (listedA) console.log("NO EXCLUSION — the image-only session is listed. Check its summary/firstPrompt fields above for blankness.");
else {
  console.log("EXCLUSION CONFIRMED — the image-only session is absent from listSessions() while the text control is present.");
  console.log(listedC
    ? "  …and ccx is NOT exposed: the empty leading text block (C) is enough to keep the session listed."
    : "  …and ccx IS exposed: even the empty leading text block (C) that ccx always sends does not rescue the row.");
}

// ==================================================================================================
// ANSWER — live run 2026-08-23, SDK 0.3.237, claude-haiku-4-5, OAuth (subscription) auth.
// Run twice with the same outcome; the second run is transcribed here.
//
//   Q1. EXCLUDED. `listSessions({ dir })` returned exactly ONE row for a project dir holding three
//       persisted sessions — the text control B. A (image-only) and C (empty text + image) are absent.
//
//   Q2. Not applicable: there is no row to inspect. The exclusion is total, not a blank-summary row.
//       (B's row for reference: summary "Reply with ok", firstPrompt "Reply with the single word: ok",
//       and an auto-assigned customTitle "Reply with ok".)
//
//   Q3. LISTING-LAYER, and the transcripts are intact. `getSessionMessages(id, { dir })` returned all
//       3 messages for A and for C, with the image blocks byte-identical to what was sent. But
//       `getSessionInfo(id, { dir })` ALSO returned `undefined` for both — so the exclusion is not
//       confined to the listing walk. Both metadata readers share one extractor, and it is that
//       extractor which declines the session. Recovery is therefore possible only by session ID, and
//       only through `getSessionMessages` (or a direct JSONL read) — never through either metadata API.
//
//       Visible mechanism on disk (~/.claude/projects/<slug>/<id>.jsonl, line 0): every session opens
//       with a `{"type":"queue-operation","operation":"enqueue",...}` record, and that record carries a
//       `content` field holding the prompt TEXT. For B it reads `"content": "Reply with the single
//       word: ok"`. For A and C the key is absent entirely. The `user` record itself (line 2) is
//       written correctly in all three cases, image blocks and all — so what the metadata extractor
//       cannot find is the first-prompt TEXT, not the session.
//
//   Q4. ccx IS EXPOSED — this is the finding that matters. The empty leading text block that
//       `assembleUserContent` unconditionally emits does NOT rescue the row: C is excluded exactly as A
//       is. An empty string is as unextractable as no string. So the real ccx gesture — paste a
//       screenshot into the composer, press enter without typing anything — persists a full transcript
//       that the `/resume` picker can never show, because the picker renders `listSessions()` output
//       (src/tui/useChat.ts:691 → src/sessions/reader.ts:12 → the SDK). The session is not lost, but it
//       is unfindable by any means the UI offers.
//
//       Two candidate compensations, both open to ccx and neither requiring SDK cooperation:
//         (a) never send a first turn whose text is empty — substitute a placeholder ("[image]", or
//             canon's own chip label) at the builder, which makes the row extractable at the source;
//         (b) union a direct JSONL scan into the reader wrapper so the picker sees sessions the SDK's
//             extractor dropped. Costlier, but it also recovers sessions already stranded.
// ==================================================================================================
