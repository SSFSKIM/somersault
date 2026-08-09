// tui/src/suggester.ts — Wave C Task 12 (EP-C5): the follow-up suggestion the composer offers as ghost
// placeholder text after a turn ends. Two halves in one module: the PURE transcription (upstream's prompt,
// its twelve-rule post-filter, its eligibility chain, its four-state machine) and the GENERATOR, which is the
// one place ccx deliberately parts ways with upstream.
//
// Transcribed from 2.1.220 (annex §C5.1-C5.7):
//  · `EOy`  (L235222)   the prompt — copied byte for byte below, pinned against the annex by the unit test.
//  · `SOy`  (L235208)   the generator call.
//  · `AOy`  (L235223)   the twelve rejection rules.
//  · `ixs`  (L235141)   the eligibility chain; `yOy` (L235128) its app-state half.
//  · `acd`  (L235165)   the fire-and-forget trigger at the end of an assistant turn.
//  · `scd`  (L235125)   the keystroke abort; `q1t` (L235222) the controller it aborts.
//  · L399215/L399223    the state slice, its four statuses and the two helpers over them.
//
// THE ONE BIG DIVERGENCE — WHERE THE SUGGESTION COMES FROM (spec decision D-C5, and it is why this module
// exists at all). Upstream generates the suggestion by FORKING the live conversation (`C3` =
// `runForkedAgent`): the whole transcript is replayed as fork context, the session's own system prompt and
// its current main-loop model are reused, and the whole thing is nearly free because it piggybacks on the
// main thread's warm prompt cache. Two facts make that unavailable here:
//   1. The SDK's own `prompt_suggestion` channel is DEAD headlessly — probe 100 ran four sessions and twelve
//      turns with `promptSuggestions: true` and got zero frames; the emitter is bound to a surface the SDK
//      transport does not have. So ccx must generate the suggestion itself.
//   2. There is no fork-with-cache-piggyback to generate it from. Measured (probe 100b/100c): a cold
//      one-shot `query()` per suggestion costs ~8.1 s and ~$0.010 — a second agent beside the real one.
// So ccx keeps ONE WARM SUGGESTER SESSION on a Haiku-class model and pushes the transcript tail through it:
// ~5.0 s and ~$0.0045 per suggestion with no cost creep over consecutive requests (probe 100c, four tails).
// The prompt below is upstream's, unchanged; what differs is the model, and that the conversation arrives as
// TEXT in the same message rather than as real fork context.
//
// TWO CONSEQUENCES WORTH NAMING, both accepted in the spec:
//  · The suggester's spend is NOT folded into `/cost`, which reads the main engine's usage. Upstream's fork
//    is likewise invisible (`skipTranscript: !0`), so this matches — but it is an accounting gap, not a zero.
//  · At ~5 s the suggestion lands well after the reply is on screen. It must never block the composer, a
//    keystroke must abort it, and one that lands after the user started typing is discarded (`timing`).

/** `EOy` (bundle L235222), VERBATIM — 32 lines, no trailing newline, sent as a normal (non-meta) user
 *  message after the conversation. Pinned against the annex file itself by `test/unit/suggester.test.ts`:
 *  a transcription this long is exactly the kind that rots without anyone noticing. */
export const SUGGESTION_PROMPT = `[SUGGESTION MODE: Suggest what the user might naturally type next into Claude Code.]

FIRST: Look at the user's recent messages and original request.

Your job is to predict what THEY would type - not what you think they should do.

THE TEST: Would they think "I was just about to type that"?

EXAMPLES:
User asked "fix the bug and run tests", bug is fixed → "run the tests"
After code written → "try it out"
Claude offers options → suggest the one the user would likely pick, based on conversation
Claude asks to continue → "yes" or "go ahead"
Task complete, obvious follow-up → "commit this" or "push it"
After error or misunderstanding → silence (let them assess/correct)

Be specific: "run the tests" beats "continue".

NEVER SUGGEST:
- Evaluative ("looks good", "thanks")
- Questions ("what about...?")
- Claude-voice ("Let me...", "I'll...", "Here's...")
- New ideas they didn't ask about
- Multiple sentences

Stay silent if the next step isn't obvious from what the user said.

Stay silent if a suggestion could be unsafe or inappropriate — including any sensitive topic (security incidents, credentials, harm, private data). Even when the user is doing legitimate security or cybersecurity work, do not predict potentially unsafe actions.

Format: 2-12 words, match the user's style. Or nothing.

Reply with ONLY the suggestion, no quotes or explanation.`;

