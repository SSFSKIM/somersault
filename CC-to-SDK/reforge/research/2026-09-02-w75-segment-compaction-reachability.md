# Segment compaction: a reachability measurement, and a correction to the symbol the campaign named

**Pin 2.1.251 · SDK 0.3.251 · measured 2026-09-02 (W7.5/C10.5)**

W4 left three adjudicated branch outcomes — `user_context`, `messages_summarized` and the
un-suppressed follow-up-question arm — reachable "only through upstream's from/up_to segment
variant", and every wave since has carried that as a coverage debt waiting for an owner. The W7.5
charter's first instruction about it was to measure reachability **before** budgeting coverage.
The measurement says the debt is not a coverage debt at all.

**Verdict: OPEN — nothing headless reaches the producer.** The condition is nameable to the
keystroke, and creating it requires a mounted terminal UI, which the SDK seam cannot supply. This is
an ownability-ceiling finding, recorded in the campaign's three-value vocabulary: not FIRED (no
headless path reaches it), not DEAD (the code is live and its output is fully serialized), OPEN with
the missing condition named.

## First, the correction: `hRt` is not the function

The campaign spec, this repository's README, the W3/W4 anchor scout and W4's own exclusion reasons
all name `hRt` as "the from/up_to segment variant" that passes five arguments to the
`compact_boundary` constructor. `hRt` is real, is chunk-local to `chunk-fy12d89p.js`, is 513 bytes,
and is the **summarization-prompt builder** for that path — `function hRt(e, t = "from")`, which
branches on `t === "up_to" ? u1n : c1n` to choose a prompt body. It never calls the constructor.

The function that does is **`E4n`**:

| | |
|---|---|
| symbol | `E4n`, `chunk-fy12d89p.js` (definition at chunk offset 2813855) |
| size | 4,710 bytes |
| signature | `async function E4n(e, t, r, o, u)` — `(messages, index, toolUseContext, cacheSafeParams, { userFeedback, direction = "from", onNotification, onResponseLength })` |
| exported | yes, from `chunk-fy12d89p.js` |
| telemetry | `tengu_partial_compact`, `trigger: "message_selector"` |

The mis-naming was not load-bearing for any shipped claim — no splice anchors on `hRt`, and W4's
three exclusions describe the CALL SITE correctly — but it is exactly the class of error the
campaign has paid for twice before (an inference about a symbol propagating into every place the
reasoning lives), so the correction is swept through the prose sites rather than noted only here.

## The five-args-vs-three claim, re-measured

The constructor is **`H1`** (`chunk-fy12d89p.js`, offset 3964589, 276 bytes, chunk-local):

```js
function H1(e, t, r, o, u) {
  return { type: "system", subtype: "compact_boundary", …,
    compactMetadata: { trigger: e, preTokens: t, userContext: o, messagesSummarized: u },
    ...r && { logicalParentUuid: r } };
}
```

Three call sites bundle-wide, counted with an identifier-boundary regex over the chunk
(`(?<![A-Za-z0-9_$.])H1\(`):

| offset | caller | args |
|---|---|---|
| 1701952 | the precompute/reactive finalize path (`/compact`, precomputed autocompact) | **3** |
| 2810977 | `wFt` — full compaction | **3** |
| 2816935 | `E4n` — segment compaction | **5** |

So the shape of W4's claim is confirmed and only its subject changes: `userContext` and
`messagesSummarized` are undefined on every path the corpus can drive, including
`/compact <instructions>`, and the fifth argument is `W.length` — the size of the summarized slice
(`messages.slice(index)` for `from`, `messages.slice(0, index)` for `up_to`).

The third arm has the same shape. `Cq`, the summary preamble builder, has three call sites: the
precompute finalizer passes `suppressFollowUpQuestions: !0`, `wFt` passes a parameter that is
literal `!0` at both of its own call sites, and `E4n` passes literal `!1`. `E4n` is the only
producer of an un-suppressed continuation.

## Why nothing headless reaches `E4n`

`E4n` is imported by exactly one chunk and called exactly once.

```
# every chunk whose import list names E4n
IMPORTS E4n: chunk-6thm48px.js <- /$bunfs/root/chunk-fy12d89p.js
# references in that chunk: 2 — the import binding and one call
```

The single call is inside `handleSummarize`, a class-property method on the interactive session
controller (`chunk-6thm48px.js`, offset 240020):

```js
handleSummarize = async (S, x, P = "from") => {
  let { transcript: j, turn: H, _setAppState: Z, draft: re } = this,
      { mainLoopModel: ue, addNotification: de } = this._requireHost();
  …
  He = await E4n(Re, be, Oe, Ie, { userFeedback: x, direction: P, … });
```

Every hop above it has exactly one call site, so the chain is exhaustive rather than
representative:

```
E4n
 └─ handleSummarize                    (guarded by this._requireHost())
     └─ prop `onSummarize` of the message-selector dialog
         └─ that dialog, mounted through localJsx.show(...) with commandName "rewind"
             └─ the host binding installed by a React effect in the REPL root
                 └─ openMessageSelector
                     └─ a double-keypress hook (Esc pressed twice inside its window)
```

Three things gate it, and the SDK seam supplies none of them: a mounted Ink/React component tree
with a `localJsx` dialog host; a bound session-controller host (`_requireHost()` throws otherwise,
before `E4n` is reached); and a TTY keypress stream. The REPL component itself is reached only
through a dynamic import inside the interactive launcher, whose only callers are in the terminal
`main`.

