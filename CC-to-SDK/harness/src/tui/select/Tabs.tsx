// tui/select/Tabs.tsx — the `Tabs` strip (F6 T2): the tab HEADER every tabbed dialog paints, written once so
// that the chip styling and the `tab`/`shift+tab`/`←`/`→` cycling arrive everywhere at the same time.
// Transcribed from 2.1.220's `Jx` (L434983 — the container, whose header row is L435073-435076) and its item `awr`
// (L435094-435110). The panel half of upstream's component (`tp`, L435119: render the child whose id === selectedTab)
// is deliberately NOT reproduced — our two tabbed dialogs already switch their own bodies on the active tab
// and route through `onTabChange` into hook state that must survive a sub-dialog round trip
// (SettingsDialog's header explains why the active tab lives there and not here).
//
// Two details that are the whole point of transcribing rather than eyeballing:
//   · A chip is `" " + title + " "` — the padding spaces are on EVERY tab, not just the current one — and the
//     current chip is `inverse` + `bold` (L435109). The strip is a `flexDirection:"row"` box with `gap:1`
//     (L435073): one space between chips, no separator glyph.
//   · Keys are the F2 machinery: `co({ "tabs:next", "tabs:previous" }, { context: "Tabs", isActive })`
//     (L435049) is exactly `useKeyScope("Tabs")` + `useKeyActions`, and the `Tabs` context in our table
//     (bindings.ts, matching upstream's own at L186118) already binds tab/shift+tab/right/left to them.
//     `disableNavigation` (upstream's `nwr`, folded into that `isActive`) registers NO handlers, so the
//     actions fall through to whatever owns the keyboard instead — which is how a host dialog keeps a text
//     surface of its own from losing keys to the strip.
import React from "react";
import { Box, Text } from "ink";
import { useKeyActions, useKeyScope } from "../keys/KeymapProvider.js";
import { resolveThemeColor, themeTokens, type ThemeTokenName } from "../theme.js";

export interface TabSpec { id: string; title: string }

export interface TabsProps {
  tabs: readonly TabSpec[];
  /** The active tab's id. An id that is not in `tabs` reads as the first tab, like `Jx`'s own `-1` guard. */
  active: string;
  onChange: (id: string) => void;
  /** Upstream's `color` (`IIH`): with one set, the current chip becomes a filled BADGE (`T_`, L422149 —
   *  background `color`, foreground `inverseText`, bold) instead of the inverse chip. Upstream gates that on
   *  its header-focus mode, which we do not ship (see SettingsDialog's recorded divergence), so here it is
   *  simply "a colour was asked for" — and every current caller asks for none, i.e. the inverse chip. */
  color?: ThemeTokenName;
  /** No key handlers registered — the strip renders but does not steer (upstream's `nwr`, folded into that isActive at L435043). */
  disableNavigation?: boolean;
}

const NO_ACTIONS = {};

export function Tabs({ tabs, active, onChange, color, disableNavigation = false }: TabsProps) {
  const at = Math.max(0, tabs.findIndex((t) => t.id === active));
  // L435040-435042: cycling is modular over the tab list, in BOTH directions.
  const cycle = (delta: number) => { if (tabs.length > 0) onChange(tabs[(at + delta + tabs.length) % tabs.length]!.id); };

  useKeyScope("Tabs");
  useKeyActions(disableNavigation ? NO_ACTIONS : { "tabs:next": () => cycle(1), "tabs:previous": () => cycle(-1) });

  return (
    <Box flexDirection="row" gap={1}>
      {tabs.map((t, i) => {
        const current = i === at;
        // `TXp = color && isCurrent && headerFocused` (L435102); `headerFocused` is `KIH && !nwr` at the call
        // site (L435075) and `KIH` is true whenever nothing has opted the header out — which nothing does here.
        return (
          <Box key={t.id} flexShrink={0}>
            {current && color
              ? <Text backgroundColor={resolveThemeColor(themeTokens()[color])} color={resolveThemeColor(themeTokens().inverseText)} bold>{` ${t.title} `}</Text>
              : <Text inverse={current} bold={current}>{` ${t.title} `}</Text>}
          </Box>
        );
      })}
    </Box>
  );
}