// DIVERGENCE: upstream uses THE SESSION'S CURRENT MAIN-LOOP MODEL (annex §C5.3: "no tier alias, no explicit
// id … This is not a Haiku call"). ccx cannot: upstream's model choice is affordable only because the fork
// rides the main thread's prompt cache, and our separate suggester session has no such cache to ride. The
// alias — not an explicit id — is deliberate: `resolveModelAlias` leaves `haiku` to the SDK, whose own
// catalog already points it at the current Haiku (models.ts).
export const SUGGESTER_MODEL = "haiku";

/** How much conversation the request carries. Upstream sends the WHOLE transcript (it is a fork, and the
 *  cache makes that free); ours pays per token, so it sends a tail. Six messages covers "what the user just
 *  asked and what came back" — which is all the prompt above actually reasons over — and the per-message cap
 *  keeps one pasted stack trace from doubling the bill. */
export const TAIL_MESSAGES = 6;
export const TAIL_MESSAGE_CHARS = 1200;

export interface TailMessage { role: "user" | "assistant"; text: string }

/** probe 100c's own tail format (`user: …` / `assistant: …`, oldest first) — the shape the ~$0.0045 and
 *  ~5.0 s figures were measured against, so the implementation should not quietly use another. */
export function formatTranscriptTail(entries: readonly TailMessage[], o: { maxMessages?: number; maxChars?: number } = {}): string {
  const maxMessages = o.maxMessages ?? TAIL_MESSAGES, maxChars = o.maxChars ?? TAIL_MESSAGE_CHARS;
  return entries.slice(Math.max(0, entries.length - maxMessages))
    .map((e) => `${e.role}: ${e.text.length > maxChars ? `${e.text.slice(0, maxChars)}…` : e.text}`)
    .join("\n");
}

/** The user message the suggester session is handed. The prompt goes LAST because that is where upstream
 *  puts it — appended after the whole conversation — and the prompt's own first instruction ("FIRST: Look at
 *  the user's recent messages") reads as an instruction about text that precedes it. */
export function suggestionRequestMessage(transcriptTail: string): string {
  return `${transcriptTail}\n\n${SUGGESTION_PROMPT}`;
}

// ── Response cleanup (annex §C5.3, L235214) ────────────────────────────────────────────────────────────────
// DIVERGENCE (elision, not a choice): the annex gives the tag list in full — `suggestion|response|output|
// answer|result` — but abbreviates the LABEL list to "`suggested response:` / `suggestion:` / `reply:` / …".
// The four named ones are transcribed; the tag names are reused as labels too, which is the obvious shape of
// the elided tail and costs nothing if upstream's list is longer. Anything this misses still meets
// `prefixed_label` below, so an unstripped label is rejected rather than shown.
const WRAPPER_TAGS = "suggestion|response|output|answer|result";
const WRAPPED = new RegExp(`^<(${WRAPPER_TAGS})>([\\s\\S]*)</\\1>$`, "i");
const LEADING_LABEL = new RegExp(`^(?:suggested response|suggested reply|reply|${WRAPPER_TAGS}):\\s*`, "i");

export function cleanSuggestion(raw: string): string {
  let text = raw.trim();
  const wrapped = WRAPPED.exec(text);
  if (wrapped) text = wrapped[2].trim();
  return text.replace(LEADING_LABEL, "").trim();
}

