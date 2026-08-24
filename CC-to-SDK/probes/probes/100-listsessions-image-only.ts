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
//   Q5 (Task 1). C was built BY HAND to match the composer's output — does the TRANSPORT layer (a REAL
//       `SessionHost` + `remoteChatSession` socket loopback) rescue an already-empty-text array once one
//       is handed to it? (This does NOT test the REPL's actual paste-and-send gesture, which never
//       produces an empty-text array in the first place — see the corrected VERDICT below.) And does the
//       DIRECT library shape `Session.submit([image])` (no text block) hit the same wall as bare-array A?
//
// Method: five sessions in ONE fresh tmp project dir, so the listing has a positive control.
//   · Session A — first (and only) user turn is `[{type:"image",...}]` with NO text block at all.
//   · Session B — first turn is ordinary text. If B is listed and A is not, the exclusion is real and
//     specific to A's shape rather than to the tmp dir, the model, or persistence being off.
//   · Session C — `[{type:"text",text:""}, {type:"image",...}]`: ccx's own builder output verbatim.
//   · Session D — the SAME shape as C, but produced by a hand-built `assembleUserContent("", …)` call
//     (an empty text argument passed directly — NOT what the composer's real paste-and-send gesture
//     produces, see the corrected VERDICT below) and carried over a REAL `SessionHost` +
//     `remoteChatSession` loopback (the socket transport `chatMain.tsx`'s `buildSession` uses) rather
//     than handed to `query()` directly — settles only whether the TRANSPORT layer rescues an
//     already-empty-text array; it does not.
//   · Session E — the direct library shape: `new Session({query}).submit([{type:"image",...}])`, no
//     text block at all — an existing supported call shape (pinned by
//     test/integration/host-image-transport.test.ts) that a library caller can reach without ever
//     touching the composer.
// All five run one cheap haiku turn with `settingSources: []` (no user/project config), every tool
// disallowed (nothing to run, nothing to write), and `persistSession` left at its default (on).
//
// The image is a 1x1 transparent PNG, 68 bytes, inlined as base64 — no network, no fixture file.
//
// SECRETS: this probe never reads, prints, or writes ANTHROPIC_API_KEY / CLAUDE_CODE_OAUTH_TOKEN. Auth
// comes from the ambient env only. Run with:
//   cd CC-to-SDK/probes && set -a; . ../.env; set +a; npx tsx probes/100-listsessions-image-only.ts
//
// RESULT (run 2026-08-23, SDK 0.3.237, claude-haiku-4-5): see the ANSWER block at the bottom.
import { query, listSessions, getSessionInfo, getSessionMessages, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// D/E (F10 T-IMGREACH Task 1): the REAL topologies, imported cross-package through tsx's `.js`→`.ts`
// resolution — Node resolves a relative specifier from the IMPORTED FILE's own location, so
// harness/src/**'s imports are satisfied by harness/node_modules regardless of who required it in.
import { SessionHost } from "../../harness/src/host/host.js";
import { remoteChatSession } from "../../harness/src/client/chatAdapter.js";
import { Session } from "../../harness/src/session/session.js";
import { assembleUserContent } from "../../harness/src/session/turnInput.js";
import { hostSocketPath } from "../../harness/src/fleet/paths.js";

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

/** The same knobs `runSession` gives `query()` directly, reused for D/E's real `Session`. */
const engineOptions = {
  model: MODEL, cwd, maxTurns: 1, settingSources: [] as never[], permissionMode: "default" as const,
  disallowedTools: ["Agent", "Task", "Bash", "Read", "Write", "Edit", "Glob", "Grep", "WebSearch", "WebFetch"],
};

// --- Session D: the REAL REPL topology — SessionHost + remoteChatSession loopback, ccx's own builder --
let idD: string | undefined;
{
  const fleetRoot = mkdtempSync(join(tmpdir(), "probe100-fleet-"));
  const hostEnv = { ...process.env, CCX_FLEET_ROOT: fleetRoot } as NodeJS.ProcessEnv;
  const host = new SessionHost(
    { short: "0010ad01", name: "probe100d", cwd, kind: "bg", detached: true, config: {} as never, env: hostEnv },
    { openSession: () => new Session({ query }, engineOptions) as unknown as never, procStartOf: async () => "start" },
  );
  await host.start();
  const socketPath = hostSocketPath(process.pid, hostEnv);
  const adapterD = remoteChatSession(socketPath);
  try {
    // NOT what the composer's real paste-and-send gesture produces (review, 2026-08-23): the editor
    // inserts the literal `[Image #N]` label as text, and `sweepOrphanImages` prunes the image entry the
    // moment its label stops matching — so no interactive path calls `assembleUserContent` with an empty
    // string here. This is a hand-built empty-text call, one call down from `assembleSubmission`
    // (tui/pasteChips.ts), used only to test whether the TRANSPORT rescues an already-empty-text array.
    const contentD = assembleUserContent("", [{ data: PNG_1X1, mediaType: "image/png" }]);
    await adapterD.submit(contentD, () => {});
    idD = adapterD.sessionId;
    log(`D(REPL-topology): session_id=${idD}`);
  } catch (e) {
    log(`D(REPL-topology): THREW ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    adapterD.detach();
    await host.stop().catch(() => {});
  }
}

// --- Session E: the direct library shape — Session.submit([image]), no text block at all -------------
let idE: string | undefined;
{
  const sessionE = new Session({ query }, engineOptions);
  try {
    const bareImage = [{ type: "image", source: { type: "base64", media_type: "image/png", data: PNG_1X1 } }] as const;
    await sessionE.submit(bareImage as never);
    idE = sessionE.sessionId;
    log(`E(direct-Session.submit): session_id=${idE}`);
  } catch (e) {
    log(`E(direct-Session.submit): THREW ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    await sessionE.dispose();
  }
}

// --- The listing ---------------------------------------------------------------------------------
console.log("\n--- listSessions({ dir: cwd }) ---");
const rows = await listSessions({ dir: cwd });
log(`returned ${rows.length} row(s)`);
for (const r of rows) {
  console.log(JSON.stringify({
    sessionId: r.sessionId,
    which: r.sessionId === idA ? "A(image-only)" : r.sessionId === idB ? "B(text-control)"
      : r.sessionId === idC ? "C(empty-text+image)" : r.sessionId === idD ? "D(REPL-topology)"
      : r.sessionId === idE ? "E(direct-Session.submit)" : "?",
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
const listedD = rows.some((r) => r.sessionId === idD);
const listedE = rows.some((r) => r.sessionId === idE);
console.log(`\nQ1  A(image-only) listed: ${listedA} · B(text-control) listed: ${listedB}`);
console.log(`Q4  C(empty-text+image) listed: ${listedC}  ← ccx's real REPL wire shape`);
console.log(`Q5  D(REPL-topology, real host+socket) listed: ${listedD} · E(direct Session.submit([image])) listed: ${listedE}`);

// --- Q3: is the transcript there anyway? ----------------------------------------------------------
console.log("\n--- getSessionInfo / getSessionMessages, per session ---");
for (const [label, id] of [["A(image-only)", idA], ["B(text-control)", idB], ["C(empty-text+image)", idC], ["D(REPL-topology)", idD], ["E(direct-Session.submit)", idE]] as const) {
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
  console.log(idD === undefined
    ? "  D(REPL-topology): no session id captured — see the THREW line above."
    : `  D(REPL-topology) listed: ${listedD} ${listedD === listedC ? "(agrees with C — the socket transport changes nothing)" : "(DISAGREES WITH C — the transport itself matters)"}`);
  console.log(idE === undefined
    ? "  E(direct-Session.submit): no session id captured — see the THREW line above."
    : `  E(direct-Session.submit) listed: ${listedE} ${listedE === listedA ? "(agrees with A — the library path is equally exposed)" : "(DISAGREES WITH A)"}`);
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
//
// -------------------------------------------------------------------------------------------------
// TASK 1 ADDENDUM — live run 2026-08-23, SDK 0.3.237, claude-haiku-4-5, OAuth (subscription) auth,
// cells D and E added to settle the two questions the original A/B/C run left open (both against the
// REAL topologies, not a hand-built array):
//
//   D. CORRECTED (review, 2026-08-23) — the original wording here claimed "THE SHIPPED REPL IS EXPOSED
//      TODAY, not just the library." That overstates cell D. Cell D calls `assembleUserContent("", …)`
//      DIRECTLY, by hand, with a literal empty-string text argument — it does not exercise the
//      composer's actual paste-and-send gesture. Verified fact: the shipped REPL's default
//      paste-and-send gesture was NEVER stranded — the editor inserts the literal `[Image #N]` label as
//      text, and `sweepOrphanImages` prunes the image entry the moment its label stops matching, so no
//      interactive path produces an empty-text image submission. What D actually proves: D's session
//      (a7c3dd85…) is ABSENT from `listSessions()`, agreeing exactly with hand-built C, so the
//      TRANSPORT (a real `SessionHost` + `remoteChatSession` socket loopback, the staging round-trip,
//      and the host's `assembleStagedContent` reassembly) does not rescue an ALREADY-EMPTY-TEXT array
//      once one is handed to it — it changes nothing about what the SDK's extractor judges. The
//      live-proven stranding paths are the direct library call (cell E) and any caller handing an
//      already-empty-text array to the transport — not the shipped REPL's own composer path.
//
//   E. `new Session({query}, opts).submit([image])` — a bare image array, no text block at all, the
//      one call shape a LIBRARY caller can reach without ever touching the composer (and the shape
//      `test/integration/host-image-transport.test.ts` pins as a supported input) — strands exactly
//      like A. E's session (a68e4e58…) is absent too. This is the shape Task 1's fix inserts a label
//      into (`isStrandedTurn` + the INSERT branch of `normalizeTurnInput`), and this run is the
//      "before" baseline the fix's unit tests (turnInput.test.ts, session.test.ts) key off of.
//
//   Net: the LIVE-PROVEN stranding paths are the direct library call (E) and any caller handing an
//   already-empty-text array to the transport (A, C, D) — not the shipped REPL's own composer path,
//   which never produces one (see D's correction above). The Task 1 fix (a synthetic `[Image #N]` label
//   substituted into the first text block, or inserted at index 0 when none exists) is applied
//   defensively at the shared Session message-builder boundary (`normalizeTurnInput`), which is upstream
//   of ALL FOUR shapes this probe has exercised (A, C, D, E) — so it also covers the REPL should its
//   composer's guarantee ever change, even though today's composer keeps the REPL out of reach of this.
// ==================================================================================================
