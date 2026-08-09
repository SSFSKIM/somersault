// tui/src/EffortRow.tsx — WAVE C TASK 11 (EP-C6): the one effort row, rendered. Annex §C6.1 (the glyph and
// its colour) and §C6.3 (`yva`, L441142 — the row's two arms and the max caveat under them).
//
// It is a module of its own because BOTH effort surfaces draw it: the `/model` picker embeds it between the
// list and the footer (§C6.3), and the standalone `/effort` dialog is essentially this row plus §C6.4's
// footer. Putting it in either one would make the other import a sibling for a shared fragment; the strings
// already live in `modelPickerModel.ts` and this is the twelve lines of colour that go with them.
//
// UPSTREAM'S COLOUR RULE, `ivn` (L441180): the whole row is `dimColor`; the GLYPH takes `claude` when an
// effort level exists and `subtle` when it does not (the unsupported arm), and the adjust hint takes
// `subtle`. The glyph is NOT colour-coded per level — only its shape changes. Everything between them
// inherits the row's dim.
import React from "react";
import { Box, Text } from "ink";
import { resolveThemeColor, themeTokens } from "./theme.js";
import {
  EFFORT_ADJUST_HINT, MAX_EFFORT_CAVEAT, effortGlyph, effortTitle, type EffortLevel,
} from "./modelPickerModel.js";

const role = (name: "claude" | "subtle") => resolveThemeColor(themeTokens()[name]);

export function EffortRow({ level, isDefault = false, supported = true, modelName }: {
  /** The level the row is describing — the session's live one in the picker, the STAGED one in the dialog. */
  level?: EffortLevel;
  /** `x5t === I5t` (L441142): the `(default)` clause appears only when the level equals the model's default. */
  isDefault?: boolean;
  /** `tvn`. False renders the unsupported arm, which has no level, no `(default)` and no adjust hint. */
  supported?: boolean;
  /** `nva` — the DISPLAY name, and only used by the unsupported arm. */
  modelName?: string;
}) {
  if (!supported || !level) {
    return (
      <Box marginBottom={1} flexDirection="column">
        <Text color={role("subtle")}>{effortGlyph(undefined)}{" Effort not supported"}{modelName ? ` for ${modelName}` : ""}</Text>
      </Box>
    );
  }
  return (
    <Box marginBottom={1} flexDirection="column">
      <Text dimColor>
        <Text color={role("claude")}>{effortGlyph(level)}</Text>{" "}
        {effortTitle(level)}{" "}{"effort"}{isDefault ? " (default)" : ""}{" "}
        <Text color={role("subtle")}>{EFFORT_ADJUST_HINT}</Text>
      </Text>
      {level === "max" ? <Text color={role("subtle")}>{MAX_EFFORT_CAVEAT}</Text> : null}
    </Box>
  );
}