// ── `AOy`'s twelve rules (annex §C5.3) ─────────────────────────────────────────────────────────────────────
// Each rule logs its own rejection reason upstream; here the reason is the return value, which is what makes
// the table testable one fixture at a time. ORDER IS PART OF THE TRANSCRIPTION — `error_message` before
// `prefixed_label` is why `api error: 529` is reported as an error rather than as a label, and
// `too_few_words` before `too_many_words` is why a one-word reply never reads as thirteen.
const META_SILENCE = /\bsilence is\b|\bstay(s|ing)? silent\b/;
const META_BARE_SILENCE = /^\W*silence\W*$/;
const META_WRAPPED = /^\(.*\)$|^\[.*\]$/;
const ERROR_PREFIXES = ["api error:", "prompt is too long", "request timed out", "invalid api key", "image was too large"];
const PREFIXED_LABEL = /^\w+:\s/;
/** The `too_few_words` exemption list, verbatim and in the annex's order. */
export const SHORT_ALLOWLIST = ["yes", "yeah", "yep", "yea", "yup", "sure", "ok", "okay", "push", "commit", "deploy", "stop", "continue", "check", "exit", "quit", "no"];
const MULTIPLE_SENTENCES = /[.!?]\s+[A-Z]/;
const HAS_FORMATTING = /[\n*]|\*\*/;
const EVALUATIVE = /thanks|thank you|looks good|sounds good|that works|that worked|that's all|nice|great|perfect|makes sense|awesome|excellent/;
const CLAUDE_VOICE = /^(let me|i'll|i've|i'm|i can|i would|i think|i notice|here's|here is|here are|that's|this is|this will|you can|you should|you could|sure,|of course|certainly)/i;

export type PostFilterVerdict = { ok: true; text: string } | { ok: false; reason: string };

export function postFilterSuggestion(text: string): PostFilterVerdict {
  const t = text.trim();
  if (!t) return { ok: false, reason: "empty" };
  const lower = t.toLowerCase();
  if (lower === "nothing found" || lower === "nothing found." || lower.startsWith("nothing to suggest") || lower.startsWith("no suggestion")
      || META_SILENCE.test(lower) || META_BARE_SILENCE.test(lower)) return { ok: false, reason: "meta_text" };
  if (META_WRAPPED.test(t)) return { ok: false, reason: "meta_wrapped" };
  if (ERROR_PREFIXES.some((p) => lower.startsWith(p))) return { ok: false, reason: "error_message" };
  if (PREFIXED_LABEL.test(t)) return { ok: false, reason: "prefixed_label" };
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < 2 && !t.startsWith("/") && !SHORT_ALLOWLIST.includes(lower)) return { ok: false, reason: "too_few_words" };
  if (words.length > 12) return { ok: false, reason: "too_many_words" };
  if (t.length >= 100) return { ok: false, reason: "too_long" };
  if (MULTIPLE_SENTENCES.test(t)) return { ok: false, reason: "multiple_sentences" };
  if (HAS_FORMATTING.test(t)) return { ok: false, reason: "has_formatting" };
  if (EVALUATIVE.test(lower)) return { ok: false, reason: "evaluative" };
  if (CLAUDE_VOICE.test(t)) return { ok: false, reason: "claude_voice" };
  return { ok: true, text: t };
}

// ── The eligibility chain (`ixs` L235141 + `yOy` L235128, annex §C5.2) ─────────────────────────────────────
export interface SuggestionEligibility {
  /** An abort that landed before the request went out (`scd` during the same tick). */
  aborted?: boolean;
  /** How many ASSISTANT messages the conversation holds. Fewer than two is `early_conversation`. */
  assistantMessages: number;
  /** The turn that just ended reported an error. */
  lastTurnError?: boolean;
  enabled: boolean;
  pendingPermission?: boolean;
  elicitationActive?: boolean;
  mode: string;
  rateLimited?: boolean;
}

/** The suppression reason, or null when the turn is eligible. Upstream logs each reason as telemetry; ccx has
 *  no telemetry, so the reason is the return value and the caller simply declines to generate.
 *
 *  DIVERGENCE (spec EP-C5, review finding #7): upstream's fourth rule, `cache_cold` (`bOy`, L235202 — the
 *  last assistant turn exceeding 1e4 input+cache+output tokens), is NOT ported. Its entire rationale is that
 *  the fork piggybacks on the main thread's prompt cache and a cold cache makes the fork expensive. Our
 *  suggester is a SEPARATE warm session that never touches that cache, so the rule would suppress
 *  suggestions for a cost that does not exist here. */
export function suggestionSuppression(ctx: SuggestionEligibility): string | null {
  if (ctx.aborted) return "aborted";
  if (ctx.assistantMessages < 2) return "early_conversation";
  if (ctx.lastTurnError) return "last_response_error";
  if (!ctx.enabled) return "disabled";
  if (ctx.pendingPermission) return "pending_permission";
  if (ctx.elicitationActive) return "elicitation_active";
  if (ctx.mode === "plan") return "plan_mode";
  if (ctx.rateLimited) return "rate_limit";
  return null;
}

