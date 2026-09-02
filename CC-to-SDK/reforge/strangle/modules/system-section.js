// ADAPTER — the graph-facing seam for the "# System" section.
//
// Delegation signature:
//   systemSection(session, systemReminderNote)
//
// ONE forwarded port and two things deliberately NOT forwarded, which is the
// §2.4 taxonomy doing real work in one row:
//
//   systemReminderNote  upstream `SKe` — TWO callers (this section and the lean
//       prompt, which this wave does not own) and NOT pure: it reads a latch and
//       answers with a different constant when it is set. So it is an
//       `effectful-port`, forwarded and called.
//   the hooks paragraph  upstream `_8t` — ONE caller, this one, and pure. C7's
//       rule folds it into the owned module: splicing its only caller would make
//       upstream's copy unreachable, so a row of its own would be dead.
//   the bullet formatter  a `pure-helper` with fifteen call sites; owned here
//       and left live upstream.
import { systemSection } from "./system-section/reference.js";

globalThis.__reforge = Object.assign(globalThis.__reforge ?? {}, {
  systemSection(session, systemReminderNote) {
    return systemSection(session, systemReminderNote);
  },
});
