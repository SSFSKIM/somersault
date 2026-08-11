// hooks/promptLatch.ts — WAVE 2 TASK 6 (EP-D4): the one route by which the REPL learns its own
// `transcript_path` and `prompt_id`.
//
// WHY A HOOK AND NOT A LOOKUP. Both fields are carried on every hook input (`BaseHookInput.transcript_path`
// / `.prompt_id`, sdk.d.ts) and nowhere else the SDK exposes: there is no control op for either, and the
// JSONL path is built from a project-slug rule ccx does not encode and must not guess — a status line
// script may `cat` what it is handed. Of the thirty declared hook events only eight fire headlessly
// (memory `sdk-hooks-headless-reachability`), and the two that would answer at STARTUP — `SessionStart` /
// `SessionEnd` — are the proven-dormant pair. `UserPromptSubmit` is in the verified-firing eight, so the
// earliest either field can be known is the first prompt of the process. That is also when canon's
// `prompt_id` first appears (`gwt() ?? void 0`, absent until `Ot.promptId` is set), and it is one prompt
// later than canon's `transcript_path` — the recorded divergence, stated in `statusLine.ts`.
//
// LIVE-VERIFIED, not inferred from `sdk.d.ts`: probe 104
// (`probes/probes/104-userpromptsubmit-transcript-path.ts`) registers this exact hook shape through
// `Options.hooks` and prints what arrives — keys `cwd, hook_event_name, permission_mode, prompt,
// prompt_id, session_id, transcript_path`, with `transcript_path` a real
// `~/.claude/projects/<slug>/<id>.jsonl` and `prompt_id` a uuid. Both strings, on the first prompt.
//
// WHY A LATCH OBJECT AND NOT A CALLBACK. The hook runs inside the SDK session the HOST owns, and the reader
// is the REPL's `useChat`. In a foreground `ccx` those are the same process (an in-process `SessionHost`
// plus a loopback client), so one shared object is the whole bridge — the same shape `chatMain`'s
// `DeferredClearBridge`/`NoticeBridge` use for the other two cross-layer facts. In `ccx attach` they are
// NOT the same process: no latch is passed, nothing is ever written, and both payload keys stay absent —
// which is the honest answer for a client that is not running the engine.
//
// DELIBERATELY NO CHANGE NOTIFICATION. A `set` does not poke the status line. Canon's refresh list
// (L484930) has no prompt-id term either, and adding one would re-introduce the turn-START run that W2 T6's
// dedupe exists to remove; the next scheduled run — the turn-end one, at the latest — reads the latch.
import { observe } from "./builders.js";
import type { HooksMap } from "./types.js";

export interface PromptFacts { transcriptPath?: string; promptId?: string }

export interface PromptLatch {
  /** What the last `UserPromptSubmit` carried. `{}` before the first prompt and after a `clear()`. */
  read(): PromptFacts;
  /** The conversation boundary (`/clear`, resume, rewind): the old path and prompt id describe a
   *  conversation that is gone. Canon nulls `Ot.promptId` in the same chain (`vtt()`, L314343). */
  clear(): void;
  /** The `UserPromptSubmit` fragment to merge into the session's hooks. Registered once per host. */
  hooks(): HooksMap;
}

export function createPromptLatch(): PromptLatch {
  let facts: PromptFacts = {};
  return {
    read: () => facts,
    clear() { facts = {}; },
    hooks(): HooksMap {
      return observe("UserPromptSubmit", (input) => {
        const i = input as { transcript_path?: unknown; prompt_id?: unknown };
        facts = {
          ...(typeof i.transcript_path === "string" && i.transcript_path ? { transcriptPath: i.transcript_path } : {}),
          ...(typeof i.prompt_id === "string" && i.prompt_id ? { promptId: i.prompt_id } : {}),
        };
      });
    },
  };
}