The dialog is also where the two extra constructor arguments come from: the menu offers
"Summarize from here" and "Summarize up to here" (which becomes `direction`), and a free-text box
whose contents become `userFeedback`, i.e. `user_context`. **There is no non-UI producer of that
value anywhere in the bundle.**

### What was checked and ruled out

- **The control protocol.** Every arm's delegate list in
  `research/fixtures/control-protocol-2.1.251.json` (52 arms / 54 subtypes) was filtered for `E4n`,
  `wFt`, `hRt` and `H1`: zero matches, and there is no `compact`, `summarize`, `partial_compact` or
  `segment_compact` subtype. The tempting one is `rewind_conversation` — engine-served, not SDK
  sendable, and named after the same dialog — but its body validates a target uuid, stops descendant
  tasks, persists an anchor and TRUNCATES the transcript. No summarization request, no boundary. A
  hand-rolled stdio client sending the raw subtype would not reach `E4n` either.
- **The SDK surface.** Every method the installed SDK's `interface Query` declares — **27** of them
  (`sdk.d.ts` 2522–2837, `@anthropic-ai/claude-agent-sdk` 0.3.251; an earlier draft of this note said
  nineteen, counted by hand) — plus every `subtype:"…"` literal in `sdk.mjs` and the option surface:
  no compaction method of any kind. The nearest neighbour is `rewindFiles`, which restores files and
  never summarizes. `autoCompactEnabled`, `precomputeCompactionEnabled` and `autoCompactWindow` tune
  the automatic threshold path, which is the 3-argument one; nothing accepts a message anchor or a
  direction.
- **Hooks.** `PreCompactHookInput.trigger` is `'manual' | 'auto'` with no third value, and `E4n`
  calls the PreCompact hook with a hardcoded `{ trigger: "manual", customInstructions: null }` — so
  a hook cannot distinguish it, let alone cause it.
- **Slash commands.** `/compact` loads a module whose `call` routes to the precompute-aware reactive
  pipeline and lands on the 3-argument constructor call. **There IS a `/rewind` command** — an
  earlier draft of this note said there was not, and that was wrong. `chunk-fy12d89p.js` registers

  ```js
  Snr = { description: "Restore the code and/or conversation to a previous point",
          name: "rewind", aliases: ["checkpoint", "undo"], type: "local",
          supportsNonInteractive: !1, load: () => import("…chunk-pn5vyxxp.js") }
  ```

  whose `call` is `o.onQueryEvent?.({type:"open_message_selector"}), {type:"skip"}` — it asks the
  host to open the very dialog `handleSummarize` hangs off. It reaches nothing headless because of
  **two guards, which are the actual reason and are what this bullet now cites**:

  1. **The headless command filter.** `k0t` keeps only commands satisfying
     `type === "local" && supportsNonInteractive`. `/rewind` declares `supportsNonInteractive: !1`,
     so a headless session refuses it before its `call` body runs at all.
  2. **The headless query-event sink drops the event.** Even if the `call` ran, the headless sink in
     `chunk-dvbbv89q.js` is `if (e.type === "open_message_selector") return;`. Only the REPL's sink
     opens the selector. So the command's single effect is a no-op off the terminal.

  The general form of the mistake this replaces: **an enumeration that rules something out must cite
  the guards that rule it out, not the absence of the thing.** "There is no such command" is a
  negative the healthy case — a command that exists and is refused — does not falsify.

## Two things this does NOT say

**It is not dead code.** The SDK-facing serializer maps both fields onto the wire frame
(`...userContext !== void 0 && { user_context: … }`, likewise `messages_summarized`), and the
inverse deserializer reads them back. The plumbing is complete end to end; only the producer is
behind the terminal.

**The READER side is reachable headlessly.** The replay emitter re-serializes any stored
`compact_boundary` through the same mapper, so a headless `query()` that RESUMES a transcript
produced by an interactive session will emit `user_context` and `messages_summarized` on the wire.
The fields are observable without being producible. A future wave that wants the reader side graded
can seed a fixture transcript; what it cannot do from this seam is create the writer.

## Consequences, recorded where they belong

1. **W4's three exclusions move to this evidence.** They were written as deferrals — "no wave owns
   that path yet" — which reads as a coverage debt someone will pay. They are re-stated as
   seam-unreachable with the enumeration above: the producer sits behind a mounted UI, so no corpus
   scenario can drive it, and `compaction-parity.test.ts` remains what grades them (it evaluates the
   pinned upstream bodies with stubbed ports, which is stronger evidence for an unrendered arm than a
   differential red is for a rendered one).
2. **The variant routes to C16/W13.** That wave already owns the compaction drivers (`zRe`, `Tte`);
   `E4n` is the third driver and belongs with them rather than in a completions wave. This is a
   routing decision, not an ownership claim.
3. **No machinery was built to force the path.** The charter's instruction — do not build machinery
   to reach an unreachable path — is what this note is instead.

## The ownability angle, since that is the campaign's point

`E4n` is a single exported function of 4.7 KB whose own body has no terminal-UI dependency; every
gate lives in the callers above it. Once reforge owns the module, exposing segment compaction as a
control-protocol subtype or an SDK-level method costs essentially nothing, and the wire format for
the result is already specified by the engine's own mapper and already understood by the SDK's
session-store reader. That is the cleanest instance so far of the campaign's "customize X and own X
are the same act": the ceiling here is not the behaviour, it is the fact that someone else chose
which surface could ask for it.