// ── The four-state machine (annex §C5.4, L399215/L399223) ─────────────────────────────────────────────────
export type PromptSuggestion =
  | { status: "empty" }
  | { status: "generated"; text: string }
  | { status: "shown"; text: string; shownAt: number }
  | { status: "accepted"; text: string; shownAt: number; acceptedAt: number };

export const EMPTY_SUGGESTION: PromptSuggestion = { status: "empty" };

/** `wYe` (L399215). */
export function suggestionVisible(s: PromptSuggestion): boolean { return s.status === "shown" || s.status === "accepted"; }
/** `Bgn` (L399215). */
export function suggestionText(s: PromptSuggestion): string | null { return s.status === "empty" ? null : s.text; }

/** `markShown` (L489792/L495702). Identity-stable when there is nothing to stamp, so the caller can set state
 *  unconditionally without churning a render. */
export function markSuggestionShown(s: PromptSuggestion, now: number): PromptSuggestion {
  return s.status === "generated" ? { status: "shown", text: s.text, shownAt: now } : s;
}
/** `markAccepted` (L489776) — a NO-OP for `empty`/`generated`, which is upstream's own guard: a suggestion
 *  the user never saw cannot have been accepted. */
export function markSuggestionAccepted(s: PromptSuggestion, now: number): PromptSuggestion {
  return s.status === "shown" ? { status: "accepted", text: s.text, shownAt: s.shownAt, acceptedAt: now } : s;
}

/** The composer-render transition pair (L495702-495704), as one pure step so the hook can run it from an
 *  effect: a showable `generated` becomes `shown`; a `generated` that CANNOT be shown right now is discarded
 *  with reason `timing` — it was generated while the user was already typing, so offering it later would put
 *  a stale suggestion under a buffer the user has moved on from. A `shown` suggestion is NOT discarded by the
 *  same condition: it survives a non-empty buffer (and therefore Ctrl-C, which only clears the buffer) until
 *  the next submit resets it. */
export function suggestionRenderStep(s: PromptSuggestion, o: { canShow: boolean; now: number }): { next: PromptSuggestion; discarded?: "timing" } {
  if (o.canShow) return { next: markSuggestionShown(s, o.now) };
  if (s.status === "generated") return { next: EMPTY_SUGGESTION, discarded: "timing" };
  return { next: s };
}

/** ccx's gate, and a DELIBERATE POLARITY FLIP from upstream's (annex §C5.1: "When absent or true, prompt
 *  suggestions are enabled"). EP-C5 ships OFF by default — the feature costs ~$0.0045 and ~5 s per turn, and
 *  upstream's own two feature-flag call sites default it off as well — so only an explicit `true` turns it
 *  on. The `/config` row writes both polarities explicitly for the same reason: with absent meaning OFF, a
 *  write of `undefined` would silently mean "no". */
export function promptSuggestionEnabled(prefs: { promptSuggestionEnabled?: boolean }): boolean {
  return prefs.promptSuggestionEnabled === true;
}

// ── The generator ─────────────────────────────────────────────────────────────────────────────────────────
/** The slice of the library `Session` this module uses. Structural, so `openSession()` satisfies it without
 *  this file importing the session type (and so a unit test can hand in three lines of fake). */
export interface SuggesterSession {
  submit(prompt: string): Promise<{ result: unknown }>;
  dispose(): Promise<void>;
}

export interface SuggesterDeps {
  /** How a suggester session is opened. Defaults to the library's `openSession` with the config below;
   *  unit tests inject a fake and never spawn an engine. */
  openSession?: () => SuggesterSession;
  /** Where the suggester engine runs. With no tools and no project context it barely matters, but the SDK
   *  spawns its CLI somewhere and a deleted cwd is a spawn failure. */
  cwd?: string;
  /** Overridable for the live test, which pins the model it actually billed. */
  model?: string;
}

export interface Suggester {
  /** One suggestion, post-filtered, or null — for a filtered reply, an abort, a retirement, or an engine
   *  that threw. NEVER rejects: this is called fire-and-forget from a turn-end handler. */
  request(ctx: { transcriptTail: string }): Promise<string | null>;
  /** `scd()` (L235125) — the composer calls this on every keystroke. */
  abort(): void;
  /** The `replaceDocument` boundary and REPL teardown: drop anything in flight and end the session, so the
   *  next request starts from a conversation-free context. */
  retire(): void;
}

