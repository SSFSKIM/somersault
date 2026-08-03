// test/fixtures/f1-tool-transcript-frame.tsx — F1 Task 7's deterministic, credential-free capture entry.
// It mounts the REAL `ChatApp`/`useChat` tree (never a test-only renderer, never a hand-built
// TranscriptDocument or RenderItem[]) so a pyte capture of this process is a capture of the production
// rendering path. No SDK call, no API key, no user configuration, no real filesystem read, no private path.
//
//   node --import tsx test/fixtures/f1-tool-transcript-frame.tsx <live|replay> <sidecar|flat|upstream>
//
//   live      the completed `READ_CALL` and then its completed result arrive as HOST events through the
//             fake ChatSession's event stream — the same route a real turn takes.
//   replay    the same raw message pair is handed to ChatApp as ordered `initialEntries`
//             (`{kind:"sdk", source:"disk", message}`), which `useChat` iterates in array order into a
//             fresh TranscriptDocument before any follow subscription starts — the `/resume` route.
//             `replayDocument()` is deliberately not used: it is the SDK-message-only path.
//   sidecar   READ_RESULT_WITH_SIDECAR (structured `tool_use_result`)
//   flat      READ_RESULT_FLAT (no sidecar; the flat `tool_result` fallback)
//   upstream  the real-2.1.220 comparison state. The tracked golden captures the ACTIVE in-flight moment,
//             not a settled turn, so this mode delivers the user prompt through the replay bootstrap and
//             then pushes READ_CALL as a live host event with NO result: that is the only way to reach the
//             production active-group path (`projectPending` gates the blinking row on the LIVE-open set,
//             so a disk-bootstrapped dangling call is retained history and never blinks). READ_RESULT_UPSTREAM
//             is therefore intentionally withheld — delivering it would settle the row and leave the frame
//             comparable to nothing in the golden.
//
// Determinism: the clock is pinned at 0 (so the 600 ms blink phase is always the glyph half), the column
// count is pinned at 100, the theme is pinned to `dark`, and the blink repaint scheduler is a no-op — the
// projection is a pure function of `now`, so the repaint would only rewrite an identical frame, and a
// capture that never races a repaint cannot tear one.
import React from "react";
import { render } from "ink";
import { ChatApp } from "../../src/tui/ChatApp.js";
import { setTheme } from "../../src/tui/theme.js";
import type { TranscriptBootstrapEntry } from "../../src/tui/transcriptModel.js";
import { fakeRemote } from "../tui/helpers/fakeRemote.js";
import { READ_CALL, READ_RESULT_FLAT, READ_RESULT_UPSTREAM, READ_RESULT_WITH_SIDECAR, UPSTREAM_READ_PROMPT } from "./f1-tool-transcript.js";

const route = process.argv[2] === "live" ? "live" : "replay";
const shape = process.argv[3] ?? "sidecar";
const result = shape === "flat" ? READ_RESULT_FLAT : shape === "upstream" ? READ_RESULT_UPSTREAM : READ_RESULT_WITH_SIDECAR;
void result;   // named for the reader: `upstream` deliberately never delivers its result (see the header)

const disk = (message: Record<string, unknown>): TranscriptBootstrapEntry => ({ kind: "sdk", source: "disk", message });
// The ordered bootstrap. `upstream` seeds only the prompt; `replay` seeds the whole settled pair.
const initialEntries: TranscriptBootstrapEntry[] =
  shape === "upstream" ? [disk(UPSTREAM_READ_PROMPT as unknown as Record<string, unknown>)]
  : route === "replay" ? [disk(READ_CALL as unknown as Record<string, unknown>), disk(result as unknown as Record<string, unknown>)]
  : [];

setTheme("dark");
const session = fakeRemote();
const app = render(
  <ChatApp makeSession={() => session} client={{ kind: "loopback" }} cwd="/work" initialEntries={initialEntries}
    deps={{ now: () => 0, columns: () => 100, scheduleRepaint: () => () => {} }} />,
  { exitOnCtrlC: false },
);
// Live host events go out AFTER the tree is mounted; the fake buffers anything that beats the subscription
// and flushes it on subscribe, exactly like the real adapter's replay-first pipe.
if (shape === "upstream") session.pushEvent({ kind: "message", data: READ_CALL });
else if (route === "live") { session.pushEvent({ kind: "message", data: READ_CALL }); session.pushEvent({ kind: "message", data: result }); }
await app.waitUntilExit();
