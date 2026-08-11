// test/tui/helpers/composerFooter.tsx — Wave C Task 2's test-side companion to the footer rewrite.
//
// The composer stopped painting its own hint rows: the exit arm, `Pasting…`, `paste again to expand` and the
// bash-mode line are FOOTER states now, reported up through `onFooterState` and drawn by `<Footer>`, which
// `ChatApp` mounts one row below the composer. A bare `<ChatComposer>` render therefore shows none of them —
// so every pre-existing test whose subject is one of those four composes the two components the way the app
// does, and keeps its assertions exactly as they were.
//
// This is deliberately the SMALLEST possible stand-in for `ChatApp`: it wires the one channel the footer
// needs and nothing else. A test that needs mode chips, agents or a live keymap-driven `ChatApp` should
// render `ChatApp` itself.
import React, { useState } from "react";
import { Box } from "ink";
import { ChatComposer, IDLE_COMPOSER_FOOTER_STATE, type ComposerFooterState } from "../../../src/tui/ChatComposer.js";
import { Footer } from "../../../src/tui/Footer.js";
import { defaultLookup } from "../../../src/tui/keys/hints.js";

export function ComposerWithFooter(props: React.ComponentProps<typeof ChatComposer>) {
  const [footer, setFooter] = useState<ComposerFooterState>(IDLE_COMPOSER_FOOTER_STATE);
  // Two channels, exactly as `ChatApp` wires them: the draft signal rides `onInputActivity` (synchronous,
  // so the collapse lands in the keystroke's own frame) and everything else rides `onFooterState`.
  const [draftNonEmpty, setDraft] = useState(false);
  return (
    <Box flexDirection="column">
      <ChatComposer {...props} onFooterState={setFooter}
        onInputActivity={(nonEmpty) => { setDraft(nonEmpty); props.onInputActivity?.(nonEmpty); }} />
      <Footer mode="default" busy={props.busy ?? false} statusLineConfigured={false}
        draftNonEmpty={draftNonEmpty} isInputEmpty={!draftNonEmpty}
        agents={{ count: 0 }} bindings={defaultLookup} {...footer} />
    </Box>
  );
}