/** ONE suggester per REPL session (spec EP-C5 lifecycle): spawned lazily on the first eligible turn end,
 *  reused across turns (probe 100c measured no cost creep over four consecutive requests), retired and
 *  respawned whenever the conversation is replaced.
 *
 *  ABORT IS A DISCARD, NOT A CANCEL — recorded divergence. Upstream aborts an `AbortController` that kills
 *  the forked query outright. Interrupting our warm session mid-turn would leave the session it is trying to
 *  keep warm in an indeterminate state, and by the time a keystroke arrives the request is already in flight
 *  and mostly billed. So an aborted request is allowed to finish and its answer is thrown away; what abort
 *  guarantees is the thing that matters for the UI — nothing generated before the keystroke can ever land in
 *  the composer after it. */
export function createSuggester(deps: SuggesterDeps = {}): Suggester {
  const open = deps.openSession ?? (() => defaultOpenSession(deps));
  let session: SuggesterSession | null = null;
  let generation = 0;                       // `q1t`: the live request's token. A bump invalidates whatever is in flight.
  return {
    async request(ctx) {
      const gen = ++generation;
      if (session === null) session = open();
      const current = session;
      let raw: unknown;
      try { raw = (await current.submit(suggestionRequestMessage(ctx.transcriptTail))).result; }
      catch { return null; }                // a dead suggester must never take a turn end down with it
      if (gen !== generation) return null;  // aborted, superseded, or retired while in flight
      if (typeof raw !== "string") return null;
      const verdict = postFilterSuggestion(cleanSuggestion(raw));
      return verdict.ok ? verdict.text : null;
    },
    abort() { generation++; },
    retire() {
      generation++;
      const dying = session; session = null;
      void dying?.dispose().catch(() => {});   // best-effort: teardown must not reject into a render path
    },
  };
}

/** The production factory.
 *
 *  THE DENY BROKER IS THE LOAD-BEARING PART, and it is transcribed rather than invented: `SOy` (L235208)
 *  hands its forked query a `canUseTool` that answers every call
 *  `{behavior:"deny", message:"No tools needed for suggestion"}`. Upstream does NOT strip the tools — the
 *  session's whole tool set is still sent — it just refuses to run any of them. Ours does exactly that, with
 *  upstream's own message (the gate uses `feedback` as the deny arm's `message`, which is the only channel
 *  back to the model). Two things follow, and both matter:
 *    · The permission mode is `default`, NOT `bypassPermissions`. Bypass SILENCES the broker (the
 *      permissionMode × canUseTool matrix), so a suggester running under it would be a background agent with
 *      the full Claude Code tool set and nobody watching. `default` is what keeps the deny in the loop.
 *    · Nothing can hang on it: the broker answers synchronously, so a tool call costs one denied round trip
 *      and the model returns text.
 *  The rest is cost: no project context (probe 100b: the system prompt is not where the tokens are, but the
 *  CLAUDE.md/settings read is a per-session cost with nothing to buy here) and the Haiku-class alias.
 *
 *  THE ENGINE IS OPENED ON FIRST USE, NOT HERE, and the import with it: `../index.js` pulls in the Agent SDK,
 *  and this module is imported by pure unit tests that must not pay for — or spawn — any of that. So the
 *  returned handle is a shell whose first `submit` resolves the import and opens the session; `dispose`
 *  awaits whatever that produced and is a no-op if nothing ever did. */
function defaultOpenSession(deps: SuggesterDeps): SuggesterSession {
  let opened: Promise<SuggesterSession> | null = null;
  const ensure = (): Promise<SuggesterSession> => {
    if (opened === null) opened = import("../index.js").then(({ openSession }) => openSession({
      model: deps.model ?? SUGGESTER_MODEL,
      ...(deps.cwd ? { cwd: deps.cwd } : {}),
      disableProjectContext: true,     // → settingSources [] : no CLAUDE.md, no user/project settings
      permissionMode: "default",
      permissionBroker: { request: async () => ({ kind: "deny", feedback: "No tools needed for suggestion" }) },
      forkSubagent: false, workflow: false,   // two system-prompt appends (and four allowlisted tools) this thread has no use for
    }) as unknown as SuggesterSession);
    return opened;
  };
  return {
    async submit(prompt) { return (await ensure()).submit(prompt); },
    async dispose() { if (opened !== null) await (await opened).dispose(); },
  };
}
